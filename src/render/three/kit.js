// What the armies are SHAPED like.
//
// Everything the two nations put on the field is built here, in code, at its
// real size in world units — a tank is thirty-four units long because that is
// what the simulation thinks a tank is, and the mesh is that long rather than
// being a unit cube stretched to fit at draw time. That matters for more than
// tidiness: a cube stretched 34 × 10 × 19 has a normal map smeared three times
// harder down one axis than another, and every panel on it reads as though it
// were made of different stuff depending on which way it faces.
//
// WHY THIS IS ITS OWN FILE. The placement code — where each man stands this
// frame, which way his turret points — is a different job from what a tank
// looks like, and mixing them produced eight hundred lines nobody could hold in
// their head. units.js decides where. This decides what.
//
// The rule the shapes are drawn to: a military vehicle is recognised by its
// SILHOUETTE at a distance and by its CLUTTER close up. The silhouette is the
// sloped glacis, the track guards, the turret bustle, the length of the gun.
// The clutter is the stowage bins, the tow cable, the exhaust, the aerial and
// the smoke dischargers — none of which changes the outline at all, and all of
// which is the difference between armour and a box with a pipe in it.
//
// ONE RULE FOR PIVOTS. Every part below is built about its own origin FIRST,
// turned second, and carried into place LAST. Translating a part and then
// rotating it swings it round the middle of the vehicle instead of round
// itself, which is how a tank ends up with its exhaust inside the turret.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const merge = (parts, fallback) => mergeGeometries(parts) || fallback || parts[0];

/** Carry a part into place. Always the last thing done to it. */
const at = (g, x, y, z) => {
  g.translate(x || 0, y || 0, z || 0);
  return g;
};

/** Turn a part about its own origin. Always before `at`. */
const turn = (g, rz, rx, ry) => {
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return g;
};

/** A box centred on the origin. */
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** A box placed straight away, for the many that are not turned. */
const boxAt = (w, h, d, x, y, z) => at(box(w, h, d), x, y, z);

/**
 * A tapered slab, standing on y = 0, centred in x and z: a four-sided cylinder,
 * which is a box whose top and bottom differ. This is what makes plate read as
 * SLOPED — the most important single thing about the outline of an armoured
 * vehicle, and the reason a tank does not look like a shipping container.
 *
 * @param topW width across at the top, @param botW at the bottom
 */
function slab(topW, botW, h, len) {
  const g = new THREE.CylinderGeometry(0.7071, 0.7071, 1, 4);
  g.rotateY(Math.PI / 4); // corners onto the axes: now a unit square in x and z
  g.scale(1, h, 1);
  g.translate(0, h / 2, 0); // stand it on the ground
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = h > 0 ? p.getY(i) / h : 0; // 0 at the bottom, 1 at the top
    p.setX(i, p.getX(i) * len);
    p.setZ(i, p.getZ(i) * (botW + (topW - botW) * t));
  }
  g.computeVertexNormals();
  return g;
}

/** A cylinder lying along +X, centred: every gun tube, axle, roller and pipe. */
const tube = (rTop, rBot, len, seg) =>
  turn(new THREE.CylinderGeometry(rTop, rBot, len, seg || 8), Math.PI / 2);

/** A wheel or road wheel: a cylinder lying across the vehicle, along Z. */
const wheel = (r, width, seg) =>
  turn(new THREE.CylinderGeometry(r, r, width, seg || 10), 0, Math.PI / 2);

// ————————————————————————————————————————————————————————————————
// A MAN
// ————————————————————————————————————————————————————————————————

// A man, built bigger than life on purpose: a rifleman is two paces across and
// the map is five kilometres wide, so drawn true to size he is one pixel at the
// zoom this game is played at. Legible beats accurate — the flat renderer makes
// exactly the same bargain with its icons.
export const MAN = 2.3;

// Where the hip is. Everything above it rides on the walk and everything below
// it does the walking.
export const HIP = 3.6 * MAN;

/**
 * The torso, from the hip up: coat, arms, and the kit that hangs off both.
 *
 * WEBBING is what was missing. A soldier is not a man in a coat; he is a man
 * with about fifteen kilograms strapped to him, and the straps are what the eye
 * uses to tell one from the other at any distance where the face is gone. Two
 * shoulder straps, a belt and pouches on the belt cost sixty triangles and do
 * more for the silhouette than doubling the resolution of everything else.
 */
