// The 3D renderer, driven against a real battle with no GPU.
//
// Only the final draw call needs a graphics card. Building the scene graph,
// laying out four thousand trees, placing every man, turret and shell — all of
// that is arithmetic, and three.js does it perfectly well in node. So the code
// that runs sixty times a second in front of a player can be run here instead,
// against a battle the real engine is playing, and anything it throws is caught
// on this side rather than in a red bar at the bottom of somebody's screen.
//
//   node test/render3drun.mjs [--map villages] [--ticks 900]
//
// Prints one JSON line: { ok, fails: [...] }.
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { buildProps } from '../src/render/three/props.js';
import { buildUnits } from '../src/render/three/units.js';
import { buildParticles } from '../src/render/three/particles.js';
import { buildTerrain, buildWater } from '../src/render/three/terrainMesh.js';
import { buildHedges } from '../src/render/three/hedges.js';
import { buildClutter } from '../src/render/three/clutter.js';
import { buildLife } from '../src/render/three/life.js';
import { buildWind } from '../src/render/three/wind.js';
import { buildFog } from '../src/render/three/fog.js';
import { buildDecals } from '../src/render/three/decals.js';
import { eyePosition } from '../src/render/three/scene.js';
import { WATER, ROAD, BUILD } from '../src/world/terrain.js';

const require = createRequire(import.meta.url);
const { loadGame } = require('./dom.js');

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};

const fails = [];
const notes = [];
const map = arg('map', 'villages');
const ticks = parseInt(arg('ticks', '900'), 10);

function step(what, fn) {
  try {
    return fn();
  } catch (e) {
    fails.push(what + ': ' + (e && e.message ? e.message : String(e)));
    return null;
  }
}

const g = loadGame({ quiet: true });
if (g.loadError) {
  console.log(JSON.stringify({ ok: false, fails: ['the engine did not boot: ' + g.loadError] }));
  process.exit(1);
}

// A real match, played through the real UI, exactly as the other probes do it.
g.all('#mapPick [data-map="' + map + '"]')[0].click();
g.hook('seed')(4242);
g.all('#startVeil [data-budget="2000"]')[0].click();
g.el('autoDep').click();

const view = () => g.hook('worldview')();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 8, 14000);
camera.position.set(1000, 600, 400);
camera.lookAt(1000, 0, 900);
camera.updateMatrixWorld();

// ---- the world, while the player is still deploying ----
let ground = step('building the ground', () => buildTerrain(view().terrain, view().pal));
if (ground) step('building the water', () => buildWater(view().terrain, ground.waterY));
let props = step('building what stands on it', () => buildProps(scene, view().terrain, view()));
const units = step('building the armies', () => buildUnits(scene));
const dust = step('building the particles', () => buildParticles(scene));

step('drawing the deployment', () => {
  units.update(view());
  dust.update(view(), camera);
});

// ---- and then the battle, frame by frame ----
g.el('startBattle').click();
let drawn = 0;
for (let n = 0; n < ticks && !fails.length; n += 30) {
  g.hook('tick')(30);
  g.frames(1); // the real frame, which is what draws the overlay in the engine
  const v = view();
  step('drawing the armies at tick ' + n, () => units.update(v));
  step('drawing the particles at tick ' + n, () => dust.update(v, camera));
  if (props) step('rebuilding what stands at tick ' + n, () => props.refresh(v));
  drawn++;
}
if (g.fault()) fails.push('the engine faulted while the battle ran: ' + g.fault().split('\n')[1]);

/* ---------------------------------------------------------------------- *
 * The eye stands the right way round.
 *
 * This is the one piece of camera work that can be checked without a screen,
 * and it is the one that was wrong: the camera stood north of what it was
 * looking at, so the battlefield came out turned through half a circle from the
 * map and the minimap. Nothing inside the 3D view could tell, because a
 * rotation agrees with itself. Two points do tell.
 * ---------------------------------------------------------------------- */
