// The two headquarters, as places rather than as a box.
//
// A keep used to be exactly one instanced cube, sixty units tall, in the team's
// colour — so the ground each side is defending, the thing the whole match is
// fought over, was the least convincing object on the battlefield. This builds
// it as what it is: a compound with a wall round it, a gate facing the fighting,
// huts to sleep in, towers to watch from, a command bunker, and a flag on a mast
// in the middle of it that you can see from across the valley.
//
// It is all cosmetic. The keep's footprint, its hit points and what it does to
// the ground are the simulation's and are set in the engine; nothing here is
// read back by anything that decides a fight.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// The flag is deliberately out of scale. A real ensign on a real mast would be
// a few pixels at the height this game is played from, and the point of it is
// to be the thing that tells you whose ground that is from the far bank.
const MAST_H = 96;
const FLAG_W = 54;
const FLAG_H = 32;

const TEAM = {
  blue: { flag: 0x2f5fa8, trim: 0x39435a },
  red: { flag: 0x9c3a2c, trim: 0x53453a },
};

function box() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/** A hut with a curved back — a Nissen hut reads as army at any distance. */
function hutGeometry() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 9, 1, false, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export function buildBase(scene, view) {
  const t = view.terrain;
  const list = (view.castles || []).filter(Boolean);
  const parts = [];
  const flags = [];

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x6d6552 });
  const hutMat = new THREE.MeshLambertMaterial({ color: 0x4d5240 });
  const concMat = new THREE.MeshLambertMaterial({ color: 0x767065 });
  const mastMat = new THREE.MeshLambertMaterial({ color: 0xb9b6ae });
  const mats = [wallMat, hutMat, concMat, mastMat];

  const boxGeo = box();
  const hutGeo = hutGeometry();
  const bucket = (geo, mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    scene.add(m);
    parts.push(m);
    return m;
  };
  // The five forward positions a side, which were being drawn by NOTHING at all:
  // the renderer never read view.bases, so a depot or a strongpoint was a patch
  // of stone-coloured ground with two blast walls beside it and no reason for
  // the player to believe anything was there.
  const posts = (view.bases || []).filter(Boolean);
  const n = Math.max(1, list.length);
  const np = Math.max(1, posts.length);
  const walls = bucket(boxGeo, wallMat, n * 40 + np * 26);
  const huts = bucket(hutGeo, hutMat, n * 8 + np * 4);
  const conc = bucket(boxGeo, concMat, n * 18 + np * 12);
  const masts = bucket(boxGeo, mastMat, n * 2 + np * 2);

  // How far to bury a piece so it meets the ground on all sides.
  //
  // Every part of the compound stood on the height read at its OWN centre, so on
  // any slope a wall panel met the ground on its uphill side and hung in the air
  // on its downhill one. Read the four corners, stand on the lowest, and add the
  // fall across the piece to its height so it still stands as tall as it should.
  // Same rule the houses were given, for the same reason.
  const seat = (x, z, sx, sz) => {
    let lo = 1e9, hi = -1e9;
    for (const [ox, oz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const g = groundY(t, x + ox * sx, z + oz * sz);
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
    return { y: lo, fall: Math.min(30, hi - lo) };
  };

  const put = (mesh, x, y, z, yaw, sx, sy, sz, col) => {
    // The same guard the bridges need: an instance past the end of the buffer
    // keeps a zero matrix and draws as a spike through the world origin.
    if (mesh.count >= mesh.instanceMatrix.count) return;
    Q.setFromAxisAngle(UP, yaw);
    P.set(x, y, z);
    S.set(sx, sy, sz);
    M.compose(P, Q, S);
    mesh.setMatrixAt(mesh.count, M);
    if (col) {
      C.setRGB(col[0], col[1], col[2]);
      mesh.setColorAt(mesh.count, C);
    }
    mesh.count++;
  };

  for (const raw of list) {
    const skin = TEAM[raw.team] || TEAM.blue;
    const hw = raw.hw + 46;
    const hh = raw.hh + 40;
    // Keep the whole compound on the battlefield.
    //
    // A headquarters is planted a hundred units in from its own edge and its
    // wall reaches a hundred and thirty-four out, so half of it was built over
    // the side of the map - and now that outside the map is black, half a fort
    // was hanging in the void. The keep the SIMULATION knows about has not
    // moved; this is only where the compound is drawn around it.
    const c = { ...raw,
      x: Math.max(hw + 8, Math.min(t.W - hw - 8, raw.x)),
      y: Math.max(hh + 8, Math.min(t.H - hh - 8, raw.y)) };
    const gy = groundY(t, c.x, c.y);
    // The gate faces the fighting, which is inward from whichever edge this
    // headquarters is backed against.
    const inward = c.x < t.W / 2 ? 1 : -1;

    // ---- the wall round it: blast panels, with a gap for the gate ----
    const step = 34;
    for (let u = -hw; u <= hw; u += step) {
      for (const side of [-1, 1]) {
        const z = c.y + side * hh;
        const st = seat(c.x + u, z, step, 13);
        put(walls, c.x + u, st.y - 3, z, 0, step - 3, 17 + st.fall + ((u * side) % 3), 13);
      }
    }
    for (let v = -hh + step; v <= hh - step; v += step) {
      for (const side of [-1, 1]) {
        // leave the gateway open on the fighting side
        if (side === inward && Math.abs(v) < 46) continue;
        const x = c.x + side * hw;
        const st = seat(x, c.y + v, 13, step);
        put(walls, x, st.y - 3, c.y + v, 0, 13, 17 + st.fall + ((v * side) % 3), step - 3);
      }
    }
    // gate piers
    for (const s2 of [-1, 1]) {
      const x = c.x + inward * hw;
      const z = c.y + s2 * 50;
      put(conc, x, groundY(t, x, z) - 3, z, 0, 20, 30, 20);
    }

    // ---- watchtowers on the four corners ----
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = c.x + sx * hw;
        const z = c.y + sz * hh;
        const st = seat(x, z, 18, 18);
        put(conc, x, st.y - 3, z, 0, 18, 44 + st.fall, 18); // the leg
        put(conc, x, st.y + 41 + st.fall, z, 0, 28, 12, 28); // the cabin
      }
    }

    // ---- the command bunker, low and heavy, and its blast berm ----
    const bst = seat(c.x - inward * 34, c.y, 78, 104);
    put(conc, c.x - inward * 34, bst.y - 4, c.y, 0, 78, 26 + bst.fall, 104);
    put(conc, c.x - inward * 34, bst.y + 22 + bst.fall, c.y, 0, 62, 7, 84);

    // ---- barracks: huts in a row, the way an army lays them out ----
    for (let i = 0; i < 4; i++) {
      const z = c.y - 96 + i * 64;
      const x = c.x + inward * 44;
      const st = seat(x, z, 46, 30);
      put(huts, x, st.y + 12, z, 0, 46, 24, 30);
    }

    // ---- sandbag rings, facing out ----
    for (const sz of [-1, 1]) {
      const x = c.x + inward * (hw - 26);
      const z = c.y + sz * (hh - 40);
      const g = groundY(t, x, z);
      for (let a = 0; a < 7; a++) {
        const th = (a / 7) * Math.PI + (inward > 0 ? -Math.PI / 2 : Math.PI / 2);
        put(walls, x + Math.cos(th) * 17, g - 2, z + Math.sin(th) * 17, th, 11, 9, 8);
      }
    }

    // ---- the flag: a mast in the middle, and cloth on it ----
    const mx = c.x;
    const mz = c.y;
    const mg = groundY(t, mx, mz);
    put(conc, mx, mg - 2, mz, 0, 20, 8, 20); // the plinth it stands on
    put(masts, mx, mg + 6, mz, 0, 4, MAST_H, 4);

    const cloth = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 12, 4);
    cloth.translate(FLAG_W / 2, 0, 0); // hangs off the mast, not centred on it
    const mat = new THREE.MeshLambertMaterial({
      color: skin.flag,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(cloth, mat);
    mesh.position.set(mx + 2, mg + 6 + MAST_H - FLAG_H * 0.75, mz);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    flags.push({ mesh, base: cloth.attributes.position.array.slice(), team: c.team, w: FLAG_W });
    parts.push(mesh);
    mats.push(mat);
  }

  /* ---- the forward positions and the depots ---- */
  //
  // A strongpoint is a ring of earth with things sheltering inside it; a depot
  // is a yard with stores stacked in it. Both get a mast with a small colour on
  // it, so you can see whose the position is from outside its own wall - which
  // is the whole point of holding one.
  for (const b of posts) {
    const skin = TEAM[b.team] || TEAM.blue;
    const g0 = groundY(t, b.x, b.y);
    const depot = b.i >= 3;
    const face = b.team === 'blue' ? 1 : -1;      // which way the enemy is

    // an earth revetment, open toward its own rear so vehicles can get in
    for (let a = 0; a < 14; a++) {
      const th = (a / 14) * Math.PI * 2;
      const nx = Math.cos(th);
      if (nx * face < -0.55) continue;            // the gap, on the friendly side
      const px = b.x + nx * 96;
      const pz = b.y + Math.sin(th) * 82;
      const st = seat(px, pz, 26, 11);
      put(walls, px, st.y - 3, pz, th, 26, 13 + st.fall + ((a % 3) * 2), 11);
    }

    if (depot) {
      // stores: crates in stacks and a run of fuel drums
      for (let i = 0; i < 6; i++) {
        const px = b.x - face * 30 + (i % 3) * 30;
        const pz = b.y - 40 + ((i / 3) | 0) * 34;
        const st = seat(px, pz, 24, 20);
        put(conc, px, st.y - 2, pz, i * 0.4, 24, 12 + st.fall + (i % 2) * 8, 20);
      }
      for (let i = 0; i < 5; i++) {
        const px = b.x + face * 46;
        const pz = b.y - 40 + i * 20;
        put(walls, px, groundY(t, px, pz) - 1, pz, 0, 11, 15, 11);
      }
    } else {
      // a strongpoint: a dug-in shelter and a gun pit facing the enemy
      const sst = seat(b.x - face * 26, b.y, 46, 62);
      put(conc, b.x - face * 26, sst.y - 3, b.y, 0, 46, 17 + sst.fall, 62);
      for (let a = 0; a < 6; a++) {
        const th = -Math.PI / 2 + (a / 5) * Math.PI;
        const px = b.x + face * 44 + Math.cos(th) * 26 * face;
        const pz = b.y + Math.sin(th) * 26;
        put(walls, px, groundY(t, px, pz) - 2, pz, th, 13, 9, 9);
      }
    }
    // two tents behind the wall
    for (let i = 0; i < 2; i++) {
      const px = b.x - face * 52;
      const pz = b.y - 26 + i * 52;
      put(huts, px, groundY(t, px, pz) + 8, pz, 0, 34, 17, 22);
    }
    // the mast, and a small colour on it
    const mg = groundY(t, b.x, b.y);
    put(masts, b.x, mg + 2, b.y, 0, 3, 46, 3);
    const small = new THREE.PlaneGeometry(FLAG_W * 0.42, FLAG_H * 0.42, 8, 3);
    small.translate((FLAG_W * 0.42) / 2, 0, 0);
    const smat = new THREE.MeshLambertMaterial({ color: skin.flag, side: THREE.DoubleSide });
    const smesh = new THREE.Mesh(small, smat);
    smesh.position.set(b.x + 1.5, mg + 2 + 46 - FLAG_H * 0.32, b.y);
    smesh.frustumCulled = false;
    scene.add(smesh);
    flags.push({ mesh: smesh, base: small.attributes.position.array.slice(), team: b.team,
                 w: FLAG_W * 0.42 });
    parts.push(smesh);
    mats.push(smat);
  }

  for (const m of parts) if (m.isInstancedMesh) m.instanceMatrix.needsUpdate = true;
  for (const m of parts) if (m.isInstancedMesh && m.instanceColor) m.instanceColor.needsUpdate = true;

  return {
    meshes: parts,
    counts: { wall: walls.count, hut: huts.count, conc: conc.count, flag: flags.length,
      posts: posts.length },

    /**
     * The cloth. A flag that hangs dead still is worse than no flag: it is the
     * one thing on the field whose whole job is to show that there is weather.
     * The wave runs along the flag from the mast outward and grows with distance
     * from it, because that is what cloth held at one edge actually does.
     */
    update(v) {
      const t2 = v.clock || 0;
      const w = v.wind || {};
      const gust = 0.55 + 0.45 * Math.min(1, (w.speed || 1) / 2);
      for (const f of flags) {
        const pos = f.mesh.geometry.attributes.position;
        const a = pos.array;
        for (let i = 0; i < a.length; i += 3) {
          const x = f.base[i];
          const y = f.base[i + 1];
          const grip = x / (f.w || FLAG_W); // 0 at the mast, 1 at the fly
          a[i + 2] = Math.sin(x * 0.16 - t2 * 6) * 5.5 * grip * gust + Math.sin(y * 0.2 + t2 * 3) * 1.4 * grip;
          a[i + 1] = y - grip * grip * 3.5; // it sags as it reaches away
        }
        pos.needsUpdate = true;
        f.mesh.geometry.computeVertexNormals();
        // and it swings round to lie downwind
        f.mesh.rotation.y = (w.dir || 0) + Math.sin(t2 * 0.7) * 0.12;
      }
    },

    dispose() {
      for (const m of parts) scene.remove(m);
      boxGeo.dispose();
      hutGeo.dispose();
      for (const f of flags) f.mesh.geometry.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
