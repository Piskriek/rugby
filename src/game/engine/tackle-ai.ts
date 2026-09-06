/**
 * T-59 — ENGINE/TACKLE-AI. The TABS-style flailing dive for NPC defenders.
 *
 * The physics layer owns the tackle: the defender's ragdoll blindly tracks
 * the carrier's ragdoll and, at close Hips-to-Hips range, launches itself
 * through the air at him — balance gain to zero, one committed impulse on
 * Hips and Chest, wobble gait killed. After that it is a ballistic flail:
 * standard Rapier contacts resolve the impact.
 *
 * Two critical fixes live here, both learned the hard way:
 *
 * CRITICAL FIX 1 — the chase never snaps the trunk onto the carrier's
 * shell to arrest the closing. A position snap injects massive vertical
 * energy (measured: an 8 m launch). Once the defender's Hips cross the
 * horizontal shell around the carrier's Hips, the locomotion target is
 * dropped and the Rapier contact does the stopping.
 *
 * CRITICAL FIX 2 — the referee laws (engine/open.ts) carry a dive-reach
 * grab that triggers at 1.1 m × DIVE_REACH_BONUS = 1.65 m, INSIDE the 1.5 m
 * Hips-to-Hips range this dive needs: it would intercept the physics dive
 * before it happens. `tabsTakeover()` is the override: while the ball is
 * live and the dive has taken over a carrier, the law's grab stands down
 * and the physics resolves the contact.
 *
 * This module is pure orchestration over a live RagdollRig + RagdollMotor
 * pair (type-only imports — no WASM here). The app, or the probe
 * (scripts/divetackle-probe.ts), owns the world and the tick loop.
 */
import type { RagdollRig } from '../../entities/ragdoll/rig';
import type { RagdollMotor } from '../../entities/ragdoll/motor';
import type { Vec3 } from '../../entities/ragdoll/types';

/* ------------------------------------------------------ the law override - */

/** Identity of an open-play carrier, as the referee law sees it. */
export interface CarrierId {
  team: 'A' | 'B';
  num: number;
}

const keyOf = (id: CarrierId): string => `${id.team}:${id.num}`;

/** carrier key → seconds the TABS dive still keeps the law off the tackle. */
const takeovers = new Map<string, number>();

/**
 * Arm the law bypass for one carrier. The dive calls this when it launches;
 * the app wiring can call it when it commits a defender ragdoll to the
 * physics tackle. `seconds` bounds how long the law stands down if the
 * physics never reports the tackle complete.
 */
export function armTabsTakeover(id: CarrierId, seconds: number): void {
  takeovers.set(keyOf(id), Math.max(takeovers.get(keyOf(id)) ?? 0, seconds));
}

/** Release the law bypass for one carrier (tackle resolved, ball dead). */
export function clearTabsTakeover(id: CarrierId): void {
  takeovers.delete(keyOf(id));
}

/**
 * CRITICAL FIX 2 — true while the TABS flailing dive owns this carrier's
 * tackle AND the ball is live. The referee law's dive-reach grab (open.ts,
 * 1.1 m × DIVE_REACH_BONUS = 1.65 m) must stand down in that window: the
 * physics dive triggers at 1.5 m Hips-to-Hips and the law would intercept
 * it. A dead ball cancels the takeover immediately — the law owns set
 * pieces.
 */
export function tabsTakeover(ball: { live: boolean }, id: CarrierId): boolean {
  if (!ball.live) {
    clearTabsTakeover(id);
    return false;
  }
  return takeovers.has(keyOf(id));
}

/**
 * Tick the takeover clocks once per engine frame. Armed takeovers expire
 * after their armed time so a dive that never resolves cannot hold the law
 * off the tackle forever.
 */
export function tickTabsTakeover(dt: number): void {
  if (takeovers.size === 0) return;
  for (const [k, remain] of takeovers) {
    const next = remain - dt;
    if (next <= 0) takeovers.delete(k);
    else takeovers.set(k, next);
  }
}

