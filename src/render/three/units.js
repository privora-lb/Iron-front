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
const MAX_DOWN = 260; // the engine keeps no more dead on the field than this

// What each side wears, and what it paints its armour. Muted on purpose: the
// bright colour is saved for the one part of a unit that carries recognition.
// A man on the ground is not the colour he was standing up: field grey against
// churned earth, with the light off him.
const DEAD = [0.19, 0.19, 0.17];

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

// Where the hip is, in man-units. Everything above it rides on the walk and
// everything below it does the walking.
const HIP = 3.6 * MAN;

/**
 * The coat, from the hip up, widening at the shoulder.
 *
 * Reproportioned: it used to be a barrel two and a third man-units in radius
 * with legs buried inside it and a helmet nearly as wide as the shoulders, and
 * close to it read as a skittle. A man is about four times as tall as he is
 * broad, and the legs have to show below the coat or there is no walk to see.
 */
function bodyGeometry() {
  // Narrower than it was. At 1.55 man-units of shoulder the coat was a barrel
  // wide enough to swallow the arms whole, which is exactly what happened the
  // first time they were added: they were set at 1.34 and vanished inside it.
  const coat = new THREE.CylinderGeometry(1.16 * MAN, 0.94 * MAN, 3.2 * MAN, 7);
  coat.translate(0, 5.1 * MAN, 0);
  const neck = new THREE.CylinderGeometry(0.5 * MAN, 0.62 * MAN, 0.7 * MAN, 5);
  neck.translate(0, 6.9 * MAN, 0);
  const head = new THREE.SphereGeometry(0.78 * MAN, 7, 5);
  head.translate(0, 7.35 * MAN, 0);

  // ARMS. A shape with a head, a body and legs and no arms is a chess piece;
  // it is the arms coming forward onto the rifle that make the silhouette read
  // as a man carrying a weapon rather than as a skittle with a stick beside it.
  // They are baked into the coat rather than instanced separately because they
  // do not move independently of it - the walk is in the legs and the hips -
  // and two more draw calls for a thousand men is not worth a shrug.
  const arms = [];
  for (const side of [-1, 1]) {
    // upper arm, hanging from the shoulder and angled in toward the grip
    const up = new THREE.CylinderGeometry(0.3 * MAN, 0.27 * MAN, 1.6 * MAN, 5);
    up.rotateZ(side * -0.26);
    up.translate(side * 1.34 * MAN, 5.7 * MAN, 0);
    arms.push(up);
    // forearm, brought forward and in onto the weapon: both hands meet in front
    // of the chest, which is the shape that says "carrying a rifle" at a
    // hundred metres when no detail survives at all.
    const fore = new THREE.CylinderGeometry(0.26 * MAN, 0.24 * MAN, 1.5 * MAN, 5);
    fore.rotateX(-Math.PI / 2);
    fore.rotateY(side * 0.42);
    fore.translate(side * 1.16 * MAN, 5.15 * MAN, 0.86 * MAN);
    arms.push(fore);
  }
  // A pack on his back, and a rolled blanket over it. Kit is what separates a
  // soldier from a man in a coat.
  const pack = new THREE.BoxGeometry(1.6 * MAN, 1.6 * MAN, 0.8 * MAN);
  pack.translate(0, 5.5 * MAN, -1.15 * MAN);
  const roll = new THREE.CylinderGeometry(0.28 * MAN, 0.28 * MAN, 1.6 * MAN, 5);
  roll.rotateZ(Math.PI / 2);
  roll.translate(0, 6.4 * MAN, -1.15 * MAN);
  return mergeGeometries([coat, neck, head, pack, roll, ...arms]) || coat;
}

/**
 * One leg, hanging from the origin.
 *
 * Built downward from nothing so that the instance can be placed AT the hip and
 * swung about it: rotate a leg whose origin is at its foot and it scythes
 * through the ground.
 */
function legGeometry() {
  const g = new THREE.CylinderGeometry(0.42 * MAN, 0.3 * MAN, HIP, 5);
  g.translate(0, -HIP / 2, 0);
  const boot = new THREE.BoxGeometry(0.9 * MAN, 0.3 * MAN, 0.42 * MAN);
  boot.translate(0.14 * MAN, -HIP + 0.15 * MAN, 0);
  return mergeGeometries([g, boot]) || g;
}

/**
 * A rifle, carried across the body.
 *
 * The single thing that makes a shape at this distance read as a soldier rather
 * than as a skittle. It is four hundred triangles for a thousand men and it is
 * worth more than any of them.
 */
function rifleGeometry() {
  // Shorter and carried closer in. At four and a half man-units it was a lance:
  // it reached further in front of him than he was wide and read as a plank
  // stuck through a skittle. A rifle is about as long as a man's arm span.
  const body = new THREE.BoxGeometry(1, 1, 1);
  body.scale(3.0 * MAN, 0.24 * MAN, 0.2 * MAN);
  body.translate(0.9 * MAN, 5.5 * MAN, 0.9 * MAN);
  // the magazine, which is the one detail that survives being three pixels tall
  const mag = new THREE.BoxGeometry(1, 1, 1);
  mag.scale(0.3 * MAN, 0.5 * MAN, 0.18 * MAN);
  mag.translate(0.7 * MAN, 5.24 * MAN, 0.9 * MAN);
  return mergeGeometries([body, mag]) || body;
}

