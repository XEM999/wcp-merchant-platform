/**
 * Test script for follower count atomic update
 * Run: node test-follower-count.js
 */

// Load from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://wcp-merchant-platform-production-dcdb.up.railway.app';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
  console.error('Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node test-follower-count.js');
  process.exit(1);
}

// Test credentials
const TEST_USER = { phone: '+64210000001', password: 'test1234' };
const TEST_MERCHANT_ID = '9d1a0b65-e775-4fae-8602-ff8d03e13641';

let userToken = null;

async function fetchAPI(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
  const url = path.startsWith('http') ? path : `${RAILWAY_URL}${path}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

async function fetchSupabase(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return res.json();
}

async function login() {
  console.log('\n🔐 Step 1: Logging in as test user...');
  const data = await fetchAPI('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(TEST_USER)
  });
  userToken = data.token;
  console.log('✅ Login successful, token:', userToken?.slice(0, 20) + '...');
}

async function getMerchantFollowerCount() {
  const data = await fetchSupabase('merchants', `id=eq.${TEST_MERCHANT_ID}&select=follower_count`);
  return data[0]?.follower_count || 0;
}

async function checkFollowing() {
  try {
    const data = await fetchAPI(`/api/merchants/${TEST_MERCHANT_ID}/is-following`);
    return data.following;
  } catch {
    return false;
  }
}

async function followMerchant() {
  console.log('\n❤️  Step 2: Following merchant...');
  await fetchAPI(`/api/merchants/${TEST_MERCHANT_ID}/follow`, { method: 'POST' });
  console.log('✅ Follow API called');
}

async function unfollowMerchant() {
  console.log('\n💔 Step 4: Unfollowing merchant...');
  await fetchAPI(`/api/merchants/${TEST_MERCHANT_ID}/follow`, { method: 'DELETE' });
  console.log('✅ Unfollow API called');
}

async function runTest() {
  console.log('========================================');
  console.log('🧪 Follower Count Atomic Update Test');
  console.log('========================================');
  console.log('Merchant ID:', TEST_MERCHANT_ID);

  try {
    // Login
    await login();

    // Get initial state
    console.log('\n📊 Getting initial state...');
    const initialCount = await getMerchantFollowerCount();
    const wasFollowing = await checkFollowing();
    console.log(`Initial follower_count: ${initialCount}`);
    console.log(`Was following: ${wasFollowing}`);

    // Ensure we start in a known state
    if (wasFollowing) {
      console.log('\n⚠️  Already following, unfollowing first...');
      await unfollowMerchant();
      await new Promise(r => setTimeout(r, 500));
    }

    // Get count after unfollow
    const countBeforeFollow = await getMerchantFollowerCount();
    console.log(`Count before follow: ${countBeforeFollow}`);

    // Step 2: Follow
    await followMerchant();
    await new Promise(r => setTimeout(r, 1000));

    // Step 3: Verify follower_count increased
    console.log('\n🔍 Step 3: Verifying follower count increased...');
    const countAfterFollow = await getMerchantFollowerCount();
    console.log(`Count after follow: ${countAfterFollow}`);
    
    if (countAfterFollow === countBeforeFollow + 1) {
      console.log('✅ PASS: Follower count increased by 1');
    } else {
      console.log(`❌ FAIL: Expected ${countBeforeFollow + 1}, got ${countAfterFollow}`);
    }

    // Step 4: Unfollow
    await unfollowMerchant();
    await new Promise(r => setTimeout(r, 1000));

    // Step 5: Verify follower_count decreased
    console.log('\n🔍 Step 5: Verifying follower count decreased...');
    const countAfterUnfollow = await getMerchantFollowerCount();
    console.log(`Count after unfollow: ${countAfterUnfollow}`);
    
    if (countAfterUnfollow === countBeforeFollow) {
      console.log('✅ PASS: Follower count returned to original');
    } else {
      console.log(`❌ FAIL: Expected ${countBeforeFollow}, got ${countAfterUnfollow}`);
    }

    console.log('\n========================================');
    console.log('🎉 Test completed!');
    console.log('========================================');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
  }
}

runTest();
