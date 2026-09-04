/**
 * D-4 — N-02 "Smell Blood": measure the DETECTOR before tuning the AI.
 *
 * Ruled predicate: the ball carrier is ahead of the defence's median depth AND
 * has >= 7.0 m of clear space in a forward-facing +/-45 degree cone.
 *
 * Reports how often that is true, and — the actual question — what the
 * attackers do when it is. Read-only.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const dt = 1 / 60;
const diff = Number(process.argv[2] ?? 3);
const secs = Number(process.argv[3] ?? 180);
const CONE = Math.PI / 4;      // +/-45 deg
const CLEAR = 7.0;             // metres

seedRng(1);
const d = new Director(gateConfig(diff));

let carrierFrames = 0, aheadFrames = 0, clearFrames = 0, bothFrames = 0;
const clearances: number[] = [];
interface Ep { t: number; frames: number; carrier: string; startClear: number; gained: number; startZ: number }
let cur: Ep | null = null;
const eps: Ep[] = [];
let prevCarrierZ = 0;

for (let i = 0; i < secs * 60 && !d.over; i++) {
  d.update(dt, NO_INPUT, new Set());
  const op = d.op;
  if (!op || op.ball.live) { if (cur) { eps.push(cur); cur = null; } continue; }
  const carrier = d.live.find((p) => p.team === op.attacking && p.num === op.carrierNum);
  if (!carrier) { if (cur) { eps.push(cur); cur = null; } continue; }
  carrierFrames++;
  const defTeam = op.attacking === 'A' ? 'B' : 'A';
  const defs = d.live.filter((p) => p.team === defTeam);
  if (!defs.length) continue;
  // attacking direction: +1 or -1 in z
  const dir = op.attacking === 'A' ? 1 : -1;
  const depths = defs.map((p) => p.z).sort((a, b) => a - b);
  const median = depths[Math.floor(depths.length / 2)];
  const ahead = (carrier.z - median) * dir > 0;
  if (ahead) aheadFrames++;
  // clear space in the forward cone
  let nearest = Infinity;
  for (const p of defs) {
    const dx = p.x - carrier.x, dz = (p.z - carrier.z) * dir;
    if (dz <= 0) continue;                       // behind him
    const ang = Math.atan2(Math.abs(dx), dz);
    if (ang > CONE) continue;                    // outside the cone
    nearest = Math.min(nearest, Math.hypot(dx, dz));
  }
  clearances.push(nearest === Infinity ? 999 : nearest);
  const clear = nearest >= CLEAR;
  if (clear) clearFrames++;
  if (ahead && clear) {
    bothFrames++;
    if (!cur) cur = { t: d.t, frames: 0, carrier: `${carrier.team}${carrier.num}`, startClear: nearest === Infinity ? 999 : nearest, gained: 0, startZ: carrier.z };
    cur.frames++;
    cur.gained = (carrier.z - cur.startZ) * dir;
  } else if (cur) { eps.push(cur); cur = null; }
  prevCarrierZ = carrier.z;
}
if (cur) eps.push(cur);

console.log('=========== D-4  SMELL BLOOD DETECTOR  (diff %s, %ss) ===========', diff, secs);
console.log('frames with a live carrier: %s', carrierFrames);
console.log('\n--- the ruled predicate, decomposed ---');
const pc = (n: number) => `${((n / Math.max(1, carrierFrames)) * 100).toFixed(1)}%`;
console.log('  carrier ahead of defensive median depth : %s frames (%s)', aheadFrames, pc(aheadFrames));
console.log('  >= %s m clear in a +/-45 deg cone        : %s frames (%s)', CLEAR, clearFrames, pc(clearFrames));
console.log('  BOTH (the predicate fires)              : %s frames (%s)', bothFrames, pc(bothFrames));

const cs = clearances.filter((c) => c < 900).sort((a, b) => a - b);
const q = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p / 100 * a.length))] : NaN);
console.log('\n--- distribution of forward clear space (m) ---');
console.log('  p10 %s  p50 %s  p90 %s  p99 %s   (empty cone on %s frames)',
  q(cs, 10).toFixed(1), q(cs, 50).toFixed(1), q(cs, 90).toFixed(1), q(cs, 99).toFixed(1),
  clearances.length - cs.length);

console.log('\n--- episodes where the predicate held ---');
console.log('  episodes: %s', eps.length);
const long = eps.filter((e) => e.frames >= 12);
console.log('  lasting >= 0.2 s: %s', long.length);
if (long.length) {
  const dur = long.map((e) => e.frames / 60).sort((a, b) => a - b);
  console.log('  duration p50 %s  p90 %s  max %s s', q(dur, 50).toFixed(2), q(dur, 90).toFixed(2), q(dur, 100).toFixed(2));
  const g = long.map((e) => e.gained).sort((a, b) => a - b);
  console.log('  metres gained while the gap was open: p50 %s  p90 %s  max %s',
    q(g, 50).toFixed(1), q(g, 90).toFixed(1), q(g, 100).toFixed(1));
  const wasted = long.filter((e) => e.gained < 1).length;
  console.log('  episodes gaining < 1 m (gap seen, not taken): %s / %s (%s%%)',
    wasted, long.length, (wasted / long.length * 100).toFixed(1));
}
console.log('\nIf the predicate almost never fires, the bug is the DETECTOR.');
console.log('If it fires often and metres gained is low, the bug is the BEHAVIOUR.');