export function bodyGeometry() {
  const parts = [];
  // The coat, narrowing to the waist and out again at the shoulder.
  parts.push(at(new THREE.CylinderGeometry(1.16 * MAN, 0.94 * MAN, 3.2 * MAN, 8), 0, 5.1 * MAN, 0));
  // Shoulders, which a plain cylinder does not have: a man's deltoids stand
  // proud of his chest and are the widest point on him.
  parts.push(at(new THREE.CylinderGeometry(1.22 * MAN, 1.12 * MAN, 0.6 * MAN, 8), 0, 6.5 * MAN, 0));
  parts.push(at(new THREE.CylinderGeometry(0.46 * MAN, 0.58 * MAN, 0.7 * MAN, 6), 0, 6.95 * MAN, 0));
  const head = new THREE.SphereGeometry(0.74 * MAN, 8, 6);
  head.scale(0.94, 1.06, 1);
  parts.push(at(head, 0, 7.36 * MAN, 0));

  // ARMS, brought forward onto the weapon. A shape with a head, a body and legs
  // and no arms is a chess piece; it is the arms coming onto the rifle that
  // make the silhouette read as a man carrying one.
  for (const side of [-1, 1]) {
    const up = new THREE.CylinderGeometry(0.3 * MAN, 0.27 * MAN, 1.6 * MAN, 6);
    parts.push(at(turn(up, side * -0.26), side * 1.34 * MAN, 5.7 * MAN, 0));
    const fore = new THREE.CylinderGeometry(0.26 * MAN, 0.23 * MAN, 1.5 * MAN, 6);
    parts.push(at(turn(fore, 0, -Math.PI / 2, side * 0.42), side * 1.16 * MAN, 5.15 * MAN, 0.86 * MAN));
    // the fist on the weapon, which closes the shape between arm and rifle
    parts.push(at(new THREE.SphereGeometry(0.3 * MAN, 5, 4), side * 1.0 * MAN, 5.15 * MAN, 1.5 * MAN));
  }

  // WEBBING. Two straps over the shoulders, crossing the chest, and a belt.
  for (const side of [-1, 1]) {
    const strap = turn(box(0.34 * MAN, 3.1 * MAN, 0.16 * MAN), side * 0.16);
    parts.push(at(strap, side * 0.55 * MAN, 5.4 * MAN, 1.06 * MAN));
  }
  parts.push(at(new THREE.CylinderGeometry(1.12 * MAN, 1.1 * MAN, 0.4 * MAN, 8), 0, 4.1 * MAN, 0));
  // ammunition pouches, front and hips
  parts.push(boxAt(0.7 * MAN, 0.7 * MAN, 0.4 * MAN, -0.55 * MAN, 4.25 * MAN, 1.0 * MAN));
  parts.push(boxAt(0.7 * MAN, 0.7 * MAN, 0.4 * MAN, 0.55 * MAN, 4.25 * MAN, 1.0 * MAN));
  parts.push(boxAt(0.5 * MAN, 0.8 * MAN, 0.5 * MAN, 1.1 * MAN, 4.2 * MAN, -0.4 * MAN));

  // The pack, and a blanket roll over it. Kit is what separates a soldier from
  // a man in a coat.
  parts.push(boxAt(1.5 * MAN, 1.7 * MAN, 0.8 * MAN, 0, 5.5 * MAN, -1.2 * MAN));
  const roll = new THREE.CylinderGeometry(0.26 * MAN, 0.26 * MAN, 1.55 * MAN, 6);
  parts.push(at(turn(roll, Math.PI / 2), 0, 6.45 * MAN, -1.2 * MAN));
  // a canteen and an entrenching tool on the pack: the two things every man
  // carries, and the two that break up a flat back
  parts.push(at(new THREE.CylinderGeometry(0.3 * MAN, 0.3 * MAN, 0.6 * MAN, 6), 0.8 * MAN, 4.9 * MAN, -1.3 * MAN));
  parts.push(boxAt(0.36 * MAN, 1.3 * MAN, 0.14 * MAN, -0.8 * MAN, 5.0 * MAN, -1.62 * MAN));

  return merge(parts);
}

/**
 * One leg, hanging from the origin.
 *
 * Built downward from nothing so the instance can be placed AT the hip and
 * swung about it: rotate a leg whose origin is at its foot and it scythes
 * through the ground.
 */
