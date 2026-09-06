import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const N = Number(process.argv[2] ?? 3);
const diff = Number(process.argv[3] ?? 3);

const kickTypes: Record<string, number> = {};
const ctx: Record<string, number> = {};
let lineouts = 0, scrums = 0, outTouches = 0, dead = 0;
let penaltyByDist = 0;

for (let m = 0; m < N; m++) {
  const d: any = new Director(gateConfig(diff));
  const proto = Object.getPrototypeOf(d);
  const origStartLineout = proto.startLineout;
  const origStartScrum = proto.startScrum;
  const origStartKick = proto.startKick;
  let mLo = 0, mSc = 0, mTouch = 0, mDead = 0;
  let prevPhase = '', prevPx = 0, prevPz = 0;
  const kickByType: Record<string, number> = {};
  proto.startLineout = function (...a: any[]) {
    const phase = this.phase;
    const kk = !!this.kk;
    const key = `${phase}|kk=${kk ? 1 : 0}`;
    ctx[key] = (ctx[key] ?? 0) + 1;
    if (kk) mTouch++;
    mLo++;
    return origStartLineout.call(this, ...a);
  };
  proto.startScrum = function (...a: any[]) {
    mSc++;
    return origStartScrum.call(this, ...a);
  };
  proto.startKick = function (team: any, type: string, ...a: any[]) {
    kickByType[type] = (kickByType[type] ?? 0) + 1;
    return origStartKick.call(this, team, type, ...a);
  };
  while (!d.over) {
    d.update(1 / 60, NO_INPUT, new Set());
  }
  lineouts += mLo; scrums += mSc;
  for (const k of Object.keys(kickByType)) kickTypes[k] = (kickTypes[k] ?? 0) + kickByType[k];
  console.log(`match ${m}: lo=${mLo} sc=${mSc} kicks=${JSON.stringify(kickByType)} pens=${d.A.stats.penaltiesConceded + d.B.stats.penaltiesConceded} rest=${d.A.stats.restarts + d.B.stats.restarts} pass=${d.A.stats.passes + d.B.stats.passes} tack=${d.A.stats.tackles + d.B.stats.tackles} ruck=${d.A.stats.rucks + d.B.stats.rucks} score=${d.A.score}-${d.B.score}`);
}
console.log('avg:', `lo=${(lineouts / N).toFixed(1)} sc=${(scrums / N).toFixed(1)}`);
console.log('kickTypes avg:', JSON.stringify(Object.fromEntries(Object.entries(kickTypes).map(([k, v]) => [k, (v / N).toFixed(1)]))));
console.log('lineout ctx:', JSON.stringify(ctx));
