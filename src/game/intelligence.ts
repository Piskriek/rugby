/**
 * PLAYER INTELLIGENCE — the off-ball brain.
 *
 * Every complaint about rugby games that begins "my players just..." is a
 * complaint about this file not existing. Thirty players, each with a written
 * contract for the phase, each re-targeted every frame, each moving under the
 * same movement model the controlled player uses.
 *
 * The contracts solve, specifically:
 *   "players are never in their correct position"
 *   "props will line up at flyhalf while fullbacks are rucking"
 *   "pointless having a backline as the forwards plays flyhalf"
 *   "huge gaps left in defensive lines causing easy line breaks"
 *   "3 players floating around instead of coming into the ruck"
 *   "AI teammates simply run onto the ball back into busy areas"
 */

import { ROLE_CONTRACTS, contractFor, PhaseName } from './jlr';
import {
  forwardAttackLivePurityFailures, forwardAttackPassCandidateFailures,
  forwardAttackPassOrderFailures, forwardAttackPassSelectionFailures,
  forwardAttackPlayerWriteFailures, snapshotForwardAttackPlayer,
  snapshotForwardAttackPlayers,
} from './forwardAttackGates';
import type { ForwardAttackGateReporter, ForwardAttackGateValue } from './forwardAttackGates';
import { solvePassAim, passReleaseRel, PASS_FORWARD_EPSILON } from './engine/throwforward';
import {
  LATCH_SPEED_MULT, LATCH_ACCEL_MULT, CLIP_LATCH_CARRY, CLIP_LATCH_HANG,
} from './engine/latch';

export interface Live {
  /* Playtest 2: the turn beat (the cutout pivots through edge-on) */
  lastFace?: number; turnT?: number;
  team: 'A' | 'B';
  num: number;
  x: number; z: number;
  vx: number; vz: number;
  face: number;              // +1 = running toward +z
  clip: string; clipT: number; jitter: number;
  stamina: number;           // 0..100
  /** seconds since he last moved fast — the recovery window */
  restT: number;
  /** T-39 per-player build: 0.92 (wing) .. 1.12 (lock) */
  size: number;
  /** the phase the contract is currently drawn from */
  assignment: PhaseName;
  /** human-readable job, shown in the HUD when you control this player */
  job: string;
  tx: number; tz: number;    // target mark
  urgency: number;           // 0..1 — how hard to run at the target
  bound: boolean;            // locked into a set piece
  down: boolean;             // on the ground / in the ruck
  carrier: boolean;
  /** 0 = not a pass option, 1..3 = selectable in that order */
  passRank: number;
  /** seconds until this player reaches the breakdown mark */
  eta: number;
  /** true when this player is the one you are steering */
  controlled: boolean;
  /** yellow card timer in match seconds, 0 when fit */
  sinbin: number;
  /** D-3/T-71 — seconds this man has been continuously offside, for the
   *  retreat-intent escalation. Reset the moment he is legal. */
  offsideT?: number;
  /** T-18: seconds left of being BEATEN — a slipped tackle. A beaten defender
   *  recovers (steers back into the line) but cannot tackle while the timer
   *  runs; this is where line breaks come from. */
  beatenT: number;
  /* LATCH-AND-DRAG. The two halves of one link, held as the other man's
   * `team:num` identity so the pair survives the live array being rebuilt.
   * A latched carrier keeps running under a crippling drag penalty; the man
   * latching onto him is towed along on his hip. Both are null in open play.
   * See engine/latch.ts — these two fields are the whole contract between
   * the tackle physics, the steering and the 3D animation layer. */
  latchedBy?: string | null;
  latchingOnto?: string | null;
  /** the live drag multiplier while held — see latch.ts dragMultiplier() */
  latchDrag?: number;
  /* GET-UP LOCK. Seconds left of climbing back to his feet. A man on this
   * timer is not available to the AI: he holds position, keeps zero velocity,
   * and plays the stand-up clip through. Without it players slid to their
   * next formation slot while still on the floor — measured at 33% of
   * post-ruck frames moving faster than 3 m/s, peaking at 10 m/s. */
  recoverT?: number;
  /* THE COMMITTED DIVE. Seconds left of a defender's tackle dive. While it
   * runs his trajectory is locked (he cannot steer) and his reach is extended;
   * if it expires without him getting hands on anyone he has missed, and he
   * pays for it by landing on the floor. 0/undefined when he is on his feet. */
  diveT?: number;
  /** FORWARD PACK — the scrum bind payload, written by Director.placeBound and
   *  read by the renderer. All of it is presentation-safe kinematics in engine
   *  units (pitch metres, y above the turf), because the alternative is the
   *  renderer inventing a pose the referee has not measured: a hip height the
   *  pack is holding, and where each of a man's hands is gripping.
   *
   *  `hipY` is the PUBLISHED pelvis height — authored in behaviour/, sagged by
   *  how far this man is off his seat. `collapseW` is 0..1 how far he has
   *  folded into the turf. The hand points are already blended toward their
   *  anchor by the cadence, so the renderer writes them straight. */
  hipY?: number;
  collapseW?: number;
  /** PROACTIVE AVOIDANCE (see ANTICIPATION below): the side this man has
   *  committed to stepping around an intersecting body, and the seconds left on
   *  that commitment. A steering layer that re-decides a dodge every frame IS the
   *  jitter it is meant to remove, so the side is held. */
  avoidSide?: number;
  avoidT?: number;
  bindLX?: number; bindLY?: number; bindLZ?: number; bindLW?: number;
  bindRX?: number; bindRY?: number; bindRZ?: number; bindRW?: number;
  /** PLAYER CONTROLS — vertical jump state. X/Z remain the simulation's single
   * horizontal writer; these values are presentation-safe vertical kinematics. */
  jumpY?: number;
  jumpVY?: number;
  /** The spot a recovering player went down on. While recoverT runs he is
   * restored here every frame, so a direct p.x/p.z write by any other system
   * cannot slide him out from under his own get-up animation. */
  recoverX?: number;
  recoverZ?: number;
  attrs: { SPD: number; PWR: number; SKL: number; AGG: number; AWA: number; STA: number };
  /**
   * T-02 — ownership tag. Every frame, exactly one system may move a player:
   * `steer` (think), `bound` (placeBound), `phase` (phase logic), `carrier` (the
   * controlled player). The second writer in a frame warns, because a double move
   * is the root of the teleport class of bug. Reset each frame; dev-only.
   */
  movedBy?: string;
}

export const ATTR_KEYS = ['SPD', 'PWR', 'SKL', 'AGG', 'AWA', 'STA'] as const;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Forwards by shirt. Used everywhere a decision depends on unit membership. */
export const FORWARDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const BACKS = [9, 10, 11, 12, 13, 14, 15];
/** Shirts that may legally play the ball out of a ruck, in order. */
export const RUCK_ELIGIBLE = [9, 8, 2, 7, 6, 5, 4, 3, 1];
/** Shirts contractually forbidden from entering a ruck. */
export const RUCK_FORBIDDEN = [10, 11, 12, 13, 14, 15];

/**
 * LATCH-AND-DRAG — the drag penalty, applied at the single place every system
 * in the game asks how fast a man can run. A carrier with a defender hanging
 * off his hips does not stop, but he is fighting a grown man: he keeps his
 * legs going at a fraction of his free pace. Putting it here rather than in
 * the tackle code means the human input branch, `cpuCarrier` and `steer()`
 * are all taxed identically, and no future caller can forget about it.
 */
