/**
 * LATCH-AND-DRAG — THE HEAVY TACKLE.
 *
 * A tackle used to be an instant: the defender reached the contact radius and
 * the episode ended on that frame. Even with the kinetic-impact slide bolted
 * on afterwards, contact still READ as an event rather than a struggle — the
 * hit happened, then two men slid.
 *
 * A real tackle has a middle. The defender gets hands on the carrier and
 * HANGS there; the carrier does not stop, he churns on through the contact,
 * dragging a body, losing a metre of pace a stride until his momentum dies
 * and the two of them go over together. That middle is what makes contact
 * feel heavy, and it is what this module inserts.
 *
 *   CLOSING   the defender is inside diving range and leaves his feet
 *             (presentation only — see `shouldDive`)
 *      ↓      contact radius
 *   LATCHED   0 – 0.6 s. Both men are linked. The carrier keeps running with
 *             a crippling drag penalty; the defender's coordinates are
 *             SNAPPED to the carrier's hip, so on screen he is being towed.
 *      ↓      dead momentum (< 1.5 m/s) or the drag timer expires
 *   TAKEDOWN  the existing breakdown path: the 0.3 s kineticImpact slide,
 *             then the ruck.
 *
 * NO RAGDOLL. The illusion is entirely 2D physics — a friction penalty and a
 * coordinate snap — paired with the 3D animation states the renderer picks up
 * off `Live.clip`. Nothing here touches the 3D layer, and nothing here knows
 * what a bone is.
 *
 * OWNERSHIP (T-02). While a latch is live, this module is the sole mover of
 * the DEFENDER: `think()` skips him and `placeBound()` has no open-play
 * branch, so the snap below is his only write. The CARRIER keeps his ordinary
 * owner (human input, or `cpuCarrier`) — he is still running, which is the
 * whole point — and this module only taxes his speed through `maxSpeed()`
 * and `steer()`.
 */

import type { Live } from '../intelligence';
import type { OpenPlayState } from '../director';

/* ============================ IDENTITY ============================ */

/**
 * A player's stable identity across the two links of a latch. `Live` has no
 * `id` field — a man is identified by his team and his shirt everywhere else
 * in the engine — so the link is that pair, formatted, and it survives the
 * live array being rebuilt.
 */
export type PlayerId = string;

export function playerId(p: { team: 'A' | 'B' | 'REF'; num: number }): PlayerId {
  return `${p.team}:${p.num}`;
}

/* ============================ TUNING ============================ */

/**
 * The drag penalty. A latched carrier keeps his legs going but is fighting a
 * grown man hanging off his hips: he runs at 28% of his free speed and builds
 * it at 30% of his free acceleration — the 60–80% band, at the heavy end,
 * because anything lighter reads as a man who has simply slowed down rather
 * than a man being held.
 */
export const LATCH_SPEED_MULT = 0.28;
export const LATCH_ACCEL_MULT = 0.30;

/**
 * THE GRIP TIGHTENS. A constant drag multiplier gives the carrier a terminal
 * speed — measured at ~2 m/s, which sits ABOVE the dead-momentum trigger, so
 * every latch ran the full timer and the pair slid four to seven metres
 * downfield. That is not a tackle, it is a piggyback.
 *
 * A tackle is not constant friction: the defender gets a better hold with
 * every stride, the carrier's legs get shorter, and he stops. The drag
 * therefore RAMPS — from LATCH_SPEED_MULT at the moment of contact to zero
 * over LATCH_GRIP_SECONDS — so momentum genuinely dies, the dead-momentum
 * trigger is reachable, and the drag distance falls to the metre or two a
 * real carry makes through contact. The timer is left as the ceiling it was
 * always meant to be, not the way every tackle ends.
 */
export const LATCH_GRIP_SECONDS = 0.42;

/** The live drag multiplier for a held carrier, given seconds since contact. */
export function dragMultiplier(latchT: number): number {
  const k = 1 - latchT / LATCH_GRIP_SECONDS;
  return LATCH_SPEED_MULT * (k > 0 ? k : 0);
}

/** The longest a latch can survive before the takedown is forced, seconds. */
export const LATCH_MAX_DRAG = 0.6;

/**
 * Dead momentum. Below this the carrier is no longer going anywhere and the
 * drag has done its job — he goes over. Metres per second.
 */
export const LATCH_DEAD_MOMENTUM = 1.5;

/**
 * A latch needs a moment to exist before the momentum test can end it, or a
 * defender who latches a carrier who was already slow takes him down on the
 * same frame and nothing has changed. Seconds.
 */
export const LATCH_MIN_DRAG = 0.12;

/** How far behind the carrier the hanging defender is planted, metres. */
export const LATCH_TRAIL_METRES = 0.5;

/**
 * THE CLOSE. A latch begins at the contact radius, but a defender who dived
 * for it committed from up to `LATCH_DIVE_REACH` (2.4 m) away — and the snap
 * below puts him on the carrier's hip. Writing that in one frame moved him
 * up to 1.73 m in 16 ms (measured), which is twice a sprint and exactly the
 * "impossible instantaneous movement" the NO-TELEPORTS gate exists to catch.
 *
 * So the gap is CLOSED rather than jumped: the offset between where he
 * actually is and where the hip is decays to zero over this many seconds.
 * That is also what really happens — he is in the air, reaching, and arrives
 * a moment later. Short enough to still read as one continuous grab.
 */
export const LATCH_CLOSE_SECONDS = 0.14;

/**
 * The reach of the committed dive. Outside the contact radius but inside
 * this, a defender leaves his feet: the dive animation fires BEFORE contact,
 * so the grab reads as the end of a leap rather than a man walking into
 * someone. Metres.
 */
export const LATCH_DIVE_REACH = 2.4;
/** How long a committed tackle dive stays in the air before he lands. */
export const DIVE_FLIGHT_SECONDS = 0.42;
/** A dive extends his reach: he is stretched out, not standing. */
export const DIVE_REACH_BONUS = 1.5;
/** Seconds face-down after a dive that caught nobody. */
export const DIVE_MISS_RECOVERY = 1.6;
/** He only dives if he is genuinely closing — metres per second. */
export const LATCH_DIVE_CLOSING_SPEED = 3.2;

/* ============================ STATE ============================ */

/**
 * The live latch. One at a time: a second defender arriving joins the
 * takedown through the ordinary breakdown crew, he does not start a rival
 * drag.
 */
export interface LatchState {
  carrierNum: number;
  tacklerNum: number;
  tacklerTeam: 'A' | 'B';
  carrierTeam: 'A' | 'B';
  /** seconds since the hands went on */
  t: number;
  /** metres of ground the pair have made since the latch — the drag distance */
  dragged: number;
  /** true when the defender left his feet to make it (Part 3 polish) */
  dived: boolean;
  /**
   * Offset from the hip to where the tackler actually was when the hands went
   * on, metres. Decays to zero over LATCH_CLOSE_SECONDS so he converges onto
   * the carrier instead of teleporting onto him. See LATCH_CLOSE_SECONDS.
   */
  closeX: number;
  closeZ: number;
}

/* ====================== PRESENTATION CLIP NAMES ====================== */

/**
 * The two engine clip names the latch introduces. They travel to the 3D layer
 * on `Live.clip` → `Actor.renderClip` like every other clip name, and
 * `ThreePlayerManager.mapState` turns them into rig states.
 *
 *   latchCarry  the carrier fighting through contact — heavy, churning,
 *               not a clean sprint
 *   latchHang   the defender hanging off him, being towed
 */
export const CLIP_LATCH_CARRY = 'latchCarry';
export const CLIP_LATCH_HANG = 'latchHang';

/* ============================ LIFECYCLE ============================ */

/**
 * Link two men. Pure bookkeeping plus the two `Live` back-references the
 * renderer, the steering skip and the speed tax all read.
 *
 * TEARDOWN HARDENING — overwriting a live `s.latch` without cutting the old
 * pair's links strands them: the old carrier keeps the 28% drag tax with a
 * phantom defender attached. The contact paths that call here are gated on
 * `!s.latch`, but a whistle teardown racing a contact frame can still land
 * two begins back to back, so a stale latch is cut unconditionally first
 * whenever the squad is handed in (the open-play call sites always do).
 */
