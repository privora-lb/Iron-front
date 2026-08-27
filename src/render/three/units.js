// The armies.
//
// Every man and every vehicle on the field is one instance of a shared mesh, so
// five hundred soldiers cost a handful of draw calls rather than five hundred.
// The shapes are built here in code — a rifleman is a body and a head, a tank
// is a hull, a turret and a barrel — which is the same bargain the rest of this
// game makes: no model files, no asset pipeline, and the turret traverses
// because the simulation already knows where it is pointing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundY } from './terrainMesh.js';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const MAX_MEN = 3200;
const MAX_VEH = 520;
const MAX_RING = 260;

function put(mesh, i, x, y, z, rot, sx, sy, sz) {
  Q.setFromAxisAngle(UP, rot);
  P.set(x, y, z);
  S.set(sx, sy, sz);
  M.compose(P, Q, S);
  mesh.setMatrixAt(i, M);
}

function instanced(geo, n, scene, opts) {
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshLambertMaterial(opts || { color: 0xffffff }),
    n,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}

// A man: a body, and a head above it. One geometry, so one instance each.
//
// Built bigger than life, on purpose. A rifleman is two paces across and the
// map is five kilometres wide, so at the zoom this game is actually played at a
// man drawn to scale is one pixel. The flat renderer already makes the same
// bargain with its icons: legible beats accurate.
const MAN = 2.3;
function figureGeometry() {
  const body = new THREE.BoxGeometry(4.4 * MAN, 7.2 * MAN, 3 * MAN);
  body.translate(0, 3.6 * MAN, 0);
  const head = new THREE.SphereGeometry(1.7 * MAN, 6, 5);
  head.translate(0, 8.6 * MAN, 0);
  return mergeGeometries([body, head]) || body;
}

