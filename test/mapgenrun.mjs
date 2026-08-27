// Natural generation, checked on ground built to have a right answer.
//
// The point of generating a map in an order — height, then water, then roads,
// then what grows — is that each step is a consequence of the one before it.
// That is testable in a way "does it look nice" is not: water must run downhill,
// damp ground must be the low ground, a road must go round a hill rather than
// over it, and a wood must be where the water is.
//
// Prints one JSON line: { ok, fails: [...] }.
import { hydrology, fillSinks, flowAccumulation } from '../src/world/hydrology.js';
import { layNetwork, allConnected } from '../src/world/roads.js';
import { scatterWoodland } from '../src/world/vegetation.js';

const fails = [];
const ok = (cond, what, got) => {
  if (!cond) fails.push(what + (got === undefined ? '' : ' — got ' + JSON.stringify(got)));
};

const TW = 120;
const TH = 80;
const TG = 22;
const at = (gx, gy) => gy * TW + gx;

// A valley running down the middle, with hills either side and a slight fall
// from north to south, so there is one right answer to where the water goes.
const height = new Float32Array(TW * TH);
for (let gy = 0; gy < TH; gy++) {
  for (let gx = 0; gx < TW; gx++) {
    const fromMiddle = Math.abs(gx - TW / 2) / (TW / 2);
    height[at(gx, gy)] = 0.25 + fromMiddle * 0.6 - (gy / TH) * 0.18;
  }
}

/* ---- water runs downhill and gathers ---- */
const H = hydrology(height, TW, TH);
{
  const filled = fillSinks(height, TW, TH);
  let raised = 0;
  for (let i = 0; i < filled.length; i++) if (filled[i] < height[i] - 1e-6) raised++;
  ok(!raised, 'filling the hollows must never lower the ground', raised);

  const { flow, down } = flowAccumulation(filled, TW, TH);
  let uphill = 0;
  for (let i = 0; i < down.length; i++) {
    if (down[i] >= 0 && filled[down[i]] > filled[i] + 1e-6) uphill++;
  }
  ok(!uphill, 'no cell may drain uphill', uphill);

  // the valley floor should carry far more than the hillside above it
  const valley = flow[at(TW / 2, TH - 6)];
  const slopeSide = flow[at(TW / 2 - 40, TH - 6)];
  ok(valley > slopeSide * 8, 'the valley floor should carry the water, not the hillside', [valley, slopeSide]);

  // and the bottom of the map should carry more than the top, because it is downhill
  ok(
    flow[at(TW / 2, TH - 4)] > flow[at(TW / 2, 4)],
    'a river should gather as it goes down, not thin out',
    [flow[at(TW / 2, TH - 4)], flow[at(TW / 2, 4)]],
  );
}

/* ---- damp ground is the low ground ---- */
{
  const wetValley = H.moisture[at(TW / 2, TH / 2)];
  const dryRidge = H.moisture[at(2, TH / 2)];
  ok(wetValley > dryRidge, 'the valley must be damper than the ridge', [wetValley, dryRidge]);
  let outOfRange = 0;
  for (let i = 0; i < H.moisture.length; i++) if (H.moisture[i] < 0 || H.moisture[i] > 1) outOfRange++;
  ok(!outOfRange, 'moisture must stay between nothing and soaked', outOfRange);
}

