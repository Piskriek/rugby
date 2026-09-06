/**
 * CONTACT — the "hands like magnets" tackle/breakdown tech (pure core).
 *
 * Everything a tackle→breakdown needs that is NOT the recorded fall physics
 * lives here as small, deterministic, seed-stable pure functions:
 *
 *   1. WRAP DUEL — in the instant after the hit the tackler's hands seek the
 *      ball (magnet hands) while the carrier's hands clamp it. One roll per
 *      tackle decides: strip (RIP), knock-on (KNOCK), defender hold-up
 *      (HOLDUP) or carrier retains and presents (KEEP).
 *   2. BREAKDOWN CONTEST — once the carrier is down and presenting, the
 *      first defender to arrive (jackal) races the first attacker (cleaner).
 *      One roll decides: clean-out (CLEAN), jackal steal (STEAL), attack
 *      holds without dominance (SLOW), or a law call (PEN…).
 *   3. BALL OUT — the recycle speed and who owns the ball follow from the
 *      contest ledger, never from a wall clock.
 *   4. 2-BONE ARM IK — closed-form shoulder/elbow solver so a hand can be
 *      *aimed* at the ball from any stance (one bone solves the upper arm,
 *      the second folds the forearm so the wrist meets the target). Pure
 *      arithmetic: no iteration, no THREE dependency.
 *
 * Determinism is total: every duel consumes exactly one dice value u∈[0,1),
 * so the whole contest ledger is a pure function of (stats, positions, u).
 * A recorded 3-D layer can stage the exact outcome; the headless engine can
 * replay it; nothing integrates per frame.
 */

/* ---------------------------------------------------------------- types -- */
/** Physical/technical profile, 0..100 (engine stats, corpus scale). */
export interface Tech {
  pwr: number;   // strength: tackle drive, clean-out power, rip force
  skl: number;   // skill: ball security, jackal timing, strip timing
  spd: number;   // foot speed (arrival races)
  ttl: number;   // tenacity/aggression: how hard he keeps coming
}

export type WrapOutcome = 'KEEP' | 'RIP' | 'KNOCK' | 'HOLDUP';
export type ContestOutcome = 'CLEAN' | 'STEAL' | 'SLOW' | 'PEN_ATK' | 'PEN_DEF';
export type BallOut = 'QUICK' | 'NORMAL' | 'SLOW' | 'TURNOVER' | 'PEN_ATK' | 'PEN_DEF';

export interface Duel {
  outcome: string;
  reason: string;
  u: number;          // the dice consumed (recorded for replay/staging)
}

export interface WrapCtx {
  carrier: Tech;
  tackler: Tech;
  /** attacking support inside ~6 m (offload / second-man help). */
  support: number;
  /** defenders inside ~6 m other than the tackler. */
  cover: number;
  /** carrier momentum 0..1 (harder to rip a man running at full tilt). */
  momentum: number;
  /** is the tackler a diving smother (arms wrapped, less strip room)? */
  smother: boolean;
}

export interface ContestCtx {
  jackal: Tech;
  cleaner: Tech;
  /** extra committed bodies per side after the first pair. */
  jackalSupport: number;
  cleanerSupport: number;
  /** jackal's head start over the cleaner, seconds (arrival margin). */
  jackalLead: number;
  /** how cleanly the carrier presented (0 slow/awkward … 1 instant). */
  presentation: number;
  /** attack momentum: dominant carry into contact (0..1). */
  momentum: number;
}

/* ------------------------------------------------------------- helpers --- */
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Deterministic dice from a seed (splitmix finalizer — no state). */
export const hashU = (seed: number): number => {
  let x = seed >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
};
/** Arrival time for a man covering `d` metres at `spd` (0..100), with the
 *  first few strides of acceleration. */
export const arrivalT = (d: number, spd: number): number => {
  const top = 5.2 + (spd / 100) * 4.0;      // matches engine topSpeed scale
  const cruise = Math.max(2.6, d - 2.2);
  return (cruise / top) + (d > 2.2 ? 0.55 : d / 3.2); // accel + approach
};

