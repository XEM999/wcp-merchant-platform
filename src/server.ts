import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { EventEmitter } from 'events';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import xss from 'xss';
import multer from 'multer';
import {
  createMerchant,
  getMerchant,
  getAllMerchants,
  updateMerchantStatus,
  updateMenu,
  getNearbyMerchants,
  createReview,
  getReviews,
  Merchant,
  Location,
  // 订单相关导入
  createOrder,
  getOrder,
  getOrdersByMerchant,
  getOrdersByUser,
  updateOrderStatus,
  getUserMerchantId,
  Order,
  OrderStatus,
  OrderItem,
  // Admin相关导入
  getAdminStats,
  getAllUsers,
  getAllOrdersAdmin,
  getAllMerchantsAdmin,
  banMerchant,
  unbanMerchant,
  banUser,
  unbanUser,
  suspendMerchant,
  unsuspendMerchant,
  suspendUser,
  unsuspendUser,
  updateMerchantPlan,
  logAdminAction,
  getAdminLogs,
  promoteUserToAdmin,
  getAllOrdersForExport,
  getAllMerchantsForExport,
  initAdminAccount,
  deleteReview,
  supabase,
  cancelOrder,
  uploadMenuImage,
  // 取餐方式相关
  PickupMethodConfig,
  DEFAULT_PICKUP_METHODS,
  getMerchantPickupMethods,
  updateMerchantPickupMethods,
  validatePickupMethod,
  ensurePickupMethodsColumn,
  // 厨房工位相关
  KitchenStation,
  getMerchantKitchenStations,
  updateMerchantKitchenStations,
  ensureKitchenStationsColumn,
  // Phase 2C: 关注/粉丝系统
  followMerchant,
  unfollowMerchant,
  getFollowedMerchants,
  getMerchantFollowers,
  isFollowing,
  // Phase 2C: 位置日程系统
  MerchantSchedule,
  getMerchantSchedules,
  upsertMerchantSchedule,
  deleteMerchantSchedule,
  updateActualLocation,
  ensurePhase2cColumns,
} from './database';
import { register, login, authMiddleware, optionalAuthMiddleware, adminMiddleware, superAdminMiddleware } from './auth';

// ==================== Multer 配置 ====================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 最大5MB
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 JPG/PNG/WebP 图片'));
    }
  }
});

// ==================== 工具函数 ====================

/** Haversine公式：计算两点距离（公里） */
function haversine(a: Location, b: Location): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** 统一错误响应 */
function err(res: Response, status: number, msg: string) {
  return res.status(status).json({ error: msg });
}

// ==================== SSE 事件分发 ====================

/** 订单事件总线 - 用于实时推送订单状态变化 */
const orderEventBus = new EventEmitter();
// 设置最大监听器数量，避免内存泄漏警告
orderEventBus.setMaxListeners(100);

/** SSE 事件类型 */
interface OrderEvent {
  type: 'order_created' | 'order_updated' | 'order_status_changed';
  orderId: string;
  merchantId?: string;
  userId?: string;
  data?: any;
}

/** 发送订单事件 */
function emitOrderEvent(event: OrderEvent) {
  orderEventBus.emit('order_event', event);
  // 同时发送到特定订单和商户频道
  if (event.orderId) {
    orderEventBus.emit(`order:${event.orderId}`, event);
  }
  if (event.merchantId) {
    orderEventBus.emit(`merchant:${event.merchantId}`, event);
  }
  if (event.userId) {
    orderEventBus.emit(`user:${event.userId}`, event);
  }
}

/** SSE 心跳间隔（毫秒） */
const SSE_HEARTBEAT_INTERVAL = 10000; // 10秒心跳，更频繁避免Railway/proxy超时断连

// ==================== Express ====================

const app = express();

// ==================== 安全中间件 ====================

// 安全HTTP头
app.use(helmet({
  contentSecurityPolicy: false, // 因为我们serve前端HTML
}));

// CORS限制
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // 允许无origin的请求（如移动app、curl）
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // 暂时宽松，上线后收紧
    }
  },
  credentials: true,
}));

// 全局速率限制
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1分钟
  max: 500,             // 每IP 500次（SSE+页面切换会消耗大量请求）
  message: { error: '请求过于频繁，请稍后重试' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', globalLimiter);

// 认证接口限制（测试期间放宽，项目完成后改回 max:10, windowMs:15*60*1000）
const authLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1分钟
  max: 10000,                // 测试期间基本不限制
  message: { error: '登录/注册尝试过于频繁，请稍后重试' },
  standardHeaders: true,
  legacyHeaders: false,
});
// 只限制登录和注册，不限制 /api/auth/me（每次刷新页面都会调）
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ==================== 输入消毒工具 ====================

function sanitizeInput(input: string, maxLength: number = 500): string {
  if (typeof input !== 'string') return '';
  return xss(input.trim().slice(0, maxLength));
}

// ==================== Express 基础中间件 ====================

app.use(express.json());

// ==================== 认证接口 ====================

// --- 注册 ---
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { phone, password } = req.body;
  if (!phone || !password) return err(res, 400, 'phone/password 必填');
  if (password.length < 6) return err(res, 400, '密码至少6位');

  try {
    const result = await register(phone, password);
    const merchantId = await getUserMerchantId(result.user.id);
    res.status(201).json({ message: '注册成功', token: result.token, user: { ...result.user, merchantId: merchantId || null } });
  } catch (e: any) {
    if (e.message.includes('已注册')) {
      return err(res, 400, e.message);
    }
    console.error('注册错误:', e);
    return err(res, 500, '注册失败');
  }
});

// --- 登录 ---
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { phone, password } = req.body;
  if (!phone || !password) return err(res, 400, 'phone/password 必填');

  try {
    const result = await login(phone, password);
    const merchantId = await getUserMerchantId(result.user.id);
    res.json({ message: '登录成功', token: result.token, user: { ...result.user, merchantId: merchantId || null } });
  } catch (e: any) {
    return err(res, 401, e.message || '手机号或密码错误');
  }
});

// --- 获取当前用户信息 ---
app.get('/api/auth/me', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { passwordHash, ...userWithoutPassword } = user;
  // 附带merchantId方便前端路由
  const merchantId = await getUserMerchantId(user.id);
  res.json({ ...userWithoutPassword, merchantId: merchantId || null });
});

