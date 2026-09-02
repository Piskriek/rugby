import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
const diff = Number(process.argv[2] ?? 3);
const d: any = new Director(gateConfig(diff));
const S: Record<string, number> = {};
const proto = Object.getPrototypeOf(d);
const origCpu = proto.cpuCarrier;
const origDoPass = proto.doPass;
const origCallPlay = proto.cpuCallPlay;
const origStart = proto.startOpen;
proto.startOpen = function (tm: any, x: number, z: number, num: number) {
  S[`open_num_${num}`] = (S[`open_num_${num}`] ?? 0) + 1;
  return origStart.apply(this, arguments);
};
proto.cpuCarrier = function (dt: number, s: any) {
  const tickImminent = s.aiTimer <= dt;
  if (tickImminent && this.op && this.op.carrierNum === 9) S.tick9 = (S.tick9 ?? 0) + 1;
  if (tickImminent && this.op && this.op.carrierNum === 9 && this.passOpts && this.passOpts.length) S.tick9opts = (S.tick9opts ?? 0) + 1;
  if (tickImminent) {
    const before = s.aiIntent;
    origCpu.call(this, dt, s);
    // what did the tick decide? (PASS executes same-frame via doPass)
    if (s.ball.live) S.dec_PASS = (S.dec_PASS ?? 0) + 1;
    else if (s.aiIntent !== before) S[`dec_${s.aiIntent}`] = (S[`dec_${s.aiIntent}`] ?? 0) + 1;
    else S.dec_same = (S.dec_same ?? 0) + 1;
    S[`press_${s.pressure > 0.93 ? 'hi' : s.pressure > 0.72 ? 'mid' : 'lo'}`] = (S[`press_${s.pressure > 0.93 ? 'hi' : s.pressure > 0.72 ? 'mid' : 'lo'}`] ?? 0) + 1;
  } else {
    origCpu.call(this, dt, s);
  }
};
proto.doPass = function (side: number, cut: boolean) {
  S.doPass = (S.doPass ?? 0) + 1;
  const opts = this.passOpts ?? [];
  const onSide = opts.filter((o: any) => o.side === side);
  if (!onSide.length) S.noSide = (S.noSide ?? 0) + 1;
  const out = origDoPass.call(this, side, cut);
  if (this.op && !this.op.ball.live && this.phase === 'OPEN_PLAY') S.passDead = (S.passDead ?? 0) + 1;
  return out;
};
proto.cpuCallPlay = function () { S.calls = (S.calls ?? 0) + 1; return origCallPlay.call(this); };
let guard = 0;
while (!d.over && guard < 60 * 60 * 8) { d.update(1/60, NO_INPUT, new Set()); guard++; }
console.log(JSON.stringify(S));
console.log('passes:', d.A.stats.passes + d.B.stats.passes, 'rucks:', d.A.stats.rucks + d.B.stats.rucks,
  'carries-ish tackles:', d.A.stats.tackles + d.B.stats.tackles);
