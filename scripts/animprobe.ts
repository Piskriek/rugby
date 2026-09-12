/**
 * ANIMPROBE — headless Director + ThreePlayerManager FSM run.
 *
 * Watches for:
 *   1. ARMS-OUT EVENTS  a clip whose arms swing wide (Death/JumpLand/Pass/
 *                       SlideStart/GetUp) starts while the player is moving —
 *                       the "arms flash out while jogging" symptom. Prints the
 *                       surrounding state history so the trigger is visible.
 *   2. GETUP REPLAYS    getup played twice in a row for one player.
 *
 * Usage: npx vite-node scripts/animprobe.ts [seconds] [seeds]
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

/* clips whose arms swing wide (measured |dot(bind)| > 0.96 somewhere) */
const ARMS_OUT: Record<string, string> = {
  grounded: 'Death', jump: 'JumpLand', pass: 'Pass', dive: 'SlideStart',
  getup: 'GetUp', tryStart: 'SlideStart',
};

const seconds = Number(process.argv[2] ?? 300);
const seeds = (process.argv[3] ?? '7,13').split(',').map(Number);
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

const main = await parseGlb('public/assets/models/rugby_player.glb');
const pair = await parseGlb('public/assets/models/tackle_pair.glb');

let armsOutEvents = 0;
const aoSamples: string[] = [];
let getupReplays = 0;
const replaySamples: string[] = [];
const eventSamples: string[] = [];

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

  /* per-player history of (frame, procState, spd, engineClip) — pool keys are 'A:4' */
  const hist = new Map<string, { f: number; s: string; spd: number; clip: string }[]>();
  const lastPlay = new Map<string, string>();
  const toKey = (team: string, num: number) => `${team}:${num}`;

  let frame = 0;
  const origPlay = (M as { play: (...a: unknown[]) => unknown }).play;
  (M as Record<string, unknown>).play = function (
    inst: { actor: { team: string; num: number }; st: { spd: number } }, stateName: string, fade: number, ts = 1,
  ) {
    const key = toKey(inst.actor.team, inst.actor.num);
    const lp = d.live.find((q) => q.team === inst.actor.team && q.num === inst.actor.num);
    const eng = lp ? `clip=${lp.clip} recoverT=${(lp.recoverT ?? 0).toFixed(2)} down=${lp.down} spd=${Math.hypot(lp.vx, lp.vz).toFixed(1)}` : '?';
    if (stateName === 'getup' && eventSamples.length < 40) {
      const h = (hist.get(key) ?? []).slice(-10).map((e) => `${e.f}:${e.s}@${e.spd.toFixed(0)}(${e.clip})`).join(' ');
      eventSamples.push(`[seed ${seed}] f${frame} ${key} play(getup) ENGINE[${eng}] render-spd=${inst.st.spd.toFixed(1)} | ${h}`);
    }
    /* arms-out clip starting while the man is moving */
    if (ARMS_OUT[stateName] && inst.st.spd > 2.5) {
      armsOutEvents++;
      if (aoSamples.length < 25) {
        const h = (hist.get(key) ?? []).slice(-12).map((e) => `${e.f}:${e.s}@${e.spd.toFixed(1)}(${e.clip})`).join(' ');
        aoSamples.push(`[seed ${seed}] frame ${frame} ${key} spd=${inst.st.spd.toFixed(1)} -> ${stateName}(${ARMS_OUT[stateName]}) ENGINE[${eng}] | ${h}`);
      }
    }
    if (stateName === 'getup' && lastPlay.get(key) === 'getup') {
      getupReplays++;
      if (replaySamples.length < 15) {
        const h = (hist.get(key) ?? []).slice(-16).map((e) => `${e.f}:${e.s}(${e.clip})`).join(' ');
        replaySamples.push(`[seed ${seed}] frame ${frame} ${key}  history: ${h}`);
      }
    }
    lastPlay.set(key, stateName);
    return origPlay.call(this, inst, stateName, fade, ts);
  };

  const pool = M.pool as Map<string, { proc: { state: string }; st: { spd: number } }>;
  const dt = 1 / 60;
  const frames = Math.ceil(seconds * 60);
  for (let i = 0; i < frames && !d.over; i++) {
    frame = i;
    d.update(dt, NO_INPUT, new Set());
    mgr.update(d, { w: 1280, h: 720 } as never, { x: 0, z: 0, h: 20, yaw: 0 } as never, dt);
    for (const [key, inst] of pool) {
      const a = d.actors.find((q) => `${q.team}:${q.num}` === key);
      const h = hist.get(key) ?? [];
      h.push({ f: i, s: inst.proc.state, spd: inst.st.spd, clip: a?.renderClip ?? '?' });
      if (h.length > 40) h.shift();
      hist.set(key, h);
    }
  }
  console.log(`seed ${seed}: done (${frame} frames, score ${d.teams.A.score}-${d.teams.B.score})`);
}

console.log(`\n=== ANIMPROBE ${seconds}s x seeds ${seeds.join(',')} ===`);
console.log(`arms-out clip starts while moving (spd>2.5): ${armsOutEvents}`);
for (const s of aoSamples) console.log('  ' + s);
console.log(`\ngetup play() events with engine context:`);
for (const s of eventSamples) console.log('  ' + s);
console.log(`\ngetup replays: ${getupReplays}`);
for (const s of replaySamples) console.log('  ' + s);