step('the field faces the way the map faces', () => {
  const t = view().terrain;
  const cam = new THREE.PerspectiveCamera(45, 16 / 9, 8, 14000);
  const fx = t.W / 2;
  const fy = t.H / 2;
  const put = (yaw, pitch) => {
    const e = eyePosition(fx, 0, fy, 2400, yaw, pitch);
    cam.position.set(e[0], e[1], e[2]);
    cam.lookAt(fx, 0, fy);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
  };
  const at = (x, y) => {
    const p = new THREE.Vector3(x, 0, y).project(cam);
    return { x: p.x, y: p.y };
  };
  put(0, 0.86);
  const west = at(200, t.H / 2);
  const east = at(t.W - 200, t.H / 2);
  const north = at(t.W / 2, 200);
  const south = at(t.W / 2, t.H - 200);
  if (!(west.x < east.x)) fails.push('west is not on the left of the screen');
  if (!(north.y > south.y)) fails.push('north is not at the top of the screen');
  // and turning the camera a quarter circle must actually move the ground
  put(Math.PI / 2, 0.86);
  const turned = at(200, t.H / 2);
  if (Math.abs(turned.y - west.y) < 0.2) fails.push('a quarter turn did not move the ground');
  notes.push('camera: west left, north top, turns');
});

/* ---- the fog of war ---- */
step('the fog of war', () => {
  const t = view().terrain;
  const fog = buildFog({ W: t.W, H: t.H }, g.doc);
  fog.update({ phase: 'start', eyes: [], viewTeam: 'blue' });
  if (fog.uniforms.uFogDepth.value !== 0) fails.push('the lobby is fogged');
  const v = view();
  fog.update(v);
  if (!(fog.uniforms.uFogDepth.value > 0)) fails.push('a battle is not fogged');
  if (fog.eyeCount() !== (((v.eyes || []).length / 3) | 0))
    fails.push('the fog is not drawing the eyes the simulation counted');
  if (!fog.eyeCount()) fails.push('nothing on the field can see');

  // It has to be a fog of WAR, not a sheet over the enemy's half: the enemy's
  // ground must be covered, and every pair of eyes must actually open a hole in
  // that cover.
  //
  // The sheet itself cannot be read back here - the harness's canvas records
  // nothing and getImageData hands back blanks - so this watches what the fog
  // ASKS the canvas to do instead. It is the same question one step earlier,
  // and unlike a pixel it needs no rasteriser, which is what lets it run in the
  // ordinary suite rather than only where a native canvas happens to be.
  {
    const drawn = [];
    const rec = {
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      setTransform() {},
      clearRect() {},
      fillRect(x, y, w2, h2) {
        drawn.push({ op: 'fill', mode: this.globalCompositeOperation, x, y, w: w2, h: h2 });
      },
      drawImage(img, x, y, w2, h2) {
        drawn.push({ op: 'blit', mode: this.globalCompositeOperation, x, y, w: w2, h: h2 });
      },
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    };
    const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => rec }) };
    const spy = buildFog({ W: v.terrain.W, H: v.terrain.H }, doc);
    spy.update(v);
    const eyes = v.eyes || [];
    const holes = drawn.filter((d) => d.op === 'blit' && d.mode === 'destination-out');
    if (holes.length !== (eyes.length / 3) | 0)
      fails.push(holes.length + ' holes punched in the fog for ' + ((eyes.length / 3) | 0) + ' pairs of eyes');
    // Each hole over the unit that sees, and as wide as that unit's sight.
    let astray = 0;
    for (let e = 0, i = 0; e + 2 < eyes.length; e += 3, i++) {
      const d = holes[i];
      if (!d) continue;
      if (Math.abs(d.x + d.w / 2 - eyes[e]) > 1 || Math.abs(d.y + d.h / 2 - eyes[e + 1]) > 1) astray++;
      else if (Math.abs(d.w - eyes[e + 2] * 2) > 1) astray++;
    }
    if (astray) fails.push(astray + ' pairs of eyes see somewhere other than where they stand');
    // and the far half is covered before those holes are cut
    const cover = drawn.filter((d) => d.op === 'fill' && d.mode === 'source-over');
    const wide = cover.some((d) => d.w > v.terrain.W * 0.3 && d.h >= v.terrain.H);
    if (!wide) fails.push('the half of the field nobody has scouted is never covered');
    if (drawn.indexOf(holes[0]) < drawn.indexOf(cover[cover.length - 1]))
      fails.push('the fog is laid down after the holes are cut, so it covers them again');
    spy.dispose();
    notes.push('fog of war: ' + holes.length + ' holes cut, far half covered');
  }

  // Both patches on one material: the ground wants the fog AND the marks, and
  // three keeps only one onBeforeCompile, so they have to chain - and the world
  // position they share must be declared exactly once, or the shader will not
  // compile in front of a player.
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const marks = buildDecals(g.doc.createElement('canvas'), { W: t.W, H: t.H });
  marks.patch(mat);
  fog.patch(mat);
  const shader = {
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    uniforms: {},
  };
  mat.onBeforeCompile(shader, null);
  const count = (src, needle) => src.split(needle).length - 1;
  const vn = count(shader.vertexShader, 'varying vec3 vIfWorld');
  if (vn !== 1) fails.push('the world position is declared ' + vn + ' times in the vertex shader');
  if (count(shader.fragmentShader, 'varying vec3 vIfWorld') !== 1)
    fails.push('the world position is declared twice in the fragment shader');
  if (!shader.fragmentShader.includes('uFogMap')) fails.push('the fog never reached the shader');
  // The fog of war has to be the LAST thing said about a pixel. Mixed in at
  // <opaque_fragment>, three's own distance haze is blended over the top
  // afterwards and lifts unscouted ground back toward the colour of the sky -
  // so the far half of the battlefield comes out milk-white instead of dark,
  // and the further away it is the less it is hidden.
  const fogAt = shader.fragmentShader.indexOf('float ifFog');
  const hazeAt = shader.fragmentShader.indexOf('#include <fog_fragment>');
  const skinAt = shader.fragmentShader.indexOf('#include <colorspace_fragment>');
  if (fogAt < 0) fails.push('the fog of war is never mixed into the pixel');
  else if (fogAt < hazeAt || fogAt < skinAt)
    fails.push('the distance haze is applied after the fog of war, and undoes it');
  if (!shader.fragmentShader.includes('uDecalMap')) fails.push('the marks never reached the shader');
  if (!shader.vertexShader.includes('instanceMatrix * ifWorld'))
    fails.push('instanced meshes would sample the fog at the wrong place');
  for (const u of ['uFogMap', 'uFogSize', 'uFogColour', 'uFogDepth', 'uDecalMap', 'uDecalSize'])
    if (!shader.uniforms[u]) fails.push('the shader was never given ' + u);
  // Two patches, two tags: three shares compiled programs between materials
  // whose cache keys match, and every patch made this way stringifies the same.
  if (mat.customProgramCacheKey() === new THREE.MeshLambertMaterial().customProgramCacheKey())
    fails.push('a patched material shares its program cache key with an unpatched one');
  notes.push('fog: ' + fog.eyeCount() + ' eyes, both patches chain');
  fog.dispose();
  marks.dispose();
});

