import { useEffect, useRef, useState } from 'react';
import { Game } from './render/scene';
import {
  Scoreboard, ControlPanel, FocusAndPhase, Banner, PromptBar, Ticker,
  Minimap, drawMinimap, StatsOverlay, PauseOverlay, FullTimeOverlay, HudState,
} from './ui/hud';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    const game = new Game();
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = cv.clientWidth || 960, h = cv.clientHeight || 540;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let last = performance.now();
    let acc = 1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      game.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      game.render(ctx, { w: cv.width / dpr, h: cv.height / dpr });
      if (miniRef.current) drawMinimap(miniRef.current, game);
      acc += dt;
      if (acc > 0.12) { acc = 0; setHud(game.hud()); }
    };
    raf = requestAnimationFrame(loop);

    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyA': case 'ArrowLeft': game.input.left = true; break;
        case 'KeyD': case 'ArrowRight': game.input.right = true; break;
        case 'Space': game.input.spaceHit = true; game.input.held = true; game.input.space = true; break;
        case 'Escape': game.paused = !game.paused; break;
        case 'Tab': setShowStats(s => !s); break;
        case 'KeyR': game.startReplay(); break;
        case 'BracketLeft': game.speed = clamp(game.speed - 0.25, 0.5, 1.6); break;
        case 'BracketRight': game.speed = clamp(game.speed + 0.25, 0.5, 1.6); break;
        default: break;
      }
    };
    const ku = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyA': case 'ArrowLeft': game.input.left = false; break;
        case 'KeyD': case 'ArrowRight': game.input.right = false; break;
        case 'Space': game.input.held = false; game.input.space = false; break;
        default: break;
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      game.zoom = clamp(game.zoom - e.deltaY * 0.0008, 0, 1);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    wrapRef.current?.addEventListener('wheel', wheel, { passive: false });
    const wr = wrapRef.current;
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      wr?.removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative h-screen w-screen overflow-hidden" style={{ background: '#0b0e16' }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ imageRendering: 'auto' }} />
      {hud && (
        <>
          <Scoreboard h={hud} />
          <ControlPanel h={hud} />
          <Minimap canvasRef={miniRef} h={hud} />
          <FocusAndPhase h={hud} />
          <Banner h={hud} />
          <PromptBar h={hud} />
          <Ticker h={hud} />
          {showStats && <StatsOverlay h={hud} />}
          {hud.paused && !showStats && <PauseOverlay />}
          {hud.over && <FullTimeOverlay h={hud} />}
        </>
      )}
    </div>
  );
}
