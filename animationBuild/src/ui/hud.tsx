import { Game } from '../render/scene';
import { FIELD } from '../render/scene';
import { DISPLAY, MONO } from '../render/paper';

export type HudState = ReturnType<Game['hud']>;

const GOLD = '#f2c33d';
const TEAL = '#58c7d6';
const PANEL = 'rgba(12,16,26,0.92)';

function fmtClock(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

const panelStyle: React.CSSProperties = {
  background: PANEL,
  border: `2px solid ${GOLD}`,
  boxShadow: '0 0 0 2px #0b0e16, 4px 4px 0 rgba(0,0,0,0.45)',
};

export function Scoreboard({ h }: { h: HudState }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2" style={{ fontFamily: MONO }}>
      <div style={{ ...panelStyle, borderColor: GOLD, minWidth: 430 }}>
        <div className="flex items-stretch gap-0 px-3 py-1.5">
          <div className="flex items-center gap-2 pr-3" style={{ color: '#e8b98f' }}>
            <span className="inline-block h-3 w-3" style={{ background: '#c8402f', boxShadow: '0 0 0 1px #0b0e16' }} />
            <span style={{ fontFamily: DISPLAY, fontSize: 15, color: '#f4f2e6', letterSpacing: 1 }}>ENG</span>
          </div>
          <div className="flex items-center gap-2 px-3" style={{ background: '#0b0e16' }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 22, color: GOLD }}>{h.scoreA}</span>
            <span style={{ color: '#6b7280', fontSize: 12 }}>v</span>
            <span style={{ fontFamily: DISPLAY, fontSize: 22, color: GOLD }}>{h.scoreB}</span>
          </div>
          <div className="flex items-center gap-2 pl-3">
            <span className="inline-block h-3 w-3" style={{ background: '#2f4f9c', boxShadow: '0 0 0 1px #0b0e16' }} />
            <span style={{ fontFamily: DISPLAY, fontSize: 15, color: '#f4f2e6', letterSpacing: 1 }}>NZL</span>
          </div>
          <div className="ml-auto flex items-center gap-3 pl-4" style={{ color: TEAL }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 15 }}>{fmtClock(h.clock)}</span>
            <span style={{ fontSize: 10, letterSpacing: 1 }}>{h.half === 1 ? '1ST HALF' : '2ND HALF'}</span>
            <span style={{ fontSize: 10, letterSpacing: 1, color: '#8d94a8' }}>TWICKENHAM</span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t px-3 py-1" style={{ borderColor: '#2a3040', color: GOLD, fontSize: 10, letterSpacing: 1.4 }}>
          <span>THE 1995 SEMI — PAPERCRAFT EDITION</span>
          <span style={{ color: h.poss === 'A' ? '#e2664f' : '#5a7bc4' }}>
            {h.poss === 'A' ? 'ENG' : 'NZL'} &#9654; · {h.phase.replace('_', ' ')}{h.replay ? ' · REPLAY' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ControlPanel({ h }: { h: HudState }) {
  const rows: [string, string][] = h.phase === 'BREAKDOWN'
    ? [['A / D', 'CLEAR OUT SIDE'], ['SPACE', 'COMMIT ONE MORE']]
    : h.phase === 'SCRUM'
      ? [['SPACE', 'SHOVE ON THE FEED']]
      : h.phase === 'LINEOUT'
        ? [['SPACE', 'CALL THE JUMP']]
        : h.phase === 'KICK'
          ? [['SPACE', 'STRIKE ON THE MARK']]
          : h.phase === 'MAUL'
            ? [['HOLD SPACE', 'DRIVE THE MAUL'], ['A / D', 'STEER']]
            : [['A / D', 'STEP OFF THE SHOULDER'], ['SPACE', 'SPIN PASS']];
  return (
    <div className="pointer-events-none absolute left-3 top-3 w-64" style={{ ...panelStyle, borderColor: '#2a3040', fontFamily: MONO }}>
      <div className="flex items-center justify-between px-2 py-1" style={{ background: '#141a28', borderBottom: '1px solid #2a3040' }}>
        <span style={{ color: TEAL, fontSize: 10, letterSpacing: 2 }}>CONTROLS</span>
        <span style={{ color: '#8d94a8', fontSize: 10, letterSpacing: 1 }}>{h.phase.replace('_', ' ')}</span>
      </div>
      <div className="space-y-1 px-2 py-2">
        {rows.map(([k, v]) => (
          <div key={k + v} className="flex items-center gap-2">
            <span className="px-1.5 py-0.5" style={{ background: '#1d2536', border: '1px solid #3a4358', color: GOLD, fontSize: 10, fontWeight: 700 }}>{k}</span>
            <span style={{ color: '#c9cfdd', fontSize: 10, letterSpacing: 0.6 }}>{v}</span>
          </div>
        ))}
        <div className="pt-1" style={{ color: '#66708a', fontSize: 9, letterSpacing: 0.6 }}>
          R REPLAY · ESC PAUSE · TAB STATS · WHEEL ZOOM
        </div>
      </div>
    </div>
  );
}

