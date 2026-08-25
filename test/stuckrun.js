'use strict';
// Stuck-unit probe. Reports how many bodies are standing somewhere they are not
// allowed to stand - inside a building, a cliff, water or a wall.
//
// BUILD stops vehicles and guns but not men, who garrison houses, so what counts
// as blocked depends on the unit. Anything above zero here that does not clear
// within a few hundred ticks is a body that will never move again.
//
//   node test/stuckrun.js [--seed 12345] [--map city] [--checks 60,300,900,1800]
const { loadGame } = require('./dom.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

const seed = parseInt(arg('seed', '12345'), 10);
const map = arg('map', 'city');
const budget = parseInt(arg('budget', '999999'), 10);
const checks = String(arg('checks', '60,300,900,1800'))
  .split(',')
  .map((n) => parseInt(n, 10));

const g = loadGame({ quiet: true });
if (g.loadError) {
  console.log(JSON.stringify({ ok: false, error: String(g.loadError.stack || g.loadError) }));
  process.exit(1);
}

try {
  const mapBtn = g.all('#mapPick [data-map="' + map + '"]')[0];
  if (!mapBtn) throw new Error('no map button for ' + map);
  mapBtn.click();

  g.hook('seed')(seed);
  g.all('#startVeil [data-budget="' + budget + '"]')[0].click();
  g.el('autoDep').click();
  g.el('startBattle').click();

  // Reinforcements bought mid-battle roll out of a base via hqSpawn(), which is
  // a different placement path from the deployment-phase auto-fill. --buy walks
  // that path: it is where a vehicle can land inside a base's own structures.
  const buy = arg('buy', '');
  if (buy) {
    g.hook('lvl')('blue', 60);
    const kinds = buy.split(',');
    const count = parseInt(arg('count', '24'), 10);
    for (let i = 0; i < count; i++) {
      const k = kinds[i % kinds.length];
      const x = 300 + ((i * 137) % 1800);
      const y = 220 + ((i * 311) % 2800);
      g.hook('buy')(k, x, y);
    }
  }

  const tick = g.hook('tick');
  const stuck = g.hook('stuck');
  const out = { ok: true, seed, map, points: [] };

  let done = 0;
  for (const at of checks) {
    if (at > done) tick(at - done);
    done = at;
    const s = stuck();
    out.points.push({ tick: at, live: s.live, inSolid: s.inSolid, byKind: s.byKind });
  }
  console.log(JSON.stringify(out));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
  process.exit(1);
}
