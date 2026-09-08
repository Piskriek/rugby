/**
 * DIRECTOR — the match engine, rebuilt around a live thirty-player model.
 *
 * Design thesis, after Jonah Lomu Rugby (Rage Software, 1997):
 *   "We wanted a game that stayed true to the rules, but was easy to pick up
 *    and play without a complete understanding of all rugby's ins and outs."
 *
 * Consequences in this file:
 *  - Thirty players each hold a written role contract and are re-targeted every
 *    frame. There is no such thing as an unassigned player.
 *  - Set pieces assemble in world space. Nothing loads, nothing cuts.
 *  - A pass is always thrown to a named player and always arrives to a moving man.
 *  - Inputs are sampled every frame and never queued.
 *  - Difficulty changes decisions, never physics.
 */

import {
  Camera, FIELD, PitchConditions, pitchConditions,
} from '../render/retro';
import { CamMode, ZoomSetting, mapInputToWorld, KICKOFF_CENTER, blendSubjectToBall } from './camera';
import { TutorialState, newTutorial, stepAt, TUTORIAL } from './tutorial';
import {
  shapeById, defenceById, DEFENCE_CHANNELS, ARCHETYPE_SHAPE,
  callPlay, zoneOf, PlayCall, RESTART_RECEIVE, RESTART_KICK,
  AttackShape, DefenceSystem, forwardAttackDepth,
} from './shapes';
import {
  Nation, TEAM_BY_ID, KITS, FORMATION_BY_ID, DIFFICULTY_TABLE, AI_ARCHETYPES,
  POINTS, SquadPlayer, REFEREE_CALLS, DEFAULT_SLIDERS, OPTION_ITEMS,
} from './data';
import {
  contractFor, PhaseName, RoleContract,
} from './jlr';
import {
  Live, steer, separate, attackMark, defenceMark, ShapeInput, passOptions, PassOption,
  ruckDistributor, assignReceiver,
  maxSpeed, FORWARDS,
} from './intelligence';
import type { RapierWorld, TabsPlayer, BallCarrier } from '../core/physics/RapierWorld';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import {
  forwardAttackDepthPlanFailures, forwardAttackPlayerWriteFailures,
  forwardAttackStateWriteFailures, snapshotForwardAttackPlayer,
} from './forwardAttackGates';
import type {
  ForwardAttackGateFailure, ForwardAttackGateReporter, ForwardAttackGateValue,
  ForwardAttackPlayerField,
} from './forwardAttackGates';
import { MAUL_REGATE_WINDOW_SECONDS, MAUL_TRANSFER_PASS_START, MAUL_RANKS_PER_SIDE, maulClusterMass, maulTailMark } from './maulRegate';
import type { MaulBind, MaulCommit, MaulContestControl, MaulExitState } from './maulRegate';
/* type-only: hands.ts imports this file for BreakdownState, and a runtime cycle
 * between the director and an engine module is the sort of thing a bundler
 * resolves differently to the order you tested in. */
import type { HandsState } from './engine/hands';
import { MatchAudio } from './audio';
import { updateCamera } from './engine/camera';
import { makeCraft, stepCraft, clearCraft, type BallCraft } from './engine/ballcraft';
import { eligibleToGather, canPlayBall, coordinateBall, readBall, makeBallBehaviour, clearBallBehaviour, type BallBehaviour, type KickChaseLaw } from './engine/ballAwareness';
import { makeBall, weldBall, BALL_MAJOR, type BallBody } from './engine/ballPhysics';
import {
  RefState, RefBubble, BubbleKind, BUBBLE_PRIORITY, newReferee, stepReferee,
  stepAdvantageWatch, openAdvantageWatch, advantageWindowEngineS,
  insideOwnTwentyTwo, ownTwentyTwoLineZ, judgeAerialTackle, tickSinBin, sinBinMark,
  sinBinMayReturn, shouldContestAerial, AERIAL_JUMP_IMPULSE, AERIAL_CONTEST_MIN_BALL_Y,
  type AdvantageWatch, type AdvantageSensor,
} from './engine/referee';
import {
  RuckGateLedger, ruckGateGeometry, ruckGateRoster, ruckGateWindow,
  ruckClusterOf, SIDE_ENTRY_CALL, GATE_SETTLE_S, gateBlows, GATE_STRICTNESS,
  RUCK_GATE_PROFILE,
} from './engine/gates';
import { situationOf, beatOf, datasetOffset, SITUATION_LATERAL } from './engine/behaviour';
import {
  evaluateForwardTree, routeThroughGate, plantedUrgency, isForwardShirt,
  scrumBindProfile, frontRowStability,
  LINEOUT_LINE_THROWING, LINEOUT_LINE_DEFENDING, lineoutRole, ROUTE_FIELD_HALF_M,
  type PackContext, type PackMark,
} from './engine/forwardPack';
import {
  evaluateBacklineTree, kickPoseOf, nineBaseZ, nineBaseX,
  isBacklineShirt, type BacklineContext,
} from './engine/backline';
import { commentate, commentarySequencer } from './engine/commentary';
import { upScrum, scrumSlots, upLineout, releaseThrow, upMaul, maulUseItClock, maulUseItCall, buildMaulBinds } from './engine/setpieces';
import {
  liveOffsideLines, penetrationOf, offsideVerdict, STRICTNESS, OffsideLedger,
  legalMarkZ, legalZFor, clampPitchZ, CLEAN_MARGIN_METRES,
  insideCorridor, clampOntoLegalSide, scrumhalfReleased, preReleaseWhistle,
  ruckOffsidePlanes,
  type OffsideLine, type StrictnessProfile,
} from './engine/offside';
import {
  beginPenalty, resolvePenalty, lawCall, card,
  tryGroundingSpot, goalLineZ, TOUCH_IN_GOAL_X_M, CONVERSION_TEE_MIN_M, CONVERSION_TEE_MAX_M,
} from './engine/laws';
import { endHalf, resumeSecondHalf, endMatch } from './engine/clock';
import { upKick, launch, kickLanded } from './engine/kick';
import { upBreakdown, startBreakdown, inKineticImpact, teardownBreakdown } from './engine/breakdown';
import { sampleSlot, planSlotOf } from './engine/breakdownPlan';
import type { LatchState } from './engine/latch';
import { inLatch, isLatching, clearLatch, DIVE_MISS_RECOVERY, findAerialChallenge } from './engine/latch';
import { aerialLandingMark, isAirborne, AERIAL_STANDING_REACH_M } from './engine/approach';
import { isGoalKickState, goalKickMark, scrumFaceSign } from './behaviour/setpiece-overrides';
import { inEchelon, echelonTargetZ, echelonDepthBehindTen, pendulumMark } from './behaviour/backline-echelon';
import { upOpen, contextLabel, doStep, doFend, doDummy, doDive, doPass, doPassToNum as throwPassToNum, cpuCarrier } from './engine/open';
import { LatchSystem } from './engine/latch';

/* ============================ INPUT ============================ */

export interface Input {
  left: boolean; right: boolean; up: boolean; down: boolean;
  run: boolean; sprint: boolean;
  passL: boolean; passR: boolean; cutL: boolean; cutR: boolean;
  kick: boolean; grubber: boolean; drop: boolean;
  contact: boolean; fend: boolean; step: boolean; dummy: boolean;
  tackleDive: boolean; tackleSmother: boolean; switchPlayer: boolean;
  action: boolean;
  /* HUMAN DISTRIBUTION — the T key. A human carrier (usually the nine)
   * releases down the echelon: 9 → 10 → 12 → …, one key, no side to pick. */
  distribute: boolean;
  /* SPEC_25 — the catch/punt verbs. `handsUp` is a HOLD (right mouse), `secure` is a
   * HOLD whose release is the drop (left mouse), and `punt` is the edge press of the
   * kick key inside the drop window. They are here rather than in a side channel so a
   * gamepad, a tutorial script and the headless probes can drive the mechanic exactly
   * the way the mouse does. */
  handsUp: boolean; secure: boolean; punt: boolean;
}
export const NO_INPUT: Input = {
  left: false, right: false, up: false, down: false, run: false, sprint: false,
  passL: false, passR: false, cutL: false, cutR: false,
  kick: false, grubber: false, drop: false,
  contact: false, fend: false, step: false, dummy: false,
  tackleDive: false, tackleSmother: false, switchPlayer: false, action: false, distribute: false,
  handsUp: false, secure: false, punt: false,
};

/** TARCS — the entry-gate fallback: a ruck with no cached roster has no gate,
 *  and an empty set is exactly that. Shared constant, zero per-frame cost. */
const EMPTY_GATE_ROSTER: ReadonlySet<string> = new Set<string>();

/* ============================ PHASES & STATE ============================ */

export type Phase =
  | 'SCRUM' | 'LINEOUT' | 'KICK' | 'OPEN_PLAY' | 'MAUL' | 'BREAKDOWN'
  | 'CHAOS_SCRIM'
  | 'REPLAY' | 'LINEOUT_REPLAY' | 'KICK_REPLAY' | 'MAUL_REPLAY' | 'BREAKDOWN_REPLAY';

export interface Actor {
  id: number; team: 'A' | 'B' | 'REF'; num: number;
  rx: number; rz: number; rf: number;
  /** A waiting receiver/collector watches the real ball, not a stale run heading. */
  ballLookX?: number; ballLookZ?: number;
  /** PLAYER CONTROLS — reticle aim is streamed to the procedural arm layer.
   * Coordinates stay in logical pitch metres; the renderer applies its scale. */
  aiming?: boolean; aimX?: number; aimY?: number; aimZ?: number;
  /** Vertical jump offset, logical metres above the turf. */
  ry?: number;
  renderClip: string; clipT: number; jitter: number;
  ring: number;     // 0 none, 1 controlled, 2 pass target
  size: number;     // T-39 per-player build, 0.92 .. 1.12
  turnT: number;    // playtest 2: the turn beat, 0..1
  /** CHAOS_SCRIM — presentation-only park flag for bodies outside the 14-body scrim. */
  hidden?: boolean;
}

interface Pack { force: number; forceTransmitted: number; waggle: number; fitness: number }

export interface ScrumSlot { num: number; team: 'A' | 'B'; x: number; z: number; row: number; down: boolean }

export interface ScrumState {
  t: number;
  stage: 'ASSEMBLE' | 'MARK' | 'FORM' | 'CROUCH' | 'BIND' | 'SET' | 'ENGAGE' | 'STEADY' | 'FEED' | 'STRIKE' | 'DRIVE' | 'BASE' | 'OUT' | 'DONE';
  outcome: string;
  feed: 'A' | 'B';
  players: ScrumSlot[];
  nine: { team: 'A' | 'B'; x: number; z: number }[];
  ball: { x: number; y: number; z: number; state: string };
  packs: { A: Pack; B: Pack };
  yaw: number; netDrive: number; collapseRisk: number;
  /** KINEMATIC TUNNEL — the tunnel's velocity along the engagement axis
   *  (m/s, +z). `netDrive` is its integral: the packs, the ball and the
   *  base exits all displace by it (see upScrum's shove contest). */
  tunnelV: number;
  strikeClock: number; wheelDir: number; resets: number;
  ready: number; cadence: string;
  /** FORWARD PACK — 0..1, how bound and how low the two front rows are this
   *  frame (engine/forwardPack.ts). Written by placeBound, read by upScrum. */
  frontRowStability?: number;
}

export interface LineoutState {
  t: number;
  stage: 'ASSEMBLE' | 'CALL' | 'THROW' | 'CONTEST' | 'CATCH' | 'OUT' | 'DONE';
  markZ: number; side: number;
  call: { targetX: number; label: string; jumpers: number; kind: string };
  /** `vz` is the throw's longitudinal component: a meter off the sweet spot
   *  carries the ball off the tunnel line, so the flight is judged on its
   *  real angle, not just its timing. */
  ball: BallBody & { state: string; heldBy: number; apexY: number };
  players: { id: number; num: number; team: 'A' | 'B'; x: number; z: number; handY: number; role: string }[];
  history: { ballX: number; ballY: number }[];
  winner: boolean; contestMargin: number;
  thrower: 'A' | 'B'; quality: number; callIdx: number; meter: number; meterDir: number; meterOn: boolean;
  /** radians the released throw made with the tunnel axis, and the
   *  referee's verdict on it (engine/referee.ts, Law 19). */
  throwAngle: number; throwCrooked: boolean;
  driveCall: boolean; ready: number;
}

export type KickType = 'PUNT' | 'GRUBBER' | 'DROP_GOAL' | 'GOAL' | 'RESTART' | 'DROP_OUT' | 'BOMB' | 'FIFTY_22';

export interface KickState {
  chaseLaw?: KickChaseLaw;
  /** Last real body/boot contact, for touch awards after a deflection. */
  lastTouch?: { team: 'A' | 'B'; num: number };
  t: number;
  /** RC2-3 — restart shot clock. Accrues only while the kicker is free to
   *  strike (opposition back ten, formation set), so a lawful wait is never
   *  punished. Undefined outside RESTART/DROP_OUT. */
  delayT?: number;
  stage: 'SETUP' | 'FANFARE' | 'WALKUP' | 'AIM' | 'METER' | 'FLIGHT' | 'RESULT';
  type: KickType;
  bx: number; by: number; bz: number;
  vx: number; vy: number; vz: number;
  /** Shared spheroid solver; scalar coordinates above are the laws/replay API. */
  body: BallBody;
  fromHand: boolean;
  dir: number; kicker: 'A' | 'B'; kickerNum: number; kickerName: string;
  history: { x: number; y: number; z: number }[];
  profile: { label: string; atGoal: boolean };
  goalProb: number; goalDistance: number; goalAngle: number;
  hangTime: number; apex: number; distance: number;
  power: number; accuracy: number; meter: number; meterDir: number; meterOn: boolean;
  aim: number;               // -1..1 lateral aim
  landX: number; landZ: number;
  bounces: number; result: string;
  chasers: { num: number; lane: string }[];
  /** SPEC_07 — the tee mark this kick was launched from. Law 12's ten-metre
   * rule is measured from here, not from wherever the ball has rolled to. */
  markX: number; markZ: number;
  /** SPEC_07 — latched once a RESTART has travelled ten metres into the
   * receiving half (in flight or on the roll); before that, neither side
   * may play the ball (Law 12.9). */
  tenCrossed?: boolean;
  /** SPEC_07 — goal-post geometry at the plane crossing: the measured
   * clearances over the crossbar and inside the uprights. */
  crossing?: { x: number; y: number; z: number; uprightM: number; barM: number };
  /** T-16/NO-TELEPORT. At a restart the thirty walk to their formation slots
   *  under steer(); they are never snapped into place. The kick is not struck
   *  (by the CPU) until the formation has assembled — Law 12's ten metres is
   *  walked back, not teleported back. */
  form?: Array<{ num: number; team: 'A' | 'B'; x: number; z: number }>;
  formReady?: number;
  /** T-50 RESTART VARIETY — per-kick hang override. A short contestable hangs
   *  like a bomb (chasers arrive under it); a squib recovery is driven flat.
   *  0 = type default. launch() reads it; nothing else touches it. */
  hangOv?: number;
  /** penalty kick to touch — an uncontested strike at full range (T-18) */
  fromPenalty?: boolean;
  /** SPEC_09: set (once) if the thaw branch ever held the freeze because the
   * six-chaser commitment was incomplete at the strike — the log-once flag for
   * a structural invariant that must never fire. */
  thawHeld?: boolean;
  /* TACTICAL KICKING — the three facts Law 18.6 / 18.9 / 18.11 are judged
   * from, latched by the flight loop as they happen rather than reconstructed
   * from a landing snapshot:
   *   `groundBounces` — bounces IN THE FIELD OF PLAY (the ball body's own
   *      counter keeps counting after it has crossed the line, which would
   *      turn a kick straight out into an indirect one);
   *   `defTouched`    — a DEFENDER got a hand or a boot on it, which kills
   *      the 50:22 dead;
   *   `markEligible`  — the kick was taken from inside the kicker's own 22,
   *      the band that keeps the gain of ground on a kick straight to touch. */
  groundBounces?: number;
  defTouched?: boolean;
  fromOwn22?: boolean;
}

/** T-08 — one broadcast event: what happened, where, when. Presentation only. */
export type BroadcastEvent =
  | { t: number; type: 'TACKLE'; x: number; z: number; force: number }
  /** T-40 — a clearout landed. `force` is the m/s shoved into the target, so the
   *  hit and the sound scale with the man who arrived rather than being a fixed
   *  cue per ruck. Emitted by the breakdown plan, never by the renderer. */
  | {
    /** The cleanout that put a man on the floor. `num` is the man HIT (the one
     *  presentation has to react), `force` is for the thud, `power` is the shove
     *  in m/s so the renderer can tell a step-back from a knock-down without
     *  inventing its own threshold and disagreeing with the engine's. */
    t: number; type: 'CLEANOUT'; team: 'A' | 'B'; x: number; z: number; num: number; force: number; power: number
  }
  | { t: number; type: 'LINE_BREAK'; x: number; z: number }
  | { t: number; type: 'KICK'; x: number; z: number }
  | { t: number; type: 'TRY'; x: number; z: number; num: number }
  | { t: number; type: 'CARD'; x: number; z: number }
  | { t: number; type: 'SCRUM_PEN'; x: number; z: number }
  | { t: number; type: 'TURNOVER'; x: number; z: number };

export interface OpenPlayState {
  t: number; attacking: 'A' | 'B'; dir: number;
  carrierX: number; carrierZ: number; carrierNum: number;
  vx: number; vz: number;
  supports: { num: number; x: number; z: number; depth: number }[];
  defenders: { num: number; x: number; z: number; commit: number; role: string }[];
  gained: number; toLine: number; z: number; pressure: number; phase: number;
  lineBreak: boolean; current: { label: string };
  burst: number; burstCd: number; stepCd: number; fendCd: number;
  /** T-31/T-30 — seconds of committed goal-line dive left (R-07: launch
   * from 2-3 m out). While live, the launch was the commitment: no
   * steering, momentum carries him the last metre. */
  dive: number;
  originZ: number; originX: number;
  aiTimer: number; aiIntent: string; aiPlay: string; aiPhasePlan: number;
  /** T-18: defenders who have already had their one slip-roll this episode */
  beatTried?: Set<number>;
  /* LATCH-AND-DRAG — the live latch, or undefined in free running. A
   * defender who reaches the contact radius does not end the episode any
   * more: he HANGS on, the carrier churns forward under a heavy drag
   * penalty, and the takedown fires when the momentum dies or the drag timer
   * expires. See engine/latch.ts. One at a time — a second arriving defender
   * joins the takedown through the ordinary breakdown crew. */
  latch?: LatchState;
  /* Playtest P1.4: from-hand kicks charge ON THE RUN. 0 = not kicking;
   * >0 = the key is held and power is building; released = strike. The
   * match never pauses for a punt — only tee kicks get the ritual. */
  kickCharge: number;
  kickKind: 'PUNT' | 'GRUBBER' | 'DROP_GOAL' | '';
  /* HUMAN DISTRIBUTION — the held pass charge, mirroring the kick charge.
   * 0 = not charging; >0 = J/K (or U/O for the cut-out) is held and the
   * flat-vs-loop window is building; released = throw. A tap throws
   * immediately, so the legacy instant pass is the zero-charge case. */
  passHold: number;
  passKind: 'PASS' | 'CUT_OUT' | '';
  /* HUMAN DISTRIBUTION — the pace of the ball currently in flight: 1 is the
   * standard loop, up to 1.5 for a fully held flat bullet. Written at
   * release, read by the flight carry. */
  passPace: number;
  /** Playtest P3.10: a step buys the beat and pays in pace — 0.78 at the
   * step, back to 1 in about half a second. */
  speedDebt: number;
  open: number;
  /** seconds of immunity after the phase starts, so ruck ball is playable */
  protect: number;
  /** T-51: seconds left of the pod hold — non-crew attackers keep their marks
   * through the first second of the use-it window instead of re-marking to
   * the fresh shape (the in-out churn). Zero outside ruck exits. */
  podHold: number;
  /** T-18. Seconds the current carrier has actually held the ball. Hot-potato
   *  attack — catch, fling, kick, all inside half a second — is why tackles,
   *  rucks and metres were all near zero: the CPU decided on the frame the ball
   *  arrived. Decisions now respect a carry commitment window. */
  heldT: number;
  ball: BallBody & { live: boolean; t: number };
  /** T-35 pass flight: who the ball is travelling to, and the arc progress 0..1 */
  pendingReceiver: number;
  /* SPEC_13: where the throw was AIMED, solved once at release. The ball flies
   * to this point and the receiver runs to this point, so neither chases the
   * other and the flight cannot manufacture forward travel. */
  passTargetX: number;
  passTargetZ: number;
  /** Playtest 3: the length of the current throw — the flight rate is a
   * real 13 m/s over this distance, not a fixed half-second homing. */
  passDist: number;
  passT: number;
}

export interface MaulState {
  t: number;
  /** The active, non-terminal state; the seven terminal paths live in `exit`. */
  stage: 'RE_GATE' | 'ATTACK_CONTROL' | 'DEFENCE_HOLD' | 'EXIT' | 'OVER';
  x: number; z: number; dir: number; yaw: number;
  forceA: number; forceD: number;
  ballRank: number; ranks: number;
  speed: number; gained: number;
  stallClock: number; stoppedOnce: boolean; useItCalled: boolean; warned: boolean;
  tryLineZ: number; attacking: 'A' | 'B';
  committed: number;
  /* SPEC_03 — THE KINEMATIC CLUSTER. The sixteen bound players as one
   * aggregate body: each locks into a forward-directed drive vector
   * (MaulBind.driveN/X), and the mass and drive vectors sum kinematically
   * every frame — the cluster's rolling speed is the integral of
   * F_net / Σm, capped by the no-explosion funnel in maulRegate. */
  bound: MaulBind[];
  /** Σ body mass of the cluster, kg (maulClusterMass at formation). */
  clusterMass: number;
  /** Seconds accrued toward the next whole-rank channel of the ball back
   *  to the tail (SPEC_03 channelling; maulRegate.channelBallRank). */
  channelT: number;
  /** SPEC_08 — a legal collapse has been whistled (drives the law-call
   *  text at the unplayable-scrum hand-off). */
  collapsed: boolean;
  /** Exactly one human side enables the four-window pure re-gate. */
  humanTeam: 'A' | 'B' | null;
  contest: MaulContestControl;
  regateWindowT: number;
  regateCandidate: MaulCommit | null;
  regateWindows: MaulCommit[];
  humanWinShare: number | null;
  humanWon: boolean | null;
  /** A write-once terminal route; it prevents a second hand-off in the same maul. */
  exit: MaulExitState;
  exitT: number;
  exitRunner: number;
  exitLane: 'LEFT' | 'RIGHT' | null;
  exitX: number;
  exitZ: number;
  /** T-18: formed off a lineout take — the pack drives as one */
  fromLineout: boolean;
}

export interface BreakdownState {
  t: number;
  stage: 'ASSEMBLE' | 'SET' | 'CARRY' | 'CONTACT' | 'PLACE' | 'RUCK' | 'RECYCLE' | 'OVER';
  attacking: 'A' | 'B'; contactX: number; contactZ: number;
  gainLine: number; ruckFormed: boolean; jackalActive: boolean;
  ball: { x: number; z: number; placed: boolean; y?: number };
  /**
   * HANDS AT THE BALL — per-man reach/grapple/strip state, one slot per entry in
   * `players`, sampled from the plan each frame. See engine/hands.ts: the contest
   * used to be pure force arithmetic and never asked whether anybody's hands were
   * anywhere near the ball. This is that answer, and the presentation reads it to
   * aim a pair of arms at the loose ball instead of at the man next to it.
   */
  hands?: HandsState;
  /**
   * T-40 BREAKDOWN PLAN — the presimulated choreography of this ruck: every
   * committed man's lane, the frame his clearout lands, and the arc the ball is
   * heeled along. Built once at the tackle and SAMPLED thereafter, never
   * integrated; see engine/breakdownPlan.ts for why the motion is baked and the
   * contest is not.
   */
  plan?: import('./engine/breakdownPlan').RuckPlan | null;
  players: { role: string; num: number; team: 'A' | 'B'; x: number; z: number; down: boolean;
    /** HANDS — 0..1 how committed his hands are to the ball this frame, and how
     *  far the strip has got. Written by stepHands, read by the rig to decide
     *  whether his arms should be reaching for the ball or holding a man. */
    hand?: number; strip?: number; mx?: number; mz?: number }[];
  /** T-80 — spring-bind fend-offs counted this breakdown. */
  latchedBreaks?: number;
  /** T-80/TARCS — the jackal has used his one poach attempt (density-scaled). */
  stealAttempted?: boolean;
  /** TARCS — seconds since the last gelatinous heave pulse, and the count
   *  of pulses so far (audit/probe read both to prove the pile jostles). */
  heaveT?: number; heaveCount?: number;
  crew: number[]; defCrew: number[];
  /* Playtest 2: J/K pressed during the fight buffers the distribution —
   * the nine passes the MOMENT the ball is out. Cleared unless the ruck
   * is won. */
  bufferedPass?: -1 | 0 | 1;
  /** T-40: the frame the jackal was driven off the ball, for the window's decay. */
  jackalClearedAt?: number;
  /** Playtest 3: the human jackal was warned once this breakdown. */
  stealWarned?: boolean;
  groundAt: number; ballOutAt: number; phase: number; expectedPoints: number;
  power: { A: number; B: number }; window: number; result: string; resultWhy: string;
  contestMeter: number; meterDir: number; meterOn: boolean; waggle: number;
  commitA: number; commitB: number; advantageOf: number;
  /* T-05 — the sustained contest. `axis` is the ball on a −1..+1 axis: +1 the
   * attacking side has cleared everything, −1 the defence is over it. Driven
   * by the net of the two sides' forces, damped, resolved at ±0.75.
   * `contestT` is seconds since the shove began. */
  axis: number; axisVel: number; contestT: number;
  /** T-05 — seconds the defence has held the ball below −0.5. A jackal with
   * sustained hands on it is the law's turnover, not a dice roll. */
  redT: number;
  /* MOMENTUM BRANCH. A collision between two men who are already almost
   * stationary is not the same event as one at a closing 10 m/s, and playing
   * the diving running-tackle clip for both is what made a static contact
   * look like two men throwing themselves at nothing. Measured over 437
   * tackles, the closing speed splits ~58/42 either side of 3.5 m/s.
   *   'RUNNING'  — the dive; momentum carries the pair across the turf.
   *   'STANDING' — a takedown on the spot; the slide is suppressed. */
  hitKind: 'RUNNING' | 'STANDING';
  /** closing speed at the contact frame, m/s (diagnostics + renderer). */
  hitSpeed: number;
}

/**
 * CHAOS SCRIMMAGE — a 14-body stress scrim for the TARCS physics pipeline.
 *
 * The mode deliberately sidesteps the full 30-man law engine and runs a
 * small, dense 7v7: one human carrier with the ball welded to his hands
 * (BALL SECURED), six friendly bodies fanned behind him, and seven opposing
 * bodies permanently in "Flailing Dive" pursuit. It exists to put many
 * bodies in motion with frequent contact so the ragdoll/latch layer, the
 * separation resolver and the per-player steering budget are exercised
 * together.
 */
export interface ChaosBody {
  role: 'PLAYER' | 'ALLY' | 'RIVAL';
  /** per-body phase for the flail/wobble sine */
  phase: number;
  /** seconds left of a committed RIVAL dive */
  diveT: number;
  /** cooldown before the next dive may start */
  diveCd: number;
  /** how much this body strays from its ideal line while flailing */
  wobble: number;
}

export interface ChaosScrimState {
  t: number;
  /** the 14 participating Live bodies */
  pool: Live[];
  /** per-pool-index presentation/AI state (same order as `pool`) */
  bodies: ChaosBody[];
  player: Live;
  allies: Live[];
  rivals: Live[];
  playerNum: number;
  /** TARCS stiff-arm window for the carrier, measured in Rapier sim seconds. */
  fendEnd: number | null;
  ballSecured: boolean;
  ballState: 'SECURED' | 'DROP_BALL';
  spawnX: number;
  spawnZ: number;
  /** the one current ragdoll latch, if any */
  latch: { rival: Live; player: Live; t: number } | null;
  /** lightweight frames/second sample so the mode can be sanity-checked */
  fps: { start: number; frames: number };
  /** driven by the chaos updater, exposed for the HUD/minimap */
  contacts: number;
  dives: number;
  /** true once the Rapier TARCS world has booted and is driving the bodies */
  physicsReady: boolean;
  /** human-readable failure if the physics bootstrap rejected */
  physicsError: string;
  /** monotonic token so a restarted scrim can abandon an in-flight bootstrap */
  physicsToken: number;
  /** live physics state, set only when `physicsReady` (or present while booting) */
  physics?: {
    world: RapierWorld;
    ragdolls: TabsPlayer[];
    ball: RigidBody;
    ballCarrier: BallCarrier;
    /** fixed-step accumulator for the TARCS world */
    accumulator: number;
    /** last fixed step cost, ms (HUD) */
    lastStepMs: number;
    /** unsubscribe for the TARCS impact tap used to count contacts */
    contactOff?: () => void;
  };
}

/**
 * GET-UP LOCK duration, seconds.
 *
 * This is the length of the stand-up animation, and it is duplicated here on
 * purpose: the engine must be able to run headless, with no GLB loaded, so it
 * cannot read the clip. The renderer asserts the two agree at load
 * (ThreePlayerManager.checkRecoverSeconds) and warns in DEV if a re-exported
 * asset changes the duration, which is the only way this can drift.
 *
 *   MX_StandUp (retargeted Mixamo, tools/fetch_mixamo.mjs)  1.67 s
 *   GetUp      (Quaternius fallback)                        1.53 s
 *
 * The shorter of the two is used so the lock never outlasts the animation and
 * leave a man standing frozen after he is visibly back on his feet.
 */
export const RECOVER_SECONDS = 1.53;

/** PLAYER CONTROLS — a grounded player cannot jump; an upright runner gets a
 * short rugby-style hop with real vertical velocity rather than a clip-only
 * pose. */
export const JUMP_IMPULSE = 4.8;
export const JUMP_GRAVITY = 13.5;
export const JUMP_MIN_SPEED = 2.2;

/** How far a recovering man may be displaced before his anchor follows him.
 *  Below this he is planted; above it something with a real reason to move
 *  him (a retreat, a shove) wins and the anchor re-seats. */
const RECOVER_ANCHOR_SLACK = 0.06;

/**
 * WHY NOT THE FULL 1.53 s CLIP LENGTH.
 *
 * Locking a man for the whole stand-up animation froze ~2.5 players for 18.7%
 * of open play. Those men are exempt from their own offside (see
 * offsideCandidates) but they still sit in the defensive line's shape while it
 * tries to reform, and their team-mates were penalised around them: offside
 * penalties per team went 3.7 (in band) -> 5.3 (band is 2-4) and the realism
 * score dropped 56% -> 50%.
 *
 * 0.75 s is the compromise: long enough that a man visibly pushes up off the
 * turf instead of teleporting into a sprint, short enough that the line
 * reforms in time. The renderer plays the stand-up clip at a matching rate
 * (see GETUP_RATE) so the animation still completes rather than being cut
 * off — the clip is sped up, not truncated.
 */

/* ============================ CONFIG ============================ */

export interface Slider { id: string; label: string; lo: string; hi: string; v: number; step: number; affects: string[] }

export interface MatchConfig {
  /** Optional match identifier for external payloads, tournaments, and tracking. */
  M_ID?: string;
  /** Framing gain for the squad (Director.camScale). Optional: undefined keeps
   *  the shipped default. A config field rather than a constant because the
   *  number is a judgement about the size of the screen the match is played on,
   *  and a harness must be able to A/B it against the old framing. */
  camScale?: number;
  homeId: string; awayId: string;
  kitA: number; kitB: number;
  difficulty: number;
  halfLength: number;
  options: Record<string, number>;
  slidersA: Slider[]; slidersB: Slider[];
  backlineA: string; defenceA: string; lineoutA: string; scrumA: string;
  backlineB: string; defenceB: string; lineoutB: string; scrumB: string;
  cpuA: boolean; cpuB: boolean;
  kickerA?: number; kickerB?: number;
  /** The shirt the human owns at kick-off. Quick Start deliberately uses 10. */
  controlNum?: number;
  /** Human side override for two-player / external match payloads. */
  controlTeam?: 'A' | 'B';
  assists?: { pass: number; tackle: number; kick: number };
  speed?: number;             // 1.0 normal, 0.75 / 0.5 / 0.35 learning
}

export interface MatchStats {
  possession: number; tackles: number; missed: number; turnovers: number;
  scrumsWon: number; scrumsLost: number; lineoutsWon: number; lineoutsLost: number;
  rucks: number; slowBall: number; metres: number; carries: number; passes: number;
  kicks: number; penaltiesConceded: number; lineBreaks: number; offsides: number;
  /** SPEC_12: scrum restarts, free kicks and turnover scrums conceded. These
   * are NOT penalties and must not spend the match's penalty budget. */
  restarts: number;
  tacklesBroke: number; offloads: number; jackals: number;
}

/** A two-side count used by set-piece and formation telemetry. */
export interface TeamTally { A: number; B: number }

/**
 * Physical set-piece occurrences. These counters deliberately have no side:
 * one awarded/started scrum or lineout is one event, whatever its outcome.
 */
export interface SetPieceEvents { scrums: number; lineouts: number }

/**
 * Awarded set-piece wins by side. This is outcome accounting, kept separate
 * from `SetPieceEvents` so a stolen contest, a reset, or a penalty cannot make
 * a match-total occurrence look like two events (or no event at all).
 */
export interface SetPieceWins { scrums: TeamTally; lineouts: TeamTally }

/**
 * Opportunity-normalised ruck/reset telemetry. All timings use engine seconds;
 * display-clock compression is intentionally not applied to these observations.
 */
/** SPEC_13 — the Law 11 ledger's telemetry surface. */
export interface PassLawTelemetry {
  /** passes actually thrown */
  releases: number;
  /** throws whose release vector was forward relative to the thrower (rel > 0) */
  forwardReleases: number;
  /** whistles blown */
  whistles: number;
  /** candidates the law removed before they could be offered */
  candidatesRejected: number;
  /** releases the CPU threw flatter rather than forward */
  clamped: number;
  relP50: number;
  relP90: number;
  relMax: number;
  /** worst forward travel past the thrower's momentum, metres */
  worstForwardMetres: number;
}

export interface FormationIntegrityTelemetry {
  ruckFormationOpportunities: number;
  defensiveLineResetOpportunities: number;
  eligiblePositionSamples: TeamTally;
  targetSlotSamples: TeamTally;
  offsidePlayerSamples: TeamTally;
  offsideEpisodes: TeamTally;
  /** SPEC_12: episodes and whistles broken down by line family. */
  offsideEpisodesByKind: Record<string, number>;
  /** `A:RUCK` — episodes per team per line family. */
  offsideEpisodesByTeamKind: Record<string, number>;
  offsideWhistlesByKind: Record<string, number>;
  /** SPEC_12: breaches Force AI Clean prevented the CPU from converting. */
  offsideSuppressed: TeamTally;
  /** SPEC_12: first offence of the half, warned instead of blown. */
  offsideWarnings: TeamTally;
  /** SPEC_12: one entry per whistle — how deep, and how long it was allowed. */
  offsideWhistleDepth: {
    kind: string; team: 'A' | 'B'; depth: number; sustained: number;
    toBall: number; retiring: boolean;
  }[];
  offsideRate: TeamTally;
  formationDriftP50: TeamTally;
  formationDriftP90: TeamTally;
  /** SPEC_11: P90 distance from a sampled mark to the live ball. */
  formationMarkAnchorP90: TeamTally;
  /** How many due-samples fed each drift channel. A percentile over an empty
   * channel reads 0.0 and flatters the run; the n makes that visible. */
  formationSampleCounts: TeamTally;
  recoveryEpisodes: TeamTally;
  recoveryEngineP90: TeamTally;
  recoveryClockP90: TeamTally;
}

const blankStats = (): MatchStats => ({
  possession: 0, tackles: 0, missed: 0, turnovers: 0, scrumsWon: 0, scrumsLost: 0,
  lineoutsWon: 0, lineoutsLost: 0, rucks: 0, slowBall: 0, metres: 0, carries: 0,
  passes: 0, kicks: 0, penaltiesConceded: 0, lineBreaks: 0, offsides: 0, restarts: 0,
  tacklesBroke: 0, offloads: 0, jackals: 0,
});

/**
 * QUICK START (15v15) — the single config that the main-menu "QUICK START
 * (15v15)" button launches straight into. No team customization, no kit
 * selection, no coin toss: two default nations (ENG v NZL) with their full
 * fifteen shirts, the default tactics board and factory options. The match
 * opens at the kick-off because the Director constructor itself drives the
 * Law-12 restart pipeline (squads → positional behaviour trees → restart
 * kickoff), so this is the exact same initialization path every other entry
 * point uses — the button just routes past the setup screens.
 */
export function quickStartConfig(overrides?: Partial<MatchConfig>): MatchConfig {
  const options: Record<string, number> = {};
  for (const i of OPTION_ITEMS) options[i.id] = i.def;
  const sliders = () => DEFAULT_SLIDERS.map((s) => ({ ...s }));
  return {
    M_ID: 'QUICKSTART_15V15_ENG_v_NZL',
    homeId: 'ENG', awayId: 'NZL', kitA: 0, kitB: 0,
    /* options.difficulty defaults to 3 (COUNTY) through OPTION_ITEMS; present
     * it as a real top-level field too so every reader sees the same value. */
    difficulty: options.difficulty ?? 3,
    halfLength: 5,
    options,
    slidersA: sliders(), slidersB: sliders(),
    backlineA: 'BL-SPLIT', defenceA: 'DF-UMBRELLA', lineoutA: 'LO-5', scrumA: 'SC-8-3',
    backlineB: 'BL-SPLIT', defenceB: 'DF-UMBRELLA', lineoutB: 'LO-5', scrumB: 'SC-8-3',
    /* The player coaches the home side; the away fifteen is fully CPU. */
    cpuA: false, cpuB: true, kickerA: 10, kickerB: 10,
    /* QUICK START control lock: the fly-half is the human's first shirt. */
    controlTeam: 'A', controlNum: 10,
    assists: { pass: 0.7, tackle: 0.7, kick: 0.7 },
    speed: 1,
    ...overrides,
  };
}

export interface MatchEvent { min: number; team: 'A' | 'B' | '-'; kind: string; text: string }

export interface PlayerRun {
  num: number; name: string; pos: string;
  carries: number; metres: number; tackles: number; turnovers: number;
  kicks: number; passes: number; rating: number; stamina: number; on: boolean; star: number;
  breaks: number; offloads: number; jackals: number;
}

export interface TeamRun {
  id: string; nation: Nation; kitIdx: number;
  score: number; stats: MatchStats; players: PlayerRun[];
  sliders: Slider[]; backline: string; defence: string; lineout: string; scrum: string;
  cpu: boolean; archetype: string; subsUsed: number; kicker: number;
}

/* ============================ HELPERS ============================ */

const R = () => Math.random();
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const approach = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt));
const blankTally = (): TeamTally => ({ A: 0, B: 0 });

/* SWITCHING MATRIX tuning. The grace window is the promise that the auto-
 * switcher never undoes a deliberate Q pick; the margin is the promise that
 * it only moves control when the current man genuinely cannot get there —
 * measured in seconds-to-contact so a sprinter and a prop are judged on
 * the same clock. */
const AUTO_SWITCH_GRACE = 2.5;
const AUTO_SWITCH_MARGIN = 1.0;

/** Nearest-rank quantile keeps the reported P90 tied to observed slots. */
const percentile = (values: readonly number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};

/* SPEC_04: position observations are sampled at four real-engine Hz, while a
 * legal breach must persist for 0.30 engine seconds beyond numerical noise.
 * Neither threshold is divided by `clockScale`: these are opportunities, not a
 * display-clock event stream. */
const FORMATION_SAMPLE_SECONDS = 0.25;
/* The existing no-teleport retreat needs a real, finite settle window before
 * normal formation observations begin. It is not display-clock scaling. */
/** Most defenders that may abandon the line to chase a break at once. */
const COVER_CHASE_MAX = 3;
const OFFSIDE_EPSILON_METRES = 0.35;
const OFFSIDE_SUSTAINED_SECONDS = 0.30;

/* ---- SPEC_11 — formation anchoring ----
 * D11-a: a formation spreads from the ball's lateral position and squeezes
 * rather than crossing the touchline. Two metres of grass is the margin the
 * rest of the engine already uses for a body on the sideline. */
const TOUCH_MARGIN = 2;
/** The narrowest a squeezed formation may become, as a fraction of authored width. */
const LATERAL_SQUEEZE_FLOOR = 0.35;
/* D11-b: depth compression as the formation backs towards its own dead-ball
 * line. Full authored depth with `DEPTH_COMPRESSION_ROOM` metres of room
 * behind the ball, squeezing to `DEPTH_COMPRESSION_FLOOR` of it at the line. */
const DEPTH_COMPRESSION_ROOM = 20;
const DEPTH_COMPRESSION_FLOOR = 0.15;
/** Metres to keep between a mark and the dead-ball line. */
const DEAD_BALL_MARGIN = 2;
/** The posts stand at ±3.1 m; a deep mark is held clear of the corridor. */
const POST_CORRIDOR = 3.6;
/** How far behind the ball a line defender may be marked before it is drift. */
const DEFENCE_LINE_SLACK = 1.0;
/* SPEC_11 metric recalibration. Drift is now a PROGRESS test across
 * due-samples, not an instantaneous velocity test: a man is executing the
 * shape when the gap is actually closing (`CONVERGE_PROGRESS_METRES` per
 * 0.25 s sample ≈ 0.5 m/s), and drifting when it is not — at any speed, in
 * any direction. `ON_MARK_METRES` is the arrival dead-band: a man already on
 * his mark has nothing to close. */
const CONVERGE_PROGRESS_METRES = 0.12;
const ON_MARK_METRES = 1.0;
/* T-51's pod hold freezes the attacking marks for a second so the pod arrives
 * as a pod. It froze them in WORLD space, so a carrier who ran across field
 * left his support standing on marks up to forty metres from the live ball —
 * the hold was manufacturing drift. Marks are ball-relative now, so the hold
 * only has to protect the men it was written for: the support pods around the
 * ball. Anyone whose mark is further out than this is re-marked every frame,
 * which costs him nothing (his mark is stable in ball-relative space) and
 * keeps every attacker anchored to the ball. */
const POD_HOLD_ANCHOR_METRES = 15;
/** The lateral extent of the authored defensive channel map (D11-a). */
const DEFENCE_LAT_MIN = Math.min(...DEFENCE_CHANNELS.map((c) => c.lat));
const DEFENCE_LAT_MAX = Math.max(...DEFENCE_CHANNELS.map((c) => c.lat));


/** T-39. Per-shirt build, as a visual scale multiplier. Forwards are big, the
 * back three are small. Combined with the SPD stat it gives real variety. */
const PLAYER_SIZE: Record<number, number> = {
  1: 1.10, 2: 1.06, 3: 1.10, 4: 1.12, 5: 1.12, 6: 1.02, 7: 1.00, 8: 1.04,
  9: 0.93, 10: 0.95, 11: 0.92, 12: 1.00, 13: 0.98, 14: 0.92, 15: 0.96,
};

/* ============================ CHAOS SCRIMMAGE ============================ */

/** TARCS stress mode: the 14 bodies live in a tight, always-moving scrum. */
const CHAOS_ALLY_COUNT = 6;
/** The TARCS world is stepped at a fixed 60 Hz. */
const CHAOS_FIXED_DT = 1 / 60;
/** The human carrier drives at about 60% of normal pace while ragdolled. */
const CHAOS_LATCH_DRAG = 0.55;
/** A rival commits to a Flailing Dive inside this range. */
const CHAOS_DIVE_RANGE = 11;
const CHAOS_DIVE_SECONDS = 0.62;
/** Ragdoll latch is released if the pair is dragged apart past this. */
const CHAOS_LATCH_BREAK = 2.3;
/** TARCS stiff-arm duration and actuation strength. */
const CHAOS_FEND_SECONDS = 0.4;
const CHAOS_FEND_ANGULAR_SPEED = 28;
const CHAOS_FEND_LINEAR_IMPULSE = 16;

/** A small closed set of fan offsets behind the carrier (A runs toward +z). */
const CHAOS_ALLY_FAN = [
  { x: -8.5, z: -9 },
  { x: -4.2, z: -6.5 },
  { x: 0.0, z: -7.5 },
  { x: 4.2, z: -6.5 },
  { x: 8.5, z: -9 },
  { x: 0.5, z: -13 },
];

/* ============================ DIRECTOR ============================ */

export class Director {
  t = 0;
  phase: Phase = 'KICK';
  possession: 'A' | 'B' = 'A';
  actors: Actor[] = [];
  /** SPEC_25 — the interactive catch / security / drop-punt machine. Owned by the
   *  engine because it decides where the ball is; the rig only reads `bc`. */
  bc: BallCraft = makeCraft();
  ballBehaviour: BallBehaviour = makeBallBehaviour();
  /** SPEC_25 — LMB is held this frame. Separate from `bc.state` because the grip is
   *  an input fact and the state is a rules fact: a man can be securing the ball in
   *  the middle of a ruck that ended his possession, and only one of those two should
   *  be able to make him hard to strip. */
  bcGrip = false;
  /** Assigned in the constructor via seedCameraOnCenter() (launch framing). */
  cam!: Camera;
  scrumAnchor = { x: 0, z: 0 };
  scrim?: ScrumState;
  lo?: LineoutState;
  kk?: KickState;
  op?: OpenPlayState;
  ml?: MaulState;
  bd?: BreakdownState;
  /** CHAOS_SCRIM — the live stress-scrim state, undefined outside the mode. */
  chaos?: ChaosScrimState;
  /** T-80 — multi-body compliant spring binds for the tackle/ruck contest.
   *  Reset on every breakdown start, released on whistle/phase teardown. */
  latches = new LatchSystem();
  pitch: PitchConditions;
  zoom = 0.34;
  camMode: CamMode = 'CABLE';

  /** The thirty. Source of truth for every position in the match. */
  live: Live[] = [];
  ctrl = 0;                      // index into live
  /** PLAYER CONTROLS — one human stick, one persistent shirt lock. Automatic
   * phase handoffs never replace this selection; Q and the shirt shortcuts are
   * the only deliberate exceptions. */
  roleLockTeam: 'A' | 'B' | null = null;
  roleLockNum = 10;
  roleLocked = false;
  /** Distinguishes an external harness/clinic setup from a live phase handoff. */
  private inUpdate = false;
  passOpts: PassOption[] = [];
  /* SWITCHING MATRIX — match seconds of the last MANUAL (Q / bumper-tap)
   * defender switch. The auto-switcher refuses to move control inside the
   * grace window after one, so it never fights — or silently undoes — a
   * deliberate human pick. */
  lastManualSwitch = -99;
  /* SWITCHING MATRIX — index into `live` of the ranked best interceptor, or
   * -1 when the ranking has no eligible candidate. Recomputed on demand (a
   * switch press, the auto-switch tick), never cached across a phase change. */
  bestInterceptor = -1;

  teams: { A: TeamRun; B: TeamRun };
  /** Match-total occurrence ledger; only `recordSetPieceEvent` may increment it. */
  readonly setPieceEvents: SetPieceEvents = { scrums: 0, lineouts: 0 };
  /** Outcome ledger; it is intentionally independent of the occurrence ledger. */
  readonly setPieceWins: SetPieceWins = {
    scrums: { A: 0, B: 0 },
    lineouts: { A: 0, B: 0 },
  };
  /** Mutable backing fields for the snapshot exposed by `formationIntegrity`. */
  private readonly formationCounts = {
    ruckFormationOpportunities: 0,
    defensiveLineResetOpportunities: 0,
    eligiblePositionSamples: blankTally(),
    targetSlotSamples: blankTally(),
    offsidePlayerSamples: blankTally(),
    offsideEpisodes: blankTally(),
    /* SPEC_12: WHICH line the law is broken at. One audit rule per line family
     * and one honest diagnosis ("the whistle is coming from the open-play
     * line, not the ruck") both need the breakdown by kind. */
    offsideEpisodesByKind: {} as Record<string, number>,
    offsideEpisodesByTeamKind: {} as Record<string, number>,
    offsideWhistlesByKind: {} as Record<string, number>,
    /* SPEC_12: how FAR past the line and how LONG the referee let it run, at
     * the moment he blew. Tuning a threshold without this is guessing. */
    offsideWhistleDepth: [] as {
      kind: string; team: 'A' | 'B'; depth: number; sustained: number;
      toBall: number; retiring: boolean;
    }[],
    /* SPEC_12: breaches the CPU was PREVENTED from converting into a penalty
     * under Force AI Clean. Counted, never hidden — it is the gate's evidence. */
    offsideSuppressed: blankTally(),
    /* the first offence of each half, spoken rather than blown */
    offsideWarnings: blankTally(),
    recoveryEpisodes: blankTally(),
  };
  private readonly formationDriftSamples: { A: number[]; B: number[] } = { A: [], B: [] };
  /* SPEC_12: the offside windows, keyed by line kind and possession, so they
   * survive a ruck re-forming instead of resetting the referee's memory. */
  private readonly offsideLedger = new OffsideLedger();
  /* TARCS — RUCK ENTRY GATES. The per-ruck corridor memory, and the identity
   * of the breakdown instance it belongs to: a new `bd` mints a new serial
   * and a wiped board. `sideEntryStats` is the referee's own ledger for the
   * offence, deliberately OUTSIDE the SPEC_12 formation counts so the offside
   * diagnostics keep measuring exactly what they always measured. */
  private readonly ruckGateLedger = new RuckGateLedger();
  private ruckGateBd: BreakdownState | null = null;
  private ruckGateRosterCache: Set<string> | null = null;
  /** engine time the current ruck's gate window opened, for the settle grace. */
  private ruckGateOpenedAt = 0;
  sideEntryStats = { observed: { A: 0, B: 0 }, whistled: { A: 0, B: 0 } };
  /**
   * FORWARD PACK — the steering layer's own ledger, the mirror of the
   * referee's: how many frames a forward's mark was rewritten to his team's
   * gate waypoint (`routed`), how many frames a tree node owned a forward's
   * mark (`treeMarks`), and per-node counts so a probe can prove each branch
   * of each tree actually fires in a match.
   */
  packStats = { routed: { A: 0, B: 0 }, treeMarks: 0, nodes: {} as Record<string, number> };
  /* BACKLINE TELEMETRY — the mirror of packStats for shirts 9-15, plus the
   * three jobs the backline probe grades: how often the pendulum rotated in
   * a kicking pose (and which thirds it covered), how often the 9's base
   * held behind the dynamic hindmost line, and the 10's pocket depth as he
   * waits on the 9's release. */
  backlineStats = {
    routed: { A: 0, B: 0 },
    treeMarks: 0,
    nodes: {} as Record<string, number>,
    pendulumFrames: 0,
    pendulumThirds: { LEFT: 0, CENTRE: 0, RIGHT: 0 } as Record<string, number>,
    nineBaseFrames: { A: 0, B: 0 },
    nineOffsideFrames: { A: 0, B: 0 },
    pocketFrames: 0,
    pocketDepthSum: 0,
  };
  /** the ruck geometry computed by `enforceRuckEntryGates` this frame, for think() */
  private ruckGeoThisFrame: ReturnType<typeof ruckGateGeometry> = null;
  private ruckGeoDrawnAt = -1;
  /* SPEC_13: the Law 11 ledger. `passLawSamples` is every release's relative
   * velocity, kept so the audit can grade the distribution and not just the
   * count — a mean of zero with a tail of six is still a broken game. */
  private readonly passLawCounts = {
    releases: 0, forwardReleases: 0, whistles: 0, candidatesRejected: 0,
    clamped: 0, worstForwardMetres: 0,
  };
  private readonly passLawSamples: number[] = [];
  /* SPEC_12: two different identities, and conflating them is what moved the
   * SPEC_11 drift number from 2.3 m to 8 m.
   *
   *   - the offside WINDOW is a phase continuum, keyed `kind:possession`, so a
   *     man who stands offside through four consecutive rucks cannot reset the
   *     referee's clock by the ruck re-forming. That is the fix.
   *   - the formation SAMPLE is a formation INSTANCE: `kind:possession` plus a
   *     serial that bumps when the breakdown or release-beat object is
   *     replaced. The drift metric was always sampled per ruck, just after the
   *     formation was written. Keying it to the continuum sampled every 0.25 s
   *     of a whole possession instead — including the transitions the metric
   *     deliberately excludes — and the P90 tripled.
   *
   * So the window remembers across formations and the sample does not. */
  private readonly formationInstance = new Map<string, object>();
  private readonly formationSerial = new Map<string, number>();
  /** The (window, team) an episode has already been counted for. */
  private offsideEpisodeMarked = '';
  /* SPEC_12: the referee's warning. He does not blow the first time; he tells
   * the side once — "blue six, back!" — and blows the next one. That is what a
   * real referee does at the breakdown, and it is the difference between a law
   * that teaches and a law that nags: the engine's CPU commits roughly ninety
   * sustained reset breaches a match, and a whistle for each is a stop-start
   * game, while a warning plus the whistle for the repeat is a rugby match.
   * The warning is recorded, so it is never a way of hiding an offence. */
  private readonly offsideWarnedHalf: { A: number; B: number } = { A: 0, B: 0 };
  /** The raw drift channel, exposed so a harness can read the tail and not
   * only its percentile. Read-only in spirit: nothing in the game loops on it. */
  get formationDriftRaw() { return this.formationDriftSamples; }
  /* SPEC_11: the distance from each sampled mark to the live ball. Drift
   * measures a man against his mark; this measures the mark against the
   * match, which is the half the old metric could not see. */
  private readonly formationMarkAnchorSamples: { A: number[]; B: number[] } = { A: [], B: [] };
  private readonly formationRecoverySamples: { A: number[]; B: number[] } = { A: [], B: [] };
  private readonly formationSampleAt = new Map<string, number>();
  /* SPEC_10 B2d (P90 drift composition): the last target each player was
   * sampled against. A drift sample only counts when the target has BEEN
   * STABLE across consecutive due-samples — a man sprinting to a freshly
   * assigned slot is executing the shape, not drifting from it. */
  private readonly formationLastTarget = new Map<Live, { x: number; z: number; d: number; since: number }>();
  private pendingTargetSlotSample: { token: string; defending: 'A' | 'B'; kind: 'RUCK' | 'RESET' } | null = null;
  clock = 0;
  half: 1 | 2 = 1;
  halfLength: number;
  clockScale: number;
  addedTime = 0;
  paused = false;
  /** seconds remaining of an unattended pause (auto-resuming half time) */
  holdTimer = 0;
  over = false;
  events: MatchEvent[] = [];
  feed: { text: string; text2?: string; at: number }[] = [];
  lastScorer: { num: number; name: string; team: 'A' | 'B'; min: number; kind: string } | null = null;
  /** T-13: true only between a try and the conversion strike — see kickScored. */
  conversionPending = false;
  /** W-011: a live TMO review of a corner grounding. Null unless a try is
   * being checked; the conversion's FANFARE stage holds while it is live. */
  tmo: { t: number; name: string; short: string; angle: number; said: boolean } | null = null;
  replayOf: Phase | null = null;
  replayTimer = 0;
  refSignal = 0;
  refSignalText = '';
  /* SPEC_15 — the referee is an actor. His body is integrathort: string; angle: number; said: boolean } | null = null;
  replayOf: Phase | null = null;
  replayTimer = 0;
  refSignal = 0;
  refSignalText = '';
  /* SPEC_15 — the referee is an actor. His body is integrated in
   * engine/referee.ts, deliberately outside `d.live`: putting him in the
   * thirty-one would make every defence, offside, passing, separation and
   * tackle loop count him as a defender. */
  ref: RefState = newReferee();
  /** SPEC_15 — the world-space speech queue. One bubble shows at a time; a big
   *  call preempts a nudge and the queue drains in priority order. */
  refBubbles: RefBubble[] = [];
  banner = '';
  bannerAt = -99;
  difficulty: number;
  options: Record<string, number>;
  assists: { pass: number; tackle: number; kick: number };
  gameSpeed: number;
  momentum = 0;
  hint = '';
  hintKey = '';
  hintUntil = 0;
  advantage = 0;
  advantageTeam: 'A' | 'B' = 'A';
  advantageShown = false;
  /* TARCS — the referee's advantage memory (engine/referee.ts). The Director
   * owns the instance and every write it triggers; the sequencing itself is
   * pure and testable without a match. Null when no advantage is running. */
  advWatch: AdvantageWatch | null = null;
  /* A wind-back the kick flight has not yet let through: the whistle is
   * earned, the restart waits for the ball to come down. */
  pendingWindback = false;
  lawsExplained = new Set<string>();
  shakeT = 0; /* T-03: engine-internal — engine/camera.ts writes the shake */
  /** Match identifier, guaranteed to be present for external telemetry and tournament tracking. */
  M_ID: string;

  constructor(public cfg: MatchConfig) {
    this.M_ID = cfg?.M_ID ?? `${cfg?.homeId ?? 'ENG'}_v_${cfg?.awayId ?? 'NZL'}`;
    this.options = cfg?.options ?? {};
    this.difficulty = cfg?.difficulty ?? 5;
    this.assists = cfg?.assists ?? { pass: 0.7, tackle: 0.7, kick: 0.7 };
    this.gameSpeed = cfg?.speed ?? 1;
    if (typeof cfg?.camScale === 'number') this.camScale = cfg.camScale;
    this.halfLength = (cfg?.halfLength ?? 5) * 60;
    // Every half resolves in about 150 s of real time whatever its length.
    /* T-18. The clock compressor. 12x starved the box score: every benchmark
     * is per 80-minute MATCH, and at 12x the engine only got ~400 s to produce
     * a full match's worth of tackles, rucks and passes — the per-event rates
     * were already hyper-dense and the totals still read at half strength.
     * 8x gives the match the seconds it needs (five real-time minutes a
     * half — a normal video-game rugby pace) without touching any law, speed
     * or difficulty table. */
    this.clockScale = clamp(this.halfLength / 150, 1, 8);
    this.pitch = pitchConditions(['FIRM', 'STANDARD', 'SOFT', 'MUDDY', 'FROZEN'][cfg?.options?.pitch ?? 1]);
    this.teams = {
      A: this.makeRun(cfg?.homeId ?? 'ENG', cfg?.kitA ?? 0, cfg?.slidersA ?? [], cfg?.backlineA ?? 'BL-SPLIT', cfg?.defenceA ?? 'DF-UMBRELLA', cfg?.lineoutA ?? 'LO-5', cfg?.scrumA ?? 'SC-8-3', cfg?.cpuA ?? false, cfg?.kickerA),
      B: this.makeRun(cfg?.awayId ?? 'NZL', cfg?.kitB ?? 0, cfg?.slidersB ?? [], cfg?.backlineB ?? 'BL-SPLIT', cfg?.defenceB ?? 'DF-UMBRELLA', cfg?.lineoutB ?? 'LO-5', cfg?.scrumB ?? 'SC-8-3', cfg?.cpuB ?? true, cfg?.kickerB),
    };
    // Start on the cable rig behind halfway; the actual launch frame is
    // seeded onto the centre spot in seedCameraOnCenter() below.
    this.camMode = 'CABLE';

    for (let i = 0; i < 31; i++) {
      this.actors.push({
        id: i, team: i < 15 ? 'A' : i < 30 ? 'B' : 'REF',
        num: i < 15 ? i + 1 : i < 30 ? i - 14 : 0,
        rx: 0, rz: 0, ry: 0, rf: 1, renderClip: 'idle', clipT: R() * 3, jitter: R() * 1.7, ring: 0, size: 1, turnT: 0,
      });
    }
    this.buildLive();
    /* PLAYER CONTROLS — Quick Start owns a real shirt from the first frame,
     * rather than inheriting the kickoff kicker's transient handoff. Custom
     * payloads may choose the human side and shirt; otherwise the first
     * non-CPU side and fly-half 10 are the safe defaults. */
    const humanTeam = cfg.controlTeam
      ?? (!this.teams.A.cpu ? 'A' : !this.teams.B.cpu ? 'B' : 'A');
    this.roleLockTeam = this.isHuman(humanTeam) ? humanTeam : null;
    this.roleLockNum = clamp(Math.round(cfg.controlNum ?? 10), 1, 15);
    this.roleLocked = !!this.roleLockTeam;
    /* QUICK START / kick-off launch: seed BOTH the render camera and the
     * cable rig's eased anchor on the centre spot before the first frame.
     * The rig binds to the ball carrier/kicker the moment play starts, so
     * this avoids a pan-in from the cable rest position on a straight
     * launch (Quick Start); it does not lock anything — V, the pause-menu
     * camera cycle and the wheel zoom all keep driving the same camera. */
    this.seedCameraOnCenter();
    this.beginKickoff();
  }

  /**
   * THE MATCH LAUNCH PIPELINE'S FINAL STAGE — open an active match at the
   * Law-12 kick-off. Called by the constructor for every entry point
   * (friendlies, competitions, tutorials, Quick Start); it is also public
   * so a launcher that has constructed a Director in a torn-down state can
   * force the straight-to-kickoff start explicitly.
   *
   * The thirty shirts (positions 1-15 per side) already exist from
   * buildLive(), and the positional behaviour trees read every frame out of
   * src/game/behaviour via think() — there is no per-match behaviour
   * allocation to miss.
   */
  beginKickoff() {
    this.over = false;
    this.paused = false;
    this.phase = 'KICK';
    this.commentate('KICKOFF');
    this.showHint('A/D OR ARROWS TO RUN · SPACE TO SPRINT', 6);
    // Law 12: the kick-off is taken from the centre of the halfway line.
    this.startKick('A', 'RESTART', { x: KICKOFF_CENTER.x, z: KICKOFF_CENTER.z });
    /* startKick selects the kicker for its own ritual; the human stick still
     * belongs to the requested shirt. */
    if (this.roleLocked && this.roleLockTeam) this.lockRole(this.roleLockTeam, this.roleLockNum);
  }

  /** Bind the launch framing to the centre spot (the kicker is the carrier). */
  private seedCameraOnCenter() {
    this.cam = { x: KICKOFF_CENTER.x, z: -17, h: 13, yaw: 0, tilt: 0.55, fov: 0.42, shake: 0, horizon: 0.42, roll: 0 };
    this.cableX = KICKOFF_CENTER.x;
    this.cableZ = -17;
    this.cableH = 13;
    this.cableAX = KICKOFF_CENTER.x;
    this.cableAZ = KICKOFF_CENTER.z;
    this.rigZ = KICKOFF_CENTER.z;
  }

  /* ---------------- squads ---------------- */

  private makeRun(
    id: string, kitIdx: number, sliders: Slider[], backline: string, defence: string,
    lineout: string, scrum: string, cpu: boolean, kicker: number | undefined,
  ): TeamRun {
    const n = TEAM_BY_ID(id);
    return {
      id, nation: n, kitIdx, score: 0, stats: blankStats(), sliders,
      backline, defence, lineout, scrum, cpu, archetype: n.archetype, subsUsed: 0,
      kicker: kicker ?? 10,
      players: n.squad.map((p: SquadPlayer) => ({
        num: p.num, name: p.name, pos: p.pos, carries: 0, metres: 0, tackles: 0,
        turnovers: 0, kicks: 0, passes: 0, rating: 6, stamina: 100, on: true, star: p.star,
        breaks: 0, offloads: 0, jackals: 0,
      })),
    };
  }

  /** Live players are generated from the squad sheet so attributes are real. */
  private buildLive() {
    this.live = [];
    for (const t of ['A', 'B'] as const) {
      const tr = this.teams[t];
      for (const sp of tr.nation.squad) {
        this.live.push({
          team: t, num: sp.num,
          x: t === 'A' ? -20 + sp.num * 2.6 : 20 - sp.num * 2.6,
          z: t === 'A' ? -30 : 30,
          vx: 0, vz: 0, face: t === 'A' ? 1 : -1,
          clip: 'ready', clipT: R() * 2, jitter: R() * 1.7,
          stamina: 100, restT: 0,
          size: PLAYER_SIZE[sp.num] ?? 1,
          assignment: 'OPEN_PLAY', job: '',
          tx: 0, tz: 0, urgency: 0.5, bound: false, down: false, carrier: false,
          passRank: 0, eta: 9, controlled: false, sinbin: 0, beatenT: 0,
          jumpY: 0, jumpVY: 0,
          attrs: {
            SPD: sp.stats.SPD, PWR: sp.stats.PWR, SKL: sp.stats.SKL,
            AGG: Math.round((sp.stats.PWR + sp.stats.SPD) / 2),
            AWA: Math.round((sp.stats.SKL + sp.stats.STA) / 2),
            STA: sp.stats.STA,
          },
        });
      }
    }
  }

  L(team: 'A' | 'B', num: number): Live { /* T-03: engine-internal */
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      if (p.team === team && p.num === num) return p;
    }
    return this.live[0];
  }
  run( /* T-03: engine-internal */team: 'A' | 'B', num: number): PlayerRun {
    return this.teams[team].players[num - 1];
  }

  /* ---------------- accessors ---------------- */
  /** Keys currently held by whoever is driving. Public so the trace can read it. */
  held = new Set<string>();

  /**
   * The single source of truth for what the player is told to do. The HUD reads
   * this, the automated audit reads this, so the two can never disagree.
   */
  get prompt(): string {
    if (this.bc.free) return this.bc.window > 0 ? 'SPACE PUNTS THE DROP — THE WINDOW IS OPEN'
      : 'CHASE THE LOOSE BALL · Q CHOOSE A COLLECTOR · GET IN REACH TO GATHER';
    if (this.chaos) return 'A/D/W/S CARRY · SPACE SPRINT · C RESTART CHAOS · BALL SECURED';
    if (this.hint) return this.hint;
    if (this.kk) {
      if (this.kk.stage === 'AIM') return `A / D AIM THE KICK · SPACE TO SET POWER — ${this.kk.profile.label}`;
      if (this.kk.stage === 'METER') return this.kk.power === 0
        ? 'SPACE TO SET POWER — STOP IN THE GOLD BAND' : 'SPACE TO SET ACCURACY';
      return `${this.kk.profile.label} — THE BALL IS IN THE AIR`;
    }
    if (this.scrim) {
      if (this.scrim.stage === 'ASSEMBLE') return this.scrim.cadence || 'FORMING THE SCRUM';
      return `${this.scrim.cadence} — POUND A / D TO PUSH THE PACK`;
    }
    if (this.lo) {
      if (this.lo.stage === 'ASSEMBLE') return 'FORMING THE LINEOUT';
      if (this.lo.stage === 'CALL') return `A / D CHOOSE THE CALL · SPACE TO THROW — ${this.lo.call.label}`;
      if (this.lo.stage === 'THROW') return 'SPACE INSIDE THE GOLD BAND FOR A STRAIGHT THROW';
      return 'THE BALL IS IN THE AIR — CONTEST IT';
    }
    if (this.bd) return `${this.bd.stage} — A / D POUND TO CLEAR OUT · SPACE COMMITS ONE MORE (${this.bd.commitA} IN)`;
    if (this.ml) return this.maulPrompt();
    if (this.op) {
      if (this.ctrlPlayer.team === this.op.attacking) {
        const l = this.passOpts.find((o) => o.side === -1);
        const r = this.passOpts.find((o) => o.side === 1);
        return [
          l ? `J PASS TO ${l.player.num}` : null,
          r ? `K PASS TO ${r.player.num}` : null,
          'L PUNT', 'H GRUBBER', 'P DROP', 'I CONTACT', 'F FEND', 'G STEP',
        ].filter(Boolean).join('  ·  ');
      }
      return 'X DIVING TACKLE · C SMOTHER · Q SWITCH DEFENDER (SMART)';
    }
    return 'A / D RUN · SPACE SPRINT';
  }

  /**
   * The single most sensible thing to do right now. SPACE performs this. The
   * player can override the choice in the options.
   */
  get contextVerb(): { key: string; label: string; act: string } {
    if (this.bc.free) return { key: 'SPACE', label: this.bc.window > 0 ? 'PUNT THE DROP' : 'CHASE THE BALL', act: 'run' };
    if (this.op?.ball.live) return { key: 'SPACE', label: 'SUPPORT THE PASS', act: 'run' };
    const mode = ['AUTO', 'PASS', 'KICK', 'CONTACT', 'TACKLE', 'CARRY'][this.options.spaceAction ?? 0];
    if (this.kk) {
      if (this.kk.stage === 'AIM' || this.kk.stage === 'METER') return { key: 'SPACE', label: 'SET THE KICK', act: 'action' };
      return { key: 'SPACE', label: 'CHASE THE BALL', act: 'run' };
    }
    if (this.scrim) {
      if (this.scrim.stage === 'ASSEMBLE' || this.scrim.stage === 'MARK') return { key: 'SPACE', label: 'WAIT FOR THE CALL', act: 'none' };
      return { key: 'A / D', label: 'PUSH THE PACK', act: 'waggle' };
    }
    if (this.lo) {
      if (this.lo.stage === 'CALL') return { key: 'SPACE', label: 'THROW IN', act: 'action' };
      if (this.lo.stage === 'THROW') return { key: 'SPACE', label: 'RELEASE THE THROW', act: 'action' };
      return { key: 'SPACE', label: 'CONTEST THE BALL', act: 'run' };
    }
    if (this.bd) {
      /* Playtest 3: the defending side has a verb now — the steal is a
       * numbers call (see upBreakdown). */
      if (this.isHuman(this.bd.attacking)) return { key: 'A / D', label: 'CLEAR OUT THE RUCK', act: 'waggle' };
      return { key: 'SPACE', label: this.bd.defCrew.length > this.bd.crew.length ? 'STOLEN — NUMBERS TOLD' : 'GO FOR THE STEAL (NEED NUMBERS)', act: 'action' };
    }
    if (this.ml) {
      const m = this.ml;
      if (m.contest === 'PENDING') return { key: 'A / D', label: 'ALTERNATE TO WIN THE MAUL', act: 'waggle' };
      if (m.contest === 'ATTACK_CONTROL' && this.isHuman(m.attacking)) return { key: 'L', label: 'PICK AND GO', act: 'kick' };
      return { key: 'A / D', label: 'HOLD THE MAUL UP', act: 'waggle' };
    }
    if (this.op) {
      const attacking = this.ctrlPlayer.team === this.op.attacking;
      if (attacking) {
        if (mode === 'KICK') return { key: 'SPACE', label: 'KICK', act: 'kick' };
        if (mode === 'CONTACT') return { key: 'SPACE', label: 'TAKE THE TACKLE', act: 'contact' };
        if (mode === 'CARRY') return { key: 'SPACE', label: 'SPRINT', act: 'run' };
        if (this.op.toLine < 3.5 && this.op.pressure < 0.97) return { key: 'SPACE', label: 'DIVE FOR THE LINE', act: 'dive' };
        if (this.op.pressure > 0.72) return { key: 'SPACE', label: 'TAKE THE TACKLE AND OFFLOAD', act: 'contact' };
        if (this.op.toLine < 28 && this.op.phase > 3) return { key: 'SPACE', label: 'GO FOR THE LINE', act: 'run' };
        if (this.op.pressure < 0.3 && this.passOpts.length) return { key: 'SPACE', label: `PASS TO ${this.passOpts[0].player.num}`, act: 'pass' };
        return { key: 'SPACE', label: 'SPRINT INTO THE GAP', act: 'run' };
      }
      return { key: 'SPACE', label: 'TACKLE HIM', act: 'tackleDive' };
    }
    return { key: 'SPACE', label: 'SPRINT', act: 'run' };
  }

  /** Fire whatever the context says SPACE should do. */
  fireContext() {
    const cv = this.contextVerb;
    switch (cv.act) {
      /* The nine's AUTO release goes down the echelon rather than to a side —
       * first receiver is the 10 on his shoulder. Every other carrier keeps
       * the legacy best-option pass. Human path only (fireContext fires from
       * the human verb branch), so CPU matches are untouched. */
      case 'pass': {
        if (this.op && this.op.carrierNum === 9 && this.distributePass()) return;
        const o = this.passOpts[0]; if (o) this.doPass(o.side, false); return;
      }
      case 'kick':
        if (this.op) this.startKick(this.op.attacking, 'PUNT', { x: this.op.carrierX, z: this.op.carrierZ }, this.op.carrierNum);
        return;
      case 'contact': if (this.op) this.startBreakdown(); return;
      case 'dive': if (this.op) doDive(this); return;
      case 'tackleDive':
        if (this.op) {
          const car = this.L(this.op.attacking, this.op.carrierNum);
          const near = this.live.filter((p) => p.team === this.defending() && p.sinbin <= 0)
            .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))[0];
          if (near) {
            const d = Math.hypot(near.x - car.x, near.z - car.z);
            if (d < 3.5) { this.setCtrl(this.defending(), near.num, false); this.startBreakdown(near.num); }
            else this.showHint(`OUT OF RANGE — HE IS ${d.toFixed(1)} m AWAY`, 1.6);
          }
        }
        return;
      default: return;
    }
  }

  /** The ordered control list shown at the top-left of the HUD. */
  get actionBar(): { key: string; label: string; primary: boolean }[] {
    const cv = this.contextVerb;
    const out: { key: string; label: string; primary: boolean }[] = [];
    const add = (key: string, label: string) => out.push({ key, label, primary: key === cv.key });
    if (this.bc.free || this.op?.ball.live) {
      add('A / D', 'RUN'); add('SPACE', cv.label); add('Q', 'CHOOSE A COLLECTOR');
      return out;
    }
    if (this.op) {
      const attacking = this.ctrlPlayer.team === this.op.attacking;
      add('A / D', 'RUN');
      add('SPACE', cv.label);
      if (attacking) {
        const l = this.passOpts.find((o) => o.side === -1);
        const r = this.passOpts.find((o) => o.side === 1);
        if (l) add('J', `PASS LEFT TO ${l.player.num}`);
        if (r) add('K', `PASS RIGHT TO ${r.player.num}`);
        add('U / O', 'CUT-OUT PASS');
        if (this.op.carrierNum === 9) {
          const eco = this.echelonTarget();
          add('T', eco ? `DISTRIBUTE TO ${eco.num}` : 'DISTRIBUTE (NO RECEIVER)');
        }
        add('L', 'PUNT'); add('H', 'GRUBBER'); add('P', 'DROP GOAL');
        add('F', 'FEND'); add('G', 'STEP'); add('E', 'DUMMY'); add('I', 'TAKE CONTACT');
      } else {
        add('X', 'DIVING TACKLE'); add('C', 'SMOTHER'); add('Q', this.autoSwitchEnabled() ? 'SWITCH DEFENDER (AUTO)' : 'SWITCH DEFENDER (SMART)');
      }
    }
    if (this.kk && (this.kk.stage === 'AIM' || this.kk.stage === 'METER')) { add('A / D', 'AIM'); add('SPACE', cv.label); }
    else if (this.kk) add('A / D', 'RUN TO THE BALL');
    if (this.scrim && this.scrim.stage !== 'ASSEMBLE') add('A / D', 'PUSH');
    if (this.lo && (this.lo.stage === 'CALL' || this.lo.stage === 'THROW')) { add('A / D', 'CHOOSE THE CALL'); add('SPACE', cv.label); }
    if (this.bd) { add('A / D', 'CLEAR OUT'); add('SPACE', 'COMMIT ONE MORE'); }
    if (this.ml) {
      const m = this.ml;
      if (m.contest === 'PENDING') add('A / D', `ALTERNATE (${m.regateWindows.length}/4)`);
      else if (m.contest === 'ATTACK_CONTROL' && this.isHuman(m.attacking)) {
        add('A / D', 'WHEEL AND PEEL'); add('SPACE', 'TRANSFER TO 9'); add('L', 'PICK AND GO');
      } else add('A / D', 'HOLD THE MAUL UP');
    }
    /* SPEC_10 B1 (UX-124): several contexts built a bar that did not contain
     * the context verb's key — kick FLIGHT (bar shows only 'A / D — RUN TO THE
     * BALL' while contextVerb says SPACE: CHASE THE BALL), scrum ASSEMBLE/MARK,
     * and the lineout's non-CALL/THROW stages — so `primary: key === cv.key`
     * matched nothing and the HUD never marked the one primary action the
     * context actually has. Whatever the phase branches added, the verb the
     * engine will fire is always the honest primary: guarantee it is listed. */
    if (!out.some((a) => a.primary) && cv.key) out.push({ key: cv.key, label: cv.label, primary: true });
    if (this.chaos) add('C', 'RESTART CHAOS SCRIMMAGE');
    add('ESC', 'PAUSE'); add('TAB', 'STATS'); add('R', 'REPLAY');
    return out;
  }

  /**
   * What is happening, and what happens next. After a tackle the player was left
   * with no idea whether he had the ball, whether it was contested, or how long
   * it would be before he could play again. This is that answer, in one line
   * each, updated every frame.
   */
  get narrative(): { now: string; next: string; clock: number; danger: boolean } {
    if (this.bc.free) return {
      now: 'LOOSE BALL — NEITHER SIDE HAS SECURED IT',
      next: 'Chase or cover the bounce; Q selects a collector. Gather when in reach.', clock: 0, danger: true,
    };
    if (this.op?.ball.live) return {
      now: `PASS IN FLIGHT TO ${this.op.pendingReceiver}`,
      next: 'Meet the pass; support behind the receiver and cover the next channel.', clock: 0, danger: false,
    };
    if (this.chaos) {
      const c = this.chaos;
      const latch = c.latch ? ` · ${c.latch.rival.num} IS ON YOU` : '';
      return {
        now: c.ballSecured ? 'BALL SECURED' : 'BALL SECURED',
        next: `14 BODIES LIVE · ${c.allies.length} ALLIES FAN OUT · ${c.rivals.length} RIVALS DIVE${latch}`,
        clock: 0,
        danger: !!c.latch,
      };
    }
    if (this.kk) {
      const k = this.kk;
      if (k.stage === 'FANFARE') return { now: 'TRY! The crowd is on its feet', next: `${k.kickerName} will take the conversion`, clock: 0, danger: false };
      if (k.stage === 'WALKUP') return { now: `${k.kickerName} is walking to the tee`, next: 'The kick goes live once the ball is set', clock: 0, danger: false };
      if (k.stage === 'AIM') return { now: `${k.kickerName} is lining up a ${k.profile.label.toLowerCase()}`, next: 'Hold SPACE to build power, release to strike', clock: 0, danger: false };
      if (k.stage === 'METER') return { now: `Charging — ${(k.power * 100).toFixed(0)}% power, ${this.kickReach(k, k.power).toFixed(0)} m`, next: 'Release SPACE to kick', clock: 0, danger: false };
      if (k.stage === 'FLIGHT') {
        const lp = this.landingPrediction();
        return { now: 'The ball is in the air', next: lp ? `It lands in ${lp.eta.toFixed(1)}s — get a chaser there` : 'Chase it', clock: lp?.eta ?? 0, danger: false };
      }
      return { now: 'The kick is done', next: 'Play restarts', clock: 0, danger: false };
    }
    if (this.bd) {
      const b = this.bd;
      const elapsed = b.groundAt >= 0 ? b.t - b.groundAt : 0;
      const limit = [1.5, 3, 5][this.options.ruckLaw ?? 2];
      const mine = b.attacking === this.ctrlPlayer.team;
      const remaining = Math.max(0, limit - elapsed);
      /* T-38. The ruck read mirrors the in-world text: COMMIT - SPACE when a jackal
       * is on, A/D - CLEAROUT to win it, SECURED when you have. At 0 it auto-plays
       * to the fly-half. */
      if (b.stage === 'RECYCLE') {
        return { now: 'SECURED', next: 'Your nine is about to play it — get ready to run', clock: 0, danger: false };
      }
      if (b.jackalActive) {
        return { now: 'A defender is on the ball', next: mine ? 'A/D - CLEAROUT, or SPACE to commit one more' : 'COMMIT - SPACE to contest it', clock: remaining, danger: remaining < 1.5 };
      }
      return { now: 'Win the ruck', next: mine ? 'A/D - CLEAROUT' : 'Hold your channel', clock: remaining, danger: remaining < 1.5 };
    }
    if (this.scrim) return { now: `Scrum — ${this.scrim.cadence || this.scrim.stage}`, next: 'Pound A/D when the referee calls SET', clock: 0, danger: false };
    if (this.lo) return { now: `Lineout — ${this.lo.call.label}`, next: this.lo.stage === 'CALL' ? 'A/D to change the call, SPACE to throw' : 'Stop the bar in the gold band', clock: 0, danger: false };
    if (this.ml) {
      const m = this.ml;
      if (m.exit !== 'NONE') {
        return { now: m.exit.replace(/_/g, ' '), next: 'The maul exit is committed', clock: 0, danger: false };
      }
      if (m.contest === 'PENDING') {
        return {
          now: `Maul re-gate — ${m.regateWindows.length} of 4 input beats closed`,
          next: 'Alternate A/D once in each beat to win control',
          clock: Math.max(0, MAUL_REGATE_WINDOW_SECONDS - m.regateWindowT), danger: false,
        };
      }
      const attackControl = m.contest === 'ATTACK_CONTROL';
      /* SPEC_08 (T-65): the stall rides THIS channel — the same one the ruck
       * countdown lives in. While the USE IT call is live, the line reads as
       * the referee (one persistent word) and the number is the time to the
       * REAL consequence (maulUseItClock) — Playtest 2: TIME TO ACT, never
       * ambient. The old code showed `5 - stallClock` in every mode, including
       * the two where nothing happens at 5 s. */
      if (maulUseItCall(m)) {
        return {
          now: 'USE IT',
          next: attackControl && this.isHuman(m.attacking)
            ? 'Call your exit — A/D peels, SPACE transfers to 9, L picks and goes'
            : 'The maul is held — the referee\'s clock decides it',
          clock: maulUseItClock(m),
          danger: true,
        };
      }
      return {
        now: `${attackControl ? 'Attack' : 'Defence'} controls the maul — ${m.speed.toFixed(1)} m/s`,
        next: attackControl && this.isHuman(m.attacking)
          ? 'A/D peels, SPACE transfers to 9, L picks and goes'
          : 'The maul is held; wait for the use-it decision',
        clock: 0,
        danger: false,
      };
    }
    if (this.op) {
      const o = this.op;
      const mine = o.attacking === this.ctrlPlayer.team;
      if (!mine) return { now: 'They have the ball', next: 'X to dive, C to smother, Q to switch defender', clock: 0, danger: o.toLine < 22 };
      if (o.protect > 0) return { now: 'Ball is out — you have a stride before they can touch you', next: 'Run, or pass before the line arrives', clock: o.protect, danger: false };
      if (o.pressure > 0.7) return { now: 'You are about to be tackled', next: 'Pass now, or press I to take contact on your terms', clock: 0, danger: true };
      return {
        now: `Phase ${o.phase} · ${o.gained >= 0 ? '+' : ''}${o.gained.toFixed(0)} m · ${o.toLine.toFixed(0)} m to the line`,
        next: this.passOpts.length ? `J to ${this.passOpts.find((x) => x.side === -1)?.player.num ?? '—'}, K to ${this.passOpts.find((x) => x.side === 1)?.player.num ?? '—'}` : 'Run into the gap',
        clock: 0, danger: false,
      };
    }
    return { now: 'Play is restarting', next: '', clock: 0, danger: false };
  }

  /** Every verb that would do something right now. */
  get affordances(): string[] {
    const out: string[] = [];
    if (this.op) {
      const attacking = this.ctrlPlayer.team === this.op.attacking;
      if (attacking) {
        if (this.passOpts.some((o) => o.side === -1)) out.push('PASS LEFT (J)');
        if (this.passOpts.some((o) => o.side === 1)) out.push('PASS RIGHT (K)');
        out.push('PUNT (L)', 'GRUBBER (H)', 'DROP GOAL (P)', 'TAKE CONTACT (I)', 'FEND (F)', 'STEP (G)');
      } else {
        out.push('DIVING TACKLE (X)', 'SMOTHER (C)', 'SWITCH DEFENDER (Q — SMART)');
      }
      out.push('RUN (A/D)', 'SPRINT (SPACE)');
    }
    /* UX-31: every live state has an A/D verb — the kicker steers his aim,
     * the pack steers its push, the jumper's call is steered through the
     * sheet. The old labels named the CONSEQUENCE (push, drive) and not
     * the VERB (steer), so the affordance reader reported "no movement
     * offered" in the middle of states where movement is the whole verb. */
    if (this.kk) { out.push('STEER AIM (A/D)', this.kk.stage === 'AIM' || this.kk.stage === 'METER' ? 'SET (SPACE)' : 'CHASE (A/D + SPRINT)'); }
    if (this.scrim) out.push('STEER THE PACK (A/D)');
    if (this.lo) out.push(this.lo.stage === 'CALL' ? 'STEER THE CALL (A/D)' : 'THROW (SPACE)');
    if (this.bd) out.push('STEER THE CLEAROUT (A/D)', 'COMMIT MORE (SPACE)');
    if (this.ml) {
      const m = this.ml;
      if (m.contest === 'PENDING') out.push('ALTERNATE THE MAUL RE-GATE (A/D)');
      else if (m.contest === 'ATTACK_CONTROL' && this.isHuman(m.attacking)) {
        out.push('WHEEL AND PEEL (A/D)', 'TRANSFER TO 9 (SPACE)', 'PICK AND GO (L)');
      } else out.push('HOLD THE MAUL UP (A/D)');
    }
    out.push('REPLAY (R)', 'PAUSE (ESC)', 'ZOOM (WHEEL)');
    return Array.from(new Set(out));
  }

  /**
   * Where a kicked ball will come down, and how long it has left. This is what
   * makes "move to where the ball is going to drop" a thing the game can say.
   */
  landingPrediction(): { x: number; z: number; eta: number } | null {
    const k = this.kk;
    if (!k || k.stage !== 'FLIGHT') return null;
    const g = 9.81;
    const floor = k.type === 'GRUBBER' ? 0.12 : 0.12;
    const disc = k.vy * k.vy + 2 * g * Math.max(0, k.by - floor);
    const t = disc > 0 ? (k.vy + Math.sqrt(disc)) / g : 0;
    return { x: k.bx + k.vx * t, z: k.bz + k.vz * t, eta: Math.max(0, t) };
  }

  /**
   * SPEC_14 — WHERE THE BALL ACTUALLY IS, as a world point.
   *
   * `focusPoint()` answers a different question: it is the CAMERA's subject,
   * and it prefers the carrier. Those two diverge the moment the ball leaves
   * his hands — during a kick the camera is on the ball at the far end of the
   * pitch while `focus()` still reports the kicker standing where he kicked
   * from, 22 m away. The BALL ON SCREEN gate was measuring `focus()` and
   * reporting the kicker as off-frame while the ball sat dead centre.
   *
   * One function so the gate and the HUD cannot drift apart again.
   */

  /* ---------------- D-2: BOUNDED SET-PIECE SETTLE ----------------
   * The set pieces all used the same shape: walk while the gap is over a
   * threshold, otherwise `place()` exactly on the slot. That final `place`
   * closes the WHOLE remaining gap in one frame, so the last step was up to
   * the threshold itself — measured at 0.87-0.91 m per frame in the lineout,
   * an implied 51.9 m/s against a 9 m/s sprint. It never tripped NO TELEPORTS
   * only because that gate's threshold was 1.4 m.
   *
   * `settleToward` closes the last gap at a bounded rate instead. It returns
   * true once the man is genuinely on his slot, so callers can pin velocity
   * and switch clips exactly as before. */
  private settleToward(p: Live, wx: number, wz: number, dt: number, tag: string): boolean {
    const gap = Math.hypot(wx - p.x, wz - p.z);
    if (gap < 0.02) { this.place(p, wx, wz, tag); return true; }
    /* A walking-on forward closes at about 2.6 m/s; cap the step at that. */
    const step = Math.min(gap, 2.6 * dt);
    this.place(p, p.x + (wx - p.x) / gap * step, p.z + (wz - p.z) / gap * step, tag);
    return gap <= 0.12;
  }

  ballPoint(): { x: number; y: number; z: number } {
    if (this.chaos && this.chaos.ballSecured) {
      const p = this.chaos.player;
      return { x: p.x, y: 1.14, z: p.z };             // welded to the carrier
    }
    if ((this.phase === 'SCRUM' || this.phase === 'REPLAY') && this.scrim && this.scrim.ball.state !== 'HELD') {
      return { x: this.scrumAnchor.x + this.scrim.ball.x, y: this.scrim.ball.y + 0.06, z: this.scrumAnchor.z + this.scrim.ball.z };
    }
    if ((this.phase === 'LINEOUT' || this.phase === 'LINEOUT_REPLAY') && this.lo && this.lo.ball.state !== 'HELD') {
      return { x: this.lo.ball.x, y: this.lo.ball.y + 0.05, z: this.lo.markZ };
    }
    if ((this.phase === 'KICK' || this.phase === 'KICK_REPLAY') && this.kk) {
      return { x: this.kk.bx, y: this.kk.by + 0.12, z: this.kk.bz };
    }
    if (this.phase === 'OPEN_PLAY' && this.op) {
      const b = this.bc.free ?? this.op.ball;
      return { x: b.x, y: b.y, z: b.z }; // the same physical body/socket the rig draws
    }
    if ((this.phase === 'MAUL' || this.phase === 'MAUL_REPLAY') && this.ml) return { x: this.ml.x, y: 1.02, z: this.ml.z };
    if ((this.phase === 'BREAKDOWN' || this.phase === 'BREAKDOWN_REPLAY') && this.bd) {
      const b = this.bd;
      if (b.ball.placed || b.stage === 'RUCK' || b.stage === 'RECYCLE') return { x: b.ball.x, y: 0.16, z: b.ball.z };
      const carrier = b.players.find((p) => p.role === 'CARRIER');
      if (carrier) return { x: carrier.x + 0.28, y: carrier.down ? 0.3 : 1.05, z: carrier.z };
    }
    const f = this.focusPoint();
    return { x: f.x, y: 1, z: f.z };
  }

  /**
   * Ground point under the viewport centre ray. The same point drives the HUD
   * reticle's loose-ball/tackle state and the local avatar's arm reach, so the
   * hand cannot aim at a different ball than the player sees.
   */
  reticleAimPoint(): { x: number; y: number; z: number } {
    const c = this.cam;
    const down = Math.max(0.08, c.tilt);
    const range = clamp((c.h - 0.45) / Math.tan(down), 2.5, 24);
    return {
      x: clamp(c.x + Math.sin(c.yaw) * range, -34, 34),
      y: 0.9,
      z: clamp(c.z + Math.cos(c.yaw) * range, -60, 60),
    };
  }

  /** Public read on the focus point, so tests and the HUD agree on the subject. */
  focus(): { x: number; z: number } { return this.focusPoint(); }

  get A() { return this.teams.A; }
  get B() { return this.teams.B; }
  get minute() { return Math.min(80, Math.floor(((this.half - 1) * 40 * 60 + this.clock) / 60)); }
  get clockText() {
    const total = (this.half - 1) * 40 * 60 + this.clock;
    const m = Math.floor(total / 60), s = Math.floor(total % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  attack(): 'A' | 'B' { return this.possession; }
  defending(): 'A' | 'B' { return this.possession === 'A' ? 'B' : 'A'; }
  isHuman(team: 'A' | 'B') { return !this.teams[team].cpu; }

  /** SPEC_03's maul instruction is shared by the HUD and trace/audit surface. */
  maulPrompt(): string {
    const m = this.ml;
    if (!m) return '';
    if (m.exit !== 'NONE') {
      if (m.exit === 'TRANSFER_TO_9') return 'THE NINE IS TAKING IT AWAY';
      return `${m.exit.replace(/_/g, ' ')} — PLAY CONTINUES`;
    }
    if (m.contest === 'PENDING') return `A / D ALTERNATE — WIN THE MAUL (${m.regateWindows.length}/4)`;
    if (m.contest === 'ATTACK_CONTROL' && this.isHuman(m.attacking)) {
      return 'A / D PEEL · SPACE TRANSFER TO 9 · L PICK AND GO';
    }
    if (m.contest === 'DEFENCE_CONTROL' && m.humanTeam !== null) {
      return 'A / D WON THE HOLD-UP — WAIT FOR USE IT';
    }
    return m.contest === 'ATTACK_CONTROL' ? 'THE MAUL IS YOURS — PLAYING IT AWAY' : 'THE MAUL IS HELD UP';
  }

  slider(team: 'A' | 'B', id: string) { return this.teams[team].sliders.find((s) => s.id === id)?.v ?? 50; }
  get ctrlPlayer(): Live { return this.live[this.ctrl]; }

  /* ---------------- feedback ---------------- */

  /* ==================== T-08 — THE EVENT BUS ====================
   * (the bus itself and the sequencer state live here; the drain policy and
   * the commentary state machine live in engine/commentary.ts — T-03) */
  eventBus: BroadcastEvent[] = [];
  emitEv(e: BroadcastEvent) /* T-03: engine-internal */ { if (this.eventBus.length < 24) this.eventBus.push(e); }
  /** Everything that happened this frame, for presentation only. */
  frameEvents: BroadcastEvent[] = [];
  /* T-10 — the audio layer. Presentation only; reads the same frameEvents
   * bus as the camera and the commentary. Silent until a user gesture. */
  audio = new MatchAudio();

  /* ==================== T-09 — COMMENTARY SEQUENCING ====================
   * IDLE -> BUILDUP -> CLIMAX -> RESOLUTION (the machine itself is in
   * engine/commentary.ts; this is its state). */
  seqState: 'IDLE' | 'BUILDUP' | 'CLIMAX' | 'RESOLUTION' = 'IDLE';
  phasesGained = 0;
  gainWindow: number[] = [];
  seqLastPoss: 'A' | 'B' | null = null;
  lastLineAt = -99;
  recentLines: string[] = [];
  bankLastAt: Record<string, number> = {};

  commentate(key: string, extra?: string) { commentate(this, key, extra); }

  private commentarySequencer() { commentarySequencer(this); }

  say(text: string) { this.feed.unshift({ text, at: this.t }); if (this.feed.length > 30) this.feed.pop(); }

  /* ---- SPEC_15 — the referee speaks in the world, not in the HUD ---- */

  /**
   * Push a world-space line, anchored above the referee's head. The four
   * control affordances do NOT come through here — they are a state of the
   * ruck and the maul, and `refPrompt()` derives them at the point of
   * interaction every frame instead of queueing one per frame.
   */
  refSay(text: string, kind: BubbleKind = 'LAW_CALL', ttl = 3.2) {
    const last = this.refBubbles[this.refBubbles.length - 1];
    /* Do not stack the same words inside a third of a second — a law call can
     * be re-issued on consecutive frames while a phase resolves. */
    if (last && last.text === text && this.t - last.at < 0.35) { last.at = this.t; last.ttl = ttl; return; }
    this.refBubbles.push({ text, kind, at: this.t, ttl });
    if (this.refBubbles.length > 6) this.refBubbles.shift();
  }

  /**
   * The one bubble on screen.
   *
   * Recency wins, not priority. The first cut ranked strictly by kind and a
   * measurement caught it: a scrum call issued 1.9 s after a penalty was
   * swallowed by the penalty still on screen, and the audit's "every call
   * produced a bubble" failed at a 2.8 s delay. A referee says the newest
   * thing, so the newest thing is what shows. The one exception is a card —
   * it owns the screen for its first beat, because the walk of shame is the
   * story and a routine restart must not talk over it.
   */
  refBubbleHead(): RefBubble | null {
    let newest: RefBubble | null = null;
    let top: RefBubble | null = null;
    for (const b of this.refBubbles) {
      if (this.t - b.at > b.ttl) continue;
      if (!newest || b.at > newest.at) newest = b;
      if (!top) { top = b; continue; }
      const pb = BUBBLE_PRIORITY[b.kind], pa = BUBBLE_PRIORITY[top.kind];
      if (pb > pa || (pb === pa && b.at > top.at)) top = b;
    }
    if (!newest) return null;
    if (top && top !== newest && top.kind === 'CARD' && this.t - top.at < 1.5) return top;
    return newest;
  }

  /** Drop expired bubbles. Called once per frame; a replay freezes them. */
  private expireRefBubbles() {
    if (!this.refBubbles.length) return;
    this.refBubbles = this.refBubbles.filter((b) => this.t - b.at <= b.ttl);
  }

  /**
   * The live control affordance, as a SITE bubble at the point of interaction.
   * Derived, not queued: these are a state of the breakdown and the maul, not
   * events, and pushing one per frame would flood the queue. Returns null when
   * there is nothing for the player to press.
   */
  refPrompt(): { text: string; colour: string; x: number; z: number; y: number } | null {
    if (this.ml && (this.phase === 'MAUL' || this.phase === 'MAUL_REPLAY')) {
      const s = this.ml;
      if (maulUseItCall(s)) return { text: 'USE IT', colour: '#ff6a5a', x: s.x, z: s.z, y: 4.9 };
    }
    if (this.bd && (this.phase === 'BREAKDOWN' || this.phase === 'BREAKDOWN_REPLAY')) {
      const s = this.bd;
      if (s.groundAt >= 0) {
        if (s.stage === 'RECYCLE') return { text: 'SECURED', colour: '#6ee7a0', x: s.contactX, z: s.contactZ, y: 4.9 };
        if (s.jackalActive) return { text: 'COMMIT - SPACE', colour: '#ffd76a', x: s.contactX, z: s.contactZ, y: 4.9 };
        return { text: 'A/D - CLEAROUT', colour: '#6ee7a0', x: s.contactX, z: s.contactZ, y: 4.9 };
      }
    }
    return null;
  }
  banner_(text: string) { this.banner = text; this.bannerAt = this.t; }
  showHint(text: string, secs = 4) { this.hint = text; this.hintUntil = this.t + secs; }

  /** Every law is explained in one line the first time it is applied. */
  lawCall(key: string, call: string, team: 'A' | 'B') { /* T-03: engine module */ return lawCall(this, key, call, team); }


  shake(a: number) { this.shakeT = Math.max(this.shakeT, a); }

  /* ============================ UPDATE ============================ */

  /* ============================ CHAOS SIM ============================ */

  /** Running FPS estimate for the stress mode (updated once a second). */
  chaosFps = 0;
  /** Sequential token used to abandon an in-flight TARCS bootstrap on restart. */
  private chaosPhysicsSerial = 0;

  /** Drive the TARCS world: steer the TABS ragdolls, step, and write back. */
  private updateChaosPhysics(dt: number, input: Input, pressed: Set<string>, c: ChaosScrimState): void {
    const phys = c.physics!;
    const player = c.player;
    player.controlled = true;
    player.carrier = true;

    /* Go where the player is pointing. The ball is welded by TARCS, so the
     * carrier just runs; the solver reads all 14 bodies and resolves every
     * collision. */
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const iz = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const mag = Math.hypot(ix, iz);
    const sprint = input.sprint;
    const pSpeed = maxSpeed(player, true, sprint, player.stamina);
    let pvx = 0, pvz = 0;
    if (mag > 0) {
      pvx = (ix / mag) * pSpeed;
      pvz = (iz / mag) * pSpeed;
      player.tx = clamp(player.x + (ix / mag) * 4.2, -33, 33);
      player.tz = clamp(player.z + (iz / mag) * 4.2, -58, 58);
      player.urgency = sprint ? 1.2 : 1;
      if (Math.abs(pvz) > 0.3) player.face = pvz > 0 ? 1 : -1;
    } else {
      player.tx = player.x;
      player.tz = player.z;
      player.urgency = 0.5;
    }
    player.job = 'BALL SECURED — CARRY';

    /* Set the desired horizontal velocity for one TABS ragdoll. */
    const drive = (i: number, vx: number, vz: number, flail: number) => {
      const rag = phys.ragdolls[i];
      const h = rag.hips.linvel();
      const ch = rag.chest.linvel();
      rag.hips.setLinvel({ x: vx, y: h.y, z: vz }, true);
      rag.chest.setLinvel({ x: vx, y: ch.y, z: vz }, true);
      if (flail !== 0) rag.hips.setAngvel({ x: 0, y: flail, z: 0 }, true);
      else rag.hips.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };

    drive(0, pvx, pvz, 0);

    /* TARCS FEND — this is deliberately applied to the live eight-body TABS
     * ragdoll, not the separate articulated-ragdoll motor. The arm bodies are
     * light enough to swing quickly, but the high angular damping makes them
     * behave like stiff steel rods during the contact window. */
    const carrierRag = phys.ragdolls[0];
    const armL = phys.ragdolls[0].bodies[2];
    const armR = phys.ragdolls[0].bodies[3];
    const setFendDamping = (damping: number) => {
      armL.setAngularDamping(damping);
      armR.setAngularDamping(damping);
    };

    if (pressed.has('fend')) {
      /* `fendEnd` belongs to the chaos carrier and uses Rapier time so a slow
       * render frame cannot lengthen or shorten the physical action. */
      c.fendEnd = phys.world.simTime + CHAOS_FEND_SECONDS;

      /* A vertical arm rotates into the horizontal travel direction around
       * the perpendicular axis (v.z, 0, -v.x). Prefer the velocity being
       * driven this frame, then the solver's last velocity, then the carrier's
       * facing so a fend from rest still has a deterministic reach. */
      const fendVx = mag > 0 ? pvx : player.vx;
      const fendVz = mag > 0 ? pvz : player.vz;
      const fendSpeed = Math.hypot(fendVx, fendVz);
      const fendDirX = fendSpeed > 0.15 ? fendVx / fendSpeed : 0;
      const fendDirZ = fendSpeed > 0.15 ? fendVz / fendSpeed : player.face || 1;
      const armSwing = {
        x: fendDirZ * CHAOS_FEND_ANGULAR_SPEED,
        y: 0,
        z: -fendDirX * CHAOS_FEND_ANGULAR_SPEED,
      };
      setFendDamping(10);
      armL.setAngvel(armSwing, true);
      armR.setAngvel(armSwing, true);

      /* Drive through the fend as well as swinging the arms. Rapier resolves
       * the resulting rigid-arm/NPC contacts natively, so a diving rival is
       * swatted by the same solver rather than a scripted separation rule. */
      const fendImpulse = {
        x: fendDirX * CHAOS_FEND_LINEAR_IMPULSE,
        y: 0,
        z: fendDirZ * CHAOS_FEND_LINEAR_IMPULSE,
      };
      carrierRag.hips.applyImpulse(fendImpulse, true);
      carrierRag.chest.applyImpulse(fendImpulse, true);
    }

    if (c.fendEnd !== null) {
      if (phys.world.simTime < c.fendEnd) {
        setFendDamping(10);
      } else {
        setFendDamping(0.05);
        c.fendEnd = null;
      }
    } else {
      /* Keep the normal ragdoll tuning explicit, including after a restart. */
      setFendDamping(0.05);
    }

    /* SIX FRIENDLY BODIES — fan behind the carrier. */
    for (let i = 0; i < c.allies.length; i++) {
      const p = c.allies[i];
      const body = c.bodies[i + 1];
      const o = CHAOS_ALLY_FAN[i % CHAOS_ALLY_FAN.length];
      const drift = Math.sin(c.t * 2.1 + body.phase) * 0.7;
      const tx = clamp(player.x + o.x + drift, -33, 33);
      const tz = clamp(player.z + player.face * o.z, -58, 58);
      const sp = maxSpeed(p, false, false, p.stamina) * 0.82;
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      const dvx = d > 0.05 ? (dx / d) * Math.min(sp, d * 6) : 0;
      const dvz = d > 0.05 ? (dz / d) * Math.min(sp, d * 6) : 0;
      p.tx = tx; p.tz = tz; p.urgency = 0.85;
      p.job = 'FAN OUT BEHIND THE CARRIER';
      drive(i + 1, dvx, dvz, Math.sin(c.t * 5 + body.phase) * 1.2 * body.wobble);
    }

    /* SEVEN RIVAL BODIES — Flailing Dive pursuit. */
    for (let i = 0; i < c.rivals.length; i++) {
      const p = c.rivals[i];
      const body = c.bodies[1 + CHAOS_ALLY_COUNT + i];
      const dx = player.x - p.x, dz = player.z - p.z;
      const dist = Math.hypot(dx, dz) || 1e-4;
      let tx = player.x + player.vx * 0.16;
      let tz = player.z + player.vz * 0.16;
      const sway = Math.sin(c.t * 6.3 + body.phase) * 1.7 * body.wobble;
      tx += (-dz / dist) * sway;
      tz += (dx / dist) * sway;
      tx = clamp(tx, -33, 33); tz = clamp(tz, -58, 58);
      p.tx = tx; p.tz = tz;
      p.job = 'FLAILING DIVE — TARGET THE PLAYER';

      let sp = maxSpeed(p, false, true, p.stamina);
      if (body.diveT > 0) {
        body.diveT -= dt;
        sp *= 1.32;
        p.urgency = 1.32;
        tx = player.x;
        tz = player.z;
      } else {
        body.diveCd -= dt;
        p.urgency = 1.15;
        if (body.diveCd <= 0 && dist < CHAOS_DIVE_RANGE) {
          body.diveT = CHAOS_DIVE_SECONDS + R() * 0.22;
          c.dives++;
        }
      }
      const ddx = tx - p.x, ddz = tz - p.z, dd = Math.hypot(ddx, ddz);
      const dvx = dd > 0.05 ? (ddx / dd) * sp : 0;
      const dvz = dd > 0.05 ? (ddz / dd) * sp : 0;
      drive(1 + CHAOS_ALLY_COUNT + i, dvx, dvz, Math.sin(c.t * 9 + body.phase) * 2.6 * body.wobble);
    }

    /* Fixed-step TARCS. The accumulator is bounded so a long frame never
     * spirals; one frame of real input is never thrown away. */
    phys.accumulator = Math.min(phys.accumulator + dt, 0.25);
    while (phys.accumulator >= CHAOS_FIXED_DT) {
      const t0 = performance.now();
      phys.world.step(CHAOS_FIXED_DT);
      phys.accumulator -= CHAOS_FIXED_DT;
      phys.lastStepMs = performance.now() - t0;
    }

    /* The fixed-step loop may cross the deadline after the pre-step check. Do
     * the restore here too so the steel-arm tuning ends on the first frame in
     * which Rapier time is outside the fend window. */
    if (c.fendEnd !== null && phys.world.simTime >= c.fendEnd) {
      setFendDamping(0.05);
      c.fendEnd = null;
    }

    /* Write the solver back into the Live actors the renderer already reads. */
    for (let i = 0; i < c.pool.length; i++) {
      const p = c.pool[i];
      const rag = phys.ragdolls[i];
      const tr = rag.hips.translation();
      const lv = rag.hips.linvel();
      p.x = clamp(tr.x, -33, 33);
      p.z = clamp(tr.z, -58, 58);
      p.vx = lv.x;
      p.vz = lv.z;
      if (Math.abs(lv.z) > 0.3) p.face = lv.z > 0 ? 1 : -1;
      const sp = Math.hypot(lv.x, lv.z);
      const body = c.bodies[i];
      if (body.role === 'PLAYER') p.clip = player.latchedBy ? 'latchCarry' : 'carry';
      else if (body.role === 'RIVAL') {
        if (body.diveT > 0) p.clip = 'dive';
        else if (p.latchingOnto) { p.clip = 'latchHang'; p.clipT = 0; }
        else p.clip = sp > 5.6 ? 'sprint' : 'jog';
      } else {
        p.clip = sp > 5.5 ? 'sprint' : sp > 0.8 ? 'jog' : 'ready';
      }
    }

    /* Keep the one live visual latch mirroring the dense physical contact. */
    if (c.latch) {
      c.latch.t += dt;
      if (c.latch.t > 4.5) {
        player.latchedBy = null;
        player.latchDrag = undefined;
        c.latch.rival.latchingOnto = null;
        c.latch = null;
      }
    }
    if (!c.latch) {
      for (let i = 0; i < c.rivals.length; i++) {
        const r = c.rivals[i];
        if (c.bodies[1 + CHAOS_ALLY_COUNT + i].diveT <= 0) continue;
        const d = Math.hypot(r.x - player.x, r.z - player.z);
        if (d < 1.15) {
          player.latchedBy = `${r.team}:${r.num}`;
          r.latchingOnto = `${player.team}:${player.num}`;
          player.latchDrag = CHAOS_LATCH_DRAG;
          c.latch = { rival: r, player, t: 0 };
          break;
        }
      }
    }

    const held = phys.ballCarrier.held;
    c.ballSecured = held;
    c.ballState = held ? 'SECURED' : 'DROP_BALL';

    /* Shared FPS sample. */
    c.fps.frames++;
    const nowMs = performance.now();
    const windowMs = nowMs - c.fps.start;
    if (windowMs >= 1000) {
      this.chaosFps = Math.round((c.fps.frames * 1000) / windowMs);
      c.fps.start = nowMs;
      c.fps.frames = 0;
    }
  }

  /**
   * Advance the 14-body scrim.
   *
   * The loop is deliberately flat and allocation-free in the steady state:
   * `pool` and `bodies` are built once by `startChaosScrimmage()` and every
   * frame walks them by index. Contact uses the same `Live` latch fields the
   * renderer's fake-ragdoll layer reads, so a single latch exercises the
   * full TARCS ragdoll visual while the other 13 bodies keep colliding.
   */
  private updateChaos(dt: number, input: Input, pressed: Set<string>) {
    const c = this.chaos;
    if (!c) return;
    c.t += dt;

    for (const p of c.pool) {
      p.controlled = false;
      p.carrier = false;
      p.passRank = 0;
      p.movedBy = undefined;
    }

    /* Once the TARCS world is live it owns the bodies; the paper-doll
     * steer/separate fallback only covers the WASM boot window. */
    if (c.physicsReady && c.physics) {
      this.updateChaosPhysics(dt, input, pressed, c);
      return;
    }

    const player = c.player;
    const sprint = input.sprint;
    player.controlled = true;
    player.carrier = true;

    /* HUMAN CARRIER — a plain input-carried free runner. The ball is welded
     * to him; no pass or kick route can remove it in this mode. */
    const ix = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const iz = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const mag = Math.hypot(ix, iz);
    if (mag > 0) {
      player.tx = clamp(player.x + (ix / mag) * 4.2, -33, 33);
      player.tz = clamp(player.z + (iz / mag) * 4.2, -58, 58);
      player.urgency = sprint ? 1.2 : 1;
      steer(player, dt, sprint);
      if (Math.abs(player.vz) > 0.3) player.face = player.vz > 0 ? 1 : -1;
    } else {
      player.tx = player.x;
      player.tz = player.z;
      player.urgency = 0.5;
      steer(player, dt, sprint);
    }
    player.clip = player.latchedBy ? 'latchCarry' : 'carry';
    player.job = 'BALL SECURED — CARRY';

    /* SIX FRIENDLY BODIES — fan out behind the carrier on a rotating pair of
     * offsets, chasing the carrier's speed so the flank keeps a connected
     * look (the shallow side gets a little help from separation). */
    for (let i = 0; i < c.allies.length; i++) {
      const p = c.allies[i];
      const body = c.bodies[i + 1];
      const o = CHAOS_ALLY_FAN[i % CHAOS_ALLY_FAN.length];
      const drift = Math.sin(c.t * 2.1 + body.phase) * 0.7;
      p.tx = clamp(player.x + o.x + drift, -33, 33);
      p.tz = clamp(player.z + player.face * o.z, -58, 58);
      p.urgency = 0.85;
      p.job = 'FAN OUT BEHIND THE CARRIER';
      steer(p, dt, false);
      const sp = Math.hypot(p.vx, p.vz);
      p.clip = sp > 5.5 ? 'sprint' : sp > 0.8 ? 'jog' : 'ready';
    }

    /* SEVEN RIVAL BODIES — permanent Flailing Dive pursuit. They weave with a
     * per-body sine, commit a fixed-length dive when the player is in range,
     * and latch onto the carrier on contact so the ragdoll layer gets real
     * work. */
    for (let i = 0; i < c.rivals.length; i++) {
      const p = c.rivals[i];
      const body = c.bodies[1 + CHAOS_ALLY_COUNT + i];
      const dx = player.x - p.x;
      const dz = player.z - p.z;
      const dist = Math.hypot(dx, dz) || 1e-4;

      let tx = player.x + player.vx * 0.16;
      let tz = player.z + player.vz * 0.16;
      if (dist > 1e-3) {
        /* lateral flail around the direct pursuit line */
        const sway = Math.sin(c.t * 6.3 + body.phase) * 1.7 * body.wobble;
        tx += (-dz / dist) * sway;
        tz += (dx / dist) * sway;
      }
      p.tx = clamp(tx, -33, 33);
      p.tz = clamp(tz, -58, 58);
      p.urgency = p.latchingOnto ? 0.8 : 1.15;
      p.job = 'FLAILING DIVE — TARGET THE PLAYER';

      if (body.diveT > 0) {
        body.diveT -= dt;
        p.tx = player.x;
        p.tz = player.z;
        p.urgency = 1.32;
        steer(p, dt, true);
        p.clip = 'dive';
        p.clipT = Math.min(p.clipT, 0.49);
        if (body.diveT <= 0) {
          body.diveCd = 0.7 + R() * 1.4;
          p.clip = 'jog';
        }
      } else {
        body.diveCd -= dt;
        steer(p, dt, true);
        p.clip = Math.hypot(p.vx, p.vz) > 5.6 ? 'sprint' : 'jog';
        if (body.diveCd <= 0 && dist < CHAOS_DIVE_RANGE) {
          body.diveT = CHAOS_DIVE_SECONDS + R() * 0.22;
          c.dives++;
          p.clip = 'dive';
          p.clipT = 0;
        }
      }

      /* The latch owns the clip — once a rival is hanging onto the carrier we
       * never let the dive cooldown or locomotion picker blank the ragdoll. */
      if (p.latchingOnto) {
        p.clip = 'latchHang';
        p.clipT = 0;
      }
      if (Math.abs(p.vz) > 0.3) p.face = p.vz > 0 ? 1 : -1;
    }

    /* BODY SEPARATION — the same resolver the full match uses, but on the
     * 14-body pool only, keeping the frame cost O(14^2/2) instead of O(30^2). */
    separate(c.pool, dt);

    /* RAGDOLL LATCH — one rival may lock onto the carrier at a time. This is
     * what feeds the renderer's procedural fake-ragdoll layer (body tilt,
     * arm reach, spine thrash) with a live, moving pair. */
    if (c.latch) {
      c.latch.t += dt;
      const r = c.latch.rival;
      const d = Math.hypot(r.x - player.x, r.z - player.z);
      if (d > CHAOS_LATCH_BREAK || c.latch.t > 4.5) {
        player.latchedBy = null;
        player.latchDrag = undefined;
        r.latchingOnto = null;
        player.clip = 'carry';
        r.clip = 'jog';
        c.latch = null;
      }
    }

    if (!c.latch) {
      for (let i = 0; i < c.rivals.length; i++) {
        const r = c.rivals[i];
        if (c.bodies[1 + CHAOS_ALLY_COUNT + i].diveT <= 0) continue;
        const d = Math.hypot(r.x - player.x, r.z - player.z);
        if (d < 1.05) {
          player.latchedBy = `${r.team}:${r.num}`;
          r.latchingOnto = `${player.team}:${player.num}`;
          player.latchDrag = CHAOS_LATCH_DRAG;
          player.clip = 'latchCarry';
          r.clip = 'latchHang';
          r.clipT = 0;
          c.latch = { rival: r, player, t: 0 };
          c.contacts++;
          break;
        }
      }
    }

    /* FPS sample — one allocation-free count per frame, reported once a second. */
    c.fps.frames++;
    const nowMs = performance.now();
    const windowMs = nowMs - c.fps.start;
    if (windowMs >= 1000) {
      this.chaosFps = Math.round((c.fps.frames * 1000) / windowMs);
      c.fps.start = nowMs;
      c.fps.frames = 0;
    }
  }

  update(dtReal: number, input: Input, pressed: Set<string>, released = new Set<string>()) {
    /* A synchronous flag lets startOpen() know whether it is being used by a
     * live phase transition or as a deliberate headless setup call. */
    this.inUpdate = false;
    /* Unattended hold timer (T-18): counts down even while paused, so a
     * CPU-v-CPU half time resumes on its own. */
    if (this.holdTimer > 0) {
      this.holdTimer -= dtReal;
      if (this.holdTimer <= 0 && this.paused && !this.over) this.resumeSecondHalf();
    }
    if (this.paused || this.over) return;
    this.inUpdate = true;
    const dt = Math.min(dtReal, 1 / 25) * this.gameSpeed;

    /* T-43 — THE INSTANT REPLAY IS A FREEZE. R re-routed the phase to
     * 'REPLAY', whose dispatch case ran the SCRUM handler — with no scrum
     * object outside a scrum, upScrum crashed on d.scrim!, the watchdog
     * tripped, and play restarted at the focus point. That was the user's
     * "replay after a lineout" that "teleported" everyone to the opponent
     * 22: the reset mark is wherever the focus happened to be. A replay now
     * owns the frame completely — no clock, no phase handler, no brain, no
     * watchdog — and the timer exits it back into the exact phase it came
     * from. R stays live everywhere, because it can no longer break anything. */
    if (this.phase === 'REPLAY' && this.replayOf) {
      this.replayTimer -= dt;
      if (this.replayTimer <= 0) this.exitReplay();
      this.inUpdate = false;
      return;
    }

    /* T-32. The conversion ritual is dead time: the clock holds while the try
     * is celebrated and the kicker walks to the tee. It resumes on the strike. */
    const deadBall = this.kk?.stage === 'FANFARE' || this.kk?.stage === 'WALKUP';
    if (!deadBall) this.clock += dt * this.clockScale;
    if (this.clock >= this.halfLength + this.addedTime) {
      if (this.half === 1) { this.endHalf(); this.inUpdate = false; return; }
      this.endMatch(); this.inUpdate = false; return;
    }

    for (const p of this.live) {
      /* TACTICAL KICKING / SIN BIN — the bin clock is the referee's, stated
       * once in engine/referee.ts so the probe and the match agree on what a
       * ten-minute card costs. A man whose time is up does NOT walk straight
       * back into a live phase: `restoreSinBinned` returns him at the next
       * stoppage, which is what the law requires and what keeps the phase
       * rosters (rucks, scrums, lineouts) from gaining a body mid-contest. */
      if (p.sinbin > 0) p.sinbin = tickSinBin(p.sinbin, dt, this.clockScale);
      p.controlled = false;
      p.carrier = false;
      p.passRank = 0;
      p.movedBy = undefined;   // T-02: the ownership tag resets each frame
    }
    // exactly one player owns the ball at any moment — asserted every frame
    if (this.op && !this.op.ball.live && !this.bc.free) {
      const c = this.live.find((p) => p.team === this.op!.attacking && p.num === this.op!.carrierNum);
      if (c) c.carrier = true;
    }

    /* CHAOS_SCRIM owns the whole frame: no laws, no referee, no formation
     * brain, no set-piece cabinet. It is a dedicated 14-body stress loop
     * that ends by streaming the same actor contracts the match uses. */
    if (this.chaos) {
      this.updateChaos(dt, input, pressed);
      this.frameEvents = this.eventBus.splice(0);
      this.updateCamera(dt);
      this.syncActors();
      this.t += dt;
      this.inUpdate = false;
      return;
    }

    this.refSignal = Math.max(0, this.refSignal - dt);
    this.shakeT = Math.max(0, this.shakeT - dt * 2.4);
    /* W-011 — the TMO review of a corner grounding runs on real seconds and
     * always confirms or notes how close it was; it never reverses the
     * on-field decision (the fix is the check being SHOWN, not a coin
     * flip that takes tries off the board). The conversion waits for it. */
    if (this.tmo) {
      this.tmo.t += dt;
      if (this.tmo.t > 1.8 && !this.tmo.said) {
        this.tmo.said = true;
        this.say(`TMO — ANGLE ${Math.round(this.tmo.angle)}°, DOWNWARD PRESSURE ON THE BALL`);
      }
      if (this.tmo.t >= 4.2) {
        const close = this.tmo.angle < 30 ? 'CLOSE — ' : '';
        this.banner_(`${close}TRY CONFIRMED — ${this.tmo.name}`);
        this.say(`${close}TRY CONFIRMED BY THE GROUNDING`);
        this.audio.whistle('DOUBLE');
        this.tmo = null;
      }
    }
    if (this.replayTimer > 0) { this.replayTimer -= dt; if (this.replayTimer <= 0) this.exitReplay(); }
    if (this.t > this.hintUntil) this.hint = '';

    if (this.advantage > 0) {
      this.advantage -= dt;
      /* TARCS — the sequenced advantage. `stepAdvantageWatch` (engine/referee.ts)
       * reads a one-frame sensor of the game — who has the ball, how far the
       * carrier has marched from the mark, whether a kick landed in
       * territory — and returns the official's decision. Ten metres of ground
       * or an effective kick is "ADVANTAGE OVER"; the beneficiary losing the
       * ball, or the window running out without gain, is the whistle and the
       * restart AT THE MARK of the infringement. */
      const out = this.advWatch ? stepAdvantageWatch(this.advWatch, this.advantageSensor(), dt) : 'PLAY_ON';
      if (out === 'OVER') {
        this.advantage = 0;
        // Advantage taken. The penalty is gone, not merely deferred — leaving
        // pendingPenalty set here stranded it forever and it would re-fire later.
        this.pendingPenalty = null;
        this.advWatch = null;
        this.say('ADVANTAGE OVER — PLAY ON');
      } else if (out === 'WINDBACK') {
        this.advantage = 0;
        this.pendingWindback = true;   // the sweep below performs it, on the kick's other side
      }
    }
    /* THE DEFERRED WHISTLE. A ball in the air finishes its flight. The whistle
     * brings play back for the award, but the ball still comes down — killing a
     * mid-air kick left a ball that vanished at 1.3 m and never bounced. The
     * sweep re-fires every frame (NOT inside the countdown's own block, which
     * is no longer true once the window has run out), so the award lands the
     * instant the kick is done, whether it was deferred by expiry or by the
     * flight guard. */
    if ((!this.kk || this.kk.stage !== 'FLIGHT') && this.advantage <= 0) {
      if (this.pendingWindback) {
        this.pendingWindback = false;
        this.windBackAdvantage();
      } else if (this.pendingPenalty) {
        this.resolvePenalty();
      }
    }

    /* T-16. A runtime throw inside any phase handler used to propagate out of
     * update(), out of the requestAnimationFrame callback, and kill the render
     * loop — which is the hardest freeze of all to diagnose because the picture
     * simply stops with no error visible in game. Contain it here, log it where
     * the audit can see it, and force a reset. */
    try {
      switch (this.phase) {
        case 'OPEN_PLAY': this.upOpen(dt, input, pressed, released); break;
        case 'BREAKDOWN': case 'BREAKDOWN_REPLAY': this.upBreakdown(dt, input, pressed); break;
        case 'MAUL': case 'MAUL_REPLAY': this.upMaul(dt, input, pressed); break;
        case 'SCRUM': this.upScrum(dt, input, pressed); break;
        case 'LINEOUT': case 'LINEOUT_REPLAY': this.upLineout(dt, input, pressed); break;
        case 'KICK': case 'KICK_REPLAY': this.upKick(dt, input, pressed); break;
      }
      /* SPEC_25 — the catch and the punt run AFTER the phase handler and inside the
       * same containment, for two reasons. The phase has already moved the world, so
       * the craft measures a ball and a body that are where this frame says they are;
       * and its resolution path starts open play, which must not re-enter the switch
       * that is still unwinding. */
      this.bcGrip = input.secure;
      stepCraft(this, dt, input.handsUp, input.secure, input.punt, pressed, released);
      /* SPEC_12: the referee is asked ONCE per frame, over every live line in
       * the registry. He used to be asked from two phase hooks — a ruck hook
       * in the breakdown and a release-beat hook in open play — which is why
       * the scrum, the maul and the lineout had no offside line at all:
       * nobody ever asked. A whistle tears the phase down, so this runs after
       * the phase updater and before the players are told where to stand. */
      /* LATCH-AND-DRAG — THE LEAK GUARD. The two link fields live on `Live`,
       * which outlives the episode: a whistle, a try or a kick tears `op`
       * down mid-drag and would leave a man permanently at 28% pace with a
       * phantom defender attached. A latch is only ever legal inside a live
       * OPEN_PLAY episode that still owns it, so anything else is stale and
       * is cut here, once, at the top level.
       *
       * ENDURANCE — this runs BEFORE the referee's early returns below: a
       * whistle that tears the phase down returns out of update() on this
       * very frame, and a guard sitting past that return would skip the
       * frame its own whistle created. Cutting first costs nothing (the test
       * is two reads) and makes the backstop unreachable from the stoppages
       * it exists to clean up. */
      if (this.phase !== 'OPEN_PLAY' || !this.op?.latch) {
        for (const p of this.live) if (inLatch(p)) { p.latchedBy = null; p.latchingOnto = null; }
        if (this.op) clearLatch(this.op, null, null);
      }
      if (this.enforceOffsideLines(dt)) { this.inUpdate = false; return; }
      /* TARCS — the ruck entry gates. Same slot in the frame for the same
       * reason: the physics/kinematics update has written every position this
       * tick, the formation has not been steered yet, and a whistle here
       * tears the phase down before any mover can chase it. */
      if (this.enforceRuckEntryGates()) { this.inUpdate = false; return; }
      /* TACTICAL KICKING — Law 9.17, the man in the air. Same slot in the
       * frame as the offside lines and the ruck gates, and for the same
       * reason: every body has been written this tick, nothing has been
       * steered yet, and the whistle tears the phase down before any mover
       * can chase it. Like them it moves nobody — the only write is the
       * penalty. */
      if (this.enforceAerialProtection()) { this.inUpdate = false; return; }
    } catch (err) {
      this.trip(`${this.phase} threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.watchdog(dt);
    /* GET-UP LOCK — runs BEFORE think() so a recovering man is already at zero
     * velocity when the AI is asked where everyone should go, and before
     * placeBound so no phase writer can drag him either. */
    this.tickDive(dt);
    this.tickRecovery(dt);
    /* TACTICAL KICKING — the leap is armed BEFORE the jump integrator runs,
     * so a man who commits this frame is already airborne when think() is
     * asked where everyone should go and when the renderer reads his pose. */
    this.tickAerialContest(dt);
    this.tickJump(dt);
    this.think(dt, input);
    /* TACTICAL KICKING — the bin runs AFTER think() and before placeBound:
     * think() skips a binned man entirely (he has no urgency and no mark),
     * so this is his only writer and the ownership contract stays honest. */
    this.tickSinBin(dt);
    /* SPEC_04: the formation target has now been freshly assigned by `think()`;
     * capture target-slot drift before a phase-bound writer can take control. */
    this.samplePendingTargetSlots();
    this.placeBound(dt);
    // Movement is now final: a sprinting hand socket must not lag a frame.
    this.syncBallSocket();
    /* PLAYER CONTROLS — restore the persistent shirt after all phase writers
     * have had their turn. This is deliberately late: a direct headless
     * startOpen() still gets one honest setup frame, while a live pass, catch,
     * or kick can never leave the human stick on its temporary carrier. */
    if (this.roleLocked && this.roleLockTeam) {
      this.setCtrl(this.roleLockTeam, this.roleLockNum, false);
      for (const p of this.live) p.controlled = p.team === this.roleLockTeam && p.num === this.roleLockNum;
    }
    /* T-08/T-09: the bus is drained once per frame, after the phase updaters
     * have spoken and before the presentation reacts. Camera, commentary and
     * audio all read the same frameEvents. */
    this.frameEvents = this.eventBus.splice(0);
    this.updateCamera(dt);
    this.commentarySequencer();
    /* T-10 — the CROWD NOISE option gates the whole audio layer. */
    this.audio.level = this.options.crowd ?? 2;
    if (this.audio.level > 0) {
      const fpNow = this.focusPoint();
      const in22 = Math.abs(fpNow.z - FIELD.tryZ) < 22 || Math.abs(fpNow.z - FIELD.tryZFar) < 22;
      const ratio = (this.teams.A.nation.crowd + this.teams.B.nation.crowd) / 2;
      this.audio.update(dt, this.momentum, in22, ratio);
      /* TARCS — the ears ride the broadcast camera, so a hit on the far
       * touchline is quiet and off to the side while one under the lens is
       * on top of you. Same rig the renderer uses, same coordinates. */
      this.audio.setListener(this.cam.x, this.cam.h, this.cam.z, this.cam.yaw, this.cam.tilt);
      for (const ev of this.frameEvents) {
        /* Every bus event carries its own world point; pass it so the one-shot
         * is panned where it happened rather than flat in the centre. */
        const at = 'x' in ev && 'z' in ev ? { x: ev.x, y: 1, z: ev.z } : null;
        this.audio.event(ev.type, ev.type === 'TACKLE' ? ev.force : 0.5, at);
      }
    }

    /* SPEC_15 — the referee runs on his own integration, before the actor
     * stream is written, so the render sees the position he moved to. */
    stepReferee(this, this.ref, dt);
    this.expireRefBubbles();
    this.syncActors();
    this.t += dt;

    // Hand control over whenever the phase or the possession changes.
    if (this.phase !== this.lastHandoffPhase || this.possession !== this.lastHandoffPoss) {
      const changedPhase = this.phase !== this.lastHandoffPhase;
      if (this.possession !== this.lastHandoffPoss) { this.lastTurnoverAt = this.t; this.phasesGained = 0; }
      this.lastHandoffPhase = this.phase;
      this.lastHandoffPoss = this.possession;
      this.handoffControl();
      // In the tutorial, any NEW kind of contest freezes the match and explains
      // itself before the player has to do anything about it.
      if (changedPhase && this.tut.active && this.tut.playing) this.tutorialWatchPhase();
    }
    // Judge the last CPU call so the escalation ladder can respond to it.
    if (this.op) this.judgeLastCall(this.op.gained);
    this.inUpdate = false;
  }

  private lastHandoffPhase: Phase | null = null;
  /** T-13: when possession last changed — the turnover situations key off it. */
  lastTurnoverAt = -99;
  private lastHandoffPoss: 'A' | 'B' | null = null;

  /* ============================ WATCHDOG ============================
   * No phase in rugby lasts forever. A scrum resolves, a ruck resolves, a kick
   * lands. If one of them does not, the match is stuck and the player is left
   * staring at a frozen field with no idea why.
   *
   * This is a safety net, not a design. Every trip is a real bug, so each one is
   * logged to the feed and counted, and the engine self-heals to open play
   * rather than leaving the player stranded.
   */
  phaseAge = 0;   // watchdog timer (public: a human aiming is live input, kick.ts feeds it)
  /** Playtest 3: after a ruck the losing side must RELEASE AND RETREAT —
   * this line (contact point) holds them behind their offside line for
   * the beat, instead of letting them tackle the nine on the frame the
   * ball is out. */
  releaseBeat: { z: number; dir: number; until: number } | null = null;

  /**
   * Snapshot the sample ledger rather than exposing its mutable arrays. P50/P90
   * are calculated from actual target-slot distances, and the rate denominator
   * is eligible player-observations, never compressed display-clock frames.
   */
  /**
   * SPEC_13 — the Law 11 ledger. Deliberately separate from
   * `formationIntegrity`: formation asks whether a man is standing in the
   * right place, this asks whether a ball was thrown legally, and mixing the
   * two would make neither auditable.
   */
  get passLawIntegrity(): PassLawTelemetry {
    const c = this.passLawCounts;
    const rels = this.passLawSamples.slice().sort((a, b) => a - b);
    const q = (p: number) => rels.length ? rels[Math.min(rels.length - 1, Math.floor(p * rels.length))] : 0;
    return {
      releases: c.releases,
      forwardReleases: c.forwardReleases,
      whistles: c.whistles,
      candidatesRejected: c.candidatesRejected,
      clamped: c.clamped,
      relP50: q(0.5),
      relP90: q(0.9),
      relMax: rels.length ? rels[rels.length - 1] : 0,
      worstForwardMetres: c.worstForwardMetres,
    };
  }

  /**
   * Record a throw at the release frame. Called by `doPass` for EVERY pass,
   * whatever the toggle, so the rate is a property of the football and not of
   * the referee — the same argument that made SPEC_12's OFF mode worth having.
   */
  notePassRelease(rel: number, forwardMetres: number, whistled: boolean) {
    this.passLawCounts.releases++;
    this.passLawSamples.push(rel);
    if (rel > 0) {
      this.passLawCounts.forwardReleases++;
      this.passLawCounts.worstForwardMetres = Math.max(this.passLawCounts.worstForwardMetres, forwardMetres);
    }
    if (whistled) this.passLawCounts.whistles++;
  }

  /** A candidate the law removed before it could be offered. */
  notePassCandidateRejected() { this.passLawCounts.candidatesRejected++; }

  /** A release the CPU threw flatter rather than forward. Counted, not hidden. */
  notePassClamped() { this.passLawCounts.clamped++; }

  get formationIntegrity(): FormationIntegrityTelemetry {
    const c = this.formationCounts;
    const rate = (team: 'A' | 'B') => c.eligiblePositionSamples[team]
      ? (100 * c.offsidePlayerSamples[team]) / c.eligiblePositionSamples[team]
      : 0;
    const recoveryEngineP90 = {
      A: percentile(this.formationRecoverySamples.A, 0.9),
      B: percentile(this.formationRecoverySamples.B, 0.9),
    };
    return {
      ruckFormationOpportunities: c.ruckFormationOpportunities,
      defensiveLineResetOpportunities: c.defensiveLineResetOpportunities,
      eligiblePositionSamples: { ...c.eligiblePositionSamples },
      targetSlotSamples: { ...c.targetSlotSamples },
      offsidePlayerSamples: { ...c.offsidePlayerSamples },
      offsideEpisodes: { ...c.offsideEpisodes },
      offsideEpisodesByKind: { ...c.offsideEpisodesByKind },
      offsideEpisodesByTeamKind: { ...c.offsideEpisodesByTeamKind },
      offsideWhistlesByKind: { ...c.offsideWhistlesByKind },
      offsideSuppressed: { ...c.offsideSuppressed },
      offsideWarnings: { ...c.offsideWarnings },
      offsideWhistleDepth: c.offsideWhistleDepth.slice(),
      offsideRate: { A: rate('A'), B: rate('B') },
      formationDriftP50: {
        A: percentile(this.formationDriftSamples.A, 0.5),
        B: percentile(this.formationDriftSamples.B, 0.5),
      },
      formationDriftP90: {
        A: percentile(this.formationDriftSamples.A, 0.9),
        B: percentile(this.formationDriftSamples.B, 0.9),
      },
      formationMarkAnchorP90: {
        A: percentile(this.formationMarkAnchorSamples.A, 0.9),
        B: percentile(this.formationMarkAnchorSamples.B, 0.9),
      },
      formationSampleCounts: {
        A: this.formationDriftSamples.A.length,
        B: this.formationDriftSamples.B.length,
      },
      recoveryEpisodes: { ...c.recoveryEpisodes },
      recoveryEngineP90,
      recoveryClockP90: {
        A: recoveryEngineP90.A * this.clockScale,
        B: recoveryEngineP90.B * this.clockScale,
      },
    };
  }

  private formationSampleDue(token: string) {
    const last = this.formationSampleAt.get(token);
    if (last !== undefined && this.t - last < FORMATION_SAMPLE_SECONDS - 1e-9) return false;
    this.formationSampleAt.set(token, this.t);
    return true;
  }

  /** A player is excluded only for an active lawful/role-specific exception. */
  private isFormationEligible(p: Live) {
    /* `recoverT` sits alongside `down` for the same reason: a man on the
     * ground and a man pushing himself up off it are both physically
     * unavailable, and counting either into the defensive line's shape
     * measures a line that does not exist yet. */
    if (p.sinbin > 0 || p.down || (p.recoverT ?? 0) > 0 || p.carrier || p.beatenT > 0) return false;
    return !/(CHASE|TACKLE|FIELD THE KICK)/.test(p.job.toUpperCase());
  }

  private observeOffsidePosition(team: 'A' | 'B', penetration: number) {
    this.formationCounts.eligiblePositionSamples[team]++;
    if (penetration > OFFSIDE_EPSILON_METRES) this.formationCounts.offsidePlayerSamples[team]++;
  }

  /** `tx`/`tz` are the existing intelligence target mark for the live actor. */
  private observeTargetSlot(p: Live) {
    if (!Number.isFinite(p.tx) || !Number.isFinite(p.tz)) return;
    this.formationCounts.targetSlotSamples[p.team]++;
    /* SPEC_10 B2d: settle-gate the drift ledger. The old composition pushed
     * every eligible player's distance at every due-sample, so a legitimate
     * 20 m slot-run after a phase change dominated the P90 and the metric
     * read 15-17 m against a 2.5 m ceiling (D1 flag ⚠4). A sample enters the
     * ledger only when the target has been stable (±0.75 m) since the
     * previous due-sample — the mark being HELD and the man not yet on it is
     * the drift the metric exists to catch. Measurement-only: the eligible
     * count above still records every due-sample, so the denominator keeps
     * its meaning. */
    const dxT = p.tx - p.x, dzT = p.tz - p.z;
    const distT = Math.hypot(dxT, dzT);
    const prev = this.formationLastTarget.get(p);
    const stable = prev !== undefined && Math.hypot(p.tx - prev.x, p.tz - prev.z) < 0.75;
    this.formationLastTarget.set(p, { x: p.tx, z: p.tz, d: distT, since: this.t });
    if (!stable) return;
    /* SPEC_11 RECALIBRATION.
     *
     * The old rule dropped every sample whose closing speed exceeded
     * 0.3 m/s, on the theory that a man running at his mark is executing the
     * shape rather than drifting from it. That is a VELOCITY test, and it
     * is the wrong instrument: it asks "is he moving fast?" when the
     * question is "is he getting there?". Two failures follow.
     *
     *   1. A man sprinting in the wrong direction — orbiting the mark,
     *      being shunted by `separate()`, sprinting past it — has a velocity
     *      with a positive component toward the mark and was silently
     *      forgiven every frame.
     *   2. A man converging beautifully on a mark in the wrong place was
     *      forgiven too, which is how a 25 m systematic anchor error sat
     *      under a 0.3 m P90 for a whole season.
     *
     * So the test is now PROGRESS, measured across due-samples: how much of
     * the gap he has actually closed since the last sample. Not closing is
     * drift at any speed, in any direction; closing is executing the shape
     * however far he still has to run. Failure 2 is not a progress problem
     * at all — a wrong mark is caught by the companion measurement below,
     * which measures the MARK against the ball rather than the man against
     * the mark. */
    const progress = prev ? prev.d - distT : 0;
    const converging = distT <= ON_MARK_METRES || progress > CONVERGE_PROGRESS_METRES;
    if (!converging) this.formationDriftSamples[p.team].push(distT);
    /* The companion measurement, and the one that would have caught
     * SPEC_11 on its own: a formation is a shape drawn AROUND THE BALL, so
     * the distance from a mark to the live ball is a property of the
     * formation, not of the player chasing it. */
    const f = this.focusPoint();
    this.formationMarkAnchorSamples[p.team].push(Math.hypot(p.tx - f.x, p.tz - f.z));
  }

  /* ==================== SPEC_12 — THE OFFSIDE ENGINE ====================
   *
   * Three invariants, none of which the old code held:
   *
   *   1. ONE REGISTRY. Every line in the game is a row in `liveOffsideLines()`
   *      (`engine/offside.ts`). Detection, the window, the verdict and the
   *      audit all iterate it, so a new line is a data row and not a new
   *      branch in five places.
   *   2. ONE WINDOW PER PHASE CONTINUUM. The old code minted a window per ruck,
   *      and rucks form every ~1.6 s, so a man who stood offside through four
   *      consecutive rucks started his sustained clock from zero four times —
   *      210 observed breaches collapsed into one episode. The window is keyed
   *      by line kind and possession, and the settle restarts when the LINE
   *      moves, not when the phase object is replaced.
   *   3. ONE VERDICT, ONE WRITER. `offsideVerdict()` decides and this is the
   *      only place a whistle is produced, so no future branch can blow for
   *      offside without passing the toggle.
   */

  /**
   * The referee's temper, read from the option. The two toggles are orthogonal:
   * this one says how fussy he is, `offsideAiClean` says whether the CPU is
   * allowed to infringe at all. Neither is read as `!== 0` any more — the old
   * binary test meant every value except one silently disabled the whistle,
   * which is the report this spec exists to answer.
   */
  private offsideProfile(): StrictnessProfile {
    const mode = this.options.offside ?? 1;
    return mode === 0 ? STRICTNESS.STRICT : mode === 2 ? STRICTNESS.OFF : STRICTNESS.LENIENT;
  }

  /** Who may offend against a line, minus the men the law exempts. */
  private offsideCandidates(line: OffsideLine, team: 'A' | 'B'): Live[] {
    if (!line.offenders.includes(team)) return [];
    /* A man bound into the contest IS the line — he cannot be offside against
     * himself. The carrier is never offside against the ball. Both are already
     * excluded by `isFormationEligible`; the bound test is stated here too
     * because the set-piece lines make it load-bearing. */
    /* A man getting to his feet is not penalised for where he is lying. The
     * get-up lock pins him in place for the length of the stand-up animation,
     * so without this exemption he accrues offside time he is physically
     * unable to clear — which pushed offside penalties per team from inside
     * the realistic band to 5.3 (band 2-4). World Rugby 11.4 likewise allows
     * a player time to get up and retire. */
    return this.live.filter((p) => p.team === team && !p.bound && p.sinbin <= 0
      && !line.participants?.has(`${p.team}:${p.num}`)
      && this.isFormationEligible(p));   // excludes recoverT — see there
  }

  /**
   * Evaluate every live line and blow at most once per team per window.
   * Returns true when a whistle ended the phase, so the caller can stop.
   *
   * Diagnostics are NEVER gated: an episode is counted in every mode at one
   * fixed sensitivity, so "OFF changes no counts" is true by construction and
   * a comparison between modes is comparing like with like.
   */
  enforceOffsideLines(dt: number): boolean {
    const profile = this.offsideProfile();
    const forceAiClean = (this.options.offsideAiClean ?? 0) === 1;
    const lines = liveOffsideLines(this);
    if (!lines.length) { this.offsideLedger.expire(this.t); return false; }

    for (const line of lines) {
      const key = `${line.kind}:${this.possession}`;
      /* The SAMPLE is keyed to the formation instance, the WINDOW to the
       * continuum. See `sampleKeyFor` for why they differ. */
      const sampling = this.formationSampleDue(this.sampleKeyFor(line.kind));
      if (line.kind === 'RUCK') this.formationCounts.ruckFormationOpportunities++;
      if (line.kind === 'RESET') this.formationCounts.defensiveLineResetOpportunities++;

      /* The formation sample is a measurement of the DEFENDING side, and it
       * belongs to the defending side whoever can offend against the line. At
       * a ruck both teams can — the attacking side's own line is the ball — so
       * taking it from `line.offenders` instead sampled whichever team the loop
       * happened to reach last, which is to say the attack half the time. The
       * drift ledger then filled with attackers running to attacking marks,
       * and the P90 target-slot drift tripled overnight. */
      if (sampling && (line.kind === 'RUCK' || line.kind === 'RESET')) {
        const def = this.defending();
        const lt = line.lineFor(def);
        if (lt) {
          for (const p of this.formationSampleSet(line, def)) {
            this.observeOffsidePosition(def, Math.max(0, penetrationOf(p, lt)));
          }
          this.pendingTargetSlotSample = {
            token: this.sampleKeyFor(line.kind),
            defending: def, kind: line.kind === 'RUCK' ? 'RUCK' : 'RESET',
          };
        }
      }

      for (const team of line.offenders) {
        if (this.offsideLedger.alreadyWhistled(this, line, team)) continue;
        const candidates = this.offsideCandidates(line, team);
        for (const p of candidates) {
          const lt = line.lineFor(team);
          if (!lt) continue;
          const breach = this.offsideLedger.observe(this, line, p, penetrationOf(p, lt), dt);
          /* "Sustained" is a DIAGNOSTIC threshold, not the referee's: one
           * fixed sensitivity in every mode, so the episode count is a property
           * of the football and not of the option. Everything the referee
           * decides — which lines he watches, how deep, how long, how near the
           * ball, whether a retreating man is forgiven — lives in the profile
           * below, which is why OFF reports the same episodes as STRICT with
           * none of the whistles. */
          if (!breach || breach.sustainedFor < OFFSIDE_SUSTAINED_SECONDS) continue;

          /* one sustained breach per team per window, whoever committed it */
          const episodeKey = `${key}${team}#${this.offsideLedger.serialOf(this, line)}`;
          if (this.offsideEpisodeMarked !== episodeKey) {
            this.offsideEpisodeMarked = episodeKey;
            this.formationCounts.offsideEpisodes[team]++;
            const byKind = this.formationCounts.offsideEpisodesByKind;
            byKind[line.kind] = (byKind[line.kind] ?? 0) + 1;
            const byTeamKind = this.formationCounts.offsideEpisodesByTeamKind;
            const tk = `${team}:${line.kind}`;
            byTeamKind[tk] = (byTeamKind[tk] ?? 0) + 1;
          }
          let verdict = offsideVerdict(profile, breach, !this.isHuman(team), forceAiClean);
          /* OBSERVE keeps looking. This was a `break` once, which meant the
           * first sustained offender in the team decided the matter: a man
           * loitering half a metre past the line hid the man five metres past
           * it, because `candidates` is in shirt order and 7 came before 11.
           * The harness caught it — 1381 CPU episodes, 0 CPU whistles — and it
           * is the clearest possible argument for measuring the funnel instead
           * of trusting the count. */
          /* TARCS — THE PRE-RELEASE WINDOW. LENIENT's 4 m / 2.4 s was
           * calibrated on loitering across whole phases; at the breakdown the
           * window a defender has to influence the ruck is the life of the
           * ruck itself, so a man more than a stride over his own hindmost-
           * foot line while the ball is still IN the ruck — before the
           * scrumhalf has released or played it — is blown on the second
           * question (`preReleaseWhistle`, engine/offside.ts). The retreat
           * grace and the materiality limit still apply, Force-AI-Clean
           * still suppresses the CPU rather than punishing the player, and
           * the one-whistle-per-window latch is the RUCK line's own, so this
           * can never stack a second whistle on the same ruck. */
          if (verdict === 'OBSERVE' && line.kind === 'RUCK' && profile.lines.includes('RUCK')
            && this.bd && preReleaseWhistle(breach, !scrumhalfReleased(this.bd),
              profile.materialRadius, profile.retreatingGrace)) {
            verdict = forceAiClean && !this.isHuman(team) ? 'SUPPRESS' : 'WHISTLE';
          }
          if (verdict === 'OBSERVE') continue;
          if (verdict === 'WHISTLE' && this.offsideWarnedHalf[team] !== this.half) {
            /* The first material offence by this side this half is spoken, not
             * blown. One whistle per team per window is already latched, so
             * this cannot stack: the warning costs the phase nothing and the
             * next one costs three points or a lineout. */
            this.offsideWarnedHalf[team] = this.half;
            this.formationCounts.offsideWarnings[team]++;
            this.offsideLedger.markWhistled(this, line, team);
            this.refSignal = 1.8;
            this.refSignalText = `${REFEREE_CALLS.OFFSIDE} — WARNING`;
            this.say(this.refSignalText);
            /* SPEC_15 — he says it in the world too. */
            this.refSay(this.refSignalText, 'NARRATIVE', 3);
            break;
          }
          if (verdict === 'SUPPRESS') {
            /* Force AI Clean: the AI was PREVENTED, not forgiven. Recording it
             * is what keeps "zero AI episodes" an honest gate rather than a
             * tautology — an AI that needed suppressing is the defect. */
            this.offsideLedger.markWhistled(this, line, team);
            this.formationCounts.offsideSuppressed[team]++;
            if (import.meta.env?.DEV) {
              console.warn(`[SPEC_12] ${team}${breach.player.num} needed Force-AI-Clean suppression — `
                + `${breach.penetration.toFixed(1)} m offside at the ${line.kind} line`);
            }
            break;
          }
          /* WHISTLE. The single writer of an offside penalty. */
          this.offsideLedger.markWhistled(this, line, team);
          this.teams[team].stats.offsides++;
          const byKindW = this.formationCounts.offsideWhistlesByKind;
          byKindW[line.kind] = (byKindW[line.kind] ?? 0) + 1;
          this.formationCounts.offsideWhistleDepth.push({
            kind: line.kind, team, depth: breach.penetration, sustained: breach.sustainedFor,
            toBall: breach.toBall, retiring: breach.retiring,
          });
          const opp: 'A' | 'B' = team === 'A' ? 'B' : 'A';
          this.pendingTargetSlotSample = null;
          this.beginPenalty(opp, REFEREE_CALLS.OFFSIDE, breach.player.num);
          this.offsideLedger.expire(this.t);
          return true;
        }
      }
    }
    this.offsideLedger.expire(this.t);
    return false;
  }

  /* ==================== TARCS — THE RUCK ENTRY GATES ====================
   *
   * The referee's per-frame look at Law 15.12/15.15 entry: every team gets a
   * rectangular corridor at the breakdown — the lateral bounds of the contact
   * cluster, its front edge the hindmost foot of that team's own bound players
   * — and an uncommitted player who crosses into the contest box having never
   * stood in his own corridor since the ruck formed has entered from the side.
   *
   * THE OBSERVER, NOT THE ENGINE. This runs after the phase's physics/
   * kinematics have written every position this tick and BEFORE the formation
   * is steered, in the same slot SPEC_12's lines occupy — and like them it
   * moves nobody: no velocity is touched, no mark is rewritten. The decision
   * comes out of the pure geometry in `engine/gates.ts`; the only write here
   * is the whistle, which goes through `beginPenalty` like every penalty in
   * the game — so side entry inherits the advantage sequencing (a 10-second
   * window for the non-offending side, wind-back at the mark if it comes to
   * nothing) and the sanction ledger, exactly once, from one place.
   *
   * THE OFF SWITCH. `options.offside === 2` (the referee-OFF mode) makes this
   * observe and count and never blow — the OFF-changes-no-counts contract of
   * SPEC_12 extends to the gates for free: the entry ledger fills either way.
   */
  private static ruckGateSerial = 0;

  enforceRuckEntryGates(): boolean {
    const bd = this.bd;
    const live = this.phase === 'BREAKDOWN' && !!bd && ruckGateWindow(bd!);
    this.ruckGeoThisFrame = null;
    if (!live || !bd) {
      if (this.ruckGateLedger.active()) this.ruckGateLedger.end();
      this.ruckGateBd = null;
      return false;
    }
    /* a new ruck instance — a new gate, drawn from new feet. The roster is
     * fixed at the tackle (mid-ruck commits move `commitA`, never the set),
     * so it is built once per ruck and cached on the instance. */
    if (this.ruckGateBd !== bd) {
      this.ruckGateBd = bd;
      this.ruckGateRosterCache = ruckGateRoster(bd);
      this.ruckGateOpenedAt = this.t;
      this.ruckGateLedger.begin(++Director.ruckGateSerial);
    }
    const cluster = ruckClusterOf(bd, this.live);
    const geo = ruckGateGeometry(cluster);
    if (!geo) { this.ruckGateLedger.end(); return false; }
    /* FORWARD PACK — the same geometry, handed to think() this frame so the
     * steering routes every free forward against the gate the referee is
     * actually judging, not a second copy of it. */
    this.ruckGeoThisFrame = geo;
    /* Exemptions — and each is the law, not mercy: the roster IS the gate,
     * the controlled scrum-half at the base may come from any side (15.12),
     * and a man on the floor cannot choose his entry vector. */
    const ctrl = this.live[this.ctrl];
    const halfback = ctrl && ctrl.team === bd.attacking && ctrl.num === 9
      ? `${ctrl.team}:${ctrl.num}` : '';
    const hit = this.ruckGateLedger.observe(geo, this.live, {
      roster: this.ruckGateRosterCache ?? EMPTY_GATE_ROSTER, halfback,
    });
    if (!hit) return false;
    const team = hit.player.team;
    this.sideEntryStats.observed[team]++;
    /* THE TEMPER. Every material entry is OBSERVED and counted; the shipped
     * referee WHISTLES at the ones the law actually punishes — a man two or
     * more metres in front of his own hindmost-foot plane, once the ruck has
     * settled and the tackle's own arrivals have landed (GATE_SETTLE_S). The
     * OFF dial keeps the observation honest and drops the whistle, exactly as
     * SPEC_12 does for the lines. */
    const temper: typeof RUCK_GATE_PROFILE = (this.options.offside ?? 1) === 2
      ? { blowPenetrationM: RUCK_GATE_PROFILE.blowPenetrationM, blows: false }
      : (this.options.offside ?? 1) === 0 ? GATE_STRICTNESS.STRICT : RUCK_GATE_PROFILE;
    const settled = this.t - this.ruckGateOpenedAt > GATE_SETTLE_S;
    if (!gateBlows(temper, hit.penetration, settled)) return false;
    this.ruckGateLedger.markPenalised(team);
    /* An entrant through the front door is in OFFSIDE GROUND at the ruck —
     * the box score books him with the offside family — and the side-entry
     * call itself is a penalty. */
    this.teams[team].stats.offsides++;
    this.sideEntryStats.whistled[team]++;
    const opp: 'A' | 'B' = team === 'A' ? 'B' : 'A';
    this.beginPenalty(opp, SIDE_ENTRY_CALL, hit.player.num);
    return true;
  }

  /* ============ TACTICAL KICKING — AERIAL CONTESTS AND LAW 9.17 ============
   *
   * A high ball is a CONTEST. Two men converge on the spot it is coming
   * down at, and the one who times his leap best takes it in the air. Until
   * this existed a bomb was gathered by whoever happened to be standing
   * inside the reach radius, flat-footed, and Law 9.17 could not be broken
   * because nobody was ever in the air to be tackled.
   *
   * `tickAerialContest` owns the KINEMATICS — who jumps, when, and how high.
   * `enforceAerialProtection` owns the LAW. Neither owns the verdicts: the
   * jump trigger is `shouldContestAerial` and the offence is
   * `judgeAerialTackle`, both pure, both in engine/referee.ts, both driven
   * directly by the probe without a Director.
   */

  /** The live descending ball, if there is one worth contesting. Either a
   *  kick still in flight or a loose ball that has been put up. */
  private aerialBall(): { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null {
    const k = this.kk;
    if (k && k.stage === 'FLIGHT' && !k.profile.atGoal) {
      return { x: k.bx, y: k.by, z: k.bz, vx: k.vx, vy: k.vy, vz: k.vz };
    }
    const free = this.bc.free;
    if (free && !free.socket && !free.grounded) {
      return { x: free.x, y: free.y, z: free.z, vx: free.vx, vy: free.vy, vz: free.vz };
    }
    return null;
  }

  /** Seconds of aerial-contest activity this match — telemetry for the probe
   *  and the audit, never a gameplay input. */
  aerialContests = 0;
  aerialTackles = 0;

  /**
   * Put the converging men in the air under a descending high ball. Runs in
   * the same slot as the jump integrator (before think()), and writes only
   * the vertical channel: `x`/`z` remain the horizontal simulation's, so no
   * ownership contract is touched and a jumper still runs his own approach.
   */
  tickAerialContest(dt: number) {
    const ball = this.aerialBall();
    if (!ball) return;
    if (ball.y < AERIAL_CONTEST_MIN_BALL_Y || ball.vy >= 0) return;
    /* The mark: where the ball will be at a jumper's catching height, not
     * where it is now. A man who runs at where a bomb IS arrives late. */
    const mark = aerialLandingMark(ball, AERIAL_STANDING_REACH_M);
    for (const p of this.live) {
      if (p.sinbin > 0 || p.down || p.bound || (p.recoverT ?? 0) > 0) continue;
      if (p.latchedBy || p.latchingOnto) continue;
      const distanceToMark = Math.hypot(p.x - mark.x, p.z - mark.z);
      if (!shouldContestAerial({
        ballY: ball.y,
        ballVY: ball.vy,
        distanceToMark,
        eta: mark.eta,
        airborne: isAirborne(p.jumpY),
        eligible: (p.diveT ?? 0) <= 0 && canPlayBall(this, p),
      })) continue;
      /* UP HE GOES. The leap is the referee module's impulse so a contest
       * and the law that protects it are calibrated against the same number,
       * and `tickJump` already owns the integration and the landing. */
      p.jumpY = 0.001;
      p.jumpVY = AERIAL_JUMP_IMPULSE;
      p.clip = 'jump';
      p.clipT = 0;
      p.job = 'CONTEST IT IN THE AIR';
      this.aerialContests++;
    }
    void dt;
  }

  /**
   * LAW 9.17 — the whistle for a challenge on a man in the air.
   *
   * Returns true when it blew, so the frame can return exactly the way the
   * offside and ruck-gate enforcers do. The sanction is not negotiable and
   * is never played on: `beginPenalty` sees the AERIAL_TACKLE call, reads it
   * as foul play (engine/laws.ts), refuses the advantage window under Law
   * 7.4, and shows the yellow — ten minutes, `sinbin = 600`, off the field.
   */
  enforceAerialProtection(): boolean {
    /* The referee-OFF dial silences this exactly as it silences the lines
     * and the gates: the contest still happens, the whistle does not. */
    if ((this.options.offside ?? 1) === 2) return false;
    const challenge = findAerialChallenge(this.live);
    if (!challenge) return false;
    if (judgeAerialTackle({
      victimAirborne: isAirborne(challenge.victim.jumpY),
      offenderAirborne: isAirborne(challenge.offender.jumpY),
      contact: true,
      opponents: challenge.offender.team !== challenge.victim.team,
    }) !== 'PENALTY_YELLOW') return false;
    const offender = challenge.offender;
    const victim = challenge.victim;
    this.aerialTackles++;
    this.teams[offender.team].stats.penaltiesConceded++;
    this.say(`DANGEROUS — ${offender.num} TOOK HIM OUT IN THE AIR`);
    /* The man who was taken out comes back to earth on the spot rather than
     * completing a jump he is no longer making; the whistle's releaseAll
     * (inside beginPenalty) clears the rest of the world. */
    victim.jumpY = 0; victim.jumpVY = 0;
    offender.diveT = 0;
    /* The penalty is the VICTIM'S side, against the offender's shirt — the
     * card falls out of the call text in engine/laws.ts. */
    this.beginPenalty(victim.team, REFEREE_CALLS.AERIAL_TACKLE, offender.num);
    return true;
  }

  /* ==================== TARCS — THE ADVANTAGE SEQUENCER ====================
   *
   * The Director half of `engine/referee.ts`'s sequencing: the sensor view the
   * pure step function reads, the freeze-and-restart the wind-back performs,
   * and the one place a knock-on's advantage is opened.
   */

  /** A one-frame readout for `stepAdvantageWatch`: who has the ball, how far
   *  the carrier has marched, and the ground the beneficiary's last kick
   *  gained. Nothing else is load-bearing — the watch keeps its own mark. */
  advantageSensor(): AdvantageSensor {
    const carrier = this.op
      ? { z: this.op.carrierZ, dir: this.op.dir }
      : null;
    let kick: { gained: number } | null = null;
    const k = this.kk;
    if (k && (k.stage === 'FLIGHT' || k.stage === 'RESULT')) {
      /* A kick is "effective" when it puts the beneficiary's side in the
       * territory the infringement alone did not: measure the flight along
       * the kicker's own attacking axis, from strike point to landing. */
      kick = { gained: (k.landZ - k.bz) * k.dir };
    }
    return { possession: this.possession, carrier, kick };
  }

  /**
   * No advantage was gained (or the ball was given back): THE WHISTLE, THE
   * FREEZE, THE RESTART AT THE MARK. A penalty advantage winds back to the
   * penalty itself — `resolvePenalty` runs the choice machine at the mark,
   * and the mark is the one captured at the infringement (T-18), never the
   * spot play happened to die at. A restart advantage — the knock-on — winds
   * back to a scrum at the place the ball went forward.
   */
  windBackAdvantage() {
    const w = this.advWatch;
    this.advWatch = null;
    this.advantage = 0;
    this.pendingWindback = false;
    if (!w || w.award === 'PENALTY') { this.resolvePenalty(); return; }
    /* The scrum award: tear the phase down to a freeze the same way every
     * other whistle does (the T-18 freeze contract), THEN restart at the
     * mark. The call is spoken now, not at the infringement — the point of
     * playing the advantage was that no penalty is conceded until the referee
     * comes back. */
    const opp: 'A' | 'B' = w.team === 'A' ? 'B' : 'A';
    this.releaseAll();
    this.kk = undefined;
    this.lawCall('KNOCK_ON', REFEREE_CALLS.KNOCK_ON, opp);
    this.refSay('ADVANTAGE OVER — SCRUM TO ' + this.teams[w.team].nation.short.toUpperCase(), 'LAW_CALL', 3.0);
    this.startScrum(w.team, w.markX, w.markZ);
  }

  /**
   * A hand-contact event where the ball went FORWARD off the hands (the test
   * itself is `engine/throwforward.ts` — see the knock-on vector). A forward
   * loss of possession is the restart family, not the penalty family: the
   * referee raises the arms, play runs while the NON-offending side tries to
   * gather and march, and if that does not come off inside the window the
   * whistle brings a scrum back to the spot of the knock. Returns true when
   * the referee has taken the event (advantage opened or scrum awarded) —
   * `false` means OFF-mode grading only: the spill is a loose ball and the
   * laws stay out of the bounce.
   */
  openKnockOnAdvantage(offender: 'A' | 'B', x: number, z: number): boolean {
    if ((this.options.fwdPass ?? 1) === 2) return false;      // referee OFF: measure, never blow
    if (this.advWatch || this.over) return true;              // one advantage at a time
    const opp: 'A' | 'B' = offender === 'A' ? 'B' : 'A';
    const windowS = advantageWindowEngineS(this.options.advantage);
    if (windowS <= 0) {
      this.releaseAll();
      this.kk = undefined;
      this.lawCall('KNOCK_ON', REFEREE_CALLS.KNOCK_ON, offender);
      this.startScrum(opp, x, z);
      return true;
    }
    this.advantage = windowS;
    this.advantageTeam = opp;
    this.advWatch = openAdvantageWatch({
      team: opp, award: 'SCRUM', markX: x, markZ: z,
      originZ: z, startsOwned: this.possession === opp, window: windowS,
    });
    this.refSignal = 1.8;
    this.refSignalText = 'ADVANTAGE — KNOCK ON';
    this.say('KNOCKED FORWARD — ADVANTAGE, PLAY ON');
    this.showHint('ADVANTAGE — THE DEFENCE MAY KEEP THE BALL', 2.2);
    return true;
  }

  /** Eligible to be sampled against the RUCK line: unbound, not chasing. */
  private ruckEligibleDefenders(s: BreakdownState, defending: 'A' | 'B') {
    const bound = new Set(s.players.filter((q) => q.team === defending).map((q) => q.num));
    return this.live.filter((p) => p.team === defending && !bound.has(p.num) && this.isFormationEligible(p));
  }

  /** Eligible to be sampled against the RESET line. */
  private resetEligibleDefenders(defending: 'A' | 'B') {
    return this.live.filter((p) => p.team === defending && this.isFormationEligible(p));
  }

  /**
   * Who the formation SAMPLE is taken over. Distinct from `offsideCandidates`,
   * and deliberately so.
   *
   * The offside question — "is he offside?" — is asked of the men who can be:
   * bound men and the men forming the line are the line, so they are not asked.
   * The formation question — "is he on his mark?" — was asked, before SPEC_12,
   * of every eligible man in the team, bound or not, in the ruck roster or not.
   * That population is what SPEC_11's 2.3 m P90 is a property of, and a P90 is
   * a percentile OF a population: drop the bound men, who contribute a great
   * many small converging samples, and the same football produces a higher
   * number without anybody moving differently.
   *
   * So the law gets the narrow set and the measurement keeps the old one.
   */
  private formationSampleSet(_line: OffsideLine, team: 'A' | 'B'): Live[] {
    return this.live.filter((p) => p.team === team && this.isFormationEligible(p));
  }

  /**
   * The identity of the formation a sample belongs to. A RUCK sample belongs to
   * one breakdown, a RESET sample to one release beat; anything else is
   * continuous and gets serial 0.
   */
  private sampleKeyFor(kind: string): string {
    const obj: object | null | undefined = kind === 'RUCK' ? this.bd
      : kind === 'RESET' ? this.releaseBeat : null;
    let serial = 0;
    if (obj) {
      if (this.formationInstance.get(kind) !== obj) {
        this.formationInstance.set(kind, obj);
        serial = (this.formationSerial.get(kind) ?? 0) + 1;
        this.formationSerial.set(kind, serial);
      } else {
        serial = this.formationSerial.get(kind) ?? 0;
      }
    }
    return `${kind}:${this.possession}#${serial}`;
  }

  /** Called by the ledger when a tracked man gets back onside. Never fabricated. */
  noteOffsideRecovery(team: 'A' | 'B', seconds: number) {
    this.formationCounts.recoveryEpisodes[team]++;
    this.formationRecoverySamples[team].push(seconds);
  }

  private samplePendingTargetSlots() {
    const pending = this.pendingTargetSlotSample;
    this.pendingTargetSlotSample = null;
    if (!pending) return;
    /* Validated against the same formation identity it was requested with: a
     * ruck that re-formed between the request and the read is a different
     * formation, and the sample belongs to the old one, so it is dropped —
     * exactly as it was before SPEC_12 touched this code. */
    if (pending.token !== this.sampleKeyFor(pending.kind)) return;
    if (pending.kind === 'RUCK') {
      const s = this.bd;
      if (!s || !s.ruckFormed) return;
      for (const p of this.ruckEligibleDefenders(s, pending.defending)) this.observeTargetSlot(p);
      return;
    }
    const rb = this.releaseBeat;
    if (!rb || this.t >= rb.until) return;
    for (const p of this.resetEligibleDefenders(pending.defending)) {
      /* `upOpen` owns the retreat frame; its target is intentionally stale until
       * it returns the player to the line, so it is explicitly excluded here. */
      if (p.job.toUpperCase() === 'RELEASE AND RETREAT') continue;
      this.observeTargetSlot(p);
    }
  }

  private lastWatchPhase: Phase | null = null;
  private lastPhaseToken: unknown = null;
  watchdogTrips = 0;
  watchdogLog: string[] = [];
  /** The residue ledger of the most recent hardened teardown funnel call
   *  (releaseAll's whistle, or a maul exit through teardownMaul). The
   *  headless probes assert the zero-leak contract on it; zero is the
   *  guarantee every stoppage must keep. */
  lastTeardownResidual: import('./engine/breakdown').BreakdownTeardownResidual | null = null;

  /* ======================== SPEC_07 TRY LOCK (T-67 backstop) ========================
   *
   * scoreTry() is reachable from five engine sites in the same physics frame
   * (open.ts x4, setpieces.ts x1). If two of them fire for one grounding —
   * overlapping frame checks, or a watchdog reset landing inside the try
   * fanfare — the old code incremented the score twice. The lock engages the
   * frame a try is awarded and rejects every further trigger from the same
   * play sequence. It clears ONLY on a play reset: the restart/drop-out
   * kickoff being struck (startKick) or the watchdog tearing a stuck match
   * down (trip). Every blocked trigger is counted here and surfaced in the
   * pause panel — a silent guard-block is an unexplained score, which is
   * worse than the bug it fixed.
   */
  tryLock: { at: number; team: 'A' | 'B'; num: number } | null = null;
  tryGuardBlocks = 0;
  tryGuardLog: string[] = [];

  /* SPEC_07 — the locked-in touchdown coordinate (x_try, z_try) of the last
   * try, captured the millisecond the award lands, before the teardown
   * touches a single entity. The conversion tee is placed on the line
   * through this spot, and the probe asserts the capture is exact. */
  trySpot: { x: number; z: number; team: 'A' | 'B' } | null = null;

  private noteTryGuardBlock() {
    this.tryGuardBlocks++;
    const line = `${this.clockText} — BLOCKED duplicate TRY trigger (${this.teams[this.tryLock!.team].nation.short} #${this.tryLock!.num})` +
      ` — lock held since ${this.tryLock!.at.toFixed(1)}s, score stays ${this.teams.A.score}-${this.teams.B.score}`;
    this.tryGuardLog.push(line);
    if (this.tryGuardLog.length > 40) this.tryGuardLog.shift();
  }

  /** A grounding trigger whose raw spot sat outside the in-goal band (beyond
   * the reach tolerance or past touch-in-goal): the spot is corrected onto
   * the lawful bounds and the correction is surfaced in the same
   * pause-panel log as the guard blocks — a silent coordinate clamp is an
   * unexplained conversion line, which is worse than the note. */
  private noteTryGroundingClamp(rawX: number, rawZ: number, x: number, z: number) {
    const line = `${this.clockText} — TRY spot corrected from (${rawX.toFixed(1)}, ${rawZ.toFixed(1)}) onto the in-goal bounds (${x.toFixed(1)}, ${z.toFixed(1)})`;
    this.tryGuardLog.push(line);
    if (this.tryGuardLog.length > 40) this.tryGuardLog.shift();
  }

  /* ======================== SPEC_02 GATE SINK ========================
   *
   * Gate functions remain pure and return data. Director is the only place
   * permitted to turn a failed measurement into a visible, stop-the-match
   * developer error. The label and scalar snapshot survive in the thrown text
   * so a headless harness reports the precise writer instead of tuning past it.
   */
  private readonly reportForwardAttackGate: ForwardAttackGateReporter = (failure: ForwardAttackGateFailure): void => {
    if (!import.meta.env?.DEV) return;
    const message = `[SPEC_02 gate] ${failure.label} :: ${failure.reason} :: ${JSON.stringify(failure.values)}`;
    console.error(message);
    throw new Error(message);
  };

  private forwardAttackGates(): ForwardAttackGateReporter | undefined {
    return import.meta.env?.DEV ? this.reportForwardAttackGate : undefined;
  }

  /** Engine modules use this to route their pure SPEC_02 gate results here. */
  forwardAttackGateReporter(): ForwardAttackGateReporter | undefined {
    return this.forwardAttackGates();
  }

  /** Snapshot immediately before one labelled direct write in `think()`. */
  private writeThinkPlayer(
    gate: ForwardAttackGateReporter | undefined,
    label: string,
    player: Live,
    allowedFields: readonly ForwardAttackPlayerField[],
    write: () => void,
  ): void {
    if (!gate) { write(); return; }
    const before = snapshotForwardAttackPlayer(player);
    write();
    for (const failure of forwardAttackPlayerWriteFailures(
      label, before, snapshotForwardAttackPlayer(player), allowedFields,
    )) gate(failure);
  }

  private checkForwardAttackState(
    gate: ForwardAttackGateReporter | undefined,
    label: string,
    before: Readonly<Record<string, ForwardAttackGateValue>>,
    after: Readonly<Record<string, ForwardAttackGateValue>>,
    allowedFields: readonly string[],
  ): void {
    if (!gate) return;
    for (const failure of forwardAttackStateWriteFailures(label, before, after, allowedFields)) gate(failure);
  }

  /** Compute first, validate second, then let a labelled think write consume it. */
  private planCpuForwardAttack(
    gate: ForwardAttackGateReporter | undefined,
    label: string,
    input: Parameters<typeof forwardAttackDepth>[0],
  ) {
    const plan = forwardAttackDepth(input);
    if (gate) for (const failure of forwardAttackDepthPlanFailures(label, input, plan)) gate(failure);
    return plan;
  }

  /** Hard ceilings, in real seconds, for how long any phase may last. */
  private static readonly PHASE_LIMIT: Record<string, number> = {
    /* KICK is 15, not 12: a restart legitimately includes a formation
     * walk-on (T-16/NO-TELEPORT — nobody is teleported into place) plus a
     * hang and bounces to the 6.5 s dead cap. A genuine hang is still
     * caught — 15 s is far past any legal kick. */
    SCRUM: 14, LINEOUT: 12, BREAKDOWN: 9, MAUL: 18, KICK: 15, OPEN_PLAY: 45,
    REPLAY: 6, LINEOUT_REPLAY: 6, KICK_REPLAY: 6, MAUL_REPLAY: 6, BREAKDOWN_REPLAY: 6,
  };

  private watchdog(dt: number) {
    if (this.phase !== this.lastWatchPhase) {
      this.lastWatchPhase = this.phase;
      this.phaseAge = 0;
      return;
    }
    /* T-18. Two set pieces of the same name in a row — a kick that goes dead
     * and is dropped out, then lands dead again — are DIFFERENT phases. The
     * name-only test above chained their ages together until an honest
     * drop-out sequence tripped the limit. A new state object means a new
     * phase, whatever it is called. */
    const token = this.kk ?? this.scrim ?? this.lo ?? this.bd ?? this.ml ?? this.op;
    if (token !== this.lastPhaseToken) {
      this.lastPhaseToken = token;
      this.phaseAge = 0;
      return;
    }
    this.phaseAge += dt;

    // A. The phase has outlived any legal duration.
    const limit = Director.PHASE_LIMIT[this.phase] ?? 30;
    const looseLive = this.phase === 'OPEN_PLAY' && !!this.bc.free;
    // No law awards a loose ball after a time limit. In particular, a human
    // who has not run to it yet must not be given it by the recovery watchdog.
    if (this.phaseAge > limit && !looseLive) {
      this.trip(`${this.phase} ran for ${this.phaseAge.toFixed(1)}s (limit ${limit}s)`);
      return;
    }

    // B. The phase object the handler needs has vanished underneath it.
    const orphan =
      /* ('REPLAY' is the human instant replay — a frozen frame owned by
       * replayTimer at the top of update(); it never reaches the watchdog.) */
      ((this.phase === 'SCRUM') && !this.scrim) ||
      ((this.phase === 'LINEOUT' || this.phase === 'LINEOUT_REPLAY') && !this.lo) ||
      ((this.phase === 'BREAKDOWN' || this.phase === 'BREAKDOWN_REPLAY') && !this.bd) ||
      ((this.phase === 'MAUL' || this.phase === 'MAUL_REPLAY') && !this.ml) ||
      ((this.phase === 'KICK' || this.phase === 'KICK_REPLAY') && !this.kk) ||
      (this.phase === 'OPEN_PLAY' && !this.op);
    if (orphan) { this.trip(`${this.phase} had no state object`); return; }

    // C. A HELD ball needs an upright carrier. A free ball/pass has no owner;
    // its former handler can be on the ground without resetting the match.
    if (this.op && !this.bc.free && !this.op.ball.live) {
      const car = this.live.find((p) => p.team === this.op!.attacking && p.num === this.op!.carrierNum);
      if (!car) { this.trip('the ball carrier does not exist'); return; }
      if (car.down || car.bound) { this.trip(`carrier ${car.num} was left grounded or bound`); return; }
      if (!Number.isFinite(car.x) || !Number.isFinite(car.z)) { this.trip('the carrier position went non-finite'); return; }
      if (Math.abs(car.x) > 40 || Math.abs(car.z) > 70) { this.trip('the carrier left the stadium'); return; }
    }

    // D. Nobody has moved for two full seconds while the ball is live.
    if (this.phase === 'OPEN_PLAY' && !looseLive) {
      const movers = this.live.filter((p) => Math.hypot(p.vx, p.vz) > 0.6).length;
      if (movers < 3) { this.stillFor += dt; } else this.stillFor = 0;
      if (this.stillFor > 2) { this.trip('play stopped moving with the ball live'); return; }
    } else this.stillFor = 0;
  }

  private stillFor = 0;

  private trip(why: string) {
    this.watchdogTrips++;
    this.watchdogLog.push(`${this.clockText} — ${why}`);
    if (this.watchdogLog.length > 40) this.watchdogLog.shift();
    this.say(`PLAY RESET — ${why}`);
    this.phaseAge = 0;
    this.stillFor = 0;
    /* SPEC_07: the watchdog reset is a play reset too — the try lock clears
     * so a legitimately re-played try after the reset can score. T-67's
     * structural suspect was exactly a trip near the goal line followed by
     * an instant second score: if that fires again, the pause panel now
     * shows the trip AND whether the guard was armed for it. */
    this.tryLock = null;
    const f = this.focusPoint();
    this.releaseAll();
    this.kk = undefined;
    this.op = undefined;
    this.pendingPenalty = null;
    this.advantage = 0;
    this.advWatch = null;
    this.pendingWindback = false;
    // Restart cleanly in open play with whoever should have the ball.
    const team = this.possession;
    const dir = team === 'A' ? 1 : -1;
    this.startOpen(
      team,
      clamp(Number.isFinite(f.x) ? f.x : 0, -30, 30),
      clamp(Number.isFinite(f.z) ? f.z : 0, -44, 44) - dir * 2,
      9, 1,
    );
  }

  /* A kick call is judged on TERRITORY, not carry metres: a perfect 40 m
   * punt to touch gains zero carry metres, so judging every kick call by
   * `gained` marked them all failed and the escalation ladder abolished the
   * kicking game after one punt (kicks collapsed to ~7 a match while every
   * other stat read LOW). */
  private judgeLastCall(gained: number) {
    const kickCalls: PlayCall[] = ['TERRITORY_PUNT', 'BOMB', 'BOX_KICK', 'CROSS_FIELD'];
    if (kickCalls.includes(this.lastCall ?? 'POD_CARRY') && this.lastCallZ !== null) {
      const f = this.focusPoint();
      const dir = this.possession === 'A' ? 1 : -1;
      this.lastCallSucceeded = gained > 1.2 || (f.z - this.lastCallZ) * dir > 8;
      return;
    }
    /* A WIDTH play is judged like a kick is judged on territory: by what it
     * was FOR. A sweep's purpose is to make the defence travel — its gain
     * is lateral, and judging it on forward metres alone marked every
     * successful sweep "shut down", which escalated the ladder straight to
     * the cross-field kick. Measured on the merged tree: 45% of all CPU
     * calls were kicks and open phases averaged 0.9 s — the contact game
     * was being talked out of existence. Success = forward OR the ball
     * genuinely moved the contest. */
    const widthCalls: PlayCall[] = ['WIDE_SWEEP', 'MISS_PASS', 'LOOPL_PASS', 'SWITCH'];
    if (widthCalls.includes(this.lastCall ?? 'POD_CARRY') && this.lastCallZ !== null) {
      const f = this.focusPoint();
      const dir = this.possession === 'A' ? 1 : -1;
      const travel = Math.hypot((f.z - this.lastCallZ) * dir, (f.x - this.lastCallX) * 0.6);
      this.lastCallSucceeded = gained > 1.2 || travel > 8;
      return;
    }
    this.lastCallSucceeded = gained > 1.2;
  }
  private lastCallZ: number | null = null;
  private lastCallX = 0;

  /**
   * Set-piece participants are placed exactly, and given the correct clip for
   * the stage. Everything else is free; these men are part of a structure.
   */
  private placeBound(dt: number) {
    const clip = (p: Live, name: string) => {
      if (p.clip !== name) { p.clip = name; p.clipT = 0; }
      p.clipT += dt;
    };

    if (this.scrim && (this.phase === 'SCRUM' || this.phase === 'REPLAY')) {
      const s = this.scrim;
      const ax = this.scrumAnchor;
      const set = ['CROUCH', 'BIND', 'SET', 'ENGAGE', 'STEADY', 'FEED', 'STRIKE', 'DRIVE', 'BASE', 'OUT'].includes(s.stage);
      const yawR = (s.yaw * Math.PI) / 180;
      const cosY = Math.cos(yawR), sinY = Math.sin(yawR);
      /* FORWARD PACK — the front row's low centre-of-mass stabilisation is
       * measured here from the bound offsets and priced into the collapse
       * risk by upScrum (`s.frontRowStability`). */
      const frontRowOffsets: number[] = [];
      /* T-16/NO-TELEPORT. The packs used to be pinned to their slots from the
       * first SCRUM frame — sixteen men arriving instantly from wherever the
       * last phase left them, up to 80 m away in one frame. The ASSEMBLE stage
       * was written to measure them jogging in ("no teleport, no load") but
       * nothing was ever moving them. They now run on under steer() and are
       * only pinned once the stage needs a rigid pack (CROUCH on) AND they are
       * actually at their slot. */
      for (const slot of s.players) {
        const p = this.L(slot.team, slot.num);
        if (p.sinbin > 0) continue;
        const dx = slot.x - ax.x, dz = slot.z - ax.z + s.netDrive;
        const wx = ax.x + dx * cosY - dz * sinY;
        const wz = ax.z + dx * sinY + dz * cosY;
        const off = Math.hypot(wx - p.x, wz - p.z);
        /* FORWARD PACK — RIGID BINDING BY ROW. The front row is pinned
         * tightest (0.7 m): three men whose spines ARE the tunnel cannot
         * wander half a body-width and still be a scrum. The engine room
         * binds inside a metre, the eight keeps the old 1.15 m latitude at
         * the base. The settle itself stays bounded (D-2). */
        const bind = scrumBindProfile(slot.row, slot.num);
        if (!set || off > bind.bindTolerance) {
          p.tx = wx; p.tz = wz;
          p.urgency = set ? 0.85 : 1;
          p.job = 'GET TO YOUR SCRUM SLOT';
          steer(p, dt, !set);
        } else {
          /* D-2 — bounded settle; the 1.15 m threshold here made this the
           * biggest potential snap of the three set pieces. */
          if (this.settleToward(p, wx, wz, dt, 'bound')) { p.vx = 0; p.vz = 0; }
          p.stamina = clamp(p.stamina + dt * 2.6, 0, 100);   // set-piece breath
          if (slot.row === 1) frontRowOffsets.push(off);
        }
        /* PART 3 — SCRUM ORIENTATION IS THE LAW, NOT A PREFERENCE.
         * A pack binds head-on down the engagement axis, which runs ALONG
         * the pitch. This used to be written only in the settled branch, so
         * a forward still walking in kept the facing his last run left him
         * with — the sideways approach — and the whole pack read as rotated
         * ninety degrees towards the touchline. Locked for every frame of
         * the scrum, arriving or bound. */
        p.face = scrumFaceSign(slot.team);
        if (set) {
          if (s.stage === 'DRIVE' || s.stage === 'BASE' || s.stage === 'STRIKE') clip(p, 'scrumDrive');
          else if (s.stage === 'ENGAGE') clip(p, 'scrumCrouch');
          else clip(p, 'scrumBind');
          p.job = bind.job;
        }
      }
      /* the low-COM condition: the pack is in or past its crouch */
      const crouched = ['CROUCH', 'BIND', 'SET', 'ENGAGE', 'STEADY', 'FEED', 'STRIKE', 'DRIVE', 'BASE'].includes(s.stage);
      s.frontRowStability = frontRowStability(frontRowOffsets, crouched);
      for (const n of s.nine) {
        const p = this.L(n.team, 9);
        const dx = n.x - ax.x, dz = n.z - ax.z + s.netDrive;
        const wx = ax.x + dx * cosY - dz * sinY;
        const wz = ax.z + dx * sinY + dz * cosY;
        const off = Math.hypot(wx - p.x, wz - p.z);
        if (!set || off > 1.15) {
          p.tx = wx; p.tz = wz;
          p.urgency = 1;
          p.job = n.team === s.feed ? 'GET TO THE SCRUM BASE' : 'COVER THEIR NINE OFF THE BASE';
          steer(p, dt, true);
        } else {
          /* D-2 — the scrum-halves settle in their own block, separate from
           * the pack's, and kept the same 1.15 m whole-gap snap. Only exposed
           * on seed 5 under the bot-input harness. */
          if (this.settleToward(p, wx, wz, dt, 'bound')) { p.vx = 0; p.vz = 0; }
          p.stamina = clamp(p.stamina + dt * 2.6, 0, 100);   // set-piece breath
          clip(p, s.stage === 'FEED' || s.stage === 'STRIKE' ? 'ninePass' : 'nineSquat');
          p.job = n.team === s.feed ? 'FEED THE BALL IN STRAIGHT' : 'DEFEND THE CHANNEL OFF THE BASE';
        }
      }
      return;
    }

    if (this.lo && (this.phase === 'LINEOUT' || this.phase === 'LINEOUT_REPLAY')) {
      const s = this.lo;
      const contesting = s.stage === 'CONTEST' || s.stage === 'CATCH';
      /* T-16/NO-TELEPORT — same lesson as the scrum: the line walks on, it is
       * not teleported into place. Pin only once a man is actually at his
       * slot — even mid-contest a late arrival runs on. */
      for (const slot of s.players) {
        const p = this.L(slot.team, slot.num);
        if (p.sinbin > 0) continue;
        const off = Math.hypot(slot.x - p.x, slot.z - p.z);
        if (off > 0.9) {
          p.tx = slot.x; p.tz = slot.z;
          p.urgency = 1;
          p.job = 'GET TO THE LINEOUT';
          steer(p, dt, true);
          continue;
        }
        /* D-2 — bounded settle, no whole-gap snap on the last step. */
        if (this.settleToward(p, slot.x, slot.z, dt, 'bound')) { p.vx = 0; p.vz = 0; }
        p.stamina = clamp(p.stamina + dt * 2.6, 0, 100);   // set-piece breath
        if (slot.role === 'THROWER') clip(p, s.stage === 'THROW' || s.stage === 'CONTEST' ? 'lineoutThrow' : 'idle');
        else if (slot.role === 'JUMPER' && contesting) clip(p, Math.abs(slot.x - s.ball.x) < 1.6 ? 'lineoutJump' : 'lineoutStand');
        else if (slot.role === 'LIFTER' && contesting) clip(p, 'lineoutLift');
        else clip(p, 'lineoutStand');
        p.job = slot.role === 'THROWER' ? 'THROW IT IN STRAIGHT TO THE CALL'
          : slot.role === 'JUMPER' ? 'WIN THE BALL IN THE AIR'
            : slot.role === 'LIFTER' ? 'LIFT THE JUMPER AND PROTECT THE LANDING'
              : 'HOLD THE TAIL AND BE READY TO PEEL';
      }
      return;
    }

    if (this.ml && (this.phase === 'MAUL' || this.phase === 'MAUL_REPLAY')) {
      const s = this.ml;
      const yawR = (s.yaw * Math.PI) / 180;
      /* T-16/NO-TELEPORT — the maul ranks walk on like every other set piece;
       * the bind is exact only once a man is actually at his rank. */
      const settle = (p: Live, wx: number, wz: number, face: number) => {
        if (Math.hypot(wx - p.x, wz - p.z) > 0.9) {
          p.tx = wx; p.tz = wz; p.urgency = 1;
          steer(p, dt, true);
        } else {
          /* D-2 — bounded settle; see settleToward. */
          if (this.settleToward(p, wx, wz, dt, 'bound')) { p.vx = 0; p.vz = 0; }
          p.stamina = clamp(p.stamina + dt * 2.6, 0, 100);   // set-piece breath
          p.face = face;
        }
      };
      /* SPEC_03's semantic state maps only to clips already present in the
       * renderer: maulBind/maulDrive both resolve to maulPush. The difference
       * is useful engine vocabulary without inventing a wheel or peel asset. */
      const attackDriving = s.stage === 'ATTACK_CONTROL'
        || s.exit === 'WHEEL_AND_PEEL' || s.exit === 'TOUCH_LINEOUT' || s.exit === 'TRY_AWARDED';
      const attackClip = attackDriving ? 'maulDrive' : 'maulBind';
      /* SIN BIN — the ranks are shirts 1-8 MINUS anyone serving a card. A
       * binned man has his own owner (tickSinBin walks him to the touchline
       * and holds him there); steering him into a maul rank from here made
       * two writers fight over one body, and the man in the bin drifted
       * back onto the field inside the drive. */
      for (let i = 1; i <= 8; i++) {
        const rank = i % 3, col = Math.floor(i / 3);
        const lx = -1.4 + col * 1.1 + (rank - 1) * 0.5;
        const lz = -s.dir * (i * 0.72);
        const a = this.L(s.attacking, i);
        if (a.sinbin <= 0) {
        settle(a,
          s.x + lx * Math.cos(yawR) - lz * Math.sin(yawR) * 0.2,
          s.z + lz,
          s.dir >= 0 ? 1 : -1);
        const runnerLeaving = (s.exit === 'PICK_AND_GO' || s.exit === 'WHEEL_AND_PEEL') && a.num === s.exitRunner;
        clip(a, runnerLeaving ? 'carry' : attackClip);
        a.job = runnerLeaving ? 'PEEL FROM THE MAUL AND CARRY' : attackDriving
          ? 'KEEP THE LEGS GOING, STAY BOUND'
          : 'BIND TIGHT AND HOLD THE MAUL';
        }
        /* T-16 #3 — the maul's defensive side comes from the maul's own
         * `attacking` field, never from `possession`: a penalty can flip
         * possession mid-drive, after which both ranks were fed from the same
         * team. */
        const dTeam: 'A' | 'B' = s.attacking === 'A' ? 'B' : 'A';
        const d = this.L(dTeam, i);
        if (d.sinbin > 0) continue;
        const dlx = 1.4 - (i % 2) * 2.2;
        settle(d, s.x + dlx, s.z + s.dir * (1.2 + i * 0.7), -s.dir);
        clip(d, 'maulBind');
        d.job = s.contest === 'DEFENCE_CONTROL' ? 'HOLD THE MAUL UP AND WAIT FOR USE IT' : 'BIND AND RESIST THE DRIVE';
      }
      /* The nine has a fixed base behind the maul. It is marked bound by
       * think(), then placed here, so TRANSFER_TO_9 can show existing idle
       * (nineSquat) followed by passSpin (ninePass) before open play begins.
       * SPEC_03: the base is THE HINDMOST FOOT — the tail mark the channel
       * is measured from (maulTailMark), a half-stride behind the last bound
       * rank, so the extraction is taken from the lawful pick line itself. */
      const nine = this.L(s.attacking, 9);
      if (nine.sinbin > 0) return;
      const tail = maulTailMark(s.dir, s.ranks, s.x, s.z);
      const baseX = clamp(s.x + (s.x > 0 ? -1.6 : 1.6), -32, 32);
      const baseZ = clamp(tail.z - s.dir * 0.8, -58, 58);
      settle(nine, baseX, baseZ, s.dir >= 0 ? 1 : -1);
      if (s.exit === 'TRANSFER_TO_9') clip(nine, s.exitT < MAUL_TRANSFER_PASS_START ? 'nineSquat' : 'ninePass');
      else clip(nine, 'ready');
      nine.job = s.exit === 'TRANSFER_TO_9' ? 'TAKE THE BALL FROM THE MAUL AND PLAY IT' : 'HOLD THE BASE — READY FOR THE RELEASE';
      return;
    }

    if (this.bd && (this.phase === 'BREAKDOWN' || this.phase === 'BREAKDOWN_REPLAY')) {
      const s = this.bd;
      for (const q of s.players) {
        const p = this.L(q.team, q.num);
        if (p.sinbin > 0) continue;
        const sl = s.plan ? planSlotOf(s.plan, q.team, q.num) : null;
        /* T-29. The carrier and tackler are already at the contact point, so they
         * pin there. The arriving crew used to be snapped to their ruck slots too,
         * which read as players teleporting into the breakdown. They now close the
         * last metre or two over ~0.2 s, so they visibly run into the ruck.
         * NO-TELEPORT: the tackler eases too — he tackles from up to 1.1 m away
         * and his slot is offset past the carrier, so pinning him outright was a
         * 1.5 m jump. Only the tackled carrier himself is pinned exactly. */
        if (q.role === 'CARRIER') {
          /* T-02. On the tackle frame the open-play physics already owned this
           * man — cpuCarrier integrated him, then the radius test ended the
           * episode — and the slot below was recorded FROM his position. The
           * pin applies from the next frame; writing him again now would be
           * the same-frame double-move the ownership contract exists to
           * prevent. The velocity still dies: he is being brought to ground. */
          /* D-2 — bounded even for the tackled carrier. He is pinned to the
           * slot recorded at the tackle, which can be ~0.9 m from where the
           * physics left him on that frame. */
          /* PART 2 — the kinetic impact window owns the carrier and the
           * tackler for the first 0.3 s. Pinning them here would be exactly
           * the instantaneous stop the window exists to remove: they are
           * sliding forward together, and breakdown.ts has already
           * integrated them this frame (movedBy === 'bound'). */
          if (!inKineticImpact(s)) {
            if (!p.movedBy) this.settleToward(p, q.x, q.z, dt, 'bound');
            p.vx = 0; p.vz = 0;
          }
          p.stamina = clamp(p.stamina + dt * 2.6, 0, 100);   // set-piece breath
        } else if (q.role === 'TACKLER' && inKineticImpact(s)) {
          /* he is riding the carrier down — breakdown.ts moved him. */
        } else if (sl) {
          /* T-40 — THE LANE, NOT THE EASE. The man runs the curve his own
           * distance produced, baked offline from the acceleration he can hold and
           * the per-frame step the no-teleport gate allows, so arrival order is
           * the order he can actually get there in. Sampling a curve is also
           * cheaper than what it replaced: no exponential, no distance probe, no
           * velocity to bleed off. */
          const sm = sampleSlot(s.plan!, sl, s.t);
          /* The plan is data. If the table is ever corrupt, hand-edited wrong, or
           * written by a bake that a future change breaks, the failure this must
           * produce is a man left on his old mark — not a NaN walk down the pitch
           * that every downstream mark then has to clamp. */
          if (!Number.isFinite(sm.x) || !Number.isFinite(sm.z)) {
            p.movedBy = 'bound';
          } else {
          const step = Math.min(0.16, Math.hypot(sm.x - p.x, sm.z - p.z));
          const gap = Math.max(1e-4, Math.hypot(sm.x - p.x, sm.z - p.z));
          this.place(p, p.x + (sm.x - p.x) / gap * step, p.z + (sm.z - p.z) / gap * step, 'bound');
          p.movedBy = 'bound';
          /* He faces where he is going while he is going there, and once he is on
           * his mark he faces the BALL. The old line forced every man in the ruck
           * to face upfield or downfield, which is why a pile read as two rows
           * standing in line rather than eight men pulling at one point. */
          p.face = sm.running
            ? (Math.sign(sm.x - p.x) || (sm.frac > 0.5 ? (q.team === s.attacking ? 1 : -1) : (q.team === s.attacking ? 1 : -1)))
            : (Math.abs(Math.sin(sl.face)) > 0.55 ? Math.sign(Math.sin(sl.face)) : (q.team === s.attacking ? 1 : -1));
          p.urgency = sm.running ? 1 : 0.2;
          }
        } else {
          /* NO-TELEPORT: the ease is proportional to the WHOLE remaining gap,
           * so a man 20 m from his slot took a 2.5 m first step. Cap the step
           * at a sprint per frame — he runs in, he does not lurch. This branch is
           * the fallback: it still carries a breakdown with no plan (a replay, a
           * half-torn-down episode) without letting a missing table strand it. */
          const k = Math.min(1 - Math.exp(-dt * 8), 0.16 / Math.max(0.01, Math.hypot(q.x - p.x, q.z - p.z)));
          p.x += (q.x - p.x) * k;
          p.z += (q.z - p.z) * k;
          p.movedBy = 'bound';   // T-02: the ease is a writer too — own it
          if (Math.hypot(q.x - p.x, q.z - p.z) < 0.5) { p.vx *= 0.5; p.vz *= 0.5; }
          p.face = q.team === s.attacking ? 1 : -1;
        }
        /* T-40 — a man still running in is RUNNING. Every one of these roles used
         * to wear its ruck pose from the frame the tackle happened, so eight men
         * sprinted at you in the bind position and the pile read as statues: the
         * pose was right for where he would end up and wrong for where he was.
         * `sl.frac` is his lane progress, so the pose now changes when he arrives. */
        if (sl && sl.frac < 0.8 && q.role !== 'CARRIER' && q.role !== 'TACKLER') clip(p, 'run');
        /* and the moment the ball is gone he is walking away, not holding the
         * bind on a ruck that no longer exists. */
        else if (sl && sl.peelT >= 0 && q.role !== 'CARRIER') clip(p, 'walk');
        /* T-41 — a man a clearout put on the deck wears the grounded pose for his
         * get-up lock. Without this he went back to a bind pose mid-fall, which is
         * how a cleaned-out jackal ended up standing over the ball he had just been
         * knocked off. The carrier and the tackler are excluded because their fall
         * is the tackle timeline's to choreograph, not this chain's. */
        else if (p.down && q.role !== 'CARRIER' && q.role !== 'TACKLER') clip(p, 'grounded');
        else if (q.role === 'CARRIER') clip(p, 'grounded');
        else if (q.role === 'JACKAL') clip(p, 'jackal');
        else if (q.role === 'FIRST CLEARER') clip(p, 'cleanout');
        else if (q.role === 'CLEANER') clip(p, s.stage === 'PLACE' ? 'cleanout' : 'maulBind');
        /* PART 2: the tackler wears 'tackle' from the impact frame. The
         * renderer's tackle timeline (impact / grounding / roll-away) is what
         * gives the hit its beat now, so holding the old dive one-shot for
         * 0.45 s here would only delay the first stage of it. */
        else if (q.role === 'TACKLER') clip(p, 'tackle');
        else if (q.role !== 'TACKLER') clip(p, s.ruckFormed ? 'maulBind' : 'ready');
        p.job = q.role === 'CARRIER' ? 'PRESENT THE BALL BACK TO YOUR NINE'
          : q.role === 'JACKAL' ? 'GET YOUR HANDS ON THE BALL, LEGALLY'
            : q.role === 'TACKLER' ? 'ROLL AWAY AND GET BACK ON SIDE'
              : q.team === s.attacking ? 'CLEAR THE BODY OFF THE BALL' : 'COUNTER-RUCK THROUGH THE GATE';
      }

      /* T-26 — the scrum-half waits at the base. The distributor is steered to
       * the exact spot the ball will be played from the moment the ruck forms,
       * so (a) the ruck countdown reads against a real body standing over the
       * ball, and (b) when RECYCLE fires, startOpen does not have to snap him
       * there — he walked. */
      const fwdA = s.attacking === 'A' ? 1 : -1;
      const dist9 = s.stage !== 'OVER' ? ruckDistributor(this.live, s.attacking, s.contactX, s.contactZ) : null;
      if (dist9 && dist9.sinbin <= 0 && !dist9.down
        && !s.players.some((q) => q.team === s.attacking && q.num === dist9.num)) {
        /* BACKLINE — the base against the DYNAMIC hindmost line. The
         * conventional stride sits 1.4 m behind the contact, but the
         * cleanout crew's feet routinely end up BEHIND that spot, and a nine
         * waiting at the old fixed base waits in front of his own team's
         * line — the offside the pre-release whistle is written for. TWO
         * planes are in play: the contest's own hindmost BOUND foot (the
         * gate geometry, live) and the referee's declared hindmost SLOT
         * (the breakdown's own roster — the line the pre-release whistle
         * is judged against, and the deeper of the two on a committed
         * ruck). The base sits behind whichever stands further back, and
         * inside the corridor's lateral band. The base is the authoritative
         * nine mark this frame, so the probe's (a) reads it here. */
        const slotP = ruckOffsidePlanes(s)[s.attacking];
        const livePlane = this.ruckGeoThisFrame?.gates[s.attacking]?.planeZ ?? null;
        let plane: number | null = slotP ? slotP.z : null;
        if (livePlane !== null && (plane === null || (s.contactZ - livePlane) * fwdA > (s.contactZ - plane) * fwdA)) plane = livePlane;
        const baseX = clamp(nineBaseX(s.contactX, this.ruckGeoThisFrame, s.contactX > 0 ? 1 : -1, s.attacking), -32, 32);
        const baseZ = nineBaseZ(s.contactZ, plane, fwdA);
        if (dist9.num === 9) {
          this.backlineStats.nineBaseFrames[s.attacking]++;
          if (plane !== null && (baseZ - plane) * fwdA > 0.3) this.backlineStats.nineOffsideFrames[s.attacking]++;
        }
        const off = Math.hypot(baseX - dist9.x, baseZ - dist9.z);
        /* THE NINE'S TRANSIT. When the ruck forms the nine is usually in
         * front of the freshly declared line — he was the last man on the
         * ball, and the crew's declared slots sit behind him. He crosses it
         * on his way to the base: the crossing is a fraction of a second at
         * under a stride of penetration, far under the pre-release
         * standard (2.0 m sustained for 0.7 s), and a man clearly heading
         * to onside ground is the transit the referee does not blow. What
         * IS an offence — a man standing over the line — is impossible,
         * because the base itself (the only mark he ever settles on) sits
         * 0.5 m behind whichever line stands further back. */
        /* FORWARD PACK — the base is behind the hindmost foot, but the man
         * sent there (the nine, or the 8 / 2 / 7 standing in for a nine who
         * is in the pile) may be on the wrong side of it. The same gate rule
         * the free forwards obey: round the box, in through the mouth. */
        const gated = routeThroughGate(dist9.team, { x: dist9.x, z: dist9.z }, { x: baseX, z: baseZ },
          this.ruckGeoThisFrame, this.ruckGateLedger.hasPassed(dist9.team, dist9.num), 0, { x: dist9.vx, z: dist9.vz });
        if (gated.routed) {
          this.packStats.routed[dist9.team]++;
          dist9.tx = clamp(gated.mark.x, -ROUTE_FIELD_HALF_M, ROUTE_FIELD_HALF_M); dist9.tz = clamp(gated.mark.z, -59, 59); dist9.urgency = 1;
          dist9.job = 'GET TO THE BASE — THROUGH THE GATE';
          steer(dist9, dt, true);
        } else if (off > 0.45) {
          dist9.tx = baseX; dist9.tz = baseZ; dist9.urgency = 1;
          dist9.job = 'GET TO THE BASE — YOUR BALL';
          steer(dist9, dt, true);
        } else {
          /* The mark IS the base — no stale gate waypoint may linger in
           * front of the line while he waits for the ball. */
          dist9.tx = clamp(baseX, -ROUTE_FIELD_HALF_M, ROUTE_FIELD_HALF_M);
          dist9.tz = clamp(baseZ, -59, 59);
          /* D-2 — bounded; this was the last unbounded set-piece place, and it
           * showed up as shirt 9 moving 1.12 m in one frame under the gate
           * harness's bot input (a path NO_INPUT probing never exercised). */
          if (this.settleToward(dist9, baseX, baseZ, dt, 'bound')) { dist9.vx = 0; dist9.vz = 0; }
          clip(dist9, 'nineSquat');
          dist9.job = 'HANDS ON THE BALL — WAIT FOR IT TO COME';
        }
      }
      return;
    }

    if (this.kk && (this.phase === 'KICK' || this.phase === 'KICK_REPLAY')) {
      const s = this.kk;
      const k = this.L(s.kicker, s.kickerNum);
      const setting = s.stage === 'AIM' || s.stage === 'METER';
      const prepping = s.stage === 'FANFARE' || s.stage === 'WALKUP';

      /* PART 3 — SET-PIECE LAW COMPLIANCE: THE KICK AT GOAL.
       *
       * A conversion or a penalty goal is not open play with a stationary
       * ball in the middle of it. Law 8.20/8.22: the non-kicking team retires
       * to its own goal line and stays there until the kicker starts his
       * run-up; the kicking team stays behind the ball. Everything else in
       * this method — the celebration huddle, the walk-back, the open-play
       * marks — used to keep steering the other twenty-nine men through the
       * whole ritual, so they wandered.
       *
       * This override sits above every other source of position for the
       * duration. It ends the moment the ball is struck (stage FLIGHT), from
       * which point the chase logic below owns them again. */
      if (isGoalKickState(s.type) && (prepping || setting)) {
        const kickDir: 1 | -1 = s.dir > 0 ? 1 : -1;
        const defTeam: 'A' | 'B' = s.kicker === 'A' ? 'B' : 'A';
        const attackers = this.live.filter((p) => p.team === s.kicker && p !== k && p.sinbin <= 0);
        const defenders = this.live.filter((p) => p.team === defTeam && p.sinbin <= 0);
        const apply = (list: Live[], defending: boolean) => {
          /* distribute across the width in a stable order, so nobody swaps
           * lanes with a team-mate frame to frame. */
          const ordered = [...list].sort((a, b) => a.x - b.x);
          ordered.forEach((p, i) => {
            const mark = goalKickMark(i, ordered.length, defending, kickDir, s.bz);
            p.tx = clamp(mark.x, -33, 33);
            p.tz = clamp(mark.z, -59, 59);
            p.job = mark.job;
            const off = Math.hypot(p.tx - p.x, p.tz - p.z);
            if (off > 0.6) {
              /* he is still retiring: walk him back, at pace for a defender
               * who has ten metres of goal line to find. */
              p.urgency = defending ? 0.85 : 0.6;
              steer(p, dt, false);
            } else {
              /* on his mark and lawfully STILL. Velocity zero until the ball
               * is kicked — this is the clause the wandering broke. */
              if (this.settleToward(p, p.tx, p.tz, dt, 'goal-kick')) { p.vx = 0; p.vz = 0; }
              p.vx = 0; p.vz = 0;
              p.urgency = 0;
              p.face = defending ? -kickDir : kickDir;
              if (p.clip !== 'ready') { p.clip = 'ready'; p.clipT = (p.num * 0.37) % 1.4; }
            }
          });
        };
        apply(attackers, false);
        apply(defenders, true);

        /* the kicker himself keeps his existing walk-up ritual below. */
        if (s.stage === 'WALKUP' && Math.hypot(k.x - s.bx, k.z - (s.bz - s.dir * 1.1)) > 0.8) {
          k.tx = s.bx; k.tz = s.bz - s.dir * 1.1;
          k.urgency = clamp(1.15, 0, 1);
          k.job = 'WALK TO THE TEE';
          k.face = s.dir;
          steer(k, dt, false);
          clip(k, 'jog');
        } else {
          /* T-16/NO-TELEPORT. Rate-limited, NOT snapped. The walk-up branch
           * above only owns the kicker during WALKUP; in FANFARE and AIM he
           * arrives here from wherever the previous phase left him, and a hard
           * place() moved him up to 10.02 m in a single frame (measured at
           * t=43.7s, difficulty 3). settleToward caps the step at a walking
           * 2.6 m/s, so he closes the last stride instead of jumping it. */
          this.settleToward(k, s.bx, s.bz - s.dir * 1.1, dt, 'kicker');
          k.vx = 0; k.vz = 0; k.face = s.dir;
          clip(k, 'ready');
        }
        return;
      }

      if (prepping) {
        /* T-32. The kicker walks to the tee, everyone else holds and watches.
         * During FANFARE he stands; during WALKUP he closes on the ball. */
        if (s.stage === 'WALKUP' && Math.hypot(k.x - s.bx, k.z - (s.bz - s.dir * 1.1)) > 0.8) {
          k.tx = s.bx;
          k.tz = s.bz - s.dir * 1.1;
          /* Playtest P1.3: the walk read as five dead seconds. A kicker
           * jogs to the mark — the ritual is the REVERENCE, not the commute. */
          /* SPEC_02 gate audit: `urgency` is a 0..1 state contract. The old
           * 1.15 walk boost surfaced one frame later through `separate()`;
           * keep the intent's requested value, but clamp it at its write site. */
          k.urgency = clamp(1.15, 0, 1);
          k.job = 'WALK TO THE TEE';
          k.face = s.dir;
          steer(k, dt, false);
          clip(k, 'jog');
        } else {
          k.face = s.dir;
          clip(k, 'ready');
          k.vx = 0; k.vz = 0;
        }
        /* PLAYTEST 3: the try froze all thirty. The scorer's three nearest
         * mates go TO him (the huddle), everyone else walks back toward
         * their own half — a rugby pitch after a try is never a still. */
        const scorer = this.lastScorer
          ? this.live.find((q) => q.team === this.lastScorer!.team && q.num === this.lastScorer!.num)
          : null;
        let celebrations: Live[] = [];
        if (scorer && s.stage === 'FANFARE') {
          celebrations = this.live
            .filter((q) => q !== scorer && q.team === scorer.team && q.sinbin <= 0 && !q.down)
            .sort((a, b) => Math.hypot(a.x - scorer.x, a.z - scorer.z) - Math.hypot(b.x - scorer.x, b.z - scorer.z))
            .slice(0, 3);
        }
        for (const p of this.live) {
          if (p === k || p.sinbin > 0) continue;
          /* T-31 + P1.3. The man who just dived stays DOWN through the
           * fanfare and the walk-up (steer() would stand him mid-slide);
           * upKick stands him up when the kicker reaches the tee. */
          if (p.clip === 'dive' || (p.clip === 'grounded' && !p.down)) {
            p.clipT += dt; p.vx = 0; p.vz = 0; continue;
          }
          if (celebrations.includes(p) && scorer) {
            p.tx = clamp(scorer.x + (p.x - scorer.x) * 0.2, -33, 33);
            p.tz = clamp(scorer.z + (p.z - scorer.z) * 0.2, -59, 59);
            p.urgency = 0.55;
            p.job = 'IN TO CELEBRATE WITH HIM';
            steer(p, dt, false);
            continue;
          }
          if (s.stage === 'FANFARE' && scorer && p.team !== scorer.team) {
            p.tx = p.x; p.tz = clamp(p.z - p.face * 5, -59, 59);
            p.urgency = 0.3;
            p.job = 'BACK DOWNFIELD — THE KICK IS COMING';
            steer(p, dt, false);
            continue;
          }
          p.tx = p.x; p.tz = p.z;
          p.urgency = 0.15;
          p.job = 'WAIT FOR THE CONVERSION';
          steer(p, dt, false);
        }
        return;
      }

      if (setting) {
        /* T-16/NO-TELEPORT. Before the strike the kicker walks to his mark and
         * (at a restart) the thirty walk to their formation slots. They used to
         * be snapped to those places in one frame; the CPU now also waits for
         * the formation before striking, so Law 12's ten metres is real. */
        const kx = s.bx, kz = s.bz - s.dir * 1.1;
        if (Math.hypot(k.x - kx, k.z - kz) > 0.5) {
          k.tx = kx; k.tz = kz; k.urgency = 0.8;
          k.job = 'GET TO THE BALL';
          steer(k, dt, false);
        } else {
          /* Same contract as the goal-kick ritual above: the 0.5 m guard means
           * this branch is a settle onto the mark, so it must be rate-limited
           * rather than a snap. */
          this.settleToward(k, kx, kz, dt, 'kicker');
          k.vx = 0; k.vz = 0; k.face = s.dir;
          clip(k, 'ready');
        }
        if (s.form && (s.type === 'RESTART' || s.type === 'DROP_OUT')) {
          let arrived = 0, count = 0;
          for (const f of s.form) {
            const p = this.L(f.team, f.num);
            if (p.sinbin > 0 || p === k) continue;
            count++;
            const off = Math.hypot(f.x - p.x, f.z - p.z);
            if (off > 0.8) {
              p.tx = f.x; p.tz = f.z; p.urgency = 1;
              p.face = s.dir;
              steer(p, dt, true);
            } else {
              /* D-2 — the last unbounded settle. Its 0.8 m threshold snapped
               * the whole gap and landed at 0.7994 m, six TENTHS OF A
               * MILLIMETRE under the new gate: passing, but balanced on the
               * edge and certain to flake on any seed change. Bounded like the
               * rest rather than left to luck. */
              if (this.settleToward(p, f.x, f.z, dt, 'restart')) { p.vx = 0; p.vz = 0; }
              p.stamina = clamp(p.stamina + dt * 2.6, 0, 100);   // set-piece breath
              p.face = p.team === s.kicker ? s.dir : -s.dir;
              /* SPEC_09 — THE WARM-UP BEAT. A pinned man is SET, not a
               * statue: he takes the ready stance and breathes on his own
               * phase. Presentation ONLY — the writables are clip/clipT/face;
               * x, z, vx, vz, tx, tz and movedBy stay absolutely immutable
               * while pinned (the pin writes above are the same values this
               * branch has owned since he arrived). The clipT stagger per
               * shirt is what reads as "alive but held": thirty men
               * breathing in sync is a chorus line, not a kick-off line. */
              if (p.clip !== 'ready') {
                p.clip = 'ready';
                p.clipT = (p.num * 0.37) % 1.4;
              }
              arrived++;
            }
          }
          s.formReady = count ? arrived / count : 1;
          return;
        }
        /* BACKLINE — THE PENDULUM. An open-play kick from the 9's or the 10's
         * hands is a coverage problem for the RECEIVING side's back three:
         * the three of them rotate to OWN the deep thirds of the defended
         * field — left, centre, right — and hold them as the kicker aims,
         * so a punt anywhere into the covered zone meets a man who was
         * already running at it. The triangle slides with the ball's lateral
         * position every frame; the 10 drops as the second sweeper between
         * the line and the triangle. The geometry is the pure
         * `pendulumMark` in behaviour/backline-echelon; the kick phase owns
         * this choreography because think() has already stood down for the
         * KICK phase. A restart or drop-out is a FORMATION, not a coverage
         * problem — the form walk above owns it and returns. */
        const pose = s.type !== 'RESTART' && s.type !== 'DROP_OUT'
          && (s.kickerNum === 9 || s.kickerNum === 10);
        const defTeam: 'A' | 'B' = s.kicker === 'A' ? 'B' : 'A';
        const ownEdge = defTeam === 'A' ? FIELD.tryZ : FIELD.tryZFar;
        for (const p of this.live) {
          if (p === k || p.sinbin > 0) continue;
          if (pose && p.team === defTeam && !p.down && !p.bound
              && (p.num === 10 || p.num === 11 || p.num === 14 || p.num === 15)) {
            const m = p.num === 10
              ? { x: s.bx, z: s.bz - s.dir * 14, third: 'CENTRE' as const }
              : pendulumMark(p.num, { x: s.bx, z: s.bz }, s.dir as 1 | -1, ownEdge);
            p.tx = clamp(m.x, -33, 33);
            p.tz = clamp(m.z, -59, 59);
            p.urgency = 1;
            p.job = p.num === 10
              ? 'TEN — SECOND SWEEP, BETWEEN THE LINE AND THE TRIPLE'
              : `${p.num === 11 ? 'ELEVEN' : p.num === 14 ? 'FOURTEEN' : 'FIFTEEN'} — PENDULUM, ${m.third} THIRD`;
            this.backlineStats.pendulumFrames++;
            if (p.num !== 10) this.backlineStats.pendulumThirds[m.third]++;
            steer(p, dt, true);
            continue;
          }
          p.tx = p.x; p.tz = p.z;
          p.urgency = 0.2;
          steer(p, dt, false);
        }
        return;
      }

      // THE BALL IS AWAY. The kicker is now just another chaser — pinning him to
      // the ball made him fly across the pitch with it.
      // While it is genuinely airborne, chase the predicted landing point. Once
      // it has bounced, chase the ball itself: the prediction jumps around on
      // every bounce and it was whipping the camera all over the ground.
      /* SPEC_09 — THE THAW GATE. No pin releases until the T-69 six-chaser
       * commitment is complete. launch() writes the commitment atomically
       * with the stage flip, so this assertion should be structurally
       * unreachable; if it ever fires, the freeze HOLDS (players stay set —
       * the lesser evil by far) and the watchdog log records why. Releasing
       * a thaw without chasers is T-69 cause 1 ("they just watch it")
       * resurrected; releasing one WITH pre-set chase positions would be the
       * pre-set steal. The gate guarantees neither can happen. */
      if (s.chasers.length !== 6) {
        if (!s.thawHeld) {
          s.thawHeld = true;
          this.watchdogLog.push(`${this.clockText} — SPEC_09 thaw held: chaser commitment incomplete at the strike (${s.chasers.length}/6)`);
          if (this.watchdogLog.length > 40) this.watchdogLog.shift();
        }
        return;   // the freeze holds; upKick's FLIGHT clock and kickLanded still resolve the episode
      }
      // Flight/bounce plans are shared with ordinary loose balls. A prop can
      // field ahead of a distant fullback; the remaining players cover lanes.
      for (const p of this.live) {
        if (!eligibleToGather(p) || p.controlled || p.movedBy === 'input') continue;
        const task = this.ballBehaviour.tasks.get(`${p.team}:${p.num}`);
        if (!task) continue;
        p.tx = task.x; p.tz = task.z; p.urgency = task.urgency; p.job = task.job;
        steer(p, dt, task.sprint);
      }
      return;
    }
  }

  setZoom(z: number) { this.zoom = clamp(z, 0, 1); }

  /* ============================ THINK: targets for all thirty ============================ */

  /** Tactical focus is the live carrier or the incoming ball, not the camera's
   * historical carrier anchor. No phase/physics state is mutated by this read. */
  tacticalPoint(): { x: number; z: number } {
    const ball = readBall(this);
    return ball.kind === 'SET_PIECE' ? this.focusPoint() : ball.target;
  }

  shape( /* T-03: engine-internal */): ShapeInput {
    const atk = this.possession;
    const f = this.tacticalPoint();
    const form = FORMATION_BY_ID(this.teams[atk].backline);
    const dForm = FORMATION_BY_ID(this.teams[this.defending()].defence);
    const op = this.op;
    const open = op?.open ?? 1;
    return {
      phase: this.phaseName(),
      attack: atk,
      dir: atk === 'A' ? 1 : -1,
      ballX: f.x, ballZ: f.z,
      width: this.slider(atk, 'width') / 100,
      /* T-18. A mid-scale depth attribute (5 of 10) is NEUTRAL, not half
       * depth — the old /10 mapping halved the backline's depth, the ten
       * stood 3.5 m flat behind the ruck and every receiver was marked on
       * the catch. */
      depthBias: 0.6 + (form.depth ?? 5) * 0.08,
      lineSpeed: this.slider(this.defending(), 'lineSpeed') / 100,
      drift: dForm.params.drift ?? 0.4,
      open,
    };
  }

  private phaseName(): PhaseName {
    switch (this.phase) {
      case 'CHAOS_SCRIM': case 'OPEN_PLAY': case 'REPLAY': return 'OPEN_PLAY';
      case 'BREAKDOWN': case 'BREAKDOWN_REPLAY': return 'RUCK';
      case 'MAUL': case 'MAUL_REPLAY': return 'MAUL';
      case 'SCRUM': return 'RUCK';
      case 'LINEOUT': case 'LINEOUT_REPLAY': return 'LINEOUT';
      case 'KICK': case 'KICK_REPLAY':
        return this.kickerTeam() === this.possession ? 'KICK_CHASE' : 'KICK_RECEIVE';
    }
  }

  private kickerTeam(): 'A' | 'B' { return this.kk?.kicker ?? this.possession; }

  /**
   * Focus for the CAMERA alone. focusPoint() deliberately stays on the carrier while a
   * pass is in the air, because the formation anchor is measured from it; the camera has
   * no such obligation, and a pass that flies to a lead-projected aim travels far enough
   * to leave a carrier-anchored frame. While the ball is live, the subject BLENDS from
   * the carrier to the ball with the separation: a short pop pass keeps the carrier in
   * frame, a thirty-metre bomb hands the frame to the ball. Kicks in flight (no open
   * episode) track the ball against the landing mark the same way.
   */
  cameraFocus(): { x: number; z: number } {
    if (this.chaos) return { x: this.chaos.player.x, z: this.chaos.player.z };
    if (this.op && this.op.ball.live) {
      const s = this.op;
      return blendSubjectToBall({ x: s.carrierX, z: s.carrierZ }, { x: s.ball.x, z: s.ball.z });
    }
    if (this.kk && this.kk.stage === 'FLIGHT') {
      const k = this.kk;
      return blendSubjectToBall({ x: k.landX, z: k.landZ }, { x: k.bx, z: k.bz });
    }
    return this.focusPoint();
  }

  focusPoint(): { x: number; z: number } {
    if (this.chaos) return { x: this.chaos.player.x, z: this.chaos.player.z };
    if (this.phase === 'OPEN_PLAY' && this.bc.free) return { x: this.bc.free.x, z: this.bc.free.z };
    if (this.op) return { x: this.op.carrierX, z: this.op.carrierZ };
    if (this.bd) return { x: this.bd.contactX, z: this.bd.contactZ };
    if (this.ml) return { x: this.ml.x, z: this.ml.z };
    if (this.lo) return { x: this.lo.ball.x, z: this.lo.markZ };
    if (this.kk) return { x: this.kk.bx, z: this.kk.bz };
    if (this.scrim) return { x: this.scrumAnchor.x, z: this.scrumAnchor.z };
    return { x: 0, z: 0 };
  }

  /**
   * Assign a target to every one of the thirty, every frame. This is the loop
   * that makes "players are never in their correct position" impossible.
   */
  /** The attacking shape a side is playing, from its archetype and the slider. */
  shapeOf(t: 'A' | 'B'): AttackShape {
    const arch = this.teams[t].archetype;
    const byArch = ARCHETYPE_SHAPE[arch] ?? 'S-1331';
    return shapeById(byArch);
  }

  /** The defensive system a side is playing. */
  defenceOf(t: 'A' | 'B'): DefenceSystem {
    return defenceById(this.teams[t].defence);
  }

  /** The side about to receive a kick that is in the air. */
  receivingSide(): 'A' | 'B' {
    return this.kk ? (this.kk.kicker === 'A' ? 'B' : 'A') : this.defending();
  }

  /* ======================== SPEC_09 — THE PLAY-ACTIVE GATE ========================
   *
   * The hard "play-active" predicate from the approved thaw sequencing design
   * (SPEC_09_RESTART_THAW_SEQUENCING.md §4). It must evaluate to true before
   * ANY human input, AI target or physics interaction may influence the ball
   * during a restart ritual — the pre-set steal exploit is exactly a path
   * that granted such influence with one of these terms false:
   *   phase KICK (not a replay presentation frame — a replay grants nothing),
   *   a live restart-type episode (RESTART | DROP_OUT),
   *   stage FLIGHT (the ball is legally live: struck, airborne, in play),
   *   the T-69 six-chaser commitment initialized (atomic with the stage flip
   *   in launch(); asserted again by the thaw branch in placeBound),
   *   not paused, and no instant-replay freeze running.
   */
  restartBallLive(): boolean {
    const k = this.kk;
    return this.phase === 'KICK'
      && k != null
      && (k.type === 'RESTART' || k.type === 'DROP_OUT')
      && k.stage === 'FLIGHT'
      && k.chasers.length === 6
      && !this.paused
      && this.replayTimer <= 0;
  }

  /**
   * T-02 — the single sanctioned way for a system other than `steer()` to move a
   * player. Warns in dev when a player is moved twice in one frame by two
   * different systems, which is the root of the teleport bugs.
   *
   * The warn measures DISPLACEMENT, not authorship: a set piece handing a
   * player back at the exact coordinates he already occupies — the breakdown
   * pinning the tackled carrier where the tackle caught him — is the
   * sanctioned phase hand-off, not a double move. 0.5 m is half the tackle
   * radius; a real double-write shoves a man that far and reads on screen.
   */
  place(p: Live, x: number, z: number, who: string) {
    const ddx = x - p.x, ddz = z - p.z;
    if (import.meta.env?.DEV && p.movedBy && p.movedBy !== who && ddx * ddx + ddz * ddz > 0.25) {
      console.warn(`[T-02] shirt ${p.num} (${p.team}) moved by ${p.movedBy}, then ${who} in one frame (phase ${this.phase})`);
    }
    p.movedBy = who;
    p.x = x;
    p.z = z;
  }

  /* ==================== SPEC_11 — FORMATION ANCHORING ====================
   *
   * Three invariants, all of which the engine used to break:
   *
   *   1. A mark is an OFFSET FROM THE BALL, never a place on the pitch. The
   *      behaviour dataset is authored as an absolute formation around a ball
   *      in one fixed spot (`SITUATION_META[sit].ball`); `datasetOffset()`
   *      returns the shape relative to that anchor and it is re-anchored on
   *      the live focus point here.
   *   2. The direction of attack is applied ONCE. `defenceMark()` already
   *      returns a world-space signed offset; multiplying a difference of
   *      two world z values by `dir` again is `dir² = 1` — a mirror that
   *      cancels itself.
   *   3. A line defender's mark is in front of the ball. A mark behind the
   *      attack is the drift bug, whatever produced it.
   */

  /**
   * D11-a — the lateral budget of a formation anchored on the ball.
   *
   * The formation spreads from the ball's own lateral position, and when
   * there is not room for the full spread it SQUEEZES (one factor for the
   * whole shape, so the shape is preserved, only narrower) instead of
   * spilling over the touchline. 1 = the authored width.
   */
  private lateralScale(anchorX: number, sign: number, minOffset: number, maxOffset: number): number {
    const lo = Math.min(sign * minOffset, sign * maxOffset);
    const hi = Math.max(sign * minOffset, sign * maxOffset);
    let lam = 1;
    if (hi > 0.01) lam = Math.min(lam, (FIELD.maxX - TOUCH_MARGIN - anchorX) / hi);
    if (lo < -0.01) lam = Math.min(lam, (FIELD.minX + TOUCH_MARGIN - anchorX) / lo);
    return clamp(lam, LATERAL_SQUEEZE_FLOOR, 1);
  }

  /**
   * D11-b — turn a ball-relative along-pitch offset into a world z.
   *
   * `along` is metres along this team's attacking axis (σ): positive is
   * toward the opposition dead-ball line, negative is behind the ball. As
   * the formation backs up towards its own dead-ball line the depth is
   * compressed by a multiplier — the shape tightens instead of marching
   * out of the field — and is never allowed past the dead-ball line.
   */
  private anchorDepth(f: { x: number; z: number }, sigma: -1 | 1, along: number): number {
    const back = -along;                                  // metres behind the ball
    const room = FIELD.deadZFar + f.z * sigma - DEAD_BALL_MARGIN;
    if (back <= 0 || room <= 0) return f.z + sigma * along;
    const k = clamp(room / DEPTH_COMPRESSION_ROOM, DEPTH_COMPRESSION_FLOOR, 1);
    return f.z - sigma * Math.min(back * k, room);
  }

  /**
   * SPEC_11 invariant 3 — a line defender's mark is IN FRONT of the ball:
   * `(z − F.z) · dir ≥ 0`, where `dir` is the direction the team in
   * possession is attacking.
   *
   * A mark behind the attack is the drift bug, whatever produced it: it is
   * what sent the defensive line through the offensive line to stand behind
   * it. One metre of slack absorbs a ball moving between frames. The clamp
   * warns in dev, because a mark this wrong is an authoring error that should
   * be fixed at source, not silently absorbed.
   */
  private defensiveDepth(
    f: { x: number; z: number }, dir: number, z: number, p: Live, source: string,
  ): number {
    const penetration = (z - f.z) * dir;
    if (penetration >= -DEFENCE_LINE_SLACK) return z;
    /* SPEC_11: the dataset authors the `goal-line-def` fullback as the LAST
     * MAN, deliberately five to eight metres behind the ball. The clamp still
     * applies to him — nobody is marked out of play behind the dead-ball line,
     * which is what the clamp is for — but he is not an authoring error, so
     * he does not get to shout about it eight times a match. Every other
     * behind-the-ball mark still warns, because every other one IS a bug. */
    const authoredLastMan = p.num === 15 && source === 'goal-line-def';
    if (!authoredLastMan && import.meta.env?.DEV) {
      console.warn(`[SPEC_11] shirt ${p.num} (${p.team}) defensive mark from ${source} is `
        + `${(-penetration).toFixed(1)} m behind the ball — clamped to the line`);
    }
    return f.z - dir * DEFENCE_LINE_SLACK;
  }

  /**
   * The last word on any mark: never beyond the dead-ball line, and never
   * through the uprights (the posts stand at ±3.1 m inside the in-goal
   * area, so a deep mark is pushed out of the post corridor).
   */
  private boundMark(x: number, z: number): { x: number; z: number } {
    const mz = clamp(z, FIELD.deadZ + DEAD_BALL_MARGIN, FIELD.deadZFar - DEAD_BALL_MARGIN);
    if (Math.abs(mz) <= Math.abs(FIELD.tryZFar) || Math.abs(x) >= POST_CORRIDOR) return { x, z: mz };
    return { x: x >= 0 ? POST_CORRIDOR : -POST_CORRIDOR, z: mz };
  }

  /* ==================== FORWARD PACK — THE POSITIONAL TREES ====================
   *
   * The last formation writer for shirts 1–8 before the steer, and the ONLY
   * writer that knows the ruck gate exists. Every other mark source — the
   * dataset, the shape slot, the CPU planner, the hip roles, the channel map
   * — writes as before; this runs over the result and, when the man's tree
   * has an opinion for the live situation, replaces the mark; then, whatever
   * the mark, routes it through his team's entry gate if the straight run
   * would cross the contest box (`engine/forwardPack.ts`).
   *
   * The write goes through `writeThinkPlayer` under its own label so the
   * SPEC_02 gate audit sees one more named writer, not an anonymous poke;
   * the steer that follows is still the single integration writer (T-02).
   *
   * Returns true when the man's mark was owned by a tree node this frame —
   * telemetry only; the caller steers either way.
   */
  private applyForwardPack(
    gate: ForwardAttackGateReporter | undefined, p: Live, busy: boolean,
  ): boolean {
    if (p.carrier || p.bound || p.down) return false;
    if (this.isHuman(p.team) && p === this.ctrlPlayer) return false;
    /* the TREES are the forwards'; the GATE RULE below is everyone's — the
     * referee's ledger judges a wing arriving from the side exactly as it
     * judges a prop, so the wing is routed exactly as the prop is */
    const forward = isForwardShirt(p.num);
    const bd = this.bd;
    const inRuck = !!bd && (this.phase === 'BREAKDOWN' || this.phase === 'BREAKDOWN_REPLAY');
    const phase: PackContext['phase'] = inRuck ? 'BREAKDOWN' : this.phase === 'OPEN_PLAY' ? 'OPEN_PLAY' : 'OPEN_PLAY';
    if (!inRuck && this.phase !== 'OPEN_PLAY') return false;
    const attacking: 'A' | 'B' = inRuck ? bd!.attacking : (this.op?.attacking ?? this.possession);
    const dir: 1 | -1 = attacking === 'A' ? 1 : -1;
    const f = this.tacticalPoint();
    /* the gate geometry: the referee's own while his window is open, else
     * drawn here from the same cluster so the routing starts the frame the
     * bodies go to ground, not the frame the whistle becomes possible */
    if (inRuck && !this.ruckGeoThisFrame && this.ruckGeoDrawnAt !== this.t) {
      this.ruckGeoDrawnAt = this.t;
      this.ruckGeoThisFrame = ruckGateGeometry(ruckClusterOf(bd!, this.live));
    }
    const geo = inRuck ? this.ruckGeoThisFrame : null;
    const inRoster = inRuck && (this.ruckGateRosterCache?.has(`${p.team}:${p.num}`) ?? false);
    const loose = this.bc.free ? { x: this.bc.free.x, z: this.bc.free.z } : null;
    const op = this.op;
    const carrier = !inRuck && op && !op.ball.live && !this.bc.free ? (() => { const c = this.L(op.attacking, op.carrierNum); return { num: c.num, x: c.x, z: c.z }; })() : null;
    const toLine = Math.max(0, dir > 0 ? FIELD.tryZFar - f.z : f.z - FIELD.tryZ);
    const ctx: PackContext = {
      phase, team: p.team, attacking, dir, sigma: p.team === 'A' ? 1 : -1,
      openSide: op ? (op.open < 0 ? -1 : 1) : undefined,
      p: { x: p.x, z: p.z }, ball: f, mark: { x: p.tx, z: p.tz },
      geo, stage: inRuck ? bd!.stage : '', ruckFormed: inRuck ? bd!.ruckFormed : false,
      inRoster, loose, carrier, latched: !!op?.latch, busy, toLine,
    };
    let owned = false;
    let m: PackMark | null = forward ? evaluateForwardTree(p.num, ctx) : null;
    let mark = m ? { x: m.x, z: m.z } : { x: p.tx, z: p.tz };
    /* THE GATE RULE — over whichever mark won. A man already through, or
     * already in the corridor, or already resident in the pile is left alone;
     * the man whose next stride would breach the box from the side is sent to
     * the gate mouth first. The lateral bias spreads several men across the
     * band instead of stacking them on one point. */
    const passed = inRuck && this.ruckGateLedger.hasPassed(p.team, p.num);
    const bias = ((p.num * 37) % 5 - 2) * 0.22;
    const routed = inRuck
      ? routeThroughGate(p.team, ctx.p, mark, geo, passed, bias, { x: p.vx, z: p.vz })
      : { mark, routed: false as const, leg: 'none' as const };
    if (routed.routed) {
      this.packStats.routed[p.team]++;
      mark = routed.mark;
    }
    if (m || routed.routed) {
      owned = !!m;
      const urgency = m ? plantedUrgency(m, ctx.p) : Math.max(p.urgency, 0.95);
      const job = routed.routed
        ? `${m ? m.job : p.job} — THROUGH THE GATE`
        : m!.job;
      const node = m ? m.node : 'gate-only';
      this.packStats.nodes[node] = (this.packStats.nodes[node] ?? 0) + 1;
      if (m) this.packStats.treeMarks++;
      /* a routed waypoint may use the touchline's last metre; a tree mark
       * keeps the formation's own 33 m clamp */
      const xLim = routed.routed ? ROUTE_FIELD_HALF_M : 33;
      const bm = this.boundMark(clamp(mark.x, -xLim, xLim), mark.z);
      this.writeThinkPlayer(gate, `think:forward-pack:${p.team}${p.num}:${node}`, p,
        ['tx', 'tz', 'job', 'urgency'] as const, () => {
          p.tx = clamp(bm.x, -xLim, xLim);
          p.tz = clamp(bm.z, -59, 59);
          p.urgency = clamp(urgency, 0, 1);
          p.job = job;
        });
    }
    return owned;
  }

  /**
   * BACKLINE — the positional behaviour trees for shirts 9-15 (engine/backline).
   *
   * The mirror of `applyForwardPack`, called on the SAME frame and AFTER it:
   * the forward pack has already routed the forwards through the ruck gate,
   * and the backline is routed through the SAME gate from its own marks —
   * the referee does not care whose shirt a side entry wears. The 9 is the
   * one shirt the trees and the breakdown share: while he is the ball-player
   * (`bound`), the ruck owns him; the frame the ball leaves his hands he is
   * free again, and his tree takes him into open play.
   *
   * The tree's mark stands behind the mark the dataset, shape and echelon
   * wrote: a null node means the old pipeline owns the man, untouched.
   *
   * Returns true when a tree node owned his mark this frame.
   */
  private applyBackline(
    gate: ForwardAttackGateReporter | undefined, p: Live, busy: boolean,
  ): boolean {
    if (p.carrier || p.bound || p.down) return false;
    if (this.isHuman(p.team) && p === this.ctrlPlayer) return false;
    if (!isBacklineShirt(p.num)) return false;
    const bd = this.bd;
    const inRuck = !!bd && (this.phase === 'BREAKDOWN' || this.phase === 'BREAKDOWN_REPLAY');
    if (!inRuck && this.phase !== 'OPEN_PLAY') return false;
    const attacking: 'A' | 'B' = inRuck ? bd!.attacking : (this.op?.attacking ?? this.possession);
    const dir: 1 | -1 = attacking === 'A' ? 1 : -1;
    const f = this.tacticalPoint();
    /* the gate geometry: the referee's own while his window is open, else
     * drawn here from the same cluster (applyForwardPack already drew it
     * this frame for the forwards; reuse it — one geometry, two trees) */
    const geo = inRuck ? this.ruckGeoThisFrame : null;
    const inRoster = inRuck && (this.ruckGateRosterCache?.has(`${p.team}:${p.num}`) ?? false);
    const loose = this.bc.free ? { x: this.bc.free.x, z: this.bc.free.z } : null;
    const op = this.op;
    /* the carrier: only while the ball is in a hand — a pass in flight has
     * no carrier, and the marks that read "off the carrier" stand down */
    const carrier = !inRuck && op && !op.ball.live && !this.bc.free
      ? (() => { const c = this.L(op.attacking, op.carrierNum); return { num: c.num, x: c.x, z: c.z, vz: op.vz }; })()
      : null;
    const toLine = Math.max(0, dir > 0 ? FIELD.tryZFar - f.z : f.z - FIELD.tryZ);
    /* the 9's base obeys the team's own hindmost-foot plane — the DYNAMIC
     * hindmost line. The plane is measured from the contest the referee is
     * actually policing (the gate geometry), so the base follows the
     * cleanout crew as their feet come over the ball. */
    const ownEdgeZ = p.team === 'A' ? FIELD.tryZ : FIELD.tryZFar;
    const ctx: BacklineContext = {
      phase: inRuck ? 'BREAKDOWN' : 'OPEN_PLAY',
      team: p.team, attacking, dir, sigma: p.team === 'A' ? 1 : -1,
      openSide: op ? (op.open < 0 ? -1 : 1) : undefined,
      p: { x: p.x, z: p.z }, vel: { x: p.vx, z: p.vz },
      ball: f, mark: { x: p.tx, z: p.tz },
      geo, stage: inRuck ? bd!.stage : '', ruckFormed: inRuck ? bd!.ruckFormed : false,
      inRoster, loose, carrier, latched: !!op?.latch, busy, toLine,
      opT: op ? op.t : 0,
      tempo: this.slider(p.team, 'tempo') / 100,
      lineBreak: !!op?.lineBreak,
      ruckWindow: inRuck ? bd!.window : 0,
      /* the kicking pose, as the defender's back three see it: the tee
       * pose (AIM/METER on the KICK phase — where think() stands down and
       * the SETTING stage owns the rotation) or the run-and-hold charge
       * still in open play, where THIS tree rotates the men live */
      kick: (op && !op.ball.live && !this.bc.free && op.kickCharge > 0.01
        && (op.carrierNum === 9 || op.carrierNum === 10))
        ? { team: op.attacking, num: op.carrierNum, x: op.carrierX, z: op.carrierZ }
        : kickPoseOf(this.kk),
      ownEdgeZ,
    };
    const m = evaluateBacklineTree(p.num, ctx);
    let mark = m ? { x: m.x, z: m.z } : { x: p.tx, z: p.tz };
    /* THE GATE RULE — the same rule the forwards obey, over the tree's
     * mark. A 9 who waits in front of his own team's hindmost foot is
     * routed around the box exactly like a prop, and his job says so. */
    const passed = inRuck && this.ruckGateLedger.hasPassed(p.team, p.num);
    const bias = ((p.num * 37) % 5 - 2) * 0.22;
    const routed = inRuck
      ? routeThroughGate(p.team, ctx.p, mark, geo, passed, bias, { x: p.vx, z: p.vz })
      : { mark, routed: false as const, leg: 'none' as const };
    if (routed.routed) {
      this.backlineStats.routed[p.team]++;
      mark = routed.mark;
    }
    if (!m && !routed.routed) return false;
    if (m) {
      this.backlineStats.nodes[m.node] = (this.backlineStats.nodes[m.node] ?? 0) + 1;
      this.backlineStats.treeMarks++;
      /* the two jobs the probe grades, counted at the source:
       *  · the 9's base vs the team's own plane — onside or offside
       *  · the 10's pocket depth off the ball while he waits on the 9 */
      if (m.node === 'nine-base') {
        const plane = ctx.geo?.gates[ctx.attacking]?.planeZ ?? null;
        const pen = plane === null ? 0 : (m.z - plane) * dir;
        this.backlineStats.nineBaseFrames[p.team]++;
        if (pen > 0.3) this.backlineStats.nineOffsideFrames[p.team]++;
      }
      if (m.node === 'ten-pocket') {
        this.backlineStats.pocketFrames++;
        this.backlineStats.pocketDepthSum += Math.abs(m.z - ctx.ball.z);
      }
    }
    const urgency = m ? plantedUrgency(m, ctx.p) : Math.max(p.urgency, 0.95);
    const job = routed.routed
      ? `${m ? m.job : p.job} — THROUGH THE GATE`
      : m!.job;
    const node = m ? m.node : 'gate-only';
    const xLim = routed.routed ? ROUTE_FIELD_HALF_M : 33;
    const bm = this.boundMark(clamp(mark.x, -xLim, xLim), mark.z);
    this.writeThinkPlayer(gate, `think:backline:${p.team}${p.num}:${node}`, p,
      ['tx', 'tz', 'job', 'urgency'] as const, () => {
        p.tx = clamp(bm.x, -xLim, xLim);
        p.tz = clamp(bm.z, -59, 59);
        p.urgency = clamp(urgency, 0, 1);
        p.job = job;
      });
    return true;
  }

  /** Final held-ball sanity check for EVERY AI mark path, including early
   * dataset/pod returns. A receiver cannot demand a forward pass; a defender
   * cannot guard the wrong goal. This adjusts targets, never player positions. */
  private steerThought(p: Live, dt: number, sprint: boolean, gate: ForwardAttackGateReporter | undefined, label: string) {
    const s = this.op;
    if (this.phase === 'OPEN_PLAY' && s && !s.ball.live && !this.bc.free && !p.carrier) {
      const car = this.L(s.attacking, s.carrierNum);
      const depth = p.team === s.attacking ? (p.num <= 8 ? -1.5 : -3) : 0;
      const relative = (p.tz - car.z) * s.dir;
      if (p.team === s.attacking ? relative >= -0.05 : relative < 0) {
        this.writeThinkPlayer(gate, `${label}:ball-side`, p, ['tz', 'job'] as const, () => {
          p.tz = clamp(car.z + s.dir * depth, -60, 60);
          if (p.team === s.attacking) p.job = 'RELOAD BEHIND THE BALL — GIVE A LEGAL PASS OPTION';
        });
      }
    }
    steer(p, dt, sprint, gate, label);
  }

  private think(dt: number, input: Input) {
    coordinateBall(this);
    const gate = this.forwardAttackGates();
    const s = this.shape();
    const atk = this.possession;
    /* T-13 — the behaviour dataset is the most specific source of positional
     * truth. One situation per side per frame (pure reads of live state),
     * and the beat comes from the existing phase clock. */
    const sitA = situationOf(this, 'A'), sitB = situationOf(this, 'B');
    const beat = beatOf(this);
    const def = this.defending();
    const dir = s.dir;
    const diff = DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)];
    const atkShape = this.shapeOf(atk);
    const defSys = this.defenceOf(def);
    const f = this.tacticalPoint();
    /* SWITCHING MATRIX — the opt-in auto-switch runs off the same freshly
     * read positions as everything else in think(), before any mover acts. */
    this.tickAutoSwitch(dt);

    /* SPEC_11. The single live openside sign. `s.open * flip` was identically
     * +1 — `open` is ±1 and `flip` was its own sign — so the attacking shape
     * was never mirrored to the openside. */
    const openSign: -1 | 1 = s.open < 0 ? -1 : 1;
    /* σ: a team's attacking axis. +1 for A (+z), −1 for B (−z). It is the
     * point mirror that carries the dataset's authored frame into the world,
     * and it is applied exactly once. */
    const atkSigma: -1 | 1 = atk === 'A' ? 1 : -1;
    const defSigma: -1 | 1 = def === 'A' ? 1 : -1;
    const atkSit = atk === 'A' ? sitA : sitB;
    const defSit = def === 'A' ? sitA : sitB;
    /* D11-a: one squeeze factor per formation per frame, so the whole shape
     * narrows together rather than clipping only the men who reached touch. */
    const atkDatasetLat = atkSit ? this.lateralScale(f.x, atkSigma, SITUATION_LATERAL[atkSit].min, SITUATION_LATERAL[atkSit].max) : 1;
    const defDatasetLat = defSit ? this.lateralScale(f.x, defSigma, SITUATION_LATERAL[defSit].min, SITUATION_LATERAL[defSit].max) : 1;
    let shapeMin = 0, shapeMax = 0;
    for (const q of atkShape.slots) {
      const l = q.lat * (0.62 + this.slider(atk, 'width') / 100 * 0.62) * atkShape.width;
      if (l < shapeMin) shapeMin = l;
      if (l > shapeMax) shapeMax = l;
    }
    const shapeLat = this.lateralScale(f.x, openSign, shapeMin, shapeMax);
    const defLineFactor = 0.72 + this.slider(def, 'lineSpeed') / 100 * 0.4;
    const defLineLat = this.lateralScale(f.x, 1, DEFENCE_LAT_MIN * defLineFactor, DEFENCE_LAT_MAX * defLineFactor);

    /* SPEC_12 — FORCE AI CLEAN. One projection, applied to every CPU mark
     * after the formation has written it and before it is steered to. It is
     * deliberately a pass over the marks rather than a change inside each
     * branch: the dataset branch, the shape branch, the CPU planner, the hip
     * and sweep roles, the convergers and the cover chase are then all covered
     * without any of them knowing the law exists, and a new branch is covered
     * the day it is written. */
    const aiClean = (this.options.offsideAiClean ?? 0) === 1;
    const guardLines = aiClean ? liveOffsideLines(this) : [];
    /* D-3 — the retreat-intent pass needs the lines whether or not FORCE AI
     * CLEAN is on, so it reuses the guard's list when available and otherwise
     * reads them itself. One read per frame either way. */
    const retreatLines = aiClean ? guardLines : liveOffsideLines(this);

    /* A KICK IS OWNED BY placeBound. If think() also assigned targets here it
     * would drag the defensive line back on top of the ball — which is exactly
     * the encroachment at the kick-off — and it would fight placeBound for
     * control of the chasers, moving several players twice per frame. */
    const KICK = this.kk;
    if (KICK) {
      /* SPEC_09 — the play-active gate on the human stick. For a restart
       * ritual the full predicate must hold (ball legally live AND the T-69
       * commitment initialized AND no presentation freeze) before input can
       * move anyone: this is the pre-set steal's front door, shut. A kick
       * from open play (PUNT/BOMB/…) keeps the plain FLIGHT test — the ball
       * left the hand in open play, there is no ritual to steal. */
      const ballLive = (KICK.type === 'RESTART' || KICK.type === 'DROP_OUT')
        ? this.restartBallLive()
        : KICK.stage === 'FLIGHT';
      const ch = this.ctrlPlayer;
      if (ch && this.isHuman(ch.team) && eligibleToGather(ch) && ballLive && !KICK.profile.atGoal) {
        this.writeThinkPlayer(gate, `think:kick-input:${ch.team}${ch.num}`, ch,
          ['controlled', 'vx', 'vz', 'x', 'z', 'movedBy'] as const, () => {
            ch.controlled = true;
            const lat = (input.right ? 1 : 0) - (input.left ? 1 : 0);
            const dep = (input.up ? 1 : 0) - (input.down ? 1 : 0);
            const sp = maxSpeed(ch, false, input.sprint, ch.stamina);
            ch.vx = approach(ch.vx, lat * sp * 0.86, 9, dt);
            ch.vz = approach(ch.vz, dep * sp * 0.94, 7, dt);
            ch.x = clamp(ch.x + ch.vx * dt, -34, 34);
            ch.z = clamp(ch.z + ch.vz * dt, -60, 60);
            ch.movedBy = 'input';   // T-02: input is an integration writer
          });
      }
      separate(this.live, dt, gate, 'think:separate:kick');
      return;
    }

    // The nearest goal-side defenders confront the carrier; a small second
    // wave turns after a line break. Compare LIVE positions, not channel
    // offsets minus an anchor that is identically the carrier's own position.
    const convergers = new Set<number>(), coverChase = new Set<number>();
    const carC = this.ballBehaviour.read?.holder;
    if (carC) {
      const defenders = this.live.filter(p => p.team === def && eligibleToGather(p) && p.beatenT <= 0);
      const distance = (p: Live) => Math.hypot(p.x - carC.x, p.z - carC.z);
      const eta = (p: Live) => distance(p) / maxSpeed(p, false, true, p.stamina);
      const front = defenders.filter(p => (carC.z - p.z) * dir <= 0.5 && distance(p) < 14)
        .sort((a, b) => eta(a) - eta(b));
      for (const p of front.slice(0, 2)) convergers.add(p.num);
      const beaten = defenders.filter(p => (carC.z - p.z) * dir > 0.5 && distance(p) < 20 && (p.num !== 15 || front.length === 0))
        .sort((a, b) => eta(a) - eta(b));
      for (const p of beaten.slice(0, COVER_CHASE_MAX - convergers.size)) coverChase.add(p.num);
    }

    const boundNums = new Set<number>();
    const markBound = (team: 'A' | 'B', num: number) => boundNums.add(team === 'A' ? num : num + 100);

    // who is locked into the current set piece / breakdown
    if (this.scrim && (this.phase === 'SCRUM' || this.phase === 'REPLAY')) {
      for (const p of this.scrim.players) markBound(p.team, p.num);
      for (const n of this.scrim.nine) markBound(n.team, 9);
    }
    if (this.lo && (this.phase === 'LINEOUT' || this.phase === 'LINEOUT_REPLAY')) {
      for (const p of this.lo.players) markBound(p.team, p.num);
    }
    if (this.ml && (this.phase === 'MAUL' || this.phase === 'MAUL_REPLAY')) {
      for (let i = 1; i <= 8; i++) { markBound(atk, i); markBound(def, i); }
      /* SPEC_03: the attacking nine walks to and holds the maul base under
       * placeBound, so a TRANSFER_TO_9 can play its existing idle/pass clip
       * without a same-frame shape writer or a teleport at the hand-off. */
      markBound(atk, 9);
    }
    if (this.bd && (this.phase === 'BREAKDOWN' || this.phase === 'BREAKDOWN_REPLAY')) {
      for (const p of this.bd.players) markBound(p.team, p.num);
      /* T-26 — the distributor walking to the base is owned by placeBound for
       * the same reason: two systems steering him (shape mark vs ruck base)
       * is the double-move the ownership contract exists to prevent. */
      const dist9 = ruckDistributor(this.live, this.bd.attacking, this.bd.contactX, this.bd.contactZ);
      if (dist9 && !this.bd.players.some((q) => q.team === this.bd!.attacking && q.num === dist9.num)) {
        markBound(dist9.team, dist9.num);
      }
    }
    if (this.kk && (this.phase === 'KICK' || this.phase === 'KICK_REPLAY')) {
      markBound(this.kk.kicker, this.kk.kickerNum);
    }

    const isBound = (p: Live) => boundNums.has(p.team === 'A' ? p.num : p.num + 100);

    // ---- the controlled player is driven by input, not by a target ----
    const ctrlHuman = this.ctrlPlayer;
    const human = !!ctrlHuman && this.isHuman(ctrlHuman.team);
    if (ctrlHuman && human && !isBound(ctrlHuman) && !ctrlHuman.down && ctrlHuman.sinbin <= 0
      && (ctrlHuman.recoverT ?? 0) <= 0 && (ctrlHuman.diveT ?? 0) <= 0 && !ctrlHuman.latchingOnto) {
      this.writeThinkPlayer(gate, `think:human-input:${ctrlHuman.team}${ctrlHuman.num}`, ctrlHuman,
        ['controlled', 'vx', 'vz', 'x', 'z', 'movedBy', 'face', 'lastFace', 'turnT', 'clip', 'clipT', 'stamina'] as const, () => {
          ctrlHuman.controlled = true;
          const lat = (input.right ? 1 : 0) - (input.left ? 1 : 0);
          const dep = (input.up ? 1 : 0) - (input.down ? 1 : 0);
          const sprint = input.sprint || input.run;
          // T-39. SHIFT is a sustained sprint (×1.24). SPACE's burst stacks a short
          // ×1.15 on top for 0.8 s, so the two read as distinct — one you hold,
          // one you pop to beat a man.
          const burstMul = this.op && this.op.burst > 0 ? 1.15 : 1;
          /* Playtest P1.4/P3.10: 95% of top speed arrived in a third of a
           * second and lateral arrived faster than depth (rates 9 vs 7) —
           * the game had no weight and strafing beat running. Both rates
           * evened and lowered; a step leaves a speed debt that recovers
           * over ~half a second, so a step is a gamble, not a teleport. */
          const debt = this.op?.speedDebt ?? 1;
          const sp = maxSpeed(ctrlHuman, !this.bc.free && !this.op?.ball.live && this.op?.attacking === ctrlHuman.team && this.op?.carrierNum === ctrlHuman.num, sprint, ctrlHuman.stamina) * burstMul * debt;
          // WASD is relative to the camera by default, so the stick always agrees
          // with what the player can see whatever the rig is doing.
          const m = mapInputToWorld(lat, dep, this.cam.yaw, dir, this.relativeControls);
          ctrlHuman.vx = approach(ctrlHuman.vx, m.vx * sp * 0.9, 7.5, dt);
          ctrlHuman.vz = approach(ctrlHuman.vz, m.vz * sp * 0.9, 6.8, dt);
        ctrlHuman.x = clamp(ctrlHuman.x + ctrlHuman.vx * dt, -34.2, 34.2);
        ctrlHuman.z = clamp(ctrlHuman.z + ctrlHuman.vz * dt, -60, 60);
        ctrlHuman.movedBy = 'input';   // T-02: input is an integration writer
        if (Math.abs(ctrlHuman.vz) > 0.4) ctrlHuman.face = ctrlHuman.vz > 0 ? 1 : -1;
        /* The turn beat for the controlled man too — same pivoting cutout. */
        if (ctrlHuman.lastFace === undefined) ctrlHuman.lastFace = ctrlHuman.face;
        if (ctrlHuman.face !== ctrlHuman.lastFace) { ctrlHuman.turnT = 1; ctrlHuman.lastFace = ctrlHuman.face; }
        ctrlHuman.turnT = Math.max(0, (ctrlHuman.turnT ?? 0) - dt * 5);
        const sp2 = Math.hypot(ctrlHuman.vx, ctrlHuman.vz);
        /* Playtest 2: the human's legs ran at authored speed regardless of
         * actual speed — the CPU picker already scales by sp/clipSpeed; the
         * controlled player now does too (same reference speeds). */
        const clipRef = sp2 > 6.2 ? 8.2 : ctrlHuman.carrier ? 6.4 : 4.4;
        ctrlHuman.clipT += dt * (sp2 > 0.7 ? sp2 / clipRef : 1);
        /* PLAYTEST 4: the tackle dive belongs to the human too — the tackle
         * engine sets clip='dive' on the hit; the gait picker must not stomp
         * it in the same beat. Half a second of committed dive, then the gait
         * resumes (or the ruck role clip takes over, which blends anyway). */
        /* LATCH-AND-DRAG: the struggle owns the body for the controlled man
         * too. Without this the human carrier's gait picker overwrote the
         * churn on the very next frame and a held player looked like he was
         * running free — while moving at a quarter of the pace, which is the
         * worst of both. */
        if (!inLatch(ctrlHuman) && (ctrlHuman.jumpY ?? 0) <= 0.01
          && !(ctrlHuman.clip === 'dive' && ctrlHuman.clipT < 0.5)) {
          ctrlHuman.clip = sp2 > 7.4 ? (ctrlHuman.carrier ? 'carry' : 'sprint')
            : sp2 > 3.4 ? (ctrlHuman.carrier ? 'carry' : 'jog')
              : sp2 > 0.7 ? 'jog' : 'ready';
        }
        if (sp2 > 7.0) ctrlHuman.stamina = clamp(ctrlHuman.stamina - dt * 4.4, 0, 100);
        });
    }

    // ---- everyone else ----
    for (const p of this.live) {
      if (p === ctrlHuman && p.controlled) continue;
      if (p.sinbin > 0) {
        this.writeThinkPlayer(gate, `think:sinbin:${p.team}${p.num}`, p, ['urgency'] as const, () => { p.urgency = 0; });
        continue;
      }
      /* T-40. While a pass is in flight the receiver is owned by upOpen, not by
       * the shape. Skipping him here stops think() from yanking him back to his
       * support mark — which is what made him teleport onto the ball. */
      if (this.op?.ball.live && p.team === this.op.attacking && p.num === this.op.pendingReceiver) continue;
      /* PHASE HAND-OFF (T-02 ownership). On the single frame a breakdown or
       * maul resolves, the set-piece code has already placed this man for the
       * ruck and open play then inherits him in the SAME frame — so `steer()`
       * would be the second writer, which is the double-move the contract
       * forbids. Measured 4 times in 18,000 frames, always on the exact frame
       * BREAKDOWN -> OPEN_PLAY.
       *
       * He simply keeps the placement he was given and picks up his steering
       * next frame, 16 ms later, which is invisible. */
      if (p.movedBy === 'bound') {
        this.writeThinkPlayer(gate, `think:handoff:${p.team}${p.num}`, p, ['urgency'] as const, () => {
          p.urgency = 0;
        });
        continue;
      }
      /* LATCH-AND-DRAG (T-02 ownership). A defender hanging off a carrier is
       * owned by engine/latch.ts, which snaps his coordinates onto the
       * carrier's hip every frame. Steering him at a defensive mark at the
       * same time is the double-move the ownership contract exists to
       * prevent, and it would visibly tear him off the man he is holding. */
      if (isLatching(p) || p.movedBy === 'latch') {
        this.writeThinkPlayer(gate, `think:latched:${p.team}${p.num}`, p, ['urgency', 'job'] as const, () => {
          p.urgency = 0;
          p.job = 'HANG ON — DRAG HIM DOWN';
        });
        continue;
      }
      /* GET-UP LOCK. A man climbing off the floor is not steerable. Without
       * this he was handed a formation slot the instant the ruck cleared and
       * slid to it flat on his back — 33% of post-ruck frames moved faster
       * than 3 m/s. He holds his ground, at zero velocity, for exactly as
       * long as the stand-up animation takes. The timer is decremented in
       * one place (tickRecovery) so nothing here can leak it. */
      /* AIRBORNE. A committed dive has no steering: he goes where he launched.
       * Leaving him steerable let the AI curve him onto the carrier in mid-air,
       * which is what made diving free — the whole risk is that a good runner
       * can step inside the trajectory and leave him grasping. */
      if ((p.diveT ?? 0) > 0) {
        this.writeThinkPlayer(gate, `think:diving:${p.team}${p.num}`, p,
          ['urgency', 'job'] as const, () => {
            p.urgency = 0;
            p.job = 'COMMITTED — HE HAS LEFT HIS FEET';
          });
        continue;
      }
      if ((p.recoverT ?? 0) > 0) {
        this.writeThinkPlayer(gate, `think:recovering:${p.team}${p.num}`, p,
          ['urgency', 'job', 'tx', 'tz'] as const, () => {
            p.urgency = 0;
            p.tx = p.x; p.tz = p.z;      // no target: stay exactly here
            p.job = 'GETTING UP';
          });
        continue;
      }
      if (isBound(p) || p.down) {
        this.writeThinkPlayer(gate, `think:bound:${p.team}${p.num}`, p, ['bound'] as const, () => { p.bound = true; });
        continue;
      }
      this.writeThinkPlayer(gate, `think:unbound:${p.team}${p.num}`, p, ['bound'] as const, () => { p.bound = false; });

      // Every free-flight role wins once: collect, support, contain, cover or
      // retreat. Nobody then gets a contradictory old-carrier/positional job.
      const task = this.ballBehaviour.tasks.get(`${p.team}:${p.num}`);
      if (task) {
        if (p.movedBy === 'steer') continue; // receiver already moved in upOpen
        this.writeThinkPlayer(gate, `think:ball-${task.role}:${p.team}${p.num}`, p,
          ['tx', 'tz', 'urgency', 'job'] as const, () => {
            p.tx = task.x;
            p.tz = aiClean ? legalZFor(guardLines, p, task.z, CLEAN_MARGIN_METRES) : task.z;
            p.urgency = task.urgency; p.job = task.job;
          });
        this.steerThought(p, dt, task.sprint, gate, `think:ball-steer:${p.team}${p.num}`);
        continue;
      }

      const onAtk = p.team === atk;
      const c: RoleContract = contractFor(p.num);

      if (onAtk) {
        // carrier: driven by phase logic, not by shape
        if (this.op && p.num === this.op.carrierNum && !this.op.ball.live && !this.bc.free) {
          this.writeThinkPlayer(gate, `think:carrier:${p.team}${p.num}`, p, ['carrier', 'urgency'] as const, () => {
            p.carrier = true;
            p.urgency = 0;
          });
          continue;
        }

        /* T-51 — HOLD THE PODS THROUGH THE RECYCLE BEAT. At the ruck win the
         * fresh shape re-marked every attacker and the extras ran in-out all
         * through the use-it window (the churn). For the first second of a
         * ruck exit the support holds the marks it already has — the pod
         * arrives as a pod. The nine-with-ball and a ball in flight are the
         * exceptions above and below. */
        if (this.op && this.op.podHold > 0
            && Math.hypot(p.tx - f.x, p.tz - f.z) <= POD_HOLD_ANCHOR_METRES) {
          this.applyForwardPack(gate, p, false);
          /* BACKLINE — the pocket and the flat lines are priced on exactly
           * this beat: the first second of the ruck exit, while the pod
           * holds. The 10's pocket depth and the 12's flat lane are the
           * release options the 9 is choosing between. */
          this.applyBackline(gate, p, false);
          this.steerThought(p, dt, false, gate, `think:pod-hold:${p.team}${p.num}`);
          continue;
        }

        // The seven rides the carrier's hip and the eight trails — the offload
        // options — unless the shape needs them in a pod on the far side.
        const slot = atkShape.slots.find((q) => q.num === p.num);
        const hipMan = p.num === 7 || p.num === 8;
        const podFar = slot ? Math.abs(slot.lat) > 14 : false;
        if (this.op && hipMan && !podFar) {
          const car = this.L(atk, this.op.carrierNum);
          const off = openSign * (p.num === 7 ? 1.9 : -1.4);
          this.writeThinkPlayer(gate, `think:hip-support:${p.team}${p.num}`, p,
            ['tx', 'tz', 'urgency', 'job'] as const, () => {
              p.tx = clamp(car.x + off, -33, 33);
              p.tz = clamp(car.z - dir * (p.num === 7 ? 1.6 : 4.0), -59, 59);
              /* T-18. THE SECOND WAVE. Through a broken line the support does
               * not jog — the offload has to be at full pace or the cover
               * meets the ball-carrier alone. 0.92 urgency left the seven
               * trailing every break by two metres a second. */
              p.urgency = this.op?.lineBreak ? 1 : 0.92;
              p.job = c.job.OPEN_PLAY ?? 'SUPPORT THE CARRIER AT THE HIP';
            });
          this.applyForwardPack(gate, p, false);
          this.steerThought(p, dt, true, gate, `think:hip-support-steer:${p.team}${p.num}`);
          continue;
        }

        /* T-13 resolution order: 1) dataset, 2) shape slot, 3) contract.
         * The seven and eight keep the carrier's hip (see above) — the
         * offload lanes the calibrated attack runs on; the dataset's
         * authored trail lines would pull them ten metres off it. */
        if (slot) {
          const sit = p.team === 'A' ? sitA : sitB;
          /* SPEC_11: the dataset is a FORMATION DRAWN AROUND A BALL, and the
           * ball was in one fixed place when it was drawn. `datasetOffset()`
           * returns the shape relative to that anchor; re-anchoring it on the
           * live focus point is what makes the mark follow the play. Steering
           * by the absolute point (`datasetMark`) is the drift bug: a
           * midfield mark applied to a ball on the 22 put the whole backline
           * thirty metres behind the carrier. */
          const dsm = sit ? datasetOffset(p.num, sit, beat) : null;
          if (dsm) {
            const sigma = p.team === 'A' ? 1 : -1;
            /* dsm.along is metres along the attacking axis from the ball:
             * negative is behind it. Depth is what the red-zone drive and the
             * dead-ball compression both act on, so it stays in that form
             * until the world z is needed. */
            let along = dsm.along;
            /* T-13/T-18. The authored red-zone beats march the pods to the
             * 22 and hold them 15 m out — an honest arrival, but nobody
             * threatens the line from there and tries died to zero. Inside
             * 20 m the dataset owns the APPROACH (lateral spot, job, timing)
             * and the engine owns the DRIVE: the mark is flattened to the
             * same pick-and-go depth the shape fix uses, so the carries,
             * the dive and the reach-over actually happen. Now expressed as a
             * depth BEHIND THE BALL rather than an absolute z comparison. */
            if (sit === 'red-zone-22' && this.op) {
              const o = this.op;
              const toLine = o.dir > 0 ? FIELD.tryZFar - o.carrierZ : o.carrierZ - FIELD.tryZ;
              if (toLine < 20) along = Math.max(along, -(0.5 + toLine * 0.08));
            }
            /* D11-a: spread from the ball's own lateral position, squeezed
             * when the formation would run into touch. */
            const across = sigma * dsm.across * atkDatasetLat;
            let targetX = clamp(f.x + across, -33, 33);
            let targetZ = this.anchorDepth(f, sigma, along);

            /* SPEC_02: authored dataset marks remain the highest-priority
             * source of lane/job/timing. CPU support nevertheless enters the
             * same pure depth contract before committing its mark: the
             * dataset lane is preserved (now as a ball-relative offset),
             * while setup depth is validated and made usable for a run-on
             * pass. The depth handed to the pure planner is a true depth —
             * before SPEC_11 it was the distance between an absolute authored
             * point and the live ball, which is not a depth at all. */
            if (!this.isHuman(atk) && this.op) {
              const toLine = Math.max(0, this.op.dir > 0 ? FIELD.tryZFar - f.z : f.z - FIELD.tryZ);
              const role = slot.role === 'WIDE_1' ? 'WING' : slot.role === 'BACKLINE' ? 'BACKLINE' : 'POD';
              const plan = this.planCpuForwardAttack(gate, `think:dataset-depth:${p.team}${p.num}:${sit}`, {
                anchor: f,
                attackDirection: dir < 0 ? -1 : 1,
                /* `across` is already mirrored into world space; do not mirror twice. */
                openside: 1,
                lateralOffsetMetres: across,
                nominalSupportDepthMetres: Math.max(0.5, -along),
                shapeDepthBias: 1,
                tempo: 0,
                distanceToTryLineMetres: toLine,
                role,
              });
              targetX = clamp(plan.setup.x, -33, 33);
              /* Back to an offset, then through the same D11-b compression. */
              targetZ = this.anchorDepth(f, sigma, (plan.setup.z - f.z) * sigma);
            }
            /* D11-b: never past the dead-ball line, never through the posts. */
            const mark = this.boundMark(targetX, targetZ);
            this.writeThinkPlayer(gate, `think:dataset-mark:${p.team}${p.num}:${sit}`, p,
              ['tx', 'tz', 'job', 'urgency'] as const, () => {
                p.tx = clamp(mark.x, -33, 33);
                p.tz = clamp(mark.z, -59, 59);
                p.job = dsm.job;
                p.urgency = 0.9;
              });
            this.applyForwardPack(gate, p, false);
            this.applyBackline(gate, p, false);
            this.steerThought(p, dt, true, gate, `think:dataset-steer:${p.team}${p.num}:${sit}`);
            continue;
          }
        }

        // Otherwise the man stands where the shape says he stands.
        if (slot) {
          /* D11-a: the touchline squeeze multiplies the offset itself, so both
           * the planner path (CPU) and the direct path below inherit it. */
          const lateral = slot.lat * (0.62 + this.slider(atk, 'width') / 100 * 0.62) * atkShape.width * shapeLat;
          const tempo = this.slider(atk, 'tempo') / 100;
          const toLine = Math.max(0, dir > 0 ? FIELD.tryZFar - f.z : f.z - FIELD.tryZ);
          let targetX: number;
          let targetZ: number;

          if (!this.isHuman(atk) && this.op) {
            /* SPEC_02 live Phase B: the CPU's ordinary shape fallback consumes
             * the pure setup point. Arrival/carry geometry is checked before
             * this write, while no plan helper itself mutates Live state. */
            const role = slot.role === 'WIDE_1' ? 'WING' : slot.role === 'BACKLINE' ? 'BACKLINE' : 'POD';
            /* SPEC_11: the live openside sign. `s.open * flip` was identically
             * +1, so the shape never mirrored; this is the single sign. */
            const openside = openSign;
            const plan = this.planCpuForwardAttack(gate, `think:shape-depth:${p.team}${p.num}:${slot.role}`, {
              anchor: f,
              attackDirection: dir < 0 ? -1 : 1,
              openside,
              lateralOffsetMetres: lateral,
              nominalSupportDepthMetres: slot.depth,
              shapeDepthBias: atkShape.depthBias,
              tempo,
              distanceToTryLineMetres: toLine,
              role,
            });
            /* D11-b: the planner's setup point is ball-relative and red-zone
             * aware, but it knows nothing of the dead-ball line or the post
             * corridor, so it gets the same clamps as every other mark. */
            const mark = this.boundMark(
              plan.setup.x,
              this.anchorDepth(f, atkSigma, (plan.setup.z - f.z) * (dir < 0 ? -1 : 1)),
            );
            targetX = clamp(mark.x, -33, 33);
            targetZ = clamp(mark.z, -59, 59);
          } else {
            let depth = slot.depth * atkShape.depthBias * (0.7 + tempo * 0.5);
            /* T-18. Inside the opposition 14 the shape goes FLAT — pick and go
             * from the base. At full depth the pod caught the ball three metres
             * behind the ruck and every red-zone phase LOST three metres of
             * ground: attacks entered at eight metres out and marched slowly
             * back to halfway. */
            if (toLine < 20) depth = Math.min(depth, 0.5 + toLine * 0.08);
            /* D11-a: the shape spreads from the ball's lateral position and
             * squeezes rather than crossing the touchline. */
            targetX = clamp(f.x + lateral * openSign, -33, 33);
            /* D11-b: the same depth compression every other mark gets. */
            targetZ = clamp(this.anchorDepth(f, atkSigma, -depth), -59, 59);
          }

          this.writeThinkPlayer(gate, `think:shape-mark:${p.team}${p.num}:${slot.role}`, p,
            ['tx', 'tz', 'job', 'urgency'] as const, () => {
              p.tx = targetX;
              p.tz = targetZ;
              p.job = slot.job;
              /* T-18. The backline takes the ball at PACE. The old 0.66 jog meant
               * receivers arrived at the line standing still and were tackled on
               * the catch — the attack never crossed the gain line and there were
               * eight phases inside the ten-metre zone per four matches. Real
               * backlines run onto the ball; the wide man still waits a beat. */
              p.urgency = slot.role === 'FRONT_PRONG' ? 0.86
                : slot.role === 'INSIDE_PRONG' ? 0.9
                  : slot.role === 'WIDE_1' ? 0.7 : 0.88;
            });
        } else {
          const m = attackMark(p.num, s);
          this.writeThinkPlayer(gate, `think:contract-mark:${p.team}${p.num}`, p,
            ['tx', 'tz', 'job', 'urgency'] as const, () => {
              p.tx = m.x;
              p.tz = m.z;
              p.job = m.job;
              p.urgency = 0.6;
            });
        }
      } else if (convergers.has(p.num)) {
        // CONVERGE. The defenders whose channel the carrier is running into leave
        // the line and go and make the tackle. Without this branch nobody ever
        // closed on the carrier, because the shape mark was reassigned over the
        // top of the pursuit logic every frame.
        const car = this.L(atk, this.op!.carrierNum);
        const lead = 0.4;
        this.writeThinkPlayer(gate, `think:converge:${p.team}${p.num}`, p,
          ['tx', 'tz', 'job', 'urgency'] as const, () => {
            p.tx = clamp(car.x, -33, 33);
            p.tz = clamp(car.z + this.op!.dir * lead, -58, 58);
            p.job = defSys.job;
            p.urgency = 1;
          });
      } else if (coverChase.has(p.num)) {
        // T-13 cover chase: beaten men hunt the carrier at full tilt.
        const car = this.L(atk, this.op!.carrierNum);
        this.writeThinkPlayer(gate, `think:cover-chase:${p.team}${p.num}`, p,
          ['tx', 'tz', 'job', 'urgency'] as const, () => {
            p.tx = clamp(car.x, -33, 33);
            p.tz = clamp(car.z, -58, 58);
            p.job = 'COVER CHASE — RUN HIM DOWN';
            p.urgency = 1;
          });
      } else if (this.kk && this.kk.stage === 'FLIGHT' && p.team === this.receivingSide()) {
        // FIELD THE KICK. The receiving side runs to where the ball will land.
        const lp = this.landingPrediction();
        const home = defenceMark(p.num, s);
        this.writeThinkPlayer(gate, `think:field-kick:${p.team}${p.num}`, p,
          ['tx', 'tz', 'job', 'urgency'] as const, () => {
            if (lp) {
              const mine = lp.x + (DEFENCE_CHANNELS.find((q) => q.num === p.num)?.lat ?? (home.x - f.x)) * 0.35;
              p.tx = clamp(mine, -33, 33);
              p.tz = clamp(lp.z - (this.kk!.dir > 0 ? 1 : -1) * 1.2, -58, 58);
              p.urgency = 0.95;
              p.job = 'GET TO WHERE THE BALL IS GOING TO DROP';
            } else {
              p.tx = home.x;
              p.tz = home.z;
              p.urgency = 0.5;
            }
          });
      } else {
        /* T-13: the dataset first for the line men too — the authored fold,
         * pillar and chase beats are richer than the channel map. The
         * pursuit and kick-fielding branches above are event-driven and
         * stay exactly as they are. */
        const sitD = p.team === 'A' ? sitA : sitB;
        /* SPEC_11: ball-relative, exactly as on the attacking side. This
         * branch used to steer every defender at an absolute authored spot:
         * the fullback's mark is 22 m behind a ruck drawn on the halfway
         * line, so with the ruck on his own 22 he ran there through the
         * whole attacking line and turned his back on the play. */
        const dsm = sitD ? datasetOffset(p.num, sitD, beat) : null;
        if (dsm) {
          const sigma = p.team === 'A' ? 1 : -1;
          const mark = this.boundMark(
            clamp(f.x + sigma * dsm.across * defDatasetLat, -33, 33),
            this.defensiveDepth(f, dir, this.anchorDepth(f, sigma, dsm.along), p, sitD ?? 'dataset'),
          );
          this.writeThinkPlayer(gate, `think:defence-dataset:${p.team}${p.num}:${sitD}`, p,
            ['tx', 'tz', 'job', 'urgency'] as const, () => {
              p.tx = clamp(mark.x, -33, 33);
              p.tz = clamp(mark.z, -59, 59);
              p.job = dsm.job;
              p.urgency = 0.85;
            });
        } else {
        // HOLD THE LINE. Everyone else keeps the shape connected so a hole wider
        // than the system allows cannot open.
        const ch = DEFENCE_CHANNELS.find((q) => q.num === p.num);
        const m = defenceMark(p.num, s);
        let lat = (ch ? ch.lat : (m.x - f.x)) * defLineFactor;
        let tx = f.x + lat * defLineLat;
        /* T-18. YOU DRIFT ON THE PASS. A real line slides while the ball is
         * in flight — it does not wait for the catch and then react. The
         * old 0.5 factor, applied only to the stationary carrier, left the
         * far side of a multi-pass move uncovered every time: the sweep
         * completed, the last receiver was loose, and tackles fell twenty
         * a match below the floor while passes rose. Full drift while the
         * ball flies, half while it is held. */
        if (this.op) {
          const dw = this.op.ball.live ? defSys.drift * 1.25 : defSys.drift * 0.5;
          tx += (this.op.carrierX - f.x) * dw;
        }
        const umb = defSys.umbrella * (Math.abs(lat) / 22);
        /* SPEC_11 — the direction is applied ONCE. `m.z − f.z` is a
         * world-space signed offset that already carries `s.dir` out of
         * `defenceMark()`; multiplying the difference by `dir` again is
         * `dir² = 1`, a mirror that cancels itself — the line ended up a
         * fixed +z offset from the ball whichever way the attack was
         * running, i.e. behind it whenever team B had the ball. The
         * umbrella term is separate and correctly signed: an arc deepest at
         * the edge sits further towards the DEFENDING team's own line. */
        const tz = f.z + (m.z - f.z) * 0.9 + dir * umb;
        const react = 1 - clamp((100 - p.attrs.AWA) / 400, 0, 0.22);
        /* T-18. THE GRIND BENDS THE LINE. A defence that has given up the
         * gain line six phases running is backpedalling: line speed decays
         * with the attack's consecutive-phase count, capped at 15% — a
         * ten-phase grind is supposed to bend, not reset fresh every ruck.
         * This is team-agnostic physics-of-fatigue, not difficulty: both
         * defences get it equally, and it resets the moment possession
         * turns over. */
        const defFatigue = 1 - Math.min(0.15, Math.max(0, this.phasesGained - 3) * 0.03);
        const urgency = clamp((0.45 + defSys.lineSpeed / 12) * react, 0.28, 1) * defFatigue;
        const line = this.boundMark(tx, this.defensiveDepth(f, dir, tz, p, 'channel-map'));
        this.writeThinkPlayer(gate, `think:defence-line:${p.team}${p.num}`, p,
          ['tx', 'tz', 'job', 'urgency'] as const, () => {
            p.tx = clamp(line.x, -33, 33);
            p.tz = clamp(line.z, -59, 59);
            p.job = defSys.job;
            p.urgency = urgency;
          });
        }
      }

      // CPU difficulty raises decision quality only, never speed
      if (!this.isHuman(p.team)) {
        this.writeThinkPlayer(gate, `think:cpu-reaction:${p.team}${p.num}`, p, ['urgency'] as const, () => {
          p.urgency = clamp(p.urgency * (0.86 + diff.reaction * 0.18), 0, 1);
        });
      }
      /* SPEC_12 — FORCE AI CLEAN, the mark. Runs after every formation writer
       * and before the steer, so it is a later, distinct step on the same
       * player: T-02 single-writer ownership is preserved and the label says
       * who moved him. */
      if (aiClean && !this.isHuman(p.team) && guardLines.length) {
        const lawful = legalMarkZ(guardLines, p, CLEAN_MARGIN_METRES);
        if (lawful !== p.tz) {
          this.writeThinkPlayer(gate, `think:offside-guard:${p.team}${p.num}`, p, ['tz'] as const, () => {
            p.tz = clampPitchZ(lawful);
          });
        }
      }
      /* ---------------- D-3 / T-71: RETREAT INTENT ----------------
       * Rescoped per ruling: retreat logic is NOT rebuilt. Measured, 64.9% of
       * offside frames are ALREADY retreating and only 11.3% drift further
       * offside, so the general behaviour is sound. Two specific defects are
       * targeted and nothing else:
       *
       *   1. the 5.2% of episodes with ZERO retreating frames — a man who is
       *      offside and simply never sets off;
       *   2. lingering — episodes ran to 8.42 s and 37.9 m of penetration.
       *
       * This adjusts the MARK (tz) only, before the steer, exactly like the
       * offside guard above: the man runs back under his own steering rather
       * than being teleported onside. It is independent of FORCE AI CLEAN,
       * which is a player-facing option that is off by default and projects
       * marks outright; this is about intent, not about guaranteeing legality.
       */
      if (!this.isHuman(p.team) && !p.carrier && !p.bound && p.sinbin <= 0
        && (p.recoverT ?? 0) <= 0 && retreatLines.length) {
        let worst = 0;
        let lawfulZ = p.tz;
        for (const line of retreatLines) {
          if (!line.offenders.includes(p.team)) continue;
          if (line.participants?.has(`${p.team}:${p.num}`)) continue;
          if (!insideCorridor(p, line)) continue;
          const tl = line.lineFor(p.team);
          if (!tl) continue;
          const pen = penetrationOf(p, tl);
          if (pen > worst) {
            worst = pen;
            lawfulZ = clampOntoLegalSide(p.z, tl, CLEAN_MARGIN_METRES);
          }
        }
        if (worst > 0.35) {
          p.offsideT = (p.offsideT ?? 0) + dt;
          /* Escalate with dwell time: a man a moment offside is left to his own
           * business, one who has loitered is given an explicit retreat mark
           * and the urgency to chase it. The 1.2 s knee sits above the measured
           * p50 episode length (0.67 s) so ordinary play is untouched, and
           * below the 8.42 s tail this exists to kill. */
          if ((p.offsideT ?? 0) > 1.2 || worst > 6) {
            this.writeThinkPlayer(gate, `think:offside-retreat:${p.team}${p.num}`, p, ['tz'] as const, () => {
              p.tz = clampPitchZ(lawfulZ);
            });
            p.urgency = Math.max(p.urgency, 1);
            p.job = 'GET BACK ONSIDE';
          }
        } else {
          p.offsideT = 0;
        }
      }
      /* PART 4 — THE BACKLINE ECHELON.
       *
       * Depth is a RELATIONSHIP, and until now nothing in the game expressed
       * it: 10, 12 and 13 were authored at 7.4 / 8.0 / 8.6 m, a spread of
       * 1.2 m over twelve metres of width, which draws as a flat horizontal
       * line and lets one shooting defender take two receivers.
       *
       * The override runs last, over whichever source wrote the mark (the
       * dataset, the shape slot, the CPU planner or the contract), because
       * the relationship has to hold whichever of them answered. It writes
       * DEPTH ONLY — the lateral spread, the job and the urgency all stay
       * with the branch that owns them. The 10's own depth is the reference
       * and is derived from the shape rather than from his live mark, so the
       * diagonal does not depend on the order the loop happens to visit the
       * backline in. */
      if (this.op && p.team === atk && !p.carrier && inEchelon(p.num)
          && !(this.op.ball.live && p.num === this.op.pendingReceiver)) {
        const tenSlot = atkShape.slots.find((q) => q.num === 10);
        if (tenSlot) {
          const tempo10 = this.slider(atk, 'tempo') / 100;
          const tenDepth = tenSlot.depth * atkShape.depthBias * (0.7 + tempo10 * 0.5);
          const tenZ = this.anchorDepth(f, atkSigma, -tenDepth);
          const echZ = echelonTargetZ(p.num, tenZ, atkSigma);
          const mark = this.boundMark(p.tx, echZ);
          this.writeThinkPlayer(gate, `think:echelon:${p.team}${p.num}`, p,
            ['tz', 'job'] as const, () => {
              p.tz = clamp(mark.z, -59, 59);
              if (p.num !== 10) {
                p.job = `${p.job} — ${echelonDepthBehindTen(p.num)} m BEHIND THE TEN, ON THE ANGLE`;
              }
            });
        }
      }

      /* FORWARD PACK — the positional trees for 1–8 and the gate rule, the
       * last formation writer before the steer. A converger or a cover
       * chaser is busy: his tree is consulted (the gate rule still binds him)
       * but the open-play nodes that would pull him off the tackle stand down. */
      this.applyForwardPack(gate, p, convergers.has(p.num) || coverChase.has(p.num));
      /* BACKLINE — the positional trees for 9–15, over the dataset / shape /
       * echelon marks, through the SAME ruck gate. The 9's base keeps to the
       * team's dynamic hindmost foot; the 10 prices his pocket; the 12 and
       * 13 run the flat lines; the wings hold the wide edge and the trail;
       * the 15 sweeps the central third. The pendulum is not here — it lives
       * in the kick's SETTING stage, where think() has already stood down. */
      this.applyBackline(gate, p, convergers.has(p.num) || coverChase.has(p.num));
      // T-24b. Convergers sprint to the tackle. They were jogging because the old
      // call only sprinted the controlled player — the carrier simply outran the
      // defence and tackles never happened.
      this.steerThought(p, dt, (input.sprint && p === ctrlHuman) || convergers.has(p.num) || coverChase.has(p.num),
        gate, `think:steer:${p.team}${p.num}`);
    }

    separate(this.live, dt, gate, 'think:separate');

    /* SPEC_12 — FORCE AI CLEAN, the shove. `separate()` is the ordinary way a
     * "clean" AI infringes: not a decision, a collision. The projection runs
     * AFTER the shove, not before it — projecting before would make an
     * overlapping pair stick and re-collide every frame. This moves a POSITION,
     * never a mark, so the formation is untouched. */
    if (aiClean && guardLines.length) {
      for (const p of this.live) {
        if (this.isHuman(p.team) || p.carrier || p.bound || p.sinbin > 0) continue;
        const lawful = legalZFor(guardLines, p, p.z, CLEAN_MARGIN_METRES);
        if (lawful !== p.z) p.z = clampPitchZ(lawful);
      }
    }
  }

  /* ============================ CAMERA ============================ */

  /* ---- camera state ----
   * One rig, one mode, chosen by the player. No automatic shot cutting: the
   * previous build jumped between sideline and behind-the-posts on every phase
   * change, which is what made the view feel disconnected from the action. */
  rigZ = -10;
  camZoom: ZoomSetting = 2;
  dynamicIntensity = 0.6;
  /**
   * THE FRAMING GAIN — how big a person is on screen, in one number.
   *
   * Every `pxPerMetre` in the camera table (7.4 to 13) was chosen for a 1991
   * match where a player is a 14-pixel sprite, and at that scale the whole
   * backline fits in the frame with room to read the shape of it. That was
   * correct then. The squad is now 30-odd skinned humans, and the same lens
   * renders a man at 17 pixels in a 360-row frame: not a player, a smudge —
   * which is why "I can't see anything" is a fair report of the picture even
   * though every system behind it is working.
   *
   * So the gain multiplies the lens and dollies the rig in by the square root
   * of it, which is how a real camera operator does the same thing: come
   * closer and tighten, rather than just zoom and keep the distance. It is one
   * multiplier applied where the mode's own numbers are resolved, so the pitch
   * coverage, the follow clamps, the tilt and the 2D telemetry layer all move
   * together and cannot drift out of register with each other.
   *
   * 1.0 is the original 1991 framing and the 2D-only look; 2.2 is the default
   * because this build shows humans; a player who wants the field back can set
   * it in the camera panel, which is why it is a field and not a constant.
   */
  camScale = 1.6;
  relativeControls = true;

  /* T-08 — action-driven framing state. Causes, not phase ticks: a line
   * break holds the breakaway framing for 2.5 s even if the phase changes,
   * a tackle punches the lens in for under a second, a try or a card holds
   * the subject while the moment is alive. Everything flows through the
   * eased target — no cut is instantaneous, the rig is still a rig. */
  breakawayT = 0; /* T-03: engine-internal (T-08 framing state) */
  impactT = 0; /* T-03: engine-internal (T-08 framing state) */
  holdP: { x: number; z: number; t: number } | null = null; /* engine-internal */

  private updateCamera(dt: number) {
    /* T-03: the rig lives in engine/camera.ts — same state, same maths. */
    updateCamera(this, dt);
  }

  zoomLabel = '2x — STANDARD';

  /* ---- cable cam state ----
   * The rig hangs on notional wires, so it has mass. It does not snap to the
   * ball; it is dragged toward a point behind the ball and swings in behind. */
  /* Cable-rig rest position. A direct launch (Quick Start) seeds these onto
   * the kick-off centre spot in seedCameraOnCenter(); these defaults keep
   * the field definite-assignment safe before the constructor body runs. */
  cableX = 0; /* T-03: engine-internal cable-rig state */
  cableZ = -17;
  cableH = 13;
  cableEase = 0;
  /** eased aim anchor for the cable rig — see cableRig (T-16/NO-WHIP) */
  cableAX = 0;
  cableAZ = 0;
  /** T-21. When OFF (default) the cable cam keeps its end-on side when possession
   * changes, like a broadcast camera that does not cross the field on turnover.
   * When ON it swings to stay behind the new attacking side. */
  cableSwapOnTurnover = false;

  /**
   * THE CABLE CAM.
   *
   * Anchored a fixed trail distance behind the ball along the attacking axis,
   * high enough to read both defensive lines, tilted down, and always looking
   * end to end in the direction the controlled side is attacking. The rig is
   * eased on all three axes independently so it glides rather than jerks —
  /* ============================ TUTORIAL ============================ */

  tut: TutorialState = newTutorial();

  /** Start the tutorial from step zero, in a live user-controlled friendly. */
  startTutorial() {
    this.tut = { ...newTutorial(), active: true };
    this.loadTutorialStep(0);
  }

  /** Set the match up for a step and freeze it behind the explanation card. */
  loadTutorialStep(i: number) {
    const step = stepAt(i);
    if (!step) { this.tut.active = false; this.paused = false; return; }
    this.tut.index = i;
    this.tut.showing = true;
    this.tut.playing = false;
    this.paused = true;
    this.releaseAll();
    this.op = undefined; this.kk = undefined;
    const at = step.at ?? { x: 0, z: 0 };
    switch (step.setup) {
      case 'RESTART': this.startKick('A', 'RESTART', { x: 0, z: 0 }); break;
      case 'SCRUM': this.startScrum('A', at.x, at.z); break;
      case 'LINEOUT': this.startLineout('A', at.z, at.x); break;
      case 'MAUL': this.startMaul('A', at.x, at.z, MAUL_RANKS_PER_SIDE, true); break;
      case 'KICK_AT_GOAL': this.startKick('A', 'GOAL', at); break;
      case 'BREAKDOWN':
        this.startOpen('A', at.x, at.z, 12, 1);
        this.startBreakdown(7);
        break;
      case 'PENALTY': this.startOpen('A', at.x, at.z, 9, 1); break;
      default: this.startOpen('A', at.x, at.z, 12, 1); break;
    }
    // startX may have unpaused via a phase change; re-freeze behind the card.
    this.paused = true;
  }

  /** The player pressed one of the listed keys. Unfreeze and let him play. */
  resumeTutorial() {
    if (!this.tut.showing) return;
    this.tut.showing = false;
    this.tut.playing = true;
    this.paused = false;
    const s = stepAt(this.tut.index);
    if (s) {
      this.showHint(s.then, 5);
      if (!this.tut.completed.includes(s.id)) this.tut.completed.push(s.id);
    }
  }

  nextTutorialStep() { this.loadTutorialStep(this.tut.index + 1); }
  resetTutorialStep() { this.loadTutorialStep(this.tut.index); }

  /**
   * Play has moved into a contest the player has not been taught yet. Freeze and
   * show that step's card in place, without moving anybody — the situation on
   * the field is already the lesson. This is what stops the game feeling like it
   * teleports between unrelated set pieces.
   */
  private tutorialWatchPhase() {
    const map: Record<string, string> = {
      SCRUM: 'T4-SCRUM',
      LINEOUT: 'T5-LINEOUT',
      BREAKDOWN: 'T3-BREAKDOWN',
      MAUL: 'T6-MAUL',
      KICK: 'T1-KICKOFF',
    };
    const wantId = map[this.phase];
    if (!wantId || this.tut.completed.includes(wantId)) return;
    const idx = TUTORIAL.findIndex((s) => s.id === wantId);
    if (idx < 0) return;
    // Freeze in place. Do NOT re-run loadTutorialStep — that would rebuild the
    // set piece and throw away the situation the player just created.
    this.tut.index = idx;
    this.tut.showing = true;
    this.tut.playing = false;
    this.paused = true;
  }

  /* ============================ OPEN PLAY ============================ */

  /* ============================ CHAOS SCRIMMAGE ============================ */

  /**
   * TARCS stress scrim: 14 active ragdolls (7v7).
   *
   * The human carrier is the camera target and the ball is welded to him
   * (BALL SECURED). Six friendly bodies fan out behind him with simple
   * flocking; the seven opposing bodies are immediately in "Flailing Dive"
   * pursuit. The 14 bodies are spawned as RapierWorld TABS ragdolls so the
   * contact is real solver work; the same Live bodies are synced back every
   * frame so the existing renderer streams the result without a new art path.
   */
  startChaosScrimmage() {
    /* A restart tears down the previous TARCS world first. */
    if (this.chaos) this.teardownChaosPhysics(this.chaos);

    const playerNum = 10;
    const allyNums = [9, 11, 12, 13, 14, 15];
    const rivalNums = [1, 2, 3, 4, 5, 6, 7];

    const player = this.L('A', playerNum);
    const allies = allyNums.map((n) => this.L('A', n));
    const rivals = rivalNums.map((n) => this.L('B', n));
    const pool = [player, ...allies, ...rivals];
    const bodies: ChaosBody[] = pool.map((p, i) => ({
      role: p === player ? 'PLAYER' : p.team === 'A' ? 'ALLY' : 'RIVAL',
      phase: (i * 1.618 + 0.4) % (Math.PI * 2),
      diveT: 0,
      diveCd: i < 7 ? 0.1 + (i % 4) * 0.22 : 0,
      wobble: 0.6 + ((i * 37) % 10) / 10,
    }));

    /* Park the full thirty cleanly so no stale latch / carry / down state
     * leaks into the scrim. */
    for (const p of this.live) {
      p.controlled = false;
      p.carrier = false;
      p.passRank = 0;
      p.bound = false;
      p.down = false;
      p.sinbin = 0;
      p.beatenT = 0;
      p.diveT = 0;
      p.recoverT = 0;
      p.recoverX = undefined;
      p.recoverZ = undefined;
      p.latchedBy = null;
      p.latchingOnto = null;
      p.latchDrag = undefined;
      p.vx = 0;
      p.vz = 0;
      p.restT = 0;
      p.clip = 'idle';
      p.clipT = R() * 2;
      p.jitter = R() * 1.7;
      p.stamina = 100;
      p.assignment = 'OPEN_PLAY';
      p.job = '';
      p.tx = p.x;
      p.tz = p.z;
      p.urgency = 0.5;
      p.movedBy = undefined;
    }

    /* Spawn layout: carrier at the centre of his half, allies fanning behind,
     * rivals starting in a loose flail line ahead of him. */
    const sx = 0, sz = -20;
    player.x = sx; player.z = sz; player.vx = 0; player.vz = 0;
    player.face = 1; player.clip = 'carry'; player.clipT = 0;
    player.carrier = true; player.controlled = true;
    player.job = 'BALL SECURED — CARRY';
    player.tx = sx; player.tz = sz + 3;
    player.urgency = 1;

    allies.forEach((p, i) => {
      const o = CHAOS_ALLY_FAN[i % CHAOS_ALLY_FAN.length];
      this.place(p, clamp(sx + o.x, -32, 32), clamp(sz + o.z, -56, 56), 'chaos');
      p.face = 1; p.clip = 'ready'; p.clipT = R() * 2;
      p.job = 'FAN OUT BEHIND THE CARRIER';
      p.tx = p.x; p.tz = p.z;
      p.urgency = 0.85;
    });

    rivals.forEach((p, i) => {
      const ox = ((i % 7) - 3) * 4.2 + (((i * 13) % 5) - 2);
      const oz = 4 + (i % 3) * 3;
      this.place(p, clamp(sx + ox, -32, 32), clamp(sz + oz, -56, 56), 'chaos');
      p.face = -1; p.clip = 'sprint'; p.clipT = R() * 2;
      p.job = 'FLAILING DIVE — TARGET THE PLAYER';
      p.tx = player.x; p.tz = player.z;
      p.urgency = 1.1;
    });

    /* Disable any live phase objects and switch to the scrim phase. */
    this.op = undefined; this.bd = undefined; this.ml = undefined;
    this.kk = undefined; this.lo = undefined; this.scrim = undefined;
    this.passOpts = [];
    this.pendingPenalty = null;
    this.advantage = 0;
    this.advWatch = null;
    this.pendingWindback = false;
    this.refBubbles = [];
    this.possession = 'A';
    this.phase = 'CHAOS_SCRIM';
    this.paused = false;
    this.over = false;
    this.replayOf = null;
    if (this.tut.active) this.tut.active = false;
    this.setCtrl('A', playerNum, false);

    this.chaos = {
      t: 0,
      pool,
      bodies,
      player,
      allies,
      rivals,
      playerNum,
      fendEnd: null,
      ballSecured: true,
      ballState: 'SECURED',
      spawnX: sx,
      spawnZ: sz,
      latch: null,
      fps: { start: performance.now(), frames: 0 },
      contacts: 0,
      dives: 0,
      physicsReady: false,
      physicsError: '',
      physicsToken: ++this.chaosPhysicsSerial,
    };

    this.bootstrapChaosPhysics(this.chaos);
    this.banner_('BALL SECURED — CHAOS SCRIMMAGE');
    this.say('BALL SECURED — 14 BODIES, 7 RIVALS ARE COMING IN FLAILING DIVES');
    this.showHint('C RESTARTS THE CHAOS SCRIMMAGE · W / S / A / D CARRY · SPACE SPRINT', 6);
  }

  /** Restart the same 14-body scrim, used by the C trigger. */
  restartChaosScrimmage() {
    this.startChaosScrimmage();
  }

  /**
   * Boot the TARCS Rapier world for a scrim. Dynamic import keeps the WASM
   * bundle out of the main match chunk (it is only needed in this mode), and
   * the token check means a restart can never hand a stale world to the live
   * scrim.
   */
  private bootstrapChaosPhysics(c: ChaosScrimState): void {
    const token = c.physicsToken;
    void (async () => {
      try {
        const mod = await import('../core/physics/RapierWorld');
        const world = await mod.RapierWorld.create();
        world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0, friction: 0.85 });

        const ragdolls = c.pool.map((p, i) => world.addTabsPlayer({
          x: p.x,
          y: 0,
          z: p.z,
          vx: p.vx * (i === 0 ? 0 : 2.2),
          vz: p.vz * (i === 0 ? 0 : 2.2),
        }));

        const ball = world.addBall({ x: c.player.x, y: 1.53, z: c.player.z });
        const ballCarrier = world.attachBallToCarrier(ragdolls[0], ball, {
          /* Stress focus is the 14-body pile; keep the weld secure so the
           * TARCS BALL_SECURED path is on-screen throughout. */
          breakImpulse: 1e9,
          carryOffset: { x: 0, y: -0.05, z: 0.30 },
        });

        if (this.chaos !== c || token !== c.physicsToken) {
          world.dispose();
          return;
        }

        const contactOff = world.onPlayerImpact(() => {
          c.contacts++;
        });
        c.physics = {
          world,
          ragdolls,
          ball,
          ballCarrier,
          accumulator: 0,
          lastStepMs: 0,
          contactOff,
        };
        c.physicsReady = true;
        c.physicsError = '';
        c.ballSecured = ballCarrier.state === 'BALL_SECURED';
        /* The Live positions are the physics spawn mirrors; re-seat the camera
         * target immediately after the WASM world has materialised. */
        this.syncActors();
      } catch (err) {
        if (this.chaos !== c) return;
        c.physicsReady = false;
        c.physicsError = err instanceof Error ? err.message : String(err);
        console.error('[chaos] TARCS bootstrap failed', c.physicsError);
      }
    })();
  }

  /** Drop the TARCS world backing a scrim (called on restart/teardown). */
  private teardownChaosPhysics(c: ChaosScrimState): void {
    const ph = c.physics;
    if (ph) {
      ph.contactOff?.();
      ph.world.dispose();
      c.physics = undefined;
    }
    c.physicsReady = false;
  }

  startOpen(team: 'A' | 'B', x: number, z: number, num = 9, phase = 1, gained = 0, protect = 0, preservePose = false) {
    const externalSetup = !this.inUpdate;
    this.releaseBallControl();
    // A direct gather/reset must not leave think() frozen in an old kick ritual.
    this.kk = undefined;
    this.possession = team;
    const dir = team === 'A' ? 1 : -1;
    const open = Math.abs(x) > 8 ? -Math.sign(x) : Math.sign(x) || 1;
    // The carrier is placed AT the ball and set moving forward. Without this the
    // ball snaps to wherever the receiver happened to be standing, which reads
    // on screen as the ball teleporting with the player.
    /* T-16/NO-TELEPORT — but only when he is CLOSE. If the named carrier is
     * still metres away (a ruck exit before the nine has arrived, a loose
     * regather) snapping him to the ball is itself a teleport. In that case
     * the ball is played from where he actually stands: the systems that feed
     * startOpen walk their carrier to the spot first (T-26 does it for the
     * ruck), so the close-place path is the normal one. */
    const car = this.L(team, num);
    car.carrier = true;
    car.job = 'CARRY THE BALL — LOOK FOR SUPPORT';
    let cx: number, cz: number;
    /* NO-TELEPORT: measure against the point he would actually be placed at —
     * the CLAMPED one. A ball near the touchline clamps inwards by a metre
     * and more, so the old guard (measured on the raw mark) passed while the
     * place itself jumped. */
    const gx = clamp(x, -33, 33), gz = clamp(z, -58, 58);
    /* SPEC_05 / T-68 (tighten): the close-place guard was 1.2 m, so a carrier
     * / kick-catcher up to 1.2 m off the mark could be snapped onto the ball in
     * one frame (measured 1.184 m on a fullback catch). Dropped to 1.0 m so a
     * close-place write can never ride over the 1.15 m tighten line; a runner
     * further off takes the no-snap path and plays from where he actually
     * stands (the systems that feed startOpen walk their carrier to the spot
     * first, so this path only handles the genuinely-off runners). */
    const CLOSE_PLACE_MAX = 1.0;
    if (preservePose) {
      // A real gather happens AT the player's hands, never by relocating him
      // to the ball or resetting his running velocity on the catch frame.
      cx = car.x; cz = car.z;
    } else if (Math.hypot(car.x - gx, car.z - gz) < CLOSE_PLACE_MAX) {
      /* D-2 — the close place still closed up to 1.0 m in a single frame, an
       * implied 60 m/s, and the tightened 0.80 m gate sees it. Bound the step;
       * the carrier's own open-play integration closes the rest over the next
       * frames, which is what the walk-on systems upstream already assume. */
      const cgap = Math.hypot(gx - car.x, gz - car.z);
      const cstep = Math.min(cgap, 0.55);
      cx = cgap > 1e-4 ? car.x + (gx - car.x) / cgap * cstep : gx;
      cz = cgap > 1e-4 ? car.z + (gz - car.z) / cgap * cstep : gz;
      this.place(car, cx, cz, 'carrier');
    } else {
      cx = clamp(car.x, -33, 33); cz = clamp(car.z, -58, 58);
    }
    if (!preservePose) {
      car.vx = 0;
      car.vz = dir * 3.4;
      car.face = dir;
      car.down = false;
      car.bound = false;
    }
    this.live.forEach((p) => { p.passRank = 0; p.carrier = p === car; });

    this.op = {
      t: 0, attacking: team, dir,
      carrierX: cx, carrierZ: cz, carrierNum: num,
      vx: preservePose ? car.vx : 0, vz: preservePose ? car.vz : dir * 4.2, protect,
      podHold: protect > 0 ? Math.min(1.0, protect) : 0,
      supports: [], defenders: [],
      gained, toLine: Math.abs(dir * 50 - z), z, pressure: 0, phase,
      lineBreak: false,
      current: { label: '' },
      burst: 0, burstCd: 0, stepCd: 0, fendCd: 0, dive: 0, kickCharge: 0, kickKind: '', speedDebt: 1,
      passHold: 0, passKind: '', passPace: 1,
      originZ: z, originX: x,
      /* T-18. The first decision comes after the carrier has actually taken the
       * ball to the line — not on the frame it arrived. `protect` is now opt-in
       * per call site: it is the lawful post-ruck window only. A receiver of a
       * pass or a fielder of a kick is fair game the moment he catches it. */
      /* T-18. The nine acts at real ruck speed — the distribution pass
       * leaves the base in a fraction of a second, not after a walk. */
      aiTimer: num === 9 ? 0.13 + R() * 0.15 : 0.28 + R() * 0.42, aiIntent: 'CARRY', aiPlay: 'SP-POD', aiPhasePlan: 0,
      heldT: 0,
      open,
      ball: { ...makeBall(x, 1.05, z), live: false, t: 0 },
      pendingReceiver: num, passT: 0, passDist: 8,
      passTargetX: x, passTargetZ: z,
    };    this.bd = undefined; this.ml = undefined;
    this.phase = 'OPEN_PLAY';
    this.syncBallSocket();
    this.setCtrl(team, num, false);
    /* A caller explicitly staging an open-play drill owns its first control
     * shirt. Live phase transitions keep the Quick Start lock instead. */
    if (externalSetup && this.isHuman(team)) this.lockRole(team, num);
    this.refreshPassOptions();
    if (!this.isHuman(team)) this.cpuCallPlay();
  }

  /** Kinematic weld, after ALL player writers; the renderer reads this pose. */
  syncBallSocket() {
    const s = this.op;
    if (this.phase === 'OPEN_PLAY' && s && !s.ball.live && !this.bc.free) {
      weldBall(s.ball, this.L(s.attacking, s.carrierNum));
    }
  }

  /**
   * Set the live control index. Internal phase/ball writers pass false so their
   * temporary handoffs do not rewrite the persistent role; the two-argument
   * form remains the historical deliberate-control API and locks that shirt.
   */
  setCtrl(team: 'A' | 'B', num: number, lockSelection = true) {
    const p = this.live.findIndex((q) => q.team === team && q.num === num);
    if (p >= 0) this.ctrl = p;
    /* Two-argument calls are the historical manual-control API. Internal
     * phase writers pass false so a pass/kick/ruck cannot silently rewrite
     * the user's persistent role. CPU-side test calls remain direct control
     * without inventing a human lock. */
    if (p >= 0 && lockSelection && this.isHuman(team)) {
      this.roleLockTeam = team;
      this.roleLockNum = Math.round(num);
      this.roleLocked = true;
    }
  }

  /** The side the human is coaching, or null for a CPU-vs-CPU payload. */
  humanTeam(): 'A' | 'B' | null {
    if (this.roleLockTeam && this.isHuman(this.roleLockTeam)) return this.roleLockTeam;
    if (this.isHuman('A')) return 'A';
    if (this.isHuman('B')) return 'B';
    return null;
  }

  /**
   * Make a shirt the persistent human role. This is the only operation that
   * changes the role lock, so automatic carrier/kicker handoffs cannot steal
   * the stick. Q also uses this deliberately: an emergency switch is a new
   * useful role, not a one-frame camera cut.
   */
  lockRole(team: 'A' | 'B', num: number): boolean {
    if (!this.isHuman(team) || !Number.isFinite(num)) return false;
    const n = Math.round(num);
    if (n < 1 || n > 15 || !this.live.some((p) => p.team === team && p.num === n)) return false;
    this.roleLockTeam = team;
    this.roleLockNum = n;
    this.roleLocked = true;
    this.setCtrl(team, n, false);
    for (const p of this.live) p.controlled = p.team === team && p.num === n;
    return true;
  }

  /** Shirt shortcuts deliberately work in live play as well as stoppages: a
   * number key is a persistent assignment, not the carrier auto-switch. */
  selectRole(num: number): boolean {
    const team = this.humanTeam();
    if (!team || num < 1 || num > 15 || this.phase.includes('REPLAY')) return false;
    const ok = this.lockRole(team, num);
    if (ok) this.showHint(`ROLE LOCKED — ${team} SHIRT ${num}`, 1.6);
    return ok;
  }

  /**
   * Q's context switch: take the human teammate carrying the ball; otherwise
   * take the ranked nearest goal-side defender to the live carrier/ball.
   */
  emergencySwitch(): boolean {
    const team = this.humanTeam();
    if (!team) return false;
    let target: Live | null = null;
    if (this.op && !this.op.ball.live && !this.bc.free && this.op.attacking === team) {
      target = this.L(team, this.op.carrierNum);
    } else {
      const point = this.bc.free
        ? { x: this.bc.free.x, z: this.bc.free.z }
        : this.tacticalPoint();
      const ranked = this.rankInterceptors(team, point.x, point.z);
      target = ranked[0] ?? null;
      /* If the human side has the ball but it is airborne, a receiver is more
       * useful than a defender ranking. */
      if (!target && this.op && this.op.attacking === team) {
        target = this.live
          .filter((p) => p.team === team && eligibleToGather(p))
          .sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z))[0] ?? null;
      }
    }
    if (!target) return false;
    const ok = this.lockRole(target.team, target.num);
    if (ok) {
      this.lastManualSwitch = this.t;
      this.bestInterceptor = this.live.findIndex((p) => p === target);
      this.showHint(`Q SWITCH — CONTROLLING SHIRT ${target.num}`, 1.5);
    }
    return ok;
  }

  /** Idempotent teardown, also used by whistles and direct phase transitions. */
  releaseBallControl() {
    clearBallBehaviour(this.ballBehaviour);
    for (const a of this.actors) { a.ballLookX = undefined; a.ballLookZ = undefined; }
    if (this.op) this.op.ball.socket = null;
    clearCraft(this.bc);
  }

  /**
   * Control handoff — how the player jumps in and out of a match the AI is
   * already playing. On any change of possession or phase, control passes to the
   * man whose job it now is. The AI keeps driving everyone else, so if the player
   * never touches a key the match still plays out as a game of rugby.
   */
  handoffControl() {
    /* Persistent role lock beats the old carrier-driven handoff. The AI still
     * thinks and moves all other 29 players; only the input stick remains on
     * this shirt until Q or a role shortcut changes it. */
    if (this.roleLocked && this.roleLockTeam) {
      this.setCtrl(this.roleLockTeam, this.roleLockNum, false);
      return;
    }
    if (this.bc.free) {
      // No carrier exists to hand back to. Keep a valid manual selection;
      // otherwise choose an eligible human chaser, never the former owner.
      const current = this.ctrlPlayer;
      if (current && this.isHuman(current.team) && eligibleToGather(current)) return;
      let best: Live | null = null, distance = Infinity;
      for (const p of this.live) {
        if (!this.isHuman(p.team) || !eligibleToGather(p)) continue;
        const gap = Math.hypot(p.x - this.bc.free.x, p.z - this.bc.free.z);
        if (gap < distance) { best = p; distance = gap; }
      }
      if (best) this.setCtrl(best.team, best.num, false);
      return;
    }
    if (!this.isHuman(this.possession)) return;
    const f = this.focusPoint();
    if (this.op) { this.setCtrl(this.op.attacking, this.op.carrierNum, false); return; }
    if (this.ml) { this.setCtrl(this.ml.attacking, 8, false); return; }
    if (this.bd) { this.setCtrl(this.bd.attacking, 9, false); return; }
    if (this.lo) { this.setCtrl(this.lo.thrower, 2, false); return; }
    if (this.scrim) { this.setCtrl(this.scrim.feed, 9, false); return; }
    if (this.kk) {
      // Once the kick is away the interesting player is a chaser, not the man
      // who has just struck it. Handing control back to the kicker is what made
      // the controlled player appear to fly along with the ball.
      if (this.kk.stage === 'AIM' || this.kk.stage === 'METER') {
        this.setCtrl(this.kk.kicker, this.kk.kickerNum, false);
      } else if (this.isHuman(this.kk.kicker)) {
        this.setCtrl(this.kk.kicker, this.kk.chasers[0]?.num ?? this.kk.kickerNum, false);
      } else {
        /* Playtest P1.4: control must never land on the opposition. If the
         * CPU kicked, the human receives and takes the fielder. If the
         * HUMAN kicked, control stays with the human's lead chaser even
         * when the CPU is better placed to field — the player never loses
         * the side he is playing. */
        if (this.isHuman(this.receivingSide())) {
          const lp = this.landingPrediction();
          const t = lp ?? { x: this.kk.bx, z: this.kk.bz };
          const rec = assignReceiver(this.live, this.receivingSide(), t.x, t.z);
          if (rec) this.setCtrl(this.receivingSide(), rec.num, false);
        }
      }
      return;
    }
    const def = this.defending();
    const best = this.live
      .filter((p) => p.team === def && p.sinbin <= 0 && !p.down)
      .sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
    if (best) this.setCtrl(def, best.num, false);
  }

  /* ================== SWITCHING MATRIX ==================
   *
   * Defence switching picks the man who can actually make the next tackle,
   * not whoever stands nearest the ball: an interceptor is ranked by how
   * fast he can CLOSE on the carrier (distance off his own top pace), with
   * a heavy bonus for already being goal-side of the carrier and a penalty
   * for a man on the floor, in the bin, or committed to a dive he cannot
   * steer out of. Q cycles the ranked three; the auto-switcher (opt-in)
   * hands control to the ranked best only when the current man cannot get
   * there and never inside the grace window after a manual pick.
   */

  /**
   * Rank every eligible defender of `team` as the next interceptor of the
   * point (x, z), best first. Pure read of live state — safe to call from
   * probes. Empty when nobody is eligible (all down / binned).
   */
  rankInterceptors(team: 'A' | 'B', x: number, z: number): Live[] {
    const atkDir: -1 | 1 = team === 'A' ? 1 : -1;
    const scored: { p: Live; score: number }[] = [];
    for (const p of this.live) {
      if (p.team !== team || (this.bc.free ? !eligibleToGather(p) : p.sinbin > 0 || p.down) || !canPlayBall(this, p)) continue;
      const dist = Math.hypot(p.x - x, p.z - z);
      /* seconds for HIM to close, at his own top pace — aose-one sprinter
       * twenty out beats a tighthead ten out. */
      const pace = Math.max(1.5, maxSpeed(p, false, true, p.stamina));
      let score = dist / pace;
      /* goal-side is the tackle that matters: between the carrier and the
       * line he defends. Facing the wrong way or upfield of the ball is a
       * chase, not an interception. */
      const goalSide = (p.z - z) * atkDir < -0.5;
      if (goalSide && !this.bc.free) score -= 1.1;
      if (p.clip === 'dive') score += 2.5;   // committed — cannot be re-aimed
      if ((p.recoverT ?? 0) > 0) score += 2.0; // still getting up
      if (p.latchingOnto || p.latchedBy) score -= 0.6; // already in the fight
      scored.push({ p, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.p);
  }

  /** The ranked-best interceptor's index into `live`, or -1 if none. */
  updateBestInterceptor(team: 'A' | 'B', x: number, z: number): number {
    const ranked = this.rankInterceptors(team, x, z);
    this.bestInterceptor = ranked.length
      ? this.live.findIndex((p) => p === ranked[0])
      : -1;
    return this.bestInterceptor;
  }

  /** Note a deliberate human pick — the auto-switcher stands off after it. */
  noteManualSwitch() {
    this.lastManualSwitch = this.t;
  }

  /** The AUTO SWITCH option: 0 = off (Q only), 1 = on (grace-respecting). */
  autoSwitchEnabled(): boolean {
    return (this.options.autoSwitch ?? 0) === 1;
  }

  /**
   * Smart switch: Q jumps to the ranked-best interceptor when he is not
   * already controlled, otherwise cycles the ranked next two — so a first
   * tap always grabs the right man and repeat taps still walk the options.
   */
  smartSwitch() {
    const controlledTeam = this.ctrlPlayer?.team;
    const def = this.bc.free
      ? (controlledTeam && this.isHuman(controlledTeam) ? controlledTeam
        : this.isHuman('A') ? 'A' : this.isHuman('B') ? 'B' : this.defending())
      : this.defending();
    const f = this.focusPoint();
    const ranked = this.rankInterceptors(def, f.x, f.z).slice(0, 3);
    if (!ranked.length) return;
    this.noteManualSwitch();
    const cur = this.live[this.ctrl];
    if (!cur || cur.team !== def || cur.num !== ranked[0].num) {
      const at = this.live.findIndex((p) => p === ranked[0]);
      if (at >= 0) this.ctrl = at;
    } else if (ranked.length > 1) {
      const idx = ranked.findIndex((p) => p.num === cur.num);
      const next = ranked[(idx + 1) % ranked.length];
      const at = this.live.findIndex((p) => p === next);
      if (at >= 0) this.ctrl = at;
    }
    this.bestInterceptor = this.live.findIndex((p) => p === ranked[0]);
    this.showHint(`CONTROLLING ${this.teams[def].players[this.ctrlPlayer.num - 1].name} — ${contractFor(this.ctrlPlayer.num).pos}`, 2);
  }

  cycleDefender() {
    this.smartSwitch();
  }

  /**
   * The auto-switch tick: hands control to the ranked-best interceptor when
   * the human is defending, the option is on, the grace window after his
   * last manual pick has expired, and the best man is strictly better
   * placed than the currently controlled one. Never fires while the human
   * is mid-tackle input or while a pass/kick charge is held.
   */
  tickAutoSwitch(dt: number) {
    if (!this.autoSwitchEnabled()) return;
    if (this.phase !== 'OPEN_PLAY' || !this.op) return;
    const def = this.bc.free && this.ctrlPlayer ? this.ctrlPlayer.team : this.defending();
    if (!this.isHuman(def)) return;
    if (this.t - this.lastManualSwitch < AUTO_SWITCH_GRACE) return;
    const cur = this.live[this.ctrl];
    if (!cur || cur.team !== def) return;
    if (cur.clip === 'dive' || cur.clip === 'tackle') return;
    if (this.op.passHold > 0 || this.op.kickCharge > 0) return;
    const f = this.focusPoint();
    const ranked = this.rankInterceptors(def, f.x, f.z);
    if (!ranked.length) return;
    this.bestInterceptor = this.live.findIndex((p) => p === ranked[0]);
    if (ranked[0] === cur) return;
    /* Only move when the current man genuinely cannot get there: the best
     * interceptor must be at least a full second closer to the contact. */
    const atkDir: -1 | 1 = def === 'A' ? 1 : -1;
    const tta = (p: Live) => {
      const pace = Math.max(1.5, maxSpeed(p, false, true, p.stamina));
      const goalSide = (p.z - f.z) * atkDir < -0.5;
      return Math.hypot(p.x - f.x, p.z - f.z) / pace - (goalSide ? 1.1 : 0);
    };
    if (tta(cur) - tta(ranked[0]) < AUTO_SWITCH_MARGIN) return;
    const at = this.live.findIndex((p) => p === ranked[0]);
    if (at >= 0) {
      this.ctrl = at;
      this.say(`SWITCHING TO ${this.ctrlPlayer.num} — HE HAS THE ANGLE`);
    }
    void dt;
  }

  /* ================== ATTACK DISTRIBUTION ==================
   *
   * The SHOULDERS hierarchy: 9 → 10 → 12 → 13 → 11 → 14 → 15. `echelonTarget`
   * names the next alive man down the line from the carrier; `distributePass`
   * throws to him (cutting out a smothered link on the way); `doPassToNum`
   * is the numbered shirt the pass is addressed to rather than a side, so the
   * ball travels down the backline instead of sideways.
   *
   *  This is the HUMAN nine's release (the T key, or SPACE on AUTO) plus the
   *  numbered-pass API the probes drive. The CPU nine deliberately keeps the
   *  priority/side selection: its trajectories are what every gate samples,
   *  and the echelon walk is a player mechanic, not a brain transplant.
   */

  /** Next alive man down the echelon from the carrier, or null. */
  echelonTarget(): Live | null {
    const s = this.op;
    if (!s || this.phase !== 'OPEN_PLAY') return null;
    const atk = s.attacking;
    const order = [10, 12, 13, 11, 14, 15];
    if (s.carrierNum === 9) {
      const ten = this.L(atk, 10);
      return ten.sinbin <= 0 && !ten.down ? ten : null;
    }
    const at = order.indexOf(s.carrierNum);
    const candidates = at >= 0 ? order.slice(at + 1) : order;
    for (const num of candidates) {
      const p = this.L(atk, num);
      if (p.sinbin <= 0 && !p.down) return p;
    }
    return null;
  }

  /**
   * Throw the distribution pass down the echelon. Returns true when a pass
   * left the carrier's hands (including a whistled or spilled one — the
   * phase moved on either way), false when there was nobody to throw to.
   */
  distributePass(): boolean {
    const s = this.op;
    if (!s || this.phase !== 'OPEN_PLAY' || s.ball.live) return false;
    const target = this.echelonTarget();
    if (!target) return false;
    const order = [9, 10, 12, 13, 11, 14, 15];
    const gap = order.indexOf(target.num) - order.indexOf(s.carrierNum);
    return this.doPassToNum(target.num, gap > 1);
  }

  /**
   * Address a pass to a numbered shirt instead of a side. The receiver must
   * be one of the live pass options (the reviewed context still applies), so
   * a number nobody can legally reach throws nothing and says why.
   */
  doPassToNum(num: number, cutOut: boolean): boolean {
    return throwPassToNum(this, num, cutOut);
  }

  refreshPassOptions() {
    const gate = this.forwardAttackGates();
    const signature = (options: readonly PassOption[]): string => options
      .map((option) => `${option.player.team}${option.player.num}:${option.side}:${option.rank}:${option.priority}`)
      .join('|');
    /* SPEC_02 GATE: capture the derived state before its single replacement. */
    const before = { passOpts: signature(this.passOpts) };
    if (!this.op || this.bc.free) {
      this.passOpts = [];
      this.checkForwardAttackState(gate, 'Director.refreshPassOptions:clear', before,
        { passOpts: signature(this.passOpts) }, ['passOpts']);
      return;
    }
    const car = this.L(this.op.attacking, this.op.carrierNum);
    const forwardContext = !this.isHuman(this.op.attacking) ? {
      enabled: true,
      attackDirection: (this.op.dir < 0 ? -1 : 1) as -1 | 1,
      noteRejection: () => this.notePassCandidateRejected(),
    } : undefined;
    const next = passOptions(car, this.live, this.op.open, false, 0, forwardContext, gate);
    this.passOpts = next;
    this.checkForwardAttackState(gate, 'Director.refreshPassOptions:replace', before,
      { passOpts: signature(this.passOpts) }, ['passOpts']);
  }

  upOpen(dt: number, _input: Input, pressed: Set<string>, released = new Set<string>()) { /* T-03: engine/open */ return upOpen(this, dt, _input, pressed, released); }


  contextLabel(s: OpenPlayState): string { /* T-03: engine/open */ return contextLabel(this, s); }


  doStep(dt: number) { /* T-03: engine/open */ return doStep(this, dt); }


  doFend() { /* T-03: engine/open */ return doFend(this); }


  doDummy() { /* T-03: engine/open */ return doDummy(this); }
  doDive() { /* T-03: engine/open */ return doDive(this); }


  /**
   * A pass is always thrown to a named player, always forward of the passer,
   * and always into the path of a man who is already moving.
   */
  doPass(side: -1 | 1, cutOut: boolean) { /* T-03: engine/open */ return doPass(this, side, cutOut); }


  lastCall: PlayCall | null = null;
  /** the side that last fielded a kick, and when — they run it back (T-18) */
  receipt: { team: 'A' | 'B'; at: number } | null = null;
  lastCallSucceeded = true;
  cpuPlan: { label: string; instruction: string } | null = null;

  /**
   * CPU attack. A called play per phase, chosen from the field position, the
   * shape the side is playing, the tactic sliders and the archetype, then
   * escalated rather than repeated when it is shut down. This is what makes the
   * CPU look like a side playing rugby instead of one pass and a tackle.
   */
  private cpuCallPlay() {
    if (!this.op) return;
    const gate = this.forwardAttackGates();
    const t = this.op.attacking;
    const arch = AI_ARCHETYPES[this.teams[t].archetype] ?? AI_ARCHETYPES['IRONSIDE TECHNICAL'];
    const shape = this.shapeOf(t);
    const toLine = this.op.dir > 0 ? FIELD.tryZFar - this.op.carrierZ : this.op.carrierZ - FIELD.tryZ;
    const trailing = (this.teams[this.defending()].score - this.teams[t].score) > 0 && this.minute > 60;
    const urgency = trailing ? 1 : this.minute > 75 ? 0.7 : 0.15;
    /* T-18. The side that has just fielded a kick runs it back — real sides
     * counter-attack or work it out of their half rather than instantly
     * kicking on the first phase. Without this the match was a perpetual
     * kick-exchange locked in the WIDE call zone: deep position → kick calls
     * → deep position. The escalation ladder is bypassed too (lastCall null):
     * the fielding side did not fail at anything, and 3 of the ladder's 4
     * rungs are kicks. */
    const justFielded = this.receipt && this.receipt.team === t && this.t - this.receipt.at < 7;
    const kickBiasAdj = justFielded ? -80 : this.slider(t, 'kickFreq');
    const chosen = callPlay(
      zoneOf(toLine), this.op.phase, shape, arch,
      kickBiasAdj, this.slider(t, 'width'),
      justFielded ? null : this.lastCall, this.lastCallSucceeded, urgency,
    );
    /* SPEC_02 GATE: snapshot all call-state scalars before the call commit. */
    const before = {
      lastCall: this.lastCall ?? null,
      lastCallZ: this.lastCallZ,
      lastCallX: this.lastCallX,
      cpuPlan: this.cpuPlan ? `${this.cpuPlan.label}\u0000${this.cpuPlan.instruction}` : null,
      aiPlay: this.op.aiPlay,
    };
    const focus = this.focusPoint();
    this.lastCall = chosen.call;
    this.lastCallZ = focus.z;
    this.lastCallX = focus.x;
    this.cpuPlan = chosen.plan;
    this.op.aiPlay = chosen.call;
    this.checkForwardAttackState(gate, 'Director.cpuCallPlay:commit', before, {
      lastCall: this.lastCall ?? null,
      lastCallZ: this.lastCallZ,
      lastCallX: this.lastCallX,
      cpuPlan: this.cpuPlan ? `${this.cpuPlan.label}\u0000${this.cpuPlan.instruction}` : null,
      aiPlay: this.op.aiPlay,
    }, ['lastCall', 'lastCallZ', 'lastCallX', 'cpuPlan', 'aiPlay']);
    this.say(`CALL — ${chosen.plan.label}`);
  }

  cpuCarrier(dt: number, s: OpenPlayState) { /* T-03: engine/open */ return cpuCarrier(this, dt, s); }


  /* ============================ BREAKDOWN ============================ */

  startBreakdown(tacklerNum?: number) {
    this.releaseBallControl();
    return startBreakdown(this, tacklerNum);
  }


  upBreakdown(dt: number, _input: Input, pressed: Set<string>) { /* T-03: engine/breakdown */ return upBreakdown(this, dt, _input, pressed); }


  clearRuck() { /* T-03: engine-internal */
    for (const p of this.live) {
      /* only a man who was actually ON THE GROUND has to get up; the rest of
       * the ruck were on their feet and can go straight back to work. */
      if (p.down) p.recoverT = RECOVER_SECONDS;   // cleared by releaseAll on a whistle
      p.down = false; p.bound = false;
    }
    this.bd = undefined;
    /* T-80 — tackle completed: every bind releases (RECYCLE reason). */
    this.latches.clear('RECYCLE');
  }

  /**
   * Run the get-up lock for every player, once per frame, before think().
   * Velocity is hard-zeroed here rather than trusted to the steering, so no
   * later writer can slide a man who is still on the floor.
   */
  /**
   * Run the committed-dive clock. A diving defender is airborne: he keeps the
   * velocity he launched with, he cannot steer, and when he lands he has
   * either got hands on someone or he has missed and eats dirt.
   *
   * Runs before think() for the same reason tickRecovery does — so a man who
   * has just landed is already locked when the AI is asked where he should go.
   */
  /** Request the Space jump for the currently controlled upright runner. */
  tryJump(): boolean {
    if (this.phase !== 'OPEN_PLAY') return false;
    const p = this.ctrlPlayer;
    if (!p || !this.isHuman(p.team) || p.down || p.bound || p.sinbin > 0
      || (p.recoverT ?? 0) > 0 || (p.diveT ?? 0) > 0 || p.latchedBy || p.latchingOnto
      || (p.jumpY ?? 0) > 0.01) return false;
    if (Math.hypot(p.vx, p.vz) < JUMP_MIN_SPEED) return false;
    p.jumpY = 0.001;
    p.jumpVY = JUMP_IMPULSE;
    p.clip = 'jump';
    p.clipT = 0;
    return true;
  }

  /** Integrate jump height after horizontal movement has been resolved. */
  tickJump(dt: number) {
    for (const p of this.live) {
      const y = p.jumpY ?? 0;
      if (y <= 0 && !(p.jumpVY && p.jumpVY > 0)) {
        p.jumpY = 0;
        p.jumpVY = 0;
        continue;
      }
      p.jumpVY = (p.jumpVY ?? 0) - JUMP_GRAVITY * dt;
      p.jumpY = y + (p.jumpVY ?? 0) * dt;
      if ((p.jumpY ?? 0) <= 0) {
        p.jumpY = 0;
        p.jumpVY = 0;
        if (p.clip === 'jump') { p.clip = 'ready'; p.clipT = 0; }
      } else {
        p.clip = 'jump';
        p.clipT += dt;
      }
    }
  }

  tickDive(dt: number) {
    /* A dive only exists inside open play. Once a breakdown, a set piece or a
     * whistle has taken over, the phase owns the player — `latch` and `bound`
     * were both writing airborne men (928 and 698 frames), which is what made
     * the "locked trajectory" test report 177 deg of drift. Landing the dive
     * here also stops the miss penalty firing on a man who is already in a
     * ruck, which accounted for every unpunished miss. */
    if (this.phase !== 'OPEN_PLAY') {
      for (const p of this.live) {
        if ((p.diveT ?? 0) > 0) {
          p.diveT = 0;
          if (p.clip === 'dive') { p.clip = 'ready'; p.clipT = 0; }
        }
      }
      return;
    }
    for (const p of this.live) {
      const t = p.diveT ?? 0;
      if (t <= 0) continue;
      /* hands on already: the dive did its job, land him without penalty */
      if (p.latchingOnto) {
        p.diveT = 0;
        if (p.clip === 'dive') { p.clip = 'ready'; p.clipT = 0; }
        continue;
      }
      const left = t - dt;
      if (left > 0) { p.diveT = left; continue; }
      p.diveT = 0;
      /* HANDS ON? The latch is the only success condition — it is what the
       * dive was for. Anything else is a miss. */
      if (p.latchingOnto) { if (p.clip === 'dive') { p.clip = 'ready'; p.clipT = 0; } continue; }
      /* MISSED. He is on the floor and out of the defensive line until he is
       * back on his feet — the cost that makes diving a decision rather than
       * a free action. Reuses the get-up lock so there is ONE way to be down
       * and getting up, rather than two subtly different ones. */
      p.recoverT = DIVE_MISS_RECOVERY;
      p.vx = 0; p.vz = 0;
      p.clip = 'getup'; p.clipT = 0;
      p.beatenT = Math.max(p.beatenT, 0.4);   // cannot instantly re-tackle
    }
  }

  tickRecovery(dt: number) {
    /* The lock is an OPEN-PLAY concept. Every other phase either pins players
     * itself (scrum, lineout, kick, maul) or is walking them to a mark, and a
     * man frozen on the turf would stall it. Rather than trust every teardown
     * path to have called releaseAll — several do not, which showed up as
     * 4134 frames of a recovering man being steered — the invariant is
     * enforced here, in the one place the timer is read. */
    if (this.phase !== 'OPEN_PLAY') {
      for (const p of this.live) {
        if ((p.recoverT ?? 0) > 0) {
          p.recoverT = 0;
          p.recoverX = undefined; p.recoverZ = undefined;
          if (p.clip === 'getup') { p.clip = 'ready'; p.clipT = 0; }
        }
      }
      return;
    }
    for (const p of this.live) {
      const t = p.recoverT ?? 0;
      if (t <= 0) continue;
      const left = t - dt;
      if (left <= 0) {
        p.recoverT = 0;
        p.recoverX = undefined; p.recoverZ = undefined;
        if (p.clip === 'getup') { p.clip = 'ready'; p.clipT = 0; }
        continue;
      }
      p.recoverT = left;
      p.vx = 0; p.vz = 0;
      /* ANCHOR THE MARK, not just the velocity.
       *
       * Zeroing vx/vz only stops the integrator. Any code that writes p.x/p.z
       * DIRECTLY — the release retreat, a separation push, a set-piece slot
       * write — moves him anyway, and the probe found 581 m of drift on men
       * whose clip said 'getup' with no owning writer at all. Latching the
       * spot he went down on and restoring it every frame makes the lock mean
       * "he is HERE until he is up", which is what the animation shows. */
      /* Anchor him to the spot he went down on, but let the anchor itself be
       * DRAGGED by anything that legitimately needs him elsewhere. A hard pin
       * stopped the retreat entirely and offside episodes rose 105 -> 154 a
       * match, because a man frozen in front of the mark keeps his whole side
       * offside while the line tries to reset around him. Re-seating the
       * anchor on whatever position survived the frame keeps the foot-plant
       * (he is not being flung about) while still allowing the slow correction
       * a referee would expect him to make. */
      if (p.recoverX === undefined) { p.recoverX = p.x; p.recoverZ = p.z; }
      const ax = p.recoverX, az = p.recoverZ ?? p.z;
      const drift = Math.hypot(p.x - ax, p.z - az);
      if (drift <= RECOVER_ANCHOR_SLACK) { p.x = ax; p.z = az; }
      else { p.recoverX = p.x; p.recoverZ = p.z; }
      if (p.clip !== 'getup') { p.clip = 'getup'; p.clipT = 0; }
    }
  }

  /**
   * Release every player from every phase-bound state and tear down all phase
   * objects. Anything that interrupts a phase — a penalty, a score, a tutorial
   * jump — must call this or it will leave players frozen where they stood.
   */
  releaseAll() {
    this.releaseBallControl();
    /* TEARDOWN HARDENING — the purge is UNCONDITIONAL. The old shape kept an
     * active drag's links alive across the whistle (advantage play-on), and a
     * second whistle landing before the play-on resolved then raced the
     * top-level leak guard: the stranded pair kept the 28% drag tax and the
     * stale kinematics into the restart formation, one rapid-whistle edge
     * case at a time. A whistle ends the contest — every lattice weld, every
     * bound state, every drag link across all thirty entities, gone on the
     * whistle frame itself. Advantage re-seeds through the ordinary contest
     * entry when play resumes. Idempotent, so frame-adjacent stoppages purge
     * the fresh bind set exactly like the first. */
    this.lastTeardownResidual = teardownBreakdown(this, 'WHISTLE');
    for (const p of this.live) {
      p.down = false;
      p.bound = false;
      p.carrier = false;
      p.urgency = 0.6;
      /* A whistle outranks the get-up lock: the man has to walk to a scrum or
       * a lineout mark now, and holding him on the floor would stall the set
       * piece. Cancelling here (rather than letting `steer` fight the lock)
       * keeps the ownership contract honest — measured 4134 frames of a
       * recovering man being steered before this was added. */
      p.recoverT = 0;
      p.recoverX = undefined; p.recoverZ = undefined;
      p.jumpY = 0; p.jumpVY = 0;
      if (p.clip === 'grounded' || p.clip === 'tackle' || p.clip === 'getup' || p.clip === 'jump') { p.clip = 'ready'; p.clipT = 0; }
    }
    this.bd = undefined;
    this.ml = undefined;
    this.scrim = undefined;
    this.lo = undefined;
  }

  /* ============================ MAUL ============================ */

  startMaul(team: 'A' | 'B', x: number, z: number, ranks = MAUL_RANKS_PER_SIDE, fromLineout = false) {
    this.releaseBallControl();
    const dir = team === 'A' ? 1 : -1;
    const def: 'A' | 'B' = team === 'A' ? 'B' : 'A';
    this.possession = team;
    /* SPEC_03 — a maul can now form directly out of open play (the held-up
     * trigger in engine/breakdown.ts): the open episode is over in the same
     * breath. The carrier is a BOUND man from here on, so the episode and
     * its carrier flag must retire with it — the watchdog's upright-carrier
     * check owns op's world, never the maul's. */
    if (this.op) {
      for (const p of this.live) p.carrier = false;
      this.op = undefined;
    }
    this.clearRuck();
    /* SPEC_03 — the formation teardown funnel. A maul can form straight off
     * the tackle latch (the held-up trigger in engine/breakdown.ts), and the
     * drag link it grew out of must die ON the formation frame, exactly like
     * a whistle — the maul's own bind replaces it in the same breath. */
    this.lastTeardownResidual = teardownBreakdown(this, 'MAUL_FORM');
    /* SIN BIN — a carded man never binds into a maul. The loop used to bind
     * shirts 1-8 of both sides unconditionally, which handed a man who is
     * standing on the touchline serving ten minutes a rank in the drive and
     * a `bound` flag that no teardown would clear until the maul ended. */
    for (let i = 1; i <= 8; i++) {
      const a = this.L(team, i); if (a.sinbin <= 0) a.bound = true;
      const b = this.L(def, i); if (b.sinbin <= 0) b.bound = true;
    }
    /* SPEC_03 — THE KINEMATIC CLUSTER. The two packs lock in as one
     * aggregate body: every bound player's mass and forward-directed drive
     * vector are summoned here, and from this frame the cluster displaces
     * kinematically (F_net / Σm through the capped funnel), never by
     * position writes. */
    const bound = buildMaulBinds(this, team, ranks);
    /* SPEC_03. The re-gate has exactly one human contender. CPU-v-CPU and a
     * future human-v-human match retain deterministic attacking control rather
     * than borrowing a human result that does not exist. */
    const exactlyOneHuman = this.isHuman(team) !== this.isHuman(def);
    const humanTeam = exactlyOneHuman ? (this.isHuman(team) ? team : def) : null;
    this.ml = {
      t: 0, stage: humanTeam ? 'RE_GATE' : 'ATTACK_CONTROL', x, z, dir, yaw: 0,
      forceA: 2600 + this.teams[team].nation.att.maul * 26,
      forceD: 2400 + this.teams[def].nation.att.maul * 24,
      ballRank: 1, ranks, speed: 0, gained: 0,
      stallClock: 0, stoppedOnce: false, useItCalled: false, warned: false,
      tryLineZ: dir > 0 ? FIELD.tryZFar : FIELD.tryZ, attacking: team,
      committed: 5,
      bound, clusterMass: maulClusterMass(bound), channelT: 0, collapsed: false,
      humanTeam, contest: humanTeam ? 'PENDING' : 'ATTACK_CONTROL',
      regateWindowT: 0, regateCandidate: null, regateWindows: [],
      humanWinShare: null, humanWon: null,
      exit: 'NONE', exitT: 0, exitRunner: 0, exitLane: null, exitX: x, exitZ: z,
      fromLineout,
    };
    this.phase = 'MAUL';
    if (fromLineout) this.say('CAUGHT, AND THE MAUL IS FORMED');
    this.setCtrl(humanTeam ?? team, humanTeam === def ? 7 : 8, false);
    if (humanTeam) this.showHint('A/D ALTERNATE — FOUR BEATS TO WIN THE MAUL', 3);
  }

  upMaul(dt: number, input: Input, pressed: Set<string>) { /* T-03: engine/setpieces */ return upMaul(this, dt, input, pressed); }


  /* ======================== SET-PIECE LEDGERS ======================== */

  /** Record one physical award/start, before any contest outcome is known. */
  recordSetPieceEvent(piece: keyof SetPieceEvents) {
    this.setPieceEvents[piece]++;
  }

  /**
   * Record a result without deriving an occurrence from it. Existing team-stat
   * win/loss fields remain the presentation-compatible mirror of this outcome
   * ledger; `setPieceEvents` is the sole source for match-total attempts.
   */
  recordSetPieceOutcome(piece: keyof SetPieceEvents, winner: 'A' | 'B' | null, loser: 'A' | 'B' | null = null) {
    if (winner) {
      this.setPieceWins[piece][winner]++;
      if (piece === 'scrums') this.teams[winner].stats.scrumsWon++;
      else this.teams[winner].stats.lineoutsWon++;
    }
    if (loser) {
      if (piece === 'scrums') this.teams[loser].stats.scrumsLost++;
      else this.teams[loser].stats.lineoutsLost++;
    }
  }


  /* ============================ SCRUM ============================ */

  scrumSlots(feed: 'A' | 'B', ax: number, az: number): ScrumSlot[] { /* T-03: engine/setpieces */ return scrumSlots(this, feed, ax, az); }


  startScrum(feed: 'A' | 'B', x: number, z: number) {
    this.releaseBallControl();
    this.possession = feed;
    // An award is one scrum even if it resets, ends in a penalty, or is stolen.
    this.recordSetPieceEvent('scrums');
    const zn = clamp(z, -45, 45);
    this.scrumAnchor = { x: clamp(x, -18, 18), z: zn };
    const mk = (t: 'A' | 'B'): Pack => ({
      force: 0, forceTransmitted: 0, waggle: 0,
      fitness: this.teams[t].nation.att.scrum * (0.85 + this.avgStamina(t) / 500),
    });
    this.scrim = {
      t: 0, stage: 'ASSEMBLE', outcome: 'PENDING', feed,
      players: this.scrumSlots(feed, this.scrumAnchor.x, this.scrumAnchor.z),
      nine: [
        /* PLAYTEST 4 — THE NINE STANDS AT THE BASE. The old marks (x+/-2.1,
         * z-/+1.0) put each scrum-half INSIDE the put-in mouth — the user
         * watched him "suddenly have the ball where he put it in". These are
         * real base positions: a stride behind his own hindmost row (the
         * rows end at back*1.94), on the axle. The OUT hand-off mark in
         * setpieces matches these exactly. */
        { team: 'A', x: this.scrumAnchor.x - 0.3, z: this.scrumAnchor.z - 2.95 },
        { team: 'B', x: this.scrumAnchor.x + 0.3, z: this.scrumAnchor.z + 2.95 },
      ],
      ball: { x: 0, y: 0.16, z: 0, state: 'OUT' },
      packs: { A: mk('A'), B: mk('B') },
      yaw: 0, netDrive: 0, collapseRisk: 0, tunnelV: 0,
      strikeClock: 0, wheelDir: R() < 0.5 ? -1 : 1, resets: 0,
      ready: 0, cadence: '',
    };
    this.clearRuck();
    this.lo = undefined; this.ml = undefined; this.op = undefined;
    this.phase = 'SCRUM';
    this.say(`SCRUM TO ${this.teams[feed].nation.short}`);
    if (this.isHuman(feed)) this.showHint('PLAYERS ARE FORMING — POUND A/D WHEN THE REF CALLS ENGAGE', 3);
    this.setCtrl(feed, 9, false);
  }

  private avgStamina(t: 'A' | 'B') {
    const list = this.live.filter((p) => p.team === t && FORWARDS.includes(p.num));
    return list.reduce((n, p) => n + p.stamina, 0) / Math.max(1, list.length);
  }

  upScrum(dt: number, input: Input, pressed: Set<string>) { /* T-03: engine/setpieces */ return upScrum(this, dt, input, pressed); }


  /* ============================ LINEOUT ============================ */

  /* FORWARD PACK — the lineout is thrown to the LOCKS. The line is three
   * pods front to tail (1·4·3 / 5·6 / 8·7): the locks are the front and
   * middle jumpers with a prop in front and behind each of them as lifters,
   * the eight is the tail jumper. `LINE_B` is the same shape minus the 7,
   * who stays out of the line as the roving tackler. Authored once in
   * engine/forwardPack.ts. */
  static readonly LINE_A = LINEOUT_LINE_THROWING;
  static readonly LINE_B = LINEOUT_LINE_DEFENDING;
  static readonly LO_CALLS = [
    { kind: 'FRONT', label: 'FRONT BALL', targetX: -1.8, jumpers: 4 },
    { kind: 'MIDDLE', label: 'MIDDLE + DRIVE', targetX: -3.4, jumpers: 5 },
    { kind: 'OFF_TOP', label: 'OFF THE TOP', targetX: -4.6, jumpers: 5 },
    { kind: 'TAIL', label: 'TAIL BALL', targetX: -6.6, jumpers: 7 },
  ];

  startLineout(thrower: 'A' | 'B', z: number, x: number) {
    this.releaseBallControl();
    this.possession = thrower;
    // A not-straight rethrow earns a new call to this method and a new event.
    this.recordSetPieceEvent('lineouts');
    const zn = clamp(z, FIELD.tryZ + 6, FIELD.tryZFar - 6);
    const side = x >= 0 ? 1 : -1;
    const players: LineoutState['players'] = [];
    let id = 1;
    for (const t of ['A', 'B'] as const) {
      /* TACTICAL KICKING / SIN BIN — a carded man is OFF THE FIELD, so he
       * never takes a place in the line. Filtering the roster here (rather
       * than skipping him downstream) means a 14-man side genuinely fields a
       * shorter lineout instead of leaving a gap where a body should be. */
      const nums = (t === thrower ? Director.LINE_A : Director.LINE_B)
        .filter((n) => this.L(t, n).sinbin <= 0);
      for (let i = 0; i < nums.length; i++) {
        players.push({
          id: id++, num: nums[i], team: t,
          x: side * (30 - i * 0.62), z: zn + (t === 'A' ? -0.7 : 0.7),
          /* FORWARD PACK — role by SHIRT, not by position in the line: the
           * locks (and the eight) jump, the props and flankers lift. */
          handY: 0, role: lineoutRole(nums[i]),
        });
      }
    }
    /* SIN BIN — if the hooker or the nine is in the bin somebody else does
     * the job, exactly as a real side reshuffles. A lineout with no thrower
     * would hang the phase, which is the freeze class the watchdog exists to
     * catch and the roster should never create. */
    const fit = (want: number, alts: number[]) =>
      this.L(thrower, want).sinbin <= 0 ? want
        : (alts.find((n) => this.L(thrower, n).sinbin <= 0) ?? want);
    const throwerNum = fit(2, [1, 3, 7, 6, 9]);
    const nineNum = fit(9, [10, 12, 15]);
    players.push({ id: id++, num: throwerNum, team: thrower, x: side * 33.5, z: zn, handY: 1.6, role: 'THROWER' });
    players.push({ id: id++, num: nineNum, team: thrower, x: side * 20, z: zn + (thrower === 'A' ? -6 : 6), handY: 0, role: 'SCRUMMY' });
    this.lo = {
      t: 0, stage: 'ASSEMBLE', markZ: zn, side,
      call: { targetX: side * 28.4, label: Director.LO_CALLS[1].label, jumpers: 5, kind: 'MIDDLE' },
      ball: { ...makeBall(side * 33.5, 1.6, zn), state: 'HELD', heldBy: 0, apexY: 0 },
      players, history: [], winner: false, contestMargin: 0,
      thrower, quality: 0.5, callIdx: 1, meter: 0.5, meterDir: 1, meterOn: false,
      throwAngle: 0, throwCrooked: false,
      driveCall: true, ready: 0,
    };
    this.clearRuck();
    this.scrim = undefined; this.ml = undefined; this.op = undefined;
    this.phase = 'LINEOUT';
    this.say(`LINEOUT TO ${this.teams[thrower].nation.short}`);
    if (this.isHuman(thrower)) this.showHint('A/D CHOOSE THE CALL · SPACE TO THROW · STOP THE BAR IN THE BAND', 3.4);
    this.setCtrl(thrower, 10, false);
  }

  upLineout(dt: number, input: Input, pressed: Set<string>) { /* T-03: engine/setpieces */ return upLineout(this, dt, input, pressed); }


  releaseThrow() { /* T-03: engine/setpieces */ return releaseThrow(this); }


  /* ============================ KICK ============================ */

  startKick(team: 'A' | 'B', type: KickType, at?: { x: number; z: number }, carrierNum?: number) {
    /* SPEC_07: a restart-of-play kickoff (kick-off, restart after a score,
     * 22-metre drop-out) is THE play reset — the try lock clears here and
     * only here on the kick path. A GOAL kick does NOT clear it: the
     * conversion belongs to the try sequence it follows, and a duplicate
     * trigger anywhere inside the try-fanfare-conversion window must still
     * be rejected. */
    if (type === 'RESTART' || type === 'DROP_OUT') this.tryLock = null;
    this.possession = team;
    const dir = team === 'A' ? 1 : -1;
    const x = at?.x ?? 0;
    const z = at?.z ?? 0;
    /* T-08: the kick being struck is an event — the rig drops onto the
     * kicker's shoulder for the strike and the chase reads in one shot. */
    if (type !== 'GOAL') this.emitEv({ t: this.t, type: 'KICK', x, z });
    // the designated kicker, from the squad sheet, takes every goal kick
    const num = type === 'GOAL' ? this.teams[team].kicker : (carrierNum ?? this.teams[team].kicker);
    const atGoal = type === 'GOAL' || type === 'DROP_GOAL';
    const goalZ = dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
    const dx = Math.max(0, Math.abs(goalZ - z));
    const goalDistance = Math.hypot(dx, Math.abs(x) * 0.9);
    const goalAngle = Math.abs(Math.atan2(Math.abs(x) + 3.1, Math.max(4, dx)) * (180 / Math.PI) - 45) * 2;
    const acc = this.L(team, num).attrs.SKL;
    const base = clamp(0.92 - goalDistance / 78 - goalAngle / 210 + (acc - 60) / 320, 0.05, 0.96);
    const labels: Record<KickType, string> = {
      PUNT: 'TERRITORY PUNT', GRUBBER: 'GRUBBER INTO THE IN-GOAL', DROP_GOAL: 'DROP GOAL ATTEMPT',
      GOAL: 'SHOT AT GOAL', RESTART: 'RESTART KICK', DROP_OUT: '22 DROP OUT',
      BOMB: 'UP AND UNDER', FIFTY_22: '50:22 ATTEMPT',
    };
    /* T-32. A conversion after a try is not a live kick — it begins with fanfare
     * and a walk to the tee, and only then does the button become active. */
    const isConversion = type === 'GOAL' && this.lastScorer?.kind === 'TRY';
    const fromHand = !!this.op && this.op.attacking === team && type !== 'GOAL'
      && type !== 'RESTART' && type !== 'DROP_OUT' && !this.penaltyTouchKick;
    const body = makeBall(x, BALL_MAJOR, z);
    if (fromHand) weldBall(body, this.L(team, num));
    else { body.q.z = Math.SQRT1_2; body.q.w = Math.SQRT1_2; }
    // A live kick releases on launch; the tee has no carrier momentum.
    body.socket = null;
    this.releaseBallControl();
    this.kk = {
      t: 0, stage: isConversion ? 'FANFARE' : 'AIM', type,
      bx: body.x, by: body.y, bz: body.z, vx: 0, vy: 0, vz: 0, body, fromHand,
      dir, kicker: team, kickerNum: num, kickerName: this.teams[team].players[num - 1].name,
      history: [], profile: { label: labels[type], atGoal },
      goalProb: atGoal ? base : 0, goalDistance, goalAngle,
      hangTime: 0, apex: 0, distance: 0,
      power: 0, accuracy: 0.5, meter: 0, meterDir: 1, meterOn: true,
      aim: 0, landX: x, landZ: z + dir * 30,
      bounces: 0, result: '', chasers: [], form: undefined, formReady: 0,
      fromPenalty: this.penaltyTouchKick,
      markX: x, markZ: z, tenCrossed: false,
      /* TACTICAL KICKING — the touch/mark law bookkeeping starts clean on
       * every strike; the FLIGHT loop latches into it. */
      groundBounces: 0, defTouched: false,
      fromOwn22: insideOwnTwentyTwo(dir > 0 ? 1 : -1, z),
    };
    this.penaltyTouchKick = false;
    this.phase = 'KICK';
    this.op = undefined; this.bd = undefined;
    /* T-80 — a whistle/restart never leaves a frame of bind behind. */
    this.latches.clear('WHISTLE');
    this.teams[team].stats.kicks++;
    this.run(team, num).kicks++;
    if (type === 'RESTART' || type === 'DROP_OUT') this.kickoffFormation(team, z);
    this.setCtrl(team, num, false);
    this.L(team, num).job = 'STRIKE IT LONG AND GET THE CHASE ON';
    if (this.isHuman(team)) this.showHint('A/D AIM · SPACE SETS POWER · SPACE AGAIN SETS ACCURACY', 3.4);
  }

  /**
   * Law 12 — the kick-off.
   *   The ball is placed on the centre of the halfway line.
   *   All of the kicking team's players must be behind the ball when it is kicked.
   *   The receiving team must be behind their ten-metre line, and their kick-off
   *   does not start until the ball reaches that line.
   *
   * A 22-metre drop-out is taken from anywhere on the 22-metre line, so that is
   * a different mark. This is the single most visible thing in a rugby game and
   * it was being taken from the wrong goal line.
   */
  private kickoffFormation(kicker: 'A' | 'B', mark: number) {
    const dir = kicker === 'A' ? 1 : -1;
    const receiver: 'A' | 'B' = kicker === 'A' ? 'B' : 'A';

    /* Slot targets, in team shape. The kicking side forms its chase pods
     * behind the ball; the receiving side a 1-3-3-1 behind the ten-metre line
     * in their own half (the sign here was inverted once — the encroachment
     * the audit was reporting). */
    const slotsFor = (kicking: boolean) =>
      (kicking ? RESTART_KICK : RESTART_RECEIVE)
        .filter((s) => !(kicking && this.kk && s.num === this.kk.kickerNum))
        .map((s) => ({
          x: clamp(s.lat, -32, 32),
          z: kicking
            ? clamp(mark - dir * Math.abs(s.deep), -58, 58)
            : clamp(mark + dir * (10 + Math.abs(s.deep)), -58, 58),
        }));

    /* NO-TELEPORT / fast restarts: after a score both sides are spread across
     * the pitch and may be 45 m from halfway in z — the walk-on is long
     * enough without also marching a man 30 m across field to "his" shirt's
     * slot. Shirt-slot pairing is a convention, not a law: each player takes
     * the nearest of his side's vacant slots, so the SHAPE is identical but
     * the assembly is dramatically shorter. The ten metres is untouched. */
    const assign = (team: 'A' | 'B', kicking: boolean) => {
      const slots = slotsFor(kicking);
      const players = this.live.filter((p) => p.team === team && p.sinbin <= 0);
      const taken = new Array(slots.length).fill(false);
      for (const p of players) {
        let best = -1, bestD = Infinity;
        for (let i = 0; i < slots.length; i++) {
          if (taken[i]) continue;
          const dd = Math.hypot(slots[i].x - p.x, slots[i].z - p.z);
          if (dd < bestD) { bestD = dd; best = i; }
        }
        if (best < 0) continue;   // more players than slots (bin returns late)
        taken[best] = true;
        if (this.kk) this.kk.form!.push({ num: p.num, team, x: slots[best].x, z: slots[best].z });
      }
    };
    if (this.kk) { this.kk.form = []; this.kk.formReady = 0; }
    assign(kicker, true);
    assign(receiver, false);
  }

  upKick(dt: number, input: Input, _pressed: Set<string>) { /* T-03: engine/kick */ return upKick(this, dt, input, _pressed); }


  /**
   * How far this kick will actually travel, in metres. Real numbers: a punt from
   * hand tops out around 50 m, a grubber runs about 20, a drop goal is struck
   * from inside 45. The old model produced 37 m/s launch speeds and balls that
   * flew the length of the pitch, which is why kicks went too far.
   */
  kickReach(s: KickState, power: number): number {
    const p = clamp(power, 0, 1);
    const max = s.type === 'GRUBBER' ? 22
      : s.type === 'DROP_GOAL' ? 42
        : s.type === 'GOAL' ? 52
          : s.type === 'BOMB' ? 34
            : s.type === 'RESTART' || s.type === 'DROP_OUT' ? 44
              : 50;
    const min = s.type === 'GRUBBER' ? 5 : 9;
    return min + (max - min) * p;
  }

  /**
   * Accuracy is the kicker's, not the player's reflexes. His KCK rating sets the
   * floor. This is the fix for "a slight joystick wobble completely depletes the power".
   */
  kickerAccuracy(s: KickState): number {
    const k = this.L(s.kicker, s.kickerNum);
    const assist = this.isHuman(s.kicker) ? this.assists.kick : 0.5;
    return clamp(0.30 + (k.attrs.SKL / 100) * 0.6 + assist * 0.12, 0.15, 0.99);
  }

  launch(power: number, accuracy: number, wind = 0) { /* T-03: engine/kick */ return launch(this, power, accuracy, wind); }


  kickScored( /* T-03: engine-internal */s: KickState) {
    s.stage = 'RESULT'; s.result = 'SCORED';
    /* T-13. lastScorer was never cleared, so every PENALTY goal for the
     * rest of the half after any try was scored as a +2 "conversion" —
     * the try's conversion is the one GOAL kick launched while the
     * scorer is still the last scorer, i.e. before any restart. */
    const isConv = s.type === 'GOAL' && this.lastScorer?.kind === 'TRY' && this.conversionPending;
    if (s.type === 'GOAL') this.conversionPending = false;
    const pts = s.type === 'GOAL' ? (isConv ? POINTS.CONVERSION : POINTS.PENALTY) : POINTS.DROP_GOAL;
    this.teams[s.kicker].score += pts;
    /* AAA broadcast: a kick score must also be a spotlight. This also fixes
     * the lingering T-13 lastScorer hang — a penalty after a converted try no
     * longer attributes the +3 to the earlier try scorer. */
    this.lastScorer = {
      num: s.kickerNum,
      name: s.kickerName,
      team: s.kicker,
      min: this.minute,
      kind: isConv ? 'CONVERSION' : s.type === 'GOAL' ? 'PENALTY' : 'DROP',
    };
    this.events.push({ min: this.minute, team: s.kicker, kind: s.type, text: `${this.teams[s.kicker].nation.short} +${pts} — ${s.kickerName}` });
    this.commentate('KICK');
    this.banner_(`${this.teams[s.kicker].nation.short} +${pts} — ${s.kickerName}`);
    this.kk = undefined;
    this.restartAfterScore(s.kicker === 'A' ? 'B' : 'A');
  }

  kickMissed( /* T-03: engine-internal */s: KickState, why: string) {
    s.stage = 'RESULT'; s.result = 'MISSED';
    /* SPEC_07 — a missed conversion ends the try's set-piece window, exactly
     * as a made one does. Without this a subsequent penalty goal inherited
     * the pending conversion flag and was credited (and spotlighted) as +2. */
    if (s.type === 'GOAL') this.conversionPending = false;
    this.commentate('KICK', `— ${why}`);
    this.banner_('NO GOOD');
    this.kk = undefined;
    this.restartAfterScore(s.kicker === 'A' ? 'B' : 'A');
  }

  kickLanded(s: KickState) { /* T-03: engine/kick */ return kickLanded(this, s); }


  /* ============================ SCORES, PENALTIES, RESTARTS ============================ */

  scoreTry() { /* T-03: engine-internal */
    /* SPEC_07 Phase 1 — the idempotence guard. First trigger through the
     * gate locks scoring for this play sequence the millisecond the award
     * lands; any subsequent trigger (second physics check in the same frame,
     * a replay of the same grounding, an overlapping set-piece hand-off) is
     * rejected before a single point of state is touched. scoreTry() is
     * therefore mathematically idempotent per play. */
    if (this.tryLock) {
      this.noteTryGuardBlock();
      return;
    }
    const team = this.possession;
    const num = this.op?.carrierNum ?? (this.ml ? 8 : 8);
    /* SPEC_07 — capture and lock the touchdown coordinate BEFORE the
     * teardown touches anything. The grounding spot is the ball-carrier's
     * exact position at the instant the ball was pressed down (open play:
     * the live carrier; maul: the pack centre). A dive/lunge trigger that
     * fires within the reach tolerance short of the plane grounds ON the
     * goal line (Law 21.1's plane); a raw spot outside the in-goal bounds
     * is corrected onto them and the correction is surfaced in the
     * pause-panel log. */
    const dir: 1 | -1 = team === 'A' ? 1 : -1;
    const rawX = this.op?.carrierX ?? this.ml?.x ?? 0;
    const rawZ = this.op?.carrierZ ?? this.ml?.z ?? goalLineZ(dir);
    const spot = tryGroundingSpot(dir, rawX, rawZ);
    if (!spot.legal || spot.clamped) this.noteTryGroundingClamp(rawX, rawZ, spot.x, spot.z);
    this.trySpot = { x: spot.x, z: spot.z, team };
    this.tryLock = { at: this.t, team, num };
    /* TARCS — a try outranks any advantage still running: once points are on
     * the board the referee does not come back for the penalty. (Left alone,
     * the countdown expired through the conversion ritual and the wind-back
     * fired a penalty INTO the conversion setup — the same class of straggler
     * the "advantage taken clears pendingPenalty" fix exists for.) */
    if (this.advantage > 0 || this.pendingPenalty || this.advWatch) {
      this.advantage = 0;
      this.pendingPenalty = null;
      this.advWatch = null;
      this.pendingWindback = false;
      this.say('ADVANTAGE OVER — TRY SCORED');
    }
    const p = this.teams[team].players[num - 1];
    /* T-31. The scorer DIVES for the line (W-15/R-07) — a horizontal launch
     * that ends in a slide on the turf, not the grounded pose. Open play
     * only: a maul try is shoved over the line by eight men, not dived. */
    const scorer = this.op ? this.live.find((q) => q.team === team && q.num === num) : undefined;
    const lineBreak = this.op?.lineBreak === true;
    /* SPEC_07 — THE HARDENED TEARDOWN FUNNEL. A try freezes phase play: the
     * releaseAll() funnel runs teardownBreakdown() and purges every lattice
     * weld, bound body and drag link across all thirty entities before any
     * award state is written — the grounding frame itself guarantees 0
     * leaked joints, exactly like a whistle, and the scoring side starts the
     * conversion ritual with a clean board. */
    this.releaseAll();
    this.op = undefined;
    this.kk = undefined;
    if (scorer) { scorer.clip = 'dive'; scorer.clipT = 0; }
    this.teams[team].score += POINTS.TRY;
    this.run(team, num).metres += 20;
    this.lastScorer = { num, name: p.name, team, min: this.minute, kind: 'TRY' };
    this.conversionPending = true;
    this.events.push({ min: this.minute, team, kind: 'TRY', text: `TRY — ${p.name}` });
    this.momentum = clamp(this.momentum + (team === 'A' ? 1 : -1) * 0.3, -1, 1);
    /* T-08: the try is the loudest event of all. T-09: a try EARNED — seven
     * phases of build, or finished off a live line break — draws from the
     * TRY_BUILT bank, not the try-from-nothing pool. */
    this.emitEv({ t: this.t, type: 'TRY', x: spot.x, z: spot.z, num });
    const built = this.phasesGained >= 6 || lineBreak;
    this.commentate(built ? 'TRY_BUILT' : 'TRY', `— ${p.name}`);
    this.phasesGained = 0;
    this.gainWindow.length = 0;
    /* W-011. Every grounding in the corner goes upstairs: the on-field
     * decision is the try, the TMO shows the angle, and the conversion
     * ritual (FANFARE) holds until the check completes. The |x| >= 15 m
     * test is the corner channel — a try under the posts is never
     * checked, exactly as a real referee plays on. */
    const corner = Math.abs(spot.x) >= 15;
    if (corner) {
      this.tmo = { t: 0, name: p.name, short: this.teams[team].nation.short, angle: 18 + R() * 34, said: false };
      this.banner_(`ON-FIELD DECISION: TRY — TMO CHECKING THE GROUNDING`);
      this.say('REFEREE GOES TO THE TMO — GROUNDING IN THE CORNER');
    } else {
      this.banner_(`TRY! ${this.teams[team].nation.short} — ${p.name}`);
    }
    this.shake(0.7);
    /* SPEC_07 — the conversion tee: placed on the line through the locked
     * touchdown spot (x = x_try), backed up to the kicker's optimal range,
     * between 20 m and 30 m from the goal line. */
    this.startKick(team, 'GOAL', this.conversionTee(team, spot));
  }

  /** SPEC_07 — conversion placement. The tee sits on the line through the
   * touchdown spot (x = x_try) and is backed up along that line to the
   * kicker's optimal distance: 20 m from the goal line minimum, out to 30 m
   * for a kicker whose rating carries the longer strike. */
  private conversionTee(team: 'A' | 'B', spot: { x: number; z: number }): { x: number; z: number } {
    const dir = team === 'A' ? 1 : -1;
    const goal = goalLineZ(dir);
    const kicker = this.L(team, this.teams[team].kicker);
    const skill = kicker ? kicker.attrs.SKL : 60;
    const back = clamp(
      CONVERSION_TEE_MIN_M + (skill / 100) * (CONVERSION_TEE_MAX_M - CONVERSION_TEE_MIN_M),
      CONVERSION_TEE_MIN_M, CONVERSION_TEE_MAX_M,
    );
    return {
      x: clamp(spot.x, -TOUCH_IN_GOAL_X_M, TOUCH_IN_GOAL_X_M),
      z: goal - dir * back,
    };
  }

  /** Law 12 — a restart that fails to travel ten metres into the receiving
   * half (lands or rolls dead short of the ten-metre line, or is kicked
   * directly into touch before reaching it) is an infringement: the referee
   * awards a scrum to the receiving side at the centre spot. */
  restartInfringed(kicker: 'A' | 'B') {
    const receiver: 'A' | 'B' = kicker === 'A' ? 'B' : 'A';
    this.lawCall('RESTART_NOT_TEN', REFEREE_CALLS.RESTART_NOT_TEN, kicker);
    this.releaseAll();
    this.kk = undefined;
    this.say(`RESTART NOT TEN — SCRUM TO ${this.teams[receiver].nation.short} AT THE CENTRE`);
    this.startScrum(receiver, 0, 0);
  }

  /**
   * TACTICAL KICKING — LAW 18.11, THE MARK.
   *
   * "MARK!" The catcher has taken an opponent's kick cleanly on the full
   * inside his own 22 (or in-goal). The whistle goes, play FREEZES, and he
   * gets an unpressured free kick at the spot of the catch.
   *
   * The freeze is the existing `releaseAll` teardown every whistle uses —
   * a mark that only stopped the ball but left fifteen chasers running at
   * the catcher would be no protection at all — and the restart itself is
   * the ordinary free-kick path (`penaltyChoices(..., free = true)`), so a
   * mark inherits the tap, the kick to touch and the human's choice without
   * a second restart state machine.
   */
  markCalled(team: 'A' | 'B', num: number, x: number, z: number) {
    const dir = team === 'A' ? 1 : -1;
    const catcher = this.L(team, num);
    const mx = clamp(Number.isFinite(x) ? x : (catcher?.x ?? 0), -32, 32);
    /* A mark taken IN GOAL is brought out to the 22-metre line: a free kick
     * cannot be taken from in-goal (Law 18.11). */
    const inGoal = (z - dir * FIELD.tryZFar) * dir >= 0;
    const mz = clamp(inGoal ? ownTwentyTwoLineZ(dir) : z, -45, 45);
    this.lawCall('MARK', REFEREE_CALLS.MARK, team === 'A' ? 'B' : 'A');
    this.banner_('MARK');
    this.say(`MARK — ${this.teams[team].nation.short} TAKE THE FREE KICK`);
    this.kk = undefined;
    /* THE FREEZE. Every man is released from his phase and the episode is
     * torn down before the restart is staged, exactly as beginPenalty does:
     * a mark with a live ruck or a live chase behind it is not a mark. */
    this.releaseAll();
    this.possession = team;
    this.advantage = 0;
    this.advWatch = null;
    this.pendingPenalty = null;
    this.pendingWindback = false;
    this.markAward = { team, num, x: mx, z: mz, at: this.t };
    /* THE RESTART IS THE CATCHER'S. A free kick belongs to the man who made
     * the mark (Law 18.11), not to the nine, so this does not go through
     * `penaltyChoices` — it stages the ball with HIM, and the `protect`
     * window is the "unpressured" half of the award: the defence may not
     * touch him for the beat it takes to play it, which is exactly the
     * post-ruck protection window the engine already models. */
    this.quickTap = true;
    this.startOpen(team, mx, mz, catcher && catcher.sinbin <= 0 ? num : 9, 1, 0, 1.2);
    if (this.isHuman(team)) {
      this.showHint('MARK — FREE KICK. TAP AND GO, OR PUT IT DOWN THE FIELD', 3.2);
    }
  }

  /** The last mark awarded — read by the probe and the broadcast layer. */
  markAward: { team: 'A' | 'B'; num: number; x: number; z: number; at: number } | null = null;

  /** Law 12 — a drop-out is taken from anywhere on the 22-metre line. */
  private dropOut(team: 'A' | 'B') {
    this.startKick(team, 'DROP_OUT', { x: 0, z: team === 'A' ? -28 : 28 });
  }

  /** Held up in goal is a five-metre scrum to the attack, not a drop out. */
  touchDown(defender: 'A' | 'B' = this.defending()) {
    // If the ball is dead in goal without being grounded by the attack, the
    // defending side restarts with a drop-out from their own 22-metre line.
    this.say('DEAD IN GOAL — 22-METRE DROP OUT');
    this.dropOut(defender);
  }

  restartAfterScore(team: 'A' | 'B') {
    /* releaseAll, as documented on the method itself: a score interrupts the
     * phase, and any man still `down` from the try would otherwise never
     * retreat to the restart — the Law-12 gate then had to force the strike
     * past him, which is an encroachment the audit rightly flags. */
    this.releaseAll();
    this.startKick(team, 'RESTART', { x: 0, z: 0 });
  }

  pendingPenalty: { team: 'A' | 'B'; x: number; z: number; free: boolean } | null = null;

  /** Advantage is played wherever possible. Rage knew: penalties are not fun. */
  /** T-07 — when a card is shown. A player is off the field for ten match-minutes. */
  card(team: 'A' | 'B', num: number, reason: string) { /* T-03: engine module */ return card(this, team, num, reason); }

  /* ==================== TACTICAL KICKING — THE SIN BIN ====================
   *
   * A yellow card is not a flag on a player, it is a body LEAVING THE FIELD.
   * Before this the binned man kept standing wherever the whistle caught him:
   * every loop that filters on `sinbin <= 0` skipped him correctly, but the
   * separation pass, the camera framing and the renderer all still saw a
   * sixteenth body loitering in the defensive line. He is walked to the
   * touchline instead, held there for the duration, and brought back only at
   * a stoppage.
   */

  /** Eject a carded man to the touchline and strip every phase state he
   *  might have been holding. Called from `card()` on the whistle frame. */
  ejectToSinBin(team: 'A' | 'B', num: number) {
    const p = this.L(team, num);
    if (!p || p.team !== team || p.num !== num) return;
    const mark = sinBinMark(team, num, p);
    /* Every phase link he could be carrying dies with the card — a bound
     * scrum body, a latch, a dive, a get-up lock. Leaving any of them alive
     * would leave a ghost in a contest he is no longer part of. */
    p.bound = false;
    p.down = false;
    p.carrier = false;
    p.passRank = 0;
    p.beatenT = 0;
    p.diveT = 0;
    p.recoverT = 0;
    p.recoverX = undefined;
    p.recoverZ = undefined;
    p.latchedBy = null;
    p.latchingOnto = null;
    p.latchDrag = undefined;
    p.jumpY = 0;
    p.jumpVY = 0;
    p.vx = 0; p.vz = 0;
    p.urgency = 0;
    p.tx = mark.x; p.tz = mark.z;
    /* The mark is captured ONCE, at the card. Recomputing it every frame
     * from his live position would let the target chase him as he walked
     * (the mark is derived from where he left the field), which is a
     * feedback loop, not a walk to the touchline. */
    this.sinBinMarks.set(`${team}:${num}`, mark);
    p.job = 'SIN BIN — TEN MINUTES';
    p.clip = 'ready'; p.clipT = 0;
    if (this.op?.latch) {
      const l = this.op.latch;
      if ((l.carrierTeam === team && l.carrierNum === num)
        || (l.tacklerTeam === team && l.tacklerNum === num)) {
        clearLatch(this.op, this.L(l.carrierTeam, l.carrierNum), this.L(l.tacklerTeam, l.tacklerNum));
      }
    }
    /* If the stick was on him it goes to a team-mate who is actually on the
     * field — a human left steering a binned player is a dead controller. */
    if (this.ctrlPlayer === p) {
      const mate = this.live.find((q) => q.team === team && q.sinbin <= 0 && !q.down);
      if (mate) this.setCtrl(team, mate.num, false);
      if (this.roleLocked && this.roleLockTeam === team && this.roleLockNum === num && mate) {
        this.roleLockNum = mate.num;
      }
    }
  }

  /** Hold every binned man on the touchline, and bring back the ones whose
   *  ten minutes are up as soon as the ball is dead. Runs once per frame
   *  from placeBound's slot in the pipeline, so it is the sole writer of a
   *  binned body (think() already skips them). */
  /** The touchline spot each binned man was sent to, captured at the card. */
  private sinBinMarks = new Map<string, { x: number; z: number }>();

  private tickSinBin(dt: number) {
    for (const p of this.live) {
      if (p.sinbin > 0) {
        const key = `${p.team}:${p.num}`;
        let mark = this.sinBinMarks.get(key);
        if (!mark) {
          /* A bin set directly (a harness, a save reload) still gets a mark. */
          mark = sinBinMark(p.team, p.num, p);
          this.sinBinMarks.set(key, mark);
        }
        /* NO-TELEPORT: he WALKS off. The bin mark is a target like any
         * other; the step is bounded to a jog so a man carded in midfield
         * takes the seconds a walk to the line actually costs. */
        const gap = Math.hypot(mark.x - p.x, mark.z - p.z);
        if (gap > 0.25) {
          const step = Math.min(gap, 5.2 * dt);
          this.place(p, p.x + (mark.x - p.x) / gap * step, p.z + (mark.z - p.z) / gap * step, 'bound');
          p.clip = 'jog';
          p.clipT += dt;
        } else {
          p.vx = 0; p.vz = 0;
          if (p.clip !== 'ready') { p.clip = 'ready'; p.clipT = 0; }
          p.clipT += dt;
        }
        p.vx = 0; p.vz = 0;
        p.urgency = 0;
        p.job = `SIN BIN — ${Math.ceil(p.sinbin / 60)} MIN LEFT`;
        p.movedBy = 'bound';
        continue;
      }
      /* His time is served. The RETURN is a law event, not a timer event:
       * he comes back on at the next stoppage (Law 9.28), which the referee
       * module names once so the engine and the probe cannot disagree. */
      if (p.job.startsWith('SIN BIN')) {
        if (!sinBinMayReturn(p.sinbin, this.phase)) {
          p.job = 'SIN BIN — WAITING ON THE TOUCH JUDGE';
          p.vx = 0; p.vz = 0;
          p.urgency = 0;
          p.movedBy = 'bound';
          continue;
        }
        p.job = '';
        p.urgency = 0.6;
        /* He comes back ON. Leaving his target where he stood parked him on
         * the touchline until some later phase happened to give him a mark;
         * point him at the field so the run-on is visible and immediate.
         * think() takes him off this mark on its very next pass. */
        p.tx = clamp(p.x, -28, 28); p.tz = clamp(p.z, -58, 58);
        this.sinBinMarks.delete(`${p.team}:${p.num}`);
        this.say(`${this.teams[p.team].nation.short} ARE BACK TO FIFTEEN — ${p.num} RETURNS`);
        this.showHint(`BACK TO FIFTEEN — SHIRT ${p.num} RETURNS`, 2.4);
      }
    }
  }

  /** Shirts a side actually has on the field. 15 normally, 14 with a man in
   *  the bin — the number every phase roster, the HUD and the probe read. */
  activeCount(team: 'A' | 'B'): number {
    let n = 0;
    for (const p of this.live) if (p.team === team && p.sinbin <= 0) n++;
    return n;
  }


  /** Repeat-offence memory, keyed by side and shirt, stored in match seconds. */
  offenceLog = new Map<string, number>(); /* T-03: engine-internal */

  beginPenalty(team: 'A' | 'B', call: string, offenderNum: number, free = false) { /* T-03: engine/laws */ return beginPenalty(this, team, call, offenderNum, free); }


  resolvePenalty() { /* T-03: engine module */ return resolvePenalty(this); }


  quickTap = false;
  /** set just before a penalty kick to touch so the aim logic strikes for the line */
  penaltyTouchKick = false;

  penaltyChoices(team: 'A' | 'B', x: number, z: number, free: boolean) {
    const goalCalls = this.slider(team, 'goalCalls') / 100;
    const dir = team === 'A' ? 1 : -1;
    const dist = Math.abs((dir > 0 ? 50 : -50) - z);
    // human gets an instant quick tap; otherwise the CPU picks
    if (this.isHuman(team)) { this.quickTap = true; }
    if (!free && dist < 42 && !this.isHuman(team) && R() < goalCalls) {
      this.startKick(team, 'GOAL', { x, z });
      return;
    }
    if (!this.isHuman(team)) {
      const r = R();
      /* T-18. Outside kicking range a penalty is kicked to TOUCH — that is
       * where lineouts come from. The old 40/20/40 split taken from the
       * centre spot produced almost no territory and no lineouts. */
      if (r < (dist >= 42 ? 0.75 : 0.35) && !free) { this.penaltyTouchKick = true; this.startKick(team, 'PUNT', { x, z }); return; }
      if (r < 0.9 && !free) { this.startScrum(team, x, z); return; }
    }
    this.startOpen(team, x, z + dir * 1.5, 9, 1, 0, 0.6);
  }

  /** Human quick tap: available the instant the whistle goes. */
  takeQuickTap() {
    if (!this.quickTap) return;
    this.quickTap = false;
    const p = this.pendingPenalty;
    this.pendingPenalty = null;
    this.advantage = 0;
    this.advWatch = null;
    this.pendingWindback = false;
    const f = p ?? { x: this.focusPoint().x, z: this.focusPoint().z, team: this.possession as 'A' | 'B', free: false };
    this.say('QUICK TAP — AND THEY GO');
    this.startOpen(f.team, f.x, f.z, 9, 1);
  }

  endHalf() { /* T-03: engine module */ return endHalf(this); }


  resumeSecondHalf() { /* T-03: engine module */ return resumeSecondHalf(this); }


  endMatch() { /* T-03: engine module */ return endMatch(this); }


  /* ============================ REPLAY ============================ */

  enterReplay(phase: Phase) {
    this.replayOf = this.phase;
    this.phase = phase;
    this.replayTimer = 2.4;
    this.banner_('REPLAY');
  }
  private exitReplay() {
    if (!this.replayOf) return;
    this.phase = this.replayOf;
    this.replayOf = null;
  }

  /* ============================ SYNC TO ACTORS ============================ */

  private syncActors() {
    const chaos = this.chaos;
    for (let i = 0; i < 30; i++) {
      const p = this.live[i];
      const a = this.actors[i];
      a.rx = p.x; a.rz = p.z; a.ry = p.jumpY ?? 0; a.rf = p.face;
      const isLocal = this.ctrlPlayer === p && this.isHuman(p.team);
      const reticle = this.reticleAimPoint();
      /* A held LMB over a loose ball should pull the rendered hands to the
       * actual ball body, not to the ray's ground intercept. Once possession
       * exists the reticle becomes the aim again for passes and tackles. */
      const aim = isLocal && this.bcGrip && this.bc.free
        ? { x: this.bc.free.x, y: this.bc.free.y, z: this.bc.free.z }
        : reticle;
      a.aiming = isLocal && this.bcGrip;
      a.aimX = aim.x; a.aimY = aim.y; a.aimZ = aim.z;
      const task = this.ballBehaviour.tasks.get(`${p.team}:${p.num}`);
      const reading = this.ballBehaviour.read;
      const watching = eligibleToGather(p) && !p.carrier && reading
        && (task?.role !== 'RETREAT') && (task || reading.kind === 'HELD')
        && Math.hypot(p.x - reading.point.x, p.z - reading.point.z) < 28;
      a.ballLookX = watching ? this.ballBehaviour.read?.point.x : undefined;
      a.ballLookZ = watching ? this.ballBehaviour.read?.point.z : undefined;
      a.renderClip = p.clip; a.clipT = p.clipT; a.jitter = p.jitter;
      a.turnT = p.turnT ?? 0;
      a.size = p.size;
      a.num = p.num; a.team = p.team;
      a.ring = p.controlled ? 1 : (this.passOpts.some((o) => o.player === p) ? 2 : 0);
      /* CHAOS_SCRIM only streams the 14 participating bodies. */
      a.hidden = !!chaos && chaos.pool.indexOf(p) < 0;
    }
    /* SPEC_15 — the referee is streamed like any other actor, from state that
     * engine/referee.ts integrated. `rf` is the ±1 the puppet pipeline reads
     * for its initial bearing; the referee's true facing is the ball's, and
     * the renderer holds it there while his legs do something else. */
    const ref = this.actors[30];
    const r = this.ref;
    ref.rx = r.x; ref.rz = r.z;
    ref.rf = Math.cos(r.face) >= 0 ? 1 : -1;
    ref.renderClip = r.clip;
    ref.clipT = 0;
    ref.hidden = !!chaos;
  }

  /* ============================ SUBS & KITS ============================ */

  makeSub(team: 'A' | 'B', offNum: number): boolean {
    const tr = this.teams[team];
    const cap = Number(['0', '2', '3', '5', '7'][this.options.subs ?? 2]);
    if (tr.subsUsed >= cap) { this.showHint(`BENCH USED — ${tr.subsUsed} OF ${cap}`, 2.4); return false; }
    tr.subsUsed++;
    const p = this.L(team, offNum);
    p.stamina = 100;
    this.run(team, offNum).on = true;
    this.commentate('GENERAL', `— ${tr.players[offNum - 1].name} IS BACK ON, FULLY FRESH`);
    return true;
  }

  kit(team: 'A' | 'B') {
    const n = this.teams[team].nation;
    const set = KITS[n.id] ?? KITS.ENG;
    return set[this.teams[team].kitIdx % set.length];
  }
}
