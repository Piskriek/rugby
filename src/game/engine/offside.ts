/**
 * SPEC_12 — THE OFFSIDE LINE: observation → enforcement → prevention.
 *
 * This module is the whole of the law that is not per-phase bookkeeping. It is
 * deliberately pure: everything here takes a `Director` and returns a decision.
 * The Director owns the state (the windows), owns the write (the whistle) and
 * owns the placement guard; nothing in this file mutates a player.
 *
 * THE ONE FORMULA
 *
 *   penetration = (p.z − line.z) · σ_team        metres in front of the line
 *
 * where σ is that team's attacking axis (+1 for A, −1 for B) and `line` is the
 * hindmost foot of that team's own players in the contest (or the ball itself
 * for the open-play line). A player is onside when the value is ≤ 0. The same
 * expression covers every line, because "behind the line" already means "on
 * your own side of it", and that direction is exactly σ.
 *
 * OBSERVATION AND ENFORCEMENT ARE SEPARATE
 *
 * A breach is OBSERVED at one fixed sensitivity (the epsilon and sustain the
 * engine has always used) so the diagnostic series is comparable build to build
 * and MODE TO MODE — the gate "OFF changes no counts" is then true by
 * construction rather than by coincidence. The strictness profile decides
 * whether an observed breach earns a whistle, and never what gets counted.
 */

import type { Director } from '../director';
import type { Live } from '../intelligence';
import { FIELD } from '../../render/retro';

export type OffsideLineKind = 'RUCK' | 'RESET' | 'SCRUM' | 'MAUL' | 'LINEOUT' | 'OPEN';

export type OffsideStrictness = 'STRICT' | 'LENIENT' | 'OFF';

/** What a referee of this temper does with an observed breach. */
export interface StrictnessProfile {
  /** metres beyond the line before he will blow for it (never below the observed epsilon) */
  blowEpsilon: number;
  /** extra seconds an observed breach must survive before he blows */
  blowSustain: number;
  /** grace while the line is being drawn or has just moved */
  settle: number;
  /** Infinity = anywhere on the field; otherwise he only blows inside this radius of the ball */
  materialRadius: number;
  /** a man visibly retiring is never blown (the canonical play-on) */
  retreatingGrace: boolean;
  /** which lines he polices at all */
  lines: readonly OffsideLineKind[];
}

export const STRICTNESS: Record<OffsideStrictness, StrictnessProfile> = {
  /* STRICT — every line on the field is live, the tolerance is tight, and the
   * materiality limit is loose: a man twenty metres from the ball is still
   * offside. Measured at 1.5 m / 1.0 s it produces 11.7 offside penalties per
   * team per match. That is NOT the 2..4 band, and it is worth saying plainly
   * why: the band describes real footballers, and this engine's AI commits
   * roughly forty sustained offences a match, about ten times a real team. A
   * referee who called the law as written on this AI would blow forty times.
   * STRICT is therefore a DIAGNOSTIC mode — it is how you see how much
   * offside the football actually contains — and LENIENT is the shipped game. */
  STRICT: {
    blowEpsilon: 1.5, blowSustain: 1.0, settle: 0.75, materialRadius: 20,
    retreatingGrace: true, lines: ['RUCK', 'RESET', 'SCRUM', 'MAUL', 'LINEOUT', 'OPEN'],
  },

  /* LENIENT — the shipped default, and the numbers are measured rather than
   * chosen. The calibration history, kept because it is the only honest
   * defence of a tolerance this wide:
   *
   *   1.0 m / 0.30 s   -> 48 whistles per 600 s. Median offence 2.2 m deep,
   *                       held 0.77 s. About five times the 2..4 band.
   *   2.0 m / 1.0 s    -> 23 per 600 s. Still 2.5x the band.
   *   2.0 m / 1.5 s    -> 21 per 600 s. The sustain lever stops working here:
   *                       the offences that survive a second and a half are
   *                       loitering, not stumbling, so they survive two as
   *                       well. Raising it further only delays the whistle.
   *   3.0 m / 2.0 s    -> 4.3 to 4.9 offside penalties per team per match over
   *                       10 fixtures (the audit is unseeded, so the spread is
   *                       noise, not a difference between the two readings).
   *
   * What remains at 3 m / 2 s is a man a full three metres past the line who
   * has had two seconds to get back and has not moved. Every referee in the
   * world blows that. What the tolerance is really calibrated against is not
   * the law but the AI, which offends ten times as often as a real team; the
   * band is met by the referee, and the number is still marginally above it
   * because the football, not the referee, is the outlier. Fixing the engine's
   * retreat is the honest route to 2..4, and it is not this spec.
   *
   * LENIENT is also a claim about WHAT is policed, not only how strictly: it
   * watches the breakdown and the ball and not the set-piece lines, it forgives
   * a man already running back, and it ignores a man loitering ten metres from
   * the ball. Those are the three things a real referee ignores. */
  LENIENT: {
    blowEpsilon: 3.0, blowSustain: 2.0, settle: 1.20, materialRadius: 10,
    retreatingGrace: true, lines: ['RUCK', 'RESET', 'OPEN'],
  },

  /* OFF observes at the diagnostic sensitivity and never blows: episodes are
   * counted in every mode, only the whistle is missing. That is the point —
   * the law is being measured, not switched off — and it is what makes the
   * claim "the referee is not the cause" testable at all. */
  OFF: {
    blowEpsilon: 0.75, blowSustain: 0.40, settle: 0.75, materialRadius: Number.POSITIVE_INFINITY,
    retreatingGrace: true, lines: [],
  },
};

