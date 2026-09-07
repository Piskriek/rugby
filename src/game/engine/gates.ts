/**
 * TARCS REFINEMENT — RUCK ENTRY GATES.
 *
 * Law 15 says a player who joins a ruck must do so THROUGH the gate: from
 * behind the hindmost foot of his own side, within the lateral width of the
 * contest. Coming in round the side of the pile, or through the front door,
 * is the offence the old law books called "no-side entry" and the modern
 * vocabulary calls side entry. It is an offside-family offence and it is worth
 * three points.
 *
 * THE GEOMETRY (all of it derived per frame from the live cluster — nothing here
 * is chosen, everything is measured):
 *
 *   cluster   = every man bound in the breakdown roster (`bd.players`: carrier,
 *               tackler, the clearout crew, the jackal and its counters).
 *   gate width   W = the lateral bounds of that cluster, [-W/2, +W/2] about the
 *                  cluster's x-centre, widened by a shoulder margin so a man
 *                  running a straight line at the pile is not judged for the
 *                  width of his own kit.
 *   gate depth   the corridor's FRONT edge is the hindmost foot of his OWN
 *                  team's bound players (Law 15.15: each side's line runs
 *                  through that side's own rear foot, and it moves as that foot
 *                  moves); the corridor is the half-plane behind that line, so
 *                  an entrant crossing the band anywhere behind it has passed
 *                  through the gate.
 *   volume     = the contest box: the cluster bounds expanded by the same
 *                  shoulder margin, in x AND z. "Entering the breakdown" means
 *                  crossing from outside the volume to inside it.
 *
 * THE TEST
 *
 *   A player who is NOT part of the contest and who crosses into the volume
 *   while never having occupied his own team's corridor since the ruck formed
 *   entered from outside the gate. SIDE ENTRY.
 *
 * An entrant who is already inside his corridor when the volume boundary breaks
 * is legal — and because the corridor carries the volume's own x-buffer, the
 * only way a man can be inside the volume, behind his own hindmost foot, and
 * outside his corridor is if he got there by coming AROUND the side in front of
 * the gate plane. That is precisely the offence; the corridor test is not an
 * extra hurdle a straight runner trips over.
 *
 * ARCHITECTURE. This module is pure, exactly like `engine/offside.ts`: it takes
 * state in and returns a decision out; it never moves a player, never touches a
 * ragdoll velocity, and never writes the Director. The Director owns the whistle
 * (`enforceRuckEntryGates`), the freeze and the restart — see the note there on
 * why the observation runs after the physics/kinematics update and before the
 * formation is steered. The referee is an observer, not an engine.
 *
 * THE WINDOW. Observation is live only while the ruck exists as a ruck: from
 * `ruckFormed` (the PLACE→RUCK transition, where the pile is declared) to the
 * moment the ball leaves it (`RECYCLE`). During PLACE the men are still
 * arriving from the tackle itself — the assembly is not an entry offence;
 * after the ball is out the offside engine's moving lines take the law from
 * here, and a gate frozen at the last ruck foot would invent offences that
 * belong to Law 11's reset, not Law 15's entry.
 *
 * WHO IS EXEMPT, and why every exemption is a law rather than a mercy:
 *   - anyone in the contest roster — he IS the gate; the plane is drawn from
 *     his feet, and a man cannot be offside against his own position;
 *   - the controlled scrum-half at the base (Law 15.12: the halfback at the
 *     ruck may play the ball from any side);
 *   - a man on the ground or climbing off it (`down`, `recoverT`) — he cannot
 *     choose his entry vector and the referee does not blow at a body that is
 *     already part of the pile;
 *   - a man serving the sin-bin, who is not on the field of play at all.
 *
 * ONE WHISTLE, ONE RUCK, ONE TEAM — the ledger latches per team per ruck serial
 * so a drifting pile cannot farm a sequence of penalties from one crime, in the
 * same spirit as `OffsideLedger`'s per-window latch.
 */

import type { BreakdownState } from '../director';
import type { Live } from '../intelligence';

/** A team's attacking axis: σ = +1 for A (attack toward +z), −1 for B. */
const sigmaOf = (team: 'A' | 'B'): -1 | 1 => (team === 'A' ? 1 : -1);

