/**
 * WORLD CLASS RUGBY — simulation engine (2026 clean-room rewrite).
 *
 * A fixed-timestep-friendly, allocation-conscious rugby-union simulator.
 * Everything the old build carried across ~18k lines of prototype is
 * compressed here into one legible engine: phases (kickoff, open play,
 * ruck, maul, scrum, lineout, kicks, try, dead ball), the core laws
 * (knock-on, forward pass, offside, touch, in-goal), a referee with
 * advantage, and the scoring table.
 *
 * The AI lives in ai.ts; this module owns physics and the rules.
 */
import { TRY_X, DEAD_X, TOUCH_Y, POINTS, attackDir, clampPitch, dist } from './consts';
import type { Side, Phase, Player, Ball, Team, Evt, InputState, Wish, MatchOpts, Act } from './types';
import { NO_INPUT } from './types';
import { buildTeam, nationById } from './teams';
import { mulberry32, type RNG } from './rng';
import { SpatialGrid } from './spatial';
import { plan } from './ai';

const G = 9.8;

/* ---- set-piece states ---- */
interface RuckState { x: number; y: number; t: number; attackers: number[]; defenders: number[]; winner: Side | null; }
interface MaulState { x: number; y: number; side: Side; t: number; stall: number; bound: number[]; }
interface ScrumState { x: number; y: number; feed: Side; t: number; stage: 'FORM' | 'FEED' | 'PLAY'; winner: Side | null; }
interface LineoutState { x: number; y: number; thrower: Side; t: number; stage: 'FORM' | 'THROW' | 'PLAY'; winner: Side | null; }
interface KickState {
  kind: 'PENALTY' | 'CONVERSION' | 'KICKOFF' | 'DROPOUT';
  side: Side; x: number; y: number; t: number;
  aim: number; power: number; kicked: boolean; tryX: number;
}

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function angNorm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class RugbySim {
  readonly rng: RNG;
  readonly opts: MatchOpts;
  readonly A: Team;
  readonly B: Team;
  ball: Ball;
  phase: Phase = 'KICKOFF';
  phaseT = 0;
  clock = 0;
  half: 1 | 2 = 1;
  ended = false;
  winner: Side | null = null;

  human: Side | 'WATCH';
  difficulty: number;

  possession: Side | null = null;   // team in possession of the ball
  ctrlId: number;                   // human-controlled player id

  ruck: RuckState | null = null;
  maul: MaulState | null = null;
  scrum: ScrumState | null = null;
  lineout: LineoutState | null = null;
  kick: KickState | null = null;
  trySide: Side | null = null;      // who just scored, awaiting conversion

  adv: { side: Side; t: number } | null = null;

  feed: Evt[] = [];
  msg = '';
  counts: Record<string, number> = {};

  // performance bookkeeping
  lastStepMs = 0;

  private all: Player[] = [];
  private byId = new Map<number, Player>();
  private wishes: Wish[] = [];
  private grid = new SpatialGrid();
  private qbuf: number[] = [];
  private halfSec: number;
  private prevKickHeld = false;
  private placeAttempt: { side: Side; kind: 'PENALTY' | 'CONVERSION' } | null = null;
  private dropAttempt: Side | null = null;
  private pendingReceiver: number | null = null;
  /** grace window after a breakdown release: defenders must get onside first */
  releaseGrace = 0;
  /** after a line break, the cover defence is briefly flat-footed */
  defenseShock = 0;

  constructor(opts: MatchOpts) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed);
    this.human = opts.human;
    this.difficulty = opts.difficulty;
    this.halfSec = Math.max(30, opts.halfMinutes * 60);
    const rngA = mulberry32(opts.seed ^ 0x9e3779b9);
    const rngB = mulberry32((opts.seed ^ 0x85ebca6b) >>> 0);
    this.A = buildTeam('A', nationById(opts.home), rngA);
    this.B = buildTeam('B', nationById(opts.away), rngB);
    this.all = [...this.A.players, ...this.B.players];
    for (const p of this.all) this.byId.set(p.id, p);
    this.wishes = this.all.map(() => ({ tx: 0, ty: 0, speed: 0, sprint: false, act: null }));
    this.ball = this.newBall();
    this.ctrlId = this.human === 'WATCH' ? -1 : (this.human === 'A' ? 1 : 101);
    this.beginKickoff('A');
  }

  /* ---------------- accessors ---------------- */

  private team(s: Side): Team { return s === 'A' ? this.A : this.B; }
  private other(s: Side): Side { return s === 'A' ? 'B' : 'A'; }
  private player(id: number): Player | undefined { return this.byId.get(id); }
  carrier(): Player | null { return this.ball.owner != null ? (this.byId.get(this.ball.owner) ?? null) : null; }
  private ad(s: Side): number { return attackDir(s); }

  private newBall(): Ball {
    return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: null, last: null, spin: 0, flight: 0, forwardTouch: false, trail: [] };
  }

  private say(text: string, side: Side | null = null) {
    this.feed.unshift({ t: this.clock, text, side });
    if (this.feed.length > 40) this.feed.pop();
    this.msg = text;
  }

  private count(k: string) { this.counts[k] = (this.counts[k] ?? 0) + 1; }

  /* ---------------- main loop ---------------- */

  step(dt: number, held: InputState = NO_INPUT, pressed: InputState = NO_INPUT) {
    if (this.ended) return;
    const t0 = (globalThis as any).performance?.now?.() ?? Date.now();
    dt = clamp(dt, 0, 0.05);
    this.clock += dt;
    this.phaseT += dt;

    // global timers
    for (const p of this.all) {
      if (p.sinbin > 0) p.sinbin = Math.max(0, p.sinbin - dt);
      if (p.down > 0) p.down = Math.max(0, p.down - dt);
      if (p.held > 0) p.held = Math.max(0, p.held - dt);
      if (p.burst > 0) p.burst = Math.max(0, p.burst - dt);
      if (p.decide > 0) p.decide = Math.max(0, p.decide - dt);
      if (p.sprinting && p.stamina > 0) p.stamina = Math.max(0, p.stamina - 26 * dt);
      else p.stamina = Math.min(100, p.stamina + 7 * dt);
    }
    if (this.releaseGrace > 0) this.releaseGrace = Math.max(0, this.releaseGrace - dt);
    if (this.defenseShock > 0) this.defenseShock = Math.max(0, this.defenseShock - dt);
    if (this.adv && (this.clock - this.adv.t > 4.5)) this.adv = null;

    this.updateControl(held);

    switch (this.phase) {
      case 'KICKOFF': this.stepKick(dt, held); break;
      case 'DROP_KICK': this.stepKick(dt, held); break;
      case 'PLACE_KICK': this.stepKick(dt, held); break;
      case 'OPEN': this.stepOpen(dt, held, pressed); break;
      case 'RUCK': this.stepRuck(dt); break;
      case 'MAUL': this.stepMaul(dt); break;
      case 'SCRUM': this.stepScrum(dt); break;
      case 'LINEOUT': this.stepLineout(dt); break;
      case 'TRY': this.stepTry(dt); break;
      case 'DEAD': this.stepDead(dt); break;
    }

    // clock expiry
    if (!this.ended && this.clock >= this.halfSec) {
      if (this.half === 1) {
        this.half = 2; this.clock = 0;
        this.say('HALF TIME — sides change ends');
        this.beginKickoff('B');
      } else {
        this.ended = true;
        this.winner = this.A.score === this.B.score ? null : (this.A.score > this.B.score ? 'A' : 'B');
        this.say(this.winner ? `${this.team(this.winner).name} WIN ${this.A.score}–${this.B.score}` : `FULL TIME — DRAW ${this.A.score}–${this.B.score}`);
      }
    }

    const now = (globalThis as any).performance?.now?.() ?? Date.now();
    this.lastStepMs = now - t0;
  }

  /* ---------------- control (human) ---------------- */

  private updateControl(held: InputState) {
    if (this.human === 'WATCH') return;
    const side = this.human as Side;
    if (held.switchP) {
      // cycle to next-nearest onside player of the human side
      const cur = this.player(this.ctrlId);
      const target = this.carrier() ?? cur;
      const tx = this.ball.x, ty = this.ball.y;
      const cands = this.team(side).players
        .filter((p) => p !== target && p.down <= 0 && p.sinbin <= 0 && p.bind < 0)
        .sort((a, b) => dist(a.x, a.y, tx, ty) - dist(b.x, b.y, tx, ty));
      if (cands.length) this.ctrlId = cands[0].id;
    }
    // keep control on the carrier when your side has the ball
    if (this.possession === side && this.carrier()?.side === side) {
      this.ctrlId = this.carrier()!.id;
    }
    // auto-reassign if the controlled player is out of the contest
    const cur = this.player(this.ctrlId);
    if (!cur || cur.down > 0 || cur.sinbin > 0 || cur.side !== side) {
      const cands = this.team(side).players.filter((q) => q.down <= 0 && q.sinbin <= 0);
      if (cands.length) {
        cands.sort((a, b) => dist(a.x, a.y, this.ball.x, this.ball.y) - dist(b.x, b.y, this.ball.x, this.ball.y));
        this.ctrlId = cands[0].id;
      }
    }
  }

  private controlled(): Player | null { return this.player(this.ctrlId) ?? null; }

  /** Human steering for the controlled player, relative to attack direction. */
  private applyHuman(held: InputState, pressed: InputState) {
    if (this.human === 'WATCH') return;
    const p = this.controlled();
    if (!p || p.down > 0 || p.bind >= 0) return;
    this.wishFor(p).act = null;
    const ad = this.ad(p.side);
    let mx = 0, my = 0;
    if (held.fwd) mx += ad;
    if (held.back) mx -= ad;
    if (held.left) my -= ad;
    if (held.right) my += ad;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      const w = this.wishFor(p);
      w.tx = p.x + (mx / len) * 4;
      w.ty = p.y + (my / len) * 4;
      w.speed = 1;
      w.sprint = held.sprint;
    } else {
      const w = this.wishFor(p);
      w.tx = p.x; w.ty = p.y; w.speed = 0; w.sprint = false;
    }
    // discrete actions, only for the controlled player
    if (pressed.passL || pressed.passR || pressed.punt || pressed.grubber || pressed.drop
      || pressed.tackle || pressed.fend || pressed.step || pressed.context) {
      this.humanAct(p, pressed);
    }
  }

  private humanAct(p: Player, pressed: InputState) {
    const carrier = this.carrier();
    if (p === carrier) {
      const dir = this.ad(p.side);
      if (pressed.passL) this.tryPass(p, dir * -1);
      else if (pressed.passR) this.tryPass(p, dir * 1);
      else if (pressed.punt) { this.doKick(p, 'PUNT'); }
      else if (pressed.grubber) { this.doKick(p, 'GRUBBER'); }
      else if (pressed.drop) { this.doKick(p, 'DROP'); }
      else if (pressed.fend || pressed.step || pressed.context) {
        // context / fend / step on the carry: a sharp injection of pace that
        // helps beat the next tackler (the fend power bonus is in tryTackle)
        p.burst = Math.max(p.burst, 0.55);
        this.count('dodge');
      }
    } else if (this.phase === 'OPEN' && carrier && carrier.side !== p.side) {
      if (pressed.tackle || pressed.context) {
        if (dist(p.x, p.y, carrier.x, carrier.y) < 2.6) this.tryTackle(p, carrier);
      }
    }
  }

  private wishFor(p: Player): Wish {
    return this.wishes[p.id < 100 ? p.id - 1 : p.id - 101 + 15];
  }

  /* ---------------- OPEN PLAY ---------------- */

  private stepOpen(dt: number, held: InputState, pressed: InputState) {
    const carrier = this.carrier();
    this.possession = carrier ? carrier.side : this.possession;

    plan(this, this.wishes);
    this.applyHuman(held, pressed);

    for (const p of this.all) {
      if (p.bind >= 0 || p.down > 0) continue;
      const w = this.wishFor(p);
      p.sprinting = w.sprint;
      // the intended receiver runs onto the ball — momentum carry-out
      if (this.pendingReceiver === p.id && this.ball.owner == null) {
        this.steer(p, this.ball.x, this.ball.y, 1, dt);
        p.sprinting = true;
      } else {
        this.steer(p, w.tx, w.ty, w.speed, dt);
      }
    }

    this.integrate(dt);
    this.separate();

    // execute AI + human discrete actions
    this.executeActs();

    // ball flight / loose-ball physics
    if (this.ball.owner == null) this.stepLooseBall(dt);

    // carrier carries the ball
    const c = this.carrier();
    if (c) {
      this.ball.x = c.x + Math.cos(c.face) * 0.55;
      this.ball.y = c.y + Math.sin(c.face) * 0.55;
      this.ball.z = 0.9;
      this.ball.forwardTouch = false;
    }

    this.checkLinesAndLaws();
  }

  private executeActs() {
    // carrier actions (AI only — a human-controlled carrier acts via input)
    const carrier = this.carrier();
    if (carrier && carrier.id !== this.ctrlId && this.phase === 'OPEN') {
      const w = this.wishFor(carrier);
      if (w.act) this.doAct(carrier, w.act);
      w.act = null;
    }
    // every other AI-controlled body: tackles and scoops (bounded per frame)
    let tackles = 0;
    for (const p of this.all) {
      if (p.id === this.ctrlId || p.down > 0) continue;
      const w = this.wishFor(p);
      if (!w.act) continue;
      if (w.act.kind === 'TACKLE' && tackles < 2 && carrier && carrier.side !== p.side) {
        this.tryTackle(p, carrier); tackles++;
      } else if (w.act.kind === 'SCOOP') {
        this.tryScoop(p);
      }
      w.act = null;
    }
  }

  private doAct(p: Player, act: Act) {
    switch (act.kind) {
      case 'PASS': this.tryPassTo(p, act.target); break;
      case 'PUNT': this.doKick(p, 'PUNT'); break;
      case 'GRUBBER': this.doKick(p, 'GRUBBER'); break;
      case 'DROP': this.doKick(p, 'DROP'); break;
      case 'TACKLE': { const c = this.carrier(); if (c && c.side !== p.side) this.tryTackle(p, c); break; }
      case 'SCOOP': this.tryScoop(p); break;
    }
  }

  private steer(p: Player, tx: number, ty: number, spd: number, dt: number) {
    const d = dist(p.x, p.y, tx, ty);
    if (d > 0.05) {
      const want = Math.atan2(ty - p.y, tx - p.x);
      p.face = angNorm(p.face + clamp(angNorm(want - p.face), -10 * dt, 10 * dt));
    }
    const carry = this.ball.owner === p.id;
    const base = (3.0 + (p.att.spd / 100) * 4.2) * (1 - (p.size - 1) * 0.25);
    let max = base * (carry ? 0.9 : 1);
    const stam = 0.6 + 0.4 * Math.max(0, p.stamina / 100);
    max *= stam;
    if (p.sprinting) max *= 1.26;
    let targetV = d > 0.25 ? max * clamp(spd, 0, 1) : 0;
    if (p.burst > 0) targetV *= 1.32;
    p.vx = Math.cos(p.face) * targetV;
    p.vy = Math.sin(p.face) * targetV;
  }

  private integrate(dt: number) {
    for (const p of this.all) {
      if (p.bind >= 0 || p.down > 0) { p.vx *= 0.5; p.vy *= 0.5; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const [cx, cy] = clampPitch(p.x, p.y);
      if (cx !== p.x || cy !== p.y) { p.x = cx; p.y = cy; p.vx *= 0.3; p.vy *= 0.3; }
    }
  }

  /** Soft circle separation — keeps bodies from stacking into one blob. */
  private separate() {
    const xs: number[] = []; const ys: number[] = [];
    for (const p of this.all) { xs.push(p.x); ys.push(p.y); }
    this.grid.build(xs, ys);
    for (let i = 0; i < this.all.length; i++) {
      const a = this.all[i];
      if (a.bind >= 0) continue;
      const ra = 0.42 * a.size;
      this.grid.query(a.x, a.y, ra + 0.5, this.qbuf);
      for (let k = 0; k < this.qbuf.length; k++) {
        const j = this.qbuf[k];
        if (j <= i) continue;
        const b = this.all[j];
        if (b.bind >= 0) continue;
        const rb = 0.42 * b.size;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = ra + rb;
        if (d > 0.001 && d < min) {
          const push = (min - d) / 2;
          const ux = dx / d, uy = dy / d;
          if (a.down <= 0 && this.ball.owner !== a.id) { a.x -= ux * push; a.y -= uy * push; }
          if (b.down <= 0 && this.ball.owner !== b.id) { b.x += ux * push; b.y += uy * push; }
        }
      }
    }
  }

  /* ---------------- ball (loose) ---------------- */

  private stepLooseBall(dt: number) {
    const b = this.ball;
    // trail for rendering
    b.trail.push([b.x, b.y]);
    if (b.trail.length > 8) b.trail.shift();

    if (b.z > 0.001 || b.flight > 0) {
      b.z += b.vz * dt;
      b.vz -= G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.spin += dt * 14;
      if (b.z <= 0) {
        b.z = 0;
        const kicked = b.flight > 0;
        b.flight = 0;
        if (kicked) {
          // kick lands: bounce
          if (b.vz < -1.2) {
            b.vz = -b.vz * 0.34;
            b.vx *= 0.55; b.vy *= 0.55;
          } else { b.vz = 0; b.vx *= 0.3; b.vy *= 0.3; }
          this.count('kickLand');
        } else if (b.forwardTouch) {
          this.whistleKnockOn();
          return;
        }
      }
    } else {
      // rolling on the grass
      b.vx *= Math.max(0, 1 - 3 * dt);
      b.vy *= Math.max(0, 1 - 3 * dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.forwardTouch && Math.hypot(b.vx, b.vy) < 0.4) {
        // a forward knock-on that has settled — scrum
        this.whistleKnockOn();
        return;
      }
    }

    // catch attempts
    if (b.z < 1.7 && b.z > 0.001 && b.flight <= 0) {
      let best: Player | null = null; let bd = 0.9;
      for (const p of this.all) {
        if (p.down > 0 || p.bind >= 0) continue;
        const d = dist(p.x, p.y, b.x, b.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best && bd < 0.85) {
        // catch roll: skill-weighted; receivers catch cleanly
        const skill = best.att.skl / 100;
        if (this.rng() < 0.72 + skill * 0.24) {
          b.owner = best.id; b.last = best.id;
          b.vx = 0; b.vy = 0; b.vz = 0; b.z = 0.9;
          b.forwardTouch = false;
          this.dropAttempt = null; this.placeAttempt = null;
          this.pendingReceiver = null;
          this.possession = best.side;
          this.say(`${best.name} gathers the loose ball`, best.side);
          this.count('gather');
          return;
        } else {
          // dropped — knock-on or bobble
          b.forwardTouch = this.rng() < 0.3;
          b.vz = 0.5; b.vx *= 0.4; b.vy *= 0.4;
          b.last = best.id;
          this.count('fumble');
          return;
        }
      }
    }

    // adjudicate kicks at goal the moment they cross the goal plane
    if (this.adjudicateKicks()) return;

    // scoop a ball lying on the ground
    if (b.z < 0.3 && b.flight <= 0) {
      let best: Player | null = null; let bd = 1.0;
      for (const p of this.all) {
        if (p.down > 0 || p.bind >= 0 || p.sinbin > 0) continue;
        const d = dist(p.x, p.y, b.x, b.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (best && bd < 0.7) {
        b.owner = best.id; b.last = best.id;
        b.vx = 0; b.vy = 0; b.z = 0.9; b.forwardTouch = false;
        this.dropAttempt = null; this.placeAttempt = null;
        this.pendingReceiver = null;
        this.possession = best.side;
        this.say(`${best.name} snatches the loose ball`, best.side);
        this.count('scoop');
      }
    }
  }

  private whistleKnockOn() {
    const b = this.ball;
    const atk = b.last != null ? (this.player(b.last)?.side ?? this.possession ?? 'A') : (this.possession ?? 'A');
    const to = this.other(atk as Side);
    this.say('KNOCK-ON — scrum', to);
    this.count('knockOn');
    this.beginScrum(to, b.x, b.y);
  }

  /* ---------------- pass / kick / tackle ---------------- */

  private tryPass(p: Player, sideSign: number) {
    const ad = this.ad(p.side);
    // choose a receiver: on the requested side (sign of cross product relative to attack dir)
    let best: Player | null = null; let bestScore = -Infinity;
    for (const q of this.team(p.side).players) {
      if (q === p || q.down > 0 || q.bind >= 0 || q.sinbin > 0) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      const forward = dx * ad;              // metres upfield
      const across = dy * ad;               // +ve = one wing, -ve = the other
      const side = Math.sign(across) || 0;
      if (side !== sideSign && across !== 0) continue;
      if (forward > -0.8) continue;         // receiver must be at least a metre behind
      const d = Math.hypot(dx, dy);
      if (d > 22) continue;
      // openness: fewer defenders near the receiver
      let nearby = 0;
      for (const d2 of this.team(this.other(p.side)).players) {
        if (d2.down > 0) continue;
        if (dist(q.x, q.y, d2.x, d2.y) < 3) nearby++;
      }
      const score = forward * 0.6 - d * 0.25 - nearby * 1.4 + q.att.skl * 0.02;
      if (score > bestScore) { bestScore = score; best = q; }
    }
    if (!best) return;
    this.tryPassTo(p, best.id);
  }

  private tryPassTo(p: Player, toId: number) {
    const to = this.player(toId);
    if (!to || this.ball.owner !== p.id) return;
    const d = dist(p.x, p.y, to.x, to.y);
    if (d < 0.4) { this.ball.owner = to.id; this.ball.last = to.id; return; }
    const speed = Math.min(19, 12 + d * 0.45);
    const flight = d / speed;
    // half-lead: the ball lands between the receiver and where he is headed,
    // so he runs onto it — a genuinely flat/backward throw, not a forward one
    const tx = to.x + to.vx * flight * 0.5, ty = to.y + to.vy * flight * 0.5;
    const dx = tx - p.x, dy = ty - p.y;
    const dd = Math.hypot(dx, dy) || 1;
    const ux = dx / dd, uy = dy / dd;
    const ad = this.ad(p.side);
    // Law 11: forward relative to the passer's motion
    const rel = ux * ad * speed - p.vx * ad;
    this.ball.vx = ux * speed; this.ball.vy = uy * speed;
    this.ball.vz = (G * flight) / 2;
    this.ball.owner = null; this.ball.last = p.id;
    this.ball.x = p.x; this.ball.y = p.y; this.ball.z = 0.7;
    this.ball.flight = 0;
    this.ball.forwardTouch = rel > 0;
    this.count('pass');
    if (rel > 1.1) {
      // forward pass — whistle it (Law 11, judged on the throw)
      this.pendingReceiver = null;
      this.say('FORWARD PASS — scrum', this.other(p.side));
      this.count('forwardPass');
      this.beginScrum(this.other(p.side), p.x, p.y);
    } else {
      this.pendingReceiver = to.id;
      // interception: ONE roll against the defender best-placed on the line of
      // flight — a man must actually be on the line to pick it, not a 15-man
      // sweep of the corridor
      let bestD: Player | null = null; let bestDist = Infinity;
      for (const d2 of this.team(this.other(p.side)).players) {
        if (d2.down > 0) continue;
        const t = clamp(((d2.x - p.x) * dx + (d2.y - p.y) * dy) / (dd * dd), 0, 1);
        const ix = p.x + dx * t, iy = p.y + dy * t;
        const dd2 = dist(d2.x, d2.y, ix, iy);
        if (dd2 < bestDist) { bestDist = dd2; bestD = d2; }
      }
      if (bestD && bestDist < 0.9 && this.rng() < 0.05 + (bestD.att.skl / 100) * 0.07) {
        this.ball.owner = bestD.id; this.ball.last = bestD.id;
        this.ball.vx = 0; this.ball.vy = 0; this.ball.z = 0.9;
        this.pendingReceiver = null;
        this.possession = bestD.side;
        this.say(`INTERCEPTION — ${bestD.name}!`, bestD.side);
        this.count('interception');
        return;
      }
    }
  }

  private doKick(p: Player, kind: 'PUNT' | 'GRUBBER' | 'DROP') {
    if (this.ball.owner !== p.id) return;
    if (kind !== 'DROP') this.dropAttempt = null;
    const kik = p.att.kik / 100;
    const ad = this.ad(p.side);
    let s = 0, vz = 0, isDrop = kind === 'DROP';
    if (kind === 'PUNT') { s = 15 + kik * 9; vz = 11.5; }
    else if (kind === 'GRUBBER') { s = 9 + kik * 5; vz = 2.2; }
    else { s = 15 + kik * 8; vz = 10; }
    // aim: straight upfield, with the drop goal aimed at the posts
    let ax = ad, ay = 0;
    if (isDrop) {
      const gx = ad * TRY_X, gy = 0;
      const err = (this.rng() - 0.5) * (1 - kik) * 0.5; // worse kicker → wider error
      const a = Math.atan2(gy - p.y, gx - p.x) + err;
      ax = Math.cos(a); ay = Math.sin(a);
    }
    this.ball.vx = ax * s; this.ball.vy = ay * s; this.ball.vz = vz;
    this.ball.owner = null; this.ball.last = p.id;
    this.ball.x = p.x + ax * 0.4; this.ball.y = p.y + ay * 0.4; this.ball.z = 0.3;
    this.ball.flight = isDrop ? 3 : (kind === 'PUNT' ? 3.2 : 1.6);
    this.ball.forwardTouch = false;
    this.ball.spin = kind === 'GRUBBER' ? 30 : 6;
    this.count(kind === 'DROP' ? 'dropGoalAttempt' : kind === 'GRUBBER' ? 'grubber' : 'punt');
    if (isDrop) {
      this.dropAttempt = p.side;
      this.say('Drop-goal attempt!', p.side);
    }
  }

  private tryTackle(d: Player, c: Player | undefined) {
    if (!c || c.down > 0 || this.ball.owner !== c.id) return;
    if (dist(d.x, d.y, c.x, c.y) > 1.6) return;
    this.count('tackleAttempt');
    // onside check: defender must be behind the ball line for the attacking dir
    const ad = this.ad(c.side);
    if (d.x * ad > this.ball.x * ad + 1.0 && this.adv === null) {
      this.say('OFFSIDE — penalty', c.side);
      this.count('offsidePenalty');
      this.awardPenalty(c.side, d.x, d.y);
      return;
    }
    const fend = (this.human === c.side && this.ctrlId === c.id);
    const powerD = d.att.str + d.att.skl * 0.4 + Math.hypot(d.vx, d.vy) * 2;
    const powerC = c.att.str * 1.1 + c.att.skl * 0.5 + (fend ? 26 : 0);
    const tackleRoll = powerD / (powerD + powerC) * 1.05;
    if (this.rng() < tackleRoll) {
      // tackle lands
      c.down = 1.1; c.vx *= 0.3; c.vy *= 0.3;
      this.pendingReceiver = null;
      this.count('tackle');
      this.say(`${d.name} brings down ${c.name}`, d.side);
      // offload before the ground (skill + support)
      const support = this.team(c.side).players.find((q) => q !== c && q.down <= 0 && dist(q.x, q.y, c.x, c.y) < 3.2);
      if (support && this.rng() < 0.2 + (c.att.skl / 100) * 0.22) {
        this.ball.owner = support.id; this.ball.last = support.id;
        this.ball.z = 0.9; this.ball.vx = 0; this.ball.vy = 0; this.ball.forwardTouch = false;
        this.say(`Offload! ${c.name} to ${support.name}`, c.side);
        this.count('offload');
        return;
      }
      // otherwise the ball is presented at the tackle: a ruck if support is
      // there, a genuine turnover chance if not. Only a rare knock-on in the
      // contact is whistled — clean recycling beats a loose-ball scramble.
      this.ball.owner = null; this.ball.last = c.id;
      this.ball.x = c.x; this.ball.y = c.y; this.ball.z = 0.2;
      this.ball.vx = 0; this.ball.vy = 0;
      if (this.rng() < 0.1) {
        this.ball.forwardTouch = true;
        this.whistleKnockOn();
        return;
      }
      this.ball.forwardTouch = false;
      const sup = this.team(c.side).players.filter((q) => q !== c && q.down <= 0 && q.bind < 0 && dist(q.x, q.y, c.x, c.y) < 2.0);
      if (sup.length >= 1) this.beginRuck();
      else this.say('Isolated — turnover chance', this.other(c.side));
    } else {
      // missed: either the defender clings (held up) or is BEATEN outright —
      // a beaten defender is the engine's line break
      const beat = 0.34 + (c.att.skl - d.att.skl) * 0.003 + (c.att.spd - d.att.spd) * 0.002 + (c.sprinting ? 0.12 : 0);
      if (this.rng() < clamp(beat, 0.08, 0.72)) {
        d.down = 0.7; d.vx *= 0.5; d.vy *= 0.5;
        c.burst = 1.3;              // the break: a sudden, lasting injection of pace
        this.defenseShock = 1.1;    // the cover defence is caught flat-footed
        this.say(`${c.name} beats ${d.name}!`, c.side);
        this.count('lineBreak');
      } else {
        c.held = 0.8;
        d.vx *= 0.4; d.vy *= 0.4;
        this.count('holdUp');
      }
    }
  }

  private tryScoop(p: Player) {
    if (this.ball.owner != null || this.ball.z > 0.3 || this.ball.flight > 0) return;
    if (dist(p.x, p.y, this.ball.x, this.ball.y) < 0.9) {
      this.ball.owner = p.id; this.ball.last = p.id;
      this.ball.z = 0.9; this.ball.vx = 0; this.ball.vy = 0; this.ball.forwardTouch = false;
      this.possession = p.side;
      this.say(`${p.name} picks up and goes`, p.side);
      this.count('scoop');
    }
  }

  /* ---------------- laws: lines & transitions ---------------- */

  private checkLinesAndLaws() {
    const b = this.ball;
    const c = this.carrier();

    // carried into touch or over the dead-ball line
    if (c) {
      if (Math.abs(c.y) > TOUCH_Y) {
        this.say('Into touch — lineout', this.other(c.side));
        this.count('touch');
        this.beginLineout(this.other(c.side), c.x, Math.sign(c.y) * TOUCH_Y);
        return;
      }
      const overLine = c.x * this.ad(c.side) > TRY_X;
      if (overLine) { this.awardTry(c.side, c.x, c.y); return; }
    } else {
      // loose ball over touch or dead
      if (Math.abs(b.y) > TOUCH_Y) {
        const kickerSide = b.last != null ? (this.player(b.last)?.side ?? 'A') : 'A';
        const to = this.other(kickerSide as Side);
        const x = clamp(b.x, -TRY_X, TRY_X);
        this.say('Ball into touch — lineout', to);
        this.count('touch');
        this.beginLineout(to, x, Math.sign(b.y) * TOUCH_Y);
        return;
      }
      if (Math.abs(b.x) > DEAD_X) {
        const side = b.x > 0 ? 'B' : 'A'; // the team defending that goal
        this.say('Dead ball — 22 dropout', side);
        this.count('deadBall');
        this.beginDropout(side);
        return;
      }
      if (Math.abs(b.x) > TRY_X) {
        // loose ball in-goal: attacked-over → 5m scrum to attackers unless grounded
        const atk = b.last != null ? (this.player(b.last)?.side ?? 'A') : 'A';
        this.beginScrum(atk as Side, clamp(b.x, -45, 45), clamp(b.y, -TOUCH_Y, TOUCH_Y));
        return;
      }
    }

    // breakdown formation checks (open play only)
    if (this.phase === 'OPEN') this.checkBreakdown();
  }

  private checkBreakdown() {
    const c = this.carrier();
    if (!c) {
      // loose ball with bodies around → ruck
      const around: Player[] = [];
      for (const p of this.all) {
        if (p.down > 0 || p.bind >= 0 || p.sinbin > 0) continue;
        if (dist(p.x, p.y, this.ball.x, this.ball.y) < 1.4) around.push(p);
      }
      const atk = around.filter((p) => p.side === (this.possession ?? 'A'));
      const def = around.filter((p) => p.side !== (this.possession ?? 'A'));
      if (atk.length >= 1 && def.length >= 1 && this.ball.z < 0.3) {
        this.beginRuck();
      }
      return;
    }
    // carrier held by ≥2 defenders and ≥1 attacker in support → maul
    const defNear = this.team(this.other(c.side)).players.filter((p) => p.down <= 0 && p.bind < 0 && dist(p.x, p.y, c.x, c.y) < 1.3);
    const supNear = this.team(c.side).players.filter((p) => p !== c && p.down <= 0 && p.bind < 0 && dist(p.x, p.y, c.x, c.y) < 1.6);
    if (c.held > 0 && defNear.length >= 2 && supNear.length >= 1) {
      this.beginMaul(c.side);
    }
  }

  /* ---------------- breakdowns: ruck & maul ---------------- */

  private beginRuck() {
    this.phase = 'RUCK'; this.phaseT = 0;
    this.ruck = { x: this.ball.x, y: this.ball.y, t: 0, attackers: [], defenders: [], winner: null };
    const atk = this.possession ?? 'A';
    for (const p of this.all) {
      if (p.down > 0 || p.sinbin > 0) continue;
      const d = dist(p.x, p.y, this.ruck.x, this.ruck.y);
      if (d < 1.6 && p.bind < 0) {
        const arr = p.side === atk ? this.ruck.attackers : this.ruck.defenders;
        if (arr.length < 3) { arr.push(p.id); p.bind = 1; }
      }
    }
    this.ball.owner = null; this.ball.vx = 0; this.ball.vy = 0; this.ball.z = 0.15;
    this.say('RUCK — contest for the ball');
    this.count('ruck');
  }

  private stepRuck(dt: number) {
    const r = this.ruck!;
    r.t += dt;
    const atk = this.possession ?? 'A';
    const ad = this.ad(atk);
    // players outside the bound group retreat behind the hindmost foot
    for (const p of this.all) {
      if (p.bind >= 0 || p.down > 0) continue;
      const offsideX = (r.x - ad * 0.6);
      const want = planStaticRuck(p, atk, r.x, r.y, ad);
      this.steer(p, want.x, want.y, 0.8, dt);
      if (p.side !== atk && p.x * ad > offsideX * ad + 0.2 && dist(p.x, p.y, r.x, r.y) < 6) {
        // retreat behind the line
        this.steer(p, offsideX, p.y, 1, dt);
      }
      p.sprinting = false;
    }
    this.integrate(dt);
    this.separate();

    // contest resolution: shove accumulates, winner at settle time
    if (r.t > 1.6 && !r.winner) {
      const pow = (side: Side) => {
        let s = 0;
        const arr = side === atk ? r.attackers : r.defenders;
        for (const id of arr) { const p = this.player(id); if (p) s += p.att.str + p.att.skl * 0.3; }
        return s;
      };
      const a = pow(atk) + (this.rng() < 0.5 ? 8 : 0);
      const b = pow(this.other(atk)) + (this.rng() < 0.5 ? 8 : 0);
      r.winner = a >= b ? atk : this.other(atk);
      if (r.winner !== atk) {
        this.say('TURNOVER — jackal wins it!', r.winner);
        this.count('turnover');
      } else {
        this.say('Ruck secured', atk);
      }
      this.possession = r.winner;
    }
    if (r.t > 2.4) {
      const winner = r.winner ?? atk;
      for (const id of [...r.attackers, ...r.defenders]) { const p = this.player(id); if (p) p.bind = -1; }
      this.ruck = null;
      this.startOpen(winner, 9);
    }
  }

  private beginMaul(side: Side) {
    this.phase = 'MAUL'; this.phaseT = 0;
    const c = this.carrier();
    this.maul = { x: c?.x ?? this.ball.x, y: c?.y ?? this.ball.y, side, t: 0, stall: 0, bound: [] };
    for (const p of this.all) {
      if (p.down > 0 || p.sinbin > 0) continue;
      if (dist(p.x, p.y, this.maul.x, this.maul.y) < 1.7 && p.bind < 0) {
        this.maul.bound.push(p.id); p.bind = 1;
        if (this.maul.bound.length >= 8) break;
      }
    }
    this.say('MAUL — drive it forward', side);
    this.count('maul');
  }

  private stepMaul(dt: number) {
    const m = this.maul!;
    m.t += dt;
    const ad = this.ad(m.side);
    // bound players: anchor and shove the maul forward at the ball's speed
    let powA = 0, powD = 0;
    for (const id of m.bound) {
      const p = this.player(id);
      if (!p) continue;
      p.bind = 1;
      const aheadX = m.x + ad * (p.side === m.side ? 0.5 : -0.5);
      this.steer(p, aheadX, m.y + (p.y - m.y) * 0.4, 0.7, dt);
      if (p.side === m.side) powA += p.att.str; else powD += p.att.str;
    }
    // free players position for the drive or the exit
    for (const p of this.all) {
      if (p.bind >= 0 || p.down > 0) continue;
      const w = planStaticMaul(p, m.side, m.x, m.y, ad);
      this.steer(p, w.x, w.y, 0.8, dt);
    }
    this.integrate(dt);

    // the maul has an attacking bias (the side with the ball commits more) and
    // gathers a head of steam near the line — this is how mauls score
    let drive = (powA * 1.12 - powD) / 2300;
    const toLine = TRY_X - m.x * ad;
    if (toLine < 8 && toLine > 0) drive += 0.55; // the pack smells the line
    m.x += drive * dt;
    m.stall = Math.abs(drive) < 0.12 ? m.stall + dt : 0;
    this.ball.x = m.x; this.ball.y = m.y; this.ball.z = 1.0;

    if (m.x * ad > TRY_X) { this.awardTry(m.side, m.x, m.y); return; }
    if (m.stall > 2.5 || m.t > 6) {
      // use it or lose it
      for (const id of m.bound) { const p = this.player(id); if (p) p.bind = -1; }
      this.maul = null;
      this.startOpen(m.side, 9);
      this.say('Ball out of the maul', m.side);
    }
  }

  /* ---------------- set pieces: scrum & lineout ---------------- */

  private beginScrum(feed: Side, x: number, y: number) {
    this.phase = 'SCRUM'; this.phaseT = 0;
    this.scrum = { x: clamp(x, -40, 40), y: clamp(y, -26, 26), feed, t: 0, stage: 'FORM', winner: null };
    this.possession = feed;
    this.ball.owner = null; this.ball.x = this.scrum.x; this.ball.y = this.scrum.y; this.ball.z = 0.2;
    this.say(`SCRUM — ${this.team(feed).short} to feed`, feed);
    this.count('scrum');
  }

  private stepScrum(dt: number) {
    const s = this.scrum!;
    s.t += dt;
    // place every player into their scrum slot
    for (const p of this.all) {
      if (p.sinbin > 0 || p.down > 0) { this.steer(p, p.x, p.y, 0, dt); continue; }
      const slot = scrumSlot(p.side, p.num, s.feed, s.x, s.y);
      p.bind = 1;
      this.steer(p, slot.x, slot.y, 0.9, dt);
      if (p.num === 9 && p.side !== s.feed) p.bind = -1; // the defending 9 hovers
    }
    this.integrate(dt);
    this.separate();

    if (s.stage === 'FORM' && s.t > 1.4) { s.stage = 'FEED'; this.say('Crouch… bind… SET'); }
    else if (s.stage === 'FEED' && s.t > 2.2) {
      // feed and hook: feed side heavily favoured but contestable
      const feedPow = this.team(s.feed).players.filter((p) => p.num <= 8).reduce((a, p) => a + p.att.str, 0);
      const oppPow = this.team(this.other(s.feed)).players.filter((p) => p.num <= 8).reduce((a, p) => a + p.att.str, 0);
      const roll = feedPow / (feedPow + oppPow) * 0.85 + this.rng() * 0.3;
      s.winner = roll >= 0.5 ? s.feed : this.other(s.feed);
      s.stage = 'PLAY';
      if (s.winner !== s.feed) { this.say('Against the head!', s.winner); this.count('scrumSteal'); }
    } else if (s.stage === 'PLAY' && s.t > 3.0) {
      const win = s.winner ?? s.feed;
      for (const p of this.all) p.bind = -1;
      this.scrum = null;
      this.startOpen(win, 9);
    }
  }

  private beginLineout(thrower: Side, x: number, y: number) {
    this.phase = 'LINEOUT'; this.phaseT = 0;
    this.lineout = { x: clamp(x, -46, 46), y: y >= 0 ? TOUCH_Y : -TOUCH_Y, thrower, t: 0, stage: 'FORM', winner: null };
    this.possession = thrower;
    this.ball.owner = null; this.ball.x = this.lineout.x; this.ball.y = this.lineout.y; this.ball.z = 0.2;
    this.say(`LINEOUT — ${this.team(thrower).short} to throw`, thrower);
    this.count('lineout');
  }

  private stepLineout(dt: number) {
    const lo = this.lineout!;
    lo.t += dt;
    for (const p of this.all) {
      if (p.sinbin > 0 || p.down > 0) { this.steer(p, p.x, p.y, 0, dt); continue; }
      const slot = lineoutSlot(p.side, p.num, lo.thrower, lo.x, lo.y);
      p.bind = 1;
      if (p.num === 2 && p.side === lo.thrower) p.bind = -1; // the thrower stands out
      this.steer(p, slot.x, slot.y, 0.9, dt);
    }
    this.integrate(dt);
    this.separate();

    if (lo.stage === 'FORM' && lo.t > 1.3) { lo.stage = 'THROW'; this.say('Throw in… up and over'); }
    else if (lo.stage === 'THROW' && lo.t > 2.1) {
      // jumper contest
      const jumpA = this.team(lo.thrower).players.filter((p) => p.num === 4 || p.num === 5).reduce((a, p) => a + p.att.skl, 0);
      const jumpB = this.team(this.other(lo.thrower)).players.filter((p) => p.num === 4 || p.num === 5).reduce((a, p) => a + p.att.skl, 0);
      const roll = (jumpA + this.rng() * 40) / (jumpA + jumpB + 20);
      lo.winner = roll >= 0.5 ? lo.thrower : this.other(lo.thrower);
      lo.stage = 'PLAY';
      if (lo.winner !== lo.thrower) { this.say('Stolen at the lineout!', lo.winner); this.count('lineoutSteal'); }
    } else if (lo.stage === 'PLAY' && lo.t > 2.9) {
      const win = lo.winner ?? lo.thrower;
      for (const p of this.all) p.bind = -1;
      this.lineout = null;
      this.startOpen(win, 9);
    }
  }

  /* ---------------- kicks & restarts ---------------- */

  private beginKickoff(side: Side) {
    this.phase = 'KICKOFF'; this.phaseT = 0;
    this.possession = side;
    this.prevKickHeld = false;
    this.ball.flight = 0;
    this.kick = { kind: 'KICKOFF', side, x: 0, y: 0, t: 0, aim: 0, power: 0, kicked: false, tryX: 0 };
    this.ball.owner = null; this.ball.x = 0; this.ball.y = 0; this.ball.z = 0.2;
    this.say(`KICK-OFF — ${this.team(side).name} to start`, side);
  }

  private beginDropout(side: Side) {
    this.phase = 'DROP_KICK'; this.phaseT = 0;
    this.possession = side;
    this.kick = { kind: 'DROPOUT', side, x: side === 'A' ? -28 : 28, y: 0, t: 0, aim: 0, power: 0, kicked: false, tryX: 0 };
    this.ball.owner = null; this.ball.x = this.kick.x; this.ball.y = 0; this.ball.z = 0.2;
    this.say(`22 DROPOUT — ${this.team(side).short}`, side);
  }

  private awardPenalty(side: Side, x: number, y: number) {
    this.adv = null;
    const ad = this.ad(side);
    const goalDist = TRY_X - x * ad;
    const kicker = this.bestKicker(side);
    if (goalDist > 0 && goalDist < 45 && kicker.att.kik > 55) {
      this.beginPlaceKick(side, 'PENALTY', x, y);
      this.say('PENALTY — going for the posts', side);
    } else {
      // kick to touch for territory, or tap-and-go deep in attack
      if (x * ad > 30) { this.say('PENALTY — tap and go', side); this.startOpen(side, this.nearestBack(side, x, y)); }
      else { this.say('PENALTY — kick to touch', side); this.beginLineout(side, Math.min(TRY_X - 1, x + ad * 22), y >= 0 ? TOUCH_Y : -TOUCH_Y); }
    }
  }

  private beginPlaceKick(side: Side, kind: 'PENALTY' | 'CONVERSION', x: number, y: number) {
    this.phase = 'PLACE_KICK'; this.phaseT = 0;
    this.possession = side;
    this.kick = { kind, side, x, y, t: 0, aim: 0, power: 0, kicked: false, tryX: x };
    this.ball.owner = null; this.ball.x = x; this.ball.y = y; this.ball.z = 0.2;
  }

  private bestKicker(side: Side): Player {
    const team = this.team(side).players;
    return team.slice().sort((a, b) => b.att.kik - a.att.kik)[0];
  }

  private nearestBack(side: Side, x: number, y: number): number {
    const backs = this.team(side).players.filter((p) => p.num >= 9);
    if (!backs.length) return this.team(side).players[0].num;
    return backs.slice().sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0].num;
  }

  private stepKick(dt: number, held: InputState) {
    const k = this.kick!;
    k.t += dt;
    const ad = this.ad(k.side);
    const kicker = this.bestKicker(k.side);

    if (!k.kicked) {
      // position everyone except the kicker
      for (const p of this.all) {
        if (p === kicker || p.down > 0) continue;
        const w = planStaticKick(p, k.side, k, ad);
        this.steer(p, w.x, w.y, 0.8, dt);
      }
      // kicker walks to the mark
      this.steer(kicker, k.x, k.y, 0.7, dt);
      this.integrate(dt);
      this.separate();

      // aim + power: human aims with left/right and holds SPACE for power,
      // releasing fires the kick (edge detected internally)
      if (this.human === k.side) {
        if (held.left) k.aim = clamp(k.aim + 0.6 * dt, -0.24, 0.24);
        if (held.right) k.aim = clamp(k.aim - 0.6 * dt, -0.24, 0.24);
        if (held.context) k.power = clamp(k.power + 0.75 * dt, 0, 1);
        if (!held.context && this.prevKickHeld && k.power > 0.05 && k.t > 1.2) this.fireKick(k);
        else if (k.t > 6 && k.power < 0.05) { k.power = 0.8; this.fireKick(k); } // never stall forever
        this.prevKickHeld = held.context;
      } else if (k.t > 1.4) {
        k.aim = 0; k.power = 0.95;
        this.fireKick(k);
      }
      return;
    }

    // --- ball in flight: everyone converges, ball physics, then play on ---
    for (const p of this.all) {
      if (p.down > 0 || p === kicker) continue;
      this.steer(p, this.ball.x, this.ball.y, 1, dt);
    }
    this.integrate(dt);
    this.separate();
    if (this.ball.owner == null) {
      this.stepLooseBall(dt);
      this.checkLinesAndLaws();
    }
    if (this.ball.z <= 0.001 && this.ball.flight <= 0
      && (this.phase === 'KICKOFF' || this.phase === 'DROP_KICK' || this.phase === 'PLACE_KICK')) {
      // the kicked ball has come down and no other law intervened — play on
      this.phase = 'OPEN'; this.phaseT = 0;
      if (this.ball.owner != null) this.possession = this.player(this.ball.owner)!.side;
      else if (this.ball.last != null) this.possession = this.player(this.ball.last)?.side ?? k.side;
    }
  }

  private fireKick(k: KickState) {
    k.kicked = true;
    const kicker = this.bestKicker(k.side);
    const ad = this.ad(k.side);
    const gx = ad * TRY_X;
    let vx: number, vy: number, vz: number;
    if (k.kind === 'KICKOFF' || k.kind === 'DROPOUT') {
      // straight upfield, ~25–30 m, contestable in the air
      const s = k.kind === 'KICKOFF' ? 16.5 : 17;
      vx = ad * s; vy = 0; vz = 8.5;
    } else {
      let ang = Math.atan2(0 - k.y, gx - k.x) + k.aim * (k.kind === 'CONVERSION' ? 0.4 : 1);
      const d = Math.hypot(gx - k.x, 0 - k.y);
      if (k.kind === 'PENALTY' || k.kind === 'CONVERSION') {
        // accuracy: harder kicker, longer kick → more likely to pull it wide
        const acc = kicker.att.kik / 100;
        const make = acc - d * 0.006;
        if (this.rng() > make) {
          ang += (this.rng() < 0.5 ? -1 : 1) * (0.05 + this.rng() * 0.09);
        }
      }
      const speed = 15 + d * 0.42;
      vx = Math.cos(ang) * speed; vy = Math.sin(ang) * speed;
      vz = Math.max(6, 8 + d * 0.05);
    }
    this.ball.vx = vx; this.ball.vy = vy; this.ball.vz = vz;
    this.ball.owner = null; this.ball.last = kicker.id;
    this.ball.x = k.x; this.ball.y = k.y; this.ball.z = 0.2;
    this.ball.flight = 4;
    this.ball.forwardTouch = false;
    if (k.kind === 'PENALTY' || k.kind === 'CONVERSION') this.placeAttempt = { side: k.side, kind: k.kind };
    this.count(k.kind === 'CONVERSION' ? 'conversionAttempt' : k.kind === 'PENALTY' ? 'penaltyGoalAttempt' : k.kind === 'KICKOFF' ? 'kickoff' : 'dropout');
  }

  /* ---------------- scoring ---------------- */

  /** Resolve place kicks (penalty/conversion) and drop goals as they cross the
   * goal plane. Returns true if a transition happened (play restarted). */
  private adjudicateKicks(): boolean {
    const b = this.ball;
    const scoring: { side: Side; kind: 'PENALTY' | 'CONVERSION' | 'DROP' } | null =
      this.placeAttempt
        ? { side: this.placeAttempt.side, kind: this.placeAttempt.kind }
        : this.dropAttempt
          ? { side: this.dropAttempt, kind: 'DROP' }
          : null;
    if (!scoring) return false;
    const ad = this.ad(scoring.side);
    if (b.x * ad <= TRY_X) return false; // not there yet

    const betweenPosts = Math.abs(b.y) < 2.8;
    const overBar = b.z > 2.1;
    const good = betweenPosts && overBar;
    const team = this.team(scoring.side);
    if (good) {
      const pts = scoring.kind === 'PENALTY' ? POINTS.PENALTY : scoring.kind === 'DROP' ? POINTS.DROP_GOAL : POINTS.CONVERSION;
      team.score += pts;
      this.count(scoring.kind === 'DROP' ? 'dropGoal' : scoring.kind === 'PENALTY' ? 'penaltyGoal' : 'conversion');
      const label = scoring.kind === 'DROP' ? 'DROP GOAL' : scoring.kind === 'PENALTY' ? 'PENALTY GOAL' : 'CONVERSION';
      this.say(`${label}! ${team.name} ${team.score}–${this.team(this.other(scoring.side)).score}`, scoring.side);
    } else {
      this.say(scoring.kind === 'CONVERSION' ? 'Conversion missed' : 'Pushed wide', null);
      this.count(scoring.kind === 'DROP' ? 'dropGoalMiss' : scoring.kind === 'PENALTY' ? 'penaltyGoalMiss' : 'conversionMiss');
    }
    this.placeAttempt = null;
    this.dropAttempt = null;
    // after a score (or a missed conversion) play restarts with a kick-off to
    // the conceding side; a missed penalty/drop is live ball, handled by laws
    if (good || scoring.kind === 'CONVERSION') {
      this.beginKickoff(this.other(scoring.side));
      return true;
    }
    return false;
  }

  private awardTry(side: Side, x: number, y: number) {
    const team = this.team(side);
    team.score += POINTS.TRY;
    this.trySide = side;
    this.phase = 'TRY'; this.phaseT = 0;
    this.ball.owner = null; this.ball.x = x; this.ball.y = y; this.ball.z = 0.2;
    this.say(`TRY! ${team.name} — ${team.score}–${this.team(this.other(side)).score}`, side);
    this.count('try');
  }

  private stepTry(dt: number) {
    this.phaseT += dt;
    // celebrate: players drift away from the ball
    for (const p of this.all) {
      if (p.down > 0) continue;
      this.steer(p, p.x, p.y, 0, dt);
    }
    this.integrate(dt);
    if (this.phaseT > 2.2) {
      const side = this.trySide!;
      this.trySide = null;
      // conversion is taken on the 22, in line with where the ball was grounded
      const ad = this.ad(side);
      const markX = (TRY_X - 22) * ad;
      const markY = clamp(this.ball.y, -30, 30);
      this.beginPlaceKick(side, 'CONVERSION', markX, markY);
    }
  }

  private stepDead(dt: number) {
    // DEAD is a short whistle pause; normally transitions happen immediately,
    // so reaching here means we should just resume open play.
    this.phaseT += dt;
    if (this.phaseT > 0.4) {
      this.phase = 'OPEN';
      this.phaseT = 0;
    }
  }

  /* ---------------- transitions ---------------- */

  private startOpen(side: Side, num: number) {
    this.phase = 'OPEN'; this.phaseT = 0;
    this.possession = side;
    this.releaseGrace = 0.9; // defenders must get onside before pressuring
    const p = this.team(side).players.find((q) => q.num === num && q.sinbin <= 0 && q.down <= 0)
      ?? this.nearestPlayer(side, this.ball.x, this.ball.y);
    if (p) {
      this.ball.owner = p.id; this.ball.last = p.id;
      this.ball.x = p.x; this.ball.y = p.y; this.ball.z = 0.9;
      this.ball.vx = 0; this.ball.vy = 0; this.ball.forwardTouch = false;
      this.pendingReceiver = null;
      if (this.human === side) this.ctrlId = p.id;
    }
  }

  private nearestPlayer(side: Side, x: number, y: number): Player {
    const team = this.team(side).players.filter((p) => p.sinbin <= 0 && p.down <= 0);
    if (!team.length) return this.team(side).players[0];
    return team.slice().sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))[0];
  }

  /* ---------------- misc for AI / render ---------------- */

  /** the direction a side attacks: +1 for A, -1 for B */
  attackDir(side: Side): number { return this.ad(side); }

  onsideX(side: Side): number {
    // hindmost-foot line for the defending side
    const atk = this.other(side);
    const ad = this.ad(atk);
    const anchor = this.ruck ? this.ruck.x : this.scrum ? this.scrum.x : this.maul ? this.maul.x : this.ball.x;
    return anchor - ad * 0.6;
  }
}

