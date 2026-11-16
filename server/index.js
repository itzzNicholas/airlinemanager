'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const initStore = require('./store');
const fed = require('./fed');
const sim = require('./sim');
const market = require('./market');
const weather = require('./weather');
const D = require('./data');

const PORT = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '10mb' }));

let store, secret;
const games = new Map(); // accountId -> {g, dirty, seen}

// ------------------------------------------------------------------ auth
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mac = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
const makeToken = (uid) => { const p = b64({ uid, exp: Date.now() + 30 * 864e5 }); return p + '.' + mac(p); };
function readToken(t) {
  const [p, sg] = String(t || '').split('.');
  if (!p || !sg || mac(p) !== sg) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o.uid : null; } catch (e) { return null; }
}
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex'); };
const checkPw = (pw, h) => { const [salt, hh] = h.split(':'); const x = crypto.scryptSync(pw, salt, 32).toString('hex'); return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(hh)); };

const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path, now = Date.now();
    const h = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (h.length >= max) return res.status(429).json({ error: 'tooMany' });
    h.push(now); hits.set(k, h); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 120000)) hits.delete(k); }, 60000).unref();

async function auth(req, res, next) {
  const uid = readToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!uid) return res.status(401).json({ error: 'auth' });
  req.uid = uid; next();
}

// ------------------------------------------------------------------ cache partite
async function getGame(uid) {
  let e = games.get(uid);
  if (!e) {
    let g = await store.loadGame(uid);
    if (!g) g = sim.newGame();
    else { g.lastReal = Date.now(); }
    e = { g, dirty: false, seen: Date.now() };
    games.set(uid, e);
  }
  e.seen = Date.now();
  sim.advance(e.g, Date.now());
  e.dirty = true;
  return e;
}
async function flush() {
  for (const [uid, e] of games) {
    if (e.dirty) { e.dirty = false; try { await store.saveGame(uid, e.g, sim.summary(e.g)); } catch (err) { console.error('save error', err.message); e.dirty = true; } }
    if (Date.now() - e.seen > 30 * 60 * 1000 && !e.dirty) games.delete(uid);
  }
}
setInterval(flush, 5000).unref();

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (e && e.code && typeof e.code === 'string' && e.message === e.code) return res.status(400).json({ error: e.code, extra: e.extra });
  console.error(e); res.status(500).json({ error: 'server' });
});

// ------------------------------------------------------------------ pubbliche
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/catalog', (req, res) => res.json({ airports: D.airports, models: D.models, grades: D.GRADES }));

// ------------------------------------------------------------------ foto aerei (cache lato server)
const photoOk = new Set(D.models.map((m) => m.wiki));
let photoCache = null, photoQ = Promise.resolve(), photoFail = {};
async function photoOf(w) {
  if (!photoCache) photoCache = (await store.getMeta('photos')) || {};
  if (photoCache[w]) return photoCache[w];
  if (photoFail[w] && Date.now() - photoFail[w] < 10 * 60 * 1000) return null;
  const job = photoQ.then(async () => {
    if (photoCache[w]) return photoCache[w];
    await new Promise((r) => setTimeout(r, 250));
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(w), { signal: ctl.signal, headers: { 'User-Agent': 'AirlineManager/1.0 (open-source game; https://github.com/itzznicholas/airlinemanager)', 'Api-User-Agent': 'AirlineManager/1.0' } });
      clearTimeout(to);
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      let u = j.thumbnail && j.thumbnail.source;
      if (u) u = u.replace(/\/(\d+)px-/, '/800px-');
      photoCache[w] = u || 'none';
      await store.setMeta('photos', photoCache);
      return photoCache[w];
    } catch (e) { photoFail[w] = Date.now(); return null; }
  });
  photoQ = job.catch(() => null);
  return job;
}
app.get('/api/photo', wrap(async (req, res) => {
  const w = String(req.query.w || '');
  if (!photoOk.has(w)) return res.status(400).json({ error: 'badArgs' });
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ url: await photoOf(w) });
}));

