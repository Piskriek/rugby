/**
 * TARCSHud — real-time physics / ruck / body telemetry over the 3D view.
 *
 * Reads a `TarcsSnapshot` (see ui/tarcsMetrics.ts, where all the arithmetic
 * lives and is unit-tested) and draws it. This file deliberately contains no
 * maths beyond formatting: a debug panel that computes its own numbers is a
 * second implementation that can disagree with the first.
 *
 * TWO CONSTRAINTS THAT SHAPE THE MARKUP
 *
 * 1. IT MUST NOT EAT INPUT. The match runs under pointer lock; a panel that
 *    swallows a click breaks the camera. Every element here is
 *    `pointer-events-none`, including the root — there is nothing to click,
 *    so there is nothing to steal. It sits at z-50, above ThreeCanvas (z-0)
 *    and the HUD canvas (z-2) but below the pause and menu layers, which are
 *    interactive and must stay clickable.
 *
 * 2. IT MUST NOT JITTER. Live telemetry that reflows as digits change is
 *    unreadable. Every numeric cell is monospace, fixed width, and padded, so
 *    a value moving 9.9 -> 10.0 does not shift the column.
 */

import {
  bar, fmt, signedBar,
  type BodyMetrics, type PhysicsMetrics, type RuckMetrics, type TarcsSnapshot,
} from './tarcsMetrics';

/* Palette. Amber-on-near-black, the way a pit-wall telemetry screen reads. */
const OK = 'text-emerald-300';
const WARN = 'text-amber-300';
const BAD = 'text-rose-400';
const DIM = 'text-slate-500';
const LABEL = 'text-slate-400';

function Row({ label, value, tone = 'text-slate-200' }: {
  label: string; value: string; tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 leading-[1.35]">
      <span className={`${LABEL} shrink-0`}>{label}</span>
      <span className={`${tone} tabular-nums whitespace-pre`}>{value}</span>
    </div>
  );
}

function Panel({ title, accent, children }: {
  title: string; accent: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-slate-100/12 bg-slate-950/85 px-2.5 py-1.5 backdrop-blur-[2px]">
      <div className={`mb-1 border-b border-slate-100/10 pb-0.5 text-[10px] font-black tracking-[0.14em] ${accent}`}>
        {title}
      </div>
      {children}
    </div>
  );
}

function PhysicsPanel({ m }: { m: PhysicsMetrics }) {
  /* Colour by the number that matters — the share of a 60 Hz frame the sim
   * step eats. Under half the budget is comfortable; over the whole budget
   * means the sim alone cannot hold 60. */
  const tone = m.budget > 1 ? BAD : m.budget > 0.5 ? WARN : OK;
  return (
    <Panel title="PHYSICS" accent="text-sky-300">
      <Row label="tick" value={`${fmt(m.tickMs, 2, 6)} ms`} tone={tone} />
      <Row label="peak" value={`${fmt(m.peakMs, 2, 6)} ms`} tone={m.peakMs > 16.7 ? BAD : DIM} />
      <Row label="fps" value={fmt(m.fps, 1, 6)} tone={m.fps < 50 ? WARN : DIM} />
      <Row label="budget" value={`${bar(m.budget)} ${fmt(m.budget * 100, 0, 3)}%`} tone={tone} />
    </Panel>
  );
}