export function maxSpeed(p: Live, carrying: boolean, sprint: boolean, fatigue: number): number {
  /* T-39 realistic speeds. Elite wingers hit ~9.5 m/s in a full sprint, props
   * ~6.0. The spread comes from SPEED; a bigger body costs a touch of top speed
   * and acceleration. Nobody runs a flat, shared pace. */
  const base = 2.9 + (p.attrs.SPD / 100) * 5.0;
  const carryPenalty = carrying ? 0.45 + (100 - p.attrs.SKL) * 0.006 : 0;
  /* Playtest P1.4/P3.10: at x1.24 sprint read as "no sprint button". x1.32
   * keeps the prop/wing spread and makes the hold worth the stamina. */
  const sprintMul = sprint ? 1.32 : 1.0;
  const sizeMul = 1.03 - (p.size ?? 1) * 0.03;
  const tired = 1 - clamp(1 - fatigue / 100, 0, 1) * 0.22;
  const drag = p.latchedBy ? (p.latchDrag ?? LATCH_SPEED_MULT) : 1;
  return Math.max(3.4, base - carryPenalty) * sprintMul * sizeMul * tired * drag;
}

/* ============================ MOVEMENT ============================
 * Sampled every frame, applied immediately. There is no pre-baked path and no
 * animation gate between the input and the movement.
 */

/* ===================== PROACTIVE TRAJECTORY AVOIDANCE =====================
 *
 * The contact game has two layers and they were in the wrong order. `separate()`
 * is REACTIVE: it projects two bodies apart once they are already inside each
 * other, and the frame it fires is the frame a man's velocity flips — a dodge
 * bought after the collision, paid for as jitter on the screen. `contactsettle`
 * already dampens and deadbands that layer (0.82 m opponents, inward-velocity
 * zeroing, a five-frame settle), which is why the flip is now a shudder rather
 * than a stutter; a shudder is still a thing you can see.
 *
 * This is the PROACTIVE layer: a cone in front of the man, walked forward in
 * time, that asks the only question that matters before contact is possible —
 * will two non-competing bodies be inside `gapM` of each other within `leadS`,
 * on these velocity vectors? If yes, bend the velocity target sideways by a
 * little NOW, so the pair pass each other with a metre of air and `separate()`
 * never has anything to project.
 *
 * Three rules keep it from becoming its own defect:
 *
 *   1. NON-COMPETING ONLY. A carrier, a man in a latch, a bound forward, a man on
 *      the deck: none of them are traffic to be avoided. Sidestepping out of the
 *      way of the man you are legally tackling is how a defence loses its own
 *      contest, and a ruck is not a crowd to walk around.
 *   2. THE SIDE IS COMMITTED (`avoidSide`, held for `holdS`). Flipping the dodge
 *      every frame is the definition of contact jitter — with two men, a
 *      per-frame re-decision oscillates, because A steps left, which makes B
 *      step left, which puts them back on a crossing line.
 *   3. THE DEFLECTION MAY NEVER COST HIM HIS ASSIGNMENT. The side is chosen by
 *      which way keeps him closest to his own mark, and the magnitude is capped
 *      so the deflected velocity still points where the play is going. That is
 *      what "the steering layer must not drive players into the overlap" means
 *      in code: the dodge is paid for out of the man's slack, never out of the
 *      line.
 * ------------------------------------------------------------------------- */

/** the radius at which `separate()` is already handling two bodies */
const CONTACT_RADIUS_M = 0.95;

/** is this man in a latch, either end of it */
function inLatch(p: Live): boolean {
  return !!(p.latchedBy || p.latchingOnto);
}

export const ANTICIPATION = {
  /** OFF BY DEFAULT, AND THAT IS A MEASUREMENT, NOT A CAVEAT. Judged by
   * `scripts/anticipationprobe.ts` over 24,000 ticks x 4 seeds, the cone moves
   * the reactive layer's projections from 209,199 to 211,567 — 1.1% the WRONG
   * way — with reversals flat (769 → 769) and mark fidelity improved (p50
   * 6.65 → 6.22 m). A smaller 3-seed sample looked like a 4.3% win; it did not
   * survive a wider one, which is the entire reason the probe exists. So the
   * mechanism is in, the cone is off, and `separate()`'s damping and settle
   * deadband (the tip of this branch) remain the answer to contact jitter until
   * a bend that provably reduces projections earns the right to be always on.
   * Flipping this to true is a tuning decision the probe arbitrates, not a
   * comment to delete. */
  enabled: false,
  /** metres: inside this separation the two bodies are going to touch */
  gapM: 1.2,
  /** seconds of look-ahead down the velocity vectors */
  leadS: 1.1,
  /** metres per second of lateral deflection at full commitment */
  deflectMS: 1.05,
  /** seconds the chosen side is held before it may be revised */
  holdS: 0.45,
  /** the cone: an intersection this far BEHIND the shoulder is not anticipated */
  forwardDeg: 72,
};

/**
 * The closest approach of two constant-velocity points, searched over [0, tMax].
 * Pure, allocation-free, and the whole prediction model of the cone: at these
 * speeds a man's velocity is a fair guess at his next second and a poor guess at
 * his next three, which is why `leadS` is short.
 */
export function closestApproach(
  ax: number, az: number, avx: number, avz: number,
  bx: number, bz: number, bvx: number, bvz: number,
  tMax: number,
): { t: number; dist: number } {
  const rx = bx - ax, rz = bz - az;
  const vx = bvx - avx, vz = bvz - avz;
  const vv = vx * vx + vz * vz;
  let t = vv < 1e-6 ? 0 : -(rx * vx + rz * vz) / vv;
  t = t < 0 ? 0 : t > tMax ? tMax : t;
  return { t, dist: Math.hypot(rx + vx * t, rz + vz * t) };
}

/** The lateral deflection this frame's steering should carry, or none. */
export function anticipationDeflect(
  p: Live, others: Live[], dt: number,
): { vx: number; vz: number } {
  if (!ANTICIPATION.enabled) return { vx: 0, vz: 0 };
  /* a man who is not free to choose his path has no avoidance to run */
  if (p.carrier || p.bound || p.down || p.latchedBy || p.latchingOnto) return { vx: 0, vz: 0 };
  const hold = p.avoidT ?? 0;
  if (hold > 0) p.avoidT = Math.max(0, hold - dt);

  /* the cone, in his own frame: only traffic AHEAD of him is anticipated, which
   * is what makes this avoidance rather than a flinch at anything that exists */
  const fx = p.vx, fz = p.vz;
  const fl = Math.hypot(fx, fz);
  if (fl < 0.6) return { vx: 0, vz: 0 };          // standing: separate() owns this
  const ux = fx / fl, uz = fz / fl;
  const cosLimit = Math.cos((ANTICIPATION.forwardDeg * Math.PI) / 180);

  let worst: Live | null = null;
  let worstGap = Infinity;
  for (const q of others) {
    if (q === p || q.down || q.bound || q.latchedBy || q.latchingOnto) continue;
    /* teammates moving together are not an intersection to step around: they
     * are the formation, and the formation is de-conflicted by marks */
    if (q.team === p.team && !q.carrier) continue;
    /* THE CONTEST IS NOT TRAFFIC. A defender steers INTO the carrier, and a man
     * already latched is holding somebody: avoid either and the cone starts
     * dissolving tackles — measured, the first version of this function raised
     * opponent contact-frames from 976 to 1453 across two 60 s seeds precisely
     * because it taught defenders to step off the man they were sent to get. */
    if (q.carrier || inLatch(q)) continue;
    /* and if they are already touching, this is separation's frame, not the
     * cone's: a deflection applied inside the shunt radius is the oscillation
     * this whole layer exists to remove */
    if (Math.hypot(q.x - p.x, q.z - p.z) < CONTACT_RADIUS_M) continue;
    const ap = closestApproach(p.x, p.z, p.vx, p.vz, q.x, q.z, q.vx, q.vz, ANTICIPATION.leadS);
    /* a meeting less than 0.12 s away is already being resolved by the pair's
     * own paths; bending now only smears the pass sideways */
    if (ap.t < 0.12) continue;
    if (ap.dist >= ANTICIPATION.gapM) continue;
    /* is he inside the cone? */
    const dx = q.x - p.x, dz = q.z - p.z;
    const dl = Math.hypot(dx, dz) || 1;
    if ((dx * ux + dz * uz) / dl < cosLimit) continue;
    if (ap.dist < worstGap) { worstGap = ap.dist; worst = q; }
  }
  if (!worst) {
    if (p.avoidSide) { p.avoidSide = 0; }
    return { vx: 0, vz: 0 };
  }

  /* the side: whichever turn keeps him nearer the mark he was given. Choosing
   * the side by geometry, per frame, is how the avoidance steals the play; the
   * commitment below is what stops it from dithering. */
  /* THE SIDE IS ANTISYMMETRIC, AND THAT IS THE WHOLE POINT. Two men who each
   * choose "the side that suits my own assignment" routinely choose the same
   * side in world terms, which is not avoidance at all — they arrive at the
   * meeting point side by side, slower, and stay in contact longer. Measured:
   * the first two versions of this function did exactly that and RAISED
   * incidental contact-frames by ~53% across three seeds, which is the honest
   * reason this line is a cross product and not a preference. The sign of
   * (relative position × relative velocity) flips for the other man, because
   * both of its inputs flip, so the pair part instead of orbiting. */
  let side = p.avoidSide ?? 0;
  if (p.avoidT === undefined || p.avoidT <= 0 || side === 0) {
    const rx = worst.x - p.x, rz = worst.z - p.z;
    const rvx = worst.vx - p.vx, rvz = worst.vz - p.vz;
    const cross = rx * rvz - rz * rvx;
    side = cross >= 0 ? 1 : -1;
    if (side === 0) side = p.num <= worst.num ? 1 : -1;   // a tie still needs a side
    p.avoidSide = side;
    p.avoidT = ANTICIPATION.holdS;
  }
  const k = 1 - worstGap / ANTICIPATION.gapM;      // harder the closer it gets
  const ramp = Math.min(1, Math.max(0, 1 - (p.avoidT ?? 0) / ANTICIPATION.holdS * 0.35));
  const push = ANTICIPATION.deflectMS * k * ramp;
  return { vx: -uz * side * push, vz: ux * side * push };
}

