/**
 * SCENE RENDERER — draws the whole match: stadium, the persistent cast of stocky
 * retro actors (depth-sorted, rig-animated), the ball, and in-world mini-game overlays.
 */
import { Director, Actor } from '../game/director';
import {
  drawStadium, project,
  drawGoalPosts, HOME_POST_Z, Camera, View,
} from './retro';
/* THE PAPERCRAFT ANIMATION SYSTEM (animationBuild handoff, verbatim files).
 * Poses/clips: clips.ts. Puppets: coronal.ts. Material/views/characters:
 * paper.ts. The engine keeps its own clip vocabulary; mapAction() below is
 * the single translation point. */
import { Pose, STAND, sampleC, lerpPose, smooth, actionClip, CLIPS } from './clips';
import { maulUseItClock, maulUseItCall } from '../game/engine/setpieces';
import { drawPaperActor, drawPaperShadow, PaperDrawArgs } from './coronal';
import {
  PALETTES, PaperView, Character, makeCharacter, makeRef,
  paperViewKey, updatePaperView, resetPaperViews, ballPaper, shadowBlob,
  upperLowerRun, squashForClip, edgeLegForeshorten, pinPlantedFoot,
  FIGURE_SCALE,
} from './paper';
import { resetFacingDebug, recordFacingDebug } from './facingDebug';

/** Screen-right vector of the camera in world terms (handoff section 5). */
function camRightOf(cam: Camera): [number, number] {
  return [Math.cos(cam.yaw), -Math.sin(cam.yaw)];
}

/* ============================ THE PUPPET PIPELINE ============================
 * Per-actor, per-frame: engine clip vocabulary -> action -> clip -> pose, with
 * seamless blends (animationBuild handoff section 4.1). State lives here, keyed
 * by team+num; the engine stays untouched. */
interface Puppet {
  clipName: string; u: number;
  pose: Pose; blendFrom: Pose | null; blendT: number; blendDur: number;
  face: number;                 // true heading, radians (derived from velocity)
  lx: number; lz: number;       // last position — velocity is derived per frame
  spd: number;
  runU: number;                 // SPEC_01 — separate cadence-locked gait phase for the running pass
  hold: string | null;          // forced action (get-up) with a cycle countdown
  holdT: number;
  lie: boolean;                 // sequenced into the lying hold
  ch: Character; seed: number;
  /* SPEC_06 — facing/strafe debug readouts (read-only, for the overlay). */
  lat: number;                  // lateral velocity relative to facing (m/s)
  view: PaperView;              // paper side currently shown this frame
  /* SPEC_06 — gait hysteresis state (which locomotion state is being held). */
  gait: string;
}
const puppets = new Map<string, Puppet>();
let lastDirector: Director | null = null;

const clamp01p = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ---- SPEC_06 — GAIT HYSTERESIS (Machine 1) ----
 * The reviewed dead bands from SPEC_06_HYSTERESIS_TABLE.md. Entry is the outer
 * bound (a state only leaves when the signal crosses OUT); leave is the inner
 * bound (a signal on the line does not re-enter). Applied to the two gate
 * families that triggered the jarring: the forward speed ladder (idle/walk/jog/
 * run/sprint) and the lateral shuffle/strafe split. */
const GAIT_DEAD = {
  walkEnter: 0.7, walkLeave: 0.45,
  jogEnter: 1.6, jogLeave: 1.25,
  runEnter: 3.6, runLeave: 3.25,
  sprintEnter: 6.2, sprintLeave: 5.85,
  /* lateral: shuffle occupies the band 0.75-1.05; strafe 0.85-1.15 inside it */
  shuffleEnter: 1.05, shuffleLeave: 0.75,
  strafeEnter: 1.15, strafeLeave: 0.85,
  /* shuffle/strafe only while sub-sprint; above this a lateral read is just a run */
  shuffleSpeedMax: 3.3,
} as const;

/** One-rung forward speed ladder with entry/hold/leave dead bands. */
function ladderStep(prev: string, spd: number): string {
  const D = GAIT_DEAD;
  switch (prev) {
    case 'idle':   return spd >= D.walkEnter ? 'walk' : 'idle';
    case 'walk':   return spd < D.walkLeave ? 'idle' : spd >= D.jogEnter ? 'jog' : 'walk';
    case 'jog':    return spd < D.jogLeave ? 'walk' : spd >= D.runEnter ? 'run' : 'jog';
    case 'run':    return spd < D.runLeave ? 'jog' : spd >= D.sprintEnter ? 'sprint' : 'run';
    case 'sprint': return spd < D.sprintLeave ? 'run' : 'sprint';
    default:       return spd < D.walkEnter ? 'idle' : spd < D.jogEnter ? 'walk' : spd < D.runEnter ? 'jog' : spd < D.sprintEnter ? 'run' : 'sprint';
  }
}

/** Fresh (no prior state) speed mapping — used on the one-shot exit from shuffle. */
function freshLadder(spd: number): string {
  const D = GAIT_DEAD;
  return spd < D.walkEnter ? 'idle' : spd < D.jogEnter ? 'walk' : spd < D.runEnter ? 'jog' : spd < D.sprintEnter ? 'run' : 'sprint';
}

/** Resolve the locomotion action with SPEC_06 hysteresis. (Exported for the
 * SPEC_06 unit check; a pure function, no side effects.) */
