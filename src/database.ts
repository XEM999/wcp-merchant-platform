import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

// ==================== 类型定义 ====================

export interface Location {
  lat: number;
  lng: number;
}

// 厨房工位配置
export interface KitchenStation {
  id: string;        // UUID
  name_zh: string;   // 如 "饮品站"
  name_en: string;   // 如 "Drinks Station"
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  available: boolean;
  imageUrl?: string;
  stationIds?: string[];  // 该菜品推送到哪些工位（空=推送到全部屏幕）
}

export interface Review {
  id: string;
  merchantId: string;
  userId: string;
  score: number;
  comment: string;
  createdAt: Date;
}

export interface Merchant {
  id: string;
  userId?: string;
  name: string;
  type: string;
  phone: string;
  email?: string;
  description?: string;
  location: Location;
  address?: string;
  menuItems: MenuItem[];
  online: boolean;
  rating: number;
  reviewCount: number;
  createdAt: Date;
  // 订阅和账号状态字段
  accountStatus: string; // free_trial, active, expired, suspended, banned
  plan: string; // free, pro
  planExpiresAt?: Date;
  commissionRate: number;
  suspendedAt?: Date;
  suspendedReason?: string;
  bannedAt?: Date;
  banReason?: string;
  // 取餐方式配置
  pickupMethods: PickupMethodConfig[];
  // 厨房工位配置
  kitchenStations: KitchenStation[];
  followerCount?: number;
}

export interface User {
  id: string;
  phone: string;
  passwordHash: string;
  role?: string;
  createdAt: Date;
  // 账号状态字段
  accountStatus: string; // active, suspended, banned
  suspendedAt?: Date;
  suspendedReason?: string;
  bannedAt?: Date;
  banReason?: string;
}

// ==================== Supabase 客户端 ====================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  console.error('Set them in Railway Variables or .env file');
}

// 使用service_role key绕过RLS，加db.schema选项确保正确
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'x-supabase-role': 'service_role',
    },
  },
});

// ==================== 工具函数 ====================

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  // 兼容旧SHA-256哈希（迁移期间）
  if (hash.length === 64 && !hash.startsWith('$2')) {
    const sha256 = crypto.createHash('sha256').update(password).digest('hex');
    return sha256 === hash;
  }
  return bcrypt.compareSync(password, hash);
}

/** Haversine公式：计算两点距离（公里） */
export function haversine(a: Location, b: Location): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ==================== 用户操作 ====================

export async function createUser(phone: string, password: string): Promise<User> {
  // 检查手机号是否已存在
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone)
    .single();

  if (existing) {
    throw new Error('手机号已注册');
  }

  const { data, error } = await supabase
    .from('users')
    .insert({
      phone,
      password_hash: hashPassword(password),
      role: 'user',
    })
    .select()
    .single();

  if (error) throw error;

  return {
    id: data.id,
    phone: data.phone,
    passwordHash: data.password_hash,
    role: data.role,
    createdAt: new Date(data.created_at),
    accountStatus: data.account_status || 'active',
  };
}

export async function getUserByPhone(phone: string): Promise<User | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (error || !data) return undefined;

  return {
    id: data.id,
    phone: data.phone,
    passwordHash: data.password_hash,
    role: data.role,
    createdAt: new Date(data.created_at),
    // 账号状态字段映射
    accountStatus: data.account_status || 'active',
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : undefined,
    suspendedReason: data.suspended_reason || undefined,
    bannedAt: data.banned_at ? new Date(data.banned_at) : undefined,
    banReason: data.ban_reason || undefined,
  };
}

export async function getUserById(id: string): Promise<User | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return undefined;

  return {
    id: data.id,
    phone: data.phone,
    passwordHash: data.password_hash,
    role: data.role,
    createdAt: new Date(data.created_at),
    // 账号状态字段映射
    accountStatus: data.account_status || 'active',
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : undefined,
    suspendedReason: data.suspended_reason || undefined,
    bannedAt: data.banned_at ? new Date(data.banned_at) : undefined,
    banReason: data.ban_reason || undefined,
  };
}

// ==================== 商户操作 ====================

/**
 * 导出 mapMerchantFromDb 用于 server.ts 批量查询
 */
export function mapMerchantFromDb(data: any, menuItems: MenuItem[] = []): Merchant {
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    type: data.type,
    phone: data.phone,
    email: data.email,
    description: data.description,
    location: { lat: data.lat, lng: data.lng },
    address: data.address,
    menuItems,
    online: data.online,
    rating: data.rating || 0,
    reviewCount: data.review_count || 0,
    createdAt: new Date(data.created_at),
    // 订阅和账号状态字段映射
    accountStatus: data.account_status || 'free_trial',
    plan: data.plan || 'free',
    planExpiresAt: data.plan_expires_at ? new Date(data.plan_expires_at) : undefined,
    commissionRate: data.commission_rate || 0,
    suspendedAt: data.suspended_at ? new Date(data.suspended_at) : undefined,
    suspendedReason: data.suspended_reason || undefined,
    bannedAt: data.banned_at ? new Date(data.banned_at) : undefined,
    banReason: data.ban_reason || undefined,
    // 取餐方式配置
    pickupMethods: data.pickup_methods || DEFAULT_PICKUP_METHODS,
    // 厨房工位配置
    kitchenStations: data.kitchen_stations || [],
    followerCount: data.follower_count || 0,
  };
}

export async function createMerchant(data: {
  name: string;
  type: string;
  phone: string;
  email?: string;
  description?: string;
  location: Location;
  address?: string;
  userId?: string;
}): Promise<Merchant> {
  const { data: merchant, error } = await supabase
    .from('merchants')
    .insert({
      user_id: data.userId,
      name: data.name,
      type: data.type,
      phone: data.phone,
      email: data.email,
      description: data.description,
      lat: Number(data.location.lat),
      lng: Number(data.location.lng),
      address: data.address,
      online: false,
      rating: 0,
      review_count: 0,
      account_status: 'free_trial',
      plan: 'free',
      commission_rate: 0.08,
      pickup_methods: DEFAULT_PICKUP_METHODS,
      kitchen_stations: [],
    })
    .select()
    .single();

  if (error) throw error;

  return mapMerchantFromDb(merchant, []);
}

export async function getMerchant(id: string): Promise<Merchant | undefined> {
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !merchant) return undefined;

  // 获取菜单
  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('*')
    .eq('merchant_id', id)
    .order('sort_order', { ascending: true });

  const items: MenuItem[] = (menuItems || []).map((item: any) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    category: item.category,
    available: item.available,
    imageUrl: item.image_url || undefined,
    stationIds: item.station_ids || undefined,
  }));

  return mapMerchantFromDb(merchant, items);
}

export async function getAllMerchants(): Promise<Merchant[]> {
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !merchants) return [];

  // 批量获取所有商户的菜单
  const merchantIds = merchants.map((m: any) => m.id);
  const { data: allMenuItems } = await supabase
    .from('menu_items')
    .select('*')
    .in('merchant_id', merchantIds)
    .order('sort_order', { ascending: true });

  const menuByMerchant: Record<string, MenuItem[]> = {};
  (allMenuItems || []).forEach((item: any) => {
    if (!menuByMerchant[item.merchant_id]) {
      menuByMerchant[item.merchant_id] = [];
    }
    menuByMerchant[item.merchant_id].push({
      id: item.id,
      name: item.name,
      price: item.price,
      category: item.category,
      available: item.available,
      imageUrl: item.image_url || undefined,
      stationIds: item.station_ids || undefined,
    });
  });

  return merchants.map((m: any) => mapMerchantFromDb(m, menuByMerchant[m.id] || []));
}

export async function updateMerchantStatus(id: string, online: boolean): Promise<Merchant | undefined> {
  const { data: merchant, error } = await supabase
    .from('merchants')
    .update({ online, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error || !merchant) return undefined;

  // 获取菜单
  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('*')
    .eq('merchant_id', id)
    .order('sort_order', { ascending: true });

  const items: MenuItem[] = (menuItems || []).map((item: any) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    category: item.category,
    available: item.available,
    imageUrl: item.image_url || undefined,
    stationIds: item.station_ids || undefined,
  }));

  return mapMerchantFromDb(merchant, items);
}

