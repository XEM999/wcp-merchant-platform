/**
 * 检查 Phase 3A 好友系统表是否存在
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dir, '.env'), 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
);

const BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;

console.log('========================================');
console.log('  检查 Phase 3A 好友系统表');
console.log('========================================\n');

// 1. Check friend_requests table
console.log('📌 检查 friend_requests 表...');
const r1 = await fetch(`${BASE}/rest/v1/friend_requests?select=id,from_user_id,to_user_id,status&limit=1`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
});
const body1 = await r1.text();
if (r1.status === 200) {
  console.log('   ✅ friend_requests 表存在');
  console.log('   示例数据:', body1.substring(0, 200));
} else {
  console.log('   ❌ friend_requests 表不存在或有问题');
  console.log('   错误:', r1.status, body1.substring(0, 300));
  console.log('\n   ⚠️  请在 Supabase SQL Editor 中执行 migrations/setup-phase3a.sql');
}

// 2. Check friendships table
console.log('\n📌 检查 friendships 表...');
const r2 = await fetch(`${BASE}/rest/v1/friendships?select=id,user_a_id,user_b_id&limit=1`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
});
const body2 = await r2.text();
if (r2.status === 200) {
  console.log('   ✅ friendships 表存在');
  console.log('   示例数据:', body2.substring(0, 200));
} else {
  console.log('   ❌ friendships 表不存在或有问题');
  console.log('   错误:', r2.status, body2.substring(0, 300));
  console.log('\n   ⚠️  请在 Supabase SQL Editor 中执行 migrations/setup-phase3a.sql');
}

// 3. Get user IDs for testing
console.log('\n📌 可用的测试用户:');
const r3 = await fetch(`${BASE}/rest/v1/users?select=id,phone,role&limit=5`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
});
const users = await r3.json();
console.log(JSON.stringify(users, null, 2));

console.log('\n========================================');
if (r1.status === 200 && r2.status === 200) {
  console.log('  ✅ Phase 3A 表已就绪');
} else {
  console.log('  ⚠️  需要手动执行 SQL 迁移');
}
console.log('========================================');
