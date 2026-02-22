-- ============================================================
-- Migration 002: Phase 2C 功能（已执行，通过代码内嵌建表）
-- Applied: 2026-02-21
-- ============================================================

-- 商户取餐方式（已加）
ALTER TABLE merchants 
  ADD COLUMN IF NOT EXISTS pickup_methods JSONB DEFAULT '[]';

-- 厨房工位（已加）
ALTER TABLE merchants 
  ADD COLUMN IF NOT EXISTS kitchen_stations JSONB DEFAULT '[]';

-- 关注/粉丝系统
CREATE TABLE IF NOT EXISTS merchant_follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, merchant_id)
);

-- 位置日程（商户预告什么时候在哪）
CREATE TABLE IF NOT EXISTS merchant_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  location JSONB,           -- {lat, lng}
  address TEXT,
  notes TEXT,
  actual_location JSONB,    -- 实际打卡定位
  actual_checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(merchant_id, date)
);

INSERT INTO schema_migrations (version, description)
VALUES ('002', 'phase 2c: follows and schedules')
ON CONFLICT (version) DO NOTHING;
