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
  if (d.lo && (ph === 'LINEOUT' || ph === 'LINEOUT_REPLAY')) return { x: d.lo.ball.x, z: d.lo.ball.z };
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

/* ================================================================== *
 * TARCS — ADVANTAGE & WHISTLE SEQUENCING
 * ================================================================== */

/**
 * The advantage window, in SECONDS OF PLAY — the clock the referee stands on
 * the field with: engine time, the same seconds the frame loop ticks. The
 * DISPLAY match clock is compressed by the build's clockScale and is the
 * scoreboard's problem, not the official's: he judges how long play ran with
 * an arm raised, and ten seconds of that is what Law 7.4 allows before he
 * either calls advantage over or brings the game back.
 */
export const ADVANTAGE_WINDOW_S = 10;

/**
 * The territory that CASHES the advantage: a clean 10 metres gained past the
 * mark of the infringement, or an effective kick. The number is the law's
 * own yardstick at the restart (the 10 m offside line) used as the yardstick
 * for "has this advantage been worth having" — anything less and the referee
 * brings play back, which is the whole point of playing it: the reward must
 * be visible before it is banked.
 */
export const ADVANTAGE_TERRITORY_M = 10;

/** What a wind-back awards: the penalty itself, or a scrum at the mark. */
export type AdvantageAward = 'PENALTY' | 'SCRUM';

/**
 * The referee's advantage memory. The Director owns the instance
 * (`d.advWatch`) and every write it triggers; this object holds only what
 * the decision needs, which keeps the sequencing testable with no Director
 * at all — the headless probe drives `stepAdvantageWatch` with a synthetic
 * sensor.
 */
export interface AdvantageWatch {
  /** the NON-offending side; the side the advantage is played for. */
  team: 'A' | 'B';
  /** the award if the advantage is not taken. */
  award: AdvantageAward;
  /** the mark of the infringement — where the wind-back restarts play. */
  markX: number;
  markZ: number;
  /** the carrier's z when the watch opened (or the mark, for a restart). */
  originZ: number;
  /** did the beneficiary OWN the ball when the watch opened? A penalty
   *  advantage starts with possession — losing it is the wind-back trigger.
   *  A knock-on starts without it — gaining it IS the advantage. */
  startsOwned: boolean;
  /** engine-seconds of window budget. */
  window: number;
  /** engine-seconds observed so far. */
  elapsed: number;
  /** best territory gain measured, metres — exposed for the probe/audit. */
  maxGain: number;
}

/** The one-frame snapshot the sequencing reads. Pure data, Director-shaped. */
export interface AdvantageSensor {
  possession: 'A' | 'B';
  /** open-play carrier line, or null when no open play is running. */
  carrier: { z: number; dir: number } | null;
  /** the beneficiary's kick: ground it gains along its own axis. */
  kick: { gained: number } | null;
}

export type AdvantageOutcome = 'PLAY_ON' | 'OVER' | 'WINDBACK';

/** The option (0 short / 1 normal / 2 long) becomes a window in seconds of
 *  play. The default is the law's ten; SHORT is half of it, LONG a half
 *  again more, and the number is already in the referee's own clock — no
 *  conversion, the referee's seconds never re-tune themselves to the frame
 *  budget. */
export function advantageWindowEngineS(option: number | undefined): number {
  return option === 0 ? 5 : option === 2 ? 15 : ADVANTAGE_WINDOW_S;
}

/**
 * Open the watch. Cynical offences — the ones earning a card — never get an
 * advantage at all: the referee blows FIRST and the sanction is immediate;
 * callers decide that before they call in here.
 */
export function openAdvantageWatch(cfg: {
  team: 'A' | 'B';
  award: AdvantageAward;
  markX: number; markZ: number;
  originZ: number;
  startsOwned: boolean;
  window: number;
}): AdvantageWatch {
  return {
    team: cfg.team, award: cfg.award,
    markX: cfg.markX, markZ: cfg.markZ, originZ: cfg.originZ,
    startsOwned: cfg.startsOwned,
    window: Math.max(0.2, cfg.window), elapsed: 0, maxGain: 0,
  };
}

