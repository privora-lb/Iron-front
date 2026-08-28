// What is actually growing on the ground.
//
// This is the difference between looking at a map of a place and standing in
// one. However well the ground is shaded, bare ground is bare ground: real
// country is covered — grass, scrub, dead bracken, loose stones — and none of
// it is big enough to be worth a thought individually. It is only ever seen out
// of the corner of the eye, and it is the whole of why somewhere feels real.
//
// It cannot be scattered over the whole battlefield: a tuft every eight units
// across five kilometres by three is a quarter of a million of them. So a ring
// of it follows the camera instead. The positions come from a hash of the cell
// they fall in, not from a random number generator, which means a tuft does not
// move when the ring is rebuilt — walk away and come back and the same grass is
// growing in the same place. Nothing here is ever asked about by the
// simulation; it is scenery, and it is drawn only when the camera is close
// enough for it to be anything but noise.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';
import { WATER, FORD, ROAD, STONE, BUILD, RUBBLE, CLIFF, SCORCH } from '../../world/terrain.js';

// Past this the camera is a commander's, not a soldier's, and a tuft of grass
// is a sub-pixel speck that costs a draw call to be invisible.
const SHOW_BELOW = 2400;

// The ring follows the ZOOM, not just the position.
//
// A fixed ring is wrong at both ends. Grown wide enough to reach the horizon
// when the camera is down among the men, it is so thin that grass reads as
// weeds on a bare floor; grown dense enough to be ground cover, it is a small
// green disc sitting in the middle of the battlefield the moment the camera
// pulls back. So the ring is sized against how far the camera is standing and
// the spacing with it, which keeps roughly the same number of tufts across the
// screen at every zoom — dense underfoot, thinning to a texture in the
// distance, which is what it should look like anyway.
const ringFor = (camDist) => Math.max(260, Math.min(2400, camDist * 1.7));
const ACROSS = 168; // candidate patches from the middle to the rim
const MAX_GRASS = 26000;
const MAX_STONE = 1800;

// Nothing grows on the river, the road, the paving or the rubble; nothing grows
// where it has just burned either.
const BARE = WATER | FORD | ROAD | STONE | BUILD | RUBBLE | CLIFF | SCORCH;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A tuft: a few blades leaning out from one root.
 *
 * Flat triangles rather than crossed sheets. Crossed sheets need a cut-out to
 * read as anything but cardboard, and a cut-out needs a texture, and this game
 * has no texture files — but a blade of grass really is a long thin triangle,
 * so drawing it as one costs nothing and is not a cheat.
 */
function tuftGeometry() {
  const pos = [];
  const nrm = [];
  const BLADES = 7;
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + b * 0.7;
    const lean = 0.26 + (b % 3) * 0.12;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = 0.11;
    // root, root, tip — the tip pushed out along the lean so the tuft splays
    pos.push(-w * sa, 0, w * ca);
    pos.push(w * sa, 0, -w * ca);
    pos.push(ca * lean, 1, sa * lean);
    // Face the blade outward and a little up, so a tuft catches light from
    // several directions and does not flicker black as the camera turns.
    for (let k = 0; k < 3; k++) nrm.push(ca * 0.5, 0.8, sa * 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  return g;
}

/** A stone: something with corners, cheap. */
function stoneGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  g.scale(1, 0.62, 0.86);
  g.translate(0, 0.28, 0);
  return g;
}

function instanced(geo, n, scene, opts) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(opts), n);
  m.castShadow = false; // a tuft's shadow is smaller than a shadow-map texel
  m.receiveShadow = false;
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  scene.add(m);
  return m;
}

