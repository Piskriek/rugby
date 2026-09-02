import { runDeep } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
for (const seed of [7, 23, 31, 42, 55, 60, 77, 88]) {
  for (const diff of [0, 3, 6]) {
    let s = seed >>> 0 || 1;
    Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const r = runDeep(gateConfig(diff), 100);
    if (r.offTargetFrames > 60) {
      const cams = r.diags.filter((d) => d.kind === 'CAMERA').slice(0, 4);
      console.log(`seed ${seed} diff ${diff}: offTarget ${r.offTargetFrames}, wd ${r.watchdogTrips}, phases ${r.phasesVisited.join(',')}`);
      for (const c of cams) console.log(`   t=${c.t} ${c.detail}`);
      /* where does it START and does it END? */
      console.log(`   lastCamEvent t=${cams.length ? cams[cams.length-1].t : '-'}; match over=${r.summary.length > 0}`);
    }
  }
}
console.log('hunt done');
