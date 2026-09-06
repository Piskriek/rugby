/**
 * MOTOR — drive the Ragdoll joints toward target skeletal poses with PD.
 *
 * The torque law per degree of freedom (pure math in ./pd.ts):
 *
 *     tau = Kp * (theta_target - theta_current) - Kd * omega
 *
 * Gain sizing (PUPPET-MASTER rule, per the locomotion data):
 *
 *     Kp = I_eff * omegaN^2        Kd = 2 * zeta * sqrt(Kp * I_eff)
 *
 * where I_eff is the reduced moment of inertia of the child+parent pair
 * about the joint anchor line (parallel-axis included), omegaN = 15 rad/s
 * for the torso chain and 25 rad/s for the limbs, zeta = 1 (critical).
 * With the 120 Hz substep that keeps omegaN*dt = 0.125 (torso) .. 0.208
 * (limbs) — inside the discrete-stability band of the semi-implicit
 * integrator (~0.1..0.21), unlike the earlier blind T_max/thetaYield sizing
 * which pushed the light torso segments to omegaN*dt ~ 1 and yaw diverged
 * (see session notes). The joint's T_max stays a hard per-axis ceiling:
 * below it the joint tracks its pose; above it the joint yields
 * (active-ragdoll overpowered collapse under a heavy hit).
 *
 * Drive modes:
 *  - `active`   : PD torque with a per-axis T_max ceiling; the world-space
 *                 balance stabiliser is enabled by default (hips + calves
 *                 upright torque split by the BalanceController shares, see
 *                 balance.ts).
 *  - `kinematic`: the child body's orientation is slerped straight toward
 *                 the target each step (rigid pose-follow, no yielding).
 *  - `loose`     : no drive at all (pure ragdoll).
 *
 * Coordinates — every measure and every applied torque lives in the PARENT
 * body frame (self-consistent; the earlier code mixed parent-frame error
 * reads with child-frame torque application, scrambling axes on the legs
 * whose parent frames point ~180° from world-upright):
 *   qC, qP          — current world orientation of the child / parent body
 *   R   = conj(qP)·qC — current child-relative-parent rotation (PARENT frame)
 *   Rt  = pose target — desired child-relative-parent rotation (PARENT frame)
 *   e   = R·conj(Rt)  — residual error rotation (PARENT frame)
 *   tau = clamp(Kp*angle(e,axis) − Kd*omega_axis, ±T_max) per axis; the
 *         resulting parent-frame torque is rotated into the world and
 *         applied as +tau on the child and −tau on the parent (Newton pair).
 */
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { RagdollJoint, RagdollRig } from './rig';
import { pdAxis } from './pd';
import { BalanceController } from './balance';
import type {
  Axis, BodyPart, DriveMode, JointMotorTarget, JointName, PoseInput, PoseQuat, Vec3,
} from './types';
import { BIND, COLLIDERS, FOOT_PADS, REVOLUTE } from './skeleton';

export interface MotorJointState {
  /** |τ| actually applied to the child this frame (N·m). */
  torque: number;
  /** 0..1 fraction of the T_max budget used. */
  effort: number;
  overpowered: boolean;
  lastTau: { x: number; y: number; z: number };
}

export interface RagdollMotor {
  mode: DriveMode;
  strength: number;
  targets: Map<JointName, JointMotorTarget>;
  stats: Map<JointName, MotorJointState>;
  /** world-space balance stabiliser (active mode only; see balance.ts). */
  balance: BalanceController;
  /** TARCS procedural-leg-drive setpoint. Set to the player's desired
   *  horizontal velocity (world metres/s, y ignored) to replace the static
   *  lower-body targets with a wobble oscillator; set null to hold pose. */
  drive: Vec3 | null;
  /** live gait tuning knobs (mutate to exaggerate/calm the step). */
  walk: WalkParams;
  /** switch the drive mode (re-applies per-joint strength factors). */
  setMode(m: DriveMode): void;
  /** consume pose targets (relative child↔parent rotations per joint). */
  setPose(pose: PoseInput): void;
  /** run the PD law and apply torques. Call once per 120 Hz physics step,
   *  BEFORE world.step(). */
  step(dt: number, time?: number): void;
}

