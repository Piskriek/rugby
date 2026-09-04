/**
 * SPEC_17 probe — side-profile hip pivot ("watermelon crotch").
 * READ-ONLY. Re-derives the exact geometry of drawSidePaper (coronal.ts:329+)
 * for the gait clips and reports where the leg roots sit relative to the
 * shorts card. No engine file is imported for mutation; nothing is drawn.
 */
import { CLIPS, STAND, POSE_CH, type Pose } from '../src/render/clips';
import { BUILDS } from '../src/render/paper';

type P = Partial<Pose>;
function ease(e: string, t: number): number {
  switch (e) {
    case 'l': return t;
    case 'o': return 1 - (1 - t) * (1 - t);
    case 'i': return t * t;
    default: return t * t * (3 - 2 * t);
  }
}
function sample(name: string, u: number): Pose {
  const c = (CLIPS as any)[name];
  const keys = c.keys as { t: number; e?: string; p: P }[];
  const base: Pose = { ...STAND };
  const acc = (k: P, o: Pose) => { for (const ch of POSE_CH) if (k[ch] !== undefined) (o as any)[ch] = k[ch]; };
  let i = 0;
  while (i < keys.length - 1 && u >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1] ?? { ...keys[0], t: 1 };
  const span = (b.t - a.t) || 1;
  const t = ease(b.e ?? 's', Math.min(1, Math.max(0, (u - a.t) / span)));
  const pa: Pose = { ...base }; acc(a.p, pa);
  const pb: Pose = { ...base }; acc(b.p, pb);
  const out: Pose = { ...base };
  for (const ch of POSE_CH) (out as any)[ch] = (pa as any)[ch] + ((pb as any)[ch] - (pa as any)[ch]) * t;
  return out;
}

// --- drawSidePaper geometry, transcribed verbatim ---------------------------
const B = BUILDS.CENTRE;
const legScale = 1;
const thighLen = B.leg * 0.52 * legScale, shinLen = B.leg * 0.48 * legScale;
const NEAR_OX = 0.012, FAR_OX = -0.045;          // leg roots (x, metres)
const SHORTS: [number, number][] = [             // shorts strip, hip-relative
  [-0.095, 0.05], [0.088, 0.05], [0.098, -0.22], [-0.1, -0.22],
];
const TORSO_BOT: [number, number][] = [[-0.086, -0.05], [0.07, -0.05]];

function RL(x: number, dy: number, lean: number): [number, number] {
  const cl = Math.cos(lean), sl = Math.sin(lean);
  return [x * cl + dy * sl, dy * cl - x * sl];    // returns hip-relative y
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function inPoly(px: number, py: number, poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const clips = ['walk', 'jog', 'run', 'sprint'];
const N = 48;

console.log('build CENTRE: leg=%s thigh=%s shin=%s torso=%s hipW=%s',
  B.leg, thighLen.toFixed(3), shinLen.toFixed(3), B.torso, B.hipW);
console.log('\n=== A. static hip-pivot placement (hip-relative metres) ===');
console.log('leg root y            : -0.020  (both legs, LEAN NOT APPLIED)');
console.log('shorts card top y     : +0.050');
console.log('shorts card bottom y  : -0.220');
console.log('root depth below hem  : %s m of shorts card hangs BELOW the pivot',
  (0.22 - 0.02).toFixed(3));
console.log('root buried above hem : %s%% of the shorts card height is below the pivot',
  (((0.22 - 0.02) / 0.27) * 100).toFixed(1));
console.log('near/far root x gap   : %s m   (shorts card width %s m)',
  (NEAR_OX - FAR_OX).toFixed(3), (0.098 + 0.1).toFixed(3));
console.log('gap / card width      : %s  (coronal equivalent: %s)',
  ((NEAR_OX - FAR_OX) / 0.198).toFixed(3),
  ((2 * B.hipW * 0.5 * 0.8) / (B.hipW + 0.03)).toFixed(3));

console.log('\n=== B. lean decoupling: shorts card is lean-rotated, legs are not ===');
console.log('clip     lean   hem-back dx  hem-front dx  pivot->hem-back  pivot->nearest-edge  root inside card');
for (const name of clips) {
  let worstBack = 0, worstFront = 0, worstEdge = 99, leanMax = 0, inside = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    const lean = Math.min(1.1, Math.max(-0.5, p.lean));
    leanMax = Math.max(leanMax, lean);
    const rot = SHORTS.map(([x, y]) => RL(x, y, lean)) as [number, number][];
    worstBack = Math.max(worstBack, Math.abs(rot[3][0] - SHORTS[3][0]));
    worstFront = Math.max(worstFront, Math.abs(rot[2][0] - SHORTS[2][0]));
    for (const ox of [NEAR_OX, FAR_OX]) {
      let d = 99;
      for (let k = 0, j = rot.length - 1; k < rot.length; j = k++)
        d = Math.min(d, segDist(ox, -0.02, rot[j][0], rot[j][1], rot[k][0], rot[k][1]));
      worstEdge = Math.min(worstEdge, d);
      if (inPoly(ox, -0.02, rot)) inside++;
      n++;
    }
  }
  console.log('%s  %s   %s        %s        %s            %s               %s%%',
    name.padEnd(7), leanMax.toFixed(2), worstBack.toFixed(3), worstFront.toFixed(3),
    (0.22 - 0.02).toFixed(3), worstEdge.toFixed(3), ((inside / n) * 100).toFixed(0));
}

console.log('\n=== C. crotch occlusion: does anything separate the two legs? ===');
console.log('clip     max |x| separation of the two knees   thigh card half-width   overlap frames');
for (const name of clips) {
  let sepMax = 0, sepMin = 9, overlap = 0;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    const kNx = NEAR_OX + Math.sin(p.lR) * thighLen;
    const kFx = FAR_OX + Math.sin(p.lL - 0.1) * thighLen;
    const s = Math.abs(kNx - kFx);
    sepMax = Math.max(sepMax, s); sepMin = Math.min(sepMin, s);
    if (s < 0.13 * B.bulk) overlap++;
  }
  console.log('%s  max %s  min %s      %s                 %s/%s',
    name.padEnd(7), sepMax.toFixed(3), sepMin.toFixed(3),
    (0.13 * B.bulk * 0.5).toFixed(3), overlap, N);
}

