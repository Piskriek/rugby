/**
 * SPEC_11 PROBE — is the formation drawn around the BALL?
 *
 * Usage:  npx vite-node scripts/spec11probe.ts [seconds] [difficulty] [seed]
 *
 * The drift metric alone could not see the SPEC_11 bug: it measured a man
 * against his MARK, and a man sprinting at a mark twenty-five metres from the
 * ball is closing on it perfectly. So this probe measures three things:
 *
 *   MARK ANCHOR   distance from a player's assigned mark to the live ball.
 *                 A formation is a shape drawn around the ball, so this is a
 *                 property of the formation, not of the man chasing it.
 *   LINE DEPTH    the signed depth of a defender's mark:
 *                 `(tz − F.z) · dir ≥ 0` means in FRONT of the ball. A
 *                 negative value is a defender marked behind the attack —
 *                 the drift bug, in one number.
 *   DRIFT         the recalibrated formation metric (P50/P90).
 *
 * Plus the nine regression gates, so a fix that holds the shape by freezing
 * the match does not pass.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { runDeep } from '../src/game/trace';
/* The authoritative gate board is `scripts/gates.ts`; the deep run here is a
 * second, independent match on the same seeded stream. */

const seconds = Number(process.argv[2] ?? 120);
const diff = Number(process.argv[3] ?? 3);
const seed = Number(process.argv[4] ?? 7);

seedRng(seed);

const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))];
};
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/* ---- live sampling over one seeded match ---- */
const cfg = gateConfig(diff);
const d: any = new Director(cfg);
const markAnchor: number[] = [];      // mark → ball
const defDepth: number[] = [];        // signed depth of a defender's mark
const defDepthBad: { team: 'A' | 'B'; num: number; depth: number; job: string }[] = [];     // ...only the violations (< -1.5 m)
const atkMarkAnchor: number[] = [];
const defMarkAnchor: number[] = [];
let warns = 0;
const realWarn = console.warn;
console.warn = (...args: unknown[]) => { if (String(args[0] ?? '').includes('[SPEC_11]')) warns++; else realWarn(...args); };

const worst: { team: string; num: number; dist: number; job: string; phase: string }[] = [];
const farByPhase: Record<string, number> = {};
let farSamples = 0;      // marks further than 25 m from the ball
let frames = 0;
let openFrames = 0;
const guard = Math.ceil(seconds * 60);
for (let i = 0; i < guard; i++) {
  d.update(1 / 60, NO_INPUT, new Set());
  frames++;
  const op = d.op;
  if (!op) continue;
  openFrames++;
  const f = d.focusPoint();
  const dir = d.shape().dir;
  const def = d.defending();
  for (const p of d.live) {
    /* Only players the formation logic actually steers. A bound, grounded or
     * carrying man is owned by placeBound / the carrier integrator, and his
     * `tx/tz` are whatever the last formation pass left there — not a mark
     * anyone is being asked to hold. */
    if (p.bound || p.down || p.carrier) continue;
    if (!Number.isFinite(p.tx) || !Number.isFinite(p.tz)) continue;
    const dist = Math.hypot(p.tx - f.x, p.tz - f.z);
    markAnchor.push(dist);
    if (dist > 25) {
      farSamples++;
      const ph = String(d.phase);
      farByPhase[ph] = (farByPhase[ph] ?? 0) + 1;
    }
    if (dist > 18) worst.push({ team: p.team, num: p.num, dist, job: p.job, phase: String(d.phase) });
    if (p.team === def) {
      defMarkAnchor.push(dist);
      const depth = (p.tz - f.z) * dir;
      defDepth.push(depth);
      if (depth < -1.5) defDepthBad.push({ team: p.team, num: p.num, depth, job: p.job });
    } else {
      atkMarkAnchor.push(dist);
    }
  }
}
console.warn = realWarn;

/* ---- the formation metrics and the gates over the same seed ---- */
const deep = runDeep(gateConfig(diff), seconds);
/* The formation ledger is read off THIS run, so the drift numbers and the
 * mark-anchor numbers describe the same match. */
const formation = d.formationIntegrity;

const f1 = (v: number) => v.toFixed(1).padStart(7);

