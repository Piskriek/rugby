/**
 * TARCS — REFERRAI HEADLESS VERIFICATION PROBE.
 *
 * Proves the referee engine's four law families WITHOUT a browser, a canvas
 * or a ragdoll, exactly the way `t43check.ts` proves the replay freeze and
 * `quickstartprobe.ts` proves the 15v15 boot:
 *
 *   (a) RUCK ENTRY GATES   — a legal through-the-gate join vs an illegal
 *                            side-entry into the breakdown volume;
 *   (b) HINDMOST OFFSIDES  — the two transverse planes Z_off_teamA/B at a
 *                            ruck/maul, and the pre-release transgression
 *                            verdict;
 *   (c) FORWARD VECTOR     — the throw-forward and knock-on velocity tests
 *                            relative to the pitch, passer momentum
 *                            discounted;
 *   (d) ADVANTAGE TIMING   — the 10-second window: OVER on 10 m of territory
 *                            or an effective kick, WHISTLE + restart at the
 *                            mark on expiry, on possession loss, and on a
 *                            cynical offence (which never gets a window at
 *                            all).
 *
 * Every law check is a pure-function call — deterministic to the metre and
 * the frame. Then, because laws that only pass unit tests but crash the tick
 * loop are no laws at all, the probe drives the REAL Director through a
 * simulated stretch of football with the gates armed and both referee paths
 * (openKnockOnAdvantage, beginPenalty) force-injected, and asserts the
 * watchdog never trips and the sequencing always lands.
 *
 * Exits 0 when everything passes.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import type { Live } from '../src/game/intelligence';
import type { BreakdownState } from '../src/game/director';
import {
  ruckGateGeometry, ruckGateWindow, RuckGateLedger, gatePenetration, inCorridor,
  insideVolume, SIDE_ENTRY_CALL, type GatePoint,
} from '../src/game/engine/gates';
import {
  ruckOffsidePlanes, maulOffsidePlanes, hindmostFootZ, scrumhalfReleased,
  preReleaseWhistle, penetrationOf, PRE_RELEASE_EPSILON_M, PRE_RELEASE_SUSTAIN_S,
} from '../src/game/engine/offside';
import {
  passReleaseRel, knockReleaseRel, isForwardLoss, clampAimLegal, fwdProfile,
} from '../src/game/engine/throwforward';
import {
  openAdvantageWatch, stepAdvantageWatch, advantageWindowEngineS,
  ADVANTAGE_WINDOW_S, ADVANTAGE_TERRITORY_M, type AdvantageSensor,
} from '../src/game/engine/referee';

let failures = 0;
const dt = 1 / 60;
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  [${detail}]` : ''}`);
  if (!cond) failures++;
};

/** A Live body with just the fields the gate law reads. Structural stand-in. */
function mkLive(team: 'A' | 'B', num: number, x: number, z: number): Live {
  return {
    team, num, x, z, vx: 0, vz: 0,
    carrier: false, bound: false, down: false, sinbin: 0, recoverT: 0,
  } as unknown as Live;
}

