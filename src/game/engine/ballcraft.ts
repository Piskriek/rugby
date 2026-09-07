/**
 * SPEC_25 — INTERACTIVE CATCHING, BALL SECURITY AND THE DROP PUNT
 *
 * Five states, one owner per claim, and one solver that both cameras share.
 *
 *   [IDLE / RUNNING]
 *        │  hold RMB
 *        ▼
 *   [HANDS_READY] ──(ball within 0.7 m of the chest + LMB)──► [BALL_SECURED]
 *        │                                                           │
 *        ▼  release RMB                                             ▼  release LMB
 *   [IDLE / RUNNING]                                          [DROP_BALL] (300 ms window)
 *                                                                   │
 *                                                                   ▼  Space inside the window
 *                                                             [PUNT_KICK]
 *
 * Two states past PUNT_KICK are internal and deliberate, not part of the verb set:
 * FLIGHT (the ball is away and the laws have to catch up with it) and LOOSE (the
 * drop was not kicked, and a ball on the deck is a different problem from a ball in
 * hand). They are exposed on `state` because hiding them would mean the rig drawing a
 * pose the engine is not in, which is the class of bug this repo calls a lie.
 *
 * LAYERING. This module owns the ball and the arm *targets*. It never writes a player's
 * position: HANDS_READY is a posture, not a movement, so `movedBy` stays untouched and
 * the single-writer rule (T-02: two position claims in one frame is a teleport) cannot
 * fire here. The renderer reads `ik` and nothing else.
 */
import type { Director } from '../director';
import type { Live } from '../intelligence';
import { clamp } from './clamp';
import { R } from './rng';
import { fwdProfile, isForwardLoss } from './throwforward';

/** Radius around the chest/hands point inside which LMB takes the ball. */
export const SECURE_M = 0.7;
/** The window between letting go and the boot: long enough to be human, short
 *  enough that a punt is a decision and not a default. */
export const PUNT_WINDOW_S = 0.3;
/** A rugby ball is 410-460 g; 430 g is the middle of the range the laws allow. */
export const M_BALL = 0.43;
/** Boot speed at the ball for a full committed punt, m/s. A human punt strike is
 *  18-25 m/s of boot speed; this is the top of a first-time drop punt, and the
 *  player's own SKL and the swing timing scale it down from there. */
export const V_KICK = 21.5;
/** Ball radius — the collider the boot has to reach. */
export const BALL_R = 0.14;
/** How long the leg takes from the back lift to contact. */
export const SWING_S = 0.2;
/** Gravity, the same constant the line-out lift and the kick flight use. */
export const G = 9.81;

export type CraftState = 'IDLE' | 'HANDS_READY' | 'BALL_SECURED' | 'DROP_BALL' | 'PUNT_KICK' | 'FLIGHT' | 'LOOSE';

/** The flat elbow→hand pair the rig needs. Kept as six numbers rather than two
 *  vectors so the procedural state can hold it without an allocation per frame. */
export type ElbowHand = { ex: number; ey: number; ez: number; hx: number; hy: number; hz: number };

/** One arm, solved. World metres; the renderer projects these, it does not invent them. */
export interface ArmPose {
  shoulder: { x: number; y: number; z: number };
  elbow: { x: number; y: number; z: number };
  hand: { x: number; y: number; z: number };
  /** 0..1 — how far the hands got toward the ball. 1 means touching it. */
  reach: number;
}

export interface BallCraft {
  state: CraftState;
  /** seconds in the current state */
  t: number;
  /** the player this is being done by, so a switch mid-grapple cannot orphan the pose */
  team: 'A' | 'B';
  num: number;
  /** the chest/hips point everything is measured from */
  chest: { x: number; y: number; z: number };
  l: ArmPose;
  r: ArmPose;
  /** the two shoulder anchors, reused (see `solveArm`) */
  shoulderL: { x: number; y: number; z: number };
  shoulderR: { x: number; y: number; z: number };
  /** the kicking foot, only meaningful in PUNT_KICK */
  foot: { x: number; y: number; z: number } | null;
  /** seconds left of the punt window; 0 outside DROP_BALL */
  window: number;
  /** the free ball while DROP_BALL / PUNT_KICK / FLIGHT / LOOSE */
  free: { x: number; y: number; z: number; vx: number; vy: number; vz: number; bounces: number } | null;
  /** true while the ball is slaved to the chest and gravity is not applied to it */
  ownsBall: boolean;
  /** the impulse the boot gave the ball, kept for the HUD, the probe and the replay */
  lastImpulse: number;
  /** metres the punt carried, filled in on resolution */
  lastDistance: number;
  /** when the last out-of-reach refusal was recorded (rate limit, see HANDS_READY) */
  lastRefusal: number;
  /** every transition, so a fault can be read instead of guessed at */
  log: { state: CraftState; t: number; why: string }[];
}

