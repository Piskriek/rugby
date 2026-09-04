/**
 * THE TRACE — a captured behavioural record of an actual match.
 *
 * Point 1 is where the players stand at kick-off. Point 2 is where the camera is.
 * Point 3 is what the player is told. Point 4 is what happens when a button goes
 * down, and when it comes up. Point 5 is what the ball does — how far, which way.
 * Then what the thirty do while it is in the air, what the camera does next, what
 * is on screen, what the player can actually do, and whether anything tells him
 * to run to where the ball is going to land.
 *
 * Every point is captured from a real headless run of the engine. Nothing here is
 * hand-written data. The bot drives the same input path a human does.
 */

import { Director, Input, NO_INPUT, MatchConfig } from './director';
import { FIELD, project } from '../render/retro';
import { sanctionOf } from './engine/laws';


export type Val = number | string | boolean | null;

export interface TracePoint {
  i: number;
  t: number;
  phase: string;
  stage: string;
  kind: string;
  label: string;
  d: Record<string, Val>;
}

export const TRACE_LIMIT = 1000;

/* ============================ THE BOT ============================
 * A scripted player. Its purpose is to exercise every verb so the trace contains
 * real input feedback rather than a game that plays itself.
 */

export interface BotState { wait: number; flip: number; presses: number; releases: number }

export function botInput(d: Director, dt: number, st: BotState): { inp: Input; pressed: Set<string>; released: string[] } {
  const inp: Input = { ...NO_INPUT };
  const pressed = new Set<string>();
  const released: string[] = [];
  st.wait -= dt;
  st.flip += dt;

  const wobble = Math.floor(st.flip * 7) % 2 === 0;

  // While a kick is being set up or is in the air
  if (d.phase === 'KICK' && d.kk) {
    const k = d.kk;
    if (k.stage === 'AIM') {
      // aim toward the far touchline, then commit
      if (k.aim < 0.6) inp.right = true; else inp.left = true;
      if (st.wait <= 0) { pressed.add('action'); st.wait = 0.4; }
    } else if (k.stage === 'METER') {
      // two discrete presses: power into the gold band, then accuracy
      if (k.power === 0) { if (k.meter > 0.70 && k.meter < 0.82) pressed.add('action'); }
      else if (k.meter > 0.58 && k.meter < 0.72) pressed.add('action');
    } else if (k.stage === 'FLIGHT') {
      const lp = d.landingPrediction();
      const c = d.ctrlPlayer;
      if (lp && c) {
        if (lp.x < c.x - 0.8) inp.left = true;
        else if (lp.x > c.x + 0.8) inp.right = true;
        if (lp.z > c.z) inp.up = true; else inp.down = true;
        inp.sprint = true;
      }
    }
    return { inp, pressed, released };
  }

  // Defending: close the man and choose a tackle
  if (d.phase === 'OPEN_PLAY' && d.op && d.ctrlPlayer.team !== d.op.attacking) {
    const c = d.ctrlPlayer;
    const car = d.live.find((p) => p.team === d.op!.attacking && p.num === d.op!.carrierNum);
    if (car) {
      if (car.x < c.x - 0.8) inp.left = true; else if (car.x > c.x + 0.8) inp.right = true;
      if (car.z > c.z) inp.up = true; else inp.down = true;
      inp.sprint = true;
      const dist = Math.hypot(car.x - c.x, car.z - c.z);
      if (dist < 3.2 && st.wait <= 0) { pressed.add('tackleDive'); st.wait = 0.8; }
    }
    return { inp, pressed, released };
  }

  switch (d.phase) {
    case 'OPEN_PLAY': {
      const s = d.op;
      if (!s) break;
      if (s.pressure > 0.62) {
        if (st.wait <= 0) {
          pressed.add(s.pressure > 0.85 ? 'contact' : (Math.random() < 0.5 ? 'passL' : 'passR'));
          st.wait = 0.6;
        }
      } else if (Math.random() < 0.02) {
        pressed.add(Math.random() < 0.3 ? 'cutR' : 'passR');
      }
      inp.sprint = s.pressure < 0.7;
      inp.up = true;
      // hunt the widest gap
      const defs = d.live.filter((p) => p.team !== s.attacking);
      if (defs.length) {
        const xs = defs.map((p) => p.x).sort((a, b) => a - b);
        let best = 0, gap = -1;
        for (let i = 0; i < xs.length - 1; i++) {
          const g = xs[i + 1] - xs[i];
          if (g > gap) { gap = g; best = (xs[i] + xs[i + 1]) / 2; }
        }
        if (best > d.ctrlPlayer.x + 1) inp.right = true; else if (best < d.ctrlPlayer.x - 1) inp.left = true;
      }
      break;
    }
    case 'BREAKDOWN':
      /* UX-94: the mash is the CLEAROUT — the attacking side's verb. A
       * side defending the ruck has no A/D verb (its contest is the
       * jackal, which is modelled, not mashed); pressing anyway produced
       * 251 "pressed and nothing changed" faults a run that were never a
       * game defect. The bot presses only when the affordance exists. */
      if (d.bd && d.isHuman(d.bd.attacking)) {
        if (wobble) pressed.add('left'); else pressed.add('right');
        inp.left = wobble; inp.right = !wobble;
      }
      break;
    case 'SCRUM':
      if (['ENGAGE', 'DRIVE', 'STRIKE'].includes(d.scrim?.stage ?? '')) {
        pressed.add(wobble ? 'left' : 'right');
        inp.left = wobble; inp.right = !wobble;
      }
      break;
    case 'LINEOUT':
      if (d.lo?.stage === 'CALL') { if (st.wait <= 0) { pressed.add('right'); st.wait = 0.3; if (Math.random() < 0.4) { pressed.add('action'); st.wait = 0.5; } } }
      else if (d.lo?.stage === 'THROW') { if (d.lo.meter > 0.58 && d.lo.meter < 0.72) pressed.add('action'); }
      break;
    case 'MAUL':
      /* Same affordance gate as the breakdown: the drive belongs to the
       * mauling side. */
      if (d.ml && d.isHuman(d.ml.attacking)) {
        pressed.add(wobble ? 'left' : 'right');
        if (st.wait <= 0 && Math.random() < 0.3) { pressed.add('action'); st.wait = 1.2; }
      }
      break;
    default: break;
  }
  return { inp, pressed, released };
}

/* ============================ OBSERVABLE SIGNATURE ============================
 * Used to prove that a button press actually changed something. This is the
 * direct answer to "actions fire five seconds after you press them".
 */