export function steer(
  p: Live, dt: number, sprint: boolean,
  reportGate?: ForwardAttackGateReporter,
  gateLabel = 'steer',
  avoid?: Live[],
) {
  /* SPEC_02 GATE: the whole integration write has one labelled owner when
   * invoked from Director.think(). Other phase callers retain the zero-cost
   * three-argument path. */
  const gateBefore = reportGate ? snapshotForwardAttackPlayer(p) : undefined;
  const dx = p.tx - p.x, dz = p.tz - p.z;
  const dist = Math.hypot(dx, dz);
  const want = maxSpeed(p, p.carrier, sprint, p.stamina) * p.urgency;

  if (dist < 0.35) {
    // arrival: decelerate to the mark, then hold
    p.vx = p.vx * Math.exp(-9 * dt);
    p.vz = p.vz * Math.exp(-9 * dt);
  } else {
    const nx = dx / dist, nz = dz / dist;
    const ramp = clamp(dist / 2.4, 0.28, 1);
    let tvx = nx * want * ramp, tvz = nz * want * ramp;
    /* PROACTIVE AVOIDANCE — the lateral bend, added to the TARGET and not to the
     * position: the man still accelerates through the same exponential, so a
     * dodge costs him pace he can earn back instead of teleporting him, and the
     * magnitude is bounded by `want`, so the dodge cannot out-run the play. */
    if (avoid && avoid.length) {
      const d = anticipationDeflect(p, avoid, dt);
      if (d.vx || d.vz) {
        const maxBend = want * 0.34;
        const dl = Math.hypot(d.vx, d.vz);
        const sc = dl > maxBend ? maxBend / dl : 1;
        tvx += d.vx * sc;
        tvz += d.vz * sc;
      }
    }
    // one continuous curve — the accel rate is the only difference between
    // a prop and a wing, so sprint never feels like a different game
    let accel = 9 + (p.attrs.SPD / 100) * 5;
    /* LATCH-AND-DRAG: a held man cannot build pace either — the drag taxes
     * acceleration as hard as it taxes top speed, which is what turns the
     * churn into a few heavy metres rather than a jog that happens to be
     * slow. */
    if (p.latchedBy) accel *= LATCH_ACCEL_MULT;
    /* T-13. THE TURN. A beaten defender turning back THROUGH himself cannot
     * accelerate at the full rate — he plants, redirects, builds again.
     * Until this, a flipped-180 defender accelerated at the full
     * exponential rate and ran every break down from behind (+0.8 m/s on
     * the carrier). The cost applies only to a true about-face (past 135
     * degrees): at smaller angles a defender is side-stepping, not
     * turning, and a mild flip every frame under pure pursuit left close
     * chasers orbiting at two metres, unable ever to make the tackle. */
    const heading = Math.hypot(p.vx, p.vz);
    if (heading > 1.2 && (p.vx * nx + p.vz * nz) / heading < -0.707) accel *= 0.35;
    p.vx += (tvx - p.vx) * (1 - Math.exp(-accel * dt));
    p.vz += (tvz - p.vz) * (1 - Math.exp(-accel * dt));
  }

  p.x = clamp(p.x + p.vx * dt, -34.5, 34.5);
  p.z = clamp(p.z + p.vz * dt, -61, 61);
  /* T-02. Integration writers — the carrier physics, the human input — set a
   * velocity; this exponential blend is designed to absorb an existing one, so
   * following them within a frame is a retarget, not a fight. A PLACEMENT is
   * different: it sets position outright, and steering on top of one is the
   * same-frame double-move that used to read as teleporting. Warn on that. */
  if (import.meta.env?.DEV && p.movedBy && p.movedBy !== 'steer'
    && p.movedBy !== 'carrier' && p.movedBy !== 'input'
    && p.movedBy !== 'release' && p.movedBy !== 'latch'
    && p.movedBy !== 'bound') {   // release/latch/bound are phase-owned writers, snapped as a phase handoff
    console.warn(`[T-02] shirt ${p.num} (${p.team}) moved by ${p.movedBy}, then steer() again in one frame`);
  }
  p.movedBy = 'steer';

  /* Facing comes from the full velocity vector. A player running down-field is
   * seen from behind; one running back at the camera from the front; a lateral
   * runner keeps his last meaningful z-facing rather than flapping. */
  if (Math.abs(p.vz) > 0.3) p.face = p.vz > 0 ? 1 : -1;

  /* Clip selection + cadence matching.
   *
   * The clip library ships each gait at a fixed cycle duration (jog 0.72 s,
   * sprint 0.50 s, carry 0.58 s). If every player advances clipT at a constant
   * 1x, a slow jogger churns his legs too fast and a fast runner glides with
   * legs too slow — that glide is the "floating" read. So clip time advances at
   * speed / clip-speed, locking feet to ground. */
  const sp = Math.hypot(p.vx, p.vz);
  let clip = p.clip;
  let clipSpeed = 0;
  if ((p.jumpY ?? 0) > 0.01) clip = 'jump';
  else if (p.down) clip = 'grounded';
  else if (p.clip === 'dive' && p.clipT < 0.5) {
    /* LATCH-AND-DRAG (Part 3): the committed dive is a one-shot and the gait
     * picker must not stomp it. It used to be overwritten on the very next
     * frame — the human-input branch in Director had its own guard for
     * exactly this, but every CPU defender's leap was erased before a single
     * frame of it rendered. Half a second of committed dive, then the gait
     * resumes; if he connects, the latch takes the body over first. */
    clip = 'dive';
  } else if (p.latchedBy || p.latchingOnto) {
    /* LATCH-AND-DRAG: the struggle owns the body. The gait picker would
     * otherwise overwrite the churn and the hang with 'carry'/'jog' on the
     * very next frame, and the drag would read as two men jogging in
     * formation. engine/latch.ts holds the clip; this branch only declines
     * to stomp it. */
    clip = p.clip;
  } else if (!p.bound) {
    if (sp < 0.7) clip = 'ready';
    else if (p.carrier) clip = 'carry';
    else if (sp > 6.2) clip = 'sprint';
    else clip = 'jog';
  }
  // The speed each clip was authored to look correct at.
  /* Playtest 2: reference speeds lowered ~12% — the cycles now churn a
   * touch faster than strict ground-lock, which reads as effort (the old
   * exact lock read as gliding). */
  if (clip === 'sprint') clipSpeed = 7.2;
  else if (clip === 'jog') clipSpeed = 3.9;
  else if (clip === 'carry') clipSpeed = 5.6;
  /* A man churning through contact is authored slow and heavy: locking the
   * cycle to his (crippled) ground speed would read as slow motion. */
  else if (clip === CLIP_LATCH_CARRY || clip === CLIP_LATCH_HANG) clipSpeed = 0;
  else if (clip === 'dive') clipSpeed = 0;   // one-shot: real time, not ground-locked

  /* THE TURN BEAT. A face flip is the cutout pivoting — it passes through
   * edge-on. One field, decays in a fifth of a second; the drawer squashes
   * the paper width by up to 42% at the flip. */
  if (p.lastFace === undefined) p.lastFace = p.face;
  if (p.face !== p.lastFace) { p.turnT = 1; p.lastFace = p.face; }
  p.turnT = Math.max(0, (p.turnT ?? 0) - dt * 5);

  if (p.clip !== clip) { p.clip = clip; p.clipT = 0; }   // one-shots start clean
  p.clipT += dt * (clipSpeed > 0 ? sp / clipSpeed : 1);

  /* SCORING PASS — stamina that breathes. The old rates drained at every
   * gait faster than any recovery could refill, so by midway EVERY player on
   * the field sat at ~10% and played at 81% speed all match — a flat tax
   * that made fatigue meaningless. Now the cost is effort-weighted (a sprint
   * costs, a jog barely) and the still windows are worth real air: a set
   * piece or a held shape mark is where a rugby player actually breathes.
   * The point is DIFFERENTIATION — a defence that has defended twenty
   * consecutive phases bends, a fresh one does not (see T-18/T-30). */
  if (sp > 7.0) p.stamina = clamp(p.stamina - dt * 4.4 * (1.4 - p.attrs.STA / 200), 0, 100);
  else if (sp > 3.0) p.stamina = clamp(p.stamina - dt * 0.3, 0, 100);
  else p.stamina = clamp(p.stamina + dt * (1.6 + p.restT * 0.9), 0, 100);

  if (reportGate && gateBefore) {
    for (const gate of forwardAttackPlayerWriteFailures(gateLabel, gateBefore, snapshotForwardAttackPlayer(p), [
      'vx', 'vz', 'x', 'z', 'movedBy', 'face', 'lastFace', 'turnT', 'clip', 'clipT', 'stamina',
    ] as const)) reportGate(gate);
  }
}