export function buildUnits(scene) {
  const men = instanced(figureGeometry(), MAX_MEN, scene);

  const hullGeo = new THREE.BoxGeometry(1, 1, 1);
  hullGeo.translate(0, 0.5, 0);
  const hulls = instanced(hullGeo, MAX_VEH, scene);

  const turretGeo = new THREE.BoxGeometry(1, 1, 1);
  turretGeo.translate(0, 0.5, 0);
  const turrets = instanced(turretGeo, MAX_VEH, scene);

  // The barrel points down +X before it is turned, so the traverse the
  // simulation already tracks is the rotation applied here.
  const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  barrelGeo.rotateZ(Math.PI / 2);
  barrelGeo.translate(0.5, 0, 0);
  const barrels = instanced(barrelGeo, MAX_VEH, scene);

  const rotorGeo = new THREE.CylinderGeometry(1, 1, 0.12, 12);
  const rotors = instanced(rotorGeo, 80, scene, {
    color: 0x2a2a26,
    transparent: true,
    opacity: 0.5,
  });

  const ringGeo = new THREE.RingGeometry(0.82, 1, 18);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = instanced(ringGeo, MAX_RING, scene, {
    color: 0xc9a227,
    transparent: true,
    opacity: 0.75,
  });
  rings.castShadow = false;

  const shotGeo = new THREE.BoxGeometry(1, 1, 1);
  const shots = instanced(shotGeo, 700, scene, { color: 0xffd9a0 });
  shots.castShadow = false;

  const all = [men, hulls, turrets, barrels, rotors, rings, shots];

  return {
    /** Lay the armies out for this frame. */
    update(v, camDist) {
      const t = v.terrain;
      // A rifleman is two paces across and the battlefield is five kilometres
      // wide: true to size he is one pixel when the whole map is on screen,
      // which is the zoom a commander spends most of a battle at. So men grow
      // as the camera pulls back. It is the same bargain the flat renderer
      // makes with its icons, for the same reason: a formation you cannot see
      // is a formation you cannot command.
      const far = camDist ? Math.min(3.4, Math.max(1, camDist / 1000)) : 1;
      const farV = Math.min(1.9, far);
      const soldiers = v.soldiers || [];
      let nm = 0;
      let nv = 0;
      let nr = 0;
      let nrot = 0;

      for (let i = 0; i < soldiers.length; i++) {
        const s = soldiers[i];
        if (!s.alive) continue;
        const sq = s.sq;
        if (!v.showsTeam(sq.team) || !sq.seen) continue; // fog of war, same rule as the map
        const ut = sq.t;
        const blue = sq.team === 'blue';
        const gy = groundY(t, s.x, s.y);

        if (ut.air) {
          if (nv >= MAX_VEH) continue;
          const fly = gy + 96;
          put(hulls, nv, s.x, fly, s.y, -s.hull, 26, 8, 10);
          C.setRGB(blue ? 0.26 : 0.5, blue ? 0.36 : 0.22, blue ? 0.54 : 0.18);
          hulls.setColorAt(nv, C);
          put(turrets, nv, s.x, fly + 8, s.y, -s.hull, 12, 6, 8);
          turrets.setColorAt(nv, C);
          put(
            barrels,
            nv,
            s.x - Math.cos(s.hull) * 13,
            fly + 3,
            s.y - Math.sin(s.hull) * 13,
            -s.hull,
            16,
            2,
            2,
          );
          barrels.setColorAt(nv, C);
          if (nrot < 80) {
            put(rotors, nrot, s.x, fly + 13, s.y, v.clock * 22, 30, 1, 30);
            nrot++;
          }
          nv++;
          continue;
        }

        if (ut.vehicle || ut.kind === 'siege') {
          if (nv >= MAX_VEH) continue;
          const big = ut.kind === 'siege';
          const V = 1.35 * farV; // the same bargain, less of it
          const len = (big ? 26 : 34) * V;
          const wide = (big ? 16 : 19) * V;
          const tall = (big ? 8 : 11) * V;
          put(hulls, nv, s.x, gy, s.y, -s.hull, len, tall, wide);
          C.setRGB(blue ? 0.22 : 0.42, blue ? 0.31 : 0.2, blue ? 0.46 : 0.16);
          hulls.setColorAt(nv, C);
          put(
            turrets,
            nv,
            s.x,
            gy + tall,
            s.y,
            -s.turret,
            (big ? 12 : 17) * V,
            7 * V,
            (big ? 12 : 15) * V,
          );
          turrets.setColorAt(nv, C);
          // Recoil: the barrel is driven straight off the simulation's own kick.
          const back = (s.rec || 0) * 3;
          const bl = (big ? 20 : 24) * V - back;
          put(barrels, nv, s.x, gy + tall + 3.5 * V, s.y, -s.turret, bl, 2.4 * V, 2.4 * V);
          barrels.setColorAt(nv, C);
          nv++;
          continue;
        }

        if (nm >= MAX_MEN) continue;
        // A man leans into his stride, which is enough to read as movement at
        // the zoom this game is played at.
        put(men, nm, s.x, gy, s.y, -s.ang, far, far * (s.moved ? 0.96 : 1), far);
        C.setRGB(blue ? 0.36 : 0.69, blue ? 0.56 : 0.27, blue ? 0.82 : 0.22);
        men.setColorAt(nm, C);
        nm++;
      }

      // A ring under everything the player has selected.
      const sel = v.selected || [];
      for (let i = 0; i < sel.length && nr < MAX_RING; i++) {
        const sq = sel[i];
        if (!sq || sq.gone) continue;
        const r = 26 + Math.max(sq.fw, sq.fd) * 0.5;
        put(rings, nr, sq.fx, groundY(t, sq.fx, sq.fy) + 1.2, sq.fy, 0, r, 1, r);
        nr++;
      }

      // Rounds in the air, along the line they are actually travelling.
      const inAir = v.shots || [];
      let ns = 0;
      for (let i = 0; i < inAir.length && ns < 700; i++) {
        const a = inAir[i];
        const ang = Math.atan2(a.ty - a.sy, a.tx - a.sx);
        const shell = a.kind !== 'bullet';
        put(
          shots,
          ns,
          a.x,
          groundY(t, a.x, a.y) + 9 + (a.arc || 0),
          a.y,
          -ang,
          shell ? 9 : 16,
          shell ? 2.4 : 0.7,
          shell ? 2.4 : 0.7,
        );
        ns++;
      }
      shots.count = ns;

      men.count = nm;
      hulls.count = nv;
      turrets.count = nv;
      barrels.count = nv;
      rotors.count = nrot;
      rings.count = nr;
      for (const m of all) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },

    dispose() {
      for (const m of all) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}
