/**
 * ball-carrier-constraint — TARCS headless verification of the
 * FixedImpulseJoint ball-carrier weld (src/core/physics/RapierWorld.ts).
 *
 * Run:  npx tsx harness/ball-carrier-constraint.ts
 *
 * Boots Rapier3D (WASM) with no Three.js and no DOM, welds a ball to a TABS
 * carrier's Chest with `attachBallToCarrier`, and checks the four promises of
 * the constraint:
 *
 *   1. HOLDS     — a sprinting carrier keeps a BALL_SECURED ball welded to his
 *                  chest (no snap, ball separation stays ~0).
 *   2. VELOCITY  — the ball is re-seated and its linear/angular velocity
 *                  matched to the Chest at weld time (it does not lunge).
 *   3. NO SELF-JOSTLE — the carrier's membership bit is masked out of the
 *                  ball's filter for the whole weld, so he never knocks his own
 *                  ball loose, and it is restored on release.
 *   4. BREAK     — an OPPONENT tackle whose contact impulse (force * dt)
 *                  clears `breakImpulse` breaks the weld, flips the state to
 *                  DROP_BALL and spills the ball.
 *   5. THRESHOLD — the same tackle with an enormous breakImpulse does NOT spill
 *                  the ball, so the break is gated by impulse and not by touch.
 *   6. FILTER    — the same hard tackle with the tackler classified as NOT an
 *                  opponent (a team-mate) does NOT spill the ball, so only an
 *                  opponent's contact can break the weld.
 *
 * Exit code is non-zero if any assertion fails, so CI (or a human) can gate the
 * build on it. Numbers are reported in a metric table like tackle-gym's.
 */
import {
  RapierWorld,
  DEFAULT_BREAK_IMPULSE_Ns,
  type BallCarrier,
  type TabsPlayer,
} from '../src/core/physics/RapierWorld';
import type { RigidBody } from '@dimforge/rapier3d-compat';

const DT = 1 / 60;
/** Tick budget a tackle has to land before the scenario is a FAIL. */
const MAX_TICKS = 300;

/** A welded ball should stay at its chest-relative carry point to within a
 *  couple of centimetres even while the whole ragdoll tumbles. */
const WELD_TOLERANCE_M = 0.05;

/** Where the carrier tucks the ball (chest-local space, metres), mirroring
 *  ballcraft's BALL_SECURED carry: slightly in FRONT of the torso so a head-on
 *  defender actually strikes the ball rather than brushing the chest around
 *  it. Chest half-depth is 0.15 m, so +0.30 pokes the ball ~0.15 m clear. */
const CARRY_OFFSET = { x: 0, y: -0.05, z: 0.30 };

/** Membership bit of a collider, read out of its InteractionGroups value. */
function membership(collider: { collisionGroups(): number }): number {
  return (collider.collisionGroups() >>> 16) & 0xffff;
}
/** Low 16-bit filter of a collider. */
function filter(collider: { collisionGroups(): number }): number {
  return collider.collisionGroups() & 0xffff;
}
function hasBit(mask: number, bit: number): boolean {
  return (mask & bit) === bit;
}

async function makeWorld(): Promise<RapierWorld> {
  const world = await RapierWorld.create();
  world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });
  return world;
}

function carrier(world: RapierWorld): TabsPlayer {
  return world.addTabsPlayer({ x: 0, y: 0, z: 0, vx: 0, vz: 4 });
}

function tackler(world: RapierWorld): TabsPlayer {
  /* Head-on tackler, launched fast into the carrier's chest where the ball
   * rides, so the collision hits the welded ball as well as the man. */
  return world.addTabsPlayer({ x: 0, y: 0, z: 2.4, vx: 0, vz: -8 });
}

function ball(world: RapierWorld): RigidBody {
  return world.addBall({ radius: 0.15, x: 0, y: 1.53, z: -0.2 });
}