/** Teammates must never occupy the same metre of grass, and never block their own carrier. */
/* D-2 — TOTAL SHOVE BUDGET PER FRAME.
 *
 * Each individual shove here is small and legitimate, but a player caught
 * between several bodies receives one per overlapping pair and they ACCUMULATE.
 * Measured: a man with zero velocity moved 0.878 m in a single frame via four
 * separate() writes of +0.012, -0.383 and -0.508 — no single write was large
 * enough to look wrong, only their sum. That is the last thing standing between
 * the engine and the tightened 0.80 m NO TELEPORTS gate.
 *
 * 0.35 m/frame is 21 m/s of pure shunt, far more than any real jostle needs,
 * and it preserves the DIRECTION of the resolution exactly — only the
 * magnitude is clipped, so bodies still stop overlapping. */
/* Note the budget must leave room for the player's OWN legitimate movement in
 * the same frame: steer() integrates velocity first (a sprint is ~0.15 m) and
 * the shove is added on top. 0.35 + a sprint stride sat just over the 0.80 m
 * gate; 0.22 leaves clear margin while still resolving overlaps in one or two
 * frames. */
const MAX_SHOVE_PER_FRAME = 0.22;

/**
 * Teammate mark de-confliction:
 * For settled off-ball teammates, if pairwise mark distance d < 1.5m,
 * offsets the lower-priority player along the line formation corridor.
 */
export function deconflictMarks(
  all: Live[],
  ballPos?: { x: number; z: number },
  isExempt?: (p: Live) => boolean,
  writeHook?: (p: Live, fn: () => void) => void,
) {
  const MIN_DIST = 1.5;
  const MIN_DIST_SQ = MIN_DIST * MIN_DIST;

  for (let iter = 0; iter < 8; iter++) {
    let anyAdjusted = false;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (a.team !== b.team) continue;
        if (a.sinbin > 0 || b.sinbin > 0) continue;
        if (a.down || b.down) continue;
        if ((a.recoverT ?? 0) > 0 || (b.recoverT ?? 0) > 0) continue;
        if ((a.diveT ?? 0) > 0 || (b.diveT ?? 0) > 0) continue;

        const exA = isExempt ? isExempt(a) : (a.carrier || a.bound);
        const exB = isExempt ? isExempt(b) : (b.carrier || b.bound);
        if (exA && exB) continue;

        const dx = b.tx - a.tx;
        const dz = b.tz - a.tz;
        const dsq = dx * dx + dz * dz;
        if (dsq >= MIN_DIST_SQ) continue;

        const d = Math.sqrt(dsq);
        const overlap = MIN_DIST - d;
        if (overlap <= 0.0001) continue;

        let nx = 0, nz = 0;
        if (d > 0.001) {
          nx = dx / d;
          nz = dz / d;
        } else {
          const px = b.x - a.x;
          const pz = b.z - a.z;
          const pd = Math.hypot(px, pz);
          if (pd > 0.001) {
            nx = px / pd;
            nz = pz / pd;
          } else {
            nx = b.num > a.num ? 1 : -1;
            nz = 0;
          }
        }

        let aHigh: boolean;
        if (exA && !exB) {
          aHigh = true;
        } else if (!exA && exB) {
          aHigh = false;
        } else if (ballPos) {
          const da = Math.hypot(a.tx - ballPos.x, a.tz - ballPos.z);
          const db = Math.hypot(b.tx - ballPos.x, b.tz - ballPos.z);
          if (Math.abs(da - db) > 0.05) {
            aHigh = da < db;
          } else {
            aHigh = a.num <= b.num;
          }
        } else {
          aHigh = a.num <= b.num;
        }

        const higher = aHigh ? a : b;
        const lower = aHigh ? b : a;
        const dirSign = aHigh ? 1 : -1;

        const targetLowerX = lower.tx + nx * overlap * dirSign;
        const targetLowerZ = lower.tz + nz * overlap * dirSign;

        // Boundary handling: clamp lower to pitch bounds; shift higher inward if lower is against boundary
        const clampedLowerX = Math.max(-33, Math.min(33, targetLowerX));
        const clampedLowerZ = Math.max(-59, Math.min(59, targetLowerZ));

        const overflowX = targetLowerX - clampedLowerX;
        const overflowZ = targetLowerZ - clampedLowerZ;

        const applyShift = () => {
          lower.tx = clampedLowerX;
          lower.tz = clampedLowerZ;
          if (!exA && !exB) {
            if (Math.abs(overflowX) > 0.001) {
              higher.tx = Math.max(-33, Math.min(33, higher.tx - overflowX));
            }
            if (Math.abs(overflowZ) > 0.001) {
              higher.tz = Math.max(-59, Math.min(59, higher.tz - overflowZ));
            }
          }
        };

        if (writeHook) {
          writeHook(lower, applyShift);
        } else {
          applyShift();
        }
        anyAdjusted = true;
      }
    }
    if (!anyAdjusted) break;
  }
}