/* ------------------------------------------------- TARCS wobble drive ---- */
/**
 * TARCS — the wobble-gait setpoint generator (TABS-style procedural lower
 * body). The legs are driven by ONE phase clock `phase` (radians) that is
 * advanced by the player's horizontal velocity each step, so the cadence is
 * locked to movement and the same clock drives all four leg joints — the
 * gait cannot slowly de-sync into a trip. Each leg runs the clock at a
 * half-stride offset (anti-phase), so the legs alternate by construction.
 *
 * All quats returned here are ROTATIONS over the pose target, expressed in
 * each joint's parent frame (the frame the PD measures errors in):
 *  - the hip ball joints share the pelvis as parent, so a leg's thigh quat
 *    rotates the whole leg about the pelvis frame; legs advance in opposite
 *    phase but the SAME frame — hence the explicit `hipSign` (which way a
 *    positive thigh rotation sweeps the foot; tuned empirically to +1 so the
 *    character walks toward +z, the world-forward used by the probe).
 *  - the knee revolutes each carry their own hinge axis, so `fold` is always
 *    the positive hinge rotation (heel-up flexion on that leg's axis).
 *
 * A stride for one leg, as `phase` sweeps 0 → 2π (sin peaks at π/2):
 *   ψ ≈ 0      — toe-off, thigh at neutral, knee starting to fold
 *   ψ ≈ π/2    — high step: thigh at +hipAmp (lifted forward), knee at full
 *                fold (foot tucked clear of the floor)
 *   ψ ≈ π      — strike: thigh drops to +strike (foot placed ahead), knee
 *                straightens to nearly full extension
 *   ψ ≈ π..2π  — stance: weight on the planted foot, thigh sweeps back
 *                while the `bias` term (strongest at push-off) drives the
 *                body forward off the planted foot
 *
 * Tuning notes from the session (why the defaults look modest): the rig's
 * standing equilibrium sits exactly at the bind pose, so (a) the knees must
 * return to full extension outside the swing (a constant stance flex
 * topples it), (b) hip lift beyond ~0.5 rad or a fast cadence trips the
 * wobble into a forward fall, and (c) the whole-upper-body stiffness must
 * stay pair-sized or the spine saturates under the balance stabiliser. The
 * shipped defaults give a sustained ~0.15–0.25 m/s forward wobble-shuffle
 * with the hips never dropping below ~0.85 m in 10 s runs.
 */
export interface WalkParams {
  /** rad — swing-leg thigh lift; the cartoon high step. */
  hipAmp: number;
  /** rad — thigh angle at heel strike (forward placement). */
  strike: number;
  /** rad — constant forward thigh offset. Applied to the planted (stance)
   *  leg this pushes the body forward (the foot cannot move, so the hip
   *  reaction drives the pelvis onward) — the wobble's propulsion. */
  bias: number;
  /** rad — swing-leg knee fold at mid-swing (foot clearance). */
  kneeAmp: number;
  /** rad — stance-knee fold (kept small; a stiff leg under load). */
  kneeStance: number;
  /** rad of phase per metre walked (cadence ∝ player speed). */
  rate: number;
  /** rad/s of phase when stationary (keeps the wobble alive at idle). */
  idleRate: number;
  /** +1/−1 — which hip-rotation sign sweeps a leg forward. */
  hipSign: number;
  /** rad — alternating pelvis roll, peaks when each leg is at mid-swing. */
  mldAmp: number;
}
/** Empirically tuned on the discrete rig (120 Hz, fused feet, no ankles):
 *  hipSign=+1 sweeps a leg toward +z (verified: the −1 mirror shambles
 *  backward); `bias` is the propulsion term (0.2+ rad sustains ~0.2 m/s of
 *  forward shuffle without tipping); the knee folds 0.9 rad only mid-swing
 *  and stays at bind the rest of the cycle (any CONSTANT knee flex — even a
 *  0.35 rad crouch — topples the rig because its standing equilibrium sits
 *  exactly at the bind pose). This set survived 10+ s runs at Δz ≈ 1.4–1.6 m
 *  with hips never below ~0.87 m. */
export const TARCS_DEFAULT: WalkParams = {
  hipAmp: 0.4, strike: 0.3, bias: 0.22,
  kneeAmp: 0.9, kneeStance: 0,
  rate: 10, idleRate: 0, hipSign: 1, mldAmp: 0,
};

/** Leg-cycle function: rotation (rad) of one leg's thigh for its own phase ψ
 *  (ψ = 0 at toe-off, rising through the stride; see the block above). */
