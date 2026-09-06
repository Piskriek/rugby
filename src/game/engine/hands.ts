/**
 * hands.ts — THE BALL IS WHAT THE HANDS WANT.
 *
 * Everything at a breakdown used to be decided by FORCE. Two numbers per side,
 * ramped against each other on a damped axis, and a jackal either won or did not
 * according to arithmetic that never once asked whether anybody's hands were
 * anywhere near the ball. That is why a steal could happen with the clear-outs
 * landing three metres away, and why a man whose arms were on the ball for a full
 * second could not turn it over: the model had no hands in it.
 *
 * So this file adds them. It is a field sampled per frame, not a solver:
 *
 *   MAGNET.   Every man at the ruck has two hands and the ball is the target. The
 *             attraction is a scalar `reach` in 0..1 from how far his hands are
 *             from the ball *relative to what his posture allows*: a planted man
 *             can cover 2.15 m, a man on the ground 1.35 m, a man still running
 *             his lane essentially nothing until the choreography says he has
 *             arrived. No inverse-square and no arm integration — positions the
 *             baked plan already knows, one subtract and one hypot per man.
 *
 *   GRAPPLE.  Inside the grip radius, `reach` becomes `onBall`: seconds of
 *             continuous contact, the only currency the contest recognises. A
 *             clear-out that lands on you ends the count, because a jackal shoved
 *             off the ball does not keep his grip — in the laws or in life.
 *
 *   STRIP.    Hands on the ball are what PRESSURE the contest with. The ball-out
 *             window is now slowed by them (that is what "he is over the ball"
 *             means in commentary terms), and a turnover additionally requires
 *             that the defender's hands were actually on it for the strip time.
 *             The user's law is untouched and still enforced once, in
 *             breakdown.ts: MORE men at the ball than the attack has committed.
 *
 * CHEAP by construction: the per-man state lives in one preallocated array hung
 * on the breakdown, nothing allocates in the frame path, and `handsprobe` fails
 * the build if the cost per ruck frame grows.
 */
import { sampleBall } from './breakdownPlan';
import type { BreakdownState, Director } from '../director';

/** One entry per man at the ruck, in `s.players` order, reused every frame. */
export interface HandSlot {
  /** 0..1 how committed the hands currently are to the ball. */
  reach: number;
  /** seconds of continuous contact inside the grip radius; reset when broken. */
  onBall: number;
  /** 0..1.x how far this man's strip has progressed (contact × leverage). */
  strip: number;
  /** metres of hand-to-ball gap, for the renderer and the probe. */
  gap: number;
  /** true on the frames his hands are on the ball. */
  holding: boolean;
  /** the match time his grip was last broken — the audit asks for this one. */
  brokenAt: number;
  /** the best contact second this man ever reached, so a ruck can be graded. */
  peakOnBall: number;
  /** whose hands these are — the slot list is indexed by the PLAN's order, which is
   *  nobody's order but its own, so the publish pass needs to be able to name him. */
  team: 'A' | 'B';
  num: number;
  /** cached index into `d.live`, or -1. `Director.L()` is a linear `find` over
   *  thirty actors; twelve of those a frame is a third of this function's entire
   *  cost, spent re-finding men whose position in the list never changes. The index
   *  is validated against the team and number every frame, so if a substitution
   *  ever moves a man the cache re-finds him rather than reading a stranger. */
  ai: number;
}

