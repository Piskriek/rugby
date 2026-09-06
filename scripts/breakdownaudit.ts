/**
 * breakdownaudit — measure what actually happens at the breakdown.
 *
 * The tackle is the most frequent event in a rugby match and the one with the
 * most moving parts: the hit, the fall, the placement, the clear-out, the
 * jackal, and the ball coming away. Reading 644 lines of breakdown.ts tells
 * you what it INTENDS. This runs real matches and reports what it DOES.
 *
 * Everything here is descriptive, not pass/fail — the point is to find the
 * numbers that are wrong before deciding what to change. Thresholds come
 * later, in breakdownverify, once we know what "right" looks like.
 */
import { Director } from '../src/game/director';
import type { BreakdownState } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { botInput } from '../src/game/trace';

const SECONDS = Number(process.argv[2] ?? 120);
const SEEDS = [1, 2, 3, 7, 11];

interface Rec {
  stageT: Record<string, number>;   // seconds spent in each stage
  total: number;                    // total breakdown seconds
  count: number;                    // breakdowns started
  outcomes: Record<string, number>;
  ballOut: number[];                // time from contact to ball out
  hitKind: Record<string, number>;
  crewA: number[];                  // attackers committed
  crewB: number[];                  // defenders committed
  jackal: number;                   // breakdowns with a jackal
  turnover: number;
  penalty: number;
  /** distance the ball travelled from the contact point before emerging */
  drift: number[];
  /** how long the carrier lies on the ground after the ball is gone */
  slowRelease: number[];
  /** defenders minus attackers at the ruck — the steal gate reads this */
  numDiff: number[];
  minAxis: number; maxAxis: number; axisReachedSteal: boolean;
  perBdMinAxis: number[];
}

function blank(): Rec {
  return {
    stageT: {}, total: 0, count: 0, outcomes: {}, ballOut: [], hitKind: {},
    crewA: [], crewB: [], jackal: 0, turnover: 0, penalty: 0, drift: [],
    slowRelease: [], numDiff: [], minAxis: 9, maxAxis: -9, axisReachedSteal: false, perBdMinAxis: [],
  };
}

function run(seed: number, diff: number, rec: Rec): void {
  seedRng(seed);
  const d = new Director(gateConfig(diff));
  const st = { wait: 0.3, flip: 0, presses: 0, releases: 0 };
  const dt = 1 / 60;
  let lastBd: BreakdownState | undefined;
  let startedAt = 0;
  let seenStages = new Set<string>();
  let curMin = 9;

  for (let i = 0; i < SECONDS * 60; i++) {
    const { inp, pressed } = botInput(d, dt, st);
    d.update(dt, inp, pressed);
    const bd = d.bd;

    if (bd && !lastBd) {
      // a breakdown just began
      rec.count++;
      startedAt = d.t;
      seenStages = new Set();
      curMin = 9;
      rec.hitKind[bd.hitKind] = (rec.hitKind[bd.hitKind] ?? 0) + 1;
      rec.crewA.push(bd.crew.length);
      rec.crewB.push(bd.defCrew.length);
      rec.numDiff.push(bd.defCrew.length - bd.crew.length);
      if (bd.jackalActive) rec.jackal++;
    }
    if (bd) {
      rec.minAxis = Math.min(rec.minAxis, bd.axis);
      rec.maxAxis = Math.max(rec.maxAxis, bd.axis);
      if (bd.axis <= -0.75) rec.axisReachedSteal = true;
      curMin = Math.min(curMin, bd.axis);
      rec.total += dt;
      rec.stageT[bd.stage] = (rec.stageT[bd.stage] ?? 0) + dt;
      seenStages.add(bd.stage);
    }
    if (!bd && lastBd) {
      // it just ended — record how it resolved
      /* NOTE: BreakdownState.result is a DEAD FIELD — declared, initialised
       * to '' and never written by breakdown.ts. resultWhy is what actually
       * carries the outcome, so classify off that. */
      const why = lastBd.resultWhy || '';
      const res = /BALL WON/.test(why) ? 'ball won (cleared out)'
        : /JACKAL WON/.test(why) ? 'jackal turnover'
        : /USE IT/.test(why) ? 'use it (stalemate)'
        : /NOT RELEASING/.test(why) ? 'penalty: not releasing'
        : /ROLLING AWAY|HANDS IN/.test(why) ? 'penalty: jackal held on'
        : why ? why.slice(0, 26) : '(no reason recorded)';
      rec.outcomes[res] = (rec.outcomes[res] ?? 0) + 1;
      rec.ballOut.push(d.t - startedAt);
      rec.perBdMinAxis.push(curMin);
      const dx = lastBd.ball.x - lastBd.contactX;
      const dz = lastBd.ball.z - lastBd.contactZ;
      rec.drift.push(Math.hypot(dx, dz));
      if (/JACKAL WON/.test(why)) rec.turnover++;
      if (/NOT RELEASING|ROLLING AWAY|HANDS IN/.test(why)) rec.penalty++;
    }
    lastBd = bd;
  }
}

