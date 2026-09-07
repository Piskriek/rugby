/**
 * BACKLINE PROBE — the positional trees for shirts 9–15 and the pendulum.
 *
 *   npx tsx scripts/backlineprobe.ts
 *
 * Three jobs, each with a PURE half (the geometry, proven without a match)
 * and a MATCH half (eight seeded CPU-v-CPU matches, two minutes each):
 *
 *   (a) THE SCRUMHALF'S EXTRACTION — the 9's base sits behind BOTH the
 *       conventional stride and the team's DYNAMIC HINDMOST FOOT, and
 *       follows it as the cleanout arrives; the body never sustains a
 *       breach the referee would actually blow (the pre-release standard:
 *       2.0 m for 0.7 s while the ball is still in the ruck).
 *
 *   (b) THE FLYHALF'S POCKET — the first-receiver depth is priced by the
 *       ground in front of the ball (flat in the red zone, deep in
 *       midfield), the pocket sits openside of the ball, and the live 10
 *       waits in that band while the 9 carries.
 *
 *   (c) THE PENDULUM — when the opposition's 9 or 10 enters his kicking
 *       pose (AIM/METER on an open-play kick), the back three of the
 *       receiving side rotate to OWN the deep thirds — left, centre,
 *       right — the marks are in the correct third at the correct depth,
 *       and the rotation slides with the ball.
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import {
  evaluateBacklineTree, nineBaseZ, nineBaseX, pocketDepthFor, kickPoseOf,
  backThreeRotation, BACKLINE_TREES,
  type BacklineContext,
} from '../src/game/engine/backline';
import {
  pendulumThirds, pendulumDepthFor, pendulumCoverage, pendulumSlot,
} from '../src/game/behaviour/backline-echelon';
import { ruckGateGeometry, type GatePoint } from '../src/game/engine/gates';
import { ruckOffsidePlanes } from '../src/game/engine/offside';
import { ruckDistributor } from '../src/game/intelligence';

let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };

/* ================================ PURE ================================ */

console.log('PURE — (a) the nine base against the dynamic hindmost line');
// A ruck at (0, 20), attack A going +z. The A plane is the rearmost A foot.
const cluster: GatePoint[] = [
  { team: 'A', x: -0.6, z: 19.2 }, { team: 'A', x: 0.4, z: 19.6 }, { team: 'A', x: 0, z: 20.2 },
  { team: 'B', x: -0.4, z: 21.4 }, { team: 'B', x: 0.6, z: 21.0 }, { team: 'B', x: 0.1, z: 20.6 },
];
const geo = ruckGateGeometry(cluster)!;
{
  // the cleanout arrives from BEHIND the ball: the plane walks from the
  // carrier's foot (20.2) back to 17.0 over the life of the ruck
  let allBehind = true, allInCorridor = true;
  for (let i = 0; i <= 10; i++) {
    const plane = 20.2 - i * 0.32;                 // 20.2 → 17.0
    const base = nineBaseZ(20, plane, 1);
    const baseX = nineBaseX(0, geo, 1, 'A');
    if ((base - plane) * 1 > -0.45) allBehind = false;   // 0.5 m behind, minus epsilon
    if (Math.abs(baseX - 0) > geo.gates.A!.halfW) allInCorridor = false;
  }
  check(allBehind, 'the base sits ≥0.5 m behind the plane on every frame of the cleanout arrival');
  check(allInCorridor, 'the base stays inside the corridor\'s lateral band');
  // no line yet (early CONTACT): the conventional stride stands
  check(Math.abs(nineBaseZ(20, null, 1) - (20 - 1.4)) < 1e-9, 'with no line yet the conventional stride stands');
  // the axis flips for a B attack
  check(nineBaseZ(20, 18, -1) > 18, 'for a −z attack the base is at greater z than the plane');
}

