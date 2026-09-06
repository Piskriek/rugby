/**
 * TACKLE PHYSICS LAB — visual verification harness for the recorded-fall
 * bank (rugby-2026/src/physics). Pure dev tooling; not part of the engine.
 *
 * HOW A FALL IS PLAYED
 * 1. the body stands on the Idle clip (the GLB REST pose is a T-pose and is
 *    never shown);
 * 2. at the fall start the current pose is CAPTURED — each driven bone's
 *    local quaternion plus the body's X/Z axes expressed in each joint's
 *    parent frame (physics/poseMap jointRef);
 * 3. every frame one baked 17-channel sample is expanded/mirrored and each
 *    channel becomes a rotation about the true model axis in the parent
 *    frame, so a "flex" always swings the arm forward on any rig;
 * 4. the whole clone rotates about its feet origin (heading ⊗ qX(pitch) ⊗
 *    qZ(twist) — never rotation.x-after-yaw), and a ground-clearance pass
 *    keeps clipped limbs off the turf.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { findFall, samplePose } from '../physics/fallBank';
import type { FallDesc } from '../physics/falls';
import { FALL_T } from '../physics/falls';
import { buildPose, jointRef } from '../physics/poseMap';
import type { FallRefs } from '../physics/poseMap';
import { canonicalStand } from '../physics/neutralStand';
import { solveArmIK, resolveWrapDuel, resolveContest, ballOut, hashU } from '../physics/contact';
import type { Tech } from '../physics/contact';

const MODEL_URL = 'assets/models/rugby_player.glb';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const HEADING = Math.PI / 2;          // model faces +Z; lab bodies face +X

type DirSel = 'F' | 'B' | 'S' | 'S2'; // S2 = lateral toward his LEFT
const dirOf = (d: DirSel): FallDesc['dir'] => (d === 'S2' ? 'S' : d);
const mirrorOf = (d: DirSel) => d === 'S2';

const DRIVEN_BONES = [
  'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r',
  'thigh_l', 'calf_l', 'thigh_r', 'calf_r',
] as const;
const CLEARANCE_BONES = ['Head', 'pelvis', 'hand_l', 'hand_r', 'foot_l', 'foot_r', 'calf_l', 'calf_r'] as const;

const COLORS = {
  F: 0x2f7dd1,    // forward fall — blue
  B: 0xd1582f,    // backward — orange
  SR: 0x2fa05f,   // side right — green
  SL: 0xc22fa0,   // side left — magenta
  ROLL: 0xd1a62f, // tackler roll-off — gold
  PILE: 0x8a93a6, // ruck pile bodies — grey
} as const;

/* ============================================================ FallBody === */
class FallBody {
  group = new THREE.Group();
  cfg: { desc: FallDesc; mirror: boolean } | null = null;
  play = {
    run: false,
    entry: null as ReturnType<typeof findFall> | null,
    mirror: false,
    t: 0,
    holdProne: 0,
    loop: false,
    hiddenT: 0,
  };
  bones = new Map<string, THREE.Bone>();
  refs: FallRefs = {};
  skeleton?: THREE.Skeleton;
  private clearBones: THREE.Bone[] = [];
  rig?: THREE.Object3D;
  private idleClip?: THREE.AnimationClip;
  private qA = new THREE.Quaternion();
  private qB = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  home = new THREE.Vector3();
  /** world heading he faces (rad about Y); the fall rotor is built on top */
  heading = HEADING;
  /** locomotion clip playback (in-place run/walk cycles, root translated by
   *  the theatre). Mutually exclusive with a running fall. */
  clip: { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; name: string; rate: number } | null = null;
  private clipNames = new Map<string, THREE.AnimationClip>();
  /** Playback rate for a recorded fall (rate > 1 = fast peel / pop-up). */
  rate = 1;

