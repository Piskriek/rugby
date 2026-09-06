/**
 * POSE MAP — channel values → bone rotations (pure math, no three.js).
 *
 * The 17 recorded channels describe a man relative to a STANDING pose with
 * his arms hanging. They are whole-body or joint ANGLE values measured about
 * the man's own axes — his left/right axis (model X, positive pitch = falls
 * forward) and his forward axis (model Z). To turn a channel into a real bone
 * rotation the joint must rotate about THAT model axis, expressed in the
 * frame of the joint's parent at the moment the fall was captured. That is
 * the whole job of this module, and it is why a per-joint `JointRef` carries
 * `fx` (model X in the parent frame) and `ab` (model Z in the parent frame)
 * alongside the bone's own captured local quaternion `r`.
 *
 * WHY NOT ROTATE IN THE BONE'S OWN LOCAL FRAME?
 * The rig's REST pose is a T-pose: a hanging arm's bone-local X points UP,
 * so a rotation that was meant to swing the arm forward instead rotates it
 * about the world vertical — arms helicoptering or pinning behind the back.
 * Rotating about the model axis in the PARENT frame is immune to whatever
 * twist the bone carries, so a channel value always means what the solver
 * said it means, on any rig.
 *
 * SIGN CONVENTIONS (verified numerically against the rig, tools/labSignProbe)
 * Body faces +Z at rest; +Y up; his right side is −X (bones `*_r` sit at
 * negative X). Limbs hang DOWN from their joints (+Y-down bones):
 *   - flex (shoulder/hip/elbow, sagittal plane)  → rotate about fx by −angle
 *     (a down-hanging limb swings FORWARD under a negative X rotation);
 *   - knee bends the shin BACKWARD → rotate about fx by +angle;
 *   - abduction (coronal plane) → rotate about ab; the sign depends on the
 *     side because a +Z rotation pushes every down-hanging limb toward +X:
 *     right-side limbs abduct under −angle, left-side under +angle;
 *   - spine bend crunches the torso FORWARD (bones point up) → +angle;
 *   - head lags: headX about fx, headY about ab (whiplash signs arrive
 *     pre-negated from the solver).
 */
export interface Quat { w: number; x: number; y: number; z: number }

export const Q_ID: Quat = { w: 1, x: 0, y: 0, z: 0 };

export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qAxisAngle(ax: number, ay: number, az: number, ang: number): Quat {
  const h = ang / 2;
  const s = Math.sin(h);
  const m = Math.hypot(ax, ay, az) || 1;
  return { w: Math.cos(h), x: (ax / m) * s, y: (ay / m) * s, z: (az / m) * s };
}

export const qX = (a: number) => qAxisAngle(1, 0, 0, a);
export const qY = (a: number) => qAxisAngle(0, 1, 0, a);
export const qZ = (a: number) => qAxisAngle(0, 0, 1, a);

/** Inverse (conjugate) of a unit quaternion. */
export function qConj(q: Quat): Quat { return { w: q.w, x: -q.x, y: -q.y, z: -q.z }; }

