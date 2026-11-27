import { DEFAULTS, run, sensitivity } from './model.js';

const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n, dp = 2) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signed = (n, dp = 2) => (n >= 0 ? '+' : '−') + money(Math.abs(n), dp);
const C = { ink: '#1d1d1f', gain: css('--bronze'), loss: '#c8494a', base: '#b9ae9f', s1: css('--s1'), s2: css('--s2') };

const GROUPS = [
  { g: 'base', title: 'Your customers', sub: 'Before any program', fields: [
    ['aov', 'Average order', '$'], ['margin', 'Contribution margin', '%'],
    ['ordersPerYear', 'Repeat orders / year', 'n', 0.1], ['retention', 'Still active after 1 year', '%'],
    ['cac', 'Cost to acquire', '$'], ['newPerMonth', 'New customers / month', 'n', 1],
    ['horizon', 'Time horizon', 'mo', 1], ['discountRate', 'Discount rate / year', '%'],
  ] },
  { g: 'loyalty', title: 'Loyalty program', sub: 'Points or tiers', fields: [
    ['join', 'Customers who join', '%'], ['freqLift', 'Members order more by', '%'],
    ['retentionLift', 'Retention lift (pts)', 'pts'], ['rewardCost', 'Reward cost, % of spend', '%'],
    ['platform', 'Platform fee / month', '$'],
  ] },
  { g: 'referral', title: 'Referral program', sub: 'Give-get rewards', fields: [
    ['rate', 'Successful referrals / customer / yr', 'n', 0.01], ['premium', 'Referred customers worth more by', '%'],
    ['reward', 'Rewards per referral (both sides)', '$'], ['platform', 'Platform fee / month', '$'],
    ['countCac', 'Count saved acquisition cost', 'bool'],
  ] },
  { g: 'replenish', title: 'Replenishment subscription', sub: 'Auto-reorder of consumables', fields: [
    ['adopt', 'Customers who subscribe', '%'], ['every', 'Ships every', 'mo', 1],
    ['value', 'Subscription order value', '$'], ['discount', 'Subscriber discount', '%'],
    ['churn', 'Monthly cancellation', '%'], ['cannibal', 'Orders that would happen anyway', '%'],
    ['platform', 'App fee / month', '$'],
  ] },
  { g: 'membership', title: 'Paid membership', sub: 'Yearly fee for perks', fields: [
    ['adopt', 'Customers who join', '%'], ['fee', 'Yearly fee', '$'],
    ['perkCost', 'Perk cost / member / yr', '$'], ['renewal', 'Members who renew', '%'],
    ['freqLift', 'Members order more by', '%'], ['platform', 'Platform fee / month', '$'],
  ] },
];
const PROGRAMS = [['loyalty', 'Loyalty'], ['referral', 'Referral'], ['replenish', 'Replenishment'], ['membership', 'Membership']];

let state = structuredClone(DEFAULTS);
try { const s = JSON.parse(decodeURIComponent(atob(location.hash.slice(1)))); if (s && s.base) state = s; } catch { /* defaults */ }

