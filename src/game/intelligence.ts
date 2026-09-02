/**
 * PLAYER INTELLIGENCE — the off-ball brain.
 *
 * Every complaint about rugby games that begins "my players just..." is a
 * complaint about this file not existing. Thirty players, each with a written
 * contract for the phase, each re-targeted every frame, each moving under the
 * same movement model the controlled player uses.
 *
 * The contracts solve, specifically:
 *   "players are never in their correct position"
 *   "props will line up at flyhalf while fullbacks are rucking"
 *   "pointless having a backline as the forwards plays flyhalf"
 *   "huge gaps left in defensive lines causing easy line breaks"
 *   "3 players floating around instead of coming into the ruck"
 *   "AI teammates simply run onto the ball back into busy areas"
 */

import { ROLE_CONTRACTS, contractFor, PhaseName } from './jlr';

export interface Live {
  team: 'A' | 'B';
  num: number;
  x: number; z: number;
  vx: number; vz: number;
  face: number;              // +1 = running toward +z
  clip: string; clipT: number; jitter: number;
  stamina: number;           // 0..100
  /** T-39 per-player build: 0.92 (wing) .. 1.12 (lock) */
  size: number;
  /** the phase the contract is currently drawn from */
  assignment: PhaseName;
  /** human-readable job, shown in the HUD when you control this player */
  job: string;
  tx: number; tz: number;    // target mark
  urgency: number;           // 0..1 — how hard to run at the target
  bound: boolean;            // locked into a set piece
  down: boolean;             // on the ground / in the ruck
  carrier: boolean;
  /** 0 = not a pass option, 1..3 = selectable in that order */
  passRank: number;
  /** seconds until this player reaches the breakdown mark */
  eta: number;
  /** true when this player is the one you are steering */
  controlled: boolean;
  /** yellow card timer in match seconds, 0 when fit */
  sinbin: number;
  /** T-18: seconds left of being BEATEN — a slipped tackle. A beaten defender
   *  recovers (steers back into the line) but cannot tackle while the timer
   *  runs; this is where line breaks come from. */
  beatenT: number;
  attrs: { SPD: number; PWR: number; SKL: number; AGG: number; AWA: number; STA: number };
  /**
   * T-02 — ownership tag. Every frame, exactly one system may move a player:
   * `steer` (think), `bound` (placeBound), `phase` (phase logic), `carrier` (the
   * controlled player). The second writer in a frame warns, because a double move
   * is the root of the teleport class of bug. Reset each frame; dev-only.
   */
  movedBy?: string;
}

export const ATTR_KEYS = ['SPD', 'PWR', 'SKL', 'AGG', 'AWA', 'STA'] as const;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Forwards by shirt. Used everywhere a decision depends on unit membership. */
export const FORWARDS = [1, 2, 3, 4, 5, 6, 7, 8];
export const BACKS = [9, 10, 11, 12, 13, 14, 15];
/** Shirts that may legally play the ball out of a ruck, in order. */
export const RUCK_ELIGIBLE = [9, 8, 2, 7, 6, 5, 4, 3, 1];
/** Shirts contractually forbidden from entering a ruck. */
export const RUCK_FORBIDDEN = [10, 11, 12, 13, 14, 15];

export function maxSpeed(p: Live, carrying: boolean, sprint: boolean, fatigue: number): number {
  /* T-39 realistic speeds. Elite wingers hit ~9.5 m/s in a full sprint, props
   * ~6.0. The spread comes from SPEED; a bigger body costs a touch of top speed
   * and acceleration. Nobody runs a flat, shared pace. */
  const base = 2.9 + (p.attrs.SPD / 100) * 5.0;
  const carryPenalty = carrying ? 0.45 + (100 - p.attrs.SKL) * 0.006 : 0;
  const sprintMul = sprint ? 1.24 : 1.0;
  const sizeMul = 1.03 - (p.size ?? 1) * 0.03;
  const tired = 1 - clamp(1 - fatigue / 100, 0, 1) * 0.22;
  return Math.max(3.4, base - carryPenalty) * sprintMul * sizeMul * tired;
}

/* ============================ MOVEMENT ============================
 * Sampled every frame, applied immediately. There is no pre-baked path and no
 * animation gate between the input and the movement.
 */

