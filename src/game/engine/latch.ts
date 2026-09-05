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
 */
export function beginLatch(s: OpenPlayState, carrier: Live, tackler: Live, dived: boolean): LatchState {
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
  if (carrier) { carrier.latchedBy = null; carrier.latchDrag = undefined; }
  if (tackler) tackler.latchingOnto = null;
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
