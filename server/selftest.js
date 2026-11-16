'use strict';
// Test di fumo dell'economia e delle funzioni: node server/selftest.js
const sim = require('./sim');
const assert = require('assert');
const D = require('./data');

function setup(modelId, a, b, role) {
  const g = sim.newGame();
  g.settings.offline = true; g.settings.speed = 1; g.cash = 200e6;
  sim.actions.createCompany(g, { name: 'Test Air', hub: a });
  g.fleet = [];
  sim.actions.buyAircraft(g, { model: modelId, role });
  const ac = g.fleet[0];
  sim.actions.skipAircraft(g, { id: ac.id }); g.lastReal = 1000; sim.advance(g, 1001);
  const m = D.byModel[modelId];
  g.pilots = []; for (let i = 0; i < 4; i++) { const p = { id: 900 + i, name: 'P', cls: m.cls, skill: 70, hours: 0, status: 'free', ac: null }; p.salary = Math.round((90 + m.cls * 90) * 1.2); g.pilots.push(p); }
  g.staff = { cabin: Math.ceil(m.seats / 30), ground: 2 + Math.ceil(m.seats / 60), mech: 1 };
  g.depots[a].cap = 5000; g.depots[a].auto = { on: true, min: 100, fill: 1000 };
  return { g, ac, m };
}
function run(label, modelId, a, b, role) {
  const { g, ac, m } = setup(modelId, a, b, role);
  sim.actions.createRoute(g, { a, b });
  sim.actions.buyFuel(g, { iata: a, tons: 1000 });
  sim.actions.assign(g, { id: ac.id, routeId: g.routes[0].id });
  g.lastReal = 0; sim.advance(g, 20 * 86400e3);
  const last = g.daily.slice(1);
  const prof = last.reduce((s, d) => s + d.profit, 0) / Math.max(1, last.length);
  const fl = last.reduce((s, d) => s + d.flights, 0) / Math.max(1, last.length);
  console.log(label.padEnd(24), 'fl/day', fl.toFixed(1).padStart(5), 'profit/day $', Math.round(prof).toLocaleString().padStart(10),
    ' payback', prof > 0 ? Math.round(m.price / prof) + 'd' : 'n/a', ' LF', (g.routes[0].stats.lf * 100).toFixed(0) + '%', 'rep', g.rep.toFixed(0));
  return g;
}
const g1 = run('Caravan MXP-VCE', 'c208', 'MXP', 'VCE');
run('ATR72 FCO-MXP', 'atr72', 'FCO', 'MXP');
run('A320neo LHR-FCO', 'a320n', 'LHR', 'FCO');
run('A320neo FRA-IST', 'a320n', 'FRA', 'IST');
run('A320neo cargo FRA-IST', 'a320n', 'FRA', 'IST', 'cargo');
run('B788 JFK-LHR', 'b788', 'JFK', 'LHR');
run('A380 DXB-LHR', 'a388', 'DXB', 'LHR');
run('B77W HND-LAX', 'b77w', 'HND', 'LAX');
run('Concorde JFK-LHR', 'conc', 'JFK', 'LHR');

// missioni
{
  const { g, ac } = setup('a320n', 'FCO', 'MXP');
  assert(g.missions.length >= 4, 'missions generated');
  const ms = g.missions.find((m) => m.pax || m.cargo);
  console.log('missione', ms.type, ms.client, ms.from, '->', ms.to, ms.reward);
  try { sim.actions.acceptMission(g, { id: ms.id, ac: ac.id }); console.log('accepted'); } catch (e) { console.log('accept err', e.code); }
}
// mercato usato
{
  const { g, ac } = setup('a320n', 'FCO', 'MXP');
  const band = sim.usedBand(D.byModel['a320n'], ac.hours, ac.cond);
  assert.throws(() => sim.actions.listAircraft(g, { id: ac.id, price: band.max * 2 }));
  const r = sim.actions.listAircraft(g, { id: ac.id, price: band.fair });
  assert(r.listing && g.fleet.length === 0);
  sim.actions.buyUsed(g, { listing: r.listing }); assert(g.fleet.length === 1);
}
// basi e depositi
{
  const { g } = setup('a320n', 'FCO', 'MXP');
  sim.actions.buildBase(g, { iata: 'MXP' }); sim.actions.buildDepot(g, { iata: 'MXP' }); sim.actions.upgradeHangar(g, { iata: 'MXP' });
  sim.actions.buyFuel(g, { iata: 'MXP', tons: 50 }); assert(g.depots.MXP.tons === 50);
}
const v = sim.view(g1);
assert(v.routes[0].econ.dist > 0);
console.log(JSON.stringify(sim.summary(g1)));
console.log('OK');
process.exit(0);
