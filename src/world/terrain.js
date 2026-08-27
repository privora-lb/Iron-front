// The battlefield as data.
//
// One cell of ground carries everything anyone needs to know about it: what it
// is, how high it stands, how churned it is, how fast you cross it, how much of
// a shell it takes off you, how well it hides you, and whether you can see
// through it. The simulation and the renderer both read THIS, which is what
// stops a wood that looks thick from behaving like open grass.
//
// The numbers live next door in ../data/ground.js, as a table you can read down
// a column. This file is the machinery: it owns the arrays, answers questions
// about a position, and knows nothing about canvases, squads or orders.
//
// Storage is four parallel arrays rather than an array of cell objects. A
// battlefield is 237 x 150 cells and the movement query runs for every soldier
// every tick, so this is the difference between a phone holding 60fps and not.
// `cellAt()` builds the tidy record when something slow — a tooltip, an
// overlay, a test — actually wants one.
//
// Determinism: everything here is a pure read. Nothing in this file touches the
// simulation's random stream, so terrain queries can never desync a match.
import { GROUND, MOB, MOVE_ORDER, COVER_ORDER, SURFACE_ORDER, mobilityOf } from '../data/ground.js';

export { MOB, mobilityOf, GROUND };

// The bits, by the names the engine has always used for them.
export const WOOD = GROUND.wood.bit;
export const MARSH = GROUND.marsh.bit;
export const ROCK = GROUND.rock.bit;
export const WATER = GROUND.water.bit;
export const FORD = GROUND.ford.bit;
export const STONE = GROUND.stone.bit;
export const BUILD = GROUND.build.bit;
export const SCORCH = GROUND.scorch.bit;
export const CLIFF = GROUND.cliff.bit;
export const WIRED = GROUND.wire.bit;
export const TRENCHED = GROUND.trench.bit;
export const FIELD = GROUND.crop.bit;
export const ROAD = GROUND.road.bit;
export const RUBBLE = GROUND.rubble.bit;

// Masks built from the table, so adding a row to ground.js is enough to make it
// block a shot or stop a tank. Nothing below hardcodes a bit.
const maskOf = (test) =>
  Object.keys(GROUND).reduce((m, k) => (test(GROUND[k]) ? m | GROUND[k].bit : m), 0);

export const HARD_ALL = maskOf((g) => g.hard === 'all');
export const HARD_MOUNTED = maskOf((g) => g.hard === 'mounted');
export const BLIND = maskOf((g) => g.blind);
// A treeline is not a wall: one step of height sees over the wood, a
// building or a cliff face takes two.
export const BLIND_TALL = maskOf((g) => g.blind && g.tall);

// The ordered lists, resolved to [bit, row] pairs once, so the hot loops walk a
// short array instead of a table of strings.
const MOVE_ROWS = MOVE_ORDER.map((k) => [GROUND[k].bit, GROUND[k].move]);
const COVER_ROWS = COVER_ORDER.map((k) => [GROUND[k].bit, GROUND[k].cover]);
const HIDE_ROWS = Object.keys(GROUND)
  .filter((k) => GROUND[k].hide > 0)
  .map((k) => [GROUND[k].bit, GROUND[k].hide]);
const SURFACE_ROWS = SURFACE_ORDER.map((k) => [GROUND[k].bit, k]);

/** A fresh, empty battlefield of W x H world units, in cells of TG a side. */
export function makeTerrain(W, H, TG) {
  const TW = Math.ceil(W / TG);
  const TH = Math.ceil(H / TG);
  const n = TW * TH;
  return {
    W,
    H,
    TG,
    TW,
    TH,
    flags: new Uint16Array(n), // what the cell IS — the bits above
    elev: new Uint8Array(n), // playable height, 0..3
    height: new Float32Array(n), // the continuous field the rest is derived from
    churn: new Float32Array(n), // how badly it has been chewed up, 0..1
  };
}

const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Cell index under a world position, clamped to the map. */
export function idx(t, x, y) {
  return cl((y / t.TG) | 0, 0, t.TH - 1) * t.TW + cl((x / t.TG) | 0, 0, t.TW - 1);
}

export const flagsAt = (t, x, y) => t.flags[idx(t, x, y)];
export const elevAt = (t, x, y) => t.elev[idx(t, x, y)];
export const heightAt = (t, x, y) => t.height[idx(t, x, y)];
export const churnAt = (t, x, y) => t.churn[idx(t, x, y)];

/**
 * How fast `mob` crosses this cell, as a multiplier on its speed.
 *
 * Multiplicative on purpose: a wired trench in the mud is all three at once.
 * The order is fixed in ground.js so the arithmetic is reproducible to the last
 * bit — two peers stepping the same soldier must get the same float.
 */
export function moveMul(t, x, y, mob) {
  if (mob === MOB.air) return 1; // the ground means nothing up there
  const i = idx(t, x, y);
  const f = t.flags[i];
  let m = 1;
  for (let k = 0; k < MOVE_ROWS.length; k++) if (f & MOVE_ROWS[k][0]) m *= MOVE_ROWS[k][1][mob];
  // Mud drags — but a metalled road does not turn to mud, which is what makes
  // it worth holding for the whole battle rather than the first ten minutes.
  if (!(f & ROAD)) m *= 1 - 0.11 * t.churn[i];
  return m;
}

/** Uphill costs, downhill carries you. */
export function slopeMul(t, x, y, ang) {
  const e0 = elevAt(t, x, y);
  const e1 = elevAt(t, x + Math.cos(ang) * 26, y + Math.sin(ang) * 26);
  if (e1 > e0) return 0.84;
  if (e1 < e0) return 1.16;
  return 1;
}

