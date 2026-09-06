/**
 * breakdownbake.ts — simulate the ruck's motion once, offline, ship the curves.
 *
 * `engine/breakdownPlan.ts` samples these numbers instead of computing them. What
 * is in them is not arbitrary: each curve is the output of a real bang-bang run
 * integrated at 1/120 s — accelerate from a standstill, hold the speed that man can
 * actually sustain, then DECELERATE into the bind, because a forward arriving at
 * full sprint cannot put a shoulder into a ruck and stay on his feet. The time
 * where the profile reaches the strike point, the speed he has left there, the
 * impulse that transfers into the man he came for and the ground that man then
 * gives are all measured out of the same integration, so the presentation physics
 * (the ragdoll's friction) and the engine's clearout agree about how far a shove
 * moves a body, because they are the same numbers.
 *
 * Re-run it after changing the limits. It prints the envelope it found, rejects
 * anything non-monotone, and writes the JSON the engine reads.
 *
 *   npx vite-node scripts/breakdownbake.ts [--write]
 */
import fs from 'node:fs';
import path from 'node:path';

/* ---- the physics of the approach ---------------------------------------- */

/** m/s² a packed forward can actually hold from a standstill. */
const ACCEL = 6.2;
/** top speed by role, m/s. A jackal goes in faster than a binder goes in. */
const CRUISE: Record<string, number> = {
  CLEAR: 8.2, BIND: 7.0, JACKAL: 8.6, COUNTER: 7.4, NINE: 6.4, TACKLE: 0, CARRY: 0,
};
/** how much of cruise he still has when he arrives: you arrive weighted, not flat out */
const ARRIVE_KEEP: Record<string, number> = {
  CLEAR: 0.86, BIND: 0.68, JACKAL: 0.92, COUNTER: 0.7, NINE: 0.5, TACKLE: 1, CARRY: 1,
};
/** mass, kg — a 105 kg front-row and a 78 kg back do not clear the same way */
const MASS: Record<string, number> = { CLEAR: 104, BIND: 98, JACKAL: 96, COUNTER: 100, NINE: 84, TACKLE: 100, CARRY: 100 };
/** who is being shoved into: a lighter man gives more ground */
const TARGET_MASS = 98;
/** body-on-body coefficient of restitution for a wrap, not a collision in space */
const E_BODY = 0.34;
/** ground friction — deliberately the SAME number the ragdoll is given (0.55 dry) */
const MU = 0.55;
const G = 9.81;
const H = 1 / 120;
const SAMPLES = 16;
const DIST = [0, 2, 4, 6, 9, 12, 16, 20, 25, 30, 36, 44];
const ROLES = ['CLEAR', 'BIND', 'JACKAL', 'COUNTER', 'NINE', 'TACKLE', 'CARRY'] as const;
/** support density tiers: how many men are in the contest. More men, shorter lanes
 *  (a crowded ruck is entered at a walk, not a sprint) and a harder collective shove. */
const TIERS = ['0', '1', '2'] as const;
const TIER_SPEED = [1, 0.94, 0.86];

interface Curve {
  dur: number; prof: number[]; strike: number; impulse: number; retreat: number; settle: number;
}

/**
 * Integrate one approach. Returns the profile and the contact numbers.
 * `crowd` shortens the final run-in and steals pace, as it does in life.
 */
function simulate(role: string, dist: number, tier: number): Curve {
  const cruise = (CRUISE[role] ?? 7.4) * (TIER_SPEED[tier] ?? 1);
  const keep = ARRIVE_KEEP[role] ?? 0.7;
  const target = cruise * keep;
  if (dist <= 0.01 || cruise <= 0) {
    const prof = new Array(SAMPLES).fill(1);
    prof[0] = 0;
    return { dur: 0.12, prof, strike: 0.5, impulse: 0, retreat: 0, settle: 0.1 };
  }
  let x = 0, v = 0, t = 0;
  const prof: number[] = [];
  const marks: number[] = [];
  let strikeT = -1;
  let vStrike = 0;
  /* When he HITS. A clearout lands while the man is still running at you — that
   * is what makes it a clearout rather than a collision at the end of a journey —
   * so the strike sits at 70% of the lane, not at the destination. A bind is later
   * and softer: he arrives, gets a shoulder in, and drives. */
  const strikeAt = role === 'CLEAR' ? 0.7 : role === 'JACKAL' ? 0.8 : role === 'BIND' ? 0.92 : role === 'COUNTER' ? 0.88 : -1;
  let settleT = -1;
  const total = dist;
  let guard = 0;
  while (x < total && guard++ < 40000) {
    // accelerate toward cruise, brake so the arrival speed is `target`
    const remaining = total - x;
    const brakeDist = (v * v - target * target) / (2 * Math.max(1, ACCEL * 0.9));
    const want = v < (remaining < brakeDist ? target : cruise) ? ACCEL : -ACCEL * 0.9;
    v = Math.max(target * 0.35, Math.min(cruise, v + want * H));
    x += v * H;
    t += H;
    marks.push(x / total);
    if (strikeAt > 0 && strikeT < 0 && x / total >= strikeAt) { strikeT = t; vStrike = v; }
    if (settleT < 0 && v <= target * 1.02 && x / total > 0.94) settleT = t;
  }
  // resample the integrated path onto SAMPLES equal time steps
  for (let i = 0; i < SAMPLES; i++) {
    const want = (i / (SAMPLES - 1)) * t;
    // marks were pushed once per step, so index by time
    const idx = Math.min(marks.length - 1, Math.max(0, Math.round(want / H)));
    prof.push(Math.min(1, marks[idx]));
  }
  prof[0] = 0;
  prof[prof.length - 1] = 1;
  for (let i = 1; i < prof.length; i++) prof[i] = Math.max(prof[i - 1], prof[i]);

  /* The shove. Momentum transferred through a wrap, then the ground's answer. */
  const m = MASS[role] ?? 100;
  const dv = E_BODY * (m / TARGET_MASS) * vStrike;
  const give = (dv * dv) / (2 * MU * G);           // metres the target gives up
  // a man shoved at more than ~2.4 m/s is on his backside, not staggering
  const down = dv > 2.4;
  const impulse = role === 'CLEAR' ? dv
    : role === 'JACKAL' ? dv * 0.9
      : role === 'COUNTER' ? dv * 0.8
        : role === 'BIND' ? dv * 0.55 : 0;
  const retreat = impulse > 0 ? give * (down ? 1.7 : 1) : 0;
  return {
    dur: Math.round(t * 1000) / 1000,
    prof: prof.map((p) => Math.round(p * 1000) / 1000),
    strike: t > 0 && strikeT > 0 ? Math.round((strikeT / t) * 100) / 100 : 0,
    impulse: Math.round(impulse * 100) / 100,
    retreat: Math.round(retreat * 100) / 100,
    settle: Math.round(((settleT > 0 ? t - settleT : 0.22)) * 100) / 100,
  };
}

