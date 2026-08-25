// =============================================================================
// Saved battles.
//
// A save is one JSON record in localStorage under `ironfront:save:<id>`, with a
// small index under `ironfront:saves` so the load list can be drawn without
// parsing a megabyte of battle state. Everything goes through storage.js, so a
// viewer that blocks storage degrades to "saving is unavailable" instead of
// throwing.
//
// The index is the source of truth for what exists. A slot whose record has
// gone missing - a half-finished write, a cleared origin - is dropped from the
// list rather than offered and then failing to load.
// =============================================================================
import { read, write, remove } from './storage.js';

export const VERSION = 1; // bump when the record shape changes
export const MAX_SLOTS = 8; // manual slots; the autosave is extra
export const AUTO_ID = 'auto';

const INDEX = 'saves';
const slotKey = (id) => 'save:' + id;

function rows() {
  const a = read(INDEX, []);
  return Array.isArray(a) ? a.filter((e) => e && typeof e.id === 'string') : [];
}

function writeRows(list) {
  return write(INDEX, list);
}

/** Every saved battle, newest first. The autosave, if there is one, leads. */
export function list() {
  return rows()
    .slice()
    .sort((a, b) => (b.id === AUTO_ID) - (a.id === AUTO_ID) || (b.at || 0) - (a.at || 0));
}

/** How many manual slots are in use - the autosave does not take one. */
export function used() {
  return rows().filter((e) => e.id !== AUTO_ID).length;
}

/**
 * Store one battle. `id` names an existing slot to overwrite, or null for a new
 * one. Returns {ok:true,id,at} or {ok:false,why:'full'|'slots'} - 'full' is no
 * room in storage, 'slots' is every manual slot already taken.
 */
export function put(id, meta, state) {
  const now = Date.now();
  if (!id && used() >= MAX_SLOTS) return { ok: false, why: 'slots' };
  const key = id || 's' + now.toString(36) + Math.floor(Math.random() * 46656).toString(36);
  if (!write(slotKey(key), { v: VERSION, id: key, at: now, meta, state })) {
    return { ok: false, why: 'full' };
  }
  const list2 = rows().filter((e) => e.id !== key);
  list2.push({ id: key, at: now, meta });
  if (!writeRows(list2)) {
    remove(slotKey(key));
    return { ok: false, why: 'full' };
  }
  return { ok: true, id: key, at: now };
}

/** The full record for one slot, or null if it is gone or unreadable. */
export function get(id) {
  const rec = read(slotKey(id), null);
  if (!rec || rec.v !== VERSION || !rec.state) {
    if (rec) drop(id); // a record from another build is no use to anyone
    return null;
  }
  return rec;
}

/** Forget one slot. */
export function drop(id) {
  remove(slotKey(id));
  writeRows(rows().filter((e) => e.id !== id));
}

/** Drop index entries whose record has vanished. Returns the surviving list. */
export function prune() {
  const keep = rows().filter((e) => read(slotKey(e.id), null) !== null);
  if (keep.length !== rows().length) writeRows(keep);
  return keep;
}
