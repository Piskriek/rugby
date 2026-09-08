/** Ball/behaviour integration: decisions must describe the physical play.
 * npx tsx scripts/ballbehaviourprobe.ts — deterministic, live Director updates.
 */
import assert from 'node:assert/strict';
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';
import { seedRng } from '../src/game/seed';
import { maxSpeed } from '../src/game/intelligence';
import { readBall, coordinateBall, canPlayBall, ballReach, predictBall } from '../src/game/engine/ballAwareness';
import * as THREE from 'three';
import { ThreePlayerManager } from '../src/render/ThreePlayerManager';
import type { ThreeCanvas } from '../src/render/ThreeCanvas';
import { makeBall } from '../src/game/engine/ballPhysics';
import { adoptLooseBall } from '../src/game/engine/looseBall';

const DT = 1 / 60, none = new Set<string>();
let checks = 0, failures = 0;
function check(name: string, fn: () => void) {
  checks++;
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}
function lab(human = false) {
  seedRng(110371);
  const d = new Director(quickStartConfig({ cpuA: !human, cpuB: true }));
  d.startOpen('A', -22, -30, 9, 1, 0, 30);
  for (const p of d.live) {
    p.x = p.tx = (p.num % 5 - 2) * 8;
    p.z = p.tz = (p.team === 'A' ? -1 : 1) * (16 + Math.floor((p.num - 1) / 5) * 8);
    p.vx = p.vz = 0; p.down = p.bound = false;
    p.sinbin = 0; p.recoverT = p.diveT = p.beatenT = 0;
  }
  d.L('A', 9).x = -22; d.L('A', 9).z = -30;
  d.syncBallSocket();
  return d;
}
function tick(d: Director, frames = 1) {
  for (let i = 0; i < frames; i++) d.update(DT, NO_INPUT, none, none);
}

check('loose-ball support is independent of the former carrier position', () => {
  function marks(x: number) {
    const d = lab(), old = d.L('A', 9);
    old.x = x; old.sinbin = 100;
    const b = makeBall(12, 8, 15); b.vz = 2;
    adoptLooseBall(d, b, 'STRIP', old);
    tick(d);
    return d.live.filter(p => p !== old).map(p => [p.team, p.num, p.tx, p.tz, p.job]);
  }
  assert.deepEqual(marks(-26), marks(26), 'the team is still following an empty-handed player');
});

check('pass support reloads behind the arriving ball, not behind the passer', () => {
  const d = lab(), s = d.op!;
  Object.assign(s.ball, makeBall(4, 2, 2), { live: true, t: 0, vx: 10, vy: -0.4, vz: -2 });
  s.pendingReceiver = 10; s.passT = 0.5; s.passDist = 13; s.passPace = 1;
  s.passTargetX = 9; s.passTargetZ = 1;
  const rec = d.L('A', 10); rec.x = 10; rec.z = 1;
  tick(d);
  const support = d.L('A', 8);
  assert(Math.hypot(support.tx - 9, support.tz - 1) < 24,
    `support stayed at old passer (${support.tx.toFixed(1)}, ${support.tz.toFixed(1)})`);
  assert(support.tz < 1, 'support ran ahead of the incoming receiver');
});

check('the closest available prop fields a rolling kick instead of watching the fullback', () => {
  const d = lab();
  d.startKick('A', 'PUNT', { x: -20, z: -20 }); d.launch(0.5, 1);
  const k = d.kk!, b = k.body;
  Object.assign(b, makeBall(0, 0.095, 5), { vx: 3, vz: 1, bounces: 4, grounded: true });
  k.bx = b.x; k.by = b.y; k.bz = b.z; k.vx = b.vx; k.vy = 0; k.vz = b.vz; k.bounces = 4;
  const prop = d.L('B', 3); prop.x = 2; prop.z = 5;
  d.L('B', 15).x = 22; d.L('B', 15).z = 35;
  tick(d);
  assert(Math.hypot(prop.tx - b.x, prop.tz - b.z) < 3,
    `nearest player is not fielding: ${prop.job}, mark (${prop.tx}, ${prop.tz})`);
});

check('a beaten defender turns and chases; attackers are not mistaken for cover defenders', () => {
  const d = lab(true), car = d.L('A', 9);
  for (const p of d.live) if (p !== car) p.sinbin = 100;
  car.x = 0; car.z = 0; car.vx = car.vz = 0;
  const defender = d.L('B', 14); defender.sinbin = 0; defender.x = 1; defender.z = -5;
  tick(d);
  assert(Math.hypot(defender.tx - car.x, defender.tz - car.z) < 3,
    `beaten defender is not chasing: ${defender.job}`);
});

