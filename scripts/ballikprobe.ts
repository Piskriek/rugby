/**
 * ballikprobe.ts — does the catch, the grip and the punt actually work?
 *
 * SPEC_25 puts a state machine, an analytic two-bone solver and a kicked ball under
 * the mouse. All three are arithmetic the engine keeps, so none of them needs a
 * browser to be believed — and in this sandbox a browser is not available, which is
 * exactly why the repo's rule is that every mechanic arrives with a harness that can
 * drive it. `npm run dev` is the acceptance surface; this file is the evidence.
 *
 *   npx vite-node scripts/ballikprobe.ts [seconds] [difficulty] [seeds]
 *
 * The fixtures reach into `bc` on purpose in two places (placing a free ball out of
 * reach, and pushing a drop sideways so the boot whiffs). Both are stated in the check
 * that uses them: a test that can only pass when the world is convenient is a test of
 * the test.
 */
import { Director, NO_INPUT, type Input } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { makeBall } from '../src/game/engine/ballPhysics';
import { Session } from 'node:inspector/promises';
import {
  solveTwoBone, lookVector, stepCraft, PUNT_WINDOW_S, SECURE_M, M_BALL, V_KICK,
  SWING_S, BALL_R,
} from '../src/game/engine/ballcraft';

const seconds = Number(process.argv[2] ?? 90);
const diff = Number(process.argv[3] ?? 3);
const seeds = (process.argv[4] ?? '1 2 3').split(/[ ,]+/).filter(Boolean).map(Number);

let fails = 0;
const out: string[] = [];
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); out.push(`PASS  ${name}`); }
  catch (e) { fails++; out.push(`FAIL  ${name}\n      ${String((e as Error).message || e)}`); }
}

const DT = 1 / 60;

/** A match where team A is the human side, already in open play with the ball. */
function mk(seed: number): Director {
  seedRng(seed);
  const d = new Director(gateConfig(diff));
  d.teams.A.cpu = false;
  /* THE LAB HAS TO BE IN THE RIGHT ROOM. `op` existing is not enough — the machine
   * only runs in open play, and a match begins in a KICK phase whose state object
   * there is before the first ruck. Waiting on the phase (and not on `op`) is what
   * makes these fixtures deterministic; `startOpen` alone would have left every check
   * below driving a state machine that was correctly refusing to run. */
  let guard = 0;
  while (!(d.phase === 'OPEN_PLAY' && d.op && d.op.attacking === 'A' && !d.op.ball.live && !d.bc.free) && guard++ < 1800) {
    d.update(DT, NO_INPUT, new Set(), new Set());
    if (guard === 1799) break;
  }
  if (d.phase !== 'OPEN_PLAY' || d.op?.attacking !== 'A' || d.op.ball.live || d.bc.free) { d.startOpen('A', 0, -6); }
  /* THE LAB. Every fixture in the first half of this file needs the phase to stay in
   * open play for a second and a half while a man stands still and clicks, which is
   * longer than the game's own defenders take to hit him. A beaten defender cannot
   * tackle and still recovers, so `beatenT` is the engine's own "leave him alone"
   * switch and no new state is invented to hold it. The last check — the soak — runs
   * with the opposition awake on purpose, because a lab that cannot be tackled in
   * proves nothing about a match. */
  for (const q of d.live) if (q.team === 'B') q.beatenT = 1e5;
  return d;
}

/** A clean, minimal driver for the state machine alone: no CPU opposition, no other
 *  phase, so a transition that happens here cannot be attributed to anything else. */
function tick(d: Director, handsUp: boolean, secure: boolean, pressPunt = false) {
  const input: Input = { ...NO_INPUT, handsUp, secure, punt: pressPunt };
  const pressed = new Set<string>();
  if (handsUp) pressed.add('handsUp');
  if (secure) pressed.add('secure');
  if (pressPunt) pressed.add('punt');
  d.update(DT, input, pressed, secure ? new Set() : new Set(['secure']));
}

