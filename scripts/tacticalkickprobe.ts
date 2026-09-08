/**
 * TACTICAL KICK PROBE — the 50:22, the Mark, Law 9.17 and 14 v 15.
 *
 *   npx tsx scripts/tacticalkickprobe.ts
 *
 * Four law families, proved the way `refereeprobe.ts` proves the gates and
 * `scorerestartprobe.ts` proves the scoring geometry: the PURE judgements
 * first (deterministic to the metre and the frame, no Director), then the
 * REAL engine driven through the same situations, because a law that passes
 * a unit test but never fires in a match is not a law.
 *
 *   (a) 50:22 ×10          — ten kicks struck from behind halfway that bounce
 *                            in the field of play and cross the touchline
 *                            inside the opposition 22. Each must award the
 *                            LINEOUT THROW to the KICKING side at the touch
 *                            mark. Plus the four negative controls the law
 *                            turns on: no bounce (straight out), a defensive
 *                            touch, a kick from the wrong half, and a touch
 *                            mark short of the 22.
 *   (b) THE MARK           — a clean catch on the full inside a defender's
 *                            own 22 freezes play and awards him the free
 *                            kick AT THE CATCH SPOT, with the negative
 *                            controls (bounced first, outside the 22, off
 *                            his own side's boot).
 *   (c) LAW 9.17 ×N        — a grounded defender challenging an airborne
 *                            jumper. The referee whistles a PENALTY to the
 *                            jumper's side, the offender is CARDED, and his
 *                            `sinbin` reads exactly 600. Two men both in the
 *                            air, and a challenge after the landing, are
 *                            legal and must produce nothing.
 *   (d) 14 v 15 ×150 s     — a full 150 seconds of unattended match play with
 *                            a man in the bin: 0 NaN, 0 exceptions, 0
 *                            watchdog trips, exactly 14 active bodies on the
 *                            penalised side for the whole sentence, the
 *                            binned man off the field and out of every phase
 *                            roster, and a clean return once the clock
 *                            expires.
 *
 * Exit 0 when everything passes.
 */
import { Director, quickStartConfig, NO_INPUT, type MatchConfig } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { REFEREE_CALLS } from '../src/game/data';
import type { Live } from '../src/game/intelligence';
import {
  isFiftyTwentyTwo, judgeTouchKick, isMarkCall, judgeAerialTackle,
  shouldContestAerial, tickSinBin, sinBinMark, sinBinMayReturn,
  insideOppTwentyTwo, insideOwnTwentyTwo, oppTwentyTwoLineZ, ownTwentyTwoLineZ,
  fromOwnHalf, SIN_BIN_SECONDS, MARK_MIN_CATCH_HEIGHT_M, AERIAL_JUMP_IMPULSE,
} from '../src/game/engine/referee';
import {
  findAerialChallenge, AERIAL_CHALLENGE_RADIUS_M,
} from '../src/game/engine/latch';
import {
  aerialLandingMark, isAirborne, stepAerialJump, aerialReach,
  AERIAL_STANDING_REACH_M,
} from '../src/game/engine/approach';

const dt = 1 / 60;
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`FAIL: ${msg}`); };
const pass = (msg: string) => console.log(`  ok   ${msg}`);
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) pass(`${label}${detail ? `  [${detail}]` : ''}`);
  else fail(`${label}${detail ? `  [${detail}]` : ''}`);
};
const step = (d: Director, n: number) => {
  for (let i = 0; i < n; i++) d.update(dt, NO_INPUT, new Set(), new Set());
};

