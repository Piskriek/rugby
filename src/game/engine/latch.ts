/**
 * LATCHES — multi-body 6DOF compliant spring constraints for tackles and rucks.
 *
 * The engine's breakdown used to be (a) static slot positions and (b) the
 * rigid capsule-on-capsule separation in `intelligence.separate()`: a body
 * that overlapped was projected straight out of the other body in the same
 * frame. A shot at 7 m/s read as two men bouncing off each other rather than
 * binding, and a ruck was a set of snapshots, not a shoving contest.
 *
 * This module replaces the rigid contacts INSIDE the tackle/ruck with a
 * deterministic 6DOF compliant constraint solver:
 *
 *   - bodies (carrier, tackler, clearers, jackal, counters, the ball) carry
 *     mass, velocity, a capsule radius and body-frame anchor points
 *     (shoulder / arm / torso / hip);
 *   - a bind is a set of six compliant axes — translation x/y/z plus pitch
 *     and yaw — each a spring-plus-damper between the tackler's shoulder
 *     collider and the carrier's torso (or between a ruck entrant and the
 *     ball lattice). Stiffness is high enough that bodies hold, low enough
 *     that they compress into each other; nothing is ever projected.
 *   - a joint releases when its tension exceeds the breaking strength, or
 *     when the phase asks for it (tackle complete, whistle, fend).
 *   - arriving ruck entrants push through their bind; the net horizontal
 *     drive is summed over both sides and moves the contest (the ball body)
 *     physically.
 *   - body-body contact is a compliant penetration spring with tangential
 *     friction, so bodies shunt and slide instead of clipping or snapping.
 *
 * All of it runs at the engine's fixed dt with 2 substeps, force and velocity
 * caps, and NaN guards — the fault hunt must never see a jitter here.
 *
 * The module is framework-free: it imports nothing from the game, so it can
 * be probed in isolation (scripts/latch-probe.ts) and unit-verified.
 */

export type LatchKind = 'TACKLE' | 'RUCK';
export type LatchBodyKind = 'CARRIER' | 'TACKLER' | 'CLEARER' | 'JACKAL' | 'COUNTER' | 'BALL';

export interface LatchVec { x: number; y: number; z: number }

/** One compliant axis of a bind: spring k (N/m or N·m/rad), damper c,
 *  rest offset and a hard per-axis force cap (keeps a bad frame from
 *  exploding the pile). */
export interface LatchAxis { k: number; c: number; rest: number; max: number }

export interface LatchAxes {
  /** Translational: lateral (right), vertical, axial (forward). */
  tx: LatchAxis; ty: LatchAxis; tz: LatchAxis;
  /** Rotational: pitch (fall together), roll (lean together), yaw twist. */
  rx: LatchAxis; ry: LatchAxis; rz: LatchAxis;
}

export interface LatchBody {
  id: number;
  kind: LatchBodyKind;
  team: 'A' | 'B';
  num: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Body yaw in the engine convention: facing = (sin(yaw), cos(yaw)). */
  yaw: number; yawVel: number;
  /** Lateral lean (roll) in radians, 0 = vertical. */
  roll: number; rollVel: number;
  mass: number;
  /** Capsule radius (the contact envelope, now compliant). */
  radius: number;
  /** 1 = upright, 0 = flat (a tackled body falls; the bind drags it down
   *  with the carrier). Eased by the pitch channel and the fall state. */
  upright: number;
  down: boolean;
  /** Forward shove in newtons, set by the breakdown each frame. */
  drive: number;
  /** World direction of the shove (+1/-1 along the attack axis). */
  driveDir: number;
  /** False until the body has bound through the gate — an unbound body
   *  cannot push: its drive is dead. */
  bound: boolean;
  /** True while the entrant is still running in (seek = approach force). */
  seeking: boolean;
  /** Approach target while seeking. */
  tx: number; tz: number;
  /** Soft world anchor (the ruck's ground mark): the contest pushes against
   *  it, so a winning shove visibly moves the pile without drifting it. */
  anchor?: { x: number; z: number; k: number; c: number };
  /** last-frame velocity magnitude change — the jitter metric. */
  jitter: number;
}

