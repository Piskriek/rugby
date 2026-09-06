/**
 * BREAKDOWN PLAN — the choreography of a ruck, presimulated.
 *
 * WHAT WAS WRONG
 * --------------
 * `assignCrew` picks the men who will contest a ruck by ETA — distance divided by
 * the speed that man can actually hold, forwards discounted because they are
 * supposed to be there. It is a real physics-aware selection. And then the
 * breakdown pinned the chosen men to slots beside the contact point and pulled
 * them there with an exponential ease, so the ETA was thrown away one line later:
 * every man arrived in about the same third of a second however far he had been,
 * nobody decelerated, they were forced to face upfield or downfield instead of at
 * the ball, and the first clearer was even flagged `down` before he had arrived.
 *
 * That is why a ruck reads as twelve men deciding to stand near each other. The
 * selection knew these were the guys who could get there first; the motion said it
 * didn't matter.
 *
 * WHAT THIS DOES
 * --------------
 * One plan per tackle episode, built once, from the real positions of the real
 * men, and sampled (never integrated) every frame:
 *
 *   • each committed man gets a LANE — a start, a lawful GATE he must pass through,
 *     a work position, a bow to get around the pile — and his speed profile along
 *     it comes out of a table that was SIMULATED OFFLINE (`scripts/breakdownbake.ts`)
 *     against the acceleration, cruise and per-frame-step limits the engine has to
 *     obey. Runtime cost per man per frame: one divide, one lerp, eight multiplies.
 *   • arrivals are therefore STAGGERED by the distance each man actually had to
 *     cover, and a man who is still two metres out shoves at part force, because
 *     the same `frac` that moves him also scales his contribution.
 *   • a CLEAROUT is an impulse on a body. When a clearer's profile says he arrives,
 *     the defender he came for takes a bounded velocity kick and his work position
 *     stumbles back along a baked decay curve. That displacement is what lowers the
 *     defence's force in `upBreakdown` — the clearout stops being a number and
 *     becomes the reason for the number.
 *   • the BALL is heeled: from the base of the ruck to the nine's feet along an arc,
 *     over the window the contest already computed. Slow ball is a slow arc.
 *
 * WHY PRE-SIMULATED, AND WHY NOT EVERYTHING
 * -----------------------------------------
 * The motion is presimulated because it is a *boundary value problem with a fixed
 * answer*: given a distance and a legal top speed, the time-optimal profile that
 * stays inside the no-teleport step cap does not depend on the match, the score or
 * the referee. Computing it 30 times a second, per man, to arrive at the same
 * curve is pure waste — so it is computed once offline over the whole space of
 * (distance × role × power) and shipped as a table of 16-sample curves.
 *
 * The CONTEST is not presimulated, and that is a deliberate asymmetry: the axis
 * ODE in `upBreakdown` answers to a button press the frame it happens, it costs
 * about a dozen flops, and baking it would trade the only interactive part of a
 * breakdown for a lookup nobody could influence. Motion is deterministic, outcome
 * is live. (FAIR-09's complaint about the old ruck was precisely that the outcome
 * could not be seen coming; a table would have hidden it harder.)
 *
 * NO RNG. This module never reads `R()`. Every variation in it comes from a hash of
 * the inputs — shirt numbers, contact coordinates — because the ambient seed seam
 * (`game/seed.ts`) makes the whole match a stream of `Math.random` reads, and a
 * choreographer that consumed two draws per tackle would silently re-roll every
 * kick, break and penalty in the audit. Look good, change no numbers.
 */

import type { Director, BreakdownState } from '../director';
import { clamp } from './clamp';
import timings from '../data/ruckTimings.json';

/* ------------------------------------------------------------------ types -- */

export type PlanRole = 'CARRY' | 'TACKLE' | 'CLEAR' | 'BIND' | 'JACKAL' | 'COUNTER' | 'NINE';

/** A baked motion curve: 16 normalised progress samples, plus what to do with them. */
export interface Curve {
  /** seconds to cover the distance at this profile */
  dur: number;
  /** progress fraction at 16 equal steps of time */
  prof: number[];
  /** fraction of the run at which contact happens (0 = no strike) */
  strike: number;
  /** m/s handed to the man being cleared */
  impulse: number;
  /** metres the target is expected to give */
  retreat: number;
  /** seconds after arrival for his shove to reach full strength */
  settle: number;
}

