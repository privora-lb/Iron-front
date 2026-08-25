// =============================================================================
// Icon generator — no dependencies, no design tool.
//
// Draws the Iron Front emblem (a gold wedge inside a ring on gunmetal) at every
// size the web app, the PWA and the two native shells ask for, and writes real
// PNGs with Node's own zlib. Re-run with `npm run icons` after changing COLORS
// or the emblem below.
// =============================================================================
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const INK = [0x14, 0x13, 0x0f];
const GOLD = [0xc9, 0xa2, 0x27];
const PARCH = [0xe6, 0xd8, 0xb8];

/* ---------------------------------------------------------------- png ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of size*size*4 → a PNG buffer. */
function encodePng(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v;
    });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- emblem ---- */
// Everything below works in unit space (0..1) so one description serves every
// size. `scale` shrinks the emblem for maskable icons, whose outer ring the
// launcher is free to crop.
function emblem(u, v, scale) {
  const x = (u - 0.5) / scale + 0.5;
  const y = (v - 0.5) / scale + 0.5;
  const r = Math.hypot(x - 0.5, y - 0.5);

  if (r > 0.5) return null; // outside the badge
  if (r > 0.435 && r < 0.475) return GOLD; // the ring

  // chevron: outer wedge minus inner wedge
  const inWedge = (apexY, halfBase, baseY) => {
    if (y < apexY || y > baseY) return false;
    const t = (y - apexY) / (baseY - apexY);
    return Math.abs(x - 0.5) <= halfBase * t;
  };
  if (inWedge(0.24, 0.26, 0.66) && !inWedge(0.4, 0.155, 0.66)) return PARCH;
  if (y > 0.7 && y < 0.765 && Math.abs(x - 0.5) < 0.22) return GOLD; // the bar

  if (r <= 0.5) return INK;
  return null;
}

/** Render one icon with 4x4 supersampling. `bleed` fills the corners too. */
function render(size, { scale = 1, bleed = false } = {}) {
  const px = new Uint8Array(size * size * 4);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const c = emblem(u, v, scale) ?? (bleed ? INK : null);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

/* ------------------------------------------------------------- output ---- */
const TARGETS = [
  ['public/icons/icon-192.png', 192, {}],
  ['public/icons/icon-512.png', 512, {}],
  ['public/icons/maskable-512.png', 512, { scale: 0.72, bleed: true }],
  ['public/icons/apple-touch-icon.png', 180, { bleed: true }],
  ['public/icons/favicon-32.png', 32, {}],
  ['resources/icon.png', 1024, { bleed: true }],
  ['resources/splash.png', 1024, { scale: 0.45, bleed: true }],
];

for (const [rel, size, opts] of TARGETS) {
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodePng(render(size, opts), size));
  console.log(`  ${rel}  ${size}x${size}`);
}
console.log('icons written');
