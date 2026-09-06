/**
 * MATCH — the simulation core.
 *
 * A deterministic, headless rugby union match engine. No DOM, no rendering,
 * no wall-clock dependence: it steps in fixed sim seconds, consumes a
 * MatchSetup and a Difficulty, and produces a MatchViewState snapshot that
 * the view layer renders. Because it is pure logic it is driven by the
 * simcheck harness at up to hundreds of times real time.
 *
 * Phase machine (a union of the corpus mini-games):
 *   RESTART → OPEN → (RUCK | MAUL | SCRUM | LINEOUT) → OPEN → … → GOALKICK
 * Every law that fires does so through referee(), which owns the whistle.
 */
import {
  TEAM_BY_ID, KITS as NATION_KITS, POSITION_NAMES, POINTS, COMMENTARY,
  AI_ARCHETYPES,
} from 'design/data';
import {
  PITCH_L, PITCH_W, IN_GOAL, MID_Y, HALFWAY_X, POST_Y, CROSSBAR_H,
  TACKLE_REACH, CARRIER_RADIUS, ACCEL, topSpeed, SPRINT_DRAIN, WALK_RECOVER,
  PASS_SPEED, BALL_GRAV, BALL_BOUNCE, BALL_ROLL_FRICTION, CATCH_RADIUS, PICKUP_RADIUS,
  TACKLE_RATE, OFFLOAD_WINDOW, RUCK_MIN_ATTACKERS, RUCK_SETTLE, QUICK_BALL, SLOW_BALL,
  USE_IT_CLOCK, JACKAL_SETTLE, MAUL_MIN, MAUL_DRIVE, MAUL_DRIVE_DECAY, MAUL_STOP_MIN,
  SCRUM_SETUP, LINEOUT_SETUP, GOAL_SETUP, RESTART_SETUP,
  difficultyOf, weatherError, weatherKick, topSpeed as tsFn,
  PUNT_DIST, BOX_DIST, GRUBBER_DIST, GOAL_MAX_KCK_DIST,
} from './tuning';
import type { Difficulty, Weather } from './tuning';
import type { TeamId, DynPlayer, Ball, MatchSetup, TeamLive, PlayerState } from './types';
import {
  MatchViewState, PhaseInfo, MatchEvent, FeedLine, EventKind,
} from './types';
import { Rng, clamp, lerp, dist, angleTo, wrapAngle, clockLabel, minuteLabel } from './utils';
import { beyondGoal, toGoal, fieldZone, onField, beyondOffsideLine, ownGoalX } from './laws';
import { think } from './brain';
import { resolveWrapDuel, resolveContest, ballOut } from '../physics/contact';
import type { ContestOutcome } from '../physics/contact';

const RUCK_ARRIVE_BEFORE = 0.5;   // s grace to arrive & still "first man"
const CONTEST_AFTER = 1.5;        // s the ball stays "unplayable" in the ruck
const TACKLE_GRACE = 0.35;        // post-tackle before jackal/clean arrives

/* ------------------------------------------------------------------ misc -- */
export const teamOf = (idx: number): TeamId => (idx < 15 ? 'A' : 'B');
export const otherTeam = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');

interface RuckCtl {
  x: number; y: number;
  attack: TeamId;                 // side that carried into contact
  def: TeamId;
  state: 'ARRIVING' | 'CONTEST' | 'READY' | 'OUT';
  clearedBy: TeamId | null;
  jackalIdx: number | null;       // first defender to reach the ball
  attackCommits: number[];        // attacker idxs bound
  defCommits: number[];           // defender idxs bound
  firstMan: number | null;        // idx who arrives first (their side "wins" entry)
  contest: number;                // contest power 0..1
  readyAt: number;
  useItDeadline: number;
  // --- contest ledger (from physics/contact; decided ONCE per ruck) -------
  presentation: number;           // 0..1 how cleanly the carrier played the ball
  momentum: number;               // attack momentum at the hit (0..1)
  spillT: number;                 // sim time the ball hit the deck
  defArriveT: number;             // sim time the first defender bound (jackal in)
  uContest: number;               // the single stored dice for this ruck
  decided: boolean;               // duel resolved?
  outSpeed: 'QUICK' | 'NORMAL' | 'SLOW' | null;  // decided by the ledger
}

interface MaulCtl {
  x: number; y: number;
  attack: TeamId; def: TeamId;
  attackers: number[]; defenders: number[];
  bound: number;                  // total bodies
  state: 'DRIVE' | 'STOPPED' | 'OUT';
  speed: number;
  useItDeadline: number;
}

interface ScrumCtl {
  x: number; y: number;
  feed: TeamId; def: TeamId;
  state: 'ASSEMBLE' | 'ENGAGED' | 'PUSH' | 'OUT' | 'REWIND';
  t0: number;
  collapse: number;               // 0..1 risk built during push
  wheel: number;                  // angle drift
  won: boolean;
}

interface LineoutCtl {
  x: number; y: number;
  thrower: TeamId; def: TeamId;
  jumper: number | null;          // idx of the side's chosen jumper
  call: 'FRONT' | 'MID' | 'BACK';
  state: 'ASSEMBLE' | 'THROW' | 'AIR' | 'OUT';
  contestant: number | null;
  t0: number;
  wonBy: TeamId | null;
}

interface GoalKickCtl {
  at: 'PEN' | 'CON';
  team: TeamId;
  x: number; y: number;
  kicker: number;                 // player idx
  dist: number; angle: number;    // angle from straight ahead, radians
  phase: 'TEE' | 'SWING' | 'FLIGHT' | 'RESULT';
  t0: number;
  result: 'GOOD' | 'MISS' | null;
  prob: number;
  flightT: number;
}

interface RestartCtl {
  kind: 'KICKOFF' | 'DROP22';
  team: TeamId;
  x: number; y: number;
  state: 'SET' | 'SWING' | 'FLIGHT';
  t0: number;
}

type Contested = 'RUCK' | 'MAUL';

export interface HumanInput {
  up: number; left: number; down: number; right: number;
  sprint: boolean;
  passL: boolean; passR: boolean;
  kick: boolean; grubber: boolean; drop: boolean;
  dive: boolean; smother: boolean; switchP: boolean;
  fend: boolean;
}

const NO_INPUT: HumanInput = {
  up: 0, left: 0, down: 0, right: 0, sprint: false,
  passL: false, passR: false, kick: false, grubber: false, drop: false,
  dive: false, smother: false, switchP: false, fend: false,
};

/* ============================================================ MATCH ====== */
export class Match {
  setup: MatchSetup;
  rng: Rng;
  diff: Difficulty;
  weather: Weather;
  seed: number;

  t = 0;                     // sim seconds, half 1 then half 2
  half: 1 | 2 = 1;
  halfLenMin: number;
  halfBreakDone = false;
  over = false;
  paused = false;

  players: DynPlayer[] = [];
  a: TeamLive;
  b: TeamLive;

  ball: Ball = {
    state: 'loose', x: HALFWAY_X, y: MID_Y, h: 0.05,
    vx: 0, vy: 0, vz: 0, ownerIdx: -1, lastTouch: null, flightFrom: null, out: false,
  };

  phase: PhaseInfo = { kind: 'STOPPED', ballTeam: null, x: HALFWAY_X, y: MID_Y, label: '', sub: '', since: 0 };
  phaseKind: string = 'STOPPED';
  private pkind = 'STOPPED';          // raw phase id incl. set-piece sub-states

  carrierIdx = -1;
  private lastCarrierIdx = -1;

  /** Per-match brain cooldowns (module-level caches leaked across matches in
   *  a process — simcheck runs many matches back-to-back, so these MUST live
   *  on the instance). */
  lastPassAt: Record<TeamId, number> = { A: -99, B: -99 };
  lastKickAt: Record<TeamId, number> = { A: -99, B: -99 };
  /** Passes thrown since the ball last went to ground / a restart — the
   *  brain uses it to end a spread and take the ball to the line. */
  spreadPasses = 0;

  ruck: RuckCtl | null = null;
  maul: MaulCtl | null = null;
  scrum: ScrumCtl | null = null;
  lineout: LineoutCtl | null = null;
  goal: GoalKickCtl | null = null;
  restart: RestartCtl | null = null;
  pendingPenalty: { team: TeamId; kind: string; x: number; y: number } | null = null;

  // human
  humanTeam: TeamId | null = null;
  liveControl = false;
  humanInput: HumanInput = { ...NO_INPUT };
  humanSteered = false;
  private switchCooldown = 0;
  /** Which man the human currently steers (carrier on attack, nearest in defence). */
  controlledIdx = -1;

  feed: FeedLine[] = [];
  events: MatchEvent[] = [];
  /** Untrimmed full-match event ledger (for tools/analysis). */
  ledger: MatchEvent[] = [];
  private feedCap = 46;
  whistleInfo: { text: string; at: number } | null = null;
  bannerInfo: { text: string; at: number; sub?: string } | null = null;
  cards: { team: TeamId; playerIdx: number; at: number; kind: 'YELLOW' | 'RED'; text: string }[] = [];

  offsideShow: { x: number; team: TeamId } | null = null;
  private lastEventAt: Record<string, number> = {};
  private lastThink = 0;
  private kickFlight: { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; apex: number } | null = null;

  private desires = new Map<number, { vx: number; vy: number; speed: number; sprint: boolean }>();
  private statRating: { a: number; b: number } | null = null;
  private lineoutThrowT = 0;
  private goalProbeT = 0;

  constructor(setup: MatchSetup) {
    this.setup = setup;
    this.seed = setup.seed;
    this.rng = new Rng(setup.seed);
    this.weather = setup.weather;
    this.diff = difficultyOf(clamp(setup.difficulty, 0, 9));
    this.halfLenMin = setup.halfMinutes || 40;
    this.liveControl = true; // default; view can clear via options later
    this.humanTeam = setup.a.human ? 'A' : setup.b.human ? 'B' : null;
    this.a = this.buildTeam('A', setup.a.id, setup.a.kitIdx, setup.a.human);
    this.b = this.buildTeam('B', setup.b.id, setup.b.kitIdx, setup.b.human);
    this.setLineups();
    this.startMatch();
  }

  /* ------------------------------------------------------------ setup ---- */
  private buildTeam(team: TeamId, id: string, kitIdx: number, human: boolean): TeamLive {
    const nation = TEAM_BY_ID(id);
    const kit = (NATION_KITS[id] ?? NATION_KITS.ENG)[kitIdx % (NATION_KITS[id] ?? NATION_KITS.ENG).length];
    const att = nation.att;
    const rating = Math.round(
      (att.scrum + att.lineout + att.maul + att.ruck + att.defence + att.attack
        + att.kicking + att.discipline + att.fitness + att.pace + att.handling + att.creativity) / 12);
    const arch = AI_ARCHETYPES[nation.archetype] ?? AI_ARCHETYPES['TEMPO WIDE'];
    return {
      nation, kit, short: nation.short, score: 0,
      tries: 0, conv: 0, pens: 0, drops: 0,
      players: [], attackingDir: team === 'A' ? 1 : -1,
      st: {
        possession: 0, territory: 0, tackles: 0, tacklesMissed: 0,
        turnovers: 0, turnoversConceded: 0, lineBreaks: 0, carries: 0, metres: 0,
        passes: 0, offloads: 0, kicks: 0,
        scrumsWon: 0, scrumsLost: 0, scrumPens: 0,
        lineoutsWon: 0, lineoutsLost: 0, rucksWon: 0, rucksLost: 0, mauls: 0,
        pensConceded: 0, freeKicksConceded: 0, yellow: 0, red: 0, phases: 0,
      },
      intent: {
        width: 0.5, aggression: 0.5, tempo: 0.5, kicking: 0.5,
        offload: 0.5, lineSpeed: 0.55, ruckCommit: 0.5, chase: 0.55,
        setPiece: 0.5, shotCalls: 0.6,
      },
      rating,
    };
  }

  private setLineups() {
    const mk = (team: TeamId, idxBase: number): DynPlayer[] => {
      const live = team === 'A' ? this.a : this.b;
      const nation = live.nation;
      const dir = live.attackingDir;
      return nation.squad.slice(0, 15).map((sp, i) => {
        const startX = dir === 1 ? 30 - i * 0.2 : PITCH_L - 30 + i * 0.2;
        return {
          idx: idxBase + i, team, num: sp.num, name: sp.name, pos: sp.pos,
          spd: sp.stats.SPD, pwr: sp.stats.PWR, skl: sp.stats.SKL, kck: sp.stats.KCK,
          sta: sp.stats.STA, ttl: sp.stats.TTL, star: sp.star,
          x: startX, y: MID_Y + (i % 2 === 0 ? -1 : 1) * (2 + Math.floor(i / 3) * 4),
          vx: 0, vy: 0, face: dir > 0 ? 0 : Math.PI,
          state: 'idle', stamina: 1, sinbinUntil: 0, downUntil: 0,
          tackles: 0, tacklesMissed: 0, carries: 0, metres: 0, passes: 0, kicks: 0,
          lineBreaks: 0, turnoversWon: 0, points: 0, tries: 0, catches: 0, offloads: 0,
          pensConceded: 0, rating: 0,
        };
      });
    };
    this.players = [...mk('A', 0), ...mk('B', 15)];
    this.a.players = this.players.slice(0, 15);
    this.b.players = this.players.slice(15);
  }

  /* ---------------------------------------------------------- direction -- */
  dirOf(team: TeamId): 1 | -1 {
    const t = team === 'A' ? this.a : this.b;
    // attackingDir flips at half time
    return t.attackingDir;
  }
  setPhaseTeamDir() {
    // at half time each team turns around
    this.a.attackingDir = this.half === 1 ? 1 : -1;
    this.b.attackingDir = this.half === 1 ? -1 : 1;
  }
  teamLive(team: TeamId) { return team === 'A' ? this.a : this.b; }
  opp(team: TeamId): TeamId { return team === 'A' ? 'B' : 'A'; }
  player(idx: number) { return this.players[idx]; }
  carrier(): DynPlayer | null { return this.carrierIdx >= 0 ? this.players[this.carrierIdx] : null; }

  /** attacking axis distance from x to that team's goal. */
  toGoal(team: TeamId, x: number) { return toGoal(this.dirOf(team), x); }

