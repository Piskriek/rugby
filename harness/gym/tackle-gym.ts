/**
 * tackle-gym — automated TARCS headless physics stress-test.
 *
 * Run:  npx tsx harness/gym/tackle-gym.ts
 *
 * Boots Rapier3D (WASM) with no Three.js and no DOM, then simulates 100
 * collision scenarios across three rugby contact classes:
 *
 *   a) 1v1 head-on tackles at 6.0 m/s sprint velocities
 *   b) 2v1 flanking tackles (carrier + head-on + flanking defender)
 *   c) 3v3 breakdown ruck piles converging on a ball
 *
 * Every player is a TABS ragdoll: Hips and Chest carry >= 80% of the mass,
 * Arms / Thighs / Calves are near-weightless, the limbs are held together with
 * spherical joints, and intra-player limbs are culled by InteractionGroups.
 *
 * Each scenario runs its own Rapier world (fresh body set, no state leaking
 * between tackles) for a fixed number of ticks. The benchmark measures:
 *
 *   - average physics tick time  (target: < 2.0 ms headless)
 *   - collider interpenetration events (contact distance < -0.05 m, i.e. the
 *     bodies are tunnelling / overlapping beyond the contact tolerance)
 *   - NaN or unbounded body rotation (any angular-velocity component is not
 *     finite, or the angular speed exceeds 100 rad/s)
 *
 * Exit code is 0 whenever the run completes; the metric table reports
 * PASS/FAIL per target so CI (or a human) can read it without aborting.
 */

import { performance } from 'node:perf_hooks';
import {
  RapierWorld,
  PhysicsGroup,
  TABS_TOTAL_MASS,
  TABS_TRUNK_SHARE,
  type TabsPlayer,
} from '../../src/core/physics/RapierWorld';
import type { RigidBody, Collider } from '@dimforge/rapier3d-compat';

/* ------------------------------- constants ------------------------------- */

const DT = 1 / 60;
/** Number of physics ticks per scenario. 90 ticks ≈ 1.5 s of contact. */
const TICKS_PER_SCENARIO = 90;
/** Total headless scenarios to run (split across the three classes). */
const TOTAL_SCENARIOS = 100;

/** Tunneling / over-penetration threshold (metres), negative contact distance. */
const PENETRATION_THRESHOLD = 0.05;
/** Angular speed considered "unbounded" for a humanoid proxy, rad/s. */
const ANGVEL_LIMIT = 100;

interface ScenarioSetup {
  bodies: RigidBody[];
  colliders: Collider[];
}

interface ScenarioClass {
  id: string;
  label: string;
  count: number;
  build(world: RapierWorld): ScenarioSetup;
}

/* ------------------------------ scene builders --------------------------- */

function tabsPlayer(world: RapierWorld, x: number, z: number, vx: number, vz: number): TabsPlayer {
  return world.addTabsPlayer({ x, y: 0, z, vx, vz });
}

function scenarioFrom(players: TabsPlayer[], balls: RigidBody[]): ScenarioSetup {
  const bodies: RigidBody[] = [];
  const colliders: Collider[] = [];
  for (const p of players) {
    bodies.push(...p.bodies);
    colliders.push(...p.colliders);
  }
  for (const b of balls) {
    bodies.push(b);
    colliders.push(b.collider(0));
  }
  return { bodies, colliders };
}

function ball(world: RapierWorld, x: number, z: number, vy = 0.8): RigidBody {
  const body = world.addBall({ radius: 0.15, x, y: 0.7, z });
  body.setLinvel({ x: 0, y: vy, z: 0 }, true);
  return body;
}

/** a) 1v1 head-on hit at 6.0 m/s each, with a ball in the path. */
function buildHeadOn(world: RapierWorld): ScenarioSetup {
  const a = tabsPlayer(world, 0, -4, 0, 6.0);
  const b = tabsPlayer(world, 0, 4, 0, -6.0);
  return scenarioFrom([a, b], [ball(world, 0, -2.0)]);
}

