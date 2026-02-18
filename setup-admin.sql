-- ==================== NearBite Admin 数据库扩展脚本 ====================
-- 在 Supabase SQL Editor 中执行此脚本
-- 执行前请确保已有 users, merchants, orders, admin_logs 表

-- ==================== 1. 扩展 users 表 ====================

-- 添加封禁相关字段到 users 表
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- 添加注释
COMMENT ON COLUMN users.banned IS '是否被封禁';
COMMENT ON COLUMN users.banned_at IS '封禁时间';
COMMENT ON COLUMN users.ban_reason IS '封禁原因';

-- ==================== 2. 扩展 merchants 表 ====================

-- 添加封禁相关字段到 merchants 表
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- 添加注释
COMMENT ON COLUMN merchants.banned IS '是否被封禁（管理后台操作）';
COMMENT ON COLUMN merchants.banned_at IS '封禁时间';
COMMENT ON COLUMN merchants.ban_reason IS '封禁原因';

-- ==================== 3. 检查/创建 admin_logs 表 ====================

-- 如果 admin_logs 表不存在则创建
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id VARCHAR(100) NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加注释
COMMENT ON TABLE admin_logs IS '管理员操作日志';
COMMENT ON COLUMN admin_logs.admin_id IS '执行操作的管理员ID';
COMMENT ON COLUMN admin_logs.action IS '操作类型（如：ban_user, unban_merchant等）';
COMMENT ON COLUMN admin_logs.target_type IS '目标类型（user, merchant, order等）';
COMMENT ON COLUMN admin_logs.target_id IS '目标ID';
COMMENT ON COLUMN admin_logs.details IS '操作详情（JSON格式）';

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);

-- ==================== 4. 为现有表创建索引 ====================

-- users 表索引
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_banned ON users(banned);

-- merchants 表索引
CREATE INDEX IF NOT EXISTS idx_merchants_banned ON merchants(banned);

-- orders 表索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ==================== 5. 验证脚本执行结果 ====================

-- 查看 users 表结构
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;

-- 查看 merchants 表结构
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'merchants' 
ORDER BY ordinal_position;

-- 查看 admin_logs 表结构
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'admin_logs' 
ORDER BY ordinal_position;

-- ==================== 完成 ====================
-- 执行完毕后，管理员可以使用以下账号登录：
-- 手机号: 0210000000
-- 密码: admin2026
-- 
-- 注意：上线前请修改此密码！
