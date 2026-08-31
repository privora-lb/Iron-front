// Things thrown into the air, and what happens to them next.
//
// The battlefield had no physics on it at all. A gun fired and a flat orange
// disc appeared on the muzzle for a tenth of a second; a shell landed and a
// puff was drawn where it landed; a column of armour crossed a dry field and
// left the air behind it perfectly clean. Nothing was ever THROWN, nothing
// fell, and nothing bounced — so nothing on screen had any weight.
//
// This is a small rigid-body layer that fixes that. Every mote in it has a
// position and a velocity, gravity pulls on it, it turns end over end as it
// goes, and when it reaches the ground it either bounces off the very height
// field the ground mesh was built from or stops dead in it. Clods of earth from
// a shell strike arc up and rain back down. Spent cases tumble out of a
// breech, land, and skitter. Dust rolls off a track and drifts downwind.
//
// ═══════════════════════════════════════════════════════════════════════════
// NONE OF THIS IS THE SIMULATION, AND NONE OF IT MAY BECOME THE SIMULATION.
//
// Two machines playing the same match run the same tick stream and must reach
// byte-identical state. Everything here is seeded from Math.random(), stepped
// on the WALL clock rather than the tick clock, and never read by anything but
// the renderer — which is exactly the bargain the game already makes for blood,
// smoke and weather. A mote may be told about the battle. It may never tell the
// battle anything.
// ═══════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';
import { surface } from './materials.js';

const MAX_CHUNK = 900; // clods, splinters, spent cases — things with mass
const MAX_PUFF = 700; // dust, smoke, muzzle blast — things without

// How hard gravity pulls, in world units per second squared. A tank is thirty
// four units long and about six and a half metres, so a metre is roughly five
// units and nine point eight becomes about fifty. Setting this by eye instead
// gets you the moon.
const G = 52;

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();

const rnd = (a, b) => a + Math.random() * (b - a);

/** A soft round blob to draw dust and fire with, computed rather than loaded. */
function puffTexture() {
  const N = 32;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      // squared falloff, so the edge goes to nothing rather than ending on a ring
      const a = Math.max(0, 1 - d);
      const i = (y * N + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a * a * 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Give an instanced material a per-instance ALPHA.
 *
 * three hands out a per-instance colour and nothing else, so a cloud of dust
 * could only be faded by shrinking it — and dust does not shrink as it goes,
 * it spreads out and thins. One attribute and four lines of shader is the
 * difference between smoke that disperses and smoke that is sucked back into
 * the ground it came from.
 */
function fadeable(material, mesh, max) {
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('iAlpha', alpha);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vIfA;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIfA = iAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vIfA;')
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n  gl_FragColor.a *= vIfA;',
      );
  };
  material.customProgramCacheKey = () => 'if-fade';
  return alpha;
}