console.log('PURE — (b) the ten\'s pocket depth');
{
  check(pocketDepthFor(12, 0.5) < pocketDepthFor(30, 0.5) && pocketDepthFor(30, 0.5) < pocketDepthFor(50, 0.5),
    'the pocket is flatter in the red zone than in the building phase, shallower than in midfield');
  check(pocketDepthFor(10, 0) >= 3.5 && pocketDepthFor(10, 1) <= 4.5,
    `red-zone band 3.5–4.5 m (got ${pocketDepthFor(10, 0).toFixed(2)}–${pocketDepthFor(10, 1).toFixed(2)})`);
  check(pocketDepthFor(50, 0) >= 8 && pocketDepthFor(50, 1) <= 10.5,
    `midfield band 8–10.5 m (got ${pocketDepthFor(50, 0).toFixed(2)}–${pocketDepthFor(50, 1).toFixed(2)})`);
  // the tree node: carrier is the 9, ball at (10, 20) so openside is −x
  const base: BacklineContext = {
    phase: 'OPEN_PLAY', team: 'A', attacking: 'A', dir: 1, sigma: 1,
    p: { x: 6, z: 26 }, vel: { x: 0, z: 0 }, ball: { x: 10, z: 20 }, mark: { x: 6, z: 26 },
    geo: null, stage: '', ruckFormed: false, inRoster: false, loose: null,
    carrier: { num: 9, x: 10, z: 20, vz: 0 }, latched: false, busy: false,
    toLine: 50, opT: 0.4, tempo: 0.5, lineBreak: false, ruckWindow: 0,
    kick: null, ownEdgeZ: -62,
  };
  const m = evaluateBacklineTree(10, base)!;
  const depth = (m.z - base.ball.z) * base.dir;
  check(m.node === 'ten-pocket', 'with a carrying 9 the ten runs the pocket');
  check(depth >= 3.5 && depth <= 10.5, `the pocket depth is inside the band (${depth.toFixed(2)} m)`);
  check(m.x < base.ball.x, 'the pocket sits openside of the ball (the 9\'s release is a flat angled pass)');
  // the 12 and 13: the flat lines, in front of the gain line
  const m12 = evaluateBacklineTree(12, base)!;
  const m13 = evaluateBacklineTree(13, base)!;
  check(m12.node === 'twelve-flat' && m13.node === 'thirteen-flat', 'the 12 and 13 run the flat lines off the 9');
  check((m12.z - base.ball.z) > 0 && (m13.z - base.ball.z) > 0, 'both flat lines finish in front of the gain line');
  check(Math.abs(m12.x - base.ball.x) < Math.abs(m13.x - base.ball.x), 'the 12 is the inside flat, the 13 the tip lane');
}

