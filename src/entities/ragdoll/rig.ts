/**
 * RIG — build the 15-body Ragdoll in a Rapier world (PUPPET-MASTER layout).
 *
 * Every body spawns at the EXACT bind world transform of its visual bone
 * (measured from the GLB — see skeleton.ts BIND), so the physics skeleton
 * coincides with the skinned mesh on frame one. Colliders are authored in
 * each body's local frame along the rig's toward-child (+Y) axis. The feet
 * are fused pads on the calf bodies (FOOT_PADS — no ankle joints, no foot
 * rigid bodies).
 *
 * Joints: Spherical (Generic in this compat build — behaves as a ball joint)
 * for torso/shoulder/hip; Revolute with hard angular limits for elbow/knee.
 * Motor wiring is manual PD torque in motor.ts, so the joint factories here
 * only need correct anchors + axes. Hinge axes are given in world bind frame
 * and mapped into each body's local frame here.
 *
 * Rapier compat build quirks handled here:
 *  - `RigidBodyDesc.setTranslation(x,y,z)` takes three numbers.
 *  - `ColliderDesc.setTranslation(x,y,z)` takes three numbers; its
 *    `setRotation(quat)` takes a {x,y,z,w} object.
 *  - `JointData.spherical(...)` yields a Generic joint (type 6) that still
 *    constrains the two anchors together — verified in the probe.
 */
import RAPIER, {
  type World, type RigidBody, type Collider, type ImpulseJoint,
} from '@dimforge/rapier3d-compat';
import { BIND, COLLIDERS, JOINTS, REVOLUTE, FOOT_PADS, type FootPadSpec } from './skeleton';
import type {
  BodyPart, ColliderSpec, JointName, JointSpec, PoseQuat, Vec3,
} from './types';

/* -------------------------------------------------- small quat math ------ */
const qConj = (q: PoseQuat): PoseQuat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qMul = (a: PoseQuat, b: PoseQuat): PoseQuat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
function rotateVec(q: PoseQuat, v: Vec3): Vec3 {
  const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = qMul(qMul(q, qv), qConj(q));
  return { x: r.x, y: r.y, z: r.z };
}

/* -------------------------------------------------------- interaction ---- */
function packGroups(group: number, mask: number): number {
  return ((group & 0xffff) << 16) | (mask & 0xffff);
}

/**
 * Point a rig's colliders at another rig's bodies (multi-rig contact for
 * tackles). `ownBit` is this rig's membership bit, `alsoBits` the foreign
 * bits its bodies may touch. The ground bit (0) always stays in the mask,
 * so the rig still lands on the pitch.
 *
 * Rigs built by buildRagdollWorld all default to bit 7 with a ground-only
 * mask and therefore never collide with each other — the flailing dive
 * needs one call per side (defender: own 7 / also 8, carrier: own 8 / also
 * 7) so the dive has something to hit.
 */
export function setRagdollGroups(rig: RagdollRig, ownBit: number, alsoBits: number): void {
  const mask = 1 | alsoBits;
  for (const b of rig.bodies) b.collider.setCollisionGroups(packGroups(ownBit, mask));
  for (const pad of rig.pads) pad.collider.setCollisionGroups(packGroups(ownBit, mask));
}

/* ---------------------------------------------------------- the rig ------ */
export interface RagdollBody {
  part: BodyPart;
  body: RigidBody;
  collider: Collider;
  /** world bind transform the body was spawned at. */
  bind: { p: Vec3; q: PoseQuat };
  /** anchor of the joint that connects this body to its parent, in this
   *  body's LOCAL frame (the rotation joint with its parent happens here). */
  parentAnchorLocal: Vec3;
}

export interface RagdollJoint {
  name: JointName;
  spec: JointSpec;
  joint: ImpulseJoint;
  parentPart: BodyPart;
  childPart: BodyPart;
  /** world-bind hinge axis (revolute only, for torque application). */
  hingeAxisWorld: Vec3;
  /** hinge axis in the child body's local bind frame (revolute only). */
  hingeAxisLocal: Vec3;
}

/** A fused foot pad: the cuboid collider rigidly attached to a calf body. */
export interface RagdollPad {
  side: 'l' | 'r';
  calf: RagdollBody;
  collider: Collider;
  spec: FootPadSpec;
}

