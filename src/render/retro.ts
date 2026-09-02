/**
 * RETRO RENDERER — 16-bit arcade sports look: chunky stocky actors, hard outlines,
 * flat two-tone cel fills, mown-stripe pitch, pixel crowd, advertising boards.
 * Camera is a true pinhole so cuts, dollies and orbits read as one continuous game.
 */

export const PIX = '#16161d';
export const OUT = '#20202b';

export const SKINS = ['#e8b98f', '#c99468', '#8c5a38', '#5f3a22', '#f2cfa8'];
export const HAIRS = ['#2a1c14', '#5a3a1e', '#8a6a2e', '#1a1a1a', '#c9c2b0', '#7a3a1e'];

export interface Palette { kit: string; kitDark: string; kitLight: string; trim: string; shorts: string; socks: string }

export const PALETTES: Record<string, Palette> = {
  A: { kit: '#c8402f', kitDark: '#8f281c', kitLight: '#e2664f', trim: '#f6e7c4', shorts: '#f0ece0', socks: '#c8402f' },
  B: { kit: '#2f4f9c', kitDark: '#1d3468', kitLight: '#5a7bc4', trim: '#e2dcc6', shorts: '#e8e4d6', socks: '#2f4f9c' },
  REF: { kit: '#e8cf46', kitDark: '#b39f27', kitLight: '#f5e479', trim: '#24242e', shorts: '#23232c', socks: '#e8cf46' },
};

/* ---------------- Camera ---------------- */
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

export const HOME_GOAL_Z = -58;
export const HOME_POST_Z = -50;

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

