// =============================================================================
// Save data.
//
// The commander profile, the record and the best score. localStorage is enough
// today; when the profile moves to a server (see docs/ROADMAP.md) only this file
// changes, and the async signature is already here so nothing else has to move.
// =============================================================================
const PREFIX = 'ironfront:';

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode, or the quota is full
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/**
 * Read a value that must be one of a known set.
 *
 * Storage outlives the code that wrote it: a setting can come back from an
 * older build, a hand-edited value, or another tab. Anything unrecognised falls
 * back rather than reaching the engine.
 */
export function pick(key, allowed, fallback) {
  const v = read(key, fallback);
  const ok = Array.isArray(allowed)
    ? allowed.includes(v)
    : Object.prototype.hasOwnProperty.call(allowed, v);
  return ok ? v : fallback;
}