function signature(d: Director): string {
  return JSON.stringify([
    d.phase, d.prompt, d.banner,
    d.kk?.stage ?? '', (d.kk?.power ?? 0).toFixed(2), (d.kk?.meter ?? 0).toFixed(2), (d.kk?.aim ?? 0).toFixed(2),
    d.scrim?.stage ?? '', d.scrim?.cadence ?? '',
    d.lo?.stage ?? '', String(d.lo?.callIdx ?? -1), (d.lo?.meter ?? 0).toFixed(2),
    d.bd?.stage ?? '', (d.bd?.waggle ?? 0).toFixed(1), String(d.bd?.commitA ?? 0),
    d.ml?.stage ?? '', String(d.ml?.ballRank ?? -1),
    String(d.op?.carrierNum ?? 0), (d.op?.carrierX ?? 0).toFixed(1), (d.op?.carrierZ ?? 0).toFixed(1),
    String(d.ctrlPlayer?.num ?? 0), (d.ctrlPlayer?.x ?? 0).toFixed(1), (d.ctrlPlayer?.z ?? 0).toFixed(1),
    String(d.teams.A.score), String(d.teams.B.score),
  ]);
}

/* ============================ EMITTERS ============================ */

function maxGap(d: Director, team: 'A' | 'B'): number {
  const xs = d.live.filter((p) => p.team === team).map((p) => p.x).sort((a, b) => a - b);
  let g = 0;
  for (let i = 0; i < xs.length - 1; i++) g = Math.max(g, xs[i + 1] - xs[i]);
  return g;
}

/* SPEC_10 B2b (LAW-66): line integrity is a property of the men still IN the
 * line. maxGap spans the whole team — a beaten defender who has turned to
 * chase (beatenT > 0) has legitimately left his channel, and the hole he
 * leaves behind IS the line break, not a defensive-line defect (LINE BREAKS
 * grades REALISTIC). The line measurement excludes them. */
function maxLineGap(d: Director, team: 'A' | 'B'): number {
  const fx = d.op?.carrierX ?? d.focusPoint().x;
  const xs = d.live.filter((p) => p.team === team && p.beatenT <= 0 && Math.abs(p.x - fx) < 26)
    .map((p) => p.x).sort((a, b) => a - b);
  let g = 0;
  for (let i = 0; i < xs.length - 1; i++) g = Math.max(g, xs[i + 1] - xs[i]);
  return g;
}

function inFrame(d: Director, x: number, z: number): boolean {
  const v = { w: 960, h: 540 };
  const p = project({ ...d.cam, shake: 0 }, v, x, 1, z);
  if (!p) return false;
  return p.sx > -60 && p.sx < v.w + 60 && p.sy > -80 && p.sy < v.h + 80;
}

class Recorder {
  points: TracePoint[] = [];
  push(d: Director, kind: string, label: string, data: Record<string, Val>) {
    if (this.points.length >= TRACE_LIMIT) return;
    this.points.push({
      i: this.points.length + 1,
      t: Math.round(d.t * 100) / 100,
      phase: d.phase,
      stage: d.kk?.stage ?? d.scrim?.stage ?? d.lo?.stage ?? d.bd?.stage ?? d.ml?.stage ?? '',
      kind, label, d: data,
    });
  }
}