function thighAngle(ψ: number, p: WalkParams): number {
  // sin ψ: neutral → lift (+hipAmp at π/2) → neutral at strike (ψ=π);
  // (1−cosψ)/2 pushes the strike half-cycle forward (heel lands ahead of the
  // hip) while the back-sweep of stance stays shallow.
  return p.hipSign * (p.hipAmp * Math.sin(ψ) + p.strike * (0.5 - 0.5 * Math.cos(ψ)))
    + p.bias * (0.5 + 0.5 * Math.cos(ψ));
}
/** Knee fold (rad) for a leg at phase ψ — full fold just after the thigh
 *  reaches its lift, fully extended again by heel strike. */
function kneeFold(ψ: number, p: WalkParams): number {
  const s = Math.sin(ψ - 0.35);                 // fold peaks slightly after lift
  return p.kneeStance + Math.max(0, s) * (p.kneeAmp - p.kneeStance);
}

const qRotX = (a: number): PoseQuat => ({ x: Math.sin(a * 0.5), y: 0, z: 0, w: Math.cos(a * 0.5) });
const qRotZ = (a: number): PoseQuat => ({ x: 0, y: 0, z: Math.sin(a * 0.5), w: Math.cos(a * 0.5) });
/** Unit quat about a given axis (axis need not be unit — it is normalised). */
function qRotAxis(ax: Vec3, a: number): PoseQuat {
  const l = Math.hypot(ax.x, ax.y, ax.z) || 1;
  const s = Math.sin(a * 0.5) / l;
  return { x: ax.x * s, y: ax.y * s, z: ax.z * s, w: Math.cos(a * 0.5) };
}

/** Anti-phase gait setpoints for the two legs (rad, per leg). */
export interface TarcsLeg {
  /** rad — thigh rotation applied to the hip ball joint. */
  thigh: number;
  /** rad — knee fold applied about the knee's own hinge axis. */
  knee: number;
}
export function tarcsLegs(phase: number, p: WalkParams): {
  l: TarcsLeg; r: TarcsLeg; mld: number;
} {
  const L = phase;               // left leg: starts at toe-off
  const R = phase + Math.PI;     // right leg: exactly half a stride behind
  return {
    l: { thigh: thighAngle(L, p), knee: kneeFold(L, p) },
    r: { thigh: thighAngle(R, p), knee: kneeFold(R, p) },
    mld: p.mldAmp * Math.sin(L),
  };
}

