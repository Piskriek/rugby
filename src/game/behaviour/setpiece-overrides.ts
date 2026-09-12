/**
 * SET-PIECE LAW COMPLIANCE — GLOBAL BEHAVIOUR OVERRIDES.
 *
 * The dataset, the shapes and the role contracts all answer "where would a
 * player LIKE to stand?". At a place kick at goal, a lineout backline and a
 * scrum the answer is not a preference — it is the law, and it is the same
 * for every shirt. These overrides sit ABOVE every other source of positional
 * truth: if one of them answers, nothing else may write the mark that frame.
 *
 * They are pure geometry. Nothing here reads or mutates Live state; the
 * caller (Director.placeBound for the kick/scrum, Director.think for the
 * lineout backline) applies the marks and owns the writes, exactly as the
 * T-02 ownership contract requires.
 *
 * ── LAW 8.20 / 8.22 — CONVERSIONS AND PENALTY KICKS AT GOAL ────────────────
 * The non-kicking team must retire to its own goal line and stay there,
 * motionless, until the kicker begins his run-up. The kicking team must be
 * behind the ball. Before this override the two teams milled about at their
 * open-play marks throughout the ritual, which is both illegal and — with
 * thirty men drifting behind a stationary kicker — the single most obviously
 * wrong thing on screen during a conversion.
 *
 * ── LAW 18 — LINEOUT BACKLINE ─────────────────────────────────────────────
 * Players not in the lineout (and not the thrower or the receiver) must stand
 * at least ten metres from the line of touch, on their own side, or on their
 * goal line if that is nearer. They occupy the rest of the pitch — they are
 * not a cluster around the thrower. Open-play shape, anchored on the ball at
 * ±33.5, squeezed the whole XV onto the touchline; this override is the law.
 *
 * ── LAW 19 — SCRUM ────────────────────────────────────────────────────────
 * The two packs bind head-on down the engagement axis, in a 3-4-1 block. The
 * axis runs ALONG the pitch (world z), so team A faces +z and team B faces −z;
 * they must never present a shoulder to the touchline.
 */

import { FIELD } from '../../render/retro';

/* ======================= GOAL KICKS / CONVERSIONS ======================= */

/** The kick types that are a place kick at the posts and carry the ritual. */
export type GoalKickType = 'GOAL' | 'CONVERSION';

/** True when a kick state is a shot at goal (a penalty goal or a conversion). */
export function isGoalKickState(type: string): boolean {
  return type === 'GOAL' || type === 'CONVERSION';
}

export interface GoalKickMark {
  x: number;
  z: number;
  /** the man must be stationary on this mark until the ball is struck */
  frozen: boolean;
  job: string;
}

/** Metres the attacking team must stand behind the ball. Law: behind it. */
export const ATTACKER_BEHIND_KICKER_METRES = 2;

/** Lateral margin kept off each touchline when spreading the defending line. */
const TOUCH_MARGIN = 3;

/**
 * The lawful mark for one player during a kick at goal.
 *
 *  - DEFENDERS (the non-kicking team) are locked to their OWN try line —
 *    `targetZ` is the try line itself — and distributed evenly across the
 *    width of the pitch by their index in the retreating group. They do not
 *    move: `frozen` is true until the ball is kicked.
 *  - ATTACKERS (the kicking team, kicker excepted) are locked at least
 *    `ATTACKER_BEHIND_KICKER_METRES` behind the kicker's z, spread across the
 *    same width so they do not stack on him.
 *
 * @param index      0-based index of this man within his group
 * @param count      size of his group (never 0)
 * @param defending  true for the non-kicking side
 * @param kickDir    +1 if the kick travels toward +z, −1 toward −z
 * @param kickerZ    the kicker's z (the ball's z)
 */
export function goalKickMark(
  index: number, count: number, defending: boolean,
  kickDir: 1 | -1, kickerZ: number,
): GoalKickMark {
  const n = Math.max(1, count);
  /* even distribution across the pitch width: n men, n gaps, each in the
   * middle of his own lane, so the line is symmetric about the posts. */
  const span = (FIELD.maxX - TOUCH_MARGIN) - (FIELD.minX + TOUCH_MARGIN);
  const x = (FIELD.minX + TOUCH_MARGIN) + span * ((index + 0.5) / n);

  if (defending) {
    /* their own try line is the one the ball is travelling towards. */
    const tryLine = kickDir > 0 ? FIELD.tryZFar : FIELD.tryZ;
    return {
      x, z: tryLine, frozen: true,
      job: 'BEHIND YOUR OWN GOAL LINE — DO NOT MOVE UNTIL HE STRIKES IT',
    };
  }
  return {
    x,
    z: kickerZ - kickDir * ATTACKER_BEHIND_KICKER_METRES,
    frozen: true,
    job: 'STAY BEHIND THE KICKER UNTIL THE BALL IS STRUCK',
  };
}

