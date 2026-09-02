/**
 * SCENE — stadium, match simulation and paper-actor presentation.
 *
 * The sim drives actor roots in 3D world space; every drawn cut-out is a
 * billboard whose artwork side is chosen PER ACTOR from the signed angle
 * between that actor's own facing and the camera (see paper.updatePaperView).
 * Game phases: SCRUM, LINEOUT, KICK, OPEN_PLAY, MAUL, BREAKDOWN + REPLAY rigs.
 */

import {
  Palette, PALETTES, PaperView, Character, makeCharacter, makeRef, poly,
  paperViewKey, updatePaperView, resetPaperViews, ballPaper, shadowBlob, MONO,
} from './paper';
import {
  Camera, View, project, camRight, chaseCam, gantryCam, behindPostsCam, orbitCam, heroLowCam, highWideCam,
} from './rig';
import { Pose, STAND, sampleC, lerpPose, smooth, actionClip, CLIPS } from './clips';
import { drawPaperActor, drawPaperShadow, PaperDrawArgs } from './coronal';

export const FIELD = {
  minX: -35, maxX: 35,
  tryZ: -50, tryZFar: 50,
  deadZ: -62, deadZFar: 62,
};

const OUT = '#20202b';
const LINE = '#eef2e2';

function rand(seed: number) { const x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); }
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

export interface PitchConditions { firm: number; wear: number; grassA: string; grassB: string }
export function pitchConditions(kind: string): PitchConditions {
  switch (kind) {
    case 'FIRM': return { firm: 0.95, wear: 0.05, grassA: '#478a41', grassB: '#3f7f39' };
    case 'SOFT': return { firm: 0.35, wear: 0.4, grassA: '#3a7534', grassB: '#346c2f' };
    case 'MUDDY': return { firm: 0.18, wear: 0.72, grassA: '#33612d', grassB: '#2d5928' };
    case 'FROZEN': return { firm: 1.0, wear: 0.1, grassA: '#4d8f47', grassB: '#457f3f' };
    default: return { firm: 0.7, wear: 0.18, grassA: '#3f7f39', grassB: '#387433' };
  }
}

/* ---------------- world-space line painting ---------------- */
export function worldLine(ctx: Ctx2, cam: Camera, v: View, x0: number, z0: number, x1: number, z1: number, widthM: number, colour: string, alpha = 1, y = 0.012) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return;
  const nx = (-dz / len) * widthM * 0.5, nz = (dx / len) * widthM * 0.5;
  const segs = clamp(Math.ceil(len / 3), 2, 48);
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const px = x0 + dx * t, pz = z0 + dz * t;
    const a = project(cam, v, px + nx, y, pz + nz);
    const b = project(cam, v, px - nx, y, pz - nz);
    if (a) left.push([a.sx, a.sy]);
    if (b) right.push([b.sx, b.sy]);
  }
  if (left.length < 2 || right.length < 2) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = colour; ctx.fill();
  ctx.restore();
}
type Ctx2 = CanvasRenderingContext2D;

export function worldDashed(ctx: Ctx2, cam: Camera, v: View, x0: number, z0: number, x1: number, z1: number, widthM: number, colour: string, alpha: number, dashM: number, gapM: number) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const step = dashM + gapM;
  const n = Math.floor(len / step);
  for (let i = 0; i <= n; i++) {
    const t0 = (i * step) / len;
    const t1 = Math.min(1, (i * step + dashM) / len);
    if (t0 >= 1) break;
    worldLine(ctx, cam, v, x0 + dx * t0, z0 + dz * t0, x0 + dx * t1, z0 + dz * t1, widthM, colour, alpha);
  }
}

/* ---------------- goal posts ---------------- */
const POST_HALF = 2.8, CROSSBAR_Y = 3.0, POST_TOP = 11.0, POST_R = 0.16;
interface P3 { x: number; y: number; z: number }

function prism(ctx: Ctx2, cam: Camera, v: View, a: P3, b: P3, rx: number, ry: number, front: string, side: string, top: string) {
  const corners = (p: P3): [P3, P3, P3, P3] => ([
    { x: p.x - rx, y: p.y - ry, z: p.z - rx }, { x: p.x + rx, y: p.y - ry, z: p.z - rx },
    { x: p.x + rx, y: p.y + ry, z: p.z + rx }, { x: p.x - rx, y: p.y + ry, z: p.z + rx },
  ]);
  const A = corners(a), B = corners(b);
  const pr = (p: P3) => project(cam, v, p.x, p.y, p.z);
  const q = (p0: P3, p1: P3, p2: P3, p3: P3, fill: string) => {
    const s0 = pr(p0), s1 = pr(p1), s2 = pr(p2), s3 = pr(p3);
    if (!s0 || !s1 || ! s2 || !s3) return;
    poly(ctx, [[s0.sx, s0.sy], [s1.sx, s1.sy], [s2.sx, s2.sy], [s3.sx, s3.sy]], fill, OUT, 1.6);
  };
  q(A[1], B[1], B[2], A[2], side);
  q(A[0], B[0], B[1], A[1], front);
  q(B[0], B[1], B[2], B[3], top);
}

export function drawGoalPosts(ctx: Ctx2, cam: Camera, v: View, z: number, near: boolean) {
  const white = near ? '#f4f2e6' : '#e6e4d6';
  const sh = near ? '#c9c6b6' : '#bdbbad';
  const cap = near ? '#fdfbf0' : '#efeee2';
  for (const sx of [-POST_HALF, POST_HALF]) {
    prism(ctx, cam, v, { x: sx, y: 0, z }, { x: sx, y: 2.0, z }, POST_R * 1.9, 0, '#2a2f3c', '#1e2230', '#343a48');
    prism(ctx, cam, v, { x: sx, y: 2.0, z }, { x: sx, y: POST_TOP, z }, POST_R, 0, white, sh, cap);
  }
  prism(ctx, cam, v, { x: -POST_HALF, y: CROSSBAR_Y, z }, { x: POST_HALF, y: CROSSBAR_Y, z }, 0, POST_R, white, sh, cap);
  const bl = project(cam, v, -POST_HALF, CROSSBAR_Y + POST_R, z);
  const br = project(cam, v, POST_HALF, CROSSBAR_Y + POST_R, z);
  const bl2 = project(cam, v, -POST_HALF, CROSSBAR_Y - POST_R, z);
  const br2 = project(cam, v, POST_HALF, CROSSBAR_Y - POST_R, z);
  if (bl && br && bl2 && br2) poly(ctx, [[bl.sx, bl.sy], [br.sx, br.sy], [br2.sx, br2.sy], [bl2.sx, bl2.sy]], white, OUT, 1.8);
}

