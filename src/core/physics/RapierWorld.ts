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
 * The world deliberately owns nothing about rugby rules. It only knows three
 * kinds of things it can be asked to spawn:
 *   - Pitch   — a fixed cuboid surface players stand and slide on.
 *   - Player  — a dynamic capsule/cuboid proxy whose collision mask says
 *               "I am a player".
 *   - Ball    — a small dynamic sphere that collides with the pitch and the
 *               players (and nothing else, so the harness is cheap).
 *
 * Collision filtering is done with Rapier's 32-bit InteractionGroups:
 *   - the 16 high bits are the group memberships of this collider;
 *   - the 16 low bits are the mask of what it is willing to interact with.
 * Two colliders interact only if each one's memberships overlap the other's
 * mask. The classes below are named constants so callers never hand-write a
 * bit mask.
 */

import RAPIER from '@dimforge/rapier3d-compat';

/** Named collision groups. Each group is one bit so it can be OR-ed. */
export const PhysicsGroup = {
  PLAYER: 0b001,
  PITCH: 0b010,
  BALL: 0b100,
} as const;

export type PhysicsGroupId = (typeof PhysicsGroup)[keyof typeof PhysicsGroup];

/** Player collides with pitch, ball and other players. */
export const GROUP_PLAYER = groups(PhysicsGroup.PLAYER, PhysicsGroup.PITCH | PhysicsGroup.BALL | PhysicsGroup.PLAYER);
/** Pitch is the floor. It collides with players and the ball only. */
export const GROUP_PITCH = groups(PhysicsGroup.PITCH, PhysicsGroup.PLAYER | PhysicsGroup.BALL);
/** Ball collides with the pitch and the players. */
export const GROUP_BALL = groups(PhysicsGroup.BALL, PhysicsGroup.PITCH | PhysicsGroup.PLAYER);

/**
 * Build a Rapier InteractionGroups value from a membership bit mask and a
 * filter bit mask. `members` occupies the high 16 bits, `mask` the low 16.
 */
export function groups(members: number, mask: number): number {
  return ((members & 0xffff) << 16) | (mask & 0xffff);
}

/**
 * Standard gravity. Rapier's y-axis is up, so gravity points down.
 */
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

/**
 * A thin, headless wrapper around one Rapier world.
 *
 * ```ts
 * const world = await RapierWorld.create();
 * world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });
 * world.step(1 / 60);
 * ```
 */
export class RapierWorld {
  readonly world: RAPIER.World;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  /** Initialise Rapier and build an empty world. */
  static async create(): Promise<RapierWorld> {
    await initRapier();
    const world = new RAPIER.World(GRAVITY);
    return new RapierWorld(world);
  }

  /** Increment the simulation by one fixed step. */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  /** Add the static flat pitch surface. */
  addPitch(spec: PitchSpec): RAPIER.Collider {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(spec.x, spec.y, spec.z));
    return this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, spec.hz)
        .setFriction(spec.friction ?? 0.9)
        .setCollisionGroups(GROUP_PITCH),
      body,
    );
  }

  /** Add a dynamic player proxy. Returns the body for external velocity control. */
  addPlayer(spec: PlayerSpec): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spec.x, spec.y, spec.z)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(spec.hx, spec.hy, spec.hz)
        .setFriction(spec.friction ?? 0.6)
        .setRestitution(spec.restitution ?? 0.1)
        .setCollisionGroups(GROUP_PLAYER),
      body,
    );
    return body;
  }

  /** Add a dynamic ball. */
  addBall(spec: BallSpec): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spec.x, spec.y, spec.z)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(spec.radius)
        .setFriction(spec.friction ?? 0.4)
        .setRestitution(spec.restitution ?? 0.65)
        .setCollisionGroups(GROUP_BALL),
      body,
    );
    return body;
  }

  /** Free the WASM memory backing this world. */
  dispose(): void {
    this.world.free();
  }
}
