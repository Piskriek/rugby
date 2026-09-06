/**
 * ragdoll.ts — a physical fall for the 3D squad, at the cost of a sprite.
 *
 * WHY THIS EXISTS
 * ---------------
 * A tackle in this game was animated, not solved. Three canned stages
 * (`tackleDrive` → `tackleGround` → `present`) cross-faded across a 0.40 s
 * window, with a procedural pitch and arm-aim layered on top. That is the right
 * architecture for the drive — the wrap, the reach and the churn all read better
 * authored than solved — and the wrong one for the FLOOR. A clip cannot know how
 * fast the two men were going, how far apart they were, whether the carrier came
 * down on his shoulder or his back, or that a muddy pitch stops a man dead while
 * a firm one lets him slide three metres. Every fall therefore ended the same
 * way, at the same height, in the same pose — which is what "the tackles look
 * fake" means when you cannot name it.
 *
 * THE APPROACH
 * ------------
 * Position-based dynamics: Verlet particles plus distance constraints, not a
 * rigid-body engine. A real physics engine costs a WASM payload, a fixed-rate
 * sim step, thirty-one bodies with a broadphase, and a skeleton it will fight
 * forever. This costs twenty particles and a couple of dozen constraints per
 * FALLING man, and only falling men — twenty-nine others pay nothing. Eight
 * simultaneous falls stay well under a millisecond a frame (see
 * `scripts/ragdollcheck.ts`).
 *
 * Four decisions do most of the work:
 *
 *  1  THE PARTICLES ARE BONES. No mapping table, no retargeting, no rest-pose
 *     assumption: the system reads the bones' CURRENT world positions when a
 *     fall starts, so it inherits the wrap the animation just built — the arms
 *     are already around the carrier's waist the moment physics takes over.
 *
 *  2  PHYSICS OWNS DIRECTIONS, THE CLIP KEEPS TWIST. A bone is driven by
 *     rotating its animated orientation until its own +Y axis points along the
 *     solved segment. Roll about the bone axis — the one thing a position solver
 *     cannot know and the thing that makes a solved elbow look dead — stays
 *     authored. (This rig's bones point down local +Y; `lookAt` aims +Z and
 *     would twist every limb sideways, which is the trap already documented in
 *     ThreePlayerManager.)
 *
 *  3  THE ENGINE STILL OWNS TRANSLATION. `engine/breakdown.ts` slides the pair
 *     and `engine/latch.ts` owns the carry, so a ragdoll never moves a man
 *     through the world: it collapses RELATIVE to a root the simulation put
 *     there. Each frame the anchor delta is added to every particle, which keeps
 *     the two representations welded together and keeps this file free of any
 *     write into engine state — the rule `HANDOFF.md` §3.1 exists to enforce.
 *
 *  4  A FALL IS A TORQUE, NOT AN IMPULSE. A hit does not translate a man, it
 *     rotates him about his feet. Adding the collision velocity per particle in
 *     proportion to its height above the floor produces that exactly: the head is
 *     thrown harder than the hips, the chain constraints turn the difference into
 *     rotation, and he folds. Velocity applied to the root instead gives a
 *     sliding cardboard cutout.
 *
 * The ground is a plane with mass-weighted penetration, friction and restitution
 * handed in from the match conditions. A man on MUDDY turf under FLOODLIGHTS stops
 * in one engagement and stays down; on a firm afternoon he skips, rolls and takes
 * a second line of turf with him. Same solver, different ground.
 */
import * as THREE from 'three';

/** Model metres per second squared. One model unit is one pitch metre. */
const G = 9.81;
/** Fixed solver step. A variable step is a variable amount of energy. */
const STEP = 1 / 120;
/** Constraint relaxation passes per substep. Four is where the torso stops
 *  visibly wobbling; six is not distinguishable and costs half again as much. */
const ITERATIONS = 4;
/** Substeps per rendered frame, hard capped: a 250 ms alt-tab must not spend
 *  thirty seconds of physics catching up, and a slow frame must not tunnel a
 *  skull through the turf. */
