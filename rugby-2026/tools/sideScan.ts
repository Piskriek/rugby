/**
 * SIDESCAN — fit the lateral (dir S) 3/4-side rest on the real rig.
 * Grids torso pose + arm/leg channels and reports combos that keep every
 * landmark on/near the turf with the down limbs lifted out of the pitch.
 * Run: npx vite-node tools/sideScan.ts
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

  // Exact mirror (L == R) — the decode path is being made symmetric so the
  // two hands read the true up/down geometry of the side-lie.
  const mk = (P: number, T: number, bend: number, hY: number,
    f: number, ab: number, elb: number, lf: number, la: number, kn: number) => [
    P, T, bend, 0, hY,
    f, ab, elb, f, ab, elb,
    lf, la, kn, lf, la, kn,
  ];
  const results: { score: number; ch: number[]; ys: Record<string, number>; tag: string }[] = [];
  for (const P of [0.40, 0.50, 0.60, 0.70]) {
    for (const T of [1.35, 1.44, 1.53]) {
      for (const bend of [0.05, 0.12, 0.2]) {
        for (const f of [0.4, 0.8, 1.2, 1.6]) {
          for (const ab of [0.1, 0.35, 0.65, 1.0]) {
            for (const elb of [0.05, 0.25, 0.6]) {
              for (const lf of [0.05, 0.25]) {
                for (const la of [-0.15, -0.05, 0.05, 0.15, 0.3]) {
                  for (const kn of [0.05, 0.2, 0.5, 0.9]) {
                    const ys = probePose(mk(P, T, bend, 0.1, f, ab, elb, lf, la, kn));
                    const lo = Math.min(...CLR.map((k) => ys[k]));
                    const handHi = Math.max(ys.hand_l, ys.hand_r);
                    // only land the deep-embedded ones back on the turf
                    if (lo < -0.05) continue;
                    if (handHi > 0.6) continue;
                    const score = handHi * 1.5
                      + Math.max(0, ys.Head - 0.24) * 2 + Math.max(0, 0.05 - ys.Head) * 3
                      + Math.abs(ys.pelvis - 0.11) * 2
                      + Math.abs(ys.hand_l - ys.hand_r) * 0.3
                      + (Math.max(0, 0.02 - ys.foot_r) + Math.max(0, 0.02 - ys.foot_l)) * 2
                      + Math.abs(ys.calf_l - 0.09) + Math.abs(ys.calf_r - 0.09);
                    results.push({ score, ch: mk(P, T, bend, 0.1, f, ab, elb, lf, la, kn), ys, tag: `P${P} T${T.toFixed(2)} bend${bend} f${f} ab${ab} elb${elb} lf${lf} la${la} kn${kn}` });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  results.sort((a, b) => a.score - b.score);
  for (const r of results.slice(0, 20)) {
    console.log(r.tag, '→', Object.entries(r.ys).map(([k, y]) => `${k} ${y.toFixed(3)}`).join(' '));
  }
  if (results.length === 0) console.log('NO CANDIDATES');
}, (e) => { console.error('parse err', e); process.exit(1); });
