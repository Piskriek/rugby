/**
 * tarcsMetrics — the numbers behind the TARCS debug HUD.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE COMPONENT
 * ----------------------------------------------
 * A debug HUD is only worth having if you can trust what it says. A panel
 * that quietly reads the wrong field, or divides by a zero-length crew, or
 * shows a stale ruck from two phases ago is worse than no panel at all — it
 * sends you hunting a bug that is not there. (That has already cost this
 * project several rounds.)
 *
 * So all the arithmetic lives here, as pure functions over plain data, with
 * no React and no DOM. scripts/tarcsverify.ts drives them headlessly. The
 * .tsx component is then a dumb renderer of an already-verified struct.
 *
 * WHAT THE THREE PANELS MEAN
 *   PHYSICS   frame cost, and how much of the 16.7 ms budget it eats.
 *   RUCK      the live breakdown contest, read from BreakdownState.
 *   BODIES    locomotion and ragdoll/kinematic mode per player.
 */

/* ------------------------------------------------------------------ types */

/** Everything the HUD shows, already reduced to display-ready numbers. */
export interface TarcsSnapshot {
  physics: PhysicsMetrics;
  ruck: RuckMetrics | null;
  bodies: BodyMetrics;
}

export interface PhysicsMetrics {
  /** Rolling mean of the sim step, ms. */
  tickMs: number;
  /** Worst step in the window, ms — the number that actually drops frames. */
  peakMs: number;
  /** Frames per second implied by the whole frame time. */
  fps: number;
  /** Fraction of a 60 Hz budget consumed by the sim step, 0..1+. */
  budget: number;
}

export interface RuckMetrics {
  stage: string;
  /** −1 (defence own it) .. +1 (attack have cleared out). BreakdownState.axis. */
  tension: number;
  /** Signed rate of change of the axis, per second. */
  tensionVel: number;
  /** Contesting jackals actually on the ball right now. */
  jackals: number;
  /** Attacking bodies committed to the pile. */
  supportAtk: number;
  /** Defending bodies committed. */
  supportDef: number;
  /** Attack share of committed bodies, 0..1. 0.5 is parity. */
  density: number;
  /** Seconds the defence has held it below the red line. */
  redT: number;
  /** Seconds since the shove began. */
  contestT: number;
  /** Which way this is currently trending, for the readout. */
  verdict: 'ATTACK BALL' | 'CONTESTED' | 'DEFENCE OVER IT' | 'TURNOVER';
}

export interface BodyMetrics {
  /** Players in the live set. */
  count: number;
  /** Mean speed of everyone on the park, m/s. */
  meanSpeed: number;
  /** Fastest man, m/s. */
  peakSpeed: number;
  /** Bodies currently under the ragdoll solver rather than an animation clip. */
  ragdollCount: number;
  /** Bodies driven by clips/kinematics. */
  kinematicCount: number;
  /** The tracked man, usually the ball carrier. */
  focus: FocusBody | null;
}

export interface FocusBody {
  label: string;
  speed: number;
  mode: 'ACTIVE' | 'KINEMATIC';
  stamina: number;
}

/* ------------------------------------------------------- rolling sampler */

/**
 * A fixed-size ring of frame timings.
 *
 * Deliberately a ring rather than a growing array: this is sampled every
 * frame for the length of a match, and an unbounded array in a debug tool is
 * how a debug tool becomes the performance problem it was added to find.
 *
 * The mean is computed over the window rather than kept as a running total,
 * because a running total accumulates float error over tens of thousands of
 * frames and slowly drifts away from the truth.
 */
export class RollingTimer {
  private buf: Float32Array;
  private i = 0;
  private filled = 0;

  constructor(size = 90) {
    this.buf = new Float32Array(Math.max(1, size));
  }

  push(ms: number): void {
    /* Guard the sampler itself: a NaN here would poison the mean forever and
     * the HUD would read "NaN ms" with no way back. */
    if (!Number.isFinite(ms) || ms < 0) return;
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    if (this.filled < this.buf.length) this.filled++;
  }

  get mean(): number {
    if (this.filled === 0) return 0;
    let s = 0;
    for (let k = 0; k < this.filled; k++) s += this.buf[k];
    return s / this.filled;
  }

  get peak(): number {
    let m = 0;
    for (let k = 0; k < this.filled; k++) if (this.buf[k] > m) m = this.buf[k];
    return m;
  }

  get samples(): number { return this.filled; }

  reset(): void { this.i = 0; this.filled = 0; this.buf.fill(0); }
}

/* --------------------------------------------------------------- physics */

/** 60 Hz frame budget in milliseconds. */
export const FRAME_BUDGET_MS = 1000 / 60;

export function physicsMetrics(sim: RollingTimer, frame: RollingTimer): PhysicsMetrics {
  const tickMs = sim.mean;
  const frameMs = frame.mean;
  return {
    tickMs,
    peakMs: sim.peak,
    /* Guard the divide: on the very first frame the window is empty, and
     * 1000/0 would render as "Infinity fps". */
    fps: frameMs > 0.0001 ? 1000 / frameMs : 0,
    budget: tickMs / FRAME_BUDGET_MS,
  };
}

/* ------------------------------------------------------------------ ruck */

