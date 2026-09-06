/**
 * PRECOMPUTED TACKLE TRAJECTORIES
 *
 * The live verlet ragdoll is a great offline simulation but it is far too
 * expensive and too jittery to run for every grounded man on the field. This
 * module is the field half of that work: a compact database of tackle
 * FALLS that were baked offline (`scripts/bakeTackles.ts`), plus a playback
 * object that interpolates them and writes the solved local transforms back
 * into the mixer pose.
 *
 * Why this is cheap
 * -----------------
 *   - The solver NEVER runs at runtime. The field cost is one lookup + one
 *     linear position lerp + one quaternion slerp per joint.
 *   - The baked data is stored in each bone's LOCAL (parent-relative) space,
 *     which is exactly what `bone.position` / `bone.quaternion` want. A frame
 *     of playback is therefore a copy into 20 bones, with no matrix inverses,
 *     no world→local conversion and no constraint sweeps.
 *   - The actor root can still be placed/rotated by the 2D engine every frame:
 *     local transforms are invariant to the root's world transform, so the
 *     recording sits on a man wherever he is, however he is facing.
 *
 * The bake keys
 * -------------
 * A fall is keyed by the same things that visibly change a tackle:
 *   ROLE    — tackler (hit, drives, rolls away) or carrier (hit, goes down);
 *   KIND    — STANDING takedown or a horizontal DIVE;
 *   SPEED   — slow (ruck-ish), medium or fast (the "massive tackle" recordings);
 *   ANGLE   — where the hit throws him relative to his own facing.
 *
 * The binary format
 * -----------------
 *   bytes 0..3  'TRKT'
 *   byte  4     version
 *   byte  5     JOINT_COUNT
 *   byte  6     FRAME_COUNT
 *   byte  7     reserved
 *   u32         clip count
 *   8 bytes × clip count: role, kind, speedBin, angleBin, u32 float offset
 *   then the data as Float32Array: for every clip, frame, joint:
 *      position x,y,z then quaternion x,y,z,w  (7 floats)
 */

import * as THREE from 'three';

/* ========================== SCHEMA ========================== */

export const JOINT_COUNT = 20;
export const FRAME_COUNT = 90;
export const FRAME_DT = 1 / 60;
export const FLOATS_PER_JOINT = 7;

/** The joints we record, in topological (parent-before-child) order. */
export const JOINT_NAMES = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l',
  'thigh_r', 'calf_r', 'foot_r',
];

export type TackleRole = 'tackler' | 'carrier';
export type TackleKind = 'standing' | 'dive';

export interface TackleClip {
  role: TackleRole;
  kind: TackleKind;
  speedBin: number;
  angleBin: number;
  /** index of the clip's first float (position x of joint 0, frame 0) */
  floatStart: number;
  frameCount: number;
}

export function speedBinFor(speed: number): number {
  if (speed >= 7) return 2;
  if (speed >= 3) return 1;
  return 0;
}

