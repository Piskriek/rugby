/**
 * cameraverify — pass/fail gates for the first/third person camera rig.
 *
 * The acceptance criteria for this feature are behavioural ("never clips
 * through terrain", "hard pitch clamps", "does not break user mouse look").
 * Behavioural claims are worth nothing unless they are measured, and this
 * sandbox has no GPU to look at, so every one of them is asserted here
 * against the real module.
 *
 * The rig was written engine-agnostic precisely so this file could exist.
 *
 *   npx vite-node scripts/cameraverify.ts
 */
import {
  DEFAULT_TUNING, STADIUM_COLLIDERS,
  angleDelta, ballLookBias, clamp, createRigState, smoothFactor,
  stepLocomotion, sweepBoom, toggleViewMode, updateRig,
  type RigInput, type RigWorld,
} from '../src/render/camera';
import type { Camera } from '../src/render/retro';

let ok = true;
const check = (name: string, pass: boolean, detail: string): void => {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
};

const DEG = Math.PI / 180;
const T = DEFAULT_TUNING;

const noInput = (): RigInput => ({
  fwd: false, back: false, left: false, right: false,
  sprint: false, mouseDX: 0, mouseDY: 0,
});

const world = (over: Partial<RigWorld> = {}): RigWorld => ({
  self: { x: 0, z: 0, face: 0 },
  ball: null,
  ballLanding: null,
  ...over,
});

const newCam = (): Camera => ({
  x: 0, z: 0, h: 0, yaw: 0, tilt: 0, fov: 1, shake: 0, horizon: 0.5, roll: 0,
});

console.log('cameraverify — first/third person rig\n');

/* ------------------------------------------------------------ 1. maths */

{
  /* Angle seam. Every smoother in the rig depends on this; if it is wrong the
   * view spins the long way round when yaw crosses PI. */
  const a = angleDelta(3.10, -3.10);
  check('angleDelta takes the short way across the seam',
    Math.abs(a) < 0.1 && a > 0, `${a.toFixed(4)} rad (not ${(-6.2).toFixed(1)})`);
}

{
  /* Framerate independence. One 100 ms step must land in the same place as
   * ten 10 ms steps, or the rig feels different on every machine. */
  const tau = 0.2;
  let big = 0; big += (1 - big) * smoothFactor(0.1, tau);
  let small = 0;
  for (let i = 0; i < 10; i++) small += (1 - small) * smoothFactor(0.01, tau);
  check('smoothing is framerate independent',
    Math.abs(big - small) < 0.005, `1x100ms=${big.toFixed(4)} vs 10x10ms=${small.toFixed(4)}`);
}

/* --------------------------------------------------- 2. mouse + clamps */

{
  /* The spec's hard clamps: -80 to +85 degrees. Push far past both. */
  const st = createRigState('FIRST');
  const inp = noInput();
  const cam = newCam();
  for (let i = 0; i < 400; i++) {
    inp.mouseDY = -100;      // pushing the view UP
    updateRig(st, world(), inp, 1 / 60, T, cam);
  }
  const up = st.pitch / DEG;
  for (let i = 0; i < 800; i++) {
    inp.mouseDY = 100;       // and now DOWN
    updateRig(st, world(), inp, 1 / 60, T, cam);
  }
  const down = st.pitch / DEG;
  check('pitch clamps hard at +85 deg', Math.abs(up - 85) < 0.001, `${up.toFixed(3)} deg`);
  check('pitch clamps hard at -80 deg', Math.abs(down - (-80)) < 0.001, `${down.toFixed(3)} deg`);
}

{
  /* The clamp must be instantly reversible. If the accumulator were allowed
   * to run past the limit, the view would refuse to come back down until the
   * slack unwound — the "sticky ceiling" bug this guards. */
  const st = createRigState('FIRST');
  const inp = noInput();
  const cam = newCam();
  for (let i = 0; i < 200; i++) { inp.mouseDY = -100; updateRig(st, world(), inp, 1 / 60, T, cam); }
  inp.mouseDY = 50;  // one small nudge back down
  updateRig(st, world(), inp, 1 / 60, T, cam);
  const moved = 85 - st.pitch / DEG;
  check('the clamp is instantly reversible',
    moved > 0.1, `one nudge moved ${moved.toFixed(2)} deg off the ceiling`);
}