/** A team's attacking axis. σ = +1 for A (+z), −1 for B (−z). */
const sigmaOf = (team: 'A' | 'B'): -1 | 1 => (team === 'A' ? 1 : -1);

/**
 * The hindmost foot of one team's players in a contest: the player whose
 * position is furthest back along that team's own attacking axis. Every
 * offside line in the game is either this or the ball.
 */
function hindmostFoot(players: { team: 'A' | 'B'; z: number }[], team: 'A' | 'B'): number | null {
  const sig = sigmaOf(team);
  let best: number | null = null;
  for (const q of players) {
    if (q.team !== team) continue;
    if (best === null || q.z * sig < best * sig) best = q.z;
  }
  return best;
}

/** The lawful side of a line for one team: `z`, and the axis it is measured along. */
export interface TeamLine {
  z: number;
  dir: number;
}

export interface OffsideLine {
  kind: OffsideLineKind;
  /** SPEC_12: the men who FORM this line, `team:num`. A player cannot be
   * offside against a line he is part of: the front row is not offside at its
   * own scrum, and a man bound into the ruck is not offside at that ruck. The
   * old code knew this only for the ruck, and knew it by a different test
   * (`p.bound`) than the roster it used (`bd.players`), so the two disagreed
   * and men standing in the ruck with a stale mark were both judged for
   * offside and pushed into the drift ledger. One rule, one roster, every
   * line. */
  participants?: ReadonlySet<string>;
  /** who may offend against this line — both sides for the set pieces */
  offenders: readonly ('A' | 'B')[];
  /** the line for one team, or null when that team has nobody in the contest */
  lineFor: (team: 'A' | 'B') => TeamLine | null;
  /**
   * A lateral corridor, for the lineout. The line of touch runs ACROSS the
   * pitch, so the ten-metre line is not a half-plane in z: a non-participant
   * is offside only while he is inside the corridor between the two ten-metre
   * lines, whichever side of the mark he stands on.
   */
  corridor?: { min: number; max: number };
}

/** Metres in front of the line. Positive is offside; ≤ 0 is onside. */
export const penetrationOf = (p: Live, line: TeamLine): number => (p.z - line.z) * line.dir;

/** How far a moving line has to shift before the referee re-draws it. */
const LINE_MOVED_METRES = 1;

/* ============================ THE REGISTRY ============================
 * One row per line. Adding a line is a row here and nothing else: detection,
 * the window, the verdict and the audit all iterate the registry.
 */