const MAX_SUBSTEPS = 5;
/** Per-substep displacement ceiling, model metres. Deep penetration from a
 *  bad contact is unbounded; this makes it bounded and merely ugly for a frame. */
const MAX_STEP_MOVE = 0.085;
/** Mean joint speed under which the fall is over, m/s. */
const SLEEP_SPEED = 0.11;
/** How long it has to stay under it before the clip takes the body back. */
const SLEEP_HOLD = 0.24;
/** Hard stop: after this the sim force-settles calm or not. */
const MAX_SIM_TIME = 2.4;
/** How far the pelvis may wander from the engine's root before it is reeled
 *  back. Past this the 3D body and the 2D marker disagree about who is down. */
/**
 * How far a solved body may travel from the man the engine is moving.
 *
 * A tackled pair really does slide — two metres on firm grass, half a metre in
 * the mud — and the engine's own kinetic slide in `breakdown` carries most of
 * that already. This is the allowance for the REST of it, and the reason it is
 * bounded rather than free: the instant the ragdoll owns the position, a man who
 * was tackled five metres downfield is standing where the ruck is not.
 */
const MAX_DRIFT = 1.6;

/** Body mass, kg, distributed over the skeleton of a 78 kg forward. */
interface JointDef {
  /** every spelling this rig (or a future Mixamo re-export) might use */
  names: string[];
  /** radius of the soft sphere that rests on the turf, model metres */
  r: number;
  m: number;
  /** the bones this joint gives its direction to */
  drives?: string[];
  /** hold this other joint at its seeded distance (shoulders, hips) */
  rigid?: string;
}

const JOINTS: JointDef[] = [
  { names: ['pelvis', 'Hips'], r: 0.135, m: 13, drives: ['spine_01', 'thigh_l', 'thigh_r'] },
  { names: ['spine_01'], r: 0.13, m: 6, drives: ['spine_02'] },
  { names: ['spine_02'], r: 0.13, m: 6, drives: ['spine_03'] },
  { names: ['spine_03', 'Spine2'], r: 0.15, m: 7, drives: ['neck_01', 'clavicle_l', 'clavicle_r'] },
  { names: ['neck_01', 'Neck'], r: 0.09, m: 1.6, drives: ['head'] },
  { names: ['head', 'Head'], r: 0.115, m: 5, drives: [] },
  { names: ['clavicle_l'], r: 0.075, m: 1.7, drives: ['upperarm_l'], rigid: 'clavicle_r' },
  { names: ['upperarm_l'], r: 0.07, m: 1.9, drives: ['lowerarm_l'] },
  { names: ['lowerarm_l'], r: 0.058, m: 1.25, drives: ['hand_l'] },
  { names: ['hand_l'], r: 0.05, m: 0.5, drives: [] },
  { names: ['clavicle_r'], r: 0.075, m: 1.7, drives: ['upperarm_r'] },
  { names: ['upperarm_r'], r: 0.07, m: 1.9, drives: ['lowerarm_r'] },
  { names: ['lowerarm_r'], r: 0.058, m: 1.25, drives: ['hand_r'] },
  { names: ['hand_r'], r: 0.05, m: 0.5, drives: [] },
  { names: ['thigh_l'], r: 0.09, m: 9, drives: ['calf_l'] },
  { names: ['calf_l'], r: 0.07, m: 4.4, drives: ['foot_l'] },
  { names: ['foot_l'], r: 0.05, m: 1.4, drives: [] },
  { names: ['thigh_r'], r: 0.09, m: 9, drives: ['calf_r'] },
  { names: ['calf_r'], r: 0.07, m: 4.4, drives: ['foot_r'] },
  { names: ['foot_r'], r: 0.05, m: 1.4, drives: [] },
];

/** One-sided maximum distances, as a fraction of the seeded span between two
 *  joints. Below 1.0 the limb cannot lock out straight. A knee is allowed
 *  nearly full extension (0.985 — legs do straighten), an elbow less (0.955),
 *  a neck very little: a head folding back through a spine is the single most
 *  obvious way a ragdoll looks wrong, so it gets the tightest budget. */
