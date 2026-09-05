import React, { useMemo, useRef, useState } from 'react';
import { pollGamepad, emptyPrev, PrevGp } from '../game/gamepad';
import {
  TEAMS, TEAM_BY_ID, KITS, OPTION_ITEMS, FORMATIONS, TACTIC_PRESETS, DEFAULT_SLIDERS,
  MANUAL, dataPointCount, DIFFICULTY_TABLE, LAW_ENTRIES, AI_ARCHETYPES, AI_WEIGHTS,
  FIVE_NATIONS_IDS, WORLD_CUP_POOLS, COMPETITIONS, TROPHIES, POSITION_WEIGHTS,
} from '../game/data';
import { Slider } from '../game/director';
import { Btn, Panel, TitleBar, KitSwatch, Kbd, Meter } from './kit';
import {
  jlrPointCount, ROLE_CONTRACTS, SET_PLAYS, CLASSIC_MATCHES, SEAMLESSNESS_RULES,
  ACCESSIBILITY_RULES, FAIRNESS_INVARIANTS, ATTRIBUTE_MODEL, CONTROL_VERBS,
  LOMU_MODES, SIGNATURE_PLAYER_RULES,
} from '../game/jlr';
import { PITFALLS, searchPitfalls, pitfallPoints, CATEGORIES } from '../game/pitfalls';
import { ATTACK_SHAPES, DEFENCE_SYSTEMS, CAMERA_PLAN, PLAYBOOK, SHAPE_POINT_COUNT } from '../game/shapes';
import { animationPointCount } from '../game/animation';
import { paperPointCount } from '../game/papercraft';
import { KEYMAP } from './MatchView';
import { datasetReport, behaviourFor, runLinesFor, AUTHORED_POSITIONS } from '../game/behaviour';
import { SITUATIONS, SITUATION_META, SituationId } from '../game/behaviour/types';
import { LINE_FAMILIES } from '../game/behaviour/lines';

export type Mode = 'FRIENDLY' | 'LEAGUE' | 'WORLD_CUP' | 'FIVE_NATIONS' | 'CLINIC' | 'REPLAYS' | 'CLASSIC' | 'TUTORIAL';

/* ============================ TITLE ============================ */

export function TitleScreen({ onStart }: { onStart: () => void }) {
  const [tick, setTick] = useState(0);
  const padRef = useRef<PrevGp>(emptyPrev());
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 90);
    return () => clearInterval(id);
  }, []);
  /* AAA — the title starts on ENTER, SPACE or a controller START / A. */
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStart(); }
    };
    window.addEventListener('keydown', key);
    const id = window.setInterval(() => {
      const f = pollGamepad(padRef.current);
      padRef.current = f;
      if (f.connected && (f.pressed.includes('pause') || f.pressed.includes('action'))) onStart();
    }, 80);
    return () => { window.removeEventListener('keydown', key); window.clearInterval(id); };
  }, [onStart]);
  const hue = (Math.sin(tick / 9) * 36 + 46) | 0;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#0a0e16]">
      <div className="text-center">
        <div className="text-[10px] font-black tracking-[0.6em] text-[#7f8ea6]">AUDIOGENIC · DENTON DESIGNS · 1991</div>
        <h1
          className="mt-3 text-5xl font-black leading-none tracking-[0.04em] sm:text-7xl"
          style={{ color: `hsl(${hue} 70% 62%)`, textShadow: '4px 4px 0 #14161d' }}
        >
          WORLD CLASS
        </h1>
        <h1 className="text-5xl font-black leading-none tracking-[0.04em] text-[#f4efe2] sm:text-7xl" style={{ textShadow: '4px 4px 0 #14161d' }}>
          RUGBY
        </h1>
        <div className="mt-4 border-y-2 border-[#e8cf46] py-1 text-[11px] font-black tracking-[0.34em] text-[#e8cf46]">
          SIXTEEN NATIONS · SIX MINI GAMES · ONE CUP · AAA BROADCAST
        </div>
        <div className="mt-8 flex flex-col items-center gap-2">
          <Btn onClick={onStart}>PRESS FIRE TO CONTINUE</Btn>
          <div className="text-[9px] tracking-[0.3em] text-[#6f7f96]">© 1991 · THE ORIGINAL SPORT OF KINGS, IN SIXTEEN COLOURS</div>
        </div>
        <div className="mt-6 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-1 text-[9px] tracking-[0.16em] text-[#5f6f86] sm:grid-cols-4">
          {TEAMS.map((t) => <div key={t.id}>{t.short} · {t.nickname}</div>)}
        </div>
      </div>
    </div>
  );
}

/* ============================ MODE SELECT ============================ */

const MODES: { id: Mode; label: string; note: string }[] = [
  { id: 'FRIENDLY', label: 'FRIENDLY INTERNATIONAL', note: 'One match. Pick any two of sixteen nations.' },
  { id: 'WORLD_CUP', label: 'WORLD CUP', note: 'Four pools of four, then a knockout. Sixteen nations, one trophy.' },
  { id: 'FIVE_NATIONS', label: 'FIVE NATIONS', note: 'England, France, Ireland, Scotland and Wales. Four fixtures.' },
  { id: 'LEAGUE', label: 'EIGHT-TEAM LEAGUE', note: 'Seven rounds, two points a win, points difference decides.' },
  { id: 'CLASSIC', label: 'CLASSIC MATCHES', note: 'Twelve scenarios from history. Beat the real margin.' },
  { id: 'TUTORIAL', label: 'TUTORIAL — LEARN BY PLAYING', note: 'A real friendly match that pauses before each new contest, tells you which keys to press, then lets you play on. Nine steps from the kick-off to defending.' },
  { id: 'CLINIC', label: 'SKILLS CLINIC', note: 'Seven drills, one per control verb. Cannot fail, cannot end.' },
  { id: 'REPLAYS', label: 'REPLAY THEATRE', note: 'Five replay variants, varying in speed and dimension.' },
];