console.log('PURE — (c) the pendulum geometry');
{
  for (const ballX of [-10, 0, 10]) {
    const rot = backThreeRotation({ x: ballX, z: -10 }, 1, 62);
    const xs = rot.map((r) => r.x);
    check(new Set(xs).size === 3, `ball at x=${ballX}: three distinct marks (${xs.map((v) => v.toFixed(1)).join(' / ')})`);
    check(rot[0].third === 'LEFT' && rot[1].third === 'CENTRE' && rot[2].third === 'RIGHT',
      `ball at x=${ballX}: 11 owns LEFT, 15 CENTRE, 14 RIGHT`);
    for (const r of rot) {
      const t = pendulumThirds(ballX);
      const own = t[r.third === 'LEFT' ? 'left' : r.third === 'RIGHT' ? 'right' : 'centre'];
      const others = ['left', 'centre', 'right'].filter((k) => k !== (r.third === 'LEFT' ? 'left' : r.third === 'RIGHT' ? 'right' : 'centre'));
      check(Math.abs(r.x - own) <= 7 && others.every((k) => Math.abs(r.x - t[k]) >= 7 - 1e-9),
        `#${r.num} is inside its own third and out of the others (x=${r.x.toFixed(1)})`);
      check(r.z - -10 >= 12 && r.z - -10 <= 26, `#${r.num} depth ${(r.z + 10).toFixed(1)} m is inside 12–26 m`);
    }
    check(pendulumCoverage(rot.map((r) => ({ num: r.num, x: r.x })), ballX) === 1, `ball at x=${ballX}: coverage is a full 1.0`);
  }
  // the rotation slides with the ball: the thirds travel with ball.x
  {
    const a = backThreeRotation({ x: -10, z: -10 }, 1, 62).find((r) => r.num === 11)!;
    const b = backThreeRotation({ x: 10, z: -10 }, 1, 62).find((r) => r.num === 11)!;
    check(b.x - a.x === 20, `the 11's LEFT third slides with the ball (Δ=${(b.x - a.x).toFixed(1)} m)`);
  }
  // the depth ceiling: the dead-ball line limits the triangle
  check(pendulumDepthFor(40, 62) <= 18, `near the fence the depth is capped (${pendulumDepthFor(40, 62).toFixed(1)} m for 22 m of room)`);
  check(pendulumDepthFor(0, 62) === 26, 'in the open field the triangle takes the full depth');
  // the pose gate: 9/10 in AIM/METER only
  check(!!kickPoseOf({ kicker: 'A', kickerNum: 10, stage: 'AIM', bx: 0, bz: 0 }), 'a 10 in AIM is a pose');
  check(!!kickPoseOf({ kicker: 'A', kickerNum: 9, stage: 'METER', bx: 0, bz: 0 }), 'a 9 in METER is a pose');
  check(!kickPoseOf({ kicker: 'A', kickerNum: 10, stage: 'FLIGHT', bx: 0, bz: 0 }), 'in FLIGHT the chasers own the field');
  check(!kickPoseOf({ kicker: 'A', kickerNum: 15, stage: 'AIM', bx: 0, bz: 0 }), 'a 15 kicker is not the pose the back three rotate for');
  check(!kickPoseOf(undefined), 'no kick is no pose');
  // the tree nodes carry the same geometry
  {
    const base: BacklineContext = {
      phase: 'OPEN_PLAY', team: 'B', attacking: 'A', dir: 1, sigma: -1,
      p: { x: 12, z: -12 }, vel: { x: 0, z: 0 }, ball: { x: 0, z: -10 }, mark: { x: 12, z: -12 },
      geo: null, stage: '', ruckFormed: false, inRoster: false, loose: null,
      carrier: null, latched: false, busy: false, toLine: 40, opT: 2, tempo: 0.5,
      lineBreak: false, ruckWindow: 0,
      kick: { team: 'A', num: 10, x: 0, z: -10 }, ownEdgeZ: -62,
    };
    for (const num of [11, 15, 14]) {
      const m = evaluateBacklineTree(num, base)!;
      const ref = backThreeRotation({ x: 0, z: -10 }, 1, -62).find((r) => r.num === num)!;
      check(m.node.endsWith('pendulum') && Math.abs(m.x - ref.x) < 1e-9 && Math.abs(m.z - ref.z) < 1e-9,
        `#${num} on the pose runs the ${ref.third} third from the tree`);
    }
  }
}

console.log('PURE — the seven trees are complete and the marks are on the field');
{
  const expectedNodes: Record<number, number> = { 9: 3, 10: 3, 11: 3, 12: 4, 13: 4, 14: 3, 15: 4 };
  for (const num of [9, 10, 11, 12, 13, 14, 15]) {
    check(BACKLINE_TREES[num]!.length === expectedNodes[num], `#${num} carries ${expectedNodes[num]} nodes`);
  }
  // every node returns a mark on the field when its `when` holds: exercise
  // each shirt through a sweep of synthetic contexts
  const sweep: BacklineContext[] = [];
  const phases: Array<'OPEN_PLAY' | 'BREAKDOWN'> = ['OPEN_PLAY', 'BREAKDOWN'];
  const stages = ['', 'RUCK', 'RECYCLE'];
  const carriers = [null, { num: 9, x: 5, z: 20, vz: 0 }, { num: 10, x: 5, z: 20, vz: 0 },
    { num: 12, x: 5, z: 20, vz: 0 }, { num: 13, x: 5, z: 20, vz: 0 }, { num: 15, x: 5, z: 20, vz: 0 }];
  for (const phase of phases) for (const stage of stages) for (const carrier of carriers) {
    for (const team of ['A', 'B'] as const) for (const lineBreak of [false, true]) {
      for (const kick of [null, { team: 'A', num: 10, x: 0, z: 20 }]) {
        if (kick && team === 'A') continue;   // the pose is the opposition's
        sweep.push({
          phase, team, attacking: 'A', dir: 1, sigma: team === 'A' ? 1 : -1,
          p: { x: 8, z: 24 }, vel: { x: 0, z: 0 }, ball: { x: 5, z: 20 }, mark: { x: 8, z: 24 },
          geo: null, stage, ruckFormed: stage === 'RUCK', inRoster: false, loose: null,
          carrier, latched: false, busy: false, toLine: 45, opT: 0.3, tempo: 0.5,
          lineBreak, ruckWindow: stage ? 2 : 0, kick, ownEdgeZ: -62,
        });
      }
    }
  }
  let bad = '';
  for (const num of [9, 10, 11, 12, 13, 14, 15]) {
    for (const c of sweep) {
      const m = evaluateBacklineTree(num, c);
      if (!m) continue;
      if (Math.abs(m.x) > 33.5 || Math.abs(m.z) > 59.5 || m.urgency < 0 || m.urgency > 1) {
        bad = `#${num} phase=${c.phase} stage=${c.stage || '-'} carrier=${c.carrier?.num ?? '-'} → (${m.x.toFixed(1)}, ${m.z.toFixed(1)})`;
        break;
      }
    }
  }
  check(bad === '', `every mark the sweep produces is on the field${bad ? ` — ${bad}` : ''}`);
}

