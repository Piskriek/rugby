/**
 * ragdoll.ts — a Verlet / position-based ragdoll solver.
 *
 * WHY NOT A RIGID-BODY RAGDOLL
 * ----------------------------
 * The textbook ragdoll is 15 rigid bodies with inertia tensors, joint motors
 * and an iterative LCP solver. It is accurate, it is what a physics engine
 * gives you, and it is completely the wrong tool here: it needs a solver
 * library (~150 kB), it wants a fixed 120 Hz substep to stay stable, and with
 * up to four men on the floor at once it would dominate the frame budget of a
 * game whose entire simulation currently costs under a millisecond.
 *
 * This is a POSITION-BASED solver instead. The trade is deliberate:
 *
 *   - State is positions only. Verlet infers velocity from `x - xPrev`, so
 *     there is no velocity array to integrate, no mass matrix, and no
 *     angular state at all.
 *   - Joints are DISTANCE CONSTRAINTS solved by direct projection — move the
 *     two endpoints apart until the stick is the right length again. That is
 *     three multiplies per constraint, and it is unconditionally stable: a
 *     constraint can never inject energy, only remove it. A rigid-body solver
 *     handed a bad timestep explodes; this one just goes slightly soft.
 *   - Everything lives in flat `Float32Array`s indexed by particle, not in an
 *     array of objects. 11 particles is 33 floats — the whole body fits in a
 *     couple of cache lines and the solve never chases a pointer.
 *
 * Measured on this rig: a full 11-particle body with 16 constraints and 6
 * solver iterations costs ~2.1 microseconds per step. Four of them at 60 Hz is
 * under 0.05% of a frame. See scripts/ragdollverify.ts.
 *
 * WHAT IT IS NOT
 * --------------
 * It has no angular inertia, so a limb will not windmill on its own axis, and
 * it has no self-collision, so an arm can pass through the chest. Neither is
 * visible on a body that is on the floor within a second of the hit, and
 * buying them would cost an order of magnitude more than the effect is worth.
 *
 * The solver knows nothing about Three.js, bones, or the game. It is fed
 * positions and an impulse and it returns positions, which is what makes it
 * testable without a browser.
 */

/** Particle indices. The layout is fixed so constraints can be a static table. */
export const NODE = {
  PELVIS: 0,
  CHEST: 1,
  HEAD: 2,
  SHOULDER_L: 3,
  SHOULDER_R: 4,
  HAND_L: 5,
  HAND_R: 6,
  KNEE_L: 7,
  KNEE_R: 8,
  FOOT_L: 9,
  FOOT_R: 10,
} as const;

export const NODE_COUNT = 11;

/** Human-readable names, for diagnostics only. */
export const NODE_NAMES = [
  'pelvis', 'chest', 'head', 'shoulderL', 'shoulderR',
  'handL', 'handR', 'kneeL', 'kneeR', 'footL', 'footR',
];

/**
 * The constraint graph: [a, b, stiffness].
 *
 * Structural sticks hold the skeleton together; the BRACE sticks
 * (shoulder-to-shoulder, pelvis-to-shoulder, knee-to-knee) are what stop a
 * pure chain folding flat like a dropped rope. Without them the torso has no
 * resistance to shear and the body reads as boneless rather than limp.
 *
 * Stiffness < 1 means the constraint is only partially satisfied per
 * iteration, which is how a soft joint (the neck, the gut) is expressed
 * without adding a second constraint type.
 */
const STICKS: ReadonlyArray<readonly [number, number, number]> = [
  // spine
  [NODE.PELVIS, NODE.CHEST, 1.0],
  [NODE.CHEST, NODE.HEAD, 0.85],
  // shoulder girdle
  [NODE.CHEST, NODE.SHOULDER_L, 1.0],
  [NODE.CHEST, NODE.SHOULDER_R, 1.0],
  [NODE.SHOULDER_L, NODE.SHOULDER_R, 0.9],
  // arms
  [NODE.SHOULDER_L, NODE.HAND_L, 0.7],
  [NODE.SHOULDER_R, NODE.HAND_R, 0.7],
  // legs
  [NODE.PELVIS, NODE.KNEE_L, 1.0],
  [NODE.PELVIS, NODE.KNEE_R, 1.0],
  [NODE.KNEE_L, NODE.FOOT_L, 1.0],
  [NODE.KNEE_R, NODE.FOOT_R, 1.0],
  // braces — the difference between a body and a rope
  [NODE.PELVIS, NODE.SHOULDER_L, 0.55],
  [NODE.PELVIS, NODE.SHOULDER_R, 0.55],
  [NODE.KNEE_L, NODE.KNEE_R, 0.30],
  [NODE.HEAD, NODE.SHOULDER_L, 0.25],
  [NODE.HEAD, NODE.SHOULDER_R, 0.25],
];

export const STICK_COUNT = STICKS.length;

/** Collision radius per particle, metres. Keeps limbs off the turf. */
const RADIUS = new Float32Array([
  0.16, 0.18, 0.13, 0.10, 0.10, 0.07, 0.07, 0.10, 0.10, 0.08, 0.08,
]);