export async function updateMenu(id: string, items: Omit<MenuItem, 'id'>[]): Promise<Merchant | undefined> {
  // 先删除旧菜单
  await supabase.from('menu_items').delete().eq('merchant_id', id);

  // 插入新菜单
  if (items.length > 0) {
    const menuData = items.map((item, index) => ({
      merchant_id: id,
      name: item.name,
      price: Number(item.price),
      category: item.category || null,
      available: item.available !== false,
      sort_order: index,
      station_ids: item.stationIds || null,
    }));

    const { error } = await supabase.from('menu_items').insert(menuData);
    if (error) console.error('Error inserting menu items:', error);
  }

  return getMerchant(id);
}

export async function getNearbyMerchants(center: Location, radiusKm: number): Promise<(Merchant & { distance: number })[]> {
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('*')
    .eq('online', true)
    .eq('suspended', false);

  if (error || !merchants) return [];

  const nearbyMerchants: (Merchant & { distance: number })[] = [];

  for (const m of merchants) {
    const distance = haversine(center, { lat: m.lat, lng: m.lng });
    if (distance <= radiusKm) {
      // 获取菜单
      const { data: menuItems } = await supabase
        .from('menu_items')
        .select('*')
        .eq('merchant_id', m.id)
        .order('sort_order', { ascending: true });

      const items: MenuItem[] = (menuItems || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        category: item.category,
        available: item.available,
        imageUrl: item.image_url || undefined,
        stationIds: item.station_ids || undefined,
      }));

      nearbyMerchants.push({
        ...mapMerchantFromDb(m, items),
        distance,
      });
    }
  }

  return nearbyMerchants.sort((a, b) => a.distance - b.distance);
}

// ==================== 评价操作 ====================

export async function createReview(data: {
  merchantId: string;
  userId: string;
  score: number;
  comment: string;
}): Promise<{ review: Review; newRating: number }> {
  // 检查商户是否存在
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id')
    .eq('id', data.merchantId)
    .single();

  if (merchantError || !merchant) {
    throw new Error('商户不存在');
  }

  if (data.score < 1 || data.score > 5) {
    throw new Error('score 必须 1-5');
  }

  // 插入评价
  const { data: review, error } = await supabase
    .from('reviews')
    .insert({
      merchant_id: data.merchantId,
      user_id: data.userId,
      score: Number(data.score),
      comment: data.comment,
    })
    .select()
    .single();

  if (error) throw error;

  // 计算新评分
  const { data: reviews } = await supabase
    .from('reviews')
    .select('score')
    .eq('merchant_id', data.merchantId);

  const reviewCount = reviews?.length || 0;
  const avgRating = reviewCount > 0
    ? Math.round((reviews!.reduce((s: number, r: any) => s + r.score, 0) / reviewCount) * 10) / 10
    : 0;

  // 更新商户评分
  await supabase
    .from('merchants')
    .update({ rating: avgRating, review_count: reviewCount, updated_at: new Date().toISOString() })
    .eq('id', data.merchantId);

  return {
    review: {
      id: review.id,
      merchantId: review.merchant_id,
      userId: review.user_id,
      score: review.score,
      comment: review.comment,
      createdAt: new Date(review.created_at),
    },
    newRating: avgRating,
  };
}

export async function getReviews(merchantId: string): Promise<{ count: number; rating: number; reviews: Review[] }> {
  // 检查商户是否存在
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('rating, review_count')
    .eq('id', merchantId)
    .single();

  if (merchantError || !merchant) {
    throw new Error('商户不存在');
  }

  const { data: reviews, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const mappedReviews: Review[] = (reviews || []).map((r: any) => ({
    id: r.id,
    merchantId: r.merchant_id,
    userId: r.user_id,
    score: r.score,
    comment: r.comment,
    createdAt: new Date(r.created_at),
  }));

  return {
    count: mappedReviews.length,
    rating: merchant.rating || 0,
    reviews: mappedReviews,
  };
}

// ==================== 评论管理（Admin） ====================

export async function deleteReview(reviewId: string): Promise<{ merchantId: string; comment: string } | null> {
  // 查评论
  const { data: review, error: findErr } = await supabase
    .from('reviews')
    .select('*')
    .eq('id', reviewId)
    .single();

  if (findErr || !review) return null;

  // 删除
  const { error: delErr } = await supabase
    .from('reviews')
    .delete()
    .eq('id', reviewId);

  if (delErr) throw delErr;

  // 重新计算商户评分
  const { data: remaining } = await supabase
    .from('reviews')
    .select('score')
    .eq('merchant_id', review.merchant_id);

  const scores = remaining || [];
  const newRating = scores.length > 0
    ? scores.reduce((sum: number, r: any) => sum + r.score, 0) / scores.length
    : 0;

  await supabase
    .from('merchants')
    .update({ rating: Math.round(newRating * 10) / 10, review_count: scores.length })
    .eq('id', review.merchant_id);

  return { merchantId: review.merchant_id, comment: review.comment };
}

// ==================== 订单类型定义 ====================

/** 订单状态 */
export type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'picked_up' | 'rejected' | 'cancelled';

/** 取餐方式配置 */
export interface PickupMethodConfig {
  id: string;                      // 如 'self_pickup', 'table_delivery', 'door_pickup', 'delivery', 或自定义
  label_zh: string;                // 中文名
  label_en: string;                // 英文名
  enabled: boolean;                // 是否启用
  requireTableNumber: boolean;     // 是否需要填桌号
}

/** 取餐方式（扩展为string，不再限制为联合类型） */
export type PickupMethod = string;

/** 默认取餐方式配置 */
export const DEFAULT_PICKUP_METHODS: PickupMethodConfig[] = [
  { id: 'self_pickup', label_zh: '前台自取', label_en: 'Self Pickup', enabled: true, requireTableNumber: false },
  { id: 'table_delivery', label_zh: '送餐到桌', label_en: 'Table Delivery', enabled: true, requireTableNumber: true }
];

/** 订单项 */
export interface OrderItem {
  name: string;      // 商品名称
  qty: number;       // 数量
  price: number;     // 单价
  note?: string;     // 商品备注
  stationIds?: string[]; // 该菜品推送到哪些工位（用于厨房屏幕过滤）
}

/** 状态历史记录 */
export interface StatusHistory {
  status: OrderStatus;
  timestamp: string; // ISO 时间字符串
}

/** 订单数据结构 */
export interface Order {
  id: string;
  merchantId: string;
  userId: string;
  status: OrderStatus;
  items: OrderItem[];
  tableNumber: string | null;   // null 表示自取
  pickupMethod: PickupMethod;
  note: string;                 // 买家备注
  totalAmount: number;
  statusHistory: StatusHistory[];
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  preparingAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
}

/** 创建订单参数 */
export interface CreateOrderParams {
  merchantId: string;
  userId: string;
  items: OrderItem[];
  tableNumber?: string | null;
  pickupMethod?: PickupMethod;
  note?: string;
}

/** 订单数据库行映射 */
interface OrderDbRow {
  id: string;
  merchant_id: string;
  user_id: string;
  status: OrderStatus;
  items: OrderItem[];
  table_number: string | null;
  pickup_method: PickupMethod;
  note: string;
  total: number;  // 数据库中叫 total
  status_history: StatusHistory[];
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
}

/** 将数据库行映射为 Order 对象 */
function mapOrderFromDb(data: OrderDbRow): Order {
  return {
    id: data.id,
    merchantId: data.merchant_id,
    userId: data.user_id,
    status: data.status,
    items: data.items || [],
    tableNumber: data.table_number,
    pickupMethod: data.pickup_method || 'self',
    note: data.note || '',
    totalAmount: data.total,
    statusHistory: data.status_history || [],
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at || data.created_at),
    acceptedAt: data.accepted_at ? new Date(data.accepted_at) : null,
    preparingAt: data.preparing_at ? new Date(data.preparing_at) : null,
    readyAt: data.ready_at ? new Date(data.ready_at) : null,
    pickedUpAt: data.picked_up_at ? new Date(data.picked_up_at) : null,
  };
}