  constructor(
    private scene: THREE.Scene,
    private gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] },
  ) {
    for (const a of gltf.animations) this.clipNames.set(a.name, a);
  }

  attach() {
    const clone = SkeletonUtils.clone(this.gltf.scene);
    clone.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) this.bones.set(b.name, b);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.skeleton.pose();
        this.skeleton = m.skeleton;
      }
    });
    if (this.skeleton) {
      this.skeleton.pose();
      clone.updateMatrixWorld(true);
      this.clearBones = CLEARANCE_BONES
        .map((n) => this.bones.get(n))
        .filter((b): b is THREE.Bone => !!b);
    }
    const idle = this.gltf.animations.find((a) => a.name === 'Idle');
    this.rig = clone;
    this.idleClip = idle;
    this.group.add(clone);
    this.scene.add(this.group);
  }

  tint(color: number) {
    this.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const mm = mat as THREE.MeshStandardMaterial;
        if (mm && 'color' in mm) mm.color.setHex(color);
      }
    });
  }

  show(v: boolean) { this.group.visible = v; }

  /** Upright at home position on the Idle clip. */
  stand(x: number, z: number, heading = HEADING) {
    if (this.clip) { this.clip.mixer.stopAllAction(); this.clip = null; }
    this.play.run = false;
    this.heading = heading;
    this.home.set(x, 0, z);
    this.group.position.copy(this.home);
    this.group.quaternion.setFromAxisAngle(Y_AXIS, heading);
    this.refs = {};
    if (this.rig) canonicalStand(this.bones, this.rig, this.skeleton, this.idleClip);
    this.group.updateMatrixWorld(true);
    if (this.skeleton) this.skeleton.update();
    this.show(true);
  }

  /** Play an in-place clip (Run/Sprint/Walk/Crouch/Push/…). Any clip already
   *  playing is stopped first; `rate` scales playback speed. */
  playClip(name: string, rate = 1) {
    const clip = this.clipNames.get(name);
    if (!clip || !this.rig) return false;
    if (this.clip) { this.clip.mixer.stopAllAction(); this.clip = null; }
    this.play.run = false;
    if (this.rig) canonicalStand(this.bones, this.rig, this.skeleton, this.idleClip);
    this.group.updateMatrixWorld(true);
    if (this.skeleton) this.skeleton.update();
    const mixer = new THREE.AnimationMixer(this.rig);
    const action = mixer.clipAction(clip);
    action.reset();
    action.setEffectiveTimeScale(rate);
    action.play();
    mixer.update(0);
    this.clip = { mixer, action, name, rate };
    return true;
  }

  /** Freeze the running clip in place — the pose at this frame is kept and
   *  `update()` stops advancing the mixer (used at the instant of impact so
   *  a recorded fall can take over from a mid-stride pose). */
  freezeClip() {
    if (!this.clip) return;
    this.clip.action.paused = true;
    this.clip.mixer.update(0);
    this.group.updateMatrixWorld(true);
    if (this.skeleton) this.skeleton.update();
  }

  /** Refresh world matrices after any direct bone writes. */
  sync() {
    this.group.updateMatrixWorld(true);
    if (this.skeleton) this.skeleton.update();
  }

  worldPos(name: string, out: THREE.Vector3) {
    const b = this.bones.get(name);
    if (b) b.getWorldPosition(out);
  }

  /** Magnet hands: aim both wrists at a world target using the pure 2-bone IK
   *  from physics/contact. `m` (0..1) is magnet strength: the increment each
   *  frame is scaled by s so the hands EASE onto the ball instead of
   *  teleporting, and every frame re-solves from the current pose so the
   *  easing converges smoothly. Returns the distance of the worse wrist to
   *  its solved target (0 when both are on it). */
  ikArmsTo(target: THREE.Vector3, m: number) {
    if (m <= 0.02) return Infinity;
    const s = Math.min(1, m);                       // easing strength
    let worst = 0;
    for (const side of ['r', 'l'] as const) {
      const up = this.bones.get(`upperarm_${side}`);
      const lo = this.bones.get(`lowerarm_${side}`);
      const hand = this.bones.get(`hand_${side}`);
      if (!up || !lo || !hand) continue;
      this.sync();
      const S = up.getWorldPosition(new THREE.Vector3());
      const E = lo.getWorldPosition(new THREE.Vector3());
      const W = hand.getWorldPosition(new THREE.Vector3());
      const ik = solveArmIK(
        { x: S.x, y: S.y, z: S.z }, { x: E.x, y: E.y, z: E.z },
        { x: W.x, y: W.y, z: W.z },
        { x: target.x, y: target.y, z: target.z },
        side === 'r' ? 1 : -1,
      );
      const qIncU = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(ik.shoulderAxis.x, ik.shoulderAxis.y, ik.shoulderAxis.z),
        ik.shoulderAngle * s);
      const qIncF = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(ik.elbowAxis.x, ik.elbowAxis.y, ik.elbowAxis.z),
        ik.elbowAngle * s);
      // solveArmIK measures axis-angles in the WORLD frame: compose the
      // world rotations, then store back as local to each bone's parent.
      const qUpWorld = up.getWorldQuaternion(new THREE.Quaternion());
      const qFWorld = lo.getWorldQuaternion(new THREE.Quaternion());
      const parent = up.parent as THREE.Bone;
      const qParent = (parent && parent.isBone)
        ? parent.getWorldQuaternion(new THREE.Quaternion())
        : new THREE.Quaternion();
      const qNewUp = new THREE.Quaternion().multiplyQuaternions(qIncU, qUpWorld);
      const qNewF = new THREE.Quaternion().multiplyQuaternions(
        qIncF, new THREE.Quaternion().multiplyQuaternions(qIncU, qFWorld));
      up.quaternion.copy(qParent.clone().invert().multiply(qNewUp));
      lo.quaternion.copy(qNewUp.clone().invert().multiply(qNewF));
      this.sync();
      const got = hand.getWorldPosition(new THREE.Vector3());
      const want = new THREE.Vector3(ik.wrist.x, ik.wrist.y, ik.wrist.z);
      worst = Math.max(worst, got.distanceTo(want));
    }
    return worst;
  }

  /** Capture fall-start references out of the current pose. */
  captureRefs() {
    this.group.updateMatrixWorld(true);
    // model axes of the fall frame = the body group's own X/Z (the canonical
    // stand is posed in the model frame; the whole-body rotor pitches about
    // the group's X, so the channels must rotate about the same axes — NOT
    // the pelvis-derived ones, which carry the rig's authored pelvis pitch)
    this.group.getWorldQuaternion(this.qB);
    this.tmpV.set(1, 0, 0).applyQuaternion(this.qB);
    const bodyX: [number, number, number] = [this.tmpV.x, this.tmpV.y, this.tmpV.z];
    this.tmpV.set(0, 0, 1).applyQuaternion(this.qB);
    const bodyZ: [number, number, number] = [this.tmpV.x, this.tmpV.y, this.tmpV.z];
    const pQ = new THREE.Quaternion();
    for (const name of DRIVEN_BONES) {
      const b = this.bones.get(name);
      if (!b) continue;
      const parent = b.parent;
      if (parent && (parent as THREE.Bone).isBone) parent.getWorldQuaternion(pQ);
      else pQ.identity();
      this.refs[name] = jointRef(
        { w: b.quaternion.w, x: b.quaternion.x, y: b.quaternion.y, z: b.quaternion.z },
        { w: pQ.w, x: pQ.x, y: pQ.y, z: pQ.z },
        bodyX, bodyZ,
      );
    }
  }

  /** One recording sample: whole-body rotor + joint deltas. */
  private driveSample(ch: Float32Array) {
    const pose = buildPose(Array.from(ch) as number[], this.refs);
    // whole-body rotor about the feet origin: heading ⊗ qX(pitch) ⊗ qZ(twist)
    this.qA.setFromAxisAngle(X_AXIS, pose.pitch);
    this.qB.setFromAxisAngle(Z_AXIS, pose.twist);
    this.qA.multiply(this.qB);
    this.group.quaternion.setFromAxisAngle(Y_AXIS, this.heading);
    this.group.quaternion.multiply(this.qA);
    for (const name of DRIVEN_BONES) {
      const q = pose.bones[name];
      const bone = this.bones.get(name);
      if (q && bone) bone.quaternion.set(q.x, q.y, q.z, q.w);
    }
    this.group.updateMatrixWorld(true);
    if (this.skeleton) this.skeleton.update();
  }

  /** Rest the body on the turf: any frame whose lowest key bone sits under
   *  the plane is lifted so that bone touches it — but the lift is computed
   *  from a clean ground reference every frame, so a pose that is fine on the
   *  turf is NOT carried upward by an earlier deep frame. (An accumulating
   *  lift would permanently float every body that ever clipped.) */
  private clearance() {
    this.group.position.y = this.home.y;      // back to the ground reference
    this.group.updateMatrixWorld(true);
    let minY = 0.008;
    for (const b of this.clearBones) {
      b.getWorldPosition(this.tmpV);
      if (this.tmpV.y < minY) minY = this.tmpV.y;
    }
    if (minY < 0.008) {
      this.group.position.y = this.home.y + (0.008 - minY);
      this.group.updateMatrixWorld(true);
    }
  }

  update(dt: number) {
    if (this.clip) this.clip.mixer.update(dt);
    const p = this.play;
    if (p.hiddenT > 0) {
      p.hiddenT -= dt;
      if (p.hiddenT <= 0) {
        this.stand(this.home.x, this.home.z, this.heading);
        if (p.loop && this.cfg) launchBody(this, this.cfg.desc, this.cfg.mirror, p.holdProne, true);
      }
      return;
    }
    if (!p.run) {
      // standing / clip-playing — the theatre moves clip actors itself
      return;
    }
    p.t += dt * this.rate;
    if (p.entry && p.t < FALL_T) {
      this.driveSample(samplePose(p.entry, Math.max(0, p.t), p.mirror));
      this.clearance();
      return;
    }
    if (p.holdProne > 0) {
      p.holdProne -= dt;
      if (p.holdProne > 0) { this.clearance(); return; }
    }
    if (p.loop) {
      p.run = false;
      p.hiddenT = 0.5;
      this.show(false);
    } else {
      p.run = false;
    }
  }
}

