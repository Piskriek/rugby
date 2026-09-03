import { Pose } from './clips';

/**
 * PAPERCRAFT MATERIAL LIBRARY + CHARACTER DATASET
 * ------------------------------------------------
 * Every actor in this game is a flat paper cut-out standing inside a 3D stadium.
 * This module owns:
 *   - the paper material painters (card stock backing, cut-edge highlight, creases,
 *     fold tabs, hand-cut jitter)
 *   - the per-actor PAPER VIEW hysteresis store: which artwork side of the cut-out
 *     faces the camera ('front' | 'back' | 'leftEdge' | 'rightEdge' | lying variants)
 *   - the PAPERCRAFT CHARACTER DATASET: body builds per position group + named squads
 *   - the paper ball painter
 *
 * The paper never becomes a volumetric human: everything here draws flat cards with
 * hard outlines and a visible card-stock thickness.
 */

export const PIX = '#16161d';
export const OUT = '#20202b';
/** card-stock backing colour (the cut edge of the paper sheet) */
export const STOCK = '#101018';
/** cut-edge highlight (light catching the sliced paper rim) */
export const CUT = 'rgba(255,248,225,0.55)';

export const DISPLAY = '"Archivo Black", "Arial Black", sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export const SKINS = ['#e8b98f', '#c99468', '#8c5a38', '#5f3a22', '#f2cfa8'];
export const HAIRS = ['#2a1c14', '#5a3a1e', '#8a6a2e', '#1a1a1a', '#c9c2b0', '#7a3a1e'];

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export interface Palette { kit: string; kitDark: string; kitLight: string; trim: string; shorts: string; socks: string }

export const PALETTES: Record<string, Palette> = {
  A: { kit: '#c8402f', kitDark: '#8f281c', kitLight: '#e2664f', trim: '#f6e7c4', shorts: '#f0ece0', socks: '#c8402f' },
  B: { kit: '#2f4f9c', kitDark: '#1d3468', kitLight: '#5a7bc4', trim: '#e2dcc6', shorts: '#e8e4d6', socks: '#2f4f9c' },
  REF: { kit: '#e8cf46', kitDark: '#b39f27', kitLight: '#f5e479', trim: '#24242e', shorts: '#23232c', socks: '#e8cf46' },
};

/* ------------------------------------------------------------------ */
/* PAPER VIEW — per-actor, hysteretic                                  */
/* ------------------------------------------------------------------ */

export type PaperView = 'front' | 'back' | 'leftEdge' | 'rightEdge' | 'lieFaceUp' | 'lieFaceDown';

export const isEdge = (v: PaperView) => v === 'leftEdge' || v === 'rightEdge';
export const isLying = (v: PaperView) => v === 'lieFaceUp' || v === 'lieFaceDown';

/**
 * Thresholds (degrees between actor facing and the actor->camera vector):
 *   end-on zone   : 0..35   -> front / back artwork
 *   dead zone     : 35..55  -> keep whatever the actor currently shows
 *   edge zone     : 55..125 -> true profile card
 *   dead zone     : 125..145-> keep
 *   back zone     : 145..180-> back artwork with shirt number
 * Hysteresis: an actor only leaves its current zone when the angle crosses the
 * OUTER bound of the neighbouring zone, so views never thrash at the boundary.
 */
const END_ON = 35;
const EDGE_IN = 55;
const EDGE_OUT = 125;
const BACK_IN = 145;

const viewStore = new Map<string, PaperView>();
export function resetPaperViews() { viewStore.clear(); }
export function paperViewKey(team: string, num: number) { return `${team}${num}`; }

/**
 * Actor-relative paper view selection.
 * @param fx,fz  actor facing unit vector (world xz). Falls back to a.rf upstream.
 * @param ax,az  actor world position
 * @param camX,camZ camera world position
 */
