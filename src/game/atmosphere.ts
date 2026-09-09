/**
 * T-ATMOSPHERE — the live atmosphere contract.
 *
 * The atmosphere layer used to live as a caption and a few hard-coded cues
 * scattered through the director. This module is the single source of truth
 * for the three presentation systems that make a match feel *broadcast*:
 *
 *   1. REFEREE WHISTLE TAXONOMY — which match decision gets which whistle.
 *      A whistle is the game's punctuation: the referee uses a SHORT blast
 *      for a routine stoppage, a LONG hard blast for the serious calls, and
 *      a STACCATO TREBLE for the unplayable/forward errors. `audio.ts`
 *      synthesises all four kinds; this table says WHEN each is used. The
 *      classification is pure so a headless probe can assert it without a
 *      Web Audio context in sight.
 *
 *   2. NAMED COMMENTARY — the four scripted beats the spec calls for (50:22,
 *      the Law 9.17 aerial challenge, the rolling maul, and the grounding of
 *      a try). Each is formatted with the real team/player names the engine
 *      supplies; the formatter guarantees a readable line with no leaked
 *      `undefined` even when a name is missing.
 *
 *   3. HUD MATCH CLOCKS — sin-bin countdown and effective team strength. A
 *      binned man runs a MM:SS clock and takes his side from fifteen to
 *      fourteen; the top scoreboard renders both from these helpers.
 *
 * This file must stay DOM-free and side-effect free so the headless
 * verification probe (`scripts/atmosphereprobe.ts`) can import it directly.
 */

/* ====================================================================
 * 1. THE WHISTLE
 * ==================================================================== */

/** Every sound the referee can make. All four are synthesised in audio.ts. */
export type WhistleId = 'SHORT' | 'LONG' | 'DOUBLE' | 'TREBLE';

/** A decision the referee makes that halts or punctuates play. */
export type RefereeCall =
  | 'OUT_OF_BOUNDS'      // ball dead in touch / kicked out on the full
  | 'MARK'               // a clean catch earns a mark
  | 'ADVANTAGE_OVER'     // advantage has been completed
  | 'FIFTY_TWENTY'       // 50:22 kick found touch — attacking throw-in
  | 'TRY_SCORED'         // grounding over the chalk
  | 'PENALTY'            // penalty awarded
  | 'YELLOW_CARD'        // foul play, ten minutes in the bin
  | 'KNOCK_ON'           // ball knocked forward off hands
  | 'FORWARD_PASS'       // pass thrown forward
  | 'SCRUM_UNPLAYABLE';  // unplayable breakdown / reset scrum

/**
 * The sound each referee decision carries. SHORT for the routine whistles
 * that simply stop play; LONG for the serious sanctions; TREBLE — the
 * staccato triple — for the forward/unplayable errors that read as
 * "hold on, something was wrong there."
 */
export const WHISTLE_TAXONOMY: Readonly<Record<RefereeCall, WhistleId>> = {
  OUT_OF_BOUNDS: 'SHORT',
  MARK: 'SHORT',
  ADVANTAGE_OVER: 'SHORT',
  FIFTY_TWENTY: 'SHORT',
  TRY_SCORED: 'LONG',
  PENALTY: 'LONG',
  YELLOW_CARD: 'LONG',
  KNOCK_ON: 'TREBLE',
  FORWARD_PASS: 'TREBLE',
  SCRUM_UNPLAYABLE: 'TREBLE',
};

/** Which whistle a referee decision uses. The probe asserts against this. */
export function whistleFor(call: RefereeCall): WhistleId {
  return WHISTLE_TAXONOMY[call];
}

/* ====================================================================
 * 2. NAMED COMMENTARY
 * ==================================================================== */

export type CommentaryEvent = 'FIFTY_TWENTY' | 'AERIAL' | 'MAUL' | 'TRY';

export interface CommentaryContext {
  /** Display name of the player in the spotlight, e.g. "R. Underwood". */
  player?: string;
  /** Full side name or the nation short code, e.g. "England". */
  team?: string;
}

