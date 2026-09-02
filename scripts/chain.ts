import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
const d: any = new Director(gateConfig(Number(process.argv[2] ?? 3)));
const proto = Object.getPrototypeOf(d);
const origDoPass = proto.doPass;
let lastCarrier = -1, chain = 0;
const chains: number[] = [];
proto.doPass = function (side: number, cut: boolean) {
  const r = origDoPass.call(this, side, cut);
  if (this.op?.ball?.live) chain++;
  return r;
};
let guard = 0, frames = 0, catchFrames = 0;
let lastNum = -1;
while (!d.over && guard < 60 * 60 * 8) {
  d.update(1/60, NO_INPUT, new Set()); guard++; frames++;
  if (d.op && !d.op.ball.live) {
    if (d.op.carrierNum !== lastNum) {
      // possession change or new carrier (pass caught or new episode)
      if (chain > 0) { chains.push(chain); chain = 0; }
      lastNum = d.op.carrierNum;
      catchFrames++;
    }
  }
}
if (chain > 0) chains.push(chain);
const dist: Record<string, number> = {};
for (const c of chains) dist[`${c}`] = (dist[`${c}`] ?? 0) + 1;
console.log('carrier-changes:', catchFrames, 'pass chains distribution:', JSON.stringify(dist));
console.log('passes:', d.A.stats.passes + d.B.stats.passes, 'episodes:', catchFrames);
