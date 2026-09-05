import { RugbySim } from '../src/rugby/engine';

const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: 10, human: 'WATCH', seed: 12345 });
let inMaul = 0;
for (let f = 0; f < 40000; f++) {
  sim.step(1 / 60);
  if (sim.phase === 'MAUL') {
    if (inMaul === 0) console.log(`MAUL start t=${(f / 60).toFixed(1)}s x=${sim.maul?.x.toFixed(1)} side=${sim.maul?.side} bound=${sim.maul?.bound.length}`);
    inMaul++;
  } else if (inMaul > 0) {
    console.log(`MAUL end t=${(f / 60).toFixed(1)}s  (lasted ${(inMaul / 60).toFixed(1)}s) -> phase ${sim.phase}`);
    inMaul = 0;
  }
  if (inMaul > 0 && inMaul % 600 === 0) {
    const m = sim.maul!;
    console.log(`  ... still in maul t+${(inMaul / 60).toFixed(0)}s m.t=${m.t.toFixed(1)} stall=${m.stall.toFixed(2)} x=${m.x.toFixed(1)} side=${m.side} bound=${m.bound.length}`);
  }
}
if (inMaul > 0) console.log(`(maul still active at end, ${(inMaul / 60).toFixed(0)}s)`);
console.log('score', sim.A.score, '-', sim.B.score, ' mauls', sim.counts.maul ?? 0, ' tries', sim.counts.try ?? 0);
