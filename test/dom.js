'use strict';
// A minimal DOM + canvas good enough to run Iron Front headlessly in Node.
// It parses the real <body> markup out of index.html so that querySelectorAll,
// event delegation and "click every button" all work against the true tree.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'area', 'col', 'embed', 'track', 'wbr']);

/* ------------------------------- elements ------------------------------- */
class Elem {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toLowerCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    // dataset writes must land back on the data-* attribute, or selectors like
    // [data-map="villages"] miss elements the game builds at runtime.
    const attrs = this.attributes;
    this.dataset = new Proxy(Object.create(null), {
      get: (t, k) => (typeof k === 'string' ? attrs['data-' + camelToDash(k)] : t[k]),
      set: (t, k, v) => { attrs['data-' + camelToDash(k)] = String(v); return true; },
      has: (t, k) => 'data-' + camelToDash(String(k)) in attrs,
      deleteProperty: (t, k) => { delete attrs['data-' + camelToDash(String(k))]; return true; },
      ownKeys: () => Object.keys(attrs).filter(a => a.slice(0, 5) === 'data-').map(a => dashToCamel(a.slice(5))),
      getOwnPropertyDescriptor: (t, k) => {
        const a = 'data-' + camelToDash(String(k));
        return a in attrs ? { value: attrs[a], enumerable: true, configurable: true, writable: true } : undefined;
      },
    });
    this.style = makeStyle();
    this._classes = [];
    this._text = '';
    this._html = '';
    this._listeners = Object.create(null);
    this.onclick = null;
    this.oninput = null;
    this.value = '';
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.offsetWidth = 1280;
    this.offsetHeight = 720;
    if (this.tagName === 'canvas') makeCanvas(this);
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get childElementCount() { return this.children.length; }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const sib = this.parentNode.children;
    return sib[sib.indexOf(this) + 1] || null;
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const sib = this.parentNode.children;
    return sib[sib.indexOf(this) - 1] || null;
  }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); }
  get classList() {
    const self = this;
    return {
      add: (...c) => { for (const k of c) if (k && !self._classes.includes(k)) self._classes.push(k); },
      remove: (...c) => { self._classes = self._classes.filter(x => !c.includes(x)); },
      contains: c => self._classes.includes(c),
      toggle: (c, force) => {
        const on = force === undefined ? !self._classes.includes(c) : !!force;
        if (on) { if (!self._classes.includes(c)) self._classes.push(c); }
        else self._classes = self._classes.filter(x => x !== c);
        return on;
      },
    };
  }
  get textContent() {
    if (this.childNodes.length) {
      return this.childNodes.map(n => (n.nodeType === 1 ? n.textContent : n.text)).join('');
    }
    return this._text;
  }
  set textContent(v) { this.childNodes.length = 0; this._text = v == null ? '' : String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this.childNodes.length = 0; this._text = ''; this._html = v == null ? '' : String(v); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = v;
    else if (k === 'id') this.id = v;
    else if (k === 'style') applyStyleText(this.style, v);
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  insertBefore(n, ref) {
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    if (i < 0) this.childNodes.push(n);
    else this.childNodes.splice(i, 0, n);
    return n;
  }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  removeEventListener(type, fn) {
    const a = this._listeners[type];
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) { if (matchPart(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0 };
  }
  focus() {}
  blur() {}
  scrollIntoView() {}
  requestFullscreen() { return Promise.resolve(); }
  dispatchEvent(ev) { fire(this, ev); return true; }
  click() {
    fire(this, {
      type: 'click', target: this, clientX: 0, clientY: 0, button: 0,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
    });
  }
}

function fire(target, ev) {
  ev.target = ev.target || target;
  let n = target;
  while (n && n.nodeType === 1) {
    ev.currentTarget = n;
    const on = n['on' + ev.type];
    if (typeof on === 'function') on.call(n, ev);
    const ls = n._listeners && n._listeners[ev.type];
    if (ls) for (const fn of ls.slice()) fn.call(n, ev);
    n = n.parentNode;
  }
}

function dashToCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
function camelToDash(s) { return String(s).replace(/[A-Z]/g, c => '-' + c.toLowerCase()); }

function makeStyle() {
  const s = {};
  Object.defineProperty(s, 'cssText', {
    get() { return s._css || ''; },
    set(v) { s._css = v; applyStyleText(s, v); },
    enumerable: false, configurable: true,
  });
  Object.defineProperty(s, 'setProperty', {
    value: (k, v) => { s[dashToCamel(k)] = v; }, enumerable: false,
  });
  Object.defineProperty(s, 'removeProperty', {
    value: k => { delete s[dashToCamel(k)]; }, enumerable: false,
  });
  return s;
}

function applyStyleText(style, text) {
  for (const decl of String(text || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    style[dashToCamel(decl.slice(0, i).trim())] = decl.slice(i + 1).trim();
  }
}

/* -------------------------------- canvas -------------------------------- */
const CTX_METHODS = [
  'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo',
  'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip', 'fillRect', 'strokeRect',
  'clearRect', 'fillText', 'strokeText', 'translate', 'rotate', 'scale', 'transform', 'setTransform',
  'resetTransform', 'setLineDash', 'drawImage', 'putImageData', 'isPointInPath', 'isPointInStroke',
];

function makeCtx(canvas) {
  const c = {
    canvas,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px sans-serif',
    textAlign: 'start', textBaseline: 'alphabetic', shadowBlur: 0, shadowColor: 'transparent',
    shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low', lineDashOffset: 0, direction: 'ltr',
  };
  for (const m of CTX_METHODS) c[m] = () => {};
  c.getLineDash = () => [];
  c.measureText = t => {
    const w = String(t == null ? '' : t).length * 6;
    return {
      width: w, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0, actualBoundingBoxRight: w,
    };
  };
  const grad = { addColorStop() {} };
  c.createLinearGradient = () => grad;
  c.createRadialGradient = () => grad;
  c.createConicGradient = () => grad;
  c.createPattern = () => ({ setTransform() {} });
  const img = (w, h) => ({
    data: new Uint8ClampedArray(Math.max(4, Math.abs(w | 0) * Math.abs(h | 0) * 4)),
    width: Math.abs(w | 0), height: Math.abs(h | 0),
  });
  c.getImageData = (x, y, w, h) => img(w, h);
  c.createImageData = (w, h) => img(w, h);
  return c;
}

function makeCanvas(el) {
  el.width = 300;
  el.height = 150;
  let ctx2d = null;
  el.getContext = kind => {
    if (kind !== '2d') return null;
    return ctx2d || (ctx2d = makeCtx(el));
  };
  el.toDataURL = () => 'data:image/png;base64,';
  el.toBlob = cb => cb(null);
}

/* ----------------------------- tiny selectors ---------------------------- */
function parsePart(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /(\[[^\]]*\]|[#.]?[A-Za-z0-9_-]+|\*)/g;
  let m;
  while ((m = re.exec(sel))) {
    const t = m[1];
    if (t[0] === '#') out.id = t.slice(1);
    else if (t[0] === '.') out.classes.push(t.slice(1));
    else if (t[0] === '[') {
      const body = t.slice(1, -1);
      const eq = body.indexOf('=');
      if (eq < 0) out.attrs.push([body.trim(), null]);
      else out.attrs.push([body.slice(0, eq).trim(), body.slice(eq + 1).trim().replace(/^["']|["']$/g, '')]);
    } else if (t !== '*') out.tag = t.toLowerCase();
  }
  return out;
}

function matchPart(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  const p = typeof sel === 'string' ? parsePart(sel) : sel;
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.id && el.id !== p.id) return false;
  for (const c of p.classes) if (!el._classes.includes(c)) return false;
  for (const pair of p.attrs) {
    const have = el.getAttribute(pair[0]);
    if (have === null) return false;
    if (pair[1] !== null && have !== pair[1]) return false;
  }
  return true;
}

function walk(root, fn) {
  for (const c of root.childNodes) {
    if (c.nodeType !== 1) continue;
    fn(c);
    walk(c, fn);
  }
}

function queryAll(root, sel) {
  const parts = String(sel).trim().split(/\s+(?![^[]*\])/).filter(Boolean).map(parsePart);
  let cur = [root];
  for (const p of parts) {
    const next = [];
    for (const c of cur) walk(c, e => { if (matchPart(e, p) && next.indexOf(e) < 0) next.push(e); });
    cur = next;
    if (!cur.length) break;
  }
  return cur;
}

/* ------------------------------ html parser ------------------------------ */
function parseHTML(html, doc, root) {
  const stack = [root];
  const tok = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = tok.exec(html))) {
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === name) { stack.length = i; break; }
      }
    } else if (m[2]) {
      const name = m[2].toLowerCase();
      const el = new Elem(name, doc);
      const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || ''))) {
        const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
        el.setAttribute(a[1], v);
      }
      stack[stack.length - 1].appendChild(el);
      if (el.id && !doc._ids[el.id]) doc._ids[el.id] = el;
      if (!m[4] && !VOID.has(name)) stack.push(el);
    } else if (m[5] && m[5].trim()) {
      const parent = stack[stack.length - 1];
      parent.childNodes.push({ nodeType: 3, text: m[5], parentNode: parent });
    }
  }
}