function clampNum(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * BROADCAST GANTRY — the rugby main camera.
 *
 * A real rugby outside broadcast puts Camera 1 on the touchline gantry: elevated,
 * set back from the field of play, tracking laterally along the line with a long
 * lens. Camera 3 sits near halfway for close-ups of the ball carrier, Camera 12
 * is the high-behind for shots at goal.
 *
 * This rig reproduces that. The yaw is angled slightly down-field rather than
 * square across the pitch, so a player running away from the camera is genuinely
 * seen from behind and one running toward it is seen from the front.
 */
export interface GantryRequest {
  /** the subject: normally the ball */
  tx: number; tz: number;
  /** metres of lead in the direction of attack */
  lead: number;
  dir: number;
  /** metres back from the near touchline */
  standback: number;
  height: number;
  pxPerMetre: number;
  /** lateral tracking dead zone, so the rig does not jitter */
  deadZone: number;
  /** the rig's own lateral position, so tracking can be eased by the caller */
  rigZ: number;
}

export function gantryCam(v: View, req: GantryRequest): { cam: Camera; rigZ: number } {
  // Lead the subject in the direction of attack, then apply the dead zone.
  const subjectZ = req.tz + req.lead * req.dir;
  let rigZ = req.rigZ;
  if (Math.abs(subjectZ - rigZ) > req.deadZone) {
    rigZ = rigZ + (subjectZ - rigZ) * clampNum(Math.abs(subjectZ - rigZ) / 6, 0.25, 1);
  }
  const rigX = FIELD.minX - req.standback;
  const dx = req.tx - rigX;
  const dz = subjectZ - rigZ;
  const ground = Math.hypot(dx, dz) || 1;
  // Look slightly down-field of square-across: 20 degrees off the touchline normal.
  const yaw = Math.atan2(dx, dz) + (20 * Math.PI) / 180 * (req.dir >= 0 ? 1 : -1);
  const tilt = Math.atan2(req.height - 1.4, ground);
  const slant = Math.hypot(ground, req.height - 1.4);
  const focal = req.pxPerMetre * slant;
  const fov = clampNum(2 * Math.atan((v.h * 0.5) / Math.max(1, focal)), 0.06, 1.2);
  return {
    cam: { x: rigX, z: rigZ, h: req.height, yaw, tilt, fov, shake: 0, horizon: 0.44, roll: 0 },
    rigZ,
  };
}

export function behindPostsCam(v: View, req: FrameRequest): Camera {
  const height = req.height ?? 14;
  const track = req.track ?? 0.28;
  const cx = req.tx * track;
  const cz = HOME_GOAL_Z;
  const dz = Math.max(6, req.tz - cz);
  const dx = req.tx - cx;
  const ground = Math.hypot(dx, dz);
  const tilt = Math.atan2(height - 1.1, ground);
  const slant = Math.hypot(ground, height - 1.1);
  const focal = req.pxPerMetre * slant;
  const fov = clampNum(2 * Math.atan((v.h * 0.5) / Math.max(1, focal)), 0.055, 1.15);
  const yaw = Math.atan2(dx, dz);
  return { x: cx, z: cz, h: height, yaw, tilt, fov, shake: 0, horizon: 0.52, roll: 0 };
}

/* ---------------- 3D GOAL POSTS ---------------- */
const POST_HALF = 2.8;
const CROSSBAR_Y = 3.0;
const POST_TOP = 11.0;
const POST_R = 0.16;

interface P3 { x: number; y: number; z: number }

type Ctx = CanvasRenderingContext2D;

function prism(
  ctx: Ctx, cam: Camera, v: View,
  a: P3, b: P3, rx: number, ry: number,
  front: string, side: string, top: string,
) {
  const corners = (p: P3): [P3, P3, P3, P3] => ([
    { x: p.x - rx, y: p.y - ry, z: p.z - rx },
    { x: p.x + rx, y: p.y - ry, z: p.z - rx },
    { x: p.x + rx, y: p.y + ry, z: p.z + rx },
    { x: p.x - rx, y: p.y + ry, z: p.z + rx },
  ]);
  const A = corners(a), B = corners(b);
  const pr = (p: P3) => project(cam, v, p.x, p.y, p.z);
  const q = (p0: P3, p1: P3, p2: P3, p3: P3, fill: string) => {
    const s0 = pr(p0), s1 = pr(p1), s2 = pr(p2), s3 = pr(p3);
    if (!s0 || !s1 || !s2 || !s3) return;
    poly(ctx, [[s0.sx, s0.sy], [s1.sx, s1.sy], [s2.sx, s2.sy], [s3.sx, s3.sy]], fill, OUT, 1.6);
  };
  q(A[1], B[1], B[2], A[2], side);
  q(A[0], B[0], B[1], A[1], front);
  q(B[0], B[1], B[2], B[3], top);
}

export function drawGoalPosts(ctx: Ctx, cam: Camera, v: View, z: number, near: boolean) {
  const white = near ? '#f4f2e6' : '#e6e4d6';
  const shade = near ? '#c9c6b6' : '#bdbbad';
  const cap = near ? '#fdfbf0' : '#efeee2';
  for (const sx of [-POST_HALF, POST_HALF]) {
    prism(ctx, cam, v, { x: sx, y: 0, z }, { x: sx, y: 2.0, z }, POST_R * 1.9, 0, '#2a2f3c', '#1e2230', '#343a48');
    prism(ctx, cam, v, { x: sx, y: 2.0, z }, { x: sx, y: POST_TOP, z }, POST_R, 0, white, shade, cap);
  }
  prism(ctx, cam, v, { x: -POST_HALF, y: CROSSBAR_Y, z }, { x: POST_HALF, y: CROSSBAR_Y, z }, 0, POST_R, white, shade, cap);
  const bl = project(cam, v, -POST_HALF, CROSSBAR_Y + POST_R, z);
  const br = project(cam, v, POST_HALF, CROSSBAR_Y + POST_R, z);
  const bl2 = project(cam, v, -POST_HALF, CROSSBAR_Y - POST_R, z);
  const br2 = project(cam, v, POST_HALF, CROSSBAR_Y - POST_R, z);
  if (bl && br && bl2 && br2) {
    poly(ctx, [[bl.sx, bl.sy], [br.sx, br.sy], [br2.sx, br2.sy], [bl2.sx, bl2.sy]], white, OUT, 1.8);
  }
}

/* ---------------- Low-level painters ---------------- */
export function poly(ctx: Ctx, pts: [number, number][], fill: string, stroke?: string, lw = 3) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
}