export interface HandsState {
  slots: HandSlot[];
  /** index -> slot, rebuilt every frame from the slot list. The breakdown's roster
   *  and the plan's lane list are different sets in a different order, so something
   *  has to join them — but NOT a `team:num` string: twelve template literals a frame
   *  measured 990 bytes/frame of live heap growth, which is a GC ping every 200 ms
   *  for the whole match. Folding `team` into the integer is one add, and the array
   *  is a fixed 272 slots allocated once with the state. */
  byKey: (HandSlot | null)[];
  /** index into s.players of the defender with the most hands-on-ball. */
  bestDef: number;
  bestDefOnBall: number;
  /** and the attacker protecting it (the carrier's own hands, or a guard's). */
  bestAtk: number;
  bestAtkOnBall: number;
  /** total pressure each side is putting on the ball, in contest units. */
  defPressure: number;
  atkPressure: number;
  /** presentation: where the ball is being dragged, metres, and how hard. */
  pullX: number;
  pullZ: number;
  tug: number;
  /** the frame a strip landed / a grip broke, for the audio and FX one-shots. */
  lastStripAt: number;
  lastBreakAt: number;
  frames: number;
  /** telemetry for the probe: worst strip meter, total frames with contested hands. */
  maxStrip: number;
  contestedFrames: number;
}

/* ------------------------------------------------------------------ table -- */
/**
 * What a pair of hands can cover, by posture, in metres to the ball.
 *
 * Deliberately not one constant: a man standing over the ball reaching down, and
 * a man on his side reaching from the deck, are different reach problems, and the
 * difference between them is what makes a jackal over the top read as a jackal
 * over the top instead of as one more body in the pile.
 */
const REACH_M = {
  /** still running his lane, hands empty */
  ARRIVING: 0.55,
  /** planted, reaching down at a ball on the deck */
  STAND: 2.15,
  /** on his feet but bound over the top of a maul or a tackler */
  OVER_TOP: 1.75,
  /** ground level, reaching from a knee or his side */
  DOWN: 1.35,
} as const;

/**
 * Inside this the hands are ON the ball, not merely reaching at it — by POSTURE,
 * because the gap being measured is boot-to-ball and a pair of arms is about 0.7 m
 * long. A man standing over the pile can cover a metre and a bit without moving his
 * feet; the same man on his side on the deck cannot reach half that. Setting one
 * number for both is what made the first measurement of this file report 25 rucks
 * in 42 with nobody touching the ball: the tackler's hands were 0.65 m from it, the
 * grip radius said 0.62, and a man who is visibly wrapping the ball out of a ruck was
 * scored as doing nothing.
 */
const GRIP_M = {
  STAND: 1.05,
  OVER_TOP: 1.30,
  DOWN: 0.80,
  /** hands are empty while he runs; a man cannot grip at full stride */
  ARRIVING: 0.45,
} as const;
/** How fast commitment is gained and lost, per second. Hands are not a switch. */
const REACH_RATE = 8.5;
const RELEASE_RATE = 5.0;
/** The seconds of contact a strip needs, before leverage. */
export const STRIP_BASE_S = 0.30;
/** The extra seconds each attacking body at the ball buys the guard. */
export const STRIP_PER_GUARD_S = 0.10;
/** Pressure per second of contact, in the units the contest window uses. */
const PRESSURE_PER_HAND = 34;
/** A man who has just been cleared cannot re-engage for this long. */
const KNOCKED_LOCK_S = 0.55;
/** and a man who has just DELIVERED a clearout has no hands for this long. */
const STRUCK_LOCK_S = 0.28;
/** How much of the ball-out window a contested pair of hands can add, seconds. */
export const WINDOW_SLOW_MAX = 0.30;

export function makeHands(): HandsState {
  return {
    slots: [], byKey: new Array(272).fill(null), bestDef: -1, bestDefOnBall: 0, bestAtk: -1, bestAtkOnBall: 0,
    defPressure: 0, atkPressure: 0, pullX: 0, pullZ: 0, tug: 0,
    lastStripAt: -99, lastBreakAt: -99, frames: 0, maxStrip: 0, contestedFrames: 0,
  };
}

/**
 * Which posture a man at the ruck is in, and with it both envelopes: how far his
 * hands can travel, and how close that lets him grip.
 *
 * One classification on purpose. A reach envelope and a grip radius decided by
 * separate rules is how a model ends up crediting a man with the ability to touch a
 * ball he cannot hold — and at a breakdown, "touch" and "hold" are the difference
 * between slowing a ruck and stealing it.
 */
