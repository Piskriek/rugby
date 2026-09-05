/**
 * T-03 — ENGINE/OPEN. Extracted verbatim from director.ts: open play — the
 * carrier, the defence's honest contact radius, scoring and boundaries, the
 * pass/step/fend/dummy acts and the CPU carrier brain. No behaviour change;
 * a Director reference in.
 */

import { Director, Input, OpenPlayState } from '../director';
import { FIELD } from '../../render/retro';
import { DIFFICULTY_TABLE } from '../data';
import { contractFor } from '../jlr';
import {
  passOptions, widestGap, avoidTouch, maxSpeed, FORWARDS,
} from '../intelligence';
import { defenceMark } from '../intelligence';
import { R } from './rng';
import { steer } from '../intelligence';
import { PlayCall } from '../shapes';
import { REFEREE_CALLS } from '../data';
import { wetnessOf, windOf, WEATHERS } from './weather';
import { solvePassAim, passReleaseRel, fwdProfile, forwardMetres, clampAimLegal, PASS_SPEED } from './throwforward';
import { approach } from './approach';
import { clamp } from './clamp';
import {
  beginLatch, clearLatch, tickLatch, shouldDive,
  DIVE_FLIGHT_SECONDS, DIVE_REACH_BONUS,
} from './latch';
import {
  anticipates, passIntersection, runOnVelocity, RUN_ON_SPEED_FRACTION,
} from '../behaviour/backline-echelon';
import {
  forwardAttackPassDispatchFailures, forwardAttackPlayerWriteFailures,
  forwardAttackStateWriteFailures, snapshotForwardAttackPlayer,
} from '../forwardAttackGates';

