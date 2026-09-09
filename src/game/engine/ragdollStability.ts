/**
 * RAGDOLL STABILITY — ANATOMICAL JOINT LIMITS AND ANGULAR DAMPING.
 *
 * A tackled body that folds the wrong way is a fake ragdoll, and one that
 * vibrates on the turf is a cheap one. Two numbers govern both:
 *
 *  ANGULAR DAMPING  γ = 10 s⁻¹. Exponential decay on the rotational
 *    component of every body — high-frequency shaking and jitter die out in
 *    a tenth of a second while the fall itself (which is linear, toward the
 *    floor) keeps its weight. `dampFactor` turns γ into a per-frame or
 *    per-substep multiplier so a caller can apply it exactly.
 *
 *  JOINT LIMITS. A human spine pitches only −20°..+40° (you can lean back a
 *    little and forward a lot) and rolls side to side at most ±15°; a knee and
 *    an elbow are single-axis hinges that straighten to 0° and fold to at most
 *    135°. Any solved pose that violates these is an anatomical error — the
 *    anti-oscillation probe flags it.
 *
 * Pure and headless so `openplayprobe.ts` can simulate twenty heavy tackles
 * and assert zero limit violations and zero >50 rad/s oscillation spikes.
 */

/** The angular-damping decay constant, s⁻¹. */
export const RAGDOLL_ANGULAR_GAMMA_1_PER_S = 10.0;

/** An exponential angular-damping factor over a time window `dt`. */
export function angularDampFactor(dtSeconds: number): number {
  const t = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
  return Math.exp(-RAGDOLL_ANGULAR_GAMMA_1_PER_S * t);
}

/* ---- anatomical joint limits (degrees) ---- */
export const SPINE_PITCH_MIN_DEG = -20;
export const SPINE_PITCH_MAX_DEG = 40;
export const SPINE_ROLL_MIN_DEG = -15;
export const SPINE_ROLL_MAX_DEG = 15;
/** A hinge (knee/elbow) is a single axis: 0° = straight, 135° = folded. */
export const HINGE_MIN_DEG = 0;
export const HINGE_MAX_DEG = 135;

/** The spec's oscillation ceiling — above this a ragdoll is visibly buzzing. */
export const OSCILLATION_VIOLATION_RAD_PER_S = 50;

export interface JointAngles {
  /** pitch (forward/back flexion) of the spine, degrees */
  spinePitchDeg: number;
  /** lateral roll of the spine, degrees */
  spineRollDeg: number;
  /** knee flexion, degrees (0 straight … 135 folded) */
  kneeL?: number; kneeR?: number;
  /** elbow flexion, degrees */
  elbowL?: number; elbowR?: number;
}

/** Is this spine pose inside the human envelope? */
export function spineWithinLimits(pitchDeg: number, rollDeg: number): boolean {
  return pitchDeg >= SPINE_PITCH_MIN_DEG && pitchDeg <= SPINE_PITCH_MAX_DEG
    && rollDeg >= SPINE_ROLL_MIN_DEG && rollDeg <= SPINE_ROLL_MAX_DEG;
}

/** Clamp an angle into a [min,max] band (the pose correction a solver applies). */
export function clampJointAngle(deg: number, min: number, max: number): number {
  if (!Number.isFinite(deg)) return min;
  return deg < min ? min : deg > max ? max : deg;
}

/** Correct every measured joint into its anatomical band. Returns a copy with
 *  all angles legal; a caller writes the result back into its pose. */
export function enforceJointLimits(a: JointAngles): JointAngles {
  const spinePitchDeg = clampJointAngle(a.spinePitchDeg, SPINE_PITCH_MIN_DEG, SPINE_PITCH_MAX_DEG);
  const spineRollDeg = clampJointAngle(a.spineRollDeg, SPINE_ROLL_MIN_DEG, SPINE_ROLL_MAX_DEG);
  return {
    spinePitchDeg, spineRollDeg,
    kneeL: hingeClamp(a.kneeL), kneeR: hingeClamp(a.kneeR),
    elbowL: hingeClamp(a.elbowL), elbowR: hingeClamp(a.elbowR),
  };
}

function hingeClamp(v: number | undefined): number | undefined {
  return v === undefined ? undefined : clampJointAngle(v, HINGE_MIN_DEG, HINGE_MAX_DEG);
}

/** Does every supplied hinge lie inside its single-axis [0°,135°] band? */
export function hingesWithinLimits(a: JointAngles): boolean {
  for (const h of [a.kneeL, a.kneeR, a.elbowL, a.elbowR]) {
    if (h !== undefined && (h < HINGE_MIN_DEG || h > HINGE_MAX_DEG)) return false;
  }
  return true;
}

/** A full post-tackle stability verdict for one body. */
export function stabilityViolations(a: JointAngles): string[] {
  const v: string[] = [];
  if (!spineWithinLimits(a.spinePitchDeg, a.spineRollDeg)) {
    v.push(`spine (pitch ${a.spinePitchDeg.toFixed(0)}°, roll ${a.spineRollDeg.toFixed(0)}°) out of envelope`);
  }
  if (!hingesWithinLimits(a)) v.push('a hinge (knee/elbow) outside [0°,135°]');
  return v;
}

/** True when a solved angular velocity exceeds the visible-oscillation ceiling. */
export function isOscillationViolation(angularVelocityRadPerS: number): boolean {
  return Math.abs(angularVelocityRadPerS) > OSCILLATION_VIOLATION_RAD_PER_S;
}
