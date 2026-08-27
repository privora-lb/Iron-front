// The battlefield model, tested on ground built by hand.
//
// src/world/terrain.js has no DOM, no canvas and no simulation in it, so it can
// be imported straight into node and asked questions about a battlefield laid
// out on purpose — a wood here, a building there, a hill behind. That is worth
// more than probing a generated map, where you never quite know what else is in
// the way, and it is the reason the model was pulled out of the engine at all.
//
// Prints one JSON line: { ok, fails: [...] }.
import { UNITS } from '../src/data/units.js';
import { GROUND, MOB, MOBNAME } from '../src/data/ground.js';
import {
  makeTerrain, idx, moveMul, coverAt, hideAt, hardAt, sightClear, sightRange,
  surfaceAt, describe, cellAt, stampLine, stampBlob, mobilityOf,
  WOOD, BUILD, CLIFF, WIRED, TRENCHED, ROAD, RUBBLE, WATER, STONE, FIELD,
} from '../src/world/terrain.js';

const fails = [];
const near = (a, b) => Math.abs(a - b) < 1e-9;
const ok = (cond, what, got) => { if (!cond) fails.push(what + (got === undefined ? '' : ' — got ' + JSON.stringify(got))); };

// A small, empty battlefield: 100 cells across, 40 down, 20 units to a cell.
const TG = 20;
const t = makeTerrain(2000, 800, TG);
const cell = (gx, gy) => gy * t.TW + gx;
const wx = (gx) => gx * TG + TG / 2;
const wy = (gy) => gy * TG + TG / 2;

/* ---- open ground costs nothing and hides nobody ---- */
for (const m of [MOB.foot, MOB.vehicle, MOB.gun, MOB.air]) {
  ok(moveMul(t, 500, 400, m) === 1, 'open ground should not slow ' + MOBNAME[m], moveMul(t, 500, 400, m));
}
ok(coverAt(t, 500, 400, false) === 1, 'open ground should give no cover');
ok(hideAt(t, 500, 400) === 0, 'open ground should hide nobody');
ok(surfaceAt(t, 500, 400) === 'open', 'open ground should read as open', surfaceAt(t, 500, 400));

/* ---- a unit crosses ground as what it IS, not as what it shoots ---- */
ok(mobilityOf(UNITS.rifle) === MOB.foot, 'infantry cross on foot');
ok(mobilityOf(UNITS.tank) === MOB.vehicle, 'a battle tank crosses as a vehicle, not as infantry');
ok(mobilityOf(UNITS.apc) === MOB.vehicle, 'an APC crosses as a vehicle');
ok(mobilityOf(UNITS.mortar) === MOB.gun, 'a mortar team crosses as a gun');
ok(mobilityOf(UNITS.heli) === MOB.air, 'a gunship crosses as air');

/* ---- wire stops men; vehicles crush through it ---- */
t.flags[cell(10, 10)] |= WIRED;
ok(near(moveMul(t, wx(10), wy(10), MOB.foot), GROUND.wire.move[MOB.foot]), 'wire should stop a man');
ok(
  moveMul(t, wx(10), wy(10), MOB.vehicle) > moveMul(t, wx(10), wy(10), MOB.foot) * 2,
  'a vehicle should cross wire far faster than a man',
  [moveMul(t, wx(10), wy(10), MOB.vehicle), moveMul(t, wx(10), wy(10), MOB.foot)]
);

/* ---- a road carries armour, and does not turn to mud ---- */
t.flags[cell(12, 10)] |= ROAD;
ok(moveMul(t, wx(12), wy(10), MOB.vehicle) > 1.1, 'a road should carry a vehicle faster than open ground');
t.churn[cell(12, 10)] = 1;
t.churn[cell(13, 10)] = 1;
ok(
  near(moveMul(t, wx(12), wy(10), MOB.vehicle), GROUND.road.move[MOB.vehicle]),
  'a metalled road should not turn to mud',
  moveMul(t, wx(12), wy(10), MOB.vehicle)
);
ok(
  moveMul(t, wx(13), wy(10), MOB.vehicle) < 0.9,
  'churned open ground should drag a vehicle',
  moveMul(t, wx(13), wy(10), MOB.vehicle)
);

/* ---- rubble shelters a man and stops a tank ---- */
t.flags[cell(14, 10)] |= RUBBLE;
ok(!hardAt(t, wx(14), wy(10), true), 'a man should be able to climb into rubble');
ok(hardAt(t, wx(14), wy(10), false), 'rubble should stop anything with an engine');
ok(coverAt(t, wx(14), wy(10), false) < 1, 'rubble should be cover');
ok(surfaceAt(t, wx(14), wy(10)) === 'rubble', 'rubble should read as rubble');

