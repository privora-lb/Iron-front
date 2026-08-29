'use strict';
// Iron Front headless test harness.
//
//   node test/harness.js            full suite
//   node test/harness.js --fast     shorter match runs, for a quick loop
//
// Nine checks, in the order they catch things:
//   1. LOAD        index.html evaluates with no error - catches the load-time
//                  crash that shows up in a browser as a black screen.
//   2. MATCH       a match runs 1800+ frames on each of the five battlefields,
//                  through the real animation-frame path, so draw() runs too.
//   3. UI          every palette card and UI button can be clicked without
//                  throwing, on the start screen, in deploy and in battle.
//   4. DETERMINISM the same seed in two separate node processes, driven by tick
//                  count alone, agrees on stateHash() at every checkpoint - and
//                  different seeds disagree.
//   5. WORLD       the living scenery holds together: every map is planted with
//                  trees, felling one takes its cover with it, villages are laid
//                  out around a road, civilians react to gunfire - and killing
//                  every civilian leaves stateHash() untouched, which is what
//                  keeps them free in lockstep.
//   6. FEEL        what the game does in the hand: the camera punches and
//                  settles, and a finger can select several units.
//   7. SAVES       a battle saved in one process and loaded in another comes
//                  back with the same stateHash() and runs on identically; the
//                  slots hold; an unreadable record is refused, not half-loaded.
//   8. TERRAIN     the battlefield model: what a cell IS decides how fast you
//                  cross it, what it takes off a shell, whether it hides you
//                  and whether you can see through it - and the info line and
//                  the simulation read the same answer.
//   9. RENDERERS   the same battle can be drawn two ways: the 3D ground is
//                  laid over the battlefield correctly, a device with no
//                  WebGL is refused and keeps playing, and both renderers
//                  read one world rather than a copy each.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadGame } = require('./dom.js');

const BR = String.fromCharCode(10);
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
/* 5. WORLD - living scenery: trees, villages, civilians               */
/* ------------------------------------------------------------------ */
head('5. WORLD');

function world(map, budget) {
  const g = loadGame({ quiet: true });
  g.all('#mapPick [data-map="' + map + '"]')[0].click();
  g.hook('seed')(4242);
  g.all('#startVeil [data-budget="' + (budget || 2000) + '"]')[0].click();
  g.el('autoDep').click();
  g.el('startBattle').click();
  return g;
}

// Trees must exist as entities on every battlefield, or nothing can crush them.
{
  const thin = [];
  for (const map of MAPS) {
    const g = world(map);
    const t = g.hook('trees')();
    if (t.total < 200 || t.woodCells < 200) thin.push(map + ': ' + JSON.stringify(t));
  }
  if (thin.length) bad('every map is planted with trees', thin.join('\n'));
  else ok('every map is planted with trees');
}

// Felling has to take the cover with it - that is the whole point.
{
  const g = world('villages');
  const t = g.hook('aTree')();
  const before = g.hook('trees')();
  const hadWood = g.hook('wood')(t.x, t.y);
  const felled = g.hook('fell')(t.x, t.y, 60);
  const after = g.hook('trees')();
  const stillWood = g.hook('wood')(t.x, t.y);
  g.frames(90);
  const settled = g.hook('trees')();
  const problems = [];
  if (!hadWood) problems.push('a standing tree did not mark its cell as WOOD');
  if (felled < 1) problems.push('felling r=60 around a tree took down nothing');
  if (after.down !== felled) problems.push('felled ' + felled + ' but treesDown says ' + after.down);
  if (stillWood) problems.push('WOOD cover survived after every tree there came down');
  if (after.woodCells >= before.woodCells) problems.push('wood cells did not shrink');
  if (settled.falling !== 0) problems.push('toppling trees never settled: ' + settled.falling + ' still falling');
  if (g.fault()) problems.push('draw fault: ' + g.fault());
  if (problems.length) bad('felling trees removes their cover', problems.join('\n'));
  else ok('felling trees removes their cover', felled + ' felled, WOOD cleared, trunks settled');
}

// A village should read as a place: one road per village, houses squared to it.
{
  const g = world('villages');
  const L = g.hook('land')();
  const problems = [];
  if (!L.props.road) problems.push('no roads laid');
  if (!L.props.well) problems.push('no wells');
  if (L.homes < 8) problems.push('only ' + L.homes + ' houses');
  if (!L.barns) problems.push('no barns');
  if (!L.fieldCells) problems.push('no standing crops');
  // the real test: many houses, few angles - each village squares to its own road
  if (L.distinctHouseAngles !== L.props.road) {
    problems.push('houses use ' + L.distinctHouseAngles + ' angles for ' + L.props.road
      + ' roads - they are not aligned to the road');
  }
  if (problems.length) bad('villages are laid out around a road', problems.join('\n'));
  else ok('villages are laid out around a road',
    L.homes + ' houses on ' + L.props.road + ' roads, ' + L.barns + ' barns, ' + L.fieldCells + ' crop cells');
}

// Civilians live here and take cover when the shooting starts.
{
  const g = world('villages');
  const born = g.hook('civs')();
  g.frames(120);
  const home = g.hook('aHome')();               // fire into a village that actually exists
  g.hook('shoot')(home.x, home.y, 40);
  g.frames(120);
  const scared = g.hook('civs')();
  const problems = [];
  if (born.alive < 10) problems.push('only ' + born.alive + ' civilians spawned');
  if (!born.farmers) problems.push('no farmers among them');
  if (!(scared.states.cower || scared.states.alarm)) {
    problems.push('nobody reacted to gunfire: ' + JSON.stringify(scared.states));
  }
  if (g.fault()) problems.push('draw fault: ' + g.fault());
  if (problems.length) bad('civilians live in the villages and react to fire', problems.join('\n'));
  else ok('civilians live in the villages and react to fire',
    born.alive + ' civilians, ' + ((scared.states.cower || 0) + (scared.states.alarm || 0)) + ' took cover');
}

