/** Distribution of the deepest defensive penetration per ruck. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 7 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const bins = new Map<string, number>();
let total = 0;
for (let m = 0; m < 4; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800, minAx = 0, seen = false;
  while (!d.over && guard-- > 0) {
    if (d.bd && d.bd.groundAt >= 0) {
      if (!seen) { minAx = 0; seen = true; }
      minAx = Math.min(minAx, d.bd.axis);
    }
    d.update(1 / 60, NO_INPUT, new Set());
    if (!d.bd && seen) {
      total++;
      const b = minAx <= -0.75 ? '≤-.75' : minAx <= -0.5 ? '-.5..-.75' : minAx <= -0.25 ? '-.25..-.5' : minAx < 0 ? '0..-.25' : '≥0';
      bins.set(b, (bins.get(b) ?? 0) + 1);
      seen = false;
    }
  }
}
console.log('min-axis per ruck over', total, 'rucks:');
for (const [k, v] of [...bins.entries()].sort()) console.log(' ', k.padEnd(10), v, `(${((v / total) * 100).toFixed(1)}%)`);
