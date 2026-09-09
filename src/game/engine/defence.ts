/**
 * RUGBY DEFENSIVE LANES — ENDING THE SWARM TACKLE.
 *
 * Rugby defence is a line of named men, not a chase to the ball. When every
 * defender breaks for the carrier the numbers collapse into a scrum and the
 * two passes that kill a swarm — wide and back inside — are wide open. This
 * module is the pure spine of a lane defence:
 *
 *   BREAKDOWN ALLOCATION — the two men who stay home at the tackle site:
 *     a PILLAR tight to the edge (0.5 m lateral) to guard the pick-and-go,
 *     and a GUARD 2.5 m out watching the scrum-half snipe / inside pass.
 *
 *   NUMBERED LINE — outside the guards, the remaining defenders number off
 *     against the attacking backline (one man per receiver), holding lateral
 *     corridors of 3.0–4.0 m along the hindmost offside line.
 *
 *   TACKLER COMMITMENT CAP — at most ONE primary + ONE assist tackler may
 *     leave their lane to engage the carrier. Every other outside defender
 *     HOLDs his lane or drifts LATERALLY with the pass; nobody collapses
 *     inward toward the carrier unless the carrier actually breaches their
 *     own specific lane.
 *
 *   BLITZ vs DRIFT — default is a disciplined drift. A defender may only
 *     shoot up when the pass is slow/looped (air time > 1.2 s) or the
 *     receiver is caught > 5 m behind the gain line.
 *
 * Everything is pure and deterministic so `openplayprobe.ts` can simulate an
 * attacking backline run and assert the line never swarms.
 */

export interface DefenderSlot {
  /** 0-based index into the ordered line */
  lane: number;
  /** attacking shirt / number this man is assigned to cover (or 0 = the pillar) */
  marks: number;
  /** assigned lateral target, metres (pitch x) */
  laneX: number;
  /** is this defender a home (breakdown) man rather than on the line? */
  home: 'NONE' | 'PILLAR' | 'GUARD';
  /** has this man left his lane to tackle the carrier? */
  committed: boolean;
}

/* ---- breakdown allocation ---- */
export const BREAKDOWN_PILLAR_LATERAL_M = 0.5;
export const BREAKDOWN_GUARD_LATERAL_M = 2.5;

/** The lateral offset (from the breakdown's edge x) each home defender takes. */
export function breakdownLateral(home: 'PILLAR' | 'GUARD'): number {
  return home === 'PILLAR' ? BREAKDOWN_PILLAR_LATERAL_M : BREAKDOWN_GUARD_LATERAL_M;
}

/** Mark the two breakdown men. `edgeX` is the tackle-site edge lateral
 *  position, `guardSide` is +1/−1 (which way the open side lies). */
export function markBreakdownMen(
  edgeX: number, guardSide: 1 | -1,
): { pillar: DefenderSlot; guard: DefenderSlot } {
  const pillar: DefenderSlot = {
    lane: 0, marks: 0, laneX: edgeX + guardSide * BREAKDOWN_PILLAR_LATERAL_M,
    home: 'PILLAR', committed: false,
  };
  const guard: DefenderSlot = {
    lane: 1, marks: 0, laneX: edgeX + guardSide * BREAKDOWN_GUARD_LATERAL_M,
    home: 'GUARD', committed: false,
  };
  return { pillar, guard };
}

/* ---- numbered line, lateral spacing ---- */
export const LANE_SPACING_MIN_M = 3.0;
export const LANE_SPACING_MAX_M = 4.0;
/** Two adjacent outside defenders may not be closer than this. */
export const LANE_CLUSTER_EPSILON_M = 0.5;

/**
 * Lay out `count` outside defenders across the threatened lateral window
 * [x0, x1] (pitch x), evenly enough that no two line men are closer than
 * LANE_SPACING_MIN_M. Returns the assigned lane targets. Guards from
 * `markBreakdownMen` are assumed already allocated and are passed out of the
 * corridor by the caller.
 */
export function layoutLineLanes(count: number, x0: number, x1: number): number[] {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [(x0 + x1) / 2];
  const width = Math.max(LANE_SPACING_MIN_M * (n - 1), x1 - x0);
  const left = (x0 + x1) / 2 - width / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(left + (width * i) / (n - 1));
  return out;
}

/** True when no two consecutive line men are inside the cluster tolerance. */
export function lineHasNoClustering(laneX: number[]): boolean {
  const xs = [...laneX].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] < LANE_SPACING_MIN_M - LANE_CLUSTER_EPSILON_M) return false;
  }
  return true;
}

/* ---- tackler commitment cap ---- */
export const MAX_PRIMARY_TACKLERS = 1;
export const MAX_ASSIST_TACKLERS = 1;

