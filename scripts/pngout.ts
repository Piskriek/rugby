/**
 * SHARED SIGN-OFF RASTERISER — turns a recorded draw list into a PNG.
 *
 * No SVG rasteriser exists in this container (ImageMagick delegates to a
 * missing rsvg-convert), so the recorded polygons are scanline-filled into an
 * RGBA buffer at 2x and encoded with a small hand-rolled PNG writer on
 * node:zlib.
 *
 * Used by the SPEC_14 and SPEC_15 sign-off sheets. Panels may also carry text
 * overlays, which matters for SPEC_15: a speech bubble is the words, so the
 * picture has to be able to draw them.
 */
/* ------------------------------------------------------------------ *
 * PNG OUT. No SVG rasteriser is available in this container (ImageMagick
 * delegates to a missing rsvg-convert), so rasterise the recorded polygons
 * directly: scanline fill into an RGBA buffer, 2x supersampled, then a
 * hand-rolled PNG encoder on top of node:zlib.
 * ------------------------------------------------------------------ */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

export type Poly = { pts: number[][]; fill: string; alpha: number; isStroke: boolean };

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function parseHex(c: string): [number, number, number] {
  let h = c.trim();
  if (!/^#/.test(h)) return [136, 136, 136];
  h = h.slice(1);
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return [136, 136, 136];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}


/* A 5x7 bitmap font, so the panels label themselves without an SVG text node
 * (the rasteriser below only understands polygons). */
const FONT: Record<string, string[]> = {
  ' ': ['.....','.....','.....','.....','.....','.....','.....'],
  '1': ['..#..','.##..','..#..','..#..','..#..','..#..','.###.'],
  '2': ['.###.','#...#','....#','...#.','..#..','.#...','#####'],
  '3': ['#####','...#.','..#..','...#.','....#','#...#','.###.'],
  '6': ['..##.','.#...','#....','####.','#...#','#...#','.###.'],
  '.': ['.....','.....','.....','.....','.....','.##..','.##..'],
  'A': ['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
  'C': ['.###.','#...#','#....','#....','#....','#...#','.###.'],
  'D': ['####.','#...#','#...#','#...#','#...#','#...#','####.'],
  'E': ['#####','#....','#....','####.','#....','#....','#####'],
  'F': ['#####','#....','#....','####.','#....','#....','#....'],
  'H': ['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
  'I': ['#####','..#..','..#..','..#..','..#..','..#..','#####'],
  'L': ['#....','#....','#....','#....','#....','#....','#####'],
  'O': ['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
  'S': ['.####','#....','#....','.###.','....#','....#','####.'],
  'W': ['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],
  'X': ['#...#','#...#','.#.#.','..#..','.#.#.','#...#','#...#'],
  'B': ['####.','#...#','#...#','####.','#...#','#...#','####.'],
  'G': ['.###.','#...#','#....','#.###','#...#','#...#','.###.'],
  'J': ['#####','....#','....#','....#','#...#','#...#','.###.'],
  'K': ['#...#','#..#.','#.#..','##...','#.#..','#..#.','#...#'],
  'M': ['#...#','##.##','#.#.#','#...#','#...#','#...#','#...#'],
  'N': ['#...#','##..#','#.#.#','#..##','#...#','#...#','#...#'],
  'P': ['####.','#...#','#...#','####.','#....','#....','#....'],
  'Q': ['.###.','#...#','#...#','#...#','#.#.#','#..#.','.##.#'],
  'R': ['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],
  'T': ['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
  'U': ['#...#','#...#','#...#','#...#','#...#','#...#','.###.'],
  'V': ['#...#','#...#','#...#','#...#','#...#','.#.#.','..#..'],
  'Y': ['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..'],
  'Z': ['#####','....#','...#.','..#..','.#...','#....','#####'],
  '0': ['.###.','#...#','#..##','#.#.#','##..#','#...#','.###.'],
  '4': ['...#.','..##.','.#.#.','#..#.','#####','...#.','...#.'],
  '5': ['#####','#....','####.','....#','....#','#...#','.###.'],
  '7': ['#####','....#','...#.','..#..','..#..','..#..','..#..'],
  '8': ['.###.','#...#','#...#','.###.','#...#','#...#','.###.'],
  '9': ['.###.','#...#','#...#','.####','....#','#...#','.###.'],
  '-': ['.....','.....','.....','#####','.....','.....','.....'],
  '/': ['....#','....#','...#.','..#..','.#...','#....','#....'],
  ':': ['.....','.##..','.##..','.....','.##..','.##..','.....'],
};
export function drawLabel(
  buf: Uint8Array, w: number, x0: number, y0: number, text: string, scale: number,
  colour = '#ffffff', plate = true,
) {
  // dark plate behind the text so it reads over any pitch colour
  const [tr, tg, tb] = parseHex(colour);
  const tw = text.length * 6 * scale, th = 9 * scale;
  if (plate) for (let y = y0 - 2; y < y0 + th; y++) for (let x = x0 - 2; x < x0 + tw; x++) {
    if (x < 0 || y < 0 || x >= w) continue;
    const o = (y * w + x) * 4;
    buf[o] = 8; buf[o + 1] = 8; buf[o + 2] = 8; buf[o + 3] = 255;
  }
  let cx = x0;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (g[r][c] !== '#') continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = cx + c * scale + dx, py = y0 + r * scale + dy;
        if (px < 0 || px >= w || py < 0) continue;
        const o = (py * w + px) * 4;
        buf[o] = tr; buf[o + 1] = tg; buf[o + 2] = tb; buf[o + 3] = 255;
      }
    }
    cx += 6 * scale;
  }
}

export interface TextOverlay { text: string; x: number; y: number; scale?: number; colour?: string }

export function rasterise(
  panelsIn: { name: string; polys: Poly[]; texts?: TextOverlay[] }[],
  path: string,
  V: { w: number; h: number },
) {
  const SS = 2;
  const W = V.w, H = V.h * panelsIn.length;
  const w = W * SS, h = H * SS;
  const buf = new Uint8Array(w * h * 4);
  // turf backdrop
  for (let i = 0; i < w * h; i++) { buf[i * 4] = 26; buf[i * 4 + 1] = 43; buf[i * 4 + 2] = 26; buf[i * 4 + 3] = 255; }

  panelsIn.forEach((panel, pi) => {
    const yOff = pi * V.h * SS;
    for (const p of panel.polys) {
      if (p.pts.length < 3) continue;
      const [r, g, b] = parseHex(p.fill);
      const a = Math.max(0, Math.min(1, p.alpha));
      let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (const q of p.pts) {
        if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
        if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
      }
      const py0 = Math.max(0, Math.floor(y0 * SS)), py1 = Math.min(h - 1, Math.ceil(y1 * SS));
      const px0 = Math.max(0, Math.floor(x0 * SS)), px1 = Math.min(w - 1, Math.ceil(x1 * SS));
      const xs: number[] = [];
      for (let py = py0; py <= py1; py++) {
        const sy = (py + 0.5) / SS;
        xs.length = 0;
        for (let i = 0, n = p.pts.length; i < n; i++) {
          const A = p.pts[i], B = p.pts[(i + 1) % n];
          if ((A[1] <= sy && B[1] > sy) || (B[1] <= sy && A[1] > sy)) {
            xs.push(A[0] + ((sy - A[1]) / (B[1] - A[1])) * (B[0] - A[0]));
          }
        }
        if (xs.length < 2) continue;
        xs.sort((m, n) => m - n);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const fx0 = Math.max(px0, Math.round(xs[k] * SS));
          const fx1 = Math.min(px1, Math.round(xs[k + 1] * SS) - 1);
          for (let px = fx0; px <= fx1; px++) {
            const o = ((py + yOff) * w + px) * 4;
            if (py + yOff >= h) continue;
            buf[o] = buf[o] + (r - buf[o]) * a;
            buf[o + 1] = buf[o + 1] + (g - buf[o + 1]) * a;
            buf[o + 2] = buf[o + 2] + (b - buf[o + 2]) * a;
          }
        }
      }
    }
  });

  panelsIn.forEach((panel, pi) => {
    drawLabel(buf, w, 8 * SS, (pi * V.h + 6) * SS, panel.name, 2);
    /* In-picture words — a speech bubble is the words, so the sheet has to be
     * able to draw them. */
    for (const t of panel.texts ?? []) {
      drawLabel(buf, w, t.x * SS, (pi * V.h + t.y) * SS, t.text, t.scale ?? 2, t.colour);
    }
  });

  // downsample SS -> 1 and emit
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    const rowStart = y * (1 + W * 4);
    raw[rowStart] = 0;
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const o = (((y * SS + dy) * w) + (x * SS + dx)) * 4;
        r += buf[o]; g += buf[o + 1]; b += buf[o + 2];
      }
      const n = SS * SS, o2 = rowStart + 1 + x * 4;
      raw[o2] = r / n; raw[o2 + 1] = g / n; raw[o2 + 2] = b / n; raw[o2 + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  console.log(`wrote ${path}  (${W}x${H}, ${(png.length / 1024).toFixed(0)} kB)`);
}