export function ball(ctx: Ctx, x: number, y: number, r: number, spin: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.45, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f3ede0'; ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.28); ctx.strokeStyle = OUT; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 1.1, 0); ctx.lineTo(r * 1.1, 0);
  ctx.lineWidth = Math.max(1, r * 0.2); ctx.strokeStyle = '#b8562f'; ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-r * 0.45, 0, r * 0.36, r * 0.24, 0, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.16); ctx.strokeStyle = '#3b3b46'; ctx.stroke();
  ctx.restore();
}

/* ---------------- WORLD-SPACE LINE PAINTING ---------------- */
export function worldLine(
  ctx: Ctx, cam: Camera, v: View,
  x0: number, z0: number, x1: number, z1: number,
  widthM: number, colour: string, alpha = 1, y = 0.012,
) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return;
  const nx = (-dz / len) * widthM * 0.5;
  const nz = (dx / len) * widthM * 0.5;
  const segs = Math.max(2, Math.min(48, Math.ceil(len / 3)));
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const px = x0 + dx * t, pz = z0 + dz * t;
    const a = project(cam, v, px + nx, y, pz + nz);
    const b = project(cam, v, px - nx, y, pz - nz);
    if (a) left.push([a.sx, a.sy]);
    if (b) right.push([b.sx, b.sy]);
  }
  if (left.length < 2 || right.length < 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

export function worldDashed(
  ctx: Ctx, cam: Camera, v: View,
  x0: number, z0: number, x1: number, z1: number,
  widthM: number, colour: string, alpha: number, dashM: number, gapM: number, y = 0.012,
) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const step = dashM + gapM;
  const n = Math.floor(len / step);
  for (let i = 0; i <= n; i++) {
    const t0 = (i * step) / len;
    const t1 = Math.min(1, (i * step + dashM) / len);
    if (t0 >= 1) break;
    worldLine(ctx, cam, v, x0 + dx * t0, z0 + dz * t0, x0 + dx * t1, z0 + dz * t1, widthM, colour, alpha, y);
  }
}

/* ---------------- Pitch & stadium ---------------- */
export const FIELD = {
  minX: -35, maxX: 35,
  tryZ: -50, tryZFar: 50,
  deadZ: -62, deadZFar: 62,
  postsX: [-3.1, 3.1],
};

const GRASS_A = '#3f7f39';
const GRASS_B = '#387433';
const LINE = '#eef2e2';

function rand(seed: number) { const x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); }

export interface PitchConditions {
  firm: number;       // 0 soft .. 1 firm
  wear: number;       // 0 pristine .. 1 cut up
  grassA: string; grassB: string;
}

export function pitchConditions(kind: string): PitchConditions {
  switch (kind) {
    case 'FIRM': return { firm: 0.95, wear: 0.05, grassA: '#478a41', grassB: '#3f7f39' };
    case 'SOFT': return { firm: 0.35, wear: 0.4, grassA: '#3a7534', grassB: '#346c2f' };
    case 'MUDDY': return { firm: 0.18, wear: 0.72, grassA: '#33612d', grassB: '#2d5928' };
    case 'FROZEN': return { firm: 1.0, wear: 0.1, grassA: '#4d8f47', grassB: '#457f3f' };
    default: return { firm: 0.7, wear: 0.18, grassA: GRASS_A, grassB: GRASS_B };
  }
}
const GRASS = GRASS_A;

