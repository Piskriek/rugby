/**
 * SPEC_11 ATTACK OUTCOME HARNESS — did anchoring the formation to the ball
 * change what attacks actually ACHIEVE?
 *
 * Usage:  npx vite-node scripts/spec11attack.ts [seconds] [difficulty] [seed...]
 *
 * A formation fix is only worth its risk if the attack still functions, so
 * this reads the two outcomes the Season 2 queue names for SPEC_11:
 *
 *   ENTRY            one attacking possession reaching inside the defender's
 *                    22 (op.toLine < 22) in open play. One per possession: a
 *                    team that grinds from 24 m to 2 m across six phases has
 *                    made ONE entry, not six.
 *   METRES PER ENTRY team metres carried, divided by entries. Carries are the
 *                    only thing the formation can help or hinder.
 *   CONVERSION       the share of entries that end in a try by the entering
 *                    team before the ball changes hands or the entry goes
 *                    back out past the 22.
 *
 * Determinism: the seed pins Math.random, so before/after runs are the same
 * fixture. Compare like for like — same seeds, same seconds, same difficulty.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 400);
const diff = Number(process.argv[3] ?? 3);
const seeds = process.argv.slice(4).map(Number);
const list = seeds.length ? seeds : [1, 7, 13];

const RED_ZONE = 22;
type Side = 'A' | 'B';

interface Row {
  seed: number;
  entries: Record<Side, number>;
  tries: Record<Side, number>;
  converted: Record<Side, number>;
  metres: Record<Side, number>;
}

const rows: Row[] = [];

for (const seed of list) {
  seedRng(seed);
  const d = new Director(gateConfig(diff));
  const entries: Record<Side, number> = { A: 0, B: 0 };
  const converted: Record<Side, number> = { A: 0, B: 0 };
  /* An entry is open from the moment a team crosses the 22 until the ball
   * changes hands, the match restarts, or the attack is pushed back out. */
  let open: { team: Side; scoreAt: number } | null = null;
  let lastTeam: Side | null = null;
  const guard = Math.ceil(seconds * 60);

  for (let i = 0; i < guard && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    const op = d.op;
    const team: Side | null = op ? op.attacking : null;

    if (open) {
      const scored = d.teams[open.team].score > open.scoreAt;
      if (scored) { converted[open.team]++; open = null; }
      else if (team !== open.team || !op || op.toLine > RED_ZONE) open = null;
    }
    if (op && team !== lastTeam) {
      /* a new possession: the previous entry is dead with it */
      if (open && open.team !== team) open = null;
      lastTeam = team;
    }
    if (op && team && !open && op.toLine < RED_ZONE) {
      entries[team]++;
      open = { team, scoreAt: d.teams[team].score };
    }
  }

  rows.push({
    seed,
    entries,
    converted,
    tries: { A: d.teams.A.score, B: d.teams.B.score },
    metres: { A: d.teams.A.stats.metres, B: d.teams.B.stats.metres },
  });
}

const sum = (f: (r: Row) => number) => rows.reduce((n, r) => n + f(r), 0);
const tot = (side: Side) => ({
  entries: sum((r) => r.entries[side]),
  converted: sum((r) => r.converted[side]),
  metres: sum((r) => r.metres[side]),
});

console.log(`\n=== SPEC_11 ATTACK OUTCOMES — ${seconds}s, difficulty ${diff}, seeds ${list.join('/')} ===`);
console.log('  seed   entries  conv   metres   m/entry   conv%');
for (const r of rows) {
  const e = r.entries.A + r.entries.B;
  const c = r.converted.A + r.converted.B;
  const m = r.metres.A + r.metres.B;
  console.log(`  ${String(r.seed).padStart(4)}   ${String(e).padStart(7)}  ${String(c).padStart(4)}`
    + `   ${String(Math.round(m)).padStart(6)}   ${(m / Math.max(1, e)).toFixed(1).padStart(7)}`
    + `   ${(100 * c / Math.max(1, e)).toFixed(1).padStart(5)}%`);
}
const A = tot('A'), B = tot('B');
const e = A.entries + B.entries, c = A.converted + B.converted, m = A.metres + B.metres;
console.log(`  TOTAL  ${String(e).padStart(7)}  ${String(c).padStart(4)}`
  + `   ${String(Math.round(m)).padStart(6)}   ${(m / Math.max(1, e)).toFixed(1).padStart(7)}`
  + `   ${(100 * c / Math.max(1, e)).toFixed(1).padStart(5)}%`);
console.log(`  (tries on the board: A ${sum((r) => r.tries.A)}  B ${sum((r) => r.tries.B)};`
  + ` metres A ${Math.round(A.metres)} B ${Math.round(B.metres)})`);
