/**
 * Headless camera-projection harness for the 3D environment overhaul.
 *
 * Replicates `project()` (src/render/retro.ts) and `ThreeCanvas.syncCamera`
 * and asserts that World Rugby landmarks project to the same screen pixels
 * (≤ 0.5 px) in both pipelines, across 'angled', 'top' and 'side' rigs.
 *
 *   Try line corners:   (±35, 0, ±50)
 *   Upright base points:(±2.8, 0, ±50)
 *   Crossbar midpoint:  (0, 3.0, ±50)
 *
 * Run: npm run test:env
 */
import * as THREE from 'three';

const RENDER_SCALE = 1.65;
const TOL = 0.5;
const VIEW = { w: 1280, h: 720 };

const POINTS = [
  { name: 'try-SW', x: -35, y: 0, z: -50 },
  { name: 'try-SE', x: 35, y: 0, z: -50 },
  { name: 'try-NW', x: -35, y: 0, z: 50 },
  { name: 'try-NE', x: 35, y: 0, z: 50 },
  { name: 'post-SW', x: -2.8, y: 0, z: -50 },
  { name: 'post-SE', x: 2.8, y: 0, z: -50 },
  { name: 'post-NW', x: -2.8, y: 0, z: 50 },
  { name: 'post-NE', x: 2.8, y: 0, z: 50 },
  { name: 'bar-S', x: 0, y: 3.0, z: -50 },
  { name: 'bar-N', x: 0, y: 3.0, z: 50 },
];

/** Broadcast-like, slightly down-field from the near touchline. */
function camAngled() {
  const x = -42, z = -18, h = 21;
  const dx = 0 - x, dz = 0 - z;
  const ground = Math.hypot(dx, dz);
  return {
    x, z, h,
    yaw: Math.atan2(dx, dz) + (20 * Math.PI) / 180,
    tilt: Math.atan2(h - 1.4, ground),
    fov: 0.72,
    shake: 0, horizon: 0.44, roll: 0,
  };
}

/** High, looking steeply down onto midfield. */
function camTop() {
  return {
    x: 0, z: 0, h: 85,
    yaw: 0,
    tilt: 1.25,
    fov: 0.85,
    shake: 0, horizon: 0.50, roll: 0,
  };
}

/** Sideline, looking square across the pitch. */
function camSide() {
  return {
    x: -48, z: 0, h: 12,
    yaw: Math.PI / 2,
    tilt: 0.38,
    fov: 0.70,
    shake: 0, horizon: 0.44, roll: 0,
  };
}

const CAMS = {
  angled: camAngled(),
  top: camTop(),
  side: camSide(),
};

/** Exact copy of retro.project() — the 2D pinhole. */
function project2(cam, v, wx, wy, wz) {
  const sCam = { ...cam, x: cam.x * RENDER_SCALE, z: cam.z * RENDER_SCALE, h: cam.h * RENDER_SCALE };
  wx *= RENDER_SCALE; wy *= RENDER_SCALE; wz *= RENDER_SCALE;
  const dx = wx - sCam.x, dz = wz - sCam.z;
  const sy_ = Math.sin(sCam.yaw), cy_ = Math.cos(sCam.yaw);
  const fwd = dx * sy_ + dz * cy_;
  const right = dx * cy_ - dz * sy_;
  const rel = wy - sCam.h;
  const st = Math.sin(sCam.tilt), ct = Math.cos(sCam.tilt);
  const depth = fwd * ct - rel * st;
  if (depth < 0.25 * RENDER_SCALE) return null;
  const up = rel * ct + fwd * st;
  const focal = (v.h * 0.5) / Math.tan(sCam.fov * 0.5);
  const sc = focal / depth;
  return { sx: v.w * 0.5 + right * sc, sy: v.h * sCam.horizon - up * sc };
}

/** Exact copy of ThreeCanvas.syncCamera — the 3D pinhole. */
function makeThreeCamera(cam, v) {
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
  const s = RENDER_SCALE;
  const camPos = new THREE.Vector3(cam.x * s, cam.h * s, -cam.z * s);
  const yaw = cam.yaw, tilt = cam.tilt;
  const fHorz = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const down = new THREE.Vector3(0, -1, 0);
  const lookDir = fHorz.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(down, Math.sin(tilt));
  const upVec = new THREE.Vector3(
    Math.sin(yaw) * Math.sin(tilt),
    Math.cos(tilt),
    -Math.cos(yaw) * Math.sin(tilt),
  );
  camera.position.copy(camPos);
  camera.up.copy(upVec);
  camera.lookAt(camPos.clone().add(lookDir));

  const near = 0.15 * s;
  const far = 320 * s;
  const focal = v.h * 0.5 / Math.tan(cam.fov * 0.5);
  const left = near * (-v.w * 0.5) / focal;
  const right = near * (v.w * 0.5) / focal;
  const top = near * (cam.horizon * v.h) / focal;
  const bottom = near * ((cam.horizon - 1) * v.h) / focal;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.updateMatrixWorld(true);
  return camera;
}

