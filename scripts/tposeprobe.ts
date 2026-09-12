/**
 * TPOSEPROBE — hunts frames where a jogging player's arms sit at the rig's
 * bind pose (arms out straight). Flags only PERSISTENT hits (3+ frames),
 * which is what an undriven-arm blend looks like; a clip that merely swings
 * through the pose shows up as a single-frame blip and is ignored.
 *
 * Usage: npx vite-node scripts/tposeprobe.ts [seconds] [seeds]
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
    const v = track.values;
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return out;
};

const seconds = Number(process.argv[2] ?? 240);
const seeds = (process.argv[3] ?? '7,13').split(',').map(Number);
const main = await parseGlb('public/assets/models/rugby_player.glb');
const pair = await parseGlb('public/assets/models/tackle_pair.glb');

const BIND: Record<string, THREE.Quaternion> = {};
for (const n of ['upperarm_l', 'upperarm_r']) {
  BIND[n] = (main.scene.getObjectByName(n) as THREE.Bone).quaternion.clone();
}

let persistent = 0;
const samples: string[] = [];

for (const seed of seeds) {
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

  const pool = M.pool as Map<string, {
    root: THREE.Group; proc: { state: string }; st: { spd: number };
  }>;
  /* per-player consecutive bind-pose counter + history ring */
  const run = new Map<string, { n: number; hist: string[] }>();
  const dt = 1 / 60;
  const frames = Math.ceil(seconds * 60);
  for (let i = 0; i < frames && !d.over; i++) {
    d.update(dt, NO_INPUT, new Set());
    mgr.update(d, { w: 1280, h: 720 } as never, { x: 0, z: 0, h: 20, yaw: 0 } as never, dt);
    for (const [key, inst] of pool) {
      if (!inst.root.visible) continue;
      const r = run.get(key) ?? { n: 0, hist: [] };
      let atBind = false;
      for (const side of ['upperarm_l', 'upperarm_r']) {
        const bone = inst.root.getObjectByName(side) as THREE.Bone | undefined;
        if (!bone) continue;
        if (Math.abs(bone.quaternion.dot(BIND[side])) > 0.9998) { atBind = true; break; }
      }
      const lp = d.live.find((q) => `${q.team}:${q.num}` === key);
      r.hist.push(`${i}:${inst.proc.state}@${inst.st.spd.toFixed(0)}(${lp?.clip ?? '?'})`);
      if (r.hist.length > 10) r.hist.shift();
      if (atBind) {
        r.n++;
        if (r.n === 3) {
          persistent++;
          if (samples.length < 40) {
            samples.push(`[seed ${seed}] ${key} arms at bind for 3+ frames ending f${i} | ${r.hist.join(' ')}`);
          }
        }
      } else r.n = 0;
      run.set(key, r);
    }
  }
  console.log(`seed ${seed}: done (${d.teams.A.score}-${d.teams.B.score})`);
}
console.log(`\n=== TPOSEPROBE ${seconds}s x seeds ${seeds.join(',')} ===`);
console.log(`persistent arms-at-bind events (3+ frames): ${persistent}`);
for (const s of samples) console.log('  ' + s);
