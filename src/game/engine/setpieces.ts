/**
 * T-03 — ENGINE/SETPIECES. Extracted verbatim from director.ts: the scrum
 * (slots, the engage sequence, the drive), the lineout (assembly, the throw,
 * the T-06 mechanical lift contest) and the maul. No behaviour change; each
 * function takes a Director reference.
 */

import { stepBall, touchBall } from './ballPhysics';
import { Director, ScrumSlot, ScrumState, Input, MaulState } from '../director';
import { DIFFICULTY_TABLE, REFEREE_CALLS } from '../data';
import { R } from './rng';
import { clamp } from './clamp';
import {
  scrumBlock, scrumCadencePose, scrumStageDuration, scrumHipY,
  SCRUM_COLLAPSE, scrumRowDepth, scrumNineDepth,
} from '../behaviour/setpiece-overrides';
import {
  engineRoomFactor, stabilisedCollapseRisk, eightPicksFromScrum, liftersFor, forwardMass,
  packDriveVector, driveShearDeg, shearedToCollapse,
} from './forwardPack';
import {
  judgeLineoutThrow, stepMaulStall, maulUseItRemaining, maulCollapseHazard,
  type MaulStallFrame,
} from './referee';
import { maulLawIndex } from './laws';
import { teardownMaul } from './breakdown';
import { FIELD } from '../../render/retro';
import { approach } from './approach';
import {
  MAUL_REGATE_WINDOW_COUNT,
  MAUL_REGATE_WINDOW_SECONDS,
  MAUL_RANKS_PER_SIDE,
  resolveMaulRegate,
  channelBallRank, maulClusterNet, stepMaulClusterSpeed,
} from '../maulRegate';
import type { MaulBind, MaulExitState } from '../maulRegate';

/**
 * FORWARD PACK — the two lifters bound to a jumper: the men immediately in
 * front of and behind him in his team's line (ordered by position along the
 * line), each of whom must be a LIFTER. Pure over the lineout roster.
 */
function podLifters<T extends { num: number; team: 'A' | 'B'; x: number; role: string }>(
  players: T[], team: 'A' | 'B', jumperNum: number,
): T[] {
  const line = players.filter((q) => q.team === team && (q.role === 'JUMPER' || q.role === 'LIFTER'))
    .sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  const idx = line.findIndex((q) => q.num === jumperNum);
  if (idx < 0) return [];
  const nums = liftersFor(line.map((q) => q.num), idx);
  return line.filter((q) => nums.includes(q.num));
}

/** The calls that exist to be driven — the index set the CPU leans on in
 * the attacking 22, where a five-metre lineout is a try invitation. */
const LO_DRIVE_CALLS = [1, 3, 1, 2];

/* ==================== PART 1 — THE KINEMATIC SHOVE ==================== */

/** One pack as a single aggregate body in the shove contest. */
export interface PackShove {
  /** the summed body mass of the pack's eight forwards, kg. */
  mass: number;
  /** the drive vector along the engagement axis, summed over the pack's
   *  eight (who pushes is PACK_DRIVE_SHARE below). */
  drive: number;
  /** 0..1 — how bound and how low the front row is this frame (placeBound
   *  measures it; engine/forwardPack.ts). */
  stability: number;
}

/** The reference pack: eight 88 + 75·0.22 kg forwards. The contest is a
 *  comparison of SPECIFIC force — drive per kilogram against this mass —
 *  so a heavy pack is hard to push, not just hard to hold. */
export const SCRUM_MASS_REF = 8 * forwardMass(75);

/** Who actually pushes. The front row and the locks are the shove: the
 *  props anchor, the hooker spends his pull on the strike, the flankers
 *  bind and nudge, the eight holds the base for the ball. The shares sum
 *  to one, so the summed drive stays comparable to the pack's old
 *  single-aggregate force. */
const PACK_DRIVE_SHARE: Record<number, number> = { 1: 0.21, 2: 0.14, 3: 0.21, 4: 0.17, 5: 0.17, 6: 0.05, 7: 0.05, 8: 0.0 };

/** Force transmission through the bind: a bound, low front row passes the
 *  hips' drive into the tunnel; a front row still shuffling for its seat
 *  leaks up to 30% of it into slack and noise. */
export function shoveTransmission(stability: number): number {
  return 0.7 + 0.3 * clamp(stability, 0, 1);
}

/**
 * The contest, in one net number. Each pack's drive vector is priced by
 * its summed mass (specific force against the reference pack) and by how
 * well its front row transmits, with the feed side's put-in advantage.
 * Positive = the A pack is winning the shove. Pure: no Director, no RNG —
 * the probe drives it with hand-built packs.
 */
export function scrumShoveNet(a: PackShove, b: PackShove, feed: 'A' | 'B'): number {
  const spec = (p: PackShove, bonus: number) => (p.drive * bonus * shoveTransmission(p.stability)) / (p.mass / SCRUM_MASS_REF);
  const fa = spec(a, feed === 'A' ? 1.06 : 0.94);
  const fb = spec(b, feed === 'B' ? 1.06 : 0.94);
  return (fa - fb) / 5200;
}

/** The tunnel's velocity target (m/s, +z) for a contest net: the rate the
 *  packs — and the ball, and the base — displace along the engagement axis
 *  while that net holds. */
export function scrumTunnelVelocity(net: number): number {
  return net * 0.42;
}