const LIMITS: { a: string; b: string; k: number }[] = [
  { a: 'upperarm_l', b: 'hand_l', k: 0.955 },
  { a: 'upperarm_r', b: 'hand_r', k: 0.955 },
  { a: 'thigh_l', b: 'foot_l', k: 0.985 },
  { a: 'thigh_r', b: 'foot_r', k: 0.985 },
  { a: 'pelvis', b: 'spine_03', k: 0.99 },
  { a: 'pelvis', b: 'head', k: 0.90 },
  { a: 'spine_03', b: 'head', k: 0.80 },
  /* Legs cannot scissor through each other, and the pelvis cannot shear the
   * knees apart, without something holding the width of the hips. */
  { a: 'thigh_l', b: 'thigh_r', k: 1.35 },
  { a: 'foot_l', b: 'foot_r', k: 2.6 },
];

interface Particle {
  p: THREE.Vector3;
  prev: THREE.Vector3;
  /** inverse mass; 0 = immovable */
  im: number;
  r: number;
  bone: THREE.Bone | null;
  /** joints this one aims at, for the direction pass */
  driveTo: Particle[];
  name: string;
  grounded: boolean;
  /** time of the last reported turf contact, for the wear pass */
  lastHit: number;
}

interface Link {
  a: number; b: number; rest: number; max: number; stiff: number;
  /**
   * `max` links are JOINT LIMITS, not bones: below the ceiling they must be
   * inert. Left out, the seeded span it also carries becomes a target and the
   * limit fights the structural link across it — the elbow ends up somewhere
   * in the middle of the argument, straighter than the limit allowed.
   */
  ceiling?: boolean;
}

export interface RagdollGround {
  /** kinetic friction, from the pitch: mud grips, firm grass does not */
  friction: number;
  /** bounciness, dampened by wet turf */
  restitution: number;
  /** the turf plane, model metres (0 unless the pitch is not flat) */
  y: number;
}

export interface RagdollSeed {
  /** this man's velocity relative to the pair's mean drift, model m/s */
  vx: number; vz: number; vy?: number;
  /** angular kick about the vertical, rad/s — the twist of a side-on hit */
  spin?: number;
  /** how far off the floor he already was: a dive starts airborne */
  airborne?: number;
}

/** One solved fall for one man. */
export class Ragdoll {
  private parts: Particle[] = [];
  /** particle indices, every parent before its children — `apply()` order */
  private byDepth: number[] = [];
  private links: Link[] = [];
  private index = new Map<string, number>();
  private acc = 0;
  private t = 0;
  private calm = 0;
  private anchor = new THREE.Vector3();
  private seedPelvisY = 0;
  private ground: RagdollGround;
  private s1 = new THREE.Vector3();
  private s2 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private q3 = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private pins: { i: number; t: THREE.Vector3; k: number }[] = [];
  /** joint -> the joint that owns it, so a pin can pull the limb with it */
  private parentOf: number[] = [];
  /** the Object3D the skeleton hangs off; its own transform is the world frame */
  private root!: THREE.Object3D;

  /**
   * Hold a joint near a world point for this frame.
   *
   * This is how a fall keeps a WRAP. A ragdoll that ignores the man being
   * tackled lets the tackler's arms flop away from the body he just grabbed,
   * which is the specific way a cheap ragdoll reads as cheap: the collision is
   * solved, then undone, in the same half second. Pinning the two hands to the
   * carrier's waist as a soft constraint (not a joint, so the arms still
   * straighten under load) says "he is still holding him" in the solver's own
   * language. `k` is a per-iteration blend, so it goes slack with distance
   * instead of snapping the limb to the target.
   */
  pin(jointName: string, x: number, y: number, z: number, k: number) {
    const i = this.index.get(jointName);
    if (i === undefined) return;
    const q = this.parts[i];
    if (!q.bone) return;
    if (!this.pins.some((p) => p.i === i)) this.pins.push({ i, t: new THREE.Vector3(), k });
    const p = this.pins[this.pins.findIndex((q2) => q2.i === i)];
    p.t.set(x, y, z);
    p.k = Math.max(p.k, k);
  }

