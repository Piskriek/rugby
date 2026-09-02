/**
 * T-03 — ENGINE/KICK. Extracted verbatim from director.ts: the kick episode
 * (aim, meter, flight, bounce, chase) and the launch/landing physics.
 * No behaviour change; a Director reference in.
 */

import { Director, KickState, Input } from '../director';
import { FIELD } from '../../render/retro';
import { R } from './rng';
import { wetnessOf, windOf, WEATHERS } from './weather';
import { DIFFICULTY_TABLE } from '../data';
import { CHASE_ORDER, CHASE_LANES } from '../shapes';
import { assignReceiver } from '../intelligence';
import { clamp } from './clamp';

export function upKick(d: Director, dt: number, input: Input, _pressed: Set<string>) {

  const s = d.kk!;
  s.t += dt;
  const human = d.isHuman(s.kicker);
  const diff = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)];
  const wind = windOf(d.options);

  /* T-32. The conversion ritual: fanfare (celebrate), then the walk to the tee.
   * The kick button is dead until the kicker has actually set the ball. */
  if (s.stage === 'FANFARE') {
    if (s.t > 2.2) { s.stage = 'WALKUP'; s.t = 0; d.say(`${s.kickerName} STEPS UP TO TAKE THE CONVERSION`); }
    return;
  }
  if (s.stage === 'WALKUP') {
    // The kicker walks to the ball; once he is at the tee the kick goes live.
    const k = d.L(s.kicker, s.kickerNum);
    const atTee = Math.hypot(k.x - s.bx, k.z - (s.bz - s.dir * 1.1)) < 0.8;
    /* NO-TELEPORT: the time failsafe used to snap the kicker to the tee
     * wherever he stood (a 14 m teleport). He walks under steer() in
     * placeBound; the failsafe only advances the STAGE — the setting branch
     * keeps steering him the last metres to the mark. */
    if (atTee || s.t > 5.0) {
      s.stage = 'AIM'; s.t = 0;
      if (human) d.showHint('A/D AIM · HOLD SPACE TO KICK', 3);
      return;
    }
    return;
  }

  if (s.stage === 'AIM' || s.stage === 'METER') {
    if (human) {
      /* HOLD-TO-CHARGE.
       * A/D aims. Hold SPACE and the power builds; the line drawn on the grass
       * grows to exactly where the ball will land. Release to strike.
       * Accuracy is NOT a second timing minigame — it comes from the kicker's
       * rating, the wind and the wet, which is what actually decides a kick.
       * Charge takes 1.6 s for the full range, roughly half the old speed. */
      if (input.left) s.aim = clamp(s.aim - dt * 0.85, -1, 1);
      if (input.right) s.aim = clamp(s.aim + dt * 0.85, -1, 1);

      const holding = input.sprint || input.run;
      if (holding) {
        s.stage = 'METER';
        s.meter = clamp(s.meter + dt / 1.6, 0, 1);
        s.power = s.meter;
      } else if (s.stage === 'METER' && s.power > 0.04) {
        // released — strike it
        s.accuracy = d.kickerAccuracy(s);
        d.launch(s.power, s.accuracy, wind);
        return;
      }
      // The aim line is the honest prediction of where it lands.
      const reach = d.kickReach(s, s.power);
      s.landX = clamp(s.bx + s.aim * reach * 0.55, -34, 34);
      s.landZ = clamp(s.bz + s.dir * reach, -60, 60);
    } else {
      /* T-18. CPU aim is chosen by what the kick is FOR. A territory punt or
       * a box kick hunts the touchline (that is the entire point of the
       * kick — and the only way a lineout ever happens, which is why
       * LINEOUTS PER MATCH read zero). A bomb hangs mid-field for the chase;
       * a cross-field kick is aimed at the far wing. Humans keep the honest
       * A/D aim. */
      const wide = s.bx >= 0 ? 1 : -1;
      let aimTo: number;
      let powerTo = 0.55 + R() * 0.3;
      switch (s.type) {
        case 'BOMB': aimTo = (R() - 0.5) * 0.3; break;
        case 'DROP_GOAL': case 'GOAL': {
          /* T-18. Aim AT THE POSTS, geometrically: the old fixed aim of 0
           * flew parallel to the touchline, so every kick from an
           * off-centre mark — which is nearly all of them, now that the
           * penalty mark is the actual infringement spot — sailed wide. */
          const gz = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
          const dz = Math.max(4, (gz - s.bz) * s.dir);
          const deg = (Math.atan2(-s.bx, dz) * 180) / Math.PI;
          /* T-13. The clamp used to be +-3.5 (35 degrees) — narrower than
           * the angle a touchline penalty actually needs (a mark 27 m wide
           * and 24 m out asks for 48 degrees). Every wide-angle shot was
           * pre-aimed wide of the upright and the CPU kicked ~33% for goal;
           * the aim is geometric, so let it point where the posts are. */
          aimTo = clamp(deg / 10, -6.6, 6.6);
          const need = Math.hypot(s.bx, dz) + 4;
          powerTo = clamp((need - 9) / 43, 0.35, 1);
          break;
        }
        case 'GRUBBER': aimTo = wide * (0.4 + R() * 0.4); break;
        case 'RESTART': case 'DROP_OUT': aimTo = (R() - 0.5) * 0.5; powerTo = 0.78 + R() * 0.2; break;
        default:
          // PUNT from hand. Roughly half of territory kicks hunt touch (that
          // is the point of the kick, and the only source of lineouts); the
          // other half are short contestables for the chase — a kick game
          // that is 100% to touch can never be chased, and CHASE ARRIVALS is
          // a regression gate.
          if (s.fromPenalty) {
            /* T-18. Find the CORNER. The old aim simply maximised the
             * lateral angle, so a penalty won in the attacking half still
             * went into touch twenty metres out and there was never a
             * five-metre lineout to drive all match. Kick at the point
             * where the five-metre line meets touch; if that is beyond
             * the kicker's reach, take touch at full power on the diagonal. */
            const reach = d.kickReach(s, 1);
            const fiveZ = s.dir > 0 ? FIELD.tryZFar - 5 : FIELD.tryZ + 5;
            const forward = Math.max(8, (fiveZ - s.bz) * s.dir);
            const lateral = Math.max(6, 34.6 - s.bx * wide + 3);
            const cornerDist = Math.hypot(forward, lateral);
            let fwdForAim: number;
            if (cornerDist <= reach) {
              powerTo = clamp((cornerDist - 9) / 41 + 0.05, 0.45, 1);
              fwdForAim = forward;
            } else {
              powerTo = 0.95 + R() * 0.05;
              fwdForAim = Math.sqrt(Math.max(16, reach * reach - lateral * lateral));
            }
            /* T-13. The 55-degree cap sat under the real angle of a corner
             * hunt — a penalty 12 m out and central asks for ~75 degrees of
             * diagonal — so every corner kick was pre-aimed short, crossed
             * touch 20-40 m upfield and the five-metre lineout (the drive
             * platform, where red-zone tries come from) never existed. */
            const deg = Math.min(80, (Math.atan2(lateral, fwdForAim) * 180) / Math.PI);
            aimTo = wide * (deg / 10);
          } else if (s.bz * s.dir < 0 || Math.abs(s.bz) < 20) {
            if (R() < 0.4) {
              /* Find touch GEOMETRICALLY: aim at a point past the nearest
               * touchline, with the power to reach it. The aim field is
               * degrees/10 of kick-path rotation, so the required angle
               * comes straight off the triangle. */
              const reach = d.kickReach(s, 0.95);
              const lateralNeeded = Math.max(6, 34.6 - s.bx * wide + 5);
              const deg = Math.min(50, (Math.atan2(lateralNeeded, reach * 0.8) * 180) / Math.PI);
              aimTo = wide * (deg / 10);
              powerTo = 0.88 + R() * 0.12;
            } else {
              aimTo = (R() - 0.5) * 0.5;
              powerTo = 0.4 + R() * 0.2;
            }
          } else {
            aimTo = (R() - 0.5) * 0.5;
          }
          break;
      }
      /* T-13. +-4.2 (42 degrees) sat under the angle a wide penalty or
       * touchline conversion needs; the case-level clamp above is the
       * honest one, so this must not re-tighten it. */
      s.aim = clamp(aimTo, -6.6, 6.6);
      s.power = powerTo;
      s.accuracy = d.kickerAccuracy(s) * (0.8 + diff.reaction * 0.2);
      /* The restart is struck when the formation has actually assembled — the
       * ten metres is walked back, not assumed. Near-total assembly is
       * required so the strike itself is lawful. The failsafe is a LADDER,
       * because after a score both sides may have a 45 m jog back to
       * halfway: strike at 6 s if most are set, at 8 s if half are set,
       * unconditionally at 10 s. A strike into an unformed line is an
       * encroachment the audit rightly flags. */
      /* T-18/NO-ENCROACHMENT. Assembly is necessary but not sufficient: the
       * Law-12 test is that the RECEIVING side is actually behind ten
       * metres at the strike. The old time-ladder could strike at 3.5 s
       * with three men still inside the line — legal assembly, unlawful
       * kick. Strike only when the nearest receiver is at least 9.5 m
       * back (8 s hard backstop — nobody walks that slowly). */
      /* SCORING PASS — and the receiving side retreats to earn it. Nothing
       * used to MOVE them back, so the nearest man loitered at 10.3 m,
       * gapOk stayed false, and every restart sat in AIM until the ten
       * second backstop — ten seconds of dead clock, two to four times a
       * match. The law puts them behind the ten-metre line; they now walk
       * there at a back-pedal (never teleported), and the whistle comes
       * when both sides are actually legal. */
      if (s.type === 'RESTART' || s.type === 'DROP_OUT') {
        const RETREAT = 8 * dt;   // m per frame — a hard back-pedal
        for (const p of d.live) {
          if (p.team === s.kicker || p.sinbin > 0) continue;
          const gap = (p.z - s.bz) * s.dir;
          if (gap < 10.8) p.z += Math.min(RETREAT, 10.8 - gap) * s.dir;
        }
      }
      let gapOk = true;
      if (s.type === 'RESTART' || s.type === 'DROP_OUT') {
        const fwd = s.dir;
        let nearest = 99;
        for (const p of d.live) {
          if (p.team === s.kicker || p.sinbin > 0) continue;
          const gap = (p.z - s.bz) * fwd;
          if (gap < nearest) nearest = gap;
        }
        /* 10.3 rather than 9.5: the measured window is the first quarter
         * second of flight, and the receiving side is already moving
         * forward — striking at exactly 9.5 put a legal jog inside the
         * line by the time the ball was in the air. */
        gapOk = nearest >= 10.6 || s.t > 10;
      }
      const formed = (s.type !== 'RESTART' && s.type !== 'DROP_OUT'
        || (s.formReady ?? 1) > 0.97
        || (s.t > 2.8 && (s.formReady ?? 1) > 0.85)
        || (s.t > 4.5 && (s.formReady ?? 1) > 0.6)
        || s.t > 6.5) && gapOk;
      /* T-18. A kick from hand in open play leaves the boot in half a
       * second — the 0.9 s aim dwell on every punt was a quarter of the
       * kicking game's time budget. Only restarts wait for the formation. */
      const strikeAt = (s.type === 'RESTART' || s.type === 'DROP_OUT') ? 0.9 : 0.45;
      if (s.t > strikeAt && formed) { d.launch(s.power, s.accuracy, wind); return; }
    }
  } else if (s.stage === 'FLIGHT') {
    s.vy -= 9.81 * dt;
    s.bx += s.vx * dt;
    s.bz += s.vz * dt;
    s.by += s.vy * dt;
    /* A rugby ball bounces. It does not vanish into a phase change. Restitution
     * on the vertical, friction on the horizontal, and an unpredictable sideways
     * kick off the point of the ball. */
    if (s.by < 0.12 && s.vy < 0) {
      s.by = 0.12;
      s.bounces++;
      const rest = s.type === 'GRUBBER' ? 0.46 : 0.52;
      s.vy = Math.abs(s.vy) * rest;
      s.vx *= 0.78; s.vz *= 0.82;
      if (s.vy > 1.2) s.vx += (R() - 0.5) * 2.4;
      if (s.vy < 0.55) { s.vy = 0; s.by = 0.12; }
    }
    /* T-18. Wet-turf friction: a kicked ball's roll dies inside a couple
     * of seconds. The gentle 0.988 decay let balls wander for 4+ engine
     * seconds — a quarter of the kicking game's entire time budget. */
    if (s.by <= 0.12 && s.vy === 0 && Math.hypot(s.vx, s.vz) > 0.05) { s.vx *= 0.958; s.vz *= 0.958; }
    s.hangTime += dt;
    s.apex = Math.max(s.apex, s.by);
    s.history.push({ x: s.bx, y: s.by, z: s.bz });
    if (s.history.length > 260) s.history.shift();
    const h0 = s.history[0];
    s.distance = Math.hypot(s.bx - (h0?.x ?? s.bx), s.bz - (h0?.z ?? s.bz));

    if (s.profile.atGoal) {
      const gz = s.dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
      const crossIn = s.dir > 0 ? s.bz >= gz : s.bz <= gz;
      if (crossIn && s.by > 0.5 && s.by < 20) {
        if (Math.abs(s.bx) < 2.8) { d.kickScored(s); return; }
        d.kickMissed(s, 'WIDE OF THE UPRIGHT'); return;
      }
    }
    /* CONTEST — while the ball is in the air or on the bounce, any player close
     * enough can catch it. This is what makes the chase worth doing. */
    /* T-18. A ball within ~2 m of touch is LET OUT — nobody fields it, the
     * lineout is the better outcome. Contesting touch-bound balls was why
     * a whole kicking game produced zero lineouts. */
    /* T-18. A kick can only be fielded once it is on the way DOWN
     * (s.vy < 0) — the old check was just "below 2.55 m", which is true on
     * the first two frames of flight, so the ball was being "caught in the
     * air" at the kicker's feet by whoever stood next to him. Every touch
     * hunt died that way; there were no lineouts. */
    if (!s.profile.atGoal && s.bounces <= 2 && Math.abs(s.bx) < 32.5 && s.vy < 0) {
      /* NO-TELEPORT: the catch radius matches startOpen's close-place guard
       * (1.2 m). Catching at 1.5 m meant the catcher was then PLACED on the
       * ball — a 1.3-1.5 m single-frame jump the audit rightly flags. */
      const catcher = d.live.find((p) => p.sinbin <= 0 && !p.down
        && Math.hypot(p.x - s.bx, p.z - s.bz) < 1.2 && s.by < 2.55);
      if (catcher && R() < (catcher.team === s.kicker ? 0.55 + (d.slider(s.kicker, 'chase') / 100) * 0.25 : 0.82)) {
        d.say(catcher.team === s.kicker ? 'REGATHERED BY THE CHASE!' : 'TAKEN CLEANLY IN THE AIR');
        const num = catcher.num, bx = s.bx, bz = s.bz, tm = catcher.team;
        d.kk = undefined;
        /* A fielder is still in the act of landing — a quarter-second beat
         * before he may be touched, else the contest catch resolves into an
         * instant tackle every time and nobody ever runs a kick back. */
        d.receipt = { team: tm, at: d.t };
        d.startOpen(tm, bx, bz, num, 1, 0, 0.25);
        return;
      }
    }

    // dead once it has stopped moving or run out of road
    const stopped = s.by <= 0.12 && s.vy === 0 && Math.hypot(s.vx, s.vz) < 1.0;
    /* T-18. The time cap applies to the ROLL — a ball still in the air at
     * 3 s (a bomb's hang is 3.4 s) must be allowed to come down, or the
     * phase ends mid-flight and the audit rightly flags a ball that never
     * bounced. */
    if (stopped || s.bounces > 6 || (s.t > 3.0 && s.by <= 0.12 && s.vy === 0)) { d.kickLanded(s); return; }
    if (Math.abs(s.bx) > 34.6) {
      // 50:22 gives the throw to the side that kicked it
      const fromOwn = Math.abs(s.bz - s.dir * 50) > 50;
      if (s.type === 'FIFTY_22' && fromOwn) {
        d.say('50:22 — THE THROW IS YOURS');
        d.kk = undefined;
        d.startLineout(s.kicker, s.bz, Math.sign(s.bx) * 6);
        return;
      }
      d.say('INTO TOUCH — GOOD TERRITORY');
      d.kk = undefined;
      d.startLineout(d.defending(), s.bz, Math.sign(s.bx) * 6);
      return;
    }
    if (s.bz > FIELD.deadZFar - 1 || s.bz < FIELD.deadZ + 1) {
      if (s.profile.atGoal) { d.kickMissed(s, 'DEAD — NO GOOD'); return; }
      d.touchDown();
      return;
    }
  }
  void input;
}