/** A helmet: the one part that says whose army he is in. */
function helmetGeometry() {
  const dome = new THREE.SphereGeometry(1.02 * MAN, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.66);
  dome.translate(0, 7.28 * MAN, 0);
  // The brim. It is what makes a dome read as a helmet rather than as a head.
  const brim = new THREE.CylinderGeometry(1.2 * MAN, 1.2 * MAN, 0.16 * MAN, 9);
  brim.translate(0, 7.3 * MAN, 0);
  return mergeGeometries([dome, brim]) || dome;
}

// A four-sided cylinder is a box that can taper, which is what makes a hull
// read as armour with sloped plate rather than as a crate.
const slabGeometry = (top, bottom) => {
  const g = new THREE.CylinderGeometry(top, bottom, 1, 4);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  return g;
};

/**
 * A hull with a nose on it.
 *
 * A plain tapered slab is a wedge, and a wedge with a stick out of the front is
 * what a tank looked like here. Real armour has a glacis - a steeply sloped
 * front plate - and a squarer engine deck behind, and the change of angle along
 * the top is what the eye reads as "tank" before it can make out any detail.
 */
function hullGeometry() {
  const body = slabGeometry(0.4, 0.5);
  const glacis = new THREE.CylinderGeometry(0.2, 0.42, 1, 4);
  glacis.rotateY(Math.PI / 4);
  glacis.rotateZ(-0.5);
  glacis.scale(0.62, 0.5, 1);
  glacis.translate(0.42, 0.3, 0);
  const deck = new THREE.BoxGeometry(0.36, 0.3, 0.78);
  deck.translate(-0.3, 0.72, 0);
  return mergeGeometries([body, glacis, deck]) || body;
}

/**
 * A track run, with road wheels in it.
 *
 * The wheels are baked into the track rather than instanced on their own: a
 * tank has six or seven of them a side and there can be a hundred tanks, and
 * fourteen hundred more instances to draw is a real cost for something that is
 * three pixels across most of the time. Baked, they are free - the same one
 * draw call the bare track already was.
 */
function trackGeometry() {
  const parts = [];
  const run = new THREE.BoxGeometry(1, 1, 1);
  run.translate(0, 0.5, 0);
  parts.push(run);
  for (let i = 0; i < 6; i++) {
    const w = new THREE.CylinderGeometry(0.46, 0.46, 1.25, 7);
    w.rotateX(Math.PI / 2);
    w.rotateY(Math.PI / 2);
    w.translate(-0.42 + (i / 5) * 0.84, 0.42, 0);
    parts.push(w);
  }
  // drive sprocket at the back, idler at the front, both bigger than the road
  // wheels - the thing that makes a run of wheels read as a track
  for (const [x, r] of [[-0.5, 0.6], [0.5, 0.56]]) {
    const d = new THREE.CylinderGeometry(r, r, 1.3, 8);
    d.rotateX(Math.PI / 2);
    d.rotateY(Math.PI / 2);
    d.translate(x, 0.5, 0);
    parts.push(d);
  }
  return mergeGeometries(parts) || run;
}

/** A turret with a bustle behind it and a mantlet where the gun comes out. */
function turretGeometry() {
  const t = slabGeometry(0.34, 0.5);
  const bustle = new THREE.BoxGeometry(0.42, 0.5, 0.8);
  bustle.translate(-0.42, 0.36, 0);
  const mantlet = new THREE.CylinderGeometry(0.34, 0.34, 0.36, 7);
  mantlet.rotateZ(Math.PI / 2);
  mantlet.translate(0.44, 0.42, 0);
  const hatch = new THREE.CylinderGeometry(0.2, 0.22, 0.16, 7);
  hatch.translate(-0.1, 0.98, 0.12);
  return mergeGeometries([t, bustle, mantlet, hatch]) || t;
}

