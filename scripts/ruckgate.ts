/**
 * Ruck-out: contestants peel SIDEWAYS off the pile. They must not sprint
 * through the ruck (the "jump") and overshoot behind the nine.
 *
 * Usage: npx vite-node scripts/ruckgate.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}

const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
d.releaseAll();
d.kk = undefined;
for (const p of d.live) {
  p.x = (p.num - 8) * 1.1 + (p.team === 'A' ? -1.6 : 1.6);
  p.z = p.team === 'A' ? -1.4 : 1.4;
  p.vx = 0; p.vz = 0;
  p.down = false; p.bound = false; p.recoverT = 0;
  p.clip = 'ready';
}
d.startOpen('A', 0, 0, 12, 1);
const car = d.L('A', 12);
car.x = 0; car.z = 0;
if (d.op) { d.op.carrierX = 0; d.op.carrierZ = 0; }
const tkl = d.L('B', 7);
tkl.x = 0.4; tkl.z = 0.7;
d.startBreakdown(7);

const bd = d.bd;
if (!bd) throw new Error('no breakdown after startBreakdown');
const pile = bd.players.map((q) => ({ team: q.team, num: q.num, role: q.role }));
const cz = bd.contactZ;
const jackals = bd.players.filter((q) => q.role === 'JACKAL' || q.role === 'COUNTER');
const jx = jackals.map((q) => q.x);
const jz = jackals.map((q) => q.z);
const jSpreadX = jx.length ? Math.max(...jx) - Math.min(...jx) : 0;
const jSpreadZ = jz.length ? Math.max(...jz) - Math.min(...jz) : 0;
check('jackals cluster over the ball, not a queue', jSpreadX < 2.4 && jSpreadZ < 2.2,
  `n=${jackals.length} Δx=${jSpreadX.toFixed(2)} Δz=${jSpreadZ.toFixed(2)}`);

bd.stage = 'RECYCLE';
bd.ruckFormed = true;
bd.groundAt = 0;
bd.window = 0.05;
bd.ballOutAt = 0;
bd.t = 0.2;
bd.axis = 0.9;

let opened = false;
for (let i = 0; i < 20; i++) {
  d.update(1 / 60, NO_INPUT, new Set());
  if (d.phase === 'OPEN_PLAY' && d.op) { opened = true; break; }
}
check('recycle hands off to open play', opened && !!d.op, `phase=${d.phase} peel=${!!d.ruckPeel}`);
check('peel beat is armed', !!d.ruckPeel && (d.ruckPeel.until - d.t) > 0.4,
  `until-t=${d.ruckPeel ? (d.ruckPeel.until - d.t).toFixed(2) : 'none'}`);
check('releaseBeat dir is the attack (+z for A)', !!d.releaseBeat && d.releaseBeat.dir === 1,
  `dir=${d.releaseBeat?.dir}`);

const nine = d.L('A', 9);
const start: Record<string, { x: number; z: number }> = {};
for (const q of pile) {
  const p = d.L(q.team, q.num);
  start[`${q.team}:${q.num}`] = { x: p.x, z: p.z };
}

let peelJobs = 0;
let maxSpeed = 0;
let throughNine = 0;
let jumpedZ = 0;
let sprinter = '';
const samples: string[] = [];

for (let i = 0; i < 70; i++) {
  d.update(1 / 60, NO_INPUT, new Set());
  if (d.phase !== 'OPEN_PLAY') break;
  const peeling = !!(d.ruckPeel && d.t < d.ruckPeel.until);
  for (const q of pile) {
    if (q.team === 'A' && q.num === nine.num) continue;
    const p = d.L(q.team, q.num);
    const sp = Math.hypot(p.vx, p.vz);
    if (peeling && (p.recoverT ?? 0) <= 0 && sp > maxSpeed) {
      maxSpeed = sp;
      sprinter = `${q.team}${q.num} ${p.job.slice(0, 24)} v=${sp.toFixed(2)}`;
    }
    if (p.job.includes('PEEL OFF THE GATE')) peelJobs++;
    const dz = Math.abs(p.z - cz);
    if (dz > jumpedZ) jumpedZ = dz;
    /* Behind the nine, in his channel: they sprinted through the pile. */
    const behind = (nine.z - p.z) * 1 > 2.2;
    const channel = Math.abs(p.x - nine.x) < 2.4;
    if (behind && channel && (p.recoverT ?? 0) <= 0) throughNine++;
  }
  if (i === 12 || i === 30 || i === 55) {
    const b6 = d.L('B', pile.find((q) => q.team === 'B')?.num ?? 6);
    samples.push(`f${i} B${b6.num} (${b6.x.toFixed(1)},${b6.z.toFixed(1)}) job=${b6.job.slice(0, 28)} v=${Math.hypot(b6.vx, b6.vz).toFixed(1)}`);
  }
}

check('peel job actually fires on the pile', peelJobs > 8, `hits=${peelJobs}`);
check('nobody on the pile hits a sprint through the gate', maxSpeed < 6.4,
  `max |v|=${maxSpeed.toFixed(2)} m/s`);
check('contestants stay off the nine\'s hip (no fringe snipe)', throughNine < 6,
  `behind-nine frames=${throughNine} nine=(${nine.x.toFixed(1)},${nine.z.toFixed(1)})`);
check('nobody leapt more than 6 m past contact in z', jumpedZ < 6.2,
  `max |z-contact|=${jumpedZ.toFixed(2)}  ${samples.join(' | ')}`);

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
