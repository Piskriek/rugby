/**
 * SKELETON — the fixed 15-collider rugby-player layout and its joint chain.
 *
 * Authored against the ACTUAL skinned mesh (rugby_player.glb, Quaternius
 * Universal Base Character rig — an UNREAL-style skeleton). Bind pose is an
 * upright stance. Measured from the GLB (world = model units, metres):
 *
 *   root(0,0,0) → pelvis(0,0.949,-0.043) → spine_01(1.072) → spine_02(1.178)
 *     → spine_03(1.311) → neck_01(1.520) → Head(1.600)
 *   arms at y 1.455: upperarm(±0.212) → lowerarm(±0.463) → hand(±0.706)
 *   legs: thigh(±0.114, 0.971) → calf(±0.114, 0.542) → foot(±0.114, 0.086)
 *     → ball(±0.114, 0.015, +0.055 fwd)     ← the ball/toe rests on y≈0
 *
 * Rig convention discovered from the bind quaternions: EVERY bone's local +Y
 * points toward its child bone (root→pelvis is +Z, the Unreal root twist).
 * Colliders are therefore authored as capsules along the local toward-child
 * axis, which the builder derives from the bind table.
 *
 * PUPPET-MASTER layout (per the balance-architecture pivot): the ankle joints
 * are REMOVED. Each foot is a rigidly fused pad collider on the calf body
 * (FOOT_PADS below, authored in the calf's local frame), so the character
 * cannot dorsi/plantarflex — an articulated ankle was an unstable control
 * loop in this discrete sim (see session notes). Upright stabilisation is
 * delegated to the WORLD-SPACE balance controller (balance.ts), which torques
 * the hips and chest to keep the centre of mass over the fused foot pads.
 *
 * Joints: Spherical ball joints for the torso, shoulders and hips with human
 * angular limits; Revolute (hinge) joints for elbows (flexion 0..150°) and
 * knees (0..~145°). PD gains are inertia-sized in motor.ts (Kp = I_eff·ωn²,
 * ωn ≈ 15 rad/s torso / 25 rad/s limbs). Hips/leg masses are raised so the
 * centre of mass sits low (hips 19 kg, thighs 10 kg each).
 */
import type {
  BodyPart, ColliderSpec, JointName, JointSpec, Side, Axis,
} from './types';

export const R = Math.PI / 180;
export const r = (d: number) => d * R;

/** Model unit scale: bind units are metres (pelvis at y 0.949, head 1.60). */
export const MESH_SCALE = 1;

/** Total body mass (kg). */
export const TOTAL_MASS = 75;

/* ------------------------------------------------------------ bind ------- */
/** World-space bind transform of each ragdoll body's mapped visual bone,
 *  measured from the GLB. Positions in metres; quats (x,y,z,w). */
export const BIND: Record<
  BodyPart,
  { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }
> = {
  hips:       { p: { x: 0.000, y: 0.949, z: -0.043 }, q: { x: 0.142, y: 0.000, z: 0.000, w: 0.990 } },
  spine:      { p: { x: 0.000, y: 1.072, z: -0.007 }, q: { x: 0.051, y: 0.000, z: 0.000, w: 0.999 } },
  chest:      { p: { x: 0.000, y: 1.311, z: 0.007 },  q: { x: -0.113, y: 0.000, z: 0.000, w: 0.994 } },
  neck:       { p: { x: 0.000, y: 1.520, z: -0.041 }, q: { x: 0.146, y: 0.000, z: 0.000, w: 0.989 } },
  head:       { p: { x: 0.000, y: 1.600, z: -0.017 }, q: { x: 0.014, y: 0.000, z: 0.000, w: 1.000 } },
  upperarm_l: { p: { x: 0.212, y: 1.455, z: -0.065 }, q: { x: -0.011, y: 0.011, z: -0.707, w: 0.707 } },
  forearm_l:  { p: { x: 0.463, y: 1.455, z: -0.073 }, q: { x: 0.011, y: -0.011, z: -0.707, w: 0.707 } },
  hand_l:     { p: { x: 0.706, y: 1.455, z: -0.065 }, q: { x: 0.000, y: 0.000, z: -0.707, w: 0.707 } },
  upperarm_r: { p: { x: -0.212, y: 1.455, z: -0.065 }, q: { x: -0.011, y: -0.011, z: 0.707, w: 0.707 } },
  forearm_r:  { p: { x: -0.463, y: 1.455, z: -0.073 }, q: { x: 0.011, y: 0.011, z: 0.707, w: 0.707 } },
  hand_r:     { p: { x: -0.706, y: 1.455, z: -0.065 }, q: { x: 0.000, y: 0.000, z: 0.707, w: 0.707 } },
  thigh_l:    { p: { x: 0.114, y: 0.971, z: -0.036 }, q: { x: 1.000, y: 0.000, z: 0.000, w: 0.000 } },
  calf_l:     { p: { x: 0.114, y: 0.542, z: -0.036 }, q: { x: 0.998, y: 0.000, z: 0.000, w: -0.056 } },
  foot_l:     { p: { x: 0.114, y: 0.086, z: -0.088 }, q: { x: 0, y: 0, z: 0, w: 1 } },
  thigh_r:    { p: { x: -0.114, y: 0.971, z: -0.036 }, q: { x: 1.000, y: 0.000, z: 0.000, w: 0.000 } },
  calf_r:     { p: { x: -0.114, y: 0.542, z: -0.036 }, q: { x: 0.998, y: 0.000, z: 0.000, w: -0.056 } },
  foot_r:     { p: { x: -0.114, y: 0.086, z: -0.088 }, q: { x: 0, y: 0, z: 0, w: 1 } },
};

