-- NearBite Follow System Fix
-- Run this SQL in Supabase SQL Editor

-- 确保 merchants 表有 follower_count 字段
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0;

-- 创建安全的原子增加粉丝数函数
CREATE OR REPLACE FUNCTION increment_follower_count_safe(merchant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE merchants 
  SET follower_count = COALESCE(follower_count, 0) + 1,
      updated_at = NOW()
  WHERE id = merchant_id;
END;
$$;

-- 创建安全的原子减少粉丝数函数（不会低于0）
CREATE OR REPLACE FUNCTION decrement_follower_count_safe(merchant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE merchants 
  SET follower_count = GREATEST(COALESCE(follower_count, 0) - 1, 0),
      updated_at = NOW()
  WHERE id = merchant_id;
END;
$$;

-- 确保 follows 表存在
CREATE TABLE IF NOT EXISTS follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, merchant_id)
);

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_follows_user_id ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_merchant_id ON follows(merchant_id);

-- 为现有商户初始化 follower_count（基于实际关注数据）
UPDATE merchants m
SET follower_count = (
  SELECT COUNT(*) FROM follows f WHERE f.merchant_id = m.id
);

SELECT 'Follow system migration completed!' as result;
