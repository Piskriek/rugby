/** Red-zone probe: log every tick an A-carrier/ruck is within 3m of the B line, then what follows. */
import { Match } from '../src/engine/match';
import type { MatchSetup } from '../src/engine/types';
import { WEATHER_ROLL } from '../src/engine/tuning';

const setup: MatchSetup = {
  a: { id: 'NZL', kitIdx: 0, human: false },
  b: { id: 'SAM', kitIdx: 0, human: false },
  difficulty: 3, halfMinutes: 40, weather: WEATHER_ROLL(0.4), seed: 1,
};
const m = new Match(setup);
let lastLog = -1;
let lastKind = '';
let lastPhaseX = -1;
const sincePhase: Record<string, number> = {};

for (let i = 0; i < 3_000_000 && !m.over; i++) {
  m.update(0.05);
  const t = m.t;
  // track phase kind spans
  const pk = `${m.kind}`;
  if (pk !== lastKind) {
    if (!sincePhase[lastKind]) sincePhase[lastKind] = 0;
    sincePhase[lastKind] = 0;
    lastKind = pk;
  }
  const carrier = m.carrier();
  const holderX = carrier ? carrier.x : m.kind === 'RUCK' && m.ruck ? m.ruck.x : m.kind === 'MAUL' && m.maul ? m.maul.x : NaN;
  const near = m.kind === 'OPEN' || m.kind === 'RUCK' || m.kind === 'MAUL';
  if (near && Number.isFinite(holderX)) {
    // A near the B line (x=100), or B near the A line (x=0)
    const AThreat = holderX > 97;
    if (AThreat && t - lastLog > 0.5) {
      lastLog = t;
      const h = carrier ? `carrier ${carrier.num} ${carrier.name}` : m.kind;
      console.log(`${(t / 60).toFixed(1)}' kind=${m.kind.padEnd(7)} x=${holderX.toFixed(1)} ${h} ball=${m.ball.state}`);
      void lastPhaseX;
    }
  }
}
console.log('score', m.a.score, '-', m.b.score, 'tries', m.a.tries, m.b.tries, 'kindEnd', m.kind);
