// Roads, routed rather than drawn.
//
// A road is not a line somebody put on a map. It is the cheapest way somebody
// found between two places they cared about, and everything about how it looks
// follows from that: it swings wide of the steep ground, it takes the shortest
// crossing over a river, it runs along a contour instead of straight up a hill,
// and once one road exists the next one joins it rather than running beside it.
//
// So: give this the ground and the places that matter, and it finds the ways
// between them. What comes out is a network — polylines in world units, with
// the river crossings marked, because a crossing is a bridge and a bridge is
// the most fought-over thing on any battlefield.
//
// Deterministic and free of randomness: same ground, same roads.

/**
 * Cheapest path between two cells.
 *
 * A* rather than Dijkstra, and searched inside a box around the two ends: a
 * battlefield is thirty-five thousand cells and a map wants twenty roads, so
 * flooding the whole grid twenty times is three seconds of the player staring
 * at a frozen screen. Guided and bounded, it is a few milliseconds.
 */
function shortest(costOf, TW, TH, from, to) {
  const n = TW * TH;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = [];

  const push = (i, d) => {
    heap.push([d, i]);
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

  const tx = to % TW;
  const ty = (to / TW) | 0;
  // Only look in a generous box around the two ends. A road that would leave it
  // to save distance is not a road anyone would build.
  const fx = from % TW;
  const fy = (from / TW) | 0;
  const pad = 16 + Math.hypot(tx - fx, ty - fy) * 0.35;
  const bx0 = Math.max(0, Math.min(fx, tx) - pad);
  const bx1 = Math.min(TW - 1, Math.max(fx, tx) + pad);
  const by0 = Math.max(0, Math.min(fy, ty) - pad);
  const by1 = Math.min(TH - 1, Math.max(fy, ty) + pad);
  // The guess: how far is left, at the price of easy ground. Weighted to trust
  // it, because a road that is a few metres longer than the theoretical best is
  // still a road, and a map that takes three seconds to generate is not a map.
  const heur = (i) => {
    const gx = i % TW;
    const gy = (i / TW) | 0;
    // Weighted by what a step of ordinary ground really costs, not by the
    // theoretical floor of one. On a mountain every step costs many times that,
    // and a guess that says otherwise stops guiding the search at all - which is
    // how a mountain pass takes half a second to find and a plain takes ten
    // milliseconds. A road a few metres off the perfect line is still a road.
    return Math.hypot(tx - gx, ty - gy) * 2.5;
  };
  // A hard stop, so one impossible route cannot hang the battlefield. Sized to
  // the grid: a road that has not been found after covering the search box a
  // couple of times over is a road that is not there - a depot behind a cliff,
  // an island - and the honest answer is to leave it off the network.
  let budget = TW * TH * 0.8;

  dist[from] = 0;
  push(from, heur(from));
  while (heap.length) {
    const [, i] = pop();
    if (done[i]) continue;
    if (--budget < 0) return null;
    done[i] = 1;
    if (i === to) break;
    // The heap is keyed on cost-so-far PLUS the guess; the cost so far is the
    // one to build on. Adding to the key instead would compound the guess at
    // every step, and nothing would ever look cheap enough to follow.
    const g0 = dist[i];
    const gx = i % TW;
    const gy = (i / TW) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
        const j = ny * TW + nx;
        if (done[j]) continue;
        const step = dx && dy ? Math.SQRT2 : 1;
        const c = costOf(i, j) * step;
        if (!(c < Infinity)) continue;
        const nd = g0 + c;
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = i;
          push(j, nd + heur(j));
        }
      }
    }
  }
  if (dist[to] === Infinity) return null;
  const path = [];
  for (let i = to; i >= 0; i = prev[i]) {
    path.push(i);
    if (i === from) break;
  }
  return path.reverse();
}

