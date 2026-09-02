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
  { key: 'scrums', label: 'SCRUMS PER MATCH', lo: 8, hi: 22, perTeam: false, note: 'Roughly 12-15. Driven by knock-ons and forward passes, so it is a direct read on handling error rates.' },
  { key: 'lineouts', label: 'LINEOUTS PER MATCH', lo: 14, hi: 34, perTeam: false, note: 'Around 22-25. Driven by how often the ball goes to touch, which is a read on the kicking game.' },
  { key: 'penalties', label: 'PENALTIES PER MATCH', lo: 14, hi: 28, perTeam: false, note: 'Around 18-22. Far too many was the old offside bug; far too few means the referee is asleep.' },
  { key: 'passes', label: 'PASSES PER MATCH', lo: 180, hi: 340, perTeam: false, note: 'Around 250. A read on whether the ball actually moves through hands.' },
  { key: 'kicks', label: 'KICKS FROM HAND', lo: 30, hi: 70, perTeam: false, note: 'Around 45-55. Under 30 means the kicking game does not exist; over 70 means nobody runs.' },
  { key: 'metres', label: 'METRES CARRIED PER TEAM', lo: 250, hi: 800, perTeam: true, note: 'Around 400-600. A direct read on whether carries actually gain ground.' },
  { key: 'lineBreaks', label: 'LINE BREAKS PER TEAM', lo: 2, hi: 16, perTeam: true, note: 'Around 8. Too many and the defensive line is not connected.' },
  { key: 'turnovers', label: 'TURNOVERS PER MATCH', lo: 10, hi: 32, perTeam: false, note: 'Around 18-22 including at the breakdown, in the tackle and from errors.' },
  { key: 'possession', label: 'POSSESSION SPLIT (% OF MAX)', lo: 40, hi: 60, perTeam: false, note: 'A balanced match sits near 50/50. A large skew means one side cannot get the ball back.' },
  { key: 'offloads', label: 'OFFLOADS PER MATCH', lo: 4, hi: 30, perTeam: false, note: 'Around 12. Highly style-dependent, so the range is deliberately wide.' },
];

export type Grade = 'REALISTIC' | 'LOW' | 'HIGH';

export interface StatResult {
  key: string;
  label: string;
  value: number;
  lo: number;
  hi: number;
  grade: Grade;
  note: string;
  perTeam: boolean;
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

export function auditStats(cfg: MatchConfig, matches = 3): StatsReport {
  const totals: Record<string, number> = {};
  const add = (k: string, v: number) => { totals[k] = (totals[k] ?? 0) + v; };
  let scoreA = 0, scoreB = 0;

  for (let i = 0; i < matches; i++) {
    const d = simMatch(cfg);
    const A = d.A.stats, B = d.B.stats;
    scoreA += d.A.score; scoreB += d.B.score;
    add('points', (d.A.score + d.B.score) / 2);
    add('tries', (d.events.filter((e) => e.kind === 'TRY').length) / 2);
    add('tackles', (A.tackles + B.tackles) / 2);
    add('rucks', A.rucks + B.rucks);
    add('scrums', A.scrumsWon + A.scrumsLost + B.scrumsWon + B.scrumsLost);
    add('lineouts', A.lineoutsWon + A.lineoutsLost + B.lineoutsWon + B.lineoutsLost);
    add('penalties', A.penaltiesConceded + B.penaltiesConceded);
    add('passes', A.passes + B.passes);
    add('kicks', A.kicks + B.kicks);
    add('metres', (A.metres + B.metres) / 2);
    add('lineBreaks', (A.lineBreaks + B.lineBreaks) / 2);
    add('turnovers', A.turnovers + B.turnovers);
    const ruckTotal = Math.max(1, A.rucks + B.rucks);
    add('possession', (A.rucks / ruckTotal) * 100);
    add('offloads', A.offloads + B.offloads);
  }

  const results: StatResult[] = BENCHMARKS.map((b) => {
    const value = Math.round(((totals[b.key] ?? 0) / matches) * 10) / 10;
    const grade: Grade = value < b.lo ? 'LOW' : value > b.hi ? 'HIGH' : 'REALISTIC';
    return { key: b.key, label: b.label, value, lo: b.lo, hi: b.hi, grade, note: b.note, perTeam: b.perTeam };
  });

  const realistic = results.filter((r) => r.grade === 'REALISTIC').length;
  const verdict: string[] = [];
  for (const r of results.filter((x) => x.grade !== 'REALISTIC')) {
    verdict.push(
      r.grade === 'LOW'
        ? `${r.label} is ${r.value}, below the realistic floor of ${r.lo}. ${r.note}`
        : `${r.label} is ${r.value}, above the realistic ceiling of ${r.hi}. ${r.note}`,
    );
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
