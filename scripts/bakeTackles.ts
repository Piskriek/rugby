/*
 * BAKE TACKLES — offline trajectory recorder.
 *
 * This is the expensive half of the precomputed-tackle system. It runs the
 * live verlet solver (`RagdollSim`) on the REAL shipped rig for every tackle
 * situation in the grid, captures each joint's solved LOCAL position and
 * quaternion every frame, and writes a single tiny-format binary that the
 * field runtime (`TackleBank` in tackleTrajectory.ts) plays back with zero
 * physics.
 *
 * Grid:
 *   role    — tackler / carrier
 *   kind    — STANDING takedown / horizontal DIVE
 *   speed   — 3 bins (slow ruck-ish, medium, fast "massive tackle")
 *   angle   — 6 bins around the body
 * = 2 × 2 × 3 × 6 = 72 recordings, 90 frames @ 60 Hz each.
 *
 * Run:  npx vite-node scripts/bakeTackles.ts
 * Output: public/assets/tackles/tackles.bin
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { RagdollSim } from '../src/render/ragdoll';
import { JOINT_NAMES, JOINT_COUNT, FRAME_COUNT, FRAME_DT, FLOATS_PER_JOINT, SPEED_BINS, ANGLE_BINS, TackleRole, TackleKind } from '../src/render/tackleTrajectory';

interface GltfNode {
  name?: string;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

function readGltf(pathname: string) {
  const buf = fs.readFileSync(pathname);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`not a glb: ${pathname}`);
  let off = 12;
  let json: unknown = null;
  const total = buf.readUInt32LE(8);
  while (off < total) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'JSON') json = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len));
    off += 8 + len;
  }
  if (!json) throw new Error('no JSON chunk');
  return json as { nodes?: GltfNode[]; scenes?: Array<{ nodes?: number[] }> };
}

function toMatrix(n: GltfNode): THREE.Matrix4 {
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(t[0], t[1], t[2]),
    new THREE.Quaternion(r[0], r[1], r[2], r[3]),
    new THREE.Vector3(s[0], s[1], s[2]),
  );
  return m;
}

function buildRig(nodes: GltfNode[], scene: number[]): THREE.Group {
  const root = new THREE.Group();
  const walk = (idx: number, parent: THREE.Object3D) => {
    const n = nodes[idx];
    const b = new THREE.Bone();
    b.name = n.name ?? `node_${idx}`;
    b.applyMatrix4(toMatrix(n));
    parent.add(b);
    for (const c of n.children ?? []) walk(c, b);
  };
  for (const idx of scene) walk(idx, root);
  root.updateMatrixWorld(true);
  return root;
}

const glb = readGltf(path.resolve('public/assets/models/rugby_player.glb'));
const nodes = glb.nodes ?? [];
const scene = glb.scenes?.[0]?.nodes ?? [];

const roles: TackleRole[] = ['tackler', 'carrier'];
const kinds: TackleKind[] = ['standing', 'dive'];

interface Meta { role: TackleRole; kind: TackleKind; speedBin: number; angleBin: number; floatStart: number; }
const metas: Meta[] = [];
const frames: number[] = []; // flat position+quat data, in the same frame order

for (let r = 0; r < roles.length; r++) {
  for (let k = 0; k < kinds.length; k++) {
    for (let si = 0; si < SPEED_BINS.length; si++) {
      for (let ai = 0; ai < ANGLE_BINS.length; ai++) {
        const role = roles[r];
        const kind = kinds[k];
        const speed = SPEED_BINS[si];
        const angle = ANGLE_BINS[ai];

        const seed = 10000 + r * 1000 + k * 100 + si * 10 + ai + 1;
        const rig = buildRig(nodes, scene);
        const sim = new RagdollSim(rig, seed);
        sim.capture(speed, angle);

        const floatStart = frames.length;
        metas.push({ role, kind, speedBin: si, angleBin: ai, floatStart });
        for (let f = 0; f < FRAME_COUNT; f++) {
          sim.step(FRAME_DT);
          for (const name of JOINT_NAMES) {
            const b = rig.getObjectByName(name) as THREE.Bone | undefined;
            if (b) {
              frames.push(b.position.x, b.position.y, b.position.z);
              frames.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
            } else {
              frames.push(0, 0, 0, 0, 0, 0, 1);
            }
          }
        }
      }
    }
  }
}

const expectedFloats = metas.length * JOINT_COUNT * FRAME_COUNT * FLOATS_PER_JOINT;
if (frames.length !== expectedFloats) {
  throw new Error(`bake mismatch: ${frames.length} vs ${expectedFloats}`);
}

/* -------- binary -------- */
const header = 12;
const metaBytes = metas.length * 8;
const totalBytes = header + metaBytes + frames.length * 4;
const buf = Buffer.alloc(totalBytes);
buf.write('TRKT', 0, 4, 'ascii');
buf.writeUInt8(1, 4);            // version
buf.writeUInt8(JOINT_COUNT, 5);
buf.writeUInt8(FRAME_COUNT, 6);
buf.writeUInt8(0, 7);            // reserved
buf.writeUInt32LE(metas.length, 8);
for (let i = 0; i < metas.length; i++) {
  const o = 12 + i * 8;
  buf.writeUInt8(metas[i].role === 'carrier' ? 1 : 0, o);
  buf.writeUInt8(metas[i].kind === 'dive' ? 1 : 0, o + 1);
  buf.writeUInt8(metas[i].speedBin, o + 2);
  buf.writeUInt8(metas[i].angleBin, o + 3);
  buf.writeUInt32LE(metas[i].floatStart, o + 4);
}
for (let i = 0; i < frames.length; i++) buf.writeFloatLE(frames[i], header + metaBytes + i * 4);

const out = path.resolve('public/assets/tackles/tackles.bin');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`baked ${metas.length} tackles × ${FRAME_COUNT} frames → ${out}`);
console.log(`size ${(buf.length / 1024 / 1024).toFixed(2)} MiB`);
