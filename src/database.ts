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
}

export interface User {
  id: string;
  phone: string;
  passwordHash: string;
  role?: string;
  createdAt: Date;
}

// ==================== Supabase 客户端 ====================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  console.error('Set them in Railway Variables or .env file');
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
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