export function ModeScreen({ onPick, onOptions, onGuide, onAudit, hasReplays }: {
  onPick: (m: Mode) => void; onOptions: () => void; onGuide: () => void; onAudit: () => void; hasReplays: boolean;
}) {
  return (
    <div className="mx-auto max-w-5xl p-5">
      <TitleBar kicker="MAIN MENU" title="SELECT COMPETITION" />
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onPick(m.id)}
            className="group border-2 border-[#3d4b66] bg-[#101724] p-3 text-left hover:border-[#e8cf46]"
          >
            <div className="text-[13px] font-black tracking-[0.12em] text-[#f4efe2] group-hover:text-[#e8cf46]">{m.label}</div>
            <div className="mt-1 text-[10px] leading-snug text-[#7f8ea6]">{m.note}</div>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn onClick={onOptions}>OPTIONS &amp; LAWS</Btn>
        <Btn onClick={onGuide}>MEDIA GUIDE</Btn>
        <Btn onClick={onAudit}>BEHAVIOURAL AUDIT</Btn>
        {hasReplays && <Btn onClick={() => onPick('REPLAYS')}>REPLAY THEATRE</Btn>}
      </div>
      <div className="mt-4 grid gap-2 text-[10px] text-[#6f7f96] sm:grid-cols-4">
        {Object.values(COMPETITIONS).map((c) => (
          <div key={c.name} className="border border-[#26314a] p-2">
            <div className="font-black text-[#cfd8e6]">{c.name}</div>
            <div>{c.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================ TEAM SELECT ============================ */

export function TeamScreen({ mode, onBack, onConfirm }: {
  mode: Mode; onBack: () => void; onConfirm: (home: string, away: string, kitA: number, kitB: number) => void;
}) {
  const pool = mode === 'FIVE_NATIONS' ? TEAMS.filter((t) => FIVE_NATIONS_IDS.includes(t.id))
    : mode === 'CLASSIC' ? TEAMS.filter((t) => CLASSIC_MATCHES.some((m) => m.a === t.id || m.b === t.id))
      : TEAMS;
  const [home, setHome] = useState('ENG');
  const [away, setAway] = useState(mode === 'FIVE_NATIONS' ? 'FRA' : 'NZL');
  const [kitA, setKitA] = useState(0);
  const [kitB, setKitB] = useState(0);
  const kitsA = KITS[home] ?? KITS.ENG;
  const kitsB = KITS[away] ?? KITS.NZL;
  const H = TEAM_BY_ID(home), V = TEAM_BY_ID(away);
  const attrRow = (a: typeof H.att, b: typeof H.att, label: string, ka: keyof typeof a, kb: keyof typeof a) => (
    <div key={label} className="grid grid-cols-[52px_1fr_52px] items-center gap-2">
      <div className="text-right text-[10px] font-black tabular-nums text-[#e2664f]">{a[ka]}</div>
      <div>
        <div className="text-center text-[8px] tracking-[0.2em] text-[#7f8ea6]">{label}</div>
        <div className="relative h-1.5 w-full bg-[#0a0e16]">
          <div className="absolute left-0 top-0 h-full bg-[#c8402f]" style={{ width: `${a[ka] / 2}%` }} />
          <div className="absolute right-0 top-0 h-full bg-[#2f4f9c]" style={{ width: `${b[kb] / 2}%` }} />
        </div>
      </div>
      <div className="text-[10px] font-black tabular-nums text-[#7fa3e6]">{b[kb]}</div>
    </div>
  );
  return (
    <div className="mx-auto max-w-5xl p-5">
      <TitleBar kicker={mode.replace('_', ' ')} title="CHOOSE YOUR SIDE" right={<Btn onClick={onBack}>BACK</Btn>} />
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <Panel title="THE SIXTEEN">
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
            {pool.map((t) => (
              <button
                key={t.id}
                onClick={() => setHome(t.id)}
                onDoubleClick={() => setAway(t.id)}
                className={`border-2 p-1 text-center ${home === t.id ? 'border-[#e8cf46] bg-[#2a2412]' : away === t.id ? 'border-[#2f4f9c] bg-[#131c2e]' : 'border-[#26314a] bg-[#0e1522] hover:border-[#4a5a76]'}`}
              >
                <div className="text-[13px] font-black text-[#f4efe2]">{t.short}</div>
                <div className="text-[7px] text-[#7f8ea6]">{t.nickname}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[9px] tracking-[0.2em] text-[#7f8ea6]">OPPONENT</span>
            <select
              value={away}
              onChange={(e) => setAway(e.target.value)}
              className="border-2 border-[#3d4b66] bg-[#0a0e16] px-2 py-1 text-[11px] font-black text-[#f4efe2]"
            >
              {pool.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel title="MATCH-UP">
            <div className="flex items-center justify-between">
              <div className="text-center">
                <KitSwatch k={kitsA[kitA % kitsA.length]} size={30} />
                <div className="mt-1 text-[12px] font-black text-[#f4efe2]">{H.short}</div>
              </div>
              <div className="text-[10px] tracking-[0.2em] text-[#7f8ea6]">VERSUS</div>
              <div className="text-center">
                <KitSwatch k={kitsB[kitB % kitsB.length]} size={30} />
                <div className="mt-1 text-[12px] font-black text-[#f4efe2]">{V.short}</div>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {attrRow(H.att, V.att, 'SCRUM', 'scrum', 'scrum')}
              {attrRow(H.att, V.att, 'LINEOUT', 'lineout', 'lineout')}
              {attrRow(H.att, V.att, 'MAUL', 'maul', 'maul')}
              {attrRow(H.att, V.att, 'BREAKDOWN', 'ruck', 'ruck')}
              {attrRow(H.att, V.att, 'DEFENCE', 'defence', 'defence')}
              {attrRow(H.att, V.att, 'ATTACK', 'attack', 'attack')}
              {attrRow(H.att, V.att, 'KICKING', 'kicking', 'kicking')}
              {attrRow(H.att, V.att, 'DISCIPLINE', 'discipline', 'discipline')}
              {attrRow(H.att, V.att, 'PACE', 'pace', 'pace')}
              {attrRow(H.att, V.att, 'CREATIVITY', 'creativity', 'creativity')}
            </div>
            <div className="mt-2 text-[9px] text-[#6f7f96]">{H.venue} · {H.venueCap.toLocaleString()} · CPU PROFILE: {H.archetype} v {V.archetype}</div>
          </Panel>
          <Panel title="CHANGE STRIP">
            <div className="flex gap-2">
              <div className="flex-1">
                <div className="mb-1 text-[9px] text-[#e2664f]">HOME KIT</div>
                <div className="flex gap-1">{kitsA.map((k, i) => <button key={i} onClick={() => setKitA(i)} className={`border-2 ${kitA === i ? 'border-[#e8cf46]' : 'border-[#26314a]'}`}><KitSwatch k={k} size={20} /></button>)}</div>
              </div>
              <div className="flex-1">
                <div className="mb-1 text-[9px] text-[#7fa3e6]">AWAY KIT</div>
                <div className="flex gap-1">{kitsB.map((k, i) => <button key={i} onClick={() => setKitB(i)} className={`border-2 ${kitB === i ? 'border-[#e8cf46]' : 'border-[#26314a]'}`}><KitSwatch k={k} size={20} /></button>)}</div>
              </div>
            </div>
          </Panel>
          <Btn wide onClick={() => onConfirm(home, away, kitA, kitB)}>TO THE SQUAD SHEET</Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================ SQUAD ============================ */

export function SquadScreen({ teamId, onBack, onConfirm }: {
  teamId: string; onBack: () => void; onConfirm: (order: number[], kicker: number) => void;
}) {
  const T = TEAM_BY_ID(teamId);
  const [sel, setSel] = useState(0);
  const [order, setOrder] = useState(T.squad.map((_, i) => i));
  const [kicker, setKicker] = useState(T.squad[9]?.num ?? 10);
  const p = T.squad[sel];
  const w = POSITION_WEIGHTS[p.num];
  return (
    <div className="mx-auto max-w-5xl p-5">
      <TitleBar kicker={`${T.name} · ${T.nickname}`} title="THE SQUAD SHEET" right={<Btn onClick={onBack}>BACK</Btn>} />
      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <Panel title={`FIFTEEN · ${T.venue}`}>
          <div className="grid grid-cols-1 gap-0.5 text-[10px] sm:grid-cols-2">
            {T.squad.map((sp, i) => (
              <button
                key={sp.num}
                onClick={() => setSel(i)}
                className={`grid grid-cols-[22px_1fr_66px] items-center gap-2 border px-2 py-1 text-left ${sel === i ? 'border-[#e8cf46] bg-[#221d0f]' : 'border-[#26314a] bg-[#0e1522]'}`}
              >
                <span className="font-black text-[#e8cf46]">{sp.num}</span>
                <span className="truncate font-bold text-[#f4efe2]">
                  {sp.name}{sp.star > 0 && <span className="ml-1 text-[#e8cf46]">{'★'.repeat(sp.star)}</span>}
                </span>
                <span className="text-right text-[#7f8ea6]">{sp.pos}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Btn small onClick={() => { const o = [...order]; const i = order.indexOf(sel); if (i > 0) { [o[i - 1], o[i]] = [o[i], o[i - 1]]; setOrder(o); setSel(i - 1); } }}>▲ PROMOTE</Btn>
            <Btn small onClick={() => { const o = [...order]; const i = order.indexOf(sel); if (i < o.length - 1) { [o[i + 1], o[i]] = [o[i], o[i + 1]]; setOrder(o); setSel(i + 1); } }}>▼ DEMOTE</Btn>
            <span className="self-center text-[9px] text-[#6f7f96]">BENCH: {T.squad.length - 15 > 0 ? T.squad.length - 15 : 0} AVAILABLE</span>
          </div>
        </Panel>
        <div className="space-y-3">
          <Panel title={`${p.num} · ${p.pos}`}>
            <div className="text-[15px] font-black text-[#f4efe2]">{p.name}</div>
            <div className="mt-2 space-y-1.5">
              {(['SPD', 'PWR', 'SKL', 'KCK', 'STA', 'TTL'] as const).map((k) => (
                <div key={k}>
                  <div className="flex justify-between text-[9px] tracking-[0.18em] text-[#7f8ea6]"><span>{k === 'SPD' ? 'PACE' : k === 'PWR' ? 'POWER' : k === 'SKL' ? 'SKILL' : k === 'KCK' ? 'KICKING' : k === 'STA' ? 'STAMINA' : 'TACKLING'}</span><span className="tabular-nums text-[#cfd8e6]">{p.stats[k]}</span></div>
                  <Meter v={p.stats[k] / 100} />
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 text-[9px] text-[#6f7f96]">
              <div>ROLE DEMAND: SPD {Math.round(w.SPD * 100)}%</div>
              <div>PWR {Math.round(w.PWR * 100)}%</div>
              <div>SKL {Math.round(w.SKL * 100)}%</div>
              <div>KCK {Math.round(w.KCK * 100)}%</div>
            </div>
          </Panel>
          <Btn wide onClick={() => onConfirm(order, kicker)}>CONFIRM FIFTEEN</Btn>
          <Panel title="DESIGNATED GOAL KICKER">
            <div className="text-[9px] text-[#7f8ea6]">
              He takes every goal kick and every restart. No random kicker, ever.
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {T.squad.slice(8, 15).map((sp) => (
                <Btn key={sp.num} small active={kicker === sp.num} onClick={() => setKicker(sp.num)}>
                  {sp.num} {sp.name.split(' ').slice(-1)[0]} · K{sp.stats.KCK}
                </Btn>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ============================ TACTICS ============================ */

export function TacticsScreen({ teamId, sliders, setSliders, onBack, onConfirm, form, setForm, assists, setAssists }: {
  teamId: string; sliders: Slider[]; setSliders: (s: Slider[]) => void;
  onBack: () => void; onConfirm: () => void;
  form: { backline: string; defence: string; lineout: string; scrum: string };
  setForm: (f: { backline: string; defence: string; lineout: string; scrum: string }) => void;
  assists: { pass: number; tackle: number; kick: number };
  setAssists: (a: { pass: number; tackle: number; kick: number }) => void;
}) {
  const T = TEAM_BY_ID(teamId);
  const set = (id: string, v: number) => setSliders(sliders.map((s) => (s.id === id ? { ...s, v } : s)));
  const groups: { key: keyof typeof form; kind: string; label: string }[] = [
    { key: 'backline', kind: 'BACKLINE', label: 'ATTACK SHAPE' },
    { key: 'defence', kind: 'DEFENCE', label: 'DEFENSIVE SYSTEM' },
    { key: 'lineout', kind: 'LINEOUT', label: 'LINEOUT CALL' },
    { key: 'scrum', kind: 'SCRUM', label: 'SCRUM AGENDA' },
  ];
  return (
    <div className="mx-auto max-w-5xl p-5">
      <TitleBar kicker={`${T.name} · ${T.archetype}`} title="TACTICS BOARD" right={<Btn onClick={onBack}>BACK</Btn>} />
      <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
        <Panel title="PRESET PLAYBOOKS">
          <div className="space-y-1">
            {TACTIC_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSliders(DEFAULT_SLIDERS.map((s) => ({ ...s, v: p.sliders[s.id] ?? s.v })))}
                className="w-full border-2 border-[#26314a] bg-[#0e1522] p-2 text-left hover:border-[#e8cf46]"
              >
                <div className="text-[11px] font-black text-[#f4efe2]">{p.name}</div>
                <div className="text-[9px] text-[#7f8ea6]">{p.blurb}</div>
              </button>
            ))}
          </div>
        </Panel>
        <div className="space-y-3">
          <Panel title="TEN SLIDERS">
            <div className="grid gap-2 sm:grid-cols-2">
              {sliders.map((s) => (
                <div key={s.id}>
                  <div className="flex justify-between text-[9px] tracking-[0.16em] text-[#7f8ea6]">
                    <span>{s.label}</span><span className="tabular-nums text-[#cfd8e6]">{s.v}</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={s.step} value={s.v}
                    onChange={(e) => set(s.id, Number(e.target.value))}
                    className="w-full accent-[#e8cf46]"
                  />
                  <div className="flex justify-between text-[8px] text-[#5f6f86]"><span>{s.lo}</span><span>{s.hi}</span></div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid gap-2 sm:grid-cols-2">
            {groups.map((g) => {
              const list = FORMATIONS.filter((f) => f.kind === g.kind);
              const cur = FORMATIONS.find((f) => f.id === form[g.key]);
              return (
                <Panel key={g.key} title={g.label}>
                  <div className="flex flex-wrap gap-1">
                    {list.map((f) => (
                      <Btn key={f.id} small active={form[g.key] === f.id} onClick={() => setForm({ ...form, [g.key]: f.id })}>{f.name}</Btn>
                    ))}
                  </div>
                  {cur && <div className="mt-2 text-[9px] leading-snug text-[#7f8ea6]">{cur.blurb}</div>}
                </Panel>
              );
            })}
          </div>
          <Panel title="ASSIST SLIDERS — INDEPENDENT OF AI DIFFICULTY">
            <div className="text-[9px] text-[#7f8ea6]">
              These change input forgiveness only. The opposition never gets weaker. Turn them all off for the pure test.
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(['pass', 'tackle', 'kick'] as const).map((k) => (
                <div key={k}>
                  <div className="flex justify-between text-[9px] tracking-[0.16em] text-[#7f8ea6]">
                    <span>{k.toUpperCase()} ASSIST</span><span className="tabular-nums text-[#cfd8e6]">{Math.round(assists[k] * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100} step={5} value={Math.round(assists[k] * 100)}
                    onChange={(e) => setAssists({ ...assists, [k]: Number(e.target.value) / 100 })}
                    className="w-full accent-[#e8cf46]"
                  />
                </div>
              ))}
            </div>
          </Panel>
          <Btn wide onClick={onConfirm}>TAKE THE FIELD</Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================ OPTIONS ============================ */

export function OptionsScreen({ options, setOptions, onBack, onReset }: {
  options: Record<string, number>; setOptions: (o: Record<string, number>) => void; onBack: () => void;
  onReset?: () => void;
}) {
  const cats = Array.from(new Set(OPTION_ITEMS.map((o) => o.cat)));
  const [open, setOpen] = useState<string>(cats[0]);
  return (
    <div className="mx-auto max-w-5xl p-5">
      <TitleBar kicker="MATCH OFFICIALS" title="OPTIONS &amp; LAWS" right={<Btn onClick={onBack}>BACK</Btn>} />
      <div className="mb-3 flex flex-wrap gap-1">
        {cats.map((c) => <Btn key={c} small active={open === c} onClick={() => setOpen(c)}>{c}</Btn>)}
      </div>
      <div className="space-y-1">
        {OPTION_ITEMS.filter((o) => o.cat === open).map((o) => (
          <div key={o.id} className="grid grid-cols-[160px_1fr_220px] items-center gap-3 border border-[#26314a] bg-[#0e1522] px-3 py-1.5">
            <div className="text-[11px] font-black tracking-[0.1em] text-[#f4efe2]">{o.label}</div>
            <div className="flex items-center gap-1">
              <Btn small onClick={() => setOptions({ ...options, [o.id]: Math.max(0, (options[o.id] ?? o.def) - 1) })}>◀</Btn>
              <div className="min-w-[120px] border border-[#3d4b66] bg-[#0a0e16] px-2 py-1 text-center text-[11px] font-black text-[#e8cf46]">
                {o.values[options[o.id] ?? o.def]}
              </div>
              <Btn small onClick={() => setOptions({ ...options, [o.id]: Math.min(o.values.length - 1, (options[o.id] ?? o.def) + 1) })}>▶</Btn>
            </div>
            <div className="text-[9px] leading-snug text-[#7f8ea6]">{o.note}</div>
          </div>
        ))}
      </div>
      {onReset && (
        <div className="mt-4 flex items-center justify-between gap-3 border border-[#3d2a2a] bg-[#160e10] px-3 py-2">
          <div className="text-[9px] leading-snug text-[#a68484]">
            T-12 · PERSISTENCE — squads, tactics, kicker and options are saved to this browser and
            restored on load. RESET wipes the save and restores every factory default.
          </div>
          <Btn small onClick={onReset}>RESET TO DEFAULTS</Btn>
        </div>
      )}
    </div>
  );
}

/* ============================ MEDIA GUIDE ============================ */

/* ============================ BEHAVIOUR DATASET (T-14) ============================ */

/** The five beats of one shirt's situation, on the full-pitch dataset grid
 *  (x 0..100 along the pitch, y 0..100 across it), plus the shirt's run lines
 *  in the ruck-relative metres frame they are authored in. */
function BehaviourTab() {
  const rep = useMemo(() => datasetReport(), []);
  const [shirt, setShirt] = useState(1);
  const [sit, setSit] = useState<SituationId>('own-scrum-mid');
  const [side, setSide] = useState<'attack' | 'defence'>('attack');
  const pts = behaviourFor(shirt, sit);
  const lines = runLinesFor(shirt, side);
  const meta = SITUATION_META[sit];

  // pitch grid: 104x104 viewBox with a 2-unit margin
  const PX = (x: number) => 2 + x, PY = (y: number) => 2 + y;

  return (
    <div className="space-y-2">
      {/* honesty first: the report's problems, in red, at the top */}
      {rep.problems.length > 0 ? (
        <div className="border-2 border-[#ff6a5a] bg-[#1a0e0e] p-2">
          <div className="text-[10px] font-black tracking-[0.2em] text-[#ff6a5a]">DATASET REPORT — {rep.problems.length} PROBLEM{rep.problems.length > 1 ? 'S' : ''}</div>
          {rep.problems.map((pr) => <div key={pr} className="text-[9px] leading-snug text-[#e8a49c]">• {pr}</div>)}
        </div>
      ) : (
        <div className="border border-[#6ee7a0] bg-[#0e1a12] p-2 text-[10px] font-black tracking-[0.2em] text-[#6ee7a0]">DATASET REPORT — NO PROBLEMS</div>
      )}
      <div className="flex flex-wrap items-center gap-2 border border-[#26314a] bg-[#0e1522] px-2 py-1 text-[9px] text-[#7f8ea6]">
        <span className="font-black text-[#e8cf46]">{rep.percentComplete}% COMPLETE</span>
        <span>{rep.totalPoints}/{rep.expectedPoints} points</span>
        <span>·</span><span>AUTHORED: {rep.authoredPositions.join(', ') || '—'}</span>
        <span>·</span><span>PENDING: {rep.pendingPositions.join(', ') || '— NONE'}</span>
        <span>·</span><span>{rep.runLines} RUN LINES, ALL FIFTEEN SHIRTS</span>
      </div>

      {/* shirt picker */}
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => {
          const authored = AUTHORED_POSITIONS.includes(n);
          return (
            <Btn key={n} small active={shirt === n} onClick={() => setShirt(n)}>
              <span className={authored ? '' : 'opacity-40'}>{n}{authored ? '' : ' ·'}</span>
            </Btn>
          );
        })}
        <span className="self-center text-[9px] text-[#7f8ea6]">DIMMED = POSITIONAL DATA PENDING · RUN LINES STILL DRAW</span>
      </div>

      {/* situation picker */}
      <div className="flex flex-wrap gap-1">
        {SITUATIONS.map((s) => (
          <Btn key={s} small active={sit === s} onClick={() => setSit(s)}>{SITUATION_META[s].label}</Btn>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {/* the five beats, on the pitch grid */}
        <div className="border border-[#26314a] bg-[#0e1522] p-2">
          <div className="mb-1 text-[10px] font-black tracking-[0.2em] text-[#f4efe2]">
            SHIRT {shirt} · {SITUATION_META[sit].label} · {meta.attacking ? 'OUR BALL' : 'DEFENDING'} ({meta.phase})
          </div>
          <svg viewBox="0 0 104 104" className="w-full bg-[#0a0e16]">
            {/* touchlines, try lines, 22s, halfway */}
            <rect x={PX(0)} y={PY(0)} width={100} height={100} fill="none" stroke="#3d4b66" strokeWidth={0.7} />
            {[0, 100].map((x) => <line key={x} x1={PX(x)} y1={PY(0)} x2={PX(x)} y2={PY(100)} stroke="#e8cf46" strokeWidth={0.5} />)}
            {[22, 50, 78].map((x) => <line key={x} x1={PX(x)} y1={PY(0)} x2={PX(x)} y2={PY(100)} stroke="#3d4b66" strokeWidth={0.35} strokeDasharray="1.5 1.5" />)}
            <text x={PX(50)} y={PY(-0.5)} fontSize={2.4} fill="#7f8ea6" textAnchor="middle">HALFWAY</text>
            {/* the beat path */}
            {pts.length > 1 && (
              <polyline
                points={pts.map((pt) => `${PX(pt.x)},${PY(pt.y)}`).join(' ')}
                fill="none" stroke="#6ee7a0" strokeWidth={0.7} strokeDasharray="2 1"
              />
            )}
            {pts.map((pt, i) => (
              <g key={pt.id}>
                <circle cx={PX(pt.x)} cy={PY(pt.y)} r={2.6} fill="#e8cf46" stroke="#0a0e16" strokeWidth={0.5} />
                <text x={PX(pt.x)} y={PY(pt.y) + 0.9} fontSize={2.8} fill="#0a0e16" textAnchor="middle" fontWeight={900}>{i + 1}</text>
              </g>
            ))}
            {pts.length === 0 && (
              <text x={52} y={52} fontSize={4} fill="#ff6a5a" textAnchor="middle">NO AUTHORED POINTS FOR SHIRT {shirt}</text>
            )}
          </svg>
          <div className="mt-1 space-y-1">
            {pts.map((pt) => (
              <div key={pt.id} className="border-l-2 border-[#e8cf46] pl-2">
                <div className="text-[9px] font-black tracking-[0.15em] text-[#e8cf46]">{pt.beat}. {pt.beatName.toUpperCase()} — ({pt.x}, {pt.y})</div>
                <div className="text-[9px] leading-snug text-[#cfd8e6]">{pt.instruction}</div>
                <div className="text-[9px] leading-snug text-[#7f8ea6]">FALLBACK: {pt.fallback}</div>
              </div>
            ))}
          </div>
        </div>

        {/* the run lines, ruck-relative metres */}
        <div className="border border-[#26314a] bg-[#0e1522] p-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10px] font-black tracking-[0.2em] text-[#f4efe2]">RUN LINES — SHIRT {shirt}</div>
            <div className="flex gap-1">
              <Btn small active={side === 'attack'} onClick={() => setSide('attack')}>ATTACK</Btn>
              <Btn small active={side === 'defence'} onClick={() => setSide('defence')}>DEFENCE</Btn>
            </div>
          </div>
          <svg viewBox="-16 -20 40 40" className="w-full bg-[#0a0e16]">
            {/* depth axis: ruck at (0,0), gain line vertical through it */}
            <line x1={0} y1={-18} x2={0} y2={18} stroke="#e8cf46" strokeWidth={0.4} strokeDasharray="1 1" />
            <text x={0.6} y={-16.5} fontSize={1.6} fill="#e8cf46">GAIN LINE</text>
            <circle cx={0} cy={0} r={0.8} fill="#f4efe2" />
            <text x={1} y={1.2} fontSize={1.6} fill="#7f8ea6">RUCK</text>
            {/* upfield = +x */}
            <text x={12} y={-16.5} fontSize={1.6} fill="#7f8ea6">UPFIELD →</text>
            {lines.map((l) => {
              const col = LINE_FAMILIES[l.family]?.color ?? '#7f8ea6';
              return (
                <g key={l.id}>
                  <polyline points={l.path.map(([dx, dy]) => `${dx},${dy}`).join(' ')} fill="none" stroke={col} strokeWidth={0.5} />
                  <circle cx={l.path[0][0]} cy={l.path[0][1]} r={0.55} fill={col} />
                  <circle cx={l.path[l.path.length - 1][0]} cy={l.path[l.path.length - 1][1]} r={0.55} fill={col} />
                </g>
              );
            })}
            {lines.length === 0 && <text x={2} y={0} fontSize={2} fill="#ff6a5a">NO LINES FOR THIS SHIRT/SIDE</text>}
          </svg>
          <div className="mt-1 space-y-1">
            {lines.map((l) => (
              <div key={l.id} className="border-l-2 pl-2" style={{ borderColor: LINE_FAMILIES[l.family]?.color ?? '#7f8ea6' }}>
                <div className="text-[9px] font-black tracking-[0.15em]" style={{ color: LINE_FAMILIES[l.family]?.color ?? '#7f8ea6' }}>
                  {l.name.toUpperCase()} · {LINE_FAMILIES[l.family]?.label ?? l.family} · {l.speed.toUpperCase()} · {l.lengthM} m
                </div>
                <div className="text-[9px] leading-snug text-[#cfd8e6]">{l.purpose}</div>
                <div className="text-[9px] leading-snug text-[#7f8ea6]">IF OCCUPIED: {l.ifOccupied}</div>
                <div className="text-[9px] leading-snug text-[#7f8ea6]">TRIGGER: {l.trigger}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GuideScreen({ onBack }: { onBack: () => void }) {
  const count = useMemo(() => dataPointCount(), []);
  const [tab, setTab] = useState<string>(MANUAL[0].id);
  const [team, setTeam] = useState('ENG');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const [team2, setTeam2] = useState('ENG');
  const jlr = useMemo(() => jlrPointCount(), []);
  const pit = useMemo(() => pitfallPoints(), []);
  const anim = useMemo(() => animationPointCount(), []);
  const paper = useMemo(() => paperPointCount(), []);
  const pits = useMemo(() => searchPitfalls(q).filter((p) => cat === 'ALL' || p.cat === cat), [q, cat]);
  const T = TEAM_BY_ID(team);
  const tabs = [
    ...MANUAL.map((m) => ({ id: m.id, label: m.title })),
    { id: 'JLR', label: 'LOMU 1997' },
    { id: 'SHAPES', label: 'SHAPES & CAMERA' },
    { id: 'ROLES', label: 'ROLE CONTRACTS' },
    { id: 'PLAYS', label: 'SET PLAYS' },
    { id: 'PITFALLS', label: 'PITFALLS' },
    { id: 'CLASSIC', label: 'CLASSIC' },
    { id: 'SQUADS', label: 'SQUADS' },
    { id: 'LAWS', label: 'LAWS' },
    { id: 'AI', label: 'AI MODEL' },
    { id: 'BEHAVIOUR', label: 'BEHAVIOUR' },
    { id: 'NUM', label: 'THE NUMBERS' },
  ];
  return (
    <div className="mx-auto max-w-5xl p-5">
      <TitleBar
        kicker="EVERYTHING BUT THE GRAPHICS"
        title="MEDIA GUIDE"
        right={<Btn onClick={onBack}>BACK</Btn>}
      />
      <div className="mb-3 border-2 border-[#e8cf46] bg-[#161a10] p-3">
        <div className="text-[10px] tracking-[0.3em] text-[#7f8ea6]">DESIGN DATA POINTS ACROSS FIVE RESEARCH SETS</div>
        <div className="text-4xl font-black tabular-nums text-[#e8cf46]">
          {(count.total + jlr.total + pit.total + anim.total + paper.total).toLocaleString()}
        </div>
        <div className="mt-1 grid gap-1 text-[9px] text-[#8f9e6a] sm:grid-cols-5">
          <div className="border border-[#26314a] p-1">
            <div className="font-black text-[#e8cf46]">ENGINE SPEC — {count.total.toLocaleString()}</div>
            {count.breakdown.slice(0, 5).map(([k, v]) => <div key={k}>{k} <b className="text-[#e8cf46]">{v}</b></div>)}
          </div>
          <div className="border border-[#26314a] p-1">
            <div className="font-black text-[#e8cf46]">LOMU 1997 — {jlr.total.toLocaleString()}</div>
            {jlr.breakdown.map(([k, v]) => <div key={k}>{k} <b className="text-[#e8cf46]">{v}</b></div>)}
          </div>
          <div className="border border-[#26314a] p-1">
            <div className="font-black text-[#e8cf46]">PITFALL REGISTRY — {pit.total.toLocaleString()}</div>
            {pit.byStatus.map(([k, v]) => <div key={k}>{k} <b className="text-[#e8cf46]">{v}</b></div>)}
            <div>COMPLAINTS <b className="text-[#e8cf46]">{PITFALLS.length}</b> in {pit.byCategory.length} categories</div>
          </div>
          <div className="border border-[#26314a] p-1">
            <div className="font-black text-[#e8cf46]">ANIMATION &amp; WEIGHT — {anim.total.toLocaleString()}</div>
            {anim.breakdown.map(([k, v]) => <div key={k}>{k} <b className="text-[#e8cf46]">{v}</b></div>)}
            <div>PRINCIPLES, CURVES, TIMING, SPACING, RUGBY MOTION, CONTACT</div>
          </div>
          <div className="border border-[#26314a] p-1">
            <div className="font-black text-[#e8cf46]">PAPERCRAFT — {paper.total.toLocaleString()}</div>
            {paper.breakdown.map(([k, v]) => <div key={k}>{k} <b className="text-[#e8cf46]">{v}</b></div>)}
            <div>BILLBOARD, TURN, LYING, EDGE, WEIGHT, DEPTH</div>
          </div>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {tabs.map((t) => <Btn key={t.id} small active={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</Btn>)}
      </div>

      {MANUAL.some((m) => m.id === tab) && (
        <Panel title={MANUAL.find((m) => m.id === tab)!.title}>
          <div className="space-y-1">
            {MANUAL.find((m) => m.id === tab)!.entries.map((e) => (
              <div key={e.k} className="grid grid-cols-[190px_1fr] gap-3 border-b border-[#1b2434] py-1">
                <div className="text-[10px] font-black text-[#e8cf46]">{e.k}</div>
                <div className="text-[10px] leading-snug text-[#cfd8e6]">{e.v}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'SQUADS' && (
        <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
          <Panel title="NATIONS">
            <div className="grid grid-cols-2 gap-1">
              {TEAMS.map((t) => <Btn key={t.id} small active={team === t.id} onClick={() => setTeam(t.id)}>{t.short}</Btn>)}
            </div>
          </Panel>
          <Panel title={`${T.name} · ${T.venue} · ${T.archetype}`}>
            <div className="mb-2 grid grid-cols-6 gap-1 text-center text-[9px]">
              {(['scrum', 'lineout', 'maul', 'ruck', 'defence', 'attack', 'kicking', 'discipline', 'fitness', 'pace', 'handling', 'creativity'] as const).map((k) => (
                <div key={k} className="border border-[#26314a] bg-[#0e1522] p-1">
                  <div className="text-[#7f8ea6]">{k.slice(0, 4).toUpperCase()}</div>
                  <div className="text-[12px] font-black text-[#e8cf46]">{T.att[k]}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-0.5 text-[9px] sm:grid-cols-2">
              {T.squad.map((p) => (
                <div key={p.num} className="grid grid-cols-[18px_1fr_44px_44px_44px_44px_44px_44px] gap-1 border-b border-[#1b2434] py-0.5">
                  <span className="font-black text-[#e8cf46]">{p.num}</span>
                  <span className="truncate text-[#f4efe2]">{p.name}</span>
                  {(['SPD', 'PWR', 'SKL', 'KCK', 'STA', 'TTL'] as const).map((k) => (
                    <span key={k} className="text-right tabular-nums text-[#7f8ea6]">{p.stats[k]}</span>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'LAWS' && (
        <Panel title="THE LAWS AS ENFORCED">
          <div className="grid gap-1 sm:grid-cols-2">
            {LAW_ENTRIES.map((l) => (
              <div key={l.law} className="border border-[#26314a] bg-[#0e1522] p-2">
                <div className="text-[10px] font-black text-[#e8cf46]">{l.law}</div>
                <div className="text-[9px] leading-snug text-[#a9b6c8]">{l.text}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-1 sm:grid-cols-3">
            {TROPHIES.map((t) => (
              <div key={t.id} className="border border-[#26314a] p-2">
                <div className="text-[10px] font-black text-[#f4efe2]">{t.name}</div>
                <div className="text-[9px] text-[#7f8ea6]">{t.text}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'BEHAVIOUR' && (<BehaviourTab />)}
      {tab === 'AI' && (
        <div className="space-y-3">
          <Panel title="DIFFICULTY LADDER">
            <div className="space-y-0.5 text-[9px]">
              {DIFFICULTY_TABLE.map((d) => (
                <div key={d.lvl} className="grid grid-cols-[28px_80px_1fr] items-center gap-2 border-b border-[#1b2434] py-0.5">
                  <span className="font-black text-[#e8cf46]">{d.lvl}</span>
                  <span className="font-black text-[#f4efe2]">{d.name}</span>
                  <span className="text-[#7f8ea6]">reaction {d.reaction.toFixed(2)} · error {(d.errorRate * 100).toFixed(0)}% · read {(d.readRate * 100).toFixed(0)}% · {d.note}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="ARCHETYPES">
            <div className="grid gap-1 sm:grid-cols-3">
              {Object.values(AI_ARCHETYPES).map((a) => (
                <div key={a.name} className="border border-[#26314a] bg-[#0e1522] p-2">
                  <div className="text-[10px] font-black text-[#e8cf46]">{a.name}</div>
                  <div className="text-[9px] text-[#a9b6c8]">{a.blurb}</div>
                  <div className="mt-1 text-[8px] text-[#6f7f96]">kick {a.kickBias.toFixed(2)} · width {a.widthBias.toFixed(2)} · offload {a.offloadBias.toFixed(2)} · risk {a.riskTolerance.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="DECISION WEIGHTS">
            <div className="grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-2">
              {AI_WEIGHTS.map((w) => (
                <div key={w.phase + w.option} className="grid grid-cols-[70px_1fr_40px] gap-2 border-b border-[#1b2434]">
                  <span className="text-[#6f7f96]">{w.phase}</span>
                  <span className="text-[#cfd8e6]">{w.option} <span className="text-[#5f6f86]">{w.situational}</span></span>
                  <span className="text-right tabular-nums text-[#e8cf46]">{w.base.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'JLR' && (
        <div className="space-y-3">
          <Panel title="JONAH LOMU RUGBY, 1997 — WHAT WE BORROWED">
            <div className="text-[10px] leading-relaxed text-[#a9b6c8]">
              Rage Software's brief, from Trevor Williams in 1997: <span className="text-[#e8cf46]">"We wanted a game that stayed
              true to the rules, but was easy to pick up and play without a complete understanding of all rugby's ins and
              outs."</span> Every rule below is implemented in this engine, not aspirational.
            </div>
            <div className="mt-2 grid gap-1 text-[9px] sm:grid-cols-2">
              {SEAMLESSNESS_RULES.map((r) => (
                <div key={r.id} className="border border-[#26314a] bg-[#0e1522] p-1.5">
                  <div className="text-[#e8cf46]">{r.id} · {r.rule}</div>
                  <div className="text-[#7f8ea6]">{r.shipped}</div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title="THE ATTRIBUTE MODEL">
              {ATTRIBUTE_MODEL.map((a) => (
                <div key={a.key} className="mb-1 border-b border-[#1b2434] pb-1">
                  <div className="text-[10px] font-black text-[#e8cf46]">{a.key} · {a.label}</div>
                  <div className="text-[9px] text-[#cfd8e6]">Drives: {a.drives}</div>
                  <div className="text-[9px] text-[#6f7f96]">{a.note}</div>
                </div>
              ))}
              <div className="mt-2 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">SIGNATURE PLAYER RULES</div>
              {SIGNATURE_PLAYER_RULES.map((s) => (
                <div key={s.value} className="text-[9px] text-[#cfd8e6]">
                  <span className="text-[#e8cf46]">{s.value}</span> — {s.drives}
                </div>
              ))}
            </Panel>
            <Panel title="CONTROL VERBS — ONE BUTTON, ONE INTENT">
              {CONTROL_VERBS.map((c) => (
                <div key={c.verb} className="mb-1 border-b border-[#1b2434] pb-1">
                  <div className="text-[10px] font-black text-[#e8cf46]">{c.input} → {c.verb}</div>
                  <div className="text-[9px] text-[#7f8ea6]">{c.rule}</div>
                </div>
              ))}
            </Panel>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title="ACCESSIBILITY RULES">
              {ACCESSIBILITY_RULES.map((a) => (
                <div key={a.id} className="mb-1 border-b border-[#1b2434] pb-0.5">
                  <div className="text-[10px] font-black text-[#e8cf46]">{a.rule}</div>
                  <div className="text-[9px] text-[#7f8ea6]">{a.detail}</div>
                </div>
              ))}
            </Panel>
            <Panel title="FAIRNESS INVARIANTS — NONE OF THIS CAN HAPPEN">
              {FAIRNESS_INVARIANTS.map((f) => (
                <div key={f.id} className="mb-1 border-b border-[#1b2434] pb-0.5">
                  <div className="text-[10px] text-[#cfd8e6]"><span className="text-[#e8cf46]">{f.id}</span> {f.invariant}</div>
                  <div className="text-[9px] italic text-[#6f7f96]">because: {f.because}</div>
                </div>
              ))}
            </Panel>
          </div>
          <Panel title="MODES AND CONTENT BORROWED">
            <div className="grid gap-1 text-[9px] sm:grid-cols-2">
              {LOMU_MODES.map((m) => (
                <div key={m.mode} className="border border-[#26314a] p-1">
                  <div className="font-black text-[#e8cf46]">{m.mode}</div>
                  <div className="text-[#a9b6c8]">{m.note}</div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="border-2 border-[#e8cf46] bg-[#161a10] p-2 text-[9px] text-[#8f9e6a]">
            LOMU 1997 DATA POINTS CATALOGUED: <b className="text-[#e8cf46]">{jlr.total.toLocaleString()}</b>
            {jlr.breakdown.map(([k, v]) => <span key={k} className="ml-2">{k} <b className="text-[#e8cf46]">{v}</b></span>)}
          </div>
        </div>
      )}

      {tab === 'ROLES' && (
        <Panel title="ROLE CONTRACTS — FIFTEEN SHIRTS, SEVEN PHASES">
          <div className="mb-2 text-[10px] text-[#a9b6c8]">
            The fix for "players are never in their correct position", "props will line up at flyhalf while fullbacks are
            rucking" and "pointless having a backline as the forwards plays flyhalf". Each shirt has a written lateral
            offset, a depth and a job for every phase. Position is by shirt number, never by proximity.
          </div>
          <div className="max-h-[440px] space-y-1 overflow-auto">
            {ROLE_CONTRACTS.map((r) => (
              <div key={r.num} className="border border-[#26314a] bg-[#0e1522] p-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-black text-[#e8cf46]">{r.num} · {r.pos}</span>
                  <span className="text-[8px] text-[#7f8ea6]">BALL OUT: {r.cover}</span>
                </div>
                <div className="mt-1 grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-2">
                  {Object.entries(r.job).map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[64px_1fr] gap-1">
                      <span className="text-[#7f8ea6]">{k.replace('_', ' ')}</span>
                      <span className="text-[#cfd8e6]">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 text-[9px] text-[#ff8a72]">NEVER: {r.never}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[8px] text-[#6f7f96]">
                  {Object.entries(r.lateral).map(([k, v]) => <span key={k}>{k.replace('_', ' ')} LAT {v}</span>)}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'PLAYS' && (
        <Panel title="SET PLAY LIBRARY — CALLABLE AT ANY RUCK, SCRUM OR LINEOUT">
          <div className="mb-2 text-[10px] text-[#a9b6c8]">
            "No set plays, even games from the 90s had these." Ten plays, each with a named runner instruction, a risk
            and a reward. The CPU calls these too, and escalates rather than repeating one that failed.
          </div>
          <div className="space-y-1">
            {SET_PLAYS.map((p) => (
              <div key={p.id} className="border border-[#26314a] bg-[#0e1522] p-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-black text-[#e8cf46]">{p.name}</span>
                  <span className="text-[9px] text-[#7f8ea6]">FROM {p.from} · CALL "{p.call}" · RISK {(p.risk * 100).toFixed(0)}% · REWARD {(p.reward * 100).toFixed(0)}%</span>
                </div>
                <div className="text-[10px] text-[#cfd8e6]">{p.intent}</div>
                <div className="text-[9px] text-[#7f8ea6]">{p.shape}</div>
                <div className="mt-1 grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-2">
                  {p.runners.map((r) => (
                    <div key={r.num} className="grid grid-cols-[20px_1fr] gap-1">
                      <span className="font-black text-[#e8cf46]">{r.num}</span>
                      <span className="text-[#a9b6c8]">{r.instruction}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'PITFALLS' && (
        <div className="space-y-3">
          <Panel title="THE PITFALL REGISTRY — REAL COMPLAINTS, ENGINEERED FIXES">
            <div className="text-[10px] leading-relaxed text-[#a9b6c8]">
              Sourced from player reviews of rugby titles between 1995 and 2026. Every entry is a real class of
              complaint, its engineering root cause, the fix shipped here, and the system that implements it. Status is
              honest — six are recorded as accepted limitations rather than pretended away.
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={q} onChange={(e) => setQ(e.target.value)} placeholder="SEARCH COMPLAINTS…"
                className="w-48 border-2 border-[#3d4b66] bg-[#0a0e16] px-2 py-1 text-[10px] text-[#f4efe2]"
              />
              <Btn small active={cat === 'ALL'} onClick={() => setCat('ALL')}>ALL</Btn>
              {CATEGORIES.map((c) => <Btn key={c} small active={cat === c} onClick={() => setCat(c)}>{c}</Btn>)}
            </div>
            <div className="mt-2 border-2 border-[#e8cf46] bg-[#161a10] p-2 text-[9px] text-[#8f9e6a]">
              <b className="text-[#e8cf46]">{PITFALLS.length}</b> complaints · <b className="text-[#e8cf46]">{pit.total.toLocaleString()}</b> registry data points ·
              {pit.byStatus.map(([k, v]) => <span key={k} className="ml-2">{k} <b className="text-[#e8cf46]">{v}</b></span>)}
              <span className="ml-3">FIX RATE {((pit.byStatus.find(([k]) => k === 'FIXED')?.[1] ?? 0) / PITFALLS.length * 100).toFixed(0)}%</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 text-[9px] sm:grid-cols-3">
              {pit.byCategory.map(([k, total, fixed]) => (
                <div key={k} className="flex justify-between border-b border-[#1b2434]">
                  <span className="text-[#7f8ea6]">{k}</span>
                  <span className="text-[#cfd8e6]">{fixed}/{total} fixed</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title={`${pits.length} ENTRIES`}>
            <div className="max-h-[460px] space-y-1 overflow-auto">
              {pits.map((p) => (
                <div key={p.id} className="border border-[#26314a] bg-[#0e1522] p-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-black text-[#ff8a72]">"{p.complaint}"</span>
                    <span className={`ml-2 shrink-0 px-1 text-[8px] font-black ${p.status === 'FIXED' ? 'bg-[#6ee7a0] text-[#0a0e16]' : p.status === 'DESIGNED_AROUND' ? 'bg-[#e8cf46] text-[#14161d]' : 'bg-[#7f8ea6] text-[#14161d]'}`}>{p.status}</span>
                  </div>
                  <div className="mt-0.5 text-[9px] text-[#7f8ea6]">CAUSE: {p.cause}</div>
                  <div className="text-[9px] text-[#cfd8e6]">FIX: {p.fix}</div>
                  <div className="text-[9px] text-[#8f9e6a]">IN GAME: {p.inGame}</div>
                  <div className="text-[8px] text-[#5f6f86]">{p.id} · {p.cat}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'CLASSIC' && (
        <div className="space-y-3">
          <Panel title="CLASSIC MATCHES — REWRITE HISTORY">
            <div className="mb-2 text-[10px] text-[#a9b6c8]">
              Twelve scenarios from the history of the game. Each gives you a side and a target margin to beat.
            </div>
            <div className="flex flex-wrap gap-1">
              {TEAMS.map((t) => <Btn key={t.id} small active={team2 === t.id} onClick={() => setTeam2(t.id)}>{t.short}</Btn>)}
            </div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {CLASSIC_MATCHES.map((m) => (
                <div key={m.id} className={`border p-2 ${m.a === team2 || m.b === team2 ? 'border-[#e8cf46] bg-[#221d0f]' : 'border-[#26314a] bg-[#0e1522]'}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-black text-[#e8cf46]">{m.name}</span>
                    <span className="text-[9px] text-[#f4efe2]">{TEAM_BY_ID(m.a).short} v {TEAM_BY_ID(m.b).short}</span>
                  </div>
                  <div className="text-[9px] text-[#cfd8e6]">TARGET: {m.target}</div>
                  <div className="text-[9px] text-[#7f8ea6]">{m.brief}</div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="CURRENT CONTROL MAP — EVERY VERB REBINDABLE">
            <div className="grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-3">
              {Object.entries(KEYMAP).filter(([k]) => k.length === 1).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-[#1b2434]">
                  <span className="text-[#e8cf46]">{k === ' ' ? 'SPACE' : k.toUpperCase()}</span>
                  <span className="text-[#7f8ea6]">{v}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'SHAPES' && (
        <div className="space-y-3">
          <Panel title="ATTACKING SHAPES — HOW A PROFESSIONAL SIDE ACTUALLY STANDS">
            <div className="mb-2 text-[10px] leading-relaxed text-[#a9b6c8]">
              The numbers read across the field, not down it. A 1-3-3-1 has one forward alone on
              each wing and two pods of three in the middle. The point of a shape is to spread the
              forwards rather than bunch them around the ball, so the defence is stretched and there
              is always a willing carrier wherever the ball goes. Inside a pod of three the front
              prong is the receiver, the inside prong clears out, and the outside prong takes the tip.
            </div>
            <div className="space-y-1">
              {ATTACK_SHAPES.map((s) => (
                <div key={s.id} className="border border-[#26314a] bg-[#0e1522] p-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12px] font-black text-[#e8cf46]">{s.name} — {s.reading}</span>
                    <span className="text-[9px] text-[#7f8ea6]">REALIGN {s.realignTime}s · TIP {(s.tipTendency * 100).toFixed(0)}% · TUNNEL {(s.tunnelTendency * 100).toFixed(0)}%</span>
                  </div>
                  <div className="text-[9px] text-[#cfd8e6]">{s.blurb}</div>
                  {/* the shape drawn as it stands on the pitch */}
                  <div className="relative mt-2 h-14 border-y border-[#3d4b66] bg-[#0a0e16]">
                    {s.slots.filter((x) => x.num <= 8).map((x) => (
                      <div key={x.num} className="absolute w-4 text-center text-[8px] font-black"
                        style={{ left: `${((x.lat + 30) / 60) * 100}%`, top: `${20 + (x.depth / 16) * 55}%`, color: '#e2664f', transform: 'translateX(-50%)' }}>
                        {x.num}
                      </div>
                    ))}
                    {s.slots.filter((x) => x.num >= 9).map((x) => (
                      <div key={x.num} className="absolute w-4 text-center text-[8px] font-black"
                        style={{ left: `${((x.lat + 30) / 60) * 100}%`, top: `${16 + (x.depth / 16) * 55}%`, color: '#7fa3e6', transform: 'translateX(-50%)' }}>
                        {x.num}
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-2">
                    {s.slots.map((x) => (
                      <div key={x.num} className="grid grid-cols-[18px_58px_1fr] gap-1">
                        <span className="font-black text-[#e8cf46]">{x.num}</span>
                        <span className="text-[#7f8ea6]">{x.role.replace('_', ' ')}</span>
                        <span className="truncate text-[#a9b6c8]">{x.job}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title="DEFENSIVE SYSTEMS">
              {DEFENCE_SYSTEMS.map((x) => (
                <div key={x.id} className="mb-1 border-b border-[#1b2434] pb-1">
                  <div className="text-[11px] font-black text-[#e8cf46]">{x.name}</div>
                  <div className="text-[9px] text-[#a9b6c8]">{x.blurb}</div>
                  <div className="text-[8px] text-[#6f7f96]">line speed {x.lineSpeed} m/s · drift {x.drift} · shoot {x.shoot} · max spacing {x.maxSpacing} m · sweeper {x.sweeperDepth} m deep</div>
                  <div className="text-[9px] text-[#cfd8e6]">BRIEF: {x.job}</div>
                </div>
              ))}
            </Panel>
            <Panel title="BROADCAST CAMERA PLAN">
              <div className="mb-2 text-[9px] text-[#a9b6c8]">
                From a real rugby union outside-broadcast plan: Camera 1 is the main wide on the
                touchline gantry, Camera 2 the main tight, Camera 3 the close-up near halfway, and
                Camera 12 the high-behind used for shots at goal. The engine cuts between these shots
                by phase exactly as a broadcast director would.
              </div>
              {CAMERA_PLAN.map((x) => (
                <div key={x.id} className="mb-1 border-b border-[#1b2434] pb-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-black text-[#e8cf46]">{x.name}</span>
                    <span className="text-[8px] text-[#7f8ea6]">&nbsp;</span>
                  </div>
                  <div className="text-[8px] text-[#6f7f96]">standback {x.standback} m · height {x.height} m · {x.pxPerMetre} px/m · lead {x.lead} m · look-ahead {x.lookAhead} m · dead zone {x.deadZone} m</div>
                  <div className="text-[9px] text-[#a9b6c8]">{x.note}</div>
                </div>
              ))}
            </Panel>
          </div>
          <Panel title="THE PLAYBOOK — WHAT THE CPU CALLS EACH PHASE">
            <div className="grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-2">
              {PLAYBOOK.map((x) => (
                <div key={x.call} className="border-b border-[#1b2434] py-0.5">
                  <div className="flex justify-between">
                    <span className="font-black text-[#e8cf46]">{x.label}</span>
                    <span className="text-[#7f8ea6]">{x.zone} · phase {x.when}+ · risk {(x.risk * 100).toFixed(0)}% · reward {(x.reward * 100).toFixed(0)}%</span>
                  </div>
                  <div className="text-[#a9b6c8]">{x.instruction}</div>
                </div>
              ))}
            </div>
          </Panel>
          <div className="border-2 border-[#e8cf46] bg-[#161a10] p-2 text-[9px] text-[#8f9e6a]">
            SHAPE AND TACTICS DATA POINTS: <b className="text-[#e8cf46]">{SHAPE_POINT_COUNT.toLocaleString()}</b> —
            five attacking shapes, five defensive systems, a fourteen-call playbook, two restart
            formations and a seven-shot broadcast camera plan.
          </div>
        </div>
      )}

      {tab === 'NUM' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Panel title="WORLD CUP POOLS">
            {WORLD_CUP_POOLS.map((p, i) => (
              <div key={i} className="mb-2">
                <div className="text-[9px] font-black tracking-[0.2em] text-[#e8cf46]">POOL {String.fromCharCode(65 + i)}</div>
                {p.map((id) => {
                  const t = TEAM_BY_ID(id);
                  return (
                    <div key={id} className="grid grid-cols-[40px_1fr_1fr] text-[9px] text-[#cfd8e6]">
                      <span>{t.short}</span><span className="text-[#6f7f96]">{t.nickname}</span>
                      <span className="text-right text-[#6f7f96]">overall {Math.round((t.att.attack + t.att.defence + t.att.scrum + t.att.ruck + t.att.kicking + t.att.fitness) / 6)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </Panel>
          <Panel title="FORMATION LIBRARY">
            <div className="grid gap-0.5 text-[9px]">
              {FORMATIONS.map((f) => (
                <div key={f.id} className="border-b border-[#1b2434] py-0.5">
                  <div className="font-black text-[#e8cf46]">{f.kind} · {f.name}</div>
                  <div className="text-[#7f8ea6]">{f.blurb}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
      <div className="mt-3 space-y-1 text-[9px] leading-relaxed text-[#5f6f86]">
        <div>
          Squad lists are the 1991 vintage. Stats are generated deterministically from nation ratings and shirt-number
          weightings, so every one of the {TEAMS.reduce((n, t) => n + t.squad.length, 0)} players regenerates identically
          each session.
        </div>
        <div>
          This compendium is the design specification for the engine — <Kbd>←</Kbd><Kbd>→</Kbd> cycles categories. Where an
          entry describes a presentation variant (replay speeds, attract mode, tape save) it is specified here for
          completeness rather than wired to a key.
        </div>
      </div>
    </div>
  );
}
