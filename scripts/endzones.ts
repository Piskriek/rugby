/** Classify every possession-ending kick by field position at the kick. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 3 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const zones = new Map<string, number>();
const types = new Map<string, number>();
let lastToLine = 99, lastPhase = 1;
for (let m = 0; m < 3; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800, wasKick = false;
  while (!d.over && guard-- > 0) {
    if (d.op) { lastToLine = d.op.toLine; lastPhase = d.op.phase; }
    const wasK = !!d.kk;
    d.update(1 / 60, NO_INPUT, new Set());
    if (!wasK && d.kk && d.kk.stage !== 'FANFARE') {
      types.set(d.kk.type, (types.get(d.kk.type) ?? 0) + 1);
      if (d.kk.type === 'PUNT' || d.kk.type === 'GRUBBER' || d.kk.type === 'BOMB' || d.kk.type === 'CROSS') {
        const z = lastToLine < 22 ? 'RED(<22)' : lastToLine < 40 ? '22-40' : lastToLine < 60 ? '40-60' : 'OWN(60+)';
        const key = `${z} phase${lastPhase}`;
        zones.set(key, (zones.get(key) ?? 0) + 1);
      }
    }
  }
}
console.log('kick types:', [...types.entries()].sort((a, b) => b[1] - a[1]));
for (const [k, v] of [...zones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(' ', v, k);
