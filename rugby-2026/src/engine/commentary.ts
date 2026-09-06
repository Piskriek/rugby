/**
 * COMMENTARY — picks and personalises lines from the design corpus banks
 * (COMMENTARY / REFEREE_CALLS in the shared content database).
 */
import { COMMENTARY, REFEREE_CALLS } from 'design/data';
import { Rng, minuteLabel } from './utils';
import type { FeedLine, MatchEvent } from './types';

const K: Record<string, string[]> = { ...COMMENTARY };

const fill = (line: string, vars: Record<string, string>): string => {
  let out = line;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
};

export class Commentary {
  private rng: Rng;
  constructor(rng: Rng) { this.rng = rng; }

  line(bank: string, vars: Record<string, string> = {}, fallback?: string): string {
    const pool = K[bank] ?? K.GENERIC;
    return fill(this.rng.pick(pool), vars) || (fallback ?? '');
  }

  eventToFeed(e: MatchEvent): FeedLine {
    return { text: e.text, at: e.t, kind: e.kind };
  }

  /** Shorthand for events created by the engine. */
  ev(kind: MatchEvent['kind'], text: string, team: MatchEvent['team'] = null, opts: Partial<MatchEvent> = {}): MatchEvent {
    return { kind, text, team, t: 0, ...opts };
  }
}

export const refCall = (key: keyof typeof REFEREE_CALLS): string => REFEREE_CALLS[key];

/** Generic ticker text used between big moments. */
export const genericFill = (rng: Rng, vars: Record<string, string>): string =>
  fill(rng.pick(K.GENERIC), vars);

export const minuteTag = (t: number) => minuteLabel(t);