/**
 * Detect when the engine's ball controller is holding a secured ball.
 *
 * This is the seam a physical carrier rides on: `BALL_SECURED` is the one state
 * in which the engine claims possession (it writes the chest point and gravity
 * does not exist for the ball), so it is exactly when a physical TARCS carrier
 * (RapierWorld.attachBallToCarrier) should hold a weld — and the moment the
 * controller leaves it (a strip -> DROP_BALL, a release, a tackle) the weld
 * must be dropped. Exported as a predicate so a future physics integrator can
 * ask the engine what it owns WITHOUT the engine importing physics (the
 * headless core must stay Three/DOM/engine-free).
 */
export function isBallSecured(bc: BallCraft): boolean {
  return bc.state === 'BALL_SECURED';
}

export function makeCraft(): BallCraft {
  const zero = (): ArmPose => ({
    shoulder: { x: 0, y: 0, z: 0 }, elbow: { x: 0, y: 0, z: 0 }, hand: { x: 0, y: 0, z: 0 }, reach: 0,
  });
  return {
    state: 'IDLE', t: 0, team: 'A', num: 0,
    chest: { x: 0, y: 0, z: 0 }, l: zero(), r: zero(), foot: null,
    shoulderL: { x: 0, y: 0, z: 0 }, shoulderR: { x: 0, y: 0, z: 0 },
    window: 0, free: null, ownsBall: false, lastImpulse: 0, lastDistance: 0, log: [],
    lastRefusal: -9,
  };
}

/**
 * THE ANALYTIC TWO-BONE SOLVER.
 *
 * Given a root, a target and two segment lengths, this returns the joint chain in
 * closed form — no iteration, no matrix inversion, one `acos` and one `sqrt` per arm
 * per frame, which is why it can run for two arms sixty times a second next to a
 * hundred and fifty other decisions.
 *
 * The clamp on `d` is the whole character of the mechanic: when the ball is out of
 * reach the hand stops at the edge of the reach sphere and `reach` reads the fraction
 * of the distance covered. The hands genuinely strain toward a ball they cannot get,
 * and the renderer has a number to lean on instead of a designer's guess.
 */
export function solveTwoBone(
  root: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  l1: number, l2: number,
  pole: { x: number; y: number; z: number },
  out?: { elbow: { x: number; y: number; z: number }; hand: { x: number; y: number; z: number }; reach: number },
): { elbow: { x: number; y: number; z: number }; hand: { x: number; y: number; z: number }; reach: number } {
  /* `out` is not a micro-optimisation taste: `handsprobe`'s zero-allocation rule is the
   * reason this engine can run a solved contest at 60 Hz next to the animation, and a
   * solver that returns a fresh object per arm per frame is 30 objects a frame in the
   * hot path. A caller that owns a persistent holder hands it in and nothing is made. */
  const res = out ?? { elbow: { x: 0, y: 0, z: 0 }, hand: { x: 0, y: 0, z: 0 }, reach: 0 };
  const dx = target.x - root.x, dy = target.y - root.y, dz = target.z - root.z;
  const raw = Math.hypot(dx, dy, dz) || 1e-6;
  const minD = Math.abs(l1 - l2) + 0.02;
  const maxD = l1 + l2 - 0.008;      // a hair short, so the arm never goes dead straight and flips
  const d = clamp(raw, minD, maxD);
  const ux = dx / raw, uy = dy / raw, uz = dz / raw;
  /* Cosine rule for the virtual length along the bone axis, then the height of the
   * triangle. `a` can go negative for a fully folded arm; that is correct, the elbow
   * sits behind the shoulder rather than on top of it. */
  /* The projection of the upper arm onto the root→target axis. Read the triangle as
   * l1 (root→elbow), l2 (elbow→hand), d (root→hand): a = (l1² + d² − l2²) / 2d. The
   * first version had (l1² − d² + l2²)/2d, which is the *forearm's* projection with
   * the signs swapped — the chain still ended at the target and still looked like an
   * arm, and only a check on segment lengths caught it: the elbow sat 0.48 m off its
   * own bone. That is the kind of bug an IK solver hides, because the hand arrives
   * however the elbow gets there. */
  const a = (l1 * l1 + d * d - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  /* The bend plane is spanned by (axis, pole): the pole is the elbow's preferred
   * side, which for a catch is "out and slightly down", and for a punt is "the hip
   * line". Orthonormalise the pole against the axis so the elbow cannot wander. */
  let nx = pole.x - ux * (pole.x * ux + pole.y * uy + pole.z * uz);
  let ny = pole.y - uy * (pole.x * ux + pole.y * uy + pole.z * uz);
  let nz = pole.z - uz * (pole.x * ux + pole.y * uy + pole.z * uz);
  let nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-4) { nx = 0; ny = 1; nz = 0; nl = Math.hypot(nx, ny, nz); }
  const cx = nx / nl, cy = ny / nl, cz = nz / nl;
  res.elbow.x = root.x + ux * a + cx * h;
  res.elbow.y = root.y + uy * a + cy * h;
  res.elbow.z = root.z + uz * a + cz * h;
  res.hand.x = root.x + ux * d;
  res.hand.y = root.y + uy * d;
  res.hand.z = root.z + uz * d;
  res.reach = clamp(raw <= maxD ? 1 : maxD / raw, 0, 1);
  return res;
}