  /* ------------------------------------------------------- match start --- */
  private startMatch() {
    this.setPhaseTeamDir();
    this.placeTeamsForKickoff();
    this.beginRestart('KICKOFF', this.losingTeamKicks() === 'A' ? 'A' : 'B');
    this.setPhase({ kind: 'RESTART', ballTeam: null, x: HALFWAY_X, y: MID_Y, label: 'KICKOFF', sub: 'AWAITING THE WHISTLE' });
  }

  private losingTeamKicks(): TeamId {
    // simulated coin toss — team A "wins" the toss on even seeds
    return this.seed % 2 === 0 ? 'B' : 'A';
  }

  private placeTeamsForKickoff() {
    const kickerTeam = this.losingTeamKicks() === 'A' ? 'A' : 'B'; // this team kicks
    for (const p of this.players) {
      if (p.team === kickerTeam) {
        p.x = HALFWAY_X - this.dirOf(kickerTeam) * 0.5;
        p.y = MID_Y + ((p.idx % 5) - 2) * 3;
      } else {
        p.x = HALFWAY_X - this.dirOf(p.team) * 8;
        p.y = MID_Y + ((p.idx % 5) - 2) * 3;
      }
      p.vx = 0; p.vy = 0; p.state = 'idle';
    }
  }

  /* --------------------------------------------------------- phase wall -- */
  /**
   * Update the presentation phase. NOTE: this deliberately does NOT write
   * this.pkind — several flows (kick flight, pass flight, goal prep) run
   * under an OPEN *display* phase while their internal machine id differs.
   * The internal machine id is set explicitly at every transition.
   */
  private setPhase(p: PhaseInfo) {
    this.phase = { since: this.t, ...p };
  }
  set kind(k: string) { this.pkind = k; }
  get kind() { return this.pkind; }

  private pushFeed(text: string, kind: EventKind = 'GENERIC', text2?: string) {
    this.feed.push({ text, at: this.t, kind, text2 });
    if (this.feed.length > this.feedCap) this.feed.shift();
  }
  private pushEvent(e: MatchEvent) {
    e.t = this.t;
    this.events.push(e);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    // untrimmed ledger: tools (simcheck) and analysis count the FULL match —
    // several events can be pushed inside one update tick, so watching the
    // trimmed tail misses everything except the last push of each tick
    this.ledger.push(e);
  }
  private banner(text: string, sub?: string) {
    this.bannerInfo = { text, at: this.t, sub };
    this.pushFeed(text, 'GENERIC');
  }
  private whistle(text: string) {
    this.whistleInfo = { text, at: this.t };
  }
  private rarefy(kind: string, gap: number): boolean {
    const last = this.lastEventAt[kind] ?? -Infinity;
    if (this.t - last < gap) return false;
    this.lastEventAt[kind] = this.t;
    return true;
  }

  /* ------------------------------------------------------------- step ---- */
  /** Advance the match by dt sim seconds (caller substeps to keep dt ≤ 1/20). */
  update(dt: number, input?: HumanInput) {
    if (this.paused || this.over) return;
    if (input) {
      this.humanInput = input;
      this.humanSteered = true;
    }
    const h = Math.min(0.1, Math.max(0, dt));
    this.step(h);
    this.postStep();
  }

  private step(dt: number) {
    this.t += dt;
    const ph = this.pkind;

    if (ph === 'HALF') { this.stepHalfGap(dt); return; }
    if (ph === 'FULL') { return; }

    // the match clock runs whenever the ball is live AND while set pieces are
    // being formed and kicked (as in a real 80-minute match, where scrums,
    // lineouts and goal attempts consume clock). Only dead time — try
    // celebrations, conversion tee-up, half-time — is frozen.
    const live = ph === 'OPEN' || ph === 'RUCK' || ph === 'MAUL'
      || ph === 'KICKFLIGHT' || ph === 'PASSFLIGHT' || ph === 'SETTLE'
      || ph === 'SCRUM' || ph === 'LINEOUT' || ph === 'GOALKICK' || ph === 'RESTART';

    // events/seconds for half-time & full-time (play clock)
    if (live && this.half === 1 && this.elapsedHalf() >= this.halfLenMin * 60) this.blowHalf();
    if (live && this.half === 2 && this.elapsedHalf() >= this.halfLenMin * 60) this.blowFull();
    if (this.pkind === 'HALF' || this.pkind === 'FULL') return;

    switch (this.pkind) {
      case 'RESTART': this.stepRestart(dt); break;
      case 'SETTLE': this.stepSettle(dt); break;
      case 'OPEN': this.stepOpen(dt); break;
      case 'KICKFLIGHT': this.stepKickFlight(dt); this.chaseLanding(dt); break;
      case 'PASSFLIGHT': this.stepPassFlight(dt); break;
      case 'RUCK': this.stepRuck(dt); if (this.ruck) { this.stepRuckArrivals(dt); this.retreatOffside('RUCK', dt); } break;
      case 'MAUL': this.stepMaul(dt); this.retreatOffside('MAUL', dt); break;
      case 'SCRUM': this.stepScrum(dt); this.retreatOffside('SCRUM', dt); break;
      case 'LINEOUT': this.stepLineout(dt); this.retreatOffside('LINEOUT', dt); break;
      case 'GOALKICK': this.stepGoalKick(dt); break;
      case 'GOALPREP': this.stepGoalPrep(dt); break;
      default: break;
    }

    // fatigue & positioning in the live phases
    if (this.pkind === 'OPEN' || this.pkind === 'KICKFLIGHT' || this.pkind === 'PASSFLIGHT') {
      this.movePlayers(dt);
      this.updateStamina(dt);
    }
    // brain ticks during open play
    if (this.pkind === 'OPEN' && this.t - this.lastThink > 0.2) {
      this.lastThink = this.t;
      think(this, 0.2);
    }
    if (this.pkind === 'RUCK' || this.pkind === 'MAUL') this.updateSetStamina(dt);
  }

  private postStep() {
    // deferred ball hand-overs: the man must be upright and the ball loose
    if (this.pendingGives.length) {
      const due = this.pendingGives.filter((g) => g.at <= this.t);
      this.pendingGives = this.pendingGives.filter((g) => g.at > this.t);
      for (const g of due) {
        const p = this.player(g.idx);
        if (!p || p.downUntil > this.t || p.sinbinUntil > this.t) continue;
        if (this.carrierIdx >= 0 || this.ball.state !== 'loose') continue;
        this.ball.x = p.x; this.ball.y = p.y;
        this.giveBallTo(p.idx);
      }
    }
    // decay transient flags
    if (this.bannerInfo && this.t - this.bannerInfo.at > 3.4) this.bannerInfo = null;
    if (this.whistleInfo && this.t - this.whistleInfo.at > 2.0) this.whistleInfo = null;
    if (this.offsideShow && this.pkind !== 'RUCK' && this.pkind !== 'MAUL'
      && this.pkind !== 'SCRUM' && this.pkind !== 'LINEOUT') this.offsideShow = null;
  }

  elapsedHalf() { return this.half === 1 ? this.t : this.t - this.halfLenMin * 60; }

  /* ------------------------------------------------------------- clock --- */
  private blowHalf() {
    this.banner(`HALF TIME — ${this.a.short} ${this.a.score} ${this.b.score} ${this.b.short}`);
    this.pushEvent({ kind: 'HALF', t: this.t, text: `HALF TIME — ${this.a.score}-${this.b.score}`, team: null });
    this.setPhase({ kind: 'STOPPED', ballTeam: null, x: HALFWAY_X, y: MID_Y, label: 'HALF TIME', sub: '' , since: this.t });
    this.pkind = 'HALF';
  }
  private blowFull() {
    this.over = true;
    this.computeRatings();
    this.banner(`FULL TIME — ${this.a.short} ${this.a.score} ${this.b.score} ${this.b.short}`);
    this.pushEvent({ kind: 'FULL', t: this.t, text: `FULL TIME — ${this.a.score}-${this.b.score}`, team: null, scoreA: this.a.score, scoreB: this.b.score });
    this.setPhase({ kind: 'STOPPED', ballTeam: null, x: HALFWAY_X, y: MID_Y, label: 'FULL TIME', sub: '', since: this.t });
    this.pkind = 'FULL';
  }
  private stepHalfGap(dt: number) {
    // a beat of presentation then the second half
    if (this.t - (this.phase.since ?? this.t) > 6 && !this.halfBreakDone) {
      this.halfBreakDone = true;
      this.half = 2;
      this.setPhaseTeamDir();
      this.placeTeamsForKickoff();
      this.beginRestart('KICKOFF', this.halfKickTeam());
      this.setPhase({ kind: 'RESTART', ballTeam: null, x: HALFWAY_X, y: MID_Y, label: 'KICKOFF', sub: 'SECOND HALF' });
    }
  }
  private halfKickTeam(): TeamId {
    // the team that did NOT kick off the first half starts the second
    return this.teamKickedFirst === 'A' ? 'B' : 'A';
  }
  private teamKickedFirst: TeamId = 'A';

  /* -------------------------------------------------------- RESTART ------ */
  private beginRestart(kind: 'KICKOFF' | 'DROP22', team: TeamId) {
    const dir = this.dirOf(team);
    const x = kind === 'KICKOFF' ? HALFWAY_X : dir === 1 ? 22 : PITCH_L - 22;
    const y = MID_Y;
    this.restart = { kind, team, x, y, state: 'SET', t0: this.t };
    this.pkind = 'RESTART';
    this.ball = { state: 'loose', x, y, h: 0.05, vx: 0, vy: 0, vz: 0, ownerIdx: -1, lastTouch: null, flightFrom: null, out: false };
    this.setPhase({ kind: 'RESTART', ballTeam: team, x, y, label: kind === 'KICKOFF' ? 'KICKOFF' : '22 DROP OUT', sub: 'SET' });
  }

  private stepRestart(dt: number) {
    const r = this.restart!;
    // receiving team lines up
    if (r.state === 'SET') {
      // let the kicker walk in and teams settle
      if (this.t - r.t0 > RESTART_SETUP * 0.4) {
        r.state = 'SWING';
      }
      this.defensiveLineForRestart(r);
      return;
    }
    if (r.state === 'SWING') {
      // a moment of "run up"
      if (this.t - r.t0 > RESTART_SETUP * 0.7) {
        const kicker = this.findKicker(r.team);
        const dir = this.dirOf(r.team);
        const dist = r.kind === 'KICKOFF' ? this.range(38, 52) : this.range(38, 52);
        const yTarget = r.y + this.range(-14, 14) * (this.weather !== 'DRY' ? 0.85 : 1);
        this.launchKick(kicker, r.x, r.y, dir, dist, yTarget, 8.2, true, 'RESTART');
        r.state = 'FLIGHT';
        this.defensiveLineForRestart(r);
        this.pushEvent({ kind: r.kind === 'KICKOFF' ? 'KICKOFF' : 'RESTART_22', text: r.kind === 'KICKOFF'
          ? `${this.teamLive(r.team).short} kick off at ${this.teamLive(r.team).nation.venue}` : '22 drop-out', team: r.team, t: this.t, x: r.x, y: r.y });
      }
    }
  }
  private defensiveLineForRestart(r: RestartCtl) {
    // visual only: set the offside "line" the receiving side must hold
    const dir = this.dirOf(r.team);
    this.offsideShow = { x: r.kind === 'KICKOFF' ? HALFWAY_X + 10 : (dir === 1 ? 32 : PITCH_L - 32), team: r.team };
  }
  private range(a: number, b: number) { return this.rng.range(a, b); }
  private findKicker(team: TeamId): number {
    // the 10 or 15 — highest KCK among backs
    const squad = this.teamLive(team).players;
    let best = squad[0];
    for (const p of squad) if (p.kck > best.kck && p.num >= 10) best = p;
    if (best.kck < 40) { // fall back to max KCK anywhere
      best = squad[0];
      for (const p of squad) if (p.kck > best.kck) best = p;
    }
    return best.idx;
  }

  /* ---------------------------------------------------------- SETTLE ----- */
  /** A penalty/lineout/scrum is "pending" — the referee places it, teams
   *  assemble, and the entitled side decides. Sub-states live in pkind. */
  private beginPenalty(team: TeamId, kind: string, x: number, y: number, text: string) {
    this.spreadPasses = 0;
    this.whistle(text);
    // the side penalised is the opponent of the side awarded the kick
    this.teamLive(this.opp(team)).st.pensConceded += 1;
    // disallow place near own line kicks? keep simple
    this.pendingPenalty = { team, kind, x, y };
    this.pushEvent({ kind: 'PENALTY', text, team, t: this.t, x, y });
    // mark phase so the entitled side's decision happens in stepSettle
    this.pkind = 'SETTLE';
    this.setPhase({ kind: 'STOPPED', ballTeam: team, x, y, label: 'PENALTY', sub: 'DECIDING OPTION' });
    this.settleAt = this.t;
    this.settleKind = 'PENALTY';
    this.ball.state = 'loose'; this.ball.x = x; this.ball.y = y; this.ball.h = 0.05; this.ball.ownerIdx = -1;
  }
  private settleAt = 0;
  private settleKind: 'PENALTY' | 'SCRUM' | 'LINEOUT' | 'FREEKICK' | 'MARK' = 'PENALTY';
  private beginFreeKick(team: TeamId, kind: string, x: number, y: number, text: string) {
    this.whistle(text);
    this.teamLive(team).st.freeKicksConceded += 1;
    this.pushEvent({ kind: 'FREE_KICK', text, team, t: this.t, x, y });
    this.pendingPenalty = { team, kind, x, y };
    this.pkind = 'SETTLE';
    this.settleAt = this.t;
    this.settleKind = 'FREEKICK';
    this.setPhase({ kind: 'STOPPED', ballTeam: team, x, y, label: 'FREE KICK', sub: 'DECIDING OPTION' });
    this.ball.state = 'loose'; this.ball.x = x; this.ball.y = y; this.ball.h = 0.05; this.ball.ownerIdx = -1;
  }
  /** Authoritative match counters (one increment per distinct occurrence). */
  seen = { rucks: 0, scrums: 0, lineouts: 0, mauls: 0, knockOns: 0, fwdPasses: 0, touchIn: 0 };

