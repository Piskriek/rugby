/**
 * divetackle-probe.ts — the TABS-style flailing dive, measured.
 *
 *   npx tsx scripts/divetackle-probe.ts
 *
 * Boots Rapier (WASM) with no browser and runs the physics dive end-to-end:
 * a defender ragdoll and a carrier ragdoll in ONE world, steered by the
 * tackle-ai brain (src/game/engine/tackle-ai.ts). The defender blindly
 * tracks the carrier and launches its active ragdoll through the air.
 *
 *   A) THE DIVE — while > 1.5 m apart (3D, Hips-to-Hips, polled every 3
 *      ticks) the defender's kinematic locomotion target points at the
 *      carrier; at <= 1.5 m it commits the flail: balance gain 0, one
 *      impulse of 400 N·s forward + 150 N·s up on Hips AND on Chest, gait
 *      dead. Verified: the dive fires, fires ONCE, at <= 1.5 m, launches
 *      the defender through the air — and the energy stays bounded (the
 *      old trunk-snap arrested the closing with a position snap and
 *      launched men 8 m; this must stay far below).
 *
 *   B) THE SHELL (CRITICAL FIX 1) — with an unreachable dive trigger the
 *      defender closes to the carrier's shell and MUST stop at it: the
 *      locomotion target is dropped (no trunk snap onto the shell) and the
 *      standard Rapier contact holds the pair apart. Verified: the crossing
 *      is refused, drive null for good, no launch explosion, no tunneling.
 *      (The defender starts at 1.1 m: the wobble gait is only stable for a
 *      few metres of walking, and the crossing must land before it trips.)
 *
 *   C) THE LAW (CRITICAL FIX 2) — the tabsTakeover() override: armed +
 *      ball live → the referee law's dive-reach grab (1.1 m × 1.5 = 1.65 m)
 *      stands down; a dead ball cancels it; the armed clock expires.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { buildRagdollWorld, setRagdollGroups, type RagdollRig } from '../src/entities/ragdoll/rig';
import { createMotor, type RagdollMotor } from '../src/entities/ragdoll/motor';
import {
  TackleDive, TABS_DIVE_DEFAULTS,
  armTabsTakeover, clearTabsTakeover, tickTabsTakeover, tabsTakeover,
  type CarrierId,
} from '../src/game/engine/tackle-ai';

await RAPIER.init();

const STEP = 1 / 120; // the ragdoll world's physics substep
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${info}`); }
};

const hipsOf = (rig: RagdollRig) => {
  const p = rig.byPart.get('hips')!.body.translation();
  return { x: p.x, y: p.y, z: p.z };
};
const chestOf = (rig: RagdollRig) => {
  const p = rig.byPart.get('chest')!.body.translation();
  return { x: p.x, y: p.y, z: p.z };
};
/** Mass-weighted (centre-of-mass) velocity of the whole 15-body rig — the
 *  honest launch observable: the impulse is applied to two bodies and the
 *  joint chain redistributes it, so no single body's velocity is stable. */
const comVel = (rig: RagdollRig) => {
  let mx = 0, my = 0, mz = 0, m = 0;
  for (const b of rig.bodies) {
    const bm = b.body.mass();
    const v = b.body.linvel();
    mx += bm * v.x; my += bm * v.y; mz += bm * v.z; m += bm;
  }
  return { x: mx / m, y: my / m, z: mz / m, mass: m };
};

interface Scene {
  def: RagdollRig;
  car: RagdollRig;
  defMotor: RagdollMotor;
  carMotor: RagdollMotor;
  ai: TackleDive;
}

/** One world, defender at the origin, carrier standing `carrierZ` ahead.
 *  Groups: defender bit 7 ↔ carrier bit 8, each also touching the ground
 *  (bit 0) but NOT its own bodies. */
function scene(carrierZ: number, opts: { triggerDistance?: number } = {}): Scene {
  const def = buildRagdollWorld();
  const car = buildRagdollWorld({ world: def.world, x: 0, z: carrierZ });
  setRagdollGroups(def, 1 << 7, 1 << 8);
  setRagdollGroups(car, 1 << 8, 1 << 7);
  const defMotor = createMotor(def, { mode: 'active' }); // balance ON
  const carMotor = createMotor(car, { mode: 'active' }); // carrier stands
  const ai = new TackleDive(
    { rig: def, motor: defMotor },
    { rig: car },
    { triggerDistance: opts.triggerDistance },
  );
  return { def, car, defMotor, carMotor, ai };
}

