// Small numeric helpers used across the simulation and the renderer.
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
export const other = (t) => (t === 'blue' ? 'red' : 'blue');
