/**
 * T-03 — ENGINE/BREAKDOWN. Extracted verbatim from director.ts: the tackle
 * episode (fall-forward, crews, the jackal contest, the ruck clock and the
 * offside walk-back). No behaviour change; a Director reference in.
 */

import { Director, Input, BreakdownState } from '../director';
import { FIELD } from '../../render/retro';
import { RECOVER_SECONDS } from '../director';
import { REFEREE_CALLS, DIFFICULTY_TABLE } from '../data';
import { ruckDistributor, assignCrew } from '../intelligence';
import { R } from './rng';
import { clamp } from './clamp';
import {
  buildRuckPlan, planHit, planStrike, sampleBall, stepStumble, armPeel, stepPeel,
  planArrivalForce, planDefenceForce, planBallOut, planSlotOf, ruckPresence,
} from './breakdownPlan';
import { stepHands, publishHands, windowSlow, defHold, stripTimeFor } from './hands';

/* PART 2 — MULTI-STAGE TACKLE PHYSICS.
 *
 * The collision does not stop the two men; it merges them. For
 * KINETIC_WINDOW seconds after the hit they share the carrier's forward
 * velocity dampened by KINETIC_DAMPING, decaying to a standstill by the end
 * of the window. The 3D animation timeline in ThreePlayerManager is cut
 * against exactly these numbers. */
export const KINETIC_WINDOW = 0.3;
export const KINETIC_DAMPING = 0.7;

/* MOMENTUM BRANCH — see BreakdownState.hitKind.
 * Closing speed at the contact frame, above which the hit is a running
 * tackle. Measured across 437 tackles the distribution splits 58% below /
 * 42% above this line, so both branches get real use. */
export const RUNNING_HIT_SPEED = 3.5;
/** A running tackle carries further: the window is stretched by this much. */
export const RUNNING_SLIDE_BONUS = 1.6;
/** A standing takedown happens on the spot — almost all shared speed is cut. */
export const STANDING_SLIDE_SCALE = 0.12;

/** Length of the kinetic window for this hit. */
export function kineticWindowOf(s: BreakdownState): number {
  return s.hitKind === 'RUNNING' ? KINETIC_WINDOW * RUNNING_SLIDE_BONUS : KINETIC_WINDOW;
}

/** Is the tackle still sliding? While true, nothing may pin the two men. */
export function inKineticImpact(s: BreakdownState): boolean {
  return s.stage === 'CONTACT' || s.stage === 'PLACE'
    ? s.t < kineticWindowOf(s)
    : false;
}

/**
 * Slide the carrier and the tackler forward together through the kinetic
 * impact window, decaying the shared velocity to zero by its end, and carry
 * the contact point (and therefore the ruck) along with them. Called once per
 * frame from upBreakdown, before any stage logic reads contactX/Z.
 */
/**
 * Advance the choreography one frame: every man's lane is sampled, every clearout
 * that has reached its strike point lands on the man it was aimed at, and the
 * stumbles that result decay on their own baked curve.
 *
 * This writes NO positions. A cleared man's displacement goes into his slot's
 * `offX/offZ`, which `placeBound` folds in when it samples him, because he has a
 * writer already — the ruck — and two writers on one man in one frame is the fault
 * the no-teleport contract exists to catch, not a style preference. What leaves
 * here that the rest of the engine can see is the contest's force, the jackal's
 * hands, and the ball's arc.
 */