/**
 * One frame of sequencing. THE RULE, in full:
 *
 *   • the beneficiary gains more than ADVANTAGE_TERRITORY_M metres, or kicks
 *     the ball effectively by the same measure → 'OVER' — "Advantage Over",
 *     the penalty is gone, play runs;
 *   • the beneficiary, having started WITH the ball (a penalty advantage),
 *     loses it → 'WINDBACK' at once; there is nothing to play on for;
 *   • the window runs out: a penalty advantage that never gained its ten
 *     metres comes back — 'WINDBACK'; a restart advantage (a knock-on) where
 *     the non-offending side simply RECOVERED the ball has gained its
 *     advantage — an offence that cost the offender nothing and handed the
 *     game to the other side is not brought back for wanting ten metres;
 *   • otherwise 'PLAY_ON'.
 *
 * The wind-back path is where the whistle, the freeze and the restart at the
 * mark live — on the Director. Nothing here writes the world.
 */
export function stepAdvantageWatch(
  w: AdvantageWatch, sensor: AdvantageSensor, dt: number,
): AdvantageOutcome {
  w.elapsed += dt;
  const owned = sensor.possession === w.team;
  if (owned) {
    if (sensor.carrier) {
      const gain = (sensor.carrier.z - w.originZ) * sensor.carrier.dir;
      if (gain > w.maxGain) w.maxGain = gain;
      if (gain > ADVANTAGE_TERRITORY_M) return 'OVER';
    }
    if (sensor.kick && sensor.kick.gained > ADVANTAGE_TERRITORY_M) return 'OVER';
  } else if (w.startsOwned) {
    /* The team the advantage was played for gave the ball away. The referee
     * comes back for the penalty the instant the attack ends — Law 7.4. */
    return 'WINDBACK';
  }
  if (w.elapsed >= w.window) {
    if (!w.startsOwned && owned) return 'OVER';
    return 'WINDBACK';
  }
  return 'PLAY_ON';
}

/* ================================================================== *
 * THE LINEOUT THROW — LAW 19, JUDGED BY ANGLE
 * ================================================================== */

/**
 * The largest angle, in radians, between the throw's flight vector and the
 * lateral tunnel axis that the official tolerates. A lineout is a throw
 * ALONG the tunnel, to the line of jumpers: whatever the meter says, if the
 * ball leaves the hooker's hands at an angle beyond this it lands wide of
 * the catch plane, and the law gives the defence a free kick at the throw.
 *
 * Angle is the whole test. Timing (the meter) is a separate matter judged
 * by its own quality test; this one only ever sees the flight vector.
 */
export const LINEOUT_THROW_ANGLE_LIMIT = (15 * Math.PI) / 180;

/**
 * Pure judgement over a throw angle in radians, measured from the lateral
 * tunnel axis. The engine measures the angle from the throw's own velocity
 * at the moment of release (`releaseThrow` in engine/setpieces.ts) and
 * hands it here; the referee compares it with the limit and nothing else.
 * True = not in straight.
 */
export function judgeLineoutThrow(angleRad: number): boolean {
  return angleRad > LINEOUT_THROW_ANGLE_LIMIT;
}

/* ================================================================== *
 * SPEC_08 — THE MAUL STALL LAW: "USE IT" (Law 16.11 / Law 17)
 * ================================================================== *
 *
 * The referee monitors FORWARD PROGRESS, nothing else. When the maul's
 * rolling speed dies below the movement epsilon the stall clock runs;
 * when the maul rolls again the clock bleeds back toward zero at half
 * again the rate it accrued (a twitch is not progress, a real roll is).
 *
 *   1. stall longer than MAUL_STALL_WARN_S → the audible/visual
 *      "USE IT!" warning (a shout, never the whistle — play continues);
 *   2. from that warning the attacking side has MAUL_USE_IT_WINDOW_S
 *      seconds to extract the ball;
 *   3. the window expires while the defence still holds it up → the
 *      whistle: unplayable maul, TURNOVER SCRUM to the defending team
 *      (Law 16.11 / Law 17). Under the STOP TWICE ladder the first
 *      expiry is the management call ("stopped once — use it or lose
 *      it") and only the SECOND expiry escalates to the penalty.
 *
 * Exactly like the advantage watch, the whole sequencing is one pure
 * function over a plain frame — the engine keeps the clock, the referee
 * keeps the law, and the probe drives it without a Director.
 */

