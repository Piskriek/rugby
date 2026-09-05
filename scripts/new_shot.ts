/**
 * Renders frames of the new engine to PNG so the game can be inspected without
 * a browser. Uses @napi-rs/canvas (dev dependency) — the same draw() the web
 * build calls.
 *
 * Run: npx vite-node scripts/new_shot.ts <frames> <outfile>
 */
import { createCanvas } from '@napi-rs/canvas';
import { RugbySim } from '../src/rugby/engine';
import { Camera, draw, drawMinimap } from '../src/rugby/render';

const frames = parseInt(process.argv[2] ?? '1800', 10);
const out = process.argv[3] ?? '/tmp/rugby_frame.png';
const W = 1280, H = 720;

const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: 10, human: 'WATCH', seed: 42 });
const cam = new Camera();
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
const view = { w: W, h: H };

for (let f = 0; f < frames; f++) {
  sim.step(1 / 60);
  cam.update(1 / 60, sim, view);
}

draw(ctx, view, sim, cam, frames / 60);
drawMinimap(ctx, view, sim, sim.ctrlId);

const fs = await import('node:fs');
fs.writeFileSync(out, canvas.toBuffer('image/png'));
console.log(`wrote ${out}  phase=${sim.phase} score=${sim.A.score}-${sim.B.score} clock=${sim.clock.toFixed(0)}s`);
