/**
 * T-03 — ENGINE/BREAKDOWN. Extracted verbatim from director.ts: the tackle
 * episode (fall-forward, crews, the jackal contest, the ruck clock and the
 * offside walk-back). No behaviour change; a Director reference in.
 */

import { Director, Input, BreakdownState } from '../director';
import { FIELD } from '../../render/retro';
import { REFEREE_CALLS, DIFFICULTY_TABLE } from '../data';
import { ruckDistributor, assignCrew } from '../intelligence';
import { R } from './rng';
import { clamp } from './clamp';
import { throughGate } from './latch';
import type { LatchVec } from './latch';

/* ============================ T-80 SPRING LATCHES ============================
 *
 * The breakdown is no longer a static slot tableau driven by the axis model
 * alone. Every participant gets a rigid body (topped with a capsule radius)
 * and the set is solved each frame as a 6DOF compliant constraint lattice:
 *
 *   TACKLE  — tackler's shoulder/arm collider ↔ carrier's torso (spawned as
 *             soon as valid binding conditions are met: within 1.2 m; the
 *             gate rule applies to ruck entries, not to the tackle itself).
 *   RUCK    — each arriving entrant's shoulder ↔ the ball body, spawned the
 *             moment the man is inside 1.2 m AND has come through the gate
 *             (behind the hindmost foot, inside the ruck's width).
 *
 * Bodies seek their slot marks, bind, and then push. The shove is the same
 * PWR×quality sum the axis model used — but it is now applied THROUGH the
 * bind lattice, and the net horizontal force moves the ball body, so the
 * contest visibly shifts as it is won. Joints release on breaking strength
 * (a powerful fend rips the tackle bind apart), on tackle completion, or on
 * the whistle — never by teleporting the participants back to slots.
 *
 * The presentation (placeBound easing live actors onto bd.players slots)
 * is untouched: the slots ARE the latch positions, so the actors follow the
 * physics one ease behind. No rigid separation runs inside the pod (bound
 * players are skipped by separate()), so nothing is ever projected.
 * --------------------------------------------------------------------------- */

const LATCH_AXIS_K = 34;      // N per axis-force unit (axis forces are PWR units ~100s)
const LATCH_BALL_R = 0.22;
/* The ball body is the CONTEST's aggregate mass, not a 0.4 kg rugby ball:
 * it is what the pile's binds and drives push against (a real ruck is the
 * ball plus the men over it). 7 kg made every bind impulse launch it. */
const LATCH_BALL_M = 32;
const TACKLE_AXES = {
  tx: { k: 4300, c: 640, rest: 0, max: 7000 },
  ty: { k: 2600, c: 430, rest: 0, max: 4800 },
  tz: { k: 5600, c: 740, rest: 0, max: 8000 },
  rx: { k: 1500, c: 250, rest: 0, max: 620 },
  ry: { k: 1200, c: 220, rest: 0, max: 560 },
  rz: { k: 1700, c: 280, rest: 0, max: 620 },
};
const RUCK_AXES = {
  tx: { k: 3400, c: 520, rest: 0, max: 5600 },
  ty: { k: 2200, c: 380, rest: 0, max: 4200 },
  tz: { k: 4400, c: 640, rest: 0, max: 6600 },
  rx: { k: 1200, c: 220, rest: 0, max: 520 },
  ry: { k: 1000, c: 200, rest: 0, max: 470 },
  rz: { k: 1400, c: 250, rest: 0, max: 520 },
};
/* The break limits are the SAFETY ceiling, not the tuning line: the spring
 * lattice caps every axis individually (7-8 kN) so the vector sum of a
 * normal tackle/ruck sits around 8-12 kN, and the split-impulse contact
 * keeps the bind at its rest envelope. A fend is a driven release from
 * open.ts (latch.fend), which sends a strain spike of its own — bindings
 * do not wear out from an ordinary shove. */
const TACKLE_BREAK_N = 15000, TACKLE_BREAK_NM = 1500;
const RUCK_BREAK_N = 13000, RUCK_BREAK_NM = 1300;

function bodyMass(p: { attrs: { PWR: number } }): number {
  return 88 + p.attrs.PWR * 0.22;   // 88-115 kg, heavier props push heavier
}

function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(x - tx, z - tz);
}

/**
 * Build the pile. Every slot becomes a body spawned at its LIVE position
 * (nothing teleports in), seeking its slot mark. The ball body is the
 * contested object the binds transmit through.
 */