/** Forward progress this slow is no progress. The maul's reverse band
 *  (−0.5 m/s) is well past it, so a maul being shoved BACKWARD still
 *  counts as motion — it is moving, the referee lets it be moved. */
export const MAUL_STALL_MOVEMENT_EPS = 0.12;

/** Seconds of no forward progress before the referee calls "USE IT!". */
export const MAUL_STALL_WARN_S = 3.0;

/** Seconds from the "USE IT!" warning to the whistle. */
export const MAUL_USE_IT_WINDOW_S = 5.0;

/** Total stall seconds at which the referee must blow. Named once, read
 *  by the law and by the presentation clock, so the countdown the player
 *  sees and the whistle the engine blows can never drift apart. */
export const MAUL_STALL_WHISTLE_S = MAUL_STALL_WARN_S + MAUL_USE_IT_WINDOW_S;

/** The decay rate of the clock while the maul rolls, relative to how it
 *  accrues while it stalls. */
export const MAUL_STALL_BLEED = 1.5;

export interface MaulStallFrame {
  /** signed rolling speed in the attacking frame, m/s. */
  speed: number;
  /** seconds below the movement epsilon. */
  stallClock: number;
  /** the "USE IT!" warning has been issued. */
  warned: boolean;
  /** the maul has already been stopped once (the STOP TWICE ladder). */
  stoppedOnce: boolean;
  /** the DEFENCE holds it up. Only then does the stall resolve to the
   *  whistle — an attack-controlled maul has its own clock (the exits). */
  defenceHeld: boolean;
  /** the live maul law: 0 = STOP ONCE, 1 = STOP TWICE. */
  law: 0 | 1;
}

export type MaulStallVerdict =
  /** moving: the stall clock bleeds. */ | 'ROLLING'
  /** held, clock running, warning not yet due. */ | 'STALLING'
  /** the 3-second warn fires THIS frame. */ | 'WARN_USE_IT'
  /** law 1, first expiry: the ladder resets, one more chance. */ | 'STOP_ONCE'
  /** expiry: unplayable maul, turnover scrum to the defence. */ | 'UNPLAYABLE'
  /** law 1, second expiry: penalty against the stalled attack. */ | 'PENALTY_STOP';

/**
 * One frame of the referee's stall watch. Mutates only the clock fields
 * of the frame (stallClock, warned, stoppedOnce) — the same ownership
 * split as stepAdvantageWatch: the clock is data, the decision is the
 * return value, and acting on it (beginMaulExit, beginPenalty) is the
 * engine's, downstream.
 */
export function stepMaulStall(f: MaulStallFrame, dt: number): MaulStallVerdict {
  if (Math.abs(f.speed) >= MAUL_STALL_MOVEMENT_EPS) {
    f.stallClock = Math.max(0, f.stallClock - dt * MAUL_STALL_BLEED);
    return 'ROLLING';
  }
  f.stallClock += dt;
  if (f.stallClock > MAUL_STALL_WARN_S && !f.warned) {
    f.warned = true;
    return 'WARN_USE_IT';
  }
  if (f.stallClock < MAUL_STALL_WHISTLE_S || !f.defenceHeld) return 'STALLING';
  if (f.law >= 1 && !f.stoppedOnce) {
    f.stoppedOnce = true;
    f.stallClock = 0;
    f.warned = false;
    return 'STOP_ONCE';
  }
  return f.law >= 1 ? 'PENALTY_STOP' : 'UNPLAYABLE';
}

/** The seconds of extraction time the countdown may honestly show, from
 *  the current stall clock. This is THE number the HUD/overlay quote:
 *  time to the real consequence of the state the maul is in. */
export function maulUseItRemaining(stallClock: number): number {
  return Math.max(0, MAUL_STALL_WHISTLE_S - stallClock);
}