export function separate(
  all: Live[], dt: number,
  reportGate?: ForwardAttackGateReporter,
  gateLabel = 'separate',
) {
  const beforeSnapshots = reportGate ? all.map((p) => snapshotForwardAttackPlayer(p)) : undefined;
  const deltas = all.map(() => ({ dx: 0, dz: 0, dvx: 0, dvz: 0 }));

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];

      /* LATCH-AND-DRAG: the two men in a latch are DELIBERATELY occupying the
       * same half-metre of grass — that is the tackle. */
      if ((a.latchedBy && a.latchedBy === `${b.team}:${b.num}`)
        || (b.latchedBy && b.latchedBy === `${a.team}:${a.num}`)) continue;

      /* T-80. A BOUND pair — anywhere in the pod, either side — is exempt from
       * the projection pass entirely. */
      if (a.bound || b.bound) continue;

      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);

      if (a.team === b.team) {
        const min = 1.05;
        if (d >= min) continue;
        const overlap = min - d;

        // Collision normal n = (p1.pos - p2.pos) / d = (-dx/d, -dz/d)
        let nx = 0, nz = 0;
        if (d > 0.001) {
          nx = (a.x - b.x) / d;
          nz = (a.z - b.z) / d;
        } else {
          nx = a.num <= b.num ? -1 : 1;
          nz = 0;
        }

        const wA = a.carrier || a.controlled ? 0.15 : 1;
        const wB = b.carrier || b.controlled ? 0.15 : 1;

        // Velocity Damping: Zero the inward relative velocity component for non-carriers
        if (!a.carrier && !b.carrier) {
          const vRelX = a.vx - b.vx;
          const vRelZ = a.vz - b.vz;
          const inwardSpeed = vRelX * nx + vRelZ * nz;
          if (inwardSpeed < 0) {
            deltas[i].dvx -= 0.5 * inwardSpeed * nx;
            deltas[i].dvz -= 0.5 * inwardSpeed * nz;
            deltas[j].dvx += 0.5 * inwardSpeed * nx;
            deltas[j].dvz += 0.5 * inwardSpeed * nz;
          }
        }

        // Settle Deadband: low speed and minor overlap corrected over 5 frames
        const spdA = Math.hypot(a.vx, a.vz);
        const spdB = Math.hypot(b.vx, b.vz);
        const isDeadband = spdA < 1.5 && spdB < 1.5 && overlap < 0.10;
        const pushScale = isDeadband ? 0.2 : 1.0;
        const push = overlap * 0.5 * pushScale;

        deltas[i].dx += nx * push * wA;
        deltas[i].dz += nz * push * wA;
        deltas[j].dx -= nx * push * wB;
        deltas[j].dz -= nz * push * wB;
      } else {
        // Opponents. Bodies do not overlap; they shunt.
        if (a.down || b.down) continue;
        const min = 0.82;
        if (d >= min) continue;
        const overlap = min - d;

        // Collision normal n = (p1.pos - p2.pos) / d
        let nx = 0, nz = 0;
        if (d > 0.001) {
          nx = (a.x - b.x) / d;
          nz = (a.z - b.z) / d;
        } else {
          nx = a.num <= b.num ? -1 : 1;
          nz = 0;
        }

        // Velocity Damping: Zero the inward relative velocity component for non-carriers
        if (!a.carrier && !b.carrier) {
          const vRelX = a.vx - b.vx;
          const vRelZ = a.vz - b.vz;
          const inwardSpeed = vRelX * nx + vRelZ * nz;
          if (inwardSpeed < 0) {
            deltas[i].dvx -= 0.5 * inwardSpeed * nx;
            deltas[i].dvz -= 0.5 * inwardSpeed * nz;
            deltas[j].dvx += 0.5 * inwardSpeed * nx;
            deltas[j].dvz += 0.5 * inwardSpeed * nz;
          }
        }

        // Settle Deadband: low speed and minor overlap corrected over 5 frames
        const spdA = Math.hypot(a.vx, a.vz);
        const spdB = Math.hypot(b.vx, b.vz);
        const isDeadband = spdA < 1.5 && spdB < 1.5 && overlap < 0.10;
        const pushScale = isDeadband ? 0.2 : 1.0;
        const push = overlap * 0.5 * pushScale;

        if (a.carrier) {
          deltas[j].dx -= nx * push * 1.0;
          deltas[j].dz -= nz * push * 1.0;
        } else if (b.carrier) {
          deltas[i].dx += nx * push * 1.0;
          deltas[i].dz += nz * push * 1.0;
        } else {
          deltas[i].dx += nx * push;
          deltas[i].dz += nz * push;
          deltas[j].dx -= nx * push;
          deltas[j].dz -= nz * push;
        }
      }
    }
  }

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const shoveDist = Math.hypot(deltas[i].dx, deltas[i].dz);
    if (shoveDist > MAX_SHOVE_PER_FRAME) {
      const s = MAX_SHOVE_PER_FRAME / shoveDist;
      deltas[i].dx *= s;
      deltas[i].dz *= s;
    }
    p.x += deltas[i].dx;
    p.z += deltas[i].dz;
    p.vx += deltas[i].dvx;
    p.vz += deltas[i].dvz;

    if (reportGate && beforeSnapshots) {
      const beforeP = beforeSnapshots[i];
      const playerLabel = `${gateLabel}:${p.team}${p.num}`;
      for (const gate of forwardAttackPlayerWriteFailures(playerLabel, beforeP, snapshotForwardAttackPlayer(p), ['x', 'z', 'vx', 'vz'] as const)) {
        reportGate(gate);
      }
    }
  }

  /* T-11 void audit: frozen-interface param — the collision resolve is
   * positional (separation per frame), dt is not needed here. */
  void dt;
}

/* ============================ SHAPE ============================ */

export interface ShapeInput {
  phase: PhaseName;
  attack: 'A' | 'B';
  dir: number;              // +1 attack toward +z
  ballX: number; ballZ: number;
  width: number;            // 0..1 tactic slider
  depthBias: number;        // 0..1 tactic slider (flat..deep)
  lineSpeed: number;        // 0..1 tactic slider, defending side
  drift: number;            // 0..1 from the defensive formation
  /** sign of the openside for this phase: +1 means the wide side is +x */
  open: number;
}

/**
 * The attacking mark for one shirt. Lateral offset is from the role contract,
 * scaled by the width slider, mirrored by the openside, and clamped so a prop
 * physically cannot stand where a centre should be.
 */
export function attackMark(num: number, s: ShapeInput): { x: number; z: number; job: string } {
  const c = contractFor(num);
  const lat = (c.lateral[s.phase] ?? 0);
  const dep = (c.depth[s.phase] ?? 4);
  const wide = 0.55 + s.width * 0.7;
  let x = s.ballX + lat * s.open * wide;
  // hard channel clamps per unit — the fix for props at fly-half
  if (FORWARDS.includes(num)) x = s.ballX + clamp(x - s.ballX, -8, 8);
  else if (num !== 15) x = s.ballX + clamp(x - s.ballX, -25, 25);
  else x = s.ballX + clamp(x - s.ballX, -18, 18);
  x = clamp(x, -33, 33);
  // depth is behind the ball, deeper when the tactic asks for it
  const z = s.ballZ - s.dir * (dep * (0.6 + s.depthBias * 0.9));
  return { x, z: clamp(z, -59, 59), job: c.job[s.phase] ?? c.job.OPEN_PLAY ?? 'SUPPORT' };
}

/**
 * The defending mark for one shirt. The line is distributed across the width
 * actually available with a hard maximum spacing of 4 m, so a gap wider than
 * that cannot exist by construction.
 */