/** The direction the lens is pointing, on the ground plane, as a unit vector.
 *  `project()` builds its view from `yaw`, so this is the same forward the pixel
 *  the player is aiming at is derived from — one source of truth, no second
 *  camera maths that can drift out of agreement with the renderer. */
const _look = { x: 0, y: 0, z: 0 };
export function lookVector(d: Director): { x: number; y: number; z: number } {
  const ct = Math.cos(d.cam.tilt), st = Math.sin(d.cam.tilt);
  _look.x = Math.sin(d.cam.yaw) * ct;
  _look.y = -st;
  _look.z = Math.cos(d.cam.yaw) * ct;
  return _look;
}

function go(bc: BallCraft, d: Director, state: CraftState, why: string) {
  if (bc.state === state) return;
  bc.state = state;
  bc.t = 0;
  bc.log.push({ state, t: d.t, why });
  if (bc.log.length > 40) bc.log.shift();
}

/** Where the hands want to be. A ball in flight is met slightly ahead of where it is,
 *  because that is what catching actually is — the hands go to the interception point
 *  and not to the ball. The lead is one arm's worth of reaction, not a prediction
 *  engine's: `dtLead` scales with the ball's speed and is capped so a grubber is not
 *  met three metres out. */
/**
 * WHERE THE BALL IS, as the engine owns it. Three cases and no fourth: the craft's
 * own free ball (a drop, a punt, a knock-on), the pass in flight, or a ball that is
 * being carried — and a carried ball has no independent position in open play at all,
 * which is why the third case returns the carrier's own hands. Reading `s.ball.x`
 * while nobody is flying it is a trap: the field is only written when a pass is
 * launched, so a stale coordinate would have a man reaching at a patch of grass forty
 * metres behind him, which is precisely the bug this function replaced.
 */
const _pt = { x: 0, y: 0, z: 0, loose: false };
const _pole = { x: 0, y: 0, z: 0 };
const _aim = { x: 0, y: 0, z: 0 };
const _secBall = { x: 0, y: 0, z: 0 };
const _free = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0 };
export function ballPoint(d: Director, bc: BallCraft, p: Live) {
  const s = d.op!;
  const pt = _pt;
  if (bc.free) {
    pt.x = bc.free.x; pt.y = bc.free.y; pt.z = bc.free.z; pt.loose = true;
    return pt;
  }
  if (s.ball.live) {
    const dtLead = Math.min(0.16, 0.16 * (Math.abs(p.vx) + Math.abs(p.vz)) / 12);
    pt.x = s.ball.x + p.vx * dtLead * 0.25; pt.y = s.ball.y;
    pt.z = s.ball.z + p.vz * dtLead * 0.25; pt.loose = true;
    return pt;
  }
  const side = p.face >= 0 ? 1 : -1;
  pt.x = p.x + 0.12 * p.size * side; pt.y = 1.05 * p.size;
  pt.z = p.z + 0.16 * p.size * side; pt.loose = false;
  return pt;
}

function solveArm(
  slot: ArmPose,
  p: Live,
  root: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  poleDown: number,
  l1: number,
  l2: number,
): ArmPose {
  _pole.x = root.x - p.x; _pole.y = -0.55 * poleDown; _pole.z = root.z - p.z;
  slot.shoulder = root;
  solveTwoBone(root, target, l1, l2, _pole, slot);
  return slot;
}



/**
 * THE FRAME. Called after the phase handler so the phase has already moved the world
 * and the craft only ever reads it.
 *
 * `handsUp` is the hold verb (RMB), `secure` is the hold verb that becomes a catch
 * (LMB) and `punt` is Space. `pressed`/`released` are the edge sets the input layer
 * already builds for keys, so a mouse button needs no new plumbing than a key press.
 */
