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
import { CamMode, ZoomSetting, mapInputToWorld } from './camera';
import { TutorialState, newTutorial, stepAt, TUTORIAL } from './tutorial';
import {
  shapeById, defenceById, DEFENCE_CHANNELS, ARCHETYPE_SHAPE,
  callPlay, zoneOf, PlayCall, RESTART_RECEIVE, RESTART_KICK, CHASE_LANES,
  AttackShape, DefenceSystem, forwardAttackDepth,
} from './shapes';
import {
  Nation, TEAM_BY_ID, KITS, FORMATION_BY_ID, DIFFICULTY_TABLE, AI_ARCHETYPES,
  POINTS, SquadPlayer, REFEREE_CALLS,
} from './data';
import {
  contractFor, PhaseName, RoleContract,
} from './jlr';
import {
  Live, steer, separate, attackMark, defenceMark, ShapeInput, passOptions, PassOption,
  ruckDistributor, assignReceiver,
  maxSpeed, FORWARDS,
} from './intelligence';
import {
  forwardAttackDepthPlanFailures, forwardAttackPlayerWriteFailures,
  forwardAttackStateWriteFailures, snapshotForwardAttackPlayer,
} from './forwardAttackGates';
import type {
  ForwardAttackGateFailure, ForwardAttackGateReporter, ForwardAttackGateValue,
  ForwardAttackPlayerField,
} from './forwardAttackGates';
import { MAUL_REGATE_WINDOW_SECONDS, MAUL_TRANSFER_PASS_START } from './maulRegate';
import type { MaulCommit, MaulContestControl, MaulExitState } from './maulRegate';
import { MatchAudio } from './audio';
import { updateCamera } from './engine/camera';
import {
  RefState, RefBubble, BubbleKind, BUBBLE_PRIORITY, newReferee, stepReferee,
} from './engine/referee';
import { wetnessOf, windOf, WEATHERS } from './engine/weather';
import { situationOf, beatOf, datasetOffset, SITUATION_LATERAL } from './engine/behaviour';
import { commentate, commentarySequencer } from './engine/commentary';
import { upScrum, scrumSlots, upLineout, releaseThrow, upMaul, maulUseItClock, maulUseItCall } from './engine/setpieces';
import {
  liveOffsideLines, penetrationOf, offsideVerdict, STRICTNESS, OffsideLedger,
  legalMarkZ, legalZFor, clampPitchZ, CLEAN_MARGIN_METRES,
  insideCorridor, clampOntoLegalSide,
  type OffsideLine, type StrictnessProfile,
} from './engine/offside';
import { beginPenalty, resolvePenalty, lawCall, card } from './engine/laws';
import { endHalf, resumeSecondHalf, endMatch } from './engine/clock';
import { upKick, launch, kickLanded } from './engine/kick';
import { upBreakdown, startBreakdown, inKineticImpact } from './engine/breakdown';
import type { LatchState } from './engine/latch';
import { inLatch, isLatching, clearLatch } from './engine/latch';
import { isGoalKickState, goalKickMark, scrumFaceSign } from './behaviour/setpiece-overrides';
import { inEchelon, echelonTargetZ, echelonDepthBehindTen } from './behaviour/backline-echelon';
import { upOpen, contextLabel, doStep, doFend, doDummy, doDive, doPass, cpuCarrier } from './engine/open';

/* ============================ INPUT ============================ */

export interface Input {
  left: boolean; right: boolean; up: boolean; down: boolean;
  run: boolean; sprint: boolean;
  passL: boolean; passR: boolean; cutL: boolean; cutR: boolean;
  kick: boolean; grubber: boolean; drop: boolean;
  contact: boolean; fend: boolean; step: boolean; dummy: boolean;
  tackleDive: boolean; tackleSmother: boolean; switchPlayer: boolean;
  action: boolean;
}
export const NO_INPUT: Input = {
  left: false, right: false, up: false, down: false, run: false, sprint: false,
  passL: false, passR: false, cutL: false, cutR: false,
  kick: false, grubber: false, drop: false,
  contact: false, fend: false, step: false, dummy: false,
  tackleDive: false, tackleSmother: false, switchPlayer: false, action: false,
};

/* ============================ PHASES & STATE ============================ */

export type Phase =
  | 'SCRUM' | 'LINEOUT' | 'KICK' | 'OPEN_PLAY' | 'MAUL' | 'BREAKDOWN'
  | 'REPLAY' | 'LINEOUT_REPLAY' | 'KICK_REPLAY' | 'MAUL_REPLAY' | 'BREAKDOWN_REPLAY';

export interface Actor {
  id: number; team: 'A' | 'B' | 'REF'; num: number;
  rx: number; rz: number; rf: number;
  renderClip: string; clipT: number; jitter: number;
  ring: number;     // 0 none, 1 controlled, 2 pass target
  size: number;     // T-39 per-player build, 0.92 .. 1.12
  turnT: number;    // playtest 2: the turn beat, 0..1
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
  strikeClock: number; wheelDir: number; resets: number;
  ready: number; cadence: string;
}

export interface LineoutState {
  t: number;
  stage: 'ASSEMBLE' | 'CALL' | 'THROW' | 'CONTEST' | 'CATCH' | 'OUT' | 'DONE';
  markZ: number; side: number;
  call: { targetX: number; label: string; jumpers: number; kind: string };
  ball: { x: number; y: number; z: number; vx: number; vy: number; state: string; heldBy: number; apexY: number };
  players: { id: number; num: number; team: 'A' | 'B'; x: number; z: number; handY: number; role: string }[];
  history: { ballX: number; ballY: number }[];
  winner: boolean; contestMargin: number;
  thrower: 'A' | 'B'; quality: number; callIdx: number; meter: number; meterDir: number; meterOn: boolean;
  driveCall: boolean; ready: number;
}

export type KickType = 'PUNT' | 'GRUBBER' | 'DROP_GOAL' | 'GOAL' | 'RESTART' | 'DROP_OUT' | 'BOMB' | 'FIFTY_22';