export function upOpen(d: Director, dt: number, _input: Input, pressed: Set<string>, released = new Set<string>()) {

  if (!d.op) { d.startOpen(d.possession, 0, -10); return; }
  const s = d.op;
  s.t += dt;
  const car = d.L(s.attacking, s.carrierNum);
  const human = d.isHuman(s.attacking);

  /* T-35. The ball is in flight from passer to receiver. Carry it across with a
   * visible arc, then hand possession over on arrival. No input is processed
   * while it flies — the pass is a commitment. */
  if (s.ball.live) {
    const rec = d.L(s.attacking, s.pendingReceiver);
    /* Playtest 3: a throw flies at ~13 m/s OVER ITS OWN LENGTH — a 6 m pop
     * takes 0.46 s, a 20 m cut-out 1.5 s. The old fixed half-second homing
     * made every pass feel like a teleport. */
    s.passT += dt * (13 / s.passDist);
    /* T-40, REWRITTEN BY SPEC_13.
     *
     * The receiver was steered to `ball.z + dir * 1.0` — a point one metre in
     * FRONT of the ball, every frame — while the ball flew at the receiver's
     * live position. That is a pursuit curve, and it is a physics violation:
     * the ball was dragged forward up the pitch by the man it was chasing.
     * Measured, it took six to eight passes per 600 s that had left the
     * thrower's hands perfectly legally and landed them up to 2.9 m forward.
     *
     * Now the ball flies to a FIXED aim point, solved once at release, and the
     * receiver runs to that same point. Nobody chases anybody. The flight is
     * a straight line, so the release vector, the average flight velocity and
     * the landing point are all the same fact — which is what lets one law be
     * written once and tested at any of the three. */
    rec.tx = clamp(s.passTargetX, -33, 33);
    rec.tz = clamp(s.passTargetZ, -58, 58);
    rec.urgency = 1;
    rec.job = 'TAKE THE PASS';
    steer(rec, dt, true);

    /* PLAYTEST 4: THE FLASH, preserved. The ball flies at its TRUE 13 m/s
     * ground speed over its own length — a 6 m pop takes 0.46 s, a 20 m
     * cut-out 1.5 s. The difference is WHAT it flies at: a fixed point
     * solved at release, not a man who is being pushed forward to meet it. */
    const dx = s.passTargetX - s.ball.x, dz = s.passTargetZ - s.ball.z;
    const dd = Math.max(0.01, Math.hypot(dx, dz));
    const step = Math.min(dd, PASS_SPEED * dt);
    s.ball.x += (dx / dd) * step;
    s.ball.z += (dz / dd) * step;
    s.ball.y = 1.05 + Math.sin(Math.min(1, s.passT) * Math.PI) * 0.8;
    /* SPEC_13: the catch is PROXIMITY TO THE RECEIVER, not arrival at the
     * target. Flying to a fixed point means the ball can reach the aim with
     * the receiver two metres away, and snapping it to him there is the
     * teleport T-40 was written to prevent — and it turned a legal throw into
     * a ball that jumped forward at the moment of the catch. */
    const toRec = Math.hypot(rec.x - s.ball.x, rec.z - s.ball.z);
    const arrived = dd <= step;
    if (toRec <= Math.max(0.55, PASS_SPEED * dt * 1.05) || arrived || s.passT >= 1.35) {
      s.ball.live = false;
      s.carrierNum = s.pendingReceiver;
      /* SPEC_11: `focusPoint()` is Formation's anchor, and it reads
       * `op.carrierX/Z`. Those are synced by the carry path below, which
       * this branch returns before reaching — so for the whole frame the
       * catch lands, the anchor still sat on the PASSER, up to eight metres
       * behind the new carrier. Every mark in the formation was written
       * against a stale ball for that frame, and the camera and the HUD
       * pointed at a man who no longer had it. */
      s.carrierX = rec.x; s.carrierZ = rec.z;
      rec.carrier = true;
      // catch where the receiver actually is — no snap.
      s.ball.x = rec.x; s.ball.z = rec.z;
      s.originZ = rec.z; s.originX = rec.x; s.gained = 0;
      /* T-18. A receiver of a pass is fair game — but not in the act of
       * catching. A fifth of a second of catch grace is what lets a passing
       * movement exist at all: without it the converging defender hits the
       * receiver on the frame he takes the ball and every chain dies at one
       * pass. Reset the carry clock for the new man. */
      s.heldT = 0;
      s.protect = 0.2;
      /* T-18. THE RELEASE. A receiver running a CALLED passing play has
       * decided before the ball arrives — he draws and gives inside half a
       * second. The old flat 0.3-0.8 s cadence meant the rushing defender
       * met him before his first decision tick: 56 non-nine decisions a
       * match, 23 of them already at 0.8+ pressure. A carry play keeps
       * the honest beat. */
      {
        const c = (d.lastCall ?? 'POD_CARRY') as PlayCall;
        const quick = ['WIDE_SWEEP', 'MISS_PASS', 'TUNNEL_PASS', 'LOOPL_PASS', 'POD_TIP', 'SWITCH'].includes(c);
        s.aiTimer = quick ? 0.15 + R() * 0.22 : 0.3 + R() * 0.5;
      }
      d.setCtrl(s.attacking, s.carrierNum);
      d.run(s.attacking, s.carrierNum).carries++;
      d.refreshPassOptions();
    }
    return;
  }

  /* T-31/T-30. The dive is committed: no steering while it lives, the
   * slide decays the lateral, and when it expires he is back on his feet
   * at the mark he slid to. The scoring test here runs BEFORE any tackle
   * test, so a dive that crosses grounds even under the tackler's hand —
   * which is the whole point of diving for the line. */
  if (s.dive > 0) {
    s.dive -= dt;
    /* RIDERS DRAG HIM DOWN. A tackler on the slide adds real deceleration —
     * he cannot un-legal a grounding that happens, but he can stop it
     * happening. Launching into traffic from five metres falls short;
     * launching at 2-3 m grounds. That race IS the pick-and-go. */
    const ridden = d.live.some((q) => q.team !== s.attacking && q.sinbin <= 0 && !q.down
      && Math.hypot(q.x - car.x, q.z - car.z) < 1.2);
    car.vx *= Math.exp(-2.2 * dt);
    car.vz *= Math.exp(-(ridden ? 1.1 : 0.5) * dt);
    car.x = clamp(car.x + car.vx * dt, -34.5, 34.5);
    car.z = clamp(car.z + car.vz * dt, -61, 61);
    s.carrierX = car.x; s.carrierZ = car.z;
    s.vx = car.vx; s.vz = car.vz;
    s.z = car.z;
    s.heldT += dt;
    s.gained = (car.z - s.originZ) * s.dir;
    s.toLine = Math.abs((s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ) - car.z);
    const line = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
    if ((s.dir > 0 && car.z >= line) || (s.dir < 0 && car.z <= line)) { d.scoreTry(); return; }
    if (s.dive <= 0) {
      /* THE REACH. The slide is spent an arm's length from the line: the
       * ball is grounded by the reach, not the momentum. This is the last
       * half metre of every diving try ever scored. */
      if (s.toLine < 0.5) { d.scoreTry(); return; }
      if (car.clip === 'dive' && !car.down) { car.clip = 'carry'; car.clipT = 0; }
    }
    return;
  }

  // ---- carry the carrier from the live model (single source of truth) ----
  s.carrierX = car.x; s.carrierZ = car.z;
  s.vx = car.vx; s.vz = car.vz;
  s.z = car.z;
  s.heldT += dt;
  s.gained = (car.z - s.originZ) * s.dir;
  s.toLine = Math.abs((s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ) - car.z);
  /* METRES — only ground gained toward the attacking line counts. The old
   * line multiplied by s.dir a SECOND time, so team B's metres accumulated
   * as negatives and a full match read "-38 m carried per team". */
  d.teams[s.attacking].stats.metres += Math.max(0, car.vz * dt * s.dir);
  d.run(s.attacking, s.carrierNum).metres += Math.max(0, car.vz * dt * s.dir);

  if (s.burst > 0) s.burst -= dt;
    s.protect = Math.max(0, s.protect - dt);
    s.podHold = Math.max(0, s.podHold - dt);
  s.burstCd = Math.max(0, s.burstCd - dt);
  s.stepCd = Math.max(0, s.stepCd - dt);
  s.fendCd = Math.max(0, s.fendCd - dt);

  // ---- verbs. Sampled now, resolved now, never queued. ----
  if (s.speedDebt < 1) s.speedDebt = Math.min(1, s.speedDebt + dt * 0.45);
  /* LATCH-AND-DRAG — A HELD MAN HAS NO VERBS.
   *
   * The drag is a commitment, exactly as the goal-line dive is. With hands
   * on him the carrier cannot pass, kick, step, fend, dummy or burst: his
   * only outs are the try line and time. Without this gate the whole middle
   * of the tackle is escapable — the CPU brain in particular fires a pass on
   * the very next decision tick and the drag ends before it has been seen,
   * which is precisely what the measured 0/195 dead-momentum takedowns were
   * telling us. He is still RUNNING (that is the churn); he simply cannot
   * play the ball while he is being held. */
  if (s.latch) {
    /* he keeps his own legs — the human's input branch and cpuCarrier both
     * still integrate him, taxed by the drag multiplier in maxSpeed(). */
    if (human) {
      const dragCar = d.L(s.attacking, s.carrierNum);
      dragCar.job = 'FIGHT THROUGH IT — KEEP YOUR LEGS GOING';
    } else {
      cpuCarrierDrag(d, dt, s);
    }
  } else if (human) {
    // SPACE performs the context action when the player has asked for that
    if (pressed.has('action') && (d.options.spaceAction ?? 0) !== 0) { d.fireContext(); return; }
    if (pressed.has('step') && s.stepCd <= 0) { s.stepCd = 2.2; d.doStep(dt); }
    if (pressed.has('fend') && s.fendCd <= 0) { s.fendCd = 1.6; d.doFend(); }
    if (pressed.has('dummy')) d.doDummy();
    if (pressed.has('action') && s.burstCd <= 0) { s.burst = 0.8; s.burstCd = 5.5; }
    if (pressed.has('passL')) { d.doPass(-1, false); return; }
    if (pressed.has('passR')) { d.doPass(1, false); return; }
    if (pressed.has('cutL')) { d.doPass(-1, true); return; }
    if (pressed.has('cutR')) { d.doPass(1, true); return; }
    /* Playtest P1.4: RUN AND HOLD. The old press fired startKick straight
     * into the AIM state, which froze the whole match while the meter ran —
     * a punt from hand paused the game. Now the key HELDS: charge builds
     * while you keep running, release strikes. Only tee kicks (GOAL,
     * RESTART, DROP_OUT) keep the freeze-and-aim ritual. */
    const kickKeys: Record<string, 'PUNT' | 'GRUBBER' | 'DROP_GOAL'> = {
      kick: 'PUNT', grubber: 'GRUBBER', drop: 'DROP_GOAL',
    };
    if (s.kickCharge > 0) {
      s.kickCharge = Math.min(1, s.kickCharge + dt / 1.6);
      d.showHint(`${s.kickKind} CHARGING ${Math.round(s.kickCharge * 100)}% — RELEASE TO STRIKE`, 0.3);
      let want = '';
      for (const k of Object.keys(kickKeys)) if (released.has(k)) want = k;
      if (want) {
        if (kickKeys[want] !== s.kickKind) {
          s.kickCharge = 0; s.kickKind = '';   // changed his mind mid-charge
        } else {
          const kind = s.kickKind;
          const pow = Math.max(0.3, s.kickCharge);
          s.kickCharge = 0; s.kickKind = '';
          d.startKick(s.attacking, kind, { x: car.x, z: car.z }, s.carrierNum);
          if (d.kk) d.launch(pow, d.kickerAccuracy(d.kk), windOf(d.options));
          return;
        }
      }
    } else {
      for (const k of Object.keys(kickKeys)) {
        if (pressed.has(k)) { s.kickCharge = 0.001; s.kickKind = kickKeys[k]; break; }
      }
    }
    if (pressed.has('contact')) { d.startBreakdown(); return; }
    if (pressed.has('switchPlayer')) d.cycleDefender();
  } else {
    d.cpuCarrier(dt, s);
    /* T-16 FREEZE. cpuCarrier's `return`s return from cpuCarrier, not from
     * here. A pass or kick it launched has already torn down `d.op` and
     * moved the phase — continuing on with the stale `s` read `d.op!`
     * inside startBreakdown and threw ("reading 'attacking'"), which the
     * watchdog then logged as a BREAKDOWN/SCRUM freeze. Bail the moment the
     * episode we were processing is no longer live. */
    if (d.phase !== 'OPEN_PLAY' || d.op !== s || s.ball.live) return;
  }

  d.refreshPassOptions();

  // ---- scoring and boundaries ----
  const line = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
  if ((s.dir > 0 && car.z >= line) || (s.dir < 0 && car.z <= line)) { d.scoreTry(); return; }
  if (Math.abs(car.x) > 34) {
    d.say('INTO TOUCH');
    d.startLineout(d.defending(), car.z, Math.sign(car.x) * 6);
    return;
  }
  if (car.z > FIELD.deadZFar - 1 || car.z < FIELD.deadZ + 1) { d.touchDown(); return; }

  // ---- defenders: honest contact radius, honest reaction ----
  const dTeam = d.defending();
  const diff = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)];
  /* PLAYTEST 3 / T-42 — THE RELEASE BEAT (consumer). breakdown.ts sets
   * d.releaseBeat when the ball comes out (0.9 s). Until it expires, any
   * defender inside two metres of the release line back-pedals instead of
   * chasing: the use-it window belongs to the nine, and the pick-and-go
   * stop-start no longer pulls the whole cluster onto the ball and snaps
   * it back (the contract/expand pulse). The controlled shirt is exempt —
   * the human owns his own retreat. 'release' is a sanctioned writer
   * (intelligence.ts ownership check) and the branch CONTINUES, so steer()
   * never fights it in the same frame. */
  const rb = d.releaseBeat;
  const beatOn = !!(rb && d.t < rb.until);
  /* SPEC_04: this is a distinct defensive-line-reset opportunity. Sample the
   * live positions before the existing human-pace retreat corrects them. */
  const dists: { num: number; d: number }[] = [];
  for (const p of d.live) {
    if (p.beatenT > 0) p.beatenT = Math.max(0, p.beatenT - dt);
    if (p.team !== dTeam || p.sinbin > 0) continue;
    if (beatOn && (!d.isHuman(p.team) || p !== d.ctrlPlayer)) {
      const gap = (p.z - rb!.z) * rb!.dir;
      if (gap < 2.0) {
        p.z -= Math.min(2.0 - gap, 8 * dt) * rb!.dir;
        p.movedBy = 'release';
        p.job = 'RELEASE AND RETREAT';
        continue;   // the retreat owns this frame — no steer on top
      }
    }
    const dd = Math.hypot(p.x - car.x, p.z - car.z);
    dists.push({ num: p.num, d: dd });
    // reaction per player, capped. Never scaled up to fake difficulty.
    const react = d.isHuman(dTeam) ? 0.86 : diff.reaction;
    const aware = 1 - clamp((100 - p.attrs.AWA) / 400, 0, 0.22);
    /* T-18. The line holds its shape until the carrier is genuinely in
     * a channel (8 m, not 11): defenders shooting up early from eleven
     * metres was why every carry died on the gain line and the attack
     * never reached the 22. */
    const chase = (dd < 8 || FORWARDS.includes(p.num)) && p.beatenT <= 0;
    const sp = (chase ? 6.8 : 4.2) * (0.88 + react * 0.14) * (0.7 + aware * 0.3);
    // gap seeking: defenders hold their lane, they do not ball-watch
    const mark = defenceMark(p.num, d.shape());
    /* T-18. While the ball is in FLIGHT the line holds its lane and reads
     * the pass — it does not sprint at the man who has already given it
     * up. Converging on the passer through the pass sequence gave the
     * defence three free metres every phase and the attack could never
     * close the last six metres to the line. */
    const towardBall = dd < 12 && !s.ball.live;
    const driftX = towardBall ? (car.x - p.x) * 0.5 : (mark.x - p.x);
    const targetZ = towardBall ? car.z - s.dir * 0.5 : mark.z;
    const tz2 = targetZ - (towardBall ? 0 : 0);
    p.tx = clamp(p.x + clamp(driftX, -sp * dt, sp * dt), -33, 33);
    p.tz = clamp(p.z + clamp(tz2 - p.z, -sp * dt, sp * dt), -58, 58);
    p.urgency = 1;
    p.job = contractFor(p.num).job.DEFENCE_LINE ?? 'DEFEND YOUR CHANNEL';
  }
  dists.sort((a, b) => a.d - b.d);
  const nearest = dists[0];
  /* SPEC_14 / 14-c — THE NEAREST *ELIGIBLE* DEFENDER.
   *
   * A slipped tackle sets `beatenT` for 1.1-1.6 s. Only `dists[0]` was ever
   * offered to the tackle test, so a beaten man standing closest made the
   * carrier untouchable until his timer expired — a beaten man was a SHIELD.
   * Measured at 3.7% of contact frames (26 of 711). It also stops a man lying
   * on the turf from completing a tackle: `p.down` was never excluded.
   *
   * Net effect, four seeds x three difficulties: tackles made 63 -> 78.
   *
   * `nearest` is kept for pressure, the ring count and the line-break read,
   * which are deliberately "closest body" measures. */
  const eligible = (num: number): boolean => {
    const p = d.L(dTeam, num);
    return !!p && p.beatenT <= 0 && !p.down && p.sinbin <= 0;
  };
  const tackler1 = dists.find((x) => eligible(x.num)) ?? null;
  /* T-18. The old weights (nearest/9, +0.09 per man within 11 m) meant any
   * carrier with the regulation three convergers nearby read pressure ~0.94
   * — "a defender is physically on him" — and every downstream gate (pass,
   * offload, sprint, take contact) behaved as if he was being tackled. With
   * honest weights, ~0.7 is heavily marked; only sub-metre contact reads
   * above 0.9. This one formula was why a match produced twenty passes. */
  const ring = dists.filter((x) => x.d < 11).length;
  s.pressure = approach(s.pressure, clamp(1 - (nearest?.d ?? 9) / 7 + ring * 0.04, 0, 1), 5, dt);
  /* T-18. A line break is beating the line and coming clear — six metres
   * through a set defensive line (with the beat man recovering behind the
   * play) is a genuine break; the old nine counted once-a-match accidents.
   * T-13. COMING CLEAR means exactly that: the nearest defender beyond
   * 3.5 m. A carry that punches six metres through a soft pocket with the
   * chase already at two metres is a half-break — it was inflating the
   * count (7.8/team) while converting almost nothing, because there is no
   * race to win from there. Only the genuine clearance arms the finisher
   * rules (keeper, sprint, posts line); the pocket punch takes its tackle
   * like every other hard carry. */
  if (s.gained > 6 && !s.lineBreak && (nearest?.d ?? 9) > 3.5) {
    s.lineBreak = true;
    d.teams[s.attacking].stats.lineBreaks++;
    d.run(s.attacking, s.carrierNum).breaks++;
    d.emitEv({ t: d.t, type: 'LINE_BREAK', x: d.focusPoint().x, z: d.focusPoint().z });
    d.commentate('LINE_BREAK');
  }

  /* ---- LATCH-AND-DRAG: advance a live latch ----
   *
   * The hands are already on. The carrier is still being run by his ordinary
   * owner (the human input branch or cpuCarrier, both taxed through
   * maxSpeed's drag multiplier), so all that happens here is that the
   * defender is towed along on his hip and the two takedown triggers are
   * tested. This sits AFTER the carrier has been integrated for the frame —
   * the anchor has to be his position now, not his position last frame, or
   * the hanging man lags a stride behind and the illusion breaks. */
  if (s.latch) {
    const lc = d.L(s.attacking, s.latch.carrierNum);
    const lt = d.L(s.latch.tacklerTeam, s.latch.tacklerNum);
    const brokenLink = !lc || !lt || lc.num !== s.carrierNum
      || lt.sinbin > 0 || lt.beatenT > 0 || s.ball.live;
    if (brokenLink) {
      /* the ball moved on, or the holder was removed: let him go. */
      clearLatch(s, lc, lt);
    } else {
      const tick = tickLatch(s.latch, lc, lt, dt);
      s.carrierX = lc.x; s.carrierZ = lc.z;
      s.vx = lc.vx; s.vz = lc.vz; s.z = lc.z;
      s.heldT += dt;
      s.gained = (lc.z - s.originZ) * s.dir;
      s.toLine = Math.abs((s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ) - lc.z);
      /* THE REACH, through the drag. A man being dragged over the line still
       * scores — the tackle has not been completed, and a held carrier who
       * reaches the plane has grounded it. This test has to live here or the
       * latch would swallow every close-range try. */
      const dragLine = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
      if ((s.dir > 0 && lc.z >= dragLine) || (s.dir < 0 && lc.z <= dragLine)) {
        clearLatch(s, lc, lt);
        d.scoreTry();
        return;
      }
      if (tick.end) {
        /* THE TAKEDOWN. Hand straight over to the existing path: the crew
         * assignment, then the 0.3 s kineticImpact slide that carries the
         * pair the last metre into the ruck. The drag distance is real
         * ground the attack has made and is already in s.gained. */
        const tacklerNum = lt.num;
        clearLatch(s, lc, lt);
        if (tick.dragged > 2.2) d.commentate('BIG_HIT', '— BUT HE DRAGS HIM ON');
        d.startBreakdown(tacklerNum);
        return;
      }
      /* the drag continues: no verbs, no passes, no new tackles this frame.
       * A held man's only outs are the line (above) and time. */
      d.refreshPassOptions();
      s.current.label = d.contextLabel(s);
      return;
    }
  }

  // ---- the human defender chooses his tackle ----
  /* PLAYTEST 4: Q WORKS ON DEFENCE. It lived only in the attack branch, so
   * the user was told "Q — change player" and it never fired while
   * defending. Route it here first — a switch must not eat a tackle press. */
  if (human && pressed.has('switchPlayer')) { d.cycleDefender(); return; }
  if (!human) { /* CPU tackles resolve below */ }
  else if ((pressed.has('tackleDive') || pressed.has('tackleSmother')) && s.protect <= 0) {
    const dive = pressed.has('tackleDive');
    // honest ranges: a dive reaches 3.5 m, a smother 1.4 m
    const reach = dive ? 3.5 : 1.4;
    const dd = tackler1 ? tackler1.d : 9;
    if (dd <= reach) {
      const tacklerNum = tackler1!.num;
      const tp = d.L(dTeam, tacklerNum);
      const safe = dive ? 0.86 : 0.95;             // smother is safer, no chase value
      const grip = tp.attrs.PWR;
      const chance = clamp((safe + grip / 400 - car.attrs.PWR / 420) * (0.85 + d.assists.tackle * 0.25), 0.4, 0.98);
      d.setCtrl(dTeam, tacklerNum);
      if (R() < chance) {
        /* LATCH-AND-DRAG: a successful dive/smother gets HANDS ON, it does
         * not put the man down on the frame it lands. The drag decides
         * that. The dive flag is true here by construction — he left his
         * feet to make it. */
        beginLatch(s, car, tp, dive);
        return;
      }
      d.teams[dTeam].stats.missed++;
      d.commentate('BIG_HIT', '— AND HE MISSES HIM!');
      tp.urgency = 0.25;
    } else {
      d.showHint(`OUT OF RANGE — DIVE REACHES 3.5 m, YOU ARE ${dd.toFixed(1)} m AWAY`, 1.6);
    }
  }

  /* ---- the tackle: an honest 1.1 m contact radius, no warping ----
   * `protect` is the answer to the ball going straight back into the ruck. When
   * the nine plays it away from a breakdown the defence has to be behind the
   * offside line and cannot legally touch him for the first stride. Without
   * this the nearest defender was on the new carrier inside two frames and the
   * match became one endless ruck. */
  /* PART 3 — THE LEAP. A defender closing hard from just outside the contact
   * radius leaves his feet BEFORE he can reach the man, so that the grab a
   * few frames later lands as the end of a dive rather than as a man walking
   * into someone. Presentation only: the latch itself still happens at the
   * honest 1.1 m radius below, and a dive that does not connect is simply a
   * defender who ends up on the floor — which is also what happens in the
   * real game. */
  if (tackler1 && !s.latch && s.protect <= 0) {
    const diver = d.L(dTeam, tackler1.num);
    if (diver && shouldDive(diver, car, tackler1.d, 1.1)) {
      diver.clip = 'dive';
      diver.clipT = 0;
      /* THE DIVE IS A COMMITMENT. Arming this clock is what turns the leap
       * from free presentation into a risk: while it runs he cannot steer
       * (see the lock in think()), his reach is extended, and if it expires
       * with nobody in his hands he lands face-down and is out of the line.
       * Measured before this existed: 69% of defender dives missed and the
       * man simply jogged on, so diving was strictly better than not. */
      diver.diveT = DIVE_FLIGHT_SECONDS;
      /* he commits his body along the line to the man — the lunge is what
       * carries him the last metre into the radius. */
      const lx = car.x - diver.x, lz = car.z - diver.z;
      const ld = Math.max(0.4, Math.hypot(lx, lz));
      diver.vx = (lx / ld) * 5.2;
      diver.vz = (lz / ld) * 5.2;
    }
  }

  /* A man climbing off the floor cannot make a tackle. Without this a
   * recovering defender could be handed a latch, and the latch would then
   * snap him onto the carrier's hip while tickRecovery held his velocity at
   * zero — two owners for one player, which showed up as a leaked latch
   * frame and 29 stalled drag frames in the probe. */
  /* A diving man is stretched out, so he reaches further than a standing one:
   * this is the reward half of the risk. */
  const t1 = tackler1 ? d.L(dTeam, tackler1.num) : null;
  const reachRadius = t1 && (t1.diveT ?? 0) > 0 ? 1.1 * DIVE_REACH_BONUS : 1.1;
  if (tackler1 && tackler1.d < reachRadius && s.protect <= 0
    && (d.L(dTeam, tackler1.num).recoverT ?? 0) <= 0
    && (car.recoverT ?? 0) <= 0) {
    const carrierP = car;
    const tackler = d.L(dTeam, tackler1.num);
    const grip = tackler.attrs.PWR;
    const assist = d.isHuman(dTeam) ? d.assists.tackle : 0.5;
    const chance = clamp(0.6 + grip / 340 - carrierP.attrs.PWR / 420 + assist * 0.2, 0.35, 0.95);
    /* T-18 — THE SLIPPED TACKLE. Every contact used to end in a tackle:
     * the roll retried every frame until it succeeded, so a defender who
     * reached the ball simply waited him out. Real matches slip eight to
     * twelve tackles, and that is where line breaks — and tries — come
     * from. Once per defender per episode, first contact can be beaten:
     * the tackler is bounced and needs a second to reset. */
    if (!s.beatTried) s.beatTried = new Set<number>();
    if (!s.beatTried.has(tackler1.num)) {
      s.beatTried.add(tackler1.num);
      const slip = clamp(0.07 + (carrierP.attrs.SKL - tackler.attrs.SKL) / 900 + (carrierP.attrs.PWR - grip) / 1000, 0.03, 0.18);
      if (R() < slip) {
        d.teams[dTeam].stats.missed++;
        d.commentate('BIG_HIT', '— AND HE BEATS THE TACKLE!');
        tackler.beatenT = 1.1 + R() * 0.5;
        tackler.urgency = 0.3;
        /* He steps THROUGH the tackle — the burst is what turns a slipped
         * tackle into a line break instead of a slow stumble past a fallen
         * defender. */
        car.vz += s.dir * 2.2;
        car.vx += (R() - 0.5) * 1.2;
      }
    }
    if (tackler.beatenT <= 0 && R() < chance * dt * 10) {
      /* T-18 — THE REACH. A carrier driven at the line from close range
       * grounds it before the tackle can hold him up. This low drive over
       * the line is how close-range tries are actually scored; without it
       * the tackle froze him half a metre short every time and the red
       * zone converted nothing. */
      const line = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
      const distLine = (line - car.z) * s.dir;
      /* T-13. A reaching lunge covers two-plus metres — the old 1.4 m
       * window sat INSIDE the 1.1 m tackle contact radius, so the tackle
       * roll always fired first and the red zone converted by attrition
       * only (16.5 entries a match, 3 tries). */
      if (distLine < 2.4 && car.vz * s.dir > 1.2 && R() < 0.34 + car.attrs.PWR / 300) { d.scoreTry(); return; }
      /* LATCH-AND-DRAG. THE HANDS GO ON — the man does not go down.
       *
       * This is the frame the tackle used to end on: the radius test passed
       * and startBreakdown tore the episode down on the spot, which is why
       * contact read as an event rather than a collision. The defender now
       * LATCHES instead. He is towed on the carrier's hip while the carrier
       * churns forward under the drag penalty, and the takedown fires from
       * the latch tick above when the momentum dies (< 1.5 m/s) or the
       * 0.6 s drag timer expires — at which point the existing
       * startBreakdown path and its 0.3 s kineticImpact slide finish the
       * job exactly as before. */
      beginLatch(s, car, tackler, tackler.clip === 'dive');
      return;
    }
    if (R() < 0.1 * dt * 10) d.commentate('BIG_HIT');
  }

  /* OFFSIDE — there is no offside line in open play. The law applies at a set
   * piece and at a ruck or maul, where the line is the hindmost foot. Penalising
   * defenders for standing near the ball in open play was a law error and it
   * was producing penalties constantly. See upBreakdown for the real line. */
  void dTeam;

  s.current.label = d.contextLabel(s);
}