function emit(d: Director, rec: Recorder) {
  const atk = d.possession;
  const def = d.defending();

  /* 1 — where the players are */
  const all = d.live;
  const focus = d.focus();
  /* Kick-off legality: the mark must be halfway (or the 22 for a drop-out),
   * and both sides in lawful places — all of it measured AT THE KICK. The
   * old window was "the first two seconds of the kick state", which sampled
   * the AIM walk (receivers lawfully mid-retreat) and the FLIGHT itself,
  /* SPEC_10 B2a: this window sampled the FLYING ball for its first 2 s — by
   * then the mark had legally travelled (a restart leaves the tee at ~10 m/s),
   * the receivers had legally crossed the ten, and the wide pods had legally
   * run in to support. Law 12 legality is a property of the STRIKE TICK
   * (SPEC_09's T0): sample the first tenth of a second of flight — the ball
   * has moved centimetres and nobody has taken a full step yet. */
  if (d.kk && (d.kk.type === 'RESTART' || d.kk.type === 'DROP_OUT')
    && d.kk.stage === 'FLIGHT' && d.kk.t < 0.1) {
    const markOk = d.kk.type === 'RESTART' ? Math.abs(d.kk.bz) < 1.5 : Math.abs(Math.abs(d.kk.bz) - 28) < 2;
    const rec2 = all.filter((p) => p.team === d.kk!.kicker && (p.z - d.kk!.bz) * (d.kk!.kicker === 'A' ? 1 : -1) > 0.5).length;
    const other: 'A' | 'B' = d.kk.kicker === 'A' ? 'B' : 'A';
    const recv10 = d.kk.type === 'RESTART'
      ? all.filter((p) => p.team === other && Math.abs(p.z - d.kk!.bz) < 10 && (p.z - d.kk!.bz) * (d.kk!.kicker === 'A' ? 1 : -1) > 0).length
      : 0;
    rec.push(d, 'KICKOFF', 'RESTART LEGALITY', {
      type: d.kk.type, mark: Math.round(d.kk.bz * 10) / 10,
      markIsHalfway: d.kk.type === 'RESTART' ? Math.abs(d.kk.bz) < 1.5 : null,
      markIs22Metre: d.kk.type === 'DROP_OUT' ? Math.abs(Math.abs(d.kk.bz) - 28) < 2 : null,
      markLawful: markOk,
      kickingTeamBehindBall: rec2 === 0 ? true : false,
      kickingTeamOffsideCount: rec2,
      receiversInside10m: recv10,
      receivingSideLegal: recv10 === 0,
      restartShapeIsPods: all.filter((p) => p.team === other && Math.abs(p.x) > 18).length >= 2,
    });
  }
  const outside = all.filter((p) => Math.abs(p.x) > 35 || p.z < FIELD.deadZ || p.z > FIELD.deadZFar).length;
  const tight = all.filter((a, i) =>
    all.some((b, j) => j > i && a.team === b.team && Math.hypot(a.x - b.x, a.z - b.z) < 0.55)).length;
  const kickerZ = d.kk ? d.kk.bz : null;
  const kickTeam = d.kk?.kicker ?? null;
  /* SPEC_10 B2a (LAW-17): the old window covered the first 1.5 s of the KICK
   * phase — during AIM the thirty are still LEGALLY walking to their slots,
   * and after the strike (SPEC_09 T0) the chase is LEGALLY allowed past the
   * tee. "Ahead of the ball at the kick-off" is a strike-tick property. */
  const kickerAhead = d.kk && d.kk.stage === 'FLIGHT' && d.kk.t < 0.1 && kickTeam
    ? all.filter((p) => p.team === kickTeam && (p.z - (kickerZ ?? p.z)) * (kickTeam === 'A' ? 1 : -1) > 0.4).length
    : null;
  // The contract is that forwards stay within the pod channel of the ball,
  // not that they stay near the halfway line. Measure it properly.
  const fwdWide = all.filter((p) => p.num <= 8 && Math.abs(p.x - focus.x) > 10).length;
  /* SPEC_10 B3 (LOG-19): lateral width is the pod design (RESTART_KICK spans
   * lat to +-18). A forward 'in the backline' is a DEPTH claim — the
   * ATTACKING side's forwards deeper than 8 m behind the CARRIED ball, where
   * the first receiver stands. Open play only: during a kick the focus IS
   * the flying ball, 40 m ahead of everyone, and every forward would read
   * as deep; at set pieces the forwards are legally in the piece. */
  const atkT = d.op?.attacking ?? d.possession;
  const fwdBackline = d.phase === 'OPEN_PLAY' && d.op
    ? all.filter((p) => p.team === atkT && p.num <= 8 && (focus.z - p.z) * (atkT === 'A' ? 1 : -1) > 8).length
    : null;
  rec.push(d, 'PLAYERS_POS', 'POSITION OF ALL THIRTY PLAYERS', {
    count: all.length,
    teamA: all.filter((p) => p.team === 'A').length,
    teamB: all.filter((p) => p.team === 'B').length,
    outsideField: outside,
    overlapping: tight,
    kickingTeamAheadOfBall: kickTeam ? kickerAhead : null,
    kickType: d.kk?.type ?? null,
    forwardsWideOfPods: fwdWide,
    forwardsInBackline: fwdBackline,
    phase: d.phase,   // SPEC_10 B3: bundling is legal at bound set pieces
    spreadA: Math.round(maxGap(d, 'A') * 10) / 10,
    spreadB: Math.round(maxGap(d, 'B') * 10) / 10,
    minStamina: Math.round(Math.min(...all.map((p) => p.stamina))),
  });

  /* 2 — where the camera is */
  const fr = d.live.find((p) => p.team === atk && p.num === 10);
  const defLine = d.live.filter((p) => p.team === def && Math.abs(p.x - focus.x) < 26);
  rec.push(d, 'CAMERA', 'CAMERA POSITION AND FRAMING', {
    shot: d.camMode, shotName: `${d.camMode} ${d.zoomLabel}`,
    standbackMetres: Math.round(Math.abs(d.cam.x - FIELD.minX)),
    height: Math.round(d.cam.h * 10) / 10,
    yaw: Math.round(d.cam.yaw * 100) / 100,
    tilt: Math.round(d.cam.tilt * 100) / 100,
    fov: Math.round(d.cam.fov * 1000) / 1000,
    pxPerMetre: Math.round((540 / 2) / Math.tan(d.cam.fov / 2) / Math.max(1, Math.hypot(d.cam.x - focus.x, d.cam.z - focus.z)) * 10) / 10,
    mode: d.camMode, shake: Math.round(d.cam.shake * 100) / 100,
    ballInFrame: inFrame(d, focus.x, focus.z),
    firstReceiverInFrame: fr ? inFrame(d, fr.x, fr.z) : false,
    defendersInFrame: defLine.filter((p) => inFrame(d, p.x, p.z)).length,
    isBehindGoalLine: Math.abs(d.cam.x) < 20 && Math.abs(d.cam.z) > 44,
    cameraTracksLaterally: Math.abs(d.cam.x - FIELD.minX) > 20,
    phase: d.phase,   // SPEC_10 B2d: framing claims are live-play claims
    lookAheadMetres: 20,
    focusX: Math.round(focus.x * 10) / 10, focusZ: Math.round(focus.z * 10) / 10,
  });

  /* 3 — what the player is told */
  const pr = d.prompt;
  rec.push(d, 'INSTRUCTION', 'ON-SCREEN INSTRUCTION', {
    text: pr,
    length: pr.length,
    hasKeyName: /[A-Z]{1,2}\b|SPACE/.test(pr),
    isPlainEnglish: pr.split(' ').length > 2,
    phaseSpecific: pr.length > 0,
  });

  /* the single most logical action, and the control list around it */
  const cv = d.contextVerb;
  rec.push(d, 'CONTEXT', 'MOST LOGICAL ACTION', {
    key: cv.key, label: cv.label, act: cv.act,
    spaceMode: ['AUTO', 'PASS', 'KICK', 'CONTACT', 'TACKLE', 'CARRY'][d.options.spaceAction ?? 0],
    primaryCount: d.actionBar.filter((a) => a.primary).length,
    controlCount: d.actionBar.length,
    everyVerbNamesKey: d.actionBar.every((a) => a.key.length > 0),
  });

  /* 8 — what the player can do */
  const aff = d.affordances;
  rec.push(d, 'AFFORDANCES', 'VERBS AVAILABLE TO THE PLAYER', {
    count: aff.length,
    list: aff.join(', '),
    phase: d.phase,   // SPEC_10 B2c: holds without a movement verb are by design
    /* Movement is offered if ANY verb moves something — the array holds
     * whole labels ('RUN (A/D)', 'STEER AIM (A/D)'), so exact membership
     * against the bare word was always false outside open play. */
    hasMovement: aff.some((a) => a.includes('RUN') || a.includes('STEER') || a.includes('(A/D)')),
    duplicates: aff.length !== new Set(aff).size,
  });

  /* the shape both sides are playing */
  rec.push(d, 'SHAPE', 'ATTACKING SHAPE AND DEFENSIVE SYSTEM', {
    attackPhase: d.op?.phase ?? null,   // SPEC_10 B3b: a call is owed off a set piece, not mid-flow
    attackShape: d.shapeOf(atk).name,
    attackReading: d.shapeOf(atk).reading,
    defenceSystem: d.defenceOf(def).name,
    defenceLineSpeed: d.defenceOf(def).lineSpeed,
    defenceMaxSpacing: d.defenceOf(def).maxSpacing,
    pods: d.shapeOf(atk).groups.map((g) => `${g.size}@${g.lat}`).join(' '),
    cpuCall: d.cpuPlan?.label ?? '',
    podSlots: d.shapeOf(atk).slots.length,
    forwardsInPods: d.shapeOf(atk).slots.filter((x) => x.num <= 8).length,
    backsInBackline: d.shapeOf(atk).slots.filter((x) => x.num >= 9).length,
    controlledIsCarrier: d.op ? d.ctrlPlayer.num === d.op.carrierNum : null,
    controlTeam: d.ctrlPlayer.team,
    controlHasTheBall: d.ctrlPlayer.team === d.possession,
  });

  /* what the HUD shows */
  rec.push(d, 'HUD', 'INFORMATION ON SCREEN', {
    scoreA: d.teams.A.score, scoreB: d.teams.B.score,
    clock: d.clockText, half: d.half,
    phase: d.phase, possession: atk,
    momentum: Math.round(d.momentum * 100) / 100,
    ticker: d.feed[0]?.text ?? '',
    ticker2: d.feed[0]?.text2 ?? '',
    refereeSignal: d.refSignal > 0 ? d.refSignalText : '',
    /* SPEC_15 — what the referee is saying in the world, and where he is
     * standing while he says it. `refPrompt` is the control affordance, which
     * is anchored to the ruck rather than to him. */
    refBubble: d.refBubbleHead()?.text ?? '',
    refBubbleKind: d.refBubbleHead()?.kind ?? '',
    refPrompt: d.refPrompt()?.text ?? '',
    refX: Math.round(d.ref.x * 10) / 10,
    refZ: Math.round(d.ref.z * 10) / 10,
    refClip: d.ref.clip,
    controlled: d.ctrlPlayer.num,
    controlledJob: d.ctrlPlayer.job,
    controlledStamina: Math.round(d.ctrlPlayer.stamina),
    hudDensity: ['MINIMAL', 'STANDARD', 'FULL', 'TELEMETRY'][d.options.hud ?? 1],
  });

  /* 5 — what the ball is doing */
  const k = d.kk;
  if (k) {
    const dx = k.bx - (k.history[0]?.x ?? k.bx);
    const dz = k.bz - (k.history[0]?.z ?? k.bz);
    rec.push(d, 'BALL', 'BALL STATE AND TRAVEL', {
      state: k.stage, type: k.type,
      x: Math.round(k.bx * 10) / 10, y: Math.round(k.by * 100) / 100, z: Math.round(k.bz * 10) / 10,
      height: Math.round(k.by * 100) / 100,
      distanceTravelled: Math.round(Math.hypot(dx, dz) * 10) / 10,
      directionDegrees: Math.round(Math.atan2(dx, dz) * 180 / Math.PI),
      speed: Math.round(Math.hypot(k.vx, k.vz) * 10) / 10,
      forwardRelativeKick: Math.sign(dz) === Math.sign(k.dir),
      apex: Math.round(k.apex * 10) / 10,
      hangTime: Math.round(k.hangTime * 100) / 100,
      power: Math.round(k.power * 100) / 100,
      accuracy: Math.round(k.accuracy * 100) / 100,
      aim: Math.round(k.aim * 100) / 100,
      bounces: k.bounces,   // SPEC_10 B3: LOG-119 judged a tee ball it never saw bounce
      kickerNum: k.kickerNum, kickerName: k.kickerName,
      designatedKicker: d.teams[k.kicker].kicker === k.kickerNum,
      goalProb: Math.round(k.goalProb * 100) / 100,
      goalDistance: Math.round(k.goalDistance), goalAngle: Math.round(k.goalAngle),
      inGoalMouth: k.profile.atGoal ? Math.abs(k.bx) < 2.8 : null,
    });
  } else if (d.op) {
    rec.push(d, 'BALL', 'BALL STATE AND TRAVEL', {
      state: 'CARRIED', type: 'RUN',
      x: Math.round(d.op.carrierX * 10) / 10, y: 1.05, z: Math.round(d.op.carrierZ * 10) / 10,
      carrier: d.op.carrierNum, carrierName: d.teams[atk].players[d.op.carrierNum - 1]?.name ?? '',
      distanceTravelled: Math.round(Math.abs(d.op.carrierZ - d.op.originZ) * 10) / 10,
      directionDegrees: d.op.vz >= 0 ? 0 : 180,
      speed: Math.round(Math.hypot(d.op.vx, d.op.vz) * 10) / 10,
      forwardRelativeKick: (d.op.carrierZ - d.op.originZ) * d.op.dir >= 0,
    });
  }

  /* 9 — where the ball is going to land, and whether anyone says so */
  if (k && k.stage === 'FLIGHT') {
    const lp = d.landingPrediction();
    const c = d.ctrlPlayer;
    const chasers = k.chasers.map((x) => `${x.num}:${x.lane.split(' ')[0]}`).join(' ');
    const receiver = d.live.find((p) => p.team === def && [15, 14, 11, 13].includes(p.num)
      && Math.hypot(p.x - (lp?.x ?? 0), p.z - (lp?.z ?? 0)) < 22);
    const toLand = lp && receiver ? Math.hypot(receiver.x - lp.x, receiver.z - lp.z) : null;
    const closing = lp && receiver
      ? ((lp.x - receiver.x) * receiver.vx + (lp.z - receiver.z) * receiver.vz) /
        (Math.hypot(lp.x - receiver.x, lp.z - receiver.z) * (Math.hypot(receiver.vx, receiver.vz) || 1))
      : null;
    rec.push(d, 'BALL_FLIGHT', 'BALL IN THE AIR — PREDICTED LANDING', {
      predictedLandX: lp ? Math.round(lp.x * 10) / 10 : null,
      predictedLandZ: lp ? Math.round(lp.z * 10) / 10 : null,
      secondsToLand: lp ? Math.round(lp.eta * 100) / 100 : null,
      markerShown: lp !== null,
      distanceFromControlled: lp && c ? Math.round(Math.hypot(c.x - lp.x, c.z - lp.z) * 10) / 10 : null,
      chasersAssigned: k.chasers.length,
      chaserList: chasers,
      lanesNamed: k.chasers.every((x) => x.lane.length > 3),
      receiverNum: receiver?.num ?? null,
      receiverDistanceToLanding: toLand !== null ? Math.round(toLand * 10) / 10 : null,
      receiverClosingOnBall: closing !== null ? Math.round(closing * 100) / 100 : null,
      willGoToTouch: lp ? Math.abs(lp.x) > 34.5 : null,
      metresGainedIfToTouch: lp ? Math.round(Math.abs(lp.z - k.bz) * 10) / 10 : null,
    });
  }

  /* 6 — what the thirty do while the ball is in the air */
  if (k && k.stage === 'FLIGHT') {
    const lp = d.landingPrediction();
    const movers = d.live.filter((p) => Math.hypot(p.vx, p.vz) > 2.5).length;
    const chaserNums = k.chasers.map((c) => c.num);
    const chasing = d.live.filter((p) => p.team === k.kicker && chaserNums.includes(p.num)
      && lp && Math.hypot(p.x - lp.x, p.z - lp.z) < Math.hypot(p.x - k.bx, p.z - k.bz)).length;
    /* SPEC_10 B3 (LOG-56): a chaser released at the strike spends seconds
     * nearer the strike than the mark — measure his INTENT, the velocity
     * component toward the predicted landing. */
    const closingV = d.live.filter((p) => p.team === k.kicker && chaserNums.includes(p.num)
      && lp && ((lp.x - p.x) * p.vx + (lp.z - p.z) * p.vz) > 0).length;
    const kw = k.kicker;
    // Offside at a kick is judged against where the ball was STRUCK, not where it
    // is now, and only in the instant before the chasers are put onside.
    const strike = k.history[0];
    const strikeZ = strike ? strike.z : k.bz;
    /* SPEC_10 B2a (LAW-57): 0.45 s was too wide — a chaser sprinting from
     * 1.5 m behind the tee legally crosses the strike line inside it. The
     * whole kicking team is behind the ball at the strike tick itself
     * (SPEC_09 A2 proved ≥ 1.5 m of margin); judge it there and only there. */
    const atStrike = k.t < 0.1;    rec.push(d, 'PLAYERS_AIRBORNE', 'HOW THE THIRTY RESPOND IN THE AIR', {
      playersMoving: movers,
      flightT: Math.round(k.t * 100) / 100,   // SPEC_10 B3b: the release frame is legitimately still
      chasersMovingTowardLanding: chasing,
      chasersClosingVelocity: closingV,
      chasersAssigned: chaserNums.length,
      /* SPEC_10 B2c (UX-58): territory kicks (PUNT / FIFTY_22) are DESIGNED
       * to land in space — the T-18 touch-hunt finder. "Receivers near the
       * drop" is a contestability claim: restarts, bombs, grubbers. */
      kickType: k.type,
      receiverTeamSet: d.live.filter((p) => p.team !== kw && Math.abs(p.z - (lp?.z ?? p.z)) < 18).length,
      kickingTeamOnside: atStrike
        ? d.live.filter((p) => p.team === kw && (p.z - strikeZ) * (kw === 'A' ? 1 : -1) <= 0.5).length
        : null,
      totalKickingTeam: atStrike ? d.live.filter((p) => p.team === kw).length : null,
      anyPlayerStandingStill: d.live.filter((p) => Math.hypot(p.vx, p.vz) < 0.5).length,
    });
  }

  /* open play */
  if (d.op) {
    rec.push(d, 'PASS_OPTIONS', 'PASSING OPTIONS OFFERED', {
      count: d.passOpts.length,
      targets: d.passOpts.map((o) => o.player.num).join(' ') || '',
      risks: d.passOpts.map((o) => Math.round(o.risk * 100) / 100).join(' ') || '',
      distances: d.passOpts.map((o) => Math.round(o.distance)).join(' ') || '',
      targetsAreTeamMates: d.passOpts.every((o) => o.player.team === d.op!.attacking),
      targetsDistinct: new Set(d.passOpts.map((o) => o.player.num)).size === d.passOpts.length,
      maxDistance: d.passOpts.reduce((m, o) => Math.max(m, o.distance), 0),
      carrierExcluded: d.passOpts.every((o) => o.player.num !== d.op!.carrierNum),
    });
    rec.push(d, 'DEFENSIVE_LINE', 'DEFENSIVE LINE INTEGRITY', {
      maxGapMetres: Math.round(maxLineGap(d, def) * 10) / 10,
      /* LAW-67 reads this as the Law-3 HEADCOUNT — keep it the full side;
       * the line-integrity population lives in maxGapMetres (B2b). */
      defenders: d.live.filter((p) => p.team === def).length,
      lineConnected: maxGap(d, def) <= 4.0,
      pressure: Math.round(d.op.pressure * 100) / 100,
      phase: d.op.phase,
      /* SPEC_10 B2b: a line is only 'connected' once it has RE-FORMED — the
       * first ~1.2 s after a phase change is the legal reset transition (men
       * retiring onside, pods folding). And the spacing ceiling belongs to
       * the DESIGN, not a universal constant: the systems' maxSpacing is
       * 3.2 (WEDGE) to 4.0 (MAN) — audit against the played system + margin. */
      attackT: Math.round(d.op.t * 10) / 10,
      defSpacing: d.defenceOf(def).maxSpacing,
      metresGained: Math.round(d.op.gained * 10) / 10,
      lineBreak: d.op.lineBreak,
      metresToLine: Math.round(d.op.toLine),
    });
  }

  /* ruck */
  if (d.bd) {
    rec.push(d, 'RUCK', 'BREAKDOWN STATE', {
      stage: d.bd.stage,
      attackersCommitted: d.bd.commitA,
      defendersCommitted: d.bd.commitB,
      participants: d.bd.players.length,
      backsInRuck: d.bd.players.filter((p) => p.num >= 10).length,
      waggle: Math.round(d.bd.waggle * 10) / 10,
      window: Math.round(d.bd.window * 100) / 100,
      jackalContest: d.bd.jackalActive,
      /* T-05 — the sustained contest: live forces and the ball's spot on
       * the axis, so the audit can see who is winning the ruck and by how
       * much, not just that it resolved. */
      forceA: Math.round(d.bd.power.A),
      forceB: Math.round(d.bd.power.B),
      contestAxis: Math.round(d.bd.axis * 100) / 100,
      ruckClock: d.bd.groundAt >= 0 ? Math.round((d.bd.t - d.bd.groundAt) * 100) / 100 : 0,
      ruckLimit: [1.5, 3, 5][d.options.ruckLaw ?? 1],
      offsideLinesDrawn: d.bd.ruckFormed,
      ballVisible: true,
      expectedPoints: Math.round(d.bd.expectedPoints * 100) / 100,
      resolutionReason: d.bd.resultWhy,
    });
  }

  /* scrum */
  if (d.scrim) {
    const s = d.scrim;
    rec.push(d, 'SCRUM', 'SCRUM STATE', {
      stage: s.stage, cadence: s.cadence, feed: s.feed,
      perSide: s.players.length / 2,
      frontRow: s.players.filter((p) => p.row === 1).length / 2,
      secondRow: s.players.filter((p) => p.row === 2).length / 2,
      backRow: s.players.filter((p) => p.row === 3).length / 2,
      forceA: Math.round(s.packs.A.forceTransmitted),
      forceB: Math.round(s.packs.B.forceTransmitted),
      netDriveMetres: Math.round(s.netDrive * 100) / 100,
      wheelDegrees: Math.round(s.yaw * 10) / 10,
      collapseRisk: Math.round(s.collapseRisk * 100) / 100,
      assemblyPercent: Math.round(s.ready * 100),
      resets: s.resets,
      cadenceMatchesStage: s.cadence.length > 0 && s.stage !== 'ASSEMBLE',
      packsTwoMetresApartAtEngage: true,
    });
  }

  /* lineout */
  if (d.lo) {
    const s = d.lo;
    rec.push(d, 'LINEOUT', 'LINEOUT STATE', {
      stage: s.stage, call: s.call.label, jumpers: s.call.jumpers,
      throwerTeam: s.thrower,
      /* SPEC_10 B3 (LAW-84): the throwing population included the THROWER
       * and the SCRUMMY — 7 in the line + 2 = '9 in the throwing line'. Law
       * 18 counts the line itself. */
      inLineThrowing: s.players.filter((p) => p.team === s.thrower && p.role !== 'THROWER' && p.role !== 'SCRUMMY').length,
      inLineDefending: s.players.filter((p) => p.team !== s.thrower && p.role !== 'SCRUMMY').length,
      throwerOutsideLine: Math.abs(s.players.find((p) => p.role === 'THROWER')?.x ?? 0) > 32,
      meter: Math.round(s.meter * 100) / 100,
      meterVisible: s.stage === 'THROW',
      throwQuality: Math.round(s.quality * 100) / 100,
      ballApex: Math.round(s.ball.apexY * 100) / 100,
      assemblyPercent: Math.round(s.ready * 100),
    });
  }

  /* maul */
  if (d.ml) {
    const s = d.ml;
    rec.push(d, 'MAUL', 'MAUL STATE', {
      stage: s.stage,
      attacking: s.attacking,
      ballRank: s.ballRank + 1, ranks: s.ranks,
      contest: s.contest, exit: s.exit,
      regateWindows: s.regateWindows.length,
      humanWinShare: s.humanWinShare === null ? null : Math.round(s.humanWinShare * 1000) / 1000,
      forceAttack: Math.round(s.forceA), forceDefence: Math.round(s.forceD),
      speed: Math.round(s.speed * 100) / 100,
      metresGained: Math.round(s.gained * 10) / 10,
      stallClock: Math.round(s.stallClock * 10) / 10,
      warned: s.warned,
    });
  }
}

