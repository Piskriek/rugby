/**
 * FORWARD PACK — THE POSITIONAL BEHAVIOUR TREES FOR SHIRTS 1–8.
 *
 * The positional dataset (`behaviour/pos-01..08.ts`) answers WHERE a forward
 * stands in one of twenty authored situations. It is drawn around a ball in
 * open play, and it goes quiet the moment the referee's ruck window opens —
 * `situationOf()` returns null for a BREAKDOWN — so until now the eight
 * forwards who were not named in the ruck crew were steered at their OPEN
 * PLAY shape marks straight through the pile. The referee module
 * (`engine/gates.ts`) measured the result: forwards entering the contest box
 * from the side, two and three metres in front of their own hindmost foot,
 * wearing jobs like "RUN THE TIP LINE".
 *
 * This module is the missing layer: a small, explicit decision tree per
 * forward shirt, evaluated every frame the man is free (not bound, not down,
 * not in the ruck roster), plus the one rule every branch is subject to —
 *
 *   A FORWARD WHOSE PATH WOULD TAKE HIM INTO AN ACTIVE RUCK STEERS TO HIS
 *   TEAM'S ENTRY GATE FIRST. `routeThroughGate()` reads the canonical gate
 *   geometry the referee will judge him by (`ruckGateGeometry`) and, if the
 *   mark is inside the contest volume or the straight line to it crosses the
 *   volume, replaces the mark with a waypoint BEHIND his own hindmost-foot
 *   plane and INSIDE the lateral band. Once he has stood there the ledger
 *   records him as having passed the gate and the tree's mark is restored.
 *
 * THE TREES (a selector: the first node whose `when` holds gives the mark;
 * a null result means "keep the mark the dataset/shape wrote"):
 *
 *   FRONT ROW 1 · 2 · 3
 *     attack  ruck live → short carry pod one pass off the 9 (3 tight, 2 the
 *             tip-on hub, 1 wide), never through the pile; open play with the
 *             9/10 carrying → the pod is clamped within a pass of the ball.
 *     defence → the line, gate-routed (the channel map already owns the
 *             pillar/guard spacing; nothing here re-authors it).
 *
 *   SECOND ROW 4 · 5
 *     attack  ruck live → HIGH-INERTIA ARRIVAL at the gate mouth, inside the
 *             corridor, planted behind the hindmost foot: the anchor of the
 *             ruck. Arrive at full pace, then plant (urgency collapses) so the
 *             mass reads as weight, not a hover.
 *     defence ruck live → the guards either side of the pillar, ON the
 *             hindmost-foot line, extending it laterally: the line's anchors.
 *
 *   BACK ROW 6 · 7 · 8
 *     7  defence: PRIMARY JACKAL. A loose ball on the deck → hunt it. A
 *        carrier being held (the latch) → run to the DEFENCE gate of the
 *        ruck-to-be so he is over the ball, legally, the frame it forms.
 *        Ruck formed and he is not in it → the openside post.
 *     6  defence: BLINDSIDE DEFENDER — pillar on the short side of the ruck,
 *        and in open play the anchor of the line on the touchline side.
 *        attack: holds the short side as the blind carry option.
 *     8  attack: the BASE — pick-and-go option a stride behind the hindmost
 *        foot on the side the 9 is not; in open play he LINKS with the 9
 *        (a 9 carrying always has the 8 on his hip).
 *
 * PURE. Nothing here reads or writes a `Live`, a `Director` or a ledger. The
 * caller (Director.think) builds a `PackContext` snapshot, asks for a mark,
 * routes it through the gate and owns the write — the T-02 ownership contract
 * exactly as every other mark source obeys it.
 */

import {
  RuckGateGeometry, RuckGate, BreakdownVolume, GatePoint,
  insideVolume, inCorridor, gatePenetration, GATE_LINE_EPS_M,
} from './gates';

/* ================================ TYPES ================================ */

export type PackPhase = 'OPEN_PLAY' | 'BREAKDOWN';

/** A world point. */
export interface Pt { x: number; z: number }

/** What a forward's tree may return: a mark, how hard to run at it, the job. */
export interface PackMark {
  x: number;
  z: number;
  urgency: number;
  job: string;
  /** metres from the mark inside which the man PLANTS (urgency collapses to
   *  `plantUrgency`) — the high-inertia arrival. 0 = never plants. */
  plantM?: number;
  plantUrgency?: number;
  /** the tree node that produced this mark, for telemetry and the probe */
  node: string;
}

/**
 * The snapshot a tree reads. Built by the Director per forward per frame;
 * every field is a plain number or a plain object so a probe can construct
 * one without a match.
 */
