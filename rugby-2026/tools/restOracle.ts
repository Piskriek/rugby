/**
 * REST ORACLE (dev tool) — evaluate a candidate ACT-3 "rest" channel vector
 * straight against the real rig and print every clearance-bone height, so
 * sprawl targets can be chosen from the ground truth of the composed pose
 * without re-baking between candidates.
 *
 * Usage: npx vite-node tools/restOracle.ts <pitch> <twist> <bend> <armF>
 *        <armAbR> <armElbR> <legF> <legAbR> <legKneeR> [extraArmsAbL] ...
 * (all radians; optional extra left-arm ab / left elbow offsets default to
 *  the bake's L/R constants)
 */
globalThis.self = globalThis as unknown as Window & typeof globalThis;
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildPose, jointRef } from '../src/physics/poseMap';
import type { FallRefs } from '../src/physics/poseMap';
import { canonicalStand } from '../src/physics/neutralStand';

const glb = pathToFileURL('/home/user/rugby/rugby-2026/public/assets/models/rugby_player.glb').href;
const DRIVEN = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'thigh_r', 'calf_r'] as const;
const CLR = ['Head', 'pelvis', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'calf_l', 'calf_r'] as const;

const raw = process.argv.slice(2);
const pure = raw[0] === 'pure';
const nums = (pure ? raw.slice(1) : raw).map(Number);
const [
  P, T, BEND, ARMF, ABR, ELBR, LEGF, LEGABR, LEGKR,
] = nums;
if (nums.length < 9) {
  console.log('usage: restOracle [pure] pitch twist bend armF abR elbR legF legAb legKnee');
  process.exit(1);
}
// mirror with the bake's exact L/R constants (as written in solveFall), so
// candidates evaluate to the recorded rest pose; `pure` mirrors exactly
const ch = pure
  ? [P, T, BEND, 0, 0, ARMF, ABR, ELBR, ARMF, ABR, ELBR, LEGF, LEGABR, LEGKR, LEGF, LEGABR, LEGKR]
  : [
      P, T, BEND, 0, 0,
      ARMF, ABR, ELBR,
      ARMF, Math.min(1.65, ABR * 0.62 + 0.2), Math.min(2.1, ELBR * 0.7 + 0.22),
      LEGF, LEGABR, LEGKR,
      Math.min(1.95, LEGF + 0.08), Math.max(-0.2, LEGABR * 0.7 - 0.1),
      Math.min(2.1, LEGKR * 0.78 + 0.12),
    ];

const loader = new GLTFLoader();
const buf = readFileSync(new URL(glb));
loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', (g) => {
  const clone = SkeletonUtils.clone(g.scene);
  const bones = new Map<string, THREE.Bone>();
  let skeleton: THREE.Skeleton | undefined;
  clone.traverse((o) => {
    const b = o as THREE.Bone;
    if (b.isBone) bones.set(b.name, b);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeleton = (o as THREE.SkinnedMesh).skeleton;
  });
  if (!skeleton) throw new Error('no skeleton');
  const idle = g.animations.find((a) => a.name === 'Idle');
  canonicalStand(bones, clone, skeleton, idle);
  clone.updateMatrixWorld(true);

  const qRoot = clone.getWorldQuaternion(new THREE.Quaternion());
  const vX = new THREE.Vector3(1, 0, 0).applyQuaternion(qRoot);
  const vZ = new THREE.Vector3(0, 0, 1).applyQuaternion(qRoot);
  const refs: FallRefs = {};
  const pQ = new THREE.Quaternion();
  for (const name of DRIVEN) {
    const b = bones.get(name)!;
    const parent = b.parent as THREE.Bone;
    if (parent && parent.isBone) parent.getWorldQuaternion(pQ); else pQ.identity();
    refs[name] = jointRef(
      { w: b.quaternion.w, x: b.quaternion.x, y: b.quaternion.y, z: b.quaternion.z },
      { w: pQ.w, x: pQ.x, y: pQ.y, z: pQ.z },
      [vX.x, vX.y, vX.z], [vZ.x, vZ.y, vZ.z],
    );
  }

  const pose = buildPose(ch, refs);
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.pitch)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.twist));
  clone.quaternion.copy(rot);
  clone.position.y = 0;
  for (const name of DRIVEN) {
    const q = pose.bones[name];
    const b = bones.get(name);
    if (q && b) b.quaternion.set(q.x, q.y, q.z, q.w);
  }
  clone.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const ys: Record<string, number> = {};
  const xyz: Record<string, string> = {};
  for (const n of CLR) {
    bones.get(n)!.getWorldPosition(v);
    ys[n] = v.y;
    xyz[n] = `${n}(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`;
  }
  console.log('channels', ch.map((x) => x.toFixed(2)).join(' '));
  console.log(Object.entries(ys).map(([k, y]) => `${k}=${y.toFixed(3)}`).join('  '));
  console.log(Object.values(xyz).join(' '));
  const vs = Object.values(ys);
  console.log(`min ${Math.min(...vs).toFixed(3)}  max ${Math.max(...vs).toFixed(3)}`);
}, (e) => { console.error('parse err', e); process.exit(1); });
