// What things are MADE of.
//
// Every surface on this battlefield used to be a MeshLambertMaterial, which has
// no notion of a material at all: it takes a colour, multiplies it by how much
// light lands on it, and stops there. Cloth, steel, painted armour, mud, glass
// and stone all came out as the same matte plastic under the same flat light —
// which is the single biggest reason the field read as a tabletop of painted
// models rather than as a place. Nothing was wrong with the shapes. There was
// no surface on any of them.
//
// This is the physically-based replacement. A material here says three things
// instead of one: what colour it is, how ROUGH it is — whether the sun scatters
// off it or glances off it — and how METAL it is. That is the whole of what
// separates a wet track pad from a wool greatcoat, and the eye reads it
// instantly without being able to say why.
//
// THE BARGAIN IS UNCHANGED. There are still no image files and no asset
// pipeline: the grain and the weave are computed here into small tiling
// textures, in plain arithmetic, so this works in node with no canvas and no
// graphics card — which is what lets the headless renderer probe build every
// material the player sees.
import * as THREE from 'three';

// One tile, shared by everything. 128 is enough for grain that is never looked
// at closely enough to see it repeat, and it is 64KB rather than a megabyte.
const TILE = 128;

/**
 * Value noise on a lattice that WRAPS.
 *
 * A tiling texture whose noise does not tile shows its seams as a grid across
 * every surface in the game, which is worse than having no grain at all.
 * Sampling the lattice modulo its period is what closes it.
 */
function lattice(period, seed) {
  const n = period * period;
  const v = new Float32Array(n);
  let s = (seed * 374761393 + 668265263) >>> 0;
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    v[i] = s / 4294967296;
  }
  return { v, period };
}

const fade = (t) => t * t * (3 - 2 * t);

function noiseAt(L, x, y) {
  const p = L.period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const ix = ((x0 % p) + p) % p;
  const iy = ((y0 % p) + p) % p;
  const jx = (ix + 1) % p;
  const jy = (iy + 1) % p;
  const a = L.v[iy * p + ix];
  const b = L.v[iy * p + jx];
  const c = L.v[jy * p + ix];
  const d = L.v[jy * p + jx];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * A height field for one kind of surface, in 0..1.
 *
 * The octave list decides the character rather than just the scale: cloth wants
 * a fine even weave, cast armour wants broad shallow pits, and a track pad
 * wants something close to gravel. They are all the same three octaves with the
 * weights moved about, which is enough — nobody is going to press their face
 * against a tank.
 */
function heightField(octaves) {
  const layers = octaves.map((o, i) => ({ L: lattice(o[0], 17 + i * 91), f: o[0], a: o[1] }));
  const h = new Float32Array(TILE * TILE);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let sum = 0;
      for (const l of layers) {
        sum += noiseAt(l.L, (x / TILE) * l.f, (y / TILE) * l.f) * l.a;
      }
      h[y * TILE + x] = sum;
      if (sum < lo) lo = sum;
      if (sum > hi) hi = sum;
    }
  }
  const span = hi - lo || 1;
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / span;
  return h;
}

