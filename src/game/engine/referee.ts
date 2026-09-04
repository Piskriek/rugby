/**
 * SPEC_15 — THE REFEREE. The match official as an actor, not a HUD string.
 *
 * Until now he was placed by assignment in `syncActors()`: two lines of
 * arithmetic on the camera's focus point, every frame, with no velocity of his
 * own. Because `puppetFor` derives speed from position deltas, that assignment
 * spiked his speed every time the focus jumped — and `ref.rf` was never
 * written at all, so `face: a.rf > 0 ? 0 : Math.PI` pinned him facing +z for
 * the whole match. Both `refReady` and `refSignal` fell through `mapAction` to
 * `idle`, so he could not animate even if he had moved.
 *
 * He is deliberately NOT a `Live`. `steer()` takes a `Live`, and `d.live` is
 * the array every defensive, offside, passing, separation and tackle loop
 * iterates. Adding a thirty-first body to it would make every one of those
 * loops count the referee as a defender — a large blast radius for an actor who
 * never touches the ball. He gets his own integration here instead, using the
 * same primitives (accel toward a target, arrival easing, a speed ladder) and
 * carrying the T-02 `movedBy` ownership tag so the contract covers him too.
 */

import type { Director } from '../director';
import { clamp } from './clamp';
import { FIELD } from '../../render/retro';

/* The pitch he is allowed to stand on. A shade inside the playing surface:
 * he is never in touch, and never past the dead-ball line. */
const BOUND_X = FIELD.maxX - 2;          // 33
const BOUND_Z = FIELD.deadZFar - 4;      // 58

/** How far behind the ball he holds, per phase, along the attacking axis. */
const DEPTH = {
  open: 10,
  breakdown: 5.5,
  maul: 6,
  scrum: 5,
  kick: 12,
  lineout: 0,      // level with the mark; his offset is lateral
} as const;

/**
 * The speed ladder. He only ever runs when he has been left behind.
 *
 * The measured first pass had him capped at the run speed of a forward and
 * spending most of the match 7.5 m (p90 24 m) from where he wanted to be,
 * which read as a distant figure wandering in from a long way off. A match
 * official sprints to keep up; the top tier is a burst, not a cruise.
 */
const SPEED = { walk: 1.8, jog: 4.8, run: 8.0, burst: 10.0 } as const;

/**
 * How far ahead of the ball he aims, in seconds of the ball's own travel.
 *
 * The first measurement had him a median 6 m from where he wanted to be and
 * 20 m at p90, and the cause was not slowness: a carrier runs at 8 m/s and he
 * was capped under it, so a trailing official could never close. A real
 * referee does not chase the ball's last position, he runs to where it is
 * GOING. The lead is capped both absolutely and as a fraction of his standoff,
 * so anticipation can never put him upfield of the ball.
 */
const LEAD = 0.7;

export interface RefState {
  x: number; z: number;
  vx: number; vz: number;
  /** radians: the bearing he is LOOKING, which is not his travel heading. */
  face: number;
  /** this frame's target, exported for the SPEC_15 probe. */
  tx: number; tz: number;
  /** the eased standoff distance — see refTarget(). */
  depthNow: number;
  /** the ball's last known position and its smoothed velocity — the lead. */
  bx: number; bz: number; vbx: number; vbz: number; primed: boolean;
  /** T-02 — single-writer ownership tag. Only stepReferee writes him. */
  movedBy: 'ref';
  /** the gait or one-shot the renderer should play. */
  clip: string;
  /** seconds left on the current one-shot; 0 = none. */
  signalT: number;
  /** the one-shot's clip, held so a re-signal does not restart it mid-swing. */
  signalClip: string;
}

/* ------------------------------------------------------------------ *
 * THE SPEECH BUBBLE QUEUE
 * ------------------------------------------------------------------ */

export type BubbleKind = 'CARD' | 'PENALTY' | 'LAW_CALL' | 'NARRATIVE' | 'NUDGE';

