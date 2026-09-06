import * as THREE from 'three';
import { RagdollSim } from '../src/render/ragdoll';

/** Build a minimal Unreal-style skeleton with plausible rest offsets. */
function buildRig() {
  const root = new THREE.Group();
  const arm = new THREE.Object3D(); root.add(arm);
  const rootBone = new THREE.Bone(); rootBone.name = 'root'; arm.add(rootBone);

  const mk = (name: string, parent: THREE.Object3D, pos: THREE.Vector3) => {
    const b = new THREE.Bone();
    b.name = name; b.position.copy(pos);
    parent.add(b);
    return b;
  };

  const pelvis = mk('pelvis', rootBone, new THREE.Vector3(0, 0.9, 0));
  const spine1 = mk('spine_01', pelvis, new THREE.Vector3(0, 0.13, 0));
  const spine2 = mk('spine_02', spine1, new THREE.Vector3(0, 0.13, 0));
  const spine3 = mk('spine_03', spine2, new THREE.Vector3(0, 0.13, 0));
  const neck = mk('neck_01', spine3, new THREE.Vector3(0, 0.12, 0));
  mk('Head', neck, new THREE.Vector3(0, 0.20, 0));
  const clavL = mk('clavicle_l', spine3, new THREE.Vector3(0, 0.08, 0.03));
  const uaL = mk('upperarm_l', clavL, new THREE.Vector3(-0.06, 0.02, 0));
  const laL = mk('lowerarm_l', uaL, new THREE.Vector3(0, -0.26, 0));
  mk('hand_l', laL, new THREE.Vector3(0, -0.24, 0));
  const clavR = mk('clavicle_r', spine3, new THREE.Vector3(0, 0.08, -0.03));
  const uaR = mk('upperarm_r', clavR, new THREE.Vector3(0.06, 0.02, 0));
  const laR = mk('lowerarm_r', uaR, new THREE.Vector3(0, -0.26, 0));
  mk('hand_r', laR, new THREE.Vector3(0, -0.24, 0));
  const thL = mk('thigh_l', pelvis, new THREE.Vector3(-0.10, -0.04, 0));
  const caL = mk('calf_l', thL, new THREE.Vector3(0, -0.44, 0));
  mk('foot_l', caL, new THREE.Vector3(0, -0.42, 0.06));
  const thR = mk('thigh_r', pelvis, new THREE.Vector3(0.10, -0.04, 0));
  const caR = mk('calf_r', thR, new THREE.Vector3(0, -0.44, 0));
  mk('foot_r', caR, new THREE.Vector3(0, -0.42, -0.06));
  root.updateMatrixWorld(true);
  return { root, pelvis, spine3 };
}

const rig = buildRig();
/* verify the segment direction is rotated into WORLD space before aiming */
rig.root.rotation.y = 0.8;
rig.root.updateMatrixWorld(true);
const sim = new RagdollSim(rig.root, 7.3);
sim.capture(8);
const dt = 1 / 60;
let maxY = 0, bad = false;
for (let i = 0; i < 120; i++) {
  sim.step(dt);
  rig.root.updateMatrixWorld(true);
  for (const name of ['pelvis', 'spine_03', 'Head', 'hand_l', 'foot_r']) {
    const b = rig.root.getObjectByName(name) as THREE.Bone | undefined;
    const p = new THREE.Vector3();
    if (b) b.getWorldPosition(p);
    maxY = Math.max(maxY, p.y);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) bad = true;
  }
}
const pelvisP = new THREE.Vector3();
rig.root.getObjectByName('pelvis')!.getWorldPosition(pelvisP);
console.log('maxY over 120 frames', maxY.toFixed(3), 'finite', !bad);
console.log('pelvis settled', pelvisP.x.toFixed(2), pelvisP.y.toFixed(2), pelvisP.z.toFixed(2));
console.log(sim.weight, 'weight');
