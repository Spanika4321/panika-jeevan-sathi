'use strict';
/**
 * TEERNOVA Pay — Custom Payment Gateway
 *
 * TEERNOVA ka khud ka payment system.
 * UPI-based payments + payment tracking + subscriptions.
 *
 * Architecture:
 *   1. User checkout karte hain (plan select karta hai)
 *   2. System payment intent create karta hai (unique ID + details)
 *   3. User UPI se payment karta hai (UPI intent / QR / manual)
 *   4. Payment verify hota hai (manual confirm / auto callback)
 *   5. Credits / subscription activate hota hai
 *
 * Payment methods supported:
 *   - UPI (primary): UPI intent URL generate karta hai
 *   - Manual UPI: UPI ID + transaction reference
 *   - Demo Credits: virtual credits purchase
 *
 * Environment variables (TEERNOVA_PAY_*):
 *   TEERNOVA_PAY_UPI_ID      — UPI ID for receiving payments (e.g. payments@teernova)
 *   TEERNOVA_PAY_BUSINESS   — Business name shown on receipts
 *   TEERNOVA_PAY_WEBHOOK_SECRET — Webhook verification secret
 */

const DEFAULTS = {
  upi_id: process.env.TEERNOVA_PAY_UPI_ID || 'payments@teernova',
  business_name: process.env.TEERNOVA_PAY_BUSINESS || 'TEERNOVA',
  webhook_secret: process.env.TEERNOVA_PAY_WEBHOOK_SECRET || 'teernova-pay-secret-2026',
  demo_credit_rate: Number(process.env.TEERNOVA_PAY_CREDIT_RATE) || 10, // ₹10 = 100 credits
};

const PLANS = {
  premium_monthly: {
    id: 'premium_monthly',
    name: 'Premium Monthly',
    price: 99,
    currency: 'INR',
    description: 'Advanced Statistics • No Ads • Priority Results • 1 Month',
    features: [
      'Advanced Statistics & Analytics',
      'Ad-free browsing experience',
      'Priority result updates',
      'Detailed frequency analysis',
      '1 month validity',
    ],
    credits: 0,
    duration_days: 30,
  },
  premium_yearly: {
    id: 'premium_yearly',
    name: 'Premium Yearly',
    price: 999,
    currency: 'INR',
    description: 'All Premium features • 1 Year • Best Value',
    features: [
      'Advanced Statistics & Analytics',
      'Ad-free browsing experience',
      'Priority result updates',
      'Detailed frequency analysis',
      'Early access to new features',
      'Exclusive insights & reports',
      '1 year validity (12 months)',
    ],
    credits: 0,
    duration_days: 365,
  },
  demo_credits_100: {
    id: 'demo_credits_100',
    name: '100 Demo Credits',
    price: 10,
    currency: 'INR',
    description: 'Virtual demo play ke liye 100 credits',
    features: [
      '100 virtual demo credits',
      'Use in demo play mode',
      'No real money involved',
      'Instant activation after payment',
    ],
    credits: 100,
    duration_days: 0,
  },
  demo_credits_500: {
    id: 'demo_credits_500',
    name: '500 Demo Credits',
    price: 49,
    currency: 'INR',
    description: 'Virtual demo play ke liye 500 credits',
    features: [
      '500 virtual demo credits',
      'Use in demo play mode',
      'No real money involved',
      'Instant activation after payment',
    ],
    credits: 500,
    duration_days: 0,
  },
};

const PAYMENT_STATUS = {
  PENDING: 'pending',      // Payment intent created, awaiting payment
  PROCESSING: 'processing', // Payment in progress (UPI pending)
  COMPLETED: 'completed',   // Payment successful
  FAILED: 'failed',         // Payment failed
  REFUNDED: 'refunded',     // Payment refunded
  CANCELLED: 'cancelled',   // Payment cancelled by user
  EXPIRED: 'expired',       // Payment intent expired
};

const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  PAST_DUE: 'past_due',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Generate unique payment ID
function generatePaymentId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TEPN-${ts}-${rand}`;
}

// Generate unique subscription ID
function generateSubscriptionId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SUB-${ts}-${rand}`;
}

// UPI Intent URL generator
// Format: upi://pay?pa=<payee_vpa>&pn=<payee_name>&am=<amount>&cu=<currency>&tn=<transaction_note>
function generateUPIIntent(amount, currency = 'INR', transactionNote = '') {
  const config = DEFAULTS;
  const upiId = encodeURIComponent(config.upi_id);
  const businessName = encodeURIComponent(config.business_name);
  const amountStr = amount.toString();
  const note = encodeURIComponent(transactionNote || `TEERNOVA Payment`);

  return `upi://pay?pa=${upiId}&pn=${businessName}&am=${amountStr}&cu=${currency}&tn=${note}`;
}