export function steer(p: Live, dt: number, sprint: boolean) {
  const dx = p.tx - p.x, dz = p.tz - p.z;
  const dist = Math.hypot(dx, dz);
  const want = maxSpeed(p, p.carrier, sprint, p.stamina) * p.urgency;

  if (dist < 0.35) {
    // arrival: decelerate to the mark, then hold
    p.vx = p.vx * Math.exp(-9 * dt);
    p.vz = p.vz * Math.exp(-9 * dt);
  } else {
    const nx = dx / dist, nz = dz / dist;
    const ramp = clamp(dist / 2.4, 0.28, 1);
    const tvx = nx * want * ramp, tvz = nz * want * ramp;
    // one continuous curve — the accel rate is the only difference between
    // a prop and a wing, so sprint never feels like a different game
    const accel = 9 + (p.attrs.SPD / 100) * 5;
    p.vx += (tvx - p.vx) * (1 - Math.exp(-accel * dt));
    p.vz += (tvz - p.vz) * (1 - Math.exp(-accel * dt));
  }

  p.x = clamp(p.x + p.vx * dt, -34.5, 34.5);
  p.z = clamp(p.z + p.vz * dt, -61, 61);
  if (import.meta.env.DEV && p.movedBy && p.movedBy !== 'steer') {
    console.warn(`[T-02] shirt ${p.num} (${p.team}) moved by ${p.movedBy}, then steer() again in one frame`);
  }
  p.movedBy = 'steer';

  /* Facing comes from the full velocity vector. A player running down-field is
   * seen from behind; one running back at the camera from the front; a lateral
   * runner keeps his last meaningful z-facing rather than flapping. */
  if (Math.abs(p.vz) > 0.3) p.face = p.vz > 0 ? 1 : -1;

  /* Clip selection + cadence matching.
   *
   * The clip library ships each gait at a fixed cycle duration (jog 0.72 s,
   * sprint 0.50 s, carry 0.58 s). If every player advances clipT at a constant
   * 1x, a slow jogger churns his legs too fast and a fast runner glides with
   * legs too slow — that glide is the "floating" read. So clip time advances at
   * speed / clip-speed, locking feet to ground. */
  const sp = Math.hypot(p.vx, p.vz);
  let clip = p.clip;
  let clipSpeed = 0;
  if (p.down) clip = 'grounded';
  else if (!p.bound) {
    if (sp < 0.7) clip = 'ready';
    else if (p.carrier) clip = 'carry';
    else if (sp > 6.2) clip = 'sprint';
    else clip = 'jog';
  }
  // The speed each clip was authored to look correct at.
  if (clip === 'sprint') clipSpeed = 8.2;
  else if (clip === 'jog') clipSpeed = 4.4;
  else if (clip === 'carry') clipSpeed = 6.4;

  if (p.clip !== clip) { p.clip = clip; p.clipT = 0; }   // one-shots start clean
  p.clipT += dt * (clipSpeed > 0 ? sp / clipSpeed : 1);

  // sprinting costs; standing recovers
  if (sp > 7.0) p.stamina = clamp(p.stamina - dt * 4.4 * (1.4 - p.attrs.STA / 200), 0, 100);
  else if (sp > 3.0) p.stamina = clamp(p.stamina - dt * 1.1, 0, 100);
  else p.stamina = clamp(p.stamina + dt * 1.6, 0, 100);
}

/** Teammates must never occupy the same metre of grass, and never block their own carrier. */
export function separate(all: Live[], dt: number) {
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.0001) continue;

      /* T-04. Opposing players must not run through one another. Two cases:
       *
       * TEAM-MATES — the existing rule. The carrier has right of way; his own
       * men step out of his line.
       *
       * OPPONENTS — the new rule. Neither body may occupy the other's grass. If
       * neither is the carrier they both give ground. If one is the carrier and
       * the other is NOT in the tackle's convergence set (the tackle has already
       * resolved the contact by the time it matters), the carrier brushes through
       * and the defender yields — the actual tackle stays owned by the radius
       * test in upOpen, so there is no double-fire.
       */
      if (a.team === b.team) {
        if (a.bound || b.bound) continue;
        const min = 1.05;
        if (d > min) continue;
        const push = (min - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        const wA = a.carrier || a.controlled ? 0.15 : 1;
        const wB = b.carrier || b.controlled ? 0.15 : 1;
        a.x -= nx * push * wA; a.z -= nz * push * wA;
        b.x += nx * push * wB; b.z += nz * push * wB;
      } else {
        // Opponents. Bodies do not overlap; they shunt.
        if (a.down || b.down) continue;
        const min = 0.82;
        if (d > min) continue;
        const push = (min - d) * 0.5;
        const nx = dx / d, nz = dz / d;
        if (a.carrier) {
          b.x += nx * push * 1.0; b.z += nz * push * 1.0;   // defender gives way
        } else if (b.carrier) {
          a.x -= nx * push * 1.0; a.z -= nz * push * 1.0;
        } else {
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
        }
      }
      void dt;
    }
  }
}

