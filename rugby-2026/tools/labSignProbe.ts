/**
 * ARTICULATION PROBE (dev tool, node only) — the definitive sign test.
 *
 * Loads the real rig, poses it on the Idle clip (arms hanging), captures the
 * joint refs exactly like the lab does, then drives ONE channel at a time
 * and verifies the end effector moves in the direction the solver's channel
 * definitions promise:
 *   flex  → the limb swings FORWARD (+Z);
 *   ab    → the limb swings OUTWARD (right −X, left +X);
 *   knee  → the shin swings BACK and UP (heel to butt);
 *   bend  → the head moves FORWARD/DOWN (crunch).
 *
 * Usage: npx vite-node tools/labSignProbe.ts   (expect ALL PASS)
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
const buf = readFileSync(new URL(glb));
const loader = new GLTFLoader();

let fails = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) { fails++; console.log(`FAIL ${label}${extra ? ' — ' + extra : ''}`); }
  else console.log(` ok  ${label}`);
};

const DRIVEN = ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'thigh_r', 'calf_r'] as const;

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

  // canonical stand: full bind + the Idle's arm/head values + centered hands
  const idle = g.animations.find((a) => a.name === 'Idle');
  skeleton.pose();
  canonicalStand(bones, clone, skeleton, idle);
  if (skeleton) skeleton.update();

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

  const effector = (n: string) => {
    const b = bones.get(n)!;
    b.getWorldPosition(tmpV);
    return tmpV.clone();
  };
  const tmpV = new THREE.Vector3();
  const base = new Map<string, THREE.Vector3>();
  for (const n of ['hand_r', 'hand_l', 'foot_r', 'foot_l', 'Head']) base.set(n, effector(n));

  const apply = (ch: number[]) => {
    const pose = buildPose(ch, refs);
    for (const name of DRIVEN) {
      const q = pose.bones[name];
      const b = bones.get(name);
      if (q && b) b.quaternion.set(q.x, q.y, q.z, q.w);
    }
    clone.updateMatrixWorld(true);
    if (skeleton) skeleton.update();
  };
  const reset = () => {
    for (const name of DRIVEN) {
      const b = bones.get(name)!;
      b.quaternion.set(refs[name]!.r.x, refs[name]!.r.y, refs[name]!.r.z, refs[name]!.r.w);
    }
    clone.updateMatrixWorld(true);
  };

  const d = (n: string) => {
    const cur = effector(n);
    const b = base.get(n)!;
    return { x: cur.x - b.x, y: cur.y - b.y, z: cur.z - b.z };
  };

  const one = (label: string, ch: number[], effect: string, expect: (dx: number, dy: number, dz: number) => boolean) => {
    reset();
    apply(ch);
    const dd = d(effect);
    check(label, expect(dd.x, dd.y, dd.z), `Δ=${dd.x.toFixed(2)},${dd.y.toFixed(2)},${dd.z.toFixed(2)}`);
  };

  const z = () => Array(17).fill(0) as number[];
  // isolate channels (values chosen large enough to read clearly)
  one('armR flex swings hand forward', (() => { const c = z(); c[5] = 1.1; return c; })(), 'hand_r', (_x, _y, dz) => dz > 0.15);
  one('armL flex swings hand forward', (() => { const c = z(); c[8] = 1.1; return c; })(), 'hand_l', (_x, _y, dz) => dz > 0.15);
  one('armR ab swings hand outward (−X)', (() => { const c = z(); c[6] = 1.0; return c; })(), 'hand_r', (dx) => dx < -0.12);
  one('armL ab swings hand outward (+X)', (() => { const c = z(); c[9] = 1.0; return c; })(), 'hand_l', (dx) => dx > 0.12);
  one('elbowR curls forearm forward/up', (() => { const c = z(); c[7] = 1.4; return c; })(), 'hand_r', (_x, dy, dz) => dz > 0.1 && dy > -0.02);
  one('elbowL curls forearm forward/up', (() => { const c = z(); c[10] = 1.4; return c; })(), 'hand_l', (_x, dy, dz) => dz > 0.1 && dy > -0.02);
  one('thighR flex swings foot forward', (() => { const c = z(); c[11] = 1.0; return c; })(), 'foot_r', (_x, _y, dz) => dz > 0.12);
  one('thighL flex swings foot forward', (() => { const c = z(); c[14] = 1.0; return c; })(), 'foot_l', (_x, _y, dz) => dz > 0.12);
  one('legR ab swings foot outward (−X)', (() => { const c = z(); c[12] = 0.5; return c; })(), 'foot_r', (dx) => dx < -0.04);
  one('legL ab swings foot outward (+X)', (() => { const c = z(); c[15] = 0.5; return c; })(), 'foot_l', (dx) => dx > 0.04);
  one('kneeR bends shin back/up', (() => { const c = z(); c[13] = 1.3; return c; })(), 'foot_r', (_x, dy, dz) => dz < -0.05 && dy > 0.0);
  one('kneeL bends shin back/up', (() => { const c = z(); c[16] = 1.3; return c; })(), 'foot_l', (_x, dy, dz) => dz < -0.05 && dy > 0.0);
  one('spine bend crunches head forward/down', (() => { const c = z(); c[2] = 0.9; return c; })(), 'Head', (_x, dy, dz) => dz > 0.06 && dy < 0.05);
  reset();

  console.log(fails === 0 ? '\nARTICULATION PROBE: ALL PASS' : `\nARTICULATION PROBE: ${fails} FAILURES`);
  process.exitCode = fails ? 1 : 0;
}, (e) => { console.error('parse err', e); process.exit(1); });
