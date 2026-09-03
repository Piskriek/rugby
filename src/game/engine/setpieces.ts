/**
 * T-03 — ENGINE/SETPIECES. Extracted verbatim from director.ts: the scrum
 * (slots, the engage sequence, the drive), the lineout (assembly, the throw,
 * the T-06 mechanical lift contest) and the maul. No behaviour change; each
 * function takes a Director reference.
 */

import { Director, ScrumSlot, Input, MaulState } from '../director';
import { DIFFICULTY_TABLE, REFEREE_CALLS } from '../data';
import { R } from './rng';
import { clamp } from './clamp';
import { approach } from './approach';
import {
  MAUL_REGATE_WINDOW_COUNT,
  MAUL_REGATE_WINDOW_SECONDS,
  resolveMaulRegate,
} from '../maulRegate';
import type { MaulExitState } from '../maulRegate';

/** The calls that exist to be driven — the index set the CPU leans on in
 * the attacking 22, where a five-metre lineout is a try invitation. */
const LO_DRIVE_CALLS = [1, 3, 1, 2];

export function upScrum(d: Director, dt: number, input: Input, pressed: Set<string>) {

  const s = d.scrim!;
  s.t += dt;
  const ax = d.scrumAnchor;
  const feed = s.feed;
  const dTeam: 'A' | 'B' = feed === 'A' ? 'B' : 'A';
  const diff = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)];

  // ---- ASSEMBLE: players jog to their marks. No teleport, no load. ----
  if (s.stage === 'ASSEMBLE') {
    let arrived = 0, count = 0;
    for (const slot of s.players) {
      const p = d.L(slot.team, slot.num);
      if (p.sinbin > 0) continue;
      count++;
      if (Math.hypot(p.x - slot.x, p.z - slot.z) < 1.3) arrived++;
    }
    s.ready = count ? arrived / count : 1;
    s.cadence = `FORMING — ${Math.round(s.ready * 100)}% SET`;
    if (s.ready > 0.82 || s.t > 2.4) { s.stage = 'MARK'; s.t = 0; }
    return;
  }

  switch (s.stage) {
    case 'MARK':
      s.cadence = 'MARK SET';
      if (s.t > 0.2) { s.stage = 'FORM'; s.t = 0; }
      break;
    case 'FORM':
      s.cadence = 'CROUCH';
      if (s.t > 0.25) { s.stage = 'CROUCH'; s.t = 0; }
      break;
    case 'CROUCH':
      s.cadence = 'TOUCH';
      if (s.t > 0.35) { s.stage = 'BIND'; s.t = 0; }
      break;
    case 'BIND':
      s.cadence = 'PAUSE';
      if (s.t > 0.35) {
        s.stage = 'SET'; s.t = 0; s.cadence = 'SET';
        /* T-16 FREEZE. The reset counter was incremented *after* the ceiling
         * test on the previous line ran, so a scrum could re-enter FORM
         * indefinitely: each pass through rolled a fresh early engage, and the
         * `>= 2` test always saw the pre-increment value. Test after the
         * increment, and cap hard. */
        if (R() < 0.04 + (1 - d.teams[dTeam].nation.att.discipline / 100) * 0.08) {
          s.resets++;
          if (s.resets >= 2) {
            d.beginPenalty(feed, 'FREE KICK — REPEAT EARLY ENGAGE', 3, true);
            return;
          }
          d.lawCall('EARLY_ENGAGE', REFEREE_CALLS.EARLY_ENGAGE, dTeam);
          s.stage = 'FORM'; s.t = 0;
          return;
        }
      }
      break;
    case 'SET':
      s.cadence = 'ENGAGE';
      if (s.t > 0.25) { s.stage = 'ENGAGE'; s.t = 0; d.shake(0.55); }
      break;
    case 'ENGAGE':
      s.cadence = 'SETTLED';
      if (s.t > 0.2) { s.stage = 'STEADY'; s.t = 0; }
      break;
    case 'STEADY':
      s.cadence = 'BALL IN';
      if (s.t > 0.2) { s.stage = 'FEED'; s.t = 0; s.ball = { x: 0, y: 0.16, z: 0.2, state: 'LIVE' }; }
      break;
    case 'FEED': {
      s.cadence = 'BALL IN';
      if (s.t > 0.3) {
        s.stage = 'STRIKE'; s.t = 0; s.cadence = 'STRIKE';
        const sq = d.options.scrumFeed ?? 1;
        if (sq === 0 && R() < 0.32) { d.beginPenalty(dTeam, 'FREE KICK — FEED NOT STRAIGHT', 2, true); return; }
      }
      break;
    }
    case 'STRIKE':
    case 'DRIVE': {
      s.stage = 'DRIVE';
      s.cadence = 'DRIVE';
      const manual = (d.options.scrumWaggle ?? 0) === 0;
      if (d.isHuman(feed)) {
        if (manual) {
          if (pressed.has('left')) s.packs[feed].waggle += 1;
          if (pressed.has('right')) s.packs[feed].waggle += 1;
        } else {
          s.packs[feed].waggle += dt * 8;
        }
      } else {
        s.packs[feed].waggle += dt * (6 + diff.reaction * 8);
      }
      s.packs[dTeam].waggle += dt * (5.5 + diff.reaction * 7.5);

      const F = (t: 'A' | 'B') => {
        const base = 4600 + s.packs[t].fitness * 26;
        const w = clamp(s.packs[t].waggle, 0, 60);
        return base * (0.72 + (w / 60) * 0.34);
      };
      s.packs.A.forceTransmitted = F('A');
      s.packs.B.forceTransmitted = F('B');
      const fa = s.packs.A.forceTransmitted * (feed === 'A' ? 1.06 : 0.94);
      const fb = s.packs.B.forceTransmitted * (feed === 'B' ? 1.06 : 0.94);
      const net = (fa - fb) / 5200;
      s.netDrive += net * dt * 0.42;
      s.yaw = approach(s.yaw, clamp(net * 26 * s.wheelDir, -45, 45), 1.1, dt);
      s.collapseRisk = clamp(0.04 + Math.abs(net) * 0.42, 0, 1);
      s.ball.z = clamp(s.ball.z - (feed === 'A' ? 1 : -1) * dt * 1.6 + net * dt * 0.8, -1.6, 1.6);

      if (Math.abs(s.yaw) > 45) {
        d.lawCall('WHEEL_90', 'PENALTY — WHEELED PAST 90°', s.feed === 'A' ? 'B' : 'A');
        d.beginPenalty(dTeam, 'PENALTY — WHEELED PAST 90°', 3);
        return;
      }
      if (R() < dt * s.collapseRisk * 0.1) {
        d.lawCall('COLLAPSE', REFEREE_CALLS.COLLAPSE, s.feed === 'A' ? 'B' : 'A');
        d.beginPenalty(dTeam, REFEREE_CALLS.COLLAPSE, 3);
        return;
      }
      if (s.t > 0.9) { s.stage = 'BASE'; s.t = 0; }
      break;
    }
    case 'BASE':
      s.cadence = 'USE IT';
      if (s.t > 0.3) {
        s.stage = 'OUT'; s.t = 0;
        const against = s.netDrive < -0.35 && R() < 0.42;
        const winner = against ? dTeam : feed;
        if (against) {
          d.teams[dTeam].stats.scrumsWon++;
          d.teams[feed].stats.scrumsLost++;
          d.commentate('TURNOVER', '— AGAINST THE HEAD');
        } else {
          d.teams[feed].stats.scrumsWon++;
        }
        d.scrim = undefined;
        /* PLAYTEST 4: the mark is the nine's own base slot (2.95) — he has
         * stood there through the drive, so the hand-off reads as a pick-up
         * at the back of the scrum, not a teleport to the tunnel. */
        d.startOpen(winner, ax.x + (winner === 'A' ? -0.3 : 0.3), ax.z + (winner === 'A' ? -2.95 : 2.95), 9, 1, 0, 0.55);
      }
      break;
    default: break;
  }
  void input;
}

