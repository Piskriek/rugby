/**
 * BEHAVIOUR DATASET — SHARED TYPES
 *
 * The positional dataset answers WHERE a player stands in a given situation,
 * beat by beat. The run-line layer (`lines.ts`) answers WHAT LINE he runs from
 * that position. Together they are the player-behaviour specification the
 * engine steers against.
 *
 * ── PITCH COORDINATE FRAME (dataset space) ───────────────────────────────────
 *   x : 0..100  along the pitch, 0 = OUR try line, 100 = THEIR try line.
 *               So x=50 is halfway, x=22 is our 22-metre line, x=78 is theirs.
 *   y : 0..100  across the pitch, 0 = LEFT touch, 100 = RIGHT touch.
 *               y=50 is the middle of the field.
 *
 * Both axes are percentages so the dataset is pitch-size agnostic. `expand()`
 * converts them to the engine's metre-based world frame:
 *
 *   world z = -50 + x          (metres; FIELD.tryZ -50 .. FIELD.tryZFar +50)
 *   world x = -35 + y * 0.70   (metres; FIELD.minX -35 .. FIELD.maxX +35)
 *
 * Note the axis names swap between the two frames. Dataset `x` runs along the
 * pitch; engine `x` runs across it. `expand()` is the only place that knows
 * this, so nothing downstream has to think about it.
 *
 * ── BEATS ────────────────────────────────────────────────────────────────────
 * Every situation is described in five beats. A beat is a decision point, not a
 * fixed duration:
 *   1  SET      where you stand before the ball moves
 *   2  READ     what you are watching for, and the first movement
 *   3  ACT      the primary action — the carry, tackle, lift, kick or clean
 *   4  FOLLOW   the immediate consequence — present, seal, chase, cover
 *   5  RELOAD   where you must be for the next phase
 *
 * ── FALLBACK ─────────────────────────────────────────────────────────────────
 * Every point carries a conflict rule. If a team-mate already owns the slot the
 * point describes, the fallback says what to do instead. This is what stops two
 * players occupying one job, which is the single most common failure in a
 * rugby-game AI.
 */

/** The twenty match situations every position is specified against. */
export type SituationId =
  | 'own-scrum-mid'
  | 'def-scrum-22'
  | 'own-lineout-att-5'
  | 'def-lineout-mid'
  | 'att-phase-mid'
  | 'def-line-mid'
  | 'kickoff-receive'
  | 'kickoff-chase'
  | 'exit-box-kick'
  | 'counter-deep'
  | 'red-zone-22'
  | 'goal-line-def'
  | 'att-maul'
  | 'turnover-att'
  | 'turnover-def'
  | 'tap-pen'
  | 'pen-goal'
  | 'drop-out-22'
  | 'wide-edge'
  | 'broken-field-def';

export const SITUATIONS: SituationId[] = [
  'own-scrum-mid', 'def-scrum-22', 'own-lineout-att-5', 'def-lineout-mid',
  'att-phase-mid', 'def-line-mid', 'kickoff-receive', 'kickoff-chase',
  'exit-box-kick', 'counter-deep', 'red-zone-22', 'goal-line-def',
  'att-maul', 'turnover-att', 'turnover-def', 'tap-pen',
  'pen-goal', 'drop-out-22', 'wide-edge', 'broken-field-def',
];

