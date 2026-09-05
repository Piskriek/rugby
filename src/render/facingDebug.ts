/**
 * SPEC_06 / T-64 follow-on — FACING/GAIT DEBUG OVERLAY (3D era).
 *
 * Originally a readout of the 2D paper-cut-out view side; with the puppets
 * replaced by the GLB squad (see ThreePlayerManager) the per-actor streams are
 * now the 3D heading and the resolved locomotion/one-shot state. This module
 * stays read-only: it only displays the values the 3D manager reports.
 */

export interface FacingDebugEntry {
  /** team + shirt, e.g. 'A1' */
  key: string;
  team: string;
  num: number;
  /** 3D state-machine gait / one-shot actually playing */
  gait: string;
  /** ground speed m/s */
  spd: number;
  /** true heading, radians */
  face: number;
  /** lateral velocity relative to heading, m/s */
  lat: number;
}

const frame = new Map<string, FacingDebugEntry>();

/** Clear the per-frame capture. Called once at the top of drawMatch(). */
export function resetFacingDebug(): void {
  frame.clear();
}

/** Record one actor's live readout for this frame. */
export function recordFacingDebug(entry: FacingDebugEntry): void {
  frame.set(entry.key, entry);
}

/** The snapshot captured during the last frame, in stable order. */
export function getFacingDebug(): FacingDebugEntry[] {
  return Array.from(frame.values()).sort((a, b) => (a.team === b.team ? a.num - b.num : a.team < b.team ? -1 : 1));
}

export const FACING_DEBUG_METRICS = {
  latGate: 0.9,
  shuffleSpeedBand: 3.6,
} as const;

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** Draw the facing/gait debug HUD on the match canvas. */
export function drawFacingStrafeOverlay(
  ctx: CanvasRenderingContext2D,
  phase: string,
  v: { w: number; h: number },
): void {
  const rows = getFacingDebug();
  if (!rows.length) return;

  const panelW = 232;
  const padPx = 8;
  const rowH = 15;
  const headH = 44;
  const paneX = v.w - panelW - 8;
  const top = 8;
  const paneH = headH + rows.length * rowH + padPx;

  ctx.save();
  ctx.globalAlpha = 0.92;

  ctx.fillStyle = 'rgba(10,14,22,0.88)';
  ctx.strokeStyle = 'rgba(127,142,166,0.6)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(paneX, top, panelW, paneH);
  ctx.strokeRect(paneX, top, panelW, paneH);

  ctx.fillStyle = '#e8cf46';
  ctx.font = '900 11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('FACING / GAIT — LIVE 3D', paneX + padPx, top + 14);
  ctx.fillStyle = '#7f8ea6';
  ctx.font = '700 8px ui-monospace, monospace';
  ctx.fillText(`${phase.toUpperCase()}  ·  GAIT=clip state  ·  FACE=heading deg`, paneX + padPx, top + 27);

  const cx0 = paneX + padPx;
  const cGait = cx0 + 46;
  const cSpd = cGait + 96;
  const cFace = cSpd + 36;
  ctx.fillStyle = '#5f6f86';
  ctx.font = '700 8px ui-monospace, monospace';
  ctx.fillText('ACTOR', cx0, top + 40);
  ctx.fillText('GAIT', cGait, top + 40);
  ctx.fillText('SPD', cSpd, top + 40);
  ctx.fillText('FACE', cFace, top + 40);
  ctx.strokeStyle = 'rgba(38,49,74,0.8)';
  ctx.beginPath();
  ctx.moveTo(paneX + padPx, top + headH - 3.5);
  ctx.lineTo(paneX + panelW - padPx, top + headH - 3.5);
  ctx.stroke();

  rows.forEach((r, i) => {
    const y = top + headH + i * rowH;
    const rowCenter = y + rowH - 4;
    const oneshot = !['idle', 'walk', 'run', 'sprint', 'crouch', 'bind', 'ruck', 'jump'].includes(r.gait);
    if (oneshot) {
      ctx.fillStyle = 'rgba(232,207,70,0.10)';
      ctx.fillRect(paneX + padPx, y, panelW - padPx * 2, rowH - 1);
    }
    const gaitCol = r.gait === 'sprint' ? '#6ee7a0' : oneshot ? '#ffd76a' : '#a9b6c8';
    const deg = ((r.face * 180) / Math.PI) % 360;

    ctx.font = '700 9px ui-monospace, monospace';
    ctx.fillStyle = r.team === 'A' ? '#e2664f' : r.team === 'REF' ? '#e8cf46' : '#7fa3e6';
    ctx.fillText(pad(r.key, 5), cx0, rowCenter);
    ctx.fillStyle = gaitCol;
    ctx.fillText(pad(r.gait, 10), cGait, rowCenter);
    ctx.fillStyle = '#cfd8e6';
    ctx.fillText(r.spd.toFixed(1), cSpd, rowCenter);
    ctx.fillStyle = Math.abs(r.lat) > FACING_DEBUG_METRICS.latGate ? '#ff6a5a' : '#a9b6c8';
    ctx.fillText(deg.toFixed(0).padStart(3, '0'), cFace, rowCenter);
  });

  ctx.restore();
}
