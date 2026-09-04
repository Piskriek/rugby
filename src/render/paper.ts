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
/* SPEC_06 — Machine 2 hardening. The edge-side mirror flip used a single-frame
 * |cross| > 0.25 check, so an actor side-on to the camera mirrored (leftEdge ↔
 * rightEdge) as the camera tracked across their right/left hand. The threshold
 * is widened AND the flip is debounced: the opposing side must persist for
 * EDGE_FLIP_DEBOUNCE (0.08 s) before it commits. */
const EDGE_SIDE_GATE = 0.45;
const EDGE_FLIP_DEBOUNCE = 0.08;

interface ViewState { view: PaperView; sideCandidate: PaperView | null; sideT: number; }
const viewStore = new Map<string, ViewState>();
export function resetPaperViews() { viewStore.clear(); }
export function paperViewKey(team: string, num: number) { return `${team}${num}`; }

/** Clear any pending side-flip candidate (used when we change view zone). */
function clearSideFlip(st: ViewState): void {
  st.sideCandidate = null;
  st.sideT = 0;
}

/**
 * Actor-relative paper view selection.
 * @param fx,fz  actor facing unit vector (world xz). Falls back to a.rf upstream.
 * @param ax,az  actor world position
 * @param camX,camZ camera world position
 * @param dt     frame delta (s) for the edge-side flip debounce, 0 disables it.
 */
export function updatePaperView(key: string, fx: number, fz: number, ax: number, az: number, camX: number, camZ: number, dt = 0): PaperView {
  let tx = camX - ax, tz = camZ - az;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-4) { tx = 0; tz = 1; } else { tx /= tl; tz /= tl; }
  const d = Math.min(1, Math.max(-1, fx * tx + fz * tz));
  const ang = Math.acos(d) * 180 / Math.PI;
  // signed side: negative => camera sits on the actor's right hand side
  const cross = fx * tz - fz * tx;
  const side: PaperView = cross < 0 ? 'rightEdge' : 'leftEdge';
  const st = viewStore.get(key) ?? { view: 'front', sideCandidate: null, sideT: 0 };
  const cur = st.view;
  let next = cur;
  if (isLying(cur)) {
    next = cur; // lying is driven by the sim, not by angles
  } else if (cur === 'front') {
    clearSideFlip(st);
    if (ang > EDGE_IN) next = side;
  } else if (cur === 'back') {
    clearSideFlip(st);
    if (ang < EDGE_OUT) next = side;
  } else {
    // currently showing an edge
    if (ang < END_ON) {
      clearSideFlip(st); next = 'front';
    } else if (ang > BACK_IN) {
      clearSideFlip(st); next = 'back';
    } else {
      // edge-side mirror flip: raised |cross| gate + time retention
      if (Math.abs(cross) > EDGE_SIDE_GATE) {
        if (side === cur) {
          clearSideFlip(st);         // already showing the correct side
        } else if (st.sideCandidate === side) {
          st.sideT += dt;            // the opposing side persists — accumulate
          if (st.sideT >= EDGE_FLIP_DEBOUNCE) { next = side; clearSideFlip(st); }
        } else {
          st.sideCandidate = side;   // first frame of the opposing side
          st.sideT = dt;
        }
      } else {
        clearSideFlip(st);           // in the side dead band — hold current edge
      }
    }
  }
  st.view = next;
  viewStore.set(key, st);
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
  /**
   * SPEC_18.2 — corner radius in PIXELS. When > 0 the card is rounded by
   * stroking the path in its own fill colour with round joins/caps, instead of
   * carrying a hard contrast outline. No beziers: Canvas does the arcs.
   */
  round?: number;
}

