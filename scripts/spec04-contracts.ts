/**
 * SPEC_04 contracts — distinct set-piece events and deduplicated formation
 * offside writer. Usage: npx vite-node scripts/spec04-contracts.ts
 */

import { Director, NO_INPUT } from '../src/game/director';
import { BENCHMARKS, FORMATION_DRIFT_P90, OFFSIDE_PENALTIES_PER_TEAM } from '../src/game/statsAudit';
import { gateConfig } from '../src/game/gates';

let passed = 0;
let failed = 0;
const check = (name: string, condition: unknown, detail = '') => {
  if (condition) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const fresh = () => new Director(gateConfig(3));
const dt = 1 / 60;

const benchmark = (key: string) => BENCHMARKS.find((item) => item.key === key)!;
check('scrum audit range is exactly 14–20', benchmark('scrums').lo === 14 && benchmark('scrums').hi === 20);
check('lineout audit range is exactly 20–28', benchmark('lineouts').lo === 20 && benchmark('lineouts').hi === 28);
check('offside and formation thresholds are exactly approved', OFFSIDE_PENALTIES_PER_TEAM.lo === 2
  && OFFSIDE_PENALTIES_PER_TEAM.hi === 4 && FORMATION_DRIFT_P90.hi === 2.5);

/* A scrum occurrence is written at award/start, while an against-the-head
 * result contains one winner and one loser without becoming two scrums. */
{
  const d = fresh();
  d.startScrum('A', 0, 0);
  check('scrum start writes one distinct event', d.setPieceEvents.scrums === 1,
    `got ${d.setPieceEvents.scrums}`);
  check('scrum start has no fabricated winner', d.setPieceWins.scrums.A + d.setPieceWins.scrums.B === 0,
    `got ${d.setPieceWins.scrums.A}-${d.setPieceWins.scrums.B}`);
  const s = d.scrim!;
  s.stage = 'BASE'; s.t = 0.31; s.netDrive = -1;
  const random = Math.random;
  try {
    Math.random = () => 0; // force the documented against-the-head branch
    d.update(dt, NO_INPUT, new Set<string>());
  } finally {
    Math.random = random;
  }
  check('against-the-head leaves the occurrence at one', d.setPieceEvents.scrums === 1,
    `events=${d.setPieceEvents.scrums}`);
  check('against-the-head records B as outcome winner', d.setPieceWins.scrums.B === 1 && d.B.stats.scrumsWon === 1,
    `wins=${d.setPieceWins.scrums.A}-${d.setPieceWins.scrums.B}`);
  check('against-the-head preserves A loss without inflating event total', d.A.stats.scrumsLost === 1,
    `lost=${d.A.stats.scrumsLost}`);
}

/* A normal lineout assigns a winner but does not derive its occurrence from it. */
{
  const d = fresh();
  d.startLineout('A', 20, 6);
  const s = d.lo!;
  for (const p of d.live) if (p.team === 'A') p.attrs.PWR = 100;
  for (const p of d.live) if (p.team === 'B') p.attrs.PWR = 0;
  s.stage = 'CATCH'; s.t = 0.41; s.quality = 0.95;
  s.ball = { ...s.ball, x: s.call.targetX, y: 2.0, vy: -1, vx: 0 };
  d.update(dt, NO_INPUT, new Set<string>());
  check('lineout start writes one distinct event', d.setPieceEvents.lineouts === 1,
    `events=${d.setPieceEvents.lineouts}`);
  check('lineout winner uses separate outcome ledger', d.setPieceWins.lineouts.A === 1 && d.A.stats.lineoutsWon === 1,
    `wins=${d.setPieceWins.lineouts.A}-${d.setPieceWins.lineouts.B}`);
}

/* A crooked throw is an outcome on the first attempt and starts a newly awarded
 * rethrow. It must read as two events, not one loss masquerading as a total. */
{
  const d = fresh();
  d.startLineout('A', 20, 6);
  const s = d.lo!;
  s.stage = 'CATCH'; s.t = 0.41; s.quality = 0.1;
  s.ball = { ...s.ball, x: s.call.targetX, y: 2.0, vy: -1, vx: 0 };
  d.update(dt, NO_INPUT, new Set<string>());
  check('not-straight rethrow writes a second distinct lineout event', d.setPieceEvents.lineouts === 2,
    `events=${d.setPieceEvents.lineouts}`);
  check('not-straight is an outcome loss, not an invented winner', d.A.stats.lineoutsLost === 1
    && d.setPieceWins.lineouts.A + d.setPieceWins.lineouts.B === 0,
  `loss=${d.A.stats.lineoutsLost}; wins=${d.setPieceWins.lineouts.A}-${d.setPieceWins.lineouts.B}`);
}

const forceRuckBreach = () => {
  const d = fresh();
  d.startOpen('A', 0, 0, 10);
  d.startBreakdown(7);
  const s = d.bd!;
  s.stage = 'RUCK'; s.ruckFormed = true; s.groundAt = 0;
  const bound = new Set(s.players.filter((q) => q.team === 'B').map((q) => q.num));
  const offender = d.live.find((p) => p.team === 'B' && !bound.has(p.num))!;
  offender.x = 0; offender.z = s.contactZ - 8;
  offender.tx = 0; offender.tz = s.contactZ + 3;
  offender.job = 'HOLD THE DEFENSIVE LINE';
  offender.down = false; offender.carrier = false; offender.beatenT = 0;
  return { d, s };
};

/* The formed-ruck writer is time-based in engine seconds. A sustained breach
 * receives one whistle, rather than one increment for every simulation frame. */
{
  const { d, s } = forceRuckBreach();
  let whistles = 0;
  for (let i = 0; i < 14; i++) {
    if (d.sampleFormedRuckOffside(s, 0.1)) whistles++;
    d.t += 0.1;
  }
  const telemetry = d.formationIntegrity;
  check('formed ruck captures eligible position samples', telemetry.eligiblePositionSamples.B > 0,
    `samples=${telemetry.eligiblePositionSamples.B}`);
  check('formed ruck waits through the fixed reset window', whistles === 1,
    `whistles=${whistles}`);
  check('formed ruck writes one B offside penalty', d.B.stats.offsides === 1 && d.B.stats.penaltiesConceded >= 1,
    `offsides=${d.B.stats.offsides}; penalties=${d.B.stats.penaltiesConceded}`);
  check('formed ruck episode is deduplicated after more frames', telemetry.offsideEpisodes.B === 1,
    `episodes=${telemetry.offsideEpisodes.B}`);
}

/* The same contract holds at the explicit post-ruck defensive-line reset. */
{
  const d = fresh();
  d.startOpen('A', 0, 0, 10);
  d.releaseBeat = { z: 0, dir: 1, until: 10 };
  const offender = d.L('B', 14);
  offender.x = 0; offender.z = -6;
  offender.tx = 0; offender.tz = 3;
  offender.job = 'HOLD THE DEFENSIVE LINE';
  offender.down = false; offender.carrier = false; offender.beatenT = 0;
  let whistles = 0;
  for (let i = 0; i < 14; i++) {
    if (d.sampleDefensiveLineResetOffside(0.1)) whistles++;
    d.t += 0.1;
  }
  const telemetry = d.formationIntegrity;
  check('defensive reset is counted as its own opportunity', telemetry.defensiveLineResetOpportunities === 1,
    `resets=${telemetry.defensiveLineResetOpportunities}`);
  check('defensive reset writes one deduplicated offside', whistles === 1 && d.B.stats.offsides === 1,
    `whistles=${whistles}; offsides=${d.B.stats.offsides}`);
}

/* A brief breach that returns onside before the sustained threshold records
 * recovery in real engine seconds and reports the corresponding display time. */
{
  const d = fresh();
  d.startOpen('A', 0, 0, 10);
  d.releaseBeat = { z: 0, dir: 1, until: 10 };
  const defender = d.L('B', 13);
  defender.x = 0; defender.z = -4;
  defender.tx = 0; defender.tz = 3;
  defender.job = 'HOLD THE DEFENSIVE LINE';
  defender.down = false; defender.carrier = false; defender.beatenT = 0;
  for (let i = 0; i < 10; i++) {
    d.sampleDefensiveLineResetOffside(0.1);
    d.t += 0.1;
  }
  defender.z = 1;
  d.sampleDefensiveLineResetOffside(0.1);
  const telemetry = d.formationIntegrity;
  check('transient reset breach does not become an offside penalty', d.B.stats.offsides === 0,
    `offsides=${d.B.stats.offsides}`);
  check('recovery reports engine and display-clock units without rate scaling', telemetry.recoveryEpisodes.B === 1
    && Math.abs(telemetry.recoveryClockP90.B - telemetry.recoveryEngineP90.B * d.clockScale) < 1e-9,
  `episodes=${telemetry.recoveryEpisodes.B}; engine=${telemetry.recoveryEngineP90.B}; clock=${telemetry.recoveryClockP90.B}`);
}

console.log(`\nSPEC_04 contracts: ${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