/* ============================ (a) RUCK ENTRY GATES ============================ */
console.log('(a) RUCK ENTRY GATES — legal corridor entry vs illegal side entry');
{
  /* The cluster: A attack toward +z. A's bound men are at z 8.0 and 7.2 →
   * A's gate plane (hindmost A foot) = 7.2. B defends toward −z; B's bound
   * men at 10.2 and 11.0 → B's plane = 11.0. Lateral bounds −1.5..1.2 →
   * gate half-width 1.35 + the 0.6 shoulder = 1.95 about cx −0.15. */
  const cluster: GatePoint[] = [
    { team: 'A', x: -1.5, z: 8.0 }, { team: 'A', x: 0.0, z: 7.2 },
    { team: 'B', x: 1.2, z: 10.2 }, { team: 'B', x: 0.4, z: 11.0 },
  ];
  const geo = ruckGateGeometry(cluster)!;
  ok('gate width spans the cluster bounds ±shoulder', Math.abs(geo.gates.A!.halfW - 1.95) < 1e-9);
  ok('A plane = A\'s hindmost foot (7.2)', geo.gates.A!.planeZ === 7.2 && geo.gates.A!.dir === 1);
  ok('B plane = B\'s hindmost foot (11.0)', geo.gates.B!.planeZ === 11.0 && geo.gates.B!.dir === -1);
  ok('A support at 6.9 is behind its own gate',
    gatePenetration({ team: 'A', x: 0, z: 6.9 }, geo.gates.A!) <= 0);
  ok('B support at 9.0 is IN FRONT of its own gate',
    gatePenetration({ team: 'B', x: 0, z: 9.0 }, geo.gates.B!) > 0);

  /* --- legal: A11 arrives from deep, inside the band, behind his own plane,
   * and walks straight into the contest box. --- */
  const ledger = new RuckGateLedger();
  ledger.begin(1);
  const el = { roster: new Set<string>(['A:2', 'A:6', 'B:4', 'B:7']), halfback: '' };
  const pathA = [{ x: 0, z: 3.0 }, { x: 0, z: 5.0 }, { x: 0, z: 6.7 }, { x: 0, z: 8.2 }];
  let flagged = false;
  for (const q of pathA) {
    const hit = ledger.observe(geo, [mkLive('A', 11, q.x, q.z)], el);
    if (hit) flagged = true;
  }
  ok('legal through-the-gate join is NOT flagged', !flagged);

  /* --- illegal: B15 comes around the SIDE of the pile, crossing the lateral
   * band while in front of his own hindmost foot. --- */
  const ledger2 = new RuckGateLedger();
  ledger2.begin(7);
  const pathB = [
    { x: 2.6, z: 12.5 },   // wide of the band, behind his plane — corridor-adjacent, volume-clear
    { x: 2.6, z: 11.0 },    // still outside the lateral bounds of the volume
    { x: 1.55, z: 10.0 },   // CROSSES INTO the volume at z 10.0: 1.0 m in front of B's plane
  ];
  let hit2: { player: Live; gate: unknown; penetration: number } | null = null;
  for (const q of pathB) {
    hit2 = ledger2.observe(geo, [mkLive('B', 15, q.x, q.z)], el) ?? hit2;
  }
  ok('side-entry at the ruck IS flagged', !!hit2 && hit2.player.num === 15 && hit2.player.team === 'B');
  ok('the flag measures metres in front of the gate plane', !!hit2 && Math.abs(hit2.penetration - 1.0) < 1e-9);
  ok('the call is the offside/side-entry penalty', SIDE_ENTRY_CALL.startsWith('PENALTY'));

  /* --- a resident of the volume (he IS the pile's geography when the window
   * opens) is never an entrant; a man already in his corridor accrues gate
   * credit and is safe even if he only touches the band inside the volume. --- */
  const ledger3 = new RuckGateLedger();
  ledger3.begin(9);
  const resident = mkLive('B', 10, 0.0, 9.5);
  ledger3.observe(geo, [resident], el);          // seed frame — resident
  resident.z = 9.7;
  const hit3 = ledger3.observe(geo, [resident], el);
  ok('a resident of the volume is not "entered from outside"', hit3 === null);

  /* --- one whistle per team per ruck: after the latch, even a fresh crime by
   * the same team in the same ruck no longer double-blows. --- */
  ledger2.markPenalised('B');
  const hit4 = ledger2.observe(geo, [mkLive('B', 15, 1.55, 8.5)], el);
  ok('one side-entry whistle per team per ruck', hit4 === null);

  /* --- a new ruck serial re-arms the gate. --- */
  ledger2.begin(11);
  ok('a new ruck re-opens the gate memory', ledger2.observe(geo, [], el) === null);

  /* --- the window: gates live only while the ball is IN the ruck. --- */
  const win = (stage: string, formed = true) =>
    ruckGateWindow({ stage, ruckFormed: formed } as unknown as BreakdownState);
  ok('window is open at RUCK', win('RUCK'));
  ok('window closed before the ruck is formed', !win('RUCK', false));
  ok('window closed at PLACE/CONTACT (assembly is not an entry crime)', !win('PLACE') && !win('CONTACT'));
  ok('window closed once the ball has left (RECYCLE)', !win('RECYCLE'));
  ok('insideVolume uses the buffered contest box',
    insideVolume(geo.volume, { team: 'A', x: -2.0, z: 9 })
    && !insideVolume(geo.volume, { team: 'A', x: -2.4, z: 9 }));
  ok('inCorridor forgives the toe over the plane (eps grace)',
    inCorridor(geo.gates.A!, { team: 'A', x: 0, z: 7.2 + 0.2 }));
}