export function legGeometry() {
  const parts = [];
  parts.push(at(new THREE.CylinderGeometry(0.44 * MAN, 0.34 * MAN, HIP * 0.55, 6), 0, -HIP * 0.275, 0));
  parts.push(at(new THREE.CylinderGeometry(0.34 * MAN, 0.26 * MAN, HIP * 0.5, 6), 0, -HIP * 0.75, 0));
  // The boot: a sole longer than the leg is wide, turned forward. It is what
  // reads as a boot.
  parts.push(boxAt(0.95 * MAN, 0.34 * MAN, 0.44 * MAN, 0.18 * MAN, -HIP + 0.17 * MAN, 0));
  // and the gaiter above it
  parts.push(at(new THREE.CylinderGeometry(0.34 * MAN, 0.4 * MAN, 0.5 * MAN, 6), 0, -HIP + 0.55 * MAN, 0));
  return merge(parts);
}

/** A helmet: the one part painted in a nation's colour, so you can tell whose. */
export function helmetGeometry() {
  const dome = new THREE.SphereGeometry(1.0 * MAN, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
  dome.scale(1, 0.92, 1.04);
  const parts = [at(dome, 0, 7.3 * MAN, 0)];
  // The brim, flared. It is what makes a dome read as a helmet rather than as
  // a bald head.
  parts.push(at(new THREE.CylinderGeometry(1.06 * MAN, 1.24 * MAN, 0.2 * MAN, 10), 0, 7.24 * MAN, 0.04 * MAN));
  // a chin strap, so the helmet is not a bowl balanced on him
  parts.push(boxAt(1.9 * MAN, 0.12 * MAN, 0.12 * MAN, 0, 6.86 * MAN, 0.5 * MAN));
  return merge(parts);
}

// ————————————————————————————————————————————————————————————————
// WHAT HE IS CARRYING
//
// Four weapons, because four roles on this field fight in visibly different
// ways and drawing them all with one stick throws away free information. A
// player who can tell a machine-gun team from a rifle section by looking at
// them is reading the battle rather than reading the labels.
// ————————————————————————————————————————————————————————————————

/** A service rifle, carried across the body at the ready. */
export function rifleGeometry() {
  const parts = [];
  // the receiver and barrel, as one run
  parts.push(boxAt(3.0 * MAN, 0.24 * MAN, 0.2 * MAN, 0.9 * MAN, 5.5 * MAN, 0.9 * MAN));
  // the stock, dropping away behind the grip — the line that says "rifle"
  parts.push(at(turn(box(1.1 * MAN, 0.42 * MAN, 0.22 * MAN), 0.12), -0.35 * MAN, 5.34 * MAN, 0.9 * MAN));
  // the magazine, the one detail that survives being three pixels tall
  parts.push(boxAt(0.3 * MAN, 0.55 * MAN, 0.18 * MAN, 0.7 * MAN, 5.2 * MAN, 0.9 * MAN));
  // foresight, and a sling slung under the barrel
  parts.push(boxAt(0.1 * MAN, 0.3 * MAN, 0.1 * MAN, 2.2 * MAN, 5.7 * MAN, 0.9 * MAN));
  parts.push(boxAt(1.8 * MAN, 0.08 * MAN, 0.08 * MAN, 0.9 * MAN, 5.15 * MAN, 0.9 * MAN));
  return merge(parts);
}

/** A sniper's rifle: longer, with a telescope on it and a bipod under it. */
export function sniperGeometry() {
  const parts = [];
  parts.push(boxAt(4.0 * MAN, 0.24 * MAN, 0.2 * MAN, 1.3 * MAN, 5.5 * MAN, 0.9 * MAN));
  parts.push(at(turn(box(1.4 * MAN, 0.46 * MAN, 0.24 * MAN), 0.14), -0.5 * MAN, 5.32 * MAN, 0.9 * MAN));
  // the telescope, sitting proud above the receiver on two rings
  parts.push(at(tube(0.16 * MAN, 0.16 * MAN, 1.3 * MAN, 7), 0.75 * MAN, 5.85 * MAN, 0.9 * MAN));
  parts.push(boxAt(0.1 * MAN, 0.3 * MAN, 0.1 * MAN, 0.3 * MAN, 5.68 * MAN, 0.9 * MAN));
  parts.push(boxAt(0.1 * MAN, 0.3 * MAN, 0.1 * MAN, 1.2 * MAN, 5.68 * MAN, 0.9 * MAN));
  // bipod legs, splayed
  for (const s of [-1, 1]) {
    const leg = turn(box(0.1 * MAN, 1.0 * MAN, 0.1 * MAN), 0, -s * 0.3);
    parts.push(at(leg, 2.6 * MAN, 5.05 * MAN, 0.9 * MAN + s * 0.2 * MAN));
  }
  return merge(parts);
}

/** A belt-fed machine gun on a bipod, with the box hanging under the feed. */
export function mgGeometry() {
  const parts = [];
  parts.push(boxAt(3.4 * MAN, 0.3 * MAN, 0.26 * MAN, 1.0 * MAN, 5.45 * MAN, 0.9 * MAN));
  // a heavy barrel with a jacket on it
  parts.push(at(tube(0.16 * MAN, 0.18 * MAN, 2.0 * MAN, 7), 2.0 * MAN, 5.55 * MAN, 0.9 * MAN));
  // the ammunition box under the receiver: the thing that says belt-fed
  parts.push(boxAt(0.8 * MAN, 0.7 * MAN, 0.7 * MAN, 0.55 * MAN, 5.0 * MAN, 0.9 * MAN));
  // carrying handle, and the bipod
  parts.push(boxAt(0.7 * MAN, 0.1 * MAN, 0.1 * MAN, 1.5 * MAN, 5.68 * MAN, 0.9 * MAN));
  for (const s of [-1, 1]) {
    const leg = turn(box(0.12 * MAN, 1.3 * MAN, 0.12 * MAN), 0, -s * 0.34);
    parts.push(at(leg, 2.5 * MAN, 4.9 * MAN, 0.9 * MAN + s * 0.3 * MAN));
  }
  return merge(parts);
}

/** A shoulder-launched anti-tank tube, with a warhead on the front of it. */
export function launcherGeometry() {
  const parts = [];
  // the tube, up on the shoulder rather than across the chest
  parts.push(at(tube(0.32 * MAN, 0.34 * MAN, 3.6 * MAN, 9), 0.9 * MAN, 6.15 * MAN, 0.75 * MAN));
  // the venturi flaring out behind, which is most of the recognition
  parts.push(at(tube(0.52 * MAN, 0.3 * MAN, 0.7 * MAN, 9), -1.1 * MAN, 6.15 * MAN, 0.75 * MAN));
  // the warhead, fatter than the tube, standing proud of the muzzle
  const head = new THREE.SphereGeometry(0.42 * MAN, 8, 6);
  head.scale(1.9, 1, 1);
  parts.push(at(head, 2.9 * MAN, 6.15 * MAN, 0.75 * MAN));
  // pistol grip and sight
  parts.push(boxAt(0.22 * MAN, 0.6 * MAN, 0.18 * MAN, 0.5 * MAN, 5.75 * MAN, 0.75 * MAN));
  parts.push(boxAt(0.3 * MAN, 0.44 * MAN, 0.12 * MAN, 0.3 * MAN, 6.6 * MAN, 0.55 * MAN));
  return merge(parts);
}

// ————————————————————————————————————————————————————————————————
// ARMOUR
//
// Everything below is drawn at its true size in world units, y = 0 on the
// ground, +X forward, +Z out to one side. units.js places each with a single
// UNIFORM scale, so the proportions written here are the proportions on screen.
// ————————————————————————————————————————————————————————————————

export const TANK_L = 34;

/**
 * The hull of a main battle tank.
 *
 * Reading front to back: a steeply sloped glacis, a driver's hatch let into it,
 * the fighting compartment, a raised engine deck with louvres over it, and the
 * exhaust at the back. Over the tracks run the FENDERS, which do more work than
 * anything else here — a tank without them has its tracks hanging in space and
 * reads as a toy, and with them the hull has a waistline.
 */
export function tankHullGeometry() {
  const parts = [];
  const y = 2.6; // the belly, clear of the ground
  const h = 4.6;
  parts.push(at(slab(13.4, 14.4, h, TANK_L * 0.86), -0.6, y, 0));
  // the glacis: one big plate at a shallow angle, the front of every tank
  parts.push(at(turn(slab(9.5, 13.6, 5.6, 9.5), -0.62), TANK_L * 0.36, y + 0.4, 0));
  parts.push(at(slab(13.6, 12.0, 2.8, 4.0), TANK_L * 0.42, y * 0.1, 0)); // lower front plate
  // driver's hatch and vision block, let into the glacis
  parts.push(boxAt(3.0, 0.5, 3.0, TANK_L * 0.3, y + 3.6, 2.6));
  parts.push(boxAt(1.6, 0.7, 2.4, TANK_L * 0.34, y + 3.9, 2.6));
  // engine deck, raised, with louvres across it
  parts.push(boxAt(TANK_L * 0.3, 1.2, 12.6, -TANK_L * 0.3, y + h, 0));
  for (let i = 0; i < 4; i++) {
    parts.push(boxAt(0.7, 0.5, 11.6, -TANK_L * 0.38 + i * 2.4, y + h + 0.9, 0));
  }
  for (const s of [-1, 1]) {
    // FENDERS over each track, with a mudflap fore and aft
    parts.push(boxAt(TANK_L * 0.94, 0.5, 3.4, -0.4, y + h - 0.3, s * 8.0));
    parts.push(boxAt(0.6, 2.2, 3.2, TANK_L * 0.46, y + h - 1.4, s * 8.0));
    parts.push(boxAt(0.6, 2.6, 3.2, -TANK_L * 0.47, y + h - 1.6, s * 8.0));
    // stowage bins along the fender: the clutter that says a crew lives here
    parts.push(boxAt(7.0, 2.2, 2.6, -3.0, y + h + 1.0, s * 8.0));
    parts.push(boxAt(4.0, 1.8, 2.4, 5.5, y + h + 0.8, s * 8.0));
    // exhaust, out of the back of the engine deck
    parts.push(at(tube(0.8, 0.9, 3.0, 7), -TANK_L * 0.5, y + h + 0.4, s * 3.4));
    // a tow cable running down the hull side
    parts.push(boxAt(16.0, 0.4, 0.4, -2.0, y + 3.2, s * 7.3));
    parts.push(boxAt(1.6, 1.0, 1.0, TANK_L * 0.5, y + 0.8, s * 3.0)); // towing eyes
  }
  // a spare track link bolted to the glacis, which every crew does
  parts.push(boxAt(0.6, 2.6, 8.0, TANK_L * 0.36, y + 2.2, 0));
  return merge(parts);
}

/**
 * The turret: cast and rounded, with a bustle behind for the ammunition, a
 * mantlet where the gun comes through, a commander's cupola with a machine gun
 * on it, smoke dischargers on the cheeks and a whip aerial.
 *
 * Its origin is the turret RING, so units.js can traverse it about the point a
 * turret actually turns about rather than about the middle of the tank.
 */
export function tankTurretGeometry() {
  const parts = [];
  parts.push(at(slab(9.0, 12.4, 4.4, 14.0), -0.5, 0, 0));
  parts.push(boxAt(6.4, 3.6, 10.0, -8.0, 2.1, 0)); // the bustle, overhanging the deck
  parts.push(boxAt(4.0, 2.0, 8.6, -11.0, 1.6, 0)); // stowage rack on the back of it
  parts.push(at(tube(2.6, 2.6, 3.2, 10), 6.6, 2.2, 0)); // the mantlet
  parts.push(at(slab(6.0, 8.0, 3.0, 4.0), 5.4, 0.9, 0)); // the cheeks either side of it
  // commander's cupola, offset to one side as it always is
  parts.push(at(new THREE.CylinderGeometry(2.1, 2.3, 1.8, 10), -2.6, 5.0, 2.4));
  parts.push(at(new THREE.CylinderGeometry(2.0, 2.0, 0.4, 10), -2.6, 6.0, 2.4));
  parts.push(at(new THREE.CylinderGeometry(1.5, 1.6, 0.5, 8), -2.2, 4.6, -3.0)); // loader's hatch
  // a machine gun on the cupola
  parts.push(at(tube(0.3, 0.3, 4.4, 6), -1.0, 6.6, 2.4));
  parts.push(boxAt(1.4, 0.8, 0.7, -3.0, 6.5, 2.4));
  // smoke dischargers, four a side, angled up and out
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      parts.push(at(turn(tube(0.55, 0.55, 1.8, 6), 0.5), 2.0 + i * 1.5, 3.4, s * 5.6));
    }
  }
  // the aerial. Two triangles, and it is the thing that says "this is crewed".
  parts.push(boxAt(0.24, 11.0, 0.24, -7.0, 8.5, 4.2));
  return merge(parts);
}

