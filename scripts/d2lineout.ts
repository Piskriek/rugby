/**
 * D-2 — N-01 lineout teleport. Read-only.
 *
 * The NO TELEPORTS gate passes at 0 with a 1.4 m/frame threshold across all
 * phases. If players "snap" into lineout formation, either the jumps are under
 * 1.4 m (many small snaps), or they happen where the gate cannot see them.
 * This probe measures displacement per player per frame, bucketed by phase and
 * by the frame's distance from a LINEOUT phase entry.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const dt = 1 / 60;
const diff = Number(process.argv[2] ?? 3);
const secs = Number(process.argv[3] ?? 180);

const prev = new Map<string, { x: number; z: number }>();
interface Jump { t: number; who: string; d: number; phase: string; prevPhase: string; sinceEntry: number }
const jumps: Jump[] = [];
const byPhase = new Map<string, { n: number; max: number; sum: number; over14: number }>();

seedRng(1);
const d = new Director(gateConfig(diff));
let lastPhase = String(d.phase);
let entryT = 0;
let lineoutEntries = 0;

for (let i = 0; i < secs * 60 && !d.over; i++) {
  for (const p of d.live) prev.set(`${p.team}${p.num}`, { x: p.x, z: p.z });
  const before = String(d.phase);
  d.update(dt, NO_INPUT, new Set());
  const now = String(d.phase);
  if (now !== lastPhase) {
    if (now.startsWith('LINEOUT')) { entryT = d.t; lineoutEntries++; }
    lastPhase = now;
  }
  for (const p of d.live) {
    const was = prev.get(`${p.team}${p.num}`);
    if (!was) continue;
    const disp = Math.hypot(p.x - was.x, p.z - was.z);
    const b = byPhase.get(now) ?? { n: 0, max: 0, sum: 0, over14: 0 };
    b.n++; b.sum += disp; if (disp > b.max) b.max = disp; if (disp > 1.4) b.over14++;
    byPhase.set(now, b);
    if (disp > 0.35) {
      jumps.push({ t: d.t, who: `${p.team}${p.num}`, d: disp, phase: now, prevPhase: before, sinceEntry: d.t - entryT });
    }
  }
}

console.log('=========== D-2  LINEOUT TELEPORT  (diff %s, %ss) ===========', diff, secs);
console.log('lineout entries observed: %s', lineoutEntries);
console.log('\n--- per-frame displacement by phase ---');
console.log('phase                 frames    mean      max    >1.4m (gate)');
for (const [k, v] of [...byPhase].sort((a, b) => b[1].max - a[1].max)) {
  console.log('%s %s  %s  %s  %s', k.padEnd(20), String(v.n).padStart(8),
    (v.sum / v.n).toFixed(4).padStart(8), v.max.toFixed(3).padStart(7), String(v.over14).padStart(6));
}

const lo = jumps.filter((j) => j.phase.startsWith('LINEOUT'));
console.log('\n--- jumps > 0.35 m in a LINEOUT phase: %s ---', lo.length);
const sorted = [...lo].sort((a, b) => b.d - a.d).slice(0, 15);
for (const j of sorted) {
  console.log('  t=%s  %s  %s m  (%s -> %s, %ss after entry)',
    j.t.toFixed(2), j.who.padEnd(5), j.d.toFixed(3), j.prevPhase, j.phase, j.sinceEntry.toFixed(2));
}
/* how concentrated are they at the phase edge? */
const bands = [0.05, 0.2, 0.5, 1, 2, 5, 1e9];
console.log('\n--- when do lineout jumps happen, relative to phase entry? ---');
let lastB = 0;
for (const b of bands) {
  const n = lo.filter((j) => j.sinceEntry >= lastB && j.sinceEntry < b).length;
  console.log('  %s..%s s after entry: %s jumps', lastB, b === 1e9 ? 'inf' : b, n);
  lastB = b;
}
/* A "walk there" would be sustained moderate speed; a snap is one big frame. */
const speeds = lo.map((j) => j.d / dt).sort((a, b) => a - b);
if (speeds.length) {
  console.log('\n  implied speed of those jumps: p50 %s  p90 %s  max %s m/s (sprint ~9)',
    speeds[Math.floor(speeds.length / 2)].toFixed(1),
    speeds[Math.floor(speeds.length * 0.9)].toFixed(1),
    speeds[speeds.length - 1].toFixed(1));
}
