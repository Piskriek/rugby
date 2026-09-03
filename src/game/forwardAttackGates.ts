/**
 * SPEC_02 — FORWARD-ATTACK MEASUREMENT GATES.
 *
 * These validators are deliberately pure: they snapshot values passed to them
 * and return structured failures. Director owns the dev-only reporting sink,
 * which keeps diagnostic side effects out of the decision and geometry code.
 */

import type { Live, PassOption } from './intelligence';
import type { ForwardAttackDepthInput, ForwardAttackDepthPlan } from './shapes';

export type ForwardAttackGateValue = boolean | number | string | null;

export interface ForwardAttackGateFailure {
  readonly label: string;
  readonly reason: string;
  readonly values: Readonly<Record<string, ForwardAttackGateValue>>;
}

export type ForwardAttackGateReporter = (failure: ForwardAttackGateFailure) => void;

export interface ForwardAttackPlayerSnapshot {
  readonly team: 'A' | 'B';
  readonly num: number;
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly face: number;
  readonly clip: string;
  readonly clipT: number;
  readonly stamina: number;
  readonly restT: number;
  readonly size: number;
  readonly assignment: string;
  readonly job: string;
  readonly tx: number;
  readonly tz: number;
  readonly urgency: number;
  readonly bound: boolean;
  readonly down: boolean;
  readonly carrier: boolean;
  readonly passRank: number;
  readonly eta: number;
  readonly controlled: boolean;
  readonly sinbin: number;
  readonly beatenT: number;
  readonly movedBy: string | null;
  readonly lastFace: number | null;
  readonly turnT: number | null;
}

const PLAYER_FIELDS = [
  'team', 'num', 'x', 'z', 'vx', 'vz', 'face', 'clip', 'clipT', 'stamina',
  'restT', 'size', 'assignment', 'job', 'tx', 'tz', 'urgency', 'bound',
  'down', 'carrier', 'passRank', 'eta', 'controlled', 'sinbin', 'beatenT',
  'movedBy', 'lastFace', 'turnT',
] as const;

export type ForwardAttackPlayerField = typeof PLAYER_FIELDS[number];

const EPSILON = 0.000001;

function failure(
  label: string,
  reason: string,
  values: Readonly<Record<string, ForwardAttackGateValue>>,
): ForwardAttackGateFailure {
  return { label, reason, values };
}

/** A full scalar snapshot taken immediately before or after one Live write. */
export function snapshotForwardAttackPlayer(p: Readonly<Live>): ForwardAttackPlayerSnapshot {
  return {
    team: p.team,
    num: p.num,
    x: p.x,
    z: p.z,
    vx: p.vx,
    vz: p.vz,
    face: p.face,
    clip: p.clip,
    clipT: p.clipT,
    stamina: p.stamina,
    restT: p.restT,
    size: p.size,
    assignment: p.assignment,
    job: p.job,
    tx: p.tx,
    tz: p.tz,
    urgency: p.urgency,
    bound: p.bound,
    down: p.down,
    carrier: p.carrier,
    passRank: p.passRank,
    eta: p.eta,
    controlled: p.controlled,
    sinbin: p.sinbin,
    beatenT: p.beatenT,
    movedBy: p.movedBy ?? null,
    lastFace: p.lastFace ?? null,
    turnT: p.turnT ?? null,
  };
}

export function snapshotForwardAttackPlayers(all: readonly Live[]): readonly ForwardAttackPlayerSnapshot[] {
  return all.map(snapshotForwardAttackPlayer);
}

function changedPlayerFields(
  before: ForwardAttackPlayerSnapshot,
  after: ForwardAttackPlayerSnapshot,
): ForwardAttackPlayerField[] {
  return PLAYER_FIELDS.filter((field) => before[field] !== after[field]);
}

