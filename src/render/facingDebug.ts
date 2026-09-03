/**
 * SPEC_06 / T-64 follow-on — FACING/STRAFE DEBUG OVERLAY.
 *
 * Phase 1 of SPEC_06: a real-time, per-actor readout of the three data streams
 * that drive the facing/strafe visual:
 *
 *   view  — the paper cut-out side that faces the camera
 *           ('front' | 'back' | 'leftEdge' | 'rightEdge'), from paper.ts.
 *   gait  — the resolved locomotion clip actually being played
 *           (jog / run / sprint / walk / shuffle / strafe / strafeL / idle).
 *   lat   — the lateral velocity component relative to the actor's own facing
 *           (m/s). This is the stream that pushes an actor into the shuffle /
 *           strafe route when `|lat| > 0.9` at sub-sprint speed.
 *
 * The whole point is to SEE the math at the moment a jarring pop happens, so we
 * can design hysteresis from evidence rather than guesswork.
 *
 * IMPORTANT: this module ONLY reads and displays. It does not touch any of the
 * facing / strafe / animation threshold values (END_ON, EDGE_IN, the 0.9 lat
 * gate, the 3.6 m/s speed band), so it can never change the behaviour it is
 * supposed to measure.
 */

import { PaperView, isEdge, isLying } from './paper';

export interface FacingDebugEntry {
  /** team + shirt, e.g. 'A1' */
  key: string;
  team: string;
  num: number;
  view: PaperView;
  /** resolved locomotion clip name (gait) */
  gait: string;
  /** ground speed m/s */
  spd: number;
  /** lateral velocity relative to facing, m/s */
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

/** The snapshot captured during the last drawMatch() frame, in stable order. */
export function getFacingDebug(): FacingDebugEntry[] {
  return Array.from(frame.values()).sort((a, b) => (a.team === b.team ? a.num - b.num : a.team < b.team ? -1 : 1));
}

/** The thresholds live in scene.ts/paper.ts. Read-only copies for the HUD. */
export const FACING_DEBUG_METRICS = {
  /** |lat| above this (at sub-sprint speed) routes to shuffle/strafe */
  latGate: 0.9,
  /** below this speed a running gait becomes the shuffle route */
  shuffleSpeedBand: 3.6,
  /** paper-view facing dead-zone boundaries (degrees) */
  endOn: 35,
  edgeIn: 55,
  edgeOut: 125,
  backIn: 145,
} as const;

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/**
 * Draw the facing/strafe debug HUD on the match canvas.
 * A semi-transparent right-hand panel listing every actor. Marked actors are
 * the ones sitting in a transition-sensitive state (edge view, or a shuffle /
 * strafe gait), which is where the jarring flips occur.
 */
export function drawFacingStrafeOverlay(
  ctx: CanvasRenderingContext2D,
  phase: string,
  v: { w: number; h: number },
): void {
  const rows = getFacingDebug();
  if (!rows.length) return;

  const panelW = 246;
  const padPx = 8;
  const rowH = 15;
  const headH = 56;
  const paneX = v.w - panelW - 8;
  const top = 8;
  const paneH = headH + rows.length * rowH + padPx;

  ctx.save();
  ctx.globalAlpha = 0.92;

  /* panel backdrop */
  ctx.fillStyle = 'rgba(10,14,22,0.88)';
  ctx.strokeStyle = 'rgba(127,142,166,0.6)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(paneX, top, panelW, paneH);
  ctx.strokeRect(paneX, top, panelW, paneH);

  /* header */
  ctx.fillStyle = '#e8cf46';
  ctx.font = '900 11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('FACING / STRAFE — LIVE', paneX + padPx, top + 14);
  ctx.fillStyle = '#7f8ea6';
  ctx.font = '700 8px ui-monospace, monospace';
  ctx.fillText(`${phase.toUpperCase()}  ·  ΓVIEW=paper side  ΓGAIT=clip  ΓLAT=lateral m/s`, paneX + padPx, top + 27);

  /* threshold readout (read-only — the live values we must not change) */
  const M = FACING_DEBUG_METRICS;
  ctx.fillStyle = '#8fa0b8';
  ctx.font = '700 8px ui-monospace, monospace';
  ctx.fillText(
    `LAT GATE ${M.latGate.toFixed(1)}  ·  SHUFFLE <${M.shuffleSpeedBand.toFixed(1)} m/s  ·  VIEW dead band ${M.endOn}-${M.edgeIn} / ${M.edgeOut}-${M.backIn}°`,
    paneX + padPx, top + 40,
  );
  /* colon headers */
  ctx.fillStyle = '#5f6f86';
  ctx.font = '700 8px ui-monospace, monospace';
  const cx0 = paneX + padPx;
  const cView = cx0 + 34;
  const cGait = cView + 58;
  const cSpd = cGait + 52;
  const cLat = cSpd + 42;
  ctx.fillText('ACTOR', cx0, top + 52);
  ctx.fillText('VIEW', cView, top + 52);
  ctx.fillText('GAIT', cGait, top + 52);
  ctx.fillText('SPD', cSpd, top + 52);
  ctx.fillText('LAT', cLat, top + 52);
  ctx.strokeStyle = 'rgba(38,49,74,0.8)';
  ctx.beginPath();
  ctx.moveTo(paneX + padPx, top + 55.5);
  ctx.lineTo(paneX + panelW - padPx, top + 55.5);
  ctx.stroke();

  rows.forEach((r, i) => {
    const y = top + headH + i * rowH;
    const rowCenter = y + rowH - 4;
    /* band the flip-prone keepers: edge view, or a shuffle/strafe gait */
    const sensitive = isEdge(r.view) || isLying(r.view)
      || r.gait === 'shuffle' || r.gait === 'strafe' || r.gait === 'strafeL';
    if (sensitive) {
      ctx.fillStyle = 'rgba(232,207,70,0.10)';
      ctx.fillRect(paneX + padPx, y, panelW - padPx * 2, rowH - 1);
    }
    const gaitCol = r.gait === 'shuffle' || r.gait === 'strafe' || r.gait === 'strafeL' ? '#ffd76a'
      : r.gait === 'sprint' ? '#6ee7a0' : '#a9b6c8';
    const viewCol = isEdge(r.view) ? '#ffd76a' : isLying(r.view) ? '#ff6a5a' : '#8fa0b8';

    ctx.font = '700 9px ui-monospace, monospace';
    ctx.fillStyle = r.team === 'A' ? '#e2664f' : '#7fa3e6';
    ctx.fillText(pad(r.key, 5), cx0, rowCenter);

    ctx.fillStyle = viewCol;
    ctx.fillText(pad(r.view === 'leftEdge' ? 'L-EDGE' : r.view === 'rightEdge' ? 'R-EDGE' : r.view.toUpperCase(), 7), cView, rowCenter);

    ctx.fillStyle = gaitCol;
    ctx.fillText(pad(r.gait === 'strafeL' ? 'strafe-L' : r.gait, 9), cGait, rowCenter);

    ctx.fillStyle = '#cfd8e6';
    ctx.fillText(r.spd.toFixed(1), cSpd, rowCenter);

    /* lat with a threshold marker above |0.9| (the gate that routes to strafe) */
    ctx.fillStyle = Math.abs(r.lat) > M.latGate ? '#ff6a5a' : '#a9b6c8';
    ctx.fillText(r.lat.toFixed(1), cLat, rowCenter);
  });

  ctx.restore();
}