{
  /* Yaw must stay bounded over a long match rather than growing without end. */
  const st = createRigState('FIRST');
  const inp = noInput();
  const cam = newCam();
  for (let i = 0; i < 5000; i++) { inp.mouseDX = 60; updateRig(st, world(), inp, 1 / 60, T, cam); }
  check('yaw stays wrapped over a long session',
    Math.abs(st.yaw) <= Math.PI + 1e-6, `${st.yaw.toFixed(3)} rad`);
}

/* ------------------------------------------------- 3. collision avoidance */

{
  /* THE HEADLINE CRITERION: the camera never clips through terrain.
   *
   * Walk the subject all round the enclosure, looking in every direction,
   * and assert the solved rig position is never inside a collider nor under
   * the turf. This is the test that would have to fail before the feature
   * could ship broken. */
  const st = createRigState('THIRD');
  const inp = noInput();
  const cam = newCam();
  let worstY = Infinity;
  let inside = 0;
  let samples = 0;

  for (let zi = -60; zi <= 60; zi += 6) {
    for (let xi = -34; xi <= 34; xi += 4) {
      for (let yi = 0; yi < 8; yi++) {
        st.posX = xi; st.posZ = zi; st.posH = T.followHeight;
        st.smoothYaw = st.yaw = (yi / 8) * Math.PI * 2 - Math.PI;
        /* Look steeply down: the case that drives the boom into the turf. */
        st.smoothPitch = st.pitch = -70 * DEG;
        const w = world({ self: { x: xi, z: zi, face: 0 } });
        /* Settle so the smoothers reach steady state. */
        for (let i = 0; i < 30; i++) updateRig(st, w, inp, 1 / 60, T, cam);

        samples++;
        worstY = Math.min(worstY, cam.h);
        for (const c of STADIUM_COLLIDERS) {
          if (cam.x > c.minX && cam.x < c.maxX
            && cam.z > c.minZ && cam.z < c.maxZ
            && cam.h < c.height) { inside++; break; }
        }
      }
    }
  }
  check('camera never enters a stadium collider', inside === 0,
    `${inside} of ${samples} samples inside geometry`);
  check('camera never sinks below the turf', worstY >= T.collisionPad - 1e-6,
    `lowest camera height ${worstY.toFixed(3)} m (pad ${T.collisionPad})`);
}

{
  /* The sweep must actually stop at a wall, not merely fail to crash. Fire a
   * boom from mid-pitch straight out through the far dead-ball wall. */
  const f = sweepBoom(0, 2, 55, 0, 2, 90, STADIUM_COLLIDERS, T.collisionPad);
  check('the boom stops at the perimeter wall', f < 1,
    `travelled ${(f * 100).toFixed(1)}% of the way into the stand`);

  /* ...and must NOT stop when the path is clear. A collision system that
   * always reports a hit passes the test above while ruining the camera. */
  const clear = sweepBoom(0, 3, 0, 0, 3, 10, STADIUM_COLLIDERS, T.collisionPad);
  check('an unobstructed boom is not shortened', clear === 1,
    `fraction ${clear.toFixed(3)} over open pitch`);
}

/* ------------------------------------------------------- 4. ball bias */

{
  /* Out of range: no influence whatsoever. */
  const far = ballLookBias(0, 0, 1.7, world({ ball: { x: 0, y: 1, z: 40 } }), T);
  check('no ball bias beyond 15 m', far.weight === 0, `weight ${far.weight}`);

  /* In range: some influence, but strictly bounded. */
  const near = ballLookBias(0, 0, 1.7, world({ ball: { x: 6, y: 1, z: 6 } }), T);
  check('ball bias engages inside 15 m', near.weight > 0, `weight ${near.weight.toFixed(3)}`);

  /* THE CRITICAL ONE: it must never take the view away from the player. The
   * bias is a partial blend, so the rendered yaw must stay strictly between
   * where the player is looking and where the ball is. */
  const st = createRigState('FIRST');
  st.smoothYaw = st.yaw = 0;
  st.smoothPitch = st.pitch = 0;
  st.posX = 0; st.posZ = 0; st.posH = 1.7;
  const cam = newCam();
  const w = world({ ball: { x: 8, y: 1, z: 0 } });
  updateRig(st, w, noInput(), 1 / 60, T, cam);
  const toBall = Math.atan2(8, 0);
  const movedToward = angleDelta(0, cam.yaw);
  check('ball bias nudges toward the ball', movedToward > 0.001,
    `yaw moved ${(movedToward / DEG).toFixed(2)} deg toward it`);
  check('ball bias never overrides the player', Math.abs(movedToward) < Math.abs(toBall),
    `${(movedToward / DEG).toFixed(1)} deg of a possible ${(toBall / DEG).toFixed(1)} deg`);

  /* And it must leave the player's own accumulator untouched, or the bias
   * would integrate over time and slowly steal the view. */
  check('ball bias does not corrupt the look accumulator', st.yaw === 0,
    `accumulator still ${st.yaw.toFixed(6)}`);
}

