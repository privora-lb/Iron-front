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
import {
  buildTerrain,
  buildWater,
  groundY,
  detailAt,
  reliefOf,
  SUBDIV,
  HEIGHT_SCALE,
} from '../src/render/three/terrainMesh.js';

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

const built = buildTerrain(t, ['#43452F', '#4A4B34', '#3A3C2B'], null, 'villages');
const pos = built.mesh.geometry.attributes.position;
const lift = reliefOf('villages');

// The mesh carries more than one vertex per cell now — the model's cells are
// twenty-two units across and ground needs to be shaped finer than that — so
// the count is the subdivided one, and cell (gx,gy) is the vertex at
// (gx*SUBDIV, gy*SUBDIV).
const segX = (t.TW - 1) * SUBDIV;
const segY = (t.TH - 1) * SUBDIV;
const vert = (gx, gy) => gy * SUBDIV * (segX + 1) + gx * SUBDIV;
ok(
  pos.count === (segX + 1) * (segY + 1),
  'the mesh should carry SUBDIV vertices to a cell',
  [pos.count, (segX + 1) * (segY + 1)],
);

/* ---- the mesh must lie over the battlefield the right way round ---- */
{
  const wrong = [];
  for (const [gx, gy] of [[0, 0], [t.TW - 1, 0], [0, t.TH - 1], [t.TW - 1, t.TH - 1], [7, 3], [23, 17]]) {
    const i = cell(gx, gy);
    const v = vert(gx, gy);
    // The vertex must sit where that cell sits on the ground, once the mesh is
    // shifted from centre-origin to corner-origin the way the scene does it.
    const wx = pos.getX(v) + t.W / 2;
    const wz = pos.getZ(v) + t.H / 2;
    if (!near(wx, gx * (t.W / (t.TW - 1)), 0.01)) wrong.push(gx + ',' + gy + ': x lands at ' + wx.toFixed(1));
    if (!near(wz, gy * (t.H / (t.TH - 1)), 0.01)) wrong.push(gx + ',' + gy + ': z lands at ' + wz.toFixed(1));
    // and it must stand at the model's height for that cell, plus the hummocks
    // this renderer lays over it - which are its own and known exactly.
    const want = t.height[i] * lift + detailAt(wx, wz);
    if (!near(pos.getY(v), want, 0.01))
      wrong.push(gx + ',' + gy + ': mesh ' + pos.getY(v).toFixed(2) + ' vs model ' + want.toFixed(2));
  }
  ok(!wrong.length, 'every cell of the model lands on its own vertex of the mesh', wrong);
}

/* ---- the country does not stop dead at the edge of the map ---- */
{
  const ap = built.apron;
  ok(!!ap, 'the ground should carry an apron so the map does not end in mid-air');
  if (ap) {
    const p = ap.geometry.attributes.position;
    let outside = 0;
    let lowest = Infinity;
    for (let i = 0; i < p.count; i++) {
      const wx = p.getX(i) + t.W / 2;
      const wz = p.getZ(i) + t.H / 2;
      if (wx < -1 || wz < -1 || wx > t.W + 1 || wz > t.H + 1) outside++;
      if (p.getY(i) < lowest) lowest = p.getY(i);
    }
    ok(outside > p.count * 0.4, 'about half the apron should lie beyond the battlefield', outside + '/' + p.count);
    ok(lowest < 0, 'the apron should fall away below the ground it runs off', lowest);
    // and its inner rim must sit exactly on the mesh edge, or the seam cracks
    const edge = [];
    for (let i = 0; i < p.count; i += 2) {
      const wx = p.getX(i) + t.W / 2;
      const wz = p.getZ(i) + t.H / 2;
      if (Math.abs(p.getY(i) - groundY(t, wx, wz)) > 0.02) edge.push(wx.toFixed(0) + ',' + wz.toFixed(0));
    }
    ok(!edge.length, 'the apron should join the ground without a crack', edge.slice(0, 4));
  }
}