export function scrumSlots(_d: Director, feed: 'A' | 'B', ax: number, az: number): ScrumSlot[] {
  /* T-11 void audit: frozen-interface param — the slots are symmetric and the
   * feed side is the caller's knowledge (startScrum places and drives). */
  const out: ScrumSlot[] = [];
  const rows = [[1, 2, 3], [4, 5, 6], [7, 8]];
  for (const t of ['A', 'B'] as const) {
    const back = t === 'A' ? -1 : 1;
    rows.forEach((row, ri) => {
      row.forEach((num, ci) => {
        out.push({
          num, team: t, row: ri + 1, down: false,
          x: ax + (ci - (row.length - 1) / 2) * 0.68,
          z: az + back * (0.62 + ri * 0.66),
        });
      });
    });
  }
  /* T-11 void audit: frozen-interface param — the slots are symmetric and
   * the feed side is the caller's knowledge (startScrum places and drives). */
  void feed;
  return out;
}

export function upLineout(d: Director, dt: number, input: Input, pressed: Set<string>) {

  const s = d.lo!;
  s.t += dt;
  const human = d.isHuman(s.thrower);
  const diff = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)];

  if (s.stage === 'ASSEMBLE') {
    let arrived = 0, count = 0;
    for (const slot of s.players) {
      const p = d.L(slot.team, slot.num);
      if (p.sinbin > 0) continue;
      count++;
      if (Math.hypot(p.x - slot.x, p.z - slot.z) < 1.3) arrived++;
    }
    s.ready = count ? arrived / count : 1;
    /* NO-TELEPORT: the force-advance used to fire at 2.0 s while men were
     * still 15 m out; the throw then went up against a half-formed line and
     * the contest pin teleported the rest in. Give the walk-on time to
     * actually finish (see also the contest pin, which never snaps now). */
    if (s.ready > 0.82 || s.t > 2.2) { s.stage = 'CALL'; s.t = 0; }
    return;
  }

  if (s.stage === 'CALL') {
    if (human) {
      if (pressed.has('left')) s.callIdx = (s.callIdx + 3) % 4;
      if (pressed.has('right')) s.callIdx = (s.callIdx + 1) % 4;
      if (pressed.has('action')) { s.stage = 'THROW'; s.t = 0; s.meterOn = true; s.meter = 0; s.meterDir = 1; }
    } else {
      /* SCORING PASS — the call reads the field. A five-metre lineout exists
       * to be driven over; calling MIDDLE/TAIL there at the same rate as a
       * midfield half-way line threw away the most reliable try in rugby.
       * In the attacking 22 the CPU leans to the drive calls; further out
       * the spread stays honest. */
      const att22 = Math.abs(s.markZ) > 36 && (s.thrower === 'A' ? s.markZ > 0 : s.markZ < 0);
      const driveIdx = LO_DRIVE_CALLS[Math.floor(R() * LO_DRIVE_CALLS.length)];
      s.callIdx = att22 && R() < 0.72 ? driveIdx : Math.floor(R() * 4);
      if (s.t > 0.35) { s.stage = 'THROW'; s.t = 0; s.meterOn = true; }
    }
    const c = Director.LO_CALLS[s.callIdx];
    const thr = s.players.find((p) => p.role === 'THROWER')!;
    const side = thr.x >= 0 ? 1 : -1;
    s.call = { targetX: side * (31.2 - Math.abs(c.targetX) * 0.72), label: c.label, jumpers: c.jumpers, kind: c.kind };
    /* T-18. The middle call drives the maul; inside the ten a tail call
     * drives too — a five-metre lineout exists to be driven over. */
    const nearLine = Math.abs(s.markZ) > 36;
    s.driveCall = c.kind === 'MIDDLE' || (nearLine && (c.kind === 'TAIL' || c.kind === 'MIDDLE'));
  } else if (s.stage === 'THROW') {
    if (human) {
      if (s.meterOn) {
        s.meter += s.meterDir * dt * 1.35;
        if (s.meter > 1) { s.meter = 1; s.meterDir = -1; }
        if (s.meter < 0) { s.meter = 0; s.meterDir = 1; }
        if (pressed.has('action')) { s.meterOn = false; d.releaseThrow(); }
      }
    } else {
      s.meter = 0.62 + (R() - 0.5) * (1 - diff.reaction) * 1.4;
      if (s.t > 0.3) d.releaseThrow();
    }
  } else if (s.stage === 'CONTEST') {
    s.ball.vy -= 9.81 * dt;
    s.ball.x += s.ball.vx * dt;
    s.ball.y += s.ball.vy * dt;
    s.history.push({ ballX: s.ball.x, ballY: s.ball.y });
    if (s.history.length > 90) s.history.shift();
    s.ball.apexY = Math.max(s.ball.apexY, s.ball.y);
    if (s.ball.y <= 2.4 && s.ball.vy < 0) { s.stage = 'CATCH'; s.t = 0; }
  } else if (s.stage === 'CATCH') {
    if (s.t > 0.4) {
      /* T-16 FREEZE. Two bugs lived here.
       *
       * 1. `s.players.find(...)!` — a non-null assertion. With a sin-binned or
       *    mis-numbered jumper the find returned undefined and the next line
       *    threw, killing the update loop mid-frame and freezing the match.
       * 2. When the defence won the contest but neither the steal roll nor the
       *    not-straight test fired, control fell through to the thrower-wins
       *    path — awarding the ball to the side that just lost it, and
       *    incrementing lineoutsWon for BOTH teams.
       *
       * Every branch below now terminates in a phase transition. There is no
       * fall-through, and no assertion. */
      s.winner = true;
      const dTeam: 'A' | 'B' = s.thrower === 'A' ? 'B' : 'A';
      /* T-06 — THE LIFT IS MECHANICAL. The catch is not a dice roll: each
       * side's best jumper at the ball's plane rises to an EFFECTIVE REACH
       * — base spring, plus the lift (mean power of the designated
       * lifters, scaled by having both of them and by jump timing), minus
       * the stretch of reaching away laterally. The thrower's jumper jumps
       * on the call (timing follows throw quality); the defence reacts.
       * Whoever reaches higher at the plane takes it. */
      const reachOf = (team: 'A' | 'B') => {
        const js = s.players.filter((q) => q.team === team && q.role === 'JUMPER');
        if (!js.length) return 0;
        js.sort((a, b) => Math.abs(a.x - s.ball.x) - Math.abs(b.x - s.ball.x));
        const q = js[0];
        const live = d.L(team, q.num);
        const lifters = s.players.filter((w) => w.team === team && w.role === 'LIFTER'
          && d.L(team, w.num).sinbin <= 0);
        const pows = lifters.map((w) => d.L(team, w.num).attrs.PWR);
        const liftQ = pows.length ? pows.reduce((a, b) => a + b, 0) / pows.length / 100 : 0;
        const both = Math.min(1, pows.length / 2);
        const stretch = Math.min(0.5, Math.abs(q.x - s.ball.x) * 0.12);
        const tech = d.teams[team].nation.att.lineout / 100 * 0.12;
        const timing = team === s.thrower ? 0.25 + s.quality * 0.75 : 0.78;
        return 2.4 + live.attrs.PWR / 100 * 0.1 + liftQ * both * 0.9 * timing + tech - stretch;
      };
      /* No two jumps are timed alike: a hand-span of noise on each side,
       * so an even battle is a contest, not a formality. */
      const margin = reachOf(s.thrower) - reachOf(dTeam) + (s.quality - 0.5) * 0.3 + (R() - 0.5) * 0.34;
      s.contestMargin = margin;
      const won = margin > 0 || (margin === 0 && R() < 0.6);
      const bx = s.ball.x, bz = s.markZ, drive = s.driveCall, thrower = s.thrower;

      // A badly crooked throw is a free kick regardless of who caught it.
      if (s.quality < 0.25) {
        d.lawCall('NOT_STRAIGHT', REFEREE_CALLS.NOT_STRAIGHT, thrower);
        d.teams[thrower].stats.lineoutsLost++;
        d.lo = undefined;
        d.startLineout(dTeam, bz, bx);
        return;
      }

      if (!won) {
        d.teams[dTeam].stats.lineoutsWon++;
        d.teams[thrower].stats.lineoutsLost++;
        d.commentate('LINEOUT', '— STOLEN AT THE TAIL');
        d.lo = undefined;
        d.startOpen(dTeam, bx, bz, 9, 1, 0, 0.45);
        return;
      }

      d.teams[thrower].stats.lineoutsWon++;
      s.ball.state = 'HELD';
      const jumper = s.players.find((p) => p.team === thrower && p.role === 'JUMPER');
      if (jumper) { s.ball.heldBy = jumper.id; jumper.handY = 2.6; }
      d.lo = undefined;
      if (drive) { d.startMaul(thrower, bx, bz, 5, true); return; }
      d.startOpen(thrower, bx, bz, 10, 1, 0, 0.45);
      return;
    }
  }
  void input;
  for (const p of s.players) {
    if (p.role === 'JUMPER') {
      const contesting = s.stage === 'CONTEST' || s.stage === 'CATCH';
      const target = contesting ? (Math.abs(p.x - s.ball.x) < 1.6 ? s.ball.y : 0.4) : 0.4;
      p.handY = approach(p.handY, target, 6, dt);
    } else if (p.role === 'LIFTER') {
      /* T-06: one shared timeline — the lifters' hands rise with their own
       * jumper, half a beat behind him, instead of animating alone. */
      const near = s.players
        .filter((q) => q.team === p.team && q.role === 'JUMPER')
        .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
      if (near) p.handY = approach(p.handY, near.handY * 0.5, 6, dt);
    }
  }
}