export function beginLatch(s: OpenPlayState, carrier: Live, tackler: Live, dived: boolean, live?: Live[]): LatchState {
  if (s.latch && live) {
    const stale = s.latch;
    for (const p of live) {
      if ((p.team === stale.carrierTeam && p.num === stale.carrierNum)
        || (p.team === stale.tacklerTeam && p.num === stale.tacklerNum)) {
        p.latchedBy = null; p.latchingOnto = null; p.latchDrag = undefined;
        if (p.movedBy === 'latch') p.movedBy = undefined;
      }
    }
  }
  carrier.latchedBy = playerId(tackler);
  carrier.latchDrag = LATCH_SPEED_MULT;
  tackler.latchingOnto = playerId(carrier);
  /* Where the hip is right now, and therefore how far he still has to travel.
   * Held as an offset and decayed, so the very first tick does not jump him. */
  const a0 = latchAnchor(carrier);
  const latch: LatchState = {
    carrierNum: carrier.num,
    tacklerNum: tackler.num,
    tacklerTeam: tackler.team,
    carrierTeam: carrier.team,
    t: 0,
    dragged: 0,
    dived,
    closeX: tackler.x - a0.x,
    closeZ: tackler.z - a0.z,
  };
  s.latch = latch;
  /* He is not tackled yet — he is being held. The clips say exactly that, and
   * they are what stops the pair reading as a completed tackle for the whole
   * drag. */
  carrier.clip = CLIP_LATCH_CARRY; carrier.clipT = 0;
  tackler.clip = CLIP_LATCH_HANG; tackler.clipT = 0;
  return latch;
}

/** Unlink two men. Safe to call with either side already gone. */
export function clearLatch(s: OpenPlayState, carrier?: Live | null, tackler?: Live | null) {
  if (carrier) {
    carrier.latchedBy = null; carrier.latchDrag = undefined;
    /* TEARDOWN HARDENING — a cleared link must not leave the struggle clip
     * behind for the next episode to wear: the gait picker re-asserts the
     * correct clip next frame, and `ready` is the neutral handoff. The
     * `movedBy` ownership tag is deliberately NOT touched here — it resets
     * each frame (director T-02), and think() reads the stale 'latch' value
     * as "hold position through the takedown frame" (director think:latched
     * skip). Clearing it would hand both men a formation mark mid-takedown.
     * The whistle path (releaseAll) owns the full tag reset instead. */
    if (carrier.clip === CLIP_LATCH_CARRY) { carrier.clip = 'ready'; carrier.clipT = 0; }
  }
  if (tackler) {
    tackler.latchingOnto = null;
    if (tackler.clip === CLIP_LATCH_HANG) { tackler.clip = 'ready'; tackler.clipT = 0; }
  }
  s.latch = undefined;
}

/** Is this man being dragged along by a tackler? */
export function isLatched(p: Live): boolean {
  return !!p.latchedBy;
}

/** Is this man hanging off a carrier? */
export function isLatching(p: Live): boolean {
  return !!p.latchingOnto;
}

/** Either side of a live latch — the two men the drag owns. */
export function inLatch(p: Live): boolean {
  return !!p.latchedBy || !!p.latchingOnto;
}

/* ============================ THE DRAG ============================ */

/**
 * Where the hanging defender is planted this frame: on the carrier's hip,
 * `LATCH_TRAIL_METRES` behind him along his direction of travel. He is not
 * steering, he is being towed, so his velocity is the carrier's — which keeps
 * the renderer's own velocity-derived heading and gait pointing the right way
 * without the 3D layer needing to know a latch exists.
 */
export function latchAnchor(carrier: Live): { x: number; z: number; vx: number; vz: number } {
  const sp = Math.hypot(carrier.vx, carrier.vz);
  /* below walking pace his velocity vector is noise; fall back to his facing
   * so the defender does not spin around his hips as he stops. */
  const nx = sp > 0.8 ? carrier.vx / sp : 0;
  const nz = sp > 0.8 ? carrier.vz / sp : (carrier.face >= 0 ? 1 : -1);
  return {
    x: carrier.x - nx * LATCH_TRAIL_METRES,
    z: carrier.z - nz * LATCH_TRAIL_METRES,
    vx: carrier.vx,
    vz: carrier.vz,
  };
}

/** Why a latch ended — for the takedown call and the commentary line. */
export type LatchEnd = 'DEAD_MOMENTUM' | 'DRAG_TIMER' | 'LOST';

export interface LatchTick {
  /** null while the drag continues */
  end: LatchEnd | null;
  /** metres the pair have travelled since the hands went on */
  dragged: number;
}

/**
 * Advance a live latch one frame: snap the defender onto the carrier's hip,
 * accumulate the drag distance, and test the two takedown triggers.
 *
 * Pure of any phase change — the caller fires the takedown, because tearing
 * the episode down is the caller's job and doing it from here would be the
 * same reentrancy trap `cpuCarrier`'s early returns already cost us once.
 */
export function tickLatch(
  latch: LatchState, carrier: Live, tackler: Live, dt: number,
): LatchTick {
  latch.t += dt;

  /* Either man starting to climb off the floor ends the drag immediately.
   * tickRecovery pins a recovering player's velocity at zero, so a latch that
   * survived into a recovery would tow a corpse: the carrier cannot move, the
   * grip never ramps out, and the pair sit motionless until the 0.6 s cap.
   * Measured as 43 stalled drag frames before this guard. */
  if ((carrier.recoverT ?? 0) > 0 || (tackler.recoverT ?? 0) > 0) {
    return { end: 'LOST', dragged: latch.dragged };
  }

  /* THE SNAP. The defender has no independent position while he is holding
   * on: his coordinates ARE the carrier's, offset to the hip. This is the
   * whole illusion — two men moving as one unit — and it costs nothing but a
   * write that `think()` has been told to stay out of. */
  const before = { x: tackler.x, z: tackler.z };
  const anchor = latchAnchor(carrier);
  /* The residual gap from the moment of contact, easing out. `k` is 1 on the
   * contact frame and 0 once LATCH_CLOSE_SECONDS has elapsed, after which he
   * is welded to the hip exactly as before. */
  const k = latch.t < LATCH_CLOSE_SECONDS ? 1 - latch.t / LATCH_CLOSE_SECONDS : 0;
  const ease = k * k;          // quadratic: quick at first, gentle on arrival
  tackler.x = anchor.x + latch.closeX * ease;
  tackler.z = anchor.z + latch.closeZ * ease;
  tackler.vx = anchor.vx;
  tackler.vz = anchor.vz;
  tackler.movedBy = 'latch';
  /* he faces the way he is being dragged, which is the carrier's way */
  if (Math.abs(anchor.vz) > 0.4) tackler.face = anchor.vz > 0 ? 1 : -1;

  latch.dragged += Math.hypot(tackler.x - before.x, tackler.z - before.z);

  /* The tightening grip, published to maxSpeed()/steer() through the carrier
   * himself so that every mover — human input, cpuCarrierDrag, steer — is
   * taxed by the same number without any of them knowing a latch exists. */
  carrier.latchDrag = dragMultiplier(latch.t);

  /* Presentation. Held every frame so that neither man's ordinary gait
   * picker (steer, cpuCarrier, the human input branch) can stomp the struggle
   * halfway through the drag. */
  if (carrier.clip !== CLIP_LATCH_CARRY) { carrier.clip = CLIP_LATCH_CARRY; carrier.clipT = 0; }
  if (tackler.clip !== CLIP_LATCH_HANG) { tackler.clip = CLIP_LATCH_HANG; tackler.clipT = 0; }

  /* THE TRIGGERS. Momentum first — a carrier stopped dead goes over
   * immediately, which is what a dominant hit looks like — then the timer,
   * which is what stops a powerful runner dragging a man for twenty metres. */
  const speed = Math.hypot(carrier.vx, carrier.vz);
  if (latch.t >= LATCH_MIN_DRAG && speed < LATCH_DEAD_MOMENTUM) {
    return { end: 'DEAD_MOMENTUM', dragged: latch.dragged };
  }
  if (latch.t >= LATCH_MAX_DRAG) {
    return { end: 'DRAG_TIMER', dragged: latch.dragged };
  }
  return { end: null, dragged: latch.dragged };
}

