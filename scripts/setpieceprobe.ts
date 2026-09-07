/**
 * SETPIECE ORCHESTRATION PROBE — dynamic 8v8 scrums and lineouts.
 *
 *   npx tsx scripts/setpieceprobe.ts
 *
 * Three halves:
 *
 *   1. PURE. The 3-4-1 block geometry, the kinematic shove (summed mass ×
 *      drive vector × front-row stability: symmetric packs push nothing,
 *      dominance sets the sign, an unbound front row leaks), and the
 *      referee's Law-19 crooked-throw angle judgement over the throw's own
 *      flight vector.
 *
 *   2. SCRUM × 10. Ten full scrums — engagement cadence (crouch → bind →
 *      set) → the kinematic shove contest → the ball through the tunnel →
 *      the channel-8 base exit → open play. The marks sit inside twelve
 *      metres of the winning line, where the eight's pick is the law's own
 *      deterministic call, so the exit path is known in advance.
 *
 *   3. LINEOUT × 10. Ten full lineouts — the pods lift, the hooker (2)
 *      throws along the tunnel, the lock wins the aerial contest and
 *      distributes to the nine or binds for the maul drive. Run eight
 *      carries a deliberately bad meter whose throw leaves the tunnel at an
 *      angle past the referee's limit, and it must come back as a
 *      not-in-straight rethrow — and then exit clean.
 *
 * Every frame of every run is checked: zero NaN positions, zero physics
 * tunneling (no body may cover more than its velocity cap in one frame),
 * zero illegal side entries in the referee's own ledger, and every set
 * piece must resolve in a clean phase transition with no penalty whistle.
 * Exit code 0 on pass.
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { scrumBlock } from '../src/game/behaviour/setpiece-overrides';
import {
  scrumShoveNet, scrumTunnelVelocity, shoveTransmission, SCRUM_MASS_REF,
  LINEOUT_METER_DEV_M,
  type PackShove,
} from '../src/game/engine/setpieces';
import {
  forwardMass, eightPicksFromScrum, liftersFor,
  LINEOUT_LINE_THROWING, lineoutRole,
} from '../src/game/engine/forwardPack';
import {
  judgeLineoutThrow, LINEOUT_THROW_ANGLE_LIMIT,
} from '../src/game/engine/referee';

let fails = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg);
};

/* ================================ PURE ================================ */
console.log('PURE — the 3-4-1 block');
{
  const slots = scrumBlock(4, 40);
  check(slots.length === 16, `the scrum holds sixteen men (${slots.length})`);
  for (const team of ['A', 'B'] as const) {
    const pack = slots.filter((s) => s.team === team);
    const rows: Record<number, number> = {};
    for (const s of pack) rows[s.row] = (rows[s.row] ?? 0) + 1;
    check(rows[1] === 3 && rows[2] === 4 && rows[3] === 1,
      `${team} is 3-4-1: front ${rows[1]}, line ${rows[2]}, base ${rows[3]}`);
    const byRow = (r: number) => pack.filter((s) => s.row === r);
    const z1 = Math.min(...byRow(1).map((s) => s.z - 40)) * (team === 'A' ? -1 : 1);
    const z2 = Math.min(...byRow(2).map((s) => s.z - 40)) * (team === 'A' ? -1 : 1);
    const z3 = Math.min(...byRow(3).map((s) => s.z - 40)) * (team === 'A' ? -1 : 1);
    check(z1 < z2 && z2 < z3, `${team} rows stack away from the mouth (front ${z1.toFixed(2)} < line ${z2.toFixed(2)} < base ${z3.toFixed(2)} m)`);
    const eight = byRow(3)[0];
    check(eight.num === 8, `${team} base is the eight`);
  }
  /* head-on: A from −z, B from +z, and the nearest men of the two packs
     (the props) are a legal binding distance apart, never overlapping. */
  const a = slots.filter((s) => s.team === 'A'), b = slots.filter((s) => s.team === 'B');
  const aMouth = Math.min(...a.map((s) => s.z - 40));
  const bMouth = Math.min(...b.map((s) => s.z - 40));
  check(aMouth < 0 && bMouth > 0, `the packs meet head-on (A from ${aMouth.toFixed(2)} m, B from ${bMouth.toFixed(2)} m of the mark)`);
  let minPair = Infinity;
  for (const p of a) for (const q of b) minPair = Math.min(minPair, Math.hypot(p.x - q.x, p.z - q.z));
  check(minPair > 0.4, `nearest cross-pack binding is ${minPair.toFixed(2)} m apart (no interpenetration)`);
}

