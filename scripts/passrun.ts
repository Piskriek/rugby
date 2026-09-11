/**
 * Pass on the run: the thrower keeps moving, the catcher is already running,
 * and the ball is aimed in front of him.
 *
 * Usage: npx vite-node scripts/passrun.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';
import { anticipates } from '../src/game/behaviour/backline-echelon';
import { solvePassAim } from '../src/game/engine/throwforward';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(68)} ${detail}`);
}

/* ---- intercept leads a running man, not a statue ---- */
{
  const from = { x: 0, z: 0, vx: 0, vz: 4 };
  const standing = { x: 8, z: -3, vx: 0, vz: 0 };
  const running = { x: 8, z: -3, vx: 0, vz: 5.5 };
  const a0 = solvePassAim(from, standing);
  const a1 = solvePassAim(from, running);
  const lead0 = a0.z - standing.z;
  const lead1 = a1.z - running.z;
  check('standing receiver is aimed at (no lead)', Math.abs(lead0) < 0.25,
    `lead=${lead0.toFixed(2)}`);
  check('running receiver is aimed in front along attack', lead1 > 0.6,
    `lead=${lead1.toFixed(2)} aimZ=${a1.z.toFixed(2)}`);
}

/* ---- chain anticipation is not only 9→10 ---- */
{
  check('9→10 starts 12 and 13', anticipates(12, 9, 10) && anticipates(13, 9, 10),
    `12=${anticipates(12, 9, 10)} 13=${anticipates(13, 9, 10)}`);
  check('10→12 starts 13, not 9', anticipates(13, 10, 12) && !anticipates(9, 10, 12),
    `13=${anticipates(13, 10, 12)} 9=${anticipates(9, 10, 12)}`);
  check('receiver himself is not an anticipator', !anticipates(10, 9, 10),
    `10=${anticipates(10, 9, 10)}`);
}

/* ---- live CPU v CPU: thrower and catcher move, pass is in front ---- */
{
  const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
  d.releaseAll();
  d.kk = undefined;
  for (const p of d.live) {
    const onA = p.team === 'A';
    p.x = (p.num - 8) * 2.2;
    p.z = onA ? -6 - (p.num % 5) : 10 + (p.num % 5);
    p.vx = 0; p.vz = 0; p.down = false; p.bound = false; p.recoverT = 0;
  }
  d.startOpen('A', 0, -4, 9, 1, 0, 1.0);
  const nine = d.L('A', 9);
  nine.x = 0; nine.z = -4;
  if (d.op) { d.op.carrierX = 0; d.op.carrierZ = -4; d.op.originZ = -4; }

  let wasLive = false;
  const throwerSpd: number[] = [];
  const recSpdRel: number[] = [];
  const recSpdMid: number[] = [];
  const leadInFront: number[] = [];
  const alongs: number[] = [];
  let freezeThrower = 0;
  let statueCatch = 0;
  let throws = 0;
  let flightFrames = 0;

  for (let i = 0; i < 90 * 60; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    const s = d.op;
    const live = !!s?.ball.live;
    if (live && s) {
      flightFrames++;
      const thrower = d.L(s.attacking, s.carrierNum);
      const rec = d.L(s.attacking, s.pendingReceiver);
      const tsp = Math.hypot(thrower.vx, thrower.vz);
      const rsp = Math.hypot(rec.vx, rec.vz);
      if (!wasLive) {
        throws++;
        throwerSpd.push(tsp);
        recSpdRel.push(rsp);
        const lead = (s.passTargetZ - rec.z) * s.dir;
        leadInFront.push(lead);
        alongs.push((s.passTargetZ - s.carrierZ) * s.dir);
        if (tsp < 1.2) freezeThrower++;
        if (rsp < 1.5) statueCatch++;
      } else {
        recSpdMid.push(rsp);
      }
    }
    wasLive = live;
    if (d.over) break;
  }

  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const maxAlong = alongs.length ? Math.max(...alongs) : 0;
  const avgLead = avg(leadInFront);
  const avgThrow = avg(throwerSpd);
  const avgRec = avg(recSpdRel);
  const avgRecMid = avg(recSpdMid);

  console.log(`  live: throws=${throws} avgThrowSpd=${avgThrow.toFixed(2)} freeze=${freezeThrower}`
    + ` avgRecSpd=${avgRec.toFixed(2)} statue=${statueCatch} avgLead=${avgLead.toFixed(2)}`
    + ` maxAlong=${maxAlong.toFixed(2)} midRec=${avgRecMid.toFixed(2)} flights=${flightFrames}`);

  check('the match still throws the ball', throws >= 4,
    `throws=${throws}`);
  check('thrower is moving at release (pass on the run)', avgThrow > 2.0 && freezeThrower < throws * 0.4,
    `avg=${avgThrow.toFixed(2)} freeze=${freezeThrower}/${throws}`);
  check('catcher is already running at release', avgRec > 2.4 && statueCatch < throws * 0.35,
    `avg=${avgRec.toFixed(2)} statue=${statueCatch}/${throws}`);
  check('pass is aimed in front of the catcher', avgLead > 0.35,
    `avgLead=${avgLead.toFixed(2)} n=${leadInFront.length}`);
  check('CPU still does not aim massive ground-forwards', maxAlong < 2.0,
    `maxAlong=${maxAlong.toFixed(2)}`);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