// ==================== 商户接口 ====================

// --- 商户注册 (需登录) ---
app.post('/api/merchants', authMiddleware, async (req: Request, res: Response) => {
  // 输入消毒
  const name = sanitizeInput(req.body.name, 100);
  const type = sanitizeInput(req.body.type, 50);
  const phone = sanitizeInput(req.body.phone, 20);
  const email = req.body.email ? sanitizeInput(req.body.email, 100) : undefined;
  const description = req.body.description ? sanitizeInput(req.body.description, 500) : undefined;
  const address = req.body.address ? sanitizeInput(req.body.address, 200) : undefined;
  const location = req.body.location;
  
  if (!name || !type || !phone) return err(res, 400, 'name/type/phone 必填');
  if (!location?.lat || !location?.lng) return err(res, 400, 'location{lat,lng} 必填');

  const userId = (req as any).userId;
  try {
    const m = await createMerchant({
      name,
      type,
      phone,
      email,
      description,
      location,
      address,
      userId,
    });
    res.status(201).json({ message: '注册成功', merchant: m });
  } catch (e: any) {
    console.error('商户注册错误:', e);
    return err(res, 500, '商户注册失败');
  }
});

// --- 附近在线商户 (公开) ---
app.get('/api/merchants/nearby', async (req: Request, res: Response) => {
  const lat = parseFloat(String(req.query.lat));
  const lng = parseFloat(String(req.query.lng));
  const radius = parseFloat(String(req.query.radius)) || 5;

  if (isNaN(lat) || isNaN(lng)) return err(res, 400, 'lat/lng 参数必填');

  const center: Location = { lat, lng };
  try {
    const results = await getNearbyMerchants(center, radius);
    res.json({ center, radius, count: results.length, merchants: results });
  } catch (e: any) {
    console.error('附近商户查询错误:', e);
    return err(res, 500, '查询失败');
  }
});

// --- 商户列表 (公开) ---
app.get('/api/merchants', async (req: Request, res: Response) => {
  try {
    const all = await getAllMerchants();
    res.json({ count: all.length, merchants: all });
  } catch (e: any) {
    console.error('商户列表查询错误:', e);
    return err(res, 500, '查询失败');
  }
});

// --- 商户详情 (公开) ---
app.get('/api/merchants/:id', async (req: Request, res: Response) => {
  try {
    const m = await getMerchant(req.params.id);
    if (!m) return err(res, 404, '商户不存在');
    res.json(m);
  } catch (e: any) {
    console.error('商户详情查询错误:', e);
    return err(res, 500, '查询失败');
  }
});

// --- 获取商户的取餐方式 (公开) ---
app.get('/api/merchants/:id/pickup-methods', async (req: Request, res: Response) => {
  try {
    const methods = await getMerchantPickupMethods(req.params.id);
    res.json({ methods });
  } catch (e: any) {
    console.error('获取取餐方式错误:', e);
    return err(res, 500, '查询失败');
  }
});

// --- 更新商户的取餐方式 (需登录) ---
app.put('/api/merchant/pickup-methods', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权操作');
    }

    const { methods } = req.body;
    if (!Array.isArray(methods)) {
      return err(res, 400, 'methods 必须是数组');
    }

    // 验证每个取餐方式配置
    for (const method of methods) {
      if (!method.id || !method.label_zh || !method.label_en) {
        return err(res, 400, '每个取餐方式必须有 id, label_zh, label_en');
      }
    }

    const success = await updateMerchantPickupMethods(merchantId, methods);
    if (!success) {
      return err(res, 500, '更新失败');
    }

    res.json({ message: '取餐方式已更新', methods });
  } catch (e: any) {
    console.error('更新取餐方式错误:', e);
    return err(res, 500, '更新失败');
  }
});

// --- 获取厨房工位 (需登录) ---
app.get('/api/merchant/kitchen-stations', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权操作');
    }

    const stations = await getMerchantKitchenStations(merchantId);
    res.json({ stations });
  } catch (e: any) {
    console.error('获取厨房工位错误:', e);
    return err(res, 500, '获取失败');
  }
});

// --- 更新厨房工位 (需登录) ---
app.put('/api/merchant/kitchen-stations', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权操作');
    }

    const { stations } = req.body;
    if (!Array.isArray(stations)) {
      return err(res, 400, 'stations 必须是数组');
    }

    // 验证每个工位配置
    for (const station of stations) {
      if (!station.id || !station.name_zh || !station.name_en) {
        return err(res, 400, '每个工位必须有 id, name_zh, name_en');
      }
    }

    const success = await updateMerchantKitchenStations(merchantId, stations);
    if (!success) {
      return err(res, 500, '更新失败');
    }

    res.json({ message: '工位已更新', stations });
  } catch (e: any) {
    console.error('更新厨房工位错误:', e);
    return err(res, 500, '更新失败');
  }
});

// --- 上线/下线 (需登录，支持PATCH和PUT) ---
app.put('/api/merchants/:id/status', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    const m = await getMerchant(req.params.id);
    if (!m) return err(res, 404, '商户不存在');
    if (m.userId && m.userId !== (req as any).userId) return err(res, 403, '无权操作');
    
    // 检查商户账号状态
    if (m.accountStatus === 'banned' || m.accountStatus === 'suspended' || m.accountStatus === 'expired') {
      return err(res, 403, '商家账号已停权/到期，无法操作');
    }
    
    if (typeof req.body.online !== 'boolean') return err(res, 400, 'online 必须是 boolean');
    const updated = await updateMerchantStatus(req.params.id, req.body.online);
    res.json({ message: updated?.online ? '已上线' : '已下线', merchant: updated });
  } catch (e: any) {
    console.error('商户状态更新错误:', e);
    return err(res, 500, '更新失败');
  }
});

app.patch('/api/merchants/:id/status', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    const m = await getMerchant(req.params.id);
    if (!m) return err(res, 404, '商户不存在');
    
    // 验证商户归属
    if (m.userId && m.userId !== (req as any).userId) {
      return err(res, 403, '无权操作此商户');
    }

    // 检查商户账号状态
    if (m.accountStatus === 'banned' || m.accountStatus === 'suspended' || m.accountStatus === 'expired') {
      return err(res, 403, '商家账号已停权/到期，无法操作');
    }

    if (typeof req.body.online !== 'boolean') return err(res, 400, 'online 必须是 boolean');
    
    const updated = await updateMerchantStatus(req.params.id, req.body.online);
    res.json({ message: updated?.online ? '已上线' : '已下线', merchant: updated });
  } catch (e: any) {
    console.error('商户状态更新错误:', e);
    return err(res, 500, '更新失败');
  }
});

