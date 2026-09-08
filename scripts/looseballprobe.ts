/** Live regression for free-ball lifetime, pursuit and actual in-reach gathers.
 * Run: npx tsx scripts/looseballprobe.ts. No DOM, hand-clicks or physics mocks.
 */
import assert from 'node:assert/strict';
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';
import { seedRng } from '../src/game/seed';
import { makeBall, ballContact, stepBallWithPlayers, type BallBody } from '../src/game/engine/ballPhysics';
import { looseBallReach } from '../src/game/engine/looseBall';
import * as THREE from 'three';
import { ThreePlayerManager } from '../src/render/ThreePlayerManager';
import type { ThreeCanvas } from '../src/render/ThreeCanvas';

const DT = 1 / 60;
const none = new Set<string>();
let failures = 0, checks = 0;
function check(name: string, fn: () => void) {
  checks++;
  try { fn(); console.log(`PASS  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}: ${(e as Error).message}`); }
}
function lab(human = false) {
  seedRng(714);
  const d = new Director(quickStartConfig({ cpuA: !human, cpuB: true }));
  d.startOpen('A', -26, -35, 9, 1, 0, 20);
  for (const p of d.live) {
    p.x = p.tx = (p.team === 'A' ? -1 : 1) * (20 + (p.num % 5) * 2);
    p.z = p.tz = (p.team === 'A' ? -1 : 1) * (30 + Math.floor((p.num - 1) / 5) * 3);
    p.vx = p.vz = 0; p.down = p.bound = false;
    p.sinbin = 1e5; p.recoverT = p.diveT = 0;
  }
  d.syncBallSocket();
  return d;
}
function loose(d: Director, b: BallBody, state: 'LOOSE' | 'FLIGHT' | 'HANDS_READY' = 'LOOSE') {
  d.bc.free = b;
  d.bc.state = state;
  d.bc.team = 'A'; d.bc.num = 9;
  d.bc.ownsBall = false;
  d.op!.ball.socket = null;
  d.op!.ball.live = false;
  return b;
}
function tick(d: Director, n = 1, handsUp = false) {
  for (let i = 0; i < n; i++) d.update(DT, { ...NO_INPUT, handsUp }, none, none);
}
function finiteAboveTurf(b: BallBody) {
  assert([b.x, b.y, b.z, b.vx, b.vy, b.vz, ...Object.values(b.q), ...Object.values(b.omega)].every(Number.isFinite));
  assert(Math.abs(Math.hypot(b.q.x, b.q.y, b.q.z, b.q.w) - 1) < 1e-9);
  assert(b.y >= ballContact(b.q).height - 1e-8, `ball penetrated turf at ${b.y}`);
}

check('CPU free ball falls even when its former carrier is down', () => {
  const d = lab();
  d.L('A', 9).down = true;
  const b = loose(d, makeBall(0, 4, 0), 'FLIGHT');
  tick(d, 15);
  assert.equal(d.bc.free, b, 'CPU/down-player gate erased the free body');
  assert(Math.abs(b.y - (4 - 0.5 * 9.81 * 0.25 ** 2)) < 1e-9, `gravity was not stepped exactly once: y=${b.y}`);
  assert.equal(d.watchdogTrips, 0, d.watchdogLog.join('\n'));
  finiteAboveTurf(b);
});

check('HANDS_READY is a pose, not a gravity switch', () => {
  const d = lab(true);
  d.L('A', 9).sinbin = 0;
  const b = loose(d, makeBall(0, 4, 0), 'HANDS_READY');
  tick(d, 12, true);
  assert.equal(d.bc.free, b);
  assert(Math.abs(b.y - (4 - 0.5 * 9.81 * 0.2 ** 2)) < 1e-9, `ready hands froze/double-stepped gravity: y=${b.y}`);
  const point = d.ballPoint();
  assert.deepEqual(point, { x: b.x, y: b.y, z: b.z }, 'camera/AI ball point still reads the old carrier');
});

