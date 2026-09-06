/**
 * ragdollRig.ts — the bridge between the Verlet solver and a skinned rig.
 *
 * The solver (ragdoll.ts) knows only about 11 points in world space. A GLB
 * character is a hierarchy of ~60 bones with rest offsets and parent
 * transforms. This module is the translation in both directions:
 *
 *   SEED    read the live animated pose and hand the solver 11 world points,
 *           so the ragdoll begins exactly where the animation left off. This
 *           is the whole trick behind an invisible handover — a ragdoll that
 *           starts from a canonical T-pose visibly snaps.
 *
 *   DRIVE   after the solve, aim each bone down the segment its two particles
 *           define. Bones are rotated, never positioned: writing bone world
 *           positions directly fights the parent hierarchy and tears the mesh.
 *
 * The aiming is done with quaternions built from `setFromUnitVectors`, which
 * is the shortest-arc rotation between the bone's rest direction and the
 * direction the solver wants. That is stable at every angle, including the
 * 180-degree flip that a `lookAt` or an Euler decomposition mishandles — and
 * a tackled player inverting completely is exactly the case that exposes it.
 */
import * as THREE from 'three';
import { RagdollBody, NODE } from './ragdoll';

/** The bones the ragdoll drives, in the naming conventions this rig may use. */
const RAG_BONES = {
  pelvis: ['pelvis', 'Hips', 'mixamorigHips'],
  spine1: ['spine_01', 'Spine', 'mixamorigSpine'],
  spine3: ['spine_03', 'Spine2', 'mixamorigSpine2'],
  neck: ['neck_01', 'Neck', 'mixamorigNeck'],
  head: ['head', 'Head', 'mixamorigHead'],
  upperArmL: ['upperarm_l', 'LeftArm', 'mixamorigLeftArm'],
  upperArmR: ['upperarm_r', 'RightArm', 'mixamorigRightArm'],
  foreArmL: ['lowerarm_l', 'LeftForeArm', 'mixamorigLeftForeArm'],
  foreArmR: ['lowerarm_r', 'RightForeArm', 'mixamorigRightForeArm'],
  thighL: ['thigh_l', 'LeftUpLeg', 'mixamorigLeftUpLeg'],
  thighR: ['thigh_r', 'RightUpLeg', 'mixamorigRightUpLeg'],
  calfL: ['calf_l', 'LeftLeg', 'mixamorigLeftLeg'],
  calfR: ['calf_r', 'RightLeg', 'mixamorigRightLeg'],
} as const;

export type RagBoneKey = keyof typeof RAG_BONES;

export type RagBones = Partial<Record<RagBoneKey, THREE.Bone>>;

export function resolveRagBones(root: THREE.Object3D): RagBones {
  const out: RagBones = {};
  const byName = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
  });
  (Object.keys(RAG_BONES) as RagBoneKey[]).forEach((k) => {
    for (const n of RAG_BONES[k]) {
      const b = byName.get(n);
      if (b) { out[k] = b; return; }
    }
  });
  return out;
}

/**
 * Which bone supplies each particle's seed position, and how far down that
 * bone's own axis to sit. The hands and feet are at the END of their chains,
 * so they are seeded from the child bone's head where one exists.
 */
const SEED_FROM: ReadonlyArray<readonly [number, RagBoneKey]> = [
  [NODE.PELVIS, 'pelvis'],
  [NODE.CHEST, 'spine3'],
  [NODE.HEAD, 'head'],
  [NODE.SHOULDER_L, 'upperArmL'],
  [NODE.SHOULDER_R, 'upperArmR'],
  [NODE.HAND_L, 'foreArmL'],
  [NODE.HAND_R, 'foreArmR'],
  [NODE.KNEE_L, 'calfL'],
  [NODE.KNEE_R, 'calfR'],
  [NODE.FOOT_L, 'calfL'],
  [NODE.FOOT_R, 'calfR'],
];

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _scale = new THREE.Vector3();

/**
 * Read the current animated pose into a seed array of world positions,
 * in METRES (the rig is scaled by RENDER_SCALE, so we divide it out — the
 * solver works in real units so gravity is 9.81 and not 16.2).
 */
