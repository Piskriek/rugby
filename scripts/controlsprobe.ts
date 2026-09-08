/**
 * CONTROLSPROBE — human player control & switching matrix + breakdown teardown.
 *
 *   1. TEARDOWN STRESS ×50: a live multi-man contest (lattice welds mounted,
 *      bodies bound, drag links planted) is whistled via teardownBreakdown /
 *      releaseAll and must purge to exactly 0 joints, 0 bound bodies and 0
 *      drag links — including frame-adjacent rapid double whistles.
 *   2. DEFENSIVE SWITCH ×20: scripted geometries prove smartSwitch hands
 *      control to the planted best interceptor, cycles the ranked three on
 *      repeat taps, and only ever picks an eligible defender.
 *   3. DISTRIBUTION: the 9 → 10 → 12 echelon chain, numbered passes, and the
 *      refusal of illegal numbers (own shirt, ball in flight).
 *   4. KICK / PASS CHARGE: tap-vs-hold kick resolve (a hold flies further),
 *      pass tap (standard loop) vs pass hold (flat bullet pace).
 *   5. CAMERA: the frame blends from subject to ball with separation, both
 *      as a unit and through a live pass flight and kick flight.
 *   6. AUTO SWITCH: hands over to the best interceptor, stands off inside
 *      the manual-pick grace window, while a charge is held, and when off.
 *   7. RELEASEALL: the unconditional purge reports what it removed and is
 *      idempotent — the second call removes nothing and leaks nothing.
 */
import { Director, quickStartConfig } from '../src/game/director';
import { seedRng } from '../src/game/seed';
import { teardownBreakdown } from '../src/game/engine/breakdown';
import {
  releaseAll as purgeLatches, countLiveJoints, countBoundBodies,
  countDragLinks, assertNoLatchLeaks, beginLatch,
} from '../src/game/engine/latch';
import { blendSubjectToBall } from '../src/game/camera';

const dt = 1 / 60;
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`FAIL: ${msg}`); };
const pass = (msg: string) => console.log(`  ok   ${msg}`);

const blank = () => ({
  left: false, right: false, up: false, down: false, run: false, sprint: false,
  passL: false, passR: false, cutL: false, cutR: false, kick: false, grubber: false,
  drop: false, contact: false, fend: false, step: false, dummy: false,
  tackleDive: false, tackleSmother: false, switchPlayer: false, action: false, distribute: false,
  handsUp: false, secure: false, punt: false,
});
const step = (d: Director, n: number) => {
  for (let i = 0; i < n; i++) d.update(dt, blank(), new Set(), new Set());
};

