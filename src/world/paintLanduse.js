// Painting the land-use patchwork into the terrain bake.
//
// Kept apart from landuse.js so the layout stays plain data: one file decides
// what the countryside IS, this one decides what it looks like. That split is
// what lets the layout be tested, saved or sent over a wire without dragging a
// canvas along with it.
//
// Everything here is baked once into the ground layer, so the cost is paid at
// the start of a battle and never again.

/** Clamp to a byte. */
const b = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/** '#rrggbb' or 'rgb(...)' → [r,g,b]; anything unparseable falls back to olive. */
function toRgb(css) {
  if (typeof css === 'string' && css[0] === '#' && css.length >= 7) {
    return [
      parseInt(css.slice(1, 3), 16),
      parseInt(css.slice(3, 5), 16),
      parseInt(css.slice(5, 7), 16),
    ];
  }
  const m = /rgba?\(([^)]+)\)/.exec(css || '');
  if (m) {
    const p = m[1].split(',').map((n) => parseFloat(n));
    return [p[0] | 0, p[1] | 0, p[2] | 0];
  }
  return [67, 69, 47];
}

function polyPath(g, poly) {
  g.beginPath();
  g.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
  g.closePath();
}

/**
 * @param g       the bake context, already in world coordinates
 * @param land    what makeLanduse() returned
 * @param baseCss the map's ground colour, so plots read as variations of the
 *                same country rather than as a palette dropped on top of it
 * @param opts    { alpha, hedge } — hedge false paints tone only
 */
export function paintLanduse(g, land, baseCss, opts = {}) {
  const alpha = opts.alpha === undefined ? 0.5 : opts.alpha;
  const base = toRgb(baseCss);

  for (const p of land.parcels) {
    const [dr, dg, db] = p.tone;
    const r = b((base[0] + dr) * p.shade);
    const gg = b((base[1] + dg) * p.shade);
    const bb = b((base[2] + db) * p.shade);

    g.save();
    polyPath(g, p.poly);
    g.clip();

    g.globalAlpha = alpha;
    g.fillStyle = `rgb(${r},${gg},${bb})`;
    g.fill();

    // The grain of the working. A ploughed field seen from the air is stripes
    // and nothing else; pasture has none, which is how you tell them apart at
    // a glance and from a great height.
    if (p.furrow > 0.02) {
      const step = 11 + (1 - p.furrow) * 16;
      const len = Math.hypot(p.w, p.h);
      g.globalAlpha = alpha * 0.42 * p.furrow;
      g.strokeStyle = `rgb(${b(r * 0.82)},${b(gg * 0.82)},${b(bb * 0.8)})`;
      g.lineWidth = 2 + p.furrow * 2.4;
      g.translate(p.cx, p.cy);
      g.rotate(p.bearing);
      g.beginPath();
      for (let o = -len / 2; o <= len / 2; o += step) {
        g.moveTo(-len / 2, o);
        g.lineTo(len / 2, o);
      }
      g.stroke();
    }
    g.restore();
  }

  if (opts.hedge === false) return;

  // Boundaries last, over the top of every plot, so a hedge belongs to both
  // fields it divides instead of being buried under whichever painted second.
  g.globalAlpha = 1;
  for (const p of land.parcels) {
    if (p.edge === 'open') continue;
    g.save();
    polyPath(g, p.poly);
    if (p.edge === 'hedge') {
      g.strokeStyle = 'rgba(38,52,30,.5)';
      g.lineWidth = 7;
      g.stroke();
      g.strokeStyle = 'rgba(74,96,52,.45)';
      g.lineWidth = 3.4;
      g.stroke();
    } else if (p.edge === 'wall') {
      g.strokeStyle = 'rgba(126,122,104,.5)';
      g.lineWidth = 3.4;
      g.stroke();
      g.strokeStyle = 'rgba(30,30,26,.35)';
      g.lineWidth = 1.4;
      g.stroke();
    } else {
      g.strokeStyle = 'rgba(28,34,26,.34)'; // a ditch: a dark seam
      g.lineWidth = 4;
      g.stroke();
    }
    g.restore();
  }
  g.globalAlpha = 1;
}