/**
 * Put a pack on the deck. One entry point for every cause, so the fold, the
 * `collapseSeen` flag the probes assert, and the referee's teardown cannot be
 * wired to one trigger and missed by another.
 */
function collapseScrum(
  d: Director, s: ScrumState, team: 'A' | 'B', why: string, shearDeg: number, hipY: number,
) {
  s.stage = 'COLLAPSE'; s.t = 0;
  s.collapseBlend = 0;
  s.collapseSeen = true;
  /* the bind has gone: the pose weight falls back with the bodies */
  s.bindPose = 0;
  s.collapse = {
    team, why, shearDeg, hipY,
    /* a collapsed front row is a prop's bind failure: name him. Floor collapse
     * is the hooker's height (he is the lowest man in the tunnel) unless the
     * pack lost a prop to the bin, in which case the bin is the reason. */
    offenderNum: why === 'HIP Y FLOOR' ? 2 : 1,
  };
  s.cadence = 'COLLAPSE';
  d.shake(0.85);
}

/** Closest jumper to the ball at the catch — he has it, then he taps it. */
function nearestLineoutJumper(s: { ball: { x: number }; players: { team: 'A' | 'B'; role: string; num: number; x: number }[] }, team: 'A' | 'B'): number {
  const js = s.players.filter((q) => q.team === team && q.role === 'JUMPER');
  if (!js.length) return 4;
  js.sort((a, b) => Math.abs(a.x - s.ball.x) - Math.abs(b.x - s.ball.x));
  return js[0].num;
}

/**
 * Off-the-top: the jumper has the ball at the catch, then it FLIES to 9
 * and 9 fires it to 10. Defence stays on the Law 18 ten-metre line until
 * that pass is halfway to the fly-half. Drive/maul never comes through here.
 */
function beginLineoutOpen(
  d: Director,
  team: 'A' | 'B',
  bx: number,
  bz: number,
  jumperNum: number,
  markZ: number,
  side: number,
) {
  for (const p of d.live) { p.bound = false; p.down = false; }
  d.startOpen(team, bx, bz, jumperNum, 1, 0, 0.45);
  const s = d.op;
  if (!s) return;
  s.lineoutHold = { markZ, side, firstNum: 10, released: false };
  const nine = d.L(team, 9);
  if (nine && nine.sinbin <= 0 && !nine.down) {
    s.lineoutTap = 'TO_NINE';
    d.launchPassFlight(bx, bz, 2.2, nine.x, nine.z, 9);
  } else {
    const ten = d.L(team, 10);
    s.lineoutTap = 'TO_TEN';
    d.launchPassFlight(bx, bz, 2.2, ten.x, ten.z, 10);
  }
}