/** Launch a recorded fall, capturing the pose refs from right now. */
function launchBody(b: FallBody, desc: FallDesc, mirror: boolean, holdProne: number, loop: boolean, delay = 0) {
  b.captureRefs();
  b.play.entry = findFall(desc);
  b.play.mirror = mirror;
  b.play.t = -delay;
  b.play.holdProne = holdProne;
  b.play.loop = loop;
  b.play.run = true;
}
/* ======================================================= breakdown === */
/** The breakdown theatre — one full tackle → ball-out sequence, looped.
 *  Staging geometry (world): the lane runs along x at z=LZ. Red attacks −x
 *  (their own goal is +x). Rig facts used for staging (measured):
 *   - arm reach shoulder→hand ≈ 0.55 m;
 *   - Crouch stance pelvis 0.48 / shoulder 0.90 → hands reach to ≈ 0.35;
 *   - a dir-F fall sprawls head ≈ 1.59 m forward of the feet, chest ≈ 1.31,
 *     pelvis ≈ 0.94. With the carrier's feet planted at x = 7.65 the ball
 *     presents at ≈ (6.5, 0.4, LZ) — above his hips — where the jackal
 *     (from −x, over his head) and the cleaner (from +x, over his legs)
 *     can both put hands on it.
 *  Nothing about the fight is choreographed: resolveWrapDuel / resolveContest
 *  / ballOut from physics/contact decide the story each cycle from a seed;
 *  the visuals (recorded falls, Crouch-stance arrivals, magnet-arm IK)
 *  merely stage what the ledger says.
 */
const LZ = 3.4;
const BALL_P = { x: 6.5, y: 0.4, z: LZ + 0.15 };  // grapple/presentation point
const BALL_Y0 = 0.15;                              // resting on turf
const TEAMS = {
  red: { car: 0xd4554f, clean: 0xb93b33, nine: 0xe0715f },
  blue: { tack: 0x4f7dc9, jackal: 0x33589e },
};
const TECH: Record<string, Tech> = {
  car: { pwr: 74, skl: 70, spd: 82, ttl: 72 },
  tack: { pwr: 78, skl: 74, spd: 80, ttl: 75 },
  jackal: { pwr: 70, skl: 86, spd: 78, ttl: 80 },
  clean: { pwr: 86, skl: 60, spd: 70, ttl: 76 },
};

const easeN = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (t0: number, t1: number, t: number) => {
  const k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return k * k * (3 - 2 * k);                       // smoothstep
};

