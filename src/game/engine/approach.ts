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

/* ================================================================== *
 * RUNNING KINEMATICS & MOMENTUM — WHO RUNS HOW FAST, HOW HE GETS THERE
 * ================================================================== *
 *
 * Until now a man reached his top speed the moment the target changed — an
 * exponential blend toward a capped `want` with a fixed accel rate, so a prop
 * and a wing differed only in the asymptote, never in how a sprint LEAVES the
 * line. Real locomotion has three extra rules that this section adds:
 *
 *  1  TOP SPEED IS POSITIONAL. A prop and a lock both top out at 7.5 m/s, a
 *     back-row man at 8.2, a halfback or centre at 8.8, a winger or full-back
 *     at 9.4. Speed is a job description first and an attribute second — a
 *     unit picks his ceiling from his shirt, not from a talent roll.
 *
 *  2  ACCELERATION DIES AS YOU CLOSE ON TOP SPEED. a(v) = a_max (1 − v/v_max)
 *     with a_max = 4.5 m/s²: the first stride away from a standstill is the
 *     explosive one and the last metre toward top speed is the hardest won.
 *     This is the curve that makes a sprint read as effort rather than a
 *     switch, and it caps every man at a velocity his own acceleration cannot
 *     exceed.
 *
 *  3  SPEED COSTS TURNING. A man at 9 m/s cannot cut like a man at 3. The
 *     minimum radius R = v²/a_lat (a_lat = 6.0 m/s²) grows with speed, so a
 *     demanding change of heading either respects the radius or pays for it:
 *     a cut sharper than 45° above 6 m/s forces a deceleration (a foot-plant)
 *     before the new direction can be burst out of.
 *
 * Every function here is pure and deterministic so the headless probe can pin
 * the numbers without a pitch, a controller or a renderer.
 */

/** One of the four positional speed tiers, by shirt group. */
export type RunTier =
  | 'FRONT5'        // props & locks: 1,2,3,4,5
  | 'BACK_ROW'      // 6,7,8
  | 'HALF_CENTRE'   // 9,10,12,13
  | 'BACK3';        // 11,14,15

/** The ceiling each tier is granted. The spec's four position speeds. */
export const TIER_TOP_SPEED_MS: Record<RunTier, number> = {
  FRONT5: 7.5,
  BACK_ROW: 8.2,
  HALF_CENTRE: 8.8,
  BACK3: 9.4,
};

/** The maximum acceleration a standing man can apply, m/s². */
export const ACCEL_MAX_MS2 = 4.5;
/** The lateral (turning) acceleration budget, m/s² — see minTurnRadius. */
export const LAT_ACCEL_MS2 = 6.0;
/** A cut sharper than this (radians) is a genuine direction change. */
export const SHARP_CUT_RAD = (45 * Math.PI) / 180;
/** Above this speed a sharp cut must cost a foot-plant deceleration. */
export const SHARP_CUT_SPEED_MS = 6.0;

/** Which speed tier a shirt belongs to. Anything outside 1–15 is a BACK3. */
export function runTierForShirt(shirt: number): RunTier {
  if (shirt <= 5) return 'FRONT5';
  if (shirt <= 8) return 'BACK_ROW';
  if (shirt === 11 || shirt === 14 || shirt === 15) return 'BACK3';
  return 'HALF_CENTRE';
}

/** A player's positional top speed in m/s. `front5` lets the probe or a
 *  difficulty dial treat props as a single block without knowing the table. */
export function positionTopSpeed(shirt: number): number {
  return TIER_TOP_SPEED_MS[runTierForShirt(shirt)];
}

/**
 * The momentum acceleration law, a(v) = a_max (1 − v/v_max). At rest it is the
 * full a_max; it falls to zero as v closes on v_max (a man at his ceiling has
 * no acceleration left). Clamped so it never goes negative.
 */
export function accelerationAt(speedMS: number, topSpeedMS: number): number {
  const vMax = topSpeedMS > 0 ? topSpeedMS : 1;
  const v = speedMS < 0 ? 0 : speedMS;
  const frac = v / vMax;
  return frac >= 1 ? 0 : ACCEL_MAX_MS2 * (1 - frac);
}

/** The tightest turn a man can hold at this speed without breaking his lateral
 *  acceleration budget: R_min = v² / a_lat. Metres. */
export function minTurnRadius(speedMS: number): number {
  const s = speedMS < 0 ? 0 : speedMS;
  return (s * s) / LAT_ACCEL_MS2;
}

/** The fastest a man travelling at `speed` may rotate his heading in one
 *  second while staying inside his lateral budget (rad/s = a_lat / v). */
export function maxTurnRate(speedMS: number): number {
  const s = speedMS < 0 ? 0 : speedMS;
  if (s < 1e-4) return Infinity; // standing: no turning restriction
  return LAT_ACCEL_MS2 / s;
}

