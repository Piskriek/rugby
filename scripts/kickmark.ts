import { runTrace } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
let s = 1 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const run = runTrace(gateConfig(3), 90);
const bad = run.points.filter((p) => p.kind === 'KICKOFF' && (p.d as any).markLawful === false);
console.log(`KICKOFF points with markLawful=false: ${bad.length}`);
for (const p of bad.slice(0, 8)) {
  const d = p.d as any;
  console.log(`  t=${p.t.toFixed(2)} type=${d.type} mark=${d.mark} stage=${p.stage}`);
}
const b22 = run.points.filter((p) => p.kind === 'KICKOFF' && (p.d as any).markIs22Metre === false);
console.log(`markIs22Metre=false: ${b22.length}`);
for (const p of b22.slice(0, 8)) {
  const d = p.d as any;
  console.log(`  t=${p.t.toFixed(2)} type=${d.type} mark=${d.mark} stage=${p.stage}`);
}
