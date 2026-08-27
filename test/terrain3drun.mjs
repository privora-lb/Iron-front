// The 3D ground, checked without a screen.
//
// three.js builds geometry perfectly well in node — it only needs a browser to
// DRAW. So the part of the 3D renderer most likely to be silently wrong, and
// least likely to be noticed by eye, can be tested here: whether the mesh is
// laid over the battlefield the right way round.
//
// If cell (gx,gy) of the model does not land on vertex (gx,gy) of the mesh, the
// whole map is drawn mirrored or sheared, every unit stands in the wrong place
// on it, and picking is wrong everywhere — from a screenshot it just looks like
// "the terrain is odd".
//
// Prints one JSON line: { ok, fails: [...] }.
import { makeTerrain, WOOD, WATER, ROAD } from '../src/world/terrain.js';
import { buildTerrain, buildWater, groundY, HEIGHT_SCALE } from '../src/render/three/terrainMesh.js';

const fails = [];
const ok = (cond, what, got) => { if (!cond) fails.push(what + (got === undefined ? '' : ' — got ' + JSON.stringify(got))); };
const near = (a, b, eps = 1e-4) => Math.abs(a - b) < eps;

const TG = 20;
const t = makeTerrain(2000, 800, TG);
const cell = (gx, gy) => gy * t.TW + gx;

// A ramp that climbs twice as fast per cell going east as going south, so a
// transposed or mirrored mesh cannot accidentally agree with the right one.
// Per CELL, not per edge: the map is a hundred cells across and forty down, so
// splitting the rise by fraction-of-the-map would make south the steeper one.
const EAST = 0.006;
const SOUTH = 0.003;
for (let gy = 0; gy < t.TH; gy++) {
  for (let gx = 0; gx < t.TW; gx++) {
    t.height[cell(gx, gy)] = gx * EAST + gy * SOUTH;
  }
}
t.flags[cell(5, 5)] = WOOD;
t.flags[cell(6, 5)] = ROAD;

const built = buildTerrain(t, ['#43452F', '#4A4B34', '#3A3C2B']);
const pos = built.mesh.geometry.attributes.position;

ok(pos.count === t.TW * t.TH, 'the mesh should have one vertex per cell', [pos.count, t.TW * t.TH]);

/* ---- the mesh must lie over the battlefield the right way round ---- */
{
  const wrong = [];
  for (const [gx, gy] of [[0, 0], [t.TW - 1, 0], [0, t.TH - 1], [t.TW - 1, t.TH - 1], [7, 3], [23, 17]]) {
    const i = cell(gx, gy);
    const want = t.height[i] * HEIGHT_SCALE;
    if (!near(pos.getY(i), want, 0.01)) wrong.push(gx + ',' + gy + ': mesh ' + pos.getY(i).toFixed(2) + ' vs model ' + want.toFixed(2));
    // and the vertex must sit where that cell sits on the ground, once the mesh
    // is shifted from centre-origin to corner-origin the way the scene does it
    const wx = pos.getX(i) + t.W / 2;
    const wz = pos.getZ(i) + t.H / 2;
    if (!near(wx, gx * (t.W / (t.TW - 1)), 0.01)) wrong.push(gx + ',' + gy + ': x lands at ' + wx.toFixed(1));
    if (!near(wz, gy * (t.H / (t.TH - 1)), 0.01)) wrong.push(gx + ',' + gy + ': z lands at ' + wz.toFixed(1));
  }
  ok(!wrong.length, 'every cell of the model lands on its own vertex of the mesh', wrong);
}

/* ---- colour comes off the same table the simulation reads ---- */
{
  const col = built.mesh.geometry.attributes.color;
  const woodC = [col.getX(cell(5, 5)), col.getY(cell(5, 5)), col.getZ(cell(5, 5))];
  const roadC = [col.getX(cell(6, 5)), col.getY(cell(6, 5)), col.getZ(cell(6, 5))];
  const openC = [col.getX(cell(9, 5)), col.getY(cell(9, 5)), col.getZ(cell(9, 5))];
  ok(woodC[1] > woodC[0] && woodC[1] > woodC[2], 'a wood should be green', woodC);
  ok(roadC.join() !== openC.join(), 'a road should not be the colour of open ground');
  ok(woodC.join() !== openC.join(), 'a wood should not be the colour of open ground');
}

/* ---- height under a position, between the vertices ---- */
{
  const wrong = [];
  for (const [gx, gy] of [[3, 4], [11, 9], [20, 2]]) {
    const i = cell(gx, gy);
    // groundY samples cell centres, so ask it at the centre of that cell
    const got = groundY(t, gx * TG + TG / 2, gy * TG + TG / 2);
    const want = t.height[i] * HEIGHT_SCALE;
    if (!near(got, want, 0.5)) wrong.push(gx + ',' + gy + ': ' + got.toFixed(2) + ' vs ' + want.toFixed(2));
  }
  ok(!wrong.length, 'the ground height under a position matches the model', wrong);

  const a = groundY(t, 100, 100);
  const b = groundY(t, 108, 100);
  ok(b > a, 'walking east up the ramp should climb', [a, b]);
  const c = groundY(t, 100, 108);
  ok(c > a, 'walking south up the ramp should climb', [a, c]);
  ok(b - a > c - a, 'the east slope is the steeper one, as it was built', [b - a, c - a]);
}

/* ---- off the edge of the world is still ground, not a crash ---- */
ok(Number.isFinite(groundY(t, -9999, -9999)), 'height off the top-left corner should still be a number');
ok(Number.isFinite(groundY(t, 1e6, 1e6)), 'height off the bottom-right corner should still be a number');

/* ---- water sits in the channel that was cut for it ---- */
{
  const t2 = makeTerrain(600, 400, TG);
  for (let i = 0; i < t2.height.length; i++) t2.height[i] = 0.5;
  const river = [];
  for (let gy = 0; gy < t2.TH; gy++) { const i = gy * t2.TW + 8; t2.flags[i] = WATER; river.push(i); }
  const b2 = buildTerrain(t2, null);
  const p2 = b2.mesh.geometry.attributes.position;
  ok(p2.getY(river[2]) < 0.5 * HEIGHT_SCALE, 'the river bed should be cut below the land');
  ok(b2.waterY > p2.getY(river[2]), 'the water should sit above its own bed', [b2.waterY, p2.getY(river[2])]);
  ok(b2.waterY < 0.5 * HEIGHT_SCALE + 12, 'the water should not stand above the fields beside it');
  const dry = buildTerrain(makeTerrain(400, 400, TG), null);
  ok(!buildWater(t2, dry.waterY).visible, 'a battlefield with no water should have no water plane');
}

console.log(JSON.stringify({ ok: fails.length === 0, checks: 14, fails }));
