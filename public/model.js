// Customer lifetime value (CLV) model with loyalty, referral and subscription programs.
// Pure functions, shared by the page and the tests.
//
// Everything is modelled per newly acquired customer, month by month, as
// contribution (revenue x margin, net of program costs), discounted to today.
// Month 0 is the first order. Each program adds an incremental stream on top
// of the baseline; programs are assumed independent of each other.

export const DEFAULTS = {
  base: {
    aov: 120,               // average order value ($)
    margin: 0.55,           // contribution margin after product + fulfilment costs
    ordersPerYear: 1.4,     // repeat orders per year while a customer is active
    retention: 0.40,        // share of customers still active a year later
    discountRate: 0.10,     // annual rate for discounting future cash
    horizon: 36,            // months
    cac: 90,                // cost to acquire a customer ($)
    newPerMonth: 2000,      // new customers per month (spreads fixed platform fees)
  },
  loyalty: { on: true, join: 0.45, freqLift: 0.20, retentionLift: 0.08, rewardCost: 0.05, platform: 800 },
  referral: { on: true, rate: 0.06, premium: 0.16, reward: 40, countCac: false, platform: 400 },
  replenish: { on: true, adopt: 0.10, every: 3, value: 45, discount: 0.10, churn: 0.08, cannibal: 0.30, platform: 300 },
  membership: { on: true, adopt: 0.06, fee: 49, perkCost: 25, renewal: 0.55, freqLift: 0.30, platform: 0 },
};

const df = (r, t) => Math.pow(1 + r, -t / 12);            // discount factor for month t
const monthlySurvival = annual => Math.pow(Math.min(Math.max(annual, 0), 0.999), 1 / 12);
const sum = a => a.reduce((s, v) => s + v, 0);
const zeros = h => new Array(h + 1).fill(0);

// Baseline (or loyalty-member) value stream: first order + repeat orders while active.
export function valueStream({ aov, margin, ordersPerYear, retention, discountRate, horizon }, { costRate = 0 } = {}) {
  const s = monthlySurvival(retention);
  const out = zeros(horizon);
  out[0] = aov * margin;
  for (let t = 1; t <= horizon; t++) out[t] = Math.pow(s, t) * (ordersPerYear / 12) * aov * (margin - costRate) * df(discountRate, t);
  return out;
}

export function loyaltyStream(b, l) {
  if (!l.on) return zeros(b.horizon);
  const base = valueStream(b);
  const member = valueStream({ ...b, ordersPerYear: b.ordersPerYear * (1 + l.freqLift), retention: Math.min(0.98, b.retention + l.retentionLift) }, { costRate: l.rewardCost });
  return member.map((v, t) => l.join * (v - base[t]));
}

// Referral value: successful referrals made each month while active, each worth
// the referred customer's baseline CLV (plus a premium), less rewards paid.
export function referralStream(b, r) {
  if (!r.on) return zeros(b.horizon);
  const s = monthlySurvival(b.retention);
  const referredValue = sum(valueStream(b)) * (1 + r.premium) - r.reward + (r.countCac ? b.cac : 0);
  const out = zeros(b.horizon);
  for (let t = 1; t <= b.horizon; t++) out[t] = Math.pow(s, t) * (r.rate / 12) * referredValue * df(b.discountRate, t);
  return out;
}

// Replenishment subscription: an extra order every `every` months while subscribed.
// Some of those orders would have happened anyway at full price (cannibalisation):
// on those you only give away the discount; on the rest you earn margin minus discount.
export function replenishStream(b, p) {
  if (!p.on) return zeros(b.horizon);
  const out = zeros(b.horizon);
  const perOrder = (1 - p.cannibal) * p.value * (b.margin - p.discount) - p.cannibal * p.value * p.discount;
  for (let t = p.every; t <= b.horizon; t += p.every) out[t] = p.adopt * Math.pow(1 - p.churn, t) * perOrder * df(b.discountRate, t);
  return out;
}