export function liveOffsideLines(d: Director): OffsideLine[] {
  const out: OffsideLine[] = [];

  /* ---- SCRUM. Both packs: each team's backs behind their own hindmost foot. */
  const scrim = d.scrim;
  if (scrim && scrim.stage !== 'ASSEMBLE' && scrim.stage !== 'MARK') {
    const slots = scrim.players.map((q) => ({ team: q.team, z: q.z }));
    out.push({
      kind: 'SCRUM',
      participants: new Set(scrim.players.map((q) => `${q.team}:${q.num}`)),
      offenders: ['A', 'B'],
      lineFor: (team) => {
        const z = hindmostFoot(slots, team);
        return z === null ? null : { z, dir: sigmaOf(team) };
      },
    });
  }

  /* ---- MAUL. Same rule, from the bound players. */
  const ml = d.ml;
  if (ml) {
    const bound = d.live.filter((p) => p.bound).map((p) => ({ team: p.team, z: p.z }));
    out.push({
      kind: 'MAUL',
      participants: new Set(bound.map((q) => `${q.team}:${(q as Live).num}`)),
      offenders: ['A', 'B'],
      lineFor: (team) => {
        const z = hindmostFoot(bound, team);
        return z === null ? null : { z, dir: sigmaOf(team) };
      },
    });
  }

  /* ---- LINEOUT. Ten metres back from the line of touch, for everybody who is
   * not in the line itself, measured as a lateral corridor because the line of
   * touch runs across the pitch. */
  const lo = d.lo;
  if (lo && (lo.stage === 'CALL' || lo.stage === 'THROW' || lo.stage === 'CONTEST')) {
    const touch = lo.markZ;
    out.push({
      kind: 'LINEOUT',
      participants: new Set(lo.players.map((q) => `${q.team}:${q.num}`)),
      offenders: ['A', 'B'],
      lineFor: (team) => ({ z: touch - sigmaOf(team) * 10, dir: sigmaOf(team) }),
      /* the corridor is the ten metres either side of the mark: inside it, a
       * non-participant is in the way whoever he plays for */
      corridor: { min: touch - 10, max: touch + 10 },
    });
  }

  /* ---- RUCK. The engine's declared hindmost defending ruck slot — not the
   * intentionally deeper three-metre guard target used for positioning. */
  const bd = d.bd;
  if (bd && bd.ruckFormed) {
    const inRuck = bd.players.map((q) => ({ team: q.team, z: q.z }));
    out.push({
      kind: 'RUCK',
      participants: new Set(bd.players.map((q) => `${q.team}:${q.num}`)),
      offenders: ['A', 'B'],
      lineFor: (team) => {
        const z = hindmostFoot(inRuck, team);
        return z === null ? null : { z, dir: sigmaOf(team) };
      },
    });
    /* The attacking side's own line is the ball: a support player ahead of it
     * at a ruck is offside too. This is the half the old code could not see —
     * it only ever asked whether a DEFENDER was in front of the hindmost foot. */
    const ballZ = bd.ball.placed ? bd.ball.z : bd.contactZ;
    out.push({
      kind: 'OPEN',
      offenders: [bd.attacking],
      lineFor: (team) => (team === bd.attacking ? { z: ballZ, dir: sigmaOf(team) } : null),
    });
  }

  /* ---- RESET. The contact mark during the release beat. */
  const rb = d.releaseBeat;
  if (rb && d.t < rb.until) {
    const defending = d.defending();
    out.push({
      kind: 'RESET',
      offenders: [defending],
      lineFor: (team) => (team === defending ? { z: rb.z, dir: rb.dir } : null),
    });
  }

  /* ---- OPEN PLAY. Nobody is offside in open play except the team in
   * possession, and only ahead of the ball. */
  const op = d.op;
  if (op) {
    out.push({
      kind: 'OPEN',
      offenders: [op.attacking],
      lineFor: (team) => (team === op.attacking ? { z: op.carrierZ, dir: sigmaOf(team) } : null),
    });
  }

  return out;
}

/** Inside a lateral corridor, if the line declares one (the lineout, today). */
export function insideCorridor(p: Live, line: OffsideLine): boolean {
  if (!line.corridor) return true;
  return p.z >= line.corridor.min && p.z <= line.corridor.max;
}

/* ============================ THE VERDICT ============================ */

export type OffsideVerdict = 'OBSERVE' | 'WHISTLE' | 'SUPPRESS';

export interface Breach {
  player: Live;
  /** which line was crossed — the referee's remit is a list of these */
  kind: OffsideLineKind;
  penetration: number;
  /** how long the breach has been observed, seconds */
  sustainedFor: number;
  /** metres from the offender to the live ball */
  toBall: number;
  /** true when he is moving back towards his own side of the line */
  retiring: boolean;
}