/* ============================================================================
 * STATIC formation / positioning helpers (pure — no sim access)
 * ==========================================================================*/

function planStaticRuck(p: Player, atk: Side, x: number, y: number, ad: number) {
  // attacking 9 stands at the base; other attackers fan out; defenders spread onside
  if (p.side === atk) {
    if (p.num === 9) return { x: x - ad * 1.6, y, speed: 0.9, sprint: false };
    if (p.num === 10) return { x: x - ad * 6, y: y - 2, speed: 0.9, sprint: false };
    if (p.num <= 8) return { x: x - ad * 2.4, y: y + (p.num % 2 === 0 ? 2 : -2), speed: 0.9, sprint: false };
    return { x: x - ad * 8, y: y + (p.num - 12) * 3, speed: 0.9, sprint: false };
  }
  return { x: x - ad * 3, y: y + (p.num - 8) * 1.4, speed: 0.9, sprint: false };
}

function planStaticMaul(p: Player, side: Side, x: number, y: number, ad: number) {
  if (p.side === side) {
    if (p.num === 9) return { x: x - ad * 1.2, y: y + 1.5, speed: 0.9, sprint: false };
    if (p.num === 10) return { x: x - ad * 6, y: y - 3, speed: 0.9, sprint: false };
    return { x: x - ad * 4, y: y + (p.num % 2 === 0 ? 3 : -3), speed: 0.9, sprint: false };
  }
  return { x: x + ad * 1.2, y: y + (p.num % 2 === 0 ? 1 : -1), speed: 0.9, sprint: false };
}

