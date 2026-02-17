// 通过 Supabase 的隐藏SQL endpoint执行DDL
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('请设置环境变量 SUPABASE_URL 和 SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const allSQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'other',
  phone TEXT, email TEXT, description TEXT, address TEXT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  online BOOLEAN DEFAULT false,
  rating DOUBLE PRECISION DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  suspended BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  category TEXT, available BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  score INTEGER CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  target_merchant_id UUID REFERENCES merchants(id),
  reason TEXT, performed_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "public_read_merchants" ON merchants FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "public_read_menu" ON menu_items FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "public_read_reviews" ON reviews FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_insert_merchants" ON merchants FOR INSERT WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_update_merchants" ON merchants FOR UPDATE USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_insert_menu" ON menu_items FOR INSERT WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_update_menu" ON menu_items FOR UPDATE USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_delete_menu" ON menu_items FOR DELETE USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_insert_reviews" ON reviews FOR INSERT WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_insert_orders" ON orders FOR INSERT WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "all_read_orders" ON orders FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function run() {
  // Try the pg-meta endpoint that Supabase dashboard uses
  const res = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: allSQL })
  });
  
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.substring(0, 500));
  
  if (res.status !== 200) {
    // Try alternative endpoint
    console.log('\\nTrying /rest/v1/rpc...');
    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      }
    });
    console.log('REST status:', res2.status);
    console.log('REST body:', (await res2.text()).substring(0, 300));
  }
}

run();