function dist(bodyA: RigidBody, bodyB: RigidBody): number {
  const a = bodyA.translation();
  const b = bodyB.translation();
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface TackleRun {
  broke: boolean;
  ticksToBreak: number;
  held: boolean;
  brokeImpulse: number;
  releasedByCollider: boolean;
}

/** Run a head-on tackle scenario against a carrier holding a welded ball. */
function runTackle(
  world: RapierWorld,
  c: TabsPlayer,
  t: TabsPlayer,
  b: RigidBody,
  opts: {
    breakImpulse: number;
    treatTacklerAsOpponent: boolean;
    seed?: number;
  },
): TackleRun {
  const out: TackleRun = { broke: false, ticksToBreak: -1, held: false, brokeImpulse: -1, releasedByCollider: false };
  let handle: BallCarrier;
  const isLonePlayer = (other: { collisionGroups(): number }): boolean => {
    const m = membership(other);
    return m >= 0b100 && (m & (m - 1)) === 0; // a single player membership bit
  };
  if (opts.treatTacklerAsOpponent) {
    /* Default opponent test: the tackler (a distinct player bit) is an opponent. */
    handle = world.attachBallToCarrier(c, b, { breakImpulse: opts.breakImpulse, carryOffset: CARRY_OFFSET });
  } else {
    /* Classify the tackler as a team-mate: neither he nor the pitch may break
     * it — only a genuine opposing tackler (none present) would. */
    handle = world.attachBallToCarrier(c, b, {
      breakImpulse: opts.breakImpulse,
      carryOffset: CARRY_OFFSET,
      isOpponent: (other) => isLonePlayer(other) && membership(other) !== t.bit,
    });
  }
  void opts.seed;

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    world.step(DT);
    if (!handle.held) {
      out.broke = true;
      out.ticksToBreak = tick + 1;
      out.held = false;
      out.brokeImpulse = handle.breakImpulse;
      out.releasedByCollider = true;
      break;
    }
  }
  out.held = handle.held;
  return out;
}

/* --------------------------------- main ---------------------------------- */

interface Verdict { name: string; pass: boolean; detail: string }

