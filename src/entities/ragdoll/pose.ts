/**
 * POSE — turn skeletal animation into per-joint relative-rotation targets.
 *
 * The motor consumes, per ragdoll joint, the target rotation of the CHILD
 * body relative to the PARENT body in world bind axes (Rt, see motor.ts).
 * Animation clips store per-NODE LOCAL rotations, so we compose the local
 * rotations along the VISUAL skeleton (which has extra in-between bones the
 * ragdoll does not have — spine_02, clavicles, …) to get each visual bone's
 * orientation, then read the child-under-parent delta for every joint.
 *
 * Rt(joint) = conj(compose(parentVisual)) · compose(childVisual)
 * (PARENT-frame-relative — the intrinsic joint rotation, invariant to
 * whole-body rotation; the same convention the motor's PD measures and the
 * kinematic branch follows.)
 *
 * Two sources ship here:
 *  - `demoSource()`: no clip — the bind pose (targets default to bind).
 *  - `clipSource(clip, t)`: sample a GLB animation clip (e.g. the Idle clip
 *    shipped with the player) at time t, linear-interpolated per track.
 */
import * as THREE from 'three';
import type { RagdollRig } from './rig';
import type { BodyPart, PoseQuat } from './types';
import { VISUAL_BONE, PARENT } from './skeleton';

export interface PoseSource {
  /** local rotation of a visual bone at time t (identity if unknown). */
  localQ(boneName: string, t: number): THREE.Quaternion;
  /** total clip duration in seconds (0 = static). */
  duration: number;
}

const IDENT = new THREE.Quaternion();
const VISUAL_PARENT: Record<string, string> = {
  pelvis: 'root', spine_01: 'pelvis', spine_02: 'spine_01', spine_03: 'spine_02',
  neck_01: 'spine_03', Head: 'neck_01',
  clavicle_l: 'spine_03', upperarm_l: 'clavicle_l', lowerarm_l: 'upperarm_l', hand_l: 'lowerarm_l',
  clavicle_r: 'spine_03', upperarm_r: 'clavicle_r', lowerarm_r: 'upperarm_r', hand_r: 'lowerarm_r',
  thigh_l: 'pelvis', calf_l: 'thigh_l', foot_l: 'calf_l', ball_l: 'foot_l',
  thigh_r: 'pelvis', calf_r: 'thigh_r', foot_r: 'calf_r', ball_r: 'foot_r',
};
const SKELETON_ORDER = [
  'root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l',
  'thigh_r', 'calf_r', 'foot_r', 'ball_r',
];

/** Static bind source — local rotations are identity, i.e. the rest pose. */
export function bindSource(): PoseSource {
  return {
    localQ: () => IDENT,
    duration: 0,
  };
}

/** Build the per-joint target map at time t. Keys: ragdoll child body part
 *  (the motor's pose.bones keys). Returns full record including identity. */
export function samplePose(rig: RagdollRig, src: PoseSource, t: number): Record<string, PoseQuat> {
  // compose every visual bone in hierarchy order
  const world = new Map<string, THREE.Quaternion>();
  for (const name of SKELETON_ORDER) {
    const local = src.localQ(name, t).clone();
    const p = VISUAL_PARENT[name];
    const pw = world.get(p ?? '') ?? new THREE.Quaternion(); // root's parent = world
    world.set(name, pw.clone().multiply(local).normalize());
  }

  const out: Record<string, PoseQuat> = {};
  for (const j of rig.joints) {
    const cv = VISUAL_BONE[j.childPart];
    const pv = VISUAL_BONE[j.parentPart];
    const qc = world.get(cv);
    const qp = world.get(pv);
    if (!qc || !qp) continue;
    const rt = qp.clone().invert().multiply(qc).normalize();
    out[j.childPart] = { x: rt.x, y: rt.y, z: rt.z, w: rt.w };
  }
  // leaves (hands/feet) are not joints; leave them out (they stay at bind).
  void PARENT;
  return out;
}

/* ------------------------------------------------- clip sampling --------- */
/** Wrap a THREE.AnimationClip into a PoseSource. Tracks are named
 *  "<boneName>.quaternion" in the GLB's local node space. */
export function clipSource(clip: THREE.AnimationClip | null | undefined): PoseSource {
  const tracks = new Map<string, THREE.QuaternionKeyframeTrack>();
  if (clip) {
    for (const tr of clip.tracks) {
      const m = /^(.*)\.quaternion$/.exec(tr.name);
      if (!m) continue;
      const q = tr as THREE.QuaternionKeyframeTrack;
      if (q.getValueSize() === 4) tracks.set(m[1], q);
    }
  }
  const duration = clip?.duration ?? 0;
  const timesCache = new Map<string, number[]>();
  const valsCache = new Map<string, Float32Array>();
  const localQ = (boneName: string, t: number): THREE.Quaternion => {
    const tr = tracks.get(boneName);
    if (!tr) return IDENT;
    let times = timesCache.get(boneName);
    let vals = valsCache.get(boneName);
    if (!times) {
      times = Array.from(tr.times);
      timesCache.set(boneName, times);
    }
    if (!vals) {
      vals = tr.values;
      valsCache.set(boneName, vals);
    }
    const out = new THREE.Quaternion();
    if (times.length === 0) return IDENT;
    if (t <= times[0]) return out.fromArray(vals, 0);
    if (t >= times[times.length - 1]) return out.fromArray(vals, (times.length - 1) * 4);
    // linear scan (clips are short, tracks ~hundreds of keys max)
    let i = 1;
    while (i < times.length - 1 && times[i] < t) i++;
    const t0 = times[i - 1], t1 = times[i];
    const f = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-6, t1 - t0)));
    const a = new THREE.Quaternion().fromArray(vals, (i - 1) * 4);
    const b = new THREE.Quaternion().fromArray(vals, i * 4);
    return out.slerpQuaternions(a, b, f);
  };
  return { localQ, duration };
}

/* ------------------------------------------------- demo pose sources ----- */
/** Slightly athletic "ready" pose: elbows softly bent (~35°) and knees
 *  unlocked (~8°) so the PD motors have visible targets to hold. */
export function readyPoseSource(): PoseSource {
  const cache = new Map<string, THREE.Quaternion>();
  const mk = (name: string, axis: THREE.Vector3, deg: number) => {
    cache.set(name, new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180));
  };
  // elbow flexion = rotate the forearm about the elbow hinge axis.
  // Left elbow hinge world −Z; right elbow world +Z (bind frame).
  mk('lowerarm_l', new THREE.Vector3(0, 0, -1), 35);
  mk('lowerarm_r', new THREE.Vector3(0, 0, 1), 35);
  // knee unlock = slight calf bend about the knee hinge (world −X both legs)
  mk('calf_l', new THREE.Vector3(-1, 0, 0), 8);
  mk('calf_r', new THREE.Vector3(-1, 0, 0), 8);
  return {
    localQ: (name) => cache.get(name) ?? IDENT,
    duration: 0,
  };
}

export type { BodyPart };