/* ============================ LINEOUT BACKLINE ============================ */

/** Law 18: metres non-participants stand from the line of touch.
 *  Half a metre past the ten so they sit outside the offside corridor, not on it. */
export const LINEOUT_BACKLINE_METRES = 10.5;
/** The fifteen is last man, a stride deeper than the tens line. */
export const LINEOUT_FULLBACK_METRES = 16;

export interface LineoutBacklineMark {
  x: number;
  z: number;
  job: string;
}

/**
 * Metres infield from the throwing touch, by shirt. The lineout itself occupies
 * 5–15 m from touch; the backline starts just inside the 15 m and runs to the
 * far five. 11 is the left wing, 14 the right — the near wing covers the short
 * side, the far wing holds the open field.
 */
function lineoutInfieldFromTouch(num: number, side: number): number {
  const nearWing = 8;
  const farWing = 62;
  if (num === 14) return side > 0 ? nearWing : farWing;
  if (num === 11) return side > 0 ? farWing : nearWing;
  switch (num) {
    case 2: return 13;
    case 1: return 16;
    case 3: return 17;
    case 4: case 5: case 6: case 7: case 8: return 18;
    case 9: return 21;
    case 10: return 26;
    case 12: return 36;
    case 13: return 48;
    case 15: return 40;
    default: return 30;
  }
}

function lineoutJob(num: number): string {
  if (num === 10) return 'FIRST RECEIVER — TEN METRES BACK';
  if (num === 9) return 'COVER THEIR TEN — TEN METRES BACK';
  if (num === 15) return 'LAST MAN — DEEP BEHIND THE LINEOUT';
  if (num === 11 || num === 14) return 'HOLD THE WIDTH — TEN METRES BACK';
  if (num >= 1 && num <= 8) return 'TEN METRES BACK — DO NOT ENTER THE LINE';
  if (num === 12 || num === 13) return 'IN THE BACKLINE — TEN METRES BACK';
  return 'TEN METRES BACK FROM THE LINE OF TOUCH';
}

/**
 * The lawful mark for a player who is NOT in the lineout.
 *
 *  - z is 10.5 m (16 m for 15) on that team's own side of `markZ`, clamped
 *    to their try line when the lineout is closer than that.
 *  - x is spread across the remaining width, measured infield from the
 *    throwing touch (`side` +1 = right touch, −1 = left).
 *
 * Pure geometry. The caller (Director.think) applies the mark and steers;
 * nothing here teleports a body.
 */
export function lineoutBacklineMark(
  num: number,
  team: 'A' | 'B',
  markZ: number,
  side: number,
): LineoutBacklineMark {
  const sigma: 1 | -1 = team === 'A' ? 1 : -1;
  const back = num === 15 ? LINEOUT_FULLBACK_METRES : LINEOUT_BACKLINE_METRES;
  let z = markZ - sigma * back;
  const ownTry = sigma > 0 ? FIELD.tryZ : FIELD.tryZFar;
  if (sigma > 0) z = Math.max(z, ownTry);
  else z = Math.min(z, ownTry);

  const infield = lineoutInfieldFromTouch(num, side);
  const x = Math.max(FIELD.minX + 2, Math.min(FIELD.maxX - 2, side * (FIELD.maxX - infield)));
  return { x, z, job: lineoutJob(num) };
}

/* ============================== SCRUM =============================== */

/**
 * The engagement heading of a pack, in radians, in the renderer's frame
 * (0 = facing +z pitch, π = facing −z). The engagement axis runs along the
 * pitch, never across it: A packs down facing +z, B facing −z, and the two
 * front rows meet head-on.
 */
export function scrumFacing(team: 'A' | 'B'): number {
  return team === 'A' ? 0 : Math.PI;
}

/** The engine-frame facing sign (`Live.face`) of a pack in a scrum. */
export function scrumFaceSign(team: 'A' | 'B'): 1 | -1 {
  return team === 'A' ? 1 : -1;
}

/**
 * THE 3-4-1 BLOCK. Row 1 is the front row (loosehead, hooker, tighthead),
 * row 2 the four-man second row (the two locks flanked by the two flankers),
 * row 3 the number eight alone at the base. Rows are stacked along z away
 * from the mark; men are spread along x within their row.
 *
 * Returned coordinates are absolute, given the scrum mark (ax, az).
 */
