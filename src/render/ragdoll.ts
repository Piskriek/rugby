/**
 * RAGDOLL — a cheap, self-contained verlet ragdoll for the grounded tackle.
 *
 * Why this exists
 * ---------------
 * `ThreePlayerManager` has a rich PROCEDURAL layer (body tilt, arm reach,
 * spine thrash) but it is all *posed*: the man is tilted by a constant and
 * his arms are aimed at a target. It reads as a nicely staged fall, not as a
 * body that has its own momentum, weight and tumbling on the turf. The user
 * asked for real physics at a low cost.
 *
 * A true physics engine (Rapier, Ammo, Cannon, Bullet) would have to be
 * loaded as a new dependency, would run against 30 actors even when 28 are
 * standing, and — the killer — would fight the `AnimationMixer`, because the
 * mixer writes every bone every frame. So this module is instead a tiny
 * constraint solver that owns ONLY the men currently on the ground, and it
 * writes INTO the mixer's pose (after `mixer.update`, like every other
 * override here) rather than instead of it.
 *
 * Model
 * -----
 * The skeleton is a chain of joints (pelvis → spine → neck → head, arms,
 * legs). We capture each joint's local position when the grounding starts,
 * then simulate it as a point mass with:
 *   - gravity (local Y, because the model's up is +Y),
 *   - verlet/damped integration for cheap momentum,
 *   - distance constraints between parent/child joints (bone lengths),
 *   - a floor plane so the body lands and settles on the pitch.
 *
 * Each frame the solved positions are written back into the bones as LOCAL
 * positions, and each bone's +Y axis is aimed along its parent→child joint
 * direction — that is what actually forms the body shape. Weighted writes
 * are what let a settling body blend back into the get-up clip.
 *
 * Cost
 * ----
 * At most two men are ever grounded at once (one tackle pair). That is ~20
 * particles, ~19 distance constraints, ~4 constraint iterations and a few
 * `updateWorldMatrix` calls per ragdoll. The 28 standing players never touch
 * it. It allocates once per grounding (not per frame), so there is no GC
 * churn, and it shares the `RENDER_SCALE`-neutral *local* space so it never
 * fights the 2D engine: the actor root is still the single spatial truth.
 */

import * as THREE from 'three';
import { JOINT_NAMES } from './tackleTrajectory';

export { JOINT_NAMES };

/* ============================ TUNING ============================ */

/** Gravity in model units/s^2. The model is roughly real-human scale. */
const GRAVITY = 9.81;
/** Verlet velocity damping (0..1). Slightly under 1 loses energy so the body
 *  comes to rest instead of jittering forever. */
const DAMPING = 0.94;
/** Constraint relaxation sweeps per frame. 4 is plenty for a 19-bond chain. */
const ITERATIONS = 4;
/** Floor height in model units. The model's feet sit at local y≈0, so a
 *  joint can rest just above that (a body is not a point). */
const FLOOR_Y = 0.055;
/** The highest a joint's origin may be lifted by its body thickness when
 *  projected onto the floor. Kept small — these are joints, not capsules. */
const RADIUS = 0.09;
/** How hard a limb is thrown at the moment of impact, as a fraction of the
 *  player's closing speed. This is what makes an arm or a leg fly loose. */
const IMPACT_JOLT = 0.35;
/** Extra outward spread on the jolt limbs, so it is not a perfectly clean
 *  sine. */
const IMPACT_SPREAD = 0.22;

/* ============================ SCRATCH ============================ */

const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qBone = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _rootInv = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _rootQ = new THREE.Quaternion();

/* ======================= SKELETON SCHEMA ======================= */

/**
 * Which joint each bone points toward, by index into JOINT_NAMES. `-1`
 * means "aim along this joint minus its parent joint" (a terminal bone like
 * Hand/Foot/Head has no child joint; it continues the segment it hangs off).
 */
const DIR_TO = [
  1, 2, 3, 4, 5, -1,          // pelvis, spine_01..03, neck, head
  7, 8, 9, -1,                // clavicle_l, upperarm_l, lowerarm_l, hand_l
  11, 12, 13, -1,             // clavicle_r, upperarm_r, lowerarm_r, hand_r
  15, 16, -1,                 // thigh_l, calf_l, foot_l
  18, 19, -1,                 // thigh_r, calf_r, foot_r
];

/** Parent-child bonds (indices into JOINT_NAMES). */
const BONDS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5],
  [3, 6], [6, 7], [7, 8], [8, 9],
  [3, 10], [10, 11], [11, 12], [12, 13],
  [0, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19],
];

export interface RagdollJoint {
  bone: THREE.Bone | null;
}

