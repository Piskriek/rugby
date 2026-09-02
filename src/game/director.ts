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
  Camera, View, FIELD, PitchConditions, pitchConditions,
} from '../render/retro';
import { CamMode, CamModeSpec, ZoomSetting, camModeSpec, resolveZoom, mapInputToWorld } from './camera';
import { TutorialState, newTutorial, stepAt, TUTORIAL } from './tutorial';
import {
  shapeById, defenceById, DEFENCE_CHANNELS, ARCHETYPE_SHAPE,
  callPlay, zoneOf, PlayCall, RESTART_RECEIVE, RESTART_KICK, CHASE_LANES, CHASE_ORDER,
  AttackShape, DefenceSystem,
} from './shapes';
import {
  Nation, TEAM_BY_ID, KITS, FORMATION_BY_ID, DIFFICULTY_TABLE, AI_ARCHETYPES,
  REFEREE_CALLS, POINTS, SquadPlayer,
} from './data';
import {
  COMMENTARY_PAIRS, contractFor, PhaseName, RoleContract,
} from './jlr';
import {
  Live, steer, separate, attackMark, defenceMark, ShapeInput, passOptions, PassOption,
  assignCrew, ruckDistributor, assignReceiver,
  widestGap, avoidTouch, maxSpeed, FORWARDS,
} from './intelligence';

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