/**
 * The single decision. `OBSERVE` counts and stays silent, `WHISTLE` is the only
 * path to a penalty, and `SUPPRESS` is Force-AI-Clean: the episode is still
 * recorded, because an AI that had to be suppressed is precisely what the
 * "zero AI episodes" gate is hunting, and hiding it would make that gate a
 * tautology.
 */
export function offsideVerdict(
  profile: StrictnessProfile,
  breach: Breach,
  offenderIsCpu: boolean,
  forceAiClean: boolean,
): OffsideVerdict {
  /* The remit test, and it is the FIRST test: a referee who does not watch the
   * lineout cannot blow at the lineout, whatever the breach. LENIENT watches
   * the breakdown and the ball; STRICT watches everything. */
  if (!profile.lines.includes(breach.kind)) return 'OBSERVE';
  if (breach.penetration < profile.blowEpsilon) return 'OBSERVE';
  if (breach.sustainedFor < profile.blowSustain) return 'OBSERVE';
  if (breach.toBall > profile.materialRadius) return 'OBSERVE';
  if (profile.retreatingGrace && breach.retiring) return 'OBSERVE';
  if (forceAiClean && offenderIsCpu) return 'SUPPRESS';
  return 'WHISTLE';
}

/* ============================ THE WINDOWS ============================
 *
 * THE LOAD-BEARING FIX. A window used to be minted once per ruck, and rucks
 * form every ~1.6 s, so each new window arrived with an empty track map and a
 * full grace period: a man who stood offside through four consecutive rucks
 * started from zero four times, and 210 observed breaches collapsed into one
 * episode. A window is now a property of the PHASE CONTINUUM — keyed by the
 * line kind and the team in possession — and the settle restarts only when the
 * line itself moves.
 */

interface Track {
  beganAt: number;
  sustainedFor: number;
}

interface Window {
  key: string;
  /** Monotonic identity. Two windows CAN share a key — the key is
   *  `kind:possession` and a ruck re-forms inside one possession — and an
   *  episode counted against one must not satisfy the other. */
  serial: number;
  kind: OffsideLineKind;
  openedAt: number;
  settleUntil: number;
  lineZ: number;
  tracks: Map<string, Track>;
  /** one whistle per team per window — never once per frame, never once per ruck */
  penalised: Set<string>;
  lastSeen: number;
}

const WINDOW_TTL_SECONDS = 6;

export class OffsideLedger {
  private readonly windows = new Map<string, Window>();
  private static serial = 0;

  /**
   * Has the referee finished re-drawing this line? The grace exists because a
   * line is drawn from moving bodies: the instant a ruck forms, half a team is
   * still arriving, and measuring anybody against the fresh line measures the
   * journey, not the formation. Nothing is SAMPLED until the line has settled,
   * and neither is anything whistled.
   */
  settled(d: Director, line: OffsideLine): boolean {
    const w = this.windows.get(`${line.kind}:${d.possession}`);
    return !!w && d.t >= w.settleUntil;
  }

  /** The serial of the window this line and possession currently own, or 0. */
  serialOf(d: Director, line: OffsideLine): number {
    return this.windows.get(`${line.kind}:${d.possession}`)?.serial ?? 0;
  }