/** Deterministic little pseudo-random in [0,1) keyed on a per-ragdoll seed. */
function rand(seed: number, n: number): number {
  const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Verlet point-mass ragdoll for one grounded player. Instantiate it at the
 * moment a tackle reaches its grounding stage; call `step()` every render
 * frame until the player is back on his feet (or grounded again).
 */
export class RagdollSim {
  readonly root: THREE.Object3D;
  private joints: RagdollJoint[] = [];
  private readonly pt: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly bonds: Array<{ a: number; b: number; rest: number }> = [];
  private seed: number;
  /** 0..1 — 1 while the body is fully simulated, decays while it gets up */
  weight = 1;
  /** has been captured (all bones resolved) */
  private ready = false;
  /** frames of near-zero motion — once the body rests it stops paying for it */
  private sleepT = 0;
  private asleep = false;

  constructor(root: THREE.Object3D, seed: number) {
    this.root = root;
    this.seed = seed;
    for (const name of JOINT_NAMES) this.joints.push({ bone: this.findBone(name) });
    if (import.meta.env?.DEV) {
      const missing = this.joints.filter((j) => !j.bone).map((_, i) => JOINT_NAMES[i]);
      if (missing.length) {
        console.warn(`[ragdoll] missing bones (${missing.length}): ${missing.join(', ')} — the fall will be partial`);
      }
    }
  }

  private findBone(name: string): THREE.Bone | null {
    let found: THREE.Bone | null = null;
    this.root.traverse((o) => {
      if (!found && (o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone;
    });
    return found;
  }

  /**
   * Capture the bones' current local pose and build the constraint rest
   * lengths. `speed` (logical m/s) seeds a small impact jolt so loose limbs
   * tumble rather than freeze. `impactAngle` (radians, in the body's local
   * plane) is the direction the tackle is throwing him: the torso leads in
   * that direction while the feet drag behind, which is what makes the
   * whole body tip and fall instead of just dropping in place.
   */
  capture(speed: number, impactAngle = 0) {
    this.root.updateMatrixWorld(true);
    _rootInv.copy(this.root.matrixWorld).invert();
    this.pt.length = 0;
    this.prev.length = 0;
    for (let i = 0; i < this.joints.length; i++) {
      const b = this.joints[i].bone;
      this.pt.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
      if (!b) continue;
      b.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(_rootInv);
      this.pt[i].copy(_v);
      this.prev[i].copy(_v);
    }
    this.bonds.length = 0;
    for (const [a, b] of BONDS) {
      /* never constrain to a particle that has no bone — its position is the
       * origin placeholder, and a rest length measured from that would yank
       * the whole body toward the feet. */
      if (!this.joints[a].bone || !this.joints[b].bone) continue;
      const rest = this.pt[a].distanceTo(this.pt[b]);
      if (rest > 1e-4) this.bonds.push({ a, b, rest });
    }
    /* Impact jolt. The torso leads the fall along the tackle direction (a
     * body does not fold in place — the mass carries forward and the feet
     * drag), the limbs get the loose, asymmetric whip. Torso = indices
     * 0..3 (pelvis/spine), everything past that is a limb. */
    const kick = Math.min(2.2, Math.max(0, speed * IMPACT_JOLT));
    const dirX = Math.sin(impactAngle);
    const dirZ = Math.cos(impactAngle);
    for (let i = 0; i < this.pt.length; i++) {
      if (i <= 3) {
        /* torso: full throw, pelvis slightly ahead of the spine so the body
         * rotates head-first instead of translating as a stiff plank. */
        const lead = i === 0 ? 1 : 0.82;
        _dir.set(dirX * kick * lead, -0.02 * kick, dirZ * kick * lead);
      } else {
        /* limbs: loose whip mostly along the tackle direction, plus the
         * per-ragdoll seed so the left and right limbs do not mirror. */
        const sx = (rand(this.seed, i + 1) - 0.5) * 2;
        const sy = (rand(this.seed, i + 101) - 0.5) * 2;
        const sz = (rand(this.seed, i + 201) - 0.5) * 2;
        const mag = kick * (1 + IMPACT_SPREAD * sx);
        _dir.set(dirX * mag + sx * 0.12, -Math.abs(sy) * mag * 0.3, dirZ * mag + sz * 0.12);
      }
      this.prev[i].copy(this.pt[i]).addScaledVector(_dir, -0.016);
    }
    this.ready = true;
  }

  /** Advance one frame and write the solved pose into the bones. */
  step(dt: number) {
    if (!this.ready || dt <= 0) return;
    /* settled bodies cost nothing: a grounded player holding a ruck pose has no
     * dynamics left, so skip the solver until a fade (get-up) wakes it. */
    if (this.asleep) return;
    const damp = DAMPING;
    const gdt2 = GRAVITY * dt * dt;
    let moved = 0;

    /* integrate (verlet) */
    for (let i = 0; i < this.pt.length; i++) {
      const p = this.pt[i], pe = this.prev[i];
      moved += Math.abs(p.x - pe.x) + Math.abs(p.y - pe.y) + Math.abs(p.z - pe.z);
      const vx = (p.x - pe.x) * damp;
      const vy = (p.y - pe.y) * damp;
      const vz = (p.z - pe.z) * damp;
      pe.copy(p);
      p.x += vx; p.y += vy - gdt2; p.z += vz;
      const floor = FLOOR_Y + RADIUS;
      if (p.y < floor) p.y = floor;
    }

    /* solve distance constraints, then re-project the floor */
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (const { a, b, rest } of this.bonds) {
        _dir.copy(this.pt[b]).sub(this.pt[a]);
        const d = _dir.length();
        if (d < 1e-6) continue;
        const diff = (d - rest) / d * 0.5;
        this.pt[a].addScaledVector(_dir, diff);
        this.pt[b].addScaledVector(_dir, -diff);
      }
      for (const p of this.pt) {
        const floor = FLOOR_Y + RADIUS;
        if (p.y < floor) p.y = floor;
      }
    }

    this.writeBones(dt);

    /* Sleep after ~0.4 s of sub-millimetre motion. The threshold is an
     * aggregate over all joints (so a rest pose reads as still) but not so
     * tight that a jittering constraint solver keeps it awake forever. */
    if (moved < 0.02) {
      this.sleepT += dt;
      if (this.sleepT > 0.4) this.asleep = true;
    } else {
      this.sleepT = 0;
    }
  }

  private writeBones(dt: number) {
    const w = this.weight;
    if (w <= 0.001) return;
    this.root.updateMatrixWorld(true);

    /* ---- PASS 1 — local translation of every joint. The mixer has already
     * sampled the pose, so `bone.position` at this point is that pose; we
     * blend it toward the solved particle by `w` (full when grounded). The
     * full parent-world inverse (not just rotation) is required: `bone.position`
     * lives in the parent's LOCAL (unscaled) space, while the target is in
     * world space. */
    for (let i = 0; i < this.joints.length; i++) {
      const b = this.joints[i].bone;
      if (!b) continue;
      const parent = b.parent;
      if (!parent) continue;
      parent.updateWorldMatrix(true, false);
      _mat.copy(parent.matrixWorld).invert();
      _p0.copy(this.pt[i]).applyMatrix4(this.root.matrixWorld);
      _p1.copy(_p0).applyMatrix4(_mat);
      b.position.lerp(_p1, w);
      b.updateWorldMatrix(false, false);
    }

    /* ---- PASS 2 — orientation. Aim each bone's local +Y (the Unreal bone
     * convention) toward its solved child joint. Processed parent-first so a
     * child sees its parent's new world frame. The solved joints live in the
     * root's LOCAL frame, so the segment direction is rotated up into world
     * space by the root yaw before it is used as an aim target; otherwise a
     * body facing downfield would aim its limbs a heading off. */
    _rootQ.setFromRotationMatrix(_mat.extractRotation(this.root.matrixWorld));
    for (let i = 0; i < this.joints.length; i++) {
      const b = this.joints[i].bone;
      if (!b || !b.parent) continue;
      const dIdx = DIR_TO[i];
      if (dIdx === -1) {
        /* terminal joint (head/hand/foot): continue the parent segment */
        const parentIdx = this.parentIndex(i);
        if (parentIdx < 0 || !this.joints[parentIdx].bone) continue;
        _dir.copy(this.pt[i]).sub(this.pt[parentIdx]);
      } else {
        /* never aim at a missing joint — its particle is an origin placeholder */
        if (!this.joints[dIdx].bone) continue;
        _dir.copy(this.pt[dIdx]).sub(this.pt[i]);
      }
      if (_dir.lengthSq() < 1e-8) continue;
      _dir.applyQuaternion(_rootQ).normalize();
      b.updateWorldMatrix(true, false);
      /* current world +Y of the bone */
      _v.set(0, 1, 0).applyQuaternion(
        _qb.setFromRotationMatrix(_mat.extractRotation(b.matrixWorld)),
      ).normalize();
      const correction = _q.setFromUnitVectors(_v, _dir);
      const parentWorld = _qb.setFromRotationMatrix(
        _mat.extractRotation(b.parent!.matrixWorld),
      ).invert();
      const boneWorld = _qBone.setFromRotationMatrix(
        _mat.extractRotation(b.matrixWorld),
      );
      const wanted = parentWorld.multiply(correction).multiply(boneWorld);
      b.quaternion.slerp(wanted, w);
      b.updateWorldMatrix(true, false);
    }

    /* dt is passed through so a call site can drive the solver with the same
     * real-time step it uses everywhere else; it is intentionally read only
     * for the gravity term in `step()`. */
    void dt;
  }

  private parentIndex(i: number): number {
    for (const [a, b] of BONDS) if (b === i) return a;
    return -1;
  }

  /** Fade the ragdoll out (called once the player starts getting up). */
  cool(step: number, minutes = 0.16) {
    this.weight = Math.max(0, this.weight - step / minutes);
    this.asleep = false;
    this.sleepT = 0;
  }
}
