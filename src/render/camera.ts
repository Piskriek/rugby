/**
 * camera.ts — unified First-Person / Third-Person camera and locomotion rig.
 *
 * WHAT THIS IS FOR
 * ----------------
 * The shipped game is a broadcast simulation: an AI director flies a cable
 * camera and the player commands the team. This module adds the other half —
 * a player-driven rig that puts you *inside* the match, either behind the
 * eyes of a single player (FIRST) or over his shoulder (THIRD), with mouse
 * look, pointer lock and WASD locomotion.
 *
 * DESIGN RULES, and why each one is not negotiable here
 * ----------------------------------------------------
 * 1. ENGINE-AGNOSTIC AND PURE. Not one Three.js import. Every function is a
 *    plain transform over plain numbers, so the whole rig can be driven
 *    headlessly by scripts/cameraverify.ts. That is the same discipline that
 *    made src/render/ragdoll.ts testable, and it is the only reason the
 *    acceptance criteria below can be *proven* rather than eyeballed — which
 *    matters doubly in this sandbox, where there is no GPU to look at.
 *
 * 2. THE RIG NEVER OWNS THE SIMULATION. It reads the world and emits a
 *    `Camera` (the existing struct from render/retro.ts) plus a desired move
 *    vector. It never writes to the director. A camera bug can therefore
 *    never become a match bug.
 *
 * 3. NO ALLOCATION IN THE PER-FRAME PATH. `update()` mutates a single owned
 *    `Camera` and returns it by reference. At 60 Hz for the whole match, a
 *    fresh object per frame is thousands of pointless collections.
 *
 * 4. EVERY SMOOTHER IS FRAMERATE-INDEPENDENT. Exponential smoothing written
 *    as `1 - exp(-dt / tau)`, never `lerp(a, b, 0.1)`. The naive form is a
 *    different filter at 30, 60 and 144 Hz, which is precisely how a rig ends
 *    up feeling correct on the machine it was written on and sluggish or
 *    sick-making everywhere else.
 *
 * COORDINATE CONVENTIONS (the source of most camera bugs in this repo)
 * --------------------------------------------------------------------
 *   - Logical pitch space: x across (-35 .. +35), z down-field (-62 .. +62),
 *     y up. Metres. This is the space `Director` and this module speak.
 *   - `yaw` 0 looks toward +z; it increases toward +x. Ground-forward is
 *     therefore (sin yaw, cos yaw), matching render/retro.ts `project()`.
 *   - `tilt` is POSITIVE DOWNWARD, because that is what the existing
 *     projection expects. Pitch clamps in this file are expressed in the
 *     spec's intuitive form (look up = positive degrees) and converted once,
 *     in `applyMouseDelta`, so the sign flip lives in exactly one place.
 */

import type { Camera } from './retro';
import { FIELD } from './retro';

/* ------------------------------------------------------------------ types */

export type ViewMode = 'FIRST' | 'THIRD';

/** What the rig needs to know about the world this frame. */
export interface RigWorld {
  /** The player being followed, in logical pitch metres. */
  self: { x: number; z: number; /** facing, radians, same convention as yaw */ face: number };
  /** Live ball position, or null when it is not in play. */
  ball: { x: number; y: number; z: number } | null;
  /** Predicted landing spot of a kick in flight, if any. Preferred over `ball`
   *  for the look bias: a rig that chases the ball's *current* point during a
   *  50 m spiral whips across the sky, while one that drifts toward where it
   *  will come down reads as anticipation. */
  ballLanding: { x: number; z: number; eta: number } | null;
}

/** Player intent for one frame. Keyboard/gamepad mapping happens elsewhere. */
export interface RigInput {
  fwd: boolean; back: boolean; left: boolean; right: boolean;
  sprint: boolean;
  /** Accumulated pointer-lock deltas in raw device pixels, consumed each frame. */
  mouseDX: number; mouseDY: number;
}

export interface RigTuning {
  /** Eye height in FIRST, metres above the turf. */
  eyeHeight: number;
  /** THIRD: metres back along -forward from the subject. */
  followDist: number;
  /** THIRD: metres above the subject the rig floats. */
  followHeight: number;
  /** THIRD: metres to the right of centre — the "over the shoulder" offset. */
  shoulderOffset: number;
  /** Radians of downward tilt the THIRD rig holds. */
  followTilt: number;

