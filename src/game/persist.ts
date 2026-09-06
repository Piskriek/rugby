/**
 * T-12 — PERSISTENCE.
 *
 * Team management, tactics and the kicker do not survive the session
 * (complaint G-001). One localStorage key, one versioned envelope:
 *
 *   { v: 1, squads, tactics, kickers, options, classicProgress }
 *
 * Every read is guarded: a corrupt or future-version blob must degrade to
 * defaults without so much as a console error — a broken save may never
 * brick the menu. Every write is best-effort: private browsing and full
 * quotas are not the player's problem.
 */

const KEY = 'rugby.save';
const VERSION = 2;

/* Versions this loader can migrate forward rather than discard. A bumped
 * VERSION must never silently bin a player's squads and tactics just because
 * one unrelated field changed meaning. */
const MIGRATABLE = [1];

export interface SaveBlob {
  v: number;
  /** the player's side: teams and kits */
  squads: { home: string; away: string; kitA: number; kitB: number };
  /** the tactics board: sliders, formations, assist levels */
  tactics: {
    sliders: Record<string, number>;
    form: { backline: string; defence: string; lineout: string; scrum: string };
    assists: { pass: number; tackle: number; kick: number };
  };
  /** the designated goal kicker, shirt number */
  kickers: { kickerA: number };
  /** match officials options, by option id */
  options: Record<string, number>;
  /** the classic match last selected (id), or null */
  classicProgress: string | null;
}

/** Anything wrong with the blob — wrong version, missing fields, nonsense
 *  values — returns null and the caller uses defaults. */
export function loadSave(): SaveBlob | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SaveBlob>;
    if (!parsed || typeof parsed !== 'object') return null;
    const fromVersion = parsed.v;
    if (fromVersion !== VERSION && !MIGRATABLE.includes(fromVersion as number)) return null;
    const b = parsed as SaveBlob;
    // shape guards — every field the menus will read
    if (typeof b.squads?.home !== 'string' || typeof b.squads?.away !== 'string') return null;
    if (!Number.isFinite(b.squads.kitA) || !Number.isFinite(b.squads.kitB)) return null;
    if (!b.tactics || typeof b.tactics.sliders !== 'object' || typeof b.tactics.form !== 'object') return null;
    if (!b.tactics.assists || !('pass' in b.tactics.assists)) return null;
    if (!Number.isFinite(b.kickers?.kickerA)) return null;
    if (typeof b.options !== 'object' || b.options === null) return null;
    if (b.classicProgress !== null && typeof b.classicProgress !== 'string') return null;
    /* SPEC_08 migration: MAUL LAW "NO LIMIT" (index 2) is deprecated — a
     * held maul that can never be whistled is an unplayable standstill, and
     * its countdown could never mean TIME TO ACT. Saved 2s load as STOP ONCE
     * (0); 0 and 1 are untouched. */
    if (b.options.maulLaw === 2) b.options.maulLaw = 0;

    /* v1 -> v2: THE PRESENTATION DEFAULTS CHANGED.
     *
     * v1 shipped WEATHER=OVERCAST and KICK-OFF=TWILIGHT as defaults. Overcast
     * cuts the key light to 0.38, shadows to 0.18 and saturation to 0.9, so
     * the stock game looked deliberately grey — and because those values were
     * SAVED, simply changing the defaults fixed nothing for anyone who had
     * already launched the game once. Their blob kept overriding it.
     *
     * So: a v1 save that still holds the old defaults is treated as "never
     * chosen" and moved to the new ones. A v1 save with anything else in
     * those fields is a deliberate choice and is left completely alone.
     * Everything else in the blob — squads, tactics, kicker, progress —
     * carries across untouched either way. */
    if (fromVersion === 1) {
      if (b.options.weather === 1) b.options.weather = 0;      // OVERCAST -> CLEAR
      if (b.options.timeofday === 2) b.options.timeofday = 1;  // TWILIGHT -> AFTERNOON
      b.v = VERSION;
    }
    return b;
  } catch {
    return null;
  }
}

export function writeSave(b: SaveBlob): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* best effort — storage may be unavailable; the session still works */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
