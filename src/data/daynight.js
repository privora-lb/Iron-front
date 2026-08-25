// The clock the battlefield runs on.
//
// One full turn of the sky takes DAY_LEN seconds of battle time, so a long
// engagement outlives the light it started in. Everything here is a pure
// function of that clock: given the time, it hands back where the sun is, how
// much light there is, and what colour that light is. Nothing in this file
// touches the simulation or the RNG, so both sides of a match agree on the hour
// without exchanging a word about it.
//
// The angles are for a game seen from directly overhead, not an almanac. The
// sun crosses the map rather than the sky, because a shadow that sweeps around
// through the afternoon is what actually reads as time passing.

// An hour of fighting to the full turn of the sky. Sized so that a battle
// traces one ARC of the day rather than looping through several: start at dusk
// and you finish in the dark, start at night and dawn comes up behind you.
// Shorter than this and the light strobes; longer and it never changes at all.
export const DAY_LEN = 3600;

// Where a battle may begin. `at` is the position in the cycle: 0 is midnight,
// 0.25 sunrise, 0.5 noon, 0.75 sunset.
export const START_HOURS = [
  { key: 'dawn', name: 'Dawn', at: 0.245, blurb: 'First light — the dark burns off as you close' },
  { key: 'day', name: 'Midday', at: 0.46, blurb: 'Full sun, nothing hidden, no excuses' },
  { key: 'dusk', name: 'Dusk', at: 0.735, blurb: 'The light is going and it will not come back' },
  { key: 'night', name: 'Night', at: 0.94, blurb: 'Fought blind, by muzzle flash and burning wreckage' },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Position in the cycle, 0..1, for a battle that began at `start`. */
export const todAt = (start, battleTime) =>
  (((start + battleTime / DAY_LEN) % 1) + 1) % 1;

/**
 * How high the sun stands, -1 (deepest night) through 0 (on the horizon) to
 * +1 (directly overhead). This is the one number everything else is built on.
 */
export const sunElev = (tod) => Math.sin((tod - 0.25) * Math.PI * 2);

/**
 * Which way the sun throws a shadow, in radians. A full turn over the day, so
 * shadows sweep round rather than snapping when the sun crosses the horizon.
 */
export const sunDir = (tod) => Math.PI * 0.35 + (tod - 0.25) * Math.PI * 2;

/**
 * How well anyone can see, 0..1. Never quite reaches zero: there is always a
 * moon, and a battlefield lights itself with burning vehicles besides.
 */
export const MOONLIGHT = 0.12;
export const lightAt = (tod) => {
  const el = sunElev(tod);
  // A gentle slope on purpose. A steep one puts the whole of dawn into a few
  // seconds and the rest of the day at full brightness, which reads as a switch
  // being thrown rather than as the sun coming up.
  return Math.max(MOONLIGHT, clamp01(el * 1.05 + 0.3));
};

/** True once it is dark enough that the fighting changes character. */
export const isNight = (tod) => sunElev(tod) < -0.06;

/**
 * The wash of colour laid over the finished frame: [r, g, b, alpha].
 *
 * Two lights are mixed. Night is a cold blue that deepens as the sun drops.
 * Twilight is a warm band that peaks exactly as the sun crosses the horizon and
 * is gone by the time it is properly up or properly down — which is what gives
 * dawn and dusk their few minutes of amber instead of a straight fade to black.
 */
export function ambientAt(tod) {
  const el = sunElev(tod);
  const night = clamp01((0.15 - el) / 0.7);
  const twilight = clamp01(1 - Math.abs(el) / 0.45);

  const nightA = 0.66 * night;
  const twiA = 0.3 * twilight;
  const a = nightA + twiA;
  if (a < 0.004) return null;                       // broad daylight: skip the pass entirely

  // Weighted blend of the two tints, so neither washes the other out.
  const r = (16 * nightA + 150 * twiA) / a;
  const g = (26 * nightA + 74 * twiA) / a;
  const b = (58 * nightA + 30 * twiA) / a;
  return [Math.round(r), Math.round(g), Math.round(b), Math.min(0.78, a)];
}

/** What to call the current hour in the interface. */
export function phaseName(tod) {
  const el = sunElev(tod);
  const rising = tod > 0 && tod < 0.5;
  if (el < -0.45) return 'Night';
  if (el < -0.06) return rising ? 'Before dawn' : 'Nightfall';
  if (el < 0.28) return rising ? 'Dawn' : 'Dusk';
  if (el < 0.72) return rising ? 'Morning' : 'Afternoon';
  return 'Midday';
}
