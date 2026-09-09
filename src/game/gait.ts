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