export interface PackContext {
  phase: PackPhase;
  team: 'A' | 'B';
  /** the side in possession (bd.attacking during a ruck, op.attacking in open play) */
  attacking: 'A' | 'B';
  /** attacking axis of the side in possession: +1 toward +z */
  dir: 1 | -1;
  /** this man's own attacking axis */
  sigma: 1 | -1;
  /** where he is */
  p: Pt;
  /** the ball / contact point the formation is anchored on */
  ball: Pt;
  /** the mark the dataset / shape already wrote for him */
  mark: Pt;
  /** the ruck geometry when there is a ruck, else null */
  geo: RuckGateGeometry | null;
  /** breakdown stage, '' outside a ruck */
  stage: string;
  ruckFormed: boolean;
  /** he is in the ruck roster (the caller should not be asking, but be safe) */
  inRoster: boolean;
  /** a loose ball on the deck, or null */
  loose: Pt | null;
  /** open play: the carrier's shirt and position (null in a ruck) */
  carrier: { num: number; x: number; z: number } | null;
  /** open play: the carrier is being held — a tackle is about to become a ruck */
  latched: boolean;
  /** he has been named a converger / cover chaser this frame — leave him to it */
  busy: boolean;
  /** metres from the ball to the try line being attacked */
  toLine: number;
}

/* ============================== CONSTANTS ============================== */

/** Metres behind his own hindmost-foot plane the gate waypoint sits. Inside
 *  the corridor by a comfortable margin (the corridor's own grace is 0.25 m
 *  in FRONT of the plane), and short enough that the detour is a stride. */
export const GATE_APPROACH_M = 0.9;
/** Lateral shoulder kept off the corridor's edge so a man sent to the gate
 *  is unambiguously inside the band, not balanced on its line. */
export const GATE_BAND_SHOULDER_M = 0.35;
/** Segment samples used to test whether a straight run crosses the volume. */
const PATH_SAMPLES = 10;

/** The pod lateral offsets OUTSIDE THE BOX'S EDGE, one pass off the 9:
 *  3 tight, 2 the hub, 1 wide. */
export const FRONT_ROW_POD_LATERAL: Record<number, number> = { 3: 0.6, 2: 2.0, 1: 3.4 };
/** Pod depth behind the safe line: a stride, so the carry is flat and short. */
export const FRONT_ROW_POD_DEPTH_M = 0.8;
/** Open play: the widest the pod may drift from a 9/10 carrier before it is
 *  no longer a short carry option. */
export const FRONT_ROW_POD_MAX_LATERAL_M = 8;

/** Locks plant this far from the anchor mark, and this is the urgency they
 *  hold at — weight, not a hover. */
export const LOCK_PLANT_M = 1.3;
export const LOCK_PLANT_URGENCY = 0.3;
/** Lateral seat of each lock either side of the gate axis, metres. */
export const LOCK_ANCHOR_LATERAL_M = 0.55;
/** Defensive guards (the locks) extend the hindmost-foot line to here,
 *  outside the box's edge. */
export const LOCK_GUARD_LATERAL_M = 0.6;
/** The defensive guard line: Law 16's hindmost foot, at the distance the
 *  breakdown physics already walks the line back to (breakdown.ts defLine). */
export const DEF_GUARD_LINE_M = 3.0;

/** The 7 hunts a loose ball from this far; beyond it, the line matters more. */
export const JACKAL_HUNT_RADIUS_M = 14;
/** Where the jackal wants to be when the ruck forms: on the defence gate. */
export const JACKAL_LATCH_LEAD_M = 1.6;
/** Open play: the 6 anchors the blindside once the ball is this far off centre. */
export const BLINDSIDE_ANCHOR_FROM_X_M = 10;
export const BLINDSIDE_ANCHOR_LATERAL_M = 3.2;

/** The 8's link on the 9: on the hip, a stride behind, on the blind side. */
export const EIGHT_LINK_LATERAL_M = 1.4;
export const EIGHT_LINK_DEPTH_M = 1.3;

/* ================================ HELPERS ================================ */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** The touchline the ball is nearer: +1 for +x. The BLIND side. */
export function blindSign(ballX: number): 1 | -1 {
  return ballX >= 0 ? 1 : -1;
}

/** True when the straight run from `a` to `b` passes through the box. */
export function segmentCrossesVolume(a: Pt, b: Pt, v: BreakdownVolume): boolean {
  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const u = i / PATH_SAMPLES;
    const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
    if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ) return true;
  }
  return false;
}

/**
 * The entry waypoint for a team's gate: behind the plane, inside the band,
 * at the lateral position nearest the man (so the detour is the shortest
 * legal one) plus an optional bias so several men do not stack on one spot.
 */
export function gateWaypoint(g: RuckGate, p: Pt, lateralBias = 0): Pt {
  const band = Math.max(0.2, g.halfW - GATE_BAND_SHOULDER_M);
  return {
    x: clamp(p.x + lateralBias, g.cx - band, g.cx + band),
    z: g.planeZ - g.dir * GATE_APPROACH_M,
  };
}

/** The z of a point `back` metres behind a team's plane (positive = legal side). */
export function behindPlane(g: RuckGate, back: number): number {
  return g.planeZ - g.dir * back;
}

/** The lateral clearance a man keeps off the contest box when going round it. */
export const FLANK_CLEARANCE_M = 1.2;
/** The margin the box is grown by for the "would my run cross it" test — a
 *  graze is a side entry once the pile drifts a stride. */
export const CROSS_MARGIN_M = 0.3;
/** Seconds of the man's current velocity added to his position before the
 *  crossing test: a prop at 5 m/s cannot stop in a frame, so the question is
 *  asked of where he will be, not where he is. */
