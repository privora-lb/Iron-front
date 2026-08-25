'use strict';
// Save/load probe. Two modes, meant to be run as two separate node processes so
// that nothing but the saved record carries over.
//
//   node test/saverun.js --seed 4242 --map villages --ticks 900 --more 600 --out FILE
//     boots the game, starts a match, drives it by TICK COUNT ALONE, saves the
//     battle, writes the raw localStorage record to FILE, then keeps ticking and
//     prints the hash at the save point and the hash --more ticks later.
//
//   node test/saverun.js --load FILE --more 600
//     boots a fresh game, puts the record back into storage, loads it, and
//     prints the same two hashes.
//
// The two runs must agree on both. The first says the battle came back; the
// second says it carried on down the same road it would have taken anyway.
const fs = require('fs');
const { loadGame } = require('./dom.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

const SLOT = 'ironfront:save:probe';
const INDEX = 'ironfront:saves';
const more = parseInt(arg('more', '600'), 10);
const loadFrom = arg('load', null);

const g = loadGame({ quiet: true });
if (g.loadError) {
  console.log(JSON.stringify({ ok: false, error: String(g.loadError.stack || g.loadError) }));
  process.exit(1);
}

try {
  const hash = g.hook('hash');
  const rng = g.hook('rng');
  const tick = g.hook('tick');
  const out = { ok: true };

  if (loadFrom) {
    const rec = JSON.parse(fs.readFileSync(loadFrom, 'utf8'));
    g.win.localStorage.setItem(SLOT, rec.slot);
    g.win.localStorage.setItem(INDEX, rec.index);
    if (!g.hook('load')('probe')) throw new Error('the save could not be read back');
    out.at = hash() >>> 0;
    out.rngAt = rng() >>> 0;
    tick(more);
    out.after = hash() >>> 0;
    out.rngAfter = rng() >>> 0;
    out.fault = g.fault();
  } else {
    const seed = parseInt(arg('seed', '4242'), 10);
    const map = arg('map', 'villages');
    const budget = parseInt(arg('budget', '2000'), 10);
    const ticks = parseInt(arg('ticks', '900'), 10);
    g.all('#mapPick [data-map="' + map + '"]')[0].click();
    g.hook('seed')(seed);                    // before beginGame: it calls srand(matchSeed)
    g.all('#startVeil [data-budget="' + budget + '"]')[0].click();
    g.el('autoDep').click();
    g.el('startBattle').click();
    tick(ticks);
    const res = g.hook('save')('probe');
    if (!res.ok) throw new Error('save refused: ' + res.why);
    out.at = hash() >>> 0;
    out.rngAt = rng() >>> 0;
    out.bytes = g.win.localStorage.getItem(SLOT).length;
    fs.writeFileSync(arg('out', 'saverun.json'), JSON.stringify({
      slot: g.win.localStorage.getItem(SLOT),
      index: g.win.localStorage.getItem(INDEX),
    }));
    tick(more);
    out.after = hash() >>> 0;
    out.rngAfter = rng() >>> 0;
    out.fault = g.fault();
  }
  console.log(JSON.stringify(out));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
  process.exit(1);
}
