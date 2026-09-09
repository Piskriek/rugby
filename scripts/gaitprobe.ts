/**
 * GAIT / TURN PROBE — ENGINE INNOVATION PLAN I-2 (WS14), plan §C6 gate.
 *
 * Headless acceptance that a body's rendered facing now obeys a human
 * turn-rate ceiling instead of an exponential snap:
 *   - A slow man (watching the ball, nearly still) must NOT spin fast: he turns
 *     at ~TURN_PIVOT rad/s, and a 180-degree watch is spread over ~0.9 s rather
 *     than snapped in a few frames.
 *   - No single frame may over-rotate the body (bounded per-step cap).
 *   - Turning goes the shortest way round, and wrappedDelta always lies in
 *     (-Math.PI, Math.PI] and reconstructs the target mod 2PI.
 *   - The gait buckets are monotonic in speed and bounded by TURN_CEILING.
 *   - Facing an already-reached target does not jitter or orbit.
 *
 *   npx tsx scripts/gaitprobe.ts
 */
import { TURN_PIVOT, TURN_WALK, TURN_RUN, TURN_SPRINT, TURN_CEILING,
  stepTurn, wrappedDelta, turnRateFor,
  synthesizeGait, gaitEffort, advancePhase, type GaitInput } from '../src/game/gait';

let failures = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const fail = (m: string) => { failures++; console.log(`FAIL: ${m}`); };

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) < tol;

/* ---- 1. Monotonic gait buckets, bounded by the ceiling. */
{
  const samples = [0, 0.3, 0.7, 1.0, 3.0, 3.2, 6.4, 6.5, 9, 12];
  const rates = samples.map(turnRateFor);
  let mono = true;
  for (let i = 1; i < rates.length; i++) if (rates[i] < rates[i - 1]) mono = false;
  if (mono) ok('gait turn-rate is monotonic in speed across all buckets');
  else fail(`rates not monotonic: ${rates.join(', ')}`);
  if (rates.every((r) => r <= TURN_CEILING + 1e-9) && TURN_CEILING === TURN_SPRINT) {
    ok(`every gait rate ≤ TURN_CEILING (${TURN_CEILING})`);
  } else fail('a gait rate exceeds TURN_CEILING');
}

/* ---- 2. A nearly-still watcher rotates at ~TURN_PIVOT over a realistic time,
 *          and no single frame over-rotates. */
{
  const face = 0, target = Math.PI * 0.999; // watch the ball behind you
  let f = face; const dt = 1 / 60;
  let frames = 0, peakDelta = 0;
  while (Math.abs(wrappedDelta(f, target)) > 1e-6 && frames < 60 * 5) {
    const before = f;
    f = stepTurn(f, target, turnRateFor(0.2), dt); // near-still watcher
    const dd = Math.abs(f - before);
    if (dd > peakDelta) peakDelta = dd;
    frames++;
  }
  const elapsed = frames * dt;
  const rate = (Math.PI * 0.999) / elapsed;
  if (rate > TURN_PIVOT + 0.02) fail(`near-still watcher spun at ${rate.toFixed(3)} rad/s (> pivot)`);
  else ok(`near-still watcher turns at ~${rate.toFixed(2)} rad/s ≤ TURN_PIVOT`);
  if (elapsed < 0.5) fail(`180-deg watch done in ${elapsed.toFixed(3)} s (snap)`);
  else ok(`~180-deg watch spread over ${elapsed.toFixed(2)} s (no spin-in-place)`);
  if (peakDelta <= TURN_CEILING * dt + 1e-9)
    ok('no single frame over-rotates the body');
  else fail(`single frame rotated ${peakDelta.toFixed(5)} rad (> cap)`);
  if (Math.abs(wrappedDelta(f, target)) < 1e-6) ok('facing converges onto target');
  else fail(`facing did not converge: delta=${wrappedDelta(f, target).toFixed(5)}`);
}