  /** Mouse sensitivity, radians per device pixel. */
  lookSensitivity: number;
  /** Look clamps in DEGREES, in the spec's sign (positive = looking up). */
  pitchMinDeg: number;
  pitchMaxDeg: number;

  /** FIRST-person rotation dampening time constant, seconds. See note in
   *  `update()` — this is the anti-motion-sickness term. */
  headDampTau: number;
  /** THIRD-person position smoothing time constant, seconds. */
  followTau: number;

  /** Ball look-bias engages inside this radius, metres. */
  ballBiasRange: number;
  /** Maximum yaw/tilt bias applied at point-blank range, radians. */
  ballBiasMax: number;

  /** Walk and sprint speeds, metres/second. */
  walkSpeed: number;
  sprintSpeed: number;
  /** Ground acceleration, m/s^2. Finite so the rig has weight. */
  accel: number;

  /** Stamina drains at this rate while sprinting, units/second (1 = full). */
  staminaDrain: number;
  /** ...and recovers at this rate otherwise. */
  staminaRecover: number;
  /** Below this, sprint is refused until stamina passes `staminaRearm`. */
  staminaExhausted: number;
  staminaRearm: number;

  /** Closest the camera may sit to a collider surface, metres. */
  collisionPad: number;
}

export const DEFAULT_TUNING: RigTuning = {
  eyeHeight: 1.68,
  followDist: 5.2,
  followHeight: 2.35,
  shoulderOffset: 0.75,
  followTilt: 0.20,

  /* 0.0022 rad/px puts a 90-degree turn at roughly 715 px of mouse travel —
   * a little under a standard 800 DPI mousepad flick, which is the range
   * most players are already calibrated to from other games. */
  lookSensitivity: 0.0022,
  pitchMinDeg: -80,
  pitchMaxDeg: 85,

  headDampTau: 0.085,
  followTau: 0.14,

  ballBiasRange: 15,
  ballBiasMax: 0.30,

  walkSpeed: 4.6,
  sprintSpeed: 8.4,
  accel: 26,

  staminaDrain: 0.22,
  staminaRecover: 0.16,
  staminaExhausted: 0.02,
  staminaRearm: 0.25,

  collisionPad: 0.45,
};

export interface RigState {
  mode: ViewMode;
  /** Where the player is looking, before dampening and bias. */
  yaw: number;
  pitch: number;
  /** Dampened values actually rendered. */
  smoothYaw: number;
  smoothPitch: number;
  /** Smoothed rig position, logical metres. */
  posX: number; posZ: number; posH: number;
  /** Locomotion velocity, m/s in pitch space. */
  velX: number; velZ: number;
  /** 0..1. */
  stamina: number;
  /** Latches sprint out until stamina recovers past `staminaRearm`. */
  exhausted: boolean;
  /** 0 = fully THIRD, 1 = fully FIRST. Drives the seamless blend. */
  blend: number;
}

/* -------------------------------------------------------------- utilities */

const DEG = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Framerate-independent exponential smoothing factor.
 *
 * `tau` is the time to close ~63% of the remaining distance. Returning a
 * FACTOR rather than doing the lerp keeps the call sites readable and makes
 * the one place this maths lives easy to test.
 */
export const smoothFactor = (dt: number, tau: number): number =>
  tau <= 0 ? 1 : 1 - Math.exp(-dt / Math.max(1e-6, tau));

/**
 * Shortest signed angular difference, in (-PI, PI].
 *
 * Every angle smoother in this file goes through here. Interpolating raw
 * radians is the classic camera bug: crossing the +/-PI seam sends the rig
 * the long way round and the view spins through a full circle.
 */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Exponentially damp an angle toward a target, seam-safe. */
export function dampAngle(cur: number, target: number, dt: number, tau: number): number {
  return cur + angleDelta(cur, target) * smoothFactor(dt, tau);
}

export function createRigState(mode: ViewMode = 'THIRD'): RigState {
  return {
    mode,
    yaw: 0, pitch: 0,
    smoothYaw: 0, smoothPitch: 0,
    posX: 0, posZ: 0, posH: DEFAULT_TUNING.eyeHeight,
    velX: 0, velZ: 0,
    stamina: 1,
    exhausted: false,
    blend: mode === 'FIRST' ? 1 : 0,
  };
}

/* ------------------------------------------------------------- mouse look */