export const LOOKAHEAD_S = 0.35;
/** Half the field's width a routed waypoint may use (touch is at 35). */
export const ROUTE_FIELD_HALF_M = 34.2;
/** A waypoint is reached inside this radius; the planner hands out the next. */
const WAYPOINT_REACHED_M = 0.4;
/** Metres a leg's mark is placed beyond its waypoint so the steer does not
 *  ramp down onto it (see the flank leg). */
export const LEG_OVERSHOOT_M = 1.4;

export type GateLeg = 'none' | 'exit' | 'flank' | 'back' | 'gate';

function grow(v: BreakdownVolume, m: number): BreakdownVolume {
  return { minX: v.minX - m, maxX: v.maxX + m, minZ: v.minZ - m, maxZ: v.maxZ + m };
}

/**
 * The entry point proper: behind the plane by GATE_APPROACH_M, and behind
 * the box's back edge by a half-stride — whichever is further back — so the
 * last leg in from the flank runs clear of the box.
 */
export function gateEntry(g: RuckGate, v: BreakdownVolume, p: Pt, lateralBias = 0): Pt {
  const w = gateWaypoint(g, p, lateralBias);
  const back = (g.dir > 0 ? v.minZ : v.maxZ) - g.dir * (CROSS_MARGIN_M + 0.3);
  const z = g.dir > 0 ? Math.min(w.z, back) : Math.max(w.z, back);
  return { x: w.x, z };
}

/**
 * THE GATE RULE. Given a man, his velocity, his intended mark and the ruck
 * geometry, the mark he must actually steer to this frame.
 *
 *   - no gate for his team (nobody of his in the contest) → the mark stands;
 *   - he has already passed through the gate this ruck → the mark stands;
 *   - he is already inside his corridor → the mark stands (he is passing now);
 *   - he is INSIDE the box without having come through the gate → EXIT: the
 *     nearest in-field side edge, purely lateral;
 *   - the mark is outside the box and neither his run to it nor his next
 *     LOOKAHEAD_S of momentum crosses the (grown) box → the mark stands;
 *   - otherwise he is planned AROUND the box to the gate entry point, via
 *     the flank (left or right, whichever is shorter and in the field):
 *       flank  out to the flank line at his own z;
 *       back   along the flank to the entry point's z;
 *       gate   in through the gate mouth.
 *     The first waypoint not yet reached is the mark.
 *
 * The distinction matters because the naive rule — "aim at the gate mouth" —
 * sends a man standing in front of the pile straight through it to reach a
 * point behind it, which is the offence with a better job string. `passed` is
 * the ledger's memory for this man on this ruck (`RuckGateLedger.hasPassed`).
 */