export function defenceMark(num: number, s: ShapeInput): { x: number; z: number; job: string } {
  const c = contractFor(num);
  const phase: PhaseName = 'DEFENCE_LINE';
  let lat = (c.lateral[phase] ?? 0);
  const dep = c.depth[phase] ?? 3;

  // Redistribute the backs across the remaining width so the line is connected.
  if (num >= 10 && num !== 15) {
    const backs = [10, 11, 12, 13, 14];
    const span = 30;                     // metres of pitch the back line covers
    const i = backs.indexOf(num);
    lat = -span / 2 + (i / (backs.length - 1)) * span;
  }

  let x = s.ballX + lat * s.open;
  x = clamp(x, -33, 33);
  const speed = 0.55 + s.lineSpeed * 0.7;
  // the line sits in front of the ball and comes up as line speed rises
  const z = s.ballZ + s.dir * (dep * (1.35 - speed * 0.55));
  return { x, z: clamp(z, -59, 59), job: c.job[phase] ?? 'DEFEND YOUR CHANNEL' };
}

/* ===================== SPEC_02 — FORWARD PRIORITY =====================
 *
 * Phase A lives beside the pass solver and accepts only scalar observations,
 * rather than Live objects or Director state. The reviewed CPU integration
 * supplies those observations through an opt-in context below; this contract
 * itself still cannot move a player, select a play, or retain AI state.
 *
 * A direct gain is "guaranteed" at three metres. An uncovered true wing may
 * override that direct option only when all of these are true:
 *
 *   1. the candidate is shirt 11 or 14 and is uncovered;
 *   2. he is at least 12 m laterally available (a real wide release);
 *   3. he still projects at least one metre forward; and
 *   4. when a direct gain is guaranteed, he gives up no more than 1 m of it.
 *
 * The last condition is the explicit trade-off: width may win an equivalent
 * attacking opportunity, but it may not discard a materially better forward
 * gain just because the wing happens to be uncovered.
 */

export const FORWARD_ATTACK_PRIORITY_LIMITS = {
  guaranteedForwardGainMetres: 3,
  wingOverrideMinLateralSeparationMetres: 12,
  wingOverrideMinimumForwardGainMetres: 1,
  wingOverrideMaximumForwardGainConcessionMetres: 1,
} as const;

export type ForwardAttackPriority = 'FORWARD_GAIN' | 'UNCOVERED_WING' | 'NONE';

/** A plain, read-only observation of a possible wide release. */
export interface ForwardAttackWingCandidate {
  /** Rugby wings only; a full-back does not activate the wing override. */
  readonly shirt: number;
  readonly uncovered: boolean;
  /** Absolute lateral distance from the direct carrier lane, in metres. */
  readonly lateralSeparationMetres: number;
  /** Projected metres toward the attacking try line, never screen direction. */
  readonly forwardGainMetres: number;
}

/** Inputs intentionally contain no mutable Live or Director state. */
export interface ForwardAttackPriorityInput {
  /** Projected metres toward the attacking try line for the direct option. */
  readonly forwardGainMetres: number;
  readonly wing: Readonly<ForwardAttackWingCandidate> | null;
}

export interface ForwardAttackPriorityResult {
  readonly priority: ForwardAttackPriority;
  readonly forwardGainGuaranteed: boolean;
  /** True only when the wing has satisfied every legal override condition. */
  readonly wingOverrideEligible: boolean;
}

export interface ForwardAttackPriorityMatrixRow {
  readonly forwardGainGuaranteed: boolean;
  readonly wingOverrideEligible: boolean;
  readonly priority: ForwardAttackPriority;
}

/**
 * The complete boolean matrix. `wingOverrideEligible` already includes the
 * numeric conditions above, so a true value is the one lawful wing override.
 */
export const FORWARD_ATTACK_PRIORITY_MATRIX: readonly ForwardAttackPriorityMatrixRow[] = [
  { forwardGainGuaranteed: false, wingOverrideEligible: false, priority: 'NONE' },
  { forwardGainGuaranteed: false, wingOverrideEligible: true, priority: 'UNCOVERED_WING' },
  { forwardGainGuaranteed: true, wingOverrideEligible: false, priority: 'FORWARD_GAIN' },
  { forwardGainGuaranteed: true, wingOverrideEligible: true, priority: 'UNCOVERED_WING' },
];

/** Whether a projected direct option is worth protecting from a wide override. */
export function hasGuaranteedForwardGain(forwardGainMetres: number): boolean {
  return Number.isFinite(forwardGainMetres)
    && forwardGainMetres >= FORWARD_ATTACK_PRIORITY_LIMITS.guaranteedForwardGainMetres;
}

/**
 * The sole legal override predicate. It reads only its argument and makes no
 * random choice, state update, or array reordering.
 */
export function isLegalUncoveredWingOverride(input: Readonly<ForwardAttackPriorityInput>): boolean {
  const wing = input.wing;
  if (!wing || !Number.isFinite(input.forwardGainMetres)
    || !Number.isFinite(wing.lateralSeparationMetres)
    || !Number.isFinite(wing.forwardGainMetres)) return false;

  const trueWing = wing.shirt === 11 || wing.shirt === 14;
  const wideEnough = Math.abs(wing.lateralSeparationMetres)
    >= FORWARD_ATTACK_PRIORITY_LIMITS.wingOverrideMinLateralSeparationMetres;
  const gainsForward = wing.forwardGainMetres
    >= FORWARD_ATTACK_PRIORITY_LIMITS.wingOverrideMinimumForwardGainMetres;
  const preservesDirectGain = !hasGuaranteedForwardGain(input.forwardGainMetres)
    || wing.forwardGainMetres >= input.forwardGainMetres
      - FORWARD_ATTACK_PRIORITY_LIMITS.wingOverrideMaximumForwardGainConcessionMetres;

  return trueWing && wing.uncovered && wideEnough && gainsForward && preservesDirectGain;
}

/**
 * Evaluate the Phase-A priority matrix without selecting or mutating anything.
 * `NONE` deliberately means "leave the current caller's fallback alone" until
 * a reviewed integration supplies one.
 */
export function evaluateForwardAttackPriority(
  input: Readonly<ForwardAttackPriorityInput>,
): ForwardAttackPriorityResult {
  const forwardGainGuaranteed = hasGuaranteedForwardGain(input.forwardGainMetres);
  const wingOverrideEligible = isLegalUncoveredWingOverride(input);
  const priority: ForwardAttackPriority = wingOverrideEligible ? 'UNCOVERED_WING'
    : forwardGainGuaranteed ? 'FORWARD_GAIN'
      : 'NONE';
  return { priority, forwardGainGuaranteed, wingOverrideEligible };
}

/* ============================ PASS SOLVER ============================
 * A pass is never thrown to a coordinate. It is thrown to a named player and
 * the flight is solved so ball and man arrive together.
 */

/**
 * Opt-in context for the approved forward-attack ranking. It is deliberately
 * plain data so the pass solver still has no dependency on Director state.
 */
export interface ForwardAttackPassContext {
  readonly enabled: boolean;
  readonly attackDirection: -1 | 1;
  /* SPEC_13: how the Law 11 filter reports the candidates it removes. A
   * filtered candidate is not a gate failure — it is the law working — so it
   * is counted, not thrown. (Reporting it through the gate reporter made the
   * harness throw on the first short pass of the match.) */
  readonly noteRejection?: (targetNum: number, rel: number) => void;
}

export interface PassOption {
  player: Live;
  rank: number;
  side: -1 | 1;
  cutOut: boolean;
  /** metres of flight */
  distance: number;
  /** seconds of flight */
  time: number;
  /** 0..1 chance it arrives cleanly, shown before you commit */
  risk: number;
  /** T-18: a defender is within tackling range of this receiver */
  covered: boolean;
  /** projected progress in the attacking direction by the time the pass arrives */
  forwardGainMetres: number;
  /** absolute lateral separation from the carrier lane */
  lateralSeparationMetres: number;
  /** SPEC_02's reviewed priority result for this candidate */
  priority: ForwardAttackPriority;
}