/* ---- the marks in the ground ---- */
step('the marks in the ground', () => {
  const v = view();
  if (!v.decal) fails.push('the engine is not offering its decal sheet');
  const marks = buildDecals(v.decal, { W: v.terrain.W, H: v.terrain.H });
  if (!marks) return;
  if (!marks.sync(0, 1)) fails.push('the first mark was never sent');
  if (marks.sync(0.1, 1)) fails.push('a sheet with nothing new on it was sent again');
  if (marks.sync(0.1, 2)) fails.push('a new mark was sent before the throttle let it');
  if (!marks.sync(9, 3)) fails.push('a new mark was never sent at all');
  if (marks.uploads() !== 2) fails.push('the sheet went to the card ' + marks.uploads() + ' times, not twice');
  marks.dispose();
});

/* ---- the dead ---- */
step('the dead lie where the map lays them', () => {
  const v = view();
  const bodies = [
    { x: 900, y: 900, a: 0.4, team: 'blue', veh: false, t: 1.9, max: 1.9, spin: 0.3 },
    { x: 940, y: 920, a: 1.4, team: 'red', veh: false, t: 0.2, max: 1.9, spin: -0.9 },
    { x: 1000, y: 980, a: 2.4, team: 'red', veh: true, t: 3.0, max: 3.4, spin: 1.1 },
    { x: 1040, y: 900, a: 0.1, team: 'blue', veh: false, t: 0, max: 1.9, spin: 0 }, // spent
  ];
  const total = () => {
    let n = 0;
    scene.traverse((o) => { if (o.isInstancedMesh) n += o.count; });
    return n;
  };
  units.update({ ...v, bodies }, 900);
  const down = total();
  units.update({ ...v, bodies: [] }, 900);
  // two men, each a body and a helmet, and one wreck; the fourth is out of time
  const fell = down - total();
  if (fell !== 5) fails.push('the dead came to ' + fell + ' instances, not five');
  notes.push('dead: two men and a wreck laid out, the spent one dropped');
});

