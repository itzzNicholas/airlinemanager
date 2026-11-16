'use strict';
/* AirlineManager – client. Nessun framework: template string + event delegation. */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const H = 3600e3, DAY = 86400e3;

let S = null;            // stato di gioco (vista del server)
let ME = null;           // {username, instance}
let recvAt = 0;
let CAT = null;          // catalogo
let page = 'dash';
const ui = { shopTab: 'new', shopGrade: 'all', shopSort: 'grade', fuelDepot: null, fuelTons: 20, staffTab: 'pilots', rankTab: 'fed', period: 'week', board: 'standard', scope: 'global', route: { a: '', b: '' }, wxQ: '', mkt: [], mktAt: 0, selAc: null, finTab: 'pl' };
let FUEL = null, FUELAT = 0, WX = null, WXAT = 0, BOARD = null, PEERS = null, PREVIEW = null;

// ------------------------------------------------------------------ formattazione
const loc = () => ({ it: 'it-IT', en: 'en-US', ru: 'ru-RU' }[LANG] || 'en-US');
const nf = (n, d) => Number(n).toLocaleString(loc(), { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : d });
function money(n, full) {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (!full && a >= 1e12) return s + '$' + nf(a / 1e12, 2) + 'T';
  if (!full && a >= 1e9) return s + '$' + nf(a / 1e9, 2) + 'B';
  if (!full && a >= 1e6) return s + '$' + nf(a / 1e6, 2) + 'M';
  if (!full && a >= 1e4) return s + '$' + nf(a / 1e3, 1) + 'k';
  return s + '$' + nf(a);
}
const pct = (x, d) => nf(x * 100, d == null ? 0 : d) + '%';
function dur(ms) {
  ms = Math.max(0, ms);
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / H), m = Math.floor((ms % H) / 60000);
  if (d > 0) return d + t('u.d') + ' ' + h + t('u.h');
  if (h > 0) return h + t('u.h') + ' ' + m + t('u.m');
  return Math.max(1, m) + t('u.m');
}
function realDur(gameMs) {
  const sp = S.settings.speed; if (!sp) return '∞';
  const sec = Math.max(1, Math.round(gameMs / sp / 1000));
  if (sec < 90) return sec + 's';
  if (sec < 5400) return Math.round(sec / 60) + ' min';
  return nf(sec / 3600, 1) + ' h';
}
const dur2 = (ms) => dur(ms) + ' <span class="muted small">(≈' + realDur(ms) + ')</span>';
const clock = () => (S ? S.clock + (Date.now() - recvAt) * S.settings.speed : Date.now());
const gdate = (ms) => new Date(ms).toLocaleString(loc(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const gday = (ms) => new Date(ms).toLocaleDateString(loc(), { day: '2-digit', month: 'short' });
const mdl = (id) => CAT.byModel[id];
const apt = (c) => CAT.byIata[c];
const gradeBadge = (m) => `<span class="grade g${m.grade[0]}" title="${t('grade.tip')}">${m.grade}</span>`;
const licLetter = (c) => ['F', 'E', 'D', 'C', 'B', 'A'][c];
const lvlOf = (k) => S.levels[k] || 0;

// ------------------------------------------------------------------ UI base
function toast(msg, type) {
  const el = document.createElement('div'); el.className = 'toast ' + (type || ''); el.innerHTML = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4200);
}
function errMsg(e) {
  const c = e.code || 'server';
  let m = t('err.' + c);
  if (m === 'err.' + c) m = t('err.server') + ' (' + c + ')';
  if (c === 'noMoney' && e.extra) m += ' (' + money(e.extra.need) + ')';
  if (c === 'badPrice' && e.extra) m += ' (' + money(e.extra.min, true) + ' – ' + money(e.extra.max, true) + ')';
  return m;
}
function modal(html, wide) {
  const c = $('#modalCard'); c.className = 'modal-card' + (wide ? ' wide' : ''); c.innerHTML = html;
  $('#modal').classList.remove('hidden'); return c;
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalCard').innerHTML = ''; }
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

async function act(name, body, okMsg) {
  try {
    const r = await API.call('/api/do/' + name, body || {});
    S = r.state; recvAt = Date.now();
    if (okMsg) toast(okMsg, 'ok');
    afterState(true);
    return r;
  } catch (e) { toast(errMsg(e), 'err'); if (e.status === 401) logout(); return null; }
}
async function post(path, body, okMsg) {
  try {
    const r = await API.call(path, body);
    if (r.state) { S = r.state; recvAt = Date.now(); }
    if (okMsg) toast(okMsg, 'ok');
    afterState(true);
    return r;
  } catch (e) { toast(errMsg(e), 'err'); return null; }
}

// foto aerei da Wikipedia (cache in localStorage)
const photoMem = {};
function photoUrl(wiki) { try { return photoMem[wiki] || (photoMem[wiki] = localStorage.getItem('ph:' + wiki)); } catch (e) { return photoMem[wiki]; } }
async function fetchPhoto(wiki) {
  try {
    const j = await API.call('/api/photo?w=' + encodeURIComponent(wiki));
    if (!j.url) return null;
    photoMem[wiki] = j.url; try { localStorage.setItem('ph:' + wiki, j.url); } catch (e) { /* quota */ }
    return j.url;
  } catch (e) { return null; }
}
function hydratePhotos(root) {
  $$('img[data-wiki]', root || document).forEach(async (img) => {
    const w = img.dataset.wiki; let u = photoUrl(w);
    if (!u) u = await fetchPhoto(w);
    if (u && u !== 'none') { img.onload = () => img.classList.add('ld'); img.onerror = () => img.remove(); img.src = u; if (img.complete) img.classList.add('ld'); }
  });
}
const SIL = '<svg class="sil" viewBox="0 0 24 24"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';
const photo = (m) => `<div class="ph">${SIL}<img data-wiki="${m.wiki}" alt="${esc(m.maker + ' ' + m.name)}" loading="lazy">`;

// ------------------------------------------------------------------ avvio / autenticazione
function applyTheme() { document.documentElement.dataset.theme = (S && S.settings.theme) || localStorage.getItem('am_theme') || 'dark'; }
function setLang(l) { LANG = l; try { localStorage.setItem('am_lang', l); } catch (e) { /* ok */ } document.documentElement.lang = l; }

function langSwitch(cur) { return `<div class="seg">${['it', 'en', 'ru'].map((l) => `<button data-act="lang" data-v="${l}" class="${cur === l ? 'on' : ''}">${{ it: 'Italiano', en: 'English', ru: 'Русский' }[l]}</button>`).join('')}</div>`; }

let authTab = 'login';
async function showAuth() {
  $('#app').classList.add('hidden'); $('#onboard').classList.add('hidden');
  const el = $('#auth'); el.classList.remove('hidden');
  let inst = null; try { inst = await API.call('/api/fed/info'); } catch (e) { /* ignore */ }
  el.innerHTML = `<div class="box card">
    <div class="logo"><svg viewBox="0 0 24 24" width="34" height="34"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg> AirlineManager</div>
    <div class="hero-sub">${t('auth.sub')}</div>
    ${inst ? `<div class="pill acc" style="margin-bottom:14px">🌐 ${t('auth.instance')}: ${esc(inst.name)} · ${inst.players} ${t('auth.players')}</div>` : ''}
    <div class="row sp" style="margin-bottom:14px">${langSwitch(LANG)}</div>
    <div class="seg" style="margin-bottom:14px;width:100%"><button data-act="authTab" data-v="login" class="${authTab === 'login' ? 'on' : ''}">${t('auth.login')}</button><button data-act="authTab" data-v="register" class="${authTab === 'register' ? 'on' : ''}">${t('auth.register')}</button><button data-act="authTab" data-v="import" class="${authTab === 'import' ? 'on' : ''}">${t('auth.import')}</button></div>
    <form id="authForm" class="stack">
      ${authTab === 'import' ? `<label class="f">${t('auth.file')}<input type="file" id="impFile" accept=".json,application/json"></label><div class="muted small">${t('auth.importHelp')}</div>` : ''}
      <label class="f">${t('auth.user')}<input type="text" id="au" autocomplete="username" maxlength="20" required></label>
      <label class="f">${t('auth.pass')}<input type="password" id="ap" autocomplete="${authTab === 'login' ? 'current-password' : 'new-password'}" minlength="6" required></label>
      <button class="btn pri" type="submit" style="justify-content:center">${authTab === 'login' ? t('auth.login') : authTab === 'register' ? t('auth.create') : t('auth.doImport')}</button>
      <div class="muted small center">${t('auth.free')}</div>
    </form></div>`;
  $('#authForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const username = $('#au').value.trim(), password = $('#ap').value;
    try {
      let r;
      if (authTab === 'import') {
        const f = $('#impFile').files[0]; if (!f) return toast(t('auth.file'), 'err');
        const bundle = JSON.parse(await f.text());
        r = await API.call('/api/account/import', { bundle, username, password });
      } else r = await API.call(authTab === 'login' ? '/api/login' : '/api/register', { username, password });
      API.setToken(r.token); boot();
    } catch (e) { toast(e instanceof SyntaxError ? t('err.badBundle') : errMsg(e), 'err'); }
  });
}
function logout() { API.setToken(null); S = null; showAuth(); }

const COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#fb923c', '#2dd4bf'];
function showOnboard() {
  $('#auth').classList.add('hidden'); $('#app').classList.add('hidden');
  const el = $('#onboard'); el.classList.remove('hidden');
  const def = { it: 'MXP', en: 'LHR', ru: 'SVO' }[LANG];
  ui.ob = ui.ob || { color: COLORS[0], hub: def };
  const opts = CAT.airports.slice().sort((a, b) => a.city.localeCompare(b.city)).map((a) => `<option value="${a.iata}" ${a.iata === ui.ob.hub ? 'selected' : ''}>${a.city} (${a.iata}) – ${a.country}</option>`).join('');
  el.innerHTML = `<div class="box card"><div class="logo">✈️ ${t('ob.title')}</div><div class="hero-sub">${t('ob.sub')}</div>
    <div class="row sp" style="margin-bottom:12px">${langSwitch(LANG)}</div>
    <form id="obForm" class="stack">
      <label class="f">${t('ob.name')}<input type="text" id="obName" maxlength="32" required placeholder="Sky Dreams Airlines" value="${esc(ui.ob.name || '')}"></label>
      <label class="f">${t('ob.hub')}<select id="obHub">${opts}</select></label>
      <div class="muted small">${t('ob.hubHelp')}</div>
      <div class="f"><span class="muted small">${t('ob.color')}</span><div class="swatches">${COLORS.map((c) => `<button type="button" data-act="obColor" data-v="${c}" class="${ui.ob.color === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>
      <div class="card flat small">🎁 ${t('ob.gift')}</div>
      <button class="btn pri" style="justify-content:center">${t('ob.go')}</button>
      <button type="button" class="btn sm" data-act="logout">${t('settings.logout')}</button>
    </form></div>`;
  $('#obName').addEventListener('input', (e) => { ui.ob.name = e.target.value; });
  $('#obHub').addEventListener('change', (e) => { ui.ob.hub = e.target.value; });
  $('#obForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const r = await act('createCompany', { name: $('#obName').value, hub: $('#obHub').value, color: ui.ob.color, lang: LANG });
    if (r) startApp();
  });
}

async function boot() {
  if (!CAT) {
    const c = await API.call('/api/catalog');
    c.byIata = Object.fromEntries(c.airports.map((a) => [a.iata, a])); c.byModel = Object.fromEntries(c.models.map((m) => [m.id, m])); CAT = c;
  }
  if (!API.token) return showAuth();
  try {
    const r = await API.call('/api/state');
    S = r.state; ME = r; recvAt = Date.now();
  } catch (e) { return showAuth(); }
  setLang(S.settings.lang || LANG); applyTheme();
  if (!S.company) return showOnboard();
  startApp();
}

let started = false;
function startApp() {
  $('#auth').classList.add('hidden'); $('#onboard').classList.add('hidden'); $('#app').classList.remove('hidden');
  setLang(S.settings.lang); applyTheme();
  buildShell();
  const hash = location.hash.slice(1);
  go(PAGES[hash] ? hash : page);
  if (!started) { started = true; setInterval(poll, 3500); setInterval(secondTick, 1000); }
}

const NAV = [['dash', '🏠'], ['fleet', '✈️'], ['shop', '🛒'], ['routes', '🧭'], ['missions', '🎯'], ['fuel', '⛽'], ['bases', '🏢'], ['staff', '👥'], ['map', '🌍'], ['weather', '⛅'], ['rank', '🏆'], ['finance', '💶'], ['network', '🔗'], ['settings', '⚙️']];
function buildShell() {
  $('#nav').innerHTML = NAV.map(([id, ic]) => `<a data-act="go" data-v="${id}" id="nav-${id}"><span class="ic">${ic}</span><span>${t('nav.' + id)}</span>${id === 'missions' ? `<span class="badge" id="mBadge"></span>` : ''}</a>`).join('');
  $('#coName').textContent = S.company.name; $('#coHub').textContent = S.company.hub + ' · ' + apt(S.company.hub).city;
  $('#coDot').style.background = S.company.color; $('#coDot').style.color = S.company.color;
  $('#instBadge').innerHTML = `🌐 ${esc(ME.instance.name)}<br>👤 ${esc(ME.username)}`;
  $('#speedBox').innerHTML = [0, 60, 120, 360, 720, 1800].map((v) => `<button data-act="speed" data-v="${v}" class="${S.settings.speed === v ? 'on' : ''}" title="${t('speed.tip')}">${v === 0 ? 'II' : '×' + v}</button>`).join('');
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  updateTop();
}
function updateTop() {
  if (!S || !S.company) return;
  const c = $('#cash'); c.textContent = S.settings.unlimited ? '∞' : money(S.cash); c.classList.toggle('neg', S.cash < 0);
  $('#clock').textContent = '🕒 ' + gdate(clock());
  $$('#speedBox button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === S.settings.speed));
  const mb = $('#mBadge'); if (mb) { mb.textContent = S.missions.length; mb.style.display = S.missions.length ? '' : 'none'; }
}

// ------------------------------------------------------------------ router / polling
function go(p) {
  if (page === 'map' && p !== 'map') GlobeMap.unmount();
  page = p; location.hash = p; $('#side').classList.remove('open');
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.id === 'nav-' + p));
  lastHtml = '';
  render(true);
  window.scrollTo(0, 0);
}
let lastHtml = '';
function busy() { const a = document.activeElement; return !$('#modal').classList.contains('hidden') || (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && $('#page').contains(a)); }
function render(force) {
  const P = PAGES[page]; if (!P) return;
  if (page === 'map') { if (force) P.render(); else P.update && P.update(); return; }
  const html0 = P.render();
  const html = typeof html0 === 'string' ? frozenBanner() + html0 : html0;
  if (typeof html === 'string') {
    if (!force && html === lastHtml) return;
    lastHtml = html;
    const y = window.scrollY;
    $('#page').innerHTML = html;
    window.scrollTo(0, y);
  }
  P.after && P.after();
  hydratePhotos($('#page'));
  secondTick();
}
function afterState(forced) { updateTop(); if (forced) { if (!$('#modal').classList.contains('hidden') && !modalKeep) closeModal(); render(true); } else if (!busy()) render(false); }
let modalKeep = false;
let polling = false;
async function poll() {
  if (!API.token || polling || !S || document.hidden) return;
  polling = true;
  try {
    const r = await API.call('/api/state'); S = r.state; recvAt = Date.now();
    if (!S.company) return showOnboard();
    if (Date.now() - FUELAT > 60000 && ['fuel', 'dash'].includes(page)) loadFuel();
    if (Date.now() - WXAT > 120000 && ['weather', 'map'].includes(page)) loadWeather();
    updateTop(); if (!busy()) render(false);
  } catch (e) { if (e.status === 401) logout(); }
  polling = false;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
async function loadFuel() { FUELAT = Date.now(); try { FUEL = await API.call('/api/fuel'); if (page === 'fuel' || page === 'dash') render(true); } catch (e) { /* offline */ } }
async function loadWeather() { WXAT = Date.now(); try { WX = await API.call('/api/weather'); if (page === 'weather') render(true); if (page === 'map') GlobeMap.refreshStatic(); } catch (e) { /* offline */ } }

// aggiornamenti al secondo: orologio, barre di avanzamento, countdown
function secondTick() {
  if (!S || !S.company) return;
  const now = clock();
  $('#clock').textContent = '🕒 ' + gdate(now);
  $$('[data-prog]').forEach((el) => { const [a, b] = el.dataset.prog.split(',').map(Number); el.firstElementChild.style.width = Math.max(0, Math.min(100, ((now - a) / (b - a || 1)) * 100)) + '%'; });
  $$('[data-cd]').forEach((el) => { el.innerHTML = dur2(Number(el.dataset.cd) - now); });
}

// ------------------------------------------------------------------ azioni (event delegation)
const A = {
  lang(el) {
    const l = el.dataset.v;
    if (S && S.company) { act('settings', { lang: l }).then(() => { setLang(l); buildShell(); render(true); }); }
    else { setLang(l); if (!API.token) showAuth(); else showOnboard(); }
  },
  authTab(el) { authTab = el.dataset.v; showAuth(); },
  obColor(el) { ui.ob.color = el.dataset.v; showOnboard(); },
  logout() { logout(); },
  go(el) { go(el.dataset.v); },
  speed(el) { act('settings', { speed: Number(el.dataset.v) }); },
  close() { closeModal(); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const fn = A[el.dataset.act]; if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-chg]'); if (!el) return;
  const fn = A[el.dataset.chg]; if (fn) fn(el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-inp]'); if (!el) return;
  const fn = A[el.dataset.inp]; if (fn) fn(el, e);
});
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (S && S.company && PAGES[h] && h !== page) go(h); });

// ------------------------------------------------------------------ componenti
const kpi = (l, v, s, cls) => `<div class="kpi"><span class="l">${l}</span><span class="v ${cls || ''}">${v}</span>${s ? `<span class="s">${s}</span>` : ''}</div>`;
const head = (title, sub, right) => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row">${right || ''}</div></div>`;
const bar = (v, cls) => `<div class="bar ${cls || ''}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
const progBar = (a, b) => `<div class="bar" data-prog="${a},${b}"><i style="width:0"></i></div>`;
const row = (l, v) => `<div class="stat-row"><span class="muted">${l}</span><b>${v}</b></div>`;
const aptOpt = (sel, filter) => CAT.airports.filter(filter || (() => true)).sort((a, b) => a.city.localeCompare(b.city)).map((a) => `<option value="${a.iata}" ${a.iata === sel ? 'selected' : ''}>${a.iata} – ${a.city}, ${a.country}</option>`).join('');
const statusPill = (ac) => {
  const c = { idle: 'acc', boarding: 'ok', flying: 'ok', maintenance: 'warn', delivery: 'warn' }[ac.status];
  let txt = t('st.' + ac.status);
  if (ac.status === 'flying' && ac.flight && clock() < ac.flight.dep) txt = t('st.delayed');
  if (ac.status === 'flying' && ac.flight && ac.flight.mission) txt = '🎯 ' + txt;
  return `<span class="pill ${c}">${txt}</span>`;
};
const skipFee = {
  delivery: (ac) => { const m = mdl(ac.model); return Math.round(m.price * 0.06 * ((ac.nextAt - clock()) / (m.deliveryH * H)) + 1000); },
  maintenance: (ac) => Math.round(ac.mCost * 1.5 * ((ac.nextAt - clock()) / Math.max(1, ac.nextAt - ac.mStart)) + 200),
};

// ------------------------------------------------------------------ PAGINE
const PAGES = {};
const fitErr = (m, a, b) => {
  const d = Geo.dist(apt(a), apt(b));
  if (d > m.range * 0.95) return 'range';
  if (apt(a).size < m.minAirport || apt(b).size < m.minAirport) return 'airportSmall';
  return null;
};
const routeName = (r) => `${r.a} ⇄ ${r.b}`;
const confirmBox = (msg, cb) => { modal(`<h3>${t('confirm')}</h3><p>${msg}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">${t('cancel')}</button><button class="btn pri" id="cfOk">${t('ok')}</button></div>`); $('#cfOk').onclick = () => { closeModal(); cb(); }; };

// ---------- DASHBOARD
PAGES.dash = {
  render() {
    const d = S.daily, last = d[d.length - 1];
    const flying = S.fleet.filter((a) => a.status === 'flying').length;
    const active = S.fleet.filter((a) => a.routeId).length;
    const alerts = [];
    S.fleet.forEach((a) => { if (a.cond < 40 && a.status !== 'maintenance') alerts.push(`🔧 ${a.name}: ${t('alert.cond')} ${Math.round(a.cond)}%`); });
    if (S.cash < 0 && !S.settings.unlimited) alerts.push('💸 ' + t('alert.debt'));
    Object.entries(S.depots).forEach(([i, dp]) => { if (dp.tons < dp.cap * 0.1 && S.fleet.some((a) => a.routeId && (S.routes.find((r) => r.id === a.routeId) || {}).a === i)) alerts.push(`⛽ ${i}: ${t('alert.fuel')} (${nf(dp.tons, 1)} t)`); });
    if (S.fleet.some((a) => a.status === 'idle' && !a.routeId)) alerts.push('💤 ' + t('alert.idle'));
    if (!S.routes.length) alerts.push('🧭 ' + t('alert.noRoutes'));
    if (!FUEL) loadFuel();
    const fa = FUEL && FUEL.advice;
    const stand = [{ name: S.company.name, value: S.value, me: true, color: S.company.color }].concat(S.rivalsView.map((r) => ({ name: r.name, value: r.value, color: r.color }))).sort((a, b) => b.value - a.value);
    const rank = stand.findIndex((x) => x.me) + 1;
    return head(t('dash.title'), t('dash.sub', { n: S.company.name }), `<span class="pill acc">🏆 #${rank}/${stand.length}</span>`) + `
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card">${kpi(t('dash.cash'), S.settings.unlimited ? '∞' : money(S.cash), S.settings.unlimited ? '🧪 ' + t('sandbox') : t('dash.cashSub'), S.cash < 0 ? 'neg' : '')}</div>
      <div class="card">${kpi(t('dash.value'), money(S.value), t('dash.valueSub'))}</div>
      <div class="card">${kpi(t('dash.profit'), last ? money(last.profit) : '—', last ? t('dash.profitSub', { r: money(last.rev), c: money(last.cost) }) : t('dash.noData'), last && last.profit < 0 ? 'neg' : 'pos')}</div>
      <div class="card">${kpi(t('dash.rep'), nf(S.rep, 1) + '/100', bar(S.rep, S.rep > 60 ? 'ok' : S.rep > 35 ? 'warn' : 'bad'))}</div>
    </div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card">${kpi(t('dash.fleet'), S.fleet.length, t('dash.fleetSub', { a: active, f: flying }))}</div>
      <div class="card">${kpi(t('dash.flights'), nf(S.stats.flights), t('dash.pax', { p: nf(S.stats.pax) }))}</div>
      <div class="card">${kpi(t('dash.today'), S.today.flights, t('dash.todayRev', { r: money(S.today.revenue) }))}</div>
      <div class="card">${kpi(t('dash.missions'), S.mstats.done, t('dash.missionsSub', { n: S.missions.length, e: money(S.mstats.earned) }))}</div>
    </div>
    <div class="split">
      <div class="stack">
        <div class="card"><div class="row sp"><h3>${t('dash.chartCash')}</h3><span class="muted small">${t('dash.last30')}</span></div><div id="chCash"></div><div class="legend"><span><i style="background:#38bdf8"></i>${t('dash.cash')}</span><span><i style="background:#a78bfa"></i>${t('dash.value')}</span></div></div>
        <div class="card"><h3>${t('dash.chartProfit')}</h3><div id="chProfit"></div></div>
      </div>
      <div class="stack">
        ${alerts.length ? `<div class="card"><h3>⚠️ ${t('dash.alerts')}</h3>${alerts.map((a) => `<div class="logline warn">${a}</div>`).join('')}</div>` : ''}
        <div class="card"><h3>⛽ ${t('nav.fuel')}</h3>${fa ? `<div class="row sp"><b style="font-size:22px">${money(FUEL.current)}/t</b><span class="pill ${fa.action === 'buy' ? 'ok' : fa.action === 'wait' ? 'bad' : 'warn'}">${t('fuel.act.' + fa.action)}</span></div><div class="muted small" style="margin-top:6px">${t('fuel.adviceShort.' + fa.action)}</div><button class="btn sm" style="margin-top:8px" data-act="go" data-v="fuel">${t('nav.fuel')} →</button>` : `<div class="muted">${t('loading')}</div>`}</div>
        <div class="card"><h3>📰 ${t('dash.news')}</h3>${S.log.slice(0, 9).map((l) => `<div class="logline ${l.lvl}"><time>${gdate(l.t)}</time><span>${logText(l)}</span></div>`).join('') || `<div class="muted">—</div>`}</div>
      </div>
    </div>`;
  },
  after() {
    const d = S.daily.slice(-30);
    if (d.length < 2) { $('#chCash').innerHTML = `<div class="muted center" style="padding:30px">${t('dash.noData')}</div>`; $('#chProfit').innerHTML = ''; return; }
    Charts.line($('#chCash'), { h: 220, fmtY: (v) => money(v), fmtX: (x) => gday(x), series: [{ name: t('dash.cash'), color: '#38bdf8', fill: true, data: d.map((p) => [p.t, p.cash]) }, { name: t('dash.value'), color: '#a78bfa', data: d.map((p) => [p.t, p.value]) }] });
    Charts.bars($('#chProfit'), { h: 170, data: d.map((p) => ({ x: p.t, y: p.profit })), fmtY: (v) => money(v), fmtX: gday });
  },
};
function logText(l) {
  const p = Object.assign({}, l.p);
  if (p.m && /^[a-z]/.test(p.m) && l.k === 'logMissionDone') p.m = t('mt.' + p.m);
  if (l.k === 'logCourseDone') p.c = t('course.' + p.c);
  if (p.r !== undefined && typeof p.r === 'number') p.r = money(p.r);
  if (l.k === 'logSoldUsed') p.p = money(p.p);
  return t('log.' + l.k, p);
}

// ---------- FLOTTA
const acCard = (ac) => {
  const m = mdl(ac.model), r = S.routes.find((x) => x.id === ac.routeId);
  const cond = Math.round(ac.cond);
  let st = '';
  if (ac.status === 'delivery') st = `${progBar(ac.dStart || ac.bought, ac.nextAt)}<div class="small muted">${t('fleet.delivery')}: <span data-cd="${ac.nextAt}"></span></div><button class="btn sm warn" data-act="skip" data-id="${ac.id}">⚡ ${t('skip')} (${money(skipFee.delivery(ac))})</button>`;
  else if (ac.status === 'maintenance') st = `${progBar(ac.mStart, ac.nextAt)}<div class="small muted">${t('fleet.maint')}: <span data-cd="${ac.nextAt}"></span></div><button class="btn sm warn" data-act="skip" data-id="${ac.id}">⚡ ${t('skip')} (${money(skipFee.maintenance(ac))})</button>`;
  else if (ac.status === 'flying' && ac.flight) { const f = ac.flight; st = `${progBar(f.dep, f.arr)}<div class="small muted">${f.from} → ${f.to} · ${f.mission ? '🎯 ' : ''}${f.cargo ? nf(f.cargo, 1) + ' t' : f.pax + ' pax'} · ${t('fleet.eta')} <span data-cd="${f.arr}"></span></div>`; }
  const fitting = S.routes.map((rt) => { const e = fitErr(m, rt.a, rt.b); return `<option value="${rt.id}" ${ac.routeId === rt.id ? 'selected' : ''} ${e && ac.routeId !== rt.id ? 'disabled' : ''}>${routeName(rt)}${e ? ' ✕ ' + t('err.' + e) : ''}</option>`; }).join('');
  const canAssign = ['idle', 'boarding'].includes(ac.status);
  return `<div class="card ac">${photo(m)}<div class="tl">${gradeBadge(m)}${ac.role === 'cargo' ? '<span class="pill warn">📦 CARGO</span>' : ''}</div><div class="tr">${statusPill(ac)}</div></div>
    <div class="bd">
      <div class="row sp"><div><div class="nm">${esc(ac.name)}</div><div class="mk">${m.maker} ${m.name}</div></div><div class="right small muted">📍 ${ac.loc}<br>${nf(ac.hours)} h · ${ac.flights || 0} ✈</div></div>
      ${st}
      <div><div class="row sp small"><span class="muted">${t('fleet.cond')}</span><b>${cond}%</b></div>${bar(cond, cond > 60 ? 'ok' : cond > 35 ? 'warn' : 'bad')}</div>
      <label class="f">${t('fleet.route')}<select data-chg="assign" data-id="${ac.id}" ${canAssign ? '' : 'disabled'}><option value="">— ${t('fleet.noRoute')} —</option>${fitting}</select></label>
      ${ac.last ? `<div class="small muted">${t('fleet.last')}: ${ac.last.from}→${ac.last.to} · ${ac.last.cargo ? nf(ac.last.cargo, 1) + ' t' : ac.last.pax + ' pax'} · <span class="${ac.last.rev - ac.last.cost >= 0 ? 'pos' : 'neg'}">${money(ac.last.rev - ac.last.cost)}</span></div>` : ''}
      <div class="row small"><span class="muted">${t('fleet.profit')}:</span> <b class="${(ac.profit || 0) >= 0 ? 'pos' : 'neg'}">${money(ac.profit || 0)}</b></div>
      <div class="row">
        <button class="btn sm" data-act="maint" data-id="${ac.id}" ${canAssign ? '' : 'disabled'}>🔧 ${t('fleet.service')}</button>
        <button class="btn sm" data-act="role" data-id="${ac.id}" ${ac.status === 'idle' ? '' : 'disabled'}>${ac.role === 'cargo' ? '🧳 ' + t('fleet.toPax') : '📦 ' + t('fleet.toCargo')}</button>
        <button class="btn sm" data-act="listAc" data-id="${ac.id}" ${ac.status === 'idle' ? '' : 'disabled'}>🏷 ${t('fleet.sell')}</button>
      </div>
    </div></div>`;
};
PAGES.fleet = {
  render() {
    const body = S.fleet.length ? `<div class="grid cols">${S.fleet.map(acCard).join('')}</div>` : `<div class="card center muted" style="padding:40px">${t('fleet.empty')}<br><br><button class="btn pri" data-act="go" data-v="shop">🛒 ${t('nav.shop')}</button></div>`;
    return head(t('fleet.title'), t('fleet.sub', { n: S.fleet.length }), `<button class="btn" data-act="go" data-v="shop">🛒 ${t('nav.shop')}</button>`) + body;
  },
};
Object.assign(A, {
  assign(el) { const v = el.value; act('assign', { id: Number(el.dataset.id), routeId: v ? Number(v) : null }, v ? t('ok.assigned') : null); },
  skip(el) { act('skipAircraft', { id: Number(el.dataset.id) }); },
  maint(el) { const ac = S.fleet.find((a) => a.id === Number(el.dataset.id)); const m = mdl(ac.model); confirmBox(t('fleet.maintConfirm', { n: ac.name, c: money(m.price * 0.004 * (1 + (100 - ac.cond) / 100) * (1 - 0.1 * ((S.bases.find((b) => b.iata === ac.loc) || {}).hangar || 0)) + 400) }), () => act('maintenance', { id: ac.id })); },
  role(el) { const ac = S.fleet.find((a) => a.id === Number(el.dataset.id)); const to = ac.role === 'cargo' ? 'pax' : 'cargo'; const c = Math.round(mdl(ac.model).price * 0.03 + 500); confirmBox(t('fleet.roleConfirm', { n: ac.name, r: t('role.' + to), c: money(c) }), () => act('setRole', { id: ac.id, role: to })); },
  listAc(el) {
    const ac = S.fleet.find((a) => a.id === Number(el.dataset.id)), m = mdl(ac.model), b = ac.band;
    modal(`<h2>🏷 ${t('mkt.sellTitle')}</h2><p class="muted">${m.maker} ${m.name} · ${esc(ac.name)} · ${nf(ac.hours)} h · ${Math.round(ac.cond)}%</p>
      <div class="card flat stack"><div class="row sp"><span>${t('mkt.ref')}</span><b>${money(b.fair, true)}</b></div><div class="row sp"><span>${t('mkt.band')}</span><b>${money(b.min, true)} – ${money(b.max, true)}</b></div><div class="row sp"><span>${t('mkt.instant')}</span><b>${money(ac.resale, true)}</b></div></div>
      <label class="f" style="margin-top:12px">${t('mkt.price')}<input type="number" id="lpPrice" value="${b.fair}" min="${b.min}" max="${b.max}" step="1000"></label>
      <input type="range" id="lpRange" min="${b.min}" max="${b.max}" step="1000" value="${b.fair}" style="margin:8px 0">
      <div class="muted small">${t('mkt.fee')}</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn bad" id="lpSell">${t('mkt.instantSell')} (${money(ac.resale)})</button><button class="btn pri" id="lpGo">${t('mkt.list')}</button></div>`);
    $('#lpRange').oninput = (e) => { $('#lpPrice').value = e.target.value; };
    $('#lpPrice').oninput = (e) => { $('#lpRange').value = e.target.value; };
    $('#lpGo').onclick = async () => { const r = await post('/api/market/list', { id: ac.id, price: Number($('#lpPrice').value) }, t('mkt.listed')); if (r) closeModal(); };
    $('#lpSell').onclick = () => { closeModal(); act('sellAircraft', { id: ac.id }, t('ok.sold')); };
  },
});

// ---------- NEGOZIO
const GRP = ['all', 'F', 'E', 'D', 'C', 'B', 'A'];
PAGES.shop = {
  render() {
    const tabs = `<div class="seg"><button data-act="shopTab" data-v="new" class="${ui.shopTab === 'new' ? 'on' : ''}">🆕 ${t('shop.new')}</button><button data-act="shopTab" data-v="used" class="${ui.shopTab === 'used' ? 'on' : ''}">♻️ ${t('shop.used')}</button></div>`;
    const flt = `<div class="seg">${GRP.map((g) => `<button data-act="shopGrade" data-v="${g}" class="${ui.shopGrade === g ? 'on' : ''}">${g === 'all' ? t('all') : g}</button>`).join('')}</div>
      <select data-chg="shopSort" style="width:auto"><option value="grade" ${ui.shopSort === 'grade' ? 'selected' : ''}>${t('shop.sortGrade')}</option><option value="price" ${ui.shopSort === 'price' ? 'selected' : ''}>${t('shop.sortPrice')}</option><option value="seats" ${ui.shopSort === 'seats' ? 'selected' : ''}>${t('shop.sortSeats')}</option><option value="range" ${ui.shopSort === 'range' ? 'selected' : ''}>${t('shop.sortRange')}</option></select>`;
    const sorter = (a, b) => ui.shopSort === 'price' ? a.price - b.price : ui.shopSort === 'seats' ? b.seats - a.seats : ui.shopSort === 'range' ? b.range - a.range : a.gi - b.gi || a.price - b.price;
    let body;
    if (ui.shopTab === 'new') {
      const list = CAT.models.filter((m) => ui.shopGrade === 'all' || m.grade[0] === ui.shopGrade).sort(sorter);
      body = `<div class="grid cols">${list.map((m) => `<div class="card ac">${photo(m)}<div class="tl">${gradeBadge(m)}</div><div class="tr"><span class="pill">${m.year}</span></div></div><div class="bd">
        <div><div class="nm">${m.name}</div><div class="mk">${m.maker}</div></div>
        <div class="specs"><div><b>${m.seats}</b><span>${t('spec.seats')}</span></div><div><b>${nf(m.range)} km</b><span>${t('spec.range')}</span></div><div><b>${nf(m.speed)}</b><span>km/h</span></div><div><b>${nf(m.burn)}</b><span>kg/h</span></div><div><b>${CAT.models && cargoCapOf(m)} t</b><span>${t('spec.cargo')}</span></div><div><b>${m.minAirport}+</b><span>${t('spec.airport')}</span></div></div>
        <div class="row sp"><div><b style="font-size:19px">${money(m.price, true)}</b><div class="small muted">⏱ ${dur2(m.deliveryH * H)}</div></div><button class="btn pri" data-act="buy" data-id="${m.id}">${t('shop.buy')}</button></div></div></div>`).join('')}</div>`;
    } else {
      const items = ui.mkt.filter((l) => ui.shopGrade === 'all' || mdl(l.model).grade[0] === ui.shopGrade);
      body = `<div class="muted small" style="margin-bottom:10px">${t('shop.usedHelp')}</div>` + (items.length ? `<div class="grid cols">${items.map((l) => { const m = mdl(l.model); const vs = (l.price - l.ref) / l.ref; return `<div class="card ac">${photo(m)}<div class="tl">${gradeBadge(m)}${l.role === 'cargo' ? '<span class="pill warn">📦</span>' : ''}</div><div class="tr"><span class="pill ${l.instanceId === ME.instance.id ? 'acc' : ''}">🌐 ${esc(l.instance)}</span></div></div><div class="bd">
        <div class="row sp"><div><div class="nm">${m.name}</div><div class="mk">${m.maker} · ${esc(l.name)}</div></div><div class="right small muted">👤 ${esc(l.seller)}</div></div>
        <div class="specs"><div><b>${nf(l.hours)} h</b><span>${t('spec.hours')}</span></div><div><b>${Math.round(l.cond)}%</b><span>${t('fleet.cond')}</span></div><div><b>${l.flights}</b><span>${t('spec.flights')}</span></div></div>
        <div class="row sp"><div><b style="font-size:19px">${money(l.price, true)}</b><div class="small ${vs <= 0 ? 'pos' : 'warn'}">${vs <= 0 ? '' : '+'}${nf(vs * 100, 1)}% ${t('mkt.vsRef')}</div></div>
        ${l.mine ? `<button class="btn bad sm" data-act="mktCancel" data-id="${l.id}">${t('mkt.cancel')}</button>` : `<button class="btn pri" data-act="mktBuy" data-key="${l.key}">${t('shop.buy')}</button>`}</div></div></div>`; }).join('')}</div>` : `<div class="card center muted" style="padding:40px">${t('mkt.empty')}</div>`);
    }
    return head(t('shop.title'), t('shop.sub'), tabs) + `<div class="row" style="margin-bottom:14px">${flt}</div>` + body;
  },
  after() { if (ui.shopTab === 'used' && Date.now() - ui.mktAt > 20000) loadMarket(); },
};
const cargoCapOf = (m) => nf(Math.round(m.seats * (0.06 + 0.025 * m.cls) * 10) / 10, 1);
async function loadMarket() { ui.mktAt = Date.now(); try { ui.mkt = (await API.call('/api/market')).items; if (page === 'shop') render(true); } catch (e) { /* offline */ } }
Object.assign(A, {
  shopTab(el) { ui.shopTab = el.dataset.v; if (ui.shopTab === 'used') loadMarket(); render(true); },
  shopGrade(el) { ui.shopGrade = el.dataset.v; render(true); },
  shopSort(el) { ui.shopSort = el.value; render(true); },
  buy(el) {
    const m = mdl(el.dataset.id); ui.buyRole = 'pax';
    const paint = () => { $('#bRole').innerHTML = ['pax', 'cargo'].map((r) => `<button data-act="buyRole" data-v="${r}" class="${ui.buyRole === r ? 'on' : ''}">${r === 'pax' ? '🧳 ' : '📦 '}${t('role.' + r)}</button>`).join(''); };
    modal(`<h2>${m.maker} ${m.name} ${gradeBadge(m)}</h2><div class="card ac" style="margin:10px 0">${photo(m)}</div></div>
      <div class="stack"><div class="row sp"><span>${t('shop.price')}</span><b>${money(m.price, true)}</b></div><div class="row sp"><span>${t('fleet.delivery')}</span><b>${dur2(m.deliveryH * H)}</b></div><div class="row sp"><span>${t('shop.cashAfter')}</span><b class="${S.cash - m.price < 0 ? 'neg' : ''}">${S.settings.unlimited ? '∞' : money(S.cash - m.price)}</b></div>
      <div><div class="muted small" style="margin-bottom:5px">${t('shop.role')}</div><div class="seg" id="bRole"></div></div>
      <div class="muted small">${t('shop.skipHelp', { f: money(m.price * 0.06 + 1000) })}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-act="close">${t('cancel')}</button><button class="btn pri" data-act="buyGo" data-id="${m.id}">${t('shop.buy')}</button></div></div>`);
    paint(); hydratePhotos($('#modalCard'));
  },
  buyRole(el) { ui.buyRole = el.dataset.v; $$('#bRole button').forEach((b) => b.classList.toggle('on', b.dataset.v === ui.buyRole)); },
  async buyGo(el) { const r = await act('buyAircraft', { model: el.dataset.id, role: ui.buyRole }, t('ok.bought')); if (r) { closeModal(); go('fleet'); } },
  mktBuy(el) {
    const l = ui.mkt.find((x) => x.key === el.dataset.key), m = mdl(l.model);
    confirmBox(t('mkt.buyConfirm', { m: m.maker + ' ' + m.name, p: money(l.price, true), i: l.instance }), async () => { const r = await post('/api/market/buy', { instanceId: l.instanceId, id: l.id, price: l.price }, t('ok.bought')); if (r) { loadMarket(); go('fleet'); } });
  },
  async mktCancel(el) { const r = await post('/api/market/cancel', { id: el.dataset.id }, t('mkt.cancelled')); if (r) loadMarket(); },
});

// ---------- ROTTE
PAGES.routes = {
  render() {
    const { a, b } = ui.route;
    const pv = PREVIEW && PREVIEW.a === a && PREVIEW.b === b ? PREVIEW : null;
    const exists = S.routes.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    const create = `<div class="card"><h3>➕ ${t('routes.new')}</h3><div class="grid g2"><label class="f">${t('routes.from')}<select data-chg="rtA"><option value="">—</option>${aptOpt(a)}</select></label><label class="f">${t('routes.to')}<select data-chg="rtB"><option value="">—</option>${aptOpt(b)}</select></label></div>
      ${a && b && a !== b ? (pv ? `<div class="grid g4" style="margin-top:12px"><div class="card flat">${kpi(t('routes.dist'), nf(pv.dist) + ' km', '≈ ' + nf(pv.dist / 800, 1) + ' h')}</div><div class="card flat">${kpi(t('routes.fare'), money(pv.fair), t('routes.fareSub'))}</div><div class="card flat">${kpi(t('routes.demand'), nf(pv.demand), t('routes.demandSub'))}</div><div class="card flat">${kpi(t('routes.rivals'), pv.rivals, t('routes.slot') + ': ' + money(pv.slotCost))}</div></div>
      <div style="margin-top:10px"><div class="muted small">${t('routes.suit')}</div><div class="row" style="margin-top:6px">${(S.fleet.map((ac) => ({ ac, m: mdl(ac.model) })).filter((x) => !fitErr(x.m, a, b)).map((x) => `<span class="pill ok">${esc(x.ac.name)} · ${x.m.name}</span>`).join('') || `<span class="pill warn">${t('routes.noSuit')}</span>`)}</div></div>
      <div class="row" style="margin-top:12px"><button class="btn pri" data-act="rtCreate" ${exists ? 'disabled' : ''}>${exists ? t('err.exists') : t('routes.create') + ' (' + money(pv.slotCost) + ')'}</button></div>` : `<div class="muted" style="margin-top:12px">${t('loading')}</div>`) : `<div class="muted" style="margin-top:12px">${t('routes.pick')}</div>`}</div>`;
    const list = S.routes.map((r) => {
      const e = r.econ, st = r.stats, acs = S.fleet.filter((x) => x.routeId === r.id);
      const profit = st.revenue - st.cost, fare = Math.round(e.fair * r.priceMul);
      const idle = S.fleet.filter((x) => (x.status === 'idle') && !fitErr(mdl(x.model), r.a, r.b));
      return `<div class="card"><div class="row sp"><div><h3 style="margin:0">${routeName(r)}</h3><div class="muted small">${apt(r.a).city} – ${apt(r.b).city} · ${nf(e.dist)} km</div></div><div class="row"><span class="pill ${e.rivals ? 'warn' : 'ok'}">⚔ ${e.rivals} ${t('routes.rivalsS')}</span><button class="btn sm bad" data-act="rtDel" data-id="${r.id}">🗑</button></div></div>
        <div class="grid g3" style="margin:10px 0"><div>${kpi(t('routes.lf'), pct(st.lf || 0), '')}${bar((st.lf || 0) * 100, st.lf > .7 ? 'ok' : st.lf > .45 ? 'warn' : 'bad')}</div><div>${kpi(t('routes.flights'), nf(st.flights), nf(st.pax) + ' pax')}</div><div>${kpi(t('routes.profit'), money(profit), '', profit >= 0 ? 'pos' : 'neg')}</div></div>
        <label class="f"><span>${t('routes.price')}: <b>×${nf(r.priceMul, 2)}</b> · ${t('routes.fareS')} ${money(fare)} · ${t('routes.demandS')} ${nf(e.demand)}/${t('u.dayShort')}</span>
          <input type="range" min="0.5" max="2" step="0.05" value="${r.priceMul}" data-chg="rtPrice" data-id="${r.id}"></label>
        <div class="row" style="margin-top:8px">${acs.map((x) => `<span class="pill acc">${esc(x.name)}</span>`).join('') || `<span class="muted small">${t('routes.noAc')}</span>`}
        ${idle.length ? `<select data-chg="rtAdd" data-id="${r.id}" style="width:auto"><option value="">+ ${t('routes.addAc')}</option>${idle.map((x) => `<option value="${x.id}">${esc(x.name)} · ${mdl(x.model).name}</option>`).join('')}</select>` : ''}</div></div>`;
    }).join('') || `<div class="card center muted" style="padding:30px">${t('routes.empty')}</div>`;
    return head(t('routes.title'), t('routes.sub')) + `<div class="split"><div class="stack"><h2>${t('routes.mine')} (${S.routes.length})</h2>${list}</div><div class="stack" style="align-self:start">${create}<div class="card flat small muted">💡 ${t('routes.tip')}</div></div></div>`;
  },
};
async function loadPreview() {
  const { a, b } = ui.route; PREVIEW = null;
  if (a && b && a !== b) { try { const r = await API.call(`/api/route/preview?a=${a}&b=${b}`); PREVIEW = Object.assign({ a, b }, r); } catch (e) { toast(errMsg(e), 'err'); } }
  render(true);
}
Object.assign(A, {
  rtA(el) { ui.route.a = el.value; loadPreview(); },
  rtB(el) { ui.route.b = el.value; loadPreview(); },
  async rtCreate() { const r = await act('createRoute', { a: ui.route.a, b: ui.route.b }, t('ok.routeCreated')); if (r) { ui.route = { a: '', b: '' }; PREVIEW = null; render(true); } },
  rtPrice(el) { act('updateRoute', { id: Number(el.dataset.id), priceMul: Number(el.value) }); },
  rtDel(el) { confirmBox(t('routes.delConfirm'), () => act('deleteRoute', { id: Number(el.dataset.id) })); },
  rtAdd(el) { if (el.value) act('assign', { id: Number(el.value), routeId: Number(el.dataset.id) }, t('ok.assigned')); },
});

// ---------- MISSIONI
const MTYPE_ICON = { vip: '🥂', medical: '🚑', press: '🎥', sport: '⚽', charter: '👥', tourist: '🏝', cargo: '📦', humanitarian: '🆘', fresh: '🥬', mail: '✉️', industrial: '🏭' };
const cargoNum = (m) => Math.round(m.seats * (0.06 + 0.025 * m.cls) * 10) / 10;
function missionEligibility(ms) {
  const isCargo = ms.cargo > 0;
  return S.fleet.filter((a) => a.status === 'idle' && !a.routeId).map((ac) => {
    const m = mdl(ac.model); let why = null;
    const bh = ms.dist / (m.speed * 0.9) + 0.45;
    if ((ac.role === 'cargo') !== isCargo) why = t('err.wrongRole');
    else if (isCargo ? cargoNum(m) < ms.cargo : m.seats < ms.pax) why = t('err.tooSmall');
    else if (fitErr(m, ms.from, ms.to)) why = t('err.' + fitErr(m, ms.from, ms.to));
    else if (S.pilots.filter((p) => p.status === 'free' && p.cls >= m.cls).length < 2) why = t('err.noPilots');
    else if (clock() + 0.5 * H + bh * H > ms.deadline) why = t('err.tooLate');
    return { ac, m, why, bh };
  });
}
PAGES.missions = {
  render() {
    const cards = S.missions.slice().sort((a, b) => a.deadline - b.deadline).map((ms) => {
      const cargo = ms.cargo > 0, ok = missionEligibility(ms).filter((x) => !x.why).length;
      return `<div class="card mission ${cargo ? 'cargo' : ''}"><div class="row sp"><div><h3 style="margin:0">${MTYPE_ICON[ms.type]} ${t('mt.' + ms.type)}</h3><div class="muted small">${esc(ms.client)}</div></div><b class="pos" style="font-size:19px">${money(ms.reward, true)}</b></div>
        <p class="muted small" style="margin:8px 0">${t('md.' + ms.type)}</p>
        <div class="stat-row"><span class="muted">${t('routes.title')}</span><b>${ms.from} → ${ms.to}</b></div>
        <div class="stat-row"><span class="muted">${apt(ms.from).city} – ${apt(ms.to).city}</span><b>${nf(ms.dist)} km</b></div>
        <div class="stat-row"><span class="muted">${cargo ? t('spec.cargo') : t('spec.seats')}</span><b>${cargo ? nf(ms.cargo, 1) + ' t' : ms.pax + ' pax'}</b></div>
        <div class="stat-row"><span class="muted">⏳ ${t('missions.deadline')}</span><b data-cd="${ms.deadline}"></b></div>
        <div class="row sp" style="margin-top:10px"><span class="small ${ok ? 'pos' : 'muted'}">${ok ? '✓ ' + t('missions.eligible', { n: ok }) : t('missions.noAc')}</span><div class="row"><button class="btn sm" data-act="msDismiss" data-id="${ms.id}">✕</button><button class="btn pri sm" data-act="msOpen" data-id="${ms.id}">${t('missions.accept')}</button></div></div></div>`;
    }).join('') || `<div class="card center muted" style="padding:40px">${t('missions.empty')}</div>`;
    return head(t('missions.title'), t('missions.sub'), `<span class="pill ok">✓ ${S.mstats.done}</span><span class="pill bad">✕ ${S.mstats.failed}</span><span class="pill acc">${money(S.mstats.earned)}</span>`) + `<div class="grid cols">${cards}</div><div class="muted small" style="margin-top:14px">💡 ${t('missions.tip')}</div>`;
  },
};
Object.assign(A, {
  msDismiss(el) { act('dismissMission', { id: Number(el.dataset.id) }); },
  msOpen(el) {
    const ms = S.missions.find((m) => m.id === Number(el.dataset.id)); if (!ms) return;
    const el2 = missionEligibility(ms);
    modal(`<h2>${MTYPE_ICON[ms.type]} ${t('mt.' + ms.type)} – ${esc(ms.client)}</h2><p class="muted">${ms.from} → ${ms.to} · ${nf(ms.dist)} km · ${money(ms.reward, true)} · ⏳ <span data-cd="${ms.deadline}"></span></p>
      <div class="stack">${el2.map((x) => `<div class="card flat row sp"><div><b>${esc(x.ac.name)}</b> <span class="muted">${x.m.name}</span><div class="small muted">📍 ${x.ac.loc} · ✈ ${dur(x.bh * H)}</div></div>${x.why ? `<span class="pill bad">${x.why}</span>` : `<button class="btn pri sm" data-act="msGo" data-id="${ms.id}" data-ac="${x.ac.id}">${t('missions.fly')}</button>`}</div>`).join('') || `<div class="muted center">${t('missions.noIdle')}</div>`}</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-act="close">${t('cancel')}</button></div>`);
    secondTick();
  },
  async msGo(el) { const r = await act('acceptMission', { id: Number(el.dataset.id), ac: Number(el.dataset.ac) }, t('ok.missionStart')); if (r) closeModal(); },
});

// ---------- CARBURANTE
PAGES.fuel = {
  render() {
    if (!FUEL) { loadFuel(); return head(t('fuel.title'), t('fuel.sub')) + `<div class="card center muted" style="padding:40px">${t('loading')}</div>`; }
    const F = FUEL, ad = F.advice, st = F.stats;
    const depIatas = Object.keys(S.depots);
    if (!ui.fuelDepot || !S.depots[ui.fuelDepot]) ui.fuelDepot = S.company.hub;
    const dp = S.depots[ui.fuelDepot];
    const tons = Math.min(ui.fuelTons, dp.cap - dp.tons), cost = tons * F.current;
    const icon = { buy: '🟢', wait: '🔴', neutral: '🟡' }[ad.action];
    const table = depIatas.map((i) => { const d = S.depots[i]; const diff = d.tons ? (F.current - d.avgCost) / d.avgCost : 0; return `<tr><td><b>${i}</b><div class="small muted">${apt(i).city}</div></td><td style="min-width:130px">${nf(d.tons, 1)} / ${d.cap} t${bar((d.tons / d.cap) * 100, d.tons / d.cap > .25 ? 'ok' : 'bad')}</td><td>${d.tons ? money(d.avgCost) : '—'}${d.tons ? `<div class="small ${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '+' : ''}${nf(diff * 100, 1)}% ${t('fuel.vsNow')}</div>` : ''}</td>
      <td><div class="row"><label class="row small"><input type="checkbox" data-chg="fuelAuto" data-i="${i}" ${d.auto.on ? 'checked' : ''}> ${t('fuel.auto')}</label></div><div class="row small muted">${t('fuel.min')} <input type="number" style="width:70px;padding:4px" value="${d.auto.min}" data-chg="fuelAuto" data-i="${i}" data-f="min"> ${t('fuel.fill')} <input type="number" style="width:70px;padding:4px" value="${d.auto.fill}" data-chg="fuelAuto" data-i="${i}" data-f="fill"></div></td>
      <td class="right"><button class="btn sm" data-act="tankUp" data-i="${i}">+200 t (${money(Math.round(100000 * Math.pow(1 + d.capLevel, 1.5)))})</button></td></tr>`; }).join('');
    return head(t('fuel.title'), t('fuel.sub'), `<span class="pill ${F.source === 'live' ? 'ok' : 'warn'}">${F.source === 'live' ? '● ' + t('fuel.live') : '◌ ' + t('fuel.sim')}</span>`) + `
    <div class="grid g4" style="margin-bottom:14px">
      <div class="card">${kpi(t('fuel.price'), money(F.current) + '<small>/t</small>', '≈ $' + nf(F.current * 0.0008, 2) + '/L')}</div>
      <div class="card">${kpi(t('fuel.avg30'), money(st.m30), (F.current >= st.m30 ? '▲ ' : '▼ ') + nf((F.current / st.m30 - 1) * 100, 1) + '%', F.current >= st.m30 ? 'neg' : 'pos')}</div>
      <div class="card">${kpi(t('fuel.range90'), money(st.min90) + ' – ' + money(st.max90), t('fuel.pctl', { p: nf(st.pct * 100) }))}</div>
      <div class="card">${kpi(t('fuel.forecast7'), (st.exp7 >= 0 ? '+' : '') + nf(st.exp7 * 100, 1) + '%', t('fuel.forecastSub'), st.exp7 > 0 ? 'neg' : 'pos')}</div>
    </div>
    <div class="advice ${ad.action}" style="margin-bottom:14px"><div class="big">${icon}</div><div><h3 style="margin:0">${t('fuel.act.' + ad.action)}</h3><div>${t('fuel.adv.' + ad.action, { p: nf(st.pct * 100), e: nf(Math.abs(st.exp7) * 100, 1), d: ad.bestDay, bp: money(ad.bestPrice), s: nf(ad.saving * 100, 1) })}</div>
      <div class="small muted" style="margin-top:4px">${t('fuel.bestDay', { d: ad.bestDay, p: money(ad.bestPrice) })}</div></div></div>
    <div class="split"><div class="stack">
      <div class="card"><h3>${t('fuel.chart')}</h3><div id="chFuel"></div><div class="legend"><span><i style="background:#38bdf8"></i>${t('fuel.hist')}</span><span><i style="background:#fbbf24"></i>${t('fuel.fc')}</span><span><i style="background:#fbbf24;opacity:.3"></i>${t('fuel.band')}</span></div><div class="muted small" style="margin-top:6px">${t('fuel.disc')}</div></div>
      <div class="card"><h3>🛢 ${t('fuel.depots')}</h3><div class="scroll-x"><table><tr><th>${t('fuel.airport')}</th><th>${t('fuel.stock')}</th><th>${t('fuel.avgCost')}</th><th>${t('fuel.auto')}</th><th></th></tr>${table}</table></div><div class="muted small" style="margin-top:8px">${t('fuel.depotHelp')}</div></div></div>
      <div class="card" style="align-self:start"><h3>🛒 ${t('fuel.buy')}</h3>
        <label class="f">${t('fuel.where')}<select data-chg="fuelDepot">${depIatas.map((i) => `<option value="${i}" ${i === ui.fuelDepot ? 'selected' : ''}>${i} – ${apt(i).city}</option>`).join('')}</select></label>
        <div class="row sp small muted" style="margin:8px 0"><span>${t('fuel.stock')}: ${nf(dp.tons, 1)}/${dp.cap} t</span><span>${t('fuel.free')}: ${nf(dp.cap - dp.tons, 1)} t</span></div>
        <label class="f">${t('fuel.tons')}<input type="number" min="0" step="1" value="${ui.fuelTons}" data-inp="fuelTons" id="fuelTons"></label>
        <div class="row" style="margin:8px 0">${[10, 50, 100].map((n) => `<button class="btn sm" data-act="fuelQ" data-n="${n}">+${n}</button>`).join('')}<button class="btn sm" data-act="fuelQ" data-n="max">${t('fuel.fillTank')}</button></div>
        <div class="card flat"><div class="row sp"><span>${t('fuel.total')}</span><b id="fuelCost">${money(cost, true)}</b></div></div>
        <div class="row" style="margin-top:10px"><button class="btn pri" data-act="fuelBuy" style="flex:1;justify-content:center">${t('fuel.buyBtn')}</button><button class="btn" data-act="fuelSell">${t('fuel.sellBtn')}</button></div>
        <div class="muted small" style="margin-top:8px">${t('fuel.emergency')}</div></div></div>`;
  },
  after() {
    if (!FUEL) return;
    const h = FUEL.history.slice(-90), f = FUEL.forecast, last = h[h.length - 1];
    Charts.line($('#chFuel'), { h: 280, fmtY: (v) => '$' + nf(v), fmtX: (x) => gday(x), vline: last.t, series: [
      { name: t('fuel.hist'), color: '#38bdf8', data: h.map((p) => [p.t, p.p]) },
      { name: t('fuel.fc'), color: '#fbbf24', dash: true, data: [[last.t, FUEL.current]].concat(f.map((p) => [p.t, p.p])), band: f.map((p) => [p.t, p.lo, p.hi]) }] });
  },
};
Object.assign(A, {
  fuelDepot(el) { ui.fuelDepot = el.value; render(true); },
  fuelTons(el) { ui.fuelTons = Math.max(0, Number(el.value) || 0); const c = $('#fuelCost'); if (c && FUEL) c.textContent = money(ui.fuelTons * FUEL.current, true); },
  fuelQ(el) { const d = S.depots[ui.fuelDepot]; ui.fuelTons = el.dataset.n === 'max' ? Math.floor((d.cap - d.tons) * 10) / 10 : (Number(ui.fuelTons) || 0) + Number(el.dataset.n); render(true); },
  fuelBuy() { act('buyFuel', { iata: ui.fuelDepot, tons: ui.fuelTons }, t('ok.fuelBought')); },
  fuelSell() { act('sellFuel', { iata: ui.fuelDepot, tons: ui.fuelTons }, t('ok.fuelSold')); },
  tankUp(el) { act('upgradeTank', { iata: el.dataset.i }); },
  fuelAuto(el) {
    const i = el.dataset.i, d = S.depots[i]; const a = Object.assign({}, d.auto);
    if (el.dataset.f) a[el.dataset.f] = Number(el.value); else a.on = el.checked;
    act('fuelAuto', { iata: i, on: a.on, min: a.min, fill: a.fill });
  },
});

// ---------- BASI / HANGAR / DEPOSITI
PAGES.bases = {
  render() {
    const cards = S.bases.map((b) => {
      const a = apt(b.iata), dp = S.depots[b.iata], hc = a.size * 100000 * (b.hangar + 1);
      const here = S.fleet.filter((x) => x.loc === b.iata).length;
      return `<div class="card"><div class="row sp"><div><h3 style="margin:0">${b.iata === S.company.hub ? '⭐ ' : ''}${a.city} <span class="muted">(${b.iata})</span></h3><div class="muted small">${a.country} · ${t('bases.size')} ${a.size}/10 · ✈ ${here}</div></div><span class="pill ok">−10% ${t('bases.fees')}</span></div>
      <div class="stat-row" style="margin-top:8px"><span class="muted">🏗 ${t('bases.hangar')}</span><b>${t('bases.lvl')} ${b.hangar}/3</b></div>${bar((b.hangar / 3) * 100)}
      <div class="small muted" style="margin:6px 0">${t('bases.hangarFx', { t: b.hangar * 20, c: b.hangar * 10 })}</div>
      <button class="btn sm" data-act="hangarUp" data-i="${b.iata}" ${b.hangar >= 3 ? 'disabled' : ''}>⬆ ${t('bases.upHangar')} (${b.hangar >= 3 ? 'MAX' : money(hc)})</button>
      <div class="stat-row" style="margin-top:12px"><span class="muted">⛽ ${t('bases.depot')}</span><b>${dp ? nf(dp.tons, 1) + '/' + dp.cap + ' t' : t('bases.none')}</b></div>
      ${dp ? bar((dp.tons / dp.cap) * 100, dp.tons / dp.cap > .25 ? 'ok' : 'bad') + `<button class="btn sm" style="margin-top:8px" data-act="go" data-v="fuel">${t('nav.fuel')} →</button>` : `<button class="btn sm" data-act="depotBuild" data-i="${b.iata}">⛽ ${t('bases.buildDepot')} (${money(80000)})</button>`}</div>`;
    }).join('');
    const baseSet = new Set(S.bases.map((b) => b.iata));
    return head(t('bases.title'), t('bases.sub')) + `<div class="grid cols">${cards}</div>
      <div class="card" style="margin-top:14px"><h3>🏢 ${t('bases.new')}</h3><div class="grid g2"><label class="f">${t('bases.pick')}<select id="newBase">${aptOpt('', (a) => !baseSet.has(a.iata))}</select></label><div style="align-self:end"><button class="btn pri" data-act="baseBuild">${t('bases.build')}</button></div></div><div class="muted small" style="margin-top:8px">${t('bases.help')}</div></div>`;
  },
};
Object.assign(A, {
  hangarUp(el) { act('upgradeHangar', { iata: el.dataset.i }, t('ok.done')); },
  depotBuild(el) { act('buildDepot', { iata: el.dataset.i }, t('ok.done')); },
  baseBuild() { const i = $('#newBase').value; confirmBox(t('bases.confirm', { a: apt(i).city, c: money(apt(i).size * 60000) }), () => act('buildBase', { iata: i }, t('ok.done'))); },
});

// ---------- PERSONALE
const COURSE_IC = { service: '😊', safety: '🛡', eco: '🌱', ground: '🧰' };
const courseCost = (k, l) => Math.round(S.courseDefs[k].base * Math.pow(l + 1, 1.6));
PAGES.staff = {
  render() {
    const tabs = `<div class="seg">${['pilots', 'crew', 'courses'].map((x) => `<button data-act="staffTab" data-v="${x}" class="${ui.staffTab === x ? 'on' : ''}">${t('staff.' + x)}</button>`).join('')}</div>`;
    let body = '';
    if (ui.staffTab === 'pilots') {
      const rows = S.pilots.map((p) => {
        const up = p.cls < 5 ? `<button class="btn sm" data-act="pTrain" data-id="${p.id}" ${p.status === 'free' ? '' : 'disabled'}>🎓 → ${licLetter(p.cls + 1)} (${money(S.pilotUpg.cost[p.cls])} · ${S.pilotUpg.days[p.cls]}${t('u.d')})</button>` : '<span class="pill">MAX</span>';
        const tr = p.status === 'training' ? `<div style="min-width:130px">${progBar(p.trainStart, p.trainEnd)}<span class="small muted" data-cd="${p.trainEnd}"></span></div><button class="btn sm warn" data-act="pSkip" data-id="${p.id}">⚡ ${money(Math.round(p.trainCost * ((p.trainEnd - clock()) / (p.trainEnd - p.trainStart)) + 100))}</button>` : '';
        const ac = p.ac ? S.fleet.find((a) => a.id === p.ac) : null;
        return `<tr><td><b>${esc(p.name)}</b></td><td><span class="grade g${licLetter(p.cls)}">${licLetter(p.cls)}</span></td><td>${Math.round(p.skill)}</td><td>${money(p.salary)}/${t('u.dayShort')}</td><td><span class="pill ${p.status === 'free' ? 'ok' : p.status === 'training' ? 'warn' : 'acc'}">${t('pst.' + p.status)}${ac ? ' · ' + esc(ac.name) : ''}</span></td><td>${tr || up}</td><td class="right"><button class="btn sm bad" data-act="pFire" data-id="${p.id}" ${p.status === 'free' ? '' : 'disabled'}>✕</button></td></tr>`;
      }).join('');
      const cand = S.candidates.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="grade g${licLetter(p.cls)}">${licLetter(p.cls)}</span></td><td>${Math.round(p.skill)}</td><td>${money(p.salary)}/${t('u.dayShort')}</td><td>${money(p.fee)}</td><td class="right"><button class="btn sm pri" data-act="pHire" data-id="${p.id}">${t('staff.hire')}</button></td></tr>`).join('');
      body = `<div class="card"><h3>${t('staff.myPilots')} (${S.pilots.length})</h3><div class="muted small" style="margin-bottom:8px">${t('staff.licHelp')}</div><div class="scroll-x"><table><tr><th>${t('staff.name')}</th><th>${t('staff.lic')}</th><th>${t('staff.skill')}</th><th>${t('staff.salary')}</th><th>${t('staff.status')}</th><th>${t('staff.training')}</th><th></th></tr>${rows}</table></div></div>
      <div class="card" style="margin-top:14px"><div class="row sp"><h3>${t('staff.cand')}</h3><button class="btn sm" data-act="pRefresh">🔄 ${t('staff.refresh')} (${money(3000)})</button></div><div class="scroll-x"><table><tr><th>${t('staff.name')}</th><th>${t('staff.lic')}</th><th>${t('staff.skill')}</th><th>${t('staff.salary')}</th><th>${t('staff.signing')}</th><th></th></tr>${cand}</table></div></div>`;
    } else if (ui.staffTab === 'crew') {
      const card = (k, ic, have, need, hard) => `<div class="card"><h3>${ic} ${t('crew.' + k)}</h3>${kpi(t('crew.have'), have, t('crew.need', { n: need }))}${bar(need ? Math.min(100, (have / need) * 100) : 100, have >= need ? 'ok' : hard ? 'bad' : 'warn')}
        <div class="small muted" style="margin:8px 0">${t('crew.' + k + 'Help')} · ${money(S.wages[k])}/${t('u.dayShort')} · ${t('staff.signing')} ${money(S.wages[k] * 3)}</div>
        <div class="row">${[1, 5, 10].map((n) => `<button class="btn sm" data-act="crewHire" data-k="${k}" data-n="${n}">+${n}</button>`).join('')}<button class="btn sm bad" data-act="crewFire" data-k="${k}" data-n="1">−1</button><button class="btn sm bad" data-act="crewFire" data-k="${k}" data-n="5">−5</button></div></div>`;
      body = `<div class="grid g3">${card('cabin', '🧑‍✈️', S.staff.cabin, S.needs.cabin, true)}${card('mech', '🔧', S.staff.mech, S.needs.mech, false)}${card('ground', '🧳', S.staff.ground, S.needs.ground, false)}</div>
      <div class="card" style="margin-top:14px"><h3>${t('crew.payroll')}</h3>${row(t('crew.perDay'), money(S.payrollDay))}${row(t('crew.ins'), money(S.insuranceDay))}${row(t('crew.effG'), pct(S.eff.ground))}${row(t('crew.effM'), pct(S.eff.mech))}</div>`;
    } else {
      body = `<div class="grid g2">${Object.keys(S.courseDefs).map((k) => {
        const l = lvlOf(k), max = S.courseDefs[k].max, run = S.courses.find((c) => c.type === k);
        const days = 2 + l * 2;
        return `<div class="card"><div class="row sp"><h3 style="margin:0">${COURSE_IC[k]} ${t('course.' + k)}</h3><span class="pill acc">${t('bases.lvl')} ${l}/${max}</span></div><p class="muted small">${t('course.' + k + 'D')}</p>${bar((l / max) * 100)}
          ${run ? `<div style="margin-top:10px">${progBar(run.start, run.end)}<div class="row sp small muted" style="margin-top:4px"><span>→ ${t('bases.lvl')} ${run.level} · <span data-cd="${run.end}"></span></span><button class="btn sm warn" data-act="cSkip" data-id="${run.id}">⚡ ${money(Math.round(run.cost * 1.2 * ((run.end - clock()) / (run.end - run.start)) + 200))}</button></div></div>`
          : `<div class="row sp" style="margin-top:10px"><span class="small muted">${money(courseCost(k, l))} · ${days}${t('u.d')} (≈${realDur(days * DAY)})</span><button class="btn pri sm" data-act="cStart" data-k="${k}" ${l >= max ? 'disabled' : ''}>${l >= max ? 'MAX' : t('staff.start')}</button></div>`}</div>`; }).join('')}</div>`;
    }
    return head(t('staff.title'), t('staff.sub'), tabs) + body;
  },
};
Object.assign(A, {
  staffTab(el) { ui.staffTab = el.dataset.v; render(true); },
  pHire(el) { act('hirePilot', { id: Number(el.dataset.id) }, t('ok.hired')); },
  pFire(el) { confirmBox(t('staff.fireConfirm'), () => act('firePilot', { id: Number(el.dataset.id) })); },
  pTrain(el) { act('trainPilot', { id: Number(el.dataset.id) }, t('ok.training')); },
  pSkip(el) { act('skipPilot', { id: Number(el.dataset.id) }); },
  pRefresh() { act('refreshCandidates'); },
  crewHire(el) { act('hireStaff', { type: el.dataset.k, n: Number(el.dataset.n) }, t('ok.hired')); },
  crewFire(el) { act('fireStaff', { type: el.dataset.k, n: Number(el.dataset.n) }); },
  cStart(el) { act('startCourse', { type: el.dataset.k }, t('ok.training')); },
  cSkip(el) { act('skipCourse', { id: Number(el.dataset.id) }); },
});

// ---------- MAPPA 3D
const WXI = { clear: '☀️', partly: '🌤', cloudy: '☁️', fog: '🌫', drizzle: '🌦', rain: '🌧', showers: '🌦', snow: '❄️', storm: '⛈', wind: '💨' };
PAGES.map = {
  render() {
    $('#page').innerHTML = head(t('map.title'), t('map.sub'), `<span class="pill ok" id="mapCnt">✈ 0</span>`) + `<div class="globe-wrap" id="gw"><div class="overlay"><div class="card"><div class="row"><span class="pill" style="color:#fde047">✈ ${t('map.legPax')}</span><span class="pill" style="color:#fb923c">✈ ${t('map.legCargo')}</span><span class="pill" style="color:#34d399">✈ ${t('map.legMission')}</span></div><div class="small muted" style="margin-top:6px">⭕ ${t('map.legStorm')} · 🟡 ${t('map.legBase')}</div></div><div id="selCard"></div></div></div>`;
    if (!WX) loadWeather();
    GlobeMap.mount($('#gw'), {
      state: () => S, airports: () => CAT.byIata, clock, weather: () => WX, hub: () => apt(S.company.hub),
      onSelect(id) { ui.selAc = id; PAGES.map.update(); }, onTick(n) { const c = $('#mapCnt'); if (c) c.textContent = '✈ ' + n; },
    }).catch(() => { $('#gw').innerHTML = `<div class="center muted" style="padding:60px">⚠️ ${t('map.fail')}</div>`; });
    this.update();
  },
  update() {
    const c = $('#selCard'); if (!c) return;
    const ac = S.fleet.find((a) => a.id === ui.selAc);
    if (!ac) { c.innerHTML = ''; return; }
    const m = mdl(ac.model), f = ac.flight;
    c.innerHTML = `<div class="card"><div class="row sp"><b>${esc(ac.name)}</b>${gradeBadge(m)}</div><div class="muted small">${m.maker} ${m.name}</div>${f ? `<div style="margin:6px 0">${f.from} → ${f.to}</div>${progBar(f.dep, f.arr)}<div class="small muted" style="margin-top:4px">${f.cargo ? nf(f.cargo, 1) + ' t' : f.pax + ' pax'} · ${t('fleet.eta')} <span data-cd="${f.arr}"></span></div>` : `<div class="small muted">${statusPill(ac)} 📍 ${ac.loc}</div>`}</div>`;
    secondTick();
  },
};

// ---------- METEO
PAGES.weather = {
  render() {
    if (!WX) { loadWeather(); return head(t('wx.title'), t('wx.sub')) + `<div class="card center muted" style="padding:40px">${t('loading')}</div>`; }
    const mine = new Set([S.company.hub]); S.routes.forEach((r) => { mine.add(r.a); mine.add(r.b); }); S.bases.forEach((b) => mine.add(b.iata));
    const src = Object.values(WX)[0] && Object.values(WX)[0].source;
    return head(t('wx.title'), t('wx.sub'), `<span class="pill ${src === 'live' ? 'ok' : 'warn'}">${src === 'live' ? '● ' + t('wx.live') : '◌ ' + t('wx.sim')}</span>`) + `
      <div class="card"><div class="grid g2"><label class="f">${t('wx.search')}<input type="text" id="wxQ" data-inp="wxQ" value="${esc(ui.wxQ)}" placeholder="London, JFK…"></label><div class="muted small" style="align-self:end">${t('wx.effects')}</div></div>
      <div class="scroll-x" style="margin-top:10px"><table><tr><th>${t('fuel.airport')}</th><th>${t('wx.cond')}</th><th>${t('wx.temp')}</th><th>${t('wx.wind')}</th><th>${t('wx.impact')}</th></tr><tbody id="wxBody">${wxRows(mine)}</tbody></table></div></div>`;
  },
};
function wxRows(mine) {
  mine = mine || new Set([S.company.hub]);
  const q = ui.wxQ.trim().toLowerCase();
  let list = CAT.airports.filter((a) => WX[a.iata] && (!q || (a.iata + ' ' + a.city + ' ' + a.country).toLowerCase().includes(q)));
  list.sort((a, b) => (mine.has(b.iata) ? 1 : 0) - (mine.has(a.iata) ? 1 : 0) || a.city.localeCompare(b.city));
  return list.slice(0, q ? 60 : 40).map((a) => { const w = WX[a.iata]; return `<tr><td><b>${a.iata}</b> ${mine.has(a.iata) ? '⭐' : ''}<div class="small muted">${a.city}, ${a.country}</div></td><td>${WXI[w.kind] || ''} ${t('w.' + w.kind)}</td><td>${nf(w.temp, 1)}°C</td><td>${nf(w.wind)} km/h</td><td><span class="pill ${['ok', 'ok', 'warn', 'bad'][w.sev]}">${t('wx.sev' + w.sev)}</span></td></tr>`; }).join('');
}
A.wxQ = (el) => { ui.wxQ = el.value; const b = $('#wxBody'); if (b) b.innerHTML = wxRows(); };

// ---------- CLASSIFICHE / RIVALI
PAGES.rank = {
  render() {
    const tabs = `<div class="seg"><button data-act="rankTab" data-v="fed" class="${ui.rankTab === 'fed' ? 'on' : ''}">🌐 ${t('rk.fed')}</button><button data-act="rankTab" data-v="ai" class="${ui.rankTab === 'ai' ? 'on' : ''}">🤖 ${t('rk.rivals')}</button></div>`;
    let body;
    if (ui.rankTab === 'fed') {
      const seg = (key, vals, lab) => `<div class="seg">${vals.map((v) => `<button data-act="rkSet" data-k="${key}" data-v="${v}" class="${ui[key] === v ? 'on' : ''}">${t(lab + v)}</button>`).join('')}</div>`;
      const rows = BOARD ? BOARD.entries.map((e, i) => `<tr class="${e.player === BOARD.me && e.instanceId === ME.instance.id ? 'me' : ''}"><td>${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td><span class="dot" style="display:inline-block;width:9px;height:9px;background:${e.color}"></span> <b>${esc(e.company)}</b><div class="small muted">👤 ${esc(e.player)} · ${esc(e.hub)}</div></td><td>🌐 ${esc(e.instance)}</td><td class="right ${e.score >= 0 ? 'pos' : 'neg'}"><b>${money(e.score)}</b></td><td class="right">${money(e.value)}</td><td class="right">${e.fleet}</td></tr>`).join('') : '';
      body = `<div class="row" style="margin-bottom:12px">${seg('period', ['day', 'week', 'month'], 'per.')}${seg('board', ['standard', 'sandbox'], 'bd.')}${seg('scope', ['global', 'local'], 'sc.')}</div>
        <div class="muted small" style="margin-bottom:10px">${t('rk.help')}${ui.board === 'sandbox' ? ' ' + t('rk.sandboxHelp') : ''}</div>
        <div class="card"><div class="scroll-x"><table><tr><th>#</th><th>${t('rk.company')}</th><th>${t('rk.instance')}</th><th class="right">${t('rk.score')}</th><th class="right">${t('dash.value')}</th><th class="right">${t('dash.fleet')}</th></tr>${rows || `<tr><td colspan="6" class="center muted" style="padding:24px">${BOARD ? t('rk.none') : t('loading')}</td></tr>`}</table></div></div>`;
      if (!BOARD || BOARD.stale) loadBoard();
    } else {
      const all = [{ name: S.company.name, hub: S.company.hub, fleet: S.fleet.length, routes: S.routes.length, rating: Math.round(S.rep), value: S.value, color: S.company.color, me: true }].concat(S.rivalsView).sort((a, b) => b.value - a.value);
      body = `<div class="card"><div class="scroll-x"><table><tr><th>#</th><th>${t('rk.company')}</th><th>${t('ob.hub')}</th><th class="right">${t('dash.fleet')}</th><th class="right">${t('routes.title')}</th><th class="right">${t('dash.rep')}</th><th class="right">${t('dash.value')}</th></tr>${all.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td><span class="dot" style="display:inline-block;width:9px;height:9px;background:${r.color}"></span> <b>${esc(r.name)}</b> ${r.me ? '⭐' : ''}</td><td>${r.hub}</td><td class="right">${r.fleet}</td><td class="right">${r.routes}</td><td class="right">${r.rating}</td><td class="right">${money(r.value)}</td></tr>`).join('')}</table></div></div><div class="muted small" style="margin-top:10px">${t('rk.aiHelp')}</div>`;
    }
    return head(t('rk.title'), t('rk.sub'), tabs) + body + `<style>tr.me td{background:rgba(56,189,248,.12)}</style>`;
  },
};
async function loadBoard() {
  if (BOARD) BOARD.stale = false;
  try { BOARD = await API.call(`/api/fed/boards?period=${ui.period}&board=${ui.board}&scope=${ui.scope}`); if (page === 'rank') render(true); } catch (e) { /* ignore */ }
}
Object.assign(A, { rankTab(el) { ui.rankTab = el.dataset.v; render(true); }, rkSet(el) { ui[el.dataset.k] = el.dataset.v; BOARD = null; render(true); } });

// ---------- FINANZE
const LEDCAT = { fuel: '⛽', purchase: '✈️', route: '🧭', staff: '👥', base: '🏢', other: '💠', maintenance: '🔧' };
PAGES.finance = {
  render() {
    const d = S.daily.slice(-30), tot = (k) => d.reduce((s, p) => s + (p[k] || 0), 0);
    const T = S.today, tc = T.fuel + T.fees + T.maintenance + T.service + T.payroll + T.insurance + T.other;
    const tabs = `<div class="seg"><button data-act="finTab" data-v="pl" class="${ui.finTab === 'pl' ? 'on' : ''}">${t('fin.pl')}</button><button data-act="finTab" data-v="ledger" class="${ui.finTab === 'ledger' ? 'on' : ''}">${t('fin.ledger')}</button></div>`;
    let body;
    if (ui.finTab === 'pl') {
      const cats = [['fuel', t('fin.fuel')], ['fees', t('fin.fees')], ['maint', t('fin.maint')], ['service', t('fin.service')], ['payroll', t('fin.payroll')], ['ins', t('fin.ins')]];
      body = `<div class="grid g4" style="margin-bottom:14px"><div class="card">${kpi(t('fin.todayRev'), money(T.revenue), '')}</div><div class="card">${kpi(t('fin.todayCost'), money(tc), '')}</div><div class="card">${kpi(t('fin.todayPl'), money(T.revenue - tc), t('fin.inProgress'), T.revenue - tc >= 0 ? 'pos' : 'neg')}</div><div class="card">${kpi(t('fin.fixed'), money(S.payrollDay + S.insuranceDay), t('fin.fixedSub'))}</div></div>
      <div class="grid g2"><div class="card"><h3>${t('fin.revCost')}</h3><div id="chRC"></div><div class="legend"><span><i style="background:#34d399"></i>${t('fin.rev')}</span><span><i style="background:#f87171"></i>${t('fin.cost')}</span></div></div>
      <div class="card"><h3>${t('fin.breakdown')}</h3><div id="chStack"></div><div class="legend">${cats.map((c, i) => `<span><i style="background:${STACKC[i]}"></i>${c[1]}</span>`).join('')}</div></div></div>
      <div class="card" style="margin-top:14px"><h3>${t('fin.sum30')}</h3><div class="grid g4">${cats.map((c) => `<div>${kpi(c[1], money(tot(c[0])), pct(tot('cost') ? tot(c[0]) / tot('cost') : 0))}</div>`).join('')}</div></div>`;
    } else {
      body = `<div class="card"><div class="scroll-x"><table><tr><th>${t('fin.date')}</th><th>${t('fin.desc')}</th><th class="right">${t('fin.amount')}</th></tr>${S.ledger.map((l) => `<tr><td class="muted small">${gdate(l.t)}</td><td>${LEDCAT[l.cat] || ''} ${ledText(l)}</td><td class="right ${l.amt >= 0 ? 'pos' : 'neg'}"><b>${money(l.amt, true)}</b></td></tr>`).join('') || `<tr><td colspan="3" class="muted center">—</td></tr>`}</table></div></div>`;
    }
    return head(t('fin.title'), t('fin.sub'), tabs) + body;
  },
  after() {
    if (ui.finTab !== 'pl') return;
    const d = S.daily.slice(-30);
    if (d.length < 2) { ['chRC', 'chStack'].forEach((i) => { $('#' + i).innerHTML = `<div class="muted center" style="padding:30px">${t('dash.noData')}</div>`; }); return; }
    Charts.line($('#chRC'), { h: 200, fmtY: (v) => money(v), fmtX: gday, series: [{ name: t('fin.rev'), color: '#34d399', data: d.map((p) => [p.t, p.rev]) }, { name: t('fin.cost'), color: '#f87171', data: d.map((p) => [p.t, p.cost]) }] });
    Charts.stacked($('#chStack'), { h: 200, fmtY: (v) => money(v), data: d, keys: [['fuel'], ['fees'], ['maint'], ['service'], ['payroll'], ['ins']].map((k, i) => ({ key: k[0], color: STACKC[i], name: ['fuel', 'fees', 'maint', 'service', 'payroll', 'ins'][i] })) });
  },
};
const STACKC = ['#fbbf24', '#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#94a3b8'];
function ledText(l) { const p = Object.assign({}, l.p); if (l.k === 'ledCourse' || l.k === 'ledSkipCourse') p.c = t('course.' + p.c); if (l.k === 'ledHireStaff' || l.k === 'ledFireStaff') p.t = t('crew.' + p.t); if (p.p && l.k === 'ledFuelBuy') p.p = money(p.p); return t('led.' + l.k, p); }
A.finTab = (el) => { ui.finTab = el.dataset.v; render(true); };

// ---------- RETE DECENTRALIZZATA
PAGES.network = {
  render() {
    if (!PEERS) { loadPeers(); return head(t('net.title'), t('net.sub')) + `<div class="card center muted" style="padding:40px">${t('loading')}</div>`; }
    const me = PEERS.self, adm = !!API.admin;
    const snippet = JSON.stringify({ name: me.name, url: me.url || 'https://your-instance.example.com', note: '' }, null, 2);
    const rows = PEERS.peers.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.url)}</div></td><td><span class="pill ${p.status === 'ok' ? 'ok' : p.status === 'self' ? 'acc' : p.status === 'banned' ? 'bad' : 'warn'}">${t('net.st.' + p.status)}</span></td><td>${p.players == null ? '—' : p.players}</td><td class="small muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${p.id ? esc(p.id) : ''}</td><td class="right">${adm && p.status !== 'self' ? (p.status === 'banned' ? `<button class="btn sm" data-act="netBan" data-id="${esc(p.id || '')}" data-url="${esc(p.url)}" data-on="0">${t('net.unban')}</button>` : `<button class="btn sm bad" data-act="netBan" data-id="${esc(p.id || '')}" data-url="${esc(p.url)}" data-on="1">${t('net.ban')}</button>`) : ''}</td></tr>`).join('');
    return head(t('net.title'), t('net.sub')) + `<div class="split"><div class="stack">
      <div class="card"><h3>🌐 ${t('net.this')}</h3>${row(t('net.name'), esc(me.name))}${row('URL', me.url ? esc(me.url) : '<span class="muted">' + t('net.noUrl') + '</span>')}${row(t('net.version'), me.v)}
        <div style="margin-top:8px"><div class="muted small">${t('net.id')}</div><code style="word-break:break-all;font-size:12px">${esc(me.id)}</code></div></div>
      <div class="card"><div class="row sp"><h3>🤝 ${t('net.peers')} (${PEERS.peers.length})</h3><button class="btn sm" data-act="peersRefresh">🔄</button></div><div class="scroll-x"><table><tr><th>${t('net.name')}</th><th>${t('staff.status')}</th><th>${t('auth.players')}</th><th>ID</th><th></th></tr>${rows || `<tr><td colspan="5" class="muted center" style="padding:20px">${t('net.noPeers')}</td></tr>`}</table></div></div>
      <div class="card"><h3>🧳 ${t('net.account')}</h3><p class="muted small">${t('net.exportHelp')}</p><button class="btn warn" data-act="exportAcc">⬇ ${t('net.export')}</button></div></div>
      <div class="stack" style="align-self:start">
      <div class="card"><h3>➕ ${t('net.join')}</h3><ol class="small" style="padding-left:18px;margin:0 0 10px">${[1, 2, 3, 4].map((i) => `<li style="margin-bottom:4px">${t('net.join' + i)}</li>`).join('')}</ol><pre style="background:rgba(0,0,0,.35);padding:10px;border-radius:10px;overflow:auto;font-size:12px">${esc(snippet)}</pre></div>
      <div class="card"><h3>🛡 ${t('net.admin')}</h3><p class="muted small">${t('net.adminHelp')}</p>
        <label class="f">${t('net.token')}<input type="password" id="admTok" value="${esc(API.admin || '')}" data-chg="admTok"></label>
        ${adm ? `<label class="f" style="margin-top:8px">${t('net.addPeer')}<div class="row"><input type="text" id="addPeerUrl" placeholder="https://…" style="flex:1"><button class="btn sm pri" data-act="addPeer">+</button></div></label>
        <label class="f" style="margin-top:8px">${t('net.rename')}<div class="row"><input type="text" id="instName" value="${esc(me.name)}" style="flex:1"><button class="btn sm" data-act="renameInst">OK</button></div></label>
        <div style="margin-top:8px" class="small muted">${t('net.bans')}: ${PEERS.bans.length ? PEERS.bans.map((b) => esc(b.url || b.id)).join(', ') : '—'}</div>` : ''}</div></div></div>`;
  },
};
async function loadPeers(force) { try { PEERS = await API.call('/api/fed/peers' + (force ? '?force=1' : '')); if (page === 'network') render(true); } catch (e) { toast(errMsg(e), 'err'); } }
const adminCall = async (what, body) => { try { const r = await API.call('/api/admin/' + what, body); PEERS = Object.assign(PEERS || {}, { peers: r.peers, bans: r.bans }); await loadPeers(true); toast(t('ok.done'), 'ok'); } catch (e) { toast(errMsg(e), 'err'); } };
Object.assign(A, {
  peersRefresh() { loadPeers(true); },
  admTok(el) { API.admin = el.value.trim(); try { sessionStorage.setItem('am_admin', API.admin); } catch (e) { /* ok */ } render(true); },
  netBan(el) { adminCall('ban', { id: el.dataset.id || null, url: el.dataset.url, on: el.dataset.on === '1' }); },
  addPeer() { adminCall('peer', { url: $('#addPeerUrl').value }); },
  renameInst() { adminCall('name', { name: $('#instName').value }); },
  exportAcc() {
    confirmBox(t('net.exportConfirm'), async () => {
      try {
        const b = await API.call('/api/account/export');
        const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `airlinemanager-${ME.username}-${Date.now()}.json`; a.click();
        const r = await API.call('/api/state'); S = r.state; recvAt = Date.now(); render(true); toast(t('net.exported'), 'ok');
      } catch (e) { toast(errMsg(e), 'err'); }
    });
  },
  async unfreeze() { confirmBox(t('net.unfreezeConfirm'), () => post('/api/account/unfreeze', {}, t('ok.done'))); },
});