export function contextLabel(d: Director, s: OpenPlayState) {

  const car = d.ctrlPlayer;
  if (car.team === s.attacking) {
    const l = d.passOpts.find((o) => o.side === -1);
    const r = d.passOpts.find((o) => o.side === 1);
    return [
      `J PASS ${l ? d.L(s.attacking, l.player.num).num : '—'}`,
      `K PASS ${r ? d.L(s.attacking, r.player.num).num : '—'}`,
      'L PUNT', 'H GRUBBER', 'P DROP', 'I CONTACT', 'F FEND', 'G STEP',
    ].join(' · ');
  }
  return 'X DIVING TACKLE · C SMOTHER · Q SWITCH DEFENDER';
}

export function doStep(d: Director, dt: number) {

  const s = d.op!;
  const car = d.L(s.attacking, s.carrierNum);
  // a step only beats a square-on defender inside 2.5 m
  const dTeam = d.defending();
  const near = d.live
    .filter((p) => p.team === dTeam)
    .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))[0];
  const dd = near ? Math.hypot(near.x - car.x, near.z - car.z) : 9;
  const square = near ? Math.abs(near.x - car.x) < 2.5 : false;
  if (!square || dd > 2.6) { d.showHint('NO ROOM TO STEP — THE DEFENDER IS LATERAL', 1.6); return; }
  const chance = clamp(0.82 - dd * 0.07 + (car.attrs.SPD / 500), 0.15, 0.88);
  /* Playtest P3.10: a step is a gamble — the beat is bought with pace. */
  s.speedDebt = 0.72;
  if (R() < chance) {
    /* T-16/NO-TELEPORT. The step used to write `car.x ± 3.4` outright — an
     * instantaneous 3.4 m slide, over twice the teleport threshold. It is now
     * a lateral velocity impulse; the feet carry him there. */
    const side = R() < 0.5 ? -1 : 1;
    car.vx = approach(car.vx, side * 6.4, 14, dt);
    // defender recovers in 0.6 s, so a step buys space rather than a free run
    near.urgency = 0.25;
    d.say('HE STEPS OUT OF THE TACKLE');
    d.shake(0.24);
  } else {
    s.pressure = clamp(s.pressure + 0.32, 0, 1);
  }
}

