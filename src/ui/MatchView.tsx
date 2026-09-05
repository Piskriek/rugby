import { useEffect, useRef, useState } from 'react';
import { Director, Input, NO_INPUT, MatchConfig } from '../game/director';
import { drawMatch, drawWipe } from '../render/scene';
import { drawFacingStrafeOverlay } from '../render/facingDebug';
import { drawMinimap } from '../render/minimap';
import { drawCRT, project } from '../render/retro';
import { ThreeCanvas } from '../render/ThreeCanvas';
import { ThreePlayerManager } from '../render/ThreePlayerManager';
import { Btn, Panel, Kbd } from './kit';
import { DIFFICULTY_TABLE } from '../game/data';
import { contractFor } from '../game/jlr';
import { SpaceRemap } from './SpaceRemap';
import { TutorialOverlay, CameraPanel } from './TutorialOverlay';
import { stepAt } from '../game/tutorial';

/** Every verb, one key. Remappable by editing this table. */
export const KEYMAP: Record<string, string> = {
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
  w: 'up', arrowup: 'up',
  s: 'down', arrowdown: 'down',
  ' ': 'action',
  shift: 'sprint',
  j: 'passL', k: 'passR',
  u: 'cutL', o: 'cutR',
  l: 'kick', h: 'grubber', p: 'drop',
  i: 'contact', f: 'fend', g: 'step',
  x: 'tackleDive', c: 'tackleSmother',
  e: 'dummy', q: 'switchPlayer',
  r: 'replay', tab: 'stats', escape: 'pause',
  /* SPEC_06 — B toggles the facing/strafe debug overlay (view/gait/lat). */
  b: 'animDebug',
};