/**
 * A queued line. Two anchor modes render it — but they are chosen by the
 * renderer, not carried here, because what decides the anchor is the KIND of
 * utterance and there are exactly two sources:
 *
 *   REF  — anything the official says (law calls, cards, warnings). Anchored
 *          above his head.
 *   SITE — the live control affordances (USE IT, COMMIT - SPACE, A/D -
 *          CLEAROUT, SECURED). Those are a state of the ruck and the maul
 *          rather than events, so they are derived per frame by
 *          `Director.refPrompt()` and pinned to the point of interaction: a
 *          key prompt floating above a man who can be fifteen metres away and
 *          off-screen is a regression, not an improvement.
 */
export interface RefBubble {
  text: string;
  kind: BubbleKind;
  /** match time the bubble was pushed. */
  at: number;
  /** seconds it lives. */
  ttl: number;
}

/** Higher wins. A card preempts a nudge; the queue drains in this order. */
export const BUBBLE_PRIORITY: Record<BubbleKind, number> = {
  CARD: 4, PENALTY: 3, LAW_CALL: 2, NARRATIVE: 1, NUDGE: 0,
};

export function newReferee(z = -14): RefState {
  return {
    x: 6, z, vx: 0, vz: 0, face: 0,
    tx: 6, tz: z, depthNow: DEPTH.open, movedBy: 'ref',
    bx: 0, bz: 0, vbx: 0, vbz: 0, primed: false,
    clip: 'refIdle', signalT: 0, signalClip: '',
  };
}

/* ------------------------------------------------------------------ *
 * WHERE THE BALL IS
 * ------------------------------------------------------------------ */

/**
 * The ball's own position, not the camera's subject. `focusPoint()` stays on
 * the carrier for formation reasons; the referee has no such obligation and
 * watches the ball, so during a pass in flight he tracks the pass.
 */
export function refBallPoint(d: Director): { x: number; z: number } {
  const ph = d.phase;
  if (d.op && (ph === 'OPEN_PLAY')) {
    if (d.op.ball.live) return { x: d.op.ball.x, z: d.op.ball.z };
    return { x: d.op.carrierX, z: d.op.carrierZ };
  }
  if (d.bd && (ph === 'BREAKDOWN' || ph === 'BREAKDOWN_REPLAY')) return { x: d.bd.ball.x, z: d.bd.ball.z };
  if (d.ml && (ph === 'MAUL' || ph === 'MAUL_REPLAY')) return { x: d.ml.x, z: d.ml.z };
  if (d.kk && (ph === 'KICK' || ph === 'KICK_REPLAY')) return { x: d.kk.bx, z: d.kk.bz };
  if (d.lo && (ph === 'LINEOUT' || ph === 'LINEOUT_REPLAY')) return { x: d.lo.ball.x, z: d.lo.markZ };
  if (d.scrim && (ph === 'SCRUM' || ph === 'REPLAY')) {
    return { x: d.scrumAnchor.x + d.scrim.ball.x, z: d.scrumAnchor.z + d.scrim.ball.z };
  }
  return d.focusPoint();
}

/** The attacking direction, the same +1/-1 the rest of the engine uses. */
function refDir(d: Director): number {
  if (d.op) return d.op.dir;
  if (d.bd) return d.bd.attacking === 'A' ? 1 : -1;
  if (d.ml) return d.ml.dir;
  if (d.kk) return d.kk.dir;
  return d.possession === 'A' ? 1 : -1;
}

/* ------------------------------------------------------------------ *
 * WHERE HE WANTS TO BE
 * ------------------------------------------------------------------ */

/**
 * The blind side is computed, not hardcoded. The old `rx = f.x * 0.4 + 8` was a
 * fixed +x offset, which is why he drifted into the defensive line every time
 * play went left. Here he takes the mean lateral spread of the attacking
 * support and stands the other side of it, scaled down so the read is smooth
 * rather than a flip between two touchlines.
 */