export interface LatchJoint {
  id: number;
  kind: LatchKind;
  a: number; b: number;
  /** Body-frame anchor offsets. For a tackle: tackler shoulder/arm ↦
   *  carrier torso. For a ruck: entrant shoulder ↦ ball. */
  anchorA: LatchVec; anchorB: LatchVec;
  axes: LatchAxes;
  /** Joint fails when translation tension exceeds breakN or rotational
   *  torque exceeds breakNm. */
  breakN: number; breakNm: number;
  broken: boolean; reason: string;
  force: LatchVec; torque: number; strain: number;
  age: number;
}

export interface LatchMetrics {
  maxPenetration: number;
  /** Frames where any pair overlapped deeper than 0.45 m (a pile-worst). */
  deepContacts: number;
  /** The deepest pair ever, for the audit: '{aKind}#{aNum}-{bKind}#{bNum}'. */
  worstPair: string;
  /** Position/velocity snapshot at the deepest pair, for the fault hunt. */
  worstSnap: { ax: number; az: number; bx: number; bz: number; va: number; vb: number };
  /** Breadcrumb of the deep-overlap moments (>0.8 m), for the fault hunt. */
  deepHistory: string[];
  /** Oldest deep overlap persists this many frames (an unresolved stack). */
  deepResolveFrames: number;
  maxForce: number;
  maxTorque: number;
  instabilityFrames: number;
  brokenJoints: number;
  skippedBinds: number;
  gateRejects: number;
  releases: Record<string, number>;
  frames: number;
}

const SUBSTEPS = 2;
const MAX_V = 12;            // m/s — no body may leave frame in one frame
const MAX_YAW_V = 6;         // rad/s
const CAP_F = 14000;         // N per channel (a pile impact, not an explosion)
const K_CONTACT = 42000;     // N/m penetration stiffness (stiff = no clipping)
const C_CONTACT = 1950;      // N·s/m normal damping (~0.5 critical for 105 kg)
const MU = 0.55;             // tangential friction coefficient
const FIELD_X = 34.5, FIELD_Z = 61;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * The legal-entry test for a ruck bind. `fwd` is the attacking side's world
 * direction. Defence arrives from ahead of the ball (its own side of the
 * gate); attack arrives from behind the ball (its own hindmost-foot side).
 * The lat gate is the ruck's width between the hindmost feet.
 */
export function throughGate(
  x: number, z: number, ballX: number, ballZ: number, fwd: number, defence: boolean,
): boolean {
  if (Math.abs(x - ballX) > 1.55) return false;
  const depth = (z - ballZ) * fwd;
  return defence ? depth > -0.35 : depth < 0.35;
}

let nextId = 1;

export class LatchSystem {
  bodies: LatchBody[] = [];
  joints: LatchJoint[] = [];
  metrics: LatchMetrics = this.blankMetrics();

  private blankMetrics(): LatchMetrics {
    return {
      maxPenetration: 0, deepContacts: 0, worstPair: '',
      worstSnap: { ax: 0, az: 0, bx: 0, bz: 0, va: 0, vb: 0 },
      deepHistory: [], deepResolveFrames: 0,
      maxForce: 0, maxTorque: 0,
      instabilityFrames: 0, brokenJoints: 0, skippedBinds: 0, gateRejects: 0,
      releases: {}, frames: 0,
    };
  }

  reset(): void {
    this.bodies = [];
    this.joints = [];
    this.metrics = this.blankMetrics();
  }

  body(id: number): LatchBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  byTeamNum(team: 'A' | 'B', num: number, kind?: LatchBodyKind): LatchBody | undefined {
    return this.bodies.find((b) => b.team === team && b.num === num && (!kind || b.kind === kind));
  }

  byKind(kind: LatchBodyKind): LatchBody | undefined {
    return this.bodies.find((b) => b.kind === kind);
  }

  spawn(b: Omit<LatchBody, 'id' | 'bound' | 'seeking' | 'jitter' | 'upright' | 'tx' | 'tz' | 'roll' | 'rollVel'> & { upright?: number }): LatchBody {
    const body: LatchBody = {
      id: nextId++, kind: b.kind, team: b.team, num: b.num,
      x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy ?? 0, vz: b.vz,
      yaw: b.yaw, yawVel: 0, roll: 0, rollVel: 0, mass: b.mass, radius: b.radius,
      upright: b.upright ?? (b.down ? 0.35 : 1),
      down: b.down, drive: b.drive, driveDir: b.driveDir,
      bound: false, seeking: false, tx: b.x, tz: b.z, jitter: 0,
    };
    this.bodies.push(body);
    return body;
  }