function numberFailure(
  label: string,
  after: ForwardAttackPlayerSnapshot,
): ForwardAttackGateFailure | null {
  const numeric: Array<[string, number | null]> = [
    ['x', after.x], ['z', after.z], ['vx', after.vx], ['vz', after.vz],
    ['face', after.face], ['clipT', after.clipT], ['stamina', after.stamina],
    ['restT', after.restT], ['size', after.size], ['tx', after.tx],
    ['tz', after.tz], ['urgency', after.urgency], ['eta', after.eta],
    ['sinbin', after.sinbin], ['beatenT', after.beatenT], ['lastFace', after.lastFace],
    ['turnT', after.turnT],
  ];
  const invalid = numeric.find(([, value]) => value !== null && !Number.isFinite(value));
  if (invalid) {
    return failure(label, 'non-finite Live value after write', {
      team: after.team, shirt: after.num, field: invalid[0], value: invalid[1],
    });
  }
  if (after.x < -35 - EPSILON || after.x > 35 + EPSILON
    || after.z < -62 - EPSILON || after.z > 62 + EPSILON) {
    return failure(label, 'player position left the playable/dead-ball envelope', {
      team: after.team, shirt: after.num, x: after.x, z: after.z,
    });
  }
  if (after.tx < -35 - EPSILON || after.tx > 35 + EPSILON
    || after.tz < -62 - EPSILON || after.tz > 62 + EPSILON) {
    return failure(label, 'player target left the playable/dead-ball envelope', {
      team: after.team, shirt: after.num, tx: after.tx, tz: after.tz,
    });
  }
  if (after.urgency < -EPSILON || after.urgency > 1 + EPSILON) {
    return failure(label, 'player urgency left the 0..1 contract', {
      team: after.team, shirt: after.num, urgency: after.urgency,
    });
  }
  if (after.stamina < -EPSILON || after.stamina > 100 + EPSILON) {
    return failure(label, 'player stamina left the 0..100 contract', {
      team: after.team, shirt: after.num, stamina: after.stamina,
    });
  }
  return null;
}

/**
 * Assert one and only one declared Live field changed after a named write.
 * A no-op assignment is allowed; it has no hidden second writer to report.
 */
export function forwardAttackPlayerWriteFailures(
  label: string,
  before: ForwardAttackPlayerSnapshot,
  after: ForwardAttackPlayerSnapshot,
  allowedFields: readonly ForwardAttackPlayerField[],
): readonly ForwardAttackGateFailure[] {
  const failures: ForwardAttackGateFailure[] = [];
  const changed = changedPlayerFields(before, after);
  const unexpected = changed.filter((field) => !allowedFields.includes(field));
  if (unexpected.length) {
    failures.push(failure(label, 'write changed an undeclared Live field', {
      team: after.team,
      shirt: after.num,
      allowed: allowedFields.join(','),
      changed: changed.join(','),
    }));
  }
  const invalid = numberFailure(label, after);
  if (invalid) failures.push(invalid);
  return failures;
}

/** Pass-option values copied into a compact snapshot for deterministic logs. */
export interface ForwardAttackPassOptionSnapshot {
  readonly shirt: number;
  readonly team: 'A' | 'B';
  readonly side: -1 | 1;
  readonly covered: boolean;
  readonly distance: number;
  readonly time: number;
  readonly risk: number;
  readonly lateralSeparationMetres: number;
  readonly forwardGainMetres: number;
  readonly priority: string;
  readonly rank: number;
}

export function snapshotForwardAttackPassOption(option: Readonly<PassOption>): ForwardAttackPassOptionSnapshot {
  return {
    shirt: option.player.num,
    team: option.player.team,
    side: option.side,
    covered: option.covered,
    distance: option.distance,
    time: option.time,
    risk: option.risk,
    lateralSeparationMetres: option.lateralSeparationMetres,
    forwardGainMetres: option.forwardGainMetres,
    priority: option.priority,
    rank: option.rank,
  };
}

/** Candidate gate: catches bad measurements before they influence a sort. */
export function forwardAttackPassCandidateFailures(
  label: string,
  carrier: Readonly<Live>,
  option: Readonly<PassOption>,
): readonly ForwardAttackGateFailure[] {
  const failures: ForwardAttackGateFailure[] = [];
  const values = snapshotForwardAttackPassOption(option);
  const scalarValues = [
    values.distance, values.time, values.risk,
    values.lateralSeparationMetres, values.forwardGainMetres,
  ];
  if (scalarValues.some((value) => !Number.isFinite(value))) {
    failures.push(failure(label, 'pass candidate contains a non-finite measurement', {
      carrier: carrier.num, target: values.shirt, distance: values.distance,
      time: values.time, risk: values.risk, lateral: values.lateralSeparationMetres,
      forwardGain: values.forwardGainMetres,
    }));
  }
  if (option.player.team !== carrier.team || option.player.num === carrier.num) {
    failures.push(failure(label, 'pass candidate is not an eligible team-mate', {
      carrier: carrier.num, carrierTeam: carrier.team, target: values.shirt, targetTeam: values.team,
    }));
  }
  if (values.distance < 0 || values.distance > 26 + EPSILON || values.time < 0
    || values.risk < 0 || values.risk > 1 || values.lateralSeparationMetres < 0
    || values.forwardGainMetres < -EPSILON) {
    failures.push(failure(label, 'pass candidate left its measured range', {
      carrier: carrier.num, target: values.shirt, distance: values.distance,
      time: values.time, risk: values.risk, lateral: values.lateralSeparationMetres,
      forwardGain: values.forwardGainMetres,
    }));
  }
  if (values.priority === 'UNCOVERED_WING'
    && (values.covered || (values.shirt !== 11 && values.shirt !== 14))) {
    failures.push(failure(label, 'wing override was assigned to an ineligible candidate', {
      carrier: carrier.num, target: values.shirt, covered: values.covered,
      priority: values.priority,
    }));
  }
  return failures;
}

