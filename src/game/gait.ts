/* --------------------------------------------------- GAIT & TURN (WS14) ---
 * ENGINE INNOVATION PLAN, I-2 / WS14 — Continuous gait and turning from the
 * 2D kinematics. This module is deliberately HEADLESS (no three.js): the pure
 * turning/gait math lives here so the headless simulator and its probes can
 * assert human-turn-rate ceilings (plan C6 "Gait/turn probe") and so both the
 * cheap stand-in and the animated rig share ONE ground truth for how a body
 * turns. It is the seed of the plan's `gait.ts` continuous-gait controller:
 * locomotion as a function of state, never a clip-selection of a turret.
 *
 * WHY THE TURN RATE EXISTS. A body has mass; it cannot rotate like a turret.
 * The heading update used to chase its target with a pure exponential (rate
 * ~10/s), which spun a slow man through a 180-degree watch of the ball in
 * about a third of a second and set every direction change as an instant snap
 * the model could never have made — the standing "models turn frantically /
 * move slow but spin fast" defect.
 *
 * These cap angular speed by gait. A man who is nearly still and watching the
 * ball PLANTS AND PIVOTS in place at a human rate (the shuffle-to-face that
 * makes defence look shaped rather than chased); a man in full flight may lead
 * a hard cut faster, but never spins. Radians per second. (Run/walk thresholds
 * mirror locomotion(): idle <0.7, walk <3.0, run <6.4, else sprint.) */
export const TURN_PIVOT = 3.4;    // in-place watch of the ball   (~195 deg/s)
export const TURN_WALK = 4.5;     // ambling to a slot            (~258 deg/s)
export const TURN_RUN = 6.0;      // chasing / covering            (~344 deg/s)
export const TURN_SPRINT = 7.5;   // a hard cut at pace            (~430 deg/s)

/** Advance a facing toward `target` by at most `rate` rad/s, the shortest way
 *  round. Pure bounded integration rather than an exponential chase, so a large
 *  turn is spread over a realistic interval instead of mostly done in the first
 *  few frames. */
export function stepTurn(face: number, target: number, rate: number, step: number): number {
  let dy = target - face;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  const cap = rate * step;
  if (dy > cap) return face + cap;
  if (dy < -cap) return face - cap;
  return face + dy;
}

/** The signed, wrapped shortest-way delta from `face` to `target`, radians in
 *  (-Math.PI, Math.PI]. Exposed for tests and for gaze/heading callers that
 *  need the turn to actually perform. */
export function wrappedDelta(face: number, target: number): number {
  let dy = target - face;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return dy;
}

/** Human turn-rate for a man travelling at this ground speed, rad/s. */
export function turnRateFor(spd: number): number {
  if (spd < 0.7) return TURN_PIVOT;
  if (spd < 3.0) return TURN_WALK;
  if (spd < 6.4) return TURN_RUN;
  return TURN_SPRINT;
}

/** Absolute human ceiling a rendered head/body may turn in one rendered second,
 *  regardless of gait — the C6 probe gate: a slow man's facing rate must never
 *  exceed this. A fast sprint may lead a cut at TURN_SPRINT, which stays under
 *  it. */
export const TURN_CEILING = TURN_SPRINT;

/* ------------------------------------------------- CONTINUOUS GAIT CORE ----
 * I-2: locomotion as a continuous function of ground-truth speed and turn
 * rate, NOT a four-bucket clip selection. These are pure numbers — cadence,
 * stride, phase rate, effort-lean and arm-pump — that a renderer turns into
 * motion. A per-player *gait signature* (`strideBias`) is the plan's I-2 idea
 * that a prop plods and a winger visibly covers more ground at the same engine
 * speed: at a fixed ground speed a long-stride man (bias > 0) swings a longer
 * stride at a lower cadence; a short-stride man (bias < 0) churns faster. A
 * taller man (`size`, the T-39 build 0.92..1.12) lengthens the base stride the
 * same way longer legs would.
 *
 * Speed model (m/s ground truth): <1.0 creep, <2.6 walk, <5.0 jog, <7.4 run,
 * else sprint. `effort` is a continuous 0..1 of how hard the body is working,
 * which drives stride length, cadence, arm pump and forward lean all together,
 * so there is no bucket seam anywhere. */

