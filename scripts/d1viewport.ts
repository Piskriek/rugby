/**
 * D-1b — separate H1 (stale viewport constants) from H2 (camera rig stall).
 *
 * Replays difficulty 0 with the gate's exact live-ball filter, and for each
 * failing frame asks: is the ball outside the frame because the CAMERA is not
 * pointed at it, or because the ball is inside the view cone but beyond the
 * hardcoded 960x540 + 60 px box?
 *
 * The discriminator is the ANGLE between the camera's view axis and the ball.
 * That is viewport-independent. A camera that has lost the ball has a large
 * angle; a camera holding the ball dead centre with the ball still off-screen
 * means the box is wrong.
 *
 * Read-only.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { project, type Camera } from '../src/render/retro';

const dt = 1 / 60;
const diff = Number(process.argv[2] ?? 0);

interface F { i: number; t: number; phase: string; cam: Camera; bx: number; by: number; bz: number; }
const frames: F[] = [];

seedRng(1);
const d = new Director(gateConfig(diff));
for (let i = 0; i < 6000 && !d.over; i++) {
  d.update(dt, NO_INPUT, new Set());
  const bp = d.ballPoint();
  const live = !d.kk || d.kk.stage === 'FLIGHT';    // the gate's own filter
  if (!live) continue;
  frames.push({ i, t: d.t, phase: String(d.phase), cam: { ...d.cam, shake: 0 }, bx: bp.x, by: bp.y, bz: bp.z });
}

/** angle between the camera view axis and the camera->ball ray, degrees */
function offAxis(f: F): { yawErr: number; pitchErr: number; fwd: number } {
  const dx = f.bx - f.cam.x, dz = f.bz - f.cam.z, dy = f.by - f.cam.h;
  const fwd = dx * Math.sin(f.cam.yaw) + dz * Math.cos(f.cam.yaw);
  const right = dx * Math.cos(f.cam.yaw) - dz * Math.sin(f.cam.yaw);
  const yawErr = Math.atan2(right, fwd) * 180 / Math.PI;
  // pitch relative to the camera's tilt
  const horiz = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, horiz) * 180 / Math.PI;
  const pitchErr = pitch - (-f.cam.tilt * 180 / Math.PI);
  return { yawErr, pitchErr, fwd };
}

const inBox = (f: F, vw: number, vh: number, mg: number) => {
  const pp = project(f.cam, { w: vw, h: vh }, f.bx, f.by, f.bz);
  return !!pp && pp.sx >= mg && pp.sx <= vw - mg && pp.sy >= mg && pp.sy <= vh - mg;
};

const bad = frames.filter((f) => !inBox(f, 960, 540, 60));
console.log('=========== D-1b  H1 vs H2  (difficulty %s) ===========', diff);
console.log('live-ball frames %s, failing the 960x540+60 box: %s', frames.length, bad.length);

console.log('\n--- Is the camera actually POINTED at the ball? ---');
console.log('(view half-angles: fov is per-camera; yawErr/pitchErr are vs the view axis)');
const yawA = bad.map((f) => Math.abs(offAxis(f).yawErr)).sort((a, b) => a - b);
const pitA = bad.map((f) => Math.abs(offAxis(f).pitchErr)).sort((a, b) => a - b);
const q = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))] : NaN);
console.log('  |yaw error|   p50 %s  p90 %s  max %s deg', q(yawA, 50).toFixed(1), q(yawA, 90).toFixed(1), q(yawA, 100).toFixed(1));
console.log('  |pitch error| p50 %s  p90 %s  max %s deg', q(pitA, 50).toFixed(1), q(pitA, 90).toFixed(1), q(pitA, 100).toFixed(1));
const behind = bad.filter((f) => offAxis(f).fwd <= 0).length;
console.log('  ball BEHIND the camera plane: %s of %s failing frames', behind, bad.length);
const near = bad.filter((f) => Math.hypot(f.bx - f.cam.x, f.bz - f.cam.z) < 8).length;
console.log('  camera within 8 m of the ball: %s of %s failing frames', near, bad.length);

console.log('\n--- H1: does a different VIEWPORT rescue these frames? ---');
for (const [vw, vh, mg] of [[960, 540, 60], [960, 540, 20], [960, 540, 0], [1280, 720, 60], [1920, 1080, 60], [960, 720, 60], [2560, 1440, 60]] as [number, number, number][]) {
  const n = frames.filter((f) => !inBox(f, vw, vh, mg)).length;
  console.log('  %sx%s margin %s  ->  %s failing frames', String(vw).padStart(4), vh, String(mg).padStart(2), n);
}

console.log('\n--- Where do the survivors sit? (aspect ratio dependence) ---');
const wide = frames.filter((f) => !inBox(f, 1920, 1080, 60));
console.log('  failing at 1920x1080+60: %s  (same aspect as 960x540 — pure scale)', wide.length);
console.log('  => if scale changes nothing, the fault is ANGULAR, not a box size.');

console.log('\n--- Phase breakdown of failures ---');
const byPhase = new Map<string, number>();
for (const f of bad) byPhase.set(f.phase, (byPhase.get(f.phase) ?? 0) + 1);
console.log('  %s', [...byPhase].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join('  '));