export function MatchView({ cfg, onExit, onFinish, clinic, objective, tutorial }: {
  cfg: MatchConfig; onExit: () => void;
  onFinish: (r: { a: number; b: number; events: unknown[] }) => void;
  clinic?: boolean;
  objective?: { name: string; target: string; margin: number } | null;
  tutorial?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dirRef = useRef<Director | null>(null);
  /** The transparent WebGL overlay (GLB squad) and its asset manager. */
  const threeRef = useRef<ThreeCanvas | null>(null);
  const playersRef = useRef<ThreePlayerManager | null>(null);
  const threeDivRef = useRef<HTMLDivElement | null>(null);
  const keys = useRef<Set<string>>(new Set());
  const prev = useRef<Set<string>>(new Set());
  const [, force] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [tick, setTick] = useState(0);
  const [slow, setSlow] = useState(1);
  /* SPEC_06 — always-available facing/strafe debug overlay, off by default. */
  const [showAnimDebug, setShowAnimDebug] = useState(false);

  if (!dirRef.current) {
    dirRef.current = new Director(cfg);
    if (tutorial) dirRef.current.startTutorial();
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) e.preventDefault();
      keys.current.add(k);
      /* T-10 — browser policy: audio may only start inside a user gesture. */
      dirRef.current?.audio.userGesture();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      dirRef.current?.setZoom(dirRef.current.zoom + Math.sign(e.deltaY) * 0.08);
    };
    const c = canvasRef.current;
    c?.addEventListener('wheel', wheel, { passive: false });
    return () => c?.removeEventListener('wheel', wheel);
  }, []);

  /* The 3D layer: one transparent WebGL canvas composited directly over the
   * 2D pitch canvas, plus the pooled GLB player manager. Created once. */
  useEffect(() => {
    const host = threeDivRef.current;
    if (!host) return;
    const three = new ThreeCanvas(host);
    const players = new ThreePlayerManager(three);
    threeRef.current = three;
    playersRef.current = players;
    players.load().catch((e) => console.error('player GLB load failed', e));
    return () => {
      three.dispose();
      threeRef.current = null;
      playersRef.current = null;
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const d = dirRef.current!;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const inp: Input = { ...NO_INPUT };
      for (const raw of keys.current) {
        const m = KEYMAP[raw];
        if (!m) continue;
        switch (m) {
          case 'left': inp.left = true; break;
          case 'right': inp.right = true; break;
          case 'up': inp.up = true; break;
          case 'down': inp.down = true; break;
          case 'action': inp.sprint = true; break;
          case 'sprint': inp.sprint = true; break;
          case 'passL': inp.passL = true; break;
          case 'passR': inp.passR = true; break;
          case 'cutL': inp.cutL = true; break;
          case 'cutR': inp.cutR = true; break;
          case 'kick': inp.kick = true; break;
          case 'grubber': inp.grubber = true; break;
          case 'drop': inp.drop = true; break;
          case 'contact': inp.contact = true; break;
          case 'fend': inp.fend = true; break;
          case 'step': inp.step = true; break;
          case 'dummy': inp.dummy = true; break;
          case 'tackleDive': inp.tackleDive = true; break;
          case 'tackleSmother': inp.tackleSmother = true; break;
          case 'switchPlayer': inp.switchPlayer = true; break;
        }
      }
      // space is sprint while held and action on the edge
      const pressed = new Set<string>();
      for (const raw of keys.current) if (!prev.current.has(raw)) pressed.add(KEYMAP[raw] ?? raw);
      /* Playtest P1.4: hold-to-kick needs the RELEASE edge too. */
      const released = new Set<string>();
      for (const raw of prev.current) if (!keys.current.has(raw)) released.add(KEYMAP[raw] ?? raw);
      inp.run = inp.sprint;
      prev.current = new Set(keys.current);

      // The tutorial card resumes on the keys it lists, and only those.
      if (d.tut.active && d.tut.showing) {
        const step = stepAt(d.tut.index);
        if (step && step.resumeOn.some((k) => pressed.has(k))) {
          d.resumeTutorial();
          force((n) => n + 1);
        }
      }
      if (pressed.has('pause')) { d.paused = !d.paused; force((n) => n + 1); }
      if (pressed.has('stats')) setShowStats((v) => !v);
      if (pressed.has('replay')) { if (!d.phase.includes('REPLAY')) d.enterReplay('REPLAY'); }
      /* SPEC_06 — B toggles the facing/strafe debug overlay. */
      if (pressed.has('animDebug')) setShowAnimDebug((v) => !v);

      d.gameSpeed = slow;
      d.update(dt, inp, pressed, released);

      /* ---- draw ---- */
      const cv = canvasRef.current;
      if (cv) {
        const ctx = cv.getContext('2d')!;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== w * devicePixelRatio || cv.height !== h * devicePixelRatio) {
          cv.width = w * devicePixelRatio; cv.height = h * devicePixelRatio;
        }
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        const view = { w, h };

        /* Camera shake: one offset per frame, shared by the 2D pitch and the
         * 3D overlay so players and pitch lines shake as one. */
        const jx = d.cam.shake ? (Math.random() - 0.5) * d.cam.shake * 14 : 0;
        const jy = d.cam.shake ? (Math.random() - 0.5) * d.cam.shake * 11 : 0;

        drawMatch(ctx, d, view, playersRef.current ?? undefined, { x: jx, y: jy });
        /* Feet markers (rings, range, kick aim) are painted on the 2D layer
         * BEFORE the 3D squad so the GLB players stand on top of them. */
        drawIndicators(ctx, d, view);

        /* ---- 3D GLB squad overlay (transparent WebGL canvas above) ---- */
        const three = threeRef.current;
        if (three) {
          three.resize();
          three.syncCamera({ ...d.cam, shake: 0 }, view, jx, jy);
          playersRef.current?.update(d, view, d.cam, dt);
          three.render();
        }
        /* SPEC_06 — facing/strafe live per-actor readouts (toggle with B). */
        if (showAnimDebug) drawFacingStrafeOverlay(ctx, d.phase, view);
        if ((d.options.radar ?? 1) === 1) drawMinimap(ctx, d, view);
        const crt = d.options.crt ?? 1;
        if (crt > 0) drawCRT(ctx, view, crt === 2 ? 1.6 : 1);
        if (d.phase.includes('REPLAY')) {
          ctx.fillStyle = 'rgba(232,207,70,0.92)'; ctx.fillRect(0, 12, 78, 18);
          ctx.fillStyle = '#14161d'; ctx.font = '900 11px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText('● REPLAY', 8, 25);
        }
        if (d.t - d.bannerAt < 2.2) {
          ctx.font = '900 28px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.globalAlpha = Math.min(1, (2.2 - (d.t - d.bannerAt)) / 0.6);
          ctx.lineWidth = 6; ctx.strokeStyle = '#14161d';
          ctx.strokeText(d.banner, view.w / 2, view.h * 0.28);
          ctx.fillStyle = '#e8cf46'; ctx.fillText(d.banner, view.w / 2, view.h * 0.28);
          ctx.globalAlpha = 1; ctx.textAlign = 'left';
        }
        if (d.paused) drawWipe(ctx, view, 0.5);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ui = setInterval(() => setTick((t) => t + 1), 110);
    return () => { cancelAnimationFrame(raf); clearInterval(ui); };
  }, [slow, showAnimDebug]);

  const d = dirRef.current!;
  const A = d.A, B = d.B;
  const density = ['MINIMAL', 'STANDARD', 'FULL', 'TELEMETRY'][d.options.hud ?? 1];
  const ctrl = d.ctrlPlayer;
  const contract = ctrl ? contractFor(ctrl.num) : null;

  const commandBar = () => {
    if (d.hint) return d.hint;
    if (d.phase === 'KICK' && d.kk) {
      return d.kk.stage === 'AIM'
        ? `A / D AIM THE KICK · SPACE TO SET POWER — ${d.kk.profile.label}`
        : d.kk.power === 0 ? 'SPACE TO SET POWER — STOP IN THE GOLD BAND' : 'SPACE TO SET ACCURACY';
    }
    if (d.phase === 'SCRUM' && d.scrim) {
      if (d.scrim.stage === 'ASSEMBLE') return d.scrim.cadence || 'FORMING THE SCRUM';
      return `${d.scrim.cadence} — POUND A / D TO PUSH THE PACK`;
    }
    if (d.phase === 'LINEOUT' && d.lo) {
      return d.lo.stage === 'ASSEMBLE' ? 'FORMING THE LINEOUT'
        : d.lo.stage === 'CALL' ? `A / D CALL · SPACE TO THROW — ${d.lo.call.label}`
          : d.lo.stage === 'THROW' ? 'SPACE INSIDE THE GOLD BAND FOR A STRAIGHT THROW' : 'THE BALL IS IN THE AIR';
    }
    if (d.phase === 'BREAKDOWN' && d.bd) {
      return `${d.bd.stage} — A / D POUND TO CLEAR OUT · SPACE COMMITS ONE MORE (${d.bd.commitA} IN)`;
    }
    if (d.phase === 'MAUL' && d.ml) return d.maulPrompt();
    /* Playtest P1.12: the verb strip under the commentary is gone — the
     * top-left CONTROLS widget is the one source of truth, and a second
     * copy was just noise over the feed. */
    return '';
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-black">
      {/* Layer 0 — the 2D pitch canvas (grass, lines, minimap, CRT, banners). */}
      <canvas ref={canvasRef} className="absolute inset-0 z-0 h-full w-full" />
      {/* Layer 1 — transparent WebGL: the GLB squad stands ON the pitch but
       * UNDER the HUD. z-index 1 sits above the pitch canvas (0) and below the
       * HUD wrapper (z-10), fixing the players painting over the score bar /
       * commentary. */}
      <div ref={threeDivRef} className="pointer-events-none absolute inset-0 z-[1]" />
      {/* Layer 2 — every HUD panel lives inside this wrapper so the 3D players
       * can never cover the score bar, commentary, or phase readouts. */}
      <div className="pointer-events-none absolute inset-0 z-10">

      {/* LIVE CONTROL PANEL — top left, most logical action highlighted */}
      {(d.options.showControls ?? 1) > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 w-[232px]">
          <div className="border-2 border-[#3d4b66] bg-[#0d1220]/95 px-2 py-1.5">
            <div className="mb-1 flex items-baseline justify-between border-b border-[#26314a] pb-0.5">
              <span className="text-[8px] font-black tracking-[0.24em] text-[#7f8ea6]">CONTROLS</span>
              <span className="text-[8px] tracking-[0.16em] text-[#6f7f96]">{d.phase.replace('_', ' ')}</span>
            </div>
            <div className="space-y-0.5">
              {d.actionBar
                .filter((a) => (d.options.showControls ?? 1) === 2
                  || a.primary
                  || ['A / D', 'SPACE', 'J', 'K', 'X', 'C'].includes(a.key))
                .slice(0, (d.options.showControls ?? 1) === 2 ? 99 : 7)
                .map((a, i) => (
                  <div key={i} className={`flex items-baseline gap-1.5 ${a.primary ? 'bg-[#6ee7a0]/15 px-1' : ''}`}>
                    <span className={`min-w-[44px] text-right text-[9px] font-black ${a.primary ? 'text-[#6ee7a0]' : 'text-[#e8cf46]'}`}>{a.key}</span>
                    <span className={`truncate text-[9px] leading-tight ${a.primary ? 'font-black text-[#6ee7a0]' : 'text-[#a9b6c8]'}`}>
                      {a.label}{a.primary ? ' ◀' : ''}
                    </span>
                  </div>
                ))}
            </div>
            <div className="mt-1 border-t border-[#26314a] pt-0.5 text-[7px] leading-tight text-[#5f6f86]">
              SPACE = {d.contextVerb.label} · changeable in OPTIONS
            </div>
          </div>
        </div>
      )}

      {/* SCORE BAR */}
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
        <div className="border-2 border-[#e8cf46] bg-[#0d1220]/95 px-3 py-1">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-black text-[#e2664f]">{A.nation.short}</span>
            <span className="text-[22px] font-black tabular-nums text-[#f4efe2]">{A.score}</span>
            <span className="text-[11px] text-[#6f7f96]">v</span>
            <span className="text-[22px] font-black tabular-nums text-[#f4efe2]">{B.score}</span>
            <span className="text-[15px] font-black text-[#7fa3e6]">{B.nation.short}</span>
            <span className="ml-2 border-l border-[#3d4b66] pl-2 text-[11px] tabular-nums text-[#e8cf46]">{d.clockText}</span>
            <span className="text-[9px] tracking-[0.2em] text-[#6f7f96]">{d.half === 1 ? '1ST HALF' : '2ND HALF'}</span>
            <span className="text-[9px] tracking-[0.2em] text-[#8fa0b8]">{DIFFICULTY_TABLE[d.difficulty]?.name}</span>
          </div>
          {objective && (
            <div className="mt-0.5 text-[9px] tracking-[0.16em] text-[#e8cf46]">
              {objective.name} — TARGET {objective.target}
            </div>
          )}
          {(d.live.some((p) => p.sinbin > 0)) && (
            <div className="mt-0.5 flex gap-2">
              {(['A', 'B'] as const).map((t) => {
                const binned = d.live.filter((p) => p.team === t && p.sinbin > 0);
                if (!binned.length) return null;
                return (
                  <span key={t} className="inline-flex items-center gap-1 border border-[#e8cf46] bg-[#2a2412] px-1 text-[9px] font-black text-[#e8cf46]">
                    <span className="h-2 w-2 rounded-sm bg-[#e8cf46]" />
                    {d.teams[t].nation.short} 14 — {binned.map((p) => p.num).join(', ')} IN BIN
                  </span>
                );
              })}
            </div>
          )}
          {density !== 'MINIMAL' && (
            <div className="mt-0.5 flex items-center gap-2 text-[9px] tracking-[0.16em] text-[#8fa0b8]">
              <span className={d.possession === 'A' ? 'text-[#e2664f]' : 'text-[#7fa3e6]'}>
                {d.possession === 'A' ? '◀ ' + A.nation.short : B.nation.short + ' ▶'}
              </span>
              <span>·</span><span>{d.phase.replace('_', ' ')}</span>
              {d.op && <><span>·</span><span>PHASE {d.op.phase}</span></>}
              {d.momentum !== 0 && <><span>·</span><span className={d.momentum > 0 ? 'text-[#e2664f]' : 'text-[#7fa3e6]'}>MOMENTUM {d.momentum > 0 ? A.nation.short : B.nation.short}</span></>}
            </div>
          )}
        </div>
      </div>

      {/* CONTROLLED PLAYER NAMEPLATE — four channels so you always know who you are */}
      {ctrl && (
        <div className="pointer-events-none absolute left-3 top-[196px] w-[232px]">
          <div className="border-2 border-[#6ee7a0] bg-[#0d1220]/95 px-2 py-1">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-black text-[#6ee7a0]">
                {ctrl.num} {A.players[ctrl.num - 1]?.name.split(' ').slice(-1)[0] ?? ''}
              </span>
              <span className="text-[8px] tracking-[0.16em] text-[#8fa0b8]">{contract?.pos}</span>
            </div>
            <div className="mt-0.5 h-1 w-full bg-[#0a0e16]">
              <div className="h-full bg-[#6ee7a0]" style={{ width: `${ctrl.stamina}%` }} />
            </div>
            <div className="mt-0.5 text-[8px] leading-tight text-[#7f8ea6]">{ctrl.job || 'SUPPORT'}</div>
          </div>
        </div>
      )}

      {/* PHASE PANELS */}
      <div className={`pointer-events-none absolute left-3 ${ctrl ? 'top-[258px]' : 'top-[196px]'} w-[232px] space-y-1`}>
        {(d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk && (
          <Panel title="KICK-O-METER">
            <div className="text-[10px] font-black text-[#f4efe2]">{d.kk.profile.label}</div>
            <div className="text-[9px] text-[#7f8ea6]">{d.kk.kickerName} · KICKING</div>
            <div className="relative mt-1 h-4 border border-[#3d4b66] bg-[#0a0e16]">
              <div className="absolute inset-y-0" style={{ left: '62%', width: '18%', background: 'rgba(110,231,160,0.34)' }} />
              <div className="absolute inset-y-0 w-[3px] bg-[#e8cf46]" style={{ left: `${d.kk.meter * 100}%` }} />
              <div className="absolute right-1 top-0 text-[9px] font-black text-[#7f8ea6]">{d.kk.power > 0 ? 'ACCURACY' : 'POWER'}</div>
            </div>
            {d.kk.profile.atGoal && (
              <div className="mt-1 flex justify-between text-[9px] text-[#cfd8e6]">
                <span>{d.kk.goalDistance.toFixed(0)} m</span>
                <span>{d.kk.goalAngle.toFixed(0)}°</span>
                <span className={d.kk.goalProb > 0.7 ? 'text-[#6ee7a0]' : d.kk.goalProb > 0.45 ? 'text-[#e8cf46]' : 'text-[#ff6a5a]'}>
                  {(d.kk.goalProb * 100).toFixed(0)}%
                </span>
              </div>
            )}
          </Panel>
        )}
        {d.phase === 'LINEOUT' && d.lo && (
          <Panel title="LINEOUT">
            <div className="text-[11px] font-black text-[#f4efe2]">{d.lo.call.label}</div>
            <div className="text-[9px] text-[#7f8ea6]">{d.lo.call.jumpers} IN THE LINE · {d.lo.stage}</div>
            {d.lo.stage === 'THROW' && (
              <div className="relative mt-1 h-3 border border-[#3d4b66] bg-[#0a0e16]">
                <div className="absolute inset-y-0" style={{ left: '55%', width: '20%', background: 'rgba(110,231,160,0.3)' }} />
                <div className="h-full w-[3px] bg-[#e8cf46]" style={{ marginLeft: `${d.lo.meter * 100}%` }} />
              </div>
            )}
          </Panel>
        )}
        {d.phase === 'SCRUM' && d.scrim && (
          <Panel title="SCRUM">
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>REFEREE</span><span className="font-black text-[#e8cf46]">{d.scrim.cadence || d.scrim.stage}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>FEED</span><span className="text-[#f4efe2]">{d.teams[d.scrim.feed].nation.short}</span></div>
            <div className="mt-1 h-2 w-full border border-[#3d4b66] bg-[#0a0e16]">
              <div className="h-full bg-[#6ee7a0]" style={{ width: `${(1 - Math.min(1, d.scrim.collapseRisk)) * 100}%` }} />
            </div>
            <div className="text-[8px] text-[#7f8ea6]">STABILITY · DRIVE {(d.scrim.netDrive * 100).toFixed(0)} cm</div>
          </Panel>
        )}
        {d.phase === 'BREAKDOWN' && d.bd && (
          <Panel title="BREAKDOWN">
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>STAGE</span><span className="text-[#f4efe2]">{d.bd.stage}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]">
              <span>COMMITTED</span><span className="text-[#f4efe2]">{d.bd.commitA} v {d.bd.commitB}</span>
            </div>
            <div className="mt-1 h-2 w-full border border-[#3d4b66] bg-[#0a0e16]">
              <div className="h-full bg-[#e8cf46]" style={{ width: `${Math.min(100, (d.bd.waggle / 4.2) * 100)}%` }} />
            </div>
            <div className="text-[8px] text-[#7f8ea6]">CLEAR-OUT · EP {d.bd.expectedPoints.toFixed(2)}</div>
          </Panel>
        )}
        {d.phase === 'MAUL' && d.ml && (
          <Panel title="MAUL">
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>BALL AT RANK</span><span className="text-[#f4efe2]">{d.ml.ballRank + 1}/{d.ml.ranks}</span></div>
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>CONTEST</span><span className="text-[#f4efe2]">{d.ml.contest === 'PENDING' ? `RE-GATE ${d.ml.regateWindows.length}/4` : d.ml.contest.replace(/_/g, ' ')}</span></div>
            {d.ml.humanWinShare !== null && <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>HUMAN SHARE</span><span className="text-[#e8cf46]">{(d.ml.humanWinShare * 100).toFixed(1)}%</span></div>}
            {d.ml.exit !== 'NONE' && <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>EXIT</span><span className="text-[#6ee7a0]">{d.ml.exit.replace(/_/g, ' ')}</span></div>}
            <div className="flex justify-between text-[9px] text-[#7f8ea6]"><span>SPEED</span><span className="text-[#f4efe2]">{d.ml.speed.toFixed(2)} m/s</span></div>
          </Panel>
        )}
        {d.phase === 'OPEN_PLAY' && d.op && density !== 'MINIMAL' && ctrlTeam(d) === d.op.attacking && (
          <Panel title="OPEN PLAY">
            <div className="h-2 w-full border border-[#3d4b66] bg-[#0a0e16]">
              <div className="h-full" style={{
                width: `${d.op.pressure * 100}%`,
                background: d.op.pressure > 0.66 ? '#ff6a5a' : d.op.pressure > 0.34 ? '#e8cf46' : '#6ee7a0',
              }} />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-[#7f8ea6]">
              <span>{d.op.toLine.toFixed(0)} m TO THE LINE</span>
              <span className={d.op.lineBreak ? 'text-[#6ee7a0]' : ''}>{d.op.lineBreak ? 'LINE BREAK' : `+${d.op.gained.toFixed(1)} m`}</span>
            </div>
            {d.passOpts.length > 0 && (
              <div className="mt-1 text-[8px] leading-tight text-[#7f8ea6]">
                PASS OPTIONS: {d.passOpts.map((o) => `${o.player.num} (${(100 - o.risk * 100).toFixed(0)}%)`).join(' · ')}
              </div>
            )}
          </Panel>
        )}
      </div>

      {/* COMMENTARY: a two-hander, because that is why it worked */}
      {(d.options.commentary ?? 2) > 0 && (
        <div className="pointer-events-none absolute bottom-[104px] left-1/2 w-[min(700px,74%)] -translate-x-1/2">
          <div className="border-2 border-[#e8cf46] bg-[#0d1220]/95 px-3 py-1 text-center">
            <div className="text-[11px] font-black leading-tight tracking-[0.04em] text-[#f4efe2]">{d.feed[0]?.text ?? 'AND WE ARE UNDER WAY'}</div>
            {d.feed[0]?.text2 && <div className="text-[10px] leading-tight text-[#c9a94a]">{d.feed[0].text2}</div>}
          </div>
          {d.refSignal > 0 && (
            <div className="mt-1 border-2 border-[#c8402f] bg-[#2a1420]/95 px-3 py-0.5 text-center text-[10px] font-black tracking-[0.2em] text-[#ffb0a0]">
              REFEREE: {d.refSignalText}
            </div>
          )}
        </div>
      )}

      {/* PHASE NARRATIVE — what is happening now, and what to do next.
          This is the answer to "there is no sense of what is going on after a
          tackle". It is always on screen and always current. */}
      {(() => {
        const n = d.narrative;
        return (
          <div className="pointer-events-none absolute bottom-3 left-1/2 w-[min(620px,80%)] -translate-x-1/2">
            <div className={`border-2 bg-[#0d1220]/96 px-4 py-1.5 ${n.danger ? 'border-[#ff6a5a]' : 'border-[#3d4b66]'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[12px] font-black tracking-[0.04em] ${n.danger ? 'text-[#ff6a5a]' : 'text-[#f4efe2]'}`}>
                  {n.now}
                </span>
                {n.clock > 0 && (
                  <span className={`shrink-0 text-[11px] font-black tabular-nums ${n.danger ? 'text-[#ff6a5a]' : 'text-[#e8cf46]'}`}>
                    {n.clock.toFixed(1)}s
                  </span>
                )}
              </div>
              {n.next && <div className="text-[10px] leading-tight text-[#6ee7a0]">▸ {n.next}</div>}
              <div className="mt-0.5 border-t border-[#26314a] pt-0.5 text-[9px] tracking-[0.08em] text-[#7f8ea6]">
                {commandBar() || 'A/D RUN · SPACE SPRINT'}
              </div>
            </div>
          </div>
        );
      })()}

      {/* TACTIC CHIP */}
      <div className="pointer-events-none absolute bottom-3 left-3">
        <div className="border-2 border-[#3d4b66] bg-[#0d1220]/95 px-3 py-1 text-[9px] tracking-[0.14em] text-[#8fa0b8]">
          <span className="text-[#e8cf46]">{A.nation.short}</span> {A.backline.replace('BL-', '')}/{A.defence.replace('DF-', '')} ·
          W {A.sliders.find((s) => s.id === 'width')?.v} T {A.sliders.find((s) => s.id === 'tempo')?.v} K {A.sliders.find((s) => s.id === 'kickFreq')?.v}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 text-right text-[9px] text-[#7f8ea6]">
        <div><Kbd>ESC</Kbd> PAUSE · <Kbd>TAB</Kbd> STATS · <Kbd>R</Kbd> REPLAY · WHEEL ZOOM</div>
        <div className="mt-0.5">GAME SPEED {Math.round(slow * 100)}% — <button className="pointer-events-auto text-[#e8cf46]" onClick={() => setSlow(slow === 1 ? 0.75 : slow === 0.75 ? 0.5 : slow === 0.5 ? 0.35 : 1)}>CHANGE</button></div>
        {showAnimDebug && <div className="mt-0.5 text-[#ffd76a]"><Kbd>B</Kbd> FACING/STRAFE DEBUG ON — TOGGLE</div>}
      </div>

      {/* STATS */}
      {showStats && (
        <div className="pointer-events-auto absolute right-3 top-3 w-[300px]">
          <Panel title="LIVE STATISTICS">
            <div className="grid grid-cols-[46px_1fr_46px] gap-x-2 text-[10px]">
              {([
                ['TACKLES', 'tackles'], ['TURNOVERS', 'turnovers'], ['JACKALS', 'jackals'],
                ['SCRUMS WON', 'scrumsWon'], ['LINEOUTS WON', 'lineoutsWon'], ['RUCKS', 'rucks'],
                ['SLOW BALL', 'slowBall'], ['PASSES', 'passes'], ['KICKS', 'kicks'],
                ['CARRIES', 'carries'], ['LINE BREAKS', 'lineBreaks'], ['TACKLES BEAT', 'tacklesBroke'],
                ['OFFLOADS', 'offloads'], ['OFFSIDES', 'offsides'], ['PENALTIES', 'penaltiesConceded'],
              ] as const).map(([label, key]) => <StatRow key={key} label={label} a={A.stats[key]} b={B.stats[key]} />)}
            </div>
            <div className="mt-2 border-t border-[#26314a] pt-1 text-[9px] tracking-[0.08em] text-[#7f8ea6]">
              SET-PIECE EVENTS · SCRUMS {d.setPieceEvents.scrums} · LINEOUTS {d.setPieceEvents.lineouts}
            </div>
            <div className="mt-2 flex justify-end"><Btn small onClick={() => setShowStats(false)}>CLOSE</Btn></div>
          </Panel>
        </div>
      )}

      {/* PAUSE / HALF TIME / FULL TIME */}
      {(d.paused || d.over) && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center overflow-auto bg-black/75 p-6">
          {d.over ? (
            <div className="w-full max-w-3xl">
              <Panel title="FULL TIME">
                <div className="text-center text-4xl font-black text-[#f4efe2]">{A.nation.short} {A.score} — {B.score} {B.nation.short}</div>
                <div className="mt-1 text-center text-[10px] tracking-[0.3em] text-[#7f8ea6]">
                  {A.score === B.score ? 'HONOURS EVEN' : A.score > B.score ? `${A.nation.name} TAKE IT` : `${B.nation.name} TAKE IT`}
                </div>
                {objective && (
                  <div className="mt-2 border-2 border-[#e8cf46] bg-[#161a10] p-2 text-center">
                    <div className="text-[10px] tracking-[0.2em] text-[#7f8ea6]">SCENARIO OBJECTIVE</div>
                    <div className="text-[13px] font-black text-[#e8cf46]">{objective.name} — {objective.target}</div>
                    {(() => {
                      const mine = cfg.homeId === A.nation.id ? A.score : B.score;
                      const theirs = cfg.homeId === A.nation.id ? B.score : A.score;
                      const ok = mine - theirs >= objective.margin;
                      return (
                        <div className={`mt-1 text-[13px] font-black ${ok ? 'text-[#6ee7a0]' : 'text-[#ff6a5a]'}`}>
                          {ok ? 'HISTORY REWRITTEN' : 'THE RECORD STILL STANDS'} · MARGIN {mine - theirs}
                        </div>
                      );
                    })()}
                  </div>
                )}
                <div className="mt-3 grid gap-2 text-[10px] sm:grid-cols-2">
                  {([['A', A, '#e2664f'], ['B', B, '#7fa3e6']] as const).map(([k, T, col]) => (
                    <div key={k} className="border border-[#26314a] p-2">
                      <div className="font-black" style={{ color: col }}>{T.nation.short} TOP THREE</div>
                      {[...T.players].sort((x, y) => (y.tackles + y.carries + y.breaks * 3 + y.metres / 20) - (x.tackles + x.carries + x.breaks * 3 + x.metres / 20)).slice(0, 3)
                        .map((p) => (
                          <div key={p.num} className="text-[#cfd8e6]">
                            {p.num} {p.name} · {p.carries} CARRIES / {p.tackles} TACKLES{p.breaks ? ` / ${p.breaks} BREAKS` : ''}
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
                <div className="mt-3 max-h-40 overflow-auto border border-[#26314a] p-2 text-[10px] text-[#a9b6c8]">
                  {d.events.length === 0 && <div className="text-[#6f7f96]">A TRYLESS GRIND. NO SCORE EVENTS.</div>}
                  {d.events.slice().reverse().map((e, i) => (
                    <div key={i} className="grid grid-cols-[36px_1fr] gap-2">
                      <span className="tabular-nums text-[#6f7f96]">{e.min}'</span>
                      <span className={e.team === 'A' ? 'text-[#e2664f]' : e.team === 'B' ? 'text-[#7fa3e6]' : ''}>{e.text}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex justify-end"><Btn onClick={() => onFinish({ a: A.score, b: B.score, events: d.events })}>CONTINUE</Btn></div>
              </Panel>
            </div>
          ) : d.clock === 0 && d.half === 2 ? (
            <div className="w-full max-w-2xl">
              <Panel title="HALF TIME">
                <div className="text-center text-3xl font-black text-[#f4efe2]">{A.nation.short} {A.score} — {B.score} {B.nation.short}</div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
                  <div className="space-y-1">
                    <div className="font-black tracking-[0.2em] text-[#e8cf46]">COACH REPORT</div>
                    <div className="text-[#a9b6c8]">
                      {A.stats.slowBall / Math.max(1, A.stats.rucks) > 0.34
                        ? 'Our ball is too slow. Commit more at the breakdown or go wide sooner.'
                        : 'Our recycle is quick enough — the wide channels are there.'}
                    </div>
                    <div className="text-[#a9b6c8]">
                      {A.stats.penaltiesConceded > B.stats.penaltiesConceded
                        ? 'We are giving too much away at the breakdown. Drop the aggression.'
                        : 'Discipline has been good. Hold it.'}
                    </div>
                    {A.stats.tacklesBroke > 3 && <div className="text-[#a9b6c8]">We are beating defenders but not finishing. Use the overlap.</div>}
                  </div>
                  <div className="space-y-1">
                    <div className="font-black tracking-[0.2em] text-[#e8cf46]">KEY NUMBERS</div>
                    <div className="text-[#cfd8e6]">TACKLES {A.stats.tackles}–{B.stats.tackles}</div>
                    <div className="text-[#cfd8e6]">TURNOVERS {A.stats.turnovers}–{B.stats.turnovers}</div>
                    <div className="text-[#cfd8e6]">LINEOUT WINS {A.stats.lineoutsWon}–{B.stats.lineoutsWon}</div>
                    <div className="text-[#cfd8e6]">SET-PIECE EVENTS S {d.setPieceEvents.scrums} · L {d.setPieceEvents.lineouts}</div>
                    <div className="text-[#cfd8e6]">LINE BREAKS {A.stats.lineBreaks}–{B.stats.lineBreaks}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="border border-[#26314a] p-2">
                    <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">FRONT ROW GAS — BENCH {A.subsUsed}/{['0', '2', '3', '5', '7'][d.options.subs ?? 2]}</div>
                    {[...A.players].slice(0, 8).sort((x, y) => {
                      const fx = d.live.find((p) => p.team === 'A' && p.num === x.num)?.stamina ?? 100;
                      const fy = d.live.find((p) => p.team === 'A' && p.num === y.num)?.stamina ?? 100;
                      return fx - fy;
                    }).slice(0, 4).map((p) => {
                      const st = d.live.find((q) => q.team === 'A' && q.num === p.num)?.stamina ?? 100;
                      return (
                        <div key={p.num} className="flex items-center justify-between border border-[#26314a] px-2 py-1 text-[9px]">
                          <span className="text-[#cfd8e6]">{p.num} {p.name.split(' ').slice(-1)[0]}</span>
                          <span className="tabular-nums text-[#7f8ea6]">{Math.round(st)}%</span>
                          <Btn small onClick={() => { d.makeSub('A', p.num); force((n) => n + 1); }}>SUB</Btn>
                        </div>
                      );
                    })}
                  </div>
                  <div className="border border-[#26314a] p-2 text-[9px] text-[#7f8ea6]">
                    <div className="mb-1 font-black tracking-[0.2em] text-[#7f8ea6]">DESIGNATED KICKER</div>
                    <div className="text-[#cfd8e6]">{A.players[A.kicker - 1].name} — SHIRT {A.kicker}</div>
                    <div className="mt-1">Every goal kick is taken by this man. Change him on the squad sheet.</div>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Btn danger onClick={onExit}>ABANDON</Btn>
                  <Btn onClick={() => d.resumeSecondHalf()}>SECOND HALF</Btn>
                </div>
              </Panel>
            </div>
          ) : (
            <div className="w-full max-w-2xl">
              <Panel title="PAUSED">
                <div className="text-center text-2xl font-black text-[#f4efe2]">{A.nation.short} {A.score} — {B.score} {B.nation.short}</div>
                <div className="mt-1 text-center text-[10px] tracking-[0.24em] text-[#7f8ea6]">{d.clockText} · {d.half === 1 ? 'FIRST HALF' : 'SECOND HALF'}</div>
                <div className="mt-3 text-center text-[10px] leading-relaxed text-[#a9b6c8]">
                  {d.hint || `YOU ARE ${ctrl ? `CONTROLLING ${ctrl.num} ${A.players[ctrl.num - 1]?.name ?? ''}` : 'IN PLAY'}. ${contract ? contract.job.OPEN_PLAY ?? 'SUPPORT THE CARRIER' : ''}`}
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Btn onClick={() => { d.paused = false; force((n) => n + 1); }}>RESUME</Btn>
                  <Btn onClick={() => { d.camMode = d.camMode === 'BROADCAST' ? 'CHASE' : d.camMode === 'CHASE' ? 'TACTICAL' : 'BROADCAST'; force((n) => n + 1); }}>CAMERA: {d.camMode}</Btn>
                  <Btn onClick={() => { d.options.radar = (d.options.radar ?? 1) === 1 ? 0 : 1; force((n) => n + 1); }}>RADAR {(d.options.radar ?? 1) === 1 ? 'ON' : 'OFF'}</Btn>
                  <Btn onClick={() => { d.assists.pass = d.assists.pass > 0.5 ? 0.2 : 1; d.assists.tackle = d.assists.pass; d.assists.kick = d.assists.pass; force((n) => n + 1); }}>
                    ASSISTS {d.assists.pass > 0.5 ? 'ON' : 'OFF'}
                  </Btn>
                  <Btn onClick={() => { if (!d.phase.includes('REPLAY')) d.enterReplay('REPLAY'); }}>INSTANT REPLAY</Btn>
                  <Btn danger onClick={onExit}>QUIT TO MENU</Btn>
                </div>
                <CameraPanel d={d} force={force} />
                <SpaceRemap d={d} force={force} />
                {/* SPEC_07 (T-67 backstop): the scoreTry idempotence guard's
                    watchdog log. A blocked duplicate score trigger is shown
                    HERE — a silent guard-block is an unexplained score. The
                    watchdog trip count rides along because a trip near the
                    goal line is T-67's suspected double-score trigger. */}
                <div className="mt-3 border border-[#26314a] p-2">
                  <div className="font-black tracking-[0.2em] text-[#7f8ea6]">
                    SCORE GUARD — {d.tryGuardBlocks} DUPLICATE TRIGGER{d.tryGuardBlocks === 1 ? '' : 'S'} BLOCKED
                    {d.watchdogTrips > 0 ? ` · WATCHDOG TRIPS ${d.watchdogTrips}` : ''}
                  </div>
                  {d.tryGuardLog.length === 0 ? (
                    <div className="mt-1 text-[9px] text-[#6f7f96]">TRY LOCK CLEAN — NO DUPLICATE SCORE ATTEMPTS INTERCEPTED THIS MATCH.</div>
                  ) : (
                    <div className="mt-1 max-h-24 space-y-0.5 overflow-auto text-[9px] text-[#ff9d8c]">
                      {d.tryGuardLog.slice().reverse().map((l, i) => (
                        <div key={i} className="tabular-nums">{l}</div>
                      ))}
                    </div>
                  )}
                  <div className="mt-1 text-[8px] tracking-[0.12em] text-[#6f7f96]">
                    LOCK ENGAGES THE FRAME A TRY IS AWARDED · CLEARS ON RESTART KICKOFF OR WATCHDOG RESET
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px] text-[#7f8ea6] sm:grid-cols-3">
                  {[
                    ['A/D', 'RUN'], ['SHIFT', 'SPRINT'], ['SPACE', 'CONTEXT ACTION'], ['J / K', 'PASS L / R'],
                    ['U / O', 'CUT-OUT'], ['E', 'DUMMY'], ['L', 'PUNT'],
                    ['H', 'GRUBBER'], ['P', 'DROP GOAL'], ['I', 'TAKE CONTACT'],
                    ['F', 'FEND'], ['G', 'STEP'], ['X', 'DIVING TACKLE'],
                    ['C', 'SMOTHER'], ['Q', 'SWITCH DEFENDER'], ['R', 'REPLAY'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between"><span className="text-[#e8cf46]">{k}</span><span>{v}</span></div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}

      {clinic && (
        <div className="pointer-events-auto absolute left-1/2 top-3 flex max-w-[90%] -translate-x-1/2 flex-wrap justify-center gap-1 border-2 border-[#e8cf46] bg-[#0d1220]/95 p-2">
          <span className="w-full text-center text-[9px] tracking-[0.24em] text-[#7f8ea6]">SKILLS CLINIC — SEVEN DRILLS, ONE PER VERB</span>
          <Btn small onClick={() => d.startScrum('A', 0, 0)}>SCRUM</Btn>
          <Btn small onClick={() => d.startLineout('A', 10, 8)}>LINEOUT</Btn>
          <Btn small onClick={() => d.startKick('A', 'GOAL', { x: 12, z: 32 })}>GOAL KICK WIDE</Btn>
          <Btn small onClick={() => d.startKick('A', 'GOAL', { x: 0, z: 38 })}>GOAL KICK FRONT</Btn>
          <Btn small onClick={() => d.startKick('A', 'PUNT', { x: 0, z: -20 })}>PUNT</Btn>
          <Btn small onClick={() => d.startKick('A', 'GRUBBER', { x: 0, z: 20 })}>GRUBBER</Btn>
          <Btn small onClick={() => d.startMaul('A', 0, 20, 5, true)}>MAUL</Btn>
          <Btn small onClick={() => d.startOpen('A', 0, -10, 13, 1)}>RUN AND PASS</Btn>
        </div>
      )}
      </div>{/* end HUD wrapper (z-10) */}

      <TutorialOverlay d={d} force={force} onExit={onExit} />
      <span className="hidden">{tick}</span>
    </div>
  );
}

/* ---- in-world indicators: pass target, tackle range, kick aim ---- */
function ctrlTeam(d: Director): 'A' | 'B' | null {
  return d.ctrlPlayer ? d.ctrlPlayer.team : null;
}

function drawIndicators(ctx: CanvasRenderingContext2D, d: Director, v: { w: number; h: number }) {
  const cam = { ...d.cam, shake: 0 };

  // pass-target markers: you always know who you are passing to
  // (playtest P3.9: only ever drawn on the HUMAN side's teammates)
  if (d.phase === 'OPEN_PLAY' && d.passOpts.length && d.op && ctrlTeam(d) === d.op.attacking
    && d.isHuman(d.op.attacking)) {
    for (const o of d.passOpts) {
      const p = project(cam, v, o.player.x, 0.02, o.player.z);
      if (!p) continue;
      const r = Math.max(7, p.sc * 0.36);
      ctx.strokeStyle = '#6ee7a0';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.ellipse(p.sx, p.sy, r, r * 0.4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '900 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,14,20,0.9)';
      ctx.strokeText(`${o.side < 0 ? 'J' : 'K'}${o.cutOut ? '·U/O' : ''} ${o.player.num}`, p.sx, p.sy - r * 0.9);
      ctx.fillStyle = '#6ee7a0';
      ctx.fillText(`${o.side < 0 ? 'J' : 'K'}${o.cutOut ? '·U/O' : ''} ${o.player.num}`, p.sx, p.sy - r * 0.9);
      ctx.textAlign = 'left';
    }
  }

  /* Playtest P3.9: the Q-switch was invisible — three rings mark the
   * defenders Q cycles through, the brightest on the one you control. */
  if (d.phase === 'OPEN_PLAY' && d.op && d.op.attacking !== ctrlTeam(d)) {
    const carP = d.live.find((q) => q.team === d.op!.attacking && q.num === d.op!.carrierNum);
    if (carP) {
      const cands = d.live
        .filter((q) => q.team === ctrlTeam(d) && q.sinbin <= 0 && !q.down)
        .sort((a, b) => Math.hypot(a.x - carP.x, a.z - carP.z) - Math.hypot(b.x - carP.x, b.z - carP.z))
        .slice(0, 3);
      for (const q of cands) {
        const p = project(cam, v, q.x, 0.02, q.z);
        if (!p) continue;
        const mine = q === d.ctrlPlayer;
        ctx.strokeStyle = mine ? '#6ee7a0' : 'rgba(110,231,160,0.45)';
        ctx.lineWidth = mine ? 3 : 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, Math.max(8, p.sc * 0.4), Math.max(3.2, p.sc * 0.16), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (mine) {
          ctx.font = '900 10px ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#6ee7a0';
          ctx.fillText('Q', p.sx, p.sy - Math.max(8, p.sc * 0.4) - 3);
          ctx.textAlign = 'left';
        }
      }
    }
  }

  // tackle range ring: exactly how far the dive reaches
  if (d.phase === 'OPEN_PLAY' && d.op) {
    const ctrl = d.ctrlPlayer;
    if (ctrl && ctrl.team !== d.op.attacking) {
      const p = project(cam, v, ctrl.x, 0.02, ctrl.z);
      if (p) {
        ctx.strokeStyle = 'rgba(255,106,90,0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, p.sc * 3.5, p.sc * 1.4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /* KICK AIM LINE.
   * The line drawn on the grass IS the kick. Its length is the power you are
   * holding, and its end is where the ball will land. Hold longer, the line
   * grows. Release, and it goes there — give or take the kicker's accuracy,
   * which is drawn as the width of the landing ellipse. */
  if ((d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk && (d.kk.stage === 'AIM' || d.kk.stage === 'METER')) {
    const s = d.kk;
    const a = project(cam, v, s.bx, 0.05, s.bz);
    const b = project(cam, v, s.landX, 0.05, s.landZ);
    const reach = Math.hypot(s.landX - s.bx, s.landZ - s.bz);
    if (a && b) {
      const power = Math.max(0.02, s.power);
      // The line thickens and brightens as power builds.
      ctx.strokeStyle = `rgba(255,215,106,${0.4 + power * 0.55})`;
      ctx.lineWidth = 2 + power * 5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.setLineDash([]);
      // Landing ellipse: wide when the kicker is inaccurate, tight when he is not.
      const acc = d.kickerAccuracy(s);
      const spread = 14 + (1 - acc) * 46;
      ctx.strokeStyle = acc > 0.75 ? '#6ee7a0' : acc > 0.5 ? '#ffd76a' : '#ff6a5a';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(b.sx, b.sy, spread, spread * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '900 12px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      const label = `${reach.toFixed(0)} m · ${(power * 100).toFixed(0)}% POWER`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(12,14,20,0.9)';
      ctx.strokeText(label, b.sx, b.sy - spread * 0.5 - 8);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(label, b.sx, b.sy - spread * 0.5 - 8);
      if (s.stage === 'AIM') {
        ctx.strokeText('HOLD SPACE TO BUILD POWER', b.sx, b.sy + spread * 0.5 + 16);
        ctx.fillStyle = '#6ee7a0';
        ctx.fillText('HOLD SPACE TO BUILD POWER', b.sx, b.sy + spread * 0.5 + 16);
      }
      ctx.textAlign = 'left';
    }
  }

  // controlled-player ring, drawn last so it is never hidden
  const c = d.ctrlPlayer;
  if (c) {
    const p = project(cam, v, c.x, 0.03, c.z);
    if (p) {
      ctx.strokeStyle = '#6ee7a0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, Math.max(9, p.sc * 0.44), Math.max(4, p.sc * 0.18), 0, 0, Math.PI * 2);
      ctx.stroke();
      /* T-52 SPRINT METER — the tank lives under the ring, on the pitch,
       * because that is where the player's eyes are when SHIFT runs dry.
       * Hidden while full; colour walks green -> amber -> red as it drains. */
      if (c.stamina < 99.5) {
        const bw = Math.max(9, p.sc * 0.44) * 1.7;
        const bx = p.sx - bw / 2;
        const by = p.sy + Math.max(4, p.sc * 0.18) + 4;
        ctx.fillStyle = 'rgba(12,14,20,0.78)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
        const st = Math.max(0, Math.min(100, c.stamina)) / 100;
        ctx.fillStyle = st > 0.5 ? '#6ee7a0' : st > 0.25 ? '#ffd76a' : '#ff6a5a';
        ctx.fillRect(bx, by, bw * st, 3);
      }
    }
  }
}

function StatRow({ label, a, b }: { label: string; a: number; b: number }) {
  const total = Math.max(1, a + b);
  return (
    <>
      <div className="text-right font-black tabular-nums text-[#e2664f]">{a}</div>
      <div>
        <div className="text-center text-[8px] tracking-[0.16em] text-[#7f8ea6]">{label}</div>
        <div className="flex h-1 w-full bg-[#0a0e16]">
          <div className="bg-[#c8402f]" style={{ width: `${(a / total) * 100}%` }} />
          <div className="bg-[#2f4f9c]" style={{ width: `${(b / total) * 100}%` }} />
        </div>
      </div>
      <div className="font-black tabular-nums text-[#7fa3e6]">{b}</div>
    </>
  );
}