// --- 更新菜单 (需登录，商户自己操作) ---
app.put('/api/merchants/:id/menu', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    const m = await getMerchant(req.params.id);
    if (!m) return err(res, 404, '商户不存在');
    
    // 验证商户归属
    if (m.userId && m.userId !== (req as any).userId) {
      return err(res, 403, '无权操作此商户');
    }

    // 检查商户账号状态
    if (m.accountStatus === 'banned' || m.accountStatus === 'suspended' || m.accountStatus === 'expired') {
      return err(res, 403, '商家账号已停权/到期，无法操作');
    }

    const rawItems = req.body.items;
    if (!Array.isArray(rawItems)) return err(res, 400, 'items 必须是数组');

    // 输入消毒：对菜单项的文本字段进行消毒
    const items = rawItems.map((item: any) => ({
      ...item,
      name: sanitizeInput(item.name, 100),
      description: item.description ? sanitizeInput(item.description, 300) : undefined,
      category: item.category ? sanitizeInput(item.category, 50) : undefined,
    }));

    const updated = await updateMenu(req.params.id, items);
    res.json({ message: '菜单已更新', menuItems: updated?.menuItems });
  } catch (e: any) {
    console.error('菜单更新错误:', e);
    return err(res, 500, '更新失败');
  }
});

// --- 上传菜品图片 (需登录) ---
app.post('/api/upload/menu-image', authMiddleware, upload.single('image'), async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权上传');
    }

    const file = req.file;
    if (!file) {
      return err(res, 400, '请选择图片文件');
    }

    // 生成文件路径: {merchantId}/{timestamp}_{originalname}
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = originalName.split('.').pop() || 'jpg';
    const filePath = `${merchantId}/${timestamp}_${originalName}`;

    // 上传到Supabase Storage
    const publicUrl = await uploadMenuImage(file.buffer, filePath, file.mimetype);

    res.json({ 
      message: '图片上传成功', 
      url: publicUrl,
      filePath 
    });
  } catch (e: any) {
    console.error('图片上传错误:', e);
    return err(res, 500, e.message || '图片上传失败');
  }
});

// --- 提交评价 (需登录) ---
app.post('/api/merchants/:id/reviews', authMiddleware, async (req: Request, res: Response) => {
  try {
    const m = await getMerchant(req.params.id);
    if (!m) return err(res, 404, '商户不存在');

    const { score } = req.body;
    // 输入消毒
    const comment = sanitizeInput(req.body.comment, 500);
    
    if (!score || score < 1 || score > 5) return err(res, 400, 'score 必须 1-5');
    if (!comment) return err(res, 400, 'comment 必填');

    const userId = (req as any).userId;
    
    const result = await createReview({
      merchantId: m.id,
      userId,
      score: Number(score),
      comment,
    });
    res.status(201).json({ message: '评价已提交', review: result.review, newRating: result.newRating });
  } catch (e: any) {
    return err(res, 400, e.message);
  }
});

// --- 获取评价 (公开) ---
app.get('/api/merchants/:id/reviews', async (req: Request, res: Response) => {
  try {
    const result = await getReviews(req.params.id);
    res.json(result);
  } catch (e: any) {
    return err(res, 404, e.message);
  }
});

// ==================== 关注/粉丝系统接口 ====================

/**
 * POST /api/merchants/:id/follow
 * 关注商家（需登录）
 */
app.post('/api/merchants/:id/follow', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const merchantId = req.params.id;

  try {
    // 检查商家是否存在
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      return err(res, 404, '商家不存在');
    }

    const success = await followMerchant(userId, merchantId);
    if (!success) {
      return err(res, 500, '关注失败');
    }

    res.json({ message: '关注成功', merchantId });
  } catch (e: any) {
    console.error('关注商家错误:', e);
    return err(res, 500, e.message || '关注失败');
  }
});

/**
 * DELETE /api/merchants/:id/follow
 * 取消关注商家（需登录）
 */
app.delete('/api/merchants/:id/follow', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const merchantId = req.params.id;

  try {
    const success = await unfollowMerchant(userId, merchantId);
    if (!success) {
      return err(res, 500, '取消关注失败');
    }

    res.json({ message: '已取消关注', merchantId });
  } catch (e: any) {
    console.error('取消关注错误:', e);
    return err(res, 500, '取消关注失败');
  }
});

/**
 * GET /api/merchants/:id/followers
 * 获取商家粉丝列表（商家自己看）
 */
app.get('/api/merchants/:id/followers', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const merchantId = req.params.id;

  try {
    // 验证是否是商家本人
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      return err(res, 404, '商家不存在');
    }

    if (merchant.userId !== userId) {
      return err(res, 403, '无权查看粉丝列表');
    }

    const followers = await getMerchantFollowers(merchantId);
    res.json({ count: followers.length, followers });
  } catch (e: any) {
    console.error('获取粉丝列表错误:', e);
    return err(res, 500, '获取粉丝列表失败');
  }
});

/**
 * GET /api/user/following
 * 获取我关注的商家列表（需登录）
 */
app.get('/api/user/following', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  try {
    const merchantIds = await getFollowedMerchants(userId);
    
    // 获取商家详细信息
    const merchants = await Promise.all(
      merchantIds.map(id => getMerchant(id))
    );

    res.json({ 
      count: merchantIds.length, 
      merchants: merchants.filter(m => m !== undefined) 
    });
  } catch (e: any) {
    console.error('获取关注列表错误:', e);
    return err(res, 500, '获取关注列表失败');
  }
});

/**
 * GET /api/merchants/:id/is-following
 * 检查是否已关注某商家（需登录）
 */
app.get('/api/merchants/:id/is-following', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const merchantId = req.params.id;

  try {
    const following = await isFollowing(userId, merchantId);
    res.json({ following, merchantId });
  } catch (e: any) {
    console.error('检查关注状态错误:', e);
    return err(res, 500, '检查关注状态失败');
  }
});