/* ------------------------------------------------------- 5. locomotion */

{
  /* Camera-relative movement: "forward" must follow the camera, not the world.
   * Face +x and press W; the rig must travel along +x. */
  const st = createRigState('THIRD');
  st.smoothYaw = Math.PI / 2;           // looking down +x
  const inp = noInput(); inp.fwd = true;
  for (let i = 0; i < 120; i++) stepLocomotion(st, inp, 1 / 60, T);
  check('WASD is relative to camera heading',
    st.velX > 3 && Math.abs(st.velZ) < 0.5,
    `vel (${st.velX.toFixed(2)}, ${st.velZ.toFixed(2)}) facing +x`);
}

{
  /* Diagonals must not be faster than cardinals. */
  const a = createRigState('THIRD');
  const fwd = noInput(); fwd.fwd = true;
  for (let i = 0; i < 240; i++) stepLocomotion(a, fwd, 1 / 60, T);
  const straight = Math.hypot(a.velX, a.velZ);

  const b = createRigState('THIRD');
  const diag = noInput(); diag.fwd = true; diag.right = true;
  for (let i = 0; i < 240; i++) stepLocomotion(b, diag, 1 / 60, T);
  const dspeed = Math.hypot(b.velX, b.velZ);

  check('diagonal movement is normalised',
    Math.abs(dspeed - straight) < 0.05, `straight ${straight.toFixed(3)} vs diag ${dspeed.toFixed(3)} m/s`);
}

{
  /* Sprint is faster than walk... */
  const w2 = createRigState('THIRD');
  const wi = noInput(); wi.fwd = true;
  for (let i = 0; i < 240; i++) stepLocomotion(w2, wi, 1 / 60, T);
  const walk = Math.hypot(w2.velX, w2.velZ);

  const s2 = createRigState('THIRD');
  const si = noInput(); si.fwd = true; si.sprint = true;
  for (let i = 0; i < 60; i++) stepLocomotion(s2, si, 1 / 60, T);
  const sprint = Math.hypot(s2.velX, s2.velZ);
  check('sprint exceeds walk speed', sprint > walk + 1,
    `${walk.toFixed(2)} -> ${sprint.toFixed(2)} m/s`);
}

{
  /* ...but is finite: stamina must actually run out, and then recover. */
  const st = createRigState('THIRD');
  const si = noInput(); si.fwd = true; si.sprint = true;
  let exhaustedAt = -1;
  for (let i = 0; i < 60 * 60; i++) {
    stepLocomotion(st, si, 1 / 60, T);
    if (st.exhausted && exhaustedAt < 0) exhaustedAt = i / 60;
  }
  check('stamina is exhausted by sustained sprinting',
    exhaustedAt > 0, `exhausted after ${exhaustedAt.toFixed(1)} s`);

  const drained = Math.hypot(st.velX, st.velZ);
  const rest = noInput();
  for (let i = 0; i < 60 * 20; i++) stepLocomotion(st, rest, 1 / 60, T);
  check('stamina recovers at rest', st.stamina > 0.9 && !st.exhausted,
    `recovered to ${(st.stamina * 100).toFixed(0)}%`);

  /* Hysteresis: once exhausted, sprint must stay refused until well recovered,
   * otherwise speed stutters on and off at the threshold. */
  const st2 = createRigState('THIRD');
  st2.stamina = 0.01; st2.exhausted = true;
  stepLocomotion(st2, si, 1 / 60, T);
  check('exhausted latch has hysteresis', st2.exhausted,
    `still latched at ${(st2.stamina * 100).toFixed(1)}% (rearm ${T.staminaRearm * 100}%)`);

  check('speed decays when exhausted', drained < 8.4,
    `${drained.toFixed(2)} m/s vs ${T.sprintSpeed} m/s fresh`);
}

/* --------------------------------------------------- 6. the V toggle */

