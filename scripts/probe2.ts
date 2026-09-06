import { Director, MatchConfig, NO_INPUT, Input } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

function simMatch(cfg: MatchConfig): Director {
  const d = new Director({ ...cfg, cpuA: true, cpuB: true });
  const dt = 1 / 60;
  let guard = 0;
  while (!d.over && guard < 60 * 60 * 14) {
    d.update(dt, NO_INPUT as Input, new Set<string>());
    guard++;
  }
  return d;
}

const cfg = gateConfig(3);
for (let i = 0; i < 4; i++) {
  const d = simMatch(cfg);
  const A = d.A.stats, B = d.B.stats;
  const tt = A.tackles + B.tackles;
  console.log(`[audit-style] match ${i}: lo=${d.setPieceEvents.lineouts} sc=${d.setPieceEvents.scrums} pens=${A.penaltiesConceded + B.penaltiesConceded} rest=${A.restarts + B.restarts} pass=${A.passes + B.passes} kick=${A.kicks + B.kicks} tackT=${tt} tack=${(tt / 2).toFixed(1)} ruck=${A.rucks + B.rucks} turn=${A.turnovers + B.turnovers} score=${d.A.score}-${d.B.score}`);
}
