/**
 * PAPERCRAFT RENDERER — the players are flat paper cut-outs standing in a 3D
 * stadium. Two states the coronal (front/back) rig cannot express:
 *
 *   LYING — the paper falls flat on the turf, drawn as a horizontal body with
 *           the kit colours, the head at one end, the number on the back when
 *           face-down.
 *   SIDE-ON — the paper is seen edge-on; the figure squashes to a thin profile
 *           so a turn genuinely reads as "a different side of the paper".
 *
 * Both keep the flat-fill + dark-outline look of the coronal rig, so the three
 * states read as one character from three angles.
 */

import { Palette } from './retro';

const OUTLINE = '#20202b';

export interface FlatDraw {
  sx: number; sy: number; scale: number;
  pal: Palette;
  skin: string; hair: string;
  number: number;
  /** true = face-down, so we see the back and the number */
  fromBehind: boolean;
  cap: boolean;
  clarity: number;
}

/**
 * A downed player, laid flat on the grass. The body runs across the screen with
 * the head at the near end and the feet at the far end; the whole figure has no
 * vertical extent, so it is visibly *lying*, not crouching.
 */
export function drawFlatPaper(ctx: CanvasRenderingContext2D, a: FlatDraw) {
  const S = a.scale;
  const cl = Math.max(0.25, Math.min(1, a.clarity));
  ctx.globalAlpha = 0.35 + cl * 0.65;

  const gx = a.sx, gy = a.sy;

  // Body-length shadow, softer and wider than the standing shadow.
  ctx.save();
  ctx.globalAlpha *= 0.5;
  ctx.beginPath();
  ctx.ellipse(gx, gy, S * 0.85, S * 0.34, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0c1207';
  ctx.fill();
  ctx.restore();

  const bodyLen = S * 1.35;      // head to feet, laid horizontal
  const torsoRx = S * 0.62;
  const torsoRy = S * 0.30;      // the width of the body is its "thickness" lying down
  const headR = S * 0.15;

  // Feet at the far end (-x), head at the near end (+x).
  const headX = gx + bodyLen * 0.34;
  const footX = gx - bodyLen * 0.34;

  // Legs — two short strokes toward the feet, one slightly offset.
  ctx.strokeStyle = a.pal.socks;
  ctx.lineWidth = S * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(gx - torsoRx * 0.3, gy); ctx.lineTo(footX, gy - S * 0.10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(gx - torsoRx * 0.3, gy); ctx.lineTo(footX, gy + S * 0.10); ctx.stroke();

  // Torso — a wide flattened oval in the kit colour, cel-shaded on one side.
  ctx.beginPath();
  ctx.ellipse(gx, gy, torsoRx, torsoRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = a.pal.kit;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1.4, S * 0.03);
  ctx.stroke();

  // Cel shade the lower half of the torso.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(gx, gy, torsoRx, torsoRy, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = a.pal.kitDark;
  ctx.fill();
  ctx.restore();

  // Arms — folded against the body, one over the ball.
  ctx.strokeStyle = a.pal.kitDark;
  ctx.lineWidth = S * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(gx + torsoRx * 0.2, gy); ctx.lineTo(gx + torsoRx * 0.7, gy - S * 0.12); ctx.stroke();

  // Head — a circle with hair/cap.
  ctx.beginPath();
  ctx.arc(headX, gy, headR, 0, Math.PI * 2);
  ctx.fillStyle = a.skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1.2, S * 0.024);
  ctx.stroke();
  if (a.cap) {
    ctx.beginPath();
    ctx.arc(headX, gy, headR * 1.02, 0, Math.PI * 2);
    ctx.strokeStyle = a.pal.trim;
    ctx.lineWidth = Math.max(1.5, S * 0.05);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(headX, gy - headR * 0.1, headR * 0.92, Math.PI * 1.02, Math.PI * 1.98);
    ctx.closePath();
    ctx.fillStyle = a.hair;
    ctx.fill();
  }

  // Number, when lying face-down (back up).
  if (a.fromBehind && S > 20) {
    ctx.font = `900 ${Math.round(S * 0.30)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(2, S * 0.04);
    ctx.strokeStyle = 'rgba(16,16,22,0.9)';
    ctx.strokeText(String(a.number), gx, gy + S * 0.10);
    ctx.fillStyle = a.pal.trim;
    ctx.fillText(String(a.number), gx, gy + S * 0.10);
    ctx.textAlign = 'left';
  }

  ctx.globalAlpha = 1;
}

/**
 * How thin the paper is when seen edge-on. Returned as a width multiplier for
 * the coronal drawer so a turning player visibly becomes a sliver of paper.
 */
export function sideWidthMultiplier(sideOn: boolean): number {
  return sideOn ? 0.34 : 1.0;
}

/** True when the camera is looking mostly across the pitch, i.e. side-on to a
 * player who faces along the pitch. Computed from camera yaw.
 *
 * T-34/T-05/T-11 (papercraft) — TURN SNAP WITH HYSTERESIS. A single
 * threshold thrashes: the cable cam swings near the boundary and every
 * player on the field flickers front/edge/front as cos(yaw) walks across
 * the line. Now the swap is instant but GATED — edge-on once |cos yaw|
 * passes ~63°, face-on again only inside ~55°, with a dead zone between
 * the two. The dataset is explicit: hysteresis is what stops the
 * boundary flicker. */
const SIDE_ON_ENTER = 0.45;   // beyond ~63° apparent — go edge-on
const SIDE_ON_EXIT = 0.575;   // inside ~55° apparent — back to face-on
let sideOnState = false;

export function isSideOnCam(camYaw: number): boolean {
  const c = Math.abs(Math.cos(camYaw));
  if (sideOnState) {
    if (c > SIDE_ON_EXIT) sideOnState = false;
  } else if (c < SIDE_ON_ENTER) {
    sideOnState = true;
  }
  return sideOnState;
}
