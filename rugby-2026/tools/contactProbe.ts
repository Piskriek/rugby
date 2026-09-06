/**
 * CONTACTPROBE — prove the new "hands-like-magnets" contact core
 * (src/physics/contact.ts):
 *   1. WRAP/contest duels are deterministic: same inputs + dice → same verdict;
 *   2. outcome distributions sit in sane rugby windows across the dice range;
 *   3. arrival times are positive, monotone in distance and speed;
 *   4. 2-bone IK actually puts the wrist on the target — validated by an
 *      INDEPENDENT axis-angle application (not the solver's own forward pass);
 *   5. reach/grasp helper behaves at near/far.
 * Run: npx vite-node tools/contactProbe.ts
 */
import {
  resolveWrapDuel, resolveContest, arrivalT, solveArmIK, graspOf, hashU,
} from '../src/physics/contact';
import type { Tech } from '../src/physics/contact';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(` ok  ${label} ${extra}`); }
  else { fail++; console.log(`FAIL ${label} ${extra}`); }
};

/* ------------------------------------------------------------ rotation ---- */
/** Independent axis-angle rotation (Rodrigues) — the reference the solver's
 *  output must reproduce when applied to real vectors. */
function rot(v: { x: number; y: number; z: number }, ax: { x: number; y: number; z: number }, ang: number) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const d = ax.x * v.x + ax.y * v.y + ax.z * v.z;
  const cx = ax.y * v.z - ax.z * v.y, cy = ax.z * v.x - ax.x * v.z, cz = ax.x * v.y - ax.y * v.x;
  return {
    x: v.x * c + cx * s + ax.x * d * (1 - c),
    y: v.y * c + cy * s + ax.y * d * (1 - c),
    z: v.z * c + cz * s + ax.z * d * (1 - c),
  };
}

/* ----------------------------------------------------------------- IK ---- */
const L1 = 0.34, L2 = 0.30;                       // upper + forearm (m)
function makeArm() {
  const S = { x: 0.18, y: 1.42, z: 0.05 };
  const E = { x: 0.18, y: 1.42 - L1, z: 0.05 };
  const W = { x: 0.18, y: 1.42 - L1 - L2, z: 0.05 };
  return { S, E, W };
}
function applyIk(S: { x: number; y: number; z: number }, E: { x: number; y: number; z: number },
  W: { x: number; y: number; z: number }, ik: ReturnType<typeof solveArmIK>) {
  const u1 = { x: E.x - S.x, y: E.y - S.y, z: E.z - S.z };
  const f1 = { x: W.x - E.x, y: W.y - E.y, z: W.z - E.z };
  const u2 = rot(u1, ik.shoulderAxis, ik.shoulderAngle);        // upper arm
  const E2 = { x: S.x + u2.x, y: S.y + u2.y, z: S.z + u2.z };
  const f1c = rot(f1, ik.shoulderAxis, ik.shoulderAngle);       // forearm carried by the shoulder
  const f2 = rot(f1c, ik.elbowAxis, ik.elbowAngle);             // then flexed at the elbow
  const W2 = { x: E2.x + f2.x, y: E2.y + f2.y, z: E2.z + f2.z };
  return { E2, W2 };
}
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

