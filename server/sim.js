'use strict';
// ---------------------------------------------------------------------------
// Motore di simulazione di AirlineManager.
// Tutto lo stato di una partita è un oggetto JSON serializzabile (g).
// Il tempo di gioco avanza a "speed" volte il tempo reale; la simulazione è a
// eventi (voli, consegne, manutenzioni, addestramenti, fine giornata) e
// "recupera" il tempo trascorso ogni volta che il client interroga lo stato.
// ---------------------------------------------------------------------------
const D = require('./data');
const U = require('./util');
const market = require('./market');
const weather = require('./weather');

const H = 3600e3, DAY = 24 * H;
const SPEEDS = [0, 60, 120, 360, 720, 1800];
const LANGS = ['it', 'en', 'ru'];
const WAGE = { cabin: 130, mech: 160, ground: 100 };
const COURSES = {
  service: { base: 80000, max: 5 },
  safety: { base: 120000, max: 5 },
  eco: { base: 200000, max: 5 },
  ground: { base: 100000, max: 5 },
};
const PILOT_UPG = { cost: [12000, 30000, 60000, 120000, 250000], days: [2, 3, 5, 8, 12] };

const RIVALS = [
  { id: 'sky', name: 'Skyline Airways', hub: 'LHR', color: '#ef4444', fleet: 38 },
  { id: 'atl', name: 'Atlas Global', hub: 'JFK', color: '#f59e0b', fleet: 46 },
  { id: 'sak', name: 'Sakura Air', hub: 'HND', color: '#ec4899', fleet: 30 },
  { id: 'vol', name: 'Volga Avia', hub: 'SVO', color: '#3b82f6', fleet: 22 },
  { id: 'dsr', name: 'Desert Star', hub: 'DXB', color: '#14b8a6', fleet: 34 },
  { id: 'nrd', name: 'Nordic Wings', hub: 'ARN', color: '#8b5cf6', fleet: 16 },
  { id: 'sam', name: 'Samba Air', hub: 'GRU', color: '#22c55e', fleet: 12 },
  { id: 'pac', name: 'Pacifica', hub: 'SYD', color: '#06b6d4', fleet: 9 },
];

const NAMES = {
  it: [['Marco', 'Luca', 'Giulia', 'Sofia', 'Alessandro', 'Chiara', 'Matteo', 'Elena', 'Davide', 'Francesca'], ['Rossi', 'Bianchi', 'Romano', 'Conti', 'Ferrari', 'Esposito', 'Greco', 'Marino', 'Ricci', 'Gallo']],
  en: [['James', 'Emma', 'Oliver', 'Grace', 'Liam', 'Ava', 'Noah', 'Mia', 'Jack', 'Chloe'], ['Smith', 'Taylor', 'Brown', 'Wilson', 'Clark', 'Walker', 'Hall', 'Young', 'King', 'Wright']],
  ru: [['Иван', 'Дмитрий', 'Наталья', 'Ольга', 'Сергей', 'Анна', 'Алексей', 'Мария', 'Николай', 'Елена'], ['Петров', 'Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Соколов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов']],
};

function fail(code, extra) { const e = new Error(code); e.code = code; e.extra = extra; throw e; }
const rnd = Math.random;
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ------------------------------------------------------------------ nuova partita
function newGame(prev) {
  const now = Date.now();
  const settings = Object.assign({ speed: 360, lang: 'it', autoMaint: true, offline: false, unlimited: false, theme: 'dark' }, prev || {}, { unlimited: false });
  const g = {
    v: 1, company: null, settings, clock: now, lastReal: now, cash: 10e6, rep: 50, nextId: 1,
    fleet: [], routes: [], pilots: [], candidates: [], staff: { cabin: 0, mech: 0, ground: 0 },
    courses: [], levels: { service: 0, safety: 0, eco: 0, ground: 0 },
    depots: {}, bases: [], missions: [], mhist: [], mstats: { done: 0, failed: 0, earned: 0 }, flags: { cheat: false, imported: false, frozen: false }, rt: {},
    ledger: [], daily: [], today: blankDay(), log: [],
    rivals: RIVALS.map((r) => Object.assign({ cash: r.fleet * 4e6, rating: 55 + Math.round(rnd() * 25), routes: r.fleet * 2 }, r)),
    stats: { flights: 0, pax: 0, revenue: 0, cancelled: 0, delayed: 0 },
    dayEdge: (Math.floor(now / DAY) + 1) * DAY,
  };
  return g;
}
function blankDay() { return { revenue: 0, fuel: 0, fees: 0, maintenance: 0, service: 0, payroll: 0, insurance: 0, other: 0, flights: 0, pax: 0, delayed: 0, cancelled: 0 }; }

// ------------------------------------------------------------------ utilità economiche
const nid = (g) => g.nextId++;
function pay(g, amt, cat) { // amt <0 spesa, >0 entrata
  g.cash += amt;
  if (cat) {
    g.today[cat] = (g.today[cat] || 0) + (cat === 'revenue' ? amt : -amt);
    // punteggio per le classifiche: utile operativo per giorno REALE, normalizzato sulla velocita' (360 = 1)
    if (!g.settings.unlimited) {
      const k = new Date(g.lastReal || Date.now()).toISOString().slice(0, 10);
      if (!(k in g.rt)) { g.rt[k] = 0; const ks = Object.keys(g.rt).sort(); while (ks.length > 40) delete g.rt[ks.shift()]; }
      g.rt[k] += amt * 360 / Math.max(1, g.settings.speed);
    }
  }
  if (g.settings.unlimited && g.cash < 1e11) g.cash = 1e12;
}
function canPay(g, amt) { return g.settings.unlimited || g.cash >= amt; }
function need(g, amt) { if (!canPay(g, amt)) fail('noMoney', { need: Math.round(amt) }); }
function led(g, amt, cat, k, p) {
  g.ledger.unshift({ t: g.clock, amt: Math.round(amt), cat, k, p: p || {} });
  if (g.ledger.length > 200) g.ledger.length = 200;
}
function log(g, k, p, lvl) {
  g.log.unshift({ t: g.clock, k, p: p || {}, lvl: lvl || 'info' });
  if (g.log.length > 80) g.log.length = 80;
}
const model = (ac) => D.byModel[ac.model];
const route = (g, id) => g.routes.find((r) => r.id === id);
const airport = (c) => D.byIata[c];
const dist = (a, b) => Math.round(U.distKm(airport(a), airport(b)));
const blockH = (m, d) => d / (m.speed * 0.9) + 0.45;
const comfort = (m) => [0.85, 0.95, 1.0, 1.05, 1.12, 1.2][m.cls] * m.lux;
const lvl = (g, k) => g.levels[k] || 0;

