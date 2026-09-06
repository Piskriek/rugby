/**
 * BREAKDOWN CHOREOGRAPHY — the precomputed shape of a tackle → ruck.
 *
 * This is the "presimulated" half of the breakdown work. The old engine
 * authored each ruck player slot ad hoc inside `startBreakdown` (a litany of
 * `-0.8 - i * 0.5` / `1.3 + i * 0.4` offsets), and then froze those slots
 * for the whole phase. That is why the area around a tackle reads as a clump
 * that arrived wherever the odds put it rather than a ruck that is being
 * cleared and contested.
 *
 * The geometry of a breakdown is not a per-frame decision — it is a fixed,
 * small table of body-relative offsets, exactly like the scrum slots and the
 * lineout marks. Every call site reads the same table, so:
 *   - the clearers arrive behind the ball on the attacking side and then
 *     DRIVE FORWARD THROUGH the jackal as the contest develops;
 *   - the jackal sets over the ball and the counters bind behind him;
 *   - the tackler rolls AWAY from the ball and the carrier presents;
 *   - the nine's base and the ball-out release point are one geometry, not
 *     three copies (placeBound, RECYCLE, ballPoint) that can drift.
 *
 * The API is pure: no `Director`, no `Live`, no allocation. `dir` is the
 * attack direction (+1 for A, −1 for B), the same sign every breakdown writer
 * uses.
 */

export type BreakdownRole =
  | 'CARRIER' | 'TACKLER'
  | 'FIRST CLEARER' | 'CLEANER'
  | 'JACKAL' | 'COUNTER';

export interface BreakdownSlot {
  x: number; z: number;
  down: boolean;
  clip: string;
}

/** Seconds of ruck contest after which the clearout is fully on the jackal. */
export const CLEAROUT_DRIVE_SECONDS = 0.6;
/** Seconds after which the tackler has rolled clear of the ball. */
export const TACKLER_ROLL_SECONDS = 0.7;

/**
 * The slot a breakdown role occupies at the moment the phase begins. These
 * are *start* positions, not the frozen end of the shot — see
 * `breakdownDriveTarget` for where the slot moves as the contest develops.
 */
export function breakdownSlot(
  role: BreakdownRole, i: number, cx: number, cz: number, dir: 1 | -1,
): BreakdownSlot {
  switch (role) {
    case 'CARRIER':
      return { x: cx, z: cz, down: true, clip: 'grounded' };
    case 'TACKLER':
      /* The tackler lands just past the carrier (a stride ON the contact)
       * and rolls to the far side of the ball, so he never sits on the
       * clearout lane. */
      return { x: cx + 0.7, z: cz - dir * 0.75, down: true, clip: 'tackle' };
    case 'FIRST CLEARER':
      /* One stride behind the ball on the attacker's hip, ready to drive. */
      return { x: cx - 0.65, z: cz - dir * 1.15, down: false, clip: 'cleanout' };
    case 'CLEANER': {
      const slot = i - 1;
      return {
        x: cx - 0.6 - (slot % 2 === 0 ? 0.35 : 0.85),
        z: cz - dir * (1.45 + slot * 0.42),
        down: false, clip: 'cleanout',
      };
    }
    case 'JACKAL':
      /* Over the ball, on the defending side — this is the man the first
       * cleaner is driving THROUGH, not a second body at the same point. */
      return { x: cx + 0.45, z: cz + dir * 0.55, down: false, clip: 'jackal' };
    case 'COUNTER': {
      const slot = i - 1;
      return {
        x: cx + 0.85 + slot * 0.4,
        z: cz + dir * (1.5 + slot * 0.5),
        down: false, clip: 'ruck',
      };
    }
  }
}

/**
 * Where a slot should be THIS frame as the ruck develops. Clears drive
 * through, the jackal digs in, the counters bind, and the tackler peels away.
 * The returned values are the only place these moves are authored.
 */
export function breakdownDriveTarget(
  role: BreakdownRole, i: number, cx: number, cz: number, dir: 1 | -1,
  contestT: number, ruckFormed: boolean,
): BreakdownSlot {
  const start = breakdownSlot(role, i, cx, cz, dir);
  const drive = ruckFormed
    ? Math.min(1, Math.max(0, contestT / CLEAROUT_DRIVE_SECONDS))
    : Math.min(1, Math.max(0, contestT / 0.3));   // PLACE: the clearers are already running on

  switch (role) {
    case 'FIRST CLEARER':
      return {
        x: start.x + 0.55 * drive,               // angle onto the jackal's shoulder
        z: start.z + dir * 0.95 * drive,         // through the ball, not to it
        down: false, clip: drive < 0.85 ? 'cleanout' : 'ruck',
      };
    case 'CLEANER': {
      const slot = i - 1;
      return {
        x: start.x + (0.3 + (slot % 2) * 0.2) * drive,
        z: start.z + dir * (1.1 + slot * 0.25) * drive,
        down: false, clip: drive < 0.95 ? 'cleanout' : 'ruck',
      };
    }
    case 'JACKAL':
      /* He starts over the ball; once the clearout lands he is driven a
       * shade back, but stays on his side — a jackal who is still over the
       * ball at +0.75 is what the "not rolling away" call is for. */
      return {
        x: start.x + 0.12 * drive,
        z: start.z - dir * 0.30 * drive,
        down: false, clip: drive < 0.8 ? 'jackal' : 'maulBind',
      };
    case 'COUNTER': {
      const slot = i - 1;
      return {
        x: start.x - (0.15 + slot * 0.05) * drive,
        z: start.z - dir * (0.25 + slot * 0.15) * drive,
        down: false, clip: 'maulBind',
      };
    }
    case 'TACKLER':
      /* Rolls away past the far side, then holds for the get-up clip. */
      return {
        x: start.x + 0.55 * Math.min(1, contestT / TACKLER_ROLL_SECONDS),
        z: start.z - dir * 0.5 * Math.min(1, contestT / TACKLER_ROLL_SECONDS),
        down: start.down, clip: 'tackle',
      };
    case 'CARRIER':
      return start;
  }
}

/**
 * One geometry for the scrum-half's base, the RECYCLE release mark and the
 * ruck exit: a stride behind the ball on the side away from the touchline.
 */
export function nineBase(cx: number, cz: number, dir: 1 | -1): { x: number; z: number } {
  return {
    x: clamp(cx + (cx > 0 ? -1.8 : 1.8), -32, 32),
    z: clamp(cz - dir * 1.4, -58, 58),
  };
}

/** Ball release target for a won ruck — the nine plays it from his base. */
export function releaseMark(cx: number, cz: number, dir: 1 | -1, nearLine = false): { x: number; z: number } {
  const base = nineBase(cx, cz, dir);
  return { x: base.x, z: clamp(base.z + dir * (nearLine ? 0.5 : 0.0), -58, 58) };
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
