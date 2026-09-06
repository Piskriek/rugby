/**
 * TELEPORT PROBE — attribute every teleport to the system that caused it.
 *
 * The gate only says "someone moved 3 m in one frame". This wraps every
 * position write so we learn WHICH writer did it, in WHICH phase, and what
 * the player was doing at the time. Measure first.
 */
import { Director } from '../src/game/director';
import { botInput, TELEPORT_METRES } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

type Hit = { who: string; phase: string; disp: number; num: number; team: string; t: number; carrier: boolean; recover: boolean; dive: boolean; stage: string; ktype: string };

const hits: Hit[] = [];

for (const diff of [0, 3, 6]) {
  seedRng(1);
  const d = new Director(gateConfig(diff));
  const st: any = {};
  const dt = 1 / 60;
  const prev = new Map<string, { x: number; z: number }>();
  for (let f = 0; f < 60 * 100; f++) {
    for (const p of d.live) prev.set(`${p.team}${p.num}`, { x: p.x, z: p.z });
    const { inp, pressed } = botInput(d, dt, st);
    d.update(dt, inp, pressed);
    for (const p of d.live) {
      const was = prev.get(`${p.team}${p.num}`);
      if (!was) continue;
      const disp = Math.hypot(p.x - was.x, p.z - was.z);
      if (disp > TELEPORT_METRES) {
        hits.push({
          who: (p as any).movedBy ?? 'unknown', phase: d.phase, disp,
          num: p.num, team: p.team, t: Math.round(d.t * 10) / 10,
          carrier: !!p.carrier, recover: !!((p as any).recoverT > 0), dive: !!((p as any).diveT > 0),
          stage: (d as any).kk?.stage ?? (d as any).sp?.stage ?? '-', ktype: (d as any).kk?.type ?? (d as any).sp?.type ?? '-',
        });
      }
    }
  }
}

console.log(`=== ${hits.length} teleports across difficulty 0/3/6 ===\n`);
const byWho = new Map<string, Hit[]>();
for (const h of hits) {
  const k = `${h.who} @ ${h.phase}`;
  if (!byWho.has(k)) byWho.set(k, []);
  byWho.get(k)!.push(h);
}
const rows = [...byWho.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [k, list] of rows) {
  const max = Math.max(...list.map((h) => h.disp));
  const shirts = [...new Set(list.map((h) => h.num))].sort((a, b) => a - b);
  console.log(`${String(list.length).padStart(3)}x  ${k.padEnd(34)} max ${max.toFixed(2)} m  shirts ${shirts.join(',')}`);
  console.log(`      recovering:${list.filter((h) => h.recover).length} diving:${list.filter((h) => h.dive).length} carrier:${list.filter((h) => h.carrier).length}`);
}
console.log('\nfirst 12 raw:');
for (const h of hits.slice(0, 12)) {
  console.log(`  t=${h.t}s ${h.team}${h.num} ${h.disp.toFixed(2)}m by=${h.who} phase=${h.phase} stage=${h.stage} type=${h.ktype}`);
}