/* ================================ MATCH ================================ */
console.log('MATCH — eight seeds, two minutes each');
const NO_INPUT: any = { left: false, right: false, up: false, down: false, run: false, sprint: false };
const OPEN_KICKS = ['PUNT', 'BOMB', 'GRUBBER', 'CROSS_FIELD', 'PENALTY'];
// (a) the nine's extraction
let nineRuckFrames = 0, nineMarkOffside = 0, nineSlowMarkOffside = 0, nineBreachEpisodes = 0;
let nineBodySustained = 0;         // frames the free nine sat ≥2.0 m past the plane
let nineBodyMax = -99;
// (b) the pocket
let pocketLiveFrames = 0, pocketLiveSum = 0, pocketLiveBad = 0;
let pocketPosFrames = 0, pocketPosSum = 0, pocketPosBad = 0;
// (c) the pendulum
let poseFrames = 0, poseMarksOk = 0, pendThirdSeen = { LEFT: 0, CENTRE: 0, RIGHT: 0 };
let pendulumTotal = 0, nineBaseTotal = 0, nineOffsideTotal = 0, pocketStatFrames = 0, pocketStatSum = 0;
let rucks = 0, trips = 0;
const nodes: Record<string, number> = {};
const breachCarry = new Map<object, number>();   // ruck bd → sustained seconds ≥2.0 m

