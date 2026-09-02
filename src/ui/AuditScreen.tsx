import { useMemo, useState } from 'react';
import { runTrace, runDeep, TracePoint, DeepReport } from '../game/trace';
import { auditStats, StatsReport } from '../game/statsAudit';
import { runGates, GatesReport } from '../game/gates';
import { audit, narrative, Standard } from '../game/audit';
import { DEFAULT_SLIDERS, OPTION_ITEMS } from '../game/data';
import { MatchConfig } from '../game/director';
import { Btn, Panel, TitleBar } from './kit';

const cfgOf = (diff: number): MatchConfig => {
  const options: Record<string, number> = {};
  for (const i of OPTION_ITEMS) options[i.id] = i.def;
  options.difficulty = diff;
  return {
    homeId: 'ENG', awayId: 'NZL', kitA: 0, kitB: 0,
    difficulty: diff, halfLength: 40, options,
    slidersA: DEFAULT_SLIDERS.map((s) => ({ ...s })),
    slidersB: DEFAULT_SLIDERS.map((s) => ({ ...s })),
    backlineA: 'BL-SPLIT', defenceA: 'DF-UMBRELLA', lineoutA: 'LO-5', scrumA: 'SC-8-3',
    backlineB: 'BL-SPLIT', defenceB: 'DF-UMBRELLA', lineoutB: 'LO-5', scrumB: 'SC-8-3',
    cpuA: false, cpuB: true, kickerA: 10, kickerB: 10,
    assists: { pass: 0.7, tackle: 0.7, kick: 0.7 }, speed: 1,
  };
};