// ==================== 订单操作 ====================

/**
 * 创建订单
 * @param data 订单数据
 * @returns 创建的订单
 */
export async function createOrder(data: CreateOrderParams): Promise<Order> {
  // 计算总金额
  const totalAmount = data.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  
  // 初始化状态历史
  const statusHistory: StatusHistory[] = [
    { status: 'pending', timestamp: new Date().toISOString() }
  ];

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      merchant_id: data.merchantId,
      user_id: data.userId,
      status: 'pending',
      items: data.items,
      table_number: data.tableNumber || null,
      pickup_method: data.pickupMethod || 'self',
      note: data.note || '',
      total: totalAmount,
      status_history: statusHistory,
    })
    .select()
    .single();

  if (error) {
    console.error('创建订单错误:', error);
    throw new Error(`创建订单失败: ${error.message}`);
  }

  return mapOrderFromDb(order as OrderDbRow);
}

/**
 * 获取单个订单
 * @param orderId 订单ID
 * @returns 订单或 undefined
 */
export async function getOrder(orderId: string): Promise<Order | undefined> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error || !data) return undefined;
  
  return mapOrderFromDb(data as OrderDbRow);
}

/**
 * 商家获取订单列表
 * @param merchantId 商家ID
 * @param status 可选状态过滤
 * @returns 订单列表（按创建时间倒序）
 */
export async function getOrdersByMerchant(
  merchantId: string, 
  status?: OrderStatus
): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    console.error('获取商家订单错误:', error);
    return [];
  }

  return (data || []).map(row => mapOrderFromDb(row as OrderDbRow));
}

/**
 * 买家获取自己的订单
 * @param userId 用户ID
 * @returns 订单列表（按创建时间倒序）
 */
export async function getOrdersByUser(userId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('获取用户订单错误:', error);
    return [];
  }

  return (data || []).map(row => mapOrderFromDb(row as OrderDbRow));
}

/** 状态流转规则 */
const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing'],
  preparing: ['ready'],
  ready: ['picked_up'],
  picked_up: [], // 终态
  rejected: [],  // 终态
  cancelled: [], // 终态（买家取消）
};

/** 状态对应的时间戳字段 */
const STATUS_TIMESTAMP_FIELD: Record<OrderStatus, string> = {
  pending: 'created_at',
  accepted: 'accepted_at',
  preparing: 'preparing_at',
  ready: 'ready_at',
  picked_up: 'picked_up_at',
  rejected: 'updated_at',
  cancelled: 'updated_at',
};

/**
 * 更新订单状态
 * @param orderId 订单ID
 * @param newStatus 新状态
 * @param merchantId 商家ID（用于验证权限）
 * @returns 更新后的订单
 */
export async function updateOrderStatus(
  orderId: string, 
  newStatus: OrderStatus, 
  merchantId: string
): Promise<Order> {
  // 获取当前订单
  const order = await getOrder(orderId);
  if (!order) {
    throw new Error('订单不存在');
  }

  // 验证商家权限
  if (order.merchantId !== merchantId) {
    throw new Error('无权操作此订单');
  }

  // 验证状态流转
  const allowedNextStatuses = STATUS_TRANSITIONS[order.status];
  if (!allowedNextStatuses.includes(newStatus)) {
    throw new Error(`无效的状态流转: ${order.status} → ${newStatus}。允许的下一状态: ${allowedNextStatuses.join(', ') || '无（终态）'}`);
  }

  // 更新状态历史
  const statusHistory = [...order.statusHistory, { 
    status: newStatus, 
    timestamp: new Date().toISOString() 
  }];

  // 构建更新数据
  const updateData: Record<string, any> = {
    status: newStatus,
    status_history: statusHistory,
    updated_at: new Date().toISOString(),
  };

  // 设置对应的时间戳
  const timestampField = STATUS_TIMESTAMP_FIELD[newStatus];
  if (timestampField !== 'created_at' && timestampField !== 'updated_at') {
    updateData[timestampField] = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('orders')
    .update(updateData)
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    console.error('更新订单状态错误:', error);
    throw new Error(`更新订单状态失败: ${error.message}`);
  }

  return mapOrderFromDb(data as OrderDbRow);
}

/**
 * 买家取消订单（只能在pending状态取消）
 */
export async function cancelOrder(orderId: string, userId: string): Promise<Order> {
  const order = await getOrder(orderId);
  if (!order) {
    throw new Error('订单不存在');
  }
  if (order.userId !== userId) {
    throw new Error('无权操作此订单');
  }
  if (order.status !== 'pending') {
    throw new Error('只能取消待接单的订单（商家接单后无法取消）');
  }

  const statusHistory = [...order.statusHistory, { 
    status: 'cancelled' as OrderStatus, 
    timestamp: new Date().toISOString() 
  }];

  const { data, error } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      status_history: statusHistory,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .select()
    .single();

  if (error) throw new Error(`取消订单失败: ${error.message}`);
  return mapOrderFromDb(data as OrderDbRow);
}

/**
 * 检查用户是否是商家
 * @param userId 用户ID
 * @returns 商家ID或null
 */
export async function getUserMerchantId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('merchants')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;
  return data.id;
}

// ==================== Admin 管理后台操作 ====================

/** Admin统计数据 */
export interface AdminStats {
  totalUsers: number;
  totalMerchants: number;
  totalOrders: number;
  totalRevenue: number;
  todayOrders: number;
  todayRevenue: number;
}

/** 用户列表项（包含额外信息） */
export interface UserListItem extends User {
  orderCount: number;
  totalSpent: number;
  banned?: boolean;
  bannedAt?: Date;
  banReason?: string;
}

/** 商户列表项（包含统计信息） */
export interface MerchantListItem extends Merchant {
  orderCount: number;
  totalRevenue: number;
  banned?: boolean;
  bannedAt?: Date;
  banReason?: string;
}

/** 管理员日志 */
export interface AdminLog {
  id: string;
  adminId: string;
  adminPhone?: string;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, any>;
  createdAt: Date;
}

/**
 * 获取平台统计数据
 */
export async function getAdminStats(): Promise<AdminStats> {
  // 获取用户总数
  const { count: totalUsers } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });

  // 获取商户总数
  const { count: totalMerchants } = await supabase
    .from('merchants')
    .select('*', { count: 'exact', head: true });

  // 获取订单总数和总收入
  const { data: orderStats } = await supabase
    .from('orders')
    .select('total');

  const totalOrders = orderStats?.length || 0;
  const totalRevenue = orderStats?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;

  // 获取今日订单数和今日收入
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data: todayOrders } = await supabase
    .from('orders')
    .select('total')
    .gte('created_at', todayISO);

  const todayOrdersCount = todayOrders?.length || 0;
  const todayRevenue = todayOrders?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;

  return {
    totalUsers: totalUsers || 0,
    totalMerchants: totalMerchants || 0,
    totalOrders,
    totalRevenue,
    todayOrders: todayOrdersCount,
    todayRevenue,
  };
}

/**
 * 分页获取所有用户
 */