/** One physics substep: brain, then both motors, then the world. */
function step(s: Scene, t: number): void {
  s.ai.tick();
  s.defMotor.step(STEP, t);
  s.carMotor.step(STEP, t);
  s.def.world.step();
}

console.log('divetackle probe — TABS-style flailing dive (120 Hz, defender + carrier in one world)');

console.log('0) the spec numbers');
{
  check('polls every 3 ticks', TABS_DIVE_DEFAULTS.pollEvery === 3);
  check('dive triggers at <= 1.5 m (3D Hips-to-Hips)', TABS_DIVE_DEFAULTS.triggerDistance === 1.5);
  check('impulse is 400 N·s forward + 150 N·s up', TABS_DIVE_DEFAULTS.forwardImpulse === 400 && TABS_DIVE_DEFAULTS.upImpulse === 150);
}

console.log('A) the dive — track, then flail');
{
  const s = scene(3.0);
  let triggerT: number | null = null;
  let triggerDist: number | null = null;
  let balanceOff = false;
  let launchVx = 0, launchVz = 0, launchComVy = 0, launchComVz = 0;
  let airborneAfter: number | null = null;
  let hipPeak = 0, chestPeak = 0;
  let trackingSamples = 0, driveToward = 0;
  let finalDist = 0;

  const T_MAX = 30;
  for (let i = 0; i < Math.round(T_MAX / STEP); i++) {
    const t = i * STEP;
    step(s, t);
    const d = hipsOf(s.def);
    const c = hipsOf(s.car);
    finalDist = Math.hypot(c.x - d.x, c.y - d.y, c.z - d.z);
    if (s.ai.state === 'diving') {
      if (triggerT === null) {
        triggerT = t;
        triggerDist = s.ai.lastDistance;
        balanceOff = !s.defMotor.balance.enabled;
        const v = s.def.byPart.get('hips')!.body.linvel();
        launchVx = v.x; launchVz = v.z;
        const com = comVel(s.def);
        launchComVy = com.y; launchComVz = com.z;
      }
      if (airborneAfter === null && d.y > 1.15) airborneAfter = t - triggerT;
      hipPeak = Math.max(hipPeak, d.y);
      chestPeak = Math.max(chestPeak, chestOf(s.def).y);
    } else if (i % 10 === 0 && s.ai.lastDistance !== null && s.ai.lastDistance > 1.5) {
      trackingSamples++;
      const drive = s.defMotor.drive;
      if (drive) {
        const dl = Math.hypot(drive.x, drive.z);
        const tx = c.x - d.x, tz = c.z - d.z;
        const tl = Math.hypot(tx, tz);
        if (dl > 0 && tl > 0 && (drive.x / dl) * (tx / tl) + (drive.z / dl) * (tz / tl) > 0.9) driveToward++;
      }
    }
  }

  check(`the dive fires (at t=${triggerT?.toFixed(2)} s)`, triggerT !== null);
  check(`it fires at <= 1.5 m Hips-to-Hips (polled ${triggerDist?.toFixed(3)} m)`, triggerDist !== null && triggerDist <= 1.5);
  check(`balance gain is 0 at launch (stabiliser disabled)`, balanceOff);
  check(`the gait is killed at launch (drive null)`, s.defMotor.drive === null);
  check(`the impulse throws the hips forward toward the carrier (vz ${launchVz.toFixed(1)} m/s, vx ${launchVx.toFixed(1)})`,
    launchVz > 4 && Math.abs(launchVx) < 2, `v=(${launchVx.toFixed(1)}, ${launchComVy.toFixed(1)}, ${launchVz.toFixed(1)})`);
  check(`the impulse lifts the whole body (COM vy ${launchComVy.toFixed(1)} m/s up, COM vz ${launchComVz.toFixed(1)})`,
    launchComVy > 1.5 && launchComVz > 3, `com=(${launchComVz.toFixed(1)}, ${launchComVy.toFixed(1)})`);
  check(`the defender launches through the air (hips > 1.15 m ${airborneAfter !== null ? `after ${airborneAfter.toFixed(2)} s` : 'never'})`,
    airborneAfter !== null && airborneAfter < 0.5);
  check(`the flail stays bounded (hip peak ${hipPeak.toFixed(2)} m, chest peak ${chestPeak.toFixed(2)} m — the snap bug is 8 m)`,
    hipPeak < 3.5 && chestPeak < 3.5);
  check(`the dive commits ONCE (still diving at t=${T_MAX}s, final dist ${finalDist.toFixed(2)} m)`, s.ai.state === 'diving');
  check(`the chase never needed the shell refusal (dive beat the 0.45 m shell)`, s.ai.crossingRefused === false);
  check(`the locomotion target pointed at the carrier while tracking (${driveToward}/${trackingSamples} samples)`,
    trackingSamples >= 10 && driveToward / trackingSamples > 0.9);
}