export interface PlanSlot {
  num: number;
  team: 'A' | 'B';
  role: PlanRole;
  /** where he actually stood when the tackle happened */
  sx: number; sz: number;
  /** the gate he must enter through, and the position he works from */
  gx: number; gz: number;
  wx: number; wz: number;
  /** lateral bow of the lane, metres. Signed: it is what keeps lanes apart. */
  bow: number;
  /** the curve this man runs */
  curve: Curve;
  /** seconds after the plan starts that he begins moving (a beat, not a wait) */
  delay: number;
  /** yaw once he is on his mark — facing the ball, not the try line */
  face: number;
  /** shirt of the man this clearer came for, -1 for nobody */
  targetNum: number;
  /** set by the sampler: 0..1 progress, and whether he has struck yet */
  frac: number;
  struck: boolean;
  /** match time his clearout landed, for telemetry and the harnesses (0 = never) */
  struckAt: number;
  /** BREAKING OFF. Armed the frame the ball leaves the ruck: -1 until then, and
   *  thereafter the metres this man has already peeled away by. */
  peelT: number;
  peelDX: number;
  peelDZ: number;
  peelX: number;
  peelZ: number;
  /** stumble state for a man who has been cleared */
  hitT: number;
  hitDX: number;
  hitDZ: number;
  hitPower: number;
  /** offset currently applied to his work position by the stumble */
  offX: number;
  offZ: number;
  /** how much of his shove is arriving: 1 planted, dropped while he is being cleared */
  shove: number;
}

export interface BallMove {
  /** 'HEEL' the base to the nine; 'RIP' held back over the defence */
  kind: 'HEEL' | 'RIP';
  x0: number; z0: number; x1: number; z1: number;
  t0: number; dur: number;
  bow: number;
}

export interface RuckPlan {
  /** match time the plan was built at */
  at: number;
  /** the contact point, kept for the ruck reference */
  cx: number; cz: number;
  fwd: number;
  slots: PlanSlot[];
  ball: BallMove | null;
  /** seconds the whole pile has been legal to contest (the ruck clock's start) */
  formed: number;
  /** the frame the jackal reached the ball — his window opens here, not at the tackle */
  jackalAt?: number;
  /** build cost, telemetry only */
  builtInMs: number;
  /** team:num -> slot. A breakdown asks this eight times a frame. */
  byId: Map<string, PlanSlot>;
  /** set once the ball has left and the men are entitled to walk away */
  peelArmed: boolean;
}

/** O(1) lookup of a man's lane. */
export function planSlotOf(plan: RuckPlan, team: 'A' | 'B', num: number): PlanSlot | null {
  return plan.byId.get(`${team}:${num}`) ?? null;
}

/* ------------------------------------------------------------------ table -- */

/**
 * The shipped table. Quantised to 3 decimals by the bake; if the file is missing
 * or short (a fresh checkout, a stripped build) every lookup falls back to the
 * procedural profile below rather than failing, because a broken table must not be
 * able to cost a match.
 */
interface TableFile {
  version: number; samples: number; distances: number[];
  roles: Record<string, Record<string, Curve[]>>;
  /** explicit key order, so a lookup never depends on JSON property order */
  tiers?: string[];
  stumble: number[];
}
const T = timings as unknown as TableFile;

/** Distance buckets, metres. A man 35 m out is not arriving on the same curve. */
const DIST = T?.distances ?? [0, 2, 4, 6, 9, 12, 16, 20, 25, 30, 36, 44];

/**
 * Fallback profile: a trapezoidal sprint — half the time easing in and out, the
 * middle at cruise. Monotone by construction, and it is what the bake's own curves
 * are nearest to, so a missing table is a small difference rather than a bug.
 */
function synthCurve(dist: number, speed: number): Curve {
  const n = T?.samples ?? 16;
  const dur = clamp(Math.sqrt(4 * dist / Math.max(1, speed * 2.2)), 0.16, 4.2);
  const prof: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    // smoothstep-ish integral of a trapezoid
    prof.push(clamp(u * u * (3 - 2 * u) * 0.94 + u * 0.06, 0, 1));
  }
  prof[prof.length - 1] = 1;
  return { dur, prof, strike: 0.86, impulse: 0, retreat: 0, settle: 0.34 };
}