/** Slope of the height field, wrapped, as a tangent-space normal map. */
function normalTexture(h, strength) {
  const data = new Uint8Array(TILE * TILE * 4);
  const at = (x, y) => h[(((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // z is 1 before normalising, so a flat patch comes out as straight up
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * TILE + x) * 4;
      data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Roughness and metalness in one sheet.
 *
 * three reads roughness out of the GREEN channel of a roughnessMap and
 * metalness out of the BLUE of a metalnessMap, so one texture handed to both
 * slots carries the two of them for the price of one bind. What this buys is
 * the thing a single roughness number cannot: a surface that is worn bright on
 * the edges and dull in the hollows, which is what makes used equipment look
 * used.
 */
function grainTexture(h, roughSpread, metalSpread) {
  const data = new Uint8Array(TILE * TILE * 4);
  for (let i = 0; i < TILE * TILE; i++) {
    const n = h[i] - 0.5;
    data[i * 4] = 255;
    data[i * 4 + 1] = Math.max(0, Math.min(255, (1 + n * roughSpread) * 255));
    data[i * 4 + 2] = Math.max(0, Math.min(255, (1 + n * metalSpread) * 255));
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// The three grains everything on the field is made of. Built on first use, not
// on import: a device that falls back to the flat map should not pay for them.
const CACHE = new Map();
function grainPair(name) {
  let g = CACHE.get(name);
  if (g) return g;
  let h;
  let nStrength;
  let rSpread;
  let mSpread;
  if (name === 'cloth') {
    // a fine even weave with a slow slub through it
    h = heightField([[64, 1], [16, 0.5], [6, 0.35]]);
    nStrength = 5;
    rSpread = 0.18;
    mSpread = 0;
  } else if (name === 'metal') {
    // broad shallow pits and rolled-plate waviness, plus a little tooling
    h = heightField([[8, 1], [22, 0.42], [70, 0.2]]);
    nStrength = 3.2;
    rSpread = 0.5;
    mSpread = 0.34;
  } else {
    // rock, mud, concrete, bark: coarse, with rubble in it
    h = heightField([[10, 1], [30, 0.6], [90, 0.42]]);
    nStrength = 7;
    rSpread = 0.34;
    mSpread = 0;
  }
  g = { normal: normalTexture(h, nStrength), grain: grainTexture(h, rSpread, mSpread) };
  CACHE.set(name, g);
  return g;
}

/**
 * What each kind of thing on the battlefield is.
 *
 * These numbers are the whole point of the file, so they are worth reading as a
 * list rather than hunting through the code for. Roughness is the one that does
 * the work: below about 0.4 the sun draws a hard highlight and the thing reads
 * as polished, above 0.9 it reads as dust and felt, and armour lives in the
 * band between, where it catches a broad soft sheen along a sloped plate.
 */
const KIND = {
  //          grain    rough  metal  normal  repeat
  cloth: ['cloth', 0.94, 0.0, 0.9, 9], // greatcoats, packs, webbing
  skin: ['cloth', 0.72, 0.0, 0.4, 6],
  armour: ['metal', 0.62, 0.28, 0.7, 3], // painted plate, worn back to the primer
  steel: ['metal', 0.44, 0.65, 0.8, 5], // gun tubes, barrels, bare metal
  rubber: ['rock', 0.88, 0.05, 1.0, 7], // track pads, tyres
  wood: ['rock', 0.8, 0.0, 0.55, 4],
  stone: ['rock', 0.86, 0.0, 0.9, 2.2],
  concrete: ['rock', 0.9, 0.0, 0.7, 2.6],
  earth: ['rock', 0.95, 0.0, 1.0, 1.6],
  foliage: ['cloth', 0.82, 0.0, 0.5, 5],
  plain: ['cloth', 0.85, 0.0, 0.0, 1],
};

/**
 * A surface.
 *
 * @param kind one of the table above
 * @param opts anything a MeshStandardMaterial takes; colour, transparency and
 *             side all pass straight through
 */
export function surface(kind, opts) {
  const k = KIND[kind] || KIND.plain;
  const mat = new THREE.MeshStandardMaterial(
    Object.assign({ color: 0xffffff, roughness: k[1], metalness: k[2] }, opts || {}),
  );
  if (k[3] > 0) {
    const pair = grainPair(k[0]);
    const r = k[4];
    // The repeat lives on a CLONE of the shared tile, so two surfaces that want
    // the grain at different scales do not fight over one number. A clone
    // shares the uploaded image; only the sampler settings differ.
    const nm = r === 1 ? pair.normal : pair.normal.clone();
    const rm = r === 1 ? pair.grain : pair.grain.clone();
    if (r !== 1) {
      nm.repeat.set(r, r);
      rm.repeat.set(r, r);
      nm.needsUpdate = true;
      rm.needsUpdate = true;
    }
    mat.normalMap = nm;
    mat.normalScale = new THREE.Vector2(k[3], k[3]);
    mat.roughnessMap = rm;
    if (k[2] > 0) mat.metalnessMap = rm;
  }
  return mat;
}

/**
 * The light that is not the sun.
 *
 * A directional light and a hemisphere light between them can say which way a
 * surface faces and no more. What they cannot do is put anything in a roughness
 * map worth having: with nothing in the sky to reflect, every metal on the
 * field renders BLACK, and every painted plate loses the one broad sheen along
 * it that says it is painted plate. This makes a small sky to reflect —
 * horizon, zenith, ground bounce and a sun — and hands it to the scene, which
 * three then applies to every physical material in it without another line
 * being written anywhere else.
 *
 * Needs a renderer, so it is called from scene.js and never from the headless
 * probe; every material above works perfectly well without it, only duller.
 */
export function buildEnvironment(renderer) {
  const W = 64;
  const H = 32;
  const data = new Float32Array(W * H * 4);
  const set = (i, r, g, b) => {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 1;
  };
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1); // 0 at the zenith, 1 at the nadir
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (t < 0.5) {
        // sky: deep overhead, pale and warm down at the horizon
        const k = t / 0.5;
        set(i, 0.28 + 0.5 * k, 0.42 + 0.46 * k, 0.72 + 0.24 * k);
      } else {
        // the ground bounce, which is the whole of what fills the underside of
        // a hull and the inside of a man's sleeve
        const k = (t - 0.5) / 0.5;
        set(i, 0.3 - 0.14 * k, 0.27 - 0.13 * k, 0.2 - 0.1 * k);
      }
    }
  }
  // A sun in it. Reflected in a gun tube this is the highlight that runs along
  // the barrel, and there is nothing else in the scene that can produce one.
  const sy = Math.floor(H * 0.3);
  const sx = Math.floor(W * 0.25);
  for (let y = sy - 2; y <= sy + 2; y++) {
    for (let x = sx - 3; x <= sx + 3; x++) {
      const d = Math.hypot((x - sx) / 3, (y - sy) / 2);
      if (d > 1) continue;
      const i = (y * W + ((x + W) % W)) * 4;
      const k = (1 - d) * 18;
      data[i] += k;
      data[i + 1] += k * 0.93;
      data[i + 2] += k * 0.78;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return target.texture;
}

// ═══════════════════════════════════════════════════════════════════════════
// COLOUR, AND THE ONE BUG THAT MADE THE WHOLE BATTLEFIELD LOOK WASHED OUT
//
// Every palette in this game is authored the way palettes always are: someone
// picks a hex that looks right, and #43452F is a dark olive. Those numbers were
// then divided by 255 and handed straight to the renderer as REFLECTANCE — as
// the fraction of the light landing on that ground that bounces off it.
//
// They are not the same number. #43452F is a dark olive on a screen because a
// screen is not linear: the same colour reflects about seven percent of the
// light on it, not twenty-nine. Used as reflectance the field came out four
// times too bright, the roads and the village streets — authored paler still —
// ran off the top of the tone curve into flat white, and the whole map lost its
// contrast at both ends at once. That is the "low detail, washed out" look, and
// no amount of extra noise in the ground shader can fix it, because the detail
// was there all along and was being blown off the top of the scale.
//
// So: authored colours are sRGB and are converted. The gain afterwards is the
// honest half of the bargain — a palette is written as "what this should look
// like once it is lit", not as a reflectance, so converting alone lands
// everything about half as bright as it was drawn to be. At this gain the
// battlefield's ground sits at about a sixth to a fifth, which is what soil and
// dry grass actually reflect, and the sun is then set to light it.
// ═══════════════════════════════════════════════════════════════════════════
export const ALBEDO_GAIN = 2.35;

/** One channel of an authored colour, as a reflectance. */
export function toAlbedo(c) {
  const lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const v = lin * ALBEDO_GAIN;
  return v > 1 ? 1 : v;
}

/**
 * An authored colour, into a THREE.Color, as a reflectance.
 *
 * @param k an optional straight scale applied AFTER the conversion — wear,
 *          weathering, the light off a dead man — so it behaves the way a
 *          dimmer behaves rather than the way a gamma curve does
 */
export function albedo(target, r, g, b, k) {
  target.setRGB(r, g, b, THREE.SRGBColorSpace);
  target.multiplyScalar(ALBEDO_GAIN * (k === undefined ? 1 : k));
  if (target.r > 1) target.r = 1;
  if (target.g > 1) target.g = 1;
  if (target.b > 1) target.b = 1;
  return target;
}

/** Throw away the shared tiles. Only the last battlefield standing calls this. */
export function disposeMaterials() {
  for (const g of CACHE.values()) {
    g.normal.dispose();
    g.grain.dispose();
  }
  CACHE.clear();
}