/** IDLE → HANDS_READY → BALL_SECURED → DROP_BALL, one call. Three frames because the
 *  press and the release are edges and the machine only reacts to them on the frame
 *  AFTER it has entered the state it is listening in — a fixture that skips a frame
 *  is a fixture that tests nothing and appears to pass. */
function toDrop(e: Director) {
  assert(e.phase === 'OPEN_PLAY' && e.isHuman('A'), `fixture is in ${e.phase}, not human open play`);
  tick(e, true, false);
  tick(e, true, true);
  tick(e, true, false);
  assert(e.bc.state === 'DROP_BALL' && !!e.bc.free,
    `could not build a drop (state ${e.bc.state}, free ${e.bc.free ? 'set' : 'null'})`);
}

/* ------------------------------------------------------------------ run ---- */
const d = mk(1);
const bc = d.bc;

await check('THE VERBS ARE THE STATES — RMB raises the hands, releasing them lowers it', () => {
  assert(bc.state === 'IDLE', `the machine starts in ${bc.state}, not IDLE`);
  tick(d, true, false);
  assert(bc.state === 'HANDS_READY', `holding RMB gave ${bc.state}`);
  assert(bc.log.some((e) => e.state === 'HANDS_READY' && /RMB/.test(e.why)),
    'the transition was not logged with its reason');
  /* and the ball at the carrier's own hands is where the reach aims: a man holding a
   * ball who brings his hands up has both hands near it, not punching the air */
  assert(bc.l.reach > 0.5 && bc.r.reach > 0.5,
    `both hands report reach ${bc.l.reach.toFixed(2)}/${bc.r.reach.toFixed(2)} at a ball he is already holding`);
  tick(d, false, false);
  tick(d, false, false);
  assert(bc.state === 'IDLE', `releasing RMB left the machine in ${bc.state}`);
});

await check('THE TWO-BONE CHAIN IS ANATOMICALLY HONEST — no hyperextension, no broken limb', () => {
  const l1 = 0.30, l2 = 0.28;
  let maxErr = 0, over = 0;
  for (let i = 0; i < 4000; i++) {
    const a = (i % 360) * Math.PI / 180;
    const r = 0.2 + (i % 90) * 0.09;
    const root = { x: 0, y: 1.24, z: 0 };
    const target = { x: Math.cos(a) * r, y: 1.24 + Math.sin(a * 2.1) * 0.9, z: Math.sin(a) * r };
    const s = solveTwoBone(root, target, l1, l2, { x: 0, y: -0.6, z: 0 });
    const upper = Math.hypot(s.elbow.x, s.elbow.y - 1.24, s.elbow.z);
    const fore = Math.hypot(s.hand.x - s.elbow.x, s.hand.y - s.elbow.y, s.hand.z - s.elbow.z);
    const total = Math.hypot(s.hand.x, s.hand.y - 1.24, s.hand.z);
    maxErr = Math.max(maxErr, Math.abs(upper - l1), Math.abs(fore - l2));
    if (total > l1 + l2 + 1e-6) over++;
  }
  assert(over === 0, `${over}/4000 solves put the hand outside the reach sphere`);
  assert(maxErr < 1e-6, `segment lengths drifted by ${maxErr.toExponential(1)} m — the bones are stretching`);
});

await check('A BALL OUT OF REACH IS REACHED AT, NOT GRABBED', () => {
  const root = { x: 0, y: 1.24, z: 0 };
  const near = solveTwoBone(root, { x: 0.3, y: 1.2, z: 0.2 }, 0.30, 0.28, { x: 0, y: -0.5, z: 0 });
  const far = solveTwoBone(root, { x: 4, y: 1.2, z: 3 }, 0.30, 0.28, { x: 0, y: -0.5, z: 0 });
  assert(near.reach > 0.98, `a ball 0.37 m away reads ${near.reach.toFixed(2)} of reach`);
  assert(far.reach < 0.25, `a ball 5 m away reads ${far.reach.toFixed(2)} — the solver is pretending`);
  const dd = Math.hypot(far.hand.x, far.hand.y - 1.24, far.hand.z);
  assert(Math.abs(dd - 0.572) < 0.02, `the short reach ended ${dd.toFixed(3)} m out, not at the limb's own limit`);
});