console.log('== IK endpoint accuracy (independent Rodrigues check) ==');
let ikBest = Infinity, ikWorst = 0, ikMean = 0, ikN = 0, ikMiss = 0;
const targets = [
  { x: 0.2, y: 1.05, z: 0.1 },    // reach out front low (jackal hand to ball)
  { x: 0.3, y: 1.1, z: 0.25 },    // out and forward
  { x: -0.05, y: 1.0, z: 0.0 },   // across the body
  { x: 0.0, y: 0.85, z: 0.12 },   // deep low (ground ball)
  { x: 0.45, y: 1.3, z: 0.1 },    // far high
  { x: -0.3, y: 1.25, z: -0.1 },  // opposite side high
  { x: 0.18, y: 1.5, z: 0.4 },    // straight up-ish
];
for (let s = 0; s < 60; s++) {
  const seed = 1000 + s * 7;
  const { S, E, W } = makeArm();
  const tx = hashU(seed) * 1.1 - 0.4;
  const ty = 0.85 + hashU(seed + 1) * 0.7;
  const tz = hashU(seed + 2) * 0.8 - 0.3;
  const ik = solveArmIK(S, E, W, { x: tx, y: ty, z: tz }, s % 2 === 0 ? 1 : -1);
  const { W2 } = applyIk(S, E, W, ik);
  const err = dist(W2, { x: tx, y: ty, z: tz });
  // the solver reports its own clamped wrist; the real proof is W2 vs target
  const shellErr = dist(W2, ik.wrist);
  // a hand magnet slides to the reach shell for out-of-range balls — that is
  // by design, so only genuinely reachable targets must hit precisely
  const slide = !ik.reachable;
  if (err > 0.06 && !slide) ikMiss++;
  if (!slide) { ikBest = Math.min(ikBest, err); ikWorst = Math.max(ikWorst, err); ikMean += err; ikN++; }
  if (err > 0.02 && !slide) console.log(`  note ik err ${err.toFixed(4)} @ (${tx.toFixed(2)},${ty.toFixed(2)},${tz.toFixed(2)}) reachable=${ik.reachable}`);
  ok(`ik seed ${s} wrist-on-target`, slide ? true : err <= 0.03, slide ? '(out of shell — slides)' : `err ${err.toFixed(4)} m`);
  ok(`ik self-consistent (W2≈ik.wrist)`, shellErr < (slide ? 0.05 : 1e-9), slide ? `(slide Δ ${shellErr.toExponential(1)})` : `Δ ${shellErr.toExponential(2)}`);
}
for (const T of targets) {
  const { S, E, W } = makeArm();
  const ik = solveArmIK(S, E, W, T, 1);
  const { W2 } = applyIk(S, E, W, ik);
  const err = dist(W2, T);
  if (!ik.reachable) continue;      // out-of-shell: slides by design
  ikMean += err; ikN++;
  ok(`ik target (${T.x},${T.y},${T.z})`, err <= 0.03, `err ${err.toFixed(4)} m reachable=${ik.reachable}`);
}
console.log(`IK summary  best ${ikBest.toFixed(4)}  mean ${(ikMean / ikN).toFixed(4)}  worst ${ikWorst.toFixed(4)}  misses(>6cm) ${ikMiss}`);

/* ------------------------------------------------------------ duels ------ */
console.log('== duel determinism ==');
const C: Tech = { pwr: 78, skl: 82, spd: 85, ttl: 74 };
const D: Tech = { pwr: 85, skl: 70, spd: 80, ttl: 88 };
const clumsy: Tech = { pwr: 60, skl: 40, spd: 70, ttl: 65 };
const elite: Tech = { pwr: 92, skl: 96, spd: 88, ttl: 90 };
{
  const a = resolveWrapDuel({ carrier: C, tackler: D, support: 1, cover: 1, momentum: 0.6, smother: false }, 0.413);
  const b = resolveWrapDuel({ carrier: C, tackler: D, support: 1, cover: 1, momentum: 0.6, smother: false }, 0.413);
  ok('wrap same dice → same verdict', a.outcome === b.outcome && a.u === b.u, `→ ${a.outcome}`);
  const r = resolveContest({ jackal: D, cleaner: C, jackalSupport: 0, cleanerSupport: 1, jackalLead: 0.35, presentation: 0.6, momentum: 0.5 }, 0.22);
  const r2 = resolveContest({ jackal: D, cleaner: C, jackalSupport: 0, cleanerSupport: 1, jackalLead: 0.35, presentation: 0.6, momentum: 0.5 }, 0.22);
  ok('contest same dice → same verdict', r.outcome === r2.outcome, `→ ${r.outcome}`);
}

