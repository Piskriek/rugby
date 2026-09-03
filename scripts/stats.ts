/**
 * HEADLESS STATS AUDIT — T-18 from the shell.
 *
 * Usage:  npx vite-node scripts/stats.ts [matches] [difficulty]
 *
 * Simulates full CPU-v-CPU matches and grades 15 box-score/formation diagnostics
 * against professional and approved integrity ranges. Exits non-zero when the realism score is below 80
 * (T-18's acceptance threshold).
 */
import { auditStats } from '../src/game/statsAudit';
import { gateConfig } from '../src/game/gates';

const matches = Number(process.argv[2] ?? 3);
const diff = Number(process.argv[3] ?? 3);

const report = auditStats(gateConfig(diff), matches);

console.log(`\n=== STATISTICAL REALISM AUDIT — ${matches} matches at difficulty ${diff} ===`);
console.log(report.scoreline);
console.log('');
for (const r of report.results) {
  if (r.details) console.log(`     ${r.label}`);
  for (const metric of r.details ?? [r]) {
    const mark = metric.grade === 'REALISTIC' ? 'OK  ' : metric.grade === 'LOW' ? 'LOW ' : 'HIGH';
    const value = Number.isFinite(metric.value) ? String(metric.value) : '—';
    console.log(`${mark} ${metric.label.padEnd(34)} ${value.padStart(7)}   [${metric.lo} .. ${metric.hi}]`);
  }
}
console.log(`\nScore: ${report.score}% (${report.realistic}/${report.total} realistic)`);
if (report.verdict.length && report.verdict[0] !== 'Every measured statistic falls inside the range a real rugby match produces.') {
  console.log('\nVerdict:');
  for (const v of report.verdict) console.log(`  - ${v}`);
}
if (report.score < 80) process.exit(1);
