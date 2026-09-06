globalThis.self = globalThis as unknown as Window & typeof globalThis;
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
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
  skeleton!.pose();
  const idle = g.animations.find((a) => a.name === 'Idle')!;
  const mixer = new THREE.AnimationMixer(clone);
  mixer.clipAction(idle).play();
  mixer.update(0.06);
  clone.updateMatrixWorld(true);
  const L = bones.get('upperarm_l')!, R = bones.get('upperarm_r')!;
  const qL = L.quaternion.clone(), qR = R.quaternion.clone();
  const f = (q: THREE.Quaternion) => `(${q.w.toFixed(3)},${q.x.toFixed(3)},${q.y.toFixed(3)},${q.z.toFixed(3)})`;
  console.log('qL local', f(qL), ' qR local', f(qR));
  console.log('dot qL,(w,-x,-y,z)qR =', qL.w * qR.w + qL.x * (-qR.x) + qL.y * (-qR.y) + qL.z * qR.z);
  const handL = bones.get('hand_l')!, handR = bones.get('hand_r')!;
  const v = new THREE.Vector3();
  handL.getWorldPosition(v); console.log('now hand_l', v.toArray().map(x=>x.toFixed(2)).join(','));
  handR.getWorldPosition(v); console.log('now hand_r', v.toArray().map(x=>x.toFixed(2)).join(','));
  // set R := (w,-x,-y,z) of L  (local flip)
  R.quaternion.set(-qL.x, -qL.y, qL.z, qL.w);
  clone.updateMatrixWorld(true);
  handR.getWorldPosition(v); console.log('R=flip(L) hand_r', v.toArray().map(x=>x.toFixed(2)).join(','));
  // set L := (w,-x,-y,z) of qR (flip R onto L)
  L.quaternion.set(-qR.x, -qR.y, qR.z, qR.w);
  clone.updateMatrixWorld(true);
  handL.getWorldPosition(v); console.log('L=flip(R) hand_l', v.toArray().map(x=>x.toFixed(2)).join(','));
}, (e) => { console.error('err', e); process.exit(1); });