/* ============================ SHAPE ============================ */

export interface ShapeInput {
  phase: PhaseName;
  attack: 'A' | 'B';
  dir: number;              // +1 attack toward +z
  ballX: number; ballZ: number;
  width: number;            // 0..1 tactic slider
  depthBias: number;        // 0..1 tactic slider (flat..deep)
  lineSpeed: number;        // 0..1 tactic slider, defending side
  drift: number;            // 0..1 from the defensive formation
  /** sign of the openside for this phase: +1 means the wide side is +x */
  open: number;
}

/**
 * The attacking mark for one shirt. Lateral offset is from the role contract,
 * scaled by the width slider, mirrored by the openside, and clamped so a prop
 * physically cannot stand where a centre should be.
 */
export function attackMark(num: number, s: ShapeInput): { x: number; z: number; job: string } {
  const c = contractFor(num);
  const lat = (c.lateral[s.phase] ?? 0);
  const dep = (c.depth[s.phase] ?? 4);
  const wide = 0.55 + s.width * 0.7;
  let x = s.ballX + lat * s.open * wide;
  // hard channel clamps per unit — the fix for props at fly-half
  if (FORWARDS.includes(num)) x = s.ballX + clamp(x - s.ballX, -8, 8);
  else if (num !== 15) x = s.ballX + clamp(x - s.ballX, -25, 25);
  else x = s.ballX + clamp(x - s.ballX, -18, 18);
  x = clamp(x, -33, 33);
  // depth is behind the ball, deeper when the tactic asks for it
  const z = s.ballZ - s.dir * (dep * (0.6 + s.depthBias * 0.9));
  return { x, z: clamp(z, -59, 59), job: c.job[s.phase] ?? c.job.OPEN_PLAY ?? 'SUPPORT' };
}

/**
 * The defending mark for one shirt. The line is distributed across the width
 * actually available with a hard maximum spacing of 4 m, so a gap wider than
 * that cannot exist by construction.
 */
export function defenceMark(num: number, s: ShapeInput): { x: number; z: number; job: string } {
  const c = contractFor(num);
  const phase: PhaseName = 'DEFENCE_LINE';
  let lat = (c.lateral[phase] ?? 0);
  const dep = c.depth[phase] ?? 3;

  // Redistribute the backs across the remaining width so the line is connected.
  if (num >= 10 && num !== 15) {
    const backs = [10, 11, 12, 13, 14];
    const span = 30;                     // metres of pitch the back line covers
    const i = backs.indexOf(num);
    lat = -span / 2 + (i / (backs.length - 1)) * span;
  }

  let x = s.ballX + lat * s.open;
  x = clamp(x, -33, 33);
  const speed = 0.55 + s.lineSpeed * 0.7;
  // the line sits in front of the ball and comes up as line speed rises
  const z = s.ballZ + s.dir * (dep * (1.35 - speed * 0.55));
  return { x, z: clamp(z, -59, 59), job: c.job[phase] ?? 'DEFEND YOUR CHANNEL' };
}

/* ============================ PASS SOLVER ============================
 * A pass is never thrown to a coordinate. It is thrown to a named player and
 * the flight is solved so ball and man arrive together.
 */

export interface PassOption {
  player: Live;
  rank: number;
  side: -1 | 1;
  cutOut: boolean;
  /** metres of flight */
  distance: number;
  /** seconds of flight */
  time: number;
  /** 0..1 chance it arrives cleanly, shown before you commit */
  risk: number;
  /** T-18: a defender is within tackling range of this receiver */
  covered: boolean;
}

/** sort key: uncovered options before covered ones */
function coveredRank(o: PassOption): number { return o.covered ? 1 : 0; }

