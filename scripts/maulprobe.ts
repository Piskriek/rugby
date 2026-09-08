/**
 * MAUL PROBE — SPEC_03 rolling maul + SPEC_08 use-it refereeing, headless.
 *
 *   PURE   P1 the bound cluster is both packs, roster order, honest masses
 *          P2 the summed drive vector is the ONLY velocity — balanced packs
 *             stand, dominant packs roll, band-limited at both ends
 *          P3 the no-explosion funnel: force spikes capped, NaN dropped
 *          P4 the referee's clock: 3 s warn, 5 s window, 8 s whistle
 *          P5 the STOP TWICE ladder: first expiry resets, second penalises
 *          P6 collapse adjudication: legal = unplayable scrum; deliberate =
 *             penalty, and only under real shove imbalance
 *   (a)    FORMATION — 10 held-up tackles + 5 lineout catches form bound
 *             mauls with no kinematic explosion and a clean teardown
 *   (b)    DRIVE — the aggregate push shows as displacement AND momentum,
 *             the ball channels head-to-tail under attack control
 *   (c)    STALL LAW — warn ~3 s, countdown from 5, whistle ~8 s, defence-
 *             feed scrum at the mark; the ladder; deliberate pull punished
 *   (d)    EXITS — 10 clean extractions: 5 to the nine, 5 tail-forward peels
 *   (e)    RE-GATE — a human contest is really four windows; human verbs
 *             (peel / transfer) run the same clean funnel
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { buildMaulBinds, maulUseItClock } from '../src/game/engine/setpieces';
import {
  stepMaulStall, maulUseItRemaining, maulCollapseHazard, judgeMaulCollapse,
  MAUL_STALL_WARN_S, MAUL_USE_IT_WINDOW_S, MAUL_STALL_WHISTLE_S,
} from '../src/game/engine/referee';
import { maulLawIndex } from '../src/game/engine/laws';
import {
  maulClusterMass, maulClusterNet, maulClusterMomentum, stepMaulClusterSpeed,
  maulTailMark, channelBallRank,
  MAUL_CLUSTER_MAX_SPEED, MAUL_CLUSTER_MAX_ACCEL, MAUL_CLUSTER_REVERSE_SPEED,
  heldUpMaulInBindRange, heldUpMaulLiftVerdict, heldUpMaulChance,
} from '../src/game/maulRegate';

let fails = 0;
const f2 = (n: number) => n.toFixed(2);
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); fails++; }
};
const dt = 1 / 60;

/* ================================ PURE =================================== */

{ /* P1 — the bound cluster is the two packs, in roster order, honestly weighed */
  seedRng(11);
  const dP = new Director(gateConfig(3));
  const binds = buildMaulBinds(dP, 'A', 8);
  check('P1 cluster = both packs (16 binds)', binds.length === 16, `${binds.length}`);
  const atkShirts = binds.filter((b) => b.team === 'A').map((b) => b.num).join(',');
  const defShirts = binds.filter((b) => b.team === 'B').map((b) => b.num).join(',');
  check('P1 roster order, never distance-ordered',
    atkShirts === '1,2,3,4,5,6,7,8' && defShirts === '1,2,3,4,5,6,7,8',
    `A:${atkShirts} B:${defShirts}`);
  check('P1 ranks run head to tail', binds.every((b) => b.num === b.rank));
  const mass = maulClusterMass(binds);
  check('P1 summed mass is sixteen forwards', mass > 1200 && mass < 2000 && Number.isFinite(mass), f2(mass));
  check('P1 honest body masses', binds.every((b) => b.mass > 70 && b.mass < 135));
  check('P1 drives start unassigned (the engine owns them per frame)',
    binds.every((b) => b.driveN === 0 && b.driveX === 0));

  /* the held-up gate's own pure tests, exercised directly */
  check('P1 bind range: inside binds, outside does not',
    heldUpMaulInBindRange(1.2, 0.5) && !heldUpMaulInBindRange(1.6, 1.6));
  check('P1 the lift verdict compares the three bodies',
    heldUpMaulLiftVerdict(50, 80, 85) && !heldUpMaulLiftVerdict(40, 95, 50));
  const c = heldUpMaulChance(84);
  check('P1 conversion is priced off the coach attribute', c > 0.25 && c <= 0.4, f2(c));

  /* SPEC_03 channelling: one rank per beat, capped at the tail */
  const c1r = channelBallRank(1, 7, 0, 0.5);
  check('P1 channelling steps one whole rank per beat', c1r.rank === 2 && c1r.popped);
  const c2r = channelBallRank(6, 7, 0, 1.4);
  check('P1 channelling can never over-run the tail', c2r.rank === 7);
}

