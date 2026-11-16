'use strict';
// Valida servers.json (usato dalla CI sulle pull request): formato, URL https, duplicati e, se raggiungibile, /api/fed/info.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'servers.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
let bad = 0;
const err = (m) => { console.error('✗ ' + m); bad++; };
if (!Array.isArray(data.servers)) { err('"servers" deve essere un array'); process.exit(1); }
const seen = new Set();
(async () => {
  for (const s of data.servers) {
    if (!s.name || typeof s.name !== 'string' || s.name.length > 40) { err('nome mancante o troppo lungo: ' + JSON.stringify(s)); continue; }
    let u;
    try { u = new URL(s.url); } catch (e) { err(s.name + ': URL non valido'); continue; }
    if (u.protocol !== 'https:') err(s.name + ': l\'URL deve essere https');
    if (/^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) err(s.name + ': URL privato non ammesso');
    if (seen.has(u.origin)) err(s.name + ': URL duplicato');
    seen.add(u.origin);
    try {
      const r = await fetch(u.origin + '/api/fed/info', { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.app !== 'airlinemanager' || !j.id || !j.pubkey) err(s.name + ': /api/fed/info non valido');
      else console.log('✓ ' + s.name + ' (' + j.id.slice(0, 8) + '…) raggiungibile');
    } catch (e) { console.warn('! ' + s.name + ': non raggiungibile ora (' + e.message + ')'); }
  }
  if (bad) process.exit(1);
  console.log('servers.json OK (' + data.servers.length + ' istanze)');
})();