  /** An entrant still walking in: spring toward the mark, capped at a
   *  jog — he arrives, he does not jump. */
  seek(bodyId: number, x: number, z: number): void {
    const b = this.body(bodyId);
    if (!b || b.bound) return;
    b.seeking = true;
    b.tx = x; b.tz = z;
  }

  /** The entrant has reached the ruck — the approach stops, the contest
   *  drive takes over through the bind. */
  settle(bodyId: number): void {
    const b = this.body(bodyId);
    if (!b) return;
    b.seeking = false;
  }

  /**
   * Detect-and-bind. Returns the new joint, or null when the binding
   * conditions are not met — the caller must not let an unbound body push
   * the contest. The 1.2 m detection radius is the honest contact radius of
   * the tackle/ruck (upOpen uses 1.1 m to START a tackle; the bind takes
   * over while bodies compress).
   */
  bind(opts: {
    kind: LatchKind; a: number; b: number;
    anchorA?: LatchVec; anchorB?: LatchVec;
    axes?: Partial<LatchAxes>; breakN?: number; breakNm?: number;
    gate?: { fwd: number; defence: boolean };
  }): LatchJoint | null {
    const A = this.body(opts.a), B = this.body(opts.b);
    if (!A || !B) return null;
    const d = Math.hypot(B.x - A.x, B.z - A.z);
    if (d >= 1.2) {
      this.metrics.skippedBinds++;
      return null;
    }
    if (opts.gate && !throughGate(B.x, B.z, A.x, A.z, opts.gate.fwd, opts.gate.defence)) {
      this.metrics.gateRejects++;
      return null;
    }
    const ax = (k: number, c: number, rest: number, max: number): LatchAxis => ({ k, c, rest, max });
    const base: LatchAxes = {
      tx: ax(4300, 640, 0, 7000),      // lateral — the shoulder slides on contact
      ty: ax(2600, 430, 0, 4800),      // vertical — the fall is soft
      tz: ax(5600, 740, 0, 8000),      // axial — the shove channel
      rx: ax(1500, 250, 0, 620),       // pitch — they tip together
      ry: ax(1200, 220, 0, 560),       // roll — they lean together
      rz: ax(1700, 280, 0, 620),       // yaw twist
    };
    for (const k of Object.keys(base) as (keyof LatchAxes)[]) {
      if (opts.axes?.[k]) base[k] = { ...base[k], ...opts.axes![k] };
    }
    const joint: LatchJoint = {
      id: nextId++, kind: opts.kind, a: opts.a, b: opts.b,
      anchorA: opts.anchorA ?? { x: 0, y: 1.0, z: 0 },
      anchorB: opts.anchorB ?? { x: 0, y: 0.95, z: 0 },
      axes: base, breakN: opts.breakN ?? 6200, breakNm: opts.breakNm ?? 520,
      broken: false, reason: '', force: { x: 0, y: 0, z: 0 }, torque: 0, strain: 0, age: 0,
    };
    this.joints.push(joint);
    A.bound = true; B.bound = true;
    return joint;
  }

  /** Release joints by kind, recording the reason for the audit. */
  breakKind(kind: LatchKind, reason: string): number {
    let n = 0;
    for (const j of this.joints) {
      if (j.kind === kind && !j.broken) { j.broken = true; j.reason = reason; this.metrics.brokenJoints++; this.noteRelease(reason); n++; }
    }
    this.purge();
    return n;
  }

  breakJointsOf(bodyId: number, reason: string): number {
    let n = 0;
    for (const j of this.joints) {
      if ((j.a === bodyId || j.b === bodyId) && !j.broken) { j.broken = true; j.reason = reason; this.metrics.brokenJoints++; this.noteRelease(reason); n++; }
    }
    this.purge();
    return n;
  }

