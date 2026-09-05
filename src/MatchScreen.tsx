import { useEffect, useRef, useState } from 'react';
import { RugbySim } from './rugby/engine';
import { Camera, draw, drawMinimap } from './rugby/render';
import type { InputState, MatchOpts } from './rugby/types';
import { NO_INPUT } from './rugby/types';

/** key → engine input verb. W/S/A/D are attack-relative (W = toward the
 * opponent's try line). */
const KEYMAP: Record<string, string> = {
  w: 'fwd', arrowup: 'fwd',
  s: 'back', arrowdown: 'back',
  a: 'left', arrowleft: 'left',
  d: 'right', arrowright: 'right',
  shift: 'sprint',
  ' ': 'context',
  j: 'passL', k: 'passR',
  l: 'punt', h: 'grubber', p: 'drop',
  x: 'tackle', q: 'switchP',
  f: 'fend', g: 'step',
};

const STEP = 1 / 60;

export function MatchScreen({ cfg, onExit }: { cfg: MatchOpts; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<RugbySim | null>(null);
  const camRef = useRef<Camera | null>(null);
  const keys = useRef<Set<string>>(new Set());
  const prev = useRef<Set<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState({ fps: 0, stepMs: 0 });
  const perfRef = useRef({ fps: 0, stepMs: 0 });
  const [, setTick] = useState(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  if (!simRef.current) {
    simRef.current = new RugbySim(cfg);
    camRef.current = new Camera();
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (KEYMAP[k]) e.preventDefault();
      if (k === 'escape') { setPaused((p) => !p); return; }
      keys.current.add(k);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let fps = 0, frames = 0, fpsT = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const sim = simRef.current!;
      const cam = camRef.current!;
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;

      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      fpsT += dt; frames++;
      if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }

      const view = { w: cv.clientWidth, h: cv.clientHeight };
      if (view.w === 0) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== view.w * dpr || cv.height !== view.h * dpr) {
        cv.width = view.w * dpr; cv.height = view.h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // fixed timestep simulation
      if (!pausedRef.current) {
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 5) {
          const held = buildHeld(keys.current, prev.current);
          const pressed = buildPressed(keys.current, prev.current);
          held.switchP = pressed.switchP; // switch is a discrete verb
          sim.step(STEP, held, pressed);
          prev.current = new Set(keys.current);
          acc -= STEP; steps++;
        }
        if (steps === 5) acc = 0; // drop backlog rather than spiral
        cam.update(dt, sim, view);
      }

      draw(ctx, view, sim, cam, now / 1000);
      drawMinimap(ctx, view, sim, sim.ctrlId);

      perfRef.current = { fps, stepMs: sim.lastStepMs };
    };
    raf = requestAnimationFrame(loop);
    // re-render the HUD a few times a second (score / clock / commentary),
    // NOT every frame — React reconciliation at 60 Hz would waste the budget
    const ui = setInterval(() => { setHud({ ...perfRef.current }); setTick((t) => t + 1); }, 200);
    return () => { cancelAnimationFrame(raf); clearInterval(ui); };
  }, []);

  const sim = simRef.current!;
  const top = sim.feed[0]?.text ?? 'AND WE ARE UNDER WAY';

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0f16]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* SCOREBOARD */}
      <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-stretch overflow-hidden border-2 border-[#26314a] bg-[#0d1220]/90 text-[#f4efe2]">
        <ScoreBlock name={sim.A.name} short={sim.A.short} score={sim.A.score} color={sim.A.color} align="left" />
        <div className="flex flex-col items-center justify-center border-x-2 border-[#26314a] px-4">
          <div className="text-[10px] font-black tracking-[0.2em] text-[#7f8ea6]">{sim.half === 1 ? '1ST HALF' : '2ND HALF'}</div>
          <div className="text-2xl font-black tabular-nums text-[#e8cf46]">{fmtClock(sim.clock)}</div>
        </div>
        <ScoreBlock name={sim.B.name} short={sim.B.short} score={sim.B.score} color={sim.B.color} align="right" />
      </div>

      {/* PHASE + POSSESSION */}
      <div className="pointer-events-none absolute left-3 top-3 border-2 border-[#26314a] bg-[#0d1220]/85 px-2 py-1 text-[9px] font-black tracking-[0.18em] text-[#7f8ea6]">
        <div className="text-[#e8cf46]">{sim.phase}</div>
        <div className="mt-0.5 text-[#8fa0b8]">
          POSSESSION: <span style={{ color: (sim.possession === 'A' ? sim.A.color : sim.B.color) }}>{sim.possession ? (sim.possession === 'A' ? sim.A.short : sim.B.short) : '—'}</span>
        </div>
        {sim.adv && <div className="mt-0.5 text-[#6ee7a0]">ADVANTAGE {(sim.adv.t ? '' : '')}</div>}
      </div>

      {/* PERFORMANCE (the "optimised" receipt) */}
      <div className="pointer-events-none absolute right-3 top-3 border-2 border-[#26314a] bg-[#0d1220]/85 px-2 py-1 text-right text-[9px] leading-relaxed text-[#7f8ea6]">
        <div><span className="text-[#6ee7a0]">{hud.fps}</span> FPS</div>
        <div>STEP {hud.stepMs.toFixed(2)} ms</div>
        <div>30 PLAYERS + BALL</div>
        <div className="text-[8px] text-[#5f6f86]">FIXED 60Hz TIMESTEP · GRID INDEX</div>
      </div>

      {/* COMMENTARY FEED */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 w-[min(640px,80%)] -translate-x-1/2 border-2 border-[#26314a] bg-[#0d1220]/92 px-3 py-1 text-center">
        <div className="text-[11px] font-black leading-tight text-[#f4efe2]">{top}</div>
      </div>

      {/* CONTROLS HINT */}
      <div className="pointer-events-none absolute bottom-3 left-3 text-[9px] leading-relaxed text-[#6f7f96]">
        <div><Kbd>W/A/S/D</Kbd> MOVE · <Kbd>SHIFT</Kbd> SPRINT</div>
        <div><Kbd>J/K</Kbd> PASS · <Kbd>L/H/P</Kbd> KICK · <Kbd>X</Kbd> TACKLE</div>
        <div><Kbd>Q</Kbd> SWITCH · <Kbd>SPACE</Kbd> ACTION · <Kbd>ESC</Kbd> PAUSE</div>
      </div>

      {sim.ended && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="border-2 border-[#e8cf46] bg-[#0d1220] p-8 text-center">
            <div className="text-[10px] font-black tracking-[0.4em] text-[#7f8ea6]">FULL TIME</div>
            <div className="mt-2 text-4xl font-black text-[#f4efe2]">{sim.A.score} – {sim.B.score}</div>
            <div className="mt-1 text-sm text-[#e8cf46]">
              {sim.winner ? `${sim.winner === 'A' ? sim.A.name : sim.B.name} WIN` : 'DRAW'}
            </div>
            <button onClick={onExit} className="mt-4 border-2 border-[#3d4b66] bg-[#1a2334] px-4 py-2 text-[11px] font-black tracking-[0.14em] text-[#cfd8e6] hover:border-[#e8cf46]">
              BACK TO SETUP
            </button>
          </div>
        </div>
      )}

      {paused && !sim.ended && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="w-[min(420px,90%)] border-2 border-[#3d4b66] bg-[#0d1220] p-6">
            <div className="text-xl font-black tracking-[0.12em] text-[#e8cf46]">PAUSED</div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[#8fa0b8]">
              {[
                ['W / A / S / D', 'MOVE (attack-relative)'],
                ['SHIFT', 'SPRINT'],
                ['J / K', 'PASS LEFT / RIGHT'],
                ['L', 'PUNT'], ['H', 'GRUBBER'], ['P', 'DROP GOAL'],
                ['X / SPACE', 'TACKLE'],
                ['F / G', 'FEND / STEP (carry)'],
                ['Q', 'SWITCH PLAYER'],
                ['ESC', 'PAUSE'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-[#e8cf46]">{k}</span><span>{v}</span></div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setPaused(false)} className="border-2 border-[#e8cf46] bg-[#e8cf46] px-4 py-2 text-[11px] font-black text-[#0a0e16]">RESUME</button>
              <button onClick={onExit} className="border-2 border-[#3d4b66] bg-[#1a2334] px-4 py-2 text-[11px] font-black text-[#cfd8e6]">QUIT</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBlock({ name, short, score, color, align }: {
  name: string; short: string; score: number; color: string; align: 'left' | 'right';
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <span className="inline-block h-5 w-5 border border-black/40" style={{ background: color }} />
      <div className={align === 'right' ? 'text-right' : ''}>
        <div className="text-[9px] font-black tracking-[0.14em] text-[#7f8ea6]">{short}</div>
        <div className="text-[10px] leading-none text-[#cfd8e6]">{name}</div>
      </div>
      <div className="text-2xl font-black tabular-nums">{score}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="mx-0.5 rounded border border-[#3d4b66] bg-[#101724] px-1 py-0.5 text-[#e8cf46]">{children}</span>;
}

function fmtClock(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function buildHeld(keys: Set<string>, _prev: Set<string>): InputState {
  const i: InputState = { ...NO_INPUT };
  for (const raw of keys) {
    switch (KEYMAP[raw]) {
      case 'fwd': i.fwd = true; break;
      case 'back': i.back = true; break;
      case 'left': i.left = true; break;
      case 'right': i.right = true; break;
      case 'sprint': i.sprint = true; break;
      case 'context': i.context = true; break;
    }
  }
  return i;
}

function buildPressed(keys: Set<string>, prev: Set<string>): InputState {
  const i: InputState = { ...NO_INPUT };
  for (const raw of keys) {
    if (prev.has(raw)) continue; // only fresh presses
    switch (KEYMAP[raw]) {
      case 'passL': i.passL = true; break;
      case 'passR': i.passR = true; break;
      case 'punt': i.punt = true; break;
      case 'grubber': i.grubber = true; break;
      case 'drop': i.drop = true; break;
      case 'tackle': i.tackle = true; break;
      case 'fend': i.fend = true; break;
      case 'step': i.step = true; break;
      case 'switchP': i.switchP = true; break;
      case 'context': i.context = true; break;
    }
  }
  return i;
}