const bd = {
  on: false,
  seed: 1,
  t: 0,
  did: new Set<string>(),
  phase: 'idle' as string,
  wrapOut: 'KEEP' as string,
  wrapReason: '' as string,
  contestOut: 'CLEAN' as string,
  contestReason: '' as string,
  ballOutLbl: '' as string,
  held: 0.9,
  uWrap: 0.5,
  uContest: 0.5,
  jackalLead: 0.75,
  presentation: 0.65,
  actors: {} as Record<string, FallBody>,
  ball: null as THREE.Group | null,
  // ball dynamic state
  free: false,
  mode: 'carry' as 'carry' | 'drop' | 'settle' | 'grapple' | 'out' | 'gone',
  bx: 0, by: 0, bz: 0, bvy: 0,
  outT: 0, outX: 0, outY: 0, outTarget: null as FallBody | null,
};

const $bdSeed = () => $('bdSeed');
const $stage = () => $('stagelab');
const $status = () => $('bdstatus');

/** Park a body in the frozen Crouch stance (players hover low at their post). */
function bdCrouch(b: FallBody, x: number, z: number, heading: number) {
  b.stand(x, z, heading);
  b.playClip('Crouch', 1);
  b.freezeClip();
  b.sync();
}

function bdMakeBall(scene: THREE.Scene) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9a94a, roughness: 0.55 });
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), mat);
  m.scale.set(1.8, 0.62, 0.62);
  m.castShadow = true;
  g.add(m);
  g.position.y = BALL_Y0;
  scene.add(g);
  bd.ball = g;
}

function bdStageMarks(scene: THREE.Scene) {
  const ring = (x: number, z: number, r: number, c: number, o: number) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.04, r + 0.04, 48),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, z);
    scene.add(mesh);
  };
  ring(6.5, LZ + 0.15, 0.6, 0xffd27a, 0.5);          // the ruck point
  ring(6.5, LZ + 0.15, 1.15, 0xffd27a, 0.13);
  const dash = (x: number, c: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 1.5),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x, 0.013, LZ);
    scene.add(mesh);
  };
  dash(8.4, 0xd4554f);                               // red arrival gate (+x)
  dash(5.7, 0x4f7dc9);                               // blue arrival gate (−x)
}

let bdScene: THREE.Scene | null = null;
function sceneAddBall(b: THREE.Object3D) {
  if (bdScene) bdScene.add(b);
}

function bdResetCycle() {
  if (!bd.ball) return;
  const A = bd.actors;
  const R1 = A.R1, B1 = A.B1, R2 = A.R2, B2 = A.B2, G1 = A.G1;
  // carrier carries the ball in at chest height ahead of his feet
  const ball = bd.ball!;
  R1.group.attach(ball);
  ball.position.set(0, 0.95, 0.3);
  ball.rotation.set(0, 0, 0);
  ball.visible = true;
  bd.free = false;
  bd.mode = 'carry';
  bd.t = 0;
  bd.did.clear();
  bd.wrapOut = 'KEEP';
  bd.contestOut = 'CLEAN';
  bd.ballOutLbl = '';
  bd.held = 0.9;
  R1.rate = 1;
  B1.rate = 1;
  R1.play.run = false;
  B1.play.run = false;
  R1.stand(9.6, LZ, -Math.PI / 2);      // red, attacks −x
  B1.stand(5.3, LZ, Math.PI / 2);       // blue tackler
  bdCrouch(B2, 5.0, LZ, Math.PI / 2);   // blue jackal hovering at his gate
  bdCrouch(R2, 9.0, LZ, -Math.PI / 2);  // red cleaner bound low, waiting
  G1.stand(8.9, LZ + 0.7, -Math.PI / 2); // the nine, off the tunnel
  R1.tint(TEAMS.red.car);
  B1.tint(TEAMS.blue.tack);
  R2.tint(TEAMS.red.clean);
  B2.tint(TEAMS.blue.jackal);
  G1.tint(TEAMS.red.nine);
  R1.playClip('Run', 1);
  B1.playClip('Run', 0.85);
  $bdSeed().textContent = String(bd.seed);
  bdStage('APPROACH', 'seed ' + bd.seed + ' — red attacks −x · pure contact.ts decides the fight');
}

function bdInit(scene: THREE.Scene, gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }) {
  bdScene = scene;
  bdMakeBall(scene);
  bdStageMarks(scene);
  for (const k of ['R1', 'B1', 'R2', 'B2', 'G1'] as const) {
    const b = new FallBody(scene, gltf);
    b.attach();
    bd.actors[k] = b;
  }
  bdResetCycle();
}

function bdStage(label: string, sub = '') {
  bd.phase = label;
  const s = $stage();
  if (s) {
    s.style.color = '#fff';
    s.style.opacity = bd.on ? '1' : '0';
    s.innerHTML = label + (sub ? '<br><small>' + sub + '</small>' : '');
  }
}

function bdShowStatus() {
  const s = $status();
  s.style.display = 'block';
  const out = bd.ballOutLbl;
  const q = out === 'QUICK' ? ' — the nine whips it' : out === 'NORMAL' ? ' — recycled' : '';
  s.innerHTML =
    '<b>tackle → breakdown ledger</b> (seed ' + bd.seed + ')<br>' +
    'WRAP: <b style="color:#8fe3b0">' + bd.wrapOut + '</b> · ' + bd.wrapReason +
    '<br>u=' + bd.uWrap.toFixed(3) +
    '<div class="duel">jackal skl ' + TECH.jackal.skl + ' (arrives +' + bd.jackalLead.toFixed(2) + 's)' +
    ' · cleaner pwr ' + TECH.clean.pwr +
    '<br>presentation ' + Math.round(bd.presentation * 100) + ' % · held ' + bd.held.toFixed(1) + 's' +
    '<br>CONTEST: <b style="color:#8fe3b0">' + bd.contestOut + '</b> · ' + bd.contestReason +
    '<br>u=' + bd.uContest.toFixed(3) +
    '<br>BALL OUT: <b style="color:#ffd27a">' + bd.ballOutLbl + '</b>' + q + '</div>';
}