check('a sleeping ball stays unclaimed when nobody can reach it', () => {
  const d = lab();
  const b = loose(d, makeBall());
  b.sleeping = b.grounded = true;
  const before = JSON.stringify(b);
  tick(d, 150);
  assert.equal(d.bc.free, b, 'sleep or a timer awarded remote possession');
  assert.equal(JSON.stringify(b), before, 'unforced resting ball changed');
  assert(!d.live.some(p => p.carrier), 'an absent player was marked as carrier');
  assert.equal(d.watchdogTrips, 0, d.watchdogLog.join('\n'));
});

for (const team of ['A', 'B'] as const) {
  check(`${team} front-row player chases FLIGHT, bends and gathers as his own shirt`, () => {
    const d = lab();
    const p = d.L(team, 3);
    p.sinbin = 0; p.x = p.tx = 4.5; p.z = p.tz = 0;
    const b = loose(d, makeBall(0, 2.8, 0), 'FLIGHT');
    let nearest = Infinity, maxStep = 0, frames = 0;
    for (; frames < 600 && d.bc.free; frames++) {
      const x = p.x, z = p.z;
      tick(d);
      nearest = Math.min(nearest, Math.hypot(p.x - b.x, p.z - b.z));
      maxStep = Math.max(maxStep, Math.hypot(p.x - x, p.z - z));
      finiteAboveTurf(b);
    }
    assert(nearest < 0.9, `player never approached the ball (nearest ${nearest.toFixed(2)} m, job ${p.job})`);
    assert.equal(d.bc.free, null, 'player reached the ball but never gathered it');
    assert.equal(d.op?.attacking, team);
    assert.equal(d.op?.carrierNum, 3, 'gather silently defaulted to shirt 9');
    assert.equal(d.op?.ball.socket, `${team}:3`);
    assert(maxStep < 0.25, `pickup teleported the player ${maxStep.toFixed(3)} m in one frame`);
    assert.equal(d.watchdogTrips, 0, d.watchdogLog.join('\n'));
    console.log(`      ${frames} frames; closest ${nearest.toFixed(3)} m; max player step ${maxStep.toFixed(3)} m`);
  });
}

check('neither the 2 s stall nor the 45 s phase watchdog gifts a stationary free ball', () => {
  const d = lab(true);
  d.L('A', 9).sinbin = 0; // only available collector is the stationary human
  const b = loose(d, makeBall()); b.sleeping = b.grounded = true;
  const before = JSON.stringify(b);
  tick(d, 47 * 60);
  assert.equal(d.bc.free, b, 'watchdog transferred a ball nobody had reached');
  assert.equal(JSON.stringify(b), before);
  assert.equal(d.watchdogTrips, 0, d.watchdogLog.join('\n'));
});

check('an actual human drop survives CPU takeover and the releaser falling', () => {
  const d = lab(true), p = d.L('A', 9);
  p.sinbin = 0;
  for (let i = 0; i < 2; i++) d.update(DT, { ...NO_INPUT, handsUp: true, secure: true }, none, none);
  assert.equal(d.bc.state, 'BALL_SECURED');
  d.update(DT, { ...NO_INPUT, handsUp: true }, none, new Set(['secure']));
  const b = d.bc.free!;
  assert(b && b.socket === null);
  const y = b.y, vy = b.vy;
  d.teams.A.cpu = true;
  p.down = true; p.recoverT = 10;
  tick(d, 15);
  assert.equal(d.bc.free, b);
  assert(Math.abs(b.y - (y + vy * 0.25 - 0.5 * 9.81 * 0.25 ** 2)) < 1e-9);
  assert.equal(d.watchdogTrips, 0, d.watchdogLog.join('\n'));
});

check('human movement keeps its owner while team-mates chase automatically', () => {
  const d = lab(true);
  const human = d.L('A', 3), helper = d.L('A', 2);
  human.sinbin = helper.sinbin = 0;
  human.x = human.tx = -5; human.z = human.tz = 0;
  helper.x = helper.tx = -7; helper.z = helper.tz = 2;
  d.setCtrl('A', 3); d.relativeControls = false;
  loose(d, makeBall(0, 4, 0), 'FLIGHT');
  tick(d, 10);
  assert.equal(human.x, -5, 'AI stole the manually controlled player');
  assert.equal(human.z, 0);
  assert(helper.x > -6.8 && /CHASE/.test(helper.job), 'uncontrolled team-mate ignored the loose ball');
  d.update(DT, { ...NO_INPUT, right: true }, none, none);
  assert.equal(human.movedBy, 'input');
  assert(human.x > -5 && human.x < -4.85, 'human input was ignored or integrated twice');
});