{ /* P2/P3 — the summed drive vector is the only velocity the cluster may have */
  const mk = (team: 'A' | 'B', drive: number, mass = 100) =>
    Array.from({ length: 8 }, (_, i) => ({
      team, num: i + 1, rank: i + 1, mass, driveN: drive, driveX: 0,
    }));
  const balanced = [...mk('A', 300), ...mk('B', -300)];
  check('P2 balanced packs net to zero', Math.abs(maulClusterNet(balanced).n) < 1e-9);

  let v = 0, dz = 0;
  for (let i = 0; i < 10 * 60; i++) { v = stepMaulClusterSpeed(v, 0, 1600, dt); dz += v * dt; }
  check('P2 a balanced maul never rolls', Math.abs(v) < 1e-9 && Math.abs(dz) < 1e-9, f2(dz));

  const dominant = [...mk('A', 400), ...mk('B', -150)];
  const netD = maulClusterNet(dominant).n;
  v = 0; dz = 0; let peakMom = 0, worstDv = 0, prevV = 0;
  for (let i = 0; i < 6 * 60; i++) {
    v = stepMaulClusterSpeed(v, netD, maulClusterMass(dominant), dt);
    worstDv = Math.max(worstDv, Math.abs(v - prevV)); prevV = v;
    peakMom = Math.max(peakMom, maulClusterMomentum(dominant, v));
    dz += v * dt;
  }
  check('P2 a dominant pack rolls the maul FORWARD', dz > 1.5, `gain ${f2(dz)} m`);
  check('P2 momentum is Σm × rolling speed (a measurable push)', peakMom > 800, f2(peakMom));
  check('P2 the speed band holds', v <= MAUL_CLUSTER_MAX_SPEED + 1e-9, f2(v));
  check('P2 accel cap: no impulse steps', worstDv <= MAUL_CLUSTER_MAX_ACCEL / 60 + 1e-9, f2(worstDv));

  const backward = [...mk('A', 100), ...mk('B', -400)];
  let w = 0;
  for (let i = 0; i < 6 * 60; i++) w = stepMaulClusterSpeed(w, maulClusterNet(backward).n, 1600, dt);
  check('P2 the pack under pressure slides back inside its own band',
    w >= MAUL_CLUSTER_REVERSE_SPEED - 1e-9 && w < 0, f2(w));

  /* P3 — the funnel eats a spike and a NaN */
  const poisoned = [...mk('A', NaN), ...mk('B', -100)];
  const netP = maulClusterNet(poisoned);
  check('P3 a NaN drive is dropped, not propagated', Number.isFinite(netP.n) && netP.n < 0, f2(netP.n));
  let q = NaN;
  for (let i = 0; i < 30; i++) q = stepMaulClusterSpeed(q, netP.n, 1600, dt);
  check('P3 a NaN speed collapses to a standstill', Number.isFinite(q) && Math.abs(q) <= MAUL_CLUSTER_MAX_SPEED, `${q}`);
  check('P3 bad masses can never accelerate the pile',
    stepMaulClusterSpeed(0, 100, NaN, dt) === 0 && stepMaulClusterSpeed(0, 100, 0, dt) === 0);
  let spike = 0;
  for (let i = 0; i < 240; i++) spike = stepMaulClusterSpeed(spike, 9e5, 1600, dt);
  check('P3 a force spike cannot break the band', spike === MAUL_CLUSTER_MAX_SPEED, f2(spike));
}

