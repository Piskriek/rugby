/**
 * LAWS — pure geometric rule tests (Law 11 forward pass, touch, in-goal,
 * offside geometry). Engine-agnostic so they can be unit-checked headlessly.
 */
import { PITCH_L, PITCH_W, IN_GOAL, FWD_MARGIN, TRY_A_X, TRY_B_X } from './tuning';
import type { TeamId } from './types';

/** metres from a point to the goal the given team is attacking. */
export const toGoal = (dir: 1 | -1, x: number) => (dir === 1 ? TRY_B_X - x : x - TRY_A_X);

/** Which goal line is behind the given point for that team's defence. */
export const ownGoalX = (dir: 1 | -1) => (dir === 1 ? TRY_A_X : TRY_B_X);

/** true when the point is on the correct side of the goal line to score. */
export const beyondGoal = (dir: 1 | -1, x: number) => (dir === 1 ? x >= TRY_B_X : x <= TRY_A_X);

/**
 * Law 11 forward pass: a pass is forward when its release velocity carries it
 * upfield relative to the carrier's own momentum by more than FWD_MARGIN.
 * (Ball thrown backwards that continues forward on the thrower's momentum is
 * legal; a flat pass thrown while sprinting is legal — both fall out of the
 * same dot-product test.)
 */
export function isForwardPass(
  carrierVx: number, carrierVy: number,
  passVx: number, passVy: number,
  dir: 1 | -1,
): boolean {
  const fieldForward = dir; // +x or -x along the attacking axis
  // momentum component of the release along the attack axis
  const own = carrierVx * fieldForward;
  const rel = passVx * fieldForward - own;
  return rel > FWD_MARGIN;
}

/** Where a point sits relative to the field (used for touch / dead calls). */
export type FieldZone = 'in-goal-a' | 'in-goal-b' | 'pitch' | 'touch-l' | 'touch-r' | 'dead-a' | 'dead-b';

export function fieldZone(x: number, y: number): FieldZone {
  const inGoalA = x < TRY_A_X && x >= TRY_A_X - IN_GOAL;
  const inGoalB = x > TRY_B_X && x <= TRY_B_X + IN_GOAL;
  const touch = y < 0 || y > PITCH_W;
  if (x < TRY_A_X - IN_GOAL) return touch ? 'touch-l' : 'dead-a';
  if (x > TRY_B_X + IN_GOAL) return touch ? 'touch-r' : 'dead-b';
  if (touch) return 'touch-l'; // caller distinguishes side by y sign
  if (inGoalA) return 'in-goal-a';
  if (inGoalB) return 'in-goal-b';
  return 'pitch';
}

export const clampToPitch = (x: number, y: number): [number, number] => [
  Math.max(-IN_GOAL, Math.min(PITCH_L + IN_GOAL, x)),
  Math.max(-0.1, Math.min(PITCH_W + 0.1, y)),
];

export const onField = (x: number, y: number) =>
  x >= 0 && x <= PITCH_L && y >= 0 && y <= PITCH_W;

/** Lateral (y) mirror helper for team attacking -x. */
export const side = (dir: 1 | -1, y: number) => (dir === 1 ? y : PITCH_W - y);

/** The "blind"/"open" side y of a given ball point. */
export const openSideY = (y: number) => (y >= PITCH_W / 2 ? PITCH_W : 0);

export interface OffsideZone {
  kind: 'RUCK' | 'MAUL' | 'SCRUM' | 'LINEOUT';
  lineX: number;      // metres from the A goal line (x coordinate)
  lineY: number;
  /** attacking team (the side entitled to the ball). */
  attacking: TeamId;
}

/** A defender is offside if, while a tackle/ruck/maul/scrum/lineout exists,
 *  he is on the wrong side of the offside line and still ahead when the ball
 *  comes out. */
export const beyondOffsideLine = (defDir: 1 | -1, lineX: number, x: number) =>
  (defDir === 1 ? x > lineX + 0.35 : x < lineX - 0.35);
