/** Time inside each KICK stage, and how the phase ends. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 3 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const stage: Record<string, number> = {};
const ends: Record<string, number> = {};
for (let m = 0; m < 3; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800, t0 = 0, cur = '';
  const mark = () => { if (cur) stage[cur] = (stage[cur] ?? 0) + (d.kk ? 0 : 0); };
  while (!d.over && guard-- > 0) {
    const k0 = d.kk;
    const st0 = k0 ? `${k0.type}:${k0.stage}` : '';
    const inKick = d.phase === 'KICK';
    d.update(1 / 60, NO_INPUT, new Set());
    if (inKick && d.kk) {
      const st1 = `${d.kk.type}:${d.kk.stage}`;
      if (st1 !== cur) { cur = st1; t0 = d.kk.t; }
      stage[st1] = (stage[st1] ?? 0) + 1 / 60;
    } else if (cur) {
      ends[cur] = (ends[cur] ?? 0) + 1;
      cur = '';
    }
  }
}
const total = Object.values(stage).reduce((a, b) => a + b, 0);
console.log(`KICK phase total ${total.toFixed(0)}s`);
for (const [k, v] of Object.entries(stage).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(' ', k.padEnd(20), v.toFixed(1) + 's');
}
console.log('ends:', Object.entries(ends).sort((a, b) => b[1] - a[1]).slice(0, 8));