{
  const st = createRigState('THIRD');
  check('rig starts in third person', st.mode === 'THIRD', st.mode);
  check('toggle switches to first', toggleViewMode(st) === 'FIRST', st.mode);
  check('toggle switches back', toggleViewMode(st) === 'THIRD', st.mode);
}

{
  /* SEAMLESS is the requirement, so measure it: no single frame of the
   * transition may jump the camera. A cut would show up as a large
   * inter-frame delta. */
  const st = createRigState('THIRD');
  const inp = noInput();
  const cam = newCam();
  const w = world();
  for (let i = 0; i < 120; i++) updateRig(st, w, inp, 1 / 60, T, cam);

  toggleViewMode(st);
  let maxJump = 0;
  let px = cam.x, pz = cam.z, ph = cam.h;
  for (let i = 0; i < 180; i++) {
    updateRig(st, w, inp, 1 / 60, T, cam);
    maxJump = Math.max(maxJump, Math.hypot(cam.x - px, cam.z - pz, cam.h - ph));
    px = cam.x; pz = cam.z; ph = cam.h;
  }
  check('third -> first is seamless (no cut)', maxJump < 0.5,
    `largest single-frame move ${(maxJump * 100).toFixed(1)} cm`);

  const settled = Math.abs(cam.h - T.eyeHeight);
  check('first person settles at eye height', settled < 0.02,
    `${cam.h.toFixed(3)} m (want ${T.eyeHeight})`);
}

{
  /* And back the other way, which is the direction that has to extend a boom
   * through the collision solver rather than retract one. */
  const st = createRigState('FIRST');
  const inp = noInput();
  const cam = newCam();
  const w = world();
  for (let i = 0; i < 120; i++) updateRig(st, w, inp, 1 / 60, T, cam);
  toggleViewMode(st);
  let maxJump = 0;
  let px = cam.x, pz = cam.z, ph = cam.h;
  for (let i = 0; i < 180; i++) {
    updateRig(st, w, inp, 1 / 60, T, cam);
    maxJump = Math.max(maxJump, Math.hypot(cam.x - px, cam.z - pz, cam.h - ph));
    px = cam.x; pz = cam.z; ph = cam.h;
  }
  check('first -> third is seamless (no cut)', maxJump < 0.5,
    `largest single-frame move ${(maxJump * 100).toFixed(1)} cm`);
  const back = Math.hypot(cam.x - 0, cam.z - 0);
  check('third person pulls back to a boom', back > 3,
    `${back.toFixed(2)} m behind the subject`);
}

/* ------------------------------------------------------- 7. stability */

{
  /* Nothing may ever produce NaN. A single NaN in a camera silently blanks
   * the entire frame, which is exactly the class of bug that cost this
   * project several rounds already. */
  const st = createRigState('THIRD');
  const cam = newCam();
  const inp = noInput();
  let bad = 0;
  for (let i = 0; i < 3000; i++) {
    inp.mouseDX = (Math.random() - 0.5) * 300;
    inp.mouseDY = (Math.random() - 0.5) * 300;
    inp.fwd = Math.random() > 0.5; inp.back = Math.random() > 0.7;
    inp.left = Math.random() > 0.6; inp.right = Math.random() > 0.6;
    inp.sprint = Math.random() > 0.5;
    if (i % 97 === 0) toggleViewMode(st);
    /* Include pathological frame times: a tab regaining focus delivers them. */
    const dt = i % 50 === 0 ? 0.25 : 1 / 60;
    updateRig(st, world({ ball: { x: Math.sin(i) * 20, y: 2, z: Math.cos(i) * 20 } }), inp, dt, T, cam);
    if (!Number.isFinite(cam.x + cam.z + cam.h + cam.yaw + cam.tilt + cam.fov)) bad++;
  }
  check('no NaN under 3000 randomised frames', bad === 0, `${bad} bad frames`);
}

{
  /* The rig must stay inside the enclosure even when the player runs at the
   * wall for a full minute. */
  const st = createRigState('THIRD');
  const cam = newCam();
  const inp = noInput(); inp.fwd = true; inp.sprint = true;
  st.smoothYaw = st.yaw = 0;
  let maxAbsZ = 0, maxAbsX = 0;
  let sx = 0, sz = 0;
  for (let i = 0; i < 60 * 60; i++) {
    const r = updateRig(st, world({ self: { x: sx, z: sz, face: 0 } }), inp, 1 / 60, T, cam);
    sx = clamp(sx + st.velX / 60, -60, 60);
    sz = clamp(sz + st.velZ / 60, -80, 80);
    void r;
    maxAbsZ = Math.max(maxAbsZ, Math.abs(cam.z));
    maxAbsX = Math.max(maxAbsX, Math.abs(cam.x));
  }
  check('rig stays within the enclosure', maxAbsZ < 70 && maxAbsX < 45,
    `max |x| ${maxAbsX.toFixed(1)} m, max |z| ${maxAbsZ.toFixed(1)} m`);
}

