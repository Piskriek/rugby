/** Possession-chain probe: how deep does each sustained attack get, and what ends it? */
import { Match } from '../src/engine/match';
import type { MatchSetup } from '../src/engine/types';
import { WEATHER_ROLL } from '../src/engine/tuning';

const setup: MatchSetup = {
  a: { id: 'NZL', kitIdx: 0, human: false },
  b: { id: 'SAM', kitIdx: 0, human: false },
  difficulty: 3, halfMinutes: 40, weather: WEATHER_ROLL(0.4), seed: 1,
};
const m = new Match(setup);

interface Chain { team: 'A' | 'B'; startX: number; minGoal: number; minX: number; end: string; nRucks: number; kick: boolean }
const chains: Chain[] = [];
let cur: Chain | null = null;

const holderOf = (): { team: 'A' | 'B'; x: number } | null => {
  const c = m.carrier();
  if (c) return { team: c.team, x: c.x };
  if (m.kind === 'RUCK' && m.ruck?.attack) return { team: m.ruck.attack as 'A' | 'B', x: m.ruck.x };
  if (m.kind === 'MAUL' && m.maul?.attack) return { team: m.maul.attack as 'A' | 'B', x: m.maul.x };
  return null;
};
const ENDS = new Set(['SCRUM', 'LINEOUT', 'GOALKICK', 'GOALPREP', 'KICKFLIGHT', 'RESTART', 'HALF', 'STOPPED']);

for (let i = 0; i < 2_000_000 && !m.over; i++) {
  m.update(0.05);
  const h = holderOf();
  if (h) {
    const goalD = m.toGoal(h.team, h.x);
    if (!cur || cur.team !== h.team) {
      if (cur) chains.push(cur);
      cur = { team: h.team, startX: h.x, minGoal: goalD, minX: h.x, end: '', nRucks: 0, kick: false };
    } else {
      if (goalD < cur.minGoal) { cur.minGoal = goalD; cur.minX = h.x; }
      if (m.kind === 'RUCK') cur.nRucks += 0; // count once per ruck later
    }
  } else if (cur) {
    // no holder — did we leave live attack?
    if (ENDS.has(m.kind)) {
      if (m.kind === 'KICKFLIGHT') cur.kick = true;
      cur.end = `${m.kind}@${(m.phase.x ?? m.ball.x).toFixed(0)}m`;
      chains.push(cur); cur = null;
    } else if (m.kind === 'SETTLE') {
      cur.end = `settle`;
      chains.push(cur); cur = null;
    }
  }
}
if (cur) { cur.end = 'final'; chains.push(cur); }

for (const team of ['A', 'B'] as const) {
  const mine = chains.filter((c) => c.team === team);
  const deep = [...mine].sort((a, b) => a.minGoal - b.minGoal).slice(0, 8);
  console.log(`\n== ${team === 'A' ? m.a.short : m.b.short}: ${mine.length} chains`);
  console.log('deepest: ' + deep.map((c) => `${c.minGoal.toFixed(0)}m-to-goal(x=${c.minX.toFixed(0)}) end=${c.end}`).join(' | '));
  const ends = new Map<string, number>();
  for (const c of mine) ends.set(c.end, (ends.get(c.end) ?? 0) + 1);
  console.log('endings:', [...ends.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
  console.log('chains reaching 22:', mine.filter((c) => c.minGoal <= 22).length,
    ' reaching 10m:', mine.filter((c) => c.minGoal <= 10).length,
    ' avg start x:', (mine.reduce((s, c) => s + c.startX, 0) / mine.length).toFixed(0));
}
console.log('\nscore', m.a.score, '-', m.b.score, 'tries', m.a.tries, m.b.tries);