export function drawStadium(ctx: Ctx, cam: Camera, v: View, t: number, cond?: PitchConditions) {
  const PC = cond ?? pitchConditions('STANDARD');
  ctx.fillStyle = '#1a2132';
  ctx.fillRect(0, 0, v.w, v.h);

  const drawTerrace = (
    x0: number, z0: number, x1: number, z1: number, outward: [number, number], seed: number,
  ) => {
    const TIERS = 6;
    for (let tier = 0; tier < TIERS; tier++) {
      const inset = tier * 3.4;
      const rise = 1.6 + tier * 2.3;
      const rise2 = 1.6 + (tier + 1) * 2.3;
      const ax = x0 + outward[0] * inset, az = z0 + outward[1] * inset;
      const bx = x1 + outward[0] * inset, bz = z1 + outward[1] * inset;
      const cx = x1 + outward[0] * (inset + 3.4), cz = z1 + outward[1] * (inset + 3.4);
      const dx2 = x0 + outward[0] * (inset + 3.4), dz2 = z0 + outward[1] * (inset + 3.4);
      const A = project(cam, v, ax, rise, az);
      const B = project(cam, v, bx, rise, bz);
      const C = project(cam, v, cx, rise2, cz);
      const Dp = project(cam, v, dx2, rise2, dz2);
      if (!A || !B || !C || !Dp) continue;
      poly(ctx, [[A.sx, A.sy], [B.sx, B.sy], [C.sx, C.sy], [Dp.sx, Dp.sy]],
        tier % 2 === 0 ? '#2b3752' : '#26314a');
      const n = 46;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const px = ax + (bx - ax) * u + outward[0] * 1.7;
        const pz = az + (bz - az) * u + outward[1] * 1.7;
        const P = project(cam, v, px, rise + 0.9, pz);
        if (!P) continue;
        const sd = seed * 977 + tier * 131 + i;
        const flick = rand(sd + Math.floor(t * 1.1) * 17);
        if (flick > 0.5) continue;
        ctx.fillStyle = flick < 0.14 ? '#d8d3c0' : flick < 0.28 ? '#c8402f' : flick < 0.4 ? '#2f4f9c' : '#8d94a8';
        const s = Math.max(1.5, P.sc * 0.055);
        ctx.fillRect(P.sx - s / 2, P.sy - s / 2, s, s);
      }
    }
  };
  drawTerrace(FIELD.minX - 6, FIELD.deadZ - 6, FIELD.minX - 6, FIELD.deadZFar + 6, [-1, 0], 1);
  drawTerrace(FIELD.maxX + 6, FIELD.deadZFar + 6, FIELD.maxX + 6, FIELD.deadZ - 6, [1, 0], 2);
  drawTerrace(FIELD.minX - 6, FIELD.deadZ - 6, FIELD.maxX + 6, FIELD.deadZ - 6, [0, -1], 3);
  drawTerrace(FIELD.maxX + 6, FIELD.deadZFar + 6, FIELD.minX - 6, FIELD.deadZFar + 6, [0, 1], 4);

  const boardY = 1.0;
  const segs = 30;
  for (const side of [FIELD.minX - 3.5, FIELD.maxX + 3.5]) {
    for (let i = 0; i < segs; i++) {
      const z0 = FIELD.deadZ + (i * (FIELD.deadZFar - FIELD.deadZ) / segs);
      const z1 = z0 + (FIELD.deadZFar - FIELD.deadZ) / segs - 0.3;
      const a = project(cam, v, side, boardY, z0);
      const b = project(cam, v, side, boardY, z1);
      const c = project(cam, v, side, 0, z1);
      const dd = project(cam, v, side, 0, z0);
      if (!a || !b || !c || !dd) continue;
      const cols = ['#1f2a44', '#2b3a5e', '#8f281c', '#1f2a44', '#c8402f', '#243050'];
      poly(ctx, [[a.sx, a.sy], [b.sx, b.sy], [c.sx, c.sy], [dd.sx, dd.sy]], cols[i % cols.length], OUT, 1.6);
    }
  }

  const stripes = 24;
  const zSpan = FIELD.deadZFar - FIELD.deadZ;
  for (let i = 0; i < stripes; i++) {
    const z0 = FIELD.deadZ + (i * zSpan / stripes);
    const z1 = z0 + zSpan / stripes;
    const near = project(cam, v, FIELD.minX, 0, z0);
    const far = project(cam, v, FIELD.maxX, 0, z0);
    const near2 = project(cam, v, FIELD.minX, 0, z1);
    const far2 = project(cam, v, FIELD.maxX, 0, z1);
    if (!near || !far || !near2 || !far2) continue;
    poly(ctx, [[near.sx, near.sy], [far.sx, far.sy], [far2.sx, far2.sy], [near2.sx, near2.sy]], i % 2 === 0 ? PC.grassA : PC.grassB);
  }
  // wear: mud chewed up around the middle of the park
  ctx.globalAlpha = 0.16 + PC.wear * 0.4;
  for (let i = 0; i < 260; i++) {
    const cxw = (rand(i * 3) - 0.5) * 26;
    const czw = (rand(i * 3 + 7) - 0.5) * 44;
    const r = 0.8 + rand(i * 5 + 3) * 2.6;
    const p = project(cam, v, cxw, 0.008, czw);
    if (!p) continue;
    ctx.fillStyle = i % 4 === 0 ? '#6a5940' : '#5a5238';
    ctx.beginPath(); ctx.ellipse(p.sx, p.sy, p.sc * r, p.sc * r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 900; i++) {
    const zz = FIELD.deadZ + rand(i) * zSpan;
    const xx = FIELD.minX + rand(i + 99) * (FIELD.maxX - FIELD.minX);
    const p = project(cam, v, xx, 0, zz);
    if (!p) continue;
    ctx.fillStyle = i % 3 === 0 ? '#ffffff' : '#000000';
    ctx.fillRect(p.sx, p.sy, 2, 2);
  }
  ctx.globalAlpha = 1;

  worldLine(ctx, cam, v, FIELD.minX, FIELD.tryZ, FIELD.minX, FIELD.tryZFar, 0.20, LINE, 0.95);
  worldLine(ctx, cam, v, FIELD.maxX, FIELD.tryZ, FIELD.maxX, FIELD.tryZFar, 0.20, LINE, 0.95);
  for (const z of [FIELD.tryZ, FIELD.tryZFar]) worldLine(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.22, LINE, 1);
  for (const z of [FIELD.deadZ, FIELD.deadZFar]) worldLine(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.16, LINE, 0.8);
  worldLine(ctx, cam, v, FIELD.minX, 0, FIELD.maxX, 0, 0.20, LINE, 0.95);
  for (const z of [-28, 28]) worldLine(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.18, LINE, 0.9);
  for (const z of [-10, 10]) worldDashed(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.16, LINE, 0.75, 2.0, 1.4);
  for (const x of [FIELD.minX + 5, FIELD.minX + 15, FIELD.maxX - 15, FIELD.maxX - 5]) {
    worldDashed(ctx, cam, v, x, FIELD.tryZ, x, FIELD.tryZFar, 0.13, LINE, 0.5, 1.6, 1.6);
  }
  for (const z of [-28, 0, 28]) {
    for (const x of [FIELD.minX + 5, FIELD.minX + 15, FIELD.maxX - 15, FIELD.maxX - 5]) {
      worldLine(ctx, cam, v, x, z - 0.6, x, z + 0.6, 0.30, LINE, 0.85);
    }
  }

  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(0, 0, v.w, v.h * 0.10);
  ctx.fillRect(0, v.h * 0.90, v.w, v.h * 0.10);
}

/* ---------------- Post effects ---------------- */
export function drawCRT(ctx: Ctx, v: View, intensity = 1) {
  ctx.globalAlpha = 0.055 * intensity;
  ctx.fillStyle = '#000';
  for (let y = 0; y < v.h; y += 3) ctx.fillRect(0, y, v.w, 1);
  ctx.globalAlpha = 0.05 * intensity;
  const g = ctx.createLinearGradient(0, 0, v.w, 0);
  g.addColorStop(0, 'rgba(255,0,0,1)'); g.addColorStop(0.5, 'rgba(0,255,0,1)'); g.addColorStop(1, 'rgba(0,0,255,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, v.w, v.h);
  ctx.globalAlpha = 1;
}

void PIX; void GRASS;
