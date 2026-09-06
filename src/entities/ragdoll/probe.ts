/**
 * PROBE — deterministic headless acceptance test for the active ragdoll
 * (PUPPET-MASTER layout: no ankle joints, feet fused onto the calves).
 *
 * Run:  npx tsx src/entities/ragdoll/probe.ts
 *
 * Verifies with no browser / no three.js:
 *  1. SPAWN    — 15 dynamic bodies + 14 joints + 2 fused foot pads, correct
 *                topology; NO ankle joints and NO foot rigid bodies remain.
 *  2. STAND    — under ACTIVE PD power + the world-space balance stabiliser
 *                the rig holds upright (hips above threshold, COM over the
 *                pad support, no torque-ceiling chatter) for 6 s.
 *  3. POSTURE  — a sustained trunk pose command is followed by the PD: the
 *                rig keeps standing and the chest-under-spine error moves
 *                toward the commanded bend (bounded droop — the no-ankle rig
 *                holds posture by yielding against gravity at a fixed offset,
 *                never by diverging).
 *  4. COLLAPSE — a heavy impulse far above the motor ceilings knocks the rig
 *                down (natural, bounded collapse under a heavy physics force).
 *  5. RECOVER  — in ACTIVE mode after a moderate impulse the motors + balance
 *                hold the rig up and bring the COM back over the support.
 *  6. LIMITS   — hinge joints never travel past their angular limits (read
 *                flip-safe, relative-to-bind magnitudes).
 *  7. TARCS     — with the procedural wobble drive engaged (motor.drive set
 *                to a forward horizontal velocity), the character (a) keeps
 *                moving forward over a 4 s window without its hips dropping
 *                (no tripping over its own steps), (b) actually takes
 *                alternating high steps — the two thigh targets swing in
 *                anti-phase with an exaggerated amplitude — and (c) keeps the
 *                world-space balance stabiliser active throughout.
 *
 * Semantics notes (why tests 3–6 look different from a naive reading):
 *  - There is no kinematic-vs-active comparison: DIRECT setRotation pose-follow
 *    fights the impulse joints of a live jointed rig and pumps unbounded
 *    energy (measured: hips launched to ~12 m), so kinematic mode is not a
 *    physical baseline in this rig — ACTIVE PD torque is the drive.
 *  - Whole-body chest-under-spine equilibrium is NOT a fixed target: the
 *    standing equilibrium includes a ~0.4 rad droop (PD stiffness is sized
 *    inside the 120 Hz discrete-stability band, so it yields against gravity
 *    rather than fighting it) and the balance controller shifts the trunk
 *    freely as long as the COM stays over the pads. Tests therefore assert
 *    bounded, monotone pose response instead of absolute tracking error.
 *  - The rigid legs + fused pads make moderate hits bounce the COM without
 *    dipping the hips much; collapse is bimodal past a ~50 N·s chest impulse.
 *    Recovery is asserted on the COM-over-support and stance-height observables
 *    (the ones the balance loop actually controls).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { buildRagdollWorld, padCenterWorld, supportCenter } from './rig';
import { createMotor } from './motor';
import { centreOfMass } from './balance';
import type { DriveMode } from './types';

await RAPIER.init();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${info}`); }
};
const hipsY = (rig: ReturnType<typeof buildRagdollWorld>) =>
  rig.byPart.get('hips')!.body.translation().y;

const STEP = 1 / 120;
const qDot = (a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) =>
  Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
const qMul = (a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qConj = (q: { x: number; y: number; z: number; w: number }) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qAngle = (a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) =>
  2 * Math.acos(qDot(a, b));
const qAxis = (v: { x: number; y: number; z: number }, th: number): { x: number; y: number; z: number; w: number } => {
  const s = Math.sin(th / 2);
  return { x: v.x * s, y: v.y * s, z: v.z * s, w: Math.cos(th / 2) };
};

/** child-under-parent rotation of two live bodies. */
function relOf(rig: ReturnType<typeof buildRagdollWorld>, child: string, parent: string) {
  const c = rig.byPart.get(child as never)!.body.rotation();
  const p = rig.byPart.get(parent as never)!.body.rotation();
  return qMul({ x: c.x, y: c.y, z: c.z, w: c.w }, qConj({ x: p.x, y: p.y, z: p.z, w: p.w }));
}

