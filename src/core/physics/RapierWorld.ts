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

/* ---- TARCS impact reporting ------------------------------------------- */
/*
 * THE AUDIO TAP. The physics core is the only place that knows what a hit
 * actually WAS — the renderer sees a pose and the director sees a state
 * machine, but the closing speed and the contact impulse exist for exactly one
 * frame, inside the solver. Rather than let the presentation layer re-derive a
 * number the solver already computed (and disagree with it), the world reports
 * player-vs-player contacts to whoever asks.
 *
 * This stays a LISTENER API on purpose. `RapierWorld` is imported by the
 * headless gym under Node, where there is no AudioContext and no DOM; it must
 * never reach for one. The whole event path is also inert until somebody
 * subscribes — no EventQueue is allocated and no collider has ActiveEvents set,
 * so the gym's numbers are bit-identical to what they were before this existed.
 */

/** Minimum relative speed, in m/s, for a player-vs-player contact to be
 *  reported. Below this two men are leaning on each other, not colliding. */
export const IMPACT_MIN_RELATIVE_SPEED = 3.0;

/** Contact-force magnitude (N) above which Rapier raises a force event. Set
 *  low enough that a 3 m/s brush still measures, high enough that a ragdoll
 *  resting on the turf does not. */
export const IMPACT_FORCE_EVENT_THRESHOLD = 120;

/** One pair of players may only report an impact this often (seconds). A pile
 *  of eight limb colliders generates dozens of manifolds per step; without
 *  this the tap machine-guns. */
export const IMPACT_PAIR_COOLDOWN = 0.12;

/** A player-vs-player contact worth reacting to. */
export interface PlayerImpact {
  /** Index of the two players involved, in registration order. */
  playerA: number;
  playerB: number;
  /** Contact point in world metres (midpoint of the two colliders). */
  x: number;
  y: number;
  z: number;
  /** |v_a − v_b| in the frame BEFORE the solver resolved the contact, m/s. */
  relativeSpeed: number;
  /** The component of that relative velocity along the contact normal, m/s.
   *  Equals `relativeSpeed` when no force event supplied a normal. */
  closingSpeed: number;
  /** Contact impulse magnitude in N·s. */
  impulse: number;
  /** True when `impulse` came from a Rapier contact-force event; false when it
   *  is the reduced-mass estimate `m_eff · Δv`. */
  measured: boolean;
}

export type PlayerImpactListener = (impact: PlayerImpact) => void;

/** Rapier's WASM needs to be loaded once per process, before any API call. */
let initPromise: Promise<void> | null = null;

/** Await the one-time Rapier init. Safe to call from several runners. */
export function initRapier(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise!;
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
  /** This player's membership bit (see `allocPlayerBit`). Needed to cull the
   *  carried ball against this ragdoll and to tell friend from foe when a
   *  tackle should rip the ball free. */
  bit: number;
}

function massToDensity(mass: number, hx: number, hy: number, hz: number): number {
  const volume = 8 * hx * hy * hz;
  return volume > 1e-9 ? mass / volume : 1;
}

/* ---- TARCS ball-carrier constraint ------------------------------------ */
/* A carried ball is not a loose ball. While a carrier holds it (the engine
 * controller's BALL_SECURED — see src/game/engine/ballcraft.ts), the physical
 * ball is welded to the carrier's Chest with a FixedImpulseJoint so it rides
 * the trunk instead of being knocked out of his hands by his own sprint. It
 * stays welded until an OPPONENT tackle lands a blow big enough that the
 * contact impulse (force * dt) clears the carrier's `breakImpulse`; then the
 * joint breaks and the ball is spilled — the physics twin of dropping it
 * (DROP_BALL in ballcraft). The two state names below are shared verbatim with
 * ballcraft's CraftState so a caller driving both sides of the sim has one
 * vocabulary, without the headless physics core importing the engine. */

/** Possession state of a physically welded ball. Mirrors ballcraft's CraftState
 *  so the harness and the engine controller agree on what "held" means. */
export type BallCarrierState = 'BALL_SECURED' | 'DROP_BALL';