/**
 * A track run: the pads, the road wheels inside them, the drive sprocket at the
 * back, the idler at the front and return rollers along the top.
 *
 * All baked into one mesh rather than instanced separately — a tank has seven
 * road wheels a side and there can be a hundred tanks, and fourteen hundred
 * extra instances is a real cost for something three pixels across most of the
 * time. Baked, they are free.
 */
export function trackGeometry() {
  const parts = [];
  const L = TANK_L * 0.92;
  const w = 3.0;
  // the run: a bottom, a top and a nose at each end, so the outline is the
  // flattened oval a track actually makes rather than a plain box
  parts.push(boxAt(L, 1.5, w, 0, 0.8, 0));
  parts.push(boxAt(L * 0.82, 1.2, w, 0, 6.4, 0));
  for (let i = 0; i < 7; i++) {
    parts.push(at(wheel(2.7, w * 1.05, 9), -L * 0.4 + (i * L * 0.8) / 6, 2.9, 0));
  }
  parts.push(at(wheel(3.6, w * 1.05, 10), -L * 0.5, 4.6, 0)); // drive sprocket, high at the rear
  parts.push(at(wheel(3.2, w * 1.05, 10), L * 0.5, 4.0, 0)); // idler at the front
  for (let i = 0; i < 3; i++) {
    parts.push(at(wheel(1.1, w * 0.8, 7), -L * 0.24 + i * L * 0.24, 6.5, 0));
  }
  // the sloped run from the idler up to the first return roller
  parts.push(at(turn(box(L * 0.22, 1.2, w), -0.22), L * 0.34, 5.6, 0));
  return merge(parts);
}

