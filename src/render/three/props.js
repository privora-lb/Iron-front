// Everything standing on the ground that is not a soldier: trees, houses,
// sandbag walls and the two keeps.
//
// All of it is instanced — one draw call for four thousand trees — because the
// number that matters on a phone is draw calls, not triangles. The geometry is
// generated here rather than loaded, the same way the 2D unit icons are drawn
// in code and the sound effects are synthesised: nothing to download, nothing
// to keep in sync with a modeller.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const place = (mesh, i, x, y, z, rot, sx, sy, sz) => {
  Q.setFromAxisAngle(UP, rot);
  P.set(x, y, z);
  S.set(sx, sy, sz);
  M.compose(P, Q, S);
  mesh.setMatrixAt(i, M);
};

const hide = (mesh, i) => {
  M.makeScale(0, 0, 0);
  mesh.setMatrixAt(i, M);
};

function instanced(geo, mat, n, scene) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // one mesh spans the whole map
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  return mesh;
}

/**
 * Build every standing thing for one battlefield. Returns an object with a
 * refresh() for what changes during a battle — a felled wood, a collapsed
 * street — and a dispose() for when the match ends.
 */
export function buildProps(scene, terrain, view) {
  const group = [];

  /* ---- trees: a trunk and a crown, both instanced ---- */
  const trees = view.trees || [];
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 5);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  crownGeo.translate(0, 0.5, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a26 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunks = instanced(trunkGeo, trunkMat, trees.length, scene);
  const crowns = instanced(crownGeo, crownMat, trees.length, scene);
  group.push(trunks, crowns);

  /* ---- houses ---- */
  const buildings = view.buildings || [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const houseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const houses = instanced(boxGeo, houseMat, buildings.length, scene);
  houses.receiveShadow = true;
  group.push(houses);

  /* ---- roofs, so a village reads as a village from above ---- */
  const roofGeo = new THREE.ConeGeometry(0.72, 1, 4);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);
  const roofs = instanced(
    roofGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    buildings.length,
    scene,
  );
  // A second roof: a gable, which is a three-sided prism laid on its side. A
  // village where every house wears the same pyramid reads as one house stamped
  // out forty times, which is exactly what it looked like.
  const gableGeo = new THREE.CylinderGeometry(0.72, 0.72, 1, 3, 1);
  gableGeo.rotateY(Math.PI / 6);
  gableGeo.rotateZ(Math.PI / 2);
  gableGeo.translate(0, 0.5, 0);
  const gables = instanced(
    gableGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    buildings.length,
    scene,
  );
  group.push(gables);
  // and a chimney on the ones that have a hearth
  const chimneys = instanced(
    boxGeo,
    new THREE.MeshLambertMaterial({ color: 0x6a5a4c }),
    buildings.length,
    scene,
  );
  group.push(chimneys);
  // A stable scatter: the same house is the same house every time the world is
  // rebuilt, and it never touches the simulation's stream.
  const vary = (n) => {
    let h = (n * 2654435761 + 1013904223) | 0;
    h = (h ^ (h >>> 15)) * 668265263;
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
  group.push(roofs);

  /* ---- works and the keeps ---- */
  const WALL_CAP = 400; // works are laid during a battle, not at the start of it
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x6d6552 });
  const wallMesh = instanced(boxGeo, wallMat, WALL_CAP, scene);
  wallMesh.receiveShadow = true;
  group.push(wallMesh);

  const keepMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const keeps = instanced(boxGeo, keepMat, Math.max(1, (view.castles || []).length), scene);
  keeps.receiveShadow = true;
  group.push(keeps);

  const api = {
    /** What bends in the wind. A trunk does not; a crown does. */
    swaying: () => [crowns],

    /** Lay everything out. Cheap enough to redo when something is destroyed. */
    refresh(v) {
      const t = v.terrain;

      for (let i = 0; i < trees.length; i++) {
        const tr = trees[i];
        if (!tr || tr.dead) {
          hide(trunks, i);
          hide(crowns, i);
          continue;
        }
        const gy = groundY(t, tr.x, tr.y);
        const s = tr.s;
        place(trunks, i, tr.x, gy, tr.y, 0, s * 0.55, s * 1.15, s * 0.55);
        place(crowns, i, tr.x, gy + s * 0.95, tr.y, i * 0.7, s * 1.15, s * 2.1, s * 1.15);
        const g = (tr.gr || 90) / 255;
        C.setRGB(g * 0.55, g * 1.02, g * 0.46);
        crowns.setColorAt(i, C);
      }
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        // Sit it in the ground, not on one point of it.
        //
        // The height was read at the CENTRE of the house and the box stood on
        // that, so on any slope the uphill wall was buried and the downhill one
        // hung in the air on stilts. Read all four corners instead: stand on the
        // LOWEST of them so nothing floats, and grow the walls by the fall
        // across the plot so the house is still its own height above the
        // uphill side. That is what makes a building look founded rather than
        // dropped.
        const c = Math.cos(b.rot || 0) * 0.5, s2 = Math.sin(b.rot || 0) * 0.5;
        let lo = 1e9, hi = -1e9;
        for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const px = b.x + (ox * b.w * c - oz * b.h * s2);
          const pz = b.y + (ox * b.w * s2 + oz * b.h * c);
          const g = groundY(t, px, pz);
          if (g < lo) lo = g;
          if (g > hi) hi = g;
        }
        const fall = Math.min(26, hi - lo);
        const gy = lo - 2;
        const r = vary(i);
        const base = b.bunker ? 13 : b.barn ? 21 : b.city ? 44 : 24;
        // no two the same height, and none of them a cube
        const tall = base * (0.82 + r * 0.42) + fall;
        if (b.dead) {
          // A ruin is a low heap where the house stood.
          place(houses, i, b.x, gy, b.y, b.rot || 0, b.w * 0.9, 5 + fall, b.h * 0.9);
          C.setRGB(0.36, 0.34, 0.3);
          houses.setColorAt(i, C);
          hide(roofs, i);
          hide(gables, i);
          hide(chimneys, i);
          continue;
        }
        place(houses, i, b.x, gy, b.y, b.rot || 0, b.w, tall, b.h);
        // Walls are rendered, plaster, timber and stone, not one grey.
        const w = 0.46 + r * 0.3;
        if (b.bunker) C.setRGB(0.42, 0.42, 0.4);
        else if (r < 0.3) C.setRGB(w * 1.06, w * 0.99, w * 0.86);      // limewash
        else if (r < 0.6) C.setRGB(w * 0.92, w * 0.84, w * 0.72);      // render
        else C.setRGB(w * 0.78, w * 0.74, w * 0.7);                    // stone
        houses.setColorAt(i, C);
        if (b.bunker) {
          hide(roofs, i);
          hide(gables, i);
          hide(chimneys, i);
          continue;
        }
        // A gable or a hip, and a chimney on about half of them.
        const long = Math.max(b.w, b.h) * 1.04;
        const pitch = tall * (0.3 + r * 0.26);
        if (r < 0.52) {
          hide(gables, i);
          place(roofs, i, b.x, gy + tall, b.y, b.rot || 0, long, pitch, long);
        } else {
          hide(roofs, i);
          // the ridge runs along the longer wall, the way a roof is framed
          const along = b.w >= b.h ? (b.rot || 0) : (b.rot || 0) + Math.PI / 2;
          place(gables, i, b.x, gy + tall, b.y, along, Math.min(b.w, b.h) * 1.05,
            pitch, Math.max(b.w, b.h) * 1.04);
          C.setRGB(0.34, 0.22, 0.18);
          gables.setColorAt(i, C);
        }
        if (r > 0.34) {
          place(chimneys, i, b.x + (r - 0.5) * b.w * 0.7, gy + tall,
            b.y + (0.5 - r) * b.h * 0.6, b.rot || 0, 5, pitch + 7, 5);
        } else hide(chimneys, i);
        C.setRGB(0.3 + r * 0.16, 0.19 + r * 0.09, 0.15 + r * 0.07);   // tile, slate, thatch
        roofs.setColorAt(i, C);
        gables.setColorAt(i, C);
      }
      houses.instanceMatrix.needsUpdate = true;
      roofs.instanceMatrix.needsUpdate = true;
      gables.instanceMatrix.needsUpdate = true;
      chimneys.instanceMatrix.needsUpdate = true;
      if (houses.instanceColor) houses.instanceColor.needsUpdate = true;
      if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
      if (gables.instanceColor) gables.instanceColor.needsUpdate = true;

      const wl = v.walls || [];
      for (let i = 0; i < wallMesh.count; i++) {
        const w = wl[i];
        if (!w || w.dead) {
          hide(wallMesh, i);
          continue;
        }
        const a = w.a === undefined ? Math.PI / 2 : w.a;
        place(wallMesh, i, w.x, groundY(t, w.x, w.y), w.y, -a, w.len, w.rubble ? 7 : 11, 9);
      }
      wallMesh.instanceMatrix.needsUpdate = true;

      const cs = v.castles || [];
      for (let i = 0; i < keeps.count; i++) {
        const c = cs[i];
        if (!c) {
          hide(keeps, i);
          continue;
        }
        // The keep itself is built in base.js now, as a compound with a wall,
        // huts, towers and a flag. What is left here is the rubble it becomes
        // when it falls, which the compound has no version of.
        if (!c.dead) { hide(keeps, i); continue; }
        place(keeps, i, c.x, groundY(t, c.x, c.y), c.y, 0, c.hw * 2, 12, c.hh * 2);
        const dead = c.dead ? 0.4 : 1;
        if (c.team === 'blue') C.setRGB(0.22 * dead, 0.3 * dead, 0.46 * dead);
        else C.setRGB(0.44 * dead, 0.19 * dead, 0.15 * dead);
        keeps.setColorAt(i, C);
      }
      keeps.instanceMatrix.needsUpdate = true;
      if (keeps.instanceColor) keeps.instanceColor.needsUpdate = true;
    },

    dispose() {
      for (const m of group) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };

  api.refresh(view);
  return api;
}
