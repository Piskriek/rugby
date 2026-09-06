/**
 * Broadcast camera rig — pure math, no three.js, no DOM.
 *
 * The engine runs in its own space (x downfield, y across, z up). The shipped
 * renderer runs in the LEGACY space (x across, z downfield, y up). This module
 * produces a legacy-`Camera` that always frames the ball:
 *
 *   - it trails BEHIND the side in possession, looking upfield at the ball
 *     with a small lead, so the attack reads into space;
 *   - every axis is eased independently (a cable rig, not a drone) so it
 *     glides instead of whipping;
 *   - the rig position is DERIVED from the yaw: it always sits `trail` metres
 *     behind the aim point along the current view direction. That couples the
 *     two so a possession flip swings the rig AROUND the ball on a radius —
 *     the ball stays dead-centre for the whole swing instead of being swept
 *     out of frame (the "camera on holiday" bug, twice over).
 *
 * NOTE: this deliberately does NOT use retro.ts `chaseCam` — that helper adds
 * a +π yaw flip for dir<0 which aims the lens away from the play when team B
 * has the ball. The legacy build never used it either; it used `cableRig` in
 * src/game/engine/camera.ts.
 */
import type { Camera } from '../render/retro';

export interface RigState {
  x: number;      // legacy across
  z: number;      // legacy downfield
  h: number;      // height
  yaw: number;
  tilt: number;
  fov: number;
  ax: number;     // eased aim anchor (legacy across) — see aim
  az: number;     // eased aim anchor (legacy downfield)
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** shortest signed angular difference a→b, in [-π, π] */
function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function newRig(): RigState {
  return { x: 0, z: -18, h: 13, yaw: 0, tilt: 0.5, fov: 0.7, ax: 0, az: 0 };
}

/** On a phase cut the ball can jump tens of metres in one frame (try →
 * conversion mark, dead ball → 22 dropout). Reposition the rig behind the new
 * subject instantly — position, height and tilt snap, while the YAW still
 * eases, so the picture never whips. Mirrors the legacy T-18 phase-cut rule. */
export function snapRig(rig: RigState, engineX: number, engineY: number) {
  rig.ax = engineY;   // legacy across
  rig.az = engineX;   // legacy downfield
  rig.x = rig.ax - Math.sin(rig.yaw) * 16;
  rig.z = rig.az - Math.cos(rig.yaw) * 16;
}

/** The subject of the frame, in ENGINE coordinates. */
export interface Subject {
  x: number; y: number;   // engine downfield / across (metres)
  z: number;              // height above the grass
  flight: number;         // > 0 while a kick is in the air
  vx: number; vy: number; // engine velocity
}

/**
 * Step the rig toward the subject. `attack` is +1 when the possessing side
 * attacks +x (team A), -1 for team B. Returns a legacy Camera for syncCamera.
 */
export function rigFollow(
  rig: RigState,
  subj: Subject,
  attack: number,
  dt: number,
): Camera {
  // legacy space: across = engine y, downfield = engine x
  const tx = subj.y;
  const tz = subj.x;

  // A kick in the air backs the rig off and climbs so the flight AND the
  // chase are both in frame.
  const wide = subj.flight > 0 ? 1 : 0;
  const trail = 16 + wide * 9;
  const height = 13 + wide * 6;

  // Aim anchor: the ball, plus a lead upfield that is earned by speed. While
  // a possession flip is swinging the yaw, the lead collapses so the aim is
  // the ball itself. The anchor is eased so a jumping anchor (kick strike,
  // first bounce) never whips the yaw.
  const spd = Math.hypot(subj.vx, subj.vy);
  const lead = (4 + Math.min(4, spd)) * attack * (wide ? 0.6 : 1);
  const aimX = tx;
  const aimZ = tz + lead;
  rig.ax += (aimX - rig.ax) * (1 - Math.exp(-dt * 4.5));
  rig.az += (aimZ - rig.az) * (1 - Math.exp(-dt * 4.5));

  // Yaw: point at the (eased) aim anchor. Eases slowly normally (it is the
  // picture angle), quicker while swinging far (a possession flip).
  const yawT = Math.atan2(rig.ax - rig.x, rig.az - rig.z);
  const dy = angDiff(rig.yaw, yawT);
  const kYaw = 1 - Math.exp(-dt * (Math.abs(dy) > 1.2 ? 6.0 : 2.4));
  rig.yaw += dy * kYaw;

  // Position is DERIVED from the yaw: `trail` behind the aim anchor along the
  // current view direction. This is what makes the rig orbit the ball on a
  // possession flip — the ball is always `trail` in front, dead centre.
  const wantX = rig.ax - Math.sin(rig.yaw) * trail;
  const wantZ = rig.az - Math.cos(rig.yaw) * trail;
  const wantD = Math.hypot(wantX - rig.x, wantZ - rig.z);
  const rate = 3 + clamp(wantD / 5, 0, 5);
  const kPos = Math.min(1 - Math.exp(-dt * rate), wantD > 0.01 ? 2.4 / wantD : 1);
  rig.x += (wantX - rig.x) * kPos;
  rig.z += (wantZ - rig.z) * kPos;

  const kH = 1 - Math.exp(-dt * 2.2);
  rig.h += (height - rig.h) * kH;

  // keep the rig on the pitch — no clipping the terraces
  rig.x = clamp(rig.x, -32, 32);
  rig.z = clamp(rig.z, -58, 58);
  rig.h = clamp(rig.h, 9, 46);
  rig.h = Math.max(rig.h, 9 + Math.max(0, Math.abs(rig.z) - 47) * 0.85);

  const ground = Math.max(4, Math.hypot(rig.ax - rig.x, rig.az - rig.z));
  const tiltT = clamp(Math.atan2(rig.h - 1.2, ground), 0.08, 1.15);
  rig.tilt += (tiltT - rig.tilt) * kH;

  return {
    x: rig.x, z: rig.z, h: rig.h,
    yaw: rig.yaw, tilt: rig.tilt, fov: 0.7,
    shake: 0, horizon: 0.44, roll: 0,
  };
}
