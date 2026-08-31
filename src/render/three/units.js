// The armies, and where every part of them is standing this frame.
//
// Every man and every vehicle on the field is one instance of a shared mesh, so
// five hundred soldiers cost a handful of draw calls rather than five hundred.
// What each of them LOOKS like is kit.js; this file is only about where the
// pieces go, and it may not write a single value back into the simulation —
// which is what keeps a match deterministic whichever way the player is
// looking at it.
//
// Nothing is painted in its nation's colour. Armies wear field grey and khaki
// and a tank is olive drab; what tells you whose it is at a glance is a helmet
// and a small pennant on the hull, which is roughly how it worked. That reads
// as an army rather than as two sets of coloured counters, and it still answers
// the only question that matters in a hurry — whose is that?
//
// WHAT IS NEW HERE, AND WHY
//
//   Vehicles LIE ON THE GROUND. Every tank on the field used to sit dead level
//   whatever it was standing on, so a column crossing a ridge stayed flat while
//   the hillside rose through it. Four samples of the same height field the
//   ground mesh is built from give the pitch and the roll, and a tank now noses
//   up a bank, tips into a rut and leans on a camber. It is the single cheapest
//   thing that makes armour look like it has weight.
//
//   They also MOVE like they have weight: the suspension works, the hull
//   squats when it pulls away and rocks when the gun fires, and the recoil the
//   simulation already tracks runs the barrel back into the mantlet instead of
//   just shortening it.
//
//   Five silhouettes instead of one. A tank, a wheeled carrier, a self-propelled
//   gun, a rocket battery and a gunship are five different shapes rather than
//   one box at five sizes, and a rifle section, a machine-gun team, a sniper
//   pair and an anti-tank team carry four different weapons.
import * as THREE from 'three';
import { groundY } from './terrainMesh.js';
import { surface, albedo } from './materials.js';
import {
  MAN,
  HIP,
  TANK_L,
  bodyGeometry,
  legGeometry,
  helmetGeometry,
  rifleGeometry,
  sniperGeometry,
  mgGeometry,
  launcherGeometry,
  tankHullGeometry,
  tankTurretGeometry,
  trackGeometry,
  apcHullGeometry,
  apcWheelsGeometry,
  apcTurretGeometry,
  spgHullGeometry,
  spgMountGeometry,
  rocketPackGeometry,
  mortarGeometry,
  heliBodyGeometry,
  rotorGeometry,
  barrelGeometry,
  wreckGeometry,
} from './kit.js';

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const P = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const MAX_MEN = 3200;
const MAX_ARM = 240; // tanks, carriers and guns each
const MAX_HELI = 64;
const MAX_MARK = MAX_ARM * 4 + MAX_HELI; // one pennant per machine on the field
const MAX_RING = 260;
const MAX_DOWN = 260; // the engine keeps no more dead on the field than this

// A man on the ground is not the colour he was standing up: field grey against
// churned earth, with the light off him.
const DEAD = [0.19, 0.19, 0.17];

// How much of its nation's colour a helmet actually wears. At full strength the
// recognition colour is brighter than anything else on the field, so a rank of
// infantry read as a row of little lamps rather than as men; knocked back it is
// still the first thing the eye finds and it is now paint on steel.
const HELM = 0.62;

// What an army actually wears.
//
// A UNIFORM is drab on purpose, because its whole reason for existing is to be
// hard to see against ground. Valenmark field their infantry in olive drab and
// Rothal in a grey-khaki, both desaturated far below anything else on the
// field, so a man reads as a soldier and the flash of colour on his helmet
// reads as whose soldier he is.
const SKIN = {
  blue: { cloth: [0.22, 0.26, 0.19], armour: [0.21, 0.25, 0.21], mark: [0.36, 0.56, 0.84] },
  red: { cloth: [0.3, 0.28, 0.22], armour: [0.28, 0.26, 0.2], mark: [0.74, 0.3, 0.22] },
};

/**
 * Put one instance somewhere.
 *
 * `pitch` turns it about its own long axis' vertical plane — nose up — and
 * `roll` tips it sideways. The Euler order is YZX, which is R = heading · pitch
 * · roll: the roll and the pitch happen in the vehicle's own frame and the
 * heading turns the result, which is the order they happen in on a hillside.
 */
