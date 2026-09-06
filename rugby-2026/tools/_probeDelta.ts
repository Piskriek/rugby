globalThis.self = globalThis as unknown as Window & typeof globalThis;
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { canonicalStand, centerArmHang } from '../src/physics/neutralStand';
const glb = pathToFileURL('/home/user/rugby/rugby-2026/public/assets/models/rugby_player.glb').href;
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
  const v = new THREE.Vector3();
  const show = (tag: string) => {
    const p = (n: string) => bones.get(n)!.getWorldPosition(v).clone();
    const sh = p('upperarm_l'), el = p('lowerarm_l'), hd = p('hand_l');
    console.log(`${tag}: sh(${sh.x.toFixed(3)},${sh.y.toFixed(3)},${sh.z.toFixed(3)}) el(${el.x.toFixed(3)},${el.y.toFixed(3)},${el.z.toFixed(3)}) hand(${hd.x.toFixed(3)},${hd.y.toFixed(3)},${hd.z.toFixed(3)}) | sh-el=${sh.distanceTo(el).toFixed(3)} el-hd=${el.distanceTo(hd).toFixed(3)}`);
  };
  show('canonical');
  for (let i = 0; i < 3; i++) { centerArmHang(bones); clone.updateMatrixWorld(true); show(`pass${i+1}`); }
  // now manual single small rotation: premultiply +0.1 on upperarm_l only
  const ub = bones.get('upperarm_l')!;
  const parent = ub.parent as THREE.Bone;
  const qP = new THREE.Quaternion(); parent.getWorldQuaternion(qP);
  const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), 0.1);
  const qT = qP.clone().invert().multiply(qX).multiply(qP);
  ub.quaternion.premultiply(qT);
  clone.updateMatrixWorld(true);
  show('after +0.1X on upperarm_l');
});
