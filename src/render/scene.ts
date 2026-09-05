/**
 * SCENE RENDERER — the 2D layer of the match view.
 *
 * When `ENV_3D` is on, this canvas is a transparent HUD overlay: it paints
 * in-world telemetry, referee bubbles, and (via MatchView) the minimap,
 * banners and CRT scanlines. Stadium, turf, mown stripes, the 260 mud
 * ellipses, 900 noise specks, 2D pitch markings and 2D goalposts are owned
 * by ThreeEnvironment and are skipped here.
 *
 * When `ENV_3D` is off, the 2D canvas still paints the full stadium under
 * the transparent WebGL actor overlay.
 *
 * The actors themselves — the 30 players plus the referee — are GLB
 * humanoids rendered by ThreePlayerManager / ThreeCanvas. This module no
 * longer draws any character, limb or ball ink.
 *
 * BALL OWNERSHIP (Part 1 — hand socketing). The 3D ball is a single mesh
 * owned by ThreePlayerManager. It has exactly two states and this module
 * paints neither of them:
 *   HELD    parented to the ball-carrier's `hand_r` socket bone, so its
 *           world matrix is the hand's — the 2D simulation's ball
 *           coordinates are OVERRIDDEN for as long as a man is carrying it.
 *   IN FLIGHT / LOOSE  re-parented to the scene and synced every frame to
 *           the 2D simulation's ballistic trajectory (op.ball, kk, lo, bd).
 * The hand-off between the two happens in ThreePlayerManager.updateBall the
 * frame the engine flips `op.ball.live`, which is the same frame the passer's
 * one-shot Pass clip releases. Anything drawn here is telemetry only.
 */
import { Director } from '../game/director';
import {
  drawStadium, project,
  drawGoalPosts, Camera, View,
} from './retro';
import { maulUseItClock, maulUseItCall } from '../game/engine/setpieces';
import { resetFacingDebug, recordFacingDebug } from './facingDebug';
import type { ThreePlayerManager } from './ThreePlayerManager';
import { ENV_3D } from './ThreeCanvas';

export function drawMatch(
  ctx: CanvasRenderingContext2D, d: Director, v: View,
  three?: ThreePlayerManager,
  shake?: { x: number; y: number },
) {
  resetFacingDebug();
  const cam = d.cam;
  // Shake is computed by the caller so the 3D overlay (ThreeCanvas.syncCamera)
  // and this 2D layer move together — otherwise players jitter vs the pitch.
  const jx = shake?.x ?? (cam.shake ? (Math.random() - 0.5) * cam.shake * 14 : 0);
  const jy = shake?.y ?? (cam.shake ? (Math.random() - 0.5) * cam.shake * 11 : 0);
  const cam2: Camera = { ...cam, shake: 0 };

  /* Stadium + pitch markings. Skipped under ENV_3D — ThreeEnvironment owns
   * the turf, baked markings, mud-free dual-plane ground and uprights. */
  if (!ENV_3D) {
    drawStadium(ctx, cam2, v, d.t, d.pitch);
    drawGoalPosts(ctx, cam2, v, -50, false);
  } else {
    ctx.clearRect(0, 0, v.w, v.h);
  }

  /* Feed the SPEC_06 debug HUD from the 3D animation state machine. */
  if (three) {
    for (const e of three.debugEntries()) {
      recordFacingDebug({
        key: e.key, team: e.team, num: e.num,
        gait: e.gait, spd: e.spd, face: e.face, lat: 0,
      });
    }
  }

  /* The 3D overlay (players + ball, and under ENV_3D the pitch itself)
   * renders on the WebGL canvas; nothing actor-related is painted in 2D. */
  if (!ENV_3D) {
    drawGoalPosts(ctx, cam2, v, 50, true);
  }

  /* --- mini-game overlays (world-space telemetry on the 2D layer) --- */
  if (d.phase === 'SCRUM' || d.phase === 'REPLAY') drawScrumOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'LINEOUT' || d.phase === 'LINEOUT_REPLAY') drawLineoutOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'BREAKDOWN' || d.phase === 'BREAKDOWN_REPLAY') drawBreakdownOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'MAUL' || d.phase === 'MAUL_REPLAY') drawMaulOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'OPEN_PLAY') drawOpenPlayOverlay(ctx, d, v, cam2, jx, jy);
  if (d.phase === 'KICK' || d.phase === 'KICK_REPLAY') drawKickOverlay(ctx, d, v, cam2, jx, jy);

  /* The referee speaks last, on top of everything. */
  drawRefBubbles(ctx, d, v, cam2, jx, jy);
}

function drawOpenPlayOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.op!;
  const glz = s.carrierZ - s.gained * s.dir;
  const a = project(cam, v, s.carrierX - 16, 0.03, glz, jx, jy);
  const b = project(cam, v, s.carrierX + 16, 0.03, glz, jx, jy);
  if (a && b) {
    ctx.strokeStyle = 'rgba(255,215,106,0.5)'; ctx.lineWidth = 2.5; ctx.setLineDash([9, 7]);
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    ctx.setLineDash([]);
  }
  const cp = project(cam, v, s.carrierX, 0, s.carrierZ, jx, jy);
  if (cp) {
    const zone = zoneLabel(s.z, s.dir);
    const pc = project(cam, v, s.carrierX, 2.2, s.carrierZ, jx, jy);
    if (pc) {
      const w = pc.sc * 1.6, hgt = Math.max(3, pc.sc * 0.09);
      const p = Math.min(1, s.pressure);
      ctx.fillStyle = 'rgba(14,14,20,0.6)';
      ctx.fillRect(pc.sx - w / 2, pc.sy, w, hgt);
      ctx.fillStyle = p > 0.75 ? '#ff6a5a' : p > 0.45 ? '#ffd76a' : '#6ee7a0';
      ctx.fillRect(pc.sx - w / 2, pc.sy, w * p, hgt);
      ctx.strokeStyle = 'rgba(244,239,226,0.5)'; ctx.lineWidth = 1;
      ctx.strokeRect(pc.sx - w / 2, pc.sy, w, hgt);
    }
    worldLabel(ctx, cam, v, s.carrierX, 3.1, s.carrierZ,
      `PHASE ${s.phase} · +${s.gained.toFixed(1)} m · ${s.toLine.toFixed(0)} m TO GO · ZONE ${zone}`,
      s.lineBreak ? '#6ee7a0' : '#cfcabb', jx, jy);
  }
}

function zoneLabel(z: number, dir: number): string {
  const toLine = Math.abs(dir * 50 - z);
  if (toLine <= 22) return 'A (THEIR 22)';
  if (toLine <= 50) return 'B (THEIR HALF)';
  if (toLine <= 78) return 'C (OUR HALF)';
  return 'D (OUR 22)';
}

function drawKickOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.kk!;
  if (s.history.length > 2) {
    ctx.strokeStyle = 'rgba(255,235,170,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath();
    let started = false;
    for (const h of s.history) {
      const p = project(cam, v, h.x, h.y, h.z, jx, jy);
      if (!p) continue;
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,235,170,0.22)'; ctx.lineWidth = 2;
    ctx.beginPath(); started = false;
    for (const h of s.history) {
      const p = project(cam, v, h.x, 0.02, h.z, jx, jy);
      if (!p) continue;
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }
  if (s.type === 'FIFTY_22') {
    const tz = s.dir * 28;
    const a = project(cam, v, -35, 0.03, tz, jx, jy);
    const b = project(cam, v, 35, 0.03, tz, jx, jy);
    if (a && b) {
      ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, '22 — LAND IN FIELD, OUT BEYOND THIS', (a.sx + b.sx) / 2, a.sy - 10, '#ffd76a');
    }
  }
  const cp = project(cam, v, s.bx, 0, s.bz, jx, jy);
  if (cp) {
    if (s.profile.atGoal && s.goalProb > 0) {
      worldLabel(ctx, cam, v, s.bx, s.by + 2.4, s.bz,
        `${s.goalDistance.toFixed(0)} M · ${s.goalAngle.toFixed(0)}° OFF · ${(s.goalProb * 100).toFixed(0)}%`,
        s.goalProb > 0.7 ? '#6ee7a0' : s.goalProb > 0.45 ? '#ffd76a' : '#ff6a5a', jx, jy);
    } else {
      worldLabel(ctx, cam, v, s.bx, s.by + 2.6, s.bz, s.profile.label.toUpperCase(), '#f4efe2', jx, jy);
    }
  }
}

function drawMaulOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.ml!;
  const t0 = project(cam, v, s.x - 12, 0.03, s.tryLineZ, jx, jy);
  const t1 = project(cam, v, s.x + 12, 0.03, s.tryLineZ, jx, jy);
  if (t0 && t1) {
    ctx.strokeStyle = '#ffe58a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(t0.sx, t0.sy); ctx.lineTo(t1.sx, t1.sy); ctx.stroke();
    label(ctx, 'TRY LINE', (t0.sx + t1.sx) / 2, t0.sy - 10, '#ffe58a');
  }

  const bar = (team: 'A' | 'D', f: number, off: number, col: string) => {
    const len = Math.min(4.5, (f / 6000) * 4.0);
    const sgn = team === 'A' ? 1 : -1;
    const a = project(cam, v, s.x + off, 2.7, s.z - s.dir * sgn * 0.5, jx, jy);
    const b = project(cam, v, s.x + off, 2.7, s.z - s.dir * sgn * (0.5 + len), jx, jy);
    if (!a || !b) return;
    ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    label(ctx, `${(f / 1000).toFixed(2)} kN`, (a.sx + b.sx) / 2, (a.sy + b.sy) / 2 - 12, col);
  };
  if (s.stage !== 'EXIT' && s.stage !== 'OVER') {
    bar('A', s.forceA, -2.4, '#ff6a5a');
    bar('D', s.forceD, 2.4, '#7fa3e6');
  }

  const rankCols = ['#ff6a5a', '#ffd76a', '#6ee7a0'];
  const rp = project(cam, v, s.x, 2.0, s.z, jx, jy);
  if (rp) {
    label(ctx, `BALL AT RANK ${s.ballRank + 1}/${s.ranks}${s.ballRank >= s.ranks - 1 ? ' — SAFE' : ''}`,
      rp.sx, rp.sy, rankCols[Math.min(2, s.ballRank)]);
  }

  const cp = project(cam, v, s.x, 0, s.z, jx, jy);
  if (cp) {
    const toLine = Math.abs(s.tryLineZ - s.z);
    const spdCol = s.speed > 0.6 ? '#6ee7a0' : s.speed > 0.12 ? '#ffd76a' : '#ff6a5a';
    worldLabel(ctx, cam, v, s.x, 4.2, s.z,
      `+${s.gained.toFixed(1)} m · ${s.speed.toFixed(2)} m/s · ${toLine.toFixed(1)} m TO GO`, spdCol, jx, jy);
    const stall = s.stallClock > 0 ? `STOPPED ${s.stallClock.toFixed(1)}s` : s.stoppedOnce ? 'STOPPED ONCE' : 'DRIVING';
    const contest = s.contest === 'PENDING'
      ? `RE-GATE ${s.regateWindows.length}/4`
      : s.humanWinShare === null
        ? s.contest.replace('_', ' ')
        : `${s.contest === 'ATTACK_CONTROL' ? 'ATTACK' : 'DEFENCE'} CONTROL ${(s.humanWinShare * 100).toFixed(0)}%`;
    const exit = s.exit === 'NONE' ? '' : ` · ${s.exit.replace(/_/g, ' ')}`;
    worldLabel(ctx, cam, v, s.x, 3.5, s.z,
      `${contest}${exit} · ${stall} · WHEEL ${s.yaw > 0 ? '+' : ''}${s.yaw.toFixed(0)}°`, s.useItCalled ? '#ff6a5a' : '#f4efe2', jx, jy);
    if (maulUseItCall(s)) {
      const remaining = maulUseItClock(s);
      const band = remaining > 2 ? '#6ee7a0' : remaining > 1 ? '#ffd76a' : '#ff6a5a';
      ctx.font = '900 22px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(14,14,20,0.85)';
      ctx.strokeText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
      ctx.fillStyle = band;
      ctx.fillText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
      ctx.textAlign = 'left';
    }
  }
}

function drawBreakdownOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.bd!;
  const dir = s.attacking === 'A' ? 1 : -1;

  const gl0 = project(cam, v, s.contactX - 6, 0.02, s.contactZ - s.gainLine * dir, jx, jy);
  const gl1 = project(cam, v, s.contactX + 6, 0.02, s.contactZ - s.gainLine * dir, jx, jy);
  if (gl0 && gl1 && s.stage !== 'SET' && s.stage !== 'CARRY') {
    ctx.strokeStyle = 'rgba(255,215,106,0.6)'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(gl0.sx, gl0.sy); ctx.lineTo(gl1.sx, gl1.sy); ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, 'GAIN LINE', (gl0.sx + gl1.sx) / 2, gl0.sy - 8, 'rgba(255,215,106,0.85)');
  }

  if (s.ruckFormed) {
    for (const side of [1, -1]) {
      const a = project(cam, v, s.contactX - 7, 0.02, s.contactZ + side * dir * 1.4, jx, jy);
      const b = project(cam, v, s.contactX + 7, 0.02, s.contactZ + side * dir * 1.4, jx, jy);
      if (!a || !b) continue;
      ctx.strokeStyle = side > 0 ? 'rgba(127,163,230,0.5)' : 'rgba(255,106,90,0.5)';
      ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (s.jackalActive && !s.ruckFormed) {
    const p = project(cam, v, s.ball.x, 0.02, s.ball.z, jx, jy);
    if (p) {
      const pulse = 0.7 + Math.sin(s.t * 14) * 0.3;
      ctx.strokeStyle = `rgba(255,90,70,${pulse})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(p.sx, p.sy, p.sc * 0.7, p.sc * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
      label(ctx, 'COMMIT - SPACE', p.sx, p.sy - p.sc * 0.5, '#ff8a72');
    }
  }

  if (s.stage === 'RUCK' || s.stage === 'PLACE') {
    const share = s.power.A + s.power.B > 0 ? s.power.A / (s.power.A + s.power.B) : 0.5;
    const cx0 = project(cam, v, s.contactX, 4.2, s.contactZ, jx, jy);
    if (cx0) {
      const w = Math.max(64, cx0.sc * 5.2), h = 7;
      const x0 = cx0.sx - w / 2, y0 = cx0.sy;
      ctx.fillStyle = 'rgba(14,14,20,0.72)';
      ctx.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
      ctx.fillStyle = '#ff6a5a';
      ctx.fillRect(x0, y0, w * share, h);
      ctx.fillStyle = '#7fa3e6';
      ctx.fillRect(x0 + w * share, y0, w * (1 - share), h);
      const ax = x0 + w * ((s.axis + 1) / 2);
      ctx.fillStyle = '#f4efe2';
      ctx.fillRect(ax - 2.5, y0 - 4, 5, h + 8);
      const fA = (s.power.A / 100).toFixed(1), fB = (s.power.B / 100).toFixed(1);
      label(ctx, `${fA} kN`, x0 + w * 0.5, y0 - 14, '#ff8a72');
      label(ctx, `${fB} kN`, x0 + w * 0.5, y0 + h + 16, '#9db8ec');
    }
  }

  const limit = [1.5, 3, 5][d.options.ruckLaw ?? 2];
  if (s.groundAt >= 0) {
    const elapsed = s.t - s.groundAt;
    const remaining = Math.max(0, limit - elapsed);
    const band = remaining > 2 ? '#6ee7a0' : remaining > 1 ? '#ffd76a' : '#ff6a5a';
    const cp = project(cam, v, s.contactX, 0, s.contactZ, jx, jy);
    if (cp) {
      if (s.stage === 'RECYCLE') {
        ctx.font = '900 22px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(14,14,20,0.85)';
        ctx.strokeText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
        ctx.fillStyle = band;
        ctx.fillText(`${remaining.toFixed(0)}`, cp.sx, cp.sy - 10);
        ctx.textAlign = 'left';
      }
      const gain = s.gainLine;
      worldLabel(ctx, cam, v, s.contactX, 3.1, s.contactZ,
        `${gain >= 0 ? '+' : ''}${gain.toFixed(1)} m · PHASE ${s.phase}`, '#f4efe2', jx, jy);
    }
  }
}

function drawScrumOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.scrim!;
  const ax = d.scrumAnchor.x, az = d.scrumAnchor.z;
  const active = ['ENGAGE', 'STEADY', 'FEED', 'STRIKE', 'DRIVE', 'BASE'].includes(s.stage);
  if (!active) return;

  const fA = s.packs.A.forceTransmitted, fB = s.packs.B.forceTransmitted;
  const draw = (team: 'A' | 'B') => {
    const f = team === 'A' ? fA : fB;
    const len = Math.min(3.2, (f / 8000) * 2.6) * (team === 'A' ? 1 : -1);
    const from = project(cam, v, ax + (team === 'A' ? -1.9 : 1.9), 3.1, az + 1.9 * (team === 'A' ? 1 : -1), jx, jy);
    const to = project(cam, v, ax + (team === 'A' ? -1.9 : 1.9), 3.1, az + (1.9 + len) * (team === 'A' ? 1 : -1), jx, jy);
    if (!from || !to) return;
    const col = team === 'A' ? '#ff6a5a' : '#7fa3e6';
    ctx.strokeStyle = col; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(from.sx, from.sy); ctx.lineTo(to.sx, to.sy); ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.sx, to.sy, 7, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    label(ctx, `${(f / 1000).toFixed(2)} kN`, (from.sx + to.sx) / 2, (from.sy + to.sy) / 2 - 12, col);
  };
  draw('A'); draw('B');

  /* PART 3 — THE ENGAGEMENT AXIS, DRAWN.
   *
   * The packs face down the pitch (world z), never across it: A drives
   * toward +z, B toward −z. The authored headings live in
   * game/behaviour/setpiece-overrides.ts and are consumed by BOTH the engine
   * (Live.face, via scrumFaceSign) and the 3D rig (st.face, via
   * scrumFacing). Painting the axis here means a pack that is ever rotated
   * towards a touchline again is visible immediately instead of being
   * something you have to notice in the models. */
  const axisA = project(cam, v, ax, 0.05, az - 4.2, jx, jy);
  const axisB = project(cam, v, ax, 0.05, az + 4.2, jx, jy);
  if (axisA && axisB) {
    ctx.strokeStyle = 'rgba(244,239,226,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(axisA.sx, axisA.sy); ctx.lineTo(axisB.sx, axisB.sy); ctx.stroke();
    ctx.setLineDash([]);
  }

  worldLabel(ctx, cam, v, ax, 3.6, az,
    `DRIVE ${(s.netDrive * 100).toFixed(0)} cm · WHEEL ${s.yaw > 0 ? '+' : ''}${s.yaw.toFixed(1)}° · RISK ${(Math.min(1, s.collapseRisk) * 100).toFixed(0)}%`,
    '#f4efe2', jx, jy);
}

function drawLineoutOverlay(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const s = d.lo!;
  const tp = project(cam, v, s.call.targetX, 0, s.markZ, jx, jy);
  if (tp && (s.stage === 'CALL' || s.stage === 'THROW' || s.stage === 'CONTEST')) {
    ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.ellipse(tp.sx, tp.sy, tp.sc * 0.55, tp.sc * 0.2, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (s.ball.state === 'FLIGHT' && s.history.length > 2) {
    ctx.strokeStyle = 'rgba(255,235,170,0.55)'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (let i = Math.max(0, s.history.length - 26); i < s.history.length; i++) {
      const h = s.history[i];
      const p = project(cam, v, h.ballX, h.ballY, s.markZ, jx, jy);
      if (!p) continue;
      if (!started) { ctx.moveTo(p.sx, p.sy); started = true; } else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();
  }
  if (s.winner) {
    const j = s.players.find((p) => p.id === s.ball.heldBy);
    if (j) {
      const p = project(cam, v, j.x, j.handY + 0.35, j.z, jx, jy);
      if (p) label(ctx, `${j.handY.toFixed(2)} m`, p.sx, p.sy, '#ffd76a');
    }
  }
  if (s.stage === 'CONTEST' || s.stage === 'CATCH') {
    worldLabel(ctx, cam, v, -26, 5.6, s.markZ,
      `APEX ${s.ball.apexY.toFixed(2)} m · MARGIN ${(s.contestMargin * 100).toFixed(0)} cm`, '#f4efe2', jx, jy);
  }
}

/* ==================== SPEC_15 — THE REFEREE'S SPEECH BUBBLE ==================== */
const BUBBLE_COLOUR: Record<string, string> = {
  CARD: '#ff6a5a',
  PENALTY: '#ffd76a',
  LAW_CALL: '#f4efe2',
  NARRATIVE: '#9db8ec',
  NUDGE: '#ffd76a',
};

/** Above the official's head: GLB referee is ~1.8 m + RENDER_SCALE; keep the
 *  bubble clear of the 3D model's head regardless of zoom. */
const REF_HEAD_Y = 3.0;

type Pt = [number, number];

function drawBubble(
  ctx: CanvasRenderingContext2D, v: View,
  sx: number, sy: number, sc: number,
  text: string, colour: string,
) {
  const size = Math.max(10, Math.min(17, sc * 0.26));
  ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
  const pad = size * 0.9;
  const w = Math.min(v.w - 28, ctx.measureText(text).width + pad * 2);
  const h = size * 2.0;
  const gap = size * 0.95;

  let cy = sy - gap - h / 2;
  const below = cy - h / 2 < 8;
  if (below) cy = sy + gap + h / 2;

  const m = 10;
  const cx = Math.max(m + w / 2, Math.min(v.w - m - w / 2, sx));
  cy = Math.max(m + h / 2, Math.min(v.h - m - h / 2, cy));

  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  const c = Math.min(9, h * 0.3);
  const pts: Pt[] = [
    [x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c],
    [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c],
  ];
  const ty = below ? y0 : y1;
  const tw = Math.min(12, w * 0.18);
  const tail: Pt[] = [[cx - tw, ty], [cx + tw, ty], [sx, sy]];

  ctx.fillStyle = 'rgba(14,14,20,0.92)';
  ctx.strokeStyle = colour;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tail[0][0], tail[0][1]);
  ctx.lineTo(tail[2][0], tail[2][1]);
  ctx.lineTo(tail[1][0], tail[1][1]);
  ctx.closePath();
  ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
  ctx.lineWidth = 2; ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 2.4; ctx.stroke();

  ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(text, cx, cy + 1);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
}

export function drawRefBubbles(ctx: CanvasRenderingContext2D, d: Director, v: View, cam: Camera, jx: number, jy: number) {
  const head = d.refBubbleHead();
  if (head) {
    const p = project(cam, v, d.ref.x, REF_HEAD_Y, d.ref.z, jx, jy);
    if (p) drawBubble(ctx, v, p.sx, p.sy, p.sc, head.text, BUBBLE_COLOUR[head.kind] ?? '#f4efe2');
  }
  const prompt = d.refPrompt();
  if (prompt) {
    const p = project(cam, v, prompt.x, prompt.y, prompt.z, jx, jy);
    if (p) drawBubble(ctx, v, p.sx, p.sy, p.sc, prompt.text, prompt.colour);
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string) {
  ctx.font = '900 13px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(14,14,20,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour; ctx.fillText(text, x, y);
}

function worldLabel(
  ctx: CanvasRenderingContext2D, cam: Camera, v: View,
  wx: number, wy: number, wz: number, text: string, colour: string,
  jx: number, jy: number,
) {
  const p = project(cam, v, wx, wy, wz, jx, jy);
  if (!p) return;
  if (p.sx < -200 || p.sx > v.w + 200) return;
  const size = Math.max(9, Math.min(16, p.sc * 0.26));
  ctx.font = `900 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(3, size * 0.3); ctx.strokeStyle = 'rgba(14,14,20,0.85)';
  ctx.strokeText(text, p.sx, p.sy);
  ctx.fillStyle = colour;
  ctx.fillText(text, p.sx, p.sy);
}

export { drawMinimap } from './minimap';

/* ---------------- wipe transition ---------------- */
export function drawWipe(ctx: CanvasRenderingContext2D, v: View, w: number) {
  if (w <= 0.001) return;
  const h = v.h * w;
  ctx.fillStyle = '#101017';
  ctx.fillRect(0, 0, v.w, h * 0.5);
  ctx.fillRect(0, v.h - h * 0.5, v.w, h * 0.5);
  ctx.fillStyle = '#e8cf46';
  ctx.fillRect(0, h * 0.5 - 3, v.w, 6);
  ctx.fillRect(0, v.h - h * 0.5 - 3, v.w, 6);
  if (w > 0.6) {
    ctx.globalAlpha = (w - 0.6) / 0.4;
    ctx.fillStyle = '#101017';
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.globalAlpha = 1;
  }
}

export function debugPoly(v: View): [number, number][] {
  return [[0, 0], [v.w, 0], [v.w, v.h], [0, v.h]];
}
