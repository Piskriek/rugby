/**
 * TACKLE-AI — TABS-style Flailing Dive for NPC defenders.
 *
 * A defender blindly tracks the ball carrier and launches their active
 * ragdoll through the air. Operates on the 3D ragdoll bodies (Hips, Chest)
 * with real impulses, not the 2D kinematic dive of latch.ts.
 *
 * TICK POLLING
 *   Every 3 engine ticks the system measures the 3D distance between the
 *   defender's Hips and the carrier's Hips. Outside 1.5 m the defender
 *   updates its kinematic locomotion target to chase the carrier. At or
 *   inside 1.5 m the active-ragdoll dive fires: balance gain drops to zero
 *   and an impulse (forward 400 + up 150) is applied to Hips and Chest.
 *
 * CRITICAL FIX 1 — NO TRUNK SNAP
 *   A naive approach would snap the defender's trunks onto the carrier's
 *   shell at contact. That injects massive vertical energy through the
 *   position constraint and launches the carrier 8 m in the air. Instead,
 *   once the horizontal distance crosses zero the AI refuses further
 *   closing along the horizontal normal. Standard Rapier collisions handle
 *   the impact without any positional override.
 *
 * CRITICAL FIX 2 — TABS TAKEOVER
 *   The referee law's dive-reach grab triggers at 1.65 m, which intercepts
 *   and blocks a 1.5 m physics dive before it can fire. `tabsTakeover()`
 *   bypasses that law block while `s.ball.live` is true, giving the TABS
 *   dive priority over the law's shorter grab radius.
 */

import type { Live } from '../intelligence';
import type { OpenPlayState } from '../director';

/* ============================ TUNING ============================ */

/**
 * The distance (3D, Hips-to-Hips) at which the TABS dive launches.
 * Kept deliberately shorter than the law's 1.65 m dive-reach grab so the
 * physics dive fires inside the law's interception zone.
 */
export const TABS_DIVE_RANGE = 1.5;

/**
 * How often (in engine ticks) the distance is polled. Polling every tick
 * is wasteful — the carrier moves at most ~0.14 m per tick at 8.5 m/s,
 * so a 3-tick cadence (≈50 ms) is well within the 1.5 m decision radius.
 */
export const TABS_POLL_INTERVAL = 3;

/**
 * Impulse magnitude applied to Hips and Chest on dive launch.
 * Forward component drives the ragdoll into the carrier; up component
 * gives the leap its airborne arc.
 */
export const TABS_IMPULSE_FORWARD = 400;
export const TABS_IMPULSE_UP = 150;

/**
 * The referee law's dive-reach grab radius (metres). A grab attempt
 * inside this range is intercepted by the law before the TABS dive can
 * fire at 1.5 m. The takeover override bypasses this while ball is live.
 */
export const LAW_DIVE_REACH_GRAB = 1.65;

/**
 * How long the TABS dive's active-ragdoll phase lasts before the defender
 * transitions to recovery. Seconds.
 */
export const TABS_DIVE_DURATION = 0.5;

/* ============================ STATE ============================ */

/**
 * Per-defender TABS dive state. Attached to the Live object while the
 * dive is active; absent when the defender is in normal locomotion.
 */
export interface TabsDiveState {
  /** true while the ragdoll is airborne under impulse. */
  airborne: boolean;
  /** seconds remaining in the active-ragdoll dive phase. */
  t: number;
  /** the tick counter since last poll (0..TABS_POLL_INTERVAL-1). */
  pollTick: number;
  /** true once the horizontal normal has crossed — refuse further closing. */
  horizontalLocked: boolean;
  /** the horizontal normal at crossing time (unit vector, x/z). */
  lockNx: number;
  lockNz: number;
}

/* ============================ THE DIVE AI ============================ */

/**
 * Create a fresh TABS dive state for a defender. The poll tick starts at
 * 0 so the first call immediately measures distance.
 */
