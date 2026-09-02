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

export function upBreakdown(d: Director, dt: number, _input: Input, pressed: Set<string>) {

  const s = d.bd!;
  s.t += dt;
  const atk = s.attacking, dTeam = d.defending();
  const limit = [1.5, 3, 5][d.options.ruckLaw ?? 1];
  const diff = DIFFICULTY_TABLE[clamp(d.difficulty, 0, 9)];

  if (s.stage === 'CONTACT') { s.stage = 'PLACE'; s.groundAt = s.t; }

  if (s.stage === 'PLACE') {
    const human = d.isHuman(atk);
    if (human) {
      if (pressed.has('left') || pressed.has('right')) s.waggle += 1;
      if (pressed.has('action')) { s.commitA = clamp(s.commitA + 1, 1, 3); d.showHint(`COMMITTED ${s.commitA} TO THE RUCK`, 1.4); }
    } else {
      s.waggle += dt * (7 + diff.reaction * 7);
    }
    const elapsed = s.t - s.groundAt;
    if (s.waggle > 4.2 || elapsed > 0.75) {
      s.stage = 'RUCK';
      s.ruckFormed = true;
      s.ball.placed = true;
      // numbers and quality decide it, and the reason is stated out loud
      const atkCrew = s.crew.length;
      const defCrew = s.defCrew.length;
      const jackalSkill = d.L(dTeam, s.defCrew[0] ?? 7).attrs.AWA;
      /* T-24c. The steal scales with how hard the attack competes. If the
       * carrier's side barely cleared out (low waggle, one committed), the
       * jackal wins it — the defence must be rewarded for committing when the
       * attack does not. If the attack fought hard, the ball is secure. */
      const uncontested = s.waggle < 5.5 && s.commitA <= 1;
      /* T-18 — real matches turn over ~18-22 times INCLUDING errors; with a
       * ruck every few seconds the old rates flipped possession constantly
       * and no side could build phases. */
      /* T-18. A contested steal against a committed attack is the rare
       * exception (~5% in professional rugby), not one phase in five —
       * the old range turned over four in ten red-zone drives. */
      const steal = uncontested
        ? clamp(0.28 + (defCrew - atkCrew) * 0.08 + jackalSkill / 800, 0.18, 0.4)
        : clamp(0.03 + (defCrew - atkCrew) * 0.04 + jackalSkill / 900 - s.commitA * 0.03, 0.015, 0.12);
      s.window = clamp(0.4 + (s.waggle - 4.2) * 0.12 + s.commitA * 0.14, 0.35, 1.8);
      if (s.jackalActive && R() < steal) {
        /* T-18 — only the side that WON it is credited. Both counters used
         * to increment, so every steal read as two turnovers and the match
         * total was double the real number. */
        d.teams[dTeam].stats.turnovers++;
        d.run(dTeam, s.defCrew[0] ?? 7).jackals++;
        d.teams[dTeam].stats.jackals++;
        d.emitEv({ t: d.t, type: 'TURNOVER', x: s.contactX, z: s.contactZ });
        d.commentate('TURNOVER');
        s.resultWhy = `JACKAL WON — ${d.teams[dTeam].nation.short} HAD ${defCrew} v ${atkCrew} AND THE BETTER ARRIVAL`;
        d.clearRuck();
        d.startOpen(dTeam, s.contactX, s.contactZ - (atk === 'A' ? 1 : -1), 9, 1, 0, 0.75);
        return;
      }
      /* T-18. Real referees ping not-releasing two to four times a match,
       * not eleven — the rate was ending a red-zone possession in every
       * other phase. */
      if (R() < 0.045 + (d.slider(atk, 'aggression') / 100) * 0.06) {
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
    /* T-38. When the ruck clock runs out the ball is auto-played to the fly-half
     * (first receiver) rather than a scrum being awarded. The window is a
     * "use it" timer, not a penalty: at 0 the nine releases to the 10. */
    if (elapsed > limit) {
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
    s.stage = 'RECYCLE';
  }

  if (s.stage === 'RECYCLE') {
    const outAt = s.groundAt + s.window + 0.05;
    if (s.t >= outAt) {
      const slow = s.window > 2.0;
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
      d.startOpen(atk, clamp(s.contactX + side, -32, 32), s.contactZ - fwd * (nearLine ? 0.5 : 1.4), dist.num, s.phase + 1, s.gainLine, 0.75);
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
   * radius already cost. */
  const fall = clamp(car.vz * dir * 0.13, 0, 1.3);
  car.z += dir * fall;
  const cx = car.x, cz = car.z;
  const dTeam: 'A' | 'B' = d.defending();

  if (tacklerNum !== undefined) {
    d.teams[dTeam].stats.tackles++;
    d.run(dTeam, tacklerNum).tackles++;
  } else {
    /* T-18. A tackle made without a named tackler is still a tackle — the
     * CPU carrier taking contact under pressure was resolved as a breakdown
     * with nobody credited, and TACKLES PER MATCH read a quarter of the
     * truth. The nearest defender is the man who made it. */
    let near: { num: number; d: number } | null = null;
    for (const p of d.live) {
      if (p.team !== dTeam || p.sinbin > 0) continue;
      const dd = Math.hypot(p.x - cx, p.z - cz);
      if (!near || dd < near.d) near = { num: p.num, d: dd };
    }
    if (near) {
      d.teams[dTeam].stats.tackles++;
      d.run(dTeam, near.num).tackles++;
    }
  }
  d.run(atk, s.carrierNum).carries++;

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
  const tackler = tacklerNum !== undefined ? d.L(dTeam, tacklerNum) : null;
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
  };
  d.phase = 'BREAKDOWN';
  d.op = undefined;
  if (d.isHuman(atk)) d.showHint('A/D POUND TO CLEAR OUT — OR WAIT FOR THE NINE', 2.6);
  d.setCtrl(atk, 9);
}