export function launch(d: Director, power: number, accuracy: number, wind: number) {

  const s = d.kk!;
  const wet = wetnessOf(WEATHERS[d.options.weather ?? 1]);
  const assist = d.isHuman(s.kicker) ? d.assists.kick : 0.5;
  /* Accuracy is the kicker's + weather, not the launch. It widens the angle
   * spread but never changes how far the ball goes. */
  const acc = clamp(accuracy - wet * 0.05 + assist * 0.08, 0.1, 0.99);

  /* T-24 KICK POWER. The old code set velocity to `dist * 0.72` and flight
   * time to `dist / k`, so actual travel was `dist² × 0.72` — a 46 m punt flew
   * over 60 m and rolled out the back. The ball now lands at exactly the
   * distance the power line showed: speed = distance / hang time. */
  const dist = d.kickReach(s, power);

  // Hang time per type, tuned so the apex stays realistic (g·hang²/8).
  /* T-13. A goal kick is the HIGHEST arc in the game — real shots at goal
   * hang ~3 s and cross the bar 3-6 m up on the way down. The old 1.9 s
   * hang (apex 4.4 m) had the ball descending to ankle height exactly at
   * the posts for anything beyond 30 m: it failed the crossing test
   * silently, no SCORE, no MISS, and the kick just died into open play.
   * CPU teams were taking ~23 shots a match and scoring 6% of them. */
  const hang = s.type === 'GRUBBER' ? 1.0
    : s.type === 'DROP_GOAL' ? 2.6
      : s.type === 'GOAL' ? 2.9
        : s.type === 'BOMB' ? 3.4
          : s.type === 'RESTART' || s.type === 'DROP_OUT' ? 2.9
            : 2.0;   // punt — a flat, chasing territory kick

  const speed = dist / Math.max(0.6, hang);
  const spread = (1 - acc) * 9 + wind * 6;
  const angRad = (((R() - 0.5) * spread + s.aim * 10) * Math.PI) / 180;
  const vz = Math.cos(angRad) * speed * s.dir;
  const vx = Math.sin(angRad) * speed;
  const vy = 0.5 * 9.81 * hang;
  s.vx = vx; s.vz = vz; s.vy = vy;
  s.stage = 'FLIGHT'; s.t = 0;
  s.chasers = CHASE_ORDER.slice(0, 3).map((num, i) => ({ num, lane: CHASE_LANES[i].label }));
  d.shake(0.15);
}

export function kickLanded(d: Director, s: KickState) {

  s.stage = 'RESULT'; s.result = 'LANDED';
  const chase = d.slider(s.kicker, 'chase') / 100;
  const regather = R() < 0.22 + chase * 0.4;
  const rec = assignReceiver(d.live, d.defending(), s.bx, s.bz);
  d.kk = undefined;
  if (regather && s.type !== 'GOAL') {
    d.commentate('GENERAL', '— REGATHERED BY THE CHASE');
    d.startOpen(s.kicker, s.bx, s.bz, s.chasers[0]?.num ?? 14, 1);
    return;
  }
  const dTeam: 'A' | 'B' = s.kicker === 'A' ? 'B' : 'A';
  if (R() < 0.5) {
    d.startOpen(dTeam, s.bx, s.bz, rec.num, 1);
  } else {
    d.startScrum(dTeam, s.bx, s.bz);
  }
}
