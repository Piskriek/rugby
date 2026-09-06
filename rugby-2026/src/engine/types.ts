/**
 * TYPES — shared entity shapes for the simulation and its view.
 * The view reads a plain `MatchViewState` snapshot; the engine never touches
 * the DOM, so it runs headless in CI at any speed.
 */
import type { Nation, SquadPlayer, KitPalette } from 'design/data';
import type { Weather } from './tuning';

export type TeamId = 'A' | 'B';
export type Opp<T extends TeamId> = T extends 'A' ? 'B' : 'A';

export interface TeamSpec {
  id: string;            // nation code from the corpus (ENG, NZL…)
  kitIdx: number;
  human: boolean;        // is this side under a human (coach / live control)?
}

export interface MatchSetup {
  a: TeamSpec;
  b: TeamSpec;
  difficulty: number;    // 0..9, DIFFICULTY_TABLE rungs
  halfMinutes: number;   // default 40
  weather: Weather;
  seed: number;
}

/* ------------------------------------------------------------- dynamic --- */
export type PlayerState =
  | 'idle'        // standing, off the ball
  | 'walk' | 'jog' | 'run' | 'sprint'
  | 'down'        // on the deck (tackled / rucked)
  | 'sinbin';     // yellow card, 10 min off

export interface DynPlayer {
  idx: number;           // 0..29 (0-14 team A, 15-29 team B)
  team: TeamId;
  num: number;           // shirt 1..22
  name: string;
  pos: string;           // PROP …
  spd: number; pwr: number; skl: number; kck: number; sta: number; ttl: number;
  star: number;
  // live
  x: number; y: number;
  vx: number; vy: number;
  face: number;          // radians, +x is the team-A attack axis
  state: PlayerState;
  stamina: number;       // 0..1
  sinbinUntil: number;   // sim seconds, 0 = on the field
  downUntil: number;     // sim seconds until he may rise
  // match stats
  tackles: number; tacklesMissed: number; carries: number; metres: number;
  passes: number; kicks: number; lineBreaks: number; turnoversWon: number;
  points: number; tries: number; catches: number; offloads: number;
  pensConceded: number; rating: number; // 0..10, computed at full time
  isControlled?: boolean; // human is steering this man
}

/* ---------------------------------------------------------------- ball --- */
export type BallState = 'held' | 'flight' | 'loose';

export interface Ball {
  state: BallState;
  x: number; y: number; h: number;     // h = metres off the turf
  vx: number; vy: number; vz: number;  // vz = vertical velocity (up = +)
  ownerIdx: number;                    // when held
  lastTouch: TeamId | null;
  flightFrom: TeamId | null;           // kicker side while in flight
  out: boolean;                        // dead / in touch / in goal dead
}

/* -------------------------------------------------------------- phases --- */
export type PhaseKind =
  | 'STOPPED'     // try scored / half / full: presentation beat before restart
  | 'RESTART'     // kickoff or 22 drop-out being taken
  | 'OPEN'        // the ball is in play and moving
  | 'RUCK' | 'MAUL'
  | 'SCRUM' | 'LINEOUT'
  | 'GOALKICK';   // penalty shot / conversion — tee placed, kick to come

export interface PhaseInfo {
  kind: PhaseKind;
  /** the team entitled to the ball (put-in / throw / at the base). */
  ballTeam: TeamId | null;
  x: number; y: number;
  label: string;      // broadcast line: "SCRUM — A PUT-IN · 32M TO THE LINE"
  sub: string;        // state text: "SETTLING…", "FEED", "USE IT"
  since?: number;     // sim second this phase began
}

/* -------------------------------------------------------------- events --- */
export type EventKind =
  | 'KICKOFF' | 'TRY' | 'CONVERSION' | 'PENALTY_GOAL' | 'DROP_GOAL' | 'PENALTY_MISS'
  | 'PENALTY' | 'FREE_KICK' | 'CARD' | 'TURNOVER' | 'TACKLE' | 'LINE_BREAK'
  | 'OFFLOAD' | 'SCRUM' | 'LINEOUT' | 'MAUL' | 'HALF' | 'FULL' | 'SUB' | 'KICK'
  | 'GRUBBER' | 'KNOCK_ON' | 'FWD_PASS' | 'TOUCH' | 'MARK' | 'RUCK' | 'MISS'
  | 'RESTART_22' | 'RESTART' | 'GENERIC';