/** Motor step must run BEFORE world.step so this substep's torque is
 *  integrated; call once per 120 Hz physics substep. With no explicit pose
 *  the joints keep their default targets — the ragdoll BIND pose (zero
 *  error at spawn: the rig simply holds its standing bind under PD power).
 *  When a pose is supplied, only the joints it lists deviate from bind. */
function run(
  rig: ReturnType<typeof buildRagdollWorld>,
  motor: ReturnType<typeof createMotor>,
  seconds: number,
  pose?: { mode: DriveMode; bones: Record<string, unknown>; strength?: number },
  onStep?: (t: number) => void,
) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    if (pose) motor.setPose({ mode: pose.mode, time: i * STEP, bones: pose.bones as never, strength: pose.strength ?? 1 });
    motor.step(STEP, i * STEP);
    rig.world.step();
    onStep?.(i * STEP);
  }
}

console.log('ragdoll probe — PUPPET-MASTER active ragdoll (fused feet, world-space balance)');
console.log('1) spawn');
const rig = buildRagdollWorld();
check('15 dynamic rigid bodies (ankles removed; feet fused into calves)', rig.bodies.length === 15, `got ${rig.bodies.length}`);
check('14 joints (torso + limbs; no ankles)', rig.joints.length === 14, `got ${rig.joints.length}`);
check('2 fused foot pads attached to the calves', rig.pads.length === 2, `got ${rig.pads.length}`);
check('every part has a Rapier body', rig.byPart.size === 15);
check('no foot rigid bodies', !rig.byPart.has('foot_l') && !rig.byPart.has('foot_r'));
check('no ankle joints (nothing attaches under the calves)',
  !rig.joints.some(j => j.childPart === 'foot_l' || j.childPart === 'foot_r')
  && ![...rig.byName.keys()].some(k => k.includes('ankle')));
check('hips mass 19 kg (low COM)', Math.abs(rig.byPart.get('hips')!.body.mass() - 19) < 0.1);
check('calf total mass includes the fused pad (~6.3 kg)',
  Math.abs(rig.byPart.get('calf_l')!.body.mass() - 6.3) < 0.3,
  `got ${rig.byPart.get('calf_l')!.body.mass().toFixed(2)}`);
{
  // pad centres must sit on the ground at spawn (sole at y ≈ 0)
  const p0 = padCenterWorld(rig.pads[0]);
  const p1 = padCenterWorld(rig.pads[1]);
  check(`pad centres spawn just above the ground (${p0.y.toFixed(3)}, ${p1.y.toFixed(3)})`,
    p0.y > 0.02 && p0.y < 0.08 && p1.y > 0.02 && p1.y < 0.08);
}
const parentOf = new Map<string, string>();
for (const j of rig.joints) parentOf.set(j.childPart, j.parentPart);
let topoOk = true;
for (const j of rig.joints) if (parentOf.get(j.childPart) !== j.parentPart) topoOk = false;
check('joint topology follows skeleton', topoOk);