/* ================================================================== *
 * SPEC_08 — THE COLLAPSE ADJUDICATION
 * ================================================================== *
 *
 * A maul comes to ground one of two ways, and the law's answer is
 * different for each:
 *
 *   LEGAL collapse (the drive tears its own legs away, the pile simply
 *     falls): the whistle, an UNPLAYABLE maul, turnover scrum to the
 *     defence — same terminal award as the stall, treated the same.
 *   DELIBERATE collapse (a defending player pulls the maul down): an
 *     IMMEDIATE penalty against the defence — no "use it" management,
 *     no advantage ladder. Law 16.5: a player must not collapse a maul.
 *
 * The hazard is a rate pair in per-second, a function of the contest's
 * shape: a balanced, rolling maul essentially never falls; a maul being
 * wrenched sideways (imbalance) or held to death (stall) starts to
 * wobble. The deliberate share is priced separately and only exists at
 * all while the defence is the side under shove pressure.
 */

export interface MaulCollapseHazard {
  /** per-second rate of an accidental (legal) collapse. */
  legal: number;
  /** per-second rate of a deliberate defensive pull-down. */
  deliberate: number;
}

/** Base hazard at even shove: a rare event across a whole match. */
export const MAUL_COLLAPSE_BASE_RATE = 0.004;
/** Extra hazard at full shove imbalance per second. */
export const MAUL_COLLAPSE_IMBALANCE_RATE = 0.028;
/** Extra hazard per stalled second per second (the legs die). */
export const MAUL_COLLAPSE_STALL_RATE = 0.0035;
/** Of the deliberate share the defence might sink to: under real
 *  imbalance one pull-down in five collapses in law becomes a penalty. */
export const MAUL_COLLAPSE_DELIBERATE_SHARE = 0.22;

export function maulCollapseHazard(spec: {
  /** |net force| relative to the sum of both drives, 0..1. */
  imbalance: number;
  /** seconds the maul has been stalled. */
  stallClock: number;
}): MaulCollapseHazard {
  const im = clamp(Number.isFinite(spec.imbalance) ? spec.imbalance : 0, 0, 1);
  const stall = Math.max(0, Number.isFinite(spec.stallClock) ? spec.stallClock : 0);
  const legal = MAUL_COLLAPSE_BASE_RATE * (0.2 + im * 2)
    + MAUL_COLLAPSE_IMBALANCE_RATE * im * im
    + MAUL_COLLAPSE_STALL_RATE * stall;
  const deliberate = im > 0.42 ? legal * MAUL_COLLAPSE_DELIBERATE_SHARE * (im - 0.42) / 0.58 * 4 : 0;
  return { legal, deliberate };
}

/** The referee's answer to a maul on the floor. Pure. */
export function judgeMaulCollapse(deliberate: boolean): 'PENALTY' | 'UNPLAYABLE_SCRUM' {
  return deliberate ? 'PENALTY' : 'UNPLAYABLE_SCRUM';
}

/* ================================================================== *
 * TACTICAL KICKING — LAW 18.6 (50:22), LAW 18.9 (TOUCH), LAW 18.11
 * (THE MARK) AND LAW 9.17 (THE MAN IN THE AIR)
 * ================================================================== *
 *
 * All four are stated here as PURE FUNCTIONS over plain frames, exactly
 * like the advantage watch and the maul stall above: the engine keeps the
 * clock and the coordinates, the referee keeps the law, and the probe
 * drives every branch without a Director. `engine/kick.ts` and
 * `game/director.ts` do nothing but read a verdict and act on it.
 */

/** The halfway line. A kick is "from inside your own half" when the mark
 *  sits behind it in the kicker's own direction of attack. */
export const HALFWAY_Z_M = 0;

/** Law 1 — the 22-metre line, measured from the goal line at ±50 m. The
 *  opponent's 22 for a side attacking +z is the band z ∈ [28, 50]. */
export const TWENTY_TWO_FROM_GOAL_M = 22;

/** The touchline the ball has to cross for any of this to be touch. The
 *  engine's playing surface is ±34.6 m (touch-in-goal included). */
export const TOUCH_X_M = 34.6;