// The load-bearing guarantee: civilians are NOT simulation state. Killing every
// one of them must not move stateHash() by a single bit, or lockstep desyncs.
{
  const a = world('villages');
  const b = world('villages');
  a.hook('tick')(240);
  b.hook('tick')(240);
  const base = a.hook('hash')() >>> 0;
  b.hook('killAllCivs')();
  b.hook('tick')(240);
  a.hook('tick')(240);
  const withCivs = a.hook('hash')() >>> 0;
  const without = b.hook('hash')() >>> 0;
  if (base === 0) bad('civilians are outside the simulation', 'hash never advanced');
  else if (withCivs !== without) {
    bad('civilians are outside the simulation',
      'killing every civilian changed the sim: ' + withCivs + ' vs ' + without
      + '\ncivilian code must never touch R() or feed back into sim state');
  } else ok('civilians are outside the simulation', 'killing all of them leaves stateHash identical');
}

// The ground itself: a real height field, fair under a 180-degree turn, with
// corridors and a river that come from the terrain rather than from constants.
{
  const problems = [];
  for (const map of MAPS) {
    const g = world(map);
    const r = g.hook('relief')();
    // Landing Beach shelves down to the sea along one edge, which cannot be
    // rotationally symmetric; both keeps sit at y = H/2, so it stays fair.
    const tol = map === 'beach' ? 1.01 : 0.0001;
    if (r.rotationalError > tol) {
      problems.push(map + ': halves differ by ' + r.rotationalError + ' - not fair under a 180 turn');
    }
    if (r.mirrorError < 0.05) problems.push(map + ': mirror-symmetric, the reflection line will show');
    const total = r.elevSpread.reduce((a, b) => a + b, 0);
    if (r.elevSpread[0] + r.elevSpread[1] === total) {
      problems.push(map + ': no high ground at all, the sight and damage bonuses are dead');
    }
    if (r.lanes.some(y => y < 220 || y > 3080)) problems.push(map + ': a corridor hugs the map edge: ' + r.lanes);
    if (r.lanes[0] >= r.lanes[1] || r.lanes[1] >= r.lanes[2]) problems.push(map + ': corridors out of order');
  }
  if (problems.length) bad('the ground is a fair, real height field', problems.join('\n'));
  else ok('the ground is a fair, real height field',
    'rotationally symmetric, no mirror line, high ground on every map');
}

// Corridors and the river must follow the seed, not sit at hardcoded thirds.
{
  const a = world('villages');
  const b = loadGame({ quiet: true });
  b.all('#mapPick [data-map="villages"]')[0].click();
  b.hook('seed')(987654);
  b.all('#startVeil [data-budget="2000"]')[0].click();
  const ra = a.hook('relief')(), rb = b.hook('relief')();
  const problems = [];
  if (ra.lanes.join() === rb.lanes.join()) {
    problems.push('two seeds gave the same corridors ' + ra.lanes + ' - they are still hardcoded');
  }
  if (ra.riverSpan[1] - ra.riverSpan[0] < 120) {
    problems.push('the river runs straight (' + ra.riverSpan + ') - it is not following the ground');
  }
  if (problems.length) bad('corridors and the river come from the terrain', problems.join('\n'));
  else ok('corridors and the river come from the terrain',
    'lanes ' + ra.lanes + ' vs ' + rb.lanes + ', river wanders ' + (ra.riverSpan[1] - ra.riverSpan[0]));
}

/* ------------------------------------------------------------------ */
/* 6. FEEL - what the game does in the hand                            */
/* ------------------------------------------------------------------ */
head('6. FEEL');

function touch(g, x, y, type) {
  g.doc.getElementById('cv').dispatchEvent({
    type, touches: type === 'touchend' ? [] : [{ clientX:x, clientY:y }],
    preventDefault() {}, stopPropagation() {},
  });
}
// A key, and a mouse. Keys are listened for on the document and mouse moves
// on the window, so neither can be dispatched at an element the way touches
// can; the events go where the engine is actually listening.
function key(g, k) {
  g.el('hud').dispatchEvent({
    type: 'keydown', key: k, ctrlKey: false, metaKey: false,
    preventDefault() {}, stopPropagation() {},
  });
}
function mouse(g, type, o) {
  const ev = Object.assign(
    { type, button: 0, clientX: 0, clientY: 0, shiftKey: false,
      preventDefault() {}, stopPropagation() {} },
    o,
  );
  if (type === 'mousedown') { g.el('ov').dispatchEvent(ev); return; }
  for (const fn of (g.win._l && g.win._l[type]) || []) fn(ev);
}
function drag(g, button, x0, y0, x1, y1) {
  mouse(g, 'mousedown', { button, clientX: x0, clientY: y0 });
  mouse(g, 'mousemove', { clientX: (x0 + x1) / 2, clientY: (y0 + y1) / 2 });
  mouse(g, 'mousemove', { clientX: x1, clientY: y1 });
  mouse(g, 'mouseup', {});
}

function battle(budget) {
  const g = loadGame({ quiet: true });
  g.all('#mapPick [data-map="villages"]')[0].click();
  g.hook('seed')(4242);
  g.all('#startVeil [data-budget="' + (budget || 999999) + '"]')[0].click();
  g.el('autoDep').click();
  g.el('startBattle').click();
  g.frames(120);
  return g;
}

// Camera shake must punch and settle. It used to SUM every blast into a running
// total capped at 14px, which pinned there in any real battle and read as a fast
// vibration; one damped impulse means the biggest nearby blast wins instead.
{
  const g = battle();
  g.frames(400);
  let peak = 0, still = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    g.frame();
    const v = g.hook('shake')();
    if (v > peak) peak = v;
    if (v < 0.05) still++;
  }
  const problems = [];
  if (peak > 7) problems.push('shake peaked at ' + peak.toFixed(1) + 'px - too violent for a phone');
  if (still < N * 0.1) problems.push('the camera is never at rest (' + still + '/' + N + ' frames) - it is vibrating');
  if (problems.length) bad('screen shake punches and settles', problems.join(BR));
  else ok('screen shake punches and settles',
    'peak ' + peak.toFixed(1) + 'px, still for ' + Math.round(still / N * 100) + '% of frames');
}