export function FocusAndPhase({ h }: { h: HudState }) {
  const posLabel: Record<string, string> = {
    PROP: 'PROP', HOOK: 'HOOKER', LOCK: 'LOCK', BACKROW: 'BACK ROW', HALF: 'SCRUM HALF',
    FLY: 'FLY HALF', CENTRE: 'CENTRE', WING: 'WING', FULL: 'FULL BACK', REF: 'REFEREE',
  };
  const hint = h.phase === 'BREAKDOWN' ? 'HANDS ON THE BALL — WAIT FOR IT TO COME'
    : h.phase === 'MAUL' ? 'BIND TIGHT — DRIVE UNTIL IT BREAKS'
      : h.phase === 'OPEN_PLAY' ? 'FIX THE FULL BACK — THEN GO ALONE'
        : h.phase === 'SCRUM' ? 'STAY SQUARE — SHOVE ON THE CALL'
          : h.phase === 'LINEOUT' ? 'TIME THE LEAP — TOP OF THE JUMP'
            : h.phase === 'KICK' ? 'EYES ON THE SEAM OF THE BALL' : 'HOLD THE PAPER LINE';
  return (
    <div className="pointer-events-none absolute left-3 top-1/2 w-64 -translate-y-1/2 space-y-2" style={{ fontFamily: MONO }}>
      {h.focus && (
        <div style={{ ...panelStyle, borderColor: TEAL }}>
          <div className="flex items-baseline justify-between px-2 py-1.5">
            <span style={{ fontFamily: DISPLAY, fontSize: 15, color: '#f4f2e6' }}>
              <span style={{ color: TEAL }}>{h.focus.num}</span> {h.focus.name}
            </span>
            <span style={{ fontSize: 9, letterSpacing: 1, color: '#8d94a8' }}>{posLabel[h.focus.pos] ?? h.focus.pos}</span>
          </div>
          <div className="border-t px-2 py-1" style={{ borderColor: '#2a3040', color: GOLD, fontSize: 9, letterSpacing: 0.8 }}>{hint}</div>
        </div>
      )}
      <div style={{ ...panelStyle, borderColor: GOLD }}>
        <div className="px-2 py-1" style={{ background: GOLD, color: '#141414', fontFamily: DISPLAY, fontSize: 12, letterSpacing: 1 }}>
          {h.phase.replace('_', ' ')}
        </div>
        <div className="space-y-1 px-2 py-2" style={{ fontSize: 10 }}>
          <div className="flex justify-between" style={{ color: '#c9cfdd' }}>
            <span style={{ color: '#66708a' }}>STAGE</span><span style={{ letterSpacing: 1 }}>{h.stage}</span>
          </div>
          <div className="flex justify-between" style={{ color: '#c9cfdd' }}>
            <span style={{ color: '#66708a' }}>CAMERA</span><span style={{ letterSpacing: 1, color: TEAL }}>{h.camName}</span>
          </div>
          {h.phase === 'BREAKDOWN' && (
            <>
              <div className="flex justify-between" style={{ color: '#c9cfdd' }}>
                <span style={{ color: '#66708a' }}>RUCK BIAS</span><span>{h.poss}</span>
              </div>
              <div className="h-2 w-full" style={{ background: '#1d2536', border: '1px solid #3a4358' }}>
                <div className="h-full" style={{ width: `${Math.round(h.ruckPower * 100)}%`, background: 'linear-gradient(90deg,#c8402f,#f2c33d)' }} />
              </div>
            </>
          )}
          <div className="flex justify-between" style={{ color: '#c9cfdd' }}>
            <span style={{ color: '#66708a' }}>POSSESSION</span><span>{Math.round(h.stats.possA)}% ENG</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Banner({ h }: { h: HudState }) {
  if (h.banner.t > 3.2 || !h.banner.text) return null;
  const fade = h.banner.t > 2.6 ? 1 - (h.banner.t - 2.6) / 0.6 : 1;
  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2" style={{ opacity: fade, fontFamily: MONO }}>
      <div className="px-6 py-1.5 text-center" style={{ ...panelStyle, borderColor: GOLD }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 17, letterSpacing: 1.5, color: GOLD }}>{h.banner.text}</div>
        {h.banner.sub && <div style={{ fontSize: 10, letterSpacing: 1.4, color: '#c9cfdd' }}>{h.banner.sub}</div>}
      </div>
    </div>
  );
}

