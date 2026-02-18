import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ==================== 类型定义 ====================

export interface Location {
  lat: number;
  lng: number;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  available: boolean;
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
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
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

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
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

function mapMerchantFromDb(data: any, menuItems: MenuItem[] = []): Merchant {
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
      suspended: false,
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
export type OrderStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'picked_up' | 'rejected';

/** 取餐方式 */
export type PickupMethod = 'self' | 'table_delivery';

/** 订单项 */
export interface OrderItem {
  name: string;      // 商品名称
  qty: number;       // 数量
  price: number;     // 单价
  note?: string;     // 商品备注
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
  pending: ['accepted', 'rejected'],
  accepted: ['preparing'],
  preparing: ['ready'],
  ready: ['picked_up'],
  picked_up: [], // 终态
  rejected: [],  // 终态
};

/** 状态对应的时间戳字段 */
const STATUS_TIMESTAMP_FIELD: Record<OrderStatus, string> = {
  pending: 'created_at',
  accepted: 'accepted_at',
  preparing: 'preparing_at',
  ready: 'ready_at',
  picked_up: 'picked_up_at',
  rejected: 'updated_at',
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