const stat = (a: number[]): string => {
  if (!a.length) return 'n/a';
  const s = [...a].sort((x, y) => x - y);
  const mean = a.reduce((p, c) => p + c, 0) / a.length;
  return `mean ${mean.toFixed(2)}  med ${s[s.length >> 1].toFixed(2)}  ` +
    `min ${s[0].toFixed(2)}  max ${s[s.length - 1].toFixed(2)}`;
};

console.log(`\n=== BREAKDOWN AUDIT — ${SECONDS}s x ${SEEDS.length} seeds, difficulty 3 ===\n`);
const rec = blank();
for (const s of SEEDS) run(s, 3, rec);

const mins = (rec.count / (SECONDS * SEEDS.length / 60)).toFixed(1);
console.log(`breakdowns            ${rec.count}  (${mins} per minute of play)`);
console.log(`time in breakdown     ${(100 * rec.total / (SECONDS * SEEDS.length)).toFixed(1)}% of the match`);
console.log(`\n-- how long, contact to ball out (seconds) --`);
console.log(`  ${stat(rec.ballOut)}`);
console.log(`\n-- time spent per stage (seconds, all breakdowns) --`);
const stages = Object.entries(rec.stageT).sort((a, b) => b[1] - a[1]);
for (const [k, v] of stages) {
  console.log(`  ${k.padEnd(10)} ${v.toFixed(1)}s  ${(100 * v / rec.total).toFixed(0).padStart(3)}%  ` +
    `${(v / rec.count).toFixed(2)}s each`);
}
console.log(`\n-- how the ball came out --`);
const outs = Object.entries(rec.outcomes).sort((a, b) => b[1] - a[1]);
for (const [k, v] of outs) {
  console.log(`  ${k.padEnd(28)} ${String(v).padStart(4)}  ${(100 * v / rec.count).toFixed(1)}%`);
}
console.log(`\n-- contest --`);
console.log(`  turnovers                  ${rec.turnover}  (${(100 * rec.turnover / rec.count).toFixed(1)}%)`);
console.log(`  penalties                  ${rec.penalty}  (${(100 * rec.penalty / rec.count).toFixed(1)}%)`);
console.log(`  jackal present             ${rec.jackal}  (${(100 * rec.jackal / rec.count).toFixed(1)}%)`);
console.log(`\n-- who commits --`);
console.log(`  attackers  ${stat(rec.crewA)}`);
console.log(`  defenders  ${stat(rec.crewB)}`);
console.log(`  numbers (def - atk)  ${stat(rec.numDiff)}`);
const outnumbered = rec.numDiff.filter((n) => n > 0).length;
console.log(`  defence outnumbers attack in ${outnumbered}/${rec.numDiff.length}` +
  ` breakdowns — the steal gate REQUIRES this`);
console.log(`\n-- the contest axis (steal needs <= -0.75, clear needs >= +0.75) --`);
console.log(`  range seen           ${rec.minAxis.toFixed(2)} .. ${rec.maxAxis.toFixed(2)}`);
console.log(`  per-breakdown low    ${stat(rec.perBdMinAxis)}`);
console.log(`  ever reached -0.75   ${rec.axisReachedSteal}`);
console.log(`\n-- hit kind --`);
for (const [k, v] of Object.entries(rec.hitKind)) {
  console.log(`  ${k.padEnd(10)} ${v}  (${(100 * v / rec.count).toFixed(1)}%)`);
}
console.log(`\n-- ball drift from contact point (metres) --`);
console.log(`  ${stat(rec.drift)}`);
console.log('');
