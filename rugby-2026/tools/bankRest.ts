/**
 * BANKREST — inspect the REAL rest pose of a baked entry on the rig.
 * Prints the settle sample's expanded channels and the per-bone world
 * positions exactly as the lab would show them, plus the runtime
 * clearance lift the lab would apply.
 *
 * Usage: npx vite-node tools/bankRest.ts <kind> <speed> <hitH> <massR> <dir> [time]
 *   kind FALL|ROLL  dir F|B|S   time seconds (default 2.2 = rest)
 */
globalThis.self = globalThis as unknown as Window & typeof globalThis;
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { findFall, samplePose } from '../src/physics/fallBank';
import { buildPose, jointRef } from '../src/physics/poseMap';
import type { FallRefs } from '../src/physics/poseMap';
import { canonicalStand } from '../src/physics/neutralStand';
import { FALL_N, CH } from '../src/physics/falls';
import type { FallDesc } from '../src/physics/falls';

const glb = pathToFileURL('/home/user/rugby/rugby-2026/public/assets/models/rugby_player.glb').href;
const [kind, speed, hitH, massR, dir, ts] = process.argv.slice(2);
if (!kind || !speed || !hitH || !massR || !dir) {
  console.log('usage: bankRest <FALL|ROLL> <speed> <hitH> <massR> <F|B|S> [time]');
  process.exit(1);
}
const desc: FallDesc = { kind: kind as FallDesc['kind'], speed: +speed, hitH: +hitH, massR: +massR, dir: dir as FallDesc['dir'] };
const t = Math.min(FALL_N / 30 - 0.001, ts !== undefined ? +ts : 2.2);

const DRIVEN = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'thigh_r', 'calf_r'] as const;
const CLR = ['Head', 'pelvis', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'calf_l', 'calf_r'];

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

  const entry = findFall(desc);
  const ch = Array.from(samplePose(entry, t, false)) as number[];
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

  const chNames = ['pitch', 'twist', 'bend', 'hdX', 'hdY',
    'armF', 'abR', 'elbR', 'armLf', 'abL', 'elbL', 'legF', 'abRl', 'knR', 'legLf', 'abLl', 'knL'];
  const out: string[] = [];
  for (let i = 0; i < ch.length; i++) out.push(`${chNames[i]}=${ch[i].toFixed(2)}`);
  console.log('matched', entry.meta);
  console.log('channels @', t.toFixed(2), ':', out.join(' '));

  const v = new THREE.Vector3();
  const ys: Record<string, number> = {};
  const xyz: Record<string, string> = {};
  for (const n of CLR) {
    bones.get(n)!.getWorldPosition(v);
    ys[n] = v.y;
    xyz[n] = `${n}(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`;
  }
  let minY = 0.008;
  for (const n of CLR) if (ys[n] < minY) minY = ys[n];
  const lift = minY < 0.008 ? 0.008 - minY : 0;
  const vs = Object.values(ys);
  console.log(Object.entries(ys).map(([k, y]) => `${k}=${y.toFixed(3)}`).join('  '));
  console.log(Object.values(xyz).join(' '));
  console.log(`min ${Math.min(...vs).toFixed(3)}  max ${Math.max(...vs).toFixed(3)}   clearance lift ${lift.toFixed(3)}`);
}, (e) => { console.error('parse err', e); process.exit(1); });