/** b) 2v1 flanking tackle — carrier sprinted into by a head-on and a side man. */
function buildFlank(world: RapierWorld): ScenarioSetup {
  const carrier = tabsPlayer(world, 0, 0, 0, 6.0);
  const headOn = tabsPlayer(world, 0, 4, 0, -6.0);
  const dx = -2.5, dz = -2.0;
  const len = Math.hypot(dx, dz);
  const flank = tabsPlayer(world, 2.5, 2.0, (dx / len) * 6.0, (dz / len) * 6.0);
  return scenarioFrom([carrier, headOn, flank], [ball(world, 0, -0.6, 0.6)]);
}

/** c) 3v3 breakdown ruck pile — six TABS bodies converge on a grounded ball. */
function buildRuck(world: RapierWorld): ScenarioSetup {
  const players: TabsPlayer[] = [
    tabsPlayer(world, -0.5, -2.5, 0.0, 3.5),
    tabsPlayer(world, 0.7, -2.0, -0.5, 3.2),
    tabsPlayer(world, -1.2, -1.8, 0.6, 3.0),
    tabsPlayer(world, 0.5, 2.5, 0.0, -3.5),
    tabsPlayer(world, -0.7, 2.0, 0.5, -3.2),
    tabsPlayer(world, 1.2, 1.8, -0.6, -3.0),
  ];
  return scenarioFrom(players, [ball(world, 0, 0, 0.4)]);
}

const SCENARIO_CLASSES: ScenarioClass[] = [
  { id: '1v1', label: '1v1 head-on tackles (6 m/s)', count: 40, build: buildHeadOn },
  { id: '2v1', label: '2v1 flanking tackles', count: 30, build: buildFlank },
  { id: '3v3', label: '3v3 breakdown ruck piles', count: 30, build: buildRuck },
];

/* ------------------------------ measurement ------------------------------ */

function scanPenetrations(world: RapierWorld, colliders: Collider[]): number {
  let events = 0;
  for (let i = 0; i < colliders.length; i++) {
    for (let j = i + 1; j < colliders.length; j++) {
      world.world.contactPair(colliders[i], colliders[j], (manifold) => {
        const n = manifold.numContacts();
        for (let k = 0; k < n; k++) {
          if (manifold.contactDist(k) < -PENETRATION_THRESHOLD) events++;
        }
      });
    }
  }
  return events;
}

function scanAngular(bodies: RigidBody[]): number {
  let bad = 0;
  for (const body of bodies) {
    const av = body.angvel();
    const x = av.x, y = av.y, z = av.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      bad++;
      continue;
    }
    if (Math.hypot(x, y, z) > ANGVEL_LIMIT) bad++;
  }
  return bad;
}

interface ScenarioResult {
  times: number[];
  penetrations: number;
  angularIssues: number;
}