/**
 * The stumble: a body given Δv on turf, recovering. Integrated, then normalised
 * to the furthest point, so the runtime can drive `retreat` metres through it.
 * It overshoots and comes back — a man who is shoved off a ruck takes two steps
 * and plants, he does not stop dead where he was pushed to.
 */
function simulateStumble(): number[] {
  const dv = 2.6;                            // m/s, the middle of the table
  let v = dv, x = 0, t = 0;
  const pts: number[] = [0];
  let peak = 0;
  while (t < 1.2 && pts.length < SAMPLES * 4) {
    v -= MU * G * H;
    if (v < 0 && t < 0.5) v = 0;
    x += v * H;
    t += H;
    pts.push(x);
    peak = Math.max(peak, x);
  }
  // recovery: he steps back toward the ruck by ~25% of what he gave
  const out: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / (SAMPLES - 1);
    const simIdx = Math.min(pts.length - 1, Math.round(u * (pts.length - 1)));
    const back = u * u * 0.25;
    out.push(clamp01((pts[simIdx] / peak) - back * (pts[simIdx] / peak)));
  }
  out[out.length - 1] = 0.78;
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i - 1] * 0.985, out[i]);
  return out.map((p) => Math.round(p * 1000) / 1000);
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/* ---- build, verify, write ------------------------------------------------ */

const roles: Record<string, Record<string, Curve>> = {};
const lines: string[] = [];
let bad = 0;
for (const role of ROLES) {
  roles[role] = {};
  for (const tier of TIERS) {
    const list = DIST.map((dist) => simulate(role, dist, Number(tier)));
    roles[role][tier] = list;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const mono = c.prof.every((p, j) => j === 0 || p >= c.prof[j - 1] - 1e-6);
      const ends = Math.abs(c.prof[c.prof.length - 1] - 1) < 1e-6;
      const starts = Math.abs(c.prof[0]) < 1e-6;
      const legal = c.dur > 0.05 && c.dur < 9 && c.impulse >= 0 && c.impulse < 6 && c.retreat < 4;
      if (!(mono && ends && starts && legal)) {
        bad++;
        lines.push(`  BAD ${role}/${tier}/${DIST[i]}m  dur=${c.dur} mono=${mono} ends=${ends} imp=${c.impulse}`);
      }
      // the step cap: no per-frame displacement above what the NO TELEPORTS gate allows
      for (let j = 1; j < c.prof.length; j++) {
        const perFrame = ((c.prof[j] - c.prof[j - 1]) * DIST[i]) / (c.dur * (SAMPLES - 1)) / 60;
        if (perFrame > 0.8) { bad++; lines.push(`  BAD ${role}/${tier}/${DIST[i]}m step ${perFrame.toFixed(2)} m/frame at 60 Hz`); }
      }
    }
    const mid = list[Math.min(list.length - 1, 4)];
    lines.push(
      `  ${role.padEnd(7)} tier ${tier}  9 m → ${mid.dur.toFixed(2)} s  strike @${(mid.strike * 100).toFixed(0)}%  `
      + `shove ${mid.impulse.toFixed(2)} m/s  gives ${mid.retreat.toFixed(2)} m  settle ${mid.settle.toFixed(2)} s`,
    );
  }
}
const stumble = simulateStumble();
const file = { version: 2, samples: SAMPLES, distances: DIST, hz: 1 / H, mu: MU, tiers: [...TIERS], roles, stumble };

console.log('\n=== RUCK CHOREOGRAPHY BAKE ===');
console.log(`integrated at ${Math.round(1 / H)} Hz, ${SAMPLES}-sample curves, friction μ=${MU} (the ragdoll's own)`);
for (const l of lines) console.log(l);
const anyBad = bad > 0;
if (anyBad) console.log(`\n${bad} REJECTED row(s) — refusing to write a broken table`);
else console.log(`\nall ${ROLES.length * TIERS.length * DIST.length} curves monotone, bounded and inside the step cap`);

if (!anyBad && process.argv.includes('--write')) {
  const out = path.join(process.cwd(), 'src/game/data/ruckTimings.json');
  fs.writeFileSync(out, JSON.stringify(file));
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} kB)`);
} else if (!anyBad) {
  console.log('dry run — pass --write to emit the table');
}
process.exit(anyBad ? 1 : 0);