// ==================== 位置日程系统接口 ====================

/**
 * GET /api/merchants/:id/schedules
 * 获取商家位置日程（公开）
 */
app.get('/api/merchants/:id/schedules', async (req: Request, res: Response) => {
  const merchantId = req.params.id;

  try {
    const schedules = await getMerchantSchedules(merchantId);
    res.json({ count: schedules.length, schedules });
  } catch (e: any) {
    console.error('获取日程列表错误:', e);
    return err(res, 500, '获取日程列表失败');
  }
});

/**
 * PUT /api/merchant/schedules
 * 设置/更新日程（商家自己的）
 * 请求体: { dayOfWeek: 0-6, lat, lng, address?, openTime: "HH:MM", closeTime: "HH:MM", enabled: boolean }
 */
app.put('/api/merchant/schedules', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权操作');
    }

    const { dayOfWeek, lat, lng, address, openTime, closeTime, enabled } = req.body;

    // 参数校验
    if (typeof dayOfWeek !== 'number' || dayOfWeek < 0 || dayOfWeek > 6) {
      return err(res, 400, 'dayOfWeek 必须是 0-6 之间的数字');
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return err(res, 400, 'lat/lng 必须是数字');
    }
    if (!openTime || !closeTime) {
      return err(res, 400, 'openTime/closeTime 必填');
    }

    const schedule = await upsertMerchantSchedule(merchantId, {
      dayOfWeek,
      lat,
      lng,
      address,
      openTime,
      closeTime,
      enabled: enabled !== false
    });

    if (!schedule) {
      return err(res, 500, '更新日程失败');
    }

    res.json({ message: '日程已更新', schedule });
  } catch (e: any) {
    console.error('更新日程错误:', e);
    return err(res, 500, '更新日程失败');
  }
});

/**
 * DELETE /api/merchant/schedules/:dayOfWeek
 * 删除某天日程（商家自己的）
 */
app.delete('/api/merchant/schedules/:dayOfWeek', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;
  const dayOfWeek = parseInt(req.params.dayOfWeek);

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  // 参数校验
  if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return err(res, 400, 'dayOfWeek 必须是 0-6 之间的数字');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权操作');
    }

    const success = await deleteMerchantSchedule(merchantId, dayOfWeek);
    if (!success) {
      return err(res, 500, '删除日程失败');
    }

    res.json({ message: '日程已删除', dayOfWeek });
  } catch (e: any) {
    console.error('删除日程错误:', e);
    return err(res, 500, '删除日程失败');
  }
});

/**
 * POST /api/merchant/actual-location
 * 开工时更新GPS实际位置（商家自己的）
 * 请求体: { lat, lng }
 */
app.post('/api/merchant/actual-location', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;
  const { lat, lng } = req.body;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  // 参数校验
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return err(res, 400, 'lat/lng 必须是数字');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权操作');
    }

    const success = await updateActualLocation(merchantId, lat, lng);
    if (!success) {
      return err(res, 500, '更新位置失败');
    }

    res.json({ message: '位置已更新', lat, lng });
  } catch (e: any) {
    console.error('更新位置错误:', e);
    return err(res, 500, '更新位置失败');
  }
});

// ==================== 订单接口 ====================

/**
 * POST /api/orders
 * 买家下单（需登录）
 * 请求体: { merchantId, items: [{name, qty, price, note?}], tableNumber?, pickupMethod?, note? }
 */
app.post('/api/orders', authMiddleware, async (req: Request, res: Response) => {
  const { merchantId, items, tableNumber, pickupMethod } = req.body;
  // 输入消毒
  const note = req.body.note ? sanitizeInput(req.body.note, 500) : '';
  
  const user = (req as any).user;
  const userId = (req as any).userId;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  // 参数校验
  if (!merchantId) return err(res, 400, 'merchantId 必填');
  if (!items || !Array.isArray(items) || items.length === 0) {
    return err(res, 400, 'items 必须是非空数组');
  }

  // 校验每个商品项
  for (const item of items) {
    if (!item.name || typeof item.qty !== 'number' || item.qty <= 0) {
      return err(res, 400, '每个商品项必须有 name 和有效的 qty');
    }
    if (typeof item.price !== 'number' || item.price < 0) {
      return err(res, 400, '每个商品项必须有有效的 price');
    }
  }

  try {
    // 检查商户是否存在且在线
    const merchant = await getMerchant(merchantId);
    if (!merchant) return err(res, 404, '商户不存在');
    if (!merchant.online) return err(res, 400, '商户当前不在线，无法下单');

    // 检查商户账号状态
    if (merchant.accountStatus === 'banned' || merchant.accountStatus === 'suspended' || merchant.accountStatus === 'expired') {
      return err(res, 403, '商家账号已停权/到期，无法下单');
    }

    // 验证取餐方式
    const selectedPickupMethod = pickupMethod || 'self_pickup';
    const validation = await validatePickupMethod(merchantId, selectedPickupMethod);
    if (!validation.valid) {
      return err(res, 400, '无效的取餐方式');
    }

    // 如果需要桌号但未提供，返回错误
    if (validation.requireTableNumber && !tableNumber) {
      return err(res, 400, '该取餐方式需要提供桌号');
    }

    // 为每个订单项添加 stationIds（用于厨房工位过滤）
    const menuItems = merchant.menuItems || [];
    const itemsWithStationIds = items.map(item => {
      // 根据菜品名称查找对应的菜单项
      const menuItem = menuItems.find(m => m.name === item.name);
      return {
        ...item,
        stationIds: menuItem?.stationIds || undefined
      };
    });

    // 创建订单
    const order = await createOrder({
      merchantId,
      userId,
      items: itemsWithStationIds as OrderItem[],
      tableNumber: tableNumber || null,
      pickupMethod: selectedPickupMethod,
      note,
    });

    // 发送订单创建事件（通知商家）
    emitOrderEvent({
      type: 'order_created',
      orderId: order.id,
      merchantId,
      userId,
      data: order,
    });

    console.log(`📦 新订单创建: ${order.id}, 商户: ${merchantId}, 用户: ${userId}`);
    res.status(201).json({ message: '下单成功', order });
  } catch (e: any) {
    console.error('下单错误:', e);
    return err(res, 500, e.message || '下单失败');
  }
});

