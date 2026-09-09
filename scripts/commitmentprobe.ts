/**
 * COMMITMENT PROBE — A-5 "reading commits" / M-4 telegraph (plan C6 gate).
 *
 * Headless acceptance for the commitment discipline on the Actor `commit`
 * field:
 *   - While a defender is still deciding (below the lock) he CAN abort: stop
 *     committing and his doubt decays back toward 0.
 *   - Once he crosses COMMIT_LOCK he is committed: commit may only rise (to 1)
 *     and may NEVER fall until the action resolves — a committed defender
 *     cannot abort a tackle mid-commit.
 *   - A fresh decision reaches the lock in a realistic ~150 ms telegraph
 *     window (timeToLock ~ COMMIT_LOCK/COMMIT_RISE).
 *   - Deterministic.
 *
 *   npx tsx scripts/commitmentprobe.ts
 */
import { stepCommit, canAbort, timeToLock, COMMIT_LOCK, COMMIT_RISE_TIME } from '../src/game/commitment';

let failures = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const fail = (m: string) => { failures++; console.log(`FAIL: ${m}`); };
const dt = 1 / 60;

/* ---- 1. Before the lock, a man can abort. ---- */
{
  // wind up briefly but stay below the lock (the readable pre-commit window)
  let c = 0;
  for (let i = 0; i < 5; i++) c = stepCommit(c, true, dt);
  if (c < COMMIT_LOCK) ok(`ramped to ${c.toFixed(2)} (< lock ${COMMIT_LOCK}) while deciding`);
  else fail(`already locked after short ramp (${c.toFixed(2)})`);
  if (canAbort(c)) {
    // he changes his mind: doubt decays back toward 0
    for (let i = 0; i < 90; i++) c = stepCommit(c, false, dt);
    if (c <= 0.02) ok('below lock he can abort — commit decays back to ~0');
    else fail(`abort did not decay: ${c.toFixed(3)}`);
  } else fail('expected canAbort true below lock');
}

/* ---- 2. Once committed (>= lock), no mid-commit abort. ---- */
{
  let c = 0;
  // push him decisively past the lock
  while (c < COMMIT_LOCK) c = stepCommit(c, true, dt);
  if (!canAbort(c)) ok(`once commit reaches ${c.toFixed(2)} (>= lock) he may not abort`);
  else fail('canAbort true past the lock');
  // even if he stops pushing, commitment must never fall below the lock
  let dropped = false;
  let dippedBelow = false;
  for (let i = 0; i < 180; i++) {
    const before = c;
    c = stepCommit(c, false, dt);
    if (c < before - 1e-12) dropped = true;
    if (c < COMMIT_LOCK - 1e-9) dippedBelow = true;
  }
  if (dippedBelow) fail('committed man dropped below the lock');
  else if (!dropped) ok('committed man holds (never falls) — no mid-commit abort');
  else fail('committed man commit fell');
}

/* ---- 3. Acting rises monotonically to 1. ---- */
{
  let c = 0;
  let monotone = true;
  for (let i = 0; i < 60; i++) { const p = c; c = stepCommit(c, true, dt); if (c < p - 1e-12) monotone = false; }
  if (monotone && c >= 1 - 1e-6) ok('acting commitment rises monotonically to 1.0');
  else fail(`monotone=${monotone} final=${c.toFixed(3)}`);
}

/* ---- 4. Realistic telegraph window. ---- */
{
  const t = timeToLock();
  if (t >= 0.10 && t <= 0.30) ok(`time to lock ~${(t * 1000).toFixed(0)} ms (150-300 ms readable wind-up)`);
  else fail(`timeToLock ${t.toFixed(3)}s outside readable window`);
  // and full commitment in ~COMMIT_RISE_TIME
  let c = 0; let n = 0;
  while (c < 1 - 1e-6 && n < 120) { c = stepCommit(c, true, dt); n++; }
  const full = n * dt;
  if (Math.abs(full - COMMIT_RISE_TIME) < 0.05) ok(`full commitment in ~${COMMIT_RISE_TIME}s (${full.toFixed(3)})`);
  else fail(`full commitment took ${full.toFixed(3)}s, expected ~${COMMIT_RISE_TIME}`);
}

/* ---- 5. Deterministic. ---- */
{
  if (stepCommit(0.2, true, dt) === stepCommit(0.2, true, dt)) ok('stepCommit is deterministic (pure function)');
  else fail('stepCommit not deterministic');
}

console.log(failures === 0 ? `\ncommitmentprobe: PASS (0 failures)` : `\ncommitmentprobe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