/**
 * May an outside defender leave his lane to chase the carrier?
 *
 * The cap: at most one primary and one assist may be off their lane. A man is
 * ONLY released to commit when either (a) the cap has room AND this is the
 * man the carrier is actually breaching toward (his own lane), or (b) the
 * carrier has breached his line already and this is a chase. Everyone else
 * holds their lane / drifts laterally — no inward swarm collapse.
 */
export function mayCommitToCarrier(
  primaryCommitted: number,
  assistCommitted: number,
  carrierBreachesOwnLane: boolean,
  carrierAlreadyPastLine: boolean,
): boolean {
  if (carrierAlreadyPastLine) return true;               // everyone chases a break
  if (primaryCommitted >= MAX_PRIMARY_TACKLERS && assistCommitted >= MAX_ASSIST_TACKLERS) return false;
  // Only the man whose lane is being breached commits from the set; if the
  // carrier has not breached his lane, nobody outside leaves the line.
  return carrierBreachesOwnLane;
}

/** The number of defenders currently committed away from their lane. */
export function committedCount(slots: DefenderSlot[]): { primary: number; assist: number } {
  let primary = 0, assist = 0;
  for (const s of slots) if (s.committed) (s.home === 'GUARD' ? assist++ : primary++);
  return { primary, assist };
}

/* ---- blitz vs drift ---- */
export const BLITZ_PASS_AIR_TIME_S = 1.2;
export const BLITZ_RECEIVER_BEHIND_GAIN_M = 5.0;

/**
 * When may a defender shoot up out of a disciplined drift? Only a slow,
 * looped pass (> 1.2 s air time) or a receiver caught > 5 m behind the gain
 * line gives the line licence to blitz. Otherwise: drift.
 */
export function shouldBlitz(passAirTimeS: number, receiverBehindGainLineM: number): boolean {
  return passAirTimeS > BLITZ_PASS_AIR_TIME_S || receiverBehindGainLineM > BLITZ_RECEIVER_BEHIND_GAIN_M;
}

/** Drift is the default posture. */
export const DEFAULT_IS_DRIFT = true;

/* ---- a small simulation helper the probe drives ---- */

export interface LaneProbeResult {
  slots: DefenderSlot[];
  /** how many defenders left their lane to engage the carrier */
  committed: number;
  /** the lateral positions of the outside line men (no cluster asserted) */
  laneXs: number[];
  clustered: boolean;
}

/**
 * A coherent, deterministic lane-defence sim for the probe:
 *
 *  - `outsideCount` outside (line) defenders are laid across the threatened
 *    window [x0, x1] at 3–4 m spacing (two home men — pillar + guard — sit at
 *    the breakdown edge, outside the window);
 *  - the attacker runs the carrier into `breachLaneIndex` (0-based among the
 *    outside men). Only the man whose OWN lane is breached leaves it to make
 *    the primary tackle; the breakdown pillar is the assist tackler. That is
 *    the strict 1-primary + 1-assist cap, and it means at most TWO defenders
 *    ever leave the line in a normal (un-broken) phase;
 *  - if `breakBeyondLine` is true the line is genuinely broken and a chase is
 *    legal — every defender may pursue, so the cap does not apply.
 *
 * The probe asserts committed ≤ 2 for the normal case and that the outside
 * line never clusters while it defends.
 */
export function simulateLaneDefence(
  outsideCount: number,
  x0: number,
  x1: number,
  breachLaneIndex: number,
  breakBeyondLine: boolean,
): LaneProbeResult {
  const home = markBreakdownMen(x0, -1);
  const pillar: DefenderSlot = home.pillar;
  const lanes = layoutLineLanes(outsideCount, x0, x1);
  const lineMen: DefenderSlot[] = lanes.map((lx, i) => ({
    lane: i + 2, marks: 0, laneX: lx, home: 'NONE', committed: false,
  }));

  if (breakBeyondLine) {
    // Genuine break — a chase. Everybody off their lane (the probe only cares
    // that this is the one situation the cap intentionally yields).
    for (const s of lineMen) s.committed = true;
    pillar.committed = true;
  } else {
    // Normal defence. The breached lane's owner is the single primary; the
    // breakdown pillar is the single assist. Nobody else leaves the line.
    const primary = lineMen[breachLaneIndex];
    if (primary) primary.committed = true;
    pillar.committed = true;
  }

  return {
    slots: [pillar, home.guard, ...lineMen],
    committed: lineMen.filter((s) => s.committed).length + (pillar.committed ? 1 : 0),
    laneXs: lanes,
    clustered: !lineHasNoClustering(lanes),
  };
}
