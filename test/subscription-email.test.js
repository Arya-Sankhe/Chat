import assert from 'node:assert/strict';
import test from 'node:test';
import { subscriptionEmail, queueSubscriptionEmail, deliverBillingEmails } from '../server/saas/subscriptionEmail.js';
import { processMamoPayment } from '../server/saas/mamo.js';

const config = { billingEmail: { enabledAt: '2026-10-20T00:00:00Z', apiKey: 'test-key' }, mamo: { baseUrl: 'https://mamo.test', apiKey: 'test' } };
const plans = [{ id: 'lite', name: 'Plus' }, { id: 'pro', name: 'Pro' }];
const link = { id: 'link', user_id: 'user', plan_id: 'lite', amount_aed: 16.65, created_at: '2026-10-21T00:00:00Z' };
function fakeDb(checkout = link) {
  const deliveries = new Map();
  let subscription = { provider: 'mamo', status: 'active', raw: { payment_link_id: checkout.id, next_payment_date: '21/11/2026' } };
  return {
    deliveries,
    getMamoPaymentLink: async () => checkout,
    getLatestSubscription: async () => subscription,
    applyMamoSubscription: async (value) => { subscription = value; return value; },
    getProfile: async () => ({ email: 'account@example.com', display_name: 'Arya <img onerror="bad">' }),
    request: async (table, options) => {
      assert.equal(table, 'billing_email_deliveries');
      if (options.method === 'POST' && !deliveries.has(options.body.payment_link_id)) deliveries.set(options.body.payment_link_id, options.body);
    },
    claimMamoCoupon: async () => ({ status: 'active' })
  };
}
test('full price, discount and free trial render truthful amounts and copy', () => {
  for (const [amount, discounted, expected, trialDays] of [[16.65, false, 'Your payment method has been charged.'], [8.85, true, 'discounted first month'], [0, true, 'first month is free'], [0, true, '2-week free trial has started', 14]]) {
    const mail = subscriptionEmail({ planName: 'Plus', name: '<script>x</script>', initialAmount: amount, renewalAmount: 16.65, nextPaymentAt: '2026-11-20T20:00:00Z', discounted, trialDays });
    assert.match(mail.textContent, new RegExp(expected));
    assert.match(mail.textContent, /Nov 21, 2026/);
    if (discounted) assert.match(mail.textContent, /next charge of AED 16.65/);
    assert.match(mail.htmlContent, /klui-header-v2\.png/);
    assert.match(mail.htmlContent, />Chat with Klui</);
    assert.match(mail.htmlContent, /&lt;script&gt;/);
    assert.doesNotMatch(mail.htmlContent, /<script>/);
    assert.match(mail.htmlContent, /href="https:\/\/klui.ai\/#settings"/);
    assert.equal(mail.subject, amount === 0 ? 'Your Plus free trial is confirmed' : 'Your Plus subscription is confirmed');
  }
});
test('unknown renewal dates are omitted rather than invented', () => {
  const mail = subscriptionEmail({ planName: 'Pro', initialAmount: 32.19, renewalAmount: 32.19 });
  assert.doesNotMatch(mail.textContent, /next charge is on/);
});
test('queue targets the account email, deduplicates checkout and uses the separate sender', async () => {
  const db = fakeDb();
  await Promise.all([queueSubscriptionEmail(link, { db, plans, config }), queueSubscriptionEmail(link, { db, plans, config })]);
  assert.equal(db.deliveries.size, 1);
  const payload = db.deliveries.get(link.id).payload;
  assert.equal(payload.to[0].email, 'account@example.com');
  assert.equal(payload.sender.email, 'billing@notify.arcscalelabs.com');
  assert.equal(payload.replyTo.email, 'contact@arcscalelabs.com');
});
test('free month uses billing day, not the one-day access grace deadline', async () => {
  const checkout = { ...link, coupon_code: 'FREE', initial_amount_aed: 0, first_renewal_at: '2026-11-21T20:00:00Z' };
  const db = fakeDb(checkout);
  await queueSubscriptionEmail(checkout, { db, plans, config });
  assert.match(db.deliveries.get(link.id).payload.textContent, /Nov 21, 2026/);
});
test('disabled rollout, historical checkout, unpaid/refunded and superseded subscriptions cannot queue', async () => {
  for (const status of ['past_due', 'canceled', 'testing']) {
    const db = fakeDb(); db.getLatestSubscription = async () => ({ provider: 'mamo', status, raw: { payment_link_id: link.id } });
    await queueSubscriptionEmail(link, { db, plans, config }); assert.equal(db.deliveries.size, 0);
  }
  for (const cfg of [{}, { billingEmail: {} }, { billingEmail: { enabledAt: '2026-10-22T00:00:00Z' } }]) {
    const db = fakeDb(); await queueSubscriptionEmail(link, { db, plans, config: cfg }); assert.equal(db.deliveries.size, 0);
  }
  const db = fakeDb(); db.getLatestSubscription = async () => ({ provider: 'mamo', status: 'active', raw: { payment_link_id: 'newer' } });
  await queueSubscriptionEmail(link, { db, plans, config }); assert.equal(db.deliveries.size, 0);
});
test('verified full-price callback activates before enqueue; replay stays one email', async (t) => {
  const db = fakeDb();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'payment', amount_currency: 'AED', amount: 16.65, status: 'captured', payment_link_id: link.id, next_payment_date: '21/11/2026', customer_details: { email: 'payer@example.com' } })));
  await processMamoPayment('payment', { db, plans, config });
  await processMamoPayment('payment', { db, plans, config });
  assert.equal(db.deliveries.size, 1);
});
test('coupon replay in active state still recovers a missing confirmation', async (t) => {
  const checkout = { ...link, coupon_code: 'FREE', initial_amount_aed: 0, first_renewal_at: '2026-11-21T20:00:00Z' };
  const db = fakeDb(checkout);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 'verification', amount_currency: 'AED', amount: 16.65, status: 'card_verified', payment_link_id: link.id })));
  await processMamoPayment('verification', { db, plans, config });
  assert.equal(db.deliveries.size, 1);
  assert.match(db.deliveries.get(link.id).payload.subject, /free trial/);
});
test('send success and duplicate response mark delivered; rate limit queues safe retry', async (t) => {
  for (const [status, body, expected] of [[201, { messageId: 'message' }, 'sent'], [400, { code: 'duplicate_parameter' }, 'sent'], [429, { code: 'too_many_requests' }, 'pending']]) {
    const patches = [];
    const db = { rpc: async () => [{ id: 'uuid', lease_token: 'lease', attempt_count: 1, payload: { subject: 'confirmation' } }], request: async (_, options) => patches.push(options) };
    const mock = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(options.headers['api-key'], 'test-key');
      assert.equal(JSON.parse(options.body).headers.idempotencyKey, 'uuid');
      return new Response(JSON.stringify(body), { status });
    });
    await deliverBillingEmails(config, db);
    assert.equal(patches[0].body.status, expected);
    assert.equal(patches[0].query.lease_token, 'eq.lease');
    mock.mock.restore();
  }
});
test('unknown network outcome retains lease and idempotency window for recovery', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('timeout'); });
  let patch;
  await deliverBillingEmails(config, { rpc: async () => [{ id: 'uuid', lease_token: 'lease', attempt_count: 1, payload: {} }], request: async (_, options) => { patch = options.body; } });
  assert.equal(patch.status, undefined);
  assert.match(patch.last_error, /unknown/);
});
test('a later rejection cannot reset an earlier uncertain send window', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }));
  let patch;
  await deliverBillingEmails(config, { rpc: async () => [{ id: 'uuid', lease_token: 'lease', attempt_count: 2, payload: {} }], request: async (_, options) => { patch = options.body; } });
  assert.equal(patch.status, undefined);
  assert.equal(patch.first_attempt_at, undefined);
});