check('both backlines stage behind the ball in a legal receiving echelon', () => {
  for (const team of ['A', 'B'] as const) {
    const d = lab(true); d.teams[team].cpu = false;
    const car = d.L(team, 9); car.x = 0; car.z = 0;
    d.startOpen(team, 0, 0, 9, 1, 0, 30);
    for (const p of d.live) if (p.team !== team) p.beatenT = 100;
    tick(d);
    const dir = team === 'A' ? 1 : -1;
    const ten = d.L(team, 10), twelve = d.L(team, 12), thirteen = d.L(team, 13);
    assert((car.z - ten.tz) * dir >= 3.5, 'fly-half pocket is in front of the ball');
    assert((ten.tz - twelve.tz) * dir > 2, 'twelve is ahead of the first receiver');
    assert((twelve.tz - thirteen.tz) * dir > 2, 'thirteen is ahead of twelve');
    assert.equal(readBall(d).holder, car);
    const defence = team === 'A' ? 'B' : 'A';
    for (const num of [10, 12, 13, 15]) {
      const defender = d.L(defence, num);
      assert((defender.tz - car.z) * dir > 0, `defender ${defence}:${num} marked behind the attacker instead of protecting his own goal`);
    }
  }
});

check('all held-ball support paths stay behind the ball and centimetre drift does not flip the lanes', () => {
  const d = lab(true), car = d.L('A', 9);
  car.x = car.z = car.vx = car.vz = 0;
  let side = 0;
  for (let frame = 0; frame < 12; frame++) {
    car.x = frame % 2 ? 0.03 : -0.03; tick(d);
    for (const p of d.live) if (p.team === 'A' && p !== car) {
      assert(p.tz < car.z, `${p.num} requested a forward pass (${p.job})`);
    }
    const next = Math.sign(d.L('A', 10).tx - car.x);
    if (side) assert.equal(next, side, 'the whole backline changed sides after a 6 cm drift');
    side = next;
  }
});

check('the HUD describes an unowned ball instead of offering a pass or tackle on the old carrier', () => {
  const d = lab();
  adoptLooseBall(d, makeBall(0, 8, 0), 'STRIP', d.L('A', 9)); tick(d);
  assert(/LOOSE BALL/.test(d.narrative.now));
  assert.equal(d.contextVerb.label, 'CHASE THE BALL');
  assert(d.actionBar.some(a => a.key === 'Q'));
  assert(!d.actionBar.some(a => /PASS|TACKLE|DISTRIBUTE/.test(a.label)));
});

check('the last fullback turns to chase when beaten, instead of abandoning the runner', () => {
  const d = lab(true), car = d.L('A', 9);
  for (const p of d.live) if (p !== car) p.sinbin = 100;
  car.x = car.z = car.vx = car.vz = 0;
  const last = d.L('B', 15); last.sinbin = 0; last.x = 0.4; last.z = -4;
  tick(d);
  assert(Math.hypot(last.tx - car.x, last.tz - car.z) < 2);
  assert(last.urgency === 1 && /CHASE/.test(last.job));
});

check('free-ball roles keep one collector, close support and wider goal-side cover', () => {
  const d = lab(), b = makeBall(0, 8, 0);
  adoptLooseBall(d, b, 'STRIP', d.L('A', 9)); tick(d);
  for (const team of ['A', 'B'] as const) {
    const tasks = [...d.ballBehaviour.tasks].filter(([key]) => key.startsWith(team));
    assert.equal(tasks.filter(([, t]) => t.role === 'COLLECT').length, 1);
    assert.equal(tasks.filter(([, t]) => t.role === 'SUPPORT').length, 1);
    const covers = tasks.filter(([, t]) => t.role === 'COVER').map(([, t]) => t);
    assert(covers.length >= 10, 'the entire team swarmed the ball');
    assert(Math.max(...covers.map(t => t.x)) - Math.min(...covers.map(t => t.x)) >= 30, 'cover collapsed into one channel');
    const dir = team === 'A' ? 1 : -1, z = d.ballBehaviour.read!.target.z;
    assert(covers.every(t => (z - t.z) * dir >= 6), 'cover stood beyond the contest instead of protecting its own goal');
  }
  assert.equal(d.ballBehaviour.read?.holder, null, 'free ball has a phantom carrier');
});