// Paid membership: annual fee (charged upfront each year) minus perk cost,
// plus extra orders from members while they stay members and active.
export function membershipStream(b, m) {
  if (!m.on) return zeros(b.horizon);
  const out = zeros(b.horizon);
  const s = monthlySurvival(b.retention);
  for (let y = 0; y * 12 < b.horizon; y++) out[y * 12] += m.adopt * Math.pow(m.renewal, y) * (m.fee - m.perkCost) * df(b.discountRate, y * 12);
  for (let t = 1; t <= b.horizon; t++) {
    const stillMember = Math.pow(m.renewal, Math.floor(t / 12));
    out[t] += m.adopt * stillMember * Math.pow(s, t) * (b.ordersPerYear / 12) * m.freqLift * b.aov * b.margin * df(b.discountRate, t);
  }
  return out;
}

// Fixed monthly platform fees, spread across the customers acquired each month.
export function platformCostPerCustomer(b, programs) {
  const monthly = ['loyalty', 'referral', 'replenish', 'membership'].reduce((s, k) => s + (programs[k].on ? programs[k].platform || 0 : 0), 0);
  return b.newPerMonth > 0 ? monthly / b.newPerMonth : 0;
}

export function run(inputs) {
  const b = inputs.base;
  const streams = {
    base: valueStream(b),
    loyalty: loyaltyStream(b, inputs.loyalty),
    referral: referralStream(b, inputs.referral),
    replenish: replenishStream(b, inputs.replenish),
    membership: membershipStream(b, inputs.membership),
  };
  const platform = platformCostPerCustomer(b, inputs);
  const totals = Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, sum(v)]));
  const clvBase = totals.base;
  const clv = clvBase + totals.loyalty + totals.referral + totals.replenish + totals.membership - platform;

  // cumulative discounted contribution by month, for payback
  const cumBase = [], cumAll = [];
  let a = 0, c = -platform;
  for (let t = 0; t <= b.horizon; t++) {
    a += streams.base[t];
    c += streams.base[t] + streams.loyalty[t] + streams.referral[t] + streams.replenish[t] + streams.membership[t];
    cumBase.push(a); cumAll.push(c);
  }
  const payback = cum => { const i = cum.findIndex(v => v >= b.cac); return i < 0 ? null : i; };

  return {
    streams, totals, platform, clvBase, clv,
    lift: clvBase > 0 ? clv / clvBase - 1 : 0,
    ratioBase: b.cac > 0 ? clvBase / b.cac : Infinity,
    ratio: b.cac > 0 ? clv / b.cac : Infinity,
    cumBase, cumAll, paybackBase: payback(cumBase), payback: payback(cumAll),
  };
}

// Which assumptions move CLV the most? Each one is nudged down and up by `pct`.
export const SENSITIVITY_KEYS = [
  ['base', 'aov', 'Average order value'],
  ['base', 'margin', 'Contribution margin'],
  ['base', 'ordersPerYear', 'Repeat orders per year'],
  ['base', 'retention', 'Annual retention'],
  ['loyalty', 'join', 'Loyalty join rate'],
  ['loyalty', 'freqLift', 'Loyalty order lift'],
  ['referral', 'rate', 'Referral rate'],
  ['replenish', 'adopt', 'Subscription adoption'],
  ['replenish', 'churn', 'Subscription churn'],
  ['membership', 'adopt', 'Membership adoption'],
  ['membership', 'renewal', 'Membership renewal'],
];
export function sensitivity(inputs, pct = 0.2) {
  const baseClv = run(inputs).clv;
  return SENSITIVITY_KEYS
    .filter(([g]) => g === 'base' || inputs[g].on)
    .map(([g, k, label]) => {
      const at = f => run({ ...inputs, [g]: { ...inputs[g], [k]: inputs[g][k] * f } }).clv;
      const low = at(1 - pct) - baseClv, high = at(1 + pct) - baseClv;
      return { group: g, key: k, label, low, high, swing: Math.abs(high - low) };
    })
    .sort((x, y) => y.swing - x.swing);
}