// Generate payment instructions for manual UPI
function getPaymentInstructions(paymentIntent) {
  const amount = PLANS[paymentIntent.plan_id]?.price || paymentIntent.amount || 0;
  const planName = PLANS[paymentIntent.plan_id]?.name || 'Payment';
  return {
    upi_id: DEFAULTS.upi_id,
    business_name: DEFAULTS.business_name,
    amount: amount,
    currency: 'INR',
    transaction_id: paymentIntent.id,
    instructions: [
      `1. UPI app open karein (PhonePe, Google Pay, Paytm, etc.)`,
      `2. ${DEFAULTS.upi_id} par ₹${amount} transfer karein`,
      `3. Transaction reference: ${paymentIntent.id}`,
      `4. Payment completion ke baad "Payment Verify" button dabayein`,
      `5. Transaction ID dalein confirm karne ke liye`,
    ],
  };
}

// Generate payment QR code data (UPI QR format)
function getUPIQRData(paymentIntent) {
  const amount = PLANS[paymentIntent.plan_id]?.price || paymentIntent.amount || 0;
  return {
    upi_id: DEFAULTS.upi_id,
    amount: amount,
    transaction_id: paymentIntent.id,
    qr_data: generateUPIIntent(amount, 'INR', paymentIntent.id),
  };
}

// Create payment intent
function createPaymentIntent(db, userId, email, planId, options = {}) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Invalid plan: ${planId}`);

  const now = Date.now();
  const intent = {
    id: generatePaymentId(),
    user_id: userId,
    email: email,
    plan_id: planId,
    amount: plan.price,
    currency: plan.currency || 'INR',
    status: PAYMENT_STATUS.PENDING,
    demo_credits: plan.credits || 0,
    duration_days: plan.duration_days || 0,
    upi_intent_url: generateUPIIntent(plan.price, plan.currency, `TEERNOVA-${generatePaymentId()}`),
    payment_instructions: JSON.stringify(getPaymentInstructions({
      id: generatePaymentId(),
      plan_id: planId,
    })),
    qrcode_data: JSON.stringify(getUPIQRData({ id: generatePaymentId(), plan_id: planId })),
    created_at: now,
    updated_at: now,
    expires_at: now + (options.expiryHours || 24) * 3600000, // 24 hour expiry default
    notes: options.notes || '',
    metadata: JSON.stringify(options.metadata || {}),
  };

  db.insert('payment_intents', intent);
  return intent;
}

// Verify and complete a payment
function completePayment(db, paymentIntentId, transactionId, options = {}) {
  const intent = db.one('payment_intents', { id: paymentIntentId });
  if (!intent) throw new Error('Payment intent not found');
  if (intent.status === PAYMENT_STATUS.COMPLETED) throw new Error('Payment already completed');
  if (intent.status === PAYMENT_STATUS.FAILED) throw new Error('Payment already failed');
  if (Date.now() > intent.expires_at) throw new Error('Payment intent expired');

  const now = Date.now();
  const plan = PLANS[intent.plan_id];

  // Create payment record
  const payment = {
    id: generatePaymentId(),
    payment_intent_id: intent.id,
    user_id: intent.user_id,
    email: intent.email,
    plan_id: intent.plan_id,
    amount: intent.amount,
    currency: intent.currency,
    status: PAYMENT_STATUS.COMPLETED,
    transaction_id: transactionId || `MANUAL-${Date.now()}`,
    upi_transaction_id: options.upi_transaction_id || transactionId || '',
    payment_method: options.payment_method || 'upi',
    demo_credits: intent.demo_credits,
    paid_at: now,
    created_at: now,
    notes: options.notes || '',
    metadata: JSON.stringify(options.metadata || {}),
  };

  db.insert('payments', payment);

  // Update intent status
  db.update('payment_intents', { id: intent.id }, {
    status: PAYMENT_STATUS.COMPLETED,
    completed_at: now,
    updated_at: now,
    transaction_id: transactionId || '',
  });

  // Activate subscription if plan has duration
  if (intent.duration_days > 0) {
    const existingSub = db.one('subscriptions', {
      user_id: intent.user_id,
      plan_id: intent.plan_id,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });

    if (existingSub) {
      // Extend existing subscription
      const newEnd = Math.max(
        existingSub.ends_at || now,
        now + intent.duration_days * 86400000
      );
      db.update('subscriptions', { id: existingSub.id }, {
        ends_at: newEnd,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        updated_at: now,
      });
    } else {
      // Create new subscription
      db.insert('subscriptions', {
        id: generateSubscriptionId(),
        user_id: intent.user_id,
        email: intent.email,
        plan_id: intent.plan_id,
        status: SUBSCRIPTION_STATUS.ACTIVE,
        started_at: now,
        ends_at: now + intent.duration_days * 86400000,
        auto_renew: options.auto_renew !== false,
        created_at: now,
        updated_at: now,
      });
    }
  }

  // Add demo credits if applicable
  if (intent.demo_credits > 0) {
    const existingCredit = db.one('user_credits', { user_id: intent.user_id });
    if (existingCredit) {
      db.update('user_credits', { user_id: intent.user_id }, {
        balance: existingCredit.balance + intent.demo_credits,
        updated_at: now,
      });
    } else {
      db.insert('user_credits', {
        user_id: intent.user_id,
        balance: intent.demo_credits,
        created_at: now,
        updated_at: now,
      });
    }
  }

  return { payment, subscription_activated: intent.duration_days > 0 };
}

// Create subscription (direct, for admin/manual use)
function createSubscription(db, userId, email, planId, options = {}) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Invalid plan: ${planId}`);

  const now = Date.now();
  const sub = {
    id: generateSubscriptionId(),
    user_id: userId,
    email: email,
    plan_id: planId,
    status: options.status || SUBSCRIPTION_STATUS.ACTIVE,
    started_at: now,
    ends_at: now + (plan.duration_days || 30) * 86400000,
    auto_renew: options.auto_renew !== false,
    created_at: now,
    updated_at: now,
  };

  db.insert('subscriptions', sub);
  return sub;
}