  clearPins() { this.pins.length = 0; }

  /** New turf hits since the last drain, in model metres. */
  contacts: { x: number; z: number; force: number }[] = [];
  settled = false;
  /** 0..1 of the pose physics owns. The caller ramps it in and back out. */
  weight = 0;

  constructor(root: THREE.Object3D, seed: RagdollSeed, ground: RagdollGround) {
    this.ground = ground;
    this.root = root;
    /* The solver works in the rig's own metres — a body bone 0.9 units up a
     * 1.85 m man, gravity 9.81, a head radius of 0.115. Whatever scale the root
     * is drawn at belongs to the scene, not to the physics, so the world
     * positions read off the skeleton are divided back out once, here. */
    const ws = root.getWorldScale(this.s1);
    const inv = ws.x > 1e-6 ? 1 / ws.x : 1;
    for (const def of JOINTS) {
      let bone: THREE.Bone | null = null;
      for (const n of def.names) {
        bone = findBone(root, n);
        if (bone) break;
      }
      const p = new THREE.Vector3();
      if (bone) {
        bone.updateWorldMatrix(true, false);
        p.setFromMatrixPosition(bone.matrixWorld).multiplyScalar(inv);
      }
      this.index.set(def.names[0], this.parts.length);
      this.parts.push({
        p, prev: p.clone(), im: 1 / def.m, r: def.r, bone,
        driveTo: [], name: def.names[0], grounded: false, lastHit: -1,
      });
    }
    this.parentOf = this.parts.map(() => -1);

    const joint = (n: string): Particle | undefined => {
      const i = this.index.get(n);
      return i === undefined ? undefined : this.parts[i];
    };
    const idOf = (q: Particle) => this.parts.indexOf(q);

    /* ---- structural links, at the lengths the animation happens to be at -- */
    for (const def of JOINTS) {
      const a = joint(def.names[0]);
      if (!a?.bone) continue;
      for (const child of def.drives ?? []) {
        const b = joint(child);
        if (!b?.bone) continue;
        this.links.push({ a: idOf(a), b: idOf(b), rest: a.p.distanceTo(b.p), max: Infinity, stiff: 1 });
        a.driveTo.push(b);
        this.parentOf[this.index.get(b.name)!] = this.parts.indexOf(a);
      }
      if (def.rigid) {
        const b = joint(def.rigid);
        if (b?.bone) {
          this.links.push({ a: idOf(a), b: idOf(b), rest: a.p.distanceTo(b.p), max: Infinity, stiff: 1 });
        }
      }
    }
    /* ---- joint limits ---------------------------------------------------- */
    /* Depth-first from the pelvis: the pose has to be written root-down. */
    const depth = (i: number, seen: number): number =>
      this.parentOf[i] < 0 || seen > 24 ? 0 : depth(this.parentOf[i], seen + 1) + 1;
    this.byDepth = this.parts.map((_, i) => i).sort((a, b) => depth(a, 0) - depth(b, 0));
    for (const lim of LIMITS) {
      const a = joint(lim.a), b = joint(lim.b);
      if (!a?.bone || !b?.bone) continue;
      const span = a.p.distanceTo(b.p);
      if (span < 1e-4) continue;
      this.links.push({ a: idOf(a), b: idOf(b), rest: span, max: span * lim.k, stiff: 0.9, ceiling: true });
    }

    const pelvis = this.parts[0];
    this.anchor.set(pelvis.p.x, 0, pelvis.p.z);
    this.seedPelvisY = pelvis.p.y;

    /* ---- the fall -------------------------------------------------------- */
    /* Height-scaled velocity, applied as an initial `prev` offset rather than a
     * force, so it costs nothing to keep stable. The airborne term drops the
     * whole body first: a diving tackler must not begin the sim standing. */
    const air = Math.min(0.4, seed.airborne ?? 0);
    if (air > 0) for (const q of this.parts) q.p.y -= air;
    const sp = seed.spin ?? 0;
    const gy = ground.y;
    for (const q of this.parts) {
      const h = Math.max(0, q.p.y - gy);
      const gain = 0.5 + 0.5 * Math.min(1.7, h / 0.9);
      const vx = (seed.vx + sp * (q.p.z - this.anchor.z)) * gain;
      const vy = (seed.vy ?? 0) * gain;
      const vz = (seed.vz - sp * (q.p.x - this.anchor.x)) * gain;
      q.prev.set(q.p.x - vx * STEP, q.p.y - vy * STEP, q.p.z - vz * STEP);
    }
  }

