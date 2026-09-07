/**
 * BACKLINE — THE POSITIONAL BEHAVIOUR TREES FOR SHIRTS 9–15.
 *
 * The mirror of `engine/forwardPack.ts`, for the seven shirts the forward
 * trees do not own. Same contract: a small explicit decision tree per shirt,
 * evaluated every frame the man is free (not the carrier, not bound, not
 * down, not the controlled man), plus — because the law is the law — every
 * mark the tree hands out is still routed through the ruck's entry gate by
 * the caller before it is steered. The referee judges a scrum-half's and a
 * wing's arrival exactly the way he judges a prop's.
 *
 *   THE TREES (a selector: the first node whose `when` holds gives the mark;
 *   a null result means "keep the mark the dataset / shape / echelon wrote"):
 *
 *   9  SCRUM-HALF
 *        ruck live → the BASE, and the base is a LAW, not a mark: it sits
 *                    behind BOTH the conventional stride-and-a-half and the
 *                    team's DYNAMIC HINDMOST FOOT — the line the referee
 *                    draws through the rearmost bound foot of the contest,
 *                    which moves as the cleanout arrives. `nineBaseZ()`
 *                    computes it; the 9 who waits in front of it is the
 *                    man the next penalty is written against.
 *        ball out → the EXTRACT: a stride out of the ruck, flat delivery to
 *                    the pocket or the pod — the exit is a pass, not a run,
 *                    and the pass is judged by the throw-forward law (the
 *                    ball's velocity relative to his own motion).
 *        open play → INSIDE SUPPORT, one pass from the ball.
 *
 *   10 FLY-HALF
 *        carrier is the 9 → THE POCKET: the first-receiver depth is a
 *                    function of the game, not a constant — flat in the
 *                    red zone (the pocket is a pick-and-go, 3.5-4.5 m),
 *                    deep in midfield (8-10 m). `pocketDepthFor()` prices it;
 *                    the pocket sits slightly openside of the ball so the
 *                    9's release is a flat, angled pass.
 *        carrier is 12 → the LOOP, around the outside at pace.
 *        defence → the DRIFT: track the ball laterally on his channel and
 *                    shut the 12-13 lane as the line slides.
 *
 *   12 INSIDE CENTRE / 13 OUTSIDE CENTRE
 *        attack  → the FLAT LINES: the 12 crashes the inside shoulder, the
 *                    13 runs the flat tip lane — both in front of the gain
 *                    line when the 9/10 has the ball, so the move breaks the
 *                    gain line instead of orbiting it. A broken line → the
 *                    TRAIL, inside and behind the carrier.
 *        defence → the BLITZ / JAM when the first two receivers have the
 *                    ball and the line is still connected; otherwise the
 *                    DRIFT that slides the outside passing lane shut.
 *
 *   11 LEFT WING / 14 RIGHT WING
 *        attack  → the WIDE EDGE: the finishing line that arrives ahead of
 *                    the outside pass when the ball is in the winger's half
 *                    of the field. A line break inside → the SUPPORT TRAIL.
 *        defence → the PENDULUM (the back three): when the opposition's 9
 *                    or 10 sets his feet and shapes for a kick, the triangle
 *                    of 11 / 15 / 14 rotates to cover the deep thirds of
 *                    the field — left, centre, right — sliding with the
 *                    ball. The geometry lives in
 *                    `behaviour/backline-echelon.ts` (pure); the kick phase
 *                    owns the choreography and applies it in the SETTING
 *                    stage, where think() has already stood down.
 *
 *   15 FULL BACK
 *        attack  → the LATE INSERTION outside 13, and the PULL-BACK LINK
 *                    behind a catcher running the counter.
 *        defence → the SWEEP: the central third, deep, always a step ahead
 *                    of the kick — and the pendulum's centre post in a
 *                    kicking pose.
 *
 * PURE. Nothing here reads or writes a `Live`, a `Director` or a ledger. The
 * caller (Director) builds a `BacklineContext` snapshot, asks for a mark,
 * routes it through the gate and owns the write — the T-02 ownership
 * contract exactly as every other mark source obeys it.
 */

