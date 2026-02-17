// WCP API 测试脚本
const BASE = 'http://localhost:3000/api';

// 辅助函数
const post = (url, body, token) => fetch(BASE + url, { 
  method: 'POST', 
  headers: { 
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  }, 
  body: JSON.stringify(body) 
}).then(r => r.json());

const get = (url, token) => fetch(BASE + url, { 
  headers: { 
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}) 
  } 
}).then(r => r.json());

const patch = (url, body, token) => fetch(BASE + url, { 
  method: 'PATCH', 
  headers: { 
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  }, 
  body: JSON.stringify(body) 
}).then(r => r.json());

const put = (url, body, token) => fetch(BASE + url, { 
  method: 'PUT', 
  headers: { 
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  }, 
  body: JSON.stringify(body) 
}).then(r => r.json());

async function test() {
  console.log('=== WCP API 测试 ===\n');

  // ========== 认证测试 ==========
  console.log('--- 认证测试 ---');

  // 1. 注册用户
  const register1 = await post('/auth/register', { phone: '13800138000', password: 'test123456' });
  console.log('✅ 用户注册:', register1.token ? '成功' : '失败');
  const token1 = register1.token;
  
  // 2. 重复注册 (应该失败)
  const registerFail = await post('/auth/register', { phone: '13800138000', password: 'test123456' });
  console.log('✅ 重复注册拦截:', registerFail.error ? '正确' : '错误');

  // 3. 登录
  const login1 = await post('/auth/login', { phone: '13800138000', password: 'test123456' });
  console.log('✅ 用户登录:', login1.token ? '成功' : '失败');
  const token2 = login1.token;

  // 4. 错误密码登录
  const loginFail = await post('/auth/login', { phone: '13800138000', password: 'wrongpass' });
  console.log('✅ 错误密码拦截:', loginFail.error ? '正确' : '错误');

  // 5. 获取当前用户
  const me = await get('/auth/me', token2);
  console.log('✅ 获取当前用户:', me.phone);

  // 使用token进行后续操作
  const token = token2;

  // ========== 商户测试 ==========
  console.log('\n--- 商户测试 ---');

  // 6. 注册商户 (需登录)
  const m1 = await post('/merchants', { 
    name: '老王烧烤车', 
    type: 'food_truck', 
    phone: '021-1234567', 
    location: { lat: -43.530, lng: 172.637 }, 
    address: 'Christchurch CBD' 
  }, token);
  console.log('✅ 商户注册:', m1.merchant?.name);

  // 7. 商户上线
  await patch(`/merchants/${m1.merchant.id}/status`, { online: true }, token);
  console.log('✅ 商户已上线');

  // 8. 附近搜索
  const nearby = await get('/merchants/nearby?lat=-43.532&lng=172.636&radius=10');
  console.log(`✅ 附近商户: ${nearby.count}个`);

  // 9. 添加菜单
  const menu = await put(`/merchants/${m1.merchant.id}/menu`, { items: [
    { name: '烤羊肉串', price: 5, category: '烧烤' },
    { name: '烤鸡翅', price: 8, category: '烧烤' },
    { name: '啤酒', price: 10, category: '饮品' },
  ]}, token);
  console.log('✅ 菜单:', menu.menuItems?.length, '个菜品');

  // 10. 评价 (需登录)
  const rev = await post(`/merchants/${m1.merchant.id}/reviews`, { score: 5, comment: '烤串超好吃！' }, token);
  console.log('✅ 评价:', rev.review?.comment, '评分:', rev.newRating);

  // 11. 获取评价
  const revs = await get(`/merchants/${m1.merchant.id}/reviews`);
  console.log('✅ 评价列表:', revs.count, '条, 平均:', revs.rating);

  // 12. 商户下线
  await patch(`/merchants/${m1.merchant.id}/status`, { online: false }, token);
  console.log('✅ 商户已下线');

  console.log('\n=== 全部通过 ===');
}

test().catch(e => console.error('❌ 测试失败:', e.message));
