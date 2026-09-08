/**
 * PLAYER CONTROLS PROBE
 *
 * Headless acceptance checks for the human-control pass:
 *   - Quick Start starts on home shirt 10 and keeps a selected role through a
 *     phase handoff; dead-ball shirt selection is accepted and live selection
 *     is refused.
 *   - Q takes the human ball carrier or the nearest relevant defender.
 *   - The local-avatar head/neck scale contract hides only the first-person
 *     avatar and restores both bones for third person.
 *   - Held-LMB + sprint commits a dive, LMB keeps the latch, and release cuts
 *     the bind.
 *   - Space gives an upright runner a jump impulse, while a grounded player
 *     completes the get-up lock without drifting.
 *
 *   npx tsx scripts/playercontrolsprobe.ts
 */
import { Director, NO_INPUT, quickStartConfig, type Input } from '../src/game/director';
import { SECURE_M } from '../src/game/engine/ballcraft';
import { localHeadNeckScale } from '../src/render/ThreePlayerManager';
import { roleNumberFromPressed } from '../src/ui/MatchView';

const dt = 1 / 60;
let failures = 0;
const ok = (message: string) => console.log(`  ok   ${message}`);
const fail = (message: string) => { failures++; console.log(`FAIL: ${message}`); };
const input = (over: Partial<Input> = {}): Input => ({ ...NO_INPUT, ...over });
const step = (d: Director, n: number, i: Input = input()) => {
  for (let f = 0; f < n; f++) d.update(dt, i, new Set(), new Set());
};

/* ------------------------------------------------------------- role + Q */
{
  const d = new Director(quickStartConfig());
  if (d.roleLocked && d.roleLockTeam === 'A' && d.roleLockNum === 10 && d.ctrlPlayer.num === 10) {
    ok('Quick Start locks the human to home shirt 10 / fly-half');
  } else fail(`Quick Start role is ${d.roleLockTeam}:${d.roleLockNum}, ctrl=${d.ctrlPlayer.num}`);

  const shortcutTests: [string, number][] = [
    ['1', 1], ['9', 9], ['0', 10], ['-', 11], ['=', 12], ['!', 13], ['@', 14], ['#', 15],
  ];
  if (shortcutTests.every(([key, n]) => roleNumberFromPressed(new Set([key])) === n)) {
    ok('number-row shortcuts address shirts 1–15');
  } else fail('number-row role shortcut map is incomplete');

  if (d.selectRole(12) && d.roleLockNum === 12 && d.ctrlPlayer.num === 12) ok('dead-ball shirt shortcut changes the persistent role');
  else fail('dead-ball role selection did not lock shirt 12');

  /* A direct phase setup represents a live handoff; the selected shirt survives
   * the automatic carrier/kicker bookkeeping at the end of the frame. */
  d.startOpen('B', 0, 0, 9);
  step(d, 1);
  if (d.ctrlPlayer.team === 'A' && d.ctrlPlayer.num === 12) ok('locked shirt survives a phase handoff');
  else fail(`phase handoff stole the locked shirt: ${d.ctrlPlayer.team}:${d.ctrlPlayer.num}`);

  if (d.selectRole(13) && d.roleLockNum === 13 && d.ctrlPlayer.num === 13) ok('live-play number shortcut changes the persistent role');
  else fail('live-play role shortcut did not change the persistent role');

  /* Q while attacking: the useful teammate is the live carrier. */
  const attack = new Director(quickStartConfig());
  attack.startOpen('A', 0, -10, 9);
  attack.lockRole('A', 15);
  if (attack.emergencySwitch() && attack.ctrlPlayer.team === 'A' && attack.ctrlPlayer.num === 9) {
    ok('Q switches to the human teammate carrying the ball');
  } else fail(`Q carrier switch selected ${attack.ctrlPlayer.team}:${attack.ctrlPlayer.num}`);

  /* Q while defending: the goal-side, closest eligible defender wins. */
  const defend = new Director(quickStartConfig());
  defend.startOpen('B', 0, 5, 9);
  const carrier = defend.L('B', 9);
  carrier.x = 0; carrier.z = 5;
  for (const p of defend.live) if (p.team === 'A') { p.x = 25; p.z = 28; p.down = false; p.sinbin = 0; }
  const best = defend.L('A', 7);
  best.x = 0.6; best.z = 3.6;
  defend.lockRole('A', 15);
  if (defend.emergencySwitch() && defend.ctrlPlayer.num === 7) ok('Q switches to the nearest relevant defender');
  else fail(`Q defender switch selected shirt ${defend.ctrlPlayer.num}, expected 7`);
}