export function routeThroughGate(
  team: 'A' | 'B', p: Pt, mark: Pt, geo: RuckGateGeometry | null, passed: boolean,
  lateralBias = 0, vel: Pt = { x: 0, z: 0 },
): { mark: Pt; routed: boolean; leg: GateLeg } {
  if (!geo) return { mark, routed: false, leg: 'none' };
  const g = geo.gates[team];
  if (!g || passed) return { mark, routed: false, leg: 'none' };
  const gp: GatePoint = { team, x: p.x, z: p.z };
  if (inCorridor(g, gp)) return { mark, routed: false, leg: 'none' };
  const v = geo.volume;
  const cx = (v.minX + v.maxX) / 2;
  const flankL = v.minX - FLANK_CLEARANCE_M, flankR = v.maxX + FLANK_CLEARANCE_M;
  /* a flank is usable when there is a stride of grass beyond it: a pile
   * pinned against touch leaves no lane on that side, and a man sent down
   * it is squeezed between the box's next breath and the line */
  const okL = flankL - LEG_OVERSHOOT_M * 0.5 > -ROUTE_FIELD_HALF_M;
  const okR = flankR + LEG_OVERSHOOT_M * 0.5 < ROUTE_FIELD_HALF_M;

  if (insideVolume(v, gp)) {
    /* a resident who is not through the gate: the shortest lawful exit is
     * sideways, to whichever flank is in the field */
    const side: 1 | -1 = !okL ? 1 : !okR ? -1 : p.x >= cx ? 1 : -1;
    return { mark: { x: side > 0 ? flankR : flankL, z: p.z }, routed: true, leg: 'exit' };
  }

  const test = grow(v, CROSS_MARGIN_M);
  const ahead = { x: p.x + vel.x * LOOKAHEAD_S, z: p.z + vel.z * LOOKAHEAD_S };
  const markInside = insideVolume(test, { team, x: mark.x, z: mark.z });
  /* ENTERING: in front of his own plane, within a flank's width of the box,
   * bound for a mark behind the plane. He is joining, and a joiner comes
   * through the gate — even when the straight line to his mark happens to
   * clip past the box's corner (that line crosses the plane OUTSIDE the
   * corridor, which is the side entry in all but the ledger's name). */
  const pen = gatePenetration(gp, g);
  const markBehind = (mark.z - g.planeZ) * g.dir <= 0;
  const nearBox = Math.abs(p.x - cx) <= (v.maxX - v.minX) / 2 + FLANK_CLEARANCE_M + LEG_OVERSHOOT_M;
  const entering = pen > -GATE_APPROACH_M * 0.5 && markBehind && nearBox;
  if (!entering && !markInside && !segmentCrossesVolume(p, mark, test) && !segmentCrossesVolume(p, ahead, test)) {
    return { mark, routed: false, leg: 'none' };
  }

  const entry = gateEntry(g, v, p, lateralBias);
  /* behind the plane AND the straight run to the entry point is clear: in */
  if (pen <= -GATE_APPROACH_M * 0.5 && !segmentCrossesVolume(p, entry, test)) {
    return { mark: entry, routed: true, leg: 'gate' };
  }

  /* plan around: p → (flank, p.z) → (flank, entry.z) → entry, per side.
   * The first leg is sideways — but a man skimming the box's far edge (he
   * was the tackler, or the pile drifted onto him) is given a half-stride of
   * z clearance too, or the pile's next drift swallows him mid-step. */
  const skim = CROSS_MARGIN_M + 0.4;
  let legZ = p.z;
  if (p.z >= v.maxZ - 0.05 && p.z < v.maxZ + skim) legZ = v.maxZ + skim;
  else if (p.z <= v.minZ + 0.05 && p.z > v.minZ - skim) legZ = v.minZ - skim;
  const plan = (flankX: number) => {
    const w1 = { x: flankX, z: legZ }, w2 = { x: flankX, z: entry.z };
    const cost = Math.hypot(w1.x - p.x, w1.z - p.z) + Math.abs(w2.z - w1.z) + Math.hypot(entry.x - w2.x, entry.z - w2.z);
    return { w1, w2, cost };
  };
  const cands: ReturnType<typeof plan>[] = [];
  if (okL) cands.push(plan(flankL));
  if (okR) cands.push(plan(flankR));
  if (!cands.length) return { mark: entry, routed: true, leg: 'gate' };
  const best = cands.sort((a, b) => a.cost - b.cost)[0];
  const atFlank = Math.abs(p.x - best.w1.x) <= WAYPOINT_REACHED_M
    || (best.w1.x > cx ? p.x > best.w1.x - WAYPOINT_REACHED_M : p.x < best.w1.x + WAYPOINT_REACHED_M);
  /* Every leg's mark is OVERSHOT by a stride beyond its waypoint: the steer
   * ramps its speed down inside 2.4 m of a mark, and a man crawling beside a
   * pile that breathes by metres a second (the cluster is the live roster,
   * arriving crew included) is a man the pile swallows. The leg is complete
   * when he crosses the waypoint's line, not when he reaches the mark. */
  const outSign = best.w1.x > cx ? 1 : -1;
  const overX = clamp(best.w1.x + outSign * LEG_OVERSHOOT_M, -ROUTE_FIELD_HALF_M, ROUTE_FIELD_HALF_M);
  if (!atFlank) {
    /* the flank leg: aim as far ALONG the flank toward the back waypoint as
     * a straight run allows without grazing the box */
    for (const k of [0.6, 0.35, 0.15]) {
      const m = { x: overX, z: best.w1.z + (best.w2.z - best.w1.z) * k };
      if (!segmentCrossesVolume(p, m, test)) return { mark: m, routed: true, leg: 'flank' };
    }
    return { mark: { x: overX, z: best.w1.z }, routed: true, leg: 'flank' };
  }
  const atBack = Math.abs(p.z - best.w2.z) <= WAYPOINT_REACHED_M
    || (g.dir > 0 ? p.z < best.w2.z + WAYPOINT_REACHED_M : p.z > best.w2.z - WAYPOINT_REACHED_M);
  if (!atBack) return { mark: { x: overX, z: best.w2.z - g.dir * LEG_OVERSHOOT_M }, routed: true, leg: 'back' };
  return { mark: entry, routed: true, leg: 'gate' };
}

/** Metres a point sits in front of a team's plane (the referee's own read). */
export function penetrationFor(team: 'A' | 'B', p: Pt, geo: RuckGateGeometry): number | null {
  const g = geo.gates[team];
  return g ? gatePenetration({ team, x: p.x, z: p.z }, g) : null;
}

/** Is the point a lawful place to stand at this ruck for this team? */
export function isLegalStanding(team: 'A' | 'B', p: Pt, geo: RuckGateGeometry): boolean {
  const g = geo.gates[team];
  if (!g) return true;
  const pen = gatePenetration({ team, x: p.x, z: p.z }, g);
  // behind the plane is always lawful; in front of it only outside the volume
  return pen <= GATE_LINE_EPS_M || !insideVolume(geo.volume, { team, x: p.x, z: p.z });
}

/* ============================ THE RUCK FRAME ============================ */

/**
 * The geometry every ruck node reads: the contest's lateral centre and
 * half-width, the attacking axis, the blind/open signs, each side's safe
 * ground. Falls back to a stride-wide box on the ball when there is no
 * geometry yet (no gate — but the line still has a hindmost foot).
 *
 * Every attacking mark is authored from `atkBackZ` — BEHIND both the
 * attack's own plane and the back edge of the box — and laterally from the
 * box's EDGE, not its centre: a mark drawn from the centre is swallowed the
 * moment the pile drifts half a metre, which is a side entry with a better
 * job string.
 */