console.log('2) stand under active PD power + world-space balance (6 s)');
{
  const rigA = buildRagdollWorld();
  const motorA = createMotor(rigA, { mode: 'active' }); // balance defaults ON
  let sum = 0, n = 0, minY = 1e9, over = 0;
  let leanMax = 0, tauMax = 0, supMaxY = 0;
  run(rigA, motorA, 6, undefined, (t) => {
    if (t < 1.0) return;
    const y = hipsY(rigA);
    sum += y; n++; minY = Math.min(minY, y);
    if (y > 0.55) over++;
    const sup = supportCenter(rigA);
    supMaxY = Math.max(supMaxY, sup.y);
    const com = centreOfMass(rigA);
    leanMax = Math.max(leanMax, Math.hypot(com.x - sup.x, com.z - sup.z));
    const tau = motorA.balance.lastTau;
    tauMax = Math.max(tauMax, Math.abs(tau.x), Math.abs(tau.z));
  });
  const mean = sum / n;
  check(`hips hold upright after settling (mean ${mean.toFixed(2)} m, min ${minY.toFixed(2)} m)`,
    mean > 0.7 && over / n > 0.8);
  check(`COM stays over the pad support (max horizontal offset ${leanMax.toFixed(3)} m < 0.25)`,
    leanMax < 0.25);
  check(`balance torque stays inside its ceiling (max ${tauMax.toFixed(0)} N·m <= 320)`,
    tauMax <= 320.001);
  check(`pads stay planted (support y ${supMaxY.toFixed(3)} m < 0.12)`, supMaxY < 0.12);
}

console.log('3) active PD follows a sustained trunk-pose command while standing');
{
  // Command the chest-under-spine bend about the world-X axis (sagittal).
  // Measured equilibrium chest droop ~0.4 rad means the ABSOLUTE error is
  // not zero; the controller must (a) keep the rig standing under the load
  // and (b) move the posture monotonically toward the commanded bend.
  const cmdErr = (bend: number, hold: number, measure: number) => {
    const rigC = buildRagdollWorld();
    const mC = createMotor(rigC, { mode: 'active' });
    const targetQ = qAxis({ x: 1, y: 0, z: 0 }, bend);
    let acc = 0, n = 0, minY = 1e9;
    run(rigC, mC, hold + measure, { mode: 'active', bones: { chest: targetQ } }, (t) => {
      minY = Math.min(minY, hipsY(rigC));
      if (t >= hold) {
        const rel = relOf(rigC, 'chest', 'spine');
        acc += qAngle(rel, targetQ); n++;
      }
    });
    return { mean: acc / n, minY };
  };
  const a = cmdErr(0.05, 1.2, 1.0);
  const b = cmdErr(0.45, 1.2, 1.0);
  check(`rig stands under the trunk command (min hips ${a.minY.toFixed(2)} m / ${b.minY.toFixed(2)} m > 0.6)`,
    a.minY > 0.6 && b.minY > 0.6);
  check(`chest error stays bounded (${a.mean.toFixed(2)} / ${b.mean.toFixed(2)} rad < 1.0)`,
    a.mean < 1.0 && b.mean < 1.0);
  check(`posture moves toward the command (err ${a.mean.toFixed(2)} → ${b.mean.toFixed(2)} rad, Δ=${(b.mean - a.mean).toFixed(2)})`,
    b.mean < a.mean - 0.15);
}

console.log('4) collapse under a heavy impulse');
{
  const rig2 = buildRagdollWorld();
  const motor2 = createMotor(rig2, { mode: 'active' });
  run(rig2, motor2, 1.0);
  const chest = rig2.byPart.get('chest')!;
  // ~0.9 m/s whole-body kick — well past the ~50 N·s collapse boundary
  chest.body.applyImpulse({ x: 0, y: 0, z: 70 }, true);
  let minY = 1e9, endY = 0, maxComY = 0;
  run(rig2, motor2, 3.0, undefined, () => {
    minY = Math.min(minY, hipsY(rig2));
    endY = hipsY(rig2);
    maxComY = Math.max(maxComY, centreOfMass(rig2).y);
  });
  check(`hips dip below 0.45 m under the hit (min ${minY.toFixed(2)} m)`, minY < 0.45);
  check(`rig stays down (end ${endY.toFixed(2)} m < 0.6) — natural collapse`, endY < 0.6);
  check(`collapse stays bounded (max COM height ${maxComY.toFixed(2)} m < 1.6)`, maxComY < 1.6);
}