/**
 * A wheeled APC: a sloped welded box on eight wheels with a small turret.
 *
 * Deliberately nothing like the tank. An APC that is a tank with a shorter gun
 * tells the player nothing; one with WHEELS, a flat roof, a boat-shaped nose
 * and firing ports reads as a personnel carrier from across the map — and the
 * whole point of a distinct silhouette is that it is read and not inspected.
 */
export function apcHullGeometry() {
  const parts = [];
  const L = 30;
  const y = 3.4;
  parts.push(at(slab(11.0, 13.2, 5.6, L * 0.84), -1.0, y, 0));
  // a nose that slopes up out of the water line the way a swimming carrier's does
  parts.push(at(turn(slab(8.0, 12.6, 5.4, 7.0), -0.5), L * 0.38, y, 0));
  parts.push(at(slab(12.6, 10.0, 3.4, 6.0), L * 0.42, y * 0.1, 0));
  // roof, hatches, and a ramp across the back
  parts.push(boxAt(L * 0.7, 0.6, 11.4, -2.0, y + 5.6, 0));
  parts.push(boxAt(4.0, 0.6, 4.0, -6.0, y + 6.0, 3.0));
  parts.push(boxAt(0.8, 5.4, 11.0, -L * 0.47, y + 2.8, 0));
  for (const s of [-1, 1]) {
    // firing ports and vision blocks down each side
    for (let i = 0; i < 3; i++) {
      parts.push(boxAt(1.6, 1.4, 0.5, -6.0 + i * 4.5, y + 3.6, s * 6.3));
    }
    parts.push(boxAt(L * 0.72, 1.2, 0.6, -2.0, y + 0.6, s * 6.4)); // side skirt
    parts.push(boxAt(6.0, 1.8, 2.0, -8.0, y + 5.2, s * 6.6)); // stowage rail
    parts.push(boxAt(1.0, 1.4, 1.4, L * 0.42, y + 4.4, s * 4.6)); // headlamp guards
  }
  return merge(parts);
}

