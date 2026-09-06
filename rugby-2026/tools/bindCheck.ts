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
  clone.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const pos = (n: string) => { const b = bones.get(n); if (!b) return null; b.getWorldPosition(v); return [v.x, v.y, v.z].map((x) => x.toFixed(3)).join(',') + ` q=${b.quaternion.toArray().map((x) => x.toFixed(2)).join(',')}`; };
  for (const n of ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'toe_l', 'toe_r', 'upperarm_l', 'upperarm_r', 'hand_l', 'hand_r', 'Head']) {
    console.log(n.padEnd(10), pos(n) ?? '(none)');
  }
}, (e) => { console.error('parse err', e); process.exit(1); });
