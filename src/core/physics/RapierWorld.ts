/**
 * RapierWorld — the physics core.
 *
 * The matched-game layer (director, renderer, AI) stays engine-owned; this
 * module is the place where a real physical body can be simulated headlessly
 * without pulling in Three.js or the DOM. It initialises Rapier once for the
 * whole process (RAPIER is a WASM-backed singleton — calling init() more than
 * once is unnecessary), configures the world to a standard gravity vector, and
 * exposes a single `step(dt)` entry point that a runner (harness/gym/tackle-gym)
 * or a future game loop calls with a fixed timestep.
 *
 * TABS PARADIGM
 * -------------
 * This world implements the "Totally Accurate Battle Simulator" approach the
 * engine is adopting for tackles:
 *
 *  1. Solver fidelity is raised so a 6 m/s multi-body pile resolves rather
 *     than clips: `numSolverIterations` and `numInternalPgsIterations` are
 *     increased, and CCD substeps are enabled on the fast bodies.
 *  2. A player is NOT one rigid cuboid. `addTabsPlayer` builds a small ragdoll:
 *     Hips and Chest carry the bulk of the mass (>= 80%), while Arms, Thighs
 *     and Calves are nearly weightless (1.5–2 kg). Light limbs have little
 *     inertial pull on their joint anchors, so a tackle cannot rip the body
 *     apart at the joints.
 *  3. Every limb of a player is culled against every other part of the SAME
 *     player via per-player InteractionGroups. The physics engine never even
 *     builds a contact manifold for intra-player limbs, so the only contacts
 *     left to resolve are player-vs-player, player-vs-ball and body-vs-pitch.
 */
import RAPIER from '@dimforge/rapier3d-compat';

/** Named collision groups. Each group is one bit so it can be OR-ed. The
 *  values are the bit positions used by the TABS per-player filter:
 *  PITCH=1, BALL=2, and PLAYER groups start at 4. */
export const PhysicsGroup = {
  PLAYER: 0b100,
  PITCH: 0b001,
  BALL: 0b010,
} as const;

export type PhysicsGroupId = (typeof PhysicsGroup)[keyof typeof PhysicsGroup];

/** Player collides with pitch, ball and other players. */
export const GROUP_PLAYER = groups(PhysicsGroup.PLAYER, PhysicsGroup.PITCH | PhysicsGroup.BALL | PhysicsGroup.PLAYER);
/** Pitch is the floor. It collides with players and the ball only. */
export const GROUP_PITCH = groups(PhysicsGroup.PITCH, PhysicsGroup.PLAYER | PhysicsGroup.BALL);
/** Ball collides with the pitch and the players. */
export const GROUP_BALL = groups(PhysicsGroup.BALL, PhysicsGroup.PITCH | PhysicsGroup.PLAYER);

/* ---- TABS intra-player culling ---------------------------------------- */
/* A 16-bit membership per collider, where each player owns one distinct bit.
 * A limb's mask is `PITCH | BALL | every OTHER player's bit` but NEVER its own
 * player bit, so two colliders of the same player can never satisfy Rapier's
 * two-sided interaction test and are culled before the narrow phase. */

const BIT_PITCH = PhysicsGroup.PITCH;
const BIT_BALL = PhysicsGroup.BALL;
const BIT_PLAYER_BASE = PhysicsGroup.PLAYER;
const MAX_PLAYER_BITS = 13; // 0x0004 << 12 = 0x4000 (63? no) — 13 players in a world

/**
 * Build a Rapier InteractionGroups value from a membership bit mask and a
 * filter bit mask. `members` occupies the high 16 bits, `mask` the low 16.
 */
export function groups(members: number, mask: number): number {
  return ((members & 0xffff) << 16) | (mask & 0xffff);
}

/** Standard gravity. Rapier's y-axis is up, so gravity points down. */
export const GRAVITY: Readonly<{ x: number; y: number; z: number }> = {
  x: 0,
  y: -9.81,
  z: 0,
};