function needs(g) {
  let cabin = 0, ground = 0, ac = 0;
  g.fleet.forEach((a) => { if (a.routeId) { const m = model(a); if (a.role !== 'cargo') cabin += Math.ceil(m.seats / 30); ground += 2 + Math.ceil(m.seats / 60); ac++; } });
  return { cabin, ground, mech: Math.ceil(ac / 2) };
}
function eff(g) {
  const n = needs(g);
  return {
    ground: n.ground ? U.clamp(g.staff.ground / n.ground, 0.4, 1) : 1,
    mech: n.mech ? U.clamp(g.staff.mech / n.mech, 0.4, 1) : 1,
  };
}
function turnH(g, m) { return (0.7 + m.seats / 400) * (1 - 0.05 * lvl(g, 'ground')) / eff(g).ground; }

function rivalsOn(g, a, b) {
  const A = airport(a), B = airport(b);
  const [x, y] = a < b ? [a, b] : [b, a];
  let n = 0;
  g.rivals.forEach((r) => {
    const h = airport(r.hub);
    const local = (h.cont === A.cont ? 1 : 0) + (h.cont === B.cont ? 1 : 0);
    let p = 0.04 + 0.2 * local + ((A.size + B.size) / 20) * 0.25 + r.fleet / 450;
    if (r.hub === a || r.hub === b) p += 0.35;
    if (U.hash01(r.id + x + y) < Math.min(0.85, p)) n++;
  });
  return n;
}

function routeEcon(g, a, b, priceMul) {
  const A = airport(a), B = airport(b);
  const d = dist(a, b);
  const fair = 55 + 0.08 * d;
  const base = 55 * Math.pow(A.size * B.size, 0.85) / (1 + d / 5000);
  const riv = rivalsOn(g, a, b);
  const pm = priceMul || 1;
  const demand = base * Math.pow(pm, -1.7) * (0.55 + 0.009 * g.rep) / (1 + 0.5 * riv);
  return { dist: d, fair: Math.round(fair), base: Math.round(base), demand: Math.round(demand), rivals: riv, slotCost: (A.size + B.size) * 12000 };
}

function modelFits(m, a, b) {
  const d = dist(a, b);
  if (d > m.range * 0.95) return 'range';
  if (airport(a).size < m.minAirport || airport(b).size < m.minAirport) return 'airportSmall';
  return null;
}

function pilotSalary(cls, skill) { return Math.round((90 + cls * 90) * (0.85 + skill / 200)); }
function makePilot(g, pool) {
  const r = rnd();
  const cls = r < 0.3 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.92 ? 3 : r < 0.98 ? 4 : 5;
  const skill = Math.min(99, Math.round(35 + rnd() * 45 + cls * 4));
  const lang = pick(LANGS);
  const names = NAMES[lang];
  const salary = pilotSalary(cls, skill);
  return { id: nid(g), name: pick(names[0]) + ' ' + pick(names[1]), cls, skill, salary, fee: salary * 6, status: 'free', ac: null, hours: 0 };
}
function refreshCandidates(g) { g.candidates = []; for (let i = 0; i < 8; i++) g.candidates.push(makePilot(g)); }

function value(g) {
  let v = g.cash; Object.values(g.depots).forEach((d) => { v += d.tons * d.avgCost; });
  g.fleet.forEach((a) => { v += resale(a); });
  return Math.round(v);
}
function resale(a) {
  const m = model(a);
  return Math.round(m.price * 0.9 * (0.5 + 0.5 * a.cond / 100) * Math.max(0.35, 1 - a.hours / 60000));
}

// ------------------------------------------------------------------ voli
function burnFuel(g, tons, iata) {
  const f = g.depots[iata];
  let cost = 0, fromTank = 0;
  if (f) { fromTank = Math.min(f.tons, tons); cost = fromTank * f.avgCost; f.tons -= fromTank; if (f.tons < 0.0001) { f.tons = 0; f.avgCost = 0; } }
  const short = tons - fromTank;
  if (short > 0.0001) cost += short * market.current() * (f ? 1.25 : 1.4); // acquisto d'emergenza a prezzo spot maggiorato
  pay(g, -cost, 'fuel');
  return cost;
}
const hangarLevel = (g, iata) => { const b = g.bases.find((x) => x.iata === iata); return b ? b.hangar : 0; };
const hasBase = (g, iata) => g.bases.some((x) => x.iata === iata);
const cargoCap = (m) => Math.round(m.seats * (0.06 + 0.025 * m.cls) * 10) / 10;
const cargoRate = (d) => 260 + 0.6 * d;

function startMaintenance(g, ac, t, forced) {
  const m = model(ac);
  const hl = hangarLevel(g, ac.loc);
  const cost = Math.round((m.price * 0.004 * (1 + (100 - ac.cond) / 100) + 400) * (1 - 0.1 * hl));
  const dur = (6 + m.cls * 10) * H / eff(g).mech * (1 - 0.2 * hl);
  pay(g, -cost, 'maintenance');
  ac.status = 'maintenance'; ac.mStart = t; ac.mCost = cost; ac.nextAt = t + dur; ac.flight = null;
  log(g, forced ? 'logBreakdown' : 'logMaint', { ac: ac.name, loc: ac.loc }, forced ? 'warn' : 'info');
}