export function PromptBar({ h }: { h: HudState }) {
  const p = h.prompt;
  if (!p || h.over || h.replay) return null;
  const remain = p.total > 50 ? null : Math.max(0, p.total - p.t);
  return (
    <div className="pointer-events-none absolute bottom-10 left-1/2 w-[560px] -translate-x-1/2" style={{ fontFamily: MONO }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ ...panelStyle, borderColor: '#2a3040' }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontSize: 12, color: '#f4f2e6', letterSpacing: 0.8 }}>{p.text}</div>
          <div style={{ fontSize: 9, letterSpacing: 1, color: TEAL }}>{p.keys}</div>
        </div>
        {remain !== null && (
          <div style={{ fontFamily: DISPLAY, fontSize: 14, color: remain < 1 ? '#e2664f' : GOLD }}>{remain.toFixed(1)}s</div>
        )}
      </div>
    </div>
  );
}

export function Ticker({ h }: { h: HudState }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1" style={{ background: '#0b0e16', borderTop: `2px solid ${GOLD}`, fontFamily: MONO, fontSize: 9, letterSpacing: 1 }}>
      <span style={{ color: '#8d94a8' }}>
        <span style={{ color: GOLD }}>ENG</span> SPLIT / UMBRELLA · PITCH STANDARD · WIND 6KN SW
      </span>
      <span style={{ color: '#66708a' }}>
        <span style={{ color: '#c9cfdd' }}>ESC</span> PAUSE · <span style={{ color: '#c9cfdd' }}>TAB</span> STATS · <span style={{ color: '#c9cfdd' }}>R</span> REPLAY · <span style={{ color: '#c9cfdd' }}>WHEEL</span> ZOOM
      </span>
      <span style={{ color: TEAL }}>GAME SPEED {Math.round(h.speed * 100)}% — [ / ] TO CHANGE</span>
    </div>
  );
}

export function Minimap({ canvasRef, h }: { canvasRef: React.RefObject<HTMLCanvasElement | null>; h: HudState }) {
  return (
    <div className="pointer-events-none absolute right-3 top-3" style={{ ...panelStyle, borderColor: '#2a3040', padding: 4 }}>
      <canvas ref={canvasRef} width={220} height={138} style={{ display: 'block' }} />
      <div className="flex justify-between px-1 pt-1" style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 1, color: '#66708a' }}>
        <span>TACTICAL · {h.camName}</span>
        <span style={{ color: GOLD }}>{h.over ? 'FT' : `${h.half === 1 ? '1ST' : '2ND'} HALF`}</span>
      </div>
    </div>
  );
}

