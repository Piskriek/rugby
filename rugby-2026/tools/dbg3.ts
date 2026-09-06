/** Narrative probe: print every significant event with location through 12 sim-minutes. */
import { Match } from '../src/engine/match';
import type { MatchSetup } from '../src/engine/types';
import { WEATHER_ROLL } from '../src/engine/tuning';

const setup: MatchSetup = {
  a: { id: 'NZL', kitIdx: 0, human: false },
  b: { id: 'SAM', kitIdx: 0, human: false },
  difficulty: 3, halfMinutes: 40, weather: WEATHER_ROLL(0.4), seed: 1,
};
const m = new Match(setup);
let lastRef: unknown = null;
const until = 12 * 60;
for (let i = 0; i < 1_200_000 && !m.over && m.t < until; i++) {
  m.update(0.05);
  const tail = m.events[m.events.length - 1];
  if (tail && tail !== lastRef) {
    lastRef = tail;
    const who = tail.team === 'A' ? m.a.short : tail.team === 'B' ? m.b.short : '-';
    const x = tail.x ?? 50;
    const nearLine = x < 50 ? (100 - x).toFixed(0) + 'm to NZL line' : x.toFixed(0) + 'm to SAM line';
    console.log(`${(tail.t / 60).toFixed(1)}' [${(tail.kind ?? '').padEnd(8)}] ${who.padEnd(3)} @ ${nearLine.padStart(16)}  ${(tail.text ?? '').slice(0, 90)}`);
  }
}
console.log('score', m.a.score, '-', m.b.score);
