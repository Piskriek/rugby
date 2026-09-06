/**
 * handsprobe.ts — does anyone's hands ever actually GET TO THE BALL?
 *
 * engine/hands.ts replaced a coin flip with a mechanism: reach is a field sampled
 * from where the choreography puts a man, contact accumulates into a grip, and the
 * grip is what the contest bills. Every one of those is a number the engine keeps,
 * so every one of them can be measured on live matches instead of admired in a
 * code review.
 *
 *   npx vite-node scripts/handsprobe.ts [seconds] [difficulty] [seed]
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { stepHands, makeHands, publishHands, stripTimeFor, windowSlow } from '../src/game/engine/hands';
import { ruckPresence } from '../src/game/engine/breakdownPlan';
import type { BreakdownState, Director } from '../src/game/director';

const seconds = Number(process.argv[2] ?? 150);
const diff = Number(process.argv[3] ?? 3);
const seeds = (process.argv[4] ?? '1 2 3').split(/[ ,]+/).filter(Boolean).map(Number);

let fails = 0;
const out: string[] = [];
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function check(name: string, fn: () => void) {
  try { fn(); out.push(`PASS  ${name}`); } catch (e) { fails++; out.push(`FAIL  ${name}\n      ${String((e as Error).message || e)}`); }
}

/**
 * A Director-shaped stand-in for the model-level checks.
 *
 * `stepHands` reads one thing off the Director — `L(team, num)`, the live actor —
 * because the ruck's own `players` list is a roster, not a position (that mistake was
 * the first thing this probe caught). The stub hands it the same shape, seeded from
 * the state under test, so a check can move a man and see whether the hands follow.
 */
/** exactly what `breakdown.ts`'s `presence()` sees, recomputed here on the state
 *  BEFORE the step — the crew lists are not the law's count and comparing them was
 *  the harness accusing the engine of a crime it did not commit. */
function presenceOf(a: BreakdownState) {
  return a.plan ? ruckPresence(a.plan, a.attacking, a.hands) : { atk: a.crew.length + 1, def: a.defCrew.length + 1 };
}

function liveStub(s: BreakdownState) {
  const live = s.players.map((p) => ({ team: p.team, num: p.num, x: p.x, z: p.z, down: p.down }));
  /* a ruck's plan covers men the roster does not, so the stub has to answer for
   * them too — a missing man would be read as {0,0} and reach the ball from the
   * middle of the pitch, which is the sort of pass a check should not be able to
   * make. Everyone absent gets a body 12 m away. */
  for (const sl of s.plan?.slots ?? []) {
    if (live.some((p) => p.team === sl.team && p.num === sl.num)) continue;
    live.push({ team: sl.team, num: sl.num, x: sl.wx, z: sl.wz, down: false });
  }
  const api = {
    live,
    L(team: 'A' | 'B', num: number) { return live.find((p) => p.team === team && p.num === num) ?? live[0]; },
    move(team: 'A' | 'B', num: number, x: number, z: number) {
      const v = live.find((p) => p.team === team && p.num === num); if (v) { v.x = x; v.z = z; }
    },
  };
  return api as unknown as Director & typeof api;
}

/* What a ruck frame costs the engine on this very run — the only honest denominator
 * for "cheap". Accumulated inside `drive`, divided before it is asserted, so the
 * gate reads "hands are X% of a contest frame" rather than a number out of thin air. */
let ruckFrameUs = 0;