/** Signed angle between the player's facing and the direction of the hit. */
export function relativeAngle(face: number, heading: number): number {
  let a = heading - face;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** 6 bins covering the full circle. Bin 0 is a hit directly ahead. */
export function angleBinFor(angle: number): number {
  const a = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  return Math.min(5, Math.floor((a / (Math.PI * 2)) * 6));
}

export const SPEED_BINS = [2, 5, 9];
export const ANGLE_BINS = [-2.618, -1.571, -0.524, 0.524, 1.571, 2.618];

/* ========================== SCRATCH ========================== */

const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

/* ========================== BANK ========================== */

/**
 * A compiled tackle database. Loaded once per renderer and shared by every
 * grounded player. `pick()` is a direct indexed lookup — there is no search.
 */
export class TackleBank {
  readonly clips: TackleClip[];
  readonly data: Float32Array;

  constructor(clips: TackleClip[], data: Float32Array) {
    this.clips = clips;
    this.data = data;
  }

  static async load(url: string): Promise<TackleBank | null> {
    const resp = await fetch(url).catch(() => null);
    if (!resp || !resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const view = new DataView(buf);

    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'TRKT') return null;
    const version = view.getUint8(4);
    const jointCount = view.getUint8(5);
    const frameCount = view.getUint8(6);
    const clipCount = view.getUint32(8, true);
    if (version !== 1 || jointCount !== JOINT_COUNT || frameCount !== FRAME_COUNT) return null;

    const clips: TackleClip[] = [];
    const floatStart = 12 + clipCount * 8;
    for (let i = 0; i < clipCount; i++) {
      const o = 12 + i * 8;
      const role = view.getUint8(o) === 1 ? 'carrier' : 'tackler';
      const kind = view.getUint8(o + 1) === 1 ? 'dive' : 'standing';
      const speedBin = view.getUint8(o + 2);
      const angleBin = view.getUint8(o + 3);
      const floatDataStart = view.getUint32(o + 4, true);
      clips.push({ role, kind, speedBin, angleBin, floatStart: floatDataStart, frameCount });
    }
    const data = new Float32Array(buf, floatStart);
    return new TackleBank(clips, data);
  }

  pick(role: TackleRole, kind: TackleKind, speedBin: number, angleBin: number): TackleClip | null {
    const n = angleBin;
    for (let d = 0; d <= 1; d++) {
      for (let s = 1; s >= -1; s -= 2) {
        const a = (n + s * d + 6) % 6;
        for (const c of this.clips) {
          if (c.role === role && c.kind === kind && c.speedBin === speedBin && c.angleBin === a) return c;
        }
      }
    }
    return null;
  }
}

/* ========================== PLAYBACK ========================== */

/**
 * One man's active recording. Created when a tackle enters its grounding
 * stage and destroyed once the player gets up. `advance()` writes the baked
 * local transforms over the mixer pose; `cool()` fades that override out so
 * the get-up clip emerges naturally.
 */
export class TacklePlayback {
  readonly root: THREE.Object3D;
  readonly clip: TackleClip;
  private bone: (THREE.Bone | null)[];
  private readonly data: Float32Array;
  time = 0;
  weight = 1;
  private readonly blendIn = 0.14;

  constructor(root: THREE.Object3D, clip: TackleClip, data: Float32Array) {
    this.root = root;
    this.clip = clip;
    this.data = data;
    this.bone = JOINT_NAMES.map((name) => this.findBone(name));
    if (import.meta.env?.DEV) {
      const missing = this.bone.filter((b) => !b).length;
      if (missing) {
        console.warn(`[tackles] ${missing} bones missing on a playback — the fall will be partial`);
      }
    }
  }

  private findBone(name: string): THREE.Bone | null {
    let found: THREE.Bone | null = null;
    this.root.traverse((o) => {
      if (!found && (o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone;
    });
    return found;
  }

  /** Advance the recording and write it over the mixer pose. */
  advance(dt: number) {
    if (this.clip.frameCount === 0 || this.weight <= 0.001) return;
    this.time += dt;
    const step = this.time / FRAME_DT;
    const k = Math.min(this.clip.frameCount - 1, Math.floor(step));
    const t = Math.min(1, step - k);
    const ramp = Math.min(1, this.time / this.blendIn);
    const w = this.weight * ramp;
    if (w <= 0.001) return;

    for (let i = 0; i < JOINT_COUNT; i++) {
      const b = this.bone[i];
      if (!b) continue;
      const base = this.clip.floatStart + (k * JOINT_COUNT + i) * FLOATS_PER_JOINT;
      const d = this.clip.frameCount > 1 && k < this.clip.frameCount - 1 ? this.clip.floatStart + ((k + 1) * JOINT_COUNT + i) * FLOATS_PER_JOINT : base;
      const data = this.data;
      _p1.set(data[base], data[base + 1], data[base + 2]);
      if (d !== base) _p1.lerp(_p2.set(data[d], data[d + 1], data[d + 2]), t);
      _q1.set(data[base + 3], data[base + 4], data[base + 5], data[base + 6]);
      if (d !== base) {
        _q2.set(data[d + 3], data[d + 4], data[d + 5], data[d + 6]);
        _q1.slerp(_q2, t);
      }
      if (w < 1) {
        b.position.lerp(_p1, w);
        b.quaternion.slerp(_q1, w);
      } else {
        b.position.copy(_p1);
        b.quaternion.copy(_q1);
      }
    }
  }

  /** Fade the recording out (called once the player starts getting up). */
  cool(step: number, minutes = 0.16) {
    this.weight = Math.max(0, this.weight - step / minutes);
  }
}