function latchMount(d: Director, s: BreakdownState, dir: number): void {
  const sys = d.latches;
  sys.reset();
  const fwd = s.attacking === 'A' ? 1 : -1;
  /* The ball body — the contest's aggregate mass. It sits half a stride in
   * front of the contact point, at the carrier's feet, where a ruck actually
   * forms — never underneath the carrier's torso capsule (deep initial
   * overlap made the contact spring eject it through the pile). */
  const ballZ = s.contactZ + fwd * 0.6;
  const ball = sys.spawn({
    kind: 'BALL', team: s.attacking, num: 0,
    x: s.contactX, z: ballZ, y: 0.3, yaw: 0, vx: 0, vy: 0, vz: 0, yawVel: 0,
    mass: LATCH_BALL_M, radius: LATCH_BALL_R, down: true, drive: 0, driveDir: fwd,
  });
  sys.anchorBody(ball.id, s.contactX, ballZ, 16000, 2600);
  for (const slot of s.players) {
    const p = d.L(slot.team, slot.num);
    /* ARRIVAL SPEED CAP. The open-play converger is sprinting at up to
     * 10 m/s when the whistle falls; a body that keeps that into the bind
     * arrives as a 12 m/s projectile (the jarring fault — the pile's worst
     * pairs were all v≈10/3.4). A real clearout brakes as he closes: the
     * hit is carried, not the full sprint. 5.5 m/s is still a hard arrival;
     * the seek braking below finishes the settle. */
    const sv = Math.hypot(p.vx, p.vz);
    const vCap = sv > 5.5 ? 5.5 / sv : 1;
    const body = sys.spawn({
      kind: slot.role === 'CARRIER' ? 'CARRIER'
        : slot.role === 'TACKLER' ? 'TACKLER'
          : slot.role === 'JACKAL' ? 'JACKAL'
            : slot.role === 'COUNTER' ? 'COUNTER' : 'CLEARER',
      team: slot.team, num: slot.num,
      x: p.x, z: p.z, y: 0, yaw: slot.role === 'TACKLER'
        ? yawToward(p.x, p.z, s.contactX, s.contactZ)
        : (slot.team === s.attacking ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI : 0)),
      vx: p.vx * vCap, vy: 0, vz: p.vz * vCap, yawVel: 0,
      mass: bodyMass(p), radius: 0.55, down: slot.down, drive: 0,
      /* The shove is along each side's own attacking axis: the carrier side
       * drives +fwd, the defending side drives −fwd. `latticeNet` reads the
       * same sign to split attack/defence. */
      driveDir: slot.team === s.attacking ? fwd : -fwd,
    });
    /* The body spawns with the live actor's velocity, so the carrier keeps
     * the momentum of the carry into the bind: a powerful runner lands hard
     * and strains the tackle joint before the bind settles him. */
    slot.mx = slot.x; slot.mz = slot.z;
    sys.seek(body.id, slot.x, slot.z);
  }

  /* PILE SEATING. Open play ends with the tackler ON the carrier (the gate
   * hunt found pairs 0.1 m apart, v=0.0/3.4 — the hit arrived inside the
   * man). A pile bound together must START at its contact envelope: spread
   * every pair that is inside (rA+rB) by a small, deterministic kick along
   * the pair normal, at mount only, in a few bounded passes. The ball body
   * is anchored, so the men give way around it. Bodies keep their velocities
   * (the hit is a hit), and the seat becomes the seek mark, so nothing walks
   * back into its neighbour. This is the "minimum separation margin" fix:
   * the joints then compress from a legal gap instead of merging at zero. */
  const BALL_K = 0;   // the ball body does not move — it is anchored
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < sys.bodies.length; i++) {
      for (let k = i + 1; k < sys.bodies.length; k++) {
        const a = sys.bodies[i], b = sys.bodies[k];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const need = (a.radius + b.radius) * 0.92 + 0.07;
        if (d >= need) continue;
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        const gap = need - d;
        const wA = a.kind === 'BALL' ? BALL_K : b.kind === 'BALL' ? 1 : 0.5;
        const wB = 1 - wA;
        a.x -= nx * gap * wA; a.z -= nz * gap * wA;
        b.x += nx * gap * wB; b.z += nz * gap * wB;
        moved = true;
      }
    }
    if (!moved) break;
  }
  /* the seats ARE the marks now — re-aim every seek at the seated spot. */
  for (const b of sys.bodies) {
    if (b.kind === 'BALL') continue;
    sys.seek(b.id, b.x, b.z);
  }
}

/** Drive one committed body through its bind (N). Returns true when the body
 *  is actually in the lattice — an unbound entrant pushes nothing. */
function driveBody(d: Director, team: 'A' | 'B', num: number, units: number): boolean {
  const b = d.latches.byTeamNum(team, num);
  if (!b || !b.bound || b.kind === 'BALL') return false;
  b.drive = clamp(units * LATCH_AXIS_K, 0, 5200);
  return true;
}



/** One bind attempt pair (shoulder ↔ torso). */
function tryTackleBind(d: Director, s: BreakdownState): void {
  const sys = d.latches;
  const carrier = sys.byKind('CARRIER');
  const tackler = sys.byKind('TACKLER');
  if (!carrier || !tackler) return;
  if (sys.joints.some((j) => j.kind === 'TACKLE')) return;
  /* A bind torn by breaking strength IS the fend: the hit is broken, the
   * pair repopulates from the sides — never an instant re-bind. */
  if ((sys.metrics.releases['BREAK_STRENGTH'] ?? 0) > 0) return;
  const dx = tackler.x - carrier.x, dz = tackler.z - carrier.z;
  const dOrig = Math.hypot(dx, dz);
  if (dOrig >= 1.2) return;
  /* The tackler's shoulder sits on the side the defender came from. The
   * anchors are at the CAPSULE SURFACES (the two radii), so the joint rests
   * exactly at the contact envelope: a bind that is never stretched to its
   * break point by its own rest pose. Bodies still compress INTO the bind
   * when the pile drives them, which is the compliant shove the law wants. */
  const lat = clamp(dx * 0.14, -0.14, 0.14);
  const shoulder: LatchVec = { x: lat, y: 1.34, z: 0.55 };
  const torso: LatchVec = { x: 0, y: 0.95, z: 0.55 };
  const j = sys.bind({
    kind: 'TACKLE', a: tackler.id, b: carrier.id,
    anchorA: shoulder, anchorB: torso,
    axes: TACKLE_AXES, breakN: TACKLE_BREAK_N, breakNm: TACKLE_BREAK_NM,
  });
  if (j) {
    tackler.vx = (dx / dOrig) * 3.4;
    tackler.vz = (dz / dOrig) * 3.4;
    d.shake(0.06 + 0.08 * clamp(s.power.A / 900, 0, 1));
  }
}

/** Ruck entry: bind the first shoulder to the ball through the gate. */
function tryRuckBinds(d: Director, s: BreakdownState, fwd: number): void {
  const sys = d.latches;
  const ball = sys.byKind('BALL');
  if (!ball) return;
  for (const b of sys.bodies) {
    if (b.kind === 'BALL' || b.kind === 'CARRIER' || b.kind === 'TACKLER' || b.bound) continue;
    if (b.down) continue;
    if (Math.hypot(b.x - ball.x, b.z - ball.z) >= 1.2) continue;
    const defence = b.team !== s.attacking;
    if (!throughGate(b.x, b.z, ball.x, ball.z, fwd, defence)) continue;
    /* shoulder at the entrant's capsule surface; the ball anchor stays at
     * its centre (entrants bind from both sides, so the 0.22 m rest strain
     * is the shoulder pressed into the ball — soft, never breaking). */
    const shoulder: LatchVec = { x: b.team === s.attacking ? -0.12 : 0.12, y: 1.22, z: 0.55 };
    sys.bind({
      kind: 'RUCK', a: b.id, b: ball.id,
      anchorA: shoulder, anchorB: { x: 0, y: 0.14, z: 0 },
      axes: RUCK_AXES, breakN: RUCK_BREAK_N, breakNm: RUCK_BREAK_NM,
    });
  }
}

