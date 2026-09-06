/**
 * SYNC — copy Rapier body transforms onto the skinned mesh every frame.
 *
 * Each ragdoll body maps to the visual bone that shares its bind transform
 * (skeleton.ts VISUAL_BONE). Bodies spawn exactly at the GLB bind pose, so
 * the mesh is unperturbed on frame one; from then on, each mapped bone's
 * LOCAL transform is written as
 *
 *     local = inverse(parent.matrixWorld) · bodyWorldMatrix
 *
 * so the bone's world transform equals the physics body's transform. Visual
 * bones the ragdoll does not model (spine_02, clavicles, fingers, ball/toe…)
 * keep their bind local matrices and simply ride along their driven parents.
 * A parent-first traversal guarantees every parent matrix is current when a
 * child is computed.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { RagdollRig } from './rig';
import { VISUAL_BONE } from './skeleton';
import type { BodyPart } from './types';

export interface SyncTarget {
  /** the skinned mesh whose skeleton we drive. */
  mesh: THREE.SkinnedMesh;
  /** map of bone name → bone (collected from the loaded GLB). */
  bones: Map<string, THREE.Bone>;
  /** top of the model hierarchy to update after writing locals. */
  modelRoot: THREE.Object3D;
}

const _world = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _invParent = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _pos = new THREE.Vector3();

/** Apply the ragdoll pose to the mesh. Call once per render frame after the
 *  physics + motor step. */
export function syncMeshToRagdoll(rig: RagdollRig, target: SyncTarget, order?: BodyPart[]): void {
  const parts: BodyPart[] = order ?? defaultOrder();
  for (const part of parts) {
    const rb = rig.byPart.get(part);
    const bone = target.bones.get(VISUAL_BONE[part]);
    if (!rb || !bone) continue;
    const t = rb.body.translation();
    const r = rb.body.rotation();

    _world.makeRotationFromQuaternion(
      _quat.set(r.x, r.y, r.z, r.w),
    );
    _world.setPosition(t.x, t.y, t.z);

    const parent = bone.parent;
    if (parent instanceof THREE.Bone && parent.matrixWorld) {
      _invParent.copy(parent.matrixWorld).invert();
      _local.copy(_invParent).multiply(_world);
    } else {
      _local.copy(_world);
    }
    _pos.setFromMatrixPosition(_local);
    _quat.setFromRotationMatrix(_local);
    bone.position.copy(_pos);
    bone.quaternion.copy(_quat);
    bone.updateMatrix();
    // propagate so later children read a fresh parent.matrixWorld
    bone.updateMatrixWorld(true);
  }
  target.modelRoot.updateMatrixWorld(true);
  target.mesh.skeleton.update();
}

/** ragdoll bodies in visual-hierarchy order (parents before children). */
function defaultOrder(): BodyPart[] {
  return [
    'hips', 'spine', 'chest', 'neck', 'head',
    'upperarm_l', 'forearm_l', 'hand_l',
    'upperarm_r', 'forearm_r', 'hand_r',
    'thigh_l', 'calf_l', 'foot_l',
    'thigh_r', 'calf_r', 'foot_r',
  ];
}

/* ------------------------------------------------- debug colliders ------ */
const _v = new THREE.Vector3();

/** Draw a wireframe stand-in for every physics collider, parented to a
 *  THREE object per body so they track the ragdoll. Call updateColliderDebug
 *  each frame. */
export function createColliderDebug(rig: RagdollRig): { group: THREE.Group; update(): void } {
  const group = new THREE.Group();
  const wire = new THREE.MeshBasicMaterial({ color: 0x49e3ff, wireframe: true, transparent: true, opacity: 0.75 });
  const jointMat = new THREE.MeshBasicMaterial({ color: 0xffcf5a, wireframe: true, transparent: true, opacity: 0.7 });

  const holders = new Map<string, THREE.Object3D>();
  for (const b of rig.bodies) {
    const holder = new THREE.Object3D();
    group.add(holder);
    holders.set(b.part, holder);

    const c = b.collider;
    const lt = c.translation() as { x: number; y: number; z: number };
    const lr = c.rotation() as { x: number; y: number; z: number; w: number };
    const shape = c.shape;
    let mesh: THREE.Mesh;
    if (shape instanceof RAPIER.Capsule) {
      const r = shape.radius;
      const hh = shape.halfHeight;
      mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, hh * 2, 6, 10), wire);
    } else if (shape instanceof RAPIER.Cuboid) {
      const he = shape.halfExtents;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(he.x * 2, he.y * 2, he.z * 2), wire);
    } else if (shape instanceof RAPIER.Ball) {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(shape.radius, 12, 8), wire);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), wire);
    }
    mesh.position.set(lt.x, lt.y, lt.z);
    mesh.quaternion.set(lr.x, lr.y, lr.z, lr.w);
    holder.add(mesh);
  }
  // joint anchors
  for (const j of rig.joints) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), jointMat);
    m.position.copy(_v.set(j.spec.anchorWorld.x, j.spec.anchorWorld.y, j.spec.anchorWorld.z));
    m.name = 'joint-' + j.name;
    m.userData.anchor = { x: j.spec.anchorWorld.x, y: j.spec.anchorWorld.y, z: j.spec.anchorWorld.z };
    group.add(m);
  }

  return {
    group,
    update() {
      for (const b of rig.bodies) {
        const h = holders.get(b.part);
        if (!h) continue;
        const t = b.body.translation();
        const q = b.body.rotation();
        h.position.set(t.x, t.y, t.z);
        h.quaternion.set(q.x, q.y, q.z, q.w);
        h.updateMatrix();
      }
      // joint anchors float at their bind offset relative to... we draw them
      // at the child body's origin so they always sit at the pivot.
      for (const j of rig.joints) {
        const ch = rig.byPart.get(j.childPart);
        const m = group.getObjectByName('joint-' + j.name);
        if (!ch || !m) continue;
        const t = ch.body.translation();
        m.position.set(t.x, t.y, t.z);
      }
      group.updateMatrixWorld(true);
    },
  };
}
