globalThis.self = globalThis as unknown as Window & typeof globalThis;
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
const glb = pathToFileURL('/home/user/rugby/rugby-2026/public/assets/models/rugby_player.glb').href;
const loader = new GLTFLoader();
const buf = readFileSync(new URL(glb));
const LEGS = ['thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
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
  skeleton.pose();
  clone.updateMatrixWorld(true);
  const bindLegs = new Map<string, THREE.Quaternion>();
  for (const n of LEGS) { const b = bones.get(n)!; bindLegs.set(n, b.quaternion.clone()); }
  const mixer = new THREE.AnimationMixer(clone);
  mixer.clipAction(idle).play();
  mixer.update(0.06);
  for (const n of LEGS) bones.get(n)!.quaternion.copy(bindLegs.get(n)!);
  clone.updateMatrixWorld(true);
  const pelvis = bones.get('pelvis')!;
  const axis = new THREE.Vector3(1,0,0).applyQuaternion(pelvis.getWorldQuaternion(new THREE.Quaternion()));
  axis.y = 0; axis.normalize();
  const fore = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0,1,0)).normalize();
  const q = new THREE.Quaternion();
  console.log('axis', axis.toArray().map(x=>x.toFixed(3)).join(','), 'fore', fore.toArray().map(x=>x.toFixed(3)).join(','));
  for (const side of ['upperarm_l','upperarm_r'] as const) {
    const ub = bones.get(side)!;
    const hb = bones.get(side === 'upperarm_l' ? 'hand_l' : 'hand_r')!;
    const target = (bones.get('hand_l')!.getWorldPosition(new THREE.Vector3()).dot(fore)
      + bones.get('hand_r')!.getWorldPosition(new THREE.Vector3()).dot(fore)) * 0.5;
    console.log('side', side, 'target', target.toFixed(4));
    for (let iter = 0; iter < 6; iter++) {
      const pSh = ub.getWorldPosition(new THREE.Vector3());
      const pH = hb.getWorldPosition(new THREE.Vector3());
      const off = pH.dot(fore) - target;
      const reach = pH.distanceTo(pSh);
      const delta = off / reach;
      console.log(` it${iter} hand z=${pH.z.toFixed(4)} y=${pH.y.toFixed(4)} off=${off.toFixed(4)} delta=${delta.toFixed(4)}`);
      if (Math.abs(delta) < 1e-4) break;
      const qD = new THREE.Quaternion().setFromAxisAngle(axis, delta);
      const qW = new THREE.Quaternion(); ub.getWorldQuaternion(qW);
      qW.premultiply(qD);
      const qP = new THREE.Quaternion(); (ub.parent as THREE.Bone).getWorldQuaternion(qP);
      ub.quaternion.copy(qP.clone().invert().multiply(qW));
      ub.updateWorldMatrix(true, false);
    }
  }
  const v = new THREE.Vector3();
  for (const s of ['hand_l','hand_r']) { const h = bones.get(s)!.getWorldPosition(v); console.log(s, h.toArray().map(x=>x.toFixed(4)).join(',')); }
}, (e) => { console.error('parse err', e); process.exit(1); });
