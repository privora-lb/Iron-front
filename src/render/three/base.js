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
  const n = Math.max(1, list.length);
  const walls = bucket(boxGeo, wallMat, n * 40);
  const huts = bucket(hutGeo, hutMat, n * 8);
  const conc = bucket(boxGeo, concMat, n * 18);
  const masts = bucket(boxGeo, mastMat, n * 2);

  const put = (mesh, x, y, z, yaw, sx, sy, sz, col) => {
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

  for (const c of list) {
    const skin = TEAM[c.team] || TEAM.blue;
    const gy = groundY(t, c.x, c.y);
    const hw = c.hw + 46;
    const hh = c.hh + 40;
    // The gate faces the fighting, which is inward from whichever edge this
    // headquarters is backed against.
    const inward = c.x < t.W / 2 ? 1 : -1;

    // ---- the wall round it: blast panels, with a gap for the gate ----
    const step = 34;
    for (let u = -hw; u <= hw; u += step) {
      for (const side of [-1, 1]) {
        const z = c.y + side * hh;
        const g = groundY(t, c.x + u, z);
        put(walls, c.x + u, g - 3, z, 0, step - 3, 17 + ((u * side) % 3), 13);
      }
    }
    for (let v = -hh + step; v <= hh - step; v += step) {
      for (const side of [-1, 1]) {
        // leave the gateway open on the fighting side
        if (side === inward && Math.abs(v) < 46) continue;
        const x = c.x + side * hw;
        const g = groundY(t, x, c.y + v);
        put(walls, x, g - 3, c.y + v, 0, 13, 17 + ((v * side) % 3), step - 3);
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
        const g = groundY(t, x, z);
        put(conc, x, g - 3, z, 0, 18, 44, 18); // the leg
        put(conc, x, g + 41, z, 0, 28, 12, 28); // the cabin
      }
    }

    // ---- the command bunker, low and heavy, and its blast berm ----
    put(conc, c.x - inward * 34, gy - 4, c.y, 0, 78, 26, 104);
    put(conc, c.x - inward * 34, gy + 22, c.y, 0, 62, 7, 84);

    // ---- barracks: huts in a row, the way an army lays them out ----
    for (let i = 0; i < 4; i++) {
      const z = c.y - 96 + i * 64;
      const x = c.x + inward * 44;
      const g = groundY(t, x, z);
      put(huts, x, g + 12, z, 0, 46, 24, 30);
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
    flags.push({ mesh, base: cloth.attributes.position.array.slice(), team: c.team });
    parts.push(mesh);
    mats.push(mat);
  }

  for (const m of parts) if (m.isInstancedMesh) m.instanceMatrix.needsUpdate = true;
  for (const m of parts) if (m.isInstancedMesh && m.instanceColor) m.instanceColor.needsUpdate = true;

  return {
    meshes: parts,
    counts: { wall: walls.count, hut: huts.count, conc: conc.count, flag: flags.length },

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
          const grip = x / FLAG_W; // 0 at the mast, 1 at the fly
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