/** Rapier's WASM needs to be loaded once per process, before any API call. */
let initPromise: Promise<void> | null = null;

/** Await the one-time Rapier init. Safe to call from several runners. */
export function initRapier(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

export interface PitchSpec {
  /** half extents of the pitch cuboid in metres */
  hx: number;
  hy: number;
  hz: number;
  /** centre of the pitch, in metres */
  x: number;
  y: number;
  z: number;
  friction?: number;
}

export interface PlayerSpec {
  /** half extents of the player proxy */
  hx: number;
  hy: number;
  hz: number;
  x: number;
  y: number;
  z: number;
  friction?: number;
  restitution?: number;
}

export interface BallSpec {
  radius: number;
  x: number;
  y: number;
  z: number;
  friction?: number;
  restitution?: number;
}

/** Per-part masses for the TABS ragdoll (kg). Heavy trunk, near-weightless limbs. */
export const TABS_MASS = {
  hips: 32,
  chest: 32,
  arm: 1.5,
  thigh: 2,
  calf: 1.5,
} as const;

/** Total player mass and the trunk share, for reporting. */
export const TABS_TOTAL_MASS =
  TABS_MASS.hips + TABS_MASS.chest
  + TABS_MASS.arm * 2 + TABS_MASS.thigh * 2 + TABS_MASS.calf * 2;
export const TABS_TRUNK_SHARE =
  (TABS_MASS.hips + TABS_MASS.chest) / TABS_TOTAL_MASS;

export interface TabsPlayerSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vz?: number;
  friction?: number;
  restitution?: number;
}

export interface TabsPlayer {
  /** Hips — one of the two heavy trunk bodies. */
  hips: RAPIER.RigidBody;
  /** Chest — the other heavy trunk body. */
  chest: RAPIER.RigidBody;
  /** Every rigid body of the ragdoll (including Hips/Chest/limbs). */
  bodies: RAPIER.RigidBody[];
  /** Every collider of the ragdoll. */
  colliders: RAPIER.Collider[];
}

function massToDensity(mass: number, hx: number, hy: number, hz: number): number {
  const volume = 8 * hx * hy * hz;
  return volume > 1e-9 ? mass / volume : 1;
}

/**
 * A thin, headless wrapper around one Rapier world.
 *
 * ```ts
 * const world = await RapierWorld.create();
 * world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });
 * const p = world.addTabsPlayer({ x: 0, y: 0, z: -4, vz: 6 });
 * world.step(1 / 60);
 * ```
 */
export class RapierWorld {
  readonly world: RAPIER.World;

  /** Registered player colliders, so InteractionGroups can be refreshed after
   *  a new player joins (each new player needs every old player's mask to
   *  include its bit, and vice-versa). */
  private readonly playerColliders: { collider: RAPIER.Collider; bit: number }[] = [];
  private nextPlayerBit = 0;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  /** Initialise Rapier and build an empty world with the TABS solver profile. */
  static async create(): Promise<RapierWorld> {
    await initRapier();
    const world = new RAPIER.World(GRAVITY);
    const wrapped = new RapierWorld(world);

    /* TABS solver fidelity. The default 4/1 resolver lets a 6 m/s multi-body
     * pile sit inside itself for a frame or more before it is pushed back out;
     * 8 outer + 2 internal PGS iterations resolve the contact faster and CCD
     * substeps stop the fast bodies making a single large step through a
     * neighbour. The penetration tolerance and prediction distance are also
     * tightened so a ragdoll resting on / tumbling over the pitch cannot hide
     * 5 cm of overlap (measured: even 8/2 iterations give a 12 cm first-impact
     * chest overlap at 12 m/s unless predictive contacts start further out;
     * predictionDistance 0.1 leaves the worst contact at ~2 cm). */
    world.integrationParameters.numSolverIterations = 8;
    world.integrationParameters.numInternalPgsIterations = 2;
    world.integrationParameters.normalizedAllowedLinearError = 0.0001;
    world.integrationParameters.normalizedPredictionDistance = 0.1;
    world.integrationParameters.maxCcdSubsteps = 8;
    return wrapped;
  }