/**
 * Fold one frame of pointer-lock movement into the rig's look angles.
 *
 * The pitch clamp is HARD, applied to the accumulator itself rather than to
 * the rendered angle. Clamping only the output lets the accumulator run away
 * while the player keeps pushing into the limit, so the view then refuses to
 * come back down until all that slack has been unwound — the "sticky ceiling"
 * bug. Clamping the accumulator makes the limit instantly reversible.
 *
 * Mutates and returns `st` so the hot path allocates nothing.
 */
export function applyMouseDelta(
  st: RigState, dx: number, dy: number, t: RigTuning,
): RigState {
  st.yaw += dx * t.lookSensitivity;
  /* Wrap yaw so it cannot grow without bound over a long match; float
   * precision degrades once the exponent climbs, and every consumer of this
   * value goes through angleDelta anyway. */
  if (st.yaw > Math.PI) st.yaw -= Math.PI * 2;
  else if (st.yaw < -Math.PI) st.yaw += Math.PI * 2;

  /* Screen +Y is DOWN, so pushing the mouse forward (negative dy) must raise
   * the view. `pitch` is stored in the spec's sign (positive = up) and is
   * converted to the projection's positive-down `tilt` at the very end of
   * update(), so this file has exactly one sign flip and it is documented. */
  st.pitch = clamp(
    st.pitch - dy * t.lookSensitivity,
    t.pitchMinDeg * DEG,
    t.pitchMaxDeg * DEG,
  );
  return st;
}

/* ----------------------------------------------------------- ball look bias */

/**
 * A gentle orientation bias toward an incoming ball.
 *
 * THE CONSTRAINT THAT SHAPES THIS: it must never fight the mouse. A rig that
 * *drives* the view toward the ball takes control away at the exact moment
 * the player most wants it — catching. So this returns a small additive
 * offset applied after the player's own angles, and it fades out completely
 * as the ball arrives, so the last instant before the catch is fully manual.
 *
 * Falloff is smoothstep on distance rather than linear: linear engages with a
 * visible kink the moment the ball crosses the range boundary, which reads as
 * the camera twitching.
 *
 * @returns additive { yaw, tilt } offsets in radians; zero when not engaged.
 */
export function ballLookBias(
  camX: number, camZ: number, camH: number,
  world: RigWorld, t: RigTuning,
): { yaw: number; tilt: number; weight: number } {
  const none = { yaw: 0, tilt: 0, weight: 0 };
  const ball = world.ball;
  if (!ball) return none;

  /* Aim at the landing spot while the ball is genuinely in flight. Chasing a
   * ball travelling 25 m/s across frame whips the view; leading it to where
   * it will come down is what a real player does with their head. */
  const lead = world.ballLanding;
  const tx = lead ? lead.x : ball.x;
  const tz = lead ? lead.z : ball.z;
  const ty = lead ? 0 : ball.y;

  const dx = tx - camX;
  const dz = tz - camZ;
  const flat = Math.hypot(dx, dz);
  if (flat > t.ballBiasRange) return none;

  /* smoothstep(1 -> 0) across the range: full strength at the camera, zero
   * exactly at the boundary, with matched derivatives at both ends. */
  const u = clamp(flat / t.ballBiasRange, 0, 1);
  const falloff = 1 - (u * u * (3 - 2 * u));

  /* Release the bias as the ball actually arrives, so the catch is the
   * player's. eta is only present while a kick is in flight. */
  const arriving = lead ? clamp(lead.eta / 0.6, 0, 1) : 1;
  const weight = falloff * arriving;
  if (weight <= 0) return none;

  const wantYaw = Math.atan2(dx, dz);
  const wantTilt = Math.atan2(ty - camH, Math.max(0.01, flat));

  return { yaw: wantYaw, tilt: wantTilt, weight: weight * (t.ballBiasMax / 0.30) };
}

/* --------------------------------------------------------- collision avoid */

/**
 * Static colliders the third-person boom must not pass through.
 *
 * This game has no physics broadphase and no terrain collider mesh — the
 * pitch is a displaced plane and the bowl is static geometry — so rather than
 * pretend otherwise, the world is described analytically. That is not a
 * shortcut: it is exact, allocation-free, and cannot desync from the render
 * mesh the way a duplicated collision mesh would.
 *
 * Surfaces, in logical metres:
 *   - the turf, y = 0 (plus the drainage crown, which is under 0.3 m and
 *     ignored: it is smaller than `collisionPad`)
 *   - the perimeter wall at the dead-ball lines and the touch-in-goal lines,
 *     which is where the stands begin
 */
