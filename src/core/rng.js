// Deterministic simulation randomness — shared by every player of a match.
// Cosmetic randomness lives in vr(): it never touches the simulation, so it may
// differ from machine to machine without desyncing anything.
let SEED = 1 >>> 0;
export function srand(v) {
  SEED = v >>> 0 || 1;
}
export function R() {
  // xorshift32
  SEED ^= SEED << 13;
  SEED >>>= 0;
  SEED ^= SEED >>> 17;
  SEED ^= SEED << 5;
  SEED >>>= 0;
  return SEED / 4294967296;
}
export const rnd = (a, b) => a + R() * (b - a);
export const seed = () => SEED;
export const vr = (a, b) => a + Math.random() * (b - a);
