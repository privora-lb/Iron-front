// Where the water goes, and what that does to the ground.
//
// A landscape does not have rivers scattered over it. It has ONE thing —
// height — and everything wet is a consequence: rain lands, runs downhill,
// gathers, and where enough of it gathers there is a stream, then a river. The
// ground beside that river is damp, the ground on the ridge above it is not,
// and that difference is why woods grow in the valley and the hilltop is bare.
//
// So this file computes, from the height field alone:
//
//   flow      how much of the map drains through each cell
//   moisture  how wet each cell is, 0..1
//   channel   the cells a real watercourse runs through
//
// Nothing here is random. Given the same ground it gives the same rivers, which
// is what lets the rest of generation lean on it without touching the seeded
// stream the simulation uses.

/** The eight neighbours, and the distance to each. */
const NB = [
  [-1, -1, Math.SQRT2],
  [0, -1, 1],
  [1, -1, Math.SQRT2],
  [-1, 0, 1],
  [1, 0, 1],
  [-1, 1, Math.SQRT2],
  [0, 1, 1],
  [1, 1, Math.SQRT2],
];

/**
 * Fill the pits, so every cell has somewhere to drain to.
 *
 * Raw noise is full of little hollows with no outlet. Left alone, water piles
 * up in each of them and no river ever forms; real ground has had a few million
 * years to fill them in. This is the priority-flood method: start from the
 * edges, and let every cell be at least as high as the lowest way out of it.
 */
export function fillSinks(height, TW, TH, eps = 1e-5) {
  const n = TW * TH;
  const out = new Float32Array(n);
  out.fill(Infinity);
  // A simple binary heap keyed on height — a battlefield is 35,000 cells, and
  // sorting them properly is the difference between instant and a stutter.
  const heap = [];
  const push = (i, h) => {
    heap.push([h, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      const t = heap[p];
      heap[p] = heap[c];
      heap[c] = t;
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        const t = heap[m];
        heap[m] = heap[c];
        heap[c] = t;
        c = m;
      }
    }
    return top;
  };

  for (let gx = 0; gx < TW; gx++) {
    for (const gy of [0, TH - 1]) {
      const i = gy * TW + gx;
      out[i] = height[i];
      push(i, out[i]);
    }
  }
  for (let gy = 1; gy < TH - 1; gy++) {
    for (const gx of [0, TW - 1]) {
      const i = gy * TW + gx;
      out[i] = height[i];
      push(i, out[i]);
    }
  }

  while (heap.length) {
    const [h, i] = pop();
    if (h > out[i]) continue;
    const gx = i % TW;
    const gy = (i / TW) | 0;
    for (let k = 0; k < NB.length; k++) {
      const nx = gx + NB[k][0];
      const ny = gy + NB[k][1];
      if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
      const j = ny * TW + nx;
      if (out[j] !== Infinity) continue;
      out[j] = Math.max(height[j], out[i] + eps);
      push(j, out[j]);
    }
  }
  return out;
}

/**
 * How much ground drains through each cell.
 *
 * Every cell sends its water to its lowest neighbour; do that in order from the
 * highest cell down and each one has already collected everything above it by
 * the time it is reached. The result is the shape of a river system: a fine
 * tracery on the tops, gathering into a few strong lines in the valleys.
 */
export function flowAccumulation(filled, TW, TH) {
  const n = TW * TH;
  const flow = new Float32Array(n);
  flow.fill(1); // every cell catches its own rain
  const down = new Int32Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const gx = i % TW;
    const gy = (i / TW) | 0;
    let best = -1;
    let drop = 0;
    for (let k = 0; k < NB.length; k++) {
      const nx = gx + NB[k][0];
      const ny = gy + NB[k][1];
      if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
      const j = ny * TW + nx;
      const d = (filled[i] - filled[j]) / NB[k][2];
      if (d > drop) {
        drop = d;
        best = j;
      }
    }
    down[i] = best;
  }

  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // highest first, so a cell is always resolved after everything above it
  const idx = Array.from(order).sort((a, b) => filled[b] - filled[a]);
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const j = down[i];
    if (j >= 0) flow[j] += flow[i];
  }
  return { flow, down };
}

/**
 * How wet each cell is, 0..1.
 *
 * Two things make ground damp: water gathering in it, and water sitting beside
 * it. Low ground with a lot draining through is marsh; a ridge with nothing
 * above it is dry however much rain falls on it.
 */
export function moistureField(filled, flow, TW, TH) {
  const n = TW * TH;
  const wet = new Float32Array(n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (filled[i] < lo) lo = filled[i];
    if (filled[i] > hi) hi = filled[i];
  }
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) {
    // log, because flow spans four orders of magnitude and the eye — and the
    // grass — care about the first one
    const gathered = Math.min(1, Math.log(1 + flow[i]) / Math.log(1 + TW * TH * 0.02));
    const low = 1 - (filled[i] - lo) / span;
    wet[i] = Math.min(1, gathered * 0.62 + low * low * 0.55);
  }
  // one blur pass, because damp does not stop at a cell boundary
  const out = new Float32Array(n);
  for (let gy = 0; gy < TH; gy++) {
    for (let gx = 0; gx < TW; gx++) {
      const i = gy * TW + gx;
      let sum = wet[i];
      let cnt = 1;
      for (let k = 0; k < NB.length; k++) {
        const nx = gx + NB[k][0];
        const ny = gy + NB[k][1];
        if (nx < 0 || ny < 0 || nx >= TW || ny >= TH) continue;
        sum += wet[ny * TW + nx];
        cnt++;
      }
      out[i] = sum / cnt;
    }
  }
  return out;
}

/**
 * Everything about the water on one piece of ground, in the order it happens.
 * `channelAt` is the threshold of drainage above which a watercourse is worth
 * drawing — below it the water is there, it is just not a river yet.
 */
export function hydrology(height, TW, TH, opts = {}) {
  const filled = fillSinks(height, TW, TH);
  const { flow, down } = flowAccumulation(filled, TW, TH);
  const moisture = moistureField(filled, flow, TW, TH);
  const channelAt = opts.channelAt || TW * TH * 0.006;
  return { filled, flow, down, moisture, channelAt };
}
