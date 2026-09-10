/**
 * T-03 — ENGINE/SETPIECES. Extracted verbatim from director.ts: the scrum
 * (slots, the engage sequence, the drive), the lineout (assembly, the throw,
 * the T-06 mechanical lift contest) and the maul. No behaviour change; each
 * function takes a Director reference.
 */

import { stepBall, touchBall } from './ballPhysics';
import { Director, ScrumSlot, Input, MaulState } from '../director';
import { DIFFICULTY_TABLE, REFEREE_CALLS } from '../data';
import { R } from './rng';
import { clamp } from './clamp';
import { scrumBlock } from '../behaviour/setpiece-overrides';
import {
  engineRoomFactor, stabilisedCollapseRisk, eightPicksFromScrum,
  forwardMass, lineoutRole,
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
 * FORWARD PACK — the two lifters bound to a jumper: the two LIFTERS standing
 * nearest him along the line of touch, which is what a pod IS. In the front
 * pod those are the prop and the flanker either side of lock 4; in the back
 * pod the prop and flanker either side of lock 5; at the tail the back pod's
 * pair step back with the eight.
 *
 * Read from the AUTHORED POD LAYOUT (lineoutMarks) and the men's own marks —
 * nearest along the line, not roster adjacency — because the roster order and
 * the pod order are deliberately different: the pods are the shape, the roster
 * is the squad. Pure; used by the catch contest and by the per-frame lift.
 */
function podLifters<T extends { num: number; team: 'A' | 'B'; x: number; role: string }>(
  players: T[], team: 'A' | 'B', jumperNum: number,
): T[] {
  const line = players.filter((q) => q.team === team && (q.role === 'JUMPER' || q.role === 'LIFTER'))
    .sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  const idx = line.findIndex((q) => q.num === jumperNum);
  if (idx < 0) return [];
  const jumper = line[idx];
  return line
    .filter((q) => q.role === 'LIFTER' && q.num !== jumper.num)
    .sort((a, b) => Math.abs(Math.abs(a.x) - Math.abs(jumper.x)) - Math.abs(Math.abs(b.x) - Math.abs(jumper.x)))
    .slice(0, 2);
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
         * his share of the work and his own power. */
        let F = 0;
        for (const slot of s.players) {
          if (slot.team !== t) continue;
          const p = d.L(slot.team, slot.num);
          if (p.sinbin > 0) continue;
          F += base * (0.72 + (w / 60) * 0.34) * eng * (PACK_DRIVE_SHARE[slot.num] ?? 0) * (0.9 + 0.2 * p.attrs.PWR / 100);
        }
        return F;
      };
      s.packs.A.forceTransmitted = driveOf('A');
      s.packs.B.forceTransmitted = driveOf('B');
      const net = scrumShoveNet(
        { mass: mass.A, drive: driveOf('A'), stability: s.frontRowStability ?? 0 },
        { mass: mass.B, drive: driveOf('B'), stability: s.frontRowStability ?? 0 },
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
          d.startOpen(winner, ax.x, ax.z + (winner === 'A' ? -1.94 : 1.94) + s.netDrive, 8, 1, 0, 0.55);
          break;
        }
        /* PLAYTEST 4: the mark is the nine's own base slot (2.95) — he has
         * stood there through the drive, so the hand-off reads as a pick-up
         * at the back of the scrum, not a teleport to the tunnel. */
        d.startOpen(winner, ax.x + (winner === 'A' ? -0.3 : 0.3), ax.z + (winner === 'A' ? -2.95 : 2.95) + s.netDrive, 9, 1, 0, 0.55);
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

/* ================== THE LINEOUT'S SHAPE — TWO PODS AND A TAIL ==================
 *
 * A lineout is not a row of men evenly spaced across the grass. It is TWO
 * PODS in the channel between the 5-metre line and the 15-metre line — each
 * pod a jumper between two lifters — with the tail beyond them, and the same
 * two pods facing them from across the line of touch. The old engine spread
 * the line as one chain of nine men at a flat 0.62 m spacing running 30 m out
 * from the touchline, which is why every lineout read as a line of bodies
 * across the field and every jumper looked like he was queuing to be lifted.
 *
 *   FRONT POD   prop · LOCK 4 · flanker   centred on the 5-metre line
 *   BACK POD    prop · LOCK 5 · flanker   centred 3.5 m further in
 *   TAIL        the eight                 two pod-gaps in
 *
 * The defending side is the same two pods; their seven roves, so the eight
 * takes the back pod's third slot. Every man's mark is authored here, once, in
 * metres from the touchline — the same axis the throw's calls are authored on
 * (Director.LO_CALLS) — so the ball, the jumper and the pod cannot drift
 * apart. Pure geometry: the caller writes the marks.
 */
export const LINEOUT_POD_SPACING_M = 3.5;
/** The front pod's centre, metres from the touchline. It is set so that the
 *  pod's FRONT LIFTER stands exactly on the 5-metre line (5.7 − 0.7): the
 *  channel opens where the law opens it, and every other man of the line is
 *  inside it. */
export const LINEOUT_POD_FRONT_FROM_TOUCH_M = 5.0 + 0.7;
/** Men inside one pod stand this far apart — shoulders, not arms' length. */
export const LINEOUT_POD_INTERNAL_M = 0.7;
/** The tail's mark: two pod-gaps in, comfortably inside the 15-metre line. */
export const LINEOUT_TAIL_FROM_TOUCH_M = LINEOUT_POD_FRONT_FROM_TOUCH_M + 2 * LINEOUT_POD_SPACING_M;
/** Each line stands this far off the line of touch, so the two face each other
 *  across 1.4 m — the gap the throw must travel through. */
export const LINEOUT_LINE_GAP_M = 0.7;
/** The lifted jumper's hands at full extension: the catch plane the whole lift
 *  exists to buy, and the elevation the set-piece visual probe asserts. A
 *  standing reach is ~2.35 m; the lift buys the rest. */
export const LINEOUT_JUMP_REACH_Y_M = 2.8;
/** The plane the thrown ball is caught at, metres — the engine's contact test
 *  and the flight's target must be the same number or the ball is caught by a
 *  man who is not there. */
export const LINEOUT_CATCH_PLANE_M = LINEOUT_JUMP_REACH_Y_M;
/** How far his feet leave the turf at that reach. */
export const LINEOUT_JUMP_BODY_LIFT_M = 0.55;
/** Where his lifters' hands are: on his thighs, above their own shoulders.
 *  The pair supports the MAN, not the ball. */
export const LINEOUT_LIFT_GRIP_Y_M = 1.35;
/** The two pods by shirt, throwing side: front pod, then back pod. */
export const LINEOUT_POD_MEN_THROWING: readonly (readonly number[])[] = [[1, 4, 6], [3, 5, 7]];
/** The defending side is the same line minus the seven, who roves; the back
 *  pod is a pair, and the eight stands the tail as both sides' tail jumper. */
export const LINEOUT_POD_MEN_DEFENDING: readonly (readonly number[])[] = [[1, 4, 6], [3, 5]];

export interface LineoutPod {
  key: 'FRONT' | 'BACK';
  /** centre of the pod, metres from the touchline. */
  centerM: number;
  /** its men, in line order from the touchline inward. */
  men: number[];
  jumper: number;
  lifters: number[];
  /** every man's mark inside the pod, metres from touch. */
  fromTouchM: number[];
}

/** The pods of one line, front pod first. Pure over the roster: `line` is the
 *  team's lineout line (Director.LINE_A / LINE_B), and which table applies is
 *  read from the line itself — a seven-man line is throwing, a six-man line
 *  defending. */
export function lineoutPods(line: readonly number[]): LineoutPod[] {
  const table = line.includes(7) ? LINEOUT_POD_MEN_THROWING : LINEOUT_POD_MEN_DEFENDING;
  const out: LineoutPod[] = [];
  table.forEach((men, i) => {
    const live = men.filter((n) => line.includes(n));
    if (!live.length) return;
    const jumper = live.find((n) => lineoutRole(n) === 'JUMPER') ?? live[0];
    const centerM = LINEOUT_POD_FRONT_FROM_TOUCH_M + i * LINEOUT_POD_SPACING_M;
    out.push({
      key: i === 0 ? 'FRONT' : 'BACK',
      centerM, men: live, jumper,
      lifters: live.filter((n) => n !== jumper),
      fromTouchM: live.map((_, k) => centerM + (k - (live.length - 1) / 2) * LINEOUT_POD_INTERNAL_M),
    });
  });
  return out;
}

/** One man's place in the channel. */
export interface LineoutMark {
  num: number; role: string; pod: 'FRONT' | 'BACK' | 'TAIL'; fromTouchM: number;
}

/** EVERY man of a line's mark: the pods first (front pod on the 5-metre line,
 *  back pod 3.5 m in), then anyone the pod tables do not name — the throwing
 *  side's tail eight, or a reshuffled line after a card — in the tail. */
export function lineoutMarks(line: readonly number[]): LineoutMark[] {
  const out: LineoutMark[] = [];
  for (const pod of lineoutPods(line)) {
    pod.men.forEach((num, k) => {
      out.push({ num, role: lineoutRole(num), pod: pod.key, fromTouchM: pod.fromTouchM[k] });
    });
  }
  const placed = new Set(out.map((m) => m.num));
  let extra = 0;
  for (const num of line) {
    if (placed.has(num)) continue;
    out.push({
      num, role: lineoutRole(num), pod: 'TAIL',
      fromTouchM: LINEOUT_TAIL_FROM_TOUCH_M + extra * LINEOUT_POD_INTERNAL_M,
    });
    extra++;
  }
  return out;
}

/** The world x of a mark `fromTouchM` metres out from the touchline. */
export function lineoutMarkX(side: number, fromTouchM: number): number {
  return side * (FIELD.maxX - Math.abs(fromTouchM));
}

/* ===================== THE PACK'S SHAPE (VISUAL CONTRACT) =====================
 *
 * scrumSlots answers WHERE a forward packs down; this answers HOW he stands
 * there, and both come from the same authored block
 * (behaviour/setpiece-overrides.scrumBlock): the front row's head interlock
 * on the tunnel, the row's torso pitch (38° / 40° / 32° out of vertical), and
 * the point each man's hands are working at. The rig has sixteen bodies and no
 * idea which row a man is in, so the engine publishes the posture per man and
 * ThreePlayerManager's procedural layer poses him from it.
 *
 * Without it the sixteen packed down on one 'Push' clip at a uniform upright
 * posture and read as a loose huddle wherever the camera was; the block's
 * SHAPE is what tells a viewer which pack is which, and it is authored here so
 * the renderer cannot invent a different one.
 */
export interface ScrumSlotPose {
  num: number;
  team: 'A' | 'B';
  row: number;
  /** torso pitch out of vertical, radians: front row 38°, locks 40°, the
   *  eight 32° — every forward inside the 30°–45° band the probe asserts. */
  pitch: number;
  /** the locked engagement heading, radians (renderer frame). */
  facing: number;
  /** where his head carries to: the interlock with the opposing front row. */
  headX: number; headZ: number;
  /** the point his hands work at: the opposing front row's shoulders. */
  bindX: number; bindY: number; bindZ: number;
  x: number; z: number;
}

/** The whole 3-4-1 block's posture plan for a scrum on the mark (ax, az),
 *  keyed `A:1` … `B:8`. Pure; the caller places and poses. */
export function scrumVisualPlan(ax: number, az: number): Map<string, ScrumSlotPose> {
  const out = new Map<string, ScrumSlotPose>();
  for (const b of scrumBlock(ax, az)) {
    out.set(`${b.team}:${b.num}`, {
      num: b.num, team: b.team, row: b.row,
      pitch: b.pitch, facing: b.facing,
      headX: b.headX, headZ: b.headZ,
      bindX: b.bindX, bindY: b.bindY, bindZ: b.bindZ,
      x: b.x, z: b.z,
    });
  }
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
    s.call = { targetX: lineoutMarkX(side, c.fromTouchM), label: c.label, jumpers: c.jumpers, kind: c.kind };
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
    if (s.ball.y <= LINEOUT_CATCH_PLANE_M && s.ball.vy < 0) {
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
        d.lo = undefined;
        d.startOpen(dTeam, bx, bz, 9, 1, 0, 0.45);
        return;
      }

      d.recordSetPieceOutcome('lineouts', thrower);
      touchBall(s.ball);
      s.ball.state = 'HELD';
      /* THE MAN WHO WON IT IS THE MAN WHO CAUGHT IT. `find` returned the first
       * jumper in ROSTER order, which in a two-pod line is always the front
       * pod's lock 4 — so a ball thrown to the back pod (or the tail eight)
       * was awarded to a man three and a half metres away from it, and the
       * rendered catch happened where the ball was not. `reachOf` already
       * contests with the jumper nearest the ball; the award reads the same
       * man, at the same catch plane the throw was solved onto. */
      const jw = s.players
        .filter((q) => q.team === thrower && q.role === 'JUMPER')
        .sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz))[0];
      if (jw) { s.ball.heldBy = jw.id; jw.handY = LINEOUT_JUMP_REACH_Y_M; }
      d.lo = undefined;
      /* SPEC_03 — the cleanest maul birth in rugby: the jumper lands with
       * the ball and the pack is ALREADY around him, so the bound forward
       * drive starts the frame he touches grass. Full eight-rank cluster. */
      if (drive) { d.startMaul(thrower, bx, bz, MAUL_RANKS_PER_SIDE, true); return; }
      d.startOpen(thrower, bx, bz, 10, 1, 0, 0.45);
      return;
    }
  }
  void input;
  /* ======================= THE LIFT, EVERY FRAME =======================
   *
   * A lineout's whole point is a man off the ground with two team-mates
   * holding him there, and none of it existed as engine data: the lift was a
   * `handY` scalar on the jumper that nothing rendered, and the lifters' hands
   * rose by a fraction of the jumper's. The three numbers below are the lift's
   * geometry, published for the rig:
   *
   *   handY/reachY  the jumper's hands — the catch plane the lift buys
   *                 (LINEOUT_JUMP_REACH_Y_M = 2.8 m at full extension)
   *   liftY         his feet, off the turf by LINEOUT_JUMP_BODY_LIFT_M
   *   bindX/Y/Z     where a hand works: the jumper's straight up over his own
   *                 head; his LIFTERS' on his thighs (LINEOUT_LIFT_GRIP_Y_M)
   *
   * A lifter goes up only with the jumper of his own pod — the pair beside
   * him — and that pair is the reason the jumper has a catch plane at all.
   */
  const contesting = s.stage === 'CONTEST' || s.stage === 'CATCH';
  const closestJumper = contesting
    ? s.players
      .filter((q) => q.role === 'JUMPER')
      .sort((a, b) => Math.abs(a.x - s.ball.x) - Math.abs(b.x - s.ball.x))[0]
    : undefined;
  for (const p of s.players) {
    if (p.role === 'JUMPER' && contesting) {
      const mine = closestJumper !== undefined && closestJumper.num === p.num && closestJumper.team === p.team;
      const reach = mine
        ? Math.max(LINEOUT_JUMP_REACH_Y_M * 0.6, Math.min(s.ball.y + 0.25, LINEOUT_JUMP_REACH_Y_M))
        : LINEOUT_JUMP_REACH_Y_M * 0.75;
      p.handY = approach(p.handY, reach, 6, dt);
      p.reachY = p.handY;
      /* the man at the ball is the one the pair actually gets off the ground */
      p.liftY = approach(p.liftY ?? 0, mine ? LINEOUT_JUMP_BODY_LIFT_M : LINEOUT_JUMP_BODY_LIFT_M * 0.55, 5, dt);
      p.bindX = p.x; p.bindY = p.handY; p.bindZ = p.z;   // arms up over his own head
    } else if (p.role === 'LIFTER' && contesting) {
      /* T-06: one shared timeline — the lifters' hands rise with their own
       * jumper, half a beat behind him, instead of animating alone. */
      const atBall = s.players
        .filter((q) => q.team === p.team && q.role === 'JUMPER')
        .sort((a, b) => Math.abs(a.x - s.ball.x) - Math.abs(b.x - s.ball.x))[0];
      const mine = atBall && podLifters(s.players, p.team, atBall.num).some((w) => w.num === p.num) ? atBall : undefined;
      p.handY = approach(p.handY, mine ? LINEOUT_LIFT_GRIP_Y_M : 0.4, 6, dt);
      p.reachY = p.handY;
      p.liftY = approach(p.liftY ?? 0, 0, 6, dt);
      if (mine) {
        /* hands on the jumper's thighs: above his own hips, under the man */
        p.bindX = mine.x; p.bindY = LINEOUT_LIFT_GRIP_Y_M; p.bindZ = mine.z;
      } else {
        p.bindX = undefined; p.bindY = undefined; p.bindZ = undefined;
      }
    } else {
      p.handY = approach(p.handY, 0.4, 6, dt);
      p.liftY = approach(p.liftY ?? 0, 0, 6, dt);
      p.reachY = p.handY;
      p.bindX = undefined; p.bindY = undefined; p.bindZ = undefined;
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
  const flight = 1.15;
  s.ball.vx = dx / flight;
  /* thrown UP TO the catch plane the lift buys (LINEOUT_JUMP_REACH_Y_M) and
   * SOLVED to come down onto it at the nominal flight time — the closed form
   * replaces a made-up apex velocity that made the ball arrive 40% late and
   * well above any hand. */
  s.ball.vy = (LINEOUT_CATCH_PLANE_M - 1.6) / flight + 0.5 * 9.81 * flight;
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