export const SCRUM_ROWS_341: number[][] = [
  [1, 2, 3],       // 3 — front row
  [6, 4, 5, 7],    // 4 — locks bound between the two flankers
  [8],             // 1 — the eight at the base
];

/** Lateral spacing between shoulders within a row, metres.
 *
 * 0.68 was the width of a *standing* back-row line, and it is what the bind
 * table kept failing: with two men 0.68 apart, an anchor on the near side of one
 * of them is 0.46 from the other's spine, the arm reaches 0.547 from its own
 * shoulder, and a hand on the line between the two is nearer its own man's body
 * than the man it is gripping. `bindprobe`'s nearest-body test caught exactly
 * that, sixteen hands at a time. A bound front row is a width of shoulders and
 * arms — measured here at 0.52, which is the spacing at which every authored
 * grip in `PACK_BIND_SOCKETS` lands nearer the body it names. */
const ROW_SPACING = 0.52;
/** Distance from the mark to the front row, and between successive rows.
 *
 * These used to be 0.62 and 0.66, and they were the reason a scrum could not be
 * bound: two front rows at 0.62 each are 1.24 m apart, a lock and his prop are
 * 0.66 apart, and a human arm reaches about 0.6 m from the shoulder. Every
 * authored grip in `PACK_BIND_SOCKETS` was therefore out of reach by
 * construction — measured at 0.57-1.39 m from shoulder to socket before this
 * line was changed, on the shipped rig, which is the definition of a bind that
 * is decorative. The values now come from how a scrum actually sets: heads
 * interlocked across a mark less than a metre wide, second row chest to
 * buttocks.
 *
 * Everything downstream that needs a depth (the base a number 8 picks from, the
 * stride behind it his nine stands on) reads `scrumRowDepth` rather than
 * repeating a number, because four hand-copied depths is how the pack and the
 * exits drifted apart in the first place. */
const ROW_ONE_DEPTH = 0.30;
const ROW_GAP = 0.34;

/** How far back from the mark a row of the pack sits, metres. */
export function scrumRowDepth(row: number): number {
  return ROW_ONE_DEPTH + Math.max(0, row - 1) * ROW_GAP;
}

/** How far behind the base of the scrum a nine stands to get the ball. */
export const SCRUM_NINE_STRIDE_M = 0.62;
export function scrumNineDepth(): number {
  return scrumRowDepth(3) + SCRUM_NINE_STRIDE_M;
}

export interface ScrumBlockSlot {
  num: number; team: 'A' | 'B'; row: number; x: number; z: number;
  /** the locked engagement heading, radians (renderer frame) */
  facing: number;
}

/**
 * Every one of the sixteen forwards' locked coordinates for a scrum on the
 * mark (ax, az), in the 3-4-1 block, both packs facing down the engagement
 * axis. Pure — the caller places the men.
 */
export function scrumBlock(ax: number, az: number): ScrumBlockSlot[] {
  const out: ScrumBlockSlot[] = [];
  for (const team of ['A', 'B'] as const) {
    const back = team === 'A' ? -1 : 1;   // A packs from −z, B from +z
    SCRUM_ROWS_341.forEach((row, ri) => {
      row.forEach((num, ci) => {
        out.push({
          num, team, row: ri + 1,
          x: ax + (ci - (row.length - 1) / 2) * ROW_SPACING,
          z: az + back * scrumRowDepth(ri + 1),
          facing: scrumFacing(team),
        });
      });
    });
  }
  return out;
}