/** The goal line at the end a side attacking `dir` is running at. */
export const attackGoalZ = (dir: 1 | -1): number => dir > 0 ? 50 : -50;

/** The near edge of the opposition 22 for a side attacking `dir`: 28 for
 *  +z, −28 for −z. Signed, in world z. */
export function oppTwentyTwoLineZ(dir: 1 | -1): number {
  return attackGoalZ(dir) - dir * TWENTY_TWO_FROM_GOAL_M;
}

/** The near edge of a side's OWN 22 (the band they defend). */
export function ownTwentyTwoLineZ(dir: 1 | -1): number {
  return -attackGoalZ(dir) + dir * TWENTY_TWO_FROM_GOAL_M;
}

/** True when (x, z) is inside the 22 a side attacking `dir` is kicking AT
 *  — the band between the opposition 22-metre line and their goal line,
 *  including the in-goal beyond it (a 50:22 may cross touch-in-goal). */
export function insideOppTwentyTwo(dir: 1 | -1, z: number): boolean {
  return (z - oppTwentyTwoLineZ(dir)) * dir >= 0;
}

/** True when (x, z) is inside a side's OWN 22 or their own in-goal — the
 *  band the Mark (Law 18.11) may be called in. */
export function insideOwnTwentyTwo(dir: 1 | -1, z: number): boolean {
  return (z - ownTwentyTwoLineZ(dir)) * dir <= 0;
}

/** True when a kick's mark is behind the halfway line in the kicker's own
 *  frame — the "from inside your own half" half of Law 18.6. */
export function fromOwnHalf(dir: 1 | -1, markZ: number): boolean {
  return markZ * dir < HALFWAY_Z_M;
}

/**
 * LAW 18.6 — THE 50:22. One frame of the kick, judged whole.
 *
 * The four conditions, all of which must hold:
 *   1. the kick was taken from inside the kicking team's own half;
 *   2. the ball BOUNCED in the field of play (indirect — a kick straight
 *      into touch on the full is an ordinary touch kick, whoever it
 *      favours);
 *   3. it went into touch inside the opposition 22;
 *   4. no player of the DEFENDING side touched it in between (a defensive
 *      touch kills the 50:22 dead — the deflection makes it their ball).
 *
 * The reward is the lineout THROW to the kicking side at the touch mark.
 */
export interface FiftyTwentyTwoFrame {
  /** the kicking side's direction of attack. */
  dir: 1 | -1;
  /** the z of the mark the kick was struck from. */
  markZ: number;
  /** where the ball crossed the touchline. */
  touchZ: number;
  /** bounces in the field of play before it crossed. */
  bounces: number;
  /** true when a DEFENDER touched the ball between boot and touch. */
  defenceTouched: boolean;
}

export function isFiftyTwentyTwo(f: FiftyTwentyTwoFrame): boolean {
  if (f.defenceTouched) return false;
  if (f.bounces < 1) return false;
  if (!fromOwnHalf(f.dir, f.markZ)) return false;
  return insideOppTwentyTwo(f.dir, f.touchZ);
}

/**
 * LAW 18 — WHO THROWS IN. One decision for every ball that crosses the
 * touchline off a kick:
 *
 *   'KICKER'    — the 50:22 (and its mirror, the 22:50, from a side's own
 *                 22 into the opposition half; not modelled separately
 *                 here because the engine's kick marks carry the same
 *                 frame and the reward is identical);
 *   'OPPOSITION'— every ordinary touch kick. A kick straight into touch
 *                 on the full from outside the 22 gains no ground in law:
 *                 the lineout comes BACK to the kicking mark. Otherwise
 *                 the lineout is where it crossed.
 */
export type TouchThrow = 'KICKER' | 'OPPOSITION';

export interface TouchKickFrame extends FiftyTwentyTwoFrame {
  /** true when the kick was taken from inside the kicker's own 22 — the
   *  band that keeps the gain of ground on a kick straight out. */
  fromOwn22: boolean;
}

export interface TouchKickAward {
  /** which side throws in. */
  throwTo: TouchThrow;
  /** the z of the lineout mark. */
  markZ: number;
  /** true when this was a 50:22 (presentation reads it for the call). */
  fifty22: boolean;
  /** true when the mark was pulled back to the kick because the ball
   *  found touch on the full from outside the 22 (Law 18.9). */
  broughtBack: boolean;
}

