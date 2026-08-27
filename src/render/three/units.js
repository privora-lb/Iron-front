// The armies.
//
// Every man and every vehicle on the field is one instance of a shared mesh, so
// five hundred soldiers cost a handful of draw calls rather than five hundred.
// The shapes are built here in code — the same bargain the rest of this game
// makes: no model files, no asset pipeline, and the turret traverses because
// the simulation already knows where it is pointing.
//
// Nothing is painted in its nation's colour. Armies wear field grey and khaki
// and a tank is olive drab; what tells you whose it is at a glance is a helmet
// and a small pennant on the hull, which is roughly how it worked. That reads
// as an army rather than as two sets of coloured counters, and it still answers
// the only question that matters in a hurry — whose is that?
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundY } from './terrainMesh.js';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const MAX_MEN = 3200;
const MAX_VEH = 520;
const MAX_RING = 260;

// What each side wears, and what it paints its armour. Muted on purpose: the
// bright colour is saved for the one part of a unit that carries recognition.
const SKIN = {
  blue: { cloth: [0.29, 0.33, 0.4], armour: [0.27, 0.32, 0.3], mark: [0.36, 0.56, 0.84] },
  red: { cloth: [0.36, 0.32, 0.25], armour: [0.32, 0.3, 0.23], mark: [0.74, 0.3, 0.22] },
};

function put(mesh, i, x, y, z, rot, sx, sy, sz, pitch) {
  if (pitch) {
    E.set(0, rot, pitch, 'YZX');
    Q.setFromEuler(E);
  } else {
    Q.setFromAxisAngle(UP, rot);
  }
  P.set(x, y, z);
  S.set(sx, sy, sz);
  M.compose(P, Q, S);
  mesh.setMatrixAt(i, M);
}

const paint = (mesh, i, c) => {
  C.setRGB(c[0], c[1], c[2]);
  mesh.setColorAt(i, C);
};

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

// A man, built bigger than life on purpose: a rifleman is two paces across and
// the map is five kilometres wide, so drawn true to size he is one pixel at the
// zoom this game is played at. Legible beats accurate — the flat renderer makes
// exactly the same bargain with its icons.
const MAN = 2.3;

/** Legs, and a coat that widens at the shoulder. */
function bodyGeometry() {
  const legs = new THREE.CylinderGeometry(1.5 * MAN, 1.7 * MAN, 3.4 * MAN, 5);
  legs.translate(0, 1.7 * MAN, 0);
  const coat = new THREE.CylinderGeometry(2.3 * MAN, 1.8 * MAN, 4.2 * MAN, 6);
  coat.translate(0, 5.4 * MAN, 0);
  return mergeGeometries([legs, coat]) || coat;
}

/** A helmet: the one part that says whose army he is in. */
function helmetGeometry() {
  const dome = new THREE.SphereGeometry(1.9 * MAN, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62);
  dome.translate(0, 7.9 * MAN, 0);
  return dome;
}

// A four-sided cylinder is a box that can taper, which is what makes a hull
// read as armour with sloped plate rather than as a crate.
const slabGeometry = (top, bottom) => {
  const g = new THREE.CylinderGeometry(top, bottom, 1, 4);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  return g;
};