export function releaseThrow(d: Director, ) {

  const s = d.lo!;
  s.quality = clamp(1 - Math.abs(s.meter - 0.62) * 2.1, 0, 1);
  s.meterOn = false;
  s.ball.state = 'FLIGHT';
  s.stage = 'CONTEST'; s.t = 0;
  const from = s.players.find((p) => p.role === 'THROWER')!;
  const dx = s.call.targetX - from.x;
  const flight = 1.15;
  s.ball.vx = dx / flight;
  s.ball.vy = (4.4 - 1.6) / flight + 0.5 * 9.81 * flight;
  s.ball.apexY = 1.6;
  d.say(`${s.call.label} — THE THROW GOES IN`);
}

/* ============================ SPEC_03 — MAUL RE-GATE + EXITS ============================ */

/* These are animation/readability beats only. They never enter the pure contest
 * resolver: that resolver receives just readRate and four closed inputs. */
const MAUL_EXIT_SECONDS: Record<Exclude<MaulExitState, 'NONE'>, number> = {
  PICK_AND_GO: 0.22,
  WHEEL_AND_PEEL: 0.24,
  TRANSFER_TO_9: 0.56,
  UNPLAYABLE_SCRUM: 0.22,
  TOUCH_LINEOUT: 0.22,
  PENALTY_AWARDED: 0.22,
  TRY_AWARDED: 0.22,
};
const MAUL_CPU_PICK_AT = 4.4;
const MAUL_AUTO_EXIT_AT = 6.0;
const MAUL_NO_LIMIT_SAFETY_AT = 15.0;
const MAUL_PICK_ORDER = [8, 7, 6, 5, 4, 3, 2, 1] as const;

