/**
 * T-03 — ENGINE/CAMERA. Extracted verbatim from director.ts: shot selection,
 * the cable rig, and the easing. No behaviour change — the module takes a
 * Director reference (never a copy of state) and every write lands on the
 * same camera object the renderer reads.
 *
 * The camera reacts to causes through the frameEvents bus (T-08): a line
 * break holds the breakaway framing for 2.5 s, a tackle punches the lens in,
 * a try or a card holds the subject while the moment is alive.
 */

import type { Director } from '../director';
import { Camera, View, FIELD } from '../../render/retro';
import { CamModeSpec, camModeSpec, resolveZoom } from '../camera';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function updateCamera(d: Director, dt: number) {
  const f = d.focusPoint();
  const dir = d.possession === 'A' ? 1 : -1;

  for (const ev of d.frameEvents) {
    if (ev.type === 'LINE_BREAK') d.breakawayT = 2.5;
    else if (ev.type === 'TACKLE') d.impactT = Math.max(d.impactT, 0.35 + ev.force * 0.5);
    else if (ev.type === 'TRY') d.holdP = { x: ev.x, z: ev.z, t: 2.6 };
    else if (ev.type === 'CARD') d.holdP = { x: ev.x, z: ev.z, t: 2.2 };
  }
  d.breakawayT = Math.max(0, d.breakawayT - dt);
  d.impactT = Math.max(0, d.impactT - dt);
  if (d.holdP) { d.holdP.t -= dt; if (d.holdP.t <= 0) d.holdP = null; }

  /* OVER THE SHOULDER ON EVERY KICK.
   * While a kick is being set up the rig drops in behind the kicker at head
   * height, so the aim line reads as his line of sight. It returns to the
   * chosen mode the moment the ball is struck. */
  // The cable cam handles kicks itself by backing off and climbing, so it must
  // not be overridden. Every other mode drops to the shoulder view for a kick.
  const kicking = !!d.kk && (d.kk.stage === 'AIM' || d.kk.stage === 'METER')
    && d.camMode !== 'CABLE';
  const spec = camModeSpec(kicking ? 'SHOULDER' : d.camMode);

  const z = resolveZoom(d.camZoom, d.dynamicIntensity, {
    phase: d.phase,
    pressure: d.op?.pressure ?? 0,
    toLine: d.op?.toLine ?? 50,
    ballInAir: d.kk?.stage === 'FLIGHT',
    lineBreak: d.op?.lineBreak === true,
  });

  // Subject: the ball, pulled slightly toward the first receiver in open play
  // so the fly-half is always in shot, and toward the landing point on a kick.
  let tx = f.x, tz = f.z;
  if (d.op) {
    const first = d.L(d.op.attacking, 10);
    if (first) { tx = f.x * 0.72 + first.x * 0.28; tz = f.z * 0.82 + first.z * 0.18; }
  }
  if (d.kk && d.kk.stage === 'FLIGHT') { tx = d.kk.bx; tz = d.kk.bz; }

  /* T-08 — the framing reacts to causes:
   *  - a LIVE hold (try celebration, card) locks the subject on the moment;
   *  - a breakaway pushes the aim ahead of the play and lifts the rig, so
   *    the break AND the cover chase read in one shot for its whole length;
   *  - a tackle punches the lens in a touch for under a second (non-cable
   *    rigs only — the cable rig owns its own zoom through resolveZoom). */
  if (d.holdP) { tx = d.holdP.x; tz = d.holdP.z; }
  if (d.breakawayT > 0) {
    tz += dir * Math.min(3.5, d.breakawayT * 1.5);
    tx = tx * 0.9 + f.x * 0.1;
  }

  const view: View = { w: 960, h: 540 };
  let height = spec.height * z.heightMul;
  let px = spec.pxPerMetre * z.pxMul;
  if (d.breakawayT > 0) height *= 1 + Math.min(0.14, d.breakawayT * 0.06);
  if (d.impactT > 0 && spec.id !== 'CABLE') px *= 1 + Math.min(0.12, d.impactT * 0.14);
  let target: Camera;

  if (spec.id === 'CABLE') {
    target = cableRig(d, view, spec, z, tx, tz, dir, dt);
  } else if (spec.endOn) {
    /* END-ON RIGS. The camera sits behind a point and looks down the pitch.
     * Built by hand rather than through behindPostsCam so the shoulder view can
     * sit right on the kicker instead of on the goal line. */
    const isPosts = !kicking && d.camMode === 'POSTS';
    const back = spec.standback * z.standbackMul;
    const rigX = isPosts ? tx * 0.25 : tx - (tx - (d.kk?.landX ?? tx)) * 0.08;
    const rigZ = isPosts
      ? (dir > 0 ? FIELD.tryZ - 10 : FIELD.tryZFar + 10)
      : tz - dir * back;
    const aimX = kicking ? (d.kk?.landX ?? tx) : tx;
    const aimZ = kicking ? (d.kk?.landZ ?? tz) : tz + dir * 14;
    const dx = aimX - rigX;
    const dz = aimZ - rigZ;
    const ground = Math.max(4, Math.hypot(dx, dz));
    const tilt = Math.atan2(height - 1.4, ground);
    const slant = Math.hypot(ground, height - 1.4);
    const focal = Math.max(1, px * slant);
    target = {
      x: rigX, z: rigZ, h: height,
      yaw: Math.atan2(dx, dz),
      tilt,
      fov: clamp(2 * Math.atan((view.h * 0.5) / focal), 0.06, 1.2),
      shake: 0, horizon: 0.46, roll: 0,
    };
  } else {
    /* TOUCHLINE RIG, built directly.
     *
     * THE BUG THAT SENT THE CAMERA OFF THE RAILS: gantryCam computed the yaw
     * from its own assumed rig position, and then this code moved the rig
     * sideways to pan with the ball — leaving the camera looking in a
     * direction that no longer pointed at anything. The further it panned the
     * worse it got. Everything is now solved from one rig position.
     */
    const standback = spec.standback * z.standbackMul;
    const subjectZ = tz + spec.lead * dir;

    // Longitudinal tracking with a dead zone, so the rig does not jitter.
    const dead = Math.max(0.4, spec.deadZone * (1.4 - z.track));
    if (Math.abs(subjectZ - d.rigZ) > dead) {
      d.rigZ += (subjectZ - d.rigZ) * clamp(Math.abs(subjectZ - d.rigZ) / 8, 0.2, 1);
    }
    // Lateral pan. At 4x the rig comes a long way onto the ball; at 1x it sits
    // off the touchline and lets the lens do the work.
    const rigX = (FIELD.minX - standback) + (tx - FIELD.minX) * z.track * 0.34;

    const dx = tx - rigX;
    const dz = subjectZ - d.rigZ;
    const ground = Math.max(4, Math.hypot(dx, dz));
    const tiltT = Math.atan2(height - 1.4, ground);
    const slant = Math.hypot(ground, height - 1.4);
    const focal = Math.max(1, px * slant);
    target = {
      x: rigX, z: d.rigZ, h: height,
      // Yaw now genuinely points from the rig at the ball, plus a small
      // down-field angle so players running away are seen from behind.
      yaw: Math.atan2(dx, dz) + (14 * Math.PI) / 180 * (dir >= 0 ? 1 : -1),
      tilt: tiltT,
      fov: clamp(2 * Math.atan((view.h * 0.5) / focal), 0.06, 1.2),
      shake: 0, horizon: 0.44, roll: 0,
    };
  }

  // NaN guard. A single bad number here sent the rig off the field and took
  // the whole frame with it. If anything is not finite, keep the last good rig.
  if (![target.x, target.z, target.h, target.yaw, target.tilt, target.fov].every(Number.isFinite)) {
    target = { ...d.cam, shake: 0 };
  }

  /* A heavy rig eases; it never snaps. This is what stops the whipping.
   * T-18: but a phase cut (dead ball → 22 drop-out, score → restart) moves
   * the subject up to 50 m. At rate 3 the rig took two seconds to arrive and
   * the ball spent the whole transit out of frame. Position, height, tilt
   * and zoom reposition quickly — none of them touch the picture angle —
   * while YAW always eases slowly: the whip gate is about angular judder,
   * and a phase cut barely changes the yaw anyway. */
  const dist = Math.hypot(target.x - d.cam.x, target.z - d.cam.z);
  /* T-18. The old 12 m "far" threshold held the ease at rate 3 until the
   * subject was twelve metres away — a carrier at full pace (8 m/s) sat
   * near the bottom edge of frame for two seconds at a time and the
   * ball-on-screen gate flaked on one match in six. Rate 3 only inside
   * six metres (broadcast drift), rate 8 beyond it: the rig keeps up with
   * anything a rugby player can do. */
  const far = dist > 6;
  /* Cap the per-frame travel at 5.5 m: the cut is fast but the rig is still
   * a rig — it never moves more than a real gantry could survive. */
  const kPos = Math.min(1 - Math.exp(-dt * (far ? 8 : 3.0)), dist > 0.01 ? 5.5 / dist : 1);
  const kZoom = 1 - Math.exp(-dt * (far ? 7 : 2.2));
  const kYaw = 1 - Math.exp(-dt * 3.0);
  d.cam.x += (target.x - d.cam.x) * kPos;
  d.cam.z += (target.z - d.cam.z) * kPos;
  d.cam.h += (target.h - d.cam.h) * kZoom;
  let dy = target.yaw - d.cam.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  d.cam.yaw += dy * kYaw;
  d.cam.tilt += (target.tilt - d.cam.tilt) * kZoom;
  d.cam.fov += (target.fov - d.cam.fov) * kZoom;
  d.cam.horizon = target.horizon;
  d.cam.shake = d.shakeT;
  d.zoomLabel = z.label;
  /* T-20. A hard floor on every rig. No camera may sit lower than 5.5 m, which
   * is above the advertising boards and the front terrace, so nothing can ever
   * clip through the ground even mid-swing. */
  d.cam.h = Math.max(5.5, d.cam.h);
  if (!Number.isFinite(d.cam.h)) d.cam.h = 14;
}