export function buildUnits(scene) {
  const men = instanced(bodyGeometry(), MAX_MEN, scene);
  const helms = instanced(helmetGeometry(), MAX_MEN, scene);

  const hulls = instanced(slabGeometry(0.38, 0.5), MAX_VEH, scene);
  const turrets = instanced(slabGeometry(0.34, 0.5), MAX_VEH, scene);

  // Tracks: two dark runs down the sides, which is most of what makes a shape
  // read as tracked rather than as a box on wheels.
  const trackGeo = new THREE.BoxGeometry(1, 1, 1);
  trackGeo.translate(0, 0.5, 0);
  const tracksL = instanced(trackGeo, MAX_VEH, scene, { color: 0x2a2a26 });
  const tracksR = instanced(trackGeo, MAX_VEH, scene, { color: 0x2a2a26 });

  // The barrel points down +X before it is turned, so the traverse the
  // simulation already tracks is the rotation applied here.
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.5, 1, 6);
  barrelGeo.rotateZ(Math.PI / 2);
  barrelGeo.translate(0.5, 0, 0);
  const barrels = instanced(barrelGeo, MAX_VEH, scene, { color: 0x22221f });

  // A pennant on the hull, so you can tell whose armour that is without
  // painting the whole tank in a nation's colour.
  const markGeo = new THREE.BoxGeometry(1, 1, 1);
  markGeo.translate(0, 0.5, 0);
  const marks = instanced(markGeo, MAX_VEH, scene);

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

  const all = [men, helms, hulls, turrets, tracksL, tracksR, barrels, marks, rotors, rings, shots];

  return {
    /** Lay the armies out for this frame. */
    update(v, camDist) {
      const t = v.terrain;
      const soldiers = v.soldiers || [];
      // Men grow as the camera pulls back, or a formation is a smudge at the
      // zoom a commander actually plays at.
      const far = camDist ? Math.min(3.4, Math.max(1, camDist / 1000)) : 1;
      const farV = Math.min(1.9, far);
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
        const skin = SKIN[sq.team] || SKIN.blue;
        const gy = groundY(t, s.x, s.y);

        if (ut.air) {
          if (nv >= MAX_VEH) continue;
          const fly = gy + 96;
          put(hulls, nv, s.x, fly, s.y, -s.hull, 30, 9, 11);
          paint(hulls, nv, skin.armour);
          put(turrets, nv, s.x, fly + 9, s.y, -s.hull, 13, 6, 9);
          paint(turrets, nv, skin.armour);
          // a tail boom, borrowed from the barrel mesh
          const cs0 = Math.cos(s.hull);
          const sn0 = Math.sin(s.hull);
          put(barrels, nv, s.x - cs0 * 16, fly + 4, s.y - sn0 * 16, -s.hull, 20, 2.4, 2.4);
          put(tracksL, nv, s.x, fly - 4, s.y, -s.hull, 22, 2, 3); // skids
          put(tracksR, nv, s.x, fly - 4, s.y, -s.hull + 0.002, 22, 2, 3);
          put(marks, nv, s.x, fly + 15, s.y, -s.hull, 7, 2, 3);
          paint(marks, nv, skin.mark);
          if (nrot < 80) {
            put(rotors, nrot, s.x, fly + 15, s.y, v.clock * 22, 32, 1, 32);
            nrot++;
          }
          nv++;
          continue;
        }

        if (ut.vehicle || ut.kind === 'siege') {
          if (nv >= MAX_VEH) continue;
          const gun = ut.kind === 'siege';
          const V = 1.35 * farV;
          const len = (gun ? 26 : 34) * V;
          const wide = (gun ? 16 : 19) * V;
          const tall = (gun ? 7 : 10) * V;
          const cs = Math.cos(s.hull);
          const sn = Math.sin(s.hull);

          put(hulls, nv, s.x, gy + tall * 0.34, s.y, -s.hull, len, tall, wide);
          paint(hulls, nv, skin.armour);

          // Tracks sit outboard of the hull and lower, and they are dark.
          const off = wide * 0.5;
          put(tracksL, nv, s.x + sn * off, gy, s.y - cs * off, -s.hull, len * 1.02, tall * 0.5, wide * 0.24);
          put(tracksR, nv, s.x - sn * off, gy, s.y + cs * off, -s.hull, len * 1.02, tall * 0.5, wide * 0.24);

          const turretY = gy + tall * 1.34;
          put(turrets, nv, s.x, turretY, s.y, -s.turret, (gun ? 12 : 17) * V, 6 * V, (gun ? 12 : 15) * V);
          paint(turrets, nv, skin.armour);

          // Recoil comes straight off the simulation's own kick, and a gun
          // carries its barrel up rather than level.
          const back = (s.rec || 0) * 3;
          const bl = (gun ? 24 : 26) * V - back;
          put(barrels, nv, s.x, turretY + 3 * V, s.y, -s.turret, bl, 2.3 * V, 2.3 * V, gun ? -0.42 : 0);

          put(
            marks,
            nv,
            s.x - cs * len * 0.3,
            turretY + 5.5 * V,
            s.y - sn * len * 0.3,
            -s.hull,
            7 * V,
            2 * V,
            3.4 * V,
          );
          paint(marks, nv, skin.mark);
          nv++;
          continue;
        }

        if (nm >= MAX_MEN) continue;
        const lean = s.moved ? 0.96 : 1;
        put(men, nm, s.x, gy, s.y, -s.ang, far, far * lean, far);
        paint(men, nm, skin.cloth);
        put(helms, nm, s.x, gy, s.y, -s.ang, far, far * lean, far);
        paint(helms, nm, skin.mark);
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
      helms.count = nm;
      hulls.count = nv;
      turrets.count = nv;
      tracksL.count = nv;
      tracksR.count = nv;
      barrels.count = nv;
      marks.count = nv;
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