/* ---- cover stacks, concealment does not ---- */
t.flags[cell(16, 10)] |= WOOD | TRENCHED;
ok(
  near(coverAt(t, wx(16), wy(10), false), GROUND.wood.cover * GROUND.trench.cover),
  'a trench dug in a wood should give both covers',
  coverAt(t, wx(16), wy(10), false)
);
ok(
  near(hideAt(t, wx(16), wy(10)), Math.max(GROUND.wood.hide, GROUND.trench.hide)),
  'concealment should be the best thing hiding you, not the product',
  hideAt(t, wx(16), wy(10))
);

/* ---- water and cliffs stop everyone ---- */
t.flags[cell(18, 10)] |= WATER;
ok(hardAt(t, wx(18), wy(10), true), 'nobody wades the river');
t.flags[cell(19, 10)] |= CLIFF;
ok(hardAt(t, wx(19), wy(10), true), 'nobody walks up a cliff');

/* ---- line of sight ---- */
const A = { x: wx(30), y: wy(20) };
const B = { x: wx(50), y: wy(20) };
ok(sightClear(t, A.x, A.y, B.x, B.y, 0), 'open ground should not block a sight line');

// a belt of trees between them
for (let gy = 15; gy < 26; gy++) t.flags[cell(40, gy)] |= WOOD;
ok(!sightClear(t, A.x, A.y, B.x, B.y, 0), 'a wood should block a sight line through it');
ok(sightClear(t, A.x, A.y, B.x, B.y, 1), 'one step of height should see over a treeline');

// a wall of buildings takes two
for (let gy = 15; gy < 26; gy++) {
  t.flags[cell(40, gy)] = (t.flags[cell(40, gy)] & ~WOOD) | BUILD;
}
ok(!sightClear(t, A.x, A.y, B.x, B.y, 0), 'a building should block a sight line');
ok(!sightClear(t, A.x, A.y, B.x, B.y, 1), 'one step of height should not see through a building');
ok(sightClear(t, A.x, A.y, B.x, B.y, 2), 'two steps of height should see over a building');

// a man standing in the wood can still see out of it, and be seen
for (let gy = 15; gy < 26; gy++) t.flags[cell(40, gy)] = WOOD;
ok(sightClear(t, wx(40), wy(20), wx(43), wy(20), 0), 'a man in a wood should see the ground beside it');

// point blank is never argued about
ok(sightClear(t, wx(40), wy(20), wx(40) + 4, wy(20), 0), 'a cell should not block a sight line inside itself');

/* ---- high ground sees further ---- */
t.elev[cell(60, 20)] = 3;
ok(
  sightRange(t, wx(60), wy(20), 400) > sightRange(t, wx(61), wy(20), 400),
  'a hill should see further than the ground below it'
);

/* ---- the stamps ---- */
const before = t.flags.reduce((n, f) => n + (f & STONE ? 1 : 0), 0);
stampBlob(t, wx(70), wy(20), 60, 40, STONE);
const afterBlob = t.flags.reduce((n, f) => n + (f & STONE ? 1 : 0), 0);
ok(afterBlob > before, 'stampBlob should mark ground');
stampLine(t, wx(80), wy(20), 0, 200, 10, FIELD);
ok(t.flags.reduce((n, f) => n + (f & FIELD ? 1 : 0), 0) > 5, 'stampLine should mark a run of ground');

/* ---- every row in the table is reachable, and says what it is ---- */
for (const key of Object.keys(GROUND)) {
  const i = cell(5, 30);
  t.flags[i] = GROUND[key].bit;
  const name = describe(t, wx(5), wy(30));
  ok(name === GROUND[key].name, 'a cell of ' + key + ' should describe itself as its own row', name);
  ok(surfaceAt(t, wx(5), wy(30)) === key, 'a cell of ' + key + ' should read back as ' + key);
}
t.flags[cell(5, 30)] = 0;

/* ---- the tidy record agrees with the fast queries ---- */
{
  const i = cell(22, 12);
  t.flags[i] = WOOD | FIELD;
  t.elev[i] = 2;
  t.churn[i] = 0.5;
  const c = cellAt(t, wx(22), wy(12));
  ok(c.i === i, 'cellAt should land on the same cell', [c.i, i]);
  ok(c.cover === coverAt(t, wx(22), wy(12), false), 'cellAt cover should match coverAt');
  ok(c.hide === hideAt(t, wx(22), wy(12)), 'cellAt hide should match hideAt');
  ok(c.move[MOB.foot] === moveMul(t, wx(22), wy(12), MOB.foot), 'cellAt move should match moveMul');
  ok(c.blind === true, 'a wood should be marked as blocking sight in the record');
  ok(c.elev === 2 && c.churn === 0.5, 'cellAt should carry elevation and churn');
}

/* ---- the map is clamped, not wrapped ---- */
ok(idx(t, -5000, -5000) === 0, 'off the top-left corner should clamp to the first cell');
ok(idx(t, 1e6, 1e6) === t.TW * t.TH - 1, 'off the bottom-right corner should clamp to the last cell');

console.log(JSON.stringify({ ok: fails.length === 0, checks: 40, fails }));