/** What is left of a hit taken here. 1 is standing in the open. */
export function coverAt(t, x, y, air) {
  const f = flagsAt(t, x, y);
  if (air) return f & WOOD ? 0.6 : 1; // only the canopy hides you from the sky
  let m = 1;
  for (let k = 0; k < COVER_ROWS.length; k++) if (f & COVER_ROWS[k][0]) m *= COVER_ROWS[k][1];
  return m;
}

/**
 * How well this ground hides you from a distant eye, 0..1. Concealment is not
 * cover: standing wheat hides a man completely and stops nothing at all.
 */
export function hideAt(t, x, y) {
  const f = flagsAt(t, x, y);
  let h = 0;
  for (let k = 0; k < HIDE_ROWS.length; k++)
    if (f & HIDE_ROWS[k][0]) h = Math.max(h, HIDE_ROWS[k][1]);
  return h;
}

/** Ground nobody of this class may stand on. `foot` walks into buildings. */
export function hardAt(t, x, y, foot) {
  return (flagsAt(t, x, y) & (foot ? HARD_ALL : HARD_ALL | HARD_MOUNTED)) !== 0;
}

/**
 * Can an eye at (x0,y0) see (x1,y1)?
 *
 * Walks the line a cell at a time and stops at the first thing standing in the
 * way. The two end cells are skipped deliberately: a man in a wood can see out
 * of it, and a wood cannot hide a man standing on its far edge from someone
 * beside him.
 *
 * Height beats cover — an observer two steps above the canopy is looking down
 * on it, which is what makes a hill worth taking.
 */
export function sightClear(t, x0, y0, x1, y1, eyeElev) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = Math.hypot(dx, dy);
  if (d <= t.TG) return true;
  const steps = Math.min(96, Math.ceil(d / (t.TG * 0.9)));
  const eye = eyeElev === undefined ? elevAt(t, x0, y0) : eyeElev;
  let last = -1;
  for (let k = 1; k < steps; k++) {
    const u = k / steps;
    const i = idx(t, x0 + dx * u, y0 + dy * u);
    if (i === last) continue;
    last = i;
    const f = t.flags[i];
    if (!(f & BLIND)) continue;
    if (eye > t.elev[i] + (f & BLIND_TALL ? 1 : 0)) continue; // looking down on it
    return false;
  }
  return true;
}

/** How far an eye standing here reaches, before weather and the hour. */
export function sightRange(t, x, y, base) {
  return base * (elevAt(t, x, y) >= 2 ? 1.25 : 1);
}

/** The single answer to "what is he standing in", first match wins. */
export function surfaceAt(t, x, y) {
  const f = flagsAt(t, x, y);
  for (let k = 0; k < SURFACE_ROWS.length; k++)
    if (f & SURFACE_ROWS[k][0]) return SURFACE_ROWS[k][1];
  return 'open';
}

/** How a soldier standing there would say where he is. */
export function describe(t, x, y) {
  const s = surfaceAt(t, x, y);
  if (s !== 'open') return GROUND[s].name;
  if (churnAt(t, x, y) > 0.45) return 'in churned mud';
  const e = elevAt(t, x, y);
  return e >= 2 ? 'on the height' : e === 1 ? 'on the slope' : 'on open ground';
}

/** Local steepness, 0..1ish, from the continuous height field. */
export function slopeAt(t, x, y) {
  const g = t.TG;
  return (
    Math.abs(heightAt(t, x + g, y) - heightAt(t, x - g, y)) +
    Math.abs(heightAt(t, x, y + g) - heightAt(t, x, y - g))
  );
}

/**
 * The whole cell as one tidy record. For overlays, tooltips and tests — never
 * for anything that runs per soldier per tick.
 */
export function cellAt(t, x, y) {
  const i = idx(t, x, y);
  const f = t.flags[i];
  const surface = surfaceAt(t, x, y);
  return {
    i,
    gx: i % t.TW,
    gy: (i / t.TW) | 0,
    flags: f,
    surface,
    name: describe(t, x, y),
    elev: t.elev[i],
    height: t.height[i],
    slope: slopeAt(t, x, y),
    churn: t.churn[i],
    move: [moveMul(t, x, y, MOB.foot), moveMul(t, x, y, MOB.vehicle), moveMul(t, x, y, MOB.gun), 1],
    cover: coverAt(t, x, y, false),
    hide: hideAt(t, x, y),
    blind: (f & BLIND) !== 0,
    hardFoot: hardAt(t, x, y, true),
    hardMounted: hardAt(t, x, y, false),
  };
}

/** Set bits over an ellipse of ground. */
export function stampBlob(t, x, y, rx, ry, bits) {
  const { TG, TW, TH } = t;
  for (let gy = cl(((y - ry) / TG) | 0, 0, TH - 1); gy <= cl(((y + ry) / TG) | 0, 0, TH - 1); gy++)
    for (
      let gx = cl(((x - rx) / TG) | 0, 0, TW - 1);
      gx <= cl(((x + rx) / TG) | 0, 0, TW - 1);
      gx++
    ) {
      const px = gx * TG + TG / 2;
      const py = gy * TG + TG / 2;
      if (((px - x) / rx) ** 2 + ((py - y) / ry) ** 2 <= 1) t.flags[gy * TW + gx] |= bits;
    }
}

/** Set bits along a line of given length and half-width, at a bearing. */
export function stampLine(t, x, y, ang, len, halfW, bits) {
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const step = t.TG * 0.5;
  for (let d = -len / 2; d <= len / 2; d += step) {
    const px = x + cs * d;
    const py = y + sn * d;
    for (let o = -halfW; o <= halfW; o += step) {
      const qx = px - sn * o;
      const qy = py + cs * o;
      if (qx < 0 || qy < 0 || qx >= t.W || qy >= t.H) continue;
      t.flags[idx(t, qx, qy)] |= bits;
    }
  }
}