  /** Whistle / phase teardown: every bind releases (bodies keep their
   *  positions so nothing snaps when the presentation takes over). */
  clear(reason: string): void {
    for (const j of this.joints) {
      if (!j.broken) { j.broken = true; j.reason = reason; this.metrics.brokenJoints++; this.noteRelease(reason); }
    }
    this.joints = [];
    for (const b of this.bodies) { b.bound = false; b.seeking = false; b.drive = 0; }
  }

  /** A powerful fend: impulse J (N·s) through the carrier's body along his
   *  facing. The tackle joint reads the spike and snaps on separating
   *  overload (a driven release — the carrier blew past the shoulder);
   *  if the tackler's bind holds the spike, he hangs on and the tackle
   *  continues. Returns whether the bind broke. */
  fend(bodyId: number, J: number): boolean {
    const b = this.body(bodyId);
    if (!b) return false;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    b.vx += (fx * J) / b.mass;
    b.vz += (fz * J) / b.mass;
    let snapped = false;
    for (const j of this.joints) {
      if (j.broken || j.kind !== 'TACKLE') continue;
      if (j.a !== bodyId && j.b !== bodyId) continue;
      j.broken = true;
      j.reason = 'BREAK_STRENGTH';
      this.metrics.brokenJoints++;
      this.noteRelease('BREAK_STRENGTH');
      const A = this.body(j.a)!, B = this.body(j.b)!;
      A.bound = false; B.bound = false;
      A.seeking = false; B.seeking = false;
      snapped = true;
    }
    return snapped;
  }

  private noteRelease(reason: string): void {
    this.metrics.releases[reason] = (this.metrics.releases[reason] ?? 0) + 1;
  }

  private purge(): void {
    if (this.joints.some((j) => j.broken)) this.joints = this.joints.filter((j) => !j.broken);
  }

  /** World position of a body-frame anchor after yaw and upright (fall)
   *  rotation. forward = (sin yaw, cos yaw), right = (cos yaw, -sin yaw). */
  anchor(body: LatchBody, local: LatchVec): LatchVec {
    const s = Math.sin(body.yaw), c = Math.cos(body.yaw);
    return {
      x: body.x + local.x * c + local.z * s,
      y: body.y + local.y * body.upright,
      z: body.z - local.x * s + local.z * c,
    };
  }

  /** Advance the constraint world. Call once per engine frame with the
   *  engine dt; internally substeps for stability. */
  private lastDeep = false;
  step(dt: number): void {
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(h);
    if (this.lastDeep) this.metrics.deepResolveFrames++;
    this.lastDeep = false;
    this.metrics.frames++;
    if (this.joints.some((j) => j.broken)) this.purge();
  }

