/* ---------------------------------------------- COMMITMENT (A-5 / M-4) ---
 * ENGINE INNOVATION 2, A-5 "Reading commits" + M-4 telegraph channel.
 *
 * A commitment model for the Actor `commit` field (0..1). Why it exists:
 * once a defender has COMMITTED — his hips are open, his weight forward, his
 * telegraph begun — he cannot instantly change his mind. A step beats him, a
 * dummy holds him. Telegraph becomes a MECHANIC: the human reads a defender's
 * commitment and steps him; the CPU reads the human's the same way.
 *
 * The discipline is purely a function of the scalar:
 *   - While `commit` is BELOW the lock threshold a man is still deciding: he
 *     may ramp up toward acting, but he can still abort (commit decays back).
 *     This is the 150-300 ms readable wind-up.
 *   - Once `commit` crosses the LOCK threshold the man is committed: commit may
 *     only rise (to 1) and may NEVER fall until the action resolves. No mid-
 *     commit abort. The plan's C6 gate: "a committed defender cannot abort a
 *     tackle mid-commit."
 *
 * Deterministic and headless, so it survives the sim discipline and is probed.
 */

/** Seconds for a full 0..1 commitment at the rise rate. */
export const COMMIT_RISE_TIME = 0.33;
/** 0..1 threshold above which commitment is irreversible this action. */
export const COMMIT_LOCK = 0.45;
/** Rise rate, 0..1 per second, while a man is committing. */
export const COMMIT_RISE = 1 / COMMIT_RISE_TIME;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Advance a man's commitment toward acting.
 * @param c       current commitment 0..1
 * @param acting  is the man currently committing to this action (wind-up begun)?
 * @param dt      seconds
 * @returns the next commitment 0..1, obeying the lock: once >= COMMIT_LOCK it
 *          never falls.
 */
export function stepCommit(c: number, acting: boolean, dt: number): number {
  const cur = clamp(c, 0, 1);
  if (acting) {
    // committing: monotone rise to 1
    return clamp(cur + COMMIT_RISE * Math.max(0, dt), 0, 1);
  }
  if (cur >= COMMIT_LOCK) {
    // locked: may not un-commit. Hold where it is until the action resolves.
    return cur;
  }
  // still deciding: if we stop pushing, doubt creeps back in (can abort).
  return clamp(cur - COMMIT_RISE * 0.85 * Math.max(0, dt), 0, 1);
}

/** May this man still abandon the action? True only before the lock is crossed. */
export function canAbort(c: number): boolean {
  return c < COMMIT_LOCK;
}

/** Time (s) a fresh decision takes to become an irreversible commitment. */
export function timeToLock(): number {
  return COMMIT_LOCK / COMMIT_RISE;
}
