/**
 * T-13 / T-19 — THE BEHAVIOUR DATASET, WIRED INTO think().
 *
 * The dataset (1,500 authored points, 15 shirts × 20 situations × 5 beats)
 * is now the MOST SPECIFIC source of positional truth. The resolution order
 * in think() is explicit and one-way:
 *
 *   1. behaviour dataset   if hasBehaviour(shirt, situation)   ← here
 *   2. shapes.ts pod slot  if the shirt has a slot in the shape
 *   3. jlr.ts role contract                                     ← generic
 *
 * placeBound() is untouched — set-piece participants stay owned by it, so
 * the dataset only ever answers for players think() already owns, in open
 * play. A KICK stays owned by placeBound too (the encroachment lesson).
 *
 * situationOf maps the live match onto ONE of the twenty authored
 * situations; beatOf derives SET/READ/ACT/FOLLOW/RELOAD from the existing
 * phase clock (no new clock). Both are pure reads of the director state.
 */

import { Director } from '../director';
import { FIELD } from '../../render/retro';
import {
  behaviourBeat, hasBehaviour, BEHAVIOUR_POINTS, SITUATIONS, SITUATION_META,
  SituationId, Beat,
} from '../behaviour';

/** The dataset's situation for a team's view of the live match state, or
 *  null when think() must fall through to shapes/jlr (set pieces, kicks,
 *  breakdowns — all placeBound territory under the T-02 ownership contract).
 *  The situations are authored one-sidedly, so each side gets its own. */
export function situationOf(d: Director, team: 'A' | 'B'): SituationId | null {
  if (d.phase !== 'OPEN_PLAY' || !d.op) return null;

  const s = d.op;
  const attacking = team === s.attacking;
  const toLine = s.dir > 0 ? FIELD.tryZFar - s.carrierZ : s.carrierZ - FIELD.tryZ;
  const ownLine = 100 - toLine; // metres from OUR try line to the ball
  const justTurned = s.phase <= 1 && d.t - d.lastTurnoverAt < 3;

  if (attacking) {
    if (justTurned) return 'turnover-att';
    if (toLine < 22) return 'red-zone-22';
    if (Math.abs(s.carrierX) > 14) return 'wide-edge';
    if (ownLine < 22) return 'counter-deep';
    return 'att-phase-mid';
  }
  if (justTurned) return 'turnover-def';
  if (toLine < 8) return 'goal-line-def';
  if (s.lineBreak) return 'broken-field-def';
  return 'def-line-mid';
}

/** Which beat of the situation we are in, derived from the OPEN PLAY phase
 *  clock (s.t): SET before the play develops, READ on the first move, ACT
 *  at the collision, FOLLOW in the half-second after it, RELOAD when the
 *  next phase is being set. No new clock — the phase timer drives it. */
export function beatOf(d: Director): Beat {
  /* Beat is 1..5 (SET..RELOAD) in dataset space — see types.ts. */
  if (!d.op) return 1;
  const t = d.op.t;
  if (t < 0.55) return 1;
  if (t < 1.15) return 2;
  if (t < 1.9) return 3;
  if (t < 2.9) return 4;
  return 5;
}

/**
 * The dataset's world mark for a shirt in the live situation, mirrored to
 * the attacking end for team B. Falls back to the previous beat when the
 * authored run stops early (the last position is held, never invented).
 * `expand()` authors the world frame for team A (our try line −50); team B
 * is the point mirror through the middle of the park.
 *
 * SPEC_11: retained for tooling and the media guide. It answers "where was
 * this point authored?" — an absolute place. `datasetOffset()` below answers
 * the question the engine must ask: "where does this shirt stand RELATIVE TO
 * THE BALL?" Steering by this function is the formation-drift bug; the engine
 * now uses the offset form and re-anchors it on the live focus point.
 */
export function datasetMark(
  team: 'A' | 'B', num: number, situation: SituationId, beat: Beat,
): { x: number; z: number; job: string } | null {
  if (!hasBehaviour(num, situation)) return null;
  let pt = behaviourBeat(num, situation, beat);
  if (!pt) {
    // hold the last authored position rather than inventing one
    for (let i = (beat as number) - 1; i >= 1 && !pt; i--) {
      pt = behaviourBeat(num, situation, i as Beat);
    }
  }
  if (!pt) return null;
  const x = team === 'B' ? -pt.wx : pt.wx;
  const z = team === 'B' ? -pt.wz : pt.wz;
  return { x, z, job: pt.instruction.slice(0, 64).toUpperCase() };
}

/* ==================== SPEC_11 — THE BALL-RELATIVE MARK ====================
 *
 * The dataset draws a FORMATION around a ball that was in one fixed place
 * when the author drew it (`SITUATION_META[situation].ball` — β). The engine
 * wants the shape, not the patch of grass, so the mark is returned as an
 * offset from that anchor and the caller re-anchors it on the live focus
 * point:
 *
 *   target.z = F.z + σ · along
 *   target.x = F.x + σ · across        (σ = +1 for team A, −1 for team B)
 *
 * σ is the point mirror through the middle of the park: team A attacks +z,
 * team B attacks −z, and the authored frame is "0 is OUR try line". Both
 * offsets come back UNMIRRORED, in the authoring team's frame, so that the
 * caller can apply the mirror exactly once — together with the lateral
 * squeeze, which acts on the same sign.
 */

export interface DatasetOffset {
  /** metres along the pitch from the ball; + = toward the opposition line */
  along: number;
  /** metres across the pitch from the ball; + = dataset right */
  across: number;
  /** the authored instruction, as the job string */
  job: string;
}

/**
 * The dataset's mark for a shirt as an OFFSET FROM THE SITUATION'S BALL.
 * Pure: no live state, no players moved. Falls back to the previous beat
 * when the authored run stops early (the last position is held, never
 * invented).
 */
export function datasetOffset(
  num: number, situation: SituationId, beat: Beat,
): DatasetOffset | null {
  if (!hasBehaviour(num, situation)) return null;
  const beta = SITUATION_META[situation]?.ball;
  if (!beta) return null;
  let pt = behaviourBeat(num, situation, beat);
  if (!pt) {
    for (let i = (beat as number) - 1; i >= 1 && !pt; i--) {
      pt = behaviourBeat(num, situation, i as Beat);
    }
  }
  if (!pt) return null;
  return {
    along: pt.x - beta.x,                    // dataset units along are metres
    across: (pt.y - beta.y) * ACROSS_METRES, // 0..100 across → −35..+35 m
    job: pt.instruction.slice(0, 64).toUpperCase(),
  };
}

/** Dataset `y` (0..100 across the pitch) to metres. Matches `toWorldX`. */
const ACROSS_METRES = 0.70;

/**
 * The lateral extent of each situation's authored formation, in metres from
 * the ball anchor. SPEC_11/D11-a: when the ball is pinned against a
 * touchline there is not room for the full spread, so the formation is
 * squeezed by the factor this extent implies rather than spilling into
 * touch. Derived from the dataset, never hand-tuned.
 */
export const SITUATION_LATERAL: Record<SituationId, { min: number; max: number }> =
  SITUATIONS.reduce((acc, situation) => {
    let min = 0, max = 0;
    for (const p of BEHAVIOUR_POINTS) {
      if (p.situation !== situation) continue;
      const across = (p.y - SITUATION_META[situation].ball.y) * ACROSS_METRES;
      if (across < min) min = across;
      if (across > max) max = across;
    }
    acc[situation] = { min, max };
    return acc;
  }, {} as Record<SituationId, { min: number; max: number }>);