/* ---- how tall this battlefield is drawn is the map's own business ---- */
{
  // How MUCH higher is a matter of taste, and it is settled by looking: too
  // tall and the ridge fills the screen at the zoom the game is played from.
  // The order is not a matter of taste.
  ok(reliefOf('mountains') > reliefOf('villages'), 'mountains should stand above farmland',
    [reliefOf('mountains'), reliefOf('villages')]);
  ok(reliefOf('mountains') > reliefOf('city') * 1.4, 'a river terrace should not stand as high as a range',
    [reliefOf('city'), reliefOf('mountains')]);
  ok(reliefOf('nowhere-in-particular') === HEIGHT_SCALE, 'an unknown battlefield gets the plain scale');
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
    const wx = gx * (t.W / (t.TW - 1));
    const wz = gy * (t.H / (t.TH - 1));
    const got = groundY(t, wx, wz);
    const want = t.height[i] * lift + detailAt(wx, wz);
    if (!near(got, want, 0.5)) wrong.push(gx + ',' + gy + ': ' + got.toFixed(2) + ' vs ' + want.toFixed(2));
  }
  ok(!wrong.length, 'the ground height under a position matches the model', wrong);

  /* ---- and it agrees with the mesh BETWEEN the vertices too ----
   *
   * This is the one that matters and the one that was wrong. Every man, tree,
   * wreck and shell on the field is placed by groundY, and the ground they are
   * placed on is the mesh: if the two use different coordinates, everything on
   * the battlefield stands at a height the ground is not at. They disagreed by
   * half a cell — groundY read the model as though its samples were at cell
   * CENTRES while the mesh laid them at cell corners — which sank a man eleven
   * units into every slope on the map.  */
  const off = [];
  for (let k = 0; k < 60; k++) {
    // a scatter of points that mostly miss the vertices
    const wx = ((k * 137.13) % (t.W - 40)) + 13;
    const wz = ((k * 71.77) % (t.H - 40)) + 7;
    // read the mesh where that point falls: bilinear across the quad it is in
    const fx = (wx / t.W) * segX;
    const fz = (wz / t.H) * segY;
    const ix = Math.min(segX - 1, fx | 0);
    const iz = Math.min(segY - 1, fz | 0);
    const sx = fx - ix;
    const sz = fz - iz;
    const q = (a, b) => pos.getY(b * (segX + 1) + a);
    const mesh =
      (q(ix, iz) * (1 - sx) + q(ix + 1, iz) * sx) * (1 - sz) +
      (q(ix, iz + 1) * (1 - sx) + q(ix + 1, iz + 1) * sx) * sz;
    const stood = groundY(t, wx, wz);
    if (Math.abs(mesh - stood) > 1.2) off.push(wx.toFixed(0) + ',' + wz.toFixed(0) + ': mesh ' + mesh.toFixed(2) + ' vs stood-on ' + stood.toFixed(2));
  }
  ok(!off.length, 'what a man stands on is what the ground is drawn at', off.slice(0, 6));

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
  const b2 = buildTerrain(t2, null, null, 'city');
  const p2 = b2.mesh.geometry.attributes.position;
  const lift2 = reliefOf('city');
  const bedV = ((river[2] / t2.TW) | 0) * SUBDIV * ((t2.TW - 1) * SUBDIV + 1) + 8 * SUBDIV;
  ok(p2.getY(bedV) < 0.5 * lift2, 'the river bed should be cut below the land');
  ok(b2.waterY > p2.getY(bedV), 'the water should sit above its own bed', [b2.waterY, p2.getY(bedV)]);
  ok(b2.waterY < 0.5 * lift2 + 12, 'the water should not stand above the fields beside it');
  // Nothing hummocks a river bed: the water is a flat sheet and anything that
  // rose through it would show as ground standing in mid-stream.
  ok(near(p2.getY(bedV), 0.5 * lift2 - 9, 0.01), 'the river bed should be flat, not hummocked', p2.getY(bedV));
  const dry = buildTerrain(makeTerrain(400, 400, TG), null, null, 'city');
  ok(!buildWater(t2, dry.waterY).visible, 'a battlefield with no water should have no water plane');
}

console.log(JSON.stringify({ ok: fails.length === 0, checks: 22, fails }));