for (let seed = 1; seed <= 8; seed++) {
  seedRng(seed);
  const d: any = new Director(gateConfig(6));
  let last = d.phase;
  for (let i = 0; i < 120 * 60; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    if (d.phase !== last) { if (d.phase === 'BREAKDOWN') rucks++; last = d.phase; }

    /* (a) the nine at his ruck */
    if (d.phase === 'BREAKDOWN' && d.bd) {
      const bd = d.bd;
      if (bd.stage !== 'CONTACT' && bd.stage !== 'PLACE' && bd.stage !== 'RUCK') continue;
      const dist = ruckDistributor(d.live, bd.attacking, bd.contactX, bd.contactZ);
      if (!dist || dist.num !== 9) continue;
      if (bd.players.some((q: any) => q.team === bd.attacking && q.num === 9)) continue;
      const g = ruckOffsidePlanes(bd)[bd.attacking];
      if (!g) continue;
      nineRuckFrames++;
      /* the MARK placeBound wrote: behind the plane. A man standing over
       * the line is the offence; a man in transit crossing it (the nine
       * running to a ruck 8 m to the side was always going to cross) is
       * policed by the sustained-episode check below, which is the
       * referee's own standard. */
      const markPen = (dist.tz - g.z) * g.dir;
      if (markPen > 0.05) {
        nineMarkOffside++;
        /* standing over the line: past the arrival window and not moving */
        if (bd.t >= 0.3 && Math.hypot(dist.vx, dist.vz) < 0.6) nineSlowMarkOffside++;
      }
      /* the BODY: the pre-release standard — 2.0 m for 0.7 s while the ball
       * is still in the ruck. Track sustained seconds per (team, ruck). */
      const pen = (dist.z - g.z) * g.dir;
      nineBodyMax = Math.max(nineBodyMax, pen);
      if (pen >= 2.0) {
        nineBodySustained++;
        const prev = breachCarry.get(bd) ?? 0;
        if (prev >= 0 && prev + 1 / 60 >= 0.7) { nineBreachEpisodes++; breachCarry.set(bd, -1); }
        else if (prev >= 0) breachCarry.set(bd, prev + 1 / 60);
      } else {
        const prev = breachCarry.get(bd);
        if (prev !== undefined && prev > 0) breachCarry.delete(bd);
      }
    }

    /* (b) the pocket: while the 9 carries, the 10's MARK sits in the band
     * (the contract the tree prices) and his POSITION arrives by the
     * second — the mark is the contract, the position is physics */
    if (d.phase === 'OPEN_PLAY' && d.op && d.op.carrierNum === 9 && !d.op.ball.live) {
      const atk = d.op.attacking;
      const ten = d.live.find((p: any) => p.team === atk && p.num === 10);
      const nine = d.live.find((p: any) => p.team === atk && p.num === 9);
      if (!ten || !nine || ten === d.ctrlPlayer) continue;
      const dir = atk === 'A' ? 1 : -1;
      const ballZ = nine.z; // the 9 carries the ball
      pocketLiveFrames++;
      const markDepth = (ten.tz - ballZ) * dir;
      pocketLiveSum += markDepth;
      if (markDepth < 1.5 || markDepth > 13) pocketLiveBad++;
      if (d.op.t < 1.0) {
        const posDepth = (ten.z - ballZ) * dir;
        pocketPosFrames++;
        pocketPosSum += posDepth;
        if (posDepth < -2.5) pocketPosBad++;
      }
    }

    /* (c) the pendulum: the receiving back three's MARKS on the pose */
    if (d.phase === 'KICK' && d.kk && (d.kk.stage === 'AIM' || d.kk.stage === 'METER')
        && OPEN_KICKS.includes(d.kk.type) && (d.kk.kickerNum === 9 || d.kk.kickerNum === 10)) {
      poseFrames++;
      const s = d.kk;
      const defTeam = s.kicker === 'A' ? 'B' : 'A';
      let ok = true;
      const seen = new Set<string>();
      for (const num of [11, 14, 15]) {
        const p = d.live.find((q: any) => q.team === defTeam && q.num === num);
        const depth = (p.tz - s.bz) * s.dir;
        const thirds = pendulumThirds(s.bx);
        const want = pendulumSlot(num);
        const key = want === 'LEFT' ? 'left' : want === 'RIGHT' ? 'right' : 'centre';
        const dOwn = Math.abs(p.tx - thirds[key]);
        const others = ['left', 'centre', 'right'].filter((k) => k !== key);
        if (dOwn > 7.5 || others.some((k) => Math.abs(p.tx - thirds[k]) < 6.5) || depth < 12 || depth > 30) ok = false;
        seen.add(want);
        pendThirdSeen[want]++;
      }
      if (ok && seen.size === 3) poseMarksOk++;
    }
  }
  trips += d.watchdogLog.length;
  breachCarry.clear();
  pendulumTotal += d.backlineStats.pendulumFrames;
  nineBaseTotal += d.backlineStats.nineBaseFrames.A + d.backlineStats.nineBaseFrames.B;
  nineOffsideTotal += d.backlineStats.nineOffsideFrames.A + d.backlineStats.nineOffsideFrames.B;
  pocketStatFrames += d.backlineStats.pocketFrames;
  pocketStatSum += d.backlineStats.pocketDepthSum;
  for (const [k, v] of Object.entries(d.backlineStats.nodes)) nodes[k] = (nodes[k] ?? 0) + (v as number);
}

console.log(`  rucks=${rucks} watchdogTrips=${trips}`);
console.log(`  (a) nine ruck frames=${nineRuckFrames} markOffside(transit)=${nineMarkOffside} markOffside(standing)=${nineSlowMarkOffside} bodySustained≥2m frames=${nineBodySustained} (max ${nineBodyMax.toFixed(2)} m) breachEpisodes=${nineBreachEpisodes}`);
console.log(`      authoritative base marks: ${nineBaseTotal} written, ${nineOffsideTotal} in front of the plane`);
console.log(`  (b) pocket marks: ${pocketLiveFrames} frames, meanDepth=${pocketLiveFrames ? (pocketLiveSum / pocketLiveFrames).toFixed(2) : '-'} m, outOfBand=${pocketLiveBad}`);
console.log(`      pocket positions, first 1.0 s: ${pocketPosFrames} frames, meanDepth=${pocketPosFrames ? (pocketPosSum / pocketPosFrames).toFixed(2) : '-'} m, leftBehind(<-2.5 m)=${pocketPosBad}`);
console.log(`      tree pocketFrames=${pocketStatFrames} meanDepth=${pocketStatFrames ? (pocketStatSum / pocketStatFrames).toFixed(2) : '-'} m`);
console.log(`  (c) pose frames=${poseFrames} marks fully correct=${poseMarksOk}; pendulumFrames=${pendulumTotal} thirds=${JSON.stringify(pendThirdSeen)}`);