/**
 * THE CABLE CAM. The rig hangs on notional wires, so it has mass. It does not
 * snap to the ball; it is dragged toward a point behind the ball and swings
 * in behind.
 */
export function cableRig(
  d: Director,
  view: View, spec: CamModeSpec, z: { pxMul: number; heightMul: number; standbackMul: number; track: number },
  tx: number, tz: number, dir: number, dt: number,
): Camera {
  const k = d.kk;
  const inFlight = k?.stage === 'FLIGHT';
  const aiming = k?.stage === 'AIM' || k?.stage === 'METER';

  // Lock the end-on side unless the player asked it to swap on turnover.
  const rigDir = d.cableSwapOnTurnover ? dir : 1;

  /* On a kick the rig backs off and climbs so the flight and the chase are
   * both in frame. `cableEase` ramps that in and out rather than snapping. */
  const wantKickWide = inFlight || aiming ? 1 : 0;
  d.cableEase += (wantKickWide - d.cableEase) * (1 - Math.exp(-dt * 1.8));
  const wide = d.cableEase;

  // Where the rig wants to be: behind the ball, along the attacking axis.
  const trail = spec.standback * z.standbackMul * (1 + wide * 0.85);
  const height = spec.height * z.heightMul * (1 + wide * 0.7);

  /* While the ball is in the air, sit between the ball and where it will land
   * so both are framed. Otherwise anchor on the ball itself.
   *
   * T-16/NO-WHIP: the anchor TARGET jumps twice — at the strike (ball to
   * midpoint-with-landing) and at the first bounce (prediction vanishes,
   * anchor returns to the ball). Aiming the rig at a jumping target swung
   * the yaw several degrees in one frame. The anchor is now eased like every
   * other axis, so the rig glides to the new subject instead of whipping. */
  let anchorX = tx, anchorZ = tz;
  if (inFlight) {
    const lp = d.landingPrediction();
    if (lp) { anchorX = (tx + lp.x) / 2; anchorZ = (tz + lp.z) / 2; }
  }
  d.cableAX += (anchorX - d.cableAX) * (1 - Math.exp(-dt * (inFlight ? 3.0 : 4.5)));
  d.cableAZ += (anchorZ - d.cableAZ) * (1 - Math.exp(-dt * (inFlight ? 3.0 : 4.5)));
  anchorX = d.cableAX;
  anchorZ = d.cableAZ;

  const wantX = anchorX * 0.82;                 // ease toward the middle laterally
  const wantZ = anchorZ - rigDir * trail;

  // Independent easing per axis. Lateral is quickest so the pan tracks the
  // ball across the field; height is slowest so the rig never bobs.
  // In flight the lateral rate is boosted by the wide factor: a full-range
  // touch-finder moves at 20+ m/s and the rig must keep it framed.
  d.cableX += (wantX - d.cableX) * (1 - Math.exp(-dt * (2.6 + wide * 2.4) * (0.6 + z.track * 0.8)));
  d.cableZ += (wantZ - d.cableZ) * (1 - Math.exp(-dt * 2.0));
  d.cableH += (height - d.cableH) * (1 - Math.exp(-dt * 1.4));

  // T-20 CLIPPING. The rig used to drift 24 m past the dead-ball line into the
  // rising terraces, where a 7 m camera sat BELOW the stand surface and clipped
  // through the ground. Keep it inside the in-goal and above every surface.
  d.cableX = clamp(d.cableX, -30, 30);
  d.cableZ = clamp(d.cableZ, FIELD.tryZ - 8, FIELD.tryZFar + 8);
  d.cableH = clamp(d.cableH, 9, 46);

  /* Look at a point ahead of the ball, so the frame leads play instead of
   * trailing it. The rig is always end-on: it looks the way you attack. */
  const aimX = anchorX;
  const aimZ = anchorZ + rigDir * spec.lead * (1 + wide * 0.6);
  const dx = aimX - d.cableX;
  const dz = aimZ - d.cableZ;
  const ground = Math.max(5, Math.hypot(dx, dz));

  // Tilt down onto the play. Extra downward angle when wide, so a kick reads
  // as an aerial view of the whole contest.
  const tilt = Math.atan2(d.cableH - 1.2, ground) * (1 + wide * 0.10);
  const slant = Math.hypot(ground, d.cableH - 1.2);
  const px = spec.pxPerMetre * z.pxMul * (1 - wide * 0.28);
  const focal = Math.max(1, px * slant);

  return {
    x: d.cableX, z: d.cableZ, h: d.cableH,
    yaw: Math.atan2(dx, dz),
    tilt: clamp(tilt, 0.08, 1.15),
    fov: clamp(2 * Math.atan((view.h * 0.5) / focal), 0.06, 1.2),
    shake: 0, horizon: 0.42, roll: 0,
  };
}