export async function getAllUsers(page: number = 1, limit: number = 20): Promise<{ users: UserListItem[]; total: number }> {
  const offset = (page - 1) * limit;

  // 获取用户总数
  const { count: total } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });

  // 获取用户列表
  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !users) {
    return { users: [], total: 0 };
  }

  // 获取每个用户的订单统计
  const userIds = users.map(u => u.id);
  const { data: userOrders } = await supabase
    .from('orders')
    .select('user_id, total')
    .in('user_id', userIds);

  // 统计每个用户的订单数和消费金额
  const userStats: Record<string, { orderCount: number; totalSpent: number }> = {};
  (userOrders || []).forEach((order: any) => {
    if (!userStats[order.user_id]) {
      userStats[order.user_id] = { orderCount: 0, totalSpent: 0 };
    }
    userStats[order.user_id].orderCount++;
    userStats[order.user_id].totalSpent += order.total || 0;
  });

  const mappedUsers: UserListItem[] = users.map((u: any) => ({
    id: u.id,
    phone: u.phone,
    passwordHash: u.password_hash,
    role: u.role,
    createdAt: new Date(u.created_at),
    accountStatus: u.account_status || 'active',
    orderCount: userStats[u.id]?.orderCount || 0,
    totalSpent: userStats[u.id]?.totalSpent || 0,
    banned: u.banned || false,
    bannedAt: u.banned_at ? new Date(u.banned_at) : undefined,
    banReason: u.ban_reason || undefined,
  }));

  return { users: mappedUsers, total: total || 0 };
}

/**
 * 分页获取所有订单（管理员视角）
 */
export async function getAllOrdersAdmin(
  page: number = 1, 
  limit: number = 20, 
  status?: OrderStatus
): Promise<{ orders: (Order & { merchantName?: string; userName?: string })[]; total: number }> {
  const offset = (page - 1) * limit;

  // 构建查询
  let query = supabase
    .from('orders')
    .select('*', { count: 'exact' });

  if (status) {
    query = query.eq('status', status);
  }

  // 获取总数
  const { count: total } = await query;

  // 获取分页数据
  let dataQuery = supabase
    .from('orders')
    .select('*');

  if (status) {
    dataQuery = dataQuery.eq('status', status);
  }

  const { data: orders, error } = await dataQuery
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !orders) {
    return { orders: [], total: 0 };
  }

  // 获取商户和用户信息
  const merchantIds = [...new Set(orders.map((o: any) => o.merchant_id))];
  const userIds = [...new Set(orders.map((o: any) => o.user_id))];

  const { data: merchants } = await supabase
    .from('merchants')
    .select('id, name')
    .in('id', merchantIds);

  const { data: users } = await supabase
    .from('users')
    .select('id, phone')
    .in('id', userIds);

  const merchantMap: Record<string, string> = {};
  (merchants || []).forEach((m: any) => {
    merchantMap[m.id] = m.name;
  });

  const userMap: Record<string, string> = {};
  (users || []).forEach((u: any) => {
    userMap[u.id] = u.phone;
  });

  const mappedOrders = orders.map((o: any) => ({
    ...mapOrderFromDb(o as OrderDbRow),
    merchantName: merchantMap[o.merchant_id],
    userName: userMap[o.user_id],
  }));

  return { orders: mappedOrders, total: total || 0 };
}

/**
 * 分页获取所有商户（含统计信息）
 */
export async function getAllMerchantsAdmin(
  page: number = 1, 
  limit: number = 20
): Promise<{ merchants: MerchantListItem[]; total: number }> {
  const offset = (page - 1) * limit;

  // 获取商户总数
  const { count: total } = await supabase
    .from('merchants')
    .select('*', { count: 'exact', head: true });

  // 获取商户列表
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !merchants) {
    return { merchants: [], total: 0 };
  }

  // 获取每个商户的订单统计
  const merchantIds = merchants.map(m => m.id);
  const { data: merchantOrders } = await supabase
    .from('orders')
    .select('merchant_id, total')
    .in('merchant_id', merchantIds);

  // 统计每个商户的订单数和收入
  const merchantStats: Record<string, { orderCount: number; totalRevenue: number }> = {};
  (merchantOrders || []).forEach((order: any) => {
    if (!merchantStats[order.merchant_id]) {
      merchantStats[order.merchant_id] = { orderCount: 0, totalRevenue: 0 };
    }
    merchantStats[order.merchant_id].orderCount++;
    merchantStats[order.merchant_id].totalRevenue += order.total || 0;
  });

  // 获取商户的菜单
  const { data: allMenuItems } = await supabase
    .from('menu_items')
    .select('*')
    .in('merchant_id', merchantIds)
    .order('sort_order', { ascending: true });

  const menuByMerchant: Record<string, MenuItem[]> = {};
  (allMenuItems || []).forEach((item: any) => {
    if (!menuByMerchant[item.merchant_id]) {
      menuByMerchant[item.merchant_id] = [];
    }
    menuByMerchant[item.merchant_id].push({
      id: item.id,
      name: item.name,
      price: item.price,
      category: item.category,
      available: item.available,
      imageUrl: item.image_url || undefined,
      stationIds: item.station_ids || undefined,
    });
  });

  const mappedMerchants: MerchantListItem[] = merchants.map((m: any) => ({
    ...mapMerchantFromDb(m, menuByMerchant[m.id] || []),
    orderCount: merchantStats[m.id]?.orderCount || 0,
    totalRevenue: merchantStats[m.id]?.totalRevenue || 0,
    banned: m.banned || false,
    bannedAt: m.banned_at ? new Date(m.banned_at) : undefined,
    banReason: m.ban_reason || undefined,
  }));

  return { merchants: mappedMerchants, total: total || 0 };
}

/**
 * 封禁商户
 */