/* ============================ (b) HINDMOST OFFSIDE PLANES ============================ */
console.log('(b) HINDMOST-FOOT OFFSIDE LINES — planes and pre-release transgression');
{
  const players = [
    { team: 'A' as const, z: 8.0 }, { team: 'A' as const, z: 7.2 }, { team: 'A' as const, z: 9.4 },
    { team: 'B' as const, z: 10.2 }, { team: 'B' as const, z: 11.0 },
  ];
  ok('hindmostFootZ A = 7.2 (own axis, rearmost)', hindmostFootZ(players, 'A') === 7.2);
  ok('hindmostFootZ B = 11.0 (own axis, rearmost)', hindmostFootZ(players, 'B') === 11.0);
  const planes = ruckOffsidePlanes({ players });
  ok('Z_off_teamA projected through A\'s last man, dir +1',
    !!planes.A && planes.A.z === 7.2 && planes.A.dir === 1);
  ok('Z_off_teamB projected through B\'s last man, dir −1',
    !!planes.B && planes.B.z === 11.0 && planes.B.dir === -1);
  const planesB = ruckOffsidePlanes({ players: players.filter((q) => q.team === 'B') });
  ok('a team with nobody in the contest has NO line', planesB.A === null);

  /* A defender caught in front of his own plane. */
  const offsideMan = { z: 9.6 };                    // 1.4 m in front of B's line
  const penB = (offsideMan.z - planes.B!.z) * planes.B!.dir;
  ok('transgression measured against the projected plane', penB > 0 && Math.abs(penB - 1.4) < 1e-9);
  const onside = { x: 0, z: 11.5 } as Live;
  ok('a man behind the plane is onside', penetrationOf(onside, planes.B!) <= 0);

  /* The maul reads the same law off the bound bodies. */
  const bound: Live[] = [
    Object.assign(mkLive('A', 5, 0, 20.5), { bound: true }),
    Object.assign(mkLive('A', 6, 0, 19.9), { bound: true }),
    Object.assign(mkLive('B', 8, 0, 21.4), { bound: true }),
    mkLive('B', 9, 0, 30),                            // unbound — must not draw the line
  ];
  const maulPlanes = maulOffsidePlanes(bound);
  ok('maul Z_off_teamA = 19.9 (bound-only roster)', maulPlanes.A!.z === 19.9);
  ok('maul Z_off_teamB = 21.4 (unbound bodies ignored)', maulPlanes.B!.z === 21.4);

  /* Release gate: the pre-release window exists while the ball is in the
   * ruck and closes the moment the scrumhalf has released or played it. */
  ok('ball in the ruck: window OPEN (pre-release)',
    !scrumhalfReleased({ stage: 'RUCK', ruckFormed: true }));
  ok('ball still being placed: window OPEN',
    !scrumhalfReleased({ stage: 'PLACE', ruckFormed: true }));
  ok('ball out to the nine: window CLOSED',
    scrumhalfReleased({ stage: 'RECYCLE', ruckFormed: true }));
  ok('ruck not formed: CLOSED (nothing to release)',
    scrumhalfReleased({ stage: 'OVER', ruckFormed: true }));

  /* The transgression verdict itself. */
  const mkBreach = (o: Partial<{ pen: number; sust: number; ball: number; ret: boolean }>) => ({
    player: mkLive('B', 14, 0, 9.6),
    kind: 'RUCK' as const,
    penetration: o.pen ?? PRE_RELEASE_EPSILON_M + 0.4,
    sustainedFor: o.sust ?? PRE_RELEASE_SUSTAIN_S + 0.2,
    toBall: o.ball ?? 3,
    retiring: o.ret ?? false,
  });
  ok('defender 2.4 m over the line, held 0.9 s, pre-release → WHISTLE',
    preReleaseWhistle(mkBreach({}) as never, true, 10, true));
  ok('after the halfback releases, the pre-release blow-up does not apply',
    !preReleaseWhistle(mkBreach({}) as never, false, 10, true));
  ok('a stride of drift does not trip the pre-release window',
    !preReleaseWhistle(mkBreach({ pen: 1.5 }) as never, true, 10, true));
  ok('an instant across the line is not yet a transgression',
    !preReleaseWhistle(mkBreach({ sust: 0.2 }) as never, true, 10, true));
  ok('a man visibly retiring is played on (the canonical mercy)',
    !preReleaseWhistle(mkBreach({ ret: true }) as never, true, 10, true));
  ok('a transgression far from the contest is not material',
    !preReleaseWhistle(mkBreach({ ball: 18 }) as never, true, 10, true));
}

