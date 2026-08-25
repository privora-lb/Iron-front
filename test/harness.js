'use strict';
// Iron Front headless test harness.
//
//   node test/harness.js            full suite
//   node test/harness.js --fast     shorter match runs, for a quick loop
//
// Four checks, in the order they catch things:
//   1. LOAD        index.html evaluates with no error - catches the load-time
//                  crash that shows up in a browser as a black screen.
//   2. MATCH       a match runs 1800+ frames on each of the five battlefields,
//                  through the real animation-frame path, so draw() runs too.
//   3. UI          every palette card and UI button can be clicked without
//                  throwing, on the start screen, in deploy and in battle.
//   4. DETERMINISM the same seed in two separate node processes, driven by tick
//                  count alone, agrees on stateHash() at every checkpoint - and
//                  different seeds disagree.
const path = require('path');
const { execFileSync } = require('child_process');
const { loadGame } = require('./dom.js');

const FAST = process.argv.includes('--fast');
const MAPS = ['villages', 'mountains', 'beach', 'city', 'desert'];
const MATCH_FRAMES = FAST ? 400 : 1800;
const CHECKPOINTS = FAST ? [120, 300] : [300, 600, 1200, 1800];

let failures = 0;
let checks = 0;

const C = process.stdout.isTTY
  ? { g: s => '\x1b[32m' + s + '\x1b[0m', r: s => '\x1b[31m' + s + '\x1b[0m',
      y: s => '\x1b[33m' + s + '\x1b[0m', d: s => '\x1b[90m' + s + '\x1b[0m' }
  : { g: s => s, r: s => s, y: s => s, d: s => s };

function ok(label, detail) {
  checks++;
  console.log('  ' + C.g('PASS') + '  ' + label + (detail ? C.d('  ' + detail) : ''));
}
function bad(label, detail) {
  checks++; failures++;
  console.log('  ' + C.r('FAIL') + '  ' + label + (detail ? '\n        ' + String(detail).split('\n').join('\n        ') : ''));
}
function assert(cond, label, detail) { cond ? ok(label, cond === true ? '' : detail) : bad(label, detail); }
function head(n) { console.log('\n' + C.y(n)); }

/* ------------------------------------------------------------------ */
/* helpers shared by the in-process checks                             */
/* ------------------------------------------------------------------ */

// Walk from the start screen into a running battle, clicking real UI.
function startMatch(g, map, budget) {
  const mapBtn = g.all('#mapPick [data-map="' + map + '"]')[0];
  if (!mapBtn) throw new Error('no map button for ' + map);
  mapBtn.click();
  const budgetBtn = g.all('#startVeil [data-budget="' + budget + '"]')[0];
  if (!budgetBtn) throw new Error('no budget button for ' + budget);
  budgetBtn.click();
  g.el('autoDep').click();
  g.el('startBattle').click();
}

// Every button the player can reach, deduped, in document order.
function allButtons(g) {
  return g.all('button').filter(b => !b._harnessSkip);
}

/* ------------------------------------------------------------------ */
/* 1. LOAD                                                             */
/* ------------------------------------------------------------------ */
head('1. LOAD');
let boot;
try {
  boot = loadGame({ quiet: true });
} catch (e) {
  bad('index.html could not be read', e.stack || e);
  process.exit(1);
}
assert(!boot.loadError, 'index.html evaluates with no error',
  boot.loadError && (boot.loadError.stack || boot.loadError.message));
if (boot.loadError) {
  console.log('\n' + C.r('load failed - nothing else can run'));
  process.exit(1);
}
assert(typeof boot.hook('tick') === 'function', 'debug hooks installed', boot.lines + ' lines, ' + Math.round(boot.bytes / 1024) + ' KB');
assert(typeof boot.hook('hash') === 'function', '__hash() available for determinism checks');
assert(boot.el('pal').children.length > 0, 'palette built', boot.el('pal').children.length + ' cards');
assert(boot.el('mapPick').children.length === 5, 'five battlefields offered');
assert(boot.frames(30) === 30, '30 idle frames on the start screen');
assert(boot.fault() === null, 'no draw fault on the start screen', boot.fault());