// A finger has to be able to do what a mouse drag does. Quick drag still pans;
// hold-then-drag, or the Select button, draws a selection box instead.
{
  const problems = [];
  {                                             // a quick drag still pans the camera
    const g = battle();
    const before = g.hook('cam')();
    touch(g, 300, 300, 'touchstart'); g.frame();
    touch(g, 600, 400, 'touchmove'); g.frame();
    touch(g, 0, 0, 'touchend');
    const after = g.hook('cam')();
    if (Math.abs(after.x - before.x) < 50) problems.push('a quick drag no longer pans the camera');
    if (g.hook('nsel')() !== 0) problems.push('a quick drag selected units - panning is broken');
  }
  {                                             // hold, then drag: a selection box
    const g = battle();
    touch(g, 60, 120, 'touchstart');
    g.frames(30);                               // half a second of stillness
    touch(g, 1220, 700, 'touchmove'); g.frame();
    touch(g, 0, 0, 'touchend');
    if (g.hook('nsel')() < 2) problems.push('hold-then-drag selected ' + g.hook('nsel')() + ' units, expected several');
  }
  {                                             // Select button: drag straight away
    const g = battle();
    g.el('selBtn').click();
    touch(g, 60, 120, 'touchstart'); g.frame();
    touch(g, 1220, 700, 'touchmove'); g.frame();
    touch(g, 0, 0, 'touchend');
    if (g.hook('nsel')() < 2) problems.push('Select mode selected ' + g.hook('nsel')() + ' units, expected several');
  }
  if (problems.length) bad('a finger can select several units', problems.join(BR));
  else ok('a finger can select several units', 'quick drag pans, hold-drag and Select mode box-select');
}

// Tapping bare ground before choosing anything to buy.
//
// This is the first thing a player does on a fresh match, and it took the live
// site down: the DEPLOY handler called place() without checking that anything
// had been picked from the deck - the BATTLE handler checks, deploy did not -
// and place() went straight into unlocked(team, null), where reqLvl read
// UNITS[null].lvl and threw. The red bar came up over an empty battlefield
// before the player had done anything at all.
{
  const problems = [];
  const g = loadGame({ quiet: true });
  g.all('#mapPick [data-map="villages"]')[0].click();
  g.all('#startVeil [data-budget="2000"]')[0].click();
  if (g.hook('worldview')().phase !== 'deploy') problems.push('the match did not stop in deploy to be tapped');
  const before = g.hook('worldview')().squads.length;
  // Ground inside our own deployment zone, so these are taps that WOULD have
  // bought something had anything been chosen - not taps the engine was going
  // to turn away anyway.
  const SPOTS = [[500, 350], [420, 260]];
  for (const [x, y] of SPOTS) {
    touch(g, x, y, 'touchstart');
    touch(g, 0, 0, 'touchend'); g.frame();
  }
  if (g.fault()) problems.push('tapping the field threw: ' + g.fault().split(BR)[1]);
  const after = g.hook('worldview')().squads.length;
  if (after !== before) problems.push('a tap with nothing chosen deployed ' + (after - before) + ' units anyway');
  // and with something chosen the very same tap still buys, so the guard has
  // not quietly killed deployment along with the crash
  const card = g.all('#pal .card')[0];
  if (!card) problems.push('the deck offers nothing to buy in deploy');
  else card.click();
  touch(g, SPOTS[0][0], SPOTS[0][1], 'touchstart');
  touch(g, 0, 0, 'touchend'); g.frame();
  if (g.fault()) problems.push('buying after the guard threw: ' + g.fault().split(BR)[1]);
  if (g.hook('worldview')().squads.length <= before)
    problems.push('nothing could be deployed once a unit HAD been chosen');
  if (problems.length) bad('tapping the ground before buying anything is harmless', problems.join(BR));
  else ok('tapping the ground before buying anything is harmless', 'three taps on bare ground, then a real one');
}

/* ------------------------------------------------------------------ */
/* 7. SAVES - a battle put down and picked up again                    */
/* ------------------------------------------------------------------ */
head('7. SAVES  (saved in one process, loaded in another)');
const SAVERUN = path.join(__dirname, 'saverun.js');
const SAVE_TICKS = FAST ? 300 : 900;
const SAVE_MORE = FAST ? 300 : 600;

function saverun(args) {
  const out = execFileSync(process.execPath, [SAVERUN].concat(args),
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  return JSON.parse(out.trim().split('\n').pop());
}

for (const map of FAST ? ['villages'] : MAPS) {
  const file = path.join(os.tmpdir(), 'iron-front-save-' + map + '.json');
  let wrote, read;
  try {
    wrote = saverun(['--seed', '4242', '--map', map, '--budget', '2000',
      '--ticks', String(SAVE_TICKS), '--more', String(SAVE_MORE), '--out', file]);
    read = saverun(['--load', file, '--more', String(SAVE_MORE)]);
  } catch (e) {
    bad(map + ': a saved battle comes back and carries on', (e.stdout || '') + (e.stderr || '') || e.message);
    continue;
  }
  const problems = [];
  if (!wrote.ok) problems.push('saving: ' + wrote.error);
  if (!read.ok) problems.push('loading: ' + read.error);
  if (wrote.ok && read.ok) {
    if (wrote.at !== read.at) {
      problems.push('the battle came back different: stateHash ' + wrote.at + ' saved, ' + read.at + ' loaded');
    }
    if (wrote.rngAt !== read.rngAt) problems.push('the RNG came back at ' + read.rngAt + ', not ' + wrote.rngAt);
    if (wrote.after !== read.after) {
      problems.push('after ' + SAVE_MORE + ' more ticks: ' + wrote.after + ' vs ' + read.after
        + ' - the loaded battle took a different road');
    }
    if (read.fault) problems.push('draw fault after loading: ' + read.fault);
  }
  if (problems.length) bad(map + ': a saved battle comes back and carries on', problems.join(BR));
  else ok(map + ': a saved battle comes back and carries on',
    Math.round(wrote.bytes / 1024) + 'KB, exact at the save point and ' + SAVE_MORE + ' ticks later');
  try { fs.unlinkSync(file); } catch { /* the temp file is not worth failing over */ }
}

// The slots themselves: eight manual saves, the autosave on top, and deleting
// one gives the slot back.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(11);
  startMatch(g, 'villages', 300);
  g.hook('tick')(60);
  const results = [];
  for (let i = 0; i < 9; i++) results.push(g.hook('save')(null).ok);
  const filled = results.filter(Boolean).length;
  const listed = g.hook('saves')().length;
  const afterDrop = g.hook('dropSave')(g.hook('saves')()[0]);
  const reused = g.hook('save')(null).ok;
  const problems = [];
  if (filled !== 8) problems.push('nine saves filled ' + filled + ' slots, expected 8');
  if (results[8]) problems.push('the ninth save was accepted - the slot limit does not hold');
  if (listed !== 8) problems.push('the list shows ' + listed + ' saves, expected 8');
  if (afterDrop !== 7) problems.push('deleting one left ' + afterDrop + ' saves, expected 7');
  if (!reused) problems.push('the freed slot could not be used again');
  if (problems.length) bad('eight slots, and deleting one frees it', problems.join(BR));
  else ok('eight slots, and deleting one frees it', '9 attempts, 8 kept');
}

