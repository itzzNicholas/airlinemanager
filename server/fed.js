'use strict';
// Federazione decentralizzata: ogni istanza ha un ID casuale lungo, una coppia di chiavi Ed25519
// e un URL pubblico; le istanze si trovano tramite servers.json (aggiunte via pull request su GitHub).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/itzznicholas/airlinemanager/main/servers.json';
const VERSION = '1.0.0';

let store, identity, pubB64;
const peerCache = new Map();  // url -> {info, at, ok}
let bans = [];
let extraPeers = [];
let publicUrl = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '');
let instName = process.env.INSTANCE_NAME || '';

async function init(st) {
  store = st;
  identity = await store.getMeta('identity');
  if (!identity) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    identity = {
      id: crypto.randomBytes(33).toString('base64url'), // ID lungo e casuale (44 caratteri base64url)
      pub: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      priv: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      created: Date.now(),
    };
    await store.setMeta('identity', identity);
  }
  pubB64 = identity.pub;
  bans = (await store.getMeta('bans')) || [];
  extraPeers = (await store.getMeta('extraPeers')) || [];
  if (!instName) instName = (await store.getMeta('instName')) || '';
  if (!instName) instName = 'AirlineManager-' + identity.id.slice(0, 5);
  if (!publicUrl) publicUrl = (await store.getMeta('publicUrl')) || '';
  return identity;
}

const sign = (str) => crypto.sign(null, Buffer.from(str), crypto.createPrivateKey({ key: Buffer.from(identity.priv, 'base64'), format: 'der', type: 'pkcs8' })).toString('base64');
const verify = (pubB64x, str, sig) => {
  try { return crypto.verify(null, Buffer.from(str), crypto.createPublicKey({ key: Buffer.from(pubB64x, 'base64'), format: 'der', type: 'spki' }), Buffer.from(sig, 'base64')); }
  catch (e) { return false; }
};

function learnUrl(req) {
  if (publicUrl) return;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (!host || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return;
  publicUrl = (req.headers['x-forwarded-proto'] || req.protocol || 'https') + '://' + host;
  store.setMeta('publicUrl', publicUrl).catch(() => {});
}

const self = () => ({ app: 'airlinemanager', v: VERSION, id: identity.id, name: instName, url: publicUrl, pubkey: pubB64 });

function normUrl(u) {
  try {
    const x = new URL(String(u).trim());
    if (!/^https?:$/.test(x.protocol)) return null;
    const host = x.hostname;
    const priv = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.internal') || host.endsWith('.local') || host === '[::1]';
    if (priv && process.env.ALLOW_PRIVATE_PEERS !== '1') return null;
    return x.origin;
  } catch (e) { return null; }
}

async function getJson(url, opts, ms) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms || 6000);
  try {
    const res = await fetch(url, Object.assign({}, { signal: ctl.signal, headers: { 'User-Agent': 'AirlineManager-Federation/' + VERSION, 'Content-Type': 'application/json' } }, opts || {}, { errJson: undefined }));
    if (!res.ok && !(opts && opts.errJson)) throw new Error('http ' + res.status);
    const txt = await res.text();
    if (txt.length > 3e6) throw new Error('too big');
    return JSON.parse(txt);
  } finally { clearTimeout(to); }
}

const isBanned = (info, url) => bans.some((b) => (b.id && info && b.id === info.id) || (b.url && url && b.url === url)) ||
  String(process.env.BANNED_INSTANCES || '').split(',').map((s) => s.trim()).filter(Boolean).some((b) => (info && b.id === info.id) || b === url);

async function registryUrls() {
  const set = new Set();
  try { JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'servers.json'), 'utf8')).servers.forEach((s) => set.add(s.url)); } catch (e) { /* nessun file */ }
  const reg = process.env.FED_REGISTRY_URL === undefined ? DEFAULT_REGISTRY : process.env.FED_REGISTRY_URL;
  if (reg) { try { (await getJson(reg, {}, 5000)).servers.forEach((s) => set.add(s.url)); } catch (e) { /* offline */ } }
  String(process.env.FED_PEERS || '').split(',').forEach((u) => u.trim() && set.add(u.trim()));
  extraPeers.forEach((u) => set.add(u));
  return [...set].map(normUrl).filter(Boolean);
}

let lastPeers = [], lastPeersAt = 0, peersBusy = null;
async function peers(force) {
  if (!force && Date.now() - lastPeersAt < 5 * 60 * 1000) return lastPeers;
  if (peersBusy) return peersBusy;
  peersBusy = (async () => {
    const urls = await registryUrls();
    const out = await Promise.all(urls.map(async (url) => {
      const c = peerCache.get(url);
      if (c && Date.now() - c.at < 5 * 60 * 1000) return c.res;
      let res;
      try {
        const info = await getJson(url + '/api/fed/info', {}, 5000);
        if (info.app !== 'airlinemanager' || !info.id || !info.pubkey) throw new Error('not an instance');
        res = { url, id: info.id, name: String(info.name).slice(0, 40), pubkey: info.pubkey, v: info.v, players: info.players, status: info.id === identity.id ? 'self' : isBanned(info, url) ? 'banned' : 'ok' };
      } catch (e) { res = { url, name: url, status: isBanned(null, url) ? 'banned' : 'down' }; }
      peerCache.set(url, { at: Date.now(), res });
      return res;
    }));
    lastPeers = out; lastPeersAt = Date.now();
    return out;
  })().finally(() => { peersBusy = null; });
  return peersBusy;
}
const activePeers = async () => (await peers()).filter((p) => p.status === 'ok');

