// dev: inspect Idle clip — foot/calf z-stagger and pose symmetry over time
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
  console.log('animations:', g.animations.map((a) => `${a.name}(${a.duration.toFixed(2)}s ${a.tracks.length}trk)`).join(' '));
  const clone = SkeletonUtils.clone(g.scene);
  const bones = new Map<string, THREE.Bone>();
  let skeleton: THREE.Skeleton | undefined;
  clone.traverse((o) => {
    const b = o as THREE.Bone;
    if (b.isBone) bones.set(b.name, b);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skeleton = (o as THREE.SkinnedMesh).skeleton;
  });
  if (!skeleton) throw new Error('no skeleton');
  skeleton.pose();
  const idle = g.animations.find((a) => a.name === 'Idle');
  const mixer = new THREE.AnimationMixer(clone);
  const act = mixer.clipAction(idle);
  act.play();
  const v = new THREE.Vector3();
  const head = bones.get('Head')!, pelv = bones.get('pelvis')!, fl = bones.get('foot_l')!, fr = bones.get('foot_r')!;
  console.log('t  headY headZ pelvY pelvZ footL(y,z,x) footR(y,z,x)');
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    mixer.update(1 / 24);
    clone.updateMatrixWorld(true);
    skeleton.update();
    const p = (b: THREE.Bone) => { b.getWorldPosition(v); return v; };
    const fL = p(fl), fR = p(fr), hd = p(head), pv = p(pelv);
    console.log(
      `${t.toFixed(2)} ${hd.y.toFixed(3)} ${hd.z.toFixed(3)} ${pv.y.toFixed(3)} ${pv.z.toFixed(3)} ` +
      `${fL.y.toFixed(3)} ${fL.z.toFixed(3)} ${fL.x.toFixed(3)}  ${fR.y.toFixed(3)} ${fR.z.toFixed(3)} ${fR.x.toFixed(3)}`,
    );
  }
}, (e) => { console.error('parse err', e); process.exit(1); });
