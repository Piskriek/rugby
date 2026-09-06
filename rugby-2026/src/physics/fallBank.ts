/**
 * FALL BANK — runtime half of the recorded-physics pipeline.
 *
 * The heavy solve happened at bake time; this module only:
 *  1. decodes the packed bank (Int16 -> float, explicit little-endian so the
 *     file is portable),
 *  2. picks the recording nearest a live situation by weighted feature
 *     distance (kind exact, dir circular, speed/height/mass continuous),
 *  3. mirrors it when the fall goes to the man's LEFT (only the right-side
 *     curves are stored — the bank is half its naive size),
 *  4. reconstructs the 17-channel pose from the 11 stored core channels.
 *
 * Sample layout inside one entry: channel-major, `CH_CORE * BANK_N` floats.
 */
import {
  FALL_BANK_B64, FALL_BANK_META, FALL_BANK_N, FALL_BANK_CH, FALL_BANK_SCALE,
} from './fallBank.data';
import { CH, FALL_HZ, FALL_N, CORE_ROWS as CORE, CH_CORE as CORE_COUNT } from './falls';
import type { FallDesc } from './falls';

export const BANK_N = FALL_BANK_N;
export const CH_CORE = FALL_BANK_CH;

/** Which full-solver rows are stored (right-limb lead curves only). */
export const CORE_ROWS = CORE;

/** Left-limb mirror used when expanding the stored (right-lead) curves.
 *  This is an EXACT mirror: the old +0.2 ab / +0.22 elbow (etc.) offsets
 *  made the left arm permanently more bent and dug the left hand/foot under
 *  the turf in every flat rest — the sprawl fits (tools/restOracle,
 *  sideScan) are done in pure/mirror mode so the recorded rest is ground
 *  truth only when the decode mirrors exactly. Per-man asymmetry now comes
 *  from the torso twist/bend/head-roll curves and the motif variety, not
 *  from a baked-in limb skew. */
export const L_DERIVE = {
  armLab_mul: 1, armLab_add: 0, armLelb_mul: 1, armLelb_add: 0,
  legLflex_add: 0, legLab_mul: 1, legLab_add: 0,
  legLknee_mul: 1, legLknee_add: 0,
} as const;