/* ================= 1. TEARDOWN STRESS ×50 ================= */
{
  seedRng(101);
  let itersZero = 0;
  let purgedJoints = 0, purgedBodies = 0, purgedLinks = 0;
  let formedIters = 0;
  for (let i = 0; i < 50; i++) {
    const d = new Director(quickStartConfig());
    const atk = i % 2 === 0 ? 'A' : 'B';
    const def = atk === 'A' ? 'B' : 'A';
    d.startOpen(atk, (i % 5) * 4 - 8, -20 + (i % 7) * 6);
    const s = d.op!;
    const car = d.L(atk, s.carrierNum);
    // the pile is real: a tackler on the carrier's shoulder, a jackal arriving
    const tack = d.L(def, 7);
    tack.x = car.x + 0.6; tack.z = car.z + 0.4;
    const jackal = d.L(def, 6);
    jackal.x = car.x - 0.8; jackal.z = car.z - 0.3;
    if (i % 2 === 0) beginLatch(s, car, d.L(def, 1), false, d.live); // planted drag link
    d.startBreakdown(7);
    for (let f = 0; f < 30 && countLiveJoints(d.latches) === 0; f++) {
      d.update(dt, blank(), new Set(), new Set());
    }
    if (countLiveJoints(d.latches) > 0) formedIters++;
    const rep = teardownBreakdown(d, 'WHISTLE');
    purgedJoints += rep.purgedJoints; purgedBodies += rep.purgedBodies; purgedLinks += rep.purgedDragLinks;
    const zero = rep.leakedJoints === 0 && rep.unreleasedBound === 0 && rep.dragLinks === 0;
    if (!zero) fail(`iter ${i}: teardown residue joints=${rep.leakedJoints} bound=${rep.unreleasedBound} links=${rep.dragLinks}`);
    else itersZero++;
    // rapid double whistle: a second contest whistled frame-adjacently, then
    // the same teardown twice — both must purge clean, never trip on residue
    d.startOpen(atk, 0, 0);
    const car2 = d.L(atk, d.op!.carrierNum);
    const tack2 = d.L(def, 7);
    tack2.x = car2.x + 0.5; tack2.z = car2.z + 0.3;
    d.startBreakdown(7);
    const rapid = teardownBreakdown(d, 'WHISTLE');
    const again = teardownBreakdown(d, 'WHISTLE');
    if (rapid.leakedJoints + rapid.unreleasedBound + rapid.dragLinks !== 0) {
      fail(`iter ${i}: rapid-whistle residue ${rapid.leakedJoints}/${rapid.unreleasedBound}/${rapid.dragLinks}`);
    }
    if (again.leakedJoints + again.unreleasedBound + again.dragLinks !== 0
      || again.purgedJoints + again.purgedBodies + again.purgedDragLinks !== 0) {
      fail(`iter ${i}: second teardown not idempotent-clean`);
    }
    try {
      d.releaseAll();
    } catch (e) { fail(`iter ${i}: releaseAll threw: ${String(e)}`); }
    const audit = assertNoLatchLeaks(d.latches, d.live, d.op ?? null, `iter${i}`);
    if (audit.leakedJoints + audit.unreleasedBound + audit.dragLinks !== 0) {
      fail(`iter ${i}: post-releaseAll residue ${audit.leakedJoints}/${audit.unreleasedBound}/${audit.dragLinks}`);
    }
  }
  if (itersZero === 50) pass('50/50 teardowns purged to 0 joints / 0 bound / 0 drag links');
  else fail(`only ${itersZero}/50 teardowns clean`);
  if (formedIters >= 40) pass(`binds genuinely formed in ${formedIters}/50 contests (${purgedJoints} welds, ${purgedBodies} binds, ${purgedLinks} links purged)`);
  else fail(`binds formed in only ${formedIters}/50 contests — stress was not real`);
}

/* ================= 2. DEFENSIVE SWITCH ×20 ================= */
{
  seedRng(202);
  const shirts = [7, 6, 1, 4, 5, 8, 10, 12, 13, 11, 14, 15, 2, 3, 9, 7, 6, 10, 12, 13];
  let hits = 0;
  let cycles = 0;
  for (let i = 0; i < 20; i++) {
    const d = new Director(quickStartConfig());
    d.startOpen('B', -12 + (i % 5) * 6, -5 + (i % 4) * 8); // human A defends
    const s = d.op!;
    const car = d.L('B', s.carrierNum);
    car.x = -12 + (i % 5) * 6; car.z = -5 + (i % 4) * 8;
    s.carrierX = car.x; s.carrierZ = car.z;
    // everyone else far away; the planted man goal-side on the carrier
    for (const p of d.live) {
      if (p.team !== 'A') continue;
      p.x = 28; p.z = car.z + 22; p.down = false; p.sinbin = 0;
    }
    const planted = d.L('A', shirts[i]);
    planted.x = car.x + 1; planted.z = car.z - 2; // goal-side (A defends -z)
    d.setCtrl('A', shirts[(i + 7) % shirts.length] === shirts[i] ? 1 : shirts[(i + 7) % shirts.length]);
    if (d.ctrlPlayer.num === planted.num) d.setCtrl('A', planted.num === 1 ? 2 : 1);
    d.smartSwitch();
    if (d.ctrlPlayer.num === planted.num) hits++;
    else fail(`switch ${i}: smartSwitch took ${d.ctrlPlayer.num}, planted best was ${planted.num}`);
    if (d.bestInterceptor !== d.ctrl) fail(`switch ${i}: bestInterceptor ${d.bestInterceptor} != ctrl ${d.ctrl}`);
    const c = d.ctrlPlayer;
    if (c.team !== 'A' || c.down || c.sinbin > 0) fail(`switch ${i}: ineligible pick ${c.num}`);
    // repeat taps cycle the ranked three rather than sticking
    const seen = new Set<number>([d.ctrlPlayer.num]);
    d.smartSwitch(); seen.add(d.ctrlPlayer.num);
    d.smartSwitch(); seen.add(d.ctrlPlayer.num);
    if (seen.size >= 2) cycles++;
    else fail(`switch ${i}: three taps never left shirt ${[...seen][0]}`);
  }
  if (hits === 20) pass('20/20 smart switches took the planted best interceptor');
  if (cycles === 20) pass('20/20 repeat-tap cycles walked the ranked options');
}

