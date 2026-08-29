// The crossings, built rather than implied.
//
// Until now a "bridge" was a gap in the water: carveWater() simply declined to
// mark the channel impassable for a stretch, and the 3D field drew nothing at
// all there. The label on the flat map said ROAD BRIDGE and the battlefield
// showed a river with a bit of bank beside it. This builds the thing.
//
// A bridge here is a road that stays level while the ground beneath it falls
// away into the valley — which is the whole reason a bridge exists and the
// thing that makes one look like one. The deck is laid at the height of the
// higher bank, the piers reach down from it to whatever the ground happens to
// be doing underneath, and the two ends ramp down to meet the road on each
// side. A ford gets no deck: it gets a stone apron and a line of posts, because
// a ford is a place where the river is shallow, not a structure.
//
// Nothing here is cover the simulation knows about. What a bridge DOES to a man
// walking over it is decided in the terrain model; this is only what he sees.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';

// A deck two lanes wide, and long enough to land on dry ground at both ends.
// The channel is about 130 units across and the marsh either side takes it to
// 200, so a span under 300 would stand in the water it is supposed to cross.
const DECK_HW = 62; // half-width of the roadway - two lanes and a footway each side
const RAIL_H = 13;
const PIER_W = 34;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function box() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0); // sits ON its y, so a height is a height
  return g;
}

/** How far the deck has to reach to land on ground that is above the water. */
function spanFor(terrain, cx, cy, deckY) {
  let out = 150;
  for (let d = 150; d < 900; d += 20) {
    const l = groundY(terrain, cx - d, cy);
    const r = groundY(terrain, cx + d, cy);
    out = d;
    // Both banks up within a couple of metres of the roadway: that is where the
    // ramps can touch down without a step in the road.
    if (l > deckY - 26 && r > deckY - 26) break;
  }
  return out;
}

/**
 * @param scene   where to put them
 * @param view    the world view; reads view.cross and view.terrain
 */
export function buildBridges(scene, view) {
  const terrain = view.terrain;
  const list = view.cross || [];
  const parts = [];

  // Concrete, and the darker stone of the piers and abutments. Flat-lit rather
  // than shiny: wet concrete under a midday sun is the one thing that would
  // read as plastic.
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x9a958b });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6f6a61 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x8d8880 });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x5d4d38 });
  const mats = [deckMat, stoneMat, railMat, woodMat];

  const geo = box();
  const bucket = (mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    parts.push(m);
    return m;
  };
  // Counted generously: three crossings, and the biggest is a deck, two
  // abutments, five piers and two runs of parapet.
  const decks = bucket(deckMat, list.length * 6 + 2);
  const stones = bucket(stoneMat, list.length * 10 + 2);
  const rails = bucket(railMat, list.length * 40 + 2);
  const posts = bucket(woodMat, list.length * 24 + 2);

  const put = (mesh, x, y, z, yaw, sx, sy, sz) => {
    Q.setFromAxisAngle(UP, yaw);
    P.set(x, y, z);
    S.set(sx, sy, sz);
    M.compose(P, Q, S);
    mesh.setMatrixAt(mesh.count++, M);
  };

  for (const c of list) {
    // Square to the WATER, not to the map: the channel wanders, and a deck laid
    // on the map's axis meets a leaning river at an angle and leaves a corner of
    // itself in the stream.
    const yaw = Math.atan2(-c.slope, 1);
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    // local +X is across the water
    const at = (u, v) => [c.x + u * cs + v * sn, c.y - u * sn + v * cs];

    if (c.type === 'ford') {
      // No structure. A stone apron where carts have worn the bank down, and a
      // line of posts so you can find it in the dark.
      for (let u = -150; u <= 150; u += 30) {
        const [px, pz] = at(u, 0);
        const g = groundY(terrain, px, pz);
        put(stones, px, g - 3, pz, yaw + u * 0.004, 34, 4, 120);
      }
      for (const side of [-1, 1]) {
        for (let u = -140; u <= 140; u += 40) {
          const [px, pz] = at(u, side * 78);
          put(posts, px, groundY(terrain, px, pz) - 2, pz, yaw, 4, 22, 4);
        }
      }
      continue;
    }

    // ---- a road bridge ----
    // The deck stands at the height of the higher bank, so the road stays level
    // and the valley falls away beneath it.
    const bankL = groundY(terrain, c.x - 320, c.y);
    const bankR = groundY(terrain, c.x + 320, c.y);
    const deckY = Math.max(bankL, bankR) + 16;
    const half = spanFor(terrain, c.x, c.y, deckY);

    // the roadway itself, in segments so it can follow its own slight camber
    const N = 14;
    for (let i = 0; i < N; i++) {
      const u = -half + ((i + 0.5) / N) * half * 2;
      const [px, pz] = at(u, 0);
      const camber = 6 * (1 - (u / half) * (u / half)); // a shallow rise mid-span
      put(decks, px, deckY + camber - 5, pz, yaw, (half * 2) / N + 2, 6, DECK_HW * 2);
    }

    // piers, down from the deck to whatever is under them
    for (let i = -2; i <= 2; i++) {
      const u = (i / 2.6) * half;
      const [px, pz] = at(u, 0);
      const g = groundY(terrain, px, pz);
      const h = deckY - g + 4;
      if (h < 10) continue;
      put(stones, px, g - 2, pz, yaw, PIER_W, h, PIER_W * 1.5);
      // a cutwater on the upstream face, which is what stops a pier reading as
      // a lamp post standing in a river
      put(stones, px, g - 2, pz + PIER_W * 0.95, yaw, PIER_W * 0.7, h * 0.8, PIER_W * 0.7);
    }

    // abutments: the heavy blocks the deck lands on at each bank
    for (const side of [-1, 1]) {
      const [px, pz] = at(side * (half + 26), 0);
      const g = groundY(terrain, px, pz);
      put(stones, px, g - 4, pz, yaw, 70, Math.max(12, deckY - g + 6), DECK_HW * 2.3);
    }

    // the ramps: the road coming down off the deck to meet the ground
    for (const side of [-1, 1]) {
      for (let k = 0; k < 7; k++) {
        const u = side * (half + 40 + k * 46);
        const [px, pz] = at(u, 0);
        const g = groundY(terrain, px, pz);
        const t = k / 6;
        const y = deckY * (1 - t) + (g + 4) * t;
        put(decks, px, y - 5, pz, yaw, 48, 6, DECK_HW * 2 - k * 3);
      }
    }

    // parapets down both edges, in short lengths so they follow the camber
    for (const side of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        const u = -half + ((i + 0.5) / N) * half * 2;
        const [px, pz] = at(u, side * DECK_HW);
        const camber = 6 * (1 - (u / half) * (u / half));
        put(rails, px, deckY + camber + 1, pz, yaw, (half * 2) / N + 2, RAIL_H, 7);
      }
    }
  }

  for (const m of parts) m.instanceMatrix.needsUpdate = true;

  return {
    meshes: parts,
    counts: { deck: decks.count, stone: stones.count, rail: rails.count, post: posts.count },
    dispose() {
      for (const m of parts) scene.remove(m);
      geo.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
