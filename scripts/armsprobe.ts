/**
 * ARMSPROBE — world-space arm-splay detector. Instead of comparing against
 * the bind quaternion (which only flags an exact rest pose), this measures
 * the ACTUAL world direction of each upper arm and flags frames where the
 * arm is held out to the side (abducted ~horizontal), which is what reads as
 * "arms out / T-pose" to a player. Records the FSM state + engine clip for
 * every flagged run so the culprit animation is identifiable.
 *
 * Usage: npx vite-node scripts/armsprobe.ts [seconds] [seed]
 */
import fs from 'node:fs';
import * as THREE from 'three';
(globalThis as Record<string, unknown>).self = globalThis;
(globalThis as Record<string, unknown>).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => undefined }) }),
};
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Director, NO_INPUT, MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { ThreePlayerManager } from '../src/render/ThreePlayerManager';

function stripTextures(buf: Buffer): ArrayBuffer {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  for (const m of json.materials ?? []) {
    const pbr = m.pbrMetallicRoughness ?? {};
    delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  const jb = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (jb.length % 4)) % 4;
  const binChunk = buf.slice(20 + jsonLen);
  const out = Buffer.alloc(12 + 8 + jb.length + pad + binChunk.length);
  out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jb.length + pad, 12); out.writeUInt32LE(0x4E4F534A, 16);
  jb.copy(out, 20);
  for (let i = 0; i < pad; i++) out[20 + jb.length + i] = 0x20;
  binChunk.copy(out, 20 + jb.length + pad);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}
async function parseGlb(path: string) {
  const loader = new GLTFLoader();
  const buf = fs.readFileSync(path);
  return await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((res, rej) => {
    loader.parse(stripTextures(buf), '', (g) => res(g), rej);
  });
}
const stripRootMotion = (clip: THREE.AnimationClip): THREE.AnimationClip => {
  const out = clip.clone();
  for (const track of out.tracks) {
    const [bone, prop] = track.name.split('.');
    if (prop !== 'position') continue;
    if (!['pelvis', 'Hips', 'mixamorigHips', 'root', 'Armature'].includes(bone)) continue;
    const v = track.values; const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return out;
};

const seconds = Number(process.argv[2] ?? 240);
const seed = Number(process.argv[3] ?? 7);
const main = await parseGlb('public/assets/models/rugby_player.glb');
const pair = await parseGlb('public/assets/models/tackle_pair.glb');

seedRng(seed);
const base = gateConfig(3);
const cfg: MatchConfig = { ...base, cpuA: true, cpuB: true };
const d = new Director(cfg);

const scene = new THREE.Scene();
const mgr = new ThreePlayerManager({ scene } as never);
const M = mgr as unknown as Record<string, unknown>;
M.template = main.scene;
M.templateClips = main.animations.map(stripRootMotion).concat(pair.animations);
(M as { prepareTemplate: () => void }).prepareTemplate();
M.ready = true;

const pool = M.pool as Map<string, { root: THREE.Group; proc: { state: string }; st: { spd: number } }>;
const run = new Map<string, { n: number; hist: string[]; armDir: string }>();
const runSingle = new Map<string, { n: number; hist: string[]; armDir: string }>();
const samples: string[] = [];
const singleSamples: string[] = [];
let flaggedRuns = 0;
let singleRuns = 0;
const dt = 1 / 60;
const frames = Math.ceil(seconds * 60);
const _v = new THREE.Vector3();
const _shoulder = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _up = new THREE.Vector3();

/* An arm counts as "splayed" when the upper-arm segment (shoulder->elbow) is
 * close to horizontal AND points well away from the body's vertical axis
 * (abduction). We compare against the torso's up direction. */
function splayed(root: THREE.Group, side: 'l' | 'r'): { out: boolean; horiz: number; abd: number } {
  const upper = root.getObjectByName(`upperarm_${side}`) as THREE.Bone | undefined;
  const lower = root.getObjectByName(`lowerarm_${side}`) as THREE.Bone | undefined;
  if (!upper || !lower) return { out: false, horiz: 0, abd: 0 };
  upper.updateWorldMatrix(true, false);
  lower.updateWorldMatrix(true, false);
  _shoulder.setFromMatrixPosition(upper.matrixWorld);
  _elbow.setFromMatrixPosition(lower.matrixWorld);
  _v.copy(_elbow).sub(_shoulder);
  const len = _v.length();
  if (len < 0.001) return { out: false, horiz: 0, abd: 0 };
  _v.normalize();
  /* torso up: use the chest/spine bone if present, else the root up */
  const chest = root.getObjectByName('chest') ?? root.getObjectByName('spine_02') ?? root.getObjectByName('spine') ?? root;
  _up.set(0, 1, 0).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()));
  const horiz = 1 - Math.abs(_v.dot(_up));         // 1 = perfectly horizontal
  /* abduction: horizontal component magnitude relative to total */
  const abd = horiz;                                 // same measure for our purposes
  return { out: horiz > 0.75, horiz, abd };
}