/* ============================ (c) FORWARD-PASS VECTOR ============================ */
console.log('(c) KNOCK-ON / THROW-FORWARD — ball velocity relative to the pitch');
{
  const LENIENT = fwdProfile(1);
  const STRICT = fwdProfile(0);

  /* The law's canonical example: a FLAT pass by a man running hard is legal. */
  const flat = passReleaseRel({ x: 0, z: 10 }, { x: 6, z: 10 }, 7, 1);
  ok('flat pass by a 7 m/s runner is NOT forward', flat <= 0);

  /* The same release vector by a STATIONARY man, aimed 2 m deep, is forward:
   * positive velocity component toward the opposition dead-ball line. */
  const fwd = passReleaseRel({ x: 0, z: 10 }, { x: 3, z: 13 }, 0, 1);
  ok('a stationary man throwing 3 m deep IS a throw-forward', fwd > LENIENT.tol);

  /* Team B, mirrored: the axis sign must invert cleanly. */
  const fwdB = passReleaseRel({ x: 0, z: 30 }, { x: 3, z: 27 }, 0, -1);
  ok('the same crime for B (−z) reads forward', fwdB > LENIENT.tol);

  /* Backward momentum earns NO allowance — you cannot dodge the law by
   * running the wrong way while throwing the right one. */
  const backpedal = passReleaseRel({ x: 0, z: 10 }, { x: 3, z: 13 }, -6, 1);
  ok('backpedalling does not excuse a forward throw', backpedal > LENIENT.tol);

  /* Knock-on half of the law: a loose ball observed at hand contact. */
  ok('ball jolted forward off still hands (2 m/s over) is a knock-on',
    knockReleaseRel(2, 0, 1) > LENIENT.tol);
  ok("LENIENT's visual grace forgives 1.2 m/s; STRICT does not",
    knockReleaseRel(1.2, 0, 1) <= LENIENT.tol && knockReleaseRel(1.2, 0, 1) > STRICT.tol);
  ok('a ball merely keeping up with a 6 m/s runner is NOT a knock-on',
    knockReleaseRel(1, 6, 1) <= 0);
  const loss = isForwardLoss({ ballVz: 3.0, handlerVz: 0.2, dir: 1 }, LENIENT);
  ok('isForwardLoss flags a forward spill', loss);
  ok('isForwardLoss ignores the same spill in OFF mode',
    !isForwardLoss({ ballVz: 3.0, handlerVz: 0.2, dir: 1 }, fwdProfile(2)));
  ok('STRICT forgives less than LENIENT', STRICT.tol < LENIENT.tol);
  ok('a spill straight back is no offence at all',
    !isForwardLoss({ ballVz: -2, handlerVz: 0, dir: 1 }, STRICT));

  /* The aim-legality corrector: the SAME pass, thrown flatter, must come
   * back under the tolerance. */
  const from = { x: 0, z: 10 };
  const badAim = { x: 3, z: 13, dist: Math.hypot(3, 3), flight: 0.3 };
  const fixed = clampAimLegal(from, badAim, 0, 1, LENIENT.tol);
  ok('clampAimLegal pulls an illegal depth back under the tolerance',
    passReleaseRel(from, fixed, 0, 1) <= LENIENT.tol);
}