/* ================================================================== *
 * SCRUM BINDING — THE AUTHORED ANATOMY
 * ================================================================== *
 *
 * Everything above answers the referee's question: WHERE does each man stand.
 * This answers the body's question: WHAT is he holding on to. Until now the
 * engine had a bind only as a scalar tolerance (`scrumBindProfile`) and the
 * renderer had no bind at all — all eight forwards in a pack played the same
 * shared `Push` clip, so sixteen men gripped the air in synchronisation. The
 * discrepancy HANDOFF.md records as "no geometry, no individual binding" is
 * this missing table.
 *
 * It stays PURE GEOMETRY, in the spirit of the module: an anchor is a name
 * plus an offset measured in the REFERENCED man's own body frame, and this file
 * never reads or writes a `Live`, a `Director` or a bone. The engine resolves
 * the bodies (it owns who stands where); the renderer resolves the bones (it
 * owns what a body's pelvis actually measures); the numbers below are the only
 * authored truth either of them can point at.
 *
 * ── THE FRAME OF AN OFFSET ──────────────────────────────────────────
 * `lat` is metres toward the referenced man's LEFT (his own left, not the
 *   binders'), `fwd` is metres along HIS engagement axis (toward the tunnel),
 *   `up` is metres ABOVE HIS PELVIS. Pelvis-relative on purpose: a scrum is a
 *   crouch, and an anchor pinned to an absolute turf height would float off
 *   the body the moment the pack sat down. `up` values below are therefore the
 *   anatomical distance from the joint, not a height, and they hold for a man
 *   bound and a man standing.
 *
 * ── WHY THE OPPONENT IS RESOLVED BY COLUMN ───────────────────────────
 * Law 3.12 binds the front rows head-to-head, and `scrumBlock` lays both packs
 * out in the same x order, so the body a man is square to is the opposition
 * shirt in HIS column. The anchors below therefore name the anatomy (rib fold,
 * shoulder seam, armpit) and resolve the *body* by column, via
 * `tunnelOpponent()`. If the block is ever mirrored — the other lawful way to
 * set a scrum — the same rule still puts each hand on the nearest rib fold
 * instead of on a body 1.36 m away. A bind authored against a shirt number is
 * a bind that breaks the first time the geometry moves.
 */

/** Which hand of the binder. */
export type BindHand = 'left' | 'right';

/** Whose body an anchor is measured from. */
export type BindRefKind = 'own' | 'mate' | 'opp';

/**
 * One hand, on one anatomical feature, of one shirt.
 */
export interface BindSocket {
  hand: BindHand;
  /** the anatomical feature gripped — the name the HUD and the probe print */
  anchor: string;
  /** 'own' = his own body (a self-referenced anchor is a body-shape clamp, not
   *  a grip); 'mate' = a team-mate; 'opp' = the man across the tunnel */
  ref: BindRefKind;
  /** the referenced shirt. For `ref: 'opp'` this is the shirt the anchor is
   *  DESCRIBED against, and `tunnelOpponent` resolves which body that is in
   *  this pack layout. */
  num: number;
  /** nudge in metres around the referenced body's near side (its own left is
   *  positive). NOT a placement: the resolver puts a grip on the side of the
   *  body that faces the gripper by rule, and this only moves it a hand's width
   *  from there — 'outside shoulder' needs a nudge, the reach does not. */
  lat: number;
  /** nudge along the referenced body's engagement axis, same convention */
  fwd: number;
  /** metres above the referenced man's pelvis: the anatomy proper. This is the
   *  field that carries the meaning, because it is the one that separates a rib
   *  fold (+0.18) from a waistband (+0.02) from a thigh (-0.30). */
  up: number;
  /** 0..1 how hard the hand is committed once the stage reaches `from`.
   *  Loosehead and tighthead binds carry full weight: a front row that is not
   *  holding each other is not a scrum and the collapse trigger should see it. */
  commit: number;
}

/**
 * THE SIXTEEN HANDS OF A PACK — two per shirt, 1 through 8.
 *
 *   1  LOOSEHEAD   left hand grips the opposition front-rower's rib fold (the
 *                  classic "long bind" that lets him lift the tighthead); right
 *                  arm runs under his own hooker's armpit, so the front row is
 *                  one spine and not three men leaning on each other.
 *   2  HOOKER      both arms wrap OVER the props' shoulders and bind on the
 *                  upper jersey seams — he is legally not allowed to bind down
 *                  to either prop's body, and the seams are the highest grip
 *                  available to the man whose job is to strike for the ball.
 *   3  TIGHTHEAD   right arm binds OUTSIDE the opposition loosehead's
 *                  shoulder/arm (the short bind, to stop the wheel), left arm
 *                  binds his own hooker.
 *   4·5 LOCKS      inner arms bind to EACH OTHER across the seam of the
 *                  second row; outer hands grip their own prop's waistband and
 *                  the shoulders drive into the prop's glutes (`shoulder`
 *                  anchors below are the body-shape clamp that pose sells).
 *   6·7 FLANKERS   drive the shoulder into the hip pocket of the prop/lock
 *                  outside them, hands grip the LOCK's waist — a flanker who
 *                  binds high is a flanker who lifts.
 *   8  NUMBER 8    clamps his head between the locks' hips and grips both
 *                  thighs: he is the base, and the ball rolls out over him.
 */
