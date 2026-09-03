/**
 * STATISTICAL REALISM AUDIT
 *
 * The behavioural audit checks that nothing illegal or impossible happens. This
 * one asks a harder question: does a full match produce the numbers a real
 * rugby match produces?
 *
 * If the shapes, the AI, the breakdown model and the kicking model are all
 * roughly right, the box score falls out correctly on its own. If it does not,
 * something on the field is wrong even when every individual rule passes.
 *
 * BENCHMARKS
 * Ranges below are drawn from professional men's Test and top-flight club rugby
 * (Six Nations / Rugby Championship / Premiership era averages). They are per
 * MATCH unless the label says per team. Where sources disagree the range is
 * widened rather than a false precision being invented.
 */

import { Director, MatchConfig, NO_INPUT, Input } from './director';

export interface Benchmark {
  key: string;
  label: string;
  /** realistic range for a full 80-minute match */
  lo: number;
  hi: number;
  /** what the number means and why it matters */
  note: string;
  perTeam: boolean;
}

export const BENCHMARKS: Benchmark[] = [
  { key: 'points', label: 'POINTS PER TEAM', lo: 12, hi: 34, perTeam: true, note: 'A Test match typically finishes somewhere around 25-20. Under 12 means nobody can score; over 34 means the defence does not work.' },
  { key: 'tries', label: 'TRIES PER TEAM', lo: 1, hi: 6, perTeam: true, note: 'Three a side is the modern average. Six-plus means the defensive line has holes; zero means attack cannot function.' },
  { key: 'tackles', label: 'TACKLES PER TEAM', lo: 90, hi: 220, perTeam: true, note: 'The single best indicator that contact is happening at a realistic rate.' },
  { key: 'rucks', label: 'RUCKS PER MATCH', lo: 120, hi: 200, perTeam: false, note: 'Around 150-170 is normal. Too few means play is not recycling; too many means nothing else ever happens.' },
  { key: 'scrums', label: 'SCRUMS PER MATCH', lo: 14, hi: 20, perTeam: false, note: 'Distinct awarded scrum occurrences, read from the set-piece event ledger rather than won/lost outcome fields.' },
  { key: 'lineouts', label: 'LINEOUTS PER MATCH', lo: 20, hi: 28, perTeam: false, note: 'Distinct awarded lineout occurrences, including a separately awarded rethrow, never a sum of outcome counters.' },
  { key: 'penalties', label: 'PENALTIES PER MATCH', lo: 14, hi: 28, perTeam: false, note: 'Around 18-22. Far too many was the old offside bug; far too few means the referee is asleep.' },
  { key: 'passes', label: 'PASSES PER MATCH', lo: 180, hi: 340, perTeam: false, note: 'Around 250. A read on whether the ball actually moves through hands.' },
  { key: 'kicks', label: 'KICKS FROM HAND', lo: 30, hi: 70, perTeam: false, note: 'Around 45-55. Under 30 means the kicking game does not exist; over 70 means nobody runs.' },
  { key: 'metres', label: 'METRES CARRIED PER TEAM', lo: 250, hi: 800, perTeam: true, note: 'Around 400-600. A direct read on whether carries actually gain ground.' },
  { key: 'lineBreaks', label: 'LINE BREAKS PER TEAM', lo: 2, hi: 16, perTeam: true, note: 'Around 8. Too many and the defensive line is not connected.' },
  { key: 'turnovers', label: 'TURNOVERS PER MATCH', lo: 10, hi: 32, perTeam: false, note: 'Around 18-22 including at the breakdown, in the tackle and from errors.' },
  { key: 'possession', label: 'POSSESSION SPLIT (% OF MAX)', lo: 40, hi: 60, perTeam: false, note: 'A balanced match sits near 50/50. A large skew means one side cannot get the ball back.' },
  { key: 'offloads', label: 'OFFLOADS PER MATCH', lo: 4, hi: 30, perTeam: false, note: 'Around 12. Highly style-dependent, so the range is deliberately wide.' },
];

