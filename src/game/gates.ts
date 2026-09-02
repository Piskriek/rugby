/**
 * REGRESSION GATES — named, pass/fail thresholds over the fault hunt.
 *
 * The audit detects faults but has never asserted anything: a change could drive
 * `tacklesMade` to zero and nothing would complain. This is that assertion.
 *
 * A gate is a single measurable property of `runDeep` with a threshold and a
 * direction. `runGates()` runs the fault hunt across three difficulty levels
 * and returns PASS / FAIL per gate. This is the thing every other ticket is
 * verified against — if a change moves a gate, stop and find out why.
 */

import { MatchConfig } from './director';
import { runDeep, DeepReport } from './trace';
import { DEFAULT_SLIDERS, OPTION_ITEMS } from './data';

export interface Gate {
  key: string;
  label: string;
  /** which DeepReport field to read */
  field: keyof DeepReport;
  /** comparison direction */
  op: 'eq' | 'gte' | 'lte';
  threshold: number;
  why: string;
}

export const GATES: Gate[] = [
  { key: 'teleport', label: 'NO TELEPORTS', field: 'teleportCount', op: 'eq', threshold: 0, why: 'A player moved more than a sprint in one 16 ms frame — two systems wrote his position at once.' },
  { key: 'bounce', label: 'EVERY BALL BOUNCES', field: 'neverBounced', op: 'eq', threshold: 0, why: 'A ball reached the turf without bouncing. The kick phase is ending early.' },
  { key: 'tackle', label: 'TACKLES HAPPEN', field: 'tacklesMade', op: 'gte', threshold: 8, why: 'Contact is the heartbeat of rugby. Fewer than 8 tackles in 60 s means the defence never arrives.' },
  { key: 'chase', label: 'CHASE ARRIVES', field: 'chaseArrivals', op: 'gte', threshold: 20, why: 'Nobody got within 4 m of the ball in flight — the kick chase is not functioning.' },
  { key: 'whip', label: 'CAMERA STABLE', field: 'whipFrames', op: 'eq', threshold: 0, why: 'The camera yaw swung more than 3.4° in a frame — the rig is not eased.' },
  { key: 'encroach', label: 'NO ENCROACHMENT', field: 'encroachFrames', op: 'eq', threshold: 0, why: 'A receiver stood inside the ten-metre line at a restart, against Law 12.' },
  { key: 'freeze', label: 'NO FREEZES', field: 'watchdogTrips', op: 'eq', threshold: 0, why: 'The watchdog fired — a phase got stuck and had to be force-reset. Every trip is a real bug.' },
  { key: 'possession', label: 'POSSESSION MOVES', field: 'possessionChanges', op: 'gte', threshold: 2, why: 'The ball changed hands fewer than twice in 60 s — turnovers are not happening.' },
  { key: 'offtarget', label: 'BALL ON SCREEN', field: 'offTargetFrames', op: 'lte', threshold: 60, why: 'The ball was out of frame for more than a second in total.' },
];

export interface GateResult {
  key: string;
  label: string;
  field: keyof DeepReport;
  op: string;
  threshold: number;
  value: number;
  pass: boolean;
  why: string;
}

export interface GatesReport {
  results: GateResult[];
  pass: number;
  total: number;
  overall: boolean;
  perDifficulty: Array<{ diff: number; pass: number; total: number }>;
}

function evaluate(gate: Gate, report: DeepReport): GateResult {
  const v = report[gate.field] as number;
  const pass = gate.op === 'eq' ? v === gate.threshold
    : gate.op === 'gte' ? v >= gate.threshold
      : v <= gate.threshold;
  return { key: gate.key, label: gate.label, field: gate.field, op: gate.op, threshold: gate.threshold, value: v, pass, why: gate.why };
}

/** A minimal config for a CPU-v-CPU match at a given difficulty. */
export function gateConfig(diff: number): MatchConfig {
  const options: Record<string, number> = {};
  for (const i of OPTION_ITEMS) options[i.id] = i.def;
  options.difficulty = diff;
  return {
    homeId: 'ENG', awayId: 'NZL', kitA: 0, kitB: 0,
    difficulty: diff, halfLength: 40, options,
    slidersA: DEFAULT_SLIDERS.map((s) => ({ ...s })),
    slidersB: DEFAULT_SLIDERS.map((s) => ({ ...s })),
    backlineA: 'BL-SPLIT', defenceA: 'DF-UMBRELLA', lineoutA: 'LO-5', scrumA: 'SC-8-3',
    backlineB: 'BL-SPLIT', defenceB: 'DF-UMBRELLA', lineoutB: 'LO-5', scrumB: 'SC-8-3',
    cpuA: true, cpuB: true, kickerA: 10, kickerB: 10,
    assists: { pass: 0.7, tackle: 0.7, kick: 0.7 }, speed: 1,
  };
}

/** Run the fault hunt across three difficulties and grade every gate. */
export function runGates(seconds = 60): GatesReport {
  const levels = [0, 3, 6];
  const reports: Array<{ diff: number; r: DeepReport }> = levels.map((d) => ({ diff: d, r: runDeep(gateConfig(d), seconds) }));
  const results: GateResult[] = GATES.map((g) => {
    // Aggregate the strictest (worst) value across the three levels.
    const vals = reports.map((x) => x.r[g.field] as number);
    const worst = g.op === 'lte' ? Math.max(...vals) : g.op === 'gte' ? Math.min(...vals) : Math.max(...vals);
    return evaluate(g, { ...reports[0].r, [g.field]: worst } as DeepReport);
  });
  const pass = results.filter((r) => r.pass).length;
  const perDifficulty = reports.map((x) => ({
    diff: x.diff,
    pass: GATES.filter((g) => {
      const v = x.r[g.field] as number;
      return g.op === 'eq' ? v === g.threshold : g.op === 'gte' ? v >= g.threshold : v <= g.threshold;
    }).length,
    total: GATES.length,
  }));
  return {
    results,
    pass,
    total: results.length,
    overall: pass === results.length,
    perDifficulty,
  };
}

export const GATE_COUNT = GATES.length;
