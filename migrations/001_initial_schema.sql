-- ============================================================
-- Migration 001: 初始表结构（记录用，已在 Supabase 存在）
-- Applied: 2026-02-18
-- ============================================================

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'consumer',  -- consumer, merchant, admin, superadmin
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 商户表
CREATE TABLE IF NOT EXISTS merchants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT '餐车/Food Truck',
  phone TEXT,
  email TEXT,
  description TEXT,
  location JSONB DEFAULT '{"lat": null, "lng": null}',
  address TEXT,
  menu_items JSONB DEFAULT '[]',
  online BOOLEAN DEFAULT false,
  rating NUMERIC(3,2) DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  account_status TEXT DEFAULT 'free_trial',
  plan TEXT DEFAULT 'free',
  plan_expires_at TIMESTAMPTZ,
  commission_rate INTEGER DEFAULT 8
);

-- 评价表
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id UUID REFERENCES merchants(id),
  user_id UUID REFERENCES users(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  merchant_id UUID REFERENCES merchants(id),
  user_id UUID REFERENCES users(id),
  items JSONB NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  status TEXT DEFAULT 'pending',
  pickup_method TEXT,
  table_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 迁移追踪表
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  description TEXT
);

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'initial schema')
ON CONFLICT (version) DO NOTHING;