  /**
   * @returns the breach this frame, or null. The caller decides what a breach
   * means; this only decides how long one has been going on.
   */
  observe(
    d: Director,
    line: OffsideLine,
    candidate: Live,
    penetration: number,
    dt: number,
  ): Breach | null {
    const team = candidate.team;
    const lineForTeam = line.lineFor(team);
    if (!lineForTeam) return null;
    if (!insideCorridor(candidate, line)) return null;

    const key = `${line.kind}:${d.possession}`;
    let w = this.windows.get(key);
    const now = d.t;
    if (!w) {
      w = {
        key, serial: ++OffsideLedger.serial, kind: line.kind, openedAt: now,
        settleUntil: now + STRICTNESS.STRICT.settle,
        lineZ: lineForTeam.z, tracks: new Map(), penalised: new Set(), lastSeen: now,
      };
      this.windows.set(key, w);
    }
    w.lastSeen = now;
    /* the line moved: the referee re-draws it and the grace restarts */
    if (Math.abs(lineForTeam.z - w.lineZ) > LINE_MOVED_METRES) {
      w.lineZ = lineForTeam.z;
      w.settleUntil = now + STRICTNESS.STRICT.settle;
    }

    const id = `${team}:${candidate.num}`;
    if (penetration <= 0) {
      const prior = w.tracks.get(id);
      if (prior) {
        w.tracks.delete(id);
        d.noteOffsideRecovery(team, Math.max(0, now - prior.beganAt));
      }
      return null;
    }
    const track = w.tracks.get(id) ?? { beganAt: now, sustainedFor: 0 };
    track.sustainedFor += dt;
    w.tracks.set(id, track);

    /* a breach that has not yet outlived the grace is not an episode */
    if (now < w.settleUntil) return null;

    const f = d.focusPoint();
    return {
      player: candidate,
      kind: line.kind,
      penetration,
      sustainedFor: track.sustainedFor,
      toBall: Math.hypot(candidate.x - f.x, candidate.z - f.z),
      /* Retiring means moving back towards his own side of the line, i.e.
       * REDUCING his penetration. Penetration is `(z − line.z) · dir`, so
       * penetration shrinks when `vz · dir` is negative. (The sign here was
       * inverted once, which forgave the man charging into the offside
       * position and blew against the man sprinting back out of it.) */
      /* A man getting up off the floor is forgiven on the same principle.
       * The velocity test cannot see him: the get-up lock holds vz at exactly
       * 0 so he is physically incapable of retiring, and he was being blown
       * for an offside position he had no means to leave. The referee's
       * play-on for a retiring player is about INTENT and CAPABILITY, and a
       * man on his hands and knees has neither the position nor the ability
       * to influence play. */
      retiring: (candidate.vz * lineForTeam.dir) < -0.5
        || (candidate.recoverT ?? 0) > 0,
    };
  }

  /** True when this team has already been whistled in this window. */
  alreadyWhistled(d: Director, line: OffsideLine, team: 'A' | 'B'): boolean {
    return this.windows.get(`${line.kind}:${d.possession}`)?.penalised.has(team) ?? false;
  }

  markWhistled(d: Director, line: OffsideLine, team: 'A' | 'B') {
    this.windows.get(`${line.kind}:${d.possession}`)?.penalised.add(team);
  }

  /** Drop windows nothing has touched for a while, so the map cannot grow forever. */
  expire(now: number) {
    for (const [key, w] of this.windows) if (now - w.lastSeen > WINDOW_TTL_SECONDS) this.windows.delete(key);
  }
}

/* ============================ PREVENTION ============================
 *
 * Force AI Clean. The projection is the whole of it: one predicate, run after
 * every formation write and before the mark is steered to, so every branch —
 * dataset, shape, planner, hip, sweep, converger, cover chase — is covered
 * without any of them knowing the law exists.
 */

/** How far clear of the line a prevented AI is asked to stand. */
export const CLEAN_MARGIN_METRES = 0.5;

/**
 * Project a z onto the legal side of a line.
 *
 * The legal side is `penetration <= 0`, and penetration is `(z − line.z) · σ`,
 * so the legal side is reached by SUBTRACTING `dir`: `line.z − dir · margin`.
 * (Adding it walks the man further offside, which is the mistake this comment
 * exists to prevent.)
 */
export function clampOntoLegalSide(z: number, line: TeamLine, margin: number): number {
  const penetration = (z - line.z) * line.dir;
  if (penetration <= 0) return z;
  return line.z - line.dir * margin;
}

/** The lawful z for a player against every line live this frame. */
export function legalZFor(lines: OffsideLine[], p: Live, z: number, margin: number): number {
  if (p.carrier || p.bound || p.sinbin > 0) return z;
  let out = z;
  for (const line of lines) {
    if (!line.offenders.includes(p.team)) continue;
    const lt = line.lineFor(p.team);
    if (!lt) continue;
    out = clampOntoLegalSide(out, lt, margin);
  }
  return out;
}

/** The z a CPU player may be MARKED at, given every line live this frame. */
export function legalMarkZ(lines: OffsideLine[], p: Live, margin: number): number {
  return legalZFor(lines, p, p.tz, margin);
}

/** Field bounds, for the post-shove projection (a shove may not invent a mark). */
export const clampPitchZ = (z: number) => Math.max(FIELD.deadZ, Math.min(FIELD.deadZFar, z));