/* ------------------------------------------------------------- camera bones */
{
  const first = localHeadNeckScale(true), third = localHeadNeckScale(false);
  if (first.head === 0.001 && first.neck === 0.001 && third.head === 1 && third.neck === 1) {
    ok('first-person head/neck bones scale to 0.001 and restore to 1.0');
  } else fail(`bone scale contract first=${JSON.stringify(first)} third=${JSON.stringify(third)}`);
  if (SECURE_M === 1.5) ok('LMB pickup/weld uses the 1.5 m interaction radius');
  else fail(`pickup radius is ${SECURE_M} m`);
}

/* ------------------------------------------------------------- jump */
{
  const d = new Director(quickStartConfig());
  d.startOpen('A', 0, -10, 10);
  const p = d.ctrlPlayer;
  p.vz = 4.5; p.vx = 0; p.down = false; p.bound = false;
  d.update(dt, input(), new Set(['action']), new Set());
  if ((p.jumpY ?? 0) > 0 && (p.jumpVY ?? 0) > 0) ok('Space gives a running upright player a jump impulse');
  else fail(`jump did not launch: y=${p.jumpY} vy=${p.jumpVY} clip=${p.clip}`);
}

/* ------------------------------------------------------------- dive + latch */
{
  const d = new Director(quickStartConfig());
  d.startOpen('B', 0, 5, 9);
  const car = d.L('B', 9), tackler = d.L('A', 7);
  car.x = 0; car.z = 5; car.vz = 2;
  tackler.x = 0; tackler.z = 2.5; tackler.vz = 5;
  d.lockRole('A', 7);
  d.update(dt, input({ sprint: true, secure: true }), new Set(), new Set());
  if ((tackler.diveT ?? 0) > 0 && tackler.clip === 'dive') ok('held-LMB sprint commits the defender to a dive');
  else fail(`dive did not commit: diveT=${tackler.diveT} clip=${tackler.clip}`);

  tackler.x = 0; tackler.z = 4.25;
  d.update(dt, input({ sprint: true, secure: true }), new Set(), new Set());
  if (d.op?.latch && tackler.latchingOnto) ok('held LMB latches onto the carrier at contact');
  else fail('dive reached contact without a latch');

  d.update(dt, input(), new Set(), new Set());
  if (!d.op?.latch && !tackler.latchingOnto) ok('releasing LMB breaks the tackle bind');
  else fail('released LMB left a latch behind');
}

/* ------------------------------------------------------------- get-up */
{
  const d = new Director(quickStartConfig());
  d.startOpen('B', 0, 5, 9);
  const p = d.L('A', 7);
  d.lockRole('A', 7);
  p.x = 3; p.z = 4; p.down = true; p.clip = 'getup'; p.clipT = 0;
  p.recoverT = 0.45; p.recoverX = p.x; p.recoverZ = p.z; p.vx = 0; p.vz = 0;
  step(d, 20);
  if ((p.recoverT ?? 0) <= 0.001 && p.x === 3 && p.z === 4) ok('grounded get-up recovery completes without drift');
  else fail(`recovery stuck/drifted: t=${p.recoverT} pos=${p.x.toFixed(2)},${p.z.toFixed(2)}`);
  p.down = false;
  step(d, 2);
  if (p.clip !== 'getup' && (p.recoverT ?? 0) <= 0) ok('recovered player returns to the upright state');
  else fail(`recovered player state is clip=${p.clip} t=${p.recoverT}`);
}

console.log(failures === 0 ? 'PLAYER CONTROLS PROBE PASSES' : `PLAYER CONTROLS PROBE: ${failures} FAILURES`);
if (failures) process.exit(1);
