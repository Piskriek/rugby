import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const N = Number(process.argv[2] ?? 4);
const diff = Number(process.argv[3] ?? 3);
const ctx: Record<string, number> = {};
const kt: Record<string, number> = {};
const proto: any = Director.prototype;
const origLO = proto.startLineout;
proto.startLineout = function (...a: any[]) {
  const phase = this.phase;
  const kk = this.kk ? 'kick' : 'no-kick';
  const key = `${phase}|${kk}`;
  ctx[key] = (ctx[key] ?? 0) + 1;
  return origLO.call(this, ...a);
};
const origKick = proto.startKick;
proto.startKick = function (team: any, type: string, ...a: any[]) {
  kt[type] = (kt[type] ?? 0) + 1;
  return origKick.call(this, team, type, ...a);
};
for (let m = 0; m < N; m++) {
  const d: any = new Director(gateConfig(diff));
  while (!d.over) d.update(1 / 60, NO_INPUT, new Set());
  console.log(`match ${m}: lo=${d.setPieceEvents.lineouts} sc=${d.setPieceEvents.scrums} pens=${d.A.stats.penaltiesConceded + d.B.stats.penaltiesConceded} ruck=${d.A.stats.rucks + d.B.stats.rucks} pass=${d.A.stats.passes + d.B.stats.passes} kick=${d.A.stats.kicks + d.B.stats.kicks} off=${d.A.stats.offsides + d.B.stats.offsides}`);
}
console.log('lineout ctx:', JSON.stringify(ctx), 'kickTypes:', JSON.stringify(kt));
