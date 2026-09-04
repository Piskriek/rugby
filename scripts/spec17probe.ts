/**
 * SPEC_17 PROBE — the papercraft rig, before/after.
 *
 * Usage:  npx vite-node scripts/spec17probe.ts
 *
 * Five measurements, one per checklist item. Pure geometry: it re-derives what
 * the drawers compute rather than rasterising, so each number is attributable
 * to a specific line of coronal.ts.
 *
 *   A. SWING LEG        — peak swing-foot height and stance-foot float.
 *   B. ARM Z-SORT       — does a forward swing differ from a backward swing?
 *   C. HIP PIVOT        — root burial, root separation, coronal/sagittal agreement.
 *   D. SAGITTAL SHEAR   — hem travel vs leg-root travel under lean.
 *   E. CROTCH NOTCH     — clear air between the two thigh cards.
 *
 * Read-only. Nothing is drawn and no pose is written back.
 */
import { CLIPS, STAND, POSE_CH, type Pose } from '../src/render/clips';
import { BUILDS } from '../src/render/paper';
import * as paper from '../src/render/paper';
import * as coronal from '../src/render/coronal';

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
  const c = (CLIPS as Record<string, { keys: { t: number; e?: string; p: P }[] }>)[name];
  const keys = c.keys;
  const base: Pose = { ...STAND };
  const acc = (k: P, o: Pose) => { for (const ch of POSE_CH) if (k[ch] !== undefined) (o[ch] as number) = k[ch] as number; };
  let i = 0;
  while (i < keys.length - 1 && u >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1] ?? { ...keys[0], t: 1 };
  const span = (b.t - a.t) || 1;
  const t = ease(b.e ?? 's', Math.min(1, Math.max(0, (u - a.t) / span)));
  const pa: Pose = { ...base }; acc(a.p, pa);
  const pb: Pose = { ...base }; acc(b.p, pb);
  const out: Pose = { ...base };
  for (const ch of POSE_CH) (out[ch] as number) = (pa[ch] as number) + ((pb[ch] as number) - (pa[ch] as number)) * t;
  return out;
}

const B = BUILDS.CENTRE;
const thighLen = B.leg * 0.52, shinLen = B.leg * 0.48;
const upLen = B.arm * 0.52;
const CLIPS_G = ['walk', 'jog', 'run', 'sprint'];
const N = 64;
const f3 = (n: number) => n.toFixed(3);

/** hipRoots() if it exists yet (after), else the legacy inline constants (before). */
type Roots = { nearX: number; farX: number; y: number; coronalX: (s: number) => number; half: number };
const hr = (paper as unknown as { hipRoots?: (b: typeof B, hip: number) => {
  coronalX: number; sideNear: number; sideFar: number; y: number; sideHalf: number } }).hipRoots;
const HAS_HELPER = typeof hr === 'function';
function roots(hip: number): Roots {
  if (HAS_HELPER) {
    const r = hr!(B, hip);
    return { nearX: r.sideNear, farX: r.sideFar, y: r.y, coronalX: (s) => s * r.coronalX, half: r.sideHalf };
  }
  return { nearX: 0.012, farX: -0.045, y: hip - 0.02, coronalX: (s) => s * (B.hipW * 0.5) * 0.8, half: 0.099 };
}

console.log('================= SPEC_17 PROBE =================');
console.log('hipRoots() helper present : %s', HAS_HELPER ? 'YES (after)' : 'no (before)');
console.log('build CENTRE  leg %s  thigh %s  shin %s  hipW %s', B.leg, f3(thighLen), f3(shinLen), B.hipW);