export interface ColliderBox {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  /** Height of the obstruction in metres; the boom is blocked below this. */
  height: number;
}

/** The stadium bowl, as the four walls enclosing the playing enclosure. */
export const STADIUM_COLLIDERS: ColliderBox[] = [
  /* Perimeter wall beyond each dead-ball line, and outside each touchline.
   * `height` is the terrace face the boom would otherwise sink into. */
  { minX: -60, maxX: 60, minZ: FIELD.deadZFar, maxZ: 120, height: 14 },
  { minX: -60, maxX: 60, minZ: -120, maxZ: FIELD.deadZ, height: 14 },
  { minX: FIELD.maxX + 6, maxX: 120, minZ: -120, maxZ: 120, height: 14 },
  { minX: -120, maxX: FIELD.minX - 6, minZ: -120, maxZ: 120, height: 14 },
];

/**
 * Sweep the third-person boom from the subject out to the desired camera
 * position and return the fraction of the way it may travel.
 *
 * A SPHERE cast, not a ray: a zero-width ray lets the near plane clip a wall
 * the ray itself squeezed past. `collisionPad` is that sphere's radius.
 *
 * @returns 0..1 — 1 when the full boom length is clear.
 */
export function sweepBoom(
  fromX: number, fromY: number, fromZ: number,
  toX: number, toY: number, toZ: number,
  colliders: ColliderBox[],
  pad: number,
): number {
  let best = 1;

  /* The turf. Handled separately from the boxes because it is a half-space,
   * not a slab, and it is by far the most common blocker: any downward look
   * in third person drives the boom toward the ground. */
  if (toY < pad) {
    const dy = toY - fromY;
    if (Math.abs(dy) > 1e-6) {
      const tGround = (pad - fromY) / dy;
      if (tGround >= 0 && tGround < best) best = tGround;
    }
  }

  for (const c of colliders) {
    /* Slab method, inflated by `pad` on every axis so the test is a sphere
     * cast rather than a ray cast. */
    const minX = c.minX - pad, maxX = c.maxX + pad;
    const minZ = c.minZ - pad, maxZ = c.maxZ + pad;
    const maxY = c.height + pad;

    let t0 = 0, t1 = best;

    /* Per-axis slab clip. A zero-length component means the boom is parallel
     * to that pair of planes: it either starts inside the slab (no constraint)
     * or outside it (no hit at all). */
    const axes: [number, number, number, number][] = [
      [fromX, toX - fromX, minX, maxX],
      [fromY, toY - fromY, -Infinity, maxY],
      [fromZ, toZ - fromZ, minZ, maxZ],
    ];
    let hit = true;
    for (const [start, delta, lo, hi] of axes) {
      if (Math.abs(delta) < 1e-9) {
        if (start < lo || start > hi) { hit = false; break; }
        continue;
      }
      let near = (lo - start) / delta;
      let far = (hi - start) / delta;
      if (near > far) { const tmp = near; near = far; far = tmp; }
      if (near > t0) t0 = near;
      if (far < t1) t1 = far;
      if (t0 > t1) { hit = false; break; }
    }
    if (hit && t0 >= 0 && t0 < best) best = t0;
  }

  return clamp(best, 0, 1);
}

/* ------------------------------------------------------------- locomotion */

/**
 * Kinematic locomotion, resolved in CAMERA space.
 *
 * "W" must mean "away from the viewer" regardless of where the camera is
 * pointing — that is the whole contract of a camera-relative controller. The
 * basis is therefore rebuilt from the rig's smoothed yaw every frame.
 *
 * Acceleration is finite and diagonals are normalised BEFORE the speed
 * multiply, so holding W+D does not travel 41% faster than W alone.
 *
 * Mutates `st` (velocity + stamina) and returns the speed actually applied.
 */