/** Move a frozen-crouch body along x at speed until it reaches `until`. */
function bdShuffle(b: FallBody, speed: number, until: number, dt: number): boolean {
  const x = b.group.position.x;
  const nx = speed >= 0 ? Math.min(until, x + speed * dt) : Math.max(until, x + speed * dt);
  b.group.position.x = nx;
  b.group.updateMatrixWorld(true);
  return speed >= 0 ? nx >= until : nx <= until;
}

/** Quadratic bezier arc for the ball leaving the ruck. */
function bdArcBall(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, t: number) {
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const apex = Math.max(y1, y2) + 1.15;
  const k = 1 - t;
  bd.bx = k * k * x1 + 2 * k * t * mx + t * t * x2;
  bd.by = k * k * y1 + 2 * k * t * apex + t * t * y2;
  bd.bz = k * k * z1 + 2 * k * t * mz + t * t * z2;
  const ball = bd.ball!;
  ball.position.set(bd.bx, bd.by, bd.bz);
  ball.rotation.y += 0.4;
}

/** Run the wrap duel + (if the carrier keeps it) the breakdown contest. */
function bdResolveDuels() {
  bd.uWrap = hashU((bd.seed * 2654435761 + 1) >>> 0);
  const wrap = resolveWrapDuel({
    carrier: TECH.car, tackler: TECH.tack,
    support: 1, cover: 0, momentum: 0.55, smother: false,
  }, bd.uWrap);
  bd.wrapOut = wrap.outcome;
  bd.wrapReason = wrap.reason;
  if (bd.wrapOut !== 'KEEP') return;
  bd.uContest = hashU((bd.seed * 40503 + 2) >>> 0);
  const contest = resolveContest({
    jackal: TECH.jackal, cleaner: TECH.clean,
    jackalSupport: 0, cleanerSupport: 0,
    jackalLead: 0.75, presentation: 0.65, momentum: 0.35,
  }, bd.uContest);
  bd.contestOut = contest.outcome;
  bd.jackalLead = 0.75;
  bd.presentation = 0.65;
  bd.contestReason = contest.reason;
  bd.held = 0.7 + bd.uContest * 0.9;
  bd.ballOutLbl = ballOut(contest.outcome as any, bd.held).out;
}

