/**
 * Broadcast presentation layer — the "AAA" match-day skin.
 *
 * These components sit entirely on top of the engine. The Director keeps
 * producing the same law-abiding rugby underneath; this layer is what a
 * television producer sees:
 *
 *   - MATCH DAY intro: full-screen kick-off card (venues, weather, referees)
 *   - Broadcast score bug: team-colour chips, big clock, live possession
 *   - Player spotlight: a lower-third when a try or kick is scored
 *   - Gamepad badge: tells a pad player the controller is alive
 *
 * They are opt-in per match via the `broadcast` option (HERITAGE keeps the
 * original 16-bit HUD).
 */
import { useEffect, useRef, useState } from 'react';
import { Director, TeamRun } from '../game/director';
import { KITS, DIFFICULTY_TABLE, OPTION_ITEMS } from '../game/data';
import type { Conditions } from '../render/conditions';

const fmt = (n: number, d = 0) => n.toFixed(d);

const WEATHER_NAMES = ['CLEAR', 'OVERCAST', 'DRIZZLE', 'RAIN', 'FOG', 'COLD SNAP', 'GALE'];
const LAW = (d: Director, id: string) => (d.options[id] ?? 0);

function kit(t: TeamRun) {
  const list = KITS[t.id] ?? KITS.ENG;
  return list[t.kitIdx % list.length];
}

function theme(d: Director) {
  return { a: kit(d.A), b: kit(d.B) };
}

/* ------------------------------ MATCH DAY ------------------------------ */

export function MatchIntro({ d }: { d: Director }) {
  const t = theme(d);
  const wLaw = LAW(d, 'weather');
  const pLaw = LAW(d, 'pitch');
  const tLaw = LAW(d, 'timeofday');
  const kickerName = d.A.players[d.A.kicker - 1]?.name ?? d.A.nation.short;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-[#05070c]/92">
      <div className="absolute inset-0" style={{
        background:
          `linear-gradient(115deg, ${t.a.kit}66 0%, transparent 44%), linear-gradient(-115deg, ${t.b.kit}66 0%, transparent 44%), radial-gradient(ellipse at 50% 70%, rgba(232,207,70,0.18), transparent 55%), #05070c`,
      }} />
      <div className="relative mx-4 w-full max-w-5xl border-2 border-[#e8cf46] bg-[#0a0e16]/90 px-8 py-8">
        <div className="text-center text-[10px] font-black tracking-[0.6em] text-[#e8cf46]">MATCH DAY · KICK-OFF</div>
        <div className="mt-5 grid items-stretch gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <div className="text-right">
            <div className="text-[11px] tracking-[0.3em] text-[#7f8ea6]">HOME</div>
            <div className="text-[40px] font-black leading-none text-[#f4efe2] sm:text-[56px]">{d.A.nation.short}</div>
            <div className="mt-1 text-[10px] tracking-[0.2em] text-[#e8cf46]">{d.A.nation.venue}</div>
          </div>
          <div className="flex items-center">
            <div className="border-2 border-[#e8cf46] bg-[#14161d] px-4 py-3 text-center">
              <div className="text-[30px] font-black text-[#e8cf46]">VS</div>
              <div className="mt-1 text-[9px] tracking-[0.2em] text-[#7f8ea6]">{d.A.nation.nickname} · {d.B.nation.nickname}</div>
            </div>
          </div>
          <div className="text-left">
            <div className="text-[11px] tracking-[0.3em] text-[#7f8ea6]">AWAY</div>
            <div className="text-[40px] font-black leading-none text-[#f4efe2] sm:text-[56px]">{d.B.nation.short}</div>
            <div className="mt-1 text-[10px] tracking-[0.2em] text-[#e8cf46]">{d.B.nation.venue}</div>
          </div>
        </div>
        <div className="mt-6 grid gap-2 text-center text-[9px] tracking-[0.16em] text-[#8fa0b8] sm:grid-cols-4">
          <div><span className="text-[#e8cf46]">WEATHER</span> · {WEATHER_NAMES[wLaw] ?? 'CLEAR'}</div>
          <div><span className="text-[#e8cf46]">PITCH</span> · {['FIRM', 'STANDARD', 'SOFT', 'MUDDY', 'FROZEN'][pLaw]}</div>
          <div><span className="text-[#e8cf46]">KICK-OFF</span> · {['MIDDAY', 'AFTERNOON', 'TWILIGHT', 'FLOODLIT'][tLaw]}</div>
          <div><span className="text-[#e8cf46]">LEVEL</span> · {DIFFICULTY_TABLE[d.difficulty]?.name ?? `#${d.difficulty}`}</div>
        </div>
        <div className="mt-4 border-t border-[#26314a] pt-2 text-center text-[10px] tracking-[0.24em] text-[#5f6f86]">
          KICKS OFF · {kickerName.toUpperCase()} TAKES THE KICK-OFF
        </div>
      </div>
      <div className="pointer-events-auto absolute bottom-5 right-5 flex items-center gap-2 text-[9px] tracking-[0.2em] text-[#5f6f86]">
        <span className="hidden sm:inline">PRESS ANY KEY / BUTTON TO SKIP</span>
        <span className="animate-pulse text-[#e8cf46]">●</span>
      </div>
    </div>
  );
}