  private beginScrumFor(team: TeamId, x: number, y: number, reason: string, free = false) {
    this.spreadPasses = 0;
    this.seen.scrums += 1;
    this.pushEvent({ kind: 'SCRUM', text: `${reason} — scrum ${this.teamLive(team).short} put-in`, team, t: this.t, x, y });
    this.scrum = { x: clamp(x, 5, PITCH_L - 5), y: clamp(y, 5, PITCH_W - 5), feed: team, def: this.opp(team), state: 'ASSEMBLE', t0: this.t, collapse: 0, wheel: 0, won: false };
    this.pkind = 'SCRUM';
    this.setPhase({ kind: 'SCRUM', ballTeam: team, x: this.scrum.x, y: this.scrum.y, label: 'SCRUM', sub: 'ASSEMBLING' });
    this.positionForScrum();
  }
  private beginLineoutFor(team: TeamId, x: number, y: number, reason: string) {
    this.spreadPasses = 0;
    this.seen.lineouts += 1;
    const X = clamp(x, 5, PITCH_L - 5), Y = clamp(y, 4, PITCH_W - 4);
    this.pushEvent({ kind: 'LINEOUT', text: `${reason} — lineout ${this.teamLive(team).short} throw`, team, t: this.t, x: X, y: Y });
    this.lineout = { x: X, y: Y, thrower: team, def: this.opp(team), jumper: null, call: 'MID', state: 'ASSEMBLE', contestant: null, t0: this.t, wonBy: null };
    this.pkind = 'LINEOUT';
    this.setPhase({ kind: 'LINEOUT', ballTeam: team, x: X, y: Y, label: 'LINEOUT', sub: 'ASSEMBLING' });
    this.positionForLineout();
  }

  /* ------------------------------------------------------------- ruck ---- */
  /** Caller has already placed the ball loose and set p.tackled carrier.
   *  `ledger` carries the physics/contact contest context decided at the hit:
   *  presentation quality, attack momentum and the stored dice for the ruck
   *  contest — the ball-out story and the clock must agree, so the ruck is
   *  resolved ONCE by resolveContest and everything downstream reads it. */
  beginRuck(attack: TeamId, x: number, y: number, tackleIdx: number, carrierIdx: number,
    ledger?: { presentation: number; momentum: number; uContest: number }) {
    this.seen.rucks += 1;
    const def = this.opp(attack);
    this.ruck = {
      x, y, attack, def, state: 'ARRIVING',
      clearedBy: null, jackalIdx: null, attackCommits: [], defCommits: [],
      firstMan: tackleIdx, contest: 0, readyAt: Infinity, useItDeadline: Infinity,
      presentation: ledger?.presentation ?? 0.6,
      momentum: ledger?.momentum ?? 0.5,
      spillT: this.t,
      defArriveT: Infinity,
      uContest: ledger?.uContest ?? this.rng.next(),
      decided: false,
      outSpeed: null,
    };
    this.pkind = 'RUCK';
    this.setPhase({ kind: 'RUCK', ballTeam: attack, x, y, label: 'RUCK', sub: 'ARRIVING' });
    // the tackled man and tackler are down; ball is under the ruck
    this.ball.state = 'loose'; this.ball.x = x; this.ball.y = y; this.ball.h = 0.02; this.ball.ownerIdx = -1;
    this.ball.lastTouch = attack;
    this.offsideShow = { x, team: def };
  }

  private stepRuck(dt: number) {
    const r = this.ruck!;
    if (r.state === 'ARRIVING') {
      // the tackle settles; players arrive (stepRuckArrivals). Once the ball
      // is playable the contest either forms or the attack clears straight
      // through.
      if (this.t - this.ruckStartT > RUCK_SETTLE) {
        r.state = 'CONTEST';
        r.readyAt = this.t;
        this.setPhase({ kind: 'RUCK', ballTeam: r.attack, x: r.x, y: r.y, label: 'RUCK', sub: 'CONTEST' });
      }
      return;
    }
    if (r.state === 'CONTEST') {
      // The contest may only be decided once the tackle has settled AND the
      // jackal has had a real beat over the ball (law 15/16 in time terms).
      // Before that the ball is simply unplayable — this is what makes a
      // ruck last 4-8s instead of collapsing in 2.
      const sinceStart = this.t - this.ruckStartT;
      if (!r.decided) {
        const jackalBound = r.defCommits.length > 0 && isFinite(r.defArriveT);
        const jackalSettled = jackalBound && sinceStart >= RUCK_SETTLE && this.t - r.defArriveT > 1.4;
        const noJackalLong = r.defCommits.length === 0 && sinceStart >= RUCK_SETTLE + CONTEST_AFTER;
        if (jackalSettled || noJackalLong) {
          r.decided = true;
          this.resolveRuckContest(r);
          return;                                          // may have ended the ruck
        }
      }
      // decided as attack-ball: wait for the nine (or the use-it clock)
      if (r.decided && this.ruck && this.t - r.readyAt > 0.2) {
        r.state = 'READY';
        r.useItDeadline = this.t + USE_IT_CLOCK;
        this.setPhase({ kind: 'RUCK', ballTeam: r.attack, x: r.x, y: r.y, label: 'RUCK', sub: 'BALL AVAILABLE' });
        if (this.rollRuckPenalty(r)) return;
      }
      return;
    }
    if (r.state === 'READY') {
      // the attacking nine sweeps the ball away once he is in place at the
      // base — a real scrum half takes a beat to arrive, shape and point
      if (this.t > r.readyAt + 1.5 && this.t < r.useItDeadline) {
        const nine = this.findNine(r.attack, r.x, r.y);
        if (nine != null) {
          const dir = this.dirOf(r.attack);
          this.ruck = null;
          this.giveBallTo(nine);
          this.teamLive(r.attack).st.rucksWon += 1;
          this.teamLive(r.def).st.rucksLost += 1;
          this.teamLive(r.attack).st.phases += 1;
          // the ledger decided the tempo (resolveRuckContest / ruckCleared)
          this.lastRuckSpeed = r.outSpeed ?? 'NORMAL';
          this.pushEvent({ kind: 'RUCK', text: `ball out — ${this.lastRuckSpeed}`, team: r.attack, t: this.t });
          this.pkind = 'OPEN';
          this.setPhase({ kind: 'OPEN', ballTeam: r.attack, x: r.x, y: r.y, label: 'OPEN PLAY', sub: 'BALL OUT' });
          // the nine sweeps from the base of the ruck; the pass is released
          // before the defensive rush can land on him
          this.player(nine).x = r.x + dir * 1.2;
          this.player(nine).y = r.y;
        }
      } else if (this.t >= r.useItDeadline) {
        this.ruck = null;
        this.beginScrumFor(r.def, r.x, r.y, 'USE IT — turnover', true);
        this.whistle('USE IT — TURNOVER SCRUM');
        this.teamLive(r.attack).st.rucksLost += 1;
        this.teamLive(r.def).st.rucksWon += 1;
        this.teamLive(r.def).st.turnovers += 1;
        this.teamLive(r.attack).st.turnoversConceded += 1;
        this.pushEvent({ kind: 'TURNOVER', text: 'USE IT — turnover scrum', team: r.def, t: this.t });
      }
    }
    void dt;
  }

  /** THE one contest roll of the ruck (physics/contact ledger). Decided once,
   *  stored on the ruck; the visual lab plays the same shape. */
  private resolveRuckContest(r: RuckCtl) {
    const noJackal = r.defCommits.length === 0;
    if (noJackal) {
      // nobody contested: the attack clears as fast as their arrival allows
      this.ruckCleared(r, 'CLEAN');
      return;
    }
    const jackalIdx = r.defCommits[0];
    const jackalP = this.player(jackalIdx);
    // the cleaner = first bound attacker, or the nearest upright attacker if
    // the defence has beaten the support line (that man is still coming).
    let cleanerP: DynPlayer | null = r.attackCommits.length ? this.player(r.attackCommits[0]) : null;
    if (!cleanerP) {
      const near = this.nearestN(r.attack, r.x, r.y, 2).find((idx) => idx !== jackalIdx);
      cleanerP = near != null ? this.player(near) : null;
    }
    // a jackal with NO attacker within reach wins by default (support beaten)
    if (!cleanerP) {
      this.ruck = null;
      this.endRuckTurnover(r, jackalIdx, 'JACKAL TURNOVER — no clean-out arrives');
      return;
    }
    const held = Math.max(0, this.t - r.spillT - 1.15);      // s under the pile
    const duel = resolveContest({
      jackal: { pwr: jackalP.pwr, skl: jackalP.skl, spd: jackalP.spd, ttl: jackalP.ttl },
      cleaner: { pwr: cleanerP.pwr, skl: cleanerP.skl, spd: cleanerP.spd, ttl: cleanerP.ttl },
      jackalSupport: r.defCommits.length - 1,
      cleanerSupport: r.attackCommits.length,
      jackalLead: clamp((r.defArriveT - r.spillT) - (r.attackCommits.length ? 0.4 : 0.9), -1.2, 1.6),
      presentation: r.presentation,
      momentum: r.momentum,
    }, r.uContest);
    switch (duel.outcome as ContestOutcome) {
      case 'CLEAN':
      case 'SLOW':
        this.ruckCleared(r, duel.outcome as 'CLEAN' | 'SLOW');
        this.pushEvent({ kind: 'GENERIC', text: `clean-out vs jackal — ${duel.reason}`, team: r.attack, t: this.t });
        void held;
        break;
      case 'STEAL': {
        this.ruck = null;
        this.endRuckTurnover(r, jackalIdx, duel.reason);
        break;
      }
      case 'PEN_ATK': {
        this.ruck = null;
        this.teamLive(r.attack).st.rucksLost += 1;
        this.teamLive(r.def).st.rucksWon += 1;
        this.beginPenalty(r.def, 'NOT RELEASING', r.x, r.y,
          `PENALTY — ${this.teamLive(r.attack).short} not releasing (${duel.reason})`);
        break;
      }
      case 'PEN_DEF': {
        this.ruck = null;
        this.teamLive(r.def).st.rucksLost += 1;
        this.teamLive(r.attack).st.rucksWon += 1;
        this.beginPenalty(r.attack, 'HANDS IN THE RUCK', r.x, r.y,
          `PENALTY — ${this.teamLive(r.def).short} hands in the ruck (${duel.reason})`);
        break;
      }
    }
  }

  /** Attack kept the ball: the ledger fixes the tempo and the ruck waits for
   *  the nine. */
  private ruckCleared(r: RuckCtl, contest: 'CLEAN' | 'SLOW') {
    const held = Math.max(0, this.t - r.spillT - 1.15);
    const bo = ballOut(contest, held);
    r.outSpeed = bo.out === 'QUICK' ? 'QUICK' : bo.out === 'SLOW' ? 'SLOW' : 'NORMAL';
    r.clearedBy = r.attack;
    this.pushEvent({ kind: 'GENERIC', text: `ball available (${contest.toLowerCase()}) — ${r.outSpeed}`, team: r.attack, t: this.t });
  }

  /** Defender jackal wins the ball at the breakdown. */
  private endRuckTurnover(r: RuckCtl, jackalIdx: number, reason: string) {
    const j = this.player(jackalIdx);
    j.downUntil = Math.max(j.downUntil, this.t + 0.5);   // beat on the ground
    this.teamLive(r.def).st.turnovers += 1;
    this.teamLive(r.attack).st.turnoversConceded += 1;
    this.teamLive(r.def).st.rucksWon += 1;
    this.teamLive(r.attack).st.rucksLost += 1;
    j.turnoversWon += 1;
    this.whistle('TURNOVER — JACKAL WINS THE RUCK');
    this.pushEvent({ kind: 'TURNOVER', text: reason, team: r.def, t: this.t, x: r.x, y: r.y });
    this.banner('JACKAL!', 'TURNOVER');
    this.turnoverBallAt = this.t;
    this.turnoverBallOwner = jackalIdx;
    this.pendingGives.push({ at: this.t + 0.55, idx: jackalIdx });
    this.pkind = 'OPEN';
    this.setPhase({ kind: 'OPEN', ballTeam: r.def, x: r.x, y: r.y, label: 'OPEN PLAY', sub: 'TURNOVER' });
  }
  /** Breakdown offence roll. Returns true when the ref has blown for a
   *  penalty (the ruck is over, the entitled side is the one awarded it). */
  private rollRuckPenalty(r: { attack: TeamId; def: TeamId; x: number; y: number }): boolean {
    const age = this.t - this.ruckStartT;
    if (age < RUCK_SETTLE + 0.5) return false;
    const atkDisc = this.teamLive(r.attack).nation.att.discipline / 100;
    const defDisc = this.teamLive(r.def).nation.att.discipline / 100;
    const atkP = clamp(0.07 * (1.25 - atkDisc) * (0.5 + age * 0.16), 0, 0.24); // seals off, not releasing
    const defP = clamp(0.065 * (1.25 - defDisc) * (0.5 + age * 0.16), 0, 0.22); // hands in, off feet
    const roll = this.rng.next();
    if (roll < atkP) {
      const x = r.x, y = r.y;
      this.ruck = null;
      this.teamLive(r.attack).st.rucksLost += 1;
      this.teamLive(r.def).st.rucksWon += 1;
      this.beginPenalty(r.def, 'NOT RELEASING', x, y, `PENALTY — ${this.teamLive(r.attack).short} not releasing, ${this.teamLive(r.def).short} ball`);
      return true;
    }
    if (roll < atkP + defP) {
      const x = r.x, y = r.y;
      this.ruck = null;
      this.teamLive(r.def).st.rucksLost += 1;
      this.teamLive(r.attack).st.rucksWon += 1;
      this.beginPenalty(r.attack, 'HANDS IN THE RUCK', x, y, `PENALTY — ${this.teamLive(r.def).short} hands in the ruck, ${this.teamLive(r.attack).short} ball`);
      return true;
    }
    return false;
  }

  private ruckStartT = 0;
  lastRuckSpeed: 'QUICK' | 'NORMAL' | 'SLOW' = 'NORMAL';

  /** nearest available scrum half or stand-in scrapper for a ruck. */
  private findNine(team: TeamId, x: number, y: number): number | null {
    const squad = this.teamLive(team).players;
    const nine = squad.find((p) => p.num === 9 && p.downUntil <= this.t && p.sinbinUntil <= this.t);
    if (nine) return nine.idx;
    // anyone loose within reach of the base
    const near = this.nearestN(team, x, y, 3).filter((idx) => {
      const p = this.player(idx);
      return p.downUntil <= this.t && p.sinbinUntil <= this.t && p.num >= 9;
    });
    return near[0] ?? null;
  }

