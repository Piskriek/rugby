/** How possessions end — and how tired the defenders are. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
let s = 3 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

const ends = new Map<string, number>();
let phases = 0, phaseSum = 0, poss = 0, maxPh = 0;
let lastEnd: string | null = null;
let redEntered = 0, redTries = 0, redAny = 0;
let inRed = false, cur: 'A' | 'B' | null = null;
let defStaSum = 0, defStaN = 0, redDefSta = 0, redDefN = 0;
for (let m = 0; m < 3; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800;
  let lastPoss: 'A' | 'B' | null = d.possession;
  while (!d.over && guard-- > 0) {
    d.update(1 / 60, NO_INPUT, new Set());
    if (d.op) {
      if (d.op.attacking !== cur) {
        if (cur !== null && d.op.phase === 1) {
          phaseSum += phases; poss++; maxPh = Math.max(maxPh, phases);
          const kind = lastEnd ?? `OPEN:${phases}p`;
          ends.set(kind, (ends.get(kind) ?? 0) + 1);
          if (inRed) { redAny++; if (kind === 'TRY') redTries++; }
          lastEnd = null; inRed = false;
        }
        cur = d.op.attacking;
      }
      if (d.op.toLine < 22) inRed = true;
      if (d.op.phase > phases) phases = d.op.phase;
    }
    const def = d.defending();
    const sta = d.live.filter((p) => p.team === def && p.sinbin <= 0).reduce((a, p) => a + p.stamina, 0) / 15;
    defStaSum += sta; defStaN++;
    if (inRed && d.bd) { redDefSta += sta; redDefN++; }
    for (const ev of d.frameEvents) {
      if (ev.type === 'TRY') lastEnd = 'TRY';
      else if (ev.type === 'TURNOVER') lastEnd = 'TURNOVER';
      else if (ev.type === 'KICK') lastEnd = 'KICK';
    }
    const f = d.feed[0]?.text ?? '';
    if (f.startsWith('INTO TOUCH')) lastEnd = 'TOUCH';
    if (d.pendingPenalty) lastEnd = 'PENALTY';
    if (d.scrim && d.phase === 'SCRUM') lastEnd = lastEnd === 'KICK' ? 'KICK' : 'ERROR/SCRUM';
  }
}
const avg = (a: number, n: number) => n ? (a / n).toFixed(1) : '-';
console.log(`possessions ${poss}, avg phases ${(phaseSum / poss).toFixed(2)}, max ${maxPh}`);
for (const [k, v] of [...ends.entries()].sort((a, b) => b[1] - a[1])) console.log('  end:', k.padEnd(14), v);
console.log(`red-zone: entered ${redEntered ?? redAny}, converted tries ${redTries}`);
console.log(`defensive stamina avg ${avg(defStaSum, defStaN)}, in red-zone contests ${avg(redDefSta, redDefN)}`);
