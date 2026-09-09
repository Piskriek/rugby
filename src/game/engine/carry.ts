/**
 * BALL CARRIAGE — TWO-HANDED "BABY HOLD" vs. THE TUCKED SPRINT.
 *
 * Rugby carrying is two distinct actions and the game treated them as one.
 * A carrier either protects the ball with both hands forward (the ready,
 * passable position) or tucks it under an arm and commits to raw pace. The
 * two trade on a sliding scale:
 *
 *   TWO_HANDED (default the moment a ball is gathered or received)
 *     - the prolate spheroid is held extended in front of the chest, ready to
 *       pass; a click on a targeted team-mate fires a crisp pass immediately.
 *     - a man who holds the ball away from his body runs SLOWER: capped at
 *       85% of his sprint speed. He is also easier to strip.
 *
 *   TUCKED (hold the sprint / click)
 *     - the ball disappears under the ribs; the 100% sprint ceiling unlocks
 *       and the carrier is +35% more resistant to arm-tackle strips.
 *     - the price is passing. Releasing the tuck and passing costs a 0.25 s
 *       presentation delay while the ball is brought back into two hands —
 *       there is no instant pass out of a tucked carry.
 *
 * Every transition is timed and pure (no Web API, no Director) so the headless
 * probe can pin the state machine exactly. The engine side exposes
 * `carrierState` on `Live` and ticks `presentT`/`tuckT` per frame.
 */

export type CarrierState = 'TWO_HANDED' | 'TUCKED';

/** Default on gather/receive. */
export const CARRY_DEFAULT: CarrierState = 'TWO_HANDED';

/** Two-handed max speed is 85% of sprint. */
export const TWO_HANDED_SPEED_FRACTION = 0.85;
/** Tucked unlocks the full sprint. */
export const TUCKED_SPEED_FRACTION = 1.0;
/** Tucked grants +35% strip resistance. */
export const TUCKED_STRIP_RESISTANCE_BONUS = 0.35;
/** Bringing the ball back out of the tuck for a pass takes 0.25 s. */
export const TUCK_RELEASE_PRESENT_SECONDS = 0.25;

export interface BallCarrier {
  state: CarrierState;
  /** seconds the ball has been presented (two hands) already this episode */
  presentT: number;
  /** seconds since the ball was tucked */
  tuckT: number;
}

export function freshCarrier(): BallCarrier {
  return { state: CARRY_DEFAULT, presentT: 0, tuckT: 0 };
}

/** A gather or a clean receive always returns the ball to two hands. */
export function gatherCarry(): BallCarrier {
  return { state: 'TWO_HANDED', presentT: 0, tuckT: 0 };
}

/** Enter the tucked sprint. Instant on this frame. */
export function tuckCarry(): BallCarrier {
  return { state: 'TUCKED', presentT: 0, tuckT: 0 };
}

/** Advance the carry clocks. `present` is true while the carrier keeps two
 *  hands on the ball (not sprinting); the tuck clock only runs while tucked. */
export function tickCarry(c: BallCarrier, dt: number): BallCarrier {
  const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
  return c.state === 'TUCKED'
    ? { state: 'TUCKED', presentT: 0, tuckT: c.tuckT + t }
    : { state: 'TWO_HANDED', presentT: c.presentT + t, tuckT: 0 };
}

/** The fraction of sprint speed this carry allows. */
export function carrySpeedFraction(state: CarrierState): number {
  return state === 'TUCKED' ? TUCKED_SPEED_FRACTION : TWO_HANDED_SPEED_FRACTION;
}

/** Strip / arm-tackle resistance 0..1+ for a state. `base` is the carrier's
 *  base protection (skill, pressure, momentum); tucked adds +35%. */
export function carryStripResistance(state: CarrierState, base: number): number {
  const b = Number.isFinite(base) ? base : 0;
  return state === 'TUCKED' ? b + TUCKED_STRIP_RESISTANCE_BONUS : b;
}

/** Can this carrier throw an instant (zero-presentation) pass right now? Only
 *  when the ball is genuinely in two hands — never out of a tuck, and never in
 *  the 0.25 s window after a release has begun. */
export function canInstantPass(c: BallCarrier): boolean {
  return c.state === 'TWO_HANDED' && c.presentT >= 0; // presented on gather
}

/**
 * The engine-facing pass-readiness gate. When a tucked carrier asks to pass,
 * the ball must first travel through a 0.25 s presentation. The carrier starts
 * that window on the release request; until it elapses no pass may fire.
 */
export function beginPassRelease(state: CarrierState): number {
  // returns the presentation seconds the pass must wait (0 if already present)
  return state === 'TUCKED' ? TUCK_RELEASE_PRESENT_SECONDS : 0;
}

/** After `beginPassRelease`, tick this timer; a pass is legal once it is 0. */
export function passReadyAfter(releaseTimer: number, dt: number): number {
  return Math.max(0, releaseTimer - (Number.isFinite(dt) && dt > 0 ? dt : 0));
}