export function updatePaperView(key: string, fx: number, fz: number, ax: number, az: number, camX: number, camZ: number): PaperView {
  let tx = camX - ax, tz = camZ - az;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-4) { tx = 0; tz = 1; } else { tx /= tl; tz /= tl; }
  const d = Math.min(1, Math.max(-1, fx * tx + fz * tz));
  const ang = Math.acos(d) * 180 / Math.PI;
  // signed side: negative => camera sits on the actor's right hand side
  const cross = fx * tz - fz * tx;
  const side: PaperView = cross < 0 ? 'rightEdge' : 'leftEdge';
  const cur = viewStore.get(key) ?? 'front';
  let next = cur;
  if (isLying(cur)) next = cur; // lying is driven by the sim, not by angles
  else if (cur === 'front') {
    if (ang > EDGE_IN) next = side;
  } else if (cur === 'back') {
    if (ang < EDGE_OUT) next = side;
  } else {
    // currently showing an edge
    if (ang < END_ON) next = 'front';
    else if (ang > BACK_IN) next = 'back';
    else if (Math.abs(cross) > 0.25) next = side; // side flip only out of the dead band
  }
  viewStore.set(key, next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Low-level painters                                                  */
/* ------------------------------------------------------------------ */

export type Ctx = CanvasRenderingContext2D;
export type Pt = [number, number];

function jit(seed: number, i: number, amp: number): [number, number] {
  const a = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  const b = Math.sin(seed * 269.5 + i * 183.3) * 28001.8384;
  return [(a - Math.floor(a) - 0.5) * 2 * amp, (b - Math.floor(b) - 0.5) * 2 * amp];
}

export function poly(ctx: Ctx, pts: Pt[], fill: string, stroke?: string, lw = 3) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

export interface CardOpts {
  lw?: number;
  out?: string;
  /** card-stock thickness offset in px */
  back?: number;
  seed?: number;
  /** hand-cut corner jitter in px */
  jit?: number;
  /** cut-edge highlight strength 0..1 */
  cut?: number;
}

/** A flat paper card: backing thickness, flat cel fill, cut rim, hard outline. */
export function paperCard(ctx: Ctx, pts: Pt[], fill: string, o: CardOpts = {}) {
  const lw = o.lw ?? 2.4;
  const seed = o.seed ?? 1;
  const amp = o.jit ?? 0.5;
  const P: Pt[] = pts.map((p, i) => {
    const [jx, jy] = jit(seed, i, amp);
    return [p[0] + jx, p[1] + jy];
  });
  const back = o.back ?? 1.4;
  if (back > 0.05) {
    ctx.beginPath();
    ctx.moveTo(P[0][0] + back, P[0][1] + back * 0.8);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0] + back, P[i][1] + back * 0.8);
    ctx.closePath();
    ctx.fillStyle = STOCK; ctx.fill();
  }
  poly(ctx, P, fill);
  const cut = o.cut ?? 0.5;
  if (cut > 0.02 && P.length > 1) {
    ctx.save();
    ctx.globalAlpha = cut * 0.5;
    ctx.strokeStyle = CUT;
    ctx.lineWidth = Math.max(0.8, lw * 0.42);
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    ctx.lineTo(P[1][0], P[1][1]);
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = o.out ?? OUT;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
  ctx.closePath();
  ctx.stroke();
}

/** Small trapezoid fold tab — the papercraft joint hint. */
export function foldTab(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, lw: number) {
  poly(ctx, [[x - w * 0.5, y], [x + w * 0.5, y], [x + w * 0.32, y + h], [x - w * 0.32, y + h]], fill, OUT, lw * 0.8);
}

/** Vertical/horizontal fold crease on a card. */
export function crease(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, alpha: number, lw = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.restore();
}