export function stepCraft(
  d: Director, dt: number,
  handsUp: boolean, secure: boolean, punt: boolean,
  pressed: Set<string>, released: Set<string>,
) {
  const bc = d.bc;
  const s = d.op;
  bc.t += dt;

  /* Only open play, only a human side, only a player who is standing. A ruck, a maul
   * or a set piece owns the ball and the body with it, and a grabbed-off-the-deck
   * ball is a different law than the one being implemented here. */
  const usable = !!s && d.phase === 'OPEN_PLAY' && d.isHuman(s.attacking);
  /* WHOSE HANDS. The carrier's, while his own side holds the ball; the controlled
   * player's when the ball is in the air or loose, because that is the man the mouse
   * belongs to and the one who has to run to it. Falling back to the carrier when no
   * control exists keeps a CPU-driven frame from posing nobody. */
  const mine = usable ? d.L(s!.attacking, s!.carrierNum) : null;
  const ctl = usable && d.ctrlPlayer?.team === s!.attacking
    ? d.L(s!.attacking, d.ctrlPlayer!.num) : null;
  const ballInFlight = !!s && (s.ball.live || !!(d.bc?.free));
  const p = usable ? (ballInFlight ? (ctl ?? mine) : (mine ?? ctl)) : null;
  if (!usable || !p || p.down) {
    if (bc.state !== 'IDLE') {
      /* The phase moved on under the mechanic — a tackle during the drop, a whistle.
       * The free ball is handed back rather than left hovering at 0.6 m with nobody
       * owning it, which is the failure mode a state machine this shallow invites. */
      if (bc.free && s) {
        s.ball.x = bc.free.x; s.ball.z = bc.free.z; s.ball.y = Math.max(0.05, bc.free.y);
      }
      if (bc.ownsBall && s) s.carrierNum = bc.num;
      bc.free = null; bc.ownsBall = false; bc.foot = null; bc.window = 0;
      go(bc, d, 'IDLE', 'phase left open play');
    }
    bc.l.reach = 0; bc.r.reach = 0;
    return;
  }

  /* ---------- anchors, from the player's own build ---------- */
  const size = p.size;
  const chestY = 1.24 * size;
  const side = p.face >= 0 ? 1 : -1;
  bc.team = p.team; bc.num = p.num;
  bc.chest.x = p.x; bc.chest.y = chestY; bc.chest.z = p.z;
  const l1 = 0.30 * size, l2 = 0.28 * size;
  /* The shoulder line is the player's own facing rotated 90°, not a guess: `face`
   * is the +1/-1 running axis in this engine, and the lateral offset that produces
   * is what `applyArmReach` sees when it decides which arm leads. */
  const lat = Math.cos(p.face) * 0.2 * size, latZ = -Math.sin(p.face) * 0.2 * size;
  /* The two shoulder anchors live on the state: they are handed to the pose objects as
   * `shoulder`, and a fresh literal per frame would defeat the point of reusing them. */
  bc.shoulderL.x = p.x + lat; bc.shoulderL.y = chestY + 0.06; bc.shoulderL.z = p.z + latZ;
  bc.shoulderR.x = p.x - lat; bc.shoulderR.y = chestY + 0.06; bc.shoulderR.z = p.z - latZ;
  const shoulderL = bc.shoulderL, shoulderR = bc.shoulderR;

  switch (bc.state) {
    /* ------------------------------------------------------------------ IDLE */
    case 'IDLE': {
      bc.l.reach = Math.max(0, bc.l.reach - dt * 6);
      bc.r.reach = Math.max(0, bc.r.reach - dt * 6);
      /* Running with the ball, the arms carry it: the two hands stay at the chest,
       * close to the body, in a small version of the ready pose. A carrier whose arms
       * are pinned to his sides reads as a man holding nothing. */
      _aim.x = p.x + (bc.ownsBall ? 0 : 0.1 * size);
      _aim.y = chestY - 0.12;
      _aim.z = p.z + 0.16 * size * side;
      solveArm(bc.l, p, shoulderL, _aim, 0.4, l1, l2);
      _aim.x -= 0.2 * size * (lat !== 0 ? Math.sign(lat) : 1);
      solveArm(bc.r, p, shoulderR, _aim, 0.4, l1, l2);
      if (handsUp) go(bc, d, 'HANDS_READY', 'RMB down');
      break;
    }

    /* ----------------------------------------------------------- HANDS_READY */
    case 'HANDS_READY': {
      const b = ballPoint(d, bc, p);
      /* Both hands go to the SAME target, converged by 9 cm each: that is a catch
       * shape. Two hands on one ball, palms to it, elbows out — and if the ball is
       * out of reach they both strain toward it by exactly as far as the arm allows,
       * because the solver clamps the distance and reports the shortfall as `reach`. */
      _aim.x = b.x - 0.09; _aim.y = b.y; _aim.z = b.z;
      solveArm(bc.l, p, shoulderL, _aim, 1, l1, l2);
      _aim.x = b.x + 0.09;
      solveArm(bc.r, p, shoulderR, _aim, 1, l1, l2);
      const gap = Math.hypot(bc.l.hand.x - b.x, bc.l.hand.y - b.y, bc.l.hand.z - b.z)
        + Math.hypot(bc.r.hand.x - b.x, bc.r.hand.y - b.y, bc.r.hand.z - b.z);
      /* The distance that matters for the lock is chest/hand to ball, and the spec
       * fixes it at 0.7 m. Measured from the hands rather than the chest, because a
       * man can catch with his hands away from his body and the radius is then his,
       * not his torso's. */
      const handGap = Math.min(
        Math.hypot(bc.l.hand.x - b.x, bc.l.hand.y - b.y, bc.l.hand.z - b.z),
        Math.hypot(bc.r.hand.x - b.x, bc.r.hand.y - b.y, bc.r.hand.z - b.z),
      );
      if (pressed.has('secure') || secure) {
        if (handGap <= SECURE_M) {
          takeBall(d, bc, p, b);
          go(bc, d, 'BALL_SECURED', `secured at ${handGap.toFixed(2)} m of the hands`);
          break;
        }
        {
          /* Feedback instead of silence: the reach number is real, so say what it
           * was. This is the difference between a control that feels dead and one
           * that feels like it was refused. */
          /* Rate limited to two a second, because this is a TRANSITION ledger and a
           * man holding LMB at a ball that is not there presses every frame: sixty
           * refusals would push the states that actually mattered out of the ring, and
           * sixty template strings a second is a frame-path allocation in a module whose
           * budget is zero. */
          if (d.t - bc.lastRefusal > 0.5) {
            bc.lastRefusal = d.t;
            const why = `refused — ball ${handGap.toFixed(2)} m from the hands, need ${SECURE_M}`;
            /* The ledger is unconditional and deduplicated by content: a refused grab is
             * an engine fact, and the last of them is what a probe or a bug report needs.
             * The HUD hint keeps its 0.25 s gate, because that slot is shared with the
             * rest of the commentary and a man mashing LMB should not mute the match. */
            if (bc.log[bc.log.length - 1]?.why !== why) {
              bc.log.push({ state: bc.state, t: d.t, why });
              if (bc.log.length > 40) bc.log.shift();
            }
            if (bc.t > 0.25) d.showHint(`NO BALL IN REACH — ${handGap.toFixed(1)} m AWAY (NEED ${SECURE_M})`, 1.1);
          }
        }
      }
      if (!handsUp) { go(bc, d, 'IDLE', 'RMB released'); break; }
      void gap;
      break;
    }

    /* --------------------------------------------------------- BALL_SECURED */
    case 'BALL_SECURED': {
      /* The ball is slaved to the chest and gravity does not exist for it. That is
       * what "secured" means physically, and it is why `ownsBall` gates the ball
       * write in `upOpen` rather than this module reaching into the phase. */
      bc.ownsBall = true;
      _secBall.x = p.x + 0.10 * size * side;
      _secBall.y = chestY - 0.16;
      _secBall.z = p.z + 0.14 * size * side;
      const b = _secBall;
      _aim.x = b.x - 0.1; _aim.y = b.y + 0.06; _aim.z = b.z;
      solveArm(bc.l, p, shoulderL, _aim, 0.5, l1, l2);
      _aim.x = b.x + 0.1; _aim.y = b.y - 0.04;
      solveArm(bc.r, p, shoulderR, _aim, 0.5, l1, l2);
      bc.l.reach = 1; bc.r.reach = 1;
      if (s) { s.ball.x = b.x; s.ball.y = b.y; s.ball.z = b.z; s.ball.live = false; }
      /* BALL SECURITY. A defender who gets a hand in while the catcher is still
       * admiring his own catch knocks it on. The window is the first half second
       * after the grab, which is when a real catcher is looking at the ball, and the
       * odds scale with the defender's aggression against the catcher's skill. */
      const near = nearestDefender(d, p);
      if (near && bc.t < 0.55 && Math.hypot(near.x - p.x, near.z - p.z) < 1.15) {
        /* TWO HANDS BEAT ONE. The whole point of holding the button is that the ball
         * is off the outside world while you do: a strip attempt against a secured grip
         * is an order of magnitude less likely. Release it and the risk is back, which
         * is why the drop is a decision and not a free action. */
        const grip = (secure || ballGrip(d)) ? 0.12 : 1;
        const pStrip = (0.16 + (near.attrs.AGG - p.attrs.SKL) * 0.004) * grip;
        if (R() < pStrip) {
          knockOn(d, bc, p, 'stripped by ' + shortName(near), near);
          break;
        }
      }
      if (secure || pressed.has('secure')) bc.ownsBall = true;
      if (released.has('secure')) { go(bc, d, 'DROP_BALL', 'LMB released'); dropBall(bc, p, side, size); break; }
      if (!handsUp && bc.t > 0.2) { /* holding LMB alone keeps the ball: the catch is not un-done by the RMB */ }
      break;
    }

    /* ------------------------------------------------------------ DROP_BALL */
    case 'DROP_BALL': {
      bc.ownsBall = false;
      integrate(bc, dt);
      bc.window = Math.max(0, PUNT_WINDOW_S - bc.t);
      /* The hands stay where they let go for the whole window, then fall away. A man
       * about to punt has just released the ball at thigh height and is looking at it;
       * the arms do not go back to the ribs inside 300 ms. */
      const b = bc.free!;
      _aim.x = b.x - 0.12; _aim.y = b.y + 0.18; _aim.z = b.z;
      solveArm(bc.l, p, shoulderL, _aim, 0.8, l1, l2);
      _aim.x = b.x + 0.12;
      solveArm(bc.r, p, shoulderR, _aim, 0.8, l1, l2);
      if (bc.l.reach > 0.4 || bc.r.reach > 0.4) { bc.l.reach = 1; bc.r.reach = 1; }
      if (pressed.has('punt') || punt) { go(bc, d, 'PUNT_KICK', 'Space inside the window'); bc.t = 0; break; }
      if (bc.t >= PUNT_WINDOW_S) {
        /* No kick. The ball is simply loose, which is a real rugby event and a real
         * penalty risk, not a failed input. */
        go(bc, d, 'LOOSE', 'window closed — no boot');
      }
      break;
    }

    /* ------------------------------------------------------------ PUNT_KICK */
    case 'PUNT_KICK': {
      integrate(bc, dt);
      const u = lookVector(d);
      const k = p.attrs.SKL / 78;                  // 0.75 .. 1.15 across the squad sheet
      const swing = clamp(bc.t / SWING_S, 0, 1);
      /* The boot travels a quarter circle in the vertical plane that contains the
       * look vector: hanging back at the hip, through the ball at the lowest point,
       * then up and out along the target line. The contact frame is found, not
       * assumed — the collider test below is what decides whether the strike exists. */
      const ang = (-0.55 + swing * 1.5) * (0.72 * size);
      const back = Math.cos(ang) * -0.5 * size, down = -Math.abs(Math.sin(ang)) * 0.62 * size;
      /* THE ARC IS AIMED AT THE BALL. A punt is struck wherever the drop happened to
       * leave it, so the swing's low point is anchored to where the ball will BE when
       * the boot gets there — the same principle as `applyArmReach` aiming a hand at a
       * moving waist. Without it the foot sweeps a fixed circle and the strike depends
       * on which frame Space was pressed, which turns a 300 ms window into a
       * coincidence: the first version of this hit nothing at 283 ms, correctly, and
       * that was a bug in the leg and not in the timing.
       *
       * Only the VERTICAL anchor moves. The lateral arc still belongs to the leg, so a
       * drop that went sideways out of the swing is still a miss. */
      const drop = bc.free!;
      const tToContact = Math.max(0, SWING_S * 0.62);
      const predictY = Math.max(BALL_R, drop.y + drop.vy * tToContact - 0.5 * G * tToContact * tToContact);
      const anchorY = clamp(predictY, 0.18, 1.25) + 0.62 * size * 0.94;
      if (!bc.foot) bc.foot = { x: 0, y: 0, z: 0 };
      const foot = bc.foot;
      foot.x = p.x + u.x * (0.34 * size + back * 0.5);
      foot.y = anchorY + down + back * 0.42;
      foot.z = p.z + u.z * (0.34 * size + back * 0.5);
      const b = bc.free!;
      const touch = Math.hypot(b.x - foot.x, b.y - foot.y, b.z - foot.z);
      if (touch <= BALL_R + 0.16) {
        /* J = m_ball · v_kick · u_camera, as specified. The mass is not decorative:
         * keeping it means the number printed on the HUD is an impulse in N·s and can
         * be divided back out to the boot speed, which is how the probe checks the
         * kick was struck at the speed the model claims. */
        const vKick = V_KICK * (0.72 + 0.38 * k) * (0.55 + 0.45 * swing);
        const J = M_BALL * vKick;
        bc.lastImpulse = J;
        b.vx = u.x * (J / M_BALL);
        b.vz = u.z * (J / M_BALL);
        /* A punt is not a line drive into the deck. The lift floor is what makes the
         * ball hang long enough to be chased, and it is the only place this kick
         * borrows judgement rather than geometry. */
        b.vy = Math.max(6.4, u.y * (J / M_BALL) + 5.2 * (0.6 + 0.4 * k));
        d.say('PUNTED AWAY');
        go(bc, d, 'FLIGHT', `struck at ${swing.toFixed(2)} of the swing, J = ${J.toFixed(2)} N·s`);
      } else if (bc.t > SWING_S * 2.4) {
        /* Whiffed. The boot went through empty air, the ball is still dropping, and
         * the honest outcome is a loose ball rather than a forgiving one. */
        go(bc, d, 'LOOSE', 'the boot missed the drop');
      }
      break;
    }

    /* --------------------------------------------------------------- FLIGHT */
    case 'FLIGHT': {
      const b = bc.free!;
      integrate(bc, dt);
      bc.lastDistance = Math.hypot(b.x - p.x, b.z - p.z);
      /* A kicked ball in this engine belongs to the phase rules, so the flight ends
       * the moment it is gatherable: on the deck and rolling, or touched by anyone.
       * The handoff is one call — `startOpen` — because inventing a second
       * "after a kick" state is how a ball ends up owned by two systems. */
      const catcher = nearestTo(d, b.x, b.z, 1.35);
      if (b.y <= BALL_R + 0.02 && Math.abs(b.vy) < 1.2) {
        resolveLoose(d, bc, catcher, 'the ball came to earth');
      } else if (catcher && Math.hypot(catcher.x - b.x, catcher.z - b.z) < 0.9 && b.y < 1.9) {
        const team = catcher.team === bc.team ? bc.team : (bc.team === 'A' ? 'B' : 'A');
        resolveLoose(d, bc, catcher, `fielded by ${shortName(catcher)}`, team);
      }
      break;
    }

    /* ---------------------------------------------------------------- LOOSE */
    case 'LOOSE': {
      integrate(bc, dt);
      const b = bc.free!;
      const catcher = nearestTo(d, b.x, b.z, 1.2);
      /* Anyone within reach picks it up; if it stops moving, whoever is nearest takes
       * it. There is no scramble state here on purpose — the phase's own breakdown
       * rules take over the instant the ball has an owner again. */
      if (catcher && Math.hypot(catcher.x - b.x, catcher.z - b.z) < 0.8) {
        resolveLoose(d, bc, catcher, 'picked up off the deck');
      } else if (bc.t > 2.2) {
        resolveLoose(d, bc, catcher ?? null, 'nothing but a ball on the ground', bc.team === 'A' ? 'B' : 'A');
      }
      bc.l.reach = Math.max(0, bc.l.reach - dt * 4);
      bc.r.reach = Math.max(0, bc.r.reach - dt * 4);
      break;
    }
  }

  /* A ready player who is not holding anything reaches for a ball that is loose near
   * him even with no input: that is what HANDS_READY looks like when it is not being
   * driven by a mouse, and it is the pose the rig needs in the 300 ms after a strip. */
  if (bc.state === 'IDLE' && bc.free) {
    const b = bc.free;
    _aim.x = b.x - 0.1; _aim.y = b.y; _aim.z = b.z;
    solveArm(bc.l, p, shoulderL, _aim, 1, l1, l2);
    _aim.x = b.x + 0.1;
    solveArm(bc.r, p, shoulderR, _aim, 1, l1, l2);
  }
}

