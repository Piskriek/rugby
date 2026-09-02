/**
 * BEHAVIOUR DATASET — REGISTRY
 *
 * Single import point for the positional dataset and the run-line layer, plus
 * an honest completeness report. The engine must be able to ask "do I have a
 * specification for shirt 7 in a defensive lineout?" and get a truthful answer,
 * because the fallback behaviour is different from the authored behaviour and
 * the difference should never be silent.
 *
 * ── AUTHORING STATUS ─────────────────────────────────────────────────────────
 * Positional dataset : shirts delivered so far are registered below.
 * Run-line layer     : complete for all fifteen shirts.
 *
 * When a new `pos-NN.ts` arrives, add two lines: the import, and the entry in
 * POSITION_FILES. Nothing else needs to change — coverage, gaps and the media
 * guide all derive from that array.
 */

import { BehaviourPoint, SITUATIONS, SituationId, Coverage, coverageFor, beatsFor, pointFor, Beat } from './types';
import { RunLine, linesFor, LineSide } from './lines';

import pos01 from './pos-01';
import pos02 from './pos-02';
import pos03 from './pos-03';
import pos04 from './pos-04';
import pos05 from './pos-05';
import pos06 from './pos-06';
import pos07 from './pos-07';
import pos08 from './pos-08';
import pos09 from './pos-09';
import pos10 from './pos-10';
import pos11 from './pos-11';
import pos12 from './pos-12';
import pos13 from './pos-13';
import pos14 from './pos-14';
import pos15 from './pos-15';

import LINES_F1 from './lines-f1';
import LINES_F2 from './lines-f2';
import LINES_BACKS from './lines-backs';

/* ============================ POSITIONAL DATASET ============================ */

/** Every shirt whose hundred points have been authored and delivered. */
export const POSITION_FILES: Array<{ position: number; name: string; points: BehaviourPoint[] }> = [
  { position: 1, name: 'LOOSEHEAD PROP', points: pos01 },
  { position: 2, name: 'HOOKER', points: pos02 },
  { position: 3, name: 'TIGHTHEAD PROP', points: pos03 },
  { position: 4, name: 'LOCK (BLINDSIDE)', points: pos04 },
  { position: 5, name: 'LOCK (OPENSIDE)', points: pos05 },
  { position: 6, name: 'BLINDSIDE FLANKER', points: pos06 },
  { position: 7, name: 'OPENSIDE FLANKER', points: pos07 },
  { position: 8, name: 'NUMBER 8', points: pos08 },
  { position: 9, name: 'SCRUM-HALF', points: pos09 },
  { position: 10, name: 'FLY-HALF', points: pos10 },
  { position: 11, name: 'LEFT WING', points: pos11 },
  { position: 12, name: 'INSIDE CENTRE', points: pos12 },
  { position: 13, name: 'OUTSIDE CENTRE', points: pos13 },
  { position: 14, name: 'RIGHT WING', points: pos14 },
  { position: 15, name: 'FULL BACK', points: pos15 },
];

export const BEHAVIOUR_POINTS: BehaviourPoint[] = POSITION_FILES.flatMap((f) => f.points);

/** Shirt numbers with an authored dataset, in ascending order. */
export const AUTHORED_POSITIONS: number[] = POSITION_FILES.map((f) => f.position).sort((a, b) => a - b);

/** Shirt numbers still to be delivered. */
export const PENDING_POSITIONS: number[] = Array.from({ length: 15 }, (_, i) => i + 1)
  .filter((n) => !AUTHORED_POSITIONS.includes(n));

/* ============================ RUN-LINE LAYER ============================ */

export const RUN_LINES: RunLine[] = [...LINES_F1, ...LINES_F2, ...LINES_BACKS];

export const LINE_POSITIONS: number[] = Array.from(new Set(RUN_LINES.map((l) => l.position))).sort((a, b) => a - b);

/* ============================ LOOKUP ============================ */

/** The five beats for a shirt in a situation, in order. Empty if not authored. */
export function behaviourFor(position: number, situation: SituationId): BehaviourPoint[] {
  return beatsFor(BEHAVIOUR_POINTS, position, situation);
}

