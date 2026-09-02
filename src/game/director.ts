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
  AttackShape, DefenceSystem,
} from './shapes';
import {
  Nation, TEAM_BY_ID, KITS, FORMATION_BY_ID, DIFFICULTY_TABLE, AI_ARCHETYPES,
  POINTS, SquadPlayer,
} from './data';
import {
  contractFor, PhaseName, RoleContract,
} from './jlr';
import {
  Live, steer, separate, attackMark, defenceMark, ShapeInput, passOptions, PassOption,
  ruckDistributor, assignReceiver,
  maxSpeed, FORWARDS,
} from './intelligence';
import { MatchAudio } from './audio';
import { updateCamera } from './engine/camera';
import { wetnessOf, windOf, WEATHERS } from './engine/weather';
import { situationOf, beatOf, datasetMark } from './engine/behaviour';
import { commentate, commentarySequencer } from './engine/commentary';
import { upScrum, scrumSlots, upLineout, releaseThrow, upMaul } from './engine/setpieces';
import { beginPenalty, resolvePenalty, lawCall, card } from './engine/laws';
import { endHalf, resumeSecondHalf, endMatch } from './engine/clock';
import { upKick, launch, kickLanded } from './engine/kick';
import { upBreakdown, startBreakdown } from './engine/breakdown';
import { upOpen, contextLabel, doStep, doFend, doDummy, doPass, cpuCarrier } from './engine/open';

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
  /** penalty kick to touch — an uncontested strike at full range (T-18) */
  fromPenalty?: boolean;
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
  originZ: number; originX: number;
  aiTimer: number; aiIntent: string; aiPlay: string; aiPhasePlan: number;
  /** T-18: defenders who have already had their one slip-roll this episode */
  beatTried?: Set<number>;
  open: number;
  /** seconds of immunity after the phase starts, so ruck ball is playable */
  protect: number;
  /** T-18. Seconds the current carrier has actually held the ball. Hot-potato
   *  attack — catch, fling, kick, all inside half a second — is why tackles,
   *  rucks and metres were all near zero: the CPU decided on the frame the ball
   *  arrived. Decisions now respect a carry commitment window. */
  heldT: number;
  ball: { x: number; y: number; z: number; vx: number; vz: number; live: boolean; t: number };
  /** T-35 pass flight: who the ball is travelling to, and the arc progress 0..1 */
  pendingReceiver: number;
  passT: number;
}

export interface MaulState {
  t: number;
  stage: 'ENGAGE' | 'DRIVE' | 'STALL' | 'OVER';
  x: number; z: number; dir: number; yaw: number;
  forceA: number; forceD: number;
  ballRank: number; ranks: number;
  speed: number; gained: number;
  stallClock: number; stoppedOnce: boolean; useItCalled: boolean; warned: boolean;
  tryLineZ: number; attacking: 'A' | 'B';
  committed: number; transferCd: number;
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
  groundAt: number; ballOutAt: number; phase: number; expectedPoints: number;
  power: { A: number; B: number }; window: number; result: string; resultWhy: string;
  contestMeter: number; meterDir: number; meterOn: boolean; waggle: number;
  commitA: number; commitB: number; advantageOf: number;
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
  tacklesBroke: number; offloads: number; jackals: number;
}