type MaulExit = Exclude<MaulExitState, 'NONE'>;

function maulRunner(d: Director, team: 'A' | 'B', requested: number): number | null {
  const p = d.live.find((q) => q.team === team && q.num === requested && q.sinbin <= 0 && !q.down);
  return p ? requested : null;
}

/** Deterministic roster order; deliberately never selects a player by distance. */
function maulPicker(d: Director, team: 'A' | 'B'): number {
  for (const num of MAUL_PICK_ORDER) {
    const runner = maulRunner(d, team, num);
    if (runner !== null) return runner;
  }
  // A legal maul always has a forward. This keeps the state total if a test
  // fixture has removed every one of them; startOpen's normal watchdog owns it.
  return 8;
}

function beginMaulExit(
  s: MaulState,
  exit: MaulExit,
  runner = 0,
  lane: 'LEFT' | 'RIGHT' | null = null,
) {
  if (s.exit !== 'NONE') return;
  s.exit = exit;
  s.stage = 'EXIT';
  s.exitT = 0;
  s.exitRunner = runner;
  s.exitLane = lane;
  /* Capture a stable legal mark for terminal law hand-offs. Runner exits use
   * their actual later position at completion so startOpen never teleports one
   * from a bound rank. This coordinate is not an input to contest resolution. */
  s.exitX = s.x;
  s.exitZ = s.z;
  if (exit === 'PICK_AND_GO' || exit === 'WHEEL_AND_PEEL' || exit === 'TRANSFER_TO_9') {
    s.ballRank = s.ranks - 1;
  }
  if (exit === 'UNPLAYABLE_SCRUM') s.useItCalled = true;
}