/** The shape of BreakdownState this module actually reads. */
export interface RuckSource {
  stage: string;
  axis: number;
  axisVel: number;
  redT: number;
  contestT: number;
  jackalActive: boolean;
  crew: number[];
  defCrew: number[];
  attacking: 'A' | 'B';
  players?: { team: 'A' | 'B'; role: string; down?: boolean }[];
}

/**
 * The axis at which the contest resolves, from engine/breakdown.ts.
 * Mirrored rather than imported so the HUD cannot drag the engine into a
 * React bundle — but see scripts/tarcsverify.ts, which asserts the two agree.
 */
export const RESOLVE_AXIS = 0.75;
/** Below this the defence is meaningfully over the ball (BreakdownState.redT). */
export const RED_AXIS = -0.5;

export function ruckMetrics(s: RuckSource | null | undefined): RuckMetrics | null {
  if (!s) return null;

  /* Count jackals from the committed men, not from the boolean alone: the
   * flag says "a jackal is live", the roster says how many are actually
   * there. Showing only the flag hides a double-jackal, which is exactly the
   * situation you open a debug HUD to see. */
  let jackals = 0;
  let sawJackalRow = false;
  if (s.players) {
    for (const p of s.players) {
      if (p.role !== 'JACKAL') continue;
      sawJackalRow = true;
      if (!p.down) jackals++;
    }
  }
  /* Fall back to the flag ONLY when the roster carries no jackal rows at all.
   * Keying the fallback on `jackals === 0` instead was a real bug caught by
   * tarcsverify: a jackal the roster explicitly reports as DOWN would be
   * resurrected by the still-set flag, and the panel would claim a contest
   * that the engine had already ended. Absence of data and data saying zero
   * are different answers. */
  if (!sawJackalRow && s.jackalActive) jackals = 1;

  const supportAtk = s.crew.length;
  const supportDef = s.defCrew.length;
  const total = supportAtk + supportDef;
  /* Parity, not zero, when nobody has committed: 0.5 reads as "even", which
   * is the truth. A raw 0/0 would render as "0% attack", implying the defence
   * owns an empty ruck. */
  const density = total > 0 ? supportAtk / total : 0.5;

  let verdict: RuckMetrics['verdict'];
  if (s.axis <= -RESOLVE_AXIS) verdict = 'TURNOVER';
  else if (s.axis < RED_AXIS) verdict = 'DEFENCE OVER IT';
  else if (s.axis > 0.35) verdict = 'ATTACK BALL';
  else verdict = 'CONTESTED';

  return {
    stage: s.stage,
    tension: s.axis,
    tensionVel: s.axisVel,
    jackals,
    supportAtk,
    supportDef,
    density,
    redT: s.redT,
    contestT: s.contestT,
    verdict,
  };
}

/* ---------------------------------------------------------------- bodies */

export interface BodySource {
  team: 'A' | 'B';
  num: number;
  vx: number;
  vz: number;
  stamina: number;
  /** True while the ragdoll solver owns this body instead of a clip. */
  ragdoll?: boolean;
}

export function bodyMetrics(
  live: readonly BodySource[],
  focusNum: number | null,
  focusTeam: 'A' | 'B' | null,
): BodyMetrics {
  let sum = 0, peak = 0, rag = 0;
  let focus: FocusBody | null = null;

  for (const p of live) {
    const sp = Math.hypot(p.vx, p.vz);
    sum += sp;
    if (sp > peak) peak = sp;
    if (p.ragdoll) rag++;
    if (focusNum !== null && p.num === focusNum && (focusTeam === null || p.team === focusTeam)) {
      focus = {
        label: `${p.team}${p.num}`,
        speed: sp,
        /* "ACTIVE" is the physics-driven ragdoll; "KINEMATIC" is animation
         * driving the transform. That is the distinction TARCS cares about. */
        mode: p.ragdoll ? 'ACTIVE' : 'KINEMATIC',
        stamina: p.stamina,
      };
    }
  }

  return {
    count: live.length,
    meanSpeed: live.length > 0 ? sum / live.length : 0,
    peakSpeed: peak,
    ragdollCount: rag,
    kinematicCount: live.length - rag,
    focus,
  };
}

/* ------------------------------------------------------------ formatting */

/** Fixed-width number for a monospace readout that must not jitter. */
export function fmt(v: number, dp = 2, width = 0): string {
  const s = (Number.isFinite(v) ? v : 0).toFixed(dp);
  return width > 0 ? s.padStart(width) : s;
}

/**
 * A little ASCII meter. Retro panel, and it reads at a glance in a way a bare
 * number does not — the whole point of a live HUD.
 */
export function bar(value01: number, width = 12): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(value01) ? value01 : 0));
  const n = Math.round(v * width);
  return '█'.repeat(n) + '·'.repeat(width - n);
}

/**
 * A signed meter for the −1..+1 turnover axis, with the centre marked.
 * Defence pressure grows left, attack grows right, so the visual matches the
 * sign convention in BreakdownState and cannot be misread.
 */
export function signedBar(value: number, width = 15): string {
  const half = Math.floor(width / 2);
  const v = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  const n = Math.round(Math.abs(v) * half);
  const cells: string[] = new Array(width).fill('·');
  cells[half] = '│';
  if (v < 0) for (let k = 0; k < n; k++) cells[half - 1 - k] = '█';
  else for (let k = 0; k < n; k++) cells[half + 1 + k] = '█';
  return cells.join('');
}
