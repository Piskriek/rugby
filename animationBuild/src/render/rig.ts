/**
 * CAMERA RIG — true pinhole projection so cuts, dollies and orbits read as one
 * continuous game, plus the broadcast camera presets.
 *
 * Camera 1  : touchline gantry, long lens, slight down-field slant
 * Camera 3  : chase / close-up on the ball carrier
 * Camera 12 : high behind the posts for shots at goal
 * Replay    : orbit rig + low hero rig + high wide rig
 */

export interface Camera {
  x: number; z: number; h: number;
  yaw: number; tilt: number; fov: number;
  shake: number; horizon: number; roll: number;
}

export interface View { w: number; h: number }

export interface Proj { sx: number; sy: number; sc: number; f: number }

export function project(cam: Camera, v: View, wx: number, wy: number, wz: number, jx = 0, jy = 0): Proj | null {
  const dx = wx - cam.x, dz = wz - cam.z;
  const sy_ = Math.sin(cam.yaw), cy_ = Math.cos(cam.yaw);
  const fwd = dx * sy_ + dz * cy_;
  const right = dx * cy_ - dz * sy_;
  const rel = wy - cam.h;
  const st = Math.sin(cam.tilt), ct = Math.cos(cam.tilt);
  const depth = fwd * ct - rel * st;
  if (depth < 0.6) return null;
  const up = rel * ct + fwd * st;
  const focal = (v.h * 0.5) / Math.tan(cam.fov * 0.5);
  const sc = focal / depth;
  return { sx: v.w * 0.5 + right * sc + jx, sy: v.h * cam.horizon - up * sc + jy, sc, f: depth };
}

/** camera right-hand unit vector in world xz */
export function camRight(cam: Camera): [number, number] {
  return [Math.cos(cam.yaw), -Math.sin(cam.yaw)];
}
/** camera forward unit vector in world xz */
export function camFwd(cam: Camera): [number, number] {
  return [Math.sin(cam.yaw), Math.cos(cam.yaw)];
}

export const HOME_GOAL_Z = -58;
export const HOME_POST_Z = -50;

function clampNum(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }

/* ---------------- CHASE CAMERA ---------------- */
export interface ChaseRequest {
  tx: number; tz: number; dir: number; zoom: number; liftBias?: number;
}

export function chaseCam(_v: View, req: ChaseRequest): Camera {
  const z = Math.min(1, Math.max(0, req.zoom));
  const trail = 13 + z * z * 49;
  const height = (9 + z * z * 43) + (req.liftBias ?? 0);
  const cx = req.tx * 0.55;
  const cz = req.tz - req.dir * trail;
  const dx = req.tx - cx;
  const dz = req.tz - cz;
  const ground = Math.hypot(dx, dz) || 1;
  const tilt = Math.atan2(height - 1.0, ground);
  const yaw = Math.atan2(dx, dz);
  const fov = 0.90 - z * 0.16;
  return {
    x: cx, z: cz, h: height,
    yaw: req.dir >= 0 ? yaw : yaw + Math.PI,
    tilt, fov, shake: 0, horizon: 0.46, roll: 0,
  };
}

export interface FrameRequest {
  tx: number; tz: number; pxPerMetre: number; height?: number; track?: number;
}

/**
 * BROADCAST GANTRY — the rugby main camera. Elevated, set back off the near
 * touchline, tracking laterally with a long lens and a 20 degree down-field
 * slant so players running away are genuinely seen from behind.
 */
export interface GantryRequest {
  tx: number; tz: number;
  lead: number;
  dir: number;
  standback: number;
  height: number;
  pxPerMetre: number;
  deadZone: number;
  rigZ: number;
  side?: number; // -1 flips the rig to the far touchline
}