/* ======================= PART 3 — THE DIVE ======================= */

/**
 * Should this defender leave his feet NOW, a few frames before he can
 * actually reach the carrier?
 *
 * Presentation only: it returns true in the band between the contact radius
 * and `LATCH_DIVE_REACH`, while he is genuinely closing. The caller plays the
 * dive one-shot; the latch itself still only happens at the contact radius,
 * so the dive lands exactly as the grab connects and reads as a leap at the
 * waist rather than a man arriving on foot.
 */
export function shouldDive(
  tackler: Live, carrier: Live, distance: number, contactRadius: number,
): boolean {
  if (distance <= contactRadius || distance > LATCH_DIVE_REACH) return false;
  if (tackler.down || tackler.beatenT > 0 || tackler.sinbin > 0) return false;
  if (tackler.clip === 'dive') return false;   // already committed
  /* closing speed along the line between them */
  const dx = carrier.x - tackler.x, dz = carrier.z - tackler.z;
  const d = Math.max(0.01, Math.hypot(dx, dz));
  const closing = ((tackler.vx - carrier.vx) * dx + (tackler.vz - carrier.vz) * dz) / d;
  return closing >= LATCH_DIVE_CLOSING_SPEED;
}

/* ================= LAW 9.17 — THE CHALLENGE IN THE AIR ================= *
 *
 * Every bind in this module — the latch, the dive, the ruck lattice — is a
 * man putting hands on another man. Law 9.17 says one of those contacts is
 * never legal: a challenge on an opponent whose feet are off the ground.
 *
 * The DETECTION belongs here because this is where contact is decided; the
 * VERDICT belongs to `engine/referee.ts` (`judgeAerialTackle`), and acting
 * on it — the whistle, the penalty, the card — belongs to the Director. This
 * function is the geometric half: are these two men actually in contact, and
 * whose feet are where.
 */

/** How close two bodies must be for a challenge to be a contact, metres.
 *  A shade wider than the ordinary 1.1 m tackle radius: a man in the air is
 *  reached by an arm, a shoulder or a shove, not just a wrap. This is the
 *  reach of a COMMITTED act — a dive, a latch, a pull. */
export const AERIAL_CHALLENGE_RADIUS_M = 1.5;

/** A charge is only a challenge at genuine contact range: the ordinary
 *  tackle radius, not arm's reach. Two men converging on the same bomb at
 *  a metre and a half apart are having a contest, not committing a foul. */
export const AERIAL_CHARGE_RADIUS_M = 1.1;

/** How fast the OFFENDER must be travelling into the jumper for a run-in to
 *  count as a challenge, m/s. Measured on his own velocity, not the closing
 *  rate: a jumper flying horizontally into a stationary defender is the
 *  jumper's doing, and penalising the defender for it is exactly backwards. */
export const AERIAL_CHARGE_SPEED_MS = 2.4;

/** How far off the turf a man must be before the protection bites, metres.
 *  Larger than the airborne epsilon: a man in the first centimetres of his
 *  take-off can still take a legal hit — Law 9.17 protects the man whose
 *  feet are CLEARLY off the ground and who has nothing to land on. */
export const AERIAL_PROTECTED_HEIGHT_M = 0.3;

/** A man is "off the ground" past this jump height — the same epsilon the
 *  contest kinematics use, restated here so the bind layer never disagrees
 *  with the contest layer about who is in the air. */
export const AERIAL_OFF_GROUND_M = 0.05;

export interface AerialChallenge {
  /** the airborne man being challenged. */
  victim: Live;
  /** the man on his feet who challenged him. */
  offender: Live;
  /** how far apart they were at the contact, metres. */
  distance: number;
}

/**
 * Find the illegal challenge in this frame, if there is one.
 *
 * Deliberately conservative: it fires only on a man who is genuinely
 * AIRBORNE (jumpY past the epsilon), only for an OPPONENT who is genuinely
 * GROUNDED (two men up for the same ball is the legal contest the law
 * protects), and only inside the challenge radius. A jumper who is
 * challenged by another jumper, or who has landed, produces nothing — which
 * is what makes an honest aerial contest playable rather than a penalty
 * lottery.
 */
export function findAerialChallenge(live: Live[]): AerialChallenge | null {
  for (const victim of live) {
    /* CLEARLY off the ground. The epsilon says "not standing"; the offence
     * needs a man who is genuinely up there, past the first centimetres of
     * a take-off, with no feet to land on. */
    if ((victim.jumpY ?? 0) < AERIAL_PROTECTED_HEIGHT_M) continue;
    if (victim.sinbin > 0 || victim.down) continue;
    /* THE BALL CARRIER IS NOT PROTECTED. Law 9.17 protects the man who has
     * jumped to CONTEST A BALL IN THE AIR. A carrier who leaves the ground —
     * hurdling a tackler, reaching for the line — has chosen to jump while
     * in possession, and the defender who meets him is making a tackle, not
     * committing foul play. Without this clause every hurdle in the match
     * was a yellow card, which is how the offence went from rare to routine. */
    if (victim.carrier) continue;
    for (const offender of live) {
      if (offender === victim || offender.team === victim.team) continue;
      if (offender.sinbin > 0 || offender.down) continue;
      /* Both in the air = a legal contest, whoever wins it. */
      if ((offender.jumpY ?? 0) > AERIAL_OFF_GROUND_M) continue;
      const distance = Math.hypot(offender.x - victim.x, offender.z - victim.z);
      if (distance > AERIAL_CHALLENGE_RADIUS_M) continue;
      /* A man standing still under a jumper has not challenged him, and
       * neither has one who happens to be running past him: the offence is
       * an ACT AIMED AT HIM. Two ways to qualify, and both are deliberate.
       *
       *  1. A COMMITTED BIND — a dive already launched or a live latch. That
       *     is a man who has chosen his target; arm's reach is enough.
       *
       *  2. A CHARGE — the offender under his own steam, at contact range,
       *     running INTO the jumper. Judged on the offender's own velocity
       *     (a jumper drifting sideways into a stationary defender is the
       *     jumper's doing) and on his heading, so a man sprinting past on
       *     a covering line is not carded for being nearby. */
      const dx = victim.x - offender.x, dz = victim.z - offender.z;
      const gap = Math.max(0.01, distance);
      const bound = (offender.diveT ?? 0) > 0 || !!offender.latchingOnto
        || offender.clip === 'dive';
      let charged = false;
      if (!bound && distance <= AERIAL_CHARGE_RADIUS_M) {
        const speed = Math.hypot(offender.vx, offender.vz);
        const intoHim = speed > 0.01
          ? (offender.vx * dx + offender.vz * dz) / (speed * gap)
          : 0;
        /* cos > 0.5 — inside a 60° cone of the man in the air. */
        charged = speed >= AERIAL_CHARGE_SPEED_MS && intoHim > 0.5;
      }
      if (!bound && !charged) continue;
      return { victim, offender, distance };
    }
  }
  return null;
}