export function judgeTouchKick(f: TouchKickFrame): TouchKickAward {
  if (isFiftyTwentyTwo(f)) {
    return { throwTo: 'KICKER', markZ: f.touchZ, fifty22: true, broughtBack: false };
  }
  /* Law 18.9 — direct to touch (no bounce) from outside the kicker's own
   * 22 gains no ground: the throw is the opposition's, back at the kick. */
  const direct = f.bounces < 1;
  const broughtBack = direct && !f.fromOwn22;
  return {
    throwTo: 'OPPOSITION',
    markZ: broughtBack ? f.markZ : f.touchZ,
    fifty22: false,
    broughtBack,
  };
}

/* ------------------------------------------------------------------ *
 * LAW 18.11 — THE MARK
 * ------------------------------------------------------------------ */

/** How high the catch must be taken for it to be a mark: a ball plucked
 *  out of the air, not scooped off the boot. Metres. */
export const MARK_MIN_CATCH_HEIGHT_M = 1.0;

/** The ball must have come off an OPPONENT'S boot on the full. */
export interface MarkFrame {
  /** the catching side's direction of attack. */
  dir: 1 | -1;
  /** the catcher's z. */
  catchZ: number;
  /** the height the ball was taken at. */
  catchY: number;
  /** true when the catcher is on the DEFENDING side of the kick. */
  opponentKick: boolean;
  /** bounces before the catch — a mark is a catch ON THE FULL. */
  bounces: number;
  /** the catch was clean (two hands, held). */
  clean: boolean;
}

/** Law 18.11 — "MARK!" A clean catch on the full, inside your own 22 or
 *  in-goal, off an opponent's kick. The award is an unpressured free kick
 *  at the spot of the catch. */
export function isMarkCall(f: MarkFrame): boolean {
  if (!f.clean || !f.opponentKick) return false;
  if (f.bounces > 0) return false;
  if (f.catchY < MARK_MIN_CATCH_HEIGHT_M) return false;
  return insideOwnTwentyTwo(f.dir, f.catchZ);
}

/* ------------------------------------------------------------------ *
 * AERIAL CONTESTS AND LAW 9.17 — THE MAN IN THE AIR
 * ------------------------------------------------------------------ */

/** A contesting jump: the vertical impulse a player leaves the ground
 *  with when he goes up for a high ball. Metres per second. Higher than
 *  the ordinary running jump — he is going up, not forward. */
export const AERIAL_JUMP_IMPULSE = 5.4;

/** The gravity the aerial jump falls back under. Matches the engine's own
 *  jump integrator so a contest and a hurdle read the same. */
export const AERIAL_JUMP_GRAVITY = 13.5;

/** How far from the ball's predicted landing point a player may be and
 *  still commit to the jump. Metres. */
export const AERIAL_CONTEST_RADIUS_M = 1.6;

/** How high the ball must be descending through for the contest to be an
 *  aerial one at all — below this it is a routine catch. Metres. */
export const AERIAL_CONTEST_MIN_BALL_Y = 2.6;

/** The window, in seconds of ball flight remaining, in which a converging
 *  player times his leap. */
export const AERIAL_JUMP_WINDOW_S = 0.42;

export interface AerialContestFrame {
  /** the ball's height right now. */
  ballY: number;
  /** the ball's vertical velocity (negative = descending). */
  ballVY: number;
  /** the contesting player's distance from the ball's landing mark. */
  distanceToMark: number;
  /** seconds until the ball is at catching height. */
  eta: number;
  /** the player is already airborne. */
  airborne: boolean;
  /** the player is available to contest at all (fit, not bound, not
   *  binned, not on the floor). */
  eligible: boolean;
}

/** Should this man leave the ground NOW to contest the high ball? */
export function shouldContestAerial(f: AerialContestFrame): boolean {
  if (!f.eligible || f.airborne) return false;
  if (f.ballVY >= 0) return false;                      // still going up
  if (f.ballY < AERIAL_CONTEST_MIN_BALL_Y) return false;
  if (f.distanceToMark > AERIAL_CONTEST_RADIUS_M) return false;
  return f.eta <= AERIAL_JUMP_WINDOW_S;
}