export function shadowBlob(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#0a120a';
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The paper ball: prolate card with two-tone cel shading, seam, laces and a
 * sliced-paper rim. `spin` rotates the whole card.
 */
export function ballPaper(ctx: Ctx, x: number, y: number, r: number, spin: number) {
  if (r < 0.4) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  const w = r * 1.5, h = r;
  // card-stock backing
  ctx.save();
  ctx.translate(1.2, 1);
  ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  ctx.fillStyle = STOCK; ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f3ede0'; ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(140,110,70,0.28)';
  ctx.fillRect(-w, 0, w * 2, h);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.ellipse(-w * 0.25, -h * 0.42, w * 0.5, h * 0.3, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(1.4, r * 0.24); ctx.strokeStyle = OUT; ctx.stroke();
  // seam + laces
  ctx.strokeStyle = '#b8562f';
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath(); ctx.moveTo(-w * 0.72, 0); ctx.lineTo(w * 0.72, 0); ctx.stroke();
  ctx.strokeStyle = '#3b3b46';
  ctx.lineWidth = Math.max(0.9, r * 0.14);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * w * 0.28, -h * 0.26);
    ctx.lineTo(i * w * 0.28, h * 0.26);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* PAPERCRAFT CHARACTER DATASET                                        */
/* ------------------------------------------------------------------ */

export interface Build {
  /** standing height (m) */
  h: number;
  /** shoulder span (m) */
  shW: number;
  hipW: number;
  /** hip->shoulder card length (m) */
  torso: number;
  /** full leg length (m) */
  leg: number;
  /** full arm length (m) */
  arm: number;
  headR: number;
  /** cardstock bulk multiplier */
  bulk: number;
}

export const BUILDS: Record<string, Build> = {
  PROP:    { h: 1.86, shW: 0.58, hipW: 0.46, torso: 0.60, leg: 0.90, arm: 0.60, headR: 0.145, bulk: 1.28 },
  HOOK:    { h: 1.81, shW: 0.54, hipW: 0.43, torso: 0.59, leg: 0.92, arm: 0.60, headR: 0.140, bulk: 1.18 },
  LOCK:    { h: 1.98, shW: 0.53, hipW: 0.40, torso: 0.66, leg: 1.02, arm: 0.66, headR: 0.140, bulk: 1.10 },
  BACKROW: { h: 1.93, shW: 0.54, hipW: 0.41, torso: 0.64, leg: 0.98, arm: 0.64, headR: 0.142, bulk: 1.14 },
  HALF:    { h: 1.76, shW: 0.45, hipW: 0.36, torso: 0.56, leg: 0.90, arm: 0.58, headR: 0.135, bulk: 0.92 },
  FLY:     { h: 1.83, shW: 0.47, hipW: 0.37, torso: 0.59, leg: 0.94, arm: 0.60, headR: 0.136, bulk: 0.96 },
  CENTRE:  { h: 1.89, shW: 0.51, hipW: 0.39, torso: 0.62, leg: 0.96, arm: 0.62, headR: 0.140, bulk: 1.06 },
  WING:    { h: 1.84, shW: 0.47, hipW: 0.36, torso: 0.60, leg: 0.99, arm: 0.61, headR: 0.135, bulk: 0.94 },
  FULL:    { h: 1.87, shW: 0.49, hipW: 0.38, torso: 0.61, leg: 0.97, arm: 0.62, headR: 0.137, bulk: 1.00 },
  REF:     { h: 1.84, shW: 0.48, hipW: 0.38, torso: 0.60, leg: 0.95, arm: 0.61, headR: 0.138, bulk: 1.00 },
};

export const POS_OF_NUM: Record<number, keyof typeof BUILDS> = {
  1: 'PROP', 2: 'HOOK', 3: 'PROP', 4: 'LOCK', 5: 'LOCK', 6: 'BACKROW', 7: 'BACKROW', 8: 'BACKROW',
  9: 'HALF', 10: 'FLY', 11: 'WING', 12: 'CENTRE', 13: 'CENTRE', 14: 'WING', 15: 'FULL',
};

export const POS_LABEL: Record<string, string> = {
  PROP: 'LOOSEHEAD / TIGHTHEAD PROP', HOOK: 'HOOKER', LOCK: 'LOCK', BACKROW: 'BACK ROW',
  HALF: 'SCRUM HALF', FLY: 'FLY HALF', CENTRE: 'CENTRE', WING: 'WING', FULL: 'FULL BACK', REF: 'MATCH OFFICIAL',
};

export interface Character {
  num: number; name: string; pos: keyof typeof BUILDS; build: Build;
  skin: string; hair: string; cap: boolean; tape: boolean;
}

const NAMES: Record<'A' | 'B', string[]> = {
  A: ['OWEN', 'HART', 'PRICE', 'STONE', 'ROOK', 'MARSH', 'VICKERS', 'DAWES', 'HILL', 'FAIR', 'COLE', 'BRANN', 'MOSS', 'QUICK', 'FULLER'],
  B: ['TAMA', 'RETI', 'POKE', 'MANU', 'TOLO', 'KAPA', 'RIKI', 'HEMI', 'PERE', 'KINGI', 'RANGI', 'NGATA', 'MOANA', 'WIKI', 'TOKA'],
};

function hash01(n: number) { const x = Math.sin(n * 91.7) * 43758.5453; return x - Math.floor(x); }

export function makeCharacter(team: 'A' | 'B', num: number): Character {
  const pos = POS_OF_NUM[num];
  const s = hash01(team === 'A' ? num * 3.1 : num * 7.7 + 40);
  const s2 = hash01(num * 13.3 + (team === 'A' ? 5 : 90));
  return {
    num, name: NAMES[team][num - 1], pos, build: BUILDS[pos],
    skin: SKINS[Math.floor(s * SKINS.length) % SKINS.length],
    hair: HAIRS[Math.floor(s2 * HAIRS.length) % HAIRS.length],
    cap: s2 > 0.78, tape: s > 0.72,
  };
}

export function makeRef(): Character {
  return { num: 0, name: 'WAYNE', pos: 'REF', build: BUILDS.REF, skin: SKINS[1], hair: HAIRS[3], cap: false, tape: false };
}

/* ================================================================== */
/* XL ANIMATION RECONCILIATION — effect helpers (SPEC_01)               */
/* ------------------------------------------------------------------ */
/* These are the four dataset demands ported onto the papercraft        */
/* pipeline. Core logic lives here (the permitted file); the frozen     */
/* drawer in coronal.ts only consumes the optional PaperDrawArgs fields  */
/* (squash, legScale) and the Pose returned by pinPlantedFoot /         */
/* upperLowerRun. See IMPLEMENT_XL_ANIMATION.md.                        */
/* ================================================================== */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/* ---- 1. IMPACT SQUASH (P-01 / C-01 / W-06 / T-04 / S-06 / PR-02) ----
 * A 2D paper sheet: the impact frame compresses vertically and bulges
 * horizontally (volume conserved), applied about the foot anchor in the
 * drawer. `kind` bands the magnitude; `impactU` is the clip's impact frame
 * in normalised clip time (see CLIPS table: tackleHit drive ~0.45,
 * diveFront landing ~0.92, ruckCommit/scrumShove shove ~0.5–0.7). */
const SQUASH_MAG: Record<string, number> = { tackle: 0.09, dive: 0.08, cleanout: 0.06, scrum: 0.10 };
const SQUASH_IMPACT: Record<string, [string, number]> = {
  tackleHit: ['tackle', 0.45],
  diveFront: ['dive', 0.92],
  ruckCommit: ['cleanout', 0.5],
  scrumShove: ['scrum', 0.5],
  scrumBind: ['scrum', 0.72],
};

export function impactSquash(kind: string, u: number, impactU = 0.5): { sx: number; sy: number } {
  const uu = clamp01(u);
  const d = Math.abs(uu - impactU);
  const w = 0.12;                       // ~5–6 frames of contact at 60 fps
  if (d >= w) return { sx: 1, sy: 1 };
  const t = 1 - d / w;
  const env = t * t * (3 - 2 * t);      // smoothstep: spike then recover
  const k = (SQUASH_MAG[kind] ?? 0.08) * env;
  return { sx: 1 + k * 0.6, sy: 1 - k };
}

/** Map an engine clip name + its progress to a squash transform, or undefined. */
export function squashForClip(clipName: string, u: number): { sx: number; sy: number } | undefined {
  const m = SQUASH_IMPACT[clipName];
  if (!m) return undefined;
  return impactSquash(m[0], u, m[1]);
}

/* ---- 4. EDGE LEG FORESHORTENING (B-14 / D-04 / E-04) ----
 * Standing legs shorten toward the viewport edges (perp → 1) and under a
 * steep camera tilt, simulating depth. Clamped so a figure never "lies
 * down" — the lying artwork stays the only true 0-height state. */
export function edgeLegForeshorten(perp: number, camTiltDeg: number): number {
  const edge = 1 - 0.38 * clamp01(perp);
  const tilt = clampN(camTiltDeg, 0, 80) * Math.PI / 180;
  const tiltF = 0.78 + 0.22 * Math.cos(tilt);
  return clampN(edge * tiltF, 0.6, 1);
}

/* ---- 2. NO-FOOT-SLIDE (SM-02 / W-07 / B-04) ----
 * Pose-level correction (zero drawer change): pin the planted foot to the
 * ground by nudging the hip so the lower (stance) foot meets y = 0. The
 * cadence lock (T-29 / S-06) already keeps feet tracking turf; this just
 * guarantees the contact foot does not float as the hip bobs. */
export function pinPlantedFoot(pose: Pose, build: Build, speed = 1): Pose {
  if (speed < 0.7) return pose;
  const thigh = build.leg * 0.52, shin = build.leg * 0.48;
  const hy = pose.hip - 0.02;
  const fyL = hy - Math.cos(pose.lL) * thigh - Math.cos(pose.lL - pose.kL) * shin;
  const fyR = hy - Math.cos(pose.lR) * thigh - Math.cos(pose.lR - pose.kR) * shin;
  const stance = Math.min(fyL, fyR);
  if (stance >= -0.005) return pose;          // already grounded
  const corr = Math.min(0.06, -stance);        // raise hip so the foot meets the turf
  return { ...pose, hip: pose.hip + corr };
}

/* ---- 3. RUNNING PASS upper/lower separation (R-03 / SM-13 / PR-04) ----
 * Keep the LOWER body on the run cycle (legs drive) while the UPPER body
 * plays the pass clip (arms sweep, hips open, head leads). Returns a Pose
 * the frozen drawer already renders — no drawer change required. */
const UPPER_CH: (keyof Pose)[] = ['aL', 'aR', 'abL', 'abR', 'eL', 'eR', 'headP', 'headY', 'twist'];

export function upperLowerRun(lower: Pose, upper: Pose): Pose {
  const o: Pose = { ...lower };
  for (const ch of UPPER_CH) o[ch] = upper[ch];
  return o;
}