function bdTick(dt: number) {
  if (!bd.on || !bd.ball) return;
  bd.t += dt;
  const t = bd.t;
  const A = bd.actors;
  const R1 = A.R1, B1 = A.B1, R2 = A.R2, B2 = A.B2, G1 = A.G1;
  const ball = bd.ball;

  /* ---- approach: the two men close, clips carry the locomotion --------- */
  if (!bd.did.has('impact')) {
    R1.group.position.x = Math.max(7.65, R1.group.position.x - 1.95 * dt);
    B1.group.position.x = Math.min(6.95, B1.group.position.x + 1.95 * dt);
    if (R1.group.position.x <= 7.65 && B1.group.position.x >= 6.95) {
      bd.did.add('impact');
      R1.freezeClip();
      B1.freezeClip();
      // the fall now owns the body — drop the paused mixer so it can never
      // re-apply the frozen run pose over the prone carrier later.
      R1.clip = null;
      B1.clip = null;
      bdResolveDuels();
      // carrier: recorded forward fall (settles ~1.6 s in) then holds prone.
      R1.rate = 1.35;
      launchBody(R1, { kind: 'FALL', speed: 4.4, hitH: 0.7, massR: 1, dir: 'F' }, false, 0.55, false);
      // tackler: recorded peel-roll off the tunnel, drifting wide; he ends
      // in a low defensive crouch at the edge of the ruck.
      B1.rate = 1.7;
      launchBody(B1, { kind: 'ROLL', speed: 4.5, hitH: 0.55, massR: 1, dir: 'F' }, false, 1e9, false);
      const wrap = bd.wrapOut;
      const color = wrap === 'KEEP' ? '#8fe3b0' : '#ffd27a';
      const s = $stage();
      s.style.color = color;
      bdStage('TACKLE — WRAP: ' + wrap, bd.wrapReason);
      s.style.color = '#fff';
    }
  }

  /* ---- tackler drifts wide while his recorded peel plays ---------------- */
  if (bd.did.has('impact') && B1.play.run) {
    B1.group.position.z = Math.min(LZ + 0.55, B1.group.position.z + 0.5 * dt);
  }

  /* ---- the ball: carried → spilled → settled at the ruck point ---------- */
  if (bd.free) {
    if (bd.mode === 'drop') {
      bd.bvy -= 11 * dt;
      bd.by += bd.bvy * dt;
      if (bd.by <= BALL_Y0) { bd.by = BALL_Y0; bd.bvy = 0; bd.mode = 'settle'; }
    } else if (bd.mode === 'settle') {
      const k = Math.min(1, Math.max(0, (t - 2.5) / 0.6));
      bd.bx = easeN(bd.bx, BALL_P.x, k);
      bd.bz = easeN(bd.bz, BALL_P.z, k);
      if (k >= 1) bd.mode = 'grapple';
    } else if (bd.mode === 'grapple') {
      // rides up into the reaching hands as jackal + cleaner arrive
      const g = Math.min(1, Math.max(0, (t - 3.25) / 1.1));
      bd.by = easeN(bd.by, BALL_P.y, g) + Math.sin(t * 8) * 0.013 * g;
    } else if (bd.mode === 'out') {
      const k = Math.min(1, (t - bd.outT) / 0.7);
      bdArcBall(BALL_P.x, bd.by, BALL_P.z, bd.outX, bd.outY, LZ + 0.2, k);
      if (k >= 1) { bd.mode = 'gone'; bd.did.add('outdone'); }
    }
    ball.position.set(bd.bx, bd.by, bd.bz);
  } else if (!bd.did.has('released') && bd.did.has('impact') && t >= 1.9) {
    const w = new THREE.Vector3();
    ball.getWorldPosition(w);
    R1.group.remove(ball);
    sceneAddBall(ball);
    bd.free = true;
    bd.mode = 'drop';
    bd.bvy = -0.3;
    bd.bx = Math.min(6.7, Math.max(6.35, w.x));
    bd.bz = w.z;
    bd.by = w.y;
    bd.did.add('released');
    bdStage('BALL SPILLS — carrier hits the turf', 'release at the tackle point');
  }

  /* ---- the fight: jackal first, cleaner second, magnets to the ball ----- */
  const jackalOn = bd.did.has('impact') && bd.wrapOut === 'KEEP';
  if (jackalOn) {
    if (!bd.did.has('jackalGo') && t >= 2.15) {
      bd.did.add('jackalGo');
      bdStage('JACKAL IN — blue hands seek the ball');
    }
    if (bd.did.has('jackalGo') && !bd.did.has('jackalHere')) {
      if (bdShuffle(B2, 1.6, 6.5, dt)) bd.did.add('jackalHere');
    }
    const jm = ramp(2.75, 3.35, t);
    if (jm > 0 && bd.free) B2.ikArmsTo(ball.position, jm * 0.97);
    if (bd.did.has('jackalHere') && !bd.did.has('cleanGo') && t >= 3.15) {
      bd.did.add('cleanGo');
      bdStage('CLEAN-OUT — red drives in over the body');
    }
    if (bd.did.has('cleanGo') && !bd.did.has('cleanHere')) {
      if (bdShuffle(R2, -1.7, 6.85, dt)) bd.did.add('cleanHere');
    }
    const cm = ramp(3.7, 4.4, t);
    if (cm > 0 && bd.free) R2.ikArmsTo(ball.position, cm * 0.92);
    // carrier presents from the turf once his recorded fall is done
    const pm = ramp(3.3, 4.15, t);
    if (pm > 0 && !R1.play.run && bd.free) R1.ikArmsTo(ball.position, pm * 0.8);
  }

  /* ---- the contest resolves and the ball leaves -------------------------- */
  if (jackalOn && !bd.did.has('resolved') && t >= 4.6) {
    bd.did.add('resolved');
    bdShowStatus();
    const col = bd.contestOut === 'CLEAN' ? '#8fe3b0'
      : bd.contestOut === 'STEAL' ? '#ffd27a' : '#ff9d7d';
    const s = $stage();
    s.style.color = col;
    bdStage('CONTEST: ' + bd.contestOut + ' — ' + bd.ballOutLbl, bd.contestReason);
    s.style.color = '#fff';
    if (bd.ballOutLbl === 'QUICK' || bd.ballOutLbl === 'NORMAL') {
      bd.outX = 8.9; bd.outY = 1.25; bd.outTarget = G1;
    } else if (bd.ballOutLbl === 'TURNOVER' || bd.ballOutLbl === 'PEN_DEF' || bd.ballOutLbl === 'PEN_ATK') {
      bd.outX = 4.2; bd.outY = 0.95; bd.outTarget = B2;
    }
  }
  if (jackalOn && bd.did.has('resolved') && bd.mode === 'grapple'
    && (bd.ballOutLbl === 'QUICK' || bd.ballOutLbl === 'NORMAL' || bd.ballOutLbl === 'TURNOVER'
      || bd.ballOutLbl === 'PEN_DEF' || bd.ballOutLbl === 'PEN_ATK')
    && !bd.did.has('launch') && t >= 4.8 + bd.held) {
    bd.did.add('launch');
    bd.mode = 'out';
    bd.outT = t;
    if (bd.ballOutLbl === 'QUICK') {
      bdStage('BALL OUT — QUICK (' + bd.held.toFixed(1) + 's)', 'nine whips it from the base');
    } else if (bd.ballOutLbl === 'NORMAL') {
      bdStage('BALL OUT — NORMAL (' + bd.held.toFixed(1) + 's)', 'recycled');
    } else {
      bdStage('TURNOVER — ' + bd.contestOut, 'possession changes');
    }
  }
  // catch: the target's magnet hands take the ball as it arrives
  if (bd.mode === 'gone' && bd.outTarget) {
    bd.outTarget.ikArmsTo(ball.position, ramp(0, 0.4, t - bd.outT - 0.7));
  }
  if (!jackalOn && !bd.did.has('looseShown') && bd.did.has('impact') && t >= 2.2) {
    bd.did.add('looseShown');
    bd.did.add('resolved');
    bd.ballOutLbl = bd.wrapOut === 'HOLDUP' ? 'SLOW' : 'TURNOVER';
    bd.outX = 4.2; bd.outY = 0.9; bd.outTarget = B2;
    bdShowStatus();
    bdStage('BALL LOOSE IN THE TACKLE — ' + bd.wrapOut, 'no ruck forms · blue regathers');
  }
  if (!jackalOn && bd.did.has('resolved') && !bd.did.has('launch') && bd.mode === 'grapple' && t >= 3.6) {
    bd.did.add('launch');
    bd.mode = 'out';
    bd.outT = t;
  }

  /* ---- cycle end --------------------------------------------------------- */
  if (!bd.did.has('cycleEnd') && t >= 7.7) {
    bd.did.add('cycleEnd');
    $stage().style.opacity = '0.35';
  }
  if (!bd.did.has('reset') && t >= 8.2) {
    bd.did.add('reset');
    bd.seed++;
    bdResetCycle();
  }
}
/* ================================================================ scene == */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1728);
scene.fog = new THREE.Fog(0x0d1728, 30, 60);