/** Approved analyst thresholds for the one combined fifteenth green-board row. */
export const OFFSIDE_PENALTIES_PER_TEAM: Benchmark = {
  key: 'offsidePenalties', label: 'OFFSIDE PENALTIES PER TEAM', lo: 2, hi: 4, perTeam: true,
  note: 'A mean team count from deduplicated, sustained ruck and defensive-line-reset breaches.',
};
export const FORMATION_DRIFT_P90: Benchmark = {
  key: 'formationDriftP90', label: 'P90 TARGET-SLOT DRIFT (M)', lo: 0, hi: 4.0, perTeam: false,
  note: 'The audit mean of each fixture’s worst-team P90 actual actor-to-target-slot distance; it must not exceed 4.0 m. '
    + 'The ceiling was 2.5 m while the metric was an instantaneous velocity test, which forgave a man sprinting in the '
    + 'wrong direction. SPEC_11 recalibrated it as a PROGRESS test (is the gap actually closing?) and the author re-'
    + 'authorised the ceiling at 4.0 m rather than have the metric tuned back down to fit the old number.',
};
export const FORMATION_MARK_ANCHOR_P90: Benchmark = {
  key: 'formationMarkAnchorP90', label: 'P90 MARK-TO-BALL DISTANCE (M)', lo: 0, hi: 25, perTeam: false,
  note: 'SPEC_11: the audit mean of each fixture’s worst-team P90 distance from a target mark to the LIVE BALL. '
    + 'Drift only asks whether a man is reaching his mark; it cannot see a man who reaches a mark in the wrong place. '
    + 'This is the channel that can. Two wingers and a sweeper legitimately stand 25-30 m out, so the ceiling is the '
    + 'P90, not the maximum.',
};

export type Grade = 'REALISTIC' | 'LOW' | 'HIGH';

/** A secondary measurement in a deliberately composite green-board row. */
export interface StatDetail {
  key: string;
  label: string;
  value: number;
  lo: number;
  hi: number;
  grade: Grade;
  note: string;
}

export interface StatResult {
  key: string;
  label: string;
  value: number;
  lo: number;
  hi: number;
  grade: Grade;
  note: string;
  perTeam: boolean;
  /** Present only for the approved combined offside/formation diagnostic. */
  details?: StatDetail[];
}

export interface StatsReport {
  matches: number;
  results: StatResult[];
  realistic: number;
  total: number;
  score: number;
  scoreline: string;
  verdict: string[];
}

/**
 * A CPU-versus-CPU bot. Both sides are driven by the AI so the numbers measure
 * the simulation, not the tester's thumbs.
 */
function simMatch(cfg: MatchConfig): Director {
  const d = new Director({ ...cfg, cpuA: true, cpuB: true });
  const dt = 1 / 60;
  let guard = 0;
  // Run until the engine calls full time, with a hard iteration ceiling so a
  // stalled state machine cannot hang the audit.
  while (!d.over && guard < 60 * 60 * 14) {
    d.update(dt, NO_INPUT as Input, new Set<string>());
    guard++;
  }
  return d;
}

const roundOne = (value: number) => Number.isFinite(value) ? Math.round(value * 10) / 10 : Number.NaN;
const gradeFor = (value: number, lo: number, hi: number): Grade => {
  if (!Number.isFinite(value) || value < lo) return 'LOW';
  return value > hi ? 'HIGH' : 'REALISTIC';
};
const metricFor = (benchmark: Benchmark, total: number, matches: number): StatDetail => {
  const value = roundOne(total / matches);
  return {
    key: benchmark.key,
    label: benchmark.label,
    value,
    lo: benchmark.lo,
    hi: benchmark.hi,
    grade: gradeFor(value, benchmark.lo, benchmark.hi),
    note: benchmark.note,
  };
};
const textValue = (value: number) => Number.isFinite(value) ? String(value) : 'no eligible samples';