/* --------------------------- BROADCAST SCORE BUG --------------------------- */

export function ScoreBug({ d, objective, density }: {
  d: Director;
  objective?: { name: string; target: string; margin: number } | null;
  density: string;
}) {
  const t = theme(d);
  const aShare = d.A.score + d.B.score === 0 ? 50 : Math.round((d.A.score / (d.A.score + d.B.score)) * 100);
  const possessionPct = d.possession === 'A' ? 100 : 0;
  const bPct = 100 - possessionPct;
  return (
    <div className="pointer-events-none absolute left-1/2 top-3 w-[min(560px,84%)] -translate-x-1/2">
      <div className="overflow-hidden border-2 border-[#e8cf46] bg-[#0d1220]/95 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <div className="flex items-stretch">
          <div className="flex w-[46%] items-center gap-2 px-3 py-1.5" style={{ background: `linear-gradient(90deg, ${t.a.kit}33, transparent)` }}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[#e8cf46]/70 text-[10px] font-black" style={{ background: t.a.kit, color: t.a.kitLight }}>
              {d.A.nation.short[0]}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-black leading-none text-[#f4efe2]">{d.A.nation.short}</div>
              <div className="mt-0.5 truncate text-[7px] tracking-[0.16em] text-[#7f8ea6]">{d.A.nation.venue}</div>
            </div>
            <div className="ml-auto text-[26px] font-black tabular-nums leading-none text-[#f4efe2]">{d.A.score}</div>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center border-x-2 border-[#e8cf46] bg-[#14161d] px-2 py-1.5 text-center">
            <div>
              <div className="text-[20px] font-black tabular-nums leading-none text-[#e8cf46]">{d.clockText}</div>
              <div className="mt-0.5 text-[7px] tracking-[0.24em] text-[#7f8ea6]">{d.half === 1 ? 'FIRST HALF' : 'SECOND HALF'} · {d.phase.replace('_', ' ')}</div>
            </div>
          </div>
          <div className="flex w-[46%] items-center gap-2 px-3 py-1.5 text-right" style={{ background: `linear-gradient(-90deg, ${t.b.kit}33, transparent)` }}>
            <div className="mr-auto text-[26px] font-black tabular-nums leading-none text-[#f4efe2]">{d.B.score}</div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-black leading-none text-[#f4efe2]">{d.B.nation.short}</div>
              <div className="mt-0.5 truncate text-[7px] tracking-[0.16em] text-[#7f8ea6]">{d.B.nation.venue}</div>
            </div>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[#e8cf46]/70 text-[10px] font-black" style={{ background: t.b.kit, color: t.b.kitLight }}>
              {d.B.nation.short[0]}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-[#26314a] px-3 py-1">
          <div>
            <div className="mb-0.5 flex justify-between text-[8px] tracking-[0.16em] text-[#7f8ea6]">
              <span className={d.possession === 'A' ? 'text-[#e2664f]' : ''}>POSSESSION {d.possession === 'A' ? '◀' : ''}</span>
              <span className={d.possession === 'B' ? 'text-[#7fa3e6]' : ''}>{d.possession === 'B' ? '▶' : ''} {d.possession === 'B' ? d.B.nation.short : d.A.nation.short}</span>
            </div>
            <div className="flex h-1.5 w-full bg-[#0a0e16]">
              <div className="h-full" style={{ width: `${possessionPct}%`, background: t.a.kit }} />
              <div className="h-full" style={{ width: `${bPct}%`, background: t.b.kit }} />
            </div>
          </div>
          <div className="min-w-[64px] text-center">
            <div className="text-[8px] tracking-[0.24em] text-[#5f6f86]">MOMENTUM</div>
            <div className="flex items-center justify-center gap-1 text-[9px] font-black tabular-nums text-[#e8cf46]">
              <span className={d.momentum > 0 ? 'text-[#e2664f]' : d.momentum < 0 ? 'text-[#7fa3e6]' : 'text-[#6f7f96]'}>{d.momentum > 0 ? d.A.nation.short : d.momentum < 0 ? d.B.nation.short : '—'}</span>
            </div>
          </div>
          <div>
            <div className="mb-0.5 flex justify-between text-[8px] tracking-[0.16em] text-[#7f8ea6]">
              <span>SCORE {aShare}%</span><span>SCORE {100 - aShare}%</span>
            </div>
            <div className="flex h-1.5 w-full bg-[#0a0e16]">
              <div className="h-full" style={{ width: `${aShare}%`, background: '#e8cf46' }} />
              <div className="h-full bg-[#2c3a52]" style={{ width: `${100 - aShare}%` }} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[#26314a] px-3 py-1 text-[8px] tracking-[0.14em] text-[#8fa0b8]">
          {objective && <span className="text-[#e8cf46]">{objective.name} · TARGET {objective.target}</span>}
          {(['A', 'B'] as const).map((side) => {
            const binned = d.live.filter((p) => p.team === side && p.sinbin > 0);
            if (!binned.length) return null;
            return (
              <span key={side} className="inline-flex items-center gap-1 border border-[#e8cf46] bg-[#2a2412] px-1 text-[#e8cf46]">
                <span className="h-2 w-2 rounded-sm bg-[#e8cf46]" />
                {d.teams[side].nation.short} 14 — {binned.map((p) => p.num).join(', ')} IN BIN
              </span>
            );
          })}
          {density !== 'MINIMAL' && (
            <span className="text-[#6f7f96]">{d.op && d.op.phase > 0 ? `PHASE ${d.op.phase}` : ''} · {d.possession === 'A' ? d.A.nation.short : d.B.nation.short} HAVE IT</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- PLAYER SPOTLIGHT ---------------------------- */

export function PlayerSpotlight({ d }: { d: Director }) {
  const [seen, setSeen] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const sc = d.lastScorer;
  const id = sc ? `${sc.kind}-${sc.min}-${sc.team}` : '';
  useEffect(() => {
    if (id && id !== seen) {
      setSeen(id);
      setVisible(true);
      const tm = window.setTimeout(() => setVisible(false), 5200);
      return () => window.clearTimeout(tm);
    }
  }, [id, seen]);
  useEffect(() => {
    const tm = window.setTimeout(() => setVisible(false), 5200);
    return () => window.clearTimeout(tm);
  }, []);
  if (!sc || !visible) return null;
  const t = sc.team === 'A' ? theme(d).a : theme(d).b;
  const team = sc.team === 'A' ? d.A : d.B;
  const p = team.players[sc.num - 1];
  const points = sc.kind === 'TRY' ? 5 : sc.kind === 'CONVERSION' ? 2 : sc.kind === 'PENALTY' ? 3 : sc.kind === 'DROP' ? 3 : 0;
  return (
    <div className="pointer-events-none absolute bottom-[150px] left-1/2 z-20 w-[min(520px,86%)] -translate-x-1/2">
      <div className="overflow-hidden border-2 bg-[#0d1220]/95 shadow-[0_10px_40px_rgba(0,0,0,0.55)]" style={{ borderColor: t.trim }}>
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-[18px] font-black" style={{ borderColor: t.trim, background: t.kit, color: t.kitLight }}>
            {sc.num}
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[16px] font-black text-[#f4efe2]">{sc.name}</span>
              <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-black tracking-[0.2em]" style={{ background: t.kit, color: t.kitLight }}>
                {team.nation.short}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[9px] tracking-[0.18em] text-[#7f8ea6]">
              {p?.pos ?? 'UNKNOWN'} · {sc.kind.replace(/_/g, ' ')} · {points > 0 ? `+${points} PTS` : ''} · {sc.min}'
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[22px] font-black tabular-nums text-[#e8cf46]">{points > 0 ? `+${points}` : '—'}</div>
            <div className="text-[7px] tracking-[0.2em] text-[#5f6f86]">BROADCAST</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ GAMEPAD BADGE ------------------------------ */

export function GamepadBadge({ connected, name }: { connected: boolean; name: string }) {
  const [show, setShow] = useState(false);
  const ref = useRef(false);
  useEffect(() => {
    if (connected && !ref.current) {
      setShow(true);
      const tm = window.setTimeout(() => setShow(false), 3600);
      ref.current = true;
      return () => window.clearTimeout(tm);
    }
  }, [connected]);
  if (!connected || !show) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
      <div className="flex items-center gap-2 border-2 border-[#e8cf46] bg-[#0d1220]/95 px-3 py-1 text-[9px] tracking-[0.2em] text-[#e8cf46]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#6ee7a0]" />
        CONTROLLER CONNECTED · {name.toUpperCase()}
      </div>
    </div>
  );
}

export const broadcastOptionLabel = () => OPTION_ITEMS.find((o) => o.id === 'broadcast')?.label ?? 'BROADCAST';

/* ============================================================================
 * SPEC_24 — the match-day panels. The bug, the spotlight and the intro above
 * are the broadcast's voice; these are its EVIDENCE: what the kick-off time is
 * doing to the ground, what the TMO is actually checking, and the three men the
 * ratings board already knows about. They are here rather than in MatchView for
 * the same reason the bug is: a graphic belongs to the package, not to the
 * component that happens to draw the canvas.
 * ========================================================================== */

export function TmoCard({ d }: { d: Director }) {
  if (!d.tmo) return null;
  const t = Math.min(1, d.tmo.t / 6);
  return (
    <div className="absolute left-1/2 top-[15%] w-[286px] -translate-x-1/2">
      <div className="overflow-hidden rounded-[3px] border-2 border-[#e8cf46]/70 bg-[#080c14]/95">
        <div className="flex items-center justify-between bg-[#e8cf46] px-2 py-[3px]">
          <span className="text-[10px] font-black tracking-[0.24em] text-[#0b0f17]">TMO REVIEW</span>
          <span className="text-[9px] font-black tabular-nums text-[#0b0f17]">LIVE</span>
        </div>
        <div className="px-3 py-2">
          <div className="text-[12px] font-black leading-tight text-[#f4efe2]">
            CHECKING {d.tmo.short.toUpperCase()} GROUNDING
          </div>
          <div className="mt-[2px] text-[8px] tracking-[0.16em] text-[#8fa0b8]">
            CAMERA: {d.tmo.angle > 0.9 ? 'BEHIND THE POST' : d.tmo.angle < 0.2 ? 'TACTICAL HIGH' : 'SIDE ON'}
          </div>
          <div className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-[#1b2436]">
            <div className="h-full bg-[#e8cf46] transition-[width] duration-200" style={{ width: `${t * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CardCard({ d }: { d: Director }) {
  const b = (d.banner || '').toUpperCase();
  if (!(b.includes('YELLOW') || b.includes('RED CARD'))) return null;
  const since = d.t - (d.bannerAt ?? 0);
  if (since > 5) return null;
  const red = b.includes('RED');
  return (
    <div className="absolute left-1/2 top-[34%] flex -translate-x-1/2 items-center gap-3"
      style={{ opacity: Math.min(1, (5 - since) / 0.6) }}>
      <div className="h-[54px] w-[38px] rotate-[-8deg] rounded-[3px] shadow-[0_12px_28px_-8px_rgba(0,0,0,0.9)]"
        style={{ background: red ? '#c0392b' : '#e8cf46' }} />
      <div>
        <div className="text-[15px] font-black leading-none text-[#f4efe2]">
          {red ? 'RED CARD' : 'YELLOW CARD'}
        </div>
        <div className="mt-[3px] text-[9px] font-bold tracking-[0.16em] text-[#a9b6c8]">
          {red ? 'FOURTEEN MEN FOR THE REST OF THE MATCH' : 'TEN MINUTES IN THE BIN'}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- conditions ---- */
export function ConditionsStrip({ d, cond }: { d: Director; cond: Conditions }) {
  const wet = Math.round(cond.wetness * 100);
  const wind = ['CALM', 'LIGHT', 'BREEZY', 'STRONG', 'GUSTING'][d.options.wind ?? 1] ?? 'LIGHT';
  return (
    <div className="select-none">
      <div className="flex items-center gap-3 rounded-[3px] border border-[#2c3a52]/90 bg-[#080c14]/92 px-2.5 py-1.5 backdrop-blur-[2px]">
        <Field label="VENUE" value={d.A.nation.venue.toUpperCase()} />
        <Divider />
        <Field label="WEATHER" value={cond.weather} />
        <Divider />
        <Field label="PITCH" value={cond.pitchKind} />
        <Divider />
        <Field label="WIND" value={wind} />
        <Divider />
        <Field label="KICK-OFF" value={cond.timeOfDay} />
        <Divider />
        <div className="flex items-center gap-1.5">
          <span className="text-[7px] font-bold tracking-[0.18em] text-[#5f6f86]">GROUND</span>
          <span className="relative block h-[6px] w-[46px] overflow-hidden rounded-full bg-[#1b2436]">
            <span className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${Math.round(cond.wetness * 100)}%`, background: 'linear-gradient(90deg,#4a7d3c,#7fa3e6)' }} />
          </span>
          <span className="text-[8px] font-black tabular-nums text-[#a9b6c8]">{wet}%</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-none">
      <div className="text-[7px] font-bold tracking-[0.18em] text-[#5f6f86]">{label}</div>
      <div className="mt-[2px] text-[10px] font-black tracking-[0.06em] text-[#f4efe2]">{value}</div>
    </div>
  );
}
const Divider = () => <span className="h-[18px] w-px bg-[#2c3a52]" />;

/* ------------------------------------------------------------ the replay ------ */
export function ReplayFrame({ d }: { d: Director }) {
  if (!d.phase.includes('REPLAY')) return null;
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[6%] bg-black" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[6%] bg-black" />
      <div className="pointer-events-none absolute left-1/2 top-[9%] flex -translate-x-1/2 items-center gap-2 rounded-[2px] bg-[#080c14]/90 px-2 py-[3px]">
        <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-[#e2664f]" />
        <span className="text-[9px] font-black tracking-[0.26em] text-[#f4efe2]">REPLAY</span>
        <span className="text-[9px] font-bold tabular-nums text-[#8fa0b8]">
          {d.replayTimer ? d.replayTimer.toFixed(1) : '0.0'}s
        </span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ form of game ---- */
/**
 * The three highest-rated men on the pitch. `PlayerRun.rating` is produced by
 * the same accumulator the post-match box score prints, so a viewer watching a
 * 9 across the water cannot be told he is on for an 8.
 */
export function FormStrip({ d }: { d: Director }) {
  const all = [...d.A.players.map((p) => ({ p, team: 'A' as const })), ...d.B.players.map((p) => ({ p, team: 'B' as const }))]
    .filter((x) => x.p.on)
    .sort((a, b) => b.p.rating - a.p.rating)
    .slice(0, 3);
  if (!all.length) return null;
  return (
    <div className="pointer-events-none absolute bottom-[92px] left-3 select-none">
      <div className="rounded-[3px] border border-[#2c3a52]/90 bg-[#080c14]/92 px-2 py-1.5">
        <div className="mb-1 flex items-center justify-between gap-3 text-[7px] font-bold tracking-[0.2em] text-[#5f6f86]">
          <span>FORM OF THE GAME</span>
          <span className="text-[#3d4b66]">LIVE RATINGS</span>
        </div>
        {all.map(({ p, team }) => (
          <div key={`${team}-${p.num}`} className="flex items-baseline gap-2 leading-tight">
            <span className="w-[10px] text-[8px] font-black tabular-nums text-[#7f8ea6]">{p.num}</span>
            <span className="w-[86px] truncate text-[9px] font-bold text-[#dfe6f0]">{p.name}</span>
            <span className="w-[26px] text-right text-[9px] font-black tabular-nums text-[#e8cf46]">{fmt(p.rating, 1)}</span>
            <span className="h-[8px] w-[2px]" style={{ background: team === 'A' ? '#e2664f' : '#7fa3e6' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