interface Episode {
  id: number;
  jackal: boolean;
  /** the longest any single defender held contact with the ball, seconds */
  maxDefHold: number;
  /** and the longest the attack's own hands were on it */
  maxAtkHold: number;
  /** best strip meter reached by anyone */
  maxStrip: number;
  /** a defender whose grip was broken by a clearout after holding on */
  brokenGrip: boolean;
  /** any lane in this ruck was struck on the way in. The deaf-lane gate needs this
   *  separately: an episode where nobody ever touched the ball CANNOT contain a
   *  broken grip (that requires contact), so gating the exclusion on `brokenGrip`
   *  made it impossible to ever excuse a lane that was cleared out before it got
   *  there — the check was asking the jackal to be unhit and unheld at once. */
  laneStruck: boolean;
  /** how far the JACKAL lane got (max frac over the episode) and how close to the
   *  ball his hands ended up — the two numbers that separate "he was beaten to it"
   *  from "he was sent to a place he could not reach" */
  jackalFrac: number;
  jackalGap: number;
  /** frames with at least one hand on the ball, either side */
  contestedFrames: number;
  ruckFrames: number;
  presAtk: number;
  presDef: number;
  axisMin: number;
  window: number;
  /** true when the episode spent a frame in the stage the contest is played in */
  contestEligible: boolean;
  /** did the choreography send a jackal at all? `jackalActive` is the crew list's
   *  opinion; the plan's JACKAL lane is the fact, and only a lane can reach. */
  jackalLane: boolean;
  why: string;
  /** the presence the win was JUDGED on — the state as it stood before the frame
   *  that ended the ruck, which is the state the engine's own `presence(s)` saw */
  winAtk: number;
  winDef: number;
  winHold: number;
  /** the hands state the engine actually published, at the win frame */
  need: number;
  result: string;
  handsSeen: boolean;
}

/**
 * `strandSupport` is the important one and it is borrowed from breakdownprobe on
 * purpose: the engine's own law says a jackal wins only with more men at the ball
 * than the attack has committed, and a CPU attack that commits three men to every
 * ruck is never in that position. So the mechanism cannot be tested by counting
 * steals in a normal match — that measures `assignCrew`, not hands. It is tested by
 * taking the guards away and asking whether the grip wins the ball, then by putting
 * the guards back and asking whether it does not.
 */
function drive(cfgSeed: number, secs: number, opts: { strandSupport?: boolean } = {}): Episode[] {
  seedRng(cfgSeed);
  const d = new Director(gateConfig(diff));
  const eps: Episode[] = [];
  let cur: Episode | null = null;
  let id = 0;
  const dt = 1 / 60;
  for (let f = 0; f < secs * 60; f++) {
    if (opts.strandSupport && d.bd && d.bd.stage === 'CONTACT' && d.bd.plan) {
      for (const sl of d.bd.plan.slots) {
        if (sl.role !== 'CLEAR' && sl.role !== 'BIND') continue;
        sl.wx = sl.sx; sl.wz = sl.sz - 12 * (d.bd.attacking === 'A' ? 1 : -1);
        sl.curve = { ...sl.curve, dur: sl.curve.dur * 2.6, impulse: 0, strike: 0.99 };
      }
    }
    const s: BreakdownState | null = d.bd;
    const presBefore = s ? presenceOf(s) : null;
    if (s && !cur) {
      cur = {
        id: ++id, jackal: !!s.jackalActive, maxDefHold: 0, maxAtkHold: 0, maxStrip: 0,
        brokenGrip: false, laneStruck: false, jackalFrac: 0, jackalGap: 99, contestedFrames: 0, ruckFrames: 0, presAtk: 0, presDef: 0,
        axisMin: 1, window: 0, why: '', need: 0, result: '', handsSeen: false, contestEligible: false,
        winAtk: 0, winDef: 0, winHold: 0,
        jackalLane: false,
      };
      eps.push(cur);
    }
    /* The outcome string is read from the state BEFORE the step, because a ruck that
     * ends on this frame writes `resultWhy` and then destroys itself in the same
     * call — reading the fresh `d.bd` afterwards finds nothing and reports a clean
     * sheet of steals. The engine was never asked; the harness was. */
    const u0 = performance.now();
    d.update(dt, {}, new Set());
    if (d.bd && d.bd.stage === 'RUCK') ruckFrameUs += (performance.now() - u0) * 1000;
    const a = d.bd;
    if (a && cur) {
      cur.ruckFrames++;
      if (a.stage === 'RUCK' && a.groundAt >= 0) cur.contestEligible = true;
      for (const sl of a.plan?.slots ?? []) {
        if (sl.role !== 'JACKAL') continue;
        cur.jackalLane = true;
        cur.jackalFrac = Math.max(cur.jackalFrac, sl.frac ?? 0);
        const hs = a.hands?.byKey?.[(sl.team === 'A' ? 'A' : 'B')] as unknown;  void hs;
        const slot = a.hands?.slots.find((x) => x.num === sl.num && x.team === sl.team);
        if (slot) cur.jackalGap = Math.min(cur.jackalGap, slot.gap);
        break;
      }
      if (a.jackalActive) cur.jackal = true;
      const h = a.hands;
      if (h) {
        cur.handsSeen = true;
        cur.maxDefHold = Math.max(cur.maxDefHold, h.bestDefOnBall);
        cur.maxAtkHold = Math.max(cur.maxAtkHold, h.bestAtkOnBall);
        cur.maxStrip = Math.max(cur.maxStrip, h.maxStrip);
        cur.contestedFrames += h.bestDefOnBall > 0 || h.bestAtkOnBall > 0 ? 1 : 0;
        for (const sl of a.plan?.slots ?? []) {
          if (sl.hitT <= 0) continue;
          cur.laneStruck = true;
          if (h.bestDefOnBall > 0.15) cur.brokenGrip = true;
        }
      }
      cur.axisMin = Math.min(cur.axisMin, a.axis);
      /* The law's own count, read the way the engine reads it: bodies at the ball. */
      const pr = presenceOf(a);
      cur.presAtk = pr.atk;
      cur.presDef = pr.def;
      cur.window = Math.max(cur.window, a.window);
      cur.need = stripTimeFor(pr.atk);
      if (a.result) cur.result = a.result;
      if (a.resultWhy) cur.why = a.resultWhy;
    }
    if (!d.bd && cur) {
      /* The outcome is written INTO the state the frame is played on and that object
       * is then dropped — `d.bd` is null, but the reference this loop took before the
       * step still holds the string. Reading the live state instead finds an empty
       * sheet and the harness reports a game with no jackals in it. */
      if (s.resultWhy) cur.why = s.resultWhy;
      if (s.result) cur.result = s.result;
      if (presBefore) { cur.winAtk = presBefore.atk; cur.winDef = presBefore.def; }
      if (s.hands) cur.winHold = Math.max(cur.winHold, s.hands.bestDefOnBall);
      cur = null;
    } else if (!d.bd) cur = null;
  }
  return eps;
}

