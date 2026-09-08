/** One tactical read of the PHYSICAL ball, shared by both teams and the rig.
 * This plans marks, not movement or possession. Phase/think remains the sole
 * player integrator; the ball solver remains the sole free-body integrator.
 */
import type { Director } from '../director';
import { maxSpeed, type Live } from '../intelligence';
import { BALL_GRAVITY, type BallBody } from './ballPhysics';
import { clamp } from './clamp';

type Team = 'A' | 'B';
type Player = { team: Team; num: number };
export type BallRole = 'COLLECT' | 'RECEIVE' | 'SUPPORT' | 'CONTAIN' | 'COVER' | 'RELOAD' | 'RETREAT';
export interface BallTask { role: BallRole; x: number; z: number; urgency: number; sprint: boolean; job: string }
export interface BallRead {
  kind: 'HELD' | 'PASS' | 'KICK' | 'LOOSE' | 'SET_PIECE';
  body: BallBody | null;
  holder: Live | null;
  receiver: Live | null;
  team: Team;
  point: { x: number; y: number; z: number };
  target: { x: number; z: number; eta: number };
}
export interface BallBehaviour {
  read: BallRead | null;
  tasks: Map<string, BallTask>;
  /** Incumbent collectors win near-ties; they do not swap jobs every frame. */
  collectors: { A: number | null; B: number | null };
  token: BallBody | null;
  kind: BallRead['kind'] | null;
}
export interface KickChaseLaw {
  team: Team; dir: 1 | -1; originZ: number;
  onside: Set<number>;
  offside: Set<number>;
  frontier: number;
  updatedAt: number;
}
const id = (p: Player) => `${p.team}:${p.num}`;
const sigma = (team: Team): 1 | -1 => team === 'A' ? 1 : -1;

export function eligibleToGather(p: Live): boolean {
  return p.sinbin <= 0 && !p.down && !p.bound && (p.recoverT ?? 0) <= 0
    && (p.diveT ?? 0) <= 0 && !p.latchedBy && !p.latchingOnto;
}
export function makeBallBehaviour(): BallBehaviour {
  return { read: null, tasks: new Map(), collectors: { A: null, B: null }, token: null, kind: null };
}
export function clearBallBehaviour(state: BallBehaviour): void {
  state.read = null; state.tasks.clear(); state.collectors.A = state.collectors.B = null;
  state.token = null; state.kind = null;
}

/** Descending hand-height intercept. After a low bounce, lead the actual roll
 * briefly; never keep chasing an obsolete launch/landing mark after deflection. */
export function predictBall(b: BallBody): { x: number; z: number; eta: number } {
  let t: number;
  if (b.y > 1.4 || b.vy > 2) {
    t = Math.max(0, (b.vy + Math.sqrt(Math.max(0, b.vy * b.vy + 2 * BALL_GRAVITY * (b.y - 1.4)))) / BALL_GRAVITY);
  } else t = b.sleeping ? 0 : 0.25;
  t = clamp(t, 0, 4);
  return { x: clamp(b.x + b.vx * t, -34, 34), z: clamp(b.z + b.vz * t, -60, 60), eta: t };
}

export function readBall(d: Director): BallRead {
  const s = d.op, k = d.kk;
  if (d.phase === 'OPEN_PLAY' && s) {
    if (d.bc.free) {
      const b = d.bc.free;
      return { kind: 'LOOSE', body: b, holder: null, receiver: null, team: s.attacking,
        point: { x: b.x, y: b.y, z: b.z }, target: predictBall(b) };
    }
    const b = s.ball;
    if (b.live) {
      const remaining = Math.max(0, (1 - s.passT) * s.passDist / (13 * s.passPace));
      return { kind: 'PASS', body: b, holder: null, receiver: d.L(s.attacking, s.pendingReceiver), team: s.attacking,
        point: { x: b.x, y: b.y, z: b.z }, target: {
          x: clamp(b.x + b.vx * remaining, -34, 34), z: clamp(b.z + b.vz * remaining, -60, 60), eta: remaining,
        } };
    }
    const holder = d.L(s.attacking, s.carrierNum);
    return { kind: 'HELD', body: b, holder, receiver: null, team: s.attacking,
      point: { x: b.x, y: b.y, z: b.z }, target: { x: holder.x, z: holder.z, eta: 0 } };
  }
  if (k && k.stage === 'FLIGHT' && !k.profile.atGoal && (d.phase === 'KICK' || d.phase === 'KICK_REPLAY')) {
    return { kind: 'KICK', body: k.body, holder: null, receiver: null, team: k.kicker,
      point: { x: k.bx, y: k.by, z: k.bz }, target: predictBall(k.body) };
  }
  const point = d.ballPoint();
  return { kind: 'SET_PIECE', body: null, holder: null, receiver: null, team: d.possession,
    point, target: { x: point.x, z: point.z, eta: 0 } };
}