/** The wheels down one side — four of them, hub and tyre. */
export function apcWheelsGeometry() {
  const parts = [];
  const L = 30;
  for (let i = 0; i < 4; i++) {
    const x = -L * 0.36 + (i * L * 0.72) / 3;
    parts.push(at(wheel(3.6, 2.6, 12), x, 3.6, 0));
    parts.push(at(wheel(1.6, 3.0, 8), x, 3.6, 0)); // the hub, proud of the tyre
  }
  return merge(parts);
}

/** The APC's turret: a small welded cupola with an autocannon in it. */
export function apcTurretGeometry() {
  const parts = [];
  parts.push(at(slab(4.4, 5.8, 3.0, 5.0), -0.4, 0, 0));
  parts.push(at(tube(1.0, 1.0, 1.6, 8), 2.2, 1.5, 0)); // mantlet
  parts.push(at(new THREE.CylinderGeometry(1.7, 1.7, 0.4, 8), -0.8, 3.2, 0));
  parts.push(boxAt(0.2, 6.0, 0.2, -2.4, 4.6, 1.8)); // aerial
  return merge(parts);
}

/**
 * A self-propelled gun: a tracked chassis with a big open-backed casemate and a
 * long tube in it. Howitzers and rocket batteries share the chassis, which is
 * both what real armies do and what keeps this file finite.
 */