export interface RagdollRig {
  world: World;
  bodies: RagdollBody[];
  byPart: Map<BodyPart, RagdollBody>;
  joints: RagdollJoint[];
  byName: Map<JointName, RagdollJoint>;
  /** fused foot pads (calf-anchored colliders, no ankle joint). */
  pads: RagdollPad[];
}

export interface RagdollWorldOpts {
  gravityY?: number;
  ground?: boolean;
  groundFriction?: number;
  /** Build into an EXISTING world instead of creating one (multi-rig
   *  scenes — the flailing-dive probe shares one world between defender
   *  and carrier so their colliders can actually meet). The existing
   *  world's timestep / solver settings are left untouched. */
  world?: World;
  /** World offset of the bind pose (multi-rig scenes). */
  x?: number;
  z?: number;
}

/** Build the world, ground and a 15-body ragdoll at the bind pose. */
export function buildRagdollWorld(opts?: RagdollWorldOpts): RagdollRig {
  const world = opts?.world ?? new RAPIER.World({ x: 0, y: opts?.gravityY ?? -9.81, z: 0 });
  if (!opts?.world) {
    world.timestep = 1 / 120;
    world.integrationParameters.numSolverIterations = 12;
    world.integrationParameters.numInternalPgsIterations = 2;

    // ground plate (fixed) — top surface at y = 0
    if (opts?.ground !== false) {
      const groundBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, -3, 0),
      );
      const ground = world.createCollider(
        RAPIER.ColliderDesc.cuboid(12, 3, 12).setFriction(opts?.groundFriction ?? 1.2).setRestitution(0.0),
        groundBody,
      );
      void ground;
    }
  }

  const ox = opts?.x ?? 0;
  const oz = opts?.z ?? 0;

  const bodies: RagdollBody[] = [];
  const byPart = new Map<BodyPart, RagdollBody>();
  const rig = { world, bodies, byPart, joints: [] as RagdollJoint[], byName: new Map(), pads: [] as RagdollPad[] } as RagdollRig;

  for (const c of COLLIDERS) {
    // offset bind so the stored transform equals the real spawn transform
    const bind = { p: { x: BIND[c.part].p.x + ox, y: BIND[c.part].p.y, z: BIND[c.part].p.z + oz }, q: BIND[c.part].q };
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(bind.p.x, bind.p.y, bind.p.z)
        .setRotation({ ...bind.q })
        .setLinearDamping(0.15)
        .setAngularDamping(0.4)
        .setCanSleep(false),
    );
    const collider = world.createCollider(
      colliderDesc(c),
      body,
    );
    // Ragdoll parts collide ONLY with the world (ground). Inter-limb contact
    // is disabled: on an articulated chain, self-collision contacts between
    // overlapping capsules are the main source of numerical pops that pump
    // energy into the skeleton and launch it. The ground collider uses the
    // default group bit 0, so: group = bit 7, filter = bit 0.
    collider.setCollisionGroups(packGroups(1 << 7, 1));
    const rb: RagdollBody = {
      part: c.part, body, collider,
      bind,
      parentAnchorLocal: { x: 0, y: 0, z: 0 },
    };
    bodies.push(rb);
    byPart.set(c.part, rb);
  }

  // ---- fused foot pads (static extension of the calf bodies) ---------------
  // The pad collider is authored in the calf's local frame (FOOT_PADS); it is
  // rigidly attached to the calf body — there is NO ankle joint, so the foot
  // cannot dorsi/plantarflex (see skeleton.ts notes).
  for (const pad of FOOT_PADS) {
    const calf = byPart.get(pad.part)!;
    const desc = RAPIER.ColliderDesc.cuboid(pad.size.x, pad.size.y, pad.size.z)
      .setTranslation(pad.centerLocal.x, pad.centerLocal.y, pad.centerLocal.z)
      .setRotation({ x: pad.rotLocal.x, y: pad.rotLocal.y, z: pad.rotLocal.z, w: pad.rotLocal.w })
      .setFriction(pad.friction)
      .setRestitution(0.0)
      .setMass(pad.mass);
    const collider = world.createCollider(desc, calf.body);
    collider.setCollisionGroups(packGroups(1 << 7, 1));
    rig.pads.push({
      side: pad.part === 'calf_l' ? 'l' : 'r',
      calf, collider, spec: pad,
    });
  }

  // ---- joints -------------------------------------------------------------
  const joints: RagdollJoint[] = [];
  for (const spec of JOINTS) {
    const p = byPart.get(spec.parent)!;
    const ch = byPart.get(spec.child)!;

    // anchors: world bind point → local frame of each body
    const a1 = toLocal(p.bind, spec.anchorWorld);
    const a2 = toLocal(ch.bind, spec.anchorWorld);
    ch.parentAnchorLocal = a2;

    const worldAxis = spec.axis ?? { x: 0, y: 0, z: 1 };
    const data = spec.kind === 'revolute'
      ? RAPIER.JointData.revoluteWithAxes(
          a1, a2,
          rotateVec(qConj(p.bind.q), worldAxis),
          rotateVec(qConj(ch.bind.q), worldAxis),
        )
      : RAPIER.JointData.spherical(a1, a2);

    const joint = world.createImpulseJoint(data, p.body, ch.body, true);
    if (spec.kind === 'revolute') {
      const l = (spec.limits as { hinge: { min: number; max: number } }).hinge;
      (joint as RAPIER.RevoluteImpulseJoint).setLimits(l.min, l.max);
    }
    joints.push({
      name: spec.name, spec, joint,
      parentPart: spec.parent, childPart: spec.child,
      hingeAxisWorld: worldAxis,
      hingeAxisLocal: rotateVec(qConj(ch.bind.q), worldAxis),
    });
  }
  rig.joints = joints;
  for (const j of joints) rig.byName.set(j.name, j);
  return rig;
}