export interface BankEntry {
  meta: typeof FALL_BANK_META[number];
  /** CH_CORE × BANK_N floats, channel-major */
  data: Float32Array;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

let cache: { entries: BankEntry[] } | null = null;

function decodeBank(): { entries: BankEntry[] } {
  const bin = atob(FALL_BANK_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = CH_CORE * BANK_N;
  const entries: BankEntry[] = [];
  let o = 0;
  for (let e = 0; e < FALL_BANK_META.length; e++) {
    const data = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      data[i] = dv.getInt16(o, true) / FALL_BANK_SCALE;
      o += 2;
    }
    entries.push({ meta: FALL_BANK_META[e], data });
  }
  return { entries };
}

export function bankSize(): number {
  const b = cache ?? (cache = decodeBank());
  return b.entries.length;
}

function dirNum(dir: FallDesc['dir']): number {
  return dir === 'F' ? 0 : dir === 'B' ? 1 : 0.5;
}

/** Weighted feature distance from a live descriptor to a bank entry. */
function distTo(meta: BankEntry['meta'], d: FallDesc): number {
  if (meta.kind !== d.kind) return Infinity;
  // Straight compass of three directions, NOT a wrapped loop: F (0) and B (1)
  // are opposite falls and must never match each other (a wrap would make
  // them neighbours). S (0.5) sits midway to both.
  const dirD = Math.abs(meta.dir - dirNum(d.dir));  // F↔B 1, S↔F/B 0.5, same 0
  const speed = Math.abs(meta.speed - d.speed) / 10;   // axes normalized 0..1
  const hit = Math.abs(meta.hitH - d.hitH);            // 0..1
  const mass = Math.abs(meta.massR - d.massR) / 0.35;  // ~0..1
  return dirD * 2.2 + speed * 1.0 + hit * 0.9 + mass * 0.6;
}

/** Nearest recording to a live situation. Mirrored when dir is lateral-left
 *  is handled by the caller (side < 0). Always returns a valid entry. */
export function findFall(d: FallDesc): BankEntry {
  const b = cache ?? (cache = decodeBank());
  let best = b.entries[0];
  let bestD = Infinity;
  for (const en of b.entries) {
    const dd = distTo(en.meta, d);
    if (dd < bestD) { bestD = dd; best = en; }
  }
  return best;
}

/**
 * Read a single interpolated sample from an entry and expand the 11 stored
 * channels into the full 17-channel pose, applying mirroring for a fall to
 * the man's left. `t` is recording time in seconds (0 .. FALL_T).
 * Returns a Float32Array of CH_COUNT values (reused scratch is NOT used —
 * callers may hold the returned array).
 */
export function samplePose(entry: BankEntry, t: number, mirror: boolean): Float32Array {
  const ft = clamp(t, 0, (BANK_N - 1) / FALL_HZ);
  const x = ft * FALL_HZ;
  const s0 = Math.min(BANK_N - 1, Math.floor(x));
  const s1 = Math.min(BANK_N - 1, s0 + 1);
  const f = x - s0;
  const core: number[] = new Array(CH_CORE);
  for (let c = 0; c < CH_CORE; c++) {
    const v0 = entry.data[c * BANK_N + s0];
    const v1 = entry.data[c * BANK_N + s1];
    core[c] = v0 + (v1 - v0) * f;
  }
  return expand(core, mirror);
}

/** Expand 11 core channel values (same order as CORE_ROWS) into 17, applying
 *  the left-mirror by swapping the lead-limb derivations and flipping the
 *  lateral signs. Pure and small enough to run every frame per player. */
export function expand(core: number[], mirror: boolean): Float32Array {
  const D = L_DERIVE;
  const out = new Float32Array(17);
  const [
    pitch, twistZ, bend, headX, headY,
    armF, armAb, armElb,
    legF, legAb, knee,
  ] = core;
  const lead = (x: number) => x;
  const trail = (x: number, mul: number, add: number) => clamp(x * mul + add, -0.2, 2.2);
  out[CH.pitch] = pitch;
  out[CH.twistZ] = mirror ? -twistZ : twistZ;
  out[CH.bend] = bend;
  out[CH.headX] = headX;
  out[CH.headY] = mirror ? -headY : headY;
  if (!mirror) {
    out[CH.armRflex] = lead(armF);
    out[CH.armLflex] = lead(armF);
    out[CH.armRab] = lead(armAb);
    out[CH.armLab] = trail(armAb, D.armLab_mul, D.armLab_add);
    out[CH.armRelbow] = lead(armElb);
    out[CH.armLelbow] = trail(armElb, D.armLelb_mul, D.armLelb_add);
    out[CH.legRflex] = lead(legF);
    out[CH.legLflex] = trail(legF, 1, D.legLflex_add);
    out[CH.legRab] = lead(legAb);
    out[CH.legLab] = trail(legAb, D.legLab_mul, D.legLab_add);
    out[CH.legRknee] = lead(knee);
    out[CH.legLknee] = trail(knee, D.legLknee_mul, D.legLknee_add);
  } else {
    out[CH.armRflex] = lead(armF);
    out[CH.armLflex] = lead(armF);
    out[CH.armRab] = trail(armAb, D.armLab_mul, D.armLab_add);
    out[CH.armLab] = lead(armAb);
    out[CH.armRelbow] = trail(armElb, D.armLelb_mul, D.armLelb_add);
    out[CH.armLelbow] = lead(armElb);
    out[CH.legRflex] = trail(legF, 1, D.legLflex_add);
    out[CH.legLflex] = lead(legF);
    out[CH.legRab] = trail(legAb, D.legLab_mul, D.legLab_add);
    out[CH.legLab] = lead(legAb);
    out[CH.legRknee] = trail(knee, D.legLknee_mul, D.legLknee_add);
    out[CH.legLknee] = lead(knee);
  }
  return out;
}

export function entryCount(): number {
  return FALL_BANK_META.length;
}
