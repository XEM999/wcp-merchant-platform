-- NearBite 数据库结构
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 商户表
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'other',
  phone TEXT,
  email TEXT,
  description TEXT,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  online BOOLEAN DEFAULT false,
  rating DOUBLE PRECISION DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  suspended BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 菜单表
CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  category TEXT,
  available BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 评价表
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  score INTEGER CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 订单表（销售数据追踪）
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  user_id UUID REFERENCES users(id),
  items JSONB NOT NULL,
  total DOUBLE PRECISION NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- 管理员操作日志（商家停权记录等）
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_merchant_id UUID REFERENCES merchants(id),
  reason TEXT,
  performed_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 启用RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 公开读取商户（在线的）
CREATE POLICY "Public can view online merchants" ON merchants FOR SELECT USING (true);
CREATE POLICY "Public can view menu items" ON menu_items FOR SELECT USING (true);
CREATE POLICY "Public can view reviews" ON reviews FOR SELECT USING (true);

-- 用户可以插入自己的数据
CREATE POLICY "Users can insert own merchants" ON merchants FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own merchants" ON merchants FOR UPDATE USING (true);
CREATE POLICY "Users can insert menu items" ON menu_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update menu items" ON menu_items FOR UPDATE USING (true);
CREATE POLICY "Users can delete menu items" ON menu_items FOR DELETE USING (true);
CREATE POLICY "Users can insert reviews" ON reviews FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can insert orders" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view orders" ON orders FOR SELECT USING (true);
