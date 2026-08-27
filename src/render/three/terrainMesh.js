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

/** Is this point inside the plot? Ray casting; the polygons are twelve-sided. */
function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A stable scatter of numbers, one per cell. Same ground, same speckle. */
function hash(i) {
  let h = (i * 374761393 + 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Which plot each cell belongs to, worked out once.
 *
 * Only the plots' own bounding boxes are walked, not the whole map for each —
 * ninety parcels against thirty-five thousand cells is a search nobody needs.
 */
function rasteriseParcels(terrain, landuse) {
  const { TW, TH, TG } = terrain;
  const out = new Int16Array(TW * TH).fill(-1);
  if (!landuse || !landuse.parcels) return out;
  const ps = landuse.parcels;
  for (let n = 0; n < ps.length && n < 32767; n++) {
    const poly = ps[n].poly;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const q of poly) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[1] > y1) y1 = q[1];
    }
    const gx0 = Math.max(0, (x0 / TG) | 0);
    const gx1 = Math.min(TW - 1, (x1 / TG) | 0);
    const gy0 = Math.max(0, (y0 / TG) | 0);
    const gy1 = Math.min(TH - 1, (y1 / TG) | 0);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * TW + gx;
        if (out[i] >= 0) continue;
        if (inPoly(poly, gx * TG + TG / 2, gy * TG + TG / 2)) out[i] = n;
      }
    }
  }
  return out;
}

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
 * @param landuse the field patchwork from src/world/landuse.js, if this
 *                battlefield is farmed at all
 */
export function buildTerrain(terrain, pal, landuse) {
  const { TW, TH, TG, W, H } = terrain;
  const base = hexToRgb(pal ? pal[1] : '#43452F');
  const low = hexToRgb(pal ? pal[2] : '#3A3C2B');

  const geo = new THREE.PlaneGeometry(W, H, TW - 1, TH - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);

  let waterSum = 0;
  let waterN = 0;

  // The countryside is a patchwork of worked plots, and that patchwork is most
  // of what makes ground seen from above read as a place somebody lives rather
  // than as a green sheet. The flat renderer has painted it for a while; this
  // puts the same plots into the ground itself.
  const parcelOf = rasteriseParcels(terrain, landuse);
  const parcels = (landuse && landuse.parcels) || [];
  // Ground that is something in its own right is not farmland underneath.
  const NOT_FARMED = WATER | FORD | BUILD | RUBBLE | ROAD | STONE | CLIFF | WOOD;

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
    let c = tone || [
      low[0] + (base[0] - low[0]) * t,
      low[1] + (base[1] - low[1]) * t,
      low[2] + (base[2] - low[2]) * t,
    ];

    if (!tone && !(f & NOT_FARMED)) {
      const pi = parcelOf[i];
      if (pi >= 0) {
        const p = parcels[pi];
        const gx = i % TW;
        const gy = (i / TW) | 0;
        const wx = gx * TG;
        const wy = gy * TG;
        // The plot's own colour, mixed into the country's rather than laid over
        // it, so a field is a variation on this ground and not a swatch.
        let r = (c[0] + p.tone[0] / 255) * p.shade;
        let g2 = (c[1] + p.tone[1] / 255) * p.shade;
        let b2 = (c[2] + p.tone[2] / 255) * p.shade;
        // The grain of the working. A ploughed field from the air is stripes
        // and nothing else; pasture has none, which is how you tell them apart.
        if (p.furrow > 0.02) {
          const u = (wx - p.cx) * Math.sin(p.bearing) - (wy - p.cy) * Math.cos(p.bearing);
          const stripe = Math.sin(u / 34) * 0.5 + 0.5;
          const k = 1 - p.furrow * 0.13 * stripe;
          r *= k;
          g2 *= k;
          b2 *= k;
        }
        c = [r, g2, b2];
      }
    }

    // Nothing in a landscape is one flat colour. A little stable speckle per
    // cell is the difference between ground and a painted board.
    const m = 0.94 + hash(i) * 0.12;
    col[i * 3] = Math.min(1, c[0] * m);
    col[i * 3 + 1] = Math.min(1, c[1] * m);
    col[i * 3 + 2] = Math.min(1, c[2] * m);
  }
  // A shore: the ground beside water is wet mud and shingle, never the same
  // green as the field behind it. Done as a second pass so it can look at what
  // its neighbours ended up as.
  const SHORE = rgb(126, 118, 92);
  for (let gy = 1; gy < TH - 1; gy++) {
    for (let gx = 1; gx < TW - 1; gx++) {
      const i = gy * TW + gx;
      if (terrain.flags[i] & (WATER | FORD | BUILD | ROAD)) continue;
      let wet = 0;
      if (terrain.flags[i - 1] & WATER) wet++;
      if (terrain.flags[i + 1] & WATER) wet++;
      if (terrain.flags[i - TW] & WATER) wet++;
      if (terrain.flags[i + TW] & WATER) wet++;
      if (!wet) continue;
      const k = Math.min(0.7, wet * 0.3);
      col[i * 3] += (SHORE[0] - col[i * 3]) * k;
      col[i * 3 + 1] += (SHORE[1] - col[i * 3 + 1]) * k;
      col[i * 3 + 2] += (SHORE[2] - col[i * 3 + 2]) * k;
    }
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
