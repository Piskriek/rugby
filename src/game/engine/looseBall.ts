/** A free ball is a world object, not a human hand-control state.
 * Gravity and contacts run once, both sides pursue it, and only a player who
 * actually reaches it may gather. Sleep is NOT an award of possession.
 */
import type { Director } from '../director';
import type { Live } from '../intelligence';
import { stepBallWithPlayers, type BallBody } from './ballPhysics';
import { eligibleToGather, canPlayBall, ballReach, type KickChaseLaw } from './ballAwareness';
export { eligibleToGather } from './ballAwareness';
import { clearLatch } from './latch';

type Team = 'A' | 'B';
type Player = { team: Team; num: number };
export interface LooseBallState {
  source: 'DROP' | 'STRIP' | 'PUNT' | 'PASS' | 'KICK';
  age: number;
  releasedBy: Player;
  lastTouch: Player;
  ignoreFor: number;
  /** A phase flight already integrated this frame before handing the body over. */
  skipStep: boolean;
  originX: number; originZ: number;
  gather: (Player & { t: number }) | null;
  chasers: (Player & { x: number; z: number })[];
  contacts: number;
  kickLaw?: KickChaseLaw;
}

function same(p: Player, q: Player): boolean { return p.team === q.team && p.num === q.num; }

/** Transfer ownership without changing the ball's pose, velocity or spin. */
export function adoptLooseBall(
  d: Director, b: BallBody, source: LooseBallState['source'], releasedBy: Player,
  alreadyStepped = false, ignoreFor = 0,
): void {
  b.socket = null;
  const bc = d.bc;
  bc.free = b;
  bc.team = releasedBy.team; bc.num = releasedBy.num;
  bc.ownsBall = false;
  bc.loose = {
    source, age: 0, releasedBy: { ...releasedBy }, lastTouch: { ...releasedBy }, ignoreFor,
    skipStep: alreadyStepped, originX: b.x, originZ: b.z, gather: null, chasers: [], contacts: 0,
  };
  if (bc.state !== 'DROP_BALL' && bc.state !== 'PUNT_KICK') {
    bc.state = source === 'PUNT' ? 'FLIGHT' : 'LOOSE';
    bc.t = 0; bc.foot = null; bc.window = 0;
  }
  if (d.op) {
    d.op.ball.socket = null;
    d.op.ball.live = false;
    if (d.op.latch) {
      const l = d.op.latch;
      clearLatch(d.op, d.L(l.carrierTeam, l.carrierNum), d.L(l.tacklerTeam, l.tacklerNum));
    }
  }
  for (const p of d.live) { p.carrier = false; p.passRank = 0; }
  d.refreshPassOptions();
}

function canReach(d: Director, p: Live, b: BallBody, s: LooseBallState): boolean {
  if (!eligibleToGather(p) || !canPlayBall(d, p) || (same(p, s.releasedBy) && s.age < s.ignoreFor)) return false;
  // Team-mates do not snatch the deliberate release inside a live punt swing.
  // Opponents can still charge it down; after a whiff everyone may collect.
  if (s.source === 'DROP' && s.age < s.ignoreFor && p.team === s.releasedBy.team) return false;
  // A running scoop or a descending catch; a high / too-fast ball hits the body
  // instead of being magnetised into the hands. The deliberate punt stays free.
  const reach = (b.y < 0.55 ? 0.80 : 0.90) * p.size;
  return Math.hypot(p.x - b.x, p.z - b.z) <= reach
    && b.y <= 2.15 * p.size + 0.1 && (b.vy <= 1.2 || b.grounded)
    && Math.hypot(b.vx - p.vx, b.vz - p.vz) <= 18;
}
function nearestGatherer(d: Director, b: BallBody, s: LooseBallState): Live | null {
  // Finish an in-reach attempt rather than swapping hands every time two players'
  // distances cross by a millimetre. Losing reach cancels the attempt immediately.
  if (s.gather) {
    const p = d.L(s.gather.team, s.gather.num);
    if (canReach(d, p, b, s)) return p;
  }
  let best: Live | null = null, distance = Infinity;
  for (const p of d.live) {
    if (!canReach(d, p, b, s)) continue;
    const gap = Math.hypot(p.x - b.x, p.z - b.z);
    if (gap < distance) { best = p; distance = gap; }
  }
  return best;
}

/** Caller has verified a hand catch or a completed in-reach scoop. Preserve the
 * gatherer's actual root/velocity and shirt — startOpen's default nine and
 * close-placement helper are specifically NOT an acceptable pickup mechanism. */
export function gatherLooseBall(d: Director, p: Live, why = 'GATHERED THE LOOSE BALL'): void {
  const prior = d.bc.loose?.lastTouch.team ?? d.op?.attacking;
  d.receipt = { team: p.team, at: d.t };
  d.startOpen(p.team, p.x, p.z, p.num, d.op?.phase ?? 1, 0, 0.25, true);
  d.run(p.team, p.num).carries++;
  d.say(prior && prior !== p.team ? 'TURNOVER — WON THE LOOSE BALL' : why);
}

/** Compatibility entry point; both kick and loose-ball rigs read the same decision. */
export function looseBallReach(d: Director, p: Player): number { return ballReach(d, p); }

/** Called before the human craft eligibility gate, in every free-ball posture. */
export function stepLooseBall(d: Director, dt: number): void {
  const bc = d.bc, b = bc.free;
  if (!b || !d.op || d.phase !== 'OPEN_PLAY') return;
  if (!bc.loose) {
    // Debug/probe-created bodies enter the same lifetime as real releases.
    const state = bc.state;
    adoptLooseBall(d, b, state === 'FLIGHT' ? 'PUNT' : 'DROP', { team: bc.team, num: bc.num });
    bc.state = state;
  }
  const s = bc.loose!;
  s.age += dt;
  const reaching = nearestGatherer(d, b, s);
  if (!s.skipStep) {
    stepBallWithPlayers(b, dt, d.live,
      p => p === reaching || (same(p, s.releasedBy) && s.age < s.ignoreFor),
      p => { s.lastTouch.team = p.team; s.lastTouch.num = p.num; s.contacts++; });
  }
  s.skipStep = false;
  bc.lastDistance = Math.hypot(b.x - s.originX, b.z - s.originZ);

  // Rules own touch/dead ball, never an imaginary gatherer at the old socket.
  if (Math.abs(b.x) > 34.6) {
    const thrower = s.lastTouch.team === 'A' ? 'B' : 'A';
    d.say('LOOSE BALL INTO TOUCH');
    d.startLineout(thrower, b.z, Math.sign(b.x) * 6);
    return;
  }
  if (Math.abs(b.z) > 61) {
    d.say('LOOSE BALL DEAD IN GOAL');
    d.touchDown(b.z > 0 ? 'B' : 'A');
    return;
  }

  const who = nearestGatherer(d, b, s);
  if (who) {
    if (!s.gather || !same(who, s.gather)) s.gather = { team: who.team, num: who.num, t: 0 };
    s.gather.t += dt;
    // A low scoop visibly bends/reaches; a descending catch closes more quickly.
    if (s.gather.t >= (b.y < 0.55 ? 0.16 : 0.055)) {
      gatherLooseBall(d, who, b.y < 0.55 ? 'PICKED UP OFF THE DECK' : 'TAKEN CLEANLY');
      return;
    }
  } else s.gather = null;
}
