/**
 * PLAYGROUND — the isolated 3D scene that mounts during `npm run dev`.
 *
 * Loads the rugby-player GLB, spawns the 15-collider active ragdoll at its
 * bind pose standing under PD motor power, and offers:
 *
 *   click / M  — cycle drive mode: active → kinematic → loose
 *   SPACE      — fire a heavy impulse at the chest (overpowers the motors in
 *                active mode → the rig collapses, then fights back up)
 *   I          — loop the GLB's Idle clip as the pose target (kinematic/active)
 *   D          — toggle collider wireframes
 *   W / ↑      — TARCS walk: engage the procedural wobble-gait drive (forward)
 *   S / ↓      — TARCS walk backward (phase clock runs on the speed magnitude)
 *   (release W/S stops the drive and the legs return to the bind pose)
 *
 * The scene only touches ragdoll construction + joint torque; ball handling
 * and camera code elsewhere are untouched.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildRagdollWorld } from './rig';
import { createMotor, motorStats, type RagdollMotor } from './motor';
import { syncMeshToRagdoll, createColliderDebug } from './sync';
import { bindSource, clipSource, samplePose } from './pose';
import type { DriveMode, PoseQuat } from './types';

export interface PlaygroundHandles {
  motor: RagdollMotor;
  setMode(m: DriveMode): void;
  setAnimate(b: boolean): void;
  fireImpulse(): void;
  reset(): void;
  dispose(): void;
}

export async function mountPlayground(container: HTMLElement): Promise<PlaygroundHandles> {
  /* ---------------- renderer / scene ---------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10151f);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(3.4, 1.9, 4.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.9, 0);

  scene.add(new THREE.HemisphereLight(0xd8e4ff, 0x2a2f3a, 1.0));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(4, 6, 3);
  scene.add(dir);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0x1f3a26, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(10, 20, 0x3f6a4e, 0x29402f);
  grid.position.y = 0.005;
  scene.add(grid);
  const axes = new THREE.AxesHelper(0.5);
  axes.position.set(-1.5, 0.01, -1.5);
  scene.add(axes);

  /* ---------------- physics rig ---------------- */
  const rig = buildRagdollWorld();
  const motor = createMotor(rig, { mode: 'active' });

  /* ---------------- pose sources ---------------- */
  const poseBind = bindSource();
  let poseSource = poseBind;
  let poseT = 0;
  let animate = false;

  /* ---------------- load the skinned mesh ---------------- */
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('assets/models/rugby_player.glb');
  const model = gltf.scene;
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  // pick the clip named Idle (fallback: first clip)
  const idle = gltf.animations.find((a) => /idle/i.test(a.name)) ?? gltf.animations[0];
  const clipHolder = { clip: idle ?? null };

  let skinned: THREE.SkinnedMesh | null = null;
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && !skinned) {
      skinned = sm;
      for (const b of sm.skeleton.bones) bones.set(b.name, b);
    }
  });
  scene.add(model);
  model.updateMatrixWorld(true);

  /* ---------------- debug ---------------- */
  const dbg = createColliderDebug(rig);
  dbg.group.visible = false;
  scene.add(dbg.group);

  /* ---------------- interaction ---------------- */
  const modeOrder: DriveMode[] = ['active', 'kinematic', 'loose'];
  let modeIx = 0;
  let dbgOn = false;

  const status = document.createElement('div');
  status.style.cssText = 'position:absolute;left:10px;top:44px;color:#d7f2ff;font:12px/1.5 ui-monospace,monospace;background:#00000099;padding:8px 12px;border-radius:8px;pointer-events:none;white-space:pre;z-index:10;';
  container.appendChild(status);

  const setMode = (m: DriveMode) => {
    motor.mode = m;
    for (const t of motor.targets.values()) {
      t.kinematic = m === 'kinematic';
      t.strength = m === 'loose' ? 0 : 1;
    }
    motor.balance.enabled = m === 'active';
    if (m === 'kinematic') animate = false;
    applyWalk();
  };
  const setAnimate = (b: boolean) => { animate = b; poseT = 0; };

  const handles: PlaygroundHandles = {
    motor,
    setMode,
    setAnimate,
    fireImpulse() {
      const chest = rig.byPart.get('chest');
      if (!chest) return;
      // camera-facing heavy impulse
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
      const v = dir.multiplyScalar(11);
      v.y += 2.2;
      chest.body.applyImpulse({ x: v.x, y: v.y, z: v.z }, true);
    },
    reset() {
      for (const b of rig.bodies) {
        const t = b.bind.p; const q = b.bind.q;
        b.body.setTranslation({ x: t.x, y: t.y, z: t.z }, true);
        b.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
        b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    },
    dispose() {
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };

  renderer.domElement.addEventListener('pointerdown', () => {
    modeIx = (modeIx + 1) % modeOrder.length;
    setMode(modeOrder[modeIx]);
  });
  // TARCS walk drive: W / ↑ = forward (+z), S / ↓ = backward. The oscillator
  // phase is advanced by the drive's horizontal speed inside motor.step, so
  // holding a key makes the legs wobble-step and releasing it parks them back
  // at the bind pose (drive = null).
  const WALK_SPEED = 0.8; // m/s desired horizontal speed (cadence source)
  let walkKey: 'fwd' | 'back' | null = null;
  const applyWalk = () => {
    if (walkKey && motor.mode === 'active') {
      motor.drive = walkKey === 'fwd' ? { x: 0, y: 0, z: WALK_SPEED } : { x: 0, y: 0, z: -WALK_SPEED };
    } else {
      motor.drive = null;
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') { e.preventDefault(); handles.fireImpulse(); }
    else if (e.code === 'KeyD') { dbgOn = !dbgOn; dbg.group.visible = dbgOn; }
    else if (e.code === 'KeyI') { setAnimate(!animate); }
    else if (e.code === 'KeyM') { modeIx = (modeIx + 1) % modeOrder.length; setMode(modeOrder[modeIx]); }
    else if (e.code === 'KeyR') { handles.reset(); }
    else if (e.code === 'KeyW' || e.code === 'ArrowUp') { walkKey = 'fwd'; applyWalk(); }
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') { walkKey = 'back'; applyWalk(); }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'KeyS' || e.code === 'ArrowDown') {
      walkKey = null; applyWalk();
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  /* ---------------- main loop ---------------- */
  let last = performance.now();
  let simT = 0;
  let hud = 0;

  const frame = () => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (performance.now() - last) / 1000);
    last = performance.now();

    const h = 1 / 60;
    let remaining = dt;
    while (remaining >= h) {
      rig.world.step();
      simT += h;
      remaining -= h;
    }

    // pose target: bind, or the looping Idle clip
    if (animate && clipHolder.clip) {
      const src = clipSource(clipHolder.clip);
      poseSource = src;
      poseT = (poseT + dt) % Math.max(0.001, src.duration);
    } else {
      poseSource = poseBind;
    }
    const sampled = samplePose(rig, poseSource, animate ? poseT : 0);
    const poseBones = sampled as Partial<Record<string, PoseQuat>>;
    motor.setPose({ mode: motor.mode, time: simT, bones: poseBones as never, strength: 1 });
    motor.step(h, simT);

    syncMeshToRagdoll(rig, { mesh: skinned!, bones, modelRoot: model });
    dbg.update();

    // HUD
    if (--hud <= 0) {
      hud = 15;
      const st = motorStats(motor);
      const hips = rig.byPart.get('hips')!.body.translation();
      const op = st.overpowered;
      status.textContent = [
        `mode    : ${motor.mode}      (M / click)`,
        `animate : ${animate ? 'Idle clip' : 'bind pose'}  (I)`,
        `walk    : ${walkKey ? (walkKey === 'fwd' ? 'W → TARCS high steps' : 'S ← TARCS high steps') : 'idle (bind pose)'}   (W/S)`,
        `effort  : ${(st.effort * 100).toFixed(0)}%   overpowered joints: ${op}`,
        `hips y  : ${hips.y.toFixed(2)} m`,
        ``,
        `SPACE impulse · R reset · D colliders · W/S walk`,
      ].join('\n');
    }
    controls.update();
    renderer.render(scene, camera);
  };
  frame();

  return handles;
}