await check('LMB INSIDE THE RADIUS SECURES IT, AND GRAVITY STOPS APPLYING', () => {
  const e = mk(2);
  /* the carrier's ball is by definition within the radius: that is what "holding" is */
  tick(e, true, false); tick(e, true, false);
  tick(e, true, true);
  assert(e.bc.state === 'BALL_SECURED', `LMB at the chest gave ${e.bc.state}`);
  assert(e.bc.ownsBall, 'the ball is not marked as owned by the grip');
  assert(!e.op!.ball.live, 'a secured ball is still flagged as a pass in flight');
  const y0 = e.op!.ball.y;
  for (let i = 0; i < 40; i++) tick(e, true, true);
  assert(e.op!.ball.y > 0.5, `the "secured" ball fell to ${e.op!.ball.y.toFixed(2)} m — gravity was never disabled`);
  assert(Math.abs(e.op!.ball.y - y0) < 0.9, 'the secured ball is not slaved to the upper body, it is wandering');
  const hand = e.bc.l.hand;
  const chest = e.bc.chest;
  assert(Math.hypot(hand.x - chest.x, hand.y - chest.y, hand.z - chest.z) < SECURE_M,
    'the solved hand is further from the chest than the secure radius it is holding a ball at');
});

await check('AND LMB OUTSIDE IT IS REFUSED, WITH THE DISTANCE SAID OUT LOUD', () => {
  const e = mk(3);
  tick(e, true, false);
  /* FIXTURE: a ball that is genuinely elsewhere. Placed by hand because the only
   * legitimate way to get one is a drop, which needs a secured ball first — the
   * state machine cannot be tested for its refusal without a loose ball. */
  e.bc.free = makeBall(e.op!.carrierX + 1.6, 2.4, e.op!.carrierZ - 1.4);
  tick(e, true, true);
  assert(e.bc.state === 'HANDS_READY', `a grab at a ball 2.4 m away returned ${e.bc.state}`);
  assert(!e.bc.ownsBall, 'the engine took a ball that was not in reach');
  const refused = e.bc.log.filter((l) => /refused — ball/.test(l.why));
  assert(refused.length > 0, `the refusal was never recorded (log: ${e.bc.log.map((l) => l.why).join(' | ')})`);
  assert(/\d+\.\d+ m from the hands/.test(refused[0].why),
    `the refusal did not say how far away it was: ${refused[0].why}`);
  e.bc.free = null;
});

await check('RELEASING LMB DROPS IT AND THE DROP IS A RELEASE, NOT A THROW', () => {
  const e = mk(4);
  tick(e, true, true); tick(e, true, true);
  tick(e, true, false);
  assert(e.bc.state === 'DROP_BALL', `release gave ${e.bc.state}`);
  assert(!!e.bc.free, 'no free ball exists to fall');
  assert(e.bc.free!.vy <= 1.2, `the drop started at ${e.bc.free!.vy.toFixed(2)} m/s upward — that is a toss`);
  const y0 = e.bc.free!.y;
  for (let i = 0; i < 6; i++) tick(e, false, false);
  assert(e.bc.free!.y < y0, `six frames of gravity left the ball at ${(e.bc.free!.y - y0).toFixed(3)} m`);
  assert(Math.abs(e.bc.window - Math.max(0, PUNT_WINDOW_S - e.bc.t)) < 1e-6,
    `the window (${e.bc.window.toFixed(3)}) is not the clock (${e.bc.t.toFixed(3)})`);
});

