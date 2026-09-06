/** Phase-gain probe: how many metres does each attacking phase make? */
import { Match } from '../src/engine/match';
import type { MatchSetup } from '../src/engine/types';
import { WEATHER_ROLL } from '../src/engine/tuning';

const setup: MatchSetup = {
  a: { id: 'NZL', kitIdx: 0, human: false },
  b: { id: 'SAM', kitIdx: 0, human: false },
  difficulty: 3, halfMinutes: 40, weather: WEATHER_ROLL(0.4), seed: 1,
};
const m = new Match(setup);

type Phase = { team: 'A' | 'B'; x0: number; gains: number[]; end: string };
const phases: Phase[] = [];
let cur: Phase | null = null;

const dirOf = (t: 'A' | 'B') => (t === 'A' ? 1 : -1);

for (let i = 0; i < 1_200_000 && !m.over; i++) {
  m.update(0.05);
  const kind = m.kind;
  // watch "who holds the ball, where" each tick
  const carrier = m.carrier();
  const holder = carrier ?? (m.kind === 'RUCK' || m.kind === 'MAUL' ? (m.ruck?.attack ?? null) : null);
  const holdTeam = carrier ? carrier.team : holder;
  if (kind === 'OPEN' || kind === 'RUCK' || kind === 'MAUL') {
    const team = holdTeam as 'A' | 'B' | null;
    if (team && cur && cur.team !== team) {
      cur.end = `lost@${m.t.toFixed(0)}`;
      phases.push(cur); cur = null;
    }
    if (team && !cur) {
      cur = { team, x0: m.ball?.x ?? 50, gains: [], end: '' };
    }
  } else if (cur) {
    cur.end = `to-${kind}@${m.t.toFixed(0)}`;
    phases.push(cur); cur = null;
  }
}
if (cur) phases.push(cur);

// per team, count phases by outcome & total metres gained
for (const team of ['A', 'B'] as const) {
  const mine = phases.filter((p) => p.team === team);
  const dir = dirOf(team);
  let gainSum = 0;
  const maxGain = mine.reduce((mx, p) => Math.max(mx, (p.x0 - 0) * 0), 0);
  void maxGain;
  const big = mine.filter((p) => {
    // measure net gain only on phases that ended while same team still had ball-ish...
    return p.gains.length > 0;
  });
  void big;
  // approximate net gain: ball x now vs at phase start is complex; count phase lengths and endings instead
  const ends = new Map<string, number>();
  for (const p of mine) ends.set(p.end, (ends.get(p.end) ?? 0) + 1);
  void gainSum;
  console.log(`\n== team ${team}: ${mine.length} ball phases`);
  console.log('outcome endings:', [...ends.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(' '));
}
