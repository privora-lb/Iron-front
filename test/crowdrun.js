'use strict';
// Crowding probe. Boots a match, drives it by tick count and reports how many
// pairs of bodies are standing inside one another at each checkpoint.
//
// "Units do not walk over each other" is a claim that is easy to make and hard
// to see by eye in a battle of four hundred men, so it gets measured instead.
// `pairs` is how many overlapping pairs exist; `worstFrac` is the deepest
// overlap as a fraction of the two bodies' combined radius, so 0.5 means one
// body is halfway inside another.
//
//   node test/crowdrun.js [--seed 12345] [--map villages] [--budget 2000]
//                         [--checks 300,900,1800]
const { loadGame } = require('./dom.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

const seed = parseInt(arg('seed', '12345'), 10);
const map = arg('map', 'villages');
const budget = parseInt(arg('budget', '2000'), 10);
const checks = String(arg('checks', '300,900,1800'))
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

  const budgetBtn = g.all('#startVeil [data-budget="' + budget + '"]')[0];
  if (!budgetBtn) throw new Error('no budget button for ' + budget);
  budgetBtn.click();

  g.el('autoDep').click();
  g.el('startBattle').click();

  const tick = g.hook('tick');
  const overlap = g.hook('overlap');
  const out = { ok: true, seed, map, budget, points: [] };

  let done = 0;
  for (const at of checks) {
    if (at > done) tick(at - done);
    done = at;
    const o = overlap();
    out.points.push({ tick: at, live: o.live, pairs: o.pairs, worstFrac: o.worstFrac });
  }
  console.log(JSON.stringify(out));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
  process.exit(1);
}
