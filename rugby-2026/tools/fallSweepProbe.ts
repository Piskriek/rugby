/**
 * FALL-SWEEP PROBE (dev tool) — full-recording audit of every baked entry
 * group. Scans ALL 66 samples per archetype on the real rig (Idle capture,
 * parent-frame refs, rotor, clearance) and reports:
 *   - worst turf clip (how far any key bone goes under y=0) and when;
 *   - the required clearance lift at the settled pose (should be ~0);
 *   - the ACT structure: braced at 0.07 s (stiff), folded by 0.35 s
 *     (crumple), sprawled at the end (slack).
 *
 * Usage: npx vite-node tools/fallSweepProbe.ts
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
import { FALL_T, FALL_N, CH } from '../src/physics/falls';
import { canonicalStand } from '../src/physics/neutralStand';

const glb = pathToFileURL('/home/user/rugby/rugby-2026/public/assets/models/rugby_player.glb').href;
const buf = readFileSync(new URL(glb));
const loader = new GLTFLoader();
const DRIVEN = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'thigh_r', 'calf_r'] as const;
const CLR = ['Head', 'pelvis', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'calf_l', 'calf_r'];

let fails = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) { fails++; console.log(`FAIL ${label}${extra ? ' — ' + extra : ''}`); }
  else console.log(` ok  ${label}`);
};

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

  const v = new THREE.Vector3();
  const boneYs = (names: readonly string[]) => {
    const ys: Record<string, number> = {};
    for (const n of names) {
      bones.get(n)!.getWorldPosition(v);
      ys[n] = v.y;
    }
    return ys;
  };
  const minBone = (ys: Record<string, number>) =>
    Object.entries(ys).reduce((a, b) => (a[1] <= b[1] ? a : b));
  const maxBone = (ys: Record<string, number>) =>
    Object.entries(ys).reduce((a, b) => (a[1] >= b[1] ? a : b));
  const probe = (
    label: string, desc: Parameters<typeof findFall>[0], mirror: boolean,
    maxSettleH: number,           // gate: nothing key may rest above this
  ) => {
    const entry = findFall(desc);
    let worstClip = 0, worstT = -1, settleClip = 0, worstYs: Record<string, number> = {};
    let ch07 = '', ch3 = '', settleYs: Record<string, number> = {};
    for (let s = 0; s < FALL_N; s++) {
      const t = s / 30;
      const ch = samplePose(entry, Math.min(t, FALL_T), mirror);
      const pose = buildPose(Array.from(ch) as number[], refs);
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.pitch)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.twist));
      clone.quaternion.copy(rot);
      clone.position.y = 0;                            // ground reference, like the lab
      for (const name of DRIVEN) {
        const q = pose.bones[name];
        const b = bones.get(name);
        if (q && b) b.quaternion.set(q.x, q.y, q.z, q.w);
      }
      clone.updateMatrixWorld(true);
      const ys = boneYs(CLR);
      if (Math.abs(t - 0.07) < 0.002) {
        ch07 = `α${pose.pitch.toFixed(2)} b${ch[2].toFixed(2)} armF${ch[5].toFixed(2)} ab${ch[6].toFixed(2)} legF${ch[11].toFixed(2)} k${ch[13].toFixed(2)}`;
      }
      if (Math.abs(t - 0.35) < 0.002) {
        ch3 = `α${pose.pitch.toFixed(2)} b${ch[2].toFixed(2)} armF${ch[5].toFixed(2)} ab${ch[6].toFixed(2)} legF${ch[11].toFixed(2)} k${ch[13].toFixed(2)}`;
      }
      if (s === 0) worstYs = ys;                    // in case nothing ever clips
      const min = minBone(ys);
      const clip = 0 - min[1];
      if (clip > worstClip) { worstClip = clip; worstT = t; worstYs = ys; }
      if (t >= 1.3) {
        if (clip > settleClip) settleClip = clip;
        if (s === FALL_N - 1) settleYs = ys;           // last sample = rest pose
      }
    }
    const [mLow, mLowY] = minBone(settleYs);
    const [mHigh, mHighY] = maxBone(settleYs);
    const [wLow, wLowY] = minBone(worstYs);
    console.log(`${label}\n  t0.07 ${ch07}\n  t0.35 ${ch3}\n  worst ${worstClip.toFixed(2)} m @ t=${worstT.toFixed(2)} (deepest ${wLow} ${wLowY.toFixed(2)})\n  rest  low ${mLow} ${mLowY.toFixed(2)} · high ${mHigh} ${mHighY.toFixed(2)} (${Object.entries(settleYs).map(([k, y]) => `${k}=${y.toFixed(2)}`).join(' ')})`);
    check(`${label}: no deep clip (≤ 0.12 m transient)`, worstClip <= 0.12, `worst ${worstClip.toFixed(2)}`);
    check(`${label}: settles on the turf (≤ 0.06 m)`, settleClip <= 0.06, `settle ${settleClip.toFixed(2)}`);
    check(`${label}: nothing stuck up at rest (≤ ${maxSettleH} m)`, mLowY >= -0.06 && mHighY <= maxSettleH, `high ${mHigh} ${mHighY.toFixed(2)}, low ${mLow} ${mLowY.toFixed(2)}`);
  };

  const grid = [
    ['FALL F v6', { kind: 'FALL', speed: 6, hitH: 0.6, massR: 1, dir: 'F' }, false, 0.4],
    ['FALL B v6', { kind: 'FALL', speed: 6, hitH: 0.6, massR: 1, dir: 'B' }, false, 0.65],
    ['FALL S v6 right', { kind: 'FALL', speed: 6, hitH: 0.6, massR: 1, dir: 'S' }, false, 0.7],
    ['FALL S v6 left', { kind: 'FALL', speed: 6, hitH: 0.6, massR: 1, dir: 'S' }, true, 0.7],
    ['ROLL F v6', { kind: 'ROLL', speed: 6, hitH: 0.6, massR: 1, dir: 'F' }, false, 1.0],
    ['ROLL S v6', { kind: 'ROLL', speed: 6, hitH: 0.6, massR: 1, dir: 'S' }, false, 1.0],
    ['FALL F v10', { kind: 'FALL', speed: 10, hitH: 0.6, massR: 1, dir: 'F' }, false, 0.4],
    ['FALL F v2.5', { kind: 'FALL', speed: 2.5, hitH: 0.6, massR: 1, dir: 'F' }, false, 0.4],
  ] as const;
  for (const [label, d, m, h] of grid) probe(label, d, m, h);

  console.log(fails === 0 ? '\nFALL SWEEP: ALL PASS' : `\nFALL SWEEP: ${fails} FAILURES`);
  process.exitCode = fails ? 1 : 0;
}, (e) => { console.error('parse err', e); process.exit(1); });