/** Per-frame latch pass: seek, bind, drive, solve, write back. */
function latchTick(d: Director, s: BreakdownState, dt: number): void {
  const sys = d.latches;
  const fwd = s.attacking === 'A' ? 1 : -1;
  /* A drive is owned for one frame: the RUCK block below rewrites the legal
   * men's drives (they are applied on this frame's step once assigned before
   * it), and anyone not rewritten — illegal now, bound now, or the contest
   * over — stops pushing. */
  for (const b of sys.bodies) b.drive = 0;
  // arrivals: seek the slot mark; once close, hold position and wait for the bind
  for (const b of sys.bodies) {
    if (b.kind === 'BALL') continue;
    const slot = s.players.find((q) => q.team === b.team && q.num === b.num);
    if (!slot) continue;
    const dd = Math.hypot(b.x - slot.mx!, b.z - slot.mz!);
    if (sys.bindCounts().joints === 0 && dd < 0.25) sys.settle(b.id);
    else if (!b.bound && dd < 0.22) sys.settle(b.id);
    else if (!b.bound) {
      sys.seek(b.id, slot.mx!, slot.mz!);
      /* BIND-ZONE BRAKE. The arrival sheds speed over the last metre and a
       * half — a man braces into the bind instead of hitting it at sprint
       * (the jarring fault pairs were all v≈10 into a standing pile). The
       * seek still pulls him in, the brake only removes the projectile
       * component; the bind then takes over at ~1 m/s. */
      if (dd < 1.5) {
        const k = Math.exp(-(1.9 + (1.5 - dd) * 2.6) * dt);
        b.vx *= k; b.vz *= k;
      }
    }
  }
  if (s.stage === 'CONTACT' || s.stage === 'PLACE' || s.stage === 'RUCK') tryTackleBind(d, s);
  if (s.stage === 'RUCK' && s.ruckFormed) tryRuckBinds(d, s, fwd);

  // drives are assigned by the axis model before this step (sideForce writes
  // them through `driveBody`), so the shove reaches the contest THROUGH the
  // bind lattice and the ball body — and the ruck — physically moves.
  sys.step(dt);
  const net = sys.latticeNet(fwd);
  /* The meter is the honest physical read: the net force actually applied
   * through the binds right now (+1 attack shove, −1 defence hold). */
  s.contestMeter = clamp(0.5 + net.net * 0.5, 0, 1);

  // write-back: the slots ARE the bodies; ball follows the contested body.
  for (const b of sys.bodies) {
    const slot = s.players.find((q) => q.team === b.team && q.num === b.num);
    if (slot) { slot.x = b.x; slot.z = b.z; slot.down = b.down; }
    if (b.kind === 'BALL') { s.ball.x = b.x; s.ball.z = b.z; }
  }
}

function latchBreakDelta(d: Director, s: BreakdownState): number {
  const total = d.latches.metrics.releases['BREAK_STRENGTH'] ?? 0;
  const prev = s.latchedBreaks ?? 0;
  s.latchedBreaks = total;
  return total - prev;
}