export function spgHullGeometry() {
  const parts = [];
  const L = 32;
  const y = 2.4;
  parts.push(at(slab(12.4, 13.6, 4.2, L * 0.86), -0.5, y, 0));
  parts.push(at(turn(slab(9.0, 13.0, 4.6, 8.0), -0.7), L * 0.34, y + 0.3, 0));
  // the fighting compartment: tall, square, right at the back
  parts.push(at(slab(9.6, 12.0, 7.0, L * 0.5), -L * 0.2, y + 4.2, 0));
  parts.push(boxAt(L * 0.5, 0.6, 10.0, -L * 0.2, y + 11.4, 0));
  for (const s of [-1, 1]) {
    // the spades a gun drops to take its recoil — the reason this reads as
    // artillery rather than as a turretless tank
    parts.push(at(turn(box(4.0, 4.4, 1.6), 0.5), -L * 0.5, y + 0.8, s * 4.0));
    parts.push(boxAt(L * 0.9, 0.5, 3.2, -0.4, y + 4.0, s * 7.6));
    parts.push(boxAt(6.0, 2.0, 2.4, -2.0, y + 5.2, s * 7.6));
  }
  return merge(parts);
}

/** The gun mount on the casemate roof, origin at its trunnion. */
export function spgMountGeometry() {
  const parts = [];
  parts.push(at(slab(5.0, 7.0, 4.0, 7.0), -1.0, 0, 0));
  parts.push(at(tube(1.8, 1.8, 3.6, 10), 2.4, 2.0, 0)); // the trunnion cradle
  // recuperator cylinders over the tube: the mark of a howitzer
  parts.push(at(tube(0.8, 0.8, 6.0, 7), 4.5, 3.4, 1.2));
  parts.push(at(tube(0.8, 0.8, 6.0, 7), 4.5, 3.4, -1.2));
  return merge(parts);
}

/** A pack of rocket tubes, for the battery. */
export function rocketPackGeometry() {
  const parts = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      parts.push(at(tube(0.95, 0.95, 13.0, 7), 0, 1.2 + r * 2.1, -4.2 + c * 2.1));
    }
  }
  parts.push(boxAt(1.2, 5.6, 12.0, -6.2, 2.0, 0)); // the frame the pack rides in
  parts.push(boxAt(1.2, 5.6, 12.0, 6.2, 2.0, 0));
  return merge(parts);
}

/**
 * A mortar: a tube on a bipod over a baseplate. Crew-served, so it is small,
 * and it stands steeply because that is the whole point of a mortar.
 */
export function mortarGeometry() {
  const parts = [];
  const t = new THREE.CylinderGeometry(0.9, 1.1, 13.0, 9);
  parts.push(at(turn(t, -0.95), 2.0, 7.0, 0)); // muzzle up and forward
  parts.push(at(new THREE.CylinderGeometry(4.2, 4.6, 0.7, 9), -1.6, 0.4, 0));
  for (const s of [-1, 1]) {
    parts.push(at(turn(box(0.5, 9.0, 0.5), 0.32, -s * 0.22), 4.0, 4.5, s * 2.4));
  }
  parts.push(boxAt(3.4, 0.5, 5.4, 4.6, 8.2, 0)); // the traverse gear across the legs
  return merge(parts);
}

/**
 * A gunship: a fuselage with a stepped canopy, a tail boom, a fin with a tail
 * rotor on it, stub wings hung with rocket pods, and skids.
 *
 * What was there was the tank hull scaled flat with a gun barrel borrowed for a
 * tail, which from every angle read as a flying brick.
 */