/** sort key: uncovered options before covered ones */
function coveredRank(o: PassOption): number { return o.covered ? 1 : 0; }

function isTrueWing(num: number): boolean { return num === 11 || num === 14; }

function priorityRank(priority: ForwardAttackPriority): number {
  return priority === 'UNCOVERED_WING' ? 0 : priority === 'FORWARD_GAIN' ? 1 : 2;
}

function defaultPassOptionCompare(a: PassOption, b: PassOption): number {
  return (coveredRank(a) - coveredRank(b))
    || (a.distance - b.distance)
    || (a.player.num - b.player.num);
}

function forwardPassOptionCompare(a: PassOption, b: PassOption): number {
  return (priorityRank(a.priority) - priorityRank(b.priority))
    || (coveredRank(a) - coveredRank(b))
    || (b.forwardGainMetres - a.forwardGainMetres)
    || (a.distance - b.distance)
    || (a.player.num - b.player.num);
}

/** The best uncovered non-wing route is the direct-gain comparator for every wing. */
function bestDirectForwardOption(options: readonly PassOption[]): PassOption | null {
  let best: PassOption | null = null;
  for (const option of options) {
    if (isTrueWing(option.player.num) || option.covered) continue;
    if (!best || option.forwardGainMetres > best.forwardGainMetres
      || (option.forwardGainMetres === best.forwardGainMetres && option.distance < best.distance)) {
      best = option;
    }
  }
  return best;
}

/**
 * The wide sort is a copy-sort, never an in-place mutation of the candidate
 * collection. The reviewed priority contract compares every wing with the
 * best direct gain on the field, not merely the nearest route on its own side:
 * the one-metre concession cap must protect a stronger release anywhere.
 */
function rankForwardPassOptions(
  scored: readonly PassOption[],
  context: Readonly<ForwardAttackPassContext> | undefined,
): PassOption[] {
  if (!context?.enabled) return [...scored].sort(defaultPassOptionCompare);

  const direct = bestDirectForwardOption(scored);
  const prioritised = scored.map((option) => {
    if (isTrueWing(option.player.num)) {
      const decision = evaluateForwardAttackPriority({
        forwardGainMetres: direct?.forwardGainMetres ?? 0,
        wing: {
          shirt: option.player.num,
          uncovered: !option.covered,
          lateralSeparationMetres: option.lateralSeparationMetres,
          forwardGainMetres: option.forwardGainMetres,
        },
      });
      return { ...option, priority: decision.priority };
    }
    if (direct === option) {
      return {
        ...option,
        priority: evaluateForwardAttackPriority({ forwardGainMetres: option.forwardGainMetres, wing: null }).priority,
      };
    }
    return option;
  });
  return [...prioritised].sort(forwardPassOptionCompare);
}

function reportPassGate(
  reporter: ForwardAttackGateReporter | undefined,
  label: string,
  reason: string,
  values: Readonly<Record<string, ForwardAttackGateValue>>,
): void {
  reporter?.({ label, reason, values });
}

export function passOptions(
  carrier: Live, all: Live[], _open: number, cutOut: boolean, wet: number,
  forwardContext?: Readonly<ForwardAttackPassContext>,
  reportGate?: ForwardAttackGateReporter,
): PassOption[] {
  /* SPEC_02 GATE: the sort must be a pure read of live players. */
  const liveBefore = reportGate ? snapshotForwardAttackPlayers(all) : undefined;
  const expectedDir: -1 | 1 = carrier.team === 'A' ? 1 : -1;
  const atkDir = forwardContext?.attackDirection ?? expectedDir;
  if (reportGate && forwardContext?.enabled && atkDir !== expectedDir) {
    reportPassGate(reportGate, 'passOptions:context-direction', 'forward pass context disagrees with the carrier attack direction', {
      carrier: carrier.num, team: carrier.team, expectedDir, contextDir: atkDir,
    });
  }

  const mates = all.filter((p) => p.team === carrier.team && p !== carrier && p.sinbin <= 0 && !p.down);
  const foes = all.filter((p) => p.team !== carrier.team && p.sinbin <= 0 && !p.down);
  const scored: PassOption[] = [];
  for (const m of mates) {
    // side is screen-relative so the button label always tells the truth
    const rel = m.x - carrier.x;
    const side: -1 | 1 = rel >= 0 ? 1 : -1;
    const absRel = Math.abs(rel);
    if (absRel < 0.4) continue;
    // a pass is only offered to a man who is roughly level or ahead
    // T-18: support legitimately trails the carrier by up to 10 m (that is
    // what depth IS) — the old 6 m cutoff removed the receivers a moving
    // attack actually has, and the CPU had nobody to pass to.
    if ((m.z - carrier.z) * atkDir < -10) continue;
    const dist = Math.hypot(m.x - carrier.x, m.z - carrier.z);
    // HARD CLAMP: a pass can never exceed the widest eligible receiver
    if (dist > 26) continue;
    /* T-18. You pass to the man the defence is NOT on. A receiver with a
     * defender inside ~2.2 m is covered — he catches and is tackled in the
     * same frame, which is why pass chains never formed: every pass went to
     * a marked man and died. Covered men are only offered when nobody open
     * exists on that side.
     * A defender who is BEATEN (slipped, or already carried past — behind
     * the receiver in the direction of attack) is not coverage: drift
     * defences concede those passes all match. */
    const covered = foes.some((f) => (f.beatenT ?? 0) <= 0
      && (f.z - m.z) * atkDir >= -1.2
      && Math.hypot(f.x - m.x, f.z - m.z) < 2.2);
    const time = clamp(dist / 14, 0.18, 1.5);
    const skill = carrier.attrs.SKL / 100;
    const risk = clamp(
      0.03 + (dist / 26) * 0.16 + wet * 0.14 + (1 - skill) * 0.12 + (cutOut ? 0.05 : 0) + (covered ? 0.1 : 0),
      0.02, 0.5,
    );
    /* SPEC_13. The lead is now the SAME solve the ball will actually fly — an
     * intercept on the receiver's real velocity, not a flat 80% of his top
     * speed. Ranking and law read one number, so the option the CPU likes best
     * is the option the law measures.
     *
     * And the law is applied HERE, at selection: a candidate whose solved
     * release vector is forward is never offered. That is what makes the
     * whistle rare rather than busy — the referee exists for the human
     * override and the cut-out, not to clean up after the solver. */
    const aim = solvePassAim(carrier, m);
    const aimRel = passReleaseRel(carrier, aim, carrier.vz, atkDir);
    /* Only the CPU is held to the law here. The human is OFFERED the forward
     * pass and is whistled for it if he throws it: a law he cannot break is a
     * law he cannot learn, and a referee who never blows is not a referee.
     * `forwardContext` is exactly the CPU flag — it is only passed for a
     * CPU-driven side — so the two behaviours fall out of the existing
     * structure rather than a second option. */
    if (forwardContext?.enabled && aimRel > PASS_FORWARD_EPSILON) {
      forwardContext?.noteRejection?.(m.num, aimRel);
      continue;
    }
    const projectedZ = aim.z;
    const forwardGainMetres = Math.max(0, (projectedZ - carrier.z) * atkDir);
    const beforePush = scored.length;
    scored.push({
      player: m, rank: 0, side, cutOut, distance: dist, time, risk, covered,
      forwardGainMetres, lateralSeparationMetres: absRel, priority: 'NONE',
    });
    if (reportGate) {
      const option = scored[scored.length - 1];
      if (scored.length !== beforePush + 1) {
        reportPassGate(reportGate, `passOptions:candidate:${m.num}`, 'candidate append changed the local collection by more than one entry', {
          beforeCount: beforePush, afterCount: scored.length, carrier: carrier.num, target: m.num,
        });
      }
      for (const gate of forwardAttackPassCandidateFailures(`passOptions:candidate:${m.num}`, carrier, option)) reportGate(gate);
    }
  }

  /* SPEC_02 GATE: snapshot before the rank write; rankForwardPassOptions copies
   * before sorting, so all candidate membership remains attributable. */
  const ranked = rankForwardPassOptions(scored, forwardContext);
  if (reportGate) {
    for (const gate of forwardAttackPassOrderFailures(
      'passOptions:ranked', scored, ranked, forwardContext?.enabled ?? false,
    )) reportGate(gate);
  }

  // Highest-ranked option on each side, skipping one if this is a cut-out pass.
  const out: PassOption[] = [];
  for (const side of [1, -1] as const) {
    const list = ranked.filter((o) => o.side === side);
    if (!list.length) continue;
    const pick = cutOut && list.length > 1 ? list[1] : list[0];
    if (cutOut && list.length === 1) continue;
    const beforePush = out.length;
    out.push({ ...pick, rank: 0 });
    if (reportGate && out.length !== beforePush + 1) {
      reportPassGate(reportGate, `passOptions:selected:${side}`, 'side selection changed the local collection by more than one entry', {
        beforeCount: beforePush, afterCount: out.length, side, target: pick.player.num,
      });
    }
  }

  const ordered = forwardContext?.enabled ? [...out].sort(forwardPassOptionCompare) : out;
  const selected = ordered.map((option, index) => ({ ...option, rank: index + 1 }));
  if (reportGate) {
    for (const gate of forwardAttackPassSelectionFailures('passOptions:selected', selected)) reportGate(gate);
    if (liveBefore) {
      for (const gate of forwardAttackLivePurityFailures('passOptions:return', liveBefore, all)) reportGate(gate);
    }
  }
  return selected;
}