/**
 * LATCHES — multi-body 6DOF compliant spring constraints for tackles and rucks.
 *
 * The engine's breakdown used to be (a) static slot positions and (b) the
 * rigid capsule-on-capsule separation in `intelligence.separate()`: a body
 * that overlapped was projected straight out of the other body in the same
 * frame. A shot at 7 m/s read as two men bouncing off each other rather than
 * binding, and a ruck was a set of snapshots, not a shoving contest.
 *
 * This module replaces the rigid contacts INSIDE the tackle/ruck with a
 * deterministic 6DOF compliant constraint solver:
 *
 *   - bodies (carrier, tackler, clearers, jackal, counters, the ball) carry
 *     mass, velocity, a capsule radius and body-frame anchor points
 *     (shoulder / arm / torso / hip);
 *   - a bind is a set of six compliant axes — translation x/y/z plus pitch
 *     and yaw — each a spring-plus-damper between the tackler's shoulder
 *     collider and the carrier's torso (or between a ruck entrant and the
 *     ball lattice). Stiffness is high enough that bodies hold, low enough
 *     that they compress into each other; nothing is ever projected.
 *   - a joint releases when its tension exceeds the breaking strength, or
 *     when the phase asks for it (tackle complete, whistle, fend).
 *   - arriving ruck entrants push through their bind; the net horizontal
 *     drive is summed over both sides and moves the contest (the ball body)
 *     physically.
 *   - body-body contact is a compliant penetration spring with tangential
 *     friction, so bodies shunt and slide instead of clipping or snapping.
 *
 * All of it runs at the engine's fixed dt with 2 substeps, force and velocity
 * caps, and NaN guards — the fault hunt must never see a jitter here.
 *
 * The module is framework-free: it imports nothing from the game, so it can
 * be probed in isolation (scripts/latch-probe.ts) and unit-verified.
 */

export type LatchKind = 'TACKLE' | 'RUCK';
export type LatchBodyKind = 'CARRIER' | 'TACKLER' | 'CLEARER' | 'JACKAL' | 'COUNTER' | 'BALL';

export interface LatchVec { x: number; y: number; z: number }

/** One compliant axis of a bind: spring k (N/m or N·m/rad), damper c,
 *  rest offset and a hard per-axis force cap (keeps a bad frame from
 *  exploding the pile). */
export interface LatchAxis { k: number; c: number; rest: number; max: number }

export interface LatchAxes {
  /** Translational: lateral (right), vertical, axial (forward). */
  tx: LatchAxis; ty: LatchAxis; tz: LatchAxis;
  /** Rotational: pitch (fall together), roll (lean together), yaw twist. */
  rx: LatchAxis; ry: LatchAxis; rz: LatchAxis;
}

export interface LatchBody {
  id: number;
  kind: LatchBodyKind;
  team: 'A' | 'B';
  num: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Body yaw in the engine convention: facing = (sin(yaw), cos(yaw)). */
  yaw: number; yawVel: number;
  /** Lateral lean (roll) in radians, 0 = vertical. */
  roll: number; rollVel: number;
  mass: number;
  /** Capsule radius (the contact envelope, now compliant). */
  radius: number;
  /** 1 = upright, 0 = flat (a tackled body falls; the bind drags it down
   *  with the carrier). Eased by the pitch channel and the fall state. */
  upright: number;
  down: boolean;
  /** Forward shove in newtons, set by the breakdown each frame. */
  drive: number;
  /** World direction of the shove (+1/-1 along the attack axis). */
  driveDir: number;
  /** False until the body has bound through the gate — an unbound body
   *  cannot push: its drive is dead. */
  bound: boolean;
  /** True while the entrant is still running in (seek = approach force). */
  seeking: boolean;
  /** Approach target while seeking. */
  tx: number; tz: number;
  /** Soft world anchor (the ruck's ground mark): the contest pushes against
   *  it, so a winning shove visibly moves the pile without drifting it. */
  anchor?: { x: number; z: number; k: number; c: number };
  /** last-frame velocity magnitude change — the jitter metric. */
  jitter: number;
}

export interface LatchJoint {
  id: number;
  kind: LatchKind;
  a: number; b: number;
  /** Body-frame anchor offsets. For a tackle: tackler shoulder/arm ↦
   *  carrier torso. For a ruck: entrant shoulder ↦ ball. */
  anchorA: LatchVec; anchorB: LatchVec;
  axes: LatchAxes;
  /** TARCS — true once the ruck has re-priced this bind into the
   *  gelatinous regime (K/C lowered); guards against double-softening. */
  gel?: boolean;
  /** Joint fails when translation tension exceeds breakN or rotational
   *  torque exceeds breakNm. */
  breakN: number; breakNm: number;
  broken: boolean; reason: string;
  force: LatchVec; torque: number; strain: number;
  age: number;
}

export interface LatchMetrics {
  maxPenetration: number;
  /** Frames where any pair overlapped deeper than 0.45 m (a pile-worst). */
  deepContacts: number;
  /** The deepest pair ever, for the audit: '{aKind}#{aNum}-{bKind}#{bNum}'. */
  worstPair: string;
  /** Position/velocity snapshot at the deepest pair, for the fault hunt. */
  worstSnap: { ax: number; az: number; bx: number; bz: number; va: number; vb: number };
  /** Breadcrumb of the deep-overlap moments (>0.8 m), for the fault hunt. */
  deepHistory: string[];
  /** Oldest deep overlap persists this many frames (an unresolved stack). */
  deepResolveFrames: number;
  maxForce: number;
  maxTorque: number;
  instabilityFrames: number;
  brokenJoints: number;
  skippedBinds: number;
  gateRejects: number;
  releases: Record<string, number>;
  frames: number;
}

const SUBSTEPS = 2;
const MAX_V = 12;            // m/s — no body may leave frame in one frame
const MAX_YAW_V = 6;         // rad/s
/** Exported so the endurance harness can report the clamp margin it measured
 *  against, and so a caller can never exceed the solver's own budget. */
export const LATCH_MAX_V = MAX_V;
export const LATCH_MAX_YAW_V = MAX_YAW_V;
const CAP_F = 14000;         // N per channel (a pile impact, not an explosion)
const K_CONTACT = 42000;     // N/m penetration stiffness (stiff = no clipping)
const C_CONTACT = 1950;      // N·s/m normal damping (~0.5 critical for 105 kg)
const MU = 0.55;             // tangential friction coefficient
export const LATCH_FIELD_X = 34.5, LATCH_FIELD_Z = 61;
const FIELD_X = LATCH_FIELD_X, FIELD_Z = LATCH_FIELD_Z;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * The legal-entry test for a ruck bind. `fwd` is the attacking side's world
 * direction. Defence arrives from ahead of the ball (its own side of the
 * gate); attack arrives from behind the ball (its own hindmost-foot side).
 * The lat gate is the ruck's width between the hindmost feet.
 */
export function throughGate(
  x: number, z: number, ballX: number, ballZ: number, fwd: number, defence: boolean,
): boolean {
  if (Math.abs(x - ballX) > 1.55) return false;
  const depth = (z - ballZ) * fwd;
  return defence ? depth > -0.35 : depth < 0.35;
}

let nextId = 1;

export class LatchSystem {
  bodies: LatchBody[] = [];
  joints: LatchJoint[] = [];
  metrics: LatchMetrics = this.blankMetrics();

  private blankMetrics(): LatchMetrics {
    return {
      maxPenetration: 0, deepContacts: 0, worstPair: '',
      worstSnap: { ax: 0, az: 0, bx: 0, bz: 0, va: 0, vb: 0 },
      deepHistory: [], deepResolveFrames: 0,
      maxForce: 0, maxTorque: 0,
      instabilityFrames: 0, brokenJoints: 0, skippedBinds: 0, gateRejects: 0,
      releases: {}, frames: 0,
    };
  }

  reset(): void {
    this.bodies = [];
    this.joints = [];
    this.metrics = this.blankMetrics();
  }

  body(id: number): LatchBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  byTeamNum(team: 'A' | 'B', num: number, kind?: LatchBodyKind): LatchBody | undefined {
    return this.bodies.find((b) => b.team === team && b.num === num && (!kind || b.kind === kind));
  }

  byKind(kind: LatchBodyKind): LatchBody | undefined {
    return this.bodies.find((b) => b.kind === kind);
  }

