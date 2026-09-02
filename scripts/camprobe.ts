import { runDeep } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
const seed = Number(process.argv[2] ?? 9);
let s = seed >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const r = runDeep(gateConfig(3), 90);
const cams = r.diags.filter((d) => d.kind === 'CAMERA');
console.log(`seed ${seed}: offTarget ${r.offTargetFrames}, watchdog ${r.watchdogTrips}, phases ${r.phasesVisited.join(',')}`);
for (const c of cams) console.log(`   t=${c.t} ${c.detail}`);
