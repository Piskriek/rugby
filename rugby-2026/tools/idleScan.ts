// dev: scan the Idle clip for a symmetric stand frame (feet side-by-side)
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
  clone.traverse((o) => {
    const b = o as THREE.Bone;
    if (b.isBone) bones.set(b.name, b);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.SkinnedMesh).skeleton.pose();
  });
  const idle = g.animations.find((a) => a.name === 'Idle')!;
  const mixer = new THREE.AnimationMixer(clone);
  const act = mixer.clipAction(idle);
  act.play();
  mixer.update(0);
  clone.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const pos = (n: string) => { bones.get(n)!.getWorldPosition(v); return [v.x, v.y, v.z] as const; };
  console.log('t  footLz footRz |zR-zL| handLz handRz pelvL/Rx kLx kRx');
  for (let i = 0; i < 50; i++) {
    const t = i * 0.05;
    if (i > 0) { mixer.update(0.05); clone.updateMatrixWorld(true); }
    const [flx, fly, flz] = pos('foot_l');
    const [frx, fry, frz] = pos('foot_r');
    const [, , hlz] = pos('hand_l');
    const [, , hrz] = pos('hand_r');
    const [plx] = pos('thigh_l');
    const [prx] = pos('thigh_r');
    console.log(
      `${t.toFixed(2)} ${flz.toFixed(3)} ${frz.toFixed(3)} ${Math.abs(frz - flz).toFixed(3)} ` +
      `${hlz.toFixed(3)} ${hrz.toFixed(3)} ${plx.toFixed(3)} ${prx.toFixed(3)} ` +
      `fly=${fly.toFixed(3)} fry=${fry.toFixed(3)}`,
    );
  }
}, (e) => { console.error('parse err', e); process.exit(1); });