function depart(g, ac, t) {
  const r = route(g, ac.routeId);
  if (!r) { ac.status = 'idle'; ac.nextAt = null; return; }
  const m = model(ac);
  const from = ac.loc, to = from === r.a ? r.b : r.a;
  const d = dist(from, to);
  if (d > m.range * 0.95) { unassign(g, ac); log(g, 'logRange', { ac: ac.name }, 'warn'); return; }
  const wF = weather.get(from), wT = weather.get(to);
  const sev = Math.max(wF.sev, wT.sev);
  const brkP = ac.cond < 30 ? 0.12 : ac.cond < 45 ? 0.03 : 0;
  if (brkP && rnd() < brkP * (1 - 0.15 * lvl(g, 'safety'))) { startMaintenance(g, ac, t, true); return; }
  if (sev >= 3 && rnd() < 0.3) {
    g.stats.cancelled++; g.today.cancelled++; g.rep = U.clamp(g.rep - 0.05, 0, 100);
    ac.nextAt = t + 2 * H; ac.status = 'boarding';
    log(g, 'logCancel', { ac: ac.name, from, to, w: wF.sev >= wT.sev ? from : to }, 'warn');
    return;
  }
  const econ = routeEcon(g, r.a, r.b, r.priceMul);
  const bH = blockH(m, d) * (1 + 0.04 * sev);
  const tH = turnH(g, m);
  const nAc = Math.max(1, g.fleet.filter((x) => x.routeId === r.id && (x.status === 'boarding' || x.status === 'flying')).length);
  const cycle = 2 * (bH + tH);
  const cargo = ac.role === 'cargo';
  const cap = cargo ? cargoCap(m) : m.seats;
  let load, rev, fare = 0;
  if (cargo) {
    const exp = (econ.demand * 0.08 / 24) * cycle / nAc;
    load = Math.max(0, Math.min(cap, Math.round(exp * (0.9 + rnd() * 0.2) * 10) / 10));
    fare = Math.round(cargoRate(d) * r.priceMul);
    rev = load * fare;
  } else {
    const exp = (econ.demand / 24) * cycle / nAc;
    load = Math.max(0, Math.min(cap, Math.round(exp * (0.9 + rnd() * 0.2))));
    fare = Math.round(econ.fair * r.priceMul * comfort(m));
    rev = load * fare;
  }
  const delayMs = sev * 0.4 * H * (rnd() * 0.5 + 0.75);
  const tons = (m.burn * bH * (1 - 0.03 * lvl(g, 'eco')) * (1 + 0.02 * sev) * (1 + (100 - ac.cond) / 600)) / 1000;
  const fuelCost = burnFuel(g, tons, from);
  const dep = t + delayMs;
  ac.flight = { from, to, dep, arr: dep + bH * H, dist: d, pax: cargo ? 0 : load, cargo: cargo ? load : 0, cap, fare, rev: Math.round(rev), sev, fuelT: Math.round(tons * 10) / 10, fuelCost: Math.round(fuelCost), delayed: delayMs > 0 };
  ac.status = 'flying'; ac.nextAt = ac.flight.arr;
  if (delayMs > 0 && sev >= 2) { g.stats.delayed++; g.today.delayed++; }
}

function arrive(g, ac, t) {
  const f = ac.flight, m = model(ac);
  const r = f.mission ? null : route(g, ac.routeId);
  const hrs = (f.arr - f.dep) / H;
  const revenue = f.rev;
  const fees = ((60 + m.seats * 12) * (0.7 + 0.07 * airport(f.to).size) + f.dist * m.seats * 0.003) * (hasBase(g, f.to) ? 0.9 : 1);
  const maint = m.price * 0.00004 * hrs * (1 + (100 - ac.cond) / 100);
  const service = f.pax * (4 + f.dist * 0.006);
  pay(g, revenue, 'revenue'); pay(g, -fees, 'fees'); pay(g, -maint, 'maintenance'); pay(g, -service, 'service');
  const varCost = f.fuelCost + fees + maint + service;
  g.stats.flights++; g.stats.pax += f.pax; g.stats.revenue += revenue; g.today.flights++; g.today.pax += f.pax;
  ac.flights = (ac.flights || 0) + 1; ac.hours += hrs; ac.revenue = (ac.revenue || 0) + revenue; ac.profit = (ac.profit || 0) + revenue - varCost;
  ac.cond = Math.max(0, ac.cond - hrs * 0.5 * (1 - 0.08 * lvl(g, 'safety')) - rnd() * 0.1);
  ac.loc = f.to; ac.last = { from: f.from, to: f.to, pax: f.pax, cargo: f.cargo, rev: Math.round(revenue), cost: Math.round(varCost) };
  if (r) {
    const s = r.stats;
    s.flights++; s.pax += f.pax; s.seats += f.cap; s.revenue += revenue; s.cost += varCost;
    const lf = (f.pax || f.cargo) / f.cap;
    s.lf = s.flights === 1 ? lf : s.lf * 0.9 + lf * 0.1;
  }
  ac.pilots.forEach((pid) => { const p = g.pilots.find((x) => x.id === pid); if (p) { p.hours += hrs; p.skill = Math.min(99, p.skill + hrs * 0.0015); } });
  ac.flight = null;
  if (f.mission) { completeMission(g, ac, f); return; }
  if (g.settings.autoMaint && ac.cond < 35 && canPay(g, m.price * 0.01)) { startMaintenance(g, ac, t, false); return; }
  ac.status = 'boarding'; ac.nextAt = t + turnH(g, m) * H;
}

function completeMission(g, ac, f) {
  ac.pilots.forEach((pid) => { const p = g.pilots.find((x) => x.id === pid); if (p && p.status === 'assigned') { p.status = 'free'; p.ac = null; } });
  ac.pilots = []; ac.status = 'idle'; ac.nextAt = null;
  g.mstats.done++; g.mstats.earned += f.rev; g.rep = U.clamp(g.rep + 0.8, 0, 100);
  log(g, 'logMissionDone', { m: f.mission.type, c: f.mission.client, r: f.rev }, 'ok');
}

function unassign(g, ac) {
  ac.pilots.forEach((pid) => { const p = g.pilots.find((x) => x.id === pid); if (p && p.status === 'assigned') { p.status = 'free'; p.ac = null; } });
  ac.pilots = []; ac.routeId = null;
  if (ac.status === 'boarding' || ac.status === 'flying') { ac.status = 'idle'; ac.nextAt = null; ac.flight = null; }
}