/* ------------------------------------------------------------------ verbs -- */

/** LMB in reach. The ball leaves the phase's hands and comes to the chest. */
function takeBall(d: Director, bc: BallCraft, p: Live, b: { x: number; y: number; z: number }) {
  const s = d.op!;
  bc.free = null;
  bc.ownsBall = true;
  bc.window = 0;
  /* `ball.live` is the PASS-flight flag and nothing else; stealing it for a loose
   * ball would make `upOpen` home the ball toward `pendingReceiver` and the drop
   * would fly to a man who was never thrown at. The free ball lives on `bc.free`,
   * which the renderer is told to prefer. */
  s.ball.live = false;
  s.ball.x = b.x; s.ball.y = b.y; s.ball.z = b.z;
  s.carrierNum = p.num;
  /* T-18's catch grace, the same as a pass: a man gathering a bomb is not a man who
   * can be hit for a knock-on on the frame he takes it. */
  s.heldT = 0;
  s.protect = Math.max(s.protect, 0.25);
  d.setCtrl(s.attacking, p.num);
  d.run(s.attacking, p.num).carries++;
  d.refreshPassOptions();
  d.say('SAFE HANDS');
}

/** Releasing LMB: the ball leaves the hands at thigh height with almost no velocity.
 *  A drop punt is a release, not a throw, so the vertical start speed is small and
 *  the whole of the distance comes from the boot. */
