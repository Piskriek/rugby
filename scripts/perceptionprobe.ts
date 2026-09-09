/**
 * PERCEPTION PROBE — A-3 "attention, not cones" / WS21 keystone.
 *
 * Headless acceptance for the ONE reaction-latency table:
 *   - Looking straight at a target is the fast 100-250 ms band.
 *   - A target far off the gaze is the realistic 300-600 ms "not looking"
 *     delay — this is what makes defence SHAPED BUT NOT CHASING as a
 *     consequence, not a hack.
 *   - Latency is monotonic non-decreasing in gaze offset (no non-human spikes
 *     of fast reaction to things you are not looking at).
 *   - It is deterministic (reproducible) so it survives the sim's determinism.
 *   - gazeOffset treats "no gaze published" as not-looking (the far band).
 *
 *   npx tsx scripts/perceptionprobe.ts
 */
import { reactionLatency, gazeOffset, gazeReaction,
  LOOK_AT_REACTION, NOT_LOOKING_REACTION } from '../src/game/perception';

let failures = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const fail = (m: string) => { failures++; console.log(`FAIL: ${m}`); };

/* ---- 1. The two human bands ---- */
{
  const on = reactionLatency(0);
  const far = reactionLatency(30);
  if (on >= 0.10 && on <= 0.25) ok(`looking straight at it -> ${(on * 1000).toFixed(0)} ms (fast band)`);
  else fail(`on-target latency ${on} outside fast band`);
  if (far >= 0.30 && far <= 0.65) ok(`not looking -> ${(far * 1000).toFixed(0)} ms (300-600 not-looking band)`);
  else fail(`not-looking latency ${far} outside delay band`);
  if (Math.abs(LOOK_AT_REACTION - 0.12) < 1e-9) ok('LOOK_AT_REACTION=0.12s exported');
  if (Math.abs(NOT_LOOKING_REACTION - 0.60) < 1e-9) ok('NOT_LOOKING_REACTION=0.60s exported');
}

/* ---- 2. Monotonic non-decreasing ---- */
{
  const offs = [0, 0.3, 0.5, 1, 2, 3.5, 5, 7, 9, 12, 40];
  let mono = true;
  for (let i = 1; i < offs.length; i++) if (reactionLatency(offs[i]) < reactionLatency(offs[i - 1]) - 1e-12) mono = false;
  if (mono) ok('latency is monotonic non-decreasing in gaze offset');
  else fail('latency is not monotonic');
  // plateaued: beyond FULL_OFF it does not keep growing unboundedly
  const p1 = reactionLatency(10), p2 = reactionLatency(60);
  if (Math.abs(p2 - p1) < 1e-9) ok('latency saturates at the not-looking ceiling');
  else fail(`latency does not saturate: ${p1} vs ${p2}`);
}

/* ---- 3. Deterministic & reproducible ---- */
{
  let same = true;
  for (let i = 0; i < 200; i++) {
    const d = Math.random() * 20;
    if (reactionLatency(d) !== reactionLatency(d)) same = false;
  }
  if (same) ok('reactionLatency is deterministic (pure function)');
  else fail('reactionLatency is not deterministic');
}

/* ---- 4. gazeOffset / gazeReaction wiring ---- */
{
  // gazing right at the loose ball at (10,5) -> fast
  const fast = gazeReaction(10, 5, 10, 5);
  if (fast <= 0.25) ok('gaze on the ball -> fast reaction');
  else fail(`gaze-on-ball reaction ${fast}`);
  // gazing at your own mark far from a loose ball at (10,5) -> delayed
  const slow = gazeReaction(60, 40, 10, 5);
  if (slow >= 0.30) ok('gazing elsewhere -> delayed reaction (shaped but not chasing)');
  else fail(`gazing-elsewhere reaction ${slow}`);
  // no gaze published -> treated as not looking (far band)
  const none = gazeReaction(undefined, undefined, 10, 5);
  if (none >= 0.30) ok('no gaze published -> not-looking delay');
  else fail(`no-gaze reaction ${none}`);
  if (gazeOffset(undefined, undefined, 1, 1) >= 8) ok('gazeOffset no-gaze returns the far offset');
  else fail('gazeOffset no-gaze not far');
}

console.log(failures === 0 ? `\nperceptionprobe: PASS (0 failures)` : `\nperceptionprobe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