/* ----------------------------------------------------------- the dive ---- */

export interface TackleDiveOptions {
  /** Physics ticks between Hips↔Hips distance polls. Default 3. */
  pollEvery?: number;
  /** 3D Hips↔Hips distance (m) that commits the dive. Default 1.5. */
  triggerDistance?: number;
  /** Carrier shell radius (m) around the carrier's Hips. Once the
   *  defender's Hips close to this horizontally the chase is refused and
   *  the Rapier contact resolves the impact (CRITICAL FIX 1). Default
   *  0.45 — two upright Hips colliders plus the chest capsule. */
  shellRadius?: number;
  /** Horizontal dive impulse (N·s) on EACH of Hips and Chest. Default 400. */
  forwardImpulse?: number;
  /** Vertical dive impulse (N·s) on each of Hips and Chest. Default 150. */
  upImpulse?: number;
  /** Chase setpoint speed (m/s) of the wobble-gait drive while tracking.
   *  Default 2.4. */
  chaseSpeed?: number;
  /** Engine identity of the carrier — arms the law bypass on launch
   *  (CRITICAL FIX 2). Omitted in pure-physics use (the probe). */
  carrierId?: CarrierId;
  /** How long the law stands down after launch, seconds. Default 2.5. */
  takeoverSeconds?: number;
}

/** The numbers the task is written against, in one place. */
export const TABS_DIVE_DEFAULTS = {
  pollEvery: 3,
  triggerDistance: 1.5,
  shellRadius: 0.45,
  forwardImpulse: 400,
  upImpulse: 150,
  chaseSpeed: 2.4,
  takeoverSeconds: 2.5,
};

export type TackleDiveState = 'tracking' | 'diving';

/**
 * One NPC defender's flailing-dive brain, bound to a live defender rig +
 * motor and a carrier rig. Call `tick()` once per physics step, BEFORE the
 * defender's `motor.step()` (the drive target it sets is read on that
 * step). The carrier needs no motor — the defender tracks its Hips.
 */
export class TackleDive {
  /** 'tracking' while the defender chases; 'diving' once the launch is
   *  committed. Sticky — a flailing dive never re-arms itself. */
  state: TackleDiveState = 'tracking';
  /** Last polled 3D Hips↔Hips distance (m), null before the first poll. */
  lastDistance: number | null = null;
  /** Latched once the defender's Hips crossed the carrier shell and the
   *  chase was refused (CRITICAL FIX 1) — the Rapier contact is in charge
   *  now. One-way: a flailing dive is a committed play, and the trunk is
   *  never commanded back into the shell after crossing it. */
  crossingRefused = false;
  /** Horizontal unit direction the dive was launched along (world frame). */
  diveDirection: Vec3 | null = null;
  /** Physics ticks elapsed since construction. */
  ticks = 0;

  private readonly pollEvery: number;
  private readonly triggerDistance: number;
  private readonly shellRadius: number;
  private readonly forwardImpulse: number;
  private readonly upImpulse: number;
  private readonly chaseSpeed: number;
  private readonly carrierId: CarrierId | null;
  private readonly takeoverSeconds: number;

  constructor(
    private readonly def: { rig: RagdollRig; motor: RagdollMotor },
    private readonly car: { rig: RagdollRig },
    opts: TackleDiveOptions = {},
  ) {
    this.pollEvery = opts.pollEvery ?? TABS_DIVE_DEFAULTS.pollEvery;
    this.triggerDistance = opts.triggerDistance ?? TABS_DIVE_DEFAULTS.triggerDistance;
    this.shellRadius = opts.shellRadius ?? TABS_DIVE_DEFAULTS.shellRadius;
    this.forwardImpulse = opts.forwardImpulse ?? TABS_DIVE_DEFAULTS.forwardImpulse;
    this.upImpulse = opts.upImpulse ?? TABS_DIVE_DEFAULTS.upImpulse;
    this.chaseSpeed = opts.chaseSpeed ?? TABS_DIVE_DEFAULTS.chaseSpeed;
    this.carrierId = opts.carrierId ?? null;
    this.takeoverSeconds = opts.takeoverSeconds ?? TABS_DIVE_DEFAULTS.takeoverSeconds;
  }