export function resolveGait(prev: string, spd: number, latRaw: number): { action: string; lat: number | undefined } {
  const D = GAIT_DEAD;
  const latMag = Math.abs(latRaw);
  const prevLateral = prev === 'shuffle' || prev === 'strafe' || prev === 'strafeL';

  if (prevLateral) {
    /* Hold the lateral state until |lat| collapses below the leave band. The
     * 0.75-1.05 band is shared by jog↔shuffle and strafe, so an actor does not
     * hop jog → shuffle → jog around a single frame of |lat| ≈ 0.9. */
    if (latMag < D.shuffleLeave) {
      return { action: freshLadder(spd), lat: undefined };
    }
    /* Inside shuffle, pick strafe vs shuffle with its own 0.85-1.15 band. */
    if (latMag >= D.strafeEnter) return { action: latRaw > 0 ? 'strafe' : 'strafeL', lat: latRaw };
    if (latMag <= D.strafeLeave && (prev === 'strafe' || prev === 'strafeL')) return { action: 'shuffle', lat: latRaw };
    /* dead band: keep the current side, do not drift the mirror */
    return { action: prev === 'shuffle' ? 'shuffle' : (latRaw > 0 ? 'strafe' : 'strafeL'), lat: latRaw };
  }

  /* Not lateral: forward speed ladder (hysteretic), then the shuffle entry. */
  const action = ladderStep(prev, spd);
  if (spd < D.shuffleSpeedMax && latMag >= D.shuffleEnter && (action === 'walk' || action === 'jog')) {
    return { action: latMag >= D.strafeEnter ? (latRaw > 0 ? 'strafe' : 'strafeL') : 'shuffle', lat: latRaw };
  }
  return { action, lat: undefined };
}

/** Engine clip vocabulary -> the system's action strings. */
function mapAction(clip: string): string {
  switch (clip) {
    case 'ready': case 'nineSquat': case 'refReady': return 'idle';
    case 'jog': return 'jog';
    case 'sprint': return 'sprint';
    case 'carry': return 'run';
    case 'pass': case 'ninePass': case 'nineFeed': case 'lineoutThrow': return 'pass';
    case 'catchHigh': case 'lineoutCatch': return 'catch';
    case 'kick': return 'kick';
    case 'tackle': return 'tackle';
    case 'grounded': return 'tackled';
    case 'dive': return 'dive';
    case 'jackal': return 'jackal';
    case 'cleanout': return 'ruck';
    case 'maulBind': case 'maulDrive': return 'maul';
    case 'scrumCrouch': case 'scrumBind': return 'scrumBind';
    case 'scrumDrive': return 'scrumShove';
    case 'lineoutJump': return 'jump';
    case 'lineoutLift': return 'lift';
    case 'refSignal': return 'idle';
    default: return 'idle';
  }
}