  /** Men run into the ruck from their OWN side of the tackle line (law 15)
   *  and bind in two-side slots around the ball — they never converge on one
   *  point. First defender to bind is the jackal (defArriveT stamps his
   *  arrival for the contest ledger). */
  private stepRuckArrivals(dt: number) {
    const r = this.ruck!;
    if (r.state === 'ARRIVING' || r.state === 'CONTEST') {
      const atkDir = this.dirOf(r.attack);            // +1 attacks +x
      const wantAttack = r.attackCommits.length < 3;
      const wantDef = r.defCommits.length < (r.defCommits.length === 0 ? 1 : 2);
      // arrival pace: early rucks fill fast, later rucks draw only men close
      const age = this.t - this.ruckStartT;
      if (wantAttack && this.rng.chance(dt * (age < 2.2 ? 5.5 : 2.6))) {
        const cand = this.teamLive(r.attack).players
          .filter((p) => p.downUntil <= this.t && p.sinbinUntil <= this.t
            && !r.attackCommits.includes(p.idx) && !r.defCommits.includes(p.idx)
            && (atkDir === 1 ? p.x < r.x + 0.6 : p.x > r.x - 0.6)   // own side
            && dist(p.x, p.y, r.x, r.y) < 7);
        if (cand.length) {
          const pick = cand.sort((a, b) =>
            dist(a.x, a.y, r.x, r.y) - dist(b.x, b.y, r.x, r.y))[0];
          r.attackCommits.push(pick.idx);
          pick.state = 'idle'; pick.vx = 0; pick.vy = 0;
          pick.downUntil = Math.max(pick.downUntil, this.t + 0.7);
        }
      }
      if (wantDef && this.rng.chance(dt * (age < 2.6 ? 5 : 2.2))) {
        const cand = this.teamLive(r.def).players
          .filter((p) => p.downUntil <= this.t && p.sinbinUntil <= this.t
            && !r.defCommits.includes(p.idx) && !r.attackCommits.includes(p.idx)
            && (atkDir === 1 ? p.x > r.x - 0.6 : p.x < r.x + 0.6)   // own side
            && dist(p.x, p.y, r.x, r.y) < 7);
        if (cand.length) {
          const pick = cand.sort((a, b) =>
            dist(a.x, a.y, r.x, r.y) - dist(b.x, b.y, r.x, r.y))[0];
          r.defCommits.push(pick.idx);
          pick.state = 'idle'; pick.vx = 0; pick.vy = 0;
          if (r.defCommits.length === 1) {
            r.jackalIdx = pick.idx;
            r.defArriveT = this.t;
            if (this.rarefy('jackal', 1.4)) {
              this.pushEvent({ kind: 'GENERIC', text: `jackal in — ${pick.name}`, team: r.def, t: this.t });
            }
          }
        }
      }
      // two-side binding: attackers pack just behind the ball on their side,
      // defenders on theirs; each new body takes a slot further out so the
      // mass reads as a ruck, not a point.
      for (let i = 0; i < r.attackCommits.length; i++) {
        const p = this.player(r.attackCommits[i]);
        const sx = r.x - atkDir * (0.7 + i * 0.55);
        const sy = r.y + ((i % 2 === 0 ? 1 : -1) * (0.45 + Math.floor(i / 2) * 0.8));
        p.x = lerp(p.x, sx, 0.4);
        p.y = lerp(p.y, sy, 0.4);
      }
      for (let i = 0; i < r.defCommits.length; i++) {
        const p = this.player(r.defCommits[i]);
        const sx = r.x + atkDir * (0.7 + i * 0.55);
        const sy = r.y + ((i % 2 === 0 ? 1 : -1) * (0.45 + Math.floor(i / 2) * 0.8));
        p.x = lerp(p.x, sx, 0.4);
        p.y = lerp(p.y, sy, 0.4);
      }
    }
    void dt;
  }

  /** Force every non-participant defender back behind the offside line. */
  private retreatOffside(what: 'RUCK' | 'MAUL' | 'SCRUM' | 'LINEOUT', dt: number) {
    const lineX = this.phase.x;
    for (const p of this.players) {
      const live = this.teamLive(p.team);
      const isAttacker = (what === 'RUCK' && this.ruck?.attack === p.team)
        || (what === 'MAUL' && this.maul?.attack === p.team)
        || (what === 'SCRUM' && this.scrum?.feed === p.team)
        || (what === 'LINEOUT' && this.lineout?.thrower === p.team);
      if (isAttacker) continue; // the ball side may move up to the line
      if (p.downUntil > this.t || p.sinbinUntil > this.t) continue;
      if (what === 'RUCK' && this.ruck && (this.ruck.attackCommits.includes(p.idx) || this.ruck.defCommits.includes(p.idx))) continue;
      if (what === 'MAUL' && this.maul && (this.maul.attackers.includes(p.idx) || this.maul.defenders.includes(p.idx))) continue;
      const d = this.dirOf(p.team);
      const ownSide = (d === 1 ? p.x <= lineX - 0.4 : p.x >= lineX + 0.4) || beyondGoal(d, p.x);
      if (!ownSide) {
        // jog back to onside
        const targetX = lineX - d * 2.2;
        const need = d === 1 ? targetX : targetX;
        p.x = lerp(p.x, need, dt * 5);
        p.state = 'jog';
      }
    }
    this.offsideShow = { x: lineX, team: this.opp(this.phase.ballTeam ?? 'A') };
  }

  /** Simple chase: the side that kicked runs at the landing point. */
  /** Kick chase: the kicking team presses the landing point as a UNIT while
   *  the receiving team's nearest backs camp under the ball. This is the
   *  structure that makes a kick a contest instead of a free regather —
   *  without it, kicks (and 22 drop-outs) bounce loose near the line and the
   *  kicker's side strolls in for a try. */
  private chaseLanding(dt: number) {
    const l = this.kickLanding;
    if (!l) return;
    const dir = l.by === 'A' ? this.dirOf('A') : this.dirOf('B');
    const byLive = this.teamLive(l.by);
    const recvLive = this.teamLive(this.opp(l.by));
    // receiving team's two nearest men are the fullback & winger under the
    // ball; they converge on the landing point hard (their own line is
    // behind them, so they arrive first by construction)
    const recv = recvLive.players
      .filter((p) => p.downUntil <= this.t && p.sinbinUntil <= this.t)
      .sort((a, b) => dist(a.x, a.y, l.x, l.y) - dist(b.x, b.y, l.x, l.y))
      .slice(0, 2);
    const recvCover = recvLive.players
      .filter((p) => p.downUntil <= this.t && p.sinbinUntil <= this.t && !recv.includes(p))
      .sort((a, b) => dist(a.x, a.y, l.x, l.y) - dist(b.x, b.y, l.x, l.y));
    // chasing side: nearest forwards+backs sprint to press; the kicker's
    // half is excluded (a 9/10 never chases his own long kick)
    const chase = byLive.players
      .filter((p) => p.downUntil <= this.t && p.sinbinUntil <= this.t
        && p.num !== 9 && p.num !== 10)
      .sort((a, b) => dist(a.x, a.y, l.x, l.y) - dist(b.x, b.y, l.x, l.y))
      .slice(0, 6);
    const chaseStrength = byLive.intent.chase;
    const pace = this.diff.reaction > 0.8 ? 8.8 : 7.8;
    for (const p of this.players) {
      if (p.downUntil > this.t || p.sinbinUntil > this.t) continue;
      const d = dist(p.x, p.y, l.x, l.y);
      if (recv.includes(p)) {
        // under the ball — full sprint to the landing point
        this.desire(p.idx, (l.x - p.x) / Math.max(0.1, d), (l.y - p.y) / Math.max(0.1, d),
          pace, true);
      } else if (chase.includes(p)) {
        // presser — straight to the ball (never through the kicker's spot)
        const inFront = dir === 1 ? p.x > l.x - 4 : p.x < l.x + 4;
        if (d < 30 && inFront) {
          this.desire(p.idx, (l.x - p.x) / Math.max(0.1, d), (l.y - p.y) / Math.max(0.1, d),
            pace * 0.96, this.rng.chance(chaseStrength * 0.7));
        }
      } else if (p.team !== l.by && recvCover.includes(p)) {
        // other receivers drop to cover the try line, staying goal-side
        const gx = this.toGoal(p.team, l.x) > this.toGoal(p.team, p.x) ? l.x : p.x;
        const coverD = Math.max(4, Math.min(14, d));
        this.desire(p.idx, (gx - p.x) / Math.max(0.1, Math.abs(gx - p.x)), 0, 5.2, false);
        void coverD;
      } else if (p.team === l.by) {
        // non-chasing kickers: hold a line behind the chase (offside shape)
        const backX = dir === 1 ? l.x - 6 : l.x + 6;
        this.desire(p.idx, (backX - p.x) / Math.max(0.1, Math.abs(backX - p.x)), 0, 4.8, false);
      }
    }
    void dt;
  }

  /* ------------------------------------------------------------- maul ---- */
  beginMaul(attack: TeamId, x: number, y: number, carrierIdx: number, binders: number[]) {
    this.seen.mauls += 1;
    const def = this.opp(attack);
    this.maul = {
      x, y, attack, def, attackers: [carrierIdx, ...binders], defenders: [],
      bound: 1 + binders.length, state: 'DRIVE', speed: 0.4, useItDeadline: this.t + 12,
    };
    this.pkind = 'MAUL';
    this.setPhase({ kind: 'MAUL', ballTeam: attack, x, y, label: 'MAUL', sub: 'DRIVING' });
    this.ball.state = 'held'; this.ball.ownerIdx = carrierIdx;
    this.ball.lastTouch = attack;
    this.teamLive(attack).st.mauls += 1;
    this.offsideShow = { x, team: def };
  }

  private stepMaul(dt: number) {
    const m = this.maul!;
    // bind defenders who arrive
    if (m.state === 'DRIVE') {
      const dir = this.dirOf(m.attack);
      const pushPower = this.maulPower(m.attack) - this.maulPower(m.def) * 0.86;
      const drive = MAUL_DRIVE * clamp(0.4 + pushPower * 0.06, 0, 1.4);
      m.speed = clamp(m.speed + (drive - m.speed) * 0.3 * dt * 6, -0.6, MAUL_DRIVE * 1.2);
      // move the whole maul
      const dx = dir * m.speed * dt;
      m.x = clamp(m.x + dx, 0, PITCH_L);
      for (const idx of [...m.attackers, ...m.defenders]) {
        const p = this.player(idx);
        p.x = m.x + (idx === m.attackers[0] ? 0.6 : -0.6) * 0;
        // riders sit inside the pod — approximate: give each a stable local slot
      }
      // defenders arriving
      if (m.defenders.length < 4 && this.rng.chance(dt * 1.2)) {
        const near = this.nearestN(m.def, m.x, m.y, 8)[0];
        if (near != null && !m.defenders.includes(near) && !m.attackers.includes(near)
          && dist(near >= 0 ? this.player(near).x : 0, 0, m.x, 0) < 12) {
          m.defenders.push(near);
          m.bound++;
        }
      }
      // contact at the line / try
      if ((dir === 1 && m.x >= PITCH_L) || (dir === -1 && m.x <= 0)) { this.scoreTry(m.attack, m.x, m.y, m.attackers[0]); return; }
      if (m.speed < MAUL_STOP_MIN && this.t - this.maulStopSince > 4) {
        // stopped maul: use it or lose it
        m.state = 'STOPPED';
        m.useItDeadline = this.t + USE_IT_CLOCK;
        this.setPhase({ kind: 'MAUL', ballTeam: m.attack, x: m.x, y: m.y, label: 'MAUL', sub: 'STOPPED — USE IT' });
      }
    } else if (m.state === 'STOPPED') {
      if (this.t > m.useItDeadline) {
        this.maul = null;
        this.beginScrumFor(m.def, m.x, m.y, 'MAUL STOPPED — USE IT', true);
        this.whistle('USE IT — TURNOVER SCRUM');
      }
    }
  }
  private maulStopSince = 0;
  private maulPower(team: TeamId): number {
    let sum = 0; let n = 0;
    const live = this.teamLive(team);
    for (const p of live.players) { sum += p.pwr * p.sta * 0.01; n++; }
    return sum / Math.max(1, n);
  }
  private nearestN(team: TeamId, x: number, y: number, n: number): number[] {
    const list = this.teamLive(team).players
      .filter((p) => p.sinbinUntil <= this.t && p.downUntil <= this.t)
      .map((p) => [p.idx, dist(p.x, p.y, x, y)] as [number, number])
      .sort((a, b) => a[1] - b[1]);
    return list.slice(0, n).map((e) => e[0]);
  }