console.log('PURE — the kinematic shove');
{
  const ref: PackShove = { mass: SCRUM_MASS_REF, drive: 16000, stability: 1 };
  check(scrumShoveNet(ref, { ...ref }, 'A') > 0 && scrumShoveNet(ref, { ...ref }, 'B') < 0,
    'equal packs: the put-in side edges the shove (and the sign flips with the feed)');
  const weak = { ...ref, drive: 12000 };
  check(scrumShoveNet(ref, weak, 'A') > 0, 'the stronger pack wins the shove');
  check(scrumShoveNet(weak, ref, 'B') < 0, '…and it is the A-vs-B sign, not a magnitude, that is at stake');
  const heavy = { ...ref, mass: SCRUM_MASS_REF * 1.25 };
  const netLight = scrumShoveNet(ref, weak, 'A');
  const netHeavy = scrumShoveNet(heavy, weak, 'A');
  check(netHeavy < netLight && netHeavy > 0,
    `the same drive costs more per kilogram in a heavy pack (${netLight.toFixed(3)} → ${netHeavy.toFixed(3)})`);
  check(Math.abs(shoveTransmission(1) - shoveTransmission(0) - 0.3) < 1e-9
    && Math.abs(shoveTransmission(0) - 0.7) < 1e-9 && Math.abs(shoveTransmission(1) - 1) < 1e-9,
    'an unbound front row leaks 30% of the drive');
  const netBound = scrumShoveNet({ ...ref, stability: 1 }, weak, 'A');
  const netSloppy = scrumShoveNet({ ...ref, stability: 0 }, weak, 'A');
  check(netBound > netSloppy, `stability transmits: bound ${netBound.toFixed(3)} > sloppy ${netSloppy.toFixed(3)}`);
  check(scrumTunnelVelocity(1) === 0.42 && scrumTunnelVelocity(-1) === -0.42, 'the tunnel velocity target is the net × 0.42, both ways');
  check(forwardMass(100) - forwardMass(0) === 22 && forwardMass(75) > 100, 'a forward weighs 88 + PWR·0.22 kg');
  check(Math.abs(scrumShoveNet(ref, weak, 'A') - scrumShoveNet({ ...ref }, { ...weak }, 'A')) < 1e-12, 'the contest is pure: no hidden state, no RNG');
}

console.log('PURE — the crooked throw, judged by the referee');
{
  check(!judgeLineoutThrow(0), 'a throw down the tunnel is straight');
  check(!judgeLineoutThrow(LINEOUT_THROW_ANGLE_LIMIT * 0.99), 'an angle just inside the limit is straight');
  check(judgeLineoutThrow(LINEOUT_THROW_ANGLE_LIMIT * 1.01), 'an angle past the limit is not in straight');
  check(Math.abs(LINEOUT_THROW_ANGLE_LIMIT - 15 * Math.PI / 180) < 1e-9, 'the limit is fifteen degrees');
  /* the meter's geometry: the same offset the probe forces into run eight
     must clear the limit on the shortest (front) call, and a LEGEND hooker's
     natural meter (±0.035) must never come near it. */
  const forced = Math.atan2(Math.abs(0.32 - 0.62) * LINEOUT_METER_DEV_M / 1.15, Math.abs((31.2 - 1.8 * 0.72 - 33.5) / 1.15));
  check(judgeLineoutThrow(forced), `the forced meter throws at ${(forced * 180 / Math.PI).toFixed(1)}° — past the limit`);
  const natural = Math.atan2(Math.abs(0.62 - 0.585) * LINEOUT_METER_DEV_M / 1.15, Math.abs((31.2 - 1.8 * 0.72 - 33.5) / 1.15));
  check(!judgeLineoutThrow(natural), `a LEGEND hooker's best-case natural meter is ${(natural * 180 / Math.PI).toFixed(1)}° — inside`);
}