import { RuckGateGeometry } from './gates';
import {
  pendulumMark, pendulumSlot, isBackThree, PENDULUM_DEPTH_M,
  type PendulumThird,
} from '../behaviour/backline-echelon';

/* ================================ TYPES ================================ */

/** A world point. */
export interface Pt { x: number; z: number }

/** What a backline tree may return: a mark, how hard to run at it, the job. */
export interface BacklineMark {
  x: number;
  z: number;
  urgency: number;
  job: string;
  /** the tree node that produced this mark, for telemetry and the probe */
  node: string;
}

/**
 * The snapshot a tree reads. Built by the Director per backliner per frame;
 * every field is a plain number or a plain object so a probe can construct
 * one without a match.
 */
export interface BacklineContext {
  phase: 'OPEN_PLAY' | 'BREAKDOWN';
  team: 'A' | 'B';
  /** the side in possession */
  attacking: 'A' | 'B';
  /** attacking axis of the side in possession: +1 toward +z */
  dir: 1 | -1;
  /** this man's own attacking axis */
  sigma: 1 | -1;
  /** where he is */
  p: Pt;
  /** his velocity (the gate routing reads momentum, not position) */
  vel: Pt;
  /** the ball / contact point the formation is anchored on */
  ball: Pt;
  /** the mark the dataset / shape / echelon already wrote for him */
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
  /** open play: the carrier (null while a pass is in flight) */
  carrier: { num: number; x: number; z: number; vz: number } | null;
  /** the carrier is being held */
  latched: boolean;
  /** he is a converger / cover chaser this frame — leave him to it */
  busy: boolean;
  /** metres from the ball to the try line being attacked */
  toLine: number;
  /** the open-play phase clock (s) */
  opT: number;
  /** the team's tempo slider, 0..1 */
  tempo: number;
  /** the carrier is through the line */
  lineBreak: boolean;
  /** the ruck's use-it window in seconds — the exit pace the 9 plays to */
  ruckWindow: number;
  /** the kick pose: the opposition 9/10 is setting up to kick */
  kick: { team: 'A' | 'B'; num: number; x: number; z: number } | null;
  /** this team's own dead-ball line, world metres (the pendulum's ceiling) */
  ownEdgeZ: number;
}

/* ============================== CONSTANTS ============================== */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Metres behind the ball the 9's conventional base sits. */
export const NINE_BASE_DEPTH_M = 1.4;
/** The lateral offset of the base off the ball's line. */
export const NINE_BASE_LATERAL_M = 1.8;
/** How far behind the team's own hindmost-foot plane the base must sit when
 *  the plane is ahead of the conventional spot. The corridor's own grace is
 *  0.25 m IN FRONT of the plane; 0.5 m behind it is unambiguously onside. */
export const NINE_PLANE_MARGIN_M = 0.5;
/** The 9's inside support off a team-mate's hip, one pass from the ball. */
export const NINE_LINK_LATERAL_M = 2.4;
export const NINE_LINK_DEPTH_M = 1.8;

/** The 10's pocket sits this far openside of the ball's line, so the 9's
 *  release is a flat angled pass rather than a straight pull-back. */
export const POCKET_LATERAL_M = 1.6;
/** The outer bound of the pocket: deeper than this and the pass becomes a
 *  cut-out the rushing defence can throw a body at. */
export const POCKET_MAX_DEPTH_M = 10.5;

/** The 12's flat lane off the ball's line. */
export const TWELVE_LANE_M = 4.6;
/** The 13's flat tip lane. */
export const THIRTEEN_LANE_M = 8.6;
/** Both flat lines finish this far AHEAD of the gain line — a flat line that
 *  finishes behind the gain line is a decoy, and a decoy does not break a
 *  drift. */
export const FLAT_GAIN_LINE_LEAD_M = 1.6;
/** The midfield pair's blitz window: seconds of open play in which a shoot
 *  still beats the receiver to the ball. */
export const BLITZ_WINDOW_S = 0.7;
export const BLITZ_RANGE_M = 15;

