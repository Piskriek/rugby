/**
 * BALANCE — world-space upright ("Puppet Master") stabiliser.
 *
 * The joint PD motors hold the ragdoll's POSTURE, but a character standing
 * on two feet is an inverted pendulum: without any reference to the world
 * vertical the slightest perturbation tips the whole chain over. In the
 * PUPPET-MASTER layout there are no ankle joints (the feet are fused onto
 * the calves, skeleton.ts FOOT_PADS) so there is no ankle-revolute loop to
 * stabilise the COM — that feedback path was removed because it was a
 * runaway loop in this discrete sim. Instead this controller works entirely
 * in WORLD space, outside the joint frame:
 *
 *   - measure the lean of the pelvis bind-up axis (errQ = q_now·conj(q_bind))
 *     → u = errQ ⊗ (0,1,0) ⊗ conj(errQ):  u.z ≈ forward lean, u.x ≈ lateral
 *   - measure the whole-body centre of mass vs the midpoint of the two fused
 *     foot pads (the support reference, rig.ts supportCenter)
 *   - apply an UPRIGHT TORQUE couple about the world X and Z axes to the Hips
 *     and Chest bodies (split by hipShare); with the feet planted the ground
 *     reaction does the work and the whole body rotates about the support.
 *
 * Torque law (velocity-form PD, capped):
 *
 *     tauX = −clamp( Kp·(u.z + eZ/hc) + Kd·ωx , ±Tmax )
 *     tauZ = +clamp( Kp·(u.x + eX/hc) − Kd·ωz , ±Tmax )
 *
 * with e = COM − support, hc = COM height above the support, ω the pelvis
 * angular velocity, and gains sized from the whole-body moment of inertia
 * about the support line, Kp = I·ωn², Kd = 2ζ√(Kp·I), ωn ≈ 15 rad/s (torso),
 * ζ = 1. Sign convention (verified by construction): a +X world torque
 * pitches the top toward +Z (forward), a +Z world torque tips it toward −X;
 * a +τz couple is therefore the restoring direction for a +X COM offset.
 *
 * Yield: under a heavy tackle the lean leaves the linear band (or most
 * joints go overpowered), the torque saturates at Tmax and then the gate
 * below switches the stabiliser off so the rig crumples organically instead
 * of fighting the hit (active-ragdoll overpowered collapse).
 */
import type { RagdollRig } from './rig';
import { supportCenter } from './rig';
import type { PoseQuat, Vec3 } from './types';
import { BIND } from './skeleton';

export const BALANCE_MAX = 160;   // N·m ceiling per horizontal axis (keeps knee/hip joints inside their T_max)
export const BALANCE_WN = 8;      // rad/s — whole-body upright mode (empirically tuned; higher ωn on this discrete rig drove a bang-bang limit cycle)
export const BALANCE_ZETA = 1.0;  // damping ratio of the upright mode
export const HIP_SHARE = 0.2;     // torque fraction on the hips
export const CHEST_SHARE = 0.0;   // torque fraction on the chest (upper torso)
export const CALF_SHARE = 0.4;    // torque fraction on EACH calf (fused foot) — tuned: hip 0.2 / calf 0.4 / ωn 8 / Tmax 160 stands 15 s+

const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
const qConj = (q: PoseQuat): PoseQuat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const qMul = (a: PoseQuat, b: PoseQuat): PoseQuat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
function rotateVec(q: PoseQuat, v: Vec3): Vec3 {
  const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = qMul(qMul(q, qv), qConj(q));
  return { x: r.x, y: r.y, z: r.z };
}

/** Whole-body centre of mass from the LIVE body masses (kg, world metres). */
export function centreOfMass(rig: RagdollRig): Vec3 {
  let m = 0, x = 0, y = 0, z = 0;
  for (const b of rig.bodies) {
    const w = b.body.mass();
    const t = b.body.translation();
    m += w; x += w * t.x; y += w * t.y; z += w * t.z;
  }
  if (m <= 0) return { x: 0, y: 0, z: 0 };
  return { x: x / m, y: y / m, z: z / m };
}

export interface BalanceGains {
  max: number;
  omegaN: number;
  zeta: number;
  /** fraction of the stabiliser torque on the hips (rest → chest). */
  hipShare: number;
  /** fraction on the chest body (posture upper torso). */
  chestShare: number;
  /** fraction on EACH calf body (fused feet — the grounded reaction). */
  calfShare: number;
}

export class BalanceController {
  /** per-axis torque ceilings (N·m). */
  max: number;
  /** natural frequency of the whole-body upright mode (rad/s). */
  omegaN: number;
  /** damping ratio. */
  zeta: number;
  /** fraction of the stabiliser torque applied to the hips body. */
  hipShare: number;
  /** fraction applied to the chest body. */
  chestShare: number;
  /** fraction applied to EACH calf body (fused feet — the ground reaction). */
  calfShare: number;

  enabled: boolean;

  /** last commanded torque (world X/Z components, N·m) — for HUD/debug. */
  lastTau: Vec3 = { x: 0, y: 0, z: 0 };
  /** last measured lean angles (forward, lateral) — for HUD/debug. */
  lean: { forward: number; lateral: number } = { forward: 0, lateral: 0 };
  /** last measured whole-body COM / support reference — for HUD/debug. */
  com: Vec3 = { x: 0, y: 0, z: 0 };
  support: Vec3 = { x: 0, y: 0, z: 0 };

