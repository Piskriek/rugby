/**
 * RAGDOLL TYPES — the data contract for the active-ragdoll skeleton.
 *
 * Everything the physics rig, the PD-motor controller and the visual sync
 * layer need, in one place, with NO dependency on Rapier or three.js so the
 * layout and the motor maths can be unit-tested headlessly.
 */

/* ------------------------------------------------------------- names ----- */
export type Side = 'l' | 'r';

/** The 15 rigid segments of the ragdoll (matching the skinned player mesh). */
export type BodyPart =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'upperarm_l' | 'forearm_l' | 'hand_l'
  | 'upperarm_r' | 'forearm_r' | 'hand_r'
  | 'thigh_l' | 'calf_l' | 'foot_l'
  | 'thigh_r' | 'calf_r' | 'foot_r';

/** Mesh bone each segment's visuals attach to (Quaternius rig names). */
export const BODY_BONE: Record<BodyPart, string> = {
  hips: 'pelvis',
  spine: 'spine_01',
  chest: 'spine_03',
  neck: 'neck_01',
  head: 'Head',
  upperarm_l: 'upperarm_l', forearm_l: 'lowerarm_l', hand_l: 'hand_l',
  upperarm_r: 'upperarm_r', forearm_r: 'lowerarm_r', hand_r: 'hand_r',
  thigh_l: 'thigh_l', calf_l: 'calf_l', foot_l: 'foot_l',
  thigh_r: 'thigh_r', calf_r: 'calf_r', foot_r: 'foot_r',
};

/** Bone order for driving the skinned mesh once per frame. */
export const DRIVE_ORDER: BodyPart[] = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperarm_l', 'forearm_l', 'hand_l',
  'upperarm_r', 'forearm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l',
  'thigh_r', 'calf_r', 'foot_r',
];

/* ------------------------------------------------------- collider --------- */
export type ColliderShape = 'capsule' | 'cuboid' | 'ball';

/** A collider authored in the body's LOCAL frame. The skeleton convention of
 *  this rig is that each bone's local +Y points toward its child, so capsules
 *  run along local Y and `offset.y` is the centre's distance along the
 *  toward-child axis. `worldAligned` (feet) means `offset`/extents are given
 *  in WORLD bind axes and the builder rotates the shape into the body frame
 *  so it stays flat on the ground. */
export interface ColliderSpec {
  part: BodyPart;
  shape: ColliderShape;
  /** capsule: {radius (x), halfHeight (y)}; cuboid: half extents x/y/z;
   *  ball: {radius (x)}. */
  size: { x: number; y: number; z?: number };
  /** shape centre relative to the body origin (metres). Local +Y for body
   *  frame colliders; world axes for worldAligned colliders. */
  offset: { x: number; y: number; z: number };
  /** shape axis: 'y' default; 'x' unused legacy field, kept for symmetry. */
  axis?: 'x' | 'y' | 'z';
  /** author offset/size in world bind axes (rotated into the body frame at
   *  build time). Used by the flat feet colliders. */
  worldAligned?: boolean;
  mass?: number;
  friction?: number;
}

/* --------------------------------------------------------- joints --------- */
/** One DOF of a spherical joint (the hip/shoulder ball). */
export type Axis = 'x' | 'y' | 'z';

/** Human angular limits (radians) about the body axes.
 *  +x pitch (bend fwd = +), +y twist, +z abduct/roll. */
export interface AngleLimits {
  min: number;
  max: number;
}

/** Kinematic (pose) + motor (effort) targets for a single joint. */
export interface JointMotorTarget {
  /** target pose as an offset quaternion in the joint's local frame. */
  target: { x: number; y: number; z: number; w: number };
  /** per-axis PD gains + max torque (N·m). */
  x: MotorAxis; y: MotorAxis; z: MotorAxis;
  /** True = drive with full kinematic stiffness (pose dominates). */
  kinematic: boolean;
  /** 0..1 blend: 1 = match pose, 0 = fully loose. */
  strength: number;
  /** axial limit band; null = free rotation on that axis. */
  limits: Partial<Record<Axis, AngleLimits>>;
  /** max torque the joint may ever deliver (T_max per axis). */
  tMax: number;
}

/** PD coefficients for one axis. */
export interface MotorAxis { kp: number; kd: number; }

/** Joint kinds: Spherical (3-DOF ball, e.g. hip/shoulder) and Revolute
 *  (1-DOF hinge, e.g. elbow/knee) with their human limits. */
export type JointKind = 'spherical' | 'revolute';
export type JointName =
  | 'hips_spine' | 'spine_chest' | 'chest_neck' | 'neck_head'
  | 'shoulder_l' | 'elbow_l' | 'wrist_l'
  | 'shoulder_r' | 'elbow_r' | 'wrist_r'
  | 'hip_l' | 'knee_l'
  | 'hip_r' | 'knee_r';

export interface JointSpec {
  name: JointName;
  kind: JointKind;
  /** parent segment (toward the root) and child segment. */
  parent: BodyPart;
  child: BodyPart;
  /** anchor in model units relative to the CHILD body's origin (usually the
   *  joint's world position, which is where the two colliders should meet). */
  anchorWorld: { x: number; y: number; z: number };
  /** hinge axis for revolute joints (elbow/knee) in model frame. */
  axis?: { x: number; y: number; z: number };
  /** human angular limits (radians). For spherical: about the joint's local
   *  axes; for revolute: along the hinge. */
  limits: Partial<Record<Axis, AngleLimits>> | { hinge: AngleLimits };
  /** default PD motor gains (per-axis for spherical). */
  motor: JointMotorTarget;
}

/* ------------------------------------------------------- world/motion ----- */
export interface PoseQuat { x: number; y: number; z: number; w: number }
export interface Vec3 { x: number; y: number; z: number }

export type DriveMode = 'kinematic' | 'active' | 'loose';

/** Input pose from an animation clip, one rotation per driven bone. */
export interface PoseInput {
  mode: DriveMode;
  time: number;
  /** rotations in the bone's local frame (world axis deltas). */
  bones: Partial<Record<BodyPart, PoseQuat>>;
  /** 0..1 master drive-strength for this pose (1 = full pose match). */
  strength?: number;
  /** root (hips) world transform if provided. */
  root?: { pos: Vec3; quat: PoseQuat };
}

/** Runtime snapshot of one motor joint after the physics step. */
export interface RagdollStats {
  /** internal + external torque actually applied this frame, per joint. */
  torqueApplied: number;
  /** total motor effort used (0..1 of T_max budget). */
  effort: number;
  /** whether any axis hit its torque ceiling. */
  overpowered: boolean;
}
