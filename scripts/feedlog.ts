import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
const d: any = new Director(gateConfig(3));
const proto = Object.getPrototypeOf(d);
const origSay = proto.say;
const all: string[] = [];
proto.say = function (t: string) { all.push(`${this.clockText} ${t}`); return origSay.call(this, t); };
let guard = 0;
while (!d.over && guard < 60 * 60 * 8) { d.update(1/60, NO_INPUT, new Set()); guard++; }
// compress: drop consecutive duplicate CALL lines
const out: string[] = [];
for (const l of all) if (!out.length || out[out.length - 1].split(' ').slice(1).join(' ') !== l.split(' ').slice(1).join(' ')) out.push(l);
for (const l of out.slice(0, 90)) console.log(l);