export async function banMerchant(merchantId: string, reason: string): Promise<boolean> {
  const { error } = await supabase
    .from('merchants')
    .update({
      online: false,
      banned: true,
      banned_at: new Date().toISOString(),
      ban_reason: reason,
      account_status: 'banned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', merchantId);

  if (error) {
    console.error('封禁商户错误:', error);
    return false;
  }
  return true;
}

/**
 * 解封商户
 */
export async function unbanMerchant(merchantId: string): Promise<boolean> {
  const { error } = await supabase
    .from('merchants')
    .update({
      banned: false,
      banned_at: null,
      ban_reason: null,
      account_status: 'free_trial',
      updated_at: new Date().toISOString(),
    })
    .eq('id', merchantId);

  if (error) {
    console.error('解封商户错误:', error);
    return false;
  }
  return true;
}

/**
 * 封禁用户
 */
export async function banUser(userId: string, reason: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({
      banned: true,
      banned_at: new Date().toISOString(),
      ban_reason: reason,
      account_status: 'banned',
    })
    .eq('id', userId);

  if (error) {
    console.error('封禁用户错误:', error);
    return false;
  }
  return true;
}

/**
 * 解封用户
 */
export async function unbanUser(userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({
      banned: false,
      banned_at: null,
      ban_reason: null,
      account_status: 'active',
    })
    .eq('id', userId);

  if (error) {
    console.error('解封用户错误:', error);
    return false;
  }
  return true;
}

/**
 * 停权商家
 */
export async function suspendMerchant(id: string, reason: string): Promise<boolean> {
  const { error } = await supabase
    .from('merchants')
    .update({
      account_status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspended_reason: reason,
      online: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('停权商家错误:', error);
    return false;
  }
  return true;
}

/**
 * 解除商家停权
 */
export async function unsuspendMerchant(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('merchants')
    .update({
      account_status: 'free_trial',
      suspended_at: null,
      suspended_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    console.error('解除商家停权错误:', error);
    return false;
  }
  return true;
}

/**
 * 停权用户
 */
export async function suspendUser(id: string, reason: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({
      account_status: 'suspended',
      suspended_at: new Date().toISOString(),
      suspended_reason: reason,
    })
    .eq('id', id);

  if (error) {
    console.error('停权用户错误:', error);
    return false;
  }
  return true;
}

/**
 * 解除用户停权
 */
export async function unsuspendUser(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({
      account_status: 'active',
      suspended_at: null,
      suspended_reason: null,
    })
    .eq('id', id);

  if (error) {
    console.error('解除用户停权错误:', error);
    return false;
  }
  return true;
}

/**
 * 更新商家套餐
 */
export async function updateMerchantPlan(id: string, plan: string, expiresAt?: Date): Promise<boolean> {
  const updateData: Record<string, any> = {
    plan,
    account_status: 'active',
    updated_at: new Date().toISOString(),
  };

  if (expiresAt) {
    updateData.plan_expires_at = expiresAt.toISOString();
  }

  const { error } = await supabase
    .from('merchants')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error('更新商家套餐错误:', error);
    return false;
  }
  return true;
}

/**
 * 记录管理员操作日志
 */
export async function logAdminAction(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, any>
): Promise<void> {
  const { error } = await supabase
    .from('admin_logs')
    .insert({
      admin_id: adminId,
      action,
      target_type: targetType,
      target_id: targetId,
      details,
    });

  if (error) {
    console.error('记录管理员日志错误:', error);
  }
}

/**
 * 分页获取管理员操作日志
 */
export async function getAdminLogs(page: number = 1, limit: number = 20): Promise<{ logs: AdminLog[]; total: number }> {
  const offset = (page - 1) * limit;

  // 获取总数
  const { count: total } = await supabase
    .from('admin_logs')
    .select('*', { count: 'exact', head: true });

  // 获取日志列表
  const { data: logs, error } = await supabase
    .from('admin_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !logs) {
    return { logs: [], total: 0 };
  }

  // 获取管理员手机号
  const adminIds = [...new Set(logs.map((l: any) => l.admin_id))];
  const { data: admins } = await supabase
    .from('users')
    .select('id, phone')
    .in('id', adminIds);

  const adminMap: Record<string, string> = {};
  (admins || []).forEach((a: any) => {
    adminMap[a.id] = a.phone;
  });

  const mappedLogs: AdminLog[] = logs.map((l: any) => ({
    id: l.id,
    adminId: l.admin_id,
    adminPhone: adminMap[l.admin_id],
    action: l.action,
    targetType: l.target_type,
    targetId: l.target_id,
    details: l.details || {},
    createdAt: new Date(l.created_at),
  }));

  return { logs: mappedLogs, total: total || 0 };
}

/**
 * 提升用户为管理员
 */
export async function promoteUserToAdmin(userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('users')
    .update({ role: 'admin' })
    .eq('id', userId);

  if (error) {
    console.error('提升用户为管理员错误:', error);
    return false;
  }
  return true;
}

/**
 * 获取所有订单数据（用于导出CSV）
 */
export async function getAllOrdersForExport(): Promise<any[]> {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !orders) {
    return [];
  }

  // 获取商户和用户信息
  const merchantIds = [...new Set(orders.map((o: any) => o.merchant_id))];
  const userIds = [...new Set(orders.map((o: any) => o.user_id))];

  const { data: merchants } = await supabase
    .from('merchants')
    .select('id, name')
    .in('id', merchantIds);

  const { data: users } = await supabase
    .from('users')
    .select('id, phone')
    .in('id', userIds);

  const merchantMap: Record<string, string> = {};
  (merchants || []).forEach((m: any) => {
    merchantMap[m.id] = m.name;
  });

  const userMap: Record<string, string> = {};
  (users || []).forEach((u: any) => {
    userMap[u.id] = u.phone;
  });

  return orders.map((o: any) => ({
    id: o.id,
    merchantId: o.merchant_id,
    merchantName: merchantMap[o.merchant_id] || '',
    userId: o.user_id,
    userPhone: userMap[o.user_id] || '',
    status: o.status,
    total: o.total,
    items: JSON.stringify(o.items),
    tableNumber: o.table_number || '',
    pickupMethod: o.pickup_method,
    note: o.note || '',
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  }));
}

/**
 * 获取所有商户数据（用于导出CSV）
 */
export async function getAllMerchantsForExport(): Promise<any[]> {
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !merchants) {
    return [];
  }

  // 获取每个商户的订单统计
  const merchantIds = merchants.map(m => m.id);
  const { data: merchantOrders } = await supabase
    .from('orders')
    .select('merchant_id, total')
    .in('merchant_id', merchantIds);

  const merchantStats: Record<string, { orderCount: number; totalRevenue: number }> = {};
  (merchantOrders || []).forEach((order: any) => {
    if (!merchantStats[order.merchant_id]) {
      merchantStats[order.merchant_id] = { orderCount: 0, totalRevenue: 0 };
    }
    merchantStats[order.merchant_id].orderCount++;
    merchantStats[order.merchant_id].totalRevenue += order.total || 0;
  });

  return merchants.map((m: any) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    phone: m.phone,
    email: m.email || '',
    address: m.address || '',
    lat: m.lat,
    lng: m.lng,
    online: m.online,
    rating: m.rating || 0,
    reviewCount: m.review_count || 0,
    orderCount: merchantStats[m.id]?.orderCount || 0,
    totalRevenue: merchantStats[m.id]?.totalRevenue || 0,
    banned: m.banned || false,
    createdAt: m.created_at,
  }));
}

/**
 * 初始化管理员账号
 * 启动时检查是否存在admin账号，如果不存在就创建
 */
export async function initAdminAccount(): Promise<void> {
  try {
    // 检查是否已存在指定手机号的admin
    const { data: existingAdmin } = await supabase
      .from('users')
      .select('id')
      .eq('phone', '0210000000')
      .eq('role', 'admin')
      .single();

    if (existingAdmin) {
      console.log('✅ 管理员账号已存在');
      return;
    }

    // 检查手机号是否已被普通用户使用
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, role')
      .eq('phone', '0210000000')
      .single();

    if (existingUser) {
      // 如果已存在但不是admin，提升为admin
      await supabase
        .from('users')
        .update({ role: 'admin' })
        .eq('id', existingUser.id);
      console.log('✅ 已将现有用户提升为管理员');
      return;
    }

    // 创建新的admin账号
    const { error } = await supabase
      .from('users')
      .insert({
        phone: '0210000000',
        password_hash: hashPassword('admin2026'),
        role: 'admin',
      });

    if (error) {
      console.error('❌ 创建管理员账号失败:', error);
    } else {
      console.log('✅ 管理员账号创建成功: 0210000000 / admin2026');
    }
  } catch (err) {
    console.error('初始化管理员账号时出错:', err);
  }
}

// ==================== Supabase Storage 上传 ====================

/**
 * 上传菜品图片到Supabase Storage
 * @param buffer 文件Buffer
 * @param filePath 存储路径（如：merchantId/timestamp_filename.jpg）
 * @param contentType 文件MIME类型
 * @returns 公开URL
 */
export async function uploadMenuImage(buffer: Buffer, filePath: string, contentType: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('menu-images')
    .upload(filePath, buffer, { contentType, upsert: true });

  if (error) throw new Error('图片上传失败: ' + error.message);

  const { data: urlData } = supabase.storage
    .from('menu-images')
    .getPublicUrl(filePath);

  return urlData.publicUrl;
}

// ==================== 取餐方式操作 ====================

/**
 * 获取商户的取餐方式配置
 * @param merchantId 商户ID
 * @returns 取餐方式配置列表
 */
export async function getMerchantPickupMethods(merchantId: string): Promise<PickupMethodConfig[]> {
  const { data, error } = await supabase
    .from('merchants')
    .select('pickup_methods')
    .eq('id', merchantId)
    .single();

  if (error || !data) {
    return DEFAULT_PICKUP_METHODS;
  }

  return data.pickup_methods || DEFAULT_PICKUP_METHODS;
}

/**
 * 更新商户的取餐方式配置
 * @param merchantId 商户ID
 * @param pickupMethods 取餐方式配置列表
 * @returns 是否成功
 */
export async function updateMerchantPickupMethods(
  merchantId: string, 
  pickupMethods: PickupMethodConfig[]
): Promise<boolean> {
  const { error } = await supabase
    .from('merchants')
    .update({ 
      pickup_methods: pickupMethods,
      updated_at: new Date().toISOString()
    })
    .eq('id', merchantId);

  if (error) {
    console.error('更新取餐方式配置错误:', error);
    return false;
  }
  return true;
}

/**
 * 验证取餐方式是否有效
 * @param merchantId 商户ID
 * @param pickupMethodId 取餐方式ID
 * @returns 是否有效，以及是否需要桌号
 */