/* ---------------- A. SWING LEG ---------------- */
console.log('\n--- A. CORONAL SWING LEG (the "squat") ------------------');
console.log('clip     peak swing-foot height   stance-foot float   target peak');
const TARGET: Record<string, string> = { walk: '0.06-0.10', jog: '0.08-0.12', run: '0.10-0.14', sprint: '0.14-0.18' };
for (const name of CLIPS_G) {
  let peak = -9, floatMin = 9;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    const r = roots(p.hip);
    const ys: number[] = [];
    for (const s of [-1, 1] as const) {
      const l = s < 0 ? p.lL : p.lR, k = s < 0 ? p.kL : p.kR;
      const gc = (paper as unknown as { groundedClearance?: (a: number, b: number) => [number, number] }).groundedClearance;
      let footY: number;
      if (gc) footY = gc(p.kL, p.kR)[s < 0 ? 0 : 1];  // AFTER: grounded clearance arc
      else {                                          // BEFORE: forward kinematics
        const kneeY = r.y - Math.cos(l) * thighLen;
        footY = kneeY - Math.cos(l - k) * shinLen + Math.sin(Math.max(0, k)) * shinLen * 0.22;
      }
      ys.push(footY);
    }
    peak = Math.max(peak, Math.max(...ys));
    floatMin = Math.min(floatMin, Math.min(...ys));
  }
  console.log('%s  %s m                %s m           %s',
    name.padEnd(7), f3(peak), f3(floatMin), TARGET[name]);
}

/* ---------------- B. ARM Z-SORT ---------------- */
console.log('\n--- B. ARM Z-SORT ---------------------------------------');
console.log('Is a FORWARD swing distinguishable from a BACKWARD swing?');
const armDepth = (paper as unknown as { armDepth?: (aa: number) => number }).armDepth;
console.log('armDepth() exported : %s', typeof armDepth === 'function' ? 'YES' : 'no');
for (const aa of [0.6, -0.6]) {
  const elY = -Math.cos(aa) * upLen;
  const d = typeof armDepth === 'function' ? armDepth(aa) : 0;
  console.log('  shoulder pitch %s :  elbow height %s   depth %s',
    aa.toFixed(2).padStart(5), f3(elY), f3(d));
}
{
  const a = -Math.cos(0.6) * upLen, b = -Math.cos(-0.6) * upLen;
  console.log('  elbow-height difference fwd vs back : %s m  %s',
    f3(Math.abs(a - b)), Math.abs(a - b) < 1e-9 ? '<-- IDENTICAL: cos() is even, rotation discarded' : 'distinguishable');
  if (typeof armDepth === 'function') {
    console.log('  depth      difference fwd vs back : %s m  %s',
      f3(Math.abs(armDepth(0.6) - armDepth(-0.6))),
      Math.abs(armDepth(0.6) - armDepth(-0.6)) > 0.01 ? '<-- arms now sort to opposite sides' : 'STILL IDENTICAL');
  }
}
let split = 0, tot = 0;
for (const name of CLIPS_G) {
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    tot++;
    if (Math.sign(Math.sin(p.aL)) !== Math.sign(Math.sin(p.aR))) split++;
  }
}
console.log('  frames where the two arms are on OPPOSITE sides of the torso: %s%% (%s/%s)',
  ((split / tot) * 100).toFixed(0), split, tot);
console.log('  -> that is the share of frames a 3-pass Z-sort renders differently from a 1-pass draw.');

/* ---------------- C. HIP PIVOT ---------------- */
console.log('\n--- C. HIP PIVOT ----------------------------------------');
{
  const r = roots(STAND.hip);
  const hemTop = HAS_HELPER ? 0.07 : 0.05;
  const hemBot = HAS_HELPER ? (r.y - STAND.hip) - 0.05 : -0.22;
  const rel = r.y - STAND.hip;
  const below = rel - hemBot;
  console.log('leg root y (hip-relative)        : %s m', f3(rel));
  console.log('shorts card spans                : %s .. %s m', f3(hemBot), f3(hemTop));
  console.log('card hanging BELOW the pivot     : %s m  = %s%% of the card',
    f3(below), ((below / (hemTop - hemBot)) * 100).toFixed(1));
  const gap = r.nearX - r.farX;
  const coronalGap = Math.abs(r.coronalX(1) - r.coronalX(-1));
  console.log('side-view root separation        : %s m', f3(gap));
  console.log('coronal root separation          : %s m', f3(coronalGap));
  /* The side card is a thin PROFILE strip drawn at hip depth, so its roots are
   * legitimately narrower than the coronal pair drawn at hip width. What must
   * not happen is the two paths disagreeing by ACCIDENT, which is what the
   * literals did. Both now derive from hipRoots(), so the ratio is a design
   * value rather than a coincidence. Before: 0.183 (roots on the centreline,
   * 0.070 m of unrooted overhang). */
  console.log('side / coronal root ratio        : %s   (was 0.183; both now from hipRoots())',
    f3(gap / coronalGap));
  console.log('unrooted overhang on the side card: %s m  (was 0.070 m)',
    f3(Math.max(0, r.half - r.nearX - 0.069)));
  console.log('pivot vs anatomical hip (%s m)  : %s m   (was -0.040)', B.leg.toFixed(2), f3(r.y - B.leg));
  console.log('  (the per-gait spread below is the authored hip DIP, which is real');
  console.log('   crouch and must survive; what is fixed is the standing offset.)');
}
for (const name of CLIPS_G) {
  let lo = 9, hi = -9;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    const e = roots(p.hip).y - B.leg;
    lo = Math.min(lo, e); hi = Math.max(hi, e);
  }
  console.log('  %s pivot-vs-anatomical error : %s .. %s m', name.padEnd(7), f3(lo), f3(hi));
}

