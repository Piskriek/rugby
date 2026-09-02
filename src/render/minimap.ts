/**
 * MINIMAP — a transparent, outlined tactical view of the whole pitch.
 * Deliberately unfilled so the match stays visible through it.
 */
import { Director } from '../game/director';
import { FIELD, View } from './retro';

export interface MapStyle { x: number; y: number; w: number; h: number; alpha: number }

export function minimapRect(v: View): MapStyle {
  const w = Math.min(340, Math.max(210, v.w * 0.23));
  const h = w * (70 / 124);
  return { x: v.w - w - 18, y: 18, w, h, alpha: 0.9 };
}

export function drawMinimap(ctx: CanvasRenderingContext2D, d: Director, v: View) {
  const R = minimapRect(v);
  const { x, y, w, h } = R;

  const zSpan = FIELD.deadZFar - FIELD.deadZ;
  const xSpan = (FIELD.maxX - FIELD.minX);
  const mx = (wz: number) => x + ((wz - FIELD.deadZ) / zSpan) * w;
  const my = (wx: number) => y + ((wx - FIELD.minX) / xSpan) * h;

  ctx.save();
  ctx.globalAlpha = R.alpha;

  ctx.fillStyle = 'rgba(12,16,24,0.34)';
  roundRect(ctx, x - 6, y - 6, w + 12, h + 12, 4);
  ctx.fill();

  ctx.strokeStyle = 'rgba(244,239,226,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  const vline = (wz: number, alpha: number, dash?: number[]) => {
    ctx.save();
    ctx.globalAlpha = R.alpha * alpha;
    ctx.strokeStyle = '#f4efe2';
    ctx.lineWidth = 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(mx(wz), y); ctx.lineTo(mx(wz), y + h); ctx.stroke();
    ctx.restore();
  };
  vline(FIELD.tryZ, 0.95);
  vline(FIELD.tryZFar, 0.95);
  vline(-28, 0.6);
  vline(28, 0.6);
  vline(0, 0.75, [4, 3]);
  vline(-10, 0.35, [2, 3]);
  vline(10, 0.35, [2, 3]);

  ctx.save();
  ctx.globalAlpha = R.alpha * 0.22;
  ctx.strokeStyle = '#f4efe2'; ctx.lineWidth = 1;
  for (const [z0, z1] of [[FIELD.deadZ, FIELD.tryZ], [FIELD.tryZFar, FIELD.deadZFar]]) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const px = mx(z0 + (z1 - z0) * t);
      ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = R.alpha * 0.28;
  ctx.strokeStyle = '#f4efe2'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  for (const wx of [FIELD.minX + 5, FIELD.minX + 15, FIELD.maxX - 15, FIELD.maxX - 5]) {
    ctx.beginPath(); ctx.moveTo(x, my(wx)); ctx.lineTo(x + w, my(wx)); ctx.stroke();
  }
  ctx.restore();

  for (const a of d.actors) {
    const px = mx(a.rz), py = my(a.rx);
    if (px < x - 4 || px > x + w + 4) continue;
    const isRef = a.team === 'REF';
    const col = isRef ? '#e8cf46' : a.team === 'A' ? '#e2664f' : '#7fa3e6';
    ctx.beginPath();
    ctx.arc(px, py, isRef ? 1.9 : 2.6, 0, Math.PI * 2);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  const b = ballPos(d);
  if (b) {
    const px = mx(b.z), py = my(b.x);
    ctx.beginPath();
    ctx.ellipse(px, py, 3.6, 2.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fff8e2'; ctx.fill();
    ctx.strokeStyle = '#20202b'; ctx.lineWidth = 1; ctx.stroke();
    const pulse = 4 + Math.sin(d.t * 5) * 1.6;
    ctx.beginPath(); ctx.arc(px, py, pulse + 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,248,226,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  }

  drawFrustum(ctx, d, mx, my, x, y, w, h);

  const dir = d.possession === 'A' ? 1 : -1;
  const ax = x + w * 0.5, ay = y + h + 12;
  ctx.globalAlpha = R.alpha;
  ctx.strokeStyle = d.possession === 'A' ? '#e2664f' : '#7fa3e6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ax - 16 * dir, ay); ctx.lineTo(ax + 16 * dir, ay); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ax + 16 * dir, ay);
  ctx.lineTo(ax + 9 * dir, ay - 4);
  ctx.moveTo(ax + 16 * dir, ay);
  ctx.lineTo(ax + 9 * dir, ay + 4);
  ctx.stroke();

  ctx.restore();
}

function drawFrustum(
  ctx: CanvasRenderingContext2D, d: Director,
  mx: (z: number) => number, my: (x: number) => number,
  bx: number, by: number, bw: number, bh: number,
) {
  const cam = d.cam;
  const half = cam.fov * 0.5;
  const reach = 90;
  const pts: [number, number][] = [];
  for (const a of [-half * 1.5, half * 1.5]) {
    const ang = cam.yaw + a;
    pts.push([cam.x + Math.sin(ang) * reach, cam.z + Math.cos(ang) * reach]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.clip();
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.moveTo(mx(cam.z), my(cam.x));
  ctx.lineTo(mx(pts[0][1]), my(pts[0][0]));
  ctx.lineTo(mx(pts[1][1]), my(pts[1][0]));
  ctx.closePath();
  ctx.fillStyle = '#f4efe2'; ctx.fill();
  ctx.restore();
}

function ballPos(d: Director): { x: number; z: number } | null {
  if (d.kk && (d.phase === 'KICK' || d.phase === 'KICK_REPLAY')) return { x: d.kk.bx, z: d.kk.bz };
  if (d.op && d.phase === 'OPEN_PLAY') {
    return d.op.ball.live ? { x: d.op.ball.x, z: d.op.ball.z } : { x: d.op.carrierX, z: d.op.carrierZ };
  }
  if (d.ml && (d.phase === 'MAUL' || d.phase === 'MAUL_REPLAY')) return { x: d.ml.x, z: d.ml.z };
  if (d.bd && (d.phase === 'BREAKDOWN' || d.phase === 'BREAKDOWN_REPLAY')) return { x: d.bd.contactX, z: d.bd.contactZ };
  if (d.lo && (d.phase === 'LINEOUT' || d.phase === 'LINEOUT_REPLAY')) return { x: d.lo.ball.x, z: d.lo.ball.z };
  if (d.scrim) return { x: d.scrumAnchor.x, z: d.scrumAnchor.z };
  return null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
