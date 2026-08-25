// Land use: the patchwork a countryside is actually divided into.
//
// Ground seen from above is not a wash with blotches on it. It is PARCELS —
// bounded plots that someone ploughs, grazes or leaves fallow — separated by
// hedges, walls and tracks, each worked in its own direction. That patchwork,
// more than colour or texture, is what makes an aerial view read as a real
// place rather than as a painted board, and it is what a war is fought across:
// a hedgerow is cover, a track is an axis of advance, an open field is ground
// nobody wants to cross.
//
// This module only DESCRIBES the land. It returns plain data — polygons, uses,
// bearings — and knows nothing about canvases, the simulation or the engine.
// Painting it is somebody else's job, and so is deciding what a hedge does to a
// man walking through it.
//
// Determinism: it carries its own generator, seeded from the match seed, and
// never touches the engine's shared stream. Two peers given the same seed lay
// out the same countryside; nothing else in the simulation shifts because this
// file ran.

/** The engine's xorshift, kept privately so we consume none of its sequence. */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// What a plot can be. `weight` is how common it is, `furrow` how strongly it is
// worked in one direction — ploughland is unmistakable from the air, pasture
// has no grain at all.
export const USES = [
  { key: 'plough', weight: 3, furrow: 1, tone: [+14, +6, -10] },
  { key: 'wheat', weight: 3, furrow: 0.55, tone: [+26, +20, -18] },
  { key: 'stubble', weight: 2, furrow: 0.35, tone: [+18, +14, -6] },
  { key: 'pasture', weight: 3, furrow: 0, tone: [-10, +12, -12] },
  { key: 'fallow', weight: 2, furrow: 0.15, tone: [+4, -2, -4] },
  { key: 'root', weight: 1, furrow: 0.8, tone: [-6, +4, -14] },
];

// What divides one plot from the next.
export const EDGES = ['hedge', 'hedge', 'hedge', 'wall', 'ditch', 'open'];

const pick = (rnd, list) => list[Math.min(list.length - 1, (rnd() * list.length) | 0)];

function pickUse(rnd) {
  const total = USES.reduce((a, u) => a + u.weight, 0);
  let r = rnd() * total;
  for (const u of USES) {
    r -= u.weight;
    if (r <= 0) return u;
  }
  return USES[0];
}

/**
 * Split a rectangle into plots by cutting it in two, over and over, until the
 * pieces are field-sized. Real enclosure works the same way — a holding is
 * divided between heirs, a field is split when the crop changes — which is why
 * the result looks like farmland and a grid never does.
 *
 * The cut wanders rather than running straight, because a boundary follows a
 * hedge, and a hedge follows the ground.
 */
function subdivide(rnd, x0, y0, x1, y1, minSide, out, depth) {
  const w = x1 - x0;
  const h = y1 - y0;
  // Stop when the plot is small enough, with a little randomness so the
  // patchwork has big fields and small ones instead of all one size.
  if (depth > 9 || (w < minSide * 2 && h < minSide * 2) || (rnd() < 0.12 && depth > 2)) {
    out.push({ x0, y0, x1, y1 });
    return;
  }
  const vertical = w > h ? rnd() < 0.82 : rnd() < 0.18;
  const t = 0.34 + rnd() * 0.32; // never cut down the middle
  if (vertical) {
    const cx = x0 + w * t;
    subdivide(rnd, x0, y0, cx, y1, minSide, out, depth + 1);
    subdivide(rnd, cx, y0, x1, y1, minSide, out, depth + 1);
  } else {
    const cy = y0 + h * t;
    subdivide(rnd, x0, y0, x1, cy, minSide, out, depth + 1);
    subdivide(rnd, x0, cy, x1, y1, minSide, out, depth + 1);
  }
}

/**
 * Lay out the countryside.
 *
 * @param {number} seed      the match seed; the same seed gives the same fields
 * @param {number} W,H       world size
 * @param {object} opts      { minSide, wander, density }
 * @returns {{parcels:Array, minSide:number}}
 */
export function makeLanduse(seed, W, H, opts = {}) {
  const rnd = makeRng(seed ^ 0x5f3a91c7); // a stream of its own
  const minSide = opts.minSide || 300;
  const wander = opts.wander === undefined ? 54 : opts.wander;

  const boxes = [];
  subdivide(rnd, 0, 0, W, H, minSide, boxes, 0);

  const parcels = boxes.map((b) => {
    const use = pickUse(rnd);
    // Corners are nudged, and then every side is broken into segments that
    // wander off the straight line between them. Enclosure is roughly
    // rectangular — that part is real — but a boundary is a hedge, and a hedge
    // follows a ditch or a slope or an old argument about where the line went.
    // Straight edges are what make a patchwork look like graph paper.
    const j = () => (rnd() - 0.5) * wander;
    const corners = [
      [b.x0 + j(), b.y0 + j()],
      [b.x1 + j(), b.y0 + j()],
      [b.x1 + j(), b.y1 + j()],
      [b.x0 + j(), b.y1 + j()],
    ];
    const poly = [];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const steps = 3;
      poly.push([ax, ay]);
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        // Least wander near the corners, most in the middle, so neighbouring
        // plots still meet at the same points and no gaps open between them.
        const swing = Math.sin(t * Math.PI) * (rnd() - 0.5) * len * 0.11;
        poly.push([ax + dx * t + nx * swing, ay + dy * t + ny * swing]);
      }
    }
    return {
      poly,
      use: use.key,
      tone: use.tone,
      furrow: use.furrow,
      // Ploughing follows the long axis of the plot, as it does in life: fewer
      // turns for the team at the headland.
      bearing: (b.x1 - b.x0 > b.y1 - b.y0 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.4,
      edge: pick(rnd, EDGES),
      cx: (b.x0 + b.x1) / 2,
      cy: (b.y0 + b.y1) / 2,
      w: b.x1 - b.x0,
      h: b.y1 - b.y0,
      shade: 0.86 + rnd() * 0.28, // no two plots the same
    };
  });

  return { parcels, minSide };
}