/* ---------------------------------------------------------- WRAP DUEL ---- */
/** The instant after impact: tackler's hands to the ball vs carrier's clamp.
 *  Pure: one dice u decides everything. */
export function resolveWrapDuel(c: WrapCtx, u: number): Duel {
  const carry = (c.carrier.skl * 0.55 + c.carrier.pwr * 0.45) / 100;
  const steal = (c.tackler.skl * 0.6 + c.tackler.pwr * 0.4) / 100;
  const supportBonus = clamp(1 + c.support * 0.05 - c.cover * 0.06, 0.7, 1.4);
  const momentumPen = 1 - c.momentum * 0.25;     // moving ball is hard to rip
  // base chance the wrap actually lands a hand on the ball cleanly
  const contactP = clamp(0.5 + steal * 0.4 - (c.smother ? 0.12 : 0), 0.15, 0.92);
  if (u > contactP) {
    return { outcome: 'KEEP', reason: 'wrap never got a hand on the ball', u };
  }
  // a hand is on it — carrier's clamp vs the rip. Rates are calibrated to
  // real rugby: an even contest almost always survives (KEEP ≈ 93-96%),
  // a genuine mismatch (elite tackler, clumsy isolated carrier) is where
  // rips actually happen — and even there a two-handed clamp wins most.
  const mismatch = steal - carry;
  const ripP = clamp(0.009 + mismatch * 0.8 - c.momentum * 0.05
    + (c.support - c.cover) * 0.02 + (c.smother ? -0.02 : 0.03), 0.004, 0.11);
  // knock-ons in the tackle are genuinely rare in real rugby (~1-2% of
  // tackles); the pass-catch errors carry most of the match's handling toll.
  const knockP = clamp(0.003 + (0.9 - carry) * 0.08 + (1 - c.carrier.skl / 100) * 0.03, 0.002, 0.045);
  const holdP = clamp(0.004 + Math.max(0, 0.75 - c.carrier.pwr / 100) * 0.2, 0.002, 0.1);
  const r = u / contactP;                        // re-normalised inside the grab
  if (r < ripP) return { outcome: 'RIP', reason: 'ripped in the tackle', u };
  if (r < ripP + knockP) return { outcome: 'KNOCK', reason: 'knocked loose in the tackle', u };
  if (r < ripP + knockP + holdP) {
    return { outcome: 'HOLDUP', reason: 'held up — no release', u };
  }
  return { outcome: 'KEEP', reason: 'carrier clamps and presents', u };
}

/* ----------------------------------------------------- BREAKDOWN --------- */
/** One clean-out/jackal contest at the ball. The jackal got there first (his
 *  hands are on the ball); the cleaner arrives and either drives him off,
 *  gets driven himself, or the mass holds and the nine digs it out. */
export function resolveContest(c: ContestCtx, u: number): Duel {
  const jackP = (c.jackal.skl * 0.55 + c.jackal.pwr * 0.45) / 100;
  const cleanP = (c.cleaner.pwr * 0.6 + c.cleaner.ttl * 0.4) / 100;
  // arrival lead matters: a settled jackal is very hard to shift
  const lead = clamp(c.jackalLead, -1.2, 1.6);
  const settled = clamp(0.4 + lead * 0.35, 0.15, 1.0);
  const numbers = clamp(1 + (c.jackalSupport - c.cleanerSupport) * 0.22, 0.6, 1.5);
  const pres = c.presentation;
  const mom = c.momentum;
  // raw contest scores
  const jackScore = jackP * settled * numbers * (1 + (1 - pres) * 0.3);
  const cleanScore = (cleanP + mom * 0.22) * clamp(1 - lead * 0.25, 0.7, 1.3)
    * (c.cleanerSupport >= c.jackalSupport ? 1.15 : 1);
  const t = clamp(cleanScore - jackScore, -1, 1);        // + cleaner favoured
  // jackal steals when he is genuinely better, earlier and/or better
  // supported — an even, on-time clean usually drives him off.
  const f = 0.5 * (1 - t);                                // 0 cleaner…1 jackal
  const stealP = clamp(0.04 + 0.3 * f + 0.1 * clamp(lead, 0, 1.6), 0.03, 0.5);
  const atkPenP = clamp(0.02 + (1 - c.cleaner.ttl / 100) * 0.05 + Math.max(0, -t) * 0.1, 0.01, 0.16);
  const defPenP = clamp(0.02 + (1 - c.jackal.skl / 100) * 0.05, 0.01, 0.12);
  if (u < stealP) {
    return { outcome: 'STEAL', reason: u < stealP * 0.45
      ? 'jackal holds on and wins the turnover'
      : 'jackal rips as the clean arrives — turnover', u };
  }
  const r = (u - stealP) / (1 - stealP);
  if (r < atkPenP) {
    return { outcome: 'PEN_ATK', reason: 'cleaner never released — penalty', u };
  }
  if (r < atkPenP + defPenP) {
    return { outcome: 'PEN_DEF', reason: 'jackal hands in the ruck — penalty', u };
  }
  const rr = (r - atkPenP - defPenP) / (1 - atkPenP - defPenP);
  const dominance = 0.5 + (t * 0.5);                     // 0..1 clean dominance
  if (rr < dominance && t > -0.25) {
    return { outcome: 'CLEAN', reason: 'dominant clean-out — quick ball', u };
  }
  return { outcome: 'SLOW', reason: 'ruck holds — slow ball at best', u };
}