export interface KickState {
  t: number;
  /** RC2-3 — restart shot clock. Accrues only while the kicker is free to
   *  strike (opposition back ten, formation set), so a lawful wait is never
   *  punished. Undefined outside RESTART/DROP_OUT. */
  delayT?: number;
  stage: 'SETUP' | 'FANFARE' | 'WALKUP' | 'AIM' | 'METER' | 'FLIGHT' | 'RESULT';
  type: KickType;
  bx: number; by: number; bz: number;
  vx: number; vy: number; vz: number;
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
}

/** T-08 — one broadcast event: what happened, where, when. Presentation only. */
export type BroadcastEvent =
  | { t: number; type: 'TACKLE'; x: number; z: number; force: number }
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
  ball: { x: number; y: number; z: number; vx: number; vz: number; live: boolean; t: number };
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
  ball: { x: number; z: number; placed: boolean };
  players: { role: string; num: number; team: 'A' | 'B'; x: number; z: number; down: boolean }[];
  crew: number[]; defCrew: number[];
  /* Playtest 2: J/K pressed during the fight buffers the distribution —
   * the nine passes the MOMENT the ball is out. Cleared unless the ruck
   * is won. */
  bufferedPass?: -1 | 0 | 1;
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
}

/* ============================ CONFIG ============================ */

export interface Slider { id: string; label: string; lo: string; hi: string; v: number; step: number; affects: string[] }

export interface MatchConfig {
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

/* ============================ DIRECTOR ============================ */

export class Director {
  t = 0;
  phase: Phase = 'KICK';
  possession: 'A' | 'B' = 'A';
  actors: Actor[] = [];
  cam: Camera;
  scrumAnchor = { x: 0, z: 0 };
  scrim?: ScrumState;
  lo?: LineoutState;
  kk?: KickState;
  op?: OpenPlayState;
  ml?: MaulState;
  bd?: BreakdownState;
  pitch: PitchConditions;
  zoom = 0.34;
  camMode: CamMode = 'CABLE';

  /** The thirty. Source of truth for every position in the match. */
  live: Live[] = [];
  ctrl = 0;                      // index into live
  passOpts: PassOption[] = [];

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
  lawsExplained = new Set<string>();
  shakeT = 0; /* T-03: engine-internal — engine/camera.ts writes the shake */

  constructor(public cfg: MatchConfig) {
    this.options = cfg.options;
    this.difficulty = cfg.difficulty;
    this.assists = cfg.assists ?? { pass: 0.7, tackle: 0.7, kick: 0.7 };
    this.gameSpeed = cfg.speed ?? 1;
    this.halfLength = cfg.halfLength * 60;
    // Every half resolves in about 150 s of real time whatever its length.
    /* T-18. The clock compressor. 12x starved the box score: every benchmark
     * is per 80-minute MATCH, and at 12x the engine only got ~400 s to produce
     * a full match's worth of tackles, rucks and passes — the per-event rates
     * were already hyper-dense and the totals still read at half strength.
     * 8x gives the match the seconds it needs (five real-time minutes a
     * half — a normal video-game rugby pace) without touching any law, speed
     * or difficulty table. */
    this.clockScale = clamp(this.halfLength / 150, 1, 8);
    this.pitch = pitchConditions(['FIRM', 'STANDARD', 'SOFT', 'MUDDY', 'FROZEN'][cfg.options.pitch ?? 1]);
    this.teams = {
      A: this.makeRun(cfg.homeId, cfg.kitA, cfg.slidersA, cfg.backlineA, cfg.defenceA, cfg.lineoutA, cfg.scrumA, cfg.cpuA, cfg.kickerA),
      B: this.makeRun(cfg.awayId, cfg.kitB, cfg.slidersB, cfg.backlineB, cfg.defenceB, cfg.lineoutB, cfg.scrumB, cfg.cpuB, cfg.kickerB),
    };
    // Start on the cable rig, behind halfway, looking down the pitch.
    this.cam = { x: 0, z: -18, h: 13, yaw: 0, tilt: 0.55, fov: 0.42, shake: 0, horizon: 0.42, roll: 0 };
    this.camMode = 'CABLE';

    for (let i = 0; i < 31; i++) {
      this.actors.push({
        id: i, team: i < 15 ? 'A' : i < 30 ? 'B' : 'REF',
        num: i < 15 ? i + 1 : i < 30 ? i - 14 : 0,
        rx: 0, rz: 0, rf: 1, renderClip: 'idle', clipT: R() * 3, jitter: R() * 1.7, ring: 0, size: 1, turnT: 0,
      });
    }
    this.buildLive();
    this.commentate('KICKOFF');
    this.showHint('A/D OR ARROWS TO RUN · SPACE TO SPRINT', 6);
    // Law 12: the kick-off is taken from the centre of the halfway line.
    this.startKick('A', 'RESTART', { x: 0, z: 0 });
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
    return this.live.find((p) => p.team === team && p.num === num) ?? this.live[0];
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
      return 'X DIVING TACKLE · C SMOTHER · Q SWITCH DEFENDER';
    }
    return 'A / D RUN · SPACE SPRINT';
  }

