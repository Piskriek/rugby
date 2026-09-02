import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
const d: any = new Director(gateConfig(3));
const acc: Record<string, number> = {};
let guard = 0;
while (!d.over && guard < 60 * 60 * 8) {
  d.update(1/60, NO_INPUT, new Set());
  const ph: string = d.phase;
  const key = `${ph}${d.paused ? '|paused' : ''}`;
  acc[key] = (acc[key] ?? 0) + 1/60;
  guard++;
}
for (const [k, v] of Object.entries(acc).sort((a, b) => b[1] - a[1])) console.log(k.padEnd(28), v.toFixed(1) + 's');
