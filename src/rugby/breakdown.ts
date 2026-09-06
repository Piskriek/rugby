/**
 * BREAKDOWN — the tackle → contest → clearout → ball-out sequence,
 * PRE-SIMULATED.
 *
 * A rugby breakdown is a choreographed event, not a particle system. Real
 * referees see the same beats every time: the hit, the placement, the jackal
 * arriving, the clearout driving him off, the ruck binding, and the nine
 * digging the ball out. This module authors that sequence and — crucially —
 * RESOLVES IT ONCE, at the moment of the tackle, before a single frame is
 * stepped.
 *
 * WHY PRE-SIMULATE
 *   The old prototype simulated the breakdown as a continuous per-frame force
 *   contest with per-frame dice. That spends the frame budget re-deciding
 *   something that was already decided when the first cleaner beat the jackal
 *   to the ball. Here the outcome (who wins, quick or slow ball, whether a
 *   penalty fires) is rolled once, the timeline is fixed, and the remaining
 *   work per frame is steering ~7 named bodies along authored slots. No
 *   spatial index, no separation, no re-rolls: O(7) a frame, deterministic
 *   given the seed.
 *
 * THE BEATS (authored, fixed durations)
 *   IMPACT   0.15s  tackler drives, carrier reacts; the pair slides forward,
 *                   sharing the carrier's momentum (damped) — a hit, not a stop
 *   GROUND   0.25s  both go to ground; the carrier presents the ball back
 *   ARRIVE   0.45s  first cleaner + jackal (then cleaner + counter) arrive
 *   CLEANOUT 0.40s  the cleaner drives the jackal off the ball — or the jackal
 *                   wins it (already decided) and the attack has to live with it
 *   RUCK     varies  the bind holds; quick ball 0.55s, slow ball 1.35s
 *   EXTRACT  0.40s  the winning nine arrives at the base and digs the ball out
 *
 * THE ROLES (the same names the legacy engine and the 3D layer share)
 *   CARRIER, TACKLER, FIRST_CLEARER, CLEANER, JACKAL, COUNTER, NINE
 */
import type { RugbySim } from './engine';
import type { Player, Side } from './types';
import { dist } from './consts';

export type BreakdownStage =
  | 'IMPACT' | 'GROUND' | 'ARRIVE' | 'CLEANOUT' | 'RUCK' | 'EXTRACT' | 'DONE';

export type BreakdownOutcome =
  | 'CLEAN'            // attack kept the ball, quick or slow
  | 'TURNOVER'         // the jackal stole it
  | 'PENALTY_ATTACK'   // not releasing — penalty to the defence
  | 'PENALTY_DEFENCE'; // jackal killed it — penalty to the attack

export interface BDSlot {
  role: string;
  id: number;
  side: Side;
  tx: number;
  ty: number;
  /** beat index (0..5) during which this body travels to its slot */
  moveBeat: number;
  speed: number;
}

export interface BreakdownState {
  x: number; y: number;         // anchor — where the tackle landed
  side: Side;                   // attacking side
  ad: number;                   // +1 A attacks +x, −1 B attacks −x
  t: number;
  stage: BreakdownStage;
  outcome: BreakdownOutcome;
  ballSpeed: 'QUICK' | 'SLOW';
  hitKind: 'RUNNING' | 'STANDING';
  slots: BDSlot[];
  ball: { x: number; y: number; placed: boolean; out: boolean };
  winner: Side;
  reason: string;
  nineId: number | null;
  // telemetry for the audit harness
  raceGap: number;       // clearerTime − jackalTime (s, +ve = jackal first)
  turnoverProb: number;
  dur: number;           // total scripted duration (s)
}

const IMPACT = 0.15;
const GROUND = 0.25;
const ARRIVE = 0.45;
const CLEANOUT = 0.40;
const RUCK_QUICK = 0.55;
const RUCK_SLOW = 1.35;
const EXTRACT = 0.40;

interface Beat { name: BreakdownStage; dur: number }

function beatPlan(ballSpeed: 'QUICK' | 'SLOW'): Beat[] {
  return [
    { name: 'IMPACT', dur: IMPACT },
    { name: 'GROUND', dur: GROUND },
    { name: 'ARRIVE', dur: ARRIVE },
    { name: 'CLEANOUT', dur: CLEANOUT },
    { name: 'RUCK', dur: ballSpeed === 'QUICK' ? RUCK_QUICK : RUCK_SLOW },
    { name: 'EXTRACT', dur: EXTRACT },
  ];
}