/** Read a name, collapsing empties to a safe fallback — never `undefined`. */
function display(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

const PLAYER_FALLBACK = 'the ball-carrier';
const TEAM_FALLBACK = 'the side in possession';

/**
 * The four scripted commentary beats. Returns the finished broadcast line
 * (with the names the engine provided baked in) and a `clean` flag that is
 * false only if a required identity was missing and a fallback had to cover
 * — a probe can therefore assert both the wording AND that no real name was
 * ever dropped as `undefined`.
 */
export function commentaryLine(
  event: CommentaryEvent,
  ctx: CommentaryContext = {},
): { line: string; clean: boolean } {
  const player = display(ctx.player, PLAYER_FALLBACK);
  const team = display(ctx.team, TEAM_FALLBACK);
  const hasPlayer = typeof ctx.player === 'string' && ctx.player.trim().length > 0;
  const hasTeam = typeof ctx.team === 'string' && ctx.team.trim().length > 0;

  switch (event) {
    case 'FIFTY_TWENTY':
      // The 50:22 beat is about the SIDE that earns the attacking throw-in.
      return { line: `Sensational 50:22! Attacking throw-in awarded to ${team}.`, clean: hasTeam };
    case 'AERIAL':
      // Law 9.17 is about the OFFENDER (player) and his side.
      return { line: `Dangerous tackle in the air on ${player}! The referee reaches for the pocket.`, clean: hasPlayer && hasTeam };
    case 'MAUL':
      // The maul beat is about the SIDE doing the driving.
      return { line: `The maul is rumbling forward! ${team} have the drive on.`, clean: hasTeam };
    case 'TRY':
      // The grounding beat names the scorer (and his side colours it).
      return { line: `TRY! Grounded right over the chalk by ${player}!`, clean: hasPlayer };
  }
}

/* ====================================================================
 * 3. HUD MATCH CLOCKS — sin-bin countdown and team strength
 * ==================================================================== */

/** A yellow card keeps a man off for a full ten MATCH minutes. */
export const SIN_BIN_YELLOW_MATCH_S = 600;

/** Split a remaining-match-seconds value into minutes and whole seconds. */
export function sinBinParts(remainingMatchSeconds: number): { mm: number; ss: number } {
  const whole = Math.max(0, Math.ceil(remainingMatchSeconds));
  return { mm: Math.floor(whole / 60), ss: whole % 60 };
}

/** The real-time MM:SS countdown the top scoreboard shows for a binned man. */
export function sinBinClock(remainingMatchSeconds: number): string {
  const { mm, ss } = sinBinParts(remainingMatchSeconds);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** The effective-strength readout, e.g. `14 vs 15` with one man in the bin. */
export function strengthText(teamAOnField: number, teamBOnField: number): string {
  return `${teamAOnField} vs ${teamBOnField}`;
}

/* ====================================================================
 * 4. PHYSICAL COLLISION AUDIO — tackle weight and turf impact
 * ==================================================================== */

/** A prolate spheroid that touches turf slower than this is a roll, not a hit. */
export const TURF_BOUNCE_MIN_SPEED_MS = 2;

/**
 * Map a relative collision velocity (m/s) on to the low-pass cutoff that
 * colours a tackle: a heavier, faster hit is a duller, deeper thud.
 */
export function tackleCutoffHz(relativeSpeedMs: number): number {
  const s = clamp01((relativeSpeedMs - 3) / 12);
  return 260 + (1 - s) * 860 + s * 90; // high impact → low, closed filter
}

/** Volume curve for a turf impact — flat below 2 m/s, full above ~9 m/s. */
export function turfBounceVolume(impactSpeedMs: number): number {
  if (impactSpeedMs < TURF_BOUNCE_MIN_SPEED_MS) return 0;
  return clamp01((impactSpeedMs - TURF_BOUNCE_MIN_SPEED_MS) / 7);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
