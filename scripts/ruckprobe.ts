/** Ruck contest probe: exit path + axis at exit for every breakdown in a match. */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

let s = Number(process.argv[3] ?? 11) >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

const d = new Director(gateConfig(Number(process.argv[2] ?? 3)));
const dt = 1 / 60;
let guard = 60 * 60 * 60 * 12;
const exits = new Map<string, number>();
const axisBins = new Map<string, number>();
let lastWhy = '', lastStage = '', lastAxis = 0, lastForces = '';
while (!d.over && guard-- > 0) {
  if (d.bd) { lastWhy = d.bd.resultWhy; lastStage = d.bd.stage; lastAxis = d.bd.axis; lastForces = `${Math.round(d.bd.power.A)}v${Math.round(d.bd.power.B)}`; }
  const to = d.teams.A.stats.turnovers + d.teams.B.stats.turnovers;
  const rk = d.teams.A.stats.rucks + d.teams.B.stats.rucks;
  const pen = d.teams.A.stats.penaltiesConceded + d.teams.B.stats.penaltiesConceded;
  d.update(dt, NO_INPUT, new Set());
  if (d.bd === undefined && lastStage) {
    const toD = d.teams.A.stats.turnovers + d.teams.B.stats.turnovers - to;
    const rkD = d.teams.A.stats.rucks + d.teams.B.stats.rucks - rk;
    const penD = d.teams.A.stats.penaltiesConceded + d.teams.B.stats.penaltiesConceded - pen;
    const kind = toD ? 'STEAL' : rkD ? 'WIN' : penD ? 'PEN' : `??(${lastStage})`;
    exits.set(kind, (exits.get(kind) ?? 0) + 1);
    const key = `${kind} axis=${lastAxis >= 0 ? '+' : ''}${lastAxis.toFixed(2)} ${lastForces}`;
    axisBins.set(key, (axisBins.get(key) ?? 0) + 1);
    lastStage = '';
  }
}
console.log('exits:', [...exits.entries()].sort((a,b)=>b[1]-a[1]));
console.log('detail (top 12):');
for (const [k,v] of [...axisBins.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(' ', v, k);