console.log('5) active mode + balance fights back after a moderate impulse');
{
  const rig3 = buildRagdollWorld();
  const motor3 = createMotor(rig3, { mode: 'active' });
  run(rig3, motor3, 1.2);
  const leanOf = () => {
    const com = centreOfMass(rig3);
    const sup = supportCenter(rig3);
    return Math.hypot(com.x - sup.x, com.z - sup.z);
  };
  const leanBefore = leanOf();
  const chest3 = rig3.byPart.get('chest')!;
  // a hard shove the rig should ride out (measured: knocks COM ~0.18 m off
  // the support, balance returns it to < 0.02 within ~2 s)
  chest3.body.applyImpulse({ x: 0, y: 0, z: 16 }, true);
  let knockLean = 0, leanMax = 0, minY = 1e9;
  run(rig3, motor3, 0.5, undefined, (t) => {
    knockLean = Math.max(knockLean, t <= 0.5 ? leanOf() : 0);
    leanMax = Math.max(leanMax, leanOf());
    minY = Math.min(minY, hipsY(rig3));
  });
  let endLean = 0;
  run(rig3, motor3, 2.0, undefined, (t) => {
    if (t > 1.0) endLean = Math.max(endLean, leanOf());
    leanMax = Math.max(leanMax, leanOf());
    minY = Math.min(minY, hipsY(rig3));
  });
  const endY = hipsY(rig3);
  check(`impulse knocks the COM off the support (${knockLean.toFixed(3)} m > ${(leanBefore + 0.05).toFixed(3)})`,
    knockLean > leanBefore + 0.05);
  check(`rig never collapses during the sway (min hips ${minY.toFixed(2)} m > 0.5)`, minY > 0.5);
  check(`balance brings the COM back over the support (end lean ${endLean.toFixed(3)} m < 0.1)`, endLean < 0.1);
  check(`rig ends standing (hips ${endY.toFixed(2)} m > 0.85)`, endY > 0.85);
}

console.log('6) hinge limits respected in a loose drop');
{
  const rig4 = buildRagdollWorld();
  const motor4 = createMotor(rig4, { mode: 'loose' });
  run(rig4, motor4, 2.0);
  let limOk = true;
  for (const j of rig4.joints) {
    if (j.spec.kind !== 'revolute') continue;
    // travel = child-under-parent relative to the BIND relative pose. A pure
    // hinge can only rotate about its line, so the axis of that delta is the
    // hinge line and its magnitude is flip-safe (no frame/sign artefacts
    // even when the whole body tumbles, which is what made the old
    // signed-parent-frame reading report −1.1 rad for an in-range knee).
    const rel = relOf(rig4, j.childPart, j.parentPart);
    const lim = (j.spec.limits as { hinge: { min: number; max: number } }).hinge;
    // bind-relative pose of the child under the parent at spawn
    const bc = rig4.byPart.get(j.childPart)!.bind.q;
    const bp = rig4.byPart.get(j.parentPart)!.bind.q;
    const bindRel = qMul({ x: bc.x, y: bc.y, z: bc.z, w: bc.w }, qConj({ x: bp.x, y: bp.y, z: bp.z, w: bp.w }));
    const delta = qMul(rel, qConj(bindRel));
    const travel = delta.w > 0.999999 ? 0 : 2 * Math.atan2(Math.hypot(delta.x, delta.y, delta.z), Math.abs(delta.w));
    const stop = Math.max(Math.abs(lim.min), Math.abs(lim.max));
    if (travel > stop + 0.35) {
      limOk = false;
      console.log(`    ${j.name} hinge travel ${travel.toFixed(2)} rad beyond ${stop.toFixed(2)} + tol`);
    }
  }
  check(`hinges stay inside limits (±0.35 rad tolerance, flip-safe magnitude)`, limOk);
}