// A record this build cannot read must be refused, and refusing must leave the
// player somewhere sane rather than in a half-loaded battle.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(12);
  startMatch(g, 'villages', 300);
  g.hook('tick')(60);
  const problems = [];
  g.win.localStorage.setItem('ironfront:save:alien',
    JSON.stringify({ v: 99, id: 'alien', at: 1, meta: { map: 'Nowhere' }, state: { v: 99 } }));
  g.win.localStorage.setItem('ironfront:saves', JSON.stringify([{ id: 'alien', at: 1, meta: { map: 'Nowhere' } }]));
  let threw = null;
  let taken = null;
  try { taken = g.hook('load')('alien'); } catch (e) { threw = e; }
  if (threw) problems.push('loading a foreign record threw: ' + threw.message);
  if (taken) problems.push('a record from another build was accepted');
  // and the same through the screen the player actually uses
  g.el('mLoad').click();
  g.win.localStorage.setItem('ironfront:save:broken',
    JSON.stringify({ v: 1, id: 'broken', at: 2, meta: { map: 'Nowhere' }, state: { v: 1, map: 'nowhere', squads: [], tg: [] } }));
  g.win.localStorage.setItem('ironfront:saves', JSON.stringify([{ id: 'broken', at: 2, meta: { map: 'Nowhere' } }]));
  g.el('mLoad').click();
  const row = g.all('#saveList .slot button')[0];
  try { if (row) row.click(); } catch (e) { problems.push('a broken save threw on load: ' + e.message); }
  g.frames(3);
  if (g.fault()) problems.push('draw fault after a refused load: ' + g.fault());
  if (g.el('startVeil').style.display !== 'flex') {
    problems.push('a refused load left the player nowhere: startVeil is ' + g.el('startVeil').style.display);
  }
  if (problems.length) bad('an unreadable save is refused, not half-loaded', problems.join(BR));
  else ok('an unreadable save is refused, not half-loaded', 'foreign version and broken record both turned away');
}

// The whole round trip through the buttons a player actually presses.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(13);
  startMatch(g, 'city', 2000);
  g.hook('tick')(600);
  const before = g.hook('hash')();
  const problems = [];
  g.el('menuBtn').click();                      // pause
  g.el('mSave').click();                        // -> the save screen
  g.el('saveNew').click();                      // -> a new slot
  if (!g.all('#saveList .slot').length) problems.push('the save screen lists nothing after saving');
  g.el('saveClose').click();
  g.el('mResume').click();
  g.hook('tick')(300);                          // fight on, so the load has to undo something
  if (g.hook('hash')() === before) problems.push('the battle did not move on after saving');
  g.el('menuBtn').click();
  g.el('mLoad').click();
  const row = g.all('#saveList .slot button')[0];
  if (!row) problems.push('nothing to load');
  else row.click();
  // read the hash before any frame runs: a frame would tick the battle on
  const restored = g.hook('hash')();
  g.frames(3);
  if (restored !== before) problems.push('loading did not put the battle back where it was');
  if (g.el('saveVeil').style.display !== 'none') problems.push('the save screen stayed open after loading');
  if (g.el('menuVeil').style.display !== 'none') problems.push('the game came back paused');
  if (g.fault()) problems.push('draw fault after loading: ' + g.fault());
  if (problems.length) bad('save and load through the menu', problems.join(BR));
  else ok('save and load through the menu', 'paused, saved, fought on, loaded back to the same state');
}

/* ------------------------------------------------------------------ */
/* 8. TERRAIN - the battlefield model, and the battle reading it       */
/* ------------------------------------------------------------------ */
head('8. TERRAIN');

// Generation in an order: height, then the water that runs off it, then the
// roads that avoid the steep ground, then the wood that grows where the water
// went. Each one a consequence of the last, which is the thing that can be
// checked - unlike whether it looks nice.
{
  let out = null;
  try {
    out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'mapgenrun.mjs')],
      { encoding: 'utf8' }).trim().split(BR).pop());
  } catch (e) {
    bad('the map is generated in an order, not decorated', (e.stdout || '') + (e.stderr || '') || e.message);
  }
  if (out) {
    if (out.ok) ok('the map is generated in an order, not decorated', out.checks + ' assertions on ground with a right answer');
    else bad('the map is generated in an order, not decorated', out.fails.join(BR));
  }
}

// The model itself, on ground built by hand, in its own process. It imports
// src/world/terrain.js directly - no DOM, no engine - which is only possible
// because the model has no idea any of that exists.
{
  let out = null;
  try {
    out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'terrainrun.mjs')],
      { encoding: 'utf8' }).trim().split('\n').pop());
  } catch (e) {
    bad('the terrain model answers correctly', (e.stdout || '') + (e.stderr || '') || e.message);
  }
  if (out) {
    if (out.ok) ok('the terrain model answers correctly', out.checks + ' assertions on hand-built ground');
    else bad('the terrain model answers correctly', out.fails.join(BR));
  }
}

function ground(map) {
  const g = loadGame({ quiet: true });
  g.all('#mapPick [data-map="' + map + '"]')[0].click();
  g.hook('seed')(4242);
  g.all('#startVeil [data-budget="2000"]')[0].click();
  g.el('autoDep').click();
  g.el('startBattle').click();
  return g;
}

