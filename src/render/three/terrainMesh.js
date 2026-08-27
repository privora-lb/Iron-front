// The ground, as an actual surface.
//
// The battlefield model already carries a continuous height field and what
// every cell IS, so the 3D ground is not invented here — it is the same numbers
// the simulation walks over, lifted into a mesh. A hill that a sniper sees from
// is the hill you can see on screen, because there is only one of them.
//
// Colour is per vertex rather than per texture: no image files, nothing to
// download, and it matches how the rest of this game makes its art. The light
// does the shading, so a slope reads as a slope without any of it being painted
// in by hand.
import * as THREE from 'three';
import { GROUND } from '../../data/ground.js';
import {
  WATER,
  FORD,
  ROAD,
  STONE,
  WOOD,
  MARSH,
  ROCK,
  RUBBLE,
  BUILD,
  SCORCH,
  FIELD,
  CLIFF,
} from '../../world/terrain.js';

// How tall the world stands. The height field is 0..1; a battlefield is 5200
// units across, so this is about a five percent rise — enough that a ridge
// hides a tank, not so much that the map turns into mountains.
export const HEIGHT_SCALE = 300;

const rgb = (r, g, b) => [r / 255, g / 255, b / 255];

// One tone per surface. `null` means "whatever this battlefield's ground is",
// so a road through the desert is sand-coloured and the same road through the
// villages is mud.
const TONE = {
  water: rgb(44, 74, 85),
  ford: rgb(150, 165, 140),
  road: rgb(146, 130, 96),
  stone: rgb(112, 108, 98),
  wood: rgb(52, 66, 40),
  crop: rgb(146, 136, 74),
  marsh: rgb(66, 72, 52),
  rock: rgb(108, 104, 96),
  rubble: rgb(96, 90, 78),
  build: rgb(104, 98, 88),
  scorch: rgb(38, 34, 28),
  cliff: rgb(96, 92, 84),
};

const BITS = [
  [WATER, 'water'],
  [FORD, 'ford'],
  [CLIFF, 'cliff'],
  [BUILD, 'build'],
  [RUBBLE, 'rubble'],
  [ROAD, 'road'],
  [STONE, 'stone'],
  [SCORCH, 'scorch'],
  [WOOD, 'wood'],
  [FIELD, 'crop'],
  [MARSH, 'marsh'],
  [ROCK, 'rock'],
];

function hexToRgb(css) {
  if (typeof css === 'string' && css[0] === '#' && css.length >= 7) {
    return rgb(
      parseInt(css.slice(1, 3), 16),
      parseInt(css.slice(3, 5), 16),
      parseInt(css.slice(5, 7), 16),
    );
  }
  return rgb(67, 69, 47);
}

/**
 * Build the ground for one battlefield.
 *
 * @param terrain the model from src/world/terrain.js
 * @param pal     the map's three-colour palette, as MAPS[type].pal
 */
export function buildTerrain(terrain, pal) {
  const { TW, TH, W, H } = terrain;
  const base = hexToRgb(pal ? pal[1] : '#43452F');
  const low = hexToRgb(pal ? pal[2] : '#3A3C2B');

  const geo = new THREE.PlaneGeometry(W, H, TW - 1, TH - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);

  let waterSum = 0;
  let waterN = 0;

  for (let i = 0; i < pos.count && i < terrain.flags.length; i++) {
    const f = terrain.flags[i];
    let y = terrain.height[i] * HEIGHT_SCALE;
    // Water is cut into the ground so the river plane below has something to
    // sit in rather than a flat sheet laid over the top of the land.
    if (f & WATER) {
      y -= 9;
      waterSum += y;
      waterN++;
    }
    pos.setY(i, y);

    let tone = null;
    for (let k = 0; k < BITS.length; k++) {
      if (f & BITS[k][0]) {
        tone = TONE[BITS[k][1]];
        break;
      }
    }
    // Unmarked ground is the battlefield's own colour, shaded by height so the
    // low ground reads as damper and the tops as drier.
    const t = terrain.height[i];
    const c = tone || [
      low[0] + (base[0] - low[0]) * t,
      low[1] + (base[1] - low[1]) * t,
      low[2] + (base[2] - low[2]) * t,
    ];
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.position.set(W / 2, 0, H / 2); // world (0,0) is a corner, not the centre
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  const waterY = waterN ? waterSum / waterN + 7 : -1000;
  return { mesh, waterY };
}

/** A sheet of water at the level the river was cut to. */
export function buildWater(terrain, waterY) {
  const geo = new THREE.PlaneGeometry(terrain.W, terrain.H, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x38626e,
    transparent: true,
    opacity: 0.82,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(terrain.W / 2, waterY, terrain.H / 2);
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.visible = waterY > -900;
  return mesh;
}

/**
 * How high the ground stands under a world position, in scene units.
 * Bilinear, so a man walking a slope rises smoothly rather than in steps.
 */
export function groundY(terrain, x, y) {
  const { TW, TH, TG } = terrain;
  const fx = Math.min(TW - 1.001, Math.max(0, x / TG - 0.5));
  const fy = Math.min(TH - 1.001, Math.max(0, y / TG - 0.5));
  const ix = fx | 0;
  const iy = fy | 0;
  const tx = fx - ix;
  const ty = fy - iy;
  const h = terrain.height;
  const i = iy * TW + ix;
  const a = h[i];
  const b = h[i + 1];
  const c = h[i + TW];
  const d = h[i + TW + 1];
  return ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) * HEIGHT_SCALE;
}

export { GROUND };
