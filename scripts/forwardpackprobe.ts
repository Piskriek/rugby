/**
 * FORWARD PACK PROBE — the positional trees for shirts 1–8 and the gate rule.
 *
 *   npx tsx scripts/forwardpackprobe.ts
 *
 * Two halves:
 *
 *   1. PURE. `routeThroughGate` is exercised against a hand-drawn ruck: a man
 *      in front of the pile who is asked to reach a mark behind it must be
 *      given a waypoint that is OUTSIDE the contest box on every leg, and the
 *      final leg must be inside his own corridor. Every branch of every
 *      shirt's tree is evaluated against a synthetic context and its mark
 *      must be a lawful place to stand at that ruck.
 *
 *   2. MATCH. Twelve seeded CPU-v-CPU matches, two minutes each. The referee's
 *      own side-entry ledger is read back: the observed rate per ruck must be
 *      under a quarter of the pre-tree baseline (0.51/ruck), no whistles, no
 *      watchdog trips, and every tree node must have fired at least once.
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import {
  routeThroughGate, evaluateForwardTree, isLegalStanding, FORWARD_TREES,
  scrumBindProfile, frontRowStability, stabilisedCollapseRisk, engineRoomFactor,
  liftersFor, LINEOUT_LINE_THROWING, lineoutRole, eightPicksFromScrum,
  type PackContext,
} from '../src/game/engine/forwardPack';
import { ruckGateGeometry, insideVolume, inCorridor, type GatePoint } from '../src/game/engine/gates';

let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };

/* ================================ PURE ================================ */
console.log('PURE — the gate rule');
// A ruck at (0, 20), attack A going +z. Three A bodies and three B bodies.
const cluster: GatePoint[] = [
  { team: 'A', x: -0.6, z: 19.2 }, { team: 'A', x: 0.4, z: 19.6 }, { team: 'A', x: 0, z: 20.2 },
  { team: 'B', x: -0.4, z: 21.4 }, { team: 'B', x: 0.6, z: 21.0 }, { team: 'B', x: 0.1, z: 20.6 },
];
const geo = ruckGateGeometry(cluster)!;
const gA = geo.gates.A!;
// an A forward standing IN FRONT of the pile (z 23) wants a mark behind it (z 17)
{
  let p = { x: 0.3, z: 23.2 };
  const mark = { x: 0.5, z: 17.2 };
  let legs: string[] = [];
  let crossed = false;
  for (let i = 0; i < 600 && legs.length < 200; i++) {
    const r = routeThroughGate('A', p, mark, geo, false, 0, { x: 0, z: 0 });
    // released (his own corridor, or a clear straight run): walk on to the mark
    if (!r.routed && Math.hypot(mark.x - p.x, mark.z - p.z) < 0.05) break;
    if (r.routed && legs[legs.length - 1] !== r.leg) legs.push(r.leg);
    // the waypoint itself must never be inside the box
    if (insideVolume(geo.volume, { team: 'A', x: r.mark.x, z: r.mark.z })) crossed = true;
    // take a 0.3 m step toward the waypoint
    const dx = r.mark.x - p.x, dz = r.mark.z - p.z, d = Math.hypot(dx, dz) || 1;
    p = { x: p.x + dx / d * Math.min(0.3, d), z: p.z + dz / d * Math.min(0.3, d) };
    if (insideVolume(geo.volume, { team: 'A', x: p.x, z: p.z })) crossed = true;
  }
  check(!crossed, `a man in front of the pile is walked round it, never through it (legs: ${legs.join(' → ')})`);
  check(inCorridor(gA, { team: 'A', x: p.x, z: p.z }), `…and finishes inside his own corridor at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  check(legs[0] === 'flank' && legs.includes('back') && legs.indexOf('back') > legs.indexOf('flank'), `the plan is flank → back, then released behind the plane (legs: ${legs.join(' → ')})`);
}
// a man already behind his plane, wide of the corridor, is sent straight to the gate mouth
{
  const r = routeThroughGate('A', { x: 4, z: 16 }, { x: 0, z: 20 }, geo, false);
  check(r.routed && r.leg === 'gate' && inCorridor(gA, { team: 'A', ...r.mark }), 'a man behind the plane goes straight to the gate mouth');
}
// a man already standing in his own corridor is passing through the gate now: his mark stands
{
  const r = routeThroughGate('A', { x: 0.2, z: 16 }, { x: 0, z: 20 }, geo, false);
  check(!r.routed, 'a man already in his corridor is not detoured');
}
// a man who has passed the gate is left alone
{
  const r = routeThroughGate('A', { x: 0.2, z: 23 }, { x: 0, z: 17 }, geo, true);
  check(!r.routed, 'a man the ledger has already passed is not detoured');
}
// a man whose mark is clear of the box is left alone
{
  const r = routeThroughGate('A', { x: 8, z: 23 }, { x: 8, z: 17 }, geo, false);
  check(!r.routed, 'a man whose run never crosses the box is not detoured');
}
// momentum: a man beside the box whose velocity carries him into it is detoured now
{
  const r = routeThroughGate('A', { x: 3.0, z: 20 }, { x: 3.0, z: 20 }, geo, false, 0, { x: -6, z: 0 });
  check(r.routed, 'a man whose next 0.35 s of momentum crosses the box is detoured before he arrives');
}

console.log('PURE — every tree node yields a lawful mark');
const base: PackContext = {
  phase: 'BREAKDOWN', team: 'A', attacking: 'A', dir: 1, sigma: 1,
  p: { x: 4, z: 18 }, ball: { x: 0, z: 20 }, mark: { x: 0, z: 20 },
  geo, stage: 'RUCK', ruckFormed: true, inRoster: false, loose: null, carrier: null,
  latched: false, busy: false, toLine: 30,
};
for (const num of [1, 2, 3, 4, 5, 6, 7, 8]) {
  for (const team of ['A', 'B'] as const) {
    for (const formed of [true, false]) {
      const c: PackContext = { ...base, team, ruckFormed: formed, stage: formed ? 'RUCK' : 'PLACE' };
      const m = evaluateForwardTree(num, c);
      if (!m) continue;
      const legal = isLegalStanding(team, m, geo);
      check(legal, `#${num} ${team === 'A' ? 'ATK' : 'DEF'} ${formed ? 'formed' : 'forming'} → ${m.node} at (${m.x.toFixed(2)}, ${m.z.toFixed(2)})`);
    }
  }
}
// open-play nodes
{
  const op: PackContext = { ...base, phase: 'OPEN_PLAY', geo: null, stage: '', ruckFormed: false, carrier: { num: 9, x: 0, z: 20 } };
  check(evaluateForwardTree(8, op)?.node === 'link-9', '8 links with a carrying 9');
  const held: PackContext = { ...op, team: 'B', latched: true, p: { x: 2, z: 26 } };
  check(evaluateForwardTree(7, held)?.node === 'jackal-approach', '7 goes to the defence gate of a held carrier');
  const loose: PackContext = { ...op, team: 'B', loose: { x: 3, z: 22 }, p: { x: 5, z: 25 } };
  check(evaluateForwardTree(7, loose)?.node === 'hunt', '7 hunts a loose ball');
  const blind: PackContext = { ...op, team: 'B', ball: { x: 18, z: 20 }, p: { x: 10, z: 24 } };
  check(evaluateForwardTree(6, blind)?.node === 'blind-anchor', '6 anchors the touchline side of the line');
  const podc: PackContext = { ...op, mark: { x: 14, z: 18 } };
  check(evaluateForwardTree(1, podc)?.node === 'pod-clamp', '1 is clamped within a pass of a carrying 9');
}

