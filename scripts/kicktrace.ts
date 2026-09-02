import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
const diff = Number(process.argv[2] ?? 3);
const d: any = new Director(gateConfig(diff));
const S: any[] = [];
const proto = Object.getPrototypeOf(d);
const origKick = proto.startKick;
proto.startKick = function () {
  const r = origKick.apply(this, arguments);
  if (this.kk && !this.kk.profile.atGoal) {
    S.push({ type: this.kk.type, fp: !!this.kk.fromPenalty, aim: +this.kk.aim.toFixed(2), bx: +this.kk.bx.toFixed(1), bz: +this.kk.bz.toFixed(1) });
  }
  return r;
};
const origLine = proto.startLineout;
proto.startLineout = function () { S.push({ lineout: true }); return origLineout.apply(this, arguments); };
const origOpen = proto.startOpen;
proto.startOpen = function (tm: any, x: number, z: number, num: number) {
  // receipt / regather after kick — mark it
  if (S.length && !S[S.length - 1].outcome) S[S.length - 1].outcome = `open(${tm},${num})@z${z.toFixed(0)}`;
  return origOpen.apply(this, arguments);
};
const origBd = proto.startBreakdown;
proto.startBreakdown = function () {
  if (S.length && !S[S.length - 1].outcome) S[S.length - 1].outcome = 'breakdown(tackled)';
  return origBd.apply(this, arguments);
};
let guard = 0;
while (!d.over && guard < 60 * 60 * 8) { d.update(1/60, NO_INPUT, new Set()); guard++; }
const punts = S.filter((e) => e.aim !== undefined);
console.log('total non-goal kicks:', punts.length);
for (const e of punts.slice(0, 40)) console.log(JSON.stringify(e));
const fp = punts.filter((e) => e.fp);
console.log('fromPenalty:', fp.length, '→ lineouts:', S.filter((e) => e.lineout).length);