function blindSideOffset(d: Director): number {
  const op = d.op;
  if (!op || !op.supports.length) return 0;
  let sum = 0;
  for (const s of op.supports) sum += s.x;
  const spread = clamp(sum / op.supports.length, -14, 14);
  return -spread * 0.55;
}

export function refTarget(
  d: Director, ref: RefState,
  ball: { x: number; z: number }, aim: { x: number; z: number },
): { x: number; z: number } {
  const dir = refDir(d);
  const ph = d.phase;

  /* The standoff is EASED, not switched. A breakdown holds him 5.5 m off the
   * ball and open play 10 m; snapping between them the instant the phase
   * changed threw a 4.5 m step into his target at every recycle, which is a
   * long way to chase sixty times a match. */
  const wantDepth =
    (ph === 'BREAKDOWN' || ph === 'BREAKDOWN_REPLAY') ? DEPTH.breakdown
      : (ph === 'KICK' || ph === 'KICK_REPLAY') ? DEPTH.kick
        : (ph === 'SCRUM' || ph === 'REPLAY') ? DEPTH.scrum
          : (ph === 'MAUL' || ph === 'MAUL_REPLAY') ? DEPTH.maul
            : DEPTH.open;
  ref.depthNow += clamp(wantDepth - ref.depthNow, -8 * (1 / 60) * 4, 8 * (1 / 60) * 4);

  if (ph === 'SCRUM' || ph === 'REPLAY') {
    /* Square to the tunnel: off to one side and level with the middle, where
     * he can see the feed and both offside lines at once. */
    const a = d.scrumAnchor;
    return { x: clamp(a.x + 7, -BOUND_X, BOUND_X), z: clamp(a.z - dir * ref.depthNow, -BOUND_Z, BOUND_Z) };
  }

  if (ph === 'LINEOUT' || ph === 'LINEOUT_REPLAY') {
    /* Level with the mark, infield of the line of jumpers. */
    const lo = d.lo!;
    const inward = lo.call.targetX >= 0 ? -1 : 1;
    return {
      x: clamp(lo.call.targetX + inward * 6, -BOUND_X, BOUND_X),
      z: clamp(lo.markZ, -BOUND_Z, BOUND_Z),
    };
  }

  if (ph === 'MAUL' || ph === 'MAUL_REPLAY') {
    const m = d.ml!;
    const inward = m.x >= 0 ? -1 : 1;
    return {
      x: clamp(m.x + inward * 6, -BOUND_X, BOUND_X),
      z: clamp(m.z - dir * 2, -BOUND_Z, BOUND_Z),
    };
  }

  if (ph === 'BREAKDOWN' || ph === 'BREAKDOWN_REPLAY') {
    const b = d.bd!;
    /* Behind the hindmost foot, on the side the ball is sitting — the side
     * the next phase will come off. */
    return {
      x: clamp(b.contactX + (b.ball.x - b.contactX) * 1.6, -BOUND_X, BOUND_X),
      z: clamp(b.ball.z - dir * ref.depthNow, -BOUND_Z, BOUND_Z),
    };
  }

  if (ph === 'KICK' || ph === 'KICK_REPLAY') {
    const k = d.kk!;
    /* A try has been scored: he retreats behind the posts for the conversion. */
    if (k.stage === 'FANFARE' || k.stage === 'WALKUP') {
      return { x: 0, z: clamp(dir * (FIELD.tryZFar + 8), -BOUND_Z, BOUND_Z) };
    }
    /* Once the ball is struck he runs to where it is GOING, not where it is.
     * Trailing the ball itself left him 30 m behind a 50-metre touch-finder
     * and he arrived at the resulting lineout after it had been thrown —
     * measured at a median 11.7 m from his mark across the whole phase.
     *
     * Until the strike he stays with the kicker: a referee does not jog forty
     * metres downfield during the walk-up and leave the tee unattended. */
    const struck = k.stage === 'FLIGHT' || k.stage === 'RESULT';
    if (struck) {
      const off = k.landX >= 0 ? -5 : 5;
      return {
        x: clamp(k.landX + off, -BOUND_X, BOUND_X),
        z: clamp(k.landZ - dir * ref.depthNow, -BOUND_Z, BOUND_Z),
      };
    }
    return {
      x: clamp(k.bx + (k.bx >= 0 ? -5 : 5), -BOUND_X, BOUND_X),
      z: clamp(k.bz - dir * Math.min(ref.depthNow, 6), -BOUND_Z, BOUND_Z),
    };
  }

  let x = aim.x + (ph === 'OPEN_PLAY' ? blindSideOffset(d) : 0);
  let z = aim.z - dir * ref.depthNow;

  /* CLEAR THE CORRIDOR. He gets caught upfield — by a turnover, by a kick he
   * had chased, by a break that outran him — and the naive fix is to run
   * straight back through the ball, which puts the match official in the
   * middle of play. A real referee does the opposite: he steps WIDE and
   * re-enters behind it. The further upfield he is, the wider he goes. */
  const ahead = (ball.z - ref.z) * dir;          // negative = upfield of the ball
  if (ahead < 2) {
    const side = ref.x >= ball.x ? 1 : -1;
    x += side * clamp(3.5 - ahead, 0, 16);
  }

  x = clamp(x, -BOUND_X, BOUND_X);
  z = clamp(z, -BOUND_Z, BOUND_Z);

  return { x, z };
}