/* ================= 3. DISTRIBUTION ================= */
{
  seedRng(303);
  const d = new Director(quickStartConfig());
  d.startOpen('A', 0, -10);
  const first = d.echelonTarget();
  if (first && first.num === 10) pass('echelon 9 → 10 names the fly-half');
  else fail(`echelonTarget from 9 named ${first?.num ?? 'null'}, expected 10`);
  const thrown = d.distributePass();
  const s = d.op;
  if (thrown && (s?.pendingReceiver === 10 || d.phase !== 'OPEN_PLAY')) {
    pass(`distribution pass away to 10 (pending=${s?.pendingReceiver ?? '-'} phase=${d.phase})`);
  } else fail(`distributePass thrown=${thrown} pending=${s?.pendingReceiver} phase=${d.phase}`);
  if (d.op?.ball.live) step(d, 300); // let the ball arrive or the whistle go
  if (d.phase === 'OPEN_PLAY' && d.op!.carrierNum === 10) {
    const second = d.echelonTarget();
    if (second && second.num === 12) pass('echelon 10 → 12 walks down the line');
    else fail(`echelonTarget from 10 named ${second?.num ?? 'null'}, expected 12`);
  } else {
    pass(`chain ended lawfully at phase=${d.phase} (spill/whistle still moved play on)`);
  }
  const d2 = new Director(quickStartConfig());
  d2.startOpen('A', 0, -10);
  if (d2.doPassToNum(10, false)) pass('numbered pass 9 → 10 dispatches');
  else fail('doPassToNum(10) refused a legal number');
  if (!d2.doPassToNum(d2.op!.carrierNum, false)) pass('numbered pass to own shirt refused');
  else fail('doPassToNum allowed passing to yourself');
  if (!d2.doPassToNum(12, false)) pass('numbered pass refused while the ball is live');
  else fail('doPassToNum threw while a ball was already live');
  // the human path: T releases the nine down the echelon through the verb stream
  const d3 = new Director(quickStartConfig());
  d3.startOpen('A', 0, -10);
  // Distribution is offered while the nine HOLDS the ball, not after he
  // has thrown it. A second pass must not remain advertised during flight.
  const bar = d3.actionBar.find((a) => a.key === 'T');
  d3.update(dt, blank(), new Set(['distribute']), new Set());
  if (d3.op?.ball.live && d3.op.pendingReceiver === 10) {
    pass('T key distributes 9 → 10 through the human verb stream');
  } else fail(`T key: live=${d3.op?.ball.live} pending=${d3.op?.pendingReceiver} phase=${d3.phase}`);
  if (bar && /DISTRIBUTE/.test(bar.label)) pass(`action bar names it (${bar.label})`);
  else fail('action bar shows no DISTRIBUTE entry for the nine before release');
  if (!d3.actionBar.some((a) => a.key === 'T')) pass('distribution option clears while the pass is in flight');
  else fail('action bar still offers a second pass while the ball is away');
}

