import { useMemo, useState } from 'react';
import { TEAM_BY_ID, WORLD_CUP_POOLS, FIVE_NATIONS_IDS, LEAGUE_DEFAULT, TROPHIES } from '../game/data';
import { Btn, Panel, TitleBar } from './kit';

/* ============================ MODEL ============================ */

export interface Row { id: string; p: number; w: number; d: number; l: number; pf: number; pa: number; pts: number }
export interface Fixture { round: number; a: string; b: string; sa: number; sb: number; done: boolean }

export const emptyRow = (id: string): Row => ({ id, p: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0, pts: 0 });

function overall(id: string) {
  const a = TEAM_BY_ID(id).att;
  return (a.attack + a.defence + a.scrum + a.ruck + a.kicking + a.fitness + a.lineout + a.maul) / 8;
}

/** CPU-versus-CPU result: Poisson-ish around a rating delta. */
export function simulate(a: string, b: string): [number, number] {
  const d = overall(a) - overall(b);
  const base = 19 + Math.random() * 12;
  const sa = Math.max(0, Math.round(base + d * 0.55 + (Math.random() - 0.5) * 14));
  const sb = Math.max(0, Math.round(base - d * 0.55 + (Math.random() - 0.5) * 14));
  return [sa, sb];
}

export function record(table: Record<string, Row>, a: string, b: string, sa: number, sb: number) {
  const A = table[a] ?? emptyRow(a), B = table[b] ?? emptyRow(b);
  A.p++; B.p++; A.pf += sa; A.pa += sb; B.pf += sb; B.pa += sa;
  if (sa > sb) { A.w++; B.l++; A.pts += 2; }
  else if (sb > sa) { B.w++; A.l++; B.pts += 2; }
  else { A.d++; B.d++; A.pts++; B.pts++; }
  table[a] = A; table[b] = B;
}

export function sortTable(table: Record<string, Row>): Row[] {
  return Object.values(table).sort((x, y) =>
    y.pts - x.pts || (y.pf - y.pa) - (x.pf - x.pa) || y.pf - x.pf || x.id.localeCompare(y.id));
}

/** Circle method round robin; odd counts get a bye. */
export function roundRobin(ids: string[]): Fixture[] {
  const list = [...ids];
  const bye = '__BYE__';
  if (list.length % 2) list.push(bye);
  const n = list.length;
  const rounds = n - 1;
  const out: Fixture[] = [];
  let arr = [...list];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a === bye || b === bye) continue;
      out.push(r % 2 === 0 ? { round: r + 1, a, b, sa: 0, sb: 0, done: false } : { round: r + 1, a: b, b: a, sa: 0, sb: 0, done: false });
    }
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return out.sort((x, y) => x.round - y.round);
}

export function poolsOf(mode: string): string[][] {
  if (mode === 'WORLD_CUP') return WORLD_CUP_POOLS;
  if (mode === 'FIVE_NATIONS') return [FIVE_NATIONS_IDS];
  return [LEAGUE_DEFAULT];
}

/* ============================ VIEW ============================ */

