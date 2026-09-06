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
import { Camera, View, FIELD, minFollowGround } from '../../render/retro';
import { CamModeSpec, camModeSpec, resolveZoom } from '../camera';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function updateCamera(d: Director, dt: number) {
  const f = d.cameraFocus();
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

  /* One number, applied where the mode is resolved rather than where it is
   * drawn, so the retro projector and the WebGL camera cannot drift apart: both
   * read the same `d.cam` that comes out of here. See Director.camScale.
   *
   * It is NOT applied flat. Measured over six 90-second seeds, a blanket 2.2x
   * bought 2x the size of every man and cost the framing rules: UX-23 (the
   * contest must stay in shot) went 8 → 14 failures and UX-24 lit up 28 times,
   * because a tight lens in open play crops the very things those rules check —
   * the defensive line, the support runners, the receiver of a kick. A broadcast
   * operator does not do that either: they are wide while the ball travels and
   * tight when the ball is stuck. So the gain rides the same instinct the
   * dynamic zoom already uses, and the framing rules and the legibility win can
   * both be true. */
  const gain = 1 + (Math.max(0.6, Math.min(4, d.camScale || 1)) - 1) * contestK(d);
  const dolly = 1 / Math.sqrt(gain);

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
  let height = spec.height * z.heightMul * dolly;
  let px = spec.pxPerMetre * z.pxMul * gain;
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
    const back = spec.standback * z.standbackMul * dolly;
    const rigX = isPosts ? tx * 0.25 : tx - (tx - (d.kk?.landX ?? tx)) * 0.08;
    const rigZ = isPosts
      ? (dir > 0 ? FIELD.tryZ - 10 : FIELD.tryZFar + 10)
      : tz - dir * back;
    const aimX = kicking ? (d.kk?.landX ?? tx) : tx;
    const aimZ = kicking ? (d.kk?.landZ ?? tz) : tz + dir * (14 / gain);
    const dx = aimX - rigX;
    const dz = aimZ - rigZ;
    /* D-1 — height-scaled follow floor, see minFollowGround. */
    const fovE = clamp(2 * Math.atan((view.h * 0.5) / Math.max(1, px * Math.hypot(Math.max(4, Math.hypot(dx, dz)), height - 1.4))), 0.06, 1.2);
    const ground = Math.max(minFollowGround(height, fovE, 1.4), Math.hypot(dx, dz));
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
    const standback = spec.standback * z.standbackMul * dolly;
    const subjectZ = tz + (spec.lead / gain) * dir;

    // Longitudinal tracking with a dead zone, so the rig does not jitter.
    /* The dead zone is a distance, and the frame it is measured against has got
     * smaller: 2 m of slop is nothing wide and half a shot tight. */
    const dead = Math.max(0.4, spec.deadZone * (1.4 - z.track) / gain);
    if (Math.abs(subjectZ - d.rigZ) > dead) {
      d.rigZ += (subjectZ - d.rigZ) * clamp(Math.abs(subjectZ - d.rigZ) / 8, 0.2, 1);
    }
    // Lateral pan. At 4x the rig comes a long way onto the ball; at 1x it sits
    // off the touchline and lets the lens do the work.
    const rigX = (FIELD.minX - standback) + (tx - FIELD.minX) * z.track * 0.34;

    const dx = tx - rigX;
    const dz = subjectZ - d.rigZ;
    /* D-1 — the floor must scale with camera height, not be a constant.
     * A flat 4 m floor at a 13 m rig height put the ball 67 deg below
     * horizontal against a ~30 deg tilt and it fell out of the bottom of
     * frame. See minFollowGround in retro.ts. */
    const fovT = clamp(2 * Math.atan((view.h * 0.5) / Math.max(1, px * Math.hypot(Math.max(4, Math.hypot(dx, dz)), height - 1.4))), 0.06, 1.2);
    const ground = Math.max(minFollowGround(height, fovT, 1.4), Math.hypot(dx, dz));
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
  const frameK = 1 + (Math.max(0.6, Math.min(4, d.camScale || 1)) - 1) * contestK(d);
  /* "Far" is a fraction of a frame, not six metres: at a long lens six metres is
   * most of the shot, so the transit rate has to start earlier and run harder in
   * proportion to how tight the picture is. The per-frame distance cap is left
   * alone — that one is a gantry's mechanics, not a lens. */
  const far = dist > 6 / frameK;
  /* Cap the per-frame travel at 5.5 m: the cut is fast but the rig is still
   * a rig — it never moves more than a real gantry could survive. */
  const kPos = Math.min(1 - Math.exp(-dt * (far ? 8 : 3.0) * frameK), dist > 0.01 ? 5.5 / dist : 1);
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

  /* ---------------- D-1: MINIMUM FOLLOW DISTANCE ----------------
   * Applied HERE, on the eased camera, and not inside the rigs. The rigs only
   * produce a `target`; every axis is then eased toward it, so a correction
   * made upstream is silently undone within a frame or two. Measured: pushing
   * the rig back inside cableRig left 543 of 545 offending frames untouched.
   *
   * The measured fault was geometric, not a tracking failure — 239 of 266
   * failing frames had the camera WITHIN 8 m of the ball while flying 13 m
   * above it, putting the ball ~67 degrees down against a ~30 degree tilt. The
   * rig was too CLOSE, so it is slid straight back along its own view axis:
   * the yaw is unchanged by construction, which keeps the CAMERA STABLE gate
   * out of this entirely, and only the distance moves. */
  const bpD1 = d.ballPoint();
  const gx = bpD1.x - d.cam.x, gz = bpD1.z - d.cam.z;
  const gLen = Math.hypot(gx, gz);
  const needD1 = minFollowGround(d.cam.h, d.cam.fov, Math.max(0.4, bpD1.y));
  if (gLen > 0.01 && gLen < needD1) {
    const ux = gx / gLen, uz = gz / gLen;
    const push = needD1 - gLen;
    d.cam.x -= ux * push;
    d.cam.z -= uz * push;
    /* Re-solve the pitch for the distance the camera actually ended up at.
     * Leaving the old tilt would aim the flatter rig past the ball. */
    const rise = d.cam.h - Math.max(0.4, bpD1.y);
    d.cam.tilt = Math.atan2(rise, needD1);
  }
}