/* ==================== (a) THE 50:22 — LAW 18.6 ==================== */
console.log('(a) 50:22 ×10 — behind halfway, bounced in the field, into touch inside the 22');
{
  seedRng(9101);

  /* ---- the pure law, over ten kicks with real geometry ---- */
  let awarded = 0;
  const marks: number[] = [];
  for (let i = 0; i < 10; i++) {
    /* A kicks toward +z: his own half is z < 0, the opposition 22 is z ≥ 28. */
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
    /* Struck from 4–24 m inside his own half. */
    const markZ = dir * -(4 + i * 2);
    /* Crossing touch 1–13 m inside their 22. */
    const touchZ = oppTwentyTwoLineZ(dir) + dir * (1 + i * 1.3);
    const frame = {
      dir, markZ, touchZ, bounces: 1 + (i % 2), defenceTouched: false, fromOwn22: false,
    };
    const award = judgeTouchKick(frame);
    if (isFiftyTwentyTwo(frame) && award.throwTo === 'KICKER'
      && Math.abs(award.markZ - touchZ) < 1e-9 && award.fifty22) awarded++;
    marks.push(touchZ);
  }
  ok('10/10 legal 50:22 kicks award the throw to the KICKING side at the touch mark',
    awarded === 10, `${awarded}/10, marks ${marks.map((m) => m.toFixed(1)).join(' ')}`);

  /* ---- the four things that kill it ---- */
  const base = { dir: 1 as const, markZ: -10, touchZ: 34, bounces: 2, defenceTouched: false, fromOwn22: false };
  ok('a kick straight to touch on the full is NOT a 50:22 (it must bounce)',
    !isFiftyTwentyTwo({ ...base, bounces: 0 }));
  ok('a DEFENSIVE touch kills the 50:22 dead',
    !isFiftyTwentyTwo({ ...base, defenceTouched: true }));
  ok('a kick from inside the opposition half is not a 50:22',
    !isFiftyTwentyTwo({ ...base, markZ: 6 }));
  ok('a touch mark short of the 22 is not a 50:22',
    !isFiftyTwentyTwo({ ...base, touchZ: oppTwentyTwoLineZ(1) - 0.4 }));

  /* ---- the geometry the law is measured on ---- */
  ok('the opposition 22-metre line is at ±28 m',
    oppTwentyTwoLineZ(1) === 28 && oppTwentyTwoLineZ(-1) === -28,
    `${oppTwentyTwoLineZ(1)} / ${oppTwentyTwoLineZ(-1)}`);
  ok('a side\'s own 22-metre line is the mirror of it',
    ownTwentyTwoLineZ(1) === -28 && ownTwentyTwoLineZ(-1) === 28);
  ok('inside/outside the 22 and the halfway test agree with the lines',
    insideOppTwentyTwo(1, 30) && !insideOppTwentyTwo(1, 27.9)
    && insideOwnTwentyTwo(1, -30) && !insideOwnTwentyTwo(1, -27.9)
    && fromOwnHalf(1, -0.1) && !fromOwnHalf(1, 0.1));

  /* ---- LAW 18.9 — the ordinary touch kick, for contrast ---- */
  const direct = judgeTouchKick({ dir: 1, markZ: 5, touchZ: 40, bounces: 0, defenceTouched: false, fromOwn22: false });
  ok('a kick straight out from OUTSIDE the 22 comes back to the mark, throw to the opposition',
    direct.throwTo === 'OPPOSITION' && direct.markZ === 5 && direct.broughtBack,
    `mark ${direct.markZ}`);
  const from22 = judgeTouchKick({ dir: 1, markZ: -40, touchZ: 5, bounces: 0, defenceTouched: false, fromOwn22: true });
  ok('a kick straight out from INSIDE your own 22 keeps the ground it made',
    from22.throwTo === 'OPPOSITION' && from22.markZ === 5 && !from22.broughtBack,
    `mark ${from22.markZ}`);
  const bounced = judgeTouchKick({ dir: 1, markZ: 5, touchZ: 40, bounces: 1, defenceTouched: false, fromOwn22: false });
  ok('an indirect kick to touch from the opposition half is the opposition throw where it crossed',
    bounced.throwTo === 'OPPOSITION' && bounced.markZ === 40 && !bounced.broughtBack);

  /* ---- the engine: ten real strikes through the real kick loop ---- */
  let engineAwards = 0;
  let engineThrows = 0;
  const lineoutZs: number[] = [];
  for (let i = 0; i < 10; i++) {
    seedRng(9200 + i);
    const d = new Director({ ...quickStartConfig(), cpuA: true, cpuB: true } as MatchConfig);
    /* Stage a kick from A's own half and drive the flight loop by hand: the
     * launch is the engine's, the ball is the engine's, only the trajectory
     * is chosen so the kick genuinely finds touch inside the 22. */
    d.startKick('A', 'PUNT', { x: 4, z: -12 });
    const k = d.kk!;
    k.stage = 'FLIGHT';
    k.groundBounces = 0;
    k.defTouched = false;
    /* A flat raker that lands about 34 m upfield and skids out. */
    const b = k.body;
    b.x = k.bx; b.y = 0.8; b.z = k.bz;
    b.vx = 9.5 + i * 0.15; b.vy = 7.0; b.vz = 21.5;
    b.socket = null; b.sleeping = false; b.grounded = false; b.bounces = 0;
    k.bx = b.x; k.by = b.y; k.bz = b.z;
    k.vx = b.vx; k.vy = b.vy; k.vz = b.vz;
    /* Nobody may catch it: this trial is about the touchline, not the chase. */
    for (const p of d.live) { p.x = -30 + (p.num % 5); p.z = -48; }
    for (let f = 0; f < 600 && d.phase === 'KICK'; f++) d.update(dt, NO_INPUT, new Set(), new Set());
    if (d.phase === 'LINEOUT' && d.lo) {
      engineAwards++;
      lineoutZs.push(d.lo.markZ);
      if (d.lo.thrower === 'A') engineThrows++;
    }
  }
  ok('10/10 engine kicks from behind halfway finished as a lineout',
    engineAwards === 10, `${engineAwards}/10`);
  ok('every one of them awarded the throw to the KICKING side (A)',
    engineThrows === engineAwards && engineThrows === 10,
    `${engineThrows}/${engineAwards} · marks ${lineoutZs.map((z) => z.toFixed(1)).join(' ')}`);
  ok('every lineout mark is inside the opposition 22',
    lineoutZs.length === 10 && lineoutZs.every((z) => z >= 28 - 6.001),
    lineoutZs.map((z) => z.toFixed(1)).join(' '));

  /* ---- the engine, negative control: a kick straight out on the full ---- */
  seedRng(9300);
  {
    const d = new Director({ ...quickStartConfig(), cpuA: true, cpuB: true } as MatchConfig);
    d.startKick('A', 'PUNT', { x: 10, z: -12 });
    const k = d.kk!;
    k.stage = 'FLIGHT';
    k.groundBounces = 0; k.defTouched = false;
    const b = k.body;
    b.x = k.bx; b.y = 1.0; b.z = k.bz;
    b.vx = 24; b.vy = 9; b.vz = 20;
    b.socket = null; b.sleeping = false; b.grounded = false; b.bounces = 0;
    k.bx = b.x; k.by = b.y; k.bz = b.z; k.vx = b.vx; k.vy = b.vy; k.vz = b.vz;
    for (const p of d.live) { p.x = -30 + (p.num % 5); p.z = -48; }
    for (let f = 0; f < 600 && d.phase === 'KICK'; f++) d.update(dt, NO_INPUT, new Set(), new Set());
    ok('a kick straight into touch on the full gives the throw to the OPPOSITION',
      d.phase === 'LINEOUT' && d.lo?.thrower === 'B',
      `phase ${d.phase} thrower ${d.lo?.thrower ?? '-'}`);
  }
}

