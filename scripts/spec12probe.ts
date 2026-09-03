/**
 * SPEC_12 BASELINE PROBE — where does an offside actually go to die?
 *
 * Usage:  npx vite-node scripts/spec12probe.ts [seconds] [difficulty] [seed...]
 *
 * The report is "offsides are not enforced". Before designing enforcement it
 * is worth knowing which of the four places the law is currently lost:
 *
 *   1. the WINDOW never opens        (no ruck formed / no release beat)
 *   2. the BREACH is never sampled   (nobody eligible, or nobody past the line)
 *   3. the breach never SUSTAINS     (0.30 s is a long time at 60 fps)
 *   4. the whistle is SUPPRESSED     (the option gate, or the one-whistle latch)
 *
 * This probe is READ-ONLY. It runs a seeded match and reports the counters the
 * engine already keeps — `formationIntegrity` for the observed side of the law
 * and `teams[].stats.offsides` for the whistled side. It changes nothing.
 */
import { Director, NO_INPUT, MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 200);
const diff = Number(process.argv[3] ?? 3);
const seeds = process.argv.slice(4).map(Number);
const list = seeds.length ? seeds : [1, 7, 13];

interface Row {
  seed: number;
  ruckWindows: number;
  resetWindows: number;
  eligible: number;
  breaching: number;
  episodes: number;
  whistles: number;
  recoveries: number;
  penalties: number;
}

const rows: Row[] = [];

for (const seed of list) {
  seedRng(seed);
  const cfg: MatchConfig = gateConfig(diff);
  const d = new Director(cfg);
  for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) d.update(1 / 60, NO_INPUT, new Set());

  const f = d.formationIntegrity;
  const sum = (t: { A: number; B: number }) => t.A + t.B;
  rows.push({
    seed,
    ruckWindows: f.ruckFormationOpportunities,
    resetWindows: f.defensiveLineResetOpportunities,
    eligible: sum(f.eligiblePositionSamples),
    breaching: sum(f.offsidePlayerSamples),
    episodes: sum(f.offsideEpisodes),
    whistles: d.teams.A.stats.offsides + d.teams.B.stats.offsides,
    recoveries: sum(f.recoveryEpisodes),
    penalties: d.teams.A.stats.penaltiesConceded + d.teams.B.stats.penaltiesConceded,
  });
}

const tot = (k: keyof Row) => rows.reduce((n, r) => n + (r[k] as number), 0);

console.log(`\n=== SPEC_12 BASELINE — ${seconds}s, difficulty ${diff}, seeds ${list.join('/')} ===`);
console.log('  seed   ruckWin  resetWin   eligible  breaching  episodes  whistles  recoveries  pens');
for (const r of rows) {
  console.log(`  ${String(r.seed).padStart(4)}   ${String(r.ruckWindows).padStart(7)}  ${String(r.resetWindows).padStart(8)}`
    + `   ${String(r.eligible).padStart(8)}  ${String(r.breaching).padStart(9)}  ${String(r.episodes).padStart(8)}`
    + `  ${String(r.whistles).padStart(8)}  ${String(r.recoveries).padStart(10)}  ${String(r.penalties).padStart(4)}`);
}
const e = tot('episodes'), w = tot('whistles'), b = tot('breaching'), el = tot('eligible');
console.log(`  TOTAL  ${String(tot('ruckWindows')).padStart(7)}  ${String(tot('resetWindows')).padStart(8)}`
  + `   ${String(el).padStart(8)}  ${String(b).padStart(9)}  ${String(e).padStart(8)}`
  + `  ${String(w).padStart(8)}  ${String(tot('recoveries')).padStart(10)}  ${String(tot('penalties')).padStart(4)}`);
console.log(`\n  FUNNEL (all seeds): ${el} eligible samples → ${b} past the line `
  + `(${(100 * b / Math.max(1, el)).toFixed(2)}%) → ${e} sustained episodes → ${w} whistles`);
console.log(`  A whistle is ${w === 0 ? 'never' : (e / Math.max(1, w)).toFixed(1)} sustained episodes per penalty.`);