const blankStats = (): MatchStats => ({
  possession: 0, tackles: 0, missed: 0, turnovers: 0, scrumsWon: 0, scrumsLost: 0,
  lineoutsWon: 0, lineoutsLost: 0, rucks: 0, slowBall: 0, metres: 0, carries: 0,
  passes: 0, kicks: 0, penaltiesConceded: 0, lineBreaks: 0, offsides: 0,
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
        rx: 0, rz: 0, rf: 1, renderClip: 'idle', clipT: R() * 3, jitter: R() * 1.7, ring: 0, size: 1,
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
          stamina: 100,
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
    if (this.ml) return 'A / D DRIVE · SPACE MOVE THE BALL TO THE TAIL · L USE IT';
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
    if (this.bd) return { key: 'A / D', label: 'CLEAR OUT THE RUCK', act: 'waggle' };
    if (this.ml) return { key: 'A / D', label: 'DRIVE THE MAUL', act: 'waggle' };
    if (this.op) {
      const attacking = this.ctrlPlayer.team === this.op.attacking;
      if (attacking) {
        if (mode === 'KICK') return { key: 'SPACE', label: 'KICK', act: 'kick' };
        if (mode === 'CONTACT') return { key: 'SPACE', label: 'TAKE THE TACKLE', act: 'contact' };
        if (mode === 'CARRY') return { key: 'SPACE', label: 'SPRINT', act: 'run' };
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
    if (this.ml) { add('A / D', 'DRIVE'); add('SPACE', 'BALL TO THE TAIL'); }
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
      return {
        now: `Maul driving at ${m.speed.toFixed(1)} m/s, ball at rank ${m.ballRank + 1}`,
        next: m.stallClock > 2 ? 'It has stalled — press L to use it before the whistle' : 'Pound A/D to keep it moving',
        clock: m.stallClock > 0 ? 5 - m.stallClock : 0, danger: m.stallClock > 2.5,
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
    if (this.kk) { out.push('AIM (A/D)', this.kk.stage === 'AIM' || this.kk.stage === 'METER' ? 'SET (SPACE)' : 'CHASE'); }
    if (this.scrim) out.push('PUSH THE PACK (A/D)');
    if (this.lo) out.push(this.lo.stage === 'CALL' ? 'CHOOSE CALL (A/D)' : 'THROW (SPACE)');
    if (this.bd) out.push('CLEAR OUT (A/D)', 'COMMIT MORE (SPACE)');
    if (this.ml) out.push('DRIVE (A/D)', 'SHIFT BALL (SPACE)');
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
  banner_(text: string) { this.banner = text; this.bannerAt = this.t; }
  showHint(text: string, secs = 4) { this.hint = text; this.hintUntil = this.t + secs; }

  /** Every law is explained in one line the first time it is applied. */
  lawCall(key: string, call: string, team: 'A' | 'B') { /* T-03: engine module */ return lawCall(this, key, call, team); }


  shake(a: number) { this.shakeT = Math.max(this.shakeT, a); }

  /* ============================ UPDATE ============================ */

  update(dtReal: number, input: Input, pressed: Set<string>) {
    /* Unattended hold timer (T-18): counts down even while paused, so a
     * CPU-v-CPU half time resumes on its own. */
    if (this.holdTimer > 0) {
      this.holdTimer -= dtReal;
      if (this.holdTimer <= 0 && this.paused && !this.over) this.resumeSecondHalf();
    }
    if (this.paused || this.over) return;
    const dt = Math.min(dtReal, 1 / 25) * this.gameSpeed;

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
        case 'OPEN_PLAY': this.upOpen(dt, input, pressed); break;
        case 'BREAKDOWN': case 'BREAKDOWN_REPLAY': this.upBreakdown(dt, input, pressed); break;
        case 'MAUL': case 'MAUL_REPLAY': this.upMaul(dt, input, pressed); break;
        case 'SCRUM': case 'REPLAY': this.upScrum(dt, input, pressed); break;
        case 'LINEOUT': case 'LINEOUT_REPLAY': this.upLineout(dt, input, pressed); break;
        case 'KICK': case 'KICK_REPLAY': this.upKick(dt, input, pressed); break;
      }
    } catch (err) {
      this.trip(`${this.phase} threw: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.watchdog(dt);
    this.think(dt, input);
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
  private phaseAge = 0;
  private lastWatchPhase: Phase | null = null;
  private lastPhaseToken: unknown = null;
  watchdogTrips = 0;
  watchdogLog: string[] = [];

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
      ((this.phase === 'SCRUM' || this.phase === 'REPLAY') && !this.scrim) ||
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
    this.lastCallSucceeded = gained > 1.2;
  }
  private lastCallZ: number | null = null;

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
          this.place(p, wx, wz, 'bound');
          p.vx = 0; p.vz = 0;
          p.face = slot.team === 'A' ? 1 : -1;
        }
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
          this.place(p, wx, wz, 'bound');
          p.vx = 0; p.vz = 0;
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
        this.place(p, slot.x, slot.z, 'bound');
        p.vx = 0; p.vz = 0;
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
          this.place(p, wx, wz, 'bound');
          p.vx = 0; p.vz = 0;
          p.face = face;
        }
      };
      for (let i = 1; i <= 8; i++) {
        const rank = i % 3, col = Math.floor(i / 3);
        const lx = -1.4 + col * 1.1 + (rank - 1) * 0.5;
        const lz = -s.dir * (i * 0.72);
        const a = this.L(s.attacking, i);
        settle(a,
          s.x + lx * Math.cos(yawR) - lz * Math.sin(yawR) * 0.2,
          s.z + lz,
          s.dir >= 0 ? 1 : -1);
        clip(a, i < 3 ? 'maulBind' : 'maulDrive');
        a.job = i < 3 ? 'BIND AT THE FRONT AND DRIVE LOW' : 'KEEP THE LEGS GOING, STAY BOUND';
        /* T-16 #3 — the maul's defensive side comes from the maul's own
         * `attacking` field, never from `possession`: a penalty can flip
         * possession mid-drive, after which both ranks were fed from the same
         * team. */
        const dTeam: 'A' | 'B' = s.attacking === 'A' ? 'B' : 'A';
        const dlx = 1.4 - (i % 2) * 2.2;
        const d = this.L(dTeam, i);
        settle(d, s.x + dlx, s.z + s.dir * (1.2 + i * 0.7), -s.dir);
        clip(d, 'maulBind');
      }
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
          this.place(p, q.x, q.z, 'bound');
          p.vx = 0; p.vz = 0;
        } else {
          /* NO-TELEPORT: the ease is proportional to the WHOLE remaining gap,
           * so a man 20 m from his slot took a 2.5 m first step. Cap the step
           * at a sprint per frame — he runs in, he does not lurch. */
          const k = Math.min(1 - Math.exp(-dt * 8), 0.16 / Math.max(0.01, Math.hypot(q.x - p.x, q.z - p.z)));
          p.x += (q.x - p.x) * k;
          p.z += (q.z - p.z) * k;
          if (Math.hypot(q.x - p.x, q.z - p.z) < 0.5) { p.vx *= 0.5; p.vz *= 0.5; }
        }
        p.face = q.team === s.attacking ? 1 : -1;
        if (q.role === 'CARRIER') clip(p, 'grounded');
        else if (q.role === 'JACKAL') clip(p, 'jackal');
        else if (q.role === 'FIRST CLEARER') clip(p, 'cleanout');
        else if (q.role === 'CLEANER') clip(p, s.stage === 'PLACE' ? 'cleanout' : 'maulBind');
        else if (q.role === 'TACKLER') clip(p, 'tackle');
        else clip(p, s.ruckFormed ? 'maulBind' : 'ready');
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
          this.place(dist9, baseX, baseZ, 'bound');
          dist9.vx = 0; dist9.vz = 0;
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

      if (prepping) {
        /* T-32. The kicker walks to the tee, everyone else holds and watches.
         * During FANFARE he stands; during WALKUP he closes on the ball. */
        if (s.stage === 'WALKUP' && Math.hypot(k.x - s.bx, k.z - (s.bz - s.dir * 1.1)) > 0.8) {
          k.tx = s.bx;
          k.tz = s.bz - s.dir * 1.1;
          k.urgency = 0.7;
          k.job = 'WALK TO THE TEE';
          k.face = s.dir;
          steer(k, dt, false);
          clip(k, 'jog');
        } else {
          k.face = s.dir;
          clip(k, 'ready');
          k.vx = 0; k.vz = 0;
        }
        for (const p of this.live) {
          if (p === k || p.sinbin > 0) continue;
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
              this.place(p, f.x, f.z, 'restart');
              p.vx = 0; p.vz = 0;
              p.face = p.team === s.kicker ? s.dir : -s.dir;
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

  /**
   * T-02 — the single sanctioned way for a system other than `steer()` to move a
   * player. Warns in dev when a player is moved twice in one frame by two
   * different systems, which is the root of the teleport bugs.
   */
  place(p: Live, x: number, z: number, who: string) {
    if (import.meta.env.DEV && p.movedBy && p.movedBy !== who) {
      console.warn(`[T-02] shirt ${p.num} (${p.team}) moved by ${p.movedBy}, then ${who} in one frame (phase ${this.phase})`);
    }
    p.movedBy = who;
    p.x = x;
    p.z = z;
  }

  private think(dt: number, input: Input) {
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

    /* A KICK IS OWNED BY placeBound. If think() also assigned targets here it
     * would drag the defensive line back on top of the ball — which is exactly
     * the encroachment at the kick-off — and it would fight placeBound for
     * control of the chasers, moving several players twice per frame. */
    const KICK = this.kk;
    if (KICK) {
      const ch = this.ctrlPlayer;
      if (ch && this.isHuman(ch.team) && !ch.down && KICK.stage === 'FLIGHT'
        && !KICK.chasers.some((c) => c.num === ch.num)) {
        ch.controlled = true;
        const lat = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const dep = (input.up ? 1 : 0) - (input.down ? 1 : 0);
        const sp = maxSpeed(ch, false, input.sprint, ch.stamina);
        ch.vx = approach(ch.vx, lat * sp * 0.86, 9, dt);
        ch.vz = approach(ch.vz, dep * sp * 0.94, 7, dt);
        ch.x = clamp(ch.x + ch.vx * dt, -34, 34);
        ch.z = clamp(ch.z + ch.vz * dt, -60, 60);
      }
      separate(this.live, dt);
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
        if ((q.z - carC.z) * dir < 0.5 && Math.hypot(q.x - carC.x, q.z - carC.z) < 16) coverChase.add(q.num);
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
        ctrlHuman.controlled = true;
        const lat = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const dep = (input.up ? 1 : 0) - (input.down ? 1 : 0);
        const sprint = input.sprint || input.run;
        // T-39. SHIFT is a sustained sprint (×1.24). SPACE's burst stacks a short
        // ×1.15 on top for 0.8 s, so the two read as distinct — one you hold,
        // one you pop to beat a man.
        const burstMul = this.op && this.op.burst > 0 ? 1.15 : 1;
        const sp = maxSpeed(ctrlHuman, this.op?.carrierNum === ctrlHuman.num, sprint, ctrlHuman.stamina) * burstMul;
        // WASD is relative to the camera by default, so the stick always agrees
        // with what the player can see whatever the rig is doing.
        const m = mapInputToWorld(lat, dep, this.cam.yaw, dir, this.relativeControls);
        ctrlHuman.vx = approach(ctrlHuman.vx, m.vx * sp * 0.9, 9, dt);
        ctrlHuman.vz = approach(ctrlHuman.vz, m.vz * sp * 0.9, 7, dt);
      ctrlHuman.x = clamp(ctrlHuman.x + ctrlHuman.vx * dt, -34.2, 34.2);
      ctrlHuman.z = clamp(ctrlHuman.z + ctrlHuman.vz * dt, -60, 60);
      if (Math.abs(ctrlHuman.vz) > 0.4) ctrlHuman.face = ctrlHuman.vz > 0 ? 1 : -1;
      const sp2 = Math.hypot(ctrlHuman.vx, ctrlHuman.vz);
      ctrlHuman.clipT += dt;
      ctrlHuman.clip = sp2 > 7.4 ? (ctrlHuman.carrier ? 'carry' : 'sprint')
        : sp2 > 3.4 ? (ctrlHuman.carrier ? 'carry' : 'jog')
          : sp2 > 0.7 ? 'jog' : 'ready';
      if (sp2 > 7.0) ctrlHuman.stamina = clamp(ctrlHuman.stamina - dt * 4.4, 0, 100);
    }

    // ---- everyone else ----
    for (const p of this.live) {
      if (p === ctrlHuman && p.controlled) continue;
      if (p.sinbin > 0) { p.urgency = 0; continue; }
      /* T-40. While a pass is in flight the receiver is owned by upOpen, not by
       * the shape. Skipping him here stops think() from yanking him back to his
       * support mark — which is what made him teleport onto the ball. */
      if (this.op?.ball.live && p.team === this.op.attacking && p.num === this.op.pendingReceiver) continue;
      if (isBound(p) || p.down) { p.bound = true; continue; }
      p.bound = false;

      const onAtk = p.team === atk;
      const c: RoleContract = contractFor(p.num);

      if (onAtk) {
        // carrier: driven by phase logic, not by shape
        if (this.op && p.num === this.op.carrierNum) { p.carrier = true; p.urgency = 0; continue; }

        // The seven rides the carrier's hip and the eight trails — the offload
        // options — unless the shape needs them in a pod on the far side.
        const slot = atkShape.slots.find((q) => q.num === p.num);
        const hipMan = p.num === 7 || p.num === 8;
        const podFar = slot ? Math.abs(slot.lat) > 14 : false;
        if (this.op && hipMan && !podFar) {
          const car = this.L(atk, this.op.carrierNum);
          const off = p.num === 7 ? 1.9 : -1.4;
          p.tx = clamp(car.x + off, -33, 33);
          p.tz = clamp(car.z - dir * (p.num === 7 ? 1.6 : 4.0), -59, 59);
          /* T-18. THE SECOND WAVE. Through a broken line the support does
           * not jog — the offload has to be at full pace or the cover
           * meets the ball-carrier alone. 0.92 urgency left the seven
           * trailing every break by two metres a second. */
          p.urgency = this.op?.lineBreak ? 1 : 0.92;
          p.job = c.job.OPEN_PLAY ?? 'SUPPORT THE CARRIER AT THE HIP';
          steer(p, dt, true);
          continue;
        }

        /* T-13 resolution order: 1) dataset, 2) shape slot, 3) contract.
         * The seven and eight keep the carrier's hip (see above) — the
         * offload lanes the calibrated attack runs on; the dataset's
         * authored trail lines would pull them ten metres off it. */
        if (slot) {
          const sit = p.team === 'A' ? sitA : sitB;
          const dsm = sit ? datasetMark(p.team, p.num, sit, beat) : null;
          if (dsm) {
            p.tx = clamp(dsm.x, -33, 33);
            let z = dsm.z;
            /* T-13/T-18. The authored red-zone beats march the pods to the
             * 22 and hold them 15 m out — an honest arrival, but nobody
             * threatens the line from there and tries died to zero. Inside
             * 20 m the dataset owns the APPROACH (lateral spot, job, timing)
             * and the engine owns the DRIVE: the mark is flattened to the
             * same pick-and-go depth the shape fix uses, so the carries,
             * the dive and the reach-over actually happen. */
            if (sit === 'red-zone-22' && this.op) {
              const o = this.op;
              const toLine = o.dir > 0 ? FIELD.tryZFar - o.carrierZ : o.carrierZ - FIELD.tryZ;
              if (toLine < 20) {
                const deepest = o.carrierZ - o.dir * (0.5 + toLine * 0.08);
                z = o.dir > 0 ? Math.max(z, deepest) : Math.min(z, deepest);
              }
            }
            p.tz = clamp(z, -59, 59);
            p.job = dsm.job;
            p.urgency = 0.9;
            steer(p, dt, true);
            continue;
          }
        }

        // Otherwise the man stands where the shape says he stands.
        if (slot) {
          const lateral = slot.lat * (0.62 + this.slider(atk, 'width') / 100 * 0.62) * atkShape.width;
          let depth = slot.depth * atkShape.depthBias * (0.7 + (this.slider(atk, 'tempo') / 100) * 0.5);
          /* T-18. Inside the opposition 14 the shape goes FLAT — pick and go
           * from the base. At full depth the pod caught the ball three metres
           * behind the ruck and every red-zone phase LOST three metres of
           * ground: attacks entered at eight metres out and marched slowly
           * back to halfway. */
          const toLine = dir > 0 ? FIELD.tryZFar - s.ballZ : s.ballZ - FIELD.tryZ;
          if (toLine < 20) depth = Math.min(depth, 0.5 + toLine * 0.08);
          // Flip the shape if the attack is going the other way.
          const flip = this.op && this.op.open < 0 ? -1 : 1;
          p.tx = clamp(f.x + lateral * s.open * flip, -33, 33);
          p.tz = clamp(f.z - dir * depth, -59, 59);
          p.job = slot.job;
          /* T-18. The backline takes the ball at PACE. The old 0.66 jog meant
           * receivers arrived at the line standing still and were tackled on
           * the catch — the attack never crossed the gain line and there were
           * eight phases inside the ten-metre zone per four matches. Real
           * backlines run onto the ball; the wide man still waits a beat. */
          p.urgency = slot.role === 'FRONT_PRONG' ? 0.86
            : slot.role === 'INSIDE_PRONG' ? 0.9
              : slot.role === 'WIDE_1' ? 0.7 : 0.88;
        } else {
          const m = attackMark(p.num, s);
          p.tx = m.x; p.tz = m.z;
          p.job = m.job;
          p.urgency = 0.6;
        }
      } else if (convergers.has(p.num)) {
        // CONVERGE. The defenders whose channel the carrier is running into leave
        // the line and go and make the tackle. Without this branch nobody ever
        // closed on the carrier, because the shape mark was reassigned over the
        // top of the pursuit logic every frame.
        const car = this.L(atk, this.op!.carrierNum);
        const lead = 0.4;
        p.tx = clamp(car.x, -33, 33);
        p.tz = clamp(car.z - this.op!.dir * lead, -58, 58);
        p.job = defSys.job;
        p.urgency = 1;
      } else if (coverChase.has(p.num)) {
        // T-13 cover chase: beaten men hunt the carrier at full tilt.
        const car = this.L(atk, this.op!.carrierNum);
        p.tx = clamp(car.x, -33, 33);
        p.tz = clamp(car.z, -58, 58);
        p.job = 'COVER CHASE — RUN HIM DOWN';
        p.urgency = 1;
      } else if (this.kk && this.kk.stage === 'FLIGHT' && p.team === this.receivingSide()) {
        // FIELD THE KICK. The receiving side runs to where the ball will land.
        const lp = this.landingPrediction();
        const home = defenceMark(p.num, s);
        if (lp) {
          const mine = lp.x + (DEFENCE_CHANNELS.find((q) => q.num === p.num)?.lat ?? (home.x - f.x)) * 0.35;
          p.tx = clamp(mine, -33, 33);
          p.tz = clamp(lp.z - (this.kk.dir > 0 ? 1 : -1) * 1.2, -58, 58);
          p.urgency = 0.95;
          p.job = 'GET TO WHERE THE BALL IS GOING TO DROP';
        } else { p.tx = home.x; p.tz = home.z; p.urgency = 0.5; }
      } else {
        /* T-13: the dataset first for the line men too — the authored fold,
         * pillar and chase beats are richer than the channel map. The
         * pursuit and kick-fielding branches above are event-driven and
         * stay exactly as they are. */
        const sitD = p.team === 'A' ? sitA : sitB;
        const dsm = sitD ? datasetMark(p.team, p.num, sitD, beat) : null;
        if (dsm) {
          p.tx = clamp(dsm.x, -33, 33);
          p.tz = clamp(dsm.z, -59, 59);
          p.job = dsm.job;
          p.urgency = 0.85;
        } else {
        // HOLD THE LINE. Everyone else keeps the shape connected so a hole wider
        // than the system allows cannot open.
        const ch = DEFENCE_CHANNELS.find((q) => q.num === p.num);
        const m = defenceMark(p.num, s);
        let lat = (ch ? ch.lat : (m.x - f.x)) * (0.72 + this.slider(def, 'lineSpeed') / 100 * 0.4);
        let tx = f.x + lat;
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
        const tz = f.z + dir * (m.z - f.z) * 0.9 + dir * umb;
        p.tx = clamp(tx, -33, 33);
        p.tz = clamp(tz, -59, 59);
        p.job = defSys.job;
        const react = 1 - clamp((100 - p.attrs.AWA) / 400, 0, 0.22);
        /* T-18. THE GRIND BENDS THE LINE. A defence that has given up the
         * gain line six phases running is backpedalling: line speed decays
         * with the attack's consecutive-phase count, capped at 15% — a
         * ten-phase grind is supposed to bend, not reset fresh every ruck.
         * This is team-agnostic physics-of-fatigue, not difficulty: both
         * defences get it equally, and it resets the moment possession
         * turns over. */
        const defFatigue = 1 - Math.min(0.15, Math.max(0, this.phasesGained - 3) * 0.03);
        p.urgency = clamp((0.45 + defSys.lineSpeed / 12) * react, 0.28, 1) * defFatigue;
        }
      }

      // CPU difficulty raises decision quality only, never speed
      if (!this.isHuman(p.team)) p.urgency = clamp(p.urgency * (0.86 + diff.reaction * 0.18), 0, 1);
      // T-24b. Convergers sprint to the tackle. They were jogging because the old
      // call only sprinted the controlled player — the carrier simply outran the
      // defence and tackles never happened.
      steer(p, dt, (input.sprint && p === ctrlHuman) || convergers.has(p.num) || coverChase.has(p.num));
    }

    separate(this.live, dt);
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
    if (Math.hypot(car.x - gx, car.z - gz) < 1.2) {
      cx = gx; cz = gz;
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
      supports: [], defenders: [],
      gained, toLine: Math.abs(dir * 50 - z), z, pressure: 0, phase,
      lineBreak: false,
      current: { label: '' },
      burst: 0, burstCd: 0, stepCd: 0, fendCd: 0,
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
      pendingReceiver: num, passT: 0,
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
        const lp = this.landingPrediction();
        const t = lp ?? { x: this.kk.bx, z: this.kk.bz };
        const rec = assignReceiver(this.live, this.receivingSide(), t.x, t.z);
        if (rec) this.setCtrl(this.receivingSide(), rec.num);
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
    if (!this.op) { this.passOpts = []; return; }
    const car = this.L(this.op.attacking, this.op.carrierNum);
    const wet = wetnessOf(WEATHERS[this.options.weather ?? 1]);
    this.passOpts = passOptions(car, this.live, this.op.open, false, wet);
  }

  upOpen(dt: number, _input: Input, pressed: Set<string>) { /* T-03: engine/open */ return upOpen(this, dt, _input, pressed); }


  contextLabel(s: OpenPlayState): string { /* T-03: engine/open */ return contextLabel(this, s); }


  doStep(dt: number) { /* T-03: engine/open */ return doStep(this, dt); }


  doFend() { /* T-03: engine/open */ return doFend(this); }


  doDummy() { /* T-03: engine/open */ return doDummy(this); }


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
    this.lastCall = chosen.call;
    this.lastCallZ = this.focusPoint().z;
    this.cpuPlan = chosen.plan;
    this.op.aiPlay = chosen.call;
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
    this.possession = team;
    this.clearRuck();
    for (let i = 1; i <= 8; i++) { this.L(team, i).bound = true; this.L(this.defending(), i).bound = true; }
    this.ml = {
      t: 0, stage: 'ENGAGE', x, z, dir, yaw: 0,
      forceA: 2600 + this.teams[team].nation.att.maul * 26,
      forceD: 2400 + this.teams[this.defending()].nation.att.maul * 24,
      ballRank: 1, ranks, speed: 0, gained: 0,
      stallClock: 0, stoppedOnce: false, useItCalled: false, warned: false,
      tryLineZ: dir > 0 ? FIELD.tryZFar : FIELD.tryZ, attacking: team,
      committed: 5, transferCd: 0, fromLineout,
    };
    this.phase = 'MAUL';
    if (fromLineout) this.say('CAUGHT, AND THE MAUL IS FORMED');
    this.setCtrl(team, 8);
    if (this.isHuman(team)) this.showHint('A/D DRIVE · SPACE MOVE THE BALL TO THE TAIL · L USE IT', 3);
  }

  upMaul(dt: number, input: Input, pressed: Set<string>) { /* T-03: engine/setpieces */ return upMaul(this, dt, input, pressed); }


  /* ============================ SCRUM ============================ */

  scrumSlots(feed: 'A' | 'B', ax: number, az: number): ScrumSlot[] { /* T-03: engine/setpieces */ return scrumSlots(this, feed, ax, az); }


  startScrum(feed: 'A' | 'B', x: number, z: number) {
    this.possession = feed;
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
        { team: 'A', x: this.scrumAnchor.x + 2.1, z: this.scrumAnchor.z - 1.0 },
        { team: 'B', x: this.scrumAnchor.x - 2.1, z: this.scrumAnchor.z + 1.0 },
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
    const team = this.possession;
    const num = this.op?.carrierNum ?? (this.ml ? 8 : 8);
    const p = this.teams[team].players[num - 1];
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
      a.size = p.size;
      a.num = p.num; a.team = p.team;
      a.ring = p.controlled ? 1 : (this.passOpts.some((o) => o.player === p) ? 2 : 0);
    }
    // referee shadows the ball at a constant officious distance
    const f = this.focusPoint();
    const dir = this.possession === 'A' ? 1 : -1;
    const ref = this.actors[30];
    ref.rx = f.x * 0.4 + 8;
    ref.rz = f.z - dir * 11;
    ref.renderClip = this.refSignal > 0 ? 'refSignal' : 'refReady';
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