/**
 * Where the ball should be thrown so it meets the receiver. The receiver is
 * always moving when it arrives — the fix for "your player remains at a
 * standstill and by the time you get going the defence is on you".
 */
export function solvePassTarget(from: Live, opt: PassOption, dir: number): { x: number; z: number; vx: number; vz: number } {
  const r = opt.player;
  // project the receiver forward for the flight time, at 80% of top speed
  const lead = opt.time * maxSpeed(r, false, false, r.stamina) * 0.8;
  let tx = r.x;
  let tz = r.z + dir * lead;
  // never solve a target behind the passer
  if ((tz - from.z) * dir < 0.3) tz = from.z + dir * 0.4;
  tz = clamp(tz, -59, 59);
  tx = clamp(tx, -33.5, 33.5);
  const dx = tx - from.x, dz = tz - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const speed = Math.max(9, Math.min(18, len / opt.time));
  return { x: tx, z: tz, vx: (dx / len) * speed, vz: (dz / len) * speed };
}

/* ============================ BREAKDOWN CREW ============================
 * Three players are assigned to every breakdown by name, in arrival order,
 * before the tackle is even made. The fix for "3 players floating around".
 */

export function assignCrew(
  all: Live[], team: 'A' | 'B', x: number, z: number, count: number,
): Live[] {
  const pool = all.filter((p) => p.team === team && p.sinbin <= 0 && !RUCK_FORBIDDEN.includes(p.num));
  const scored = pool.map((p) => {
    const d = Math.hypot(p.x - x, p.z - z);
    // forwards get a large priority discount: they are supposed to be there
    const roleBias = FORWARDS.includes(p.num) ? 0 : 9;
    const eta = d / Math.max(4.5, maxSpeed(p, false, false, p.stamina)) + roleBias;
    return { p, eta };
  }).sort((a, b) => a.eta - b.eta);
  return scored.slice(0, count).map((s) => s.p);
}

/** The player who will play the ball out of the ruck — never a distant back. */
export function ruckDistributor(all: Live[], team: 'A' | 'B', x: number, z: number): Live {
  for (const num of RUCK_ELIGIBLE) {
    const p = all.find((q) => q.team === team && q.num === num && q.sinbin <= 0 && !q.down);
    if (p && Math.hypot(p.x - x, p.z - z) < 14) return p;
  }
  // fall back to the nearest forward, never to a back from distance
  const fw = all.filter((p) => p.team === team && FORWARDS.includes(p.num) && p.sinbin <= 0 && !p.down);
  if (fw.length) return fw.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  /* Last resort: a non-down player of the team. A down man cannot pick up a
   * ruck ball — handing it to him read as the ball being played by a body on
   * the floor. */
  const awake = all.filter((p) => p.team === team && p.sinbin <= 0 && !p.down);
  if (awake.length) return awake.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  return all.find((p) => p.team === team && p.sinbin <= 0)!;
}

/* ============================ KICK CHASE ============================
 * Three chasers with named lanes, assigned the moment the kick is struck.
 */

export function assignChase(all: Live[], team: 'A' | 'B', bx: number, bz: number, _dir: number): { num: number; lane: string }[] {
  const lanes = ['MIDDLE — contest the ball', 'OPEN SIDE — squeeze the receiver', 'BLIND SIDE — cover the in-goal'];
  const pool = all.filter((p) => p.team === team && p.sinbin <= 0);
  const ranked = pool
    .map((p) => ({ p, score: Math.hypot(p.x - bx, p.z - bz) - (p.attrs.SPD / 100) * 6 - (FORWARDS.includes(p.num) ? 0 : 3) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return ranked.map((r, i) => ({ num: r.p.num, lane: lanes[i] ?? 'CHASE' }));
}

/** The receiver of a high ball, with priority. The fifteen calls for it. */
export function assignReceiver(all: Live[], team: 'A' | 'B', bx: number, bz: number): Live {
  const order = [15, 14, 11, 13, 12, 10, 9];
  for (const num of order) {
    const p = all.find((q) => q.team === team && q.num === num && q.sinbin <= 0);
    if (p && Math.hypot(p.x - bx, p.z - bz) < 26) return p;
  }
  return all.filter((p) => p.team === team).sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz))[0];
}

/* ============================ GAP SEEKING ============================
 * Attackers target the gap between defenders, never the carrier's position.
 * The fix for "AI teammates simply run onto the ball back into busy areas".
 */

export function widestGap(defenders: Live[], carrierX: number): number {
  if (defenders.length < 2) return carrierX > 0 ? -1 : 1;
  const xs = defenders.map((d) => d.x).sort((a, b) => a - b);
  let bestX = 0, bestGap = -1;
  for (let i = 0; i < xs.length - 1; i++) {
    const gap = xs[i + 1] - xs[i];
    if (gap > bestGap && gap > 1.4) { bestGap = gap; bestX = (xs[i] + xs[i + 1]) / 2; }
  }
  // never steer within 2.5 m of touch
  if (bestX > 31) bestX = 31;
  if (bestX < -31) bestX = -31;
  return bestX === 0 ? (carrierX > 0 ? -24 : 24) : bestX;
}

/** Touchline awareness. The CPU never runs itself into touch. */
export function avoidTouch(x: number, z: number, dir: number): number {
  const toLine = dir > 0 ? 50 - z : 50 + z;
  if (toLine > 20) return x;
  if (x > 26) return 26;
  if (x < -26) return -26;
  return x;
}

/** Live overlap count: the reason a backline move works or does not. */
export function overlapCount(attackers: Live[], defenders: Live[], x0: number, x1: number): number {
  const a = attackers.filter((p) => p.x >= x0 && p.x <= x1).length;
  const d = defenders.filter((p) => p.x >= x0 && p.x <= x1).length;
  return a - d;
}

export const ROLE_INDEX = ROLE_CONTRACTS;
