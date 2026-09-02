import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SLIDERS, OPTION_ITEMS, TEAM_BY_ID, FIVE_NATIONS_IDS, LEAGUE_DEFAULT,
  TROPHIES, WORLD_CUP_POOLS,
} from './game/data';
import { CLASSIC_MATCHES } from './game/jlr';
import { MatchConfig, Slider } from './game/director';
import {
  TitleScreen, ModeScreen, TeamScreen, SquadScreen, TacticsScreen, OptionsScreen, GuideScreen, Mode,
} from './ui/menus';
import { MatchView } from './ui/MatchView';
import { AuditScreen } from './ui/AuditScreen';
import { TableScreen, Bracket, Fixture, Row, emptyRow, record, roundRobin, simulate, sortTable } from './ui/competition';
import { SaveBlob, loadSave, writeSave, clearSave } from './game/persist';

type Screen =
  | 'TITLE' | 'MODE' | 'TEAM' | 'SQUAD' | 'TACTICS' | 'OPTIONS' | 'GUIDE'
  | 'MATCH' | 'TABLE' | 'BRACKET' | 'REPLAYS' | 'AUDIT';

const defaultOptions = () => {
  const o: Record<string, number> = {};
  for (const i of OPTION_ITEMS) o[i.id] = i.def;
  return o;
};