/**
 * GET /api/orders/my
 * 买家获取自己的订单列表（需登录）
 */
app.get('/api/orders/my', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;

  try {
    const orders = await getOrdersByUser(userId);
    res.json({ count: orders.length, orders });
  } catch (e: any) {
    console.error('获取用户订单错误:', e);
    return err(res, 500, '获取订单失败');
  }
});

/**
 * GET /api/orders/merchant
 * 商家获取自己店的订单列表（需登录+验证是商家）
 * 查询参数: ?status=pending|accepted|preparing|ready|picked_up|rejected
 */
app.get('/api/orders/merchant', authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userId = (req as any).userId;
  const status = req.query.status as OrderStatus | undefined;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权访问');
    }

    // 获取商家信息并检查账号状态
    const merchant = await getMerchant(merchantId);
    if (merchant && (merchant.accountStatus === 'banned' || merchant.accountStatus === 'suspended' || merchant.accountStatus === 'expired')) {
      return err(res, 403, '商家账号已停权/到期，无法操作');
    }

    // 获取订单列表
    const orders = await getOrdersByMerchant(merchantId, status);
    res.json({ count: orders.length, merchantId, orders });
  } catch (e: any) {
    console.error('获取商家订单错误:', e);
    return err(res, 500, '获取订单失败');
  }
});

/**
 * GET /api/orders/:id
 * 获取订单详情
 */
app.get('/api/orders/:id', authMiddleware, async (req: Request, res: Response) => {
  const orderId = req.params.id;
  const userId = (req as any).userId;

  try {
    const order = await getOrder(orderId);
    if (!order) return err(res, 404, '订单不存在');

    // 验证权限：只有订单所有者或商家可以查看
    const merchantId = await getUserMerchantId(userId);
    if (order.userId !== userId && order.merchantId !== merchantId) {
      return err(res, 403, '无权查看此订单');
    }

    res.json(order);
  } catch (e: any) {
    console.error('获取订单详情错误:', e);
    return err(res, 500, '获取订单失败');
  }
});

/**
 * PATCH /api/orders/:id/status
 * 更新订单状态（商家操作）
 * 请求体: { status: 'accepted'|'rejected'|'preparing'|'ready'|'picked_up' }
 */
app.patch('/api/orders/:id/status', authMiddleware, async (req: Request, res: Response) => {
  const orderId = req.params.id;
  const user = (req as any).user;
  const userId = (req as any).userId;
  const { status } = req.body;

  // 账号状态检查
  if (user.accountStatus === 'banned') {
    return err(res, 403, '账号已被封禁');
  }
  if (user.accountStatus === 'suspended') {
    return err(res, 403, '账号已被停权，请联系管理员');
  }

  // 参数校验
  const validStatuses: OrderStatus[] = ['accepted', 'rejected', 'preparing', 'ready', 'picked_up'];
  if (!status || !validStatuses.includes(status)) {
    return err(res, 400, `status 必须是: ${validStatuses.join(', ')}`);
  }

  try {
    // 验证用户是否是商家
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权操作');
    }

    // 获取商家信息并检查账号状态
    const merchant = await getMerchant(merchantId);
    if (merchant && (merchant.accountStatus === 'banned' || merchant.accountStatus === 'suspended' || merchant.accountStatus === 'expired')) {
      return err(res, 403, '商家账号已停权/到期，无法操作');
    }

    // 更新订单状态
    const order = await updateOrderStatus(orderId, status, merchantId);

    // 发送订单更新事件（通知买家）
    emitOrderEvent({
      type: 'order_status_changed',
      orderId: order.id,
      merchantId: order.merchantId,
      userId: order.userId,
      data: order,
    });

    console.log(`📝 订单状态更新: ${order.id} → ${status}`);
    res.json({ message: '状态已更新', order });
  } catch (e: any) {
    console.error('更新订单状态错误:', e);
    return err(res, 400, e.message);
  }
});

/**
 * PATCH /api/orders/:id/cancel
 * 买家取消订单（仅pending状态可取消）
 */
app.patch('/api/orders/:id/cancel', authMiddleware, async (req: Request, res: Response) => {
  const orderId = req.params.id;
  const userId = (req as any).userId;

  try {
    const order = await cancelOrder(orderId, userId);

    // 通知商家订单已取消
    emitOrderEvent({
      type: 'order_status_changed',
      orderId: order.id,
      merchantId: order.merchantId,
      userId: order.userId,
      data: order,
    });

    console.log(`❌ 订单已取消: ${order.id}, 用户: ${userId}`);
    res.json({ message: '订单已取消', order });
  } catch (e: any) {
    console.error('取消订单错误:', e);
    return err(res, 400, e.message);
  }
});

/**
 * GET /api/orders/merchant/stream
 * SSE 实时推送新订单（商家监听）
 * ⚠️ 必须在 /api/orders/:id/stream 之前注册，否则 "merchant" 会被当作 :id
 * 查询参数: ?station=工位ID (可选)
 */
