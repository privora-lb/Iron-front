'use strict';
// Determinism probe. Runs in its own node process so that nothing but the seed
// can carry over: boots the game, starts a match, drives the simulation by TICK
// COUNT ALONE (never by wall clock or animation frames) and prints stateHash()
// at fixed checkpoints as JSON on stdout.
//
//   node test/simrun.js --seed 12345 [--map villages] [--budget 2000] [--checks 300,600,1200,1800]
const { loadGame } = require('./dom.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

const seed = parseInt(arg('seed', '1'), 10);
const map = arg('map', 'villages');
const budget = parseInt(arg('budget', '2000'), 10);
const checks = String(arg('checks', '300,600,1200,1800')).split(',').map(n => parseInt(n, 10));

const g = loadGame({ quiet: true });
if (g.loadError) {
  console.log(JSON.stringify({ ok: false, error: String(g.loadError.stack || g.loadError) }));
  process.exit(1);
}

try {
  // Pick the battlefield through the real UI so the run matches a real match.
  const mapBtn = g.all('#mapPick [data-map="' + map + '"]')[0];
  if (!mapBtn) throw new Error('no map button for ' + map);
  mapBtn.click();

  // Seed BEFORE beginGame - beginGame() calls srand(matchSeed).
  g.hook('seed')(seed);

  const budgetBtn = g.all('#startVeil [data-budget="' + budget + '"]')[0];
  if (!budgetBtn) throw new Error('no budget button for ' + budget);
  budgetBtn.click();                       // -> beginGame(budget)

  g.el('autoDep').click();                 // fill the blue deployment zone
  g.el('startBattle').click();             // -> readyDeploy -> startBattle

  const hash = g.hook('hash');
  const tick = g.hook('tick');
  const out = { ok: true, seed, map, budget, start: hash() >>> 0, points: [] };

  let done = 0;
  for (const at of checks) {
    const n = at - done;
    if (n > 0) tick(n);
    done = at;
    out.points.push({ tick: at, hash: hash() >>> 0 });
  }
  out.dbg = (() => {
    const d = g.hook('dbg')();
    return { squads: d.squads.length, lvlBlue: d.lvl.blue, lvlRed: d.lvl.red };
  })();
  console.log(JSON.stringify(out));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
  process.exit(1);
}