  /** The engine moved this body this frame; move the whole sim with it. */
  setAnchor(x: number, z: number) {
    const dx = x - this.anchor.x, dz = z - this.anchor.z;
    if (dx === 0 && dz === 0) return;
    this.anchor.set(x, 0, z);
    for (const q of this.parts) {
      q.p.x += dx; q.p.z += dz;
      q.prev.x += dx; q.prev.z += dz;
    }
  }

  /**
   * Advance by real frame time. The game's slow-motion (hit-stop, replay) has
   * to reach the fall too: a physics step driven by simulation time would keep
   * the body moving at full speed inside a frozen frame, which is how a
   * deliberate three-frame pause turns into a man landing before the impact.
   */
  step(dt: number) {
    if (this.settled) return;
    this.acc = Math.min(STEP * MAX_SUBSTEPS, this.acc + Math.max(0, dt));
    let subs = 0;
    while (this.acc >= STEP && subs < MAX_SUBSTEPS) {
      this.acc -= STEP;
      subs++;
      this.substep();
    }
    if (subs === 0) return;
    this.t += dt;

    let energy = 0;
    for (const q of this.parts) energy += q.p.distanceToSquared(q.prev) * q.im;
    const mean = Math.sqrt(Math.max(0, energy) / this.parts.length) / STEP;
    if (!Number.isFinite(mean)) { this.settled = true; return; }
    this.calm = mean < SLEEP_SPEED ? this.calm + dt : 0;
    if (this.calm > SLEEP_HOLD || this.t > MAX_SIM_TIME) this.settled = true;
  }

  private substep() {
    const h2 = STEP * STEP;
    const damp = 0.9965;
    for (const q of this.parts) {
      let vx = (q.p.x - q.prev.x) * damp;
      let vy = (q.p.y - q.prev.y) * damp;
      let vz = (q.p.z - q.prev.z) * damp;
      const m = Math.hypot(vx, vy, vz);
      if (m > MAX_STEP_MOVE) {
        const k = MAX_STEP_MOVE / m;
        vx *= k; vy *= k; vz *= k;
      }
      q.prev.copy(q.p);
      q.p.x += vx;
      q.p.y += vy - G * h2;
      q.p.z += vz;
    }
    const g = this.ground;
    for (let it = 0; it < ITERATIONS; it++) {
      this.solveLinks(false);
      this.solvePins();
      this.solveGround(g.friction, g.restitution, it === 0);
      /* A floor that pushes a hand out of the turf can push it past the point
       * where the elbow would have to break: press on the ground hard enough and
       * the arm straightens into hyperextension, which is the single most
       * reliable tell of a fake ragdoll. So the joints are re-limited AFTER the
       * ground, and the floor then takes back only the height. */
      this.solveLinks(true);
      this.settleOnGround(g.y);
      this.solvePins();
    }
    this.reelIn();
  }

  private settleOnGround(gy: number) {
    for (const q of this.parts) {
      const floor = gy + q.r;
      if (q.p.y < floor) q.p.y = floor;
    }
  }