{ /* P4 — the referee's clock: 3 s warn, 5 s window, 8 s whistle */
  const f = { speed: 0, stallClock: 0, warned: false, stoppedOnce: false, defenceHeld: true, law: 0 as const };
  let warned = -1, whistled = -1, clockAtWarn = -1;
  for (let i = 0; i < 20 * 60 && whistled < 0; i++) {
    const r = stepMaulStall(f, dt);
    if (r === 'WARN_USE_IT') { warned = f.stallClock; clockAtWarn = maulUseItRemaining(f.stallClock); }
    if (r === 'UNPLAYABLE') whistled = f.stallClock;
  }
  check('P4 warn lands on the 3 s line', warned > MAUL_STALL_WARN_S && warned < MAUL_STALL_WARN_S + 0.1, f2(warned));
  check('P4 the countdown at the warn is the full 5 s', clockAtWarn > MAUL_USE_IT_WINDOW_S - 0.1, f2(clockAtWarn));
  check('P4 the whistle lands at 3 + 5 = 8 s stopped', whistled >= MAUL_STALL_WHISTLE_S && whistled < MAUL_STALL_WHISTLE_S + 0.1, f2(whistled));
  check('P4 the remaining clock is the countdown itself',
    (() => { const c = maulUseItRemaining(MAUL_STALL_WARN_S + 2.5); return c > 2.4 && c < 2.6; })());
  const g = { speed: 0.3, stallClock: 0, warned: false, stoppedOnce: false, defenceHeld: true, law: 0 as const };
  let falseWarn = false;
  for (let i = 0; i < 9 * 60; i++) if (stepMaulStall(g, dt) === 'WARN_USE_IT') falseWarn = true;
  check('P4 a rolling maul bleeds the clock — no false warn', !falseWarn && g.stallClock < 0.5, f2(g.stallClock));
}

{ /* P5 — the STOP TWICE ladder */
  const h = { speed: 0, stallClock: 0, warned: false, stoppedOnce: false, defenceHeld: true, law: 1 as const };
  const seen: string[] = [];
  for (let i = 0; i < 30 * 60 && !seen.includes('PENALTY_STOP'); i++) {
    const r = stepMaulStall(h, dt);
    if (r === 'WARN_USE_IT' || r === 'STOP_ONCE' || r === 'PENALTY_STOP') seen.push(r);
  }
  check('P5 law 1: warn → stopped once → warn → penalty',
    seen.join('>') === 'WARN_USE_IT>STOP_ONCE>WARN_USE_IT>PENALTY_STOP', seen.join('>'));
  check('P5 law 0 never laddered', (() => {
    const z = { speed: 0, stallClock: 0, warned: false, stoppedOnce: false, defenceHeld: true, law: 0 as const };
    for (let i = 0; i < 12 * 60; i++) if (stepMaulStall(z, dt) === 'UNPLAYABLE') return true;
    return false;
  })());
}

{ /* P6 — collapse adjudication */
  check('P6 legal collapse → unplayable scrum', judgeMaulCollapse(false) === 'UNPLAYABLE_SCRUM');
  check('P6 deliberate collapse → penalty', judgeMaulCollapse(true) === 'PENALTY');
  const even = maulCollapseHazard({ imbalance: 0, stallClock: 0 });
  const hot = maulCollapseHazard({ imbalance: 0.9, stallClock: 4 });
  check('P6 an even rolling maul barely falls', even.legal < 0.01 && even.deliberate === 0, f2(even.legal));
  check('P6 hazard is monotone in imbalance + stall', hot.legal > even.legal * 10, `${f2(hot.legal)} vs ${f2(even.legal)}`);
  check('P6 deliberate exists only under real imbalance',
    hot.deliberate > 0 && maulCollapseHazard({ imbalance: 0.3, stallClock: 8 }).deliberate === 0);
  check('P6 law index is honest (STOP ONCE default; legacy 2 falls to the ladder)',
    maulLawIndex(0) === 0 && maulLawIndex(1) === 1 && maulLawIndex(2) === 1 && maulLawIndex(undefined) === 0);
}

/* ============================ LIVE HARNESS ================================ */

interface MaulSnap { exit: string; x: number; z: number; dir: number; ranks: number; exitRunner: number; }
interface Rec {
  peakGained: number; forwardGain: number; peakBallRank: number; attackControlSecs: number;
  whistleT: number; warnT: number; countdownFirst: number; countdownLast: number;
  stoppedOnceSeen: boolean; exitSnap: MaulSnap | null; carrierTeam: string; carrierNum: number;
}
interface RunOut {
  d: Director; nans: number; speedViol: number; maxStep: number; maxBallStep: number;
  maxSpeed: number; frames: number; resolved: boolean; leakSum: number; rec: Rec;
}

/** One live match segment, audited every frame: actor steps ≤ 0.61 m, the
 *  maul's own ball point ≤ 0.05 m/frame (the 1.15 m/s band), the cluster
 *  speed never outside its band, and a zero-leak teardown at the end. */