function puppetFor(d: Director, a: Actor, dt: number, look: [number, number] | null): Puppet {
  /* New match (or new Director) — reset every puppet and every paper view. */
  if (lastDirector !== d) { lastDirector = d; puppets.clear(); resetPaperViews(); }
  const key = paperViewKey(a.team, a.num);
  let pg = puppets.get(key);
  if (!pg) {
    pg = {
      clipName: '', u: 0, runU: 0, pose: { ...STAND }, blendFrom: null, blendT: 0, blendDur: 0.16,
      face: a.rf > 0 ? 0 : Math.PI, lx: a.rx, lz: a.rz, spd: 0,
      hold: null, holdT: 0, lie: false,
      ch: a.team === 'REF' ? makeRef() : makeCharacter(a.team === 'B' ? 'B' : 'A', a.num),
      seed: (a.num * 37 + (a.team === 'B' ? 11 : 3)) % 97,
      lat: 0, view: 'front', gait: 'idle',   // SPEC_06 — facing/strafe debug + hysteresis
    };
    puppets.set(key, pg);
  }
  /* velocity + true heading from the streamed positions */
  const vx = (a.rx - pg.lx) / Math.max(dt, 1e-4);
  const vz = (a.rz - pg.lz) / Math.max(dt, 1e-4);
  pg.lx = a.rx; pg.lz = a.rz;
  pg.spd = Math.hypot(vx, vz);
  /* PLAYTEST 4 — FACING. A moving man walks where he is going; a slow or
   * stationary man LOOKS AT THE BALL. The old velocity-only heading had
   * support runners strolling back to marks staring straight at the camera
   * ("my players are mostly facing me") and defenders square-on to their own
   * jog instead of the play. */
  if (pg.spd > 2.2) {
    let target = Math.atan2(vx, vz);
    let dy = target - pg.face;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    pg.face += dy * (1 - Math.exp(-dt * 10));
  } else if (look) {
    let target = Math.atan2(look[0] - a.rx, look[1] - a.rz);
    let dy = target - pg.face;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    pg.face += dy * (1 - Math.exp(-dt * 6));
  }

  /* action sequencing: tackles and dives play once, then hold the lying
   * cycle; getting up plays the unwind once before the gait takes over. */
  let action = mapAction(a.renderClip);
  if ((action === 'tackled' || action === 'dive') && pg.u * CLIPS[action === 'dive' ? 'diveFront' : 'tackled'].dur >= 1) {
    action = 'lieF'; pg.lie = true;
  }
  if (pg.lie && action !== 'lieF' && action !== 'tackled' && action !== 'dive') {
    /* the engine stood him up — play the unwind, then the new action */
    pg.hold = 'getupF'; pg.holdT = 1 / 0.95; pg.lie = false;
  }
  if (pg.hold) {
    action = pg.hold;
    pg.holdT -= dt;
    if (pg.holdT <= 0) pg.hold = null;
  }

  /* Gait normalisation by REAL speed — and the STRAFE ROUTE: movement at an
   * angle to the facing at low speed is a side-shuffle, NOT a walk. This is
   * what kills the long-strides-at-crawling-pace read the user flagged.
   * SPEC_06: the bare thresholds are replaced with the reviewed hysteresis dead
   * bands so an actor holds its gait until the signal crosses the outer bound
   * (no more jog ↔ shuffle ↔ strafe flapping on a hovering |lat|/spd). */
  let lat: number | undefined;
  if (action === 'jog' || action === 'sprint' || action === 'run') {
    const cf = Math.cos(pg.face), sf = Math.sin(pg.face);
    const latRaw = vx * cf - vz * sf;
    const resolved = resolveGait(pg.gait, pg.spd, latRaw);
    action = resolved.action;
    lat = resolved.lat;
    pg.gait = action;   // hold the resolved locomotion state across frames
    pg.lat = latRaw;    // debug: the raw lateral stream, not the resolved one
  } else {
    pg.lat = 0;         // not a moving gait — no lateral carry
  }
  const choice = actionClip(action, pg.spd, lat);
  if (choice.name !== pg.clipName) {
    pg.blendFrom = { ...pg.pose };
    pg.blendT = 0;
    pg.blendDur = CLIPS[choice.name].loop ? 0.16 : 0.12;
    pg.clipName = choice.name;
    pg.u = 0;
  }
  pg.u += choice.rate * dt;
  // SPEC_01 — keep a cadence-locked gait phase so a running carrier's legs keep
  // tracking the turf while his upper body plays the pass clip.
  const gaitAct = pg.spd < 0.7 ? 'idle' : pg.spd < 1.6 ? 'walk' : pg.spd < 3.6 ? 'jog' : pg.spd < 6.2 ? 'run' : 'sprint';
  pg.runU += actionClip(gaitAct, pg.spd).rate * dt;
  const sampled = sampleC(pg.clipName, pg.u);
  if (pg.blendFrom && pg.blendT < pg.blendDur) {
    pg.blendT += dt;
    pg.pose = lerpPose(pg.blendFrom, sampled, smooth(clamp01p(pg.blendT / pg.blendDur)));
  } else { pg.blendFrom = null; pg.pose = sampled; }
  return pg;
}

