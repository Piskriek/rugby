/**
 * BREAKDOWN AUDIT — the numbers behind the tackle → clearout → ball-out.
 * Run: npx vite-node scripts/new_breakdown_probe.ts [matches] [halfMinutes]
 *
 * Runs N full WATCH matches and reports, per breakdown event and in aggregate:
 *   - how tackles resolve (landed / offload / knock-on / held up / line break)
 *   - the contest outcome (clean / turnover / penalty, and quick vs slow ball)
 *   - the arrival race (jackal first vs clearout first) and its effect
 *   - the ball-out: who emerged with possession, and how long the ruck took
 *   - turnover & penalty rates against the professional bands
 */
import { RugbySim } from '../src/rugby/engine';

const N = parseInt(process.argv[2] ?? '20', 10);
const halfMin = parseInt(process.argv[3] ?? '10', 10);

const agg = {
  tackles: 0, offloads: 0, knockOns: 0, heldUp: 0, lineBreaks: 0, mauls: 0,
  breakdowns: 0, clean: 0, turnover: 0, penAttack: 0, penDefence: 0,
  quick: 0, slow: 0, jackalFirst: 0, clearFirst: 0,
  ballOutAttack: 0, ballOutDefence: 0, ruckDur: 0, ruckN: 0,
  tries: 0, pens: 0, drops: 0, conv: 0, totalScore: 0,
  turnoverProbMean: 0, turnoverProbN: 0,
};
const perSeed: string[] = [];

for (let s = 0; s < N; s++) {
  const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: halfMin, human: 'WATCH', seed: 1000 + s * 37 });
  let prevPhase = '';
  let ruckStart = 0;
  for (let f = 0; f < halfMin * 60 * 2 * 60 && !sim.ended; f++) {
    sim.step(1 / 60);
    // time ruck length on the MONOTONIC frame clock — sim.clock resets at
    // half-time, which would make a ruck spanning the break read as negative
    const now = f / 60;
    if (sim.phase === 'RUCK' && prevPhase !== 'RUCK') ruckStart = now;
    if (sim.phase !== 'RUCK' && prevPhase === 'RUCK') { agg.ruckDur += now - ruckStart; agg.ruckN++; }
    prevPhase = sim.phase;
  }
  const c = sim.counts;
  const d = c.breakdown ?? 0;
  const turnover = c.bdTurnover ?? 0;
  const clean = c.bdClean ?? 0;
  const penA = c.bdPenAttack ?? 0;
  const penD = c.bdPenDefence ?? 0;
  agg.breakdowns += d; agg.clean += clean; agg.turnover += turnover;
  agg.penAttack += penA; agg.penDefence += penD;
  agg.quick += c.bdQuick ?? 0; agg.slow += c.bdSlow ?? 0;
  agg.tackles += c.tackle ?? 0; agg.offloads += c.offload ?? 0; agg.knockOns += c.knockOn ?? 0;
  agg.heldUp += c.holdUp ?? 0; agg.lineBreaks += c.lineBreak ?? 0; agg.mauls += c.maul ?? 0;
  agg.tries += c.try ?? 0; agg.pens += c.penaltyGoal ?? 0; agg.drops += c.dropGoal ?? 0; agg.conv += c.conversion ?? 0;
  agg.totalScore += sim.A.score + sim.B.score;
  const outA = clean - (c.bdTurnover ?? 0) * 0; // clean → attack kept it
  agg.ballOutAttack += clean; agg.ballOutDefence += turnover;
  perSeed.push(`${String(1000 + s * 37).padEnd(5)} ${String(sim.A.score).padStart(2)}-${String(sim.B.score).padEnd(2)}  bd=${String(d).padEnd(3)} clean=${String(clean).padEnd(3)} to=${String(turnover).padEnd(2)} pen=${String(penA + penD).padEnd(2)} quick=${c.bdQuick ?? 0} slow=${c.bdSlow ?? 0}`);
  void outA;
}

const total = agg.breakdowns || 1;
console.log('=== BREAKDOWN AUDIT ===');
console.log(`matches            ${N} × ${halfMin} min halves (${N * halfMin * 2} min of rugby)`);
console.log('');
console.log('per seed (seed  score  bd=breakdowns  clean  to=turnovers  pen  quick  slow):');
for (const l of perSeed) console.log('  ' + l);
console.log('');
console.log('--- the tackle ---');
console.log(`tackles landed     ${agg.tackles}   (${(agg.tackles / Math.max(1, N)).toFixed(1)} / match)`);
console.log(`offloads           ${agg.offloads}   (${(agg.offloads / Math.max(1, agg.tackles) * 100).toFixed(0)}% of tackles)`);
console.log(`knock-ons          ${agg.knockOns}`);
console.log(`held up            ${agg.heldUp}`);
console.log(`line breaks        ${agg.lineBreaks}`);
console.log(`mauls              ${agg.mauls}`);
console.log('');
console.log('--- the breakdown (pre-simulated) ---');
console.log(`breakdowns         ${agg.breakdowns}`);
console.log(`  clean (attack)   ${agg.clean}   (${(agg.clean / total * 100).toFixed(1)}%)`);
console.log(`  turnover         ${agg.turnover}   (${(agg.turnover / total * 100).toFixed(1)}%)`);
console.log(`  penalty attack   ${agg.penAttack}   (not releasing)`);
console.log(`  penalty defence  ${agg.penDefence}   (hands in the ruck)`);
console.log(`  quick ball       ${agg.quick}   (${(agg.quick / total * 100).toFixed(1)}%)`);
console.log(`  slow ball        ${agg.slow}   (${(agg.slow / total * 100).toFixed(1)}%)`);
console.log(`  mean ruck length ${(agg.ruckDur / Math.max(1, agg.ruckN)).toFixed(2)} s`);
console.log('');
console.log('--- scoring ---');
console.log(`tries ${agg.tries} · penalty goals ${agg.pens} · drop goals ${agg.drops} · conversions ${agg.conv} · avg points ${(agg.totalScore / Math.max(1, N)).toFixed(1)}`);
console.log('');
const toRate = agg.turnover / total;
const penRate = (agg.penAttack + agg.penDefence) / total;
console.log('--- verdict vs professional band ---');
console.log(`turnover rate      ${(toRate * 100).toFixed(1)}%  (pro band ~8-14%)  ${toRate >= 0.06 && toRate <= 0.18 ? 'OK' : 'TUNE'}`);
console.log(`breakdown pen rate ${(penRate * 100).toFixed(1)}%  (pro band ~2-5%)   ${penRate >= 0.01 && penRate <= 0.08 ? 'OK' : 'TUNE'}`);
console.log(`quick ball share   ${(agg.quick / total * 100).toFixed(1)}%  (pro band ~45-60%)`);
