import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 90);
const diff = Number(process.argv[3] ?? 3);
const seed = Number(process.argv[4] ?? 1);
seedRng(seed);
const d: any = new Director(gateConfig(diff));
const proto: any = Director.prototype;
const origPlace = proto.place;
let shown = 0;
proto.place = function (p: any, x: number, z: number, who: string) {
  const ddx = x - p.x, ddz = z - p.z;
  const disp = Math.hypot(ddx, ddz);
  if (disp > 0.8 && shown < 25) {
    shown++;
    console.log(`PLACE ${who} sh${p.num}(${p.team}) ${disp.toFixed(2)}m prevMovedBy=${p.movedBy ?? '-'} v=(${p.vx.toFixed(2)},${p.vz.toFixed(2)}) z:${p.z.toFixed(2)}->${z.toFixed(2)} phase=${d.phase} kk=${d.kk?.stage ?? ''}`);
  }
  return origPlace.call(this, p, x, z, who);
};
for (let i = 0; i < seconds * 60; i++) d.update(1 / 60, NO_INPUT, new Set());
console.log('done');