/**
 * THE CABLE CAM. The rig hangs on notional wires, so it has mass. It does not
 * snap to the ball; it is dragged toward a point behind the ball and swings
 * in behind.
 */
/**
 * How much of the framing gain this moment earns, 0 = keep the wide lens.
 *
 * A contest is a thing that happens in four metres of grass: a ruck, a maul, a
 * set piece, a kicker standing over a still ball. Nothing else in the game is
 * that compact, and the rules that police the picture know it.
 */
export function contestK(d: Director): number {
  /* A CONTEST IS A STUCK BALL, NOT A PHASE NAME. The single most common way to
   * break the framing rules with a tight lens is also the most exciting thing
   * that happens in a match: the ball leaves a breakdown at pace while the phase
   * tag still says BREAKDOWN, and a half-frame lens follows nothing. So the gain
   * rides the ball's own speed — come in as it is caught, go back out as it is
   * carried. Measured: without this the tighter frame cost 5 UX-23 failures
   * ("the ball is inside the frame"), which is precisely the thing the player
   * was complaining about. */
  const ballSpd = d.op ? Math.hypot(d.op.vx ?? 0, d.op.vz ?? 0) : 0;
  const release = Math.max(0.28, Math.min(1, 1.25 - ballSpd / 7));
  const p = d.phase;
  if (p === 'BREAKDOWN' || p === 'MAUL' || p === 'SCRUM' || p === 'LINEOUT') return release;
  if (d.kk) {
    /* Aim and power are still, and the ball is the subject: come in. Flight is
     * the widest shot in the game and must stay that way, and a grounded ball
     * after the bounce is a contest again. The ceremony — FANFARE, WALKUP — is
     * neither: it is the team coming out, and measuring said a tight lens there
     * only buys UX-23 failures (9 frames with the ball out of shot became 15 at
     * 2.2x), so the gain is simply not spent on it. */
    if (d.kk.stage === 'AIM' || d.kk.stage === 'METER' || d.kk.stage === 'SETUP') return 1;
    if (d.kk.stage === 'FLIGHT') return d.kk.bounces > 0 ? 0.7 : 0;
    if (d.kk.stage === 'FANFARE' || d.kk.stage === 'WALKUP') return 0;
    return 0.5;
  }
  if (d.holdP) return 1;                       // a try, a card: the moment is the subject
  if (d.impactT > 0) return 0.8 * release;     // the tackle just happened, the ground fight follows
  if (p === 'OPEN_PLAY') {
    /* A goal-line stand is a confined contest with an open-play phase tag; a
     * 40-metre counter-attack is neither, and needs the classic field. */
    const toLine = d.op?.toLine ?? 50;
    return Math.min(1, 0.18 + Math.max(0, 1 - toLine / 26) * 0.7 + (d.op?.pressure ?? 0) * 0.18);
  }
  return 0.35;
}

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
  /* T-18/UX-23 — THE LENS COMES IN WHEN THE BALL IS DOWN. The wide framing
   * is for the hang; FLIGHT also contains the bounce-and-roll, and the old
   * geometry kept the rig backed off, high and ultra-wide while a grounded
   * ball trickled away at shin height — riding the bottom edge of the
   * frame for seconds at a time. After the first bounce the wide EXTRAS
   * (trail, height, the lens widening) release by rollK and the rig closes
   * onto the contest for the ball. The hang is untouched: bounces == 0. */
  const rollK = k && inFlight && k.bounces > 0 ? 0.35 : 1;
  /* The cable rig is the shipped default view, so the framing gain has to be
   * paid here as well as in the mode branches — and paid the same way, by
   * dollying the rig in as the lens tightens. `cableH` is then floored below,
   * which keeps the rig above the terraces no matter how tight the gain. */
  const cGain = 1 + (Math.max(0.6, Math.min(4, d.camScale || 1)) - 1) * contestK(d);
  const cDolly = 1 / Math.sqrt(cGain);
  const trail = spec.standback * z.standbackMul * cDolly * (1 + wide * 0.85 * rollK);
  const height = spec.height * z.heightMul * cDolly * (1 + wide * 0.7 * rollK);

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
  /* Playtest P1.4: near the dead-ball ends the rig's ground rises into the
   * terraces — a 9 m camera at z -60 sat BELOW the stand surface and clipped
   * through it. The floor climbs with the distance past the goal line. */
  d.cableH = Math.max(d.cableH, 9 + Math.max(0, Math.abs(d.cableZ) - 47) * 0.85);

  /* Look at a point ahead of the ball, so the frame leads play instead of
   * trailing it. The rig is always end-on: it looks the way you attack.
   *
   * T-18/UX-23 — FOLLOW IT DOWN. The lead that framed the hang keeps
   * aiming PAST the ball while it descends, and the last two seconds of
   * every long kick rode the ball down the bottom edge of the frame
   * (offscreen-gate faults clustered on PUNT:FLIGHT tails). A broadcast
   * lens rides the ball down onto the catcher: as it drops, the lead
   * collapses onto the landing point. Height-scaled, so the frame leads
   * again the moment the next kick goes up. */
  const aimX = anchorX;
  const dropK = k && inFlight ? clamp(k.by / 9, 0.3, 1) : 1;
  /* THE LEAD IS EARNED BY SPEED. The aim leads the subject so a running
   * attack reads into space — but a STOPPED or crawling ball needs no lead,
   * and holding one put every grounded ruck-ball at the bottom edge of the
   * frame while the rig overtook it (the second half of the offscreen
   * faults). The lead scales with the subject's own velocity. */
  const spd = k ? Math.hypot(k.vx, k.vz) : (d.op ? Math.hypot(d.op.vx, d.op.vz) : 0);
  const leadK = clamp(0.35 + spd / 9, 0.35, 1);
  /* THE LEAD IS IN METRES AND THE FRAME IS IN PIXELS. A 9 m lead is a fifth of
   * a wide shot and three quarters of a tight one: left alone, the framing gain
   * pushes the ball out of the bottom of the frame and UX-23 ("the ball is
   * inside the frame") fails for the sake of legibility, which is the opposite
   * of what the gain is for. So the lead is divided by the same number that
   * multiplies the lens — the rig keeps leading by the same FRACTION of shot. */
  const aimZ = anchorZ + rigDir * (spec.lead / cGain) * (1 + wide * 0.6) * dropK * leadK;
  const dx = aimX - d.cableX;
  const dz = aimZ - d.cableZ;
  const pxC = spec.pxPerMetre * z.pxMul * cGain * (1 - wide * 0.28 * rollK);
  const ground = Math.max(4, Math.hypot(dx, dz));

  // Tilt down onto the play. Extra downward angle when wide, so a kick reads
  // as an aerial view of the whole contest.
  const tilt = Math.atan2(d.cableH - 1.2, ground) * (1 + wide * 0.10);
  const slant = Math.hypot(ground, d.cableH - 1.2);
  const focal = Math.max(1, pxC * slant);

  return {
    x: d.cableX, z: d.cableZ, h: d.cableH,
    yaw: Math.atan2(dx, dz),
    tilt: clamp(tilt, 0.08, 1.15),
    fov: clamp(2 * Math.atan((view.h * 0.5) / focal), 0.06, 1.2),
    shake: 0, horizon: 0.42, roll: 0,
  };
}