export function upScrum(d: Director, dt: number, input: Input, pressed: Set<string>) {

  const s = d.scrim!;
  s.t += dt;
  /* THE ONE CLOCK. The pose weight is a function of where the pack stands in
   * the authored cadence, read from the same table the stage timers below walk,
   * so a bind can never be fully committed on screen a frame before the
   * referee has called SET (or a half-second after). */
  if (s.stage !== 'COLLAPSE') s.bindPose = scrumCadencePose(s.stage, s.t);
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
      if (s.t > scrumStageDuration('MARK')) { s.stage = 'FORM'; s.t = 0; }
      break;
    case 'FORM':
      s.cadence = 'CROUCH';
      if (s.t > scrumStageDuration('FORM')) { s.stage = 'CROUCH'; s.t = 0; }
      break;
    case 'CROUCH':
      s.cadence = 'TOUCH';
      if (s.t > scrumStageDuration('CROUCH')) { s.stage = 'BIND'; s.t = 0; }
      break;
    case 'BIND':
      s.cadence = 'PAUSE';
      if (s.t > scrumStageDuration('BIND')) {
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
      if (s.t > scrumStageDuration('SET')) { s.stage = 'ENGAGE'; s.t = 0; d.shake(0.55); }
      break;
    case 'ENGAGE':
      s.cadence = 'SETTLED';
      if (s.t > scrumStageDuration('ENGAGE')) { s.stage = 'STEADY'; s.t = 0; }
      break;
    case 'STEADY':
      s.cadence = 'BALL IN';
      if (s.t > scrumStageDuration('STEADY')) { s.stage = 'FEED'; s.t = 0; s.ball = { x: 0, y: 0.16, z: 0.2, state: 'LIVE' }; }
      break;
    case 'FEED': {
      s.cadence = 'BALL IN';
      if (s.t > scrumStageDuration('FEED')) {
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

      /* PART 1 — THE KINEMATIC SHOVE CONTEST. Each pack is one aggregate
       * body: the summed mass of its eight, the drive vector summed over
       * the eight, and the front-row stability placeBound measures every
       * frame. The net of the two specific forces is the contest; the
       * tunnel's velocity integrates toward its target and the displacement
       * is the integral of that — the packs, the ball and the base all move
       * with the tunnel (placeBound reads `netDrive`). */
      const mass = { A: 0, B: 0 };
      for (const slot of s.players) {
        const p = d.L(slot.team, slot.num);
        if (p.sinbin <= 0) mass[slot.team] += forwardMass(p.attrs.PWR);
      }
      const driveOf = (t: 'A' | 'B') => {
        const base = 4600 + s.packs[t].fitness * 26;
        const w = clamp(s.packs[t].waggle, 0, 60);
        /* FORWARD PACK — the engine room. The locks' power multiplies the
         * pack's transmitted force: a 4 and 5 who drive through the hips of
         * their props are worth up to 6% either way. */
        const eng = engineRoomFactor([d.L(t, 4), d.L(t, 5)].filter((p) => p.sinbin <= 0).map((p) => p.attrs.PWR));
        /* the drive vector: the shove summed over the eight, each man at
         * his share of the work and his own power. The per-man terms are kept,
         * not folded away: the same eight men are the pack's LATERAL balance as
         * well as its forward force, and a sum cannot tell you the difference. */
        let F = 0;
        const men: { num: number; x: number; drive: number }[] = [];
        for (const slot of s.players) {
          if (slot.team !== t) continue;
          const p = d.L(slot.team, slot.num);
          if (p.sinbin > 0) continue;
          const f = base * (0.72 + (w / 60) * 0.34) * eng * (PACK_DRIVE_SHARE[slot.num] ?? 0) * (0.9 + 0.2 * p.attrs.PWR / 100);
          F += f;
          men.push({ num: slot.num, x: slot.x, drive: f });
        }
        return { F, men };
      };
      const drvA = driveOf('A'), drvB = driveOf('B');
      s.packs.A.forceTransmitted = drvA.F;
      s.packs.B.forceTransmitted = drvB.F;
      const net = scrumShoveNet(
        { mass: mass.A, drive: drvA.F, stability: s.frontRowStability ?? 0 },
        { mass: mass.B, drive: drvB.F, stability: s.frontRowStability ?? 0 },
        feed,
      );
      s.tunnelV = approach(s.tunnelV, scrumTunnelVelocity(net), 3.5, dt);
      s.netDrive = clamp(s.netDrive + s.tunnelV * dt, -3.5, 3.5);
      s.yaw = approach(s.yaw, clamp(net * 26 * s.wheelDir, -45, 45), 1.1, dt);
      /* FORWARD PACK — a bound, low front row is a stable scrum. The raw
       * risk is the shove imbalance; the front rows' binding and centre of
       * mass (placeBound writes it) take up to 40% of it away. */
      s.collapseRisk = stabilisedCollapseRisk(clamp(0.04 + Math.abs(net) * 0.42, 0, 1), s.frontRowStability ?? 0);
      /* THE STRIKE — the feed side's hooker (2) punches the ball back
       * through the front row: his power sets how fast the tunnel opens,
       * the shove (net) sets which way it opens. */
      const hooker = d.L(feed, 2);
      const strike = 0.72 + (hooker.sinbin <= 0 ? hooker.attrs.PWR / 100 : 0.5) * 0.56;
      s.ball.z = clamp(s.ball.z - (feed === 'A' ? 1 : -1) * dt * 1.6 * strike + net * dt * 0.8, -1.6, 1.6);

      if (Math.abs(s.yaw) > 45) {
        d.lawCall('WHEEL_90', 'PENALTY — WHEELED PAST 90°', s.feed === 'A' ? 'B' : 'A');
        d.beginPenalty(dTeam, 'PENALTY — WHEELED PAST 90°', 3);
        return;
      }
      /* THE COLLAPSE. A scrum comes down for one of three reasons and the
       * engine now knows two of them: the drive vector shearing across the
       * tunnel, and a front row whose bind is not holding their hips up. The
       * contest roll is kept — a pack that is being pushed over the top of
       * them does come up — but it rolls through the SAME fold as the two
       * measured causes, so there is one collapse to render and one teardown
       * to referee, not a whistle with no bodies. */
      const dvA = packDriveVector(drvA.men), dvB = packDriveVector(drvB.men);
      const shA = driveShearDeg(dvA), shB = driveShearDeg(dvB);
      s.shearDeg = Math.max(shA, shB);
      /* the shear has to be held to count: see `shearedToCollapse` */
      if (Math.max(shA, shB) > SCRUM_COLLAPSE.SHEAR_DEG) s.shearT += dt; else s.shearT = 0;
      const rolled = R() < dt * s.collapseRisk * 0.1;
      const lowHip = s.frontRowHipY !== undefined && s.frontRowHipY < SCRUM_COLLAPSE.HIP_Y_FLOOR;
      /* the floor has to be held, for the same reason the shear does: a pack
       * that dips one frame is settling into its bind, not coming down */
      if (lowHip) s.hipT += dt; else s.hipT = 0;
      if ((lowHip && s.hipT >= SCRUM_COLLAPSE.HIP_HOLD_S)
        || shearedToCollapse(shA, s.shearT) || shearedToCollapse(shB, s.shearT) || rolled) {
        /* who is at fault: the pack that sheared, and if neither sheared the
         * pack that was being driven backwards. */
        const off: 'A' | 'B' = shA > shB ? 'A' : shB > shA ? 'B' : (net > 0 ? 'B' : 'A');
        collapseScrum(d, s, off, lowHip ? 'HIP Y FLOOR' : 'DRIVE SHEAR', Math.max(shA, shB),
          s.frontRowHipY ?? scrumHipY(1, 1));
        return;
      }
      if (s.t > scrumStageDuration('DRIVE')) { s.stage = 'BASE'; s.t = 0; }
      break;
    }
    case 'COLLAPSE': {
      /* THE FOLD. The pack is going down and the whistle follows it: the
       * teardown is deliberately AFTER the bodies have landed, because a
       * penalty awarded the frame a scrum collapses is a scrum that vanishes.
       * The shove stops, the ball is dead in the tunnel, and the renderer owns
       * nothing but `collapseBlend` — one number, so a stalled frame cannot
       * leave a pack half-folded. */
      s.cadence = 'COLLAPSE';
      s.collapseBlend = clamp(s.t / SCRUM_COLLAPSE.FOLD_S, 0, 1);
      s.tunnelV = 0;
      s.shearT = 0;
      s.hipT = 0;
      if (s.t > SCRUM_COLLAPSE.WHISTLE_S) {
        const off = s.collapse?.team ?? dTeam;
        d.lawCall('COLLAPSE', REFEREE_CALLS.COLLAPSE, off);
        d.beginPenalty(off === 'A' ? 'B' : 'A', REFEREE_CALLS.COLLAPSE, s.collapse?.offenderNum ?? 3);
        return;
      }
      break;
    }
    case 'BASE':
      s.cadence = 'USE IT';
      if (s.t > 0.3) {
        s.stage = 'OUT'; s.t = 0;
        const against = s.netDrive < -0.35 && R() < 0.42;
        const winner = against ? dTeam : feed;
        if (against) {
          d.recordSetPieceOutcome('scrums', dTeam, feed);
          d.commentate('TURNOVER', '— AGAINST THE HEAD');
        } else {
          d.recordSetPieceOutcome('scrums', feed);
        }
        d.scrim = undefined;
        /* FORWARD PACK — NUMBER 8 AT THE BASE. On our own feed, close to
         * their line (or on a deterministic one-in-five call elsewhere), the
         * eight picks from the base and goes himself instead of the nine
         * clearing it: the base slot is his own (row 3, ~1.94 m back), so
         * the hand-off is a pick-up where he already stands. A won-against-
         * the-head ball always goes to the nine — the eight is not there. */
        const eight = d.L(winner, 8);
        const toLine = Math.max(0, winner === 'A' ? FIELD.tryZFar - ax.z : ax.z - FIELD.tryZ);
        const pick = !against && eight.sinbin <= 0
          && eightPicksFromScrum(winner === feed, toLine, ax.x, ax.z)
          && (d.options.firstReceiver ?? 0) !== 1;
        /* KINEMATIC TUNNEL — the base moved with the packs: every mark the
         * ball leaves from carries the tunnel's displacement, or the eight
         * would pick up where the scrum STARTED, not where it ended. */
        if (pick) {
          d.say('EIGHT PICKS FROM THE BASE');
          d.startOpen(winner, ax.x, ax.z + (winner === 'A' ? -1 : 1) * scrumRowDepth(3) + s.netDrive, 8, 1, 0, 0.55);
          break;
        }
        /* PLAYTEST 4: the mark is the nine's own base slot (2.95) — he has
         * stood there through the drive, so the hand-off reads as a pick-up
         * at the back of the scrum, not a teleport to the tunnel. */
        d.startOpen(winner, ax.x + (winner === 'A' ? -0.3 : 0.3), ax.z + (winner === 'A' ? -1 : 1) * scrumNineDepth() + s.netDrive, 9, 1, 0, 0.55);
      }
      break;
    default: break;
  }
  void input;
}

export function scrumSlots(d: Director, feed: 'A' | 'B', ax: number, az: number): ScrumSlot[] {
  /* T-11 void audit: frozen-interface param — the slots are symmetric and the
   * feed side is the caller's knowledge (startScrum places and drives). */
  /* PART 3 — THE 3-4-1 BLOCK, AND THE ENGAGEMENT AXIS.
   *
   * The old rows here were 3-3-2: the two flankers packed down in the back
   * row alongside the eight, which is not a scrum. The lawful pack is
   * 3-4-1 — front row, then the two locks bound between the two flankers,
   * then the eight alone at the base — and it is authored once, in
   * behaviour/setpiece-overrides.ts, together with the locked engagement
   * heading so the renderer and the engine cannot disagree about which way
   * the packs are pointing. Rows stack along z (down the pitch), never
   * across it: A packs from −z, B from +z, and they meet head-on. */
  /* TACTICAL KICKING / SIN BIN — a carded man is OFF THE FIELD and cannot
   * pack down. The slot is simply not created for him: a 14-man side packs
   * seven, which is what a real side does, and every downstream reader (the
   * mass sum, the bind lattice, placeBound's pin) sees a roster that matches
   * the bodies actually on the pitch instead of one with a hole in it. */
  const out: ScrumSlot[] = scrumBlock(ax, az)
    .filter((b) => d.L(b.team, b.num).sinbin <= 0)
    .map((b) => ({
      num: b.num, team: b.team, row: b.row, down: false, x: b.x, z: b.z,
    }));
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
    // A clean throw has only its measured release velocity and gravity.
    // The shared solver cannot add eccentricity before turf/player contact.
    stepBall(s.ball, dt);
    s.history.push({ ballX: s.ball.x, ballY: s.ball.y });
    if (s.history.length > 90) s.history.shift();
    s.ball.apexY = Math.max(s.ball.apexY, s.ball.y);
    if (s.ball.y <= 2.4 && s.ball.vy < 0) {
      // First player contact: the catch contest owns the ball, not free flight.
      touchBall(s.ball);
      s.ball.vx = s.ball.vy = s.ball.vz = 0;
      s.ball.omega.x = s.ball.omega.y = s.ball.omega.z = 0;
      s.stage = 'CATCH'; s.t = 0;
    }
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
        /* FORWARD PACK — THE LIFT TRIGGER. Only the two men bound either
         * side of the jumper at the ball lift him (the front and back lifter
         * of his pod); the rest of the line holds and is ready to peel. */
        const lifters = podLifters(s.players, team, q.num)
          .filter((w) => d.L(team, w.num).sinbin <= 0);
        const pows = lifters.map((w) => d.L(team, w.num).attrs.PWR);
        const liftQ = pows.length ? pows.reduce((a, b) => a + b, 0) / pows.length / 100 : 0;
        const both = Math.min(1, pows.length / 2);
        /* The stretch is the full distance in the plane: a ball that lands
         * wide of the jumper costs reach the same one as a ball that lands
         * off the tunnel line. */
        const stretch = Math.min(0.5, Math.hypot(q.x - s.ball.x, q.z - s.ball.z) * 0.12);
        const tech = d.teams[team].nation.att.lineout / 100 * 0.12;
        const timing = team === s.thrower ? 0.25 + s.quality * 0.75 : 0.78;
        return 2.4 + live.attrs.PWR / 100 * 0.1 + liftQ * both * 0.9 * timing + tech - stretch;
      };
      /* No two jumps are timed alike: a hand-span of noise on each side,
       * so an even battle is a contest, not a formality. */
      const margin = reachOf(s.thrower) - reachOf(dTeam) + (s.quality - 0.5) * 0.3 + (R() - 0.5) * 0.34;
      s.contestMargin = margin;
      const won = margin > 0 || (margin === 0 && R() < 0.6);
      /* The ball lands where it lands: a metered throw drifts off the
       * tunnel line, and the catch, the exits and a rethrow are all marked
       * at its real position. */
      const bx = s.ball.x, bz = s.ball.z, drive = s.driveCall, thrower = s.thrower;

      // A crooked throw is a free kick regardless of who caught it. The
      // referee judged the flight angle at release (engine/referee.ts,
      // Law 19); a dead-hooker throw fails its own quality test the same
      // way.
      if (s.throwCrooked || s.quality < 0.25) {
        d.lawCall('NOT_STRAIGHT', REFEREE_CALLS.NOT_STRAIGHT, thrower);
        d.recordSetPieceOutcome('lineouts', null, thrower);
        d.lo = undefined;
        d.startLineout(dTeam, bz, bx);
        return;
      }

      if (!won) {
        d.recordSetPieceOutcome('lineouts', dTeam, thrower);
        d.commentate('LINEOUT', '— STOLEN AT THE TAIL');
        const jumperNum = nearestLineoutJumper(s, dTeam);
        const markZ = s.markZ, side = s.side;
        d.lo = undefined;
        beginLineoutOpen(d, dTeam, bx, bz, jumperNum, markZ, side);
        return;
      }

      d.recordSetPieceOutcome('lineouts', thrower);
      touchBall(s.ball);
      s.ball.state = 'HELD';
      const jumper = s.players.find((p) => p.team === thrower && p.role === 'JUMPER');
      if (jumper) { s.ball.heldBy = jumper.id; jumper.handY = 2.6; }
      const jumperNum = nearestLineoutJumper(s, thrower);
      const markZ = s.markZ, side = s.side;
      d.lo = undefined;
      /* SPEC_03 — the cleanest maul birth in rugby: the jumper lands with
       * the ball and the pack is ALREADY around him, so the bound forward
       * drive starts the frame he touches grass. Full eight-rank cluster. */
      if (drive) { d.startMaul(thrower, bx, bz, MAUL_RANKS_PER_SIDE, true); return; }
      beginLineoutOpen(d, thrower, bx, bz, jumperNum, markZ, side);
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
       * jumper, half a beat behind him, instead of animating alone.
       * FORWARD PACK: a lifter goes up only with the jumper he is BOUND TO —
       * the man immediately beside him in the line; a lifter two pods away
       * holds his ground. */
      const contesting = s.stage === 'CONTEST' || s.stage === 'CATCH';
      const atBall = contesting ? s.players
        .filter((q) => q.team === p.team && q.role === 'JUMPER')
        .sort((a, b) => Math.abs(a.x - s.ball.x) - Math.abs(b.x - s.ball.x))[0] : undefined;
      const mine = atBall && podLifters(s.players, p.team, atBall.num).some((w) => w.num === p.num) ? atBall : undefined;
      p.handY = approach(p.handY, mine ? mine.handY * 0.5 : 0, 6, dt);
    }
  }
}