console.log('PURE — scrum & lineout');
check(scrumBindProfile(1, 2).bindTolerance < scrumBindProfile(2, 4).bindTolerance
  && scrumBindProfile(2, 4).bindTolerance < scrumBindProfile(3, 8).bindTolerance, 'bind tolerance: front row < locks < eight');
check(scrumBindProfile(1, 2).crouch < scrumBindProfile(1, 1).crouch && scrumBindProfile(1, 1).crouch < scrumBindProfile(2, 4).crouch, 'centre of mass: hooker lowest, then props, then locks');
check(frontRowStability([0.2, 0.3, 0.4], true) === 1 && frontRowStability([2, 2, 2], true) === 0, 'front-row stability reads the bind offsets');
check(stabilisedCollapseRisk(0.5, 1) < stabilisedCollapseRisk(0.5, 0), 'a stable front row lowers the collapse risk');
check(engineRoomFactor([100, 100]) > engineRoomFactor([20, 20]), 'the locks\' power multiplies the pack shove');
check(LINEOUT_LINE_THROWING.filter((n) => lineoutRole(n) === 'JUMPER').join() === '4,5,8', 'the jumpers are 4, 5 and 8');
check(liftersFor(LINEOUT_LINE_THROWING, 1).join() === '1,3', '4 is lifted by 1 and 3');
check(liftersFor(LINEOUT_LINE_THROWING, 3).join() === '3,6', '5 is lifted by 3 and 6');
check(liftersFor(LINEOUT_LINE_THROWING, 5).join() === '6,7', '8 is lifted by 6 and 7');
check(eightPicksFromScrum(true, 5, 0, 40) && !eightPicksFromScrum(false, 5, 0, 40), '8 picks from our own feed close to their line, never from a steal');

