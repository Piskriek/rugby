/* ------------------------------------------------ PERCEPTION (A-3 / WS21) ---
 * ENGINE INNOVATION 2, A-3 "Attention, not cones" + first plan I-3.
 *
 * The single place reaction time is computed. Plan C2:
 *   "what each player watches is published; the single
 *    reactionLatency(gazeDistanceToTarget) is the ONLY place reaction time is
 *    computed."
 *
 * WHY ONE TABLE. A vision cone still lets a man react instantly to everything
 * ahead of him, so CPU defence is always-shaped and always-chasing. A human
 * allocates what he watches; what he is NOT looking at is not unseen — it is
 * reacted to LATE. This module makes that a pure, headless, deterministic
 * function of where the target sits relative to where the man is gazing, so:
 *   - looking straight at the ball/man  -> 100-250 ms  (the "read it" fast band)
 *   - it is in glanceable periphery      -> the mid band
 *   - not looking at it at all           -> 300-600 ms  (shaped but not chasing)
 *
 * It is deterministic (same inputs, same output) so it survives the headless
 * sim's determinism discipline and can be probed.
 */

/** Fastest human reaction to something the eyes are ON, seconds. */
export const LOOK_AT_REACTION = 0.12;
/** Reaction to something far off the gaze, seconds (the "not looking" delay). */
export const NOT_LOOKING_REACTION = 0.60;
/** Gaze offset (m) at which the target is comfortably "seen". */
const ON_TARGET_M = 0.5;
/** Gaze offset (m) beyond which reaction is fully "not looking". */
const FULL_OFF_M = 9.0;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Reaction time (seconds) for a target `offM` metres away from where the player
 * is currently gazing. Monotonic, clamped to the human reaction band, and the
 * one table every latency read must come through.
 */
export function reactionLatency(offM: number): number {
  const m = Math.max(0, offM);
  if (m <= ON_TARGET_M) return LOOK_AT_REACTION;
  // smoothstep-ish interpolation into the "not looking" ceiling.
  const t = clamp01((m - ON_TARGET_M) / (FULL_OFF_M - ON_TARGET_M));
  const s = t * t * (3 - 2 * t);
  return LOOK_AT_REACTION + (NOT_LOOKING_REACTION - LOOK_AT_REACTION) * s;
}

/**
 * Distance (metres) between the point a player is gazing at (gx, gz) and a
 * world point (x, z). Gaze "on target" is therefore ~0 and reads the fast band.
 * A player with no gaze (ball not known / head not tracking) is treated as
 * looking at nothing useful -> the far "not looking" delay.
 */
export function gazeOffset(gx: number | undefined, gz: number | undefined, x: number, z: number): number {
  if (gx === undefined || gz === undefined) return FULL_OFF_M;
  return Math.hypot(gx - x, gz - z);
}

/** Convenience: reaction of a player whose gaze is (gx,gz) to a target (x,z). */
export function gazeReaction(gx: number | undefined, gz: number | undefined, x: number, z: number): number {
  return reactionLatency(gazeOffset(gx, gz, x, z));
}