// A road is ground you can drive on, not a line painted on the ground. Every
// battlefield lays some, and armour must actually go faster along it.
{
  const problems = [];
  let metalled = 0;
  for (const map of MAPS) {
    const g = ground(map);
    const road = g.hook('ground')('road');
    if (!road.n) { problems.push(map + ': no road cells at all'); continue; }
    if (g.hook('cell')(road.x, road.y).surface !== 'road') {
      problems.push(map + ': a road cell does not read as a road');
    }
    // A track over rock is still rock underneath, so judge the promise that a
    // road carries armour on a cell that is nothing BUT road.
    const clean = g.hook('ground')('road', true);
    if (clean.x < 0) continue;
    metalled++;
    const c = g.hook('cell')(clean.x, clean.y);
    if (!(c.move[1] > 1) || c.move[1] <= c.move[0]) {
      problems.push(map + ': open road does not carry armour (' + c.move.slice(0, 3).join('/') + ')');
    }
  }
  if (metalled < 3) problems.push('only ' + metalled + ' of five battlefields have open road');
  if (problems.length) bad('every battlefield is laid with roads that carry armour', problems.join(BR));
  else ok('every battlefield is laid with roads that carry armour');
}

// A house that comes down leaves ground that behaves like rubble: men shelter
// in it, armour has to go round.
{
  const g = ground('city');
  const b = g.hook('aBuilding')();
  const problems = [];
  if (!b) problems.push('the city has no buildings to knock down');
  else {
    const before = g.hook('cell')(b.x, b.y);
    g.hook('raze')(b.x, b.y);
    const after = g.hook('cell')(b.x, b.y);
    if (before.surface !== 'build') problems.push('the building cell did not read as a building: ' + before.surface);
    if (after.surface !== 'rubble') problems.push('a collapsed building left ' + after.surface + ', not rubble');
    if (after.hardFoot) problems.push('rubble shut infantry out');
    if (!after.hardMounted) problems.push('rubble let armour drive through it');
    if (!(after.cover < 1)) problems.push('rubble gave no cover');
    g.frames(4);
    if (g.fault()) problems.push('draw fault after a collapse: ' + g.fault());
  }
  if (problems.length) bad('a collapsed building leaves rubble that behaves like rubble', problems.join(BR));
  else ok('a collapsed building leaves rubble that behaves like rubble');
}

// What the info line tells the player has to be what the simulation is using.
// One model, read by both, or the ground lies about itself.
{
  const g = ground('villages');
  const problems = [];
  let checked = 0;
  for (const key of ['wood', 'crop', 'stone', 'water', 'road']) {
    // one thing at a time: a village cell is often a building cell too, and
    // then 'inside a building' is the right answer, not 'in the village'
    const spot = g.hook('ground')(key, true);
    if (spot.x < 0) continue;
    checked++;
    const c = g.hook('cell')(spot.x, spot.y);
    const said = g.hook('name')(spot.x, spot.y);
    if (c.surface !== key) problems.push(key + ' ground reads as ' + c.surface);
    if (said !== c.name) problems.push(key + ': the info line says "' + said + '", the model says "' + c.name + '"');
  }
  if (checked < 3) problems.push('only ' + checked + ' ground types found to check');
  if (problems.length) bad('what the player is told is what the simulation is using', problems.join(BR));
  else ok('what the player is told is what the simulation is using', checked + ' ground types agree');
}

// Sight lines have to come off the same ground everyone is standing on.
{
  const g = ground('villages');
  const problems = [];
  const wood = g.hook('ground')('wood', true);
  if (wood.x < 0) problems.push('no open wood to sight through');
  else {
    if (!g.hook('cell')(wood.x, wood.y).blind) problems.push('a wood is not marked as blocking sight');
    if (g.hook('los')(wood.x - 60, wood.y, wood.x + 60, wood.y, 0)) {
      problems.push('a sight line ran straight through a wood');
    }
    // inside one cell nobody argues about a sight line
    if (!g.hook('los')(wood.x - 4, wood.y, wood.x + 4, wood.y, 0)) {
      problems.push('a cell blocked a sight line inside itself');
    }
  }
  if (!g.hook('los')(80, 60, 400, 60, 0)) problems.push('open ground near the corner blocked a sight line');
  if (problems.length) bad('sight lines are cast against the real ground', problems.join(BR));
  else ok('sight lines are cast against the real ground');
}

// One battlefield has to be different from the next.
//
// For a long time it was not, and no amount of work on how the ground LOOKED
// could change that, because the layout was not generated at all: the crossings
// were rebuilt as [ford, bridge, ford] at the three sector rows every match, so
// there was always exactly one bridge and it was always the middle sector -
// measured, it landed on the same row in eleven runs out of twelve - and the
// river was clamped to the middle third and then pulled to the centre on top of
// that, so it never left the middle fifth of a five-kilometre map.
//
// This is the check that says the map is actually being made. It reads the
// ground itself - where the river runs and where it can be walked across -
// rather than any internal table, so it cannot be satisfied by a variable that
// merely exists.
{
  const problems = [];
  const seen = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = loadGame({ quiet: true });
    g.all('#mapPick [data-map="villages"]')[0].click();
    g.hook('seed')(seed);
    g.all('#startVeil [data-budget="2000"]')[0].click();
    g.el('autoDep').click();
    g.el('startBattle').click();
    const t = g.hook('terrain')();
    const river = (y) => g.hook('river')(y);
    const wet = (y) => /river|water/i.test((g.hook('cell')(river(y), y).name) || '');
    const ford = (y) => /ford/i.test((g.hook('cell')(river(y), y).name) || '');
    const cross = [];
    let run = null;
    for (let y = 30; y < t.H; y += 30) {
      if (!wet(y)) { if (!run) run = { y0: y, y1: y, f: ford(y) }; else { run.y1 = y; run.f = run.f || ford(y); } }
      else if (run) { cross.push(run); run = null; }
    }
    if (run) cross.push(run);
    const xs = [];
    for (let y = 0; y <= t.H; y += t.H / 12) xs.push(river(y));
    const swing = Math.max(...xs) - Math.min(...xs);
    if (!cross.length) problems.push('seed ' + seed + ': the river cannot be crossed anywhere');
    // Fair, still: every crossing needs its mirror image, or one side has the
    // shorter way round and the ground decides the battle.
    for (const c of cross) {
      const mid = (c.y0 + c.y1) / 2;
      if (!cross.some((o) => Math.abs((o.y0 + o.y1) / 2 - (t.H - mid)) < 90))
        problems.push('seed ' + seed + ': the crossing at ' + Math.round(mid) + ' has no mirror - the map is unfair');
    }
    seen.push({ seed, swing, sig: cross.map((c) => Math.round((c.y0 + c.y1) / 200) + (c.f ? 'f' : 'B')).join(',') });
  }
  const sigs = new Set(seen.map((s2) => s2.sig));
  const kinds = new Set(seen.map((s2) => s2.sig.replace(/[0-9]/g, '')));
  const counts = new Set(seen.map((s2) => s2.sig.split(',').length));
  const swing = Math.max(...seen.map((s2) => s2.swing));
  if (sigs.size < 3) problems.push('six seeds produced only ' + sigs.size + ' layouts - the map is not being generated');
  if (kinds.size < 2) problems.push('the crossings are the same kinds every match (' + [...kinds][0] + ')');
  if (counts.size < 2) problems.push('there are always exactly ' + [...counts][0] + ' crossings');
  if (swing < 700) problems.push('the river only wanders ' + Math.round(swing) + ' units across the map');
  if (problems.length) bad('one battlefield is not the next one', problems.join(BR));
  else ok('one battlefield is not the next one',
    sigs.size + ' layouts in 6 seeds, ' + [...counts].sort().join('/') + ' crossings, river wanders ' + Math.round(swing));
}

