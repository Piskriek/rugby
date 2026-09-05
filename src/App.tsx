import { useState } from 'react';
import { NATIONS } from './rugby/teams';
import type { MatchOpts } from './rugby/types';
import { MatchScreen } from './MatchScreen';

type Screen = 'TITLE' | 'SETUP' | 'MATCH';

const HALVES = [2, 5, 10, 20, 40];
const SIDES: { id: MatchOpts['human']; label: string; note: string }[] = [
  { id: 'A', label: 'PLAY AS HOME', note: 'You control the home side' },
  { id: 'B', label: 'PLAY AS AWAY', note: 'You control the away side' },
  { id: 'WATCH', label: 'WATCH AI', note: 'Both teams simulated — hands off' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('TITLE');
  const [home, setHome] = useState('ENG');
  const [away, setAway] = useState('NZL');
  const [difficulty, setDifficulty] = useState(3);
  const [half, setHalf] = useState(10);
  const [side, setSide] = useState<MatchOpts['human']>('A');

  if (screen === 'TITLE') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#0a0e16] text-[#f4efe2]">
        <div className="text-center">
          <div className="text-[10px] font-black tracking-[0.55em] text-[#7f8ea6]">2026 ENGINE · BUILT FROM THE DESIGN DOC</div>
          <h1 className="mt-3 text-6xl font-black leading-none tracking-tight text-[#e8cf46] sm:text-8xl" style={{ textShadow: '4px 4px 0 #14161d' }}>
            WORLD CLASS
          </h1>
          <h1 className="text-6xl font-black leading-none tracking-tight text-[#f4efe2] sm:text-8xl" style={{ textShadow: '4px 4px 0 #14161d' }}>
            RUGBY
          </h1>
          <div className="mt-4 border-y-2 border-[#e8cf46] py-1 text-[11px] font-black tracking-[0.34em] text-[#e8cf46]">
            SIXTEEN NATIONS · ONE CUP · 30 PLAYERS
          </div>
          <div className="mt-8 flex flex-col items-center gap-2">
            <button
              onClick={() => setScreen('SETUP')}
              className="border-2 border-[#3d4b66] bg-[#1a2334] px-8 py-3 text-sm font-black tracking-[0.2em] text-[#f4efe2] hover:border-[#e8cf46] hover:text-[#e8cf46]"
            >
              KICK OFF
            </button>
            <div className="text-[9px] tracking-[0.3em] text-[#6f7f96]">
              A CLEAN-ROOM SIMULATION ENGINE — LAWS · SET PIECES · REFEREE · ADVANTAGE
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === 'SETUP') {
    return (
      <div className="h-full w-full overflow-auto bg-[#0a0e16] text-[#f4efe2]">
        <div className="mx-auto max-w-4xl p-5">
          <div className="mb-3 border-b-2 border-[#e8cf46] pb-2">
            <div className="text-[10px] font-black tracking-[0.4em] text-[#7f8ea6]">MATCH SETUP</div>
            <div className="text-2xl font-black tracking-[0.12em]">SELECT THE CONTEST</div>
          </div>

          <NationPicker label="HOME TEAM" value={home} onChange={setHome} exclude={away} />
          <div className="my-3" />
          <NationPicker label="AWAY TEAM" value={away} onChange={setAway} exclude={home} />

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <div className="mb-1 text-[10px] font-black tracking-[0.2em] text-[#7f8ea6]">SKILL LEVEL</div>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 10 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setDifficulty(i)}
                    className={`h-8 w-8 border-2 text-[11px] font-black ${difficulty === i ? 'border-[#e8cf46] bg-[#e8cf46] text-[#0a0e16]' : 'border-[#3d4b66] bg-[#101724] text-[#cfd8e6]'}`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-black tracking-[0.2em] text-[#7f8ea6]">HALF LENGTH</div>
              <div className="flex flex-wrap gap-1">
                {HALVES.map((h) => (
                  <button
                    key={h}
                    onClick={() => setHalf(h)}
                    className={`h-8 border-2 px-2 text-[11px] font-black ${half === h ? 'border-[#e8cf46] bg-[#e8cf46] text-[#0a0e16]' : 'border-[#3d4b66] bg-[#101724] text-[#cfd8e6]'}`}
                  >
                    {h}m
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] font-black tracking-[0.2em] text-[#7f8ea6]">YOU PLAY AS</div>
              <div className="flex flex-col gap-1">
                {SIDES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSide(s.id)}
                    className={`border-2 px-2 py-1 text-left text-[11px] font-black ${side === s.id ? 'border-[#e8cf46] bg-[#e8cf46] text-[#0a0e16]' : 'border-[#3d4b66] bg-[#101724] text-[#cfd8e6]'}`}
                  >
                    {s.label}
                    <span className="ml-1 font-normal opacity-70">{s.note}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button onClick={() => setScreen('TITLE')} className="border-2 border-[#3d4b66] bg-[#1a2334] px-4 py-2 text-[11px] font-black tracking-[0.14em] text-[#cfd8e6] hover:border-[#e8cf46]">
              BACK
            </button>
            <button onClick={() => setScreen('MATCH')} className="border-2 border-[#e8cf46] bg-[#e8cf46] px-6 py-2 text-[11px] font-black tracking-[0.14em] text-[#0a0e16]">
              START MATCH
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <MatchScreen
      cfg={{ home, away, difficulty, halfMinutes: half, human: side, seed: Math.floor(Math.random() * 1e9) }}
      onExit={() => setScreen('SETUP')}
    />
  );
}

function NationPicker({ label, value, onChange, exclude }: {
  label: string; value: string; onChange: (id: string) => void; exclude: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-black tracking-[0.2em] text-[#7f8ea6]">{label}</div>
      <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
        {NATIONS.map((n) => {
          const disabled = n.id === exclude;
          const active = n.id === value;
          return (
            <button
              key={n.id}
              onClick={() => !disabled && onChange(n.id)}
              className={`border-2 p-1.5 text-left ${active ? 'border-[#e8cf46]' : disabled ? 'border-transparent opacity-25' : 'border-[#3d4b66]'}`}
              style={{ background: active ? 'rgba(232,207,70,0.14)' : '#101724' }}
            >
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-4 w-4 border border-black/40" style={{ background: n.color }} />
                <div>
                  <div className="text-[11px] font-black leading-none text-[#f4efe2]">{n.short}</div>
                  <div className="text-[8px] leading-none text-[#7f8ea6]">{n.name}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
