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

/* ==================== THE BACK THREE — PENDULUM COVERAGE ====================
 *
 * The second relationship nothing else in the game expresses.
 *
 * The back three (11, 15, 14) are not three men standing at three marks —
 * they are ONE covering body that splits the defended deep field into
 * thirds. When the opposition's 9 or 10 sets his feet and shapes for a
 * kick, the triangle ROTATES: each man owns the deep third his shirt is
 * assigned to, and the thirds slide laterally with the ball, so a kick
 * anywhere into the covered zone lands on a man who was already running
 * at it.
 *
 *   11  LEFT   third   the wing, whose channel is the left deep zone
 *   15  CENTRE third   the sweeper, always between the wings
 *   14  RIGHT  third   the other wing
 *
 * "Pendulum" is the word for the motion: the pivot is the ball's lateral
 * position, the arm is the three men, and the swing is continuous — a kick
 * into the vacated third is a try, a static triangle is a dead line.
 *
 * Everything here is pure geometry over (ball, axis, field edge). The
 * Director applies the marks (in the kick's SETTING stage, where the kick
 * phase owns the choreography); a probe can grade the rotation without a
 * match.
 */

/** The back three, from left to right. */
export const BACK_THREE = [11, 15, 14] as const;
export type BackThreeShirt = (typeof BACK_THREE)[number];

/** Which deep third each shirt owns. The wings take the edges, the sweeper
 *  holds the centre — a kick at the seam between two thirds is contested
 *  by both, which is exactly where a contestable dies. */
export type PendulumThird = 'LEFT' | 'CENTRE' | 'RIGHT';

export function pendulumSlot(num: number): PendulumThird {
  switch (num) {
    case 11: return 'LEFT';
    case 14: return 'RIGHT';
    case 15: return 'CENTRE';
    default: return 'CENTRE';
  }
}

export function isBackThree(num: number): boolean {
  return (BACK_THREE as readonly number[]).includes(num);
}

/** Width of one covered third, metres. Three thirds at 14 m span the whole
 *  central 42 m of the field; the wings' thirds ride closer to their own
 *  touchline, which is where a cross-field kick and the corner kick both
 *  land. */
export const PENDULUM_THIRD_WIDTH_M = 14;
/** The depth the triangle sits behind the kicking mark, when the field
 *  allows the full depth. A man 26 m behind the ball meets a 40 m punt in
 *  his stride; the chase meets it in the air. */
export const PENDULUM_DEPTH_M = 26;
/** The floor: even against the dead-ball line the triangle keeps a third
 *  of the way back, or it is just a second defensive line with extra steps. */
export const PENDULUM_DEPTH_MIN_M = 12;
/** Margin kept off the dead-ball line so a deep mark never steers into the
 *  fence. */
export const PENDULUM_EDGE_MARGIN_M = 4;
/** The half-width of the covered field a third may use (touch at 35, and a
 *  man marked at 34 is a man the steering clamps back into the field). */
export const PENDULUM_FIELD_HALF_M = 33;

export interface PendulumThirds {
  left: number;
  centre: number;
  right: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * The three covered thirds, centred on the ball. The CENTRE third always
 * contains the ball's own lateral position — a box kick up the middle is the
 * default kick, so the middle is the manliest ground — and the wings' thirds
 * grow out from it. When the ball is close to a touchline the outer third is
 * clamped back into the field rather than following the ball into the fence:
 * the corner is covered, the fence is not.
 */
export function pendulumThirds(ballX: number): PendulumThirds {
  const half = PENDULUM_THIRD_WIDTH_M / 2;
  const centre = clamp(ballX, -PENDULUM_FIELD_HALF_M + half, PENDULUM_FIELD_HALF_M - half);
  return {
    left: clamp(centre - PENDULUM_THIRD_WIDTH_M, -PENDULUM_FIELD_HALF_M, PENDULUM_FIELD_HALF_M),
    centre,
    right: clamp(centre + PENDULUM_THIRD_WIDTH_M, -PENDULUM_FIELD_HALF_M, PENDULUM_FIELD_HALF_M),
  };
}

/**
 * The depth a third may actually use from this ball: the full 26 m, or less
 * when the defending team's own dead-ball line stands in the way. `ownEdgeZ`
 * is that line in world metres. The deep field always lies BEHIND the ball
 * relative to the kicking axis, so the depth is the room between the ball
 * and the fence, minus a margin, floored so the triangle never collapses
 * into a second defensive line.
 */
export function pendulumDepthFor(ballZ: number, ownEdgeZ: number): number {
  const room = Math.abs(ballZ - ownEdgeZ) - PENDULUM_EDGE_MARGIN_M;
  return clamp(Math.min(PENDULUM_DEPTH_M, room), PENDULUM_DEPTH_MIN_M, PENDULUM_DEPTH_M);
}

/**
 * The full rotation mark for one shirt of the back three.
 *
 * The kick flies FORWARD along the kicking axis — a punt from the 10 at the
 * 22 lands 30-40 m in FRONT of the mark — so the deep thirds lie at
 * `ball + dir*depth`: in front of the ball, between the kicking mark and the
 * defending team's own try line. The marks sit at the depth a typical
 * territory punt travels, so the ball comes down on the triangle, not short
 * of it.
 *
 * @param num      11, 15 or 14
 * @param ball     the kicking mark (world metres)
 * @param dir      the kicking side's attacking axis
 * @param ownEdgeZ the defending team's dead-ball line, world metres
 *
 * The mark slides with `ball.x` every frame — that slide IS the pendulum.
 */
export function pendulumMark(
  num: number,
  ball: { x: number; z: number },
  dir: 1 | -1,
  ownEdgeZ: number,
): { x: number; z: number; third: PendulumThird } {
  const thirds = pendulumThirds(ball.x);
  const third = pendulumSlot(num);
  const key = third === 'LEFT' ? 'left' : third === 'RIGHT' ? 'right' : 'centre';
  const x = clamp(thirds[key], -PENDULUM_FIELD_HALF_M, PENDULUM_FIELD_HALF_M);
  const depth = pendulumDepthFor(ball.z, ownEdgeZ);
  return { x, z: ball.z + dir * depth, third };
}

/**
 * How well three given marks cover the thirds, 0..1. 1 when every third has
 * a man inside it; partial credit for a man on the seam between two thirds
 * (he contests both). A probe grades live football with it; a zero here is
 * the "kick into the vacuum" the whole system exists to prevent.
 */
export function pendulumCoverage(mark: { num: number; x: number }[], ballX: number): number {
  if (mark.length < 3) return 0;
  const thirds = pendulumThirds(ballX);
  const half = PENDULUM_THIRD_WIDTH_M / 2;
  let covered = 0;
  for (const side of ['left', 'centre', 'right'] as const) {
    const c = thirds[side];
    const inThird = mark.some((m) => Math.abs(m.x - c) <= half);
    if (inThird) covered += 1;
    else {
      /* on the seam: within a quarter-third of the centre counts half */
      const nearSeam = mark.some((m) => Math.abs(m.x - c) <= half * 0.5);
      covered += nearSeam ? 0.5 : 0;
    }
  }
  return clamp(covered / 3, 0, 1);
}
