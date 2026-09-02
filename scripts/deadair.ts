import { runDeep } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
let s = 5 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
for (const diff of [0, 3]) {
  const r = runDeep(gateConfig(diff), 120);
  console.log(`diff ${diff}: deadAir avg ${(r.avgDeadAir ?? NaN).toFixed ? (r.avgDeadAir ?? 0).toFixed(2) : r.avgDeadAir}s longest ${(r.longestDeadAir ?? 0).toFixed(2)}s kicks-phase?`);
}
