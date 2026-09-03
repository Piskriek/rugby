import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 5 >>> 0 || 1;
const dt = 1 / 60;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const stageT: Record<string, number> = {};
const durs: number[] = [];
let prev: any = null, start = 0;
for (let m = 0; m < 2; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 400;
  while (!d.over && guard-- > 0) {
    d.update(dt, NO_INPUT, new Set());
    if (d.bd) {
      const st = d.bd.stage;
      stageT[st] = (stageT[st] ?? 0) + dt;
      if (!prev) start = d.t;
      prev = d.bd;
    } else if (prev) {
      durs.push(d.t - start);
      prev = null;
    }
  }
}
durs.sort((a, b) => a - b);
const q = (p: number) => durs[Math.floor(p * (durs.length - 1))].toFixed(2);
console.log(`n=${durs.length} p50=${q(0.5)} p90=${q(0.9)} p99=${q(0.99)} mean=${(durs.reduce((a, b) => a + b, 0) / durs.length).toFixed(2)}`);
console.log('stage seconds:', stageT);
console.log('longest 6:', durs.slice(-6).map((x) => x.toFixed(1)).join(', '));
