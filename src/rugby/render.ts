/**
 * Renderer for the new engine: a clean top-down broadcast view.
 *
 * The pitch and its markings are drawn through a single non-uniform transform
 * (length 1:1, width foreshortened) so lines scale with the camera for free.
 * Entities (players, ball, rings) are drawn in screen space so their bodies
 * and the ball's height read vertically — bodies are circles + a head lifted
 * above the feet, exactly like a paper-sprite would suggest from this angle.
 */
import type { RugbySim } from './engine';
import { TOUCH_Y, TRY_X, DEAD_X, LINES } from './consts';
import type { Player } from './types';

const TILT = 0.68;   // width foreshortening
const H = 1.85;      // screen-px of one metre of height at zoom 1

export interface View { w: number; h: number }

export class Camera {
  x = 0;
  y = -6;
  zoom = 13;
  shake = 0;

  update(dt: number, sim: RugbySim, view: View) {
    const b = sim.ball;
    const ad = sim.possession ? sim.attackDir(sim.possession) : 1;
    const tx = b.x + ad * 7;
    const ty = b.y * 0.5;
    this.x += (tx - this.x) * Math.min(1, dt * 3);
    this.y += (ty - this.y) * Math.min(1, dt * 3);
    const targetZoom = Math.min(view.w / 92, view.h / (58 * TILT));
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 2);
    // clamp the camera so the frame stays on grass
    const halfW = view.w / this.zoom / 2;
    const halfH = view.h / this.zoom / TILT / 2;
    this.x = Math.max(-DEAD_X - 4 + halfW, Math.min(DEAD_X + 4 - halfW, this.x));
    this.y = Math.max(-TOUCH_Y - 2 + halfH, Math.min(TOUCH_Y + 2 - halfH, this.y));
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  /** world → screen, z lifts the point up the screen */
  sx(x: number): number { return x - this.x; }
  toScreen(x: number, y: number, z: number, view: View): [number, number] {
    const jx = this.shake ? (Math.random() - 0.5) * this.shake * 14 : 0;
    const jy = this.shake ? (Math.random() - 0.5) * this.shake * 11 : 0;
    return [
      view.w / 2 + (x - this.x) * this.zoom + jx,
      view.h * 0.52 + (y - this.y) * this.zoom * TILT - z * this.zoom * H + jy,
    ];
  }
}

/* ------------------------------------------------------------------ */

export function draw(ctx: CanvasRenderingContext2D, view: View, sim: RugbySim, cam: Camera, t: number) {
  const { w, h } = view;

  // sky / stands
  ctx.fillStyle = '#0b0f16';
  ctx.fillRect(0, 0, w, h);

  drawPitch(ctx, view, cam);

  // faint offside line for the defending side during open play
  if (sim.phase === 'OPEN' && sim.possession) {
    drawOffside(ctx, view, cam, sim);
  }

  drawSetPieceOverlays(ctx, view, cam, sim, t);

  // ball trail on the ground
  drawBallTrail(ctx, view, cam, sim);

  // shadows + bodies
  const players = [...sim.A.players, ...sim.B.players];
  const carrier = sim.carrier();
  const kit = {
    A: { primary: sim.A.color, secondary: sim.A.color2 },
    B: { primary: sim.B.color, secondary: sim.B.color2 },
  };
  for (const p of players) drawPlayerShadow(ctx, view, cam, p);
  // depth sort: nearer (larger screen y) drawn later
  players.sort((a, b) => cam.toScreen(a.x, a.y, 0, view)[1] - cam.toScreen(b.x, b.y, 0, view)[1]);
  for (const p of players) drawPlayer(ctx, view, cam, p, p === carrier, p.id === sim.ctrlId, kit[p.side]);

  drawBall(ctx, view, cam, sim);
}

/* ------------------------------------------------------------------ */