/** Human-readable labels and the phase each situation maps onto in the engine. */
export const SITUATION_META: Record<SituationId, {
  label: string;
  /** which Director phase this situation belongs to */
  phase: 'SCRUM' | 'LINEOUT' | 'OPEN_PLAY' | 'BREAKDOWN' | 'MAUL' | 'KICK';
  /** true when our side has the ball */
  attacking: boolean;
  blurb: string;
  /**
   * SPEC_11 — THE BALL ANCHOR (β) OF THE AUTHORED SITUATION.
   *
   * A situation's hundred points are a FORMATION drawn around wherever the
   * ball happened to be when the author drew it — the ruck at 55, the scrum
   * on our 22, the goal-line attack five metres out. The engine must therefore
   * subtract this anchor before it mirrors a point into the live frame, or it
   * will steer a man to an absolute patch of grass instead of to a place in
   * the shape around the ball (the formation-drift bug).
   *
   *   along  = σ · (x − β.x)          metres along the pitch (dataset units
   *                                   are metres here: 0..100 is the pitch)
   *   across = σ · (y − β.y) · 0.70   metres across the pitch
   *
   * Both are offsets from the live ball, not coordinates.
   *
   * HOW β WAS DERIVED (each value is corroborated by the authored
   * instructions of at least two shirts, not guessed):
   *   att-phase-mid   55  shirt 9 "stand at the back of the ruck, hands on
   *                       the ball"; the backs at 48 then read as the
   *                       authored "8-10m behind the ruck".
   *   def-line-mid    45  the fourteen line men at 44 ("feet on the gain
   *                       line", "one step from the ruck"); shirt 15 at 28
   *                       then reads as the authored "18-20m depth".
   *   red-zone-22     82  shirt 9 "at the base of the red-zone ruck".
   *   goal-line-def    5  the line at 3-4 ("feet on our own goal line") sits
   *                       1-2 m off a ball five metres out — inside the
   *                       situation's own trigger window (toLine < 8).
   *   turnover-def    62  "get onside instantly — get behind the ball line";
   *                       the scramble line at 60 is 2 m behind it.
   *   broken-field-def 50 the cover arc at 42 is the authored "point in
   *                       front of their carrier", ~8 m in front.
   *   β.y is the mid-point of the situation's authored across-pitch spread,
   *   which centres the formation on the ball.
   *
   * Authored-data conflict, recorded rather than silently resolved: in
   * `goal-line-def` shirt 15 is drawn at x=10 ("cover behind the line at
   * 10-12m") — six metres further from his own line than the ball, i.e. on
   * the wrong side of it. Every other shirt in that situation is drawn behind
   * the ball. β.x=5 is chosen for the fourteen; the sweeper is held by the
   * engine's defensive-line invariant instead. Authoring ticket raised.
   */
  ball: { x: number; y: number };
}> = {
  'own-scrum-mid': { label: 'OUR SCRUM, MIDFIELD', phase: 'SCRUM', attacking: true, blurb: 'Our put-in around halfway. The platform situation.', ball: { x: 50, y: 50 } },
  'def-scrum-22': { label: 'THEIR SCRUM, OUR 22', phase: 'SCRUM', attacking: false, blurb: 'Defending a scrum inside our own 22. Squeeze their exit.', ball: { x: 22, y: 50 } },
  'own-lineout-att-5': { label: 'OUR LINEOUT, THEIR 5M', phase: 'LINEOUT', attacking: true, blurb: 'Attacking lineout five metres from their line. Maul territory.', ball: { x: 95, y: 47 } },
  'def-lineout-mid': { label: 'THEIR LINEOUT, MIDFIELD', phase: 'LINEOUT', attacking: false, blurb: 'Defending a lineout around halfway.', ball: { x: 50, y: 73 } },
  'att-phase-mid': { label: 'OUR PHASE PLAY, MIDFIELD', phase: 'OPEN_PLAY', attacking: true, blurb: 'Structured phase attack between the 22s.', ball: { x: 55, y: 49 } },
  'def-line-mid': { label: 'DEFENDING PHASES, MIDFIELD', phase: 'OPEN_PLAY', attacking: false, blurb: 'Holding a connected line through their phases.', ball: { x: 45, y: 50 } },
  'kickoff-receive': { label: 'RECEIVING THE KICK-OFF', phase: 'KICK', attacking: false, blurb: 'Restart receipt and the exit that follows it.', ball: { x: 25, y: 51 } },
  'kickoff-chase': { label: 'CHASING THE KICK-OFF', phase: 'KICK', attacking: true, blurb: 'Restart chase in connected lanes.', ball: { x: 50, y: 47 } },
  'exit-box-kick': { label: 'EXITING BY BOX KICK', phase: 'OPEN_PLAY', attacking: true, blurb: 'Getting out of our 22 through the air.', ball: { x: 14, y: 48 } },
  'counter-deep': { label: 'COUNTER-ATTACK FROM DEEP', phase: 'OPEN_PLAY', attacking: true, blurb: 'Ball caught deep with an unstructured chase in front.', ball: { x: 8, y: 58 } },
  'red-zone-22': { label: 'ATTACKING THEIR 22', phase: 'OPEN_PLAY', attacking: true, blurb: 'Red-zone phases. Tempo is everything.', ball: { x: 82, y: 47 } },
  'goal-line-def': { label: 'DEFENDING OUR GOAL LINE', phase: 'OPEN_PLAY', attacking: false, blurb: 'Line held on our own paint. No line speed, no dog-legs.', ball: { x: 5, y: 49 } },
  'att-maul': { label: 'OUR DRIVING MAUL', phase: 'MAUL', attacking: true, blurb: 'Maul formed and driving towards the posts.', ball: { x: 92, y: 46 } },
  'turnover-att': { label: 'WE HAVE JUST WON THE BALL', phase: 'OPEN_PLAY', attacking: true, blurb: 'The two-second window before their defence re-sets.', ball: { x: 35, y: 50 } },
  'turnover-def': { label: 'WE HAVE JUST LOST THE BALL', phase: 'OPEN_PLAY', attacking: false, blurb: 'Scramble. Get onside, fill the nearest hole.', ball: { x: 62, y: 55 } },
  'tap-pen': { label: 'QUICK TAP PENALTY', phase: 'OPEN_PLAY', attacking: true, blurb: 'Attack before their ten-metre retreat completes.', ball: { x: 70, y: 44 } },
  'pen-goal': { label: 'SHOT AT GOAL', phase: 'KICK', attacking: true, blurb: 'Place kick, and the restart shape that follows.', ball: { x: 72, y: 48 } },
  'drop-out-22': { label: '22-METRE DROP OUT', phase: 'KICK', attacking: true, blurb: 'Restarting from our own 22.', ball: { x: 21, y: 47 } },
  'wide-edge': { label: 'ATTACKING THE WIDE EDGE', phase: 'OPEN_PLAY', attacking: true, blurb: 'Ball on the touchline, and the reload that follows.', ball: { x: 60, y: 72 } },
  'broken-field-def': { label: 'BROKEN-FIELD DEFENCE', phase: 'OPEN_PLAY', attacking: false, blurb: 'They are through. Shepherd, cut the angle, never chase heels.', ball: { x: 50, y: 62 } },
};

