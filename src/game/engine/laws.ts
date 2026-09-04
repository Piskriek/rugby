/**
 * T-03 — ENGINE/LAWS. Extracted verbatim from director.ts: the penalty
 * machinery (award, mark capture, the release-before-anything freeze fix,
 * cards, advantage and resolution). No behaviour change; a Director
 * reference in, law out.
 */

import { Director } from '../director';
import { R } from './rng';

export function beginPenalty(d: Director, team: 'A' | 'B', call: string, offenderNum: number, free = false) {

  const opp: 'A' | 'B' = team === 'A' ? 'B' : 'A';
  /* T-08: a scrum penalty is a story beat — the bus records it even where
   * no camera reaction is attached yet. */
  if (d.phase === 'SCRUM') {
    const fp = d.focusPoint();
    d.emitEv({ t: d.t, type: 'SCRUM_PEN', x: fp.x, z: fp.z });
  }
  d.lawCall(call.replace(/[—-].*$/, '').trim(), call, opp);
  /* THE FREEZE BUG.
   * A penalty could be awarded from inside upBreakdown / upScrum / upMaul while
   * players were still flagged `down` or `bound`. think() skips any player in
   * that state, so those men never moved again — and if the new carrier was one
   * of them the whole match locked up. Every penalty now fully releases the
   * cast and tears down the phase it interrupted, before anything else.
   *
   * T-18: the MARK is captured first. Reading focusPoint() after releaseAll
   * always returned {0,0} — every penalty in the match was taken from the
   * centre spot, so nobody was ever in goal range and a kick to touch had
   * 35 m of lateral ground to cover from midfield. */
  const mark = d.focusPoint();
  d.releaseAll();

  /* T-07 — card logic.
   * A high tackle is a card on its own. Anything else escalates when the same
   * shirt offends again within ten match-minutes. Placeholder offender numbers
   * (some call sites pass a rough shirt) make the repeat attribution approximate;
   * the card itself is what matters. */
  if (!free && offenderNum > 0) {
    const now = (d.half - 1) * 40 * 60 + d.clock;
    const key = `${opp}:${offenderNum}`;
    const last = d.offenceLog.get(key);
    const highTackle = call.includes('HIGH');
    const repeat = last !== undefined && now - last < 600;
    if (highTackle || (repeat && R() < 0.7)) {
      d.card(opp, offenderNum, highTackle ? 'HIGH TACKLE' : 'REPEAT OFFENCE');
    }
    d.offenceLog.set(key, now);
  }
  const f = { x: Number.isFinite(mark.x) ? mark.x : 0, z: Number.isFinite(mark.z) ? mark.z : 0 };
  d.pendingPenalty = { team, x: f.x, z: f.z, free };
  d.advantage = free ? 0 : [1.2, 2.6, 4.2][d.options.advantage ?? 1];
  d.advantageTeam = team;
  if (d.advantage > 0) {
    d.say('ADVANTAGE — PLAY ON');
    d.showHint('ADVANTAGE — GAIN GROUND AND PLAY CONTINUES', 2.4);
    d.possession = team;
    d.startOpen(team, f.x, f.z, d.op?.carrierNum ?? 9, 1, 0, 0.6);
    return;
  }
  d.resolvePenalty();
}

export function resolvePenalty(d: Director, ) {

  const p = d.pendingPenalty;
  d.pendingPenalty = null;
  if (!p) return;
  /* THE WHISTLE KILLS THE KICK. A penalty can be resolved while a ball is
   * still in the air (advantage expired mid-flight, or a kick taken under
   * advantage that never gained), and every route from here — the shot at
   * goal, the touch kick, the scrum, the tap — ends that kick by law. The
   * tap and the scrum did not clear the kick state, which then sat frozen
   * mid-air forever: the phase machine had moved on, upKick never ticked
   * again, and the camera anchored on a ball hanging at 1.3 m for ten
   * seconds while play went on without it. */
  d.kk = undefined;
  d.quickTap = true;
  d.penaltyChoices(p.team, p.x, p.z, p.free);
}

/* SPEC_12 — THE SANCTION LEDGER.
 *
 * `REFEREE_CALLS` names the sanction in the text of the call itself
 * ("PENALTY — OFFSIDE", "SCRUM — KNOCK ON", "FREE KICK — NOT IN STRAIGHT"),
 * and one call site passes a bare string of its own
 * ("PENALTY — WHEELED PAST 90°"), so the sanction is read from the text and
 * there is exactly one place that decides what a whistle costs.
 *
 * The old code counted EVERY call as a penalty conceded. A knock-on is not a
 * penalty: it is a scrum, it costs the offender nothing like a penalty does,
 * and counting it meant the PENALTIES box-score row was measuring handling
 * errors. Worse, it spent the match's penalty BUDGET — the realism board's
 * 14..28 — on restarts, so a real increase in actual penalties looked like a
 * balance regression and a real decrease hid inside the noise.
 *
 * An unlabelled call defaults to a restart, never to a penalty: an unlabelled
 * call inflating the penalty budget is the failure this exists to prevent. */
export type Sanction = 'PENALTY' | 'FREE_KICK' | 'SCRUM' | 'TURNOVER';

export function sanctionOf(call: string): Sanction {
  if (call.startsWith('PENALTY')) return 'PENALTY';
  if (call.startsWith('FREE KICK')) return 'FREE_KICK';
  if (call.startsWith('TURNOVER')) return 'TURNOVER';
  return 'SCRUM';
}

/** True when a call is one of the offences that costs a penalty, not a restart. */
export const isPenaltyCall = (call: string) => sanctionOf(call) === 'PENALTY';

export function lawCall(d: Director, key: string, call: string, team: 'A' | 'B') {

  d.refSignal = 1.8;
  d.refSignalText = call;
  /* T-10 — every law call has a whistle. */
  d.audio.whistle('LONG');
  if (isPenaltyCall(call)) d.teams[team].stats.penaltiesConceded++;
  else d.teams[team].stats.restarts++;
  d.say(call);
  if (!d.lawsExplained.has(key)) {
    d.lawsExplained.add(key);
    d.showHint(`LAW — ${call}`, 5);
  }
}

export function card(d: Director, team: 'A' | 'B', num: number, reason: string) {

  const p = d.L(team, num);
  if (!p || p.sinbin > 0) return;
  p.sinbin = 600;
  d.emitEv({ t: d.t, type: 'CARD', x: p.x, z: p.z });
  const name = d.teams[team].players[num - 1]?.name ?? `SHIRT ${num}`;
  d.banner_(`YELLOW CARD — ${num} ${name}`);
  d.say(`YELLOW CARD — ${num} ${name} — ${reason}`);
  d.showHint(`YELLOW CARD ${num} (${name}) — DOWN TO 14 FOR TEN MINUTES`, 5);
}