/* ================================================================== */
/* SPEC_18.1 — DEPTH SHADING (the outline replacement)                 */
/* ------------------------------------------------------------------ */
/* Removing the hard stroke removes the ONLY thing separating two      */
/* limbs that share a fill. Measured contrast for limb-vs-limb and     */
/* kit-vs-socks is exactly 1.00 — the same colour on both sides of the */
/* edge. Depth shading replaces that edge with a VALUE STEP driven by  */
/* the same per-limb depth the SPEC_17 Z-sort already computes, so the */
/* shading can never disagree with the draw order.                     */
/*                                                                     */
/* Measured back-vs-front contrast with the ruled 0.70/1.14 pair:      */
/*   palette A 2.11   palette B 1.78   palette REF 2.62                */
/* all clear of the ~1.25 where a value step stops reading small.      */
/* ================================================================== */

/** Torso reference value. Limbs sit slightly under it so they read as limbs. */
export const LIMB_MID = 0.92;
/** Half-span of the limb value range: 0.92 -/+ 0.22 = 0.70 .. 1.14 (ruled). */
export const LIMB_SPAN = 0.22;

/**
 * Shade a limb fill by its signed depth.
 * @param z -1 = fully behind the torso, +1 = fully in front of it.
 */
export function depthShade(fill: string, z: number): string {
  const c = z < -1 ? -1 : z > 1 ? 1 : z;
  return shade(fill, LIMB_MID + LIMB_SPAN * c);
}

/**
 * SPEC_18.1 — PAIRED limb shading, with a guaranteed value floor.
 *
 * `depthShade` alone is not sufficient for a matched pair of limbs, and this is
 * measured rather than assumed. The depth term `sin(angle)` passes through zero
 * exactly when the two limbs cross — which is precisely when they overlap on
 * screen and most need separating. Measured with the plain depth term, the two
 * legs rendered at contrast 1.00 (identical colour) on 50% of walk frames and
 * the arms at 1.00 on 39% of run frames: the hard outline was deleted and
 * nothing replaced it at the moment of overlap.
 *
 * The fix is to shade the pair RELATIVE to each other rather than absolutely.
 * Whichever limb is nearer takes the light value and the other the dark one,
 * with a minimum separation enforced regardless of how close the depths are, so
 * two crossing limbs can never resolve to the same fill.
 *
 * Returns `[shadeForA, shadeForB]`.
 */
/* 0.85 chosen by measurement, not taste: it is the smallest floor that clears
 * a 1.25 contrast ratio on EVERY palette (weakest is B at 1.27). 0.55 left
 * palette B at 1.16, and 1.00 saturates the range for no extra legibility. */
export const LIMB_MIN_SPLIT = 0.85;
export function pairShade(fill: string, zA: number, zB: number): [string, string] {
  const d = zA - zB;
  const mag = Math.abs(d);
  /* Blend from the enforced floor up to the true depth difference, so limbs
   * far apart in depth still read proportionally. */
  const sep = Math.max(LIMB_MIN_SPLIT, Math.min(1, mag));
  const half = sep * 0.5;
  const mid = (zA + zB) * 0.5 * 0.35;         // slight absolute bias retained
  const sign = d >= 0 ? 1 : -1;
  return [
    depthShade(fill, mid + half * sign),
    depthShade(fill, mid - half * sign),
  ];
}

/**
 * SPEC_18.2 — corner radius in screen pixels for a card drawn at scale `sc`.
 * Pixels, not metres: otherwise corners round more when the camera closes in.
 * Modelled on the existing line-width ramp at roughly two thirds of it.
 */