/**
 * Whether a change of heading at this speed demands a foot-plant: the cut is
 * sharper than 45° AND the man is moving above 6 m/s. When true, the new
 * heading cannot be burst into at full pace — `plantedStep` decelerates first.
 */
export function sharpCutNeedsPlant(speedBefore: number, turnAngleRad: number): boolean {
  const ang = Math.abs(turnAngleRad);
  return speedBefore > SHARP_CUT_SPEED_MS && ang > SHARP_CUT_RAD;
}

/**
 * Advance a runner's momentum state by one frame under the a(v) law, with a
 * turn-radius constraint and the sharp-cut foot-plant.
 *
 * @param state   current {vx, vz} m/s
 * @param desired target {dx, dz} direction (need not be normalised)
 * @param topSpeed positional ceiling, m/s
 * @param dt      seconds
 *
 * Steps:
 *  - resolve the desired heading and the turn it implies from the current one;
 *  - if that turn is over the budget, clamp to the maxTurnRate; if it is a
 *    sharp cut above 6 m/s, apply a foot-plant deceleration before bursting;
 *  - accelerate along the surviving heading with a(|v|) and integrate.
 * Returns the new velocity (position integration is the caller's).
 */
export function stepRunMomentum(
  state: { vx: number; vz: number },
  desired: { dx: number; dz: number },
  topSpeed: number,
  dt: number,
): { vx: number; vz: number; planted: boolean; speed: number } {
  if (!Number.isFinite(dt) || dt <= 0) {
    return { vx: Number.isFinite(state.vx) ? state.vx : 0, vz: Number.isFinite(state.vz) ? state.vz : 0, planted: false, speed: Math.hypot(state.vx, state.vz) };
  }
  const c = clamp01;
  const vx = Number.isFinite(state.vx) ? state.vx : 0;
  const vz = Number.isFinite(state.vz) ? state.vz : 0;
  const speed = Math.hypot(vx, vz);
  const dl = Math.hypot(desired.dx, desired.dz);
  const top = topSpeed > 0 ? topSpeed : 1;
  if (dl < 1e-6) {
    // No desire: decelerate toward rest under a(0→v) reversed — a man stops
    // as the square wants to, shedding pace fast then coasting in.
    const stop = Math.min(speed, 4.5 * dt);
    const k = speed > 1e-6 ? (speed - stop) / speed : 0;
    const nvx = vx * k, nvz = vz * k;
    return { vx: nvx, vz: nvz, planted: false, speed: Math.hypot(nvx, nvz) };
  }
  const dnx = desired.dx / dl, dnz = desired.dz / dl;

  // Heading change this step, in radians.
  const cosTurn = speed > 1e-6
    ? c((vx * dnx + vz * dnz) / speed)
    : 1;
  let turnRad = Math.acos(cosTurn);
  let planted = false;

  if (speed > 1e-3 && turnRad > 1e-4) {
    // Respect the turn-rate budget (R ≥ v²/a_lat): cap the heading rotation.
    const allowed = maxTurnRate(speed) * dt;
    if (turnRad > allowed && Number.isFinite(allowed)) turnRad = allowed;
    // A sharp cut at pace plants a foot and bleeds speed before the burst.
    const wantAngle = Math.acos(c(Math.abs(cosTurn)));
    if (sharpCutNeedsPlant(speed, wantAngle)) {
      // The plant sheds ~35% of speed so the new direction can be driven from
      // a lower v (and therefore at a higher acceleration + tighter radius).
      planted = true;
    }
  }

  // Build the effective new heading (rotate toward desired by turnRad).
  let hx: number, hz: number;
  if (speed > 1e-3) {
    const curAngle = Math.atan2(vz, vx);
    const targetAngle = Math.atan2(dnz, dnx);
    let dAng = targetAngle - curAngle;
    while (dAng > Math.PI) dAng -= 2 * Math.PI;
    while (dAng < -Math.PI) dAng += 2 * Math.PI;
    const sign = dAng >= 0 ? 1 : -1;
    const newAngle = curAngle + sign * turnRad;
    hx = Math.cos(newAngle);
    hz = Math.sin(newAngle);
  } else {
    hx = dnx; hz = dnz;
  }

  // Foot-plant: bleed speed before the burst accelerates.
  let baseSpeed = speed;
  if (planted) baseSpeed = Math.max(0, baseSpeed - 1.9 * dt * 0.75);
  // Planted cuts also reset the acceleration term — a man re-accelerates.
  const accel = planted ? ACCEL_MAX_MS2 * 0.9 : accelerationAt(baseSpeed, top);
  const dv = Math.min(accel * dt, Math.max(0, top - baseSpeed));
  const ns = baseSpeed + dv;
  return { vx: hx * ns, vz: hz * ns, planted, speed: ns };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