/** Rotate a unit vector by a quaternion (pure; used to build refs off-rig). */
export function qRotateVec(q: Quat, v: [number, number, number]): [number, number, number] {
  const { w, x, y, z } = q;
  const [vx, vy, vz] = v;
  const ix = w * vx + y * vz - z * vy;
  const iy = w * vy + z * vx - x * vz;
  const iz = w * vz + x * vy - y * vx;
  const iw = -x * vx - y * vy - z * vz;
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** Driven-bone set (Quaternius Unreal rig + Mixamo fallbacks). */
export const DRIVEN = [
  'spine_01', 'spine_02', 'spine_03',
  'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'thigh_r', 'calf_r',
] as const;
export type DrivenBone = typeof DRIVEN[number];

/**
 * Per-joint capture taken at the instant a fall starts (from the pose the
 * man is actually in — standing Idle, or a run cycle in the game):
 *   r  — the bone's local quaternion at capture;
 *   fx — the body's left/right axis (model X), unit, in the PARENT frame;
 *   ab — the body's forward axis (model Z), unit, in the PARENT frame.
 * With a rig aligned to model axes both would be (1,0,0) and (0,0,1); the
 * transform keeps the channel semantics correct for any capture pose.
 */
export interface JointRef { r: Quat; fx: [number, number, number]; ab: [number, number, number] }
export type FallRefs = Partial<Record<DrivenBone, JointRef>>;

/** Channel order mirrors physics/falls.ts CH (indices stable by contract). */
const I = {
  pitch: 0, twistZ: 1, bend: 2, headX: 3, headY: 4,
  armRflex: 5, armRab: 6, armRelbow: 7,
  armLflex: 8, armLab: 9, armLelbow: 10,
  legRflex: 11, legRab: 12, legRknee: 13,
  legLflex: 14, legLab: 15, legLknee: 16,
} as const;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const qA = (axis: [number, number, number], ang: number) => qAxisAngle(axis[0], axis[1], axis[2], ang);

export interface RagPose {
  bones: Partial<Record<DrivenBone, Quat>>;
  pitch: number;
  twist: number;
}

/**
 * Build one pose from an EXPANDED 17-channel sample (mirroring applied).
 * `refs` must cover at least the bones being driven; absent bones are left
 * untouched (undefined in the result).
 */
export function buildPose(ch: number[], refs: FallRefs): RagPose {
  const bones: RagPose['bones'] = {};
  const c = (k: keyof typeof I) => ch[I[k]] ?? 0;
  const drive = (
    name: DrivenBone,
    build: (ref: JointRef) => Quat,
  ) => {
    const ref = refs[name];
    if (!ref) return;
    bones[name] = build(ref);
  };
  /** rotate by `ang` about axis `kind` ('fx' | 'ab') then by `r` */
  const spin = (ref: JointRef, kind: 'fx' | 'ab', ang: number): Quat =>
    qMul(qA(ref[kind], ang), ref.r);
  const spin2 = (ref: JointRef, a1: 'fx' | 'ab', ang1: number, a2: 'fx' | 'ab', ang2: number): Quat =>
    qMul(qMul(qA(ref[a2], ang2), qA(ref[a1], ang1)), ref.r);

  // spine crunch — torso folds over the hips, weighted down the chain
  const bend = clamp(c('bend'), -0.4, 1.4);
  drive('spine_01', (r) => spin(r, 'fx', +bend * 0.4));
  drive('spine_02', (r) => spin(r, 'fx', +bend * 0.32));
  drive('spine_03', (r) => spin(r, 'fx', +bend * 0.2));
  // head whiplash (head doubles the neck at half weight)
  const hx = clamp(c('headX'), -0.9, 0.9);
  const hy = clamp(c('headY'), -0.5, 0.5);
  drive('neck_01', (r) => spin2(r, 'fx', hx, 'ab', hy));
  drive('Head', (r) => spin2(r, 'fx', hx * 0.5, 'ab', hy * 0.5));
  // arms — flex swings the down-hanging limb forward (−fx); abduction goes
  // OUTWARD per side (−ab right, +ab left); elbow curls the forearm forward
  const fR = clamp(c('armRflex'), 0, 2.0), fL = clamp(c('armLflex'), 0, 2.0);
  const abR = clamp(c('armRab'), 0, 1.7), abL = clamp(c('armLab'), 0, 1.7);
  const eR = clamp(c('armRelbow'), 0, 2.2), eL = clamp(c('armLelbow'), 0, 2.2);
  drive('upperarm_r', (r) => spin2(r, 'fx', -fR, 'ab', -abR));
  drive('lowerarm_r', (r) => spin(r, 'fx', -eR * 0.8));
  drive('upperarm_l', (r) => spin2(r, 'fx', -fL, 'ab', +abL));
  drive('lowerarm_l', (r) => spin(r, 'fx', -eL * 0.8));
  // legs — hips like shoulders; knees bend the shin BACKWARD (+fx)
  const tR = clamp(c('legRflex'), 0, 1.9), tL = clamp(c('legLflex'), 0, 1.9);
  const aR = clamp(c('legRab'), -0.3, 1.0), aL = clamp(c('legLab'), -0.3, 1.0);
  const kR = clamp(c('legRknee'), 0, 2.1), kL = clamp(c('legLknee'), 0, 2.1);
  drive('thigh_r', (r) => spin2(r, 'fx', -tR, 'ab', -aR));
  drive('calf_r', (r) => spin(r, 'fx', +kR * 0.85));
  drive('thigh_l', (r) => spin2(r, 'fx', -tL, 'ab', +aL));
  drive('calf_l', (r) => spin(r, 'fx', +kL * 0.85));

  return {
    bones,
    pitch: clamp(ch[I.pitch] ?? 0, -1.75, 1.75),
    twist: clamp(ch[I.twistZ] ?? 0, -1.6, 1.6),
  };
}

/**
 * Compute a JointRef for one bone from its world orientation at capture.
 * `axis` are the body's X (left/right) and Z (forward) directions in the
 * same coordinate space `parentWorldQ` is expressed in.
 */
export function jointRef(
  boneLocalQ: Quat,
  parentWorldQ: Quat,
  bodyXWorld: [number, number, number],
  bodyZWorld: [number, number, number],
): JointRef {
  const pInv = qConj(parentWorldQ);
  return {
    r: boneLocalQ,
    fx: qRotateVec(pInv, bodyXWorld),
    ab: qRotateVec(pInv, bodyZWorld),
  };
}