export function cornerRadius(sc: number): number {
  const r = sc * 0.014;
  return r < 0.8 ? 0.8 : r > 2.4 ? 2.4 : r;
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
  /* SPEC_18.2 — ROUNDED CORNERS, NO BEZIERS.
   *
   * Stroking the path in its OWN fill colour with round joins/caps adds a
   * half-width band whose outer corners are arcs of that radius; fill + stroke
   * is one convex union, i.e. a polygon with rounded corners, for the cost of
   * a single extra stroke() and no curve maths.
   *
   * The caller is responsible for having inset the geometry by `round` (see
   * limbCard), because the stroke expands the shape outward — uncorrected,
   * every card would silently gain 2r of width and the whole figure would
   * fatten, which is the class of error that produced the SPEC_16 ratio bug. */
  let round = o.round ?? 0;
  if (round > 0.05) {
    /* A card thinner than 2r cannot absorb the stroke: the inset would collapse
     * past its own centre and the stroke would then widen it. Clamp the radius
     * to a third of the card's smallest dimension. Measured: without this a
     * narrow trim band still gained 0.41 px. */
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const q of P) {
      if (q[0] < bx0) bx0 = q[0]; if (q[0] > bx1) bx1 = q[0];
      if (q[1] < by0) by0 = q[1]; if (q[1] > by1) by1 = q[1];
    }
    const minDim = Math.min(bx1 - bx0, by1 - by0);
    round = Math.min(round, minDim / 3);
  }
  if (round > 0.05) {
    /* Inset toward the centroid by `round` so the stroke's outward expansion is
     * cancelled and the card keeps its authored size. Doing it HERE rather than
     * per-call-site means no card can be rounded without also being inset —
     * measured: without this the figure's ink grew 28.76 -> 31.68 px (+10%),
     * the same silent-fattening class of bug as the SPEC_16 ratio error. */
    /* Per-EDGE inset (not radial): offset every edge inward along its own
     * normal by `round`, then intersect consecutive edges. A centroid-radial
     * inset under-compensates thin cards badly — measured +1.18 px on a narrow
     * trim band, because moving a point toward the centroid barely shortens the
     * long axis. Edge offsetting is exact for convex cards, which every card
     * here is (they are all quads or the shorts pentagon). */
    const n = P.length;
    const I: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const prev = P[(i - 1 + n) % n], cur = P[i], next = P[(i + 1) % n];
      const off = (A: Pt, B: Pt): [number, number, number, number] => {
        const ex = B[0] - A[0], ey = B[1] - A[1];
        const el = Math.hypot(ex, ey) || 1;
        // inward normal for a counter-clockwise-or-clockwise quad: pick the one
        // pointing at the centroid
        let nx = -ey / el, ny = ex / el;
        const mx = (A[0] + B[0]) * 0.5, my = (A[1] + B[1]) * 0.5;
        let gx = 0, gy = 0;
        for (const q of P) { gx += q[0]; gy += q[1]; }
        gx /= n; gy /= n;
        if ((gx - mx) * nx + (gy - my) * ny < 0) { nx = -nx; ny = -ny; }
        return [A[0] + nx * round, A[1] + ny * round, ex, ey];
      };
      const [ax, ay, adx, ady] = off(prev, cur);
      const [bx, by, bdx, bdy] = off(cur, next);
      const den = adx * bdy - ady * bdx;
      if (Math.abs(den) < 1e-6) { I.push([ax + adx, ay + ady]); continue; }
      const t = ((bx - ax) * bdy - (by - ay) * bdx) / den;
      I.push([ax + adx * t, ay + ady * t]);
    }
    for (let i = 0; i < n; i++) { P[i] = I[i]; }
    ctx.strokeStyle = fill;
    ctx.lineWidth = round * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.stroke();
  }
  /* A hard outline is now opt-IN. Depth shading (see depthShade) carries the
   * silhouette separation that this stroke used to provide. */
  if (o.out) {
    ctx.strokeStyle = o.out;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
    ctx.closePath();
    ctx.stroke();
  }
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

/**
 * SPEC_14 — THE FIGURE SCALE.
 *
 * The builds are authored at real heights (1.76-1.98 m) and the measurement in
 * `scripts/spec14probe.ts` confirms the artwork draws them true: ink height
 * divided by px-per-metre returns 1.78 m. The figures were therefore never too
 * TALL. What they were was too small to read contact at: at the default rig a
 * carrier occupies 5.7% of the viewport and his silhouette is 0.67 m wide, so
 * when the 1.10 m tackle radius fires the two men are still 0.43 m apart on
 * screen — a tackle you cannot see.
 *
 * Growing the drawn figure by 1.65 makes two silhouettes 1.11 m wide, so their
 * edges meet exactly as the 1.10 m contact test fires, and it puts the carrier
 * at 9.4% of the viewport — inside the 8-12% broadcast reference.
 *
 * This is a DRAW-TIME constant and nothing else. It deliberately does not
 * touch the physics: it is not `Actor.size` (which reaches `maxSpeed()` and
 * would change how fast players run) and it is not the tackle radius (which
 * the author ruled stays at 1.10 m). Art and physics now disagree by CHOICE,
 * which is the SPEC_14 contract.
 */
