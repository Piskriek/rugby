/**
 * SPEC_16 SHOT — the picture that proves the ratio.
 *
 * Renders one real frame framed on the goalposts, so a figure and the 3.0 m
 * crossbar appear together and the proportion can be judged by eye rather than
 * only in the probe table.
 *
 * Usage: npx vite-node scripts/spec16shot.ts [out.png]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { drawMatch } from '../src/render/scene';
import { type Camera, type View } from '../src/render/retro';
import { Rec } from './spec14rec';
import { rasterise, type Poly } from './pngout';

const out = process.argv[2] ?? 'spec16_scale.png';
const V: View = { w: 820, h: 460 };

seedRng(1);
const d = new Director(gateConfig(3));
// run until players are near the posts so the crossbar shares the frame
let best: { score: number; i: number } | null = null;
for (let i = 0; i < 60 * 180 && !d.over; i++) {
  d.update(1 / 60, NO_INPUT, new Set());
  const bp = d.ballPoint();
  const score = -Math.abs(bp.z - 42);
  if (!best || score > best.score) best = { score, i };
  if (Math.abs(bp.z - 42) < 8) break;
}

/* A fixed rig looking at the posts, so before/after shots are comparable. */
const POSTS_Z = 50;          // drawGoalPosts(..., -HOME_POST_Z) => +50
const CAM_Z = POSTS_Z - 26;  // 26 m in front of the posts
const cam: Camera = {
  x: -7, z: CAM_Z, h: 4.5,
  yaw: Math.atan2(7, POSTS_Z - CAM_Z),
  tilt: 0.06, fov: 0.42, shake: 0, horizon: 0.52, roll: 0,
};

/* drawMatch reads d.cam, so the rig must be installed on the Director. Posts
 * are drawn at z = -HOME_POST_Z = +50; stand back down-field and look at them. */
(d as unknown as { cam: Camera }).cam = cam;

const rec = new Rec();
rec.cap = [];
drawMatch(rec.asCtx(), d, V);

const polys: Poly[] = rec.cap.map((c) => ({
  pts: c.pts as [number, number][],
  fill: c.fill, alpha: c.alpha, isStroke: c.isStroke,
}));
rasterise([{ name: 'SPEC_16  RENDER_SCALE 1.65 — figure vs 3.0 m crossbar', polys }], out, V);
console.log('wrote %s  (%s polys)', out, polys.length);
