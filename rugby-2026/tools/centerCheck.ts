/** CENTERCHECK — does centerArmHang actually put both hands on one plane? */
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
  const v = new THREE.Vector3();
  const printHands = (tag: string) => {
    const hl = bones.get('hand_l')!.getWorldPosition(v).clone();
    const hr = bones.get('hand_r')!.getWorldPosition(v).clone();
    const ul = bones.get('upperarm_l')!.getWorldPosition(v).clone();
    const ur = bones.get('upperarm_r')!.getWorldPosition(v).clone();
    console.log(`${tag}: hand_l z=${hl.z.toFixed(4)} y=${hl.y.toFixed(4)} | hand_r z=${hr.z.toFixed(4)} y=${hr.y.toFixed(4)} | shL y=${ul.y.toFixed(4)} z=${ul.z.toFixed(4)} | shR y=${ur.y.toFixed(4)} z=${ur.z.toFixed(4)}`);
  };
  canonicalStand(bones, clone, skeleton, idle);
  clone.updateMatrixWorld(true);
  printHands('canonical once');
  for (let i = 0; i < 3; i++) {
    centerArmHang(bones, clone);
    clone.updateMatrixWorld(true);
    printHands(`after extra center #${i + 1}`);
  }
}, (e) => { console.error('parse err', e); process.exit(1); });
