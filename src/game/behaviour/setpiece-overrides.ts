/**
 * SET-PIECE LAW COMPLIANCE — GLOBAL BEHAVIOUR OVERRIDES.
 *
 * The dataset, the shapes and the role contracts all answer "where would a
 * player LIKE to stand?". At a place kick at goal and at a scrum the answer is
 * not a preference — it is the law, and it is the same for every shirt. These
 * overrides sit ABOVE every other source of positional truth: if one of them
 * answers, nothing else may write the mark that frame.
 *
 * They are pure geometry. Nothing here reads or mutates Live state; the caller
 * (Director.placeBound) applies the marks and owns the writes, exactly as the
 * T-02 ownership contract requires.
 *
 * ── LAW 8.20 / 8.22 — CONVERSIONS AND PENALTY KICKS AT GOAL ────────────────
 * The non-kicking team must retire to its own goal line and stay there,
 * motionless, until the kicker begins his run-up. The kicking team must be
 * behind the ball. Before this override the two teams milled about at their
 * open-play marks throughout the ritual, which is both illegal and — with
 * thirty men drifting behind a stationary kicker — the single most obviously
 * wrong thing on screen during a conversion.
 *
 * ── LAW 19 — SCRUM ────────────────────────────────────────────────────────
 * The two packs bind head-on down the engagement axis, in a 3-4-1 block. The
 * axis runs ALONG the pitch (world z), so team A faces +z and team B faces −z;
 * they must never present a shoulder to the touchline.
 */

import { FIELD } from '../../render/retro';

/* ======================= GOAL KICKS / CONVERSIONS ======================= */

/** The kick types that are a place kick at the posts and carry the ritual. */
export type GoalKickType = 'GOAL' | 'CONVERSION';

/** True when a kick state is a shot at goal (a penalty goal or a conversion). */
export function isGoalKickState(type: string): boolean {
  return type === 'GOAL' || type === 'CONVERSION';
}

export interface GoalKickMark {
  x: number;
  z: number;
  /** the man must be stationary on this mark until the ball is struck */
  frozen: boolean;
  job: string;
}

/** Metres the attacking team must stand behind the ball. Law: behind it. */
export const ATTACKER_BEHIND_KICKER_METRES = 2;

/** Lateral margin kept off each touchline when spreading the defending line. */
const TOUCH_MARGIN = 3;

/**
 * The lawful mark for one player during a kick at goal.
 *
 *  - DEFENDERS (the non-kicking team) are locked to their OWN try line —
 *    `targetZ` is the try line itself — and distributed evenly across the
 *    width of the pitch by their index in the retreating group. They do not
 *    move: `frozen` is true until the ball is kicked.
 *  - ATTACKERS (the kicking team, kicker excepted) are locked at least
 *    `ATTACKER_BEHIND_KICKER_METRES` behind the kicker's z, spread across the
 *    same width so they do not stack on him.
 *
 * @param index      0-based index of this man within his group
 * @param count      size of his group (never 0)
 * @param defending  true for the non-kicking side
 * @param kickDir    +1 if the kick travels toward +z, −1 toward −z
 * @param kickerZ    the kicker's z (the ball's z)
 */
export function goalKickMark(
  index: number, count: number, defending: boolean,
  kickDir: 1 | -1, kickerZ: number,
): GoalKickMark {
  const n = Math.max(1, count);
  /* even distribution across the pitch width: n men, n gaps, each in the
   * middle of his own lane, so the line is symmetric about the posts. */
  const span = (FIELD.maxX - TOUCH_MARGIN) - (FIELD.minX + TOUCH_MARGIN);
  const x = (FIELD.minX + TOUCH_MARGIN) + span * ((index + 0.5) / n);

  if (defending) {
    /* their own try line is the one the ball is travelling towards. */
    const tryLine = kickDir > 0 ? FIELD.tryZFar : FIELD.tryZ;
    return {
      x, z: tryLine, frozen: true,
      job: 'BEHIND YOUR OWN GOAL LINE — DO NOT MOVE UNTIL HE STRIKES IT',
    };
  }
  return {
    x,
    z: kickerZ - kickDir * ATTACKER_BEHIND_KICKER_METRES,
    frozen: true,
    job: 'STAY BEHIND THE KICKER UNTIL THE BALL IS STRUCK',
  };
}

/* ============================== SCRUM =============================== */

/**
 * The engagement heading of a pack, in radians, in the renderer's frame
 * (0 = facing +z pitch, π = facing −z). The engagement axis runs along the
 * pitch, never across it: A packs down facing +z, B facing −z, and the two
 * front rows meet head-on.
 */
export function scrumFacing(team: 'A' | 'B'): number {
  return team === 'A' ? 0 : Math.PI;
}

/** The engine-frame facing sign (`Live.face`) of a pack in a scrum. */
export function scrumFaceSign(team: 'A' | 'B'): 1 | -1 {
  return team === 'A' ? 1 : -1;
}

/**
 * THE 3-4-1 BLOCK. Row 1 is the front row (loosehead, hooker, tighthead),
 * row 2 the four-man second row (the two locks flanked by the two flankers),
 * row 3 the number eight alone at the base. Rows are stacked along z away
 * from the mark; men are spread along x within their row.
 *
 * Returned coordinates are absolute, given the scrum mark (ax, az).
 */
export const SCRUM_ROWS_341: number[][] = [
  [1, 2, 3],       // 3 — front row
  [6, 4, 5, 7],    // 4 — locks bound between the two flankers
  [8],             // 1 — the eight at the base
];

/** Lateral spacing between shoulders within a row, metres. */
const ROW_SPACING = 0.68;
/** Distance from the mark to the front row, and between successive rows. */
const ROW_ONE_DEPTH = 0.62;
const ROW_GAP = 0.66;

export interface ScrumBlockSlot {
  num: number; team: 'A' | 'B'; row: number; x: number; z: number;
  /** the locked engagement heading, radians (renderer frame) */
  facing: number;
}

/**
 * Every one of the sixteen forwards' locked coordinates for a scrum on the
 * mark (ax, az), in the 3-4-1 block, both packs facing down the engagement
 * axis. Pure — the caller places the men.
 */
export function scrumBlock(ax: number, az: number): ScrumBlockSlot[] {
  const out: ScrumBlockSlot[] = [];
  for (const team of ['A', 'B'] as const) {
    const back = team === 'A' ? -1 : 1;   // A packs from −z, B from +z
    SCRUM_ROWS_341.forEach((row, ri) => {
      row.forEach((num, ci) => {
        out.push({
          num, team, row: ri + 1,
          x: ax + (ci - (row.length - 1) / 2) * ROW_SPACING,
          z: az + back * (ROW_ONE_DEPTH + ri * ROW_GAP),
          facing: scrumFacing(team),
        });
      });
    });
  }
  return out;
}
