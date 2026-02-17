import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
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
} from './database';
import { register, login, authMiddleware, optionalAuthMiddleware } from './auth';

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

// ==================== Express ====================

const app = express();
app.use(cors());
app.use(express.json());

// ==================== 认证接口 ====================

// --- 注册 ---
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { phone, password } = req.body;
  if (!phone || !password) return err(res, 400, 'phone/password 必填');
  if (password.length < 6) return err(res, 400, '密码至少6位');

  try {
    const result = register(phone, password);
    res.status(201).json({ message: '注册成功', token: result.token, user: result.user });
  } catch (e: any) {
    if (e.message.includes('已注册')) {
      return err(res, 400, e.message);
    }
    console.error('注册错误:', e);
    return err(res, 500, '注册失败');
  }
});

// --- 登录 ---
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { phone, password } = req.body;
  if (!phone || !password) return err(res, 400, 'phone/password 必填');

  try {
    const result = login(phone, password);
    res.json({ message: '登录成功', token: result.token, user: result.user });
  } catch (e: any) {
    return err(res, 401, e.message || '手机号或密码错误');
  }
});

// --- 获取当前用户信息 ---
app.get('/api/auth/me', authMiddleware, (req: Request, res: Response) => {
  const user = (req as any).user;
  const { passwordHash, ...userWithoutPassword } = user;
  res.json(userWithoutPassword);
});

// ==================== 商户接口 ====================

// --- 商户注册 (需登录) ---
app.post('/api/merchants', authMiddleware, (req: Request, res: Response) => {
  const { name, type, phone, email, description, location, address } = req.body;
  if (!name || !type || !phone) return err(res, 400, 'name/type/phone 必填');
  if (!location?.lat || !location?.lng) return err(res, 400, 'location{lat,lng} 必填');

  const userId = (req as any).userId;
  const m = createMerchant({
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
});

// --- 附近在线商户 (公开) ---
app.get('/api/merchants/nearby', (req: Request, res: Response) => {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const radius = parseFloat(req.query.radius as string) || 5;

  if (isNaN(lat) || isNaN(lng)) return err(res, 400, 'lat/lng 参数必填');

  const center: Location = { lat, lng };
  const results = getNearbyMerchants(center, radius);

  res.json({ center, radius, count: results.length, merchants: results });
});

// --- 商户列表 (公开) ---
app.get('/api/merchants', (req: Request, res: Response) => {
  const all = getAllMerchants();
  res.json({ count: all.length, merchants: all });
});

// --- 商户详情 (公开) ---
app.get('/api/merchants/:id', (req: Request, res: Response) => {
  const m = getMerchant(req.params.id);
  if (!m) return err(res, 404, '商户不存在');
  res.json(m);
});

// --- 上线/下线 (需登录，支持PATCH和PUT) ---
app.put('/api/merchants/:id/status', authMiddleware, (req: Request, res: Response) => {
  const m = getMerchant(req.params.id);
  if (!m) return err(res, 404, '商户不存在');
  if (m.userId && m.userId !== (req as any).userId) return err(res, 403, '无权操作');
  if (typeof req.body.online !== 'boolean') return err(res, 400, 'online 必须是 boolean');
  const updated = updateMerchantStatus(req.params.id, req.body.online);
  res.json({ message: updated?.online ? '已上线' : '已下线', merchant: updated });
});

app.patch('/api/merchants/:id/status', authMiddleware, (req: Request, res: Response) => {
  const m = getMerchant(req.params.id);
  if (!m) return err(res, 404, '商户不存在');
  
  // 验证商户归属
  if (m.userId && m.userId !== (req as any).userId) {
    return err(res, 403, '无权操作此商户');
  }

  if (typeof req.body.online !== 'boolean') return err(res, 400, 'online 必须是 boolean');
  
  const updated = updateMerchantStatus(req.params.id, req.body.online);
  res.json({ message: updated?.online ? '已上线' : '已下线', merchant: updated });
});

// --- 更新菜单 (需登录，商户自己操作) ---
app.put('/api/merchants/:id/menu', authMiddleware, (req: Request, res: Response) => {
  const m = getMerchant(req.params.id);
  if (!m) return err(res, 404, '商户不存在');
  
  // 验证商户归属
  if (m.userId && m.userId !== (req as any).userId) {
    return err(res, 403, '无权操作此商户');
  }

  const items = req.body.items;
  if (!Array.isArray(items)) return err(res, 400, 'items 必须是数组');

  const updated = updateMenu(req.params.id, items);
  res.json({ message: '菜单已更新', menuItems: updated?.menuItems });
});

// --- 提交评价 (需登录) ---
app.post('/api/merchants/:id/reviews', authMiddleware, (req: Request, res: Response) => {
  const m = getMerchant(req.params.id);
  if (!m) return err(res, 404, '商户不存在');

  const { score, comment } = req.body;
  if (!score || score < 1 || score > 5) return err(res, 400, 'score 必须 1-5');
  if (!comment) return err(res, 400, 'comment 必填');

  const userId = (req as any).userId;
  
  try {
    const result = createReview({
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
app.get('/api/merchants/:id/reviews', (req: Request, res: Response) => {
  try {
    const result = getReviews(req.params.id);
    res.json(result);
  } catch (e: any) {
    return err(res, 404, e.message);
  }
});

// ==================== 全局错误处理 ====================

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('服务器错误:', error.message);
  res.status(500).json({ error: '服务器内部错误' });
});

// ==================== 前端静态文件 ====================
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ==================== 启动 ====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏪 WCP商户API已启动: http://localhost:${PORT}`);
  console.log('接口: POST/GET merchants, PATCH status, PUT menu, POST/GET reviews, GET nearby');
  console.log('认证: POST /api/auth/register, POST /api/auth/login, GET /api/auth/me');
});