export async function validatePickupMethod(
  merchantId: string, 
  pickupMethodId: string
): Promise<{ valid: boolean; requireTableNumber: boolean }> {
  const methods = await getMerchantPickupMethods(merchantId);
  const method = methods.find(m => m.id === pickupMethodId && m.enabled);
  
  if (!method) {
    return { valid: false, requireTableNumber: false };
  }
  
  return { valid: true, requireTableNumber: method.requireTableNumber };
}

// ==================== 数据库迁移 ====================

/**
 * 确保merchants表有pickup_methods列
 */
export async function ensurePickupMethodsColumn(): Promise<void> {
  try {
    // 尝试查询一个商户的pickup_methods
    const { error: testError } = await supabase
      .from('merchants')
      .select('pickup_methods')
      .limit(1);
    
    if (!testError) {
      // 列已存在
      console.log('✅ pickup_methods列已存在');
      return;
    }
    
    // 如果列不存在，testError会包含相关信息
    // 使用UPDATE来触发添加列（如果需要）
    // 注意：Supabase PostgreSQL需要手动执行ALTER TABLE
    console.log('⚠️ pickup_methods列可能不存在');
    console.log('请在Supabase SQL编辑器中执行以下SQL:');
    console.log(`
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS pickup_methods JSONB DEFAULT '[{"id":"self_pickup","label_zh":"前台自取","label_en":"Self Pickup","enabled":true,"requireTableNumber":false},{"id":"table_delivery","label_zh":"送餐到桌","label_en":"Table Delivery","enabled":true,"requireTableNumber":true}]'::jsonb;
    `.trim());
    
    // 尝试更新一条记录来添加列（如果数据库支持）
    try {
      await supabase
        .from('merchants')
        .update({ pickup_methods: DEFAULT_PICKUP_METHODS })
        .is('pickup_methods', null)
        .select();
    } catch (e) {
      // 忽略更新错误
    }
  } catch (err) {
    console.log('检查pickup_methods列时出错（可忽略）:', err);
  }
}

// ==================== 厨房工位操作 ====================

/**
 * 获取商户的厨房工位配置
 * @param merchantId 商户ID
 * @returns 工位列表
 */
export async function getMerchantKitchenStations(merchantId: string): Promise<KitchenStation[]> {
  const { data, error } = await supabase
    .from('merchants')
    .select('kitchen_stations')
    .eq('id', merchantId)
    .single();

  if (error || !data) {
    return [];
  }

  return data.kitchen_stations || [];
}

/**
 * 更新商户的厨房工位配置
 * @param merchantId 商户ID
 * @param stations 工位列表
 * @returns 是否成功
 */
export async function updateMerchantKitchenStations(
  merchantId: string, 
  stations: KitchenStation[]
): Promise<boolean> {
  const { error } = await supabase
    .from('merchants')
    .update({ 
      kitchen_stations: stations,
      updated_at: new Date().toISOString()
    })
    .eq('id', merchantId);

  if (error) {
    console.error('更新厨房工位配置错误:', error);
    return false;
  }
  return true;
}

/**
 * 确保merchants表有kitchen_stations列，以及menu_items表有station_ids列
 */
export async function ensureKitchenStationsColumn(): Promise<void> {
  // 1. 检查 merchants.kitchen_stations
  try {
    const { error: testError } = await supabase
      .from('merchants')
      .select('kitchen_stations')
      .limit(1);
    
    if (!testError) {
      console.log('✅ kitchen_stations列已存在');
    } else {
      console.log('⚠️ kitchen_stations列可能不存在');
      console.log('请在Supabase SQL编辑器中执行以下SQL:');
      console.log(`
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kitchen_stations JSONB DEFAULT '[]'::jsonb;
      `.trim());
      
      try {
        await supabase
          .from('merchants')
          .update({ kitchen_stations: [] })
          .is('kitchen_stations', null)
          .select();
      } catch (e) {
        // 忽略更新错误
      }
    }
  } catch (err) {
    console.log('检查kitchen_stations列时出错（可忽略）:', err);
  }

  // 2. 检查 menu_items.station_ids
  try {
    const { error: testError2 } = await supabase
      .from('menu_items')
      .select('station_ids')
      .limit(1);
    
    if (!testError2) {
      console.log('✅ menu_items.station_ids列已存在');
    } else {
      console.log('⚠️ menu_items.station_ids列可能不存在');
      console.log('请在Supabase SQL编辑器中执行以下SQL:');
      console.log(`
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS station_ids JSONB DEFAULT NULL;
      `.trim());
    }
  } catch (err) {
    console.log('检查menu_items.station_ids列时出错（可忽略）:', err);
  }
}

// ==================== 关注/粉丝系统 ====================

/**
 * 关注商家
 * @param userId 用户ID
 * @param merchantId 商家ID
 * @returns 是否成功
 */
export async function followMerchant(userId: string, merchantId: string): Promise<boolean> {
  try {
    // 检查商家是否存在
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id')
      .eq('id', merchantId)
      .single();

    if (merchantError || !merchant) {
      throw new Error('商家不存在');
    }

    // 插入关注记录（使用 upsert 避免重复关注）
    const { error: followError } = await supabase
      .from('follows')
      .upsert(
        { user_id: userId, merchant_id: merchantId },
        { onConflict: 'user_id,merchant_id', ignoreDuplicates: true }
      );

    if (followError) {
      console.error('关注商家错误:', followError);
      return false;
    }

    // 直接使用 SQL 原子更新 follower_count（使用 COALESCE 避免 NULL 问题）
    const { error: updateError } = await supabase.rpc('increment_follower_count_safe', { 
      merchant_id: merchantId 
    });
    
    if (updateError) {
      // 如果 RPC 函数不存在，使用简单的 UPDATE
      // 注意：这不如原子操作准确，但在大多数情况下足够
      try {
        // 先获取当前值
        const { data: m } = await supabase
          .from('merchants')
          .select('follower_count')
          .eq('id', merchantId)
          .single();
        
        const newCount = (m?.follower_count || 0) + 1;
        
        await supabase
          .from('merchants')
          .update({ follower_count: newCount })
          .eq('id', merchantId);
      } catch (e) {
        console.warn('粉丝计数更新警告:', e);
      }
    }

    return true;
  } catch (e) {
    console.error('关注商家错误:', e);
    return false;
  }
}

/**
 * 取消关注商家
 * @param userId 用户ID
 * @param merchantId 商家ID
 * @returns 是否成功
 */
export async function unfollowMerchant(userId: string, merchantId: string): Promise<boolean> {
  try {
    // 删除关注记录
    const { error: unfollowError, data } = await supabase
      .from('follows')
      .delete()
      .eq('user_id', userId)
      .eq('merchant_id', merchantId)
      .select();

    if (unfollowError) {
      console.error('取消关注错误:', unfollowError);
      return false;
    }

    // 只有实际删除了记录才更新计数
    if (data && data.length > 0) {
      // 使用 RPC 原子更新
      const { error: rpcError } = await supabase.rpc('decrement_follower_count_safe', { 
        merchant_id: merchantId 
      });
      
      if (rpcError) {
        // 如果 RPC 不存在，使用简单的 UPDATE（确保不小于0）
        try {
          // 先获取当前值
          const { data: m } = await supabase
            .from('merchants')
            .select('follower_count')
            .eq('id', merchantId)
            .single();
          
          const newCount = Math.max(0, (m?.follower_count || 0) - 1);
          
          await supabase
            .from('merchants')
            .update({ follower_count: newCount })
            .eq('id', merchantId);
        } catch (e) {
          console.warn('粉丝计数更新警告:', e);
        }
      }
    }

    return true;
  } catch (e) {
    console.error('取消关注错误:', e);
    return false;
  }
}

/**
 * 获取用户关注的所有商家ID列表
 * @param userId 用户ID
 * @returns 商家ID数组
 */
export async function getFollowedMerchants(userId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('merchant_id')
      .eq('user_id', userId);

    if (error) {
      console.error('获取关注列表错误:', error);
      return [];
    }

    return (data || []).map(f => f.merchant_id);
  } catch (e) {
    console.error('获取关注列表错误:', e);
    return [];
  }
}