export function buildDebris(scene) {
  const tex = puffTexture();

  // ——— things with mass ———
  //
  // A four-sided pyramid rather than a cube: a clod of earth has corners, and
  // an irregular solid catches the light differently on every face as it turns,
  // which is what makes a tumble read as a tumble.
  const chunkGeo = new THREE.TetrahedronGeometry(1, 0);
  const chunkMat = surface('earth', { color: 0xffffff });
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, MAX_CHUNK);
  chunks.frustumCulled = false;
  chunks.castShadow = false;
  chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chunks.count = 0;
  scene.add(chunks);

  // ——— things without ———
  // Two quads, not one shared between them: fadeable() hangs a per-instance
  // alpha attribute on the GEOMETRY, and a geometry shared by the dust and the
  // fire would have one cloud writing over the other's opacity every frame.
  const puffGeo = new THREE.PlaneGeometry(1, 1);
  const fireGeo = new THREE.PlaneGeometry(1, 1);
  const puffMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const puffs = new THREE.InstancedMesh(puffGeo, puffMat, MAX_PUFF);
  puffs.frustumCulled = false;
  puffs.castShadow = false;
  puffs.renderOrder = 2;
  puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  puffs.count = 0;
  const puffAlpha = fadeable(puffMat, puffs, MAX_PUFF);
  scene.add(puffs);

  // Fire is not smoke and must not be blended like it: a muzzle flash ADDS
  // light to what is behind it, which is why it reads as bright at midday and
  // lights the ground at night, and why the same quad blended normally reads as
  // a grey sticker.
  const fireMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const fires = new THREE.InstancedMesh(fireGeo, fireMat, 240);
  fires.frustumCulled = false;
  fires.castShadow = false;
  fires.renderOrder = 3;
  fires.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fires.count = 0;
  const fireAlpha = fadeable(fireMat, fires, 240);
  scene.add(fires);

  // The pools. Plain arrays of objects rather than parallel typed arrays: a few
  // hundred motes is nothing, and this stays readable.
  const chunkPool = [];
  const puffPool = [];
  const firePool = [];
  for (let i = 0; i < MAX_CHUNK; i++) {
    chunkPool.push({ t: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, sx: 0, sy: 0, sz: 0, a: 0, c: [1, 1, 1], rest: 0.34 });
  }
  for (let i = 0; i < MAX_PUFF; i++) {
    puffPool.push({ t: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, grow: 0, a: 0.5, c: [1, 1, 1] });
  }
  for (let i = 0; i < 240; i++) {
    firePool.push({ t: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 1, grow: 0, a: 1, c: [1, 1, 1] });
  }
  let chunkAt = 0;
  let puffAt = 0;
  let fireAt = 0;

  // The oldest mote is the one that gets recycled, which is what stops a busy
  // second of battle from silently dropping every new spark on the floor.
  const take = (pool, cursor) => {
    const p = pool[cursor % pool.length];
    return p;
  };

  // Every shell burst the engine has already reported, so one is not turned
  // into a shower of earth twice. A WeakSet, so a particle that has expired is
  // forgotten the moment the engine stops holding it.
  const seen = new WeakSet();

  let last = 0;

  return {
    /**
     * Throw a handful of earth up out of a shell strike.
     *
     * The cone is deliberately narrow and steep — a shell digs down and the
     * spoil goes UP, and a flat spray reads as a firework.
     */
    burst(x, y, z, power) {
      const n = Math.min(22, 4 + Math.round(power * 1.6));
      for (let i = 0; i < n; i++) {
        const p = take(chunkPool, chunkAt++);
        const a = rnd(0, Math.PI * 2);
        const up = rnd(0.55, 1.0);
        const sp = rnd(24, 46) * (0.6 + power * 0.1);
        p.t = p.max = rnd(1.1, 2.4);
        p.x = x + rnd(-4, 4);
        p.y = y + 2;
        p.z = z + rnd(-4, 4);
        p.vx = Math.cos(a) * sp * (1 - up);
        p.vz = Math.sin(a) * sp * (1 - up);
        p.vy = sp * up * 2.1;
        p.r = rnd(0.9, 3.2) * (0.7 + power * 0.06);
        p.sx = rnd(-9, 9);
        p.sy = rnd(-9, 9);
        p.sz = rnd(-9, 9);
        p.rest = 0.24;
        const k = rnd(0.55, 1.0);
        p.c = [0.3 * k, 0.26 * k, 0.2 * k];
      }
      // and the column of dust it leaves standing
      for (let i = 0; i < 5; i++) {
        const q = take(puffPool, puffAt++);
        q.t = q.max = rnd(1.4, 2.6);
        q.x = x + rnd(-6, 6);
        q.y = y + rnd(2, 14) + i * 3;
        q.z = z + rnd(-6, 6);
        q.vx = rnd(-6, 6);
        q.vy = rnd(9, 22);
        q.vz = rnd(-6, 6);
        q.r = rnd(10, 20) + power;
        q.grow = rnd(14, 26);
        q.a = 0.5;
        const k = rnd(0.72, 1.0);
        q.c = [0.52 * k, 0.47 * k, 0.38 * k];
      }
    },

    /** The blast at the end of a barrel, and what comes out with it. */
    flash(x, y, z, size) {
      const f = take(firePool, fireAt++);
      f.t = f.max = 0.09;
      f.x = x;
      f.y = y;
      f.z = z;
      f.vx = f.vy = f.vz = 0;
      f.r = size * 2.4;
      f.grow = size * 6;
      f.a = 1;
      f.c = [1, 0.86, 0.52];
      // the smoke it leaves hanging
      const q = take(puffPool, puffAt++);
      q.t = q.max = rnd(0.5, 1.1);
      q.x = x;
      q.y = y;
      q.z = z;
      q.vx = rnd(-2, 2);
      q.vy = rnd(3, 8);
      q.vz = rnd(-2, 2);
      q.r = size * 1.6;
      q.grow = size * 5;
      q.a = 0.28;
      q.c = [0.6, 0.58, 0.54];
      // and a spent case out of the breech, which lands and skitters
      if (size > 6) {
        const p = take(chunkPool, chunkAt++);
        p.t = p.max = rnd(1.4, 2.2);
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = rnd(-16, 16);
        p.vy = rnd(14, 26);
        p.vz = rnd(-16, 16);
        p.r = 1.1;
        p.sx = rnd(-14, 14);
        p.sy = rnd(-14, 14);
        p.sz = rnd(-14, 14);
        p.rest = 0.5;
        p.c = [0.62, 0.52, 0.24]; // brass
      }
    },

    /** Dust rolling off a track, or out from under a rotor. */
    dust(x, y, z, size, lift) {
      const q = take(puffPool, puffAt++);
      q.t = q.max = rnd(0.8, 1.7);
      q.x = x + rnd(-4, 4);
      q.y = y + rnd(1, 5);
      q.z = z + rnd(-4, 4);
      q.vx = rnd(-5, 5);
      q.vy = lift === undefined ? rnd(2, 7) : lift;
      q.vz = rnd(-5, 5);
      q.r = size;
      q.grow = size * 2.2;
      q.a = 0.2;
      const k = rnd(0.8, 1.05);
      q.c = [0.56 * k, 0.5 * k, 0.4 * k];
    },

    /**
     * Step every mote, and lay them out for the camera.
     *
     * @param now  the WALL clock in seconds — this runs whether or not the
     *             battle is paused, exactly as the river and the wind do
     */
    update(v, camera, now, events) {
      const t = v.terrain;
      const dt = last ? Math.min(0.05, Math.max(0, now - last)) : 0;
      last = now;

      // What the armies did this frame: a muzzle flash where a gun fired, dust
      // where a track turned. units.js reports both rather than this module
      // guessing at them from positions.
      if (events) {
        for (let i = 0; i + 3 < events.flash.length; i += 4) {
          this.flash(events.flash[i], events.flash[i + 1], events.flash[i + 2], events.flash[i + 3]);
        }
        for (let i = 0; i + 2 < events.dust.length; i += 3) {
          if (Math.random() < 0.4) this.dust(events.dust[i], events.dust[i + 2], events.dust[i + 1], 9);
        }
      }

      // Shell strikes. The engine already reports every burst as a fireball on
      // its own particle list; each one is turned into thrown earth exactly
      // once, the first frame it is seen.
      const parts = v.parts || [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type !== 'fireball' || seen.has(p)) continue;
        seen.add(p);
        this.burst(p.x, groundY(t, p.x, p.y), p.y, Math.min(12, (p.r || 6) * 0.5));
      }

      // The wind pushes everything light, and nothing heavy. This is the same
      // wind the grass leans in.
      const w = v.wind || { a: 0, v: 0 };
      const wx = Math.cos(w.a) * (w.v || 0) * 9;
      const wz = Math.sin(w.a) * (w.v || 0) * 9;

      let nc = 0;
      for (let i = 0; i < chunkPool.length && nc < MAX_CHUNK; i++) {
        const p = chunkPool[i];
        if (p.t <= 0) continue;
        p.t -= dt;
        if (p.t <= 0) continue;
        p.vy -= G * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const g = groundY(t, p.x, p.z) + p.r * 0.5;
        if (p.y < g) {
          // It hits the ground: some of the speed goes into the ground, the
          // rest turns it over. Below a crawl it simply stops and lies there,
          // which is what stops a field of clods jittering for ever.
          p.y = g;
          if (p.vy < -6) {
            p.vy = -p.vy * p.rest;
            p.vx *= 0.55;
            p.vz *= 0.55;
            p.sx *= 0.5;
            p.sy *= 0.5;
            p.sz *= 0.5;
          } else {
            p.vy = 0;
            p.vx *= 0.82;
            p.vz *= 0.82;
            p.sx *= 0.86;
            p.sy *= 0.86;
            p.sz *= 0.86;
          }
        }
        const life = p.t / p.max;
        const r = p.r * (life < 0.25 ? life / 0.25 : 1);
        E.set(p.sx * (p.max - p.t), p.sy * (p.max - p.t), p.sz * (p.max - p.t));
        Q.setFromEuler(E);
        P.set(p.x, p.y, p.z);
        S.set(r, r, r);
        M.compose(P, Q, S);
        chunks.setMatrixAt(nc, M);
        C.setRGB(p.c[0], p.c[1], p.c[2]);
        chunks.setColorAt(nc, C);
        nc++;
      }

      const q4 = camera.quaternion; // every quad faces the way the camera does
      let np = 0;
      for (let i = 0; i < puffPool.length && np < MAX_PUFF; i++) {
        const p = puffPool[i];
        if (p.t <= 0) continue;
        p.t -= dt;
        if (p.t <= 0) continue;
        // Dust is heavy enough to settle and light enough to be blown along.
        p.vy -= G * 0.06 * dt;
        p.vx += (wx - p.vx) * 0.9 * dt;
        p.vz += (wz - p.vz) * 0.9 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const life = p.t / p.max;
        const age = 1 - life;
        const r = p.r + p.grow * age;
        const g = groundY(t, p.x, p.z);
        if (p.y < g + r * 0.2) p.y = g + r * 0.2; // it rolls along the ground, not through it
        P.set(p.x, p.y, p.z);
        S.set(r * 2, r * 2, r * 2);
        M.compose(P, q4, S);
        puffs.setMatrixAt(np, M);
        C.setRGB(p.c[0], p.c[1], p.c[2]);
        puffs.setColorAt(np, C);
        // in fast, out slow: a puff appears at once and thins away
        puffAlpha.array[np] = p.a * Math.min(1, life * 3.2) * life;
        np++;
      }

      let nf = 0;
      for (let i = 0; i < firePool.length && nf < 240; i++) {
        const p = firePool[i];
        if (p.t <= 0) continue;
        p.t -= dt;
        if (p.t <= 0) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const life = p.t / p.max;
        const r = p.r + p.grow * (1 - life);
        P.set(p.x, p.y, p.z);
        S.set(r * 2, r * 2, r * 2);
        M.compose(P, q4, S);
        fires.setMatrixAt(nf, M);
        C.setRGB(p.c[0], p.c[1], p.c[2]);
        fires.setColorAt(nf, C);
        fireAlpha.array[nf] = life;
        nf++;
      }

      chunks.count = nc;
      puffs.count = np;
      fires.count = nf;
      for (const m of [chunks, puffs, fires]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      puffAlpha.needsUpdate = true;
      fireAlpha.needsUpdate = true;
    },

    /** What is in the air, for the tests. */
    counts() {
      return { chunks: chunks.count, puffs: puffs.count, fires: fires.count };
    },

    dispose() {
      for (const m of [chunks, puffs, fires]) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
      tex.dispose();
    },
  };
}
