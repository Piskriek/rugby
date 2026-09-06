import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
function run() {
  let eps = 0, wins = 0, stealTry = 0, deepest = 0;
  for (const sd of [1,2,3]) {
    seedRng(sd);
    const d = new Director(gateConfig(3));
    const dt = 1/60; let cur: any = null;
    for (let f = 0; f < 90*60; f++) {
      if (d.bd && !cur) { cur = { axis: 1 }; eps++; }
      d.update(dt, {}, new Set());
      if (d.bd && cur) cur.axis = Math.min(cur.axis, d.bd.axis);
      if (!d.bd && cur) { if (cur.axis <= -0.75) wins++; deepest = Math.min(deepest, cur.axis); cur = null; }
    }
  }
  console.log(`rucks=${eps} rucks reaching -0.75=${wins} deepest=${deepest.toFixed(2)}`);
}
run();