console.log('\n=== D. hip-height truth: where should the pivot be? ===');
const anat = B.leg;                      // greater trochanter ≈ leg length above ground
console.log('authored pose hip channel (stand)   : %s m', STAND.hip);
console.log('leg root as drawn                   : %s m', (STAND.hip - 0.02).toFixed(3));
console.log('anatomical hip joint (= leg length) : %s m', anat.toFixed(3));
console.log('error                               : %s m  (%s%% of leg)',
  (STAND.hip - 0.02 - anat).toFixed(3), (((STAND.hip - 0.02 - anat) / anat) * 100).toFixed(1));
for (const name of clips) {
  let lo = 9, hi = -9;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    lo = Math.min(lo, p.hip - 0.02 - anat); hi = Math.max(hi, p.hip - 0.02 - anat);
  }
  console.log('%s  pivot-vs-anatomical error range: %s .. %s m',
    name.padEnd(7), lo.toFixed(3), hi.toFixed(3));
}

console.log('\n=== E. the lozenge: silhouette between the hem and the thighs ===');
// thigh card half-width in side view: wT = 0.13*bulk (near), 0.10 (far)
const wN = 0.13 * B.bulk * 0.5, wF = 0.10 * 0.5;
console.log('near thigh half-width %s m, far %s m, hem half-width %s m',
  wN.toFixed(3), wF.toFixed(3), (0.198 / 2).toFixed(3));
console.log('clip     thigh-x at hem depth (y=-0.22)   inner notch width   notch frames');
for (const name of clips) {
  let notchMin = 9, notchMax = -9, notched = 0;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    const tN = Math.min(1, 0.2 / Math.max(1e-3, Math.cos(p.lR) * thighLen));
    const tF = Math.min(1, 0.2 / Math.max(1e-3, Math.cos(p.lL - 0.1) * thighLen));
    const xN = NEAR_OX + Math.sin(p.lR) * thighLen * tN;
    const xF = FAR_OX + Math.sin(p.lL - 0.1) * thighLen * tF;
    const inner = Math.abs(xN - xF) - (wN + wF);   // clear air between the two thigh cards
    notchMin = Math.min(notchMin, inner); notchMax = Math.max(notchMax, inner);
    if (inner > 0.01) notched++;
  }
  console.log('%s  inner air %s .. %s m        %s/%s frames show daylight',
    name.padEnd(7), notchMin.toFixed(3), notchMax.toFixed(3), notched, N);
}