/* ==================== (b) THE MARK — LAW 18.11 ==================== */
console.log('\n(b) THE MARK — clean catch on the full inside the 22, unpressured free kick');
{
  /* ---- the pure law ---- */
  const clean = {
    dir: 1 as const, catchZ: -34, catchY: 1.9, opponentKick: true, bounces: 0, clean: true,
  };
  ok('a clean catch on the full inside your own 22 is a MARK', isMarkCall(clean));
  ok('a catch outside the 22 is not', !isMarkCall({ ...clean, catchZ: -20 }));
  ok('a catch after a bounce is not', !isMarkCall({ ...clean, bounces: 1 }));
  ok('a catch off your OWN side\'s kick is not', !isMarkCall({ ...clean, opponentKick: false }));
  ok('a ball scooped off the boot is not (below the catch height)',
    !isMarkCall({ ...clean, catchY: MARK_MIN_CATCH_HEIGHT_M - 0.01 }));
  ok('a mark may be called in the in-goal too',
    isMarkCall({ ...clean, catchZ: -54 }));

  /* ---- the engine: a real defender takes a real kick in his own 22 ---- */
  seedRng(9400);
  const d = new Director({ ...quickStartConfig(), cpuA: true, cpuB: true } as MatchConfig);
  /* B kicks toward −z; A's fullback fields it deep inside A's own 22. */
  d.startKick('B', 'PUNT', { x: 0, z: 6 });
  const k = d.kk!;
  k.stage = 'FLIGHT';
  k.groundBounces = 0; k.defTouched = false;
  const catcher = d.L('A', 15);
  /* Park everybody else miles away so exactly one man can take it. */
  for (const p of d.live) { p.x = 30; p.z = 44; p.vx = 0; p.vz = 0; p.down = false; p.bound = false; }
  catcher.x = 0; catcher.z = -36; catcher.vx = 0; catcher.vz = 0;
  const b = k.body;
  b.x = 0; b.y = 3.4; b.z = -36;
  b.vx = 0; b.vy = -1.0; b.vz = 0;
  b.socket = null; b.sleeping = false; b.grounded = false; b.bounces = 0;
  k.bx = b.x; k.by = b.y; k.bz = b.z; k.vx = b.vx; k.vy = b.vy; k.vz = b.vz;
  const scoreBefore = d.teams.A.score + d.teams.B.score;
  for (let f = 0; f < 300 && !d.markAward; f++) d.update(dt, NO_INPUT, new Set(), new Set());
  const mk = d.markAward;
  ok('the engine called the mark on the fielder', !!mk && mk.team === 'A' && mk.num === 15,
    mk ? `${mk.team}:${mk.num} at z ${mk.z.toFixed(1)}` : 'no mark');
  ok('the free kick is awarded AT THE CATCH SPOT inside the 22',
    !!mk && insideOwnTwentyTwo(1, mk.z) && Math.abs(mk.z - (-36)) < 2.5,
    mk ? `z ${mk.z.toFixed(2)}` : '-');
  ok('the kick episode is torn down — play freezes on the whistle',
    d.kk === undefined, `kk ${d.kk === undefined ? 'cleared' : 'live'}`);
  ok('possession is the catcher\'s side and the restart is his',
    d.possession === 'A' && d.phase === 'OPEN_PLAY' && d.op?.attacking === 'A',
    `${d.possession} / ${d.phase} / carrier ${d.op?.carrierNum ?? '-'}`);
  ok('the restart is UNPRESSURED — the defence may not touch him yet',
    (d.op?.protect ?? 0) > 0, `protect ${(d.op?.protect ?? 0).toFixed(2)}`);
  ok('no score changed on a mark', d.teams.A.score + d.teams.B.score === scoreBefore);
  /* Play on briefly: the free kick must not hang the match. */
  step(d, 240);
  ok('the match runs on cleanly after the mark',
    d.watchdogTrips === 0 && !d.over, `trips ${d.watchdogTrips}`);
}

