// The people who live here, and the birds over them.
//
// Neither is anything to do with the war. The villages are inhabited — farmers
// who walk out to a plot, work it, and walk home; villagers who bolt for the
// house when there is shooting within five hundred metres and cower against the
// wall until it stops — and there are flocks going over the whole time. All of
// it has been simulated since long before there was a 3D view, and drawn only
// on the flat map, so the field you could stand in was the one place on this
// battlefield where nobody lived.
//
// It costs three draw calls. Nothing here is ever read back by a rule: killing
// every civilian on the map leaves stateHash() untouched, which is what lets
// them be free in lockstep.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';

const MAX_CIVS = 260;
const MAX_BIRDS = 90;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// The same scale the soldiers are built at, so a villager standing beside a
// rifleman is the same size as him.
const MAN = 2.3;

function put(mesh, i, x, y, z, rot, s, pitch) {
  if (pitch) {
    E.set(0, rot, pitch, 'YZX');
    Q.setFromEuler(E);
  } else {
    Q.setFromAxisAngle(UP, rot);
  }
  P.set(x, y, z);
  S.set(s, s, s);
  M.compose(P, Q, S);
  mesh.setMatrixAt(i, M);
}

/** A civilian: no helmet, no rifle, and a smock rather than a greatcoat. */
function civGeometry() {
  const body = new THREE.CylinderGeometry(1.35 * MAN, 1.1 * MAN, 4.6 * MAN, 6);
  body.translate(0, 3.4 * MAN, 0);
  return body;
}

function headGeometry() {
  const g = new THREE.SphereGeometry(0.78 * MAN, 7, 5);
  g.translate(0, 6.2 * MAN, 0);
  return g;
}

/** A bird: two swept wings that beat. Nine triangles, seen at four hundred
 *  metres, and worth every one of them. */
function birdGeometry() {
  const g = new THREE.BufferGeometry();
  const v = [
    0, 0, 0, -1.6, 0.15, -3.4, -1.6, 0.15, 3.4, // the two wings as one sweep
    0.9, 0, 0, -1.4, 0, -0.5, -1.4, 0, 0.5, // and a body between them
  ];
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

function instanced(geo, n, scene, opts) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(opts), n);
  m.castShadow = false;
  m.receiveShadow = false;
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0;
  scene.add(m);
  return m;
}

export function buildLife(scene) {
  const bodies = instanced(civGeometry(), MAX_CIVS, scene, { color: 0xffffff });
  const heads = instanced(headGeometry(), MAX_CIVS, scene, { color: 0xffffff });
  const birds = instanced(birdGeometry(), MAX_BIRDS, scene, {
    color: 0x2b2a26,
    side: THREE.DoubleSide,
  });
  const all = [bodies, heads, birds];

  return {
    meshes: all,

    update(v) {
      const t = v.terrain;
      let n = 0;

      /* ---- the village ---- */
      const cs = v.civs || [];
      for (let i = 0; i < cs.length && n < MAX_CIVS; i++) {
        const c = cs[i];
        if (!c.alive) continue;
        // They are only drawn where somebody of yours can see them, the same
        // rule the flat map plays by: a farmer in a field is as good a marker
        // of enemy ground being quiet as anything the army could give you.
        if (!seen(v, c.x, c.y)) continue;
        const gy = groundY(t, c.x, c.y);
        const down = c.st === 'cower';
        // `ph` is their own gait — it is advanced when they walk and when they
        // are working a plot, and it stays put when they are standing still.
        const bob = down ? 0 : Math.abs(Math.sin(c.ph)) * 1.3;
        // Flat against the wall when there is shooting: it is the clearest
        // thing on the field that something has gone wrong nearby.
        const pitch = down ? 1.32 : Math.sin(c.ph * 2) * 0.05;
        put(bodies, n, c.x, gy + bob, c.y, -c.ang, 1, pitch);
        const g = c.job === 'farmer' ? 0.42 : 0.34;
        C.setRGB(g * 1.16, g * 1.02, g * 0.8);
        bodies.setColorAt(n, C);
        put(heads, n, c.x, gy + bob, c.y, -c.ang, 1, pitch);
        C.setRGB(0.66, 0.53, 0.4);
        heads.setColorAt(n, C);
        n++;
      }
      bodies.count = n;
      heads.count = n;

      /* ---- and the sky above it ---- */
      const bs = v.birds || [];
      let nb = 0;
      for (let i = 0; i < bs.length; i++) {
        const b = bs[i];
        const lead = Math.atan2(0, b.v);
        for (let k = 0; k < b.n && nb < MAX_BIRDS; k++) {
          // A flock in a loose echelon behind its leader, each bird beating a
          // little out of time with the one in front.
          const back = k * 26;
          const side = (k % 2 ? 1 : -1) * ((k + 1) >> 1) * 17;
          const x = b.x - Math.sign(b.v) * back;
          const y = b.y + side;
          const flap = Math.sin(b.ph + k * 0.9);
          put(
            birds,
            nb,
            x,
            groundY(t, x, y) + 190 + Math.sin(b.ph * 0.4 + k) * 12,
            y,
            lead + (b.v < 0 ? Math.PI : 0),
            3.1,
            flap * 0.5,
          );
          nb++;
        }
      }
      birds.count = nb;

      for (const m of all) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },

    counts: () => ({ civs: bodies.count, birds: birds.count }),

    dispose() {
      for (const m of all) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}

/** Is anything of the watching side looking at this spot? */
function seen(v, x, y) {
  const home = v.viewTeam === 'blue' ? -1 : 1;
  if ((x - v.terrain.W / 2) * home < 0) return true; // your own half needs no scouting
  const eyes = v.eyes || [];
  for (let e = 0; e + 2 < eyes.length; e += 3) {
    const dx = x - eyes[e];
    const dy = y - eyes[e + 1];
    if (dx * dx + dy * dy < eyes[e + 2] * eyes[e + 2]) return true;
  }
  return false;
}