// ------------------------------------------------------------------ fine giornata
function dayEnd(g, t) {
  // stipendi
  let payroll = 0;
  g.pilots.forEach((p) => { payroll += p.salary; });
  payroll += g.staff.cabin * WAGE.cabin + g.staff.mech * WAGE.mech + g.staff.ground * WAGE.ground;
  pay(g, -payroll, 'payroll');
  let ins = 0;
  g.fleet.forEach((a) => { ins += model(a).price * 0.00025; });
  pay(g, -ins, 'insurance');
  if (g.cash < 0 && !g.settings.unlimited) { const interest = -g.cash * 0.0005; pay(g, -interest, 'other'); }
  // carburante automatico
  Object.keys(g.depots).forEach((iata) => {
    const d = g.depots[iata], fa = d.auto;
    if (fa && fa.on && d.tons < fa.min) {
      const q = Math.min(d.cap, fa.fill) - d.tons;
      if (q >= 1 && canPay(g, q * market.current())) buyFuel(g, iata, q, true);
    }
  });
  g.missions = g.missions.filter((m) => {
    if (m.deadline > g.clock) return true;
    g.mstats.failed++; return false;
  });
  genMissions(g);
  // reputazione
  const t0 = g.today;
  const flights = Math.max(1, t0.flights + t0.cancelled);
  const active = g.fleet.filter((a) => a.routeId);
  const avgCond = active.length ? active.reduce((s, a) => s + a.cond, 0) / active.length : 80;
  const avgMul = g.routes.length ? g.routes.reduce((s, r) => s + r.priceMul, 0) / g.routes.length : 1;
  const target = U.clamp(63 + 4 * lvl(g, 'service') + (avgCond - 70) * 0.3 - (t0.delayed / flights) * 20 - (t0.cancelled / flights) * 50 + (1 - avgMul) * 25, 15, 100);
  g.rep = U.clamp(g.rep + (target - g.rep) * 0.08, 0, 100);
  // rivali
  g.rivals.forEach((r) => {
    r.cash += r.fleet * 1500 * (0.7 + rnd() * 0.6) * (r.rating / 70) - r.fleet * 700;
    r.rating = U.clamp(r.rating + (rnd() - 0.5) * 1.2, 35, 95);
    if (rnd() < 0.03) { r.fleet++; r.routes += 2; if (rnd() < 0.5) log(g, 'newsRivalFleet', { r: r.name, n: 1 }, 'news'); }
    if (rnd() < 0.004 && r.fleet > 8) { r.fleet--; log(g, 'newsRivalLoss', { r: r.name }, 'news'); }
  });
  // candidati piloti
  refreshCandidates(g);
  // storico
  const rev = t0.revenue, cost = t0.fuel + t0.fees + t0.maintenance + t0.service + t0.payroll + t0.insurance + t0.other;
  g.daily.push({ t, cash: Math.round(g.cash), rev: Math.round(rev), cost: Math.round(cost), profit: Math.round(rev - cost), flights: t0.flights, pax: t0.pax,
    fuel: Math.round(t0.fuel), fees: Math.round(t0.fees), maint: Math.round(t0.maintenance), service: Math.round(t0.service), payroll: Math.round(t0.payroll), ins: Math.round(t0.insurance),
    rep: Math.round(g.rep * 10) / 10, price: market.current(), value: value(g) });
  if (g.daily.length > 150) g.daily.shift();
  g.today = blankDay();
  if (g.cash < -2e6 && !g.settings.unlimited) log(g, 'logDebt', {}, 'warn');
}

// ------------------------------------------------------------------ loop eventi
function nextEvent(g) {
  let best = { t: g.dayEdge, kind: 'day' };
  g.fleet.forEach((a) => { if (a.nextAt != null && a.nextAt < best.t) best = { t: a.nextAt, kind: 'ac', o: a }; });
  g.pilots.forEach((p) => { if (p.status === 'training' && p.trainEnd < best.t) best = { t: p.trainEnd, kind: 'pilot', o: p }; });
  g.courses.forEach((c) => { if (c.end < best.t) best = { t: c.end, kind: 'course', o: c }; });
  return best;
}

function advance(g, now) {
  now = now || Date.now();
  if (!g.company) { g.lastReal = now; return g; }
  let dt = Math.max(0, now - g.lastReal);
  g.lastReal = now;
  if (!g.settings.offline) dt = Math.min(dt, 90e3);
  const target = Math.min(g.clock + dt * g.settings.speed, g.clock + 30 * DAY);
  for (let i = 0; i < 400000; i++) {
    const ev = nextEvent(g);
    if (ev.t > target) break;
    g.clock = Math.max(g.clock, ev.t);
    if (ev.kind === 'day') { dayEnd(g, ev.t); g.dayEdge += DAY; }
    else if (ev.kind === 'ac') {
      const a = ev.o;
      if (a.status === 'delivery') { a.status = 'idle'; a.nextAt = null; log(g, 'logDelivered', { ac: a.name, m: model(a).name }, 'ok'); }
      else if (a.status === 'maintenance') { a.cond = 100; a.nextAt = null; if (a.routeId) { a.status = 'boarding'; a.nextAt = ev.t; } else a.status = 'idle'; }
      else if (a.status === 'boarding') depart(g, a, ev.t);
      else if (a.status === 'flying') arrive(g, a, ev.t);
      else a.nextAt = null;
    } else if (ev.kind === 'pilot') {
      const p = ev.o; p.cls = p.trainTo; p.status = 'free'; p.salary = pilotSalary(p.cls, p.skill); p.trainEnd = null;
      log(g, 'logPilotTrained', { p: p.name, c: ['F', 'E', 'D', 'C', 'B', 'A'][p.cls] }, 'ok');
    } else if (ev.kind === 'course') {
      const c = ev.o; g.levels[c.type] = c.level; g.courses = g.courses.filter((x) => x !== c);
      log(g, 'logCourseDone', { c: c.type, l: c.level }, 'ok');
    }
  }
  g.clock = target;
  return g;
}

// ------------------------------------------------------------------ carburante
function buyFuel(g, iata, tons, auto) {
  tons = Math.floor(tons * 10) / 10;
  const f = g.depots[iata];
  if (!f) fail('noDepot');
  if (!(tons > 0)) fail('badArgs');
  if (f.tons + tons > f.cap + 0.001) fail('tankFull');
  const price = market.current();
  const cost = tons * price;
  need(g, cost);
  f.avgCost = (f.tons * f.avgCost + tons * price) / (f.tons + tons);
  f.tons += tons;
  pay(g, -cost, null);
  led(g, -cost, 'fuel', auto ? 'ledFuelAuto' : 'ledFuelBuy', { t: tons, p: price, a: iata });
}
const newDepot = (cap) => ({ tons: 0, avgCost: 0, cap: cap || 150, capLevel: 0, auto: { on: false, min: 30, fill: 100 } });

