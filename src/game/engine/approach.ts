/** T-03 — the shared exponential approach used by every engine module. */
export const approach = (a: number, b: number, rate: number, dt: number): number => {
  /* Endurance hardening: this primitive sits under every velocity and
   * position smoother in the engine. If either end is non-finite (a bad
   * frame upstream, a torn-down state), propagating the NaN into the write
   * is exactly how a single glitched frame becomes a whole-body explosion.
   * Snap to the finite end instead — the target when there is one, zero when
   * there is not. A finite result is a legal engine value; a NaN is not. */
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number.isFinite(b) ? b : 0;
  }
  return a + (b - a) * (1 - Math.exp(-rate * dt));
};

/* ================================================================== *
 * AERIAL CONTESTS — CONVERGING ON A HIGH BALL
 * ================================================================== *
 *
 * A bomb is not a catch, it is a contest: two men run at the same patch of
 * grass, and the one who times his leap best takes it. Until now the engine
 * had no notion of it — a descending ball was gathered by whoever happened
 * to be inside the reach radius, standing flat-footed, and Law 9.17 (the man
 * in the air) could not exist because nobody was ever in the air.
 *
 * This module owns the KINEMATICS of the contest: where the contesting men
 * converge, when they leave the ground, and how high they get. The LAW —
 * whether a challenge on an airborne man is an offence — lives in
 * `engine/referee.ts` next to the rest of the referee's judgements, and the
 * bind that a challenge actually goes through lives in `engine/latch.ts`.
 * Three files, three concerns, one contest.
 */

/** A player's contest reach: how high off the ground his HANDS get, as a
 *  multiple of his build. A 1.0-build man reaches ~2.15 m standing, which
 *  is the same number the gather radius uses. */
export const AERIAL_STANDING_REACH_M = 2.15;

/** What a leap adds to that reach, at the apex of the jump. Metres. */
export const AERIAL_JUMP_REACH_M = 0.62;

/** How long a contesting leap keeps a man off the turf, seconds. Below
 *  this the two feet are back down and Law 9.17's protection has ended. */
export const AERIAL_HANG_SECONDS = 0.72;

/** The vertical speed a contesting leap leaves the ground with, and the
 *  gravity it comes back down under. Chosen so the hang is
 *  AERIAL_HANG_SECONDS and the apex is AERIAL_JUMP_REACH_M. */
export const AERIAL_LEAP_VY = 4.0 * AERIAL_JUMP_REACH_M / AERIAL_HANG_SECONDS;
export const AERIAL_LEAP_G = 8.0 * AERIAL_JUMP_REACH_M / (AERIAL_HANG_SECONDS * AERIAL_HANG_SECONDS);

/** The height above which a player's feet are considered OFF THE GROUND for
 *  the purposes of Law 9.17. A hair off zero: the protection begins the
 *  instant he leaves the turf, not once he is waist high. */
export const AERIAL_AIRBORNE_EPSILON_M = 0.05;

/** Is this man, at this jump height, legally "in the air"? The single
 *  predicate both the contest and the referee read, so a jumper cannot be
 *  airborne to one and grounded to the other. */
export function isAirborne(jumpY: number | undefined): boolean {
  return (jumpY ?? 0) > AERIAL_AIRBORNE_EPSILON_M;
}

/** How high a contesting player's hands reach right now: his build's
 *  standing reach plus whatever the leap has given him. */
export function aerialReach(size: number, jumpY: number | undefined): number {
  const s = Number.isFinite(size) && size > 0 ? size : 1;
  return AERIAL_STANDING_REACH_M * s + Math.max(0, jumpY ?? 0);
}

/**
 * Where a descending ball will be at catching height, and how long until it
 * gets there. This is the mark converging players run at — the ball's own
 * ballistic solution, not its current position, because a man who runs at
 * where a bomb IS arrives after it has landed.
 *
 * Pure ballistics over the ball's state; `catchY` is the height the contest
 * happens at (a jumper's reach), and the result is clamped to the field.
 */
export function aerialLandingMark(
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  catchY: number,
  g = 9.81,
): { x: number; z: number; eta: number } {
  const y0 = Number.isFinite(ball.y) ? ball.y : 0;
  const vy = Number.isFinite(ball.vy) ? ball.vy : 0;
  /* Solve y0 + vy t − ½ g t² = catchY for the LATER root (the descent). */
  const disc = vy * vy + 2 * g * (y0 - catchY);
  let eta = disc > 0 ? (vy + Math.sqrt(disc)) / g : 0;
  if (!Number.isFinite(eta) || eta < 0) eta = 0;
  if (eta > 6) eta = 6;
  const x = Number.isFinite(ball.x) ? ball.x + (Number.isFinite(ball.vx) ? ball.vx : 0) * eta : 0;
  const z = Number.isFinite(ball.z) ? ball.z + (Number.isFinite(ball.vz) ? ball.vz : 0) * eta : 0;
  return {
    x: x < -34 ? -34 : x > 34 ? 34 : x,
    z: z < -60 ? -60 : z > 60 ? 60 : z,
    eta,
  };
}

/**
 * One tick of a contesting leap. Returns the new vertical state; the caller
 * owns the write, exactly like `tickSinBin` and `stepMaulStall`.
 *
 * A leap is deliberately NOT steerable: once his feet leave the ground the
 * man is committed, which is the whole reason Law 9.17 protects him.
 */
export function stepAerialJump(
  jumpY: number, jumpVY: number, dt: number,
): { jumpY: number; jumpVY: number; landed: boolean } {
  if (!Number.isFinite(jumpY) || !Number.isFinite(jumpVY) || !Number.isFinite(dt)) {
    return { jumpY: 0, jumpVY: 0, landed: true };
  }
  const vy = jumpVY - AERIAL_LEAP_G * dt;
  const y = jumpY + vy * dt;
  if (y <= 0) return { jumpY: 0, jumpVY: 0, landed: true };
  return { jumpY: y, jumpVY: vy, landed: false };
}