  /** Finite-or-fallback: a spawn must never carry a non-finite number into
   *  the solver, even for one frame. */
  private static fin(v: number, fb = 0): number {
    return Number.isFinite(v) ? v : fb;
  }

  spawn(b: Omit<LatchBody, 'id' | 'bound' | 'seeking' | 'jitter' | 'upright' | 'tx' | 'tz' | 'roll' | 'rollVel'> & { upright?: number }): LatchBody {
    /* HIGH-DENSITY IMPACT HARDENING (endurance). Every body enters the
     * lattice through this door — the mount burst, the fend impulse, a
     * torn-and-rebuilt episode — so the clamps here are the last line
     * before the solver, and they price the entry in the solver's own
     * units: linear speed at MAX_V (no arrival may arrive faster than the
     * solver can integrate it without tunnelling a frame), angular speed
     * at MAX_YAW_V, and a finite state vector. The per-substep clamps
     * below stay as the in-flight budget; this is the door. */
    const sv = Math.hypot(LatchSystem.fin(b.vx), LatchSystem.fin(b.vz));
    const vScale = sv > MAX_V ? MAX_V / sv : 1;
    const mass = Math.max(1, LatchSystem.fin(b.mass, 100));
    const x = LatchSystem.fin(b.x), z = LatchSystem.fin(b.z);
    const body: LatchBody = {
      id: nextId++, kind: b.kind, team: b.team, num: b.num,
      x, y: clamp(LatchSystem.fin(b.y), 0, 1.4), z,
      vx: LatchSystem.fin(b.vx) * vScale, vy: clamp(LatchSystem.fin(b.vy ?? 0), -MAX_V, MAX_V), vz: LatchSystem.fin(b.vz) * vScale,
      yaw: wrapAngle(LatchSystem.fin(b.yaw)), yawVel: 0, roll: 0, rollVel: 0,
      mass, radius: Math.max(0.05, LatchSystem.fin(b.radius, 0.5)),
      upright: clamp(LatchSystem.fin(b.upright ?? (b.down ? 0.35 : 1), b.down ? 0.35 : 1), 0.2, 1),
      down: b.down, drive: clamp(LatchSystem.fin(b.drive), 0, CAP_F), driveDir: LatchSystem.fin(b.driveDir, 1),
      bound: false, seeking: false, tx: x, tz: z, jitter: 0,
    };
    this.bodies.push(body);
    return body;
  }

  /** An entrant still walking in: spring toward the mark, capped at a
   *  jog — he arrives, he does not jump. */
  seek(bodyId: number, x: number, z: number): void {
    const b = this.body(bodyId);
    if (!b || b.bound) return;
    b.seeking = true;
    b.tx = x; b.tz = z;
  }

  /** The entrant has reached the ruck — the approach stops, the contest
   *  drive takes over through the bind. */
  settle(bodyId: number): void {
    const b = this.body(bodyId);
    if (!b) return;
    b.seeking = false;
  }

  /**
   * Detect-and-bind. Returns the new joint, or null when the binding
   * conditions are not met — the caller must not let an unbound body push
   * the contest. The 1.2 m detection radius is the honest contact radius of
   * the tackle/ruck (upOpen uses 1.1 m to START a tackle; the bind takes
   * over while bodies compress).
   */
  bind(opts: {
    kind: LatchKind; a: number; b: number;
    anchorA?: LatchVec; anchorB?: LatchVec;
    axes?: Partial<LatchAxes>; breakN?: number; breakNm?: number;
    gate?: { fwd: number; defence: boolean };
  }): LatchJoint | null {
    const A = this.body(opts.a), B = this.body(opts.b);
    if (!A || !B) return null;
    const d = Math.hypot(B.x - A.x, B.z - A.z);
    if (d >= 1.2) {
      this.metrics.skippedBinds++;
      return null;
    }
    if (opts.gate && !throughGate(B.x, B.z, A.x, A.z, opts.gate.fwd, opts.gate.defence)) {
      this.metrics.gateRejects++;
      return null;
    }
    const ax = (k: number, c: number, rest: number, max: number): LatchAxis => ({ k, c, rest, max });
    const base: LatchAxes = {
      tx: ax(4300, 640, 0, 7000),      // lateral — the shoulder slides on contact
      ty: ax(2600, 430, 0, 4800),      // vertical — the fall is soft
      tz: ax(5600, 740, 0, 8000),      // axial — the shove channel
      rx: ax(1500, 250, 0, 620),       // pitch — they tip together
      ry: ax(1200, 220, 0, 560),       // roll — they lean together
      rz: ax(1700, 280, 0, 620),       // yaw twist
    };
    for (const k of Object.keys(base) as (keyof LatchAxes)[]) {
      if (opts.axes?.[k]) base[k] = { ...base[k], ...opts.axes![k] };
    }
    const joint: LatchJoint = {
      id: nextId++, kind: opts.kind, a: opts.a, b: opts.b,
      anchorA: opts.anchorA ?? { x: 0, y: 1.0, z: 0 },
      anchorB: opts.anchorB ?? { x: 0, y: 0.95, z: 0 },
      axes: base, breakN: opts.breakN ?? 6200, breakNm: opts.breakNm ?? 520,
      broken: false, reason: '', force: { x: 0, y: 0, z: 0 }, torque: 0, strain: 0, age: 0,
    };
    this.joints.push(joint);
    A.bound = true; B.bound = true;
    return joint;
  }

  /** Release joints by kind, recording the reason for the audit. */
  breakKind(kind: LatchKind, reason: string): number {
    let n = 0;
    for (const j of this.joints) {
      if (j.kind === kind && !j.broken) { j.broken = true; j.reason = reason; this.metrics.brokenJoints++; this.noteRelease(reason); n++; }
    }
    this.purge();
    return n;
  }

  breakJointsOf(bodyId: number, reason: string): number {
    let n = 0;
    for (const j of this.joints) {
      if ((j.a === bodyId || j.b === bodyId) && !j.broken) { j.broken = true; j.reason = reason; this.metrics.brokenJoints++; this.noteRelease(reason); n++; }
    }
    this.purge();
    return n;
  }

  /** Whistle / phase teardown: every bind releases (bodies keep their
   *  positions so nothing snaps when the presentation takes over).
   *
   *  TEARDOWN HARDENING — a whistle must leave ZERO live constraints behind,
   *  not just zero joints: the soft world anchors are constraints too (the
   *  ball's ground-mark spring keeps integrating against a ruck that no
   *  longer exists), so they release with the binds. The next mount re-seats
   *  everything it needs. Idempotent: calling twice frame-adjacently — a
   *  whistle racing a second stoppage — purges the second bind set exactly
   *  like the first. */
  clear(reason: string): void {
    for (const j of this.joints) {
      if (!j.broken) { j.broken = true; j.reason = reason; this.metrics.brokenJoints++; this.noteRelease(reason); }
    }
    this.joints = [];
    for (const b of this.bodies) { b.bound = false; b.seeking = false; b.drive = 0; b.anchor = undefined; }
  }

  /** A powerful fend: impulse J (N·s) through the carrier's body along his
   *  facing. The tackle joint reads the spike and snaps on separating
   *  overload (a driven release — the carrier blew past the shoulder);
   *  if the tackler's bind holds the spike, he hangs on and the tackle
   *  continues. Returns whether the bind broke. */
  fend(bodyId: number, J: number): boolean {
    const b = this.body(bodyId);
    if (!b) return false;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    b.vx += (fx * J) / b.mass;
    b.vz += (fz * J) / b.mass;
    let snapped = false;
    for (const j of this.joints) {
      if (j.broken || j.kind !== 'TACKLE') continue;
      if (j.a !== bodyId && j.b !== bodyId) continue;
      j.broken = true;
      j.reason = 'BREAK_STRENGTH';
      this.metrics.brokenJoints++;
      this.noteRelease('BREAK_STRENGTH');
      const A = this.body(j.a)!, B = this.body(j.b)!;
      A.bound = false; B.bound = false;
      A.seeking = false; B.seeking = false;
      snapped = true;
    }
    return snapped;
  }

