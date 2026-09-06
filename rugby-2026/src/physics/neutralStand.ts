/**
 * CANONICAL STAND — the deterministic, symmetric fall-start pose used by the
 * lab and every offline probe when a recorded fall begins.
 *
 * WHY NOT THE RAW IDLE: the asset's Idle clip is an ATHLETIC stance. Its feet
 * are frozen ~0.39 m apart front/back (rigidly rotating that stance to the
 * turf buries one foot and floats the other — the historic "feet under / legs
 * up" signature), and its torso is twisted ~18° (shoulder line not level when
 * the body is pitched flat — one shoulder ends up ~0.12 m higher, floating
 * that whole arm off the turf).
 *
 * The canonical pose is built from the rig itself and is symmetric about the
 * fall (pitch) axis:
 *   - FULL BIND skeleton: straight spine, straight legs side by side, level
 *     symmetric shoulders (bind shoulder line is exactly the rig X);
 *   - the Idle clip's ARM and HEAD local values re-applied over the bind
 *     torso (frame-true joint axes the fall channels rotate about — verified
 *     by tools/labSignProbe) with natural elbow bends and hang;
 *   - hands CENTERED on the fore/aft plane through the rig root's X axis
 *     (the true fall axis), so both hands lie at the same height once the
 *     body is prone.
 */
import * as THREE from 'three';

type Q = { w: number; x: number; y: number; z: number };

const NATURAL = [
  'upperarm_l', 'lowerarm_l', 'hand_l',
  'upperarm_r', 'lowerarm_r', 'hand_r',
  'neck_01', 'Head',
] as const;
const readQ = (b: THREE.Bone): Q => ({ w: b.quaternion.w, x: b.quaternion.x, y: b.quaternion.y, z: b.quaternion.z });
const writeQ = (b: THREE.Bone, q: Q) => b.quaternion.set(q.x, q.y, q.z, q.w);

/** Pose the skeleton to the canonical stand: full bind, then the Idle's
 *  arm/head VALUES re-applied, then the hands centered on the fall plane.
 *  Idle is optional — without it the arms stay at bind (a T-pose): callers
 *  all pass it. */
export function canonicalStand(
  bones: Map<string, THREE.Bone>,
  root: THREE.Object3D,
  skeleton: THREE.Skeleton | undefined,
  idle: THREE.AnimationClip | undefined,
): void {
  // phase 1 — sample the Idle's arm/head VALUES (not the Idle pose itself)
  const natural = new Map<string, Q>();
  if (idle) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(idle).play();
    mixer.update(0.06);
    root.updateMatrixWorld(true);
    for (const n of NATURAL) {
      const b = bones.get(n);
      if (b) natural.set(n, readQ(b));
    }
  }
  // phase 2 — full bind (straight symmetric spine + legs + level shoulders),
  // lay the natural arm/head values on top and center the hands.
  if (skeleton) skeleton.pose();
  root.updateMatrixWorld(true);
  for (const [n, q] of natural) {
    const b = bones.get(n);
    if (b) writeQ(b, q);
  }
  centerArmHang(bones, root);
  root.updateMatrixWorld(true);
}

/**
 * Swing each whole arm rigidly about the shoulder until the two hands hang
 * on the same fore/aft plane (the mid-plane of the two current hand
 * positions): both hands then rest at the same height once the body lies
 * flat. The rotation axis is the ROOT's model-X in the world — the true fall
 * axis the whole-body rotor pitches about. (The pelvis-derived body X is NOT
 * used: the Idle pelvis carries its own ~13° yaw and centering on that yawed
 * plane would leave the hands at different heights once prone.)
 *
 * Rigid whole-arm rotation = rotating ONLY the upper arm's world orientation
 * (children follow by the hierarchy). The local quaternion is set directly
 * from the desired world orientation (local = parentWorld⁻¹ · targetWorld) —
 * premultiplying the local quaternion did NOT behave as a world-frame
 * rotation on this rig's bones; explicit world targeting is exact.
 */
export function centerArmHang(bones: Map<string, THREE.Bone>, root: THREE.Object3D): void {
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
  axis.y = 0;
  if (axis.lengthSq() < 1e-6) return;
  axis.normalize();
  const fore = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0)).normalize();
  const hbL = bones.get('hand_l');
  const hbR = bones.get('hand_r');
  if (!hbL || !hbR) return;
  // Fixed target plane (midway between the hands as they currently hang);
  // never re-derive it per arm or each hand converges onto its own plane.
  const target = (hbL.getWorldPosition(new THREE.Vector3()).dot(fore)
    + hbR.getWorldPosition(new THREE.Vector3()).dot(fore)) * 0.5;
  const qD = new THREE.Quaternion();
  const qW = new THREE.Quaternion();   // desired new world orientation
  const qP = new THREE.Quaternion();   // upper-arm parent world orientation
  const pShoulder = new THREE.Vector3();
  const pHand = new THREE.Vector3();
  const sides = [
    { upper: 'upperarm_l', hand: 'hand_l' },
    { upper: 'upperarm_r', hand: 'hand_r' },
  ] as const;
  for (let round = 0; round < 3; round++) {
    let maxOff = 0;
    for (const { upper, hand } of sides) {
      const ub = bones.get(upper);
      const hb = bones.get(hand);
      if (!ub || !hb) continue;
      for (let iter = 0; iter < 5; iter++) {
        ub.getWorldPosition(pShoulder);
        hb.getWorldPosition(pHand);
        const off = pHand.dot(fore) - target;
        const reach = pHand.distanceTo(pShoulder);
        if (reach < 1e-3) break;
        // For a limb hanging below its joint a small rotation +dφ about the
        // fall axis moves the hand BACKWARD by ≈ reach·dφ (verified on the
        // rig), so the correction cancelling off is +off/reach.
        const delta = off / reach;
        if (Math.abs(delta) < 1e-4) break;
        ub.getWorldQuaternion(qW);
        qD.setFromAxisAngle(axis, delta);
        qW.premultiply(qD);
        const parent = ub.parent as THREE.Bone | null;
        if (parent && parent.isBone) parent.getWorldQuaternion(qP);
        else qP.identity();
        ub.quaternion.copy(qP.clone().invert().multiply(qW));
        ub.updateWorldMatrix(true, false);
      }
      hb.getWorldPosition(pHand);
      maxOff = Math.max(maxOff, Math.abs(pHand.dot(fore) - target));
    }
    if (maxOff < 2e-4) break;
  }
}