export function AuditScreen({ onBack }: { onBack: () => void }) {
  const [run, setRun] = useState<ReturnType<typeof runTrace> | null>(null);
  const [deep, setDeep] = useState<DeepReport | null>(null);
  const [stats, setStats] = useState<StatsReport | null>(null);
  const [gates, setGates] = useState<GatesReport | null>(null);
  const [diff, setDiff] = useState(3);
  const [filter, setFilter] = useState<'ALL' | 'FAIL' | 'WARN' | Standard>('ALL');
  const [kind, setKind] = useState('ALL');

  const report = useMemo(() => (run ? audit(run.points) : null), [run]);

  const doRun = () => {
    // Two runs: a sampled behavioural trace, and a frame-by-frame fault hunt.
    setRun(runTrace(cfgOf(diff), 70, 4));
    setDeep(runDeep(cfgOf(diff), 60));
  };

  const kinds = useMemo(() => (run ? run.kinds.map(([k]) => k) : []), [run]);
  const shown = useMemo(() => {
    if (!report) return [];
    return report.results.filter((r) =>
      (filter === 'ALL' || r.verdict === filter || r.standard === filter) &&
      (kind === 'ALL' || r.kind === kind));
  }, [report, filter, kind]);

  const opening = run ? narrative(run.points, 14) : [];

  return (
    <div className="mx-auto max-w-6xl p-5">
      <TitleBar
        kicker="AUTOMATED BEHAVIOURAL AUDIT"
        title="THE TRACE AND ITS VERDICTS"
        right={<Btn onClick={onBack}>BACK</Btn>}
      />

      <Panel title="WHAT THIS IS">
        <div className="text-[10px] leading-relaxed text-[#a9b6c8]">
          A bot plays a real match through the same input path a human uses. Every observable thing is
          captured as an ordered data point — where the thirty stand at kick-off, where the camera sits,
          what the player is told, what a button press and release actually change, how far and which way
          the ball goes, what the thirty do while it is in the air, what the camera does then, what is on
          screen, what the player can do, and whether anything tells him where it is going to drop.
          Each point is then checked against the laws of rugby, against physical logic, and against
          whether a person could see it and act on it.
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[9px] tracking-[0.2em] text-[#7f8ea6]">SKILL LEVEL</span>
          {[0, 3, 6, 9].map((d) => <Btn key={d} small active={diff === d} onClick={() => setDiff(d)}>{d}</Btn>)}
          <Btn onClick={doRun}>{run ? 'RUN AGAIN' : 'CAPTURE 1000 DATA POINTS'}</Btn>
          <Btn onClick={() => setStats(auditStats(cfgOf(diff), 3))}>
            {stats ? 'RE-RUN STATS TEST' : 'SIMULATE 3 FULL MATCHES'}
          </Btn>
          <Btn onClick={() => setGates(runGates(60))}>
            {gates ? 'RE-RUN GATES' : 'RUN REGRESSION GATES'}
          </Btn>
        </div>
      </Panel>

      {gates && (
        <div className="mt-3">
          <Panel title={`REGRESSION GATES — ${gates.overall ? 'ALL PASS' : `${gates.pass}/${gates.total} PASS`}`}>
            <div className="mb-2 flex items-baseline gap-3">
              <span className="text-3xl font-black tabular-nums" style={{ color: gates.overall ? '#6ee7a0' : '#ff6a5a' }}>
                {gates.pass}/{gates.total}
              </span>
              <span className="text-[10px] text-[#7f8ea6]">
                {gates.overall
                  ? 'Every gate holds across difficulty 0, 3 and 6. A change that breaks one of these is a regression.'
                  : 'Something on the field is broken. Each red gate below names the system and the number.'}
              </span>
            </div>
            <div className="grid gap-x-4 gap-y-0.5 text-[10px] sm:grid-cols-3">
              {gates.results.map((r) => (
                <div key={r.key} className="flex items-center gap-2 border-b border-[#141b28] py-1">
                  <span className={`text-[11px] font-black ${r.pass ? 'text-[#6ee7a0]' : 'text-[#ff6a5a]'}`}>
                    {r.pass ? '✓' : '✗'}
                  </span>
                  <span className="text-[#cfd8e6]">{r.label}</span>
                  <span className="ml-auto tabular-nums text-[#6f7f96]">{r.value}</span>
                </div>
              ))}
            </div>
            {!gates.overall && (
              <div className="mt-2 border border-[#3d4b66] p-2">
                {gates.results.filter((r) => !r.pass).map((r) => (
                  <div key={r.key} className="text-[10px] leading-snug text-[#ffb0a0]">
                    · <b>{r.label}</b> reads {r.value} — {r.why}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 text-[9px] text-[#6f7f96]">
              {gates.perDifficulty.map((p) => (
                <span key={p.diff} className="mr-3">diff {p.diff}: {p.pass}/{p.total}</span>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {stats && (
        <div className="mt-3">
          <Panel title="STATISTICAL REALISM — DOES THE BOX SCORE LOOK LIKE RUGBY?">
            <div className="mb-2 flex items-baseline gap-3">
              <span className="text-3xl font-black tabular-nums" style={{ color: stats.score >= 80 ? '#6ee7a0' : stats.score >= 55 ? '#e8cf46' : '#ff6a5a' }}>
                {stats.score}%
              </span>
              <span className="text-[10px] text-[#7f8ea6]">
                {stats.realistic} of {stats.total} statistics inside the range a real match produces ·
                average scoreline {stats.scoreline}
              </span>
            </div>
            <div className="space-y-0.5">
              {stats.results.map((r) => (
                <div key={r.key} className="grid grid-cols-[150px_58px_1fr_66px] items-center gap-2 border-b border-[#141b28] py-0.5 text-[9px]">
                  <span className="text-[#cfd8e6]">{r.label}</span>
                  <span className="text-right font-black tabular-nums" style={{ color: r.grade === 'REALISTIC' ? '#6ee7a0' : '#ff6a5a' }}>
                    {r.value}
                  </span>
                  <span className="relative h-2 bg-[#0a0e16]">
                    <span className="absolute inset-y-0 bg-[#26314a]"
                      style={{ left: '18%', width: '64%' }} />
                    <span className="absolute inset-y-0 w-[2px]"
                      style={{
                        left: `${Math.max(0, Math.min(100, 18 + ((r.value - r.lo) / Math.max(1, r.hi - r.lo)) * 64))}%`,
                        background: r.grade === 'REALISTIC' ? '#6ee7a0' : '#ff6a5a',
                      }} />
                  </span>
                  <span className="text-right text-[#6f7f96]">{r.lo}–{r.hi}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 border border-[#26314a] p-2">
              <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">WHAT THE NUMBERS SAY</div>
              {stats.verdict.map((v, i) => (
                <div key={i} className={`text-[10px] leading-snug ${/below|above/.test(v) ? 'text-[#ff6a5a]' : 'text-[#6ee7a0]'}`}>· {v}</div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {run && report && (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Stat label="DATA POINTS CAPTURED" value={run.points.length} sub={`${run.secondsSimulated} s simulated`} />
            <Stat label="CHECKS RUN" value={report.checksRun} sub={`${report.pass} pass`} colour="#6ee7a0" />
            <Stat label="WARNINGS" value={report.warn} sub="worth reviewing" colour="#e8cf46" />
            <Stat label="DEFECTS" value={report.fail} sub="breaches of law, logic or UX" colour="#ff6a5a" />
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {report.byStandard.map(([s, p, w, f]) => (
              <Panel key={s} title={`${s} — ${s === 'LAW' ? 'LAWS OF RUGBY' : s === 'LOGIC' ? 'PHYSICAL LOGIC' : 'USER FRIENDLINESS'}`}>
                <div className="flex items-end gap-3">
                  <div className="text-2xl font-black tabular-nums" style={{ color: f === 0 ? '#6ee7a0' : '#ff6a5a' }}>{f}</div>
                  <div className="text-[9px] text-[#7f8ea6]">defects<br />{p} pass / {w} warn</div>
                </div>
              </Panel>
            ))}
          </div>

          <Panel title="THE OPENING, IN ORDER — THE FIRST TIME EACH THING WAS OBSERVED">
            <div className="space-y-1">
              {opening.map((p: TracePoint) => (
                <div key={p.i} className="border border-[#26314a] bg-[#0e1522] p-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-black text-[#e8cf46]">POINT {p.i} · {p.label}</span>
                    <span className="text-[8px] text-[#6f7f96]">t={p.t}s · {p.phase}</span>
                  </div>
                  <div className="mt-0.5 grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-3">
                    {Object.entries(p.d).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2 border-b border-[#141b28]">
                        <span className="text-[#7f8ea6]">{k}</span>
                        <span className="truncate text-right text-[#cfd8e6]">{v === null ? '—' : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="mt-3">
            <Panel title="VERDICTS">
              <div className="flex flex-wrap gap-1">
                {(['ALL', 'FAIL', 'WARN', 'LAW', 'LOGIC', 'UX'] as const).map((f) => (
                  <Btn key={f} small active={filter === f} onClick={() => setFilter(f)}>{f}</Btn>
                ))}
                <span className="mx-2 border-l border-[#3d4b66]" />
                <Btn small active={kind === 'ALL'} onClick={() => setKind('ALL')}>ALL KINDS</Btn>
                {kinds.map((k) => <Btn key={k} small active={kind === k} onClick={() => setKind(k)}>{k}</Btn>)}
              </div>
              <div className="mt-2 max-h-[420px] space-y-0.5 overflow-auto">
                {shown.length === 0 && <div className="text-[10px] text-[#6f7f96]">No results for this filter.</div>}
                {shown.map((r, i) => (
                  <div key={i} className="grid grid-cols-[54px_1fr] gap-2 border-b border-[#141b28] py-0.5 text-[9px]">
                    <span className={`font-black ${r.verdict === 'PASS' ? 'text-[#6ee7a0]' : r.verdict === 'WARN' ? 'text-[#e8cf46]' : 'text-[#ff6a5a]'}`}>
                      {r.verdict}
                    </span>
                    <span>
                      <span className="text-[#7f8ea6]">#{r.point} t={r.t}s </span>
                      <span className="text-[#cfd8e6]">{r.claim}</span>
                      {r.law && <span className="text-[#8f9e6a]"> ({r.law})</span>}
                      {r.why && <span className="text-[#ff8a72]"> — {r.why}</span>}
                      <span className="text-[#5f6f86]"> [{r.rule} {r.standard} {r.kind}]</span>
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {deep && (
            <Panel title="FAULT HUNT — EVERY FRAME, SIXTY SECONDS">
                <div className="mb-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
                <Metric label="IMPOSSIBLE MOVES" value={deep.teleportCount} bad={deep.teleportCount > 0} />
                <Metric label="NEVER BOUNCED" value={deep.neverBounced} bad={deep.neverBounced > 0} />
                <Metric label="TACKLES COMPLETED" value={deep.tacklesMade} bad={deep.tacklesMade === 0} />
                <Metric label="CHASE ARRIVALS" value={deep.chaseArrivals} bad={deep.chaseArrivals === 0} />
                <Metric label="CAMERA WHIP" value={deep.whipFrames} bad={deep.whipFrames > 0} />
                <Metric label="ENCROACHMENT" value={deep.encroachFrames} bad={deep.encroachFrames > 0} />
                <Metric label="FREEZES CAUGHT" value={deep.watchdogTrips} bad={deep.watchdogTrips > 0} />
              </div>
              <div className="grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-2">
                <Row k="MAX MOVE IN ONE FRAME" v={`${deep.maxFrameDisplacement} m (a sprint covers 0.16 m)`} />
                <Row k="BOUNCES OBSERVED" v={String(deep.bouncesObserved)} />
                <Row k="CONTESTED CATCHES" v={String(deep.contestedCatches)} />
                <Row k="PHASE CHANGES" v={String(deep.phaseChanges)} />
                <Row k="POSSESSION CHANGES" v={String(deep.possessionChanges)} />
                <Row k="FRAMES NOBODY MOVING" v={`${deep.framesWhereNobodyMoved} / ${deep.totalFrames}`} />
                <Row k="LONGEST DEAD AIR" v={`${(deep.longestDeadAir / 60).toFixed(2)} s`} />
                <Row k="PHASES REACHED" v={deep.phasesVisited.join(' ')} />
                <Row k="MAX CAMERA SWING IN ONE FRAME" v={`${deep.maxCamSwingDeg}° (over 3.4° will judder)`} />
                <Row k="FRAMES THE CAMERA WHIPPED" v={String(deep.whipFrames)} />
                <Row k="FRAMES THE BALL WAS OFF SCREEN" v={String(deep.offTargetFrames)} />
                <Row k="CLOSEST OPPONENT AT A RESTART" v={`${deep.nearestOpponentAtKick} m (law requires 10 m)`} />
                <Row k="FRAMES OF ENCROACHMENT" v={String(deep.encroachFrames)} />
              </div>
              <div className="mt-2 border border-[#26314a] p-2">
                <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">VERDICT</div>
                {deep.summary.map((s, i) => (
                  <div key={i} className={`text-[10px] ${/NO TACKLE|Nobody|not bounce|impossible|No bounce/i.test(s) ? 'text-[#ff6a5a]' : 'text-[#6ee7a0]'}`}>· {s}</div>
                ))}
              </div>
              {deep.watchdogLog.length > 0 && (
                <div className="mt-2 border-2 border-[#ff6a5a] bg-[#2a1414] p-2">
                  <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#ff6a5a]">
                    {deep.watchdogTrips} PHASES FROZE AND WERE FORCE-RESET
                  </div>
                  {deep.watchdogLog.map((w, i) => (
                    <div key={i} className="text-[9px] text-[#ffb0a0]">· {w}</div>
                  ))}
                </div>
              )}
              {deep.diags.length > 0 && (
                <div className="mt-2 max-h-64 overflow-auto">
                  <div className="mb-1 text-[9px] font-black tracking-[0.2em] text-[#7f8ea6]">{deep.diags.length} FAULTS, IN ORDER</div>
                  {deep.diags.map((x, i) => (
                    <div key={i} className="border-b border-[#141b28] py-0.5 text-[9px]">
                      <span className={x.severity === 'CRITICAL' ? 'font-black text-[#ff6a5a]' : 'text-[#e8cf46]'}>{x.severity} {x.kind}</span>
                      <span className="text-[#6f7f96]"> t={x.t}s </span>
                      <span className="text-[#cfd8e6]">{x.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          <Panel title="PHASES VISITED AND OBSERVATION MIX">
            <div className="grid gap-x-3 gap-y-0.5 text-[9px] sm:grid-cols-2">
              {run.kinds.map(([k, n]) => (
                <div key={k} className="flex justify-between border-b border-[#141b28]">
                  <span className="text-[#7f8ea6]">{k}</span>
                  <span className="text-[#e8cf46]">{n} points</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[9px] text-[#6f7f96]">
              Phases reached: {run.phasesVisited.join(' → ')} · button presses {run.inputsPressed} ·
              releases {run.inputsReleased}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <div className={`border-2 p-2 ${bad ? 'border-[#ff6a5a] bg-[#2a1414]' : 'border-[#3d4b66] bg-[#0d1220]'}`}>
      <div className="text-[8px] tracking-[0.14em] text-[#7f8ea6]">{label}</div>
      <div className={`text-xl font-black tabular-nums ${bad ? 'text-[#ff6a5a]' : 'text-[#6ee7a0]'}`}>{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-[#141b28]">
      <span className="text-[#7f8ea6]">{k}</span>
      <span className="text-right text-[#cfd8e6]">{v}</span>
    </div>
  );
}

function Stat({ label, value, sub, colour = '#f4efe2' }: { label: string; value: number; sub?: string; colour?: string }) {
  return (
    <div className="border-2 border-[#3d4b66] bg-[#0d1220] p-2">
      <div className="text-[9px] tracking-[0.18em] text-[#7f8ea6]">{label}</div>
      <div className="text-2xl font-black tabular-nums" style={{ color: colour }}>{value.toLocaleString()}</div>
      {sub && <div className="text-[9px] text-[#6f7f96]">{sub}</div>}
    </div>
  );
}