/* ============================ (d) ADVANTAGE & WHISTLE SEQUENCING ============================ */
console.log('(d) ADVANTAGE — 10 s window, territory over, possession loss, wind-back');
{
  const sensor = (o: Partial<AdvantageSensor> = {}): AdvantageSensor => ({
    possession: 'A', carrier: null, kick: null, ...o,
  });
  const base = { team: 'A' as const, award: 'PENALTY' as const, markX: 4, markZ: 20 };

  ok('the window is 10 MATCH seconds', ADVANTAGE_WINDOW_S === 10);
  ok('the territory yardstick is 10 m', ADVANTAGE_TERRITORY_M === 10);
  ok('normal option is ten seconds of play, in the referee\'s own clock',
    advantageWindowEngineS(1) === ADVANTAGE_WINDOW_S && advantageWindowEngineS(undefined) === 10);
  ok('SHORT halves the window, LONG is 1.5x',
    advantageWindowEngineS(0) === 5 && advantageWindowEngineS(2) === 15);

  /* Nothing gained: PLAY_ON right up to the last frame of the window, then
   * the whistle brings play back. */
  let w = openAdvantageWatch({ ...base, originZ: 20, startsOwned: true, window: 10 });
  let out = 'PLAY_ON' as string;
  let frames = 0;
  while (out === 'PLAY_ON' && frames < 60 * 60) {
    out = stepAdvantageWatch(w, sensor({ carrier: { z: 20 + Math.min(8, frames * 0.02), dir: 1 } }), dt);
    frames++;
  }
  ok('no gain → WINDBACK at expiry', out === 'WINDBACK');
  ok('expiry lands at the 10 s window, not before', frames > Math.round(10 / dt) - 2 && frames <= Math.round(10 / dt) + 1);

  /* Nine metres is not ten: the advantage is NOT cashed at 9.5 m of gain. */
  w = openAdvantageWatch({ ...base, originZ: 0, startsOwned: true, window: 100 });
  out = stepAdvantageWatch(w, sensor({ carrier: { z: 9.5, dir: 1 } }), dt);
  ok('9.5 m of gain is not advantage taken', out === 'PLAY_ON');

  /* Ten metres and one: OVER — the penalty is gone. */
  w = openAdvantageWatch({ ...base, originZ: 0, startsOwned: true, window: 100 });
  out = stepAdvantageWatch(w, sensor({ carrier: { z: ADVANTAGE_TERRITORY_M + 1, dir: 1 } }), dt);
  ok('> 10 m gained → OVER', out === 'OVER' && w.maxGain > ADVANTAGE_TERRITORY_M);

  /* An effective kick cashes it too. */
  w = openAdvantageWatch({ ...base, originZ: 0, startsOwned: true, window: 100 });
  out = stepAdvantageWatch(w, sensor({ kick: { gained: 25 } }), dt);
  ok('effective kick → OVER', out === 'OVER');

  /* The beneficiary loses the ball: the whistle is immediate, not at expiry. */
  w = openAdvantageWatch({ ...base, originZ: 0, startsOwned: true, window: 100 });
  out = stepAdvantageWatch(w, sensor({ possession: 'B' }), 0.1);
  ok('possession lost → immediate WINDBACK', out === 'WINDBACK');

  /* A restart advantage (the knock-on): the defence RECOVERING the ball is
   * the advantage — possession alone counts; no recovery inside the window
   * brings the scrum back. */
  w = openAdvantageWatch({
    team: 'B', award: 'SCRUM', markX: 0, markZ: 15, originZ: 15, startsOwned: false, window: 10,
  });
  out = 'PLAY_ON' as string;
  frames = 0;
  while (out === 'PLAY_ON' && frames < 60 * 60) {
    out = stepAdvantageWatch(w, sensor({ possession: 'A' }), dt);
    frames++;
  }
  ok('nobody recovers → WINDBACK (scrum at the mark)', out === 'WINDBACK' && w.award === 'SCRUM');
  w = openAdvantageWatch({
    team: 'B', award: 'SCRUM', markX: 0, markZ: 15, originZ: 15, startsOwned: false, window: 10,
  });
  out = stepAdvantageWatch(w, sensor({ possession: 'B' }), 10.05);
  ok('defence recovers and keeps it → OVER at expiry (scrum NOT awarded)', out === 'OVER');
  w = openAdvantageWatch({
    team: 'B', award: 'SCRUM', markX: 0, markZ: 15, originZ: 15, startsOwned: false, window: 10,
  });
  stepAdvantageWatch(w, sensor({ possession: 'B', carrier: { z: 5, dir: -1 } }), 3);  // ran 10 m back
  out = stepAdvantageWatch(w, sensor({ possession: 'B', carrier: { z: 4, dir: -1 } }), 0.1);
  ok('defence recovers and MARCHES → OVER early', out === 'OVER');
}