export const FIGURE_SCALE = 1.65;

/* ================================================================== */
/* SPEC_17 — SHARED RIG GEOMETRY                                       */
/* ------------------------------------------------------------------ */
/* One source of truth for where the legs are rooted. Before this, the */
/* coronal path used `s * hipHalf * 0.8` and the side path used the    */
/* literals +0.012 / -0.045, disagreeing by 2.6x on the same           */
/* anatomical question — the measured cause of the "watermelon crotch" */
/* (SPEC_17.4 findings 1, 2 and 4). Both drawers now call this.        */
/* ================================================================== */

export interface HipRoots {
  /** coronal: leg root is at (side * coronalX, y) */
  coronalX: number;
  /** side profile: near-leg root x */
  sideNear: number;
  /** side profile: far-leg root x */
  sideFar: number;
  /** root height, in the same hip-relative space both drawers use */
  y: number;
  /** half-width of the side-profile shorts card, so the hem can follow */
  sideHalf: number;
}

/**
 * The hip joint, for every view.
 *
 * `y` sits at the ANATOMICAL hip. The greater trochanter is at leg-length
 * height, so a root of `hip - 0.02` put the pivot 0.040 m low at stand and
 * 0.160 m low at sprint (a third of a thigh), making the legs breathe by up to
 * 0.096 m inside a single stride. Rooting at the authored `hip` channel plus a
 * small rise puts the joint where the shorts hem can actually hinge from it.
 */
export function hipRoots(build: Build, hip: number): HipRoots {
  const hipHalf = build.hipW * 0.5;
  /* Side card is drawn at hip DEPTH, not hip width — it is a thin profile
   * strip. Root the two legs at the same fraction of their own card that the
   * coronal path uses (0.8 of the half-width), so neither view leaves
   * unrooted overhang that nothing can move. */
  const sideHalf = 0.099;
  const sideSpread = sideHalf * 0.62;
  return {
    coronalX: hipHalf * 0.8,
    sideNear: sideSpread,
    sideFar: -sideSpread,
    y: hip + 0.02,
    sideHalf,
  };
}

/**
 * SPEC_17 — swing-foot ground clearance.
 *
 * The old rig computed foot height FORWARD from the hip
 * (`footY = kneeY - cos(l-k)*shin + ...`), so a sagittal stride rendered as
 * pure vertical shortening and the swing foot rose 0.71 m in run and 0.92 m in
 * sprint. Both legs pulling up into the torso is the "squatting" report.
 *
 * Seen front-on, a stride is motion into DEPTH. The foot should stay near the
 * turf and pass under the body. So foot height is authored directly as a
 * shallow clearance arc driven by knee flexion — the one channel that actually
 * distinguishes swing from stance — and the stance foot lands at exactly 0.
 *
 * Calibrated against the gait table: walk 0.06, jog 0.08, run 0.13,
 * sprint 0.17 m of peak clearance.
 */
export const SWING_LIFT_K = 0.115;
export const SWING_KNEE_FLOOR = 0.15;
function rawClearance(knee: number): number {
  const lift = SWING_LIFT_K * (knee - SWING_KNEE_FLOOR);
  return lift < 0 ? 0 : lift > 0.34 ? 0.34 : lift;
}