  /* ------------------------------------------------------------ scrum ---- */
  private positionForScrum() {
    const s = this.scrum!;
    // A pack shoves -x face +x (toward the feed team's opposition goal)
    for (const p of this.players) {
      if (p.team === 'A' || p.team === 'B') {
        const inPack = p.num >= 1 && p.num <= 8;
        if (inPack) {
          const front = p.num <= 3;
          const row = p.num <= 3 ? 0 : p.num <= 5 ? 1 : 2;
          const off = p.num === 2 ? 0 : p.num % 2 === 0 ? 1.1 : -1.1;
          p.x = s.x + this.dirOf(p.team) * 0.9;
          p.y = s.y + off + row * 0.9 - (front ? 0 : 0);
          p.vx = 0; p.vy = 0; p.state = 'idle';
        } else {
          const dir = this.dirOf(p.team);
          p.x = s.x - dir * 6 - (p.num === 9 ? 4 : 3 + (p.num - 10) * 1.4) * dir;
          p.y = s.y + ((p.idx % 3) - 1) * 4;
          p.vx = 0; p.vy = 0; p.state = 'idle';
        }
      }
    }
  }
  private stepScrum(dt: number) {
    const s = this.scrum!;
    if (s.state === 'ASSEMBLE') {
      const el = this.t - s.t0;
      // real pack-down is slow (set piece theatre eats the clock); tick the
      // phase sub so the stall watchdog sees life while the packs settle
      if (el > SCRUM_SETUP * 0.33 && this.phase.sub !== 'CROUCH') {
        this.setPhase({ kind: 'SCRUM', ballTeam: s.feed, x: s.x, y: s.y, label: 'SCRUM', sub: 'CROUCH' });
      }
      if (el > SCRUM_SETUP * 0.55) { s.state = 'ENGAGED'; this.setPhase({ kind: 'SCRUM', ballTeam: s.feed, x: s.x, y: s.y, label: 'SCRUM', sub: 'ENGAGED' }); }
      return;
    }
    if (s.state === 'ENGAGED') {
      if (this.t - s.t0 > SCRUM_SETUP * 0.85) {
        s.state = 'PUSH';
        this.setPhase({ kind: 'SCRUM', ballTeam: s.feed, x: s.x, y: s.y, label: 'SCRUM', sub: 'FEED & PUSH' });
      }
      return;
    }
    if (s.state === 'PUSH') {
      const aPow = this.scrumPower(s.feed), bPow = this.scrumPower(s.def);
      const net = aPow - bPow; // >0 feed side gains
      const netN = clamp(net / 700, -1, 1); // normalised pack difference
      // a beaten scrum feeds the collapse gauge; one roll at the end decides
      s.collapse = clamp(s.collapse + dt * (0.012 + Math.max(0, -netN) * 0.05), 0, 0.95);
      // resolve after a beat of push
      if (this.t - s.t0 > SCRUM_SETUP * 0.85 + 1.0) {
        // collapse penalty: the side being driven back concedes (deliberately
        // rare — real sides lose scrums without the whistle)
        const penChance = s.collapse > 0.08 ? clamp((s.collapse - 0.08) * 0.8, 0, 0.5) : 0;
        if (this.rng.chance(penChance)) {
          const pen = net < 0 ? s.feed : s.def;
          this.scrum = null;
          this.whistle(`PENALTY — SCRUM COLLAPSE, ${this.teamLive(pen).short}`);
          this.pushEvent({ kind: 'PENALTY', text: `PENALTY — scrum collapse ${this.teamLive(pen).short}`, team: pen, t: this.t });
          this.teamLive(pen).st.scrumPens += 1;
          this.beginPenalty(this.opp(pen), 'COLLAPSE', s.x, s.y, `PENALTY — SCRUM COLLAPSE, ${this.teamLive(this.opp(pen)).short}`);
          return;
        }
        const winner = this.rng.chance(0.5 + clamp(net * 0.24, -0.42, 0.42)) ? s.feed : s.def;
        this.scrum = null;
        const wTeam = this.teamLive(winner);
        const lTeam = this.teamLive(this.opp(winner));
        wTeam.st.scrumsWon += 1;
        lTeam.st.scrumsLost += 1;
        wTeam.st.phases += 1;
        this.pushEvent({ kind: 'SCRUM', text: `scrum won ${wTeam.short}`, team: winner, t: this.t });
        // ball to the 9 of the winning side → OPEN
        const nine = this.teamLive(winner).players.find((p) => p.num === 9) ?? wTeam.players[0];
        this.giveBallTo(nine.idx);
        this.pkind = 'OPEN';
        this.setPhase({ kind: 'OPEN', ballTeam: winner, x: s.x, y: s.y, label: 'OPEN PLAY', sub: 'SCRUM WON' });
      }
    }
  }
  private scrumPower(team: TeamId): number {
    const live = this.teamLive(team);
    let sum = 0;
    for (const p of live.players) if (p.num <= 8) sum += p.pwr * p.sta;
    return sum;
  }

  /* ---------------------------------------------------------- lineout ---- */
  private positionForLineout() {
    const l = this.lineout!;
    for (const p of this.players) {
      const dir = this.dirOf(p.team);
      const forwards = p.num >= 1 && p.num <= 8;
      if (forwards) {
        // pods: jumper group near front/mid/back
        const pos = p.num <= 2 ? 0 : p.num <= 5 ? 1 : 2;
        p.x = l.x + (p.team === l.thrower ? 0.6 : -0.6);
        p.y = l.y + ((p.num % 3) - 1) * 1.6;
        p.vx = 0; p.vy = 0; p.state = 'idle';
      } else {
        p.x = l.x - dir * 12 - ((p.num - 9) * 2);
        p.y = l.y + ((p.idx % 3) - 1) * 6;
        p.vx = 0; p.vy = 0; p.state = 'idle';
      }
    }
  }
  private stepLineout(dt: number) {
    const l = this.lineout!;
    if (l.state === 'ASSEMBLE') {
      if (this.t - l.t0 > LINEOUT_SETUP * 0.5) {
        l.state = 'THROW';
        // pick jumper + contestant
        const mine = this.teamLive(l.thrower).players.filter((p) => p.num >= 4 && p.num <= 8);
        const theirs = this.teamLive(l.def).players.filter((p) => p.num >= 4 && p.num <= 8);
        const pick = (arr: DynPlayer[], bias: number) => arr.length ? arr[Math.floor(bias * arr.length) % arr.length] : null;
        const bias = l.call === 'FRONT' ? 0.2 : l.call === 'MID' ? 0.5 : 0.85;
        const j = pick(mine, bias); const c = pick(theirs, bias);
        l.jumper = j ? j.idx : null; l.contestant = c ? c.idx : null;
        this.setPhase({ kind: 'LINEOUT', ballTeam: l.thrower, x: l.x, y: l.y, label: 'LINEOUT', sub: 'THROW' });
      }
      return;
    }
    if (l.state === 'THROW') {
      if (this.t - l.t0 > LINEOUT_SETUP * 0.6) {
        l.state = 'AIR';
        this.lineoutThrowT = this.t;
        this.setPhase({ kind: 'LINEOUT', ballTeam: l.thrower, x: l.x, y: l.y, label: 'LINEOUT', sub: 'BALL IN THE AIR' });
        this.ball.state = 'flight';
        this.ball.x = l.x; this.ball.y = l.y; this.ball.h = 0.5;
        const dirToJumper = this.dirOf(l.thrower) * (l.jumper ? (this.player(l.jumper).y > l.y ? 0.25 : -0.25) : 0.1);
        this.ball.vx = dirToJumper * 1.2;
        this.ball.vy = l.jumper ? (this.player(l.jumper).y - l.y) * 2.2 : 0;
        this.ball.vz = 5.5;
      }
      return;
    }
    if (l.state === 'AIR') {
      // jumper wins the tap or the contestant steals
      const tAir = this.t - this.lineoutThrowT;
      const j = l.jumper, c = l.contestant;
      if (tAir > 0.65) {
        const jH = j != null ? this.player(j).skl * 0.01 + this.player(j).pwr * 0.004 : 0.4;
        const cH = c != null ? this.player(c).skl * 0.01 + this.player(c).pwr * 0.004 : 0.4;
        const stealChance = cH / (jH + cH) * 0.42; // defending side can steal ~
        const won = this.rng.chance(stealChance) ? l.def : l.thrower;
        l.wonBy = won;
        this.teamLive(won).st.lineoutsWon += 1;
        this.teamLive(this.opp(won)).st.lineoutsLost += 1;
        this.teamLive(won).st.phases += 1;
        const catcher = won === l.thrower ? j : c;
        if (catcher != null) {
          this.giveBallTo(catcher);
          this.players[catcher].catches += 1;
        }
        this.lineout = null;
        this.pkind = 'OPEN';
        this.setPhase({ kind: 'OPEN', ballTeam: won, x: l.x, y: l.y, label: 'OPEN PLAY', sub: 'LINEOUT WON' });
        this.pushEvent({ kind: 'LINEOUT', text: `lineout won ${this.teamLive(won).short}`, team: won, t: this.t });
      }
    }
  }

  /* --------------------------------------------------------- goalkick ---- */
  private beginGoalKick(at: 'PEN' | 'CON', team: TeamId, x: number, y: number, kickerIdx: number) {
    const px = clamp(x, 0, PITCH_L), py = clamp(y, 2, PITCH_W - 2);
    const dir = this.dirOf(team);
    // goal posts at the far end (x=0 or x=PITCH_L), centred y=MID_Y
    const gx = dir === 1 ? PITCH_L : 0;
    const distM = Math.hypot(gx - px, POST_Y - py);
    const angle = Math.atan2(Math.abs(POST_Y - py), Math.abs(gx - px));
    const kicker = this.player(kickerIdx);
    const skill = (kicker.kck / 100) * (this.weather === 'DRY' ? 1 : weatherKick(this.weather));
    const fatigue = kicker.stamina;
    const prob = clamp(skill * (1 - distM / 90) * (0.85 + Math.cos(angle) * 0.15) * (0.6 + 0.4 * fatigue) - 0.08, 0.02, 0.97);
    this.goal = { at, team, x: px, y: py, kicker: kickerIdx, dist: distM, angle, phase: 'TEE', t0: this.t, result: null, prob, flightT: 0 };
    this.pkind = 'GOALKICK';
    this.setPhase({ kind: 'GOALKICK', ballTeam: team, x: px, y: py, label: at === 'PEN' ? 'PENALTY GOAL' : 'CONVERSION', sub: 'TEE' });
  }
  private stepGoalKick(dt: number) {
    const g = this.goal!;
    if (g.phase === 'TEE') {
      // slow, real tee-up — but the phase label ticks so the stall watchdog
      // sees a live phase, not a frozen one
      const el = this.t - g.t0;
      const sub = el > GOAL_SETUP * 0.34 ? 'KICKER READY' : 'TEE';
      if (sub !== this.phase.sub) this.setPhase({ kind: 'GOALKICK', ballTeam: g.team, x: g.x, y: g.y, label: g.at === 'PEN' ? 'PENALTY GOAL' : 'CONVERSION', sub });
      if (el > GOAL_SETUP * 0.5) { g.phase = 'SWING'; this.setPhase({ kind: 'GOALKICK', ballTeam: g.team, x: g.x, y: g.y, label: g.at === 'PEN' ? 'PENALTY GOAL' : 'CONVERSION', sub: 'KICK' }); }
      return;
    }
    if (g.phase === 'SWING') {
      if (this.t - g.t0 > GOAL_SETUP * 0.8) {
        g.phase = 'FLIGHT';
        this.goalProbeT = this.t;
        const good = this.rng.chance(g.prob);
        g.result = good ? 'GOOD' : 'MISS';
        this.kickFlight = { x0: g.x, y0: g.y, x1: g.x, y1: g.y, t0: this.t, dur: 1.6, apex: 6 };
        this.pushEvent({ kind: g.at === 'PEN' ? 'PENALTY_GOAL' : 'CONVERSION', text: `${this.teamLive(g.team).short} goal attempt from ${g.dist.toFixed(0)}m`, team: g.team, t: this.t });
      }
      return;
    }
    if (g.phase === 'FLIGHT') {
      if (this.t - this.goalProbeT > 1.6) {
        g.phase = 'RESULT';
        const T = this.teamLive(g.team);
        if (g.result === 'GOOD') {
          const pts = g.at === 'PEN' ? POINTS.PENALTY : POINTS.CONVERSION;
          T.score += pts;
          if (g.at === 'PEN') T.pens += 1; else T.conv += 1;
          this.player(g.kicker).points += pts;
          this.banner(g.at === 'PEN' ? 'PENALTY GOOD' : 'CONVERSION GOOD', `${T.short} +${pts}`);
          this.pushEvent({ kind: g.at === 'PEN' ? 'PENALTY_GOAL' : 'CONVERSION', text: `${g.at === 'PEN' ? 'PENALTY' : 'CONVERSION'} GOOD — ${T.short}`, team: g.team, t: this.t, scoreA: this.a.score, scoreB: this.b.score });
        } else {
          this.pushEvent({ kind: 'PENALTY_MISS', text: `${g.at === 'PEN' ? 'PENALTY' : 'CONVERSION'} MISSED`, team: g.team, t: this.t });
          this.banner('NO GOOD', 'WIDE OF THE STICKS');
        }
        this.goal = null;
        // restart: drop-out or kickoff
        if (g.at === 'CON') {
          // restart from the 22 of the CONCEDING side after a successful kick;
          // after a miss: 22 drop out by the team that missed (or try line restart if try saved? keep: drop22)
          const defTeam = g.result === 'GOOD' ? this.opp(g.team) : g.team;
          this.beginRestart('DROP22', defTeam);
        } else {
          // penalty goal: non-kicking team restarts from centre
          const recv = this.opp(g.team);
          this.beginRestart('KICKOFF', recv);
        }
      }
    }
  }

  /* ----------------------------------------------------- give/launch ----- */
  giveBallTo(idx: number) {
    this.turnoverBallAt = null;   // ball is held; any reservation is moot
    this.carrierIdx = idx;
    this.lastCarrierIdx = idx;
    const p = this.player(idx);
    p.state = p.state === 'down' ? 'run' : p.state === 'sinbin' ? 'sinbin' : 'run';
    this.ball.state = 'held';
    this.ball.ownerIdx = idx;
    this.ball.x = p.x; this.ball.y = p.y; this.ball.h = 0.55;
    this.ball.lastTouch = p.team;
    this.ball.out = false;
  }

  /** Launch a kick in a team's attack direction. */
  launchKick(kickerIdx: number, x: number, y: number, dir: 1 | -1, distM: number, yTarget: number, apex: number, isBomb = false, kind: EventKind = 'KICK') {
    this.spreadPasses = 0;
    const k = this.player(kickerIdx);
    const targetX = x + dir * distM;
    const tx = clamp(targetX, 0, PITCH_L);
    const ty = clamp(yTarget, -4, PITCH_W + 4);
    const dur = 1.9 + distM * 0.02 + this.rng.range(-0.15, 0.15);
    this.ball.state = 'flight';
    this.ball.ownerIdx = -1;
    this.ball.x = x; this.ball.y = y; this.ball.h = 0.6;
    this.ball.vx = (tx - x) / dur;
    this.ball.vy = (ty - y) / dur;
    this.ball.vz = apex * 2 / dur * 0.55 + 2.2;
    this.ball.flightFrom = k.team;
    this.ball.lastTouch = k.team;
    k.kicks += 1;
    this.teamLive(k.team).st.kicks += 1;
    this.kickFlight = { x0: x, y0: y, x1: tx, y1: ty, t0: this.t, dur, apex };
    this.pushEvent({ kind, text: `${k.name} kicks ${distM.toFixed(0)}m`, team: k.team, t: this.t, x, y });
    this.kickLanding = { x: tx, y: ty, at: this.t + dur, by: k.team, contested: isBomb, kickedBy: k.idx, apex };
    this.pkind = 'KICKFLIGHT';
    this.setPhase({ kind: 'OPEN', ballTeam: null, x, y, label: 'KICK', sub: 'BALL IN FLIGHT' });
  }
  private kickLanding: { x: number; y: number; at: number; by: TeamId; contested: boolean; kickedBy: number; apex: number } | null = null;