  private noteRelease(reason: string): void {
    this.metrics.releases[reason] = (this.metrics.releases[reason] ?? 0) + 1;
  }

  private purge(): void {
    if (this.joints.some((j) => j.broken)) this.joints = this.joints.filter((j) => !j.broken);
  }

  /** World position of a body-frame anchor after yaw and upright (fall)
   *  rotation. forward = (sin yaw, cos yaw), right = (cos yaw, -sin yaw). */
  anchor(body: LatchBody, local: LatchVec): LatchVec {
    const s = Math.sin(body.yaw), c = Math.cos(body.yaw);
    return {
      x: body.x + local.x * c + local.z * s,
      y: body.y + local.y * body.upright,
      z: body.z - local.x * s + local.z * c,
    };
  }

  /** Advance the constraint world. Call once per engine frame with the
   *  engine dt; internally substeps for stability. */
  private lastDeep = false;
  step(dt: number): void {
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h);
    if (this.lastDeep) this.metrics.deepResolveFrames++;
    this.lastDeep = false;
    this.metrics.frames++;
    if (this.joints.some((j) => j.broken)) this.purge();
  }

  private substep(dt: number): void {
    const acc = new Map<number, LatchVec>();
    const accYaw = new Map<number, number>();
    const accUp = new Map<number, number>();
    const accRoll = new Map<number, number>();
    const ensure = (id: number) => {
      if (!acc.has(id)) acc.set(id, { x: 0, y: 0, z: 0 });
      if (!accYaw.has(id)) accYaw.set(id, 0);
      if (!accUp.has(id)) accUp.set(id, 0);
      if (!accRoll.has(id)) accRoll.set(id, 0);
    };

    /* ---- 1. compliant bind springs (6DOF: tx/ty/tz + rx/ry/rz) ---- */
    for (const j of this.joints) {
      const A = this.body(j.a), B = this.body(j.b);
      if (!A || !B) { j.broken = true; j.reason = 'MISSING_BODY'; continue; }
      const pa = this.anchor(A, j.anchorA);
      const pb = this.anchor(B, j.anchorB);
      const sA = Math.sin(A.yaw), cA = Math.cos(A.yaw);
      const rel = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
      const vrel = {
        x: (B.vx - A.vx) * cA + (B.vz - A.vz) * (-sA),
        y: B.vy - A.vy,
        z: (B.vx - A.vx) * sA + (B.vz - A.vz) * cA,
      };
      const tx = rel.x * cA - rel.z * sA;
      const ty = rel.y;
      const tz = rel.x * sA + rel.z * cA;
      const dyT = wrapAngle(B.yaw - A.yaw);
      const dyV = B.yawVel - A.yawVel;
      const drT = wrapAngle(B.roll - A.roll);
      const drV = B.rollVel - A.rollVel;
      const duT = B.upright - A.upright;

      const F = {
        x: clamp(j.axes.tx.k * (j.axes.tx.rest - tx) - j.axes.tx.c * vrel.x, -j.axes.tx.max, j.axes.tx.max),
        y: clamp(j.axes.ty.k * (j.axes.ty.rest - ty) - j.axes.ty.c * vrel.y, -j.axes.ty.max, j.axes.ty.max),
        z: clamp(j.axes.tz.k * (j.axes.tz.rest - tz) - j.axes.tz.c * vrel.z, -j.axes.tz.max, j.axes.tz.max),
      };
      const T = clamp(j.axes.rz.k * (j.axes.rz.rest - dyT) - j.axes.rz.c * dyV, -j.axes.rz.max, j.axes.rz.max);
      const Tr = clamp(j.axes.ry.k * (j.axes.ry.rest - drT) - j.axes.ry.c * drV, -j.axes.ry.max, j.axes.ry.max);
      const Tp = clamp(j.axes.rx.k * (j.axes.rx.rest - duT) - j.axes.rx.c * duT * 4, -j.axes.rx.max, j.axes.rx.max);

      const mag = Math.hypot(F.x, F.y, F.z);
      j.force = { x: F.x, y: F.y, z: F.z };
      j.torque = Math.max(Math.abs(T), Math.abs(Tr), Math.abs(Tp));
      j.strain = Math.max(mag / j.breakN, j.torque / j.breakNm);
      if (mag > this.metrics.maxForce) this.metrics.maxForce = mag;
      if (j.torque > this.metrics.maxTorque) this.metrics.maxTorque = j.torque;

      /* ---- release on breaking strength (fend / overload) ----
       * Breaking is TENSION: a bind must be ripped apart, not collided
       * apart. A carrier arriving at 7 m/s deposits an 8 kN compression
       * spike on the first frame — that is the impact a compliant bind
       * exists to ABSORB, not to fail on. Only a joint whose bodies are
       * actually separating (a fend, a violent roll-away) may exceed its
       * breaking strength. */
      const separating = (B.vx - A.vx) * (pb.x - pa.x)
        + (B.vy - A.vy) * (pb.y - pa.y)
        + (B.vz - A.vz) * (pb.z - pa.z);
      if (separating > 0 && j.strain > 1) {
        j.broken = true;
        j.reason = 'BREAK_STRENGTH';
        this.metrics.brokenJoints++;
        this.noteRelease('BREAK_STRENGTH');
        A.bound = false; B.bound = false;
        A.seeking = false; B.seeking = false;
        continue;
      }

      ensure(j.a); ensure(j.b);
      const fa = acc.get(j.a)!;
      const fb = acc.get(j.b)!;
      fa.x -= F.x * cA + F.z * sA;
      fa.z -= -F.x * sA + F.z * cA;
      fa.y -= F.y;
      fb.x += F.x * cA + F.z * sA;
      fb.z += -F.x * sA + F.z * cA;
      fb.y += F.y;
      accYaw.set(j.a, (accYaw.get(j.a) ?? 0) - T);
      accYaw.set(j.b, (accYaw.get(j.b) ?? 0) + T);
      accRoll.set(j.a, (accRoll.get(j.a) ?? 0) - Tr);
      accRoll.set(j.b, (accRoll.get(j.b) ?? 0) + Tr);
      accUp.set(j.a, (accUp.get(j.a) ?? 0) - Tp);
      accUp.set(j.b, (accUp.get(j.b) ?? 0) + Tp);
    }

    /* ---- 2. compliant body-body contact (no rigid projection) ---- */
    for (let i = 0; i < this.bodies.length; i++) {
      for (let k = i + 1; k < this.bodies.length; k++) {
        const A = this.bodies[i], B = this.bodies[k];
        const dx = B.x - A.x, dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        const min = A.radius + B.radius;
        if (d >= min) continue;
        /* Coincident bodies (the ball spawns under the carrier, and a pile
         * can stack exactly) must still resolve: use a deterministic normal
         * instead of dropping the pair, or they interpenetrate forever. */
        const nx = d > 0.001 ? dx / d : 1;
        const nz = d > 0.001 ? dz / d : 0;
        const pen = min - d;
        if (pen > this.metrics.maxPenetration) {
          this.metrics.maxPenetration = pen;
          this.metrics.worstPair = `${A.kind}#${A.num}-${B.kind}#${B.num}`;
          this.metrics.worstSnap = {
            ax: A.x, az: A.z, bx: B.x, bz: B.z,
            va: Math.hypot(A.vx, A.vz), vb: Math.hypot(B.vx, B.vz),
          };
        }
        if (pen > 0.8 && this.metrics.deepHistory.length < 8) {
          this.metrics.deepHistory.push(
            `${A.kind}#${A.num}-${B.kind}#${B.num} pen=${pen.toFixed(2)} `
            + `a(${A.x.toFixed(1)},${A.z.toFixed(1)})v${Math.hypot(A.vx, A.vz).toFixed(1)}`
            + `s${A.seeking ? 1 : 0}b${A.bound ? 1 : 0} `
            + `b(${B.x.toFixed(1)},${B.z.toFixed(1)})v${Math.hypot(B.vx, B.vz).toFixed(1)}`
            + `s${B.seeking ? 1 : 0}b${B.bound ? 1 : 0}`,
          );
        }
        if (pen > 0.45) this.metrics.deepContacts++;
        if (pen > 0.8) this.lastDeep = true;
        const vn = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
        const Fn = clamp(K_CONTACT * pen - C_CONTACT * vn, 0, CAP_F);
        // tangential sliding friction — the compliant replacement for
        // capsule sliding: it damps slide instead of projecting.
        const tx = -nz, tz = nx;
        const vt = (B.vx - A.vx) * tx + (B.vz - A.vz) * tz;
        const sgn = vt >= 0 ? 1 : -1;
        const Ft = Math.min(Math.abs(vt) * C_CONTACT, MU * Fn);
        const fx = nx * Fn - tx * Ft * sgn;
        const fz = nz * Fn - tz * Ft * sgn;
        ensure(A.id); ensure(B.id);
        const fa = acc.get(A.id)!, fb = acc.get(B.id)!;
        fa.x -= fx; fa.z -= fz; fb.x += fx; fb.z += fz;
        /* SPLIT IMPULSE — the joint lattice is an over-constrained pile: a
         * ruck bind pulls the shoulder onto the ball while the tackle bind
         * pulls the torso onto the tackler, so springs ALONE let centres
         * converge to one point (the deep 1.05 m fault). The force solution
         * cannot see that; the POSITION can. This is a bounded, per-frame
         * positional separation (<= 0.12 m, split by inverse mass — never a
         * projection across the field) plus an inelastic kill of the closing
         * velocity, so the pile settles at the contact envelope instead of
         * oscillating through it. This is the contact the gate measures:
         * players lean on each other and do not occupy the same turf. */
        const closing = vn < 0 ? -vn : 0;
        if (pen > 0.001) {
          const imA = 1 / Math.max(1, A.mass), imB = 1 / Math.max(1, B.mass);
          const wA = imA / (imA + imB), wB = 1 - wA;
          const corr = Math.min(pen, 0.12) * 0.8;
          A.x -= nx * corr * wA; A.z -= nz * corr * wA;
          B.x += nx * corr * wB; B.z += nz * corr * wB;
          if (closing > 0) {
            const dvA = -closing * wA, dvB = closing * wB;
            A.vx += nx * dvA; A.vz += nz * dvA;
            B.vx += nx * dvB; B.vz += nz * dvB;
          }

        }
      }
    }

    /* ---- 3. drive through the binds + integration ---- */
    for (const b of this.bodies) {
      ensure(b.id);
      const f = acc.get(b.id)!;
      if (b.bound && b.drive !== 0) f.z += b.drive * b.driveDir;
      if (b.seeking && !b.bound) {
        const dx = b.tx - b.x, dz = b.tz - b.z;
        const dd = Math.hypot(dx, dz);
        if (dd > 0.05) {
          const a = Math.min(4.6, dd * 9);
          f.x += (dx / dd) * b.mass * a;
          f.z += (dz / dd) * b.mass * a;
        }
      }

      if (b.anchor) {
        f.x += (b.anchor.x - b.x) * b.anchor.k - b.vx * b.anchor.c;
        f.z += (b.anchor.z - b.z) * b.anchor.k - b.vz * b.anchor.c;
      }

      const invM = 1 / Math.max(1, b.mass);
      const vPrev = Math.hypot(b.vx, b.vz);
      b.vx += f.x * invM * dt;
      b.vy += f.y * invM * dt;
      b.vz += f.z * invM * dt;
      const vNow = Math.hypot(b.vx, b.vz);
      if (vNow > MAX_V) { b.vx *= MAX_V / vNow; b.vz *= MAX_V / vNow; }
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      /* vertical: a soft floor spring — the pile settles, it does not float. */
      b.vy += (0 - b.y) * 90 * dt - b.vy * 9 * dt;
      b.y = clamp(b.y + b.vy * dt, 0, 1.4);
      b.yawVel = clamp(b.yawVel + ((accYaw.get(b.id) ?? 0) * invM * 0.45) * dt, -MAX_YAW_V, MAX_YAW_V);
      b.yaw = wrapAngle(b.yaw + b.yawVel * dt);
      b.rollVel = clamp(b.rollVel + ((accRoll.get(b.id) ?? 0) * invM * 0.45) * dt, -MAX_YAW_V, MAX_YAW_V);
      b.roll = clamp(b.roll + b.rollVel * dt, -1.2, 1.2);
      /* fall: the body's own down state and the bind's pitch channel both
       * tip the pair toward the ground together. */
      const wantUp = b.down ? 0.35 : 1;
      const du = (wantUp - b.upright) * 5.5 + (accUp.get(b.id) ?? 0) * invM * 0.006;
      b.upright = clamp(b.upright + du * dt, 0.2, 1);
      // pitch bounds: soft clamps only (a real boundary, never a snap)
      if (b.x < -FIELD_X) { b.x = -FIELD_X; if (b.vx < 0) b.vx = 0; }
      if (b.x > FIELD_X) { b.x = FIELD_X; if (b.vx > 0) b.vx = 0; }
      if (b.z < -FIELD_Z) { b.z = -FIELD_Z; if (b.vz < 0) b.vz = 0; }
      if (b.z > FIELD_Z) { b.z = FIELD_Z; if (b.vz > 0) b.vz = 0; }

      const vAfter = Math.hypot(b.vx, b.vz);
      b.jitter = Math.abs(vAfter - vPrev);
      if (!Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz + b.yaw + b.upright)) {
        b.x = 0; b.y = 0; b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
        b.yaw = 0; b.yawVel = 0; b.upright = 1;
        this.metrics.instabilityFrames++;
      }
    }

    /* ---- 4. WALL UNMERGE — the clamp just ran, and it can put a body
     * BACK onto its partner: a pile driven into touch presses a man onto
     * the ball anchored off the line, the contact split pushes the pair
     * apart, and the clamp re-pins the man on the very frame it did. The
     * pair then sits coincident at the wall (the 0.77 m boundary fault).
     * This pass runs AFTER the clamp, boundary pairs only, and separates
     * them the way `latchMount` seats a fresh pile — except here the wall
     * is a hard body, so a correction a body cannot take (it points into
     * the clamp) is handed to the other body, and if the pair is still
     * overlapping after that (both pinned on the same axis) the remainder
     * slides along the wall. Bounded and cheap: ≤3 passes, wall pairs
     * only, ≤0.15 m a frame. */
    for (let pass = 0; pass < 3; pass++) {
      let still = false;
      for (let i = 0; i < this.bodies.length; i++) {
        for (let k = i + 1; k < this.bodies.length; k++) {
          const A = this.bodies[i], B = this.bodies[k];
          const atXW = Math.abs(A.x) > FIELD_X - 0.35 || Math.abs(B.x) > FIELD_X - 0.35;
          const atZW = Math.abs(A.z) > FIELD_Z - 0.35 || Math.abs(B.z) > FIELD_Z - 0.35;
          if (!atXW && !atZW) continue;
          const dx = B.x - A.x, dz = B.z - A.z;
          const d = Math.hypot(dx, dz);
          const min = A.radius + B.radius;
          if (d >= min - 0.005) continue;
          const imA = 1 / Math.max(1, A.mass), imB = 1 / Math.max(1, B.mass);
          const wA = imA / (imA + imB), wB = 1 - wA;
          const nx = d > 0.001 ? dx / d : 0;
          const nz = d > 0.001 ? dz / d : 0;
          const corr = Math.min(min - d, 0.15) * 0.9;
          /* hand each body only the part of the correction it can take */
          let cA = corr * wA, cB = corr * wB;
          if (nz > 0.001 && B.z >= FIELD_Z - 0.001) { cA += cB; cB = 0; }   // +z wall
          else if (nz < -0.001 && B.z <= -FIELD_Z + 0.001) { cA += cB; cB = 0; }
          if (nz < -0.001 && A.z <= -FIELD_Z + 0.001) { cB += cA; cA = 0; }
          else if (nz > 0.001 && A.z >= FIELD_Z - 0.001) { cB += cA; cA = 0; }
          if (nx > 0.001 && B.x >= FIELD_X - 0.001) { cA += cB; cB = 0; }
          else if (nx < -0.001 && B.x <= -FIELD_X + 0.001) { cA += cB; cB = 0; }
          if (nx < -0.001 && A.x <= -FIELD_X + 0.001) { cB += cA; cA = 0; }
          else if (nx > 0.001 && A.x >= FIELD_X - 0.001) { cB += cA; cA = 0; }
          const moved = (Math.abs(nx) + Math.abs(nz)) > 0;
          if (moved) {
            A.x -= nx * cA; A.z -= nz * cA;
            B.x += nx * cB; B.z += nz * cB;
            A.x = clamp(A.x, -FIELD_X, FIELD_X); A.z = clamp(A.z, -FIELD_Z, FIELD_Z);
            B.x = clamp(B.x, -FIELD_X, FIELD_X); B.z = clamp(B.z, -FIELD_Z, FIELD_Z);
          }
          const d2 = Math.hypot(B.x - A.x, B.z - A.z);
          if (d2 < min - 0.005) {
            /* still overlapped: slide the remainder along the free axis */
            const rem = (min - d2) * 0.9;
            if (atZW) {
              const sgn = Math.abs(B.x - A.x) > 0.01
                ? Math.sign(B.x - A.x) : (A.num + B.num) % 2 ? 1 : -1;
              A.x -= sgn * rem * wA; B.x += sgn * rem * wB;
            } else {
              const sgn = Math.abs(B.z - A.z) > 0.01
                ? Math.sign(B.z - A.z) : (A.num + B.num) % 2 ? 1 : -1;
              A.z -= sgn * rem * wA; B.z += sgn * rem * wB;
            }
            A.x = clamp(A.x, -FIELD_X, FIELD_X); A.z = clamp(A.z, -FIELD_Z, FIELD_Z);
            B.x = clamp(B.x, -FIELD_X, FIELD_X); B.z = clamp(B.z, -FIELD_Z, FIELD_Z);
            const d3 = Math.hypot(B.x - A.x, B.z - A.z);
            if (d3 < min - 0.005) still = true;
          }
        }
      }
      if (!still) break;
    }
    for (const j of this.joints) j.age += dt;
  }

  /** The net horizontal drive applied THROUGH the binds: the ruck contest
   *  physically moves by this sum. `fwd` is the attacking side's world
   *  direction; returns attack/defence totals in N and the normalized net
   *  (−1..+1, attack positive). */
  latticeNet(fwd: number): { attack: number; defence: number; net: number } {
    let atk = 0, def = 0;
    for (const b of this.bodies) {
      if (!b.bound || b.kind === 'BALL' || b.drive === 0) continue;
      if (b.driveDir === fwd) atk += b.drive; else def += b.drive;
    }
    const tot = atk + def;
    return { attack: atk, defence: def, net: tot > 0 ? (atk - def) / tot : 0 };
  }

  /** Soft-anchor a body to a world point (the ruck's ground mark): the ball
   *  body pushes against it, so a winning shove visibly moves the contest
   *  without drifting it away. */
  anchorBody(bodyId: number, x: number, z: number, k = 16000, c = 2600): void {
    const b = this.body(bodyId);
    if (!b) return;
    b.anchor = { x, z, k, c };
  }

  /** Clears the anchor (used when a body leaves the lattice). */
  releaseAnchor(bodyId: number): void {
    const b = this.body(bodyId);
    if (b) b.anchor = undefined;
  }

  bindCounts(): { joints: number; tackle: number; ruck: number } {
    let tackle = 0, ruck = 0;
    for (const j of this.joints) { if (j.kind === 'TACKLE') tackle++; else ruck++; }
    return { joints: this.joints.length, tackle, ruck };
  }
}