function postureFor(role: string, down: boolean, frac: number): keyof typeof REACH_M {
  /* The carrier and the man on his hip have no lane to arrive on — they are already
   * there, on the ball, from the frame the ruck forms. Both hands on the ball is
   * precisely their state, so they skip the run-in question and the deck rule. */
  if (role === 'CARRY' || role === 'TACKLE') return down ? 'DOWN' : 'OVER_TOP';
  if (down) return 'DOWN';
  /* `frac` is how far along his baked lane he is. A man at 0.4 is still running;
   * asking hands of him is what made a clearout look like a steal. */
  if (frac < 0.72) return 'ARRIVING';
  if (role === 'JACKAL' || role === 'COUNTER' || role === 'BIND') return 'OVER_TOP';
  return 'STAND';
}

/**
 * One frame of hands. Called from the ruck's own step AFTER the plan has moved
 * everybody, so every gap is measured against where the choreography put him.
 */
export function stepHands(d: Director, s: BreakdownState, dt: number): HandsState {
  let h = s.hands;
  if (!h) h = s.hands = makeHands();
  const plan = s.plan;
  /* One entry per man the CONTEST contains, which is not the same as one entry per
   * man on the breakdown's roster. `s.players` is a list of the carrier, the
   * tackler and the first men in — five or six names — while the ruck is being
   * fought by everybody with a lane, eleven or twelve, and it is the lanes that
   * hold the jackal. Measured: judging the ruck from `players` alone left 35 of 45
   * rucks with nobody's hands on the ball, because the man who was on it was never
   * asked. So: the plan when there is one, the roster when the choreography has
   * been stripped away (a replay, a torn-down episode), and never an invented
   * third list of who is "at" the ruck — that would be a fourth model of the pile.
   *
   * Positions come from the actor, not from the roster snapshot or the lane: the
   * lane is what `placeBound` sampled into the actor a moment ago, the stumble and
   * the peel included, so the actor is the one place where "where he is" is settled
   * for the frame. Two reads of one number, once per man. */
  const men = plan ? plan.slots : null;
  const n = men ? men.length : s.players.length;
  if (h.slots.length !== n) {
    h.slots.length = 0;
    for (let i = 0; i < n; i++) {
      h.slots.push({ reach: 0, onBall: 0, strip: 0, gap: 9, holding: false, brokenAt: -99, peakOnBall: 0, team: 'A', num: 0, ai: -1 });
    }
  }

  const bx = s.ball.x, bz = s.ball.z;
  /* The ball's HEIGHT decides what a hand has to travel to. A ball still in the
   * carrier's hands is chest height; a ball placed on the deck is not, and the arc
   * of the heel has its own height at every frame in between. The engine does not
   * care which — this is the part that does, and it is why reaching into a ruck is
   * a skill: get your hands under the ball at ground level. */
  const bl = plan ? sampleBall(plan, s.t) : null;
  const ballY = bl && bl.active ? bl.y : (s.ball.placed ? 0.16 : 1.02);
  const deckLow = ballY < 0.45;

  let defP = 0, atkP = 0;
  let bestDef = -1, bestDefT = 0, bestAtk = -1, bestAtkT = 0;
  let pullX = 0, pullZ = 0, pullN = 0;

  for (let i = 0; i < n; i++) {
    const sl = h.slots[i];
    let team: 'A' | 'B'; let num: number; let role: string; let frac: number;
    let struck: boolean; let shove: number;
    if (men) {
      const ps = men[i];
      team = ps.team; num = ps.num; role = ps.role; frac = ps.frac;
      /* A clear-out that landed on him: his own shove is gone and his hands are
       * busy keeping himself up. `hitT` is the stumble clock breakdown.ts already
       * drives, so there is one source of the truth and no second timer to drift. */
      struck = ps.hitT > 0; shove = ps.shove;
      /* `struckAt` adds the other half of the same truth: a man whose clearout
       * landed a quarter of a second ago has his arms somewhere else. His own hit
       * does not count against him for longer than that — he stays planted on his
       * mark, ready to play the ball — but the moment of impact is not a moment of
       * reaching, and a model that ignored that would let a cleaner hit a man and
       * pick the ball out of the pile in the same frame. */
      if (ps.struckAt > 0 && s.t - ps.struckAt < STRUCK_LOCK_S) struck = true;
    } else {
      const p = s.players[i];
      team = p.team; num = p.num; role = p.role; frac = 1; struck = false; shove = 1;
    }
    let p = sl.ai >= 0 ? d.live[sl.ai] : null;
    if (!p || p.team !== team || p.num !== num) {
      p = d.L(team, num);
      const ai = d.live.indexOf(p as never);
      sl.ai = ai;
    }
    sl.team = team; sl.num = num;
    h.byKey[keyOf(team, num)] = sl;
    const lockedOut = struck || (sl.onBall === 0 && s.t - sl.brokenAt < KNOCKED_LOCK_S);

    const posture = postureFor(role, p.down || lockedOut, frac);
    const reachM = REACH_M[posture];
    const gripM = GRIP_M[posture];
    const dx = bx - p.x, dz = bz - p.z;
    const gap = Math.hypot(dx, dz);
    sl.gap = gap;

    const want = lockedOut ? 0
      : Math.max(0, 1 - gap / Math.max(0.3, reachM))
      /* Reaching down to the deck is a shorter, cleaner reach than reaching into a
       * chest — and a ball in a chest is held by two hands that are also being
       * pulled at, which is the grapple, not the strip. */
      * (deckLow ? 1 : 0.62);
    const rate = want > sl.reach ? REACH_RATE : RELEASE_RATE;
    sl.reach += (want - sl.reach) * Math.min(1, rate * dt);
    if (sl.reach < 0.002) sl.reach = 0;

    /* Contact is the GEOMETRY, and the floor on `reach` only excludes a man whose
     * posture says he is not reaching at all — a runner on his lane, hands empty.
     * Using the commitment itself as the gate was the first version's mistake: it
     * scored a counter whose arms are through the pile onto the ball as touching
     * nothing, because at a metre out the gradient is only worth 0.4. */
    const on = !lockedOut && gap < gripM && sl.reach > 0.22;
    if (on) {
      sl.onBall += dt;
      if (sl.onBall > sl.peakOnBall) sl.peakOnBall = sl.onBall;
      /* Leverage: a man settled on his mark with his shove arriving converts
       * contact into strip faster than a man still on one leg. `shove` is the
       * plan's own 0..1 commitment, so no new physical fiction is invented. */
      const leverage = (p.down ? 0.55 : 1) * (0.55 + Math.min(0.55, shove * 0.55));
      sl.strip = Math.min(1.4, sl.strip + dt * Math.max(0.2, leverage) / STRIP_BASE_S);
      if (sl.strip > h.maxStrip) h.maxStrip = sl.strip;
    } else {
      if (sl.onBall > 0) sl.brokenAt = s.t;
      /* A break is a break: one second of contact, a shove off, another second is
       * not two seconds of pressure. */
      sl.onBall = 0;
      sl.strip = Math.max(0, sl.strip - dt * 1.6);
    }
    sl.holding = on;

    /* Pressure: what a man's hands cost the other side. A grip is worth a lot and
     * grows; a reach alone is worth a little, which is all a late arrival deserves. */
    const force = on
      ? PRESSURE_PER_HAND * (0.5 + sl.reach * 0.5) * (0.6 + Math.min(1.2, sl.onBall))
      : sl.reach * 6;
    /* WHOSE PRESSURE COUNTS. A defender over the ball is contesting it; an attacker
     * over his OWN ball is presenting it, and the carrier in particular is lying on
     * top of a ball he has already been tackled with — counting his grip as attack
     * pressure made every ruck in the match resolve instantly to the attack, because
     * the one man guaranteed to be within a metre of the ball is the man holding it.
     * The attack's side of this contest is what its GUARDS do, so CARRY is out. */
    const isAtk = team === s.attacking;
    if (isAtk) { if (role !== 'CARRY') atkP += force; } else defP += force;
    if (!isAtk && sl.onBall > bestDefT) { bestDefT = sl.onBall; bestDef = i; }
    if (isAtk && role !== 'CARRY' && sl.onBall > bestAtkT) { bestAtkT = sl.onBall; bestAtk = i; }
    if (on) { pullX += dx; pullZ += dz; pullN++; }
  }

  h.defPressure = defP;
  h.atkPressure = atkP;
  h.bestDef = bestDef; h.bestDefOnBall = bestDefT;
  h.bestAtk = bestAtk; h.bestAtkOnBall = bestAtkT;
  h.frames++;
  if (bestDefT > 0 && bestAtkT > 0) h.contestedFrames++;
  h.tug = Math.min(1, (bestDefT + bestAtkT) * 1.6);
  if (pullN) { h.pullX = (pullX / pullN) * 0.10 * h.tug; h.pullZ = (pullZ / pullN) * 0.10 * h.tug; }
  else { h.pullX = 0; h.pullZ = 0; }
  return h;
}