  /** Increment the simulation by one fixed step. */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** Add the static flat pitch surface. */
  addPitch(spec: PitchSpec): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(spec.x, spec.y, spec.z));
    /* Mask 0xFFFF = "accept any collider whose membership includes a bit we
     * care about". The filter is really owned by the player limbs (they pick
     * whether to include BIT_PITCH/BIT_BALL in their mask). */
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, spec.hz)
        .setFriction(spec.friction ?? 0.9)
        .setCollisionGroups(groups(BIT_PITCH, 0xffff)),
      body,
    );
  }

  /** Add a single-cuboid dynamic player proxy. Kept for simple probes; the
   *  tackle/breakdown gym uses `addTabsPlayer`. */
  addPlayer(spec: PlayerSpec): RAPIER.RigidBody {
    const bit = this.allocPlayerBit();
    const body = this.rigidBody(spec.x, spec.y, spec.z);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, spec.hz)
        .setFriction(spec.friction ?? 0.6)
        .setRestitution(spec.restitution ?? 0.1),
      body,
    );
    this.registerPlayerCollider(collider, bit);
    return body;
  }

  /**
   * Add a TABS player: a Hips/Chest-heavy ragdoll with near-weightless limbs,
   * held together by spherical joints and culled against itself.
   */
  addTabsPlayer(spec: TabsPlayerSpec): TabsPlayer {
    const bit = this.allocPlayerBit();
    const vx = spec.vx ?? 0;
    const vz = spec.vz ?? 0;

    const make = (
      x: number, y: number, z: number,
      hx: number, hy: number, hz: number,
      mass: number,
    ): RAPIER.RigidBody => {
      const body = this.rigidBody(x, y, z, vx, vz);
      const density = massToDensity(mass, hx, hy, hz);
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setDensity(density)
          .setFriction(spec.friction ?? 0.55)
          .setRestitution(spec.restitution ?? 0.05),
        body,
      );
      this.registerPlayerCollider(collider, bit);
      return body;
    };

    const x = spec.x;
    const z = spec.z;

    /* Ragdoll layout. All trunk/limb centres sit above the turf (no collider
     * starts inside the pitch). Anchors are chosen so the joint anchors of two
     * neighbouring parts meet at the same world point. */
    /* Trunk (hips + chest) carries the load; the near-weightless limbs stay
     * physically present against the pitch so a tackled player lies on the
     * turf instead of floating over it. */
    const hips = make(x, 1.15, z, 0.18, 0.14, 0.14, TABS_MASS.hips);
    const chest = make(x, 1.53, z, 0.22, 0.24, 0.15, TABS_MASS.chest);
    const armL = make(x - 0.32, 1.55, z, 0.07, 0.22, 0.07, TABS_MASS.arm);
    const armR = make(x + 0.32, 1.55, z, 0.07, 0.22, 0.07, TABS_MASS.arm);
    const thighL = make(x - 0.11, 0.76, z, 0.10, 0.25, 0.10, TABS_MASS.thigh);
    const thighR = make(x + 0.11, 0.76, z, 0.10, 0.25, 0.10, TABS_MASS.thigh);
    const calfL = make(x - 0.11, 0.29, z, 0.09, 0.22, 0.09, TABS_MASS.calf);
    const calfR = make(x + 0.11, 0.29, z, 0.09, 0.22, 0.09, TABS_MASS.calf);

    /* Joints (spherical) hold the ragdoll together while its limbs NEVER
     * collide with itself. `setContactsEnabled(false)` is a belt-and-braces
     * guarantee on top of the InteractionGroups cull. */
    const connect = (a: RAPIER.RigidBody, b: RAPIER.RigidBody, aLocal: { x: number; y: number; z: number }, bLocal: { x: number; y: number; z: number }) => {
      const joint = this.world.createImpulseJoint(
        RAPIER.JointData.spherical(
          { x: aLocal.x, y: aLocal.y, z: aLocal.z },
          { x: bLocal.x, y: bLocal.y, z: bLocal.z },
        ),
        a, b, true,
      );
      joint.setContactsEnabled(false);
    };

    connect(chest, hips, { x: 0, y: -0.24, z: 0 }, { x: 0, y: 0.14, z: 0 });
    connect(armL, chest, { x: 0, y: 0.22, z: 0 }, { x: -0.32, y: 0.24, z: 0 });
    connect(armR, chest, { x: 0, y: 0.22, z: 0 }, { x: 0.32, y: 0.24, z: 0 });
    connect(thighL, hips, { x: 0, y: 0.25, z: 0 }, { x: -0.11, y: -0.14, z: 0 });
    connect(thighR, hips, { x: 0, y: 0.25, z: 0 }, { x: 0.11, y: -0.14, z: 0 });
    connect(calfL, thighL, { x: 0, y: 0.22, z: 0 }, { x: 0, y: -0.25, z: 0 });
    connect(calfR, thighR, { x: 0, y: 0.22, z: 0 }, { x: 0, y: -0.25, z: 0 });

    return {
      hips,
      chest,
      bodies: [hips, chest, armL, armR, thighL, thighR, calfL, calfR],
      colliders: [...this.playerColliders.filter((p) => p.bit === bit).map((p) => p.collider)],
    };
  }

  /** Add a dynamic ball. The default unit-density collider is only ~14 g at
   *  r=0.15 m; a real rugby ball is ~0.43 kg. Without that mass a TABS chest
   *  (32 kg) can push the tiny ball a quarter-radius into its own hull on the
   *  first solver pass, so give it a realistic density (≈30 kg/m³). */
  addBall(spec: BallSpec): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spec.x, spec.y, spec.z)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(spec.radius)
        .setDensity(30)
        .setFriction(spec.friction ?? 0.4)
        .setRestitution(spec.restitution ?? 0.65)
        .setCollisionGroups(groups(BIT_BALL, 0xffff)),
      body,
    );
    return body;
  }

  /** Free the WASM memory backing this world. */
  dispose(): void {
    this.world.free();
  }

  /* ------------------------ internals ------------------------ */

  private allocPlayerBit(): number {
    if (this.nextPlayerBit >= MAX_PLAYER_BITS) {
      throw new Error(`RapierWorld supports at most ${MAX_PLAYER_BITS} players per world`);
    }
    return BIT_PLAYER_BASE << this.nextPlayerBit++;
  }

  private rigidBody(x: number, y: number, z: number, vx = 0, vz = 0): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setCcdEnabled(true),
    );
    if (vx !== 0 || vz !== 0) body.setLinvel({ x: vx, y: 0, z: vz }, true);
    return body;
  }

  private registerPlayerCollider(collider: RAPIER.Collider, bit: number): void {
    this.playerColliders.push({ collider, bit });
    this.refreshPlayerGroups();
  }

  /**
   * Recompute every player collider's InteractionGroups. Colliders of player i
   * carry membership bit i and a mask of PITCH | BALL | every OTHER player's
   * bit — never its own bit. This is what culls all intra-player limb contact
   * while keeping player-vs-player, player-vs-ball and body-vs-ground live.
   */
  private refreshPlayerGroups(): void {
    const allPlayerBits = this.playerColliders.reduce((acc, p) => acc | p.bit, 0);
    for (const { collider, bit } of this.playerColliders) {
      const mask = BIT_PITCH | BIT_BALL | (allPlayerBits & ~bit);
      collider.setCollisionGroups(groups(bit, mask));
    }
  }
}