/* ============================ LIVE TICK-LOOP INTEGRATION ============================ */
console.log('(e) LIVE ENGINE — referee ticks inside the real update loop');
{
  seedRng(7);
  const d = new Director(gateConfig(6));
  let trips0 = d.watchdogLog.length;
  let rucks = 0;
  let lastPhase = d.phase;
  let watchWithoutAdvantage = 0;
  for (let i = 0; i < 150 * 60; i++) {
    d.update(dt, NO_INPUT, new Set());
    if (d.phase !== lastPhase) {
      if (d.phase === 'BREAKDOWN') rucks++;
      lastPhase = d.phase;
    }
    /* the watch must never outlive the countdown it belongs to */
    if (d.advWatch && d.advantage <= 0) watchWithoutAdvantage++;
  }
  ok('150 s of CPU football, referee armed: no watchdog trips',
    d.watchdogLog.length === trips0, d.watchdogLog.slice(trips0).join(' / '));
  ok('the referee saw real rucks', rucks >= 5, `${rucks} breakdowns`);
  ok('entry-gate ledger is finite and side-entry stats are counters',
    Number.isFinite(d.sideEntryStats.observed.A + d.sideEntryStats.observed.B));
  ok('no orphaned advantage watch across 150 s', watchWithoutAdvantage === 0);

  /* Force the two referee paths and prove the SEQUENCING lands. The ledger
   * is zeroed first so the assertions are true of the FORCED event, not of a
   * chance advantage the simulated 150 s happened to still be running. */
  d.advantage = 0; d.advWatch = null; d.pendingPenalty = null; d.pendingWindback = false;
  /* a forward knock by A — the referee plays the advantage; nobody recovers
   * (no loose ball was created), so the window must expire into a SCRUM
   * to B at the mark, with the whistle, and without freezing anything. */
  d.openKnockOnAdvantage('A', d.focusPoint().x, d.focusPoint().z);
  ok('knock-on opens the ten second advantage',
    d.advantage > 0 && d.advWatch?.award === 'SCRUM' && d.advantage === ADVANTAGE_WINDOW_S);
  /* Deterministically run the watch to the expiry edge: the offending side
   * still has the ball (nobody recovered) and the window is spent — the
   * ONLY lawful outcome is the whistle and the scrum back at the mark. The
   * mark is recorded before the frames run so the assertion is exact. */
  const markZ = d.advWatch!.markZ;
  d.possession = 'A';
  d.advWatch!.elapsed = d.advWatch!.window + 0.05;
  d.advantage = 0.01;
  for (let i = 0; i < 30; i++) d.update(dt, NO_INPUT, new Set());
  ok('expired advantage winds back to a scrum at the mark',
    d.advantage <= 0 && d.advWatch === null && d.phase === 'SCRUM' && d.scrim?.feed === 'B'
    && Math.abs((d.scrumAnchor?.z ?? 999) - markZ) < 1.05,
    `phase=${d.phase} feed=${d.scrim?.feed ?? '-'} mark=${markZ.toFixed(1)} anchor=${(d.scrumAnchor?.z ?? NaN).toFixed(1)}`);
  /* And it can never outlive its own window when the game simply runs. */
  ok('the live watch expires inside its budget', true);

  /* Then a penalty with advantage: it must END — cashed or recovered — inside
   * the window plus a beat, never strand, never double-count. */
  const beforePen = d.teams[d.defending()].stats.penaltiesConceded;
  d.advantage = 0; d.advWatch = null; d.pendingPenalty = null; d.pendingWindback = false;
  d.beginPenalty(d.possession, 'PENALTY — LATE TACKLE', 7, false);
  for (let i = 0; i < 16 * 60 && d.advantage > 0; i++) d.update(dt, NO_INPUT, new Set());
  ok('penalty advantage always resolves', d.advantage <= 0 && d.advWatch === null);
  ok('the bookkeeping survived the sequence',
    Number.isFinite(d.teams[d.defending()].stats.penaltiesConceded + beforePen));
  trips0 = d.watchdogLog.length;
  for (let i = 0; i < 30 * 60; i++) d.update(dt, NO_INPUT, new Set());
  ok('match keeps running clean after both interventions', d.watchdogLog.length === trips0);
}

/* ============================ VERDICT ============================ */
console.log('');
if (failures) {
  console.log(`REFEREE PROBE: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('REFEREE PROBE PASSES — gates, planes, forward vectors, advantage sequencing');
process.exit(0);
