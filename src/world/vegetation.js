// Where things grow.
//
// Trees are not scattered on a map, they are where the water is. A wood sits in
// the valley and along the draws because that is where the ground stays damp;
// the ridge above it is bare because the rain runs off it; the dry side of the
// country has none at all without anyone deciding that. Given the moisture
// field that hydrology.js works out from the height alone, all of that follows.
//
// This only says WHERE. Planting a trunk, marking the cover it gives and
// felling it later belong to the engine; this hands back a list of positions.
//
// Determinism: it carries its own generator, seeded from the match seed, and
// consumes nothing from the simulation's shared stream — so the same seed grows
// the same wood, and adding a tree here cannot shift a shot fired somewhere else.

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

/**
 * Scatter woodland over damp, gentle, open ground.
 *
 * @param seed     the match seed
 * @param field    { TW, TH, TG, moisture, slopeAt(i), open(i) }
 * @param opts     { wet: how damp before anything grows, density, size:[lo,hi] }
 * @returns        [{x, y, s, gr}] — position, size and how green it is
 */
export function scatterWoodland(seed, field, opts = {}) {
  const rnd = makeRng(seed ^ 0x2f6b1d43); // a stream of its own
  const { TW, TH, TG, moisture } = field;
  const wetAt = opts.wet === undefined ? 0.52 : opts.wet;
  const density = opts.density === undefined ? 0.55 : opts.density;
  const lo = opts.size ? opts.size[0] : 9;
  const hi = opts.size ? opts.size[1] : 16;
  const out = [];

  for (let gy = 1; gy < TH - 1; gy++) {
    for (let gx = 1; gx < TW - 1; gx++) {
      const i = gy * TW + gx;
      if (!field.open(i)) continue;
      const w = moisture[i];
      if (w <= wetAt) continue;
      // Steep ground sheds its water and holds no soil, so it holds no wood
      // either — which is what leaves the ridges bare and picks out the valleys.
      const slope = field.slopeAt(i);
      const chance = ((w - wetAt) / (1 - wetAt)) * density * Math.max(0, 1 - slope * 9);
      if (rnd() > chance) continue;
      out.push({
        x: gx * TG + rnd() * TG,
        y: gy * TG + rnd() * TG,
        s: lo + rnd() * (hi - lo),
        // Wetter ground grows greener, which is most of what tells a valley
        // from a hillside when you are looking straight down at it.
        gr: (64 + w * 42 + rnd() * 16) | 0,
      });
    }
  }
  return out;
}