app.get('/api/orders/merchant/stream', authMiddleware, async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  const stationId = req.query.station as string | undefined;

  try {
    const merchantId = await getUserMerchantId(userId);
    if (!merchantId) {
      return err(res, 403, '您不是商家，无权订阅');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected', merchantId, stationId })}\n\n`);

    const listener = (event: OrderEvent) => {
      if (event.merchantId === merchantId) {
        // 只对 order_created 事件应用工位过滤
        // order_status_changed 和 order_updated 事件应该广播到所有客户端，让它们自行更新
        if (stationId && event.data && event.type === 'order_created') {
          const order = event.data;
          // 检查订单是否有符合条件的菜品
          // 如果菜品的stationIds为空，表示推送到所有工位
          // 如果菜品的stationIds包含当前stationId，也推送
          const hasRelevantItem = (order.items || []).some((item: any) => {
            // stationIds为空或undefined，表示推送到所有工位
            if (!item.stationIds || item.stationIds.length === 0) {
              return true;
            }
            // stationIds包含当前工位
            return item.stationIds.includes(stationId);
          });
          
          if (!hasRelevantItem) {
            return; // 不推送此订单创建事件
          }
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    orderEventBus.on(`merchant:${merchantId}`, listener);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, SSE_HEARTBEAT_INTERVAL);

    const cleanup = () => {
      orderEventBus.off(`merchant:${merchantId}`, listener);
      clearInterval(heartbeat);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);

  } catch (e: any) {
    console.error('商家 SSE 订阅错误:', e);
    return err(res, 500, '订阅失败');
  }
});

/**
 * GET /api/orders/:id/stream
 * SSE 实时推送订单状态变化（买家监听）
 */
app.get('/api/orders/:id/stream', authMiddleware, async (req: Request, res: Response) => {
  const orderId = req.params.id;
  const userId = (req as any).userId;

  try {
    const order = await getOrder(orderId);
    if (!order) {
      return err(res, 404, '订单不存在');
    }
    if (order.userId !== userId) {
      return err(res, 403, '无权订阅此订单');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected', order })}\n\n`);

    const listener = (event: OrderEvent) => {
      if (event.orderId === orderId) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    };

    orderEventBus.on(`order:${orderId}`, listener);

    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, SSE_HEARTBEAT_INTERVAL);

    const cleanup = () => {
      orderEventBus.off(`order:${orderId}`, listener);
      clearInterval(heartbeat);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);

  } catch (e: any) {
    console.error('SSE 订阅错误:', e);
    return err(res, 500, '订阅失败');
  }
});

// ==================== Admin 管理后台接口 ====================

// 所有admin路由都需要authMiddleware + adminMiddleware

/**
 * GET /api/admin/stats
 * 平台数据总览
 */
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const stats = await getAdminStats();
    res.json(stats);
  } catch (e: any) {
    console.error('获取统计数据错误:', e);
    return err(res, 500, '获取统计数据失败');
  }
});

/**
 * GET /api/admin/users
 * 用户列表（分页）
 */
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const limit = parseInt(String(req.query.limit)) || 20;

    const result = await getAllUsers(page, limit);
    res.json({
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
      users: result.users.map(u => {
        const { passwordHash, ...userWithoutPassword } = u;
        return userWithoutPassword;
      }),
    });
  } catch (e: any) {
    console.error('获取用户列表错误:', e);
    return err(res, 500, '获取用户列表失败');
  }
});

/**
 * GET /api/admin/merchants
 * 商户列表（分页，含统计）
 */
app.get('/api/admin/merchants', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const limit = parseInt(String(req.query.limit)) || 20;

    const result = await getAllMerchantsAdmin(page, limit);
    res.json({
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
      merchants: result.merchants,
    });
  } catch (e: any) {
    console.error('获取商户列表错误:', e);
    return err(res, 500, '获取商户列表失败');
  }
});

/**
 * GET /api/admin/orders
 * 订单列表（分页，可筛选状态）
 */
app.get('/api/admin/orders', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const limit = parseInt(String(req.query.limit)) || 20;
    const status = req.query.status as OrderStatus | undefined;

    const result = await getAllOrdersAdmin(page, limit, status);
    res.json({
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
      orders: result.orders,
    });
  } catch (e: any) {
    console.error('获取订单列表错误:', e);
    return err(res, 500, '获取订单列表失败');
  }
});

/**
 * PATCH /api/admin/merchants/:id/ban
 * 封禁商户
 */
app.patch('/api/admin/merchants/:id/ban', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const merchantId = req.params.id;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string') {
    return err(res, 400, '封禁原因必填');
  }

  try {
    // 检查商户是否存在
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      return err(res, 404, '商户不存在');
    }

    // 执行封禁
    const success = await banMerchant(merchantId, reason);
    if (!success) {
      return err(res, 500, '封禁失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'ban_merchant', 'merchant', merchantId, { reason, merchantName: merchant.name });

    res.json({ message: '商户已封禁', merchantId, reason });
  } catch (e: any) {
    console.error('封禁商户错误:', e);
    return err(res, 500, '封禁商户失败');
  }
});

/**
 * PATCH /api/admin/merchants/:id/unban
 * 解封商户
 */
app.patch('/api/admin/merchants/:id/unban', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const merchantId = req.params.id;

  try {
    // 检查商户是否存在
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      return err(res, 404, '商户不存在');
    }

    // 执行解封
    const success = await unbanMerchant(merchantId);
    if (!success) {
      return err(res, 500, '解封失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'unban_merchant', 'merchant', merchantId, { merchantName: merchant.name });

    res.json({ message: '商户已解封', merchantId });
  } catch (e: any) {
    console.error('解封商户错误:', e);
    return err(res, 500, '解封商户失败');
  }
});

/**
 * PATCH /api/admin/users/:id/ban
 * 封禁用户
 */
app.patch('/api/admin/users/:id/ban', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const userId = req.params.id;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string') {
    return err(res, 400, '封禁原因必填');
  }

  try {
    // 执行封禁
    const success = await banUser(userId, reason);
    if (!success) {
      return err(res, 500, '封禁失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'ban_user', 'user', userId, { reason });

    res.json({ message: '用户已封禁', userId, reason });
  } catch (e: any) {
    console.error('封禁用户错误:', e);
    return err(res, 500, '封禁用户失败');
  }
});

/**
 * PATCH /api/admin/users/:id/unban
 * 解封用户
 */
app.patch('/api/admin/users/:id/unban', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const userId = req.params.id;

  try {
    // 执行解封
    const success = await unbanUser(userId);
    if (!success) {
      return err(res, 500, '解封失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'unban_user', 'user', userId, {});

    res.json({ message: '用户已解封', userId });
  } catch (e: any) {
    console.error('解封用户错误:', e);
    return err(res, 500, '解封用户失败');
  }
});

/**
 * PATCH /api/admin/merchants/:id/suspend
 * 停权商家
 */
app.patch('/api/admin/merchants/:id/suspend', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const merchantId = req.params.id;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string') {
    return err(res, 400, '停权原因必填');
  }

  try {
    // 检查商户是否存在
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      return err(res, 404, '商户不存在');
    }

    // 执行停权
    const success = await suspendMerchant(merchantId, reason);
    if (!success) {
      return err(res, 500, '停权失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'suspend_merchant', 'merchant', merchantId, { reason, merchantName: merchant.name });

    res.json({ message: '商户已停权', merchantId, reason });
  } catch (e: any) {
    console.error('停权商户错误:', e);
    return err(res, 500, '停权商户失败');
  }
});

/**
 * PATCH /api/admin/merchants/:id/unsuspend
 * 解除商家停权
 */