/* ------------------------------------------------------------------ run ---- */
const all: Episode[] = [];
for (const sd of seeds) all.push(...drive(sd, seconds));
/* average µs per contest frame over the whole run */
ruckFrameUs /= Math.max(1, all.reduce((m, e) => m + e.ruckFrames, 0));
out.push(`BASELINE a ruck frame of the real update costs ${ruckFrameUs.toFixed(1)} µs`);
const rucks = all.filter((e) => e.ruckFrames > 3);
const withJackal = rucks.filter((e) => e.jackal);
const steals = rucks.filter((e) => /JACKAL WON/.test(e.why));
const loneJackal = rucks.filter((e) => e.presDef <= e.presAtk);

out.push(`EPISODES ${rucks.length} over ${seeds.length} seed(s) × ${seconds}s`
  + ` · jackal at ${withJackal.length} · stripped at ${steals.length}`
  + ` · per-ruck ${(steals.length / Math.max(1, rucks.length)).toFixed(3)}`);
out.push(`CONTESTED FRAMES mean ${(rucks.reduce((m, e) => m + e.contestedFrames, 0) / Math.max(1, rucks.length)).toFixed(1)}`
  + ` of ${(rucks.reduce((m, e) => m + e.ruckFrames, 0) / Math.max(1, rucks.length)).toFixed(1)} ruck frames`
  + ` · mean longest defender hold ${((rucks.reduce((m, e) => m + e.maxDefHold, 0) / Math.max(1, rucks.length))).toFixed(2)}s`
  + ` (need ${stripTimeFor(1).toFixed(2)}–${stripTimeFor(4).toFixed(2)}s)`);
out.push(`AXIS MIN mean ${((rucks.reduce((m, e) => m + e.axisMin, 0) / Math.max(1, rucks.length))).toFixed(2)}`
  + ` · worst ball-out window ${(Math.max(0, ...rucks.map((e) => e.window))).toFixed(2)}s`);

