/**
 * NearBite 订单系统 - 数据库迁移脚本
 * 用于添加 orders 表缺失的列
 * 
 * 执行方式：npx tsx src/migrate-orders.ts
 */

import { createClient } from '@supabase/supabase-js';

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 缺少环境变量 SUPABASE_URL 或 SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ==================== SQL 迁移语句 ====================

const migrations = [
  // 添加缺失的列
  {
    name: '添加 table_number 列',
    sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_number TEXT`
  },
  {
    name: '添加 pickup_method 列',
    sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_method TEXT DEFAULT 'self'`
  },
  {
    name: '添加 note 列',
    sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT DEFAULT ''`
  },
  {
    name: '添加 status_history 列',
    sql: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb`
  },
  {
    name: '添加时间戳列',
    sql: `ALTER TABLE orders 
          ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS preparing_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`
  },
  // 添加 status 约束
  {
    name: '添加 status 约束',
    sql: `DO $$ 
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check') THEN
              ALTER TABLE orders ADD CONSTRAINT orders_status_check 
              CHECK (status IN ('pending', 'accepted', 'preparing', 'ready', 'picked_up', 'rejected'));
            END IF;
          END $$`
  },
  // 添加 pickup_method 约束
  {
    name: '添加 pickup_method 约束',
    sql: `DO $$ 
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_pickup_method_check') THEN
              ALTER TABLE orders ADD CONSTRAINT orders_pickup_method_check 
              CHECK (pickup_method IN ('self', 'table_delivery'));
            END IF;
          END $$`
  },
  // 创建索引
  {
    name: '创建 merchant_id 索引',
    sql: `CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id)`
  },
  {
    name: '创建 user_id 索引',
    sql: `CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`
  },
  {
    name: '创建 status 索引',
    sql: `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`
  },
  {
    name: '创建 created_at 索引',
    sql: `CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC)`
  },
];

// ==================== 执行迁移 ====================

async function runMigrations() {
  console.log('🚀 开始执行订单系统数据库迁移...\n');
  
  let successCount = 0;
  let errorCount = 0;

  for (const migration of migrations) {
    console.log(`📝 执行: ${migration.name}`);
    
    try {
      // 使用 rpc 执行原始 SQL
      const { error } = await supabase.rpc('exec', { sql: migration.sql });
      
      if (error) {
        // 如果 rpc 不可用，尝试通过 REST API 直接操作
        console.log(`   ⚠️  RPC 不可用，跳过: ${error.message}`);
        console.log(`   ℹ️  请在 Supabase SQL Editor 中手动执行以下 SQL:`);
        console.log(`   ${migration.sql}\n`);
        continue;
      }
      
      console.log(`   ✅ 成功\n`);
      successCount++;
    } catch (err: any) {
      console.log(`   ❌ 错误: ${err.message}\n`);
      errorCount++;
    }
  }

  console.log('='.repeat(50));
  console.log(`迁移完成: ✅ ${successCount} 成功, ❌ ${errorCount} 失败`);
  
  if (errorCount > 0 || successCount === 0) {
    console.log('\n⚠️  部分迁移未能自动执行，请在 Supabase Dashboard 的 SQL Editor 中运行 setup-orders.sql 文件');
  }
}

// ==================== 入口 ====================

runMigrations()
  .then(() => {
    console.log('\n迁移脚本执行完毕');
    process.exit(0);
  })
  .catch((err) => {
    console.error('迁移失败:', err);
    process.exit(1);
  });