async function ban(b) {
  if (b.on === false) bans = bans.filter((x) => x.id !== b.id && x.url !== b.url);
  else bans.push({ id: b.id || null, url: b.url ? normUrl(b.url) || b.url : null, note: String(b.note || '').slice(0, 100), at: Date.now() });
  await store.setMeta('bans', bans); peerCache.clear(); lastPeersAt = 0;
}
async function addPeer(url) { const u = normUrl(url); if (!u) return false; if (!extraPeers.includes(u)) extraPeers.push(u); await store.setMeta('extraPeers', extraPeers); lastPeersAt = 0; return true; }
async function setName(n) { instName = String(n).slice(0, 40); await store.setMeta('instName', instName); }

// classifica aggregata dalle istanze collegate
async function remoteBoards(period, board) {
  const ps = await activePeers();
  const res = await Promise.all(ps.map(async (p) => {
    try {
      const j = await getJson(p.url + '/api/fed/leaderboard?period=' + encodeURIComponent(period) + '&board=' + encodeURIComponent(board), {}, 5000);
      return (j.entries || []).slice(0, 100).map((e) => ({
        player: String(e.player).slice(0, 24), company: String(e.company).slice(0, 32), hub: String(e.hub).slice(0, 4), color: /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#38bdf8',
        score: Number(e.score) || 0, value: Number(e.value) || 0, fleet: Number(e.fleet) || 0, instance: p.name, instanceId: p.id }));
    } catch (e) { return []; }
  }));
  return res.flat();
}
async function remoteMarket() {
  const ps = await activePeers();
  const res = await Promise.all(ps.map(async (p) => {
    try {
      const j = await getJson(p.url + '/api/fed/market', {}, 5000);
      return (j.listings || []).slice(0, 150).map((l) => ({ id: String(l.id), model: String(l.model), name: String(l.name).slice(0, 14), hours: Number(l.hours) || 0, cond: Number(l.cond) || 0, flights: Number(l.flights) || 0,
        role: l.role === 'cargo' ? 'cargo' : 'pax', price: Number(l.price) || 0, seller: String(l.seller).slice(0, 24), instance: p.name, instanceId: p.id }));
    } catch (e) { return []; }
  }));
  return res.flat();
}
async function claimRemote(instanceId, listingId) {
  const p = (await activePeers()).find((x) => x.id === instanceId);
  if (!p) { const e = new Error('unknownInstance'); e.code = 'unknownInstance'; throw e; }
  const ts = Date.now();
  const sig = sign(`claim|${listingId}|${identity.id}|${ts}|${p.id}`);
  const r = await getJson(p.url + '/api/fed/claim', { method: 'POST', errJson: true, body: JSON.stringify({ listingId, ts, sig, buyer: { id: identity.id, url: publicUrl, name: instName } }) }, 8000);
  if (!r.listing) { const e = new Error(r.error || 'claimFailed'); e.code = r.error || 'claimFailed'; throw e; }
  return r.listing;
}
async function verifyClaim(body) {
  const b = body.buyer || {};
  if (Math.abs(Date.now() - Number(body.ts)) > 120000) return null;
  const p = (await activePeers()).find((x) => x.id === b.id);
  if (!p) return null;
  return verify(p.pubkey, `claim|${body.listingId}|${b.id}|${body.ts}|${identity.id}`, String(body.sig)) ? p : null;
}

// esportazione/importazione account
const stateHash = (state) => crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
function signExport(username, stateIn) {
  const state = JSON.parse(JSON.stringify(stateIn)); // snapshot: la firma copre esattamente quello che viene esportato
  const exportedAt = Date.now();
  const sig = sign(`export|${identity.id}|${username}|${exportedAt}|${stateHash(state)}`);
  return { format: 'airlinemanager-account', v: 1, instance: { id: identity.id, name: instName, url: publicUrl }, username, exportedAt, state, sig };
}
async function verifyExport(bundle) {
  if (!bundle || bundle.format !== 'airlinemanager-account' || !bundle.instance || !bundle.state) return 'badBundle';
  let pub;
  if (bundle.instance.id === identity.id) pub = pubB64;
  else {
    const p = (await peers()).find((x) => x.id === bundle.instance.id);
    if (!p || p.status === 'down') return 'unknownInstance';
    if (p.status === 'banned') return 'bannedInstance';
    pub = p.pubkey;
  }
  return verify(pub, `export|${bundle.instance.id}|${bundle.username}|${bundle.exportedAt}|${stateHash(bundle.state)}`, String(bundle.sig)) ? null : 'badSignature';
}

module.exports = { init, self, learnUrl, peers, activePeers, ban, addPeer, setName, remoteBoards, remoteMarket, claimRemote, verifyClaim, signExport, verifyExport,
  getBans: () => bans, id: () => identity.id, name: () => instName, url: () => publicUrl, normUrl };