/* ================== TEARDOWN LATCH HARDENING ==================
 *
 * The whistle teardown contract, in one place so the breakdown teardown, the
 * director's releaseAll and the headless probes cannot drift apart:
 *
 *   - every lattice weld (a LatchSystem joint) is purged,
 *   - every binding constraint (a bound lattice body, an anchor, a seek) is
 *     released,
 *   - every drag link (the open-play latchedBy/latchingOnto pair plus the
 *     live latch object) is cut across all thirty player entities,
 *
 * unconditionally — no "unless the drag is still live" carve-outs. A whistle
 * during an active multi-man contest ends the contest; anything the contest
 * owned must be gone on the whistle frame itself, not one frame later via
 * the leak guard. All three entry points are idempotent, so rapid,
 * frame-adjacent stoppage triggers purge the second bind set exactly like
 * the first instead of tripping over their own residue.
 */

/** What one unconditional purge removed. All counts are pre-purge reads. */
export interface LatchPurgeReport {
  jointsPurged: number;
  bodiesReleased: number;
  dragLinksPurged: number;
  latchObjectsCleared: number;
}

/** Live lattice welds — joints the solver is still integrating. */
export function countLiveJoints(sys: LatchSystem): number {
  return sys.joints.length;
}

/** Lattice bodies still carrying a binding constraint. */
export function countBoundBodies(sys: LatchSystem): number {
  let n = 0;
  for (const b of sys.bodies) if (b.bound) n++;
  return n;
}