/* ------------------------------------------------- colliders (per body) -- */
/** 15 segments authored in each body's LOCAL frame. Capsules run along the
 *  body's local +Y (the toward-child axis, per the rig convention); extents:
 *  x = radius, y = half-length. Feet (`worldAligned`) sit flat on the ground
 *  in world axes (offset + half extents in metres from the ankle). */
export const COLLIDERS: ColliderSpec[] = [
  // torso chain — capsule centre placed between the two adjacent anchors
  { part: 'hips',  shape: 'cuboid',  size: { x: 0.16, y: 0.13, z: 0.11 }, offset: { x: 0, y: -0.02, z: 0 }, mass: 19 },
  { part: 'spine', shape: 'capsule', size: { x: 0.11, y: 0.16, z: 0 },    offset: { x: 0, y: 0.03, z: 0 },  mass: 5 },
  { part: 'chest', shape: 'capsule', size: { x: 0.13, y: 0.13, z: 0 },    offset: { x: 0, y: -0.005, z: 0 }, mass: 11 },
  { part: 'neck',  shape: 'capsule', size: { x: 0.055, y: 0.05, z: 0 },   offset: { x: 0, y: 0.03, z: 0 },  mass: 1 },
  { part: 'head',  shape: 'ball',    size: { x: 0.115, y: 0, z: 0 },      offset: { x: 0, y: 0.03, z: 0 },  mass: 4.6 },
  // arms — local +Y of upperarm/lowerarm/hand points OUTWARD (+X for the
  // left arm, −X for the right), so positive y-offsets reach the joint.
  { part: 'upperarm_l', shape: 'capsule', size: { x: 0.075, y: 0.126, z: 0 }, offset: { x: 0, y: 0.126, z: 0 }, mass: 2.2 },
  { part: 'forearm_l',  shape: 'capsule', size: { x: 0.062, y: 0.122, z: 0 }, offset: { x: 0, y: 0.122, z: 0 }, mass: 1.6 },
  { part: 'hand_l',     shape: 'ball',    size: { x: 0.065, y: 0, z: 0 },     offset: { x: 0, y: 0.03, z: 0 },  mass: 0.5 },
  { part: 'upperarm_r', shape: 'capsule', size: { x: 0.075, y: 0.126, z: 0 }, offset: { x: 0, y: 0.126, z: 0 }, mass: 2.2 },
  { part: 'forearm_r',  shape: 'capsule', size: { x: 0.062, y: 0.122, z: 0 }, offset: { x: 0, y: 0.122, z: 0 }, mass: 1.6 },
  { part: 'hand_r',     shape: 'ball',    size: { x: 0.065, y: 0, z: 0 },     offset: { x: 0, y: 0.03, z: 0 },  mass: 0.5 },
  // legs — local +Y of thigh/calf points DOWN the leg (toward the knee/foot).
  // Thighs carry 10 kg each (low-COM tuning); the foot pads below are fused
  // onto the calf bodies, so no foot rigid body exists.
  { part: 'thigh_l', shape: 'capsule', size: { x: 0.085, y: 0.214, z: 0 }, offset: { x: 0, y: 0.214, z: 0 }, mass: 10 },
  { part: 'calf_l',  shape: 'capsule', size: { x: 0.068, y: 0.228, z: 0 }, offset: { x: 0, y: 0.228, z: 0 }, mass: 3.9 },
  { part: 'thigh_r', shape: 'capsule', size: { x: 0.085, y: 0.214, z: 0 }, offset: { x: 0, y: 0.214, z: 0 }, mass: 10 },
  { part: 'calf_r',  shape: 'capsule', size: { x: 0.068, y: 0.228, z: 0 }, offset: { x: 0, y: 0.228, z: 0 }, mass: 3.9 },
];