export function gantryCam(v: View, req: GantryRequest): { cam: Camera; rigZ: number } {
  const subjectZ = req.tz + req.lead * req.dir;
  let rigZ = req.rigZ;
  if (Math.abs(subjectZ - rigZ) > req.deadZone) {
    rigZ = rigZ + (subjectZ - rigZ) * clampNum(Math.abs(subjectZ - rigZ) / 6, 0.25, 1);
  }
  const side = req.side ?? 1;
  const rigX = side > 0 ? -35 - req.standback : 35 + req.standback;
  const dx = req.tx - rigX;
  const dz = subjectZ - rigZ;
  const ground = Math.hypot(dx, dz) || 1;
  const slantSign = side > 0 ? 1 : -1;
  const yaw = Math.atan2(dx, dz) + (20 * Math.PI) / 180 * (req.dir >= 0 ? slantSign : -slantSign);
  const tilt = Math.atan2(req.height - 1.4, ground);
  const slant = Math.hypot(ground, req.height - 1.4);
  const focal = req.pxPerMetre * slant;
  const fov = clampNum(2 * Math.atan((v.h * 0.5) / Math.max(1, focal)), 0.06, 1.2);
  return {
    cam: { x: rigX, z: rigZ, h: req.height, yaw, tilt, fov, shake: 0, horizon: 0.44, roll: 0 },
    rigZ,
  };
}

export function behindPostsCam(v: View, req: FrameRequest & { fromZ?: number }): Camera {
  const height = req.height ?? 14;
  const track = req.track ?? 0.28;
  const cx = req.tx * track;
  const cz = req.fromZ ?? HOME_GOAL_Z;
  let dz = req.tz - cz;
  if (Math.abs(dz) < 6) dz = dz >= 0 ? 6 : -6;
  const dx = req.tx - cx;
  const ground = Math.hypot(dx, dz);
  const tilt = Math.atan2(height - 1.1, ground);
  const slant = Math.hypot(ground, height - 1.1);
  const focal = req.pxPerMetre * slant;
  const fov = clampNum(2 * Math.atan((v.h * 0.5) / Math.max(1, focal)), 0.055, 1.15);
  const yaw = Math.atan2(dx, dz);
  return { x: cx, z: cz, h: height, yaw, tilt, fov, shake: 0, horizon: 0.52, roll: 0 };
}

/* ---------------- REPLAY RIGS ---------------- */

/** Orbiting super-slow rig: circles the subject at chest height. */
export function orbitCam(_v: View, tx: number, tz: number, ang: number, radius: number, height: number, pxPerMetre: number): Camera {
  const cx = tx + Math.sin(ang) * radius;
  const cz = tz + Math.cos(ang) * radius;
  const ground = radius || 1;
  const tilt = Math.atan2(height - 1.1, ground);
  const slant = Math.hypot(ground, height - 1.1);
  const focal = pxPerMetre * slant;
  const fov = clampNum(2 * Math.atan((420 * 0.5) / Math.max(1, focal)), 0.10, 1.2);
  return { x: cx, z: cz, h: height, yaw: Math.atan2(tx - cx, tz - cz), tilt, fov, shake: 0, horizon: 0.5, roll: 0 };
}

/** Low hero rig: knee-height, close, looking up at the paper cut-outs. */
export function heroLowCam(_v: View, tx: number, tz: number, ang: number, dist: number, pxPerMetre: number): Camera {
  const cx = tx + Math.sin(ang) * dist;
  const cz = tz + Math.cos(ang) * dist;
  const tilt = Math.atan2(1.15 - 0.9, dist);
  const slant = Math.hypot(dist, 0.5);
  const focal = pxPerMetre * slant;
  const fov = clampNum(2 * Math.atan((420 * 0.5) / Math.max(1, focal)), 0.14, 1.3);
  return { x: cx, z: cz, h: 1.05, yaw: Math.atan2(tx - cx, tz - cz), tilt, fov, shake: 0, horizon: 0.55, roll: 0 };
}

/** High wide tactical rig. */
export function highWideCam(v: View, tx: number, tz: number, dir: number, pxPerMetre: number): Camera {
  const cz = tz - dir * 34;
  const height = 30;
  const ground = 34;
  const tilt = Math.atan2(height - 1, ground);
  const slant = Math.hypot(ground, height);
  const focal = pxPerMetre * slant * 0.62;
  const fov = clampNum(2 * Math.atan((v.h * 0.5) / Math.max(1, focal)), 0.1, 1.2);
  return { x: tx * 0.4, z: cz, h: height, yaw: Math.atan2(tx * 0.6, tz - cz), tilt, fov, shake: 0, horizon: 0.46, roll: 0 };
}