/**
 * The call text. It starts with 'PENALTY' so the sanction ledger
 * (`engine/laws.ts`) reads it as a penalty rather than a restart — which is
 * what Law 15 says a no-side entry is.
 */
export const SIDE_ENTRY_CALL = 'PENALTY — OFFSIDE / SIDE ENTRY AT RUCK';
/** The `lawCall` key for the hint ledger. */
export const SIDE_ENTRY_KEY = 'RUCK_SIDE_ENTRY';

/**
 * The shoulder margin, in metres. The gate spans the cluster's bounds; a man
 * is a body with width, and the entry vector should be measured from his
 * centre against the contest box with a body's worth of grace. 0.6 m is half
 * a `size`-scaled kit plus the stride a converging player cannot help taking.
 */
export const GATE_SHOULDER_M = 0.6;

/**
 * How far IN FRONT of the gate plane a flagged entrant has to be for the
 * whistle. The toe across the line while the whole pile is still shifting is
 * not a crime; 0.25 m is that toe.
 */
export const GATE_LINE_EPS_M = 0.25;

/**
 * THE WHISTLE'S TEMPER, in the house's STRICT/LENIENT/OFF tradition — and
 * calibrated the same way SPEC_12's was: against what THIS engine's AI
 * actually commits, not against what the law text literally permits.
 *
 * `blowPenetrationM` is how far in front of his own hindmost-foot plane an
 * entrant must be at the entry frame for the shipped referee to blow. At 0
 * every toe-in from a mid-ruck height gets three points — measured, that is
 * five whistles a MINUTE here, because the engine's breakdown choreography
 * routes cleaners around the pile instead of through the gate, and a referee
 * who blew on all of them would stop a third of the rucks. Real officials
 * play on the marginal side-run (the man who is a metre off the gate and
 * never touches the contest), and blow on the man who comes in off it AND
 * is in the pile — which, in this engine, is a man two or more metres in
 * front of the plane: he is over the ball's side of the ruck, not beside it.
 * STRICT is the diagnostic temper (blow on any material entry) and is what
 * the law's own words describe; LENIENT is the game.
 */
export interface GateProfile {
  /** metres in front of the own-team plane required for the whistle */
  blowPenetrationM: number;
  /** false = observe, count and prove the law, never blow (the OFF dial) */
  blows: boolean;
}

export const GATE_STRICTNESS: Record<'STRICT' | 'LENIENT', GateProfile> = {
  STRICT: { blowPenetrationM: GATE_LINE_EPS_M, blows: true },
  LENIENT: { blowPenetrationM: 2.0, blows: true },
};
/** The shipped referee is LENIENT, like every other law in the engine. */
export const RUCK_GATE_PROFILE: GateProfile = GATE_STRICTNESS.LENIENT;

/**
 * The settle window, in engine seconds. A ruck is DECLARED a beat before its
 * choreography has delivered the bodies: the first half-second after formation
 * is the tackle's own momentum arriving, and the referee does not blow at a
 * man who is still completing the action he legally started. Same reasoning
 * as `OffsideLedger`'s settle grace, sized to this phase's clock.
 */
export const GATE_SETTLE_S = 0.5;

/**
 * Does the flag earn the whistle? Pure, so a probe can interrogate the
 * temper without a Director.
 */
export function gateBlows(p: GateProfile, penetration: number, settled: boolean): boolean {
  return p.blows && settled && penetration >= p.blowPenetrationM;
}

/** A point sample the gate math needs. `Live` satisfies it; so can a probe. */
export interface GatePoint { team: 'A' | 'B'; x: number; z: number }

/**
 * One team's entry corridor at one frame.
 *
 * `cx` and `halfW` are the lateral bounds; `planeZ` is the hindmost foot of
 * THIS team's bound players, and `dir` is the axis in which "behind" lives:
 * a point is behind the plane when `(z − planeZ) · dir ≤ 0`, the same
 * penetration convention the offside engine uses. A missing team line (null)
 * means that team has nobody in the contest: no gate, so no gate offence.
 */