// --- inputs ---------------------------------------------------------------------
function buildInputs() {
  $('#inputs').innerHTML = GROUPS.map(({ g, title, sub, fields }) => `
    <div class="group ${g !== 'base' && !state[g].on ? 'off' : ''}" data-g="${g}">
      <div class="group-h"><div>${title}<small>${sub}</small></div>${g === 'base' ? '' : `<label class="switch" title="Turn ${title} on or off"><input type="checkbox" data-toggle="${g}" ${state[g].on ? 'checked' : ''} aria-label="Include ${title}"><span></span></label>`}</div>
      <div class="fields">${fields.map(([k, label, kind, step]) => kind === 'bool'
        ? `<label class="check-line"><input type="checkbox" data-g="${g}" data-k="${k}" ${state[g][k] ? 'checked' : ''}> ${label}</label>`
        : `<div class="field"><label for="${g}-${k}">${label}</label><div class="inp">${kind === '$' ? '<span>$</span>' : ''}<input id="${g}-${k}" data-g="${g}" data-k="${k}" data-kind="${kind}" type="number" min="0" step="${step || (kind === '$' ? 'any' : 1)}" value="${display(state[g][k], kind)}">${kind === '%' || kind === 'pts' ? '<span class="suf">%</span>' : kind === 'mo' ? '<span class="suf">mo</span>' : ''}</div></div>`).join('')}</div>
    </div>`).join('');
  $('#inputs').querySelectorAll('input[data-k]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
    const { g, k, kind } = el.dataset;
    state[g][k] = el.type === 'checkbox' ? el.checked : parse(el.value, kind);
    update();
  }));
  $('#inputs').querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('change', () => {
    state[el.dataset.toggle].on = el.checked; el.closest('.group').classList.toggle('off', !el.checked); update();
  }));
}
const display = (v, kind) => kind === '%' || kind === 'pts' ? +(v * 100).toFixed(2) : v;
const parse = (v, kind) => { const n = Math.max(0, +v || 0); return kind === '%' || kind === 'pts' ? n / 100 : kind === 'mo' ? Math.max(1, Math.round(n)) : n; };

$('#reset').addEventListener('click', () => { state = structuredClone(DEFAULTS); buildInputs(); update(); });

// --- tooltip ----------------------------------------------------------------------
const tip = $('#tip');
function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; const r = tip.getBoundingClientRect(); let l = x + 14, t = y + 14; if (l + r.width > innerWidth - 8) l = x - r.width - 14; if (t + r.height > innerHeight - 8) t = y - r.height - 14; tip.style.left = Math.max(8, l) + 'px'; tip.style.top = Math.max(8, t) + 'px'; }
const hideTip = () => { tip.hidden = true; };
function niceStep(raw) { const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9))); const n = raw / p; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p; }

// --- render -----------------------------------------------------------------------
let R;
function update() {
  R = run(state);
  const b = state.base;
  const pb = m => m === null ? `not within ${b.horizon} mo` : m === 0 ? 'first order' : `month ${m}`;
  const d = R.clv - R.clvBase;
  $('#kpis').innerHTML = [
    [money(R.clvBase), 'Lifetime value, no programs', `Over ${b.horizon} months, today's dollars`],
    [money(R.clv) + `<span class="delta ${d < 0 ? 'neg' : ''}">${d >= 0 ? '+' : '−'}${Math.abs(R.lift * 100).toFixed(1)}%</span>`, 'Lifetime value, with programs', `${signed(d)} per customer`],
    [`${R.ratio.toFixed(1)}×`, 'Value to acquisition cost', `Up from ${R.ratioBase.toFixed(1)}× · 3× is a common target`],
    [R.payback === null ? 'None' : R.payback === 0 ? 'Order 1' : `Mo ${R.payback}`, 'Pays back acquisition cost', `Without programs: ${pb(R.paybackBase)}`],
  ].map(([v, l, s]) => `<div class="kpi"><b>${v}</b><div class="k-l">${l}</div><div class="k-s">${s}</div></div>`).join('');
  renderWaterfall(); renderPayback(); renderPrograms(); renderTornado();
  history.replaceState(null, '', '#' + btoa(encodeURIComponent(JSON.stringify(state))));
}

