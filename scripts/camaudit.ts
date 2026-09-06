/* camaudit.ts — A/B the framing gain against the 1991 framing, same tree.
 *
 * The camera change in this branch multiplies the lens and dollies the rig in,
 * which is a visual win by measurement (a man at a ruck goes from 17 px to
 * 30-40 px in a 360-row frame) and a rule risk at the same time: the audit's
 * off-screen gates count things that leave the frame, and a tighter frame
 * creates exactly that kind of failure. So the claim is checked where it could
 * hurt, on the same tree, one variable at a time — `camScale` is a MatchConfig
 * field for this reason and no other.
 *
 *   npx vite-node scripts/camaudit.ts [seconds] "seed1 seed2 ..."
 */
import { runDeep, runTrace, TRACE_LIMIT } from '../src/game/trace';
import { audit } from '../src/game/audit';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 90);
const seeds = (process.argv[3] ?? '1 2 3 4 5 6').trim().split(/\s+/).map(Number);
const SCALES = [1, Number(process.env.CAM_A ?? 1.5)];

interface Cell { pass: number; warn: number; fail: number; rules: Map<string, number>; watch: number; tele: number }

function run(seed: number, camScale: number): Cell {
  // Identical call order to scripts/audit-cli.ts. A rule count measured with a
  // different amount of randomness consumed upstream is not the same match.
  seedRng(seed);
  const cfg = { ...gateConfig(3), camScale };
  const deep = runDeep(cfg, seconds);
  // ONE reseed, then deep then trace, in that order — exactly audit-cli's order,
  // so these counts can be read next to the numbers quoted in SPEC_24 instead of
  // sitting beside a run that consumed a different amount of randomness.
  const run = runTrace(cfg, seconds, 4, TRACE_LIMIT);
  const report = audit(run.points);
  const c: Cell = { pass: 0, warn: 0, fail: 0, rules: new Map(), watch: deep.watchdogTrips, tele: deep.teleportCount };
  for (const r of report.results) {
    if (r.verdict === 'PASS') c.pass++;
    else {
      if (r.verdict === 'WARN') c.warn++; else c.fail++;
      const k = `${r.verdict} ${r.rule}`;
      c.rules.set(k, (c.rules.get(k) || 0) + 1);
    }
  }
  return c;
}

const totals = new Map<number, Cell>();
const perSeed = new Map<number, Cell[]>();
for (const sc of SCALES) {
  const t: Cell = { pass: 0, warn: 0, fail: 0, rules: new Map(), watch: 0, tele: 0 };
  for (const seed of seeds) {
    const c = run(seed, sc);
    t.pass += c.pass; t.warn += c.warn; t.fail += c.fail;
    t.watch += c.watch; t.tele += c.tele;
    for (const [k, n] of c.rules) t.rules.set(k, (t.rules.get(k) || 0) + n);
    perSeed.set(sc, [...(perSeed.get(sc) ?? []), c]);
    console.log(`scale ${sc}x  seed ${seed}: PASS ${c.pass} WARN ${c.warn} FAIL ${c.fail}  watchdog ${c.watch} teleports ${c.tele}`);
  }
  totals.set(sc, t);
}

console.log(`\n=== ${seconds}s × ${seeds.length} seeds, difficulty 3 ===`);
for (const sc of SCALES) {
  const t = totals.get(sc)!;
  console.log(`camScale ${sc}x — FAIL ${t.fail}  WARN ${t.warn}  watchdog ${t.watch}  teleports ${t.tele}`);
  const rs = [...t.rules.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`   ${rs.length ? rs.map(([k, n]) => `${k}×${n}`).join('  ') : 'no rule failures'}`);
}
const a = totals.get(SCALES[0])!, b = totals.get(SCALES[1])!;
const dFail = b.fail - a.fail, dWarn = b.warn - a.warn;
console.log(`\ndelta from the framing gain: FAIL ${dFail >= 0 ? '+' : ''}${dFail}   WARN ${dWarn >= 0 ? '+' : ''}${dWarn}`);
const worse: string[] = [];
if (dFail > 0) worse.push(`${dFail} more rule failures`);
for (const [k, n] of b.rules) {
  const before = a.rules.get(k) ?? 0;
  if (n > before) worse.push(`${k} ${before} → ${n}`);
}
console.log(worse.length ? `REGRESSION: ${worse.join('; ')}` : 'no regression: the tighter frame costs no rule');