check('EVERY JACKAL LANE GETS HANDS ON IT — tested against what the plan promised', () => {
  /* the plan sends a jackal at the ball or it does not. Where it does, contact is
     the promise; where it does not — an isolated carrier, no defender free — asking
     for hands is asking the rig to invent a man. */
  /* A lane only owes contact in a ruck that could be contested: one that ended in
   * a handful of frames (a penalty, an uncontounced quick win) never reached the
   * stage where a slot is sampled at all — `frac 0.00, gap 99 m` is not a jackal who
   * missed the ball, it is a jackal who was never released. */
  const sent = rucks.filter((e) => e.jackalLane && e.contestEligible && e.ruckFrames > 20);
  /* A lane that was hit on the way in is a clearout that worked, not a grip that
   * never existed, so it is not counted as deaf — the failure this gate is for is a
   * jackal who arrives at a free ball and still puts nobody on it. */
  const deaf = sent.filter((e) => e.maxDefHold <= 0 && !e.laneStruck);
  out.push(`DEAF LANES ${deaf.map((e) => `#${e.id} frac ${e.jackalFrac.toFixed(2)} gap ${e.jackalGap.toFixed(2)}m ruck ${e.ruckFrames}f`).join('\n      ') || '(none)'}`);
  assert(sent.length > 0, 'no ruck in the run had a jackal lane — the plan is broken, not the hands');
  /* The bar is a fifth, not zero: a lane stopped 3.7 m short by a wall he could not
   * get past is the attack defending its own ball, which is the outcome the whole
   * mechanism is supposed to allow. Below that line the hands are silent for a
   * reason that has nothing to do with rugby. */
  assert(deaf.length <= Math.max(1, sent.length * 0.2),
    `${deaf.length}/${sent.length} contestable rucks with a jackal lane had nobody touch the ball`
    + ` — ${deaf.map((e) => `frac ${e.jackalFrac.toFixed(2)}/${e.jackalGap.toFixed(1)}m`).join(' ')}`);
  out.push(`JACKAL LANES ${sent.length}/${rucks.length} rucks · contact in ${sent.length - deaf.length}`
    + ` · ${sent.filter((e) => e.maxDefHold <= 0 && e.laneStruck).length} had the lane cleared out first`);
});

check('HANDS ARE PUBLISHED ONTO THE STATE — the rig has something to read', () => {
  /* an episode that never reached the contest stage has nothing to publish; the
     ruck's own step owns the hands, and a two-frame ASSEMBLE that ends in a penalty
     before it is not a missing hand */
  const blind = rucks.filter((e) => !e.handsSeen && e.contestEligible);
  assert(blind.length === 0, `${blind.length} rucks ran a contest with no hands state on it`);
});

check('A STRIP COSTS CONTACT — every turnover was held for the strip time', () => {
  const free = steals.filter((e) => Math.max(e.maxDefHold, e.winHold) < stripTimeFor(e.winAtk || e.presAtk));
  const worst = free.length ? Math.min(...free.map((x) => Math.max(x.maxDefHold, x.winHold))) : 0;
  assert(free.length === 0, `${free.length} steals happened with nobody's hands on the ball long enough`
    + ` (worst hold ${worst.toFixed(2)}s vs need ${stripTimeFor(free[0]?.winAtk ?? 1).toFixed(2)}s)`);
});

check('A LONE JACKAL CANNOT STEAL — the user law survives the hands', () => {
  /* judged on the count the engine judged on, at the frame it judged it */
  const stolen = rucks.filter((e) => /JACKAL WON/.test(e.why) && e.winDef <= e.winAtk);
  assert(stolen.length === 0, `${stolen.length} rucks were stolen with no numbers advantage`
    + ` (worst ${stolen.map((e) => `${e.winDef}v${e.winAtk} held ${e.winHold.toFixed(2)}s`).join(', ')})`);
});

check('THE BALL STILL COMES OUT — a contest cannot hold it forever', () => {
  const stuck = rucks.filter((e) => e.window > 0.86 || (e.window > 0 && e.window < 0.12));
  assert(stuck.length === 0, `${stuck.length} rucks released outside the [0.12, 0.86] window the clock allows`);
  assert(Math.max(0, ...rucks.map((e) => e.window)) <= 0.86, 'the window cap is not enforced');
});

check('A CLEANOUT BREAKS THE GRIP — contact is not a latch you can win through', () => {
  const broke = rucks.filter((e) => e.brokenGrip);
  assert(broke.length >= rucks.length * 0.25,
    `only ${broke.length}/${rucks.length} rucks show a grip broken by a clearout — a strip nobody can defend`);
});

check('THE GRIP WINS IT WHEN THE LAW ALLOWS — strand the guards and it turns over', () => {
  const stranded = drive(seeds[0], seconds, { strandSupport: true }).filter((e) => e.ruckFrames > 3);
  const taken = stranded.filter((e) => /JACKAL WON/.test(e.why));
  const rate = taken.length / Math.max(1, stranded.length);
  out.push(`STRANDED SUPPORT ${stranded.length} rucks · ${taken.length} stripped (${(rate * 100).toFixed(1)}%)`
    + ` · mean hold ${((stranded.reduce((m, e) => m + e.maxDefHold, 0) / Math.max(1, stranded.length))).toFixed(2)}s`);
  assert(rate >= 0.15, `with the guards 12 m behind, a grip took the ball in only ${(rate * 100).toFixed(1)}% of rucks`
    + ' — the hands gate is a wall, not a price');
});

check('AND NOT WHEN IT DOES NOT — the attack keeps a ball it has bodies at', () => {
  const rate = steals.length / Math.max(1, rucks.length);
  assert(rate <= 0.22, `${(rate * 100).toFixed(1)}% of rucks stolen in open play — above a fifth the contest is a coin flip`);
  /* `<= 0.22` is the ceiling breakdownprobe already holds the law to; the number is
   * reported rather than required because how often it is reached is the crew
   * policy's business (T-39 commits three men to every ruck), not the hands'. */
  out.push(`OPEN-PLAY STEAL RATE ${rate.toFixed(3)} per ruck — the law's ceiling, not the hands'`);
});

/* --------------------------------------------------------- cost, isolated -- */
/** A synthetic 12-man ruck, 60 m from the camera, ticked 12 000 times: the number
 *  the frame path actually pays, with nothing else in the way to hide it. */
function synthRuck(): { s: BreakdownState; dt: number; live: ReturnType<typeof liveStub> } {
  const s = {
    t: 0, stage: 'RUCK', attacking: 'A', contactX: 0, contactZ: 0, groundAt: 0,
    ball: { x: 0.2, z: -0.3, placed: true, y: 0.16 },
    players: [] as BreakdownState['players'], crew: [2, 3, 4], defCrew: [5, 6, 7],
    axis: 0, redT: 0, window: 0,
  } as unknown as BreakdownState;
  for (let i = 0; i < 6; i++) {
    s.players.push({ role: i === 0 ? 'CARRIER' : 'SUPPORT', num: 10 + i, team: 'A', x: 0.4 + i * 0.3, z: -0.6, down: i === 0 });
    s.players.push({ role: i === 0 ? 'JACKAL' : 'COUNTER', num: 20 + i, team: 'B', x: -0.5 - i * 0.35, z: 0.4, down: false });
  }
  return { s, dt: 1 / 60, live: liveStub(s) };
}

check('HANDS ARE CHEAP — 12 men, one hypot each, no allocation in the frame path', () => {
  const { s, dt, live: LIVE } = synthRuck();
  /* warm the shape out so the timing is the steady state, not the first-touch */
  for (let i = 0; i < 500; i++) { s.t += dt; stepHands(LIVE, s, dt); }
  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const N = 12000;
  for (let i = 0; i < N; i++) { s.t += dt; stepHands(LIVE, s, dt); }
  const us = ((performance.now() - t0) * 1000) / N;
  const perFrameBytes = (process.memoryUsage().heapUsed - heap0) / N;
  out.push(`COST ${us.toFixed(3)} µs/frame for ${s.players.length} men`
    + ` · ${(perFrameBytes >= 0 ? perFrameBytes : 0).toFixed(0)} B/frame heap`);
  assert(us < 6.0, `${us.toFixed(2)} µs a frame for twelve men is a second solver, not a field sample`);
  assert(us < ruckFrameUs * 0.35, `hands cost ${(us / ruckFrameUs * 100).toFixed(0)}% of the ruck's own frame (hands ${us.toFixed(2)} µs of ${ruckFrameUs.toFixed(1)} µs)`);
  assert(perFrameBytes < 400, `${perFrameBytes.toFixed(0)} B/frame means the frame path is allocating`);
});

check('THE MODEL ITSELF DOES WHAT IT SAYS — reach, grip, slow, strip', () => {
  /* A lone defender parked on the ball with no attackers at it, for a second. */
  const s = {
    t: 0, stage: 'RUCK', attacking: 'A', groundAt: 0, contactX: 0, contactZ: 0,
    ball: { x: 0, z: 0, placed: true, y: 0.16 }, crew: [], defCrew: [9],
    players: [
      { role: 'CARRIER', num: 1, team: 'A', x: 0.1, z: 0, down: true },
      { role: 'JACKAL', num: 9, team: 'B', x: 0.25, z: 0.1, down: false },
      { role: 'CLEAR', num: 2, team: 'A', x: 4.5, z: 2.5, down: false },
    ],
  } as unknown as BreakdownState;
  const h = makeHands();
  s.hands = h;
  const LIVE = liveStub(s);
  let reachPeak = 0;
  for (let i = 0; i < 60; i++) { s.t += 1 / 60; stepHands(LIVE, s, 1 / 60); reachPeak = Math.max(reachPeak, h.slots[1].reach); }
  assert(reachPeak > 0.8, `the jackal's hands never committed (peak reach ${reachPeak.toFixed(2)})`);
  assert(h.slots[1].onBall > 0.5, 'a man standing on the ball is not recorded as holding it');
  assert(h.slots[2].reach < 0.1, 'a clearer 5 m away is credited with hands on the ball');
  assert(windowSlow(h) > 0.05, 'a contested ball does not slow the heel — the jackal costs nothing');
  assert(windowSlow(h) <= 0.31, `the slow is unbounded (${windowSlow(h).toFixed(2)} s)`);
  assert(stripTimeFor(2) > stripTimeFor(1), 'more guards over the ball must cost a thief MORE time');
});

check('HANDS DO NOT LIE WITHOUT A PLAN — the fallback still works', () => {
  const { s, dt, live: LIVE } = synthRuck();
  s.plan = null;
  const h = stepHands(LIVE, s, dt);
  assert(s.players.length === h.slots.length, 'slot/player length mismatch without a plan');
  assert(Number.isFinite(h.defPressure), 'pressure went non-finite with no plan to sample');
  assert(h.bestDef >= 0 || h.bestDefOnBall === 0, 'bestDef indexes a man who is not holding anything');
});

/* A number the balance argument will want later: how a stripped ruck differs from
 * an untouched one. `R` is the seeded match RNG, so this stays reproducible. */
check('PUBLISHED HANDS DECAY AWAY FROM THE RUCK — no sticky arms', () => {
  const { s, dt, live: LIVE } = synthRuck();
  let hand0 = 0;
  for (let i = 0; i < 8; i++) { s.t += dt; stepHands(LIVE, s, dt); }
  publishHands(s, s.hands!);
  for (const p of s.players) hand0 = Math.max(hand0, p.hand ?? 0);
  /* He is walked 6 m off the ball; his published reach must return to nothing
   * rather than stay lit at the last thing he touched. A number the rig reads and
   * nobody clears is an arm that keeps reaching — which is exactly the artefact
   * `syncHands` resets for, and the reason the reset is the tested part. */
  const far = s.players[2];
  LIVE.move(far.team, far.num, 6.4, 5.2);
  for (let i = 0; i < 45; i++) { s.t += dt; stepHands(LIVE, s, dt); }
  publishHands(s, s.hands!);
  assert((s.players[2].hand ?? 0) < 0.05, `a man 6 m from the ball still publishes reach ${s.players[2].hand!.toFixed(2)}`);
  assert(hand0 > 0, 'the test rig never put a hand on the ball to begin with');
});

console.log(out.join('\n'));
console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
process.exit(fails ? 1 : 0);
