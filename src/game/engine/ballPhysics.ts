/**
 * A 28 x 19 cm, 430 g prolate rugby ball. Pitch metres, +y up, long axis local X.
 * No Three, Rapier, DOM or RNG: the match and the headless probe use this solver.
 * q is body-to-world; omega is WORLD angular velocity, in radians/second.
 */
import { BALL_MAJOR, BALL_MINOR, BALL_MASS } from '../../core/physics/ballShape';
export { BALL_MAJOR, BALL_MINOR, BALL_MASS } from '../../core/physics/ballShape';
export const BALL_GRAVITY = 9.81;
export const BALL_RESTITUTION = 0.60;
const SLIDING_FRICTION = 0.58;
const ROLLING_DECEL = 0.95; // m/s² on turf, not a per-render-frame multiplier
const MAX_STEP = 1 / 240;
const INV_MASS = 1 / BALL_MASS;
const INV_LONG_I = 5 / (2 * BALL_MASS * BALL_MINOR ** 2);
const INV_SIDE_I = 5 / (BALL_MASS * (BALL_MAJOR ** 2 + BALL_MINOR ** 2));

export interface BallVector { x: number; y: number; z: number }
export interface BallQuaternion extends BallVector { w: number }
export interface BallBody extends BallVector {
  vx: number; vy: number; vz: number;
  q: BallQuaternion;
  omega: BallVector;
  bounces: number;
  grounded: boolean;
  sleeping: boolean;
  quietTime: number;
  /** A placed kick/throw cannot acquire contact eccentricity before a touch. */
  flightGuard: boolean;
  /** The only kinematic constraint. Null means completely detached. */
  socket: string | null;
}
export interface BallCarrierPose {
  x: number; z: number; y?: number;
  vx: number; vz: number; vy?: number;
  face: number; size: number;
  team: string; num: number;
}
export interface BallContact extends BallVector { height: number; tip: number }

export function makeBall(x = 0, y = BALL_MINOR, z = 0): BallBody {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0,
    q: { x: 0, y: 0, z: 0, w: 1 }, omega: { x: 0, y: 0, z: 0 },
    bounces: 0, grounded: false, sleeping: false, quietTime: 0,
    flightGuard: false, socket: null,
  };
}

/** Exact ellipsoid support point: r = -S n / sqrt(n.S.n), n = (0,1,0),
 * S = b² I + (a²-b²) u u^T, u = q * local-X. The centre's contact height
 * varies from 9.5 cm on the belly to 14 cm on a tip; a fixed radius sinks it.
 */
export function ballContact(q: BallQuaternion, out: BallContact = { x: 0, y: 0, z: 0, height: 0, tip: 0 }): BallContact {
  const ux = 1 - 2 * (q.y * q.y + q.z * q.z);
  const uy = 2 * (q.x * q.y + q.w * q.z);
  const uz = 2 * (q.x * q.z - q.w * q.y);
  const delta = BALL_MAJOR ** 2 - BALL_MINOR ** 2;
  const h = Math.sqrt(BALL_MINOR ** 2 + delta * uy * uy);
  out.x = -delta * ux * uy / h;
  out.y = -h;
  out.z = -delta * uz * uy / h;
  out.height = h;
  out.tip = Math.max(0, (Math.abs(uy) - 0.65) / 0.35);
  return out;
}

/** Exact world-space angular increment, multiplied on the LEFT of q. */
export function spinBall(b: BallBody, dt: number): void {
  const o = b.omega, speed = Math.hypot(o.x, o.y, o.z);
  if (speed < 1e-12 || dt === 0) return;
  const half = speed * dt * 0.5, k = Math.sin(half) / speed;
  const x = o.x * k, y = o.y * k, z = o.z * k, w = Math.cos(half);
  const q = b.q, a = q.x, c = q.y, e = q.z, f = q.w;
  q.x = w * a + x * f + y * e - z * c;
  q.y = w * c - x * e + y * f + z * a;
  q.z = w * e + x * c - y * a + z * f;
  q.w = w * f - x * a - y * c - z * e;
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  q.x /= norm; q.y /= norm; q.z /= norm; q.w /= norm;
}