  private stepKickFlight(dt: number) {
    // advance the ball along its ballistic path
    const b = this.ball;
    if (this.kickFlight) {
      const f = this.kickFlight;
      const tIn = this.t - f.t0;
      if (tIn >= f.dur) {
        this.kickFlight = null;
        // LAND
        this.landKick();
      } else {
        const u = tIn / f.dur;
        b.x = lerp(f.x0, f.x1, u);
        b.y = lerp(f.y0, f.y1, u);
        b.h = f.apex * 4 * u * (1 - u) + 0.05;
      }
    } else if (this.ball.state === 'flight' || this.ball.state === 'loose') {
      this.stepBallPhysics(dt);
      // rolling ball out
      if (this.ball.state === 'loose' && onField(this.ball.x, this.ball.y)) {
        // check chasers gather
      }
    }
  }

  private landKick() {
    const l = this.kickLanding;
    if (!l) return;
    // where did it land relative to the field?
    const zone = fieldZone(l.x, l.y);
    const bounceOrCatch = (catcher: number | null, kind: 'CATCH' | 'PICKUP') => {
      if (catcher != null) {
        this.giveBallTo(catcher);
        this.player(catcher).catches += 1;
      }
    };
    // who is at the landing point?
    const challengers = this.players
      .filter((p) => p.downUntil <= this.t && p.sinbinUntil <= this.t)
      .map((p) => ({ p, d: dist(p.x, p.y, l.x, l.y) }))
      .filter((o) => o.d < CATCH_RADIUS)
      .sort((a, b) => a.d - b.d);

    if (l.contested && challengers.length) {
      const chase = challengers.filter((o) => o.p.team === l.by);
      const recv = challengers.filter((o) => o.p.team !== l.by);
      const chaseWins = chase.length > 0 && (recv.length === 0 || chase[0].d < recv[0].d);
      const winner = chaseWins ? chase[0] : recv.length ? recv[0] : null;
      if (winner) {
        this.giveBallTo(winner.p.idx);
        if (!chaseWins) this.teamLive(winner.p.team).st.turnovers += 1;
        this.banner(chaseWins ? 'KICK CHASE REGAINS' : 'CLEAN CATCH', `${winner.p.name} gathers`);
        this.kickLanding = null;
        this.pkind = 'OPEN';
        this.setPhase({ kind: 'OPEN', ballTeam: winner.p.team, x: l.x, y: l.y, label: 'OPEN PLAY', sub: '' });
        return;
      }
    }
    if (zone === 'touch-l' || zone === 'touch-r') {
      // into touch
      const b = this.ball;
      const dir = l.by === 'A' ? this.dirOf('A') : this.dirOf('B');
      const kickedBy = this.player(l.kickedBy);
      const bounces = !l.contested && !(kickedBy.kck > 90) ? 0.5 : 0; // simplify: never straight out from open play unless grubberish
      const throwIn = l.by === 'A' ? 'B' : 'A'; // if not direct, lineout to the OTHER team? 
      this.whistle('INTO TOUCH');
      this.pushEvent({ kind: 'TOUCH', text: `ball into touch — lineout`, team: throwIn, t: this.t, x: l.x, y: l.y });
      this.beginLineoutFor(throwIn, l.x, clamp(l.y, 5, PITCH_W - 5), 'into touch');
      this.kickLanding = null;
      return;
    }
    if (zone === 'dead-a' || zone === 'dead-b') {
      // 22 drop out by the team who just conceded the kick
      const dropTeam = l.by === 'A' ? 'B' : 'A'; // the team whose end it went dead
      this.banner('DEAD BALL', '22 DROP OUT');
      this.pushEvent({ kind: 'RESTART_22', text: '22 drop-out', team: dropTeam, t: this.t });
      this.beginRestart('DROP22', dropTeam);
      this.kickLanding = null;
      return;
    }
    if (zone === 'in-goal-a' || zone === 'in-goal-b') {
      const b = this.ball;
      const defTeam = zone === 'in-goal-a' ? 'B' : 'A';
      if (challengers.length && challengers[0].p.team === defTeam) {
        this.giveBallTo(challengers[0].p.idx);
        // held up or touched down?
        const p = challengers[0].p;
        if (l.by !== defTeam) this.teamLive(defTeam).st.turnovers += 1;
        this.whittleDefence(defTeam);
        this.banner('TOUCH DOWN', `${defTeam === 'A' ? this.a.short : this.b.short} touch down`);
        this.pushEvent({ kind: 'RESTART_22', text: 'touch down — 22 drop-out', team: defTeam, t: this.t });
        this.beginRestart('DROP22', defTeam);
      } else {
        // attacking team scores
        const scorer = challengers.length ? challengers[0].p : this.player(l.kickedBy);
        this.scoreTry(l.by, l.x, l.y, scorer.idx);
      }
      this.kickLanding = null;
      return;
    }
    // landed in field of play: bounce then rolling ball
    this.ball.state = 'loose';
    this.ball.h = 0.05;
    const idx = this.player(l.kickedBy);
    const b = this.ball;
    const dir = this.dirOf(l.by);
    b.vx = dir * this.range(0.5, 2.2);
    b.vy = this.range(-2, 2);
    b.vz = 0;
    this.pkind = 'OPEN';
    this.setPhase({ kind: 'OPEN', ballTeam: null, x: b.x, y: b.y, label: 'LOOSE BALL', sub: '' });
    this.pushEvent({ kind: 'GENERIC', text: 'ball is loose after the kick', team: l.by, t: this.t });
    this.kickLanding = null;
    // first to it picks up
    if (challengers.length && challengers[0].d < PICKUP_RADIUS + 1) {
      this.giveBallTo(challengers[0].p.idx);
    }
  }

  private whittleDefence(t: TeamId) {
    // (no-op hook for momentum)
    void t;
  }

  /* ---------------------------------------------------- stepOpen core ---- */
  private stepOpen(dt: number) {
    const b = this.ball;
    // ball in hand
    if (b.state === 'held') {
      const c = this.carrier();
      if (!c) { this.bugFixLoose(); return; }
      // step carrier manually (brain steers; human can override)
      if (c.state === 'down') { this.bugFixLoose(); return; }
      // possession & territory accumulate while a man carries
      const T = this.teamLive(c.team);
      T.st.possession += dt;
      if (this.toGoal(c.team, c.x) < PITCH_L / 2) T.st.territory += dt;
      const dir = this.dirOf(c.team);
      // carried over the goal line — judged BEFORE any contact in the same
      // frame: a defender cannot snatch the ball from a man who is already
      // over the line (and no ruck may ever form in-goal)
      if (beyondGoal(dir, c.x)) {
        this.scoreTry(c.team, clamp(c.x, 0, PITCH_L), c.y, c.idx);
        return;
      }
      // contact with a defender → tackle resolution handled here
      this.contactCheck(c, dt);
      // carried into touch
      if (c.y < 0.4 || c.y > PITCH_W - 0.4) {
        this.carriedIntoTouch(c);
        return;
      }
    } else if (b.state === 'flight') {
      this.stepBallPhysics(dt);
      if (this.t > (this.kickLanding?.at ?? Infinity)) {
        // should not happen — landKick called from stepKickFlight
      }
    } else if (b.state === 'loose') {
      this.stepBallPhysics(dt);
      // a loose ball that JUST came out of a turnover (rip / jackal steal) is
      // reserved for its new owner for a beat, so the loser cannot vacuum it
      // back off his own spilled ball. The winner takes it the instant he is
      // upright.
      const gifted = this.turnoverBallAt !== null && this.t - this.turnoverBallAt < 0.45;
      const winnerIdx = gifted ? this.turnoverBallOwner : -1;
      const near = this.players
        .filter((p) => p.downUntil <= this.t && p.sinbinUntil <= this.t)
        .map((p) => ({ p, d: dist(p.x, p.y, b.x, b.y) }))
        .filter((o) => o.d < PICKUP_RADIUS)
        .sort((a, b2) => a.d - b2.d);
      const pick = gifted
        ? near.find((o) => o.p.idx === winnerIdx) ?? null
        : near[0] ?? null;
      if (pick) { this.turnoverBallAt = null; this.giveBallTo(pick.p.idx); return; }
      // winner still not upright (or not close): everyone else must wait too
      if (gifted) return;
      // a loose ball that crosses a try line without a grounding is dead:
      // 22 drop-out by the side defending that end. Without this a ball can
      // roll past the dead-ball line forever and eat the rest of the clock.
      if (b.x < -0.2 || b.x > PITCH_L + 0.2) {
        const dropTeam = b.x < 0
          ? (this.dirOf('A') === 1 ? 'A' : 'B')   // defender of the x=0 end
          : (this.dirOf('A') === -1 ? 'A' : 'B'); // defender of the far end
        this.banner('DEAD BALL', '22 DROP OUT');
        this.pushEvent({ kind: 'RESTART_22', text: '22 drop-out — ball dead', team: dropTeam, t: this.t });
        this.beginRestart('DROP22', dropTeam);
        return;
      }
      // loose into touch
      if (b.y < 0 || b.y > PITCH_W) {
        const zone = fieldZone(b.x, b.y);
        const last = b.lastTouch;
        const other = last === 'A' ? 'B' : 'A';
        if (zone === 'touch-l' || zone === 'touch-r') {
          // if last touch by A going forward into touch at x, lineout A? Law: ball in touch from a player → lineout to opponent unless from a kick that went out on full (handled). Approx: lineout to other team when attacker knocks it dead... 
          const defTeam = other;
          this.beginLineoutFor(defTeam, clamp(b.x, 5, PITCH_L - 5), clamp(b.y, 5, PITCH_W - 5), 'ball carried into touch');
          return;
        }
      }
    }
  }

  private bugFixLoose() {
    // ball holder fell over or vanished — park the ball at his feet
    const idx = this.carrierIdx;
    if (idx >= 0) {
      const p = this.player(idx);
      this.ball.state = 'loose'; this.ball.x = p.x; this.ball.y = p.y; this.ball.h = 0.05;
      this.ball.vx = 0; this.ball.vy = 0; this.carrierIdx = -1;
    }
  }

  private lastTackleAt = -9;
  /** Deferred ball hand-overs (e.g. the ripper regathers after his beat on
   *  the turf). Processed in postStep so the give lands on an upright man. */
  private pendingGives: { at: number; idx: number }[] = [];
  /** Loose-ball ownership reservation for rip/jackal turnovers: for 0.45s
   *  after the ball comes loose only the new owner may regather it. */
  private turnoverBallAt: number | null = null;
  private turnoverBallOwner = -1;

  /** Tackle / contact resolution for a carrier. */
  private contactCheck(c: DynPlayer, dt: number) {
    // pace the contest: a carrier is not wrapped on every single frame
    if (this.t - this.lastTackleAt < 0.6) return;
    // The carrier's heading (fall back to his attack axis when drifting).
    const sp = Math.hypot(c.vx, c.vy);
    const hx = sp > 0.5 ? c.vx / sp : this.dirOf(c.team);
    const hy = sp > 0.5 ? c.vy / sp : 0;
    // find the closest upright defender inside the engagement zone, scored by
    // how squarely he is in the carrier's path (head-on defenders tackle best)
    let best: DynPlayer | null = null; let bestScore = Infinity;
    for (const p of this.teamLive(this.opp(c.team)).players) {
      if (p.downUntil > this.t || p.sinbinUntil > this.t) continue;
      if (p.state === 'down') continue;
      const d = dist(p.x, p.y, c.x, c.y);
      if (d > 2.8) continue;
      const tox = (p.x - c.x) / (d || 1), toy = (p.y - c.y) / (d || 1);
      const headOn = Math.max(0, hx * tox + hy * toy); // 1 = directly in front
      const s = d - headOn * 1.4;                      // reward the man in the way
      if (s < bestScore) { bestScore = s; best = p; }
    }
    if (!best) return;
    const def = best;
    const d = dist(def.x, def.y, c.x, c.y);
    const tox = (def.x - c.x) / (d || 1), toy = (def.y - c.y) / (d || 1);
    const headOn = Math.max(0, hx * tox + hy * toy);
    // goal-line defence stands its ground: inside the 22 the tackle rate
    // climbs so scoring still needs genuine width or a defensive error
    const nearLine = this.toGoal(c.team, c.x) < 22 ? 1.5 : 0;
    // attempts per second: a defender straight ahead of a running carrier
    // wraps him up fast; a flank chase is a slower contest
    const inGrasp = d < 0.9 ? 6 : 0;
    const rate = (1.0 + headOn * 2.6 + inGrasp + (def.state === 'sprint' || def.state === 'run' ? 0.7 : 0)) * (1 + nearLine);
    if (this.rng.chance(1 - Math.exp(-rate * dt))) {
      this.lastTackleAt = this.t;
      this.resolveTackle(c, def, false);
    }
  }

  /** Public entry for the brain: a defender commits to the current carrier. */
  tackleFrom(defIdx: number, dive = false) {
    const def = this.player(defIdx);
    if (!def || def.downUntil > this.t || def.sinbinUntil > this.t) return;
    const c = this.carrier();
    if (!c || c.team === def.team) return;
    if (this.t - this.lastTackleAt < (dive ? 0.4 : 0.85)) return;
    if (dist(def.x, def.y, c.x, c.y) < TACKLE_REACH + 1.2) {
      this.lastTackleAt = this.t;
      this.resolveTackle(c, def, dive);
    } else {
      // starts the tackle run
      const d = dist(def.x, def.y, c.x, c.y) || 1;
      this.desire(def.idx, (c.x - def.x) / d, (c.y - def.y) / d, topSpeed(def.spd, def.stamina) * 1.1, true);
    }
  }