  private substep(dt: number): void {
    const acc = new Map<number, LatchVec>();
    const accYaw = new Map<number, number>();
    const accUp = new Map<number, number>();
    const accRoll = new Map<number, number>();
    const ensure = (id: number) => {
      if (!acc.has(id)) acc.set(id, { x: 0, y: 0, z: 0 });
      if (!accYaw.has(id)) accYaw.set(id, 0);
      if (!accUp.has(id)) accUp.set(id, 0);
      if (!accRoll.has(id)) accRoll.set(id, 0);
    };

    /* ---- 1. compliant bind springs (6DOF: tx/ty/tz + rx/ry/rz) ---- */
    for (const j of this.joints) {
      const A = this.body(j.a), B = this.body(j.b);
      if (!A || !B) { j.broken = true; j.reason = 'MISSING_BODY'; continue; }
      const pa = this.anchor(A, j.anchorA);
      const pb = this.anchor(B, j.anchorB);
      const sA = Math.sin(A.yaw), cA = Math.cos(A.yaw);
      const rel = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
      const vrel = {
        x: (B.vx - A.vx) * cA + (B.vz - A.vz) * (-sA),
        y: B.vy - A.vy,
        z: (B.vx - A.vx) * sA + (B.vz - A.vz) * cA,
      };
      const tx = rel.x * cA - rel.z * sA;
      const ty = rel.y;
      const tz = rel.x * sA + rel.z * cA;
      const dyT = wrapAngle(B.yaw - A.yaw);
      const dyV = B.yawVel - A.yawVel;
      const drT = wrapAngle(B.roll - A.roll);
      const drV = B.rollVel - A.rollVel;
      const duT = B.upright - A.upright;

      const F = {
        x: clamp(j.axes.tx.k * (j.axes.tx.rest - tx) - j.axes.tx.c * vrel.x, -j.axes.tx.max, j.axes.tx.max),
        y: clamp(j.axes.ty.k * (j.axes.ty.rest - ty) - j.axes.ty.c * vrel.y, -j.axes.ty.max, j.axes.ty.max),
        z: clamp(j.axes.tz.k * (j.axes.tz.rest - tz) - j.axes.tz.c * vrel.z, -j.axes.tz.max, j.axes.tz.max),
      };
      const T = clamp(j.axes.rz.k * (j.axes.rz.rest - dyT) - j.axes.rz.c * dyV, -j.axes.rz.max, j.axes.rz.max);
      const Tr = clamp(j.axes.ry.k * (j.axes.ry.rest - drT) - j.axes.ry.c * drV, -j.axes.ry.max, j.axes.ry.max);
      const Tp = clamp(j.axes.rx.k * (j.axes.rx.rest - duT) - j.axes.rx.c * duT * 4, -j.axes.rx.max, j.axes.rx.max);

      const mag = Math.hypot(F.x, F.y, F.z);
      j.force = { x: F.x, y: F.y, z: F.z };
      j.torque = Math.max(Math.abs(T), Math.abs(Tr), Math.abs(Tp));
      j.strain = Math.max(mag / j.breakN, j.torque / j.breakNm);
      if (mag > this.metrics.maxForce) this.metrics.maxForce = mag;
      if (j.torque > this.metrics.maxTorque) this.metrics.maxTorque = j.torque;

      /* ---- release on breaking strength (fend / overload) ----
       * Breaking is TENSION: a bind must be ripped apart, not collided
       * apart. A carrier arriving at 7 m/s deposits an 8 kN compression
       * spike on the first frame — that is the impact a compliant bind
       * exists to ABSORB, not to fail on. Only a joint whose bodies are
       * actually separating (a fend, a violent roll-away) may exceed its
       * breaking strength. */
      const separating = (B.vx - A.vx) * (pb.x - pa.x)
        + (B.vy - A.vy) * (pb.y - pa.y)
        + (B.vz - A.vz) * (pb.z - pa.z);
      if (separating > 0 && j.strain > 1) {
        j.broken = true;
        j.reason = 'BREAK_STRENGTH';
        this.metrics.brokenJoints++;
        this.noteRelease('BREAK_STRENGTH');
        A.bound = false; B.bound = false;
        A.seeking = false; B.seeking = false;
        continue;
      }

      ensure(j.a); ensure(j.b);
      const fa = acc.get(j.a)!;
      const fb = acc.get(j.b)!;
      fa.x -= F.x * cA + F.z * sA;
      fa.z -= -F.x * sA + F.z * cA;
      fa.y -= F.y;
      fb.x += F.x * cA + F.z * sA;
      fb.z += -F.x * sA + F.z * cA;
      fb.y += F.y;
      accYaw.set(j.a, (accYaw.get(j.a) ?? 0) - T);
      accYaw.set(j.b, (accYaw.get(j.b) ?? 0) + T);
      accRoll.set(j.a, (accRoll.get(j.a) ?? 0) - Tr);
      accRoll.set(j.b, (accRoll.get(j.b) ?? 0) + Tr);
      accUp.set(j.a, (accUp.get(j.a) ?? 0) - Tp);
      accUp.set(j.b, (accUp.get(j.b) ?? 0) + Tp);
    }

    /* ---- 2. compliant body-body contact (no rigid projection) ---- */
    for (let i = 0; i < this.bodies.length; i++) {
      for (let k = i + 1; k < this.bodies.length; k++) {
        const A = this.bodies[i], B = this.bodies[k];
        const dx = B.x - A.x, dz = B.z - A.z;
        const d = Math.hypot(dx, dz);
        const min = A.radius + B.radius;
        if (d >= min) continue;
        /* Coincident bodies (the ball spawns under the carrier, and a pile
         * can stack exactly) must still resolve: use a deterministic normal
         * instead of dropping the pair, or they interpenetrate forever. */
        const nx = d > 0.001 ? dx / d : 1;
        const nz = d > 0.001 ? dz / d : 0;
        const pen = min - d;
        if (pen > this.metrics.maxPenetration) {
          this.metrics.maxPenetration = pen;
          this.metrics.worstPair = `${A.kind}#${A.num}-${B.kind}#${B.num}`;
          this.metrics.worstSnap = {
            ax: A.x, az: A.z, bx: B.x, bz: B.z,
            va: Math.hypot(A.vx, A.vz), vb: Math.hypot(B.vx, B.vz),
          };
        }
        if (pen > 0.8 && this.metrics.deepHistory.length < 8) {
          this.metrics.deepHistory.push(
            `${A.kind}#${A.num}-${B.kind}#${B.num} pen=${pen.toFixed(2)} `
            + `a(${A.x.toFixed(1)},${A.z.toFixed(1)})v${Math.hypot(A.vx, A.vz).toFixed(1)}`
            + `s${A.seeking ? 1 : 0}b${A.bound ? 1 : 0} `
            + `b(${B.x.toFixed(1)},${B.z.toFixed(1)})v${Math.hypot(B.vx, B.vz).toFixed(1)}`
            + `s${B.seeking ? 1 : 0}b${B.bound ? 1 : 0}`,
          );
        }
        if (pen > 0.45) this.metrics.deepContacts++;
        if (pen > 0.8) this.lastDeep = true;
        const vn = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
        const Fn = clamp(K_CONTACT * pen - C_CONTACT * vn, 0, CAP_F);
        // tangential sliding friction — the compliant replacement for
        // capsule sliding: it damps slide instead of projecting.
        const tx = -nz, tz = nx;
        const vt = (B.vx - A.vx) * tx + (B.vz - A.vz) * tz;
        const sgn = vt >= 0 ? 1 : -1;
        const Ft = Math.min(Math.abs(vt) * C_CONTACT, MU * Fn);
        const fx = nx * Fn - tx * Ft * sgn;
        const fz = nz * Fn - tz * Ft * sgn;
        ensure(A.id); ensure(B.id);
        const fa = acc.get(A.id)!, fb = acc.get(B.id)!;
        fa.x -= fx; fa.z -= fz; fb.x += fx; fb.z += fz;
        /* SPLIT IMPULSE — the joint lattice is an over-constrained pile: a
         * ruck bind pulls the shoulder onto the ball while the tackle bind
         * pulls the torso onto the tackler, so springs ALONE let centres
         * converge to one point (the deep 1.05 m fault). The force solution
         * cannot see that; the POSITION can. This is a bounded, per-frame
         * positional separation (<= 0.12 m, split by inverse mass — never a
         * projection across the field) plus an inelastic kill of the closing
         * velocity, so the pile settles at the contact envelope instead of
         * oscillating through it. This is the contact the gate measures:
         * players lean on each other and do not occupy the same turf. */
        const closing = vn < 0 ? -vn : 0;
        if (pen > 0.001) {
          const imA = 1 / Math.max(1, A.mass), imB = 1 / Math.max(1, B.mass);
          const wA = imA / (imA + imB), wB = 1 - wA;
          const corr = Math.min(pen, 0.12) * 0.8;
          A.x -= nx * corr * wA; A.z -= nz * corr * wA;
          B.x += nx * corr * wB; B.z += nz * corr * wB;
          if (closing > 0) {
            const dvA = -closing * wA, dvB = closing * wB;
            A.vx += nx * dvA; A.vz += nz * dvA;
            B.vx += nx * dvB; B.vz += nz * dvB;
          }
        }
      }
    }

    /* ---- 3. drive through the binds + integration ---- */
    for (const b of this.bodies) {
      ensure(b.id);
      const f = acc.get(b.id)!;
      if (b.bound && b.drive !== 0) f.z += b.drive * b.driveDir;
      if (b.seeking && !b.bound) {
        const dx = b.tx - b.x, dz = b.tz - b.z;
        const dd = Math.hypot(dx, dz);
        if (dd > 0.05) {
          const a = Math.min(4.6, dd * 9);
          f.x += (dx / dd) * b.mass * a;
          f.z += (dz / dd) * b.mass * a;
        }
      }

      if (b.anchor) {
        f.x += (b.anchor.x - b.x) * b.anchor.k - b.vx * b.anchor.c;
        f.z += (b.anchor.z - b.z) * b.anchor.k - b.vz * b.anchor.c;
      }

      const invM = 1 / Math.max(1, b.mass);
      const vPrev = Math.hypot(b.vx, b.vz);
      b.vx += f.x * invM * dt;
      b.vy += f.y * invM * dt;
      b.vz += f.z * invM * dt;
      const vNow = Math.hypot(b.vx, b.vz);
      if (vNow > MAX_V) { b.vx *= MAX_V / vNow; b.vz *= MAX_V / vNow; }
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      /* vertical: a soft floor spring — the pile settles, it does not float. */
      b.vy += (0 - b.y) * 90 * dt - b.vy * 9 * dt;
      b.y = clamp(b.y + b.vy * dt, 0, 1.4);
      b.yawVel = clamp(b.yawVel + ((accYaw.get(b.id) ?? 0) * invM * 0.45) * dt, -MAX_YAW_V, MAX_YAW_V);
      b.yaw = wrapAngle(b.yaw + b.yawVel * dt);
      b.rollVel = clamp(b.rollVel + ((accRoll.get(b.id) ?? 0) * invM * 0.45) * dt, -MAX_YAW_V, MAX_YAW_V);
      b.roll = clamp(b.roll + b.rollVel * dt, -1.2, 1.2);
      /* fall: the body's own down state and the bind's pitch channel both
       * tip the pair toward the ground together. */
      const wantUp = b.down ? 0.35 : 1;
      const du = (wantUp - b.upright) * 5.5 + (accUp.get(b.id) ?? 0) * invM * 0.006;
      b.upright = clamp(b.upright + du * dt, 0.2, 1);
      // pitch bounds: soft clamps only (a real boundary, never a snap)
      if (b.x < -FIELD_X) { b.x = -FIELD_X; if (b.vx < 0) b.vx = 0; }
      if (b.x > FIELD_X) { b.x = FIELD_X; if (b.vx > 0) b.vx = 0; }
      if (b.z < -FIELD_Z) { b.z = -FIELD_Z; if (b.vz < 0) b.vz = 0; }
      if (b.z > FIELD_Z) { b.z = FIELD_Z; if (b.vz > 0) b.vz = 0; }

      const vAfter = Math.hypot(b.vx, b.vz);
      b.jitter = Math.abs(vAfter - vPrev);
      if (!Number.isFinite(b.x + b.y + b.z + b.vx + b.vy + b.vz + b.yaw + b.upright)) {
        b.x = 0; b.y = 0; b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0;
        b.yaw = 0; b.yawVel = 0; b.upright = 1;
        this.metrics.instabilityFrames++;
      }
    }
    for (const j of this.joints) j.age += dt;
  }

