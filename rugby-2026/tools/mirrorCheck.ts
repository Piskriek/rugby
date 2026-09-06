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
  if (!skeleton) throw new Error('no');
  skeleton.pose();
  const wq = (n: string) => { const q = new THREE.Quaternion(); bones.get(n)!.getWorldQuaternion(q); return q; };
  const dump = (label: string) => {
    const qL = wq('upperarm_l'), qR = wq('upperarm_r');
    const fl = (q: THREE.Quaternion) => `(${q.w.toFixed(2)},${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)})`;
    // try (w,-x,y,z) and (w,-x,-y,z)
    console.log(label, 'qL', fl(qL), 'qR', fl(qR));
  };
  dump('bind');
  skeleton.pose();
  const idle = g.animations.find((a) => a.name === 'Idle')!;
  const mixer = new THREE.AnimationMixer(clone);
  const act = mixer.clipAction(idle); act.play(); mixer.update(0.06);
  dump('idle0.06');
}, (e) => { console.error('err', e); process.exit(1); });