export interface RuckGate {
  team: 'A' | 'B';
  cx: number;
  halfW: number;
  planeZ: number;
  dir: -1 | 1;
}

/** The contest box the gate is set into. */
export interface BreakdownVolume {
  minX: number; maxX: number;
  minZ: number; maxZ: number;
}

export interface RuckGateGeometry {
  volume: BreakdownVolume;
  gates: { A: RuckGate | null; B: RuckGate | null };
}

/**
 * The whole of the geometry, from the cluster. Pure arithmetic over the
 * roster's live positions; called once per frame per ruck.
 */
export function ruckGateGeometry(cluster: readonly GatePoint[]): RuckGateGeometry | null {
  if (cluster.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const zOf: Record<'A' | 'B', number[]> = { A: [], B: [] };
  for (const q of cluster) {
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.z < minZ) minZ = q.z;
    if (q.z > maxZ) maxZ = q.z;
    zOf[q.team].push(q.z);
  }
  const cx = (minX + maxX) / 2;
  // The gate width spans the lateral bounds of the contact cluster.
  const halfW = Math.max(1.0, (maxX - minX) / 2) + GATE_SHOULDER_M;
  const gates: RuckGateGeometry['gates'] = { A: null, B: null };
  for (const team of ['A', 'B'] as const) {
    const zs = zOf[team];
    if (!zs.length) continue;
    const sig = sigmaOf(team);
    // Hindmost foot of THIS team: the smallest z along this team's own axis.
    let hind = zs[0];
    for (const z of zs) if (z * sig < hind * sig) hind = z;
    gates[team] = { team, cx, halfW, planeZ: hind, dir: sig };
  }
  return {
    volume: {
      minX: minX - GATE_SHOULDER_M, maxX: maxX + GATE_SHOULDER_M,
      minZ: minZ - GATE_SHOULDER_M, maxZ: maxZ + GATE_SHOULDER_M,
    },
    gates,
  };
}

/** Metres in FRONT of the team's gate plane. ≤ 0 is behind it (legal ground). */
export function gatePenetration(p: GatePoint, g: RuckGate): number {
  return (p.z - g.planeZ) * g.dir;
}

/** True when the point is inside the contest box. */
export function insideVolume(v: BreakdownVolume, p: GatePoint): boolean {
  return p.x >= v.minX && p.x <= v.maxX && p.z >= v.minZ && p.z <= v.maxZ;
}

/**
 * True when the point occupies the team's corridor: inside the (buffered)
 * lateral band, and no more than `eps` in front of the gate plane. The eps
 * belongs to the corridor, not the volume: the referee's grace is on the
 * question "did he come through the back of the gate", and a half-stride of
 * toe-over-the-line while entering from behind is still entering through the
 * gate.
 */
export function inCorridor(g: RuckGate, p: GatePoint, eps = GATE_LINE_EPS_M): boolean {
  return Math.abs(p.x - g.cx) <= g.halfW && gatePenetration(p, g) <= eps;
}

/* ================================ THE LEDGER ================================ */

interface TrackRow {
  /** inside the volume on the previous frame — entrants only; residents are
   *  the pile's own geography, not a crime in progress */
  inVol: boolean;
  /** has he stood in his own corridor at all since the ruck formed */
  passedGate: boolean;
}

/**
 * Per-ruck, per-player memory. The serial is the breakdown instance — the
 * Director mints it from the `bd` object it owns — and a new serial wipes the
 * board: the next tackle is a new gate, drawn from new feet.
 */
export class RuckGateLedger {
  private serial = -1;
  private readonly rows = new Map<string, TrackRow>();
  /** one whistle per team per ruck — the latch offside uses, for the same why */
  private readonly penalised = new Set<'A' | 'B'>();

  /** Sync to the ruck being observed. A new (or negative) serial resets. */
  begin(serial: number) {
    if (serial === this.serial) return;
    this.serial = serial;
    this.rows.clear();
    this.penalised.clear();
  }

  /** Play is over the ruck (ball out, whistle, try): the memory is dead. */
  end() {
    if (this.serial < 0) return;
    this.serial = -1;
    this.rows.clear();
    this.penalised.clear();
  }

  active(): boolean { return this.serial >= 0; }