app.patch('/api/admin/merchants/:id/unsuspend', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const merchantId = req.params.id;

  try {
    // 检查商户是否存在
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      return err(res, 404, '商户不存在');
    }

    // 执行解除停权
    const success = await unsuspendMerchant(merchantId);
    if (!success) {
      return err(res, 500, '解除停权失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'unsuspend_merchant', 'merchant', merchantId, { merchantName: merchant.name });

    res.json({ message: '商户已解除停权', merchantId });
  } catch (e: any) {
    console.error('解除商家停权错误:', e);
    return err(res, 500, '解除商家停权失败');
  }
});

/**
 * PATCH /api/admin/users/:id/suspend
 * 停权用户
 */
app.patch('/api/admin/users/:id/suspend', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const userId = req.params.id;
  const { reason } = req.body;

  if (!reason || typeof reason !== 'string') {
    return err(res, 400, '停权原因必填');
  }

  try {
    // 执行停权
    const success = await suspendUser(userId, reason);
    if (!success) {
      return err(res, 500, '停权失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'suspend_user', 'user', userId, { reason });

    res.json({ message: '用户已停权', userId, reason });
  } catch (e: any) {
    console.error('停权用户错误:', e);
    return err(res, 500, '停权用户失败');
  }
});

/**
 * PATCH /api/admin/users/:id/unsuspend
 * 解除用户停权
 */
app.patch('/api/admin/users/:id/unsuspend', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const userId = req.params.id;

  try {
    // 执行解除停权
    const success = await unsuspendUser(userId);
    if (!success) {
      return err(res, 500, '解除停权失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'unsuspend_user', 'user', userId, {});

    res.json({ message: '用户已解除停权', userId });
  } catch (e: any) {
    console.error('解除用户停权错误:', e);
    return err(res, 500, '解除用户停权失败');
  }
});

/**
 * PATCH /api/admin/merchants/:id/plan
 * 更新商家套餐
 */
app.patch('/api/admin/merchants/:id/plan', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const merchantId = req.params.id;
  const { plan, expiresAt } = req.body;

  if (!plan || !['free', 'pro'].includes(plan)) {
    return err(res, 400, 'plan 必须是 free 或 pro');
  }

  try {
    // 检查商户是否存在
    const merchant = await getMerchant(merchantId);
    if (!merchant) {
      return err(res, 404, '商户不存在');
    }

    // 执行更新套餐
    const expiresAtDate = expiresAt ? new Date(expiresAt) : undefined;
    const success = await updateMerchantPlan(merchantId, plan, expiresAtDate);
    if (!success) {
      return err(res, 500, '更新套餐失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'update_merchant_plan', 'merchant', merchantId, { plan, expiresAt, merchantName: merchant.name });

    res.json({ message: '商家套餐已更新', merchantId, plan, expiresAt });
  } catch (e: any) {
    console.error('更新商家套餐错误:', e);
    return err(res, 500, '更新商家套餐失败');
  }
});

/**
 * GET /api/admin/logs
 * 操作日志
 */
app.get('/api/admin/logs', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page)) || 1;
    const limit = parseInt(String(req.query.limit)) || 20;

    const result = await getAdminLogs(page, limit);
    res.json({
      page,
      limit,
      total: result.total,
      totalPages: Math.ceil(result.total / limit),
      logs: result.logs,
    });
  } catch (e: any) {
    console.error('获取操作日志错误:', e);
    return err(res, 500, '获取操作日志失败');
  }
});

/**
 * POST /api/admin/promote
 * 提升用户为admin（需要超级管理员）
 */
app.post('/api/admin/promote', authMiddleware, superAdminMiddleware, async (req: Request, res: Response) => {
  const adminId = (req as any).userId;
  const { userId } = req.body;

  if (!userId) {
    return err(res, 400, 'userId 必填');
  }

  try {
    const success = await promoteUserToAdmin(userId);
    if (!success) {
      return err(res, 500, '提升失败');
    }

    // 记录操作日志
    await logAdminAction(adminId, 'promote_to_admin', 'user', userId, {});

    res.json({ message: '用户已提升为管理员', userId });
  } catch (e: any) {
    console.error('提升用户为管理员错误:', e);
    return err(res, 500, '提升用户为管理员失败');
  }
});

/**
 * GET /api/admin/export/orders
 * 导出订单数据（CSV格式）
 */
app.get('/api/admin/export/orders', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const orders = await getAllOrdersForExport();

    // CSV表头
    const headers = [
      '订单ID', '商户ID', '商户名称', '用户ID', '用户手机',
      '状态', '总金额', '商品', '桌号', '取餐方式', '备注', '创建时间', '更新时间'
    ];

    // 生成CSV内容
    const csvRows = [
      headers.join(','),
      ...orders.map(o => [
        o.id,
        o.merchantId,
        `"${(o.merchantName || '').replace(/"/g, '""')}"`,
        o.userId,
        o.userPhone,
        o.status,
        o.total,
        `"${o.items.replace(/"/g, '""')}"`,
        o.tableNumber,
        o.pickupMethod,
        `"${o.note.replace(/"/g, '""')}"`,
        o.createdAt,
        o.updatedAt,
      ].join(','))
    ];

    // UTF-8 BOM（Excel兼容）
    const BOM = '\uFEFF';
    const csvContent = BOM + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=orders_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csvContent);
  } catch (e: any) {
    console.error('导出订单数据错误:', e);
    return err(res, 500, '导出订单数据失败');
  }
});

/**
 * GET /api/admin/export/merchants
 * 导出商户数据（CSV格式）
 */
app.get('/api/admin/export/merchants', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const merchants = await getAllMerchantsForExport();

    // CSV表头
    const headers = [
      '商户ID', '名称', '类型', '电话', '邮箱', '地址',
      '纬度', '经度', '在线', '评分', '评价数', '订单数', '总收入', '是否封禁', '创建时间'
    ];

    // 生成CSV内容
    const csvRows = [
      headers.join(','),
      ...merchants.map(m => [
        m.id,
        `"${m.name.replace(/"/g, '""')}"`,
        m.type,
        m.phone,
        `"${(m.email || '').replace(/"/g, '""')}"`,
        `"${(m.address || '').replace(/"/g, '""')}"`,
        m.lat,
        m.lng,
        m.online ? '是' : '否',
        m.rating,
        m.reviewCount,
        m.orderCount,
        m.totalRevenue,
        m.banned ? '是' : '否',
        m.createdAt,
      ].join(','))
    ];

    // UTF-8 BOM（Excel兼容）
    const BOM = '\uFEFF';
    const csvContent = BOM + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=merchants_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csvContent);
  } catch (e: any) {
    console.error('导出商户数据错误:', e);
    return err(res, 500, '导出商户数据失败');
  }
});