function finishMaulExit(d: Director, s: MaulState, atk: 'A' | 'B', def: 'A' | 'B') {
  const exit = s.exit;
  if (exit === 'NONE') return;
  const runner = s.exitRunner > 0 ? maulRunner(d, atk, s.exitRunner) : null;
  const x = runner === null ? s.exitX : d.L(atk, runner).x;
  const z = runner === null ? s.exitZ : d.L(atk, runner).z;

  switch (exit) {
    case 'PICK_AND_GO':
    case 'WHEEL_AND_PEEL':
    case 'TRANSFER_TO_9':
      d.clearRuck();
      d.startOpen(atk, x, z, runner ?? maulPicker(d, atk), 1, 0, 0.6);
      return;
    case 'UNPLAYABLE_SCRUM':
      d.lawCall('MAUL_STOPPED', REFEREE_CALLS.MAUL_STOPPED, def);
      d.clearRuck();
      d.startScrum(def, s.exitX, s.exitZ);
      return;
    case 'TOUCH_LINEOUT':
      d.say('THE MAUL IS DRAGGED INTO TOUCH');
      d.clearRuck();
      d.startLineout(def, s.exitZ, (Math.sign(s.exitX) || 1) * 6);
      return;
    case 'PENALTY_AWARDED':
      d.beginPenalty(def, 'PENALTY — MAUL STOPPED TWICE', 8);
      return;
    case 'TRY_AWARDED':
      d.clearRuck();
      d.scoreTry();
      return;
  }
}

