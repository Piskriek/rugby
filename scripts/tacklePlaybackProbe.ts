/*
 * PLAYBACK PROBE — verifies the BAKED tackle database end to end:
 *  - the compiled `TackleBank` loader parses tackles.bin correctly;
 *  - `pick()` returns a recording for every grid cell;
 *  - a real GLB rig playing back a selection stays finite and settles.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { TackleBank, TacklePlayback, JOINT_NAMES, FRAME_COUNT, FRAME_DT, JOINT_COUNT, FLOATS_PER_JOINT, angleBinFor, relativeAngle } from '../src/render/tackleTrajectory';

/* make TackleBank.load see the real file through fetch */
const file = fs.readFileSync(path.resolve('public/assets/tackles/tackles.bin'));
(globalThis as any).fetch = async () => ({
  ok: true,
  arrayBuffer: async () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
});
const bank = await TackleBank.load('ignored');
if (!bank) { console.error('bank failed to load'); process.exit(1); }
console.log('clips', bank.clips.length, 'dataFloats', bank.data.length);

const expected = 2 * 2 * 3 * 6;
let missing = 0;
for (const role of ['tackler', 'carrier'] as const) {
  for (const kind of ['standing', 'dive'] as const) {
    for (let s = 0; s < 3; s++) {
      for (let a = 0; a < 6; a++) {
        if (!bank.pick(role, kind, s, a)) { missing++; console.log('MISSING', role, kind, s, a); }
      }
    }
  }
}
console.log('pick coverage miss', missing, 'of', expected);
if (missing) process.exit(1);

/* ---- real rig playback ---- */
interface GltfNode { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }
function readGltf(pathname: string) {
  const buf = fs.readFileSync(pathname);
  let off = 12, json: any = null;
  const total = buf.readUInt32LE(8);
  while (off < total) {
    const len = buf.readUInt32LE(off), type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len));
    off += 8 + len;
  }
  return json as { nodes: GltfNode[]; scenes?: Array<{ nodes?: number[] }> };
}
function toMatrix(n: GltfNode): THREE.Matrix4 {
  const t = n.translation ?? [0, 0, 0], r = n.rotation ?? [0, 0, 0, 1], s = n.scale ?? [1, 1, 1];
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(...t), new THREE.Quaternion(r[0], r[1], r[2], r[3]), new THREE.Vector3(...s));
  return m;
}
function buildRig(nodes: GltfNode[], scene: number[]): THREE.Group {
  const root = new THREE.Group();
  const walk = (idx: number, parent: THREE.Object3D) => {
    const n = nodes[idx]; const b = new THREE.Bone();
    b.name = n.name ?? `n${idx}`; b.applyMatrix4(toMatrix(n)); parent.add(b);
    for (const c of n.children ?? []) walk(c, b);
  };
  for (const i of scene) walk(i, root);
  root.updateMatrixWorld(true);
  return root;
}
const glb = readGltf(path.resolve('public/assets/models/rugby_player.glb'));
let bad = false;
for (const role of ['tackler', 'carrier'] as const) {
  for (const kind of ['standing', 'dive'] as const) {
    const rig = buildRig(glb.nodes ?? [], glb.scenes?.[0]?.nodes ?? []);
    rig.position.set(12, 0, -18);
    rig.rotation.y = 0.7;
    rig.updateMatrixWorld(true);
    const clip = bank.pick(role, kind, 2, angleBinFor(relativeAngle(0.4, 0.9)))!;
    const play = new TacklePlayback(rig, clip, bank.data);
    let maxY = 0;
    for (let f = 0; f < FRAME_COUNT; f++) {
      rig.updateMatrixWorld(true);
      play.advance(FRAME_DT);
      rig.updateMatrixWorld(true);
      for (const name of ['pelvis', 'spine_03', 'Head', 'hand_l', 'foot_r']) {
        const b = rig.getObjectByName(name) as THREE.Bone | undefined;
        const p = new THREE.Vector3();
        if (b) b.getWorldPosition(p);
        maxY = Math.max(maxY, p.y);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) bad = true;
      }
    }
    const pel = new THREE.Vector3();
    (rig.getObjectByName('pelvis') as THREE.Bone | undefined)?.getWorldPosition(pel);
    console.log(role.padEnd(8), kind.padEnd(8), 'maxY', maxY.toFixed(2), 'pelvis', pel.x.toFixed(2), pel.y.toFixed(2), pel.z.toFixed(2));
  }
}
console.log('finite', !bad, 'JOINT_COUNT', JOINT_COUNT, 'floatsPerJoint', FLOATS_PER_JOINT);
if (bad) process.exit(1);
console.log('PASS');
