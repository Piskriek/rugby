import { project, RENDER_SCALE } from '../src/render/retro';
const v = { w: 960, h: 540 };
const cam = { x: 0.2, z: 35.3, h: 13.9, yaw: 0, tilt: 1.07, fov: 1.2, horizon: 0.42, roll: 0, shake: 0 };
const bp = { x: -0.3, y: 0.2, z: 28.0 };
const p = project(cam, v, bp.x, bp.y, bp.z);
console.log('scale', RENDER_SCALE, 'proj', p);
// also try tilt 0.9, fov 0.8
for (const tilt of [0.7, 0.9, 1.0, 1.07]) {
  for (const fov of [0.8, 1.0, 1.2]) {
    const q = project({ ...cam, tilt, fov }, v, bp.x, bp.y, bp.z);
    console.log(tilt.toFixed(2), fov.toFixed(2), q ? `sx${q.sx.toFixed(0)} sy${q.sy.toFixed(0)} f${q.f.toFixed(2)}` : 'null');
  }
}