/** The first A/D edge resolves one window: a direction or an ambiguous NONE. */
function captureMaulRegateEdge(s: MaulState, pressed: Set<string>) {
  if (s.contest !== 'PENDING' || s.regateCandidate !== null) return;
  const left = pressed.has('left');
  const right = pressed.has('right');
  /* A simultaneous A/D edge consumes this window as NONE. Letting a later
   * clean edge replace it would turn an ambiguous commit into an advantage. */
  if (left && right) { s.regateCandidate = 'NONE'; return; }
  if (!left && !right) return;
  s.regateCandidate = left ? 'LEFT' : 'RIGHT';
}

/**
 * Close input windows and call the pure resolver exactly once. No state from the
 * drive simulation is passed to it; this is the one-way wall around the contest.
 */
function advanceMaulRegate(d: Director, s: MaulState, dt: number, atk: 'A' | 'B'): boolean {
  if (s.contest !== 'PENDING' || s.humanTeam === null) return false;
  s.regateWindowT += dt;
  while (s.regateWindowT >= MAUL_REGATE_WINDOW_SECONDS && s.regateWindows.length < MAUL_REGATE_WINDOW_COUNT) {
    s.regateWindowT -= MAUL_REGATE_WINDOW_SECONDS;
    s.regateWindows.push(s.regateCandidate ?? 'NONE');
    s.regateCandidate = null;
  }
  if (s.regateWindows.length !== MAUL_REGATE_WINDOW_COUNT) return false;

  const readRate = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)].readRate;
  const result = resolveMaulRegate({ readRate, windows: s.regateWindows });
  s.humanWinShare = result.humanWinShare;
  s.humanWon = result.humanWon;
  const attackControls = (s.humanTeam === atk) === result.humanWon;
  s.contest = attackControls ? 'ATTACK_CONTROL' : 'DEFENCE_CONTROL';
  s.stage = attackControls ? 'ATTACK_CONTROL' : 'DEFENCE_HOLD';
  d.showHint(attackControls ? 'MAUL WON — CALL THE EXIT' : 'THEY HAVE HELD IT UP — WAIT FOR USE IT', 1.8);
  return true;
}

