/**
 * HEADLESS RULE AUDIT — the LAW/LOGIC/UX rules over a captured trace.
 *
 * Usage:  npx vite-node scripts/audit-cli.ts [seconds] [difficulty] [seed]
 *
 * The seed pins Math.random for the whole run, so two builds can be compared
 * match-for-match — the audit means nothing if every run is a different game.
 */
import { runDeep, runTrace } from '../src/game/trace';
import { audit } from '../src/game/audit';
import { gateConfig } from '../src/game/gates';

const seconds = Number(process.argv[2] ?? 90);
const diff = Number(process.argv[3] ?? 3);
const seed = Number(process.argv[4] ?? 1);

// deterministic runs: one LCG behind Math.random for this process
let s = seed >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

const deep = runDeep(gateConfig(diff), seconds);
const run = runTrace(gateConfig(diff), seconds);
const report = audit(run.points);
console.log(`\n=== RULE AUDIT — ${seconds}s at difficulty ${diff}, seed ${seed} ===`);
console.log(`points: ${run.points.length}, watchdog trips: ${deep.watchdogTrips}, teleports: ${deep.teleportCount}`);
const counts = { PASS: 0, WARN: 0, FAIL: 0 };
for (const r of report.results) counts[r.verdict]++;
console.log(`PASS ${counts.PASS}  WARN ${counts.WARN}  FAIL ${counts.FAIL}`);
const bad = report.results.filter((r) => r.verdict !== 'PASS');
const byRule = new Map<string, { verdict: string; n: number; why: string }>();
for (const r of bad) {
  const k = `${r.rule} ${r.standard}`;
  const e = byRule.get(k);
  if (e) e.n++;
  else byRule.set(k, { verdict: r.verdict, n: 1, why: r.why });
}
for (const [k, v] of [...byRule.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${v.verdict.padEnd(4)} ${k.padEnd(10)} ×${v.n}  ${v.why}`);
}