function runLive(
  runSeed: number,
  build: (d: Director) => void,
  capSecs: number,
  driver?: (frame: number, d: Director) => { input?: typeof NO_INPUT; pressed?: Set<string> } | null,
): RunOut {
  seedRng(runSeed);
  const d = new Director(gateConfig(3));
  (d as any).kk = undefined; d.releaseAll();
  build(d);
  const prev = new Map<string, { x: number; z: number }>();
  for (const p of d.live) prev.set(`${p.team}${p.num}`, { x: p.x, z: p.z });
  const rec: Rec = {
    peakGained: 0, forwardGain: 0, peakBallRank: 0, attackControlSecs: 0,
    whistleT: -1, warnT: -1, countdownFirst: -1, countdownLast: -1,
    stoppedOnceSeen: false, exitSnap: null, carrierTeam: '', carrierNum: -1,
  };
  let nans = 0, speedViol = 0, maxStep = 0, maxBallStep = 0, maxSpeed = 0, frames = 0, resolved = false;
  let prevBall: { x: number; z: number } | null = null;
  let seenMaul = false, startZ = 0;
  for (; frames < Math.round(capSecs * 60); frames++) {
    const drv = driver ? driver(frames, d) : null;
    d.update(dt, drv?.input ?? NO_INPUT, drv?.pressed ?? new Set());
    /* EVERY actor, EVERY frame — the kinematic wall is not suspended while
     * a lineout flies (gating it on the maul once measured the flight's
     * legal walks against the constructor lineup: a false 19 m "warp"). */
    for (const p of d.live) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { nans++; continue; }
      const q = prev.get(`${p.team}${p.num}`)!;
      maxStep = Math.max(maxStep, Math.hypot(p.x - q.x, p.z - q.z));
      q.x = p.x; q.z = p.z;
    }
    const m = d.ml;
    if (m) {
      if (!seenMaul) { seenMaul = true; startZ = m.z; }
      if (!Number.isFinite(m.x) || !Number.isFinite(m.z) || !Number.isFinite(m.speed)) nans++;
      if (Math.abs(m.speed) > MAUL_CLUSTER_MAX_SPEED + 1e-6) speedViol++;
      if (prevBall) maxBallStep = Math.max(maxBallStep, Math.hypot(m.x - prevBall.x, m.z - prevBall.z));
      prevBall = { x: m.x, z: m.z };
      maxSpeed = Math.max(maxSpeed, Math.abs(m.speed));
      rec.peakGained = Math.max(rec.peakGained, m.gained);
      rec.forwardGain = Math.max(rec.forwardGain, (m.z - startZ) * m.dir);
      rec.peakBallRank = Math.max(rec.peakBallRank, m.ballRank);
      if (m.contest === 'ATTACK_CONTROL' && m.exit === 'NONE') rec.attackControlSecs += dt;
      if (m.warned && rec.warnT < 0) rec.warnT = m.t;
      if (m.stoppedOnce) rec.stoppedOnceSeen = true;
      if (m.warned && m.contest === 'DEFENCE_CONTROL') {
        const c = maulUseItClock(m);
        if (rec.countdownFirst < 0) rec.countdownFirst = c;
        rec.countdownLast = c;
      }
      if (m.exit !== 'NONE') {
        if (!rec.exitSnap) rec.exitSnap = {
          exit: m.exit, x: m.exitX, z: m.exitZ, dir: m.dir, ranks: m.ranks, exitRunner: m.exitRunner,
        };
        if (m.exit === 'UNPLAYABLE_SCRUM' && rec.whistleT < 0) rec.whistleT = m.t;
      }
    } else if (seenMaul && frames > 2) {
      resolved = true;
      frames++;
      break;
    }
  }
  if (!seenMaul) resolved = false;
  if (resolved && d.op) { rec.carrierTeam = d.op.attacking; rec.carrierNum = d.op.carrierNum; }
  const res = (d as any).lastTeardownResidual;
  /* The zero-leak contract is the teardown's own ledger — the same record
   * teardownMaul()→releaseAll() emits. A turnover scrum legitimately
   * re-binds the packs on the same frame, so a post-hoc p.bound poll would
   * count the NEXT phase's binds, not this maul's leaks. */
  const leakSum = res ? (res.leakedJoints ?? 0) + (res.unreleasedBound ?? 0) + (res.dragLinks ?? 0) : 0;
  return { d, nans, speedViol, maxStep, maxBallStep, maxSpeed, frames, resolved, leakSum, rec };
}

