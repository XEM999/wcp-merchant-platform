-- ==================== NearBite 订单系统表结构 ====================
-- 执行方式：在 Supabase SQL Editor 中运行此脚本
-- 或者通过 migration 脚本自动执行

-- 1. 添加缺失的列到 orders 表
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS table_number TEXT,
  ADD COLUMN IF NOT EXISTS pickup_method TEXT DEFAULT 'self' CHECK (pickup_method IN ('self', 'table_delivery')),
  ADD COLUMN IF NOT EXISTS note TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. 确保 status 列有正确的约束
ALTER TABLE orders 
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders 
  ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('pending', 'accepted', 'preparing', 'ready', 'picked_up', 'rejected'));

-- 3. 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- 4. 创建更新时间戳的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 5. 为 orders 表创建触发器
DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. 如果 total 列不存在但 total_amount 需要，可以添加
-- 注意：如果已有 total 列，可以选择保留 total 或添加 total_amount
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount DECIMAL(10,2);

COMMIT;