  /** bind-time whole-body moment of inertia about the support line, per
   *  horizontal axis (kg·m²). */
  private ix = 0;
  private iz = 0;
  private ready = false;

  constructor(enabled = true, g?: Partial<BalanceGains>) {
    this.enabled = enabled;
    this.max = g?.max ?? BALANCE_MAX;
    this.omegaN = g?.omegaN ?? BALANCE_WN;
    this.zeta = g?.zeta ?? BALANCE_ZETA;
    this.hipShare = g?.hipShare ?? HIP_SHARE;
    this.chestShare = g?.chestShare ?? CHEST_SHARE;
    this.calfShare = g?.calfShare ?? CALF_SHARE;
  }

  /** measured gain coefficients for this rig (N·m/rad and N·m·s/rad). */
  gains(rig: RagdollRig): { kpX: number; kdX: number; kpZ: number; kdZ: number } {
    this.init(rig);
    const kpX = this.ix * this.omegaN * this.omegaN;
    const kpZ = this.iz * this.omegaN * this.omegaN;
    return {
      kpX, kdX: 2 * this.zeta * Math.sqrt(kpX * this.ix),
      kpZ, kdZ: 2 * this.zeta * Math.sqrt(kpZ * this.iz),
    };
  }

  /** whole-body moment of inertia about the support line (kg·m²). */
  inertia(rig: RagdollRig): { ix: number; iz: number } {
    this.init(rig);
    return { ix: this.ix, iz: this.iz };
  }

  private init(rig: RagdollRig) {
    if (this.ready) return;
    const sup = supportCenter(rig);
    let ix = 0, iz = 0;
    for (const b of rig.bodies) {
      const m = b.body.mass();
      const t = b.body.translation();
      const q = b.body.rotation();
      // own spin about the world X / Z axis (rotated principal moments)
      const p = b.body.principalInertia();
      const px = rotateVec({ x: q.x, y: q.y, z: q.z, w: q.w }, { x: 1, y: 0, z: 0 });
      const pz = rotateVec({ x: q.x, y: q.y, z: q.z, w: q.w }, { x: 0, y: 0, z: 1 });
      const sX = p.x * px.x * px.x + p.y * px.y * px.y + p.z * px.z * px.z;
      const sZ = p.x * pz.x * pz.x + p.y * pz.y * pz.y + p.z * pz.z * pz.z;
      const dy = t.y - sup.y;
      ix += m * (dy * dy + (t.z - sup.z) * (t.z - sup.z)) + sX;
      iz += m * ((t.x - sup.x) * (t.x - sup.x) + dy * dy) + sZ;
    }
    this.ix = Math.max(ix, 1e-3);
    this.iz = Math.max(iz, 1e-3);
    this.ready = true;
  }

  /**
   * Compute the total stabiliser torque about the world X and Z axes (N·m).
   * The motor applies `hipShare` of it to the hips body and the rest to the
   * chest body (both direct world torques). Returns {x, 0, z}.
   */
  update(rig: RagdollRig, _time: number): Vec3 {
    const zero: Vec3 = { x: 0, y: 0, z: 0 };
    this.lastTau = zero;
    if (!this.enabled) return zero;
    const hips = rig.byPart.get('hips');
    if (!hips || rig.pads.length < 2) return zero;

    // whole-body state
    const com = centreOfMass(rig);
    this.com = com;
    const sup = supportCenter(rig);
    this.support = sup;
    if (sup.y > 0.25) return zero; // airborne — no support to balance over
    const hc = Math.max(0.4, com.y - sup.y);
    if (hc < 0.5 || com.y < 0.55) return zero; // clearly down / kneeling

    // lean of the pelvis bind orientation (errQ = identity at bind)
    const qNow = hips.body.rotation();
    const errQ = qMul(
      { x: qNow.x, y: qNow.y, z: qNow.z, w: qNow.w },
      qConj(BIND.hips.q),
    );
    // bail out once the trunk has left the linear band (~60°+)
    if (Math.abs(errQ.w) < Math.cos(1.05 / 2)) return zero;
    const u = rotateVec(errQ, { x: 0, y: 1, z: 0 });
    const eX = com.x - sup.x;
    const eZ = com.z - sup.z;
    this.lean = { forward: u.z + eZ / hc, lateral: u.x + eX / hc };

    this.init(rig);
    const av = hips.body.angvel(); // pelvis angular velocity (world)
    const { kpX, kdX, kpZ, kdZ } = this.gains(rig);

    // Sign derivation (world axes): a +X torque pitches the top toward +Z,
    // a +Z torque tips the top toward −X. A forward lean (u.z>0, eZ>0) must
    // be corrected by a −X torque; a +X lean (u.x>0, eX>0) by a +Z torque.
    const tauX = clamp(-kpX * this.lean.forward - kdX * av.x, this.max);
    const tauZ = clamp(kpZ * this.lean.lateral - kdZ * av.z, this.max);
    this.lastTau = { x: tauX, y: 0, z: tauZ };
    return this.lastTau;
  }
}

export { BALANCE_WN as TORSO_WN };