/* ---------------------------------------------------------- BALL OUT ----- */
/** Recycle label from the contest result + how long the ball sat under the
 *  pile. Pure mapping — the visual/engine both call this so the ledger's
 *  story and the clock agree. */
export function ballOut(contest: ContestOutcome, heldSeconds: number): { out: BallOut; at: number } {
  switch (contest) {
    case 'STEAL': return { out: 'TURNOVER', at: 0 };
    case 'PEN_ATK': case 'PEN_DEF': return { out: contest === 'PEN_ATK' ? 'PEN_ATK' : 'PEN_DEF', at: 0 };
    case 'CLEAN':
      return { out: heldSeconds < 0.9 ? 'QUICK' : heldSeconds < 2.0 ? 'NORMAL' : 'SLOW', at: heldSeconds };
    case 'SLOW':
      return { out: heldSeconds < 1.6 ? 'NORMAL' : 'SLOW', at: heldSeconds };
  }
}

/* ------------------------------------------------------- 2-BONE ARM IK --- */
export interface ArmIK {
  /** axis + angle (radians) the UPPER arm rotates about, world frame. */
  shoulderAxis: { x: number; y: number; z: number };
  shoulderAngle: number;
  /** axis + angle the FOREARM rotates about (elbow flexion), world frame. */
  elbowAxis: { x: number; y: number; z: number };
  elbowAngle: number;
  reachable: boolean;
  /** new wrist position (the solved target, clamped to the reach shell). */
  wrist: { x: number; y: number; z: number };
}

const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (v: { x: number; y: number; z: number }) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const rotVec = (v: { x: number; y: number; z: number }, ax: { x: number; y: number; z: number }, ang: number) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const d = ax.x * v.x + ax.y * v.y + ax.z * v.z;
  return {
    x: v.x * c + (ax.y * v.z - ax.z * v.y) * s + ax.x * d * (1 - c),
    y: v.y * c + (ax.z * v.x - ax.x * v.z) * s + ax.y * d * (1 - c),
    z: v.z * c + (ax.x * v.y - ax.y * v.x) * s + ax.z * d * (1 - c),
  };
};

/**
 * Solve an arm (shoulder S → elbow E → wrist W) so the wrist reaches T.
 * Closed-form 2-bone IK in the plane of (S, E, T):
 *   1. rotate the whole arm about n̂ = (S→E)×(S→T) until the angle at S
 *      between the upper arm and S→T is the law-of-cosines value α,
 *   2. flex the elbow so the forearm meets the target exactly.
 * The ± plane choice keeps the elbow on the side it is already on (continuity),
 * so the arm never flips between frames. Expressed in world vectors; the
 * caller (a rig) converts the returned world rotations into local bone space.
 */
