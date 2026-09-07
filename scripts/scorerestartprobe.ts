/**
 * SCORE & RESTART PROBE — SPEC_07 scoring integrity, goal-kick geometry and
 * the Law-12 restart ritual.
 *
 *   npx tsx scripts/scorerestartprobe.ts
 *
 * (a) TRY GROUNDING ×10 — ten engine-driven groundings: an attacking
 *     ball-carrier is set on the turf inside the opponent's in-goal and the
 *     REAL open-play update loop detects the grounding. Each must award
 *     exactly +5, lock the exact (x_try, z_try) coordinate, freeze phase
 *     play through the hardened releaseAll() funnel (0 leaked joints, 0
 *     bound bodies, 0 drag links), place the conversion tee on the line
 *     x = x_try at 20–30 m from the goal line, and reject a same-frame
 *     duplicate trigger.
 * (b) GOAL KICKING ×10 — five conversions and five penalty goals, all
 *     struck through the 5.6 m upright span ABOVE the 3.0 m crossbar, with
 *     the measured upright and crossbar clearances logged per kick and the
 *     score arithmetic verified exactly (+2 conversion, +3 penalty). Two
 *     negative controls — wide of the upright, and under the crossbar —
 *     must miss with the score untouched.
 * (c) RESTART RITUAL ×10 — ten post-score Law-12 restarts: both 15-player
 *     squads re-aligned on their correct sides of halfway (kickers behind
 *     the ball, receivers behind the ten), the strike gated until the ten
 *     is cleared, the drop-kick measured across the 10 m line, and a clean
 *     transition back into open play with zero watchdog trips. One
 *     deliberate short kick must draw the centre-scrum infringement call.
 *
 * Every metric is logged. Exit code 0 when everything passes.
 */
import { Director, quickStartConfig, NO_INPUT } from '../src/game/director';
import { seedRng } from '../src/game/seed';
import { POINTS } from '../src/game/data';
import { FIELD } from '../src/render/retro';
import {
  GOAL_CROSSBAR_M, GOAL_UPRIGHT_HALF_SPAN_M,
  inGoalBounds,
} from '../src/game/engine/laws';
import {
  countLiveJoints, countBoundBodies, countDragLinks,
  assertNoLatchLeaks, beginLatch,
} from '../src/game/engine/latch';

const dt = 1 / 60;
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`FAIL: ${msg}`); };
const pass = (msg: string) => console.log(`  ok   ${msg}`);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const step = (d: Director, n: number) => {
  for (let i = 0; i < n; i++) d.update(dt, NO_INPUT, new Set());
};
const goalFor = (dir: 1 | -1) => (dir > 0 ? FIELD.tryZFar : FIELD.tryZ);

