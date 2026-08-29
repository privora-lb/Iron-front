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
//
// WHAT IS THE SIMULATION'S AND WHAT IS NOT
//
// The field, in 0..1, is the simulation's: sight lines, cover and where a tank
// can climb are all read off it, and nothing here may change it. Everything
// below — how many metres tall that field stands, the hummocks laid over it,
// the grain in the surface — is this file's own, and the simulation never asks.
// That is what lets the ground be made to look like ground without any risk of
// two machines in a match disagreeing about it.
import * as THREE from 'three';
import { GROUND } from '../../data/ground.js';
import { onCompile, worldPosition } from './shader.js';
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

// …except where the country is supposed to BE mountains. The engine already
// decides how much relief each battlefield has, but only within that one scale,
// so a mountain range and a river terrace came out within a third of each other
// and neither read as itself. Purely how tall it is drawn; the field the
// simulation reads is untouched.
// Tuned against the view a commander actually plays from, not against a
// postcard: at two and a half times, the mountains map put a wall of hillside
// across the whole screen at the default zoom and there was no battlefield left
// to look at. High enough that a ridge is a ridge, low enough that you can
// still see over it from where the game is played.
const RELIEF = {
  villages: 1.3,
  ultimate: 1.55,
};

// Two vertices per cell of the model. The model's cells are 22 units across —
// a tank is 34 long — so at one vertex per cell the finest thing the ground can
// be shaped into is about a hundred and thirty feet wide, and every battlefield
// came out as one smooth dome with nothing on it at all. The mesh is built once
// per battlefield and never touched again, so the only cost is memory.
const SUBDIV = 2;

// The hummocks, banks and hollows laid over the model's own shape: wavelength
// in world units against how tall in scene units. Nothing here is big enough to
// hide a man — the shape of the battlefield is still the simulation's — but
// without them the ground is a sheet, and a sheet is the single thing that
// makes a landscape read as a model of one.
const DETAIL = [
  [300, 10, 0],
  [130, 6, 1], // ridged: this one carves lines rather than blobs, which is
  [58, 3.4, 0], //         what makes ground read as drained rather than lumpy
  [34, 1.8, 0],
];

// Ground that must stay exactly where the model put it. A river bed that
// hummocks pokes through the water; a made road that hummocks is not a road;
// a house sitting across a bank stands on one corner.
const FLAT = WATER | FORD | ROAD | BUILD | STONE | RUBBLE;

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

/** The same, for a point on a lattice rather than a cell of the model. */
function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise: a lattice of those numbers, smoothly joined. */
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/**
 * The hummocks, in scene units, at one point on the battlefield.
 *
 * Deterministic in the position alone — no seed, no state — so the ground is
 * the same shape every time it is built, every renderer agrees about it, and
 * `groundY` below can answer for a point that is not on any vertex.
 */
function detailAt(x, y) {
  let sum = 0;
  for (let k = 0; k < DETAIL.length; k++) {
    const w = DETAIL[k][0];
    const n = vnoise(x / w, y / w);
    // A ridged octave is the noise folded about its middle: it makes creases
    // and spurs where a smooth one only makes bumps.
    sum += (DETAIL[k][2] ? 1 - Math.abs(n * 2 - 1) : n * 2 - 1) * DETAIL[k][1];
  }
  return sum;
}

/**
 * The battlefield currently on screen, as this file needs to see it.
 *
 * `groundY` is asked for a height by six other modules — men, wrecks, trees,
 * hedges, smoke, the camera — and none of them know how tall this map stands or
 * where its hummocks are. There is exactly one battlefield being drawn at a
 * time, so it is kept here, stamped with the terrain it belongs to: handed a
 * different one, groundY falls back to the plain field rather than answering
 * with the last map's shape.
 */
let CUR = { terrain: null, bed: null, mask: null, lift: HEIGHT_SCALE };

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