function dropBall(bc: BallCraft, p: Live, side: number, size: number) {
  bc.ownsBall = false;
  _free.x = p.x + 0.1 * size * side;
  _free.y = 1.02 * size;
  _free.z = p.z + 0.18 * size * side;
  _free.vx = p.vx * 0.35;
  _free.vy = 0.55;
  _free.vz = p.vz * 0.35;
  _free.bounces = 0;
  bc.free = _free;
  bc.window = PUNT_WINDOW_S;
  bc.t = 0;
}

/** true while the left button is held, i.e. while the ball is being actively cared
 *  for. Read from the phase's own last-input copy so the grip does not need a field
 *  threaded through three call sites. */
function ballGrip(d: Director): boolean {
  return d.bcGrip === true;
}

/** A strip or a fumble in the catch. Same outcome, different word, because the
 *  difference is what a commentator is for.
 *
 *  TARCS — THE HAND-CONTACT HOOK. A strip is also the one frame the knock-on
 *  law can be answered: the instant the ball leaves the hands it has a real
 *  ground velocity, and `engine/throwforward.ts`'s loss vector compares it
 *  against the handler's own momentum. A defender who takes the ball off the
 *  front of a catcher, driving it TOWARD the catcher's own dead-ball line, has
 *  knocked it on; a ball that jolts loose backwards is only a loose ball —
 *  there is no backward knock-on in law. When the vector says forward, the
 *  referee flags it and plays the advantage (`openKnockOnAdvantage`), and the
 *  loose ball stays live underneath: the defence may make something of it,
 *  and if they cannot, the whistle brings a scrum back to the spot. */