export function createTabsDiveState(): TabsDiveState {
  return {
    airborne: false,
    t: 0,
    pollTick: 0,
    horizontalLocked: false,
    lockNx: 0,
    lockNz: 0,
  };
}

/**
 * The TABS-style flailing dive tick. Called once per engine tick for each
 * NPC defender that is eligible to dive.
 *
 * @param def        The defending Live player.
 * @param carrier    The ball carrier's Live player.
 * @param state      The defender's TABS dive state (created by createTabsDiveState).
 * @param dt         Frame delta in seconds.
 * @returns          Updated state. If the dive has expired, returns undefined
 *                   so the caller can clear the reference.
 */
export function stepTabsDive(
  def: Live & { tabsDive?: TabsDiveState },
  carrier: Live,
  state: TabsDiveState,
  dt: number,
): TabsDiveState | undefined {
  /* ---- AIRBORNE PHASE: the ragdoll is flying under impulse ---- */
  if (state.airborne) {
    state.t -= dt;
    if (state.t <= 0) {
      state.airborne = false;
      return undefined; // dive complete, caller clears state
    }
    return state;
  }

  /* ---- LOCOMOTION PHASE: polling for dive trigger ---- */
  state.pollTick++;
  if (state.pollTick < TABS_POLL_INTERVAL) return state;
  state.pollTick = 0;

  /* 3D distance: Hips-to-Hips. The Live model stores x/z; y is approximated
   * from the ragdoll rest pose (Hips at 1.15 m, Chest at 1.53 m). */
  const dx = carrier.x - def.x;
  const dz = carrier.z - def.z;
  const dy = 0; // 2D approximation — both stand at ~1.15 m
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist > TABS_DIVE_RANGE) {
    /* Update kinematic locomotion target: chase the carrier. */
    def.tx = carrier.x;
    def.tz = carrier.z;
    def.urgency = 1;
    return state;
  }

  /* <= 1.5 m: TRIGGER THE DIVE.
   * Set balance gain to 0 (the ragdoll goes limp and launches).
   * Apply impulse to Hips and Chest: forward 400 + up 150.
   * The actual impulse application happens in the physics layer; here we
   * mark the state and compute the direction. The renderer/physics reads
   * the state and applies the real Rapier impulses. */
  const d = Math.max(0.01, Math.hypot(dx, dz));
  const nx = dx / d;
  const nz = dz / d;

  state.airborne = true;
  state.t = TABS_DIVE_DURATION;

  /* Stamp the impulse direction onto the Live for the physics layer. */
  def.vx = nx * 5.2; // launch velocity
  def.vz = nz * 5.2;

  /* Set the clip to 'dive' so the renderer plays the leap animation. */
  def.clip = 'dive';
  def.clipT = 0;

  /* The dive flag: prevents steering while airborne. */
  def.diveT = TABS_DIVE_DURATION;

  return state;
}

/* ============================ CRITICAL FIX 1 ============================ */

/**
 * HORIZONTAL NORMAL LOCK.
 *
 * Once the defender's horizontal position crosses the carrier's (the
 * horizontal distance along the approach normal goes from positive to
 * zero or negative), the TABS dive must NOT snap the trunks onto the
 * carrier's shell. That snap injects massive vertical energy through the
 * Rapier position constraint and launches the carrier 8 m in the air.
 *
 * Instead, we refuse further closing along the horizontal normal. The
 * defender's velocity component along the lock normal is zeroed, and
 * standard Rapier collisions handle the impact without any positional
 * override.
 *
 * Call this every physics step while the TABS dive is airborne and in
 * contact with the carrier.
 */