/**
 * LAW 9.17 — a player must not tackle, charge, pull, push or grasp an
 * opponent whose feet are off the ground.
 *
 * The offence is judged on the VICTIM'S feet, not the offender's: two men
 * both in the air contesting the same ball is a legal aerial contest, and
 * a man who lands and is then tackled is an ordinary tackle. The sanction
 * is not negotiable and is not played on: penalty, and the offender is
 * carded (Law 9.17 is in the foul-play chapter, and World Rugby's
 * sanction framework starts a challenge in the air at yellow).
 */
export const AERIAL_TACKLE_CALL = 'PENALTY — TACKLING THE MAN IN THE AIR';

/** Ten match-minutes in the engine's sin-bin units. */
export const SIN_BIN_SECONDS = 600;

export interface AerialTackleFrame {
  /** the man being challenged has both feet off the ground. */
  victimAirborne: boolean;
  /** the challenger's own feet are off the ground (a legal contest). */
  offenderAirborne: boolean;
  /** they are close enough for the challenge to be a contact. */
  contact: boolean;
  /** the challenger and the victim are on opposite sides. */
  opponents: boolean;
}

export type AerialTackleVerdict = 'LEGAL' | 'PENALTY_YELLOW';

export function judgeAerialTackle(f: AerialTackleFrame): AerialTackleVerdict {
  if (!f.contact || !f.opponents) return 'LEGAL';
  if (!f.victimAirborne) return 'LEGAL';
  /* Two men in the air for the same ball is the contest the law protects,
   * not the offence it punishes. */
  if (f.offenderAirborne) return 'LEGAL';
  return 'PENALTY_YELLOW';
}

/* ------------------------------------------------------------------ *
 * THE SIN BIN — 14 v 15
 * ------------------------------------------------------------------ */

/** Where a binned player stands: OUTSIDE the field of play, over the
 *  touchline, out of every phase. Past the 34.6 m touch-in-goal bound so
 *  that "is he on the pitch" is a coordinate test, not a flag test, and no
 *  formation, ruck, scrum or lineout can ever place a body on top of him. */
export const SIN_BIN_TOUCH_X_M = 37;

/**
 * The bin mark for a carded man. He walks to the NEAREST touchline — a
 * player sent off does not cross the field to a designated corner — so the
 * walk is the few seconds it actually costs, and two men in the bin at once
 * are spread along the line rather than stacked on one spot.
 */
export function sinBinMark(
  team: 'A' | 'B', num: number, from?: { x: number; z: number },
): { x: number; z: number } {
  const side = from && Number.isFinite(from.x) && from.x < 0 ? -1 : 1;
  const dir = team === 'A' ? 1 : -1;
  const z0 = from && Number.isFinite(from.z) ? from.z : -dir * 16;
  /* Held near where he left the field, nudged apart by shirt so two carded
   * men never occupy the same metre of touchline, and clamped in-stadium. */
  const z = z0 + (num % 5) * 1.4 - 2.8;
  return { x: side * SIN_BIN_TOUCH_X_M, z: z < -56 ? -56 : z > 56 ? 56 : z };
}

/** One tick of a player's bin timer, in match seconds. Pure: returns the
 *  new value, so the caller owns the write. */
export function tickSinBin(sinbin: number, dt: number, clockScale: number): number {
  if (!(sinbin > 0)) return 0;
  const next = sinbin - dt * clockScale;
  return next > 0 ? next : 0;
}

/** A binned man may only come back at a STOPPAGE — the ball being dead is
 *  what makes the re-entry lawful (Law 9.28 / the touch judge's flag). */
export const SIN_BIN_RETURN_PHASES = ['KICK', 'SCRUM', 'LINEOUT', 'REPLAY'] as const;

export function sinBinMayReturn(sinbin: number, phase: string): boolean {
  return sinbin <= 0 && (SIN_BIN_RETURN_PHASES as readonly string[]).includes(phase);
}