/* ---- roads go round the hill, not over it ---- */
{
  const slopeAt = (i) => {
    const gx = i % TW;
    const gy = (i / TW) | 0;
    const l = height[at(Math.max(0, gx - 1), gy)];
    const r = height[at(Math.min(TW - 1, gx + 1), gy)];
    const u = height[at(gx, Math.max(0, gy - 1))];
    const d = height[at(gx, Math.min(TH - 1, gy + 1))];
    return Math.hypot(r - l, d - u);
  };
  const nodes = [
    { x: 6 * TG, y: (TH / 2) * TG, rank: 0 },
    { x: (TW - 6) * TG, y: (TH / 2) * TG, rank: 0 },
    { x: (TW / 2) * TG, y: 8 * TG, rank: 2 },
    { x: (TW / 2) * TG, y: (TH - 8) * TG, rank: 2 },
  ];
  const field = {
    TW, TH, TG,
    slopeAt,
    isWater: () => false,
    blocked: () => false,
    roaded: () => false,
    crossable: () => false,
  };
  const t0 = Date.now();
  const net = layNetwork(nodes, field);
  const ms = Date.now() - t0;
  ok(net.routes.length >= nodes.length - 1, 'every place should get a road', net.routes.length);
  ok(allConnected(nodes, net.routes), 'and the network should join all of them up');
  ok(ms < 500, 'laying the roads must not stall the start of a battle', ms + 'ms');

  // The road between the two capitals crosses the valley; it should do it near
  // the flat bottom rather than climbing the shoulder.
  const capital = net.routes.find((r) => (r.from === 0 && r.to === 1) || (r.from === 1 && r.to === 0));
  ok(!!capital, 'the two capitals should be joined directly');
  if (capital) {
    let worst = 0;
    for (const [x, y] of capital.pts) {
      const i = at(Math.min(TW - 1, (x / TG) | 0), Math.min(TH - 1, (y / TG) | 0));
      worst = Math.max(worst, slopeAt(i));
    }
    let ridge = 0;
    for (let gy = 0; gy < TH; gy += 7) ridge = Math.max(ridge, slopeAt(at(8, gy)));
    ok(worst <= ridge * 1.2, 'a road should not climb ground steeper than the hillside it avoided', [worst, ridge]);
  }

  // a wall of cliffs down the middle leaves the two halves genuinely unjoined,
  // and that has to be reported rather than searched for forever
  const walled = {
    ...field,
    blocked: (i) => i % TW === (TW / 2) | 0,
  };
  const t1 = Date.now();
  const cut = layNetwork(nodes, walled);
  ok(Date.now() - t1 < 500, 'an impossible network must fail fast, not hang', Date.now() - t1 + 'ms');
  ok(!allConnected(nodes, cut.routes), 'a battlefield cut in two must say so');
}

/* ---- and the wood grows where the water is ---- */
{
  const open = () => true;
  const slopeAt = () => 0;
  const trees = scatterWoodland(4242, { TW, TH, TG, moisture: H.moisture, slopeAt, open }, { wet: 0.5, density: 0.6 });
  ok(trees.length > 50, 'a damp map should grow a wood', trees.length);

  let inValley = 0;
  for (const t of trees) if (Math.abs(t.x / TG - TW / 2) < TW / 6) inValley++;
  const share = inValley / trees.length;
  ok(share > 0.5, 'most of the wood should be in the valley, where the water is', share.toFixed(2));

  // the same seed grows the same wood, and a different one does not
  const again = scatterWoodland(4242, { TW, TH, TG, moisture: H.moisture, slopeAt, open }, { wet: 0.5, density: 0.6 });
  ok(again.length === trees.length, 'the same seed must grow the same wood');
  const other = scatterWoodland(99, { TW, TH, TG, moisture: H.moisture, slopeAt, open }, { wet: 0.5, density: 0.6 });
  ok(other.length !== trees.length || other[0].x !== trees[0].x, 'a different seed must grow a different one');

  // Dry ground grows nothing. The threshold is 1 rather than 0.999 on purpose:
  // the wettest cells saturate at exactly 1, so ground that is "never wet
  // enough" means wetter than the wettest there is.
  const dry = scatterWoodland(4242, { TW, TH, TG, moisture: H.moisture, slopeAt, open }, { wet: 1, density: 0.6 });
  ok(dry.length === 0, 'ground that never gets wet should stay bare', dry.length);

  // and nothing grows on a cliff face
  const steep = scatterWoodland(4242, { TW, TH, TG, moisture: H.moisture, slopeAt: () => 1, open }, { wet: 0.4, density: 1 });
  ok(steep.length === 0, 'nothing should take root on a cliff', steep.length);
}

console.log(JSON.stringify({ ok: fails.length === 0, checks: 17, fails }));
