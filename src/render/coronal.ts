/**
 * PAPER PUPPET RENDERERS
 * ----------------------
 *  - drawCoronal   : front / back artwork of the flat cut-out (chest hoop, shirt
 *                    number on the back, face or hair)
 *  - drawSidePaper : a TRUE profile card — thin vertical paper strip, one lit arm,
 *                    one lit leg, dark far-side paper layer behind, profile head
 *                    with nose wedge, visible forward lean and stride, ball clamped
 *                    in front of the chest. Not a squashed front puppet.
 *  - drawLyingPaper: face-up / face-down artwork laid on the turf, foreshortened
 *                    by the camera height and by the body axis vs the lens.
 *  - drawPaperActor: dispatch + the fall rotation that tips the standing card
 *                    over onto its lying artwork seamlessly (pivot at the hip).
 *
 * Everything is drawn in metres relative to a ground anchor, converted with
 * X(m) = m*sc, Y(m) = -m*sc (screen y is down).
 */

import {
  Ctx, Pt, Palette, Build, PaperView, OUT, DISPLAY, shade,
  paperCard, poly, foldTab, crease, ballPaper,
  hipRoots, groundedClearance, armDepth, solveKnee,
  depthShade, pairShade, cornerRadius,
  insideSign, KNEE_GAIN, ELBOW_GAIN,
} from './paper';
import { Pose } from './clips';
import { project, type Camera, type View } from './retro';
import { FIGURE_SCALE } from './paper';

