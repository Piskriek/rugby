/**
 * SPEC_14 SIGN-OFF SHEET — renders real frames to PNG so the scale and the
 * shadow can be judged by eye, not only by number.
 *
 * Usage:  npx vite-node scripts/spec14shot.ts
 *
 * Renders one open-play frame three ways:
 *
 *   1. AS IS        — exactly what the game draws today.
 *   2. SHADOW FIXED — the shadow ellipse rewritten post-hoc: minor axis taken
 *                     from a real circle projected on the turf (ry = rx·truth)
 *                     and centred on the projected ground point, instead of the
 *                     hard-coded ry = 0.30·rx and the screen-space nudge.
 *   3. SCALE k      — every actor's polygons scaled about its own ground point
 *                     by the multiplier the probe derived.
 *
 * Panels 2 and 3 are produced by rewriting the recorded draw list. No game
 * file is modified: this is a proposal rendered as an image, not a change.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { drawMatch } from '../src/render/scene';
import { project, type Camera, type View } from '../src/render/retro';
import { Rec } from './spec14rec';
import { FIGURE_SCALE } from '../src/render/paper';
import { writeFileSync } from 'node:fs';

const V: View = { w: 720, h: 420 };
const SHADOW = '#081008';

/** Pull a frame: run to open play, then put the lens close behind the ball. */
function grab(secondsToRun: number) {
  seedRng(4);
  const d = new Director(gateConfig(3));
  for (let i = 0; i < secondsToRun * 60 && !d.over; i++) d.update(1 / 60, NO_INPUT, new Set());
  // open play is not guaranteed on the final frame — step on until it is
  for (let i = 0; i < 3600 && !d.op && !d.over; i++) d.update(1 / 60, NO_INPUT, new Set());
  const op = d.op;
  if (!op) throw new Error('no open play to photograph');
  const car = d.L(op.attacking, op.carrierNum);
  const dir = op.dir;
  const cam: Camera = {
    x: car.x * 0.6,
    z: car.z - dir * 13,
    h: 6.5,
    yaw: Math.atan2(car.x - car.x * 0.6, car.z - (car.z - dir * 13)),
    tilt: 0.36,
    fov: 0.62,
    shake: 0, horizon: 0.5, roll: 0,
  };
  d.cam = cam;
  const rec = new Rec();
  rec.cap = [];
  drawMatch(rec.asCtx(), d, V);
  // discard the first frame's camera easing artefacts by drawing once more
  const rec2 = new Rec();
  rec2.cap = [];
  drawMatch(rec2.asCtx(), d, V);
  return { d, cam, cap: rec2.cap! };
}