await check('THE WINDOW IS 300 ms AND NOT 301 — a punt late is a fumble', () => {
  const inside = mk(5), outside = mk(5);
  for (const [e, frames] of [[inside, 17], [outside, 20]] as [Director, number][]) {
    toDrop(e);                                  // DROP_BALL, frame 0 of the window
    for (let i = 0; i < frames; i++) tick(e, true, false, false);
    tick(e, true, false, true);                 // the boot, at (frames+1)·16.7 ms
    for (let i = 0; i < 40; i++) tick(e, true, false, false);
  }
  assert(inside.bc.lastImpulse > 0, `a punt at 17 frames (${(17 * DT * 1000).toFixed(0)} ms) struck nothing`);
  /* The strike is the fact; where the machine sits afterwards depends on who gets to
   * the ball, and a held right button legitimately re-raises the hands once the flight
   * resolves. Asserting the strike's own log line keeps the check about the window. */
  assert(inside.bc.log.some((l) => /struck at/.test(l.why)),
    `no "struck at" in the ledger (${inside.bc.log.map((l) => l.state + ':' + l.why).join(' → ')})`);
  assert(outside.bc.lastImpulse === 0,
    `a Space at ${(20 * DT * 1000).toFixed(0)} ms still punted the ball — the window is not enforced`);
  assert(/window closed|boot missed/.test(outside.bc.log.map((l) => l.why).join(' ')),
    'the late drop did not resolve to a loose ball with a reason');
});
await check('THE IMPULSE IS m·v·u, u IS THE LENS, AND RELEASE MOMENTUM IS RETAINED', () => {
  const e = mk(6);
  /* The rig owns `cam` and rewrites it every frame, so the aim has to be pinned on
   * each frame of the test — and that is the useful property being measured: the punt
   * follows whatever the lens is doing at the strike, not a yaw the fixture hoped for
   * three frames earlier. */
  const setCam = () => { e.cam.yaw = 1.15; e.cam.tilt = 0.5; };
  setCam();
  const u = { ...lookVector(e) };
  toDrop(e);
  for (let i = 0; i < 14 && e.bc.state === 'DROP_BALL'; i++) { setCam(); tick(e, true, false, false); }
  assert(e.bc.state === 'DROP_BALL', `the window closed before the boot was offered (${e.bc.state})`);
  /* FIXTURE: the drop is held at a constant height for the length of this check only,
   * so the assertion below is about the DIRECTION and the MAGNITUDE of the strike and
   * not about whether the arc happened to intersect a falling ball. */
  let beforeStrike = { vx: 0, vz: 0 };
  for (let i = 0; i < 12; i++) {
    if (!e.bc.free) break;
    beforeStrike = { vx: e.bc.free.vx, vz: e.bc.free.vz };
    e.bc.free.vy = 0.4; e.bc.free.y = 0.86;
    setCam();
    tick(e, true, false, true);
    e.bc.free = e.bc.free ? e.bc.free : e.bc.free;
    if (e.bc.state === 'FLIGHT') break;
    if (e.bc.free) { e.bc.free.vy = 0.4; e.bc.free.y = 0.86; }
  }
  assert(e.bc.state === 'FLIGHT', `the boot never met the ball (state ${e.bc.state}, owner ${e.op?.attacking}:${e.op?.carrierNum})`);
  const f = e.bc.lastImpulse;
  assert(f > M_BALL * V_KICK * 0.45 && f < M_BALL * V_KICK * 1.35,
    `impulse ${f.toFixed(2)} N·s is outside the model's own band (${(M_BALL * V_KICK).toFixed(2)} N·s nominal)`);
  const v = e.bc.free!;
  // Rugby-ball physics preserves the drop's momentum. J points along the
  // lens, not the sum v_drop + J/m; measuring that sum rejects legal punts.
  const dvx = v.vx - beforeStrike.vx, dvz = v.vz - beforeStrike.vz;
  const dir = Math.atan2(dvx, dvz);
  const want = Math.atan2(u.x, u.z);
  let dd = ((dir - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  assert(Math.abs(dd) < 0.06, `the impulse was ${((dd * 180) / Math.PI).toFixed(1)}° off the camera's look vector`);
  const speed = Math.hypot(dvx, dvz);
  const horizontalImpulse = f / M_BALL * Math.hypot(u.x, u.z);
  assert(Math.abs(speed - horizontalImpulse) < 1e-6,
    `Δv ${speed.toFixed(1)} m/s is not the horizontal J/m = ${horizontalImpulse.toFixed(1)} m/s`);
});

await check('A BOOT THAT MISSES IS A MISS', () => {
  const e = mk(7);
  toDrop(e);
  tick(e, true, false, true);                   // offer the boot while the ball is still in reach
  assert(e.bc.state === 'PUNT_KICK', `the swing never started (${e.bc.state})`);
  /* FIXTURE: the drop sideways out of the swing arc. A ball the boot cannot reach must
   * not be kicked by a rule that forgives the input. */
  for (let i = 0; i < 44 && e.bc.free && e.bc.state === 'PUNT_KICK'; i++) {
    e.bc.free.x += 0.55; e.bc.free.z -= 0.45;
    tick(e, true, false, false);
  }
  assert(e.bc.lastImpulse === 0, 'a swing through empty air still moved the ball');
  assert(e.bc.state === 'LOOSE' || e.bc.state === 'IDLE',
    `a whiff ended in ${e.bc.state}; it must end in a loose ball (${e.bc.log.map((l) => `${l.state}:${l.why}`).join(' → ')})`);
});

await check('A PUNTED BALL IS RESOLVED, NEVER ABANDONED', () => {
  const e = mk(8);
  toDrop(e);
  for (let i = 0; i < 2; i++) tick(e, true, false, i === 0);
  for (let i = 0; i < 260 && e.bc.state === 'FLIGHT'; i++) tick(e, false, false, false);
  assert(e.bc.free === null || e.bc.state !== 'FLIGHT',
    'a punted ball flew for over four seconds without a resolution');
  assert(Number.isFinite(e.op!.ball.x) && Number.isFinite(e.op!.ball.y),
    'the ball ended the flight at a non-finite position');
  for (const p of e.live) assert(Number.isFinite(p.x) && Number.isFinite(p.z), 'an actor went non-finite');
  const owner = e.live.find((p) => p.num === e.op!.carrierNum && p.team === e.op!.attacking);
  assert(!!owner, 'after the flight nobody owns the ball');
});

await check('THE FRAME COST IS SMALL AND THE STEADY-STATE HEAP DOES NOT GROW', async () => {
  const e = mk(9);
  for (let i = 0; i < 20; i++) tick(e, true, i > 6);
  const N = 6000;
  /* Hoisted on purpose: a timing loop that allocates two Sets per iteration measures
   * the allocator, not the mechanic — which is exactly what this check caught the first
   * time it ran, at 2.4 kB/frame. */
  const press = new Set<string>(['punt']);
  const none = new Set<string>();
  const burn = (n: number) => {
    for (let i = 0; i < n; i++) {
      e.bc.t += DT;
      stepCraft(e, DT, true, i > 40, i === 41, i === 41 ? press : none, none);
    }
  };
  /* Compare RETAINED heap after collection. Raw heapUsed between loops
   * depends on V8 nursery size/when the last GC happened, and counted boxed
   * numeric writes as a leak (0 versus 900 B/frame for the same secured pose).
   * Keep the latency and retained-growth thresholds; do not claim this counts
   * all temporary JS allocations. GC is outside the timed interval. */
  const session = new Session(); session.connect();
  let us = 0, bytes = 0;
  try {
    burn(N);
    await session.post('HeapProfiler.collectGarbage');
    const heap1 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    burn(N * 2);
    us = (performance.now() - t0) * 1000 / (N * 2);
    await session.post('HeapProfiler.collectGarbage');
    bytes = Math.max(0, (process.memoryUsage().heapUsed - heap1) / (N * 2));
  } finally { session.disconnect(); }
  out.push(`COST ${us.toFixed(2)} µs/frame · ${bytes.toFixed(0)} retained B/frame`);
  assert(us < 40, `the craft step costs ${us.toFixed(1)} µs — two arms and a ball must not cost a tenth of a frame`);
  assert(bytes < 300, `${bytes.toFixed(0)} B/frame means the mechanic retains memory per frame`);
});

await check('THE MOUSE CANNOT BREAK THE MATCH — soak with random verbs', () => {
  let trips = 0, eps = 0, maxDisp = 0, secured = 0, punted = 0, loose = 0;
  for (const sd of seeds) {
    seedRng(sd);
    const e = new Director(gateConfig(diff));
    e.teams.A.cpu = false;
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let f = 0; f < seconds * 60; f++) {
      const handsUp = rnd() < 0.30, secure = rnd() < 0.10;
      /* the human has to actually play: a soak that never touches the movement axes
       * trips the stall watchdog for standing still, which is a property of the soak
       * and not of the mechanic being tested. */
      const input: Input = {
        ...NO_INPUT, handsUp, secure, punt: rnd() < 0.06,
        left: rnd() < 0.3, right: rnd() < 0.3, up: rnd() < 0.45, down: rnd() < 0.2, sprint: rnd() < 0.5,
      };
      const pressed = new Set<string>();
      if (handsUp) pressed.add('handsUp');
      if (secure) pressed.add('secure');
      if (input.punt) pressed.add('punt');
      // A real punt can now carry into touch. Pilot the human's lineout
      // ritual too: random mouse buttons cannot press SPACE at the meter,
      // and an abandoned throw is a fixture timeout, not a ballcraft lock.
      if (e.phase === 'LINEOUT' && e.lo && e.isHuman(e.lo.thrower)
        && (e.lo.stage === 'CALL' || (e.lo.stage === 'THROW' && e.lo.meter >= 0.60))) {
        pressed.add('action');
      }
      const before = new Map(e.live.map((p) => [p.num + p.team, [p.x, p.z]] as const));
      e.update(DT, input, pressed, new Set(secure ? [] : ['secure']));
      const st = e.bc.state;
      if (st === 'BALL_SECURED') secured++;
      else if (st === 'FLIGHT' || st === 'PUNT_KICK') punted++;
      else if (st === 'LOOSE' || st === 'DROP_BALL') loose++;
      for (const p of e.live) {
        const b = before.get(p.num + p.team);
        if (b) maxDisp = Math.max(maxDisp, Math.hypot(p.x - b[0], p.z - b[1]));
        if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) eps++;
      }
    }
    trips += e.watchdogTrips;
    out.push(`  seed ${sd}: watchdog ${e.watchdogTrips}, secured ${secured} frames, boot ${punted}, loose ${loose}`);
  }
  assert(trips === 0, `${trips} watchdog trip(s) while a human was clicking over the top of the sim`);
  assert(eps === 0, `${eps} non-finite player positions`);
  assert(maxDisp < 0.8, `a frame moved a player ${maxDisp.toFixed(2)} m — the teleport gate is 0.8 m`);
  assert(secured > 0 && (punted + loose) > 0,
    `the soak never exercised the mechanic (secured ${secured}, boot ${punted}, loose ${loose}) — a soak that touches nothing proves nothing`);
});

await check('THE SPEC SURFACE IS STILL THERE — the numbers are the numbers', () => {
  assert(SECURE_M === 0.7, 'the secure radius moved');
  assert(Math.abs(PUNT_WINDOW_S - 0.3) < 1e-9, 'the drop window moved off 300 ms');
  assert(M_BALL > 0.4 && M_BALL < 0.47, `a rugby ball is 410-460 g, not ${M_BALL} kg`);
  assert(SWING_S > 0.1 && SWING_S < 0.4, `the boot takes ${SWING_S} s to get there`);
  assert(BALL_R > 0.1 && BALL_R < 0.17, 'the ball collider is not a rugby ball');
});

console.log(out.join('\n'));
console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
process.exit(fails ? 1 : 0);
