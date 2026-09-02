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
  d.quickTap = true;
  d.penaltyChoices(p.team, p.x, p.z, p.free);
}

export function lawCall(d: Director, key: string, call: string, team: 'A' | 'B') {

  d.refSignal = 1.8;
  d.refSignalText = call;
  /* T-10 — every law call has a whistle. */
  d.audio.whistle('LONG');
  d.teams[team].stats.penaltiesConceded++;
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
