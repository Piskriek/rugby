/**
 * THE BACKLINE ECHELON, AND RUNNING ONTO THE BALL.
 *
 * Two faults, one cause: the backline was authored as a set of INDEPENDENT
 * marks (a lat/depth pair per shirt in shapes.ts, a dataset offset per shirt
 * in the positional dataset), so nothing in the game ever expressed the one
 * relationship that actually defines a backline — that each man stands
 * BEHIND AND OUTSIDE the man inside him.
 *
 *   1. FLAT LINE. 10, 12 and 13 were authored at 7.4 / 8.0 / 8.6 metres of
 *      depth: a spread of 1.2 m across twelve metres of width, which draws
 *      on screen as a flat horizontal line. A real backline runs a diagonal
 *      — an ECHELON — so that every man is running FORWARD onto a ball
 *      travelling sideways, and so that a defender who shoots out of the
 *      line cannot take two receivers at once.
 *
 *   2. STANDING START. Every receiver waited on his mark for the ball to
 *      arrive, took it at a walk, and was tackled on the catch. A backline
 *      moves before the ball does: the moment it leaves the scrum-half's
 *      hands, the men outside the first receiver are already running, so
 *      they meet the pass at pace.
 *
 * Both are pure geometry and pure kinematics — no Live state is read or
 * written here. The Director applies the results.
 */

/* ============================ THE ECHELON ============================ */

/** The shirts of the backline, from first receiver outward. */
export const BACKLINE_SHIRTS = [10, 12, 13, 11, 14, 15] as const;
export type BacklineShirt = (typeof BACKLINE_SHIRTS)[number];

/** Metres of extra depth each centre takes behind the man inside him. */
export const ECHELON_STEP_METRES = 3;
/** Metres the wingers sit deeper than the 13 (they have the furthest to run). */
export const WINGER_EXTRA_DEPTH_METRES = 5;

/**
 * Extra depth, in metres BEHIND the flyhalf, for each backline shirt.
 *
 *   10  0    the reference — the first receiver's depth is the shape's
 *   12  −3   three metres behind the 10
 *   13  −6   three metres behind the 12
 *   11  −11  five metres deeper than the 13
 *   14  −11  the same, on the other touchline
 *   15  −11  the sweeper runs off the same line as the wings
 *
 * Returned as a POSITIVE number of metres of additional depth, so the caller
 * subtracts it along its own attacking axis and the sign convention of the
 * frame it is working in never has to leak in here.
 */
export function echelonDepthBehindTen(num: number): number {
  switch (num) {
    case 10: return 0;
    case 12: return ECHELON_STEP_METRES;
    case 13: return ECHELON_STEP_METRES * 2;
    case 11: case 14: case 15:
      return ECHELON_STEP_METRES * 2 + WINGER_EXTRA_DEPTH_METRES;
    default: return 0;
  }
}

/** Is this shirt part of the echelon (i.e. does the override own his depth)? */
export function inEchelon(num: number): boolean {
  return (BACKLINE_SHIRTS as readonly number[]).includes(num);
}

/**
 * The echelon target depth for a shirt, given the flyhalf's own target depth.
 *
 * `tenTargetZ` is the 10's target z in world metres; `dir` is +1 when the
 * attacking side runs toward +z. Depth is always AWAY from the try line being
 * attacked, so the diagonal is drawn correctly for both teams without the
 * caller mirroring anything.
 */
export function echelonTargetZ(num: number, tenTargetZ: number, dir: 1 | -1): number {
  return tenTargetZ - dir * echelonDepthBehindTen(num);
}

/* ==================== ANTICIPATORY ACCELERATION ==================== */

/**
 * The fraction of a receiver's maximum sprint speed he must ALREADY be
 * carrying when he meets the pass. The brief is >60%; 0.68 clears it with
 * the margin that the steering ramp (which pulls a man back as he nears his
 * mark) eats on the way to the intersection point.
 */
export const RUN_ON_SPEED_FRACTION = 0.68;

/** How far up the chain the anticipation propagates from the receiver. */
export const ANTICIPATION_SHIRTS = [10, 12, 13] as const;

/**
 * Should this shirt start running the instant the ball leaves the passer?
 *
 * The trigger is the scrum-half's delivery to the flyhalf: the 10 (the
 * receiver), and the 12 and 13 outside him, must all be moving before it
 * arrives, or the whole line takes the ball standing still one pass later.
 */
export function anticipates(num: number, passerNum: number, receiverNum: number): boolean {
  if (passerNum !== 9 || receiverNum !== 10) return false;
  return (ANTICIPATION_SHIRTS as readonly number[]).includes(num);
}

export interface RunOnVector { vx: number; vz: number }

/**
 * The velocity to inject into an anticipating back at the moment of release.
 *
 * He is not running at the ball — he is running at the point where he will
 * MEET it, which for a man in an echelon is forward and slightly across. The
 * vector is his own maximum sprint speed scaled by RUN_ON_SPEED_FRACTION and
 * aimed from where he is at the intersection point, so he arrives on the
 * gain line at pace rather than reaching for it flat-footed.
 *
 * @param from        the runner's current position
 * @param intersect   where he will meet the ball (see `passIntersection`)
 * @param maxSprint   his maximum sprint speed, m/s
 * @param dir         +1 when the attack runs toward +z
 */
export function runOnVelocity(
  from: { x: number; z: number },
  intersect: { x: number; z: number },
  maxSprint: number,
  dir: 1 | -1,
): RunOnVector {
  const speed = maxSprint * RUN_ON_SPEED_FRACTION;
  let dx = intersect.x - from.x;
  let dz = intersect.z - from.z;
  /* A back never starts by running BACKWARDS onto a pass — if the solved
   * intersection is behind him (a long cut-out to a man already deeper) he
   * still leaves forwards and lets the steering curve him back. */
  if (dz * dir < 0) dz = 0;
  const d = Math.hypot(dx, dz);
  if (d < 0.2) { dx = 0; dz = dir; }
  const n = Math.max(0.2, Math.hypot(dx, dz));
  return { vx: (dx / n) * speed, vz: (dz / n) * speed };
}

/**
 * Where a runner will meet a pass: the point on his own run-line at the time
 * the ball gets there. Solved once, at release, in the same spirit as the
 * throw-forward aim — a fixed point both the ball and the man run at, so
 * neither is chasing the other.
 *
 * @param mark       the runner's current target mark (where he is headed)
 * @param ballAim    the pass's solved aim point
 * @param flightT    seconds of flight remaining
 * @param runnerSpeed the speed he will run onto it at, m/s
 */
export function passIntersection(
  mark: { x: number; z: number },
  ballAim: { x: number; z: number },
  flightT: number,
  runnerSpeed: number,
  dir: 1 | -1,
): { x: number; z: number } {
  /* He closes the gap toward the aim point over the flight, but he does not
   * overshoot it: the intersection is the nearer of "as far as he can run"
   * and "the aim point itself", advanced up the pitch by the ground he makes
   * while the ball is in the air. */
  const dx = ballAim.x - mark.x, dz = ballAim.z - mark.z;
  const d = Math.max(0.01, Math.hypot(dx, dz));
  const travel = Math.min(d, runnerSpeed * Math.max(0, flightT));
  return {
    x: mark.x + (dx / d) * travel,
    z: mark.z + (dz / d) * travel + dir * runnerSpeed * Math.max(0, flightT) * 0.25,
  };
}
