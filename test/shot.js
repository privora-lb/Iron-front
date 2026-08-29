'use strict';
// Screenshot the running game.
//
// The harness in dom.js gives the engine a canvas that records nothing, so the
// suite can prove draw() does not throw but never what the screen looks like.
// This boots the same engine against a REAL canvas and writes a PNG, which is
// the only way to answer questions like "why does the map look like a board
// game" without a browser.
//
//   npm run shot                                  villages, midday, full map
//   node test/shot.js out.png --map city --hour night --zoom 3
//
//   --map    ultimate | villages
//   --hour   dawn | day | dusk | night
//   --ticks  how far into the battle to run before the frame is taken
//   --zoom   1 is the whole map, which is where a match starts
//   --w --h  the viewport, in CSS pixels
//
// Needs a native canvas, which is NOT a dependency of the game - it is a few
// tens of megabytes of prebuilt binary and only this tool wants it:
//
//   npm i --no-save @napi-rs/canvas
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

let canvasLib;
try {
  canvasLib = require('@napi-rs/canvas');
} catch {
  console.error('test/shot.js needs a native canvas:\n\n  npm i --no-save @napi-rs/canvas\n');
  process.exit(1);
}
const { createCanvas, Path2D, DOMMatrix, Image } = canvasLib;

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d;
};
const OUT = process.argv[2] && process.argv[2][0] !== '-' ? process.argv[2] : 'shot.png';
const MAP = arg('map', 'villages');
const HOUR = arg('hour', 'day');
const TICKS = parseInt(arg('ticks', '600'), 10);
const ZOOM = parseFloat(arg('zoom', '1'));
const VIEW_W = parseInt(arg('w', '1100'), 10);
const VIEW_H = parseInt(arg('h', '620'), 10);

/* The game draws one of our fake elements onto another; napi-rs needs the real
   canvas hiding behind it. */
const real = (v) => (v && v.__canvas) || v;
function wrap(g) {
  return new Proxy(g, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      if (k === 'drawImage' || k === 'createPattern') {
        return (...a) => { a[0] = real(a[0]); return v.apply(t, a); };
      }
      return v.bind(t);
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

// Every canvas the game asks for gets a real one behind it, resized by whatever
// the engine writes to .width/.height - exactly as a browser behaves.
global.__realCtx = (el) => {
  const c = createCanvas(Math.max(1, el.width || 300), Math.max(1, el.height || 150));
  Object.defineProperty(el, 'width', {
    get: () => c.width, set: (v) => { c.width = Math.max(1, v | 0); }, configurable: true,
  });
  Object.defineProperty(el, 'height', {
    get: () => c.height, set: (v) => { c.height = Math.max(1, v | 0); }, configurable: true,
  });
  el.__canvas = c;
  el.toDataURL = () => 'data:image/png;base64,' + c.toBuffer('image/png').toString('base64');
  return wrap(c.getContext('2d'));
};

// Load dom.js with its stub context swapped for ours, and with a real Path2D:
// the terrain bake clips with one, and the engine's own polyfill installs a
// dummy whenever the host has none, so without this the ground never draws.
const domPath = path.join(__dirname, 'dom.js');
const patched = fs
  .readFileSync(domPath, 'utf8')
  .replace(
    'return ctx2d || (ctx2d = makeCtx(el));',
    'return ctx2d || (ctx2d = (global.__realCtx ? global.__realCtx(el) : makeCtx(el)));',
  )
  .replace(
    'const context = vm.createContext(win);',
    'win.Path2D = global.__P2D; win.DOMMatrix = global.__DM; win.Image = global.__IM;\n' +
      '  const context = vm.createContext(win);',
  );
global.__P2D = Path2D;
global.__DM = DOMMatrix;
global.__IM = Image;

const m = new Module(domPath, null);
m.filename = domPath;
m.paths = Module._nodeModulePaths(__dirname);
m._compile(patched, domPath);
const { loadGame } = m.exports;

const g = loadGame({ quiet: true });
if (g.loadError) {
  console.error(g.loadError.stack || g.loadError);
  process.exit(1);
}
const win = g.win;

// resize() measures the canvas, so it needs a real size before the first frame.
const cv = g.el('cv');
cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: VIEW_W, height: VIEW_H });
win.innerWidth = VIEW_W;
win.innerHeight = VIEW_H;
if (win.visualViewport) { win.visualViewport.width = VIEW_W; win.visualViewport.height = VIEW_H; }

try {
  const mb = g.all('#mapPick [data-map="' + MAP + '"]')[0];
  if (!mb) throw new Error('no such battlefield: ' + MAP);
  mb.click();

  const hours = ['dawn', 'day', 'dusk', 'night'];
  const hb = g.all('#hourPick button');
  const hi = hours.indexOf(HOUR);
  if (hi < 0) throw new Error('no such hour: ' + HOUR);
  if (hb.length) hb[hi].click();

  g.hook('seed')(20260825);
  g.all('#startVeil [data-budget="2000"]')[0].click();
  g.el('autoDep').click();
  g.el('startBattle').click();
  if (typeof win.onresize === 'function') win.onresize();

  g.hook('tick')(TICKS);
  const zin = g.el('zin');                       // the HUD's own zoom button
  for (let i = 0; i < Math.round(Math.log(ZOOM) / Math.log(1.18)); i++) zin.click();
  g.frames(4);                                   // real animation frames, so draw() runs
} catch (e) {
  console.error('could not drive the game:', (e && e.stack) || e);
  process.exit(1);
}
g.frames(2);

const out = cv.__canvas;
if (!out) { console.error('no canvas behind #cv'); process.exit(1); }
fs.writeFileSync(path.resolve(ROOT, OUT), out.toBuffer('image/png'));
console.log('wrote', OUT, out.width + 'x' + out.height, '·', MAP, HOUR, 'tick', TICKS, 'zoom', ZOOM);