/** The winger's finishing line: this far in front of the ball, on the edge. */
export const WING_FINISH_LEAD_M = 7;
export const WING_FINISH_X_M = 29.5;
/** The ball must be in the winger's own half of the field for the edge line
 *  to be his — deeper in midfield the 13 and 15 own the wide channels. */
export const WING_EDGE_FROM_X_M = 5;
/** The support trail off a line break: inside, and a stride behind. */
export const TRAIL_LATERAL_M = 6.5;
export const TRAIL_DEPTH_M = 4;

/** The 15's late insertion, metres outside the 13's line. */
export const FIFTEEN_INSERT_LATERAL_M = 10;
export const FIFTEEN_INSERT_LEAD_M = 6;
/** The 15 only inserts with ground to finish in. */
export const FIFTEEN_INSERT_TO_LINE_M = 34;
/** The pull-back link behind a catcher running the counter. */
export const FIFTEEN_LINK_INFIELD_M = 4;
export const FIFTEEN_LINK_DEPTH_M = 9;
/** The sweeper's depth behind the ball in open play: deeper than the line,
 *  a step ahead of the kick. */
export const FIFTEEN_SWEEP_DEPTH_M = 16;

/* ================================ HELPERS ================================ */

/** The touchline the ball is nearer: +1 for +x. The BLIND side. */
export function blindSign(ballX: number): 1 | -1 {
  return ballX >= 0 ? 1 : -1;
}
/** The wide side of the field: the other hand. */
export function openSign(ballX: number): 1 | -1 {
  return blindSign(ballX) === 1 ? -1 : 1;
}

/**
 * THE 9'S BASE, AGAINST THE DYNAMIC HINDMOST LINE.
 *
 * The base is behind BOTH the conventional stride-and-a-half off the ball
 * and the rearmost bound foot of the contest — whichever is further back.
 * The cleanout crew arrives from behind the ball, so their feet routinely
 * end up behind the old fixed base, and a 9 who waits at the old base waits
 * in front of his own team's line: the offside that the pre-release whistle
 * is written for. The plane moves with the crew; the base follows it.
 *
 * `planeZ` is the team's hindmost foot (null when the contest has no line
 * yet — early CONTACT — and the conventional base stands).
 */
export function nineBaseZ(ballZ: number, planeZ: number | null, dir: 1 | -1): number {
  const conventional = ballZ - dir * NINE_BASE_DEPTH_M;
  if (planeZ === null) return conventional;
  const behindPlane = planeZ - dir * NINE_PLANE_MARGIN_M;
  return dir > 0 ? Math.min(conventional, behindPlane) : Math.max(conventional, behindPlane);
}

/** The base's lateral seat: the BLIND side of the ball (the T-26 seat — the
 *  openside is kept clear for the 10's pocket and the first receiver),
 *  clamped inside the gate's lateral band when there is a gate: a base drawn
 *  wide of the corridor is a side entry waiting for a drift. */
export function nineBaseX(
  ballX: number, geo: RuckGateGeometry | null, side: 1 | -1, team: 'A' | 'B',
): number {
  let x = ballX + side * NINE_BASE_LATERAL_M;
  const g = geo?.gates[team] ?? null;
  if (g) x = clamp(x, g.cx - g.halfW + 0.3, g.cx + g.halfW - 0.3);
  return x;
}

/**
 * THE 10'S POCKET DEPTH, METRES AHEAD OF THE BALL, IN THE ATTACKING DIRECTION.
 *
 * Flat in the red zone (the pocket is a pick-and-go option, 3.5-4.5 m), the
 * classic depth in the building phase (6.5-8 m), deep in midfield (8-10 m).
 * Tempo stretches the whole curve: a slow-tempo side holds a shallower
 * pocket it can still hit; a fast-tempo side runs the deeper option.
 */
export function pocketDepthFor(toLine: number, tempo: number): number {
  let d: number;
  if (toLine < 18) d = 3.5 + tempo * 1.0;
  else if (toLine < 35) d = 6.5 + tempo * 1.5;
  else d = 8.0 + tempo * 2.0;
  return clamp(d, 3.5, POCKET_MAX_DEPTH_M);
}

/* ================================ NODES ================================ */

