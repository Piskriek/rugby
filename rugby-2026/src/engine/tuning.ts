/**
 * TUNING — every playable number in the simulation, in one place.
 *
 * The design corpus gives qualitative truth ("line speed", "kick bias",
 * "10 rungs of difficulty"); this file is where those become metres per
 * second, seconds and probabilities. Verified by tools/simcheck.ts so that
 * realism gates (scorelines, phase counts, law breaches) hold across seeds.
 */

/* ------------------------------------------------------------ the pitch -- */
export const PITCH_L = 100;          // try line to try line, metres
export const PITCH_W = 70;           // touchline to touchline
export const IN_GOAL = 6;            // in-goal depth behind each try line
export const TRY_A_X = 0;            // team A's defended try line (x=0)
export const TRY_B_X = PITCH_L;      // team B's defended try line
export const HALFWAY_X = PITCH_L / 2;
export const MID_Y = PITCH_W / 2;
export const POST_Y = MID_Y;         // goal posts sit at the middle of each line
export const CROSSBAR_H = 3.0;

/** Legal tackle reach (m) — how close a defender must get before he commits. */
export const TACKLE_REACH = 1.35;
/** Attacking "carrying corridor" margin so runners bounce off the line of
 *  defence instead of through it without a collision. */
export const CARRIER_RADIUS = 0.85;

/* ------------------------------------------------------------ locomotion -- */
export const ACCEL = 5.5;            // m/s^2 to reach top speed
export const WALK_SPD = 1.6;
export const JOG_SPD = 3.4;
/** topSpeed(stats) map — SPD 100 ≈ 9.2 m/s for a flying winger. */
export const topSpeed = (spd: number, stamina: number) =>
  (5.2 + (spd / 100) * 4.0) * (0.72 + 0.28 * Math.max(0, Math.min(1, stamina)));
export const SPRINT_DRAIN = 0.014;   // per sprint second
export const WALK_RECOVER = 0.02;    // per second of walking
export const JOG_RECOVER = 0.004;

/* ---------------------------------------------------------------- ball --- */
export const PASS_SPEED = 15.5;      // m/s ground speed of a flat pass
export const PASS_HEIGHT = 2.6;      // apex of a flat pass (m)
export const LONG_PASS_SPEED = 18.0;
export const BALL_GRAV = 9.81;
export const BALL_BOUNCE = 0.58;     // restitution on the turf
export const BALL_ROLL_FRICTION = 1.1;
export const KNOCK_ON_PRESSURE = 0.10; // base drop chance for a pressured catch
export const CATCH_RADIUS = 1.15;    // how close a chaser must be to gather
export const PICKUP_RADIUS = 1.0;    // loose-ball pickup range

/* ---------------------------------------------------------- passing law -- */
/**
 * Law 11 — forward pass. The ball may travel forward relative to the field
 * only by momentum; a pass whose release velocity points upfield more than
 * 0.35 m/s beyond the carrier's own forward momentum is forward. (A pass
 * thrown backwards that momentum carries forward is legal.)
 */
export const FWD_MARGIN = 0.35;

/* ------------------------------------------------------------- tackling -- */
export const TACKLE_RATE = 2.0;      // tackle attempts per second at the carrier
export const OFFLOAD_WINDOW = 0.45;  // seconds after contact to fling an offload
export const MISSED_TACKLE_DODGE = 0.5; // m of free ground on a beaten tackler

/* --------------------------------------------------------------- ruck ---- */
// A real breakdown: the tackle lands, the jackal threat arrives, the ref
// lets the clear-out happen, THEN the nine gets a live ball. The whole beat
// runs 4-9s — these thresholds keep quick/normal/slow honest against it.
export const RUCK_MIN_ATTACKERS = 1; // one man in and the ball is contestable
export const RUCK_SETTLE = 4.5;      // s to legally arrive after tackle
export const QUICK_BALL = 7.5;       // s from tackle to ball out (quick)
export const SLOW_BALL = 11.0;       // slow recycled ball
export const USE_IT_CLOCK = 8.0;     // seconds of "use it" before turnover
export const JACKAL_SETTLE = 2.6;    // s a lone defender must survive to poach

/* ---------------------------------------------------------------- maul --- */
export const MAUL_MIN = 3;           // bound men (incl. carrier) to form a maul
export const MAUL_DRIVE = 1.6;       // m/s peak forward shove
export const MAUL_DRIVE_DECAY = 0.35;
export const MAUL_STOP_MIN = 1.1;    // m/s below which a maul is "stopped"