/* ---- the men are walking, not sliding ---- */
step('a man walks on the phase the simulation is keeping', () => {
  const v = view();
  // Of the watching side: an enemy squad nobody has scouted is culled by the
  // fog before it is ever laid out, and would prove nothing about the walk.
  const live = (v.soldiers || []).find(
    (s) => s.alive && s.sq.team === v.viewTeam && s.sq.seen && !s.sq.t.vehicle && !s.sq.t.air,
  );
  if (!live) {
    fails.push('no infantry on the field to check');
    return;
  }
  // Two men, same place, same bearing, at opposite points of the same stride.
  const man = (step, moved) => ({
    sq: live.sq, x: 900, y: 900, alive: true, ang: 0.4,
    step, moved, v: 0, kick: 0, hull: 0, turret: 0, rec: 0,
  });
  const read = (soldiers) => {
    units.update({ ...v, soldiers }, 900);
    const out = [];
    const m = new THREE.Matrix4();
    const P = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.count) return;
      o.getMatrixAt(0, m);
      P.setFromMatrixPosition(m);
      out.push([P.x, P.y, P.z, m.elements[1], m.elements[4]]);
    });
    return out;
  };
  const down = read([man(0, 1)]); // mid-stride
  const up = read([man(Math.PI / 2, 1)]); // and a half-pace later
  let moved = 0;
  for (let i = 0; i < Math.min(down.length, up.length); i++)
    for (let k = 0; k < 5; k++) if (Math.abs(down[i][k] - up[i][k]) > 0.05) moved++;
  if (!moved) fails.push('nothing about a man changes between one pace and the next');

  // Standing still he does not stride, but he is not frozen either.
  const stillA = read([man(0.0, 0)]);
  const stillB = read([man(2.4, 0)]);
  let strode = 0;
  for (let i = 0; i < Math.min(stillA.length, stillB.length); i++)
    for (let k = 0; k < 5; k++) if (Math.abs(stillA[i][k] - stillB[i][k]) > 0.05) strode++;
  if (strode) fails.push('a man standing still is still swinging his legs');

  // And the flinch: firing rocks him back off the spot he is standing on.
  const calm = read([man(0, 0)]);
  const fired = read([{ ...man(0, 0), kick: 1 }]);
  let rocked = false;
  for (let i = 0; i < Math.min(calm.length, fired.length); i++)
    if (Math.hypot(calm[i][0] - fired[i][0], calm[i][2] - fired[i][2]) > 0.4) rocked = true;
  if (!rocked) fails.push('firing does not move a man at all');
  notes.push('gait: stride, bob and flinch all read off the simulation');
});