export interface BacklineNode {
  name: string;
  when: (c: BacklineContext) => boolean;
  act: (c: BacklineContext) => BacklineMark | null;
}

const isAtk = (c: BacklineContext) => c.team === c.attacking;
const isDef = (c: BacklineContext) => c.team !== c.attacking;
const ruckLive = (c: BacklineContext) => c.phase === 'BREAKDOWN' && !c.inRoster
  && (c.stage === 'CONTACT' || c.stage === 'PLACE' || c.stage === 'RUCK');

/** The kicking pose from the point of view of the defending back three. */
const kickPose = (c: BacklineContext) => !!c.kick && c.kick.team !== c.team;

/* ---- 9 · SCRUM-HALF ---- */

const NINE: BacklineNode[] = [
  {
    name: 'NINE: the base — behind the dynamic hindmost line',
    when: (c) => isAtk(c) && ruckLive(c),
    act: (c) => {
      const plane = c.geo?.gates[c.attacking]?.planeZ ?? null;
      return {
        x: nineBaseX(c.ball.x, c.geo, blindSign(c.ball.x), c.team),
        z: nineBaseZ(c.ball.z, plane, c.dir),
        urgency: 0.95,
        job: 'NINE — AT THE BASE, HANDS ON THE BALL, BEHIND THE HINDMOST FOOT',
        node: 'nine-base',
      };
    },
  },
  {
    name: 'NINE: the extract — ball out, flat to the pocket or the pod',
    when: (c) => isAtk(c) && c.phase === 'BREAKDOWN' && c.stage === 'RECYCLE' && !c.inRoster,
    act: (c) => ({
      /* on the ball's own line, a stride to the openside of the release —
       * the delivery is judged against his own forward motion, so the exit
       * step is what makes the flat pass legal */
      x: c.ball.x + openSign(c.ball.x) * 0.8,
      z: c.ball.z - c.dir * 0.4,
      urgency: 1,
      job: 'NINE — EXTRACT: FLAT BALL TO THE POCKET OR THE POD',
      node: 'nine-exit',
    }),
  },
  {
    name: 'NINE: inside support, one pass from the ball',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier && c.carrier.num !== 9 && !c.busy,
    act: (c) => ({
      x: c.carrier!.x - blindSign(c.carrier!.x) * NINE_LINK_LATERAL_M,
      z: c.carrier!.z - c.dir * NINE_LINK_DEPTH_M,
      urgency: 0.95,
      job: 'NINE — INSIDE SUPPORT, ONE PASS FROM THE BALL',
      node: 'nine-link',
    }),
  },
];

/* ---- 10 · FLY-HALF ---- */

const TEN: BacklineNode[] = [
  {
    name: 'TEN: the pocket — depth priced by the ground in front',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier && c.carrier.num === 9 && !c.busy,
    act: (c) => {
      const depth = pocketDepthFor(c.toLine, c.tempo);
      return {
        x: c.ball.x + openSign(c.ball.x) * POCKET_LATERAL_M,
        z: c.ball.z + c.dir * depth,
        urgency: 0.98,
        job: `TEN — THE POCKET, ${depth.toFixed(1)} m DEPTH, FLAT LANE OFF THE 9`,
        node: 'ten-pocket',
      };
    },
  },
  {
    name: 'TEN: loop outside 12',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier && c.carrier.num === 12 && !c.busy,
    act: (c) => ({
      x: c.carrier!.x + openSign(c.carrier!.x) * 6.5,
      z: c.carrier!.z - c.dir * 2.2,
      urgency: 1,
      job: 'TEN — LOOP AROUND THE OUTSIDE, THE EXTRA MAN',
      node: 'ten-loop',
    }),
  },
  {
    name: 'TEN: drift the line, shut the 12-13 lane',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && !!c.carrier && !c.busy,
    act: (c) => ({
      x: c.ball.x + (8.0 + (c.carrier!.x - c.ball.x) * 0.55),
      z: c.ball.z - c.dir * 3.2,
      urgency: 0.9,
      job: 'TEN — DRIFT WITH THE BALL, SHUT THE INSIDE LANE',
      node: 'ten-drift-def',
    }),
  },
];