console.log('== wrap-duel distribution over the full dice range ==');
{
  const tally: Record<string, number> = {};
  for (let i = 0; i < 40_000; i++) {
    const u = (i + 0.5) / 40_000;
    const o = resolveWrapDuel({ carrier: C, tackler: D, support: 1, cover: 1, momentum: 0.6, smother: false }, u).outcome;
    tally[o] = (tally[o] ?? 0) + 1;
  }
  const pct = (k: string) => (((tally[k] ?? 0) / 40_000) * 100).toFixed(1) + '%';
  console.log('  KEEP', pct('KEEP'), '· RIP', pct('RIP'), '· KNOCK', pct('KNOCK'), '· HOLDUP', pct('HOLDUP'));
  ok('KEEP dominant (≈84-99%)', tally.KEEP / 400 >= 84 && tally.KEEP / 400 <= 99);
  ok('RIP rare (≈0.2-9%)', tally.RIP / 400 >= 0.2 && tally.RIP / 400 <= 9);
  ok('KNOCK rare (<5%)', tally.KNOCK / 400 < 5);
  ok('HOLDUP rare (<5%)', tally.HOLDUP / 400 < 5);
  ok('no outcome lost', ['KEEP', 'RIP', 'KNOCK', 'HOLDUP'].every((k) => tally[k] > 0));
  // a high-skill tackler vs a clumsy carrier rips more often
  let ripE = 0;
  for (let i = 0; i < 20_000; i++) {
    const u = (i + 0.5) / 20_000;
    if (resolveWrapDuel({ carrier: clumsy, tackler: elite, support: 0, cover: 0, momentum: 0.3, smother: false }, u).outcome === 'RIP') ripE++;
  }
  ok('elite tackler rips clumsy carrier more', ripE / 200 >= 8 && ripE / 200 <= 22, `→ ${(ripE / 200).toFixed(1)}%`);
}

console.log('== contest distribution ==');
{
  const tally: Record<string, number> = {};
  for (let i = 0; i < 40_000; i++) {
    const u = (i + 0.5) / 40_000;
    const o = resolveContest({ jackal: D, cleaner: C, jackalSupport: 0, cleanerSupport: 1, jackalLead: 0.25, presentation: 0.7, momentum: 0.6 }, u).outcome;
    tally[o] = (tally[o] ?? 0) + 1;
  }
  const pct = (k: string) => (((tally[k] ?? 0) / 40_000) * 100).toFixed(1) + '%';
  console.log('  (attack cleaner vs lone defender) CLEAN', pct('CLEAN'), '· SLOW', pct('SLOW'),
    '· STEAL', pct('STEAL'), '· PEN', pct('PEN_ATK'), '/', pct('PEN_DEF'));
  ok('clean/slow dominate with numbers', (tally.CLEAN + tally.SLOW) / 400 >= 60);
  ok('steal possible but minority', tally.STEAL / 400 >= 2 && tally.STEAL / 400 <= 40);
  ok('penalties rare (<8% each)', tally.PEN_ATK / 400 < 8 && tally.PEN_DEF / 400 < 8);
  // settled elite jackal vs a slow weak clean should steal often
  let stealSettled = 0;
  for (let i = 0; i < 20_000; i++) {
    const u = (i + 0.5) / 20_000;
    const o = resolveContest({ jackal: elite, cleaner: clumsy, jackalSupport: 0, cleanerSupport: 0, jackalLead: 1.1, presentation: 0.35, momentum: 0.2 }, u).outcome;
    if (o === 'STEAL') stealSettled++;
  }
  ok('settled elite jackal beats weak slow clean', stealSettled / 200 >= 25, `→ ${(stealSettled / 200).toFixed(0)}%`);
}

/* ----------------------------------------------------------- arrivals ---- */
console.log('== arrival physics ==');
{
  ok('approach is faster from closer', arrivalT(4, 80) < arrivalT(12, 80));
  ok('fast man beats slow man', arrivalT(8, 95) < arrivalT(8, 60));
  ok('times sane', arrivalT(2, 60) > 0.3 && arrivalT(16, 99) < 3.5);
  // jackal head start: defender at 5 m, cleaner at 9 m → defender should win
  const lead = arrivalT(9, 82) - arrivalT(5, 84);
  ok('race gives a real head start', lead > 0.3, `lead ${lead.toFixed(2)} s`);
}

/* ------------------------------------------------------- magnet/grasp ----- */
console.log('== magnet grasp ==');
{
  ok('far hand not magnetised', graspOf(1.2, 0.8) === 0);
  ok('near hand clamps', graspOf(0.3, 0.8) === 1);
  ok('middle eases in', graspOf(0.5, 0.8) > 0 && graspOf(0.5, 0.8) < 1, `g ${graspOf(0.5, 0.8).toFixed(3)}`);
}

console.log(`\nCONTACT PROBE: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
