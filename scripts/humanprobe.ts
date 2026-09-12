/**
 * HUMANPROBE — scripted human carrier vs CPU defence. Drives team A's
 * controlled player straight at the line with sprint + occasional sidesteps,
 * and measures:
 *   - dive launches / frozen-dive travel / dive misses (defence behaviour)
 *   - how often a defender actually reaches the 1.1 m contact radius
 *   - persistent arms-at-bind (T-pose) frames, with state history
 *   - getup replays
 *
 * Usage: npx vite-node scripts/humanprobe.ts [seconds] [seed]
 */
import fs from 'node:fs';
import * as THREE from 'three';
(globalThis as Record<string, unknown>).self = globalThis;
(globalThis as Record<string, unknown>).document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => undefined }) }),
};
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Director, NO_INPUT, MatchConfig, Input } from '../src/game/director';
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

const seconds = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 7);
const main = await parseGlb('public/assets/models/rugby_player.glb');
const pair = await parseGlb('public/assets/models/tackle_pair.glb');
const BIND: Record<string, THREE.Quaternion> = {};
for (const n of ['upperarm_l', 'upperarm_r']) {
  BIND[n] = (main.scene.getObjectByName(n) as THREE.Bone).quaternion.clone();
}

seedRng(seed);
const base = gateConfig(3);
const cfg: MatchConfig = { ...base, cpuA: false, cpuB: true };
const d = new Director(cfg);
d.relativeControls = false;   // up = toward the opposition line

const scene = new THREE.Scene();
const mgr = new ThreePlayerManager({ scene } as never);
const M = mgr as unknown as Record<string, unknown>;
M.template = main.scene;
M.templateClips = main.animations.map(stripRootMotion).concat(pair.animations);
(M as { prepareTemplate: () => void }).prepareTemplate();
M.ready = true;

/* scripted input: sprint at the line, sidestep every 2.1 s, fend when close */
const held: Input = { ...NO_INPUT, up: true, sprint: true };
let stepEvery = 0;
const pressed = new Set<string>();

/* dive tracking */
interface DiveTrack { num: number; team: string; x: number; z: number; travel: number; t: number; connected: boolean }
const dives: DiveTrack[] = [];
const diving = new Map<string, DiveTrack>();
let contactFrames = 0;         // frames with any defender inside 1.1 m of the human carrier
let carrierFrames = 0;

/* T-pose + getup tracking */
const pool = M.pool as Map<string, { root: THREE.Group; proc: { state: string }; st: { spd: number } }>;
const run = new Map<string, { n: number; hist: string[] }>();
const tposeSamples: string[] = [];
let persistent = 0;
const lastPlay = new Map<string, string>();
let getupReplays = 0;
const replaySamples: string[] = [];
const origPlay = (M as { play: (...a: unknown[]) => unknown }).play;
let frame = 0;
const getupPlays: string[] = [];
(M as Record<string, unknown>).play = function (inst: { actor: { team: string; num: number } }, stateName: string, fade: number, ts = 1) {
  const key = `${inst.actor.team}:${inst.actor.num}`;
  if (stateName === 'getup') {
    const lp = d.live.find((q) => `${q.team}:${q.num}` === key);
    getupPlays.push(`f${frame} ${key} prev=${lastPlay.get(key) ?? '∅'} recoverT=${(lp?.recoverT ?? 0).toFixed(2)} clip=${lp?.clip}`);
    if (lastPlay.get(key) === 'getup') {
      getupReplays++;
      if (replaySamples.length < 10) replaySamples.push(`f${frame} ${key} hist: ${(run.get(key)?.hist ?? []).join(' ')}`);
    }
  }
  lastPlay.set(key, stateName);
  return origPlay.call(this, inst, stateName, fade, ts);
};

const dt = 1 / 60;
const frames = Math.ceil(seconds * 60);
for (let i = 0; i < frames && !d.over; i++) {
  frame = i;
  pressed.clear();
  const op = d.op;
  const humanAtk = op && d.isHuman(op.attacking);
  stepEvery += dt;
  if (humanAtk && stepEvery > 2.1) { stepEvery = 0; pressed.add('step'); }
  d.update(dt, humanAtk ? held : NO_INPUT, pressed);
  mgr.update(d, { w: 1280, h: 720 } as never, { x: 0, z: 0, h: 20, yaw: 0 } as never, dt);

  if (op && humanAtk) {
    carrierFrames++;
    const car = d.L(op.attacking, op.carrierNum);
    if (car) {
      let nearest = Infinity;
      for (const p of d.live) {
        if (p.team === op.attacking || p.down || p.beatenT > 0) continue;
        nearest = Math.min(nearest, Math.hypot(p.x - car.x, p.z - car.z));
      }
      if (nearest < 1.1) contactFrames++;
    }
  }

  /* dive bookkeeping */
  for (const p of d.live) {
    const id = `${p.team}${p.num}`;
    const t = p.diveT ?? 0;
    if (t > 0 && !diving.has(id)) {
      diving.set(id, { num: p.num, team: p.team, x: p.x, z: p.z, travel: 0, t, connected: false });
    } else if (t > 0 && diving.has(id)) {
      const dv = diving.get(id)!;
      dv.travel += Math.hypot(p.x - dv.x, p.z - dv.z);
      dv.x = p.x; dv.z = p.z; dv.t = t;
      if (p.latchingOnto) dv.connected = true;
    } else if (t <= 0 && diving.has(id)) {
      const dv = diving.get(id)!;
      /* upOpen latches and tickDive clears diveT inside the SAME update, so
       * the hands-on state is only visible here, at finalization. */
      if (p.latchingOnto) dv.connected = true;
      dives.push(dv);
      diving.delete(id);
    }
  }

  /* T-pose detector */
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
    if (r.hist.length > 12) r.hist.shift();
    if (atBind) {
      r.n++;
      if (r.n === 3) {
        persistent++;
        if (tposeSamples.length < 30) tposeSamples.push(`f${i} ${key} | ${r.hist.join(' ')}`);
      }
    } else r.n = 0;
    run.set(key, r);
  }
}

const launched = dives.length;
const connected = dives.filter((v) => v.connected).length;
const missTravel = dives.filter((v) => !v.connected);
console.log(`\n=== HUMANPROBE ${seconds}s seed ${seed} (score ${d.teams.A.score}-${d.teams.B.score}) ===`);
console.log(`carrier frames ${carrierFrames}; frames with a defender inside 1.1 m: ${contactFrames} (${carrierFrames ? Math.round(100 * contactFrames / carrierFrames) : 0}%)`);
console.log(`tackles made ON human side: A.tackles conceded = ${d.teams.B.stats.tackles} (B made), missed ${d.teams.B.stats.missed}, breaks by human ${d.teams.A.stats.lineBreaks ?? 0}`);
console.log(`dives launched ${launched}, connected (hands on) ${connected}`);
if (missTravel.length) {
  const avg = missTravel.reduce((s, v) => s + v.travel, 0) / missTravel.length;
  const max = Math.max(...missTravel.map((v) => v.travel));
  console.log(`missed dives: n=${missTravel.length} avg travel while airborne ${avg.toFixed(2)} m, max ${max.toFixed(2)} m  (0.00 = frozen in mid-air)`);
}
console.log(`\npersistent T-pose events: ${persistent}`);
for (const s of tposeSamples) console.log('  ' + s);
console.log(`\ngetup replays: ${getupReplays}`);
for (const s of replaySamples) console.log('  ' + s);