interface RuckFrame {
  cx: number; cz: number; halfW: number;
  fwd: 1 | -1;
  blind: 1 | -1; open: 1 | -1;
  /** the z (along fwd) behind which an attacker is both behind his plane and
   *  clear of the box */
  atkBackZ: number;
  /** Law 16's defensive line */
  defGuardZ: number;
}

function ruckFrame(c: PackContext): RuckFrame {
  const fwd = c.dir;
  const v = c.geo?.volume ?? null;
  const cx = v ? (v.minX + v.maxX) / 2 : c.ball.x;
  const halfW = v ? (v.maxX - v.minX) / 2 : 1.6;
  const cz = c.ball.z;
  const atkGate = c.geo?.gates[c.attacking] ?? null;
  const planeBack = atkGate ? atkGate.planeZ - fwd * GATE_APPROACH_M : cz - fwd * (1.0 + GATE_APPROACH_M);
  const boxBack = v ? (fwd > 0 ? v.minZ : v.maxZ) - fwd * 0.5 : cz - fwd * 2.0;
  const atkBackZ = fwd > 0 ? Math.min(planeBack, boxBack) : Math.max(planeBack, boxBack);
  const blind = blindSign(cx);
  /* the defensive line: Law 16's three metres, or further if the defence's
   * own hindmost foot / the box's front edge has been pushed past it */
  const defGate = c.geo ? c.geo.gates[c.attacking === 'A' ? 'B' : 'A'] : null;
  const defPlane = defGate ? defGate.planeZ + fwd * GATE_APPROACH_M : cz + fwd * 1.0;
  const boxFront = v ? (fwd > 0 ? v.maxZ : v.minZ) + fwd * 0.5 : cz + fwd * 2.0;
  const law = cz + fwd * DEF_GUARD_LINE_M;
  const defGuardZ = fwd > 0 ? Math.max(law, defPlane, boxFront) : Math.min(law, defPlane, boxFront);
  return {
    cx, cz, halfW, fwd, blind, open: blind === 1 ? -1 : 1,
    atkBackZ,
    defGuardZ,
  };
}

/** A lateral seat `off` metres outside the box's edge on `side`. At a
 *  touchline ruck the short side may have no room at all, in which case the
 *  seat flips to the other side: a man authored into touch is a man the
 *  steer clamps back into the box. */
export const SEAT_FIELD_HALF_M = 33.4;
function offEdge(r: RuckFrame, side: 1 | -1, off: number): number {
  const x = r.cx + side * (r.halfW + FLANK_CLEARANCE_M + off);
  if (Math.abs(x) <= SEAT_FIELD_HALF_M) return x;
  return r.cx - side * (r.halfW + FLANK_CLEARANCE_M + off);
}

/* ================================ NODES ================================ */

export interface PackNode {
  name: string;
  when: (c: PackContext) => boolean;
  act: (c: PackContext) => PackMark | null;
}

const isAtk = (c: PackContext) => c.team === c.attacking;
const isDef = (c: PackContext) => c.team !== c.attacking;
const ruckLive = (c: PackContext) => c.phase === 'BREAKDOWN' && !c.inRoster
  && (c.stage === 'CONTACT' || c.stage === 'PLACE' || c.stage === 'RUCK');
const nineOrTenCarries = (c: PackContext) => c.phase === 'OPEN_PLAY' && !!c.carrier
  && (c.carrier.num === 9 || c.carrier.num === 10);

/* ---- FRONT ROW: the short carry pod ---- */

function podNode(num: number): PackNode[] {
  const lat = FRONT_ROW_POD_LATERAL[num];
  const name = num === 1 ? 'LOOSEHEAD' : num === 2 ? 'HOOKER' : 'TIGHTHEAD';
  return [
    {
      name: `${name}: ruck pod one pass off the 9`,
      when: (c) => isAtk(c) && ruckLive(c),
      act: (c) => {
        const r = ruckFrame(c);
        return {
          x: offEdge(r, r.open, lat),
          z: r.atkBackZ - r.fwd * FRONT_ROW_POD_DEPTH_M,
          urgency: 0.92,
          job: num === 2 ? 'HOOKER — POD HUB ONE PASS OFF 9, TIP OR CARRY' : `${name} — SHORT CARRY POD OFF 9, SQUARE AND LOW`,
          node: 'pod',
        };
      },
    },
    {
      name: `${name}: keep the pod within a pass of 9/10`,
      when: (c) => isAtk(c) && nineOrTenCarries(c) && !c.busy,
      act: (c) => {
        const car = c.carrier!;
        const dx = c.mark.x - car.x;
        if (Math.abs(dx) <= FRONT_ROW_POD_MAX_LATERAL_M) return null;   // the dataset's pod stands
        return {
          x: car.x + Math.sign(dx) * FRONT_ROW_POD_MAX_LATERAL_M,
          z: c.mark.z,
          urgency: 0.9,
          job: `${name} — SHORT CARRY POD OFF ${car.num}, HANDS UP`,
          node: 'pod-clamp',
        };
      },
    },
  ];
}