/* ------------------------------------------------------------------ */
/* 9. RENDERERS - two ways of drawing the same battle                  */
/* ------------------------------------------------------------------ */
head('9. RENDERERS');

// The 3D ground, in its own process. three.js builds geometry in node happily —
// it only needs a browser to draw — so the thing most likely to be silently
// wrong, whether the mesh lies over the battlefield the right way round, can be
// proved here rather than squinted at in a screenshot.
{
  let out = null;
  try {
    out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'terrain3drun.mjs')],
      { encoding: 'utf8' }).trim().split('\n').pop());
  } catch (e) {
    bad('the 3D ground is laid over the battlefield correctly', (e.stdout || '') + (e.stderr || '') || e.message);
  }
  if (out) {
    if (out.ok) ok('the 3D ground is laid over the battlefield correctly', out.checks + ' assertions, no screen needed');
    else bad('the 3D ground is laid over the battlefield correctly', out.fails.join(BR));
  }
}

// A device with no WebGL must be told so and left playing, not left staring at
// a blank canvas. The harness is exactly such a device.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(7);
  startMatch(g, 'villages', 2000);
  g.frames(30);
  const problems = [];
  const btn = g.el('mView');
  if (!btn) problems.push('no view toggle in the pause menu');
  else {
    if (!/top-down/i.test(btn.textContent)) problems.push('the toggle does not start on the top-down view: ' + btn.textContent);
    btn.click();
    g.frames(6);
    if (g.fault()) problems.push('switching to 3D without WebGL threw: ' + g.fault());
    if (g.el('cv').style.display === 'none') problems.push('the 2D battlefield was hidden with nothing to replace it');
    if (g.el('gl').style.display === 'block') problems.push('the 3D canvas was shown on a device that cannot draw it');
    // and the game must still be running
    const before = g.hook('hash')();
    g.hook('tick')(120);
    if (g.hook('hash')() === before) problems.push('the battle stopped after the refused switch');
  }
  if (problems.length) bad('a device without WebGL is refused the 3D view and keeps playing', problems.join(BR));
  else ok('a device without WebGL is refused the 3D view and keeps playing');
}

// The two renderers must be reading one world, not two. Nothing the 3D view is
// handed may be a copy, or it would go stale the moment the battle moved.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(9);
  startMatch(g, 'city', 2000);
  g.hook('tick')(300);
  const problems = [];
  const v = g.hook('worldview') ? g.hook('worldview')() : null;
  if (!v) problems.push('no world view to hand a renderer');
  else {
    if (v.terrain !== g.hook('terrain')()) problems.push('the 3D view would read a different terrain from the simulation');
    if (!v.squads || !v.squads.length) problems.push('the world view carries no squads');
    if (typeof v.showsTeam !== 'function') problems.push('the world view cannot say which side is watching');
    const n = v.squads.length;
    g.hook('tick')(300);
    if (g.hook('worldview')().squads !== v.squads) problems.push('the squad list was copied, so the 3D view would go stale');
    if (v.squads.length < n) problems.push('squads vanished from under the renderer');
  }
  if (problems.length) bad('both renderers read one world', problems.join(BR));
  else ok('both renderers read one world', 'terrain, squads and vision are shared, not copied');
}


// The 3D renderer, driven against a real battle in its own process. Everything
// but the final draw call is arithmetic, and three.js does arithmetic in node,
// so the code that runs sixty times a second in front of a player runs here too.
{
  let out = null;
  try {
    out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'render3drun.mjs')],
      { encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').pop());
  } catch (e) {
    bad('the 3D renderer survives a real battle', (e.stdout || '') + (e.stderr || '') || e.message);
  }
  if (out) {
    if (out.ok) ok('the 3D renderer survives a real battle', (out.notes || []).join('; ') || out.frames + ' frames');
    else bad('the 3D renderer survives a real battle', out.fails.join(BR));
  }
}

// The engine's own 3D path — the overlay, the strength chips, the minimap on its
// own canvas — with a renderer that answers like the real one and draws nothing.
// None of this code is reachable in the 2D path, so nothing else covers it.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(4242);
  startMatch(g, 'villages', 2000);
  const problems = [];
  if (!g.hook('fake3d')(true)) problems.push('the stub renderer would not start');
  g.frames(6);
  if (g.fault()) problems.push('drawing the 3D frame threw: ' + g.fault().split(BR)[1]);
  if (g.el('ov').style.display !== 'block') problems.push('the overlay canvas is not showing');
  if (g.el('cv').style.display !== 'none') problems.push('the top-down canvas is still showing under it');
  g.hook('sel')();                                  // something selected draws order lines
  g.hook('tick')(600);
  g.frames(6);
  if (g.fault()) problems.push('drawing orders in 3D threw: ' + g.fault().split(BR)[1]);
  if (problems.length) bad('the 3D frame path draws without throwing', problems.join(BR));
  else ok('the 3D frame path draws without throwing', 'overlay, orders, chips and minimap');
}