/**
 * DELETE /api/admin/reviews/:id
 * 删除恶意评论
 */
app.delete('/api/admin/reviews/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const reviewId = req.params.id;
    const { reason } = req.body || {};

    const result = await deleteReview(reviewId);
    if (!result) {
      return err(res, 404, '评论不存在');
    }

    // 记录操作日志
    await logAdminAction(
      (req as any).userId,
      'delete_review',
      'review',
      reviewId,
      { merchant_id: result.merchantId, reason: reason || '管理员删除', original_comment: result.comment }
    );

    res.json({ message: '评论已删除', reviewId });
  } catch (e: any) {
    console.error('删除评论错误:', e);
    return err(res, 500, '删除评论失败');
  }
});

// ==================== 页面路由 ====================
const frontendDir = path.join(__dirname, '..', 'frontend');

app.get('/', (_req: Request, res: Response) => {
  res.sendFile('index.html', { root: frontendDir });
});
app.get('/merchant', (_req: Request, res: Response) => {
  res.sendFile('merchant.html', { root: frontendDir });
});
app.get('/kitchen', (_req: Request, res: Response) => {
  res.sendFile('kitchen.html', { root: frontendDir });
});
app.get('/admin', (_req: Request, res: Response) => {
  res.sendFile('admin.html', { root: frontendDir });
});

// ==================== 前端静态文件 ====================
app.use(express.static(frontendDir));

// ==================== 全局错误处理 ====================

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('服务器错误:', error.message);
  res.status(500).json({ error: '服务器内部错误' });
});

// ==================== MCP Server ====================
import { mountMcpServer } from './mcp-server';

// 挂载 MCP Server 到 /mcp 路径
mountMcpServer(app, '/mcp');

// ==================== 启动 ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  // 初始化管理员账号
  await initAdminAccount();
  
  // 确保 pickup_methods 列存在
  await ensurePickupMethodsColumn();
  
  // 确保 kitchen_stations 列存在
  await ensureKitchenStationsColumn();
  
  // 确保 Phase 2C 字段存在
  await ensurePhase2cColumns();
  
  // 确保 menu-images storage bucket 存在
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.find(b => b.name === 'menu-images')) {
    await supabase.storage.createBucket('menu-images', { public: true, fileSizeLimit: 5 * 1024 * 1024 });
    console.log('📦 已创建 menu-images Storage Bucket');
  }
  
  console.log(`🏪 NearBite API已启动: http://localhost:${PORT}`);
  console.log('');
  console.log('📍 商户接口:');
  console.log('  POST /api/merchants - 商户注册');
  console.log('  GET  /api/merchants - 商户列表');
  console.log('  GET  /api/merchants/nearby - 附近商户');
  console.log('  GET  /api/merchants/:id - 商户详情');
  console.log('  GET  /api/merchants/:id/pickup-methods - 获取商户取餐方式');
  console.log('  PUT  /api/merchant/pickup-methods - 更新取餐方式配置');
  console.log('  PATCH /api/merchants/:id/status - 上线/下线');
  console.log('  PUT  /api/merchants/:id/menu - 更新菜单');
  console.log('  POST /api/merchants/:id/reviews - 提交评价');
  console.log('  GET  /api/merchants/:id/reviews - 获取评价');
  console.log('');
  console.log('❤️ 关注/粉丝接口:');
  console.log('  POST   /api/merchants/:id/follow - 关注商家');
  console.log('  DELETE /api/merchants/:id/follow - 取消关注');
  console.log('  GET    /api/merchants/:id/followers - 获取商家粉丝列表');
  console.log('  GET    /api/user/following - 获取我关注的商家列表');
  console.log('  GET    /api/merchants/:id/is-following - 检查是否已关注');
  console.log('');
  console.log('📅 位置日程接口:');
  console.log('  GET    /api/merchants/:id/schedules - 获取商家位置日程');
  console.log('  PUT    /api/merchant/schedules - 设置/更新日程');
  console.log('  DELETE /api/merchant/schedules/:dayOfWeek - 删除某天日程');
  console.log('  POST   /api/merchant/actual-location - 更新GPS实际位置');
  console.log('');
  console.log('🔐 认证接口:');
  console.log('  POST /api/auth/register - 注册');
  console.log('  POST /api/auth/login - 登录');
  console.log('  GET  /api/auth/me - 获取当前用户');
  console.log('');
  console.log('📦 订单接口:');
  console.log('  POST   /api/orders - 买家下单');
  console.log('  GET    /api/orders/my - 买家获取自己的订单');
  console.log('  GET    /api/orders/merchant - 商家获取订单列表');
  console.log('  GET    /api/orders/:id - 获取订单详情');
  console.log('  PATCH  /api/orders/:id/status - 更新订单状态');
  console.log('  GET    /api/orders/:id/stream - SSE订阅订单状态(买家)');
  console.log('  GET    /api/orders/merchant/stream - SSE订阅新订单(商家)');
  console.log('');
  console.log('👑 Admin管理后台接口:');
  console.log('  GET  /api/admin/stats - 平台数据总览');
  console.log('  GET  /api/admin/users - 用户列表');
  console.log('  GET  /api/admin/merchants - 商户列表');
  console.log('  GET  /api/admin/orders - 订单列表');
  console.log('  PATCH /api/admin/merchants/:id/ban - 封禁商户');
  console.log('  PATCH /api/admin/merchants/:id/unban - 解封商户');
  console.log('  PATCH /api/admin/users/:id/ban - 封禁用户');
  console.log('  PATCH /api/admin/users/:id/unban - 解封用户');
  console.log('  GET  /api/admin/logs - 操作日志');
  console.log('  POST /api/admin/promote - 提升用户为admin');
  console.log('  GET  /api/admin/export/orders - 导出订单CSV');
  console.log('  GET  /api/admin/export/merchants - 导出商户CSV');
});