/* ----------------------------------------------------------- helpers ----- */
function colliderDesc(c: ColliderSpec): RAPIER.ColliderDesc {
  let desc: RAPIER.ColliderDesc;
  if (c.shape === 'capsule') {
    desc = RAPIER.ColliderDesc.capsule(c.size.y, c.size.x);
    desc.setTranslation(0, c.offset.y, 0);
  } else if (c.shape === 'ball') {
    desc = RAPIER.ColliderDesc.ball(c.size.x);
    desc.setTranslation(0, c.offset.y, 0);
  } else {
    desc = RAPIER.ColliderDesc.cuboid(c.size.x, c.size.y, c.size.z ?? c.size.x);
    // offset in the body's local frame. Body frames are authored axis-aligned
    // with the world at bind (feet included), so x/y/z apply directly.
    desc.setTranslation(c.offset.x ?? 0, c.offset.y, c.offset.z ?? 0);
  }
  desc.setFriction(c.friction ?? 0.6);
  desc.setRestitution(0.0);
  // segment masses (kg) — without these, density defaults make the colliders
  // weigh grams and the N·m motor torques explode the rig.
  if (c.mass != null) desc.setMass(c.mass);
  return desc;
}

/** world bind point expressed in the local frame of a body spawned at bind. */
function toLocal(bind: { p: Vec3; q: PoseQuat }, world: Vec3): Vec3 {
  return rotateVec(qConj(bind.q), {
    x: world.x - bind.p.x,
    y: world.y - bind.p.y,
    z: world.z - bind.p.z,
  });
}

/** convenience for the playground/probe. */
export function bodyWorld(b: RagdollBody): { p: Vec3; q: PoseQuat } {
  const t = b.body.translation();
  const r = b.body.rotation();
  return { p: { x: t.x, y: t.y, z: t.z }, q: { x: r.x, y: r.y, z: r.z, w: r.w } };
}

/** World-space centre of a fused foot pad (follows its calf body). */
export function padCenterWorld(pad: RagdollPad): Vec3 {
  const t = pad.calf.body.translation();
  const q = pad.calf.body.rotation();
  const c = pad.spec.centerLocal;
  const w = rotateVec({ x: q.x, y: q.y, z: q.z, w: q.w }, c);
  return { x: t.x + w.x, y: t.y + w.y, z: t.z + w.z };
}

/** Midpoint of the two foot-pad centres — the balance support reference. */
export function supportCenter(rig: RagdollRig): Vec3 {
  if (rig.pads.length < 2) return { x: 0, y: 0, z: 0 };
  const a = padCenterWorld(rig.pads[0]);
  const b = padCenterWorld(rig.pads[1]);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export { REVOLUTE };