export interface AttachBallOptions {
  /** Break the weld the first time an opponent contact delivers an impulse
   *  `force * dt` at or above this many N·s. A rugby hit can shove ~600 N over
   *  a ~1/60 s step (≈10 N·s); a gentle shove is an order of magnitude less. */
  breakImpulse: number;
  /** Decide whether a collider other than the carrier's own body is an
   *  opponent tackle that may break the weld. Defaults to "any registered
   *  player whose membership bit differs from the carrier's" — i.e. the pitch,
   *  the carrier himself and (when provided by the caller) team-mates never
   *  count, only opposing tacklers do. */
  isOpponent?: (other: RAPIER.Collider, carrier: TabsPlayer) => boolean;
  /** Local offset of the carried ball centre from the Chest centre, in chest
   *  space. The default rides the ball at the chest centre, which is the frame
   *  origin the catch hands the ball over at. */
  carryOffset?: { x: number; y: number; z: number };
  /** Fired once, the frame the weld breaks. `state` is always 'DROP_BALL'. */
  onBreak?: (info: { state: 'DROP_BALL'; impulse: number; by: RAPIER.Collider | null }) => void;
}

/** The live handle to a welded ball. `state` is 'BALL_SECURED' while the joint
 *  exists and 'DROP_BALL' once a tackle (or `release`) has broken it. */
export interface BallCarrier {
  readonly carrier: TabsPlayer;
  readonly ball: RAPIER.RigidBody;
  readonly breakImpulse: number;
  readonly joint: RAPIER.ImpulseJoint | null;
  readonly state: BallCarrierState;
  /** true while the ball is still welded to the chest. */
  readonly held: boolean;
  /** Manually break the weld and spill the ball (also used by the physics
   *  break path). Returns true if the ball was still held. */
  release(reason?: string): boolean;
}

/** Default break impulse (N·s): a committed low tackle on a 32 kg chest at
 *  6 m/s comfortably exceeds it; a push from a second later rarely does. */
export const DEFAULT_BREAK_IMPULSE_Ns = 9;

/** Internal per-carrier bookkeeping the break detector needs. */
interface ActiveCarrier {
  carrier: TabsPlayer;
  carrierBit: number;
  ball: RAPIER.RigidBody;
  ballCollider: RAPIER.Collider;
  ballHandle: number;
  savedGroups: number;
  breakImpulse: number;
  isOpponent: (other: RAPIER.Collider, carrier: TabsPlayer) => boolean;
  onBreak?: AttachBallOptions['onBreak'];
  constraint: BallCarrier;
  joint: RAPIER.ImpulseJoint;
  broken: boolean;
}

/** Player membership bit -> registration index (PLAYER<<0 is player 0). */
function playerIndexOfBit(bit: number): number {
  return Math.round(Math.log2(bit / BIT_PLAYER_BASE));
}