check('Q switches to an eligible collector on the human side, not the old defence', () => {
  const d = lab(true);
  const p = d.L('A', 8), unavailable = d.L('A', 1);
  d.L('A', 9).sinbin = 0;
  p.sinbin = unavailable.sinbin = 0;
  p.x = p.tx = 1.5; p.z = p.tz = 0;
  unavailable.x = unavailable.tx = 0; unavailable.z = unavailable.tz = 0;
  unavailable.down = true; unavailable.recoverT = 10;
  loose(d, makeBall(0, 4, 0), 'FLIGHT');
  d.update(DT, NO_INPUT, new Set(['switchPlayer']), none);
  assert.equal(d.ctrlPlayer, p, 'Q chose an opponent/unavailable body instead of the collector');
  assert.equal(d.passOpts.length, 0, 'free ball still advertised passes from the old carrier');
});

check('moving boots wake a resting ball; torso deflection spins it, with no RNG', () => {
  const random = Math.random;
  Math.random = () => { throw new Error('player contacts consumed RNG'); };
  try {
    const boot = { x: -0.7, z: 0.12, vx: 3, vz: 0, size: 1, face: 1 };
    const b = makeBall(); b.sleeping = b.grounded = true;
    let contacts = 0;
    for (let i = 0; i < 24; i++) {
      stepBallWithPlayers(b, DT, [boot], undefined, () => contacts++);
      boot.x += boot.vx * DT;
      finiteAboveTurf(b);
    }
    assert(contacts > 0 && b.x > 0.1 && b.vx > 0.5 && !b.sleeping, 'walking boot went through a sleeping ball');

    const body = { x: 0, z: 0, vx: 0, vz: 0, size: 1, face: 1 };
    const shot = makeBall(-1.3, 1.05, 0.08);
    shot.vx = 16; shot.q.y = Math.sin(0.4); shot.q.w = Math.cos(0.4); shot.flightGuard = true;
    const copy = structuredClone(shot);
    let hits = 0;
    for (let i = 0; i < 12; i++) {
      stepBallWithPlayers(shot, DT, [body], undefined, () => hits++);
      stepBallWithPlayers(copy, DT, [body]);
      if (hits === 0) assert(shot.flightGuard, 'protected flight changed before contact');
      finiteAboveTurf(shot);
    }
    assert(hits > 0 && shot.x < 0 && shot.vx < 8 && Math.abs(shot.vz) > 2 && !shot.flightGuard, 'ball passed through the torso rather than deflecting');
    assert(Math.hypot(shot.omega.x, shot.omega.y, shot.omega.z) > 0.5, 'off-centre player contact supplied no torque');
    assert.deepEqual(shot, copy, 'identical contacts diverged');
    console.log(`      boot ${contacts} contacts, exit ${b.vx.toFixed(2)} m/s; torso spin ${Math.hypot(shot.omega.x, shot.omega.y, shot.omega.z).toFixed(2)} rad/s`);
  } finally { Math.random = random; }
});

check('a down player deflects the live ball but cannot pick it up', () => {
  const d = lab(), p = d.L('B', 14);
  p.sinbin = 0; p.x = p.tx = 0; p.z = p.tz = 0;
  p.down = true; p.recoverT = 10;
  const b = loose(d, makeBall(-1, 0.21, 0)); b.vx = 8;
  tick(d, 15);
  assert.equal(d.bc.free, b, 'grounded player was awarded possession');
  assert(d.bc.loose!.contacts > 0, 'live path did not consult the player collider');
  assert.equal(d.bc.loose!.lastTouch.team, 'B');
  assert.equal(d.bc.loose!.lastTouch.num, 14);
  assert(!d.live.some(q => q.carrier));
  finiteAboveTurf(b);
});

