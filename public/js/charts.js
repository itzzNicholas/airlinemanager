'use strict';
// Piccola libreria di grafici SVG (nessuna dipendenza) con tooltip e area di previsione.
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  function niceTicks(min, max, n) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag, step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(v);
    return out;
  }
  function line(el, o) {
    const W = 800, H = o.h || 240, m = { l: 62, r: 14, t: 12, b: 28 };
    const all = [];
    o.series.forEach((s) => { s.data.forEach((p) => all.push(p)); (s.band || []).forEach((p) => { all.push([p[0], p[1]]); all.push([p[0], p[2]]); }); });
    if (!all.length) { el.innerHTML = ''; return; }
    let xMin = Math.min(...all.map((p) => p[0])), xMax = Math.max(...all.map((p) => p[0]));
    let yMin = Math.min(...all.map((p) => p[1])), yMax = Math.max(...all.map((p) => p[1]));
    if (o.yZero) yMin = Math.min(0, yMin);
    const pad = (yMax - yMin) * 0.08 || 1; yMin -= pad; yMax += pad;
    const ticks = niceTicks(yMin, yMax, 4);
    yMin = ticks[0]; yMax = ticks[ticks.length - 1];
    const X = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * (W - m.l - m.r);
    const Y = (y) => m.t + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
    const fy = o.fmtY || ((v) => v), fx = o.fmtX || ((v) => v);
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    ticks.forEach((t) => { svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="currentColor" stroke-opacity=".12"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">${fy(t)}</text>`; });
    const nx = 5;
    for (let i = 0; i <= nx; i++) { const x = xMin + ((xMax - xMin) * i) / nx; svg += `<text x="${X(x)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}" font-size="11" fill="currentColor" fill-opacity=".6">${fx(x)}</text>`; }
    if (o.vline != null && o.vline >= xMin && o.vline <= xMax) svg += `<line x1="${X(o.vline)}" x2="${X(o.vline)}" y1="${m.t}" y2="${H - m.b}" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="3 4"/>`;
    o.series.forEach((s) => {
      if (s.band && s.band.length) {
        const up = s.band.map((p) => `${X(p[0])},${Y(p[2])}`).join(' '), dn = s.band.slice().reverse().map((p) => `${X(p[0])},${Y(p[1])}`).join(' ');
        svg += `<polygon points="${up} ${dn}" fill="${s.color}" fill-opacity=".16"/>`;
      }
      const pts = s.data.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
      if (s.fill && s.data.length) svg += `<polygon points="${X(s.data[0][0])},${Y(yMin)} ${pts} ${X(s.data[s.data.length - 1][0])},${Y(yMin)}" fill="${s.color}" fill-opacity=".12"/>`;
      svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''}/>`;
    });
    svg += '<line class="cx" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="currentColor" stroke-opacity=".4" style="display:none"/><circle class="cd" r="4.5" fill="#fff" stroke="#38bdf8" stroke-width="2" style="display:none"/>';
    svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip" style="display:none"></div>`;
    el.classList.add('chart'); el.innerHTML = svg;
    const sv = el.querySelector('svg'), tip = el.querySelector('.tip'), cx = el.querySelector('.cx'), cd = el.querySelector('.cd');
    const pts = [];
    o.series.forEach((s) => s.data.forEach((p) => pts.push({ x: p[0], y: p[1], s })));
    sv.querySelector('.hit').addEventListener('pointermove', (e) => {
      const r = sv.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      let best = null, bd = 1e18;
      pts.forEach((p) => { const d = Math.abs(X(p.x) - px); if (d < bd) { bd = d; best = p; } });
      if (!best) return;
      cx.setAttribute('x1', X(best.x)); cx.setAttribute('x2', X(best.x)); cx.style.display = '';
      cd.setAttribute('cx', X(best.x)); cd.setAttribute('cy', Y(best.y)); cd.setAttribute('stroke', best.s.color); cd.style.display = '';
      tip.style.display = ''; tip.style.left = Math.min(Math.max((X(best.x) / W) * r.width, 70), r.width - 70) + 'px'; tip.style.top = (Y(best.y) / H) * r.height + 'px';
      tip.innerHTML = `<b>${fx(best.x, true)}</b><br><span style="color:${best.s.color}">●</span> ${best.s.name ? best.s.name + ': ' : ''}${fy(best.y, true)}`;
    });
    sv.querySelector('.hit').addEventListener('pointerleave', () => { tip.style.display = 'none'; cx.style.display = 'none'; cd.style.display = 'none'; });
  }
  function bars(el, o) {
    const W = 800, H = o.h || 200, m = { l: 62, r: 10, t: 10, b: 26 };
    const d = o.data; if (!d.length) { el.innerHTML = ''; return; }
    let lo = Math.min(0, ...d.map((p) => p.y)), hi = Math.max(0, ...d.map((p) => p.y));
    const ticks = niceTicks(lo, hi, 4); lo = ticks[0]; hi = ticks[ticks.length - 1];
    const bw = (W - m.l - m.r) / d.length, Y = (v) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
    const fy = o.fmtY || ((v) => v);
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    ticks.forEach((t) => { svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="currentColor" stroke-opacity="${t === 0 ? .35 : .12}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">${fy(t)}</text>`; });
    d.forEach((p, i) => {
      const y0 = Y(0), y1 = Y(p.y);
      svg += `<rect x="${m.l + i * bw + bw * 0.15}" width="${bw * 0.7}" y="${Math.min(y0, y1)}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="2" fill="${p.y >= 0 ? '#34d399' : '#f87171'}"><title>${o.fmtX ? o.fmtX(p.x) : p.x}: ${fy(p.y)}</title></rect>`;
    });
    svg += '</svg>';
    el.classList.add('chart'); el.innerHTML = svg;
  }
  // grafico a barre impilate (costi)
  function stacked(el, o) {
    const W = 800, H = o.h || 200, m = { l: 62, r: 10, t: 10, b: 26 };
    const d = o.data; if (!d.length) { el.innerHTML = ''; return; }
    const tot = d.map((p) => o.keys.reduce((s, k) => s + (p[k.key] || 0), 0));
    const ticks = niceTicks(0, Math.max(...tot), 4), hi = ticks[ticks.length - 1];
    const bw = (W - m.l - m.r) / d.length, Y = (v) => m.t + (1 - v / (hi || 1)) * (H - m.t - m.b), fy = o.fmtY || ((v) => v);
    let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
    ticks.forEach((t) => { svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="currentColor" stroke-opacity=".12"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">${fy(t)}</text>`; });
    d.forEach((p, i) => { let acc = 0; o.keys.forEach((k) => { const v = p[k.key] || 0; if (v > 0) { svg += `<rect x="${m.l + i * bw + bw * 0.12}" width="${bw * 0.76}" y="${Y(acc + v)}" height="${Math.max(0, Y(acc) - Y(acc + v))}" fill="${k.color}"><title>${k.name}: ${fy(v)}</title></rect>`; acc += v; } }); });
    svg += '</svg>';
    el.classList.add('chart'); el.innerHTML = svg;
  }
  return { line, bars, stacked };
})();
