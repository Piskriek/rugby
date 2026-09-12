/**
 * assetverify.ts — packed player.glb contract.
 *
 *   npx vite-node scripts/assetverify.ts
 *
 * (a) player.glb exists, parses as GLB, and contains the required clips.
 * (b) locomotion clips have near-zero horizontal root displacement (< 0.05 m).
 * (c) vertex count is below the previous Superhero_Male baseline (8483).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB = path.join(ROOT, 'public/assets/models/player.glb');
const BASELINE_VERTS = 8483;
const MAX_MB = 8;
const MAX_XZ_M = 0.05;
const TARGET_HEIGHT_M = 1.80;

const REQUIRED = [
  'Idle', 'Walk', 'Jog', 'Run', 'Sprint',
  'Tackle', 'Dive', 'ScrumDrive', 'LineoutJump',
  'LineoutThrow', 'SideDive', 'DoubleLegTackle',
];

const LOCO = ['Idle', 'Walk', 'Jog', 'Run', 'Sprint', 'Sidestep', 'Shuffle', 'Backpedal'];
const ROOT_BONES = /^(Hips|Human_Armature|pelvis|mixamorigHips|root|Armature)$/;

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(42)} ${detail}`);
}

globalThis.self = globalThis as typeof globalThis & Window;

const exists = fs.existsSync(GLB);
check('player.glb exists', exists, exists ? GLB : 'missing');
if (!exists) {
  process.exit(1);
}

const st = fs.statSync(GLB);
const mb = st.size / (1024 * 1024);
check('GLB size < 8 MiB', mb < MAX_MB, `${mb.toFixed(2)} MiB`);

const buf = fs.readFileSync(GLB);
const magic = buf.slice(0, 4).toString('ascii');
check('GLB magic', magic === 'glTF', JSON.stringify(magic));

const loader = new GLTFLoader();
const gltf = await new Promise<Awaited<ReturnType<typeof loader.parse>>>((res, rej) => {
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
});

const names = gltf.animations.map((a) => a.name);
check('parses without error', true, `${names.length} clips, ${gltf.scene.children.length} root children`);
check('no baseball Pass clip', !names.includes('Pass'), names.includes('Pass') ? 'Pass present' : 'absent');

for (const req of REQUIRED) {
  check(`clip ${req}`, names.includes(req), names.includes(req) ? 'present' : 'MISSING');
}

let verts = 0;
const bones: string[] = [];
gltf.scene.traverse((o) => {
  const mesh = o as THREE.SkinnedMesh;
  if (mesh.isSkinnedMesh || (mesh as THREE.Mesh).isMesh) {
    verts += mesh.geometry?.attributes?.position?.count ?? 0;
  }
  if ((o as THREE.Bone).isBone) bones.push(o.name);
});
check('vertex budget < Superhero baseline', verts < BASELINE_VERTS, `${verts} verts (baseline ${BASELINE_VERTS})`);
check('Hips bone', bones.includes('Hips'), bones.includes('Hips') ? 'Hips' : bones.slice(0, 8).join(','));
check('Spine/Spine1/Neck/Head', ['Spine', 'Spine1', 'Neck', 'Head'].every((n) => bones.includes(n)),
  ['Spine', 'Spine1', 'Neck', 'Head'].filter((n) => bones.includes(n)).join(','));
check('LeftArm/RightArm', bones.includes('LeftArm') && bones.includes('RightArm'), 'arms');
check('LeftLeg/RightLeg', bones.includes('LeftLeg') && bones.includes('RightLeg'), 'legs');

gltf.scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(gltf.scene);
const nativeH = Math.max(1e-6, box.max.y - box.min.y);
const toM = TARGET_HEIGHT_M / nativeH;

for (const clip of gltf.animations) {
  if (!LOCO.includes(clip.name)) continue;
  let maxXZ = 0;
  for (const track of clip.tracks) {
    const [bone, prop] = track.name.split('.');
    if (prop !== 'position') continue;
    if (!ROOT_BONES.test(bone)) continue;
    const v = track.values;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
      minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
      minZ = Math.min(minZ, v[i + 2]); maxZ = Math.max(maxZ, v[i + 2]);
    }
    maxXZ = Math.max(maxXZ, (maxX - minX) * toM, (maxZ - minZ) * toM);
  }
  check(`in-place ${clip.name}`, maxXZ < MAX_XZ_M, `Δxz=${maxXZ.toFixed(4)} m`);
}

/* World-space sample. Local hip Δ × (1.8/bbox.h) ignores Human_Armature's
 * ~69× scale; mixer-sampling Hips after fitting height to 1.80 m is the
 * displacement the 2D engine would double-apply. */
{
  const hips = gltf.scene.getObjectByName('Hips') as THREE.Object3D | undefined;
  check('Hips for mixer sample', !!hips, hips ? 'Hips' : 'MISSING');
  if (hips) {
    gltf.scene.scale.setScalar(toM);
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const p = new THREE.Vector3();
    for (const name of LOCO) {
      const clip = gltf.animations.find((c) => c.name === name);
      if (!clip) continue;
      mixer.stopAllAction();
      gltf.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh && m.skeleton) m.skeleton.pose();
      });
      const act = mixer.clipAction(clip);
      act.play();
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const n = Math.max(2, Math.ceil(clip.duration * 30));
      for (let i = 0; i <= n; i++) {
        mixer.setTime(Math.min(clip.duration, i / 30));
        gltf.scene.updateMatrixWorld(true);
        hips.getWorldPosition(p);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const dxz = Math.hypot(maxX - minX, maxZ - minZ);
      check(`world in-place ${name}`, dxz < MAX_XZ_M, `Δxz=${dxz.toFixed(4)} m`);
      act.stop();
      mixer.uncacheAction(clip);
    }
  }
}

if (!ok) {
  console.error('\nassetverify FAILED');
  process.exit(1);
}
console.log('\nassetverify OK');