function priorityRank(priority: string): number {
  return priority === 'UNCOVERED_WING' ? 0 : priority === 'FORWARD_GAIN' ? 1 : 2;
}

/** Sort gate: verifies membership and the approved priority order. */
export function forwardAttackPassOrderFailures(
  label: string,
  before: readonly PassOption[],
  ranked: readonly PassOption[],
  priorityEnabled: boolean,
): readonly ForwardAttackGateFailure[] {
  const failures: ForwardAttackGateFailure[] = [];
  const beforeIds = before.map((o) => `${o.player.team}:${o.player.num}:${o.side}`).sort();
  const afterIds = ranked.map((o) => `${o.player.team}:${o.player.num}:${o.side}`).sort();
  if (beforeIds.length !== afterIds.length || beforeIds.some((id, i) => id !== afterIds[i])) {
    failures.push(failure(label, 'sort lost, duplicated, or invented a pass candidate', {
      before: beforeIds.join('|'), after: afterIds.join('|'),
    }));
  }
  if (priorityEnabled) {
    for (let i = 1; i < ranked.length; i++) {
      if (priorityRank(ranked[i - 1].priority) > priorityRank(ranked[i].priority)) {
        failures.push(failure(label, 'sort violated the forward-priority matrix', {
          earlier: ranked[i - 1].player.num, earlierPriority: ranked[i - 1].priority,
          later: ranked[i].player.num, laterPriority: ranked[i].priority,
        }));
        break;
      }
    }
  }
  return failures;
}

/** Selection gate: one option per side, contiguous ranks, and no duplicated shirt. */
export function forwardAttackPassSelectionFailures(
  label: string,
  options: readonly PassOption[],
): readonly ForwardAttackGateFailure[] {
  const failures: ForwardAttackGateFailure[] = [];
  const shirts = options.map((o) => `${o.player.team}:${o.player.num}`);
  const sideCount = new Map<number, number>();
  for (const option of options) sideCount.set(option.side, (sideCount.get(option.side) ?? 0) + 1);
  if (new Set(shirts).size !== shirts.length || [...sideCount.values()].some((count) => count > 1)) {
    failures.push(failure(label, 'pass selection contains a duplicate target or side', {
      targets: shirts.join('|'), sides: options.map((o) => o.side).join('|'),
    }));
  }
  const badRank = options.find((option, index) => option.rank !== index + 1);
  if (badRank) {
    failures.push(failure(label, 'pass selection ranks are not contiguous', {
      target: badRank.player.num, rank: badRank.rank, count: options.length,
    }));
  }
  return failures;
}

/** `passOptions()` must not mutate its caller's player state while it ranks. */
export function forwardAttackLivePurityFailures(
  label: string,
  before: readonly ForwardAttackPlayerSnapshot[],
  after: readonly Live[],
): readonly ForwardAttackGateFailure[] {
  const afterSnapshots = snapshotForwardAttackPlayers(after);
  if (before.length !== afterSnapshots.length) {
    return [failure(label, 'pass ranking changed the live-player collection', {
      beforeCount: before.length, afterCount: afterSnapshots.length,
    })];
  }
  for (let i = 0; i < before.length; i++) {
    const changed = changedPlayerFields(before[i], afterSnapshots[i]);
    if (changed.length) {
      return [failure(label, 'pass ranking mutated a Live player', {
        team: afterSnapshots[i].team, shirt: afterSnapshots[i].num, changed: changed.join(','),
      })];
    }
  }
  return [];
}