/** Bilinear sample of a per-cell field, in the mesh's own coordinates. */
function sample(field, TW, TH, gx, gy) {
  const x = gx < 0 ? 0 : gx > TW - 1.001 ? TW - 1.001 : gx;
  const y = gy < 0 ? 0 : gy > TH - 1.001 ? TH - 1.001 : gy;
  const ix = x | 0;
  const iy = y | 0;
  const tx = x - ix;
  const ty = y - iy;
  const i = iy * TW + ix;
  const a = field[i];
  const b = field[i + 1];
  const c = field[i + TW];
  const d = field[i + TW + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * The grain in the surface.
 *
 * Vertex colour can only change as fast as there are vertices, so however fine
 * the mesh is the ground is a smooth wash between them — which is what made it
 * look like painted plaster from close to. This is three octaves of noise
 * sampled per PIXEL off the world position, fading each one out as it drops
 * below the size of a pixel so that nothing shimmers when the camera pulls
 * back. It costs a dozen instructions and it is the difference between earth
 * and a bedsheet.
 */
const NOISE_GLSL = `
float ifHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float ifNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( ifHash( i ), ifHash( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( ifHash( i + vec2( 0.0, 1.0 ) ), ifHash( i + vec2( 1.0, 1.0 ) ), f.x ),
    f.y );
}
float ifFbm( vec2 p ) {
  return ifNoise( p ) * 0.55 + ifNoise( p * 2.03 ) * 0.29 + ifNoise( p * 4.11 ) * 0.16;
}`;

/**
 * What the ground is MADE of, worked out per pixel.
 *
 * The mesh can say where the ground is and roughly what colour, and no more:
 * it has a vertex every eleven units, and the whole of what makes real ground
 * look real happens below that. Three things are added here, all of them from
 * the fragment's own position on the battlefield, none of them from a texture
 * file:
 *
 *   the surface     - the light of ground with clods and ruts and tussocks in
 *                     it, by bending the normal along the slope of two octaves
 *                     of noise;
 *   the colouring   - four scales of value, from a hundred and sixty metres
 *                     down to three, and a slow wander of HUE between damp
 *                     green and dry olive. Ground that varies only in
 *                     brightness reads as a painted board however fine the
 *                     variation is; it is the colour changing that sells it;
 *   what shows      - rock breaking through wherever the ground is too steep to
 *                     hold soil, in patches with ragged edges rather than along
 *                     a contour.
 *
 * Everything fades out as a pixel grows past the size of the thing it is
 * drawing, so a battlefield seen from the command view does not crawl.
 */
function groundShader(material) {
  onCompile(material, 'if-ground', (shader) => {
    worldPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>' + NOISE_GLSL)
      // The slope has to be read BEFORE the normal is bent, or the tussocks
      // would count as hillside and the whole field would turn to scree.
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
  float ifSlope = length( normal.xz );
  vec2 ifP = vIfWorld.xz;
  float ifPx = max( fwidth( ifP.x ), fwidth( ifP.y ) );
  float ifMid = clamp( 18.0 / ifPx - 1.0, 0.0, 1.0 );
  float ifFine = clamp( 5.0 / ifPx - 1.0, 0.0, 1.0 );
  if ( ifFine > 0.002 ) {
    float e = max( 0.7, ifPx );
    #define IF_BUMP(p) ( ifNoise( (p) * 0.12 ) + 0.55 * ifNoise( (p) * 0.31 ) )
    float h0 = IF_BUMP( ifP );
    float hx = IF_BUMP( vec2( ifP.x + e, ifP.y ) );
    float hz = IF_BUMP( vec2( ifP.x, ifP.y + e ) );
    normal = normalize( normal + vec3( -( hx - h0 ), 0.0, -( hz - h0 ) ) / e * 3.4 * ifFine );
  }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    float ifV =
        ( ifNoise( ifP * 0.0062 ) - 0.5 ) * 0.30
      + ( ifNoise( ifP * 0.023 ) - 0.5 ) * 0.26
      + ( ifNoise( ifP * 0.088 ) - 0.5 ) * 0.22 * ifMid
      + ( ifNoise( ifP * 0.360 ) - 0.5 ) * 0.20 * ifFine;
    float ifWet = ifFbm( ifP * 0.011 + 41.0 );
    vec3 ifTint = mix( vec3( 1.11, 0.99, 0.80 ), vec3( 0.86, 1.06, 0.86 ), ifWet );
    diffuseColor.rgb *= ifTint * ( 1.0 + ifV * 0.55 );

    // Grass holds on a bank a great deal further than it looks as though it
    // should; rock only wins where the ground is genuinely steep. Set to break
    // through at a gentle slope, every hillside on every map turned to concrete.
    float ifBite = smoothstep( 0.52, 0.92, ifSlope + ( ifFbm( ifP * 0.035 ) - 0.5 ) * 0.26 );
    vec3 ifRock = vec3( 0.31, 0.29, 0.26 ) * ( 0.70 + 0.66 * ifFbm( ifP * 0.16 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, ifRock, ifBite * 0.78 );
  }`,
      );
  });
}

// The one water plane on screen, so the ripples can be moved along without
// every module that draws having to know about them.
const WATER_TIME = { value: 0 };
export const setWaterTime = (t) => {
  WATER_TIME.value = t;
};

/**
 * Water that moves.
 *
 * A flat translucent sheet is the single most obviously fake thing on a
 * battlefield: real water is never still and never one colour, and what tells
 * you it is water rather than blue ground is the sun broken up on it. Two
 * scrolling octaves of noise bend the normal, and the material is Phong rather
 * than Lambert so there is something for the sun to glint off.
 */
function waterShader(material) {
  onCompile(material, 'if-water', (shader) => {
    worldPosition(shader);
    shader.uniforms.uIfTime = WATER_TIME;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uIfTime;' + NOISE_GLSL)
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
  {
    vec2 w = vIfWorld.xz;
    float t = uIfTime;
    #define IF_WAVE(p) ( ifNoise( (p) * 0.030 + vec2( t * 0.9, t * 0.35 ) ) + 0.62 * ifNoise( (p) * 0.072 - vec2( t * 0.6, t * 0.8 ) ) )
    float e = 1.6;
    float h0 = IF_WAVE( w );
    float hx = IF_WAVE( vec2( w.x + e, w.y ) );
    float hz = IF_WAVE( vec2( w.x, w.y + e ) );
    normal = normalize( normal + vec3( -( hx - h0 ), 0.0, -( hz - h0 ) ) / e * 26.0 );
  }`,
      );
  });
}

/**
 * Build the ground for one battlefield.
 *
 * @param terrain the model from src/world/terrain.js
 * @param pal     the map's three-colour palette, as MAPS[type].pal
 * @param landuse the field patchwork from src/world/landuse.js, if this
 *                battlefield is farmed at all
 * @param map     which battlefield this is, for how much relief it stands in
 */
export function buildTerrain(terrain, pal, landuse, map, split) {
  const { TW, TH, TG, W, H } = terrain;
  const base = hexToRgb(pal ? pal[1] : '#43452F');
  const low = hexToRgb(pal ? pal[2] : '#3A3C2B');
  const lift = HEIGHT_SCALE * (RELIEF[map] || 1);

  const n = TW * TH;

  /* ---- what colour each cell of the model is ---- */
  const cellCol = new Float32Array(n * 3);
  const parcelOf = rasteriseParcels(terrain, landuse);
  const parcels = (landuse && landuse.parcels) || [];
  // Ground that is something in its own right is not farmland underneath.
  const NOT_FARMED = WATER | FORD | BUILD | RUBBLE | ROAD | STONE | CLIFF | WOOD;

  for (let i = 0; i < n && i < terrain.flags.length; i++) {
    const f = terrain.flags[i];
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

    // Two countries, one river.
    //
    // Where a map names a split, the far bank is a different piece of the world:
    // here, a frozen range against green farming country. It is applied at the
    // very end and to COLOUR ONLY - the height field, the cover, the parcels and
    // the woods are all still laid down in mirrored pairs, so the two commanders
    // are fighting over identical ground and only looking at different weather.
    // Snow gathers with height, the way it actually does, and thins toward the
    // water so the banks meet without a seam down the middle of the river.
    if (split) {
      const gx = i % TW;
      const wx = gx * TG;
      const side = wx < W / 2 ? split.west : split.east;
      // 0 at the channel, 1 well back from it: nothing changes at the water's
      // edge, which is what stops the two halves meeting as a hard line.
      const away = Math.min(1, Math.abs(wx - W / 2) / (W * 0.22));
      // Snow gathers with height and pasture does not, so the west is weighted
      // by how high the ground stands and the east is laid on evenly.
      const rise = side.ground[2] > side.ground[1] ? (0.3 + 0.7 * terrain.height[i]) : 1;
      const lie = side.tint * away * rise;
      if (lie > 0.001) {
        c = [c[0] + (side.ground[0] - c[0]) * lie,
             c[1] + (side.ground[1] - c[1]) * lie,
             c[2] + (side.ground[2] - c[2]) * lie];
      }
    }

    // Nothing in a landscape is one flat colour. A little stable speckle per
    // cell is the difference between ground and a painted board.
    const m = 0.94 + hash(i) * 0.12;
    cellCol[i * 3] = Math.min(1, c[0] * m);
    cellCol[i * 3 + 1] = Math.min(1, c[1] * m);
    cellCol[i * 3 + 2] = Math.min(1, c[2] * m);
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
      cellCol[i * 3] += (SHORE[0] - cellCol[i * 3]) * k;
      cellCol[i * 3 + 1] += (SHORE[1] - cellCol[i * 3 + 1]) * k;
      cellCol[i * 3 + 2] += (SHORE[2] - cellCol[i * 3 + 2]) * k;
    }
  }

  /* ---- the bed the mesh is draped over, and where it may hummock ---- */
  const bed = new Float32Array(n);
  const mask = new Float32Array(n);
  let waterSum = 0;
  let waterN = 0;
  for (let i = 0; i < n; i++) {
    const f = i < terrain.flags.length ? terrain.flags[i] : 0;
    let y = terrain.height[i] * lift;
    // Water is cut into the ground so the river plane below has something to
    // sit in rather than a flat sheet laid over the top of the land.
    if (f & WATER) {
      y -= 9;
      waterSum += y;
      waterN++;
    }
    bed[i] = y;
    mask[i] = f & FLAT ? 0 : 1;
  }
  // Feather the mask by one cell, or the hummocks end at a road in a step.
  // Only ever DOWNWARD: a cell that has to be flat stays exactly flat however
  // many of its neighbours are not, because the whole point of the mask is that
  // a river bed does not rise through the water standing on it.
  const soft = new Float32Array(n);
  for (let gy = 0; gy < TH; gy++) {
    for (let gx = 0; gx < TW; gx++) {
      const i = gy * TW + gx;
      if (mask[i] === 0) continue;
      let acc = mask[i] * 2;
      let wgt = 2;
      if (gx > 0) (acc += mask[i - 1]), wgt++;
      if (gx < TW - 1) (acc += mask[i + 1]), wgt++;
      if (gy > 0) (acc += mask[i - TW]), wgt++;
      if (gy < TH - 1) (acc += mask[i + TW]), wgt++;
      soft[i] = acc / wgt;
    }
  }

  CUR = { terrain, bed, mask: soft, lift };

  /* ---- the mesh ---- */
  const segX = (TW - 1) * SUBDIV;
  const segY = (TH - 1) * SUBDIV;
  const geo = new THREE.PlaneGeometry(W, H, segX, segY);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const stepX = W / segX;
  const stepY = H / segY;

  for (let vy = 0; vy <= segY; vy++) {
    for (let vx = 0; vx <= segX; vx++) {
      const v = vy * (segX + 1) + vx;
      const wx = vx * stepX;
      const wy = vy * stepY;
      const gx = vx / SUBDIV;
      const gy = vy / SUBDIV;
      pos.setY(v, sample(bed, TW, TH, gx, gy) + detailAt(wx, wy) * sample(soft, TW, TH, gx, gy));
      // Where one surface gives way to another the model has a straight line
      // between two cells, and smoothing it only turns the line into an
      // airbrushed edge — which is what made rock and sand read as spilt paint.
      // Reading the colour from a point pushed a little off the true one, by
      // noise, makes every boundary ragged the way a real one is. Small enough
      // that a road is still a road.
      const cw = 0.8;
      const ux = gx + (vnoise(wx / 40, wy / 40) - 0.5) * cw;
      const uy = gy + (vnoise(wx / 40 + 37.1, wy / 40 - 19.7) - 0.5) * cw;
      col[v * 3] = sample3(cellCol, TW, TH, ux, uy, 0);
      col[v * 3 + 1] = sample3(cellCol, TW, TH, ux, uy, 1);
      col[v * 3 + 2] = sample3(cellCol, TW, TH, ux, uy, 2);
    }
  }

  /* ---- cavity shading ----
   *
   * A hollow holds shadow that open ground does not, and a bank catches light
   * the flat beside it misses. The sun cannot say so: it is one direction, and
   * a shallow gully faces the same way as the field it is cut into. Comparing
   * each vertex with the ground a few paces around it does, and it costs one
   * pass over the mesh. This is most of what makes a landscape read as having
   * been WORN into its shape rather than drawn in it.  */
  {
    const R = 3; // vertices out; about thirty units at this subdivision
    const shade = new Float32Array(pos.count);
    for (let vy = 0; vy <= segY; vy++) {
      for (let vx = 0; vx <= segX; vx++) {
        const v = vy * (segX + 1) + vx;
        const h = pos.getY(v);
        const at = (a, b) =>
          pos.getY(Math.min(segY, Math.max(0, b)) * (segX + 1) + Math.min(segX, Math.max(0, a)));
        const round =
          (at(vx - R, vy) + at(vx + R, vy) + at(vx, vy - R) + at(vx, vy + R) +
            at(vx - R, vy - R) + at(vx + R, vy - R) + at(vx - R, vy + R) + at(vx + R, vy + R)) / 8;
        shade[v] = Math.max(0.7, Math.min(1.1, 1 - (round - h) / 34));
      }
    }
    for (let v = 0; v < pos.count; v++) {
      col[v * 3] *= shade[v];
      col[v * 3 + 1] *= shade[v];
      col[v * 3 + 2] *= shade[v];
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  groundShader(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.position.set(W / 2, 0, H / 2); // world (0,0) is a corner, not the centre
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  const waterY = waterN ? waterSum / waterN + 7 : -1000;
  return { mesh, waterY, lift, apron: buildApron(geo, col, segX, segY, W, H) };
}

// How far the country runs on past the edge of the battlefield, and how far it
// has fallen by the time it gets there.
const APRON = 4200;
// It has to fall away STEEPLY, not drift out level.
//
// At nine hundred over four thousand two hundred the skirt lay almost flat, so
// from a camera down near the edge of the map you were looking straight along
// it and a sheet with no thickness collapses, in that view, to a line. The sky
// is drawn with the depth test off so that everything paints over it, and the
// result was a thin dark streak running from the corner of the battlefield
// clear across the sky to the horizon - reported, exactly and fairly, as a tall
// line going off to infinity. Dropped this far it is under the eye long before
// it is far enough away to be seen edge-on.
const APRON_DROP = 3000;

/**
 * The land beyond the map.
 *
 * A battlefield is a rectangle, and drawn honestly a rectangle of ground is a
 * sheet hanging in the air: from any camera low enough to see relief, the map
 * ended in a sheer edge against the sky with nothing under it. It never showed
 * before because the ground was nearly flat, and it showed the moment it was
 * not.
 *
 * So the outermost ring of the ground is pulled outward and downward into an
 * apron that runs away into the haze. It is built from the mesh's OWN edge
 * vertices, so there is no seam to crack open, and it is one quad per edge
 * segment — about fifteen hundred triangles for the whole horizon.
 *
 * There is nothing out there and nothing happens on it. It exists so that the
 * world has a horizon instead of a hem.
 */
// Nothing for most of an edge, all the way over by the corner: this is what
// rounds the apron off instead of mitring it.
function ramp(u) {
  const a = Math.abs(u);
  if (a < 0.72) return 0;
  const t = Math.min(1, (a - 0.72) / 0.28);
  return Math.sign(u) * t * t * (3 - 2 * t);
}

function buildApron(geo, col, segX, segY, W, H) {
  const src = geo.attributes.position;
  const ring = [];
  for (let vx = 0; vx <= segX; vx++) ring.push(vx); // north
  for (let vy = 1; vy <= segY; vy++) ring.push(vy * (segX + 1) + segX); // east
  for (let vx = segX - 1; vx >= 0; vx--) ring.push(segY * (segX + 1) + vx); // south
  for (let vy = segY - 1; vy >= 1; vy--) ring.push(vy * (segX + 1)); // west
  ring.push(ring[0]);

  const n = ring.length;
  const pos = new Float32Array(n * 2 * 3);
  const c = new Float32Array(n * 2 * 3);
  const idx = [];
  const hw = W / 2;
  const hh = H / 2;

  for (let k = 0; k < n; k++) {
    const i = ring[k];
    const lx = src.getX(i);
    const ly = src.getY(i);
    const lz = src.getZ(i);
    // Straight out from whichever edge this vertex is on, SWINGING round to
    // the diagonal as it nears a corner. A hard switch at the corner — one
    // vertex running out diagonally between neighbours running out square —
    // gives that one quad a normal of its own, and it caught the light as a
    // seam across the horizon of every map.
    let ox = ramp(lx / hw);
    let oz = ramp(lz / hh);
    const len = Math.hypot(ox, oz) || 1;
    ox /= len;
    oz /= len;
    pos[k * 6] = lx;
    pos[k * 6 + 1] = ly;
    pos[k * 6 + 2] = lz;
    pos[k * 6 + 3] = lx + ox * APRON;
    pos[k * 6 + 4] = ly - APRON_DROP;
    pos[k * 6 + 5] = lz + oz * APRON;
    // A middle rib, pulled well below the straight line between the two, so the
    // skirt leaves the battlefield as a curve rather than a ramp and presents a
    // face to the eye from every angle instead of an edge from some of them.
    for (let ch = 0; ch < 3; ch++) {
      const v = col[i * 3 + ch];
      c[k * 6 + ch] = v;
      // ...and it goes to BLACK as it goes away. Outside the battlefield is
      // black; the apron is what carries the ground into it, so the map runs out
      // rather than stopping at a bright edge in mid-air.
      c[k * 6 + 3 + ch] = 0;
    }
    if (k < n - 1) {
      const a = k * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.position.set(W / 2, 0, H / 2);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Bilinear sample of one channel of a three-deep per-cell field. */
function sample3(field, TW, TH, gx, gy, ch) {
  const x = gx < 0 ? 0 : gx > TW - 1.001 ? TW - 1.001 : gx;
  const y = gy < 0 ? 0 : gy > TH - 1.001 ? TH - 1.001 : gy;
  const ix = x | 0;
  const iy = y | 0;
  const tx = x - ix;
  const ty = y - iy;
  const i = iy * TW + ix;
  const a = field[i * 3 + ch];
  const b = field[(i + 1) * 3 + ch];
  const c = field[(i + TW) * 3 + ch];
  const d = field[(i + TW + 1) * 3 + ch];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** A sheet of water at the level the river was cut to. */
export function buildWater(terrain, waterY) {
  // A single quad has one normal across the whole river; the ripple is worked
  // out per pixel, but the sheet still needs enough of it to be lit unevenly.
  const geo = new THREE.PlaneGeometry(terrain.W, terrain.H, 24, 16);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2f5a68,
    specular: 0xbfd9e4,
    shininess: 92,
    transparent: true,
    opacity: 0.86,
  });
  waterShader(mat);
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
 *
 * This has to give the SAME answer the mesh does, or every man, tree and shell
 * on the field stands at a height the ground is not actually at. It samples the
 * same bed the mesh was draped over, in the mesh's own coordinates — the mesh
 * spans the whole map with a vertex at each cell's corner, not its centre — and
 * adds the same hummocks.
 */
export function groundY(terrain, x, y) {
  const { TW, TH, W, H } = terrain;
  const gx = (x / W) * (TW - 1);
  const gy = (y / H) * (TH - 1);
  if (CUR.terrain === terrain) {
    return (
      sample(CUR.bed, TW, TH, gx, gy) + detailAt(x, y) * sample(CUR.mask, TW, TH, gx, gy)
    );
  }
  // Asked about a battlefield that is not the one built — the plain field, so
  // the answer is at least the right shape.
  return sample(terrain.height, TW, TH, gx, gy) * HEIGHT_SCALE;
}

/** How tall the battlefield on screen is drawn. The tests ask; nothing else. */
export const reliefOf = (map) => HEIGHT_SCALE * (RELIEF[map] || 1);

export { GROUND, detailAt, SUBDIV };