/**
 * A soft, one-directional repulsion from the thirty. They never move for him;
 * he always moves for them. Without this the first measurement put him inside
 * 1.5 m of a player on 18.7% of frames — standing in the defensive line, which
 * is exactly the "in the way" the actor was supposed to avoid.
 */
function yieldToPlayers(d: Director, ref: RefState, t: { x: number; z: number }) {
  const RANGE = 3.4;
  let px = 0, pz = 0;
  for (const p of d.live) {
    const dx = ref.x - p.x, dz = ref.z - p.z;
    const dd = Math.hypot(dx, dz);
    if (dd > RANGE || dd < 1e-3) continue;
    const w = (RANGE - dd) / RANGE;
    px += (dx / dd) * w; pz += (dz / dd) * w;
  }
  t.x = clamp(t.x + px * 5.0, -BOUND_X, BOUND_X);
  t.z = clamp(t.z + pz * 5.0, -BOUND_Z, BOUND_Z);
}

/* ------------------------------------------------------------------ *
 * THE SIGNAL ONE-SHOTS
 * ------------------------------------------------------------------ */

/**
 * Which arm signal a call gets. Deliberately coarse: a referee has six arm
 * shapes, not one per law, and the text in the bubble carries the detail.
 */
export function refSignalClipFor(call: string): string {
  const c = call.toUpperCase();
  if (c.startsWith('YELLOW') || c.startsWith('RED')) return 'refCard';
  if (c.startsWith('PENALTY')) return 'refSignalPenalty';
  if (c.startsWith('FREE KICK')) return 'refSignalAdvantage';
  if (c.startsWith('TRY')) return 'refSignalTry';
  if (c.startsWith('ADVANTAGE')) return 'refSignalAdvantage';
  if (c.startsWith('SCRUM')) return 'refSignalScrum';
  if (c.startsWith('KNOCK') || c.startsWith('FORWARD') || c.startsWith('TURNOVER')) return 'refSignalScrum';
  return 'refWhistle';
}

/* ------------------------------------------------------------------ *
 * INTEGRATION
 * ------------------------------------------------------------------ */

/**
 * One frame of the referee. He is the only writer of his own position, the same
 * ownership rule the thirty live under.
 */