/**
 * Both feet at once, with the lower one PINNED TO THE TURF.
 *
 * Knee flexion alone does not guarantee contact: at mid-stride both knees are
 * partly bent, which floated both feet ~0.075 m and simply relocated the old
 * hover. Subtracting the lower foot's clearance makes the stance foot sit at
 * exactly y = 0 on every frame of every gait, by construction, while the swing
 * foot keeps its arc above it. This is the structural replacement for the
 * deleted `pinPlantedFoot()`, and unlike that helper it is not optional and
 * cannot silently fail to fire.
 *
 * Note this deliberately removes the true flight phase of a sprint — a real
 * runner does leave the ground. A paper cut-out that floats reads as broken
 * rather than as airborne, so the contact is held; airborne states are the
 * jump/dive clips' job, and they drive `hip` directly.
 */
export function groundedClearance(kneeL: number, kneeR: number): [number, number] {
  const l = rawClearance(kneeL), r = rawClearance(kneeR);
  const base = Math.min(l, r);
  return [l - base, r - base];
}

/** Single-leg clearance, already grounded against its partner. */
export function swingClearance(knee: number, otherKnee: number): number {
  return groundedClearance(knee, otherKnee)[0];
}

/**
 * SPEC_17 — per-arm depth for Z-sorting.
 *
 * The elbow used `cos(aa)`, which is EVEN: a forward swing and a backward
 * swing gave an identical elbow height, so the sagittal rotation was discarded
 * and both arms stayed pinned in front of the chest ("carrying baskets").
 * `sin` is the missing odd term. Positive = swinging toward the camera.
 */
export function armDepth(shoulderPitch: number): number {
  return Math.sin(shoulderPitch);
}

/* ================================================================== */
/* SPEC_18.3a — KINETIC LEAN AND SQUASH                                */
/* ------------------------------------------------------------------ */
/* "Squeeze and pop": the figure shears into its acceleration and      */
/* compresses on impact.                                               */
/*                                                                     */
/* The filtering is not decoration. Measured on the live engine, the   */
/* position stream carries 0.08% discontinuities (max 1.019 m in one   */
/* frame = 61 m/s) and a raw acceleration p99 of 478 m/s^2 = 49 g.     */
/* Feeding that to tan() would snap figures flat on ~20% of frames.    */
/* Hence: reject jumps, EMA the velocity, differentiate, project along */
/* travel, EMA again, then bound with tanh.                            */
/* ================================================================== */

/** Ruled constants. */
export const LEAN_TAU = 0.35;          // s — the knee of the sign-flip curve
export const SHEAR_MAX = 0.18;         // rad — 10.3 deg at saturation
export const A_REF = 6.0;              // m/s^2 — tanh reference
export const MAX_STEP = 0.30;          // m per frame — above this is a teleport
export const FOOT_SQUASH = 0.06;
/** Minimum seconds between footfall triggers — the clip loop seam re-reports
 *  the u = 0.88 contact at u = 0.00, which would double-fire once per cycle. */
export const FOOT_DEBOUNCE = 0.10;

export interface LeanState {
  vx: number; vz: number;        // EMA velocity
  ax: number; az: number;        // derivative of the EMA velocity (SPEC_18.5)
  omega: number;                 // EMA signed turn rate, rad/s (SPEC_18.5)
  a: number;                     // EMA along-travel acceleration
  started: boolean;
  lastFootT: number;             // debounce clock
  wasGrounded: boolean;
  squash: number;                // current footfall squash, decaying
}

export function newLeanState(): LeanState {
  return { vx: 0, vz: 0, ax: 0, az: 0, omega: 0, a: 0, started: false, lastFootT: -99, wasGrounded: true, squash: 0 };
}

/**
 * Advance the lean filter. `rawVx/rawVz` are the per-frame finite-difference
 * velocity; `stepped` is the distance the actor moved this frame, used to
 * reject teleports.
 *
 * Returns the shear angle in radians, ready for the affine transform.
 */