/** Look up the curve for a role at a distance. Power tier is the crew count. */
export function curveFor(role: PlanRole, dist: number, power: number): Curve {
  const bucket = T?.roles?.[role];
  if (!bucket) return synthCurve(dist, role === 'NINE' ? 6.4 : 7.6);
  const tier = Math.min(2, Math.max(0, Math.round(power)));
  const list = bucket[T?.tiers?.[tier] ?? tier];
  if (!list?.length) return synthCurve(dist, 7.6);
  // nearest distance bucket, then blend the two neighbours on the raw distance
  let i = 0;
  while (i < DIST.length - 2 && DIST[i + 1] < dist) i++;
  const a = list[Math.min(i, list.length - 1)];
  const b = list[Math.min(i + 1, list.length - 1)];
  const span = Math.max(1e-3, DIST[Math.min(i + 1, DIST.length - 1)] - DIST[i]);
  const k = clamp((dist - DIST[i]) / span, 0, 1);
  if (k <= 0.001 || a === b) return a;
  const n = a.prof.length;
  const prof = new Array<number>(n);
  for (let j = 0; j < n; j++) prof[j] = a.prof[j] + (b.prof[j] - a.prof[j]) * k;
  return {
    dur: a.dur + (b.dur - a.dur) * k,
    prof,
    strike: a.strike + (b.strike - a.strike) * k,
    impulse: a.impulse + (b.impulse - a.impulse) * k,
    retreat: a.retreat + (b.retreat - a.retreat) * k,
    settle: a.settle + (b.settle - a.settle) * k,
  };
}