  private solveLinks(ceilingsOnly: boolean) {
    for (const l of this.links) {
      if (ceilingsOnly !== !!l.ceiling) continue;
      const a = this.parts[l.a], b = this.parts[l.b];
      const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, dz = b.p.z - a.p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-12) continue;
      const d = Math.sqrt(d2);
      if (l.ceiling && d <= l.max) continue;
      const target = l.max < Infinity && d > l.max ? l.max : l.rest;
      const err = (d - target) / d;
      const sum = a.im + b.im;
      if (sum <= 0) continue;
      const k = l.stiff * err / sum;
      a.p.x += dx * k * a.im; a.p.y += dy * k * a.im; a.p.z += dz * k * a.im;
      b.p.x -= dx * k * b.im; b.p.y -= dy * k * b.im; b.p.z -= dz * k * b.im;
      if (l.ceiling) {
        /* A joint limit solved against a floor has to be solved IN the floor, or
         * the two fight and the arm wins by bending the wrong way: straightening
         * a pressed limb is exactly what the deck asks it to do. Pushing back up
         * here costs a little penetration elsewhere in the iteration and buys a
         * knee that points the way knees point. */
        const fy = this.ground.y;
        if (a.p.y < fy + a.r) a.p.y = fy + a.r;
        if (b.p.y < fy + b.r) b.p.y = fy + b.r;
      }
    }
  }

  private solvePins() {
    for (const pin of this.pins) {
      const q = this.parts[pin.i];
      const k = Math.min(0.5, pin.k);
      const dx = (pin.t.x - q.p.x) * k;
      const dy = (pin.t.y - q.p.y) * k;
      const dz = (pin.t.z - q.p.z) * k;
      q.p.x += dx; q.p.y += dy; q.p.z += dz;
      /* A hand that is held somewhere is held by an ARM: moving only the hand
       * asks the wrist to span the difference, and the link solver answers by
       * dragging the target back. Carrying part of the correction up the chain
       * is what turns it into a reach. The parent index is the joint that
       * drives this one, found once at build time. */
      const up = this.parentOf[pin.i];
      if (up >= 0) {
        const u = this.parts[up];
        u.p.x += dx * 0.45; u.p.y += dy * 0.45; u.p.z += dz * 0.45;
      }
    }
  }

  private solveGround(friction: number, restitution: number, report: boolean) {
    const gy = this.ground.y;
    for (const q of this.parts) {
      const floor = gy + q.r;
      if (q.p.y >= floor) { q.grounded = false; continue; }
      const vy = q.p.y - q.prev.y;
      const wasAir = !q.grounded;
      /* Position first, then the velocity it implies. Three ways to do a
       * contact and each of them alone is wrong: no positional correction and
       * the part sinks through; no velocity response and it vibrates on the
       * floor; no friction and a tackled man skates until the sim is stopped. */
      q.p.y = floor;
      if (vy < 0) q.prev.y = q.p.y + vy * (wasAir ? restitution : 0);
      /* Coulomb, not damping. Scaling the tangential velocity by a factor every
       * substep is the shortcut most hand-rolled ragdolls take, and it shows:
       * a body stops in two frames on any ground above a sticky setting, so mud
       * and firm grass differ by nothing a viewer can see. Friction that actually
       * slides a man is a fixed loss per unit time — mu times the normal impulse,
       * which for a body resting on the deck is gravity times the step. It is
       * then independent of mass, and the ground's own number means something. */
      /* Both terms are per-substep DISPLACEMENTS: `tl` is v*h and the loss is
       * mu*g*h^2. Getting that squared wrong is a two-substep stop on any
       * setting, which is indistinguishable from the ground not mattering. */
      const loss = friction * G * STEP * STEP * (wasAir ? 3.5 : 1);
      const tx = q.p.x - q.prev.x;
      const tz = q.p.z - q.prev.z;
      const tl = Math.hypot(tx, tz);
      if (tl > 1e-9) {
        const k = Math.max(0, tl - loss) / tl;
        q.prev.x = q.p.x - tx * k;
        q.prev.z = q.p.z - tz * k;
      }
      q.grounded = true;
      if (report && wasAir) {
        const speed = -vy / STEP;
        if (speed > 1.1 && this.t - q.lastHit > 0.1) {
          q.lastHit = this.t;
          this.contacts.push({ x: q.p.x, z: q.p.z, force: Math.min(1.6, speed / 5.0) });
        }
      }
    }
  }

  /** Keep the fall centred on the man the simulation is actually moving. */
  private reelIn() {
    const pv = this.parts[0];
    const dx = pv.p.x - this.anchor.x, dz = pv.p.z - this.anchor.z;
    const d = Math.hypot(dx, dz);
    const over = d - MAX_DRIFT;
    if (over <= 0) return;
    /* Eased, not clamped. A hard clamp is a wall: two men on different grounds
     * stop at exactly the same distance and the pitch state becomes a lie. Take
     * it up over the last stretch of the allowance instead — the body decelerates
     * into the limit, and the limit still means the solver can never walk away
     * from where the engine says he is. */
    const pull = Math.min(1, over / 0.45) * 0.30;
    for (const q of this.parts) {
      q.p.x -= dx * pull; q.p.z -= dz * pull;
      q.prev.x -= dx * pull; q.prev.z -= dz * pull;
    }
  }

  /** Drain the turf-hit report (worn pitch, dust puffs). */
  takeContacts(): { x: number; z: number; force: number }[] {
    if (!this.contacts.length) return this.contacts;
    const out = this.contacts.slice();
    this.contacts.length = 0;
    return out;
  }

  /** Read a joint's simulated position, in the rig's own metres. */
  pos(jointName: string): { x: number; y: number; z: number } | null {
    const i = this.index.get(jointName);
    if (i === undefined) return null;
    const q = this.parts[i];
    return { x: q.p.x, y: q.p.y, z: q.p.z };
  }

  /** How far the pelvis has fallen from where the tackle started it. */
  get dropY(): number { return this.parts[0].p.y - this.seedPelvisY; }

  /** How far the body has slid away from where the engine put it, in the same
   *  metres. The view folds this into the root's position, clamped, which is
   *  what makes a slide on firm grass VISIBLE: the solver alone would only ever
   *  move the man's limbs, not the man. */
  get drift(): { x: number; z: number } {
    return { x: this.parts[0].p.x - this.anchor.x, z: this.parts[0].p.z - this.anchor.z };
  }

  /** Mean joint speed, m/s — the number the tests watch, and the one a caller
   *  can use to fade the clip back in as the body calms. */
  get speed(): number {
    let e = 0;
    for (const q of this.parts) e += q.p.distanceToSquared(q.prev) * q.im;
    return Math.sqrt(Math.max(0, e) / Math.max(1, this.parts.length)) / STEP;
  }

  /**
   * Repulsion plus momentum exchange against another man's fall.
   *
   * Two ragdolls solved independently pass through each other on the deck,
   * which is the tell that gives the whole trick away: a tackle is two bodies
   * that cannot occupy the same ground. Three spheres each — pelvis, chest,
   * head — is nine distance checks and buys the pair the one thing a clip cannot
   * fake, which is that the tackler's weight actually holds the carrier up.
   */
  static contact(a: Ragdoll, b: Ragdoll, restitution = 0.16) {
    const trio = [0, 3, 5];
    for (const ia of trio) {
      const pa = a.parts[ia];
      if (!pa?.bone) continue;
      for (const ib of trio) {
        const pb = b.parts[ib];
        if (!pb?.bone) continue;
        const rsum = pa.r + pb.r + 0.055;
        let dx = pb.p.x - pa.p.x, dy = pb.p.y - pa.p.y, dz = pb.p.z - pa.p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > rsum * rsum || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const sum = pa.im + pb.im;
        if (sum <= 0) continue;
        const push = (rsum - d) / d * 0.75;
        pa.p.x -= dx * push * (pa.im / sum); pa.p.y -= dy * push * (pa.im / sum); pa.p.z -= dz * push * (pa.im / sum);
        pb.p.x += dx * push * (pb.im / sum); pb.p.y += dy * push * (pb.im / sum); pb.p.z += dz * push * (pb.im / sum);
        /* Exchange the closing velocity along the axis, mass weighted. */
        const vax = pa.p.x - pa.prev.x, vay = pa.p.y - pa.prev.y, vaz = pa.p.z - pa.prev.z;
        const vbx = pb.p.x - pb.prev.x, vby = pb.p.y - pb.prev.y, vbz = pb.p.z - pb.prev.z;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const rel = (vbx - vax) * nx + (vby - vay) * ny + (vbz - vaz) * nz;
        if (rel >= 0) continue;
        const j = rel * (1 + restitution) / sum * 0.5;
        pa.prev.x -= nx * j * pa.im; pa.prev.y -= ny * j * pa.im; pa.prev.z -= nz * j * pa.im;
        pb.prev.x += nx * j * pb.im; pb.prev.y += ny * j * pb.im; pb.prev.z += nz * j * pb.im;
        void 0;
      }
    }
  }

  /**
   * Write the solved pose into the skeleton. Always AFTER `mixer.update()`:
   * the mixer overwrites every bone it animates, so a rotation written before it
   * is erased on the frame it is made — the same rule the procedural latch obeys,
   * and why this is a post-process on the pose rather than a second animator.
   */
  apply() {
    if (this.weight <= 0.003) return;
    const w = Math.min(1, this.weight);
    /* A bone's quaternion is relative to its parent, and this walks the skeleton
     * from the pelvis outward — so every bone after the first needs the one above
     * it to ALREADY be carrying the rotation just written into it. The renderer
     * refreshes the tree at draw time, which is one frame too late: solved
     * against a stale parent frame, a limb's drawn direction is off by whatever
     * the man above it turned last frame, and an off-by-one-frame arm is what a
     * "cheap" ragdoll looks like. Two matrix multiplies per bone is the price. */
    this.root.updateMatrix();
    this.root.updateWorldMatrix(false, false);
    for (const qi of this.byDepth) {
      const q = this.parts[qi];
      const bone = q.bone;
      if (!bone || !bone.parent || !q.driveTo.length) continue;
      /* Aim at this bone's PRIMARY child — the continuation of its own chain —
       * and at nothing else. Averaging every child looks reasonable and is
       * wrong: the pelvis carries the spine and both legs, so an averaged pelvis
       * points its spine at a spot between the hips, which is how a solved body
       * ends up lying down in the solver while the mesh is still sitting up. The
       * other children are not lost — they hang off this bone's rotation through
       * the hierarchy and aim at their own children below. */
      const lead = q.driveTo[0];
      this.s1.copy(lead.p).sub(q.p);
      if (this.s1.lengthSq() < 1e-8) continue;
      this.s1.normalize();
      /* Only the PARENT's frame is read from the scene graph, and never this
       * bone's own world matrix. Reading it is the usual way to do this, and it
       * makes a feedback loop out of a pose: the rotation written last frame
       * becomes the reference for the rotation written this frame, and a body at
       * rest — where the particles have stopped moving entirely — oscillates at
       * tens of metres per second in the head. The measured version of that bug
       * is in scripts/ragdollcheck.ts. What the animation did this frame is
       * carried in `bone.quaternion`, which the mixer has already written, so
       * the limb keeps its twist and only its direction is overridden. */
      this.q2.setFromRotationMatrix(this.m4.extractRotation(bone.parent.matrixWorld)).invert();
      this.s1.applyQuaternion(this.q2);
      this.s2.set(0, 1, 0).applyQuaternion(bone.quaternion).normalize();
      if (this.s2.lengthSq() < 1e-6) continue;
      this.q3.setFromUnitVectors(this.s2, this.s1);
      this.q1.copy(bone.quaternion).premultiply(this.q3);
      bone.quaternion.slerp(this.q1, w);
      bone.updateMatrix();
      bone.updateWorldMatrix(false, false);
      }
  }

  dispose() {
    this.pins.length = 0;
    for (const q of this.parts) q.bone = null;
    this.parts.length = 0;
    this.links.length = 0;
  }
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  let found: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone;
  });
  return found;
}
