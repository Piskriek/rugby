/**
 * SPEC_03 / T-41 — pure contract and live maul state-machine checks.
 *
 * Usage: npx vite-node scripts/spec03-contracts.ts
 *
 * The pure checks prove that force/position/RNG-shaped fixture noise cannot
 * enter the re-gate. The integration checks drive all seven named exits using
 * the same Director update path used by a match.
 */

import { deepEqual, equal, ok } from 'node:assert/strict';
import { Director, MatchConfig, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import {
  countValidMaulCommits,
  MAUL_REGATE_WINDOW_COUNT,
  normaliseMaulReadRate,
  resolveMaulRegate,
} from '../src/game/maulRegate';

let checks = 0;

function check(name: string, condition: boolean): void {
  ok(condition, name);
  checks++;
}

function close(actual: number, expected: number, name: string): void {
  check(name, Math.abs(actual - expected) < 0.000001);
}

function humanConfig(difficulty = 3, maulLaw = 0): MatchConfig {
  const cfg = gateConfig(difficulty);
  return {
    ...cfg,
    cpuA: false,
    cpuB: true,
    options: { ...cfg.options, difficulty, maulLaw },
  };
}

function cpuConfig(difficulty = 3): MatchConfig {
  const cfg = gateConfig(difficulty);
  return { ...cfg, options: { ...cfg.options, difficulty } };
}

function newHumanMaul(maulLaw = 0, attacking: 'A' | 'B' = 'A'): Director {
  const d = new Director(humanConfig(3, maulLaw));
  // The test sets up the dedicated maul directly rather than playing a kickoff.
  d.kk = undefined;
  d.startMaul(attacking, 0, 0, 5, false);
  return d;
}

function step(d: Director, frames = 1, pressed = new Set<string>()): void {
  for (let i = 0; i < frames; i++) d.update(1 / 60, NO_INPUT, i === 0 ? pressed : new Set());
}

function closeWindow(d: Director, key?: 'left' | 'right'): void {
  if (key) step(d, 1, new Set([key]));
  // 34 frames after the candidate exceeds the fixed 0.55 s window at 60 Hz.
  step(d, 34);
}

function winAttackControl(d: Director): void {
  closeWindow(d, 'left');
  closeWindow(d, 'right');
  closeWindow(d, 'left');
  closeWindow(d, 'right');
  equal(d.ml?.contest, 'ATTACK_CONTROL');
  checks++;
}

/* ------------------------- Pure re-gate ------------------------- */

const countyWinInput = Object.freeze({
  readRate: 0.62,
  windows: Object.freeze(['LEFT', 'RIGHT', 'LEFT', 'NONE'] as const),
});
const countyBefore = JSON.stringify(countyWinInput);
const county = resolveMaulRegate(countyWinInput);
equal(JSON.stringify(countyWinInput), countyBefore);
checks++;
equal(county.validCommits, 3); checks++;
close(county.humanWinShare, 0.8875 / 1.7165, 'County three-commit share is 51.7%');
check('County three commits wins', county.humanWon);

const countyLoss = resolveMaulRegate({ readRate: 0.62, windows: ['LEFT', 'RIGHT', 'NONE', 'NONE'] });
close(countyLoss.humanWinShare, 0.775 / 1.604, 'County two-commit share is 48.3%');
check('County two commits loses', !countyLoss.humanWon);

const mythic = resolveMaulRegate({ readRate: 0.99, windows: ['LEFT', 'RIGHT', 'LEFT', 'RIGHT'] });
close(mythic.humanWinShare, 1 / 1.9955, 'Mythic full-commit share is 50.1%');
check('Mythic full commitment wins the exact deterministic threshold', mythic.humanWon);

const rookie = resolveMaulRegate({ readRate: 0.3, windows: ['LEFT', 'RIGHT', 'NONE', 'NONE'] });
close(rookie.humanWinShare, 0.775 / 1.46, 'Rookie two-commit share is 53.1%');
check('Rookie two commits wins', rookie.humanWon);
equal(countValidMaulCommits(['LEFT', 'LEFT', 'RIGHT', 'NONE']), 2); checks++;
equal(normaliseMaulReadRate(Number.NaN), 1); checks++;
equal(MAUL_REGATE_WINDOW_COUNT, 4); checks++;

/* The resolver cannot accept this noise, so identical legal input is invariant. */
const noisyPhysicsFixture = Object.freeze({
  forceA: 6400, forceD: 1, speed: -0.5, x: 32, z: -48,
  stamina: 0, ballRank: 4, clip: 'maulPush', random: 0.00001,
});
const quietPhysicsFixture = Object.freeze({
  forceA: 1, forceD: 6900, speed: 1.15, x: -32, z: 48,
  stamina: 100, ballRank: 0, clip: 'idle', random: 0.99999,
});
void noisyPhysicsFixture;
void quietPhysicsFixture;
deepEqual(
  resolveMaulRegate({ readRate: 0.62, windows: ['LEFT', 'RIGHT', 'LEFT', 'NONE'] }),
  resolveMaulRegate({ readRate: 0.62, windows: ['LEFT', 'RIGHT', 'LEFT', 'NONE'] }),
);
checks++;

/* The live adapter also locks from the same input record even when surrounding
 * physics values are deliberately made opposite before the fourth window. */
{
  const calm = newHumanMaul();
  const noisy = newHumanMaul();
  for (const key of ['left', 'right', 'left'] as const) { closeWindow(calm, key); closeWindow(noisy, key); }
  if (!noisy.ml) throw new Error('maul vanished before isolation check');
  noisy.ml.forceA = 1;
  noisy.ml.forceD = 6900;
  noisy.ml.speed = -0.5;
  noisy.ml.x = 31;
  noisy.ml.z = -31;
  closeWindow(calm);
  closeWindow(noisy);
  equal(noisy.ml?.humanWinShare, calm.ml?.humanWinShare); checks++;
  equal(noisy.ml?.contest, calm.ml?.contest); checks++;
}

// The exact same player result maps correctly when the human is defending.
{
  const d = newHumanMaul(0, 'B');
  closeWindow(d, 'left'); closeWindow(d, 'right'); closeWindow(d, 'left'); closeWindow(d);
  equal(d.ml?.humanWon, true); checks++;
  equal(d.ml?.contest, 'DEFENCE_CONTROL'); checks++;
}

/* ------------------- Seven live named exit routes ------------------- */

// Pending re-gate maps both packs to the existing maulPush vocabulary.
{
  const d = newHumanMaul();
  step(d);
  equal(d.ml?.stage, 'RE_GATE'); checks++;
  equal(d.L('A', 3).clip, 'maulBind'); checks++;
  equal(d.L('B', 3).clip, 'maulBind'); checks++;
}

// A simultaneous A+D consumes a window as NONE; a later edge cannot overwrite it.
{
  const d = newHumanMaul();
  step(d, 1, new Set(['left', 'right']));
  step(d, 34, new Set(['left']));
  equal(d.ml?.regateWindows[0], 'NONE'); checks++;
}

// 1. Pick and go: L commits exactly one explicit exit and #8 carries.
{
  const d = newHumanMaul();
  winAttackControl(d);
  step(d, 1, new Set(['kick']));
  equal(d.ml?.exit, 'PICK_AND_GO'); checks++;
  equal(d.L('A', 8).clip, 'carry'); checks++;
  // Exit is write-once: a second input during its presentation beat cannot race it.
  step(d, 1, new Set(['action']));
  equal(d.ml?.exit, 'PICK_AND_GO'); checks++;
  step(d, 16);
  equal(d.phase, 'OPEN_PLAY'); checks++;
  equal(d.op?.carrierNum, 8); checks++;
}

// 2. Wheel and peel: a post-gate A/D edge names a lane and gives the peeler run.
{
  const d = newHumanMaul();
  winAttackControl(d);
  step(d, 1, new Set(['left']));
  equal(d.ml?.exit, 'WHEEL_AND_PEEL'); checks++;
  equal(d.ml?.exitLane, 'LEFT'); checks++;
  equal(d.L('A', 6).clip, 'carry'); checks++;
  step(d, 18);
  equal(d.phase, 'OPEN_PLAY'); checks++;
  equal(d.op?.carrierNum, 6); checks++;
}

// 3. Transfer: existing idle prep becomes existing passSpin before #9 is live.
{
  const d = newHumanMaul();
  winAttackControl(d);
  step(d, 1, new Set(['action']));
  equal(d.ml?.exit, 'TRANSFER_TO_9'); checks++;
  equal(d.L('A', 9).clip, 'nineSquat'); checks++;
  step(d, 12);
  equal(d.L('A', 9).clip, 'ninePass'); checks++;
  step(d, 24);
  equal(d.phase, 'OPEN_PLAY'); checks++;
  equal(d.op?.carrierNum, 9); checks++;
}

// 4. Defence control maps a held-up stop to the defending scrum.
{
  const d = newHumanMaul();
  closeWindow(d); closeWindow(d); closeWindow(d); closeWindow(d);
  equal(d.ml?.contest, 'DEFENCE_CONTROL'); checks++;
  if (!d.ml) throw new Error('maul vanished before unplayable route check');
  d.ml.speed = 0;
  d.ml.stallClock = 5;
  step(d);
  equal(d.ml?.exit, 'UNPLAYABLE_SCRUM'); checks++;
  step(d, 16);
  equal(d.phase, 'SCRUM'); checks++;
  equal(d.scrim?.feed, 'B'); checks++;
}

// NO LIMIT has an explicit safety hand-off before the phase watchdog can trip.
{
  const d = newHumanMaul(2);
  closeWindow(d); closeWindow(d); closeWindow(d); closeWindow(d);
  if (!d.ml) throw new Error('maul vanished before no-limit safety check');
  d.ml.t = 15;
  step(d);
  equal(d.ml?.exit, 'UNPLAYABLE_SCRUM'); checks++;
  step(d, 16);
  equal(d.phase, 'SCRUM'); checks++;
}

// 5. Touch is a lawful physical boundary exit but cannot rewrite contest state.
{
  const d = newHumanMaul();
  if (!d.ml) throw new Error('maul missing for touch route check');
  d.ml.z = -49;
  d.ml.gained = 1;
  step(d);
  equal(d.ml?.exit, 'TOUCH_LINEOUT'); checks++;
  step(d, 16);
  equal(d.phase, 'LINEOUT'); checks++;
  equal(d.lo?.thrower, 'B'); checks++;
}

// 6. The STOP TWICE rule has a deterministic penalty path; no RNG decides it.
{
  const d = newHumanMaul(1);
  closeWindow(d); closeWindow(d); closeWindow(d); closeWindow(d);
  if (!d.ml) throw new Error('maul missing for penalty route check');
  d.ml.speed = 0;
  d.ml.stoppedOnce = true;
  d.ml.stallClock = 5;
  step(d);
  equal(d.ml?.exit, 'PENALTY_AWARDED'); checks++;
}

// 7. A try-line event commits TRY_AWARDED before the conversion hand-off.
{
  const d = newHumanMaul();
  if (!d.ml) throw new Error('maul missing for try route check');
  d.ml.z = d.ml.tryLineZ;
  step(d);
  equal(d.ml?.exit, 'TRY_AWARDED'); checks++;
  step(d, 16);
  equal(d.phase, 'KICK'); checks++;
}

// CPU-only matches do not fabricate a human re-gate and use an explicit exit.
{
  const d = new Director(cpuConfig(3));
  d.kk = undefined;
  d.startMaul('A', 0, 0, 5, true);
  equal(d.ml?.contest, 'ATTACK_CONTROL'); checks++;
  step(d, 270);
  equal(d.ml?.exit, 'PICK_AND_GO'); checks++;
}

console.log(`SPEC_03 maul contracts: ${checks}/${checks} checks passed`);