// ------------------------------------------------------------------ missioni speciali
// 11 tipi x 50 clienti = 550 modelli di missione; gli aeroporti, le quantita' e la scadenza sono dinamici.
const MTYPES = [
  { id: 'vip', cargo: false, mult: 3.0 }, { id: 'medical', cargo: false, mult: 2.8 }, { id: 'press', cargo: false, mult: 1.8 },
  { id: 'sport', cargo: false, mult: 2.0 }, { id: 'charter', cargo: false, mult: 1.7 }, { id: 'tourist', cargo: false, mult: 1.6 },
  { id: 'cargo', cargo: true, mult: 1.8 }, { id: 'humanitarian', cargo: true, mult: 1.4 }, { id: 'fresh', cargo: true, mult: 2.2 },
  { id: 'mail', cargo: true, mult: 2.0 }, { id: 'industrial', cargo: true, mult: 1.9 },
];
const CL_A = ['Orion', 'Aurora', 'Helios', 'Nimbus', 'Vega', 'Titan', 'Zenith', 'Nova', 'Borealis', 'Meridian'];
const CL_B = ['Pharma', 'Films', 'Foods', 'Motors', 'Energy'];
const clientName = (i) => CL_A[i % 10] + ' ' + CL_B[Math.floor(i / 10)];
const MAXKM = [900, 2000, 4500, 8500, 12500, 17000];
const tierOf = (g) => g.fleet.reduce((t, a) => Math.max(t, model(a).cls), 0);

function genMissions(g) {
  const tier = tierOf(g);
  const target = U.clamp(4 + Math.floor(g.fleet.length / 2) + tier, 4, 12);
  const hubA = airport(g.company.hub);
  let guard = 0;
  while (g.missions.length < target && guard++ < 60) {
    const tpl = Math.floor(rnd() * 550);
    if (g.missions.some((m) => m.tpl === tpl) || g.mhist.includes(tpl)) continue;
    const type = MTYPES[Math.floor(tpl / 50)], ci = tpl % 50;
    const tr = Math.max(0, tier - Math.floor(rnd() * 2.2));
    const fromList = rnd() < 0.65 ? D.airports.filter((a) => a.cont === hubA.cont && a.size >= Math.min(3, 1 + tr)) : D.airports.filter((a) => a.size >= Math.min(3, 1 + tr));
    const from = pick(fromList);
    const cand = D.airports.filter((a) => a !== from && a.size >= Math.min(3, 1 + tr) && U.distKm(a, from) >= 150 && U.distKm(a, from) <= MAXKM[tr]);
    if (!cand.length) continue;
    const to = pick(cand);
    const d = Math.round(U.distKm(from, to));
    const urgency = 1.4 + rnd() * 1.0;
    let pax = 0, tons = 0, reward;
    if (!type.cargo) {
      const rngByType = { vip: [2, 4 + tr * 5], medical: [1, 3], press: [3, 6 + tr * 3], sport: [15, 10 + tr * 20], charter: [30, 30 + tr * 60], tourist: [20, 30 + tr * 50] }[type.id];
      pax = rngByType[0] + Math.floor(rnd() * rngByType[1]);
      reward = pax * (55 + 0.08 * d) * type.mult * urgency;
    } else {
      const k = { cargo: 1, humanitarian: 1.2, fresh: 0.8, mail: 0.5, industrial: 1.3 }[type.id];
      tons = Math.round((1 + rnd() * (1 + tr * tr * 2.8)) * k * 10) / 10;
      reward = tons * (180 + 0.5 * d) * type.mult * urgency;
    }
    reward = Math.max(500, Math.round(reward / 10) * 10);
    const days = type.id === 'medical' ? 1 + rnd() * 2 : 2 + rnd() * 6;
    g.missions.push({ id: nid(g), tpl, type: type.id, client: clientName(ci), from: from.iata, to: to.iata, dist: d, pax, cargo: tons, reward, deadline: g.clock + Math.round(days * DAY), created: g.clock, tier: tr });
    g.mhist.push(tpl); if (g.mhist.length > 120) g.mhist.shift();
  }
}

// ------------------------------------------------------------------ mercato usato
function usedFair(m, hours, cond) { return Math.round(m.price * Math.max(0.35, 1 - hours / 60000) * (0.6 + 0.4 * cond / 100)); }
function usedBand(m, hours, cond) { const f = usedFair(m, hours, cond); return { fair: f, min: Math.round(f * 0.7), max: Math.round(Math.min(f * 1.02, m.price * 1.02)) }; }

function newAircraft(g, id, role) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const reg = g.company.prefix + '-' + L[Math.floor(rnd() * 26)] + L[Math.floor(rnd() * 26)] + L[Math.floor(rnd() * 26)];
  return { id: nid(g), model: id, name: reg, cond: 100, hours: 0, flights: 0, status: 'idle', nextAt: null, routeId: null,
    loc: g.company.hub, pilots: [], flight: null, revenue: 0, profit: 0, bought: g.clock, role: role === 'cargo' ? 'cargo' : 'pax' };
}