  private resolveTackle(carrier: DynPlayer, tackler: DynPlayer, isHumanDive: boolean) {
    const dir = this.dirOf(carrier.team);
    // dominant tackle? beat the line?
    const pow = (carrier.pwr + carrier.spd * 0.5) / 2;
    const tkl = (tackler.ttl + tackler.pwr * 0.4) / 1.4;
    const missP = clamp(0.12 + (pow - tkl) * 0.004 + (this.diff.errorRate - 0.19) * 0.5 + (carrier.team === this.humanTeam ? -0.05 : 0), 0.03, 0.55);
    this.teamLive(tackler.team).st.tackles += 1;
    tackler.tackles += 1;
    if (this.rng.chance(missP)) {
      // missed tackle
      this.teamLive(tackler.team).st.tacklesMissed += 1;
      tackler.tacklesMissed += 1;
      carrier.metres += 1.2;
      // attacker breaks free — small dodge
      carrier.x += dir * 1.0;
      carrier.lineBreaks += 1;
      this.teamLive(carrier.team).st.lineBreaks += 1;
      this.pushEvent({ kind: 'MISS', text: `missed tackle — ${carrier.name} breaks`, team: carrier.team, t: this.t });
      if (this.rarefy('miss', 4)) this.banner('TACKLE MISSED', `${carrier.name} steps the defender`);
      return;
    }
    // ---- tackle MADE: the WRAP window contest (physics/contact) -----------
    // The carrier's momentum, the live numbers around the contact and the two
    // men's tech decide what happens AT the hit — one stored dice, exactly
    // like the ledger the visual lab plays back.
    const momentum = clamp(Math.hypot(carrier.vx, carrier.vy) / 9, 0.2, 1);
    const near = (team: TeamId, within: number) => this.teamLive(team).players.filter((p) =>
      p.idx !== carrier.idx && p.downUntil <= this.t && p.sinbinUntil <= this.t
      && dist(p.x, p.y, carrier.x, carrier.y) < within);
    const support = near(carrier.team, 6).length;
    const cover = near(tackler.team, 6).filter((p) => p.idx !== tackler.idx).length;
    const wrapU = this.rng.next();
    const wrap = resolveWrapDuel({
      carrier: { pwr: carrier.pwr, skl: carrier.skl, spd: carrier.spd, ttl: carrier.ttl },
      tackler: { pwr: tackler.pwr, skl: tackler.skl, spd: tackler.spd, ttl: tackler.ttl },
      support, cover, momentum, smother: isHumanDive,
    }, wrapU);
    const x = carrier.x, y = carrier.y;
    const carT = this.teamLive(carrier.team);
    const defT = this.teamLive(tackler.team);
    this.carries(carrier);

    // an offload out of the tackle: the wrap was beaten, the carrier stays on
    // his feet for one more beat and flings the ball to support before the
    // tackler drags him down. This is the OFFLOAD_WINDOW — no ruck forms.
    if (wrap.outcome === 'KEEP' && this.t - this.lastTackleAt >= 0) {
      const threw = this.tryOffloadInTackle(carrier, wrapU, momentum);
      if (threw) return;
    }

    this.spreadPasses = 0;              // a phase ends at the tackle
    carrier.downUntil = this.t + 2.4;
    carrier.state = 'down';
    tackler.state = 'down';
    tackler.downUntil = this.t + 1.5;
    this.carrierIdx = -1;

    if (this.rarefy('tackle', 2.2)) {
      this.pushEvent({ kind: 'TACKLE', text: `tackle by ${tackler.name}`, team: tackler.team, t: this.t, x, y });
      this.banner('TACKLE', `${tackler.name} brings down ${carrier.name}`);
    }

    // ---- the WRAP result decides what happens next ------------------------
    switch (wrap.outcome) {
      case 'RIP': {
        // ripped in the tackle — no breakdown, the tackler regathers and
        // play goes on. The rip is OWNED by the ripper: he pops up briefly
        // and the ball is handed straight back to him (no loose-ball race).
        this.ball.state = 'loose';
        this.ball.x = tackler.x; this.ball.y = tackler.y; this.ball.h = 0.05;
        this.ball.ownerIdx = -1;
        this.ball.lastTouch = tackler.team;
        tackler.downUntil = this.t + 0.6;
        tackler.state = 'down';
        defT.st.turnovers += 1;
        carT.st.turnoversConceded += 1;
        tackler.turnoversWon += 1;
        this.turnoverBallAt = this.t;
        this.turnoverBallOwner = tackler.idx;
        this.spreadPasses = 0;
        this.pendingGives.push({ at: this.t + 0.62, idx: tackler.idx });
        this.whistle('RIPPED IN THE TACKLE');
        this.pushEvent({ kind: 'TURNOVER', text: `RIPPED IN THE TACKLE — ${tackler.name} wins it`, team: tackler.team, t: this.t, x, y });
        this.banner('RIP!', `${tackler.name} strips the ball`);
        this.pkind = 'OPEN';
        this.setPhase({ kind: 'OPEN', ballTeam: tackler.team, x: tackler.x, y: tackler.y, label: 'OPEN PLAY', sub: 'RIPPED — TURNOVER' });
        return;
      }
      case 'KNOCK': {
        // knocked loose forward in the contact — knock-on, scrum to the defence
        this.seen.knockOns += 1;
        this.ball.state = 'loose';
        this.ball.x = x + dir * 1.6; this.ball.y = y; this.ball.h = 0.04;
        this.ball.vx = dir * 3.2; this.ball.vy = 0;
        this.ball.lastTouch = carrier.team;
        defT.st.turnovers += 1;
        carT.st.turnoversConceded += 1;
        this.pushEvent({ kind: 'KNOCK_ON', text: `knock-on in the tackle by ${carrier.name}`, team: carrier.team, t: this.t, x, y });
        this.banner('KNOCK ON', 'SCRUM — DEFENCE');
        this.beginScrumFor(tackler.team, x, y, 'knock-on in the tackle', false);
        return;
      }
      case 'HOLDUP': {
        // held up — no release, the ball is dead at the point: treated as a
        // badly presented ruck (defence has first rights on the scramble)
        tackler.downUntil = Math.min(tackler.downUntil, this.t + 1.5);
        this.ball.state = 'loose'; this.ball.x = x; this.ball.y = y; this.ball.h = 0.02;
        this.ball.lastTouch = carrier.team;
        const uC = this.rng.next();
        this.beginRuck(carrier.team, x, y, tackler.idx, carrier.idx, {
          presentation: 0.22, momentum, uContest: uC,
        });
        this.ruck!.contest = 0.95;   // defence favourite on the hold-up
        this.pushEvent({ kind: 'GENERIC', text: `held up — ${carrier.name} can't release`, team: tackler.team, t: this.t, x, y });
        return;
      }
      case 'KEEP':
      default: {
        // clean tackle, carrier clamps then presents as he goes down. How
        // cleanly he presents decides how attackable the ball is.
        const presentation = clamp(
          0.32 + carrier.skl * 0.004 + (isHumanDive ? -0.18 : 0.08)
          - momentum * 0.12 + this.rng.next() * 0.18, 0.15, 0.95);
        this.ball.state = 'loose'; this.ball.x = x; this.ball.y = y; this.ball.h = 0.02;
        this.ball.lastTouch = carrier.team;
        const uC = this.rng.next();
        this.beginRuck(carrier.team, x, y, tackler.idx, carrier.idx, {
          presentation, momentum, uContest: uC,
        });
        this.ruckStartT = this.t;
        return;
      }
    }
  }

  /** An offload out of the tackle — the carrier flings the ball to support
   *  in the wrap window instead of being brought to ground. Returns true
   *  when the pass went away (no ruck follows). */
  private tryOffloadInTackle(carrier: DynPlayer, wrapU: number, momentum: number): boolean {
    if (this.t - this.lastTackleAt > OFFLOAD_WINDOW + 0.05) return false;
    const friends = this.teamLive(carrier.team).players
      .filter((p) => p.idx !== carrier.idx && p.downUntil <= this.t && p.sinbinUntil <= this.t
        && dist(p.x, p.y, carrier.x, carrier.y) < 8)
      .sort((a, b) => dist(a.x, a.y, carrier.x, carrier.y) - dist(b.x, b.y, carrier.x, carrier.y));
    if (!friends.length) return false;
    // the wrap dice doubles as the offload dice — same stored u, same ledger.
    // Real offloads are a handful per match, so this must stay rare.
    const skill = clamp((carrier.skl - 40) / 60, 0, 1);
    const open = clamp(1 - momentum * 0.55, 0, 1);
    const chance = clamp(0.01 + wrapU * 0.045 + skill * 0.035 + friends.length * 0.012 * open, 0.004, 0.07);
    if (!this.rng.chance(chance)) return false;
    const target = friends[0];
    // pass() needs the carrier upright — he is (this runs before the down)
    const threw = this.pass(carrier.idx, target.idx, 'OFFLOAD');
    if (!threw) return false;
    // the tackler still drags the (now ball-less) carrier to the turf
    carrier.downUntil = this.t + 2.0;
    carrier.state = 'down';
    this.carrierIdx = -1;
    this.ruck = null;
    if (this.rarefy('offload', 2.0)) {
      this.pushEvent({ kind: 'OFFLOAD', text: `offload out of the tackle by ${carrier.name}`, team: carrier.team, t: this.t, x: carrier.x, y: carrier.y });
      this.banner('OFFLOAD', `${carrier.name} keeps the move alive`);
    }
    return true;
  }

  private carries(p: DynPlayer) {
    p.carries += 1;
    this.teamLive(p.team).st.carries += 1;
  }

  private carriedIntoTouch(c: DynPlayer) {
    this.seen.touchIn += 1;
    this.pushEvent({ kind: 'TOUCH', text: `${c.name} carried into touch`, team: c.team, t: this.t, x: c.x, y: c.y });
    // the lineout goes to the opposition of the last toucher, at the mark
    const def = this.opp(c.team);
    const X = clamp(c.x, 5, PITCH_L - 5);
    const Y = c.y < 0.4 ? 1 : PITCH_W - 1;
    this.carries(c);
    this.beginLineoutFor(def, X, Y, 'carried into touch');
  }

