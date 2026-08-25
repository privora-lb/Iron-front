// =============================================================================
// Sound.
//
// Every effect is synthesised at run time — noise bursts, filtered thumps and
// short tones — so the game ships no audio files, stays offline, and adds
// nothing to the download. That matters more here than fidelity: a battle can
// fire several hundred shots a second, and the interesting problem is not what
// one rifle sounds like but how to play four hundred of them without turning
// the mix into white noise or stalling the frame.
//
// Three rules do that work:
//   * nothing is heard off screen,
//   * each effect has a rate limit, so a volley becomes a crackle, not a wall,
//   * a hard voice cap drops a new sound rather than the frame.
//
// The context is not created until a real user gesture. Every mobile browser
// blocks it otherwise, and a blocked context stays blocked.
// =============================================================================
import { read, write } from '../platform/storage.js';

let ctx = null;
let master = null;
let noiseBuf = null;

let muted = read('muted', false);
let volume = read('volume', 0.7);

// Where the camera is, so a sound knows whether it is on screen and which ear
// it is in. Set once a frame by the engine; the defaults mean sfx() is safe to
// call before the first frame.
const ear = { x: 0, y: 0, halfW: 1, halfH: 1 };

let voices = 0;
const MAX_VOICES = 24;
const lastPlayed = new Map();

/* ------------------------------------------------------------- the kit ---- */
// gap: the shortest time between two of the same effect, in seconds. Anything
// asked for inside that window is dropped, which is what turns a volley of
// forty rifles into a crackle instead of one loud smear.
const KIT = {
  rifle: { gap: 0.045, gain: 0.16, make: crack },
  mg: { gap: 0.03, gain: 0.13, make: crack },
  cannon: { gap: 0.07, gain: 0.5, make: boom },
  explode: { gap: 0.05, gain: 0.6, make: boom },
  deploy: { gap: 0, gain: 0.3, make: chirp },
  click: { gap: 0, gain: 0.2, make: chirp },
  win: { gap: 0, gain: 0.5, make: fanfare },
  lose: { gap: 0, gain: 0.5, make: fanfare },
};

/** Small arms: a filtered noise burst with a very fast decay. */
function crack(dest, t) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.5;

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900 + Math.random() * 500;

  const env = ctx.createGain();
  env.gain.setValueAtTime(1, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

  src.connect(hp).connect(env).connect(dest);
  src.start(t, Math.random() * 0.4);
  src.stop(t + 0.09);
  return 0.09;
}

/** Artillery and impacts: a low sine thump under a longer noise tail. */
function boom(dest, t) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120 + Math.random() * 40, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.32);

  const oEnv = ctx.createGain();
  oEnv.gain.setValueAtTime(0.9, t);
  oEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
  osc.connect(oEnv).connect(dest);
  osc.start(t);
  osc.stop(t + 0.38);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.5 + Math.random() * 0.2;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2200, t);
  lp.frequency.exponentialRampToValueAtTime(280, t + 0.4);

  const nEnv = ctx.createGain();
  nEnv.gain.setValueAtTime(0.7, t);
  nEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

  src.connect(lp).connect(nEnv).connect(dest);
  src.start(t, Math.random() * 0.4);
  src.stop(t + 0.44);
  return 0.44;
}

/** Interface: one short, clean tone. */
function chirp(dest, t) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.06);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(1, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

  osc.connect(env).connect(dest);
  osc.start(t);
  osc.stop(t + 0.13);
  return 0.13;
}

/** End of a match: a rising third for a win, a falling one for a loss. */
function fanfare(dest, t, name) {
  const notes = name === 'lose' ? [392, 330, 262] : [392, 494, 587];
  notes.forEach((hz, i) => {
    const at = t + i * 0.16;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.8, at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.34);

    osc.connect(env).connect(dest);
    osc.start(at);
    osc.stop(at + 0.36);
  });
  return 0.16 * notes.length + 0.36;
}

/* -------------------------------------------------------------- set-up ---- */
/** Must be called from inside a click or touch handler the first time. */
export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;

  try {
    ctx = new AC();
  } catch {
    return null;
  }

  master = ctx.createGain();
  master.gain.value = muted ? 0 : volume;

  // A gentle limiter. Forty rifles and a howitzer in the same tick would clip
  // an unprotected master; this holds the peaks without ducking the quiet
  // stretches between assaults.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 24;
  comp.ratio.value = 10;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;

  master.connect(comp).connect(ctx.destination);

  // One second of white noise, reused by every burst. Generating it per shot
  // would be the most expensive thing in the mix by a wide margin.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

export const isReady = () => Boolean(ctx) && ctx.state === 'running';
export const isMuted = () => muted;
export const getVolume = () => volume;

export function setMuted(on) {
  muted = Boolean(on);
  write('muted', muted);
  if (master) master.gain.value = muted ? 0 : volume;
  return muted;
}

export function toggleMuted() {
  return setMuted(!muted);
}

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, v));
  write('volume', volume);
  if (master && !muted) master.gain.value = volume;
  return volume;
}

/** The engine calls this once a frame with the visible world rectangle. */
export function listen(cx, cy, halfW, halfH) {
  ear.x = cx;
  ear.y = cy;
  ear.halfW = Math.max(1, halfW);
  ear.halfH = Math.max(1, halfH);
}

/* ---------------------------------------------------------------- play ---- */
/**
 * Play one effect at a point in the world. Pass no coordinates for interface
 * sounds, which are always centred and always heard.
 *
 * Returns true if a voice actually started — useful in tests, ignored in play.
 */
export function sfx(name, x, y) {
  if (!ctx || muted || ctx.state !== 'running') return false;

  const spec = KIT[name];
  if (!spec) return false;

  const positional = x !== undefined && y !== undefined;
  let pan = 0;
  let fall = 1;

  if (positional) {
    // Just off screen still carries; twice the screen away does not.
    const dx = (x - ear.x) / ear.halfW;
    const dy = (y - ear.y) / ear.halfH;
    const d = Math.hypot(dx, dy);
    if (d > 2) return false;
    fall = d <= 1 ? 1 : 1 - (d - 1);
    pan = Math.max(-1, Math.min(1, dx));
  }

  const now = ctx.currentTime;
  if (spec.gap > 0) {
    const last = lastPlayed.get(name);
    if (last !== undefined && now - last < spec.gap) return false;
    lastPlayed.set(name, now);
  }

  if (voices >= MAX_VOICES) return false;

  const level = ctx.createGain();
  level.gain.value = spec.gain * fall;

  let head = level;
  if (positional && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    level.connect(panner);
    head = panner;
  }
  head.connect(master);

  voices++;
  const life = spec.make(level, now, name);
  setTimeout(
    () => {
      voices--;
      try {
        head.disconnect();
        if (head !== level) level.disconnect();
      } catch {
        /* already torn down */
      }
    },
    (life + 0.1) * 1000,
  );

  return true;
}

/** Silence everything at once — used when the game is backgrounded. */
export function suspend() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