/* ---- 12 · INSIDE CENTRE ---- */

const TWELVE: BacklineNode[] = [
  {
    name: 'TWELVE: the flat line — break the gain line',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier
      && (c.carrier.num === 9 || c.carrier.num === 10) && !c.busy,
    act: (c) => {
      const car = c.carrier!;
      /* off the 9: the flat run from the ruck's openside lane; off the 10:
       * the crash unders, inside the 10's shoulder, ahead of the gain line */
      const x = c.carrier!.num === 9
        ? c.ball.x + openSign(c.ball.x) * TWELVE_LANE_M
        : car.x + openSign(car.x) * (TWELVE_LANE_M - 0.4);
      const z = c.carrier!.num === 9
        ? c.ball.z + c.dir * FLAT_GAIN_LINE_LEAD_M
        : car.z + c.dir * (FLAT_GAIN_LINE_LEAD_M - 0.4);
      return {
        x, z, urgency: 0.97,
        job: 'TWELVE — FLAT LINE, IN FRONT OF THE GAIN LINE',
        node: 'twelve-flat',
      };
    },
  },
  {
    name: 'TWELVE: the trail — inside and behind the break',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && c.lineBreak && !!c.carrier
      && c.carrier.num !== 12 && !c.busy,
    act: (c) => ({
      x: c.ball.x + openSign(c.ball.x) * TRAIL_LATERAL_M,
      z: c.ball.z - c.dir * TRAIL_DEPTH_M,
      urgency: 1,
      job: 'TWELVE — TRAIL THE BREAK, INSIDE OFFLOAD',
      node: 'twelve-trail',
    }),
  },
  {
    name: 'TWELVE: blitz with 13, shut the outside passing lane',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && !!c.carrier
      && (c.carrier.num === 10 || c.carrier.num === 12)
      && c.opT < BLITZ_WINDOW_S && !c.busy
      && Math.hypot(c.carrier.x - c.p.x, c.carrier.z - c.p.z) < BLITZ_RANGE_M,
    act: (c) => ({
      x: c.carrier!.x,
      z: c.carrier!.z - c.dir * 1.0,
      urgency: 1,
      job: 'TWELVE — BLITZ WITH 13, SHUT THE OUTSIDE LANE',
      node: 'twelve-blitz',
    }),
  },
  {
    name: 'TWELVE: drift, hold the seam',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && !!c.carrier && !c.busy,
    act: (c) => ({
      x: c.ball.x + (12.4 + (c.carrier!.x - c.ball.x) * 0.6),
      z: c.ball.z - c.dir * 3.6,
      urgency: 0.9,
      job: 'TWELVE — DRIFT, HOLD THE SEAM BEHIND THE BLITZ',
      node: 'twelve-drift-def',
    }),
  },
];

/* ---- 13 · OUTSIDE CENTRE ---- */

const THIRTEEN: BacklineNode[] = [
  {
    name: 'THIRTEEN: the flat tip lane',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier
      && (c.carrier.num === 9 || c.carrier.num === 10) && !c.busy,
    act: (c) => ({
      x: c.ball.x + openSign(c.ball.x) * THIRTEEN_LANE_M,
      z: c.ball.z + c.dir * (FLAT_GAIN_LINE_LEAD_M - 0.3),
      urgency: 0.97,
      job: 'THIRTEEN — FLAT TIP LANE, IN FRONT OF THE GAIN LINE',
      node: 'thirteen-flat',
    }),
  },
  {
    name: 'THIRTEEN: the trail — outside and behind the break',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && c.lineBreak && !!c.carrier
      && c.carrier.num !== 13 && !c.busy,
    act: (c) => ({
      x: c.ball.x + openSign(c.ball.x) * (TRAIL_LATERAL_M + 2.5),
      z: c.ball.z - c.dir * (TRAIL_DEPTH_M + 0.8),
      urgency: 1,
      job: 'THIRTEEN — TRAIL THE BREAK, OUTSIDE OFFLOAD',
      node: 'thirteen-trail',
    }),
  },
  {
    name: 'THIRTEEN: jam the strike runner',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && !!c.carrier
      && (c.carrier.num === 12 || c.carrier.num === 13)
      && c.opT < BLITZ_WINDOW_S + 0.2 && !c.busy
      && Math.hypot(c.carrier.x - c.p.x, c.carrier.z - c.p.z) < BLITZ_RANGE_M + 1,
    act: (c) => ({
      x: c.carrier!.x,
      z: c.carrier!.z - c.dir * 0.6,
      urgency: 1,
      job: 'THIRTEEN — JAM THE STRIKE RUNNER BEHIND THE GAIN LINE',
      node: 'thirteen-jam',
    }),
  },
  {
    name: 'THIRTEEN: the edge drift',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && !!c.carrier && !c.busy,
    act: (c) => ({
      x: c.ball.x + (16.4 + (c.carrier!.x - c.ball.x) * 0.6),
      z: c.ball.z - c.dir * 4.0,
      urgency: 0.9,
      job: 'THIRTEEN — EDGE DRIFT, SET THE WING LANE',
      node: 'thirteen-drift-def',
    }),
  },
];

