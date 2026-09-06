/**
 * CAMERA PROBE — does the broadcast rig actually keep the ball in frame?
 * Run: npx vite-node scripts/new_cameraprobe.ts [frames] [halfMinutes]
 *
 * Steps a full WATCH match, running the same eased rig view3d.ts uses, and for
 * every frame projects the BALL to screen coordinates with the shipped
 * retro.project() (the exact math ThreeCanvas.syncCamera reproduces in 3D).
 * Reports the fraction of frames the ball is on-screen, near centre, and
 * whether the rig ever points the wrong way (ball behind the camera).
 */
import { RugbySim } from '../src/rugby/engine';
import { newRig, rigFollow, snapRig } from '../src/rugby/camera';
import { project } from '../src/render/retro';

const FRAMES = parseInt(process.argv[2] ?? '43200', 10);
const halfMin = parseInt(process.argv[3] ?? '10', 10);

const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: halfMin, human: 'WATCH', seed: 1000 });
const rig = newRig();
const view = { w: 960, h: 540 };

let frames = 0, onScreen = 0, nearCentre = 0, behind = 0, offByPos = 0;
let minSx = Infinity, maxSx = -Infinity, minSy = Infinity, maxSy = -Infinity;
let lastX = 0, lastY = 0;
const offSamples: string[] = [];

for (let f = 0; f < FRAMES && !sim.ended; f++) {
  sim.step(1 / 60);
  const b = sim.ball;
  if (Math.hypot(b.x - lastX, b.y - lastY) > 12) snapRig(rig, b.x, b.y);
  lastX = b.x; lastY = b.y;
  const cam = rigFollow(rig, { x: b.x, y: b.y, z: b.z, flight: b.flight, vx: b.vx, vy: b.vy }, sim.attackDir(sim.possession ?? 'A'), 1 / 60);
  const p = project(cam, view, b.y, b.z, b.x);
  frames++;
  if (!p || p.f <= 0) { behind++; if (offSamples.length < 8) offSamples.push(`t=${f / 60 | 0}s phase=${sim.phase} ball=(${b.x.toFixed(0)},${b.y.toFixed(0)}) behind-cam`); continue; }
  minSx = Math.min(minSx, p.sx); maxSx = Math.max(maxSx, p.sx);
  minSy = Math.min(minSy, p.sy); maxSy = Math.max(maxSy, p.sy);
  const inX = p.sx > -40 && p.sx < view.w + 40;
  const inY = p.sy > -40 && p.sy < view.h + 40;
  if (inX && inY) {
    onScreen++;
    if (p.sx > view.w * 0.25 && p.sx < view.w * 0.75 && p.sy > view.h * 0.25 && p.sy < view.h * 0.85) nearCentre++;
  } else if (offSamples.length < 8) {
    offSamples.push(`t=${f / 60 | 0}s phase=${sim.phase} ball=(${b.x.toFixed(0)},${b.y.toFixed(0)}) screen=(${p.sx.toFixed(0)},${p.sy.toFixed(0)})`);
  }
}

console.log('=== CAMERA PROBE ===');
console.log(`frames              ${frames}`);
console.log(`ball on-screen      ${(onScreen / Math.max(1, frames) * 100).toFixed(2)}%`);
console.log(`ball near centre    ${(nearCentre / Math.max(1, frames) * 100).toFixed(2)}%`);
console.log(`ball behind camera  ${(behind / Math.max(1, frames) * 100).toFixed(2)}%`);
console.log(`screen x range      [${minSx.toFixed(0)}, ${maxSx.toFixed(0)}] of ${view.w}`);
console.log(`screen y range      [${minSy.toFixed(0)}, ${maxSy.toFixed(0)}] of ${view.h}`);
if (offSamples.length) { console.log('off-screen samples:'); for (const s of offSamples) console.log('  ' + s); }
const ok = onScreen / Math.max(1, frames) > 0.98 && behind / Math.max(1, frames) < 0.02;
console.log(ok ? 'CAMERA: PASS' : 'CAMERA: FAIL');