/* ---------------------------------------------------- fused foot pads ---- */
/** The feet are a STATIC extension of the calf bodies (no ankle joint): a
 *  cuboid pad fused at the bind ankle angle. Values below are authored in the
 *  CALF's local frame and were computed from the bind table so that at bind
 *  the pad lies flat with its sole on the ground (y = 0) and its centre at
 *  (±0.114, 0.043, −0.043) world. `rotLocal` is conj(calf bind q), making the
 *  collider world-aligned (flat) whenever the calf is at its bind rotation. */
export interface FootPadSpec {
  part: 'calf_l' | 'calf_r';
  /** cuboid half-extents (m). */
  size: { x: number; y: number; z: number };
  /** pad centre in the calf body's local frame (m). */
  centerLocal: { x: number; y: number; z: number };
  /** pad rotation in the calf body's local frame. */
  rotLocal: { x: number; y: number; z: number; w: number };
  mass: number;
  friction: number;
}
export const FOOT_PADS: FootPadSpec[] = [
  { part: 'calf_l', size: { x: 0.030, y: 0.043, z: 0.075 },
    centerLocal: { x: 0, y: 0.4962, z: -0.0488 },
    rotLocal: { x: -0.998, y: 0, z: 0, w: -0.056 },
    mass: 2.4, friction: 1.6 },
  { part: 'calf_r', size: { x: 0.030, y: 0.043, z: 0.075 },
    centerLocal: { x: 0, y: 0.4962, z: -0.0488 },
    rotLocal: { x: -0.998, y: 0, z: 0, w: -0.056 },
    mass: 2.4, friction: 1.6 },
];

/* -------------------------------------------------------- joints --------- */
/** World-space joint anchors (bind), metres. Midpoints between the two
 *  colliding bones or the child bone origin where the segments meet. */
const A = {
  hips:   { x: 0.000, y: 1.005, z: -0.025 }, // pelvis→spine_01 mid
  spine:  { x: 0.000, y: 1.192, z: 0.000 },  // spine_01→spine_03 mid
  chest:  { x: 0.000, y: 1.416, z: -0.017 }, // spine_03→neck mid
  neck:   { x: 0.000, y: 1.560, z: -0.029 }, // neck→Head mid
  shoulderL: { x: 0.212, y: 1.455, z: -0.065 }, // = upperarm_l origin
  elbowL:    { x: 0.463, y: 1.455, z: -0.073 }, // = lowerarm_l origin
  wristL:    { x: 0.706, y: 1.455, z: -0.065 }, // = hand_l origin
  shoulderR: { x: -0.212, y: 1.455, z: -0.065 },
  elbowR:    { x: -0.463, y: 1.455, z: -0.073 },
  wristR:    { x: -0.706, y: 1.455, z: -0.065 },
  hipL:      { x: 0.114, y: 0.971, z: -0.036 },  // = thigh_l origin
  kneeL:     { x: 0.114, y: 0.542, z: -0.036 },  // = calf_l origin
  ankleL:    { x: 0.114, y: 0.086, z: -0.088 },  // = foot_l origin
  hipR:      { x: -0.114, y: 0.971, z: -0.036 },
  kneeR:     { x: -0.114, y: 0.542, z: -0.036 },
  ankleR:    { x: -0.114, y: 0.086, z: -0.088 },
} as const;

/**
 * Torque ceilings (T_max) per joint — human strength scaled to this rig
 * (~73 kg, real adult mass). The PD gains themselves are NOT authored here:
 * motor.ts sizes Kp/Kd from the actual segment inertias and these ceilings
 * (see the gain-sizing notes there), so the values below only set the yield
 * point: below T_max the joint tracks its pose, above it the joint yields
 * (active-ragdoll overpowered collapse). Wrists carry strength 0.15 (weak
 * hands) and all joints are otherwise full-strength.
 */
const G = {
  strong: { kp: 540, kd: 108 },  // torso, hips
  mid: { kp: 360, kd: 85 },      // shoulders
  soft: { kp: 192, kd: 53 },     // neck / elbows
};

function ball(
  gains: { kp: number; kd: number }, tMax: number,
  limits: Partial<Record<Axis, { min: number; max: number }>>,
  strength = 1,
) {
  return {
    target: { x: 0, y: 0, z: 0, w: 1 },
    x: gains, y: gains, z: gains,
    kinematic: false, strength, limits, tMax,
  };
}
function hinge(gain: { kp: number; kd: number }, tMax: number, min: number, max: number, strength = 1) {
  return {
    target: { x: 0, y: 0, z: 0, w: 1 },
    x: gain, y: { kp: 0, kd: 0 }, z: { kp: 0, kd: 0 },
    kinematic: false, strength,
    limits: { x: { min, max } }, tMax,
  };
}

