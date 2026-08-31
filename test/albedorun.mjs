// What the ground actually REFLECTS.
//
// "The map looks washed out" is not a matter of taste that has to be argued
// about in front of a screen: a surface either reflects a believable fraction
// of the light landing on it or it does not, and that is a number this can
// print. Dry grass reflects about a fifth of what lands on it, soil and asphalt
// rather less, weathered concrete about a quarter, and only snow gets near a
// half. Ground built at twice those figures cannot be lit to look like ground —
// turn the sun down far enough to stop it glaring and the sky goes out with it.
//
//   node test/albedorun.mjs [--map villages]
//
// Prints one JSON line: { ok, mean, p95, hot, fails }.
import { createRequire } from 'node:module';
import { buildTerrain, SUBDIV } from '../src/render/three/terrainMesh.js';
import * as T from '../src/world/terrain.js';

const require = createRequire(import.meta.url);
const { loadGame } = require('./dom.js');

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};
const map = arg('map', 'villages');

const g = loadGame({ quiet: true });
if (g.loadError) {
  console.log(JSON.stringify({ ok: false, fails: ['the engine did not boot: ' + g.loadError] }));
  process.exit(1);
}
g.all('#mapPick [data-map="' + map + '"]')[0].click();
g.hook('seed')(4242);
g.all('#startVeil [data-budget="2000"]')[0].click();
g.el('autoDep').click();
g.el('startBattle').click();

const v = g.hook('worldview')();
const built = buildTerrain(v.terrain, v.pal, v.landuse, v.map, v.split);
const col = built.mesh.geometry.attributes.color.array;

// Each bank on its own, because a map may name one of them as snow country and
// snow is allowed to be bright. Judging the two together lets a snowfield hide
// a blown-out farm and lets a farm condemn a legitimate snowfield.
const pos = built.mesh.geometry.attributes.position.array;
const banks = { west: [], east: [] };
for (let i = 0; i < col.length / 3; i++) {
  const l = col[i * 3] * 0.2126 + col[i * 3 + 1] * 0.7152 + col[i * 3 + 2] * 0.0722;
  // the mesh is centred on the map, so its own x runs -W/2..W/2
  banks[pos[i * 3] < 0 ? 'west' : 'east'].push(l);
}

const stat = (a) => {
  const s2 = Float64Array.from(a).sort();
  const at = (q) => s2[Math.min(s2.length - 1, Math.floor(s2.length * q))];
  let sum = 0;
  let hot = 0;
  for (const l of a) {
    sum += l;
    if (l > 0.55) hot++;
  }
  return {
    mean: +(sum / a.length).toFixed(3),
    p50: +at(0.5).toFixed(3),
    p95: +at(0.95).toFixed(3),
    max: +at(1).toFixed(3),
    hotPc: +((hot / a.length) * 100).toFixed(1),
  };
};

const fails = [];
const snowy = !!(v.split && v.split.west && v.split.west.fir >= 1);
const out = { map, snowWest: snowy };
for (const side of ['west', 'east']) {
  const st = stat(banks[side]);
  out[side] = st;
  // Snow reflects about four fifths. Everything else on a battlefield — grass,
  // stubble, soil, stone, a made road — is between a tenth and a third, and a
  // bank averaging above that is the washed-out look this whole check exists
  // to catch.
  const snow = snowy && side === 'west';
  const cap = snow ? 0.62 : 0.3;
  if (st.mean > cap) fails.push(`${side}: mean reflectance ${st.mean} — brighter than ${snow ? 'snow' : 'concrete'}`);
  if (st.mean < 0.06) fails.push(`${side}: mean reflectance ${st.mean} — darker than wet asphalt`);
  if (st.max > 0.81) fails.push(`${side}: a vertex reflects ${st.max} — more than fresh snow`);
  if (!snow && st.p95 > 0.45) fails.push(`${side}: the brightest twentieth reflects ${st.p95} — that is snow, not farmland`);
  if (!snow && st.hotPc > 8) fails.push(`${side}: ${st.hotPc}% of the bank will clip`);
}
// And a breakdown by what the ground IS, which is the only way to find the one
// surface that is throwing the average — a bright shore or a bright crop can
// wash out half a map while every summary figure still looks reasonable.
{
  const TW = v.terrain.TW || v.terrain.W / v.terrain.TG;
  const segX = (TW - 1) * SUBDIV;
  const named = [['water', T.WATER], ['ford', T.FORD], ['road', T.ROAD], ['stone', T.STONE],
    ['wood', T.WOOD], ['marsh', T.MARSH], ['rock', T.ROCK], ['rubble', T.RUBBLE],
    ['build', T.BUILD], ['cliff', T.CLIFF], ['crop', T.FIELD]];
  const acc = {};
  for (let i = 0; i < col.length / 3; i++) {
    const vx = i % (segX + 1);
    const vy = (i / (segX + 1)) | 0;
    const gx = Math.min(TW - 1, Math.round(vx / SUBDIV));
    const gy = Math.round(vy / SUBDIV);
    const f = v.terrain.flags[gy * TW + gx];
    if (f === undefined) continue;
    let key = 'open';
    for (const [n, bit] of named) if (f & bit) { key = n; break; }
    const l = col[i * 3] * 0.2126 + col[i * 3 + 1] * 0.7152 + col[i * 3 + 2] * 0.0722;
    const a = acc[key] || (acc[key] = { n: 0, sum: 0, max: 0 });
    a.n++;
    a.sum += l;
    if (l > a.max) a.max = l;
  }
  out.byGround = {};
  for (const k of Object.keys(acc)) {
    out.byGround[k] = { pc: +((acc[k].n / (col.length / 3)) * 100).toFixed(1),
      mean: +(acc[k].sum / acc[k].n).toFixed(3), max: +acc[k].max.toFixed(3) };
  }
}

out.ok = fails.length === 0;
out.fails = fails;
console.log(JSON.stringify(out));