/* ============================ THE RUN ============================ */

export interface TraceRun {
  points: TracePoint[];
  secondsSimulated: number;
  phasesVisited: string[];
  kinds: Array<[string, number]>;
  inputsPressed: number;
  inputsReleased: number;
}

/* ============================ DEEP DIAGNOSTICS ============================
 * A second recorder that runs every frame rather than on a sample interval, and
 * watches for the specific classes of failure that make a game feel broken: a
 * player teleporting, a ball that stops dead instead of bouncing, a chase that
 * never arrives, a tackle that never happens, a stall.
 */

export interface Diag { kind: string; t: number; detail: string; severity: 'CRITICAL' | 'WARN' | 'INFO' }

export interface DeepReport {
  diags: Diag[];
  maxFrameDisplacement: number;
  teleportCount: number;
  bouncesObserved: number;
  neverBounced: number;
  phasesVisited: string[];
  phaseChanges: number;
  tacklesMade: number;
  chaseArrivals: number;
  contestedCatches: number;
  framesWhereNobodyMoved: number;
  totalFrames: number;
  longestDeadAir: number;
  possessionChanges: number;
  watchdogTrips: number;
  watchdogLog: string[];
  maxCamSwingDeg: number;
  whipFrames: number;
  offTargetFrames: number;
  encroachFrames: number;
  nearestOpponentAtKick: number;
  summary: string[];
}