export default function App() {
  /* T-12 — PERSISTENCE. The session is hydrated from the save on boot; a
   * corrupt or absent blob silently yields the defaults (see persist.ts).
   * Every field is merged over its default so options added after a save
   * was written still start at their default rather than undefined. */
  const saved: SaveBlob | null = loadSave();
  const [screen, setScreen] = useState<Screen>('TITLE');
  const [mode, setMode] = useState<Mode>('FRIENDLY');
  const [home, setHome] = useState(saved?.squads.home ?? 'ENG');
  const [away, setAway] = useState(saved?.squads.away ?? 'NZL');
  const [kitA, setKitA] = useState(saved?.squads.kitA ?? 0);
  const [kitB, setKitB] = useState(saved?.squads.kitB ?? 0);
  const [options, setOptions] = useState<Record<string, number>>({ ...defaultOptions(), ...(saved?.options ?? {}) });
  const [sliders, setSliders] = useState<Slider[]>(DEFAULT_SLIDERS.map((s) => ({ ...s, v: saved?.tactics.sliders[s.id] ?? s.v })));
  const [form, setForm] = useState({ backline: 'BL-SPLIT', defence: 'DF-UMBRELLA', lineout: 'LO-5', scrum: 'SC-8-3', ...(saved?.tactics.form ?? {}) });
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [table, setTable] = useState<Record<string, Row>>({});
  const [trophy, setTrophy] = useState<string | undefined>();
  const [clinic, setClinic] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [pendingFixture, setPendingFixture] = useState<Fixture | null>(null);
  const [kickerA, setKickerA] = useState(saved?.kickers.kickerA ?? 10);
  const [assists, setAssists] = useState({ pass: 0.7, tackle: 0.7, kick: 0.7, ...(saved?.tactics.assists ?? {}) });
  const [classic, setClassic] = useState<(typeof CLASSIC_MATCHES)[number] | null>(
    (saved?.classicProgress && CLASSIC_MATCHES.find((m) => m.id === saved.classicProgress)) || null);

  const cfg: MatchConfig = useMemo(() => ({
    homeId: home, awayId: away, kitA, kitB,
    difficulty: options.difficulty,
    halfLength: [2, 5, 10, 20, 40][options.halfLength] ?? 5,
    options,
    slidersA: sliders,
    slidersB: DEFAULT_SLIDERS.map((s) => ({ ...s, v: Math.round(50 + (Math.random() - 0.5) * 10) })),
    backlineA: form.backline, defenceA: form.defence, lineoutA: form.lineout, scrumA: form.scrum,
    backlineB: 'BL-SPLIT', defenceB: 'DF-UMBRELLA', lineoutB: 'LO-5', scrumB: 'SC-8-3',
    cpuA: false, cpuB: true,
    kickerA, kickerB: 10,
    assists,
    speed: 1,
    // The default presentation is a broadcast camera. CHASE and TACTICAL remain
    // available from the pause menu.
  }), [home, away, kitA, kitB, options, sliders, form, kickerA, assists]);

  /* T-12 — save on any change of the persisted state (which includes every
   * screen transition that carries a menu choice). Best effort only. */
  useEffect(() => {
    writeSave({
      v: 1,
      squads: { home, away, kitA, kitB },
      tactics: {
        sliders: Object.fromEntries(sliders.map((s) => [s.id, s.v])),
        form, assists,
      },
      kickers: { kickerA },
      options,
      classicProgress: classic?.id ?? null,
    });
  }, [home, away, kitA, kitB, sliders, form, assists, kickerA, options, classic]);

  /* T-12 — "reset to defaults": wipe the key and restore every menu to its
   * factory state without leaving the options screen. */
  const resetToDefaults = () => {
    clearSave();
    setHome('ENG'); setAway('NZL'); setKitA(0); setKitB(0);
    setOptions(defaultOptions());
    setSliders(DEFAULT_SLIDERS.map((s) => ({ ...s })));
    setForm({ backline: 'BL-SPLIT', defence: 'DF-UMBRELLA', lineout: 'LO-5', scrum: 'SC-8-3' });
    setKickerA(10);
    setAssists({ pass: 0.7, tackle: 0.7, kick: 0.7 });
    setClassic(null);
  };

  /* ---------- competition setup ---------- */
  const beginCompetition = (m: Mode) => {
    const ids = m === 'FIVE_NATIONS' ? FIVE_NATIONS_IDS : m === 'LEAGUE' ? LEAGUE_DEFAULT : [];
    if (m === 'WORLD_CUP') {
      const all = WORLD_CUP_POOLS.flat();
      const fx: Fixture[] = [];
      WORLD_CUP_POOLS.forEach((pool, pi) => {
        roundRobin(pool).forEach((f) => fx.push({ ...f, round: f.round + pi * 3 }));
      });
      setFixtures(fx.sort((a, b) => a.round - b.round));
      setTable(Object.fromEntries(all.map((id) => [id, emptyRow(id)])));
    } else if (ids.length) {
      setFixtures(roundRobin(ids));
      setTable(Object.fromEntries(ids.map((id) => [id, emptyRow(id)])));
    } else {
      setFixtures([]); setTable({});
    }
    setTrophy(undefined);
  };

  const applyResult = useCallback((a: string, b: string, sa: number, sb: number) => {
    setTable((t) => { const n = { ...t }; record(n, a, b, sa, sb); return n; });
    setFixtures((f) => f.map((x) => (x.a === a && x.b === b && !x.done ? { ...x, sa, sb, done: true } : x)));
  }, []);

  const simToNext = () => {
    const mine = fixtures.find((f) => !f.done && (f.a === home || f.b === home));
    for (const f of fixtures) {
      if (f.done) continue;
      if (mine && f === mine) break;
      const [sa, sb] = simulate(f.a, f.b);
      applyResult(f.a, f.b, sa, sb);
    }
  };

  const finishMatch = (r: { a: number; b: number }) => {
    const a = pendingFixture ? pendingFixture.a : home;
    const b = pendingFixture ? pendingFixture.b : away;
    applyResult(a, b, r.a, r.b);
    setScreen(mode === 'FRIENDLY' || clinic ? 'MODE' : 'TABLE');
    if (mode !== 'FRIENDLY') {
      const remaining = fixtures.filter((f) => !f.done && f !== pendingFixture);
      if (remaining.length === 0) awardTrophies();
    }
    setPendingFixture(null);
    setClinic(false);
  };

  const awardTrophies = () => {
    const rows = sortTable(table);
    const top = rows[0];
    if (!top) return;
    if (mode === 'FIVE_NATIONS') {
      const mine = FIVE_NATIONS_IDS;
      const wins: Record<string, number> = {};
      for (const f of fixtures) if (f.done) { if (f.sa > f.sb) wins[f.a] = (wins[f.a] ?? 0) + 1; else if (f.sb > f.sa) wins[f.b] = (wins[f.b] ?? 0) + 1; }
      const slam = mine.find((id) => (wins[id] ?? 0) === 4);
      const spoon = mine.find((id) => fixtures.filter((f) => f.done && (f.a === id || f.b === id)).every((f) => (f.a === id ? f.sa < f.sb : f.sb < f.sa)));
      const trophyNames = [
        top.id === slam ? 'GRAND SLAM — ALL FOUR WON' : '',
        spoon ? `WOODEN SPOON — ${TEAM_BY_ID(spoon).name}` : '',
        'CALCUTTA CUP DECIDED',
        `CHAMPIONS: ${TEAM_BY_ID(top.id).name} (${top.pts} PTS)`,
      ].filter(Boolean);
      setTrophy(trophyNames.join(' · '));
    } else if (mode === 'LEAGUE') {
      setTrophy(`THE SHIELD — ${TEAM_BY_ID(top.id).name} (${top.pts} PTS, ${(top.pf - top.pa) > 0 ? '+' : ''}${top.pf - top.pa})`);
    } else if (mode === 'WORLD_CUP') {
      setTrophy(`THE CUP — POOL STAGE COMPLETE · ${TEAM_BY_ID(top.id).name} LEAD THE SEEDING`);
    }
  };

  /* ---------- render ---------- */
  const shell = (children: React.ReactNode, dark = true) => (
    <div className={`h-full w-full overflow-auto ${dark ? 'bg-[#0a0e16] text-[#f4efe2]' : ''}`}>
      {children}
    </div>
  );

  if (screen === 'TITLE') return shell(<TitleScreen onStart={() => setScreen('MODE')} />, false);

  if (screen === 'MODE') return shell(
    <ModeScreen
      hasReplays={false}
      onPick={(m) => {
        if (m === 'TUTORIAL') {
          // Straight into a live, user-controlled friendly with the coaching on.
          setTutorial(true); setClinic(false); setMode('FRIENDLY');
          setHome('ENG'); setAway('FRA'); setClassic(null);
          setScreen('MATCH');
          return;
        }
        if (m === 'CLINIC') { setClinic(true); setTutorial(false); setMode('FRIENDLY'); setScreen('TEAM'); return; }
        if (m === 'REPLAYS') { setScreen('REPLAYS'); return; }
        if (m === 'CLASSIC') { setClinic(false); }
        setMode(m); beginCompetition(m); setScreen('TEAM');
      }}
      onOptions={() => setScreen('OPTIONS')}
      onGuide={() => setScreen('GUIDE')}
      onAudit={() => setScreen('AUDIT')}
    />,
  );

  if (screen === 'TEAM') return shell(
    <TeamScreen
      mode={mode}
      onBack={() => setScreen('MODE')}
      onConfirm={(h, a, ka, kb) => {
        setHome(h); setAway(a); setKitA(ka); setKitB(kb);
        const cm = CLASSIC_MATCHES.find((m) => (m.a === h && m.b === a) || (m.a === a && m.b === h));
        setClassic(cm ?? null);
        if (mode === 'FRIENDLY' || mode === 'CLASSIC' || clinic) setScreen('SQUAD'); else setScreen('TABLE');
      }}
    />,
  );

  if (screen === 'SQUAD') return shell(
    <SquadScreen
      teamId={home}
      onBack={() => setScreen('TEAM')}
      onConfirm={(_order, k) => { setKickerA(k); setScreen('TACTICS'); }}
    />,
  );

  if (screen === 'TACTICS') return shell(
    <TacticsScreen
      teamId={home} sliders={sliders} setSliders={setSliders} form={form} setForm={setForm}
      onBack={() => setScreen('SQUAD')}
      onConfirm={() => setScreen('MATCH')}
      assists={assists} setAssists={setAssists}
    />,
  );

  if (screen === 'OPTIONS') return shell(
    <OptionsScreen options={options} setOptions={setOptions} onBack={() => setScreen('MODE')} onReset={resetToDefaults} />,
  );

  if (screen === 'GUIDE') return shell(<GuideScreen onBack={() => setScreen('MODE')} />);
  if (screen === 'AUDIT') return shell(<AuditScreen onBack={() => setScreen('MODE')} />);

  if (screen === 'MATCH') return (
    <div className="h-full w-full bg-black">
      <MatchView
        cfg={cfg}
        clinic={clinic}
        tutorial={tutorial}
        objective={classic ? {
          name: classic.name,
          target: classic.target,
          margin: parseInt(classic.target.replace(/[^0-9]/g, ''), 10) || 0,
        } : null}
        onExit={() => { setClinic(false); setTutorial(false); setScreen('MODE'); }}
        onFinish={finishMatch}
      />
    </div>
  );

  if (screen === 'TABLE') return shell(
    <TableScreen
      mode={mode}
      teamId={home}
      fixtures={fixtures}
      table={table}
      trophy={trophy}
      onBack={() => setScreen('MODE')}
      onSim={simToNext}
      onPlay={(f) => {
        setPendingFixture(f);
        setHome(f.a); setAway(f.b);
        setScreen('SQUAD');
      }}
    />,
  );

  if (screen === 'BRACKET') return shell(
    <Bracket table={table} teamId={home} onBack={() => setScreen('TABLE')} onPlay={(a, b) => { setHome(a); setAway(b); setScreen('SQUAD'); }} />,
  );

  // REPLAYS
  return shell(
    <div className="mx-auto max-w-3xl p-5">
      <div className="mb-3 border-b-2 border-[#e8cf46] pb-2">
        <div className="text-[10px] font-black tracking-[0.4em] text-[#7f8ea6]">REPLAY THEATRE</div>
        <div className="text-2xl font-black tracking-[0.12em]">FIVE VARIANTS</div>
      </div>
      <div className="space-y-1">
        {[
          ['VARIANT 1 — FULL SPEED, WIDE FRAME', 'The original broadcast replay. No letterbox, no slowdown.'],
          ['VARIANT 2 — HALF SPEED', 'Every collision, slowed to half rate.'],
          ['VARIANT 3 — QUARTER SPEED, ZOOMED', 'Tight on the contact area, quarter rate.'],
          ['VARIANT 4 — REVERSE ANGLE', 'From the far goal line, so you see the blockers.'],
          ['VARIANT 5 — TACTICAL TOP-DOWN', 'The whole pitch, quarter rate, for the analysts.'],
        ].map(([t, d]) => (
          <div key={t} className="border border-[#26314a] bg-[#0e1522] p-2">
            <div className="text-[11px] font-black text-[#e8cf46]">{t}</div>
            <div className="text-[9px] text-[#7f8ea6]">{d}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[9px] text-[#6f7f96]">
        The original let you save a replay to tape. Press <span className="text-[#e8cf46]">R</span> during any match to
        capture the current phase, then replay it here.
      </div>
      <div className="mt-3"><button className="border-2 border-[#3d4b66] bg-[#1a2334] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-[#cfd8e6] hover:border-[#e8cf46]" onClick={() => setScreen('MODE')}>BACK</button></div>
    </div>,
  );
}

void TROPHIES;