/* ------------------------------------------------------------------ */
/* 2. MATCH - 1800+ frames on every map                                */
/* ------------------------------------------------------------------ */
head('2. MATCH  (' + MATCH_FRAMES + ' frames x ' + MAPS.length + ' battlefields)');
for (const map of MAPS) {
  const g = loadGame({ quiet: true });
  let err = null;
  let ran = 0;
  let restarts = 0;
  const t0 = Date.now();
  try {
    g.hook('seed')(4242);
    startMatch(g, map, 2000);
    while (ran < MATCH_FRAMES) {
      if (!g.frame()) { err = new Error('the animation loop stopped rescheduling itself'); break; }
      ran++;
      // If a side breaks, deploy again and keep the clock running - the point is
      // total frames survived, and this exercises the end -> restart path too.
      if (g.el('endVeil').style.display === 'flex' && ran < MATCH_FRAMES) {
        g.el('again').click();
        startMatch(g, map, 2000);
        restarts++;
        if (restarts > 20) break;
      }
    }
  } catch (e) {
    err = e;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const fault = g.fault();
  const detail = ran + ' frames, ' + restarts + ' match(es), ' + secs + 's';
  if (err) bad(map + ' ran ' + MATCH_FRAMES + ' frames', err.stack || err);
  else if (fault) bad(map + ' ran ' + MATCH_FRAMES + ' frames', 'draw() threw: ' + fault);
  else if (ran < MATCH_FRAMES) bad(map + ' ran ' + MATCH_FRAMES + ' frames', 'stopped at ' + ran);
  else ok(map, detail);
}

/* ------------------------------------------------------------------ */
/* 3. UI - click everything                                            */
/* ------------------------------------------------------------------ */
head('3. UI');
for (const stage of ['start', 'deploy', 'battle']) {
  const g = loadGame({ quiet: true });
  g.hook('seed')(7);
  if (stage !== 'start') {
    g.all('#startVeil [data-budget="2000"]')[0].click();
    g.el('autoDep').click();
    if (stage === 'battle') { g.el('startBattle').click(); g.frames(60); }
  }
  const buttons = allButtons(g);
  const broken = [];
  for (const b of buttons) {
    const name = (b.id ? '#' + b.id : '') + (b.className ? '.' + b._classes.join('.') : '')
      + (b.getAttribute('data-o') ? '[data-o=' + b.getAttribute('data-o') + ']' : '')
      + ' "' + String(b.textContent || b.innerHTML || '').replace(/<[^>]*>/g, '').slice(0, 24).trim() + '"';
    try {
      b.click();
      g.frames(2);                       // surface anything deferred to the next draw
      const f = g.fault();
      if (f) { broken.push(name + ' -> draw fault: ' + f.split('\n')[1]); break; }
    } catch (e) {
      broken.push(name + ' -> ' + (e && e.message ? e.message : e));
    }
  }
  if (broken.length) bad(stage + ': ' + buttons.length + ' buttons clickable', broken.join('\n'));
  else ok(stage + ': every button clickable', buttons.length + ' buttons');
}

// The palette cards specifically, one deliberate pass each in deploy.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(7);
  g.all('#startVeil [data-budget="999999"]')[0].click();   // Total War unlocks every card
  const cards = g.all('#pal .card');
  const broken = [];
  for (let i = 0; i < cards.length; i++) {
    try {
      // buildPalette() rebuilds #pal on every click, so re-read each time
      const live = g.all('#pal .card')[i];
      live.click();
      g.frames(2);
      if (g.fault()) { broken.push('card ' + i + ' -> ' + g.fault()); break; }
    } catch (e) {
      broken.push('card ' + i + ' -> ' + (e && e.message ? e.message : e));
    }
  }
  if (broken.length) bad('every palette card selectable', broken.join('\n'));
  else ok('every palette card selectable', cards.length + ' cards');
}

/* ------------------------------------------------------------------ */
/* 4. DETERMINISM - two separate node processes                        */
/* ------------------------------------------------------------------ */
head('4. DETERMINISM  (separate processes, driven by tick count alone)');
const RUNNER = path.join(__dirname, 'simrun.js');
function run(seed, map) {
  const out = execFileSync(process.execPath, [
    RUNNER, '--seed', String(seed), '--map', map, '--checks', CHECKPOINTS.join(','),
  ], { encoding: 'utf8', maxBuffer: 1 << 24 });
  return JSON.parse(out.trim().split('\n').pop());
}

for (const map of FAST ? ['villages'] : MAPS) {
  let a, b;
  try {
    a = run(20260825, map);
    b = run(20260825, map);
  } catch (e) {
    bad(map + ': same seed agrees across processes', (e.stdout || '') + (e.stderr || '') || e.message);
    continue;
  }
  if (!a.ok || !b.ok) { bad(map + ': same seed agrees across processes', a.error || b.error); continue; }
  const mismatch = [];
  if (a.start !== b.start) mismatch.push('tick 0: ' + a.start + ' vs ' + b.start);
  for (let i = 0; i < a.points.length; i++) {
    if (a.points[i].hash !== b.points[i].hash) {
      mismatch.push('tick ' + a.points[i].tick + ': ' + a.points[i].hash + ' vs ' + b.points[i].hash);
    }
  }
  if (mismatch.length) bad(map + ': same seed agrees across processes', mismatch.join('\n'));
  else ok(map + ': same seed agrees across processes',
    CHECKPOINTS.length + ' checkpoints, last hash ' + a.points[a.points.length - 1].hash);
}

{
  const a = run(111, 'villages');
  const b = run(222, 'villages');
  const same = a.ok && b.ok && a.start === b.start
    && a.points.every((p, i) => p.hash === b.points[i].hash);
  assert(!same, 'different seeds produce different battles',
    same ? 'seeds 111 and 222 produced identical hashes - the seed is not reaching the sim' : '');
}

/* ------------------------------------------------------------------ */
console.log('\n' + (failures
  ? C.r(failures + ' of ' + checks + ' checks failed')
  : C.g('all ' + checks + ' checks passed')));
process.exit(failures ? 1 : 0);