/** The five beats of every situation. */
export const BEATS = ['SET', 'READ', 'ACT', 'FOLLOW', 'RELOAD'] as const;
export type Beat = 1 | 2 | 3 | 4 | 5;

/**
 * The authored tuple. Deliberately positional and terse so a hundred of them
 * per position stays readable in source.
 */
export type PointTuple = [
  situation: SituationId,
  beat: number,
  /** 0..100 along the pitch, 0 = our try line */
  x: number,
  /** 0..100 across the pitch, 0 = left touch */
  y: number,
  instruction: string,
  fallback: string,
];

/** The expanded record the engine and the tooling consume. */
export interface BehaviourPoint {
  id: string;
  position: number;
  situation: SituationId;
  situationLabel: string;
  beat: Beat;
  beatName: (typeof BEATS)[number];
  /** dataset space, 0..100 */
  x: number;
  y: number;
  /** engine world space, metres */
  wx: number;
  wz: number;
  instruction: string;
  fallback: string;
  phase: string;
  attacking: boolean;
}

/* ---------------- coordinate conversion ---------------- */

/** Dataset x (0..100 along the pitch) to engine world z in metres. */
export const toWorldZ = (x: number): number => -50 + x;
/** Dataset y (0..100 across the pitch) to engine world x in metres. */
export const toWorldX = (y: number): number => -35 + y * 0.7;
/** Engine world z back to dataset x. */
export const fromWorldZ = (z: number): number => z + 50;
/** Engine world x back to dataset y. */
export const fromWorldY = (wx: number): number => (wx + 35) / 0.7;

