/**
 * CPU forward passing + attacking-line composure.
 *
 * Usage: npx vite-node scripts/fwdpass.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';
import { passOptions } from '../src/game/intelligence';
import { clampAimLegal, passReleaseRel, PASS_SPEED } from '../src/game/engine/throwforward';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(68)} ${detail}`);
}

/* ---- clamp: an 8 m straight-ahead dump must flatten, not fly leftover ---- */
{
  const from = { x: 0, z: 0 };
  const aim = { x: 0.4, z: 8, dist: 8, flight: 8 / PASS_SPEED };
  const clamped = clampAimLegal(from, aim, 0, 1, 1.5);
  const along = clamped.z - from.z;
  const rel = passReleaseRel(from, clamped, 0, 1);
  check('clamp flattens an 8 m standing dump (no 4 m leftover)', along < 1.2,
    `along=${along.toFixed(2)} m rel=${rel.toFixed(2)}`);
  check('clamp of an 8 m dump is legal under LENIENT', rel <= 1.5,
    `rel=${rel.toFixed(2)} along=${along.toFixed(2)}`);
}

/* ---- CPU passOptions refuses a man clearly in front ---- */
{
  const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
  d.releaseAll();
  d.kk = undefined;
  for (const p of d.live) {
    p.x = (p.num - 8) * 2.4;
    p.z = p.team === 'A' ? -4 : 12;
    p.vx = 0; p.vz = 0; p.down = false; p.bound = false; p.recoverT = 0;
  }
  const car = d.L('A', 9);
  car.x = 0; car.z = 0; car.vz = 2;
  const twelve = d.L('A', 12);
  twelve.x = 8; twelve.z = 4; twelve.vz = 2;   // 4 m in front
  const ten = d.L('A', 10);
  ten.x = -6; ten.z = -3; ten.vz = 1;          // behind
  const opts = passOptions(car, d.live, 1, false, 0, {
    enabled: true, attackDirection: 1,
  });
  const nums = opts.map((o) => o.player.num);
  check('CPU passOptions skips a man 4 m in front of the thrower', !nums.includes(12),
    `opts=${nums.join(',') || 'none'}`);
  check('CPU passOptions still offers a man behind the thrower', nums.length > 0,
    `opts=${nums.join(',') || 'none'}`);
}

/* ---- live CPU vs CPU: no massive flying forwards, knock-ons stay knock-ons ---- */
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
  let throwerZ = 0;
  let throwerDir = 1;
  let throwerTeam: 'A' | 'B' = 'A';
  const alongs: number[] = [];
  const recAlongs: number[] = [];
  let massive = 0;
  let recInFront = 0;
  let catchPastAim = 0;
  let flightFrames = 0;
  let chasePasser = 0;
  const toAims: number[] = [];
  let knockOn = 0;
  let fwdPass = 0;
  const seenFeed = new Set<string>();

  for (let i = 0; i < 90 * 60; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    for (const ev of d.feed) {
      const k = `${ev.at}|${ev.text}`;
      if (seenFeed.has(k)) continue;
      seenFeed.add(k);
      const text = ev.text.toUpperCase();
      if (text.includes('KNOCK ON') || text.includes('KNOCK-ON')) knockOn++;
      if (text.includes('FORWARD PASS')) fwdPass++;
    }
    const s = d.op;
    const live = !!s?.ball.live;
    if (live && !wasLive && s) {
      throwerZ = s.carrierZ;
      throwerDir = s.dir;
      throwerTeam = s.attacking;
      const along = (s.passTargetZ - s.carrierZ) * s.dir;
      alongs.push(along);
      if (along > 2.5) massive++;
      const rec = d.L(s.attacking, s.pendingReceiver);
      if ((rec.z - s.carrierZ) * s.dir > 1.5) recInFront++;
    }
    if (live && s) {
      flightFrames++;
      for (const p of d.live) {
        if (p.team !== s.attacking || p.num === s.carrierNum || p.num === s.pendingReceiver) continue;
        if (![10, 12, 13].includes(p.num)) continue;
        toAims.push(Math.hypot(p.tx - s.passTargetX, p.tz - s.passTargetZ));
      }
    }
    if (!live && wasLive && s) {
      const rec = d.L(throwerTeam, s.carrierNum);
      if ((rec.z - throwerZ) * throwerDir > 2.5) catchPastAim++;
    }
    wasLive = live;
    if (d.over) break;
  }

  const maxAlong = alongs.length ? Math.max(...alongs) : 0;
  const law = d.passLawIntegrity;
  const aimSorted = [...toAims].sort((a, b) => a - b);
  const aimP90 = aimSorted.length ? aimSorted[Math.min(aimSorted.length - 1, Math.floor(aimSorted.length * 0.9))] : 0;
  console.log(`  live: releases=${law.releases} alongs=${alongs.length} maxAlong=${maxAlong.toFixed(2)} massive>2.5m=${massive} recInFront=${recInFront} catchPast=${catchPastAim} aimP90=${aimP90.toFixed(1)} nMarks=${toAims.length} knockOn=${knockOn} fwdPass=${fwdPass} clamped=${law.clamped} whistles=${law.whistles} rejected=${law.candidatesRejected}`);

  check('CPU does not aim massive ground-forwards (>2.5 m)', massive === 0 && maxAlong < 2.0,
    `massive=${massive} maxAlong=${maxAlong.toFixed(2)} n=${alongs.length}`);
  check('CPU does not throw to a man clearly in front (>1.5 m)', recInFront === 0,
    `recInFront=${recInFront}`);
  check('catches do not land 2.5 m in front of the thrower', catchPastAim === 0,
    `catchPastAim=${catchPastAim}`);
  check('attacking marks sit on the catch, not frozen on the passer',
    toAims.length === 0 || aimP90 < 28,
    `aimP90=${aimP90.toFixed(1)} m samples=${toAims.length} flights=${flightFrames}`);
  check('a spilled pass is a knock-on, not a coin-flip forward',
    fwdPass === 0 || law.whistles >= fwdPass,
    `fwdPass=${fwdPass} lawWhistles=${law.whistles} knockOn=${knockOn}`);
  check('the match still throws the ball (passing game alive)', alongs.length >= 4,
    `throws=${alongs.length} releases=${law.releases}`);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