  /**
   * One frame of observation. The caller hands it the whole live roster and
   * the eligibility record; the filter runs IN the loop — building a
   * candidate array per frame in a phase that lasts a second and a half at
   * sixty frames is allocation the referee's budget does not have. It hands
   * back the FIRST side-entry violation this frame, or null. It writes
   * nothing — not to a player, not to the Director.
   */
  observe(
    geo: RuckGateGeometry,
    live: readonly Live[],
    el: GateEligibility,
  ): { player: Live; gate: RuckGate; penetration: number } | null {
    if (this.serial < 0) return null;
    for (const p of live) {
      if (this.penalised.has(p.team)) continue;
      if (!gateEligible(p, el)) continue;
      const gate = geo.gates[p.team];
      // No gate for a team with nobody in the contest: no gate, no offence.
      if (!gate) continue;
      const id = `${p.team}:${p.num}`;
      let row = this.rows.get(id);
      if (!row) {
        // A man already inside the pile when the window opens is geography,
        // not an entrant; seed him resident so he can only ever "enter" again
        // by leaving first.
        row = { inVol: insideVolume(geo.volume, p), passedGate: false };
        if (inCorridor(gate, p)) row.passedGate = true;
        this.rows.set(id, row);
        continue;
      }
      const inNow = insideVolume(geo.volume, p);
      if (inCorridor(gate, p)) row.passedGate = true;
      const entered = inNow && !row.inVol;
      row.inVol = inNow;
      if (!entered || row.passedGate) continue;
      // He crossed into the contest box having never stood in his own corridor
      // since the ruck formed. Side entry.
      return { player: p, gate, penetration: gatePenetration(p, gate) };
    }
    return null;
  }

  markPenalised(team: 'A' | 'B') { this.penalised.add(team); }
}

/* ================================ ELIGIBILITY ================================ */

/**
 * The men the gate can lawfully ask. Structural, so the Director's caller and
 * a headless probe feed it the same predicate.
 */
export interface GateEligibility {
  /** roster membership — the contest, as `team:num` */
  roster: ReadonlySet<string>;
  /** the controlled scrum-half at the base: `team:num`, or '' */
  halfback: string;
}

/** The ruck roster: bd.players plus the crew lists, as `team:num` keys. */
export function ruckGateRoster(bd: BreakdownState): Set<string> {
  const roster = new Set<string>();
  const def: 'A' | 'B' = bd.attacking === 'A' ? 'B' : 'A';
  for (const q of bd.players) roster.add(`${q.team}:${q.num}`);
  for (const n of bd.crew) roster.add(`${bd.attacking}:${n}`);
  for (const n of bd.defCrew) roster.add(`${def}:${n}`);
  return roster;
}

export function gateEligible(p: Live, el: GateEligibility): boolean {
  if (el.roster.has(`${p.team}:${p.num}`)) return false;   // he IS the contest
  if (p.carrier || p.bound || p.down || (p.recoverT ?? 0) > 0) return false;
  if (p.sinbin > 0) return false;
  if (`${p.team}:${p.num}` === el.halfback) return false;   // Law 15.12
  return true;
}

/* ================================ THE WINDOW ================================ */

/**
 * Is the gate live on this breakdown right now? The ruck exists as a contest,
 * with a gate to break, from the PLACE→RUCK transition until the ball leaves
 * it. See the header for why neither earlier (assembly) nor later (the moving
 * lines own RECYCLE).
 */
export function ruckGateWindow(bd: BreakdownState): boolean {
  return bd.ruckFormed && bd.stage === 'RUCK';
}

/**
 * The cluster: the LIVE positions of the contest roster (falling back to the
 * roster's own sampled x/z when a man has no live body, which happens in a
 * headless probe but never in a match).
 */
export function ruckClusterOf(bd: BreakdownState, live: readonly Live[]): GatePoint[] {
  const roster = ruckGateRoster(bd);
  const out: GatePoint[] = [];
  for (const p of live) if (roster.has(`${p.team}:${p.num}`)) out.push({ team: p.team, x: p.x, z: p.z });
  if (!out.length) for (const q of bd.players) out.push({ team: q.team, x: q.x, z: q.z });
  return out;
}