export function drawMinimap(cv: HTMLCanvasElement, g: Game) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#12241a';
  ctx.fillRect(0, 0, W, H);
  const mx = (x: number) => ((x - FIELD.minX) / (FIELD.maxX - FIELD.minX)) * (W - 16) + 8;
  const mz = (z: number) => ((z - FIELD.deadZ) / (FIELD.deadZFar - FIELD.deadZ)) * (H - 12) + 6;
  ctx.strokeStyle = '#2c4436';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx(FIELD.minX), mz(FIELD.tryZ), mx(FIELD.maxX) - mx(FIELD.minX), mz(FIELD.tryZFar) - mz(FIELD.tryZ));
  ctx.beginPath();
  ctx.moveTo(mx(FIELD.minX), mz(0)); ctx.lineTo(mx(FIELD.maxX), mz(0));
  ctx.moveTo(mx(FIELD.minX), mz(-28)); ctx.lineTo(mx(FIELD.maxX), mz(-28));
  ctx.moveTo(mx(FIELD.minX), mz(28)); ctx.lineTo(mx(FIELD.maxX), mz(28));
  ctx.stroke();
  // cam cone
  const cam = g.cam;
  const cx = mx(cam.x), cz = mz(cam.z);
  const a0 = Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw));
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#f2c33d';
  ctx.beginPath();
  ctx.moveTo(cx, cz);
  const spread = cam.fov * 0.9;
  const len = 90;
  // world angle -> map angle: map x = world x, map y = world z
  ctx.lineTo(cx + Math.sin(a0 - spread) * len, cz + Math.cos(a0 - spread) * len);
  ctx.lineTo(cx + Math.sin(a0 + spread) * len, cz + Math.cos(a0 + spread) * len);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  for (const a of g.actors) {
    ctx.fillStyle = a.team === 'A' ? '#e2664f' : a.team === 'B' ? '#5a7bc4' : '#e8cf46';
    const s = a.carry ? 3.4 : 2.2;
    ctx.fillRect(mx(a.x) - s / 2, mz(a.z) - s / 2, s, s);
  }
  ctx.fillStyle = '#f3ede0';
  ctx.beginPath(); ctx.arc(mx(g.ball.x), mz(g.ball.z), 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f2c33d';
  ctx.strokeRect(mx(g.rx) - 3, mz(g.rz) - 3, 6, 6);
}

export function StatsOverlay({ h }: { h: HudState }) {
  const rows: [string, string, string][] = [
    [String(Math.round(h.stats.possA)) + '%', 'POSSESSION', Math.round(100 - h.stats.possA) + '%'],
    [String(Math.round(h.stats.metA)), 'METRES MADE', String(Math.round(h.stats.metB))],
    [String(h.stats.takA), 'TACKLES MADE', String(h.stats.takB)],
    [String(h.stats.ruckA), 'RUCKS WON', String(h.stats.ruckB)],
    [String(h.stats.toA), 'TURNOVERS', String(h.stats.toB)],
  ];
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(6,8,14,0.82)', fontFamily: MONO }}>
      <div style={{ ...panelStyle, width: 420 }}>
        <div className="px-4 py-2" style={{ background: GOLD, color: '#141414', fontFamily: DISPLAY, fontSize: 14, letterSpacing: 2 }}>MATCH STATS</div>
        <div className="space-y-2 px-4 py-4">
          {rows.map(([a, label, b]) => (
            <div key={label} className="grid grid-cols-3 items-center" style={{ fontSize: 11 }}>
              <span style={{ color: '#e2664f', fontFamily: DISPLAY, fontSize: 14 }}>{a}</span>
              <span className="text-center" style={{ color: '#8d94a8', letterSpacing: 1.4, fontSize: 9 }}>{label}</span>
              <span className="text-right" style={{ color: '#5a7bc4', fontFamily: DISPLAY, fontSize: 14 }}>{b}</span>
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-1.5 text-center" style={{ borderColor: '#2a3040', color: '#66708a', fontSize: 9, letterSpacing: 1 }}>TAB TO CLOSE</div>
      </div>
    </div>
  );
}

export function PauseOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(6,8,14,0.7)', fontFamily: MONO }}>
      <div className="text-center" style={{ ...panelStyle, padding: '18px 42px' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 26, color: GOLD, letterSpacing: 3 }}>PAUSED</div>
        <div style={{ fontSize: 10, letterSpacing: 1.6, color: '#8d94a8' }}>ESC TO RESUME · THE PAPER WAITS</div>
      </div>
    </div>
  );
}

export function FullTimeOverlay({ h }: { h: HudState }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: 'rgba(6,8,14,0.78)', fontFamily: MONO }}>
      <div className="text-center" style={{ ...panelStyle, padding: '22px 52px' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 15, color: TEAL, letterSpacing: 3 }}>FULL TIME</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 34, color: GOLD, letterSpacing: 2 }}>ENG {h.scoreA} — {h.scoreB} NZL</div>
        <div style={{ fontSize: 10, letterSpacing: 1.6, color: '#8d94a8' }}>
          {h.scoreA === h.scoreB ? 'HONOURS EVEN AT TWICKENHAM' : h.scoreA > h.scoreB ? 'ENG LAND THE 1995 SEMI' : 'NZL LAND THE 1995 SEMI'}
        </div>
      </div>
    </div>
  );
}