check('collector choice resists tiny ETA fluctuations but responds to a big deflection or injury', () => {
  const d = lab();
  for (const p of d.live) p.sinbin = 100;
  const one = d.L('A', 3), two = d.L('A', 4);
  for (const p of [one, two]) { p.sinbin = 0; p.x = 5; p.z = 0; p.size = 1; p.attrs.SPD = 80; }
  const b = makeBall(0, 8, 0); adoptLooseBall(d, b, 'STRIP', d.L('A', 9));
  coordinateBall(d);
  const first = d.ballBehaviour.collectors.A;
  for (let i = 0; i < 30; i++) {
    one.x = 5 + (i % 2 ? 0.02 : -0.02); two.x = 10 - one.x;
    coordinateBall(d);
    assert.equal(d.ballBehaviour.collectors.A, first, 'players swapped collector/support jobs on a near-tie');
  }
  const other = d.L('A', 7); other.sinbin = 0; other.x = -13; other.z = 0;
  b.vx = -12; coordinateBall(d);
  assert.equal(d.ballBehaviour.collectors.A, 7, 'deflection did not change the interception decision');
  assert.equal(d.ballBehaviour.tasks.get('A:7')!.x, predictBall(b).x);
  other.down = true; coordinateBall(d);
  assert.notEqual(d.ballBehaviour.collectors.A, 7, 'an injured collector retained the job');
  assert(!d.ballBehaviour.tasks.has('A:7'));
});

check('pass defence shifts to the receiving channel; support remains available behind it', () => {
  const d = lab(), s = d.op!;
  Object.assign(s.ball, makeBall(2, 3, 1), { live: true, t: 0, vx: 18, vz: 0, vy: 0 });
  s.passT = 0.5; s.passDist = 13; s.passPace = 1; s.pendingReceiver = 10;
  s.passTargetX = 11; s.passTargetZ = 1;
  const r = readBall(d);
  assert.equal(r.holder, null); assert.equal(r.receiver?.num, 10);
  assert.equal(r.target.x, 11);
  coordinateBall(d);
  const line = [...d.ballBehaviour.tasks].filter(([key, task]) => key.startsWith('B') && task.role === 'CONTAIN');
  assert.equal(line.length, 2);
  assert(line.every(([, task]) => Math.abs(task.x - 11) <= 3 && task.z > 1), 'defence chased the passer or the wrong side of the catch');
  assert(d.ballBehaviour.tasks.get('A:8')!.z < 1, 'offload support ran ahead of the catch');
  s.ball.vx = -18; // current ball velocity, not stale passTargetX, must drive the read
  coordinateBall(d);
  assert.equal(d.ballBehaviour.read!.target.x, -7);
  assert([...d.ballBehaviour.tasks].filter(([key, task]) => key.startsWith('B') && task.role === 'CONTAIN')
    .every(([, task]) => Math.abs(task.x + 7) <= 3));
});

check('kick chasers ahead at release retreat, cannot field, and can be put onside', () => {
  for (const team of ['A', 'B'] as const) {
    const d = lab(), dir = team === 'A' ? 1 : -1;
    const kicker = d.L(team, 9), wing = d.L(team, 14);
    kicker.x = kicker.z = kicker.vx = kicker.vz = 0;
    wing.x = 0; wing.z = dir * 10;
    d.startOpen(team, 0, 0, 9); kicker.x = kicker.z = 0;
    d.startKick(team, 'PUNT', { x: 0, z: 0 }, 9); d.launch(0.5, 1);
    const k = d.kk!;
    Object.assign(k.body, makeBall(0, 6, dir * 10));
    k.bx = 0; k.by = 6; k.bz = dir * 10; k.vx = k.vy = k.vz = 0;
    // Other initially-onside players cannot already be ahead in this fixture.
    for (const p of d.live) if (p.team === team && p !== wing && p !== kicker) p.z = -dir * 8;
    tick(d);
    assert(!canPlayBall(d, wing), 'offside winger could play the kick');
    assert.equal(d.ballBehaviour.tasks.get(`${team}:14`)?.role, 'RETREAT');
    assert((wing.tz - wing.z) * dir < 0, 'offside chaser was sent farther upfield');
    kicker.z = dir * 11; tick(d);
    assert(canPlayBall(d, wing), 'onside team-mate running past did not put the winger onside');
  }
});

check('human kick fielding is moved exactly once, even with a chase-shirt number', () => {
  const d = lab(true);
  d.startKick('B', 'PUNT', { x: -20, z: 20 }); d.launch(0.5, 1);
  const k = d.kk!;
  Object.assign(k.body, makeBall(0, 10, 0));
  k.bx = 0; k.by = 10; k.bz = 0; k.vx = k.vy = k.vz = 0;
  const human = d.L('A', 11); human.x = -5; human.z = 0; human.vx = human.vz = 0;
  d.setCtrl('A', 11);
  const want = maxSpeed(human, false, false, human.stamina) * 0.86 * (1 - Math.exp(-9 * DT));
  d.update(DT, { ...NO_INPUT, right: true }, none, none);
  assert.equal(human.movedBy, 'input');
  assert(Math.abs(human.vx - want) < 1e-9, 'kick choreography replaced the stick velocity');
  assert(Math.abs(human.x - (-5 + want * DT)) < 1e-9, 'kick phase moved the player a second time');
});