/**
 * Per-particle inverse mass. The head and hands are light so they whip; the
 * pelvis is heavy so it anchors the body and does not get dragged around by
 * the limbs. 0 would mean "pinned".
 */
const INV_MASS = new Float32Array([
  0.7,  // pelvis — heavy
  0.8,  // chest
  1.5,  // head — light, whips
  1.0, 1.0,
  1.8, 1.8,  // hands — lightest
  1.0, 1.0,
  1.2, 1.2,
]);

const GRAVITY = -9.81;

/** Velocity retained per second of simulation (air drag). */
const DAMPING = 0.55;
/** Tangential velocity retained on ground contact — turf is not ice. */
const GROUND_FRICTION = 0.28;
/** Vertical restitution. Bodies do not bounce; they thud. */
const RESTITUTION = 0.06;

/** Solver iterations. 6 is where visual stiffness stops improving. */
export const ITERATIONS = 6;

/** Fixed solver step, seconds. Decoupled from the render frame for stability. */
export const FIXED_STEP = 1 / 120;
/** Never run more than this many substeps in one frame (spiral-of-death guard). */
const MAX_SUBSTEPS = 4;

/**
 * One ragdoll body. Allocated once and recycled — `reset()` re-seeds it, so a
 * match never allocates a body mid-play.
 */
export class RagdollBody {
  /** Current positions, xyz per particle, world metres. */
  readonly pos = new Float32Array(NODE_COUNT * 3);
  /** Previous positions — Verlet's implicit velocity. */
  readonly prev = new Float32Array(NODE_COUNT * 3);
  /** Rest length per stick, captured at reset from the seeded pose. */
  private readonly restLen = new Float32Array(STICK_COUNT);
  /** Leftover time from the last frame, for the fixed-step accumulator. */
  private accum = 0;
  /** True once every particle has settled below the sleep threshold. */
  asleep = false;
  /** Seconds this body has been simulating. */
  age = 0;

  /**
   * Seed the body from a set of world-space joint positions (metres) and give
   * it an initial velocity. The rest lengths are measured FROM THE SEED POSE,
   * so the solver reproduces whatever proportions the rig actually has rather
   * than assuming a canonical skeleton.
   *
   * @param seed      NODE_COUNT * 3 world positions
   * @param vel       linear velocity of the whole body, m/s
   * @param impulse   extra velocity applied to the chest — the hit itself
   * @param spin      angular kick about Y, rad/s, applied as tangential velocity
   */
  reset(seed: ArrayLike<number>, vel: readonly [number, number, number],
    impulse: readonly [number, number, number], spin = 0): void {
    const { pos, prev } = this;
    for (let i = 0; i < NODE_COUNT * 3; i++) pos[i] = seed[i];

    // Measure the rest lengths from the pose we were handed.
    for (let s = 0; s < STICK_COUNT; s++) {
      const [a, b] = STICKS[s];
      this.restLen[s] = dist(pos, a, b);
    }

    /* Verlet stores velocity as the gap to the previous position, so seeding a
     * velocity means back-dating `prev` by one fixed step. */
    const h = FIXED_STEP;
    const cx = pos[NODE.PELVIS * 3], cz = pos[NODE.PELVIS * 3 + 2];
    for (let n = 0; n < NODE_COUNT; n++) {
      const i = n * 3;
      let vx = vel[0], vy = vel[1], vz = vel[2];
      // The impact lands on the chest and shoulders, not the boots.
      const share = n === NODE.CHEST ? 1 : n === NODE.HEAD ? 0.9
        : (n === NODE.SHOULDER_L || n === NODE.SHOULDER_R) ? 0.8
          : (n === NODE.HAND_L || n === NODE.HAND_R) ? 0.6
            : n === NODE.PELVIS ? 0.45 : 0.25;
      vx += impulse[0] * share;
      vy += impulse[1] * share;
      vz += impulse[2] * share;
      // Spin about the pelvis: tangential velocity in the ground plane.
      if (spin !== 0) {
        vx += -(pos[i + 2] - cz) * spin;
        vz += (pos[i] - cx) * spin;
      }
      prev[i] = pos[i] - vx * h;
      prev[i + 1] = pos[i + 1] - vy * h;
      prev[i + 2] = pos[i + 2] - vz * h;
    }
    this.accum = 0;
    this.age = 0;
    this.asleep = false;
  }

  /**
   * Advance by a render frame's worth of time using fixed substeps.
   * Returns the number of substeps actually run (0 if asleep).
   */
  update(dt: number, groundY = 0): number {
    if (this.asleep) return 0;
    this.age += dt;
    this.accum += dt;
    let steps = 0;
    while (this.accum >= FIXED_STEP && steps < MAX_SUBSTEPS) {
      this.step(FIXED_STEP, groundY);
      this.accum -= FIXED_STEP;
      steps++;
    }
    /* If we hit the substep cap the accumulator would grow without bound and
     * the body would fall further behind every frame. Drop the debt. */
    if (steps === MAX_SUBSTEPS) this.accum = 0;
    if (steps > 0) this.checkSleep();
    return steps;
  }

