/**
 * tarcsverify — prove the TARCS debug HUD reports the truth.
 *
 * A debug panel is a measuring instrument, and an instrument that lies is
 * worse than none: it sends you hunting a bug that is not there. This project
 * has already lost rounds to exactly that (probes that reported faults which
 * did not exist), so the HUD's arithmetic is tested like any other unit.
 *
 * The checks below are grouped by the failure each one actually prevents,
 * not by the function it happens to call.
 *
 *   npx vite-node scripts/tarcsverify.ts
 */
import {
  FRAME_BUDGET_MS, RED_AXIS, RESOLVE_AXIS, RollingTimer,
  bar, bodyMetrics, fmt, physicsMetrics, ruckMetrics, signedBar,
  type BodySource, type RuckSource,
} from '../src/ui/tarcsMetrics';
import { readFileSync } from 'node:fs';

let ok = true;
const check = (name: string, pass: boolean, detail: string): void => {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(50)} ${detail}`);
};

console.log('tarcsverify — the debug HUD must not lie\n');

/* ------------------------------------------------------- 1. the sampler */

{
  const t = new RollingTimer(4);
  [1, 2, 3, 4].forEach((v) => t.push(v));
  check('rolling mean is correct', Math.abs(t.mean - 2.5) < 1e-9, `${t.mean}`);
  check('rolling peak is correct', t.peak === 4, `${t.peak}`);

  /* The ring must actually forget: a debug tool that keeps every frame of a
   * match is the performance problem it was added to find. */
  [10, 10, 10, 10].forEach((v) => t.push(v));
  check('the window discards old samples', t.mean === 10, `mean ${t.mean} after refill`);
  check('the window is bounded', t.samples === 4, `${t.samples} samples retained`);
}

{
  /* One NaN must not poison the readout forever. */
  const t = new RollingTimer(8);
  t.push(5);
  t.push(NaN);
  t.push(Number.POSITIVE_INFINITY);
  t.push(-3);
  t.push(7);
  check('the sampler rejects NaN and nonsense',
    t.samples === 2 && Math.abs(t.mean - 6) < 1e-9, `${t.samples} kept, mean ${t.mean}`);
}

/* ------------------------------------------------------- 2. physics panel */

{
  /* The very first frame has an empty window. 1000/0 would print "Infinity". */
  const empty = physicsMetrics(new RollingTimer(8), new RollingTimer(8));
  check('no divide-by-zero on the first frame',
    Number.isFinite(empty.fps) && Number.isFinite(empty.tickMs),
    `fps ${empty.fps}, tick ${empty.tickMs}`);

  const sim = new RollingTimer(8), frame = new RollingTimer(8);
  for (let i = 0; i < 8; i++) { sim.push(4); frame.push(16.7); }
  const m = physicsMetrics(sim, frame);
  check('fps is derived from the frame, not the sim step',
    Math.abs(m.fps - 59.88) < 0.1, `${m.fps.toFixed(2)} fps from 16.7 ms frames`);
  check('budget is the share of one 60 Hz frame',
    Math.abs(m.budget - 4 / FRAME_BUDGET_MS) < 1e-6,
    `${(m.budget * 100).toFixed(1)}% of ${FRAME_BUDGET_MS.toFixed(2)} ms`);
}

/* ---------------------------------------------------------- 3. the ruck */

const ruck = (over: Partial<RuckSource> = {}): RuckSource => ({
  stage: 'RUCK', axis: 0, axisVel: 0, redT: 0, contestT: 1,
  jackalActive: false, crew: [1, 2, 3], defCrew: [4, 5],
  attacking: 'A', ...over,
});

{
  check('no ruck reports null, not zeros', ruckMetrics(null) === null, 'null in, null out');
  check('undefined is also safe', ruckMetrics(undefined) === null, 'undefined in, null out');
}

{
  const m = ruckMetrics(ruck())!;
  check('support density counts both crews',
    m.supportAtk === 3 && m.supportDef === 2 && Math.abs(m.density - 0.6) < 1e-9,
    `${m.supportAtk}a v ${m.supportDef}d = ${(m.density * 100).toFixed(0)}% attack`);
}

{
  /* An empty ruck must read as parity. 0/0 rendering as "0% attack" would
   * imply the defence owns a breakdown nobody has arrived at. */
  const m = ruckMetrics(ruck({ crew: [], defCrew: [] }))!;
  check('an empty ruck reads as parity, not 0%',
    m.density === 0.5, `${(m.density * 100).toFixed(0)}%`);
}

{
  /* Jackals are counted from the roster so a DOUBLE jackal is visible — the
   * boolean flag alone would show "1" and hide the thing you opened the HUD
   * to see. */
  const two = ruckMetrics(ruck({
    jackalActive: true,
    players: [
      { team: 'B', role: 'JACKAL' }, { team: 'B', role: 'JACKAL' },
      { team: 'A', role: 'CLEANER' },
    ],
  }))!;
  check('a double jackal is visible', two.jackals === 2, `${two.jackals} counted`);

  /* A jackal already put on the floor is not contesting. */
  const down = ruckMetrics(ruck({
    jackalActive: true,
    players: [{ team: 'B', role: 'JACKAL', down: true }],
  }))!;
  check('a downed jackal is not counted', down.jackals === 0, `${down.jackals} counted`);

  /* ...but with no roster rows at all, fall back to the flag rather than
   * silently reporting zero contest while one is live. */
  const flagOnly = ruckMetrics(ruck({ jackalActive: true }))!;
  check('falls back to the live flag when no roster',
    flagOnly.jackals === 1, `${flagOnly.jackals} from the flag`);
}

{
  /* The verdict must match the engine's own thresholds. */
  const t = (axis: number) => ruckMetrics(ruck({ axis }))!.verdict;
  check('verdict: attack ball', t(0.6) === 'ATTACK BALL', t(0.6));
  check('verdict: contested', t(0.0) === 'CONTESTED', t(0.0));
  check('verdict: defence over it', t(-0.6) === 'DEFENCE OVER IT', t(-0.6));
  check('verdict: turnover at the resolve axis',
    t(-RESOLVE_AXIS) === 'TURNOVER', `${t(-RESOLVE_AXIS)} at ${-RESOLVE_AXIS}`);
  check('the red line is where redT starts',
    t(RED_AXIS - 0.01) === 'DEFENCE OVER IT', `${RED_AXIS} threshold honoured`);
}

{
  /* THE ONE THAT MATTERS MOST: the HUD mirrors two engine constants rather
   * than importing the engine into a React bundle. Mirrored constants drift.
   * Assert against the engine source so drift is caught here, not by someone
   * misreading a live panel during a bug hunt. */
  const src = readFileSync('src/game/engine/breakdown.ts', 'utf8');
  const resolve = /axis\s*(?:<=|>=|>|<)\s*-?0\.75|0\.75/.test(src);
  check('RESOLVE_AXIS still matches the engine', resolve && RESOLVE_AXIS === 0.75,
    `HUD ${RESOLVE_AXIS}, engine mentions 0.75: ${resolve}`);
  const red = /-0\.5/.test(src);
  check('RED_AXIS still matches the engine', red && RED_AXIS === -0.5,
    `HUD ${RED_AXIS}, engine mentions -0.5: ${red}`);
}

/* --------------------------------------------------------- 4. the bodies */

const body = (over: Partial<BodySource> = {}): BodySource => ({
  team: 'A', num: 10, vx: 0, vz: 0, stamina: 100, ...over,
});

{
  const m = bodyMetrics([], null, null);
  check('an empty pitch does not divide by zero',
    m.count === 0 && m.meanSpeed === 0 && m.focus === null, 'all zero, focus null');
}

{
  const live = [
    body({ num: 1, vx: 3, vz: 4 }),                 // 5 m/s
    body({ num: 2, vx: 0, vz: 9, ragdoll: true }),  // 9 m/s, ragdolled
    body({ num: 3, vx: 0, vz: 1 }),                 // 1 m/s
  ];
  const m = bodyMetrics(live, null, null);
  check('speed is the magnitude of the velocity',
    Math.abs(m.peakSpeed - 9) < 1e-9, `peak ${m.peakSpeed}`);
  check('mean speed is correct', Math.abs(m.meanSpeed - 5) < 1e-9, `${m.meanSpeed} m/s`);
  check('ragdoll and kinematic bodies are split',
    m.ragdollCount === 1 && m.kinematicCount === 2,
    `${m.ragdollCount} active, ${m.kinematicCount} kinematic`);
  check('the split always sums to the roster',
    m.ragdollCount + m.kinematicCount === m.count, `${m.count} total`);
}

{
  /* The focus must resolve by team AND number: both sides field a 10, and a
   * HUD that tracks the wrong one is the worst kind of wrong — plausible. */
  const live = [
    body({ team: 'A', num: 10, vx: 0, vz: 2 }),
    body({ team: 'B', num: 10, vx: 0, vz: 8, ragdoll: true }),
  ];
  const a = bodyMetrics(live, 10, 'A')!.focus!;
  const b = bodyMetrics(live, 10, 'B')!.focus!;
  check('focus disambiguates the two number 10s',
    a.label === 'A10' && b.label === 'B10' && a.speed === 2 && b.speed === 8,
    `${a.label}@${a.speed} vs ${b.label}@${b.speed}`);
  check('focus reports the locomotive mode',
    a.mode === 'KINEMATIC' && b.mode === 'ACTIVE', `${a.mode} / ${b.mode}`);
}

{
  /* A focus number that has left the field must not crash the panel. */
  const m = bodyMetrics([body({ num: 7 })], 99, 'A');
  check('a missing focus player is handled', m.focus === null, 'focus null');
}

/* ------------------------------------------------------- 5. formatting */

{
  check('fmt pads to a fixed width', fmt(9.9, 2, 6) === '  9.90', `"${fmt(9.9, 2, 6)}"`);
  check('fmt survives NaN', fmt(NaN, 2, 6) === '  0.00', `"${fmt(NaN, 2, 6)}"`);

  /* Fixed width is what stops the panel reflowing as digits change. */
  check('a widening value does not shift the column',
    fmt(9.9, 2, 6).length === fmt(10.0, 2, 6).length, 'both 6 chars');

  check('bar is clamped at both ends',
    bar(-5, 10) === '·'.repeat(10) && bar(5, 10) === '█'.repeat(10), 'clamped 0..1');
  check('bar survives NaN', bar(NaN, 10).length === 10, `"${bar(NaN, 10)}"`);
}

{
  /* The signed meter must put defence pressure LEFT and attack RIGHT, or the
   * panel visually contradicts the sign convention it is reporting. */
  const neg = signedBar(-1, 15);
  const pos = signedBar(1, 15);
  const mid = signedBar(0, 15);
  check('signedBar grows left for the defence',
    neg.indexOf('█') === 0 && neg[7] === '│', `"${neg}"`);
  check('signedBar grows right for the attack',
    pos.lastIndexOf('█') === 14 && pos[7] === '│', `"${pos}"`);
  check('signedBar marks the centre at rest',
    mid === '·······│·······', `"${mid}"`);
  check('signedBar is a constant width',
    neg.length === 15 && pos.length === 15 && mid.length === 15, 'all 15 cells');
}

/* ------------------------------------------------ 6. the overlay contract */

{
  /* The requirements are explicit about the overlay never eating input, and
   * that is not something a unit test of the maths can cover — so assert it
   * against the component source. A regression here silently breaks pointer
   * lock, which is very hard to attribute back to a debug panel. */
  const src = readFileSync('src/ui/TARCSHud.tsx', 'utf8');
  check('the overlay is click-through', /pointer-events-none/.test(src),
    'pointer-events-none present on the root');
  check('the overlay is absolutely positioned', /\babsolute\b/.test(src), 'absolute');
  check('the overlay sits at z-50', /\bz-50\b/.test(src), 'z-50');
  check('the overlay contains no arithmetic of its own',
    !/Math\.(hypot|abs|min|max)\(/.test(src),
    'all maths delegated to tarcsMetrics');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
