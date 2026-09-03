/**
 * SPEC_05 / T-68 — SEEDED TELEPORT COMPLIANCE HARNESS.
 *
 * Reproducible per-frame displacement audit for the NO-TELEPORT family. It
 * seeds the ambient RNG (the same seam audit-cli / gates use), runs a headless
 * CPU-v-CPU match, and grades the worst single-frame player displacement against
 * the SPEC_05 tighten-vs-accept list:
 *
 *   > 1.40 m  HARD FAIL      — a real teleport (two systems wrote him at once).
 *   > 1.15 m  MANDATORY TIGHTEN — the remaining legit snaps must be brought under.
 *   0.90-1.15 m  PROVENANCE REQUIRED — a legitimate placement/ease, documented.
 *   < 0.90 m  ACCEPT — ordinary movement.
 *
 * Exits non-zero on a HARD FAIL or a MANDATORY TIGHTEN, so the harness can gate
 * the build.
 *
 * Usage: npx vite-node scripts/spec05probe.ts [seconds] [difficulty] [seed]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 90);
const diff = Number(process.argv[3] ?? 3);
const seed = Number(process.argv[4] ?? 1);

seedRng(seed);

const HARD_FAIL = 1.40;
const TIGHTEN = 1.15;
const PROVENANCE = 0.90;

const d = new Director(gateConfig(diff));
const dt = 1 / 60;
const prev = new Map<string, { x: number; z: number }>();
let maxDisp = 0;
let maxInfo = '';
let hardFail = 0;
let tighten = 0;
let provenance: string[] = [];

function fmt(v: number) { return v.toFixed(3); }

for (let i = 0; i < seconds * 60; i++) {
  for (const p of d.live) prev.set(`${p.team}${p.num}`, { x: p.x, z: p.z });
  const phaseBefore = d.phase;
  const bdBefore = d.bd ? { stage: d.bd.stage, contactZ: d.bd.contactZ } : null;
  d.update(dt, NO_INPUT, new Set());

  for (const p of d.live) {
    const was = prev.get(`${p.team}${p.num}`);
    if (!was) continue;
    const disp = Math.hypot(p.x - was.x, p.z - was.z);
    const ctx = `t=${d.t.toFixed(3)} sh${p.num}(${p.team}) ${fmt(disp)}m phase ${phaseBefore}->${d.phase} bd-stage=${bdBefore?.stage ?? '-'} v=(${p.vx.toFixed(2)},${p.vz.toFixed(2)}) z:${was.z.toFixed(2)}->${p.z.toFixed(2)}`;
    if (disp > maxDisp) { maxDisp = disp; maxInfo = ctx; }
    if (disp > HARD_FAIL) { hardFail++; if (hardFail <= 20) provenance.push(`HARD ${ctx}`); }
    else if (disp > TIGHTEN) { tighten++; if (tighten <= 20) provenance.push(`TIGHTEN ${ctx}`); }
    else if (disp > PROVENANCE && provenance.length < 40) provenance.push(`PROVENANCE ${ctx}`);
  }
}

const ok = hardFail === 0 && tighten === 0;
console.log(`\n=== SPEC_05 SEEDED TELEPORT HARNESS — ${seconds}s diff ${diff} seed ${seed} ===`);
console.log(`maxDisp = ${fmt(maxDisp)}m`);
console.log(`MAX: ${maxInfo}`);
console.log(`HARD FAIL >${HARD_FAIL}m: ${hardFail}   MANDATORY TIGHTEN >${TIGHTEN}m: ${tighten}`);
console.log(`\n${ok ? 'PASS' : 'FAIL'} — teleports comply with the tighten-vs-accept list`);
if (provenance.length) {
  console.log(`\nframe-by-frame provenance (${provenance.length} shown):`);
  for (const l of provenance) console.log(`  ${l}`);
}
console.log(`\nwatchdog ${d.watchdogTrips}  tackles ${d.A.stats.tackles + d.B.stats.tackles}  score ${d.A.score}-${d.B.score}`);
process.exit(ok ? 0 : 1);
