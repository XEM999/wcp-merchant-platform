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