export function stepReferee(d: Director, ref: RefState, dt: number) {
  const ball = refBallPoint(d);
  if (!ref.primed) { ref.bx = ball.x; ref.bz = ball.z; ref.primed = true; }
  const rvx = (ball.x - ref.bx) / Math.max(dt, 1e-4);
  const rvz = (ball.z - ref.bz) / Math.max(dt, 1e-4);
  const k = 1 - Math.exp(-dt * 4);
  ref.vbx += (rvx - ref.vbx) * k;
  ref.vbz += (rvz - ref.vbz) * k;
  ref.bx = ball.x; ref.bz = ball.z;

  /* He aims where the ball is going, never further than his own standoff
   * allows, so anticipation can never carry him upfield of it. */
  let lx = ref.vbx * LEAD, lz = ref.vbz * LEAD;
  const lm = Math.hypot(lx, lz);
  const cap = Math.min(7, ref.depthNow * 0.6);
  if (lm > cap && lm > 1e-3) { lx = lx / lm * cap; lz = lz / lm * cap; }
  const aim = { x: ball.x + lx, z: ball.z + lz };

  const T = refTarget(d, ref, ball, aim);
  yieldToPlayers(d, ref, T);
  ref.tx = T.x; ref.tz = T.z;

  const dx = T.x - ref.x, dz = T.z - ref.z;
  const dist = Math.hypot(dx, dz);
  const want = dist > 14 ? SPEED.burst : dist > 9 ? SPEED.run : dist > 5 ? SPEED.jog : dist > 0.6 ? SPEED.walk : 0;

  if (dist < 0.4 || want === 0) {
    /* arrival: decelerate to the mark, then hold */
    ref.vx *= Math.exp(-9 * dt);
    ref.vz *= Math.exp(-9 * dt);
  } else {
    const nx = dx / dist, nz = dz / dist;
    const ramp = clamp(dist / 2.4, 0.28, 1);
    const accel = 11;
    ref.vx += (nx * want * ramp - ref.vx) * (1 - Math.exp(-accel * dt));
    ref.vz += (nz * want * ramp - ref.vz) * (1 - Math.exp(-accel * dt));
  }

  ref.x = clamp(ref.x + ref.vx * dt, -BOUND_X, BOUND_X);
  ref.z = clamp(ref.z + ref.vz * dt, -BOUND_Z, BOUND_Z);
  ref.movedBy = 'ref';

  /* He watches the ball, not his feet. A real official backpedals and
   * side-steps while keeping his eyes on play; the renderer turns the angle
   * between this bearing and his travel into shuffle/strafe on its own. */
  const wantFace = Math.atan2(ball.x - ref.x, ball.z - ref.z);
  let dy = wantFace - ref.face;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  ref.face += dy * (1 - Math.exp(-dt * 7));

  /* One-shot signals override the gait. A new call restarts the swing; the
   * whistle that follows the same call does not. */
  if (ref.signalT > 0) ref.signalT = Math.max(0, ref.signalT - dt);
  if (d.refSignal > 0 && d.refSignalText) {
    const clip = refSignalClipFor(d.refSignalText);
    if (clip !== ref.signalClip) { ref.signalClip = clip; ref.signalT = refSignalDuration(clip); }
  } else if (ref.signalT <= 0) {
    ref.signalClip = '';
  }

  const sp = Math.hypot(ref.vx, ref.vz);
  if (ref.signalT > 0 && ref.signalClip) ref.clip = ref.signalClip;
  else if (sp < 0.7) ref.clip = 'refIdle';
  else if (sp < 3.0) ref.clip = 'refWalk';
  else if (sp < 6.0) ref.clip = 'refJog';
  else ref.clip = 'refRun';
}

/** Mirrors the authored clip durations; kept here so the engine owns the beat. */
function refSignalDuration(clip: string): number {
  switch (clip) {
    case 'refWhistle': return 0.6;
    case 'refSignalPenalty': return 1.0;
    case 'refSignalAdvantage': return 1.0;
    case 'refSignalScrum': return 1.0;
    case 'refSignalTry': return 0.9;
    case 'refCard': return 1.2;
    default: return 0.8;
  }
}