  /** Hips positions of defender and carrier, world frame. */
  private hips(): { d: Vec3; c: Vec3 } {
    const of = (rig: RagdollRig): Vec3 => {
      const p = rig.byPart.get('hips')!.body.translation();
      return { x: p.x, y: p.y, z: p.z };
    };
    return { d: of(this.def.rig), c: of(this.car.rig) };
  }

  /** Advance one physics tick (call before the defender's motor.step). */
  tick(): void {
    if (this.state === 'diving') return; // committed; nothing re-arms
    this.ticks++;
    if (this.ticks % this.pollEvery !== 0) return; // poll every 3 ticks

    const { d, c } = this.hips();
    const dist = Math.hypot(c.x - d.x, c.y - d.y, c.z - d.z);
    this.lastDistance = dist;

    if (dist <= this.triggerDistance) {
      this.launch();
      return;
    }

    // Latched refusal (CRITICAL FIX 1): once the Hips crossed the carrier
    // shell the trunk is never commanded back into it — no snap, no closing.
    if (this.crossingRefused) {
      this.def.motor.drive = null;
      return;
    }

    // > 1.5 m — kinematic locomotion target toward the carrier.
    const hdx = c.x - d.x;
    const hdz = c.z - d.z;
    const hdist = Math.hypot(hdx, hdz);
    if (hdist <= this.shellRadius) {
      /* CRITICAL FIX 1 — crossed the carrier's shell along the horizontal
       * normal. Drop the locomotion target: a position snap here (trunk
       * pinned to the shell to "arrest" the closing) is what used to
       * inject massive vertical energy and launch men 8 m skyward. With no
       * commanded motion left, the standard Rapier contact resolves the
       * impact. */
      this.crossingRefused = true;
      this.def.motor.drive = null;
      return;
    }
    this.crossingRefused = false;
    const inv = 1 / hdist;
    this.def.motor.drive = {
      x: (hdx * inv) * this.chaseSpeed,
      y: 0,
      z: (hdz * inv) * this.chaseSpeed,
    };
  }

  /** The flail: balance gain → 0, one committed impulse on Hips + Chest. */
  private launch(): void {
    this.state = 'diving';
    /* 1 — the Puppet-Master balance stabiliser goes to zero gain: left on,
     * it would torque the trunk back upright mid-flight and the flail would
     * read as a stumble, not a dive. */
    this.def.motor.balance.enabled = false;
    /* 2 — the launch impulse. Forward = horizontal unit vector defender →
     * carrier (the blind-tracking direction), 400 N·s on Hips and on Chest,
     * plus 150 N·s up on each. Applied at each body's centre of mass. */
    const { d, c } = this.hips();
    let fx = c.x - d.x;
    let fz = c.z - d.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-6) {
      fx = 0;
      fz = 1;
    } else {
      fx /= fl;
      fz /= fl;
    }
    this.diveDirection = { x: fx, y: 0, z: fz };
    const impulse = { x: fx * this.forwardImpulse, y: this.upImpulse, z: fz * this.forwardImpulse };
    this.def.rig.byPart.get('hips')!.body.applyImpulse(impulse, true);
    this.def.rig.byPart.get('chest')!.body.applyImpulse(impulse, true);
    /* 3 — kill the wobble gait: from here the legs flail ballistically. */
    this.def.motor.drive = null;
    /* 4 — CRITICAL FIX 2: the referee law's dive-reach grab (1.65 m) would
     * otherwise intercept this 1.5 m dive; hand the tackle to the physics
     * while the ball is live. */
    if (this.carrierId) armTabsTakeover(this.carrierId, this.takeoverSeconds);
  }
}