/** Open-play drag links alive across the squad, plus the latch object itself.
 * A lone `latchDrag` tax with the links already cut still counts: it is the
 * residue that would tax the next episode's pace. */
export function countDragLinks(live: Live[], op?: OpenPlayState | null): number {
  let n = op?.latch ? 1 : 0;
  for (const p of live) if (p.latchedBy || p.latchingOnto || p.latchDrag !== undefined) n++;
  return n;
}

/**
 * Purge every weld, bind and drag link unconditionally. Safe to call with an
 * already-clean system, and safe to call twice on adjacent frames.
 */
export function releaseAll(
  sys: LatchSystem, live: Live[], op?: OpenPlayState | null, reason = 'WHISTLE',
): LatchPurgeReport {
  const report: LatchPurgeReport = {
    jointsPurged: sys.joints.length,
    bodiesReleased: 0,
    dragLinksPurged: 0,
    latchObjectsCleared: op?.latch ? 1 : 0,
  };
  for (const b of sys.bodies) if (b.bound) report.bodiesReleased++;
  sys.clear(reason);
  for (const p of live) {
    if (p.latchedBy || p.latchingOnto || p.latchDrag !== undefined) {
      p.latchedBy = null;
      p.latchingOnto = null;
      p.latchDrag = undefined;
      if (p.movedBy === 'latch') p.movedBy = undefined;
      if (p.clip === CLIP_LATCH_CARRY || p.clip === CLIP_LATCH_HANG) { p.clip = 'ready'; p.clipT = 0; }
      report.dragLinksPurged++;
    }
  }
  if (op?.latch) op.latch = undefined;
  return report;
}

/**
 * Assert the post-teardown invariant: 0 live joints, 0 bound bodies, 0 drag
 * links. Returns the residue counts; warns in dev when the purge left
 * anything behind so a headless harness reports the precise leak instead of
 * tuning past it.
 */
export function assertNoLatchLeaks(
  sys: LatchSystem, live: Live[], op?: OpenPlayState | null, where = 'teardown',
): { leakedJoints: number; unreleasedBound: number; dragLinks: number } {
  const leakedJoints = countLiveJoints(sys);
  const unreleasedBound = countBoundBodies(sys);
  const dragLinks = countDragLinks(live, op);
  if ((leakedJoints + unreleasedBound + dragLinks) > 0 && import.meta.env?.DEV) {
    console.warn(
      `[latch-teardown] ${where}: purge left ${leakedJoints} joints, `
      + `${unreleasedBound} bound bodies, ${dragLinks} drag links behind`,
    );
  }
  return { leakedJoints, unreleasedBound, dragLinks };
}