/** One authored torso/hand socket for both ordinary carries and secured grips.
 * The rugby engine's face is a +/- running axis (NOT a yaw in radians).
 * A moving carrier's heading comes from his actual velocity.
 */
export function weldBall(b: BallBody, p: BallCarrierPose): void {
  const speed = Math.hypot(p.vx, p.vz);
  const fx = speed > 0.15 ? p.vx / speed : 0;
  const fz = speed > 0.15 ? p.vz / speed : (p.face >= 0 ? 1 : -1);
  b.x = p.x + (fx * 0.20 + fz * 0.10) * p.size;
  b.y = (p.y ?? 0) + 1.05 * p.size;
  b.z = p.z + (fz * 0.20 - fx * 0.10) * p.size;
  const yaw = Math.atan2(fx, fz) * 0.5;
  // A slight tuck across the chest; local X remains the ball's long axis.
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sz = Math.sin(-0.10), cz = Math.cos(-0.10);
  b.q.x = sy * sz; b.q.y = sy * cz; b.q.z = cy * sz; b.q.w = cy * cz;
  b.vx = p.vx; b.vy = p.vy ?? 0; b.vz = p.vz;
  b.omega.x = b.omega.y = b.omega.z = 0;
  b.socket = `${p.team}:${p.num}`;
  b.grounded = b.sleeping = b.flightGuard = false;
  b.quietTime = 0;
}

/** Release at the CURRENT socket with v_carrier + J/m. The caller solves J
 * in the carrier frame (a pass intercept) or supplies the boot/strip impulse.
 * There is no joint, parent or grip state left for a later tick to re-enforce.
 */
export function detachBall(b: BallBody, p: BallCarrierPose, impulse: BallVector, spin?: BallVector): void {
  weldBall(b, p);
  b.socket = null;
  b.vx += impulse.x * INV_MASS;
  b.vy += impulse.y * INV_MASS;
  b.vz += impulse.z * INV_MASS;
  if (spin) { b.omega.x = spin.x; b.omega.y = spin.y; b.omega.z = spin.z; }
  b.bounces = 0;
}

export function touchBall(b: BallBody): void {
  b.flightGuard = false;
  b.sleeping = false;
  b.quietTime = 0;
}

// Scratch values are never retained by a body. No per-substep allocations.
const contact: BallContact = { x: 0, y: 0, z: 0, height: 0, tip: 0 };
const inertia: BallVector = { x: 0, y: 0, z: 0 };
function inverseInertia(b: BallBody, x: number, y: number, z: number): BallVector {
  const q = b.q;
  const ux = 1 - 2 * (q.y * q.y + q.z * q.z);
  const uy = 2 * (q.x * q.y + q.w * q.z);
  const uz = 2 * (q.x * q.z - q.w * q.y);
  const k = (INV_LONG_I - INV_SIDE_I) * (x * ux + y * uy + z * uz);
  inertia.x = x * INV_SIDE_I + k * ux;
  inertia.y = y * INV_SIDE_I + k * uy;
  inertia.z = z * INV_SIDE_I + k * uz;
  return inertia;
}
function impulseAt(b: BallBody, r: BallVector, x: number, y: number, z: number): void {
  b.vx += x * INV_MASS; b.vy += y * INV_MASS; b.vz += z * INV_MASS;
  const dw = inverseInertia(b, r.y * z - r.z * y, r.z * x - r.x * z, r.x * y - r.y * x);
  b.omega.x += dw.x; b.omega.y += dw.y; b.omega.z += dw.z;
}
function effectiveMass(b: BallBody, r: BallVector, x: number, y: number, z: number): number {
  const cx = r.y * z - r.z * y, cy = r.z * x - r.x * z, cz = r.x * y - r.y * x;
  const v = inverseInertia(b, cx, cy, cz);
  return INV_MASS + cx * v.x + cy * v.y + cz * v.z;
}

