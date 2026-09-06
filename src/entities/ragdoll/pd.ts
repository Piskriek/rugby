/**
 * PD MOTOR — the per-joint torque law for the active ragdoll.
 *
 *     tau = Kp * (theta_target - theta_current) - Kd * omega
 *
 * This module is PURE and deterministic: it takes angles/velocities and
 * returns the torque vector. Rapier integration happens in motor.ts.
 *
 * The active-ragdoll rule (requirement): while the target pose is reachable
 * and the external impulse is below the motor's ceiling the joint tracks the
 * pose; when an external collision torque exceeds T_max the joint yields —
 * the character collapses naturally under heavy force.
 */
import type { MotorAxis } from './types';

export interface AxisState {
  /** current relative angle about this axis (rad). */
  angle: number;
  /** current relative angular velocity about this axis (rad/s). */
  omega: number;
}

/** Pure PD torque for a single rotational axis.
 *  theta_error is wrapped to [-pi, pi]. Clamped to tMax (the motor ceiling). */
export function pdAxis(
  target: number,
  state: AxisState,
  g: MotorAxis,
  tMax: number,
): { tau: number; overpowered: boolean } {
  let err = target - state.angle;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const tau = g.kp * err - g.kd * state.omega;
  const overpowered = Math.abs(tau) > tMax;
  return { tau: overpowered ? Math.sign(tau) * tMax : tau, overpowered };
}

/** Pure PD torque for a full 3-axis spherical joint. */
export function pdBall(
  target: { x: number; y: number; z: number },
  state: { x: AxisState; y: AxisState; z: AxisState },
  gains: { x: MotorAxis; y: MotorAxis; z: MotorAxis },
  tMax: number,
): { tau: { x: number; y: number; z: number }; overpowered: boolean } {
  const tx = pdAxis(target.x, state.x, gains.x, tMax);
  const ty = pdAxis(target.y, state.y, gains.y, tMax);
  const tz = pdAxis(target.z, state.z, gains.z, tMax);
  return {
    tau: { x: tx.tau, y: ty.tau, z: tz.tau },
    overpowered: tx.overpowered || ty.overpowered || tz.overpowered,
  };
}

/** Convenience: PD torque for a single-axis (revolute) joint. */
export function pdHinge(
  target: number,
  state: AxisState,
  gain: MotorAxis,
  tMax: number,
): { tau: number; overpowered: boolean } {
  return pdAxis(target, state, gain, tMax);
}

/** Clamp a target angle into a [min,max] band (the human limit). */
export function clampAngle(angle: number, min: number, max: number): number {
  if (angle < min) return min;
  if (angle > max) return max;
  return angle;
}

/** Wrap any angle to [-pi, pi]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Strength gate: scale motor gains (and ceiling) by 0..1. */
export function scaledGains(g: MotorAxis, strength: number): MotorAxis {
  const s = Math.max(0, Math.min(1, strength));
  return { kp: g.kp * s, kd: g.kd * s };
}

/* --------------------------------------------------- quaternion math ------ */
/** Minimal signed angle of a quaternion about a given model axis.
 *  q must be near-pure (small twist) for the single-axis read to be exact;
 *  for a full ball joint we decompose (see decomposeBall). */
export function angleAbout(q: { x: number; y: number; z: number; w: number }, axis: 'x' | 'y' | 'z'): number {
  const w = Math.max(-1, Math.min(1, q.w));
  const ang = 2 * Math.acos(w);
  const s = Math.sin(ang / 2);
  if (s < 1e-6) return 0;
  const c = axis === 'x' ? q.x : axis === 'y' ? q.y : q.z;
  return (c / s) * ang;
}

/**
 * Decompose a relative quaternion into (x = forward-bend, y = twist,
 * z = roll/abduct) rotations about the frame axes. This is a Tait-Bryan
 * extraction in X→Y→Z order, kept stable for the sub-90° joint ranges the
 * human limits permit.
 */
export function decomposeBall(q: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number } {
  const w = q.w, x = q.x, y = q.y, z = q.z;
  // roll (about Z) from the standard Tait-Bryan (ZYX) — but we keep the
  // convention X=pitch, Y=yaw, Z=roll with the same extraction order.
  const sinR = 2 * (w * z + x * y);
  const cosR = 1 - 2 * (y * y + z * z);
  const roll = Math.atan2(sinR, cosR);
  // pitch (about X)
  const sinP = 2 * (w * x - y * z);
  let pitch = Math.abs(sinP) >= 1 ? Math.sign(sinP) * Math.PI / 2 : Math.asin(sinP);
  // yaw (about Y)
  const sinY = 2 * (w * y - z * x);
  const cosY = 1 - 2 * (x * x + y * y);
  const yaw = Math.atan2(sinY, cosY);
  // wrap each into [-pi, pi]
  const wf = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  pitch = wf(pitch);
  return { x: pitch, y: yaw, z: wf(roll) };
}