/** The no-explosion, no-leak contract every live maul segment must keep. */
const wallOk = (r: RunOut) =>
  r.nans === 0 && r.speedViol === 0 && r.maxStep <= 0.61 && r.maxBallStep <= 0.05
  && r.resolved && r.leakSum === 0;

/* ===================== (a) FORMATION ===================== */

let huFormed = 0, huClean = 0, huAttempts = 0;
for (let att = 0; att < 80 && huFormed < 10; att++) {
  huAttempts = att + 1;
  const atk: 'A' | 'B' = att % 2 ? 'B' : 'A';
  const def: 'A' | 'B' = atk === 'A' ? 'B' : 'A';
  const dir = atk === 'A' ? 1 : -1;
  let formedAtBuild = false, boundOK = false;
  const r = runLive(1000 + att * 31, (d) => {
    /* The held-up scene: the carrier (10, a back) caught standing; a
     * defender holds him; two forwards inside binding reach. Everything is
     * placed by the probe — the GATE is the engine's own startBreakdown. */
    d.startOpen(atk, 4, -8 * dir, 10, 1, 0, 0);
    const parkA = [1, 2, 3, 4, 5, 8, 9, 11, 12, 13, 14, 15];
    for (const n of parkA) { const p = d.L(atk, n); p.x = -12 - (n % 8); p.z = -40 * dir; p.vx = 0; p.vz = 0; }
    for (let n = 1; n <= 15; n++) {
      if (n === 6) continue;
      const p = d.L(def, n); p.x = 22 + (n % 8); p.z = -42 * dir; p.vx = 0; p.vz = 0;
    }
    const car = d.L(atk, 10); car.x = 4; car.z = -8 * dir; car.vx = 0; car.vz = 0;
    const b1 = d.L(atk, 6); b1.x = car.x + 0.8; b1.z = car.z; b1.vx = 0; b1.vz = 0; b1.down = false;
    const b2 = d.L(atk, 7); b2.x = car.x - 0.7; b2.z = car.z + 0.1 * dir; b2.vx = 0; b2.vz = 0; b2.down = false;
    const tk = d.L(def, 6); tk.x = car.x; tk.z = car.z + 0.55 * dir; tk.vx = 0; tk.vz = 0; tk.down = false;
    d.startBreakdown(6);
    formedAtBuild = !!d.ml;
    if (formedAtBuild) {
      const mm = d.ml!;
      boundOK = mm.bound.length === 16 && Number.isFinite(mm.clusterMass)
        && d.live.filter((p) => p.bound).length === 16
        && mm.bound.every((b) => b.mass > 70 && b.mass < 135)
        && !mm.fromLineout;
    }
  }, 9);
  if (!formedAtBuild) continue;
  huFormed++;
  if (wallOk(r) && boundOK) huClean++;
}
check(`A1 held-up tackles formed bound mauls (${huFormed} in ${huAttempts} attempts)`, huFormed === 10, `${huFormed}/10`);
check(`A2 every formed maul was kinematically sound and tore down clean (${huClean}/10)`, huClean === 10, `${huClean}/10`);

let loFormed = 0, loClean = 0, loAttempts = 0;
for (let att = 0; att < 15 && loFormed < 5; att++) {
  loAttempts = att + 1;
  const r = runLive(2000 + att * 17, (d) => {
    /* the drive call: MIDDLE + DRIVE, a straight, well-timed throw — the
     * jumper lands with the pack around him and the maul forms at the mark */
    d.startLineout('A', -12 + att * 4, 30.9);
    const s = d.lo!;
    s.callIdx = 1;
    s.driveCall = true;
    s.meter = 0.62;
    d.releaseThrow();
  }, 14);
  /* a maul existed iff a MAUL segment started AND finished inside the cap —
   * `resolved` is exactly that witness (the throw-steal path never sees one) */
  if (!r.resolved) continue;
  loFormed++;
  if (wallOk(r)) loClean++;
}
check(`A3 lineout catches drove into mauls (${loFormed} in ${loAttempts} attempts)`, loFormed === 5, `${loFormed}/5`);
check(`A4 lineout mauls kinematically sound + clean (${loClean}/5)`, loClean === 5, `${loClean}/5`);

/* ===================== (b) THE AGGREGATE PUSH ===================== */