/* ---- SECOND ROW: the anchors ---- */

function lockNode(num: number): PackNode[] {
  const seat: 1 | -1 = num === 4 ? -1 : 1;   // 4 seats blind of the axis, 5 open
  const name = num === 4 ? 'BLINDSIDE LOCK' : 'OPENSIDE LOCK';
  return [
    {
      name: `${name}: high-inertia arrival, anchor the ruck`,
      when: (c) => isAtk(c) && ruckLive(c),
      act: (c) => {
        const r = ruckFrame(c);
        const side = seat === -1 ? r.blind : r.open;
        return {
          x: r.cx + side * Math.min(LOCK_ANCHOR_LATERAL_M, r.halfW * 0.5),
          z: r.atkBackZ,
          urgency: 1,
          plantM: LOCK_PLANT_M, plantUrgency: LOCK_PLANT_URGENCY,
          job: `${name} — THROUGH THE GATE, ANCHOR THE RUCK ON THE HINDMOST FOOT`,
          node: 'anchor',
        };
      },
    },
    {
      name: `${name}: guard — extend the hindmost-foot line`,
      when: (c) => isDef(c) && ruckLive(c) && c.ruckFormed,
      act: (c) => {
        const r = ruckFrame(c);
        const side = seat === -1 ? r.blind : r.open;
        return {
          x: offEdge(r, side, LOCK_GUARD_LATERAL_M),
          z: r.defGuardZ,
          urgency: 1,
          plantM: LOCK_PLANT_M, plantUrgency: LOCK_PLANT_URGENCY,
          job: `${name} — GUARD ON THE HINDMOST FOOT, EXTEND THE LINE`,
          node: 'guard',
        };
      },
    },
  ];
}

/* ---- BACK ROW ---- */

const BLINDSIDE: PackNode[] = [
  {
    name: 'BLINDSIDE: pillar the short side of the ruck',
    when: (c) => isDef(c) && ruckLive(c) && c.ruckFormed,
    act: (c) => {
      const r = ruckFrame(c);
      return {
        x: offEdge(r, r.blind, 0), z: r.defGuardZ, urgency: 1,
        plantM: 1.0, plantUrgency: 0.35,
        job: 'BLINDSIDE — PILLAR THE SHORT SIDE, ANCHOR THE LINE', node: 'pillar',
      };
    },
  },
  {
    name: 'BLINDSIDE: anchor the touchline side of the line',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && !c.busy && !c.loose
      && Math.abs(c.ball.x) > BLINDSIDE_ANCHOR_FROM_X_M,
    act: (c) => {
      const blind = blindSign(c.ball.x);
      return {
        x: c.ball.x + blind * BLINDSIDE_ANCHOR_LATERAL_M, z: c.mark.z, urgency: 0.9,
        job: 'BLINDSIDE — ANCHOR THE SHORT SIDE, NOTHING COMES BACK INSIDE', node: 'blind-anchor',
      };
    },
  },
  {
    name: 'BLINDSIDE: hold the short side as the blind carry option',
    when: (c) => isAtk(c) && ruckLive(c),
    act: (c) => {
      const r = ruckFrame(c);
      return {
        x: offEdge(r, r.blind, 1.2),
        z: r.atkBackZ - r.fwd * 0.6,
        urgency: 0.9,
        job: 'BLINDSIDE — HOLD THE SHORT SIDE, CARRY IF 9 GOES BLIND', node: 'blind-carry',
      };
    },
  },
];

const OPENSIDE: PackNode[] = [
  {
    name: 'OPENSIDE: hunt the loose ball',
    when: (c) => !!c.loose && Math.hypot(c.loose.x - c.p.x, c.loose.z - c.p.z) < JACKAL_HUNT_RADIUS_M,
    act: (c) => ({
      x: c.loose!.x, z: c.loose!.z, urgency: 1,
      job: 'OPENSIDE — LOOSE BALL, GET ON IT', node: 'hunt',
    }),
  },
  {
    name: 'OPENSIDE: the carrier is held — get to the defence gate',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && c.latched && !!c.carrier
      && Math.hypot(c.carrier.x - c.p.x, c.carrier.z - c.p.z) < JACKAL_HUNT_RADIUS_M,
    act: (c) => ({
      x: c.carrier!.x, z: c.carrier!.z + c.dir * JACKAL_LATCH_LEAD_M, urgency: 1,
      job: 'OPENSIDE — JACKAL, OVER THE BALL THROUGH THE GATE', node: 'jackal-approach',
    }),
  },
  {
    name: 'OPENSIDE: ruck not yet formed — through the gate to the ball',
    when: (c) => isDef(c) && ruckLive(c) && !c.ruckFormed,
    act: (c) => {
      const r = ruckFrame(c);
      const g = c.geo?.gates[c.team] ?? null;
      const at = g ? gateWaypoint(g, c.p) : { x: r.cx, z: r.cz + r.fwd * (1.6 + GATE_APPROACH_M) };
      return { ...at, urgency: 1, job: 'OPENSIDE — HUNT THE BALL, THROUGH THE GATE', node: 'jackal-gate' };
    },
  },
  {
    name: 'OPENSIDE: ruck formed — the openside post',
    when: (c) => isDef(c) && ruckLive(c) && c.ruckFormed,
    act: (c) => {
      const r = ruckFrame(c);
      return {
        x: offEdge(r, r.open, 0), z: r.defGuardZ, urgency: 1,
        job: 'OPENSIDE — POST, READ THE 9, FIRST TO THE NEXT TACKLE', node: 'post',
      };
    },
  },
  {
    name: 'OPENSIDE: attack — first support on the open side of the base',
    when: (c) => isAtk(c) && ruckLive(c),
    act: (c) => {
      const r = ruckFrame(c);
      return {
        x: offEdge(r, r.open, 0.8),
        z: r.atkBackZ - r.fwd * 2.0,
        urgency: 0.95,
        job: 'OPENSIDE — FIRST SUPPORT OFF THE BASE, RIDE THE NEXT CARRY', node: 'open-support',
      };
    },
  },
];