export function upBreakdown(d: Director, dt: number, _input: Input, pressed: Set<string>) {

  const s = d.bd!;
  s.t += dt;
  const atk = s.attacking, dTeam = d.defending();

  /* T-80 — the lattice pass. Bodies seek their marks, bind when valid, and
   * the solver moves the contest; the stage logic below reads/writes the
   * same slot state, and the write-back keeps them in lock-step. */
  if (d.latches.bodies.length) {
    latchTick(d, s, dt);
    const broke = latchBreakDelta(d, s);
    if (broke > 0) {
      d.teams[atk].stats.tacklesBroke += broke;
      d.commentate('BIG_HIT', `— ${broke > 1 ? 'THE BINDS RIPPED APART' : 'A POWERFUL FEND RIPS THE BIND'}`);
    }
  }

  /* Playtest 2: "I press the pass button and it doesn't pass." A pass
   * pressed during the fight is the nine's call: it plays the moment the
   * ball is out. Spent only on a won ruck. */
  if (d.isHuman(atk)) {
    if (pressed.has('passL')) { s.bufferedPass = -1; d.showHint('NINE WILL PASS LEFT ON THE OUT', 1.2); }
    if (pressed.has('passR')) { s.bufferedPass = 1; d.showHint('NINE WILL PASS RIGHT ON THE OUT', 1.2); }
  }
  /* PLAYTEST 3 — THE DEFENDING SIDE'S VERB: SPACE = GO FOR THE STEAL,
   * exactly the user's rule. With numbers the ball is ripped at once and
   * the use-it window starts; without numbers the referee WARNS him, and
   * going in again is hands-in — a penalty to the attack. */
  if (d.isHuman(dTeam) && s.stage === 'RUCK' && pressed.has('action')) {
    if (s.defCrew.length > s.crew.length) {
      d.teams[dTeam].stats.turnovers++;
      d.say('STOLEN — THE DEFENCE HAD THE NUMBERS');
      d.clearRuck();
      const dirR = dTeam === 'A' ? 1 : -1;
      d.startOpen(dTeam, s.contactX, s.contactZ - dirR * 1.5, s.defCrew[0], 1, 0, 1.1);
      d.releaseBeat = { z: s.contactZ, dir: -dirR, until: d.t + 0.9 };
      return;
    }
    if (s.stealWarned) {
      s.resultWhy = 'HANDS IN THE RUCK — THE JACKAL WENT IN ALONE, TWICE';
      d.beginPenalty(atk, 'HANDS_IN', s.defCrew[0] ?? 7);
      return;
    }
    s.stealWarned = true;
    d.showHint('OUTNUMBERED AT THE BREAKDOWN — NO STEAL. GO AGAIN AND IT IS A PENALTY', 2.2);
  }
  const limit = [1.5, 3, 5][d.options.ruckLaw ?? 1];
  const diff = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)];

  if (s.stage === 'CONTACT') { s.stage = 'PLACE'; s.groundAt = s.t; }

  if (s.stage === 'PLACE') {
    const human = d.isHuman(atk);
    if (human) {
      if (pressed.has('left') || pressed.has('right')) s.waggle += 1;
      if (pressed.has('action')) { s.commitA = clamp(s.commitA + 1, 1, 3); d.showHint(`COMMITTED ${s.commitA} TO THE RUCK`, 1.4); }
    } else {
      /* T-05. The CPU does not stare at the breakdown: a quick, decisive
       * place so the contest — the part worth watching — starts at once. */
      s.waggle += dt * (16 + diff.reaction * 10);
    }
    const elapsed = s.t - s.groundAt;
    if (s.waggle > 4.2 || elapsed > 0.75) {
      /* T-18. Real referees ping not-releasing two to four times a match,
       * not eleven — the rate was ending a red-zone possession in every
       * other phase. This baseline roll lives at the PLACE→RUCK transition
       * (the tackle, not the contest); the contest adds its own hazard
       * below when the defence is actually on top. */
      if (R() < 0.015 + (d.slider(atk, 'aggression') / 100) * 0.03) {
        s.resultWhy = 'NOT RELEASING AT THE TACKLE';
        d.beginPenalty(dTeam, REFEREE_CALLS.NOT_RELEASING, s.players[0].num);
        return;
      }
      s.stage = 'RUCK';
      s.ruckFormed = true;
      s.ball.placed = true;
      /* T-05. The contest begins. The clearout work done in PLACE is not a
       * dice roll any more — it is the attack's head start on the axis: a
       * body that arrived and shunted before the ruck formed has already
       * moved the ball a fraction backwards. From here the ruck resolves
       * the way a scrum does, continuously, from the forces on the ball. */
      s.axis = clamp((s.waggle - 4.2) * 0.02, -0.05, 0.2);
      s.axisVel = 0;
      s.contestT = 0;
      s.redT = 0;
      s.resultWhy = '';
    }
  }

  /* T-05 — THE SUSTAINED CONTEST. The ruck was a waggle bar gating a one-shot
   * steal roll: the player could not see who was winning, the steal ignored
   * everything that happened after the first 0.75 s, and FAIR-09 called it
   * exactly for what it was. It is now the same physical model as the scrum:
   *
   *   each side's force = Σ committed men's PWR × arrival quality × legality
   *   the ball sits on a −1..+1 axis, driven by the net force, damped
   *   attack wins at +0.75 → ball out, window = 0.35 + how close it was
   *   defence wins at −0.75 → jackal, turnover, reason stated
   *   stalemate → the ruck clock (use it, as now) is the ceiling
   *
   * Quality is LIVE: a cleaner still two metres out pushes at part force and
   * reaches full shove as he arrives, so committing men early — and the
   * `ruckCommit` slider — genuinely decides rucks instead of re-rolling one.
   * Legality is the gate: a man beyond his offside line pushes nothing. */
  if (s.stage === 'RUCK' && s.groundAt >= 0) {
    const fwd = s.attacking === 'A' ? 1 : -1;
    const atkLine = s.contactZ - fwd * 1.0;

    const sideForce = (nums: number[], team: 'A' | 'B') => {
      let f = 0;
      const push: { num: number; c: number }[] = [];
      for (const n of nums) {
        const p = d.L(team, n);
        if (p.sinbin > 0) continue;
        /* legality. The attack must be behind ITS line; the committed
         * defence — the jackal who was over the ball at the tackle and the
         * counters binding behind him — push from their own side of the
         * ball, which is where placeBound holds their slots. The 3 m line
         * governs the defensive LINE outside the ruck (the walk-back
         * enforces it there); a man through the gate pushes nothing. */
        if (team === s.attacking) {
          if ((p.z - atkLine) * fwd > 0.4) continue;
        } else if ((s.contactZ - p.z) * fwd > 0.3) continue;
        const dist = Math.hypot(p.x - s.contactX, p.z - s.contactZ);
        /* Playtest P2.6/P2.8: the human ruck won itself — the 1.32 attack
         * quality is a CPU-model constant (it prices the committed CPU
         * clearout), not a law of nature. A human side that presses nothing
         * gets the base 1.0 and LOSES the race to a set jackal; the waggle
         * is what buys the shove back. CPU-vs-CPU numbers are untouched. */
        const quality = p.down ? 0.85
          : clamp((team === s.attacking ? (d.isHuman(atk) ? 1.08 : 1.32) : 1.0) - dist / 6, 0.2, 1);
        const c = p.attrs.PWR * quality;
        f += c;
        push.push({ num: n, c });
      }
      return { f, push };
    };

    /* attack: committed men × commit factor. The base is the clearout
     * itself — driving a man backwards off the ball is easier than legally
     * jackaling over it — so a ruck the attack actually commits to bends to
     * the attack, while a one-man ruck is a coin the defence can steal. */
    const humanAtk = d.isHuman(atk);
    const clearout = humanAtk && (pressed.has('left') || pressed.has('right')) ? 1.22 : 1;
    const commitF = (1.15 + s.commitA * 0.2) * clearout * (humanAtk ? 1 : 0.9 + diff.reaction * 0.2);
    /* ENGAGEMENT RAMP. Even the man riding the carrier's hip needs the best
     * part of half a second to bind and drive after the carrier lands. The
     * clearout arrives; it is not there on the frame the ruck forms — which
     * is exactly the jackal's window, and exactly why the fight exists. */
    /* STAGE-1 RE-BALANCE (signed off: compress first, re-price later). The
     * ramp was 0.4 s; the clearout is pre-running off the carrier's hip,
     * and the bdanat probe showed the RUCK stage eating 1.22 s of a 1.7 s
     * breakdown with the ramp as a fixed floor on every one. */
    const atkRamp = Math.min(1, s.contestT / 0.3);
    const atkS = sideForce(s.crew, atk);
    const atkF = atkS.f * commitF * atkRamp;

    if (humanAtk && pressed.has('action')) {
      s.commitA = clamp(s.commitA + 1, 1, 3);
      d.showHint(`COMMITTED ${s.commitA} TO THE RUCK`, 1.4);
    }

    /* defence: three committed (T-39), the jackal's AWARENESS is the steal
     * edge, the contest stiffens with the difficulty table. */
    const jackal = s.defCrew.length ? d.L(dTeam, s.defCrew[0]) : null;
    /* THE JACKAL'S WINDOW. He was over the ball before the ruck formed — he
     * HAS it until he is cleared. His force is boosted for the first 0.7 s
     * of the contest, decaying as the clearout lands on him. An isolated
     * carrier — no hip rider within three metres — loses that race; a
     * supported one never sees it. This is where breakdown turnovers are
     * earned, not rolled. */
    const jackalRush = 1 + 1.0 * Math.max(0, 1 - s.contestT / 1.0);
    const defFactor = (0.78 + diff.reaction * 0.22)
      * (1 + (jackal ? jackal.attrs.AWA : 40) / 350)
      * (s.commitA <= 1 ? 1.22 : 1)    // a one-man ruck is a stealable ruck
      * jackalRush;
    const defS = sideForce(s.defCrew, dTeam);
    const defF = defS.f * defFactor;
    s.contestT += dt;

    /* T-80 — the shove goes THROUGH the bind lattice. Each legal entrant
     * drives his share of the side's force down his bind into the ball body
     * (a body that has not reached the gate pushes nothing — `driveBody`
     * refuses it). `latchTick` zeros every drive on arrivals, so a man who
     * drops out of the side's legality this frame stops pushing with it. */
    for (const m of atkS.push) driveBody(d, atk, m.num, m.c * commitF * atkRamp);
    for (const m of defS.push) driveBody(d, dTeam, m.num, m.c * defFactor);

    s.power.A = atkF; s.power.B = defF;
    const net = (atkF - defF) / Math.max(1, atkF + defF);
    /* Driving a man backwards off the ball is easier work than prying it
     * loose from a formed ruck — so the axis answers a clearout faster than
     * it answers a poach. This asymmetry is what makes the jackal an
     * early-window threat rather than a coin flip on every ruck. The rates
     * are tuned so a contested ruck resolves in one to two seconds: the ruck
     * is a read and a shove, not a wait. */
    /* Recovery is two-speed. A clearout that beats the jackal to the ball
     * swings the axis fast. A jackal who is ALREADY SET — hands on, weight
     * past it — is pried off slowly, because that is what a set jackal is:
     * the fight the defending side wanted. This is where sustained hands
     * becomes a steal instead of a race the attack always wins. */
    const recover = net > 0 ? (s.redT > 0.15 ? 12.0 : 24.0) : 3.6;
    s.axisVel += net * recover * dt;
    s.axisVel *= Math.exp(-0.8 * dt);
    s.axis = clamp(s.axis + s.axisVel * dt, -1, 1);
    /* `contestMeter` is written by the latch pass (the physical net force);
     * the axis above is the resolution model the thresholds read. */
    /* SUSTAINED HANDS — the second steal path. A defence that holds the ball
     * on its side of the axis for a real beat is winning it in fact, rush or
     * no rush; the law gives it to the jackal who had both hands on it and
     * his weight past the ball. An instant dip to −0.75 is a rip (the
     * numbers path below); this is a grind-out, and both are steals.
     * The numbers call stays law-true: with equal or more men over the ball
     * a set jackal may take it; a man alone in there only slows it. */
      if (s.axis < -0.5) s.redT += dt; else s.redT = Math.max(0, s.redT - dt * 2);
    if (s.axis <= -0.6 && s.redT >= 0.6 && s.jackalActive
      && s.defCrew.length >= s.crew.length && s.stage === 'RUCK') {
      d.teams[dTeam].stats.turnovers++;
      if (jackal) { d.run(dTeam, jackal.num).jackals++; d.teams[dTeam].stats.jackals++; }
      d.emitEv({ t: d.t, type: 'TURNOVER', x: s.contactX, z: s.contactZ });
      d.commentate('TURNOVER');
      s.resultWhy = `JACKAL WON — SUSTAINED HANDS ACROSS THE BALL, AXIS ${s.axis.toFixed(2)}`;
      d.clearRuck();
      d.startOpen(dTeam, s.contactX, s.contactZ - (atk === 'A' ? 1 : -1), 9, 1, 0, 0.75);
      return;
    }

    /* defence on top → the not-releasing hazard rises with their dominance
     * (the attack is the side holding the man off the ball). The old roll
     * fired once per ruck regardless of the contest; this one is honest. */
    if (s.axis < -0.45 && R() < dt * 0.05) {
      d.teams[dTeam].stats.turnovers++;
      s.resultWhy = `NOT RELEASING — THE DEFENCE HAD THE UPPER HAND (AXIS ${s.axis.toFixed(2)})`;
      d.beginPenalty(dTeam, REFEREE_CALLS.NOT_RELEASING, s.players[0].num);
      return;
    }

    /* ATTACK WINS — the ball crosses +0.75. Quickness is the margin: a
     * dominant shove (axis → 1) is inside half a second, a scraped win
     * (axis at the threshold, defence still dragging) is slow ball. This is
     * what makes slow-ball responsive to `ruckCommit`. */
    if (s.axis >= 0.75) {
      /* THE JACKAL WHO WOULD NOT ROLL AWAY. He had his hands on the ball,
       * the clearout arrived, and the law gave him a moment to release —
       * which he spent holding on. In the red zone the referee is watching
       * for exactly this: it is where the attacking side's penalties come
       * from, and with them the shot at goal and the five-metre lineout.
       * The rate is honest to the professional count (2-4 a match, mostly
       * in the 22), not a raffle on every ruck. */
      if (s.jackalActive && jackal) {
        const redZone = Math.abs(atk === 'A' ? FIELD.tryZFar - s.contactZ : s.contactZ - FIELD.tryZ) < 22;
        if (R() < (redZone ? 0.08 : 0.02)) {
          s.resultWhy = 'NOT ROLLING AWAY — THE JACKAL HELD ON TOO LONG';
          d.beginPenalty(atk, REFEREE_CALLS.HANDS_IN, jackal.num);
          return;
        }
      }
      const margin = s.axis - 0.75;                     // 0 .. 0.25
      s.window = clamp(0.12 + (0.25 - margin) * 1.12, 0.12, 0.28);
      s.ballOutAt = s.t + s.window;   // T-05: the presentation window starts when the ball is WON
      s.jackalActive = false;
      s.resultWhy = `BALL WON — ${s.crew.length} v ${s.defCrew.length} CLEARED, FORCE ${(atkF / 100).toFixed(1)} v ${(defF / 100).toFixed(1)} kN`;
      s.stage = 'RECYCLE';
    }
    /* DEFENCE WINS — the ball crosses −0.75. A jackal, not a dice: the
     * reason names the numbers, as FAIR-09 asks. */
    /* PLAYTEST 3 — THE JACKAL IS A NUMBERS CALL (user's spec, both sides):
     * a jackal with MORE men at the breakdown than the attack rips it; a
     * lone jackal cannot steal, he can only slow the ball — and holding on
     * alone is how hands-in penalties happen. The old gate was force-only,
     * so the CPU stole automatically and the rule was invisible. */
    else if (s.axis <= -0.75 && s.defCrew.length > s.crew.length) {
      s.axis = Math.min(s.axis, -0.75);
      if (s.jackalActive && jackal) {
        d.teams[dTeam].stats.turnovers++;
        d.run(dTeam, jackal.num).jackals++;
        d.teams[dTeam].stats.jackals++;
        d.emitEv({ t: d.t, type: 'TURNOVER', x: s.contactX, z: s.contactZ });
        d.commentate('TURNOVER');
        s.resultWhy = `JACKAL WON — ${d.teams[dTeam].nation.short} SHOVED IT BACK, FORCE ${(defF / 100).toFixed(1)} v ${(atkF / 100).toFixed(1)} kN`;
        d.clearRuck();
        d.startOpen(dTeam, s.contactX, s.contactZ - (atk === 'A' ? 1 : -1), 9, 1, 0, 0.75);
        return;
      }
      /* T-18. Real referees ping not-releasing two to four times a match,
       * not eleven — the rate was ending a red-zone possession in every
       * other phase. */
      if (R() < 0.02 + (d.slider(atk, 'aggression') / 100) * 0.02) {
        s.resultWhy = `NOT RELEASING — THE JACKAL HELD UNDER THE SHOVE (AXIS ${s.axis.toFixed(2)})`;
        d.beginPenalty(dTeam, REFEREE_CALLS.NOT_RELEASING, s.players[0].num);
        return;
      }
    }
  }

  /* OFFSIDE LINE — Law 16. At a formed ruck the offside line is the hindmost
   * foot on each side. Rather than penalising men for standing where the shape
   * put them, the line is enforced physically — but as a retreat at a human
   * pace, not a teleport: the old clamp shoved a defender up to 6 m sideways
   * in one frame, which the fault hunt correctly logged as impossible. */
  if (s.ruckFormed) {
    /* SPEC_04: sample the actual pre-retreat actor positions and whistle only a
     * sustained breach. The writer owns the `offsides` stat; the physical
     * walk-back below remains a no-teleport formation correction. Name the
     * reason for the audit/handoff ledger (the whistle owns the stat, the
     * breakdown owns the narrative). */
    if (d.sampleFormedRuckOffside(s, dt)) {
      s.resultWhy = 'OFFSIDE AT THE RUCK — THE DEFENCE NEVER WENT BACK';
      return;
    }
    const fwd = s.attacking === 'A' ? 1 : -1;
    const atkLine = s.contactZ - fwd * 1.0;
    /* T-18. The hindmost foot is the LAW, but a defender does not set a
     * tackle standing on it — the guard comes from two metres behind the
     * line, arriving as the carrier does. With the guard on the foot
     * itself the carrier was contacted the frame he caught a flat ball,
     * every phase lost a metre and a half, and attacks marched slowly
     * backwards out of the red zone. */
    const defLine = s.contactZ + fwd * 3.0;
    const RETREAT = 8 * dt;   // m per frame — a hard back-pedal
    for (const p of d.live) {
      if (p.sinbin > 0 || p.down) continue;
      if (p.team === s.attacking) {
        if ((p.z - atkLine) * fwd > 0) p.z -= Math.min(RETREAT, Math.abs(p.z - (atkLine - fwd * 0.3))) * fwd;
      } else if ((defLine - p.z) * fwd > 0) p.z += Math.min(RETREAT, Math.abs((defLine + fwd * 0.3) - p.z)) * fwd;
    }
  }

  if (s.stage === 'RUCK') {
    const elapsed = s.t - s.groundAt;
    /* T-05. A stalemate is not a spectator sport: if the contest has not
     * settled the ball by three seconds the referee calls for it, exactly
     * as the old ruck clock did. The five-second option window lives in
     * OPEN PLAY (T-27), after the nine has the ball — not in the shove. */
    if (elapsed > 3.0) {
      s.resultWhy = `USE IT — THE CONTEST STALEMATED AT ${s.axis >= 0 ? '+' : ''}${s.axis.toFixed(2)}`;
      d.clearRuck();
      const frOrder0 = [[10, 12, 8], [12, 10, 13], [8, 6, 7]][d.options.firstReceiver ?? 0];
      const fr0 = frOrder0.find((n) => { const q = d.L(atk, n); return q.sinbin <= 0 && !q.down; }) ?? 10;
      d.say(`USE IT — BALL TO ${d.run(atk, fr0).name.toUpperCase()}`);
      const dir0 = atk === 'A' ? 1 : -1;
      d.startOpen(atk, s.contactX, s.contactZ - dir0 * 2.0, fr0, s.phase + 1, s.gainLine, 0.75);
      return;
    }
    /* T-38/T-05. When the ruck clock runs out — a stalemate the contest could
     * not settle inside the law window — the ball is auto-played to the
     * fly-half (first receiver) rather than a scrum being awarded. The clock
     * is the CEILING now, not the resolution: the contest above decides who
     * won and how quick the ball is, and this path is what a stuck ruck ends
     * in. */
    if (elapsed > limit) {
      s.resultWhy = `USE IT — THE CONTEST STALEMATED AT ${s.axis >= 0 ? '+' : ''}${s.axis.toFixed(2)}`;
      d.clearRuck();
      /* T-38 follow-up: the first receiver is a named option, not a literal
       * 10 — a side whose autop is the 12 or a back-row pick is a real call.
       * If the chosen shirt is binned or on the floor, fall back in order. */
      const frOrder = [[10, 12, 8], [12, 10, 13], [8, 6, 7]][d.options.firstReceiver ?? 0];
      const fr = frOrder.find((n) => { const q = d.L(atk, n); return q.sinbin <= 0 && !q.down; }) ?? 10;
      d.say(`USE IT — BALL TO ${d.run(atk, fr).name.toUpperCase()}`);
      const dir = atk === 'A' ? 1 : -1;
      d.startOpen(atk, s.contactX, s.contactZ - dir * 2.0, fr, s.phase + 1, s.gainLine, 0.75);
      return;
    }
  }

  if (s.stage === 'RECYCLE') {
    const outAt = s.ballOutAt > 0 ? s.ballOutAt : s.groundAt + s.window + 0.05;
    if (s.t >= outAt) {
      /* T-05. Window range moved with the contest: a scraped win (axis at
       * the threshold) releases around 1.35 s, a dominant shove around 0.35.
       * Slow ball is the bottom half of that spread. */
      const slow = s.window > 0.9;
      d.teams[atk].stats.rucks++;
      if (slow) d.teams[atk].stats.slowBall++;
      /* T-09: the attack retained the ball — the build grows. */
      d.phasesGained++;
      if (d.phasesGained >= 3) d.seqState = 'BUILDUP';
      // The nine, or the nearest eligible forward, plays it. Never a distant back.
      const dist = ruckDistributor(d.live, atk, s.contactX, s.contactZ);
      const fwd = atk === 'A' ? 1 : -1;
      /* LAW 16 — the defence must be behind the hindmost foot when the ball
       * leaves the ruck. The ruck-formed clamp above has already been walking
       * them there all phase; nothing more is needed here, and the old
       * one-shot teleport (several metres, one frame) is exactly the fault
       * class the hunt exists to catch. */
      d.clearRuck();
      // The nine plays it from the side of the ruck, a stride behind the ball,
      // which is where he actually stands — not on top of the contact point.
      const side = s.contactX > 0 ? -1.8 : 1.8;
      const nearLine = Math.abs(atk === 'A' ? FIELD.tryZFar - s.contactZ : s.contactZ - FIELD.tryZ) < 20;
      /* Playtest 3: the countdown said 3 but the tackle came in under a
       * second — the use-it window now BELONGS to the nine, and the losing
       * side must actually RELEASE AND RETREAT before they may race back. */
      d.startOpen(atk, clamp(s.contactX + side, -32, 32), s.contactZ - fwd * (nearLine ? 0.5 : 1.4), dist.num, s.phase + 1, s.gainLine,
        Math.max(1.0, limit - (s.t - s.groundAt)));
      d.releaseBeat = { z: s.contactZ, dir: fwd, until: d.t + 0.9 };
      /* The buffered distribution fires the instant the ball is out. */
      if (s.bufferedPass && d.isHuman(atk)) {
        const side0 = s.bufferedPass;
        s.bufferedPass = 0;
        d.doPass(side0, false);
      }
    }
  }
  /* T-11 void audit: `_input`/`dTeam` are frozen-interface params — the
   * update loop calls every phase updater with the same signature. Maul
   * input is read via d.pressed above; the defending side is known from
   * the maul state itself. Not unwired subsystems. */
  void _input; void dTeam;
}