console.log('PURE — the pods and the pick');
{
  const jumpers = LINEOUT_LINE_THROWING.filter((n) => lineoutRole(n) === 'JUMPER');
  check(jumpers.join() === '4,5,8', `the jumpers are 4, 5 and 8 (${jumpers.join()})`);
  check(liftersFor(LINEOUT_LINE_THROWING, LINEOUT_LINE_THROWING.indexOf(4)).join() === '1,3', 'the front jumper (4) is lifted by 1 and 3');
  check(liftersFor(LINEOUT_LINE_THROWING, LINEOUT_LINE_THROWING.indexOf(5)).join() === '3,6', 'the back jumper (5) is lifted by 3 and 6');
  check(eightPicksFromScrum(true, 10, 4, 40) && !eightPicksFromScrum(false, 10, 4, 40), 'inside twelve metres of their own line the eight picks; a steal is never his');
}

/* ============================ THE HARNESS ============================ */

const NO_INPUT: any = { left: false, right: false, up: false, down: false, run: false, sprint: false };
const DT = 1 / 60;
/** No body may cover more than this in one frame. A legal run is under 8 m/s
 *  (0.13 m/frame); the engine's own largest single-frame write is the
 *  startOpen close-place, capped at 0.55 m by SPEC_05 — so the tunneling cap
 *  sits just above it, and anything that is a whole-gap snap or a
 *  NaN-recovery teleport (metres, in one frame) still blows past it. */
const TUNNEL_CAP_M = 0.60;

function ballPoints(d: any): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  if (d.op) out.push({ x: d.op.carrierX, z: d.op.carrierZ });
  if (d.bd && d.bd.ball) out.push({ x: d.bd.ball.x, z: d.bd.ball.z });
  if (d.ml) out.push({ x: d.ml.x, z: d.ml.z });
  if (d.lo && d.lo.ball) out.push({ x: d.lo.ball.x, z: d.lo.ball.z });
  if (d.scrim && d.scrim.ball) out.push({ x: d.scrumAnchor.x + d.scrim.ball.x, z: d.scrumAnchor.z + d.scrim.ball.z + d.scrim.netDrive });
  if (d.kk) out.push({ x: d.kk.bx, z: d.kk.bz });
  if (d.ref) out.push({ x: d.ref.x, z: d.ref.z });
  return out;
}

/**
 * One run of the engine: step until the set piece has resolved to open play
 * (a maul or re-award in the chain is followed through), checking every
 * frame. Returns everything the assertions need.
 */