export function drawMatch(ctx: CanvasRenderingContext2D, d: Director, v: View) {
  const ddt = 1 / 60;   // the puppet pipeline only needs a stable beat for velocity
  resetFacingDebug();   // SPEC_06 — fresh per-actor readout each frame
  const cam = d.cam;
  const jx = cam.shake ? (Math.random() - 0.5) * cam.shake * 14 : 0;
  const jy = cam.shake ? (Math.random() - 0.5) * cam.shake * 11 : 0;
  const cam2: Camera = { ...cam, shake: 0 };

  drawStadium(ctx, cam2, v, d.t, d.pitch);
  drawGoalPosts(ctx, cam2, v, -HOME_POST_Z, false);

  /* Facing-vs-camera is now the paper-view system's job (per-actor). */

  /* --- ball --- */
  let ballWorld: { x: number; y: number; z: number; spin: number; visible: boolean } = { x: 0, y: 0, z: 0, spin: 0, visible: false };
  if (d.phase === 'SCRUM' || d.phase === 'REPLAY') {
    const s = d.scrim!;
    if (s.ball.state !== 'HELD') {
      ballWorld = { x: d.scrumAnchor.x + s.ball.x, y: s.ball.y + 0.06, z: d.scrumAnchor.z + s.ball.z, spin: s.ball.z * 0.6, visible: true };
    }
  } else if ((d.phase === 'LINEOUT' || d.phase === 'LINEOUT_REPLAY') && d.lo && d.lo.ball.state !== 'HELD') {
    ballWorld = { x: d.lo.ball.x, y: d.lo.ball.y + 0.05, z: d.lo.ball.z, spin: d.lo.ball.x * 0.35, visible: true };
  } else if ((d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk) {
    const k = d.kk;
    ballWorld = { x: k.bx, y: k.by + 0.12, z: k.bz, spin: k.t * 3.2, visible: k.stage !== 'SETUP' };
  } else if (d.phase === 'OPEN_PLAY' && d.op) {
    const o = d.op;
    // T-35. While a pass is in flight the ball is live between passer and receiver.
    if (o.ball.live) {
      ballWorld = { x: o.ball.x, y: o.ball.y, z: o.ball.z, spin: o.t * 5, visible: true };
    } else {
      /* held ball rides at the chest of the carrier's true heading so the
       * paper layers occlude it correctly (handoff 8.1) */
      const ck = paperViewKey(o.attacking, o.carrierNum);
      const cp = puppets.get(ck);
      /* SPEC_14 — the ball rides the carrier's chest, so its height and its
       * offset from the spine have to grow with the figure or it ends up at
       * his waist. Only the CARRIED anchors scale; a ball in flight or on the
       * turf is world geometry and is untouched. */
      const hx = (cp ? Math.sin(cp.face) * 0.26 : 0.3) * FIGURE_SCALE;
      const hz = (cp ? Math.cos(cp.face) * 0.26 : 0) * FIGURE_SCALE;
      ballWorld = { x: o.carrierX + hx, y: 1.14 * FIGURE_SCALE, z: o.carrierZ + hz, spin: o.t * 1.6, visible: true };
    }
  } else if ((d.phase === 'MAUL' || d.phase === 'MAUL_REPLAY') && d.ml) {
    const m = d.ml;
    const yawRad = (m.yaw * Math.PI) / 180;
    const lz = -m.dir * m.ballRank * 0.78;
    ballWorld = {
      x: m.x - lz * Math.sin(yawRad), y: 1.02 * FIGURE_SCALE,
      z: m.z + lz * Math.cos(yawRad), spin: m.t * 0.6, visible: true,
    };
  } else if ((d.phase === 'BREAKDOWN' || d.phase === 'BREAKDOWN_REPLAY') && d.bd) {
    const b = d.bd;
    const carrier = b.players.find((p) => p.role === 'CARRIER');
    if (b.ball.placed || b.stage === 'RUCK' || b.stage === 'RECYCLE') {
      ballWorld = { x: b.ball.x, y: 0.16, z: b.ball.z, spin: b.t * 0.5, visible: true };
    } else if (carrier) {
      ballWorld = { x: carrier.x + 0.28, y: carrier.down ? 0.3 : 1.05 * FIGURE_SCALE, z: carrier.z, spin: b.t * 2.2, visible: true };
    }
  }

  /* --- collect drawables --- */
  type Item = { f: number; draw: () => void };
  const items: Item[] = [];

  /* PLAYTEST 3 / ANIMATION HANDOFF — per-actor paper views, true profiles,
   * fall rotation, stride-locked gaits. spinDir/gs/fore/headDir are the
   * screen-direction helpers from the handoff (section 5). */
  const gs = Math.min(0.95, Math.max(0.42, Math.sin(cam.tilt) * 1.15));
  const cr = camRightOf(cam);
  for (const a of d.actors) {
    const pg = puppetFor(d, a, ddt, ballWorld.visible ? [ballWorld.x, ballWorld.z] : null);
    const pr = project(cam2, v, a.rx, 0, a.rz, jx, jy);
    if (!pr || pr.sc < 1.2) continue;
    if (pr.sx < -260 || pr.sx > v.w + 260 || pr.sy < -320 || pr.sy > v.h + 320) continue;
    const fx = Math.sin(pg.face), fz = Math.cos(pg.face);
    let view: PaperView;
    if (pg.lie) {
      view = 'lieFaceDown';
    } else {
      view = updatePaperView(paperViewKey(a.team, a.num), fx, fz, a.rx, a.rz, cam.x, cam.z, ddt);
    }
    pg.view = view;   // SPEC_06 — the paper side shown this frame
    const dot = fx * cr[0] + fz * cr[1];
    const sdir = dot >= 0 ? 1 : -1;
    const perp = Math.abs(dot);
    const carried = !!d.op && !d.op.ball.live && a.team === d.op.attacking && a.num === d.op.carrierNum;

    /* SPEC_06 — feed the facing/strafe debug HUD (view, gait, lat). */
    recordFacingDebug({
      key: paperViewKey(a.team, a.num),
      team: a.team, num: a.num,
      view, gait: pg.clipName || (pg.lie ? 'lieF' : mapAction(a.renderClip)),
      spd: pg.spd, lat: pg.lat,
    });

    /* SPEC_01 — four dataset demands, layered onto the sampled puppet pose. */
    let pose = pg.pose;
    const GAIT = new Set(['jog', 'run', 'sprint', 'walk', 'shuffle', 'strafe', 'strafeL']);
    if (pg.clipName === 'passSpin' && pg.spd > 3.6) {
      // Running pass (R-03 / SM-13 / PR-04): upper/lower separation — legs keep
      // running while the arms throw the ball.
      const gc = actionClip(pg.spd < 6.2 ? 'run' : 'sprint', pg.spd);
      let gait = sampleC(gc.name, pg.runU);
      gait = pinPlantedFoot(gait, pg.ch.build, pg.spd);
      pose = upperLowerRun(gait, pg.pose);
    } else if (GAIT.has(pg.clipName) && pg.spd > 0.7) {
      // No-foot-slide (SM-02 / W-07 / B-04): pin the planted foot to the turf.
      pose = pinPlantedFoot(pose, pg.ch.build, pg.spd);
    }
    const squash = squashForClip(pg.clipName, pg.u);                 // Impact Squash (P-01/C-01/W-06)
    const legScale = edgeLegForeshorten(perp, cam.tilt * 180 / Math.PI); // Edge Leg Foreshortening (B-14)

    const args: PaperDrawArgs = {
      ctx, sx: pr.sx, sy: pr.sy, sc: pr.sc, view, pose,
      /* SPEC_14 — the shadow is projected from world geometry now. */
      cam: cam2, v, wx: a.rx, wz: a.rz, face: a.rf,
      pal: PALETTES[a.team], build: pg.ch.build, skin: pg.ch.skin, hair: pg.ch.hair,
      num: pg.ch.num, seed: pg.seed,
      carry: carried ? 1 : 0,
      carryStyle: Math.min(1, Math.max(0, (pg.spd - 3) / 4)),
      ballSide: pg.pose.ballSide, ballSpin: ballWorld.spin,
      cap: pg.ch.cap, tape: pg.ch.tape,
      spinDir: sdir, gs, fore: 0.45 + 0.55 * perp, headDir: sdir || 1, depth: pr.f,
      squash, legScale,
    };
    items.push({ f: pr.f, draw: () => { drawPaperShadow(args); drawPaperActor(args); } });
  }

  if (ballWorld.visible) {
    const p = project(cam2, v, ballWorld.x, ballWorld.y, ballWorld.z, jx, jy);
    if (p) {
      const sh = project(cam2, v, ballWorld.x, 0, ballWorld.z, jx, jy);
      items.push({
        f: p.f - 0.01,
        draw: () => {
          if (sh) shadowBlob(ctx, sh.sx, sh.sy, p.sc * 0.16, p.sc * 0.06, 0.25);
          ballPaper(ctx, p.sx, p.sy, Math.max(3, p.sc * 0.11), ballWorld.spin);
        },
      });
    }
  }

  items.sort((a, b) => b.f - a.f);
  for (const it of items) it.draw();

  drawGoalPosts(ctx, cam2, v, HOME_POST_Z, true);

  /* --- mini-game overlays --- */
  if (d.phase === 'SCRUM' || d.phase === 'REPLAY') drawScrumOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'LINEOUT' || d.phase === 'LINEOUT_REPLAY') drawLineoutOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'BREAKDOWN' || d.phase === 'BREAKDOWN_REPLAY') drawBreakdownOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'MAUL' || d.phase === 'MAUL_REPLAY') drawMaulOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'OPEN_PLAY') drawOpenPlayOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'KICK' || d.phase === 'KICK_REPLAY') drawKickOverlay(ctx, d, v, cam2, jx, jy);
}

function drawOpenPlayOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.op!;
  const glz = s.carrierZ - s.gained * s.dir;
  const a = project(cam, v, s.carrierX - 16, 0.03, glz, jx, jy);
  const b = project(cam, v, s.carrierX + 16, 0.03, glz, jx, jy);
  if (a && b) {
    ctx.strokeStyle = 'rgba(255,215,106,0.5)'; ctx.lineWidth = 2.5; ctx.setLineDash([9, 7]);
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    ctx.setLineDash([]);
  }
  /* (The green carrier-direction stake is GONE — playtest 4: remove the
   * open-play line with the dot at the end. The gain line stays.) */
  const cp = project(cam, v, s.carrierX, 0, s.carrierZ, jx, jy);
  if (cp) {
    const zone = zoneLabel(s.z, s.dir);
    const pc = project(cam, v, s.carrierX, 2.2, s.carrierZ, jx, jy);
    if (pc) {
      const w = pc.sc * 1.6, hgt = Math.max(3, pc.sc * 0.09);
      const p = Math.min(1, s.pressure);
      ctx.fillStyle = 'rgba(14,14,20,0.6)';
      ctx.fillRect(pc.sx - w / 2, pc.sy, w, hgt);
      ctx.fillStyle = p > 0.75 ? '#ff6a5a' : p > 0.45 ? '#ffd76a' : '#6ee7a0';
      ctx.fillRect(pc.sx - w / 2, pc.sy, w * p, hgt);
      ctx.strokeStyle = 'rgba(244,239,226,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(pc.sx - w / 2, pc.sy, w, hgt);
    }
    /* T-37. The controls belong in the HUD (top-left), not floating above the
     * carrier. Only live telemetry stays in-world. */
    worldLabel(ctx, cam, v, s.carrierX, 3.1, s.carrierZ,
      `PHASE ${s.phase} · +${s.gained.toFixed(1)} m · ${s.toLine.toFixed(0)} m TO GO · ZONE ${zone}`,
      s.lineBreak ? '#6ee7a0' : '#cfcabb', jx, jy);
  }
}

function zoneLabel(z: number, dir: number): string {
  const toLine = Math.abs(dir * 50 - z);
  if (toLine <= 22) return 'A (THEIR 22)';
  if (toLine <= 50) return 'B (THEIR HALF)';
  if (toLine <= 78) return 'C (OUR HALF)';
  return 'D (OUR 22)';
}

function drawKickOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.kk!;
  if (s.history.length > 2) {
    ctx.strokeStyle = 'rgba(255,235,170,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath();
    let started = false;
    for (const h of s.history) {
      const p = project(cam, v, h.x, h.y, h.z, jx, jy);
      if (!p) continue;
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,235,170,0.22)'; ctx.lineWidth = 2;
    ctx.beginPath(); started = false;
    for (const h of s.history) {
      const p = project(cam, v, h.x, 0.02, h.z, jx, jy);
      if (!p) continue;
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }
  if (s.type === 'FIFTY_22') {
    const tz = s.dir * 28;
    const a = project(cam, v, -35, 0.03, tz, jx, jy);
    const b = project(cam, v, 35, 0.03, tz, jx, jy);
    if (a && b) {
      ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, '22 — LAND IN FIELD, OUT BEYOND THIS', (a.sx + b.sx) / 2, a.sy - 10, '#ffd76a');
    }
  }
  const cp = project(cam, v, s.bx, 0, s.bz, jx, jy);
  if (cp) {
    if (s.profile.atGoal && s.goalProb > 0) {
      worldLabel(ctx, cam, v, s.bx, s.by + 2.4, s.bz,
        `${s.goalDistance.toFixed(0)} M · ${s.goalAngle.toFixed(0)}° OFF · ${(s.goalProb * 100).toFixed(0)}%`,
        s.goalProb > 0.7 ? '#6ee7a0' : s.goalProb > 0.45 ? '#ffd76a' : '#ff6a5a', jx, jy);
    } else {
      worldLabel(ctx, cam, v, s.bx, s.by + 2.6, s.bz, s.profile.label.toUpperCase(), '#f4efe2', jx, jy);
      worldLabel(ctx, cam, v, s.bx, s.by + 1.9, s.bz,
        `HANG ${s.hangTime.toFixed(2)}s · APEX ${s.apex.toFixed(1)} m · ${s.distance.toFixed(0)} m`,
        '#cfcabb', jx, jy);
    }
  }
}

function drawMaulOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.ml!;
  const t0 = project(cam, v, s.x - 12, 0.03, s.tryLineZ, jx, jy);
  const t1 = project(cam, v, s.x + 12, 0.03, s.tryLineZ, jx, jy);
  if (t0 && t1) {
    ctx.strokeStyle = '#ffe58a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(t0.sx, t0.sy); ctx.lineTo(t1.sx, t1.sy); ctx.stroke();
    label(ctx, 'TRY LINE', (t0.sx + t1.sx) / 2, t0.sy - 10, '#ffe58a');
  }

  const bar = (team: 'A' | 'D', f: number, off: number, col: string) => {
    const len = Math.min(4.5, (f / 6000) * 4.0);
    const sgn = team === 'A' ? 1 : -1;
    const a = project(cam, v, s.x + off, 2.7, s.z - s.dir * sgn * 0.5, jx, jy);
    const b = project(cam, v, s.x + off, 2.7, s.z - s.dir * sgn * (0.5 + len), jx, jy);
    if (!a || !b) return;
    ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    label(ctx, `${(f / 1000).toFixed(2)} kN`, (a.sx + b.sx) / 2, (a.sy + b.sy) / 2 - 10, col);
  };
  if (s.stage !== 'EXIT' && s.stage !== 'OVER') {
    bar('A', s.forceA, -2.4, '#ff6a5a');
    bar('D', s.forceD, 2.4, '#7fa3e6');
  }

  const rankCols = ['#ff6a5a', '#ffd76a', '#6ee7a0'];
  const rp = project(cam, v, s.x, 2.0, s.z, jx, jy);
  if (rp) {
    label(ctx, `BALL AT RANK ${s.ballRank + 1}/${s.ranks}${s.ballRank >= s.ranks - 1 ? ' — SAFE' : ''}`,
      rp.sx, rp.sy, rankCols[Math.min(2, s.ballRank)]);
  }

  const cp = project(cam, v, s.x, 0, s.z, jx, jy);
  if (cp) {
    const toLine = Math.abs(s.tryLineZ - s.z);
    const spdCol = s.speed > 0.6 ? '#6ee7a0' : s.speed > 0.12 ? '#ffd76a' : '#ff6a5a';
    worldLabel(ctx, cam, v, s.x, 4.2, s.z,
      `+${s.gained.toFixed(1)} m · ${s.speed.toFixed(2)} m/s · ${toLine.toFixed(1)} m TO GO`, spdCol, jx, jy);
    const stall = s.stallClock > 0 ? `STOPPED ${s.stallClock.toFixed(1)}s` : s.stoppedOnce ? 'STOPPED ONCE' : 'DRIVING';
    const contest = s.contest === 'PENDING'
      ? `RE-GATE ${s.regateWindows.length}/4`
      : s.humanWinShare === null
        ? s.contest.replace('_', ' ')
        : `${s.contest === 'ATTACK_CONTROL' ? 'ATTACK' : 'DEFENCE'} CONTROL ${(s.humanWinShare * 100).toFixed(0)}%`;
    const exit = s.exit === 'NONE' ? '' : ` · ${s.exit.replace(/_/g, ' ')}`;
    worldLabel(ctx, cam, v, s.x, 3.5, s.z,
      `${contest}${exit} · ${stall} · WHEEL ${s.yaw > 0 ? '+' : ''}${s.yaw.toFixed(0)}°`, s.useItCalled ? '#ff6a5a' : '#f4efe2', jx, jy);
    /* SPEC_08 (T-65): the stall rides the RUCK-COUNTDOWN channel — the same
     * big number, the same bands, the same stroke, drawn at the maul instead
     * of the breakdown. Playtest 2: the number is the TIME TO ACT — the time
     * to the real consequence for this state (the law whistle under defence
     * control, the 6 s auto-exit under attack control), never ambient
     * information. The old status line's "/ 5.0s" promised a whistle that
     * never came in two of the three modes and is gone. The call itself is
     * one persistent word: USE IT. */
    if (maulUseItCall(s)) {
      const remaining = maulUseItClock(s);
      const band = remaining > 2 ? '#6ee7a0' : remaining > 1 ? '#ffd76a' : '#ff6a5a';
      worldLabel(ctx, cam, v, s.x, 4.9, s.z, 'USE IT', '#ff6a5a', jx, jy);
      ctx.font = '900 22px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(14,14,20,0.85)';
      ctx.strokeText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
      ctx.fillStyle = band;
      ctx.fillText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
      ctx.textAlign = 'left';
    }
  }
}

function drawBreakdownOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.bd!;
  const dir = s.attacking === 'A' ? 1 : -1;

  const gl0 = project(cam, v, s.contactX - 6, 0.02, s.contactZ - s.gainLine * dir, jx, jy);
  const gl1 = project(cam, v, s.contactX + 6, 0.02, s.contactZ - s.gainLine * dir, jx, jy);
  if (gl0 && gl1 && s.stage !== 'SET' && s.stage !== 'CARRY') {
    ctx.strokeStyle = 'rgba(255,215,106,0.6)'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(gl0.sx, gl0.sy); ctx.lineTo(gl1.sx, gl1.sy); ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, 'GAIN LINE', (gl0.sx + gl1.sx) / 2, gl0.sy - 8, 'rgba(255,215,106,0.85)');
  }

  if (s.ruckFormed) {
    for (const side of [1, -1]) {
      const a = project(cam, v, s.contactX - 7, 0.02, s.contactZ + side * dir * 1.4, jx, jy);
      const b = project(cam, v, s.contactX + 7, 0.02, s.contactZ + side * dir * 1.4, jx, jy);
      if (!a || !b) continue;
      ctx.strokeStyle = side > 0 ? 'rgba(127,163,230,0.5)' : 'rgba(255,106,90,0.5)';
      ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (s.jackalActive && !s.ruckFormed) {
    const p = project(cam, v, s.ball.x, 0.02, s.ball.z, jx, jy);
    if (p) {
      const pulse = 0.7 + Math.sin(s.t * 14) * 0.3;
      ctx.strokeStyle = `rgba(255,90,70,${pulse})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(p.sx, p.sy, p.sc * 0.7, p.sc * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
      label(ctx, 'COMMIT - SPACE', p.sx, p.sy - p.sc * 0.5, '#ff8a72');
    }
  }

  /* T-05 — THE CONTEST BAR. The ruck is a physical contest now, so it is
   * surfaced like the scrum's drive: the live force on each end of a bar and
   * the ball's spot on the axis between them. FAIR-09: the player must be
   * able to see who is winning the ruck and why, not wait for a whistle. */
  if (s.stage === 'RUCK' || s.stage === 'PLACE') {
    const share = s.power.A + s.power.B > 0 ? s.power.A / (s.power.A + s.power.B) : 0.5;
    const cx0 = project(cam, v, s.contactX, 4.2, s.contactZ, jx, jy);
    if (cx0) {
      const w = Math.max(64, cx0.sc * 5.2), h = 7;
      const x0 = cx0.sx - w / 2, y0 = cx0.sy;
      // frame
      ctx.fillStyle = 'rgba(14,14,20,0.72)';
      ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
      // two ends: attack fills from the left, defence from the right
      ctx.fillStyle = '#ff6a5a';
      ctx.fillRect(x0, y0, w * share, h);
      ctx.fillStyle = '#7fa3e6';
      ctx.fillRect(x0 + w * share, y0, w * (1 - share), h);
      // the ball's spot on the −1..+1 axis, as a bright notch
      const ax = x0 + w * ((s.axis + 1) / 2);
      ctx.fillStyle = '#f4efe2';
      ctx.fillRect(ax - 2.5, y0 - 4, 5, h + 8);
      const fA = (s.power.A / 100).toFixed(1), fB = (s.power.B / 100).toFixed(1);
      label(ctx, `${fA} kN`, x0 + w * 0.5, y0 - 14, '#ff8a72');
      label(ctx, `${fB} kN`, x0 + w * 0.5, y0 + h + 16, '#9db8ec');
    }
  }

  /* T-38. The ruck read is an ordered sequence, not a stat dump:
   *   COMMIT - SPACE   (a jackal is on the ball)
   *   A/D - CLEAROUT   (working to win it)
   *   SECURED          (the ball is won)
   * plus a countdown from the ruck clock; at 0 the nine releases to the fly-half. */
  const limit = [1.5, 3, 5][d.options.ruckLaw ?? 2];
  if (s.groundAt >= 0) {
    const elapsed = s.t - s.groundAt;
    const remaining = Math.max(0, limit - elapsed);
    const band = remaining > 2 ? '#6ee7a0' : remaining > 1 ? '#ffd76a' : '#ff6a5a';
    const cp = project(cam, v, s.contactX, 0, s.contactZ, jx, jy);
    if (cp) {
      if (s.stage === 'RECYCLE') {
        worldLabel(ctx, cam, v, s.contactX, 4.9, s.contactZ, 'SECURED', '#6ee7a0', jx, jy);
      } else if (s.jackalActive) {
        worldLabel(ctx, cam, v, s.contactX, 4.9, s.contactZ, 'COMMIT - SPACE', '#ffd76a', jx, jy);
      } else {
        worldLabel(ctx, cam, v, s.contactX, 4.9, s.contactZ, 'A/D - CLEAROUT', '#6ee7a0', jx, jy);
      }
      /* Playtest 2: the big number is the TIME TO PASS — it belongs to the
       * secured ball (RECYCLE window), not the shove. Over the fight it just
       * covered the two men on the ground. */
      if (s.stage === 'RECYCLE') {
        ctx.font = '900 22px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(14,14,20,0.85)';
        ctx.strokeText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
        ctx.fillStyle = band;
        ctx.fillText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
        ctx.textAlign = 'left';
      }
      const gain = s.gainLine;
      worldLabel(ctx, cam, v, s.contactX, 3.1, s.contactZ,
        `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} m · PHASE ${s.phase}`, '#f4efe2', jx, jy);
    }
  }
}

function drawScrumOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.scrim!;
  const ax = d.scrumAnchor.x, az = d.scrumAnchor.z;
  const active = ['ENGAGE', 'STEADY', 'FEED', 'STRIKE', 'DRIVE', 'BASE'].includes(s.stage);
  if (!active) return;

  const fA = s.packs.A.forceTransmitted, fB = s.packs.B.forceTransmitted;
  const draw = (team: 'A' | 'B') => {
    const f = team === 'A' ? fA : fB;
    const len = Math.min(3.2, (f / 8000) * 2.6) * (team === 'A' ? 1 : -1);
    const from = project(cam, v, ax + (team === 'A' ? -1.9 : 1.9), 3.1, az + 1.9 * (team === 'A' ? 1 : -1), jx, jy);
    const to = project(cam, v, ax + (team === 'A' ? -1.9 : 1.9), 3.1, az + (1.9 + len) * (team === 'A' ? 1 : -1), jx, jy);
    if (!from || !to) return;
    const col = team === 'A' ? '#ff6a5a' : '#7fa3e6';
    ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(from.sx, from.sy); ctx.lineTo(to.sx, to.sy); ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.sx, to.sy, 7, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    label(ctx, `${(f / 1000).toFixed(2)} kN`, (from.sx + to.sx) / 2, (from.sy + to.sy) / 2 - 12, col);
  };
  draw('A'); draw('B');

  worldLabel(ctx, cam, v, ax, 3.6, az,
    `DRIVE ${(s.netDrive * 100).toFixed(0)} cm · WHEEL ${s.yaw > 0 ? '+' : ''}${s.yaw.toFixed(1)}° · RISK ${(Math.min(1, s.collapseRisk) * 100).toFixed(0)}%`,
    '#f4efe2', jx, jy);
}

function drawLineoutOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.lo!;
  const tp = project(cam, v, s.call.targetX, 0, s.markZ, jx, jy);
  if (tp && (s.stage === 'CALL' || s.stage === 'THROW' || s.stage === 'CONTEST')) {
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.ellipse(tp.sx, tp.sy, tp.sc * 0.55, tp.sc * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (s.ball.state === 'FLIGHT' && s.history.length > 2) {
    ctx.strokeStyle = 'rgba(255,235,170,0.55)'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (let i = Math.max(0, s.history.length - 26); i < s.history.length; i++) {
      const h = s.history[i];
      const p = project(cam, v, h.ballX, h.ballY, s.markZ, jx, jy);
      if (!p) continue;
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }
  if (s.winner) {
    const j = s.players.find((p) => p.id === s.ball.heldBy);
    if (j) {
      const p = project(cam, v, j.x, j.handY + 0.35, j.z, jx, jy);
      if (p) label(ctx, `${j.handY.toFixed(2)} m`, p.sx, p.sy, '#ffd76a');
    }
  }
  if (s.stage === 'CONTEST' || s.stage === 'CATCH') {
    worldLabel(ctx, cam, v, -26, 5.6, s.markZ,
      `APEX ${s.ball.apexY.toFixed(2)} m · MARGIN ${(s.contestMargin * 100).toFixed(0)} cm`, '#f4efe2', jx, jy);
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string) {
  ctx.font = '900 13px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(14,14,20,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour; ctx.fillText(text, x, y);
}

function worldLabel(
  ctx: CanvasRenderingContext2D, cam: Camera, v: View,
  wx: number, wy: number, wz: number, text: string, colour: string,
  jx: number, jy: number,
) {
  const p = project(cam, v, wx, wy, wz, jx, jy);
  if (!p) return;
  if (p.sx < -200 || p.sx > v.w + 200) return;
  const size = Math.max(9, Math.min(16, p.sc * 0.26));
  ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(3, size * 0.3); ctx.strokeStyle = 'rgba(14,14,20,0.85)';
  ctx.strokeText(text, p.sx, p.sy);
  ctx.fillStyle = colour; ctx.fillText(text, p.sx, p.sy);
}

export { drawMinimap } from './minimap';

/* ---------------- wipe transition ---------------- */
export function drawWipe(ctx: CanvasRenderingContext2D, v: View, w: number) {
  if (w <= 0.001) return;
  const h = v.h * w;
  ctx.fillStyle = '#101017';
  ctx.fillRect(0, 0, v.w, h * 0.5);
  ctx.fillRect(0, v.h - h * 0.5, v.w, h * 0.5);
  ctx.fillStyle = '#e8cf46';
  ctx.fillRect(0, h * 0.5 - 3, v.w, 6);
  ctx.fillRect(0, v.h - h * 0.5 - 3, v.w, 6);
  if (w > 0.6) {
    ctx.globalAlpha = (w - 0.6) / 0.4;
    ctx.fillStyle = '#101017';
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.globalAlpha = 1;
  }
}

export function debugPoly(v: View): [number, number][] {
  return [[0, 0], [v.w, 0], [v.w, v.h], [0, v.h]];
}