/* ---- 3. wrappedDelta is shortest-way, in (-PI, PI], and reconstructs target. */
{
  const pairs: [number, number][] = [
    [0.1, 1.2],
    [-2.9, 3.0],          // both near the seam, must go the SHORT way (-0.383)
    [-0.1, 0.2],
    [3.0, -3.0],          // near opposite
    [2.9, -2.6],
  ];
  let allGood = true;
  for (const [f, t] of pairs) {
    const d = wrappedDelta(f, t);
    const outOfRange = d <= -Math.PI || d > Math.PI;
    // reconstruct: f + d should equal t modulo 2*PI
    const recon = Math.atan2(Math.sin(f + d - t), Math.cos(f + d - t));
    if (outOfRange || Math.abs(recon) > 1e-9) { allGood = false; fail(`wrappedDelta(${f},${t})=${d}`); }
  }
  if (allGood) ok('wrappedDelta is shortest-way, in (-PI, PI], reconstructs target');
  // the seam pair must resolve to a small negative (short way), not +5.9
  const seam = wrappedDelta(-2.9, 3.0);
  if (seam > -1 && seam < 0) ok(`seam pair resolves short-way (${seam.toFixed(3)} rad), not the long way`);
  else fail(`seam pair resolved to ${seam.toFixed(3)} (should be a small negative)`);
}

/* ---- 4. A fast sprinter may cut faster than a walker, but stays bounded. */
{
  const sprinter = turnRateFor(9), walker = turnRateFor(1.5);
  if (sprinter === TURN_SPRINT && walker === TURN_WALK && sprinter > walker && walker < sprinter) {
    ok(`sprinter cuts at ${sprinter}, walker at ${walker}, walker < sprinter ≤ ceiling`);
  } else fail(`bucket rates wrong: sprinter=${sprinter} walker=${walker}`);
}

/* ---- 5. Facing an already-reached target does not jitter or orbit. */
{
  let f = 0.7; const dt = 1 / 60;
  for (let i = 0; i < 120; i++) f = stepTurn(f, 0.7, TURN_PIVOT, dt);
  if (near(f, 0.7, 1e-6)) ok('settled facing stays put (no jitter/orbit)');
  else fail(`settled facing drifted to ${f}`);
}