const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 6.4, 15);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('lab')!.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 1.0, -1);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI / 2 - 0.03;
orbit.minDistance = 3;
orbit.maxDistance = 42;

{
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(34, 64),
    new THREE.MeshStandardMaterial({ color: 0x1d4a2a, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1f2e1c, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(7, 13, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -14;
  scene.add(sun);
  const lm = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 });
  for (let x = -6; x <= 8; x += 2) scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0.012, -11), new THREE.Vector3(x, 0.012, 9)]), lm));
  for (let z = -9; z <= 7; z += 2) scene.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-7, 0.012, z), new THREE.Vector3(9, 0.012, z)]), lm));
  const labMark = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.1, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
  );
  labMark.rotation.x = -Math.PI / 2;
  labMark.position.set(-6.4, 0.015, 7.2);
  scene.add(labMark);
}

const gltfLoader = new GLTFLoader();
const gltfReady = new Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }>((resolve, reject) =>
  gltfLoader.load(MODEL_URL, (g) => resolve({ scene: g.scene, animations: g.animations }), undefined, reject));

/* ================================================================ UI ==== */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bodies: FallBody[] = [];
let labBody: FallBody | null = null;
const pileBodies: FallBody[] = [];

/* grid — 5 rows (archetypes) × 3 cols (speeds) */
function scheduleGrid(staggerOn: boolean) {
  const zRows = [5.8, 2.6, -0.6, -3.8, -7.0];
  const xCols = [-4.6, -0.8, 3.0];
  const speeds = [2.5, 6, 10];
  const arche = (row: number, col: number): { desc: FallDesc; mirror: boolean; color: number } => {
    const kind: FallDesc['kind'] = row === 4 ? 'ROLL' : 'FALL';
    const dir: FallDesc['dir'] = row === 0 ? 'F' : row === 1 ? 'B' : row === 2 ? 'S' : row === 3 ? 'S' : 'F';
    return {
      desc: { kind, speed: speeds[col], hitH: 0.6, massR: 1, dir },
      mirror: row === 3,
      color: row === 0 ? COLORS.F : row === 1 ? COLORS.B : row === 2 ? COLORS.SR
        : row === 3 ? COLORS.SL : COLORS.ROLL,
    };
  };
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const b = bodies[idx];
      const a = arche(row, col);
      if (!b || !a) { idx++; continue; }
      b.cfg = { desc: a.desc, mirror: a.mirror };
      b.tint(a.color);
      b.stand(xCols[col], zRows[row]);
      const delay = staggerOn ? (idx * 0.41) % 3.6 : idx === 0 ? 0 : 0.001;
      launchBody(b, a.desc, a.mirror, 1.5, true, delay);
      idx++;
    }
  }
}

/* lab actor controls */
let labKind: 'FALL' | 'ROLL' = 'FALL';
let labDir: DirSel = 'F';
const seg = (id: string, cb: (v: string) => void) => {
  const root = $(id);
  root.querySelectorAll('button').forEach((btn) =>
    btn.addEventListener('click', () => {
      root.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      btn.classList.add('on');
      cb((btn.getAttribute('data-k') ?? btn.getAttribute('data-d'))!);
    }));
};
seg('segKind', (v) => {
  labKind = v as 'FALL' | 'ROLL';
  $('vKind').textContent = labKind === 'FALL' ? 'carrier hit' : 'tackler rolls off';
  if (labKind === 'ROLL' && labDir === 'B') { labDir = 'F'; syncDir(); }
});
const syncDir = () => {
  $('segDir').querySelectorAll('button').forEach((b) =>
    b.classList.toggle('on', b.getAttribute('data-d') === labDir));
  $('vDir').textContent = labDir === 'F' ? 'forward' : labDir === 'B' ? 'backward'
    : labDir === 'S' ? 'lateral — right' : 'lateral — left';
};
seg('segDir', (v) => { labDir = v as DirSel; syncDir(); });

let labSpeed = 6, labH = 0.6, labMass = 1;
const rng = (id: string, out: string, min: number, max: number, fmt: (v: number) => string, set: (v: number) => void) => {
  const el = $(id) as HTMLInputElement;
  el.min = `${min * 100}`; el.max = `${max * 100}`;
  const apply = () => { const v = +el.value / 100; $(out).textContent = fmt(v); set(v); };
  el.addEventListener('input', apply);
  apply();
};
rng('speed', 'vSpeed', 2.5, 10, (v) => `${v.toFixed(1)} m/s`, (v) => { labSpeed = v; });
rng('hitH', 'vH', 0, 1, (v) => `${v.toFixed(2)} ${v < 0.35 ? '· ankle' : v < 0.65 ? '· hip' : '· chest'}`, (v) => { labH = v; });
rng('massR', 'vMass', 0.85, 1.2, (v) => `${v.toFixed(2)}`, (v) => { labMass = v; });