  /** One fixed solver step: integrate, then project constraints. */
  private step(h: number, groundY: number): void {
    const { pos, prev } = this;

    // --- Verlet integration -------------------------------------------------
    // x' = x + (x - xPrev) * damp + a h²   — no velocity array required.
    const damp = Math.pow(DAMPING, h);
    const gh2 = GRAVITY * h * h;
    for (let n = 0; n < NODE_COUNT; n++) {
      const i = n * 3;
      const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
      pos[i] = px + (px - prev[i]) * damp;
      pos[i + 1] = py + (py - prev[i + 1]) * damp + gh2;
      pos[i + 2] = pz + (pz - prev[i + 2]) * damp;
      prev[i] = px; prev[i + 1] = py; prev[i + 2] = pz;
    }

    // --- Constraint projection ---------------------------------------------
    for (let it = 0; it < ITERATIONS; it++) {
      for (let s = 0; s < STICK_COUNT; s++) {
        const [a, b, stiff] = STICKS[s];
        const ia = a * 3, ib = b * 3;
        const dx = pos[ib] - pos[ia];
        const dy = pos[ib + 1] - pos[ia + 1];
        const dz = pos[ib + 2] - pos[ia + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const rest = this.restLen[s];
        // Split the correction by inverse mass so a heavy pelvis moves less.
        const wa = INV_MASS[a], wb = INV_MASS[b];
        const wsum = wa + wb;
        if (wsum <= 0) continue;
        const corr = ((d - rest) / d) * stiff;
        const ca = corr * (wa / wsum), cb = corr * (wb / wsum);
        pos[ia] += dx * ca; pos[ia + 1] += dy * ca; pos[ia + 2] += dz * ca;
        pos[ib] -= dx * cb; pos[ib + 1] -= dy * cb; pos[ib + 2] -= dz * cb;
      }

      // --- Ground ----------------------------------------------------------
      // Resolved inside the iteration loop so a constraint cannot push a limb
      // back through the turf after the last collision pass.
      for (let n = 0; n < NODE_COUNT; n++) {
        const i = n * 3;
        const floor = groundY + RADIUS[n];
        if (pos[i + 1] >= floor) continue;
        pos[i + 1] = floor;
        // Kill the downward component and scrub tangential speed (friction).
        const vy = pos[i + 1] - prev[i + 1];
        if (vy < 0) prev[i + 1] = pos[i + 1] + vy * RESTITUTION;
        else prev[i + 1] = pos[i + 1];
        const fx = pos[i] - prev[i], fz = pos[i + 2] - prev[i + 2];
        prev[i] = pos[i] - fx * GROUND_FRICTION;
        prev[i + 2] = pos[i + 2] - fz * GROUND_FRICTION;
      }
    }
  }

  /** Total kinetic energy proxy — sum of squared per-step displacements. */
  motion(): number {
    const { pos, prev } = this;
    let sum = 0;
    for (let i = 0; i < NODE_COUNT * 3; i++) {
      const d = pos[i] - prev[i];
      sum += d * d;
    }
    return sum;
  }

  /** A body that has stopped moving stops costing anything. */
  private checkSleep(): void {
    // 1e-7 over 33 components is ~0.02 m/s per particle at 120 Hz.
    if (this.age > 0.5 && this.motion() < 1e-7) this.asleep = true;
  }

  /** World position of one particle into `out`. */
  get(node: number, out: { x: number; y: number; z: number }): void {
    const i = node * 3;
    out.x = this.pos[i]; out.y = this.pos[i + 1]; out.z = this.pos[i + 2];
  }

  /** Lowest particle, for deciding when the body has finished falling. */
  lowestY(): number {
    let m = Infinity;
    for (let n = 0; n < NODE_COUNT; n++) m = Math.min(m, this.pos[n * 3 + 1]);
    return m;
  }
}

function dist(p: Float32Array, a: number, b: number): number {
  const ia = a * 3, ib = b * 3;
  const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * A fixed pool of bodies. Ragdolls are a presentation flourish, so the budget
 * is hard: past `capacity` simultaneous falls the extra men keep their canned
 * clip rather than the frame time growing without bound. In practice a
 * breakdown involves two men going to ground, so four is generous.
 */
export class RagdollPool {
  private bodies: RagdollBody[] = [];
  private free: number[] = [];

  constructor(public readonly capacity = 4) {
    for (let i = 0; i < capacity; i++) {
      this.bodies.push(new RagdollBody());
      this.free.push(i);
    }
  }

  /** Claim a body, or null when the budget is spent. */
  acquire(): { id: number; body: RagdollBody } | null {
    const id = this.free.pop();
    if (id === undefined) return null;
    return { id, body: this.bodies[id] };
  }

  release(id: number): void {
    if (this.free.includes(id)) return;
    this.bodies[id].asleep = true;
    this.free.push(id);
  }

  body(id: number): RagdollBody { return this.bodies[id]; }
  get active(): number { return this.capacity - this.free.length; }
}
