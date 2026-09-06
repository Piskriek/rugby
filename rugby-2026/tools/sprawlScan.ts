/**
 * SPRAWLSCAN — search channel space for the face-down slack-sprawl rest.
 * Brute-forces (armF, abR, elbR, legF, legAb, knee, headY, twist) on the rig
 * and reports the combos whose settle pose keeps every key bone inside a
 * "flat on the turf" band. Run: npx vite-node tools/sprawlScan.ts
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

  const v = new THREE.Vector3();
  const probePose = (ch: number[]) => {
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
    const ys: Record<string, number> = {};
    for (const n of CLR) { bones.get(n)!.getWorldPosition(v); ys[n] = v.y; }
    return ys;
  };

  const BEND = 0.1;
  let best: { score: number; ch: number[]; ys: Record<string, number>; tag: string }[] = [];
  // bake-style mirror L from R
  const mk = (P: number, T: number, bend: number, hY: number,
    f: number, ab: number, elb: number, lf: number, la: number, kn: number) => [
    P, T, bend, 0, hY,
    f, ab, elb, f, Math.min(1.65, ab * 0.62 + 0.2), Math.min(2.1, elb * 0.7 + 0.22),
    lf, la, kn, Math.min(1.95, lf + 0.08), Math.max(-0.2, la * 0.7 - 0.1), Math.min(2.1, kn * 0.78 + 0.12),
  ];
  for (const P of [1.42, 1.46, 1.50, 1.545, 1.575]) {
  for (const T of [0.0, 0.06]) {
    for (const hY of [0.2, 0.45]) {
      for (const f of [0.0, 0.03, 0.06, 0.1]) {
        for (const ab of [0.25, 0.45, 0.65, 0.85, 1.05, 1.25]) {
          for (const elb of [0.05, 0.15, 0.3, 0.5]) {
            for (const lf of [0.05, 0.12, 0.2]) {
              for (const la of [0.12, 0.22, 0.34]) {
                for (const kn of [0.1, 0.25, 0.4]) {
                  const ys = probePose(mk(P, T, BEND, hY, f, ab, elb, lf, la, kn));
                  const vals = Object.values(ys);
                  const mx = Math.max(...vals);
                  const handHi = Math.max(ys.hand_l, ys.hand_r);
                  const handLo = Math.min(ys.hand_l, ys.hand_r);
                  // filter: no bone may dig under the turf; nothing key may float
                  let bad = false;
                  for (const k of ['hand_l', 'hand_r', 'foot_l', 'foot_r', 'calf_l', 'calf_r', 'Head']) {
                    if (ys[k] < -0.02 || ys[k] > 0.3) { bad = true; break; }
                  }
                  if (bad) continue;
                  // score: hands flat on the turf and close together in height;
                  // pelvis/head natural; everything hugging the plane
                  const hi = Math.max(handHi, ys.foot_l, ys.foot_r, ys.calf_l, ys.calf_r);
                  const score = (handLo - 0.02) * (handLo - 0.02) + (handHi - 0.05) * (handHi - 0.05)
                    + (handHi - handLo) * 3 + Math.max(0, hi - 0.22) * 2 + Math.abs(ys.Head - 0.06);
                  best.push({ score, ch: mk(P, T, BEND, hY, f, ab, elb, lf, la, kn), ys, tag: `T${T} hY${hY} f${f} ab${ab} elb${elb} lf${lf} la${la} kn${kn}` });
                }
              }
            }
          }
        }
      }
    }
  }
  }
  best.sort((a, b) => a.score - b.score);
  console.log('top 15 face-down sprawl candidates:');
  for (const b of best.slice(0, 15)) {
    const y = b.ys;
    console.log(`${b.tag}\n  hand_l=${y.hand_l.toFixed(3)} hand_r=${y.hand_r.toFixed(3)} foot_l=${y.foot_l.toFixed(3)} foot_r=${y.foot_r.toFixed(3)} calf_l=${y.calf_l.toFixed(3)} calf_r=${y.calf_r.toFixed(3)} head=${y.Head.toFixed(3)} pelv=${y.pelvis.toFixed(3)} min=${Math.min(...Object.values(y)).toFixed(3)}`);
  }
}, (e) => { console.error('parse err', e); process.exit(1); });