/** Capture who was in front of the kicker AT the kick, not at its landing.
 * They retreat/hold out of the contest until an onside team-mate puts them
 * onside. This is separate from the existing restart ten-metre flight gate. */
export function beginKickChase(d: Director, kicker: Player, z: number): KickChaseLaw {
  const dir = sigma(kicker.team), onside = new Set<number>(), offside = new Set<number>();
  for (const p of d.live) if (p.team === kicker.team) {
    (p.num === kicker.num || (p.z - z) * dir <= 0.15 ? onside : offside).add(p.num);
  }
  return { team: kicker.team, dir, originZ: z, onside, offside, frontier: z * dir, updatedAt: NaN };
}
function activeKickLaw(d: Director): KickChaseLaw | undefined {
  const law = d.bc.free ? d.bc.loose?.kickLaw : d.kk?.stage === 'FLIGHT' ? d.kk.chaseLaw : undefined;
  if (!law || law.updatedAt === d.t) return law;
  law.updatedAt = d.t;
  let frontier = law.originZ * law.dir;
  for (const p of d.live) if (p.team === law.team && law.onside.has(p.num) && p.sinbin <= 0 && !p.down) {
    frontier = Math.max(frontier, p.z * law.dir);
  }
  law.frontier = frontier;
  for (const num of law.offside) {
    if (d.L(law.team, num).z * law.dir <= frontier + 0.15) { law.offside.delete(num); law.onside.add(num); }
  }
  return law;
}
export function canPlayBall(d: Director, p: Live): boolean {
  const law = activeKickLaw(d);
  return !(law && law.team === p.team && law.offside.has(p.num));
}
function candidate(d: Director, p: Live, ball: BallRead): boolean {
  if (!eligibleToGather(p) || !canPlayBall(d, p)) return false;
  const loose = d.bc.loose;
  if (d.bc.free && loose && loose.age < loose.ignoreFor && p.team === loose.releasedBy.team
    && (loose.source === 'DROP' || p.num === loose.releasedBy.num)) return false;
  // The stick owns the human, but an already-arriving human collector can be
  // supported. An idle human far away must not stop his team-mates helping.
  if (d.isHuman(p.team) && d.ctrlPlayer === p) {
    const dx = ball.target.x - p.x, dz = ball.target.z - p.z;
    if (Math.hypot(dx, dz) > 1.1 && !(Math.hypot(dx, dz) < 3 && p.vx * dx + p.vz * dz > 3)) return false;
  }
  return true;
}
function arrival(p: Live, ball: BallRead): number {
  const dx = ball.target.x - p.x, dz = ball.target.z - p.z, gap = Math.hypot(dx, dz);
  const speed = Math.hypot(p.vx, p.vz);
  const turn = speed > 1.2 && (p.vx * dx + p.vz * dz) < -0.5 * speed * gap ? 0.35 : 0;
  return gap / maxSpeed(p, false, true, p.stamina) + turn;
}
// Spread across a useful pitch width. Roles survive the contest; thirty men
// do not all run to a point and then have to rebuild a rugby team afterwards.
const LANES = [0, -7, 0, 7, -10, 10, -4, 4, 0, -3, -13, -25, -8, 8, 25, 0];
const JOB: Record<BallRole, string> = {
  COLLECT: 'CHASE AND COLLECT THE BALL', RECEIVE: 'MEET THE PASS — HANDS READY',
  SUPPORT: 'SUPPORT THE COLLECTOR — STAY BEHIND THE BALL', CONTAIN: 'CLOSE THE RECEIVING CHANNEL — DO NOT CHASE THE PASSER',
  COVER: 'COVER THE BOUNCE AND COUNTERATTACK', RELOAD: 'RELOAD BEHIND THE INCOMING BALL',
  RETREAT: 'OFFSIDE AT THE KICK — GET BACK, DO NOT PLAY IT',
};
function assign(state: BallBehaviour, p: Live, role: BallRole, x: number, z: number): void {
  const sprint = role === 'COLLECT' || role === 'RECEIVE' || role === 'CONTAIN' || role === 'SUPPORT';
  state.tasks.set(id(p), { role, x: clamp(x, -34, 34), z: clamp(z, -60, 60),
    urgency: sprint || role === 'RETREAT' ? 1 : 0.78, sprint, job: JOB[role] });
}

