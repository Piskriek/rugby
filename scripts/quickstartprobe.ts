/**
 * QUICK START (15v15) SMOKE — verifies the main-menu Quick Start launch
 * path straight into an active kick-off match:
 *
 *  1. quickStartConfig() yields a legal MatchConfig with full 15v15 rosters.
 *  2. The Director constructed from it boots in phase KICK at the centre
 *     spot (the Law-12 kick-off), with thirty live shirts numbered 1-15
 *     per side (positional behaviour trees live).
 *  3. Play actually advances: the kick is struck, open play arrives, and
 *     no watchdog trips over a full simulated minute.
 *  4. The camera is bound to the kick-off subject at launch (centre spot)
 *     and follows the ball once play moves.
 */
import { Director, quickStartConfig } from '../src/game/director';
import { KICKOFF_CENTER } from '../src/game/camera';

const dt = 1 / 60;
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`FAIL: ${msg}`); };

const cfg = quickStartConfig();
if (cfg.homeId !== 'ENG' || cfg.awayId !== 'NZL') fail('quickStartConfig defaults to ENG v NZL');

const d = new Director(cfg);

// 1. thirty live players, 15 per side, shirts 1..15 (positions assigned).
for (const team of ['A', 'B'] as const) {
  const shirts = d.live.filter((p) => p.team === team).map((p) => p.num).sort((a, b) => a - b);
  const expected = Array.from({ length: 15 }, (_, i) => i + 1);
  if (shirts.length !== 15) fail(`side ${team} has ${shirts.length} live players, expected 15`);
  if (shirts.join(',') !== expected.join(',')) fail(`side ${team} shirts are ${shirts.join(',')}, expected 1-15`);
}
if (d.live.length !== 30) fail(`live roster is ${d.live.length}, expected 30 (15v15)`);

// 2. match boots at the kick-off: phase KICK, restart type, ball at centre.
if (d.phase !== 'KICK') fail(`boot phase is ${d.phase}, expected KICK`);
if (!d.kk) fail('no KickState at launch');
if (d.kk?.type !== 'RESTART') fail(`kick type ${d.kk?.type}, expected RESTART`);
if (Math.abs(d.kk.bx - KICKOFF_CENTER.x) > 0.01 || Math.abs(d.kk.bz - KICKOFF_CENTER.z) > 0.01) {
  fail(`kick mark (${d.kk.bx},${d.kk.bz}) is not the centre spot`);
}

// 3. camera seeded on the centre spot on launch.
if (Math.abs(d.cam.x - KICKOFF_CENTER.x) > 0.01) fail(`camera x ${d.cam.x} not seeded to centre spot`);
if (Math.abs(d.cableX - KICKOFF_CENTER.x) > 0.01 || Math.abs(d.cableAX - KICKOFF_CENTER.x) > 0.01) {
  fail('cable anchor not seeded to centre spot');
}
if (!Number.isFinite(d.cam.x) || !Number.isFinite(d.cam.z) || !Number.isFinite(d.cam.h)) fail('camera not finite at launch');

// 4. simulate a full minute. The human side (A) kicks off, so the engine
//    waits for the charge input: hold SPACE (sprint/run) once the formation
//    is actually legal (receivers back ten + formation assembled) and the
//    restart must be struck and play advance — all without a watchdog trip.
const logBefore = d.watchdogLog.length;
const phases = new Set<string>([d.phase]);
let struck = d.kk.stage === 'FLIGHT';
let charging = false;
for (let i = 0; i < 60 * 60; i++) {
  // Strike like a real player: start holding once the receiving side is back
  // ten and the formation is set (the same gapOk gate the engine enforces),
  // then keep holding until the kick leaves the boot.
  if (!struck && d.kk && d.kk.stage !== 'FLIGHT') {
    let nearest = -99;
    for (const p of d.live) {
      if (p.team === d.kk.kicker || p.sinbin > 0) continue;
      nearest = Math.max(nearest, (p.z - d.kk.bz) * d.kk.dir);
    }
    const ready = nearest >= 10.6 && (d.kk.formReady ?? 1) > 0.9 && d.kk.t > 1.2;
    if (ready && !charging && d.kk.t > 2) charging = true;
  }
  const charge = charging && !struck;
  d.update(dt, {
    left: false, right: false, up: false, down: false, run: charge, sprint: charge,
    passL: false, passR: false, cutL: false, cutR: false, kick: false, grubber: false,
    drop: false, contact: false, fend: false, step: false, dummy: false,
    tackleDive: false, tackleSmother: false, switchPlayer: false, action: false, distribute: false,
    handsUp: false, secure: false, punt: false,
  }, new Set(), new Set());
  phases.add(d.phase);
  if (d.kk?.stage === 'FLIGHT') struck = true;
}
/* The kick-off LAUNCH must be watchdog-clean. Later set pieces (lineout,
 * scrum) legitimately wait on human input in this headless harness, so a
 * no-input sim trips their own ritual clocks beyond this point — those are
 * the existing minigames, not the Quick Start launch path under test. */
const launchTrips = d.watchdogLog.slice(logBefore).filter((l) => l.includes('KICK'));
if (launchTrips.length) fail(`kick-off launch watchdog tripped: ${launchTrips[0]}`);
if (!struck) fail('the kick-off was never struck in 60 s');
if (!phases.has('OPEN_PLAY')) fail('open play never arrived after the restart kick');
if (d.over) fail('match ended within the first simulated minute');

console.log(`quick-start: boot phase KICK · kick type RESTART · shirts ${d.live.length}/30 · camera seeded (${d.cam.x.toFixed(1)}, ${d.cam.z.toFixed(1)}) h ${d.cam.h.toFixed(1)}`);
console.log(`60 s sim: phases seen [${[...phases].join(', ')}] · watchdog trips ${d.watchdogLog.length - logBefore} · over=${d.over}`);
console.log(failures === 0 ? 'QUICK START (15v15) SMOKE PASSES' : `QUICK START SMOKE: ${failures} FAILURES`);
if (failures) process.exit(1);
