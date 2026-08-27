// Smoke, dust, sparks and blood.
//
// The simulation already keeps every particle on the field — where it is, how
// big it is, how long it has left and what kind of thing it is — because the
// top-down renderer draws them. This turns that same list into camera-facing
// quads, so nothing is invented here and nothing has to be kept in step: if the
// map shows dust, so does the field.
//
// One instanced mesh, one quaternion for the whole cloud. Billboarding a few
// hundred quads by giving them all the camera's own rotation costs nothing,
// where a mesh each would cost a few hundred draw calls.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';

const MAX = 700;

const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();

// Colour, how high off the ground it sits, and how much bigger it draws than
// the flat map draws it. Smoke stands up in a column; blood stays underfoot.
const KIND = {
  smoke: { c: [0.42, 0.4, 0.37], lift: 26, size: 2.1 },
  dust: { c: [0.62, 0.56, 0.42], lift: 10, size: 1.8 },
  spark: { c: [1, 0.86, 0.42], lift: 7, size: 1.2 },
  fireball: { c: [1, 0.56, 0.18], lift: 16, size: 2 },
  flash: { c: [1, 0.95, 0.72], lift: 11, size: 1.7 },
  muzzle: { c: [1, 0.92, 0.66], lift: 11, size: 1.4 },
  debris: { c: [0.3, 0.25, 0.18], lift: 6, size: 1 },
  leaf: { c: [0.4, 0.55, 0.25], lift: 9, size: 1.1 },
  splash: { c: [0.66, 0.78, 0.82], lift: 4, size: 1.3 },
};
const PLAIN = { c: [0.5, 0.47, 0.42], lift: 8, size: 1.4 };

export function buildParticles(scene) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);

  return {
    update(v, camera) {
      const parts = v.parts || [];
      const t = v.terrain;
      const q = camera.quaternion; // every quad faces the way the camera does
      let n = 0;
      for (let i = 0; i < parts.length && n < MAX; i++) {
        const p = parts[i];
        const k = KIND[p.type] || PLAIN;
        // Dying particles shrink rather than fade: one material, one draw call,
        // and at this size the eye cannot tell the two apart.
        const life = p.t < 0.45 ? p.t / 0.45 : 1;
        const r = (p.r || 3) * k.size * life;
        if (r < 0.2) continue;
        P.set(p.x, groundY(t, p.x, p.y) + k.lift, p.y);
        S.set(r * 2, r * 2, r * 2);
        M.compose(P, q, S);
        mesh.setMatrixAt(n, M);
        C.setRGB(k.c[0], k.c[1], k.c[2]);
        mesh.setColorAt(n, C);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },

    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}
