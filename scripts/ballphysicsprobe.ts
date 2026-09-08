/** TARCS rugby ball: real production solver + phase/socket/render integrations.
 * Run: npx tsx scripts/ballphysicsprobe.ts — no browser, WebGL, or asset fetch.
 * Exit 0 only if every check passes; fixtures never substitute a physics solver.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';
import { seedRng } from '../src/game/seed';
import {
  makeBall, stepBall, weldBall, detachBall, ballContact, touchBall,
  BALL_MAJOR, BALL_MINOR, BALL_MASS, BALL_GRAVITY, BALL_RESTITUTION,
  type BallBody, type BallCarrierPose,
} from '../src/game/engine/ballPhysics';
import { stepCraft } from '../src/game/engine/ballcraft';
import { RapierWorld } from '../src/core/physics/RapierWorld';
import { buildRugbyBallMesh, turfRiseM } from '../src/render/ThreeEnvironment';
import { ThreePlayerManager } from '../src/render/ThreePlayerManager';
import type { ThreeCanvas } from '../src/render/ThreeCanvas';
import { RENDER_SCALE } from '../src/render/retro';

const DT = 1 / 60;
let failures = 0;
let checks = 0;
const near = (a: number, b: number, eps = 1e-8) => assert(Math.abs(a - b) <= eps, `${a} != ${b} (tol ${eps})`);
async function check(name: string, fn: () => void | Promise<void>) {
  checks++;
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}\n${e instanceof Error ? e.stack : String(e)}`); }
}
function sane(b: BallBody) {
  assert([b.x, b.y, b.z, b.vx, b.vy, b.vz, ...Object.values(b.q), ...Object.values(b.omega)].every(Number.isFinite));
  near(Math.hypot(b.q.x, b.q.y, b.q.z, b.q.w), 1, 1e-10);
  assert(b.y >= 0 && b.y >= ballContact(b.q).height - 1e-9, 'spheroid penetrated the pitch');
}
function lab() {
  seedRng(103);
  const d = new Director(quickStartConfig({ cpuA: false, cpuB: true }));
  d.startOpen('A', 0, -24, 9, 1, 0, 20);
  d.kk = undefined;
  const car = d.L('A', 9);
  car.x = 0; car.z = -24; car.vx = 2; car.vz = 8;
  for (const p of d.live) if (p !== car) {
    // Isolate ball mechanics from tackles/referee entry gates, not from movement.
    p.x = p.team === 'A' ? -25 : 25; p.z = p.team === 'A' ? -38 : 36;
    p.vx = p.vz = 0;
    if (p.team === 'B') p.beatenT = 100;
  }
  d.syncBallSocket();
  return d;
}
function socketPoint(p: BallCarrierPose) {
  const speed = Math.hypot(p.vx, p.vz);
  const fx = speed > 0.15 ? p.vx / speed : 0, fz = speed > 0.15 ? p.vz / speed : Math.sign(p.face);
  return { x: p.x + (0.2 * fx + 0.1 * fz) * p.size,
    y: (p.y ?? 0) + 1.05 * p.size, z: p.z + (0.2 * fz - 0.1 * fx) * p.size };
}

await check('(a) 4 m drops — eccentric tip, symmetric belly, restitution and energy', () => {
  function drop(tip: boolean) {
    const b = makeBall(0, 4, 0);
    if (tip) { b.q.z = Math.SQRT1_2; b.q.w = Math.SQRT1_2; }
    let beforeVy = 0;
    for (let i = 0; i < 600 && b.bounces === 0; i++) {
      beforeVy = b.vy;
      stepBall(b, 1 / 240);
      sane(b);
    }
    assert.equal(b.bounces, 1, 'drop never contacted the turf');
    return { b, impactSpeed: Math.abs(beforeVy - BALL_GRAVITY / 240) };
  }
  const tip = drop(true), belly = drop(false);
  assert(Math.hypot(tip.b.omega.x, tip.b.omega.y, tip.b.omega.z) > 1, 'tip did not tumble');
  assert(Math.hypot(tip.b.vx, tip.b.vz) > 0.1, 'tip did not kick sideways');
  assert(tip.b.vy > 0, 'tip did not rebound');
  near(belly.b.vx, 0); near(belly.b.vz, 0);
  near(Math.hypot(...Object.values(belly.b.omega)), 0);
  near(belly.b.vy / belly.impactSpeed, BALL_RESTITUTION, 1e-9);
  assert(belly.b.vy > tip.b.vy, 'tip failed to trade vertical rebound for tumbling');
  const q = tip.b.q, o = tip.b.omega;
  const axial = o.x * (1 - 2 * (q.y ** 2 + q.z ** 2)) + o.y * 2 * (q.x * q.y + q.w * q.z)
    + o.z * 2 * (q.x * q.z - q.w * q.y);
  const sideI = BALL_MASS * (BALL_MAJOR ** 2 + BALL_MINOR ** 2) / 5;
  const longI = 2 * BALL_MASS * BALL_MINOR ** 2 / 5;
  const reboundEnergy = 0.5 * BALL_MASS * (tip.b.vx ** 2 + tip.b.vy ** 2 + tip.b.vz ** 2)
    + 0.5 * sideI * (o.x ** 2 + o.y ** 2 + o.z ** 2 - axial ** 2) + 0.5 * longI * axial ** 2;
  assert(reboundEnergy < BALL_MASS * BALL_GRAVITY * (4 - BALL_MAJOR), 'impact added energy');
  console.log(`  tip: lateral ${Math.hypot(tip.b.vx, tip.b.vz).toFixed(3)} m/s, spin ${Math.hypot(...Object.values(o)).toFixed(3)} rad/s; belly e=${(belly.b.vy / belly.impactSpeed).toFixed(3)}`);
});

await check('(b) 10 m/s rolls — slide, end-over-end tumble, exact stable rest at 30/60/120 Hz', () => {
  let maxSettle = 0;
  for (const hz of [30, 60, 120]) {
    for (const [vx, vz, tilt] of [[10, 0, 0], [0, 10, 0], [6, 8, 0.63], [10, 0, Math.PI / 2]]) {
      const b = makeBall();
      b.q.z = Math.sin(tilt / 2); b.q.w = Math.cos(tilt / 2);
      b.y = ballContact(b.q).height; b.vx = vx; b.vz = vz;
      let i = 0;
      for (; i < 25 * hz && !b.sleeping; i++) { stepBall(b, 1 / hz); sane(b); }
      assert(b.sleeping, `roll at ${hz} Hz failed to settle`);
      assert.equal(b.vx, 0); assert.equal(b.vz, 0); assert.equal(b.vy, 0);
      assert.equal(Math.hypot(...Object.values(b.omega)), 0);
      assert(b.grounded && b.y >= BALL_MINOR);
      maxSettle = Math.max(maxSettle, i / hz);
      const atRest = JSON.stringify(b);
      for (let t = 0; t < 5 * hz; t++) stepBall(b, 1 / hz);
      assert.equal(JSON.stringify(b), atRest, 'sleeping ball drifted/oscillated');
      b.vx = 1;
      stepBall(b, 1 / hz);
      assert(!b.sleeping && b.x !== JSON.parse(atRest).x, 'an impulse failed to wake the ball');
    }
  }
  console.log(`  12/12 launches stopped; slowest ${maxSettle.toFixed(2)} s, no penetration or sleeping drift`);
});

await check('Orientation/contact sweep — oblique impacts, normalized q, no RNG or tunnelling', () => {
  const oldRandom = Math.random;
  Math.random = () => { throw new Error('ball physics consumed gameplay RNG'); };
  try {
    for (let i = 0; i < 32; i++) {
      const b = makeBall(0, 4, 0), axis = new THREE.Vector3(0.2 + i / 32, 1, 0.7).normalize();
      const angle = i * Math.PI / 16, k = Math.sin(angle / 2);
      b.q = { x: axis.x * k, y: axis.y * k, z: axis.z * k, w: Math.cos(angle / 2) };
      b.vx = (i % 5) - 2; b.vy = -35; b.vz = (i % 7) - 3;
      const copy = structuredClone(b);
      for (let tick = 0; tick < 160; tick++) {
        stepBall(b, 1 / 20); stepBall(copy, 1 / 20); sane(b);
      }
      assert.deepEqual(b, copy, 'identical contact states diverged');
    }
  } finally { Math.random = oldRandom; }
});

await check('(c) Exact torso weld and v_carrier + J/m detachment', () => {
  const b = makeBall();
  const p: BallCarrierPose = { team: 'A', num: 9, x: -3, y: 0, z: -10, vx: 6, vy: 0, vz: 8, size: 1.04, face: 1 };
  for (let i = 0; i < 180; i++) {
    p.x += p.vx * DT; p.z += p.vz * DT;
    if (i === 90) { p.vx = -6; p.vz = -8; p.face = -1; }
    weldBall(b, p);
    const want = socketPoint(p);
    near(b.x, want.x); near(b.y, want.y); near(b.z, want.z);
    near(b.vx, p.vx); near(b.vz, p.vz);
    assert.equal(b.socket, 'A:9');
    const pose = JSON.stringify(b);
    stepBall(b, DT);
    assert.equal(JSON.stringify(b), pose, 'gravity or angular integration fought the weld');
  }
  const release = structuredClone(b), impulse = { x: 2.1, y: 1.3, z: -0.8 };
  detachBall(b, p, impulse);
  assert.equal(b.socket, null);
  near(b.x, release.x); near(b.y, release.y); near(b.z, release.z);
  assert.deepEqual(b.q, release.q, 'release snapped the orientation');
  near(b.vx, p.vx + impulse.x / BALL_MASS); near(b.vy, impulse.y / BALL_MASS);
  near(b.vz, p.vz + impulse.z / BALL_MASS);
  p.x += 100; p.z += 100;
  const x = b.x, z = b.z, vx = b.vx, vz = b.vz;
  stepBall(b, DT);
  near(b.x, x + vx * DT); near(b.z, z + vz * DT);
});

await check('Live sprint/pass — held secure cannot cancel release; no leaked grip/socket', () => {
  const d = lab();
  const s = d.op!, car = d.L('A', 9);
  stepCraft(d, DT, true, false, false, new Set(), new Set());
  stepCraft(d, DT, true, true, false, new Set(['secure']), new Set());
  assert.equal(d.bc.state, 'BALL_SECURED');
  for (let i = 0; i < 45; i++) {
    d.update(DT, { ...NO_INPUT, up: true, run: true, sprint: true, handsUp: true, secure: true }, new Set());
    assert.equal(d.op, s);
    const want = socketPoint(car);
    near(s.ball.x, want.x); near(s.ball.y, want.y); near(s.ball.z, want.z);
    assert.equal(s.ball.socket, 'A:9');
  }
  const rec = d.L('A', 10);
  rec.x = car.x + 8; rec.z = car.z - 5; rec.vx = 0; rec.vz = 3;
  const release = { x: s.ball.x, y: s.ball.y, z: s.ball.z };
  seedRng(103); // successful handling roll; a handling error is not a pass fixture
  assert(d.doPassToNum(10, false), 'pass did not dispatch');
  assert(s.ball.live, 'fixture failed to release a legal pass');
  near(s.ball.x, release.x); near(s.ball.y, release.y); near(s.ball.z, release.z);
  assert.equal(s.ball.socket, null); assert(!d.bc.ownsBall && !d.bc.free);
  assert.equal(d.bc.state, 'IDLE');
  const vx = s.ball.vx, vz = s.ball.vz;
  for (let i = 1; i <= 3; i++) {
    d.update(DT, { ...NO_INPUT, handsUp: true, secure: true }, new Set(), new Set());
    assert(s.ball.live, 'held LMB re-welded the departing pass');
    near(s.ball.x, release.x + vx * i * DT); near(s.ball.z, release.z + vz * i * DT);
    assert.equal(s.ball.socket, null); assert(!d.bc.ownsBall);
  }
  for (let i = 0; i < 120 && s.ball.live; i++) d.upOpen(DT, NO_INPUT, new Set());
  assert.equal(s.carrierNum, 10); assert.equal(s.ball.socket, 'A:10');
  d.startScrum('B', rec.x, rec.z);
  d.releaseBallControl(); // teardown is idempotent
  assert.equal(s.ball.socket, null); assert(!d.bc.ownsBall && !d.bc.free && !d.bc.foot);
  assert.equal(d.bc.window, 0);
});

await check('Drop/strip/kick — full inherited momentum and per-match free bodies', () => {
  const d = lab(), other = lab(), car = d.L('A', 9), s = d.op!;
  assert.notEqual(d.bc.looseBody, other.bc.looseBody);
  assert.notEqual(d.bc.looseBody.q, other.bc.looseBody.q);
  d.bc.state = 'BALL_SECURED'; d.bc.ownsBall = true;
  const want = socketPoint(car);
  stepCraft(d, DT, true, false, false, new Set(), new Set(['secure']));
  const drop = d.bc.free!;
  assert(drop); near(drop.x, want.x); near(drop.y, want.y); near(drop.z, want.z);
  near(drop.vx, car.vx); near(drop.vz, car.vz); near(drop.vy, 0.4);
  assert.equal(drop.socket, null); assert.equal(s.ball.socket, null);
  const untouched = JSON.stringify(other.bc.looseBody);
  stepCraft(d, DT, true, false, false, new Set(), new Set());
  assert.equal(JSON.stringify(other.bc.looseBody), untouched);

  const stripped = lab(), handler = stripped.L('A', 9), tackler = stripped.L('B', 7);
  tackler.x = handler.x + 0.4; tackler.z = handler.z;
  tackler.vx = -2; tackler.vz = -2; tackler.attrs.AGG = 100; handler.attrs.SKL = 1;
  stripped.bc.state = 'BALL_SECURED'; stripped.bc.ownsBall = true;
  seedRng(1); // first contact wins the security roll
  stepCraft(stripped, DT, true, false, false, new Set(), new Set());
  assert.equal(stripped.bc.state, 'LOOSE');
  const spill = stripped.bc.free!;
  assert(spill && !stripped.bc.ownsBall && spill.socket === null);
  near(spill.vx, handler.vx - 2); near(spill.vz, handler.vz - 2.2);
  assert.equal(stripped.op!.ball.socket, null);

  const kick = lab(), kicker = kick.L('A', 9), kickOrigin = socketPoint(kicker), old = kick.op!;
  kick.startKick('A', 'PUNT', { x: kicker.x, z: kicker.z }, 9);
  const k = kick.kk!;
  seedRng(9); kick.launch(0.65, 1);
  const speed = kick.kickReach(k, 0.65) / 2;
  near(Math.hypot(k.vx - kicker.vx, k.vz - kicker.vz), speed);
  near(k.bx, kickOrigin.x); near(k.by, kickOrigin.y); near(k.bz, kickOrigin.z);
  assert.equal(k.body.socket, null); assert.equal(old.ball.socket, null);
  assert(!kick.bc.ownsBall && !kick.bc.free);
});

await check('Determinism guard — conversions, penalty shots and lineout throws', () => {
  for (const conversion of [false, true]) {
    const d = lab();
    if (conversion) {
      const car = d.L('A', 9);
      car.x = 0; car.z = 51; d.op!.carrierX = 0; d.op!.carrierZ = 51;
      d.scoreTry();
    } else d.startKick('A', 'GOAL', { x: 0, z: 15 });
    const k = d.kk!, p = d.L(k.kicker, k.kickerNum);
    p.vx = 9; p.vz = -7; // a walk-up must NEVER add to the placed strike
    seedRng(73); d.launch(0.8, 1);
    assert(k.body.flightGuard && !k.fromHand);
    const origin = { x: k.bx, y: k.by, z: k.bz, vx: k.vx, vy: k.vy, vz: k.vz };
    near(Math.hypot(k.vx, k.vz), d.kickReach(k, 0.8) / 2.9);
    const spin = { ...k.body.omega };
    for (let i = 1; i <= 60; i++) {
      d.upKick(DT, NO_INPUT, new Set());
      const t = i * DT;
      near(k.bx, origin.x + origin.vx * t); near(k.bz, origin.z + origin.vz * t);
      near(k.by, origin.y + origin.vy * t - 0.5 * BALL_GRAVITY * t * t);
      assert(k.body.flightGuard && k.bounces === 0);
      assert.deepEqual(k.body.omega, spin, 'placed flight acquired eccentric torque');
    }
  }
  const d = lab();
  d.startLineout('A', 5, 6);
  d.lo!.meter = 0.62; d.releaseThrow();
  const lo = d.lo!, b = lo.ball, origin = structuredClone(b);
  assert(b.flightGuard);
  for (let i = 1; i <= 60; i++) {
    d.upLineout(DT, NO_INPUT, new Set());
    near(b.x, origin.x + origin.vx * i * DT);
    near(b.z, origin.z);
    near(b.y, origin.y + origin.vy * i * DT - 0.5 * BALL_GRAVITY * (i * DT) ** 2);
    assert(b.flightGuard && b.bounces === 0);
    assert.deepEqual(b.omega, origin.omega);
  }
  touchBall(b); assert(!b.flightGuard, 'player contact did not lift the guard');
  const tip = makeBall(0, 0.2, 0);
  tip.q.z = tip.q.w = Math.SQRT1_2; tip.flightGuard = true; tip.vy = -5;
  for (let i = 0; i < 60 && tip.bounces === 0; i++) stepBall(tip, DT);
  assert(tip.bounces > 0 && !tip.flightGuard && Math.hypot(...Object.values(tip.omega)) > 0.5);
});

await check('Permanent 3D egg mesh — dimensions, panels/seams, simulated q, no idle render spin', () => {
  const mesh = buildRugbyBallMesh();
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
  near(size.x, 0.28, 1e-7); near(size.y, 0.19, 1e-7); near(size.z, 0.19, 1e-7);
  assert(mesh.geometry instanceof THREE.SphereGeometry && mesh.material instanceof THREE.MeshToonMaterial);
  assert(mesh.material.map instanceof THREE.DataTexture && !mesh.material.transparent);
  const pixels = mesh.material.map.image.data as Uint8Array;
  let dark = 0, light = 0;
  for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] < 50) dark++; if (pixels[i] > 220) light++; }
  assert(dark > 1000 && light > 1000, 'panel/seam texture lacks contrast');
  mesh.geometry.dispose(); mesh.material.map.dispose(); mesh.material.gradientMap?.dispose(); mesh.material.dispose();

  // Construct the real manager WITHOUT loading a GLB or allocating WebGL.
  const scene = new THREE.Scene();
  const manager = new ThreePlayerManager({ scene } as ThreeCanvas);
  const draw = (d: Director) => (manager as unknown as { updateBall(d: Director, dt: number): void }).updateBall(d, DT);
  const ball = scene.getObjectByName('Ball3D')!;
  assert(ball && ball.visible, 'ball hidden before squad assets load');
  const d = lab();
  draw(d);
  assert(ball.visible && ball.parent === scene);
  near(ball.position.x, d.op!.ball.x * RENDER_SCALE);
  near(ball.position.y, (d.op!.ball.y + turfRiseM(d.op!.ball.x)) * RENDER_SCALE);
  near(ball.position.z, -d.op!.ball.z * RENDER_SCALE);
  const q = d.op!.ball.q;
  near(ball.quaternion.x, -q.x); near(ball.quaternion.y, -q.y);
  near(ball.quaternion.z, q.z); near(ball.quaternion.w, q.w);
  const before = ball.quaternion.clone();
  for (let i = 0; i < 120; i++) draw(d);
  assert(ball.quaternion.equals(before), 'renderer invented spin on an unchanged body');
  for (const begin of [() => d.startLineout('A', 5, 6), () => d.startScrum('A', 0, 5),
    () => d.startKick('A', 'GOAL', { x: 0, z: 20 })]) {
    begin(); draw(d); assert(ball.visible && ball.parent === scene, 'ball vanished during a ritual');
    assert.equal(scene.getObjectsByProperty('name', 'Ball3D').length, 1, 'duplicate ball entity');
  }
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        (m as THREE.MeshToonMaterial).map?.dispose(); (m as THREE.MeshToonMaterial).gradientMap?.dispose(); m.dispose();
      }
    }
  });
});

await check('Rapier weld — rotated socket, angular momentum, repeated releases leak 0 joints', async () => {
  const world = await RapierWorld.create();
  try {
    world.world.gravity = { x: 0, y: 0, z: 0 };
    const carrier = world.addTabsPlayer({ x: 0, y: 0, z: 0, vx: 2, vz: 8 });
    for (const part of carrier.bodies) part.setBodyType(RAPIER.RigidBodyType.KinematicVelocityBased, true);
    const chest = carrier.chest;
    chest.setRotation({ x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) }, true);
    chest.setAngvel({ x: 0, y: 0.4, z: 0 }, true);
    chest.setLinvel({ x: 2, y: 0, z: 8 }, true);
    const b = world.addBall({ radius: BALL_MINOR, x: 0, y: 1, z: 0 });
    const collider = b.collider(0), groups = collider.collisionGroups(), events = collider.activeEvents();
    const threshold = collider.contactForceEventThreshold();
    const baseJoints = world.world.impulseJoints.len(), offset = new THREE.Vector3(0.05, -0.1, 0.3);
    const expectedPoint = () => offset.clone().applyQuaternion(new THREE.Quaternion().copy(chest.rotation()))
      .add(new THREE.Vector3().copy(chest.translation()));
    for (let trial = 0; trial < 24; trial++) {
      const weld = world.attachBallToCarrier(carrier, b, { breakImpulse: 1e6, carryOffset: offset });
      const target = expectedPoint();
      near(b.translation().x, target.x, 1e-6); near(b.translation().y, target.y, 1e-6); near(b.translation().z, target.z, 1e-6);
      const orientation = b.rotation(), wantQ = chest.rotation();
      near(orientation.x, wantQ.x, 1e-6); near(orientation.y, wantQ.y, 1e-6);
      near(orientation.z, wantQ.z, 1e-6); near(orientation.w, wantQ.w, 1e-6);
      assert.equal(world.world.impulseJoints.len(), baseJoints + 1);
      if (trial === 0) for (let i = 0; i < 90; i++) {
        world.step(DT);
        assert(new THREE.Vector3().copy(b.translation()).distanceTo(expectedPoint()) < 0.04, 'sprint weld drifted');
        assert(weld.held);
      }
      const v = chest.velocityAtPoint(b.translation()), impulse = { x: 0.7, y: 0.2, z: -0.4 }, mass = b.mass();
      assert(weld.release('PASS', impulse));
      near(b.linvel().x, v.x + impulse.x / mass, 2e-5);
      near(b.linvel().y, v.y + impulse.y / mass, 2e-5);
      near(b.linvel().z, v.z + impulse.z / mass, 2e-5);
      assert.equal(world.world.impulseJoints.len(), baseJoints, 'leaked ball joint');
      assert(!weld.held && weld.joint === null && weld.state === 'DROP_BALL');
      assert.equal(collider.collisionGroups(), groups); assert.equal(collider.activeEvents(), events);
      assert.equal(collider.contactForceEventThreshold(), threshold);
      const velocity = b.linvel();
      assert(!weld.release('PASS', impulse));
      assert.deepEqual(b.linvel(), velocity, 'duplicate release applied an impulse twice');
    }
  } finally { world.dispose(); }
});

console.log(`\nBALL PHYSICS PROBE: ${checks - failures}/${checks} PASS${failures ? `, ${failures} FAIL` : ' — 0 leaked ball constraints'}`);
process.exitCode = failures ? 1 : 0;