export const PACK_BIND_SOCKETS: Record<number, BindSocket[]> = {
  1: [
    { hand: 'left', anchor: 'opp rib fold', ref: 'opp', num: 3, lat: 0.10, fwd: 0.04, up: 0.18, commit: 1 },
    { hand: 'right', anchor: 'hooker armpit', ref: 'mate', num: 2, lat: 0.00, fwd: 0.06, up: 0.30, commit: 1 },
  ],
  2: [
    { hand: 'left', anchor: 'loosehead shoulder seam', ref: 'mate', num: 1, lat: 0.00, fwd: 0.00, up: 0.34, commit: 1 },
    { hand: 'right', anchor: 'tighthead shoulder seam', ref: 'mate', num: 3, lat: 0.00, fwd: 0.00, up: 0.34, commit: 1 },
  ],
  3: [
    { hand: 'right', anchor: 'opp outside shoulder', ref: 'opp', num: 1, lat: -0.14, fwd: 0.00, up: 0.28, commit: 1 },
    { hand: 'left', anchor: 'hooker back seam', ref: 'mate', num: 2, lat: 0.00, fwd: 0.04, up: 0.26, commit: 1 },
  ],
  4: [
    { hand: 'left', anchor: 'lock inner bind', ref: 'mate', num: 5, lat: 0.00, fwd: 0.00, up: 0.16, commit: 1 },
    { hand: 'right', anchor: 'prop waistband', ref: 'mate', num: 1, lat: 0.00, fwd: 0.02, up: 0.02, commit: 1 },
  ],
  5: [
    { hand: 'right', anchor: 'lock inner bind', ref: 'mate', num: 4, lat: 0.00, fwd: 0.00, up: 0.16, commit: 1 },
    { hand: 'left', anchor: 'prop waistband', ref: 'mate', num: 3, lat: 0.00, fwd: 0.02, up: 0.02, commit: 1 },
  ],
  6: [
    { hand: 'right', anchor: 'lock waist', ref: 'mate', num: 4, lat: 0.00, fwd: 0.02, up: 0.03, commit: 1 },
    { hand: 'left', anchor: 'prop hip pocket', ref: 'mate', num: 1, lat: 0.00, fwd: 0.06, up: -0.02, commit: 1 },
  ],
  7: [
    { hand: 'left', anchor: 'lock waist', ref: 'mate', num: 5, lat: 0.00, fwd: 0.02, up: 0.03, commit: 1 },
    { hand: 'right', anchor: 'prop hip pocket', ref: 'mate', num: 3, lat: 0.00, fwd: 0.06, up: -0.02, commit: 1 },
  ],
  8: [
    { hand: 'left', anchor: 'lock thigh', ref: 'mate', num: 4, lat: -0.08, fwd: 0.04, up: -0.30, commit: 1 },
    { hand: 'right', anchor: 'lock thigh', ref: 'mate', num: 5, lat: 0.08, fwd: 0.04, up: -0.30, commit: 1 },
  ],
};

/** The shirts that make up a pack, in binding order. */
export const SCRUM_PACK_SHIRTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Which body a cross-tunnel bind actually lands on: the opponent standing in
 * the same column of the 3-4-1 block. `SCRUM_ROWS_341` spreads both packs on
 * x in the same order, so today that is the same shirt; going through this
 * function is what keeps the anchors true if the block is ever mirrored.
 */
export function tunnelOpponent(num: number): number {
  const row = SCRUM_ROWS_341[0];
  const col = row.indexOf(num);
  if (col < 0) return num;          // not a front row shirt: nothing across the tunnel
  return row[col];
}

/* ---------------- CROUCH SCALE: the published hip heights ---------------- *
 * One authored source for how low a row sits, read by the engine (collapse
 * risk, stability) AND the renderer (the pelvis it must actually reach). The
 * numbers are the ones `scrumBindProfile` has always published; they live here
 * so that "the front row is low" means one number to both layers instead of
 * two that drift. A scrum in which nobody is grounded is not a scrum, it is
 * three men in a line bending their knees slightly.
 * ------------------------------------------------------------------------ */

/** Metres from the turf to the pelvis joint of this rig at full standing.
 *  0.95 m on a ~1.85 m forward — the greater trochanter line, which is the
 *  height the crouch scale is applied to. */
export const STANDING_PELVIS_Y = 0.95;

/** The authored crouch: centre-of-mass height as a fraction of standing. */
export const SCRUM_CROUCH_SCALE = {
  front: 0.66,
  hooker: 0.62,
  second: 0.72,
  eight: 0.80,
} as const;

/** The crouch fraction for one shirt (the hooker sits lowest: he has to
 *  strike for the ball; the eight stays up because he watches the base). */
