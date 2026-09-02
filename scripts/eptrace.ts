import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
const d: any = new Director(gateConfig(3));
const proto = Object.getPrototypeOf(d);
const open: any[] = [];
const ends: Record<string, { n: number; tot: number; max: number }> = {};
const endAt = (kind: string) => {
  if (!open.length) return;
  const e = open.pop();
  const dur = d.t - e.t0;
  ends[kind] = ends[kind] ?? { n: 0, tot: 0, max: 0 };
  ends[kind].n++; ends[kind].tot += dur; ends[kind].max = Math.max(ends[kind].max, dur);
};
const wrap = (name: string, kind: string) => {
  const orig = proto[name];
  proto[name] = function () { endAt(kind); return orig.apply(this, arguments); };
};
wrap('startBreakdown', 'TACKLE');
wrap('startKick', 'KICK');
wrap('startLineout', 'LINEOUT');
wrap('startScrum', 'SCRUM');
wrap('scoreTry', 'TRY');
const origOpen = proto.startOpen;
proto.startOpen = function (tm: any, x: number, z: number, num: number, phase: number) {
  if (open.length && open[open.length - 1].same) open.pop(); // replace same-episode restart (offload/pass continuation)
  open.push({ t0: d.t, num, phase, same: false });
  return origOpen.apply(this, arguments);
};
let guard = 0;
while (!d.over && guard < 60 * 60 * 8) { d.update(1/60, NO_INPUT, new Set()); guard++; }
const rows = Object.entries(ends).sort((a, b) => b[1].tot - a[1].tot);
for (const [k, v] of rows) console.log(k.padEnd(10), 'n=' + String(v.n).padStart(3), 'avg=' + (v.tot / v.n).toFixed(1) + 's', 'tot=' + v.tot.toFixed(0) + 's', 'max=' + v.max.toFixed(0) + 's');
console.log('passes:', d.A.stats.passes + d.B.stats.passes, 'tackles:', d.A.stats.tackles + d.B.stats.tackles, 'rucks:', d.A.stats.rucks + d.B.stats.rucks);
