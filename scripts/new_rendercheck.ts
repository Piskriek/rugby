/**
 * Render-path check: steps a match and draws a frame in every phase, ensuring
 * the draw() code (same path MatchScreen uses) never throws in any state.
 */
import { createCanvas } from '@napi-rs/canvas';
import { RugbySim } from '../src/rugby/engine';
import { Camera, draw, drawMinimap } from '../src/rugby/render';

const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: 10, human: 'WATCH', seed: 4242 });
const cam = new Camera();
const canvas = createCanvas(960, 540);
const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
const view = { w: 960, h: 540 };
const seen = new Set<string>();
let frames = 0;

for (let f = 0; f < 60000 && !sim.ended; f++) {
  sim.step(1 / 60);
  if (f % 120 !== 0) continue;
  cam.update(1 / 60, sim, view);
  try {
    draw(ctx, view, sim, cam, f / 60);
    drawMinimap(ctx, view, sim, sim.ctrlId);
    frames++;
    if (!seen.has(sim.phase)) { seen.add(sim.phase); console.log(`drew ${sim.phase} at frame ${f} (t=${sim.clock.toFixed(0)}s)`); }
  } catch (e) {
    console.error(`DRAW THREW in phase ${sim.phase} at frame ${f}:`, e);
    process.exit(1);
  }
}

console.log('rendered', frames, 'frames across phases:', [...seen].join(', '));
console.log('score', sim.A.score, '-', sim.B.score, 'OK');