export function scrumCrouchScale(row: number, num: number): number {
  if (row === 1) return num === 2 ? SCRUM_CROUCH_SCALE.hooker : SCRUM_CROUCH_SCALE.front;
  if (row === 2) return SCRUM_CROUCH_SCALE.second;
  return SCRUM_CROUCH_SCALE.eight;
}

/**
 * THE PUBLISHED HIP HEIGHT, in metres above the turf, for one bound forward.
 *
 * This is the number the renderer has to land the pelvis on and the number
 * the bind probe measures against. `sag` is 0..1 how far his bind has failed
 * him: a front-rower whose bind is not made cannot hold the height, and his
 * hip drops toward the collapse floor below.
 */
export function scrumHipY(row: number, num: number, sag = 0): number {
  return STANDING_PELVIS_Y * scrumCrouchScale(row, num) - clamp01(sag) * 0.30;
}

/** How much of the body a scrum crouch folds away, as a `root`-relative drop. */
export function scrumCrouchDrop(row: number, num: number): number {
  return STANDING_PELVIS_Y * (1 - scrumCrouchScale(row, num));
}

/* ------------------------- THE COLLAPSE LAW ------------------------- *
 * Law 19 does not define a scrum's height in metres, but this simulation has
 * to decide once and for all when a pack has come down, and the answer has to
 * be the same for the engine that calls the penalty and the renderer that
 * folds the bodies. These are those numbers.
 * ------------------------------------------------------------------- */

export const SCRUM_COLLAPSE = {
  /** A pack whose drive vector has sheared this far off the tunnel axis is
   *  being pushed sideways, and a sideways pack is a collapsing pack. */
  SHEAR_DEG: 15,
  /** The published floor for a front-rower's hip. Below this he is not
   *  crouching any more, he is falling, and the whistle is late already. */
  HIP_Y_FLOOR: 0.40,
  /** The pitch a collapsed front row lies on, degrees. Not flat: a collapsed
   *  pack folds into the side it went, with the chest toward the turf and the
   *  knees still under it. */
  PITCH_DEG: 10,
  /** Seconds the fold takes, and the grace before the referee's teardown —
   *  long enough to read as a collapse, short enough that play is not held up. */
  FOLD_S: 0.45,
  WHISTLE_S: 0.6,
  /** How long a pack must hold a sheared drive before it counts as a collapse
   *  rather than a lean. See `shearedToCollapse`. */
  SHEAR_HOLD_S: 0.25,
  /** The same rule for the hips: seconds the front row must spend under the
   *  floor. Longer than the shear because a settling bind dips. */
  HIP_HOLD_S: 0.4,
  /** How far a dominant contest pulls a bound front row DOWN, as a sag. The
   *  pack being driven over the top of them does not just lose the shove, it
   *  loses its height — this is the term that makes that visible. */
  COMPRESSION_MAX: 0.55,
  /** How far the second row and the eight run INTO the gap the front row makes
   *  as it goes down, metres. Deliberately small: it is the weight of a pack
   *  arriving where its props used to be, not a charge. */
  SLIDE_M: 0.55,
} as const;

/** Degrees → radians. */
export const deg2rad = (d: number): number => (d * Math.PI) / 180;

/** The collapse pitch in radians, for the renderer. */
export const SCRUM_COLLAPSE_PITCH = deg2rad(SCRUM_COLLAPSE.PITCH_DEG);

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** The contest risk at which a losing front row starts to be driven down. An
 *  even scrum sits far below it, which is the point: nobody should come off the
 *  deck because two packs finished a metre apart. */
export const SCRUM_COMPRESSION_FROM = 0.6;

/* ================== THE CADENCE, AS ONE AUTHORED TIMELINE ==================
 *
 * The referee's calls and the body's pose are the SAME clock. Until now the
 * state machine in engine/setpieces.ts held the stage durations as inline
 * literals and the renderer held no idea of them at all, so "blend the bind
 * across crouch → bind → set → drive" could not be asked, let alone answered.
 * This table is the one authored timeline both of them read: the engine walks
 * it to decide when to move on, and the pose weight is a function of where in
 * it the pack stands.
 *
 * `pose` is the target bind weight at the END of that stage: 0 = nothing but a
 * man standing on his mark, 1 = a bound, weighted pack. It is monotonic because
 * a scrum does not un-bind; the one place it is allowed to fall back to a low
 * value is a reset, and a reset changes the stage, not the blend.
 *
 * Durations are the engine's own existing values (the match feel), gathered
 * here — crouch 0.35, bind 0.35, set 0.25 — so the timing does not move when
 * the pose starts reading it.
 */