/* ---- 11 · LEFT WING / 14 · RIGHT WING (one factory, mirrored) ---- */

function wingTree(num: 11 | 14): BacklineNode[] {
  const side: 1 | -1 = num === 11 ? -1 : 1;
  const name = num === 11 ? 'ELEVEN' : 'FOURTEEN';
  return [
    {
      name: `${name}: the pendulum — the ${pendulumSlot(num)} deep third`,
      /* first in the tree: on a kicking pose the defensive shape IS the
       * pendulum — no edge line or trail competes with it */
      when: (c) => isDef(c) && kickPose(c) && isBackThree(num),
      act: (c) => {
        const m = pendulumMark(num, c.ball, c.kick!.team === 'A' ? 1 : -1, c.ownEdgeZ);
        return {
          x: m.x, z: m.z, urgency: 1,
          job: `${name} — PENDULUM, ${m.third} THIRD`,
          node: `${num === 11 ? 'eleven' : 'fourteen'}-pendulum`,
        };
      },
    },
    {
      name: `${name}: the wide edge — arrive on the outside pass`,
      when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier
        && c.ball.x * side < -WING_EDGE_FROM_X_M
        && (c.carrier.num === 12 || c.carrier.num === 13 || c.carrier.num === 15) && !c.busy,
      act: (c) => ({
        x: side * WING_FINISH_X_M,
        z: c.ball.z + c.dir * WING_FINISH_LEAD_M,
        urgency: 1,
        job: `${name} — WIDE EDGE, AHEAD OF THE OUTSIDE PASS`,
        node: `${num === 11 ? 'eleven' : 'fourteen'}-edge`,
      }),
    },
    {
      name: `${name}: the support trail behind the line break`,
      when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && c.lineBreak && !!c.carrier
        && c.carrier.num !== num && !c.busy,
      act: (c) => ({
        /* infield of the break: the trail cuts back toward the middle,
         * not out to the fence */
        x: c.ball.x - side * TRAIL_LATERAL_M,
        z: c.ball.z - c.dir * TRAIL_DEPTH_M,
        urgency: 1,
        job: `${name} — SUPPORT TRAIL BEHIND THE BREAK`,
        node: `${num === 11 ? 'eleven' : 'fourteen'}-trail`,
      }),
    },
  ];
}

/* ---- 15 · FULL BACK ---- */

