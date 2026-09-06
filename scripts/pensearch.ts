import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const N = Number(process.argv[2] ?? 2);
const diff = Number(process.argv[3] ?? 3);
const tally: Record<string, number> = {};
const rest: Record<string, number> = {};
for (let m = 0; m < N; m++) {
  const d: any = new Director(gateConfig(diff));
  const proto = Object.getPrototypeOf(d);
  const orig = proto.lawCall;
  proto.lawCall = function (key: string, call: string, team: any) {
    const k = call.split('—').pop()?.trim() ?? call;
    if (call.startsWith('PENALTY')) tally[k] = (tally[k] ?? 0) + 1;
    else rest[k] = (rest[k] ?? 0) + 1;
    return orig.call(this, key, call, team);
  };
  while (!d.over) d.update(1 / 60, NO_INPUT, new Set());
  console.log(`match ${m}: pens=${d.A.stats.penaltiesConceded + d.B.stats.penaltiesConceded} rest=${d.A.stats.restarts + d.B.stats.restarts} lo=${d.setPieceEvents.lineouts} sc=${d.setPieceEvents.scrums} ruck=${d.A.stats.rucks + d.B.stats.rucks} pass=${d.A.stats.passes + d.B.stats.passes}`);
}
console.log('penalty write tally:', JSON.stringify(Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, (v / N).toFixed(1)]))));
console.log('restart write tally:', JSON.stringify(Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, (v / N).toFixed(1)]))));