export const JOINTS: JointSpec[] = [
  { name: 'hips_spine', kind: 'spherical', parent: 'hips', child: 'spine', anchorWorld: A.hips,
    limits: { x: { min: r(-30), max: r(45) }, y: { min: r(-15), max: r(15) }, z: { min: r(-12), max: r(12) } },
    motor: ball(G.strong, 150, { x: { min: r(-30), max: r(45) }, y: { min: r(-15), max: r(15) }, z: { min: r(-12), max: r(12) } }) },
  { name: 'spine_chest', kind: 'spherical', parent: 'spine', child: 'chest', anchorWorld: A.spine,
    limits: { x: { min: r(-25), max: r(40) }, y: { min: r(-15), max: r(15) }, z: { min: r(-12), max: r(12) } },
    motor: ball(G.strong, 150, { x: { min: r(-25), max: r(40) }, y: { min: r(-15), max: r(15) }, z: { min: r(-12), max: r(12) } }) },
  { name: 'chest_neck', kind: 'spherical', parent: 'chest', child: 'neck', anchorWorld: A.chest,
    limits: { x: { min: r(-40), max: r(50) }, y: { min: r(-30), max: r(30) }, z: { min: r(-20), max: r(20) } },
    motor: ball(G.mid, 55, { x: { min: r(-40), max: r(50) }, y: { min: r(-30), max: r(30) }, z: { min: r(-20), max: r(20) } }) },
  { name: 'neck_head', kind: 'spherical', parent: 'neck', child: 'head', anchorWorld: A.neck,
    limits: { x: { min: r(-30), max: r(45) }, y: { min: r(-60), max: r(60) }, z: { min: r(-25), max: r(25) } },
    motor: ball(G.soft, 28, { x: { min: r(-30), max: r(45) }, y: { min: r(-60), max: r(60) }, z: { min: r(-25), max: r(25) } }) },
  // arms: spherical shoulder (cone) + revolute elbow hinge (axis X: the arm's
  // local toward-child axis is +Y so the elbow flexion axis is local Z; the
  // builder maps it from the world bind frame, see HINGE_AXIS below).
  { name: 'shoulder_l', kind: 'spherical', parent: 'chest', child: 'upperarm_l', anchorWorld: A.shoulderL,
    limits: { x: { min: r(-70), max: r(150) }, y: { min: r(-75), max: r(75) }, z: { min: r(-45), max: r(120) } },
    motor: ball(G.mid, 80, { x: { min: r(-70), max: r(150) }, y: { min: r(-75), max: r(75) }, z: { min: r(-45), max: r(120) } }) },
  { name: 'elbow_l', kind: 'revolute', parent: 'upperarm_l', child: 'forearm_l', anchorWorld: A.elbowL,
    axis: { x: 0, y: 0, z: -1 }, limits: { hinge: { min: r(0), max: r(150) } },
    motor: hinge(G.soft, 40, r(0), r(150)) },
  { name: 'shoulder_r', kind: 'spherical', parent: 'chest', child: 'upperarm_r', anchorWorld: A.shoulderR,
    limits: { x: { min: r(-70), max: r(150) }, y: { min: r(-75), max: r(75) }, z: { min: r(-120), max: r(45) } },
    motor: ball(G.mid, 80, { x: { min: r(-70), max: r(150) }, y: { min: r(-75), max: r(75) }, z: { min: r(-120), max: r(45) } }) },
  { name: 'elbow_r', kind: 'revolute', parent: 'upperarm_r', child: 'forearm_r', anchorWorld: A.elbowR,
    axis: { x: 0, y: 0, z: 1 }, limits: { hinge: { min: r(0), max: r(150) } },
    motor: hinge(G.soft, 40, r(0), r(150)) },
  // wrists: ball joints with small cones (hands)
  { name: 'wrist_l', kind: 'spherical', parent: 'forearm_l', child: 'hand_l', anchorWorld: A.wristL,
    limits: { x: { min: r(-60), max: r(70) }, y: { min: r(-30), max: r(30) }, z: { min: r(-30), max: r(30) } },
    motor: ball(G.soft, 14, { x: { min: r(-60), max: r(70) }, y: { min: r(-30), max: r(30) }, z: { min: r(-30), max: r(30) } }, 0.15) },
  { name: 'wrist_r', kind: 'spherical', parent: 'forearm_r', child: 'hand_r', anchorWorld: A.wristR,
    limits: { x: { min: r(-60), max: r(70) }, y: { min: r(-30), max: r(30) }, z: { min: r(-30), max: r(30) } },
    motor: ball(G.soft, 14, { x: { min: r(-60), max: r(70) }, y: { min: r(-30), max: r(30) }, z: { min: r(-30), max: r(30) } }, 0.15) },
  // legs: spherical hip + revolute knee (hinge = world X, the lateral axis)
  { name: 'hip_l', kind: 'spherical', parent: 'hips', child: 'thigh_l', anchorWorld: A.hipL,
    limits: { x: { min: r(-40), max: r(100) }, y: { min: r(-30), max: r(30) }, z: { min: r(-15), max: r(45) } },
    motor: ball(G.strong, 150, { x: { min: r(-40), max: r(100) }, y: { min: r(-30), max: r(30) }, z: { min: r(-15), max: r(45) } }) },
  { name: 'knee_l', kind: 'revolute', parent: 'thigh_l', child: 'calf_l', anchorWorld: A.kneeL,
    axis: { x: -1, y: 0, z: 0 }, limits: { hinge: { min: r(0), max: r(145) } },
    motor: hinge(G.strong, 140, r(0), r(145)) },
  { name: 'hip_r', kind: 'spherical', parent: 'hips', child: 'thigh_r', anchorWorld: A.hipR,
    limits: { x: { min: r(-40), max: r(100) }, y: { min: r(-30), max: r(30) }, z: { min: r(-45), max: r(15) } },
    motor: ball(G.strong, 150, { x: { min: r(-40), max: r(100) }, y: { min: r(-30), max: r(30) }, z: { min: r(-45), max: r(15) } }) },
  { name: 'knee_r', kind: 'revolute', parent: 'thigh_r', child: 'calf_r', anchorWorld: A.kneeR,
    axis: { x: -1, y: 0, z: 0 }, limits: { hinge: { min: r(0), max: r(145) } },
    motor: hinge(G.strong, 140, r(0), r(145)) },
];