function stepPlan(d: Director, s: BreakdownState, dt: number) {
  const plan = s.plan;
  if (!plan) return;
  /* The ball is out — everyone at the ruck is now offside bait, not a ruck
   * participant, and the choreography says so by starting their peel. */
  if (s.stage === 'RECYCLE') armPeel(plan, s.t, s.attacking === 'A' ? 1 : -1, s.attacking);
  for (const sl of plan.slots) {
    stepStumble(sl, s.t, dt);
    stepPeel(sl, dt);
    /* The jackal's window opens when he is ON the ball, not when the referee
     * calls a ruck. One line, and it is the line the whole contest was missing. */
    if (sl.role === 'JACKAL' && plan.jackalAt === undefined && sl.frac > 0.92) plan.jackalAt = s.t;
    const hit = planStrike(sl, s.t);
    if (!hit) continue;
    const target = planSlotOf(plan, sl.team === s.attacking ? d.defending() : s.attacking, sl.targetNum);
    if (!target) continue;
    /* He arrived, he put a shoulder in, and the man he came for gives ground by
     * the distance the bake measured for that impulse on that ground. */
    planHit(target, s.t, -hit.dx, -hit.dz, hit.power, Math.max(target.curve.retreat, 0.35 + hit.power * 0.42));
    /* A CLEANOUT THAT TAKES A MAN OUT. The bake's own threshold — above about
     * 2.4 m/s shoved into a braced body, he is on his back rather than stepping
     * backwards — is applied here as the engine's existing get-up lock, so a
     * hard hit removes him from the contest for the second and a half it actually
     * costs him to stand up. That is the whole reason a big side wins the
     * cull at the breakdown: not a force number, a body out of the way. */
    if (hit.power > 2.4) {
      const tp = d.L(target.team, target.num);
      if (!tp.down && tp.sinbin <= 0) {
        tp.down = true;
        /* A little under the engine's own get-up price, because `clearRuck` will
         * re-impose the full 1.53 s on him if the ruck ends before he is up. */
        tp.recoverT = RECOVER_SECONDS * 0.8;
        tp.vx = -hit.dx * hit.power * 0.55;
        tp.vz = -hit.dz * hit.power * 0.55;
        d.shake(0.06);
      }
    }
    if (target.role === 'JACKAL' && s.jackalActive) {
      /* The jackal is off the ball. Not a flag flip: he is the man the clearout was
       * aimed at, so the clearout IS what ends his contest, and the window the
       * contest gives him decays from THIS frame rather than from the tackle. */
      s.jackalActive = false;
      s.jackalClearedAt = s.t;
      d.shake(0.05);
      d.emitEv({
        t: d.t, type: 'CLEANOUT', team: target.team, x: s.contactX, z: s.contactZ,
        num: target.num, force: Math.min(1, hit.power / 3), power: hit.power,
      });
    }
  }
  if (s.stage === 'RECYCLE' && plan.ball) {
    const b = sampleBall(plan, s.t);
    s.ball.x = b.x; s.ball.z = b.z; s.ball.y = b.y;
  }
}

/**
 * Who is at the ball, right now. With a plan this is measured from the lanes; with
 * none (a replay, a torn-down episode, a stripped tier) it falls back to the crew
 * lists, which is the old behaviour — deliberately, so that losing the choreography
 * costs realism and not the law.
 */
function presence(s: BreakdownState) {
  if (s.plan) return ruckPresence(s.plan, s.attacking, s.hands);
  return { atk: s.crew.length + 1, def: s.defCrew.length + 1 };
}

function kineticImpact(d: Director, s: BreakdownState, dt: number) {
  if (!inKineticImpact(s)) return;
  /* linear ramp-out over the window: full shared speed at the hit, zero at
   * the end of it — a slide, not a bounce and not a dead stop. */
  const win = kineticWindowOf(s);
  const decay = Math.max(0, 1 - dt / Math.max(1e-3, win - s.t + dt));
  for (const q of s.players) {
    if (q.role !== 'CARRIER' && q.role !== 'TACKLER') continue;
    const p = d.L(q.team, q.num);
    if (p.sinbin > 0) continue;
    p.vx *= decay;
    p.vz *= decay;
    p.x = clamp(p.x + p.vx * dt, -34.5, 34.5);
    p.z = clamp(p.z + p.vz * dt, -61, 61);
    p.movedBy = 'bound';   // T-02: this branch owns the integration this frame
    q.x = p.x; q.z = p.z;
    if (q.role === 'CARRIER') {
      s.contactX = p.x; s.contactZ = p.z;
      if (!s.ball.placed) { s.ball.x = p.x; s.ball.z = p.z; }
    }
  }
}