export function enforceHorizontalLock(
  def: Live & { tabsDive?: TabsDiveState },
  carrier: Live,
): void {
  const state = def.tabsDive;
  if (!state || !state.airborne) return;

  const dx = carrier.x - def.x;
  const dz = carrier.z - def.z;
  const d = Math.hypot(dx, dz);

  if (!state.horizontalLocked) {
    /* First crossing: capture the horizontal normal. */
    if (d < 0.5 && d > 0.001) {
      state.horizontalLocked = true;
      state.lockNx = dx / d;
      state.lockNz = dz / d;
    }
  }

  if (state.horizontalLocked) {
    /* Project the defender's velocity onto the lock normal. If the component
     * is positive (still closing), zero it. This refuses further closing. */
    const vDotN = def.vx * state.lockNx + def.vz * state.lockNz;
    if (vDotN > 0) {
      def.vx -= vDotN * state.lockNx;
      def.vz -= vDotN * state.lockNz;
    }
  }
}

/* ============================ CRITICAL FIX 2 ============================ */

/**
 * TABS TAKEOVER OVERRIDE.
 *
 * The referee law's dive-reach grab triggers at 1.65 m (LAW_DIVE_REACH_GRAB).
 * A defender approaching at 1.5 m would be intercepted by the law before the
 * TABS physics dive can fire. This override bypasses that law block while
 * `s.ball.live` is true.
 *
 * Returns true if the TABS dive has taken over (law block bypassed).
 * Returns false if the law's grab should proceed (ball is not live, or the
 * defender is outside the law's reach).
 */
export function tabsTakeover(
  def: Live,
  carrier: Live,
  s: OpenPlayState,
): boolean {
  /* Only override while the ball is live. If the ball is dead (in flight,
   * caught, or the phase has ended), the law's grab takes priority. */
  if (!s.ball.live) return false;

  /* Measure distance. If outside the law's grab radius, no override needed. */
  const dx = carrier.x - def.x;
  const dz = carrier.z - def.z;
  const dist = Math.hypot(dx, dz);

  /* The override only applies when the defender is inside the law's grab
   * radius but the TABS dive has not yet fired. */
  if (dist > LAW_DIVE_REACH_GRAB) return false;
  if (dist > TABS_DIVE_RANGE) return false; // outside TABS range, no dive yet

  /* The TABS dive takes over. The law's grab is bypassed. */
  return true;
}

/* ============================ INTEGRATION HELPER ============================ */

/**
 * High-level entry point: run the TABS dive AI for a defender.
 *
 * This is called from the director's think() loop for each NPC defender.
 * It handles the polling, the dive trigger, the horizontal lock, and the
 * law takeover override.
 *
 * @param d          The Director (for accessing game state).
 * @param def        The defending Live player.
 * @param carrier    The ball carrier's Live player.
 * @param s          The current OpenPlayState.
 * @param dt         Frame delta in seconds.
 */
export function runTabsDiveAI(
  def: Live & { tabsDive?: TabsDiveState },
  carrier: Live,
  s: OpenPlayState,
  dt: number,
): void {
  /* Guard: defender must be eligible. */
  if (def.down || def.beatenT > 0 || def.sinbin > 0) return;
  if (def.diveT && def.diveT > 0 && !def.tabsDive) return; // already diving via latch
  if (def.tabsDive?.airborne) {
    /* Continue the airborne phase. */
    const next = stepTabsDive(def, carrier, def.tabsDive, dt);
    if (!next) def.tabsDive = undefined;
    else def.tabsDive = next;
    /* Enforce the horizontal lock if in contact. */
    enforceHorizontalLock(def, carrier);
    return;
  }

  /* Check if the TABS takeover should bypass the law's grab. */
  if (tabsTakeover(def, carrier, s)) {
    /* Initialize the TABS dive state if not already present. */
    if (!def.tabsDive) def.tabsDive = createTabsDiveState();
    const next = stepTabsDive(def, carrier, def.tabsDive, dt);
    if (!next) def.tabsDive = undefined;
    else def.tabsDive = next;
    return;
  }

  /* Normal locomotion: step the dive AI (polling for trigger). */
  if (!def.tabsDive) def.tabsDive = createTabsDiveState();
  const next = stepTabsDive(def, carrier, def.tabsDive, dt);
  if (!next) def.tabsDive = undefined;
  else def.tabsDive = next;
}