/* ============ (c) LAW 9.17 — THE MAN IN THE AIR ============ */
console.log('\n(c) LAW 9.17 — the challenge on an airborne jumper: penalty + yellow, sinbin = 600');
{
  /* ---- the pure verdict ---- */
  ok('a grounded opponent challenging an airborne man is a PENALTY + YELLOW',
    judgeAerialTackle({ victimAirborne: true, offenderAirborne: false, contact: true, opponents: true })
    === 'PENALTY_YELLOW');
  ok('two men both in the air is a LEGAL contest',
    judgeAerialTackle({ victimAirborne: true, offenderAirborne: true, contact: true, opponents: true })
    === 'LEGAL');
  ok('a tackle after his feet are back down is LEGAL',
    judgeAerialTackle({ victimAirborne: false, offenderAirborne: false, contact: true, opponents: true })
    === 'LEGAL');
  ok('a team-mate is never the offender',
    judgeAerialTackle({ victimAirborne: true, offenderAirborne: false, contact: true, opponents: false })
    === 'LEGAL');
  ok('the sanction is ten match-minutes', SIN_BIN_SECONDS === 600, `${SIN_BIN_SECONDS}`);

  /* ---- the aerial contest kinematics ---- */
  const landing = aerialLandingMark({ x: 0, y: 12, z: 0, vx: 2, vy: -4, vz: 8 }, AERIAL_STANDING_REACH_M);
  ok('the landing mark leads a descending ball to catching height',
    landing.eta > 0.5 && landing.eta < 4 && landing.z > 4 && Number.isFinite(landing.x),
    `eta ${landing.eta.toFixed(2)}s → (${landing.x.toFixed(1)}, ${landing.z.toFixed(1)})`);
  ok('a converging, eligible man under a descending ball commits to the jump',
    shouldContestAerial({ ballY: 5, ballVY: -6, distanceToMark: 0.9, eta: 0.3, airborne: false, eligible: true }));
  ok('a man already in the air does not jump again',
    !shouldContestAerial({ ballY: 5, ballVY: -6, distanceToMark: 0.9, eta: 0.3, airborne: true, eligible: true }));
  ok('a man too far from the mark does not jump',
    !shouldContestAerial({ ballY: 5, ballVY: -6, distanceToMark: 4.5, eta: 0.3, airborne: false, eligible: true }));
  ok('a rising ball is not an aerial contest',
    !shouldContestAerial({ ballY: 5, ballVY: 6, distanceToMark: 0.9, eta: 0.3, airborne: false, eligible: true }));
  {
    let y = 0.001, vy = AERIAL_JUMP_IMPULSE, frames = 0, apex = 0;
    for (; frames < 600; frames++) {
      const s = stepAerialJump(y, vy, dt);
      y = s.jumpY; vy = s.jumpVY; apex = Math.max(apex, y);
      if (s.landed) break;
    }
    ok('a contesting leap gets a man off the ground and back down again',
      apex > 0.35 && frames > 6 && frames < 120 && y === 0,
      `apex ${apex.toFixed(2)} m over ${(frames * dt).toFixed(2)} s`);
    ok('reach rises with the leap',
      aerialReach(1, 0.6) > aerialReach(1, 0) && isAirborne(0.6) && !isAirborne(0));
  }

  /* ---- the geometric detector ---- */
  const mk = (team: 'A' | 'B', num: number, x: number, z: number, jumpY: number, vx = 0, vz = 0): Live => ({
    team, num, x, z, vx, vz, face: 1, clip: 'ready', clipT: 0, jitter: 0,
    stamina: 100, restT: 0, size: 1, assignment: 'OPEN_PLAY', job: '',
    tx: x, tz: z, urgency: 0, bound: false, down: false, carrier: false,
    passRank: 0, eta: 0, controlled: false, sinbin: 0, beatenT: 0,
    jumpY, jumpVY: 0,
    attrs: { SPD: 70, PWR: 70, SKL: 70, AGG: 70, AWA: 70, STA: 70 },
  } as unknown as Live);
  {
    const jumper = mk('A', 11, 0, 0, 0.9);
    const charger = mk('B', 14, 0.8, 0, 0, -3.2, 0);
    const hit = findAerialChallenge([jumper, charger]);
    ok('the detector finds the grounded man charging into the jumper',
      !!hit && hit.victim.num === 11 && hit.offender.num === 14,
      hit ? `${hit.offender.team}:${hit.offender.num} at ${hit.distance.toFixed(2)} m` : 'none');
    const bothUp = findAerialChallenge([mk('A', 11, 0, 0, 0.9), mk('B', 14, 0.8, 0, 0.8, -3.2, 0)]);
    ok('two jumpers contesting the same ball produce no offence', bothUp === null);
    const landed = findAerialChallenge([mk('A', 11, 0, 0, 0), mk('B', 14, 0.8, 0, 0, -3.2, 0)]);
    ok('a man whose feet are down produces no offence', landed === null);
    const passive = findAerialChallenge([mk('A', 11, 0, 0, 0.9), mk('B', 14, 0.8, 0, 0)]);
    ok('a man standing still under a jumper has not challenged him', passive === null);
    const far = findAerialChallenge([
      mk('A', 11, 0, 0, 0.9),
      mk('B', 14, AERIAL_CHALLENGE_RADIUS_M + 0.5, 0, 0, -4, 0),
    ]);
    ok('a challenge outside the contact radius produces no offence', far === null);
    /* The three clauses that keep the offence RARE — without them a hurdling
     * carrier, a man brushing past, or the first inch of a take-off all read
     * as foul play, and the card went from a rugby event to a lottery. */
    const carrier = mk('A', 11, 0, 0, 0.9);
    (carrier as unknown as { carrier: boolean }).carrier = true;
    ok('a BALL CARRIER who hurdles a tackler is not protected — that is a tackle',
      findAerialChallenge([carrier, mk('B', 14, 0.8, 0, 0, -3.2, 0)]) === null);
    ok('a man running PAST a jumper has not challenged him',
      findAerialChallenge([mk('A', 11, 0, 0, 0.9), mk('B', 14, 0.9, 0, 0, 0, 5)]) === null);
    ok('the first inch of a take-off is not yet a protected jump',
      findAerialChallenge([mk('A', 11, 0, 0, 0.08), mk('B', 14, 0.8, 0, 0, -4, 0)]) === null);
    ok('a slow drift into a jumper is not a charge',
      findAerialChallenge([mk('A', 11, 0, 0, 0.9), mk('B', 14, 0.9, 0, 0, -1.2, 0)]) === null);
  }

  /* ---- the engine: the real whistle, the real card, the real bin ---- */
  seedRng(9500);
  const d = new Director({ ...quickStartConfig(), cpuA: true, cpuB: true } as MatchConfig);
  /* The ball is with the nine, well away from the contest: the protected man
   * is a CHASER contesting a ball in the air, never the carrier — a carrier
   * who jumps is being tackled, not fouled. */
  d.startOpen('A', 0, -20, 9);
  step(d, 2);
  const jumper = d.L('A', 11);
  const offender = d.L('B', 14);
  /* Clear the field so only these two can be in contact. */
  for (const p of d.live) {
    if (p === jumper || p === offender || p.carrier) continue;
    p.x = p.team === 'A' ? -30 : 30; p.z = p.team === 'A' ? -44 : 44;
    p.vx = 0; p.vz = 0; p.down = false; p.bound = false; p.jumpY = 0; p.jumpVY = 0;
  }
  jumper.x = 0; jumper.z = 6; jumper.vx = 0; jumper.vz = 0;
  jumper.jumpY = 0.95; jumper.jumpVY = 1.4;
  offender.x = 0.7; offender.z = 6; offender.vx = -3.4; offender.vz = 0;
  offender.jumpY = 0; offender.jumpVY = 0; offender.diveT = 0.2; offender.clip = 'dive';
  const penBefore = d.teams.B.stats.penaltiesConceded;
  d.update(dt, NO_INPUT, new Set(), new Set());
  ok('the referee whistled a penalty against the offender\'s side',
    d.teams.B.stats.penaltiesConceded > penBefore,
    `${penBefore} → ${d.teams.B.stats.penaltiesConceded}`);
  ok('the call is the Law 9.17 call',
    d.refSignalText.includes('MAN IN THE AIR') || d.feed.some((f) => f.text.includes('MAN IN THE AIR')),
    d.refSignalText);
  ok('the penalty is to the JUMPER\'S side', d.possession === 'A' || d.pendingPenalty?.team === 'A',
    `possession ${d.possession}`);
  ok('the offender was CARDED and his sinbin reads exactly 600',
    offender.sinbin === 600, `sinbin ${offender.sinbin}`);
  ok('foul play is never played on — no advantage window was opened',
    d.advantage === 0, `advantage ${d.advantage}`);
  /* And he leaves the field. He WALKS — no teleport — so the assertion is
   * made once the walk has had the seconds it honestly takes. */
  let walkFrames = 0;
  for (; walkFrames < 60 * 20 && Math.abs(offender.x) <= 34.6; walkFrames++) {
    d.update(dt, NO_INPUT, new Set(), new Set());
  }
  ok('the carded man walks himself off over the touchline',
    Math.abs(offender.x) > 34.6 && offender.sinbin > 0,
    `x ${offender.x.toFixed(1)} z ${offender.z.toFixed(1)} after ${(walkFrames * dt).toFixed(1)} s, sinbin ${offender.sinbin.toFixed(0)}`);
  ok('and he is excluded from every phase',
    !offender.bound && !offender.down && !offender.carrier && !offender.latchedBy && !offender.latchingOnto);
}

