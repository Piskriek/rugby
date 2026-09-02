/**
 * HEADLESS SWEEP — aggregate a simulated match population into the numbers
 * that decide tuning: ruck exit rates (won/stolen/penalised/stalemated),
 * phase-time shares and the box score means.
 *
 * Usage:  npx vite-node scripts/sweep.ts [matches] [difficulty] [seed0]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const N = Number(process.argv[2] ?? 10);
const diff = Number(process.argv[3] ?? 3);
const seed0 = Number(process.argv[4] ?? 1);

// deterministic runs
let s = (seed0 * 2654435761) >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

const ex = { win: 0, steal: 0, pen: 0, stale: 0, recycle: 0 };
const per: { rucks: number; to: number; pens: number; tackles: number; passes: number; tries: number; points: number }[] = [];
for (let m = 0; m < N; m++) {
  const d = new Director(gateConfig(diff));
  const dt = 1 / 60;
  let guard = 60 * 800;
  let lastStage = '', lastAxis = 0;
  while (!d.over && guard-- > 0) {
    if (d.bd) { lastStage = d.bd.stage; lastAxis = d.bd.axis; }
    const to = d.teams.A.stats.turnovers + d.teams.B.stats.turnovers;
    const rk = d.teams.A.stats.rucks + d.teams.B.stats.rucks;
    const pen = d.teams.A.stats.penaltiesConceded + d.teams.B.stats.penaltiesConceded;
    d.update(dt, NO_INPUT, new Set());
    if (d.bd === undefined && lastStage) {
      const toD = d.teams.A.stats.turnovers + d.teams.B.stats.turnovers - to;
      const rkD = d.teams.A.stats.rucks + d.teams.B.stats.rucks - rk;
      const penD = d.teams.A.stats.penaltiesConceded + d.teams.B.stats.penaltiesConceded - pen;
      if (rkD) ex.win++;
      else if (toD && lastAxis <= -0.5) ex.steal++;
      else if (toD) ex.steal++;
      else if (penD) ex.pen++;
      else if (lastStage === 'RUCK') ex.stale++;
      else ex.recycle++;
      lastStage = '';
    }
  }
  const st = (t: 'A' | 'B') => d.teams[t].stats;
  per.push({
    rucks: st('A').rucks + st('B').rucks,
    to: st('A').turnovers + st('B').turnovers,
    pens: st('A').penaltiesConceded + st('B').penaltiesConceded,
    tackles: st('A').tackles + st('B').tackles,
    passes: st('A').passes + st('B').passes,
    tries: 0, // see points
    points: d.A.score + d.B.score,
  });
}
const mean = (k: keyof typeof per[0]) => per.reduce((a, r) => a + r[k], 0) / N;
const tot = ex.win + ex.steal + ex.pen + ex.stale + ex.recycle;
console.log(`\n=== SWEEP — ${N} matches, diff ${diff}, seed ${seed0}+ ===`);
console.log(`ruck exits: won ${ex.win} (${((ex.win / tot) * 100).toFixed(1)}%)  stolen ${ex.steal} (${((ex.steal / tot) * 100).toFixed(1)}%)  pen ${ex.pen} (${((ex.pen / tot) * 100).toFixed(1)}%)  stalemate ${ex.stale} (${((ex.stale / tot) * 100).toFixed(1)}%)  other ${ex.recycle}`);
console.log(`means: rucks ${mean('rucks').toFixed(0)}  turnovers ${mean('to').toFixed(1)}  pens ${mean('pens').toFixed(1)}  tackles ${mean('tackles').toFixed(0)}  passes ${mean('passes').toFixed(0)}  tries ${mean('tries').toFixed(1)}  points ${mean('points').toFixed(0)}`);
