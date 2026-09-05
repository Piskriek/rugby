/** Multi-seed summary: run N full matches and report score/try distribution. */
import { RugbySim } from '../src/rugby/engine';

const N = parseInt(process.argv[2] ?? '8', 10);
const halfMin = parseInt(process.argv[3] ?? '2', 10);
let totalTries = 0, totalPens = 0, totalDrops = 0, totalConv = 0, totalScore = 0;
console.log(`seed      score    tries  pens  drops  conv  linebreaks  phases`);
for (let s = 0; s < N; s++) {
  const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: halfMin, human: 'WATCH', seed: 1000 + s * 37 });
  for (let f = 0; f < halfMin * 60 * 2 * 60 && !sim.ended; f++) sim.step(1 / 60);
  const c = sim.counts;
  const tries = c.try ?? 0, pens = c.penaltyGoal ?? 0, drops = c.dropGoal ?? 0, conv = c.conversion ?? 0;
  totalTries += tries; totalPens += pens; totalDrops += drops; totalConv += conv;
  totalScore += sim.A.score + sim.B.score;
  const phases = Object.keys(c).join(',');
  console.log(`${String(1000 + s * 37).padEnd(9)} ${String(sim.A.score).padStart(2)}-${String(sim.B.score).padEnd(2)}  ${String(tries).padEnd(5)} ${String(pens).padEnd(5)} ${String(drops).padEnd(5)} ${String(conv).padEnd(5)} ${String(c.lineBreak ?? 0).padEnd(11)} ${phases.length > 40 ? phases.slice(0, 40) + '…' : phases}`);
}
console.log('\ntotals over', N, 'matches: tries', totalTries, 'penalty goals', totalPens, 'drop goals', totalDrops,
  'conversions', totalConv, 'avg match points', (totalScore / N).toFixed(1));