function drawPitch(ctx: CanvasRenderingContext2D, view: View, cam: Camera) {
  const { w, h } = view;
  const z = cam.zoom;
  ctx.setTransform(z, 0, 0, z * TILT, w / 2 - cam.x * z, h * 0.52 - cam.y * z * TILT);

  // apron (run-off)
  ctx.fillStyle = '#12351f';
  ctx.fillRect(-DEAD_X - 6, -TOUCH_Y - 6, (DEAD_X + 6) * 2, (TOUCH_Y + 6) * 2);

  // in-goal areas
  ctx.fillStyle = '#1d4a2a';
  ctx.fillRect(TRY_X, -TOUCH_Y, DEAD_X - TRY_X, TOUCH_Y * 2);
  ctx.fillRect(-DEAD_X, -TOUCH_Y, DEAD_X - TRY_X, TOUCH_Y * 2);

  // mown stripes (10 m bands along the length)
  for (let x = -60; x < 60; x += 10) {
    ctx.fillStyle = ((x + 60) / 10) % 2 === 0 ? '#2c7a3f' : '#267038';
    ctx.fillRect(x, -TOUCH_Y, 10, TOUCH_Y * 2);
  }

  // field lines
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  ctx.rect(-TRY_X, -TOUCH_Y, TRY_X * 2, TOUCH_Y * 2);
  ctx.stroke();

  const solid = [LINES.halfway, -LINES.twentyTwo, LINES.twentyTwo, -TRY_X, TRY_X];
  const dashed = [-LINES.ten, LINES.ten, -LINES.five, LINES.five, -LINES.twentyTwo, LINES.twentyTwo];
  for (const x of solid) vline(ctx, x, -TOUCH_Y, TOUCH_Y, 0.18);
  ctx.setLineDash([0.7, 0.7]);
  for (const x of dashed) vline(ctx, x, -TOUCH_Y, TOUCH_Y, 0.12);
  ctx.setLineDash([]);

  // dead-ball lines
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  vline(ctx, -DEAD_X, -TOUCH_Y, TOUCH_Y, 0.14);
  vline(ctx, DEAD_X, -TOUCH_Y, TOUCH_Y, 0.14);

  // goal posts
  drawPosts(ctx, -TRY_X);
  drawPosts(ctx, TRY_X);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function vline(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, w: number) {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
}

function drawPosts(ctx: CanvasRenderingContext2D, x: number) {
  ctx.fillStyle = '#e8f0ff';
  ctx.beginPath();
  ctx.arc(x, -2.8, 0.22, 0, Math.PI * 2); ctx.arc(x, 2.8, 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8f0ff';
  ctx.lineWidth = 0.1;
  ctx.beginPath(); ctx.moveTo(x, -2.8); ctx.lineTo(x, 2.8); ctx.stroke();
}

function drawOffside(ctx: CanvasRenderingContext2D, view: View, cam: Camera, sim: RugbySim) {
  const def = sim.possession === 'A' ? 'B' : 'A';
  const x = sim.onsideX(def as 'A' | 'B');
  ctx.strokeStyle = 'rgba(255,120,90,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  const a = cam.toScreen(x, -TOUCH_Y, 0, view);
  const b = cam.toScreen(x, TOUCH_Y, 0, view);
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.setLineDash([]);
}

function drawSetPieceOverlays(ctx: CanvasRenderingContext2D, view: View, cam: Camera, sim: RugbySim, t: number) {
  let px = 0, py = 0, label = '';
  if (sim.ruck) { px = sim.ruck.x; py = sim.ruck.y; label = 'RUCK'; }
  else if (sim.maul) { px = sim.maul.x; py = sim.maul.y; label = 'MAUL'; }
  else if (sim.scrum) { px = sim.scrum.x; py = sim.scrum.y; label = 'SCRUM'; }
  else if (sim.lineout) { px = sim.lineout.x; py = sim.lineout.y; label = 'LINEOUT'; }
  if (!label) return;
  const [sx, sy] = cam.toScreen(px, py, 0, view);
  const r = cam.zoom * (1.1 + Math.sin(t * 5) * 0.12);
  ctx.strokeStyle = label === 'MAUL' ? 'rgba(255,180,60,0.9)' : 'rgba(232,207,70,0.9)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.font = `900 ${Math.round(cam.zoom * 0.9)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,12,18,0.9)';
  ctx.strokeText(label, sx, sy - r - 8);
  ctx.fillStyle = '#e8cf46';
  ctx.fillText(label, sx, sy - r - 8);
  ctx.textAlign = 'left';

  // kick aim line
  if (sim.kick && !sim.kick.kicked && (sim.phase === 'PLACE_KICK' || sim.phase === 'KICKOFF' || sim.phase === 'DROP_KICK')) {
    const k = sim.kick;
    const ad = sim.attackDir(k.side);
    const gx = ad * TRY_X;
    const ang = k.kind === 'KICKOFF' || k.kind === 'DROPOUT' ? Math.atan2(0, ad) : Math.atan2(0 - k.y, gx - k.x) + k.aim * (k.kind === 'CONVERSION' ? 0.4 : 1);
    const len = 8 + k.power * 18;
    const e = cam.toScreen(k.x + Math.cos(ang) * len, k.y + Math.sin(ang) * len, 0, view);
    const s = cam.toScreen(k.x, k.y, 0, view);
    ctx.strokeStyle = `rgba(255,215,106,${0.5 + k.power * 0.5})`;
    ctx.lineWidth = 2 + k.power * 4;
    ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(s[0] - 1, s[1] - 24, 2, 20);
    ctx.fillRect(s[0] - 1, s[1] - 24 + (1 - k.power) * 20, 2, k.power * 20);
  }
}

function drawBallTrail(ctx: CanvasRenderingContext2D, view: View, cam: Camera, sim: RugbySim) {
  const tr = sim.ball.trail;
  if (tr.length < 2) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < tr.length; i++) {
    const [x, y] = cam.toScreen(tr[i][0], tr[i][1], 0, view);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawPlayerShadow(ctx: CanvasRenderingContext2D, view: View, cam: Camera, p: Player) {
  const [sx, sy] = cam.toScreen(p.x, p.y, 0, view);
  const r = cam.zoom * 0.5 * p.size;
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * TILT * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D, view: View, cam: Camera, p: Player,
  isCarrier: boolean, isCtrl: boolean, kit: { primary: string; secondary: string },
) {
  const team = kit;
  const hgt = 1.7 * p.size;
  const [hx, hy] = cam.toScreen(p.x, p.y, hgt, view);
  const [sx, sy] = cam.toScreen(p.x, p.y, 0.55, view);
  const r = Math.max(4, cam.zoom * 0.46 * p.size);

  // body
  ctx.fillStyle = team.primary;
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.strokeStyle = 'rgba(10,12,16,0.85)';
  ctx.stroke();

  // facing wedge
  const f = p.face;
  ctx.fillStyle = team.secondary;
  ctx.beginPath();
  ctx.moveTo(sx + Math.cos(f) * r, sy + Math.sin(f) * r);
  ctx.lineTo(sx + Math.cos(f + 0.9) * r, sy + Math.sin(f + 0.9) * r);
  ctx.lineTo(sx + Math.cos(f - 0.9) * r, sy + Math.sin(f - 0.9) * r);
  ctx.closePath();
  ctx.fill();

  // head (lifted above the body)
  ctx.fillStyle = '#e8c39a';
  ctx.beginPath();
  ctx.arc(hx, hy, r * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // number on the body
  ctx.font = `900 ${Math.max(8, r * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0d1016';
  ctx.fillText(String(p.num), sx, sy + 0.5);
  ctx.textBaseline = 'alphabetic';

  // carry ring
  if (isCarrier) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.stroke();
  }
  if (isCtrl) {
    ctx.strokeStyle = '#6ee7a0';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(sx, sy, r + 6, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.textAlign = 'left';
}

function drawBall(ctx: CanvasRenderingContext2D, view: View, cam: Camera, sim: RugbySim) {
  const b = sim.ball;
  const [sx, sy] = cam.toScreen(b.x, b.y, b.z, view);
  const r = Math.max(2.5, cam.zoom * 0.16);
  // shadow on the ground
  const [gx, gy] = cam.toScreen(b.x, b.y, 0, view);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(gx, gy, r, r * TILT * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  // ball
  ctx.fillStyle = '#f4e6c0';
  ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.6, r, b.spin * 0.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8a6a2f';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* ------------------------------------------------------------------ */

/** drawMinimap — tactical radar in the top-right corner */
export function drawMinimap(ctx: CanvasRenderingContext2D, view: View, sim: RugbySim, ctrlId: number) {
  const W = 150, H = 106, PX = view.w - W - 12, PY = 12;
  const fx = (x: number) => PX + ((x + DEAD_X) / (DEAD_X * 2)) * W;
  const fy = (y: number) => PY + ((y + TOUCH_Y) / (TOUCH_Y * 2)) * H;

  ctx.fillStyle = 'rgba(8,12,20,0.72)';
  ctx.fillRect(PX - 6, PY - 6, W + 12, H + 12);
  ctx.fillStyle = '#1c6b3c';
  ctx.fillRect(PX, PY, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(PX, PY, W, H);
  ctx.beginPath();
  ctx.moveTo(fx(0), PY); ctx.lineTo(fx(0), PY + H);
  ctx.moveTo(fx(TRY_X), PY); ctx.lineTo(fx(TRY_X), PY + H);
  ctx.moveTo(fx(-TRY_X), PY); ctx.lineTo(fx(-TRY_X), PY + H);
  ctx.stroke();

  for (const p of sim.A.players) dot(ctx, fx(p.x), fy(p.y), p.id === ctrlId ? '#6ee7a0' : '#e2664f', p.id === ctrlId ? 4 : 2.5);
  for (const p of sim.B.players) dot(ctx, fx(p.x), fy(p.y), p.id === ctrlId ? '#6ee7a0' : '#7fa3e6', p.id === ctrlId ? 4 : 2.5);
  dot(ctx, fx(sim.ball.x), fy(sim.ball.y), '#f4e6c0', 3.5);
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r: number) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
