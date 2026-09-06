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
  console.log('animations:', g.animations.map(a => a.name + ' dur=' + a.duration.toFixed(2)).join(', '));
  const idle = g.animations.find(a => a.name === 'Idle')!;
  const clone = SkeletonUtils.clone(g.scene);
  const bones = new Map<string, THREE.Bone>();
  clone.traverse(o => { const b = o as THREE.Bone; if (b.isBone) bones.set(b.name, b); });
  const mixer = new THREE.AnimationMixer(clone);
  mixer.clipAction(idle).play();
  const v = new THREE.Vector3();
  console.log('t    foot_l.z foot_r.z | foot_l.y foot_r.y | calf_l.z calf_r.z | hand_l.y hand_r.y hand_l.z hand_r.z | pelvis.y');
  for (let i = 0; i <= 12; i++) {
    const t = i / 12 * idle.duration;
    mixer.setTime(t);
    clone.updateMatrixWorld(true);
    const pos = (n: string) => { bones.get(n)!.getWorldPosition(v); return `(${v.y.toFixed(3)},${v.z.toFixed(3)})`; };
    console.log(t.toFixed(2),
      'feet zL,zR', bones.get('foot_l')!.getWorldPosition(v) && `(${v.z.toFixed(3)},${(()=>{bones.get('foot_r')!.getWorldPosition(v);return v.z.toFixed(3)})()})`,
      'yL,yR', (()=>{bones.get('foot_l')!.getWorldPosition(v);const a=v.y.toFixed(3);bones.get('foot_r')!.getWorldPosition(v);return `(${a},${v.y.toFixed(3)})`})(),
      'hand y/z', (()=>{bones.get('hand_l')!.getWorldPosition(v);const a=`${v.y.toFixed(3)}/${v.z.toFixed(3)}`;bones.get('hand_r')!.getWorldPosition(v);return `${a},${v.y.toFixed(3)}/${v.z.toFixed(3)}`})(),
      'pelv', bones.get('pelvis')!.getWorldPosition(v) && v.y.toFixed(3));
  }
});
