/* Myaku — app icons.
 *
 * Draws the three channel rings on the primary gradient and writes PNGs at the
 * sizes iOS and Android ask for, using nothing but the zlib that ships with Node.
 * A home-screen web app on iOS needs a PNG touch icon, and adding an image library
 * for four small files would be a dependency out of all proportion to the job.
 *
 *   node scripts/make-icons.js
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- png encoding ---------------- */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- drawing ---------------- */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const TOP = hex("#7f67be");
const BOTTOM = hex("#381e72");
const RINGS = [hex("#ffb2bf"), hex("#b6c4ff"), hex("#f5bf48")];

/* Signed distance to a rounded square, for the icon's own corner rounding. */
function roundedSquare(x, y, size, radius) {
  const qx = Math.abs(x - size / 2) - (size / 2 - radius);
  const qy = Math.abs(y - size / 2) - (size / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function draw(size, { maskable = false, rounded = true } = {}) {
  const px = Buffer.alloc(size * size * 4);
  // Maskable icons get cropped to a circle, so the rings shrink into the safe zone.
  const content = maskable ? 0.72 : 0.9;
  const r = size * 0.17 * content;
  const width = size * 0.058 * content;
  const cy = size / 2;
  const centres = [-1, 0, 1].map((k) => size / 2 + k * size * 0.2 * content);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let colour = mix(TOP, BOTTOM, clamp01((x + y) / (2 * size)));
      let alpha = 1;

      if (rounded && !maskable) alpha = clamp01(0.5 - roundedSquare(x + 0.5, y + 0.5, size, size * 0.225));

      // Rings drawn left to right, each over the last, with anti-aliased edges.
      centres.forEach((cx, k) => {
        const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r);
        const cover = clamp01(width / 2 - d + 0.5);
        if (cover > 0) colour = mix(colour, RINGS[k], cover);
      });

      px[i] = Math.round(colour[0]);
      px[i + 1] = Math.round(colour[1]);
      px[i + 2] = Math.round(colour[2]);
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, px);
}

const OUTPUTS = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-512-maskable.png", 512, { maskable: true }],
  // iOS applies its own corner mask, and a pre-rounded icon shows a dark rim.
  ["apple-touch-icon.png", 180, { rounded: false }],
  ["favicon-32.png", 32, {}],
];

OUTPUTS.forEach(([name, size, opts]) => {
  fs.writeFileSync(path.join(OUT, name), draw(size, opts));
  console.log(`wrote icons/${name}`);
});