function put(mesh, i, x, y, z, rot, sx, sy, sz, pitch, roll) {
  if (pitch || roll) {
    E.set(roll || 0, rot, pitch || 0, 'YZX');
    Q.setFromEuler(E);
  } else {
    Q.setFromAxisAngle(UP, rot);
  }
  P.set(x, y, z);
  S.set(sx, sy, sz);
  M.compose(P, Q, S);
  mesh.setMatrixAt(i, M);
}

// Uniforms, armour and markings are authored as colours and used as
// reflectances, so they go through the same conversion the ground does — see
// materials.js. `k` is wear, applied afterwards as a straight scale.
const paint = (mesh, i, c, k) => {
  albedo(C, c[0], c[1], c[2], k);
  mesh.setColorAt(i, C);
};

function instanced(geo, n, scene, mat) {
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}

/**
 * A cheap man, for when he is four pixels tall.
 *
 * At the zoom a commander actually plays from there can be two thousand men on
 * screen, and drawing every strap and buckle on all of them costs three million
 * triangles to produce a smudge. This is the same figure at about a tenth of
 * the cost, and past the distance it swaps in nobody can tell — which is what
 * pays for all the detail on the one in front of you.
 */
function farManGeometry() {
  const parts = [];
  const coat = new THREE.CylinderGeometry(1.1 * MAN, 0.8 * MAN, 4.2 * MAN, 5);
  coat.translate(0, 4.6 * MAN, 0);
  parts.push(coat);
  const legs = new THREE.CylinderGeometry(0.8 * MAN, 0.55 * MAN, HIP, 4);
  legs.translate(0, HIP / 2, 0);
  parts.push(legs);
  const head = new THREE.SphereGeometry(0.95 * MAN, 5, 4);
  head.scale(1, 0.9, 1);
  head.translate(0, 7.2 * MAN, 0);
  parts.push(head);
  return mergeSimple(parts);
}