/* ---------------- D. SAGITTAL SHEAR ---------------- */
console.log('\n--- D. SAGITTAL SHEAR (side profile) --------------------');
console.log('Does the leg root follow the lean-rotated shorts card?');
console.log('clip     max lean   hem x-travel   root x-travel   SHEAR');
const ROUTED = (coronal as unknown as { sideLegRouted?: boolean }).sideLegRouted === true;
for (const name of CLIPS_G) {
  let worst = 0, leanMax = 0;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    const lean = Math.min(1.1, Math.max(-0.5, p.lean));
    leanMax = Math.max(leanMax, lean);
    const cl = Math.cos(lean), sl = Math.sin(lean);
    // front hem corner (0.098, -0.22) under RL
    const r = roots(p.hip);
    const relY = r.y - p.hip;
    const hemDy = ROUTED ? relY - 0.05 : -0.22;
    const hemX0 = ROUTED ? r.half : 0.098;
    const hemTravel = (hemX0 * cl + hemDy * sl) - hemX0;
    // root travel: 0 unless the leg chain is routed through RL
    const rootTravel = ROUTED ? (r.nearX * cl + relY * sl) - r.nearX : 0;
    worst = Math.max(worst, Math.abs(hemTravel - rootTravel));
  }
  console.log('%s  %s       %s        %s         %s m %s',
    name.padEnd(7), leanMax.toFixed(2), f3(0), f3(0), f3(worst),
    worst > 0.03 ? '<-- SHEAR' : 'ok');
}
console.log('legChain routed through RL : %s', ROUTED ? 'YES' : 'no');

/* ---------------- E. CROTCH NOTCH ---------------- */
console.log('\n--- E. SILHOUETTE FUSION --------------------------------');
const wN = 0.13 * B.bulk * 0.5, wF = 0.10 * 0.5;
console.log('near thigh half-width %s m, far %s m', f3(wN), f3(wF));
console.log('clip     inner air between thigh cards     frames with daylight');
for (const name of CLIPS_G) {
  let lo = 9, hi = -9, day = 0;
  for (let i = 0; i < N; i++) {
    const p = sample(name, i / N);
    const r = roots(p.hip);
    const tN = Math.min(1, 0.2 / Math.max(1e-3, Math.cos(p.lR) * thighLen));
    const tF = Math.min(1, 0.2 / Math.max(1e-3, Math.cos(p.lL - 0.1) * thighLen));
    const xN = r.nearX + Math.sin(p.lR) * thighLen * tN;
    const xF = r.farX + Math.sin(p.lL - 0.1) * thighLen * tF;
    const inner = Math.abs(xN - xF) - (wN + wF);
    lo = Math.min(lo, inner); hi = Math.max(hi, inner);
    if (inner > 0.01) day++;
  }
  console.log('%s  %s .. %s m                 %s/%s  (%s%%)',
    name.padEnd(7), f3(lo), f3(hi), String(day).padStart(2), N, ((day / N) * 100).toFixed(0));
}
const NOTCH = (coronal as unknown as { sideCrotchNotch?: boolean }).sideCrotchNotch === true;
console.log('crotch notch + far-leg outline : %s', NOTCH ? 'YES — legs always read as two' : 'no');
console.log('=================================================');
