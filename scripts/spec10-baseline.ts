/**
 * SPEC_10 BASELINE — deterministic re-measurement of every audit family
 * against the current tree (Phase 1 of the batch review).
 *
 * Usage:   npx vite-node scripts/spec10-baseline.ts
 * Writes:  spec10-baseline.json        (raw, byte-reproducible)
 *          SPEC_10_BASELINE_TABLE.md   (per-family counts table)
 *
 * Determinism: every simulation cell is seeded through the SPEC_05 ambient
 * seam (seedRng pins Math.random for the whole process). No clocks, no
 * dates, no randomness outside the seam — two invocations on the same tree
 * must produce byte-identical output (that check is the harness's own
 * acceptance test).
 *
 * Matrix: rule audit at difficulties {0,3,6,9} x seeds {11,23,37,51,89},
 * 90-second episodes; realism audit at 5 full matches per difficulty.
 * Layer C (regression gates) is NOT re-triaged here — they are the SPEC_04 /
 * T-68 stage-2 domain and ride as guard rails only.
 */
import { runDeep, runTrace } from '../src/game/trace';
import { audit } from '../src/game/audit';
import { auditStats } from '../src/game/statsAudit';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { writeFileSync } from 'node:fs';

const DIFFS = [0, 3, 6, 9];
const SEEDS = [11, 23, 37, 51, 89];
const RULE_SECONDS = 90;
const STATS_MATCHES = 5;

interface Cell {
  diff: number; seed: number; points: number;
  pass: number; warn: number; fail: number;
  watchdog: number; teleports: number;
}
interface Row { kind: string; rule: string; standard: string; verdict: string; why: string; diff: number; }

const cells: Cell[] = [];
const rows: Row[] = [];
const pointsByDiff: Record<number, number> = {};
let watchdogTotal = 0, teleportTotal = 0;

for (const diff of DIFFS) {
  for (const seed of SEEDS) {
    seedRng(seed * 1000 + diff);
    const cfg = gateConfig(diff);
    const deep = runDeep(cfg, RULE_SECONDS);
    const run = runTrace(cfg, RULE_SECONDS);
    const report = audit(run.points);
    watchdogTotal += deep.watchdogTrips;
    teleportTotal += deep.teleportCount;
    pointsByDiff[diff] = (pointsByDiff[diff] ?? 0) + run.points.length;
    const c: Cell = {
      diff, seed, points: run.points.length,
      pass: 0, warn: 0, fail: 0,
      watchdog: deep.watchdogTrips, teleports: deep.teleportCount,
    };
    for (const r of report.results) {
      if (r.verdict === 'PASS') c.pass++;
      else if (r.verdict === 'WARN') c.warn++;
      else c.fail++;
      if (r.verdict !== 'PASS') rows.push({ kind: r.kind, rule: r.rule, standard: r.standard, verdict: r.verdict, why: r.why, diff });
    }
    cells.push(c);
  }
}

/* ---- per-rule aggregation (FAIL/WARN counts + most common why) ---- */
const rulesMap = new Map<string, { rule: string; family: string; standard: string; fail: number; warn: number; why: string; whyN: number; whyMap: Map<string, number> }>();
for (const r of rows) {
  const k = `${r.kind}/${r.rule}`;
  let e = rulesMap.get(k);
  if (!e) { e = { rule: k, family: r.kind, standard: r.standard, fail: 0, warn: 0, why: '', whyN: 0, whyMap: new Map() }; rulesMap.set(k, e); }
  if (r.verdict === 'FAIL') e.fail++; else e.warn++;
  if (r.verdict === 'FAIL') {
    e.whyMap.set(r.why, (e.whyMap.get(r.why) ?? 0) + 1);
    const n = e.whyMap.get(r.why)!;
    if (n > e.whyN) { e.whyN = n; e.why = r.why; }
  }
}

/* ---- per-family aggregation ---- */
const familiesMap = new Map<string, {
  rulesSeen: Set<string>; fail: number; warn: number;
  failByDiff: Record<number, number>; topRule: string; topRuleN: number; exemplar: string;
}>();
for (const r of rows) {
  let f = familiesMap.get(r.kind);
  if (!f) { f = { rulesSeen: new Set(), fail: 0, warn: 0, failByDiff: {}, topRule: '', topRuleN: 0, exemplar: '' }; familiesMap.set(r.kind, f); }
  f.rulesSeen.add(r.rule);
  if (r.verdict === 'FAIL') {
    f.fail++;
    f.failByDiff[r.diff] = (f.failByDiff[r.diff] ?? 0) + 1;
    const e = rulesMap.get(`${r.kind}/${r.rule}`)!;
    if (e.fail > f.topRuleN) { f.topRuleN = e.fail; f.topRule = r.rule; f.exemplar = e.why; }
  } else f.warn++;
}

