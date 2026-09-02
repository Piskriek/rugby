/** CPU carrier intent distribution, by field position. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 3 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const intents = new Map<string, number>();
const kickZone = new Map<string, number>();
for (let m = 0; m < 3; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800;
  while (!d.over && guard-- > 0) {
    if (d.op && !d.isHuman(d.op.attacking)) {
      const it = d.op.aiIntent;
      if (it) {
        intents.set(it, (intents.get(it) ?? 0) + 1);
        if (it === 'KICK') {
          const z = d.op.toLine < 22 ? 'RED' : d.op.toLine < 50 ? 'MID' : 'OWN';
          kickZone.set(z, (kickZone.get(z) ?? 0) + 1);
        }
      }
    }
    d.update(1 / 60, NO_INPUT, new Set());
  }
}
console.log('intents:', [...intents.entries()].sort((a, b) => b[1] - a[1]));
console.log('kick zone:', [...kickZone.entries()].sort((a, b) => b[1] - a[1]));