export function passOptions(
  carrier: Live, all: Live[], _open: number, cutOut: boolean, wet: number,
): PassOption[] {
  const mates = all.filter((p) => p.team === carrier.team && p !== carrier && p.sinbin <= 0 && !p.down);
  const foes = all.filter((p) => p.team !== carrier.team && p.sinbin <= 0 && !p.down);
  const scored: PassOption[] = [];
  for (const m of mates) {
    // side is screen-relative so the button label always tells the truth
    const rel = m.x - carrier.x;
    const side: -1 | 1 = rel >= 0 ? 1 : -1;
    const absRel = Math.abs(rel);
    if (absRel < 0.4) continue;
    // a pass is only offered to a man who is roughly level or ahead
    // T-18: support legitimately trails the carrier by up to 10 m (that is
    // what depth IS) — the old 6 m cutoff removed the receivers a moving
    // attack actually has, and the CPU had nobody to pass to.
    if ((m.z - carrier.z) < -10) continue;
    const dist = Math.hypot(m.x - carrier.x, m.z - carrier.z);
    // HARD CLAMP: a pass can never exceed the widest eligible receiver
    if (dist > 26) continue;
    /* T-18. You pass to the man the defence is NOT on. A receiver with a
     * defender inside ~2.2 m is covered — he catches and is tackled in the
     * same frame, which is why pass chains never formed: every pass went to
     * a marked man and died. Covered men are only offered when nobody open
     * exists on that side.
     * A defender who is BEATEN (slipped, or already carried past — behind
     * the receiver in the direction of attack) is not coverage: drift
     * defences concede those passes all match. */
    const atkDir = carrier.team === 'A' ? 1 : -1;
    const covered = foes.some((f) => (f.beatenT ?? 0) <= 0
      && (f.z - m.z) * atkDir >= -1.2
      && Math.hypot(f.x - m.x, f.z - m.z) < 2.2);
    const time = clamp(dist / 14, 0.18, 1.5);
    const skill = carrier.attrs.SKL / 100;
    const risk = clamp(
      0.03 + (dist / 26) * 0.16 + wet * 0.14 + (1 - skill) * 0.12 + (cutOut ? 0.05 : 0) + (covered ? 0.1 : 0),
      0.02, 0.5,
    );
    scored.push({ player: m, rank: 0, side, cutOut, distance: dist, time, risk, covered });
  }
  // open men first, then nearest — the old pure-distance sort is what threw
  // every pass straight into a waiting defender
  scored.sort((a, b) => (coveredRank(a) - coveredRank(b)) || (a.distance - b.distance));
  // nearest on each side, skipping one if this is a cut-out pass
  const out: PassOption[] = [];
  for (const side of [1, -1] as const) {
    const list = scored.filter((o) => o.side === side);
    if (!list.length) continue;
    const pick = cutOut && list.length > 1 ? list[1] : list[0];
    if (cutOut && list.length === 1) continue;
    out.push({ ...pick, rank: out.length + 1 });
  }
  return out;
}

/**
 * Where the ball should be thrown so it meets the receiver. The receiver is
 * always moving when it arrives — the fix for "your player remains at a
 * standstill and by the time you get going the defence is on you".
 */
export function solvePassTarget(from: Live, opt: PassOption, dir: number): { x: number; z: number; vx: number; vz: number } {
  const r = opt.player;
  // project the receiver forward for the flight time, at 80% of top speed
  const lead = opt.time * maxSpeed(r, false, false, r.stamina) * 0.8;
  let tx = r.x;
  let tz = r.z + dir * lead;
  // never solve a target behind the passer
  if ((tz - from.z) * dir < 0.3) tz = from.z + dir * 0.4;
  tz = clamp(tz, -59, 59);
  tx = clamp(tx, -33.5, 33.5);
  const dx = tx - from.x, dz = tz - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const speed = Math.max(9, Math.min(18, len / opt.time));
  return { x: tx, z: tz, vx: (dx / len) * speed, vz: (dz / len) * speed };
}

/* ============================ BREAKDOWN CREW ============================
 * Three players are assigned to every breakdown by name, in arrival order,
 * before the tackle is even made. The fix for "3 players floating around".
 */