function wetnessOf(weather: string): number {
  return weather === 'RAIN' ? 1 : weather === 'DRIZZLE' ? 0.55 : weather === 'GALE' ? 0.4 : weather === 'FOG' ? 0.35 : 0.12;
}
function windOf(o: Record<string, number>): number {
  return [0.02, 0.12, 0.24, 0.4, 0.55][o.wind ?? 1] ?? 0.12;
}
const WEATHERS = ['CLEAR', 'OVERCAST', 'DRIZZLE', 'RAIN', 'FOG', 'COLD SNAP', 'GALE'];

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
  private shakeT = 0;

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

  private L(team: 'A' | 'B', num: number): Live {
    return this.live.find((p) => p.team === team && p.num === num) ?? this.live[0];
  }
  private run(team: 'A' | 'B', num: number): PlayerRun {
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

  commentate(key: string, extra?: string) {
    const bank = COMMENTARY_PAIRS.find((c) => c.key === key);
    if (!bank) return;
    // no-repeat window so the same pair never fires twice in a row
    let pick = bank.lines[Math.floor(R() * bank.lines.length)];
    for (let i = 0; i < 4 && this.feed[0]?.text === pick[0]; i++) {
      pick = bank.lines[Math.floor(R() * bank.lines.length)];
    }
    const last = this.feed[0]?.at ?? -99;
    if (this.t - last < 0.35) return;
    this.feed.unshift({ text: pick[0], text2: pick[1], at: this.t });
    if (extra) this.feed[0].text += ` ${extra}`;
    if (this.feed.length > 30) this.feed.pop();
  }

  say(text: string) { this.feed.unshift({ text, at: this.t }); if (this.feed.length > 30) this.feed.pop(); }
  banner_(text: string) { this.banner = text; this.bannerAt = this.t; }
  showHint(text: string, secs = 4) { this.hint = text; this.hintUntil = this.t + secs; }

  /** Every law is explained in one line the first time it is applied. */
  lawCall(key: string, call: string, team: 'A' | 'B') {
    this.refSignal = 1.8;
    this.refSignalText = call;
    this.teams[team].stats.penaltiesConceded++;
    this.say(call);
    if (!this.lawsExplained.has(key)) {
      this.lawsExplained.add(key);
      this.showHint(`LAW — ${call}`, 5);
    }
  }

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
    this.updateCamera(dt);
    this.syncActors();
    this.t += dt;

    // Hand control over whenever the phase or the possession changes.
    if (this.phase !== this.lastHandoffPhase || this.possession !== this.lastHandoffPoss) {
      const changedPhase = this.phase !== this.lastHandoffPhase;
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

  private shape(): ShapeInput {
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
    if (this.op) {
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
          p.urgency = 0.92;
          p.job = c.job.OPEN_PLAY ?? 'SUPPORT THE CARRIER AT THE HIP';
          steer(p, dt, true);
          continue;
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
        // HOLD THE LINE. Everyone else keeps the shape connected so a hole wider
        // than the system allows cannot open.
        const ch = DEFENCE_CHANNELS.find((q) => q.num === p.num);
        const m = defenceMark(p.num, s);
        let lat = (ch ? ch.lat : (m.x - f.x)) * (0.72 + this.slider(def, 'lineSpeed') / 100 * 0.4);
        let tx = f.x + lat;
        if (this.op) tx += (this.op.carrierX - f.x) * defSys.drift * 0.5;
        const umb = defSys.umbrella * (Math.abs(lat) / 22);
        const tz = f.z + dir * (m.z - f.z) * 0.9 + dir * umb;
        p.tx = clamp(tx, -33, 33);
        p.tz = clamp(tz, -59, 59);
        p.job = defSys.job;
        const react = 1 - clamp((100 - p.attrs.AWA) / 400, 0, 0.22);
        p.urgency = clamp((0.45 + defSys.lineSpeed / 12) * react, 0.28, 1);
      }

      // CPU difficulty raises decision quality only, never speed
      if (!this.isHuman(p.team)) p.urgency = clamp(p.urgency * (0.86 + diff.reaction * 0.18), 0, 1);
      // T-24b. Convergers sprint to the tackle. They were jogging because the old
      // call only sprinted the controlled player — the carrier simply outran the
      // defence and tackles never happened.
      steer(p, dt, (input.sprint && p === ctrlHuman) || convergers.has(p.num));
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

  private updateCamera(dt: number) {
    const f = this.focusPoint();
    const dir = this.possession === 'A' ? 1 : -1;

    /* OVER THE SHOULDER ON EVERY KICK.
     * While a kick is being set up the rig drops in behind the kicker at head
     * height, so the aim line reads as his line of sight. It returns to the
     * chosen mode the moment the ball is struck. */
    // The cable cam handles kicks itself by backing off and climbing, so it must
    // not be overridden. Every other mode drops to the shoulder view for a kick.
    const kicking = !!this.kk && (this.kk.stage === 'AIM' || this.kk.stage === 'METER')
      && this.camMode !== 'CABLE';
    const spec = camModeSpec(kicking ? 'SHOULDER' : this.camMode);

    const z = resolveZoom(this.camZoom, this.dynamicIntensity, {
      phase: this.phase,
      pressure: this.op?.pressure ?? 0,
      toLine: this.op?.toLine ?? 50,
      ballInAir: this.kk?.stage === 'FLIGHT',
      lineBreak: this.op?.lineBreak === true,
    });

    // Subject: the ball, pulled slightly toward the first receiver in open play
    // so the fly-half is always in shot, and toward the landing point on a kick.
    let tx = f.x, tz = f.z;
    if (this.op) {
      const first = this.L(this.op.attacking, 10);
      if (first) { tx = f.x * 0.72 + first.x * 0.28; tz = f.z * 0.82 + first.z * 0.18; }
    }
    if (this.kk && this.kk.stage === 'FLIGHT') { tx = this.kk.bx; tz = this.kk.bz; }

    const view: View = { w: 960, h: 540 };
    const height = spec.height * z.heightMul;
    const px = spec.pxPerMetre * z.pxMul;
    let target: Camera;

    if (spec.id === 'CABLE') {
      target = this.cableRig(view, spec, z, tx, tz, dir, dt);
    } else if (spec.endOn) {
      /* END-ON RIGS. The camera sits behind a point and looks down the pitch.
       * Built by hand rather than through behindPostsCam so the shoulder view can
       * sit right on the kicker instead of on the goal line. */
      const isPosts = !kicking && this.camMode === 'POSTS';
      const back = spec.standback * z.standbackMul;
      const rigX = isPosts ? tx * 0.25 : tx - (tx - (this.kk?.landX ?? tx)) * 0.08;
      const rigZ = isPosts
        ? (dir > 0 ? FIELD.tryZ - 10 : FIELD.tryZFar + 10)
        : tz - dir * back;
      const aimX = kicking ? (this.kk?.landX ?? tx) : tx;
      const aimZ = kicking ? (this.kk?.landZ ?? tz) : tz + dir * 14;
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
      if (Math.abs(subjectZ - this.rigZ) > dead) {
        this.rigZ += (subjectZ - this.rigZ) * clamp(Math.abs(subjectZ - this.rigZ) / 8, 0.2, 1);
      }
      // Lateral pan. At 4x the rig comes a long way onto the ball; at 1x it sits
      // off the touchline and lets the lens do the work.
      const rigX = (FIELD.minX - standback) + (tx - FIELD.minX) * z.track * 0.34;

      const dx = tx - rigX;
      const dz = subjectZ - this.rigZ;
      const ground = Math.max(4, Math.hypot(dx, dz));
      const tiltT = Math.atan2(height - 1.4, ground);
      const slant = Math.hypot(ground, height - 1.4);
      const focal = Math.max(1, px * slant);
      target = {
        x: rigX, z: this.rigZ, h: height,
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
      target = { ...this.cam, shake: 0 };
    }

    /* A heavy rig eases; it never snaps. This is what stops the whipping.
     * T-18: but a phase cut (dead ball → 22 drop-out, score → restart) moves
     * the subject up to 50 m. At rate 3 the rig took two seconds to arrive and
     * the ball spent the whole transit out of frame. Position, height, tilt
     * and zoom reposition quickly — none of them touch the picture angle —
     * while YAW always eases slowly: the whip gate is about angular judder,
     * and a phase cut barely changes the yaw anyway. */
    const dist = Math.hypot(target.x - this.cam.x, target.z - this.cam.z);
    const far = dist > 12;
    /* Cap the per-frame travel at 5.5 m: the cut is fast but the rig is still
     * a rig — it never moves more than a real gantry could survive. */
    const kPos = Math.min(1 - Math.exp(-dt * (far ? 8 : 3.0)), dist > 0.01 ? 5.5 / dist : 1);
    const kZoom = 1 - Math.exp(-dt * (far ? 7 : 2.2));
    const kYaw = 1 - Math.exp(-dt * 3.0);
    this.cam.x += (target.x - this.cam.x) * kPos;
    this.cam.z += (target.z - this.cam.z) * kPos;
    this.cam.h += (target.h - this.cam.h) * kZoom;
    let dy = target.yaw - this.cam.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.cam.yaw += dy * kYaw;
    this.cam.tilt += (target.tilt - this.cam.tilt) * kZoom;
    this.cam.fov += (target.fov - this.cam.fov) * kZoom;
    this.cam.horizon = target.horizon;
    this.cam.shake = this.shakeT;
    this.zoomLabel = z.label;
    /* T-20. A hard floor on every rig. No camera may sit lower than 5.5 m, which
     * is above the advertising boards and the front terrace, so nothing can ever
     * clip through the ground even mid-swing. */
    this.cam.h = Math.max(5.5, this.cam.h);
    if (!Number.isFinite(this.cam.h)) this.cam.h = 14;
  }

  zoomLabel = '2x — STANDARD';

  /* ---- cable cam state ----
   * The rig hangs on notional wires, so it has mass. It does not snap to the
   * ball; it is dragged toward a point behind the ball and swings in behind. */
  private cableX = 0;
  private cableZ = -18;
  private cableH = 13;
  private cableEase = 0;
  /** eased aim anchor for the cable rig — see cableRig (T-16/NO-WHIP) */
  private cableAX = 0;
  private cableAZ = 0;
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
   * lateral fastest, longitudinal slower, height slowest, which is exactly how
   * a real cable rig behaves under its own weight.
   */
  private cableRig(
    view: View, spec: CamModeSpec, z: { pxMul: number; heightMul: number; standbackMul: number; track: number },
    tx: number, tz: number, dir: number, dt: number,
  ): Camera {
    const k = this.kk;
    const inFlight = k?.stage === 'FLIGHT';
    const aiming = k?.stage === 'AIM' || k?.stage === 'METER';

    // Lock the end-on side unless the player asked it to swap on turnover.
    const rigDir = this.cableSwapOnTurnover ? dir : 1;

    /* On a kick the rig backs off and climbs so the flight and the chase are
     * both in frame. `cableEase` ramps that in and out rather than snapping. */
    const wantKickWide = inFlight || aiming ? 1 : 0;
    this.cableEase += (wantKickWide - this.cableEase) * (1 - Math.exp(-dt * 1.8));
    const wide = this.cableEase;

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
      const lp = this.landingPrediction();
      if (lp) { anchorX = (tx + lp.x) / 2; anchorZ = (tz + lp.z) / 2; }
    }
    this.cableAX += (anchorX - this.cableAX) * (1 - Math.exp(-dt * (inFlight ? 3.0 : 4.5)));
    this.cableAZ += (anchorZ - this.cableAZ) * (1 - Math.exp(-dt * (inFlight ? 3.0 : 4.5)));
    anchorX = this.cableAX;
    anchorZ = this.cableAZ;

    const wantX = anchorX * 0.82;                 // ease toward the middle laterally
    const wantZ = anchorZ - rigDir * trail;

    // Independent easing per axis. Lateral is quickest so the pan tracks the
    // ball across the field; height is slowest so the rig never bobs.
    // In flight the lateral rate is boosted by the wide factor: a full-range
    // touch-finder moves at 20+ m/s and the rig must keep it framed.
    this.cableX += (wantX - this.cableX) * (1 - Math.exp(-dt * (2.6 + wide * 2.4) * (0.6 + z.track * 0.8)));
    this.cableZ += (wantZ - this.cableZ) * (1 - Math.exp(-dt * 2.0));
    this.cableH += (height - this.cableH) * (1 - Math.exp(-dt * 1.4));

    // T-20 CLIPPING. The rig used to drift 24 m past the dead-ball line into the
    // rising terraces, where a 7 m camera sat BELOW the stand surface and clipped
    // through the ground. Keep it inside the in-goal and above every surface.
    this.cableX = clamp(this.cableX, -30, 30);
    this.cableZ = clamp(this.cableZ, FIELD.tryZ - 8, FIELD.tryZFar + 8);
    this.cableH = clamp(this.cableH, 9, 46);

    /* Look at a point ahead of the ball, so the frame leads play instead of
     * trailing it. The rig is always end-on: it looks the way you attack. */
    const aimX = anchorX;
    const aimZ = anchorZ + rigDir * spec.lead * (1 + wide * 0.6);
    const dx = aimX - this.cableX;
    const dz = aimZ - this.cableZ;
    const ground = Math.max(5, Math.hypot(dx, dz));

    // Tilt down onto the play. Extra downward angle when wide, so a kick reads
    // as an aerial view of the whole contest.
    const tilt = Math.atan2(this.cableH - 1.2, ground) * (1 + wide * 0.10);
    const slant = Math.hypot(ground, this.cableH - 1.2);
    const px = spec.pxPerMetre * z.pxMul * (1 - wide * 0.28);
    const focal = Math.max(1, px * slant);

    return {
      x: this.cableX, z: this.cableZ, h: this.cableH,
      yaw: Math.atan2(dx, dz),
      tilt: clamp(tilt, 0.08, 1.15),
      fov: clamp(2 * Math.atan((view.h * 0.5) / focal), 0.06, 1.2),
      shake: 0, horizon: 0.42, roll: 0,
    };
  }

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

  private upOpen(dt: number, _input: Input, pressed: Set<string>) {
    if (!this.op) { this.startOpen(this.possession, 0, -10); return; }
    const s = this.op;
    s.t += dt;
    const car = this.L(s.attacking, s.carrierNum);
    const human = this.isHuman(s.attacking);

    /* T-35. The ball is in flight from passer to receiver. Carry it across with a
     * visible arc, then hand possession over on arrival. No input is processed
     * while it flies — the pass is a commitment. */
    if (s.ball.live) {
      const rec = this.L(s.attacking, s.pendingReceiver);
      s.passT += dt * 2.6;
      /* T-40. The receiver runs onto the pass; the ball flies to where he is.
       * Nobody is snapped — the receiver was teleporting because the old code
       * set `rec.x/z = ball.x/z` on arrival while `think()` kept steering him
       * back toward his support mark. Now he runs at the ball, the ball homes
       * to him, and the catch happens where he actually stands. */
      rec.tx = clamp(s.ball.x, -33, 33);
      rec.tz = clamp(s.ball.z + s.dir * 1.0, -58, 58);
      rec.urgency = 1;
      rec.job = 'TAKE THE PASS';
      steer(rec, dt, true);

      const k = 1 - Math.exp(-dt * 12);
      s.ball.x += (rec.x - s.ball.x) * k;
      s.ball.z += (rec.z - s.ball.z) * k;
      s.ball.y = 1.05 + Math.sin(Math.min(1, s.passT) * Math.PI) * 0.8;
      const dist = Math.hypot(rec.x - s.ball.x, rec.z - s.ball.z);
      if (dist < 0.55 || s.passT >= 1.1) {
        s.ball.live = false;
        s.carrierNum = s.pendingReceiver;
        rec.carrier = true;
        // catch where the receiver actually is — no snap.
        s.ball.x = rec.x; s.ball.z = rec.z;
        s.originZ = rec.z; s.originX = rec.x; s.gained = 0;
        /* T-18. A receiver of a pass is fair game — but not in the act of
         * catching. A fifth of a second of catch grace is what lets a passing
         * movement exist at all: without it the converging defender hits the
         * receiver on the frame he takes the ball and every chain dies at one
         * pass. Reset the carry clock for the new man. */
        s.heldT = 0;
        s.protect = 0.2;
        s.aiTimer = 0.3 + R() * 0.5;
        this.setCtrl(s.attacking, s.carrierNum);
        this.run(s.attacking, s.carrierNum).carries++;
        this.refreshPassOptions();
      }
      return;
    }

    // ---- carry the carrier from the live model (single source of truth) ----
    s.carrierX = car.x; s.carrierZ = car.z;
    s.vx = car.vx; s.vz = car.vz;
    s.z = car.z;
    s.heldT += dt;
    s.gained = (car.z - s.originZ) * s.dir;
    s.toLine = Math.abs((s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ) - car.z);
    /* METRES — only ground gained toward the attacking line counts. The old
     * line multiplied by s.dir a SECOND time, so team B's metres accumulated
     * as negatives and a full match read "-38 m carried per team". */
    this.teams[s.attacking].stats.metres += Math.max(0, car.vz * dt * s.dir);
    this.run(s.attacking, s.carrierNum).metres += Math.max(0, car.vz * dt * s.dir);

    if (s.burst > 0) s.burst -= dt;
    s.protect = Math.max(0, s.protect - dt);
    s.burstCd = Math.max(0, s.burstCd - dt);
    s.stepCd = Math.max(0, s.stepCd - dt);
    s.fendCd = Math.max(0, s.fendCd - dt);

    // ---- verbs. Sampled now, resolved now, never queued. ----
    if (human) {
      // SPACE performs the context action when the player has asked for that
      if (pressed.has('action') && (this.options.spaceAction ?? 0) !== 0) { this.fireContext(); return; }
      if (pressed.has('step') && s.stepCd <= 0) { s.stepCd = 2.2; this.doStep(dt); }
      if (pressed.has('fend') && s.fendCd <= 0) { s.fendCd = 1.6; this.doFend(); }
      if (pressed.has('dummy')) this.doDummy();
      if (pressed.has('action') && s.burstCd <= 0) { s.burst = 0.8; s.burstCd = 5.5; }
      if (pressed.has('passL')) { this.doPass(-1, false); return; }
      if (pressed.has('passR')) { this.doPass(1, false); return; }
      if (pressed.has('cutL')) { this.doPass(-1, true); return; }
      if (pressed.has('cutR')) { this.doPass(1, true); return; }
      if (pressed.has('kick')) { this.startKick(s.attacking, 'PUNT', { x: car.x, z: car.z }, s.carrierNum); return; }
      if (pressed.has('grubber')) { this.startKick(s.attacking, 'GRUBBER', { x: car.x, z: car.z }, s.carrierNum); return; }
      if (pressed.has('drop')) { this.startKick(s.attacking, 'DROP_GOAL', { x: car.x, z: car.z }, s.carrierNum); return; }
      if (pressed.has('contact')) { this.startBreakdown(); return; }
      if (pressed.has('switchPlayer')) this.cycleDefender();
    } else {
      this.cpuCarrier(dt, s);
      /* T-16 FREEZE. cpuCarrier's `return`s return from cpuCarrier, not from
       * here. A pass or kick it launched has already torn down `this.op` and
       * moved the phase — continuing on with the stale `s` read `this.op!`
       * inside startBreakdown and threw ("reading 'attacking'"), which the
       * watchdog then logged as a BREAKDOWN/SCRUM freeze. Bail the moment the
       * episode we were processing is no longer live. */
      if (this.phase !== 'OPEN_PLAY' || this.op !== s || s.ball.live) return;
    }

    this.refreshPassOptions();

    // ---- scoring and boundaries ----
    const line = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
    if ((s.dir > 0 && car.z >= line) || (s.dir < 0 && car.z <= line)) { this.scoreTry(); return; }
    if (Math.abs(car.x) > 34) {
      this.say('INTO TOUCH');
      this.startLineout(this.defending(), car.z, Math.sign(car.x) * 6);
      return;
    }
    if (car.z > FIELD.deadZFar - 1 || car.z < FIELD.deadZ + 1) { this.touchDown(); return; }

    // ---- defenders: honest contact radius, honest reaction ----
    const dTeam = this.defending();
    const dForm = FORMATION_BY_ID(this.teams[dTeam].defence);
    const diff = DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)];
    const dists: { num: number; d: number }[] = [];
    for (const p of this.live) {
      if (p.beatenT > 0) p.beatenT = Math.max(0, p.beatenT - dt);
      if (p.team !== dTeam || p.sinbin > 0) continue;
      const d = Math.hypot(p.x - car.x, p.z - car.z);
      dists.push({ num: p.num, d });
      // reaction per player, capped. Never scaled up to fake difficulty.
      const react = this.isHuman(dTeam) ? 0.86 : diff.reaction;
      const aware = 1 - clamp((100 - p.attrs.AWA) / 400, 0, 0.22);
      /* T-18. The line holds its shape until the carrier is genuinely in
       * a channel (8 m, not 11): defenders shooting up early from eleven
       * metres was why every carry died on the gain line and the attack
       * never reached the 22. */
      const chase = (d < 8 || FORWARDS.includes(p.num)) && p.beatenT <= 0;
      const sp = (chase ? 6.8 : 4.2) * (0.88 + react * 0.14) * (0.7 + aware * 0.3);
      // gap seeking: defenders hold their lane, they do not ball-watch
      const mark = defenceMark(p.num, this.shape());
      /* T-18. While the ball is in FLIGHT the line holds its lane and reads
       * the pass — it does not sprint at the man who has already given it
       * up. Converging on the passer through the pass sequence gave the
       * defence three free metres every phase and the attack could never
       * close the last six metres to the line. */
      const towardBall = d < 12 && !s.ball.live;
      const driftX = towardBall ? (car.x - p.x) * 0.5 : (mark.x - p.x);
      const targetZ = towardBall ? car.z - s.dir * 0.5 : mark.z;
      const tz2 = targetZ - (towardBall ? 0 : 0);
      p.tx = clamp(p.x + clamp(driftX, -sp * dt, sp * dt), -33, 33);
      p.tz = clamp(p.z + clamp(tz2 - p.z, -sp * dt, sp * dt), -58, 58);
      p.urgency = 1;
      p.job = contractFor(p.num).job.DEFENCE_LINE ?? 'DEFEND YOUR CHANNEL';
    }
    void dForm;
    dists.sort((a, b) => a.d - b.d);
    const nearest = dists[0];
    /* T-18. The old weights (nearest/9, +0.09 per man within 11 m) meant any
     * carrier with the regulation three convergers nearby read pressure ~0.94
     * — "a defender is physically on him" — and every downstream gate (pass,
     * offload, sprint, take contact) behaved as if he was being tackled. With
     * honest weights, ~0.7 is heavily marked; only sub-metre contact reads
     * above 0.9. This one formula was why a match produced twenty passes. */
    const ring = dists.filter((x) => x.d < 11).length;
    s.pressure = approach(s.pressure, clamp(1 - (nearest?.d ?? 9) / 7 + ring * 0.04, 0, 1), 5, dt);
    /* T-18. A line break is beating the line and coming clear — six metres
     * through a set defensive line (with the beat man recovering behind the
     * play) is a genuine break; the old nine counted once-a-match accidents. */
    if (s.gained > 6 && !s.lineBreak) {
      s.lineBreak = true;
      this.teams[s.attacking].stats.lineBreaks++;
      this.run(s.attacking, s.carrierNum).breaks++;
      this.commentate('LINE_BREAK');
    }

    // ---- the human defender chooses his tackle ----
    if (!human) { /* CPU tackles resolve below */ }
    else if ((pressed.has('tackleDive') || pressed.has('tackleSmother')) && s.protect <= 0) {
      const dive = pressed.has('tackleDive');
      // honest ranges: a dive reaches 3.5 m, a smother 1.4 m
      const reach = dive ? 3.5 : 1.4;
      const d = nearest ? nearest.d : 9;
      if (d <= reach) {
        const tacklerNum = nearest!.num;
        const tp = this.L(dTeam, tacklerNum);
        const safe = dive ? 0.86 : 0.95;             // smother is safer, no chase value
        const grip = tp.attrs.PWR;
        const chance = clamp((safe + grip / 400 - car.attrs.PWR / 420) * (0.85 + this.assists.tackle * 0.25), 0.4, 0.98);
        this.setCtrl(dTeam, tacklerNum);
        if (R() < chance) { this.startBreakdown(tacklerNum); return; }
        this.teams[dTeam].stats.missed++;
        this.commentate('BIG_HIT', '— AND HE MISSES HIM!');
        tp.urgency = 0.25;
      } else {
        this.showHint(`OUT OF RANGE — DIVE REACHES 3.5 m, YOU ARE ${d.toFixed(1)} m AWAY`, 1.6);
      }
    }

    /* ---- the tackle: an honest 1.1 m contact radius, no warping ----
     * `protect` is the answer to the ball going straight back into the ruck. When
     * the nine plays it away from a breakdown the defence has to be behind the
     * offside line and cannot legally touch him for the first stride. Without
     * this the nearest defender was on the new carrier inside two frames and the
     * match became one endless ruck. */
    if (nearest && nearest.d < 1.1 && s.protect <= 0) {
      const carrierP = car;
      const tackler = this.L(dTeam, nearest.num);
      const grip = tackler.attrs.PWR;
      const assist = this.isHuman(dTeam) ? this.assists.tackle : 0.5;
      const chance = clamp(0.6 + grip / 340 - carrierP.attrs.PWR / 420 + assist * 0.2, 0.35, 0.95);
      /* T-18 — THE SLIPPED TACKLE. Every contact used to end in a tackle:
       * the roll retried every frame until it succeeded, so a defender who
       * reached the ball simply waited him out. Real matches slip eight to
       * twelve tackles, and that is where line breaks — and tries — come
       * from. Once per defender per episode, first contact can be beaten:
       * the tackler is bounced and needs a second to reset. */
      if (!s.beatTried) s.beatTried = new Set<number>();
      if (!s.beatTried.has(nearest.num)) {
        s.beatTried.add(nearest.num);
        const slip = clamp(0.07 + (carrierP.attrs.SKL - tackler.attrs.SKL) / 900 + (carrierP.attrs.PWR - grip) / 1000, 0.03, 0.18);
        if (R() < slip) {
          this.teams[dTeam].stats.missed++;
          this.commentate('BIG_HIT', '— AND HE BEATS THE TACKLE!');
          tackler.beatenT = 1.1 + R() * 0.5;
          tackler.urgency = 0.3;
          /* He steps THROUGH the tackle — the burst is what turns a slipped
           * tackle into a line break instead of a slow stumble past a fallen
           * defender. */
          car.vz += s.dir * 2.2;
          car.vx += (R() - 0.5) * 1.2;
        }
      }
      if (tackler.beatenT <= 0 && R() < chance * dt * 10) {
        /* T-18 — THE REACH. A carrier driven at the line from close range
         * grounds it before the tackle can hold him up. This low drive over
         * the line is how close-range tries are actually scored; without it
         * the tackle froze him half a metre short every time and the red
         * zone converted nothing. */
        const line = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
        const distLine = (line - car.z) * s.dir;
        if (distLine < 1.4 && car.vz * s.dir > 1.2 && R() < 0.34 + car.attrs.PWR / 300) { this.scoreTry(); return; }
        this.startBreakdown(nearest.num);
        return;
      }
      if (R() < 0.1 * dt * 10) this.commentate('BIG_HIT');
    }

    /* OFFSIDE — there is no offside line in open play. The law applies at a set
     * piece and at a ruck or maul, where the line is the hindmost foot. Penalising
     * defenders for standing near the ball in open play was a law error and it
     * was producing penalties constantly. See upBreakdown for the real line. */
    void dTeam;

    s.current.label = this.contextLabel(s);
  }

  private contextLabel(s: OpenPlayState): string {
    const car = this.ctrlPlayer;
    if (car.team === s.attacking) {
      const l = this.passOpts.find((o) => o.side === -1);
      const r = this.passOpts.find((o) => o.side === 1);
      return [
        `J PASS ${l ? this.L(s.attacking, l.player.num).num : '—'}`,
        `K PASS ${r ? this.L(s.attacking, r.player.num).num : '—'}`,
        'L PUNT', 'H GRUBBER', 'P DROP', 'I CONTACT', 'F FEND', 'G STEP',
      ].join(' · ');
    }
    return 'X DIVING TACKLE · C SMOTHER · Q SWITCH DEFENDER';
  }

  private doStep(dt: number) {
    const s = this.op!;
    const car = this.L(s.attacking, s.carrierNum);
    // a step only beats a square-on defender inside 2.5 m
    const dTeam = this.defending();
    const near = this.live
      .filter((p) => p.team === dTeam)
      .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))[0];
    const d = near ? Math.hypot(near.x - car.x, near.z - car.z) : 9;
    const square = near ? Math.abs(near.x - car.x) < 2.5 : false;
    if (!square || d > 2.6) { this.showHint('NO ROOM TO STEP — THE DEFENDER IS LATERAL', 1.6); return; }
    const chance = clamp(0.82 - d * 0.07 + (car.attrs.SPD / 500), 0.15, 0.88);
    if (R() < chance) {
      /* T-16/NO-TELEPORT. The step used to write `car.x ± 3.4` outright — an
       * instantaneous 3.4 m slide, over twice the teleport threshold. It is now
       * a lateral velocity impulse; the feet carry him there. */
      const side = R() < 0.5 ? -1 : 1;
      car.vx = approach(car.vx, side * 6.4, 14, dt);
      // defender recovers in 0.6 s, so a step buys space rather than a free run
      near.urgency = 0.25;
      this.say('HE STEPS OUT OF THE TACKLE');
      this.shake(0.24);
    } else {
      s.pressure = clamp(s.pressure + 0.32, 0, 1);
    }
  }

  private doFend() {
    const s = this.op!;
    const car = this.L(s.attacking, s.carrierNum);
    const dTeam = this.defending();
    const near = this.live
      .filter((p) => p.team === dTeam)
      .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))[0];
    if (!near || Math.hypot(near.x - car.x, near.z - car.z) > 1.6) { this.showHint('NOBODY TO FEND', 1.4); return; }
    const contest = car.attrs.PWR / (car.attrs.PWR + near.attrs.PWR);
    if (R() < contest) {
      car.vz = Math.max(car.vz, s.dir * 5.4);
      this.teams[s.attacking].stats.tacklesBroke++;
      this.run(s.attacking, s.carrierNum).breaks++;
      this.commentate('BIG_HIT', '— FENDED OFF');
      this.shake(0.3);
    } else {
      this.startBreakdown(near.num);
    }
  }

  private doDummy() {
    const s = this.op!;
    const dTeam = this.defending();
    // a dummy bites the inside defender for 0.35 s, opening the outside channel
    for (const p of this.live) {
      if (p.team !== dTeam) continue;
      if (Math.hypot(p.x - s.carrierX, p.z - s.carrierZ) < 9) {
        p.tz = p.z - s.dir * 0.8;
        p.urgency = 0.3;
      }
    }
    this.say('DUMMY — AND THE DEFENCE BITES');
  }

  /**
   * A pass is always thrown to a named player, always forward of the passer,
   * and always into the path of a man who is already moving.
   */
  private doPass(side: -1 | 1, cutOut: boolean) {
    const s = this.op!;
    const car = this.L(s.attacking, s.carrierNum);
    const wet = wetnessOf(WEATHERS[this.options.weather ?? 1]);
    const opts = passOptions(car, this.live, s.open, cutOut, wet);
    const opt = opts.find((o) => o.side === side);
    if (!opt) {
      this.showHint(cutOut ? 'NOBODY TO SKIP TO ON THAT SIDE' : 'NO RECEIVER ON THAT SIDE', 1.6);
      return;
    }
    this.teams[s.attacking].stats.passes++;
    this.run(s.attacking, s.carrierNum).passes++;

    // assist widens the window rather than removing the error
    /* T-18. Professional teams complete ~90% of passes, even in traffic —
     * the old rate threw 8-15% away, and the red zone (every receiver
     * covered, every pass at the risk cap) turned over half its entries on
     * spilled balls. The risk model still decides WHICH passes are hard; the
     * absolute rate is calibrated to the real thing. */
    const errorChance = clamp(opt.risk * 0.45 * (1 - this.assists.pass * 0.5), 0.008, 0.18);
    if (R() < errorChance) {
      const strict = this.options.fwdPass ?? 1;
      if (strict < 2 && R() < 0.5) {
        this.lawCall('FWD_PASS', REFEREE_CALLS.FWD_PASS, s.attacking);
        this.startScrum(this.defending(), car.x, car.z);
      } else {
        this.commentate('MISSED');
        this.startScrum(this.defending(), car.x, car.z);
      }
      return;
    }

    // T-35. The receiver is already moving; the ball flies to him instead of
    // teleporting. Launch the flight — upOpen carries it to the target.
    opt.player.vz = s.dir * maxSpeed(opt.player, false, false, opt.player.stamina) * 0.8;
    opt.player.face = s.dir >= 0 ? 1 : -1;

    s.ball.live = true;
    s.ball.x = car.x;
    s.ball.z = car.z;
    s.ball.y = 1.05;
    s.pendingReceiver = opt.player.num;
    s.passT = 0;
    if (cutOut) this.say(`CUT-OUT PASS TO ${this.L(s.attacking, opt.player.num).num}`);
  }

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

  private cpuCarrier(dt: number, s: OpenPlayState) {
    const diff = DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)];
    const car = this.L(s.attacking, s.carrierNum);
    const call = (this.lastCall ?? 'POD_CARRY') as PlayCall;
    s.aiTimer -= dt;
    if (s.aiTimer <= 0) {
      /* T-18. A passing play releases the ball quickly — a real backline moves
       * it on in ~0.3 s, long before the converging defence (0.9+ pressure)
       * can force contact. The old 0.45-1.15 s cadence lost that race three
       * times in four and every called pass died as contact. */
      const passingPlay = ['WIDE_SWEEP', 'MISS_PASS', 'TUNNEL_PASS', 'LOOPL_PASS', 'POD_TIP', 'SWITCH', 'CROSS_FIELD'].includes(call);
      /* T-18. The phase clock runs at the compressed match rate: a backline
       * moves the ball on inside ~0.25 s and even a carry decides inside half
       * a second. The old one-second cadence made every phase three times the
       * length of a real one and halved the whole match's event density. */
      s.aiTimer = passingPlay ? 0.18 + R() * 0.22 : 0.3 + R() * 0.42 * (1 - diff.reaction * 0.4);
      const toLine = s.dir > 0 ? FIELD.tryZFar - car.z : car.z - FIELD.tryZ;
      let intent = 'CARRY';
      switch (call) {
        /* T-18. The pass off the ruck IS the play: a first receiver takes the
         * ball flat with the defence a metre away — pressure at the exit of a
         * ruck is ~0.9 by construction (the offside line puts the defence
         * there), so the old >0.85 gate converted every called pass into
         * contact and a whole match produced three passes. Only a defender
         * genuinely on him (0.93+) forces contact instead. */
        case 'WIDE_SWEEP': case 'MISS_PASS': case 'TUNNEL_PASS': case 'LOOPL_PASS':
          /* The protect window (the lawful beat after a ruck exit) is not
           * "a defender is on him" — nobody may touch him in it. Pressure is
           * ~0.9 by construction at the exit (the offside line puts the
           * defence a metre away), so without this gate every called pass
           * became contact and a match produced three passes. */
          intent = (s.pressure > 0.93 && s.protect <= 0) ? 'CONTACT' : 'PASS'; break;
        case 'POD_TIP': case 'SWITCH': intent = R() < 0.45 ? 'PASS' : 'CARRY'; break;
        case 'BOX_KICK': intent = s.carrierNum === 9 ? 'KICK' : 'PASS'; break;
        case 'TERRITORY_PUNT': case 'BOMB': case 'CROSS_FIELD': intent = 'KICK'; break;
        case 'DROP_GOAL': intent = toLine < 40 ? 'DROP' : 'CARRY'; break;
        default: intent = 'CARRY';
      }
      /* T-18 — THE NINE'S PASS. When the scrum-half (or the acting
       * distributor) is the carrier coming off a ruck, the pass to the first
       * receiver IS the phase: that single act is the majority of passes in
       * any real match, and its absence was the single biggest gap between
       * this sim's box score and a real one (23 vs ~250 passes a match). */
      /* A wide-play call is NOT the nine's kick to take — the scrum-half
       * distributes and the TEN kicks it. Without this, an escalated
       * CROSS_FIELD call made the nine punt from the base on first phase. */
      if (s.carrierNum === 9 && intent === 'KICK' && call !== 'BOX_KICK' && call !== 'TERRITORY_PUNT') {
        intent = this.passOpts.length ? 'PASS' : 'CARRY';
      }
      /* T-18 — THE PICK AND GO. Inside eight metres the nine keeps it and
       * goes himself: the receiver is still walking in from depth, the flat
       * pass loses two metres, and the pick over the guard is how close-range
       * phases are actually played. */
      if (toLine < 8 && s.carrierNum === 9 && s.protect > 0 && intent === 'PASS') intent = 'CARRY';
      if (intent === 'CARRY' && this.op?.carrierNum === 9 && this.passOpts.length && R() < 0.85) intent = 'PASS';
      // T-39. The CPU actually moves the ball: in space with an option, it will
      // pass rather than always carry — once the carry has been committed to.
      /* T-18 chain passing: a carrier in space with an uncovered man moves
       * it on — that is where multi-pass movements come from. */
      const uncovered = (this.passOpts as any[]).some((o) => !o.covered);
      if (intent === 'CARRY' && s.pressure < 0.45 && this.passOpts.length && s.heldT > 0.35 && R() < (uncovered ? 0.55 : 0.3)) intent = 'PASS';
      // Called passing plays need their runners to have time to get moving —
      // except the nine's distribution, which by its nature goes immediately.
      if (intent === 'PASS' && s.heldT < 0.35 && s.pressure < 0.5 && this.op?.carrierNum !== 9) intent = 'CARRY';
      /* T-18/T-24. A kick is a territory decision, not a reflex. Kicks happen
       * from the own half (territory punt, box kick), from a developed phase
       * (bomb, cross-field) or in range (drop goal). Kicking inside the
       * attacking 22 unless pressured was throwing away the phase that the
       * carry game had just built — and was why kicks were HIGH while every
       * other match statistic was LOW. */
      if (intent === 'KICK') {
        const ownHalf = toLine > 50;
        const legal =
          (call === 'TERRITORY_PUNT' && ownHalf) ||
          (call === 'BOX_KICK' && s.carrierNum === 9 && ownHalf && s.heldT > 0.5) ||
          (call === 'BOMB' && s.heldT > 1.1 && toLine > 26) ||
          (call === 'CROSS_FIELD' && s.heldT > 0.9 && toLine > 26);
        /* A cross-field call that never developed is not a carry — in the own
         * half the ten turns it around and finds touch, exactly as a real
         * side does when the move breaks down behind the gain line. */
        if (!legal && call === 'CROSS_FIELD' && ownHalf) { intent = 'KICK'; s.aiPlay = 'TERRITORY_PUNT'; this.lastCall = 'TERRITORY_PUNT'; }
        else if (!legal) intent = s.pressure > 0.82 ? 'CONTACT' : 'CARRY';
      }
      /* T-18. A drop goal is the stuck-attack release or the dying-seconds
       * play — not the first option of a red-zone visit. The TIGHT-zone
       * scoring bonus had the ten dropping at the posts on phase two, which
       * converted almost nothing and ended the attack every time. */
      if (intent === 'DROP' && (toLine > 38 || s.heldT < 0.5 || s.phase < 5)) intent = 'CARRY';
      // Nobody steps into a wall.
      if (s.pressure > 0.86 && intent === 'CARRY' && s.protect <= 0 && R() < 0.5) intent = 'CONTACT';
      if (s.pressure > 0.72 && intent === 'PASS' && s.protect <= 0 && R() < 0.3) intent = 'CONTACT';
      s.aiIntent = intent;
    }
    switch (s.aiIntent) {
      case 'PASS': {
        /* T-24d. The CPU used to pick a side at random and fail silently when
         * that side had no receiver. Pick a side that actually has an option,
         * preferring the openside, so the CPU completes its passes instead of
         * fumbling the button. */
        const car = this.L(s.attacking, s.carrierNum);
        const wet = wetnessOf(WEATHERS[this.options.weather ?? 1]);
        const opts = passOptions(car, this.live, s.open, false, wet);
        const left = opts.find((o) => o.side === -1);
        const right = opts.find((o) => o.side === 1);
        let side: -1 | 1 = 1;
        if (right && (!left || s.open < 0)) side = 1;
        else if (left) side = -1;
        this.doPass(side, R() < 0.18);
        s.aiIntent = 'CARRY';
        return;
      }
      case 'KICK':
        this.startKick(s.attacking, call === 'BOMB' ? 'BOMB' : 'PUNT', { x: car.x, z: car.z }, s.carrierNum);
        return;
      case 'DROP':
        this.startKick(s.attacking, 'DROP_GOAL', { x: car.x, z: car.z }, s.carrierNum);
        return;
      case 'CONTACT': this.startBreakdown(); return;
      default: {
        // T-39. The CPU carrier used to run a fixed 6.3 m/s regardless of his
        // stats — that is why "they run exactly the same speed". Use his own
        // maxSpeed, sprinting when he has space in front.
        const defs = this.live.filter((p) => p.team === this.defending());
        const gx = widestGap(defs, car.x);
        const targetX = avoidTouch(gx, car.z, s.dir);
        const spd = maxSpeed(car, true, s.pressure < 0.55, car.stamina);
        car.vx = approach(car.vx, clamp(targetX - car.x, -1, 1) * spd * 0.45, 5, dt);
        car.vz = approach(car.vz, spd * s.dir, 3.8, dt);
      }
    }
  }

  /* ============================ BREAKDOWN ============================ */

  startBreakdown(tacklerNum?: number) {
    const s = this.op!;
    const atk = s.attacking, dir = s.dir;
    const car = this.L(atk, s.carrierNum);
    /* T-18. FALL FORWARD: a carrier brought down at pace lands a stride
     * beyond the contact point, not dead on it. Without this the ruck formed
     * where he was first touched and every phase lost the metre the tackle
     * radius already cost. */
    const fall = clamp(car.vz * dir * 0.13, 0, 1.3);
    car.z += dir * fall;
    const cx = car.x, cz = car.z;
    const dTeam: 'A' | 'B' = this.defending();

    if (tacklerNum !== undefined) {
      this.teams[dTeam].stats.tackles++;
      this.run(dTeam, tacklerNum).tackles++;
    } else {
      /* T-18. A tackle made without a named tackler is still a tackle — the
       * CPU carrier taking contact under pressure was resolved as a breakdown
       * with nobody credited, and TACKLES PER MATCH read a quarter of the
       * truth. The nearest defender is the man who made it. */
      let near: { num: number; d: number } | null = null;
      for (const p of this.live) {
        if (p.team !== dTeam || p.sinbin > 0) continue;
        const dd = Math.hypot(p.x - cx, p.z - cz);
        if (!near || dd < near.d) near = { num: p.num, d: dd };
      }
      if (near) {
        this.teams[dTeam].stats.tackles++;
        this.run(dTeam, near.num).tackles++;
      }
    }
    this.run(atk, s.carrierNum).carries++;

    /* T-18. An offload goes to a support RUNNING ONTO THE BALL — level with
     * the carrier or ahead of him. The old code took ANY team-mate within
     * 3.2 m, which is almost always a man trailing the play: the "offload"
     * lost two or three metres every phase, which is why attacks marched
     * slowly backwards and the red zone converted nothing. A trailing man is
     * not an offload; he is the next ruck. */
    const supports = this.live
      .filter((p) => p.team === atk && p !== car && p.sinbin <= 0
        && !p.down && (p.z - cz) * dir > -1.0
        && Math.hypot(p.x - cx, p.z - cz) < 3.2)
      .sort((a, b) => (b.z - a.z) * dir);
    const support = supports[0];
    const offloadChance = (this.slider(atk, 'offload') / 100) * 0.18 + car.attrs.SKL / 1000;
    if (support && R() < offloadChance) {
      this.teams[atk].stats.offloads++;
      this.run(atk, s.carrierNum).offloads++;
      this.commentate('BIG_HIT', '— BUT HE OFFLOADS');
      support.vz = dir * 5.4;
      this.startOpen(atk, support.x, support.z, support.num, s.phase + 1, s.gained);
      return;
    }

    car.down = true;
    car.vx = 0; car.vz = 0;
    const tackler = tacklerNum !== undefined ? this.L(dTeam, tacklerNum) : null;
    if (tackler) { tackler.down = true; tackler.vx = 0; tackler.vz = 0; }

    // three named attackers, in arrival order, assigned before the whistle
    const commitA = clamp(1 + Math.round((this.slider(atk, 'ruckCommit') / 100) * 2), 1, 3);
    const crew = assignCrew(this.live, atk, cx, cz, commitA + 1);
    // T-39. Send three defenders so the CPU genuinely contests the ruck instead
    // of watching it. The first is the jackal, the other two counter-ruck.
    const defCrew = assignCrew(this.live, dTeam, cx, cz, 3);
    const players: BreakdownState['players'] = [
      { role: 'CARRIER', num: s.carrierNum, team: atk, x: cx, z: cz, down: true },
    ];
    if (tackler) players.push({ role: 'TACKLER', num: tackler.num, team: dTeam, x: cx + 0.6, z: cz - dir * 0.5, down: true });
    crew.forEach((p, i) => {
      if (p.num === s.carrierNum || (tackler && p.num === tackler.num)) return;
      p.down = i < 1;
      players.push({
        role: i === 0 ? 'FIRST CLEARER' : 'CLEANER', num: p.num, team: atk,
        x: cx - 0.8 - i * 0.5, z: cz - dir * (1.3 + i * 0.4), down: i < 1,
      });
    });
    /* T-24c. The first defender to a breakdown ALWAYS contests the ball. The old
     * code rolled a 25-65% chance of sending a jackal, so most rucks had nobody
     * over the ball and the defence could never win it. A defender over the ball
     * is the default, not the exception. */
    defCrew.forEach((p, i) => {
      if (tackler && p.num === tackler.num) return;
      players.push({
        role: i === 0 ? 'JACKAL' : 'COUNTER', num: p.num, team: dTeam,
        x: cx + 0.5 + i * 0.4, z: cz + dir * (1.0 + i * 0.5), down: false,
      });
    });

    const zone = dir > 0 ? 50 - cz : 50 + cz;
    const ep = clamp(0.12 + Math.max(0, (75 - zone) / 75) * 4.2, 0.05, 4.3);
    this.bd = {
      t: 0, stage: 'CONTACT', attacking: atk, contactX: cx, contactZ: cz,
      gainLine: s.gained, ruckFormed: false, jackalActive: defCrew.length > 0,
      ball: { x: cx, z: cz, placed: false }, players,
      crew: crew.map((p) => p.num), defCrew: defCrew.map((p) => p.num),
      groundAt: -1, ballOutAt: 0, phase: s.phase, expectedPoints: ep,
      power: { A: 40 + this.L(atk, 8).attrs.PWR * 0.5, B: 40 + this.L(dTeam, 7).attrs.PWR * 0.5 },
      window: 0, result: '', resultWhy: '',
      contestMeter: 0.5, meterDir: 1, meterOn: false, waggle: 0,
      commitA, commitB: 2, advantageOf: 0,
    };
    this.phase = 'BREAKDOWN';
    this.op = undefined;
    if (this.isHuman(atk)) this.showHint('A/D POUND TO CLEAR OUT — OR WAIT FOR THE NINE', 2.6);
    this.setCtrl(atk, 9);
  }

  private upBreakdown(dt: number, _input: Input, pressed: Set<string>) {
    const s = this.bd!;
    s.t += dt;
    const atk = s.attacking, dTeam = this.defending();
    const limit = [1.5, 3, 5][this.options.ruckLaw ?? 1];
    const diff = DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)];

    if (s.stage === 'CONTACT') { s.stage = 'PLACE'; s.groundAt = s.t; }

    if (s.stage === 'PLACE') {
      const human = this.isHuman(atk);
      if (human) {
        if (pressed.has('left') || pressed.has('right')) s.waggle += 1;
        if (pressed.has('action')) { s.commitA = clamp(s.commitA + 1, 1, 3); this.showHint(`COMMITTED ${s.commitA} TO THE RUCK`, 1.4); }
      } else {
        s.waggle += dt * (7 + diff.reaction * 7);
      }
      const elapsed = s.t - s.groundAt;
      if (s.waggle > 4.2 || elapsed > 0.75) {
        s.stage = 'RUCK';
        s.ruckFormed = true;
        s.ball.placed = true;
        // numbers and quality decide it, and the reason is stated out loud
        const atkCrew = s.crew.length;
        const defCrew = s.defCrew.length;
        const jackalSkill = this.L(dTeam, s.defCrew[0] ?? 7).attrs.AWA;
        /* T-24c. The steal scales with how hard the attack competes. If the
         * carrier's side barely cleared out (low waggle, one committed), the
         * jackal wins it — the defence must be rewarded for committing when the
         * attack does not. If the attack fought hard, the ball is secure. */
        const uncontested = s.waggle < 5.5 && s.commitA <= 1;
        /* T-18 — real matches turn over ~18-22 times INCLUDING errors; with a
         * ruck every few seconds the old rates flipped possession constantly
         * and no side could build phases. */
        /* T-18. A contested steal against a committed attack is the rare
         * exception (~5% in professional rugby), not one phase in five —
         * the old range turned over four in ten red-zone drives. */
        const steal = uncontested
          ? clamp(0.28 + (defCrew - atkCrew) * 0.08 + jackalSkill / 800, 0.18, 0.4)
          : clamp(0.03 + (defCrew - atkCrew) * 0.04 + jackalSkill / 900 - s.commitA * 0.03, 0.015, 0.12);
        s.window = clamp(0.4 + (s.waggle - 4.2) * 0.12 + s.commitA * 0.14, 0.35, 1.8);
        if (s.jackalActive && R() < steal) {
          /* T-18 — only the side that WON it is credited. Both counters used
           * to increment, so every steal read as two turnovers and the match
           * total was double the real number. */
          this.teams[dTeam].stats.turnovers++;
          this.run(dTeam, s.defCrew[0] ?? 7).jackals++;
          this.teams[dTeam].stats.jackals++;
          this.commentate('TURNOVER');
          s.resultWhy = `JACKAL WON — ${this.teams[dTeam].nation.short} HAD ${defCrew} v ${atkCrew} AND THE BETTER ARRIVAL`;
          this.clearRuck();
          this.startOpen(dTeam, s.contactX, s.contactZ - (atk === 'A' ? 1 : -1), 9, 1, 0, 0.75);
          return;
        }
        /* T-18. Real referees ping not-releasing two to four times a match,
         * not eleven — the rate was ending a red-zone possession in every
         * other phase. */
        if (R() < 0.036 + (this.slider(atk, 'aggression') / 100) * 0.06) {
          this.beginPenalty(dTeam, REFEREE_CALLS.NOT_RELEASING, s.players[0].num);
          return;
        }
      }
    }

    /* OFFSIDE LINE — Law 16. At a formed ruck the offside line is the hindmost
     * foot on each side. Rather than penalising men for standing where the shape
     * put them, the line is enforced physically — but as a retreat at a human
     * pace, not a teleport: the old clamp shoved a defender up to 6 m sideways
     * in one frame, which the fault hunt correctly logged as impossible. */
    if (s.ruckFormed) {
      const fwd = s.attacking === 'A' ? 1 : -1;
      const atkLine = s.contactZ - fwd * 1.0;
      /* T-18. The hindmost foot is the LAW, but a defender does not set a
       * tackle standing on it — the guard comes from two metres behind the
       * line, arriving as the carrier does. With the guard on the foot
       * itself the carrier was contacted the frame he caught a flat ball,
       * every phase lost a metre and a half, and attacks marched slowly
       * backwards out of the red zone. */
      const defLine = s.contactZ + fwd * 3.0;
      const RETREAT = 8 * dt;   // m per frame — a hard back-pedal
      for (const p of this.live) {
        if (p.sinbin > 0 || p.down) continue;
        if (p.team === s.attacking) {
          if ((p.z - atkLine) * fwd > 0) p.z -= Math.min(RETREAT, Math.abs(p.z - (atkLine - fwd * 0.3))) * fwd;
        } else if ((defLine - p.z) * fwd > 0) p.z += Math.min(RETREAT, Math.abs((defLine + fwd * 0.3) - p.z)) * fwd;
      }
    }

    if (s.stage === 'RUCK') {
      const elapsed = s.t - s.groundAt;
      /* T-38. When the ruck clock runs out the ball is auto-played to the fly-half
       * (first receiver) rather than a scrum being awarded. The window is a
       * "use it" timer, not a penalty: at 0 the nine releases to the 10. */
      if (elapsed > limit) {
        this.clearRuck();
        this.say(`USE IT — BALL TO THE FLY-HALF`);
        const dir = atk === 'A' ? 1 : -1;
        this.startOpen(atk, s.contactX, s.contactZ - dir * 2.0, 10, s.phase + 1, s.gainLine, 0.75);
        return;
      }
      s.stage = 'RECYCLE';
    }

    if (s.stage === 'RECYCLE') {
      const outAt = s.groundAt + s.window + 0.05;
      if (s.t >= outAt) {
        const slow = s.window > 2.0;
        this.teams[atk].stats.rucks++;
        if (slow) this.teams[atk].stats.slowBall++;
        // The nine, or the nearest eligible forward, plays it. Never a distant back.
        const dist = ruckDistributor(this.live, atk, s.contactX, s.contactZ);
        const fwd = atk === 'A' ? 1 : -1;
        /* LAW 16 — the defence must be behind the hindmost foot when the ball
         * leaves the ruck. The ruck-formed clamp above has already been walking
         * them there all phase; nothing more is needed here, and the old
         * one-shot teleport (several metres, one frame) is exactly the fault
         * class the hunt exists to catch. */
        void fwd;
        this.clearRuck();
        // The nine plays it from the side of the ruck, a stride behind the ball,
        // which is where he actually stands — not on top of the contact point.
        const side = s.contactX > 0 ? -1.8 : 1.8;
        const nearLine = Math.abs(atk === 'A' ? FIELD.tryZFar - s.contactZ : s.contactZ - FIELD.tryZ) < 20;
        this.startOpen(atk, clamp(s.contactX + side, -32, 32), s.contactZ - fwd * (nearLine ? 0.5 : 1.4), dist.num, s.phase + 1, s.gainLine, 0.75);
      }
    }
    void _input; void dTeam;
  }

  private clearRuck() {
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

  private upMaul(dt: number, input: Input, pressed: Set<string>) {
    const s = this.ml!;
    s.t += dt;
    /* T-16 FREEZE. `this.defending()` reads from `possession`, which a penalty
     * can flip mid-drive — after which the maul was computing its own defending
     * side as the side that owned it, both force values fed from one team, and
     * the drive could neither advance nor stall. The maul owns its own two sides
     * from its own `attacking` field and never consults possession. */
    const atk = s.attacking;
    const def: 'A' | 'B' = atk === 'A' ? 'B' : 'A';
    const human = this.isHuman(atk);
    const commit = clamp(1 + Math.round((this.slider(s.attacking, 'setPiece') / 100) * 4), 1, 6);
    s.committed = commit;

    if (human) {
      if (pressed.has('left') || pressed.has('right')) s.forceA += 150;
      if (pressed.has('action') && s.transferCd <= 0) { s.ballRank = Math.min(s.ranks - 1, s.ballRank + 1); s.transferCd = 1.6; }
      if (pressed.has('kick')) {
        const dist = ruckDistributor(this.live, s.attacking, s.x, s.z);
        this.clearRuck();
        this.startOpen(s.attacking, s.x + 1.2, s.z - s.dir * 1.6, dist.num, 1, 0, 0.6);
        return;
      }
    } else {
      s.forceA += dt * (200 + DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)].reaction * 420);
      if (R() < dt * 0.25 && s.transferCd <= 0) { s.ballRank = Math.min(s.ranks - 1, s.ballRank + 1); s.transferCd = 1.8; }
    }
    s.transferCd = Math.max(0, s.transferCd - dt);
    /* T-18. Off a lineout the attacking pack is bound as one — the drive
     * has more shove than a broken-play maul formed around a tackled man.
     * Without the bonus the forces cancelled and a five-metre lineout drive
     * could not reach the line before the referee lost patience. */
    const lineoutDrive = s.fromLineout ? 1300 : 0;
    s.forceA = approach(s.forceA, 2600 + lineoutDrive + this.teams[atk].nation.att.maul * 26 + commit * 320, 2.2, dt);
    s.forceD = approach(s.forceD, 2400 + this.teams[def].nation.att.maul * 24 + (6 - commit) * 300, 1.6, dt);

    const net = (s.forceA - s.forceD) / 1400;
    s.speed = approach(s.speed, clamp(net, -0.5, 1.15), 3, dt);
    s.z += s.speed * dt;
    s.yaw = approach(s.yaw, clamp(net * 12, -22, 22), 1.2, dt);
    s.gained += Math.max(0, s.speed * dt);
    s.x += Math.sin((s.yaw * Math.PI) / 180) * dt * 0.6;

    if (Math.abs(s.speed) < 0.12) {
      s.stallClock += dt;
      // warn once before whistling, so it never feels arbitrary
      if (s.stallClock > 3 && !s.warned) { s.warned = true; this.showHint('USE IT — THE MAUL HAS STOPPED', 2.4); }
      if (s.stallClock > 5) {
        s.stoppedOnce = true;
        if ((this.options.maulLaw ?? 0) === 2) { s.stallClock = 0; }
        else {
          this.lawCall('MAUL_STOPPED', REFEREE_CALLS.MAUL_STOPPED, def);
          this.clearRuck();
          this.startScrum(def, s.x, s.z);
          return;
        }
      }
    } else s.stallClock = Math.max(0, s.stallClock - dt * 1.5);

    if ((s.dir > 0 && s.z >= s.tryLineZ) || (s.dir < 0 && s.z <= s.tryLineZ)) { this.clearRuck(); this.scoreTry(); return; }
    if (Math.abs(s.z) > 48 && s.gained > 0.5) {
      this.say('THE MAUL IS DRAGGED INTO TOUCH');
      this.clearRuck();
      this.startLineout(def, s.z, Math.sign(s.x) * 6);
      return;
    }
    if (R() < dt * 0.03) { this.beginPenalty(def, REFEREE_CALLS.IN_AT_SIDE, 6); return; }
    if (s.t > 8) {
      const dist = ruckDistributor(this.live, atk, s.x, s.z);
      this.clearRuck();
      this.startOpen(atk, s.x + 1.2, s.z - s.dir * 2.2, dist.num, 1, 0, 0.6);
      return;
    }
    void input;
  }

  /* ============================ SCRUM ============================ */

  private scrumSlots(feed: 'A' | 'B', ax: number, az: number): ScrumSlot[] {
    const out: ScrumSlot[] = [];
    const rows = [[1, 2, 3], [4, 5, 6], [7, 8]];
    for (const t of ['A', 'B'] as const) {
      const back = t === 'A' ? -1 : 1;
      rows.forEach((row, ri) => {
        row.forEach((num, ci) => {
          out.push({
            num, team: t, row: ri + 1, down: false,
            x: ax + (ci - (row.length - 1) / 2) * 0.68,
            z: az + back * (0.62 + ri * 0.66),
          });
        });
      });
    }
    void feed;
    return out;
  }

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

  private upScrum(dt: number, input: Input, pressed: Set<string>) {
    const s = this.scrim!;
    s.t += dt;
    const ax = this.scrumAnchor;
    const feed = s.feed;
    const dTeam: 'A' | 'B' = feed === 'A' ? 'B' : 'A';
    const diff = DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)];

    // ---- ASSEMBLE: players jog to their marks. No teleport, no load. ----
    if (s.stage === 'ASSEMBLE') {
      let arrived = 0, count = 0;
      for (const slot of s.players) {
        const p = this.L(slot.team, slot.num);
        if (p.sinbin > 0) continue;
        count++;
        if (Math.hypot(p.x - slot.x, p.z - slot.z) < 1.3) arrived++;
      }
      s.ready = count ? arrived / count : 1;
      s.cadence = `FORMING — ${Math.round(s.ready * 100)}% SET`;
      if (s.ready > 0.82 || s.t > 2.4) { s.stage = 'MARK'; s.t = 0; }
      return;
    }

    switch (s.stage) {
      case 'MARK':
        s.cadence = 'MARK SET';
        if (s.t > 0.2) { s.stage = 'FORM'; s.t = 0; }
        break;
      case 'FORM':
        s.cadence = 'CROUCH';
        if (s.t > 0.25) { s.stage = 'CROUCH'; s.t = 0; }
        break;
      case 'CROUCH':
        s.cadence = 'TOUCH';
        if (s.t > 0.35) { s.stage = 'BIND'; s.t = 0; }
        break;
      case 'BIND':
        s.cadence = 'PAUSE';
        if (s.t > 0.35) {
          s.stage = 'SET'; s.t = 0; s.cadence = 'SET';
          /* T-16 FREEZE. The reset counter was incremented *after* the ceiling
           * test on the previous line ran, so a scrum could re-enter FORM
           * indefinitely: each pass through rolled a fresh early engage, and the
           * `>= 2` test always saw the pre-increment value. Test after the
           * increment, and cap hard. */
          if (R() < 0.04 + (1 - this.teams[dTeam].nation.att.discipline / 100) * 0.08) {
            s.resets++;
            if (s.resets >= 2) {
              this.beginPenalty(feed, 'FREE KICK — REPEAT EARLY ENGAGE', 3, true);
              return;
            }
            this.lawCall('EARLY_ENGAGE', REFEREE_CALLS.EARLY_ENGAGE, dTeam);
            s.stage = 'FORM'; s.t = 0;
            return;
          }
        }
        break;
      case 'SET':
        s.cadence = 'ENGAGE';
        if (s.t > 0.25) { s.stage = 'ENGAGE'; s.t = 0; this.shake(0.55); }
        break;
      case 'ENGAGE':
        s.cadence = 'SETTLED';
        if (s.t > 0.2) { s.stage = 'STEADY'; s.t = 0; }
        break;
      case 'STEADY':
        s.cadence = 'BALL IN';
        if (s.t > 0.2) { s.stage = 'FEED'; s.t = 0; s.ball = { x: 0, y: 0.16, z: 0.2, state: 'LIVE' }; }
        break;
      case 'FEED': {
        s.cadence = 'BALL IN';
        if (s.t > 0.3) {
          s.stage = 'STRIKE'; s.t = 0; s.cadence = 'STRIKE';
          const sq = this.options.scrumFeed ?? 1;
          if (sq === 0 && R() < 0.32) { this.beginPenalty(dTeam, 'FREE KICK — FEED NOT STRAIGHT', 2, true); return; }
        }
        break;
      }
      case 'STRIKE':
      case 'DRIVE': {
        s.stage = 'DRIVE';
        s.cadence = 'DRIVE';
        const manual = (this.options.scrumWaggle ?? 0) === 0;
        if (this.isHuman(feed)) {
          if (manual) {
            if (pressed.has('left')) s.packs[feed].waggle += 1;
            if (pressed.has('right')) s.packs[feed].waggle += 1;
          } else {
            s.packs[feed].waggle += dt * 8;
          }
        } else {
          s.packs[feed].waggle += dt * (6 + diff.reaction * 8);
        }
        s.packs[dTeam].waggle += dt * (5.5 + diff.reaction * 7.5);

        const F = (t: 'A' | 'B') => {
          const base = 4600 + s.packs[t].fitness * 26;
          const w = clamp(s.packs[t].waggle, 0, 60);
          return base * (0.72 + (w / 60) * 0.34);
        };
        s.packs.A.forceTransmitted = F('A');
        s.packs.B.forceTransmitted = F('B');
        const fa = s.packs.A.forceTransmitted * (feed === 'A' ? 1.06 : 0.94);
        const fb = s.packs.B.forceTransmitted * (feed === 'B' ? 1.06 : 0.94);
        const net = (fa - fb) / 5200;
        s.netDrive += net * dt * 0.42;
        s.yaw = approach(s.yaw, clamp(net * 26 * s.wheelDir, -45, 45), 1.1, dt);
        s.collapseRisk = clamp(0.04 + Math.abs(net) * 0.42, 0, 1);
        s.ball.z = clamp(s.ball.z - (feed === 'A' ? 1 : -1) * dt * 1.6 + net * dt * 0.8, -1.6, 1.6);

        if (Math.abs(s.yaw) > 45) {
          this.lawCall('WHEEL_90', 'PENALTY — WHEELED PAST 90°', s.feed === 'A' ? 'B' : 'A');
          this.beginPenalty(dTeam, 'PENALTY — WHEELED PAST 90°', 3);
          return;
        }
        if (R() < dt * s.collapseRisk * 0.1) {
          this.lawCall('COLLAPSE', REFEREE_CALLS.COLLAPSE, s.feed === 'A' ? 'B' : 'A');
          this.beginPenalty(dTeam, REFEREE_CALLS.COLLAPSE, 3);
          return;
        }
        if (s.t > 0.9) { s.stage = 'BASE'; s.t = 0; }
        break;
      }
      case 'BASE':
        s.cadence = 'USE IT';
        if (s.t > 0.3) {
          s.stage = 'OUT'; s.t = 0;
          const against = s.netDrive < -0.35 && R() < 0.42;
          const winner = against ? dTeam : feed;
          if (against) {
            this.teams[dTeam].stats.scrumsWon++;
            this.teams[feed].stats.scrumsLost++;
            this.commentate('TURNOVER', '— AGAINST THE HEAD');
          } else {
            this.teams[feed].stats.scrumsWon++;
          }
          this.scrim = undefined;
          this.startOpen(winner, ax.x + 2, ax.z + (winner === 'A' ? -3.4 : 3.4), 9, 1, 0, 0.55);
        }
        break;
      default: break;
    }
    void input;
  }

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

  private upLineout(dt: number, input: Input, pressed: Set<string>) {
    const s = this.lo!;
    s.t += dt;
    const human = this.isHuman(s.thrower);
    const diff = DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)];

    if (s.stage === 'ASSEMBLE') {
      let arrived = 0, count = 0;
      for (const slot of s.players) {
        const p = this.L(slot.team, slot.num);
        if (p.sinbin > 0) continue;
        count++;
        if (Math.hypot(p.x - slot.x, p.z - slot.z) < 1.3) arrived++;
      }
      s.ready = count ? arrived / count : 1;
      /* NO-TELEPORT: the force-advance used to fire at 2.0 s while men were
       * still 15 m out; the throw then went up against a half-formed line and
       * the contest pin teleported the rest in. Give the walk-on time to
       * actually finish (see also the contest pin, which never snaps now). */
      if (s.ready > 0.82 || s.t > 2.2) { s.stage = 'CALL'; s.t = 0; }
      return;
    }

    if (s.stage === 'CALL') {
      if (human) {
        if (pressed.has('left')) s.callIdx = (s.callIdx + 3) % 4;
        if (pressed.has('right')) s.callIdx = (s.callIdx + 1) % 4;
        if (pressed.has('action')) { s.stage = 'THROW'; s.t = 0; s.meterOn = true; s.meter = 0; s.meterDir = 1; }
      } else {
        s.callIdx = Math.floor(R() * 4);
        if (s.t > 0.35) { s.stage = 'THROW'; s.t = 0; s.meterOn = true; }
      }
      const c = Director.LO_CALLS[s.callIdx];
      const thr = s.players.find((p) => p.role === 'THROWER')!;
      const side = thr.x >= 0 ? 1 : -1;
      s.call = { targetX: side * (31.2 - Math.abs(c.targetX) * 0.72), label: c.label, jumpers: c.jumpers, kind: c.kind };
      /* T-18. The middle call drives the maul; inside the ten a tail call
       * drives too — a five-metre lineout exists to be driven over. */
      const nearLine = Math.abs(s.markZ) > 40;
      s.driveCall = c.kind === 'MIDDLE' || (nearLine && (c.kind === 'TAIL' || c.kind === 'MIDDLE'));
    } else if (s.stage === 'THROW') {
      if (human) {
        if (s.meterOn) {
          s.meter += s.meterDir * dt * 1.35;
          if (s.meter > 1) { s.meter = 1; s.meterDir = -1; }
          if (s.meter < 0) { s.meter = 0; s.meterDir = 1; }
          if (pressed.has('action')) { s.meterOn = false; this.releaseThrow(); }
        }
      } else {
        s.meter = 0.62 + (R() - 0.5) * (1 - diff.reaction) * 1.4;
        if (s.t > 0.3) this.releaseThrow();
      }
    } else if (s.stage === 'CONTEST') {
      s.ball.vy -= 9.81 * dt;
      s.ball.x += s.ball.vx * dt;
      s.ball.y += s.ball.vy * dt;
      s.history.push({ ballX: s.ball.x, ballY: s.ball.y });
      if (s.history.length > 90) s.history.shift();
      s.ball.apexY = Math.max(s.ball.apexY, s.ball.y);
      if (s.ball.y <= 2.4 && s.ball.vy < 0) { s.stage = 'CATCH'; s.t = 0; }
    } else if (s.stage === 'CATCH') {
      if (s.t > 0.4) {
        /* T-16 FREEZE. Two bugs lived here.
         *
         * 1. `s.players.find(...)!` — a non-null assertion. With a sin-binned or
         *    mis-numbered jumper the find returned undefined and the next line
         *    threw, killing the update loop mid-frame and freezing the match.
         * 2. When the defence won the contest but neither the steal roll nor the
         *    not-straight test fired, control fell through to the thrower-wins
         *    path — awarding the ball to the side that just lost it, and
         *    incrementing lineoutsWon for BOTH teams.
         *
         * Every branch below now terminates in a phase transition. There is no
         * fall-through, and no assertion. */
        s.winner = true;
        const dTeam: 'A' | 'B' = s.thrower === 'A' ? 'B' : 'A';
        /* T-06 — THE LIFT IS MECHANICAL. The catch is not a dice roll: each
         * side's best jumper at the ball's plane rises to an EFFECTIVE REACH
         * — base spring, plus the lift (mean power of the designated
         * lifters, scaled by having both of them and by jump timing), minus
         * the stretch of reaching away laterally. The thrower's jumper jumps
         * on the call (timing follows throw quality); the defence reacts.
         * Whoever reaches higher at the plane takes it. */
        const reachOf = (team: 'A' | 'B') => {
          const js = s.players.filter((q) => q.team === team && q.role === 'JUMPER');
          if (!js.length) return 0;
          js.sort((a, b) => Math.abs(a.x - s.ball.x) - Math.abs(b.x - s.ball.x));
          const q = js[0];
          const live = this.L(team, q.num);
          const lifters = s.players.filter((w) => w.team === team && w.role === 'LIFTER'
            && this.L(team, w.num).sinbin <= 0);
          const pows = lifters.map((w) => this.L(team, w.num).attrs.PWR);
          const liftQ = pows.length ? pows.reduce((a, b) => a + b, 0) / pows.length / 100 : 0;
          const both = Math.min(1, pows.length / 2);
          const stretch = Math.min(0.5, Math.abs(q.x - s.ball.x) * 0.12);
          const tech = this.teams[team].nation.att.lineout / 100 * 0.12;
          const timing = team === s.thrower ? 0.25 + s.quality * 0.75 : 0.78;
          return 2.4 + live.attrs.PWR / 100 * 0.1 + liftQ * both * 0.9 * timing + tech - stretch;
        };
        /* No two jumps are timed alike: a hand-span of noise on each side,
         * so an even battle is a contest, not a formality. */
        const margin = reachOf(s.thrower) - reachOf(dTeam) + (s.quality - 0.5) * 0.3 + (R() - 0.5) * 0.34;
        s.contestMargin = margin;
        const won = margin > 0 || (margin === 0 && R() < 0.6);
        const bx = s.ball.x, bz = s.markZ, drive = s.driveCall, thrower = s.thrower;

        // A badly crooked throw is a free kick regardless of who caught it.
        if (s.quality < 0.25) {
          this.lawCall('NOT_STRAIGHT', REFEREE_CALLS.NOT_STRAIGHT, thrower);
          this.teams[thrower].stats.lineoutsLost++;
          this.lo = undefined;
          this.startLineout(dTeam, bz, bx);
          return;
        }

        if (!won) {
          this.teams[dTeam].stats.lineoutsWon++;
          this.teams[thrower].stats.lineoutsLost++;
          this.commentate('LINEOUT', '— STOLEN AT THE TAIL');
          this.lo = undefined;
          this.startOpen(dTeam, bx, bz, 9, 1, 0, 0.45);
          return;
        }

        this.teams[thrower].stats.lineoutsWon++;
        s.ball.state = 'HELD';
        const jumper = s.players.find((p) => p.team === thrower && p.role === 'JUMPER');
        if (jumper) { s.ball.heldBy = jumper.id; jumper.handY = 2.6; }
        this.lo = undefined;
        if (drive) { this.startMaul(thrower, bx, bz, 5, true); return; }
        this.startOpen(thrower, bx, bz, 10, 1, 0, 0.45);
        return;
      }
    }
    void input;
    for (const p of s.players) {
      if (p.role === 'JUMPER') {
        const contesting = s.stage === 'CONTEST' || s.stage === 'CATCH';
        const target = contesting ? (Math.abs(p.x - s.ball.x) < 1.6 ? s.ball.y : 0.4) : 0.4;
        p.handY = approach(p.handY, target, 6, dt);
      } else if (p.role === 'LIFTER') {
        /* T-06: one shared timeline — the lifters' hands rise with their own
         * jumper, half a beat behind him, instead of animating alone. */
        const near = s.players
          .filter((q) => q.team === p.team && q.role === 'JUMPER')
          .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
        if (near) p.handY = approach(p.handY, near.handY * 0.5, 6, dt);
      }
    }
  }

  private releaseThrow() {
    const s = this.lo!;
    s.quality = clamp(1 - Math.abs(s.meter - 0.62) * 2.1, 0, 1);
    s.meterOn = false;
    s.ball.state = 'FLIGHT';
    s.stage = 'CONTEST'; s.t = 0;
    const from = s.players.find((p) => p.role === 'THROWER')!;
    const dx = s.call.targetX - from.x;
    const flight = 1.15;
    s.ball.vx = dx / flight;
    s.ball.vy = (4.4 - 1.6) / flight + 0.5 * 9.81 * flight;
    s.ball.apexY = 1.6;
    this.say(`${s.call.label} — THE THROW GOES IN`);
  }

  /* ============================ KICK ============================ */

  startKick(team: 'A' | 'B', type: KickType, at?: { x: number; z: number }, carrierNum?: number) {
    this.possession = team;
    const dir = team === 'A' ? 1 : -1;
    const x = at?.x ?? 0;
    const z = at?.z ?? 0;
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

  private upKick(dt: number, input: Input, _pressed: Set<string>) {
    const s = this.kk!;
    s.t += dt;
    const human = this.isHuman(s.kicker);
    const diff = DIFFICULTY_TABLE[clamp(this.difficulty, 0, 9)];
    const wind = windOf(this.options);

    /* T-32. The conversion ritual: fanfare (celebrate), then the walk to the tee.
     * The kick button is dead until the kicker has actually set the ball. */
    if (s.stage === 'FANFARE') {
      if (s.t > 2.2) { s.stage = 'WALKUP'; s.t = 0; this.say(`${s.kickerName} STEPS UP TO TAKE THE CONVERSION`); }
      return;
    }
    if (s.stage === 'WALKUP') {
      // The kicker walks to the ball; once he is at the tee the kick goes live.
      const k = this.L(s.kicker, s.kickerNum);
      const atTee = Math.hypot(k.x - s.bx, k.z - (s.bz - s.dir * 1.1)) < 0.8;
      /* NO-TELEPORT: the time failsafe used to snap the kicker to the tee
       * wherever he stood (a 14 m teleport). He walks under steer() in
       * placeBound; the failsafe only advances the STAGE — the setting branch
       * keeps steering him the last metres to the mark. */
      if (atTee || s.t > 5.0) {
        s.stage = 'AIM'; s.t = 0;
        if (human) this.showHint('A/D AIM · HOLD SPACE TO KICK', 3);
        return;
      }
      return;
    }

    if (s.stage === 'AIM' || s.stage === 'METER') {
      if (human) {
        /* HOLD-TO-CHARGE.
         * A/D aims. Hold SPACE and the power builds; the line drawn on the grass
         * grows to exactly where the ball will land. Release to strike.
         * Accuracy is NOT a second timing minigame — it comes from the kicker's
         * rating, the wind and the wet, which is what actually decides a kick.
         * Charge takes 1.6 s for the full range, roughly half the old speed. */
        if (input.left) s.aim = clamp(s.aim - dt * 0.85, -1, 1);
        if (input.right) s.aim = clamp(s.aim + dt * 0.85, -1, 1);

        const holding = input.sprint || input.run;
        if (holding) {
          s.stage = 'METER';
          s.meter = clamp(s.meter + dt / 1.6, 0, 1);
          s.power = s.meter;
        } else if (s.stage === 'METER' && s.power > 0.04) {
          // released — strike it
          s.accuracy = this.kickerAccuracy(s);
          this.launch(s.power, s.accuracy, wind);
          return;
        }
        // The aim line is the honest prediction of where it lands.
        const reach = this.kickReach(s, s.power);
        s.landX = clamp(s.bx + s.aim * reach * 0.55, -34, 34);
        s.landZ = clamp(s.bz + s.dir * reach, -60, 60);
      } else {
        /* T-18. CPU aim is chosen by what the kick is FOR. A territory punt or
         * a box kick hunts the touchline (that is the entire point of the
         * kick — and the only way a lineout ever happens, which is why
         * LINEOUTS PER MATCH read zero). A bomb hangs mid-field for the chase;
         * a cross-field kick is aimed at the far wing. Humans keep the honest
         * A/D aim. */
        const wide = s.bx >= 0 ? 1 : -1;
        let aimTo: number;
        let powerTo = 0.55 + R() * 0.3;
        switch (s.type) {
          case 'BOMB': aimTo = (R() - 0.5) * 0.3; break;
          case 'DROP_GOAL': case 'GOAL': {
            /* T-18. Aim AT THE POSTS, geometrically: the old fixed aim of 0
             * flew parallel to the touchline, so every kick from an
             * off-centre mark — which is nearly all of them, now that the
             * penalty mark is the actual infringement spot — sailed wide. */
            const gz = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
            const dz = Math.max(4, (gz - s.bz) * s.dir);
            const deg = (Math.atan2(-s.bx, dz) * 180) / Math.PI;
            aimTo = clamp(deg / 10, -3.5, 3.5);
            const need = Math.hypot(s.bx, dz) + 4;
            powerTo = clamp((need - 9) / 43, 0.35, 1);
            break;
          }
          case 'GRUBBER': aimTo = wide * (0.4 + R() * 0.4); break;
          case 'RESTART': case 'DROP_OUT': aimTo = (R() - 0.5) * 0.5; powerTo = 0.78 + R() * 0.2; break;
          default:
            // PUNT from hand. Roughly half of territory kicks hunt touch (that
            // is the point of the kick, and the only source of lineouts); the
            // other half are short contestables for the chase — a kick game
            // that is 100% to touch can never be chased, and CHASE ARRIVALS is
            // a regression gate.
            if (s.fromPenalty) {
              /* T-18. Find the CORNER. The old aim simply maximised the
               * lateral angle, so a penalty won in the attacking half still
               * went into touch twenty metres out and there was never a
               * five-metre lineout to drive all match. Kick at the point
               * where the five-metre line meets touch; if that is beyond
               * the kicker's reach, take touch at full power on the diagonal. */
              const reach = this.kickReach(s, 1);
              const fiveZ = s.dir > 0 ? FIELD.tryZFar - 5 : FIELD.tryZ + 5;
              const forward = Math.max(8, (fiveZ - s.bz) * s.dir);
              const lateral = Math.max(6, 34.6 - s.bx * wide + 3);
              const cornerDist = Math.hypot(forward, lateral);
              let fwdForAim: number;
              if (cornerDist <= reach) {
                powerTo = clamp((cornerDist - 9) / 41 + 0.05, 0.45, 1);
                fwdForAim = forward;
              } else {
                powerTo = 0.95 + R() * 0.05;
                fwdForAim = Math.sqrt(Math.max(16, reach * reach - lateral * lateral));
              }
              const deg = Math.min(55, (Math.atan2(lateral, fwdForAim) * 180) / Math.PI);
              aimTo = wide * (deg / 10);
            } else if (s.bz * s.dir < 0 || Math.abs(s.bz) < 20) {
              if (R() < 0.4) {
                /* Find touch GEOMETRICALLY: aim at a point past the nearest
                 * touchline, with the power to reach it. The aim field is
                 * degrees/10 of kick-path rotation, so the required angle
                 * comes straight off the triangle. */
                const reach = this.kickReach(s, 0.95);
                const lateralNeeded = Math.max(6, 34.6 - s.bx * wide + 5);
                const deg = Math.min(50, (Math.atan2(lateralNeeded, reach * 0.8) * 180) / Math.PI);
                aimTo = wide * (deg / 10);
                powerTo = 0.88 + R() * 0.12;
              } else {
                aimTo = (R() - 0.5) * 0.5;
                powerTo = 0.4 + R() * 0.2;
              }
            } else {
              aimTo = (R() - 0.5) * 0.5;
            }
            break;
        }
        s.aim = clamp(aimTo, -4.2, 4.2);
        s.power = powerTo;
        s.accuracy = this.kickerAccuracy(s) * (0.8 + diff.reaction * 0.2);
        /* The restart is struck when the formation has actually assembled — the
         * ten metres is walked back, not assumed. Near-total assembly is
         * required so the strike itself is lawful. The failsafe is a LADDER,
         * because after a score both sides may have a 45 m jog back to
         * halfway: strike at 6 s if most are set, at 8 s if half are set,
         * unconditionally at 10 s. A strike into an unformed line is an
         * encroachment the audit rightly flags. */
        /* T-18/NO-ENCROACHMENT. Assembly is necessary but not sufficient: the
         * Law-12 test is that the RECEIVING side is actually behind ten
         * metres at the strike. The old time-ladder could strike at 3.5 s
         * with three men still inside the line — legal assembly, unlawful
         * kick. Strike only when the nearest receiver is at least 9.5 m
         * back (8 s hard backstop — nobody walks that slowly). */
        let gapOk = true;
        if (s.type === 'RESTART' || s.type === 'DROP_OUT') {
          const fwd = s.dir;
          let nearest = 99;
          for (const p of this.live) {
            if (p.team === s.kicker || p.sinbin > 0) continue;
            const gap = (p.z - s.bz) * fwd;
            if (gap < nearest) nearest = gap;
          }
          /* 10.3 rather than 9.5: the measured window is the first quarter
           * second of flight, and the receiving side is already moving
           * forward — striking at exactly 9.5 put a legal jog inside the
           * line by the time the ball was in the air. */
          gapOk = nearest >= 10.6 || s.t > 10;
        }
        const formed = (s.type !== 'RESTART' && s.type !== 'DROP_OUT'
          || (s.formReady ?? 1) > 0.97
          || (s.t > 2.8 && (s.formReady ?? 1) > 0.85)
          || (s.t > 4.5 && (s.formReady ?? 1) > 0.6)
          || s.t > 6.5) && gapOk;
        /* T-18. A kick from hand in open play leaves the boot in half a
         * second — the 0.9 s aim dwell on every punt was a quarter of the
         * kicking game's time budget. Only restarts wait for the formation. */
        const strikeAt = (s.type === 'RESTART' || s.type === 'DROP_OUT') ? 0.9 : 0.45;
        if (s.t > strikeAt && formed) { this.launch(s.power, s.accuracy, wind); return; }
      }
    } else if (s.stage === 'FLIGHT') {
      s.vy -= 9.81 * dt;
      s.bx += s.vx * dt;
      s.bz += s.vz * dt;
      s.by += s.vy * dt;
      /* A rugby ball bounces. It does not vanish into a phase change. Restitution
       * on the vertical, friction on the horizontal, and an unpredictable sideways
       * kick off the point of the ball. */
      if (s.by < 0.12 && s.vy < 0) {
        s.by = 0.12;
        s.bounces++;
        const rest = s.type === 'GRUBBER' ? 0.46 : 0.52;
        s.vy = Math.abs(s.vy) * rest;
        s.vx *= 0.78; s.vz *= 0.82;
        if (s.vy > 1.2) s.vx += (R() - 0.5) * 2.4;
        if (s.vy < 0.55) { s.vy = 0; s.by = 0.12; }
      }
      /* T-18. Wet-turf friction: a kicked ball's roll dies inside a couple
       * of seconds. The gentle 0.988 decay let balls wander for 4+ engine
       * seconds — a quarter of the kicking game's entire time budget. */
      if (s.by <= 0.12 && s.vy === 0 && Math.hypot(s.vx, s.vz) > 0.05) { s.vx *= 0.958; s.vz *= 0.958; }
      s.hangTime += dt;
      s.apex = Math.max(s.apex, s.by);
      s.history.push({ x: s.bx, y: s.by, z: s.bz });
      if (s.history.length > 260) s.history.shift();
      const h0 = s.history[0];
      s.distance = Math.hypot(s.bx - (h0?.x ?? s.bx), s.bz - (h0?.z ?? s.bz));

      if (s.profile.atGoal) {
        const gz = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
        const crossIn = s.dir > 0 ? s.bz >= gz : s.bz <= gz;
        if (crossIn && s.by > 0.5 && s.by < 20) {
          if (Math.abs(s.bx) < 2.8) { this.kickScored(s); return; }
          this.kickMissed(s, 'WIDE OF THE UPRIGHT'); return;
        }
      }
      /* CONTEST — while the ball is in the air or on the bounce, any player close
       * enough can catch it. This is what makes the chase worth doing. */
      /* T-18. A ball within ~2 m of touch is LET OUT — nobody fields it, the
       * lineout is the better outcome. Contesting touch-bound balls was why
       * a whole kicking game produced zero lineouts. */
      /* T-18. A kick can only be fielded once it is on the way DOWN
       * (s.vy < 0) — the old check was just "below 2.55 m", which is true on
       * the first two frames of flight, so the ball was being "caught in the
       * air" at the kicker's feet by whoever stood next to him. Every touch
       * hunt died that way; there were no lineouts. */
      if (!s.profile.atGoal && s.bounces <= 2 && Math.abs(s.bx) < 32.5 && s.vy < 0) {
        /* NO-TELEPORT: the catch radius matches startOpen's close-place guard
         * (1.2 m). Catching at 1.5 m meant the catcher was then PLACED on the
         * ball — a 1.3-1.5 m single-frame jump the audit rightly flags. */
        const catcher = this.live.find((p) => p.sinbin <= 0 && !p.down
          && Math.hypot(p.x - s.bx, p.z - s.bz) < 1.2 && s.by < 2.55);
        if (catcher && R() < (catcher.team === s.kicker ? 0.55 + (this.slider(s.kicker, 'chase') / 100) * 0.25 : 0.82)) {
          this.say(catcher.team === s.kicker ? 'REGATHERED BY THE CHASE!' : 'TAKEN CLEANLY IN THE AIR');
          const num = catcher.num, bx = s.bx, bz = s.bz, tm = catcher.team;
          this.kk = undefined;
          /* A fielder is still in the act of landing — a quarter-second beat
           * before he may be touched, else the contest catch resolves into an
           * instant tackle every time and nobody ever runs a kick back. */
          this.receipt = { team: tm, at: this.t };
          this.startOpen(tm, bx, bz, num, 1, 0, 0.25);
          return;
        }
      }

      // dead once it has stopped moving or run out of road
      const stopped = s.by <= 0.12 && s.vy === 0 && Math.hypot(s.vx, s.vz) < 1.0;
      /* T-18. The time cap applies to the ROLL — a ball still in the air at
       * 3 s (a bomb's hang is 3.4 s) must be allowed to come down, or the
       * phase ends mid-flight and the audit rightly flags a ball that never
       * bounced. */
      if (stopped || s.bounces > 6 || (s.t > 3.0 && s.by <= 0.12 && s.vy === 0)) { this.kickLanded(s); return; }
      if (Math.abs(s.bx) > 34.6) {
        // 50:22 gives the throw to the side that kicked it
        const fromOwn = Math.abs(s.bz - s.dir * 50) > 50;
        if (s.type === 'FIFTY_22' && fromOwn) {
          this.say('50:22 — THE THROW IS YOURS');
          this.kk = undefined;
          this.startLineout(s.kicker, s.bz, Math.sign(s.bx) * 6);
          return;
        }
        this.say('INTO TOUCH — GOOD TERRITORY');
        this.kk = undefined;
        this.startLineout(this.defending(), s.bz, Math.sign(s.bx) * 6);
        return;
      }
      if (s.bz > FIELD.deadZFar - 1 || s.bz < FIELD.deadZ + 1) {
        if (s.profile.atGoal) { this.kickMissed(s, 'DEAD — NO GOOD'); return; }
        this.touchDown();
        return;
      }
    }
    void input;
  }

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

  private launch(power: number, accuracy: number, wind: number) {
    const s = this.kk!;
    const wet = wetnessOf(WEATHERS[this.options.weather ?? 1]);
    const assist = this.isHuman(s.kicker) ? this.assists.kick : 0.5;
    /* Accuracy is the kicker's + weather, not the launch. It widens the angle
     * spread but never changes how far the ball goes. */
    const acc = clamp(accuracy - wet * 0.05 + assist * 0.08, 0.1, 0.99);

    /* T-24 KICK POWER. The old code set velocity to `dist * 0.72` and flight
     * time to `dist / k`, so actual travel was `dist² × 0.72` — a 46 m punt flew
     * over 60 m and rolled out the back. The ball now lands at exactly the
     * distance the power line showed: speed = distance / hang time. */
    const dist = this.kickReach(s, power);

    // Hang time per type, tuned so the apex stays realistic (g·hang²/8).
    const hang = s.type === 'GRUBBER' ? 1.0
      : s.type === 'DROP_GOAL' ? 2.2
        : s.type === 'GOAL' ? 1.9
          : s.type === 'BOMB' ? 3.4
            : s.type === 'RESTART' || s.type === 'DROP_OUT' ? 2.9
              : 2.0;   // punt — a flat, chasing territory kick

    const speed = dist / Math.max(0.6, hang);
    const spread = (1 - acc) * 9 + wind * 6;
    const angRad = (((R() - 0.5) * spread + s.aim * 10) * Math.PI) / 180;
    const vz = Math.cos(angRad) * speed * s.dir;
    const vx = Math.sin(angRad) * speed;
    const vy = 0.5 * 9.81 * hang;
    s.vx = vx; s.vz = vz; s.vy = vy;
    s.stage = 'FLIGHT'; s.t = 0;
    s.chasers = CHASE_ORDER.slice(0, 3).map((num, i) => ({ num, lane: CHASE_LANES[i].label }));
    this.shake(0.15);
  }

  private kickScored(s: KickState) {
    s.stage = 'RESULT'; s.result = 'SCORED';
    const isConv = this.lastScorer?.kind === 'TRY';
    const pts = s.type === 'GOAL' ? (isConv ? POINTS.CONVERSION : POINTS.PENALTY) : POINTS.DROP_GOAL;
    this.teams[s.kicker].score += pts;
    this.events.push({ min: this.minute, team: s.kicker, kind: s.type, text: `${this.teams[s.kicker].nation.short} +${pts} — ${s.kickerName}` });
    this.commentate('KICK');
    this.banner_(`${this.teams[s.kicker].nation.short} +${pts} — ${s.kickerName}`);
    this.kk = undefined;
    this.restartAfterScore(s.kicker === 'A' ? 'B' : 'A');
  }

  private kickMissed(s: KickState, why: string) {
    s.stage = 'RESULT'; s.result = 'MISSED';
    this.commentate('KICK', `— ${why}`);
    this.banner_('NO GOOD');
    this.kk = undefined;
    this.restartAfterScore(s.kicker === 'A' ? 'B' : 'A');
  }

  private kickLanded(s: KickState) {
    s.stage = 'RESULT'; s.result = 'LANDED';
    const chase = this.slider(s.kicker, 'chase') / 100;
    const regather = R() < 0.22 + chase * 0.4;
    const rec = assignReceiver(this.live, this.defending(), s.bx, s.bz);
    this.kk = undefined;
    if (regather && s.type !== 'GOAL') {
      this.commentate('GENERAL', '— REGATHERED BY THE CHASE');
      this.startOpen(s.kicker, s.bx, s.bz, s.chasers[0]?.num ?? 14, 1);
      return;
    }
    const dTeam: 'A' | 'B' = s.kicker === 'A' ? 'B' : 'A';
    if (R() < 0.5) {
      this.startOpen(dTeam, s.bx, s.bz, rec.num, 1);
    } else {
      this.startScrum(dTeam, s.bx, s.bz);
    }
  }

  /* ============================ SCORES, PENALTIES, RESTARTS ============================ */

  private scoreTry() {
    const team = this.possession;
    const num = this.op?.carrierNum ?? (this.ml ? 8 : 8);
    const p = this.teams[team].players[num - 1];
    const tryX = this.op?.carrierX ?? this.ml?.x ?? 0;
    this.teams[team].score += POINTS.TRY;
    this.run(team, num).metres += 20;
    this.lastScorer = { num, name: p.name, team, min: this.minute, kind: 'TRY' };
    this.events.push({ min: this.minute, team, kind: 'TRY', text: `TRY — ${p.name}` });
    this.momentum = clamp(this.momentum + (team === 'A' ? 1 : -1) * 0.3, -1, 1);
    this.commentate('TRY', `— ${p.name}`);
    this.banner_(`TRY! ${this.teams[team].nation.short} — ${p.name}`);
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
  private touchDown() {
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
  private card(team: 'A' | 'B', num: number, reason: string) {
    const p = this.L(team, num);
    if (!p || p.sinbin > 0) return;
    p.sinbin = 600;
    const name = this.teams[team].players[num - 1]?.name ?? `SHIRT ${num}`;
    this.banner_(`YELLOW CARD — ${num} ${name}`);
    this.say(`YELLOW CARD — ${num} ${name} — ${reason}`);
    this.showHint(`YELLOW CARD ${num} (${name}) — DOWN TO 14 FOR TEN MINUTES`, 5);
  }

  /** Repeat-offence memory, keyed by side and shirt, stored in match seconds. */
  private offenceLog = new Map<string, number>();

  beginPenalty(team: 'A' | 'B', call: string, offenderNum: number, free = false) {
    const opp: 'A' | 'B' = team === 'A' ? 'B' : 'A';
    this.lawCall(call.replace(/[—-].*$/, '').trim(), call, opp);
    /* THE FREEZE BUG.
     * A penalty could be awarded from inside upBreakdown / upScrum / upMaul while
     * players were still flagged `down` or `bound`. think() skips any player in
     * that state, so those men never moved again — and if the new carrier was one
     * of them the whole match locked up. Every penalty now fully releases the
     * cast and tears down the phase it interrupted, before anything else.
     *
     * T-18: the MARK is captured first. Reading focusPoint() after releaseAll
     * always returned {0,0} — every penalty in the match was taken from the
     * centre spot, so nobody was ever in goal range and a kick to touch had
     * 35 m of lateral ground to cover from midfield. */
    const mark = this.focusPoint();
    this.releaseAll();

    /* T-07 — card logic.
     * A high tackle is a card on its own. Anything else escalates when the same
     * shirt offends again within ten match-minutes. Placeholder offender numbers
     * (some call sites pass a rough shirt) make the repeat attribution approximate;
     * the card itself is what matters. */
    if (!free && offenderNum > 0) {
      const now = (this.half - 1) * 40 * 60 + this.clock;
      const key = `${opp}:${offenderNum}`;
      const last = this.offenceLog.get(key);
      const highTackle = call.includes('HIGH');
      const repeat = last !== undefined && now - last < 600;
      if (highTackle || (repeat && R() < 0.7)) {
        this.card(opp, offenderNum, highTackle ? 'HIGH TACKLE' : 'REPEAT OFFENCE');
      }
      this.offenceLog.set(key, now);
    }
    const f = { x: Number.isFinite(mark.x) ? mark.x : 0, z: Number.isFinite(mark.z) ? mark.z : 0 };
    this.pendingPenalty = { team, x: f.x, z: f.z, free };
    this.advantage = free ? 0 : [1.2, 2.6, 4.2][this.options.advantage ?? 1];
    this.advantageTeam = team;
    if (this.advantage > 0) {
      this.say('ADVANTAGE — PLAY ON');
      this.showHint('ADVANTAGE — GAIN GROUND AND PLAY CONTINUES', 2.4);
      this.possession = team;
      this.startOpen(team, f.x, f.z, this.op?.carrierNum ?? 9, 1, 0, 0.6);
      return;
    }
    this.resolvePenalty();
  }

  private resolvePenalty() {
    const p = this.pendingPenalty;
    this.pendingPenalty = null;
    if (!p) return;
    this.quickTap = true;
    this.penaltyChoices(p.team, p.x, p.z, p.free);
  }

  quickTap = false;
  /** set just before a penalty kick to touch so the aim logic strikes for the line */
  penaltyTouchKick = false;

  private penaltyChoices(team: 'A' | 'B', x: number, z: number, free: boolean) {
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

  private endHalf() {
    if (this.half === 1) {
      this.say(`HALF TIME. ${this.teams.A.nation.short} ${this.teams.A.score} — ${this.teams.B.score} ${this.teams.B.nation.short}`);
      this.banner_('HALF TIME');
      this.paused = true;
      this.half = 2;
      this.clock = 0;
      this.addedTime = 0;
      /* T-18. In a CPU-v-CPU match nobody presses the "SECOND HALF" button —
       * the half-time freeze lasted forever, and every simulated "match" was
       * one half plus three-quarters of the engine's time budget spent
       * frozen at the banner. That single dead span was why every box-score
       * statistic read at half strength. Resume by itself after a beat. */
      if (!this.isHuman('A') && !this.isHuman('B')) {
        this.holdTimer = 2.5;
      }
      return;
    }
    this.endMatch();
  }

  resumeSecondHalf() {
    this.paused = false;
    this.startKick(this.teams.A.score >= this.teams.B.score ? 'B' : 'A', 'RESTART', { x: 0, z: 0 });
  }

  private endMatch() {
    this.over = true;
    this.commentate('GENERAL', '— AND THAT IS FULL TIME');
    this.banner_(`FULL TIME  ${this.teams.A.nation.short} ${this.teams.A.score} — ${this.teams.B.score} ${this.teams.B.nation.short}`);
  }

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
