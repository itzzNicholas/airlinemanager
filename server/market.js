'use strict';
// Mercato carburante: prezzo del jet fuel derivato dal Brent reale (Yahoo Finance),
// con fallback sintetico deterministico se la rete non è disponibile.
const { rng, clamp } = require('./util');

const DAY = 86400000;
let history = [];            // [{t, p}] $/tonnellata, ordinato per tempo
let live = null;             // prezzo corrente (se disponibile)
let source = 'sim';
let lastFetch = 0;
let fetching = false;

const jetFromBrent = (brent) => Math.round((brent + 24) * 7.88 * 100) / 100;

function synthetic() {
  const r = rng(Math.floor(Date.now() / DAY / 30));
  const out = [];
  let p = 820;
  const today = Math.floor(Date.now() / DAY) * DAY;
  for (let i = 364; i >= 0; i--) {
    p += (820 - p) * 0.02 + (r() - 0.5) * 2 * p * 0.018;
    out.push({ t: today - i * DAY, p: Math.round(p * 100) / 100 });
  }
  return out;
}

async function refresh(force) {
  if (fetching) return;
  if (!force && Date.now() - lastFetch < 30 * 60 * 1000 && history.length) return;
  fetching = true;
  lastFetch = Date.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?range=1y&interval=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0 (AirlineManager)' }, signal: ctl.signal,
    });
    clearTimeout(to);
    const j = await res.json();
    const r = j.chart.result[0];
    const ts = r.timestamp, cl = r.indicators.quote[0].close;
    const arr = [];
    for (let i = 0; i < ts.length; i++) {
      if (cl[i] == null) continue;
      arr.push({ t: Math.floor(ts[i] * 1000 / DAY) * DAY, p: jetFromBrent(cl[i]) });
    }
    if (arr.length < 30) throw new Error('too few points');
    history = arr;
    if (r.meta && r.meta.regularMarketPrice) live = jetFromBrent(r.meta.regularMarketPrice);
    source = 'live';
  } catch (e) {
    if (!history.length) { history = synthetic(); source = 'sim'; }
  } finally { fetching = false; }
}

function ensure() { if (!history.length) { history = synthetic(); source = 'sim'; } refresh(false); }

function current() {
  ensure();
  const base = live != null ? live : history[history.length - 1].p;
  const m = Math.floor(Date.now() / 60000);
  const wob = Math.sin(m * 0.37) * 0.0018 + Math.sin(m * 0.071) * 0.0025;
  return Math.round(base * (1 + wob) * 100) / 100;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

function analyze() {
  ensure();
  const cur = current();
  const prices = history.map((h) => h.p);
  const last = (n) => prices.slice(-n);
  const m30 = mean(last(30)), m90 = mean(last(90));
  const w90 = last(90);
  const pct = w90.filter((v) => v < cur).length / w90.length;
  // regressione lineare ultimi 14 giorni
  const y = last(14), n = y.length;
  const xm = (n - 1) / 2, ym = mean(y);
  let num = 0, den = 0;
  y.forEach((v, i) => { num += (i - xm) * (v - ym); den += (i - xm) ** 2; });
  const slope = den ? num / den : 0;
  const rets = [];
  const l30 = last(31);
  for (let i = 1; i < l30.length; i++) rets.push(Math.log(l30[i] / l30[i - 1]));
  const rm = mean(rets);
  const vol = Math.sqrt(mean(rets.map((r) => (r - rm) ** 2))) || 0.015;
  const m60 = mean(last(60));
  const fc = [];
  let f = cur;
  const t0 = Math.floor(Date.now() / DAY) * DAY;
  for (let k = 1; k <= 14; k++) {
    f = f + slope * Math.pow(0.82, k) + 0.07 * (m60 - f);
    const band = cur * vol * Math.sqrt(k) * 1.28;
    fc.push({ t: t0 + k * DAY, p: Math.round(f * 100) / 100, lo: Math.round((f - band) * 100) / 100, hi: Math.round((f + band) * 100) / 100 });
  }
  const exp7 = fc[6].p / cur - 1;
  let best = fc[0], bestK = 1;
  fc.forEach((d, i) => { if (d.p < best.p) { best = d; bestK = i + 1; } });
  const score = (0.5 - pct) * 2 * 0.6 + clamp(-exp7 / 0.05, -1, 1) * 0.4; // >0 = conviene comprare
  let action = score > 0.22 ? 'buy' : score < -0.22 ? 'wait' : 'neutral';
  if (action === 'buy' && (cur - best.p) / cur > 0.02) action = 'neutral';
  return {
    source, current: cur, history: history.slice(-180), forecast: fc,
    stats: { m30, m90, pct, slope, vol, exp7, min90: Math.min(...w90), max90: Math.max(...w90) },
    advice: { action, score, bestDay: bestK, bestPrice: best.p, saving: Math.max(0, (cur - best.p) / cur) },
  };
}

module.exports = { refresh, current, analyze, ensure };