// And when it does throw — a driver fault, a device that lied about WebGL — the
// battle must survive it. This is the one that matters: a renderer is a way of
// looking at a match, not the match.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(4242);
  startMatch(g, 'villages', 2000);
  const problems = [];
  g.hook('fake3d')('break');
  g.frames(3);
  if (!g.fault()) problems.push('a renderer that threw was never reported');
  if (g.el('cv').style.display === 'none') problems.push('the game did not fall back to the map');
  const before = g.hook('hash')();
  g.hook('tick')(120);
  if (g.hook('hash')() === before) problems.push('the battle stopped');
  if (g.frames(20) !== 20) problems.push('the animation loop stopped asking for frames');
  if (problems.length) bad('a renderer that fails hands the battle back to the map', problems.join(BR));
  else ok('a renderer that fails hands the battle back to the map', 'reported once, fell back, kept playing');
}


// The renderer may not spend the simulation's randomness.
//
// This is rule one, and it was being broken in nine places: a burning wreck, a
// helicopter's downwash, a tank's exhaust, a shell's smoke trail and the
// rubble of a fallen keep all drew their numbers from R(), the seeded stream
// both machines in a match replay. How many frames a player's machine managed,
// and whether they were watching the map or the field, decided where that
// stream went next - a desync with no way back, and invisible until it bites.
//
// So: pause a battle that has men down and shells in the air, draw a hundred
// and twenty frames, and nothing about the match may have moved.
{
  // A rich battle, so that armour, aircraft, shells in flight, burning wrecks
  // and a fallen keep are all on the field at once: every one of them had a
  // hand in the shared stream, and a poor battle would prove nothing.
  const g = loadGame({ quiet: true });
  g.hook('seed')(4242);
  startMatch(g, 'villages', 999999);
  g.hook('tick')(FAST ? 1200 : 3000);
  const problems = [];
  g.frames(2);
  // Zoomed out, a squad is one marker and none of the detailed drawing runs at
  // all. The camera has to be down among the men, where the exhaust, the smoke
  // and the burning wrecks are actually painted, or this proves nothing.
  const v = g.hook('worldview')();
  const at = v.bodies[0] || v.squads.find(sq => !sq.gone) || { x: 2600, y: 1650, fx: 2600, fy: 1650 };
  g.hook('look')(at.x === undefined ? at.fx : at.x, at.y === undefined ? at.fy : at.y, 1.2);
  g.hook('pause')();
  const rng = g.hook('rng')();
  const hash = g.hook('hash')();
  let drew = g.frames(60);
  g.hook('look')(2600, 1650, 0.6);                // and again from further back
  drew += g.frames(60);
  if (drew < 120) problems.push('the animation loop stopped after ' + drew + ' frames');
  if (g.fault()) problems.push('drawing threw: ' + g.fault().split(BR)[1]);
  if (g.hook('rng')() !== rng)
    problems.push('drawing moved the shared random stream on: ' + rng + ' became ' + g.hook('rng')());
  if (g.hook('hash')() !== hash) problems.push('drawing changed the state of the match');
  if (problems.length) bad('drawing a frame never touches the simulation', problems.join(BR));
  else ok('drawing a frame never touches the simulation', '120 frames close in and far back, the stream unmoved');
}

// The fog of war, the marks in the ground and the dead are three things the map
// has always drawn and the 3D field could not see. They reach it the way
// everything else does - by reference, through the one world view.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(4242);
  // Fought at full strength on purpose. At a small budget the two sides can
  // fail to meet at all inside the window - thinning the woods was enough to
  // stop anybody dying - and then this says nothing about whether the dead
  // reach the renderer, which is the only thing it is here to ask.
  startMatch(g, 'villages', 999999);
  g.hook('tick')(900);
  g.frames(3);                                    // what can see is worked out per frame
  const problems = [];
  const v = g.hook('worldview')();
  if (!v.eyes || !v.eyes.length) problems.push('the 3D view is not told what can see');
  else if (v.eyes.length % 3) problems.push('the eyes are not x, y and range');
  if (!v.decal) problems.push('the 3D view is not offered the sheet the marks are painted on');
  if (!(v.decalV > 0)) problems.push('nothing has been painted into the ground after 900 ticks');
  if (!Array.isArray(v.bodies)) problems.push('the 3D view cannot see the dead');
  const before = v.decalV;
  g.hook('tick')(600);
  const after = g.hook('worldview')();
  if (after.decal !== v.decal) problems.push('the decal sheet was copied, so the 3D ground would go stale');
  if (!(after.decalV > before)) problems.push('the count of marks never moves, so the ground would never be resent');
  // The dead have to be cleared as well as laid out. If they were only ever
  // pushed, a long battle would hand the renderer a longer list every frame
  // until the field was nothing but corpses.
  //
  // Watched by IDENTITY rather than by count. Asking for the count to fall at
  // one of twenty sample points sounds like the same question and is not: while
  // men are dying faster than the fallen rot away the total only climbs, so the
  // check was really asking "does the battle happen to lull", and it broke the
  // day the woods were thinned and the fighting got quicker. What actually has
  // to be true is that a body laid down now is gone later, and that the list is
  // capped however hard the battle goes.
  let most = 0;
  let cleared = false;
  const seen = new Set(after.bodies);
  for (let i = 0; i < 20; i++) {
    g.hook('tick')(120);
    const now = g.hook('worldview')().bodies;
    if (now.length > most) most = now.length;
    const here = new Set(now);
    for (const b of seen) if (!here.has(b)) { cleared = true; break; }
    for (const b of now) seen.add(b);
  }
  if (!most) problems.push('nobody died in forty seconds of battle');
  if (!cleared) problems.push('no body was ever taken off the field - the dead only accumulate');
  if (most > 240) problems.push(most + ' bodies on the field at once, past the cap of 240');
  if (problems.length) bad('the 3D field is told about the fog, the marks and the dead', problems.join(BR));
  else ok('the 3D field is told about the fog, the marks and the dead', 'by reference; the dead are laid out and cleared');
}