/* ---- the weather, and the life that has nothing to do with the war ---- */
step('the wind blows and the villages are lived in', () => {
  const v = view();
  const weather = buildWind();
  weather.update({ ...v, wind: { a: 0, v: 1 }, clouds: [{ x: 100, y: 200, rx: 300, ry: 200, a: 0.4 }] }, 0);
  const east = weather.uniforms.uWindDir.value.clone();
  weather.update({ ...v, wind: { a: Math.PI / 2, v: 1 }, clouds: [] }, 0);
  if (east.distanceTo(weather.uniforms.uWindDir.value) < 1)
    fails.push('the wind does not turn when the simulation turns it');
  if (weather.uniforms.uCloudA.value[0] !== 0) fails.push('a cloud that has gone still darkens the ground');

  // Both patches have to survive being asked for twice: the grass and the trees
  // outlive the battlefield they were first grown on, and a uniform declared
  // twice fails to link — which takes the whole 3D view down.
  const mat = new THREE.MeshLambertMaterial();
  weather.sway(mat, 1);
  weather.sway(mat, 1);
  const shader = {
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
    uniforms: {},
  };
  mat.onBeforeCompile(shader, null);
  const times = shader.vertexShader.split('uniform float uWindTime;').length - 1;
  if (times !== 1) fails.push('the wind uniforms are declared ' + times + ' times');
  if (!shader.vertexShader.includes('instanceMatrix[3]'))
    fails.push('every tuft would take its phase from the same place and lean as one');

  // The villagers and the birds.
  const life = buildLife(scene);
  life.update(v);
  const seen = life.counts();
  if (!seen.civs) fails.push('nobody lives in the villages');
  if (!seen.birds) fails.push('there is not a bird over the whole battlefield');
  // A farmer on ground nobody of yours can see is not drawn, the same rule the
  // map plays by — otherwise the enemy's half is mapped by its livestock.
  life.update({ ...v, eyes: [], viewTeam: 'blue' });
  const half = life.counts().civs;
  life.update({ ...v, eyes: [], viewTeam: 'red' });
  if (half === life.counts().civs && half === seen.civs)
    fails.push('civilians are drawn on ground nobody can see');
  notes.push('life: ' + seen.civs + ' villagers, ' + seen.birds + ' birds');
  life.dispose();
});

/* ---- what is growing on it ---- */
step('the ground is covered, and only where it can be', () => {
  const v = view();
  const t = v.terrain;
  const clutter = buildClutter(scene);
  const [grass, stones] = clutter.meshes;

  // Somewhere in the middle of the field, close to.
  clutter.update(v, t.W * 0.3, t.H * 0.5, 300);
  const near = clutter.counts();
  if (near.grass < 4000) fails.push('only ' + near.grass + ' tufts under the camera');
  if (!near.stones) fails.push('not a stone on the whole field');

  // Nothing may grow in the river, on the road, on paving or inside a house.
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const BARE = WATER | ROAD | BUILD;
  let wrong = 0;
  let far = 0;
  for (const mesh of [grass, stones]) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      const cell = ((pos.z / t.TG) | 0) * t.TW + ((pos.x / t.TG) | 0);
      if (t.flags[cell] & BARE) wrong++;
      if (Math.hypot(pos.x - t.W * 0.3, pos.z - t.H * 0.5) > 1600) far++;
    }
  }
  if (wrong) fails.push(wrong + ' tufts are growing in the river, on a road or inside a house');
  if (far) fails.push(far + ' tufts were grown outside the ring');

  // The same ground, asked twice, grows the same grass: a tuft that moved when
  // the camera came back to it would crawl over the field as the player panned.
  clutter.update(v, t.W * 0.7, t.H * 0.2, 300);
  clutter.update(v, t.W * 0.3, t.H * 0.5, 300);
  const again = clutter.counts();
  if (again.grass !== near.grass || again.stones !== near.stones)
    fails.push('the same ground grew different grass the second time');

  // Pulled back to a commander's view there is nothing to see, so nothing is
  // drawn: a tuft a fifth of a pixel across is a cost with no picture in it.
  clutter.update(v, t.W * 0.3, t.H * 0.5, 9000);
  if (clutter.counts().grass) fails.push('grass is still being drawn from the command view');
  notes.push('cover: ' + near.grass + ' tufts, ' + near.stones + ' stones underfoot');
  clutter.dispose();
});

