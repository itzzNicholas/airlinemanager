'use strict';
const API = {
  token: (() => { try { return localStorage.getItem('am_token'); } catch (e) { return null; } })(),
  setToken(t) { this.token = t; try { t ? localStorage.setItem('am_token', t) : localStorage.removeItem('am_token'); } catch (e) { /* ignore */ } },
  async call(path, body, method) {
    const opt = { method: method || (body !== undefined ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' } };
    if (this.token) opt.headers.Authorization = 'Bearer ' + this.token;
    if (this.admin) opt.headers['x-admin-token'] = this.admin;
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res;
    try { res = await fetch(path, opt); } catch (e) { const er = new Error('network'); er.code = 'network'; throw er; }
    let j = {};
    try { j = await res.json(); } catch (e) { /* vuoto */ }
    if (!res.ok) { const er = new Error(j.error || 'http' + res.status); er.code = j.error || 'server'; er.extra = j.extra; er.status = res.status; throw er; }
    return j;
  },
};