/* ============================ (a) TRY GROUNDING ×10 ============================ */
console.log('(a) TRY GROUNDING ×10 — in-goal detection, exact capture, teardown funnel');
{
  seedRng(7001);
  const depths: number[] = [];
  const teeBacks: number[] = [];
  let jointsAfter = 0;
  for (let i = 0; i < 10; i++) {
    const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
    const atk: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
    const dir: 1 | -1 = atk === 'A' ? 1 : -1;
    const goal = goalFor(dir);
    const xT = ((i % 5) - 2) * 9;           // -18 … 18 — inside touch-in-goal
    const depth = 1 + (i % 6) * 1.5;        // 1 … 8.5 m deep in-goal
    const zT = goal + dir * depth;
    d.startOpen(atk, xT, zT);
    const car = d.L(atk, d.op!.carrierNum);
    // the grounding spot, exact; zero velocities so the first frame detects
    // the ball pressed down exactly where it lies
    car.x = xT; car.z = zT; car.vx = 0; car.vz = 0;
    d.op!.carrierX = xT; d.op!.carrierZ = zT; d.op!.vx = 0; d.op!.vz = 0;
    // a real tackler on the shoulder — the grounding must beat the contact world
    const tack = d.L(atk === 'A' ? 'B' : 'A', 7);
    tack.x = xT + 0.4; tack.z = zT - dir * 0.2;
    // every other trial plants a live drag link, so the teardown funnel has
    // real joints to purge at the grounding frame
    if (i % 2 === 0) beginLatch(d.op!, car, d.L(atk === 'A' ? 'B' : 'A', 1), false, d.live);
    const before = d.teams[atk].score;
    const blocksBefore = d.tryGuardBlocks;
    d.update(dt, NO_INPUT, new Set());      // the engine detects the grounding

    const tag = `trial ${i}: ${atk} grounds at (${xT}, ${zT.toFixed(1)})`;
    if (d.teams[atk].score !== before + POINTS.TRY) fail(`${tag} — score ${d.teams[atk].score}, expected +${POINTS.TRY}`);
    if (!d.trySpot || d.trySpot.team !== atk) fail(`${tag} — trySpot not locked to ${atk}`);
    else {
      if (!near(d.trySpot.x, xT)) fail(`${tag} — x_try ${d.trySpot.x}, expected ${xT}`);
      if (!near(d.trySpot.z, zT)) fail(`${tag} — z_try ${d.trySpot.z}, expected ${zT}`);
      if (!inGoalBounds(dir, d.trySpot.x, d.trySpot.z)) fail(`${tag} — locked spot is outside the in-goal bounds`);
    }
    if (d.tryLock === null) fail(`${tag} — the idempotence lock did not engage`);
    if (d.phase !== 'KICK' || !d.kk || d.kk.type !== 'GOAL') fail(`${tag} — phase ${d.phase}/${d.kk?.type ?? '-'}, expected the conversion ritual`);
    if (d.kk) {
      if (!near(d.kk.bx, xT)) fail(`${tag} — tee x ${d.kk.bx}, must sit on the line x = x_try (${xT})`);
      const back = Math.abs(goal - d.kk.bz);
      teeBacks.push(back);
      if (back < 20 || back > 30) fail(`${tag} — tee ${back.toFixed(1)} m from the goal line, outside the 20–30 m band`);
    }
    // 0 leaked joints through the hardened releaseAll() funnel
    const audit = assertNoLatchLeaks(d.latches, d.live, d.op ?? null, `try${i}`);
    jointsAfter += audit.leakedJoints + audit.unreleasedBound + audit.dragLinks;
    if (countLiveJoints(d.latches) !== 0 || countBoundBodies(d.latches) !== 0 || countDragLinks(d.live, d.op ?? null) !== 0) {
      fail(`${tag} — teardown leaked joints=${countLiveJoints(d.latches)} bound=${countBoundBodies(d.latches)} drag=${countDragLinks(d.live, d.op ?? null)}`);
    }
    // the duplicate-trigger guard: a same-play second grounding changes nothing
    d.scoreTry();
    if (d.teams[atk].score !== before + POINTS.TRY) fail(`${tag} — duplicate trigger re-scored`);
    if (d.tryGuardBlocks !== blocksBefore + 1) fail(`${tag} — duplicate trigger not blocked/counted`);
    depths.push(depth);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  pass(`10/10 groundings scored +${POINTS.TRY} with exact (x_try, z_try) capture`);
  pass(`conversion tee on the touchdown line, ${teeBacks.length}/10 back in the 20–30 m band (mean ${avg(teeBacks).toFixed(2)} m)`);
  pass(`grounding depths ${depths[0]}–${Math.max(...depths)} m in-goal; teardown residue across all trials: ${jointsAfter}`);
  pass('10/10 duplicate triggers rejected by the SPEC_07 lock');
}

/* ============================ (b) GOAL KICKING ×10 ============================ */
console.log('(b) GOAL KICKING ×10 — post geometry, clearances, exact score arithmetic');
{
  const strikeForGoal = (d: Director, kk: { bx: number; bz: number; dir: number; aim: number; t: number; stage: string }, atk: 'A' | 'B') => {
    const dir: 1 | -1 = atk === 'A' ? 1 : -1;
    const goal = goalFor(dir);
    const dz = Math.max(4, (goal - kk.bz) * dir);
    const deg = (Math.atan2(-kk.bx, dz) * 180) / Math.PI;
    kk.aim = Math.min(Math.max(deg / 10, -6.6), 6.6);
    kk.stage = 'AIM'; kk.t = 0;
    const reach = Math.hypot(kk.bx, dz) + 10;
    d.launch(Math.min(Math.max((reach - 9) / 43, 0.35), 1), 1);
    let frames = 0;
    while (d.kk === kk && frames < 60 * 20) { d.update(dt, NO_INPUT, new Set()); frames++; }
    return frames;
  };

  const clears: { bar: number; up: number }[] = [];
  /* ---- conversions ×5: genuine grounding, then the strike ---- */
  const convX = [-16, -8, 0, 8, 16];
  for (let i = 0; i < 5; i++) {
    seedRng(7100 + i);
    const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
    const atk: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
    const dir: 1 | -1 = atk === 'A' ? 1 : -1;
    const goal = goalFor(dir);
    const xT = convX[i];
    const zT = goal + dir * 3;
    d.startOpen(atk, xT, zT);
    const car = d.L(atk, d.op!.carrierNum);
    car.x = xT; car.z = zT; car.vx = 0; car.vz = 0;
    d.op!.carrierX = xT; d.op!.carrierZ = zT;
    d.update(dt, NO_INPUT, new Set());            // the grounding: 5 on the board
    const kk = d.kk!;
    const tag = `conversion ${i}: ${atk} from x_try ${xT}`;
    strikeForGoal(d, kk, atk);
    if (kk.stage !== 'RESULT' || kk.result !== 'SCORED') {
      const c = kk.crossing ? `bar ${kk.crossing.barM.toFixed(2)} m, upright ${kk.crossing.uprightM.toFixed(2)} m` : 'no crossing';
      fail(`${tag} — result ${kk.result}, expected SCORED (${c})`);
    }
    if (kk.crossing) {
      clears.push({ bar: kk.crossing.barM, up: kk.crossing.uprightM });
      if (kk.crossing.barM <= 0) fail(`${tag} — crossed BELOW the ${GOAL_CROSSBAR_M} m crossbar (bar ${kk.crossing.barM.toFixed(2)} m)`);
      if (kk.crossing.uprightM <= 0 || Math.abs(kk.crossing.x) >= GOAL_UPRIGHT_HALF_SPAN_M) fail(`${tag} — crossed OUTSIDE the ${GOAL_UPRIGHT_HALF_SPAN_M * 2} m span (upright ${kk.crossing.uprightM.toFixed(2)} m)`);
      if (kk.crossing.y < GOAL_CROSSBAR_M) fail(`${tag} — crossing height ${kk.crossing.y.toFixed(2)} m under the bar`);
    }
    if (d.teams[atk].score !== POINTS.TRY + POINTS.CONVERSION) fail(`${tag} — score ${d.teams[atk].score}, expected ${POINTS.TRY + POINTS.CONVERSION} (5 + 2)`);
    if (d.lastScorer?.kind !== 'CONVERSION') fail(`${tag} — last scorer kind ${d.lastScorer?.kind}, expected CONVERSION`);
    if (d.conversionPending) fail(`${tag} — conversion window left open after the kick`);
    if (!d.kk || d.kk.type !== 'RESTART') fail(`${tag} — no Law-12 restart followed the conversion (${d.kk?.type ?? d.phase})`);
    console.log(`  conv ${i}: +2 verified — crossing (${kk.crossing?.x.toFixed(1)}, y ${kk.crossing?.y.toFixed(1)}), bar +${kk.crossing?.barM.toFixed(2)} m, upright +${kk.crossing?.uprightM.toFixed(2)} m`);
  }
  /* ---- penalties ×5: place kick from the infringement mark ---- */
  const marks: [number, number][] = [[0, 12], [-14, 26], [18, 34], [-24, 40], [6, 18]];
  for (let i = 0; i < 5; i++) {
    seedRng(7200 + i);
    const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
    const atk: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
    const dir: 1 | -1 = atk === 'A' ? 1 : -1;
    const goal = goalFor(dir);
    const [mx, dist] = marks[i];
    const mz = goal - dir * dist;
    d.startKick(atk, 'GOAL', { x: mx, z: mz });
    const kk = d.kk!;
    const tag = `penalty ${i}: ${atk} from (${mx}, ${mz.toFixed(0)})`;
    strikeForGoal(d, kk, atk);
    if (kk.stage !== 'RESULT' || kk.result !== 'SCORED') fail(`${tag} — result ${kk.result}, expected SCORED`);
    if (kk.crossing) {
      clears.push({ bar: kk.crossing.barM, up: kk.crossing.uprightM });
      if (kk.crossing.barM <= 0) fail(`${tag} — under the crossbar (bar ${kk.crossing.barM.toFixed(2)} m)`);
      if (kk.crossing.uprightM <= 0) fail(`${tag} — wide of the upright (upright ${kk.crossing.uprightM.toFixed(2)} m)`);
    }
    if (d.teams[atk].score !== POINTS.PENALTY) fail(`${tag} — score ${d.teams[atk].score}, expected ${POINTS.PENALTY} (+3)`);
    if (d.lastScorer?.kind !== 'PENALTY') fail(`${tag} — last scorer kind ${d.lastScorer?.kind}, expected PENALTY`);
    console.log(`  pen ${i}: +3 verified — crossing y ${kk.crossing?.y.toFixed(1)}, bar +${kk.crossing?.barM.toFixed(2)} m, upright +${kk.crossing?.uprightM.toFixed(2)} m`);
  }
  const avgBar = clears.reduce((a, c) => a + c.bar, 0) / clears.length;
  const avgUp = clears.reduce((a, c) => a + c.up, 0) / clears.length;
  pass(`10/10 kicks through the ${GOAL_UPRIGHT_HALF_SPAN_M * 2} m span above the ${GOAL_CROSSBAR_M} m bar (mean clearances: bar +${avgBar.toFixed(2)} m, upright +${avgUp.toFixed(2)} m)`);
  pass('score arithmetic exact: conversions +2, penalty goals +3, windows closed, restarts followed');

  /* ---- negative controls: geometry must REFUSE the illegal kick ---- */
  {
    const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
    d.startKick('A', 'GOAL', { x: 0, z: 10 });
    const kk = d.kk!;
    kk.stage = 'AIM'; kk.t = 0; kk.aim = 1.5;                 // 15° — misses the span
    d.launch(Math.min(Math.max((50 - 9) / 43, 0.35), 1), 1);
    let frames = 0;
    while (d.kk === kk && frames < 60 * 20) { d.update(dt, NO_INPUT, new Set()); frames++; }
    if (kk.result !== 'MISSED' || kk.stage !== 'RESULT') fail(`wide control — result ${kk.result}, expected MISSED`);
    if (kk.crossing && kk.crossing.uprightM > 0) fail('wide control — reported a positive upright clearance on a wide kick');
    if (d.teams.A.score !== 0) fail(`wide control — scored ${d.teams.A.score} on a kick wide of the posts`);
    else pass('control: a kick wide of the upright is a miss, score untouched');
  }
  {
    const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
    d.startKick('B', 'GOAL', { x: 0, z: -22 });               // 28 m out, attacking −z
    const kk = d.kk!;
    kk.stage = 'AIM'; kk.t = 0; kk.aim = 0;
    d.launch((29 - 9) / 43, 1);                               // reach 29 m — crosses the plane under the bar
    let frames = 0;
    while (d.kk === kk && frames < 60 * 20) { d.update(dt, NO_INPUT, new Set()); frames++; }
    if (kk.result !== 'MISSED' || kk.stage !== 'RESULT') fail(`crossbar control — result ${kk.result}, expected MISSED`);
    if (kk.crossing && kk.crossing.barM > 0) fail('crossbar control — reported a positive crossbar clearance under the bar');
    if (d.teams.B.score !== 0) fail(`crossbar control — scored ${d.teams.B.score} on a kick under the bar`);
    else pass(`control: a kick under the ${GOAL_CROSSBAR_M} m crossbar is a miss, score untouched`);
  }
}

/* ============================ (c) RESTART RITUAL ×10 ============================ */
console.log('(c) LAW-12 RESTART RITUAL ×10 — halves, ten-metre gate, clean transition');
{
  const strikeGaps: number[] = [];
  const tenTravel: number[] = [];
  const openIn: number[] = [];
  let openCount = 0;
  for (let i = 0; i < 10; i++) {
    seedRng(7400 + i);
    const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
    const kicker: 'A' | 'B' = i % 2 === 0 ? 'A' : 'B';
    const dir = kicker === 'A' ? 1 : -1;
    d.restartAfterScore(kicker);              // the scored-against side kicks off
    const kk = d.kk!;
    const tag = `restart ${i}: ${kicker} kicks off`;

    /* the ritual geometry is written at assembly */
    if (d.phase !== 'KICK' || kk.type !== 'RESTART') fail(`${tag} — not a RESTART kick`);
    if (!near(kk.bx, 0) || !near(kk.bz, 0)) fail(`${tag} — mark (${kk.bx}, ${kk.bz}) is not the centre spot`);
    const form = kk.form ?? [];
    const kickSlots = form.filter((s) => s.team === kicker);
    const recvSlots = form.filter((s) => s.team !== kicker);
    if (recvSlots.length !== 15) fail(`${tag} — ${recvSlots.length} receiving slots, expected the full 15`);
    if (kickSlots.length !== 14) fail(`${tag} — ${kickSlots.length} kicking slots, expected 14 (the kicker stands at the mark)`);
    for (const s of kickSlots) if (s.z * dir > 0) fail(`${tag} — kicking slot (${s.x}, ${s.z}) forward of halfway`);
    for (const s of recvSlots) if (s.z * dir < 10) fail(`${tag} — receiving slot (${s.x}, ${s.z}) inside the ten`);
    const kickerMan = d.L(kicker, kk.kickerNum);
    if ((kickerMan?.z ?? 99) * dir > 1) fail(`${tag} — the kicker is not behind the ball at assembly`);

    /* run to the strike, measure the Law-12 gate, then through the flight */
    let strikeGap = -1, tenM = 0, frames = 0;
    let struck = false;
    let openFrame = -1;
    let sampleGap = 99;
    while (frames < 60 * 60) {
      if (!struck) {
        let nearest = 99;
        for (const p of d.live) {
          if (p.team === kicker || p.sinbin > 0) continue;
          nearest = Math.min(nearest, (p.z - kk.bz) * dir);
        }
        sampleGap = Math.min(sampleGap, nearest);
      }
      d.update(dt, NO_INPUT, new Set());
      frames++;
      if (kk.stage === 'FLIGHT' && !struck) {
        struck = true;
        strikeGap = sampleGap;                // the gap at the strike frame
        /* at the strike: both squads are on their lawful sides of halfway */
        for (const p of d.live) {
          if (p.team === kicker && p.z * dir > 1.5) fail(`${tag} — kicking shirt ${p.num} at ${p.z.toFixed(1)} is past the ball at the strike`);
          if (p.team !== kicker && p.z * dir < 9.5) fail(`${tag} — receiving shirt ${p.num} at ${p.z.toFixed(1)} is inside the ten at the strike`);
        }
      }
      if (kk.stage === 'FLIGHT') tenM = Math.max(tenM, (kk.bz - kk.markZ) * dir);
      if (d.kk !== kk) { openFrame = frames; break; }      // episode over
      if (d.phase === 'OPEN_PLAY') { openFrame = frames; break; }
    }
    strikeGaps.push(strikeGap);
    tenTravel.push(tenM);
    if (!struck) fail(`${tag} — the kick was never struck in 60 s`);
    if (strikeGap < 9.5) fail(`${tag} — struck with the receivers only ${strikeGap.toFixed(1)} m back (Law-12 gate failed)`);
    if (kk.tenCrossed !== true || tenM < 10) fail(`${tag} — the drop-kick travelled ${tenM.toFixed(1)} m, must cross the 10 m line`);
    if (d.phase === 'OPEN_PLAY') { openCount++; openIn.push(openFrame); }
    else fail(`${tag} — ended in phase ${d.phase}, expected a clean transition into open play`);
    if (d.watchdogTrips !== 0) fail(`${tag} — ${d.watchdogTrips} watchdog trip(s) during the ritual`);
    if (d.tryLock !== null) fail(`${tag} — the try lock survived the play reset`);
    console.log(`  ${tag}: strike gap ${strikeGap.toFixed(1)} m, ten travel ${tenM.toFixed(1)} m, open play in ${openFrame} frames`);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  pass(`10/10 post-score restarts: squads re-aligned on correct halves (15 receiving / 14 chasing + kicker at the mark)`);
  pass(`Law-12 ten-metre gate held at the strike (min gap ${Math.min(...strikeGaps).toFixed(1)} m, mean ${avg(strikeGaps).toFixed(1)} m)`);
  pass(`10/10 drop-kicks crossed the 10 m line (mean travel ${avg(tenTravel).toFixed(1)} m) and transitioned cleanly into open play (${openCount}/10)`);

  /* ---- infringement control: a restart that dies short of the ten ---- */
  {
    const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
    d.restartAfterScore('A');                 // A kicks, B receives
    const kk = d.kk!;
    kk.stage = 'AIM'; kk.t = 0; kk.aim = 6.6; // squibbed hard sideways, no range
    d.launch(0, 1);                           // reach 9 m — dies well short of the ten
    let frames = 0;
    while (d.kk && frames < 60 * 30) { d.update(dt, NO_INPUT, new Set()); frames++; }
    if (kk.tenCrossed) fail(`infringement control — the short kick reported a ten-metre crossing (max ${Math.max(...kk.history.map((h) => h.z)).toFixed(1)} m)`);
    if (d.phase !== 'SCRUM' || d.scrim?.feed !== 'B') fail(`infringement control — phase ${d.phase} feed ${d.scrim?.feed}, expected a SCRUM to B`);
    else if (Math.abs(d.scrumAnchor.x) > 0.01 || Math.abs(d.scrumAnchor.z) > 0.01) fail(`infringement control — scrum anchored at (${d.scrumAnchor.x}, ${d.scrumAnchor.z}), expected the centre spot`);
    if (d.teams.A.stats.restarts !== 1) fail(`infringement control — ${d.teams.A.stats.restarts} restart offences logged, expected 1`);
    if (d.watchdogTrips !== 0) fail(`infringement control — ${d.watchdogTrips} watchdog trip(s)`);
    else pass('control: a restart that dies short of the ten draws the centre-scrum infringement call (scrum to the receiving side)');
  }
}

/* ============================ VERDICT ============================ */
console.log('');
if (failures) {
  console.log(`SCORE & RESTART PROBE: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('SCORE & RESTART PROBE PASSES — grounding, goal geometry, score arithmetic, Law-12 ritual');
process.exit(0);
