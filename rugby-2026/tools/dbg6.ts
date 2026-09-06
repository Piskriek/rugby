/** Tick-by-tick microscope around 9.5-11.5 game minutes, everything. */
import { Match } from '../src/engine/match';
import type { MatchSetup } from '../src/engine/types';
import { WEATHER_ROLL } from '../src/engine/tuning';

const setup: MatchSetup = {
  a: { id: 'NZL', kitIdx: 0, human: false },
  b: { id: 'SAM', kitIdx: 0, human: false },
  difficulty: 3, halfMinutes: 40, weather: WEATHER_ROLL(0.4), seed: 1,
};
const m = new Match(setup);
const from = 8 * 60, to = 40 * 60;
let key = '';
for (let i = 0; i < 5_000_000 && !m.over && m.t < to; i++) {
  m.update(0.05);
  if (m.t < from) continue;
  const c = m.carrier();
  const b = m.ball;
  const carry = c ? `${c.team}:${c.num} ${c.name.slice(0, 16)}@${c.x.toFixed(1)},${c.y.toFixed(1)} ${c.state}` : '';
  const k2 = `${m.kind}|${(m.phase.x ?? -1).toFixed(0)}|${b.state}|${b.x.toFixed(1)},${b.y.toFixed(1)}|${carry}|A${m.a.score}-${m.b.score}B`;
  if (k2 !== key) {
    key = k2;
    const vv = c ? Math.hypot(c.vx, c.vy).toFixed(1) : ' - ';
    const st = c ? `stam=${(c.stamina * 100).toFixed(0)}` : '';
    const want = c ? m.desireOf(c.idx) : null;
    const wS = want ? `want=v(${want.vx.toFixed(2)},${want.vy.toFixed(2)})s${want.speed.toFixed(1)}${want.sprint ? '!' : ''}` : 'want=none';
    console.log(
      `${(m.t / 60).toFixed(3)}' k=${m.kind.padEnd(9)} phX=${(m.phase.x ?? -1).toFixed(0).padStart(4)} ` +
      `ball=${b.state.padEnd(6)}@${b.x.toFixed(1)},${b.y.toFixed(1)}h${b.h.toFixed(2)} ${carry} v=${vv} ${st} ${wS} A${m.a.score}-${m.b.score}B`,
    );
  }
}
console.log('score', m.a.score, '-', m.b.score, 'tries', m.a.tries, m.b.tries);