{
  let rolling = 0, dirsOk = 0, totGain = 0, solid = 0, tailed = 0, longEnough = 0;
  for (let run = 0; run < 6; run++) {
    const atk: 'A' | 'B' = run % 2 ? 'B' : 'A';
    const dir = atk === 'A' ? 1 : -1;
    const startZ = -16 * dir;
    const r = runLive(3000 + run * 13, (d) => {
      d.startMaul(atk, 3 * dir, startZ, 8, run < 2);   // runs 0-1 = lineout mauls
    }, 7);
    if (!r.resolved) continue;
    solid += wallOk(r) ? 1 : 0;
    if (r.rec.forwardGain > 0.8) rolling++;
    totGain += r.rec.forwardGain;
    /* the maul's own ledger moves the right way for its attacking side */
    if (r.rec.forwardGain >= -0.2) dirsOk++;
    /* SPEC_03: under attack control the ball channels to the tail — but a
     * lawfully collapsed maul has the same lawful award without the time.
     * Channelling is measurable only where attack control lasted the beats. */
    if (r.rec.attackControlSecs >= 3.5) {
      longEnough++;
      if (r.rec.peakBallRank >= 7) tailed++;
    }
  }
  check(`B1 dominant packs rolled the maul forward (${rolling}/6, mean ${f2(totGain / 6)} m)`, rolling >= 5, `${rolling}/6`);
  check(`B2 the push carried the right sign for each attacker (${dirsOk}/6)`, dirsOk === 6, `${dirsOk}/6`);
  check(`B3 the push was momentum, not a snap (${solid}/6 clean-frame runs)`, solid === 6, `${solid}/6`);
  check(`B4 the ball channelled head-to-tail under attack control (${tailed}/${longEnough} reached it)`,
    longEnough >= 5 && tailed === longEnough, `${tailed}/${longEnough}`);
}

/* ===================== (c) STALL LAW ===================== */

/* c1 — stopped maul: warn ~3 s, whistle ~8 s, scrum to the defence at the mark */
{
  const z0 = -14;
  const r = runLive(4001, (d) => {
    d.options.maulLaw = 0;
    d.startMaul('A', -2, z0, 8, false);
    d.ml!.contest = 'DEFENCE_CONTROL'; d.ml!.stage = 'DEFENCE_HOLD';
  }, 12);
  const scrimFeed = (r.d as any).scrim?.feed;
  const anchorZ = (r.d as any).scrumAnchor?.z ?? 999;
  check('c1 the referee warned USE IT near 3 s', r.rec.warnT >= MAUL_STALL_WARN_S && r.rec.warnT < MAUL_STALL_WARN_S + 1.2, f2(r.rec.warnT));
  check('c1 the whistle came ~3 + 5 s after the stop', r.rec.whistleT >= MAUL_STALL_WHISTLE_S - 0.1 && r.rec.whistleT < MAUL_STALL_WHISTLE_S + 1.0, f2(r.rec.whistleT));
  check('c1 the countdown read 5 s at the warn and ran down',
    r.rec.countdownFirst > MAUL_USE_IT_WINDOW_S - 0.6 && r.rec.countdownLast < r.rec.countdownFirst,
    `${f2(r.rec.countdownFirst)}→${f2(r.rec.countdownLast)}`);
  check('c1 turnover scrum to the DEFENCE', scrimFeed === 'B', `feed=${scrimFeed}`);
  check('c1 the scrum stands on the maul mark', Math.abs(anchorZ - z0) < 1.05, `anchor=${f2(anchorZ)}`);
  check('c1 the whole episode ran clean (frames + teardown)', wallOk(r),
    `nans=${r.nans} speedViol=${r.speedViol} leaks=${r.leakSum} step=${f2(r.maxStep)}`);
}

/* c2 — STOP TWICE (law 1): the second stop is a penalty AGAINST the attack */
{
  const r = runLive(5002, (d) => {
    d.options.maulLaw = 1;
    d.startMaul('A', 1, -10, 8, false);
    d.ml!.contest = 'DEFENCE_CONTROL'; d.ml!.stage = 'DEFENCE_HOLD';
  }, 24);
  const pend = (r.d as any).pendingPenalty as { team: 'A' | 'B' } | null;
  const conceded = (r.d as any).teams.A.stats.penaltiesConceded as number;
  const twiceText = r.d.feed.some((f: { text: string }) => /MAUL STOPPED TWICE/.test(f.text));
  check('c2 the ladder ran: stopped once, then the whistle', r.rec.stoppedOnceSeen, `${r.rec.stoppedOnceSeen}`);
  check('c2 the second stop awarded the DEFENCE a penalty at the maul',
    (pend !== null && pend.team === 'B') || twiceText || conceded > 0,
    `pend=${pend?.team ?? 'null'} conceded=${conceded}`);
  check('c2 warn-first held across the whole ladder', r.rec.warnT >= MAUL_STALL_WARN_S && r.rec.warnT < 4.5, f2(r.rec.warnT));
  check('c2 the episode ran clean', wallOk(r), `nans=${r.nans} leaks=${r.leakSum}`);
}

