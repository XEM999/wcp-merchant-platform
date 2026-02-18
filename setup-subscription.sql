-- NearBite 商家订阅 + 账号状态系统
-- Duncan 在 Supabase SQL Editor 执行

-- 1. 商家表添加订阅相关字段
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'free_trial' 
  CHECK (account_status IN ('free_trial', 'active', 'expired', 'suspended', 'banned'));
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free'
  CHECK (plan IN ('free', 'pro'));
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,2) DEFAULT 8.00;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- 2. 用户表添加账号状态
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT DEFAULT 'active'
  CHECK (account_status IN ('active', 'suspended', 'banned'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_merchants_account_status ON merchants(account_status);
CREATE INDEX IF NOT EXISTS idx_merchants_plan ON merchants(plan);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status);

-- 4. 现有商家全部设为 free_trial
UPDATE merchants SET account_status = 'free_trial', plan = 'free', commission_rate = 8.00 
  WHERE account_status IS NULL;

-- 5. 现有用户全部设为 active
UPDATE users SET account_status = 'active' WHERE account_status IS NULL;
