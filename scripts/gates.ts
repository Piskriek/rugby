/**
 * HEADLESS GATE RUNNER — the CLI face of the audit's regression gates.
 *
 * Usage:  npx vite-node scripts/gates.ts [seconds]
 *
 * Runs the fault hunt (`runDeep`) at difficulties 0/3/6/9 — T-16's verification
 * sweep — then the named regression gates across 0/3/6. Exits non-zero if any
 * gate fails, so CI can fail a build on a regression.
 */
import { runDeep } from '../src/game/trace';
import { gateConfig, runGates } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

/* T-18 note: the tackle gate flakes at its 8-floor on short samples — the
 * handoff says so in so many words. The default sample is long enough that
 * a green board means something; pass an explicit number to go faster. */
const seconds = Number(process.argv[2] ?? 100);
/* SPEC_05 / T-68: the gate harness must be deterministic. The whole flicker
 * (NO-TELEPORTS / BALL-ON-SCREEN / CHASE-ARRIVALS) was unseeded runs; pin the
 * ambient seed so the same build gives the same gate board every time. */
const seed = Number(process.argv[3] ?? 1);
seedRng(seed);

function row(cells: string[], widths: number[]): string {
  return cells.map((c, i) => String(c).padEnd(widths[i])).join(' ');
}

console.log(`\n=== FAULT HUNT (T-16 sweep) — ${seconds}s per difficulty ===`);
const widths = [8, 10, 10, 9, 8, 8, 9, 9, 12, 10];
console.log(row(['diff', 'teleport', 'noBounce', 'tackles', 'chase', 'whip', 'freeze', 'encroach', 'offTarget', 'possChg'], widths));
let anyFreeze = false;
for (const diff of [0, 3, 6, 9]) {
  const r = runDeep(gateConfig(diff), seconds);
  if (r.watchdogTrips > 0) anyFreeze = true;
  console.log(row([
    diff,
    r.teleportCount, r.neverBounced, r.tacklesMade, r.chaseArrivals,
    r.whipFrames, r.watchdogTrips, r.encroachFrames, r.offTargetFrames, r.possessionChanges,
  ], widths));
  if (r.watchdogLog.length) {
    for (const line of r.watchdogLog) console.log(`    [watchdog d${diff}] ${line}`);
  }
}

console.log(`\n=== REGRESSION GATES — strictest value across difficulty 0/3/6 ===`);
const report = runGates(seconds);
for (const g of report.results) {
  console.log(`${g.pass ? 'PASS' : 'FAIL'}  ${g.label.padEnd(22)} ${String(g.value).padStart(6)}  (${g.op} ${g.threshold})`);
}
console.log(`\n${report.pass}/${report.total} gates pass${report.overall ? '' : ' — REGRESSION PRESENT'}`);

if (!report.overall || anyFreeze) process.exit(1);
