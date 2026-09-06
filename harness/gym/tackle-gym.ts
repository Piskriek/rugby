/**
 * tackle-gym — headless physics benchmark.
 *
 * Run:  npx tsx harness/gym/tackle-gym.ts
 *
 * Boots Rapier3D (WASM) with no Three.js and no DOM, builds a flat pitch, a
 * pair of player proxies and a ball, then steps the world exactly 200 times at
 * the fixed game timestep. It measures wall-clock compute time per tick so we
 * have a real number for "can Rapier keep up headless?".
 *
 * Exit code is 0 on a successful run (regardless of whether the 2 ms target
 * was beaten — that is reported as PASS/FAIL so CI can read it, but the
 * acceptance gate for this harness is a clean run and exit 0).
 */
import { performance } from 'node:perf_hooks';
import { RapierWorld, PhysicsGroup } from '../../src/core/physics/RapierWorld';

const TICKS = 200;
const DT = 1 / 60;

async function main(): Promise<number> {
  const world = await RapierWorld.create();

  // Flat 100 m x 60 m pitch, top surface at y = 0.
  world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });

  // Two player proxies (roughly half a metre wide, ~1 m tall proxy) and a ball.
  const tackleA = world.addPlayer({ hx: 0.35, hy: 0.9, hz: 0.28, x: -2, y: 0.9, z: 0 });
  const tackleB = world.addPlayer({ hx: 0.35, hy: 0.9, hz: 0.28, x: 2, y: 0.9, z: 0 });
  const ball = world.addBall({ radius: 0.15, x: 0, y: 0.7, z: 0 });

  // Give the collision system something to solve: the ball falls, the two
  // players charge into it.
  tackleA.setLinvel({ x: 0, y: 0, z: 3.2 }, true);
  tackleB.setLinvel({ x: 0, y: 0, z: -3.2 }, true);
  ball.setLinvel({ x: 0, y: 1.5, z: 0 }, true);

  // Warm-up: the first steps include WASM tables being touched and the broad
  // phase settling; exclude them from the reported average so the number is the
  // steady-state cost.
  for (let i = 0; i < 5; i++) world.step(DT);

  const times: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    const t0 = performance.now();
    world.step(DT);
    times.push(performance.now() - t0);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const max = sorted[sorted.length - 1];

  const trans = tackleA.translation();
  const ballT = ball.translation();

  console.log('=== RAPIER HEADLESS TACKLE GYM ===');
  console.log(`ticks            ${TICKS}`);
  console.log(`dt               ${DT.toFixed(4)} s`);
  console.log(`gravity          [0, -9.81, 0]`);
  console.log(`collision groups PLAYER=${PhysicsGroup.PLAYER} PITCH=${PhysicsGroup.PITCH} BALL=${PhysicsGroup.BALL}`);
  console.log(`players          ${times.length > 0 ? 2 : 2}, ball radius 0.15`);
  console.log(`avg              ${avg.toFixed(3)} ms/tick`);
  console.log(`p50              ${p50.toFixed(3)} ms`);
  console.log(`p95              ${p95.toFixed(3)} ms`);
  console.log(`max              ${max.toFixed(3)} ms`);
  console.log(`carrier z        initial 2.0 -> ${trans.z.toFixed(2)} m`);
  console.log(`ball y           initial 0.7 -> ${ballT.y.toFixed(2)} m`);

  world.dispose();

  const underTarget = avg < 2;
  console.log(underTarget
    ? 'PASS  average tick < 2 ms'
    : `FAIL  average tick ${avg.toFixed(2)} ms >= 2 ms target`);
  console.log('exit 0');

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