/** Pure geometry gate installed before a depth plan is committed into `think()`. */
export function forwardAttackDepthPlanFailures(
  label: string,
  input: Readonly<ForwardAttackDepthInput>,
  plan: Readonly<ForwardAttackDepthPlan>,
): readonly ForwardAttackGateFailure[] {
  const failures: ForwardAttackGateFailure[] = [];
  const allNumbers = [
    input.anchor.x, input.anchor.z, input.lateralOffsetMetres,
    input.nominalSupportDepthMetres, input.shapeDepthBias, input.tempo,
    input.distanceToTryLineMetres, plan.setup.x, plan.setup.z,
    plan.arrival.x, plan.arrival.z, plan.carryTarget.x, plan.carryTarget.z,
    plan.supportDepthMetres, plan.forwardGainMetres,
  ];
  if (allNumbers.some((value) => !Number.isFinite(value))) {
    return [failure(label, 'depth plan contains a non-finite coordinate or measure', {
      anchorX: input.anchor.x, anchorZ: input.anchor.z,
      setupX: plan.setup.x, setupZ: plan.setup.z,
      arrivalX: plan.arrival.x, arrivalZ: plan.arrival.z,
      carryX: plan.carryTarget.x, carryZ: plan.carryTarget.z,
    })];
  }

  const direction = input.attackDirection;
  const setupDepth = (input.anchor.z - plan.setup.z) * direction;
  const carryGain = (plan.carryTarget.z - input.anchor.z) * direction;
  const maxCarryGain = Math.max(0, input.distanceToTryLineMetres - 0.5);
  if (Math.abs(setupDepth - plan.supportDepthMetres) > EPSILON || setupDepth < 0.5 - EPSILON) {
    failures.push(failure(label, 'support setup is not behind the gain-line anchor', {
      direction, setupDepth, declaredDepth: plan.supportDepthMetres,
      anchorZ: input.anchor.z, setupZ: plan.setup.z,
    }));
  }
  if (Math.abs(plan.arrival.z - input.anchor.z) > EPSILON) {
    failures.push(failure(label, 'run-on arrival missed the gain line', {
      anchorZ: input.anchor.z, arrivalZ: plan.arrival.z,
    }));
  }
  if (carryGain < -EPSILON || carryGain > maxCarryGain + EPSILON
    || Math.abs(carryGain - plan.forwardGainMetres) > EPSILON) {
    failures.push(failure(label, 'carry target exceeded its forward-gain envelope', {
      direction, carryGain, declaredGain: plan.forwardGainMetres,
      maxCarryGain, distanceToTryLine: input.distanceToTryLineMetres,
    }));
  }
  if (Math.abs(plan.setup.x - plan.arrival.x) > EPSILON
    || Math.abs(plan.arrival.x - plan.carryTarget.x) > EPSILON) {
    failures.push(failure(label, 'depth plan changed lateral lane between setup and carry', {
      setupX: plan.setup.x, arrivalX: plan.arrival.x, carryX: plan.carryTarget.x,
    }));
  }
  return failures;
}

/** Generic scalar-state check for a write outside Live (call/dispatch state). */
export function forwardAttackStateWriteFailures(
  label: string,
  before: Readonly<Record<string, ForwardAttackGateValue>>,
  after: Readonly<Record<string, ForwardAttackGateValue>>,
  allowedFields: readonly string[],
): readonly ForwardAttackGateFailure[] {
  const failures: ForwardAttackGateFailure[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [...keys].filter((key) => before[key] !== after[key]);
  const unexpected = changed.filter((field) => !allowedFields.includes(field));
  if (unexpected.length) {
    failures.push(failure(label, 'write changed an undeclared scalar state field', {
      allowed: allowedFields.join(','), changed: changed.join(','), unexpected: unexpected.join(','),
    }));
  }
  const invalid = Object.entries(after).find(([, value]) => typeof value === 'number' && !Number.isFinite(value));
  if (invalid) {
    failures.push(failure(label, 'scalar state contains a non-finite value after write', {
      field: invalid[0], value: invalid[1] as number,
    }));
  }
  return failures;
}

/** Dispatch gate: a successful CPU pass must launch to the selected option. */
export function forwardAttackPassDispatchFailures(
  label: string,
  before: Readonly<Record<string, ForwardAttackGateValue>>,
  after: Readonly<Record<string, ForwardAttackGateValue>>,
  selectedShirt: number | null,
): readonly ForwardAttackGateFailure[] {
  if (selectedShirt === null || after.ballLive !== true) return [];
  const failures: ForwardAttackGateFailure[] = [];
  if (after.pendingReceiver !== selectedShirt) {
    failures.push(failure(label, 'CPU pass launched to a different receiver than the ranked selection', {
      selected: selectedShirt, pendingReceiver: after.pendingReceiver,
      beforeCarrier: before.carrierNum, afterCarrier: after.carrierNum,
    }));
  }
  if (after.carrierNum !== before.carrierNum) {
    failures.push(failure(label, 'CPU pass changed carrier before the ball flight resolved', {
      beforeCarrier: before.carrierNum, afterCarrier: after.carrierNum,
      selected: selectedShirt,
    }));
  }
  return failures;
}
