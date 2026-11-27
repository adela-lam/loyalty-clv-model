import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, valueStream, loyaltyStream, referralStream, replenishStream, membershipStream, platformCostPerCustomer, run, sensitivity } from '../public/model.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const sum = a => a.reduce((s, v) => s + v, 0);
const clone = () => structuredClone(DEFAULTS);

test('baseline CLV matches the closed-form geometric series (no discounting)', () => {
  const b = { aov: 100, margin: 0.5, ordersPerYear: 2, retention: 0.5, discountRate: 0, horizon: 24 };
  const s = Math.pow(0.5, 1 / 12);
  const expected = 100 * 0.5 * (1 + (2 / 12) * s * (1 - Math.pow(s, 24)) / (1 - s));
  close(sum(valueStream(b)), expected);
});

test('discounting lowers CLV', () => {
  const b = { ...DEFAULTS.base };
  assert.ok(sum(valueStream({ ...b, discountRate: 0.1 })) < sum(valueStream({ ...b, discountRate: 0 })));
});

test('replenishment: 4 orders a year, with and without cannibalisation', () => {
  const b = { ...DEFAULTS.base, margin: 0.5, discountRate: 0, horizon: 12 };
  const p = { on: true, adopt: 1, every: 3, value: 100, discount: 0.1, churn: 0, cannibal: 0 };
  close(sum(replenishStream(b, p)), 4 * 100 * (0.5 - 0.1));                  // 160
  close(sum(replenishStream(b, { ...p, cannibal: 0.5 })), 4 * (0.5 * 100 * 0.4 - 0.5 * 100 * 0.1)); // 60
});

test('membership: fee minus perks charged upfront each year', () => {
  const b = { ...DEFAULTS.base, discountRate: 0, horizon: 24 };
  const m = { on: true, adopt: 1, fee: 50, perkCost: 20, renewal: 1, freqLift: 0 };
  close(sum(membershipStream(b, m)), 2 * 30);
  close(sum(membershipStream(b, { ...m, renewal: 0.5 })), 30 + 0.5 * 30);
});

test('loyalty adds value only when members buy more or stay longer than rewards cost', () => {
  const b = { ...DEFAULTS.base };
  const l = { on: true, join: 0.5, freqLift: 0.2, retentionLift: 0.05, rewardCost: 0.05 };
  assert.ok(sum(loyaltyStream(b, l)) > 0);
  assert.ok(sum(loyaltyStream(b, { ...l, freqLift: 0, retentionLift: 0 })) < 0); // pure cost
});

test('referral value = expected referrals x (referred CLV x premium - reward)', () => {
  const b = { ...DEFAULTS.base, retention: 0.999, discountRate: 0, horizon: 12 };
  const r = { on: true, rate: 0.12, premium: 0.16, reward: 40, countCac: false };
  const s = Math.pow(0.999, 1 / 12);
  let refs = 0; for (let t = 1; t <= 12; t++) refs += Math.pow(s, t) * 0.01;
  close(sum(referralStream(b, r)), refs * (sum(valueStream(b)) * 1.16 - 40));
});

test('platform fees are spread across new customers', () => {
  const p = clone();
  close(platformCostPerCustomer(p.base, p), (800 + 400 + 300 + 0) / 2000);
  p.loyalty.on = false;
  close(platformCostPerCustomer(p.base, p), (400 + 300) / 2000);
});

test('total CLV = baseline + program streams - platform cost, and payback is consistent', () => {
  const p = clone(); const r = run(p);
  close(r.clv, r.clvBase + r.totals.loyalty + r.totals.referral + r.totals.replenish + r.totals.membership - r.platform);
  close(r.cumAll.at(-1), r.clv);
  close(r.cumBase.at(-1), r.clvBase);
  if (r.payback !== null) assert.ok(r.cumAll[r.payback] >= p.base.cac && (r.payback === 0 || r.cumAll[r.payback - 1] < p.base.cac));
});

test('all programs off = baseline', () => {
  const p = clone(); for (const k of ['loyalty', 'referral', 'replenish', 'membership']) p[k].on = false;
  const r = run(p); close(r.clv, r.clvBase);
});

test('sensitivity is sorted by swing', () => {
  const s = sensitivity(clone());
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].swing >= s[i].swing);
});
