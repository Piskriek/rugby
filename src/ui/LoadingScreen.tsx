/**
 * LoadingScreen — the match-start loading overlay.
 *
 * This exists because building the world is not free: the turf maps, the
 * stadium geometry and a 6.3 MB rigged GLB all have to be ready before the
 * first frame. Previously that work ran synchronously inside a `useEffect`
 * with nothing on screen, so the browser could not paint or answer input and
 * the tab appeared to hang — the "freeze".
 *
 * The fix is two-part and this component is only the visible half: the loader
 * yields to the event loop between stages (see `bootStages` in MatchView) so
 * the browser stays responsive, and this overlay tells the player what is
 * happening while it does.
 */
import { useEffect, useState } from 'react';

export interface LoadStage {
  label: string;
  /** 0..1 fraction of total work this stage represents. */
  weight: number;
}

export function LoadingScreen({
  stage, progress, homeName, awayName, venue,
}: {
  stage: string;
  progress: number;
  homeName?: string;
  awayName?: string;
  venue?: string;
}) {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? '' : d + '.')), 320);
    return () => clearInterval(id);
  }, []);

  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));

  return (
    <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#0a0e16]">
      <div className="w-full max-w-xl px-8">
        <div className="text-center">
          <div className="text-[10px] font-black tracking-[0.6em] text-[#7f8ea6]">
            NOW ENTERING
          </div>
          {homeName && awayName ? (
            <h2 className="mt-3 text-3xl font-black tracking-[0.04em] text-[#f4efe2] sm:text-4xl">
              {homeName} <span className="text-[#e8cf46]">v</span> {awayName}
            </h2>
          ) : (
            <h2 className="mt-3 text-3xl font-black tracking-[0.04em] text-[#f4efe2]">
              LOADING
            </h2>
          )}
          {venue && (
            <div className="mt-2 text-[11px] font-black tracking-[0.34em] text-[#e8cf46]">
              {venue}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-10">
          <div className="h-3 w-full border-2 border-[#2a3546] bg-[#111725]">
            <div
              className="h-full bg-[#e8cf46] transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-black tracking-[0.2em] text-[#7f8ea6]">
            <span>{stage.toUpperCase()}{dots}</span>
            <span>{pct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