console.log(`\n=== SPEC_11 PROBE — ${seconds}s, difficulty ${diff}, seed ${seed} ===`);
console.log(`frames ${frames}, open-play frames ${openFrames}, samples ${markAnchor.length}`);
console.log(`\nMARK → BALL DISTANCE (m)   [a formation is a shape around the ball]`);
console.log(`  all players   P50 ${f1(pct(markAnchor, 0.5))}  P90 ${f1(pct(markAnchor, 0.9))}  MAX ${f1(Math.max(...markAnchor))}`);
console.log(`  defence       P50 ${f1(pct(defMarkAnchor, 0.5))}  P90 ${f1(pct(defMarkAnchor, 0.9))}  MAX ${f1(Math.max(...defMarkAnchor))}`);
console.log(`  attack        P50 ${f1(pct(atkMarkAnchor, 0.5))}  P90 ${f1(pct(atkMarkAnchor, 0.9))}  MAX ${f1(Math.max(...atkMarkAnchor))}`);
console.log(`\nDEFENSIVE LINE DEPTH (m)   [(tz − F.z)·dir; ≥ 0 is in front of the ball]`);
console.log(`  mean ${f1(mean(defDepth))}  P10 ${f1(pct(defDepth, 0.1))}  P90 ${f1(pct(defDepth, 0.9))}`);
console.log(`  marked behind the attack (< -1.5 m): ${defDepthBad.length} of ${defDepth.length} samples`
  + ` (${(100 * defDepthBad.length / Math.max(1, defDepth.length)).toFixed(2)}%)`
  + `, worst ${f1(Math.min(...defDepth, 0))} m`);
/* Which jobs own the residual. A beaten man chasing from behind is SUPPOSED
 * to be behind the ball; a line defender is not. The job says which. */
defDepthBad.sort((a, b) => a.depth - b.depth);
for (const b of defDepthBad.slice(0, 5)) {
  console.log(`    ${b.team}${String(b.num).padStart(2)}  ${b.depth.toFixed(1).padStart(6)} m  ${b.job.slice(0, 52)}`);
}
worst.sort((a, b) => b.dist - a.dist);
console.log(`\nWORST MARKS (top 8 by distance from the ball)`);
for (const w of worst.slice(0, 8)) {
  console.log(`  ${w.team}${String(w.num).padStart(2)}  ${w.dist.toFixed(1).padStart(6)} m  [${w.phase.padEnd(9)}]  ${w.job.slice(0, 52)}`);
}
console.log(`  far marks by phase: ${Object.entries(farByPhase).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}`).join('  ') || 'none'}`);
console.log(`  marks further than 25 m from the ball: ${farSamples} of ${markAnchor.length}`
  + ` (${(100 * farSamples / Math.max(1, markAnchor.length)).toFixed(2)}%)`);

console.log(`\nFORMATION METRICS`);
console.log(`  drift P50   A ${f1(formation.formationDriftP50.A)}  B ${f1(formation.formationDriftP50.B)}`);
console.log(`  drift P90   A ${f1(formation.formationDriftP90.A)}  B ${f1(formation.formationDriftP90.B)}`);
console.log(`  mark-anchor P90  ${('formationMarkAnchorP90' in formation)
  ? `A ${f1(formation.formationMarkAnchorP90.A)}  B ${f1(formation.formationMarkAnchorP90.B)}`
  : 'n/a (metric added by SPEC_11)'}`);
console.log(`  offside episodes  A ${formation.offsideEpisodes.A}  B ${formation.offsideEpisodes.B}`);
/* A percentile over an empty sample set reads as 0.0 and flatters the run.
 * Print the n so an empty channel is visible as empty, not as perfect. */
const nSamples = formation.formationSampleCounts as unknown as Record<string, number> | undefined;
if (nSamples) console.log(`  samples        A ${nSamples.A ?? 0}  B ${nSamples.B ?? 0}`);
/* The drift channel is sparse by construction (it only fills when a man is
 * not closing), so its tail matters more than its percentile. A handful of
 * samples at eight metres is a man genuinely left behind; forty samples at
 * two metres is a line running with the play. */
const tail = (arr: number[]) => `max ${f1(Math.max(...arr, 0))}  >5 m ${arr.filter((v) => v > 5).length}`;
const driftRaw = (d as unknown as { formationDriftRaw?: { A: number[]; B: number[] } }).formationDriftRaw;
if (driftRaw) console.log(`  drift tail    A ${tail(driftRaw.A)}   B ${tail(driftRaw.B)}`);
console.log(`\nDEEP RUN (independent match, same seed stream)`);
console.log(`  teleports ${deep.teleportCount}  watchdog trips ${deep.watchdogTrips}  tackles ${deep.tacklesMade}  possession changes ${deep.possessionChanges}`);
console.log(`  SPEC_11 dev clamp warnings during the sampled match: ${warns}`);