/** A single beat. Undefined when that shirt has not been authored yet. */
export function behaviourBeat(position: number, situation: SituationId, beat: Beat): BehaviourPoint | undefined {
  return pointFor(BEHAVIOUR_POINTS, position, situation, beat);
}

/** Every authored run line for a shirt on one side of the ball. */
export function runLinesFor(position: number, side: LineSide): RunLine[] {
  return linesFor(RUN_LINES, position, side);
}

/** A run line by its stable id, e.g. "L7-D1". */
export function runLineById(id: string): RunLine | undefined {
  return RUN_LINES.find((l) => l.id === id);
}

/**
 * True when the engine can steer this shirt from authored data in this
 * situation. When false the caller must fall back to the generic role contract
 * in `jlr.ts` — and should say so, not pretend.
 */
export function hasBehaviour(position: number, situation: SituationId): boolean {
  return behaviourFor(position, situation).length === 5;
}

/* ============================ COMPLETENESS ============================ */

export interface DatasetReport {
  authoredPositions: number[];
  pendingPositions: number[];
  totalPoints: number;
  expectedPoints: number;
  percentComplete: number;
  perPosition: Coverage[];
  situations: number;
  beatsPerSituation: number;
  /** run lines are complete across all fifteen shirts */
  runLines: number;
  runLinePositions: number[];
  runLineGaps: number[];
  problems: string[];
}

export function datasetReport(): DatasetReport {
  const perPosition = AUTHORED_POSITIONS.map((p) => coverageFor(BEHAVIOUR_POINTS, p));
  const expectedPoints = 15 * SITUATIONS.length * 5;
  const problems: string[] = [];

  for (const c of perPosition) {
    if (c.duplicates.length) {
      problems.push(`Shirt ${c.position} has duplicate points: ${c.duplicates.join(', ')}`);
    }
    if (c.missing.length) {
      const sample = c.missing.slice(0, 4).map((m) => `${m.situation}:${m.beat}`).join(', ');
      problems.push(`Shirt ${c.position} is missing ${c.missing.length} points (${sample}${c.missing.length > 4 ? ', …' : ''})`);
    }
  }

  const runLineGaps = Array.from({ length: 15 }, (_, i) => i + 1).filter((n) => !LINE_POSITIONS.includes(n));
  if (runLineGaps.length) problems.push(`Run lines missing for shirts: ${runLineGaps.join(', ')}`);

  // A shirt with run lines but no positional data can be steered along a line
  // but has nowhere to stand before it. Worth flagging explicitly.
  for (const p of LINE_POSITIONS) {
    if (!AUTHORED_POSITIONS.includes(p)) {
      problems.push(`Shirt ${p} has run lines but no positional dataset — it can run, but it has no start position.`);
    }
  }

  return {
    authoredPositions: AUTHORED_POSITIONS,
    pendingPositions: PENDING_POSITIONS,
    totalPoints: BEHAVIOUR_POINTS.length,
    expectedPoints,
    percentComplete: Math.round((BEHAVIOUR_POINTS.length / expectedPoints) * 1000) / 10,
    perPosition,
    situations: SITUATIONS.length,
    beatsPerSituation: 5,
    runLines: RUN_LINES.length,
    runLinePositions: LINE_POSITIONS,
    runLineGaps,
    problems,
  };
}

/** Total authored data points across both layers, counted honestly. */
export function behaviourPointCount(): { total: number; breakdown: Array<[string, number]> } {
  // A positional point carries: situation, beat, x, y, instruction, fallback.
  const positional = BEHAVIOUR_POINTS.length * 6;
  // A run line carries: name, family, reference, trigger, timing, speed,
  // purpose, ifOccupied, counter, plus two numbers per waypoint.
  const lines = RUN_LINES.reduce((n, l) => n + 9 + l.path.length * 2, 0);
  const breakdown: Array<[string, number]> = [
    ['POSITIONAL POINTS', BEHAVIOUR_POINTS.length],
    ['POSITIONAL FIELDS', positional],
    ['RUN LINES', RUN_LINES.length],
    ['RUN LINE FIELDS', lines],
  ];
  return { total: positional + lines, breakdown };
}

export * from './types';
export * from './lines';