function knockOn(d: Director, bc: BallCraft, p: Live, why: string, striker?: Live) {
  const s = d.op!;
  bc.ownsBall = false;
  _free.x = s.ball.x;
  _free.y = s.ball.y;
  _free.z = s.ball.z;
  _free.vx = p.vx * 0.2;
  _free.vy = 0.2;
  _free.vz = p.vz * 0.2;
  if (striker) {
    /* The strip's kick rides on top of the spill: the hand that MADE contact
     * decides the direction, capped at two metres per second so the ruck-side
     * scramble physics stay the same game the ball-carrier audit calibrated. */
    _free.vz += clamp((striker.vz - p.vz) * 0.5, -2.2, 2.2);
  }
  _free.bounces = 0;
  bc.free = _free;
  const dir = s.attacking === 'A' ? 1 : -1;
  if (isForwardLoss({ ballVz: _free.vz, handlerVz: p.vz, dir }, fwdProfile(d.options.fwdPass ?? 1))) {
    d.openKnockOnAdvantage(p.team, s.ball.x, s.ball.z);
  }
  d.say('DROPPED IT');
  go(bc, d, 'LOOSE', why);
}

/** One integration step for the free ball: gravity, one unit of air drag, and a
 *  restitution that is measured off a ball rather than chosen for feel — a rugby
 *  ball on dry grass keeps about 40% of its drop height, and it is dead flat after
 *  the third contact. */