/**
 * 获取商家的所有粉丝
 * @param merchantId 商家ID
 * @returns 粉丝列表
 */
export async function getMerchantFollowers(merchantId: string): Promise<{userId: string, createdAt: Date}[]> {
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('user_id, created_at')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取粉丝列表错误:', error);
      return [];
    }

    return (data || []).map(f => ({
      userId: f.user_id,
      createdAt: new Date(f.created_at)
    }));
  } catch (e) {
    console.error('获取粉丝列表错误:', e);
    return [];
  }
}

/**
 * 检查用户是否已关注某商家
 * @param userId 用户ID
 * @param merchantId 商家ID
 * @returns 是否已关注
 */
export async function isFollowing(userId: string, merchantId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('follows')
      .select('id')
      .eq('user_id', userId)
      .eq('merchant_id', merchantId)
      .single();

    if (error) {
      return false;
    }

    return !!data;
  } catch {
    return false;
  }
}

// ==================== 位置日程系统 ====================

/** 商家日程配置 */
export interface MerchantSchedule {
  id: string;
  merchantId: string;
  dayOfWeek: number;  // 0-6 (0=周日)
  lat: number;
  lng: number;
  address?: string;
  openTime: string;   // "HH:MM"
  closeTime: string;  // "HH:MM"
  enabled: boolean;
}

/**
 * 获取商家的所有日程
 * @param merchantId 商家ID
 * @returns 日程列表
 */
export async function getMerchantSchedules(merchantId: string): Promise<MerchantSchedule[]> {
  try {
    const { data, error } = await supabase
      .from('merchant_schedules')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('day_of_week', { ascending: true });

    if (error) {
      console.error('获取日程列表错误:', error);
      return [];
    }

    return (data || []).map(s => ({
      id: s.id,
      merchantId: s.merchant_id,
      dayOfWeek: s.day_of_week,
      lat: s.lat,
      lng: s.lng,
      address: s.address || undefined,
      openTime: s.open_time,
      closeTime: s.close_time,
      enabled: s.enabled
    }));
  } catch (e) {
    console.error('获取日程列表错误:', e);
    return [];
  }
}

/**
 * 创建或更新某天的日程（按day_of_week upsert）
 * @param merchantId 商家ID
 * @param schedule 日程数据
 * @returns 创建/更新后的日程
 */
export async function upsertMerchantSchedule(
  merchantId: string, 
  schedule: Omit<MerchantSchedule, 'id' | 'merchantId'>
): Promise<MerchantSchedule | null> {
  try {
    const { data, error } = await supabase
      .from('merchant_schedules')
      .upsert({
        merchant_id: merchantId,
        day_of_week: schedule.dayOfWeek,
        lat: schedule.lat,
        lng: schedule.lng,
        address: schedule.address || null,
        open_time: schedule.openTime,
        close_time: schedule.closeTime,
        enabled: schedule.enabled,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'merchant_id,day_of_week'
      })
      .select()
      .single();

    if (error) {
      console.error('更新日程错误:', error);
      return null;
    }

    return {
      id: data.id,
      merchantId: data.merchant_id,
      dayOfWeek: data.day_of_week,
      lat: data.lat,
      lng: data.lng,
      address: data.address || undefined,
      openTime: data.open_time,
      closeTime: data.close_time,
      enabled: data.enabled
    };
  } catch (e) {
    console.error('更新日程错误:', e);
    return null;
  }
}

/**
 * 删除某天的日程
 * @param merchantId 商家ID
 * @param dayOfWeek 星期几 (0-6)
 * @returns 是否成功
 */
export async function deleteMerchantSchedule(merchantId: string, dayOfWeek: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('merchant_schedules')
      .delete()
      .eq('merchant_id', merchantId)
      .eq('day_of_week', dayOfWeek);

    if (error) {
      console.error('删除日程错误:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('删除日程错误:', e);
    return false;
  }
}

/**
 * 商家开工时更新GPS实际位置
 * @param merchantId 商家ID
 * @param lat 纬度
 * @param lng 经度
 * @returns 是否成功
 */
export async function updateActualLocation(merchantId: string, lat: number, lng: number): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('merchants')
      .update({
        actual_lat: lat,
        actual_lng: lng,
        updated_at: new Date().toISOString()
      })
      .eq('id', merchantId);

    if (error) {
      console.error('更新实际位置错误:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('更新实际位置错误:', e);
    return false;
  }
}

/**
 * 确保 Phase 2C 新增字段存在
 */
export async function ensurePhase2cColumns(): Promise<void> {
  // 检查 merchants.follower_count
  try {
    const { error: testError } = await supabase
      .from('merchants')
      .select('follower_count, actual_lat, actual_lng')
      .limit(1);
    
    if (!testError) {
      console.log('✅ Phase 2C 字段 (follower_count, actual_lat, actual_lng) 已存在');
    } else {
      console.log('⚠️ Phase 2C 字段可能不存在');
      console.log('请在 Supabase SQL 编辑器中执行 setup-phase2c.sql');
    }
  } catch (err) {
    console.log('检查 Phase 2C 字段时出错（可忽略）:', err);
  }

  // 检查 follows 表是否存在
  try {
    const { error: followsError } = await supabase
      .from('follows')
      .select('id')
      .limit(1);
    
    if (!followsError) {
      console.log('✅ follows 表已存在');
    } else {
      console.log('⚠️ follows 表可能不存在');
      console.log('请在 Supabase SQL 编辑器中执行 setup-phase2c.sql');
    }
  } catch (err) {
    console.log('检查 follows 表时出错（可忽略）:', err);
  }

  // 检查 merchant_schedules 表是否存在
  try {
    const { error: schedulesError } = await supabase
      .from('merchant_schedules')
      .select('id')
      .limit(1);
    
    if (!schedulesError) {
      console.log('✅ merchant_schedules 表已存在');
    } else {
      console.log('⚠️ merchant_schedules 表可能不存在');
      console.log('请在 Supabase SQL 编辑器中执行 setup-phase2c.sql');
    }
  } catch (err) {
    console.log('检查 merchant_schedules 表时出错（可忽略）:', err);
  }
}

// ==================== Phase 3A: 好友系统 ====================

/** 好友请求 */
export interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
  fromUser?: User;
  toUser?: User;
}

/** 好友关系 */
export interface Friendship {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: Date;
  friend?: User;
}

/**
 * 发送好友请求
 * @param fromUserId 发送者ID
 * @param toUserId 接收者ID
 * @returns 是否成功
 */
export async function sendFriendRequest(fromUserId: string, toUserId: string): Promise<{ success: boolean; message: string; requestId?: string }> {
  try {
    // 不能加自己为好友
    if (fromUserId === toUserId) {
      return { success: false, message: '不能加自己为好友' };
    }

    // 检查目标用户是否存在
    const { data: targetUser, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', toUserId)
      .single();

    if (userError || !targetUser) {
      return { success: false, message: '用户不存在' };
    }

    // 检查是否已经是好友
    const isFriend = await areFriends(fromUserId, toUserId);
    if (isFriend) {
      return { success: false, message: '你们已经是好友了' };
    }

    // 检查是否已有待处理的请求（自己发的或对方发的）
    const { data: existingRequest } = await supabase
      .from('friend_requests')
      .select('*')
      .or(`and(from_user_id.eq.${fromUserId},to_user_id.eq.${toUserId}),and(from_user_id.eq.${toUserId},to_user_id.eq.${fromUserId})`)
      .single();

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        if (existingRequest.from_user_id === fromUserId) {
          return { success: false, message: '你已经发送过好友请求了，请等待对方回应' };
        } else {
          return { success: false, message: '对方已向你发送好友请求，请先处理' };
        }
      }
      if (existingRequest.status === 'accepted') {
        return { success: false, message: '你们已经是好友了' };
      }
      // rejected 状态可以重新发送
    }

    // 创建好友请求
    const { data, error } = await supabase
      .from('friend_requests')
      .upsert({
        from_user_id: fromUserId,
        to_user_id: toUserId,
        status: 'pending',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'from_user_id,to_user_id'
      })
      .select()
      .single();

    if (error) {
      console.error('发送好友请求错误:', error);
      return { success: false, message: '发送失败，请稍后重试' };
    }

    return { success: true, message: '好友请求已发送', requestId: data.id };
  } catch (e) {
    console.error('发送好友请求错误:', e);
    return { success: false, message: '发送失败，请稍后重试' };
  }
}