export function TableScreen({ mode, teamId, fixtures, table, onPlay, onSim, onBack, trophy }: {
  mode: string; teamId: string;
  fixtures: Fixture[]; table: Record<string, Row>;
  onPlay: (f: Fixture) => void; onSim: () => void; onBack: () => void;
  trophy?: string;
}) {
  const next = fixtures.find((f) => !f.done);
  const played = fixtures.filter((f) => f.done).length;
  const pools = poolsOf(mode);
  const stage =
    mode === 'WORLD_CUP'
      ? played < 24 ? 'POOL STAGE' : played < 28 ? 'QUARTER-FINALS' : played < 30 ? 'SEMI-FINALS' : 'THE FINAL'
      : mode === 'FIVE_NATIONS' ? `ROUND ${Math.min(5, Math.floor(played / 2.5) + 1)} OF 5` : `ROUND ${(played / 4 | 0) + 1} OF 7`;

  return (
    <div className="mx-auto max-w-5xl p-5">
      <TitleBar
        kicker={`${mode.replace('_', ' ')} · ${TEAM_BY_ID(teamId).name}`}
        title={stage}
        right={<Btn onClick={onBack}>LEAVE COMPETITION</Btn>}
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {pools.map((p, i) => {
            const rows = sortTable(Object.fromEntries(p.map((id) => [id, table[id] ?? emptyRow(id)])));
            return (
              <Panel key={i} title={mode === 'WORLD_CUP' ? `POOL ${String.fromCharCode(65 + i)}` : mode === 'FIVE_NATIONS' ? 'CHAMPIONSHIP TABLE' : 'THE SHIELD'}>
                <div className="text-[10px]">
                  <div className="grid grid-cols-[18px_1fr_26px_26px_26px_26px_40px_30px] gap-1 border-b border-[#3d4b66] pb-1 text-[8px] tracking-[0.14em] text-[#7f8ea6]">
                    <span>#</span><span>NATION</span><span className="text-right">P</span><span className="text-right">W</span>
                    <span className="text-right">D</span><span className="text-right">L</span><span className="text-right">DIFF</span><span className="text-right">PTS</span>
                  </div>
                  {rows.map((r, idx) => (
                    <div key={r.id} className={`grid grid-cols-[18px_1fr_26px_26px_26px_26px_40px_30px] gap-1 py-0.5 ${r.id === teamId ? 'bg-[#221d0f] text-[#e8cf46]' : 'text-[#cfd8e6]'}`}>
                      <span className="text-[#6f7f96]">{idx + 1}</span>
                      <span className="truncate font-black">{TEAM_BY_ID(r.id).name}</span>
                      <span className="text-right tabular-nums">{r.p}</span>
                      <span className="text-right tabular-nums">{r.w}</span>
                      <span className="text-right tabular-nums">{r.d}</span>
                      <span className="text-right tabular-nums">{r.l}</span>
                      <span className="text-right tabular-nums">{r.pf - r.pa > 0 ? '+' : ''}{r.pf - r.pa}</span>
                      <span className="text-right font-black tabular-nums">{r.pts}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })}
          <Panel title="FIXTURE LIST">
            <div className="max-h-64 overflow-auto text-[10px]">
              {fixtures.map((f, i) => (
                <div key={i} className={`grid grid-cols-[30px_1fr_60px] items-center gap-2 border-b border-[#1b2434] py-0.5 ${f.a === teamId || f.b === teamId ? 'text-[#f4efe2]' : 'text-[#6f7f96]'}`}>
                  <span className="tabular-nums">{f.round}</span>
                  <span className="truncate">
                    {TEAM_BY_ID(f.a).short} v {TEAM_BY_ID(f.b).short}
                    {(f.a === teamId || f.b === teamId) && <span className="ml-1 text-[#e8cf46]">◆</span>}
                  </span>
                  <span className="text-right tabular-nums">{f.done ? `${f.sa}–${f.sb}` : '—'}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title={next ? 'NEXT FIXTURE' : 'COMPETITION COMPLETE'}>
            {next ? (
              <>
                <div className="text-center">
                  <div className="text-[13px] font-black text-[#f4efe2]">{TEAM_BY_ID(next.a).name}</div>
                  <div className="text-[10px] tracking-[0.3em] text-[#7f8ea6]">VERSUS</div>
                  <div className="text-[13px] font-black text-[#f4efe2]">{TEAM_BY_ID(next.b).name}</div>
                  <div className="mt-1 text-[9px] text-[#6f7f96]">ROUND {next.round} · {TEAM_BY_ID(next.b).venue}</div>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  {(next.a === teamId || next.b === teamId) ? (
                    <Btn wide onClick={() => onPlay(next)}>PLAY THIS FIXTURE</Btn>
                  ) : (
                    <div className="border border-[#26314a] p-2 text-center text-[9px] text-[#7f8ea6]">
                      YOU ARE NOT IN THIS FIXTURE
                    </div>
                  )}
                  <Btn wide onClick={onSim}>SIMULATE TO MY NEXT FIXTURE</Btn>
                </div>
              </>
            ) : (
              <div className="text-center">
                <div className="text-[13px] font-black text-[#e8cf46]">
                  {sortTable(table)[0] ? TEAM_BY_ID(sortTable(table)[0].id).name : '—'} TOP THE TABLE
                </div>
                {trophy && <div className="mt-2 text-[11px] text-[#f4efe2]">{trophy}</div>}
              </div>
            )}
          </Panel>
          <Panel title="SILVERWARE ON THE LINE">
            {TROPHIES.filter((t) => mode.includes(t.comp)).map((t) => (
              <div key={t.id} className="mb-1 border border-[#26314a] p-1">
                <div className="text-[10px] font-black text-[#e8cf46]">{t.name}</div>
                <div className="text-[9px] text-[#7f8ea6]">{t.text}</div>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ============================ KNOCKOUT BRACKET ============================ */

export function Bracket({ table, onPlay, onBack, teamId }: {
  table: Record<string, Row>; onPlay: (a: string, b: string) => void; onBack: () => void; teamId: string;
}) {
  const [stage, setStage] = useState<'QF' | 'SF' | 'F'>('QF');
  const qf = useMemo(() => {
    const poolWinners = WORLD_CUP_POOLS.map((p) => sortTable(Object.fromEntries(p.map((id) => [id, table[id] ?? emptyRow(id)])))[0].id);
    const runners = WORLD_CUP_POOLS.map((p) => sortTable(Object.fromEntries(p.map((id) => [id, table[id] ?? emptyRow(id)])))[1].id);
    return [
      [poolWinners[0], runners[1]], [poolWinners[2], runners[3]],
      [poolWinners[1], runners[0]], [poolWinners[3], runners[2]],
    ] as [string, string][];
  }, [table]);
  return (
    <div className="mx-auto max-w-4xl p-5">
      <TitleBar kicker="WORLD CUP" title="KNOCKOUT STAGES" right={<Btn onClick={onBack}>BACK</Btn>} />
      <div className="mb-3 flex gap-1">
        {(['QF', 'SF', 'F'] as const).map((s) => <Btn key={s} small active={stage === s} onClick={() => setStage(s)}>{s === 'QF' ? 'QUARTER-FINALS' : s === 'SF' ? 'SEMI-FINALS' : 'THE FINAL'}</Btn>)}
      </div>
      <Panel title={stage === 'QF' ? 'FOUR TIES' : stage === 'SF' ? 'TWO TIES' : 'ONE TIE'}>
        <div className="space-y-2">
          {qf.map(([a, b], i) => (
            <div key={i} className="flex items-center justify-between border border-[#26314a] bg-[#0e1522] p-2">
              <span className="text-[12px] font-black text-[#f4efe2]">{TEAM_BY_ID(a).name} v {TEAM_BY_ID(b).name}</span>
              {(a === teamId || b === teamId) && stage === 'QF' && <Btn small onClick={() => onPlay(a, b)}>PLAY</Btn>}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