const EIGHT: PackNode[] = [
  {
    name: 'NUMBER 8: the base — pick and go or link with 9',
    when: (c) => isAtk(c) && ruckLive(c),
    act: (c) => {
      const r = ruckFrame(c);
      return {
        x: r.cx + r.blind * Math.min(1.0, r.halfW * 0.6),
        z: r.atkBackZ - r.fwd * 0.3,
        urgency: 1,
        plantM: 0.9, plantUrgency: 0.4,
        job: 'EIGHT — BASE OPTION, PICK AND GO OR LINK WITH 9', node: 'base',
      };
    },
  },
  {
    name: 'NUMBER 8: link with a carrying 9',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier && c.carrier.num === 9 && !c.busy,
    act: (c) => {
      const blind = blindSign(c.carrier!.x);
      return {
        x: c.carrier!.x + blind * EIGHT_LINK_LATERAL_M,
        z: c.carrier!.z - c.dir * EIGHT_LINK_DEPTH_M,
        urgency: 1,
        job: 'EIGHT — ON THE 9\'S HIP, PICK OPTION, LINK PLAY', node: 'link-9',
      };
    },
  },
  {
    name: 'NUMBER 8: fold to the open side guard',
    when: (c) => isDef(c) && ruckLive(c) && c.ruckFormed,
    act: (c) => {
      const r = ruckFrame(c);
      return {
        x: offEdge(r, r.open, 2.4), z: r.defGuardZ, urgency: 0.95,
        job: 'EIGHT — FOLD OPEN, WATCH THE PICK AND THE SNIPE', node: 'fold-open',
      };
    },
  },
];

/** The eight trees, by shirt. */
export const FORWARD_TREES: Record<number, PackNode[]> = {
  1: podNode(1),
  2: podNode(2),
  3: podNode(3),
  4: lockNode(4),
  5: lockNode(5),
  6: BLINDSIDE,
  7: OPENSIDE,
  8: EIGHT,
};

export function isForwardShirt(num: number): boolean {
  return num >= 1 && num <= 8;
}

/**
 * Evaluate a shirt's tree — a selector. Returns the first node's mark, or
 * null when no node applies (the dataset / shape mark stands).
 */
export function evaluateForwardTree(num: number, c: PackContext): PackMark | null {
  const tree = FORWARD_TREES[num];
  if (!tree) return null;
  for (const node of tree) {
    if (!node.when(c)) continue;
    const m = node.act(c);
    if (m) return m;
  }
  return null;
}

/**
 * The high-inertia plant: a mark's urgency once the man is within `plantM`.
 * Pure so the probe can prove the collapse.
 */
export function plantedUrgency(m: PackMark, p: Pt): number {
  if (!m.plantM || m.plantM <= 0) return m.urgency;
  const d = Math.hypot(m.x - p.x, m.z - p.z);
  return d <= m.plantM ? (m.plantUrgency ?? 0.3) : m.urgency;
}

/* ================================ SCRUM ================================ */

/**
 * SET-PIECE BINDING — the rigidity of each row's bind, and the front row's
 * low centre of mass.
 *
 *   row 1  the front row is pinned tightest and earliest (0.7 m): three men
 *          whose spines are the tunnel cannot wander half a body-width;
 *   row 2  the engine room binds inside a metre of its seat;
 *   row 3  the eight controls the base and has the most latitude.
 *
 * `crouch` is the body-height scale the renderer / rig may read: the front
 * row sits lowest (a hooker at 0.62 of standing height is crouched to
 * strike), the locks drive from just above, the eight is up looking at the
 * base.
 */
export interface ScrumBindProfile {
  /** metres off the seat inside which the man is bound (pinned), not steering */
  bindTolerance: number;
  /** centre-of-mass height as a fraction of standing height */
  crouch: number;
  /** the settle speed toward the seat, m/s, once inside tolerance */
  settleSpeed: number;
  job: string;
}