export function doFend(d: Director, ) {

  const s = d.op!;
  const car = d.L(s.attacking, s.carrierNum);
  const dTeam = d.defending();
  const near = d.live
    .filter((p) => p.team === dTeam)
    .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))[0];
  if (!near || Math.hypot(near.x - car.x, near.z - car.z) > 1.6) { d.showHint('NOBODY TO FEND', 1.4); return; }
  const contest = car.attrs.PWR / (car.attrs.PWR + near.attrs.PWR);
  if (R() < contest) {
    car.vz = Math.max(car.vz, s.dir * 5.4);
    d.teams[s.attacking].stats.tacklesBroke++;
    d.run(s.attacking, s.carrierNum).breaks++;
    d.commentate('BIG_HIT', '— FENDED OFF');
    d.shake(0.3);
  } else {
    d.startBreakdown(near.num);
  }
}

/* T-31/T-30 — THE GOAL-LINE DIVE. R-07: the launch comes from 2-3 m out,
 * horizontal through the centre of gravity, and once launched it is a
 * commitment — no steering, momentum and the slide carry him the last
 * metre. Without this verb the CPU could reach the line and never ground
 * the ball: the defence simply held him at the plane, and red-zone
 * entries produced zero tries. Both sides use it; the human gets SPACE
 * when he is close to the line. */