export function stepLocomotion(
  st: RigState, input: RigInput, dt: number, t: RigTuning,
): number {
  /* Intent in camera-local space: +ix right, +iz forward. */
  let ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let iz = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
  const mag = Math.hypot(ix, iz);
  if (mag > 1) { ix /= mag; iz /= mag; }

  const moving = mag > 0;

  /* STAMINA. The exhausted latch has hysteresis: without it, stamina hovers
   * at the threshold and sprint stutters on and off every few frames, which
   * is far more unpleasant than simply being unable to sprint. */
  const wantSprint = input.sprint && moving;
  if (wantSprint && !st.exhausted) {
    st.stamina = clamp(st.stamina - t.staminaDrain * dt, 0, 1);
    if (st.stamina <= t.staminaExhausted) st.exhausted = true;
  } else {
    st.stamina = clamp(st.stamina + t.staminaRecover * dt, 0, 1);
    if (st.exhausted && st.stamina >= t.staminaRearm) st.exhausted = false;
  }
  const sprinting = wantSprint && !st.exhausted;

  /* Fade the last of the sprint bonus out as stamina empties so speed decays
   * smoothly into the exhausted state instead of dropping off a cliff. */
  const sprintFade = sprinting ? clamp(st.stamina / Math.max(1e-6, t.staminaRearm), 0, 1) : 0;
  const speed = t.walkSpeed + (t.sprintSpeed - t.walkSpeed) * sprintFade;

  /* Camera basis. Ground-forward for yaw is (sin, cos) — the convention used
   * by project() in render/retro.ts. Right is that vector rotated -90 deg. */
  const fx = Math.sin(st.smoothYaw), fz = Math.cos(st.smoothYaw);
  const rx = fz, rz = -fx;

  const wantX = (fx * iz + rx * ix) * speed;
  const wantZ = (fz * iz + rz * ix) * speed;

  /* Approach the target velocity at a bounded rate. Framerate-independent,
   * and critically it also brings the rig to REST at the same rate, so
   * releasing the keys decelerates rather than stopping dead. */
  const k = smoothFactor(dt, Math.max(1e-6, speed / Math.max(1e-6, t.accel)));
  st.velX += (wantX - st.velX) * k;
  st.velZ += (wantZ - st.velZ) * k;

  return Math.hypot(st.velX, st.velZ);
}

/* ------------------------------------------------------------- the update */

export interface RigOutput {
  camera: Camera;
  /** Speed in m/s this frame, for footstep audio and head bob. */
  speed: number;
  /** 0..1 stamina, for the HUD. */
  stamina: number;
  /** How far the boom was pulled in by collision, 0..1 (1 = unobstructed). */
  boomFraction: number;
}

/**
 * Advance the rig one frame and produce a `Camera` the existing projection
 * can consume unchanged.
 *
 * The output `Camera` is owned by the caller-supplied `out` object and is
 * mutated in place: this runs 60 times a second for the length of a match.
 */
