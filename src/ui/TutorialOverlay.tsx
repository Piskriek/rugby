import { Director } from '../game/director';
import { stepAt, TUTORIAL_STEPS } from '../game/tutorial';
import { Btn } from './kit';

/**
 * The tutorial card. Freezes over live play, names the contest, explains why it
 * exists, and lists exactly which keys resume the match. Play continues freely
 * after that until the player scores, or presses NEXT or RESET.
 */
export function TutorialOverlay({ d, force, onExit }: {
  d: Director; force: (f: (n: number) => number) => void; onExit: () => void;
}) {
  if (!d.tut.active) return null;
  const step = stepAt(d.tut.index);
  if (!step) return null;

  const next = () => { d.nextTutorialStep(); force((n) => n + 1); };
  const reset = () => { d.resetTutorialStep(); force((n) => n + 1); };

  return (
    <>
      {/* Persistent bar — always visible so the player is never lost */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 z-30 -translate-x-1/2">
        <div className="flex items-center gap-2 border-2 border-[#6ee7a0] bg-[#0d1220]/95 px-3 py-1.5">
          <span className="text-[9px] font-black tracking-[0.2em] text-[#6ee7a0]">
            TUTORIAL {d.tut.index + 1}/{TUTORIAL_STEPS}
          </span>
          <span className="max-w-[280px] truncate text-[9px] text-[#a9b6c8]">{step.title}</span>
          <Btn small onClick={reset}>RESET</Btn>
          <Btn small onClick={next}>NEXT ▶</Btn>
          <Btn small danger onClick={onExit}>EXIT</Btn>
        </div>
      </div>

      {/* The explanation card, only while frozen */}
      {d.tut.showing && (
        <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/72 p-6">
          <div className="w-full max-w-2xl border-2 border-[#6ee7a0] bg-[#0d1220]">
            <div className="flex items-baseline justify-between bg-[#6ee7a0] px-3 py-1">
              <span className="text-[13px] font-black tracking-[0.14em] text-[#0a0e16]">{step.title}</span>
              <span className="text-[9px] font-black tracking-[0.2em] text-[#0a0e16]">
                STEP {d.tut.index + 1} OF {TUTORIAL_STEPS}
              </span>
            </div>
            <div className="p-4">
              <div className="text-[11px] leading-relaxed text-[#f4efe2]">{step.what}</div>
              <div className="mt-2 border-l-2 border-[#e8cf46] pl-2 text-[10px] leading-relaxed text-[#c9a94a]">
                WHY IT MATTERS: {step.why}
              </div>

              <div className="mt-3 border-t border-[#26314a] pt-2">
                <div className="mb-1 text-[9px] font-black tracking-[0.24em] text-[#7f8ea6]">
                  PRESS ANY OF THESE TO PLAY ON
                </div>
                <div className="space-y-1">
                  {step.keys.map((k) => (
                    <div key={k.key} className="grid grid-cols-[110px_1fr] items-baseline gap-2">
                      <span className="border border-[#6ee7a0] px-1 text-center text-[10px] font-black text-[#6ee7a0]">
                        {k.key}
                      </span>
                      <span className="text-[10px] text-[#cfd8e6]">{k.does}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-[#26314a] pt-2">
                <span className="text-[9px] text-[#6f7f96]">
                  The match is paused. It resumes the instant you press a listed key.
                </span>
                <div className="flex gap-2">
                  <Btn small onClick={reset}>RESET</Btn>
                  <Btn small onClick={() => { d.resumeTutorial(); force((n) => n + 1); }}>PLAY ON ▶</Btn>
                  <Btn small onClick={next}>SKIP TO NEXT</Btn>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Camera settings panel — modes, zoom, dynamic intensity, relative controls. */
export function CameraPanel({ d, force }: { d: Director; force: (f: (n: number) => number) => void }) {
  const modes = ['CABLE', 'TACTICAL', 'SIDELINE', 'BROADCAST', 'CHASE', 'POSTS'] as const;
  const zooms = [1, 2, 3, 4, 'DYNAMIC'] as const;
  return (
    <div className="mt-3 border-t border-[#26314a] pt-2">
      <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">
        CAMERA — {d.camMode} · {d.zoomLabel}
      </div>
      <div className="flex flex-wrap gap-1">
        {modes.map((m) => (
          <Btn key={m} small active={d.camMode === m}
            onClick={() => { d.camMode = m; force((n) => n + 1); }}>{m}</Btn>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <span className="text-[9px] tracking-[0.16em] text-[#7f8ea6]">ZOOM</span>
        {zooms.map((z) => (
          <Btn key={String(z)} small active={d.camZoom === z}
            onClick={() => { d.camZoom = z; force((n) => n + 1); }}>
            {z === 'DYNAMIC' ? 'DYN' : `${z}x`}
          </Btn>
        ))}
      </div>
      {d.camZoom === 'DYNAMIC' && (
        <div className="mt-1">
          <div className="flex justify-between text-[9px] text-[#7f8ea6]">
            <span>DYNAMIC INTENSITY</span>
            <span className="tabular-nums text-[#cfd8e6]">{Math.round(d.dynamicIntensity * 100)}%</span>
          </div>
          <input type="range" min={0} max={100} step={5}
            value={Math.round(d.dynamicIntensity * 100)}
            onChange={(e) => { d.dynamicIntensity = Number(e.target.value) / 100; force((n) => n + 1); }}
            className="w-full accent-[#e8cf46]" />
          <div className="text-[8px] leading-tight text-[#5f6f86]">
            Pulls in tight at scrums, lineouts and the breakdown; pushes out for a kick or a line break.
            At zero it behaves exactly like 2x.
          </div>
        </div>
      )}
      <div className="mt-1 flex items-center gap-2">
        <Btn small active={d.relativeControls}
          onClick={() => { d.relativeControls = true; force((n) => n + 1); }}>WASD RELATIVE TO CAMERA</Btn>
        <Btn small active={!d.relativeControls}
          onClick={() => { d.relativeControls = false; force((n) => n + 1); }}>WASD RELATIVE TO PITCH</Btn>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Btn small active={!d.cableSwapOnTurnover}
          onClick={() => { d.cableSwapOnTurnover = false; force((n) => n + 1); }}>CABLE CAM HOLDS SIDE</Btn>
        <Btn small active={d.cableSwapOnTurnover}
          onClick={() => { d.cableSwapOnTurnover = true; force((n) => n + 1); }}>CABLE CAM SWAPS ON TURNOVER</Btn>
      </div>
      <div className="mt-1 text-[8px] leading-tight text-[#5f6f86]">
        Holds side is the broadcast default: the camera does not cross the field when
        possession changes. Swapping keeps it behind whichever team is attacking.
      </div>
      <div className="mt-1 text-[8px] leading-tight text-[#5f6f86]">
        Relative means "up" is always away from the camera, so the keys agree with what you can see.
        Absolute means "up" is always toward the opposition line whatever the camera does.
      </div>
    </div>
  );
}