function runSetPiece(
  seed: number, start: (d: any) => void,
): {
  nans: number; maxStep: number; maxBallStep: number;
  penaltyCalls: string[]; sideWhistled: number; sideObserved: number;
  watchdog: number; ticks: number; terminalPhase: string;
  resolved: boolean; carrierNum: number; picks: number;
  loInstances: number; maulInstances: number;
} {
  seedRng(seed);
  const d: any = new Director(gateConfig(6));
  const penCalls: string[] = [];
  const origPen = d.beginPenalty.bind(d);
  d.beginPenalty = (team: string, call: string, num: number, free?: boolean) => {
    penCalls.push(call);
    return origPen(team, call, num, free);
  };

  let nans = 0, maxStep = 0, maxBallStep = 0, watchdog = 0;
  let prev: { x: number; z: number }[] | null = null;
  let prevBall: { x: number; z: number } | null = null;
  let prevBallOwner: any = null;
  let lastPhase = d.phase;
  let loInstances = d.lo ? 1 : 0;
  let loSeen = d.lo;
  let maulInstances = d.ml ? 1 : 0;
  let mlSeen = d.ml;
  let carrierNum = 0;
  let terminalPhase = '';
  let resolved = false;

  start(d);
  const BUDGET = 60 * 40;
  let ticks = 0;
  for (let i = 0; i < BUDGET; i++) {
    ticks++;
    d.update(DT, NO_INPUT, new Set());
    /* NaN audit — the thirty, the ball of whatever phase owns it, the ref. */
    for (const p of d.live) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) nans++;
    }
    for (const b of ballPoints(d)) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) nans++;
    }
    /* tunnel audit — per-frame displacement, players and ball alike. */
    if (prev) {
      for (let k = 0; k < d.live.length; k++) {
        const step = Math.hypot(d.live[k].x - prev[k].x, d.live[k].z - prev[k].z);
        if (step > maxStep) maxStep = step;
      }
    }
    /* the ball's step is only measured while the same phase object owns it:
       a rethrow (a new lineout instance) or a phase hand-off is a new ball,
       not a teleport of the old one. */
    const balls = ballPoints(d);
    const owner = d.op ?? d.bd ?? d.ml ?? d.lo ?? d.scrim ?? d.kk ?? null;
    if (prevBall && balls.length && owner !== null && owner === prevBallOwner) {
      const step = Math.hypot(balls[0].x - prevBall.x, balls[0].z - prevBall.z);
      if (step > maxBallStep) maxBallStep = step;
    }
    prev = d.live.map((p: any) => ({ x: p.x, z: p.z }));
    prevBall = balls.length ? { ...balls[0] } : null;
    prevBallOwner = owner;
    /* the phase book — a rethrow swaps the lineout instance, an exit
       hands the ball to a carrier. */
    if (d.lo && d.lo !== loSeen) { loInstances++; loSeen = d.lo; }
    if (d.ml && d.ml !== mlSeen) { maulInstances++; mlSeen = d.ml; }
    if (d.phase !== lastPhase) {
      if (lastPhase === 'SCRUM' || lastPhase === 'LINEOUT' || lastPhase === 'MAUL') {
        if (d.phase === 'OPEN_PLAY' && d.op) {
          resolved = true;
          carrierNum = d.op.carrierNum;
          terminalPhase = d.phase;
        } else if (d.phase === 'KICK' || d.phase === 'TRY' || d.phase === 'FANFARE') {
          resolved = true;
          terminalPhase = d.phase;
        }
      }
      lastPhase = d.phase;
    }
    watchdog = d.watchdogLog.length;
    if (resolved) break;
  }
  /* a short open-play tail: the exit must not explode on its first
     phases. */
  for (let i = 0; i < 60 * 4 && resolved; i++) {
    d.update(DT, NO_INPUT, new Set());
    for (const p of d.live) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) nans++;
    }
    if (prev) {
      for (let k = 0; k < d.live.length; k++) {
        const step = Math.hypot(d.live[k].x - prev[k].x, d.live[k].z - prev[k].z);
        if (step > maxStep) maxStep = step;
      }
    }
    prev = d.live.map((p: any) => ({ x: p.x, z: p.z }));
    watchdog = d.watchdogLog.length;
  }
  const se = d.sideEntryStats;
  return {
    nans, maxStep, maxBallStep,
    penaltyCalls: penCalls,
    sideWhistled: se.whistled.A + se.whistled.B,
    sideObserved: se.observed.A + se.observed.B,
    watchdog, ticks,
    terminalPhase: terminalPhase || lastPhase,
    resolved, carrierNum,
    picks: d.feed.filter((f: any) => f.text.includes('EIGHT PICKS')).length,
    loInstances, maulInstances,
  };
}