export function buildClutter(scene) {
  const grass = instanced(tuftGeometry(), MAX_GRASS, scene, {
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  const stones = instanced(stoneGeometry(), MAX_STONE, scene, { color: 0xffffff });

  let atX = 1e9;
  let atY = 1e9;
  let atRing = 1;
  let atId = -1;

  /** Grow the ring around one point. Not cheap, and not done often. */
  function grow(v, cx, cy, ring) {
    const t = v.terrain;
    const STEP = ring / ACROSS;
    let ng = 0;
    let ns = 0;
    const x0 = Math.max(0, cx - ring);
    const x1 = Math.min(t.W, cx + ring);
    const y0 = Math.max(0, cy - ring);
    const y1 = Math.min(t.H, cy + ring);
    const r2 = ring * ring;
    for (let gy = Math.ceil(y0 / STEP); gy * STEP < y1; gy++) {
      for (let gx = Math.ceil(x0 / STEP); gx * STEP < x1; gx++) {
        const h = hash2(gx, gy);
        const h2 = hash2(gx + 7919, gy - 104729);
        const x = gx * STEP + (h - 0.5) * STEP * 0.9;
        const y = gy * STEP + (h2 - 0.5) * STEP * 0.9;
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const cell = ((y / t.TG) | 0) * t.TW + ((x / t.TG) | 0);
        const f = t.flags[cell];
        if (f & BARE) continue;
        // Thick underfoot and thinning away to nothing at the rim, so there is
        // never an edge to the ring — only grass that gets sparser with
        // distance, which is what grass does.
        const near = 1 - d2 / r2;
        const thick = near * near;
        if (h2 > 0.06 + thick * 1.02) continue;
        // A stone now and then rather than grass.
        if (h > 0.955) {
          if (ns >= MAX_STONE) continue;
          const s = (2.2 + h2 * 3.6) * (0.4 + 0.6 * near);
          Q.setFromAxisAngle(UP, h2 * 6.28);
          P.set(x, groundY(t, x, y) - s * 0.15, y);
          S.set(s, s, s);
          M.compose(P, Q, S);
          stones.setMatrixAt(ns, M);
          const g = 0.3 + h2 * 0.16;
          C.setRGB(g * 1.05, g, g * 0.9);
          stones.setColorAt(ns, C);
          ns++;
          continue;
        }
        if (ng >= MAX_GRASS) continue;
        // Taller and greener in the hollows, shorter and drier on the tops:
        // the height field is right there, so it may as well be used.
        const wet = 1 - t.height[cell];
        // Ankle to shin. A man is drawn eighteen units tall; grass that came up
        // past his knee made every field look derelict.
        // Shrunk away to nothing over the last of the ring, so the outermost
        // tufts do not stop in a line across the field.
        const tall = (2.1 + h * 3.4) * (0.78 + wet * 0.5) * Math.min(1, near * 6);
        Q.setFromAxisAngle(UP, h * 6.28);
        P.set(x, groundY(t, x, y) - 0.6, y);
        S.set(tall * 0.8, tall, tall * 0.8);
        M.compose(P, Q, S);
        grass.setMatrixAt(ng, M);
        // No two tufts the same, and the drier ones go over to straw. A field
        // of one green is a lawn, and nothing in the country is a lawn.
        const dry = 0.3 + h * 0.26 - wet * 0.14;
        const straw = h2 * h2;
        C.setRGB(dry * (0.86 + straw * 0.5), dry * (1.18 - straw * 0.2), dry * (0.48 + straw * 0.1));
        grass.setColorAt(ng, C);
        ng++;
      }
    }
    grass.count = ng;
    stones.count = ns;
    grass.instanceMatrix.needsUpdate = true;
    stones.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
  }

  return {
    meshes: [grass, stones],

    /**
     * @param v       the world view
     * @param cx,cy   what the camera is looking at
     * @param camDist how far back it is standing
     */
    update(v, cx, cy, camDist) {
      if (camDist > SHOW_BELOW) {
        grass.count = 0;
        stones.count = 0;
        atId = -1;
        return;
      }
      // Rebuilt only when the camera has actually gone somewhere, when it has
      // changed zoom enough to matter, or when the battlefield under it has
      // been replaced. Growing the ring walks eighty thousand candidate
      // patches; it is not something to do sixty times a second.
      const ring = ringFor(camDist);
      const moved = Math.hypot(cx - atX, cy - atY) > ring * 0.24;
      const zoomed = Math.abs(ring - atRing) > atRing * 0.22;
      if (!moved && !zoomed && atId === v.worldId) return;
      atX = cx;
      atY = cy;
      atRing = ring;
      atId = v.worldId;
      grow(v, cx, cy, ring);
    },

    counts: () => ({ grass: grass.count, stones: stones.count }),

    dispose() {
      for (const m of [grass, stones]) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}
