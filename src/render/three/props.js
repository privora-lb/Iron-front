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
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 1, 6);
  trunkGeo.translate(0, 0.5, 0);

  // A crown is not a cone.
  //
  // Every tree on every battlefield was one seven-sided cone, which is why a
  // wood read as a bag of party hats. A conifer is a stack of skirts that get
  // shorter toward the top and it is the STEPS between them that say "fir" at
  // any distance; a broadleaf is a cluster of lumps with no point at all. Two
  // crowns, picked per tree, is the difference between a forest and a pattern.
  function firGeometry() {
    const tiers = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;                                  // 0 at the foot, 1 at the tip
      const r = 1 - t * 0.74;
      const c = new THREE.ConeGeometry(r, 0.46, 7);
      c.translate(0, 0.16 + t * 0.74, 0);
      tiers.push(c);
    }
    const g = mergeGeometries(tiers) || new THREE.ConeGeometry(1, 1, 7);
    return g;
  }
  function broadGeometry() {
    const lobes = [];
    // one mass and three smaller ones pushed off it, so the outline is lumpy
    const main = new THREE.IcosahedronGeometry(0.78, 0);
    main.scale(1, 0.86, 1);
    main.translate(0, 0.66, 0);
    lobes.push(main);
    for (const [dx, dy, dz, r] of [[0.5, 0.5, 0.16, 0.46], [-0.44, 0.58, -0.3, 0.42],
                                   [0.1, 0.9, -0.42, 0.4]]) {
      const l = new THREE.IcosahedronGeometry(r, 0);
      l.translate(dx, dy, dz);
      lobes.push(l);
    }
    return mergeGeometries(lobes) || main;
  }
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a26 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunks = instanced(trunkGeo, trunkMat, trees.length, scene);
  const crowns = instanced(firGeometry(), crownMat, trees.length, scene);
  const broads = instanced(broadGeometry(),
    new THREE.MeshLambertMaterial({ color: 0xffffff }), trees.length, scene);
  group.push(trunks, crowns, broads);
  // Which kind a tree is, stably: the same wood every time the world is rebuilt.
  const kindOf = (n) => {
    let h = (n * 1103515245 + 12345) | 0;
    h = (h ^ (h >>> 16)) * 2246822519;
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };

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
    swaying: () => [crowns, broads],

    /** Lay everything out. Cheap enough to redo when something is destroyed. */
    refresh(v) {
      const t = v.terrain;

      // A tree standing inside a position nobody could see past.
      //
      // The engine already clears the WOOD flag under a base - so the ground
      // there gives no cover and the simulation knows it - but the trunks are
      // planted afterwards and were left standing, which put a closed canopy
      // over every depot and strongpoint on the field. Five bases a side were
      // being built and none of them could be seen.
      //
      // This is hidden HERE, in the renderer, and not felled in the engine: a
      // tree is simulation state, it is written into the save, and killing four
      // hundred of them at world-build time made every saved battle come back
      // different. The renderer reads the world; it does not get to edit it.
      const yards = v.bases || [];
      const inYard = (x, y) => {
        for (const b of yards) if (Math.abs(x - b.x) < 130 && Math.abs(y - b.y) < 118) return true;
        return false;
      };
      for (let i = 0; i < trees.length; i++) {
        const tr = trees[i];
        if (!tr || tr.dead || inYard(tr.x, tr.y)) {
          hide(trunks, i);
          hide(crowns, i);
          hide(broads, i);          // a felled broadleaf must lose its crown too
          continue;
        }
        const gy = groundY(t, tr.x, tr.y);
        const s = tr.s;
        // Which tree grows here. On a map whose two banks are different country
        // the bank decides it - firs in the snow, broadleaves in the pasture -
        // and that is most of what tells the two halves apart at the distance
        // this is played from. Elsewhere it is a stable per-tree scatter.
        let k = kindOf(i);
        if (v.split) {
          const want = (tr.x < t.W / 2 ? v.split.west : v.split.east).fir;
          if (want >= 1) k = Math.min(k, 0.5);          // a wood of firs
          else if (want <= 0) k = Math.max(k, 0.62);    // a wood of broadleaves
        }
        const lean = (k - 0.5) * 0.1;                   // nothing grows dead straight
        place(trunks, i, tr.x, gy, tr.y, i * 0.7, s * 0.5, s * (1 + k * 0.5), s * 0.5);
        const g = (tr.gr || 90) / 255;
        // Broadleaves are the yellower green and firs the bluer one, which is
        // most of what tells two woods apart from a distance.
        if (k < 0.56) {
          hide(broads, i);
          place(crowns, i, tr.x, gy + s * 0.72, tr.y, i * 0.7 + lean,
            s * (1 + k * 0.5), s * (2.0 + k * 0.8), s * (1 + k * 0.5));
          C.setRGB(g * 0.46, g * 0.94, g * 0.5);
          crowns.setColorAt(i, C);
        } else {
          hide(crowns, i);
          place(broads, i, tr.x, gy + s * 1.15, tr.y, i * 0.7 + lean,
            s * (1.5 + k * 0.6), s * (1.5 + k * 0.5), s * (1.5 + k * 0.6));
          C.setRGB(g * 0.66, g * 1.02, g * 0.36);
          broads.setColorAt(i, C);
        }
      }
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      broads.instanceMatrix.needsUpdate = true;
      if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
      if (broads.instanceColor) broads.instanceColor.needsUpdate = true;

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
        // A roof the size of the house it stands on.
        //
        // Both axes were being given max(w, h), so a house thirty across and
        // sixty long wore a roof sixty by sixty: it overhung the side walls by
        // its own width again and the village came out as a field of mushrooms.
        // Each axis takes its own wall now, plus a hand's breadth of eaves.
        const pitch = tall * (0.42 + r * 0.3);       // steeper: a shallow cap reads as a lid
        if (r < 0.52) {
          hide(gables, i);
          place(roofs, i, b.x, gy + tall, b.y, b.rot || 0, b.w * 1.1, pitch, b.h * 1.1);
        } else {
          hide(roofs, i);
          // the ridge runs along the longer wall, the way a roof is framed
          const along = b.w >= b.h ? (b.rot || 0) : (b.rot || 0) + Math.PI / 2;
          place(gables, i, b.x, gy + tall, b.y, along, Math.min(b.w, b.h) * 1.1,
            pitch, Math.max(b.w, b.h) * 1.02);
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