/* ------------------------------- document -------------------------------- */
function makeDocument(bodyHTML) {
  const doc = { _ids: Object.create(null), nodeType: 9, hidden: false, fullscreenElement: null };
  const html = new Elem('html', doc);
  const body = new Elem('body', doc);
  html.appendChild(body);
  doc.documentElement = html;
  doc.body = body;
  parseHTML(bodyHTML, doc, body);
  doc.createElement = tag => new Elem(tag, doc);
  doc.createElementNS = (ns, tag) => new Elem(tag, doc);
  doc.createTextNode = t => ({ nodeType: 3, text: String(t), parentNode: null });
  doc.getElementById = id => {
    if (doc._ids[id]) return doc._ids[id];
    const found = queryAll(html, '#' + id)[0] || null;
    if (found) doc._ids[id] = found;
    return found;
  };
  doc.querySelector = sel => queryAll(html, sel)[0] || null;
  doc.querySelectorAll = sel => queryAll(html, sel);
  doc.addEventListener = (t, fn) => html.addEventListener(t, fn);
  doc.removeEventListener = (t, fn) => html.removeEventListener(t, fn);
  doc.exitFullscreen = () => Promise.resolve();
  doc.getElementsByTagName = t => queryAll(html, t);
  return doc;
}

/* -------------------------- load the game itself -------------------------- */
function readIndex(file) {
  const src = fs.readFileSync(file, 'utf8');
  const bodyM = src.match(/<body[^>]*>([\s\S]*?)<script/i);
  if (!bodyM) throw new Error('could not find <body> ... <script> in ' + file);
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  let m;
  while ((m = re.exec(src))) scripts.push(m[1]);
  if (!scripts.length) {
    // The game moved from one inline <script> to ES modules under src/. Fall
    // back to the single-file bundle that `npm run build:test` produces.
    const bundle = path.join(__dirname, '..', 'dist-test', 'iron-front.iife.js');
    if (!fs.existsSync(bundle)) {
      throw new Error('no inline <script> in ' + file + ' and no bundle at ' + bundle +
        ' — run: npm run build:test');
    }
    scripts.push(fs.readFileSync(bundle, 'utf8'));
  }
  return { body: bodyM[1], code: scripts.join('\n;\n'), lines: src.split('\n').length, bytes: src.length };
}