check('a low gather has a reach interval and cancels if the player goes down', () => {
  const d = lab(), p = d.L('B', 3);
  p.sinbin = 0; p.x = p.tx = 0.6; p.z = p.tz = 0;
  const b = loose(d, makeBall()); b.sleeping = b.grounded = true;
  tick(d, 3);
  assert.equal(d.bc.free, b, 'scoop was an instantaneous remote weld');
  assert(d.bc.loose?.gather && d.bc.loose.gather.num === 3);
  assert(looseBallReach(d, p) > 0.5, 'collector has no engine reach pose');
  p.down = true; p.recoverT = 10;
  tick(d, 15);
  assert.equal(d.bc.free, b);
  assert.equal(d.bc.loose?.gather, null, 'an ineligible collector retained the claim');
  assert.equal(looseBallReach(d, p), 0);
});

check('a late-bounce kick stays free until an actual fielder gets there', () => {
  const d = lab();
  d.startKick('A', 'PUNT', { x: -20, z: -35 }); d.launch(0.4, 0.95);
  const k = d.kk!, b = k.body;
  Object.assign(b, makeBall(0, 0.095, 0), { sleeping: true, grounded: true, bounces: 7 });
  k.bx = b.x; k.by = b.y; k.bz = b.z;
  k.vx = k.vy = k.vz = 0; k.bounces = 7;
  d.upKick(DT, NO_INPUT, none);
  assert.equal(d.phase, 'OPEN_PLAY');
  assert.equal(d.bc.free, b, 'sleep gave the kick to an absent receiver');
  assert(!d.live.some(p => p.carrier));
  tick(d, 3);
  assert.equal(d.bc.free, b);
  const p = d.L('B', 14);
  p.sinbin = 0; p.x = p.tx = 0.6; p.z = p.tz = 0;
  for (let i = 0; i < 90 && d.bc.free; i++) tick(d);
  assert.equal(d.bc.free, null, 'fielding stopped after the second bounce');
  assert.equal(d.op?.attacking, 'B'); assert.equal(d.op?.carrierNum, 14);
  assert.equal(d.op?.ball.socket, 'B:14');
});

check('a missed pass hands over the body with exactly ONE gravity step', () => {
  const d = lab(), s = d.op!;
  Object.assign(s.ball, makeBall(0, 4, 0), { live: true, t: 0 });
  s.pendingReceiver = 10; s.passT = 0; s.passDist = 10; s.passPace = 1;
  const b = s.ball;
  // Recipient is genuinely unavailable; the pass must not move or possess him.
  const rec = d.L('A', 10), oldX = rec.x, oldZ = rec.z;
  tick(d);
  assert.equal(d.bc.free, b, 'unavailable receiver was given the missed pass');
  assert(Math.abs(b.y - (4 - 0.5 * 9.81 * DT ** 2)) < 1e-9, 'pass-to-loose transition stepped gravity twice');
  tick(d, 11);
  assert(Math.abs(b.y - (4 - 0.5 * 9.81 * 0.2 ** 2)) < 1e-9, 'missed-pass gravity stopped');
  assert.equal(rec.x, oldX); assert.equal(rec.z, oldZ);
  assert.equal(b.socket, null);
});

check("a human intercept keeps the correct team even with the passer's shirt number", () => {
  const d = lab(); d.teams.B.cpu = false;
  const p = d.L('B', 9), intended = d.L('A', 10), s = d.op!;
  p.sinbin = intended.sinbin = 0;
  p.x = p.tx = 0; p.z = p.tz = 0;
  intended.x = intended.tx = 5; intended.z = intended.tz = 0;
  d.setCtrl('B', 9);
  Object.assign(s.ball, makeBall(0.9, 1.45, 0), { live: true, t: 0 });
  s.pendingReceiver = 10; s.passDist = 13; s.passPace = 1;
  s.passTargetX = 5; s.passTargetZ = 0;
  d.update(DT, { ...NO_INPUT, handsUp: true }, none, none);
  assert(s.ball.live && !d.bc.free, 'fixture is no longer an airborne pass');
  assert.equal(d.bc.state, 'HANDS_READY', 'same shirt number incorrectly blocked the intercept');
  d.update(DT, { ...NO_INPUT, handsUp: true, secure: true }, none, none);
  assert.equal(d.op?.attacking, 'B', 'intercept was awarded back to the passing side');
  assert.equal(d.op?.carrierNum, 9); assert.equal(d.op?.ball.socket, 'B:9');
  assert.equal(d.bc.state, 'BALL_SECURED');
});