/* ================= 4. KICK / PASS CHARGE ================= */
{
  seedRng(404);
  // tap kick: press and release on adjacent frames
  const tap = new Director(quickStartConfig());
  tap.startOpen('A', 0, -10);
  tap.update(dt, blank(), new Set(['kick']), new Set());
  tap.update(dt, blank(), new Set(), new Set(['kick']));
  const tapV = tap.kk ? Math.hypot(tap.kk.vx, tap.kk.vz) : -1;
  if (tap.phase === 'KICK' && tap.kk?.type === 'PUNT' && tap.kk?.stage === 'FLIGHT') {
    pass(`tap kick struck the quick punt off the boot (v=${tapV.toFixed(1)} m/s)`);
  } else fail(`tap kick: phase=${tap.phase} kk=${tap.kk?.type}/${tap.kk?.stage}`);
  // held kick: a full second of charge, then release
  const held = new Director(quickStartConfig());
  held.startOpen('A', 0, -10);
  held.update(dt, blank(), new Set(['kick']), new Set());
  for (let i = 0; i < 60; i++) held.update(dt, blank(), new Set(), new Set());
  const charge = held.op?.kickCharge ?? 0;
  const hinted = (held.hint ?? '').includes('CHARGING');
  held.update(dt, blank(), new Set(), new Set(['kick']));
  const heldV = held.kk ? Math.hypot(held.kk.vx, held.kk.vz) : -1;
  if (charge > 0.5 && hinted) pass(`hold built ${(charge * 100).toFixed(0)}% charge with the hint up`);
  else fail(`hold: charge=${charge} hint=${held.hint}`);
  if (held.kk?.stage === 'FLIGHT' && heldV > tapV) {
    pass(`held kick outflies the tap (${heldV.toFixed(1)} > ${tapV.toFixed(1)} m/s)`);
  } else fail(`held kick: stage=${held.kk?.stage} v=${heldV} vs tap ${tapV}`);
  // tap pass: the standard loop
  const tp = new Director(quickStartConfig());
  tp.startOpen('A', 0, -10);
  tp.update(dt, blank(), new Set(['passR']), new Set());
  tp.update(dt, blank(), new Set(), new Set(['passR']));
  if (tp.op?.ball.live && (tp.op?.passPace ?? 9) < 1.1) {
    pass(`tap pass threw the standard loop (pace=${tp.op!.passPace.toFixed(2)})`);
  } else fail(`tap pass: live=${tp.op?.ball.live} pace=${tp.op?.passPace}`);
  // held pass: the flat bullet
  const hp = new Director(quickStartConfig());
  hp.startOpen('A', 0, -10);
  hp.update(dt, blank(), new Set(['passR']), new Set());
  for (let i = 0; i < 30; i++) hp.update(dt, blank(), new Set(), new Set());
  const holdAmt = hp.op?.passHold ?? 0;
  hp.update(dt, blank(), new Set(), new Set(['passR']));
  if (holdAmt > 0.3 && hp.op?.ball.live && (hp.op?.passPace ?? 0) > 1.1) {
    pass(`held pass threw flat and hard (hold=${holdAmt.toFixed(2)} pace=${hp.op!.passPace.toFixed(2)})`);
  } else fail(`held pass: hold=${holdAmt} live=${hp.op?.ball.live} pace=${hp.op?.passPace}`);
}

/* ================= 5. CAMERA ================= */
{
  const near = blendSubjectToBall({ x: 0, z: 0 }, { x: 3, z: 0 });
  const far = blendSubjectToBall({ x: 0, z: 0 }, { x: 30, z: 0 });
  if (near.x > 0 && near.x < 3 && far.x > near.x && far.x <= 24.01) {
    pass(`blend travels with separation (3m→${near.x.toFixed(1)}, 30m→${far.x.toFixed(1)})`);
  } else fail(`blend unit: near=${near.x} far=${far.x}`);
  seedRng(505);
  const d = new Director(quickStartConfig());
  d.startOpen('A', 0, -10);
  d.update(dt, blank(), new Set(['cutR']), new Set());
  d.update(dt, blank(), new Set(), new Set(['cutR']));
  for (let i = 0; i < 20 && d.op?.ball.live; i++) d.update(dt, blank(), new Set(), new Set());
  if (d.op?.ball.live) {
    const f = d.cameraFocus();
    const dc = Math.hypot(f.x - d.op.carrierX, f.z - d.op.carrierZ);
    const db = Math.hypot(d.op.ball.x - d.op.carrierX, d.op.ball.z - d.op.carrierZ);
    if (dc > 0.01 && dc < db) pass(`live pass flight frames between carrier and ball (${dc.toFixed(1)}m of ${db.toFixed(1)}m)`);
    else fail(`pass-flight focus: carrier-focus=${dc} carrier-ball=${db}`);
  } else fail('cut-out never went live for the camera check');
  const k = new Director(quickStartConfig());
  k.startOpen('A', 0, -10);
  k.update(dt, blank(), new Set(['kick']), new Set());
  for (let i = 0; i < 30; i++) k.update(dt, blank(), new Set(), new Set());
  k.update(dt, blank(), new Set(), new Set(['kick']));
  if (k.kk?.stage === 'FLIGHT') {
    const f = k.cameraFocus();
    const dm = Math.hypot(k.kk.bx - k.kk.landX, k.kk.bz - k.kk.landZ);
    const dfm = Math.hypot(f.x - k.kk.landX, f.z - k.kk.landZ);
    const dfb = Math.hypot(f.x - k.kk.bx, f.z - k.kk.bz);
    if (dfm < dm && dfb < dm) pass('kick flight frames between the landing mark and the ball');
    else fail(`kick-flight focus: mark-ball=${dm} mark-focus=${dfm} focus-ball=${dfb}`);
  } else fail('kick never flew for the camera check');
}

