/**
 * SPEC_14 INSTRUMENT — shared by spec14probe.ts (numbers) and spec14shot.ts
 * (pictures).
 *
 * A recording 2D context: every fill/stroke is reduced to a screen-space
 * bounding box under the current transform, so the numbers are the ink a real
 * canvas would have produced rather than an estimate from the build
 * parameters. It also captures the raw polygons on request, which is how the
 * shot script turns a real frame into an image without a canvas library.
 *
 * Lives in its own module so importing it does not run the whole probe.
 */
import type { Director } from '../src/game/director';
import { project, type Camera, type View } from '../src/render/retro';
import { POS_OF_NUM } from '../src/render/paper';

interface Op {
  style: string;
  x0: number; y0: number; x1: number; y1: number;
  cx?: number; cy?: number; rx?: number; ry?: number;
}

export class Rec {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
  private stack: number[][] = [];
  private path: number[][] = [];
  private lastEllipse: { cx: number; cy: number; rx: number; ry: number } | null = null;
  ops: Op[] = [];
  clips = 0;
  /** When set, the raw polygon for every fill is captured as well — used by
   *  spec14shot.ts to turn a real frame into an image. Off by default so the
   *  measurement pass stays cheap. */
  cap: { pts: number[][]; fill: string; alpha: number; isStroke: boolean }[] | null = null;

  fillStyle = ''; strokeStyle = ''; lineWidth = 1; globalAlpha = 1;
  lineJoin = ''; font = ''; textAlign = ''; textBaseline = '';

  save() { this.stack.push([this.a, this.b, this.c, this.d, this.e, this.f]); }
  restore() { const s = this.stack.pop(); if (s) [this.a, this.b, this.c, this.d, this.e, this.f] = s; }
  translate(x: number, y: number) { this.e += this.a * x + this.c * y; this.f += this.b * x + this.d * y; }
  scale(x: number, y: number) { this.a *= x; this.b *= x; this.c *= y; this.d *= y; }
  rotate(r: number) {
    const cs = Math.cos(r), sn = Math.sin(r);
    const a = this.a * cs + this.c * sn, b = this.b * cs + this.d * sn;
    const c = this.a * -sn + this.c * cs, d = this.b * -sn + this.d * cs;
    this.a = a; this.b = b; this.c = c; this.d = d;
  }
  private pt(x: number, y: number) { return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f]; }
  beginPath() { this.path = []; this.lastEllipse = null; }
  closePath() { }
  moveTo(x: number, y: number) { this.path.push(this.pt(x, y)); }
  lineTo(x: number, y: number) { this.path.push(this.pt(x, y)); }
  ellipse(x: number, y: number, rx: number, ry: number, rot = 0) {
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      const lx = rx * Math.cos(t), ly = ry * Math.sin(t);
      this.path.push(this.pt(x + lx * Math.cos(rot) - ly * Math.sin(rot), y + lx * Math.sin(rot) + ly * Math.cos(rot)));
    }
    const c = this.pt(x, y);
    this.lastEllipse = { cx: c[0], cy: c[1], rx, ry };
  }
  arc(x: number, y: number, r: number) {
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * Math.PI * 2;
      this.path.push(this.pt(x + r * Math.cos(t), y + r * Math.sin(t)));
    }
    const c = this.pt(x, y);
    this.lastEllipse = { cx: c[0], cy: c[1], rx: r, ry: r };
  }
  rect(x: number, y: number, w: number, h: number) {
    this.path.push(this.pt(x, y), this.pt(x + w, y), this.pt(x + w, y + h), this.pt(x, y + h));
  }
  fillRect(x: number, y: number, w: number, h: number) { this.beginPath(); this.rect(x, y, w, h); this.fill(); }
  clip() { this.clips++; }
  fillText() { } strokeText() { }

  private record(grow: number) {
    if (!this.path.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.path) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    this.ops.push({
      style: String(this.fillStyle),
      x0: x0 - grow, y0: y0 - grow, x1: x1 + grow, y1: y1 + grow,
      ...(this.lastEllipse ?? {}),
    });
    if (this.cap) this.cap.push({ pts: this.path.map((q) => [q[0], q[1]]), fill: String(this.fillStyle), alpha: this.globalAlpha, isStroke: grow > 0 });
  }
  fill() { this.record(0); }
  stroke() { this.record(this.lineWidth * 0.5); }

  asCtx(): CanvasRenderingContext2D {
    return new Proxy(this as unknown as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : () => { }),
      set: (t, k, v) => { t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  }
}