export function scrumBindProfile(row: number, num: number): ScrumBindProfile {
  if (row === 1) {
    return {
      bindTolerance: 0.7, crouch: num === 2 ? 0.62 : 0.66, settleSpeed: 2.0,
      job: num === 2 ? 'HOOKER — BIND ON BOTH PROPS, LOW, STRIKE ON THE FEED'
        : num === 1 ? 'LOOSEHEAD — BIND LONG, SPINE IN LINE, LIFT THE TIGHTHEAD'
          : 'TIGHTHEAD — BIND SHORT, CHIN OFF THE CHEST, HOLD THE HIT',
    };
  }
  if (row === 2) {
    return {
      bindTolerance: 0.95, crouch: 0.72, settleSpeed: 2.4,
      job: num === 4 || num === 5 ? 'LOCK — ENGINE ROOM, DRIVE THROUGH THE HIPS OF YOUR PROP'
        : num === 6 ? 'BLINDSIDE — BIND ON THE LOCK, PUSH SQUARE, BREAK LATE'
          : 'OPENSIDE — BIND ON THE LOCK, PUSH, FIRST OFF ON THE BALL',
    };
  }
  return {
    bindTolerance: 1.15, crouch: 0.8, settleSpeed: 2.6,
    job: 'EIGHT — CONTROL THE BALL AT THE BASE, PICK OR RELEASE TO 9',
  };
}

/**
 * The front row's stability, 0..1: how much of the front three are inside
 * their bind tolerance and how low the pack sits. Fed into the collapse
 * risk — a bound, low front row is a stable scrum; a front row still
 * shuffling for its seat is where collapses come from.
 *
 * `offsets` are each front-rower's distance from his seat in metres,
 * `crouchOk` whether the pack is in a crouch stage (the low-COM condition).
 */
export function frontRowStability(offsets: number[], crouchOk: boolean): number {
  if (!offsets.length) return 0;
  let bound = 0;
  for (const o of offsets) bound += o <= scrumBindProfile(1, 2).bindTolerance ? 1 : 0;
  const frac = bound / offsets.length;
  return clamp(frac * (crouchOk ? 1 : 0.6), 0, 1);
}

/** The engine room: how much the locks' power multiplies the pack's shove. */
export function engineRoomFactor(lockPwr: number[]): number {
  if (!lockPwr.length) return 1;
  const mean = lockPwr.reduce((a, b) => a + b, 0) / lockPwr.length / 100;
  return 0.94 + 0.12 * clamp(mean, 0, 1);
}

/** Collapse risk after the front row's stability has been priced in. */
export function stabilisedCollapseRisk(raw: number, stability: number): number {
  return clamp(raw * (1 - 0.4 * clamp(stability, 0, 1)), 0, 1);
}

/**
 * NUMBER 8 AT THE BASE. Whether the eight picks from a won scrum instead
 * of the 9 clearing it. Deterministic in the mark (no RNG: the match's seed
 * stream is not consumed by a choice the eight makes with his eyes).
 */
export function eightPicksFromScrum(ownFeed: boolean, toLine: number, ax: number, az: number): boolean {
  if (!ownFeed) return false;
  if (toLine < 12) return true;
  let h = Math.round(ax * 977) ^ Math.round(az * 613) ^ 0x9e37;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000 < 0.2;
}

/* =============================== LINEOUT =============================== */

/**
 * THE LINEOUT POD. The locks are the main jumpers and the props their
 * lifters — a lineout is thrown to the 4 at the front pod and the 5 in the
 * middle, with the 8 at the tail, each between a front and a back lifter.
 *
 * Throwing side (seven in the line, front to tail):
 *   1  front lifter of the front pod
 *   4  FRONT JUMPER
 *   3  back lifter of the front pod / front lifter of the middle pod
 *   5  MIDDLE JUMPER
 *   6  back lifter of the middle pod / front lifter of the tail pod
 *   8  TAIL JUMPER
 *   7  back lifter of the tail pod
 * Defending side (six): 1 4 3 5 6 8 — the same pods, the 7 stays out as the
 * roving tackler.
 */
export const LINEOUT_LINE_THROWING: readonly number[] = [1, 4, 3, 5, 6, 8, 7];
export const LINEOUT_LINE_DEFENDING: readonly number[] = [1, 4, 3, 5, 6, 8];
export const LINEOUT_JUMPERS: readonly number[] = [4, 5, 8];

export type LineoutRole = 'JUMPER' | 'LIFTER';

export function lineoutRole(num: number): LineoutRole {
  return LINEOUT_JUMPERS.includes(num) ? 'JUMPER' : 'LIFTER';
}

/**
 * THE LIFT TRIGGER. Given the line (in order) and the index of the jumper
 * at the ball, the lifters who go up with him: the man immediately in front
 * and the man immediately behind. Everyone else holds and is ready to peel.
 */
export function liftersFor(line: readonly number[], jumperIdx: number): number[] {
  const out: number[] = [];
  if (jumperIdx - 1 >= 0 && lineoutRole(line[jumperIdx - 1]) === 'LIFTER') out.push(line[jumperIdx - 1]);
  if (jumperIdx + 1 < line.length && lineoutRole(line[jumperIdx + 1]) === 'LIFTER') out.push(line[jumperIdx + 1]);
  return out;
}