  /**
   * The single most sensible thing to do right now. SPACE performs this. The
   * player can override the choice in the options.
   */
  get contextVerb(): { key: string; label: string; act: string } {
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
      case 'pass': { const o = this.passOpts[0]; if (o) this.doPass(o.side, false); return; }
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
            if (d < 3.5) { this.setCtrl(this.defending(), near.num); this.startBreakdown(near.num); }
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
        add('L', 'PUNT'); add('H', 'GRUBBER'); add('P', 'DROP GOAL');
        add('F', 'FEND'); add('G', 'STEP'); add('E', 'DUMMY'); add('I', 'TAKE CONTACT');
      } else {
        add('X', 'DIVING TACKLE'); add('C', 'SMOTHER'); add('Q', 'SWITCH DEFENDER');
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
        out.push('DIVING TACKLE (X)', 'SMOTHER (C)', 'SWITCH DEFENDER (Q)');
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
      const o = this.op;
      if (o.ball.live) return { x: o.ball.x, y: o.ball.y, z: o.ball.z };
      const c = this.L(o.attacking, o.carrierNum);
      return { x: c.x, y: 1.14, z: c.z };            // held at the chest
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

  update(dtReal: number, input: Input, pressed: Set<string>, released = new Set<string>()) {
    /* Unattended hold timer (T-18): counts down even while paused, so a
     * CPU-v-CPU half time resumes on its own. */
    if (this.holdTimer > 0) {
      this.holdTimer -= dtReal;
      if (this.holdTimer <= 0 && this.paused && !this.over) this.resumeSecondHalf();
    }
    if (this.paused || this.over) return;
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
      return;
    }

    /* T-32. The conversion ritual is dead time: the clock holds while the try
     * is celebrated and the kicker walks to the tee. It resumes on the strike. */
    const deadBall = this.kk?.stage === 'FANFARE' || this.kk?.stage === 'WALKUP';
    if (!deadBall) this.clock += dt * this.clockScale;
    if (this.clock >= this.halfLength + this.addedTime) {
      if (this.half === 1) { this.endHalf(); return; }
      this.endMatch(); return;
    }

    for (const p of this.live) {
      if (p.sinbin > 0) p.sinbin = Math.max(0, p.sinbin - dt * this.clockScale);
      p.controlled = false;
      p.carrier = false;
      p.passRank = 0;
      p.movedBy = undefined;   // T-02: the ownership tag resets each frame
    }
    // exactly one player owns the ball at any moment — asserted every frame
    if (this.op) {
      const c = this.live.find((p) => p.team === this.op!.attacking && p.num === this.op!.carrierNum);
      if (c) c.carrier = true;
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
      // advantage is over the moment the attacking side gains real ground
      if (this.op && (this.op.carrierZ - this.op.originZ) * this.op.dir > 6) {
        this.advantage = 0;
        // Advantage taken. The penalty is gone, not merely deferred — leaving
        // pendingPenalty set here stranded it forever and it would re-fire later.
        this.pendingPenalty = null;
        this.say('ADVANTAGE OVER — PLAY ON');
      } else if (this.advantage <= 0 && this.pendingPenalty) {
        /* A ball in the air finishes its flight. The whistle brings play
         * back for the penalty, but the ball still comes down — killing a
         * mid-air kick left a ball that vanished at 1.3 m and never
         * bounced. This re-fires every frame, so the penalty resolves the
         * instant the kick is done. */
        if (!this.kk || this.kk.stage !== 'FLIGHT') this.resolvePenalty();
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
      /* SPEC_12: the referee is asked ONCE per frame, over every live line in
       * the registry. He used to be asked from two phase hooks — a ruck hook
       * in the breakdown and a release-beat hook in open play — which is why
       * the scrum, the maul and the lineout had no offside line at all:
       * nobody ever asked. A whistle tears the phase down, so this runs after
       * the phase updater and before the players are told where to stand. */
      if (this.enforceOffsideLines(dt)) return;

      /* LATCH-AND-DRAG — THE LEAK GUARD. The two link fields live on `Live`,
       * which outlives the episode: a whistle, a try or a kick tears `op`
       * down mid-drag and would leave a man permanently at 28% pace with a
       * phantom defender attached. A latch is only ever legal inside a live
       * OPEN_PLAY episode that still owns it, so anything else is stale and
       * is cut here, once, at the top level. */
      if (this.phase !== 'OPEN_PLAY' || !this.op?.latch) {
        for (const p of this.live) if (inLatch(p)) { p.latchedBy = null; p.latchingOnto = null; }
        if (this.op) clearLatch(this.op, null, null);
      }
    } catch (err) {
      this.trip(`${this.phase} threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.watchdog(dt);
    this.think(dt, input);
    /* SPEC_04: the formation target has now been freshly assigned by `think()`;
     * capture target-slot drift before a phase-bound writer can take control. */
    this.samplePendingTargetSlots();
    this.placeBound(dt);
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
      for (const ev of this.frameEvents) {
        this.audio.event(ev.type, ev.type === 'TACKLE' ? ev.force : 0.5);
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
    if (p.sinbin > 0 || p.down || p.carrier || p.beatenT > 0) return false;
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
    return this.live.filter((p) => p.team === team && !p.bound && p.sinbin <= 0
      && !line.participants?.has(`${p.team}:${p.num}`)
      && this.isFormationEligible(p));
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
          const verdict = offsideVerdict(profile, breach, !this.isHuman(team), forceAiClean);
          /* OBSERVE keeps looking. This was a `break` once, which meant the
           * first sustained offender in the team decided the matter: a man
           * loitering half a metre past the line hid the man five metres past
           * it, because `candidates` is in shirt order and 7 came before 11.
           * The harness caught it — 1381 CPU episodes, 0 CPU whistles — and it
           * is the clearest possible argument for measuring the funnel instead
           * of trusting the count. */
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
            if (import.meta.env.DEV) {
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

  private noteTryGuardBlock() {
    this.tryGuardBlocks++;
    const line = `${this.clockText} — BLOCKED duplicate TRY trigger (${this.teams[this.tryLock!.team].nation.short} #${this.tryLock!.num})` +
      ` — lock held since ${this.tryLock!.at.toFixed(1)}s, score stays ${this.teams.A.score}-${this.teams.B.score}`;
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
    if (!import.meta.env.DEV) return;
    const message = `[SPEC_02 gate] ${failure.label} :: ${failure.reason} :: ${JSON.stringify(failure.values)}`;
    console.error(message);
    throw new Error(message);
  };

  private forwardAttackGates(): ForwardAttackGateReporter | undefined {
    return import.meta.env.DEV ? this.reportForwardAttackGate : undefined;
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
    if (this.phaseAge > limit) {
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

    // C. In open play, the carrier must exist, be upright and be on the field.
    if (this.op) {
      const car = this.live.find((p) => p.team === this.op!.attacking && p.num === this.op!.carrierNum);
      if (!car) { this.trip('the ball carrier does not exist'); return; }
      if (car.down || car.bound) { this.trip(`carrier ${car.num} was left grounded or bound`); return; }
      if (!Number.isFinite(car.x) || !Number.isFinite(car.z)) { this.trip('the carrier position went non-finite'); return; }
      if (Math.abs(car.x) > 40 || Math.abs(car.z) > 70) { this.trip('the carrier left the stadium'); return; }
    }

    // D. Nobody has moved for two full seconds while the ball is live.
    if (this.phase === 'OPEN_PLAY') {
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
        if (!set || off > 1.15) {
          p.tx = wx; p.tz = wz;
          p.urgency = set ? 0.85 : 1;
          p.job = 'GET TO YOUR SCRUM SLOT';
          steer(p, dt, !set);
        } else {
          /* D-2 — bounded settle; the 1.15 m threshold here made this the
           * biggest potential snap of the three set pieces. */
          if (this.settleToward(p, wx, wz, dt, 'bound')) { p.vx = 0; p.vz = 0; }
          p.stamina = clamp(p.stamina + dt * 2.6, 0, 100);   // set-piece breath
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
          p.job = slot.row === 1 ? 'FRONT ROW — BIND AND DRIVE THROUGH THE SHOULDERS'
            : slot.row === 2 ? 'SECOND ROW — PUSH ON THE HOOKER'
              : 'BACK ROW — CONTROL THE BALL AT THE BASE';
        }
      }
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
      for (let i = 1; i <= 8; i++) {
        const rank = i % 3, col = Math.floor(i / 3);
        const lx = -1.4 + col * 1.1 + (rank - 1) * 0.5;
        const lz = -s.dir * (i * 0.72);
        const a = this.L(s.attacking, i);
        settle(a,
          s.x + lx * Math.cos(yawR) - lz * Math.sin(yawR) * 0.2,
          s.z + lz,
          s.dir >= 0 ? 1 : -1);
        const runnerLeaving = (s.exit === 'PICK_AND_GO' || s.exit === 'WHEEL_AND_PEEL') && a.num === s.exitRunner;
        clip(a, runnerLeaving ? 'carry' : attackClip);
        a.job = runnerLeaving ? 'PEEL FROM THE MAUL AND CARRY' : attackDriving
          ? 'KEEP THE LEGS GOING, STAY BOUND'
          : 'BIND TIGHT AND HOLD THE MAUL';
        /* T-16 #3 — the maul's defensive side comes from the maul's own
         * `attacking` field, never from `possession`: a penalty can flip
         * possession mid-drive, after which both ranks were fed from the same
         * team. */
        const dTeam: 'A' | 'B' = s.attacking === 'A' ? 'B' : 'A';
        const d = this.L(dTeam, i);
        const dlx = 1.4 - (i % 2) * 2.2;
        settle(d, s.x + dlx, s.z + s.dir * (1.2 + i * 0.7), -s.dir);
        clip(d, 'maulBind');
        d.job = s.contest === 'DEFENCE_CONTROL' ? 'HOLD THE MAUL UP AND WAIT FOR USE IT' : 'BIND AND RESIST THE DRIVE';
      }
      /* The nine has a fixed base behind the maul. It is marked bound by
       * think(), then placed here, so TRANSFER_TO_9 can show existing idle
       * (nineSquat) followed by passSpin (ninePass) before open play begins. */
      const nine = this.L(s.attacking, 9);
      const baseX = clamp(s.x + (s.x > 0 ? -1.6 : 1.6), -32, 32);
      const baseZ = clamp(s.z - s.dir * 6.6, -58, 58);
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
        } else {
          /* NO-TELEPORT: the ease is proportional to the WHOLE remaining gap,
           * so a man 20 m from his slot took a 2.5 m first step. Cap the step
           * at a sprint per frame — he runs in, he does not lurch. */
          const k = Math.min(1 - Math.exp(-dt * 8), 0.16 / Math.max(0.01, Math.hypot(q.x - p.x, q.z - p.z)));
          p.x += (q.x - p.x) * k;
          p.z += (q.z - p.z) * k;
          p.movedBy = 'bound';   // T-02: the ease is a writer too — own it
          if (Math.hypot(q.x - p.x, q.z - p.z) < 0.5) { p.vx *= 0.5; p.vz *= 0.5; }
        }
        p.face = q.team === s.attacking ? 1 : -1;
        if (q.role === 'CARRIER') clip(p, 'grounded');
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
        const baseX = clamp(s.contactX + (s.contactX > 0 ? -1.8 : 1.8), -32, 32);
        const baseZ = s.contactZ - fwdA * 1.4;
        const off = Math.hypot(baseX - dist9.x, baseZ - dist9.z);
        if (off > 0.45) {
          dist9.tx = baseX; dist9.tz = baseZ; dist9.urgency = 1;
          dist9.job = 'GET TO THE BASE — YOUR BALL';
          steer(dist9, dt, true);
        } else {
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
          this.place(k, s.bx, s.bz - s.dir * 1.1, 'kicker');
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
          this.place(k, kx, kz, 'kicker');
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
        for (const p of this.live) {
          if (p === k || p.sinbin > 0) continue;
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
      const lp = s.bounces === 0 ? this.landingPrediction() : null;
      const tgt = lp ?? { x: s.bx, z: s.bz };

      // The kicker has just struck the ball. He follows up a couple of metres at
      // a jog, but he is NOT a chaser — the three chasers own the landing zone.
      // Steering him at the landing point made him appear to fly with the ball
      // across the pitch.
      k.tx = clamp(k.x + s.dir * 1.0, -33, 33);
      k.tz = clamp(k.z + s.dir * 4.0, -58, 58);
      k.urgency = 0.35;
      k.job = 'FOLLOW YOUR KICK';
      steer(k, dt, false);

      s.chasers.forEach((c, ci) => {
        const p = this.L(s.kicker, c.num);
        const lane = CHASE_LANES[ci % CHASE_LANES.length];
        const lead = lp ? lane.lat : lane.lat * 0.5;
        p.tx = clamp(tgt.x + lead, -33, 33);
        p.tz = clamp(tgt.z, -58, 58);
        p.urgency = 1;
        p.job = lane.label;
        steer(p, dt, true);
      });

      // The receiving side: the designated fielder goes to the ball, the rest
      // come across to support him rather than standing where they started.
      const rec = assignReceiver(this.live, this.receivingSide(), tgt.x, tgt.z);
      if (rec) {
        rec.tx = clamp(tgt.x, -33, 33);
        rec.tz = clamp(tgt.z, -58, 58);
        rec.urgency = 1;
        rec.job = 'FIELD THE BALL — CALL FOR IT LOUD';
        steer(rec, dt, true);
      }
      for (const p of this.live) {
        if (p.team !== this.receivingSide() || p === rec || p.sinbin > 0) continue;
        if (s.chasers.some((c) => c.num === p.num && s.kicker === p.team)) continue;
        p.tx = clamp(tgt.x + (p.x > tgt.x ? 5 : -5), -33, 33);
        p.tz = clamp(tgt.z - s.dir * 8, -58, 58);
        p.urgency = 0.75;
        p.job = 'COME ACROSS AND SUPPORT THE FIELDER';
        steer(p, dt, false);
      }
      return;
    }
  }

  setZoom(z: number) { this.zoom = clamp(z, 0, 1); }

  /* ============================ THINK: targets for all thirty ============================ */

  shape( /* T-03: engine-internal */): ShapeInput {
    const atk = this.possession;
    const f = this.focusPoint();
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
      case 'OPEN_PLAY': case 'REPLAY': return 'OPEN_PLAY';
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
   * to leave a carrier-anchored frame. While the ball is live, the ball is the subject.
   */
  cameraFocus(): { x: number; z: number } {
    if (this.op && this.op.ball.live) return { x: this.op.ball.x, z: this.op.ball.z };
    return this.focusPoint();
  }

  focusPoint(): { x: number; z: number } {
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
    if (import.meta.env.DEV && p.movedBy && p.movedBy !== who && ddx * ddx + ddz * ddz > 0.25) {
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
    if (!authoredLastMan && import.meta.env.DEV) {
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

  private think(dt: number, input: Input) {
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
    const f = this.focusPoint();

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
      if (ch && this.isHuman(ch.team) && !ch.down && ballLive
        && !KICK.chasers.some((c) => c.num === ch.num)) {
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

    // Which defenders leave the line and converge: the men in the carrier's channel.
    const convergers = new Set<number>();
    /* T-13. THE COVER CHASE. A defender the carrier has gone past turns and
     * chases — at sprint, all of them, from anywhere within thirty metres.
     * Until the carrier actually ran (T-13 carrier integration) this never
     * mattered; after it, three channel convergers could not cover a full-
     * pace runner and the match turned into sevens (5.9 line breaks a team,
     * 66 tackles). The line holds its shape — dataset still owns the intact
     * line — but once a man is beaten, pursuit is the only job. */
    const coverChase = new Set<number>();
    if (this.op && !this.op.ball.live) {
      const carC = this.L(this.op.attacking, this.op.carrierNum);
      for (const q of this.live) {
        if (q.team === def || q.sinbin > 0 || q.beatenT > 0 || q.down) continue;
        /* SPEC_11: "the carrier has gone past him" is `(carC.z − q.z) · dir
         * > 0.5`. The old form was its negation with a −0.5 threshold, which
         * armed the chase for every defender up to half a metre IN FRONT of
         * the carrier — half the line turning and sprinting at a man they had
         * not been beaten by. */
        if ((carC.z - q.z) * dir > 0.5 && Math.hypot(q.x - carC.x, q.z - carC.z) < 16) coverChase.add(q.num);
      }
      const carLat = this.op.carrierX - f.x;
      for (const r of DEFENCE_CHANNELS
        .map((c) => ({ num: c.num, d: Math.abs(c.lat - carLat) }))
        .sort((a, b) => a.d - b.d).slice(0, 3)) convergers.add(r.num);
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
    if (ctrlHuman && human && !isBound(ctrlHuman) && !ctrlHuman.down) {
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
          const sp = maxSpeed(ctrlHuman, this.op?.carrierNum === ctrlHuman.num, sprint, ctrlHuman.stamina) * burstMul * debt;
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
        if (!inLatch(ctrlHuman) && !(ctrlHuman.clip === 'dive' && ctrlHuman.clipT < 0.5)) {
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
      if (isBound(p) || p.down) {
        this.writeThinkPlayer(gate, `think:bound:${p.team}${p.num}`, p, ['bound'] as const, () => { p.bound = true; });
        continue;
      }
      this.writeThinkPlayer(gate, `think:unbound:${p.team}${p.num}`, p, ['bound'] as const, () => { p.bound = false; });

      const onAtk = p.team === atk;
      const c: RoleContract = contractFor(p.num);

      if (onAtk) {
        // carrier: driven by phase logic, not by shape
        if (this.op && p.num === this.op.carrierNum) {
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
          steer(p, dt, false, gate, `think:pod-hold:${p.team}${p.num}`);
          continue;
        }

        // The seven rides the carrier's hip and the eight trails — the offload
        // options — unless the shape needs them in a pod on the far side.
        const slot = atkShape.slots.find((q) => q.num === p.num);
        const hipMan = p.num === 7 || p.num === 8;
        const podFar = slot ? Math.abs(slot.lat) > 14 : false;
        if (this.op && hipMan && !podFar) {
          const car = this.L(atk, this.op.carrierNum);
          const off = p.num === 7 ? 1.9 : -1.4;
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
          steer(p, dt, true, gate, `think:hip-support-steer:${p.team}${p.num}`);
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
            steer(p, dt, true, gate, `think:dataset-steer:${p.team}${p.num}:${sit}`);
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
            p.tz = clamp(car.z - this.op!.dir * lead, -58, 58);
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
      if (!this.isHuman(p.team) && !p.carrier && !p.bound && p.sinbin <= 0 && retreatLines.length) {
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

      // T-24b. Convergers sprint to the tackle. They were jogging because the old
      // call only sprinted the controlled player — the carrier simply outran the
      // defence and tackles never happened.
      steer(p, dt, (input.sprint && p === ctrlHuman) || convergers.has(p.num) || coverChase.has(p.num),
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
  cableX = 0; /* T-03: engine-internal cable-rig state */
  cableZ = -18;
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
      case 'MAUL': this.startMaul('A', at.x, at.z, 5, true); break;
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

  startOpen(team: 'A' | 'B', x: number, z: number, num = 9, phase = 1, gained = 0, protect = 0) {
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
    if (Math.hypot(car.x - gx, car.z - gz) < CLOSE_PLACE_MAX) {
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
    car.vx = 0;
    car.vz = dir * 3.4;
    car.face = dir;
    car.down = false;
    car.bound = false;
    this.live.forEach((p) => { p.passRank = 0; });

    this.op = {
      t: 0, attacking: team, dir,
      carrierX: cx, carrierZ: cz, carrierNum: num,
      vx: 0, vz: dir * 4.2, protect,
      podHold: protect > 0 ? Math.min(1.0, protect) : 0,
      supports: [], defenders: [],
      gained, toLine: Math.abs(dir * 50 - z), z, pressure: 0, phase,
      lineBreak: false,
      current: { label: '' },
      burst: 0, burstCd: 0, stepCd: 0, fendCd: 0, dive: 0, kickCharge: 0, kickKind: '', speedDebt: 1,
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
      ball: { x, y: 1.05, z, vx: 0, vz: 0, live: false, t: 0 },
      pendingReceiver: num, passT: 0, passDist: 8,
      passTargetX: x, passTargetZ: z,
    };    this.bd = undefined; this.ml = undefined;
    this.phase = 'OPEN_PLAY';
    this.setCtrl(team, num);
    this.refreshPassOptions();
    if (!this.isHuman(team)) this.cpuCallPlay();
  }

  /** Control always lands on the man with the ball, or the nearest defender. */
  setCtrl(team: 'A' | 'B', num: number) {
    const p = this.live.findIndex((q) => q.team === team && q.num === num);
    if (p >= 0) this.ctrl = p;
  }

  /**
   * Control handoff — how the player jumps in and out of a match the AI is
   * already playing. On any change of possession or phase, control passes to the
   * man whose job it now is. The AI keeps driving everyone else, so if the player
   * never touches a key the match still plays out as a game of rugby.
   */
  handoffControl() {
    if (!this.isHuman(this.possession)) return;
    const f = this.focusPoint();
    if (this.op) { this.setCtrl(this.op.attacking, this.op.carrierNum); return; }
    if (this.ml) { this.setCtrl(this.ml.attacking, 8); return; }
    if (this.bd) { this.setCtrl(this.bd.attacking, 9); return; }
    if (this.lo) { this.setCtrl(this.lo.thrower, 2); return; }
    if (this.scrim) { this.setCtrl(this.scrim.feed, 9); return; }
    if (this.kk) {
      // Once the kick is away the interesting player is a chaser, not the man
      // who has just struck it. Handing control back to the kicker is what made
      // the controlled player appear to fly along with the ball.
      if (this.kk.stage === 'AIM' || this.kk.stage === 'METER') {
        this.setCtrl(this.kk.kicker, this.kk.kickerNum);
      } else if (this.isHuman(this.kk.kicker)) {
        this.setCtrl(this.kk.kicker, this.kk.chasers[0]?.num ?? this.kk.kickerNum);
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
          if (rec) this.setCtrl(this.receivingSide(), rec.num);
        }
      }
      return;
    }
    const def = this.defending();
    const best = this.live
      .filter((p) => p.team === def && p.sinbin <= 0 && !p.down)
      .sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0];
    if (best) this.setCtrl(def, best.num);
  }

  cycleDefender() {
    const def = this.defending();
    const f = this.focusPoint();
    const cands = this.live
      .map((p, i) => ({ p, i }))
      .filter((c) => c.p.team === def && c.p.sinbin <= 0 && !c.p.down)
      .sort((a, b) => Math.hypot(a.p.x - f.x, a.p.z - f.z) - Math.hypot(b.p.x - f.x, b.p.z - f.z))
      .slice(0, 3);
    if (!cands.length) return;
    const idx = cands.findIndex((c) => c.i === this.ctrl);
    this.ctrl = cands[(idx + 1) % cands.length].i;
    this.showHint(`CONTROLLING ${this.teams[def].players[this.ctrlPlayer.num - 1].name} — ${contractFor(this.ctrlPlayer.num).pos}`, 2);
  }

  refreshPassOptions() {
    const gate = this.forwardAttackGates();
    const signature = (options: readonly PassOption[]): string => options
      .map((option) => `${option.player.team}${option.player.num}:${option.side}:${option.rank}:${option.priority}`)
      .join('|');
    /* SPEC_02 GATE: capture the derived state before its single replacement. */
    const before = { passOpts: signature(this.passOpts) };
    if (!this.op) {
      this.passOpts = [];
      this.checkForwardAttackState(gate, 'Director.refreshPassOptions:clear', before,
        { passOpts: signature(this.passOpts) }, ['passOpts']);
      return;
    }
    const car = this.L(this.op.attacking, this.op.carrierNum);
    const wet = wetnessOf(WEATHERS[this.options.weather ?? 1]);
    const forwardContext = !this.isHuman(this.op.attacking) ? {
      enabled: true,
      attackDirection: (this.op.dir < 0 ? -1 : 1) as -1 | 1,
      noteRejection: () => this.notePassCandidateRejected(),
    } : undefined;
    const next = passOptions(car, this.live, this.op.open, false, wet, forwardContext, gate);
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

  startBreakdown(tacklerNum?: number) { /* T-03: engine/breakdown */ return startBreakdown(this, tacklerNum); }


  upBreakdown(dt: number, _input: Input, pressed: Set<string>) { /* T-03: engine/breakdown */ return upBreakdown(this, dt, _input, pressed); }


  clearRuck() { /* T-03: engine-internal */
    for (const p of this.live) { p.down = false; p.bound = false; }
    this.bd = undefined;
  }

  /**
   * Release every player from every phase-bound state and tear down all phase
   * objects. Anything that interrupts a phase — a penalty, a score, a tutorial
   * jump — must call this or it will leave players frozen where they stood.
   */
  releaseAll() {
    for (const p of this.live) {
      p.down = false;
      p.bound = false;
      p.carrier = false;
      p.urgency = 0.6;
      if (p.clip === 'grounded' || p.clip === 'tackle') { p.clip = 'ready'; p.clipT = 0; }
    }
    this.bd = undefined;
    this.ml = undefined;
    this.scrim = undefined;
    this.lo = undefined;
  }

  /* ============================ MAUL ============================ */

  startMaul(team: 'A' | 'B', x: number, z: number, ranks = 5, fromLineout = false) {
    const dir = team === 'A' ? 1 : -1;
    const def: 'A' | 'B' = team === 'A' ? 'B' : 'A';
    this.possession = team;
    this.clearRuck();
    for (let i = 1; i <= 8; i++) { this.L(team, i).bound = true; this.L(def, i).bound = true; }
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
      humanTeam, contest: humanTeam ? 'PENDING' : 'ATTACK_CONTROL',
      regateWindowT: 0, regateCandidate: null, regateWindows: [],
      humanWinShare: null, humanWon: null,
      exit: 'NONE', exitT: 0, exitRunner: 0, exitLane: null, exitX: x, exitZ: z,
      fromLineout,
    };
    this.phase = 'MAUL';
    if (fromLineout) this.say('CAUGHT, AND THE MAUL IS FORMED');
    this.setCtrl(humanTeam ?? team, humanTeam === def ? 7 : 8);
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
      yaw: 0, netDrive: 0, collapseRisk: 0,
      strikeClock: 0, wheelDir: R() < 0.5 ? -1 : 1, resets: 0,
      ready: 0, cadence: '',
    };
    this.clearRuck();
    this.lo = undefined; this.ml = undefined; this.op = undefined;
    this.phase = 'SCRUM';
    this.say(`SCRUM TO ${this.teams[feed].nation.short}`);
    if (this.isHuman(feed)) this.showHint('PLAYERS ARE FORMING — POUND A/D WHEN THE REF CALLS ENGAGE', 3);
    this.setCtrl(feed, 9);
  }

  private avgStamina(t: 'A' | 'B') {
    const list = this.live.filter((p) => p.team === t && FORWARDS.includes(p.num));
    return list.reduce((n, p) => n + p.stamina, 0) / Math.max(1, list.length);
  }

  upScrum(dt: number, input: Input, pressed: Set<string>) { /* T-03: engine/setpieces */ return upScrum(this, dt, input, pressed); }


  /* ============================ LINEOUT ============================ */

  static readonly LINE_A = [4, 5, 6, 7, 8, 3, 1];
  static readonly LINE_B = [4, 5, 6, 7, 8, 3];
  static readonly LO_CALLS = [
    { kind: 'FRONT', label: 'FRONT BALL', targetX: -1.8, jumpers: 4 },
    { kind: 'MIDDLE', label: 'MIDDLE + DRIVE', targetX: -3.4, jumpers: 5 },
    { kind: 'OFF_TOP', label: 'OFF THE TOP', targetX: -4.6, jumpers: 5 },
    { kind: 'TAIL', label: 'TAIL BALL', targetX: -6.6, jumpers: 7 },
  ];

  startLineout(thrower: 'A' | 'B', z: number, x: number) {
    this.possession = thrower;
    // A not-straight rethrow earns a new call to this method and a new event.
    this.recordSetPieceEvent('lineouts');
    const zn = clamp(z, FIELD.tryZ + 6, FIELD.tryZFar - 6);
    const side = x >= 0 ? 1 : -1;
    const players: LineoutState['players'] = [];
    let id = 1;
    for (const t of ['A', 'B'] as const) {
      const nums = t === thrower ? Director.LINE_A : Director.LINE_B;
      for (let i = 0; i < nums.length; i++) {
        players.push({
          id: id++, num: nums[i], team: t,
          x: side * (30 - i * 0.62), z: zn + (t === 'A' ? -0.7 : 0.7),
          handY: 0, role: i < 3 ? 'JUMPER' : i < 5 ? 'LIFTER' : 'SCRUMMY',
        });
      }
    }
    players.push({ id: id++, num: 2, team: thrower, x: side * 33.5, z: zn, handY: 1.6, role: 'THROWER' });
    players.push({ id: id++, num: 9, team: thrower, x: side * 20, z: zn + (thrower === 'A' ? -6 : 6), handY: 0, role: 'SCRUMMY' });
    this.lo = {
      t: 0, stage: 'ASSEMBLE', markZ: zn, side,
      call: { targetX: side * 28.4, label: Director.LO_CALLS[1].label, jumpers: 5, kind: 'MIDDLE' },
      ball: { x: side * 33.5, y: 1.6, z: zn, vx: 0, vy: 0, state: 'HELD', heldBy: 0, apexY: 0 },
      players, history: [], winner: false, contestMargin: 0,
      thrower, quality: 0.5, callIdx: 1, meter: 0.5, meterDir: 1, meterOn: false,
      driveCall: true, ready: 0,
    };
    this.clearRuck();
    this.scrim = undefined; this.ml = undefined; this.op = undefined;
    this.phase = 'LINEOUT';
    this.say(`LINEOUT TO ${this.teams[thrower].nation.short}`);
    if (this.isHuman(thrower)) this.showHint('A/D CHOOSE THE CALL · SPACE TO THROW · STOP THE BAR IN THE BAND', 3.4);
    this.setCtrl(thrower, 10);
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
    this.kk = {
      t: 0, stage: isConversion ? 'FANFARE' : 'AIM', type,
      bx: x, by: 0.12, bz: z, vx: 0, vy: 0, vz: 0,
      dir, kicker: team, kickerNum: num, kickerName: this.teams[team].players[num - 1].name,
      history: [], profile: { label: labels[type], atGoal },
      goalProb: atGoal ? base : 0, goalDistance, goalAngle,
      hangTime: 0, apex: 0, distance: 0,
      power: 0, accuracy: 0.5, meter: 0, meterDir: 1, meterOn: true,
      aim: 0, landX: x, landZ: z + dir * 30,
      bounces: 0, result: '', chasers: [], form: undefined, formReady: 0,
      fromPenalty: this.penaltyTouchKick,
    };
    this.penaltyTouchKick = false;
    this.phase = 'KICK';
    this.op = undefined; this.bd = undefined;
    this.teams[team].stats.kicks++;
    this.run(team, num).kicks++;
    if (type === 'RESTART' || type === 'DROP_OUT') this.kickoffFormation(team, z);
    this.setCtrl(team, num);
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
   * floor, the wet ball and the wind take away from it. This is the fix for
   * "a slight joystick wobble completely depletes the power".
   */
  kickerAccuracy(s: KickState): number {
    const k = this.L(s.kicker, s.kickerNum);
    const wet = wetnessOf(WEATHERS[this.options.weather ?? 1]);
    const wind = windOf(this.options);
    const assist = this.isHuman(s.kicker) ? this.assists.kick : 0.5;
    return clamp(0.30 + (k.attrs.SKL / 100) * 0.6 - wet * 0.12 - wind * 0.18 + assist * 0.12, 0.15, 0.99);
  }

  launch(power: number, accuracy: number, wind: number) { /* T-03: engine/kick */ return launch(this, power, accuracy, wind); }


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
    this.events.push({ min: this.minute, team: s.kicker, kind: s.type, text: `${this.teams[s.kicker].nation.short} +${pts} — ${s.kickerName}` });
    this.commentate('KICK');
    this.banner_(`${this.teams[s.kicker].nation.short} +${pts} — ${s.kickerName}`);
    this.kk = undefined;
    this.restartAfterScore(s.kicker === 'A' ? 'B' : 'A');
  }

  kickMissed( /* T-03: engine-internal */s: KickState, why: string) {
    s.stage = 'RESULT'; s.result = 'MISSED';
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
    this.tryLock = { at: this.t, team, num };
    const p = this.teams[team].players[num - 1];
    /* T-31. The scorer DIVES for the line (W-15/R-07) — a horizontal launch
     * that ends in a slide on the turf, not the grounded pose. Open play
     * only: a maul try is shoved over the line by eight men, not dived. */
    if (this.op) {
      const scorer = this.live.find((q) => q.team === team && q.num === num);
      if (scorer) { scorer.clip = 'dive'; scorer.clipT = 0; }
    }
    const tryX = this.op?.carrierX ?? this.ml?.x ?? 0;
    this.teams[team].score += POINTS.TRY;
    this.run(team, num).metres += 20;
    this.lastScorer = { num, name: p.name, team, min: this.minute, kind: 'TRY' };
    this.conversionPending = true;
    this.events.push({ min: this.minute, team, kind: 'TRY', text: `TRY — ${p.name}` });
    this.momentum = clamp(this.momentum + (team === 'A' ? 1 : -1) * 0.3, -1, 1);
    /* T-08: the try is the loudest event of all. T-09: a try EARNED — seven
     * phases of build, or finished off a live line break — draws from the
     * TRY_BUILT bank, not the try-from-nothing pool. */
    this.emitEv({ t: this.t, type: 'TRY', x: tryX, z: this.op?.carrierZ ?? 0, num });
    const built = this.phasesGained >= 6 || this.op?.lineBreak === true;
    this.commentate(built ? 'TRY_BUILT' : 'TRY', `— ${p.name}`);
    this.phasesGained = 0;
    this.gainWindow.length = 0;
    /* W-011. Every grounding in the corner goes upstairs: the on-field
     * decision is the try, the TMO shows the angle, and the conversion
     * ritual (FANFARE) holds until the check completes. The |x| >= 15 m
     * test is the corner channel — a try under the posts is never
     * checked, exactly as a real referee plays on. */
    const corner = Math.abs(tryX) >= 15;
    if (corner) {
      this.tmo = { t: 0, name: p.name, short: this.teams[team].nation.short, angle: 18 + R() * 34, said: false };
      this.banner_(`ON-FIELD DECISION: TRY — TMO CHECKING THE GROUNDING`);
      this.say('REFEREE GOES TO THE TMO — GROUNDING IN THE CORNER');
    } else {
      this.banner_(`TRY! ${this.teams[team].nation.short} — ${p.name}`);
    }
    this.shake(0.7);
    this.clearRuck();
    this.op = undefined; this.ml = undefined; this.bd = undefined;
    /* T-36. The conversion is taken from in line with where the ball was grounded
     * (tryX), at the kicker's chosen distance. 22 m back is the standard tee. */
    this.startKick(team, 'GOAL', { x: tryX, z: team === 'A' ? FIELD.tryZFar - 22 : FIELD.tryZ + 22 });
  }

  /** Law 12 — a drop-out is taken from anywhere on the 22-metre line. */
  private dropOut(team: 'A' | 'B') {
    this.startKick(team, 'DROP_OUT', { x: 0, z: team === 'A' ? -28 : 28 });
  }

  /** Held up in goal is a five-metre scrum to the attack, not a drop out. */
  touchDown( /* T-03: engine-internal */) {
    // If the ball is dead in goal without being grounded by the attack, the
    // defending side restarts with a drop-out from their own 22-metre line.
    const defender: 'A' | 'B' = this.defending();
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
    for (let i = 0; i < 30; i++) {
      const p = this.live[i];
      const a = this.actors[i];
      a.rx = p.x; a.rz = p.z; a.rf = p.face;
      a.renderClip = p.clip; a.clipT = p.clipT; a.jitter = p.jitter;
      a.turnT = p.turnT ?? 0;
      a.size = p.size;
      a.num = p.num; a.team = p.team;
      a.ring = p.controlled ? 1 : (this.passOpts.some((o) => o.player === p) ? 2 : 0);
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
