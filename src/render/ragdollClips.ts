/**
 * ragdollClips.ts — playback of precomputed tackle falls.
 *
 * The falls in ragdollClips.json were simulated offline by scripts/ragdollbake
 * and vetted there: any take that failed to settle, ended upright, or slid
 * across the turf was rejected and never made it into the file. What ships is
 * a library of falls that are all known-good.
 *
 * THE TRICK THAT MAKES THE LIBRARY SMALL
 * --------------------------------------
 * The solver is yaw-invariant (verified to 0.45 mm in ragdollverify): rotating
 * the inputs about Y rotates the whole result. So world direction is NOT a
 * baked axis — a clip is stored in body-local space and rotated at playback to
 * whatever heading the tackle actually had. Six relative hit angles times
 * three power tiers times two variants covers the space in 36 clips.
 *
 * Selection is then: pick the cell nearest the real hit, rotate it to the real
 * heading, and scale it to the real pace. Same numbers, adjusted to the
 * situation — which is exactly what a canned clip cannot do, because a canned
 * clip has no numbers, only a fixed animation.
 *
 * Playback presents the same `.pos` interface the live solver does, so the rig
 * bridge cannot tell the difference.
 */
import clipData from './ragdollClips.json';

const RAW: {
  version: number; hz: number; frames: number; nodes: number; quant: number;
  angles: number[]; powers: number[];
  clips: { angle: number; power: number; settle: number }[];
  data: string;
} = clipData as never;

/** Decoded int16 sample bank, lazily built on first use. */
let BANK: Int16Array | null = null;
function bank(): Int16Array {
  if (BANK) return BANK;
  const bin = typeof atob === 'function'
    ? atob(RAW.data)
    : Buffer.from(RAW.data, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  BANK = new Int16Array(bytes.buffer);
  return BANK;
}

export const CLIP_COUNT = RAW.clips.length;
export const CLIP_FRAMES = RAW.frames;
export const CLIP_HZ = RAW.hz;
export const CLIP_NODES = RAW.nodes;

/** Duration of one baked fall, seconds. */
export const CLIP_SECONDS = RAW.frames / RAW.hz;

const STRIDE = RAW.nodes * 3;

/**
 * Choose the clip whose baked cell is closest to this hit.
 *
 * @param relAngle  hit direction RELATIVE to the body's facing, radians
 * @param power     0..~1.4, how hard the hit was
 * @param variant   any integer; decorrelates repeat selections
 */
export function pickClip(relAngle: number, power: number, variant: number): number {
  // nearest baked angle, wrapping properly at the seam
  const twoPi = Math.PI * 2;
  const a = ((relAngle % twoPi) + twoPi) % twoPi;
  let bestA = 0, bestAd = Infinity;
  for (let i = 0; i < RAW.angles.length; i++) {
    let d = Math.abs(RAW.angles[i] - a);
    if (d > Math.PI) d = twoPi - d;
    if (d < bestAd) { bestAd = d; bestA = i; }
  }
  let bestP = 0, bestPd = Infinity;
  for (let i = 0; i < RAW.powers.length; i++) {
    const d = Math.abs(RAW.powers[i] - power);
    if (d < bestPd) { bestPd = d; bestP = i; }
  }
  // Among the takes in that cell, rotate through the variants.
  const cell: number[] = [];
  for (let i = 0; i < RAW.clips.length; i++) {
    if (RAW.clips[i].angle === bestA && RAW.clips[i].power === bestP) cell.push(i);
  }
  if (cell.length === 0) return 0;
  return cell[((variant % cell.length) + cell.length) % cell.length];
}

/**
 * A playing baked fall. Exposes `.pos` in world metres, so it is a drop-in
 * for RagdollBody as far as driveRig is concerned.
 */
export class RagdollPlayback {
  readonly pos = new Float32Array(CLIP_NODES * 3);
  private clip = 0;
  private t = 0;
  private cos = 1;
  private sin = 0;
  private scale = 1;
  private ox = 0; private oy = 0; private oz = 0;
  asleep = false;

  /**
   * @param clip     index from pickClip
   * @param yaw      world heading to rotate the fall into, radians
   * @param origin   world point (metres) the pelvis starts at
   * @param scale    body-size multiplier; 1 is the baked proportions
   */
  start(clip: number, yaw: number, origin: readonly [number, number, number], scale = 1): void {
    this.clip = Math.max(0, Math.min(CLIP_COUNT - 1, clip | 0));
    this.t = 0;
    this.cos = Math.cos(yaw);
    this.sin = Math.sin(yaw);
    this.scale = scale;
    this.ox = origin[0]; this.oy = origin[1]; this.oz = origin[2];
    this.asleep = false;
    this.sample();
  }

  /** Advance and resample. `rate` < 1 plays the fall in slow motion. */
  update(dt: number, rate = 1): void {
    if (this.asleep) return;
    this.t += dt * rate;
    if (this.t >= CLIP_SECONDS) { this.t = CLIP_SECONDS; this.asleep = true; }
    this.sample();
  }

  /** Interpolate the two nearest baked frames and place them in the world. */
  private sample(): void {
    const b = bank();
    const f = Math.min(CLIP_FRAMES - 1, this.t * CLIP_HZ);
    const f0 = Math.floor(f);
    const f1 = Math.min(CLIP_FRAMES - 1, f0 + 1);
    const u = f - f0;
    const base = this.clip * CLIP_FRAMES * STRIDE;
    const o0 = base + f0 * STRIDE;
    const o1 = base + f1 * STRIDE;
    const inv = 1 / RAW.quant;

    for (let n = 0; n < CLIP_NODES; n++) {
      const i = n * 3;
      // linear blend between baked frames, still in body-local metres
      const lx = (b[o0 + i] + (b[o1 + i] - b[o0 + i]) * u) * inv * this.scale;
      const ly = (b[o0 + i + 1] + (b[o1 + i + 1] - b[o0 + i + 1]) * u) * inv * this.scale;
      const lz = (b[o0 + i + 2] + (b[o1 + i + 2] - b[o0 + i + 2]) * u) * inv * this.scale;
      // rotate about Y into the world heading, then translate to the origin
      this.pos[i] = this.ox + lx * this.cos - lz * this.sin;
      this.pos[i + 1] = this.oy + ly;
      this.pos[i + 2] = this.oz + lx * this.sin + lz * this.cos;
    }
  }
}