// Cancel subscription
function cancelSubscription(db, subscriptionId) {
  const sub = db.one('subscriptions', { id: subscriptionId });
  if (!sub) throw new Error('Subscription not found');

  db.update('subscriptions', { id: subscriptionId }, {
    status: SUBSCRIPTION_STATUS.CANCELLED,
    updated_at: Date.now(),
  });

  return sub;
}

// Check user subscription status
function getUserSubscription(db, userId) {
  const sub = db.one('subscriptions', {
    user_id: userId,
    status: SUBSCRIPTION_STATUS.ACTIVE,
  });

  if (!sub) return null;

  const now = Date.now();
  const isActive = sub.ends_at > now;

  return {
    ...sub,
    is_active: isActive,
    is_expired: !isActive,
    days_remaining: Math.ceil((sub.ends_at - now) / 86400000),
  };
}

// Get user payment history
function getPaymentHistory(db, userId, options = {}) {
  const payments = db.all('payments', { user_id: userId }, {
    order: '-created_at',
    limit: options.limit || 50,
    offset: options.offset || 0,
  });

  return payments.map(p => ({
    ...p,
    plan_name: PLANS[p.plan_id]?.name || p.plan_id,
  }));
}

// Get all payments (admin)
function getAllPayments(db, options = {}) {
  const payments = db.all('payments', {}, {
    order: '-created_at',
    limit: options.limit || 100,
    offset: options.offset || 0,
  });

  return payments.map(p => ({
    ...p,
    plan_name: PLANS[p.plan_id]?.name || p.plan_id,
    user_email: p.email,
  }));
}

// Get payment stats (admin)
function getPaymentStats(db) {
  const totalPayments = db.count('payments', { status: PAYMENT_STATUS.COMPLETED });
  const totalRevenue = db.raw(
    `SELECT SUM(amount) AS total FROM "payments" WHERE "status" = '${PAYMENT_STATUS.COMPLETED}'`
  )[0]?.total || 0;

  const pendingIntents = db.count('payment_intents', { status: PAYMENT_STATUS.PENDING });
  const activeSubscriptions = db.count('subscriptions', { status: SUBSCRIPTION_STATUS.ACTIVE });

  const paymentsByPlan = db.raw(`
    SELECT plan_id, COUNT(*) as count, SUM(amount) as revenue
    FROM "payments"
    WHERE "status" = '${PAYMENT_STATUS.COMPLETED}'
    GROUP BY plan_id
  `);

  return {
    total_payments: totalPayments,
    total_revenue: Number(totalRevenue),
    pending_intents: pendingIntents,
    active_subscriptions: activeSubscriptions,
    payments_by_plan: paymentsByPlan,
    plans: Object.keys(PLANS).map(key => ({
      plan_id: key,
      plan_name: PLANS[key].name,
      price: PLANS[key].price,
      subscribers: paymentsByPlan.find(p => p.plan_id === key)?.count || 0,
      revenue: Number(paymentsByPlan.find(p => p.plan_id === key)?.revenue || 0),
    })),
  };
}

module.exports = {
  DEFAULTS,
  PLANS,
  PAYMENT_STATUS,
  SUBSCRIPTION_STATUS,
  createPaymentIntent,
  completePayment,
  createSubscription,
  cancelSubscription,
  getUserSubscription,
  getPaymentHistory,
  getAllPayments,
  getPaymentStats,
  generateUPIIntent,
  getPaymentInstructions,
  getUPIQRData,
};