/** Round off a grid path so it reads as a road and not as a staircase. */
function smooth(points, passes = 2) {
  let pts = points;
  for (let p = 0; p < passes; p++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Lay a road network.
 *
 * @param nodes   [{x,y,rank}] the places worth connecting; rank 0 is a capital
 * @param field   { TW, TH, TG, slopeAt(i), isWater(i), blocked(i), roaded(i) }
 * @returns { routes:[{pts, crossings:[{x,y}]}], onRoad:Uint8Array }
 */
export function layNetwork(nodes, field, opts = {}) {
  const { TW, TH, TG } = field;
  const onRoad = new Uint8Array(TW * TH);
  const routes = [];
  if (nodes.length < 2) return { routes, onRoad };

  // Route on a coarser grid than the ground is stored at. A road does not need
  // to be placed to the metre — it needs to find the pass and the bridge — and
  // searching a quarter as many cells is the difference between a map that
  // appears and a map you wait for.
  const step = Math.max(1, opts.step || 2);
  const CW = Math.ceil(TW / step);
  const CH = Math.ceil(TH / step);
  const fine = (c) => {
    const cx = c % CW;
    const cy = (c / CW) | 0;
    const gx = Math.min(TW - 1, cx * step);
    const gy = Math.min(TH - 1, cy * step);
    return gy * TW + gx;
  };
  const cellOf = (p) => {
    const cx = Math.max(0, Math.min(CW - 1, (p.x / TG / step) | 0));
    const cy = Math.max(0, Math.min(CH - 1, (p.y / TG / step) | 0));
    return cy * CW + cx;
  };

  // What it costs to move onto a cell. Slope is the dominant term, because a
  // cart cannot climb; water is expensive but not impossible, which is exactly
  // what makes the road choose one narrow place to cross; and an existing road
  // is nearly free, so the second route joins the first instead of shadowing it.
  const costOf = (from, coarse) => {
    const to = fine(coarse);
    if (field.blocked(to)) return Infinity;
    const slope = field.slopeAt(to);
    let c = 1 + slope * slope * 260;
    // Water is dear, so a road only takes it where it must — and cheap at the
    // places the ground already offers a way over, so every road for miles
    // funnels onto the same bridge. Which is the point of a bridge.
    if (field.isWater(to)) c += field.crossable(to) ? 3 : 40;
    if (onRoad[to] || field.roaded(to)) c *= 0.25; // join the road, do not shadow it
    return c;
  };

  // Which pieces of ground can reach which, worked out once.
  //
  // Without this, a depot walled in by cliffs is discovered by searching every
  // cell in the box for a way out that is not there — and then discovered again
  // for the next place, and the next. One flood fill up front turns every one of
  // those searches into a lookup, and it is also the honest answer to "is this
  // battlefield actually joined up".
  const comp = new Int32Array(CW * CH).fill(-1);
  {
    let next = 0;
    const queue = new Int32Array(CW * CH);
    for (let start = 0; start < comp.length; start++) {
      if (comp[start] >= 0 || field.blocked(fine(start))) continue;
      const id = next++;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      comp[start] = id;
      while (head < tail) {
        const c = queue[head++];
        const cx = c % CW;
        const cy = (c / CW) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
            const j = ny * CW + nx;
            if (comp[j] >= 0 || field.blocked(fine(j))) continue;
            comp[j] = id;
            queue[tail++] = j;
          }
        }
      }
    }
  }

  // Connect the places up: nearest-neighbour first, which gives a spine, then
  // one extra link per node so the result is a network with alternatives rather
  // than a tree with one way through.
  const linked = new Set();
  const key = (a, b) => Math.min(a, b) + ':' + Math.max(a, b);
  const pairs = [];
  // The capitals are joined to each other first, whatever it costs. That is the
  // road the war is fought along, and it is the one that has to find the bridge.
  const caps = nodes.map((n, i) => (n.rank === 0 ? i : -1)).filter((i) => i >= 0);
  for (let a = 0; a < caps.length; a++)
    for (let b = a + 1; b < caps.length; b++) pairs.push([caps[a], caps[b], -1]);
  for (let i = 0; i < nodes.length; i++) {
    const order = nodes
      .map((n, j) => ({ j, d: Math.hypot(n.x - nodes[i].x, n.y - nodes[i].y) }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d);
    const want = nodes[i].rank === 0 ? 3 : 2;
    for (let k = 0; k < Math.min(want, order.length); k++) pairs.push([i, order[k].j, order[k].d]);
  }
  pairs.sort((a, b) => a[2] - b[2]);

  for (const [a, b] of pairs) {
    if (linked.has(key(a, b))) continue;
    linked.add(key(a, b));
    const ca = cellOf(nodes[a]);
    const cb = cellOf(nodes[b]);
    // A place standing on ground nothing can cross has no road to it, and
    // neither has one on the far side of a wall of cliffs. Both are known
    // before a single cell is searched.
    if (field.blocked(fine(ca)) || field.blocked(fine(cb))) continue;
    if (comp[ca] !== comp[cb]) continue;
    const path = shortest(costOf, CW, CH, ca, cb);
    if (!path) continue;
    const pts = [];
    const crossings = [];
    let wet = false;
    for (const c of path) {
      const i = fine(c);
      onRoad[i] = 1;
      const x = (i % TW) * TG + TG / 2;
      const y = ((i / TW) | 0) * TG + TG / 2;
      pts.push([x, y]);
      const here = field.isWater(i);
      if (here && !wet) crossings.push({ x, y }); // where it takes to the water
      wet = here;
    }
    routes.push({ pts: smooth(pts), crossings, from: a, to: b });
  }
  return { routes, onRoad };
}

/**
 * Can you get from every place to every other one?
 *
 * The check that matters after all of it: a battlefield with an unreachable
 * objective is a broken battlefield, and it is not something you notice by
 * looking at a screenshot.
 */
export function allConnected(nodes, routes) {
  if (nodes.length < 2) return true;
  const seen = new Set([0]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of routes) {
      if (seen.has(r.from) && !seen.has(r.to)) {
        seen.add(r.to);
        grew = true;
      } else if (seen.has(r.to) && !seen.has(r.from)) {
        seen.add(r.from);
        grew = true;
      }
    }
  }
  return seen.size === nodes.length;
}