// A player who was here before the 3D battlefield was.
//
// The view is remembered, and it was being remembered from before there was
// anything to remember it about: a profile made when the top-down map was the
// only thing there is came back pinned to it, and every battlefield built since
// - the ground, the weather, the men walking on it - sat behind a button in a
// menu nobody had a reason to open. It is the difference between shipping the
// game and shipping it to somebody who can see it.
{
  const problems = [];
  // The seed is copied into the game's own storage, so what it wrote back has
  // to be read from there and not from the object it was handed.
  const view = (store) => {
    const g = loadGame({ quiet: true, storage: store });
    return { want: g.hook('viewwant')(), got: (k) => g.win.localStorage.getItem('ironfront:' + k) };
  };
  const old = view({ 'ironfront:view': JSON.stringify('top') });
  if (old.want !== '3d') problems.push('a profile from before the field is still pinned to the map');
  if (old.got('sawField') !== 'true') problems.push('the field was shown without leaving a mark, so it would be forced again every load');
  // and having been shown it once, choosing the map is a choice that sticks
  const chose = view({ 'ironfront:view': JSON.stringify('top'), 'ironfront:sawField': 'true' });
  if (chose.want !== 'top') problems.push('a player who wants the map is overridden anyway');
  // a new player gets the field, as they always did
  if (view({}).want !== '3d') problems.push('a new player no longer starts on the field');
  // and one already on it is left alone
  if (view({ 'ironfront:view': JSON.stringify('3d') }).want !== '3d') problems.push('a player on the field was moved off it');
  if (problems.length) bad('an old profile does not hide the battlefield', problems.join(BR));
  else ok('an old profile does not hide the battlefield', 'shown once, and the map sticks if it is then chosen');
}

// Walking round the field. The map has one bearing and always did; the 3D
// camera has whichever one the player has turned to, and every way of turning
// it has to reach the renderer - while the flat map is left exactly as it was.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(4242);
  startMatch(g, 'villages', 2000);
  const problems = [];
  if (!g.hook('fake3d')(true)) problems.push('the stub renderer would not start');
  const cam = () => g.hook('gfx3')();
  if (cam().yaw !== 0) problems.push('the camera does not start square to the field');
  key(g, ']');
  key(g, ']');
  if (!(cam().yaw > 0)) problems.push('the keys do not turn the camera');
  key(g, ',');
  if (!(cam().pitch < 0.86)) problems.push('the keys do not lower the eye');
  // clamped at both ends: nobody may lie down on the horizon or stare straight down
  for (let i = 0; i < 60; i++) key(g, ',');
  if (cam().pitch < 0.29) problems.push('the eye sank below the horizon');
  for (let i = 0; i < 60; i++) key(g, '.');
  if (cam().pitch > 1.45) problems.push('the eye went past straight down');
  g.el('zlook').click();
  if (cam().yaw !== 0 || cam().pitch !== 0.86) problems.push('the compass did not square the camera up');
  if (g.el('zlook').style.display !== 'block') problems.push('the compass is hidden while the field is showing');
  // a right-button drag walks round the field and does NOT shove the map
  const was = g.hook('cam')();
  drag(g, 2, 400, 300, 640, 340);
  if (!(cam().yaw > 0)) problems.push('a right-button drag did not walk the camera round');
  if (Math.abs(g.hook('cam')().x - was.x) > 0.001) problems.push('a right-button drag shoved the map as well');
  // and over the map, the same drag still pans, exactly as it always did
  g.hook('fake3d')(false);
  const flat = g.hook('cam')();
  drag(g, 2, 400, 300, 640, 340);
  if (Math.abs(g.hook('cam')().x - flat.x) < 100) problems.push('the same drag no longer pans the flat map');
  if (g.el('zlook').style.display !== 'none') problems.push('the compass is still showing over the map');
  if (problems.length) bad('the camera can be walked round the field', problems.join(BR));
  else ok('the camera can be walked round the field', 'keys, right-drag and the compass; the map untouched');
}

// A selection box has to be drawn against what is ON SCREEN. The flat map's
// projection is a scale and an offset; the 3D one is a perspective from
// wherever the player has walked to, and the two stop agreeing the moment the
// camera tilts - which it always was. The stub renderer deliberately puts the
// field somewhere the map does not, so a box in the wrong place cannot pass by
// luck.
{
  const g = loadGame({ quiet: true });
  g.hook('seed')(4242);
  startMatch(g, 'villages', 2000);
  const problems = [];
  g.hook('fake3d')(true);
  const OFF = g.hook('fake3doff')();
  if (OFF < 120) problems.push('the stub renderer projects too close to the map for this to prove anything');
  const v = g.hook('worldview')();
  // somebody of ours, clear of the minimap in both projections
  const mine = v.squads.filter(sq => {
    if (sq.team !== v.viewTeam || sq.gone) return false;
    const p = g.hook('w2s')(sq.fx, sq.fy);
    return p.x > 400 && p.x < 1100 && p.y > 340 && p.y < 640;
  });
  if (!mine.length) problems.push('nobody of ours is on screen to box');
  else {
    const p = g.hook('w2s')(mine[0].fx, mine[0].fy);
    const box = (cx, cy) => {
      g.hook('deselect')();                       // start from nothing selected
      drag(g, 0, cx - 70, cy - 70, cx + 70, cy + 70);
      return g.hook('nsel')();
    };
    if (!box(p.x, p.y)) problems.push('a box drawn where the renderer says the unit is selected nobody');
    if (box(p.x - OFF, p.y)) problems.push('a box drawn where the flat map says the unit is still selected it');
  }
  if (problems.length) bad('a selection box follows the view the player is looking at', problems.join(BR));
  else ok('a selection box follows the view the player is looking at', 'boxed by the renderer, not by the map');
}

/* ------------------------------------------------------------------ */
console.log('\n' + (failures
  ? C.r(failures + ' of ' + checks + ' checks failed')
  : C.g('all ' + checks + ' checks passed')));
process.exit(failures ? 1 : 0);