/* ---- Layer B: realism audit per difficulty ---- */
interface StatRow { key: string; label: string; value: number; lo: number; hi: number; grade: string; }
const realismByDiff: Record<number, StatRow[]> = {};
const realismScore: Record<number, { score: number; realistic: number; total: number }> = {};
for (const diff of DIFFS) {
  seedRng(4242 + diff * 10);
  const rep = auditStats(gateConfig(diff), STATS_MATCHES);
  const out: StatRow[] = [];
  for (const r of rep.results) {
    if (r.details) for (const d of r.details) out.push({ key: d.key, label: d.label, value: d.value, lo: d.lo, hi: d.hi, grade: d.grade });
    else out.push({ key: r.key, label: r.label, value: r.value, lo: r.lo, hi: r.hi, grade: r.grade });
  }
  realismByDiff[diff] = out;
  realismScore[diff] = { score: rep.score, realistic: rep.realistic, total: rep.total };
}

/* ---- outputs ---- */
const famTable = [...familiesMap.entries()]
  .map(([kind, f]) => {
    const perK = DIFFS.map((dd) => {
      const fails = f.failByDiff[dd] ?? 0;
      const pts = pointsByDiff[dd] ?? 1;
      return { diff: dd, fails, rate: (1000 * fails) / pts };
    });
    const worst = perK.reduce((a, b) => (b.rate > a.rate ? b : a));
    return {
      family: kind, rulesSeen: f.rulesSeen.size, fail: f.fail, warn: f.warn,
      failByDiff: f.failByDiff, worstRate: worst.rate, worstDiff: worst.diff,
      topRule: f.topRule, exemplar: f.exemplar,
    };
  })
  .sort((a, b) => b.fail - a.fail || b.warn - a.warn);

const out = {
  meta: {
    spec: 'SPEC_10 Phase 1 baseline',
    ruleMatrix: { diffs: DIFFS, seeds: SEEDS, seconds: RULE_SECONDS },
    realism: { matchesPerDiff: STATS_MATCHES },
    health: { watchdogTrips: watchdogTotal, teleports: teleportTotal, cells: cells.length },
  },
  ruleAudit: {
    cells,
    pointsByDiff,
    families: famTable,
    rules: [...rulesMap.values()].map((v) => ({ rule: v.rule, family: v.family, standard: v.standard, fail: v.fail, warn: v.warn, why: v.why, whyN: v.whyN })).sort((a, b) => b.fail - a.fail || b.warn - a.warn),
  },
  realism: { byDiff: realismByDiff, score: realismScore },
};
writeFileSync('spec10-baseline.json', JSON.stringify(out, null, 2) + '\n');

const md: string[] = [];
md.push('# SPEC_10 Baseline — per-family re-measurement (Phase 1 output)');
md.push('');
md.push(`Rule audit: ${DIFFS.length} difficulties x ${SEEDS.length} seeds x ${RULE_SECONDS}s episodes (${cells.length} cells, ${rows.length} non-PASS results). Realism audit: ${STATS_MATCHES} full matches per difficulty. Watchdog trips ${watchdogTotal}, teleports ${teleportTotal} across all cells.`);
md.push('');
md.push('## Layer A — rule-audit families (sorted by FAIL count)');
md.push('');
md.push('| family | rules seen | FAIL | WARN | FAIL d0 | d3 | d6 | d9 | worst fail/1k pts | top rule | exemplar |');
md.push('|---|---|---|---|---|---|---|---|---|---|---|');
for (const f of famTable) {
  md.push(`| ${f.family} | ${f.rulesSeen} | ${f.fail} | ${f.warn} | ${f.failByDiff[0] ?? 0} | ${f.failByDiff[3] ?? 0} | ${f.failByDiff[6] ?? 0} | ${f.failByDiff[9] ?? 0} | ${f.worstRate.toFixed(1)} (d${f.worstDiff}) | ${f.topRule} | ${f.exemplar.slice(0, 70)} |`);
}
md.push('');
md.push('## Layer B — realism families (values per difficulty; range and worst grade)');
md.push('');
md.push('| metric | d0 | d3 | d6 | d9 | range | worst |');
md.push('|---|---|---|---|---|---|---|');
const metricKeys = realismByDiff[0].map((r) => r.key);
for (const k of metricKeys) {
  const vals = DIFFS.map((dd) => realismByDiff[dd].find((r) => r.key === k));
  const first = vals.find((v) => v) as StatRow | undefined;
  if (!first) continue;
  const bad = vals.find((v) => v && v.grade !== 'REALISTIC');
  const worst = bad ? bad.grade : 'REALISTIC';
  md.push(`| ${first.label} | ${vals.map((v) => (v ? v.value.toFixed(1) : '—')).join(' | ')} | ${first.lo} .. ${first.hi} | ${worst} |`);
}
md.push('');
for (const dd of DIFFS) md.push(`Realism score d${dd}: ${realismScore[dd].score}% (${realismScore[dd].realistic}/${realismScore[dd].total})`);
md.push('');
writeFileSync('SPEC_10_BASELINE_TABLE.md', md.join('\n') + '\n');
console.log(`baseline written: ${famTable.length} non-clean families, ${out.ruleAudit.rules.length} failing/warning rules, health watchdog=${watchdogTotal} teleports=${teleportTotal}`);