function requestTransferOrPick(d: Director, s: MaulState, atk: 'A' | 'B') {
  const nine = maulRunner(d, atk, 9);
  if (nine !== null) beginMaulExit(s, 'TRANSFER_TO_9', nine);
  else beginMaulExit(s, 'PICK_AND_GO', maulPicker(d, atk));
}

/** Human actions map to the approved explicit exits, never to a generic release. */
function requestHumanMaulExit(d: Director, s: MaulState, atk: 'A' | 'B', pressed: Set<string>): boolean {
  if (!d.isHuman(atk) || s.contest !== 'ATTACK_CONTROL') return false;
  if (pressed.has('kick')) {
    beginMaulExit(s, 'PICK_AND_GO', maulPicker(d, atk));
    return true;
  }
  if (pressed.has('action')) {
    requestTransferOrPick(d, s, atk);
    return true;
  }
  const left = pressed.has('left');
  const right = pressed.has('right');
  if (left === right) return false;
  const lane = left ? 'LEFT' : 'RIGHT';
  const requested = left ? 6 : 7;
  const runner = maulRunner(d, atk, requested);
  if (runner !== null) beginMaulExit(s, 'WHEEL_AND_PEEL', runner, lane);
  else beginMaulExit(s, 'PICK_AND_GO', maulPicker(d, atk));
  return true;
}

/** CPU decisions are fixed timing/call choices; they never use force or RNG. */
function requestCpuMaulExit(d: Director, s: MaulState, atk: 'A' | 'B') {
  if (d.isHuman(atk) || s.contest !== 'ATTACK_CONTROL') return;
  if (s.fromLineout && s.t >= MAUL_CPU_PICK_AT) {
    beginMaulExit(s, 'PICK_AND_GO', maulPicker(d, atk));
    return;
  }
  if (s.t >= MAUL_AUTO_EXIT_AT) requestTransferOrPick(d, s, atk);
}

function updateMaulStall(d: Director, s: MaulState, dt: number): boolean {
  if (Math.abs(s.speed) >= 0.12) {
    s.stallClock = Math.max(0, s.stallClock - dt * 1.5);
    return false;
  }
  s.stallClock += dt;
  if (s.stallClock > 3 && !s.warned) {
    s.warned = true;
    s.useItCalled = true;
    d.showHint('USE IT — THE MAUL HAS STOPPED', 2.4);
  }
  if (s.stallClock <= 5 || s.contest !== 'DEFENCE_CONTROL') return false;

  const law = d.options.maulLaw ?? 0;
  if (law === 1 && !s.stoppedOnce) {
    s.stoppedOnce = true;
    s.stallClock = 0;
    s.warned = false;
    d.showHint('STOPPED ONCE — USE IT OR LOSE IT', 2.2);
    return false;
  }
  if (law === 2) {
    s.stoppedOnce = true;
    s.stallClock = 0;
    s.warned = false;
    return false;
  }
  beginMaulExit(s, law === 1 ? 'PENALTY_AWARDED' : 'UNPLAYABLE_SCRUM');
  return true;
}