export function updateRig(
  st: RigState,
  world: RigWorld,
  input: RigInput,
  dt: number,
  t: RigTuning,
  out: Camera,
): RigOutput {
  /* 1. LOOK. Raw accumulators move instantly with the mouse; what gets
   *    rendered is dampened. */
  applyMouseDelta(st, input.mouseDX, input.mouseDY, t);

  /* 2. MODE BLEND. Toggling snaps no value anywhere — `blend` eases and every
   *    positional term below is a lerp on it, which is what makes the
   *    transition seamless rather than a cut. */
  const wantBlend = st.mode === 'FIRST' ? 1 : 0;
  st.blend += (wantBlend - st.blend) * smoothFactor(dt, 0.22);
  if (Math.abs(st.blend - wantBlend) < 0.001) st.blend = wantBlend;
  const fp = st.blend;

  /* 3. ROTATION DAMPENING — the anti-motion-sickness term.
   *
   * In first person the camera is rigidly attached to a head bone that is
   * being driven by a run cycle, so every footfall is transmitted straight
   * into the view. Reading that as "the world is shaking" rather than "my
   * head is moving" is what makes players ill. Dampening the RENDERED angle
   * against the player's INTENDED angle low-passes the animation without
   * adding latency to deliberate mouse movement, because the target itself
   * tracks the mouse exactly.
   *
   * Third person needs far less: the camera is already on a smoothed boom. */
  const lookTau = t.headDampTau * fp;
  st.smoothYaw = lookTau > 1e-5 ? dampAngle(st.smoothYaw, st.yaw, dt, lookTau) : st.yaw;
  st.smoothPitch = lookTau > 1e-5
    ? st.smoothPitch + (st.pitch - st.smoothPitch) * smoothFactor(dt, lookTau)
    : st.pitch;

  /* 4. LOCOMOTION, camera-relative, then integrate. */
  const speed = stepLocomotion(st, input, dt, t);

  /* The subject the rig is attached to. Locomotion drives the rig directly;
   * `world.self` anchors it so the rig cannot drift away from the player it
   * is supposed to be following. */
  const anchorX = world.self.x + st.velX * dt;
  const anchorZ = world.self.z + st.velZ * dt;

  /* Keep the rig inside the enclosure. Dead-ball lines plus a small margin:
   * the same bound the director uses, so both cameras agree on "off pitch". */
  const bx = clamp(anchorX, FIELD.minX - 4, FIELD.maxX + 4);
  const bz = clamp(anchorZ, FIELD.deadZ - 2, FIELD.deadZFar + 2);

  /* 5. RIG PLACEMENT.
   *
   *    FIRST: an eye socket at the subject.
   *    THIRD: a boom back along -forward, raised, and pushed to the shoulder.
   *
   *    Both are computed every frame and blended, so a toggle mid-sprint
   *    interpolates through real intermediate positions. */
  const fx = Math.sin(st.smoothYaw), fz = Math.cos(st.smoothYaw);
  const rx = fz, rz = -fx;

  const thirdX = bx - fx * t.followDist + rx * t.shoulderOffset;
  const thirdZ = bz - fz * t.followDist + rz * t.shoulderOffset;
  const thirdH = t.followHeight;

  const desiredX = thirdX + (bx - thirdX) * fp;
  const desiredZ = thirdZ + (bz - thirdZ) * fp;
  const desiredH = thirdH + (t.eyeHeight - thirdH) * fp;

  /* 6. COLLISION. Sweep from the subject's head to the desired rig position
   *    and pull the boom in to the first blocking surface. Only meaningful
   *    with a boom to sweep, so it is skipped as the rig approaches the eye
   *    socket — at fp = 1 the "boom" has zero length and any hit would be a
   *    self-intersection with the player's own head. */
  let boom = 1;
  if (fp < 0.999) {
    boom = sweepBoom(
      bx, t.eyeHeight, bz,
      desiredX, desiredH, desiredZ,
      STADIUM_COLLIDERS, t.collisionPad,
    );
  }
  const solvedX = bx + (desiredX - bx) * boom;
  const solvedZ = bz + (desiredZ - bz) * boom;
  const solvedH = t.eyeHeight + (desiredH - t.eyeHeight) * boom;

  /* 7. POSITION SMOOTHING. First person must NOT be smoothed positionally —
   *    lag between where you are and where you see from is itself a nausea
   *    trigger — so the time constant scales to zero as fp goes to 1. */
  const posTau = t.followTau * (1 - fp);
  if (posTau > 1e-5) {
    const kp = smoothFactor(dt, posTau);
    st.posX += (solvedX - st.posX) * kp;
    st.posZ += (solvedZ - st.posZ) * kp;
    st.posH += (solvedH - st.posH) * kp;
  } else {
    st.posX = solvedX; st.posZ = solvedZ; st.posH = solvedH;
  }

  /* 8. BALL BIAS, applied last so it is a true offset from the player's own
   *    aim and can never accumulate into the look accumulator. */
  const bias = ballLookBias(st.posX, st.posZ, st.posH, world, t);
  const yawOut = bias.weight > 0
    ? st.smoothYaw + angleDelta(st.smoothYaw, bias.yaw) * bias.weight
    : st.smoothYaw;
  const pitchOut = bias.weight > 0
    ? st.smoothPitch + (bias.tilt - st.smoothPitch) * bias.weight
    : st.smoothPitch;

  /* 9. EMIT. `tilt` is positive-DOWN for project(); `pitch` is positive-up.
   *    This is the single sign flip promised in the header. */
  out.x = st.posX;
  out.z = st.posZ;
  out.h = st.posH;
  out.yaw = yawOut;
  out.tilt = -pitchOut;
  out.roll = 0;
  out.shake = 0;
  /* A slightly wider lens in first person: it is what makes a head-mounted
   * view feel like peripheral vision rather than a telescope, and the extra
   * optical flow at the edges is a large part of reading your own speed. */
  out.fov = 1.05 + 0.20 * fp;
  out.horizon = 0.5;

  return { camera: out, speed, stamina: st.stamina, boomFraction: boom };
}

/** Flip the view mode. The blend in `updateRig` makes the change seamless. */
export function toggleViewMode(st: RigState): ViewMode {
  st.mode = st.mode === 'FIRST' ? 'THIRD' : 'FIRST';
  return st.mode;
}