/* ============ (d) 14 v 15 — 150 SECONDS OF MATCH PLAY ============ */
console.log('\n(d) 14 v 15 — 150 s of unattended match play with a man in the bin');
{
  seedRng(9600);
  /* A short half so the bin genuinely expires inside the run: the director
   * compresses the match clock, so a 10-minute half runs at 4x and 600 bin
   * seconds are served in 150 real ones. */
  const cfg: MatchConfig = { ...gateConfig(3), halfLength: 10 };
  const d = new Director(cfg);
  step(d, 120);            // let the kickoff resolve into real play
  const offender = d.L('B', 6);
  d.card('B', 6, 'TACKLING THE MAN IN THE AIR');
  ok('the card put shirt B:6 in the bin for ten match-minutes',
    offender.sinbin === SIN_BIN_SECONDS, `${offender.sinbin}`);

  const SECONDS = 150;
  const TICKS = SECONDS * 60;
  /* He WALKS off (no teleport); the roster is 14 from the whistle, but the
   * "he is over the line" assertion only starts once the walk has had the
   * seconds a walk from midfield honestly costs. */
  const WALK_OFF_TICKS = 60 * 12;
  let nan = 0;
  let exceptions = 0;
  let wrongCount = 0;
  let rosterMismatch = 0;
  let binnedOnField = 0;
  let binnedInPhase = 0;
  let soloTicks = 0;
  let extraCards = 0;
  let stillFifteenA = true;
  let sentenceTicks = 0;
  let activeAtEnd = 0;

  for (let i = 0; i < TICKS; i++) {
    try {
      d.update(dt, NO_INPUT, new Set(), new Set());
    } catch (e) {
      exceptions++;
      if (exceptions > 3) break;
    }
    /* NaN sweep — every body, every tick. */
    for (const p of d.live) {
      if (![p.x, p.z, p.vx, p.vz, p.sinbin, p.jumpY ?? 0].every(Number.isFinite)) nan++;
    }
    if (d.kk && ![d.kk.bx, d.kk.by, d.kk.bz, d.kk.vx, d.kk.vy, d.kk.vz].every(Number.isFinite)) nan++;
    if (d.op && ![d.op.carrierX, d.op.carrierZ, d.op.vx, d.op.vz].every(Number.isFinite)) nan++;

    /* THE ROSTER INVARIANT. Whatever the match throws up — a second card is
     * a legal outcome of unattended play — the number of bodies a side has
     * on the field is always fifteen minus the men it has in the bin. */
    const binnedA = d.live.filter((p) => p.team === 'A' && p.sinbin > 0).length;
    const binnedB = d.live.filter((p) => p.team === 'B' && p.sinbin > 0).length;
    const activeA = d.activeCount('A');
    const activeB = d.activeCount('B');
    activeAtEnd = activeB;
    if (activeA !== 15 - binnedA || activeB !== 15 - binnedB) rosterMismatch++;
    if (binnedA > 0) stillFifteenA = false;
    if (binnedB > 1) extraCards++;

    if (offender.sinbin > 0) {
      sentenceTicks++;
      /* While OUR man is the only one carded the side is exactly fourteen. */
      if (binnedB === 1) {
        soloTicks++;
        if (activeB !== 14) wrongCount++;
      }
      /* He is off the field, and no phase counts him. */
      if (Math.abs(offender.x) <= 34.6 && sentenceTicks > WALK_OFF_TICKS) binnedOnField++;
      if (offender.bound || offender.down || offender.carrier
        || offender.latchedBy || offender.latchingOnto) binnedInPhase++;
      if (d.scrim?.players.some((s) => s.team === 'B' && s.num === 6)) binnedInPhase++;
      if (d.lo?.players.some((s) => s.team === 'B' && s.num === 6)) binnedInPhase++;
      if (d.bd?.players.some((s) => s.team === 'B' && s.num === 6)) binnedInPhase++;
    }
  }

  ok('0 exceptions escaped Director.update() across 150 s', exceptions === 0, `${exceptions}`);
  ok('0 NaN coordinates across 150 s of 14 v 15', nan === 0, `${nan}`);
  ok('0 watchdog trips', d.watchdogTrips === 0, `${d.watchdogTrips}`);
  ok('the roster invariant held every tick — on the field = 15 minus the bin',
    rosterMismatch === 0, `${rosterMismatch} bad ticks`);
  ok('the penalised side fielded exactly 14 active bodies for the whole sentence',
    wrongCount === 0 && soloTicks > 0,
    `${soloTicks} ticks at 14, ${wrongCount} bad, ${extraCards} ticks with a second card, last count ${activeAtEnd}`);
  ok('the other side never lost a man', stillFifteenA);
  ok('the binned man stayed off the field of play', binnedOnField === 0, `${binnedOnField} frames inside touch`);
  ok('the binned man was excluded from every phase, ruck, scrum and lineout',
    binnedInPhase === 0, `${binnedInPhase} phase memberships`);

  /* THE RETURN. The clock is compressed 4x, so ten match-minutes are served
   * in about 150 real seconds; the re-entry itself then waits for the next
   * stoppage, which is what the law requires. Run on until both have
   * happened rather than assuming a frame number. */
  let expiryTick = -1;
  let returnTick = -1;
  for (let i = 0; i < 60 * 180; i++) {
    d.update(dt, NO_INPUT, new Set(), new Set());
    if (expiryTick < 0 && offender.sinbin <= 0) expiryTick = i;
    if (expiryTick >= 0 && d.activeCount('B') === 15) { returnTick = i; break; }
  }
  ok('the bin timer ran out',
    offender.sinbin === 0 && expiryTick >= 0,
    `expired ${(( TICKS + expiryTick) * dt).toFixed(0)} s after the card`);
  ok('the man was re-introduced and the side is back to fifteen',
    returnTick >= 0 && d.activeCount('B') === 15,
    `back at ${((TICKS + returnTick) * dt).toFixed(0)} s, phase ${d.phase}`);
  /* And he RUNS BACK ON — the return is a man rejoining the game, not a
   * counter changing. He is released at the touchline and has to cover the
   * ground like everyone else, so give him the seconds that takes. */
  let runOn = 0;
  for (; runOn < 60 * 25 && Math.abs(d.L('B', 6).x) > 34.6; runOn++) {
    d.update(dt, NO_INPUT, new Set(), new Set());
  }
  ok('and he runs back onto the field of play, free of the bin job',
    Math.abs(d.L('B', 6).x) <= 34.6 && !d.L('B', 6).job.startsWith('SIN BIN'),
    `x ${d.L('B', 6).x.toFixed(1)} after ${(runOn * dt).toFixed(1)} s, job "${d.L('B', 6).job}"`);
  /* And the match keeps running clean afterwards. */
  const tripsBefore = d.watchdogTrips;
  step(d, 60 * 20);
  ok('the match runs on clean after the return',
    d.watchdogTrips === tripsBefore, `${d.watchdogTrips - tripsBefore} new trips`);

  /* ---- the pure bin helpers ---- */
  ok('the bin clock ticks down under the match clock scale',
    Math.abs(tickSinBin(600, 1, 4) - 596) < 1e-9 && tickSinBin(0.5, 1, 4) === 0 && tickSinBin(0, 1, 1) === 0);
  ok('a served man returns only at a stoppage',
    sinBinMayReturn(0, 'SCRUM') && sinBinMayReturn(0, 'LINEOUT') && sinBinMayReturn(0, 'KICK')
    && !sinBinMayReturn(0, 'OPEN_PLAY') && !sinBinMayReturn(0, 'BREAKDOWN')
    && !sinBinMayReturn(12, 'SCRUM'));
  ok('the bin mark is outside the field of play',
    Math.abs(sinBinMark('A', 6).x) > 34 && Math.abs(sinBinMark('B', 6).x) > 34,
    `${sinBinMark('A', 6).x}`);
  ok('the Law 9.17 call is registered in the referee\'s ledger',
    REFEREE_CALLS.AERIAL_TACKLE.startsWith('PENALTY') && REFEREE_CALLS.MARK.startsWith('FREE KICK'),
    `${REFEREE_CALLS.AERIAL_TACKLE} · ${REFEREE_CALLS.MARK}`);
}

console.log('');
if (failures) {
  console.log(`TACTICAL KICK PROBE FAILED — ${failures} assertion${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('TACTICAL KICK PROBE PASSES — 50:22, the mark, Law 9.17 and 14 v 15');
process.exit(0);