/** The arrival time of a body at the breakdown, seconds from the tackle. */
function arrivalTime(p: Player, ax: number, ay: number): number {
  const d = dist(p.x, p.y, ax, ay);
  const maxSpeed = 3 + (p.att.spd / 100) * 4.2;
  const reaction = 0.30 - (p.att.awa / 100) * 0.18; // 0.12 .. 0.30
  return d / maxSpeed + reaction;
}

/** Nearest eligible player of a side, excluding some ids. */
function nearestAvailable(sim: RugbySim, side: Side, x: number, y: number, exclude: Set<number>): Player | null {
  const team = side === 'A' ? sim.A : sim.B;
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of team.players) {
    if (exclude.has(p.id) || p.down > 0 || p.sinbin > 0 || p.bind >= 0) continue;
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

export class Breakdown {
  state: BreakdownState | null = null;

  /**
   * Resolve everything at the tackle and build the fixed timeline.
   * `carrier` may be null for a loose-ball scramble (no IMPACT/GROUND beats —
   * the ball is already on the floor, we go straight to the contest).
   */
  begin(sim: RugbySim, carrier: Player | null, tackler: Player | null, closingSpeed: number) {
    const ball = sim.ball;
    const side: Side = carrier ? carrier.side : (sim.possession ?? 'A');
    const ad = sim.attackDir(side);
    const ax = carrier ? carrier.x : ball.x;
    const ay = carrier ? carrier.y : ball.y;

    // fall forward: a carrier brought down at pace lands a stride beyond contact
    const fall = carrier ? Math.min(0.45, Math.abs(carrier.vx * ad) * 0.11) : 0;
    const bx = ax + ad * fall;
    const by = ay;

    const hitKind: 'RUNNING' | 'STANDING' = closingSpeed > 3.5 ? 'RUNNING' : 'STANDING';

    const exclude = new Set<number>();
    if (carrier) exclude.add(carrier.id);
    if (tackler) exclude.add(tackler.id);

    // --- the crews (arrival order is the whole contest) ---
    const clearer = nearestAvailable(sim, side, bx, by, exclude);           // FIRST CLEARER
    if (clearer) exclude.add(clearer.id);
    const cleaner = nearestAvailable(sim, side, bx, by, exclude);           // CLEANER
    if (cleaner) exclude.add(cleaner.id);
    const defSide: Side = side === 'A' ? 'B' : 'A';
    const jackal = nearestAvailable(sim, defSide, bx, by, exclude);         // JACKAL
    if (jackal) exclude.add(jackal.id);
    const counter = nearestAvailable(sim, defSide, bx, by, exclude);        // COUNTER

    const clearerT = clearer ? arrivalTime(clearer, bx, by) : 9;
    const jackalT = jackal ? arrivalTime(jackal, bx, by) : 9;
    const raceGap = clearerT - jackalT;   // +ve ⇒ the jackal is there first

    // --- resolve the contest ONCE ---
    // The attack keeps the ball unless the jackal genuinely beats the clearout
    // to the ball. A dominant, early jackal (or a THIEF) flips it; a late or
    // outmuscled jackal is driven off and the attack plays quick ball.
    const jSkill = jackal ? (jackal.att.agg + jackal.att.skl) / 2 : 0;
    const traitBoost = jackal?.trait === 'THIEF' ? 0.15 : 0;
    const turnoverProb = clamp(0.07 + raceGap * 1.25 + (jSkill - 70) * 0.004 + traitBoost, 0.04, 0.85);
    const roll = sim.rng();
    const turnover = jackal != null && roll < turnoverProb;

    // penalties — the two breakdown crimes, both rare and both honest
    const hotJackal = jackal && jackal.trait !== 'THIEF' && jackal.att.agg > 82 && roll > 0.80 && roll < 0.84;
    const notReleasing = carrier && carrier.att.skl < 62 && roll < 0.03;

    let outcome: BreakdownOutcome;
    let winner: Side;
    if (hotJackal) { outcome = 'PENALTY_DEFENCE'; winner = side; }
    else if (notReleasing) { outcome = 'PENALTY_ATTACK'; winner = defSide; }
    else if (turnover) { outcome = 'TURNOVER'; winner = defSide; }
    else { outcome = 'CLEAN'; winner = side; }

    const ballSpeed: 'QUICK' | 'SLOW' = outcome === 'CLEAN' && raceGap < 0.05 ? 'QUICK' : 'SLOW';

    // --- author the slots (absolute metres) ---
    const plan = beatPlan(ballSpeed);
    const slots: BDSlot[] = [];
    const push = (role: string, p: Player | null, tx: number, ty: number, moveBeat: number, speed: number) => {
      if (p) slots.push({ role, id: p.id, side: p.side, tx, ty, moveBeat, speed });
    };
    // carrier and tackler go down at the anchor; the ball presents back
    if (carrier) push('CARRIER', carrier, bx, by, 1, 0);
    if (tackler) push('TACKLER', tackler, bx + ad * 0.4, by, 1, 0);
    push('FIRST_CLEARER', clearer, bx - ad * 0.3, by - 0.5, 2, 1);
    push('JACKAL', jackal, bx + ad * 0.2, by + 0.4, 2, 1);
    push('CLEANER', cleaner, bx - ad * 0.9, by + 0.4, 2, 0.9);
    push('COUNTER', counter, bx + ad * 0.9, by - 0.4, 2, 0.9);

    // the winning nine extracts from the base
    const nine = sim.A.side === winner
      ? sim.A.players.find((p) => p.num === 9 && p.sinbin <= 0 && p.down <= 0)
      : sim.B.players.find((p) => p.num === 9 && p.sinbin <= 0 && p.down <= 0);
    if (nine) push('NINE', nine, bx - ad * 1.8, by, 5, 1);

    const dur = plan.reduce((a, b) => a + b.dur, 0);

    this.state = {
      x: bx, y: by, side, ad, t: 0, stage: 'IMPACT',
      outcome, ballSpeed, hitKind,
      slots, winner, reason: '',
      nineId: nine?.id ?? null,
      raceGap, turnoverProb, dur,
      ball: { x: bx - ad * 0.5, y: by, placed: false, out: false },
    };

    // live engine bookkeeping
    sim.phase = 'RUCK';
    sim.phaseT = 0;
    sim.possession = side;
    sim.ball.owner = null;
    sim.ball.vx = 0; sim.ball.vy = 0; sim.ball.z = 0.15;
    sim.ball.x = this.state.ball.x; sim.ball.y = this.state.ball.y;
    if (carrier) { carrier.down = 1.1; carrier.vx *= 0.3; carrier.vy *= 0.3; }
    if (tackler) { tackler.down = 1.1; tackler.vx *= 0.3; tackler.vy *= 0.3; }
    sim.count('breakdown');
    sim.count(outcome === 'CLEAN' ? 'bdClean' : outcome === 'TURNOVER' ? 'bdTurnover'
      : outcome === 'PENALTY_ATTACK' ? 'bdPenAttack' : 'bdPenDefence');
    sim.count(ballSpeed === 'QUICK' ? 'bdQuick' : 'bdSlow');
    if (outcome === 'CLEAN') sim.count('clearout');
    if (outcome === 'TURNOVER') sim.count('jackal');
    if (outcome === 'PENALTY_DEFENCE') sim.count('handsIn');
    if (outcome === 'PENALTY_ATTACK') sim.count('notReleasing');

    sim.say(
      carrier ? `${tackler ? tackler.name : 'The defence'} brings down ${carrier.name}` : 'Contest for the loose ball',
      winner,
    );
  }

  /** Step the authored sequence. O(number of scripted bodies) per frame. */
  step(sim: RugbySim, dt: number) {
    const s = this.state;
    if (!s) return;
    s.t += dt;

    // advance the beat
    let acc = 0;
    let beatIdx = 0;
    const plan = beatPlan(s.ballSpeed);
    for (let i = 0; i < plan.length; i++) {
      acc += plan[i].dur;
      if (s.t < acc) { beatIdx = i; break; }
      beatIdx = i;
    }
    const stage = (s.t >= s.dur ? 'DONE' : plan[Math.min(beatIdx, plan.length - 1)].name) as BreakdownStage;
    if (stage !== s.stage) {
      s.stage = stage;
      if (stage === 'RUCK') {
        s.ball.placed = true;
        if (s.outcome === 'CLEAN') sim.say('Ruck formed — ' + (s.ballSpeed === 'QUICK' ? 'quick ball' : 'slow ball'), s.side);
        else if (s.outcome === 'TURNOVER') sim.sayPair('TURNOVER', s.winner);
      }
      if (stage === 'EXTRACT') sim.say(s.outcome === 'CLEAN' ? 'Ball out — the nine digs it free' : 'Stolen — the nine snaps it away', s.winner);
    }

    // IMPACT: the pair slides forward, sharing damped momentum
    if (s.stage === 'IMPACT') {
      const decay = Math.max(0, 1 - dt / Math.max(1e-3, IMPACT - (s.t - dt)));
      for (const p of [sim.player(s.slots.find((q) => q.role === 'CARRIER')?.id ?? -1),
                       sim.player(s.slots.find((q) => q.role === 'TACKLER')?.id ?? -1)]) {
        if (!p) continue;
        p.vx *= decay; p.vy *= decay;
      }
    }

    // steer each body to its slot during (and after) its move beat; hold after
    for (const slot of s.slots) {
      const p = sim.player(slot.id);
      if (!p) continue;
      const beatOf = (): number => {
        let a = 0;
        for (let i = 0; i < plan.length; i++) { if (slot.role === plan[i].name && i >= slot.moveBeat) return i; a += plan[i].dur; }
        return slot.moveBeat;
      };
      const moving = s.t >= slotT(slot.moveBeat, plan) || s.stage === 'DONE';
      if (moving) {
        if (slot.role === 'CARRIER' || slot.role === 'TACKLER') {
          // grounded: lie still at the slot, keep the downed pose
          p.down = Math.max(p.down, 0.6);
          sim.steer(p, slot.tx, slot.ty, 0.2, dt);
        } else {
          const d = dist(p.x, p.y, slot.tx, slot.ty);
          const spd = d > 0.25 ? slot.speed : 0;
          p.down = 0;
          sim.steer(p, slot.tx, slot.ty, spd, dt);
        }
      }
      void beatOf;
    }

    // CLEANOUT: the cleaner drives the jackal off the ball (attack won) — or
    // the jackal holds over it (turnover). Slide the jackal back accordingly.
    if (s.stage === 'CLEANOUT') {
      const j = sim.player(s.slots.find((q) => q.role === 'JACKAL')?.id ?? -1);
      if (j) {
        if (s.outcome === 'CLEAN') {
          j.down = 0;
          sim.steer(j, s.x + s.ad * 1.7, s.y + 0.6, 1, dt);   // driven past the ball
          if (s.t < CLEANOUT * 0.5) sim.say('Clearout! ' + j.name + ' is driven off it', s.side);
        } else {
          // the jackal stays over the ball
          sim.steer(j, s.x + s.ad * 0.2, s.y + 0.4, 0.3, dt);
        }
      }
    }

    // the ball: presented back during GROUND, moves to the nine's base in EXTRACT
    const carrierSlot = s.slots.find((q) => q.role === 'CARRIER');
    if (s.stage === 'GROUND' && carrierSlot) {
      const c = sim.player(carrierSlot.id);
      if (c) { s.ball.x = c.x - s.ad * 0.5; s.ball.y = c.y; s.ball.placed = false; }
    } else if (s.stage === 'RUCK') {
      s.ball.placed = true;
      // the ball inches back toward the nine through the ruck (quick/slow)
      const nine = s.nineId != null ? sim.player(s.nineId) : null;
      const targetX = nine ? nine.x : s.x - s.ad * 1.5;
      const targetY = nine ? nine.y : s.y;
      const k = s.ballSpeed === 'QUICK' ? 2.2 : 1.0;
      s.ball.x += (targetX - s.ball.x) * Math.min(1, k * dt * 3);
      s.ball.y += (targetY - s.ball.y) * Math.min(1, k * dt * 3);
    }

    sim.ball.x = s.ball.x; sim.ball.y = s.ball.y; sim.ball.z = s.ball.placed ? 0.15 : 0.2;
    sim.integrate(dt);

    // resolve the penalties once the clearout beat has played out — the
    // referee sees the offence and blows it a beat later, not instantly
    const clearoutT = IMPACT + GROUND + ARRIVE;
    if (s.stage === 'CLEANOUT' && s.t >= clearoutT + 0.18 && s.outcome === 'PENALTY_ATTACK') {
      sim.say('NOT RELEASING — penalty', s.winner);
      sim.awardPenalty(s.winner, s.x, s.y);
      this.state = null;
      return;
    }
    if (s.stage === 'CLEANOUT' && s.t >= clearoutT + 0.18 && s.outcome === 'PENALTY_DEFENCE') {
      sim.say('HANDS IN THE RUCK — penalty', s.winner);
      sim.awardPenalty(s.winner, s.x, s.y);
      this.state = null;
      return;
    }

    // DONE: the nine plays it
    if (s.stage === 'DONE') {
      const winner = s.winner;
      this.state = null;
      sim.startOpen(winner, 9);
      return;
    }
  }
}

/** seconds at which a beat index begins */
function slotT(moveBeat: number, plan: Beat[]): number {
  let a = 0;
  for (let i = 0; i < Math.min(moveBeat, plan.length); i++) a += plan[i].dur;
  return a;
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