export function updateLean(st: LeanState, rawVx: number, rawVz: number, stepped: number, dt: number): number {
  if (dt <= 0) return SHEAR_MAX * Math.tanh(st.a / A_REF);
  // 1 — reject discontinuities: reseed rather than differentiate a teleport
  if (stepped > MAX_STEP) {
    st.vx = rawVx; st.vz = rawVz; st.started = true;
    st.ax = 0; st.az = 0;   // a teleport is not a turn

    return SHEAR_MAX * Math.tanh(st.a / A_REF);
  }
  const av = 1 - Math.exp(-dt / LEAN_TAU);
  if (!st.started) { st.vx = rawVx; st.vz = rawVz; st.ax = 0; st.az = 0; st.started = true; return 0; }
  // 2 — EMA the velocity
  const px = st.vx, pz = st.vz;
  st.vx += (rawVx - st.vx) * av;
  st.vz += (rawVz - st.vz) * av;
  // 3 — differentiate the SMOOTHED velocity
  const ax = (st.vx - px) / dt, az = (st.vz - pz) / dt;
  st.ax = ax; st.az = az;   // SPEC_18.5 reads these for the curvature cross product
  // 4 — project along travel (signed: + accelerating, - braking)
  const spd = Math.hypot(st.vx, st.vz);
  const along = spd > 0.5 ? (ax * st.vx + az * st.vz) / spd : 0;
  // 5 — second EMA, slower
  const aa = 1 - Math.exp(-dt / (LEAN_TAU * 1.6));
  st.a += (along - st.a) * aa;
  // 6 — saturate: cannot exceed SHEAR_MAX however wild the input
  return SHEAR_MAX * Math.tanh(st.a / A_REF);
}

/**
 * Footfall squash, debounced against the clip loop seam.
 * `grounded` is true on the frame a foot is in contact; `spd` scales the thud
 * so a walk does not shake the ground.
 */
export function updateFootSquash(st: LeanState, grounded: boolean, spd: number, t: number, dt: number): number {
  if (grounded && !st.wasGrounded && t - st.lastFootT > FOOT_DEBOUNCE) {
    st.lastFootT = t;
    const w = Math.min(1, Math.max(0, (spd - 2.0) / 8.0));
    st.squash = FOOT_SQUASH * w;
  }
  st.wasGrounded = grounded;
  // spike then recover over ~6 frames at 60 Hz
  st.squash = Math.max(0, st.squash - dt * (FOOT_SQUASH / 0.10));
  return st.squash;
}

/* ================================================================== */
/* SPEC_18.5 — CENTRIFUGAL SECONDARY ANIMATION                         */
/* ------------------------------------------------------------------ */
/* Limbs respond to angular momentum: the inside limb of a turn tucks  */
/* toward the body, the outside limb flares out.                       */
/*                                                                     */
/* The turn rate is NOT taken from a heading angle. Measured, the raw  */
/* travel heading d/dt atan2(vx,vz) has a p99 of 8091 deg/s — 22 revs  */
/* per second — because atan2 of a near-zero velocity is undefined and */
/* flips wildly; below the 2.2 m/s facing threshold p99 is 9763 deg/s. */
/* Nor is it taken from the renderer's `pg.face`: that is driven by    */
/* three different targets which switch mode 4077 times in 90 s, and   */
/* each switch is a step change that is not real rotation. And `a.rf`  */
/* is a +/-1 sign, not an angle at all.                                */
/*                                                                     */
/* Instead: signed curvature of the SMOOTHED velocity, via the cross   */
/* product with its own derivative. No atan2, so no wrap discontinuity */
/* and no low-speed singularity.                                       */
/*                                                                     */
/*     w = (vx*az - vz*ax) / |v|^2                                     */
/*                                                                     */
/* Verified against known circular motion, exact to 3 decimals:        */
/* r=5 v=7 -> 1.400, r=10 v=8 -> 0.800, r=3 v=6 -> 2.000 rad/s.        */
/* Peak on live play 4.92 rad/s, against 188 rad/s for the raw signal. */
/* ================================================================== */

/** tanh reference. 2.0 keeps a jog near 10% bias, a hard turn near 90%,
 *  and saturates on only 0.88% of moving frames (measured). */