/** Integrate a free ball, including orientation-dependent ground contact.
 * Restitution is applied to CONTACT velocity, not just centre velocity:
 * Jn = -(1+e) vn / (1/m + (r x n).I^-1.(r x n)). Torque is r x Jn.
 * Tangential impulses are Coulomb-limited and therefore cannot add energy.
 */
export function stepBall(b: BallBody, dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt) || b.socket !== null) return;
  if (b.sleeping) {
    // An external impulse wakes a sleeping ball; unforced sleep is bit-stable.
    if (b.vx === 0 && b.vy === 0 && b.vz === 0 && b.omega.x === 0 && b.omega.y === 0 && b.omega.z === 0) return;
    touchBall(b);
  }
  const steps = Math.ceil(dt / MAX_STEP), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    b.x += b.vx * h; b.z += b.vz * h;
    b.y += b.vy * h - 0.5 * BALL_GRAVITY * h * h;
    b.vy -= BALL_GRAVITY * h;
    spinBall(b, h);
    const r = ballContact(b.q, contact);
    b.grounded = false;
    if (b.y > r.height + 1e-6) { b.quietTime = 0; continue; }
    b.y = r.height;
    b.flightGuard = false; // first TURF contact, never a timer or a random flight kick

    const o = b.omega;
    let vn = b.vy + o.z * r.x - o.x * r.z;
    const impact = vn < -0.85;
    const steepness = Math.max(0, -b.vy) / Math.max(4, Math.hypot(b.vx, b.vz));
    if (impact && r.tip > 0) {
      /* A perfect mathematical spheroid dropped EXACTLY on its axis has no
       * torque. Real tips have seams/valves and turf has a finite contact patch.
       * A 6 mm body-local seam eccentricity breaks that unstable equilibrium,
       * only on a tip impact. It is deterministic, not random mid-air wobble;
       * the impulse solver budgets its spin/lateral kick from impact energy.
       */
      const q = b.q;
      let sx = 2 * (q.x * q.y - q.w * q.z), sz = 2 * (q.y * q.z + q.w * q.x);
      const len = Math.hypot(sx, sz) || 1;
      sx /= len; sz /= len;
      r.x += sx * 0.006 * r.tip;
      r.z += sz * 0.006 * r.tip;
      vn = b.vy + o.z * r.x - o.x * r.z;
    }
    let jn = 0;
    if (vn < 0) {
      const e = impact ? BALL_RESTITUTION - 0.14 * r.tip : 0;
      jn = -(1 + e) * vn / effectiveMass(b, r, 0, 1, 0);
      impulseAt(b, r, 0, jn, 0);
      if (impact) b.bounces++;
    }
    // Velocity of the patch on the turf, including spin: sliding vs rolling.
    const sx = b.vx + o.y * r.z - o.z * r.y;
    const sz = b.vz + o.x * r.y - o.y * r.x;
    const slip = Math.hypot(sx, sz);
    if (slip > 1e-9 && jn > 0) {
      const tx = -sx / slip, tz = -sz / slip;
      const jt = Math.min(slip / effectiveMass(b, r, tx, 0, tz), SLIDING_FRICTION * jn);
      impulseAt(b, r, tx * jt, 0, tz * jt);
    }

    if (impact) {
      // The inflated shell and turf deform under a steep strike. Ploughing
      // loses tangential/rotational energy as well as normal restitution:
      // a falling bomb sits up, whereas a shallow grubber skids onward.
      // This ONLY removes energy and leaves a belly's vertical e = 0.60.
      const keep = Math.max(0.28, 1 - 0.20 * steepness);
      b.vx *= keep; b.vz *= keep;
      o.x *= keep; o.y *= keep; o.z *= keep;
    }
    const contactVy = b.vy + o.z * r.x - o.x * r.z;
    b.grounded = contactVy < 0.15 && !impact;
    if (!b.grounded) { b.quietTime = 0; continue; }
    // Deforming turf dissipates rolling energy even after sliding has stopped.
    const speed = Math.hypot(b.vx, b.vz);
    const keep = speed > 0 ? Math.max(0, 1 - ROLLING_DECEL * h / speed) : 0;
    b.vx *= keep; b.vz *= keep;
    const angular = Math.hypot(o.x, o.y, o.z);
    const angularKeep = angular > 0 ? Math.max(0, 1 - 2.4 * h / angular) : 0;
    o.x *= angularKeep; o.y *= angularKeep; o.z *= angularKeep;
    // Centre rises/falls as the ellipsoid rolls, but the contact cannot sink.
    b.vy = o.x * r.z - o.z * r.x;
    if (Math.hypot(b.vx, b.vz) < 0.055 && Math.hypot(o.x, o.y, o.z) < 0.4 && Math.abs(b.vy) < 0.08) {
      b.quietTime += h;
      if (b.quietTime >= 0.25) {
        b.vx = b.vy = b.vz = 0;
        o.x = o.y = o.z = 0;
        b.sleeping = true;
        return;
      }
    } else b.quietTime = 0;
  }
}