/* ---- bocage ---- */
step('the field boundaries stand up', () => {
  const v = view();
  const t = v.terrain;
  const grown = buildHedges(scene, t, v.landuse);
  const n = grown.counts.hedge + grown.counts.wall;
  if (n < 200) fails.push('only ' + n + ' boundaries were grown on farmed country');
  // The same countryside twice must grow the same hedge.
  const again = buildHedges(scene, t, v.landuse);
  if (again.counts.hedge !== grown.counts.hedge || again.counts.wall !== grown.counts.wall)
    fails.push('the same fields grew a different hedge the second time');
  again.dispose();
  // Nothing is planted in the river, on a made road or inside a house.
  let wrong = 0;
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  for (const mesh of grown.meshes) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      const cell = ((pos.z / t.TG) | 0) * t.TW + ((pos.x / t.TG) | 0);
      if (t.flags[cell] & (WATER | ROAD | BUILD)) wrong++;
    }
  }
  if (wrong) fails.push(wrong + ' hedges stand in water, on a road or inside a house');

  // A hedgerow is a WALL of scrub, and the one thing it must not look like is a
  // string of beads - which is exactly what it was, because the boundary was
  // sampled further apart than a crown is long. There is no screen here to see
  // that on, but there is geometry: every crown has to be buried in the one
  // next to it. Measured as a real gap, not as a constant, so tuning the step
  // or the size cannot quietly open the hedge back up.
  {
    const bush = grown.meshes[0];
    const cells = new Map();
    const CELL = 40;
    const at = [];
    for (let i = 0; i < bush.count; i++) {
      bush.getMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const len = new THREE.Vector3().setFromMatrixColumn(m, 0).length();
      at.push({ x: p.x, z: p.z, len });
      const k = ((p.z / CELL) | 0) * 100000 + ((p.x / CELL) | 0);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(i);
    }
    let lonely = 0;
    for (let i = 0; i < at.length; i++) {
      const a = at[i];
      let near = Infinity;
      const cx = (a.x / CELL) | 0;
      const cz = (a.z / CELL) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          for (const j of cells.get((cz + dz) * 100000 + (cx + dx)) || []) {
            if (j === i) continue;
            const d = Math.hypot(at[j].x - a.x, at[j].z - a.z);
            if (d < near) near = d;
          }
      // Half the crown's length: at that spacing the two solidly overlap.
      if (near > a.len * 0.5) lonely++;
    }
    const share = lonely / Math.max(1, at.length);
    if (share > 0.08)
      fails.push(
        Math.round(share * 100) + '% of the hedge stands clear of its neighbours - it is a string of beads',
      );
    notes.push('hedge joins up: ' + Math.round((1 - share) * 100) + '% of crowns overlap the next');
  }
  grown.dispose();
  // A battlefield with no farmland grows none, and does not throw trying.
  const bare = buildHedges(scene, t, null);
  if (bare.counts.hedge + bare.counts.wall !== 0) fails.push('country with no fields grew hedges anyway');
  bare.dispose();
  notes.push('bocage: ' + grown.counts.hedge + ' hedge, ' + grown.counts.wall + ' wall');
});

// ---- a second battlefield, because a new match rebuilds the world ----
step('starting a second battle', () => {
  g.el('again') && g.el('again').click();
  g.all('#mapPick [data-map="ultimate"]')[0].click();
  g.all('#startVeil [data-budget="2000"]')[0].click();
  g.el('autoDep').click();
  g.el('startBattle').click();
  g.hook('tick')(120);
});
step('rebuilding the world for it', () => {
  if (props) props.dispose();
  props = buildProps(scene, view().terrain, view());
  ground = buildTerrain(view().terrain, view().pal);
  units.update(view());
  dust.update(view(), camera);
});

console.log(JSON.stringify({ ok: fails.length === 0, frames: drawn, notes, fails }));
