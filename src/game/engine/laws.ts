/**
 * T-03 — ENGINE/LAWS. Extracted verbatim from director.ts: the penalty
 * machinery (award, mark capture, the release-before-anything freeze fix,
 * cards, advantage and resolution). No behaviour change; a Director
 * reference in, law out.
 */

import { Director } from '../director';
import { R } from './rng';
import { advantageWindowEngineS, openAdvantageWatch } from './referee';
import { FIELD } from '../../render/retro';

/* ====================== SPEC_07 — SCORING GEOMETRY ======================
 *
 * The numbers the scoring engine must be built on, in one place, so the
 * goal-post test, the in-goal grounding test and the headless probe all
 * measure the SAME field.
 */

/** Law 1.4 — the goal posts: 5.6 m between the uprights, the crossbar
 * 3.0 m above the ground. A kick scores only when it passes through the
 * span above the bar. */
export const GOAL_UPRIGHT_SPAN_M = 5.6;
export const GOAL_UPRIGHT_HALF_SPAN_M = GOAL_UPRIGHT_SPAN_M / 2;
export const GOAL_CROSSBAR_M = 3.0;

/** The touch lines run through the in-goal to the dead-ball line: a
 * grounding counts only inside touch-in-goal, |x| ≤ 34.6 m. */
export const TOUCH_IN_GOAL_X_M = 34.6;

/** Law 21.1 — the reach. The engine's dive/lunge triggers may fire up to
 * this far short of the goal line; the ball then counts as grounded ON the
 * plane. A trigger beyond the tolerance is an anomaly (no engine site can
 * produce one) and is flagged as such. */
export const TRY_REACH_TOLERANCE_M = 2.4;

/** SPEC_07 — conversion tee band: Law 8 asks for a place kick on a line
 * through the touchdown spot; the kicker backs up to his optimal range,
 * never closer than 20 m and never further than 30 m from the goal line. */
export const CONVERSION_TEE_MIN_M = 20;
export const CONVERSION_TEE_MAX_M = 30;

/** The goal line at the end this attack is running at (+1 attacks +z). */
export function goalLineZ(dir: 1 | -1): number {
  return dir > 0 ? FIELD.tryZFar : FIELD.tryZ;
}

/** The dead-ball line behind that goal line. */
export function deadBallLineZ(dir: 1 | -1): number {
  return dir > 0 ? FIELD.deadZFar : FIELD.deadZ;
}

/** Law 21 — in-goal is the area past the goal line, before the dead-ball
 * line, inside touch-in-goal. */
export function inGoalBounds(dir: 1 | -1, x: number, z: number): boolean {
  const goal = goalLineZ(dir);
  const dead = deadBallLineZ(dir);
  const past = dir > 0 ? z >= goal : z <= goal;
  const short = dir > 0 ? z < dead : z > dead;
  return past && short && Math.abs(x) <= TOUCH_IN_GOAL_X_M;
}

export interface TryGrounding {
  /** The locked touchdown coordinate (x_try, z_try) — what the conversion
   * line and the score ledger are drawn from. */
  x: number;
  z: number;
  /** Metres past the goal line (0 = grounded on the plane itself). */
  depth: number;
  /** False only when the trigger fired beyond the reach tolerance short of
   * the goal line — an anomaly no engine site can produce; the caller
   * surfaces it in the watchdog log rather than letting it pass silently. */
  legal: boolean;
  /** True when the raw trigger had to be corrected onto the plane or the
   * touch-in-goal / dead-ball bounds. */
  clamped: boolean;
}

/** Lock the touchdown coordinate from a grounding trigger.
 *
 * A dive that grounds the ball a hair short of the plane counts ON the goal
 * line (Law 21.1's plane). Lateral overshoot is clamped into touch-in-goal
 * (the engine's own touch rules keep the carrier inside it), and depth past
 * the dead-ball line is clamped to the in-goal band — the dead-ball line
 * itself is a touch-down, never a try. */