const userRe = /^[A-Za-z0-9_-]{3,20}$/;
app.post('/api/register', limit(8, 60000), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  if (!userRe.test(String(username)) || String(password || '').length < 6) return res.status(400).json({ error: 'badCreds' });
  if (await store.accountByName(username)) return res.status(400).json({ error: 'userExists' });
  const id = await store.createAccount(username, hashPw(String(password)));
  res.json({ token: makeToken(id), username });
}));
app.post('/api/login', limit(15, 60000), wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const a = await store.accountByName(String(username || ''));
  if (!a || !checkPw(String(password || ''), a.pass)) return res.status(401).json({ error: 'badLogin' });
  res.json({ token: makeToken(a.id), username: a.username });
}));

// ------------------------------------------------------------------ federazione (pubblico)
app.get('/api/fed/info', wrap(async (req, res) => {
  fed.learnUrl(req);
  const sb = await store.scoreboard();
  res.json(Object.assign(fed.self(), { players: sb.length }));
}));
async function localBoard(period, board) {
  await flush();
  const rows = (await store.scoreboard()).filter((r) => r.summary && !r.summary.frozen && (board === 'sandbox' ? r.summary.cheat : !r.summary.cheat));
  return rows.map((r) => ({ player: r.username, company: r.summary.company, hub: r.summary.hub, color: r.summary.color, score: r.summary[period] || 0, value: r.summary.value, fleet: r.summary.fleet }))
    .sort((a, b) => b.score - a.score).slice(0, 100);
}
const periodOf = (q) => (['day', 'week', 'month'].includes(q) ? q : 'week');
app.get('/api/fed/leaderboard', wrap(async (req, res) => {
  res.json({ instance: fed.name(), entries: await localBoard(periodOf(req.query.period), req.query.board === 'sandbox' ? 'sandbox' : 'standard') });
}));
const pubListing = (l) => ({ id: l.id, model: l.model, name: l.name, hours: l.hours, cond: l.cond, flights: l.flights, role: l.role, price: l.price, seller: l.sellerName });
app.get('/api/fed/market', wrap(async (req, res) => res.json({ listings: (await store.activeListings()).map(pubListing) })));
app.post('/api/fed/claim', limit(30, 60000), wrap(async (req, res) => {
  const peer = await fed.verifyClaim(req.body || {});
  if (!peer) return res.status(403).json({ error: 'badSignature' });
  const l = await store.claimListing(String(req.body.listingId), 'sold');
  if (!l) return res.status(404).json({ error: 'gone' });
  const e = await getGame(l.sellerId);
  sim.actions.creditSale(e.g, { price: l.price, model: l.model });
  res.json({ listing: pubListing(l) });
}));

app.post('/api/account/import', limit(5, 60000), wrap(async (req, res) => {
  const { bundle, username, password } = req.body || {};
  if (!userRe.test(String(username)) || String(password || '').length < 6) return res.status(400).json({ error: 'badCreds' });
  const err = await fed.verifyExport(bundle);
  if (err) return res.status(400).json({ error: err });
  if (await store.accountByName(username)) return res.status(400).json({ error: 'userExists' });
  const g = bundle.state;
  if (!g || !g.company || !Array.isArray(g.fleet)) return res.status(400).json({ error: 'badBundle' });
  g.flags = Object.assign({ cheat: false }, g.flags, { frozen: false, imported: true, origin: bundle.instance.name });
  g.lastReal = Date.now();
  const id = await store.createAccount(username, hashPw(String(password)));
  await store.saveGame(id, g, sim.summary(g));
  res.json({ token: makeToken(id), username });
}));

// ------------------------------------------------------------------ autenticate
app.use('/api', auth);

app.get('/api/state', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  const acc = await store.accountById(req.uid);
  res.json({ state: sim.view(e.g), username: acc.username, instance: { id: fed.id(), name: fed.name(), url: fed.url() } });
}));

