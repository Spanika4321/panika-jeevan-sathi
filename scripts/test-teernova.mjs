import http from 'node:http';
import { writeFileSync } from 'node:fs';

const host = 'localhost';
const port = 3000;

function request(method, path, body = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://${host}:${port}`);
    const headers = {
      'Content-Type': 'application/json',
    };
    if (cookie) headers.Cookie = cookie;
    const options = {
      hostname: host,
      port: port,
      path: url.pathname + url.search,
      method,
      headers,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function testGet(path, name, cookie = null) {
  try {
    const { status, body } = await request('GET', path, null, cookie);
    const ok = status === 200 ? '✅' : '❌';
    const size = body.length;
    console.log(`${ok} ${name}: HTTP ${status} (${size} bytes)`);
    return { status, body };
  } catch (e) {
    console.log(`❌ ${name}: ERROR — ${e.message}`);
    return null;
  }
}

async function testPost(path, body, name, cookie = null) {
  try {
    const { status, headers, body: respBody } = await request('POST', path, JSON.stringify(body), cookie);
    const data = JSON.parse(respBody);
    const ok = status === 200 ? '✅' : '❌';
    console.log(`${ok} ${name}: HTTP ${status}`);
    if (status !== 200) {
      console.log(`   Error: ${data.error || 'unknown'}`);
    }
    return { status, data, headers };
  } catch (e) {
    console.log(`❌ ${name}: ERROR — ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  TEERNOVA — Full System Test');
  console.log('═══════════════════════════════════════');
  console.log('');

  // 1. Static pages
  console.log('─── Static Pages ───');
  await testGet('/', 'Homepage');
  await testGet('/checkout.html', 'Checkout Page');
  await testGet('/results.html', 'Results Page');
  await testGet('/history.html', 'History Page');
  await testGet('/statistics.html', 'Statistics Page');
  await testGet('/sessions.html', 'Sessions Page');
  await testGet('/demo.html', 'Demo Page');
  await testGet('/admin.html', 'Admin Page');
  await testGet('/about.html', 'About Page');
  await testGet('/login.html', 'Login Page');
  await testGet('/404.html', '404 Page');
  console.log('');

  // 2. API endpoints
  console.log('─── API Endpoints ───');
  await testGet('/api/health', 'Health API');
  await testGet('/api/site', 'Site API');
  await testGet('/api/announcements', 'Announcements API');
  await testGet('/api/payments/plans', 'Payment Plans API');
  await testGet('/api/auth/me', 'Auth Me (unauth)');
  console.log('');

  // 3. Auth flow
  console.log('─── Auth Flow ───');
  const login = await testPost('/api/auth/login',
    { email: 'admin@teernova.com', password: '4641dd5c3d04a178Aa1' },
    'Admin Login');
  if (login?.status === 200) {
    console.log('   Admin email:', login.data.user?.email);
    console.log('   Admin role:', login.data.user?.role);
  }
  console.log('');

  // 4. Payment flow (if logged in)
  if (login?.status === 200) {
    console.log('─── Payment Flow ───');
    const cookie = login.headers?.['set-cookie']?.[0]?.split(';')[0] || '';

    // Create payment intent
    const intent = await testPost('/api/payments/create-intent',
      { plan_id: 'premium_monthly' },
      'Create Premium Monthly Intent', cookie);
    if (intent?.status === 200 && intent.data?.intent) {
      const i = intent.data.intent;
      console.log(`   Intent ID: ${i.id}`);
      console.log(`   Amount: ₹${i.amount}`);
      console.log(`   Status: ${i.status}`);
      console.log(`   Plan: ${i.plan_id}`);
      console.log(`   Demo Credits: ${i.demo_credits}`);
      console.log(`   UPI URL: ${i.upi_intent_url ? '✅' : '❌'}`);
      console.log(`   Instructions: ${i.payment_instructions ? '✅' : '❌'}`);
      console.log(`   QR Data: ${i.qrcode_data ? '✅' : '❌'}`);
    }
    console.log('');

    // Verify payment
    if (intent?.status === 200 && intent.data?.intent) {
      const intentId = intent.data.intent.id;
      const verify = await testPost('/api/payments/verify',
        {
          intent_id: intentId,
          transaction_id: `TEST-${Date.now()}`,
          upi_transaction_id: `TEST-${Date.now()}`,
          payment_method: 'upi',
        },
        'Verify Payment', cookie);
      if (verify?.status === 200) {
        console.log('   Verify Status:', verify.data.status);
        console.log('   Message:', verify.data.message);
        if (verify.data.subscription_activated) {
          console.log('   ✅ Subscription Activated!');
        }
      }
    }
    console.log('');

    // Payment history
    const history = await testGet('/api/payments/history', 'Payment History', cookie);
    if (history) {
      const data = JSON.parse(history.body);
      console.log(`   Payments: ${data.payments?.length || 0}`);
      console.log(`   Credit Balance: ${data.credit_balance || 0}`);
      if (data.subscription) {
        console.log(`   Subscription: ${data.subscription.plan_id} (${data.subscription.status})`);
      }
    }
    console.log('');
  }

  // 5. Admin endpoints (need admin cookie)
  console.log('─── Admin Endpoints ───');
  if (login?.status === 200) {
    const cookie = login.headers?.['set-cookie']?.[0]?.split(';')[0] || '';
    const adminStats = await testGet('/api/admin/stats', 'Admin Stats', cookie);
    const adminPayments = await testGet('/api/admin/payments', 'Admin Payments', cookie);
    const adminSubs = await testGet('/api/admin/subscriptions', 'Admin Subscriptions', cookie);
  }
  console.log('');

  console.log('═══════════════════════════════════════');
  console.log('  Test Complete');
  console.log('═══════════════════════════════════════');
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
