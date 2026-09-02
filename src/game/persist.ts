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
const VERSION = 1;

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
    if (!parsed || typeof parsed !== 'object' || parsed.v !== VERSION) return null;
    const b = parsed as SaveBlob;
    // shape guards — every field the menus will read
    if (typeof b.squads?.home !== 'string' || typeof b.squads?.away !== 'string') return null;
    if (!Number.isFinite(b.squads.kitA) || !Number.isFinite(b.squads.kitB)) return null;
    if (!b.tactics || typeof b.tactics.sliders !== 'object' || typeof b.tactics.form !== 'object') return null;
    if (!b.tactics.assists || !('pass' in b.tactics.assists)) return null;
    if (!Number.isFinite(b.kickers?.kickerA)) return null;
    if (typeof b.options !== 'object' || b.options === null) return null;
    if (b.classicProgress !== null && typeof b.classicProgress !== 'string') return null;
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