function runScenario(world: RapierWorld, bodies: RigidBody[], colliders: Collider[]): ScenarioResult {
  const times: number[] = [];
  let penetrations = 0;
  let angularIssues = 0;

  for (let tick = 0; tick < TICKS_PER_SCENARIO; tick++) {
    const t0 = performance.now();
    world.step(DT);
    times.push(performance.now() - t0);

    penetrations += scanPenetrations(world, colliders);
    angularIssues += scanAngular(bodies);
  }

  return { times, penetrations, angularIssues };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/* --------------------------------- main ---------------------------------- */

async function main(): Promise<number> {
  const allTimes: number[] = [];
  const byClass = new Map<string, { scenarios: number; penetrations: number; angularIssues: number }>();
  let totalPenetrations = 0;
  let totalAngularIssues = 0;
  let scenarioNumber = 0;

  const totalConfigured = SCENARIO_CLASSES.reduce((sum, c) => sum + c.count, 0);
  if (totalConfigured !== TOTAL_SCENARIOS) {
    throw new Error(`scenario counts sum to ${totalConfigured}, expected ${TOTAL_SCENARIOS}`);
  }

  // Warm Rapier's WASM once (the first few allocations are all init cost).
  await RapierWorld.create().then((w) => w.dispose());

  for (const cls of SCENARIO_CLASSES) {
    const agg = { scenarios: 0, penetrations: 0, angularIssues: 0 };

    for (let n = 0; n < cls.count; n++) {
      const world = await RapierWorld.create();
      const pitch = world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });

      const setup = cls.build(world);
      const colliders = [...setup.colliders, pitch];

      const result = runScenario(world, setup.bodies, colliders);

      allTimes.push(...result.times);
      agg.scenarios++;
      agg.penetrations += result.penetrations;
      agg.angularIssues += result.angularIssues;
      totalPenetrations += result.penetrations;
      totalAngularIssues += result.angularIssues;

      world.dispose();
      scenarioNumber++;
    }

    byClass.set(cls.id, agg);
  }

  const sorted = [...allTimes].sort((a, b) => a - b);
  const avg = allTimes.reduce((sum, t) => sum + t, 0) / Math.max(1, allTimes.length);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const max = sorted[sorted.length - 1] ?? 0;

  const avgOk = avg < 2.0;
  const penOk = totalPenetrations === 0;
  const angOk = totalAngularIssues === 0;

  console.log('=== TARCS HEADLESS TACKLE STRESS GYM ===');
  console.log(`physics          Rapier3D (WASM, no Three.js / DOM)`);
  console.log('solver           numSolverIterations=4 numInternalPgsIterations=1 ccdSubsteps=4');
  console.log('                 normalizedAllowedLinearError=0.0001 predictionDistance=0.1');
  console.log(`collision groups PLAYER=${PhysicsGroup.PLAYER} PITCH=${PhysicsGroup.PITCH} BALL=${PhysicsGroup.BALL}`);
  console.log('mass dist        hips=32 chest=32 arm=1.5 thigh=2 calf=1.5 kg');
  console.log(`mass trunk share ${(TABS_TRUNK_SHARE * 100).toFixed(1)}% of ${TABS_TOTAL_MASS.toFixed(1)} kg`);
  console.log(`gravity          [0, -9.81, 0]`);
  console.log(`scenarios        ${scenarioNumber} (configured ${totalConfigured})`);
  for (const cls of SCENARIO_CLASSES) {
    const b = byClass.get(cls.id)!;
    console.log(`  ${cls.id.padEnd(4)} ${String(b.scenarios).padStart(3)}  ${cls.label}`);
  }
  console.log(`ticks            ${allTimes.length}`);
  console.log(`dt               ${DT.toFixed(4)} s`);
  console.log('');
  console.log('--- METRIC TABLE ---');
  console.log('metric'.padEnd(30) + 'value'.padEnd(14) + 'target'.padEnd(14) + 'verdict');
  console.log('average tick time'.padEnd(30) + `${avg.toFixed(3)} ms`.padEnd(14) + '<2.000 ms'.padEnd(14) + (avgOk ? 'PASS' : 'FAIL'));
  console.log('p50 tick time'.padEnd(30) + `${p50.toFixed(3)} ms`);
  console.log('p95 tick time'.padEnd(30) + `${p95.toFixed(3)} ms`);
  console.log('max tick time'.padEnd(30) + `${max.toFixed(3)} ms`);
  console.log('interpenetration events'.padEnd(30) + `${totalPenetrations}`.padEnd(14) + '0 (depth > 5 cm)'.padEnd(14) + (penOk ? 'PASS' : 'FAIL'));
  console.log('NaN / unbounded angvel'.padEnd(30) + `${totalAngularIssues}`.padEnd(14) + '0 (>100 rad/s)'.padEnd(14) + (angOk ? 'PASS' : 'FAIL'));
  console.log('');

  console.log('--- PER-CLASS HEALTH ---');
  for (const cls of SCENARIO_CLASSES) {
    const b = byClass.get(cls.id)!;
    console.log(`${cls.id.padEnd(4)} scenarios=${String(b.scenarios).padStart(3)}  events=${String(b.penetrations).padStart(5)}  angvel=${String(b.angularIssues).padStart(4)}`);
  }
  console.log('');

  console.log(avgOk ? 'RESULT: PASS — average tick time under 2.0 ms' : `RESULT: FAIL — average tick time ${avg.toFixed(2)} ms >= 2.0 ms`);
  console.log(penOk ? 'RESULT: PASS — no interpenetration events > 5 cm' : `RESULT: FAIL — ${totalPenetrations} interpenetration events > 5 cm`);
  console.log(angOk ? 'RESULT: PASS — no NaN / unbounded angular velocity' : `RESULT: FAIL — ${totalAngularIssues} NaN / unbounded angular velocity`);
  console.log('exit 0');

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