type Poly = { pts: number[][]; fill: string; alpha: number; isStroke: boolean };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const col = (s: string) => (/^#[0-9a-fA-F]{3,8}$/.test(s) ? s : '#888888');

function svg(title: string, polys: Poly[]): string {
  const body = polys.map((p) => {
    if (p.pts.length < 2) return '';
    const pts = p.pts.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
    const op = p.alpha < 1 ? ` fill-opacity="${p.alpha.toFixed(2)}"` : '';
    return `<polygon points="${pts}" fill="${col(p.fill)}"${op}/>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${V.w}" height="${V.h}" viewBox="0 0 ${V.w} ${V.h}">
<rect width="${V.w}" height="${V.h}" fill="#1a2b1a"/>
${body}
<text x="8" y="16" font-family="monospace" font-size="13" fill="#ffffff">${esc(title)}</text>
</svg>`;
}

/** Rebuild the shadow ellipses from real projected geometry. */
function fixShadows(d: Director, cam: Camera, cap: Poly[]) {
  const out = cap.map((p) => ({ ...p }));
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (p.fill !== SHADOW) continue;
    // the recorded ellipse: centre = mean of its points
    let cx = 0, cy = 0;
    for (const q of p.pts) { cx += q[0]; cy += q[1]; }
    cx /= p.pts.length; cy /= p.pts.length;
    let rx = 0;
    for (const q of p.pts) rx = Math.max(rx, Math.abs(q[0] - cx));
    // which actor? nearest ground projection
    let best: { a: typeof d.actors[number]; sc: number; sx: number; sy: number; dd: number } | null = null;
    for (const a of d.actors) {
      const pr = project(cam, V, a.rx, 0, a.rz);
      if (!pr) continue;
      const dd = Math.hypot(pr.sx - cx, pr.sy - cy);
      if (!best || dd < best.dd) best = { a, sc: pr.sc, sx: pr.sx, sy: pr.sy, dd };
    }
    if (!best || best.dd > 30) continue;
    const rxM = rx / best.sc;
    // project a real circle of that radius on the turf through the same lens
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity, hit = 0;
    for (let k = 0; k < 32; k++) {
      const t = (k / 32) * Math.PI * 2;
      const q = project(cam, V, best.a.rx + Math.cos(t) * rxM, 0, best.a.rz + Math.sin(t) * rxM);
      if (!q) continue;
      y0 = Math.min(y0, q.sy); y1 = Math.max(y1, q.sy);
      x0 = Math.min(x0, q.sx); x1 = Math.max(x1, q.sx);
      hit++;
    }
    if (hit < 32) continue;
    const truthRx = (x1 - x0) / 2, truthRy = (y1 - y0) / 2;
    // rebuild the ellipse at the true ground point, with the true minor axis
    const pts: number[][] = [];
    for (let k = 0; k < 32; k++) {
      const t = (k / 32) * Math.PI * 2;
      pts.push([best.sx + Math.cos(t) * truthRx, best.sy + Math.sin(t) * truthRy]);
    }
    out[i] = { pts, fill: SHADOW, alpha: p.alpha, isStroke: false };
  }
  return out;
}

/** Rebuild the shadows with the PRE-SPEC_14 geometry for the before/after
 *  sheet: ry hard-coded to 0.30*rx, anchored at the root with a screen-space
 *  nudge, and no figure scale. Reconstructed from the current ellipse so the
 *  size and air term match; only the shape and the anchor differ. */
function oldShadows(d: Director, cam: Camera, cap: Poly[]) {
  const out = cap.map((p) => ({ ...p }));
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (p.fill !== SHADOW) continue;
    let cx = 0, cy = 0;
    for (const q of p.pts) { cx += q[0]; cy += q[1]; }
    cx /= p.pts.length; cy /= p.pts.length;
    let rx = 0;
    for (const q of p.pts) rx = Math.max(rx, Math.abs(q[0] - cx));
    let best: { sc: number; sx: number; sy: number; dd: number } | null = null;
    for (const a of d.actors) {
      const pr = project(cam, V, a.rx, 0, a.rz);
      if (!pr) continue;
      const dd = Math.hypot(pr.sx - cx, pr.sy - cy);
      if (!best || dd < best.dd) best = { sc: pr.sc, sx: pr.sx, sy: pr.sy, dd };
    }
    if (!best || best.dd > 30) continue;
    const oldRx = rx / FIGURE_SCALE;                 // undo the figure scale
    const pts: number[][] = [];
    for (let k = 0; k < 32; k++) {
      const t = (k / 32) * Math.PI * 2;
      pts.push([best.sx + best.sc * 0.06 + Math.cos(t) * oldRx, best.sy + best.sc * 0.02 + Math.sin(t) * oldRx * 0.30]);
    }
    out[i] = { pts, fill: SHADOW, alpha: p.alpha, isStroke: false };
  }
  return out;
}

/** Scale every actor's ink about its own ground point. */
function scaleActors(d: Director, cam: Camera, cap: Poly[], k: number, fixShadow: boolean) {
  const base = fixShadow ? fixShadows(d, cam, cap) : cap.map((p) => ({ ...p }));
  // group: shadow op starts each actor; its ops follow until the next shadow
  const anchors: { i: number; sx: number; sy: number }[] = [];
  for (let i = 0; i < base.length; i++) {
    if (base[i].fill !== SHADOW) continue;
    let cx = 0, cy = 0;
    for (const q of base[i].pts) { cx += q[0]; cy += q[1]; }
    cx /= base[i].pts.length; cy /= base[i].pts.length;
    let best: { a: typeof d.actors[number]; sx: number; sy: number; dd: number } | null = null;
    for (const a of d.actors) {
      const pr = project(cam, V, a.rx, 0, a.rz);
      if (!pr) continue;
      const dd = Math.hypot(pr.sx - cx, pr.sy - cy);
      if (!best || dd < best.dd) best = { a, sx: pr.sx, sy: pr.sy, dd };
    }
    if (best && best.dd <= 30) anchors.push({ i, sx: best.sx, sy: best.sy });
  }
  for (let g = 0; g < anchors.length; g++) {
    const a = anchors[g];
    const end = g + 1 < anchors.length ? anchors[g + 1].i : base.length;
    for (let i = a.i + 1; i < end; i++) {          // leave the shadow itself alone
      base[i] = {
        ...base[i],
        pts: base[i].pts.map((q) => [a.sx + (q[0] - a.sx) * k, a.sy + (q[1] - a.sy) * k]),
      };
    }
  }
  return base;
}

/* ------------------------------------------------------------------ */

const { d, cam, cap } = grab(40);
console.log(`captured ${cap.length} polygons, camera tilt ${cam.tilt}, h ${cam.h}`);

const BEFORE = scaleActors(d, cam, oldShadows(d, cam, cap), 1 / FIGURE_SCALE, false);
const panels: { name: string; polys: Poly[] }[] = [
  { name: 'BEFORE  1X FIGURE  OLD SHADOW', polys: BEFORE },
  { name: 'AFTER  1.65X FIGURE  NEW SHADOW', polys: cap },
];

for (const p of panels) {
  const f = `/tmp/s14_${p.name.split(' ')[0]}.svg`;
  writeFileSync(f, svg(p.name, p.polys));
  console.log(`wrote ${f}`);
}

/* one tall stack, all three panels, for a single comparison image */
const stacked = `<svg xmlns="http://www.w3.org/2000/svg" width="${V.w}" height="${V.h * 3}" viewBox="0 0 ${V.w} ${V.h * 3}">
${panels.map((p, i) => `<g transform="translate(0 ${i * V.h})">
<rect width="${V.w}" height="${V.h}" fill="#1a2b1a"/>
${p.polys.map((q) => q.pts.length < 2 ? '' : `<polygon points="${q.pts.map((a) => `${a[0].toFixed(1)},${a[1].toFixed(1)}`).join(' ')}" fill="${col(q.fill)}"${q.alpha < 1 ? ` fill-opacity="${q.alpha.toFixed(2)}"` : ''}/>`).join('\n')}
<text x="8" y="16" font-family="monospace" font-size="13" fill="#ffffff">${esc(p.name)}</text>
</g>`).join('\n')}
</svg>`;
writeFileSync('/tmp/s14_stack.svg', stacked);
console.log('wrote /tmp/s14_stack.svg');

/* ------------------------------------------------------------------ *
 * PNG OUT. No SVG rasteriser is available in this container (ImageMagick
 * delegates to a missing rsvg-convert), so rasterise the recorded polygons
 * directly: scanline fill into an RGBA buffer, 2x supersampled, then a
 * hand-rolled PNG encoder on top of node:zlib.
 * ------------------------------------------------------------------ */
import { deflateSync } from 'node:zlib';

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
function parseHex(c: string): [number, number, number] {
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
};
function drawLabel(buf: Uint8Array, w: number, x0: number, y0: number, text: string, scale: number) {
  // dark plate behind the text so it reads over any pitch colour
  const tw = text.length * 6 * scale, th = 9 * scale;
  for (let y = y0 - 2; y < y0 + th; y++) for (let x = x0 - 2; x < x0 + tw; x++) {
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
        buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = 255;
      }
    }
    cx += 6 * scale;
  }
}

function rasterise(panelsIn: { name: string; polys: Poly[] }[], path: string) {
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

rasterise(panels, 'spec14_panels.png');

/* ---- A SECOND SHEET: the same frame, cropped to one player and blown up,
 * as-is against shadow-fixed. The shadow is a few pixels tall at game scale;
 * this is the only way to judge it by eye. ---- */
const opNow = d.op!;
const car = d.L(opNow.attacking, opNow.carrierNum);
const cg = project(cam, V, car.x, 0, car.z);
if (cg) {
  const CW = 120, CH = 70, Z = 6;
  const ox = cg.sx - CW / 2, oy = cg.sy - CH * 0.72;
  const zoom = (polys: Poly[]): Poly[] => polys.map((q) => ({
    ...q, pts: q.pts.map((a) => [(a[0] - ox) * Z, (a[1] - oy) * Z]),
  }));
  rasterise([
    { name: 'ZOOM BEFORE', polys: zoom(BEFORE) },
    { name: 'ZOOM AFTER', polys: zoom(cap) },
  ], 'spec14_shadow_zoom.png');
  console.log(`zoomed on the carrier at screen ${cg.sx.toFixed(0)},${cg.sy.toFixed(0)} (${(cg.sc).toFixed(1)} px/m)`);
}
