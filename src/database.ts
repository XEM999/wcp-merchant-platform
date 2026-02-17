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
  createdAt: Date;
}

// ==================== 内存存储 (模拟Supabase) ====================

const merchantsDb = new Map<string, Merchant>();
const reviewsDb = new Map<string, Review>();
const usersDb = new Map<string, User>();
const phoneIndex = new Map<string, string>(); // phone -> userId

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
  const dLng = toRad(b.lng - b.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ==================== 用户操作 ====================

export function createUser(phone: string, password: string): User {
  if (phoneIndex.has(phone)) {
    throw new Error('手机号已注册');
  }
  const user: User = {
    id: crypto.randomUUID(),
    phone,
    passwordHash: hashPassword(password),
    createdAt: new Date(),
  };
  usersDb.set(user.id, user);
  phoneIndex.set(phone, user.id);
  return user;
}

export function getUserByPhone(phone: string): User | undefined {
  const userId = phoneIndex.get(phone);
  if (!userId) return undefined;
  return usersDb.get(userId);
}

export function getUserById(id: string): User | undefined {
  return usersDb.get(id);
}

// ==================== 商户操作 ====================

export function createMerchant(data: {
  name: string;
  type: string;
  phone: string;
  email?: string;
  description?: string;
  location: Location;
  address?: string;
  userId?: string;
}): Merchant {
  const merchant: Merchant = {
    id: crypto.randomUUID(),
    userId: data.userId,
    name: data.name,
    type: data.type,
    phone: data.phone,
    email: data.email,
    description: data.description,
    location: { lat: Number(data.location.lat), lng: Number(data.location.lng) },
    address: data.address,
    menuItems: [],
    online: false,
    rating: 0,
    reviewCount: 0,
    createdAt: new Date(),
  };
  merchantsDb.set(merchant.id, merchant);
  return merchant;
}

export function getMerchant(id: string): Merchant | undefined {
  return merchantsDb.get(id);
}

export function getAllMerchants(): Merchant[] {
  return Array.from(merchantsDb.values());
}

export function updateMerchantStatus(id: string, online: boolean): Merchant | undefined {
  const m = merchantsDb.get(id);
  if (!m) return undefined;
  m.online = online;
  return m;
}

export function updateMenu(id: string, items: Omit<MenuItem, 'id'>[]): Merchant | undefined {
  const m = merchantsDb.get(id);
  if (!m) return undefined;
  m.menuItems = items.map(i => ({
    id: crypto.randomUUID(),
    name: i.name,
    price: Number(i.price),
    description: i.description,
    category: i.category,
    available: i.available !== false,
  }));
  return m;
}

export function getNearbyMerchants(center: Location, radiusKm: number): (Merchant & { distance: number })[] {
  const all = Array.from(merchantsDb.values()).filter(m => m.online);
  return all
    .map(m => ({ ...m, distance: haversine(center, m.location) }))
    .filter(m => m.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance);
}

// ==================== 评价操作 ====================

export function createReview(data: {
  merchantId: string;
  userId: string;
  score: number;
  comment: string;
}): { review: Review; newRating: number } {
  const m = merchantsDb.get(data.merchantId);
  if (!m) throw new Error('商户不存在');

  if (data.score < 1 || data.score > 5) {
    throw new Error('score 必须 1-5');
  }

  const review: Review = {
    id: crypto.randomUUID(),
    merchantId: data.merchantId,
    userId: data.userId,
    score: Number(data.score),
    comment: data.comment,
    createdAt: new Date(),
  };
  reviewsDb.set(review.id, review);

  // 更新商户评分
  const merchantReviews = Array.from(reviewsDb.values()).filter(r => r.merchantId === m.id);
  m.reviewCount = merchantReviews.length;
  m.rating = Math.round((merchantReviews.reduce((s, r) => s + r.score, 0) / m.reviewCount) * 10) / 10;

  return { review, newRating: m.rating };
}

export function getReviews(merchantId: string): { count: number; rating: number; reviews: Review[] } {
  const m = merchantsDb.get(merchantId);
  if (!m) throw new Error('商户不存在');

  const list = Array.from(reviewsDb.values())
    .filter(r => r.merchantId === merchantId)
    .sort((a, b) => +b.createdAt - +a.createdAt);

  return { count: list.length, rating: m.rating, reviews: list };
}
