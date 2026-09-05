/** Field-position analysis: where does the ball live, and how far does each
 * possession advance? Also tracks possession length and outcomes. */
import { RugbySim } from '../src/rugby/engine';

const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: 10, human: 'WATCH', seed: 42 });
const xHist: Record<number, number> = {}; // 10m bands
let prevPoss: 'A' | 'B' | null = null;
let possStartX = 0, possStartT = 0, possGains: number[] = [], possT: number[] = [];
let maxForward = 0; // deepest penetration in attack dir
let carried = 0, inFlight = 0, loose = 0;

for (let f = 0; f < 18000; f++) {
  sim.step(1 / 60);
  const t = f / 60;
  const b = sim.ball;
  const band = Math.floor((b.x + 50) / 10) * 10 - 50;
  xHist[band] = (xHist[band] ?? 0) + 1;
  if (b.owner != null) carried++; else if (b.z > 0.01) inFlight++; else loose++;

  const c = sim.carrier();
  if (c) {
    const ad = sim.attackDir(c.side);
    maxForward = Math.max(maxForward, b.x * ad);
  }

  if (sim.possession !== prevPoss) {
    if (prevPoss != null) {
      const gain = (b.x - possStartX) * sim.attackDir(prevPoss);
      possGains.push(gain);
      possT.push(t - possStartT);
    }
    prevPoss = sim.possession;
    possStartX = b.x; possStartT = t;
  }
}

console.log('ball x histogram (10m bands, 50 = A try line):');
const bands = Object.keys(xHist).map(Number).sort((a, b) => a - b);
for (const band of bands) {
  const n = xHist[band];
  const bar = '#'.repeat(Math.round(n / 300));
  console.log(`  ${String(band + 5).padStart(4)}m ${bar} ${n}`);
}
const g = possGains;
console.log('\npossession gains (m, +ve = forward in attack dir):');
console.log('  n', g.length, 'mean', (g.reduce((a, b) => a + b, 0) / Math.max(1, g.length)).toFixed(1),
  'max', Math.max(...g).toFixed(1), 'min', Math.min(...g).toFixed(1),
  'positive%', (g.filter((x) => x > 0).length / Math.max(1, g.length) * 100).toFixed(0));
console.log('possession length mean', (possT.reduce((a, b) => a + b, 0) / Math.max(1, possT.length)).toFixed(1) + 's');
console.log('deepest penetration (attack dir)', maxForward.toFixed(1) + 'm  (50 = try line)');
console.log('ball state: carried', carried, 'inFlight', inFlight, 'loose', loose);
console.log('score', sim.A.score, '-', sim.B.score, ' tries', sim.counts.try ?? 0, ' linebreaks', sim.counts.lineBreak ?? 0);