/** The smallest possible geometry merge: position, normal and uv, indexed. */
function mergeSimple(parts) {
  let nv = 0;
  let ni = 0;
  for (const p of parts) {
    nv += p.attributes.position.count;
    ni += p.index ? p.index.count : p.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const pp = p.attributes.position;
    const pn = p.attributes.normal;
    const pu = p.attributes.uv;
    pos.set(pp.array, vo * 3);
    if (pn) nor.set(pn.array, vo * 3);
    if (pu) uv.set(pu.array, vo * 2);
    if (p.index) {
      for (let i = 0; i < p.index.count; i++) idx[io + i] = p.index.array[i] + vo;
      io += p.index.count;
    } else {
      for (let i = 0; i < pp.count; i++) idx[io + i] = i + vo;
      io += pp.count;
    }
    vo += pp.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/**
 * Which of the five machines this is.
 *
 * Read off what the unit table already says the thing DOES rather than off its
 * name, so a new unit gets the right body by having the right properties.
 */
function machine(ut) {
  if (ut.air) return 'heli';
  if (ut.kind === 'siege') {
    if (!ut.vehicle) return 'mortar';
    return ut.salvo ? 'mlrs' : 'spg';
  }
  if (ut.vehicle) return ut.shell ? 'tank' : 'apc';
  return null;
}

/** And which weapon he is carrying. */
function weapon(ut) {
  if (ut.tag === 'SNIPERS') return 'sniper';
  if (ut.tag === 'MG' || ut.tag === 'FLAK') return 'mg';
  if (ut.shell) return 'launcher';
  return 'rifle';
}

/**
 * How the ground lies under a vehicle.
 *
 * Four samples of the very height field the ground mesh was built from — one
 * ahead, one behind, one out to each side — and the plane through them is the
 * plane the hull rests on. `half` is half the vehicle's length and `wide` half
 * its width, both in world units, because a long tank bridges a dip a short one
 * falls into and that difference is visible.
 */
function lie(t, x, y, cs, sn, half, wide, out) {
  const gf = groundY(t, x + cs * half, y + sn * half);
  const gb = groundY(t, x - cs * half, y - sn * half);
  // local +Z runs out to (-sin, +cos) once the hull is turned by -heading
  const gp = groundY(t, x - sn * wide, y + cs * wide);
  const gm = groundY(t, x + sn * wide, y - cs * wide);
  out.y = (gf + gb + gp + gm) * 0.25;
  out.pitch = Math.atan2(gf - gb, half * 2);
  out.roll = -Math.atan2(gp - gm, wide * 2);
  return out;
}

const LIE = { y: 0, pitch: 0, roll: 0 };

export function buildUnits(scene) {
  // ——— the materials everything is made of ———
  const clothMat = surface('cloth');
  const helmMat = surface('cloth', { roughness: 0.72 });
  const gunMat = surface('steel', { color: 0x35312b });
  const armourMat = surface('armour');
  const trackMat = surface('rubber', { color: 0x2c2b28 });
  const tubeMat = surface('steel', { color: 0x2a2926 });
  const markMat = surface('cloth', { roughness: 0.8 });
  const glassMat = surface('steel', { color: 0x1c2b33, roughness: 0.14, metalness: 0.3 });
  const wreckMat = surface('armour', { color: 0x231f19, roughness: 0.94, metalness: 0.1 });

  // ——— infantry ———
  const men = instanced(bodyGeometry(), MAX_MEN, scene, clothMat);
  const helms = instanced(helmetGeometry(), MAX_MEN, scene, helmMat);
  const legL = instanced(legGeometry(), MAX_MEN, scene, clothMat);
  const legR = instanced(legGeometry(), MAX_MEN, scene, clothMat);
  const farMen = instanced(farManGeometry(), MAX_MEN, scene, clothMat);
  const rifles = instanced(rifleGeometry(), MAX_MEN, scene, gunMat);
  const snipers = instanced(sniperGeometry(), 400, scene, gunMat);
  const mgs = instanced(mgGeometry(), 800, scene, gunMat);
  const launchers = instanced(launcherGeometry(), 800, scene, gunMat);
  const WEAPON = { rifle: rifles, sniper: snipers, mg: mgs, launcher: launchers };

  // ——— armour, one kit per silhouette ———
  // A vehicle RECEIVES shadow as well as casting it, which infantry do not:
  // there are a few hundred machines and a few thousand men, the fragment cost
  // falls on whatever is on screen, and a tank is where it shows. Its own
  // turret shading its own engine deck, and the hull darkening the track run
  // under it, is most of what stops a vehicle looking like a decal.
  const armoured = (geo, max, mat) => {
    const m = instanced(geo, max, scene, mat);
    m.receiveShadow = true;
    return m;
  };
  const kit = (hullGeo, turretGeo, gunGeo, runGeo, max, runMat) => ({
    hull: armoured(hullGeo, max, armourMat),
    turret: turretGeo ? armoured(turretGeo, max, armourMat) : null,
    gun: gunGeo ? armoured(gunGeo, max, tubeMat) : null,
    runL: runGeo ? armoured(runGeo, max, runMat || trackMat) : null,
    runR: runGeo ? armoured(runGeo, max, runMat || trackMat) : null,
    n: 0,
  });

  const trackGeo = trackGeometry();
  const tank = kit(
    tankHullGeometry(), tankTurretGeometry(), barrelGeometry(24, 1.15, true), trackGeo, MAX_ARM);
  const apc = kit(
    apcHullGeometry(), apcTurretGeometry(), barrelGeometry(11, 0.55, true),
    apcWheelsGeometry(), MAX_ARM, surface('rubber', { color: 0x232220 }));
  const spg = kit(
    spgHullGeometry(), spgMountGeometry(), barrelGeometry(30, 1.0, true), trackGeo, MAX_ARM);
  const mlrs = kit(spgHullGeometry(), rocketPackGeometry(), null, trackGeo, MAX_ARM);
  const mortar = kit(mortarGeometry(), null, null, null, MAX_ARM);
  const heli = { hull: instanced(heliBodyGeometry(), MAX_HELI, scene, armourMat), n: 0 };
  const rotors = instanced(
    rotorGeometry(), MAX_HELI, scene,
    surface('steel', { color: 0x1d1d1b, transparent: true, opacity: 0.42, depthWrite: false }),
  );
  rotors.castShadow = false;
  const KITS = { tank, apc, spg, mlrs, mortar };

  // Canopy glass on the gunship, and a pennant on every hull, so you can tell
  // whose armour that is without painting the whole tank in a nation's colour.
  const canopyGeo = new THREE.SphereGeometry(1, 8, 6);
  const canopies = instanced(canopyGeo, MAX_HELI, scene, glassMat);
  const markGeo = new THREE.BoxGeometry(1, 1, 1);
  markGeo.translate(0, 0.5, 0);
  const marks = instanced(markGeo, MAX_MARK, scene, markMat);

  // ——— what the player has selected, and what is in the air ———
  const ringGeo = new THREE.RingGeometry(0.82, 1, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const rings = instanced(ringGeo, MAX_RING, scene, new THREE.MeshBasicMaterial({
    color: 0xc9a227, transparent: true, opacity: 0.7, depthWrite: false,
  }));
  rings.castShadow = false;

  // A tracer is LIGHT, not a painted object: it wants to stay bright when the
  // sun goes down and it wants no shading at all. A lit material makes it a
  // grey stick at dusk, which is exactly when tracer is worth seeing.
  const shotGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracers = instanced(shotGeo, 700, scene, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  tracers.castShadow = false;
  const shellMat = surface('steel', { color: 0x39352c });
  const shells = instanced(shotGeo, 300, scene, shellMat);

  // ——— the dead ———
  //
  // The map has always laid a man down where he fell and left a burnt-out hull
  // where a tank brewed up; in three dimensions they simply vanished, which
  // made a firefight look like men walking off it. Same list, same positions,
  // same handful of seconds — they are the engine's, not this renderer's.
  const fallen = instanced(bodyGeometry(), MAX_DOWN, scene, clothMat);
  const fallenHelms = instanced(helmetGeometry(), MAX_DOWN, scene, helmMat);
  const wrecks = instanced(wreckGeometry(), MAX_DOWN, scene, wreckMat);

  const all = [
    men, helms, legL, legR, farMen, rifles, snipers, mgs, launchers,
    tank.hull, tank.turret, tank.gun, tank.runL, tank.runR,
    apc.hull, apc.turret, apc.gun, apc.runL, apc.runR,
    spg.hull, spg.turret, spg.gun, spg.runL, spg.runR,
    mlrs.hull, mlrs.turret, mlrs.runL, mlrs.runR,
    mortar.hull, heli.hull, rotors, canopies,
    marks, rings, tracers, shells, fallen, fallenHelms, wrecks,
  ].filter(Boolean);

  const mats = [
    clothMat, helmMat, gunMat, armourMat, trackMat, tubeMat, markMat, glassMat, wreckMat,
    apc.runL.material, rotors.material, rings.material, tracers.material, shellMat,
  ];

  /** Muzzle flashes and track dust, handed out to whoever wants to draw them. */
  const events = { flash: [], dust: [] };

  return {
    events,

    /** Lay the armies out for this frame. */
    update(v, camDist) {
      const t = v.terrain;
      const soldiers = v.soldiers || [];
      // Men grow as the camera pulls back, or a formation is a smudge at the
      // zoom a commander actually plays at.
      const far = camDist ? Math.min(3.4, Math.max(1, camDist / 1000)) : 1;
      const farV = Math.min(1.9, far);
      // Past this the strapping and the buckles are below one pixel, so the
      // cheap figure goes in and four fifths of the triangles go away.
      const coarse = camDist > 2600;
      events.flash.length = 0;
      events.dust.length = 0;
      let nm = 0;
      let nf = 0;
      let nr = 0;
      let nmk = 0;
      for (const k of Object.keys(KITS)) KITS[k].n = 0;
      const wn = { rifle: 0, sniper: 0, mg: 0, launcher: 0 };

      for (let i = 0; i < soldiers.length; i++) {
        const s = soldiers[i];
        if (!s.alive) continue;
        const sq = s.sq;
        if (!v.showsTeam(sq.team) || !sq.seen) continue; // fog of war, same rule as the map
        const ut = sq.t;
        const skin = SKIN[sq.team] || SKIN.blue;
        const cs = Math.cos(s.hull === undefined ? s.ang : s.hull);
        const sn = Math.sin(s.hull === undefined ? s.ang : s.hull);
        const kind = machine(ut);

        // ——————————————————————————— gunships ———————————————————————————
        if (kind === 'heli') {
          if (heli.n >= MAX_HELI) continue;
          const n = heli.n;
          const gy = groundY(t, s.x, s.y);
          const fly = gy + 96;
          const V = 1.1;
          // A helicopter is never level. It noses down to go forward and rolls
          // into its turns, and standing still it rocks on the disc.
          const push = s.moved ? 0.2 : 0;
          const wob = Math.sin(v.clock * 1.7 + s.v * 6) * 0.03;
          put(heli.hull, n, s.x, fly, s.y, -s.hull, V, V, V, -push + wob, wob * 1.6);
          paint(heli.hull, n, skin.armour);
          put(canopies, n, s.x + cs * 8 * V, fly + 1.5 * V, s.y + sn * 8 * V, -s.hull,
            5.2 * V, 3.0 * V, 3.6 * V, -push, 0);
          // The disc, turning fast enough that only the blur of it is there.
          put(rotors, n, s.x + cs * 2.2 * V, fly + 8.4 * V, s.y + sn * 2.2 * V,
            v.clock * 26, V, V, V, -push + wob, wob * 1.6);
          if (nmk < MAX_MARK) {
            put(marks, nmk, s.x - cs * 14 * V, fly + 4 * V, s.y - sn * 14 * V, -s.hull,
              5 * V, 1.6 * V, 2.6 * V);
            paint(marks, nmk, skin.mark);
            nmk++;
          }
          heli.n++;
          continue;
        }

        // ——————————————————————————— armour ———————————————————————————
        if (kind) {
          const K = KITS[kind];
          if (K.n >= MAX_ARM) continue;
          const n = K.n;
          // Every machine is drawn at its true size and placed with ONE scale,
          // so nothing is stretched and the normal grain stays even over it.
          const V = (kind === 'mortar' ? 0.9 : kind === 'apc' ? 0.92 : 1.0) * farV;
          const half = TANK_L * 0.45 * V;
          const wide = 9 * V;
          const g = lie(t, s.x, s.y, cs, sn, half, wide, LIE);

          // The suspension. A tracked vehicle under way pitches on every
          // undulation and rolls on its torsion bars; standing still it settles.
          const roll1 = s.moved ? Math.sin(v.clock * 6.1 + s.v * 5) * 0.022 : 0;
          const pitch1 = s.moved ? Math.sin(v.clock * 4.7 + s.v * 3) * 0.018 : 0;
          // and it squats on the gun. `rec` is the simulation's own kick.
          const rec = s.rec || 0;
          const bodyPitch = g.pitch + pitch1 + rec * 0.05;
          const bodyRoll = g.roll + roll1;
          const bob = s.moved ? Math.abs(Math.sin(v.clock * 6.1 + s.v * 5)) * 0.5 * V : 0;
          const gy = g.y + bob;

          put(K.hull, n, s.x, gy, s.y, -s.hull, V, V, V, bodyPitch, bodyRoll);
          paint(K.hull, n, skin.armour, 0.94 + (s.v || 0) * 0.05);

          if (K.runL) {
            // The tracks sit outboard of the hull, and they follow the same
            // plane the hull does — which is what stops a tank standing on a
            // slope with one track buried and the other in the air.
            const off = 8.0 * V;
            put(K.runL, n, s.x - sn * off, gy, s.y + cs * off, -s.hull, V, V, V, bodyPitch, bodyRoll);
            put(K.runR, n, s.x + sn * off, gy, s.y - cs * off, -s.hull, V, V, V, bodyPitch, bodyRoll);
            if (s.moved && events.dust.length < 120) {
              events.dust.push(s.x - cs * half, s.y - sn * half, gy);
            }
          }

          if (K.turret) {
            // The turret rides on the hull's ring, so it goes up the bank with
            // the hull and traverses independently of it — both at once, which
            // is the thing that reads as a tank rather than as a diagram.
            const ringX = kind === 'tank' ? -1.0 * V : kind === 'apc' ? -1.0 * V : -6.4 * V;
            const ringY = kind === 'tank' ? 7.2 * V : kind === 'apc' ? 9.0 * V : 13.6 * V;
            const rx = s.x + cs * ringX - Math.sin(bodyPitch) * cs * ringY;
            const rz = s.y + sn * ringX - Math.sin(bodyPitch) * sn * ringY;
            const ry = gy + ringY * Math.cos(bodyPitch);
            const aim = kind === 'mlrs' || kind === 'spg' ? -0.34 : 0;
            put(K.turret, n, rx, ry, rz, -s.turret, V, V, V, aim + rec * 0.09, 0);
            paint(K.turret, n, skin.armour, 0.94 + (s.v || 0) * 0.05);

            if (K.gun) {
              // Recoil runs the tube back INTO the mantlet rather than making
              // the gun shorter, so it comes out of the smoke where it went in.
              const back = rec * 4.2 * V;
              const muzX = kind === 'tank' ? 6.0 * V : kind === 'apc' ? 2.4 * V : 3.0 * V;
              const muzY = kind === 'tank' ? 2.2 * V : kind === 'apc' ? 1.5 * V : 2.0 * V;
              const tc = Math.cos(s.turret);
              const ts = Math.sin(s.turret);
              const gx = rx + tc * (muzX - back);
              const gz = rz + ts * (muzX - back);
              put(K.gun, n, gx, ry + muzY, gz, -s.turret, V, V, V, aim + rec * 0.09, 0);
              // A gun that has just fired has fire at the end of it.
              if (rec > 0.72 && events.flash.length < 90) {
                const len = (kind === 'tank' ? 24 : 30) * V;
                events.flash.push(gx + tc * len, ry + muzY + Math.sin(aim) * len, gz + ts * len, len * 0.2);
              }
            }
          }

          if (nmk < MAX_MARK) {
            put(marks, nmk, s.x - cs * 11 * V, gy + 9.6 * V, s.y - sn * 11 * V, -s.hull,
              5 * V, 1.4 * V, 2.6 * V, bodyPitch, bodyRoll);
            paint(marks, nmk, skin.mark);
            nmk++;
          }
          K.n++;
          continue;
        }

        // ——————————————————————————— men ———————————————————————————
        const gy = groundY(t, s.x, s.y);
        // The walk, off the simulation's own phase.
        //
        // `step` has been advanced by every pace every man has taken since the
        // battle started — it is saved with the match and it is what the flat
        // map has always bobbed its men on. A stride, a lift onto the ball of
        // the foot, a lean into the march and a flinch when he fires are all
        // already known; none of it is invented here.
        const stride = Math.sin(s.step);
        const rise = Math.abs(Math.cos(s.step));
        const going = s.moved ? 1 : 0;
        // Never quite still: a man standing is still breathing, and a rank of
        // perfectly rigid figures is what reads as models on a table.
        const breathe = Math.sin(v.clock * 2.1 + s.v * 3) * 0.16;
        const bob = (going ? rise * 1.5 : breathe) * far;
        const kick = Math.max(0, s.kick || 0);
        const ca = Math.cos(s.ang);
        const sa = Math.sin(s.ang);
        // He rocks back on the shot, and no two men stand quite square.
        const bx = s.x - ca * kick * 1.6;
        const by = s.y - sa * kick * 1.6;
        const face = -(s.ang + s.v * 0.05);
        const lean = going ? -0.12 : breathe * 0.1; // into the march
        // A little colour between one man and the next. A platoon in which
        // every single coat is the identical value is the thing that reads as
        // one model stamped out forty times.
        const worn = 0.9 + (s.v || 0) * 0.11;

        if (coarse) {
          if (nf >= MAX_MEN) continue;
          put(farMen, nf, bx, gy + bob, by, face, far, far, far, lean);
          paint(farMen, nf, skin.cloth, worn);
          put(helms, nf, bx, gy + bob, by, face, far, far, far, lean);
          paint(helms, nf, skin.mark, HELM);
          nf++;
          continue;
        }

        if (nm >= MAX_MEN) continue;
        put(men, nm, bx, gy + bob, by, face, far, far, far, lean);
        paint(men, nm, skin.cloth, worn);
        put(helms, nm, bx, gy + bob, by, face, far, far, far, lean);
        paint(helms, nm, skin.mark, HELM);

        const arm = weapon(ut);
        const W = WEAPON[arm];
        const wi = wn[arm];
        if (wi < W.instanceMatrix.count) {
          put(W, wi, bx, gy + bob, by, face, far, far, far, lean - kick * 0.35);
          wn[arm]++;
          // Muzzle flash, at the end of the barrel rather than on his chest.
          if (kick > 0.75 && events.flash.length < 90) {
            const reach = 3.4 * MAN * far;
            events.flash.push(bx + ca * reach, gy + bob + 5.5 * MAN * far, by + sa * reach, 3.2 * far);
          }
        }

        // The legs swing about the hip, a half-pace out of step with each
        // other. Standing still they hang.
        const swing = going ? stride * 0.62 : 0;
        const hipY = gy + bob + HIP * far;
        const off = 0.55 * MAN * far;
        put(legL, nm, bx + sa * off, hipY, by - ca * off, face, far, far, far, swing);
        paint(legL, nm, skin.cloth, worn);
        put(legR, nm, bx - sa * off, hipY, by + ca * off, face, far, far, far, -swing);
        paint(legR, nm, skin.cloth, worn);
        nm++;
      }

      // The dead, going down and settling. `t` runs from its full span to
      // nothing, so `k` is how far through the fall he is: he tips over in the
      // first third of it and then sinks away.
      const down = v.bodies || [];
      let nd = 0;
      let nw = 0;
      for (let i = 0; i < down.length; i++) {
        const b = down[i];
        const left = b.max ? b.t / b.max : 0;
        if (left <= 0) continue;
        const k = 1 - left;
        const gone = left < 0.22 ? left / 0.22 : 1; // the last moment shrinks away
        const by = groundY(t, b.x, b.y);
        if (b.veh) {
          if (nw >= MAX_DOWN) continue;
          const settle = 1 - k * 0.3;
          put(wrecks, nw, b.x, by, b.y, -(b.a + b.spin * k), gone, settle * gone, gone);
          nw++;
          continue;
        }
        if (nd >= MAX_DOWN) continue;
        // Tipping: upright at the instant he is hit, flat a third of a second
        // later, and the spin the map gives him carries his bearing round.
        const tip = Math.min(1, k * 3.2) * 1.45;
        const sc = far * gone;
        put(fallen, nd, b.x, by, b.y, -(b.a + b.spin * k), sc, sc, sc, tip);
        paint(fallen, nd, DEAD);
        put(fallenHelms, nd, b.x, by, b.y, -(b.a + b.spin * k), sc, sc, sc, tip);
        paint(fallenHelms, nd, (SKIN[b.team] || SKIN.blue).mark, 0.6);
        nd++;
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

      // Rounds in the air, along the line they are actually travelling — and a
      // shell that is lobbed climbs and falls, because the engine already
      // works out the arc and the flat map has always drawn it.
      const inAir = v.shots || [];
      let nt = 0;
      let ns = 0;
      for (let i = 0; i < inAir.length; i++) {
        const a = inAir[i];
        const ang = Math.atan2(a.ty - a.sy, a.tx - a.sx);
        const y = groundY(t, a.x, a.y) + 9 + (a.arc || 0);
        if (a.kind === 'bullet') {
          if (nt >= 700) continue;
          // A tracer is a streak, not a dot: long enough to read as a round
          // going somewhere at speed.
          put(tracers, nt, a.x, y, a.y, -ang, 26, 0.85, 0.85);
          C.setRGB(1, 0.82, 0.42);
          tracers.setColorAt(nt, C);
          nt++;
        } else {
          if (ns >= 300) continue;
          // A shell noses over the top of its arc rather than flying flat.
          const dive = a.lob ? Math.cos((a.t || 0) * Math.PI) * 0.5 : 0;
          put(shells, ns, a.x, y, a.y, -ang, 11, 2.6, 2.6, dive);
          ns++;
        }
      }

      men.count = nm;
      legL.count = nm;
      legR.count = nm;
      farMen.count = nf;
      helms.count = coarse ? nf : nm;
      rifles.count = wn.rifle;
      snipers.count = wn.sniper;
      mgs.count = wn.mg;
      launchers.count = wn.launcher;
      for (const k of Object.keys(KITS)) {
        const K = KITS[k];
        K.hull.count = K.n;
        if (K.turret) K.turret.count = K.n;
        if (K.gun) K.gun.count = K.n;
        if (K.runL) K.runL.count = K.n;
        if (K.runR) K.runR.count = K.n;
      }
      heli.hull.count = heli.n;
      rotors.count = heli.n;
      canopies.count = heli.n;
      marks.count = nmk;
      rings.count = nr;
      tracers.count = nt;
      shells.count = ns;
      fallen.count = nd;
      fallenHelms.count = nd;
      wrecks.count = nw;
      for (const m of all) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },

    /** What is on the field, for the tests and for anyone wondering why it
     *  looks wrong. */
    counts() {
      return {
        men: men.count, far: farMen.count, tanks: tank.n, apcs: apc.n,
        guns: spg.n + mlrs.n + mortar.n, heli: heli.n,
        tracers: tracers.count, shells: shells.count, wrecks: wrecks.count,
      };
    },

    dispose() {
      for (const m of all) {
        scene.remove(m);
        m.geometry.dispose();
      }
      for (const m of mats) m.dispose();
    },
  };
}