/** Kinematic player shapes in pitch metres. Player locomotion retains its single
 * writer; a 430 g ball receives their contact velocity, never moves their root. */
export interface BallPlayerCollider {
  x: number; z: number; vx: number; vz: number;
  size: number; face: number;
  down?: boolean; sinbin?: number;
}
const playerContact: BallVector = { x: 0, y: 0, z: 0 };

/** Ellipsoid against a capsule, using the same support tensor / inertia as turf.
 * The normal impulse and bounded surface friction produce real off-centre spin.
 * No seeded or unseeded randomness: a protected flight changes only on TOUCH. */
function hitPlayerCapsule(
  b: BallBody, p: BallPlayerCollider,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number,
): boolean {
  const sx = bx - ax, sy = by - ay, sz = bz - az;
  const length2 = sx * sx + sy * sy + sz * sz;
  const t = length2 > 0 ? Math.max(0, Math.min(1,
    ((b.x - ax) * sx + (b.y - ay) * sy + (b.z - az) * sz) / length2)) : 0;
  let nx = b.x - ax - t * sx, ny = b.y - ay - t * sy, nz = b.z - az - t * sz;
  const distance = Math.hypot(nx, ny, nz);
  if (distance >= radius + BALL_MAJOR) return false;
  if (distance > 1e-8) { nx /= distance; ny /= distance; nz /= distance; }
  else { nx = 1; ny = nz = 0; }
  // A boot cannot drive a grounded ball through the grass. Resolve that squeeze
  // sideways instead of accumulating impossible downward penetration/energy.
  if (ny < 0 && b.y <= ballContact(b.q, contact).height + 1e-5) {
    const flat = Math.hypot(nx, nz);
    nx = flat > 1e-8 ? nx / flat : 1;
    nz = flat > 1e-8 ? nz / flat : 0;
    ny = 0;
  }
  const q = b.q;
  const ux = 1 - 2 * (q.y * q.y + q.z * q.z);
  const uy = 2 * (q.x * q.y + q.w * q.z);
  const uz = 2 * (q.x * q.z - q.w * q.y);
  const delta = BALL_MAJOR ** 2 - BALL_MINOR ** 2;
  const un = ux * nx + uy * ny + uz * nz;
  const support = Math.sqrt(BALL_MINOR ** 2 + delta * un * un);
  const penetration = radius + support - distance;
  if (penetration <= 1e-7) return false;
  const r = playerContact;
  r.x = -(BALL_MINOR ** 2 * nx + delta * ux * un) / support;
  r.y = -(BALL_MINOR ** 2 * ny + delta * uy * un) / support;
  r.z = -(BALL_MINOR ** 2 * nz + delta * uz * un) / support;
  b.x += nx * penetration; b.y += ny * penetration; b.z += nz * penetration;
  touchBall(b);
  const o = b.omega;
  let vx = b.vx - p.vx + o.y * r.z - o.z * r.y;
  let vy = b.vy + o.z * r.x - o.x * r.z;
  let vz = b.vz - p.vz + o.x * r.y - o.y * r.x;
  const vn = vx * nx + vy * ny + vz * nz;
  if (vn < 0) {
    const jn = -(1 + (vn < -0.8 ? 0.28 : 0)) * vn / effectiveMass(b, r, nx, ny, nz);
    impulseAt(b, r, nx * jn, ny * jn, nz * jn);
    vx = b.vx - p.vx + o.y * r.z - o.z * r.y;
    vy = b.vy + o.z * r.x - o.x * r.z;
    vz = b.vz - p.vz + o.x * r.y - o.y * r.x;
    const normal = vx * nx + vy * ny + vz * nz;
    vx -= normal * nx; vy -= normal * ny; vz -= normal * nz;
    const slip = Math.hypot(vx, vy, vz);
    if (slip > 1e-8) {
      const tx = -vx / slip, ty = -vy / slip, tz = -vz / slip;
      const jt = Math.min(0.38 * jn, slip / effectiveMass(b, r, tx, ty, tz));
      impulseAt(b, r, tx * jt, ty * jt, tz * jt);
    }
  }
  b.y = Math.max(b.y, ballContact(b.q, contact).height);
  return true;
}