  /** The net horizontal drive applied THROUGH the binds: the ruck contest
   *  physically moves by this sum. `fwd` is the attacking side's world
   *  direction; returns attack/defence totals in N and the normalized net
   *  (−1..+1, attack positive). */
  latticeNet(fwd: number): { attack: number; defence: number; net: number } {
    let atk = 0, def = 0;
    for (const b of this.bodies) {
      if (!b.bound || b.kind === 'BALL' || b.drive === 0) continue;
      if (b.driveDir === fwd) atk += b.drive; else def += b.drive;
    }
    const tot = atk + def;
    return { attack: atk, defence: def, net: tot > 0 ? (atk - def) / tot : 0 };
  }

  /** Soft-anchor a body to a world point (the ruck's ground mark): the ball
   *  body pushes against it, so a winning shove visibly moves the contest
   *  without drifting it away. */
  anchorBody(bodyId: number, x: number, z: number, k = 16000, c = 2600): void {
    const b = this.body(bodyId);
    if (!b) return;
    b.anchor = { x, z, k, c };
  }

  /** Clears the anchor (used when a body leaves the lattice). */
  releaseAnchor(bodyId: number): void {
    const b = this.body(bodyId);
    if (b) b.anchor = undefined;
  }

  bindCounts(): { joints: number; tackle: number; ruck: number } {
    let tackle = 0, ruck = 0;
    for (const j of this.joints) { if (j.kind === 'TACKLE') tackle++; else ruck++; }
    return { joints: this.joints.length, tackle, ruck };
  }
}
