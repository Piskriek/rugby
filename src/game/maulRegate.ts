/**
 * SPEC_03 / T-41 — the maul contest is deliberately a pure input contract.
 *
 * No Director, player, force, position, RNG, animation, or physics import is
 * permitted here. The live maul adapter supplies only the opposing CPU's
 * difficulty readRate and four closed human commit windows.
 */

export const MAUL_REGATE_WINDOW_COUNT = 4 as const;
export const MAUL_REGATE_WINDOW_SECONDS = 0.55;
export const MAUL_REGATE_BINDING_CREDIT = 0.55;
export const MAUL_REGATE_COMMIT_RANGE = 0.45;
export const MAUL_REGATE_WIN_THRESHOLD = 0.5;
/** Existing `nineSquat` idle beat before `ninePass`/`passSpin` on an exit. */
export const MAUL_TRANSFER_PASS_START = 0.18;

export type MaulCommit = 'NONE' | 'LEFT' | 'RIGHT';
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

/** The only runtime facts accepted by the contest resolver. */
export interface MaulRegateInput {
  readonly readRate: number;
  readonly windows: readonly MaulCommit[];
}

export interface MaulRegateResult {
  readonly validCommits: number;
  readonly humanCommitRate: number;
  readonly cpuReadRate: number;
  readonly humanWeight: number;
  readonly cpuWeight: number;
  readonly humanWinShare: number;
  readonly humanWon: boolean;
}

const clamp01 = (value: number) => value < 0 ? 0 : value > 1 ? 1 : value;

/** A non-finite difficulty datum is treated as the hardest legal read rate. */
export function normaliseMaulReadRate(readRate: number): number {
  return Number.isFinite(readRate) ? clamp01(readRate) : 1;
}

/**
 * A commit can only be the opposite of the previous valid A/D edge. `NONE`
 * never advances the direction, so an empty window cannot make the next press
 * invalid.
 */
export function isValidMaulCommit(previous: MaulCommit, candidate: MaulCommit): boolean {
  return candidate !== 'NONE' && candidate !== previous;
}

/** Count valid, alternating commits without mutating the supplied windows. */
export function countValidMaulCommits(windows: readonly MaulCommit[]): number {
  let previous: MaulCommit = 'NONE';
  let valid = 0;
  for (const candidate of windows) {
    if (!isValidMaulCommit(previous, candidate)) continue;
    previous = candidate;
    valid++;
  }
  return valid;
}

/**
 * Resolve the human-v-CPU maul contest from its complete, closed input record.
 * The equal-share threshold deliberately favours a fully committed human; no
 * hidden stat or random draw resolves a tie.
 */
export function resolveMaulRegate(input: MaulRegateInput): MaulRegateResult {
  if (input.windows.length !== MAUL_REGATE_WINDOW_COUNT) {
    throw new RangeError(`maul re-gate needs exactly ${MAUL_REGATE_WINDOW_COUNT} closed windows`);
  }
  const validCommits = countValidMaulCommits(input.windows);
  const humanCommitRate = validCommits / MAUL_REGATE_WINDOW_COUNT;
  const cpuReadRate = normaliseMaulReadRate(input.readRate);
  const humanWeight = MAUL_REGATE_BINDING_CREDIT + MAUL_REGATE_COMMIT_RANGE * humanCommitRate;
  const cpuWeight = MAUL_REGATE_BINDING_CREDIT + MAUL_REGATE_COMMIT_RANGE * cpuReadRate;
  const humanWinShare = humanWeight / (humanWeight + cpuWeight);
  return {
    validCommits,
    humanCommitRate,
    cpuReadRate,
    humanWeight,
    cpuWeight,
    humanWinShare,
    humanWon: humanWinShare >= MAUL_REGATE_WIN_THRESHOLD,
  };
}
