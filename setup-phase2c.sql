-- ========================================
-- NearBite Phase 2C 数据库迁移
-- 关注/粉丝系统 + 位置日程预告
-- ========================================

-- ==================== 关注/粉丝系统 ====================

-- 创建 follows 表
CREATE TABLE IF NOT EXISTS follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, merchant_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_follows_user_id ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_merchant_id ON follows(merchant_id);

-- 启用 RLS
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- RLS 策略: 所有人可读（公开读）
CREATE POLICY "follows_select_policy" ON follows
  FOR SELECT
  USING (true);

-- RLS 策略: 用户只能插入自己的关注记录
CREATE POLICY "follows_insert_policy" ON follows
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS 策略: 用户只能删除自己的关注记录
CREATE POLICY "follows_delete_policy" ON follows
  FOR DELETE
  USING (auth.uid() = user_id);

-- ==================== 位置日程系统 ====================

-- 创建 merchant_schedules 表
CREATE TABLE IF NOT EXISTS merchant_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),  -- 0=周日, 1=周一...6=周六
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  open_time TIME NOT NULL,      -- 预计开门时间
  close_time TIME NOT NULL,     -- 预计关门时间
  enabled BOOLEAN DEFAULT true, -- 类似闹钟的开关
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(merchant_id, day_of_week)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_merchant_schedules_merchant_id ON merchant_schedules(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_schedules_day_of_week ON merchant_schedules(day_of_week);

-- 启用 RLS
ALTER TABLE merchant_schedules ENABLE ROW LEVEL SECURITY;

-- RLS 策略: 所有人可读（公开读）
CREATE POLICY "merchant_schedules_select_policy" ON merchant_schedules
  FOR SELECT
  USING (true);

-- RLS 策略: 商家只能管理自己的日程
CREATE POLICY "merchant_schedules_insert_policy" ON merchant_schedules
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM merchants 
      WHERE merchants.id = merchant_schedules.merchant_id 
      AND merchants.user_id = auth.uid()
    )
  );

CREATE POLICY "merchant_schedules_update_policy" ON merchant_schedules
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM merchants 
      WHERE merchants.id = merchant_schedules.merchant_id 
      AND merchants.user_id = auth.uid()
    )
  );

CREATE POLICY "merchant_schedules_delete_policy" ON merchant_schedules
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM merchants 
      WHERE merchants.id = merchant_schedules.merchant_id 
      AND merchants.user_id = auth.uid()
    )
  );

-- ==================== merchants 表新增字段 ====================

-- 添加粉丝数计数字段
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS follower_count INTEGER DEFAULT 0;

-- 添加实际GPS位置字段（商家开工时更新）
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS actual_lat DOUBLE PRECISION;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS actual_lng DOUBLE PRECISION;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_merchants_follower_count ON merchants(follower_count);

-- ==================== 完成提示 ====================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Phase 2C 数据库迁移完成!';
  RAISE NOTICE '- follows 表已创建';
  RAISE NOTICE '- merchant_schedules 表已创建';
  RAISE NOTICE '- merchants 表已添加 follower_count, actual_lat, actual_lng 字段';
  RAISE NOTICE '- RLS 策略已配置';
  RAISE NOTICE '========================================';
END $$;