/** Gravity, turf AND moving boots/legs/torso in the same <=1/240 s substeps.
 * Sleeping balls still see players, so walking into one wakes it. `ignore`
 * handles the releasing socket and a genuine two-handed gather, not whole teams.
 * Upright capsules approximate the rig; a down player's body lies on the turf.
 */
export function stepBallWithPlayers<T extends BallPlayerCollider>(
  b: BallBody, dt: number, players: readonly T[],
  ignore?: (p: T) => boolean, onContact?: (p: T) => void,
): void {
  if (!(dt > 0) || !Number.isFinite(dt) || b.socket !== null) return;
  const steps = Math.ceil(dt / MAX_STEP), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    stepBall(b, h);
    const elapsed = (i + 1) * h;
    for (const p of players) {
      if ((p.sinbin ?? 0) > 0) continue;
      const size = p.size;
      const px = p.x + p.vx * elapsed, pz = p.z + p.vz * elapsed;
      if (Math.abs(b.x - px) > 1.1 * size || Math.abs(b.z - pz) > 1.1 * size
        || b.y > 1.85 * size + BALL_MAJOR || ignore?.(p)) continue;
      const speed = Math.hypot(p.vx, p.vz);
      const fx = speed > 0.15 ? p.vx / speed : 0;
      const fz = speed > 0.15 ? p.vz / speed : (p.face >= 0 ? 1 : -1);
      let hit = false;
      if (p.down) {
        hit = hitPlayerCapsule(b, p, px - fx * 0.55 * size, 0.19 * size, pz - fz * 0.55 * size,
          px + fx * 0.55 * size, 0.19 * size, pz + fz * 0.55 * size, 0.20 * size);
      } else {
        hit = hitPlayerCapsule(b, p, px, 0.67 * size, pz, px, 1.50 * size, pz, 0.23 * size);
        for (let side = -1; side <= 1; side += 2) {
          const lx = px + fz * side * 0.12 * size, lz = pz - fx * side * 0.12 * size;
          if (hitPlayerCapsule(b, p, lx, 0.17 * size, lz, lx, 0.66 * size, lz, 0.085 * size)) hit = true;
          if (hitPlayerCapsule(b, p, lx - fx * 0.08 * size, 0.10 * size, lz - fz * 0.08 * size,
            lx + fx * 0.19 * size, 0.10 * size, lz + fz * 0.19 * size, 0.08 * size)) hit = true;
        }
      }
      if (hit) onContact?.(p);
    }
  }
}
