/**
 * CPU attack: they must run FORWARD with the ball, not only pass backward
 * into their own in-goal.
 *
 * Usage: npx vite-node scripts/cpucarry.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}

function runFrom(z0: number, label: string, shirt = 9, attack: 'A' | 'B' = 'A') {
  const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
  d.releaseAll();
  d.kk = undefined;
  const dir = attack === 'A' ? 1 : -1;
  for (const p of d.live) {
    const onAtk = p.team === attack;
    p.x = (p.num - 8) * 2.4;
    p.z = z0 + (onAtk ? -dir * (3 + (p.num % 6)) : dir * (12 + (p.num % 6)));
    p.vx = 0; p.vz = 0; p.down = false; p.bound = false; p.recoverT = 0;
  }
  d.startOpen(attack, 0, z0, shirt, 1, 0, 1.0);
  const car0 = d.L(attack, shirt);
  car0.x = 0; car0.z = z0;
  if (d.op) { d.op.carrierX = 0; d.op.carrierZ = z0; d.op.originZ = z0; }

  let minAlong = 0;
  let maxAlong = 0;
  let minZ = z0;
  let passes = 0;
  let carryFrames = 0;
  let fwdFrames = 0;
  let lastCar = shirt;
  const intents: Record<string, number> = {};

  for (let i = 0; i < 480; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    if (d.phase !== 'OPEN_PLAY' || !d.op) break;
    const car = d.L(attack, d.op.carrierNum);
    minZ = Math.min(minZ, car.z);
    const along = (car.z - z0) * dir;
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    if (d.op.carrierNum !== lastCar) { passes++; lastCar = d.op.carrierNum; }
    if (!d.op.ball.live) {
      carryFrames++;
      if (car.vz * d.op.dir > 0.6) fwdFrames++;
    }
    const it = d.op.aiIntent || '';
    intents[it] = (intents[it] ?? 0) + 1;
  }
  const gained = maxAlong;
  const retreat = -minAlong;
  console.log(`  [${label}] z0=${z0} minZ=${minZ.toFixed(1)} gained=${gained.toFixed(1)} retreat=${retreat.toFixed(1)} passes=${passes} fwd=${fwdFrames}/${carryFrames} intents=${JSON.stringify(intents)} phase=${d.phase}`);
  return { gained, retreat, passes, fwd: carryFrames ? fwdFrames / carryFrames : 0, minZ, minAlong };
}

const mid = runFrom(0, 'A-halfway-9');
check('from halfway the CPU gains ground toward the try', mid.gained > 2, `gained=${mid.gained.toFixed(1)} m`);
check('from halfway they actually run forward with it', mid.fwd > 0.25, `fwd-ratio=${mid.fwd.toFixed(2)}`);
check('from halfway they do not march into their own in-goal', mid.minZ > -48, `minZ=${mid.minZ.toFixed(1)}`);

const own = runFrom(-28, 'A-own-22-9');
check('from the own 22 they do not pass into in-goal', own.minZ > -49.5, `minZ=${own.minZ.toFixed(1)}`);
check('from the own 22 they either carry out or at least hold', own.gained > 1 || own.retreat < 10,
  `gained=${own.gained.toFixed(1)} retreat=${own.retreat.toFixed(1)}`);
check('from the own 22 the carrier still runs forward some of the time', own.fwd > 0.2,
  `fwd-ratio=${own.fwd.toFixed(2)}`);

const bOwn = runFrom(28, 'B-own-22-9', 9, 'B');
check('B from their 22 do not pass into their in-goal', bOwn.minAlong > -18, `minAlong=${bOwn.minAlong.toFixed(1)}`);
check('B from their 22 run forward some of the time', bOwn.fwd > 0.2, `fwd-ratio=${bOwn.fwd.toFixed(2)}`);

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
