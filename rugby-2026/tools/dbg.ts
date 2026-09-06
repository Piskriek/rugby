/** Debug probe — step one match and print deep state at stall/failure. */
import { Match } from '../src/engine/match';
import type { MatchSetup } from '../src/engine/types';
import { WEATHER_ROLL } from '../src/engine/tuning';

export {};

const setup: MatchSetup = {
  a: { id: 'NZL', kitIdx: 0, human: false },
  b: { id: 'SAM', kitIdx: 0, human: false },
  difficulty: 3,
  halfMinutes: 40,
  weather: WEATHER_ROLL(0.4),
  seed: 1,
};
const m = new Match(setup);
const seen = new Set<string>();
for (let i = 0; i < 200_000 && !m.over; i++) {
  const kindBefore = (m as unknown as { kind: string }).kind;
  m.update(0.05);
  const mm = m as unknown as {
    kind: string; kickFlight: unknown; kickLanding: unknown;
    passTarget: unknown; ball: { state: string; x: number; y: number; h: number; vz: number; vx: number };
    ruck: unknown; maul: unknown; scrum: unknown; lineout: unknown; goal: unknown; restart: unknown;
    phase: { label: string; sub: string; since?: number }; t: number; over: boolean;
    a: { score: number }; b: { score: number };
  };
  if (mm.kind !== kindBefore) {
    console.log(`t=${mm.t.toFixed(1)} ${kindBefore} → ${mm.kind} | ${mm.phase.label} | ${mm.phase.sub}`);
    if (!seen.has(mm.kind)) { seen.add(mm.kind); }
    if (mm.kind === 'KICKFLIGHT') {
      console.log('   kickFlight=', JSON.stringify(mm.kickFlight));
      console.log('   kickLanding=', JSON.stringify(mm.kickLanding));
      console.log('   ball=', JSON.stringify(mm.ball));
    }
  }
  if (i % 4000 === 0 && i > 0) {
    console.log(`…t=${mm.t.toFixed(0)} kind=${mm.kind} phase="${mm.phase.label}/${mm.phase.sub}" ball=${mm.ball.state}@${mm.ball.x.toFixed(0)},${mm.ball.y.toFixed(0)}h${mm.ball.h.toFixed(2)} score=${mm.a.score}-${mm.b.score}`);
  }
  if (i > 500 && mm.t < 4 && false) { console.log('FROZEN EARLY'); break; }
}
console.log('over=', m.over, 't=', m.t.toFixed(0), 'score=', m.a.score, '-', m.b.score);