/** drawPaperShadow's fill colour — unique in the tree, so it marks the start
 *  of each actor's draw group. */
export const SHADOW_FILL = '#081008';

export interface Figure {
  sc: number; depth: number;
  inkW: number; inkH: number;
  widthM: number; heightFrac: number;
  gapY: number; gapX: number;
  ryOverRx: number; truthRyOverRx: number;   // drawn vs a real projected ground circle
  rxM: number;
  perp: number;                              // 0 = facing camera (widest), 1 = profile
  num: number; team: string; build: string;
}

export function pairFigures(rec: Rec, d: Director, cam: Camera, v: View): Figure[] {
  const out: Figure[] = [];
  const cr: [number, number] = [Math.cos(cam.yaw), -Math.sin(cam.yaw)];
  let i = 0;
  while (i < rec.ops.length) {
    const s = rec.ops[i];
    if (s.style !== SHADOW_FILL) { i++; continue; }

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    let j = i + 1;
    for (; j < rec.ops.length && rec.ops[j].style !== SHADOW_FILL; j++) {
      const o = rec.ops[j];
      // Skip anything of pitch/stadium scale — that ink belongs to the world,
      // not to this figure. A player card is never 400 px across at this rig.
      if (o.x1 - o.x0 > 400 || o.y1 - o.y0 > 400) continue;
      x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0);
      x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1);
      n++;
    }
    if (n === 0) { i = j; continue; }

    let best: { a: typeof d.actors[number]; sc: number; depth: number; dd: number } | null = null;
    for (const a of d.actors) {
      const pr = project(cam, v, a.rx, 0, a.rz);
      if (!pr) continue;
      const dd = Math.hypot(pr.sx - (s.cx ?? s.x0), pr.sy - (s.cy ?? s.y0));
      if (!best || dd < best.dd) best = { a, sc: pr.sc, depth: pr.f, dd };
    }
    if (!best || best.dd > 25) { i = j; continue; }

    const inkW = x1 - x0, inkH = y1 - y0;
    const widthM = inkW / best.sc;
    // Sanity: a human silhouette is 0.3-1.2 m wide and 1.4-2.2 m tall. Anything
    // outside that is a mis-pairing (a distant actor matched to near ink).
    if (!(widthM > 0.3 && widthM < 2.6) || !(inkH / best.sc > 1.3 && inkH / best.sc < 4.0)) { i = j; continue; }

    // Ground truth for the ellipse: project a real circle of the same radius
    // on the turf through the same lens and measure its screen bounding box.
    const rxM = (s.rx ?? 0) / best.sc;
    const a = best.a;
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity, hit = 0;
    for (let k = 0; k < 24; k++) {
      const t = (k / 24) * Math.PI * 2;
      const p = project(cam, v, a.rx + Math.cos(t) * rxM, 0, a.rz + Math.sin(t) * rxM);
      if (!p) continue;
      tx0 = Math.min(tx0, p.sx); tx1 = Math.max(tx1, p.sx);
      ty0 = Math.min(ty0, p.sy); ty1 = Math.max(ty1, p.sy);
      hit++;
    }
    const truth = hit === 24 && tx1 > tx0 ? (ty1 - ty0) / (tx1 - tx0) : 0;
    const fx = Math.sin(a.rf), fz = Math.cos(a.rf);

    out.push({
      sc: best.sc, depth: best.depth, inkW, inkH, widthM,
      heightFrac: inkH / v.h,
      gapY: (s.cy ?? 0) - y1,
      gapX: (s.cx ?? 0) - (x0 + x1) / 2,
      ryOverRx: s.ry && s.rx ? s.ry / s.rx : 0,
      truthRyOverRx: truth,
      rxM,
      perp: Math.abs(fx * cr[0] + fz * cr[1]),
      num: a.num, team: a.team, build: a.team === 'REF' ? 'REF' : POS_OF_NUM[a.num],
    });
    i = j;
  }
  return out;
}

/* ------------------------------------------------------------------ */