{
  /* Performance. The rig runs every frame alongside a full match sim, so it
   * has to be genuinely cheap. */
  const st = createRigState('THIRD');
  const cam = newCam();
  const inp = noInput(); inp.fwd = true;
  const w = world({ ball: { x: 5, y: 1, z: 5 } });
  const N = 200_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) updateRig(st, w, inp, 1 / 60, T, cam);
  const per = (performance.now() - t0) / N;
  check('update cost is negligible', per < 0.01,
    `${(per * 1000).toFixed(2)} us/frame (budget 10 us)`);
}

/* ------------------------------------- 8. ball-tracking whiplash (TABS) */

{
  /* THE TABS REGRESSION. The ragdoll occasionally launches the ball at
   * extreme velocities, so inside the 15 m bias range the ball's direction
   * can change many tens of degrees between two frames. The applied bias
   * must be a rate-limited follower:
   *   (a) no single frame may swing the rendered yaw by more than the
   *       tuned turn-rate cap — the old code took 40° in one frame;
   *   (b) the offset can never leave the player's own aim by more than the
   *       tuned maximum bias, no matter how violently the ball moves;
   *   (c) and it must still ENGAGE — damping that kills the feature fixes
   *       nothing. */
  const st = createRigState('FIRST');
  st.posX = 0; st.posZ = 0; st.posH = T.eyeHeight;
  const cam = newCam();
  const inp = noInput();
  updateRig(st, world(), inp, 1 / 60, T, cam);
  const before = cam.yaw;
  updateRig(st, world({ ball: { x: 8, y: 1, z: 0 } }), inp, 1 / 60, T, cam);
  const swing = Math.abs(angleDelta(before, cam.yaw));
  const cap = T.ballBiasMaxTurnRate / 60;
  check('a launched ball cannot snap the view',
    swing <= cap + 1e-9, `single-frame swing ${(swing / DEG).toFixed(2)} deg (cap ${(cap / DEG).toFixed(2)} deg)`);

  /* The same launch, sustained: the ball circles the player at ~25 m/s,
   * its direction swinging 20° every frame for ten seconds. */
  const st2 = createRigState('FIRST');
  st2.posX = 0; st2.posZ = 0; st2.posH = T.eyeHeight;
  const cam2 = newCam();
  let maxOff = 0;
  let maxFrame = 0;
  let prev = cam2.yaw;
  for (let i = 0; i < 600; i++) {
    const a = i * 0.35;
    updateRig(st2, world({ ball: { x: Math.sin(a) * 12, y: 2, z: Math.cos(a) * 12 } }), inp, 1 / 60, T, cam2);
    maxOff = Math.max(maxOff, Math.abs(cam2.yaw));
    maxFrame = Math.max(maxFrame, Math.abs(angleDelta(prev, cam2.yaw)));
    prev = cam2.yaw;
  }
  check('sustained extreme ball motion stays rate-limited',
    maxFrame <= cap + 1e-9, `worst single-frame swing ${(maxFrame / DEG).toFixed(2)} deg (cap ${(cap / DEG).toFixed(2)} deg)`);
  check('the bias never leaves its envelope',
    maxOff <= T.ballBiasMax + 1e-9, `max ${(maxOff / DEG).toFixed(1)} deg from the player's aim (cap ${(T.ballBiasMax / DEG).toFixed(1)} deg)`);

  /* ...and the follower must still track: at a settled ball the bias
   * converges to a clearly visible offset. */
  const st3 = createRigState('FIRST');
  st3.posX = 0; st3.posZ = 0; st3.posH = T.eyeHeight;
  const cam3 = newCam();
  for (let i = 0; i < 180; i++) {
    updateRig(st3, world({ ball: { x: 6, y: 1, z: 6 } }), inp, 1 / 60, T, cam3);
  }
  check('the damped bias still engages at rest',
    cam3.yaw > 0.2, `settled offset ${(cam3.yaw / DEG).toFixed(1)} deg toward the ball`);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