// Boot one isolated copy of the game. Returns handles for driving it.
function loadGame(opts) {
  opts = opts || {};
  const file = opts.file || path.join(__dirname, '..', 'index.html');
  const parsed = readIndex(file);
  const doc = makeDocument(parsed.body);

  const store = new Map();
  const errors = [];
  const timers = [];
  let clock = 1000;
  let rafCb = null;

  const win = {};
  Object.assign(win, {
    window: win,
    self: win,
    document: doc,
    console: opts.quiet ? { log() {}, warn() {}, error() {}, info() {}, debug() {} } : console,
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    location: { href: 'http://localhost/iron-front/', hash: '', search: '', protocol: 'http:', host: 'localhost' },
    navigator: { userAgent: 'node-harness', maxTouchPoints: 0 },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
      clear: () => store.clear(),
      key: i => Array.from(store.keys())[i] || null,
      get length() { return store.size; },
    },
    performance: { now: () => clock },
    requestAnimationFrame: cb => { rafCb = cb; return 1; },
    cancelAnimationFrame: () => { rafCb = null; },
    setTimeout: (fn, ms) => { timers.push({ fn: fn, at: clock + (ms || 0) }); return timers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: (t, fn) => { (win._l || (win._l = {}))[t] = ((win._l[t] || []).concat(fn)); },
    removeEventListener: () => {},
    dispatchEvent: () => true,
    prompt: () => null,
    alert: () => {},
    confirm: () => false,
    matchMedia: () => ({
      matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    visualViewport: null,
    screen: { width: 1280, height: 720 },
    fetch: () => Promise.reject(new Error('no network in harness')),
  });
  win.Image = function ImageStub() { this.width = 0; this.height = 0; };
  if (opts.WebSocket) win.WebSocket = opts.WebSocket;

  const context = vm.createContext(win);
  let loadError = null;
  try {
    vm.runInContext(parsed.code, context, { filename: 'index.html<script>', displayErrors: true });
  } catch (e) {
    loadError = e;
  }

  const api = {
    win,
    doc,
    lines: parsed.lines,
    bytes: parsed.bytes,
    loadError,
    errors,
    get clock() { return clock; },
    // one animation frame, exactly as the browser would drive it
    frame(ms) {
      const cb = rafCb;
      rafCb = null;
      if (!cb) return false;
      clock += ms === undefined ? 1000 / 60 : ms;
      cb(clock);
      return true;
    },
    frames(n, ms) {
      let ran = 0;
      for (let i = 0; i < n; i++) { if (!api.frame(ms)) break; ran++; }
      return ran;
    },
    flushTimers() {
      const due = timers.splice(0, timers.length);
      for (const t of due) { try { t.fn(); } catch (e) { errors.push(e); } }
    },
    el: id => doc.getElementById(id),
    all: sel => doc.querySelectorAll(sel),
    hook: name => win['__' + name],
    // showFault() appends #fault when draw() throws - the black-screen canary
    fault() {
      const f = doc.getElementById('fault');
      return f ? f.textContent : null;
    },
  };
  return api;
}

module.exports = { loadGame, makeDocument, Elem, queryAll, readIndex, parseHTML };