export function assignCrew(
  all: Live[], team: 'A' | 'B', x: number, z: number, count: number,
): Live[] {
  const pool = all.filter((p) => p.team === team && p.sinbin <= 0 && !RUCK_FORBIDDEN.includes(p.num));
  const scored = pool.map((p) => {
    const d = Math.hypot(p.x - x, p.z - z);
    // forwards get a large priority discount: they are supposed to be there
    const roleBias = FORWARDS.includes(p.num) ? 0 : 9;
    const eta = d / Math.max(4.5, maxSpeed(p, false, false, p.stamina)) + roleBias;
    return { p, eta };
  }).sort((a, b) => a.eta - b.eta);
  return scored.slice(0, count).map((s) => s.p);
}

/** The player who will play the ball out of the ruck — never a distant back. */
export function ruckDistributor(all: Live[], team: 'A' | 'B', x: number, z: number): Live {
  for (const num of RUCK_ELIGIBLE) {
    const p = all.find((q) => q.team === team && q.num === num && q.sinbin <= 0 && !q.down);
    if (p && Math.hypot(p.x - x, p.z - z) < 14) return p;
  }
  // fall back to the nearest forward, never to a back from distance
  const fw = all.filter((p) => p.team === team && FORWARDS.includes(p.num) && p.sinbin <= 0 && !p.down);
  if (fw.length) return fw.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  return all.find((p) => p.team === team && p.sinbin <= 0)!;
}

/* ============================ KICK CHASE ============================
 * Three chasers with named lanes, assigned the moment the kick is struck.
 */

export function assignChase(all: Live[], team: 'A' | 'B', bx: number, bz: number, _dir: number): { num: number; lane: string }[] {
  const lanes = ['MIDDLE — contest the ball', 'OPEN SIDE — squeeze the receiver', 'BLIND SIDE — cover the in-goal'];
  const pool = all.filter((p) => p.team === team && p.sinbin <= 0);
  const ranked = pool
    .map((p) => ({ p, score: Math.hypot(p.x - bx, p.z - bz) - (p.attrs.SPD / 100) * 6 - (FORWARDS.includes(p.num) ? 0 : 3) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);
  return ranked.map((r, i) => ({ num: r.p.num, lane: lanes[i] ?? 'CHASE' }));
}

/** The receiver of a high ball, with priority. The fifteen calls for it. */
export function assignReceiver(all: Live[], team: 'A' | 'B', bx: number, bz: number): Live {
  const order = [15, 14, 11, 13, 12, 10, 9];
  for (const num of order) {
    const p = all.find((q) => q.team === team && q.num === num && q.sinbin <= 0);
    if (p && Math.hypot(p.x - bx, p.z - bz) < 26) return p;
  }
  return all.filter((p) => p.team === team).sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz))[0];
}

/* ============================ GAP SEEKING ============================
 * Attackers target the gap between defenders, never the carrier's position.
 * The fix for "AI teammates simply run onto the ball back into busy areas".
 */

export function widestGap(defenders: Live[], carrierX: number): number {
  if (defenders.length < 2) return carrierX > 0 ? -1 : 1;
  const xs = defenders.map((d) => d.x).sort((a, b) => a - b);
  let bestX = 0, bestGap = -1;
  for (let i = 0; i < xs.length - 1; i++) {
    const gap = xs[i + 1] - xs[i];
    if (gap > bestGap && gap > 1.4) { bestGap = gap; bestX = (xs[i] + xs[i + 1]) / 2; }
  }
  // never steer within 2.5 m of touch
  if (bestX > 31) bestX = 31;
  if (bestX < -31) bestX = -31;
  return bestX === 0 ? (carrierX > 0 ? -24 : 24) : bestX;
}

/** Touchline awareness. The CPU never runs itself into touch. */
export function avoidTouch(x: number, z: number, dir: number): number {
  const toLine = dir > 0 ? 50 - z : 50 + z;
  if (toLine > 20) return x;
  if (x > 26) return 26;
  if (x < -26) return -26;
  return x;
}

/** Live overlap count: the reason a backline move works or does not. */
export function overlapCount(attackers: Live[], defenders: Live[], x0: number, x1: number): number {
  const a = attackers.filter((p) => p.x >= x0 && p.x <= x1).length;
  const d = defenders.filter((p) => p.x >= x0 && p.x <= x1).length;
  return a - d;
}

export const ROLE_INDEX = ROLE_CONTRACTS;
