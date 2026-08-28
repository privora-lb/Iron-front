// Bocage: the hedges and dry-stone walls that divide one field from the next.
//
// The countryside is already laid out as parcels — plots with a use, a
// ploughing bearing and a boundary that is a hedge, a wall, a ditch or nothing
// at all. The flat map draws those boundaries as lines on the ground bake. On a
// battlefield you can stand on, a hedge is not a line: it is a thing a man
// crouches behind and a tank has to go round or through, and it is most of what
// makes farmland read as farmland rather than as coloured tiles.
//
// So the boundaries are grown here as real geometry. Two instanced meshes — one
// of dark scrubby crowns, one of pale stone — cover the whole map in two draw
// calls, which is what lets there be twelve thousand of them.
//
// Note for anyone reading this later: this is the RENDERER. A hedge drawn here
// is not cover the simulation knows about; what a hedge does to a man walking
// through it is decided in the terrain model, not in a mesh.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';
import { WATER, FORD, ROAD, STONE, BUILD, RUBBLE, CLIFF, WOOD } from '../../world/terrain.js';

// A boundary planted every eighteen metres, thinned onto a fourteen-metre grid.
// The grid does two jobs: neighbouring plots share a boundary and would
// otherwise grow it twice, and a corner where four hedges meet would grow a
// bush inside a bush.
const STEP = 18;
const GRID = 14;
const CAP = 16000;

// Ground that is already something else. Nobody plants a hedge in a river or
// across a made road, and a wood needs no hedge to divide it.
const TAKEN = WATER | FORD | ROAD | STONE | BUILD | RUBBLE | CLIFF | WOOD;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** A stable scatter, so the same field grows the same hedge every time. */
function hash(n) {
  let h = (n * 374761393 + 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A squat, lumpy crown — an eight-sided sphere squashed, which at the size a
 *  hedge is drawn reads as scrub and costs sixty triangles. */
function bushGeometry() {
  const g = new THREE.SphereGeometry(0.5, 6, 4);
  g.scale(1, 0.8, 1);
  g.translate(0, 0.42, 0);
  return g;
}

function stoneGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * Grow every field boundary on one battlefield.
 *
 * @param scene   where to add the meshes
 * @param terrain the battlefield model, for ground height and what a cell is
 * @param landuse the parcels from src/world/landuse.js, or null on a map with
 *                no farmland at all
 */
export function buildHedges(scene, terrain, landuse) {
  const hedge = [];
  const wall = [];
  const parcels = (landuse && landuse.parcels) || [];
  const taken = new Set();
  const gw = Math.ceil(terrain.W / GRID) + 2;

  for (let n = 0; n < parcels.length; n++) {
    const p = parcels[n];
    if (p.edge === 'open' || p.edge === 'ditch') continue; // a ditch stands nothing up
    const into = p.edge === 'wall' ? wall : hedge;
    const poly = p.poly;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ang = Math.atan2(dy, dx);
      const steps = Math.max(1, Math.round(len / STEP));
      for (let k = 0; k < steps; k++) {
        if (into.length >= CAP) break;
        const t = (k + 0.5) / steps;
        const x = a[0] + dx * t;
        const y = a[1] + dy * t;
        if (x < 4 || y < 4 || x > terrain.W - 4 || y > terrain.H - 4) continue;
        const cell = ((y / terrain.TG) | 0) * terrain.TW + ((x / terrain.TG) | 0);
        if (terrain.flags[cell] & TAKEN) continue;
        // One boundary to a cell of the thinning grid: two plots that share a
        // hedge grow it once between them.
        const key = ((y / GRID) | 0) * gw + ((x / GRID) | 0);
        if (taken.has(key)) continue;
        taken.add(key);
        into.push(x, y, ang, hash(key));
      }
    }
  }

  function mesh(geo, rows, mat) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, rows.length / 4));
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false; // one mesh spans the whole map
    m.count = rows.length / 4;
    scene.add(m);
    return m;
  }

  const bushes = mesh(
    bushGeometry(),
    hedge,
    new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: false }),
  );
  const stones = mesh(stoneGeometry(), wall, new THREE.MeshLambertMaterial({ color: 0x8b8676 }));

  // A hedge is planted; it does not move afterwards, so this runs once.
  for (let i = 0; i < hedge.length; i += 4) {
    const j = i / 4;
    const x = hedge[i];
    const y = hedge[i + 1];
    const r = hedge[i + 3];
    // Never two the same: an even row of identical bushes reads as a fence.
    const h = 15 + r * 13;
    Q.setFromAxisAngle(UP, -hedge[i + 2] + (r - 0.5) * 0.5);
    P.set(x, groundY(terrain, x, y) - 1, y);
    S.set(14 + r * 8, h, 11 + r * 6);
    M.compose(P, Q, S);
    bushes.setMatrixAt(j, M);
    const g = 0.3 + r * 0.16;
    C.setRGB(g * 0.62, g * 1.05, g * 0.5);
    bushes.setColorAt(j, C);
  }
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;

  for (let i = 0; i < wall.length; i += 4) {
    const j = i / 4;
    const x = wall[i];
    const y = wall[i + 1];
    const r = wall[i + 3];
    Q.setFromAxisAngle(UP, -wall[i + 2]);
    P.set(x, groundY(terrain, x, y) - 1, y);
    S.set(GRID + 5, 7 + r * 4, 4.4 + r * 2);
    M.compose(P, Q, S);
    stones.setMatrixAt(j, M);
  }
  stones.instanceMatrix.needsUpdate = true;

  return {
    meshes: [bushes, stones],
    counts: { hedge: hedge.length / 4, wall: wall.length / 4 },
    dispose() {
      for (const m of [bushes, stones]) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}