/* (a) — the extraction */
check(nineRuckFrames > 50, `the nine is the ball-player at ${nineRuckFrames} ruck frames`);
check(nineSlowMarkOffside === 0, 'the nine is never standing over the dynamic hindmost line (transit crossings, first 0.3 s, count: ' + nineMarkOffside + ')');
check(nineOffsideTotal === 0, 'the authoritative base mark is onside on every ruck');
check(nineBreachEpisodes === 0, 'the nine never sustains a 2.0 m / 0.7 s breach while the ball is in the ruck');

/* (b) — the pocket */
check(pocketLiveFrames > 100, `the ten waits in the pocket for ${pocketLiveFrames} frames with the 9 carrying`);
if (pocketLiveFrames > 100) {
  const mean = pocketLiveSum / pocketLiveFrames;
  check(mean >= 3 && mean <= 12, `the pocket mark depth (${mean.toFixed(2)} m) is inside the 3–12 m band`);
  check(pocketLiveBad <= 0.08 * pocketLiveFrames, `the pocket mark is inside the hittable band on ${100 * (1 - pocketLiveBad / pocketLiveFrames).toFixed(1)}% of frames`);
  check(pocketPosFrames > 50 && pocketPosBad <= 0.35 * pocketPosFrames,
    `in the first second the ten arrives: ${100 * (1 - pocketPosBad / Math.max(1, pocketPosFrames)).toFixed(0)}% of the time he is within 2.5 m behind the ball`);
}
check(pocketStatFrames > 50, `the pocket node priced ${pocketStatFrames} marks`);
check(pocketStatFrames > 0 && pocketStatSum / pocketStatFrames >= 3.5 && pocketStatSum / pocketStatFrames <= 10.5,
  'the pocket depth the tree prices is inside the authored band');

/* (c) — the pendulum */
check(poseFrames > 50, `the opposition set the pose ${poseFrames} times on open-play kicks`);
check(poseFrames > 0 && poseMarksOk / poseFrames >= 0.99,
  `on the pose the back three's marks own the correct thirds at depth (${poseMarksOk}/${poseFrames})`);
check(pendulumTotal > 200, `the rotation was commanded ${pendulumTotal} man-frames`);
check(pendThirdSeen.LEFT > 0 && pendThirdSeen.CENTRE > 0 && pendThirdSeen.RIGHT > 0,
  `all three thirds were covered (L ${pendThirdSeen.LEFT} / C ${pendThirdSeen.CENTRE} / R ${pendThirdSeen.RIGHT})`);
check(trips === 0, 'no watchdog trips');

/* Every node a CPU-v-CPU match can reach must have fired. The two nine nodes
 * (nine-base, nine-exit) are owned by the ruck itself while the 9 is the
 * distributor (he is `bound`, the tree never sees him) and proven PURE above;
 * the pendulum nodes are owned by the kick's SETTING stage (think() stands
 * down in the KICK phase) and proven live by the mark checks above. */
const expected = [
  'nine-link',
  'ten-pocket', 'ten-loop', 'ten-drift-def',
  'twelve-flat', 'twelve-trail', 'twelve-blitz', 'twelve-drift-def',
  'thirteen-flat', 'thirteen-trail', 'thirteen-jam', 'thirteen-drift-def',
  'eleven-edge', 'eleven-trail',
  'fourteen-edge', 'fourteen-trail',
  'fifteen-insert', 'fifteen-link', 'fifteen-sweep',
];
for (const n of expected) check((nodes[n] ?? 0) > 0, `node fired in match: ${n} ×${nodes[n] ?? 0}`);
const treeSize = Object.values(BACKLINE_TREES).reduce((n, t) => n + t.length, 0);
check(treeSize === 24, `the seven trees carry ${treeSize} nodes between them`);

console.log(fails ? `\nBACKLINE PROBE: ${fails} FAILURE(S)` : '\nBACKLINE PROBE PASSES');
process.exit(fails ? 1 : 0);