/* ================================ MATCH ================================ */
console.log('MATCH — twelve seeds, two minutes each');
const NO_INPUT: any = { left: false, right: false, up: false, down: false, run: false, sprint: false };
let rucks = 0, observed = 0, whistled = 0, trips = 0;
const nodes: Record<string, number> = {};
let routed = 0;
for (let seed = 1; seed <= 12; seed++) {
  seedRng(seed);
  const d: any = new Director(gateConfig(6));
  let last = d.phase;
  for (let i = 0; i < 120 * 60; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    if (d.phase !== last) { if (d.phase === 'BREAKDOWN') rucks++; last = d.phase; }
  }
  observed += d.sideEntryStats.observed.A + d.sideEntryStats.observed.B;
  whistled += d.sideEntryStats.whistled.A + d.sideEntryStats.whistled.B;
  trips += d.watchdogLog.length;
  routed += d.packStats.routed.A + d.packStats.routed.B;
  for (const [k, v] of Object.entries(d.packStats.nodes)) nodes[k] = (nodes[k] ?? 0) + (v as number);
}
const rate = observed / Math.max(1, rucks);
console.log(`  rucks=${rucks} sideEntry observed=${observed} (${rate.toFixed(3)}/ruck; baseline 0.507) whistled=${whistled} trips=${trips} routedFrames=${routed}`);
check(rate < 0.507 / 4, 'observed side-entry rate is under a quarter of the pre-tree baseline');
check(whistled === 0, 'no side-entry whistles');
check(trips === 0, 'no watchdog trips');
/* Every node a CPU-v-CPU match can reach must have fired. `hunt` is the one
 * exception: a ball loose on the deck comes only from the ball-craft spill
 * (a strip or a fumbled catch under a HUMAN's hands — `engine/ballcraft.ts`
 * is human-side only), so it is proven by the PURE check above and not here. */
const expected = ['pod', 'pod-clamp', 'anchor', 'guard', 'pillar', 'blind-anchor', 'blind-carry', 'jackal-approach', 'jackal-gate', 'post', 'open-support', 'base', 'link-9', 'fold-open'];
for (const n of expected) check((nodes[n] ?? 0) > 0, `node fired in match: ${n} ×${nodes[n] ?? 0}`);
const treeSize = Object.values(FORWARD_TREES).reduce((n, t) => n + t.length, 0);
check(treeSize >= 15, `the eight trees carry ${treeSize} nodes between them`);

console.log(fails ? `\nFORWARD PACK PROBE: ${fails} FAILURE(S)` : '\nFORWARD PACK PROBE PASSES');
process.exit(fails ? 1 : 0);