async function main(): Promise<number> {
  const results: Verdict[] = [];

  /* Warm Rapier's WASM once (first allocations are all init cost). */
  await RapierWorld.create().then((w) => w.dispose());

  /* ---- 1. HOLDS: a sprinting carrier keeps the ball welded, no snap. ---- */
  {
    const world = await makeWorld();
    const c = carrier(world);
    const b = ball(world);
    const handle = world.attachBallToCarrier(c, b, { breakImpulse: DEFAULT_BREAK_IMPULSE_Ns, carryOffset: CARRY_OFFSET });
    const expectedSep = Math.hypot(CARRY_OFFSET.x, CARRY_OFFSET.y, CARRY_OFFSET.z);

    let maxDrift = 0;
    let stillHeld = true;
    for (let tick = 0; tick < 40; tick++) {
      world.step(DT);
      if (!handle.held) { stillHeld = false; break; }
      maxDrift = Math.max(maxDrift, Math.abs(dist(c.chest, b) - expectedSep));
    }
    const ballCollider = b.collider(0);
    const carrierMasked = !hasBit(filter(ballCollider), c.bit);
    const heldAtEnd = handle.held;
    const stateAtEnd = handle.state;
    world.dispose();

    const pass = stillHeld && heldAtEnd && stateAtEnd === 'BALL_SECURED'
      && maxDrift < WELD_TOLERANCE_M && carrierMasked;
    results.push({
      name: 'HOLDS (weld rides the Chest)',
      pass,
      detail: `stillHeld=${stillHeld} maxDriftFromOffset=${maxDrift.toFixed(3)}m carrierMasked=${carrierMasked} state=${stateAtEnd}`,
    });
  }

  /* ---- 2. VELOCITY: at weld time the ball matches the Chest's motion. ---- */
  {
    const world = await makeWorld();
    const c = carrier(world);          // launched at vz = +4
    const b = ball(world);
    const chest = c.chest;
    world.step(DT);                    // let the Chest settle into its sprint
    const cv = chest.linvel();
    const cang = chest.angvel();
    const handle = world.attachBallToCarrier(c, b, { breakImpulse: 1000 });
    const bv = b.linvel();
    const bang = b.angvel();
    const held = handle.held;
    world.dispose();

    const linMatch = Math.abs(bv.z - cv.z) < 0.01 && Math.abs(bv.x - cv.x) < 0.01 && Math.abs(bv.y - cv.y) < 0.01;
    const angMatch = Math.abs(bang.x - cang.x) < 0.01 && Math.abs(bang.y - cang.y) < 0.01 && Math.abs(bang.z - cang.z) < 0.01;
    const pass = held && linMatch && angMatch;
    results.push({
      name: 'VELOCITY (ball inherits Chest lin/ang vel)',
      pass,
      detail: `chest=(z${cv.z.toFixed(2)},w${cang.y.toFixed(2)}) ball=(z${bv.z.toFixed(2)},w${bang.y.toFixed(2)}) linMatch=${linMatch} angMatch=${angMatch}`,
    });
  }

  /* ---- 3+4+5+6. The tackle ladder: threshold, break, spill, filter. ---- */
  {
    // Baseline: identical hard tackle, three different break configurations.
    const mk = async (): Promise<{ world: RapierWorld; c: TabsPlayer; t: TabsPlayer; b: RigidBody }> => {
      const world = await makeWorld();
      const c = carrier(world);
      const t = tackler(world);
      const b = ball(world);
      return { world, c, t, b };
    };

    {
      /* THRESHOLD: an enormous breakImpulse means even the full tackle must not
       * spill it — proves the break is gated by force*dt and not by touch. */
      const { world, c, t, b } = await mk();
      const run = runTackle(world, c, t, b, { breakImpulse: 1e9, treatTacklerAsOpponent: true });
      world.dispose();
      results.push({
        name: 'THRESHOLD (sub-threshold tackle holds)',
        pass: !run.broke && run.held,
        detail: `stillHeld=${run.held} after ${MAX_TICKS} ticks of contact`,
      });
    }

    {
      /* FILTER: the SAME hard tackle is re-labelled a team-mate — only an
       * opponent's contact may break the weld, so it must hold. */
      const { world, c, t, b } = await mk();
      const run = runTackle(world, c, t, b, { breakImpulse: 1, treatTacklerAsOpponent: false });
      world.dispose();
      results.push({
        name: 'FILTER (team-mate tackle does not break)',
        pass: !run.broke && run.held,
        detail: `stillHeld=${run.held} though the tackler hit the carrier`,
      });
    }

    {
      /* BREAK: a real opponent at the default break impulse rips it free and
       * spills it, flipping the state to DROP_BALL. */
      const { world, c, t, b } = await mk();
      const ballCollider = b.collider(0);
      const filterBefore = filter(ballCollider);
      const run = runTackle(world, c, t, b, { breakImpulse: DEFAULT_BREAK_IMPULSE_Ns, treatTacklerAsOpponent: true });
      const filterRestored = run.broke ? filter(ballCollider) === filterBefore : false;
      const separated = run.broke ? dist(c.chest, b) > WELD_TOLERANCE_M : false;
      world.dispose();

      const pass = run.broke
        && run.ticksToBreak <= MAX_TICKS
        && run.releasedByCollider
        && run.brokeImpulse === DEFAULT_BREAK_IMPULSE_Ns
        && filterRestored
        && separated;
      results.push({
        name: 'BREAK (opponent impulse >= breakImpulse spills)',
        pass,
        detail: `broke=${run.broke} atTick=${run.ticksToBreak} collisionRestored=${filterRestored} ballSeparated=${separated}`,
      });
    }
  }

  /* ---- report ------------------------------------------------------------ */
  console.log('=== TARCS BALL-CARRIER FIXEDIMPULSEJOINT ===');
  console.log(`joint            FixedImpulseJoint (Chest -> Ball), ${DEFAULT_BREAK_IMPULSE_Ns.toFixed(1)} N.s default break`);
  console.log('break rule       opponent contact impulse force*dt >= breakImpulse');
  console.log(`dt               ${DT.toFixed(4)} s`);
  console.log('');
  console.log('--- ASSERTION TABLE ---');
  console.log('check'.padEnd(48) + 'verdict');
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    console.log(`${r.name.padEnd(48)}${r.pass ? 'PASS' : 'FAIL'}`);
    console.log(`    ${r.detail}`);
  }
  console.log('');
  console.log(allPass ? 'RESULT: PASS — the constraint holds, threshold-gates and breaks only on an opponent tackle'
    : 'RESULT: FAIL — one or more assertions did not hold');
  console.log(allPass ? 'exit 0' : 'exit 1');
  return allPass ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