/** One plan per frame. Every unbound off-ball player gets exactly one role.
 * Position trees remain in charge of held possession and all set pieces. */
export function coordinateBall(d: Director): void {
  const state = d.ballBehaviour, ball = readBall(d);
  state.tasks.clear(); state.read = ball;
  // A few centimetres either side of halfway must not flip every receiving
  // lane. Change the open side only after a meaningful lateral carry.
  if (ball.holder && d.op) {
    if (ball.holder.x > 6) d.op.open = -1;
    else if (ball.holder.x < -6) d.op.open = 1;
  }
  if (state.token !== ball.body || state.kind !== ball.kind) state.collectors.A = state.collectors.B = null;
  state.token = ball.body; state.kind = ball.kind;
  if (ball.kind === 'HELD' || ball.kind === 'SET_PIECE') return;
  const law = activeKickLaw(d), { x, z } = ball.target;
  for (const team of ['A', 'B'] as const) {
    const dir = sigma(team);
    const pool = d.live.filter(p => p.team === team && candidate(d, p, ball));
    pool.sort((a, b) => arrival(a, ball) - arrival(b, ball) || a.num - b.num);
    let first = pool[0];
    const incumbent = pool.find(p => p.num === state.collectors[team]);
    if (incumbent && first && arrival(incumbent, ball) <= arrival(first, ball) + 0.28) first = incumbent;
    if (ball.kind === 'PASS' && team === ball.team) first = ball.receiver && eligibleToGather(ball.receiver) ? ball.receiver : first;
    const gathering = d.bc.loose?.gather;
    if (d.bc.free && gathering?.team === team) {
      const hands = d.L(team, gathering.num);
      if (eligibleToGather(hands) && canPlayBall(d, hands)) first = hands;
    }
    const second = pool.find(p => p !== first);
    state.collectors[team] = first?.num ?? null;
    const isPassDefence = ball.kind === 'PASS' && team !== ball.team;
    for (const p of d.live) {
      if (p.team !== team || !eligibleToGather(p)) continue;
      if (law && team === law.team && law.offside.has(p.num)) {
        assign(state, p, 'RETREAT', p.x, dir * Math.min(law.frontier - 0.6, z * dir - 10.5));
      } else if (p === first) {
        assign(state, p, isPassDefence ? 'CONTAIN' : ball.kind === 'PASS' ? 'RECEIVE' : 'COLLECT',
          x, z - (isPassDefence ? dir * 1.4 : 0));
      } else if (p === second) {
        const side = p.x < x ? -1 : 1;
        assign(state, p, isPassDefence ? 'CONTAIN' : 'SUPPORT', x + side * 2.8,
          z - dir * (isPassDefence ? 2.2 : 3.2));
      } else {
        const lane = LANES[p.num] * dir;
        const depth = p.num === 15 ? 17 : p.num <= 8 ? 7 + p.num % 3 : 10;
        assign(state, p, ball.kind === 'PASS' && team === ball.team ? 'RELOAD' : 'COVER',
          clamp(x, -10, 10) + lane, z - dir * depth);
      }
    }
  }
  // Compatibility for the craft HUD/probes: only collectors and their immediate
  // support get a reach, not the whole line or a positional extra jackal.
  if (d.bc.free && d.bc.loose) {
    const chasers = d.bc.loose.chasers;
    chasers.length = 0;
    for (const p of d.live) {
      const task = state.tasks.get(id(p));
      if (task?.role === 'COLLECT' || task?.role === 'SUPPORT') chasers.push({ team: p.team, num: p.num, x: task.x, z: task.z });
    }
  }
}

/** Render only a real approaching receiver/collector's hands, at the real ball. */
export function ballReach(d: Director, p: Player): number {
  const ball = readBall(d);
  if (!ball.body || ball.kind === 'HELD' || ball.kind === 'SET_PIECE') return 0;
  const role = d.ballBehaviour.tasks.get(id(p))?.role;
  const gather = d.bc.loose?.gather;
  if (role !== 'COLLECT' && role !== 'RECEIVE' && role !== 'SUPPORT'
    && !(gather && gather.team === p.team && gather.num === p.num)) return 0;
  const live = d.L(p.team, p.num);
  if (!eligibleToGather(live) || !canPlayBall(d, live) || ball.point.y > 2.4 * live.size) return 0;
  const gap = Math.hypot(live.x - ball.point.x, live.z - ball.point.z);
  return gap < 2 ? clamp(1 - gap / 2.5, 0, 1) : 0;
}