export function startBreakdown(d: Director, tacklerNum?: number) {

  const s = d.op!;
  const atk = s.attacking, dir = s.dir;
  const car = d.L(atk, s.carrierNum);
  /* T-08: a tackle is the event; T-09: the carry that just ended feeds the
   * metres-in-last-three-phases window. */
  d.emitEv({ t: d.t, type: 'TACKLE', x: car.x, z: car.z, force: clamp(s.pressure, 0, 1) });
  d.gainWindow.push(clamp(s.gained, -6, 20));
  if (d.gainWindow.length > 3) d.gainWindow.shift();
  /* T-18. FALL FORWARD: a carrier brought down at pace lands a stride
   * beyond the contact point, not dead on it. Without this the ruck formed
   * where he was first touched and every phase lost the metre the tackle
   * radius already cost.
   * SPEC_05 / T-68 (tighten): this write put the carrier up to 1.3 m past
   * the contact point in ONE 16 ms frame — the last remaining snap over the
   * 1.15 m tighten line in the gate harness (measured 1.37 m on B8). The
   * carrier still lands a stride beyond contact, but the distance is now
   * bounded to a per-frame-legal fall so the transition is a hard hit about
   * to go to ground, not a teleport. The ruck reference (cx, cz) below is
   * taken from this bounded position, so the whole breakdown settles where
   * the carrier actually lands. */
  const FALL_FORWARD_MAX = 0.9;   // per-frame-legal landing; keeps maxDisp < 1.15 m
  const fall = clamp(car.vz * dir * 0.13, 0, FALL_FORWARD_MAX);
  car.z += dir * fall;
  const cx = car.x, cz = car.z;
  const dTeam: 'A' | 'B' = d.defending();

  /* T-18 + playtest P1.1. A tackle won by pressure had NO named tackler:
   * credited statistically, but no TACKLER role existed, so nobody wore the
   * tackle clip — the carrier went down next to a man standing there. The
   * nearest defender made the tackle; he IS the tackler, whatever route the
   * whistle took. */
  let tacklerLive = tacklerNum !== undefined ? d.L(dTeam, tacklerNum) : null;
  if (tacklerLive) {
    d.teams[dTeam].stats.tackles++;
    d.run(dTeam, tacklerLive.num).tackles++;
  } else {
    let near: { num: number; d: number } | null = null;
    for (const p of d.live) {
      if (p.team !== dTeam || p.sinbin > 0 || p.down) continue;
      const dd = Math.hypot(p.x - cx, p.z - cz);
      if (!near || dd < near.d) near = { num: p.num, d: dd };
    }
    if (near) {
      tacklerLive = d.L(dTeam, near.num);
      tacklerLive.down = true; tacklerLive.vx = 0; tacklerLive.vz = 0;
      d.teams[dTeam].stats.tackles++;
      d.run(dTeam, near.num).tackles++;
    }
  }
  const tackler = tacklerLive;
  d.run(atk, s.carrierNum).carries++;

  /* PLAYTEST 4 — THE TACKLE IS A DIVE AT THE MAN. The tackler launches his
   * body through the hit: the papercraft dive one-shot rotates him off his
   * feet and into the turf, and the lens takes a slight knock on impact,
   * scaled by how hard the shot arrived (launch thuds 0.15; a try shakes
   * 0.7 — this lives well under both). A tackler already on the deck (the
   * no-name fallback above set him down) is skipped — never animate a man
   * INTO the ground. His role clip (TACKLER -> tackle) takes over next
   * frame, so the dive blends out into the ruck, not through it. */
  if (tackler && !tackler.down && tackler.sinbin <= 0) {
    tackler.clip = 'dive';
    tackler.clipT = 0;
    /* and he travels INTO the hit — a lunge along the carrier line, not a
     * rotation in place. The ruck ease takes over his position next frame. */
    const lx = car.x - tackler.x, lz = car.z - tackler.z;
    const ld = Math.max(0.4, Math.hypot(lx, lz));
    tackler.vx = (lx / ld) * 4.2;
    tackler.vz = (lz / ld) * 4.2;
    d.shake(0.09 + 0.13 * clamp(s.pressure, 0, 1));
  }

  /* T-18. An offload goes to a support RUNNING ONTO THE BALL — level with
   * the carrier or ahead of him. The old code took ANY team-mate within
   * 3.2 m, which is almost always a man trailing the play: the "offload"
   * lost two or three metres every phase, which is why attacks marched
   * slowly backwards and the red zone converted nothing. A trailing man is
   * not an offload; he is the next ruck. */
  const supports = d.live
    .filter((p) => p.team === atk && p !== car && p.sinbin <= 0
      && !p.down && (p.z - cz) * dir > -1.0
      && Math.hypot(p.x - cx, p.z - cz) < 3.2)
    .sort((a, b) => (b.z - a.z) * dir);
  const support = supports[0];
  const offloadChance = (d.slider(atk, 'offload') / 100) * 0.18 + car.attrs.SKL / 1000;
  if (support && R() < offloadChance) {
    d.teams[atk].stats.offloads++;
    d.run(atk, s.carrierNum).offloads++;
    d.commentate('BIG_HIT', '— BUT HE OFFLOADS');
    support.vz = dir * 5.4;
    d.startOpen(atk, support.x, support.z, support.num, s.phase + 1, s.gained);
    return;
  }

  car.down = true;
  car.vx = 0; car.vz = 0;
  if (tackler) { tackler.down = true; tackler.vx = 0; tackler.vz = 0; }

  // three named attackers, in arrival order, assigned before the whistle
  const commitA = clamp(1 + Math.round((d.slider(atk, 'ruckCommit') / 100) * 2), 1, 3);
  const crew = assignCrew(d.live, atk, cx, cz, commitA + 1);
  // T-39. Send three defenders so the CPU genuinely contests the ruck instead
  // of watching it. The first is the jackal, the other two counter-ruck.
  const defCrew = assignCrew(d.live, dTeam, cx, cz, 3);
  const players: BreakdownState['players'] = [
    { role: 'CARRIER', num: s.carrierNum, team: atk, x: cx, z: cz, down: true },
  ];
  if (tackler) players.push({ role: 'TACKLER', num: tackler.num, team: dTeam, x: cx + 0.6, z: cz - dir * 0.5, down: true });
  crew.forEach((p, i) => {
    if (p.num === s.carrierNum || (tackler && p.num === tackler.num)) return;
    p.down = i < 1;
    players.push({
      role: i === 0 ? 'FIRST CLEARER' : 'CLEANER', num: p.num, team: atk,
      x: cx - 0.8 - i * 0.5, z: cz - dir * (1.3 + i * 0.4), down: i < 1,
    });
  });
  /* T-24c. The first defender to a breakdown ALWAYS contests the ball. The old
   * code rolled a 25-65% chance of sending a jackal, so most rucks had nobody
   * over the ball and the defence could never win it. A defender over the ball
   * is the default, not the exception. */
  defCrew.forEach((p, i) => {
    if (tackler && p.num === tackler.num) return;
    players.push({
      role: i === 0 ? 'JACKAL' : 'COUNTER', num: p.num, team: dTeam,
      x: cx + 0.5 + i * 0.4, z: cz + dir * (1.0 + i * 0.5), down: false,
    });
  });

  const zone = dir > 0 ? 50 - cz : 50 + cz;
  const ep = clamp(0.12 + Math.max(0, (75 - zone) / 75) * 4.2, 0.05, 4.3);
  d.bd = {
    t: 0, stage: 'CONTACT', attacking: atk, contactX: cx, contactZ: cz,
    gainLine: s.gained, ruckFormed: false, jackalActive: defCrew.length > 0,
    ball: { x: cx, z: cz, placed: false }, players,
    crew: crew.map((p) => p.num), defCrew: defCrew.map((p) => p.num),
    groundAt: -1, ballOutAt: 0, phase: s.phase, expectedPoints: ep,
    power: { A: 40 + d.L(atk, 8).attrs.PWR * 0.5, B: 40 + d.L(dTeam, 7).attrs.PWR * 0.5 },
    window: 0, result: '', resultWhy: '',
    contestMeter: 0.5, meterDir: 1, meterOn: false, waggle: 0,
    commitA, commitB: 2, advantageOf: 0,
    axis: 0, axisVel: 0, contestT: 0, redT: 0,
  };
  d.phase = 'BREAKDOWN';
  d.op = undefined;
  /* T-80 — the pile is built at the LIVE positions (no teleport), each body
   * seeking its slot mark. The ball body is the contested mass. */
  latchMount(d, d.bd!, dir);
  if (d.isHuman(atk)) d.showHint('A/D POUND TO CLEAR OUT — OR WAIT FOR THE NINE', 2.6);
  d.setCtrl(atk, 9);
}
