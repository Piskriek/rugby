/**
 * SPEC_13 — Law 11: the throw-forward vector test.
 *
 * The law does not ask *"did the ball move forward over the ground?"* It asks
 * *"did the ball leave the thrower's hands forward relative to HIM?"* A flat
 * pass by a man running at 7 m/s is legal; the same pass by a stationary man
 * is not. The absolute trajectory is the wrong frame, and it is the frame a
 * naive test uses — measured, a naive test whistles 17 passes per 600 s where
 * the law calls 9, and those 8 extra are the passing game.
 *
 * The quantity is a velocity, taken at the instant of release:
 *
 *     v_rel = v_ball − v_man
 *     rel   = (v_rel · ẑ) · σ            // σ = +1 for A, −1 for B
 *
 * `rel > tol` is a throw-forward. Units are metres per second along the
 * attack axis.
 *
 * Two components are DELIBERATELY discarded:
 *   - the lateral component. Law 11 is about travel toward the opposing
 *     dead-ball line. A pass thrown square at 13 m/s is not forward at any
 *     speed; keeping the lateral term would whistle every cut-out in the game.
 *   - the vertical component. The arc is not direction.
 *
 * Architecture mirrors `engine/offside.ts`: one pure module, one registry of
 * the numbers that differ between modes, one verdict function. The two laws
 * should read the way each other does.
 */


/**
 * The ball's ground speed in flight. `upOpen` flies it at a constant rate;
 * this is that rate, and it is what turns a direction into a velocity.
 */
export const PASS_SPEED = 13;

/**
 * How much of the receiver's run-on the throw is led by. This is the engine's
 * existing convention (0.8 of top speed, from the old `solvePassTarget`) and
 * it is a LEAD, not a forward bias: it points where the receiver is going,
 * which is only forward if he is running forward.
 */
export const PASS_LEAD = 0.8;

/** A solved throw: where the ball is aimed, and how long it is in the air. */
export interface PassAim {
  x: number;
  z: number;
  /** seconds of flight at `PASS_SPEED` */
  flight: number;
  /** metres of flight */
  dist: number;
}

/**
 * Solve the intercept — where to throw so that ball and receiver arrive
 * together.
 *
 * One iteration is a guess (the receiver moves while the ball is in the air,
 * so the first estimate of the flight time is short); two is a solve. Two is
 * also all this needs: the third iteration moves the aim point by centimetres.
 *
 * Pure: scalars and plain objects in, a plan out. It moves nobody and reads
 * no Director, per the house rules.
 */
export function solvePassAim(
  from: { x: number; z: number },
  rec: { x: number; z: number; vx: number; vz: number },
): PassAim {
  let t = Math.hypot(rec.x - from.x, rec.z - from.z) / PASS_SPEED;
  let ax = rec.x, az = rec.z;
  for (let i = 0; i < 2; i++) {
    ax = rec.x + rec.vx * t * PASS_LEAD;
    az = rec.z + rec.vz * t * PASS_LEAD;
    t = Math.hypot(ax - from.x, az - from.z) / PASS_SPEED;
  }
  return { x: ax, z: az, flight: Math.max(0.08, t), dist: Math.hypot(ax - from.x, az - from.z) };
}

/**
 * THE TEST. Metres per second the ball carries forward relative to the man
 * who threw it.
 *
 * `rel > 0` means the ball left the hands travelling toward the opposition
 * dead-ball line faster than the thrower himself was. That — and only that —
 * is a throw-forward.
 */
export function passReleaseRel(
  from: { x: number; z: number },
  aim: { x: number; z: number },
  throwerVz: number,
  dir: number,
): number {
  const dx = aim.x - from.x, dz = aim.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  /* The ball's velocity along z, and the thrower's momentum allowance. Only
   * FORWARD momentum counts: a man backpedalling gets no allowance, because
   * his legs are not carrying the ball anywhere. */
  const ballVz = (dz / len) * PASS_SPEED;
  /* Convert the allowance back into a world-z velocity so it can be
   * subtracted: `max(0, v·σ)·σ`. Since σ² = 1 this is exactly the forward
   * component, and only when it is positive. */
  const allowed = Math.max(0, throwerVz * dir) * dir;
  return (ballVz - allowed) * dir;
}

/** Convenience: the same quantity, from a solved aim. */
export function relForAim(
  car: { x: number; z: number; vz: number }, aim: PassAim, dir: number,
): number {
  return passReleaseRel(car, aim, car.vz, dir);
}

/**
 * The floor below which a "forward" reading is floating-point weather.
 * Selection holds the CPU to this, not to the referee's tolerance, so the
 * solver never offers anything the STRICT referee would whistle.
 */
export const PASS_FORWARD_EPSILON = 0.1;

/** How far forward of the thrower's momentum the ball will land, in metres. */
export function forwardMetres(rel: number, flight: number): number {
  return rel * flight;
}

/**
 * Pull an aim back until the release is legal. Same pass, thrown flatter —
 * the lateral line is preserved and only the depth changes, which is what a
 * real player does when his receiver has run too far ahead: he doesn't throw
 * it forward, he throws it shorter.
 *
 * A stepping search rather than a closed form, because the closed form is
 * degenerate when the pass is thrown straight up the line (no lateral
 * component to trade against), and a referee should not need to handle a
 * special case correctly at speed. Twelve steps of 35 cm covers 4.2 m, which
 * is more depth than any legal pass in this game has.
 */
export function clampAimLegal(
  from: { x: number; z: number },
  aim: PassAim,
  throwerVz: number,
  dir: number,
  tol: number,
): PassAim {
  let z = aim.z;
  let rel = passReleaseRel(from, { x: aim.x, z }, throwerVz, dir);
  for (let i = 0; i < 12 && rel > tol; i++) {
    z -= dir * 0.35;
    rel = passReleaseRel(from, { x: aim.x, z }, throwerVz, dir);
  }
  const dist = Math.hypot(aim.x - from.x, z - from.z);
  return { x: aim.x, z, dist, flight: Math.max(0.08, dist / PASS_SPEED) };
}

/* ======================== THE REFEREE'S TEMPER ======================== */

export type FwdStrictness = 'STRICT' | 'LENIENT' | 'OFF';

export interface FwdProfile {
  /** m/s of relative forward velocity the referee forgives. */
  tol: number;
  /** false = observe, count and grade, but never blow. */
  blows: boolean;
}

export const FWD_STRICTNESS: Record<FwdStrictness, FwdProfile> = {
  /* STRICT carries an epsilon, not a zero. In a dt-stepped physics frame a
   * true zero whistles on floating-point noise: a perfectly flat pass
   * evaluates to +1e-16 and is a scrum. 0.1 m/s is a tenth of a metre per
   * second — invisible over any flight, and safely above the noise. */
  STRICT: { tol: 0.1, blows: true },
  /* LENIENT is the shipped default: a visual grace. 1.5 m/s over a 0.6 s
   * flight is 0.9 m of forward travel, which is roughly the width of a man's
   * stride and the sort of thing a referee plays on when the pass is flat and
   * the receiver is clearly running onto it. */
  LENIENT: { tol: 1.5, blows: true },
  /* OFF measures the law and never whistles. The rate stays visible, which is
   * what let SPEC_12 prove the referee was not the cause of its drift. */
  OFF: { tol: 0.1, blows: false },
};

/** The option is a number at runtime; this is where it becomes a referee. */
export function fwdProfile(mode: number): FwdProfile {
  return mode === 0 ? FWD_STRICTNESS.STRICT : mode === 2 ? FWD_STRICTNESS.OFF : FWD_STRICTNESS.LENIENT;
}