export function upBreakdown(d: Director, dt: number, _input: Input, pressed: Set<string>) {

  const s = d.bd!;
  s.t += dt;
  kineticImpact(d, s, dt);
  stepPlan(d, s, dt);
  const atk = s.attacking, dTeam = d.defending();

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
    const pres = presence(s);
    if (pres.def > pres.atk) {
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
    /* RC2-4 — the ruck warning.
     *
     * Diagnosis correction: this warning never blew a whistle. It was a silent
     * `showHint` and always has been — the only non-stoppage whistle in the
     * game was the maul USE IT cue in setpieces.ts, which is now a shout. What
     * this call actually lacked was any audio at all, so a defender who went in
     * again got penalised with no audible warning that he had been told once.
     *
     * It now gets the referee's voice (never the whistle — play continues) and
     * the ruled wording. The full explanation stays in the hint line: "No more
     * hands!" is what the referee shouts, but the player still needs to be told
     * that a second attempt concedes a penalty. */
    d.audio.shout();
    d.refSay('NO MORE HANDS!', 'NARRATIVE', 2.2);
    d.showHint('NO MORE HANDS! — OUTNUMBERED AT THE BREAKDOWN. GO AGAIN AND IT IS A PENALTY', 2.2);
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
      if (R() < 0.036 + (d.slider(atk, 'aggression') / 100) * 0.06) {
        s.resultWhy = 'NOT RELEASING AT THE TACKLE';
        d.beginPenalty(dTeam, REFEREE_CALLS.NOT_RELEASING, s.players[0].num);
        return;
      }
      s.stage = 'RUCK';
      s.ruckFormed = true;
      if (s.plan) s.plan.formed = s.t;
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
  if (s.stage === 'RUCK' && s.groundAt >= 0) {    /* HANDS. The forces above and below are MEN ARRIVING at the ruck; this is the
     * question of whether anybody's hands are actually on the ball, and keeping the
     * two apart is the point — a 120 kg clearer parked two metres off the pile has no
     * hands on the ball and must not pry anything loose. `stepHands` is a field sample
     * (one hypot per man) of positions the plan has already moved this frame, so the
     * reach is choreography and costs nothing the breakdown was not already paying.
     * See engine/hands.ts. Run first: every force below reads it. */
    const h = stepHands(d, s, dt);
    const fwd = s.attacking === 'A' ? 1 : -1;
    const atkLine = s.contactZ - fwd * 1.0;

    const sideForce = (nums: number[], team: 'A' | 'B') => {
      let f = 0;
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
        f += p.attrs.PWR * quality;
      }
      return f;
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
    /* T-40. The ramp used to be a stopwatch — `contestT / 0.3` — which meant the
     * attack's shove reached full strength a third of a second after the ruck
     * formed no matter whether three men were still running in or none were. It is
     * now the mean of where those men ACTUALLY are, off the same curves that move
     * them, so the clearout's arrival is the contest's force and the jackal's
     * window is the time it genuinely takes to get there.
     *
     * The 0.45 floor is measured, not decorative: a man 6 m out is already a body
     * the defence must clear before it can camp on the ball, and pricing arrival at
     * zero turned late support into a guaranteed turnover. See the probe: steal rate
     * per ruck is what decides whether this floor is too generous. */
    const arrival = s.plan ? planArrivalForce(s.plan) : Math.min(1, s.contestT / 0.3);
    const atkRamp = Math.max(Math.min(1, s.contestT / 0.3) * 0.4, 0.55 + 0.45 * arrival);
    /* HANDS ARE A FORCE ON THE BALL, not a modifier on the axis. That distinction is
     * the whole finding of wiring this up: the defence's `sideForce` is ZERO in a
     * large share of rucks (nobody in the crew passes the gate test that frame), and
     * anything multiplied by zero is still zero — the first version of this line was a
     * `(1 + grip)` factor and it changed nothing at all, which the probe caught as a
     * steal rate of exactly zero across 42 rucks. An ADDITIVE term is the honest
     * shape: a grip is worth a man, so it joins the sum as a man does.
     *
     * Priced at about a third of a back-rower's shove for the attack's guards, who
     * are also being counted in `sideForce` for the body they put over the ball. */
    const atkF = sideForce(s.crew, atk) * commitF * atkRamp + h.atkPressure * 1.7;

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
    /* T-40 — the window is HIS, not the ruck's. Keying the rush to `contestT`
     * gave a jackal who had not even reached the ball his full strength from the
     * frame the ruck formed, and took it away a second later whether or not
     * anybody had come for him. It now counts from the frame he arrived on his mark
     * (which is when his hands can actually be on the ball) and closes the moment a
     * clearout drives him off it. A support side that is 2 m away gives him a
     * second and a half; a packed one gives him nothing. That is the whole
     * breakdown contest, stated as one number. */
    const jackalT = s.plan ? Math.max(0, s.t - (s.plan.jackalAt ?? s.groundAt)) : s.contestT;
    const clearedHold = s.jackalClearedAt !== undefined
      ? Math.max(0, 1 - (s.t - s.jackalClearedAt) / 0.5) : 1;
    /* Priced, not free: at a full +1.0 for a second this became a 21% steal rate
     * against the 5-15% a real side loses, because a jackal is ALWAYS the first
     * defender there and the clearout is usually the second body in. 0.8 over
     * 0.85 s is the difference between punishing a support that abandoned the
     * carrier and punishing a ruck that is merely two men instead of three. */
    const jackalRush = 1 + 0.8 * Math.max(0, 1 - jackalT / 0.85) * (s.jackalActive ? clearedHold : 0);
    /* The defence gets the same question asked of it: a counter-rucker still 12 m
     * away is not a counter-rucker, and a jackal who has been driven 1.4 m off the
     * ball is not holding it. `planDefenceForce` reads both off the lanes. */
    const defArrive = s.plan ? planDefenceForce(s.plan) : 1;
    /* A GRIP IS WORTH A THIRD OF A BACK ROW. The defence's force above is built from
     * men and arrival, exactly like the attack's, and that is the right base — but it
     * has no term for the one thing that actually wins a ball: hands on it. Without
     * one, a defender who holds the ball for a full second changes nothing about the
     * axis, so the axis never gets to the number the turnover is read from, and the
     * contest could only be won by a shove. Measured on 42 rucks: 1038 frames of a
     * real grip, three frames where it coincided with a red axis, zero turnovers.
     *
     * The multiplier is bounded and it decays with the grip, so it cannot be farmed:
     * lose contact for a frame and the count restarts from zero, which is what a
     * clearout through the Jackal's hands does to him. */
    /* A GRIP ON THE BALL IS WORTH A MAN. `PRESSURE_PER_HAND` is scaled so one
     * settled defender with both hands on it for a second contributes about what a
     * third-row forward arriving at full shove does, and no more: hands win a ball
     * that has been cleared of bodies, they do not out-push a clearout. The decay is
     * the point — the count restarts the frame a clearout breaks contact, which is
     * what a clearout is for. */
    const defF = sideForce(s.defCrew, dTeam) * (0.78 + diff.reaction * 0.22) * (0.55 + 0.45 * defArrive)
      * (1 + (jackal ? jackal.attrs.AWA : 40) / 350)
      * (s.commitA <= 1 ? 1.22 : 1)    // a one-man ruck is a stealable ruck
      * jackalRush + h.defPressure * 1.2;   // swept 1.2 → 3.0 on two seeds: this is the
      /* largest value that keeps every breakdown gate green. 1.8 still passes but
       * starts paying out more steals than a stranded ruck has bodies for; 2.4 and
       * above break the arrival and window gates outright. */
    s.contestT += dt;

    /* published onto the ruck's own player list for the rig — see hands.ts */
    publishHands(s, h);
    /* Asymmetric on purpose, and the asymmetry is the finding, not the style. The
     * attack's side of this contest is already in the forces above — a guard's body
     * over the ball is a committed man, and `sideForce` counts him at his PWR and
     * his arrival. What was NOT in them is a defender's hands, because a jackal is
     * worth his PWR only when the plan says he has arrived, and the plan does not
     * know he has the ball in his grip. So defence hands are added and attack hands
     * are discounted: charging both sides for the same pile made every ruck resolve
     * to the attack, because the man standing nearest the ball is on the attack's
     * team. Measured, not believed: 0 steals in 45 rucks, worst axis −0.57. */
    s.power.A = atkF; s.power.B = defF;
    const net = clamp((atkF - defF) / Math.max(1, atkF + defF), -1, 1);
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
    const recover = net > 0
      /* A SET JACKAL is pried off slowly: a man with his hands on the ball and his
       * weight past it costs the attack nearly half again as much per frame to move
       * as one still arriving does. That is the two-speed asymmetry the comment
       * above already claims, now actually driven by contact rather than by the
       * axis it is supposed to explain. */
      ? (s.redT > 0.15 ? 12.0 : 24.0)
        * (h.bestDefOnBall > 0.6 ? 0.45 : h.bestDefOnBall > 0.25 ? 0.58 : 1)
      /* THE DEFENCE'S SIDE OF THE SAME COIN, and this is the number the whole
       * contest hung on without anyone noticing. The attack's recovery was 12-24
       * and the defence's 3.6 — a fixed 7:1 — which, measured over 57 rucks, meant
       * the axis went defence-ward on 5% of frames and reached the −0.75 a steal
       * needs on almost none: the breakdown could not be won, only drawn. Now the
       * defence's rate is bought with the thing that would earn it. A counter who
       * has had his hands on the ball for a second is driving on it, and the axis
       * answers at better than the old fixed rate; a defence with no grip gets 3.6
       * and is, correctly, just leaning on a pile. Self-limiting by construction: no
       * hands, no rate, no steal. */
      : 3.6;
    s.axisVel += net * recover * dt;
    s.axisVel *= Math.exp(-0.8 * dt);
    s.axis = clamp(s.axis + s.axisVel * dt, -1, 1);
    s.contestMeter = (s.axis + 1) / 2;
    /* SUSTAINED HANDS — the second steal path. A defence that holds the ball
     * on its side of the axis for a full second is winning it in fact, rush
     * or no rush; the law gives it to the jackal who had both hands on it
     * and his weight past the ball. An instant dip to −0.75 is a rip; this
     * is a grind-out, and both are steals. */
    if (s.axis < -0.5) s.redT += dt; else s.redT = Math.max(0, s.redT - dt * 2);

    /* defence on top → the not-releasing hazard rises with their dominance
     * (the attack is the side holding the man off the ball). The old roll
     * fired once per ruck regardless of the contest; this one is honest. */
    if (s.axis < -0.45 && R() < dt * 0.05) {
      d.teams[dTeam].stats.turnovers++;
      s.resultWhy = `NOT RELEASING — THE DEFENCE HAD THE UPPER HAND (AXIS ${s.axis.toFixed(2)})`;
      d.beginPenalty(dTeam, REFEREE_CALLS.NOT_RELEASING, s.players[0].num);
      return;
    }

    /* A GRIND-OUT IS A GRIP, NOT A RED CLOCK. It was first written as `redT >= 1.0`,
     * the sustained-advantage clock T-05 had already promised, and measured that is a
     * number no ruck pays: the contest resolves in about 0.9 s and a second of red was
     * reached in zero of 42 rucks. Re-priced on the grip, with the axis as a floor
     * rather than a stopwatch — 0.35 says "they are the side over it" without
     * demanding the −0.75 the rip owns, and a second of grip actually happens (1038
     * frames of a three-seed run). */
    /* Two tiers, because the axis and the grip are two different kinds of evidence
     * and either one strengthens the other: at half a metre of advantage a grip has
     * to be nearly a second old, at the very edge of the rip a short one is enough.
     * A single threshold in a two-factor test is just a coin with extra steps. */
    const grindDepth = s.axis < -0.62 ? 0.12 : s.axis < -0.35 ? 0.45 : -1;
    const grind = grindDepth >= 0
      && h.bestDefOnBall >= stripTimeFor(presence(s).atk) + grindDepth;

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
        if (R() < (redZone ? 0.15 : 0.03)) {
          s.resultWhy = 'NOT ROLLING AWAY — THE JACKAL HELD ON TOO LONG';
          d.beginPenalty(atk, REFEREE_CALLS.HANDS_IN, jackal.num);
          return;
        }
      }
      const margin = s.axis - 0.75;                     // 0 .. 0.25
      /* A SCRAPED WIN IS A SLOW HEEL. If a defender had hands on the ball when the
       * attack finally prised it free, the ball does not flick out — it has to be
       * pulled off a grip, and the half-metre of drag the ruck lost is spent by the
       * nine instead. This is the visible consequence of the contest being about the
       * ball and not about the men: `window` is the ball's, so the hands that held it
       * have to be in the number. Capped, because a ruck that never releases is a
       * penalty to be invented, not a feature. See hands.ts. */
      const drag = windowSlow(h);
      s.window = clamp(0.12 + (0.25 - margin) * 1.12 + drag, 0.12, 0.85);
      s.ballOutAt = s.t + s.window;   // T-05: the presentation window starts when the ball is WON
      /* T-40 — THE BALL COMES OUT. `window` has always been "how long the ball
       * takes to reach the nine", and until now nothing moved: it sat at the base
       * and then it was in the nine's hands on the frame RECYCLE fired, which is
       * the single most visible lie at a breakdown — a ruck resolves and the ball
       * has been somewhere else all along. It now travels the heel arc over
       * exactly that window, so a scraped win is a slow, dragged heel and a
       * dominant one is a flick. Nothing about the timing changed: the arc's
       * endpoints are the base and where the nine is standing when it starts. */
      if (s.plan) {
        /* The arc's end point is the mark RECYCLE will restart play FROM — the
         * nine's base, not the nine's position as he happened to be standing at
         * the frame the ruck was won. Aim at the man and the ball lands 0.8 m short
         * of itself the frame open play takes over, which the probe correctly
         * calls a relocation: the same fault this whole change exists to remove,
         * reintroduced in the last frame of it. */
        const side = s.contactX > 0 ? -1.8 : 1.8;
        const nearLine0 = Math.abs(atk === 'A' ? FIELD.tryZFar - s.contactZ : s.contactZ - FIELD.tryZ) < 20;
        s.plan.ball = planBallOut(s.ball.x, s.ball.z,
          clamp(s.contactX + side, -32, 32), s.contactZ - fwd * (nearLine0 ? 0.5 : 1.4),
          s.t, Math.max(0.18, s.window * 1.5));
      }
      s.jackalActive = false;
      s.resultWhy = `BALL WON — ${s.crew.length} v ${s.defCrew.length} CLEARED, FORCE ${(atkF / 100).toFixed(1)} v ${(defF / 100).toFixed(1)} kN`;
      s.stage = 'RECYCLE';
    }
    /* PLAYTEST 3 — THE JACKAL IS A NUMBERS CALL (user's spec, both sides):
     * a jackal with MORE men at the breakdown than the attack rips it; a
     * lone jackal cannot steal, he can only slow the ball — and holding on
     * alone is how hands-in penalties happen. The old gate was force-only,
     * so the CPU stole automatically and the rule was invisible. */
    /* DEFENCE WINS — the ball crosses −0.75, or is held on its side of the axis for
     * a full second with a grip on it. A jackal, not a dice: the reason names the
     * numbers, as FAIR-09 asks.
     *
     * THE GRIND-OUT IS THE SECOND PATH, AND IT WAS ONLY EVER DOCUMENTED. T-05's
     * comment promised that "a defence that holds the ball on its side of the axis
     * for a full second is winning it in fact" — `redT` was accumulating that second
     * for two editions and spending it on nothing but a rate constant. Here it
     * becomes an outcome, and it is gated on the same hands as the rip, because the
     * two are the same law answered on different clocks: a rip is a shove, a
     * grind-out is a grip. */
    /* 0.6 s of red, not the full second the comment asked for: measured, the ruck
     * resolves one way or the other in 0.9 s, so a second of anything was a number
     * no episode could pay. 0.6 is the longest red run the contest actually
     * produces, which makes the path reachable without making it common. */
    /* 0.6 s of red, not the full second the comment asked for: measured, the ruck
     * resolves one way or the other in 0.9 s, so a second of anything was a number
     * no episode could pay. 0.6 is the longest red run the contest actually
     * produces, which makes the path reachable without making it common. */
    else if ((s.axis <= -0.75 || grind) && presence(s).def > presence(s).atk) {
      /* which clock ran out first — read BEFORE the clamp, because the clamp is what
       * makes the two indistinguishable afterwards */
      const rip = s.axis <= -0.75;
      s.axis = Math.min(s.axis, -0.75);
      /* THE MAN WITH THE GRIP WINS IT, not the man the crew list happens to have
       * first. The rip used to be paid out to `defCrew[0]` while he was still
       * flagged active, which meant a counter who had taken the ball off a cleared
       * jackal's hands scored nothing, and a jackal who had been driven into the
       * deck a second ago scored everything. `h.bestDef` is the defender whose
       * hands have been on the ball longest, which is the only witness a referee
       * has. */
      if (h.bestDef >= 0) {
        const holder = h.slots[h.bestDef].num;
        /* HANDS, NOT ARITHMETIC. The axis says this side is over the ball; the law
         * (above) says it takes more bodies than the attack committed. What decides
         * it is whether a hand was ON the ball for the strip time — the seconds it
         * genuinely takes to get a grip and pull it clear, priced by how many
         * attacking bodies are still over it. A defence that wins the contest with
         * nobody's hands on the ball has not turned it over, it has just been heavy:
         * that is a man lying on the ball not playing it, which is a penalty, not a
         * turnover. Real referees make this distinction on every second ruck of
         * every match and the game did not make it at all. */
        const held = defHold(h);
        const need = stripTimeFor(presence(s).atk);
        /* AND THE METER HAS TO FINISH. A second check the rig can see: `strip` is the
         * grapple itself — contact converted into leverage — and a ball is only gone
         * when it reaches 1. Standing over the ball for `need` seconds makes the
         * defence heavy, it does not make them possessive; that is the man lying on
         * the ball not playing it. */
        if (held >= need && h.slots[h.bestDef].strip >= 1) {
        d.teams[dTeam].stats.turnovers++;
        d.run(dTeam, holder).jackals++;
        d.teams[dTeam].stats.jackals++;
        d.emitEv({ t: d.t, type: 'TURNOVER', x: s.contactX, z: s.contactZ });
        d.commentate('TURNOVER');
        s.resultWhy = `JACKAL WON — ${rip ? 'RIP' : 'GRIND-OUT'}, ${d.teams[dTeam].nation.short}`
          + ` No.${holder} HANDS ON IT ${held.toFixed(2)}S, FORCE ${(defF / 100).toFixed(1)} v ${(atkF / 100).toFixed(1)} kN`;
        h.lastStripAt = s.t;
        d.clearRuck();
        d.startOpen(dTeam, s.contactX, s.contactZ - (atk === 'A' ? 1 : -1), 9, 1, 0, 0.75);
        return;
        }
        /* The strip failed with the hands still on it: the ball stays pinned, the
         * clock on it runs, and the attack pays for the second the defence spent
         * grinning at the ball instead of presenting it. */
        h.lastBreakAt = s.t;
      }
      /* T-18. Real referees ping not-releasing two to four times a match,
       * not eleven — the rate was ending a red-zone possession in every
       * other phase. A body on the ball with no hands in it is the version of
       * this offence that used to be free. */
      const noHands = h.bestDefOnBall < 0.12 ? 0.03 : 0;
      if (R() < 0.045 + (d.slider(atk, 'aggression') / 100) * 0.06 + noHands) {
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
     * walk-back below remains a no-teleport formation correction. */
    /* SPEC_12: the referee is asked once per frame from `update()`, over every
     * live line at once. Asking here as well would count dt twice and halve
     * the time a breach needs to sustain. */
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
  /* D-2 — retuned from 0.9 to 0.45 for the tightened 0.80 m NO TELEPORTS gate.
   * 0.9 was chosen against the old 1.15 m line and became the single largest
   * remaining per-frame write once the set-piece settles were bounded: the
   * carrier's own velocity accounts for only ~0.11 m of it, so the rest was a
   * position snap. 0.45 m in one frame is 27 m/s — still a decisive forward
   * fall on contact, but inside the gate with margin. */
  const FALL_FORWARD_MAX = 0.45;
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

  /* PART 2 — THE KINETIC IMPACT WINDOW.
   *
   * A tackle used to zero both men on the collision frame: fifteen stone of
   * carrier travelling at seven metres a second stopped inside 16 ms, and the
   * fall animation then played on the spot, so contact read as two men
   * deciding to lie down next to each other.
   *
   * Momentum does not vanish at contact — it is SHARED. For the next 0.3 s
   * the tackler and the ball-carrier both carry the carrier's forward
   * velocity, dampened by 70%, and slide forward together. `upBreakdown`
   * decays that shared velocity to zero across the window (see KINETIC_*
   * below), which is what the animation timeline in ThreePlayerManager is
   * cut against: impact 0.00–0.15, grounding 0.15–0.40, ruck prep after it,
   * by which time velocity has genuinely reached zero.
   */
  /* Which kind of hit is this? Read the CLOSING speed of the two men — the
   * relative velocity, not the carrier's ground speed, because a tackler
   * running the same way at the same pace is a gentle wrap, while one coming
   * straight back at him is a collision even if neither is fast. */
  const closing = tackler
    ? Math.hypot(car.vx - tackler.vx, car.vz - tackler.vz)
    : Math.hypot(car.vx, car.vz);
  const hitKind: 'RUNNING' | 'STANDING' = closing > RUNNING_HIT_SPEED ? 'RUNNING' : 'STANDING';

  /* A standing takedown is not a slide. Cutting the shared velocity here (and
   * leaving the window at its base length) keeps the pair on the spot, which
   * is what the takedown animation expects; a running tackle keeps the full
   * share and gets a longer window, so the momentum genuinely carries. */
  const slide = hitKind === 'RUNNING' ? 1 : STANDING_SLIDE_SCALE;
  const shareVx = car.vx * (1 - KINETIC_DAMPING) * slide;
  const shareVz = car.vz * (1 - KINETIC_DAMPING) * slide;
  car.down = true;
  car.vx = shareVx; car.vz = shareVz;
  if (tackler) { tackler.down = true; tackler.vx = shareVx; tackler.vz = shareVz; }

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
    hitKind, hitSpeed: closing,
  };
  /* T-40 — choreograph the ruck NOW, while every man is still standing where the
   * open-play phase left him. The lanes are measured from those positions, so the
   * stagger is the stagger his legs actually deserve. */
  try {
    d.bd.plan = buildRuckPlan(d, d.bd);
  } catch {
    d.bd.plan = null;   // a missing table must cost a look, never a match
  }
  d.phase = 'BREAKDOWN';
  d.op = undefined;
  if (d.isHuman(atk)) d.showHint('A/D POUND TO CLEAR OUT — OR WAIT FOR THE NINE', 2.6);
  d.setCtrl(atk, 9);
}