export function tryGroundingSpot(dir: 1 | -1, x: number, z: number): TryGrounding {
  const goal = goalLineZ(dir);
  const dead = deadBallLineZ(dir);
  const band = (dead - goal) * dir;
  const depth = (z - goal) * dir;
  const legal = depth >= -TRY_REACH_TOLERANCE_M;
  const clamped = depth < 0 || depth > band || Math.abs(x) > TOUCH_IN_GOAL_X_M;
  const cd = Math.min(Math.max(depth, 0), band - 0.01);
  return {
    x: Math.min(Math.max(x, -TOUCH_IN_GOAL_X_M), TOUCH_IN_GOAL_X_M),
    z: goal + dir * cd,
    depth: cd,
    legal,
    clamped,
  };
}

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
   * the card itself is what matters.
   *
   * TARCS — the SAME verdict now also decides the sequencing: a cynical
   * offence (a high hit, or the repeat that earns the card) is never played
   * on. Law 7.4 is explicit that the referee must not allow advantage for
   * foul play; the whistle stays, and the restart comes immediately at the
   * mark. Only the non-cynical infringements get the advantage window. */
  let cynical = free;
  if (!free && offenderNum > 0) {
    const now = (d.half - 1) * 40 * 60 + d.clock;
    const key = `${opp}:${offenderNum}`;
    const last = d.offenceLog.get(key);
    const highTackle = call.includes('HIGH');
    const repeat = last !== undefined && now - last < 600;
    if (highTackle || (repeat && R() < 0.7)) {
      d.card(opp, offenderNum, highTackle ? 'HIGH TACKLE' : 'REPEAT OFFENCE');
      cynical = true;
    }
    d.offenceLog.set(key, now);
  }
  const f = { x: Number.isFinite(mark.x) ? mark.x : 0, z: Number.isFinite(mark.z) ? mark.z : 0 };
  d.pendingPenalty = { team, x: f.x, z: f.z, free };
  /* TARCS — ten seconds of play for a non-cynical offence, in the referee's
   * own clock (`engine/referee.ts` owns the number and the sequencing; the
   * option shortens or lengthens it). A free-kick offence, and a cynical
   * one, get no window at all. */
  d.advantage = cynical ? 0 : advantageWindowEngineS(d.options.advantage);
  d.advantageTeam = team;
  if (d.advantage > 0) {
    /* The referee's memory of WHY play is running: what the award was, where
     * the mark is, and how far the beneficiary has to carry it to cash the
     * advantage. The Director's per-frame block steps this watch and owns the
     * whistle when it comes back. */
    d.advWatch = openAdvantageWatch({
      team, award: 'PENALTY', markX: f.x, markZ: f.z,
      originZ: f.z, startsOwned: true, window: d.advantage,
    });
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
  /* TARCS — the advantage book closes with the award, by whatever door. */
  d.advWatch = null;
  d.pendingWindback = false;
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

/* ================================================================== *
 * SPEC_08 — THE MAUL LAW INDEX (the maulLaw=2 deprecation, one read site)
 * ================================================================== *
 *
 * NO LIMIT (legacy maulLaw=2) was deprecated by human review 2026-09-03 —
 * see SPEC_08_MAULLAW2_DECISION.md. Its only honest clock was a ~12 s
 * wait to the same scrum STOP ONCE awards at the use-it whistle, which is
 * exactly the ambient countdown that presentation work banned. Every read
 * of the option comes through this funnel: any value ≥ 1 (an old save, a
 * stale config, a harness that bypasses the load migration) collapses to
 * the STOP TWICE ladder, so no code path can resurrect an endless
 * standstill.
 */
export function maulLawIndex(option: number | undefined): 0 | 1 {
  return (option ?? 0) >= 1 ? 1 : 0;
}

/**
 * SPEC_08 — the unplayable-maul award, stated once. A stall whistle or a
 * legal collapse is a TURNOVER SCRUM to the DEFENDING team at the mark
 * the maul stopped at (Law 16.11 / Law 17). The engine resolves it
 * through engine/setpieces.finishMaulExit → startScrum; this predicate
 * exists so the ledger/audit treats the two UNPLAYABLE texts (`MAUL_STOPPED`
 * — held to a standstill, `MAUL_UNPLAYABLE` — brought to ground legally)
 * as the same class of award: a restart turnover, never a penalty.
 */
export const isMaulTurnoverCall = (call: string) =>
  call.startsWith('TURNOVER — MAUL');

export function lawCall(d: Director, key: string, call: string, team: 'A' | 'B') {

  d.refSignal = 1.8;
  d.refSignalText = call;
  /* T-10 — every law call has a whistle. */
  d.audio.whistle('LONG');
  if (isPenaltyCall(call)) d.teams[team].stats.penaltiesConceded++;
  else d.teams[team].stats.restarts++;
  d.say(call);
  /* SPEC_15 — the call is spoken by the man on the field, not printed over the
   * ruck. The audit rule ("every lawCall produced a bubble within 0.2 s") is
   * true here by construction: there is no path to a whistle that skips it. */
  d.refSay(call, isPenaltyCall(call) ? 'PENALTY' : 'LAW_CALL', 3.2);
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
  /* SPEC_15 — the card is the highest-priority thing he can say. */
  d.refSignal = 1.8;
  d.refSignalText = `YELLOW CARD — ${num}`;
  d.refSay(`YELLOW CARD — ${num}`, 'CARD', 4.5);
}