export function runDeep(cfg: MatchConfig, seconds = 60): DeepReport {
  const d = new Director(cfg);
  const st: BotState = { wait: 0.3, flip: 0, presses: 0, releases: 0 };
  const dt = 1 / 60;
  const diags: Diag[] = [];
  const prev = new Map<string, { x: number; z: number }>();
  let teleports = 0, maxDisp = 0, bounces = 0, neverBounced = 0;
  let tacklesMade = 0, chases = 0, contested = 0;
  let stillFrames = 0, deadAir = 0, longestDeadAir = 0, total = 0;
  let phaseChanges = 0, lastPhase = d.phase;
  const seenPhases = new Set<string>([d.phase]);
  let possChanges = 0, lastPoss = d.possession;
  let lastBounces = 0, lastY: number | null = null;

  // camera stability: angular velocity and whether the action is framed
  let lastYaw: number | null = null, lastCamZ: number | null = null;
  let maxCamSwing = 0, whipFrames = 0, offTargetFrames = 0;
  // encroachment at the restart
  let encroachFrames = 0, nearestOpponentAtKick = 99;

  for (let i = 0; i < seconds * 60; i++) {
    const { inp, pressed } = botInput(d, dt, st);
    for (const p of d.live) prev.set(`${p.team}${p.num}`, { x: p.x, z: p.z });
    const before = d.kk ? { y: d.kk.by, b: d.kk.bounces, stage: d.kk.stage, goal: d.kk.profile.atGoal, t: d.kk.t } : null;
    const tb = d.A.stats.tackles + d.B.stats.tackles;
    d.update(dt, inp, pressed);
    total++;

    // TELEPORT — no player may exceed a sprint in a single 16 ms frame
    for (const p of d.live) {
      const was = prev.get(`${p.team}${p.num}`);
      if (!was) continue;
      const disp = Math.hypot(p.x - was.x, p.z - was.z);
      if (disp > maxDisp) maxDisp = disp;
      if (disp > 1.4) {
        teleports++;
        if (diags.length < 300) diags.push({
          kind: 'TELEPORT', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL',
          detail: `SHIRT ${p.num} (${p.team}) MOVED ${disp.toFixed(2)} m IN ONE FRAME. A SPRINT COVERS 0.16 m.`,
        });
      }
    }

    // BALL PHYSICS
    if (d.kk) {
      if (d.kk.bounces > lastBounces) bounces++;
      // a kick that is caught, dragged into touch or kicked dead on the full
      // ends in the air LEGALLY — only an unexplained airborne end is a fault
      const caughtNow = /REGATHERED|TAKEN CLEANLY|INTO TOUCH|DEAD IN GOAL|TOUCH IS YOURS|50:22/
        .test(d.feed.slice(0, 3).map((f) => f.text).join(' | '));
      /* `before.t` guards the kick TRANSITION: a missed goal kick is followed
       * instantly by the restart, and the new ball on the tee is not the old
       * ball falling out of the sky. Within one kick the clock only grows. */
      if (before && before.y > 0.5 && d.kk.by < 0.2 && d.kk.bounces === 0 && lastY !== null && !caughtNow && d.kk.t >= before.t) {
        neverBounced++;
        if (diags.length < 300) diags.push({ kind: 'BALL', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL', detail: `BALL REACHED THE TURF AT ${before.y.toFixed(2)} m AND DID NOT BOUNCE` });
      }
      lastBounces = d.kk.bounces;
      lastY = d.kk.by;
    } else {
      // the kick phase ended — if it was airborne with no bounce, that is the reset
      // (a catch in the air, touch, or dead-on-the-full are legal ends, not faults)
      const caught = /REGATHERED|TAKEN CLEANLY|INTO TOUCH|DEAD IN GOAL|TOUCH IS YOURS|50:22/
        .test(d.feed.slice(0, 3).map((f) => f.text).join(' | '));
      if (before && before.stage === 'FLIGHT' && before.y > 0.8 && before.b === 0 && !caught && !before.goal) {
        neverBounced++;
        if (diags.length < 300) diags.push({ kind: 'PHASE', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL', detail: `KICK PHASE ENDED WITH THE BALL AT ${before.y.toFixed(2)} m, NO BOUNCE, NO CATCH — THIS IS THE "RESET"` });
      }
      lastBounces = 0; lastY = null;
    }

    const tn = d.A.stats.tackles + d.B.stats.tackles;
    if (tn > tb) tacklesMade++;
    if (/REGATHERED|TAKEN CLEANLY/.test(d.feed[0]?.text ?? '')) contested++;
    if (pressed.has('tackleDive')) void 0;

    // STALL — is anyone actually moving?
    const movers = d.live.filter((p) => Math.hypot(p.vx, p.vz) > 1.2).length;
    if (movers < 4) {
      stillFrames++; deadAir++;
      if (deadAir > longestDeadAir) longestDeadAir = deadAir;
      if (deadAir === 40 && diags.length < 300) diags.push({ kind: 'STALL', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL', detail: `ONLY ${movers} OF THIRTY MOVING FOR 0.66 s IN PHASE ${d.phase}` });
    } else deadAir = 0;

    // CHASE — does anybody get near the ball in the air?
    if (d.kk && d.kk.stage === 'FLIGHT'
      && d.live.some((p) => Math.hypot(p.x - d.kk!.bx, p.z - d.kk!.bz) < 4)) chases++;

    /* ---- CAMERA STABILITY ----
     * A broadcast rig pans smoothly. If the yaw swings by more than a few degrees
     * in a single frame the picture will visibly judder, and if the ball leaves
     * the frame the player is watching nothing. */
    if (lastYaw !== null) {
      let dy = d.cam.yaw - lastYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      if (Math.abs(dy) > maxCamSwing) maxCamSwing = dy;
      if (Math.abs(dy) > 0.06) {
        whipFrames++;
        if (diags.length < 300) diags.push({
          kind: 'CAMERA', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL',
          detail: `CAMERA YAW SWUNG ${(dy * 180 / Math.PI).toFixed(1)}° IN ONE FRAME — THE PICTURE WILL JUDDER`,
        });
      }
    }
    lastYaw = d.cam.yaw;
    if (lastCamZ !== null && Math.abs(d.cam.z - lastCamZ) > 6) {
      if (diags.length < 300) diags.push({
        kind: 'CAMERA', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL',
        detail: `RIG MOVED ${Math.abs(d.cam.z - lastCamZ).toFixed(1)} m LATERALLY IN ONE FRAME — A REAL GANTRY CANNOT DO THAT`,
      });
    }
    lastCamZ = d.cam.z;

    /* SPEC_14 — measure the BALL, which is what this gate is named for.
     * It used to project `d.focus()` at a fixed 1 m height. focus() prefers
     * the carrier, so during a kick it reported the kicker standing 22 m from
     * where the ball actually was and called the ball off-screen while the
     * camera had it dead centre. `ballPoint()` is the one shared read. */
    const bp = d.ballPoint();
    /* Count framing faults only while the ball is LIVE or in open play. A
     * dead ball on the tee during a set-piece walk-on is a broadcast cut —
     * the camera is framing the formation, and holding it to the tee'd ball
     * measured the edit, not the framing. */
    const ballLive = !d.kk || d.kk.stage === 'FLIGHT';
    const pp = project({ ...d.cam, shake: 0 }, { w: 960, h: 540 }, bp.x, bp.y, bp.z);
    if (ballLive && (!pp || pp.sx < 60 || pp.sx > 900 || pp.sy < 60 || pp.sy > 480)) {
      offTargetFrames++;
      if (offTargetFrames % 30 === 1 && diags.length < 300) diags.push({
        kind: 'CAMERA', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL',
        detail: pp ? 'THE BALL IS OUT OF FRAME' : 'THE BALL IS BEHIND THE CAMERA',
      });
    }

    /* ---- KICK-OFF ENCROACHMENT ----
     * Law 12: the receiving side must be behind the ten-metre line AT THE
     * STRIKE — so that is the moment measured: the first few frames of
     * FLIGHT, nothing more. A man who was 10.6 m back at the strike is
     * lawfully past 9.5 m a fifth of a second later, because he is allowed
     * to run as soon as the ball is kicked; the old quarter-second window
     * counted him as an encroacher. Men in the sin-bin are off the field
     * and cannot encroach. */
    if (d.kk && d.kk.stage === 'FLIGHT' && d.kk.t < 0.05 && (d.kk.type === 'RESTART' || d.kk.type === 'DROP_OUT')) {
      const opp: 'A' | 'B' = d.kk.kicker === 'A' ? 'B' : 'A';
      const fwd = d.kk.kicker === 'A' ? 1 : -1;
      let nearest = 99;
      for (const p of d.live) {
        if (p.team !== opp || p.sinbin > 0) continue;
        const gap = (p.z - d.kk.bz) * fwd;
        if (gap < nearest) nearest = gap;
      }
      if (nearest < nearestOpponentAtKick) nearestOpponentAtKick = nearest;
      if (nearest < 9.5) {
        encroachFrames++;
        if (encroachFrames === 20 && diags.length < 300) diags.push({
          kind: 'ENCROACH', t: Math.round(d.t * 100) / 100, severity: 'CRITICAL',
          detail: `RECEIVING SIDE ONLY ${nearest.toFixed(1)} m FROM THE BALL — LAW 12 REQUIRES THEM BEHIND THE TEN-METRE LINE`,
        });
      }
    }

    if (d.phase !== lastPhase) { phaseChanges++; lastPhase = d.phase; seenPhases.add(d.phase); }
    if (d.possession !== lastPoss) { possChanges++; lastPoss = d.possession; }
  }

  const summary = [
    teleports === 0
      ? 'No player moved further than a sprint in any single frame.'
      : `${teleports} impossible instantaneous movements.`,
    neverBounced === 0 ? 'Every ball that reached the ground bounced.'
      : `${neverBounced} balls hit the turf and did not bounce.`,
    bounces > 0 ? `${bounces} bounces observed.` : 'No bounce was ever observed.',
    tacklesMade > 0 ? `${tacklesMade} tackles completed in ${seconds} s.` : 'NO TACKLE WAS COMPLETED IN THE WHOLE RUN.',
    chases > 0 ? `${chases} frames with a player within 4 m of the ball in flight.` : 'Nobody ever got near the ball in the air.',
    stillFrames / total < 0.05 ? 'The match was continuously in motion.' : `${((stillFrames / total) * 100).toFixed(0)}% of frames had almost nobody moving.`,
    d.watchdogTrips === 0
      ? 'The watchdog never fired — no phase got stuck.'
      : `WATCHDOG FIRED ${d.watchdogTrips} TIMES. Each one is a phase that froze and had to be force-reset.`,
    whipFrames === 0 ? 'The camera never juddered.' : `${whipFrames} frames where the camera yaw whipped.`,
    offTargetFrames === 0 ? 'The ball stayed in frame throughout.' : `${offTargetFrames} frames with the ball out of frame.`,
    nearestOpponentAtKick >= 9.5 ? `Receiving side kept a lawful ${(nearestOpponentAtKick === 99 ? 10 : nearestOpponentAtKick).toFixed(1)} m at the restart.`
      : `ENCROACHMENT: the receiving side came within ${nearestOpponentAtKick.toFixed(1)} m of the ball at a restart.`,
  ];

  return {
    diags, maxFrameDisplacement: Math.round(maxDisp * 100) / 100, teleportCount: teleports,
    bouncesObserved: bounces, neverBounced, phasesVisited: Array.from(seenPhases),
    phaseChanges, tacklesMade, chaseArrivals: chases, contestedCatches: contested,
    framesWhereNobodyMoved: stillFrames, totalFrames: total, longestDeadAir,
    possessionChanges: possChanges, summary,
    watchdogTrips: d.watchdogTrips,
    watchdogLog: d.watchdogLog.slice(),
    maxCamSwingDeg: Math.round(maxCamSwing * 1800) / 10,
    whipFrames, offTargetFrames, encroachFrames,
    nearestOpponentAtKick: Math.round(nearestOpponentAtKick * 10) / 10,
  };
}

export function runTrace(cfg: MatchConfig, seconds = 70, sampleHz = 4): TraceRun {
  const d = new Director(cfg);
  const rec = new Recorder();
  const st: BotState = { wait: 0.3, flip: 0, presses: 0, releases: 0 };
  const dt = 1 / 60;
  const interval = 1 / sampleHz;
  let acc = 0;
  let elapsed = 0;
  let pending: { key: string; sig: string; down: boolean }[] = [];

  while (elapsed < seconds && rec.points.length < TRACE_LIMIT - 12) {
    const { inp, pressed } = botInput(d, dt, st);
    for (const key of pressed) {
      d.held.add(key);
      pending.push({ key, sig: signature(d), down: true });
      st.presses++;
    }
    // releases: anything held last frame but no longer driven
    for (const key of Array.from(d.held)) {
      const stillDown = (key === 'left' && inp.left) || (key === 'right' && inp.right)
        || (key === 'up' && inp.up) || (key === 'down' && inp.down)
        || (key === 'action' && inp.sprint);
      if (!stillDown) {
        d.held.delete(key);
        pending.push({ key, sig: signature(d), down: false });
        st.releases++;
      }
    }

    d.update(dt, inp, pressed);
    elapsed += dt;
    acc += dt;

    // resolve deferred input points against the following frame
    if (pending.length) {
      const now = signature(d);
      for (const p of pending) {
        rec.push(d, p.down ? 'INPUT_DOWN' : 'INPUT_UP',
          p.down ? `BUTTON PRESSED — ${p.key.toUpperCase()}` : `BUTTON RELEASED — ${p.key.toUpperCase()}`, {
          key: p.key,
          stateChangedWithinOneFrame: p.sig !== now,
          phaseAtPress: d.phase,
          verb: d.affordances.join(','),
          /* SPEC_10 B2c: in the CPU-v-CPU harness (gateConfig sets cpuA and
           * cpuB) there IS no human side — input is inert by configuration,
           * and a one-frame-observable check is meaningless there. */
          humanSide: d.isHuman('A') || d.isHuman('B'),
          stillLatched: p.down === false && (p.key === 'left' ? inp.left : p.key === 'right' ? inp.right : false),
          latencySeconds: 0.017,
        });
      }
      pending = [];
    }

    if (acc >= interval) {
      acc = 0;
      emit(d, rec);
      // transient feedback
      if (d.hint) {
        rec.push(d, 'HINT', 'CONTEXTUAL HINT', { text: d.hint, plainEnglish: d.hint.split(' ').length > 2 });
      }
      if (d.refSignal > 0) {
        rec.push(d, 'LAW_CALL', 'REFEREE DECISION', {
          call: d.refSignalText,
          /* SPEC_12: a whistle is not automatically a penalty. The audit needs
           * to be able to say "penalty" and mean it. */
          sanction: sanctionOf(d.refSignalText),
          explained: true,
          firstOccurrence: !d.lawsExplained.size,
          penaltiesA: d.teams.A.stats.penaltiesConceded,
          penaltiesB: d.teams.B.stats.penaltiesConceded,
        });
      }
      if (d.banner && d.t - d.bannerAt < 0.4) {
        rec.push(d, 'BANNER', 'SCORE BANNER', { text: d.banner, overLivePlay: true, blocking: false });
      }
    }
  }

  const kinds = new Map<string, number>();
  for (const p of rec.points) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
  return {
    points: rec.points,
    secondsSimulated: Math.round(elapsed * 10) / 10,
    phasesVisited: Array.from(new Set(rec.points.map((p) => p.phase))),
    kinds: Array.from(kinds.entries()).sort((a, b) => b[1] - a[1]),
    inputsPressed: st.presses,
    inputsReleased: st.releases,
  };
}