function renderWaterfall() {
  const el = $('#waterfall');
  const steps = [{ label: 'No programs', v: R.clvBase, total: true }];
  for (const [k, name] of PROGRAMS) if (state[k].on) steps.push({ label: name, v: R.totals[k] });
  if (R.platform > 0) steps.push({ label: 'Platform fees', v: -R.platform });
  steps.push({ label: 'With programs', v: R.clv, total: true });
  const W = Math.max(300, el.clientWidth || 800), narrow = W < 560;
  if (narrow) return renderWaterfallRows(el, steps, W);
  const H = 300, m = { t: 26, r: 8, b: 34, l: 54 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  let run_ = 0; const bars = steps.map(s => { if (s.total) { run_ = s.v; return { ...s, y0: 0, y1: s.v }; } const y0 = run_; run_ += s.v; return { ...s, y0, y1: run_ }; });
  const yMax = Math.max(...bars.map(b => Math.max(b.y0, b.y1))) * 1.08, yMin = Math.min(0, ...bars.map(b => Math.min(b.y0, b.y1)));
  const step = niceStep((yMax - yMin) / 4); const top = Math.ceil(yMax / step) * step;
  const Y = v => m.t + ih - ((v - yMin) / (top - yMin)) * ih;
  const bw = iw / bars.length, gap = Math.min(18, bw * 0.28);
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<g class="grid"><line x1="${m.l}" x2="${m.l + iw}" y1="${Y(v)}" y2="${Y(v)}"/></g><g class="axis"><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">$${Math.round(v)}</text></g>`;
  bars.forEach((b, i) => {
    const x = m.l + i * bw + gap / 2, w = bw - gap, ya = Y(Math.max(b.y0, b.y1)), yb = Y(Math.min(b.y0, b.y1)), h = Math.max(2, yb - ya);
    const fill = b.total ? (i === 0 ? C.base : C.ink) : b.v >= 0 ? C.gain : C.loss;
    g += `<rect class="wbar" data-i="${i}" x="${x}" y="${ya}" width="${w}" height="${h}" rx="4" fill="${fill}"/>`;
    if (i < bars.length - 1) g += `<line x1="${x + w}" x2="${x + w + gap}" y1="${Y(b.y1)}" y2="${Y(b.y1)}" stroke="#b9ae9f" stroke-dasharray="2 2"/>`;
    g += `<text class="dlabel" x="${x + w / 2}" y="${ya - 7}" text-anchor="middle" style="font-weight:600;fill:var(--ink)">${b.total ? '$' + b.v.toFixed(0) : (b.v >= 0 ? '+' : '−') + '$' + Math.abs(b.v).toFixed(b.v !== 0 && Math.abs(b.v) < 10 ? 2 : 0)}</text>`;
    const lbl = (narrow || bw < 100) ? b.label.replace('No programs', 'Base').replace('With programs', 'Total').replace('Replenishment', 'Replen.').replace('Platform fees', 'Fees').replace('Membership', 'Member') : b.label;
    g += `<g class="axis"><text x="${x + w / 2}" y="${H - (narrow ? 26 : 12)}" text-anchor="middle">${lbl}</text></g>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Waterfall of lifetime value from baseline to total with programs">${g}</svg>`;
  el.querySelectorAll('.wbar').forEach(r => {
    r.addEventListener('pointermove', e => { const b = bars[+r.dataset.i]; showTip(`<b>${b.label}</b><br>${b.total ? money(b.v) + ' per customer' : signed(b.v) + ' per customer'}`, e.clientX, e.clientY); });
    r.addEventListener('pointerleave', hideTip);
  });
}

// Horizontal waterfall for small screens: one row per step
function renderWaterfallRows(el, steps, W) {
  const m = { l: 92, r: 58 }, rowH = 32, iw = W - m.l - m.r, H = steps.length * rowH + 4;
  let run_ = 0; const bars = steps.map(s => { if (s.total) { run_ = s.v; return { ...s, a: 0, b: s.v }; } const a = run_; run_ += s.v; return { ...s, a, b: run_ }; });
  const max = Math.max(...bars.map(b => Math.max(b.a, b.b))), X = v => m.l + (v / max) * iw;
  let g = '';
  bars.forEach((b, i) => {
    const y = i * rowH + 6, h = rowH - 12, x0 = X(Math.min(b.a, b.b)), w = Math.max(2, Math.abs(X(b.b) - X(b.a)));
    const fill = b.total ? (i === 0 ? C.base : C.ink) : b.v >= 0 ? C.gain : C.loss;
    g += `<g class="axis"><text x="${m.l - 8}" y="${y + h / 2 + 4}" text-anchor="end" style="fill:var(--ink)">${esc(b.label.replace('No programs', 'Baseline').replace('With programs', 'Total'))}</text></g>`;
    g += `<rect x="${x0}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}"/>`;
    g += `<text class="dlabel" x="${x0 + w + 6}" y="${y + h / 2 + 4}" style="font-weight:600;fill:var(--ink)">${b.total ? '$' + b.v.toFixed(0) : (b.v >= 0 ? '+' : '−') + '$' + Math.abs(b.v).toFixed(2)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Waterfall of lifetime value from baseline to total with programs">${g}</svg>`;
}

function renderPayback() {
  const el = $('#payback'), b = state.base, H_ = b.horizon;
  $('#legend').innerHTML = `<span style="display:inline-flex;align-items:center;gap:7px"><i style="background:${C.s1}"></i>With programs</span><span style="display:inline-flex;align-items:center;gap:7px"><i style="background:${C.base}"></i>No programs</span><span style="display:inline-flex;align-items:center;gap:7px"><i style="background:${C.s2}"></i>Cost to acquire (${money(b.cac, 0)})</span>`;
  const W = Math.max(320, el.clientWidth || 800), H = W < 560 ? 240 : 290, m = { t: 12, r: 14, b: 30, l: 54 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const yMax0 = Math.max(b.cac, ...R.cumAll, ...R.cumBase) * 1.05; const yMin = Math.min(0, ...R.cumAll);
  const step = niceStep((yMax0 - yMin) / 4), yMax = Math.ceil(yMax0 / step) * step;
  const X = t => m.l + (t / H_) * iw, Y = v => m.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  let g = '';
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) g += `<g class="grid"><line x1="${m.l}" x2="${m.l + iw}" y1="${Y(v)}" y2="${Y(v)}"/></g><g class="axis"><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">$${Math.round(v)}</text></g>`;
  const tStep = H_ > 24 ? 6 : 3;
  for (let t = 0; t <= H_; t += tStep) g += `<g class="axis"><text x="${X(t)}" y="${H - 8}" text-anchor="middle">${t === 0 ? 'Order 1' : 'Mo ' + t}</text></g>`;
  g += `<line x1="${m.l}" x2="${m.l + iw}" y1="${Y(b.cac)}" y2="${Y(b.cac)}" stroke="${C.s2}" stroke-width="2" stroke-dasharray="5 4"/>`;
  const path = arr => arr.map((v, t) => `${t ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  g += `<path d="${path(R.cumBase)}" fill="none" stroke="${C.base}" stroke-width="2"/><path d="${path(R.cumAll)}" fill="none" stroke="${C.s1}" stroke-width="2"/>`;
  for (const [pbm, arr, col] of [[R.paybackBase, R.cumBase, C.base], [R.payback, R.cumAll, C.s1]]) if (pbm !== null) g += `<circle cx="${X(pbm)}" cy="${Y(arr[pbm])}" r="5" fill="${col}" stroke="#fff" stroke-width="2"/>`;
  g += `<line id="xh2" y1="${m.t}" y2="${m.t + ih}" stroke="#b9ae9f" stroke-dasharray="3 3" visibility="hidden"/><rect id="hit2" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative profit per customer against acquisition cost">${g}</svg>`;
  const svg = el.querySelector('svg'), xh = svg.querySelector('#xh2');
  svg.querySelector('#hit2').addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(); const t = Math.max(0, Math.min(H_, Math.round((((e.clientX - r.left) * (W / r.width)) - m.l) / iw * H_)));
    xh.setAttribute('x1', X(t)); xh.setAttribute('x2', X(t)); xh.setAttribute('visibility', 'visible');
    showTip(`<b>${t === 0 ? 'First order' : 'Month ' + t}</b><div class="row"><span><i style="background:${C.s1}"></i>With programs</span><span>${money(R.cumAll[t])}</span></div><div class="row"><span><i style="background:${C.base}"></i>No programs</span><span>${money(R.cumBase[t])}</span></div>`, e.clientX, e.clientY);
  });
  svg.querySelector('#hit2').addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); hideTip(); });
}

function renderPrograms() {
  const b = state.base;
  const share = { loyalty: state.loyalty.join, referral: 1, replenish: state.replenish.adopt, membership: state.membership.adopt };
  const rows = PROGRAMS.map(([k, name]) => {
    const on = state[k].on, perCust = R.totals[k], fee = on ? (state[k].platform || 0) / b.newPerMonth : 0;
    const perPart = share[k] > 0 ? perCust / share[k] : 0, net = perCust - fee;
    return `<tr><td><b>${name}</b>${on ? '' : ' <span class="muted">(off)</span>'}</td>
      <td class="num">${on ? (k === 'referral' ? 'All customers' : (share[k] * 100).toFixed(0) + '%') : '<span class="muted">-</span>'}</td>
      <td class="num">${on ? signed(perPart) : '<span class="muted">-</span>'}</td>
      <td class="num">${on ? signed(perCust) : '<span class="muted">-</span>'}</td>
      <td class="num">${on ? (fee ? '−' + money(fee) : '$0.00') : '<span class="muted">-</span>'}</td>
      <td class="num ${on ? (net >= 0 ? 'pos' : 'neg') : ''}"><b>${on ? signed(net) : '<span class="muted">-</span>'}</b></td>
      <td class="num">${on ? `${money(net * b.newPerMonth * 12, 0)}` : '<span class="muted">-</span>'}</td></tr>`;
  }).join('');
  $('#programs').innerHTML = `<thead><tr><th>Program</th><th>Who's in</th><th>Per participant</th><th>Per customer</th><th>Platform fee</th><th>Net per customer</th><th>Yearly impact</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderTornado() {
  const el = $('#tornado'); const rows = sensitivity(state).slice(0, 8);
  const W = Math.max(320, el.clientWidth || 800), narrow = W < 560, rowH = 30, m = { t: 22, r: 60, b: 8, l: narrow ? 130 : 190 };
  const H = m.t + rows.length * rowH + m.b, iw = W - m.l - m.r;
  const maxAbs = Math.max(1, ...rows.flatMap(r => [Math.abs(r.low), Math.abs(r.high)]));
  const X = v => m.l + iw / 2 + (v / maxAbs) * (iw / 2);
  let g = `<g class="axis"><text x="${X(-maxAbs)}" y="12">20% lower</text><text x="${X(maxAbs)}" y="12" text-anchor="end">20% higher</text></g><line x1="${X(0)}" x2="${X(0)}" y1="${m.t - 4}" y2="${H - m.b}" stroke="#b9ae9f"/>`;
  rows.forEach((r, i) => {
    const y = m.t + i * rowH + 6, h = rowH - 12;
    g += `<g class="axis"><text x="${m.l - 10}" y="${y + h / 2 + 4}" text-anchor="end" style="fill:var(--ink)">${esc(narrow ? r.label.replace('Subscription', 'Sub.').replace('Membership', 'Member.') : r.label)}</text></g>`;
    for (const [v, side] of [[r.low, 'low'], [r.high, 'high']]) {
      const x0 = Math.min(X(0), X(v)), w = Math.max(2, Math.abs(X(v) - X(0)));
      g += `<rect class="tbar" data-i="${i}" x="${x0}" y="${y}" width="${w}" height="${h}" rx="3" fill="${v >= 0 ? C.gain : C.loss}" opacity="${side === 'low' ? 0.75 : 1}"/>`;
    }
    g += `<text class="dlabel" x="${Math.max(X(r.high), X(r.low)) + 6}" y="${y + h / 2 + 4}">±$${(r.swing / 2).toFixed(0)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sensitivity of lifetime value to each assumption">${g}</svg>`;
  el.querySelectorAll('.tbar').forEach(b => {
    b.addEventListener('pointermove', e => { const r = rows[+b.dataset.i]; showTip(`<b>${esc(r.label)}</b><br>20% lower: ${signed(r.low)}<br>20% higher: ${signed(r.high)}`, e.clientX, e.clientY); });
    b.addEventListener('pointerleave', hideTip);
  });
}

buildInputs(); update();
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(update, 150); });
