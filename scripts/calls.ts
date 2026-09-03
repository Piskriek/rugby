import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { passOptions } from '../src/game/intelligence';
import { wetnessOf, WEATHERS } from '../src/game/data';

const diff = Number(process.argv[2] ?? 3);
const d = new Director(gateConfig(diff));
const dt = 1 / 60;
const calls: Record<string, number> = {};
const intents: Record<string, number> = {};
let optSamples = 0, optTotal = 0, epSamples = 0;
let lastCallTxt = '';
let guard = 0;
while (!d.over && guard < 60 * 60 * 8) {
  d.update(dt, NO_INPUT, new Set());
  guard++;
  const f = d.feed[0]?.text ?? '';
  if (f.startsWith('CALL — ') && f !== lastCallTxt) {
    lastCallTxt = f;
    calls[f.slice(7).split(' —')[0]] = (calls[f.slice(7).split(' —')[0]] ?? 0) + 1;
  }
  if (d.op && !d.op.ball.live) {
    epSamples++;
    if (epSamples % 90 === 0) {
      const car = d.live.find((p) => p.team === d.op!.attacking && p.num === d.op!.carrierNum);
      if (!car) { epSamples++; continue; }
      const wet = 0.2;
      const opts = passOptions(car, d.live, d.op.open, false, wet);
      optTotal += opts.length; optSamples++;
      intents[d.op.aiIntent] = (intents[d.op.aiIntent] ?? 0) + 1;
    }
  }
}
console.log('calls:', Object.entries(calls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('sampled intents:', Object.entries(intents).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('avg pass options per sample:', (optTotal / Math.max(1, optSamples)).toFixed(2));
console.log('passes:', d.A.stats.passes + d.B.stats.passes, 'kicks:', d.A.stats.kicks + d.B.stats.kicks,
  'tackles:', d.A.stats.tackles + d.B.stats.tackles, 'rucks:', d.A.stats.rucks + d.B.stats.rucks,
  'lineouts:', d.setPieceEvents.lineouts,
  'scrums:', d.setPieceEvents.scrums,
  'pens:', d.A.stats.penaltiesConceded + d.B.stats.penaltiesConceded,
  'score', d.A.score, '-', d.B.score, 'min', d.minute);
