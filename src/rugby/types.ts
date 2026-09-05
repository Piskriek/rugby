/**
 * WORLD CLASS RUGBY — new engine (2026 rewrite).
 *
 * A clean-room, optimised rugby-union simulation built on the design thesis:
 * true to the laws, easy to pick up. This module holds the shared types only;
 * no logic, no imports.
 */

export type Side = 'A' | 'B';

/** Match phase — one of these is always current. */
export type Phase =
  | 'KICKOFF'    // drop-kick restart from halfway
  | 'OPEN'       // live play, ball in hand or in flight
  | 'RUCK'       // contest for a ball on the ground after a tackle
  | 'MAUL'       // ball held up, bound players drive
  | 'SCRUM'      // 8 v 8 set piece
  | 'LINEOUT'    // set piece from touch
  | 'PLACE_KICK' // penalty goal / conversion from a tee
  | 'DROP_KICK'  // kickoff / 22 dropout / drop goal
  | 'TRY'        // celebration + pending conversion
  | 'DEAD'       // ball out of play / whistle — transition pending
  ;

export type Role =
  | 'PROP' | 'HOOKER' | 'LOCK' | 'FLANKER' | 'NO8'
  | 'SH' | 'FH' | 'CTR' | 'WING' | 'FB';

/** A player's physical / technical ratings, 0..99. */
export interface Attr {
  spd: number; // speed
  str: number; // strength
  skl: number; // handling / passing skill
  kik: number; // kicking
}

export interface Player {
  id: number;
  side: Side;
  num: number;      // shirt 1..15
  role: Role;
  name: string;
  x: number;        // metres, +x is the A team's attacking direction
  y: number;        // metres, across the pitch
  vx: number;
  vy: number;
  face: number;     // facing angle (radians)
  att: Attr;
  size: number;     // visual scale factor
  stamina: number;  // 0..100
  sprinting: boolean;
  burst: number;    // > 0 → temporary speed boost (line break / momentum)
  decide: number;   // decision cooldown — the AI only re-plans when this hits 0
  down: number;     // > 0 → on the floor, recovering (seconds)
  held: number;     // > 0 → held up in a tackle (seconds)
  bind: number;     // -1 free, else id of the set-piece/breakdown they are bound to
  slot: number;     // formation slot index during a set piece
  sinbin: number;   // seconds left in the bin
  ctrl: boolean;    // the human-controlled player
}

export interface Ball {
  x: number; y: number; z: number;   // z is height above the grass
  vx: number; vy: number; vz: number;
  owner: number | null;   // player id carrying the ball
  last: number | null;    // last player id to touch it
  spin: number;           // visual spin rate
  flight: number;         // > 0 → in the air from a kick (hang time)
  forwardTouch: boolean;  // last touch imparted forward motion (knock-on check)
  trail: Array<[number, number]>;
}

export interface Evt {
  t: number;
  text: string;
  side: Side | null;   // team the event favours (or null for neutral)
}

export interface Team {
  side: Side;
  id: string;
  name: string;
  short: string;
  color: string;    // primary kit
  color2: string;   // secondary kit
  score: number;
  players: Player[];
}

/** Per-frame input for the human side (held keys). */
export interface InputState {
  fwd: boolean; back: boolean; left: boolean; right: boolean;
  sprint: boolean;
  passL: boolean; passR: boolean;
  punt: boolean; grubber: boolean; drop: boolean;
  fend: boolean; step: boolean; tackle: boolean;
  context: boolean; switchP: boolean;
}

export const NO_INPUT: InputState = {
  fwd: false, back: false, left: false, right: false, sprint: false,
  passL: false, passR: false, punt: false, grubber: false, drop: false,
  fend: false, step: false, tackle: false, context: false, switchP: false,
};

export interface MatchOpts {
  home: string;      // nation id
  away: string;
  difficulty: number; // 0..9
  halfMinutes: number;
  human: Side | 'WATCH';
  seed: number;
}

/** Per-player AI decision, produced by the planner each frame. */
export interface Wish {
  tx: number; ty: number;       // steering target
  speed: number;                // 0..1 of max speed
  sprint: boolean;
  act: Act | null;
}

export type Act =
  | { kind: 'PASS'; target: number }            // pass to player id
  | { kind: 'PUNT' } | { kind: 'GRUBBER' } | { kind: 'DROP' }
  | { kind: 'TACKLE' }                          // dive at the carrier
  | { kind: 'SCOOP' }                           // pick up a loose ball
  ;