  /* ----------------------------------------------------- passing/kicks --- */
  /** Attempt a pass from carrier to target player. Returns true if executed. */
  pass(carrierIdx: number, targetIdx: number, kind: 'PASS' | 'OFFLOAD' | 'TIP' = 'PASS'): boolean {
    const c = this.player(carrierIdx), t = this.player(targetIdx);
    if (!c || !t || c === t) return false;
    if (c.state === 'down' || t.downUntil > this.t) return false;
    const dir = this.dirOf(c.team);
    // Law 11 check: compute pass velocity
    const dx = t.x - c.x, dy = t.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d > (kind === 'OFFLOAD' ? 6 : 28)) return false;
    const flight = d / PASS_SPEED;
    const fwd = isForward(c, dx, dy, dir);
    if (fwd && kind !== 'TIP') {
      this.seen.fwdPasses += 1;
      this.whistle('FORWARD PASS');
      this.pushEvent({ kind: 'FWD_PASS', text: 'FORWARD PASS — scrum', team: c.team, t: this.t });
      this.beginScrumFor(this.opp(c.team), c.x, c.y, 'forward pass', false);
      this.teamLive(c.team).st.turnoversConceded += 1;
      this.teamLive(this.opp(c.team)).st.turnovers += 1;
      return false;
    }
    // risk of knock-on scales with distance, skill, weather — a Test side
    // drops a handful of balls a match (~4% of passes), not one in ten
    const risk = kind === 'PASS' ? clamp(0.002 + d * 0.0005 + (1 - t.skl / 100) * 0.004, 0.002, 0.04) * (this.weather === 'DRY' ? 1 : weatherError(this.weather) * 0.6) : 0.02;
    // intercept risk by defenders near the lane
    const intercept = this.interceptRisk(c, t);
    if (this.rng.chance(risk + intercept)) {
      this.seen.knockOns += 1;
      this.pushEvent({ kind: 'KNOCK_ON', text: `knock-on by ${t.name}`, team: t.team, t: this.t });
      this.banner('KNOCK ON', 'SCRUM');
      this.teamLive(t.team).st.turnoversConceded += 1;
      this.teamLive(this.opp(t.team)).st.turnovers += 1;
      this.beginScrumFor(this.opp(t.team), t.x, t.y, 'knock on', false);
      return false;
    }
    // ball flight
    this.spreadPasses += 1;
    this.ball.state = 'flight';
    this.ball.ownerIdx = -1;
    this.ball.x = c.x; this.ball.y = c.y; this.ball.h = 0.7;
    this.ball.vx = dx / flight; this.ball.vy = dy / flight;
    this.ball.vz = 4.4;
    this.carrierIdx = -1;
    c.passes += 1;
    this.teamLive(c.team).st.passes += 1;
    this.kickFlight = { x0: c.x, y0: c.y, x1: t.x, y1: t.y, t0: this.t, dur: flight, apex: 1.4 };
    this.passTarget = { idx: targetIdx, at: this.t + flight, by: c.idx, kind };
    if (kind === 'OFFLOAD') { c.offloads += 1; this.teamLive(c.team).st.offloads += 1; this.pushEvent({ kind: 'OFFLOAD', text: `offload by ${c.name}`, team: c.team, t: this.t }); }
    this.pkind = 'PASSFLIGHT';
    this.setPhase({ kind: 'OPEN', ballTeam: c.team, x: c.x, y: c.y, label: 'PASS', sub: 'BALL IN FLIGHT' });
    return true;
  }
  private passTarget: { idx: number; at: number; by: number; kind: string } | null = null;

  private interceptRisk(c: DynPlayer, t: DynPlayer): number {
    // a defender squatting on the pass lane can pick it, but genuine
    // interceptions are rare events (a couple per match, not a scrum farm)
    const mx = (c.x + t.x) / 2, my = (c.y + t.y) / 2;
    for (const p of this.teamLive(this.opp(c.team)).players) {
      if (p.downUntil > this.t || p.sinbinUntil > this.t) continue;
      const d = dist(p.x, p.y, mx, my);
      if (d < 1.3) return 0.10;
    }
    return 0;
  }

  /** step pass flight — receiver gathers at the right time. */
  private stepPassFlight(dt: number) {
    const t = this.passTarget!;
    if (this.t >= t.at) {
      this.passTarget = null;
      this.kickFlight = null;
      const recv = this.player(t.idx);
      // gathering: success unless pressured knock-on handled at launch; mark catch
      this.giveBallTo(t.idx);
      recv.catches += 1;
      this.pkind = 'OPEN';
      this.setPhase({ kind: 'OPEN', ballTeam: recv.team, x: recv.x, y: recv.y, label: 'OPEN PLAY', sub: '' });
    } else {
      // glide receiver toward the ball point along the line (AI receiving run)
      const recv = this.player(t.idx);
      const u = (this.t - (this.kickFlight?.t0 ?? 0)) / Math.max(0.01, (this.kickFlight?.dur ?? 1));
      const bx = lerp(this.kickFlight?.x0 ?? recv.x, this.kickFlight?.x1 ?? recv.x, clamp(u, 0, 1));
      const by = lerp(this.kickFlight?.y0 ?? recv.y, this.kickFlight?.y1 ?? recv.y, clamp(u, 0, 1));
      recv.x = lerp(recv.x, bx, 0.35);
      recv.y = lerp(recv.y, by, 0.35);
      // and the ball follows the parabola
      this.ball.x = bx; this.ball.y = by;
      this.ball.h = Math.max(0.05, (this.kickFlight?.apex ?? 1) * 4 * u * (1 - u));
    }
  }

  /* ------------------------------------------------------ loose physics -- */
  private stepBallPhysics(dt: number) {
    const b = this.ball;
    if (b.state !== 'flight' && b.state !== 'loose') return;
    // simple vertical hop + horizontal roll
    if (b.h > 0.02) {
      b.vz -= BALL_GRAV * dt;
      b.h += b.vz * dt;
      if (b.h <= 0.02) {
        b.h = 0.02;
        if (b.state === 'flight') { b.vz = 0; }
        else { b.vz *= -BALL_BOUNCE; if (Math.abs(b.vz) < 1.2) b.vz = 0; }
        // rolling friction applies horizontally
        if (b.state === 'loose') { b.vx -= Math.sign(b.vx) * BALL_ROLL_FRICTION * dt; b.vy -= Math.sign(b.vy) * BALL_ROLL_FRICTION * dt; }
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
  }

  /* ------------------------------------------------------------ scoring -- */
  private scoreTry(team: TeamId, x: number, y: number, scorerIdx: number) {
    const scorer = this.player(scorerIdx);
    const T = this.teamLive(team);
    T.score += POINTS.TRY;
    T.tries += 1;
    scorer.tries += 1; scorer.points += POINTS.TRY;
    const col = y < 3 || y > PITCH_W - 3 ? ' IN THE CORNER' : '';
    this.pushEvent({ kind: 'TRY', text: `TRY! ${scorer.name}${col}`, team, t: this.t, scoreA: this.a.score, scoreB: this.b.score, x, y });
    this.banner('TRY!', `${T.short} ${T.score} — ${scorer.name}`);
    // stop the play; set conversion
    this.setPhase({ kind: 'STOPPED', ballTeam: team, x, y, label: 'TRY', sub: 'CONVERSION TO COME' });
    this.pkind = 'GOALPREP';
    this.carrierIdx = -1;
    this.ball.state = 'loose';
    this.goalPrep = { team, x, y, t0: this.t };
  }
  private goalPrep: { team: TeamId; x: number; y: number; t0: number } | null = null;
  private stepGoalPrep(dt: number) {
    const g = this.goalPrep!;
    // try celebration + conversion tee-up: a real try costs the clock a
    // minute before the kicker even walks in. The phase label ticks over so
    // the stall watchdog sees a live phase, not a frozen one.
    if (this.t - g.t0 > 14 && this.phase.sub !== 'TEE AT THE POSTS') {
      this.setPhase({ kind: 'STOPPED', ballTeam: g.team, x: g.x, y: g.y, label: 'TRY', sub: 'TEE AT THE POSTS' });
    }
    if (this.t - g.t0 > 32) {
      const kicker = this.findKicker(g.team);
      this.goalPrep = null;
      const convX = clamp(g.x, 2, PITCH_L - 2);
      this.beginGoalKick('CON', g.team, convX, g.y, kicker);
    }
  }

  /* ---------------------------------------------------------- referee ---- */

  /* ------------------------------------------------------------ moves ---- */
  /** Integrate player movement from desires; apply terrain & stamina clamp. */
  private movePlayers(dt: number) {
    const dirA = this.dirOf('A');
    for (const p of this.players) {
      if (p.downUntil > this.t) {
        if (p.state !== 'down') { p.state = 'down'; p.vx = 0; p.vy = 0; }
        continue;
      }
      if (p.sinbinUntil > this.t) { p.state = 'sinbin'; p.vx = 0; p.vy = 0; continue; }
      const want = this.desires.get(p.idx);
      if (want && p.state !== 'down') {
        const sprint = want.sprint && p.stamina > 0.12;
        const spd = sprint ? topSpeed(p.spd, p.stamina) * 1.22 : want.speed;
        if (sprint) p.stamina = Math.max(0, p.stamina - SPRINT_DRAIN * dt);
        // Error-driven steering: ease the velocity VECTOR toward the desired
        // velocity at ACCEL m/s². (A per-frame damping-plus-increment model
        // stalls at ~3 m/s — never reached running speed — so no chaser ever
        // closed and no carrier could threaten the line.)
        const tvx = want.vx * spd, tvy = want.vy * spd;
        const dv = ACCEL * dt * (sprint ? 1.9 : 1.0);
        const ex = tvx - p.vx, ey = tvy - p.vy;
        const e = Math.hypot(ex, ey);
        if (e <= dv) { p.vx = tvx; p.vy = tvy; }
        else { p.vx += (ex / e) * dv; p.vy += (ey / e) * dv; }
        const spdNow = Math.hypot(p.vx, p.vy);
        p.state = spdNow > 8 ? 'sprint' : spdNow > 5.4 ? 'run' : spdNow > 2.2 ? 'jog' : 'walk';
        if (p.team === this.humanTeam && p.isControlled) {
          if (p.stamina < 100 && !this.humanInput.sprint) p.stamina = Math.min(1, p.stamina + WALK_RECOVER * dt);
        } else {
          if (p.stamina < 1 && p.state === 'walk') p.stamina = Math.min(1, p.stamina + WALK_RECOVER * dt * 0.5);
        }
      } else {
        // no desire (or down): decelerate to rest
        const spdNow = Math.hypot(p.vx, p.vy);
        if (spdNow > 0.01) {
          const ns = Math.max(0, spdNow - 6 * dt);
          p.vx *= ns / spdNow; p.vy *= ns / spdNow;
        }
        p.state = Math.hypot(p.vx, p.vy) > 0.3 ? 'walk' : 'idle';
      }
      if (Math.abs(p.vx) > 0.3 || Math.abs(p.vy) > 0.3) p.face = Math.atan2(p.vy, p.vx);
      // integrate
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.01) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        // bounds: keep out of deep touch
        const inPlay = this.pkind === 'OPEN';
        if (inPlay) {
          p.x = clamp(p.x, -2, PITCH_L + 2);
          p.y = clamp(p.y, -2, PITCH_W + 2);
        } else {
          p.x = clamp(p.x, 0, PITCH_L); p.y = clamp(p.y, 0, PITCH_W);
        }
      }
      // metres for carriers
      if (p.idx === this.carrierIdx) {
        const gain = sp * dt;
        if (gain > 0.05 && this.dirOf(p.team) === 1 && p.vx > 0) { p.metres += gain; this.teamLive(p.team).st.metres += gain; }
        else if (gain > 0.05 && this.dirOf(p.team) === -1 && p.vx < 0) { p.metres += gain; this.teamLive(p.team).st.metres += gain; }
      }
    }
  }

  private updateStamina(dt: number) {
    for (const p of this.players) {
      if (p.state === 'sprint') p.stamina = Math.max(0, p.stamina - SPRINT_DRAIN * dt);
      else if (p.state === 'run') p.stamina = Math.max(0.05, p.stamina - 0.004 * dt);
      else if (p.state === 'walk' || p.state === 'idle') p.stamina = Math.min(1, p.stamina + WALK_RECOVER * dt * 0.4);
      if (p.downUntil > this.t) p.stamina = Math.max(0.02, p.stamina - 0.01 * dt);
    }
  }
  private updateSetStamina(dt: number) {
    for (const p of this.players) if (p.sinbinUntil <= this.t) p.stamina = Math.max(0.1, p.stamina - 0.003 * dt);
  }

  /** Brain sets a desire. */
  desire(idx: number, vx: number, vy: number, speed: number, sprint: boolean) {
    this.desires.set(idx, { vx, vy, speed, sprint });
  }
  desireOff(idx: number) { this.desires.set(idx, { vx: 0, vy: 0, speed: 0, sprint: false }); }
  /** Read a player's current desire (diagnostics / overlays). */
  desireOf(idx: number) { return this.desires.get(idx) ?? null; }

  /** Public queries for the brain. */
  inOpen() { return this.pkind === 'OPEN'; }
  ballCarrier(): DynPlayer | null { return this.carrier(); }
  carrierTeam(): TeamId | null { return this.carrierIdx >= 0 ? this.player(this.carrierIdx).team : null; }

  /* ---------------------------------------------------------- dispatch --- */
  private stepSettle(dt: number) {
    // the entitled side decides — the captain talks to the ref, the posts
    // get lined up; a real penalty decision costs the clock 15-30s
    if (this.t - this.settleAt > 20) {
      const pen = this.pendingPenalty;
      if (!pen) { this.pkind = 'OPEN'; return; }
      this.pendingPenalty = null;
      this.resolveSettle(pen.team, pen.x, pen.y);
    }
  }

  private resolveSettle(team: TeamId, x: number, y: number) {
    const T = this.teamLive(team);
    const dir = this.dirOf(team);
    const goalDist = this.toGoal(team, x);
    const arch = AI_ARCHETYPES[T.nation.archetype] ?? AI_ARCHETYPES['TEMPO WIDE'];
    // decision blend: nation archetype + live intent
    const kickBias = clamp(arch.kickBias + (T.intent.kicking - 0.5) * 0.6, 0, 1);
    const shotBias = clamp((T.intent.shotCalls - 0.5) * 2 + arch.fieldPositionWeight * (goalDist < 55 ? 0.7 : 0.1) - (goalDist < 20 ? 0.1 : 0), 0, 1);
    const kicker = this.findKicker(team);
    if (this.settleKind === 'PENALTY') {
      if (goalDist < 56 && this.rng.chance(shotBias * 0.85)) {
        this.beginGoalKick('PEN', team, x, y, kicker);
        return;
      }
      if (this.rng.chance(kickBias * 0.6) && goalDist < 90) {
        // kick to touch → lineout at landing (5m from line if inside 22… simplify)
        const landX = clamp(x + dir * this.range(18, Math.min(goalDist + 8, PITCH_L)), 0, PITCH_L);
        this.beginLineoutFor(team, landX, this.range(4, PITCH_W - 4), 'penalty to touch');
        return;
      }
      // tap and go
      this.giveBallTo(this.nearestN(team, x, y, 1)[0] ?? this.teamLive(team).players[0].idx);
      this.pkind = 'OPEN';
      this.setPhase({ kind: 'OPEN', ballTeam: team, x, y, label: 'OPEN PLAY', sub: 'TAP AND GO' });
      this.ball.x = x; this.ball.y = y;
      this.whistle('TAP AND GO');
      return;
    }
    if (this.settleKind === 'FREEKICK') {
      // quick tap always
      const idx = this.nearestN(team, x, y, 1)[0] ?? this.teamLive(team).players[0].idx;
      this.giveBallTo(idx);
      this.ball.x = x; this.ball.y = y;
      this.pkind = 'OPEN';
      this.setPhase({ kind: 'OPEN', ballTeam: team, x, y, label: 'OPEN PLAY', sub: 'QUICK TAP' });
      return;
    }
    if (this.settleKind === 'MARK') {
      this.pkind = 'OPEN';
      this.setPhase({ kind: 'OPEN', ballTeam: team, x, y, label: 'OPEN PLAY', sub: '' });
      return;
    }
  }

  /* -------------------------------------------------------- human --------- */
  get controlledPlayer(): DynPlayer | null {
    if (this.controlledIdx >= 0 && this.players[this.controlledIdx]) return this.players[this.controlledIdx];
    return null;
  }

  /* ------------------------------------------------------- snapshot ------- */
  snapshot(): MatchViewState {
    const carrier = this.carrier();
    return {
      t: this.t,
      half: this.half,
      clockLabel: clockLabel(this.t, this.halfLenMin * 60),
      minuteLabel: minuteLabel(this.t),
      halfLen: this.halfLenMin,
      weather: this.weather,
      phase: this.phase,
      ball: { ...this.ball },
      a: this.cloneTeam(this.a),
      b: this.cloneTeam(this.b),
      players: this.players.map((p) => ({ ...p })),
      carrier,
      feed: this.feed.slice(-8),
      events: this.events.slice(-40),
      whistle: this.whistleInfo,
      banner: this.bannerInfo,
      over: this.over,
      offsideLine: this.offsideShow,
      humanTeam: this.humanTeam,
      humanControls: this.humanTeam !== null && this.liveControl,
      goalKick: this.goal ? {
        at: this.goal.at, x: this.goal.x, y: this.goal.y, kickerIdx: this.goal.kicker,
        dist: this.goal.dist, angleDeg: (this.goal.angle * 180) / Math.PI, prob: this.goal.prob,
        phase: this.goal.phase, result: this.goal.result, flightT: this.t - this.goal.t0, t0: this.goal.t0,
      } : null,
      kickFlight: this.kickFlight,
      cards: [...this.cards],
      ratingMVP: this.statRating,
    };
  }
  private cloneTeam(t: TeamLive): TeamLive {
    return {
      ...t, nation: t.nation, kit: { ...t.kit },
      players: t.players.map((p) => ({ ...p })),
      st: { ...t.st },
      intent: { ...t.intent },
    };
  }
  computeRatings() {
    const rate = (team: TeamId): number => {
      const T = this.teamLive(team);
      let best = T.players[0];
      for (const p of T.players) {
        p.rating = clamp(
          p.tackles * 0.08 + p.carries * 0.04 + p.metres * 0.01 + p.tries * 2.2 + p.lineBreaks * 0.3
          + p.turnoversWon * 0.9 + p.offloads * 0.25 - p.tacklesMissed * 0.12 - p.pensConceded * 0.4, 0, 10);
        if (p.rating > best.rating) best = p;
      }
      return best.idx;
    };
    this.statRating = { a: rate('A'), b: rate('B') };
  }
}

/** The ball is forward when its horizontal travel relative to the field is upfield. */
function isForward(c: DynPlayer, dx: number, _dy: number, dir: 1 | -1): boolean {
  // dx is measured along the world +x; a team attacking +x passes forward when dx>2
  const along = dx * dir;
  // allow a small forward carry of the hands — the law's real test is release
  // velocity, approximated here by geometry + the carrier's own speed
  const own = Math.hypot(c.vx, c.vy) * 0.06;
  return along > 1.1 + own;
}