export function doDive(d: Director) {

  const s = d.op!;
  const car = d.L(s.attacking, s.carrierNum);
  if (s.dive > 0) return;
  s.dive = 0.6;
  const spd = maxSpeed(car, true, true, car.stamina);
  car.vx *= 0.4;
  /* The launch is sized to REACH THE PLANE under the slide's own decay —
   * v0 = distance × k / (1 − e^(−k·T)) for the exponential slide (W-15: a
   * lunge plus a 0.5-1.0 m slide, the reach arm last to stop). */
  const K = 0.5, T = 0.6;
  car.vz = s.dir * clamp((s.toLine + 0.8) * K / (1 - Math.exp(-K * T)), spd * 1.2, 11.5);
  car.clip = 'dive';
  car.clipT = 0;
  d.say('DIVES FOR THE LINE');
}

export function doDummy(d: Director, ) {

  const s = d.op!;
  const dTeam = d.defending();
  // a dummy bites the inside defender for 0.35 s, opening the outside channel
  for (const p of d.live) {
    if (p.team !== dTeam) continue;
    if (Math.hypot(p.x - s.carrierX, p.z - s.carrierZ) < 9) {
      p.tz = p.z - s.dir * 0.8;
      p.urgency = 0.3;
    }
  }
  d.say('DUMMY — AND THE DEFENCE BITES');
}

