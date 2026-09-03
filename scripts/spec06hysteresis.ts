/**
 * SPEC_06 — deterministic unit check of the hysteresis logic (Machine 1 gait +
 * Machine 2 view debounce). Proves the dead bands hold and that a signal on the
 * line does not flap, while a genuinely sustained crossing still commits.
 * Usage: npx vite-node scripts/spec06hysteresis.ts
 */
import { resolveGait } from '../src/render/scene';
import { updatePaperView } from '../src/render/paper';

let failures = 0;
function expect(cond: boolean, msg: string) {
  if (!cond) { failures++; console.log('  FAIL', msg); }
  else console.log('  ok  ', msg);
}

/* ---------------- Machine 1: gait hysteresis ---------------- */
console.log('--- GAIT: forward ladder (dead bands) ---');
// walk->jog: enter only >= 1.6; hold through 1.25-1.6
expect(resolveGait('walk', 1.6, 0).action === 'jog', 'walk@1.6 -> jog (enter)');
expect(resolveGait('walk', 1.4, 0).action === 'walk', 'walk@1.4 kept (dead band)');
expect(resolveGait('jog', 1.3, 0).action === 'jog', 'jog@1.3 kept (hold > 1.25)');
expect(resolveGait('jog', 1.2, 0).action === 'walk', 'jog@1.2 -> walk (leave)');
// jog->run: enter >= 3.6, hold >= 3.25
expect(resolveGait('jog', 3.6, 0).action === 'run', 'jog@3.6 -> run (enter)');
expect(resolveGait('jog', 3.3, 0).action === 'jog', 'jog@3.3 kept (hold > 3.25)');
expect(resolveGait('run', 3.2, 0).action === 'jog', 'run@3.2 -> jog (leave)');

console.log('--- GAIT: lateral shuffle/strafe (jog <-> shuffle <-> strafe) ---');
// entering shuffle from jog: |lat| >= 1.05 at sub-sprint
expect(resolveGait('jog', 2.0, 1.05).action === 'shuffle', 'jog@2.0 lat1.05 -> shuffle (enter)');
expect(resolveGait('jog', 2.0, 0.95).action === 'jog', 'jog@2.0 lat0.95 kept (dead band < 1.05)');
expect(resolveGait('jog', 2.0, 0.8).action === 'jog', 'jog@2.0 lat0.8 kept (below enter)');
// holding shuffle: stays until |lat| < 0.75
expect(resolveGait('shuffle', 2.0, 0.8).action === 'shuffle', 'shuffle@2.0 lat0.8 held');
expect(resolveGait('shuffle', 2.0, 0.74).action !== 'shuffle', 'shuffle@2.0 lat0.74 -> leaves shuffle');
// shuffle -> strafe: enter |lat| >= 1.15, leave < 0.85
expect(resolveGait('shuffle', 2.0, 1.15).action === 'strafe', 'shuffle@2.0 lat1.15 -> strafe (enter)');
expect(resolveGait('strafe', 2.0, 1.0).action === 'strafe', 'strafe@2.0 lat1.0 held (0.85-1.15)');
expect(resolveGait('strafe', 2.0, 0.84).action === 'shuffle', 'strafe@2.0 lat0.84 -> shuffle (leave strafe)');
// high speed kills the lateral route
expect(resolveGait('jog', 4.5, 2.0).action === 'run', 'jog@4.5 lat2.0 -> run (fast, not shuffle)');

/* ---------------- Machine 2: view debounce ---------------- */
console.log('--- VIEW: edge-side mirror flip (|cross| gate + debounce) ---');
// An actor side-on to the camera: ang in the edge zone, cross sign flips.
const key = 'A1';
// Build a facing/camera geometry that sits in the edge band (ang ~90 deg).
const ax = 0, az = 0;
// facing east: fx=1, fz=0
const fx = 1, fz = 0;
// camera to the east-north so ang ~ 90 deg (edge). We'll nudge cross across 0.
const camE = (crossSign: number) => {
  // place camera such that cross = fx*tz - fz*tx has the given sign, ang ~ 90
  // cross = 1*tz - 0*tx = tz (since fz=0). Set tz = sign*0.001 returns approx.
  const tz = 0.15 * crossSign;             // small but nonzero -> ang ~ 81 deg (edge)
  const tx = 0;                            // camera straight ahead-ish laterally
  return { camX: ax + tx, camZ: az + tz };
};
const dt = 1 / 60;
let cam = camE(1);
let v = updatePaperView(key, fx, fz, ax, az, cam.camX, cam.camZ, dt);
expect(v === 'leftEdge', `first frame edge view = ${v} (cross>0 -> leftEdge)`);

// Now flip cross sign for ONE frame — must NOT flip (debounce holds).
cam = camE(-1);
v = updatePaperView(key, fx, fz, ax, az, cam.camX, cam.camZ, dt);
expect(v === 'leftEdge', `single opposite frame still ${v} (debounce holds)`);

// Sustain the opposite sign ~5 frames -> commits to rightEdge.
let flipped = false;
for (let i = 0; i < 5; i++) {
  cam = camE(-1);
  v = updatePaperView(key, fx, fz, ax, az, cam.camX, cam.camZ, dt);
  if (v === 'rightEdge') flipped = true;
}
expect(flipped, `sustained opposite side commits to rightEdge (after ${(5 * dt).toFixed(2)}s)`);
// After commit, a brief return does not bounce back.
cam = camE(1);
v = updatePaperView(key, fx, fz, ax, az, cam.camX, cam.camZ, dt);
expect(v === 'rightEdge', `single return frame still rightEdge (no bounce)`);

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — hysteresis holds; ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