export function seedFromPose(
  bones: RagBones, renderScale: number, out: Float32Array,
): boolean {
  if (!bones.pelvis) return false;
  for (const [node, key] of SEED_FROM) {
    const b = bones[key];
    if (!b) return false;
    b.getWorldPosition(_v);
    out[node * 3] = _v.x / renderScale;
    out[node * 3 + 1] = _v.y / renderScale;
    out[node * 3 + 2] = _v.z / renderScale;
  }
  /* The feet were seeded at the calf (knee) because the rig's foot bones are
   * unreliable across naming conventions. Drop them to plausible ankle height
   * below their knee so the initial pose is not a man with no shins. */
  for (const [foot, knee] of [[NODE.FOOT_L, NODE.KNEE_L], [NODE.FOOT_R, NODE.KNEE_R]] as const) {
    const drop = Math.max(0.30, out[knee * 3 + 1] * 0.72);
    out[foot * 3] = out[knee * 3];
    out[foot * 3 + 1] = Math.max(0.09, out[knee * 3 + 1] - drop);
    out[foot * 3 + 2] = out[knee * 3 + 2] + 0.04;
  }
  return true;
}

/** A bone to aim, and the two particles whose segment defines its direction. */
const AIM: ReadonlyArray<readonly [RagBoneKey, number, number]> = [
  ['spine1', NODE.PELVIS, NODE.CHEST],
  ['neck', NODE.CHEST, NODE.HEAD],
  ['upperArmL', NODE.SHOULDER_L, NODE.HAND_L],
  ['upperArmR', NODE.SHOULDER_R, NODE.HAND_R],
  ['thighL', NODE.PELVIS, NODE.KNEE_L],
  ['thighR', NODE.PELVIS, NODE.KNEE_R],
  ['calfL', NODE.KNEE_L, NODE.FOOT_L],
  ['calfR', NODE.KNEE_R, NODE.FOOT_R],
];

/**
 * Cached rest direction per bone, in that bone's PARENT space. Computed once
 * from the bind pose: it is the direction the bone naturally points, which is
 * what `setFromUnitVectors` needs as its "from" vector.
 */
export type RestDirs = Partial<Record<RagBoneKey, THREE.Vector3>>;

export function captureRestDirs(bones: RagBones): RestDirs {
  const out: RestDirs = {};
  for (const [key, a, b] of AIM) {
    const bone = bones[key];
    if (!bone) continue;
    /* The rest direction is the offset to the bone's first child, expressed in
     * the bone's own local space and then rotated by its rest quaternion into
     * parent space. Most humanoid rigs point a bone at its child. */
    const child = bone.children.find((c) => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
    const dir = new THREE.Vector3();
    if (child) dir.copy(child.position).normalize();
    else dir.set(0, 1, 0);
    if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
    out[key] = dir;
    void a; void b;
  }
  return out;
}

/**
 * Drive the rig from the solved body.
 *
 * `blend` (0..1) is the ragdoll's authority: 0 leaves the animation alone,
 * 1 is fully physics-driven. Blending in over a few frames is what makes the
 * transition from clip to ragdoll invisible.
 */
export function driveRig(
  bones: RagBones, rest: RestDirs, body: RagdollBody,
  root: THREE.Object3D, renderScale: number, blend: number,
): void {
  if (!bones.pelvis || blend <= 0) return;

  /* --- 1. the pelvis carries the whole body's translation ---------------
   * The root Object3D stays where the game says the player is; the pelvis
   * bone is offset within it so the physical body can travel independently
   * of the logical position without desyncing the two. */
  const pelvis = bones.pelvis;
  const px = body.pos[NODE.PELVIS * 3] * renderScale;
  const py = body.pos[NODE.PELVIS * 3 + 1] * renderScale;
  const pz = body.pos[NODE.PELVIS * 3 + 2] * renderScale;
  if (pelvis.parent) {
    _v.set(px, py, pz);
    pelvis.parent.updateWorldMatrix(true, false);
    _m.copy(pelvis.parent.matrixWorld).invert();
    _v.applyMatrix4(_m);
    pelvis.position.lerp(_v, blend);
  }

  /* --- 2. every other bone is AIMED, never positioned ------------------- */
  for (const [key, a, b] of AIM) {
    const bone = bones[key];
    const restDir = rest[key];
    if (!bone || !bone.parent || !restDir) continue;

    // Desired direction, world space -> parent space.
    _v.set(
      body.pos[b * 3] - body.pos[a * 3],
      body.pos[b * 3 + 1] - body.pos[a * 3 + 1],
      body.pos[b * 3 + 2] - body.pos[a * 3 + 2],
    );
    if (_v.lengthSq() < 1e-10) continue;
    _v.normalize();

    bone.parent.updateWorldMatrix(true, false);
    bone.parent.matrixWorld.decompose(_v2, _qp, _scale);
    // world -> parent space: rotate by the inverse of the parent's rotation.
    _v.applyQuaternion(_qp.invert());
    _v.normalize();

    /* Shortest-arc rotation from where the bone rests to where physics wants
     * it. Stable through the full 180 degrees, unlike an Euler or lookAt. */
    _q.setFromUnitVectors(restDir, _v);
    bone.quaternion.slerp(_q, blend);
  }

  void root;
}