app.post('/api/do/:action', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  const fn = sim.actions[req.params.action];
  const allowed = !['listAircraft', 'restoreListing', 'buyUsed', 'creditSale'].includes(req.params.action);
  if (!fn || !allowed) return res.status(404).json({ error: 'noAction' });
  if (e.g.flags.frozen) return res.status(403).json({ error: 'frozen' });
  if (req.params.action !== 'createCompany' && !e.g.company) return res.status(400).json({ error: 'noCompany' });
  const result = fn(e.g, req.body || {});
  sim.advance(e.g, Date.now());
  e.dirty = true;
  res.json({ state: sim.view(e.g), result });
}));

app.post('/api/reset', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  const g = sim.newGame(e.g.settings);
  e.g = g; e.dirty = true;
  res.json({ state: sim.view(g) });
}));

app.get('/api/route/preview', wrap(async (req, res) => {
  const { a, b } = req.query;
  if (!D.byIata[a] || !D.byIata[b] || a === b) return res.status(400).json({ error: 'badArgs' });
  const e = await getGame(req.uid);
  res.json(sim.routeEcon(e.g, a, b, 1));
}));
app.get('/api/fuel', wrap(async (req, res) => { market.ensure(); res.json(market.analyze()); }));
app.get('/api/weather', wrap(async (req, res) => res.json(weather.all())));

// ------------------------------------------------------------------ mercato usato
app.get('/api/market', wrap(async (req, res) => {
  const [local, remote] = await Promise.all([store.activeListings(), fed.remoteMarket()]);
  const me = req.uid;
  const decorate = (l, remoteInst) => {
    const m = D.byModel[l.model]; if (!m) return null;
    const band = sim.usedBand(m, l.hours, l.cond);
    return Object.assign({}, remoteInst ? l : pubListing(l), { key: (remoteInst ? l.instanceId : 'local') + ':' + l.id, instance: remoteInst ? l.instance : fed.name(), instanceId: remoteInst ? l.instanceId : fed.id(),
      mine: !remoteInst && l.sellerId === me, ref: band.fair });
  };
  res.json({ items: [...local.map((l) => decorate(l, false)), ...remote.map((l) => decorate(l, true))].filter(Boolean) });
}));
app.post('/api/market/list', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  if (e.g.flags.frozen) return res.status(403).json({ error: 'frozen' });
  const acc = await store.accountById(req.uid);
  const r = sim.actions.listAircraft(e.g, req.body || {});
  const l = Object.assign({ id: crypto.randomBytes(9).toString('base64url'), sellerId: req.uid, sellerName: acc.username, created: Date.now() }, r.listing);
  await store.insertListing(l);
  e.dirty = true;
  res.json({ state: sim.view(e.g) });
}));
app.post('/api/market/cancel', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  const l = await store.getListing(String(req.body.id));
  if (!l || l.sellerId !== req.uid || l.status !== 'active') return res.status(404).json({ error: 'notFound' });
  const c = await store.claimListing(l.id, 'cancelled');
  if (!c) return res.status(404).json({ error: 'gone' });
  sim.actions.restoreListing(e.g, { listing: c });
  e.dirty = true;
  res.json({ state: sim.view(e.g) });
}));
app.post('/api/market/buy', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  if (e.g.flags.frozen) return res.status(403).json({ error: 'frozen' });
  const { instanceId, id, price } = req.body || {};
  const g = e.g;
  const afford = (p) => { if (!g.settings.unlimited && g.cash < p) { const er = new Error('noMoney'); er.code = 'noMoney'; throw er; } };
  if (!instanceId || instanceId === fed.id()) {
    const l = await store.getListing(String(id));
    if (!l || l.status !== 'active') return res.status(404).json({ error: 'gone' });
    if (l.sellerId === req.uid) return res.status(400).json({ error: 'ownListing' });
    afford(l.price);
    const c = await store.claimListing(l.id, 'sold');
    if (!c) return res.status(404).json({ error: 'gone' });
    sim.actions.buyUsed(g, { listing: c });
    const seller = await getGame(c.sellerId);
    sim.actions.creditSale(seller.g, { price: c.price, model: c.model });
  } else {
    if (!(Number(price) > 0)) return res.status(400).json({ error: 'badArgs' });
    afford(Number(price));
    const l = await fed.claimRemote(instanceId, String(id));
    if (l.price > Number(price) * 1.0001) { const er = new Error('priceChanged'); er.code = 'priceChanged'; throw er; }
    sim.actions.buyUsed(g, { listing: l });
  }
  e.dirty = true;
  res.json({ state: sim.view(g) });
}));