function RuckPanel({ m }: { m: RuckMetrics | null }) {
  if (!m) {
    return (
      <Panel title="RUCK LEDGER" accent="text-fuchsia-300">
        <div className={`${DIM} py-1 text-center italic`}>no breakdown</div>
      </Panel>
    );
  }
  const vtone = m.verdict === 'TURNOVER' ? BAD
    : m.verdict === 'DEFENCE OVER IT' ? WARN
      : m.verdict === 'ATTACK BALL' ? OK : 'text-slate-200';

  return (
    <Panel title="RUCK LEDGER" accent="text-fuchsia-300">
      <Row label="stage" value={m.stage.padStart(8)} />
      <Row label="tension" value={`${signedBar(m.tension)} ${fmt(m.tension, 2, 5)}`} tone={vtone} />
      <Row label="d/dt" value={fmt(m.tensionVel, 2, 6)} tone={DIM} />
      <Row label="jackals" value={fmt(m.jackals, 0, 6)} tone={m.jackals > 0 ? WARN : DIM} />
      <Row label="support" value={`${fmt(m.supportAtk, 0, 2)}a v ${fmt(m.supportDef, 0, 2)}d`} />
      <Row label="density" value={`${bar(m.density)} ${fmt(m.density * 100, 0, 3)}%`} />
      <Row label="red / t" value={`${fmt(m.redT, 1, 4)}s /${fmt(m.contestT, 1, 5)}s`} tone={m.redT > 0 ? WARN : DIM} />
      <div className={`mt-0.5 text-center text-[10px] font-black tracking-wider ${vtone}`}>{m.verdict}</div>
    </Panel>
  );
}

function BodyPanel({ m }: { m: BodyMetrics }) {
  return (
    <Panel title="BODIES" accent="text-emerald-300">
      <Row label="live" value={fmt(m.count, 0, 6)} />
      <Row label="v mean" value={`${fmt(m.meanSpeed, 2, 5)} m/s`} tone={DIM} />
      <Row label="v peak" value={`${fmt(m.peakSpeed, 2, 5)} m/s`} tone={m.peakSpeed > 9 ? WARN : DIM} />
      <Row
        label="active"
        value={`${fmt(m.ragdollCount, 0, 2)} rag /${fmt(m.kinematicCount, 0, 3)} kin`}
        tone={m.ragdollCount > 0 ? WARN : DIM}
      />
      {m.focus ? (
        <>
          <div className="mt-1 border-t border-slate-100/10 pt-0.5" />
          <Row label="focus" value={m.focus.label.padStart(6)} tone="text-sky-300" />
          <Row label="  speed" value={`${fmt(m.focus.speed, 2, 5)} m/s`} />
          <Row
            label="  mode"
            value={m.focus.mode.padStart(9)}
            tone={m.focus.mode === 'ACTIVE' ? WARN : OK}
          />
          <Row label="  stam" value={`${bar(m.focus.stamina / 100, 8)} ${fmt(m.focus.stamina, 0, 3)}`} tone={DIM} />
        </>
      ) : (
        <div className={`${DIM} mt-0.5 text-center italic`}>no focus body</div>
      )}
    </Panel>
  );
}

export interface TARCSHudProps {
  snapshot: TarcsSnapshot;
  /** Shown in the header so it is obvious which build is being measured. */
  tag?: string;
}

/**
 * The overlay. Absolutely positioned at z-50, fully click-through.
 *
 * Rendering is driven by the parent's own cadence — MatchView samples the
 * snapshot on an interval rather than every frame, because re-rendering React
 * at 60 Hz to display a frame-time counter would itself distort the frame
 * time being displayed.
 */
export default function TARCSHud({ snapshot, tag = 'TARCS' }: TARCSHudProps) {
  return (
    <div
      className="pointer-events-none absolute right-2 top-2 z-50 w-[228px] select-none
                 font-mono text-[11px] leading-tight"
      aria-hidden="true"
    >
      <div className="mb-1 flex items-center justify-between rounded border border-amber-300/40
                      bg-slate-950/90 px-2 py-1">
        <span className="text-[10px] font-black tracking-[0.18em] text-amber-300">{tag} DEBUG</span>
        <span className="text-[9px] text-slate-500">F3</span>
      </div>
      <div className="flex flex-col gap-1">
        <PhysicsPanel m={snapshot.physics} />
        <RuckPanel m={snapshot.ruck} />
        <BodyPanel m={snapshot.bodies} />
      </div>
    </div>
  );
}