export function upMaul(d: Director, dt: number, input: Input, pressed: Set<string>) {
  const s = d.ml!;
  s.t += dt;
  /* The maul owns its two sides. Possession can change in a law hand-off, but
   * must never make a maul defend itself. */
  const atk = s.attacking;
  const def: 'A' | 'B' = atk === 'A' ? 'B' : 'A';

  // A terminal route is write-once. While its clip beat plays, no force, law,
  // input, or random branch can select a second route.
  if (s.exit !== 'NONE') {
    s.exitT += dt;
    if (s.exitT >= MAUL_EXIT_SECONDS[s.exit]) finishMaulExit(d, s, atk, def);
    return;
  }

  if (s.contest === 'PENDING') captureMaulRegateEdge(s, pressed);

  /* Legacy physical drive remains visual/location progression only. Neither
   * force nor its dependent values can enter resolveMaulRegate(). Human A/D is
   * intentionally absent here: it is consumed only as a commit-window edge. */
  const commit = clamp(1 + Math.round((d.slider(atk, 'setPiece') / 100) * 4), 1, 6);
  s.committed = commit;
  if (!d.isHuman(atk)) {
    s.forceA += dt * (200 + DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)].reaction * 420);
  }
  const lineoutDrive = s.fromLineout ? 1900 : 0;
  s.forceA = approach(s.forceA, 2600 + lineoutDrive + d.teams[atk].nation.att.maul * 26 + commit * 320, 2.2, dt);
  s.forceD = approach(s.forceD, 2400 + d.teams[def].nation.att.maul * 24 + (6 - commit) * 300, 1.6, dt);

  const net = (s.forceA - s.forceD) / 1400;
  if (s.contest === 'DEFENCE_CONTROL') {
    // The re-gate may direct presentation into a held-up maul, but force is not
    // consulted to award that control or to reverse it once it is locked.
    s.speed = approach(s.speed, 0, 6, dt);
    s.yaw = approach(s.yaw, 0, 3, dt);
  } else {
    s.speed = approach(s.speed, clamp(net, -0.5, 1.15), 3, dt);
    s.yaw = approach(s.yaw, clamp(net * 12, -22, 22), 1.2, dt);
  }
  s.z += s.speed * dt;
  s.gained += Math.max(0, s.speed * dt);
  s.x += Math.sin((s.yaw * Math.PI) / 180) * dt * 0.6;

  /* Legal physical boundary events are terminal exits, not contest evidence.
   * They have priority over a same-frame re-gate completion or exit request. */
  if ((s.dir > 0 && s.z >= s.tryLineZ) || (s.dir < 0 && s.z <= s.tryLineZ)) {
    beginMaulExit(s, 'TRY_AWARDED');
    return;
  }
  if (Math.abs(s.z) > 48 && s.gained > 0.5) {
    beginMaulExit(s, 'TOUCH_LINEOUT');
    return;
  }
  /* NO LIMIT still needs a deterministic safety hand-off before the 18 s
   * watchdog ceiling. It is a fixed law-clock exit, never a force outcome. */
  if (s.contest === 'DEFENCE_CONTROL' && (d.options.maulLaw ?? 0) === 2 && s.t >= MAUL_NO_LIMIT_SAFETY_AT) {
    beginMaulExit(s, 'UNPLAYABLE_SCRUM');
    return;
  }
  if (updateMaulStall(d, s, dt)) return;

  // The result becomes immutable when window four closes. Requests wait until
  // the following frame, so the final A/D commit cannot double as a peel call.
  if (advanceMaulRegate(d, s, dt, atk)) return;

  if (requestHumanMaulExit(d, s, atk, pressed)) return;
  requestCpuMaulExit(d, s, atk);

  /* The former t > 8 generic release is intentionally gone. A winning attack
   * gets one explicit deterministic no-request fallback at six seconds. */
  if (s.exit === 'NONE' && s.contest === 'ATTACK_CONTROL' && s.t >= MAUL_AUTO_EXIT_AT) {
    requestTransferOrPick(d, s, atk);
  }
  void input;
}