export function heliBodyGeometry() {
  const parts = [];
  // fuselage: deepest under the rotor mast, tapering back to the tail
  const f = new THREE.SphereGeometry(1, 12, 8);
  f.scale(15.0, 5.2, 4.6);
  parts.push(f);
  // the stepped canopy — gunner low and forward, pilot up and behind
  const c1 = new THREE.SphereGeometry(1, 10, 7);
  c1.scale(4.6, 2.6, 3.2);
  parts.push(at(c1, 10.0, 0.6, 0));
  const c2 = new THREE.SphereGeometry(1, 10, 7);
  c2.scale(4.4, 3.0, 3.4);
  parts.push(at(c2, 4.4, 2.4, 0));
  // engine deck and rotor mast
  parts.push(boxAt(9.0, 3.0, 6.4, -2.0, 3.6, 0));
  parts.push(at(new THREE.CylinderGeometry(0.7, 0.9, 3.0, 8), -2.0, 6.6, 0));
  // tail boom, fin and tailplane
  parts.push(at(tube(0.9, 2.4, 20.0, 8), -22.0, 1.6, 0));
  parts.push(at(turn(box(5.0, 8.0, 0.7), 0.2), -31.0, 4.0, 0));
  parts.push(boxAt(7.0, 0.6, 6.0, -29.0, 2.4, 0));
  for (const s of [-1, 1]) {
    // stub wings, and a rocket pod slung under each
    parts.push(boxAt(5.0, 0.8, 7.0, 0.5, 0.6, s * 7.5));
    parts.push(at(tube(1.6, 1.6, 7.0, 9), 1.0, -1.2, s * 9.5));
    parts.push(boxAt(1.2, 2.0, 1.2, 0.5, -0.4, s * 9.5));
    // skids
    parts.push(at(tube(0.5, 0.5, 16.0, 6), 0, -6.4, s * 5.0));
    parts.push(boxAt(0.6, 4.0, 0.6, 5.0, -4.6, s * 5.0));
    parts.push(boxAt(0.6, 4.0, 0.6, -5.0, -4.6, s * 5.0));
  }
  // a chin turret under the nose
  parts.push(at(new THREE.SphereGeometry(2.0, 8, 6), 11.0, -3.0, 0));
  parts.push(at(tube(0.4, 0.4, 5.0, 6), 14.0, -3.2, 0));
  return merge(parts);
}

/**
 * The main rotor: four blades and a hub, turning about the mast.
 *
 * A blade is built centred, turned about the hub, and then pushed out along its
 * own new direction — which is what makes four blades rather than four planks
 * crossed through the middle.
 */
export function rotorGeometry() {
  const parts = [new THREE.CylinderGeometry(1.4, 1.4, 1.0, 8)];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    parts.push(at(turn(box(30.0, 0.35, 2.4), 0, 0, a), Math.cos(a) * 15, 0, -Math.sin(a) * 15));
  }
  return merge(parts);
}

/** A gun tube with a muzzle brake — the difference between a gun and a pipe. */
export function barrelGeometry(len, r, brake) {
  const parts = [at(tube(r * 0.86, r, len, 10), len / 2, 0, 0)];
  if (brake) {
    parts.push(at(tube(r * 1.5, r * 1.5, len * 0.09, 10), len * 0.95, 0, 0));
    // the two side ports that make a muzzle brake a muzzle brake
    parts.push(boxAt(len * 0.05, r * 2.4, r * 0.7, len * 0.9, 0, 0));
  }
  // the fume extractor, a bulge partway down every modern tank gun
  parts.push(at(tube(r * 1.35, r * 1.35, len * 0.12, 9), len * 0.45, 0, 0));
  return merge(parts);
}

/** A burnt-out hull, for the dead. */
export function wreckGeometry() {
  const parts = [at(slab(12.0, 14.0, 4.0, 26.0), 0, 0, 0)];
  // the turret, blown off and lying askew beside it, which is what happens
  parts.push(at(turn(slab(7.0, 9.0, 3.0, 9.0), 0.3, 0, 0.9), -4.0, 4.0, 3.0));
  for (const s of [-1, 1]) parts.push(boxAt(25.0, 1.6, 2.6, 0, 0.7, s * 7.4));
  return merge(parts);
}
