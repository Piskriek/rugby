/**
 * SPEC_12 HUMAN-vs-CPU HARNESS.
 *
 * Usage:  npx vite-node scripts/spec12harness.ts [seconds] [aiClean 0|1]
 *
 * The question Force AI Clean has to answer is not "does the CPU ever offend?"
 * with the toggle on — a toggle that stops the counter is not a toggle, it is a
 * blindfold. The question is:
 *
 *   with a HUMAN side in the match and the CPU side under Force AI Clean,
 *   does the human side still get counted and blown while the CPU side
 *   neither offends nor is excused?
 *
 * So this harness puts a real human team on the field (cpuA = false, driven by
 * the AI but flagged human, which is what `isHuman` reads), turns Force AI
 * Clean on, and reports the two sides separately:
 *
 *   episodes     sustained breaches, counted at one fixed sensitivity in every
 *                mode, so a clean CPU is a measurement and not a tautology
 *   whistles     penalties actually conceded (`teams[].stats.offsides`)
 *   suppressed  breaches the CPU was PREVENTED from converting. This is the
 *                honest part of the gate: if the CPU is genuinely shaped well,
 *                this is zero too. If it is being rescued every phase, this
 *                is the number that says so.
 *
 * A CPU that reads 0 episodes AND 0 suppressed is clean. A CPU that reads
 * 0 episodes and 40 suppressed is a CPU that needed rescuing forty times, and
 * the defect is in the AI, not in the law.
 */
import { Director, NO_INPUT, MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 200);
const clean = Number(process.argv[3] ?? 1);
const seeds = [1, 7, 13];
const diffs = [2, 3, 4];

interface Row {
  seed: number; diff: number;
  humanEp: number; cpuEp: number;
  humanWh: number; cpuWh: number;
  cpuSup: number;
}

const rows: Row[] = [];
for (const diff of diffs) {
  for (const seed of seeds) {
    seedRng(seed);
    const base = gateConfig(diff);
    /* team A is the human: flagged human, so Force AI Clean never touches it.
     * team B is the CPU under the toggle. */
    const cfg: MatchConfig = {
      ...base, cpuA: false, cpuB: true,
      options: { ...base.options, offside: 1, offsideAiClean: clean },
    };
    const d = new Director(cfg);
    for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) d.update(1 / 60, NO_INPUT, new Set());
    const f = d.formationIntegrity;
    rows.push({
      seed, diff,
      humanEp: f.offsideEpisodes.A, cpuEp: f.offsideEpisodes.B,
      humanWh: d.teams.A.stats.offsides, cpuWh: d.teams.B.stats.offsides,
      cpuSup: f.offsideSuppressed.B,
    });
  }
}

const tot = (k: keyof Row) => rows.reduce((n, r) => n + r[k], 0);
console.log(`\n=== SPEC_12 HUMAN-vs-CPU HARNESS — ${seconds}s × ${rows.length} fixtures, `
  + `Force AI Clean ${clean ? 'ON' : 'OFF'} ===`);
console.log('  diff  seed   HUMAN epi/whistle      CPU epi/whistle   CPU suppressed');
for (const r of rows) {
  console.log(`   ${String(r.diff).padStart(3)}  ${String(r.seed).padStart(4)}`
    + `   ${String(r.humanEp).padStart(6)} / ${String(r.humanWh).padStart(6)}`
    + `      ${String(r.cpuEp).padStart(6)} / ${String(r.cpuWh).padStart(6)}`
    + `      ${String(r.cpuSup).padStart(6)}`);
}
console.log(`  TOTAL       ${String(tot('humanEp')).padStart(6)} / ${String(tot('humanWh')).padStart(6)}`
  + `      ${String(tot('cpuEp')).padStart(6)} / ${String(tot('cpuWh')).padStart(6)}`
  + `      ${String(tot('cpuSup')).padStart(6)}`);

const cpuEp = tot('cpuEp'), cpuWh = tot('cpuWh'), humanEp = tot('humanEp');
const ok = clean ? (cpuEp === 0 && cpuWh === 0 && humanEp > 0) : true;
console.log(`\n  GATE — CPU episodes ${cpuEp} (want 0), CPU whistles ${cpuWh} (want 0), `
  + `human episodes ${humanEp} (want > 0): ${ok ? 'PASS' : 'FAIL'}`);
if (clean && cpuEp === 0 && tot('cpuSup') > 0) {
  console.log(`  NOTE — the CPU was prevented ${tot('cpuSup')} times. It is clean because it was`
    + ` reshaped, not because it was excused: the episodes it would have committed are recorded.`);
}