check('pickup/chase works at 30, 60 and 120 Hz, both sides and different shirts', () => {
  for (const hz of [30, 60, 120]) for (const team of ['A', 'B'] as const) {
    const d = lab(), num = hz === 30 ? 1 : hz === 60 ? 5 : 13;
    const p = d.L(team, num); p.sinbin = 0;
    p.x = p.tx = -4; p.z = p.tz = 0;
    const b = loose(d, makeBall(0, 4, 0), 'FLIGHT'); b.vx = 2; b.vz = -0.8;
    for (let i = 0; i < hz * 6 && d.bc.free; i++) {
      d.update(1 / hz, NO_INPUT, none, none);
      finiteAboveTurf(b);
    }
    assert.equal(d.bc.free, null, `${team}:${num} never collected at ${hz} Hz`);
    assert.equal(d.op?.attacking, team); assert.equal(d.op?.carrierNum, num);
    assert.equal(d.watchdogTrips, 0, d.watchdogLog.join('\n'));
  }
});

check('the actual renderer reaches/bends for the collector, never a distant old carrier', () => {
  const d = lab(), p = d.L('B', 3);
  p.sinbin = 0; p.x = p.tx = 0.6; p.z = p.tz = 0;
  const b = loose(d, makeBall()); b.sleeping = b.grounded = true;
  tick(d, 3);
  const scene = new THREE.Scene();
  const manager = new ThreePlayerManager({ scene } as ThreeCanvas);
  // Minimal real Three bones: no WebGL or replacement IK/physics implementation.
  const stub = () => ({
    st: { hand: 0, strip: 0 }, proc: { craftW: 0, dip: 0, pickup: false },
    rig: { spine: [new THREE.Bone(), new THREE.Bone()], neck: new THREE.Bone() },
  });
  const collector = stub(), oldCarrier = stub();
  const rig = manager as unknown as {
    pool: Map<string, ReturnType<typeof stub>>;
    syncHands(d: Director): void;
    applyTorsoDip(inst: ReturnType<typeof stub>, weight: number, dt: number): void;
  };
  rig.pool.set('B:3', collector); rig.pool.set('A:9', oldCarrier);
  rig.syncHands(d);
  assert(collector.st.hand > 0.5, 'live collector never received the rendering reach');
  assert(collector.proc.pickup, 'scoop would lift the player off his feet');
  assert.equal(oldCarrier.st.hand, 0, 'a distant former carrier still grabs at the free ball');
  rig.applyTorsoDip(collector, collector.st.hand, DT);
  assert(collector.rig.spine.some(bone => Math.abs(bone.rotation.x) > 0.001), 'scoop did not bend the spine');
  d.startOpen('A', -20, -30);
  rig.syncHands(d);
  assert.equal(collector.st.hand, 0, 'stale reach survived ownership/phase cleanup');
  scene.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      (m as THREE.MeshToonMaterial).map?.dispose(); (m as THREE.MeshToonMaterial).gradientMap?.dispose(); m.dispose();
    }
  });
});

check('touch/dead-ball rules clear the free body rather than invent possession', () => {
  const touch = lab();
  loose(touch, makeBall(34.7, 0.4, 0)); tick(touch);
  assert.equal(touch.phase, 'LINEOUT'); assert.equal(touch.possession, 'B');
  assert.equal(touch.bc.free, null); assert.equal(touch.bc.loose, null);
  const dead = lab();
  loose(dead, makeBall(0, 0.4, -61.2)); tick(dead);
  assert.equal(dead.phase, 'KICK'); assert.equal(dead.kk?.type, 'DROP_OUT');
  assert.equal(dead.kk?.kicker, 'A', 'wrong in-goal defender got the restart');
  assert.equal(dead.bc.free, null); assert.equal(dead.bc.loose, null);
});

console.log(`\nLOOSE BALL PROBE: ${checks - failures}/${checks} PASS${failures ? `, ${failures} FAIL` : ''}`);
process.exitCode = failures ? 1 : 0;