export function auditStats(cfg: MatchConfig, matches = 3): StatsReport {
  const totals: Record<string, number> = {};
  const add = (k: string, v: number) => { totals[k] = (totals[k] ?? 0) + v; };
  let scoreA = 0, scoreB = 0;

  for (let i = 0; i < matches; i++) {
    const d = simMatch(cfg);
    const A = d.A.stats, B = d.B.stats;
    const formation = d.formationIntegrity;
    scoreA += d.A.score; scoreB += d.B.score;
    add('points', (d.A.score + d.B.score) / 2);
    add('tries', (d.events.filter((e) => e.kind === 'TRY').length) / 2);
    add('tackles', (A.tackles + B.tackles) / 2);
    add('rucks', A.rucks + B.rucks);
    /* SPEC_04: outcomes can be asymmetric or absent. Only an explicit set-piece
     * award/start is a match-total scrum or lineout occurrence. */
    add('scrums', d.setPieceEvents.scrums);
    add('lineouts', d.setPieceEvents.lineouts);
    add('penalties', A.penaltiesConceded + B.penaltiesConceded);
    add('passes', A.passes + B.passes);
    add('kicks', A.kicks + B.kicks);
    add('metres', (A.metres + B.metres) / 2);
    add('lineBreaks', (A.lineBreaks + B.lineBreaks) / 2);
    add('turnovers', A.turnovers + B.turnovers);
    const ruckTotal = Math.max(1, A.rucks + B.rucks);
    add('possession', (A.rucks / ruckTotal) * 100);
    add('offloads', A.offloads + B.offloads);
    add('offsidePenalties', (A.offsides + B.offsides) / 2);
    /* Never average the two sides before checking the ceiling: one badly formed
     * defensive line is a defect even if its opponent holds shape. */
    const sampled = formation.targetSlotSamples.A + formation.targetSlotSamples.B;
    add('formationDriftP90', sampled
      ? Math.max(formation.formationDriftP90.A, formation.formationDriftP90.B)
      : Number.POSITIVE_INFINITY);
    /* The companion channel. Same worst-team rule, same never-average-it
     * discipline: one team strung out forty metres from its own ball is a
     * defect even if the other side holds a perfect shape. */
    add('formationMarkAnchorP90', sampled
      ? Math.max(formation.formationMarkAnchorP90.A, formation.formationMarkAnchorP90.B)
      : Number.POSITIVE_INFINITY);
  }

  const results: StatResult[] = BENCHMARKS.map((b) => {
    const metric = metricFor(b, totals[b.key] ?? 0, matches);
    return { ...metric, perTeam: b.perTeam };
  });

  const offside = metricFor(OFFSIDE_PENALTIES_PER_TEAM, totals.offsidePenalties ?? 0, matches);
  const drift = metricFor(FORMATION_DRIFT_P90, totals.formationDriftP90 ?? Number.POSITIVE_INFINITY, matches);
  const anchor = metricFor(FORMATION_MARK_ANCHOR_P90, totals.formationMarkAnchorP90 ?? Number.POSITIVE_INFINITY, matches);
  /* This is intentionally one audit row, but no dimension is hidden: a green
   * result requires the legal-offside band, the drift ceiling AND the
   * mark-to-ball ceiling. SPEC_11 added the third because drift alone passed
   * while the formation sat in the wrong half of the pitch. */
  results.push({
    key: 'offsideFormationIntegrity',
    label: 'OFFSIDE & FORMATION INTEGRITY',
    value: offside.value,
    lo: offside.lo,
    hi: offside.hi,
    grade: offside.grade !== 'REALISTIC' ? offside.grade
      : drift.grade !== 'REALISTIC' ? drift.grade : anchor.grade,
    note: 'The offside-penalty band, the target-slot-drift ceiling and the mark-to-ball ceiling must all pass; '
      + 'neither compensates for another.',
    perTeam: true,
    details: [offside, drift, anchor],
  });

  const realistic = results.filter((r) => r.grade === 'REALISTIC').length;
  const verdict: string[] = [];
  for (const r of results) {
    for (const metric of r.details ?? [r]) {
      if (metric.grade === 'REALISTIC') continue;
      verdict.push(
        metric.grade === 'LOW'
          ? `${metric.label} is ${textValue(metric.value)}, below the realistic floor of ${metric.lo}. ${metric.note}`
          : `${metric.label} is ${textValue(metric.value)}, above the realistic ceiling of ${metric.hi}. ${metric.note}`,
      );
    }
  }
  if (!verdict.length) verdict.push('Every measured statistic falls inside the range a real rugby match produces.');

  return {
    matches,
    results,
    realistic,
    total: results.length,
    score: Math.round((realistic / results.length) * 100),
    scoreline: `${Math.round(scoreA / matches)} — ${Math.round(scoreB / matches)} average over ${matches} matches`,
    verdict,
  };
}
