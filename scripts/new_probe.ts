/** Instrumented run: logs every phase transition with the in-phase duration. */
import { RugbySim } from '../src/rugby/engine';

const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: 10, human: 'WATCH', seed: 42 });
let prev = sim.phase;
let prevAt = 0;
const hist: Record<string, number[]> = {};
const log: string[] = [];

for (let f = 0; f < 9000; f++) {
  sim.step(1 / 60);
  const t = f / 60;
  if (sim.phase !== prev) {
    const dur = t - prevAt;
    (hist[prev] ??= []).push(dur);
    if (prev === 'MAUL' || sim.phase === 'MAUL') log.push(`${t.toFixed(1)}s ${prev} -> ${sim.phase}  (${dur.toFixed(2)}s)`);
    prev = sim.phase;
    prevAt = t;
  }
}
(hist[prev] ??= []).push(150 - prevAt);

console.log('phase durations (s) — mean / n / max:');
for (const k of Object.keys(hist)) {
  const v = hist[k];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  console.log(`  ${k.padEnd(10)} mean ${mean.toFixed(2)}  n ${v.length}  max ${Math.max(...v).toFixed(1)}`);
}
console.log('\nmaul transitions:');
for (const l of log.slice(0, 40)) console.log('  ' + l);
console.log('score', sim.A.score, '-', sim.B.score, 'tries', sim.counts.try ?? 0, 'linebreaks', sim.counts.lineBreak ?? 0);