export const REVOLUTE: JointName[] = ['elbow_l', 'elbow_r', 'knee_l', 'knee_r'];

/** Ragdoll body → parent ragdoll body (root = hips). */
export const PARENT: Partial<Record<BodyPart, BodyPart>> = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperarm_l: 'chest', forearm_l: 'upperarm_l', hand_l: 'forearm_l',
  upperarm_r: 'chest', forearm_r: 'upperarm_r', hand_r: 'forearm_r',
  thigh_l: 'hips', calf_l: 'thigh_l', foot_l: 'calf_l',
  thigh_r: 'hips', calf_r: 'thigh_r', foot_r: 'calf_r',
};

/** Ragdoll body → its visual bone name in the GLB skeleton. */
export const VISUAL_BONE: Record<BodyPart, string> = {
  hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'Head',
  upperarm_l: 'upperarm_l', forearm_l: 'lowerarm_l', hand_l: 'hand_l',
  upperarm_r: 'upperarm_r', forearm_r: 'lowerarm_r', hand_r: 'hand_r',
  thigh_l: 'thigh_l', calf_l: 'calf_l', foot_l: 'foot_l',
  thigh_r: 'thigh_r', calf_r: 'calf_r', foot_r: 'foot_r',
};

/** Mirror part across the sagittal plane. */
export const MIRROR: Partial<Record<BodyPart, BodyPart>> = {
  upperarm_l: 'upperarm_r', upperarm_r: 'upperarm_l',
  forearm_l: 'forearm_r', forearm_r: 'forearm_l',
  hand_l: 'hand_r', hand_r: 'hand_l',
  thigh_l: 'thigh_r', thigh_r: 'thigh_l',
  calf_l: 'calf_r', calf_r: 'calf_l',
  foot_l: 'foot_r', foot_r: 'foot_l',
};

export function sideOf(p: BodyPart): Side | null {
  return /_(l|r)$/.test(p) ? (p.endsWith('_l') ? 'l' : 'r') : null;
}

/** mass per body part (kg). Feet have no rigid body (fused into the calves
 *  as FOOT_PADS) but keep their pad mass here so the record stays complete;
 *  live-mass consumers should read `body.mass()` instead. */
export const PART_MASS: Record<BodyPart, number> = {
  ...(Object.fromEntries(
    COLLIDERS.map((c) => [c.part, c.mass ?? 1]),
  ) as Record<BodyPart, number>),
  foot_l: FOOT_PADS[0].mass,
  foot_r: FOOT_PADS[1].mass,
};