/* ---- 6. CONTINUOUS GAIT CORE (I-2/WS14) ---------------------------------
 * Cadence & stride rise continuously with speed (no 4-bucket seams); stride
 * and cadence are both monotonic and continuous across the walk/jog/run
 * boundaries; effort is 0..1; stride*cadence ≈ speed roughly; a prop-like
 * long-stride man at a fixed speed strides longer at a lower cadence than a
 * scrum-half-like short-stride man; a hard cut adds hip set and lean. */
{
  const base: GaitInput = { spd: 0, turnRate: 0, strideBias: 0, size: 1.0 };
  // monotonicity & continuity of cadence and stride across gait boundaries
  let cadMonotone = true, strMonotone = true;
  let prevC = -1, prevS = -1, prevE = -1;
  const spds = [0.2, 0.5, 1.0, 1.6, 2.6, 3.4, 5.0, 5.6, 7.4, 8.2, 9.6];
  for (const spd of spds) {
    const g = synthesizeGait({ ...base, spd });
    if (g.effort < prevE) { /* effort monotone */ fail('effort dipped'); }
    prevE = g.effort;
    if (g.cadence < prevC) cadMonotone = false;
    if (g.stride < prevS) strMonotone = false;
    prevC = g.cadence; prevS = g.stride;
  }
  if (cadMonotone) ok('cadence rises monotonically with speed (continuous)');
  else fail('cadence is not monotonic in speed');
  if (strMonotone) ok('stride length rises monotonically with speed (continuous)');
  else fail('stride is not monotonic in speed');
  // continuity: no jump across the 5.0 m/s jog boundary
  const a = synthesizeGait({ ...base, spd: 4.99 });
  const b = synthesizeGait({ ...base, spd: 5.01 });
  if (Math.abs(a.cadence - b.cadence) < 0.08 && Math.abs(a.stride - b.stride) < 0.02)
    ok('no cadence/stride seam at the 5.0 m/s jog boundary');
  else fail(`seam at jog boundary: cad ${a.cadence.toFixed(3)}→${b.cadence.toFixed(3)}`);
  // effort in [0,1]
  const full = synthesizeGait({ ...base, spd: 12 });
  if (full.effort > 0.99) ok('effort reaches ~1 at full sprint'); else fail(`effort ${full.effort}`);
  // stride*cadence ≈ speed within a plausibility band
  const mid = synthesizeGait({ ...base, spd: 6.0 });
  const implied = mid.cadence * mid.stride;
  if (Math.abs(implied - 6.0) < 2.2) ok(`stride*cadence ≈ speed (${implied.toFixed(1)} vs 6.0 m/s)`);
  else fail(`stride*cadence ${implied.toFixed(1)} not near 6.0`);
  // personal gait signature: long-stride (bias +1) vs short-stride (bias -1) at same speed
  const long = synthesizeGait({ ...base, spd: 6.0, strideBias: 0.8 });
  const short = synthesizeGait({ ...base, spd: 6.0, strideBias: -0.8 });
  if (long.stride > short.stride && long.cadence < short.cadence)
    ok('long-stride man covers more per step at lower cadence than a short-stride man (prop vs 9)');
  else fail(`long/short: stride ${long.stride.toFixed(3)}/${short.stride.toFixed(3)}, cad ${long.cadence.toFixed(2)}/${short.cadence.toFixed(2)}`);
  // a hard cut adds hip set and lean over a straight sprint at same effort
  const cut = synthesizeGait({ ...base, spd: 8, turnRate: 6 });
  const straight = synthesizeGait({ ...base, spd: 8, turnRate: 0 });
  if (cut.hipSet > straight.hipSet && cut.lean > straight.lean)
    ok('a hard cut opens the hips and adds lean over a straight run');
  else fail(`cut hipSet ${cut.hipSet.toFixed(3)} lean ${cut.lean.toFixed(3)} not > straight`);
  if (Math.abs(cut.hipSet) <= 0.5 && Math.abs(straight.hipSet) < 1e-9)
    ok('hip set stays bounded and a straight run has ~no hip set');
  else fail(`hip set bounds: ${cut.hipSet}, ${straight.hipSet}`);
}

/* ---- 7. Phase advances and stays in [0, 2PI); each 2PI = one gait cycle
 *          (2 steps), so measured cycles/s must equal cadence/2. */
{
  const g = synthesizeGait({ spd: 7, turnRate: 0, strideBias: 0, size: 1 });
  let ph = 0;
  let cycles = 0; const dt = 1 / 60;
  for (let i = 0; i < 60 * 60; i++) { const p0 = ph; ph = advancePhase(ph, g.phaseRate, dt); if (ph < p0) cycles++; }
  if (ph >= 0 && ph < Math.PI * 2 + 1e-9) ok('limb phase stays in [0, 2PI)');
  else fail(`phase out of range ${ph}`);
  const cyclesPerSec = cycles / 60;          // gait cycles per second
  const expectedCyclesPerSec = g.cadence / 2; // cadence steps/s => /2 cycles/s
  if (Math.abs(cyclesPerSec - expectedCyclesPerSec) / expectedCyclesPerSec < 0.05)
    ok(`phase cadence (~${cyclesPerSec.toFixed(2)} cycles/s) = cadence/2 (${expectedCyclesPerSec.toFixed(2)})`);
  else fail(`phase cycles/s ${cyclesPerSec.toFixed(2)} vs expected ${expectedCyclesPerSec.toFixed(2)}`);
}

console.log(failures === 0 ? `\ngaitprobe: PASS (0 failures)` : `\ngaitprobe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