console.log('B) the shell — crossing refused, contact resolves (CRITICAL FIX 1)');
{
  // triggerDistance 0.2 < shellRadius 0.45: the flail is unreachable, so the
  // guard must do its job on its own — refuse closing at the shell. The
  // defender starts at 1.1 m (the wobble gait is only stable for a few
  // metres of walking, and the crossing must land before it trips).
  const s = scene(1.1, { triggerDistance: 0.2 });
  let refusedT: number | null = null;
  let samplesAfterRefusal = 0, driveAfterRefusal = 0;
  let minHdist = Infinity, hipPeak = 0, maxHSpeed = 0;

  const T_MAX = 8;
  for (let i = 0; i < Math.round(T_MAX / STEP); i++) {
    const t = i * STEP;
    step(s, t);
    const d = hipsOf(s.def);
    const c = hipsOf(s.car);
    minHdist = Math.min(minHdist, Math.hypot(c.x - d.x, c.z - d.z));
    hipPeak = Math.max(hipPeak, d.y);
    const v = s.def.byPart.get('hips')!.body.linvel();
    maxHSpeed = Math.max(maxHSpeed, Math.hypot(v.x, v.z));
    if (s.ai.crossingRefused) {
      if (refusedT === null) refusedT = t;
      samplesAfterRefusal++;
      if (s.defMotor.drive !== null) driveAfterRefusal++;
    }
  }

  check(`the chase is refused at the carrier shell (t=${refusedT?.toFixed(2)} s)`, refusedT !== null);
  check(`no further commanded closing after the crossing (drive null on ${samplesAfterRefusal} polls)`,
    samplesAfterRefusal > 0 && driveAfterRefusal === 0);
  check(`no launch explosion (hip peak ${hipPeak.toFixed(2)} m — the snap bug is 8 m)`, hipPeak < 1.6);
  check(`no impulse spike (max horizontal hip speed ${maxHSpeed.toFixed(2)} m/s)`, maxHSpeed < 3);
  check(`the standard contact blocks the closing (min Hips-to-Hips ${minHdist.toFixed(3)} m, no tunneling)`, minHdist > 0.1);
  check(`the flail never fires in this window (state still tracking)`, s.ai.state === 'tracking');
}

console.log('C) the law override — tabsTakeover() (CRITICAL FIX 2)');
{
  const id: CarrierId = { team: 'A', num: 5 };
  const other: CarrierId = { team: 'A', num: 7 };
  const live = { live: true };
  const dead = { live: false };

  clearTabsTakeover(id);
  check('no takeover armed → the law keeps its 1.65 m dive-reach grab', tabsTakeover(live, id) === false);
  armTabsTakeover(id, 2.5);
  check('armed + ball live → the dive-reach grab stands down', tabsTakeover(live, id) === true);
  check('a different carrier is unaffected', tabsTakeover(live, other) === false);
  check('a dead ball cancels the takeover immediately', tabsTakeover(dead, id) === false);
  check('...and it does not re-arm on the next live ball', tabsTakeover(live, id) === false);
  armTabsTakeover(id, 2.5);
  let ticks = 0;
  while (tabsTakeover(live, id) && ticks < 1000) { tickTabsTakeover(0.1); ticks++; }
  check(`the armed clock expires, the law regains authority (after ${(ticks * 0.1).toFixed(1)} s)`,
    tabsTakeover(live, id) === false);
  armTabsTakeover(id, 2.5);
  clearTabsTakeover(id);
  check('explicit release works', tabsTakeover(live, id) === false);
}

console.log(`\nPROBE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