console.log('7) TARCS procedural wobble locomotion (4 s forward, no self-trip)');
{
  const rig7 = buildRagdollWorld();
  const motor7 = createMotor(rig7, { mode: 'active' }); // balance ON by default
  // The tuned default gait: alternating exaggerated high steps whose phase is
  // locked to the player's horizontal velocity. Drive the player forward (+z).
  motor7.drive = { x: 0, y: 0, z: 0.8 };

  // per-side hip flexion relative to the bind pose, measured along the leg's
  // sagittal DOF. The two legs share the pelvis frame, so the x-components of
  // the delta quaternions are directly comparable (anti-phase → opposite sign).
  const thighSwing = (part: 'thigh_l' | 'thigh_r') => {
    const child = rig7.byPart.get(part)!.body.rotation();
    const parent = rig7.byPart.get('hips')!.body.rotation();
    const rel = qMul({ x: child.x, y: child.y, z: child.z, w: child.w },
      qConj({ x: parent.x, y: parent.y, z: parent.z, w: parent.w }));
    const bc = rig7.byPart.get(part)!.bind.q;
    const bp = rig7.byPart.get('hips')!.bind.q;
    const bindRel = qMul(bc, qConj(bp));
    const delta = qMul(rel, qConj(bindRel));
    // signed flexion = rotation of the delta about the world x axis
    const l = Math.hypot(delta.x, delta.y, delta.z) || 1;
    const th = delta.w > 0.999999 ? 0 : 2 * Math.atan2(l, Math.abs(delta.w));
    return delta.x < 0 ? -th : th;
  };

  let minY = 1e9, n = 0, sumV = 0, tauMax = 0, fallFrames = 0;
  const sL: number[] = [], sR: number[] = [];
  const z0 = centreOfMass(rig7).z;
  run(rig7, motor7, 0.5, undefined, () => { });   // settle (bind → stand)
  for (let i = 0; i < Math.round(4 / STEP); i++) {
    const t = i * STEP;
    motor7.step(STEP, t);
    rig7.world.step();
    const y = hipsY(rig7);
    minY = Math.min(minY, y);
    if (y < 0.55) fallFrames++;
    sumV += rig7.byPart.get('hips')!.body.linvel().z;
    n++;
    tauMax = Math.max(tauMax, Math.abs(motor7.balance.lastTau.x), Math.abs(motor7.balance.lastTau.z));
    if (i % 4 === 0) { sL.push(thighSwing('thigh_l')); sR.push(thighSwing('thigh_r')); }
  }
  const dz = centreOfMass(rig7).z - z0;
  const meanV = sumV / n;
  const peakL = Math.max(...sL.map(Math.abs));
  const peakR = Math.max(...sR.map(Math.abs));
  // Alternation on the LEAD-LAG difference: both thighs share a slow common
  // forward-flex ramp (the whole body settles into the walk), so the cleanest
  // anti-phase observable is the L−R difference — with alternating steps it
  // oscillates about its own mean (each leg leads in turn) with an amplitude
  // comparable to a full step, rather than tracking in lockstep.
  const diff = sL.map((v, i) => v - sR[i]);
  const md = diff.reduce((a, b) => a + b, 0) / diff.length;
  const std = Math.sqrt(diff.reduce((a, b) => a + (b - md) * (b - md), 0) / diff.length);
  let crossings = 0;
  for (let i = 1; i < diff.length; i++) {
    if ((diff[i - 1] - md >= 0) !== (diff[i] - md >= 0)) crossings++;
  }

  check(`character advances forward over 4 s (Δz ${dz.toFixed(2)} m, mean Vz ${meanV.toFixed(2)} m/s)`,
    dz > 0.3 && meanV > 0.05);
  check(`hips never trip over its own steps (min ${minY.toFixed(2)} m > 0.6, ${fallFrames} low frames)`,
    minY > 0.6 && fallFrames === 0);
  check(`legs take exaggerated alternating high steps (peaks ${peakL.toFixed(2)}/${peakR.toFixed(2)} rad > 0.25; L−R std ${std.toFixed(2)} rad > 0.12, ${crossings} lead swaps)`,
    peakL > 0.25 && peakR > 0.25 && std > 0.12 && crossings >= 3);
  check(`Puppet-Master balance stays active during the wobble (max τ ${tauMax.toFixed(0)} N·m)`,
    tauMax > 20 && tauMax < 320.001);
}
console.log(`\nPROBE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