export interface GaitInput {
  /** ground-truth forward speed, m/s */
  spd: number;
  /** signed turn rate currently being executed, rad/s (0 for straight) */
  turnRate: number;
  /** per-player gait signature in [-1, 1]: >0 = long-stride/power runner,
   *  <0 = short-stride/quicker feet. Modulates cadence/stride & lean. */
  strideBias: number;
  /** T-39 build in [0.92, 1.12]; 1.0 is the reference man. */
  size: number;
}

export interface GaitSynthesis {
  /** 0..1 continuous effort (idle creep → full sprint). */
  effort: number;
  /** steps per second (one full gait cycle = 2 steps). */
  cadence: number;
  /** metre per step, so `spd ≈ cadence * stride`. */
  stride: number;
  /** radians/second of the limb phase oscillator; 2*PI per stride. */
  phaseRate: number;
  /** forward torso lean, radians (0 standing, ~0.35 full sprint). */
  lean: number;
  /** 0..1 arm-pump intensity for the run arm swing. */
  armPump: number;
  /** signed cross-over/hip set: grows with turn rate so a cutting man opens
   *  his hips before the foot crosses (radians). */
  hipSet: number;
}

const CREEP = 1.0, WALK = 2.6, TOP = 10.0;

const clamp = (v: number, lo: number, hi: number) => v < lo ? lo : (v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Continuous 0..1 effort from ground speed, smoothed across the gait
 *  boundaries so nothing snaps when a man crosses 5.0 m/s. */
export function gaitEffort(spd: number): number {
  if (spd <= CREEP) return 0;
  return clamp((spd - CREEP) / (TOP - CREEP), 0, 1);
}

/** Base cadence (steps/s) purely from speed, before personal signature. */
function baseCadence(spd: number): number {
  // a walk ~1.6 steps/s rising to ~4.6 steps/s at full sprint, continuous.
  return 1.6 + 3.0 * gaitEffort(spd);
}

/** Personal cadence multiplier from stride bias and size, anti-correlated with
 *  stride length: at a fixed speed a long-stride/power runner (bias > 0) takes
 *  FEWER, longer steps (lower cadence); a short-stride man (bias < 0) churns
 *  more steps. Bigger legs (size > 1) also step at a lower cadence. Because
 *  stride grew by (1 + 0.16·bias), cadence shrinks by (1 − 0.16·bias) so the
 *  two stay anti-correlated and stride·cadence stays near the ground speed. */
function cadenceScale(strideBias: number, size: number): number {
  const scale = 1 - 0.16 * strideBias - 0.10 * (size - 1.0);
  return clamp(scale, 0.82, 1.18);
}

/** Continuous gait synthesis for a man at this instant. */
export function synthesizeGait(g: GaitInput): GaitSynthesis {
  const spd = Math.max(0, g.spd);
  const effort = gaitEffort(spd);
  // stride and cadence co-vary so that stride*cadence ≈ speed. We choose the
  // stride first (longer with effort and with longer legs) and derive cadence.
  const strideBase = lerp(0.55, 1.95, effort) * (0.94 + 0.12 * (g.size - 1.0));
  const stride = strideBase * (1 + 0.16 * g.strideBias);
  const cad = baseCadence(spd) * cadenceScale(g.strideBias, g.size);
  const cadence = Math.max(0.8, cad);
  // a full gait cycle is 2 steps, so cadence steps/s => cadence/2 cycles/s =>
  // cadence*PI rad/s of phase. Left/right limbs ride half a cycle apart.
  const phaseRate = cadence * Math.PI;
  const turn = clamp(Math.abs(g.turnRate), 0, TURN_CEILING);
  const lean = clamp(effort * 0.32 + turn * 0.012, 0, 0.45);
  const armPump = clamp(effort * 0.7 + (spd > WALK ? 0.15 : 0), 0, 1);
  const hipSet = clamp(g.turnRate * 0.14, -0.5, 0.5);
  return {
    effort, stride, cadence, phaseRate,
    lean, armPump, hipSet,
  };
}

/** Per-gait-cycle limb-phase helper for a two-sided walker: returns a phase in
 *  [0, 2PI) advancing at `phaseRate` rad/s. Renderers integrate this so the
 *  left and right limbs stay exactly half a cycle apart. */
export function advancePhase(phase: number, phaseRate: number, step: number): number {
  const p = phase + phaseRate * step;
  return p % (Math.PI * 2);
}
