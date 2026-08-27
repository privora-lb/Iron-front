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

const require = createRequire(import.meta.url);
const { loadGame } = require('./dom.js');

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};

const fails = [];
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

// ---- a second battlefield, because a new match rebuilds the world ----
step('starting a second battle', () => {
  g.el('again') && g.el('again').click();
  g.all('#mapPick [data-map="city"]')[0].click();
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

console.log(JSON.stringify({ ok: fails.length === 0, frames: drawn, fails }));