export const W_REF = 2.0;
/** Speed ramp, m/s. A hard gate chattered: 15 sign flips vs 8 for the ramp. */
export const W_GATE_LO = 1.5;
export const W_GATE_HI = 3.5;
/** Max lateral bias, radians-equivalent. Bounded by tanh, so these are hard. */
export const KNEE_GAIN = 0.10;
export const ELBOW_GAIN = 0.14;

/**
 * The cross product below is NEGATIVE for a counter-clockwise turn. Naming the
 * convention once, here, is the only defence against wiring the flare backwards
 * — the sign is otherwise invisible at the call site.
 */
export function insideSign(omega: number): number {
  return omega >= 0 ? -1 : 1;
}

/**
 * Advance the turn-rate filter and return the saturated bias in (-1, 1).
 * Shares `LeanState`'s EMA velocity so the lean and the limb flare read the
 * same motion and can never disagree about which way the player is turning.
 */
export function updateTurnBias(st: LeanState, dt: number): number {
  if (dt <= 0) return Math.tanh(st.omega / W_REF);
  const spd = Math.hypot(st.vx, st.vz);
  // smoothstep speed gate: no centrifugal force without linear velocity
  const t = Math.min(1, Math.max(0, (spd - W_GATE_LO) / (W_GATE_HI - W_GATE_LO)));
  const gate = t * t * (3 - 2 * t);
  const raw = spd > 0.5 ? ((st.vx * st.az - st.vz * st.ax) / (spd * spd)) * gate : 0;
  const a = 1 - Math.exp(-dt / LEAN_TAU);
  st.omega += (raw - st.omega) * a;
  return Math.tanh(st.omega / W_REF);
}

/* ================================================================== */
/* SPEC_18.3b — 3/4 PERSPECTIVE                                        */
/* ------------------------------------------------------------------ */
/* Deliberately NOT a sixth PaperView. Adding an enum state would make
 * the hysteresis machine a 6-zone problem, needing its own dead zones and its
 * own mirror-flip debounce, and SPEC_06 already had to be hardened once
 * because that machine thrashed. Instead the 3/4 read is a CONTINUOUS
 * affine applied over the existing front/back card, driven by the same
 * angle the view machine computes. Zero new states, and it degenerates
 * exactly to the current picture at 0 deg.
 *
 * SPEC_21 Item 1 — THE SHEAR IS GONE. It was the "Leaning Tower".
 *
 * The original transform carried an x-shear proportional to y:
 *
 *   | narrow   -tan(shear) |      head at (0,-h) maps to (+tan(shear)*h, -h)
 *   |   0            1     |
 *
 * so the head slid sideways while the feet stayed put. Measured, that was a
 * 0.479 m head displacement and a 14.90 deg slant at the 55 deg edge — the
 * figure leaned instead of turning. A shear IS the right image of a 3D yaw,
 * but only under an OBLIQUE (cavalier) projection. `project()` in retro.ts is
 * a PERSPECTIVE projection with its own camera tilt; depth is already spent in
 * `p.f`/`p.sc`. Shearing on top of it double-counts depth, and the slant was
 * the visible residue.
 *
 * Under this projection, rotating a flat card about its own VERTICAL axis by
 * theta does exactly one thing to the screen image: it foreshortens X by
 * cos(theta). Vertical extent is invariant because the rotation axis IS the
 * vertical. So the transform is now a pure scale:
 *
 *   | scaleX  0 |     (0,-h) -> (0,-h) exactly. Tilt is 0 by construction,
 *   |   0     1 |     not by tuning.
 *
 * On the floor: literal cos(theta) reaches 0 at 90 deg. The view machine swaps
 * to the profile card at EDGE_IN = 55 deg where cos = 0.5736, so the front card
 * would narrow to 57% of width and POP against the profile card's natural
 * width at the handover. TQ_NARROW = 0.86 is the already-tuned answer to that
 * handover and is retained (ruled), tracking cos closely out to ~20 deg where
 * the eye actually reads foreshortening, and departing only near the swap. */