/* ---------------- stadium ---------------- */
export function drawStadium(ctx: Ctx2, cam: Camera, v: View, t: number, cond?: PitchConditions) {
  const PC = cond ?? pitchConditions('STANDARD');
  ctx.fillStyle = '#1a2132';
  ctx.fillRect(0, 0, v.w, v.h);

  const drawTerrace = (x0: number, z0: number, x1: number, z1: number, outward: [number, number], seed: number) => {
    for (let tier = 0; tier < 6; tier++) {
      const inset = tier * 3.4;
      const rise = 1.6 + tier * 2.3, rise2 = 1.6 + (tier + 1) * 2.3;
      const ax = x0 + outward[0] * inset, az = z0 + outward[1] * inset;
      const bx = x1 + outward[0] * inset, bz = z1 + outward[1] * inset;
      const cx = x1 + outward[0] * (inset + 3.4), cz = z1 + outward[1] * (inset + 3.4);
      const dx2 = x0 + outward[0] * (inset + 3.4), dz2 = z0 + outward[1] * (inset + 3.4);
      const A = project(cam, v, ax, rise, az), B = project(cam, v, bx, rise, bz);
      const C = project(cam, v, cx, rise2, cz), Dp = project(cam, v, dx2, rise2, dz2);
      if (!A || !B || !C || !Dp) continue;
      poly(ctx, [[A.sx, A.sy], [B.sx, B.sy], [C.sx, C.sy], [Dp.sx, Dp.sy]], tier % 2 === 0 ? '#2b3752' : '#26314a');
      const n = 46;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const px = ax + (bx - ax) * u + outward[0] * 1.7;
        const pz = az + (bz - az) * u + outward[1] * 1.7;
        const Pt = project(cam, v, px, rise + 0.9, pz);
        if (!Pt) continue;
        const flick = rand(seed * 977 + tier * 131 + i + Math.floor(t * 1.1) * 17);
        if (flick > 0.5) continue;
        ctx.fillStyle = flick < 0.14 ? '#d8d3c0' : flick < 0.28 ? '#c8402f' : flick < 0.4 ? '#2f4f9c' : '#8d94a8';
        const s = Math.max(1.5, Pt.sc * 0.055);
        ctx.fillRect(Pt.sx - s / 2, Pt.sy - s / 2, s, s);
      }
    }
  };
  drawTerrace(FIELD.minX - 6, FIELD.deadZ - 6, FIELD.minX - 6, FIELD.deadZFar + 6, [-1, 0], 1);
  drawTerrace(FIELD.maxX + 6, FIELD.deadZFar + 6, FIELD.maxX + 6, FIELD.deadZ - 6, [1, 0], 2);
  drawTerrace(FIELD.minX - 6, FIELD.deadZ - 6, FIELD.maxX + 6, FIELD.deadZ - 6, [0, -1], 3);
  drawTerrace(FIELD.maxX + 6, FIELD.deadZFar + 6, FIELD.minX - 6, FIELD.deadZFar + 6, [0, 1], 4);

  const segs = 30;
  for (const side of [FIELD.minX - 3.5, FIELD.maxX + 3.5]) {
    for (let i = 0; i < segs; i++) {
      const z0 = FIELD.deadZ + (i * (FIELD.deadZFar - FIELD.deadZ) / segs);
      const z1 = z0 + (FIELD.deadZFar - FIELD.deadZ) / segs - 0.3;
      const a = project(cam, v, side, 1.0, z0), b = project(cam, v, side, 1.0, z1);
      const c = project(cam, v, side, 0, z1), dd = project(cam, v, side, 0, z0);
      if (!a || !b || !c || !dd) continue;
      const cols = ['#1f2a44', '#2b3a5e', '#8f281c', '#1f2a44', '#c8402f', '#243050'];
      poly(ctx, [[a.sx, a.sy], [b.sx, b.sy], [c.sx, c.sy], [dd.sx, dd.sy]], cols[i % cols.length], OUT, 1.6);
    }
  }

  const stripes = 24;
  const zSpan = FIELD.deadZFar - FIELD.deadZ;
  for (let i = 0; i < stripes; i++) {
    const z0 = FIELD.deadZ + (i * zSpan / stripes), z1 = z0 + zSpan / stripes;
    const n0 = project(cam, v, FIELD.minX, 0, z0), f0 = project(cam, v, FIELD.maxX, 0, z0);
    const n1 = project(cam, v, FIELD.minX, 0, z1), f1 = project(cam, v, FIELD.maxX, 0, z1);
    if (!n0 || !f0 || !n1 || !f1) continue;
    poly(ctx, [[n0.sx, n0.sy], [f0.sx, f0.sy], [f1.sx, f1.sy], [n1.sx, n1.sy]], i % 2 === 0 ? PC.grassA : PC.grassB);
  }
  ctx.globalAlpha = 0.16 + PC.wear * 0.4;
  for (let i = 0; i < 260; i++) {
    const cxw = (rand(i * 3) - 0.5) * 26, czw = (rand(i * 3 + 7) - 0.5) * 44;
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

  worldLine(ctx, cam, v, FIELD.minX, FIELD.tryZ, FIELD.minX, FIELD.tryZFar, 0.2, LINE, 0.95);
  worldLine(ctx, cam, v, FIELD.maxX, FIELD.tryZ, FIELD.maxX, FIELD.tryZFar, 0.2, LINE, 0.95);
  for (const z of [FIELD.tryZ, FIELD.tryZFar]) worldLine(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.22, LINE, 1);
  for (const z of [FIELD.deadZ, FIELD.deadZFar]) worldLine(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.16, LINE, 0.8);
  worldLine(ctx, cam, v, FIELD.minX, 0, FIELD.maxX, 0, 0.2, LINE, 0.95);
  for (const z of [-28, 28]) worldLine(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.18, LINE, 0.9);
  for (const z of [-10, 10]) worldDashed(ctx, cam, v, FIELD.minX, z, FIELD.maxX, z, 0.16, LINE, 0.75, 2.0, 1.4);
  for (const x of [FIELD.minX + 5, FIELD.minX + 15, FIELD.maxX - 15, FIELD.maxX - 5]) {
    worldDashed(ctx, cam, v, x, FIELD.tryZ, x, FIELD.tryZFar, 0.13, LINE, 0.5, 1.6, 1.6);
  }
  for (const z of [-28, 0, 28]) for (const x of [FIELD.minX + 5, FIELD.minX + 15, FIELD.maxX - 15, FIELD.maxX - 5]) {
    worldLine(ctx, cam, v, x, z - 0.6, x, z + 0.6, 0.3, LINE, 0.85);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.fillRect(0, 0, v.w, v.h * 0.1);
  ctx.fillRect(0, v.h * 0.9, v.w, v.h * 0.1);
}

export function drawCRT(ctx: Ctx2, v: View, intensity = 1) {
  ctx.globalAlpha = 0.055 * intensity;
  ctx.fillStyle = '#000';
  for (let y = 0; y < v.h; y += 3) ctx.fillRect(0, y, v.w, 1);
  ctx.globalAlpha = 0.05 * intensity;
  const g = ctx.createLinearGradient(0, 0, v.w, 0);
  g.addColorStop(0, 'rgba(255,0,0,1)'); g.addColorStop(0.5, 'rgba(0,255,0,1)'); g.addColorStop(1, 'rgba(0,80,255,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, v.w, v.h);
  ctx.globalAlpha = 1;
}

/* ================================================================== */
/* ACTORS + MATCH                                                      */
/* ================================================================== */

export type Team = 'A' | 'B' | 'REF';
export type Phase = 'SCRUM' | 'LINEOUT' | 'KICK' | 'OPEN_PLAY' | 'MAUL' | 'BREAKDOWN' | 'REPLAY';

export interface Actor {
  id: number; team: Team; ch: Character;
  x: number; z: number; vx: number; vz: number;
  face: number; rf: number;
  action: string; clipName: string; u: number;
  pose: Pose; blendFrom: Pose | null; blendT: number; blendDur: number;
  down: boolean; fallDir: number; getUp: number;
  carry: boolean; carryStyle: number;
  role: string; tgt: [number, number]; cap: number;
  seed: number; view: PaperView; cd: number; phase: number;
}

interface Snap { t: number; d: Float32Array }

export interface BallState {
  x: number; z: number; y: number;
  vx: number; vy: number; vz: number;
  mode: 'held' | 'loose' | 'fly' | 'pass';
  holder: Actor | null;
  spin: number;
  tgt: Actor | null;
}

export interface Input { left: boolean; right: boolean; space: boolean; held: boolean; spaceHit: boolean }

const PER_ACTOR = 26; // x,z,face,carry,carryStyle,spin? + 22 pose - a few
const POSE_N = 22;

export class Game {
  actors: Actor[] = [];
  ball: BallState = { x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0, mode: 'held', holder: null, spin: 0, tgt: null };
  phase: Phase = 'KICK';
  kind = 'KICK_OFF';
  stage = 'TEE';
  phaseT = 0;
  score = { A: 0, B: 0 };
  clock = 0; half = 1; over = false;
  poss: 'A' | 'B' = 'A';
  rx = 0; rz = 0;
  dirA = 1; // team A attacks +z
  cam: Camera; rigZ = 0; zoom = 0.35; camName = 'GANTRY 1';
  shake = 0; time = 0;
  banner = { text: '', sub: '', t: 9 };
  prompt: { text: string; keys: string; t: number; total: number } | null = null;
  stats = { possA: 50, metA: 0, metB: 0, takA: 0, takB: 0, ruckA: 0, ruckB: 0, toA: 0, toB: 0 };
  cond = pitchConditions('STANDARD');
  input: Input = { left: false, right: false, space: false, held: false, spaceHit: false };
  speed = 1; paused = false;
  focusId = 9;
  replay: { active: boolean; t: number; mark: number; variant: number } = { active: false, t: 0, mark: 0, variant: 0 };
  buf: Snap[] = [];
  ruckPower = 0.5;
  gapX = 0;
  kickQuality = 0;
  pending: { phase: Phase; kind?: string; t: number } | null = null;
  stepTimer = 0;
  passCd = 0;

  constructor() {
    let id = 0;
    for (const team of ['A', 'B'] as const) for (let num = 1; num <= 15; num++) {
      this.actors.push(this.mk(id++, team, makeCharacter(team, num)));
    }
    this.actors.push(this.mk(id++, 'REF', makeRef()));
    this.cam = gantryCam({ w: 800, h: 450 }, { tx: 0, tz: 0, lead: 0, dir: 1, standback: 14, height: 10, pxPerMetre: 26, deadZone: 2, rigZ: 0 }).cam;
    resetPaperViews();
    this.setupKick('KICK_OFF', 'A');
    this.banner = { text: 'KICK OFF', sub: 'ENG TO GET THE GAME UNDER WAY', t: 0 };
  }

  private mk(id: number, team: Team, ch: Character): Actor {
    return {
      id, team, ch, x: 0, z: 0, vx: 0, vz: 0, face: team === 'A' ? 0 : Math.PI, rf: team === 'A' ? 0 : Math.PI,
      action: 'idle', clipName: 'idle', u: rand(id) , pose: { ...STAND }, blendFrom: null, blendT: 1, blendDur: 0.2,
      down: false, fallDir: 1, getUp: 0, carry: false, carryStyle: 0, role: '', tgt: [0, 0],
      cap: 6 + (ch.pos === 'WING' ? 2.6 : ch.pos === 'PROP' ? -1.4 : ch.pos === 'LOCK' ? -0.6 : ch.pos === 'HALF' ? 1.2 : 0.4),
      seed: id * 7.3 + 3, view: 'front', cd: 0, phase: rand(id * 3) * 6.28,
    };
  }

  team(t: Team) { return this.actors.filter(a => a.team === t); }
  dirOf(t: 'A' | 'B') { return t === 'A' ? this.dirA : -this.dirA; }
  pal(t: Team): Palette { return PALETTES[t]; }

  setBanner(text: string, sub = '') { this.banner = { text, sub, t: 0 }; }

  /* ---------------- setup helpers ---------------- */
  private place(a: Actor, x: number, z: number, face?: number) {
    a.x = x; a.z = z; a.vx = 0; a.vz = 0;
    if (face !== undefined) { a.face = face; a.rf = face; }
    a.tgt = [x, z];
  }
  private packSlots(rx: number, rz: number, dir: number, i: number): [number, number] {
    const row = i < 3 ? 0 : i < 7 ? 1 : 2;
    const inRow = i < 3 ? 3 : i < 7 ? 4 : 1;
    const idx = i < 3 ? i : i < 7 ? i - 3 : 0;
    const x = (idx - (inRow - 1) / 2) * 1.05;
    return [rx + x, rz - dir * (row * 1.05)];
  }

  setupKick(kind: string, kicking: 'A' | 'B') {
    this.phase = 'KICK'; this.kind = kind; this.phaseT = 0; this.stage = 'TEE';
    const dir = this.dirOf(kicking);
    const z = kind === 'KICK_OFF' ? 0 : this.rz;
    const x = kind === 'KICK_OFF' ? 0 : clamp(this.rx, -22, 22);
    this.rx = x; this.rz = z;
    this.poss = kicking;
    this.ball.mode = 'loose'; this.ball.holder = null;
    this.ball.x = x; this.ball.z = z + dir * 0.2; this.ball.y = kind === 'KICK_OFF' ? 0.35 : 0.25;
    this.ball.vx = 0; this.ball.vy = 0; this.ball.vz = 0;
    for (const a of this.actors) {
      a.down = false; a.carry = false; a.action = 'idle';
      if (a.team === 'REF') { this.place(a, x + 6, z - dir * 8, Math.atan2(x - (x + 6), z - (z - dir * 8)) * -1); continue; }
      const t = a.team as 'A' | 'B';
      const d = this.dirOf(t);
      const idx = this.team(t).indexOf(a);
      if (t === kicking) {
        if (idx === 14) { this.place(a, x - d * 1.5, z - d * 2.2, Math.atan2(d * 0.2, d)); a.role = 'kicker'; }
        else this.place(a, (idx - 7) * 4.2, z - d * (12 + (idx % 4) * 4), Math.atan2(0, d));
      } else {
        this.place(a, (idx - 7) * 4.6, z + d * (kind === 'KICK_OFF' ? 12 : 10) - d * 0 + (t === 'A' ? 0 : 0) + (this.dirOf(t) * 0), Math.atan2(0, -d));
        a.z = z - this.dirOf(t) * -1 * (kind === 'KICK_OFF' ? 12 : 10) * -1;
        a.z = z + (t === 'A' ? -1 : 1) * (kind === 'KICK_OFF' ? 12 : 10) * (kind === 'KICK_OFF' ? 1 : -1);
      }
      a.role = a.role || '';
    }
    // receiving side sits deep in their own half
    const rec: 'A' | 'B' = kicking === 'A' ? 'B' : 'A';
    const rd = this.dirOf(kicking);
    this.team(rec).forEach((a, i) => {
      const row = Math.floor(i / 5);
      this.place(a, (i % 5 - 2) * 7 + (row % 2) * 3, z + rd * (14 + row * 7), Math.atan2(0, -rd));
      a.role = 'receiver';
    });
    this.kickQuality = 0;
    this.prompt = kind === 'KICK_OFF'
      ? { text: 'STRIKE ON THE MARK', keys: 'SPACE', t: 0, total: 3.2 }
      : { text: 'STRIKE AT THE TOP OF THE APPROACH', keys: 'SPACE', t: 0, total: 3.2 };
  }

  setupScrum(rx: number, rz: number, putIn: 'A' | 'B') {
    this.phase = 'SCRUM'; this.phaseT = 0; this.stage = 'SET';
    this.rx = rx; this.rz = rz; this.poss = putIn;
    this.ball.mode = 'loose'; this.ball.holder = null; this.ball.x = rx; this.ball.z = rz; this.ball.y = 0.2;
    for (const t of ['A', 'B'] as const) {
      const d = this.dirOf(t);
      this.team(t).forEach((a, i) => {
        a.down = false; a.carry = false;
        if (i < 8) { const [x, z] = this.packSlots(rx, rz, d, i); this.place(a, x, z - d * 2.6, Math.atan2(0, d)); a.role = 'pack'; }
        else if (i === 8) { this.place(a, rx + (t === putIn ? -2.4 : 2.6), rz - d * 3.4, Math.atan2(0, d)); a.role = 'half'; }
        else { const spread = (i - 9) * 2.6 - 8; this.place(a, rx + spread * 0.9 + (t === 'A' ? -4 : 4), rz - d * (7 + (i - 9) * 1.4), Math.atan2(0, d)); a.role = 'back'; }
      });
    }
    this.place(this.actors[30], rx + 5, rz - 4, Math.atan2(-1, 0));
    this.prompt = { text: 'SHOVE AGAINST THE HEAD — TIME THE FEED', keys: 'SPACE', t: 0, total: 4 };
  }

  setupLineout(rx: number, rz: number, throwIn: 'A' | 'B') {
    this.phase = 'LINEOUT'; this.phaseT = 0; this.stage = 'ALIGN';
    this.rx = rx; this.rz = rz; this.poss = throwIn;
    this.ball.mode = 'loose'; this.ball.holder = null;
    const tx = rx > 0 ? FIELD.maxX : FIELD.minX;
    this.ball.x = tx; this.ball.z = rz; this.ball.y = 1;
    for (const t of ['A', 'B'] as const) {
      const d = this.dirOf(t);
      this.team(t).forEach((a, i) => {
        a.down = false; a.carry = false;
        if (i < 7) { this.place(a, rx + (i - 3) * 1.7, rz + (t === 'A' ? -0.8 : 0.8), Math.atan2(0, d)); a.role = i === 3 ? 'jumper' : i === 1 || i === 5 ? 'lifter' : 'pod'; }
        else if (i === 8) { this.place(a, tx - Math.sign(tx) * 1.5, rz - 2, Math.atan2(0, 1)); a.role = 'throw'; a.tgt = [rx - Math.sign(rx) * 0.5, rz - 1.5]; }
        else { this.place(a, rx + (i - 9) * 3 - 6, rz - d * (8 + (i - 9)), Math.atan2(0, d)); a.role = 'back'; }
      });
    }
    this.place(this.actors[30], rx + 6, rz + 3, Math.atan2(-1, 0));
    this.prompt = { text: 'CALL THE JUMP AT THE PEAK OF THE THROW', keys: 'SPACE', t: 0, total: 4 };
  }

  setupBreakdown(rx: number, rz: number, attacked: 'A' | 'B') {
    this.phase = 'BREAKDOWN'; this.phaseT = 0; this.stage = 'ARRIVING';
    this.rx = rx; this.rz = rz; this.poss = attacked;
    this.ruckPower = 0.5;
    this.prompt = { text: 'CLEAR OUT — COMMIT ONE MORE', keys: 'A / D  ·  SPACE', t: 0, total: 4.2 };
  }

  setupMaul(rx: number, rz: number, attacking: 'A' | 'B') {
    this.phase = 'MAUL'; this.phaseT = 0; this.stage = 'DRIVING';
    this.rx = rx; this.rz = rz; this.poss = attacking;
    this.prompt = { text: 'HOLD TO DRIVE — STEER WITH A / D', keys: 'HOLD SPACE', t: 0, total: 6 };
  }

  setupOpen(rx: number, rz: number, poss: 'A' | 'B', carrier?: Actor) {
    this.phase = 'OPEN_PLAY'; this.phaseT = 0; this.stage = 'LIVE';
    this.rx = rx; this.rz = rz; this.poss = poss;
    this.gapX = clamp(rx + (rand(this.time * 7) - 0.5) * 26, -26, 26);
    if (carrier) { this.giveBall(carrier); }
    this.prompt = { text: 'STEP WITH A / D — PASS WITH SPACE', keys: 'A / D · SPACE', t: 0, total: 99 };
  }

  giveBall(a: Actor) {
    if (this.ball.holder && this.ball.holder !== a) this.ball.holder.carry = false;
    this.ball.holder = a; a.carry = true; this.ball.mode = 'held';
    this.poss = a.team as 'A' | 'B';
    this.focusId = a.id;
  }

  /* ---------------- replay buffer ---------------- */
  private record() {
    const d = new Float32Array(this.actors.length * PER_ACTOR);
    this.actors.forEach((a, i) => {
      const o = i * PER_ACTOR;
      d[o] = a.x; d[o + 1] = a.z; d[o + 2] = a.face; d[o + 3] = a.carry ? 1 : 0; d[o + 4] = a.carryStyle;
      for (let k = 0; k < POSE_N; k++) d[o + 5 + k] = a.pose[(Object.keys(a.pose) as (keyof Pose)[])[k]];
    });
    this.buf.push({ t: this.time, d });
    if (this.buf.length > 260) this.buf.shift();
  }

  startReplay() {
    if (this.replay.active || this.buf.length < 40) return;
    this.replay = { active: true, t: Math.max(0, this.buf.length - 150), mark: 0, variant: 0 };
    this.camName = 'REPLAY ORBIT';
  }

  /* ---------------- phase resolution ---------------- */
  private tryScore(team: 'A' | 'B', scorer: Actor) {
    this.score[team] += 5;
    this.setBanner(`TRY — ${team === 'A' ? 'ENG' : 'NZL'}!`, `${scorer.ch.num} ${scorer.ch.name} GROUNDS IT`);
    this.stats[team === 'A' ? 'metA' : 'metB'] += 5;
    this.shake = 1;
    for (const a of this.team(team)) if (Math.hypot(a.x - scorer.x, a.z - scorer.z) < 14) { a.action = 'celebrate'; a.carry = a === scorer; }
    this.pending = { phase: 'KICK', kind: 'CONVERSION', t: 0 };
    this.phase = 'REPLAY'; this.phaseT = 0;
    this.replay = { active: true, t: Math.max(0, this.buf.length - 160), mark: 0, variant: 0 };
    this.convTeam = team; this.convX = clamp(scorer.x, -20, 20);
    this.convZ = (this.dirOf(team) > 0 ? FIELD.tryZFar : FIELD.tryZ) - this.dirOf(team) * 3;
  }
  convTeam: 'A' | 'B' = 'A'; convX = 0; convZ = 50;



  /* ---------------- UPDATE ---------------- */
  update(dt: number) {
    if (this.paused) return;
    dt *= this.speed;
    this.time += dt;
    this.banner.t += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.stepTimer > 0) this.stepTimer -= dt;
    if (this.passCd > 0) this.passCd -= dt;

    if (this.replay.active) { this.updateReplay(dt); this.input.spaceHit = false; return; }
    if (!this.over) this.clock += dt * 12;
    if (this.clock >= 2400 && this.half === 1) {
      this.half = 2; this.clock = 2400; this.dirA = -1;
      this.setBanner('HALF TIME', 'SIDES CHANGE ENDS');
      this.setupKick('KICK_OFF', this.score.A <= this.score.B ? 'A' : 'B');
    }
    if (this.clock >= 4800 && !this.over) {
      this.over = true;
      this.setBanner('FULL TIME', `${this.score.A} — ${this.score.B}`);
    }

    this.phaseT += dt;
    if (this.prompt) this.prompt.t += dt;
    switch (this.phase) {
      case 'KICK': this.upKick(dt); break;
      case 'SCRUM': this.upScrum(dt); break;
      case 'LINEOUT': this.upLineout(dt); break;
      case 'OPEN_PLAY': this.upOpen(dt); break;
      case 'BREAKDOWN': this.upBreakdown(dt); break;
      case 'MAUL': this.upMaul(dt); break;
      default: break;
    }
    if (this.pending && this.phaseT > this.pending.t) {
      const p = this.pending; this.pending = null;
      if (p.phase === 'KICK') this.setupKick(p.kind ?? 'KICK_OFF', this.poss);
    }
    this.moveActors(dt);
    this.upBall(dt);
    this.upPoses(dt);
    this.record();
    this.upCam(dt);
    this.input.spaceHit = false;
  }

  private updateReplay(dt: number) {
    const r = this.replay;
    r.t += dt * 30 * 0.35;
    r.mark += dt;
    if (r.mark > 2.8) { r.mark = 0; r.variant = (r.variant + 1) % 4; }
    const names = ['REPLAY ORBIT', 'REPLAY LOW HERO', 'REPLAY HIGH WIDE', 'REPLAY GANTRY'];
    this.camName = names[r.variant];
    if (r.t >= this.buf.length - 2 || this.input.spaceHit) {
      r.active = false;
      this.camName = 'GANTRY 1';
      if (this.pending) {
        const p = this.pending; this.pending = null;
        if (p.phase === 'KICK' && p.kind === 'CONVERSION') { this.rx = this.convX; this.rz = this.convZ; this.setupKick('CONVERSION', this.convTeam); }
        else if (p.phase === 'KICK') this.setupKick('KICK_OFF', this.convTeam === 'A' ? 'B' : 'A');
        else this.phase = p.phase;
      }
      else if (this.phase === 'REPLAY') this.phase = 'OPEN_PLAY';
    }
  }

  /* ---- KICK ---- */
  private upKick(dt: number) {
    void dt;
    const kicking = this.poss;
    const kicker = this.team(kicking).find(a => a.role === 'kicker') ?? this.team(kicking)[14];
    const dir = this.dirOf(kicking);
    if (this.stage === 'TEE') {
      kicker.tgt = [this.rx - dir * 0.0 - 1.2, this.rz - dir * 5];
      kicker.action = 'walk';
      if (this.phaseT > 1.1) { this.stage = 'APPROACH'; this.phaseT = 0; }
    } else if (this.stage === 'APPROACH') {
      const strike = 2.1;
      kicker.tgt = [this.rx, this.rz - dir * 0.6];
      kicker.action = this.phaseT > strike - 0.75 ? 'kick' : 'jog';
      if (this.input.spaceHit && this.phaseT < strike + 0.35) {
        this.kickQuality = 1 - clamp01(Math.abs(this.phaseT - strike) / 0.4);
        this.input.spaceHit = false;
      }
      if (this.phaseT > strike) {
        this.stage = 'FLIGHT'; this.phaseT = 0;
        const q = this.kickQuality;
        this.ball.mode = 'fly';
        this.ball.x = this.rx; this.ball.z = this.rz; this.ball.y = 0.3;
        if (this.kind === 'KICK_OFF') {
          this.ball.vz = dir * (18 + q * 6); this.ball.vx = (rand(this.time) - 0.5) * 6; this.ball.vy = 11 + q * 4;
        } else {
          this.ball.vz = 0; this.ball.vx = 0; this.ball.vy = 0;
        }
        kicker.action = 'kick';
      }
    } else if (this.stage === 'FLIGHT') {
      if (this.kind !== 'KICK_OFF') {
        // place kick at goal
        if (this.phaseT > 1.6) {
          const dz = Math.abs(this.rz - (dir > 0 ? FIELD.tryZFar : FIELD.tryZ));
          const chance = clamp01(this.kickQuality * 1.2 - dz / 90);
          const good = rand(this.time * 3) < chance;
          if (good) {
            this.score[kicking] += this.kind === 'CONVERSION' ? 2 : 3;
            this.setBanner(this.kind === 'CONVERSION' ? 'CONVERSION GOOD' : 'PENALTY GOOD', `${kicking === 'A' ? 'ENG' : 'NZL'} ADD ${this.kind === 'CONVERSION' ? 2 : 3}`);
          } else this.setBanner('NO POINTS', 'THE EFFORT DRIFTS WIDE');
          this.setupKick('KICK_OFF', kicking === 'A' ? 'B' : 'A');
        }
      } else if (this.ball.y < 1.6 && this.phaseT > 0.8) {
        const rec: 'A' | 'B' = kicking === 'A' ? 'B' : 'A';
        let best: Actor | null = null, bd = 1e9;
        for (const a of this.team(rec)) { const d = Math.hypot(a.x - this.ball.x, a.z - this.ball.z); if (d < bd) { bd = d; best = a; } }
        if (best && bd < 4) {
          best.action = 'catch';
          this.giveBall(best);
          this.setBanner('CLEAN CATCH', `${best.ch.num} ${best.ch.name} UNDER IT`);
          this.setupOpen(this.ball.x, this.ball.z, rec, best);
        }
      }
      if (this.phaseT > 6) this.setupOpen(this.ball.x, this.ball.z, kicking === 'A' ? 'B' : 'A');
    }
  }

  /* ---- SCRUM ---- */
  private upScrum(dt: number) {
    void dt;
    const putIn = this.poss;
    if (this.stage === 'SET') {
      for (const t of ['A', 'B'] as const) {
        const d = this.dirOf(t);
        this.team(t).forEach((a, i) => {
          if (i < 8) { const [x, z] = this.packSlots(this.rx, this.rz, d, i); a.tgt = [x, z - d * 0.5]; a.action = 'walk'; }
        });
      }
      if (this.phaseT > 1.4) { this.stage = 'CROUCH'; this.phaseT = 0; }
    } else if (this.stage === 'CROUCH') {
      for (const t of ['A', 'B'] as const) this.team(t).forEach((a, i) => { if (i < 8) { a.action = 'scrumBind'; a.tgt = [a.x, a.z]; } });
      if (this.phaseT > 0.9) { this.stage = 'FEED'; this.phaseT = 0; this.shake = 0.5; }
    } else if (this.stage === 'FEED') {
      const half = this.team(putIn)[8];
      half.tgt = [this.rx - 2.2, this.rz + 0.4];
      half.action = 'walk';
      for (const t of ['A', 'B'] as const) this.team(t).forEach((a, i) => { if (i < 8) a.action = 'scrumBind'; });
      if (this.input.spaceHit && putIn === 'A') { this.kickQuality = 1 - clamp01(Math.abs(this.phaseT - 0.55) / 0.4); this.input.spaceHit = false; }
      if (this.phaseT > 0.9) {
        this.stage = 'CONTEST'; this.phaseT = 0; this.shake = 0.8;
        const hook = putIn === 'A' ? 0.45 + this.kickQuality * 0.45 : 0.62;
        this.scrumWin = rand(this.time * 5) < hook ? putIn : (putIn === 'A' ? 'B' : 'A');
      }
    } else if (this.stage === 'CONTEST') {
      const w = this.scrumWin;
      const push = (this.phaseT < 0.5 ? this.phaseT * 2 : 1) * 0.5;
      for (const t of ['A', 'B'] as const) {
        const d = this.dirOf(t);
        this.team(t).forEach((a, i) => {
          if (i < 8) {
            a.action = 'scrumShove';
            const s = t === w ? 1 : -0.4;
            a.z += d * 0 + (w === t ? d : d) * 0; a.z += push * (t === w ? 0.6 : -0.35) * -d * dt * 4;
            void s;
          }
        });
      }
      if (this.phaseT > 1.5) {
        const half = this.team(w)[8];
        this.giveBall(half);
        half.action = 'pass';
        this.setBanner(w === putIn ? 'SCRUM WON' : 'SCRUM STOLEN', `${w === 'A' ? 'ENG' : 'NZL'} BALL FROM THE FEED`);
        this.stats[w === 'A' ? 'ruckA' : 'ruckB']++;
        const fly = this.team(w)[9];
        this.ball.mode = 'pass'; this.ball.tgt = fly; this.ball.holder = null; half.carry = false;
        this.ball.x = half.x; this.ball.z = half.z; this.ball.y = 1;
        this.rx = this.rx; this.rz = this.rz + this.dirOf(w) * 2;
        this.phase = 'OPEN_PLAY'; this.phaseT = 0; this.stage = 'LIVE';
        this.poss = w; this.gapX = clamp(this.rx + (rand(this.time * 9) - 0.5) * 24, -26, 26);
        this.prompt = { text: 'STEP WITH A / D — PASS WITH SPACE', keys: 'A / D · SPACE', t: 0, total: 99 };
        this.scrumToFly = fly;
      }
    }
  }
  scrumWin: 'A' | 'B' = 'A';
  scrumToFly: Actor | null = null;

  /* ---- LINEOUT ---- */
  private upLineout(dt: number) {
    void dt;
    if (this.stage === 'ALIGN') {
      if (this.phaseT > 1.4) { this.stage = 'THROW'; this.phaseT = 0; this.lineT = 0; }
    } else if (this.stage === 'THROW') {
      this.lineT += 1 / 60;
      const thrower = this.team(this.poss)[8];
      thrower.action = 'walk';
      const peak = 1.1;
      if (this.phaseT < peak) {
        this.ball.y = 1 + this.phaseT * 3.4;
        this.ball.z = this.rz;
      } else {
        this.ball.y = Math.max(0.4, 1 + peak * 3.4 - (this.phaseT - peak) * 3.6);
      }
      for (const t of ['A', 'B'] as const) this.team(t).forEach((a) => {
        if (a.role === 'jumper') a.action = this.phaseT > peak - 0.45 ? 'jump' : 'idle';
        if (a.role === 'lifter') a.action = this.phaseT > peak - 0.45 ? 'lift' : 'idle';
      });
      if (this.input.spaceHit && this.poss === 'A') {
        this.kickQuality = 1 - clamp01(Math.abs(this.phaseT - peak) / 0.3);
        this.input.spaceHit = false;
      }
      if (this.phaseT > peak + 0.5) {
        const winA = this.poss === 'A' ? 0.4 + this.kickQuality * 0.5 : 0.35;
        const winner: 'A' | 'B' = rand(this.time * 11) < winA ? 'A' : 'B';
        const jumper = this.team(winner).find(a => a.role === 'jumper')!;
        jumper.action = 'catch';
        this.giveBall(jumper);
        this.setBanner(winner === this.poss ? 'LINEOUT TAKEN' : 'LINEOUT STOLEN', `${jumper.ch.num} ${jumper.ch.name} AT THE PEAK`);
        this.stats[winner === 'A' ? 'ruckA' : 'ruckB']++;
        if (rand(this.time * 13) < 0.55) this.setupMaul(this.rx, this.rz, winner);
        else this.setupOpen(this.rx, this.rz, winner, jumper);
      }
    }
  }
  lineT = 0;

  /* ---- OPEN PLAY ---- */
  private upOpen(dt: number) {
    const holder = this.ball.holder ?? (this.ball.mode === 'pass' ? this.ball.tgt : null);
    if (!holder) {
      // loose ball scramble
      let best: Actor | null = null, bd = 1e9;
      for (const a of this.actors) if (a.team !== 'REF' && !a.down) { const d = Math.hypot(a.x - this.ball.x, a.z - this.ball.z); if (d < bd) { bd = d; best = a; } }
      if (best) { best.tgt = [this.ball.x, this.ball.z]; best.action = 'run'; if (bd < 0.7) { this.giveBall(best); this.setBanner('BALL SCOOPED', `${best.ch.num} ${best.ch.name} FIRST TO IT`); } }
      if (this.phaseT > 7) this.setupBreakdown(this.ball.x, this.ball.z, this.poss);
      return;
    }
    const atk = holder.team as 'A' | 'B';
    const def: 'A' | 'B' = atk === 'A' ? 'B' : 'A';
    const dir = this.dirOf(atk);
    // frozen contact beat: tackle + ball carrier play out their clips
    if (this.stage === 'CONTACT' && this.tackleResolve) {
      const tr = this.tackleResolve;
      tr.t -= dt;
      holder.tgt = [holder.x, holder.z];
      tr.tackler.tgt = [tr.tackler.x, tr.tackler.z];
      if (tr.t <= 0) {
        this.tackleResolve = null;
        this.stage = 'LIVE';
        if (tr.tryLine) { holder.down = true; holder.action = 'dive'; holder.fallDir = 1; this.tryScore(atk, holder); }
        else if (tr.maul) { this.setupMaul(holder.x, holder.z, atk); }
        else {
          holder.down = true; holder.action = 'tackled'; holder.fallDir = 1;
          this.ball.mode = 'loose'; this.ball.holder = null; holder.carry = false;
          this.ball.x = holder.x + dir * 0.6; this.ball.z = holder.z + 0.4; this.ball.y = 0.2;
          this.setupBreakdown(holder.x, holder.z, atk);
        }
      }
      return;
    }
    this.poss = atk;
    this.focusId = holder.id;
    this.stats[atk === 'A' ? 'possA' : 'possA'] += 0; // possession tracked below
    if (atk === 'A') this.stats.possA += dt * 1.6; else this.stats.possA -= dt * 1.6;
    this.stats.possA = clamp(this.stats.possA, 0, 100);
    if (this.ball.mode === 'held') this.stats[atk === 'A' ? 'metA' : 'metB'] += speedOf(holder) * dt * 0.6;

    // carrier AI: hit the gap lane, user steps
    const goalZ = dir > 0 ? FIELD.tryZFar - 1 : FIELD.tryZ + 1;
    let tx = lerpN(holder.x, this.gapX, 0.02);
    if (this.input.left && atk === 'A') { tx = holder.x - 6; this.doStep(holder, -1); }
    if (this.input.right && atk === 'A') { tx = holder.x + 6; this.doStep(holder, 1); }
    holder.tgt = [tx, goalZ];
    const keepStep = holder.action === 'step' && this.stepTimer > 0;
    const keepPass = holder.action === 'pass' && this.ball.mode === 'pass';
    holder.action = keepStep || keepPass ? holder.action : 'sprint';
    holder.carryStyle = clamp01((speedOf(holder) - 3) / 4);
    // into touch -> lineout
    if (Math.abs(holder.x) > 32.5) {
      this.setupLineout(Math.sign(holder.x) * 26, clamp(holder.z, -44, 44), def);
      return;
    }

    // support
    const mates = this.team(atk).filter(a => a !== holder && !a.down)
      .sort((a, b) => dist(a, holder) - dist(b, holder));
    mates.slice(0, 2).forEach((a, i) => {
      a.tgt = [holder.x + (i === 0 ? -3 : 3), holder.z - dir * 5];
      a.action = 'sprint';
    });
    mates.slice(2).forEach((a, i) => {
      a.tgt = [clamp(holder.x + (i - 6) * 6, -30, 30), holder.z - dir * (10 + (i % 4) * 5)];
      a.action = 'run';
    });
    // defence: 3 hunt, rest hold a line
    const hunters = this.team(def).filter(a => !a.down).sort((a, b) => dist(a, holder) - dist(b, holder));
    hunters.slice(0, 3).forEach((a) => {
      a.tgt = [holder.x, holder.z + dir * 0.2];
      a.action = 'sprint';
    });
    hunters.slice(3).forEach((a, i) => {
      a.tgt = [clamp(holder.x + (i - 6) * 5.4, -32, 32), holder.z + dir * 7];
      a.action = 'shuffle';
      a.face = angleTo(a, holder);
    });
    this.team('REF').forEach(a => { a.tgt = [holder.x + 8, holder.z - dir * 6]; a.action = 'run'; });

    // user pass
    if (this.input.spaceHit && atk === 'A' && this.passCd <= 0 && holder.action !== 'pass') {
      this.input.spaceHit = false; this.passCd = 0.8;
      const sup = mates[0];
      if (sup) {
        holder.action = 'pass';
        this.ball.mode = 'pass'; this.ball.tgt = sup; this.ball.holder = null; holder.carry = false;
        this.ball.x = holder.x; this.ball.z = holder.z; this.ball.y = 1.1;
        if (rand(this.time * 17) < 0.08) { this.ball.tgt = null; this.ball.mode = 'loose'; this.ball.vy = 2; this.ball.vz = dir * 3; this.setBanner('KNOCK ON!', 'THE PASS DOES NOT STICK'); }
        else this.setBanner('SPIN PASS', `${holder.ch.num} TO ${sup.ch.num} OUT WIDE`);
      }
    }

    // tackle contact
    for (const d of hunters.slice(0, 3)) {
      if (d.cd > 0) continue;
      if (dist(d, holder) < 1.0 && this.ball.mode === 'held') {
        if (this.stepTimer > 0 && atk === 'A' && rand(this.time * 23) < 0.75) {
          d.cd = 1.2; d.action = 'fallBack'; d.fallDir = -1; d.down = true; d.getUp = 1.6;
          this.setBanner('HE STEPS OUT OF THE TACKLE', `${holder.ch.num} ${holder.ch.name} SLIPS THE CONTACT`);
          this.shake = 0.4;
          break;
        }
        // contact
        d.action = 'tackle'; d.cd = 2;
        holder.action = 'tackled';
        holder.fallDir = 1;
        this.shake = 0.9;
        this.stats[def === 'A' ? 'takA' : 'takB']++;
        const supportNear = mates[0] && dist(mates[0], holder) < 3;
        this.tackleResolve = { t: 0.75, holder, tackler: d, maul: supportNear && rand(this.time * 29) < 0.3, tryLine: Math.abs(holder.z - goalZ) < 2.2 && rand(this.time * 31) < 0.4 };
        this.stage = 'CONTACT';
        break;
      }
    }
    // try
    if (this.ball.mode === 'held' && ((dir > 0 && holder.z > FIELD.tryZFar) || (dir < 0 && holder.z < FIELD.tryZ))) {
      holder.action = 'dive'; holder.down = true; holder.fallDir = 1;
      this.tryScore(atk, holder);
    }
    // stalemate
    if (this.phaseT > 26) this.setupBreakdown(holder.x, holder.z, atk);
  }
  tackleResolve: { t: number; holder: Actor; tackler: Actor; maul: boolean; tryLine: boolean } | null = null;

  private doStep(a: Actor, side: number) {
    if (this.stepTimer > 0) return;
    this.stepTimer = 0.45;
    a.action = 'step';
    a.vx += side * 6;
    a.face += side * 0.5;
  }

  /* ---- BREAKDOWN ---- */
  private upBreakdown(dt: number) {
    void dt;
    const atk = this.poss;
    const def: 'A' | 'B' = atk === 'A' ? 'B' : 'A';
    const downed = this.actors.filter(a => a.down && Math.hypot(a.x - this.rx, a.z - this.rz) < 4);
    for (const a of downed) a.action = a.fallDir > 0 ? 'lieF' : 'lieB';
    if (this.stage === 'ARRIVING') {
      const jack = this.team(def).filter(a => !a.down).sort((a, b) => dist(a, { x: this.rx, z: this.rz } as Actor) - dist(b, { x: this.rx, z: this.rz } as Actor))[0];
      if (jack) { jack.tgt = [this.rx, this.rz + 0.3]; jack.action = 'jackal'; jack.role = 'jackal'; }
      const first = this.team(atk).filter(a => !a.down).sort((a, b) => dist(a, { x: this.rx, z: this.rz } as Actor) - dist(b, { x: this.rx, z: this.rz } as Actor))[0];
      if (first) { first.tgt = [this.rx, this.rz - 0.5]; first.action = 'ruck'; }
      if (this.phaseT > 1.2) { this.stage = 'COMMITTED'; this.phaseT = 0; }
    } else if (this.stage === 'COMMITTED') {
      if (this.input.spaceHit && atk === 'A') {
        this.input.spaceHit = false;
        const extra = this.team(atk).filter(a => !a.down && a.action !== 'ruck').sort((a, b) => dist(a, { x: this.rx, z: this.rz } as Actor) - dist(b, { x: this.rx, z: this.rz } as Actor))[0];
        if (extra) { extra.tgt = [this.rx + (this.input.left ? -1 : this.input.right ? 1 : 0), this.rz - 0.7]; extra.action = 'ruck'; this.ruckPower = clamp01(this.ruckPower + 0.14); this.setBanner('COMMIT ONE MORE', `${extra.ch.num} ${extra.ch.name} JOINS THE HIT`); }
      }
      if (this.input.left) this.ruckPower = clamp01(this.ruckPower + 0.002);
      if (this.input.right) this.ruckPower = clamp01(this.ruckPower - 0.002);
      for (const t of ['A', 'B'] as const) {
        const d = this.dirOf(t);
        this.team(t).filter(a => !a.down && a.action !== 'ruck' && a.action !== 'jackal').forEach((a, i) => {
          if (i < 3) { a.tgt = [this.rx + (i - 1) * 1.6, this.rz - d * 2.2]; a.action = 'walk'; }
          else { a.tgt = [clamp(a.x, -32, 32), this.rz - d * (6 + i * 1.6)]; a.action = 'shuffle'; a.face = angleTo(a, { x: this.rx, z: this.rz, face: 0 } as Actor); }
        });
      }
      this.ruckPower += (rand(Math.floor(this.time * 4)) - 0.5) * 0.004;
      this.ruckPower = clamp01(this.ruckPower);
      if (this.phaseT > 3.4) {
        this.stage = 'CONTEST'; this.phaseT = 0;
        const pA = this.ruckPower + (rand(this.time * 37) - 0.5) * 0.25;
        this.ruckWin = atk === 'A' ? (pA > 0.48 ? 'A' : 'B') : (pA > 0.52 ? 'A' : 'B');
        this.shake = 0.6;
      }
    } else if (this.stage === 'CONTEST') {
      if (this.phaseT > 0.7) {
        const w = this.ruckWin;
        this.stats[w === 'A' ? 'ruckA' : 'ruckB']++;
        if (w !== atk) { this.stats[w === 'A' ? 'toA' : 'toB']++; this.setBanner('TURNOVER!', `${w === 'A' ? 'ENG' : 'NZL'} JACKAL WINS THE RACE`); }
        else this.setBanner('BALL WON', `${w === 'A' ? 'ENG' : 'NZL'} KEEP IT ALIVE`);
        for (const a of downed) { a.down = false; a.getUp = 0; a.action = a.fallDir > 0 ? 'getupF' : 'getupB'; }
        if (rand(this.time * 41) < 0.12) {
          this.setupKick('PENALTY', w);
          this.rz = clamp(this.rz, -44, 44);
        } else {
          const half = this.team(w)[8];
          half.tgt = [this.rx, this.rz - this.dirOf(w) * 1.2];
          this.phase = 'OPEN_PLAY'; this.phaseT = 0; this.stage = 'LIVE';
          this.poss = w;
          this.giveBall(half);
          half.action = 'walk';
          this.gapX = clamp(this.rx + (rand(this.time * 9) - 0.5) * 24, -26, 26);
          this.prompt = { text: 'STEP WITH A / D — PASS WITH SPACE', keys: 'A / D · SPACE', t: 0, total: 99 };
        }
      }
    }
  }
  ruckWin: 'A' | 'B' = 'A';

  /* ---- MAUL ---- */
  private upMaul(dt: number) {
    const atk = this.poss;
    const def: 'A' | 'B' = atk === 'A' ? 'B' : 'A';
    const dir = this.dirOf(atk);
    const drive = (this.input.held && atk === 'A' ? 1.15 : 0.72) - (def === 'B' ? 0.18 : 0.12);
    this.rz += dir * drive * dt;
    this.rx += (this.input.left ? -0.6 : this.input.right ? 0.6 : 0) * dt * (atk === 'A' ? 1 : 0);
    const holder = this.ball.holder;
    for (const t of ['A', 'B'] as const) {
      const d = this.dirOf(t);
      this.team(t).forEach((a, i) => {
        if (i < 6) {
          a.tgt = [this.rx + ((i % 3) - 1) * 0.9, this.rz - d * Math.floor(i / 3) * 0.9];
          a.action = 'maul';
        } else if (i < 9) { a.tgt = [this.rx + (i - 7) * 3, this.rz - d * 3]; a.action = 'walk'; }
        else { a.tgt = [clamp(a.x, -30, 30), this.rz - d * (8 + (i - 9) * 2)]; a.action = 'jog'; }
      });
    }
    this.team('REF').forEach(a => { a.tgt = [this.rx + 4, this.rz]; a.action = 'jog'; });
    if (holder) { holder.x = this.rx; holder.z = this.rz; }
    this.ball.x = this.rx; this.ball.z = this.rz; this.ball.y = 1.1;
    if ((dir > 0 && this.rz > FIELD.tryZFar - 0.5) || (dir < 0 && this.rz < FIELD.tryZ + 0.5)) {
      if (holder) this.tryScore(atk, holder);
      return;
    }
    if (this.phaseT > 6.5) {
      if (rand(this.time * 43) < 0.5) {
        this.setBanner('MAUL COLLAPSES', 'THE REFEREE BLOWS IT UP');
        this.setupScrum(this.rx, clamp(this.rz, -44, 44), def);
      } else {
        if (holder) { this.giveBall(holder); this.setupOpen(this.rx, this.rz, atk, holder); this.setBanner('BALL OUT', 'THE MAUL HAS DONE ITS JOB'); }
      }
    }
  }

  /* ---- movement / facing ---- */
  private moveActors(dt: number) {
    for (const a of this.actors) {
      if (a.cd > 0) a.cd -= dt;
      if (a.down) {
        a.vx = 0; a.vz = 0;
        if (a.getUp > 0) {
          a.getUp -= dt;
          if (a.getUp <= 0) { a.down = false; a.action = a.fallDir > 0 ? 'getupF' : 'getupB'; }
        }
        continue;
      }
      const dx = a.tgt[0] - a.x, dz = a.tgt[1] - a.z;
      const d = Math.hypot(dx, dz);
      const maxV = a.action === 'sprint' ? a.cap : a.action === 'run' ? a.cap * 0.82 : a.action === 'jog' ? a.cap * 0.55 : a.action === 'walk' ? 1.8 : a.action === 'shuffle' ? 2.4 : 0.4;
      if (d > 0.15 && maxV > 0.5) {
        const ax = (dx / d) * 14, az = (dz / d) * 14;
        a.vx += ax * dt; a.vz += az * dt;
      } else { a.vx -= a.vx * 6 * dt; a.vz -= a.vz * 6 * dt; }
      const sp = Math.hypot(a.vx, a.vz);
      if (sp > maxV) { a.vx = (a.vx / sp) * maxV; a.vz = (a.vz / sp) * maxV; }
      a.x += a.vx * dt; a.z += a.vz * dt;
      a.x = clamp(a.x, FIELD.minX + 1, FIELD.maxX - 1);
      a.z = clamp(a.z, FIELD.deadZ + 2, FIELD.deadZFar - 2);
      const spd = Math.hypot(a.vx, a.vz);
      let desired = a.face;
      if (spd > 0.6) desired = Math.atan2(a.vx, a.vz);
      else if (this.phase === 'BREAKDOWN' || this.phase === 'OPEN_PLAY') desired = angleTo(a, { x: this.ball.x, z: this.ball.z } as Actor);
      a.face = angLerp(a.face, desired, 1 - Math.exp(-7 * dt));
      a.rf = a.face;
    }
  }

  private upBall(dt: number) {
    const b = this.ball;
    b.spin += dt * 7;
    if (b.mode === 'held' && b.holder) {
      const h = b.holder;
      b.x = h.x + Math.sin(h.face) * 0.22;
      b.z = h.z + Math.cos(h.face) * 0.22;
      b.y = 1.12;
    } else if (b.mode === 'pass' && b.tgt) {
      const t = b.tgt;
      const dx = t.x - b.x, dz = t.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) { this.giveBall(t); t.action = 'catch'; }
      else { b.x += (dx / d) * 16 * dt; b.z += (dz / d) * 16 * dt; b.y = 1.05; b.spin += dt * 22; }
    } else if (b.mode === 'fly') {
      b.vy -= 22 * dt;
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
      if (b.y < 0.15 && b.vy < 0) { b.y = 0.15; b.mode = 'loose'; b.vx *= 0.3; b.vz *= 0.3; }
    } else if (b.mode === 'loose') {
      b.vx -= b.vx * 2 * dt; b.vz -= b.vz * 2 * dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      if (b.y > 0.2) { b.vy -= 22 * dt; b.y += b.vy * dt; if (b.y < 0.2) b.y = 0.2; }
    }
  }

  /* ---- poses: clip sampling + seamless blending ---- */
  private upPoses(dt: number) {
    for (const a of this.actors) {
      const spd = Math.hypot(a.vx, a.vz);
      let act = a.action;
      if (act === 'sprint' || act === 'run' || act === 'jog' || act === 'walk') {
        act = spd < 0.7 ? 'idle' : spd < 1.6 ? 'walk' : spd < 3.6 ? 'jog' : spd < 6.2 ? 'run' : 'sprint';
        if (a.action === 'walk' && spd < 0.7) act = 'idle';
      }
      let lat: number | undefined;
      if (act === 'shuffle') {
        // signed lateral speed in actor space: drives the strafe cycles
        const cf = Math.cos(a.face), sf = Math.sin(a.face);
        lat = a.vx * cf - a.vz * sf;
      }
      const choice = actionClip(act, spd, lat);
      if (choice.name !== a.clipName) {
        a.blendFrom = { ...a.pose };
        a.blendT = 0;
        a.blendDur = CLIPS[choice.name].loop ? 0.16 : 0.12;
        a.clipName = choice.name;
        a.u = 0;
      }
      a.u += choice.rate * dt;
      const sampled = sampleC(a.clipName, a.u);
      if (a.blendFrom && a.blendT < a.blendDur) {
        a.blendT += dt;
        a.pose = lerpPose(a.blendFrom, sampled, smooth(clamp01(a.blendT / a.blendDur)));
      } else { a.blendFrom = null; a.pose = sampled; }
    }
  }

  /* ---- cameras ---- */
  private upCam(dt: number) {
    void dt;
    const b = this.ball;
    const v: View = { w: this.vw, h: this.vh };
    if (this.replay.active) {
      const s = this.snapAt(this.replay.t);
      const fx = s ? s.d[this.focusIdx() * PER_ACTOR] : b.x;
      const fz = s ? s.d[this.focusIdx() * PER_ACTOR + 1] : b.z;
      const t = this.replay.t * 0.02;
      switch (this.replay.variant) {
        case 0: this.cam = orbitCam(v, fx, fz, t * 2.2, 7.5, 3.2, 30); break;
        case 1: this.cam = heroLowCam(v, fx, fz, t * 1.4 + 1.2, 5.5, 34); break;
        case 2: this.cam = highWideCam(v, fx, fz, this.dirA, 22); break;
        default: this.cam = gantryCam(v, { tx: fx, tz: fz, lead: 2, dir: this.dirA, standback: 8, height: 5, pxPerMetre: 40, deadZone: 1, rigZ: this.rigZ }).cam; this.rigZ = this.cam.z; break;
      }
      return;
    }
    switch (this.phase) {
      case 'KICK': {
        const fromZ = this.kind === 'KICK_OFF' ? -this.dirOf(this.poss) * 58 : (this.rz >= 0 ? 58 : -58);
        if (this.kind === 'KICK_OFF') this.cam = behindPostsCam(v, { tx: this.rx, tz: this.rz + this.dirOf(this.poss) * 18, pxPerMetre: 15, height: 15, track: 0.3, fromZ });
        else this.cam = behindPostsCam(v, { tx: this.rx, tz: this.rz, pxPerMetre: 26, height: 12, track: 0.2, fromZ });
        this.camName = 'CAM 12 — BEHIND';
        break;
      }
      case 'SCRUM': case 'MAUL': case 'BREAKDOWN': {
        const g = gantryCam(v, { tx: this.rx, tz: this.rz, lead: 3, dir: this.dirOf(this.poss), standback: 12, height: 8.5, pxPerMetre: 30, deadZone: 1.6, rigZ: this.rigZ });
        this.cam = g.cam; this.rigZ = g.rigZ; this.camName = 'CAM 1 — GANTRY';
        break;
      }
      case 'LINEOUT': {
        const g = gantryCam(v, { tx: this.rx, tz: this.rz, lead: 0, dir: this.dirOf(this.poss), standback: 9, height: 5.5, pxPerMetre: 34, deadZone: 1.2, rigZ: this.rigZ });
        this.cam = g.cam; this.rigZ = g.rigZ; this.camName = 'CAM 3 — SIDE';
        break;
      }
      default: {
        const holder = this.ball.holder;
        const tx = holder ? holder.x : b.x, tz = holder ? holder.z : b.z;
        const g = gantryCam(v, { tx, tz, lead: 6, dir: this.dirOf(this.poss), standback: 13, height: 9.5, pxPerMetre: 27 + this.zoom * 14, deadZone: 2.2, rigZ: this.rigZ });
        this.cam = g.cam; this.rigZ = g.rigZ; this.camName = 'CAM 1 — GANTRY';
      }
    }
    if (this.shake > 0) { /* applied at render */ }
  }
  vw = 800; vh = 450;

  private focusIdx() { return clamp(this.focusId, 0, this.actors.length - 1); }
  snapAt(t: number): Snap | null {
    const i = clamp(Math.floor(t), 0, this.buf.length - 1);
    return this.buf[i] ?? null;
  }

  /* ================================================================== */
  /* RENDER                                                              */
  /* ================================================================== */
  render(ctx: Ctx2, v: View) {
    this.vw = v.w; this.vh = v.h;
    const snap = this.replay.active ? this.snapAt(this.replay.t) : null;
    const cam = this.cam;
    ctx.save();
    if (this.shake > 0.01) {
      const s = this.shake * this.shake * 9;
      ctx.translate((rand(this.time * 61) - 0.5) * s, (rand(this.time * 71) - 0.5) * s);
    }
    drawStadium(ctx, cam, v, this.time, this.cond);
    drawGoalPosts(ctx, cam, v, FIELD.tryZ, cam.z < 0);
    drawGoalPosts(ctx, cam, v, FIELD.tryZFar, cam.z >= 0);

    // gain line + ruck gate
    if (this.phase === 'BREAKDOWN' || this.phase === 'OPEN_PLAY' || this.phase === 'MAUL') {
      worldDashed(ctx, cam, v, -30, this.rz, 30, this.rz, 0.22, '#d8a13a', 0.8, 1.6, 1.1);
      const gl = project(cam, v, 24, 0.4, this.rz);
      if (gl) {
        ctx.font = `700 ${Math.max(9, gl.sc * 0.42)}px ${MONO}`;
        ctx.fillStyle = '#f2c33d';
        ctx.textAlign = 'center';
        ctx.fillText('GAIN LINE', gl.sx, gl.sy);
      }
    }
    if (this.phase === 'BREAKDOWN') {
      const c = project(cam, v, this.rx, 0.02, this.rz);
      if (c) {
        ctx.save();
        ctx.strokeStyle = '#58c7d6'; ctx.lineWidth = Math.max(1.5, c.sc * 0.05);
        ctx.beginPath(); ctx.ellipse(c.sx, c.sy, c.sc * 1.5, c.sc * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }

    // build draw list
    interface Item { f: number; draw: () => void }
    const items: Item[] = [];
    const gs = clamp(Math.sin(cam.tilt) * 1.15, 0.42, 0.95);
    const [crx, crz] = camRight(cam);
    const list = snap ? this.actorsFromSnap(snap) : this.actors;
    for (const a of list) {
      const pr = project(cam, v, a.x, 0, a.z);
      if (!pr || pr.sc < 1.2) continue;
      // richer facing if the sim provides it, otherwise the actor's stored rf
      const faceAng = Number.isFinite(a.face) ? a.face : a.rf;
      const fx = Math.sin(faceAng), fz = Math.cos(faceAng);
      let view: PaperView;
      if (a.down || a.pose.fall > 0.985) {
        view = a.fallDir > 0 ? 'lieFaceDown' : 'lieFaceUp';
      } else {
        view = updatePaperView(paperViewKey(a.team, a.ch.num), fx, fz, a.x, a.z, cam.x, cam.z);
      }
      const sdir = (fx * crx + fz * crz) >= 0 ? 1 : -1;
      const perp = Math.abs(fx * crx + fz * crz);
      const args: PaperDrawArgs = {
        ctx, sx: pr.sx, sy: pr.sy, sc: pr.sc, view, pose: a.pose,
        pal: this.pal(a.team), build: a.ch.build, skin: a.ch.skin, hair: a.ch.hair,
        num: a.ch.num, seed: a.seed, carry: a.carry ? 1 : Math.max(0, a.pose.ball), carryStyle: a.carryStyle,
        ballSide: a.pose.ballSide, ballSpin: this.ball.spin, cap: a.ch.cap, tape: a.ch.tape,
        spinDir: sdir, gs, fore: 0.45 + 0.55 * perp, headDir: sdir || 1, depth: pr.f,
      };
      items.push({ f: pr.f, draw: () => { drawPaperShadow(args); drawPaperActor(args); } });
    }
    // ball — loose / in flight, or clamped at the carrier's chest
    let bx = this.ball.x, by = this.ball.y, bz = this.ball.z;
    if (this.ball.mode === 'held') {
      const hb = list.find(a => a.carry);
      if (hb) { bx = hb.x + Math.sin(hb.face) * 0.26; bz = hb.z + Math.cos(hb.face) * 0.26; by = 1.14; }
    }
    const bp = project(cam, v, bx, by, bz);
    if (bp) {
      const gp = project(cam, v, bx, 0, bz);
      if (this.ball.mode !== 'held' && gp) shadowBlob(ctx, gp.sx, gp.sy, bp.sc * 0.16, bp.sc * 0.06, 0.3);
      items.push({ f: bp.f - 0.05, draw: () => ballPaper(ctx, bp.sx, bp.sy, Math.max(2, bp.sc * 0.115), this.ball.spin) });
    }
    items.sort((a, b) => b.f - a.f);
    for (const it of items) it.draw();

    // ruck force label
    if (this.phase === 'BREAKDOWN' && this.stage !== 'ARRIVING') {
      const p = project(cam, v, this.rx, 2.1, this.rz);
      if (p) {
        ctx.font = `700 ${Math.max(9, p.sc * 0.4)}px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#eef2e2';
        ctx.fillText(`${(0.6 + this.ruckPower * 1.4).toFixed(1)} kN · PHASE`, p.sx, p.sy);
      }
    }
    ctx.restore();
    drawCRT(ctx, v, 1);
  }

  private actorsFromSnap(s: Snap): Actor[] {
    return this.actors.map((a, i) => {
      const o = i * PER_ACTOR;
      const pose = { ...STAND };
      const keys = Object.keys(pose) as (keyof Pose)[];
      for (let k = 0; k < POSE_N; k++) pose[keys[k]] = s.d[o + 5 + k];
      return {
        ...a, x: s.d[o], z: s.d[o + 1], face: s.d[o + 2], rf: s.d[o + 2],
        carry: s.d[o + 3] > 0.5, carryStyle: s.d[o + 4], pose,
        down: pose.fall > 0.94, fallDir: pose.fallD,
      };
    });
  }

  /* ---- HUD snapshot ---- */
  hud() {
    const f = this.actors[this.focusIdx()];
    return {
      scoreA: this.score.A, scoreB: this.score.B,
      clock: this.clock, half: this.half, over: this.over,
      phase: this.phase, stage: this.stage, kind: this.kind,
      banner: this.banner, prompt: this.prompt, camName: this.camName,
      focus: f ? { num: f.ch.num, name: f.ch.name, pos: f.ch.pos } : null,
      stats: this.stats, poss: this.poss, ruckPower: this.ruckPower,
      replay: this.replay.active, paused: this.paused, speed: this.speed,
    };
  }
}

/* ---------------- small math helpers ---------------- */
function dist(a: { x: number; z: number }, b: { x: number; z: number }) { return Math.hypot(a.x - b.x, a.z - b.z); }
function speedOf(a: Actor) { return Math.hypot(a.vx, a.vz); }
function angleTo(a: { x: number; z: number }, b: { x: number; z: number }) { return Math.atan2(b.x - a.x, b.z - a.z); }
function angLerp(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function lerpN(a: number, b: number, t: number) { return a + (b - a) * t; }
void chaseCam;