/* ============================ 10 × SCRUM ============================ */
console.log('SCRUM × 10 — engage → shove → channel 8 → open play');
{
  let totalNans = 0, worstStep = 0, worstBall = 0, totalWhistles = 0, totalSide = 0, totalWatch = 0;
  let clean = 0, picks = 0;
  for (let i = 0; i < 10; i++) {
    const feed = i % 2 === 0 ? 'A' : 'B';
    /* inside twelve metres of the winning line: A's line is +50 (A attacks
     * +z), B's is −50. The eight's pick is deterministic there. */
    const az = feed === 'A' ? 40 + (i % 5) : -40 - (i % 5);
    const ax = i % 2 === 0 ? 4 : -4;
    const r = runSetPiece(3000 + i, (d) => d.startScrum(feed, ax, az));
    totalNans += r.nans;
    worstStep = Math.max(worstStep, r.maxStep);
    worstBall = Math.max(worstBall, r.maxBallStep);
    totalWhistles += r.penaltyCalls.length;
    totalSide += r.sideWhistled;
    totalWatch += r.watchdog;
    const cleanRun = r.resolved
      && r.nans === 0
      && r.maxStep <= TUNNEL_CAP_M && r.maxBallStep <= TUNNEL_CAP_M
      && r.penaltyCalls.length === 0
      && r.sideWhistled === 0
      && r.watchdog === 0
      && (r.carrierNum === 8 || r.carrierNum === 9);
    if (cleanRun) clean++;
    if (r.carrierNum === 8) picks++;
    console.log(`  scrum ${i + 1}/10  feed ${feed} @ (${ax}, ${az})  → ${r.terminalPhase} off ${r.carrierNum || '—'}${r.picks ? ' (EIGHT PICKS)' : ''}  step ${r.maxStep.toFixed(3)} m  pen ${r.penaltyCalls.length}${r.penaltyCalls.length ? ' ' + r.penaltyCalls.join('|') : ''}`);
    if (!cleanRun) {
      fails++;
      console.log(`  FAIL scrum ${i + 1}: resolved=${r.resolved} nans=${r.nans} step=${r.maxStep.toFixed(3)} ball=${r.maxBallStep.toFixed(3)} pen=[${r.penaltyCalls.join(', ')}] side=${r.sideWhistled} watchdog=${r.watchdog} carrier=${r.carrierNum}`);
    }
  }
  check(clean === 10, `10/10 scrums exit clean to open play (off 8 or 9, no whistle)`);
  check(picks >= 7, `the channel-8 exit was the law's: ${picks}/10 picked by the eight`);
  check(totalNans === 0, `0 NaN positions across all scrums (${totalNans})`);
  check(worstStep <= TUNNEL_CAP_M, `0 player tunneling (worst step ${worstStep.toFixed(3)} m ≤ ${TUNNEL_CAP_M})`);
  check(worstBall <= TUNNEL_CAP_M, `0 ball tunneling (worst step ${worstBall.toFixed(3)} m ≤ ${TUNNEL_CAP_M})`);
  check(totalWhistles === 0, `0 penalty whistles across all scrums (${totalWhistles})`);
  check(totalSide === 0, `0 side entries whistled in scrum binds and their exits (${totalSide})`);
  check(totalWatch === 0, `0 watchdog trips across all scrums (${totalWatch})`);
}