/** Deepest shoulder-width compression at full 3/4 (1 = none). */
export const TQ_NARROW = 0.86;

/* SPEC_21 Item 1 — `TQ_SHEAR_MAX` DELETED, not zeroed, so it cannot be
 * re-enabled by a future reader who mistakes it for a tuning knob. The kinetic
 * lean in coronal.ts is a DIFFERENT shear and is correct: a player leaning into
 * acceleration genuinely does slant. Only the 3/4 shear was wrong. */

export interface ThreeQuarter { narrow: number; }

/**
 * Continuous 3/4 projection for a front/back card.
 * @param ang  degrees between actor facing and the actor->camera vector, the
 *             same quantity `updatePaperView` thresholds on.
 * Ramps in across the end-on zone and holds at the edge boundary, so it is
 * fully faded in by the time the view machine would swap to the profile card
 * and there is no pop at the handover.
 */
export function threeQuarter(ang: number): ThreeQuarter {
  const a = ang > 90 ? 180 - ang : ang;         // symmetric front/back
  const t = Math.min(1, Math.max(0, a / EDGE_IN));
  const e = t * t * (3 - 2 * t);                 // smoothstep — no kink at 0
  return { narrow: 1 - (1 - TQ_NARROW) * e };
}

/** Signed facing angle helper: degrees, plus the side the camera sits on. */
export function facingAngle(fx: number, fz: number, ax: number, az: number, camX: number, camZ: number): { ang: number; sign: number } {
  let tx = camX - ax, tz = camZ - az;
  const tl = Math.hypot(tx, tz);
  if (tl < 1e-4) { tx = 0; tz = 1; } else { tx /= tl; tz /= tl; }
  const d = Math.min(1, Math.max(-1, fx * tx + fz * tz));
  return { ang: Math.acos(d) * 180 / Math.PI, sign: fx * tz - fz * tx < 0 ? -1 : 1 };
}

/** Combine two squash sources without double-compressing (ruled). */
export function combineSquash(a: number, b: number): number {
  return 1 - (1 - a) * (1 - b);
}

/**
 * Two-bone IK in the drawing plane. The foot is authored (clearance arc); the
 * knee is solved rather than accumulated forward, which is what keeps the
 * stance foot pinned at ground level instead of floating 1-2 cm.
 * `bend` is the side the knee breaks toward.
 */
export function solveKnee(
  hx: number, hy: number, fx: number, fy: number,
  thigh: number, shin: number, bend: number,
): [number, number] {
  const dx = fx - hx, dy = fy - hy;
  const reach = thigh + shin;
  let d = Math.hypot(dx, dy);
  if (d < 1e-4) d = 1e-4;
  const dc = Math.min(d, reach * 0.999);
  const ux = dx / d, uy = dy / d;
  const a = (thigh * thigh - shin * shin + dc * dc) / (2 * dc);
  const hgt = Math.sqrt(Math.max(0, thigh * thigh - a * a));
  // perpendicular, pointing to the side the knee breaks toward
  const px = -uy * bend, py = ux * bend;
  return [hx + ux * a + px * hgt, hy + uy * a + py * hgt];
}

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
/* (squash, legScale) and the Pose returned by upperLowerRun.           */
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

/* ---- 2. NO-FOOT-SLIDE — REMOVED (SPEC_17.1) ----
 * `pinPlantedFoot()` lived here. It raised the hip when a foot sank below the
 * turf, but its guard `if (stance >= -0.005) return pose` only ever fired on a
 * SINKING foot, and measurement across one full cycle of all five gaits found
 * the lowest foot at +0.003 m. It never fired; before/after poses were
 * byte-identical in every clip. It read as a working correction while doing
 * nothing, which is worse than no code at all.
 *
 * Grounding is now STRUCTURAL, in the rig rather than in a post-hoc pose
 * patch: the coronal leg authors its foot on a shallow clearance arc and the
 * stance foot sits at exactly y = 0 by construction. See `swingClearance()`.
 */

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