// ------------------------------------------------------------------ federazione (client)
app.get('/api/fed/peers', wrap(async (req, res) => res.json({ self: fed.self(), peers: await fed.peers(req.query.force === '1'), bans: fed.getBans() })));
app.get('/api/fed/boards', wrap(async (req, res) => {
  const period = periodOf(req.query.period), board = req.query.board === 'sandbox' ? 'sandbox' : 'standard';
  const scope = req.query.scope === 'local' ? 'local' : 'global';
  const local = (await localBoard(period, board)).map((e) => Object.assign(e, { instance: fed.name(), instanceId: fed.id() }));
  const remote = scope === 'global' ? await fed.remoteBoards(period, board) : [];
  res.json({ entries: [...local, ...remote].sort((a, b) => b.score - a.score).slice(0, 100), me: (await store.accountById(req.uid)).username });
}));

function adminOk(req) { const t = process.env.ADMIN_TOKEN; return t && req.headers['x-admin-token'] && crypto.timingSafeEqual(Buffer.from(String(req.headers['x-admin-token']).padEnd(64).slice(0, 64)), Buffer.from(String(t).padEnd(64).slice(0, 64))); }
app.post('/api/admin/:what', limit(30, 60000), wrap(async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'adminToken' });
  const b = req.body || {};
  if (req.params.what === 'ban') await fed.ban({ id: b.id, url: b.url, note: b.note, on: b.on !== false });
  else if (req.params.what === 'peer') { if (!(await fed.addPeer(b.url))) return res.status(400).json({ error: 'badArgs' }); }
  else if (req.params.what === 'name') await fed.setName(b.name || '');
  else return res.status(404).json({ error: 'noAction' });
  res.json({ ok: true, peers: await fed.peers(true), bans: fed.getBans() });
}));

// ------------------------------------------------------------------ esportazione / importazione account
app.get('/api/account/export', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  const acc = await store.accountById(req.uid);
  if (!e.g.company) return res.status(400).json({ error: 'noCompany' });
  const bundle = fed.signExport(acc.username, e.g);
  e.g.flags.frozen = true; e.dirty = true; // l'account "si sposta": questa copia viene congelata
  await flush();
  res.json(bundle);
}));
app.post('/api/account/unfreeze', wrap(async (req, res) => {
  const e = await getGame(req.uid);
  if (e.g.flags.frozen) { e.g.flags.frozen = false; e.g.flags.cheat = true; e.g.lastReal = Date.now(); e.dirty = true; } // riattivarlo = classifica "trucchi"
  res.json({ state: sim.view(e.g) });
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

(async function start() {
  store = await initStore();
  secret = await store.getMeta('secret');
  if (!secret) { secret = crypto.randomBytes(32).toString('hex'); await store.setMeta('secret', secret); }
  const ident = await fed.init(store);
  market.refresh(true); weather.refresh();
  setInterval(() => market.refresh(false), 10 * 60 * 1000).unref();
  const srv = app.listen(PORT, () => console.log(`AirlineManager in ascolto sulla porta ${PORT} | db: ${store.kind} | istanza: ${fed.name()} (${ident.id})`));
  const bye = async () => { console.log('chiusura...'); await flush(); await store.close(); srv.close(); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
})().catch((e) => { console.error('Errore di avvio', e); process.exit(1); });
