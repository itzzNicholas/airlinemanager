'use strict';
// Mappa 3D live dei voli (globe.gl / three.js caricati da CDN solo quando serve).
const GlobeMap = (() => {
  let world = null, wrap = null, loading = null, planes = new Map(), timer = null, ctx = null, sel = null;
  const SRC = 'https://cdn.jsdelivr.net/npm/globe.gl@2.45.0/dist/globe.gl.min.js';
  const IMG = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img/';
  const PLANE = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';

  function load() {
    if (window.Globe) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = SRC; s.onload = res; s.onerror = () => rej(new Error('globe load failed')); document.head.appendChild(s); });
    return loading;
  }

  async function mount(container, context) {
    ctx = context;
    await load();
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.style.cssText = 'position:absolute;inset:0';
      world = Globe()(wrap)
        .globeImageUrl(IMG + 'earth-blue-marble.jpg').bumpImageUrl(IMG + 'earth-topology.png').backgroundImageUrl(IMG + 'night-sky.png')
        .atmosphereColor('#4fc3f7').atmosphereAltitude(0.22)
        .arcStartLat((d) => d.a.lat).arcStartLng((d) => d.a.lon).arcEndLat((d) => d.b.lat).arcEndLng((d) => d.b.lon)
        .arcColor((d) => d.color).arcStroke(0.35).arcAltitudeAutoScale(0.28).arcDashLength(0.5).arcDashGap(0.3).arcDashAnimateTime(6000)
        .pointLat('lat').pointLng('lon').pointColor((d) => d.color).pointAltitude((d) => d.alt).pointRadius((d) => d.r).pointLabel((d) => d.label)
        .labelLat('lat').labelLng('lon').labelText('text').labelSize(0.55).labelDotRadius(0.25).labelColor(() => 'rgba(255,255,255,.88)').labelResolution(2).labelAltitude(0.012)
        .ringLat('lat').ringLng('lon').ringColor(() => (t) => `rgba(248,113,113,${1 - t})`).ringMaxRadius(3.2).ringPropagationSpeed(1.6).ringRepeatPeriod(1400)
        .htmlLat('lat').htmlLng('lng').htmlAltitude('alt').htmlTransitionDuration(0).htmlElement((d) => d.el);
      world.controls().autoRotate = false;
      world.controls().minDistance = 130;
    }
    container.appendChild(wrap);
    const resize = () => { world.width(container.clientWidth).height(container.clientHeight); };
    resize();
    window.addEventListener('resize', resize);
    mount.cleanup = () => window.removeEventListener('resize', resize);
    const hub = ctx.hub();
    world.pointOfView({ lat: hub.lat, lng: hub.lon, altitude: 1.9 }, 0);
    refreshStatic();
    tick();
    timer = setInterval(tick, 250);
  }

  function unmount() {
    if (timer) clearInterval(timer); timer = null;
    if (mount.cleanup) mount.cleanup();
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }

  function refreshStatic() {
    if (!world) return;
    const s = ctx.state(), ap = ctx.airports();
    const arcs = s.routes.map((r) => ({ a: ap[r.a], b: ap[r.b], color: ['rgba(56,189,248,.65)', 'rgba(167,139,250,.65)'] }));
    world.arcsData(arcs);
    const used = new Set(); s.routes.forEach((r) => { used.add(r.a); used.add(r.b); }); s.bases.forEach((b) => used.add(b.iata));
    const baseSet = new Set(s.bases.map((b) => b.iata));
    const pts = [...used].map((i) => ({ lat: ap[i].lat, lon: ap[i].lon, color: baseSet.has(i) ? '#fbbf24' : '#38bdf8', alt: 0.004, r: baseSet.has(i) ? 0.45 : 0.3, label: `<b>${i}</b> ${ap[i].city}` }));
    world.pointsData(pts);
    world.labelsData([...used].map((i) => ({ lat: ap[i].lat, lon: ap[i].lon, text: i })));
    const wx = ctx.weather() || {};
    world.ringsData([...used].filter((i) => wx[i] && wx[i].sev >= 2).map((i) => ({ lat: ap[i].lat, lon: ap[i].lon })));
  }

  function tick() {
    if (!world) return;
    const s = ctx.state(), ap = ctx.airports(), now = ctx.clock();
    const seen = new Set();
    s.fleet.forEach((ac) => {
      const f = ac.flight;
      if (ac.status !== 'flying' || !f || now < f.dep) return;
      const A = ap[f.from], B = ap[f.to];
      const frac = Math.min(1, Math.max(0, (now - f.dep) / (f.arr - f.dep)));
      const p = Geo.interp(A, B, frac), q = Geo.interp(A, B, Math.min(1, frac + 0.02));
      let o = planes.get(ac.id);
      if (!o) {
        const el = document.createElement('div'); el.className = 'plane-el'; el.innerHTML = PLANE; el.title = ac.name;
        el.addEventListener('click', (e) => { e.stopPropagation(); sel = ac.id; ctx.onSelect(ac.id); });
        o = { el, id: ac.id }; planes.set(ac.id, o);
      }
      o.lat = p.lat; o.lng = p.lon; o.alt = 0.012 + 0.05 * Math.sin(Math.PI * frac);
      o.el.firstChild.style.transform = `rotate(${Geo.bearing(p, q)}deg)`;
      o.el.classList.toggle('sel', sel === ac.id);
      o.el.style.color = f.mission ? '#34d399' : ac.role === 'cargo' ? '#fb923c' : '';
      seen.add(ac.id);
    });
    for (const id of [...planes.keys()]) if (!seen.has(id)) planes.delete(id);
    world.htmlElementsData([...planes.values()]);
    ctx.onTick && ctx.onTick(planes.size);
  }
  return { mount, unmount, refreshStatic, focus(lat, lon) { world && world.pointOfView({ lat, lng: lon, altitude: 1.4 }, 900); }, select(id) { sel = id; }, ready: () => !!world };
})();