/**
 * Mirror a point across the middle of the field. Every dataset entry is
 * authored with the openside on one hand; when play is going the other way the
 * whole set is reflected rather than re-authored.
 */
export const mirrorY = (y: number): number => 100 - y;

/* ---------------- expansion ---------------- */

/**
 * Turn the authored tuples for one shirt into full records. Validates as it
 * goes: a malformed dataset should fail loudly at import, not silently steer a
 * player into the crowd.
 */
export function expand(position: number, tuples: PointTuple[]): BehaviourPoint[] {
  if (position < 1 || position > 15) {
    throw new Error(`behaviour: position ${position} is not a shirt number`);
  }
  return tuples.map(([situation, beat, x, y, instruction, fallback], i) => {
    const meta = SITUATION_META[situation];
    if (!meta) throw new Error(`behaviour: shirt ${position} point ${i + 1} has unknown situation "${situation}"`);
    if (beat < 1 || beat > 5) throw new Error(`behaviour: shirt ${position} point ${i + 1} has beat ${beat}, expected 1-5`);
    if (x < 0 || x > 100) throw new Error(`behaviour: shirt ${position} point ${i + 1} has x=${x}, expected 0-100`);
    if (y < 0 || y > 100) throw new Error(`behaviour: shirt ${position} point ${i + 1} has y=${y}, expected 0-100`);
    return {
      id: `P${position}-${situation}-${beat}`,
      position,
      situation,
      situationLabel: meta.label,
      beat: beat as Beat,
      beatName: BEATS[beat - 1],
      x, y,
      wx: Math.round(toWorldX(y) * 100) / 100,
      wz: Math.round(toWorldZ(x) * 100) / 100,
      instruction,
      fallback,
      phase: meta.phase,
      attacking: meta.attacking,
    };
  });
}

/* ---------------- lookup helpers ---------------- */

/** Every point for one shirt in one situation, in beat order. */
export function beatsFor(points: BehaviourPoint[], position: number, situation: SituationId): BehaviourPoint[] {
  return points
    .filter((p) => p.position === position && p.situation === situation)
    .sort((a, b) => a.beat - b.beat);
}

/** The single point for a shirt, situation and beat. */
export function pointFor(
  points: BehaviourPoint[], position: number, situation: SituationId, beat: Beat,
): BehaviourPoint | undefined {
  return points.find((p) => p.position === position && p.situation === situation && p.beat === beat);
}

/**
 * Completeness report. Twenty situations by five beats is a hundred points per
 * shirt; anything less is an authoring gap and the engine should know about it
 * rather than quietly steering to a default.
 */
export interface Coverage {
  position: number;
  points: number;
  expected: number;
  complete: boolean;
  missing: Array<{ situation: SituationId; beat: number }>;
  duplicates: string[];
}

export function coverageFor(points: BehaviourPoint[], position: number): Coverage {
  const mine = points.filter((p) => p.position === position);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const p of mine) {
    const k = `${p.situation}:${p.beat}`;
    if (seen.has(k)) duplicates.push(k);
    seen.add(k);
  }
  const missing: Array<{ situation: SituationId; beat: number }> = [];
  for (const s of SITUATIONS) {
    for (let b = 1; b <= 5; b++) {
      if (!seen.has(`${s}:${b}`)) missing.push({ situation: s, beat: b });
    }
  }
  return {
    position,
    points: mine.length,
    expected: SITUATIONS.length * 5,
    complete: missing.length === 0 && duplicates.length === 0,
    missing,
    duplicates,
  };
}
