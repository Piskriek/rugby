/**
 * breakdownverify — regression gates for the breakdown.
 *
 * Every check here corresponds to a fault that was actually measured and
 * fixed (see scripts/breakdownaudit for the descriptive version). They exist
 * because all of these bugs were SILENT: the code ran, the match played, no
 * error was ever thrown, and the breakdown simply did not do what 644 lines
 * of careful comments said it did.
 *
 * The thresholds are bands, not points — the simulation is stochastic and a
 * gate that demands an exact number is a gate that fails on Tuesday.
 */
import { Director } from '../src/game/director';
import type { BreakdownState } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { botInput } from '../src/game/trace';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${detail}`);
}

const SECONDS = 90;
const SEEDS = [1, 2, 3, 7, 11];

let count = 0, turnovers = 0, penalties = 0, cleared = 0, useIt = 0;
let minAxis = 9, maxAxis = -9;
let maxDrift = 0, driftSum = 0, driftN = 0;
let offPitch = 0, slotN = 0;
const outT: number[] = [];
const crewA: number[] = [];
const crewB: number[] = [];

for (const seed of SEEDS) {
  seedRng(seed);
  const d = new Director(gateConfig(3));
  const st = { wait: 0.3, flip: 0, presses: 0, releases: 0 };
  const dt = 1 / 60;
  let last: BreakdownState | undefined;
  let startedAt = 0;

  for (let i = 0; i < SECONDS * 60; i++) {
    const { inp, pressed } = botInput(d, dt, st);
    d.update(dt, inp, pressed);
    const bd = d.bd;
    if (bd && !last) {
      count++; startedAt = d.t;
      crewA.push(bd.crew.length); crewB.push(bd.defCrew.length);
      for (const q of bd.players) { slotN++; if (Math.abs(q.x) > 34.5) offPitch++; }
    }
    if (bd) {
      minAxis = Math.min(minAxis, bd.axis);
      maxAxis = Math.max(maxAxis, bd.axis);
      if (bd.ball.placed) {
        const dr = Math.hypot(bd.ball.x - bd.contactX, bd.ball.z - bd.contactZ);
        maxDrift = Math.max(maxDrift, dr); driftSum += dr; driftN++;
      }
    }
    if (!bd && last) {
      const why = last.resultWhy || '';
      outT.push(d.t - startedAt);
      if (/JACKAL WON/.test(why)) turnovers++;
      else if (/BALL WON/.test(why)) cleared++;
      else if (/USE IT/.test(why)) useIt++;
      if (/NOT RELEASING|ROLLING AWAY|HANDS IN/.test(why)) penalties++;
    }
    last = bd;
  }
}

const pct = (n: number): number => (100 * n) / count;
const mean = (a: number[]): number => a.reduce((p, c) => p + c, 0) / Math.max(1, a.length);

console.log(`\n=== BREAKDOWN VERIFY — ${count} breakdowns over ${SEEDS.length} seeds ===\n`);

/* 1. THE STEAL MUST BE REACHABLE.
 * The original gate was `defCrew.length > crew.length`, a strict majority.
 * Both sides always arrived with exactly 3, so it never once opened: the
 * measured turnover rate was 0.0% across 75 breakdowns while a jackal was
 * present at 100% of them. The jackal was decorative. */
check('turnovers happen at all', turnovers > 0, `${turnovers} jackal steals`);

/* 2. ...BUT AT A HONEST RATE.
 * The first fix overcorrected to 45.7%. Real professional rugby turns the
 * ball over at roughly 3-6% of breakdowns. */
check('turnover rate is realistic', pct(turnovers) >= 1.5 && pct(turnovers) <= 9,
  `${pct(turnovers).toFixed(1)}% (want 1.5-9%)`);

/* 3. PENALTIES IN BAND.
 * Making the axis reachable also made the per-frame not-releasing roll fire
 * far more often than it was tuned for — it went to ~15% against a real rate
 * near 7-8%. */
check('penalty rate is realistic', pct(penalties) >= 2 && pct(penalties) <= 13,
  `${pct(penalties).toFixed(1)}% (want 2-13%)`);

/* 4. THE ATTACK STILL USUALLY WINS ITS OWN BALL. */
check('attack usually retains', pct(cleared) >= 60,
  `${pct(cleared).toFixed(1)}% cleared out`);

/* 5. THE AXIS MUST REACH BOTH WIN CONDITIONS.
 * Measured -0.45 at its lowest against a -0.75 steal threshold: the defence
 * could not reach its own win condition because the attack recovered at 24.0
 * against the defence's 3.6. This is the check that would have caught it. */
/* Compared with an epsilon: the steal clamps the axis to exactly -0.75, and
 * a bare <= on a float that has been through clamp() is a coin toss. */
check('axis can reach the defensive win', minAxis <= -0.7499,
  `low ${minAxis.toFixed(3)} (needs <= -0.75)`);
check('axis can reach the attacking win', maxAxis >= 0.75,
  `high ${maxAxis.toFixed(2)} (needs >= +0.75)`);

/* 6. THE BALL MOVES WITH THE CONTEST.
 * Drift was measured at exactly 0.00 m, mean and max: the ball was pinned to
 * the contact point for the whole ruck, so a dominant shove and a ruck going
 * backwards presented the ball in identical positions. */
check('ball drifts with the contest', driftN > 0 && mean([driftSum / Math.max(1, driftN)]) > 0.05,
  `mean ${(driftSum / Math.max(1, driftN)).toFixed(2)} m`);
check('but the ruck is not a maul', maxDrift < 2.0, `max ${maxDrift.toFixed(2)} m`);

/* 7. RUCK SLOTS ARE ON THE PITCH.
 * The slot offsets fan out to cx-2.3 and were never clamped, so a ruck near
 * a touchline authored positions outside the field; steer() then snapped
 * those men back to +-34.5 in one frame the moment open play resumed. That
 * was 2 NO-TELEPORTS failures at 0.89 m and 0.86 m. */
check('no ruck slot is off the pitch', offPitch === 0, `${offPitch}/${slotN} slots outside +-34.5`);

/* 8. BOTH SIDES VARY THEIR COMMITMENT.
 * Zero variance on either side is what made the steal unreachable. */
const varies = (a: number[]): boolean => Math.max(...a) > Math.min(...a);
check('defensive commitment varies', varies(crewB),
  `${Math.min(...crewB)}-${Math.max(...crewB)} men (mean ${mean(crewB).toFixed(2)})`);

/* 9. THE BREAKDOWN RESOLVES PROMPTLY. A ruck that never ends is a freeze. */
check('breakdowns resolve promptly', mean(outT) < 3.0 && Math.max(...outT) < 8,
  `mean ${mean(outT).toFixed(2)}s, worst ${Math.max(...outT).toFixed(2)}s`);

/* 10. EVERY BREAKDOWN ENDS.
 * One breakdown per seed can legitimately still be open when the sample
 * window closes, so the allowance is one per seed rather than one overall. */
check('no breakdown stalls forever', outT.length >= count - SEEDS.length,
  `${outT.length}/${count} resolved (up to ${SEEDS.length} may still be live at cutoff)`);

console.log(`\n  outcomes: ${pct(cleared).toFixed(0)}% cleared, ${pct(turnovers).toFixed(0)}% turnover, ` +
  `${pct(penalties).toFixed(0)}% penalty, ${pct(useIt).toFixed(0)}% use-it`);
console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