/** Interpolate a normalised progress at `u` (0..1) along a curve. */
function at(curve: Curve, u: number): number {
  const n = curve.prof.length;
  const f = clamp(u, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  return curve.prof[i] + (curve.prof[i + 1] - curve.prof[i]) * k;
}

/* ------------------------------------------------------------------ hash --- */

/**
 * A stable per-man variation. Not the match RNG — see the NO RNG note at the top.
 * Deterministic in (shirt number, contact point), so the same tackle choreographs
 * the same way twice, which is what makes the whole module testable headless.
 */
function hash(num: number, cx: number, cz: number, salt: number): number {
  let h = (num * 2654435761) ^ Math.round(cx * 977) ^ Math.round(cz * 613) ^ (salt * 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000;
}

/* ------------------------------------------------------------------ build -- */

/**
 * Choreograph one breakdown. Called ONCE per tackle episode, from `startBreakdown`,
 * after the crews exist and before any of them has moved.
 */
export function buildRuckPlan(d: Director, s: BreakdownState): RuckPlan {
  const t0 = performance.now();
  const atk = s.attacking;
  const fwd = atk === 'A' ? 1 : -1;
  const cx = s.contactX, cz = s.contactZ;
  const slots: PlanSlot[] = [];

  /* The gate. Law 16: a player joining a ruck must come from BEHIND his own
   * side's offside line and through the gate — the side of the ruck he is
   * entitled to. Building the lanes through a gate point rather than straight at
   * the ball is what makes an arriving forward run AROUND rather than THROUGH
   * the pile, which is the single most obviously wrong thing about a naive
   * breakdown: eight men converging on one point from every direction,
   * including straight over the top of it. */
  const atkGate = { x: cx + (cx > 0 ? -1.15 : 1.15), z: cz - fwd * 1.55 };
  const defGate = { x: cx - (cx > 0 ? -1.05 : 1.05), z: cz + fwd * 1.7 };

  const distOf = (p: { x: number; z: number }) => Math.hypot(p.x - cx, p.z - cz);
  const crew = s.crew.length + s.defCrew.length;

  let clearers = 0;
  for (const q of s.players) {
    const p = d.L(q.team, q.num);
    if (p.sinbin > 0) continue;
    const role: PlanRole =
      q.role === 'CARRIER' ? 'CARRY'
        : q.role === 'TACKLER' ? 'TACKLE'
          : q.role === 'JACKAL' ? 'JACKAL'
            : q.role === 'COUNTER' ? 'COUNTER'
              : q.role === 'FIRST CLEARER' ? 'CLEAR' : 'BIND';
    const mine = q.team === atk;
    /* A man already at the ball (the carrier, the tackler, anyone within a
     * metre) has no run to make: dur ~0 and the sampler parks him. */
    const dist = distOf(p);
    /* Power tier of the contest, not of the man: a ruck with six or more bodies in
     * it is entered at a walk, and the bake prices that in (crowded lanes are
     * slower, the collective shove is bigger). */
    const curve = curveFor(role, dist, crew >= 7 ? 2 : crew >= 4 ? 1 : 0);
    /* The lane bow. Half a metre per man in arrival order, alternating sides:
     * two clearers must not run the same line into the same body, and a pile of
     * men arriving in single file is a queue, not a clearout. */
    const idx = slots.length;
    if (q.team === atk && (role === 'CLEAR' || role === 'BIND')) clearers++;
    const bow = (mine ? 1 : -1) * (0.55 + 0.42 * (idx % 3)) * (hash(q.num, cx, cz, 1) > 0.5 ? 1 : -1);
    const gate = mine ? atkGate : defGate;
    /* Where he works. Attack binds on the near side of the ball and drives it
     * along; defence sets on the far side and holds. Slots from the old code were
     * laid out blind of the men; these are offsets from the ball that keep the
     * WIDTH of the ruck — a ruck is two lines, not a circle. */
    /* Half a metre of lateral jitter, and nothing wider. Both expansions were
     * tried and both cost more than they bought:
     *
     *   ±1.55 m lateral   the ruck stops looking like a knot, and the audit's team
     *                     shape goes with it — WARN 10/2/1/5 across four seeds
     *                     became 16/16/26/3 and FAIL 3/0/3/1 became 7/9/12/4,
     *                     because a support man running 1.6 m further sideways
     *                     arrives a half-second later and the contest, the penalty
     *                     and the line all move with him.
     *   +0.5 m per man of depth  the second and third men left the contest radius,
     *                     which is measured in metres to the BALL, and the jackal
     *                     stole 0 of 17 rucks: the realism gate and the law gate
     *                     were fighting over the same number.
     *
     * So the ruck stays narrow — which is honest anyway. A ruck is not a 4 m wall
     * of bodies, it is three or four men within an arm of the ball and everyone
     * else is either in the line or on the way. LOG-20's bunching warning belongs to
     * the shape of the whole backfield, not to this square metre of ground, and it
     * fires at the same rate on the old steering at 180 s (×5). */
    const lateral = (hash(q.num, cx, cz, 2) - 0.5) * 1.5;
    const wx = cx + lateral + (mine ? -0.35 : 0.35);
    const wz = cz + (mine ? -fwd * 0.75 : fwd * 0.8);
    /* Who this clearer came for. The defence's bodies in arrival order, so the
     * first clearer takes the jackal — the man over the ball is always the first
     * target, which is the actual rule of the clearout and the reason a good
     * support side wins rucks without out-manning anyone. */
    let targetNum = -1;
    if (mine && (role === 'CLEAR' || role === 'BIND')) {
      /* Nearest defender first, in order: the man over the ball is always the
       * first target, which is the actual rule of a clearout and the reason a
       * good support side wins rucks without out-manning anyone. Keyed off the
       * CLEARER's ordinal, not the slot index — the carrier and the tackler
       * occupy slots too, and indexing with those in the count handed the first
       * clearer the second defender and left the jackal unbothered. */
      const targets = s.players
        .filter((o) => o.team !== atk && o.num !== q.num)
        .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
      const t = targets[Math.min(targets.length - 1, clearers)];
      if (t) targetNum = t.num;
    }
    /* TIME IS CHARGED FOR THE PATH, NOT THE CHORD. The table's duration comes from
     * the DISTANCE to the ball; the lane is a bowed quadratic, so a man asked to
     * run a 1.7 m chord around a gate 3 m to the side in 0.32 s was covering 2.9 m
     * of ground in that time and taking 0.29 m steps — a stutter at five frames a
     * second on the men closest to the ruck, which are the men the camera is on.
     * Measuring the arc and stretching the time to hold MAX_LANE_SPEED fixes the
     * pacing and leaves the ordering alone, because a longer path genuinely does
     * take longer. The curve is COPIED when it has to change: it belongs to the
     * shared table, and mutating it there would re-time every later ruck. */
    const provisional: PlanSlot = {
      num: q.num, team: q.team, role,
      sx: p.x, sz: p.z,
      gx: gate.x + lateral * 0.5, gz: gate.z,
      wx, wz,
      bow, curve,
      /* A beat before the first man moves and a stagger after him. Real support
       * arrives one after another, roughly 0.15-0.3 s apart; the pile that forms
       * all at once is what made a ruck look scripted. */
      delay: 0.06 + 0.17 * idx * (0.7 + hash(q.num, cx, cz, 3) * 0.6),
      face: Math.atan2(cx - p.x, cz - p.z),
      targetNum,
      frac: 0, struck: false, struckAt: 0, shove: 1,
      peelT: -1, peelDX: 0, peelDZ: 0, peelX: 0, peelZ: 0,
      hitT: -1, hitDX: 0, hitDZ: 0, hitPower: 0, offX: 0, offZ: 0,
    };
    /* Two bounds, one duration. The mean keeps a man from covering a long lane in a
     * hurry; the peak keeps a frame from moving him further than a stride, which is
     * the number the teleport contract reads and the number a ruck's run-in is judged
     * by on screen. `peak * LANE_SAMPLES` is the step expressed as a whole-lane
     * equivalent: each step is covered in dur/LANE_SAMPLES seconds. */
    const need = Math.max(laneArc(provisional, lanePeakOut), lanePeakOut.v * LANE_SAMPLES)
      / MAX_LANE_SPEED;
    if (need > curve.dur) provisional.curve = { ...curve, dur: need };
    slots.push(provisional);
  }

  const plan: RuckPlan = {
    at: s.t, cx, cz, fwd, slots, ball: null, formed: 0, jackalAt: undefined,
    builtInMs: performance.now() - t0,
    byId: new Map(slots.map((sl) => [`${sl.team}:${sl.num}`, sl] as const)),
    peelArmed: false,
  };
  return plan;
}

/* ----------------------------------------------------------------- sample -- */

/** Where a man is this frame, sampled from his curve. */
/** A point on a slot's lane. One function, because the same geometry has to be
 *  measured at build time (below) and sampled at runtime, and two copies of a
 *  curve is two curves. */
function lanePoint(sl: PlanSlot, f: number): { x: number; z: number } {
  const inv = 1 - f;
  const tanX = sl.wx - sl.sx, tanZ = sl.wz - sl.sz;
  const len = Math.max(1e-3, Math.hypot(tanX, tanZ));
  /* Both deviations are SCALED BY THE LENGTH OF THE LANE, and that is the whole
   * shape of the thing. A man running 9 m into a ruck goes around the offside
   * gate and into the contest, and the curve should curl. A man standing 1.5 m
   * from the ball does not curl anywhere — and when the curl was unconditional the
   * jackal's 1.7 m chord became a 2.9 m path, which at the table's 0.32 s is
   * 0.28 m a frame: a five-frame-a-second stutter, on the one man the camera is
   * closest to. Same reason the timing looked wrong even though the maths was. */
  const curl = Math.min(1, len / 8) * 1.25;
  const midX = (sl.sx + sl.wx) * 0.5 + (sl.gx - (sl.sx + sl.wx) * 0.5) * curl;
  const midZ = (sl.sz + sl.wz) * 0.5 + (sl.gz - (sl.sz + sl.wz) * 0.5) * curl;
  const nx = sl.sx * inv * inv + 2 * midX * f * inv + sl.wx * f * f;
  const nz = sl.sz * inv * inv + 2 * midZ * f * inv + sl.wz * f * f;
  /* The bow is perpendicular to the lane, scaled by sin so it leaves and rejoins
   * the line — a lane that never returns ends with a man standing in open field
   * wondering why he is two metres from the ruck. */
  const sw = Math.sin(Math.PI * f) * sl.bow * Math.min(1, len / 5);
  return {
    x: nx + (-tanZ / len) * sw + sl.offX + sl.peelX,
    z: nz + (tanX / len) * sw + sl.offZ + sl.peelZ,
  };
}

/**
 * A lane's length and its fastest sample step, both from LANE_SAMPLES divisions.
 *
 * The step matters as much as the total, and capping only the total is what let a
 * 2.2 m jackal run-in carry a 0.27 m frame. A lane is a bowed quadratic whose
 * parameter is advanced at a constant rate, so the ground covered per frame is NOT
 * constant: the bow's perpendicular swing is at its fastest across the middle, and
 * with eight samples the measurement steps over exactly that — the sampler saw an
 * arc of 2.9 m for a run whose worst frame was 0.27 m, because the frame and the
 * sample happened to fall in different places. Sixteen divisions is every frame of
 * a third-of-a-second lane, which is the thing the eye is actually shown.
 */
const LANE_SAMPLES = 16;
function laneArc(sl: PlanSlot, peak?: { v: number }): number {
  let total = 0;
  let prev = lanePoint(sl, 0);
  let hi = 0;
  for (let i = 1; i <= LANE_SAMPLES; i++) {
    const p = lanePoint(sl, i / LANE_SAMPLES);
    const seg = Math.hypot(p.x - prev.x, p.z - prev.z);
    total += seg;
    if (seg > hi) hi = seg;
    prev = p;
  }
  if (peak) peak.v = hi;
  return total;
}
const lanePeakOut = { v: 0 };

/** A body cannot cover a lane faster than this, whatever the table says. */
const MAX_LANE_SPEED = 6.8;

/** How far a man peels off a ruck, and how fast. Under a jog on purpose: he is
 *  walking the line back into defence, not sprinting, and the whole point of the
 *  motion is that he has STOPPED being at the ball. */
const PEEL_SPEED = 2.6;
const PEEL_MAX = 1.35;


/**
 * T-41 — BREAKING OFF THE RUCK.
 *
 * The frame the ball leaves, eight men used to simply… stay there. That is the
 * single pose the old steering left behind at the end of every breakdown, it is
 * what the whole-side spacing rule (LOG-20) was counting as a bunch, and it is not
 * remotely what a ruck looks like: the guard releases and drifts back off his own
 * line the moment the ball is gone, because the next tackle is coming and he has
 * 1.5 seconds of grass to get.
 *
 * Displacement, not a re-authored destination — the same rule the stumble obeys.
 * The lane's endpoint stays where the contest needed it; this is added on top, so
 * the arrival order, the strike timings and the presence counts are untouched, and
 * the whole feature is rate-limited, so a man cannot be asked to be somewhere the
 * frame before he was.
 */
export function armPeel(plan: RuckPlan, t: number, fwd: number, atk: 'A' | 'B'): void {
  if (plan.peelArmed) return;
  plan.peelArmed = true;
  for (const sl of plan.slots) {
    /* The WINNING side's men peel. The losers at a ruck do not get to walk where
     * they like — Law 11.5 has them retiring to the offside line, and the line's
     * own mark already owns their depth; arming them here put three or four of
     * them a metre behind the ball at the restart and the offside clamp spent the
     * next 383 frames of a two-minute run dragging them back to it. Two systems
     * writing the same metre of ground is the fault, whether or not either of them
     * is individually right. */
    if (sl.team !== atk) continue;
    if (sl.role === 'CARRY' || sl.role === 'NINE') continue;
    /* Away from the ball, back the way he came, with a yard of width so two men
     * who arrived side by side do not leave stacked on each other. */
    let dx = sl.sx - sl.wx, dz = sl.sz - sl.wz;
    const l = Math.hypot(dx, dz);
    if (l < 0.25) { dx = -fwd * 0.4; dz = 0.9; } else { dx /= l; dz /= l; }
    sl.peelT = t;
    sl.peelDX = dx - dz * 0.3;
    sl.peelDZ = dz + dx * 0.3;
  }
}

export function stepPeel(sl: PlanSlot, dt: number): void {
  if (sl.peelT < 0) return;
  const d = Math.min(PEEL_MAX, Math.hypot(sl.peelX, sl.peelZ) + PEEL_SPEED * dt);
  const l = Math.hypot(sl.peelDX, sl.peelDZ) || 1;
  sl.peelX = (sl.peelDX / l) * d;
  sl.peelZ = (sl.peelDZ / l) * d;
}

export function sampleSlot(plan: RuckPlan, sl: PlanSlot, t: number): { x: number; z: number; frac: number; running: boolean } {
  const u = (t - plan.at - sl.delay) / Math.max(0.08, sl.curve.dur);
  const frac = clamp(u, 0, 1);
  sl.frac = frac;
  /* Sampled from `frac`, which is monotone, so a man never moves backwards and
   * never overshoots. */
  const p = lanePoint(sl, frac);
  return { x: p.x, z: p.z, frac, running: frac > 0.02 && frac < 0.985 };
}

/** Has this clearer arrived at his hit? Returns the impulse to apply, once. */
export function planStrike(sl: PlanSlot, t = 0): { power: number; dx: number; dz: number } | null {
  if (sl.struck || sl.curve.impulse <= 0 || sl.targetNum < 0) return null;
  if (sl.frac < sl.curve.strike) return null;
  sl.struck = true;
  sl.struckAt = t;
  const dx = sl.wx - sl.sx, dz = sl.wz - sl.sz;
  const len = Math.max(1e-3, Math.hypot(dx, dz));
  return { power: sl.curve.impulse, dx: dx / len, dz: dz / len };
}

/**
 * Give a man a stumble. `power` is metres per second shoveled into him; the
 * displacement he ends up taking is in the baked table, because the answer to "how
 * far does a cleanout move a body" is a property of the impulse and the ground, not
 * of this frame's dt.
 */
export function planHit(sl: PlanSlot, t: number, dx: number, dz: number, power: number, depth: number) {
  sl.hitT = t;
  sl.hitDX = dx; sl.hitDZ = dz;
  sl.hitPower = power;
  sl.curve.retreat = Math.max(sl.curve.retreat, depth);
}

/** The stumble decay, applied to a man's work offset. Call every frame. */
export function stepStumble(sl: PlanSlot, t: number, dt: number) {
  if (sl.hitT < 0) return;
  const prof = T?.stumble;
  const u = clamp((t - sl.hitT) / 0.55, 0, 1);
  const shape = prof?.length
    ? at({ dur: 1, prof, strike: 0, impulse: 0, retreat: 0, settle: 0 }, u)
    : 1 - (1 - u) * (1 - u);
  const wantX = sl.hitDX * sl.curve.retreat * shape;
  const wantZ = sl.hitDZ * sl.curve.retreat * shape;
  /* Rate-limited, not assigned. The curve is a SHAPE over 0.55 s and the sample
   * grid is 16 wide, so at 60 Hz a man who is 1.7 m from where he was standing
   * gets there in three frames — a shove that reads as a teleport, which is the
   * one thing this whole system exists to stop doing. A body being pushed off a
   * ruck moves at the speed of being pushed, so cap it at a fall: 8 m/s. */
  const max = Math.max(0, 8 * dt);
  sl.offX += clamp(wantX - sl.offX, -max, max);
  sl.offZ += clamp(wantZ - sl.offZ, -max, max);
  /* A struck man cannot shove at full strength while he is giving ground — and
   * that is said HERE, as a `shove` factor, not by moving him back along his lane.
   * The first version of this clipped `frac`, which is position: a man cleared at
   * the end of a 9 m run was flung 5 m backwards in a frame, a teleport dressed up
   * as physics, and the probe caught it at 0.45 m/frame against a 0.8 gate only
   * because the lane happened to be short. Displacement and effort are different
   * quantities and have to be stored separately. */
  sl.shove = 1 - 0.55 * (1 - u) * (1 - u);
  if (u >= 1 && dt > 0) { sl.hitT = -1; sl.shove = 1; }
}

/** The ball's heel, from the base of the ruck to the nine's feet. */
export function planBallOut(fromX: number, fromZ: number, toX: number, toZ: number, t: number, dur: number): BallMove {
  const bow = (fromX > toX ? -1 : 1) * 0.5;
  return { kind: 'HEEL', x0: fromX, z0: fromZ, x1: toX, z1: toZ, t0: t, dur: Math.max(0.14, dur), bow };
}

export function sampleBall(plan: RuckPlan, t: number): { x: number; z: number; y: number; active: boolean } {
  const b = plan.ball;
  if (!b) return { x: plan.cx, z: plan.cz, y: 0.16, active: false };
  const u = clamp((t - b.t0) / b.dur, 0, 1);
  const inv = 1 - u;
  const midX = (b.x0 + b.x1) * 0.5 + b.bow;
  const midZ = (b.z0 + b.z1) * 0.5;
  const x = b.x0 * inv * inv + 2 * midX * u * inv + b.x1 * u * u;
  const z = b.z0 * inv * inv + 2 * midZ * u * inv + b.z1 * u * u;
  /* The height of a heel is low and flat off the deck — it is dragged out with
   * the foot, not thrown. A rip is yanked backwards, so it climbs a little. */
  const lift = b.kind === 'RIP' ? 0.34 : 0.2;
  return { x, z, y: 0.16 + Math.sin(Math.PI * u) * lift, active: u < 1 };
}

/**
 * Who is ACTUALLY at the ball. The old contest counted the men assigned to a
 * side, which is a list of names chosen before anybody moved: a ruck "won on the
 * numbers" could be three defenders whose nearest teammate was 14 m behind them and
 * nobody at the base. Presence is the same rule, measured — a man counts when his
 * lane has brought him within a stride of his mark, and stops counting while he is
 * being shoved off it.
 */
/**
 * Who is AT the ball, in bodies that can act on it.
 *
 * The exclusions are the rule, not the tuning, and they are all the same rule: a
 * man who cannot compete for this ball is not a number at the breakdown.
 *
 *   CARRY  he is the man on the ground underneath it.
 *   NINE   he is 1.4 m away waiting to receive a ball that has not been won yet.
 *   TACKLE he is on his back with his hands off the ball, which is also precisely
 *          why a ruck has to form at all — count him and the defence is always one
 *          man up at every single breakdown, and the "more men wins it" law stops
 *          being a contest and becomes a 40% steal rate. That is exactly what it
 *          measured before this line existed.
 *
 * plus the two arrival tests: `frac >= 0.9` (he is there) and `shove >= 0.55`
 * (he is not currently being cleared off it).
 */
/**
 * Who is AT the ball — the count the ruck's law is applied to.
 *
 * `hands` (engine/hands.ts) is optional and changes one thing: a man whose hands are
 * ON the ball is at the ball, however badly his lane's finish reads. Without it the
 * count asked only whether a shove had arrived, so a jackal with a grip on the ball
 * for 1.25 s — the deepest, most contestable state a breakdown can be in — was
 * counted as ZERO bodies present, and the numbers law the referee is supposed to
 * apply could never see him. Measured on the build before this line existed: the
 * axis pinned at −1.00, hands on it for over a second, `presence 1 > 1`, and the ruck
 * simply expired with the defence sitting on a ball nobody could take.
 *
 * It does not weaken the law. A lone jackal still loses to a ruck the attack has
 * bodies in, because the attack's guards are counted the same way he is; what the
 * fix removes is the case where the defence was outnumbered only on paper.
 */
export function ruckPresence(
  plan: RuckPlan, atk: 'A' | 'B',
  hands?: { slots: { holding: boolean; gap: number }[] },
) {
  let a = 0, b = 0;
  for (let i = 0; i < plan.slots.length; i++) {
    const sl = plan.slots[i];
    if (sl.role === 'CARRY' || sl.role === 'NINE' || sl.role === 'TACKLE') continue;
    /* index-aligned with `plan.slots` by construction — `stepHands` builds its slots
     * from the same array in the same order, which is the only reason a hand can be
     * looked up by number here instead of by a join. */
    const hs = hands?.slots[i];
    const at = sl.frac >= 0.9 || sl.shove >= 0.55 || hs?.holding === true;
    if (!at) continue;
    /* AND IS HE AT THE BALL? A mark is not a position. The lane's destination is a
     * metre or two from the pile, so in a normal ruck this test costs a comparison
     * and changes nothing — which is exactly what makes it worth having: it is the
     * test that catches the case where a man was told to be somewhere and the
     * somewhere moved. Measured on a ruck whose support had been pushed 12 m back,
     * the count said 3 v 3 and the law refused a steal that had a defender holding
     * the ball for 2.7 seconds against nobody. */
    if (hs && hs.gap > PRESENCE_M) continue;
    if (sl.team === atk) a++; else b++;
  }
  return { atk: a, def: b };
}

/** How far from the ball a body still counts as at it, metres. Above this he is a
 *  player near a ruck, which is a completely different thing in law to a participant
 *  in one — offside is judged off the hindmost foot, and presence is what the numbers
 *  at the ball are counted from. */
const PRESENCE_M = 2.6;

/**
 * How much of the ruck's shove has ARRIVED. The contest used to ramp the whole
 * attack side on one global clock; this asks each man where he actually is, so a
 * support that is still running in genuinely is not there yet — and a support that
 * left earlier genuinely is. Same cost: one lerp per committed man.
 */
export function planArrivalForce(plan: RuckPlan): number {
  let f = 0; let n = 0;
  for (const sl of plan.slots) {
    if (sl.team !== 'A' && sl.team !== 'B') continue;
    if (sl.role !== 'CLEAR' && sl.role !== 'BIND') continue;
    n++;
    /* `frac` is position, not time: a man 90% of the way there is pushing at
     * 90%, because he is reaching the gate and can already get a shoulder in. */
    f += clamp(sl.frac * 1.15 - 0.1, 0, 1) * sl.shove;
  }
  return n ? f / n : 1;
}

/** Defence's side of the same question: cleared men are not at the ball. */
export function planDefenceForce(plan: RuckPlan): number {
  let f = 0; let n = 0;
  for (const sl of plan.slots) {
    if (sl.role !== 'JACKAL' && sl.role !== 'COUNTER' && sl.role !== 'TACKLE') continue;
    n++;
    const cleared = Math.hypot(sl.offX, sl.offZ);
    f += clamp(sl.frac * 1.1 - 0.1, 0, 1) * clamp(1 - cleared / 1.5, 0.15, 1) * sl.shove;
  }
  return n ? f / n : 1;
}