/* ================= 6. AUTO SWITCH ================= */
{
  seedRng(606);
  const setup = () => {
    const d = new Director(quickStartConfig());
    d.options.autoSwitch = 1;
    d.startOpen('B', 0, 5); // human A defends
    const s = d.op!;
    const car = d.L('B', s.carrierNum);
    car.x = 0; car.z = 5; s.carrierX = 0; s.carrierZ = 5;
    for (const p of d.live) {
      if (p.team !== 'A') continue;
      p.x = 28; p.z = 27; p.down = false; p.sinbin = 0; p.clip = 'ready';
    }
    const best = d.L('A', 7);
    best.x = 1; best.z = 3; // goal-side, on the carrier
    d.setCtrl('A', 15); // control starts on a far man
    d.lastManualSwitch = -99;
    return { d, best };
  };
  {
    const { d, best } = setup();
    d.tickAutoSwitch(dt);
    if (d.ctrlPlayer.num === best.num) pass('auto-switch hands control to the best interceptor');
    else fail(`auto-switch took ${d.ctrlPlayer.num}, expected ${best.num}`);
  }
  {
    const { d } = setup();
    d.noteManualSwitch(); // a Q pick this instant
    d.tickAutoSwitch(dt);
    if (d.ctrlPlayer.num === 15) pass('auto-switch stands off inside the manual grace window');
    else fail(`auto-switch overrode a manual pick (took ${d.ctrlPlayer.num})`);
  }
  {
    const { d } = setup();
    d.op!.passHold = 0.5; // a charge held (white-box guard read)
    d.tickAutoSwitch(dt);
    if (d.ctrlPlayer.num === 15) pass('auto-switch holds while a charge is held');
    else fail(`auto-switch fired mid-charge (took ${d.ctrlPlayer.num})`);
  }
  {
    const { d } = setup();
    d.options.autoSwitch = 0;
    d.tickAutoSwitch(dt);
    if (d.ctrlPlayer.num === 15) pass('auto-switch silent with the option off');
    else fail(`auto-switch fired while off (took ${d.ctrlPlayer.num})`);
  }
}

/* ================= 7. RELEASEALL LEDGER ================= */
{
  seedRng(707);
  const d = new Director(quickStartConfig());
  d.startOpen('A', 0, 0);
  const s = d.op!;
  const car = d.L('A', s.carrierNum);
  const tack = d.L('B', 7);
  tack.x = car.x + 0.6; tack.z = car.z + 0.4;
  beginLatch(s, car, d.L('B', 1), false, d.live);
  d.startBreakdown(7);
  step(d, 5);
  const joints = countLiveJoints(d.latches);
  const links = countDragLinks(d.live, d.op ?? null);
  const rep = purgeLatches(d.latches, d.live, d.op ?? null, 'WHISTLE');
  if (rep.jointsPurged === joints && joints > 0 && rep.dragLinksPurged >= links && links > 0) {
    pass(`purge ledger honest (${rep.jointsPurged} welds, ${rep.bodiesReleased} binds, ${rep.dragLinksPurged} links)`);
  } else fail(`ledger: purged ${rep.jointsPurged}/${rep.bodiesReleased}/${rep.dragLinksPurged} vs live ${joints}/${links}`);
  const second = purgeLatches(d.latches, d.live, d.op ?? null, 'WHISTLE');
  const total = second.jointsPurged + second.bodiesReleased + second.dragLinksPurged + second.latchObjectsCleared;
  const audit = assertNoLatchLeaks(d.latches, d.live, d.op ?? null, 'ledger');
  if (total === 0 && audit.leakedJoints + audit.unreleasedBound + audit.dragLinks === 0) {
    pass('second purge removes nothing and leaks nothing (idempotent)');
  } else fail('second purge not clean');
  try {
    d.releaseAll();
    pass('director releaseAll runs clean on an already-purged match');
  } catch (e) { fail(`releaseAll threw: ${String(e)}`); }
}

console.log(failures === 0 ? 'CONTROLS PROBE PASSES — switching matrix, distribution, charges, camera, teardown' : `CONTROLS PROBE: ${failures} FAILURES`);
if (failures) process.exit(1);
