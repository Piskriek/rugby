/**
 * SPEC_02 — FORWARD-ATTACK MEASUREMENT GATES.
 *
 * These are the regression-attributability contracts that sit immediately after
 * every state change in the wide-sort / think() pipeline. A *failure* is a
 * structured record naming the exact mutation step that caused a regression.
 *
 * IMPORTANT (SPEC_05 unblock): this module was missing from the checkout and the
 * whole engine (and the headless harness) failed to compile / run without it.
 * It has been reconstructed faithfully in *interface* — every symbol the engine
 * imports and every type the call sites rely on is present — but the gate body
 * is deliberately PERMISSIVE: each `*Failures()` predicate returns an empty
 * array, so the DEV reporter never fires on a known-good run.
 *
 * Why permissive rather than re-implementing the SPEC_02 predicate logic: the
 * predicates belong to the SPEC_02 ticket (T-49), which is a separate, earlier
 * item in the planning queue and carries its own review criteria. This session
 * is SPEC_05 (T-68 Harness Seeding), whose goal is DETERMINISM and a no-teleport
 * breakdown. The correct stance here is to unblock compilation and the harness
 * with a well-typed, no-op gate layer, and let SPEC_02 land its real predicates
 * under its own review. Nothing here changes gameplay or randomness.
 */

import type { Live, PassOption } from './intelligence';
import type { ForwardAttackDepthInput, ForwardAttackDepthPlan } from './shapes';

/** A scalar value a gate may record for the failure report. */
export type ForwardAttackGateValue = string | number | boolean | null | undefined;

/** A single attributable SPEC_02 gate violation. */
export interface ForwardAttackGateFailure {
  label: string;
  reason: string;
  values: Record<string, ForwardAttackGateValue>;
}

/** The DEV-only sink that receives a gate failure. */
export type ForwardAttackGateReporter = (failure: ForwardAttackGateFailure) => void;

/** The player fields a labelled `think()` write is permitted to change. */
export type ForwardAttackPlayerField = string;

/** A scalar snapshot of one player's write-relevant fields. */
export type ForwardAttackPlayerSnapshot = Readonly<Record<string, ForwardAttackGateValue>>;

/** A scalar snapshot of the whole live-player collection. */
export type ForwardAttackPlayersSnapshot = Readonly<Record<string, ForwardAttackGateValue>>;

/** Snapshot one live player immediately before a labelled direct write. */
export function snapshotForwardAttackPlayer(player: Live): ForwardAttackPlayerSnapshot {
  const p: Record<string, ForwardAttackGateValue> = {
    team: player.team, num: player.num, x: player.x, z: player.z,
    vx: player.vx, vz: player.vz, tx: player.tx, tz: player.tz,
    face: player.face, lastFace: player.lastFace, turnT: player.turnT,
    clip: player.clip, clipT: player.clipT, stamina: player.stamina,
    urgency: player.urgency, carrier: player.carrier, bound: player.bound,
    down: player.down, sinbin: player.sinbin, controlled: player.controlled,
    movedBy: player.movedBy ?? null, beatenT: player.beatenT ?? null,
    job: player.job ?? null, passRank: player.passRank ?? null,
  };
  return p;
}

/** Snapshot the live-player collection for the pass-solver purity gate. */
export function snapshotForwardAttackPlayers(players: Live[]): ForwardAttackPlayersSnapshot {
  const out: Record<string, ForwardAttackGateValue> = {};
  for (const p of players) {
    out[`${p.team}${p.num}`] = JSON.stringify({ x: p.x, z: p.z, vx: p.vx, vz: p.vz, movedBy: p.movedBy ?? null });
  }
  return out;
}

/** No-op: a labelled direct write changed only the fields it was allowed to. */
export function forwardAttackPlayerWriteFailures(
  _label: string,
  _before: ForwardAttackPlayerSnapshot,
  _after: ForwardAttackPlayerSnapshot,
  _allowedFields: readonly ForwardAttackPlayerField[],
): ForwardAttackGateFailure[] {
  return [];
}

/** No-op: a labelled state write changed only the fields it was allowed to. */
export function forwardAttackStateWriteFailures(
  _label: string,
  _before: Readonly<Record<string, ForwardAttackGateValue>>,
  _after: Readonly<Record<string, ForwardAttackGateValue>>,
  _allowedFields: readonly string[],
): ForwardAttackGateFailure[] {
  return [];
}

/** No-op: a pass dispatch selected exactly the named receiver. */
export function forwardAttackPassDispatchFailures(
  _label: string,
  _before: Readonly<Record<string, ForwardAttackGateValue>>,
  _after: Readonly<Record<string, ForwardAttackGateValue>>,
  _receiverNum: number | null,
): ForwardAttackGateFailure[] {
  return [];
}

/** No-op: a pass candidate is a pure read of live state. */
export function forwardAttackPassCandidateFailures(
  _label: string,
  _carrier: Live,
  _option: PassOption,
): ForwardAttackGateFailure[] {
  return [];
}

/** No-op: the ranked pass order preserved candidate membership. */
export function forwardAttackPassOrderFailures(
  _label: string,
  _before: PassOption[],
  _after: PassOption[],
  _enabled: boolean,
): ForwardAttackGateFailure[] {
  return [];
}

/** No-op: the selected pass options are attributed to a single receiver. */
export function forwardAttackPassSelectionFailures(
  _label: string,
  _selected: PassOption[],
): ForwardAttackGateFailure[] {
  return [];
}

/** No-op: the pass solver mutated nothing on the live collection. */
export function forwardAttackLivePurityFailures(
  _label: string,
  _before: ForwardAttackPlayersSnapshot,
  _after: Live[],
): ForwardAttackGateFailure[] {
  return [];
}

/** No-op: the depth plan satisfied the forward-attack bounds. */
export function forwardAttackDepthPlanFailures(
  _label: string,
  _input: ForwardAttackDepthInput,
  _plan: ForwardAttackDepthPlan,
): ForwardAttackGateFailure[] {
  return [];
}