const FIFTEEN: BacklineNode[] = [
  {
    name: 'FIFTEEN: the late insertion outside 13',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier
      && (c.carrier.num === 12 || c.carrier.num === 13)
      && c.toLine < FIFTEEN_INSERT_TO_LINE_M && !c.busy,
    act: (c) => ({
      x: c.ball.x + openSign(c.ball.x) * FIFTEEN_INSERT_LATERAL_M,
      z: c.ball.z + c.dir * FIFTEEN_INSERT_LEAD_M,
      urgency: 1,
      job: 'FIFTEEN — LATE INSERTION, THE EXTRA MAN OUTSIDE 13',
      node: 'fifteen-insert',
    }),
  },
  {
    name: 'FIFTEEN: the pull-back link behind the counter',
    when: (c) => isAtk(c) && c.phase === 'OPEN_PLAY' && !!c.carrier
      && (c.carrier.num === 11 || c.carrier.num === 14) && !c.busy,
    act: (c) => ({
      x: c.ball.x - blindSign(c.ball.x) * FIFTEEN_LINK_INFIELD_M,
      z: c.ball.z - c.dir * FIFTEEN_LINK_DEPTH_M,
      urgency: 0.95,
      job: 'FIFTEEN — PULL-BACK LINK, CHANGE THE POINT',
      node: 'fifteen-link',
    }),
  },
  {
    name: 'FIFTEEN: the pendulum — the CENTRE deep third',
    /* before the sweep: on a kicking pose the sweep IS the pendulum's
     * centre post, and the pose is the more specific read */
    when: (c) => isDef(c) && kickPose(c) && isBackThree(15),
    act: (c) => {
      const m = pendulumMark(15, c.ball, c.kick!.team === 'A' ? 1 : -1, c.ownEdgeZ);
      return {
        x: m.x, z: m.z, urgency: 1,
        job: `FIFTEEN — PENDULUM, ${m.third} THIRD`,
        node: 'fifteen-pendulum',
      };
    },
  },
  {
    name: 'FIFTEEN: the sweep — the central third, ahead of the kick',
    when: (c) => isDef(c) && c.phase === 'OPEN_PLAY' && !c.busy,
    act: (c) => ({
      x: c.ball.x * 0.92,
      z: c.ball.z - c.dir * FIFTEEN_SWEEP_DEPTH_M,
      urgency: 0.85,
      job: 'FIFTEEN — THE SWEEP, CENTRAL THIRD, AHEAD OF THE KICK',
      node: 'fifteen-sweep',
    }),
  },
];

/** The seven trees, by shirt. */
export const BACKLINE_TREES: Record<number, BacklineNode[]> = {
  9: NINE,
  10: TEN,
  11: wingTree(11),
  12: TWELVE,
  13: THIRTEEN,
  14: wingTree(14),
  15: FIFTEEN,
};

export function isBacklineShirt(num: number): boolean {
  return num >= 9 && num <= 15;
}

/**
 * Evaluate a shirt's tree — a selector. Returns the first node's mark, or
 * null when no node applies (the dataset / shape / echelon mark stands).
 */
export function evaluateBacklineTree(num: number, c: BacklineContext): BacklineMark | null {
  const tree = BACKLINE_TREES[num];
  if (!tree) return null;
  for (const node of tree) {
    if (!node.when(c)) continue;
    const m = node.act(c);
    if (m) return m;
  }
  return null;
}

/**
 * The pendulum's kick-pose gate, the way the Director reads it: the
 * opposition's 9 or 10 is in his kicking pose — feet set, ball in hand or on
 * the tee, strike not yet struck. The back three rotate on the POSE, not on
 * the flight: by the time the ball is in the air the chasers own the deep
 * field, and the rotation is late.
 */
export function kickPoseOf(
  kk: { kicker: 'A' | 'B'; kickerNum: number; stage: string; bx: number; bz: number } | null | undefined,
): { team: 'A' | 'B'; num: number; x: number; z: number } | null {
  if (!kk) return null;
  if (kk.stage !== 'AIM' && kk.stage !== 'METER') return null;
  if (kk.kickerNum !== 9 && kk.kickerNum !== 10) return null;
  return { team: kk.kicker, num: kk.kickerNum, x: kk.bx, z: kk.bz };
}

/** The full back-three rotation for a pose, all three marks at once. */
export function backThreeRotation(
  ball: Pt,
  dir: 1 | -1,
  ownEdgeZ: number,
): Array<{ num: 11 | 15 | 14; x: number; z: number; third: PendulumThird }> {
  return ([11, 15, 14] as const).map((num) => ({ num, ...pendulumMark(num, ball, dir, ownEdgeZ) }));
}

/** The maximum depth the pendulum may use — re-exported for probes. */
export { PENDULUM_DEPTH_M };