for (let i = 0; i < frames && !d.over; i++) {
  d.update(dt, NO_INPUT, new Set());
  mgr.update(d, { w: 1280, h: 720 } as never, { x: 0, z: 0, h: 20, yaw: 0 } as never, dt);

  for (const [key, inst] of pool) {
    if (!inst.root.visible) continue;
    const r = run.get(key) ?? { n: 0, hist: [], armDir: '' };
    const lp = d.live.find((q) => `${q.team}:${q.num}` === key);
    const L = splayed(inst.root, 'l');
    const Rt = splayed(inst.root, 'r');
    const bothOut = L.out && Rt.out;
    const anyOut = L.out || Rt.out;
    r.hist.push(`${i}:${inst.proc.state}@${inst.st.spd.toFixed(0)}(${lp?.clip ?? '?'})`);
    if (r.hist.length > 14) r.hist.shift();
    if (bothOut) {
      r.n++;
      r.armDir = `L=${L.horiz.toFixed(2)} R=${Rt.horiz.toFixed(2)}`;
      if (r.n === 4) {   // sustained: 4+ consecutive frames (~66 ms)
        flaggedRuns++;
        if (samples.length < 40) samples.push(`f${i} ${key} ${r.armDir} | ${r.hist.join(' ')}`);
      }
    } else {
      r.n = 0;
    }
    run.set(key, r);
    /* single-arm (one wing out) — the Death clip splays one arm at a time */
    const s = runSingle.get(key) ?? { n: 0, hist: [...r.hist], armDir: '' };
    if (anyOut) {
      s.n++;
      s.armDir = `L=${L.horiz.toFixed(2)} R=${Rt.horiz.toFixed(2)}`;
      if (s.n === 10) {  // ~166 ms of a wing held out
        singleRuns++;
        if (singleSamples.length < 40) singleSamples.push(`f${i} ${key} ${s.armDir} | ${r.hist.join(' ')}`);
      }
    } else s.n = 0;
    runSingle.set(key, s);
  }
}

console.log(`\n=== ARMSPROBE ${seconds}s seed ${seed} (world-space arm splay, 4+ frames) ===`);
console.log(`sustained BOTH-arms-out runs: ${flaggedRuns}`);
const byState = new Map<string, number>();
for (const s of samples) {
  const m = s.match(/\|\s*(.*)$/);
  const last = (m?.[1] ?? '').trim().split(' ').pop() ?? '?';
  const st = last.split(':')[1]?.split('@')[0] ?? '?';
  byState.set(st, (byState.get(st) ?? 0) + 1);
}
console.log('by state (sampled):', [...byState.entries()].map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`\nsustained SINGLE-arm-out runs (10+ frames): ${singleRuns}`);
for (const s of singleSamples) console.log('  ' + s);
console.log('\nfirst 12 both-arm samples:');
for (const s of samples.slice(0, 12)) console.log('  ' + s);
