/**
 * Off-the-top lineout: the ball flies jumper → 9 → 10, defence stays 10 m
 * back until that pass is halfway to the fly-half, and passes hang 25% longer.
 *
 * Usage: npx vite-node scripts/lotap.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';
import { PASS_SPEED } from '../src/game/engine/throwforward';
import { lineoutBacklineMark } from '../src/game/behaviour/setpiece-overrides';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}

check('PASS_SPEED is 13 m/s with 25% more airtime', Math.abs(PASS_SPEED - 13 / 1.25) < 1e-9, `${PASS_SPEED} m/s`);

const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
d.startLineout('A', 12, 30);
if (d.kk) throw new Error('startLineout left a kick live');

for (let i = 0; i < 60; i++) d.update(1 / 60, NO_INPUT, new Set());

const lo = d.lo;
if (!lo) throw new Error('lineout vanished during assemble');
const jumper = lo.players.find((p) => p.team === 'A' && p.role === 'JUMPER');
if (!jumper) throw new Error('no attacking jumper');

lo.stage = 'CATCH';
lo.t = 0.5;
lo.quality = 0.9;
lo.driveCall = false;
lo.ball.x = jumper.x;
lo.ball.y = 2.5;
lo.ball.vy = -1;

d.update(1 / 60, NO_INPUT, new Set());

check('off-the-top leaves LINEOUT', d.phase === 'OPEN_PLAY' && !d.lo && !d.ml, `${d.phase} lo=${!!d.lo} ml=${!!d.ml}`);
const s = d.op;
if (!s) throw new Error('no open play after catch');

check('jumper has custody, not the fly-half', s.carrierNum !== 10 && s.carrierNum >= 1 && s.carrierNum <= 8, `carrier=${s.carrierNum}`);
check('ball is in the air toward 9', s.ball.live && s.pendingReceiver === 9, `live=${s.ball.live} to=${s.pendingReceiver}`);
check('Law 18 hold is armed', !!s.lineoutHold && !s.lineoutHold.released && s.lineoutHold.firstNum === 10, `hold=${JSON.stringify(s.lineoutHold ?? null)}`);

const ten = d.L('A', 10);
const ball0 = d.ballPoint();
const toTen0 = Math.hypot(ball0.x - ten.x, ball0.z - ten.z);
check('ball is not on 10\'s chest the frame of the catch', toTen0 > 4, `ball→10 = ${toTen0.toFixed(1)} m`);

const bMark = lineoutBacklineMark(10, 'B', 12, 1);
let sawHold = false;
let releasedAt = -1;
let sawNine = false;
let sawTen = false;
let minBallY = 99;

for (let i = 0; i < 480; i++) {
  d.update(1 / 60, NO_INPUT, new Set());
  const op = d.op;
  if (!op || d.phase !== 'OPEN_PLAY') break;
  if (op.ball.live) minBallY = Math.min(minBallY, op.ball.y);
  if (op.pendingReceiver === 9 && op.ball.live) sawNine = true;
  if (op.pendingReceiver === 10 && op.ball.live) sawTen = true;
  const b10 = d.L('B', 10);
  if (op.lineoutHold && !op.lineoutHold.released) {
    if (Math.abs(b10.tz - bMark.z) < 1.5) sawHold = true;
  }
  if (op.lineoutHold?.released && releasedAt < 0) releasedAt = i;
  if (!op.ball.live && op.carrierNum === 10) break;
}

check('the tap went to 9 in the air', sawNine, `sawNine=${sawNine}`);
check('9 then put it in the air to 10', sawTen, `sawTen=${sawTen}`);
check('defence 10 stayed on the ten-metre mark during the hold', sawHold, `B10 tz=${d.L('B', 10).tz.toFixed(1)} want ${bMark.z.toFixed(1)}`);
check('hold released once the pass to 10 was halfway (or he caught it)', releasedAt >= 0, `releasedAt frame ${releasedAt}`);
check('10 ends up with the ball', d.op?.carrierNum === 10 && !d.op?.ball.live, `carrier=${d.op?.carrierNum} live=${d.op?.ball.live}`);
check('the ball had a visible arc (not a ground slide)', minBallY < 90 && minBallY >= 1.05, `min y while live=${minBallY.toFixed(2)}`);

/* Drive call still forms a maul — do not send that ball to the backline. */
const d2 = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
d2.startLineout('A', 12, 30);
for (let i = 0; i < 30; i++) d2.update(1 / 60, NO_INPUT, new Set());
const lo2 = d2.lo!;
const j2 = lo2.players.find((p) => p.team === 'A' && p.role === 'JUMPER')!;
lo2.stage = 'CATCH';
lo2.t = 0.5;
lo2.quality = 0.9;
lo2.driveCall = true;
lo2.ball.x = j2.x;
lo2.ball.y = 2.5;
lo2.ball.vy = -1;
d2.update(1 / 60, NO_INPUT, new Set());
check('a drive call still forms the maul', d2.phase === 'MAUL' && !!d2.ml && !d2.op, `${d2.phase} ml=${!!d2.ml} op=${!!d2.op}`);

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
