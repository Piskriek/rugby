/** Where and when does the focus leave the frame? Manual loop with the same
 * off-target test as runDeep, plus phase/kick context per event. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { project } from '../src/render/retro';
let s = Number(process.argv[2] ?? 23) >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const d = new Director(gateConfig(3));
const dt = 1 / 60;
let guard = 60 * 90, run = 0, runStart = 0, lastIn = true;
const runs: string[] = [];
while (!d.over && guard-- > 0) {
  d.update(dt, NO_INPUT, new Set());
  const fp = d.focus();
  const pp = project({ ...d.cam, shake: 0 }, { w: 960, h: 540 }, fp.x, 1, fp.z);
  const inFrame = !!pp && pp.sx >= 60 && pp.sx <= 900 && pp.sy >= 60 && pp.sy <= 480;
  const ballLive = !d.kk || d.kk.stage === 'FLIGHT';
  if (!inFrame && ballLive) {
    if (lastIn) { runStart = d.t; runs.push(`${d.t.toFixed(2)}s [${d.phase}${d.kk ? ':' + d.kk.type + ':' + d.kk.stage : ''}] ball@(${fp.x.toFixed(0)},${fp.z.toFixed(0)}) cam yaw=${d.cam.yaw.toFixed(2)} z=${d.cam.z.toFixed(0)} h=${d.cam.h.toFixed(0)}`); }
    run++;
  }
  lastIn = inFrame && ballLive;
}
console.log(`offTarget frames: ${runs.length ? runs.length + ' events' : 'none'}`);
for (const r of runs.slice(0, 12)) console.log('  ', r);