export function doPass(d: Director, side: -1 | 1, cutOut: boolean) {

  const s = d.op!;
  const gate = d.forwardAttackGateReporter();
  const car = d.L(s.attacking, s.carrierNum);
  const wet = wetnessOf(WEATHERS[d.options.weather ?? 1]);
  /* The CPU's actual pass execution receives the same reviewed context as its
   * preview/side selection; humans keep the neutral legacy ordering. */
  const forwardContext = !d.isHuman(s.attacking) ? {
    enabled: true,
    attackDirection: (s.dir < 0 ? -1 : 1) as -1 | 1,
    noteRejection: () => d.notePassCandidateRejected(),
  } : undefined;
  const opts = passOptions(car, d.live, s.open, cutOut, wet, forwardContext, gate);
  const opt = opts.find((o) => o.side === side);
  if (!opt) {
    d.showHint(cutOut ? 'NOBODY TO SKIP TO ON THAT SIDE' : 'NO RECEIVER ON THAT SIDE', 1.6);
    return;
  }
  d.teams[s.attacking].stats.passes++;
  d.run(s.attacking, s.carrierNum).passes++;

  // assist widens the window rather than removing the error
  /* T-18. Professional teams complete ~90% of passes, even in traffic —
   * the old rate threw 8-15% away, and the red zone (every receiver
   * covered, every pass at the risk cap) turned over half its entries on
   * spilled balls. The risk model still decides WHICH passes are hard; the
   * absolute rate is calibrated to the real thing. */
  const errorChance = clamp(opt.risk * 0.45 * (1 - d.assists.pass * 0.5), 0.008, 0.18);
  if (R() < errorChance) {
    /* A spilled pass is a turnover in any box score — the ball changed
     * hands through an error, which is exactly the "in the tackle and from
     * errors" family the realism ranges measure alongside steals. */
    d.teams[d.defending()].stats.turnovers++;
    const strict = d.options.fwdPass ?? 1;
    if (strict < 2 && R() < 0.5) {
      d.lawCall('FWD_PASS', REFEREE_CALLS.FWD_PASS, s.attacking);
      d.startScrum(d.defending(), car.x, car.z);
    } else {
      d.commentate('MISSED');
      d.startScrum(d.defending(), car.x, car.z);
    }
    return;
  }

  /* SPEC_13 — LAW 11, THE THROW-FORWARD TEST.
   *
   * Taken here, at the release frame, because that is the only place the law
   * is answerable: `s.ball.x/z` is the release point, `s.carrierNum` is still
   * the thrower, and the receiver has not yet been steered anywhere. One frame
   * later the ball has moved ~0.22 m and the receiver has been told to run,
   * and the test starts measuring the chase instead of the throw.
   *
   * The aim is solved ONCE here and the ball flies to it for the whole
   * flight, so the release vector, the average flight velocity and the
   * landing point are all the same fact. */
  const dir = s.dir >= 0 ? 1 : -1;
  const solvedAim = solvePassAim(car, opt.player);
  const rel = passReleaseRel(car, solvedAim, car.vz, dir);
  const fwdProf = fwdProfile(d.options.fwdPass ?? 1);
  const blown = rel > fwdProf.tol;
  /* A CPU pass can still read forward at release even though the selection
   * filter cleared it: the receiver runs between the two solves, a fifth of
   * a second of movement. The CPU therefore throws the SAME pass flatter
   * rather than illegally — the lateral line is kept, the depth is pulled
   * back. The whistle is left free to be about the HUMAN, which is what a
   * referee is for, and the correction is counted so it cannot quietly
   * become the way the CPU passes. */
  const clamped = blown && !d.isHuman(s.attacking)
    ? clampAimLegal(car, solvedAim, car.vz, dir, fwdProf.tol)
    : null;
  if (clamped) d.notePassClamped();
  const aim = clamped ?? solvedAim;
  /* Ordering matters for the ledger: a corrected pass is not a whistled one,
   * and counting it as both would flatter the referee and hide the CPU's
   * debt. The rate is counted before the verdict, the whistle after it. */
  const whistled = blown && !clamped && fwdProf.blows;
  d.notePassRelease(rel, forwardMetres(rel, solvedAim.flight), whistled);
  if (whistled) {
    /* Scrum WHERE THE BALL WAS THROWN, not where it was caught — that is the
     * law, and it is also what the old error branch already did. */
    d.lawCall('FWD_PASS', REFEREE_CALLS.FWD_PASS, s.attacking);
    d.startScrum(d.defending(), car.x, car.z);
    return;
  }

  // T-35. The receiver is already moving; the ball flies to him instead of
  // teleporting. Launch the flight — upOpen carries it to the target.
  const receiverBefore = gate ? snapshotForwardAttackPlayer(opt.player) : undefined;
  opt.player.vz = s.dir * maxSpeed(opt.player, false, false, opt.player.stamina) * 0.8;
  opt.player.face = s.dir >= 0 ? 1 : -1;
  if (gate && receiverBefore) {
    for (const failure of forwardAttackPlayerWriteFailures(
      `open:pass-launch-receiver:${opt.player.team}${opt.player.num}`, receiverBefore,
      snapshotForwardAttackPlayer(opt.player), ['vz', 'face'] as const,
    )) gate(failure);
  }

  /* SPEC_02 GATE: snapshot the ball-flight state immediately before dispatch.
   * The receiver selected above must be exactly the one named by this write. */
  const flightBefore = gate ? {
    ballLive: s.ball.live,
    ballX: s.ball.x,
    ballY: s.ball.y,
    ballZ: s.ball.z,
    pendingReceiver: s.pendingReceiver ?? null,
    passT: s.passT,
    passDist: s.passDist,
    carrierNum: s.carrierNum,
  } : undefined;
  s.ball.live = true;
  s.ball.x = car.x;
  s.ball.z = car.z;
  s.ball.y = 1.05;
  s.pendingReceiver = opt.player.num;
  s.passT = 0;
  s.passTargetX = aim.x;
  s.passTargetZ = aim.z;
  s.passDist = Math.max(3.5, aim.dist);
  if (gate && flightBefore) {
    const flightAfter = {
      ballLive: s.ball.live,
      ballX: s.ball.x,
      ballY: s.ball.y,
      ballZ: s.ball.z,
      pendingReceiver: s.pendingReceiver ?? null,
      passT: s.passT,
      passDist: s.passDist,
      carrierNum: s.carrierNum,
    };
    for (const failure of forwardAttackStateWriteFailures(
      `open:pass-flight:${s.attacking}${car.num}`, flightBefore, flightAfter,
      ['ballLive', 'ballX', 'ballY', 'ballZ', 'pendingReceiver', 'passT', 'passDist'],
    )) gate(failure);
    for (const failure of forwardAttackPassDispatchFailures(
      `open:pass-flight:${s.attacking}${car.num}`, flightBefore, flightAfter, opt.player.num,
    )) gate(failure);
  }
  /* PART 4 — ANTICIPATORY ACCELERATION: RUNNING ONTO THE BALL.
   *
   * The receiver was given a forward velocity above; everyone outside him
   * waited on his mark for a ball that was still two passes away, so the
   * whole backline took the ball from a standing start and was tackled on
   * the catch. A real backline leaves WITH the pass: the moment the ball
   * is out of the nine's hands, the 10, 12 and 13 are already running.
   *
   * The velocity is injected once, here, at release — not steered towards
   * every frame — so the men are genuinely moving when the ball arrives
   * rather than being dragged along by their marks. Each is aimed at the
   * point where he will MEET the pass (solved from the same fixed aim the
   * ball flies at, so nobody is chasing anybody), at RUN_ON_SPEED_FRACTION
   * of his own maximum sprint — comfortably over the 60% the line needs to
   * cross the gain line rather than reach for it. */
  const flightT = Math.max(0.01, s.passDist / PASS_SPEED);
  for (const runner of d.live) {
    if (runner.team !== s.attacking || runner.sinbin > 0 || runner.down) continue;
    if (runner.num === car.num || runner.num === opt.player.num) continue;
    if (!anticipates(runner.num, car.num, opt.player.num)) continue;
    const sprint = maxSpeed(runner, false, true, runner.stamina);
    const meet = passIntersection(
      { x: runner.tx, z: runner.tz }, { x: aim.x, z: aim.z },
      flightT, sprint * RUN_ON_SPEED_FRACTION, dir,
    );
    const v = runOnVelocity(runner, meet, sprint, dir);
    runner.vx = v.vx;
    runner.vz = v.vz;
    runner.urgency = 1;
    runner.face = dir;
    runner.job = 'RUN ONTO IT — DO NOT WAIT FOR THE BALL';
  }

  if (cutOut) d.say(`CUT-OUT PASS TO ${d.L(s.attacking, opt.player.num).num}`);
}

/**
 * LATCH-AND-DRAG — THE CPU CARRIER, WHILE HELD.
 *
 * `cpuCarrier` is a decision brain with an integrator bolted on the end: it
 * decides to pass, kick, step or carry, and only the CARRY case actually
 * moves him. A held man has no decisions left (see the verb gate in upOpen),
 * but he must still churn forward, so this is the integrator on its own —
 * the same physics, driving straight ahead through the contact, with the drag
 * penalty arriving through `maxSpeed`.
 */
export function cpuCarrierDrag(d: Director, dt: number, s: OpenPlayState) {
  const car = d.L(s.attacking, s.carrierNum);
  /* he drives for the line, not for a gap — a man with a defender on him is
   * not stepping anybody, he is trying to fall forwards. */
  const spd = maxSpeed(car, true, true, car.stamina);
  car.vx = approach(car.vx, 0, 4, dt);
  car.vz = approach(car.vz, spd * s.dir, 4.5, dt);
  if (car.movedBy && import.meta.env.DEV && car.movedBy !== 'carrier') {
    console.warn(`[T-02] shirt ${car.num} moved by ${car.movedBy}, then carrier-drag in one frame`);
  }
  car.x = clamp(car.x + car.vx * dt, -34.5, 34.5);
  car.z = clamp(car.z + car.vz * dt, -61, 61);
  car.movedBy = 'carrier';
  if (Math.abs(car.vz) > 0.4) car.face = car.vz > 0 ? 1 : -1;
  car.job = 'FIGHT THROUGH IT — KEEP YOUR LEGS GOING';
}