/** Stable key for an unordered pair of player indices. */
function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
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

  /** Active ball-carrier welds, keyed by the carried ball's collider handle.
   *  The break detector runs once per step over the shared event queue below,
   *  not once per carrier. */
  private readonly carriers = new Map<number, ActiveCarrier>();

  /* ---- impact tap state (see PlayerImpact) ---- */
  /** Collider handle -> the player that owns it and the body it hangs off. */
  private readonly colliderOwner = new Map<number, { player: number; body: RAPIER.RigidBody }>();
  /** Rigid-body handle -> its linear velocity captured BEFORE the last step.
   *  Rapier reports events after the solver has already cancelled the closing
   *  velocity, so the pre-step snapshot is the only honest source for "how
   *  hard did these two meet". */
  private readonly preStepVel = new Map<number, { x: number; y: number; z: number }>();
  private readonly impactListeners = new Set<PlayerImpactListener>();
  /** Pair key -> sim time at which that pair may report again. */
  private readonly pairNextAt = new Map<string, number>();

  /** THE ONE EVENT QUEUE. Both consumers — the ball-carrier break detector and
   *  the player-impact tap — read from this single queue, because Rapier's
   *  `world.step(queue)` takes exactly one and draining it twice would let
   *  whichever consumer ran first swallow the other's events. `drainStepEvents`
   *  makes the single pass and fans each event out to both. */
  private eventQueue: RAPIER.EventQueue | null = null;
  /** True once something has subscribed to impacts, so colliders registered
   *  later are armed too. */
  private impactEventsArmed = false;
  private simTime = 0;

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
    world.integrationParameters.numSolverIterations = 4;
    world.integrationParameters.numInternalPgsIterations = 1;
    world.integrationParameters.normalizedAllowedLinearError = 0.0001;
    world.integrationParameters.normalizedPredictionDistance = 0.1;
    world.integrationParameters.maxCcdSubsteps = 4;
    return wrapped;
  }

  /** Increment the simulation by one fixed step. */
  step(dt: number): void {
    this.world.timestep = dt;
    /* Two independent consumers may want events this step. Neither, and we
     * take the original zero-overhead path byte for byte — which is what the
     * headless gym runs. */
    const wantImpacts = this.impactListeners.size > 0;
    const wantBreaks = this.carriers.size > 0;
    if (!wantImpacts && !wantBreaks) {
      this.world.step();
      this.simTime += dt;
      return;
    }
    const queue = this.eventQueue ?? (this.eventQueue = new RAPIER.EventQueue(true));
    if (wantImpacts) this.captureVelocities();
    this.world.step(queue);
    this.simTime += dt;
    this.drainStepEvents(dt, wantImpacts, wantBreaks);
  }

  /**
   * Subscribe to player-vs-player impacts. Returns an unsubscribe function.
   *
   * The first subscription is what switches the machinery on: it allocates the
   * shared EventQueue and sets ActiveEvents on every player collider registered
   * so far (and any registered later). Unsubscribing leaves the queue in place
   * but `step` short-circuits past the impact drain, so toggling audio
   * mid-match is free.
   */
  onPlayerImpact(listener: PlayerImpactListener): () => void {
    this.impactListeners.add(listener);
    this.enableImpactEvents();
    return () => {
      this.impactListeners.delete(listener);
    };
  }

  /** Allocate the shared queue and arm every known player collider. */
  private enableImpactEvents(): void {
    if (!this.eventQueue) this.eventQueue = new RAPIER.EventQueue(true);
    this.impactEventsArmed = true;
    for (const { collider } of this.playerColliders) this.armCollider(collider);
  }

  private armCollider(collider: RAPIER.Collider): void {
    if (!this.impactEventsArmed) return;
    collider.setActiveEvents(
      RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS,
    );
    collider.setContactForceEventThreshold(IMPACT_FORCE_EVENT_THRESHOLD);
  }

  /** Snapshot every player body's linear velocity before the solver runs. */
  private captureVelocities(): void {
    this.preStepVel.clear();
    for (const owner of this.colliderOwner.values()) {
      const h = owner.body.handle;
      if (this.preStepVel.has(h)) continue;
      const v = owner.body.linvel();
      this.preStepVel.set(h, { x: v.x, y: v.y, z: v.z });
    }
  }

  /**
   * Weld a ball to a carrier's Chest and arm the tackle break-detector.
   *
   * This is the physical half of the engine's BALL_SECURED catch: a caller
   * places its carrier in BALL_SECURED possession, then hands the ball to this
   * method so the two stop being independent solvers. Three guarantees:
   *
   *  1. No snap. Before the joint exists the ball's linear AND angular velocity
   *     are copied from the Chest, and the ball is re-seated at the chest centre
   *     so a FixedImpulseJoint starts from an already-matching state.
   *  2. No self-jostle. The carrier's membership bit is masked out of the
   *     ball's filter for as long as it is welded, so the ball never collides
   *     with its own carrier (the chest, the arms holding it, the lot) yet still
   *     collides with every opponent and the pitch.
   *  3. One break threshold. Rapier contact-force events on the ball report the
   *     tackle's summed contact force; the first frame an opponent blow delivers
   *     `force * dt >= breakImpulse` the weld breaks and the ball is spilled.
   *
   * @param carrier The ragdoll whose Chest owns the ball.
   * @param ball    The physical ball to carry. Must have one collider.
   * @param opts    breakImpulse (required), optional opponent filter, offset,
   *                and onBreak callback.
   * @returns A `BallCarrier` handle. It starts `BALL_SECURED` and flips to
   *          `DROP_BALL` the instant the joint is released.
   */
  attachBallToCarrier(carrier: TabsPlayer, ball: RAPIER.RigidBody, opts: AttachBallOptions): BallCarrier {
    const ballCollider = ball.collider(0);
    if (!ballCollider) throw new Error('attachBallToCarrier: ball has no collider to listen on');
    if (this.carriers.has(ballCollider.handle)) {
      throw new Error('attachBallToCarrier: that ball is already welded to a carrier');
    }

    const chest = carrier.chest;
    const chestPos = chest.translation();
    const offset = opts.carryOffset ?? { x: 0, y: 0, z: 0 };
    const target = { x: chestPos.x + offset.x, y: chestPos.y + offset.y, z: chestPos.z + offset.z };

    /* 1. Match velocity AND angular velocity so the first solver pass does not
     * see a ball trying to fly one way out of a chest going another. */
    const lin = chest.linvel();
    const ang = chest.angvel();
    ball.setLinvel({ x: lin.x, y: lin.y, z: lin.z }, true);
    ball.setAngvel({ x: ang.x, y: ang.y, z: ang.z }, true);
    ball.setTranslation({ x: target.x, y: target.y, z: target.z }, true);

    /* 2. Cull the ball against this ONE carrier for as long as it is welded.
     * Keep membership; strip only the carrier's bit out of the filter. */
    const saved = ballCollider.collisionGroups();
    const membership = (saved >>> 16) & 0xffff;
    const filter = saved & 0xffff;
    ballCollider.setCollisionGroups(groups(membership, filter & ~carrier.bit));

    /* 3. The weld itself: a FixedImpulseJoint kills every relative degree of
     * freedom between the ball and the chest. The joint's first anchor is the
     * carry offset in chest-local space, so a ball carried in front of the
     * chest stays exactly there (offset (0,0,0) rides the chest centre). Both
     * frames are identity — correct at weld time because the ball was just
     * re-seated from the (un-rotated) spawn pose; the fixed joint then keeps
     * the offset rigid in the chest's own frame for the life of the weld. */
    const joint = this.world.createImpulseJoint(
      RAPIER.JointData.fixed(
        { x: offset.x, y: offset.y, z: offset.z }, RAPIER.RotationOps.identity(),
        { x: 0, y: 0, z: 0 }, RAPIER.RotationOps.identity(),
      ),
      chest, ball, true,
    );

    /* Contact-force events are opt-in per collider; the ball's collider turns
     * them on with a zero threshold so even the first touch reports. */
    ballCollider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    ballCollider.setContactForceEventThreshold(0);

    const active: ActiveCarrier = {
      carrier,
      carrierBit: carrier.bit,
      ball,
      ballCollider,
      ballHandle: ballCollider.handle,
      savedGroups: saved,
      breakImpulse: opts.breakImpulse,
      isOpponent: opts.isOpponent ?? ((other: RAPIER.Collider) => this.defaultOpponent(other, carrier.bit)),
      onBreak: opts.onBreak,
      joint,
      broken: false,
      constraint: null as unknown as BallCarrier,
    };
    active.constraint = this.makeCarrierHandle(active);
    this.carriers.set(ballCollider.handle, active);
    return active.constraint;
  }

  /** Free the WASM memory backing this world. */
  dispose(): void {
    /* Release every live weld so the ball collider groups are restored before
     * the WASM backing the world is freed. */
    for (const active of [...this.carriers.values()]) this.releaseCarrier(active);
    this.carriers.clear();
    this.impactListeners.clear();
    this.colliderOwner.clear();
    this.preStepVel.clear();
    this.pairNextAt.clear();
    if (this.eventQueue) { this.eventQueue.free(); this.eventQueue = null; }
    this.world.free();
  }

  /* ------------------ ball-carrier constraint internals ------------------ */

  /** Build the public handle for a welded carrier. `state`/`held`/`joint` read
   *  live off the backing record so a break is visible the same frame it
   *  happens without the caller polling the world. */
  private makeCarrierHandle(active: ActiveCarrier): BallCarrier {
    const self = this;
    const handle: BallCarrier = {
      carrier: active.carrier,
      ball: active.ball,
      breakImpulse: active.breakImpulse,
      get joint() { return active.broken ? null : active.joint; },
      get state(): BallCarrierState { return active.broken ? 'DROP_BALL' : 'BALL_SECURED'; },
      get held() { return !active.broken; },
      release(reason) { return self.releaseCarrier(active, reason); },
    };
    return handle;
  }

  /** Default opponent test. A collider is an opponent tackle if it is a lone
   *  player limb — single membership bit at or above the PLAYER base — that is
   *  NOT one of this carrier's own limbs. The pitch (PITCH bit), another ball
   *  (BALL bit) and the carrier himself never count, so only a real opposing
   *  tackler can rip the ball free. */
  private defaultOpponent(other: RAPIER.Collider, carrierBit: number): boolean {
    const m = (other.collisionGroups() >>> 16) & 0xffff;
    if (m === carrierBit) return false;              // the carrier's own body
    if (m < BIT_PLAYER_BASE || m === BIT_BALL || m === BIT_PITCH) return false; // pitch / ball / inert
    return (m & (m - 1)) === 0;                      // a lone, distinct player bit
  }

  /** Tear a weld down. Removes the joint, restores the ball's collision groups
   *  so it is a free object again (the spill), flags the record broken and
   *  unregisters it. Returns true if a live weld was released. */
  private releaseCarrier(active: ActiveCarrier, by?: { impulse?: number; by?: RAPIER.Collider | null } | string): boolean {
    if (active.broken) return false;
    active.broken = true;
    this.carriers.delete(active.ballHandle);
    this.world.removeImpulseJoint(active.joint, true);
    active.ballCollider.setCollisionGroups(active.savedGroups);
    const impulse = typeof by === 'object' && by ? by.impulse : undefined;
    const collider = typeof by === 'object' && by ? by.by ?? null : null;
    active.onBreak?.({ state: 'DROP_BALL', impulse: impulse ?? 0, by: collider });
    return true;
  }

  /**
   * ONE PASS OVER THE STEP'S EVENTS, fanned out to both consumers.
   *
   * The ball-carrier break detector and the player-impact tap both want
   * contact-force events, and Rapier hands them over exactly once: a queue is
   * emptied by the first `drainContactForceEvents` call, so two independent
   * drains would mean whichever ran first silently ate the other's events. That
   * is a genuinely nasty bug — welds that never break when audio is on, or hits
   * that go silent when a carrier is holding the ball — so there is one drain,
   * here, and each event is offered to whichever consumers are active.
   */
  private drainStepEvents(dt: number, wantImpacts: boolean, wantBreaks: boolean): void {
    const queue = this.eventQueue;
    if (!queue) return;
    const batch = wantImpacts ? new Map<string, PlayerImpact>() : null;

    queue.drainContactForceEvents((event) => {
      const h1 = event.collider1();
      const h2 = event.collider2();

      /* --- consumer 1: the ball-carrier weld --- */
      if (wantBreaks && this.carriers.size > 0) {
        const active = this.carriers.get(h1) ?? this.carriers.get(h2);
        if (active && !active.broken) {
          const otherHandle = active.ballHandle === h1 ? h2 : h1;
          const other = this.world.getCollider(otherHandle);
          /* force * dt is the impulse this blow carried. Only an OPPONENT's
           * contact may break the weld — a team-mate bumping the carrier, or
           * the ball brushing the pitch, must not spill it. */
          const impulse = event.totalForceMagnitude() * dt;
          if (impulse >= active.breakImpulse
            && (!other || active.isOpponent(other, active.carrier))) {
            this.releaseCarrier(active, { impulse, by: other });
          }
        }
      }

      /* --- consumer 2: the audio impact tap --- */
      if (batch) {
        const a = this.colliderOwner.get(h1);
        const b = this.colliderOwner.get(h2);
        if (a && b && a.player !== b.player) {
          const impact = this.buildImpact(a, b, h1, h2, event.maxForceDirection());
          if (impact) {
            impact.impulse = Math.max(impact.impulse, event.totalForceMagnitude() * dt);
            impact.measured = true;
            this.mergeImpact(batch, impact);
          }
        }
      }
    });

    /* Collision-started events are impact-only: they catch pairs that met too
     * gently to raise a force event but were still closing above the gate. */
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!batch || !started) return;
      const a = this.colliderOwner.get(h1);
      const b = this.colliderOwner.get(h2);
      if (!a || !b || a.player === b.player) return;
      const impact = this.buildImpact(a, b, h1, h2, null);
      if (impact) this.mergeImpact(batch, impact);
    });

    if (batch) this.dispatchImpacts(batch);
  }

  /** Measure one contact. Returns null when it is below the speed gate. */
  private buildImpact(
    a: { player: number; body: RAPIER.RigidBody },
    b: { player: number; body: RAPIER.RigidBody },
    handleA: number,
    handleB: number,
    normal: { x: number; y: number; z: number } | null,
  ): PlayerImpact | null {
    const va = this.preStepVel.get(a.body.handle) ?? a.body.linvel();
    const vb = this.preStepVel.get(b.body.handle) ?? b.body.linvel();
    const rx = va.x - vb.x;
    const ry = va.y - vb.y;
    const rz = va.z - vb.z;
    const relativeSpeed = Math.hypot(rx, ry, rz);
    if (relativeSpeed <= IMPACT_MIN_RELATIVE_SPEED) return null;

    const closingSpeed = normal
      ? Math.abs(rx * normal.x + ry * normal.y + rz * normal.z)
      : relativeSpeed;

    /* Reduced mass: the mass that actually has to be stopped in a two-body
     * collision. m_eff · Δv is the impulse an inelastic hit would deliver, and
     * it is the fallback whenever no force event measured the real one. */
    const ma = a.body.mass();
    const mb = b.body.mass();
    const mEff = ma + mb > 1e-6 ? (ma * mb) / (ma + mb) : 0;

    const pa = this.world.getCollider(handleA)?.translation();
    const pb = this.world.getCollider(handleB)?.translation();
    const at = pa && pb
      ? { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 }
      : a.body.translation();

    return {
      playerA: Math.min(a.player, b.player),
      playerB: Math.max(a.player, b.player),
      x: at.x,
      y: at.y,
      z: at.z,
      relativeSpeed,
      closingSpeed,
      impulse: mEff * closingSpeed,
      measured: false,
    };
  }

  /**
   *    * Fold a contact into the batch, keeping ONE impact per pair per step.
   *
   * Not a replace: the two sources measure different things and both are worth
   * keeping. A contact-force event carries a real measured impulse and a real
   * normal; a collision-started event carries the reduced-mass estimate, which
   * is usually the LARGER number because the solver spreads one collision over
   * several steps while `m_eff · Δv` is the whole inelastic impulse at once.
   * Taking the max of the magnitudes but the OR of the `measured` flags keeps
   * the loudest honest number without lying about where it came from.
   */
  private mergeImpact(batch: Map<string, PlayerImpact>, impact: PlayerImpact): void {
    const key = pairKey(impact.playerA, impact.playerB);
    const prev = batch.get(key);
    if (!prev) {
      batch.set(key, impact);
      return;
    }
    prev.impulse = Math.max(prev.impulse, impact.impulse);
    prev.measured = prev.measured || impact.measured;
    /* A normal-projected closing speed is better information than the raw
     * relative speed, so let a force event's number win even if it is smaller. */
    if (impact.measured && !prev.measured) prev.closingSpeed = impact.closingSpeed;
    prev.relativeSpeed = Math.max(prev.relativeSpeed, impact.relativeSpeed);
  }

  /** Publish the step's impacts, subject to the per-pair cooldown. */
  private dispatchImpacts(batch: Map<string, PlayerImpact>): void {
    for (const impact of batch.values()) {
      const key = pairKey(impact.playerA, impact.playerB);
      const nextAt = this.pairNextAt.get(key) ?? -Infinity;
      if (this.simTime < nextAt) continue;
      this.pairNextAt.set(key, this.simTime + IMPACT_PAIR_COOLDOWN);
      for (const listener of this.impactListeners) {
        try {
          listener(impact);
        } catch {
          /* A listener that throws (a dead AudioContext, say) must never take
           * the simulation down with it. */
        }
      }
    }
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
    this.registerPlayerCollider(collider, bit, body);
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
      this.registerPlayerCollider(collider, bit, body);
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
      bit,
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

  private registerPlayerCollider(collider: RAPIER.Collider, bit: number, body: RAPIER.RigidBody): void {
    this.playerColliders.push({ collider, bit });
    /* The impact tap needs collider -> (player, body) to resolve an event
     * handle back into "who hit whom, and how fast were they going". */
    this.colliderOwner.set(collider.handle, { player: playerIndexOfBit(bit), body });
    this.armCollider(collider);
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