/* ---------------------------------------------------- quat helpers ------- */
const qConj = (q: PoseQuat): PoseQuat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qMul = (a: PoseQuat, b: PoseQuat): PoseQuat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qNorm = (q: PoseQuat): PoseQuat => {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};
const rot = (b: RigidBody): PoseQuat => {
  const q = b.rotation();
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};
function rotateVec(q: PoseQuat, v: Vec3): Vec3 {
  const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = qMul(qMul(q, qv), qConj(q));
  return { x: r.x, y: r.y, z: r.z };
}
function dotV(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function subV(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function axisVec(a: Axis): Vec3 {
  return a === 'x' ? { x: 1, y: 0, z: 0 } : a === 'y' ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
}
function normV(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
function slerp(a: PoseQuat, b: PoseQuat, t: number): PoseQuat {
  let d = dot4(a, b);
  if (d < 0) { d = -d; b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }; }
  if (d > 0.9995) {
    return qNorm({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t });
  }
  const th = Math.acos(d);
  const sth = Math.sin(th) || 1;
  const wa = Math.sin((1 - t) * th) / sth;
  const wb = Math.sin(t * th) / sth;
  return qNorm({ x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z, w: wa * a.w + wb * b.w });
}
const dot4 = (a: PoseQuat, b: PoseQuat) => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The bind-relative rotation of the child under the parent (zero-error pose
 * at spawn), measured in the PARENT frame: conj(qParent)·qChild. This is the
 * intrinsic joint rotation — invariant to whole-body rotation — which the PD
 * must track.
 */
export function bindRelJoint(j: RagdollJoint): PoseQuat {
  return qMul(qConj(BIND[j.parentPart].q), BIND[j.childPart].q);
}

/* ------------------------------------------------ inertia & gain sizing --- */
/** torso-chain joints keep omegaN = 15 rad/s; limbs run at 25 rad/s (both
 *  within the 120 Hz semi-implicit stability band: omegaN*dt = 0.125..0.208). */
export const WN_TORSO = 15;
export const WN_LIMB = 25;
const TORSO_JOINTS = new Set<JointName>(['hips_spine', 'spine_chest', 'chest_neck', 'neck_head']);
const DAMP_ZETA = 1.0;

/** Signed angle (rad) of a rotation quaternion about a unit axis u. For a
 *  small residual error e = (cos φ/2, u·sin φ/2) this returns φ exactly;
 *  for a full 3-DOF error it returns the projection onto that axis. */
function angleAboutAxis(e: PoseQuat, u: Vec3): number {
  const w = Math.max(-1, Math.min(1, e.w));
  if (w > 0.999999) return 0;
  return 2 * Math.atan2(dotV({ x: e.x, y: e.y, z: e.z }, u), w);
}

/** Body-frame centre of mass derived from the AUTHORED collider specs
 *  (each collider's mass sits at its shape centre; symmetric shapes →
 *  exact). NOT read from the runtime colliders: this rapier3d-compat
 *  build returns WORLD positions from collider.translation(), which would
 *  put the COM metres away from the joint anchor. */
function bodyComLocal(part: BodyPart): Vec3 {
  let m = 0, x = 0, y = 0, z = 0;
  for (const c of COLLIDERS) {
    if (c.part !== part) continue;
    const ci = c.mass ?? 1;
    m += ci;
    x += ci * (c.offset.x ?? 0);
    y += ci * (c.offset.y ?? 0);
    z += ci * (c.offset.z ?? 0);
  }
  for (const p of FOOT_PADS) {
    if (p.part !== part) continue;
    m += p.mass;
    x += p.mass * p.centerLocal.x;
    y += p.mass * p.centerLocal.y;
    z += p.mass * p.centerLocal.z;
  }
  if (m <= 0) return { x: 0, y: 0, z: 0 };
  return { x: x / m, y: y / m, z: z / m };
}

/**
 * Effective inertia (kg·m²) per joint per parent-frame axis, computed from
 * the WHOLE child subtree vs the REST of the body (bind pose). Unlike a pure
 * child↔parent pair, a top-of-chain joint (hips_spine, spine_chest) carries
 * the entire ~30 kg upper body hanging below it, so a pair-only estimate
 * under-sizes those gains by an order of magnitude and the torso jackknifes
 * under its own weight (measured). Because Kp = I_eff·ωn² with the correct
 * modal inertia, the closed-loop natural frequency is ωn by construction
 * (0.125..0.208 at 120 Hz) while the joint stays stiff enough to hold the
 * hanging load; the T_max ceiling still provides the yield path.
 */
function subtreeInertias(rig: RagdollRig): Map<JointName, { ic: Vec3; ip: Vec3 }> {
  const childrenOf = new Map<BodyPart, RagdollJoint[]>();
  for (const j of rig.joints) {
    const list = childrenOf.get(j.parentPart) ?? [];
    list.push(j);
    childrenOf.set(j.parentPart, list);
  }
  const partMass = new Map<BodyPart, number>();
  for (const b of rig.bodies) partMass.set(b.part, b.body.mass());
  const comLocal = new Map<BodyPart, Vec3>();
  for (const b of rig.bodies) comLocal.set(b.part, bodyComLocal(b.part));
  const all = new Set(rig.bodies.map(b => b.part));

  const subtreeParts = (root: BodyPart): Set<BodyPart> => {
    const out = new Set<BodyPart>([root]);
    const stack = [root];
    while (stack.length) {
      const p = stack.pop()!;
      for (const j of childrenOf.get(p) ?? []) {
        if (!out.has(j.childPart)) { out.add(j.childPart); stack.push(j.childPart); }
      }
    }
    return out;
  };
  /** Sum of the parallel-axis moments of a set of bodies about the joint
   *  anchor, for a unit axis given in WORLD bind frame. */
  const inertiaOf = (parts: Set<BodyPart>, axisWorld: Vec3, anchorWorld: Vec3): number => {
    let sum = 0;
    for (const pn of parts) {
      const rb = rig.byPart.get(pn)!;
      const uLocal = normV(rotateVec(qConj(rb.bind.q), axisWorld));
      const aLocal = rotateVec(qConj(rb.bind.q), subV(anchorWorld, rb.bind.p));
      sum += anchorAxisMoment(rb.body, aLocal, uLocal, comLocal.get(pn) ?? { x: 0, y: 0, z: 0 });
    }
    return Math.max(1e-6, sum);
  };
  const out = new Map<JointName, { ic: Vec3; ip: Vec3 }>();
  for (const j of rig.joints) {
    const sub = subtreeParts(j.childPart);
    const rest = new Set<BodyPart>();
    for (const pn of all) if (!sub.has(pn)) rest.add(pn);
    const aw = j.spec.anchorWorld;
    const parent = rig.byPart.get(j.parentPart)!;
    const ic: Vec3 = { x: 0, y: 0, z: 0 };
    const ip: Vec3 = { x: 0, y: 0, z: 0 };
    for (const a of AXES) {
      // DOF axes live in the parent frame; at bind they are the parent's
      // local axes rotated to world.
      const axisWorld = rotateVec(parent.bind.q, axisVec(a));
      ic[a] = inertiaOf(sub, axisWorld, aw);
      ip[a] = inertiaOf(rest, axisWorld, aw);
    }
    out.set(j.name, { ic, ip });
  }
  return out;
}

/** Parallel-axis moment of one body about a line through `anchorLocal` (its
 *  own frame) parallel to unit axis `u` (its own frame). */
function anchorAxisMoment(
  body: RigidBody,
  anchorLocal: Vec3,
  u: Vec3,
  comLocal: Vec3,
): number {
  const m = body.mass();
  const p = body.principalInertia();
  // principal moment along u (diagonal approximation of the inertia tensor)
  const pAlong = p.x * u.x * u.x + p.y * u.y * u.y + p.z * u.z * u.z;
  const v = subV(comLocal, anchorLocal);
  const d = dotV(v, u);
  const rPerp2 = Math.max(0, dotV(v, v) - d * d);
  return Math.max(1e-6, m * rPerp2 + Math.max(pAlong, 1e-6));
}

function localAxisChar(axis: Vec3): Axis {
  const ax = Math.abs(axis.x), ay = Math.abs(axis.y), az = Math.abs(axis.z);
  if (ax >= ay && ax >= az) return 'x';
  if (ay >= az) return 'y';
  return 'z';
}

/* ------------------------------------------------------------ the motor -- */
export function createMotor(rig: RagdollRig, opts?: {
  mode?: DriveMode; strength?: number; balance?: BalanceController | boolean;
  /** torso-chain natural frequency (rad/s); default WN_TORSO=15. */
  torsoWN?: number;
  /** limb natural frequency (rad/s); default WN_LIMB=25. */
  limbWN?: number;
  /** inertia model for gain sizing: 'subtree' (whole child subtree vs rest
   *  of the body) or 'pair' (immediate child vs parent only). */
  inertia?: 'subtree' | 'pair';
}): RagdollMotor {
  const mode = opts?.mode ?? 'active';
  const strength = opts?.strength ?? 1;
  const wnTorso = opts?.torsoWN ?? WN_TORSO;
  const wnLimb = opts?.limbWN ?? WN_LIMB;
  // 'pair' = immediate child↔parent reduced inertia — the verified-stable
  // sizing for this rig (a whole-subtree sizing makes the spine saturate and
  // the balance gate drops, and the rig tips within ~1.5 s; see session
  // notes). Keep 'subtree' available as an experiment knob.
  const inertiaMode = opts?.inertia ?? 'pair';
  // In the PUPPET-MASTER layout there are no ankles to keep the COM over the
  // support, so ACTIVE mode defaults the world-space balance stabiliser ON.
  const balance = opts?.balance === undefined
    ? new BalanceController(mode === 'active')
    : (opts.balance === true ? new BalanceController(true)
      : (opts.balance === false ? new BalanceController(false) : opts.balance));
  const drive: Vec3 | null = null;
  const walk: WalkParams = { ...TARCS_DEFAULT };
  const poseBones = new Map<BodyPart, PoseQuat | undefined>();
  const poseMode: { mode: DriveMode; strength: number } = { mode, strength };
  /** TARCS gait phase accumulator (rad) — locked to distance walked. */
  let legPhase = 0;
  const targets = new Map<JointName, JointMotorTarget>();
  const stats = new Map<JointName, MotorJointState>();
  /** per-joint weakness factor (wrists 0.15 — weak hands). */
  const factor = new Map<JointName, number>();
  /** hinge axis in the PARENT body's local frame (revolute joints) — the
   *  DOF measure axis of the parent-frame controller. */
  const hingeAxisParent = new Map<JointName, Vec3>();
  /** per-joint subtree-vs-rest modal inertia per parent-frame axis. */
  const subtreeI = inertiaMode === 'subtree' ? subtreeInertias(rig) : new Map<JointName, { ic: Vec3; ip: Vec3 }>();
  let internalTime = 0;
  for (const j of rig.joints) {
    // default target = the bind pose (the rig holds its spawn pose)
    const f = j.spec.motor.strength ?? 1;
    factor.set(j.name, f);
    const spec = j.spec.motor;
    const wn = TORSO_JOINTS.has(j.name) ? wnTorso : wnLimb;
    const t: JointMotorTarget = {
      ...spec,
      target: bindRelJoint(j),
      kinematic: mode === 'kinematic',
      strength: mode === 'kinematic' ? 1 : mode === 'loose' ? 0 : f,
    };
    const parentPart = rig.byPart.get(j.parentPart)!;
    // Subtree-mode torso ceilings must clear the balance stabiliser's own
    // world torque (the upright couple whips the pelvis through the spine):
    // with kp sized to the full hanging load, the old 150/55/28 N·m ceilings
    // saturated on every correction and gated the balance off entirely.
    if (inertiaMode === 'subtree' && TORSO_JOINTS.has(j.name)) {
      spec.tMax = j.name === 'hips_spine' || j.name === 'spine_chest' ? 360
        : j.name === 'chest_neck' ? 130 : 70;
    }
    const sizeAxis = (ax: Axis) => {
      const aw = j.spec.anchorWorld;
      // joint DOF axis in world bind frame (parent-frame x/y/z at bind)
      const axisWorld = rotateVec(parentPart.bind.q, axisVec(ax));
      let iEff: number;
      if (inertiaMode === 'subtree') {
        const I = subtreeI.get(j.name)!;
        iEff = 1 / (1 / I.ic[ax] + 1 / I.ip[ax]);
      } else {
        // legacy immediate child↔parent pair about the joint anchor line
        const childB = rig.byPart.get(j.childPart)!;
        const ic = anchorAxisMoment(childB.body,
          rotateVec(qConj(childB.bind.q), subV(aw, childB.bind.p)),
          normV(rotateVec(qConj(childB.bind.q), axisWorld)),
          bodyComLocal(j.childPart));
        const ip = anchorAxisMoment(parentPart.body,
          rotateVec(qConj(parentPart.bind.q), subV(aw, parentPart.bind.p)),
          normV(rotateVec(qConj(parentPart.bind.q), axisWorld)),
          bodyComLocal(j.parentPart));
        iEff = 1 / (1 / ic + 1 / ip);
      }
      const kp = iEff * wn * wn;
      const kd = 2 * DAMP_ZETA * Math.sqrt(kp * iEff);
      return { kp, kd };
    };
    if (j.spec.kind === 'revolute') {
      // single DOF about the hinge line (same geometric line in both bodies)
      const axisParent = rotateVec(qConj(parentPart.bind.q), j.hingeAxisWorld);
      hingeAxisParent.set(j.name, normV(axisParent));
      const a = localAxisChar(axisParent);
      const g = sizeAxis(a);
      for (const ax of AXES) {
        t[ax] = ax === a ? g : { kp: 0, kd: 0 };
      }
    } else {
      // spherical ball joint — three DOFs about the parent frame axes
      for (const ax of AXES) {
        t[ax] = sizeAxis(ax);
      }
    }
    targets.set(j.name, t);
    stats.set(j.name, { torque: 0, effort: 0, overpowered: false, lastTau: { x: 0, y: 0, z: 0 } });
  }

  const r: RagdollMotor = {
    mode, strength, targets, stats, balance, drive, walk,
    setMode(m: DriveMode) {
      r.mode = m;
      r.balance.enabled = m === 'active';
      poseMode.mode = m;
      for (const [name, t] of targets) {
        const f = factor.get(name) ?? 1;
        t.kinematic = m === 'kinematic';
        t.strength = m === 'kinematic' ? 1 : m === 'loose' ? 0 : f;
      }
    },
    setPose(pose: PoseInput) {
      poseMode.mode = pose.mode;
      poseMode.strength = pose.strength ?? 1;
      for (const j of rig.joints) {
        poseBones.set(j.childPart, pose.bones[j.childPart]);
      }
    },
    step(dt: number, time?: number) {
      const simTime = time ?? internalTime;
      // COMPAT WORKAROUND: this rapier3d-compat build never clears the
      // user-added force/torque accumulators after world.step(), so a torque
      // added once would keep being re-applied every step forever and the
      // joint PD would turn into an integrator that pumped unbounded energy
      // (measured: free-space joint errors exploded 0→2 rad in 0.2 s). Clear
      // the accumulators here — right after the previous world.step() has
      // consumed them and just before we add this frame's motor torques.
      for (const b of rig.bodies) {
        b.body.resetTorques(true);
        b.body.resetForces(true);
      }

      // ---- resolve this step's targets ------------------------------------
      // Default targets = bind (or the caller's pose). When the player's
      // `drive` is set, the TARCS oscillator replaces the four leg targets so
      // the lower body steps procedurally; upper-body targets are untouched,
      // so the torso pose (and the world-space balance controller) keeps the
      // character upright while the legs flail below the hip.
      const kin = poseMode.mode === 'kinematic';
      if (poseMode.mode !== 'loose') {
        const tarcs = poseMode.mode === 'active' && r.drive
          ? resolveTarcs(r.drive, dt)
          : null;
        for (const j of rig.joints) {
          const t = targets.get(j.name)!;
          t.kinematic = kin;
          const f = factor.get(j.name) ?? 1;
          t.strength = kin ? 1 : (poseMode.strength ?? 1) * f;
          let want = poseBones.get(j.childPart) ?? bindRelJoint(j);
          if (tarcs) {
            // legs: oscillator setpoints composed over the caller pose; the
            // hips_spine joint (child 'spine') carries the mediolateral sway
            // so the wobble has somewhere to dump weight between strides.
            const leg = tarcs.legs.get(j.childPart as BodyPart);
            if (leg) want = qMul(leg, want);
            else if (j.childPart === 'spine' && j.parentPart === 'hips')
              want = qMul(tarcs.mld, want);
          }
          t.target = qNorm(want);
        }
      }
      for (const j of rig.joints) {
        const st = stats.get(j.name)!;
        const t = targets.get(j.name)!;
        st.torque = 0; st.effort = 0; st.overpowered = false; st.lastTau = { x: 0, y: 0, z: 0 };
        if (t.strength <= 0) continue;
        const child = rig.byPart.get(j.childPart)?.body;
        const parent = rig.byPart.get(j.parentPart)?.body;
        if (!child || !parent) continue;

        const qC = rot(child);
        const qP = rot(parent);

        if (t.kinematic && t.strength >= 1) {
          // ---- mode 1: full kinematic target (rigid pose-follow) ----------
          // target is parent-frame-relative, so the child's desired world
          // orientation is qP ⊗ target (follows the parent's current frame).
          const desired = qMul(qP, qNorm(t.target));
          const out = slerp(qC, desired, Math.min(1, dt * 40)); // ~10 frames
          child.setRotation({ x: out.x, y: out.y, z: out.z, w: out.w }, true);
          st.torque = t.tMax; st.effort = 1;
          continue;
        }

        // ---- mode 2: active PD with T_max ceilings ------------------------
        // Rrel = conj(qP)·qC — child-under-parent in the PARENT frame (the
        // intrinsic joint rotation, invariant to whole-body rotation).
        // Residual error e = Rrel·conj(target) — also in the PARENT frame.
        const Rrel = qMul(qConj(qP), qC);
        const e = qMul(Rrel, qConj(qNorm(t.target)));
        const s = clamp01(t.strength);
        if (s <= 0) continue;

        // relative angular velocity, rotated into the parent frame
        const avC = child.angvel();
        const avP = parent.angvel();
        const wRelP = rotateVec(qConj(qP), {
          x: avC.x - avP.x, y: avC.y - avP.y, z: avC.z - avP.z,
        });

        let tauP: Vec3 = { x: 0, y: 0, z: 0 };
        let overpowered = false;
        if (j.spec.kind === 'revolute') {
          const uP = hingeAxisParent.get(j.name)!;
          const a = localAxisChar(uP);
          const err = angleAboutAxis(e, uP);
          const omega = dotV(wRelP, uP);
          const gain = t[a];
          const pd = pdAxis(0, { angle: err, omega }, { kp: gain.kp * s, kd: gain.kd * s }, t.tMax * s);
          tauP = { x: uP.x * pd.tau, y: uP.y * pd.tau, z: uP.z * pd.tau };
          overpowered = pd.overpowered;
        } else {
          for (const ax of AXES) {
            const gain = t[ax];
            const err = angleAboutAxis(e, axisVec(ax));
            const omega = dotV(wRelP, axisVec(ax));
            const pd = pdAxis(0, { angle: err, omega }, { kp: gain.kp * s, kd: gain.kd * s }, t.tMax * s);
            tauP[ax] = pd.tau;
            if (pd.overpowered) overpowered = true;
          }
        }
        // apply the Newton pair in world axes (parent frame → world)
        if (tauP.x !== 0 || tauP.y !== 0 || tauP.z !== 0) {
          const tw = rotateVec(qP, tauP);
          child.addTorque({ x: tw.x, y: tw.y, z: tw.z }, true);
          parent.addTorque({ x: -tw.x, y: -tw.y, z: -tw.z }, true);
        }
        st.torque = Math.abs(tauP.x) + Math.abs(tauP.y) + Math.abs(tauP.z);
        st.effort = Math.min(1, st.torque / Math.max(1, 3 * t.tMax));
        st.lastTau = tauP;
        st.overpowered = overpowered;
      }

      // ---- world-space balance stabiliser (active mode only) --------------
      if (mode === 'active' && balance.enabled && balanceGate()) {
        const tau = balance.update(rig, simTime);
        if (tau.x !== 0 || tau.z !== 0) {
          const hips = rig.byPart.get('hips')?.body;
          const chest = rig.byPart.get('chest')?.body;
          const calfL = rig.byPart.get('calf_l')?.body;
          const calfR = rig.byPart.get('calf_r')?.body;
          // All components push the SAME world direction: hips/chest drive the
          // upper body while the calves (fused feet, planted on the ground)
          // act as the grounded reaction — the pad contact turns the couple
          // into a net moment about the support (an "ankleless" ankle
          // strategy). Shares sum to 1 (hip + chest + 2·calf).
          if (hips) hips.addTorque({ x: tau.x * balance.hipShare, y: 0, z: tau.z * balance.hipShare }, true);
          if (chest && balance.chestShare > 0) chest.addTorque({ x: tau.x * balance.chestShare, y: 0, z: tau.z * balance.chestShare }, true);
          if (calfL && balance.calfShare > 0) calfL.addTorque({ x: tau.x * balance.calfShare, y: 0, z: tau.z * balance.calfShare }, true);
          if (calfR && balance.calfShare > 0) calfR.addTorque({ x: tau.x * balance.calfShare, y: 0, z: tau.z * balance.calfShare }, true);
        }
      }
      internalTime = simTime + dt;
    },
  } satisfies RagdollMotor;

  function balanceGate(): boolean {
    // only stabilise while most joints are inside their torque budget
    let op = 0;
    for (const s of stats.values()) if (s.overpowered) op++;
    return op <= 6;
  }

  /** Advance the wobble clock and build the per-joint setpoint quats. The
   *  hip joints share the pelvis frame (rotation about its x-axis sweeps the
   *  thigh in the walking plane); each knee gets its fold about its own hinge
   *  axis (stored parent-frame unit axis, sign already mirrored per side). */
  function resolveTarcs(d: Vec3, dt: number): {
    legs: Map<BodyPart, PoseQuat>; mld: PoseQuat;
  } {
    const speed = Math.hypot(d.x, d.z);
    legPhase += (speed * r.walk.rate + r.walk.idleRate) * dt;
    const g = tarcsLegs(legPhase, r.walk);
    const legs = new Map<BodyPart, PoseQuat>();
    legs.set('thigh_l', qRotX(g.l.thigh));
    legs.set('thigh_r', qRotX(g.r.thigh));
    const hingeL = hingeAxisParent.get('knee_l');
    const hingeR = hingeAxisParent.get('knee_r');
    legs.set('calf_l', hingeL ? qRotAxis(hingeL, g.l.knee) : qRotX(g.l.knee));
    legs.set('calf_r', hingeR ? qRotAxis(hingeR, g.r.knee) : qRotX(g.r.knee));
    return { legs, mld: qRotZ(g.mld) };
  }
  return r;
}
const AXES: Axis[] = ['x', 'y', 'z'];

export function motorStats(m: RagdollMotor): { effort: number; overpowered: number } {
  let effort = 0; let op = 0;
  for (const s of m.stats.values()) { effort += s.effort; if (s.overpowered) op++; }
  return { effort: m.stats.size ? effort / m.stats.size : 0, overpowered: op };
}

export { REVOLUTE };