export interface MatchEvent {
  kind: EventKind;
  t: number;            // sim seconds from kickoff
  text: string;         // human sentence for the feed
  team: TeamId | null;
  playerIdx?: number;
  x?: number; y?: number;
  scoreA?: number; scoreB?: number;
}

/* ----------------------------------------------------- narrative feed ---- */
export interface FeedLine { text: string; text2?: string; at: number; kind: EventKind }

/* -------------------------------------------------------------- teams ---- */
export interface TeamLive {
  nation: Nation;
  kit: KitPalette;
  short: string;
  score: number;
  tries: number; conv: number; pens: number; drops: number;
  players: DynPlayer[];         // 15 on the field
  // statistics (design-corpus box score)
  st: {
    possession: number;         // seconds with ball in hand
    territory: number;          // seconds in opponent's half
    tackles: number; tacklesMissed: number;
    turnovers: number; turnoversConceded: number;
    lineBreaks: number; carries: number; metres: number;
    passes: number; offloads: number; kicks: number;
    scrumsWon: number; scrumsLost: number; scrumPens: number;
    lineoutsWon: number; lineoutsLost: number;
    rucksWon: number; rucksLost: number;
    mauls: number;
    pensConceded: number; freeKicksConceded: number;
    yellow: number; red: number;
    phases: number;
  };
  /** live tactic intent — the coach's hand on the tiller (0..1). */
  intent: {
    width: number; aggression: number; tempo: number;
    kicking: number; offload: number; lineSpeed: number; ruckCommit: number;
    chase: number; setPiece: number; shotCalls: number;
  };
  attackingDir: 1 | -1;   // which way this team attacks this half
  rating: number;         // nation headline strength (attack+defence/2 …)
}

/* ------------------------------------------------------------- config ---- */
export interface EngineOptions {
  /** 0 = coach (pure sim), 1 = full live takeover of the ball carrier. */
  liveControl: boolean;
  speed: number;
}

/* ------------------------------------------------ snapshot for the view -- */
export interface MatchViewState {
  t: number;                    // sim seconds
  half: 1 | 2;
  clockLabel: string;
  halfLen: number;
  weather: Weather;
  phase: PhaseInfo;
  ball: Ball;
  a: TeamLive;
  b: TeamLive;
  players: DynPlayer[];         // flat 30, view-friendly
  carrier: DynPlayer | null;
  /** last carrier (human may take over when it changes). */
  feed: FeedLine[];
  events: MatchEvent[];
  whistle: { text: string; at: number } | null;
  banner: { text: string; at: number; sub?: string } | null;
  over: boolean;
  minuteLabel: string;
  /** offensive line of the defending side at the current ruck/maul/scrum —
   *  drawn for the viewer and used to *show* the law. */
  offsideLine: { x: number; team: TeamId } | null;
  humanTeam: TeamId | null;
  humanControls: boolean;       // live takeover engaged right now
  goalKick: {
    at: 'PEN' | 'CON';
    x: number; y: number; kickerIdx: number;
    dist: number; angleDeg: number; prob: number;
    phase: 'TEE' | 'SWING' | 'FLIGHT' | 'RESULT';
    result: 'GOOD' | 'MISS' | null;
    flightT: number;
    t0: number;
  } | null;
  kickFlight: {
    x0: number; y0: number; x1: number; y1: number;
    t0: number; dur: number; apex: number;
  } | null;
  /** yellow-card panel toasts */
  cards: { team: TeamId; playerIdx: number; at: number; kind: 'YELLOW' | 'RED'; text: string }[];
  ratingMVP: { a: number; b: number } | null; // player idx with top rating, full time
}

export type { KitPalette };
