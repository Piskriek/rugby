import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
const d: any = new Director(gateConfig(3));
const totals: Record<string, number> = {};
const counts: Record<string, number> = {};
let cur: string | null = null;
let since = 0;
const mark = (t: number) => {
  if (cur) { totals[cur] = (totals[cur] ?? 0) + (t - since); counts[cur] = (counts[cur] ?? 0) + 1; }
};
const d2: any = d;
const origUp = Object.getPrototypeOf(d).update;
// observe phase each frame via public state
let guard = 0;
let simT = 0;
while (!d.over && guard < 60 * 60 * 8) {
  d.update(1/60, NO_INPUT, new Set());
  simT += 1/60;
  const ph = d2.phase;
  if (ph !== cur) { mark(simT); cur = ph; since = simT; }
  guard++;
}
mark(simT);
console.log('engine seconds:', simT.toFixed(0), 'clockScale:', d2.clockScale);
const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows) console.log(k.padEnd(14), v.toFixed(1).padStart(7) + 's', 'n=' + counts[k], 'avg=' + (v / counts[k]).toFixed(1) + 's');