// ---------- IMPOSTAZIONI
PAGES.settings = {
  render() {
    const s = S.settings;
    const tog = (k, v, lab, help) => `<label class="row sp card flat" style="cursor:pointer"><div><b>${lab}</b><div class="muted small">${help}</div></div><input type="checkbox" data-chg="setTog" data-k="${k}" ${v ? 'checked' : ''} style="width:20px;height:20px"></label>`;
    return head(t('settings.title'), t('settings.sub')) + `<div class="grid g2">
      <div class="card stack"><h3>🎛 ${t('settings.general')}</h3>
        <div><div class="muted small" style="margin-bottom:6px">${t('settings.lang')}</div>${langSwitch(LANG)}</div>
        <div><div class="muted small" style="margin-bottom:6px">${t('settings.theme')}</div><div class="seg">${['dark', 'light'].map((x) => `<button data-act="theme" data-v="${x}" class="${s.theme === x ? 'on' : ''}">${t('theme.' + x)}</button>`).join('')}</div></div>
        <div><div class="muted small" style="margin-bottom:6px">${t('settings.speed')}</div><div class="seg">${[0, 60, 120, 360, 720, 1800].map((v) => `<button data-act="speed" data-v="${v}" class="${s.speed === v ? 'on' : ''}">${v === 0 ? 'II ' + t('settings.pause') : '×' + v}</button>`).join('')}</div><div class="muted small" style="margin-top:6px">${t('settings.speedHelp', { m: nf(s.speed / 60, 1) })}</div></div>
        ${tog('autoMaint', s.autoMaint, t('settings.autoMaint'), t('settings.autoMaintH'))}${tog('offline', s.offline, t('settings.offline'), t('settings.offlineH'))}</div>
      <div class="card stack"><h3>🧪 ${t('settings.sandbox')}</h3><div class="muted small">${t('settings.sandboxH')}</div>
        <div class="row"><input type="number" id="addAmt" value="1000000" step="100000" style="flex:1"><button class="btn warn" data-act="addMoney">💰 ${t('settings.addMoney')}</button></div>
        ${tog('unlimited', s.unlimited, t('settings.unlimited'), t('settings.unlimitedH'))}
        ${S.flags.cheat ? `<div class="pill warn">🧪 ${t('settings.cheatOn')}</div>` : ''}
        ${S.flags.imported ? `<div class="pill acc">📥 ${t('settings.imported')}</div>` : ''}</div>
      <div class="card stack"><h3>👤 ${t('settings.account')}</h3>${row(t('auth.user'), esc(ME.username))}${row(t('net.name'), esc(ME.instance.name))}<div class="row"><button class="btn" data-act="logout">⎋ ${t('settings.logout')}</button></div></div>
      <div class="card stack"><h3>⚠️ ${t('settings.danger')}</h3><div class="muted small">${t('settings.resetH')}</div><button class="btn bad" data-act="reset">🗑 ${t('settings.reset')}</button></div>
      <div class="card stack" style="grid-column:1/-1"><h3>ℹ️ ${t('settings.about')}</h3><div class="muted small">${t('settings.aboutText')}</div></div></div>`;
  },
};
Object.assign(A, {
  theme(el) { act('settings', { theme: el.dataset.v }).then(applyTheme); },
  setTog(el) { const k = el.dataset.k; if (k === 'unlimited') { act('unlimited', { on: el.checked }, t('ok.done')); } else act('settings', { [k]: el.checked }); },
  addMoney() { confirmBox(t('settings.sandboxConfirm'), () => act('addMoney', { amount: Number($('#addAmt').value) }, t('ok.done'))); },
  reset() { confirmBox(t('settings.resetConfirm'), async () => { const r = await post('/api/reset', {}); if (r) { showOnboard(); } }); },
});

// banner "account congelato"
const frozenBanner = () => (S.flags && S.flags.frozen ? `<div class="card" style="border-color:var(--warn);margin-bottom:14px"><div class="row sp"><div>🧊 <b>${t('net.frozen')}</b><div class="muted small">${t('net.frozenH')}</div></div><button class="btn warn" data-act="unfreeze">${t('net.unfreeze')}</button></div></div>` : '');

try { API.admin = sessionStorage.getItem('am_admin') || ''; } catch (e) { API.admin = ''; }
boot();