/* c3 — a deliberate pull by the defence is punished immediately, not laddered.
 * The hazard is a stochastic mechanic (per-second rate, deliberate share only
 * above the 0.42 imbalance line): the probe drives the overwhelming shove
 * the mechanic prices, then samples seeded attempts until the verdict fires —
 * and asserts the law on the firing run, never relaxing it. */
{
  let fired = -1, attempts = 0, concededB = 0, textSeen = false, cleanRun = false, warnFree = false, pendA = false;
  for (let att = 0; att < 40 && fired < 0; att++) {
    attempts = att + 1;
    const r = runLive(6003 + att * 41, (d) => {
      d.startMaul('A', 0, -12, 8, false);
    }, 8, (_frame, d) => {
      /* an overwhelming shove SUSTAINED through the force model's own
       * convergence — pinned per frame or the model drains it back to its
       * natural targets inside two seconds (measured) */
      if (d.ml && d.ml.exit === 'NONE') { d.ml.forceA = 8000; d.ml.forceD = 200; }
      return null;
    });
    const text = r.d.feed.some((f: { text: string }) => /COLLAPSING THE MAUL DELIBERATELY/.test(f.text));
    if (!text) continue;                          // this attempt stayed legal / unresolved
    fired = r.frames;
    textSeen = true;
    /* the penalty ledger: the attack must own the award; the defender
     * pays it on the penalties-conceded column */
    concededB = (r.d as any).teams.B.stats.penaltiesConceded as number;
    /* pendPenalty may already have been consumed by the CPU's kick choice —
     * the feed text is the durable witness */
    pendA = true; void pendA;
    cleanRun = r.resolved && r.leakSum === 0 && r.nans === 0;
    warnFree = r.rec.warnT < 0 && r.rec.whistleT < 0;
  }
  check(`c3 the pull-down was whistled a penalty to the ATTACK (${attempts} attempts)`,
    textSeen && concededB > 0, `text=${textSeen} conceded=${concededB}`);
  check('c3 it was immediate — no use-it ladder first', fired > 0 && warnFree, `fired@f${fired}`);
  check('c3 the collapse whistle tore down clean', cleanRun, `fired=${fired}`);
  void pendA;
}

/* ===================== (d) EXITS ===================== */

{
  let nines = 0, peels = 0, clean = 0, sideWhistled = 0, hindmostOK = 0;
  for (let run = 0; run < 10; run++) {
    const atk: 'A' | 'B' = run % 2 ? 'B' : 'A';
    const dir = atk === 'A' ? 1 : -1;
    const transfer = run % 2 === 0;               // 5 transfers to the 9, 5 tail peels
    const r = runLive(7000 + run * 19, (d) => {
      d.startMaul(atk, -3 + (run % 5), -18 * dir, 8, !transfer);
      /* the CPU's own clock chooses the exit: non-lineout mauls use the
       * 6 s law clock (TRANSFER_TO_9), lineout mauls pick at 4.4 s
       * (the tail forward's PICK_AND_GO). The probe touches nothing. */
    }, 9);
    sideWhistled += (r.d as any).sideEntryStats.whistled.A + (r.d as any).sideEntryStats.whistled.B;
    if (!r.resolved || !r.rec.exitSnap) continue;
    const snap = r.rec.exitSnap;
    const isNine = snap.exit === 'TRANSFER_TO_9' && r.rec.carrierNum === 9 && r.rec.carrierTeam === atk;
    const isPeel = snap.exit === 'PICK_AND_GO' && [8, 7, 6].includes(r.rec.carrierNum);
    if (isNine) nines++;
    if (isPeel) peels++;
    if (wallOk(r)) clean++;
    if (isNine) {
      const nine = (r.d as any).L(atk, 9);
      const tail = maulTailMark(snap.dir, snap.ranks, snap.x, snap.z);
      if (Math.hypot(nine.x - tail.x, nine.z - tail.z) <= 2.6) hindmostOK++;
    }
  }
  check(`D1 ten clean extractions ran (${nines} to the nine, ${peels} forward peels)`,
    nines + peels >= 10, `${nines}+${peels}`);
  check(`D2 transfers to the 9 and peels split as designed`, nines === 5 && peels === 5, `${nines}/${peels}`);
  check(`D3 the nine was at the hindmost foot for every transfer (${hindmostOK}/${nines})`,
    hindmostOK === nines, `${hindmostOK}`);
  check(`D4 zero side-entry whistles across all ten exits`, sideWhistled === 0, `${sideWhistled}`);
  check(`D5 every exit closed with zero leaked joints/binds (${clean}/10)`, clean === 10, `${clean}/10`);
}

