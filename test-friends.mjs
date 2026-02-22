/**
 * Phase 3A 好友系统测试脚本
 * 测试流程：
 * 1. 消费者1登录
 * 2. 发好友请求给管理员账号
 * 3. 管理员账号登录，查看待处理请求
 * 4. 接受请求
 * 5. 验证双方好友列表都有对方
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

const BASE_URL = 'https://wcp-merchant-platform-production-dcdb.up.railway.app';

// 测试账号
const CONSUMER1 = { phone: '64210000001', password: 'test1234' };
const CONSUMER2 = { phone: '642108041740', password: 'test1234' }; // 管理员账号作为第二消费者

let token1, token2, user1, user2;

async function apiCall(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw { status: res.status, ...data };
  }
  return data;
}

async function login(phone, password) {
  const data = await apiCall('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  return { token: data.token, user: data.user };
}

console.log('========================================');
console.log('  Phase 3A 好友系统测试');
console.log('========================================\n');

// Step 1: 消费者1登录
console.log('📌 Step 1: 消费者1登录...');
try {
  const result = await login(CONSUMER1.phone, CONSUMER1.password);
  token1 = result.token;
  user1 = result.user;
  console.log(`   ✅ 登录成功: ${user1.phone} (ID: ${user1.id})`);
} catch (e) {
  console.log(`   ❌ 登录失败: ${e.error || e.message || JSON.stringify(e)}`);
  process.exit(1);
}

// Step 2: 管理员账号登录
console.log('\n📌 Step 2: 管理员账号登录...');
try {
  const result = await login(CONSUMER2.phone, CONSUMER2.password);
  token2 = result.token;
  user2 = result.user;
  console.log(`   ✅ 登录成功: ${user2.phone} (ID: ${user2.id})`);
} catch (e) {
  console.log(`   ❌ 登录失败: ${e.error || e.message || JSON.stringify(e)}`);
  process.exit(1);
}

// Step 3: 消费者1发好友请求给管理员
console.log('\n📌 Step 3: 消费者1发好友请求给管理员...');
try {
  const result = await apiCall(`/api/friends/request/${user2.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token1}` },
  });
  console.log(`   ✅ ${result.message}`);
} catch (e) {
  if (e.error?.includes('已发送') || e.error?.includes('已经是好友')) {
    console.log(`   ℹ️  ${e.error}`);
  } else {
    console.log(`   ❌ 发送失败: ${e.error || JSON.stringify(e)}`);
  }
}

// Step 4: 管理员查看待处理请求
console.log('\n📌 Step 4: 管理员查看待处理请求...');
let pendingRequests = [];
try {
  const data = await apiCall('/api/friends/requests/pending', {
    headers: { Authorization: `Bearer ${token2}` },
  });
  pendingRequests = data.requests || [];
  console.log(`   ✅ 待处理请求数量: ${pendingRequests.length}`);
  if (pendingRequests.length > 0) {
    console.log(`   📋 最新请求来自: ****${pendingRequests[0].fromUser?.phoneLast4 || '****'}`);
  }
} catch (e) {
  console.log(`   ❌ 获取失败: ${e.error || JSON.stringify(e)}`);
}

// Step 5: 接受好友请求
if (pendingRequests.length > 0) {
  const requestId = pendingRequests[0].id;
  console.log(`\n📌 Step 5: 接受好友请求 (${requestId})...`);
  try {
    await apiCall(`/api/friends/accept/${requestId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token2}` },
    });
    console.log(`   ✅ 已接受好友请求`);
  } catch (e) {
    console.log(`   ❌ 接受失败: ${e.error || JSON.stringify(e)}`);
  }
} else {
  console.log('\n📌 Step 5: 没有待处理请求，跳过接受步骤');
}

// Step 6: 验证双方好友列表
console.log('\n📌 Step 6: 验证好友列表...');

// 消费者1的好友列表
try {
  const data = await apiCall('/api/friends', {
    headers: { Authorization: `Bearer ${token1}` },
  });
  const friends = data.friends || [];
  console.log(`   消费者1好友数: ${friends.length}`);
  const hasUser2 = friends.some(f => f.id === user2.id);
  console.log(`   ${hasUser2 ? '✅' : '❌'} 消费者1的好友列表${hasUser2 ? '包含' : '不包含'}管理员`);
} catch (e) {
  console.log(`   ❌ 获取消费者1好友列表失败: ${e.error || JSON.stringify(e)}`);
}

// 管理员的好友列表
try {
  const data = await apiCall('/api/friends', {
    headers: { Authorization: `Bearer ${token2}` },
  });
  const friends = data.friends || [];
  console.log(`   管理员好友数: ${friends.length}`);
  const hasUser1 = friends.some(f => f.id === user1.id);
  console.log(`   ${hasUser1 ? '✅' : '❌'} 管理员的好友列表${hasUser1 ? '包含' : '不包含'}消费者1`);
} catch (e) {
  console.log(`   ❌ 获取管理员好友列表失败: ${e.error || JSON.stringify(e)}`);
}

// Step 7: 检查是否是好友
console.log('\n📌 Step 7: 检查好友关系...');
try {
  const data = await apiCall(`/api/friends/check/${user2.id}`, {
    headers: { Authorization: `Bearer ${token1}` },
  });
  console.log(`   ${data.isFriend ? '✅' : '❌'} 消费者1和管理员${data.isFriend ? '是' : '不是'}好友`);
} catch (e) {
  console.log(`   ❌ 检查失败: ${e.error || JSON.stringify(e)}`);
}

console.log('\n========================================');
console.log('  测试完成');
console.log('========================================');