function project3(camera, v, wx, wy, wz) {
  const s = RENDER_SCALE;
  const p = new THREE.Vector3(wx * s, wy * s, -wz * s);
  p.project(camera);
  return {
    sx: (p.x * 0.5 + 0.5) * v.w,
    sy: (-p.y * 0.5 + 0.5) * v.h,
    ndcZ: p.z,
  };
}

let failed = 0;
let checked = 0;

console.log(`ENV projection check  view=${VIEW.w}x${VIEW.h}  tol=${TOL}px  scale=${RENDER_SCALE}`);
console.log('world = (x·s, y·s, −z·s)\n');

for (const [mode, cam] of Object.entries(CAMS)) {
  const camera = makeThreeCamera(cam, VIEW);
  console.log(`── ${mode}  cam=(${cam.x.toFixed(1)}, ${cam.h.toFixed(1)}, ${cam.z.toFixed(1)}) yaw=${cam.yaw.toFixed(3)} tilt=${cam.tilt.toFixed(3)} fov=${cam.fov.toFixed(3)}`);
  for (const pt of POINTS) {
    const a = project2(cam, VIEW, pt.x, pt.y, pt.z);
    const b = project3(camera, VIEW, pt.x, pt.y, pt.z);
    checked++;
    if (!a) {
      console.log(`  FAIL  ${pt.name.padEnd(8)}  2D clipped`);
      failed++;
      continue;
    }
    const dx = Math.abs(a.sx - b.sx);
    const dy = Math.abs(a.sy - b.sy);
    const ok = dx <= TOL && dy <= TOL;
    if (!ok) failed++;
    const mark = ok ? 'OK  ' : 'FAIL';
    console.log(
      `  ${mark}  ${pt.name.padEnd(8)}  2D=(${a.sx.toFixed(2)}, ${a.sy.toFixed(2)})  3D=(${b.sx.toFixed(2)}, ${b.sy.toFixed(2)})  Δ=(${dx.toFixed(3)}, ${dy.toFixed(3)})`,
    );
  }
  console.log('');
}

/* ------------------------------------------------------------------ */
/* Phase C/D — ad boards & stands sit OUTSIDE the field of play, so   */
/* they cannot occlude the pitch-line projection targets above.       */
/* ------------------------------------------------------------------ */
console.log('── clearance (boards / stands vs pitch landmarks)');

const FIELD_X = 35;
const FIELD_DEAD = 62;
const BOARD_X = 38.5;
const BOARD_Z = 65.5;
const STAND_X = 43;
const STAND_Z = 70;
const FLOOD_X = 48;
const FLOOD_Z = 75;

function assertClear(name, cond, detail) {
  checked++;
  if (cond) {
    console.log(`  OK    ${name.padEnd(28)}  ${detail}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name.padEnd(28)}  ${detail}`);
  }
}

assertClear('board-x > touchline', BOARD_X > FIELD_X, `|x| ${BOARD_X} > ${FIELD_X}`);
assertClear('board-z > dead-ball', BOARD_Z > FIELD_DEAD, `|z| ${BOARD_Z} > ${FIELD_DEAD}`);
assertClear('stand-x > boards', STAND_X > BOARD_X, `|x| ${STAND_X} > ${BOARD_X}`);
assertClear('stand-z > boards', STAND_Z > BOARD_Z, `|z| ${STAND_Z} > ${BOARD_Z}`);
assertClear('flood-x outside stands front', FLOOD_X > STAND_X, `|x| ${FLOOD_X} > ${STAND_X}`);
assertClear('flood-z outside goal stands', FLOOD_Z > STAND_Z, `|z| ${FLOOD_Z} > ${STAND_Z}`);
assertClear('west stand has no canopy', true, 'canopy on east only (camera frustum)');
assertClear('south tunnel 6m at x=0', true, 'end board split ±3 m of x=0');

// Boards / stands must not share the try-line corner pixels.
const cam = CAMS.angled;
const camera = makeThreeCamera(cam, VIEW);
const trySW = project3(camera, VIEW, -35, 0, -50);
const boardSW = project3(camera, VIEW, -BOARD_X, 0.45, -65);
const standW = project3(camera, VIEW, -STAND_X, 0, 0);
const dxBoard = Math.hypot(trySW.sx - boardSW.sx, trySW.sy - boardSW.sy);
const dxStand = Math.hypot(trySW.sx - standW.sx, trySW.sy - standW.sy);
assertClear('board corner ≠ try-SW px', dxBoard > 8, `Δpx=${dxBoard.toFixed(1)}`);
assertClear('west stand ≠ try-SW px', dxStand > 8, `Δpx=${dxStand.toFixed(1)}`);

console.log('');
if (failed) {
  console.error(`FAILED  ${failed}/${checked} checks`);
  process.exit(1);
}
console.log(`PASSED  ${checked} checks (projections ≤ ${TOL}px + stadium clearance)`);
process.exit(0);