export function buildUnits(scene) {
  const men = instanced(bodyGeometry(), MAX_MEN, scene);
  const helms = instanced(helmetGeometry(), MAX_MEN, scene);
  const legL = instanced(legGeometry(), MAX_MEN, scene);
  const legR = instanced(legGeometry(), MAX_MEN, scene);
  const rifles = instanced(rifleGeometry(), MAX_MEN, scene, { color: 0x2c2620 });

  const hulls = instanced(hullGeometry(), MAX_VEH, scene);
  const turrets = instanced(turretGeometry(), MAX_VEH, scene);

  // Tracks: two dark runs down the sides with the road wheels in them, which is
  // most of what makes a shape read as tracked rather than as a box on wheels.
  const trackGeo = trackGeometry();
  const tracksL = instanced(trackGeo, MAX_VEH, scene, { color: 0x2a2a26 });
  const tracksR = instanced(trackGeo, MAX_VEH, scene, { color: 0x2a2a26 });

  // The barrel points down +X before it is turned, so the traverse the
  // simulation already tracks is the rotation applied here.
  const tube = new THREE.CylinderGeometry(0.4, 0.5, 1, 7);
  tube.rotateZ(Math.PI / 2);
  tube.translate(0.5, 0, 0);
  // A muzzle brake. It is two hundred triangles and it is the difference
  // between a gun and a length of pipe.
  const brake = new THREE.CylinderGeometry(0.72, 0.72, 0.16, 7);
  brake.rotateZ(Math.PI / 2);
  brake.translate(0.94, 0, 0);
  const barrelGeo = mergeGeometries([tube, brake]) || tube;
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

  // The dead. The map has always laid a man down where he fell and left a
  // burnt-out hull where a tank brewed up; in three dimensions they simply
  // vanished, which made a firefight look like men walking off it. Same list,
  // same positions, same handful of seconds — they are the engine's, not this
  // renderer's invention.
  const fallen = instanced(bodyGeometry(), MAX_DOWN, scene);
  const fallenHelms = instanced(helmetGeometry(), MAX_DOWN, scene);
  const wrecks = instanced(slabGeometry(0.42, 0.5), MAX_DOWN, scene, { color: 0x24211b });

  const all = [
    men, helms, legL, legR, rifles,
    hulls, turrets, tracksL, tracksR, barrels, marks, rotors, rings, shots,
    fallen, fallenHelms, wrecks,
  ];

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
        // The walk, off the simulation's own phase.
        //
        // `step` has been advanced by every pace every man has taken since the
        // battle started — it is saved with the match and it is what the flat
        // map has always bobbed its men on. The 3D field ignored it entirely
        // and slid everyone about like counters on a board. A stride, a lift
        // onto the ball of the foot, a lean into the march and a flinch when he
        // fires are all already known; none of it is invented here.
        const stride = Math.sin(s.step);
        const rise = Math.abs(Math.cos(s.step));
        const going = s.moved ? 1 : 0;
        // Never quite still: a man standing is still breathing, and a rank of
        // perfectly rigid figures is the thing that reads as models on a table.
        const breathe = Math.sin(v.clock * 2.1 + s.v * 3) * 0.16;
        const bob = (going ? rise * 1.5 : breathe) * far;
        const kick = Math.max(0, s.kick || 0);
        const cs = Math.cos(s.ang);
        const sn = Math.sin(s.ang);
        // He rocks back on the shot, and no two men stand quite square.
        const bx = s.x - cs * kick * 1.6;
        const by = s.y - sn * kick * 1.6;
        const face = -(s.ang + s.v * 0.05);
        const lean = going ? -0.12 : breathe * 0.1; // into the march

        put(men, nm, bx, gy + bob, by, face, far, far, far, lean);
        paint(men, nm, skin.cloth);
        put(helms, nm, bx, gy + bob, by, face, far, far, far, lean);
        paint(helms, nm, skin.mark);
        put(rifles, nm, bx, gy + bob, by, face, far, far, far, lean - kick * 0.35);

        // The legs swing about the hip, a half-pace out of step with each
        // other. Standing still they hang.
        const swing = going ? stride * 0.62 : 0;
        const hipY = gy + bob + HIP * far;
        const off = 0.55 * MAN * far;
        put(legL, nm, bx + sn * off, hipY, by - cs * off, face, far, far, far, swing);
        paint(legL, nm, skin.cloth);
        put(legR, nm, bx - sn * off, hipY, by + cs * off, face, far, far, far, -swing);
        paint(legR, nm, skin.cloth);
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
        if (b.veh) {
          if (nw >= MAX_DOWN) continue;
          const gy = groundY(t, b.x, b.y);
          const settle = 1 - k * 0.3;
          put(wrecks, nw, b.x, gy, b.y, -(b.a + b.spin * k), 30 * gone, 8 * settle * gone, 17 * gone);
          nw++;
          continue;
        }
        if (nd >= MAX_DOWN) continue;
        const gy = groundY(t, b.x, b.y);
        // Tipping: upright at the instant he is hit, flat a third of a second
        // later, and the spin the map gives him carries his bearing round.
        const tip = Math.min(1, k * 3.2) * 1.45;
        const s = far * gone;
        put(fallen, nd, b.x, gy, b.y, -(b.a + b.spin * k), s, s, s, tip);
        paint(fallen, nd, DEAD);
        put(fallenHelms, nd, b.x, gy, b.y, -(b.a + b.spin * k), s, s, s, tip);
        paint(fallenHelms, nd, (SKIN[b.team] || SKIN.blue).mark);
        nd++;
      }
      fallen.count = nd;
      fallenHelms.count = nd;
      wrecks.count = nw;

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
      legL.count = nm;
      legR.count = nm;
      rifles.count = nm;
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