export function cpuCarrier(d: Director, dt: number, s: OpenPlayState) {

  /* T-31/T-30. AT THE LINE HE DIVES — a PER-FRAME hazard, not a decision:
   * the pick-and-go is a reflex, and the tackle radius converges in the
   * same third of a second. A carrier inside 3.2 m with ball in hand races
   * the covering defence to the plane; skill sets how eager he is. The
   * launch itself is the committed dive in upOpen (no steering, momentum
   * carries him, and the scoring test there beats the tackle test). */
  if (s.dive <= 0 && s.heldT > 0.12 && s.toLine < 5.2
    && R() < dt * (3.0 + (d.L(s.attacking, s.carrierNum).attrs.SKL / 40))) {
    doDive(d);
    return;
  }
  if (s.dive > 0) return;

  const diff = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)];
  const car = d.L(s.attacking, s.carrierNum);
  const call = (d.lastCall ?? 'POD_CARRY') as PlayCall;
  s.aiTimer -= dt;
  if (s.aiTimer <= 0) {
    /* T-18. A passing play releases the ball quickly — a real backline moves
     * it on in ~0.3 s, long before the converging defence (0.9+ pressure)
     * can force contact. The old 0.45-1.15 s cadence lost that race three
     * times in four and every called pass died as contact. */
    const passingPlay = ['WIDE_SWEEP', 'MISS_PASS', 'TUNNEL_PASS', 'LOOPL_PASS', 'POD_TIP', 'SWITCH'].includes(call);
    /* T-18. The phase clock runs at the compressed match rate: a backline
     * moves the ball on inside ~0.25 s and even a carry decides inside half
     * a second. The old one-second cadence made every phase three times the
     * length of a real one and halved the whole match's event density. */
    s.aiTimer = passingPlay ? 0.18 + R() * 0.22 : 0.3 + R() * 0.42 * (1 - diff.reaction * 0.4);
    const toLine = s.dir > 0 ? FIELD.tryZFar - car.z : car.z - FIELD.tryZ;
    let intent = 'CARRY';
    switch (call) {
      /* T-18. The pass off the ruck IS the play: a first receiver takes the
       * ball flat with the defence a metre away — pressure at the exit of a
       * ruck is ~0.9 by construction (the offside line puts the defence
       * there), so the old >0.85 gate converted every called pass into
       * contact and a whole match produced three passes. Only a defender
       * genuinely on him (0.93+) forces contact instead. */
      case 'WIDE_SWEEP': case 'MISS_PASS': case 'TUNNEL_PASS': case 'LOOPL_PASS':
        /* The protect window (the lawful beat after a ruck exit) is not
         * "a defender is on him" — nobody may touch him in it. Pressure is
         * ~0.9 by construction at the exit (the offside line puts the
         * defence a metre away), so without this gate every called pass
         * became contact and a match produced three passes. */
        intent = (s.pressure > 0.93 && s.protect <= 0) ? 'CONTACT' : 'PASS'; break;
      case 'POD_TIP': case 'SWITCH': intent = R() < 0.45 ? 'PASS' : 'CARRY'; break;
      case 'BOX_KICK': intent = s.carrierNum === 9 ? 'KICK' : 'PASS'; break;
      case 'TERRITORY_PUNT': case 'BOMB': case 'CROSS_FIELD': intent = 'KICK'; break;
      case 'DROP_GOAL': intent = toLine < 40 ? 'DROP' : 'CARRY'; break;
      default: intent = 'CARRY';
    }
    /* T-18 — THE NINE'S PASS. When the scrum-half (or the acting
     * distributor) is the carrier coming off a ruck, the pass to the first
     * receiver IS the phase: that single act is the majority of passes in
     * any real match, and its absence was the single biggest gap between
     * this sim's box score and a real one (23 vs ~250 passes a match). */
    /* A wide-play call is NOT the nine's kick to take — the scrum-half
     * distributes and the TEN kicks it. Without this, an escalated
     * CROSS_FIELD call made the nine punt from the base on first phase. */
    if (s.carrierNum === 9 && intent === 'KICK' && call !== 'BOX_KICK' && call !== 'TERRITORY_PUNT') {
      intent = d.passOpts.length ? 'PASS' : 'CARRY';
    }
    /* T-18 — THE PICK AND GO. Inside eight metres the nine keeps it and
     * goes himself: the receiver is still walking in from depth, the flat
     * pass loses two metres, and the pick over the guard is how close-range
     * phases are actually played. */
    if (toLine < 8 && s.carrierNum === 9 && s.protect > 0 && intent === 'PASS') intent = 'CARRY';
    if (intent === 'CARRY' && d.op?.carrierNum === 9 && d.passOpts.length && R() < 0.85) intent = 'PASS';
    // T-39. The CPU actually moves the ball: in space with an option, it will
    // pass rather than always carry — once the carry has been committed to.
    /* T-18 chain passing: a carrier in space with an uncovered man moves
     * it on — that is where multi-pass movements come from.
     * T-13: but NOT through a broken line — the chain-pass rule is how the
     * ball was moved off every break the moment pressure dropped, and the
     * support man took the tackle. Structured attack passes; the finisher
     * runs. */
    const uncovered = (d.passOpts as any[]).some((o) => !o.covered);
    /* T-13. The old <0.45 pressure gate kept the ball in the first
     * receiver's hands every time he took it flat (honest pressure at the
     * catch is 0.5-0.7) — 83 nine-passes a match and only 22 from anyone
     * else. A marked man with an UNCOVERED teammate outside moves the ball;
     * that is what running lines are for. Only a covered man in space
     * (pressure genuinely low) risks the pass. The >0.86 CONTACT conversion
     * above still forces the tackle when a defender is actually on him. */
    if (intent === 'CARRY' && !s.lineBreak && d.passOpts.length && s.heldT > 0.35
      && ((uncovered && s.pressure < 0.75) || s.pressure < 0.45)
      && R() < (uncovered ? 0.55 : 0.3)) intent = 'PASS';
    // Called passing plays need their runners to have time to get moving —
    // except the nine's distribution, which by its nature goes immediately.
    if (intent === 'PASS' && s.heldT < 0.35 && s.pressure < 0.5 && d.op?.carrierNum !== 9) intent = 'CARRY';
    /* T-13. THE FINISHER KEEPS THE BALL. A carrier through the line used
     * to pass 0.15-0.5 s into the break — the cadence beat the moment and
     * the SUPPORT man took the tackle: 81 breaks, none scored. While the
     * road ahead is open he backs himself; when the cover arrives the
     * support game resumes. */
    if (s.lineBreak && intent === 'PASS') {
      const defsNow = d.live.filter((q) => q.team !== s.attacking);
      const roadOpen = !defsNow.some((q) => (q.z - car.z) * s.dir > -0.5
        && Math.abs(q.z - car.z) < 7 && Math.abs(q.x - car.x) < 4.5);
      if (roadOpen) intent = 'CARRY';
    }
    /* T-18. THE MOVE IS THE MOVE. A called passing play — sweep, miss
     * pass, loop, tunnel — EXECUTES down the line: each receiver draws his
     * man and gives it, exactly as a real backline move does, until the
     * move runs out of width (the widest man has no passOpts and carries)
     * or the defence is on him (the pressure CONTACT conversions above)
     * or the line is broken (the finisher rules above). One pass per
     * phase was the single biggest gap between this sim's pass count and
     * a real match's: the nine distributed, the ten took contact. */
    if (passingPlay && intent === 'CARRY' && !s.lineBreak && s.carrierNum !== 9
      && s.heldT > 0.25 && d.passOpts.length && s.pressure < 0.8 && R() < 0.75) intent = 'PASS';
    /* T-18/T-24. A kick is a territory decision, not a reflex. Kicks happen
     * from the own half (territory punt, box kick), from a developed phase
     * (bomb, cross-field) or in range (drop goal). Kicking inside the
     * attacking 22 unless pressured was throwing away the phase that the
     * carry game had just built — and was why kicks were HIGH while every
     * other match statistic was LOW. */
    if (intent === 'KICK') {
      const ownHalf = toLine > 50;
      /* SCORING PASS — the exit needs a carry first. The old gate let a
       * TERRITORY_PUNT fire on the catch: receive, boot, receive, boot — a
       * carousel that ate the match clock and starved every volume metric
       * (rucks, tackles, passes all read half of professional counts).
       * Real sides take phases into contact before the territory kick,
       * unless the line is about to swallow them. */
      const exitEarned = s.phase >= 2 || s.pressure > 0.8;
      const legal =
        (call === 'TERRITORY_PUNT' && ownHalf && exitEarned) ||
        (call === 'BOX_KICK' && s.carrierNum === 9 && ownHalf && s.heldT > 0.5) ||
        (call === 'BOMB' && s.heldT > 1.1 && toLine > 26) ||
        (call === 'CROSS_FIELD' && s.heldT > 0.9 && toLine > 26);
      /* A cross-field call that never developed is not a carry — in the own
       * half the ten turns it around and finds touch, exactly as a real
       * side does when the move breaks down behind the gain line. */
      /* An illegal cross-field in the OWN half is not a second kick — the
       * exit principle (T-13) takes 1-2 carries before the ball goes to
       * boot. Degrade to the carry game; the kicker keeps his role for a
       * legal call in the opponent half. */
      if (!legal && call === 'CROSS_FIELD' && ownHalf) { intent = 'CARRY'; s.aiPlay = 'POD_CARRY'; d.lastCall = 'POD_CARRY'; }
      else if (!legal) intent = s.pressure > 0.82 ? 'CONTACT' : 'CARRY';
    }
    /* T-18. A drop goal is the stuck-attack release or the dying-seconds
     * play — not the first option of a red-zone visit. The TIGHT-zone
     * scoring bonus had the ten dropping at the posts on phase two, which
     * converted almost nothing and ended the attack every time. */
    if (intent === 'DROP' && (toLine > 38 || s.heldT < 0.5 || s.phase < 5)) intent = 'CARRY';
    // Nobody steps into a wall.
    if (s.pressure > 0.86 && intent === 'CARRY' && s.protect <= 0 && R() < 0.5) intent = 'CONTACT';

    if (s.pressure > 0.72 && intent === 'PASS' && s.protect <= 0 && R() < 0.3) intent = 'CONTACT';
    s.aiIntent = intent;
  }
  switch (s.aiIntent) {
    case 'PASS': {
      /* T-24d. The CPU used to pick a side at random and fail silently when
       * that side had no receiver. Pick a side that actually has an option,
       * preferring the openside unless SPEC_02's approved gain/wing matrix
       * has supplied a stronger ranked release. */
      const gate = d.forwardAttackGateReporter();
      const car = d.L(s.attacking, s.carrierNum);
      const wet = wetnessOf(WEATHERS[d.options.weather ?? 1]);
      const cutOut = R() < 0.18;
      const forwardContext = { enabled: true, attackDirection: (s.dir < 0 ? -1 : 1) as -1 | 1 };
      const opts = passOptions(car, d.live, s.open, cutOut, wet, forwardContext, gate);
      const left = opts.find((o) => o.side === -1);
      const right = opts.find((o) => o.side === 1);
      const priorityPick = opts.find((option) => option.priority !== 'NONE');
      let selected = priorityPick;
      if (!selected && right && (!left || s.open < 0)) selected = right;
      else if (!selected && left) selected = left;
      const side: -1 | 1 = selected?.side ?? 1;

      /* SPEC_02 GATE: this snapshot spans the dispatch and the intent reset.
       * `doPass` owns the detailed flight write; this caller proves the CPU
       * selected the exact receiver the priority sort surfaced. */
      const beforeDispatch = gate ? {
        aiIntent: s.aiIntent,
        ballLive: s.ball.live,
        ballX: s.ball.x,
        ballY: s.ball.y,
        ballZ: s.ball.z,
        pendingReceiver: s.pendingReceiver ?? null,
        passT: s.passT,
        passDist: s.passDist,
        carrierNum: s.carrierNum,
      } : undefined;
      d.doPass(side, cutOut);
      s.aiIntent = 'CARRY';
      if (gate && beforeDispatch) {
        const afterDispatch = {
          aiIntent: s.aiIntent,
          ballLive: s.ball.live,
          ballX: s.ball.x,
          ballY: s.ball.y,
          ballZ: s.ball.z,
          pendingReceiver: s.pendingReceiver ?? null,
          passT: s.passT,
          passDist: s.passDist,
          carrierNum: s.carrierNum,
        };
        for (const failure of forwardAttackStateWriteFailures(
          `open:cpu-pass-dispatch:${s.attacking}${car.num}`, beforeDispatch, afterDispatch,
          ['aiIntent', 'ballLive', 'ballX', 'ballY', 'ballZ', 'pendingReceiver', 'passT', 'passDist'],
        )) gate(failure);
        for (const failure of forwardAttackPassDispatchFailures(
          `open:cpu-pass-dispatch:${s.attacking}${car.num}`, beforeDispatch, afterDispatch,
          selected?.player.num ?? null,
        )) gate(failure);
      }
      return;
    }
    case 'KICK':
      d.startKick(s.attacking, call === 'BOMB' ? 'BOMB' : 'PUNT', { x: car.x, z: car.z }, s.carrierNum);
      return;
    case 'DROP':
      d.startKick(s.attacking, 'DROP_GOAL', { x: car.x, z: car.z }, s.carrierNum);
      return;
    case 'CONTACT': d.startBreakdown(); return;
    default: {
      /* T-13. THE CPU STEPS. The human has G (step) and F (fend); the CPU
       * carrier had nothing — a breakaway with a covering defender closing
       * square-on could only run into the tackle, so the chase ran down
       * every break from depth (89% caught). The step is the finisher's
       * answer: same verb, same physics, same skill check as the human
       * key. It is footwork, not difficulty — the attempt rate does not
       * scale with the difficulty table. */
      if (s.stepCd <= 0) {
        const dTeam0 = d.defending();
        const near0 = d.live
          .filter((q) => q.team === dTeam0 && q.sinbin <= 0 && q.beatenT <= 0)
          .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))[0];
        if (near0 && Math.hypot(near0.x - car.x, near0.z - car.z) < 2.4
          && Math.abs(near0.x - car.x) < 2.5) {
          d.doStep(dt);
        }
      }
      // T-39. The CPU carrier used to run a fixed 6.3 m/s regardless of his
      // stats — that is why "they run exactly the same speed". Use his own
      // maxSpeed, sprinting when he has space in front.
      /* T-13. THE FINISHER'S SPRINT. The old gate sprinted only when
       * pressure < 0.55 — but a LINE BREAK is exactly the moment pressure
       * is HIGH behind him and the space is AHEAD: every break was run down
       * by the 6.8 m/s pursuit (46 breaks, 45 caught, none scored). The
       * gate now reads the road in front: no defender within six metres in
       * the lane, or the break flag live, and he goes. A wing in the clear
       * (9+ m/s) outruns the chase; a forward in the clear does not —
       * which is exactly rugby. */
      const defs = d.live.filter((p) => p.team === d.defending());
      const gx = widestGap(defs, car.x);
      /* T-13. A breakaway from depth aims UPFIELD, not at the corner flag
       * 70 m away — the old target hugged touch and ran itself out. The
       * corner is for the last 25 m; before that he cuts for the posts. */
      let targetX = avoidTouch(gx, car.z, s.dir);
      const toLineRun = s.dir > 0 ? FIELD.tryZFar - car.z : car.z - FIELD.tryZ;
      /* T-13. The finisher's line: already WIDE (past the chase) he takes
       * the corner at the widest gap — that is the winger's try; in midfield
       * he cuts for the posts off the fullback's shoulder. */
      if (s.lineBreak && toLineRun > 25 && Math.abs(car.x) < 15) targetX = car.x * 0.6;
      const spaceAhead = !defs.some((q) => (q.z - car.z) * s.dir > -0.5
        && Math.abs(q.z - car.z) < 6 && Math.abs(q.x - car.x) < 4);
      const sprint = s.lineBreak || spaceAhead || s.pressure < 0.55;
      const spd = maxSpeed(car, true, sprint, car.stamina);
      car.vx = approach(car.vx, clamp(targetX - car.x, -1, 1) * spd * 0.45, 5, dt);
      car.vz = approach(car.vz, spd * s.dir, sprint ? 5.6 : 3.8, dt);
      /* T-13. THE CARRIER RUNS. think() skips the carrier (the phase owns him)
       * and placeBound has no OPEN_PLAY branch — so after cpuCarrier set his
       * velocity, NOTHING integrated his position. The CPU ball-carrier was a
       * statue: velocity read 7 m/s while he stood on the same blade of grass
       * until a pass, a place() or a separate() shove moved him. Every break
       * was run down by defenders who DO steer (82 breaks, 77 caught, 0 tries),
       * and the metres stat — velocity x dt — counted runs he never took. This
       * is the `carrier` ownership mode the T-02 tag reserved and nobody
       * wrote: integrate here, exactly once per frame. */
      if (car.movedBy && import.meta.env.DEV && car.movedBy !== 'carrier') {
        console.warn(`[T-02] shirt ${car.num} moved by ${car.movedBy}, then carrier in one frame`);
      }
      car.x = clamp(car.x + car.vx * dt, -34.5, 34.5);
      car.z = clamp(car.z + car.vz * dt, -61, 61);
      car.movedBy = 'carrier';
      if (Math.abs(car.vz) > 0.4) car.face = car.vz > 0 ? 1 : -1;
    }
  }
}
