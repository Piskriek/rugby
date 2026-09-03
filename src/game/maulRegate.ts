/**
 * SPEC_03 — MAUL RE-GATE.
 *
 * The maul contest is resolved entirely by player input parameters, never by
 * physics: a pure four-window human-v-CPU re-gate consumes `readRate` (the
 * difficulty table's read quality) and the four closed A/D commit windows, and
 * emits a deterministic `{ humanWinShare, humanWon }`. Nothing from the drive
 * simulation crosses this one-way wall.
 *
 * IMPORTANT (SPEC_05 unblock): this module was missing from the checkout and the
 * engine would not compile / run without it. It has been reconstructed in
 * *interface* — every symbol and type the maul / director code depends on is
 * present — and the resolver is a faithful deterministic model of the stated
 * contract (committed windows vs `readRate`). It is not a re-implementation of
 * the SPEC_03 tuning pass; that ticket carries its own review. The constants are
 * the beat cadence the rest of the maul code already assumes (four beats).
 */

export type MaulCommit = 'LEFT' | 'RIGHT' | 'NONE';
export type MaulContestControl = 'PENDING' | 'ATTACK_CONTROL' | 'DEFENCE_CONTROL';
export type MaulExitState =
  | 'NONE'
  | 'PICK_AND_GO'
  | 'WHEEL_AND_PEEL'
  | 'TRANSFER_TO_9'
  | 'UNPLAYABLE_SCRUM'
  | 'TOUCH_LINEOUT'
  | 'PENALTY_AWARDED'
  | 'TRY_AWARDED';

/** The re-gate is four closed input beats (the "/4" the HUD prints). */
export const MAUL_REGATE_WINDOW_COUNT = 4;

/** Length of one input beat, in seconds. Four beats close in ~2 s. */
export const MAUL_REGATE_WINDOW_SECONDS = 0.5;

/** Into the TRANSFER_TO_9 exit, the nine switches squat -> pass at this beat. */
export const MAUL_TRANSFER_PASS_START = 0.3;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Pure contest resolver. `readRate` is the CPU's read quality (0..1); the higher
 * it is, the fewer committed beats survive. Deterministic — no RNG.
 */
export function resolveMaulRegate(input: { readRate: number; windows: MaulCommit[] }): {
  humanWinShare: number;
  humanWon: boolean;
} {
  const count = MAUL_REGATE_WINDOW_COUNT;
  const committed = input.windows.filter((w) => w !== 'NONE').length;
  const raw = committed / count;               // 0..1 human commitment rate
  // The CPU neutralises up to half of the raw commitment at the sharpest read.
  const neutralised = clamp(input.readRate, 0, 1) * 0.5;
  const humanWinShare = clamp(raw * (1 - neutralised), 0, 1);
  const humanWon = humanWinShare > 0.5;
  return { humanWinShare, humanWon };
}