/**
 * How long the defender's hands have been on the ball, in seconds — the number
 * the contest asks for. A lone jackal gets a real answer here (long contact) and
 * still loses, because whether contact is ENOUGH is the law's business, not this
 * file's; `handsShort` is what makes him slow the ball instead.
 */
export function defHold(h: HandsState): number {
  return h.bestDefOnBall;
}

/**
 * How long a strip takes, in seconds of clean contact: the base, plus what each
 * extra attacking body over the ball costs a would-be thief. `guards` is the
 * ruck's own presence count, so the number the law is applied with and the
 * number that prices the strip are the same number measured the same way.
 */
export function stripTimeFor(guards: number): number {
  return STRIP_BASE_S + Math.max(0, guards - 1) * STRIP_PER_GUARD_S;
}

/**
 * The ball-out window penalty a contested ball pays, in seconds: the visible
 * meaning of "he is over it, they cannot get it out". 0 when nobody's hands are
 * on it; capped, because a ruck that never releases is a penalty waiting to be
 * invented rather than a feature.
 */
export function windowSlow(h: HandsState): number {
  /* Defender contact only. An attacker with his hands on his own ball is not what
   * slows a heel — he presents it as fast as he can; it is the man pulling at it
   * from the other side who costs the half-second. Measured the other way this
   * charged every ruck the carrier's own hold, which is the same as charging the
   * tackle for happening. */
  const held = h.bestDefOnBall;
  if (held <= 0) return 0;
  const bothSides = h.bestAtkOnBall > 0 ? 1 : 0.7;
  return Math.min(WINDOW_SLOW_MAX, held * 0.30 * bothSides);
}

/**
 * Publish the per-man numbers onto the breakdown's own player list, which is the
 * object the rig reads. Written here rather than looked up there because a
 * presentation pass that searched the ruck for its own data would be a second
 * model of who is at the ball — and the two would disagree the first time a
 * clearout landed.
 */
export function publishHands(s: BreakdownState, h: HandsState): void {
  for (const p of s.players) {
    const sl = h.byKey[keyOf(p.team, p.num)];
    p.hand = sl ? sl.reach : 0;
    p.strip = sl ? sl.strip : 0;
  }
}

/** squad numbers are 1..15, so B is simply offset. */
function keyOf(team: 'A' | 'B', num: number): number {
  return (team === 'A' ? 0 : 128) + num;
}
