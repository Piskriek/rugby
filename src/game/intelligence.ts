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
  /* The spot a recovering player went down on. While recoverT runs he is
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

export function steer(
  p: Live, dt: number, sprint: boolean,
  reportGate?: ForwardAttackGateReporter,
  gateLabel = 'steer',
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
    const tvx = nx * want * ramp, tvz = nz * want * ramp;
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
  if (import.meta.env.DEV && p.movedBy && p.movedBy !== 'steer'
    && p.movedBy !== 'carrier' && p.movedBy !== 'input'
    && p.movedBy !== 'release') {   // playtest 3: the release-and-retreat beat is a sanctioned retarget
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
  if (p.down) clip = 'grounded';
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

export function separate(
  all: Live[], dt: number,
  reportGate?: ForwardAttackGateReporter,
  gateLabel = 'separate',
) {
  /* Snapshot the pre-shove positions so the budget is measured against where
   * each man started the frame, not against the running total. */
  const shoveOrigin = all.map((p) => ({ x: p.x, z: p.z }));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.0001) continue;
      /* SPEC_02 GATE: each collision pair has its own before-image and label;
       * this makes a separation shove attributable without changing T-02's
       * existing movement-owner semantics. */
      const beforeA = reportGate ? snapshotForwardAttackPlayer(a) : undefined;
      const beforeB = reportGate ? snapshotForwardAttackPlayer(b) : undefined;

      /* LATCH-AND-DRAG: the two men in a latch are DELIBERATELY occupying the
       * same half-metre of grass — that is the tackle. The separation shove
       * would prise them apart every frame and the defender would appear to
       * bounce off the man he is supposed to be hanging onto. */
      if ((a.latchedBy && a.latchedBy === `${b.team}:${b.num}`)
        || (b.latchedBy && b.latchedBy === `${a.team}:${a.num}`)) continue;

      /* T-04. Opposing players must not run through one another. Two cases:
       *
       * TEAM-MATES — the existing rule. The carrier has right of way; his own
       * men step out of his line.
       *
       * OPPONENTS — the new rule. Neither body may occupy the other's grass. If
       * neither is the carrier they both give ground. If one is the carrier and
       * the other is NOT in the tackle's convergence set (the tackle has already
       * resolved the contact by the time it matters), the carrier brushes through
       * and the defender yields — the actual tackle stays owned by the radius
       * test in upOpen, so there is no double-fire.
       */
      if (a.team === b.team) {
        if (a.bound || b.bound) continue;
        const min = 1.05;
        if (d > min) continue;
        const push = (min - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        const wA = a.carrier || a.controlled ? 0.15 : 1;
        const wB = b.carrier || b.controlled ? 0.15 : 1;
        a.x -= nx * push * wA; a.z -= nz * push * wA;
        b.x += nx * push * wB; b.z += nz * push * wB;
      } else {
        // Opponents. Bodies do not overlap; they shunt.
        if (a.down || b.down) continue;
        const min = 0.82;
        if (d > min) continue;
        const push = (min - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        if (a.carrier) {
          b.x += nx * push * 1.0; b.z += nz * push * 1.0;   // defender gives way
        } else if (b.carrier) {
          a.x -= nx * push * 1.0; a.z -= nz * push * 1.0;
        } else {
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
        }
      }
      if (reportGate && beforeA && beforeB) {
        const pairLabel = `${gateLabel}:${a.team}${a.num}-${b.team}${b.num}`;
        for (const gate of forwardAttackPlayerWriteFailures(pairLabel, beforeA, snapshotForwardAttackPlayer(a), ['x', 'z'] as const)) reportGate(gate);
        for (const gate of forwardAttackPlayerWriteFailures(pairLabel, beforeB, snapshotForwardAttackPlayer(b), ['x', 'z'] as const)) reportGate(gate);
      }
      /* T-11 void audit: frozen-interface param — the collision resolve is
       * positional (separation per frame), dt is not needed here. */
      void dt;
    }
  }

  /* D-2 — clip each man's TOTAL displacement for this frame. Direction is
   * preserved; only the magnitude is bounded. */
  for (let i = 0; i < all.length; i++) {
    const p = all[i], o = shoveOrigin[i];
    const mx = p.x - o.x, mz = p.z - o.z;
    const m = Math.hypot(mx, mz);
    if (m > MAX_SHOVE_PER_FRAME) {
      const k = MAX_SHOVE_PER_FRAME / m;
      p.x = o.x + mx * k;
      p.z = o.z + mz * k;
    }
  }
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