export interface PaperDrawArgs {
  ctx: Ctx;
  sx: number; sy: number; sc: number;
  /** SPEC_14 — the lens and the actor's turf position, so the shadow can be
   *  projected from real world geometry instead of screen-space nudges. */
  cam: Camera; v: View;
  wx: number; wz: number;
  /** heading in radians; forward = +z at 0 */
  face: number;
  view: PaperView;
  pose: Pose;
  pal: Palette; build: Build;
  skin: string; hair: string;
  num: number; seed: number;
  /** 0 no ball .. 1 clamped */
  carry: number;
  /** 0 two-hand carry .. 1 one-hand clamp + fend */
  carryStyle: number;
  ballSide: number;
  ballSpin: number;
  cap: boolean; tape: boolean;
  /** screen direction the actor faces (+1 right) — drives fall tipping */
  spinDir: number;
  /** ground squash for lying artwork (from camera tilt) */
  gs: number;
  /** 0..1 foreshorten of the lying body axis */
  fore: number;
  headDir: number;
  depth: number;
  /** 2D impact deformation: vertical squash + horizontal bulge about the foot
   *  anchor (SPEC_01 — Impact Squash, P-01/C-01/W-06). Applied in drawPaperActor. */
  squash?: { sx: number; sy: number };
  /** perspective foreshortening of the standing leg length, 0.6..1
   *  (SPEC_01 — Edge Leg Foreshortening, B-14/D-04). */
  legScale?: number;
  /** SPEC_18.3a — kinetic lean, radians. Sheared about the foot anchor. */
  lean?: number;
  /** SPEC_18.5 — saturated centrifugal turn bias, -1..1. */
  turn?: number;
  /** SPEC_18.3b — 3/4 projection for the front/back card. */
  tq?: { shear: number; narrow: number };
  /** Which way the actor is turning away from camera, +1 / -1. */
  tqSign?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Stride foot pitch (radians, + = toe up): heel-strike carries the toe up,
 * mid-stance is flat, toe-off lifts the heel and the swinging foot hangs
 * toe-down for ground clearance. Derived from the hip/knee channels so every
 * clip gets correct ankle mechanics for free.
 */
export function footPitch(l: number, k: number): number {
  return clampN(0.52 * l - 0.22 * k, -0.55, 0.5);
}

function rotPt(px: number, py: number, cx: number, cy: number, ang: number): [number, number] {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = px - cx, dy = py - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/**
 * SPEC_18.5 — how strongly each arm is locked to the ball, 0..1, using exactly
 * the weights `carryPose` applies below. Returned as [left, right] so the
 * centrifugal flare can be suppressed in proportion to the override rather
 * than switched off by a boolean guess.
 */
export function carryLock(carry: number, cs: number, ballSide: number): [number, number] {
  if (carry <= 0.02) return [0, 0];
  const nearR = ballSide >= 0;
  const twoHand = clamp01(1 - cs * 1.6) * carry;
  const wFar = Math.max(twoHand, cs * carry);
  return nearR ? [wFar, carry] : [carry, wFar];
}

/** apply carry overrides: clamp arm around the ball, fend with the far arm */
function carryPose(p: Pose, carry: number, cs: number, ballSide: number): Pose {
  if (carry <= 0.02) return p;
  const q: Pose = { ...p };
  const nearR = ballSide >= 0;
  const twoHand = clamp01(1 - cs * 1.6) * carry;
  const clampT = carry;
  // near (carrying) arm wraps the ball
  if (nearR) {
    q.aR = lerp(q.aR, 1.32, clampT); q.eR = lerp(q.eR, 1.75, clampT); q.abR = lerp(q.abR, 0.26, clampT);
  } else {
    q.aL = lerp(q.aL, 1.32, clampT); q.eL = lerp(q.eL, 1.75, clampT); q.abL = lerp(q.abL, 0.26, clampT);
  }
  // far arm: two-hand cradle or stiff-arm fend
  const farA = lerp(1.28, 1.55, cs);
  const farE = lerp(1.55, 0.3, cs);
  const farAb = lerp(0.26, 0.62, cs);
  const wFar = Math.max(twoHand, cs * carry);
  if (nearR) {
    q.aL = lerp(q.aL, farA, wFar); q.eL = lerp(q.eL, farE, wFar); q.abL = lerp(q.abL, farAb, wFar);
  } else {
    q.aR = lerp(q.aR, farA, wFar); q.eR = lerp(q.eR, farE, wFar); q.abR = lerp(q.abR, farAb, wFar);
  }
  q.ball = Math.max(q.ball, carry);
  return q;
}

interface Locals { ctx: Ctx; sc: number; lw: number; seed: number; round: number; X: (m: number) => number; Y: (m: number) => number }

function makeLocals(ctx: Ctx, sc: number, seed: number): Locals {
  return {
    ctx, sc, seed,
    lw: Math.min(3.2, Math.max(1.05, sc * 0.021)),
    round: cornerRadius(sc),          // SPEC_18.2
    X: (m: number) => m * sc,
    Y: (m: number) => -m * sc,
  };
}

/**
 * A limb card.
 *
 * SPEC_18.2 — the rounding inset lives in `paperCard` (centroid inset by `r`),
 * so every card is compensated whether or not its call site remembers. This
 * function just passes the radius down.
 *
 * `out` is now optional: passing `null` means "no hard outline", and the card
 * relies on depth shading for separation (SPEC_18.1).
 */
function limbCard(L: Locals, x0: number, y0: number, x1: number, y1: number, w: number, fill: string, out: string | null, lw: number, seed: number, back = 1.1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  /* Corner radius is in pixels; convert to metres for the inset, since the
   * card is built in metres and only converted by X()/Y() at the end. */
  const rPx = L.round;
  const px = (-dy / len) * w * 0.5, py = (dx / len) * w * 0.5;
  const pts: Pt[] = [
    [L.X(x0 - px), L.Y(y0 - py)], [L.X(x0 + px), L.Y(y0 + py)],
    [L.X(x1 + px * 0.82), L.Y(y1 + py * 0.82)], [L.X(x1 - px * 0.82), L.Y(y1 - py * 0.82)],
  ];
  paperCard(L.ctx, pts, fill, { lw, out: out ?? undefined, seed, back, jit: 0.4, round: rPx });
}

function disc(L: Locals, x: number, y: number, r: number, fill: string, lw: number, seed: number) {
  const c = L.ctx;
  c.beginPath(); c.arc(L.X(x) + 1.1, L.Y(y) + 0.9, r * L.sc, 0, Math.PI * 2);
  c.fillStyle = '#101018'; c.fill();
  c.beginPath(); c.arc(L.X(x), L.Y(y), r * L.sc, 0, Math.PI * 2);
  c.fillStyle = fill; c.fill();
  /* SPEC_18.1 — a circle has no corners to round and no ambiguous edge, so it
   * simply loses the hard outline; its own fill carries the shape. */
  void lw; void seed;
}

/* ================================================================== */
/* CORONAL — front / back                                              */
/* ================================================================== */

function drawCoronal(L: Locals, a: PaperDrawArgs, front: boolean) {
  const { ctx, sc, lw } = L;
  const p = a.pose, b = a.build, pal = a.pal;
  const skinD = shade(a.skin, 0.72);
  const roll = p.roll, twist = p.twist;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const R = (x: number, y: number): [number, number] => [x * cr - (y - p.hip) * sr * -1, y];
  // roll applied as a screen rotation about the hip
  const RP = (x: number, y: number): [number, number] => {
    const dy = y - p.hip;
    return [x * cr - dy * sr, p.hip + x * sr + dy * cr];
  };
  void R;
  const shLen = b.torso * Math.cos(Math.min(1.25, Math.max(-0.6, p.lean)) * 0.92);
  const shY = p.hip + shLen;
  const tws = Math.sin(twist) * 0.12;
  const shHalf = b.shW * 0.5 * (0.84 + 0.16 * Math.cos(twist));
  const hipHalf = b.hipW * 0.5;
  const legScale = a.legScale ?? 1;
  /* SPEC_17: thigh/shin lengths are now derived PER LEG inside the loop, since
   * each is foreshortened by its own swing angle. */
  const upLen = b.arm * 0.52, foreLen = b.arm * 0.48;

  /* ---- legs ----
     SPEC_17 — DEPTH FORESHORTENING, NOT VERTICAL SHORTENING.

     A sagittal stride seen front-on is motion into DEPTH. The old rig walked
     the chain forward from the hip with `cos(l)` / `cos(l-k)`, which turned
     the stride into vertical shortening and lifted the swing foot 0.71 m at
     run and 0.92 m at sprint — both legs pulling up into the torso, i.e. the
     "squat". Now:

       - the foot is AUTHORED on a shallow clearance arc near the turf;
       - the stance foot is pinned at exactly y = 0 (no float);
       - `cos(l)` survives only as a FORESHORTENING of the limb on the card,
         so a striding leg reads as shorter, not as lifted;
       - the knee is SOLVED by IK to the authored foot rather than accumulated.
  */
  const rt = hipRoots(b, p.hip);
  /* Both feet solved together so the LOWER one is pinned at y = 0. */
  const [clrL, clrR] = groundedClearance(p.kL, p.kR);
  /* SPEC_18.1 — the two legs are shaded AS A PAIR. `sin(l)` alone collapses to
   * zero exactly when the legs cross (measured: contrast 1.00 on 50% of walk
   * frames), so the pair helper enforces a minimum value split. `front` flips
   * the sense because from behind the near side of the body is the far side of
   * the card. */
  const vf = front ? 1 : -1;
  const [shShortL, shShortR] = pairShade(pal.shorts, Math.sin(p.lL) * vf, Math.sin(p.lR) * vf);
  const [shSockL, shSockR] = pairShade(pal.socks, Math.sin(p.lL) * vf, Math.sin(p.lR) * vf);
  const [shTrimL, shTrimR] = pairShade(pal.trim, Math.sin(p.lL) * vf, Math.sin(p.lR) * vf);
  const [shBootL, shBootR] = pairShade('#1c1c24', Math.sin(p.lL) * vf, Math.sin(p.lR) * vf);
  for (const s of [-1, 1] as const) {
    const l = s < 0 ? p.lL : p.lR;
    const k = s < 0 ? p.kL : p.kR;
    const ad = s < 0 ? p.adL : p.adR;
    const [hx, hy] = RP(s * rt.coronalX, rt.y);
    /* Depth foreshortening: the further the thigh swings out of the coronal
     * plane (either way — `abs`), the shorter the whole leg draws. */
    const fore = lerp(1, Math.abs(Math.cos(l)), 0.55) * legScale;
    const thighD = b.leg * 0.52 * fore, shinD = b.leg * 0.48 * fore;
    /* Lateral travel: abduction plus a small sagittal cross-under, so a
     * swinging leg passes under the body instead of hanging out to the side. */
    /* SPEC_18.5 — centrifugal bias. Applied to the IK FOOT TARGET, never to
     * `bend`. `bend` is a +/-1 perpendicular selector, not an angle: the IK
     * only preserves bone length at exactly |bend| = 1. Measured, bend = 1.3
     * stretches the femur 0.440 -> 0.473 m and bend = 2.0 stretches it to
     * 0.571 m. Biasing it would literally hyperextend the leg. Moving the
     * target instead keeps both bone lengths exact by construction, and
     * solveKnee's own `reach * 0.999` clamp bounds the result. */
    /* The bias must act along each limb's OWN outward direction (`s`), not
     * along world x. Applying it in world x moved both legs the same way, so
     * the stance merely widened or narrowed symmetrically instead of the
     * inside limb tucking while the outside limb flared. Measured before the
     * fix: at turn = +1 both feet sat 0.084 m FURTHER from the spine. */
    const inSide = insideSign(a.turn ?? 0);
    const legFlare = (a.turn ?? 0) === 0 ? 0
      : s * (s === inSide ? -1 : 1) * Math.abs(a.turn ?? 0) * KNEE_GAIN * (thighD + shinD);
    const footX = hx + s * ad * (thighD + shinD) * 0.42 - Math.sin(l) * 0.055 * s + legFlare;
    const footY = s < 0 ? clrL : clrR;
    const [kneeX, kneeY] = solveKnee(hx, hy, footX, footY, thighD, shinD, s);
    /* SPEC_18.1 — the leg's own depth. `sin(l)` is the odd term: a leg swung
     * forward is nearer the camera than one swung back, so the two legs get a
     * value step even though they share a fill. This is the same quantity the
     * rig already uses, so shading can never contradict the geometry. */
    const cShort = s < 0 ? shShortL : shShortR;
    const cSock = s < 0 ? shSockL : shSockR;
    const cTrim = s < 0 ? shTrimL : shTrimR;
    const cBoot = s < 0 ? shBootL : shBootR;
    limbCard(L, hx, hy, kneeX, kneeY, 0.15 * b.bulk, cShort, null, lw, a.seed + s * 3);
    limbCard(L, kneeX, kneeY, footX, footY, 0.112 * b.bulk, cSock, null, lw, a.seed + s * 5);
    // sock turnover band
    const bx = lerp(kneeX, footX, 0.18), by = lerp(kneeY, footY, 0.18);
    limbCard(L, bx, by, lerp(kneeX, footX, 0.34), lerp(kneeY, footY, 0.34), 0.12 * b.bulk, cTrim, null, lw * 0.8, a.seed + s * 7, 0.6);
    // boot: toe toward camera — stride pitch reads as sole flash / lifted heel
    const bp2 = footPitch(l, k);
    const lift = Math.max(0, -bp2) * 0.07;
    const bh = 0.055 + 0.06 * Math.cos(bp2 * 0.9);
    paperCard(ctx, [
      [L.X(footX - 0.075), L.Y(footY + lift + bh)], [L.X(footX + 0.075), L.Y(footY + lift + bh)],
      [L.X(footX + 0.062), L.Y(footY + lift - 0.015)], [L.X(footX - 0.062), L.Y(footY + lift - 0.015)],
    ], cBoot, { lw, seed: a.seed + s, jit: 0.35, round: L.round });
    if (bp2 > 0.12) {
      ctx.save();
      ctx.globalAlpha = clamp01(bp2 * 1.6);
      poly(ctx, [
        [L.X(footX - 0.06), L.Y(footY + lift + bh * 0.78)], [L.X(footX + 0.06), L.Y(footY + lift + bh * 0.78)],
        [L.X(footX + 0.05), L.Y(footY + lift + bh * 0.16)], [L.X(footX - 0.05), L.Y(footY + lift + bh * 0.16)],
      ], '#c9c2b0');
      ctx.restore();
    } else {
      poly(ctx, [
        [L.X(footX - 0.05), L.Y(footY + lift + 0.02)], [L.X(footX + 0.05), L.Y(footY + lift + 0.02)],
        [L.X(footX + 0.045), L.Y(footY + lift - 0.005)], [L.X(footX - 0.045), L.Y(footY + lift - 0.005)],
      ], shade(cBoot, 1.7));
    }
  }

  /* ---- shorts ----
     SPEC_17 — the hem hangs from the unified root, not from a literal, so the
     card can never again be drawn at one height and rigged at another. */
  const hemY = rt.y - 0.18;
  const sq: Pt[] = [[-hipHalf - 0.02, rt.y + 0.08], [hipHalf + 0.02, rt.y + 0.08], [hipHalf + 0.01, hemY], [-hipHalf - 0.01, hemY]]
    .map(([x, y]) => { const q = RP(x, y); return [L.X(q[0]), L.Y(q[1])] as Pt; });
  paperCard(ctx, sq, pal.shorts, { lw, seed: a.seed + 11, jit: 0.5, round: L.round });
  foldTab(ctx, L.X(RP(-hipHalf * 0.7, p.hip + 0.04)[0]), L.Y(RP(-hipHalf * 0.7, p.hip + 0.04)[1]), 0.1 * sc, 0.05 * sc, pal.kitDark, lw);
  foldTab(ctx, L.X(RP(hipHalf * 0.7, p.hip + 0.04)[0]), L.Y(RP(hipHalf * 0.7, p.hip + 0.04)[1]), 0.1 * sc, 0.05 * sc, pal.kitDark, lw);

  /* ---- arms ----
     Paper layering: seen from the FRONT the arm cards are pinned on top of the
     torso card; seen from the BACK they sit BEHIND it, so the body occludes
     them and only the outer silhouette of sleeve/forearm/hand shows. */
  /* SPEC_17 — PER-ARM Z-SORT.

     The whole ordering decision used to be one boolean, so both arms shared a
     pass and neither could ever be behind the torso while the other was in
     front. Worse, the elbow used `cos(aa)`, which is EVEN — a forward swing
     and a backward swing produced an identical elbow, discarding the sagittal
     rotation entirely and pinning both arms in front of the chest.

     `armDepth()` = sin(aa) is the missing odd term. Each arm now sorts on its
     own sign, and a forward-swinging arm FORESHORTENS (drawing shorter and
     overlapping the body) instead of merely rising. Measured: the two arms are
     on opposite sides of the torso on 100% of gait frames, so this changes
     every frame of every stride. */
  /* SPEC_18.1 — same pairing for the arms; measured 1.00 contrast against the
   * torso on 39% of run frames with the plain depth term. */
  const avf = front ? 1 : -1;
  const [shKitL, shKitR] = pairShade(pal.kit, armDepth(p.aL) * avf, armDepth(p.aR) * avf);
  const [shSkinL, shSkinR] = pairShade(a.skin, armDepth(p.aL) * avf, armDepth(p.aR) * avf);
  const [carryLockL, carryLockR] = carryLock(a.carry, a.carryStyle, a.ballSide);
  const drawOneArm = (s: -1 | 1) => {
    const aa = s < 0 ? p.aL : p.aR;
    const e = s < 0 ? p.eL : p.eR;
    const ab = s < 0 ? p.abL : p.abR;
    const dep = armDepth(aa);
    /* SPEC_18.5 — elbow flare, suppressed on an arm locked to the ball so the
     * carry cannot visually disconnect (ruled). `carryLock` is the same weight
     * carryPose used to override this arm, so suppression tracks the override
     * exactly rather than guessing from a boolean. */
    const armInside = insideSign(a.turn ?? 0);
    const flareW = 1 - (s < 0 ? carryLockL : carryLockR);
    /* `ab` is already a per-side abduction (multiplied by `s` at use), so a
     * positive bias abducts and a negative one adducts — no `s` factor here. */
    const abBias = (s === armInside ? -1 : 1) * Math.abs(a.turn ?? 0) * ELBOW_GAIN * flareW;
    const [sx0, sy0] = RP(s * shHalf * 0.9 + tws, shY - 0.02);
    /* Depth foreshortening: an arm swung out of the coronal plane draws
     * shorter on the card. Front-swing and back-swing shorten alike, which is
     * correct — it is the SORT that tells them apart, not the length. */
    const fs = lerp(1, Math.abs(Math.cos(aa)), 0.42);
    const upD = upLen * fs, foreD = foreLen * fs;
    const elX = sx0 + s * (ab + abBias) * upD * 0.85 + dep * 0.055 * s;
    const elY = sy0 - Math.cos(aa) * upD;
    const hdX = elX - s * Math.sin(e) * foreD * 0.5 + dep * 0.045;
    const hdY = elY - Math.cos(aa - e * 0.8) * foreD * 0.8;
    /* SPEC_18.1 — shade by the SAME depth that decided the draw pass above. */
    const cKit = s < 0 ? shKitL : shKitR;
    const cSkin = s < 0 ? shSkinL : shSkinR;
    limbCard(L, sx0, sy0, elX, elY, 0.115 * b.bulk, cKit, null, lw, a.seed + s * 17);
    limbCard(L, elX, elY, hdX, hdY, 0.092 * b.bulk, cSkin, null, lw, a.seed + s * 19);
    disc(L, hdX, hdY, 0.055 * b.bulk, a.tape && s > 0 ? depthShade('#e8e2d0', armDepth(s < 0 ? p.aL : p.aR) * avf) : cSkin, lw * 0.9, a.seed + s);
    foldTab(ctx, L.X(sx0), L.Y(sy0), 0.09 * sc, 0.045 * sc, pal.kitDark, lw);
  };
  /* An arm is IN FRONT when it swings toward the viewer. Seen from the back
   * the sense inverts: the near side of the body is the far side of the card. */
  const armInFront = (s: -1 | 1) => {
    const d = armDepth(s < 0 ? p.aL : p.aR);
    return front ? d >= 0 : d < 0;
  };
  const drawBackArm = () => { for (const s of [-1, 1] as const) if (!armInFront(s)) drawOneArm(s); };
  const drawFrontArm = () => { for (const s of [-1, 1] as const) if (armInFront(s)) drawOneArm(s); };

  drawBackArm();

  /* ---- torso ---- */
  const t0 = RP(-hipHalf, p.hip - 0.02), t1 = RP(hipHalf, p.hip - 0.02);
  const t2 = RP(shHalf + tws, shY), t3 = RP(-shHalf + tws, shY);
  const torsoPts: Pt[] = [[L.X(t0[0]), L.Y(t0[1])], [L.X(t1[0]), L.Y(t1[1])], [L.X(t2[0]), L.Y(t2[1])], [L.X(t3[0]), L.Y(t3[1])]];
  paperCard(ctx, torsoPts, pal.kit, { lw: lw * 1.05, seed: a.seed + 13, jit: 0.55, back: 1.6, round: L.round });
  // hoops
  for (const hy of [0.62, 0.44]) {
    const y = p.hip + shLen * hy;
    const w = lerp(hipHalf, shHalf, hy) + 0.004;
    const h0 = RP(-w + tws * hy, y), h1 = RP(w + tws * hy, y);
    const h2 = RP(w + tws * (hy + 0.1), y + shLen * 0.09), h3 = RP(-w + tws * (hy + 0.1), y + shLen * 0.09);
    poly(ctx, [[L.X(h0[0]), L.Y(h0[1])], [L.X(h1[0]), L.Y(h1[1])], [L.X(h2[0]), L.Y(h2[1])], [L.X(h3[0]), L.Y(h3[1])]], pal.trim);
  }
  crease(ctx, L.X(RP(tws * 0.5, p.hip)[0]), L.Y(RP(tws * 0.5, p.hip)[1]), L.X(RP(tws * 0.6, shY)[0]), L.Y(RP(tws * 0.6, shY)[1]), 0.08, Math.max(1, lw * 0.5));
  // collar
  const c0 = RP(-shHalf * 0.42 + tws, shY + 0.015), c1 = RP(shHalf * 0.42 + tws, shY + 0.015);
  const c2 = RP(shHalf * 0.3 + tws, shY - 0.06), c3 = RP(-shHalf * 0.3 + tws, shY - 0.06);
  poly(ctx, [[L.X(c0[0]), L.Y(c0[1])], [L.X(c1[0]), L.Y(c1[1])], [L.X(c2[0]), L.Y(c2[1])], [L.X(c3[0]), L.Y(c3[1])]], front ? pal.trim : pal.kitDark);

  if (!front) {
    // shirt number on the back card
    const nc = RP(tws * 0.6, p.hip + shLen * 0.52);
    ctx.save();
    ctx.translate(L.X(nc[0]), L.Y(nc[1]));
    ctx.rotate(-roll);
    ctx.font = `${Math.max(6, 0.3 * sc)}px ${DISPLAY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, lw * 1.4); ctx.strokeStyle = OUT;
    ctx.strokeText(String(a.num), 0, 0);
    ctx.fillStyle = pal.trim;
    ctx.fillText(String(a.num), 0, 0);
    ctx.restore();
  }

  drawFrontArm();

  /* ---- head ---- */
  const [hdx, hdy] = RP(Math.sin(p.headY) * 0.045 + tws * 0.7, shY + 0.075 + b.headR * 0.98 * Math.cos(p.headP));
  const hr = b.headR;
  // neck
  limbCard(L, tws * 0.6, shY - 0.02, hdx, hdy - hr * 0.55, 0.09, shade(a.skin, 0.85), OUT, lw * 0.9, a.seed + 23, 0.8);
  disc(L, hdx, hdy, hr, a.skin, lw, a.seed + 29);
  const hx = L.X(hdx), hy = L.Y(hdy);
  if (front) {
    // hair fringe
    ctx.save();
    ctx.beginPath(); ctx.arc(hx, hy, hr * sc, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = a.hair;
    ctx.fillRect(hx - hr * sc, hy - hr * sc, hr * 2 * sc, hr * sc * (a.cap ? 1.15 : 0.52));
    if (a.cap) { // scrum cap
      ctx.fillStyle = shade(pal.kitDark, 0.7);
      ctx.fillRect(hx - hr * sc, hy - hr * sc, hr * 2 * sc, hr * sc * 1.25);
      ctx.fillStyle = a.skin;
      ctx.beginPath(); ctx.arc(hx - hr * 0.62 * sc, hy + hr * 0.15 * sc, hr * 0.22 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx + hr * 0.62 * sc, hy + hr * 0.15 * sc, hr * 0.22 * sc, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // face
    const ey = hy + hr * sc * 0.06;
    const exo = Math.sin(p.headY) * hr * sc * 0.4;
    ctx.fillStyle = '#191922';
    ctx.fillRect(hx - hr * sc * 0.38 + exo, ey, Math.max(1.4, hr * sc * 0.16), Math.max(1.4, hr * sc * 0.16));
    ctx.fillRect(hx + hr * sc * 0.22 + exo, ey, Math.max(1.4, hr * sc * 0.16), Math.max(1.4, hr * sc * 0.16));
    ctx.strokeStyle = '#191922'; ctx.lineWidth = Math.max(1, lw * 0.6);
    ctx.beginPath();
    ctx.moveTo(hx - hr * sc * 0.42 + exo, ey - hr * sc * 0.2);
    ctx.lineTo(hx - hr * sc * 0.14 + exo, ey - hr * sc * 0.16);
    ctx.moveTo(hx + hr * sc * 0.16 + exo, ey - hr * sc * 0.16);
    ctx.lineTo(hx + hr * sc * 0.44 + exo, ey - hr * sc * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx - hr * sc * 0.16, hy + hr * sc * 0.45);
    ctx.lineTo(hx + hr * sc * 0.2, hy + hr * sc * 0.45);
    ctx.stroke();
  } else {
    ctx.save();
    ctx.beginPath(); ctx.arc(hx, hy, (hr + 0.008) * sc, 0, Math.PI * 2);
    ctx.fillStyle = a.cap ? shade(pal.kitDark, 0.7) : a.hair; ctx.fill();
    ctx.restore();
    // nape
    poly(ctx, [[hx - hr * sc * 0.5, hy + hr * sc * 0.75], [hx + hr * sc * 0.5, hy + hr * sc * 0.75], [hx + hr * sc * 0.34, hy + hr * sc * 1.05], [hx - hr * sc * 0.34, hy + hr * sc * 1.05]], a.cap ? shade(pal.kitDark, 0.7) : a.hair);
  }
  void skinD;
}

/* ================================================================== */
/* SIDE PROFILE — a true thin paper card                               */
/* ================================================================== */

function drawSidePaper(L: Locals, a: PaperDrawArgs, nearR: boolean) {
  const { ctx, sc, lw } = L;
  const p = a.pose, b = a.build, pal = a.pal;
  const kitF = shade(pal.kit, 0.58), skinF = shade(a.skin, 0.6), sockF = shade(pal.socks, 0.55);
  const shortF = shade(pal.shorts, 0.62), bootF = '#14141b';
  const lean = Math.min(1.1, Math.max(-0.5, p.lean));
  const cl = Math.cos(lean), sl = Math.sin(lean);
  const RL = (x: number, y: number): [number, number] => {
    const dy = y - p.hip;
    return [x * cl + dy * sl, p.hip + dy * cl - x * sl];
  };
  const shY = p.hip + b.torso * 0.98;
  const legScale = a.legScale ?? 1;
  const thighLen = b.leg * 0.52 * legScale, shinLen = b.leg * 0.48 * legScale;
  const upLen = b.arm * 0.52, foreLen = b.arm * 0.48;
  const aN = nearR ? p.aR : p.aL, eN = nearR ? p.eR : p.eL;
  const aF = nearR ? p.aL : p.aR, eF = nearR ? p.eL : p.eR;
  const lN = nearR ? p.lR : p.lL, kN = nearR ? p.kR : p.kL;
  const lF = nearR ? p.lL : p.lR, kF = nearR ? p.kL : p.kR;
  /* SPEC_17 — shared rig geometry; the side path no longer invents its own. */
  const rtS = hipRoots(b, p.hip);

  /* SPEC_17 — the leg chain is now ROUTED THROUGH `RL`, exactly as the torso,
     shorts and hoops already were. Before, `legChain` took its root raw
     (`hy = p.hip - 0.02`) while the shorts card was lean-rotated around it, so
     the hem slid up to 8.4 cm — 42% of the card width — against a stationary
     root at sprint. The card sheared off its own rigging every stride. The
     root now inherits the lean, so hem and hip travel together. */
  const legChain = (l: number, k: number, ox: number, wT: number, wS: number, cT: string, cS: string, cB: string, out: string | null, seed: number, lift = 0) => {
    const [hx, hy0] = RL(ox, rtS.y);
    /* SPEC_17 — ground the side profile the same way the coronal path is
     * grounded. Raising the root to the anatomical hip lengthened the chain,
     * and forward kinematics alone left the lowest foot floating up to 0.286 m
     * at sprint (and sinking 0.035 m). `lift` is the common correction that
     * puts the lower foot on the turf; both legs get the same value so the
     * pelvis moves as one rigid body and the legs keep their relative stride. */
    const hy = hy0 - lift;
    /* Only the ROOT inherits the lean. The limb angles stay ground-relative:
     * a planted foot must remain on the turf regardless of how far the torso
     * is pitched over, so adding `lean` to the swing angle here would
     * double-count it and tilt the stance leg off the ground. */
    const kx = hx + Math.sin(l) * thighLen, ky = hy - Math.cos(l) * thighLen;
    const fx = kx + Math.sin(l - k) * shinLen, fy = ky - Math.cos(l - k) * shinLen;
    // ankle mechanics: rotate the boot card through the stride
    const pitch = footPitch(l, k);
    const ax = fx, ay = fy + 0.075;
    const R = (x: number, y: number) => rotPt(x, y, ax, ay, pitch);
    const bq: [number, number][] = [R(fx - 0.06, fy + 0.1), R(fx + 0.205, fy + 0.1), R(fx + 0.235, fy + 0.005), R(fx - 0.062, fy - 0.01)];
    const sole: [number, number][] = [R(fx - 0.062, fy - 0.01), R(fx + 0.235, fy + 0.005), R(fx + 0.222, fy + 0.032), R(fx - 0.06, fy + 0.016)];
    if (out) {
      limbCard(L, hx, hy, kx, ky, wT, cT, null, lw, seed);
      limbCard(L, kx, ky, fx, fy, wS, cS, null, lw, seed + 1);
      paperCard(ctx, bq.map(([x, y]) => [L.X(x), L.Y(y)] as Pt), cB, { lw, seed, jit: 0.35, round: L.round });
      poly(ctx, sole.map(([x, y]) => [L.X(x), L.Y(y)] as Pt), shade(cB, 1.9));
    } else {
      limbCard(L, hx, hy, kx, ky, wT, cT, null, lw * 0.7, seed, 0);
      limbCard(L, kx, ky, fx, fy, wS, cS, null, lw * 0.7, seed + 1, 0);
      poly(ctx, bq.map(([x, y]) => [L.X(x), L.Y(y)] as Pt), cB);
    }
    return [fx, fy] as const;
  };

  const armChain = (aa: number, e: number, ox: number, w: number, cU: string, cF: string, out: string | null, seed: number, wrapBall: boolean) => {
    const [sx0, sy0] = RL(ox, shY - 0.03);
    const ex = sx0 + Math.sin(aa) * upLen * 0.92, ey = sy0 - Math.cos(aa) * upLen;
    const fAng = aa + (aa < 1.7 ? e : -e * 0.9);
    let hx2 = ex + Math.sin(fAng) * foreLen * 0.92, hy2 = ey - Math.cos(fAng) * foreLen;
    if (wrapBall) {
      const [bx, by] = RL(0.17, shY - 0.16);
      hx2 = bx + 0.02; hy2 = by - 0.02;
    }
    if (out) {
      limbCard(L, sx0, sy0, ex, ey, w, cU, null, lw, seed);
      limbCard(L, ex, ey, hx2, hy2, w * 0.8, cF, null, lw, seed + 1);
      disc(L, hx2, hy2, 0.052 * b.bulk, cF === a.skin ? a.skin : cF, lw * 0.9, seed);
    } else {
      limbCard(L, sx0, sy0, ex, ey, w, cU, null, lw * 0.7, seed, 0);
      limbCard(L, ex, ey, hx2, hy2, w * 0.8, cF, null, lw * 0.7, seed + 1, 0);
    }
    return [ex, ey] as const;
  };

  /* Solve the pelvis drop ONCE, before anything is drawn, from the same
   * kinematics `legChain` uses. Pure arithmetic — no drawing, no side effects. */
  const sideFootY = (l: number, k: number, ox: number): number => {
    const dy = rtS.y - p.hip;
    const hy = p.hip + dy * cl - ox * sl;
    return hy - Math.cos(l) * thighLen - Math.cos(l - k) * shinLen;
  };
  const sideLift = Math.min(
    sideFootY(lN, kN, rtS.sideNear),
    sideFootY(lF - 0.1, kF, rtS.sideFar),
  );

  /* 1 — far paper layer.
     SPEC_17 gave the far leg a hard OUTLINE so the overlapping thigh cards
     would not fuse into the "watermelon" (they overlap with no gap on 75% of
     walk and 67% of jog frames). SPEC_18.1 removes hard outlines, so that
     separation is re-expressed as a VALUE STEP instead of a stroke: the far
     limbs are shaded to the bottom of the depth range (z = -1) and the near
     limbs to the top, which is a measured 1.78-2.62 contrast ratio depending on
     palette — stronger than the stroke it replaces. The rule is unchanged, only
     its encoding: far reads as behind because it is DARKER, not because it is
     ringed. */
  armChain(aF + 0.12, eF, -0.05, 0.08, depthShade(kitF, -1), depthShade(skinF, -1), null, a.seed + 41, false);
  legChain(lF - 0.1, kF, rtS.sideFar, 0.1, 0.068,
    depthShade(shortF, -1), depthShade(sockF, -1), depthShade(bootF, -1), null, a.seed + 43, sideLift);

  // 2 — torso strip (narrow paper card, chest bulge on the front edge)
  const tq: [number, number][] = [
    [-0.086, rtS.y - 0.03], [0.07, rtS.y - 0.03], [0.118, p.hip + b.torso * 0.52],
    [0.074, shY], [-0.082, shY],
  ].map(([x, y]) => RL(x, y));
  paperCard(ctx, tq.map(([x, y]) => [L.X(x), L.Y(y)] as Pt), pal.kit, { lw: lw * 1.05, seed: a.seed + 47, jit: 0.5, back: 1.6, round: L.round });
  // hoop band across the strip
  for (const hy of [0.58, 0.42]) {
    const y0 = p.hip + b.torso * hy;
    const h: [number, number][] = [[-0.084, y0], [0.112, y0], [0.115, y0 + b.torso * 0.08], [-0.085, y0 + b.torso * 0.08]].map(([x, y]) => RL(x, y));
    poly(ctx, h.map(([x, y]) => [L.X(x), L.Y(y)] as Pt), pal.trim);
  }
  crease(ctx, L.X(RL(0.078, p.hip)[0]), L.Y(RL(0.078, p.hip)[1]), L.X(RL(0.082, shY)[0]), L.Y(RL(0.082, shY)[1]), 0.1, Math.max(1, lw * 0.5));
  /* shorts strip — SPEC_17: the hem is cut with a CROTCH NOTCH.
     A flat hem let the skirt bridge the two legs into one mass. A shallow V
     rising between the two roots gives the silhouette a permanent division at
     exactly the place the legs emerge, so the crotch reads even when the
     thighs overlap. The hem also hangs from the shared root now, so only
     0.05 m of card sits below the pivot instead of the measured 0.200 m
     (74.1% of the card) that produced the melon. */
  const hemS = rtS.y - 0.05;
  const notchY = hemS + 0.055;
  const sqp: [number, number][] = [
    [-rtS.sideHalf, rtS.y + 0.07], [rtS.sideHalf * 0.9, rtS.y + 0.07],
    [rtS.sideHalf, hemS], [rtS.sideNear * 0.55, hemS],
    [0, notchY],                                   // the notch apex
    [rtS.sideFar * 0.55, hemS], [-rtS.sideHalf - 0.002, hemS],
  ].map(([x, y]) => RL(x, y));
  paperCard(ctx, sqp.map(([x, y]) => [L.X(x), L.Y(y)] as Pt), pal.shorts, { lw, seed: a.seed + 51, jit: 0.45, round: L.round });

  // 3 — near leg (lit, full stride) — top of the depth range
  legChain(lN, kN, rtS.sideNear, 0.13 * b.bulk, 0.078 * b.bulk,
    depthShade(pal.shorts, 1), depthShade(pal.socks, 1), depthShade('#1c1c24', 1), null, a.seed + 53, sideLift);

  // 4 — head in profile
  const [hdx, hdy] = RL(0.015, shY + 0.08 + b.headR * 0.95);
  const hr = b.headR;
  limbCard(L, RL(0, shY - 0.02)[0], shY - 0.02, hdx - 0.01, hdy - hr * 0.5, 0.064, shade(a.skin, 0.85), OUT, lw * 0.9, a.seed + 57, 0.7);
  disc(L, hdx, hdy, hr, a.skin, lw, a.seed + 59);
  const hx = L.X(hdx), hy = L.Y(hdy);
  // nose wedge
  poly(ctx, [
    [hx + hr * sc * 0.72, hy + hr * sc * 0.16],
    [hx + hr * sc * 1.22, hy - hr * sc * 0.02],
    [hx + hr * sc * 0.7, hy - hr * sc * 0.24],
  ], a.skin);
  // hair cap: back + crown
  ctx.save();
  ctx.beginPath(); ctx.arc(hx, hy, (hr + 0.01) * sc, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = a.cap ? shade(pal.kitDark, 0.7) : a.hair;
  ctx.beginPath();
  ctx.moveTo(hx - (hr + 0.02) * sc, hy - (hr + 0.02) * sc);
  ctx.lineTo(hx + hr * sc * 0.42, hy - (hr + 0.02) * sc);
  ctx.lineTo(hx + hr * sc * 0.18, hy - hr * sc * 0.42);
  ctx.lineTo(hx - hr * sc * 0.28, hy - hr * sc * 0.3);
  ctx.lineTo(hx - hr * sc * 0.34, hy + hr * sc * 0.9);
  ctx.lineTo(hx - (hr + 0.02) * sc, hy + hr * sc * 0.9);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // ear + eye + brow
  disc(L, hdx - hr * 0.12, hdy - hr * 0.05, hr * 0.24, shade(a.skin, 0.82), lw * 0.7, a.seed + 61);
  ctx.fillStyle = '#191922';
  ctx.fillRect(hx + hr * sc * 0.34, hy - hr * sc * 0.06, Math.max(1.3, hr * sc * 0.14), Math.max(1.3, hr * sc * 0.14));
  ctx.strokeStyle = '#191922'; ctx.lineWidth = Math.max(1, lw * 0.6);
  ctx.beginPath();
  ctx.moveTo(hx + hr * sc * 0.26, hy - hr * sc * 0.28);
  ctx.lineTo(hx + hr * sc * 0.56, hy - hr * sc * 0.2);
  ctx.stroke();

  // 5 — deltoid cap gives the profile card shoulder mass, then the near arm
  const dl: [number, number][] = [[-0.02, shY + 0.03], [0.085, shY + 0.01], [0.098, shY - 0.17], [-0.015, shY - 0.15]].map(([x, y]) => RL(x, y));
  paperCard(ctx, dl.map(([x, y]) => [L.X(x), L.Y(y)] as Pt), pal.kitLight, { lw: lw * 0.9, seed: a.seed + 67, jit: 0.4, back: 1.2, round: L.round });
  const wrap = a.carry > 0.4;
  if (wrap) {
    const [bx, by] = RL(0.17, shY - 0.16);
    ballPaper(ctx, L.X(bx), L.Y(by), 0.115 * sc, a.ballSpin * 0.35 + 0.5);
  }
  armChain(aN, eN, 0.02, 0.118 * b.bulk, depthShade(pal.kit, 1), depthShade(a.skin, 1), null, a.seed + 63, wrap);
  if (!wrap && a.carry > 0.02) {
    const [bx, by] = RL(0.15, shY - 0.14);
    ballPaper(ctx, L.X(bx), L.Y(by), 0.115 * sc, a.ballSpin * 0.35 + 0.5);
  }
  // shoulder fold tab
  const [tbx, tby] = RL(0.01, shY - 0.03);
  foldTab(ctx, L.X(tbx), L.Y(tby), 0.1 * sc, 0.045 * sc, pal.kitDark, lw);
}

/* ================================================================== */
/* LYING — face-up / face-down on the turf                             */
/* ================================================================== */

function drawLyingPaper(L: Locals, a: PaperDrawArgs, seeFront: boolean) {
  const { ctx, sc, lw } = L;
  const p = a.pose, b = a.build, pal = a.pal;
  const gs = a.gs, f = a.fore, hd = a.headDir >= 0 ? 1 : -1;
  const shHalf = b.shW * 0.5 * gs, hipHalf = b.hipW * 0.5 * gs;
  const shX = hd * b.torso * 0.95 * f;
  const headX = hd * (b.torso * 0.95 + b.headR * 1.05) * f;
  const y = 0.16; // body centreline height off the turf

  // legs
  const legTo = (kx: number, ky: number, fx2: number, fy2: number, seed: number, soleUp: boolean) => {
    limbCard(L, -hd * 0.05, y - 0.02, kx, ky, 0.14 * b.bulk * gs + 0.04, pal.shorts, OUT, lw, seed);
    limbCard(L, kx, ky, fx2, fy2, 0.1 * b.bulk * gs + 0.03, pal.socks, OUT, lw, seed + 1);
    if (soleUp) {
      paperCard(ctx, [
        [L.X(fx2 - 0.07), L.Y(fy2 + 0.05)], [L.X(fx2 + 0.07), L.Y(fy2 + 0.05)],
        [L.X(fx2 + 0.09), L.Y(fy2 - 0.12)], [L.X(fx2 - 0.05), L.Y(fy2 - 0.12)],
      ], '#1c1c24', { lw, seed, jit: 0.3 });
      poly(ctx, [[L.X(fx2 - 0.05), L.Y(fy2 - 0.02)], [L.X(fx2 + 0.07), L.Y(fy2 - 0.02)], [L.X(fx2 + 0.08), L.Y(fy2 - 0.1)], [L.X(fx2 - 0.04), L.Y(fy2 - 0.1)]], '#c9c2b0');
    } else {
      paperCard(ctx, [
        [L.X(fx2 - 0.06), L.Y(fy2 + 0.06)], [L.X(fx2 + 0.1 * hd + 0.06), L.Y(fy2 + 0.06)],
        [L.X(fx2 + 0.1 * hd + 0.06), L.Y(fy2 - 0.06)], [L.X(fx2 - 0.06), L.Y(fy2 - 0.06)],
      ], '#1c1c24', { lw, seed, jit: 0.3 });
    }
  };
  if (seeFront) {
    legTo(-hd * 0.34 * f, y - (hipHalf + 0.14), -hd * 0.66 * f, y - hipHalf * 0.55, a.seed + 71, false);
    legTo(-hd * 0.42 * f, y + hipHalf * 0.85, -hd * 0.84 * f, y + hipHalf * 1.0, a.seed + 75, false);
  } else {
    legTo(-hd * 0.4 * f, y - hipHalf * 0.9, -hd * 0.82 * f, y - hipHalf * 1.05, a.seed + 71, true);
    legTo(-hd * 0.42 * f, y + hipHalf * 0.8, -hd * 0.86 * f, y + hipHalf * 0.95, a.seed + 75, true);
  }

  // torso slab
  const tq: Pt[] = [
    [-hd * 0.08, y - hipHalf], [-hd * 0.08, y + hipHalf],
    [shX, y + shHalf * 0.96], [shX, y - shHalf * 0.96],
  ].map(([x, yy]) => [L.X(x), L.Y(yy)] as Pt);
  paperCard(ctx, tq, pal.kit, { lw: lw * 1.05, seed: a.seed + 79, jit: 0.55, back: 1.6 });
  // hoops / number
  for (const t of [0.55, 0.72]) {
    const x0 = lerp(-hd * 0.08, shX, t), x1 = lerp(-hd * 0.08, shX, t + 0.1);
    const w0 = lerp(hipHalf, shHalf, t), w1 = lerp(hipHalf, shHalf, t + 0.1);
    poly(ctx, [[L.X(x0), L.Y(y - w0)], [L.X(x0), L.Y(y + w0)], [L.X(x1), L.Y(y + w1)], [L.X(x1), L.Y(y - w1)]], pal.trim);
  }
  if (!seeFront) {
    ctx.save();
    ctx.translate(L.X(lerp(-hd * 0.08, shX, 0.42)), L.Y(y));
    ctx.rotate(hd > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.font = `${Math.max(6, 0.26 * sc)}px ${DISPLAY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, lw * 1.3); ctx.strokeStyle = OUT;
    ctx.strokeText(String(a.num), 0, 0);
    ctx.fillStyle = pal.trim; ctx.fillText(String(a.num), 0, 0);
    ctx.restore();
  }
  // shorts
  poly(ctx, [
    [L.X(-hd * 0.08), L.Y(y - hipHalf - 0.02)], [L.X(-hd * 0.08), L.Y(y + hipHalf + 0.02)],
    [L.X(-hd * 0.3), L.Y(y + hipHalf + 0.02)], [L.X(-hd * 0.3), L.Y(y - hipHalf - 0.02)],
  ], pal.shorts, OUT, lw);

  // arms
  if (seeFront) {
    for (const s of [-1, 1] as const) {
      const ex = shX - hd * 0.1 * f, ey = y + s * (shHalf + 0.1);
      const hx2 = shX - hd * 0.3 * f, hy2 = y + s * (shHalf + 0.32);
      limbCard(L, shX, y + s * shHalf * 0.7, ex, ey, 0.1 * b.bulk, pal.kit, OUT, lw, a.seed + 81 + s);
      limbCard(L, ex, ey, hx2, hy2, 0.08 * b.bulk, a.skin, OUT, lw, a.seed + 83 + s);
      disc(L, hx2, hy2, 0.05, a.skin, lw * 0.9, a.seed + s);
    }
  } else {
    for (const s of [-1, 1] as const) {
      const hx2 = shX + hd * 0.14 * f, hy2 = y + s * 0.13;
      limbCard(L, shX, y + s * shHalf * 0.6, shX - hd * 0.02, y + s * (shHalf * 0.75), 0.09 * b.bulk, pal.kit, OUT, lw, a.seed + 81 + s);
      limbCard(L, shX - hd * 0.02, y + s * (shHalf * 0.75), hx2, hy2, 0.075 * b.bulk, a.skin, OUT, lw, a.seed + 83 + s);
    }
    if (a.carry > 0.4) ballPaper(ctx, L.X(shX + hd * 0.22 * f), L.Y(y - 0.02), 0.11 * sc, 0.4);
  }

  // head
  const hr = b.headR;
  disc(L, headX, y, hr, a.skin, lw, a.seed + 87);
  const hx = L.X(headX), hy = L.Y(y);
  if (seeFront) {
    ctx.save();
    ctx.beginPath(); ctx.arc(hx, hy, hr * sc, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = a.cap ? shade(pal.kitDark, 0.7) : a.hair;
    ctx.fillRect(hx - hr * sc, hy - hr * sc, hr * 2 * sc, hr * sc * 0.7);
    ctx.restore();
    ctx.beginPath(); ctx.arc(hx, hy, hr * sc, 0, Math.PI * 2);
    ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke();
    ctx.fillStyle = '#191922';
    ctx.fillRect(hx - hr * sc * 0.34, hy - hr * sc * 0.05, Math.max(1.3, hr * sc * 0.14), Math.max(1.3, hr * sc * 0.14));
    ctx.fillRect(hx + hr * sc * 0.2, hy - hr * sc * 0.05, Math.max(1.3, hr * sc * 0.14), Math.max(1.3, hr * sc * 0.14));
    ctx.strokeStyle = '#191922'; ctx.lineWidth = Math.max(1, lw * 0.6);
    ctx.beginPath();
    ctx.moveTo(hx - hr * sc * 0.2, hy + hr * sc * 0.42);
    ctx.lineTo(hx + hr * sc * 0.24, hy + hr * sc * 0.36);
    ctx.stroke();
  } else {
    // head turned sideways: hair crown + profile wedge of face
    ctx.save();
    ctx.beginPath(); ctx.arc(hx, hy, (hr + 0.008) * sc, 0, Math.PI * 2);
    ctx.fillStyle = a.cap ? shade(pal.kitDark, 0.7) : a.hair; ctx.fill();
    ctx.restore();
    poly(ctx, [
      [hx + hd * hr * sc * 0.25, hy - hr * sc * 0.72],
      [hx + hd * hr * sc * 0.95, hy - hr * sc * 0.3],
      [hx + hd * hr * sc * 0.8, hy + hr * sc * 0.5],
      [hx + hd * hr * sc * 0.2, hy + hr * sc * 0.6],
    ], a.skin, OUT, lw * 0.9);
    ctx.fillStyle = '#191922';
    ctx.fillRect(hx + hd * hr * sc * 0.5, hy - hr * sc * 0.12, Math.max(1.3, hr * sc * 0.13), Math.max(1.2, hr * sc * 0.1));
  }
  void p;
}

/* ================================================================== */
/* dispatch                                                            */
/* ================================================================== */

export function drawPaperActor(a: PaperDrawArgs) {
  const { ctx, sc } = a;
  const L = makeLocals(ctx, sc, a.seed);
  const p = a.pose;
  const q = carryPose(p, a.carry, a.carryStyle, a.ballSide);
  const args: PaperDrawArgs = { ...a, pose: q };
  ctx.save();
  ctx.translate(a.sx, a.sy);
  /* SPEC_14 — grow the figure about its ground anchor. See FIGURE_SCALE in
   * paper.ts: the builds draw true to life, they were simply too small to read
   * contact against the 1.10 m tackle radius. */
  ctx.scale(FIGURE_SCALE, FIGURE_SCALE);
  if (a.squash) ctx.scale(a.squash.sx, a.squash.sy);   // SPEC_01 impact squash about the foot anchor
  /* SPEC_18.3a — KINETIC SHEAR ("squeeze and pop"), about the FOOT ANCHOR so a
   * leaning figure stays planted. The matrix is
   *     | 1  -tan(theta)  0 |
   *     | 0      1        0 |
   * and -tan is negative because screen-y runs down while the card's Y() maps
   * metres up: a positive theta must throw the TOP of the card forward. Shear
   * is the last transform before the card is drawn and after the squash, so the
   * two compose rather than fight. */
  if (a.lean) ctx.transform(1, 0, -Math.tan(a.lean), 1, 0, 0);
  /* SPEC_18.3b — 3/4 perspective. Only ever applied to the front/back card;
   * the profile card IS the 90 deg view and must not be skewed on top. The
   * narrowing is about the spine (x = 0), which is already the card's origin. */
  if (a.tq && (a.view === 'front' || a.view === 'back')) {
    const sg = a.tqSign ?? 1;
    ctx.transform(a.tq.narrow, 0, -Math.tan(a.tq.shear) * sg, 1, 0, 0);
  }
  const edge = a.view === 'leftEdge' || a.view === 'rightEdge';
  if (edge) ctx.scale(a.spinDir >= 0 ? 1 : -1, 1); // profile faces the actor's screen direction
  const falling = q.fall > 0.01 && q.fall < 0.985;
  if (falling) {
    // tip the standing card over about the hip — seamless into the lying art
    const e = q.fall * q.fall * (3 - 2 * q.fall);
    const dirSign = edge ? 1 : a.spinDir; // post-mirror local +x is the facing side
    const spin = e * (Math.PI / 2) * q.fallD * dirSign + Math.sin(q.fall * Math.PI) * 0.06 * dirSign;
    ctx.translate(0, -q.hip * sc);
    ctx.rotate(spin);
    ctx.translate(0, q.hip * sc);
  }
  switch (a.view) {
    case 'front': drawCoronal(L, args, true); break;
    case 'back': drawCoronal(L, args, false); break;
    case 'rightEdge': drawSidePaper(L, args, true); break;
    case 'leftEdge': drawSidePaper(L, args, false); break;
    case 'lieFaceUp': drawLyingPaper(L, args, true); break;
    case 'lieFaceDown': drawLyingPaper(L, args, false); break;
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * SPEC_14 — THE SHADOW ANCHOR
 *
 * The old shadow had four defects, measured in scripts/spec14probe.ts:
 *
 *   1. `ry = rx * 0.30` was a constant. A circle lying on the turf projects to
 *      ry/rx = sin(tilt) — measured against a real projected ground circle the
 *      truth is 0.61 on the default CABLE rig and 0.68 on CHASE, so the ellipse
 *      was 51-56% too flat. It read as a sliver in front of the feet, not a
 *      pool under them. THAT was the float.
 *   2. It was pinned to the actor's ROOT while the leg rig plants the FOOT,
 *      so the shadow and the feet disagreed by 0.34 m over a stride.
 *   3. The offset `+sc*0.06, +sc*0.02` was a SCREEN-space nudge, so the light
 *      rotated with the camera instead of coming from a fixed direction.
 *   4. It used `p.fall > 0.6` to decide a body was down while the actor's own
 *      artwork used `pg.lie`, so a tipping body kept a standing ellipse.
 *
 * All four are fixed here. The ellipse is now built by projecting a real
 * circle on the turf through the same lens that drew the body, so its minor
 * axis is correct at any tilt or zoom by construction.
 * ------------------------------------------------------------------ */

/** A directional stadium light: metres of shadow offset per metre of caster
 *  height. The caster is the torso, so the shadow falls a little away from
 *  the feet exactly as a real one does. */
const LIGHT_X = 0.040;
const LIGHT_Z = 0.025;

/**
 * Which foot is on the turf, and how far forward of the root it is planted.
 * Mirrors the SPEC_17 leg solution used by the leg cards, so the
 * shadow and the boot agree. Returns metres along the facing axis.
 */
export function plantedFoot(pose: Pose, build: Build, legScale = 1): { forward: number; lift: number } {
  const thigh = build.leg * 0.52 * legScale, shin = build.leg * 0.48 * legScale;
  /* SPEC_17 — mirrors the REWRITTEN coronal leg: foot height is the authored
   * clearance arc, not a forward-kinematic accumulation. Left on the old
   * formula this would have reported swing feet up to 0.92 m in the air and
   * dragged the shadow with them. */
  const swing = (l: number, k: number) => Math.sin(l) * thigh + Math.sin(l - k) * shin;
  const [yL, yR] = groundedClearance(pose.kL, pose.kR);

  /* The anchor is the MIDPOINT of the two feet, not the planted foot itself.
   *
   * Measured, not assumed (scripts/_anchor.ts, 30 s at 60 Hz): following the
   * planted foot alone makes the shadow SNAP from boot to boot every stride —
   * the frame-to-frame jump in the shadow-to-foot distance is worse than the
   * old root anchor at every percentile (p99 9.4 px against 5.5). The midpoint
   * tracks the stride smoothly and is identical to the planted foot whenever
   * the player is standing still, which is when a shadow is actually read.
   *
   * SPEC_14 noted a residual bob here, caused by `pinPlantedFoot` capping its
   * correction at 0.06 m. SPEC_17 removed that helper and grounded the stance
   * foot structurally (`swingClearance`), so the residual is gone at source
   * rather than being compensated for here. */
  return { forward: (swing(pose.lL, pose.kL) + swing(pose.lR, pose.kR)) * 0.5, lift: Math.max(0, Math.min(yL, yR)) };
}

/** Is this figure laid on the turf? Uses the actor's OWN view, not `fall`. */
const isLying = (a: PaperDrawArgs) => a.view === 'lieFaceUp' || a.view === 'lieFaceDown';

/**
 * Where the shadow is cast FROM: the planted foot, or the body centre when the
 * figure is down or in the air. World coordinates, on the turf.
 */
export function groundAnchor(a: PaperDrawArgs): { x: number; z: number } {
  if (isLying(a)) return { x: a.wx, z: a.wz };
  const air = Math.max(0, a.pose.hip - 0.94);
  if (air > 0.02) return { x: a.wx, z: a.wz };          // airborne: under the hip
  const f = plantedFoot(a.pose, a.build, a.legScale ?? 1);
  return { x: a.wx + Math.sin(a.face) * f.forward, z: a.wz + Math.cos(a.face) * f.forward };
}

/** contact shadow: tighter and darker when planted, wide and soft when down */
export function drawPaperShadow(a: PaperDrawArgs) {
  const { ctx, sc } = a;
  const p = a.pose;
  const down = isLying(a);
  const air = Math.max(0, p.hip - 0.94);

  /* The caster height decides both how far the shadow is thrown and how soft
   * it is. A body on the turf casts from almost nothing. */
  /* SPEC_16 — these are LOGICAL-metre quantities projected through `project()`,
   * which now carries RENDER_SCALE. SPEC_14 multiplied them by FIGURE_SCALE to
   * chase a figure that was 1.65x oversize in world terms; with the world
   * scaled to match, the figure's ink measures true (1.86 m of ink for a 1.86 m
   * build), so the shadow must be authored true as well. Keeping FIGURE_SCALE
   * here would leave the shadow 1.65x too wide for the man standing in it. */
  const casterH = down ? 0.35 : Math.max(0.35, p.hip);

  /* World radius of the pool, in metres. */
  const rxM = down ? 0.95 : (0.3 + a.build.shW * 0.32) * (1 + air * 0.9);

  const anchor = groundAnchor(a);
  const ax = anchor.x + LIGHT_X * casterH;
  const az = anchor.z + LIGHT_Z * casterH;

  /* Project a real circle of that radius lying on the turf through the same
   * lens. Its bounding box IS the ellipse: the minor axis now follows the
   * camera tilt for free, at any zoom. */
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, hit = 0;
  let cx = 0, cy = 0;
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    const pr = project(a.cam, a.v, ax + Math.cos(t) * rxM, 0, az + Math.sin(t) * rxM);
    if (!pr) continue;
    cx += pr.sx; cy += pr.sy; hit++;
    if (pr.sx < x0) x0 = pr.sx; if (pr.sx > x1) x1 = pr.sx;
    if (pr.sy < y0) y0 = pr.sy; if (pr.sy > y1) y1 = pr.sy;
  }
  if (hit < 8) return;                       // off the near plane — nothing to draw
  cx /= hit; cy /= hit;
  const rx = Math.max(2, (x1 - x0) * 0.5);
  const ry = Math.max(1.5, (y1 - y0) * 0.5);

  const alpha = down ? 0.3 : Math.max(0.14, 0.36 - air * 0.5);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#081008';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  void sc;
}

/* SPEC_17 — capability flags, read by scripts/spec17probe.ts so the probe can
 * tell a before-run from an after-run without parsing source. */
export const sideLegRouted = true;
export const sideCrotchNotch = true;
