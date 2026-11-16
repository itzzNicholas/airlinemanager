'use strict';
// Persistenza: PostgreSQL (DATABASE_URL) oppure, per sviluppo locale, file JSON in ./data/db.json
const fs = require('fs');
const path = require('path');

async function initPg(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, max: 8 });
  for (let i = 0; i < 30; i++) {
    try { await pool.query('select 1'); break; }
    catch (e) { if (i === 29) throw e; console.log('[db] in attesa di PostgreSQL...', e.code || e.message); await new Promise((r) => setTimeout(r, 2000)); }
  }
  await pool.query(`
    create table if not exists meta (k text primary key, v jsonb not null);
    create table if not exists accounts (id serial primary key, username text unique not null, pass text not null, created timestamptz default now());
    create table if not exists games (account_id int primary key references accounts(id) on delete cascade, state jsonb not null, summary jsonb, updated timestamptz default now());
    create table if not exists listings (id text primary key, status text not null default 'active', seller int, data jsonb not null, created timestamptz default now());
    create index if not exists listings_status on listings(status);`);
  const q = (t, p) => pool.query(t, p).then((r) => r.rows);
  return {
    kind: 'postgres',
    async getMeta(k) { const r = await q('select v from meta where k=$1', [k]); return r[0] ? r[0].v : null; },
    async setMeta(k, v) { await q('insert into meta(k,v) values($1,$2) on conflict(k) do update set v=$2', [k, JSON.stringify(v)]); },
    async accountByName(n) { const r = await q('select * from accounts where lower(username)=lower($1)', [n]); return r[0] || null; },
    async accountById(id) { const r = await q('select * from accounts where id=$1', [id]); return r[0] || null; },
    async createAccount(n, pass) { const r = await q('insert into accounts(username,pass) values($1,$2) returning id', [n, pass]); return r[0].id; },
    async loadGame(id) { const r = await q('select state from games where account_id=$1', [id]); return r[0] ? r[0].state : null; },
    async saveGame(id, state, summary) {
      await q('insert into games(account_id,state,summary,updated) values($1,$2,$3,now()) on conflict(account_id) do update set state=$2, summary=$3, updated=now()', [id, JSON.stringify(state), JSON.stringify(summary)]);
    },
    async scoreboard() { return q('select a.id, a.username, g.summary from games g join accounts a on a.id=g.account_id where g.summary is not null'); },
    async insertListing(l) { await q('insert into listings(id,status,seller,data) values($1,$2,$3,$4)', [l.id, 'active', l.sellerId, JSON.stringify(l)]); },
    async getListing(id) { const r = await q('select status,data from listings where id=$1', [id]); return r[0] ? Object.assign({ status: r[0].status }, r[0].data) : null; },
    async activeListings() { const r = await q("select data from listings where status='active' order by created desc limit 300"); return r.map((x) => x.data); },
    async claimListing(id, status) { const r = await q("update listings set status=$2 where id=$1 and status='active' returning data", [id, status]); return r[0] ? r[0].data : null; },
    async close() { await pool.end(); },
  };
}

function initFile() {
  const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let db = { meta: {}, accounts: [], games: {}, listings: {}, seq: 1 };
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* nuovo db */ }
  let timer = null;
  const flush = () => { timer = null; fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); };
  const dirty = () => { if (!timer) timer = setTimeout(flush, 1500); };
  console.log('[db] DATABASE_URL non impostato: uso il file ' + file);
  return {
    kind: 'file',
    async getMeta(k) { return db.meta[k] === undefined ? null : db.meta[k]; },
    async setMeta(k, v) { db.meta[k] = v; dirty(); },
    async accountByName(n) { return db.accounts.find((a) => a.username.toLowerCase() === n.toLowerCase()) || null; },
    async accountById(id) { return db.accounts.find((a) => a.id === id) || null; },
    async createAccount(n, pass) { const id = db.seq++; db.accounts.push({ id, username: n, pass }); dirty(); return id; },
    async loadGame(id) { return db.games[id] ? db.games[id].state : null; },
    async saveGame(id, state, summary) { db.games[id] = { state, summary }; dirty(); },
    async scoreboard() { return db.accounts.filter((a) => db.games[a.id] && db.games[a.id].summary).map((a) => ({ id: a.id, username: a.username, summary: db.games[a.id].summary })); },
    async insertListing(l) { db.listings[l.id] = { status: 'active', data: l }; dirty(); },
    async getListing(id) { const x = db.listings[id]; return x ? Object.assign({ status: x.status }, x.data) : null; },
    async activeListings() { return Object.values(db.listings).filter((x) => x.status === 'active').map((x) => x.data).sort((a, b) => b.created - a.created).slice(0, 300); },
    async claimListing(id, status) { const x = db.listings[id]; if (!x || x.status !== 'active') return null; x.status = status; dirty(); return x.data; },
    async close() { if (timer) { clearTimeout(timer); flush(); } },
  };
}

module.exports = async function init() {
  return process.env.DATABASE_URL ? initPg(process.env.DATABASE_URL) : initFile();
};