/* -------------------------------------------------------------- set piece */
// These are match-clock seconds of pack-down theatre, tuned so that an
// 80-minute match spends roughly half its clock in set pieces and stoppages
// (as a real Test does) — the simcheck realism gates depend on that split.
export const SCRUM_SETUP = 46;       // seconds of pack-down theatre
export const LINEOUT_SETUP = 34;
export const GOAL_SETUP = 50;        // kicker to the tee (real attempts are slow)
export const RESTART_SETUP = 18;

/* ---------------------------------------------------------------- kicks -- */
export const PUNT_DIST = 42;         // typical clearing punt (m)
export const BOX_DIST = 26;
export const GRUBBER_DIST = 18;
export const GOAL_MAX_KCK_DIST = 55; // beyond here even the best try rarely
export const KICK_WIND_FACTOR = 0.006;

/* ---------------------------------------------------------------- clock -- */
export const PLAY_MIN_PER_HALF = 40; // rugby union — 40 real minutes

/* ------------------------------------------------------------ difficulty */
export interface Difficulty {
  lvl: number;
  name: string;
  /** CPU think error: 0 = perfect. */
  errorRate: number;
  /** CPU reaction multiplier on tackles & chases. */
  reaction: number;
  /** How well the CPU reads the play (affects alignment/offside). */
  readRate: number;
  /** Stamina multiplier. */
  stamina: number;
}

export const difficultyOf = (lvl: number): Difficulty => {
  const d = [
    { lvl: 0, name: 'ROOKIE', reaction: 0.55, errorRate: 0.42, readRate: 0.30, stamina: 0.75 },
    { lvl: 1, name: 'CLUB', reaction: 0.66, errorRate: 0.32, readRate: 0.42, stamina: 0.82 },
    { lvl: 2, name: 'DISTRICT', reaction: 0.74, errorRate: 0.25, readRate: 0.52, stamina: 0.88 },
    { lvl: 3, name: 'COUNTY', reaction: 0.81, errorRate: 0.19, readRate: 0.62, stamina: 0.92 },
    { lvl: 4, name: 'TRIALIST', reaction: 0.87, errorRate: 0.14, readRate: 0.71, stamina: 0.95 },
    { lvl: 5, name: 'INTERNATIONAL', reaction: 0.92, errorRate: 0.10, readRate: 0.80, stamina: 0.98 },
    { lvl: 6, name: 'LEGEND', reaction: 0.95, errorRate: 0.07, readRate: 0.87, stamina: 1.00 },
    { lvl: 7, name: 'ELITE', reaction: 0.97, errorRate: 0.05, readRate: 0.91, stamina: 1.02 },
    { lvl: 8, name: 'SUPREME', reaction: 0.99, errorRate: 0.035, readRate: 0.95, stamina: 1.05 },
    { lvl: 9, name: 'MYTHIC', reaction: 1.00, errorRate: 0.02, readRate: 0.99, stamina: 1.10 },
  ][lvl];
  return { ...d };
};

/* ------------------------------------------------------------ weather ---- */
export type Weather = 'DRY' | 'RAIN' | 'WIND' | 'STORM';

export const WEATHER_ROLL = (r: number): Weather => {
  if (r < 0.55) return 'DRY';
  if (r < 0.78) return 'RAIN';
  if (r < 0.93) return 'WIND';
  return 'STORM';
};

export const WEATHER_LABEL: Record<Weather, string> = {
  DRY: 'DRY NIGHT', RAIN: 'RAIN', WIND: 'BLUSTERY', STORM: 'WIND & RAIN',
};

/** Weather shifts the kicking game and error rates. */
export const weatherError = (w: Weather) => w === 'DRY' ? 1 : w === 'RAIN' ? 1.35 : w === 'WIND' ? 1.5 : 1.9;
export const weatherKick = (w: Weather) => w === 'DRY' ? 1 : w === 'RAIN' ? 0.92 : w === 'WIND' ? 0.8 : 0.68;

/* ------------------------------------------------------------- position -- */
/** Number → 0..1 forward/back bias along the attacking axis. */
export const BACK_DEPTH: Record<number, number> = {
  1: 0.06, 2: 0.05, 3: 0.06, 4: 0.10, 5: 0.11, 6: 0.15, 7: 0.16, 8: 0.18,
  9: 0.05, 10: 0.30, 11: 0.62, 12: 0.45, 13: 0.55, 14: 0.60, 15: 0.85,
};