// ------------------------------------------------------------------ azioni (API)
const actions = {
  createCompany(g, b) {
    if (g.company) fail('exists');
    const name = String(b.name || '').trim().slice(0, 32);
    if (name.length < 2) fail('badArgs');
    if (!D.byIata[b.hub]) fail('badArgs');
    const prefix = (name.replace(/[^A-Za-z]/g, '').slice(0, 2) || 'AM').toUpperCase();
    g.company = { name, hub: b.hub, color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#38bdf8', prefix, created: g.clock };
    if (LANGS.includes(b.lang)) g.settings.lang = b.lang;
    g.staff = { cabin: 4, mech: 1, ground: 4 };
    for (let i = 0; i < 2; i++) { const p = makePilot(g); p.cls = 1; p.skill = 55 + i * 8; p.salary = pilotSalary(1, p.skill); g.pilots.push(p); }
    refreshCandidates(g);
    g.bases = [{ iata: b.hub, hangar: 0, since: g.clock }];
    g.depots[b.hub] = newDepot(200);
    genMissions(g);
    const ac = newAircraft(g, 'c208'); ac.status = 'idle'; ac.nextAt = null;
    g.fleet.push(ac);
    g.dayEdge = (Math.floor(g.clock / DAY) + 1) * DAY;
    log(g, 'logWelcome', { n: name, h: b.hub }, 'ok');
  },

  buyAircraft(g, b) {
    const m = D.byModel[b.model]; if (!m) fail('badArgs');
    need(g, m.price);
    const ac = newAircraft(g, m.id, b.role);
    ac.status = 'delivery'; ac.nextAt = g.clock + m.deliveryH * H; ac.dStart = g.clock;
    pay(g, -m.price, null); led(g, -m.price, 'purchase', 'ledBuyAc', { m: m.name });
    g.fleet.push(ac);
  },
  skipAircraft(g, b) {
    const ac = g.fleet.find((a) => a.id === b.id); if (!ac) fail('notFound');
    const m = model(ac);
    let fee;
    const rem = (ac.nextAt || g.clock) - g.clock;
    if (ac.status === 'delivery') fee = m.price * 0.06 * (rem / (m.deliveryH * H)) + 1000;
    else if (ac.status === 'maintenance') fee = ac.mCost * 1.5 * (rem / Math.max(1, ac.nextAt - ac.mStart)) + 200;
    else fail('badArgs');
    fee = Math.round(fee);
    need(g, fee); pay(g, -fee, 'other'); led(g, -fee, 'other', 'ledSkip', { n: ac.name });
    ac.nextAt = g.clock;
  },
  sellAircraft(g, b) {
    const ac = g.fleet.find((a) => a.id === b.id); if (!ac) fail('notFound');
    if (ac.status !== 'idle') fail('busy');
    const v = resale(ac);
    pay(g, v, null); led(g, v, 'purchase', 'ledSellAc', { m: model(ac).name });
    g.fleet = g.fleet.filter((a) => a !== ac);
  },
  maintenance(g, b) {
    const ac = g.fleet.find((a) => a.id === b.id); if (!ac) fail('notFound');
    if (ac.status !== 'idle' && ac.status !== 'boarding') fail('busy');
    const m = model(ac);
    need(g, m.price * 0.01);
    startMaintenance(g, ac, g.clock, false);
  },
  renameAircraft(g, b) {
    const ac = g.fleet.find((a) => a.id === b.id); if (!ac) fail('notFound');
    ac.name = String(b.name || '').trim().slice(0, 14) || ac.name;
  },
  assign(g, b) {
    const ac = g.fleet.find((a) => a.id === b.id); if (!ac) fail('notFound');
    if (b.routeId == null) {
      if (ac.status === 'flying' && ac.flight) fail('busy');
      unassign(g, ac); return;
    }
    const r = route(g, b.routeId); if (!r) fail('notFound');
    if (ac.routeId === r.id) return;
    if (!['idle', 'boarding'].includes(ac.status)) fail('busy');
    const m = model(ac);
    const err = modelFits(m, r.a, r.b); if (err) fail(err);
    unassign(g, ac);
    const free = g.pilots.filter((p) => p.status === 'free' && p.cls >= m.cls).sort((x, y) => x.salary - y.salary);
    if (free.length < 2) fail('noPilots');
    const n = needs(g);
    if (n.cabin + Math.ceil(m.seats / 30) > g.staff.cabin) fail('noCabin', { need: n.cabin + Math.ceil(m.seats / 30) });
    const crew = free.slice(0, 2);
    crew.forEach((p) => { p.status = 'assigned'; p.ac = ac.id; });
    ac.pilots = crew.map((p) => p.id);
    ac.routeId = r.id;
    if (ac.loc !== r.a && ac.loc !== r.b) ac.loc = r.a;
    ac.status = 'boarding'; ac.nextAt = g.clock + turnH(g, m) * H;
  },

  createRoute(g, b) {
    const { a, bb } = { a: b.a, bb: b.b };
    if (!D.byIata[a] || !D.byIata[bb]) fail('badArgs');
    if (a === bb) fail('sameAirport');
    if (g.routes.some((r) => (r.a === a && r.b === bb) || (r.a === bb && r.b === a))) fail('exists');
    const e = routeEcon(g, a, bb, 1);
    if (e.dist < 80) fail('tooShort');
    need(g, e.slotCost);
    pay(g, -e.slotCost, null); led(g, -e.slotCost, 'route', 'ledRoute', { a, b: bb });
    g.routes.push({ id: nid(g), a, b: bb, priceMul: 1, created: g.clock, stats: { flights: 0, pax: 0, seats: 0, revenue: 0, cost: 0, lf: 0 } });
  },
  updateRoute(g, b) {
    const r = route(g, b.id); if (!r) fail('notFound');
    r.priceMul = U.clamp(Number(b.priceMul) || 1, 0.5, 2.5);
  },
  deleteRoute(g, b) {
    const r = route(g, b.id); if (!r) fail('notFound');
    if (g.fleet.some((a) => a.routeId === r.id && a.status === 'flying' && a.flight)) fail('busy');
    g.fleet.filter((a) => a.routeId === r.id).forEach((a) => unassign(g, a));
    g.routes = g.routes.filter((x) => x !== r);
  },

  buyFuel(g, b) { buyFuel(g, b.iata, Number(b.tons)); },
  sellFuel(g, b) {
    const f = g.depots[b.iata]; if (!f) fail('noDepot');
    const t = Math.min(Number(b.tons) || 0, f.tons); if (!(t > 0)) fail('badArgs');
    const v = t * market.current() * 0.92;
    f.tons -= t; if (f.tons < 0.0001) { f.tons = 0; f.avgCost = 0; }
    pay(g, v, null); led(g, v, 'fuel', 'ledFuelSell', { t, a: b.iata });
  },
  upgradeTank(g, b) {
    const f = g.depots[b.iata]; if (!f) fail('noDepot');
    const cost = Math.round(100000 * Math.pow(1 + f.capLevel, 1.5));
    need(g, cost); pay(g, -cost, null); led(g, -cost, 'fuel', 'ledTank', { a: b.iata });
    f.cap += 200; f.capLevel++;
  },
  fuelAuto(g, b) {
    const f = g.depots[b.iata]; if (!f) fail('noDepot');
    f.auto = { on: !!b.on, min: U.clamp(Number(b.min) || 0, 0, f.cap), fill: U.clamp(Number(b.fill) || 0, 0, f.cap) };
  },

  buildBase(g, b) {
    const a = D.byIata[b.iata]; if (!a) fail('badArgs');
    if (hasBase(g, a.iata)) fail('exists');
    const cost = a.size * 60000; need(g, cost); pay(g, -cost, null); led(g, -cost, 'base', 'ledBase', { a: a.iata });
    g.bases.push({ iata: a.iata, hangar: 0, since: g.clock });
  },
  upgradeHangar(g, b) {
    const bs = g.bases.find((x) => x.iata === b.iata); if (!bs) fail('notFound');
    if (bs.hangar >= 3) fail('maxLevel');
    const cost = airport(bs.iata).size * 100000 * (bs.hangar + 1); need(g, cost);
    pay(g, -cost, null); led(g, -cost, 'base', 'ledHangar', { a: bs.iata }); bs.hangar++;
  },
  buildDepot(g, b) {
    if (!hasBase(g, b.iata)) fail('noBase');
    if (g.depots[b.iata]) fail('exists');
    const cost = 80000; need(g, cost); pay(g, -cost, null); led(g, -cost, 'base', 'ledDepot', { a: b.iata });
    g.depots[b.iata] = newDepot(150);
  },

  setRole(g, b) {
    const ac = g.fleet.find((a) => a.id === b.id); if (!ac) fail('notFound');
    const role = b.role === 'cargo' ? 'cargo' : 'pax';
    if (ac.role === role) return;
    if (ac.status !== 'idle') fail('busy');
    const m = model(ac), cost = Math.round(m.price * 0.03 + 500);
    need(g, cost); pay(g, -cost, 'maintenance'); led(g, -cost, 'maintenance', 'ledConvert', { n: ac.name });
    ac.role = role; ac.status = 'maintenance'; ac.mStart = g.clock; ac.mCost = cost; ac.nextAt = g.clock + 48 * H; ac.cond = Math.max(ac.cond, 60);
  },

  acceptMission(g, b) {
    const mi = g.missions.findIndex((m) => m.id === b.id); if (mi < 0) fail('notFound');
    const ms = g.missions[mi];
    const ac = g.fleet.find((a) => a.id === b.ac); if (!ac) fail('notFound');
    if (ac.status !== 'idle' || ac.routeId) fail('busy');
    const mt = MTYPES.find((x) => x.id === ms.type), m = model(ac);
    if ((ac.role === 'cargo') !== mt.cargo) fail('wrongRole');
    if (mt.cargo ? cargoCap(m) < ms.cargo : m.seats < ms.pax) fail('tooSmall');
    const err = modelFits(m, ms.from, ms.to); if (err) fail(err);
    const free = g.pilots.filter((p) => p.status === 'free' && p.cls >= m.cls).sort((x, y) => x.salary - y.salary);
    if (free.length < 2) fail('noPilots');
    const bH = blockH(m, ms.dist);
    const dep = g.clock + 0.5 * H;
    if (dep + bH * H > ms.deadline) fail('tooLate');
    const crew = free.slice(0, 2); crew.forEach((p) => { p.status = 'assigned'; p.ac = ac.id; });
    ac.pilots = crew.map((p) => p.id); ac.loc = ms.from;
    const tons = (m.burn * bH * (1 - 0.03 * lvl(g, 'eco'))) / 1000;
    const fuelCost = burnFuel(g, tons, ms.from);
    ac.flight = { from: ms.from, to: ms.to, dep, arr: dep + bH * H, dist: ms.dist, pax: ms.pax, cargo: ms.cargo, cap: mt.cargo ? cargoCap(m) : m.seats, fare: 0, rev: ms.reward, sev: 0, fuelT: Math.round(tons * 10) / 10, fuelCost: Math.round(fuelCost), mission: { id: ms.id, type: ms.type, client: ms.client } };
    ac.status = 'flying'; ac.nextAt = ac.flight.arr;
    g.missions.splice(mi, 1);
  },
  dismissMission(g, b) { g.missions = g.missions.filter((m) => m.id !== b.id); },

  // --- mercato usato (orchestrato da index.js) ---
  listAircraft(g, b) {
    const ac = g.fleet.find((a) => a.id === b.id); if (!ac) fail('notFound');
    if (ac.status !== 'idle') fail('busy');
    const m = model(ac), band = usedBand(m, ac.hours, ac.cond);
    const price = Math.round(Number(b.price));
    if (!(price >= band.min && price <= band.max)) fail('badPrice', band);
    g.fleet = g.fleet.filter((a) => a !== ac);
    return { listing: { model: ac.model, name: ac.name, hours: Math.round(ac.hours), cond: Math.round(ac.cond), flights: ac.flights || 0, role: ac.role, price, ref: band.fair } };
  },
  restoreListing(g, b) {
    const l = b.listing, ac = newAircraft(g, l.model, l.role);
    ac.name = l.name; ac.hours = l.hours; ac.cond = l.cond; ac.flights = l.flights;
    g.fleet.push(ac);
  },
  buyUsed(g, b) {
    const l = b.listing;
    need(g, l.price); pay(g, -l.price, null); led(g, -l.price, 'purchase', 'ledBuyUsed', { m: D.byModel[l.model].name });
    const ac = newAircraft(g, l.model, l.role);
    ac.name = l.name; ac.hours = l.hours; ac.cond = l.cond; ac.flights = l.flights;
    g.fleet.push(ac);
  },
  creditSale(g, b) {
    const net = Math.round(b.price * 0.97);
    pay(g, net, null); led(g, net, 'purchase', 'ledSoldUsed', { m: D.byModel[b.model] ? D.byModel[b.model].name : b.model });
    log(g, 'logSoldUsed', { m: D.byModel[b.model] ? D.byModel[b.model].name : b.model, p: net }, 'ok');
  },

  hirePilot(g, b) {
    const i = g.candidates.findIndex((p) => p.id === b.id); if (i < 0) fail('notFound');
    const p = g.candidates[i];
    need(g, p.fee); pay(g, -p.fee, null); led(g, -p.fee, 'staff', 'ledHire', { n: p.name });
    g.candidates.splice(i, 1); delete p.fee; g.pilots.push(p);
  },
  firePilot(g, b) {
    const p = g.pilots.find((x) => x.id === b.id); if (!p) fail('notFound');
    if (p.status !== 'free') fail('busy');
    const sev = p.salary * 10; need(g, sev); pay(g, -sev, null); led(g, -sev, 'staff', 'ledFire', { n: p.name });
    g.pilots = g.pilots.filter((x) => x !== p);
  },
  trainPilot(g, b) {
    const p = g.pilots.find((x) => x.id === b.id); if (!p) fail('notFound');
    if (p.status !== 'free') fail('busy');
    if (p.cls >= 5) fail('maxLevel');
    const cost = PILOT_UPG.cost[p.cls], days = PILOT_UPG.days[p.cls];
    need(g, cost); pay(g, -cost, null); led(g, -cost, 'staff', 'ledTrain', { n: p.name });
    p.status = 'training'; p.trainTo = p.cls + 1; p.trainStart = g.clock; p.trainEnd = g.clock + days * DAY; p.trainCost = cost;
  },
  skipPilot(g, b) {
    const p = g.pilots.find((x) => x.id === b.id); if (!p || p.status !== 'training') fail('notFound');
    const fee = Math.round(p.trainCost * 1.0 * ((p.trainEnd - g.clock) / (p.trainEnd - p.trainStart)) + 100);
    need(g, fee); pay(g, -fee, 'other'); led(g, -fee, 'other', 'ledSkipTrain', { n: p.name });
    p.trainEnd = g.clock;
  },
  refreshCandidates(g) { need(g, 3000); pay(g, -3000, null); led(g, -3000, 'staff', 'ledRecruit', {}); refreshCandidates(g); },
  hireStaff(g, b) {
    const t = b.type; if (!WAGE[t]) fail('badArgs');
    const n = U.clamp(parseInt(b.n, 10) || 1, 1, 200);
    const cost = n * WAGE[t] * 3;
    need(g, cost); pay(g, -cost, null); led(g, -cost, 'staff', 'ledHireStaff', { n, t });
    g.staff[t] += n;
  },
  fireStaff(g, b) {
    const t = b.type; if (!WAGE[t]) fail('badArgs');
    const n = Math.min(U.clamp(parseInt(b.n, 10) || 1, 1, 200), g.staff[t]);
    if (!n) fail('badArgs');
    if (t === 'cabin' && g.staff.cabin - n < needs(g).cabin) fail('staffNeeded');
    const cost = n * WAGE[t] * 5;
    need(g, cost); pay(g, -cost, null); led(g, -cost, 'staff', 'ledFireStaff', { n, t });
    g.staff[t] -= n;
  },
  startCourse(g, b) {
    const c = COURSES[b.type]; if (!c) fail('badArgs');
    if (g.courses.some((x) => x.type === b.type)) fail('busy');
    const l = g.levels[b.type];
    if (l >= c.max) fail('maxLevel');
    const cost = Math.round(c.base * Math.pow(l + 1, 1.6));
    need(g, cost); pay(g, -cost, null); led(g, -cost, 'staff', 'ledCourse', { c: b.type });
    const days = 2 + l * 2;
    g.courses.push({ id: nid(g), type: b.type, level: l + 1, start: g.clock, end: g.clock + days * DAY, cost });
  },
  skipCourse(g, b) {
    const c = g.courses.find((x) => x.id === b.id); if (!c) fail('notFound');
    const fee = Math.round(c.cost * 1.2 * ((c.end - g.clock) / (c.end - c.start)) + 200);
    need(g, fee); pay(g, -fee, 'other'); led(g, -fee, 'other', 'ledSkipCourse', { c: c.type });
    c.end = g.clock;
  },

  settings(g, b) {
    const s = g.settings;
    if (b.speed != null) { const sp = Number(b.speed); if (!SPEEDS.includes(sp)) fail('badArgs'); s.speed = sp; }
    if (b.lang && LANGS.includes(b.lang)) s.lang = b.lang;
    if (b.theme === 'dark' || b.theme === 'light') s.theme = b.theme;
    if (b.autoMaint != null) s.autoMaint = !!b.autoMaint;
    if (b.offline != null) s.offline = !!b.offline;
  },
  addMoney(g, b) {
    const amt = U.clamp(Math.round(Number(b.amount) || 0), -1e12, 1e12);
    if (!amt) fail('badArgs');
    g.cash += amt; g.flags.cheat = true; led(g, amt, 'other', 'ledCheat', {});
  },
  unlimited(g, b) {
    if (b.on) { g.settings.unlimited = true; g.flags.cheat = true; g.cash = 1e12; }
    else { g.settings.unlimited = false; g.cash = 5e6; }
  },
};

// ------------------------------------------------------------------ vista per il client
function view(g) {
  const out = JSON.parse(JSON.stringify(g));
  out.serverTime = Date.now();
  if (g.company) {
    out.needs = needs(g); out.eff = eff(g); out.value = value(g); out.mtypes = MTYPES.map((t) => ({ id: t.id, cargo: t.cargo }));
    out.routes.forEach((r) => { r.econ = routeEcon(g, r.a, r.b, r.priceMul); r.econ.nAc = g.fleet.filter((a) => a.routeId === r.id).length; });
    out.fleet.forEach((a) => { a.resale = resale(a); });
    let payroll = 0; g.pilots.forEach((p) => { payroll += p.salary; });
    payroll += g.staff.cabin * WAGE.cabin + g.staff.mech * WAGE.mech + g.staff.ground * WAGE.ground;
    out.payrollDay = payroll;
    out.insuranceDay = Math.round(g.fleet.reduce((s, a) => s + model(a).price * 0.00025, 0));
    out.rivalsView = g.rivals.map((r) => ({ id: r.id, name: r.name, hub: r.hub, color: r.color, fleet: r.fleet, routes: r.routes, rating: Math.round(r.rating), value: Math.round(r.cash + r.fleet * 6e6) }));
    delete out.rivals;
  }
  out.fuelPrice = market.current();
  if (g.company) { out.fleet.forEach((a) => { const m = model(a); a.band = usedBand(m, a.hours, a.cond); a.cargoCap = cargoCap(m); }); }
  out.wages = WAGE; out.courseDefs = COURSES; out.pilotUpg = PILOT_UPG;
  return out;
}

function summary(g) {
  if (!g.company) return null;
  const rt = g.rt || {};
  const keys = Object.keys(rt).sort();
  const sum = (n) => Math.round(keys.slice(-n).reduce((s, k) => s + rt[k], 0));
  return { company: g.company.name, hub: g.company.hub, color: g.company.color, value: value(g), day: sum(1), week: sum(7), month: sum(30),
    fleet: g.fleet.length, cheat: !!g.flags.cheat || !!g.settings.unlimited, frozen: !!g.flags.frozen, imported: !!g.flags.imported };
}

module.exports = { summary, usedBand, usedFair, cargoCap, newGame, advance, actions, view, routeEcon, modelFits, dist, value, SPEEDS, LANGS, fail, DAY, H };