export interface ScrumCadenceStage {
  stage: ScrumStageName;
  /** authored seconds this stage holds */
  dur: number;
  /** the bind weight this stage ends at, 0..1 */
  pose: number;
}

/** The subset of the scrum's life a pose timeline exists for. ASSEMBLE and
 *  MARK are men jogging into place; they are not a pose. */
export type ScrumStageName =
  | 'MARK' | 'FORM' | 'CROUCH' | 'BIND' | 'SET' | 'ENGAGE' | 'STEADY' | 'FEED'
  | 'STRIKE' | 'DRIVE' | 'BASE' | 'OUT' | 'COLLAPSE';

export const SCRUM_CADENCE: readonly ScrumCadenceStage[] = [
  { stage: 'MARK', dur: 0.20, pose: 0.00 },
  { stage: 'FORM', dur: 0.25, pose: 0.05 },
  { stage: 'CROUCH', dur: 0.35, pose: 0.40 },
  { stage: 'BIND', dur: 0.35, pose: 0.78 },
  { stage: 'SET', dur: 0.25, pose: 1.00 },
  { stage: 'ENGAGE', dur: 0.20, pose: 1.00 },
  { stage: 'STEADY', dur: 0.20, pose: 1.00 },
  { stage: 'FEED', dur: 0.30, pose: 1.00 },
  { stage: 'STRIKE', dur: 0.00, pose: 1.00 },
  { stage: 'DRIVE', dur: 0.90, pose: 1.00 },
  { stage: 'BASE', dur: 0.30, pose: 1.00 },
  { stage: 'OUT', dur: 0.00, pose: 1.00 },
  /** the fold: the pose weight runs BACK to nothing as the pack goes down */
  { stage: 'COLLAPSE', dur: SCRUM_COLLAPSE.FOLD_S, pose: 0.0 },
] as const;

const CADENCE_INDEX = new Map<string, number>(
  SCRUM_CADENCE.map((c, i) => [c.stage, i]),
);

/** The authored hold time of one stage, 0 for a stage that is instantaneous. */
export function scrumStageDuration(stage: string): number {
  const i = CADENCE_INDEX.get(stage);
  return i === undefined ? 0 : SCRUM_CADENCE[i].dur;
}

/**
 * The bind weight a pack should be holding mid-stage: a linear ramp from the
 * previous stage's authored pose to this one's, over this one's duration.
 * `t` is the seconds the stage has been running (the state machine's `s.t`).
 *
 * Pure and cheap (a map lookup and a divide) because the renderer asks for it
 * for thirty shirts a frame.
 */
export function scrumCadencePose(stage: string, t: number): number {
  const i = CADENCE_INDEX.get(stage);
  if (i === undefined) return 0;
  const cur = SCRUM_CADENCE[i];
  const from = i > 0 ? SCRUM_CADENCE[i - 1].pose : 0;
  if (cur.dur <= 0) return cur.pose;
  const u = clamp01(t / cur.dur);
  return from + (cur.pose - from) * u;
}

/* ==================== THE BIND, RESOLVED TO POINTS ==================== *
 *
 * The table above is authored anatomy; this is the same data turned into
 * world-space points the renderer can aim a hand at. It stays pure: it is
 * handed the bodies it must bind to (position, facing sign, published hip
 * height) and it returns points. It does not care whether those bodies are the
 * marks the pack was placed on or the live positions of men who have been
 * driven three metres back — a grip authored against a phantom mark is a hand
 * that closes on air the moment the scrum moves, which is precisely the bug
 * this exists to kill.
 * ---------------------------------------------------------------------- */

/** One body a hand can be bound to. */
export interface BindBody {
  team: 'A' | 'B';
  num: number;
  row: number;
  x: number;
  z: number;
  /** +1 facing +z, −1 facing −z (the engine's `Live.face`) */
  face: 1 | -1;
  /** metres above the turf this man's pelvis is holding right now */
  hipY: number;
}

/** One hand, aimed. Coordinates are engine pitch metres, y above the turf. */
export interface BindSocketPoint {
  team: 'A' | 'B';
  num: number;
  hand: BindHand;
  anchor: string;
  x: number;
  y: number;
  z: number;
  /** 0..1 — the authored commit of this socket × the cadence blend */
  weight: number;
}

/** Half a shoulder: how far around a body a near-side grip lands. A hand that
 *  goes on a man's ribs goes on the ribs NEAREST the arm reaching for them, and
 *  an anchor authored as an absolute offset forgets that the other man is a body
 *  with a width. Measured in metres, applied by rule. */