/**
 * 接受好友请求
 * @param requestId 请求ID
 * @param userId 当前用户ID（必须是请求的接收者）
 * @returns 是否成功
 */
export async function acceptFriendRequest(requestId: string, userId: string): Promise<boolean> {
  try {
    // 获取请求
    const { data: request, error: fetchError } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !request) {
      return false;
    }

    // 验证权限：只有接收者可以接受
    if (request.to_user_id !== userId) {
      return false;
    }

    // 验证状态
    if (request.status !== 'pending') {
      return false;
    }

    // 更新请求状态（trigger 会自动创建 friendship）
    const { error: updateError } = await supabase
      .from('friend_requests')
      .update({
        status: 'accepted',
        updated_at: new Date().toISOString()
      })
      .eq('id', requestId);

    if (updateError) {
      console.error('接受好友请求错误:', updateError);
      return false;
    }

    // 手动创建 friendship（以防 trigger 未生效）
    const { error: friendshipError } = await supabase
      .from('friendships')
      .upsert({
        user_a_id: request.from_user_id < request.to_user_id ? request.from_user_id : request.to_user_id,
        user_b_id: request.from_user_id < request.to_user_id ? request.to_user_id : request.from_user_id,
      }, {
        onConflict: 'user_a_id,user_b_id'
      });

    if (friendshipError) {
      console.warn('创建好友关系时出错（可能已存在）:', friendshipError);
    }

    return true;
  } catch (e) {
    console.error('接受好友请求错误:', e);
    return false;
  }
}

/**
 * 拒绝好友请求
 * @param requestId 请求ID
 * @param userId 当前用户ID（必须是请求的接收者）
 * @returns 是否成功
 */
export async function rejectFriendRequest(requestId: string, userId: string): Promise<boolean> {
  try {
    // 验证权限并更新
    const { error } = await supabase
      .from('friend_requests')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString()
      })
      .eq('id', requestId)
      .eq('to_user_id', userId); // 只有接收者可以拒绝

    if (error) {
      console.error('拒绝好友请求错误:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('拒绝好友请求错误:', e);
    return false;
  }
}

/**
 * 获取我的好友列表
 * @param userId 用户ID
 * @returns 好友列表
 */
export async function getFriends(userId: string): Promise<User[]> {
  try {
    // 查询 friendships 表，找出所有包含该用户的好友关系
    const { data: friendships, error } = await supabase
      .from('friendships')
      .select('*')
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`);

    if (error || !friendships) {
      console.error('获取好友列表错误:', error);
      return [];
    }

    // 提取好友ID
    const friendIds = friendships.map((f: any) =>
      f.user_a_id === userId ? f.user_b_id : f.user_a_id
    );

    if (friendIds.length === 0) {
      return [];
    }

    // 获取好友详细信息
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, phone, role, created_at, account_status')
      .in('id', friendIds);

    if (usersError || !users) {
      console.error('获取好友信息错误:', usersError);
      return [];
    }

    return users.map((u: any) => ({
      id: u.id,
      phone: u.phone,
      passwordHash: '', // 不返回密码哈希
      role: u.role,
      createdAt: new Date(u.created_at),
      accountStatus: u.account_status || 'active',
    }));
  } catch (e) {
    console.error('获取好友列表错误:', e);
    return [];
  }
}

/**
 * 获取待处理的好友请求（收到的）
 * @param userId 用户ID
 * @returns 好友请求列表
 */
export async function getPendingRequests(userId: string): Promise<FriendRequest[]> {
  try {
    const { data: requests, error } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('to_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error || !requests) {
      console.error('获取好友请求错误:', error);
      return [];
    }

    // 获取发送者信息
    const fromUserIds = requests.map((r: any) => r.from_user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, phone, role, created_at')
      .in('id', fromUserIds);

    const userMap: Record<string, User> = {};
    (users || []).forEach((u: any) => {
      userMap[u.id] = {
        id: u.id,
        phone: u.phone,
        passwordHash: '',
        role: u.role,
        createdAt: new Date(u.created_at),
        accountStatus: 'active',
      };
    });

    return requests.map((r: any) => ({
      id: r.id,
      fromUserId: r.from_user_id,
      toUserId: r.to_user_id,
      status: r.status,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
      fromUser: userMap[r.from_user_id],
    }));
  } catch (e) {
    console.error('获取好友请求错误:', e);
    return [];
  }
}

/**
 * 检查是否是好友
 * @param userAId 用户A ID
 * @param userBId 用户B ID
 * @returns 是否是好友
 */
export async function areFriends(userAId: string, userBId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('friendships')
      .select('id')
      .or(`and(user_a_id.eq.${userAId},user_b_id.eq.${userBId}),and(user_a_id.eq.${userBId},user_b_id.eq.${userAId})`)
      .single();

    return !!data;
  } catch {
    return false;
  }
}

/**
 * 删除好友
 * @param userId 当前用户ID
 * @param friendId 好友ID
 * @returns 是否成功
 */
export async function deleteFriend(userId: string, friendId: string): Promise<boolean> {
  try {
    // 删除 friendship
    const { error: friendshipError } = await supabase
      .from('friendships')
      .delete()
      .or(`and(user_a_id.eq.${userId},user_b_id.eq.${friendId}),and(user_a_id.eq.${friendId},user_b_id.eq.${userId})`);

    if (friendshipError) {
      console.error('删除好友关系错误:', friendshipError);
      return false;
    }

    // 同时删除相关的好友请求（如果有）
    await supabase
      .from('friend_requests')
      .delete()
      .or(`and(from_user_id.eq.${userId},to_user_id.eq.${friendId}),and(from_user_id.eq.${friendId},to_user_id.eq.${userId})`);

    return true;
  } catch (e) {
    console.error('删除好友错误:', e);
    return false;
  }
}

/**
 * 搜索用户（用于添加好友）
 * @param query 搜索关键词（手机号）
 * @param excludeUserId 排除的用户ID
 * @returns 用户列表
 */
export async function searchUsers(query: string, excludeUserId: string): Promise<User[]> {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, phone, role, created_at, account_status')
      .ilike('phone', `%${query}%`)
      .neq('id', excludeUserId)
      .limit(10);

    if (error || !users) {
      return [];
    }

    return users.map((u: any) => ({
      id: u.id,
      phone: u.phone,
      passwordHash: '',
      role: u.role,
      createdAt: new Date(u.created_at),
      accountStatus: u.account_status || 'active',
    }));
  } catch (e) {
    console.error('搜索用户错误:', e);
    return [];
  }
}

/**
 * 确保 Phase 3A 好友系统表存在
 */
export async function ensurePhase3aTables(): Promise<void> {
  // 检查 friend_requests 表
  try {
    const { error: frError } = await supabase
      .from('friend_requests')
      .select('id')
      .limit(1);
    
    if (!frError) {
      console.log('✅ friend_requests 表已存在');
    } else {
      console.log('⚠️ friend_requests 表不存在');
      console.log('请在 Supabase SQL 编辑器中执行 migrations/setup-phase3a.sql');
    }
  } catch (err) {
    console.log('检查 friend_requests 表时出错（可忽略）:', err);
  }

  // 检查 friendships 表
  try {
    const { error: fsError } = await supabase
      .from('friendships')
      .select('id')
      .limit(1);
    
    if (!fsError) {
      console.log('✅ friendships 表已存在');
    } else {
      console.log('⚠️ friendships 表不存在');
      console.log('请在 Supabase SQL 编辑器中执行 migrations/setup-phase3a.sql');
    }
  } catch (err) {
    console.log('检查 friendships 表时出错（可忽略）:', err);
  }
}
