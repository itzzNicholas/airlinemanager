'use strict';
// Meteo reale via Open-Meteo (gratuito, senza chiave) con fallback simulato.
const D = require('./data');
const { hash01, clamp } = require('./util');

const cache = {};        // iata -> {temp, wind, code, cloud, precip, isDay, sev, kind, source, t}
let lastFetch = 0, fetching = false;

function kindOf(code, wind) {
  if (code >= 95) return 'storm';
  if (code >= 85) return 'snow';
  if (code >= 80) return 'showers';
  if (code >= 71) return 'snow';
  if (code >= 61) return 'rain';
  if (code >= 51) return 'drizzle';
  if (code >= 45) return 'fog';
  if (wind > 55) return 'wind';
  if (code >= 3) return 'cloudy';
  if (code >= 1) return 'partly';
  return 'clear';
}
function severity(code, wind) {
  let s = 0;
  if (code >= 95) s = 3;
  else if (code === 75 || code === 77 || code === 86 || code === 82 || code === 67 || code === 65) s = 2;
  else if (code >= 45 && code <= 48) s = 2;
  else if (code >= 51) s = 1;
  if (wind > 90) s += 2; else if (wind > 60) s += 1;
  return clamp(s, 0, 3);
}

function fallback(a) {
  const now = new Date();
  const slot = Math.floor(Date.now() / (3 * 3600e3));
  const month = now.getUTCMonth();
  const south = a.lat < 0;
  const season = Math.cos(((month - (south ? 0 : 6)) / 12) * 2 * Math.PI); // +1 inverno
  const temp = 28 - 0.55 * Math.abs(a.lat) - season * 8 * Math.min(1, Math.abs(a.lat) / 45) + (hash01(a.iata + slot) - 0.5) * 6;
  const r = hash01(a.iata + 'w' + slot);
  const codes = [0, 0, 1, 2, 3, 3, 45, 51, 61, 63, 71, 80, 95];
  const code = r < 0.55 ? 0 : codes[Math.floor(hash01(a.iata + 'c' + slot) * codes.length)];
  const wind = Math.round(8 + hash01(a.iata + 'v' + slot) * 35);
  return { temp: Math.round(temp * 10) / 10, wind, code: code === 71 && temp > 3 ? 61 : code, cloud: Math.round(r * 100), precip: 0, isDay: 1 };
}

function put(a, w, source) {
  cache[a.iata] = Object.assign({}, w, { kind: kindOf(w.code, w.wind), sev: severity(w.code, w.wind), source, t: Date.now() });
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  lastFetch = Date.now();
  const list = D.airports;
  try {
    for (let i = 0; i < list.length; i += 50) {
      const chunk = list.slice(i, i + 50);
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + chunk.map((a) => a.lat).join(',') +
        '&longitude=' + chunk.map((a) => a.lon).join(',') +
        '&current=temperature_2m,wind_speed_10m,weather_code,cloud_cover,precipitation,is_day&wind_speed_unit=kmh';
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 9000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(to);
      const j = await res.json();
      const arr = Array.isArray(j) ? j : [j];
      if (!arr[0] || !arr[0].current) throw new Error('bad weather response');
      arr.forEach((o, k) => {
        const c = o.current;
        put(chunk[k], { temp: c.temperature_2m, wind: Math.round(c.wind_speed_10m), code: c.weather_code, cloud: c.cloud_cover, precip: c.precipitation, isDay: c.is_day }, 'live');
      });
    }
  } catch (e) {
    list.forEach((a) => { if (!cache[a.iata] || cache[a.iata].source !== 'live') put(a, fallback(a), 'sim'); });
  } finally { fetching = false; }
}

function get(iata) {
  if (Date.now() - lastFetch > 20 * 60 * 1000) refresh();
  if (!cache[iata]) { const a = D.byIata[iata]; if (a) put(a, fallback(a), 'sim'); }
  return cache[iata];
}
function all() {
  if (Date.now() - lastFetch > 20 * 60 * 1000) refresh();
  const out = {};
  D.airports.forEach((a) => { out[a.iata] = get(a.iata); });
  return out;
}

module.exports = { get, all, refresh };