let labHold = false;
$('holdLab').addEventListener('click', () => {
  labHold = !labHold;
  $('holdLab').textContent = labHold ? 'holding — click to release' : 'hold on turf';
});
$('goLab').addEventListener('click', () => {
  if (!labBody) return;
  const desc: FallDesc = { kind: labKind, speed: labSpeed, hitH: labH, massR: labMass, dir: dirOf(labDir) };
  const entry = findFall(desc);
  launchBody(labBody, desc, mirrorOf(labDir), labHold ? 1e9 : 1.3, false);
  const m = entry.meta;
  const dName = (n: number) => (n === 0 ? 'forward' : n === 1 ? 'backward' : 'lateral');
  $('readout').textContent =
    `descriptor → ${desc.kind} · ${dName(desc.dir === 'F' ? 0 : desc.dir === 'B' ? 1 : 0.5)}` +
    ` · ${desc.speed.toFixed(1)} m/s · hit h ${desc.hitH.toFixed(2)} · mass ×${desc.massR.toFixed(2)}\n` +
    `nearest recording → ${m.kind} · ${dName(m.dir)} · ${m.speed.toFixed(1)} m/s · h ${m.hitH.toFixed(2)} · mass ×${m.massR.toFixed(2)}\n` +
    (mirrorOf(labDir) ? '… mirrored for a fall to his LEFT\n' : '… played as recorded\n');
});

$('goStagger').addEventListener('click', () => {
  const on = (+($('stagger') as HTMLInputElement).value) > 20;
  $('vStagger').textContent = on ? 'on' : 'off';
  scheduleGrid(on);
});
$('goPile').addEventListener('click', () => {
  const PX = 6.4, PZ = -8.8;
  const confs: Array<{ ang: number; off: number; desc: FallDesc; mirror?: boolean }> = [
    { ang: 0.2, off: 0.0, desc: { kind: 'FALL', speed: 7.5, hitH: 0.4, massR: 1.1, dir: 'F' } },
    { ang: 2.5, off: 0.22, desc: { kind: 'FALL', speed: 6, hitH: 0.6, massR: 1, dir: 'S' }, mirror: true },
    { ang: 4.6, off: 0.44, desc: { kind: 'FALL', speed: 5, hitH: 0.5, massR: 0.9, dir: 'S' } },
    { ang: 1.1, off: 0.66, desc: { kind: 'FALL', speed: 4.5, hitH: 0.85, massR: 1.15, dir: 'B' } },
    { ang: 3.5, off: 0.88, desc: { kind: 'FALL', speed: 6.5, hitH: 0.35, massR: 1.05, dir: 'F' } },
    { ang: 5.6, off: 1.12, desc: { kind: 'FALL', speed: 8.5, hitH: 0.55, massR: 1.1, dir: 'S' }, mirror: true },
  ];
  confs.forEach((c, i) => {
    const b = pileBodies[i];
    if (!b) return;
    b.tint(COLORS.PILE);
    b.cfg = null;
    b.play.loop = false;
    // face the pile centre: the model's +Z must point along (cos,sin)
    b.stand(PX + Math.cos(c.ang) * 1.3, PZ + Math.sin(c.ang) * 1.3, c.ang);
    launchBody(b, c.desc, !!c.mirror, 1e9, false, c.off);
  });
});
$('clearPile').addEventListener('click', () => {
  for (const b of pileBodies) { b.play.run = false; b.show(false); }
});

/* ========================================================= breakdown UI == */
const bdHide = () => {
  for (const k of Object.keys(bd.actors)) {
    bd.actors[k as keyof typeof bd.actors].group.visible = false;
  }
  if (bd.ball) bd.ball.visible = false;
};
$('goBD').addEventListener('click', () => {
  bd.on = !bd.on;
  const btn = $('goBD');
  btn.textContent = bd.on ? 'breakdown loop running — click to stop' : 'run the breakdown (loops)';
  btn.classList.toggle('secondary', !bd.on);
  if (bd.on) {
    for (const k of Object.keys(bd.actors)) {
      bd.actors[k as keyof typeof bd.actors].group.visible = true;
    }
    if (bd.ball) bd.ball.visible = true;
    bd.seed = 1 + (Math.random() * 9999) | 0;
    bdResetCycle();
  } else {
    bdHide();
    $stage().style.opacity = '0';
    $status().style.display = 'none';
  }
});

/* ================================================================= main == */
async function main() {
  const gltf = await gltfReady;
  for (let i = 0; i < 15; i++) {
    const b = new FallBody(scene, gltf);
    b.attach();
    bodies.push(b);
  }
  labBody = new FallBody(scene, gltf);
  labBody.attach();
  labBody.tint(0xffffff);
  labBody.stand(-6.4, 7.2);
  for (let i = 0; i < 6; i++) {
    const b = new FallBody(scene, gltf);
    b.attach();
    b.tint(COLORS.PILE);
    b.show(false);
    pileBodies.push(b);
  }
  bdInit(scene, gltf);
  bdHide();
  $stage().style.opacity = '0';
  $status().style.display = 'none';
  scheduleGrid(true);

  renderer.setAnimationLoop(frame);
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  let last = performance.now() / 1000;
  function frame() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0.001, now - last));
    last = now;
    for (const b of bodies) b.update(dt);
    if (labBody) labBody.update(dt);
    for (const b of pileBodies) b.update(dt);
    for (const k of Object.keys(bd.actors)) bd.actors[k as keyof typeof bd.actors].update(dt);
    bdTick(dt);
    orbit.update();
    renderer.render(scene, camera);
  }
}

main().catch((e) => {
  console.error(e);
  $('panel').insertAdjacentHTML('beforeend',
    `<div style="color:#ff7d7d;margin-top:8px">boot failed: ${(e as Error)?.message ?? String(e)}</div>`);
});