function planStaticKick(p: Player, side: Side, k: KickState, ad: number) {
  // receivers: spread deep; kicking side chases from behind the mark
  if (p.side !== side) {
    const depth = k.kind === 'KICKOFF' ? -ad * 12 : ad * 10;
    return { x: k.x - depth, y: clamp(p.y || (p.num - 8) * 4, -20, 20), speed: 0.9, sprint: false };
  }
  return { x: k.x - ad * (k.kind === 'KICKOFF' ? 2 : 6), y: (p.num - 8) * 3, speed: 0.9, sprint: false };
}

function scrumSlot(side: Side, num: number, feed: Side, x: number, y: number): { x: number; y: number } {
  const ad = attackDir(feed);
  // pack orientation: feed pack behind the ball, opponents in front (mirrored)
  const front = (side === feed ? -1 : 1) * ad;
  const base = { x: x + front * 0.6, y };
  switch (num) {
    case 1: return { x: base.x - ad * 0.2, y: y - 1.1 };
    case 2: return { x: base.x, y };
    case 3: return { x: base.x - ad * 0.2, y: y + 1.1 };
    case 4: return { x: base.x - ad * 1.2, y: y - 0.55 };
    case 5: return { x: base.x - ad * 1.2, y: y + 0.55 };
    case 8: return { x: base.x - ad * 2.3, y };
    case 6: return { x: base.x - ad * 2.0, y: y - 1.5 };
    case 7: return { x: base.x - ad * 2.0, y: y + 1.5 };
    case 9: return { x: base.x - ad * 4.0, y: side === feed ? y - 1.2 : y + 1.2 };
    default: { // backs, 5m behind their own pack
      const dir = side === feed ? -1 : 1;
      const bx = x + ad * dir * 5.5 + (num - 10) * 0.4;
      const by = (num - 12) * 4.2;
      return { x: bx, y: by };
    }
  }
}

function lineoutSlot(side: Side, num: number, thrower: Side, x: number, y: number): { x: number; y: number } {
  const touchSign = y >= 0 ? 1 : -1;
  const inX = touchSign * -1; // inward from the touch line
  const onSide = side === thrower;
  if (num === 2) return { x: x - inX * 1.4, y: y - touchSign * 2, }; // thrower (throws, then joins)
  if (num === 4 || num === 5) return { x: x + inX * (onSide ? 1.6 : 1.0), y: y - touchSign * (num === 4 ? 0.4 : 1.2) };
  if (num === 1 || num === 3 || num === 6 || num === 7) {
    const lx = num === 6 ? -0.2 : 0.2;
    return { x: x + inX * (onSide ? 2.2 : 1.4), y: y - touchSign * (lx + (num <= 3 ? 0.4 : 1.2)) };
  }
  if (num === 9) return { x: x + inX * (onSide ? 3.2 : 2.2), y: y - touchSign * 1.4 };
  // backs: 10m back, offside line
  const bx = x - touchSign * (onSide ? 10 : 12);
  const by = (num - 12) * 4.5;
  return { x: bx, y: by };
}