check('human pass receiver retains the stick instead of being steered by two owners', () => {
  const d = lab(true), s = d.op!, p = d.L('A', 10);
  p.x = p.z = p.vx = p.vz = 0; d.setCtrl('A', 10); d.relativeControls = false;
  Object.assign(s.ball, makeBall(5, 4, 0), { live: true, t: 0, vx: 3 });
  s.pendingReceiver = 10; s.passDist = 13; s.passT = 0; s.passPace = 1;
  d.update(DT, { ...NO_INPUT, right: true }, none, none);
  assert.equal(p.movedBy, 'input');
  const want = maxSpeed(p, false, false, p.stamina) * 0.9 * (1 - Math.exp(-7.5 * DT));
  assert(Math.abs(p.vx - want) < 1e-9, 'pass handler injected velocity into the controlled receiver');
  assert(Math.abs(p.x - want * DT) < 1e-9, 'pass receiver was integrated twice');
});

check('a gather or a whistle clears stale chase/attention roles immediately', () => {
  const d = lab();
  adoptLooseBall(d, makeBall(0, 8, 5), 'STRIP', d.L('A', 9)); tick(d);
  assert(d.ballBehaviour.tasks.size > 0);
  const p = d.L('B', 3);
  d.startOpen('B', p.x, p.z, 3, 1, 0, 2, true); tick(d);
  assert.equal(d.ballBehaviour.read?.kind, 'HELD');
  assert.equal(d.ballBehaviour.read?.holder, p);
  assert.equal(d.ballBehaviour.tasks.size, 0);
  adoptLooseBall(d, makeBall(0, 8, 5), 'STRIP', p); tick(d);
  d.startScrum('A', 0, 0);
  assert.equal(d.ballBehaviour.tasks.size, 0, 'whistle left an old flight plan live');
  assert.equal(d.ballBehaviour.read, null);
});

check('waiting collectors look and reach at the actual ball in the real render path', () => {
  const d = lab(true);
  for (const p of d.live) p.sinbin = 100;
  const p = d.L('A', 3); p.sinbin = 0; p.x = 0.6; p.z = 0; d.setCtrl('A', 3);
  adoptLooseBall(d, makeBall(0, 1.7, 0), 'STRIP', d.L('A', 9)); tick(d);
  assert(ballReach(d, p) > 0.5, 'collector had no hand intent');
  const actor = d.actors.find(a => a.team === 'A' && a.num === 3)!;
  assert.equal(actor.ballLookX, d.bc.free!.x); assert.equal(actor.ballLookZ, d.bc.free!.z);
  const scene = new THREE.Scene(), manager = new ThreePlayerManager({ scene } as ThreeCanvas);
  const rig = manager as unknown as { updateStandIn(d: Director, dt: number): void; standInState: Map<string, { face: number }>; standIn: Map<string, THREE.Group> };
  // Supply already-loaded Three roots so only font/DOM asset creation is
  // bypassed; the production heading/transform update is exercised intact.
  for (const a of d.actors) {
    const root = new THREE.Group(); scene.add(root); rig.standIn.set(`${a.team}:${a.num}`, root);
  }
  rig.updateStandIn(d, DT);
  const face = rig.standInState.get('A:3')!.face;
  assert(face < -0.05, 'waiting collector kept facing away instead of turning to the ball');
  scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      (m as THREE.MeshToonMaterial).map?.dispose(); (m as THREE.MeshToonMaterial).gradientMap?.dispose(); m.dispose();
    }
  } });
});

check('ball-driven roles stay finite and catchable at 30/60/120 Hz without position jumps', () => {
  for (const hz of [30, 60, 120]) {
    const d = lab(), b = makeBall(0, 5, 0); b.vx = 3;
    adoptLooseBall(d, b, 'STRIP', d.L('A', 9));
    let gathered = false;
    for (let frame = 0; frame < hz * 10 && !gathered; frame++) {
      const before = d.live.map(p => ({ x: p.x, z: p.z }));
      d.update(1 / hz, NO_INPUT, none, none);
      for (let i = 0; i < d.live.length; i++) {
        const p = d.live[i];
        assert([p.x, p.z, p.vx, p.vz, p.tx, p.tz].every(Number.isFinite));
        assert(Math.hypot(p.x - before[i].x, p.z - before[i].z) < 0.55, `double movement at ${hz} Hz`);
      }
      gathered = d.phase === 'OPEN_PLAY' && !d.bc.free && !d.op?.ball.live;
    }
    assert(gathered, `nobody collected the ball at ${hz} Hz`);
    assert.equal(d.watchdogTrips, 0, d.watchdogLog.join('\n'));
  }
});
console.log(`\nBALL BEHAVIOUR PROBE: ${checks - failures}/${checks} PASS`);
process.exitCode = failures ? 1 : 0;