export const BIND_NEAR_LAT = 0.22;
/** How far around toward the gripper a grip sits on the near FACE of a body:
 *  less than half a torso, because the chest is rounded and the fingers want
 *  the shirt, not the centre of the back. */
export const BIND_NEAR_FWD = 0.16;
/** How far a hand can actually travel from the body it belongs to, metres. The
 *  shipped rig's arm measures 0.547 m from shoulder to wrist (measured off the
 *  GLB, not looked up), and a grip authored further than that is not a bind, it
 *  is a lunge — so the resolver pulls the anchor in along its own line until the
 *  hand can hold it. The grip keeps its DIRECTION and its anatomy, and loses the
 *  centimetres nobody's shoulder can supply. */
export const BIND_REACH_M = 0.36;
/** the shoulder's height above the pelvis, as a proxy for where the reach starts */
export const BIND_SHOULDER_ABOVE_HIP = 0.42;

/**
 * Resolve every bound hand in both packs.
 *
 * `blend` is the cadence pose (0 = walking in, 1 = set). Below 1 each hand is
 * interpolated from a relaxed point at the binder's own waist toward its
 * anchor, so CROUCH → BIND → SET is a continuous reach-and-grip rather than a
 * pop. `blend` reaching 1 does not mean the bind holds: a man whose bind has
 * failed him is what `sag` in the anchor's hip height already says.
 */
export function scrumBindSockets(
  bodies: BindBody[], blend: number,
): BindSocketPoint[] {
  const out: BindSocketPoint[] = [];
  const b = clamp01(blend);
  for (const me of bodies) {
    const sockets = PACK_BIND_SOCKETS[me.num];
    if (!sockets) continue;
    for (const s of sockets) {
      /* WHICH BODY. 'own' is his own frame; 'mate' is a team-mate by shirt;
       * 'opp' is resolved by column, not by the number in the table, so the
       * hand lands on the man he is actually square to. */
      let ref: BindBody | undefined;
      if (s.ref === 'own') ref = me;
      else if (s.ref === 'mate') ref = bodies.find((q) => q.team === me.team && q.num === s.num);
      else {
        const foes = bodies.filter((q) => q.team !== me.team && q.row === me.row);
        let best: BindBody | undefined; let bestD = Infinity;
        for (const q of foes) {
          const d = Math.abs(q.x - me.x);
          if (d < bestD) { bestD = d; best = q; }
        }
        ref = best ?? bodies.find((q) => q.team !== me.team && q.num === tunnelOpponent(s.num));
      }
      if (!ref) continue;
      /* the offset, read in the referenced man's own frame: left is (face,0,0)
       * and forward is (0,0,face) for a man facing along the pitch. */
      /* THE NEAR SIDE, BY RULE. Which way round to place the grip is decided by
       * where the gripper actually is, not by a number in a table: a lock binding
       * the man in front of him grips that man's BACK, and if the same anchor is
       * ever read against a man behind, the rule follows without anyone editing
       * an offset. */
      const self = ref === me;
      const nearX = self ? 0 : Math.sign(me.x - ref.x) * BIND_NEAR_LAT;
      const nearZ = self ? 0 : Math.sign(me.z - ref.z) * BIND_NEAR_FWD;
      const ax = ref.x + nearX + s.lat * ref.face;
      const az = ref.z + nearZ + s.fwd * ref.face;
      const ay = ref.hipY + s.up;
      /* the relaxed start: the hand at his own hip, half a stride short of the
       * grip, on the side the anchor is. */
      const sx = me.x + Math.sign(s.lat || 1) * 0.22 * me.face;
      const sz = me.z + 0.18 * me.face;
      const sy = me.hipY + 0.06;
      /* THE REACH ENVELOPE. Clamped against the binder's own shoulder, in three
       * dimensions, before any blending — see BIND_REACH_M. */
      const shx = me.x, shy = me.hipY + BIND_SHOULDER_ABOVE_HIP, shz = me.z;
      const rx = ax - shx, ry = ay - shy, rz = az - shz;
      const rd = Math.hypot(rx, ry, rz);
      const pull = rd > BIND_REACH_M ? BIND_REACH_M / rd : 1;
      const gx = shx + rx * pull, gy = shy + ry * pull, gz = shz + rz * pull;
      out.push({
        team: me.team, num: me.num, hand: s.hand, anchor: s.anchor,
        x: sx + (gx - sx) * b,
        y: sy + (gy - sy) * b,
        z: sz + (gz - sz) * b,
        weight: s.commit * b,
      });
    }
  }
  return out;
}
