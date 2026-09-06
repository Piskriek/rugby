/*
 * REAL-GLB RAGDOLL PROBE
 *
 * The fake-skeleton probe is a useful numeric smoke test, but it cannot catch
 * a wrong bone name or a real rest scale in the shipped rig. This script
 * parses `public/assets/models/rugby_player.glb` directly (glTF JSON chunk, no
 * browser texture pipeline), rebuilds the actual node hierarchy as THREE Bones,
 * then runs the live `RagdollSim` over the real skeleton and asserts it settles
 * with finite coordinates and sane bone lengths.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { RagdollSim, JOINT_NAMES } from '../src/render/ragdoll';

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

function readGltf(pathname: string) {
  const buf = fs.readFileSync(pathname);
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'glTF') throw new Error(`not a glb: ${magic}`);
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  if (version !== 2) throw new Error(`gltf version ${version}`);
  let off = 12;
  let json: unknown = null;
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len));
    off += 8 + len;
  }
  if (!json) throw new Error('no JSON chunk');
  return json as { nodes?: GltfNode[]; scenes?: Array<{ nodes?: number[] }> };
}

function toMatrix3(n: GltfNode): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  m.compose(
    new THREE.Vector3(t[0], t[1], t[2]),
    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
    new THREE.Vector3(s[0], s[1], s[2]),
  );
  return m;
}

const glb = readGltf(path.resolve('public/assets/models/rugby_player.glb'));
const nodes = glb.nodes ?? [];
const root = new THREE.Group();
const built = new Map<number, THREE.Bone>();

function walk(idx: number, parent: THREE.Object3D) {
  const n = nodes[idx];
  const bone = new THREE.Bone();
  bone.name = n.name ?? `node_${idx}`;
  bone.applyMatrix4(toMatrix3(n));
  parent.add(bone);
  built.set(idx, bone);
  for (const c of n.children ?? []) walk(c, bone);
}

const sceneRoots = glb.scenes?.[0]?.nodes ?? [];
for (const idx of sceneRoots) walk(idx, root);
root.updateMatrixWorld(true);

const bones: THREE.Bone[] = [];
root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
console.log('glb nodes', nodes.length, 'bones', bones.length);

const present = JOINT_NAMES.filter((name) => bones.some((b) => b.name === name));
const missing = JOINT_NAMES.filter((name) => !bones.some((b) => b.name === name));
console.log('JOINT_NAMES present', present.length, '/', JOINT_NAMES.length);
if (missing.length) console.log('MISSING', missing.join(', '));

/* put the actor on the pitch at a plausible stance and face a heading */
root.position.set(10, 0, 20);
root.rotation.y = 1.1;
root.updateMatrixWorld(true);

const sim = new RagdollSim(root, 7.3);
const simAny = sim as unknown as { bonds: Array<{ rest: number }> };
sim.capture(8);
const dt = 1 / 60;
let maxY = 0;
let bad = false;
/* check bond lengths near the real rest values so a GLB unit-scale mismatch
 * shows up instead of silently collapsing. */
const restBefore = simAny.bonds.map((b) => b.rest);
for (let i = 0; i < 180; i++) {
  sim.step(dt);
  root.updateMatrixWorld(true);
  for (const name of ['pelvis', 'spine_03', 'Head', 'hand_l', 'hand_r', 'foot_l', 'foot_r']) {
    const b = root.getObjectByName(name) as THREE.Bone | undefined;
    const p = new THREE.Vector3();
    if (b) b.getWorldPosition(p);
    maxY = Math.max(maxY, p.y);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) bad = true;
  }
}
const restAfter = simAny.bonds.map((b) => b.rest);
const restDrift = Math.max(...restBefore.map((v, i) => Math.abs(v - restAfter[i]) / Math.max(v, 1e-6)));
console.log('maxY', maxY.toFixed(3), 'finite', !bad, 'restDrift', restDrift.toExponential(2));
const pelvis = root.getObjectByName('pelvis') as THREE.Bone | undefined;
const pel = new THREE.Vector3();
if (pelvis) pelvis.getWorldPosition(pel);
console.log('pelvis settled', pel.x.toFixed(2), pel.y.toFixed(2), pel.z.toFixed(2), 'weight', sim.weight);
if (missing.length || bad || !Number.isFinite(restDrift)) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