/* ============================ 10 × LINEOUT ============================ */
console.log('LINEOUT × 10 — pod lift → throw → catch → distribution/maul');
{
  let totalNans = 0, worstStep = 0, worstBall = 0, totalWhistles = 0, totalSide = 0, totalWatch = 0;
  let clean = 0, mauls = 0, notStraight = 0;
  for (let i = 0; i < 10; i++) {
    const thrower = i % 2 === 0 ? 'A' : 'B';
    const side = thrower === 'A' ? 1 : -1;
    const z = thrower === 'A' ? 28 + (i % 5) * 2 : -28 - (i % 5) * 2;
    const x = side * 31.5;
    const isForced = i === 7;
    let forcedDone = false;
    const r = runSetPiece(4000 + i, (d) => {
      if (isForced) {
        /* Run eight: the first release is metered badly — early enough that
         * the quality test (0.25) passes, but the flight leaves the tunnel
         * past the referee's angle limit, so only Law 19 can catch it. */
        const origRelease = d.releaseThrow.bind(d);
        d.releaseThrow = () => {
          const s = d.lo;
          if (!forcedDone && s) {
            forcedDone = true;
            s.call = { targetX: s.side * (31.2 - 1.8 * 0.72), label: 'FRONT BALL', jumpers: 4, kind: 'FRONT' };
            s.meter = 0.32;
          }
          origRelease();
        };
      }
      d.startLineout(thrower, z, x);
    });
    totalNans += r.nans;
    worstStep = Math.max(worstStep, r.maxStep);
    worstBall = Math.max(worstBall, r.maxBallStep);
    totalWhistles += r.penaltyCalls.length;
    totalSide += r.sideWhistled;
    totalWatch += r.watchdog;
    /* A crooked throw does not stop play with a penalty: the referee
     * re-awards the lineout to the other side — a NEW throw instance. The
     * instance swap is the flag this probe counts. */
    const rethrows = r.loInstances - 1;
    notStraight += rethrows;
    if (r.maulInstances > 0) mauls++;
    const cleanRun = r.resolved
      && r.nans === 0
      && r.maxStep <= TUNNEL_CAP_M && r.maxBallStep <= TUNNEL_CAP_M
      && r.sideWhistled === 0
      && r.watchdog === 0
      && r.penaltyCalls.length === 0
      && (isForced ? rethrows === 1 : rethrows === 0);
    if (cleanRun) clean++;
    console.log(`  lineout ${i + 1}/10  to ${thrower} @ (${x}, ${z})${isForced ? ' [forced crooked meter]' : ''}  → ${r.terminalPhase}${r.maulInstances ? ' (via maul)' : ''}  throws=${r.loInstances}  step ${r.maxStep.toFixed(3)} m  pen ${r.penaltyCalls.length}${r.penaltyCalls.length ? ' ' + r.penaltyCalls.join('|') : ''}`);
    if (!cleanRun) {
      fails++;
      console.log(`  FAIL lineout ${i + 1}: resolved=${r.resolved} nans=${r.nans} step=${r.maxStep.toFixed(3)} ball=${r.maxBallStep.toFixed(3)} pen=[${r.penaltyCalls.join(', ')}] side=${r.sideWhistled} watchdog=${r.watchdog} terminal=${r.terminalPhase}`);
    }
  }
  check(clean === 10, '10/10 lineouts resolve clean (catch → distribution/maul, no hard whistle)');
  check(notStraight === 1, `the referee flagged exactly the one crooked throw (${notStraight} not-in-straight calls)`);
  check(mauls >= 1, `the bind-and-drive path fired: ${mauls}/10 lineouts handed the ball to the maul`);
  check(totalNans === 0, `0 NaN positions across all lineouts (${totalNans})`);
  check(worstStep <= TUNNEL_CAP_M, `0 player tunneling (worst step ${worstStep.toFixed(3)} m ≤ ${TUNNEL_CAP_M})`);
  check(worstBall <= TUNNEL_CAP_M, `0 ball tunneling (worst step ${worstBall.toFixed(3)} m ≤ ${TUNNEL_CAP_M})`);
  check(totalWhistles === 0, `no hard penalty whistles anywhere — the crooked throw is re-awarded, not punished (${totalWhistles})`);
  check(totalSide === 0, `0 side entries whistled in lineout binds and their exits (${totalSide})`);
  check(totalWatch === 0, `0 watchdog trips across all lineouts (${totalWatch})`);
}

console.log(fails ? `\nSETPIECE PROBE: ${fails} FAILURE(S)` : '\nSETPIECE PROBE PASSES');
process.exit(fails ? 1 : 0);