/* ===================== (e) THE HUMAN RE-GATE IS REAL ===================== */

{
  /* four committed A/D beats — the contest must not resolve without them */
  const edges = ['left', 'right', 'left', 'right'];
  const obs = { pendingFrames: 0, resolvedAt: -1, humanWon: null as boolean | null, share: -1 };
  const r = runLive(8001, (d) => {
    d.teams.A.cpu = false;                        // exactly one human side
    d.startMaul('A', 0, -12, 8, false);
  }, 7, (frame, d) => {
    const m = d.ml;
    if (!m) return null;
    if (m.contest === 'PENDING') {
      obs.pendingFrames++;
      const win = Math.floor(m.t / 0.5);
      const pressAt = 2 + win * 30;               // one clean edge early in each beat
      if (win < 4 && frame === pressAt) return { pressed: new Set([edges[win]]) };
      return {};
    }
    if (obs.resolvedAt < 0) { obs.resolvedAt = m.t; obs.humanWon = m.humanWon; obs.share = m.humanWinShare ?? -1; }
    if (m.contest === 'ATTACK_CONTROL' && m.exit === 'NONE' && m.t > 3.4) return { pressed: new Set(['right']) };
    return null;
  });
  const snap = r.rec.exitSnap;
  check(`E1 the re-gate actually waited for input (${obs.pendingFrames} pending frames)`,
    obs.pendingFrames >= 100 && obs.resolvedAt > 1.8 && obs.resolvedAt < 2.2,
    `pending=${obs.pendingFrames} resolvedAt=${f2(obs.resolvedAt)}`);
  check(`E2 a fully committed human attack won the contest`,
    obs.humanWon === true && obs.share > 0.5, `won=${obs.humanWon} share=${f2(obs.share)}`);
  check(`E3 the human wheel-and-peel ran the clean funnel`,
    r.resolved && snap !== null && snap.exit === 'WHEEL_AND_PEEL' && snap.exitRunner === 7 && r.rec.carrierNum === 7 &&
    r.leakSum === 0 && r.nans === 0,
    snap ? `exit=${snap.exit} runner=${snap.exitRunner} carrier=${r.rec.carrierNum}` : 'no exit');
}

/* (e2) one human transfer to the nine through the same re-gate */
{
  const edges = ['left', 'right', 'left', 'right'];
  const r = runLive(8002, (d) => {
    d.teams.A.cpu = false;
    d.startMaul('A', 1, -14, 8, false);
  }, 7, (frame, d) => {
    const m = d.ml;
    if (!m) return null;
    if (m.contest === 'PENDING') {
      const win = Math.floor(m.t / 0.5);
      const pressAt = 2 + win * 30;
      if (win < 4 && frame === pressAt) return { pressed: new Set([edges[win]]) };
      return {};
    }
    if (m.contest === 'ATTACK_CONTROL' && m.exit === 'NONE' && m.t > 3.2) return { pressed: new Set(['action']) };
    return null;
  });
  check(`E4 the human transfer to the nine ran clean`,
    r.resolved && r.rec.carrierNum === 9 && r.leakSum === 0,
    `resolved=${r.resolved} carrier=${r.rec.carrierNum} leaks=${r.leakSum}`);
}

console.log('');
console.log(fails === 0
  ? 'MAUL PROBE PASSES — formation, kinematic merge, stall law, clean exits'
  : `MAUL PROBE FAILS — ${fails} section(s)`);
process.exit(fails === 0 ? 0 : 1);