export function solveArmIK(
  S: { x: number; y: number; z: number },
  E: { x: number; y: number; z: number },
  W: { x: number; y: number; z: number },
  T: { x: number; y: number; z: number },
  _side: 1 | -1,          // reserved: elbow-chirality bias for the visual layer
  _bendBias = 0.5,
): ArmIK {
  const L1 = len(sub(E, S)) || 1e-6;
  const L2 = len(sub(W, E)) || 1e-6;
  const u1 = norm(sub(E, S));
  const f1raw = norm(sub(W, E));
  const toT = sub(T, S);
  let c = len(toT);
  const minReach = Math.max(0.02, Math.abs(L1 - L2) + 0.02);
  const maxReach = (L1 + L2) * 0.999;
  const reachable = c <= L1 + L2 && c >= Math.abs(L1 - L2);
  c = clamp(c, minReach, maxReach);
  const dir = { x: toT.x / (c || 1), y: toT.y / (c || 1), z: toT.z / (c || 1) };
  const T2 = { x: S.x + dir.x * c, y: S.y + dir.y * c, z: S.z + dir.z * c };

  // ---- elbow on the circle of points at distance L1 from S and L2 from T2
  // centre along the S→T axis, radius r; pick the point closest to the arm's
  // current elbow (continuity — the arm never flips between frames).
  const x = clamp((L1 * L1 - L2 * L2 + c * c) / (2 * c), -c * 2, c * 2);
  const Cc = { x: S.x + dir.x * x, y: S.y + dir.y * x, z: S.z + dir.z * x };
  const r2 = Math.max(0, L1 * L1 - x * x);
  const r = Math.sqrt(r2);
  // orthonormal basis of the plane perpendicular to dir
  const pole = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const e1 = norm(cross(dir, pole));
  const e2 = cross(dir, e1);
  // project the current elbow onto the circle plane to keep continuity
  const q = sub(E, Cc);
  const qp = { x: q.x - dir.x * dot(q, dir), y: q.y - dir.y * dot(q, dir), z: q.z - dir.z * dot(q, dir) };
  const qd = len(qp);
  const phi = qd > 1e-6 ? Math.atan2(dot(qp, e2), dot(qp, e1)) : 0;
  const E2 = {
    x: Cc.x + r * (e1.x * Math.cos(phi) + e2.x * Math.sin(phi)),
    y: Cc.y + r * (e1.y * Math.cos(phi) + e2.y * Math.sin(phi)),
    z: Cc.z + r * (e1.z * Math.cos(phi) + e2.z * Math.sin(phi)),
  };
  const u2 = norm(sub(E2, S));
  const f2 = norm(sub(T2, E2));

  // shoulder: rotate the upper arm u1 → u2 (exact axis-angle)
  const sAxis = cross(u1, u2);
  const sL = len(sAxis);
  const shoulderAxis = sL > 1e-6 ? norm(sAxis) : { x: dir.y, y: dir.z, z: dir.x };
  const shoulderAngle = sL > 1e-6
    ? Math.acos(clamp(dot(u1, u2), -1, 1)) * (dot(cross(u1, u2), shoulderAxis) >= 0 ? 1 : 1)
    : 0;
  // the shoulder rotation carries the forearm with it
  const f1 = rotVec(f1raw, shoulderAxis, shoulderAngle);
  // elbow: flex the carried forearm until it points at the target
  const eAxisRaw = cross(f1, f2);
  const eL = len(eAxisRaw);
  const elbowAngle = eL > 1e-6 ? Math.acos(clamp(dot(f1, f2), -1, 1)) : 0;
  const elbowAxis = eL > 1e-6 ? norm(eAxisRaw) : shoulderAxis;
  const wrist = { x: E2.x + f2.x * L2, y: E2.y + f2.y * L2, z: E2.z + f2.z * L2 };
  return { shoulderAxis, shoulderAngle, elbowAxis, elbowAngle, reachable, wrist };
}

/** How magnetised a hand is to the ball: 0 far … 1 clamped. */
export function graspOf(d: number, reach: number): number {
  if (d > reach) return 0;
  if (d < reach * 0.55) return 1;
  return 1 - (d - reach * 0.55) / (reach * 0.45);
}