function integrate(bc: BallCraft, dt: number) {
  const b = bc.free;
  if (!b) return;
  b.vy -= G * dt;
  const drag = 1 - 0.06 * dt;
  b.vx *= drag; b.vz *= drag;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  if (b.y <= BALL_R) {
    b.y = BALL_R;
    if (b.vy < -0.4) {
      b.vy = -b.vy * 0.42;
      b.vx *= 0.72; b.vz *= 0.72;
      b.bounces++;
    } else {
      b.vy = 0;
      b.vx *= 1 - 2.6 * dt; b.vz *= 1 - 2.6 * dt;
    }
  }
}

/** Hand the ball back to the phase and let its own rules decide what a loose ball
 *  means: a gather by the other side is a turnover, and both go through `startOpen`. */
function resolveLoose(d: Director, bc: BallCraft, who: Live | null, why: string, team?: 'A' | 'B') {
  const b = bc.free;
  const t = team ?? who?.team ?? bc.team;
  const atX = b ? b.x : (d.op?.carrierX ?? 0);
  const atZ = b ? b.z : (d.op?.carrierZ ?? 0);
  bc.free = null;
  bc.ownsBall = false;
  bc.foot = null;
  bc.window = 0;
  if (who) d.setCtrl(t, who.num);
  d.startOpen(t, clamp(atX, -33, 33), clamp(atZ, -58, 58));
  if (t !== bc.team) d.say('TURNOVER — KICK CHASE WON');
  go(bc, d, 'IDLE', why);
}

function nearestDefender(d: Director, p: Live): Live | null {
  let best: Live | null = null, bd = 1e9;
  for (const q of d.live) {
    if (q.team === p.team || q.sinbin > 0 || q.down) continue;
    const dd = Math.hypot(q.x - p.x, q.z - p.z);
    if (dd < bd) { bd = dd; best = q; }
  }
  return bd < 4 ? best : null;
}

function nearestTo(d: Director, x: number, z: number, within: number): Live | null {
  let best: Live | null = null, bd = within;
  for (const q of d.live) {
    if (q.sinbin > 0 || q.down) continue;
    const dd = Math.hypot(q.x - x, q.z - z);
    if (dd < bd) { bd = dd; best = q; }
  }
  return best;
}

/* `Live` deliberately carries no name — the squad sheet owns names and the live body
 * owns physics, and a name that goes stale on a substitution is worse than a shirt
 * number. Every string here is therefore number-and-team, which is also what the feed
 * reads best in 8 pt type. */
function shortName(p: Live) {
  return `${p.team === 'A' ? 'HOME' : 'AWAY'} ${p.num}`;
}