/** A meter off the sweet spot carries the ball this many metres off the
 * tunnel line per unit of meter error, measured at the catch plane — the
 * 1.15 s flight. This is the throw's geometry: the same meter that grades
 * the timing now angles the flight vector. */
export const LINEOUT_METER_DEV_M = 4.0;

export function releaseThrow(d: Director, ) {

  const s = d.lo!;
  s.quality = clamp(1 - Math.abs(s.meter - 0.62) * 2.1, 0, 1);
  s.meterOn = false;
  s.ball.state = 'FLIGHT';
  s.ball.socket = null;
  s.ball.flightGuard = true;
  s.ball.sleeping = false; s.ball.grounded = false; s.ball.bounces = 0; s.ball.quietTime = 0;
  s.ball.q.x = s.ball.q.y = s.ball.q.z = 0; s.ball.q.w = 1;
  s.ball.omega.x = -s.side * 12; s.ball.omega.y = s.ball.omega.z = 0;
  s.stage = 'CONTEST'; s.t = 0;
  const from = s.players.find((p) => p.role === 'THROWER')!;
  const dx = s.call.targetX - from.x;
  /* 1.15 s plus 25% hang — the throw sits up for the jump. */
  const flight = 1.15 * 1.25;
  s.ball.vx = dx / flight;
  s.ball.vy = (4.4 - 1.6) / flight + 0.5 * 9.81 * flight;
  /* THE METER HAS GEOMETRY. An early or late release leaves the ball off
   * the tunnel line — a real longitudinal component, so the throw is
   * judged on its flight angle as well as its timing. The referee's call
   * on that angle lives in engine/referee.ts (Law 19). */
  s.ball.vz = (s.meter - 0.62) * LINEOUT_METER_DEV_M / flight;
  s.throwAngle = Math.atan2(Math.abs(s.ball.vz), Math.abs(s.ball.vx));
  s.throwCrooked = judgeLineoutThrow(s.throwAngle);
  s.ball.apexY = 1.6;
  d.say(s.throwCrooked ? `${s.call.label} — THE THROW LEAVES THE TUNNEL` : `${s.call.label} — THE THROW GOES IN`);
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
/* SPEC_08: the stall ladder now resolves at the 3 s USE-IT warning plus the
 * 5 s extraction window the referee calls for (engine/referee.ts owns both
 * numbers): law 0 at ~8 s of stall, law 1 at ~16 s on the second stop. This
 * backstop is a pure watchdog for ANY law — fixed law-clock exit, never a
 * force outcome — sized a full ladder and a margin above the longest
 * lawful resolution. Named SAFETY on purpose: under the live laws it is
 * unreachable by design, which is exactly what a safety net should be. */
const MAUL_NO_LIMIT_SAFETY_AT = 20.0;
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

  /* SPEC_03 — every ball-out or whistle route runs ONE teardown funnel:
   * teardownMaul → teardownBreakdown → latch.releaseAll + the zero-leak
   * assertion. The contract is the probe's: 0 leaked joints, 0 bound men,
   * 0 drag links out of every maul, whatever the exit. (TRY and PENALTY
   * funnel through scoreTry()/beginPenalty()'s own releaseAll, which is
   * the same hardened path — the ledger lands on d.lastTeardownResidual.) */
  switch (exit) {
    case 'PICK_AND_GO':
    case 'WHEEL_AND_PEEL':
    case 'TRANSFER_TO_9':
      teardownMaul(d, `MAUL_${exit}`);
      d.startOpen(atk, x, z, runner ?? maulPicker(d, atk), 1, 0, 0.6);
      return;
    case 'UNPLAYABLE_SCRUM':
      /* SPEC_08 — Law 16.11 / Law 17: the turnover scrum goes to the
       * DEFENDING team, at the mark the maul stopped at. A legal collapse
       * arrives here the same way, under its own call text. */
      d.lawCall(
        s.collapsed ? 'MAUL_UNPLAYABLE' : 'MAUL_STOPPED',
        s.collapsed ? REFEREE_CALLS.MAUL_UNPLAYABLE : REFEREE_CALLS.MAUL_STOPPED,
        def,
      );
      teardownMaul(d, s.collapsed ? 'MAUL_COLLAPSED' : 'MAUL_UNPLAYABLE');
      d.startScrum(def, s.exitX, s.exitZ);
      return;
    case 'TOUCH_LINEOUT':
      d.say('THE MAUL IS DRAGGED INTO TOUCH');
      teardownMaul(d, 'MAUL_TOUCH');
      d.startLineout(def, s.exitZ, (Math.sign(s.exitX) || 1) * 6);
      return;
    case 'PENALTY_AWARDED':
      d.beginPenalty(def, 'PENALTY — MAUL STOPPED TWICE', 8);
      return;
    case 'TRY_AWARDED':
      /* scoreTry reads this.ml for the grounding spot, then releaseAll()
       * runs the funnel and writes the same residual ledger. */
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

/**
 * SPEC_08 — the referee's stall watch, delegated. The sequencing (warn at
 * 3 s without forward progress, whistle 5 s after the warn, the STOP TWICE
 * ladder) is the referee's own law and lives with him in
 * engine/referee.ts; this frame adapts the maul's contest state to his
 * MaulStallFrame and acts on his verdict. LAW-91 (warn before whistle in
 * every mode) holds by construction: the only path to the whistle runs
 * through the warn.
 */
function updateMaulStall(d: Director, s: MaulState, dt: number): boolean {
  const frame: MaulStallFrame = {
    speed: s.speed,
    stallClock: s.stallClock,
    warned: s.warned,
    stoppedOnce: s.stoppedOnce,
    defenceHeld: s.contest === 'DEFENCE_CONTROL',
    law: maulLawIndex(d.options.maulLaw),
  };
  const verdict = stepMaulStall(frame, dt);
  s.stallClock = frame.stallClock;
  s.warned = frame.warned;
  s.stoppedOnce = frame.stoppedOnce;
  switch (verdict) {
    case 'WARN_USE_IT':
      s.useItCalled = true;
      /* SPEC_08 (T-65): the call PERSISTS — it rides the ruck-countdown
       * channel (maulUseItClock/maulUseItCall below) every frame until the
       * maul resolves — and its engagement gets exactly one referee cue.
       * RC2-4: that cue is a SHOUT, not a whistle — the referee manages the
       * maul with his voice; the whistle stays sacred to stoppages. */
      d.audio.shout();
      d.refSay('USE IT!', 'NARRATIVE', 2.6);
      d.showHint('USE IT — THE MAUL HAS STOPPED', 2.4);
      return false;
    case 'STOP_ONCE':
      d.audio.shout();
      d.showHint('STOPPED ONCE — USE IT OR LOSE IT', 2.2);
      return false;
    case 'UNPLAYABLE':
      beginMaulExit(s, 'UNPLAYABLE_SCRUM');
      return true;
    case 'PENALTY_STOP':
      beginMaulExit(s, 'PENALTY_AWARDED');
      return true;
    default:
      return false;
  }
}

/* ================== SPEC_08 (T-65): THE USE-IT PRESENTATION ==================
 *
 * Playtest 2's rule: a countdown means TIME TO ACT, never ambient. The number
 * shown is therefore always the time to the REAL consequence of the state the
 * maul is in:
 *   - ATTACK control: the 6 s auto-exit — call your own exit (A/D peel,
 *     SPACE to 9, L pick) before the engine picks one for you;
 *   - DEFENCE control: the 5 s use-it whistle (scrum, or the penalty on the
 *     second stop under STOP TWICE).
 *
 * NO LIMIT (legacy maulLaw=2) was deprecated by human review 2026-09-03 —
 * see SPEC_08_MAULLAW2_DECISION.md: its only honest clock was a ~12 s wait
 * to the same scrum law 0 awards earlier, with no legal action for either
 * side, which is exactly the ambient countdown Playtest 2 bans.
 */
export function maulUseItClock(s: MaulState): number {
  if (s.contest === 'DEFENCE_CONTROL') return maulUseItRemaining(s.stallClock);
  return Math.max(0, MAUL_AUTO_EXIT_AT - s.t);
}

/**
 * The persistent USE IT call is live from the warn until the maul resolves
 * (an exit route begins). No new UI system: it is derived state, read each
 * frame by the same HUD `narrative` channel the ruck countdown lives in and
 * by the maul's in-world overlay.
 */
export function maulUseItCall(s: MaulState): boolean {
  return s.exit === 'NONE' && s.useItCalled && s.contest !== 'PENDING';
}

/**
 * SPEC_03 — BUILD THE BOUND CLUSTER. The two packs lock in as one
 * aggregate body: rank 1 is the head (the ball at formation), the shirt-8
 * rank is the tail (the hindmost foot — MAUL_PICK_ORDER peels tail-first
 * for exactly this reason). Mass comes off the same forwardMass table the
 * scrum weighs its packs with; the drive vectors are assigned per frame
 * in upMaul, so the summation in maulRegate always has honest per-man
 * contributions. Deliberately never distance-ordered: roster order is
 * the contract, matching the placement ranks the renderer lays down.
 */
export function buildMaulBinds(d: Director, attacking: 'A' | 'B', ranks: number): MaulBind[] {
  const def: 'A' | 'B' = attacking === 'A' ? 'B' : 'A';
  const n = Math.max(2, Math.min(MAUL_RANKS_PER_SIDE, Math.round(ranks)));
  const out: MaulBind[] = [];
  for (const team of [attacking, def] as const) {
    for (let rank = 1; rank <= n; rank++) {
      const p = d.L(team, rank);
      /* SIN BIN — a carded man is off the field, so his mass is not in the
       * drive. Leaving him in gave a 14-man side the shove of a 15-man one,
       * which is exactly the advantage a card is supposed to cost. */
      if (p.sinbin > 0) continue;
      out.push({ team, num: rank, rank, mass: forwardMass(p.attrs.PWR), driveN: 0, driveX: 0 });
    }
  }
  return out;
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

  /* The aggregate drives (the contest's own tuning — nation maul attribute,
   * committed men, the lineout shove) remain visual/location progression
   * only. Neither force nor its dependent values can enter
   * resolveMaulRegate(). Human A/D is intentionally absent here: it is
   * consumed only as a commit-window edge. */
  const commit = clamp(1 + Math.round((d.slider(atk, 'setPiece') / 100) * 4), 1, 6);
  s.committed = commit;
  if (!d.isHuman(atk)) {
    s.forceA += dt * (200 + DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)].reaction * 420);
  }
  const lineoutDrive = s.fromLineout ? 1900 : 0;
  s.forceA = approach(s.forceA, 2600 + lineoutDrive + d.teams[atk].nation.att.maul * 26 + commit * 320, 2.2, dt);
  s.forceD = approach(s.forceD, 2400 + d.teams[def].nation.att.maul * 24 + (6 - commit) * 300, 1.6, dt);

  /* SPEC_03 — BINDING DRIVE KINEMATICS. The aggregate drives are
   * distributed across the bound men by mass share (the heavy prop shoves
   * heavier), and the cluster sums them straight back — mass and drive
   * vectors summed kinematically, in the ledger as well as in the
   * integration. The attack drives +dir in its own frame, the defence
   * drives −dir; a held-up maul (defence control) transmits the attack's
   * shove into the hold, not into motion. */
  let massA = 0, massD = 0;
  for (const b of s.bound) { if (b.team === atk) massA += b.mass; else massD += b.mass; }
  const held = s.contest === 'DEFENCE_CONTROL';
  for (const b of s.bound) {
    if (b.team === atk) {
      b.driveN = held ? 0 : s.forceA * (b.mass / Math.max(1, massA));
      b.driveX = held ? 0 : b.driveN * 0.06 * clamp(s.yaw / 12, -1, 1);
    } else {
      b.driveN = held ? 0 : -s.forceD * (b.mass / Math.max(1, massD));
      b.driveX = 0;
    }
  }
  const net = maulClusterNet(s.bound);
  if (held) {
    // The re-gate may direct presentation into a held-up maul, but force is not
    // consulted to award that control or to reverse it once it is locked.
    s.speed = approach(s.speed, 0, 6, dt);
    s.yaw = approach(s.yaw, 0, 3, dt);
  } else {
    /* The no-explosion funnel owns the only velocity the cluster may have:
     * F_net / Σm, acceleration-capped, speed-band-limited. */
    s.speed = stepMaulClusterSpeed(s.speed, net.n, s.clusterMass, dt);
    s.yaw = approach(s.yaw, clamp((s.forceA - s.forceD) / 1400 * 12 + net.x * 0.004, -22, 22), 1.2, dt);
  }
  /* The direction correction: the speed band is authored in the ATTACK's
   * frame (positive = toward their try line), so the displacement is
   * multiplied by `dir`. The scalar model this replaced integrated +z for
   * both sides — a defending-from-deep maul "drove" upfield by sign
   * accident; the kinematic cluster cannot. */
  s.z += s.speed * s.dir * dt;
  s.gained += Math.max(0, s.speed * dt);
  s.x += Math.sin((s.yaw * Math.PI) / 180) * dt * 0.6;
  if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) { s.x = s.exitX; s.z = s.exitZ; s.speed = 0; }

  /* SPEC_03 — CHANNELLING. Under attack control the ball walks
   * hand-to-hand down the bound ranks to the TAIL: the carrier's ball
   * becomes the rearmost bound player's ball, and only from there do the
   * extraction verdicts (TRANSFER_TO_9 from the hindmost foot, the tail
   * forward's peel) make physical sense. */
  if (s.contest === 'ATTACK_CONTROL' && s.ballRank < s.ranks - 1) {
    const ch = channelBallRank(s.ballRank, s.ranks - 1, s.channelT, dt);
    if (ch.rank !== s.ballRank) {
      s.ballRank = ch.rank;
      if (ch.rank >= s.ranks - 1 && d.isHuman(atk)) {
        d.showHint('THE BALL IS AT THE TAIL — 9 CAN HAVE IT', 1.6);
      }
    }
    s.channelT = ch.channelT;
  }

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
  /* SPEC_08: the 20 s hand-off is a pure law-clock backstop for ANY law —
   * under the two live modes the stall whistle resolves a defence-held maul
   * by ~16 s, so this is unreachable by design, exactly what a safety net
   * should be. It is a fixed law-clock exit, never a force outcome. */
  if (s.contest === 'DEFENCE_CONTROL' && s.t >= MAUL_NO_LIMIT_SAFETY_AT) {
    beginMaulExit(s, 'UNPLAYABLE_SCRUM');
    return;
  }
  if (updateMaulStall(d, s, dt)) return;

  /* SPEC_08 — THE COLLAPSE ADJUDICATION. One roll against the referee's
   * hazard pair:
   *   deliberate (a defending bind pulls the maul down) → an IMMEDIATE
   *     penalty against the defence; no use-it management, no ladder;
   *   legal (the drive's legs go, nobody offends) → the whistle,
   *     unplayable maul, turnover scrum to the defence — the same
   *     terminal award as the stall, by Law 16.11 / 17. */
  if (s.contest !== 'PENDING') {
    const sum = Math.max(1, s.forceA + s.forceD);
    const hz = maulCollapseHazard({
      imbalance: Math.abs(s.forceA - s.forceD) / sum,
      stallClock: s.stallClock,
    });
    /* The hazards are per-SECOND rates; the draw prices one frame against
     * them (P = rate × dt). Rolling R()×dt against the rate instead prices
     * R() < rate/dt — sixty times the hazard, a guaranteed instant collapse
     * the maulprobe's drive sections caught on their first run. */
    const roll = R();
    if (roll < hz.deliberate * dt) {
      const puller = s.bound.find((b) => b.team === def && b.rank === 1)?.num ?? 7;
      d.lawCall('MAUL_COLLAPSE', REFEREE_CALLS.MAUL_COLLAPSE, def);
      d.beginPenalty(atk, REFEREE_CALLS.MAUL_COLLAPSE, puller);
      return;
    }
    if (roll < (hz.deliberate + hz.legal) * dt) {
      s.collapsed = true;
      d.say('THE MAUL GOES TO GROUND — NO OFFENCE, IT IS UNPLAYABLE');
      beginMaulExit(s, 'UNPLAYABLE_SCRUM');
      return;
    }
  }

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
