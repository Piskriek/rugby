/**
 * DETERMINISM PROBE — Phase 0 substrate for the flagship.
 *
 * The self-play trainer (A-1), the Reality Envelope referee (A-2) and the
 * learned role-density priors (A-7) all assume the headless simulator is
 * deterministic: same seed/config + same inputs => the SAME match, so a change
 * to behaviour can be evaluated in isolation and regressions are reproducible.
 *
 * This probe LOCKS that in as a regression gate. For two fresh Director
 * instances built identically and stepped with identical inputs, the full
 * state fingerprint (phase, ball, and every live player's position/speed) must
 * be bit-identical across both runs, over multiple exercised scenario paths
 * (open play; a generic match tick from the whistle).
 *
 * If this starts failing, something non-deterministic (an unseeded RNG, a
 * wall-clock read, a shared-mutable leak) has crept into the sim — which would
 * silently poison every self-play roll.
 *
 *   npx tsx scripts/determinismprobe.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';

let failures = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const fail = (m: string) => { failures++; console.log(`FAIL: ${m}`); };

/** Compact, stable fingerprint of a Director's full visible state. */
function fingerprint(d: Director): string {
  const parts: string[] = [];
  parts.push(`phase=${d.phase}`);
  const b = d.ball;
  if (b) parts.push(`ball=${b.x.toFixed(4)},${b.y.toFixed(4)},${b.z.toFixed(4)},${b.state}`);
  if (d.op) parts.push(`op=${d.op.attacking}:${d.op.dir}:car=${d.op.carrierNum}`);
  const players = d.live.map((p) => `${p.team}:${p.num}@${p.x.toFixed(3)},${p.z.toFixed(3)}:${p.clip}`).sort();
  parts.push(`players=${players.join(';')}`);
  return parts.join('|');
}

/** Run a scenario builder twice and assert the fingerprints match at samples. */
function assertDeterministic(name: string, frames: number, build: (i: number) => Director): void {
  const a = build(1);
  const b = build(2);
  const samples: number[] = [Math.floor(frames / 3), Math.floor((2 * frames) / 3), frames - 1];
  let allMatch = true;
  let at = 0;
  for (let f = 0; f < frames; f++) {
    a.update(1 / 60, NO_INPUT, new Set(), new Set());
    b.update(1 / 60, NO_INPUT, new Set(), new Set());
    if (f === samples[at]) {
      const fa = fingerprint(a), fb = fingerprint(b);
      if (fa !== fb) { allMatch = false; fail(`${name}: diverge at frame ${f}`); break; }
      at++;
    }
  }
  if (allMatch && at >= samples.length) ok(`${name}: bit-identical over ${frames} frames (${samples.length} samples)`);
  else if (allMatch) fail(`${name}: did not reach all samples`);
}

/* ---- 1. Open play: A attack from a scrum-half feed. ---- */
assertDeterministic('open-play', 500, () => {
  const d = new Director(quickStartConfig({ controlTeam: 'A', controlNum: 15 }));
  d.startOpen('A', 0, -20, 9);
  return d;
});

/* ---- 2. Generic match tick from the kick-off whistle. ---- */
assertDeterministic('kick-off tick', 240, () =>
  new Director(quickStartConfig({ controlTeam: 'A', controlNum: 10 })));

console.log(failures === 0 ? `\ndeterminismprobe: PASS (0 failures)` : `\ndeterminismprobe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
