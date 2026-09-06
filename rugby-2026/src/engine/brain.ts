/**
 * BRAIN — the decision layer for all thirty men (and the human when he jumps
 * in to take the ball carrier). Pure logic over the Match engine; runs at
 * roughly 5 Hz during open play.
 *
 * The corpus drives every choice: nation archetype + ten tactic sliders set
 * the tendencies, shirt numbers set the roles, and the difficulty table sets
 * reaction/error so a MYTHIC side reads the play before you make it.
 */
import type { Match } from './match';
import type { DynPlayer, TeamId } from './types';
import { PITCH_L, PITCH_W, TACKLE_REACH, topSpeed, CATCH_RADIUS } from './tuning';
import { clamp, dist, angleTo } from './utils';

interface Ctx {
  m: Match;
}

/** The carrier's team in the current phase. */
const attackSide = (m: Match): TeamId | null => {
  const c = m.carrier();
  return c ? c.team : m.phase.ballTeam;
};

export function think(m: Match, dt: number) {
  const c = m.carrier();
  const att = attackSide(m);

  // -------- human takeover of the ball carrier --------
  if (m.humanTeam && m.liveControl && att === m.humanTeam && c) {
    m.controlledIdx = c.idx;
    steerHumanCarrier(m, c);
  } else if (m.humanTeam && !(att === m.humanTeam)) {
    // defending: track the nearest human defender as the controlled man
    m.controlledIdx = pickControlledDefender(m);
    const ctrl = m.controlledIdx >= 0 ? m.players[m.controlledIdx] : null;
    if (ctrl && m.humanInput.dive && c && dist(ctrl.x, ctrl.y, c.x, c.y) < 9) {
      m.tackleFrom(ctrl.idx, true);
    }
  }

  // -------- loose ball: everyone races --------
  if (m.ball.state === 'loose' || m.ball.state === 'flight') {
    if (m.ball.state === 'loose') {
      raceForLoose(m);
      return;
    }
    // flight handled by the chase layer in the engine
  }

  if (!att) { holdShape(m); return; }
  const def = att === 'A' ? 'B' : 'A';

  // -------- attack lines for the non-carriers --------
  layoutAttackers(m, att);

  // -------- defence --------
  layoutDefence(m, def);

  // -------- the carrier's decision (AI or human) --------
  if (c && !(m.humanTeam && m.liveControl && att === m.humanTeam)) {
    decideCarrier(m, c);
  }

  void dt;
}

/* ============================================================ MOVEMENT === */
function desireToward(m: Match, p: DynPlayer, tx: number, ty: number, speed: number, sprint = false) {
  const d = dist(p.x, p.y, tx, ty);
  if (d < 0.6) { m.desireOff(p.idx); return; }
  m.desire(p.idx, (tx - p.x) / d, (ty - p.y) / d, speed, sprint && d > 1.5);
}

function faceGoal(m: Match, p: DynPlayer): number {
  return m.dirOf(p.team);
}

/* ======================================================= HUMAN CARRIER === */
function steerHumanCarrier(m: Match, c: DynPlayer) {
  const dir = m.dirOf(c.team);
  const inp = m.humanInput;
  let vx = 0, vy = 0;
  if (inp.up > 0) vx += dir;
  if (inp.down > 0) vx -= dir;
  if (inp.left > 0) vy += dir === 1 ? -1 : 1;
  if (inp.right > 0) vy += dir === 1 ? 1 : -1;
  const spd = topSpeed(c.spd, c.stamina) * (inp.sprint ? 1.15 : 0.9);
  if (vx !== 0 || vy !== 0) {
    const mag = Math.hypot(vx, vy);
    m.desire(c.idx, vx / mag, vy / mag, spd, inp.sprint);
  } else {
    // coast forward
    m.desire(c.idx, dir, 0, 3.2, false);
  }

  // actions with small cooldowns
  const now = m.t;
  if (inp.passL || inp.passR) {
    const target = humanPassTarget(m, c, inp.passL ? -1 : 1);
    if (target != null && now - m.lastPassAt[c.team] > 0.45) {
      m.lastPassAt[c.team] = now;
      m.pass(c.idx, target);
    }
  }
  if (inp.kick && now - m.lastKickAt[c.team] > 1.6) {
    m.lastKickAt[c.team] = now;
    humanKick(m, c, 'PUNT');
  }
  if (inp.grubber && now - m.lastKickAt[c.team] > 1.6) {
    m.lastKickAt[c.team] = now;
    humanKick(m, c, 'GRUBBER');
  }
}

function humanPassTarget(m: Match, c: DynPlayer, side: 1 | -1): number | null {
  const dir = m.dirOf(c.team);
  let best: DynPlayer | null = null;
  let bestScore = -Infinity;
  for (const p of m.teamLive(c.team).players) {
    if (p === c || p.downUntil > m.t || p.sinbinUntil > m.t) continue;
    if (p.state === 'down') continue;
    // must be behind-ish or level, lateral to the requested side
    const along = (p.x - c.x) * dir;
    const across = dir === 1 ? p.y - c.y : c.y - p.y;
    if (along < -30) continue;
    if (along > 1.2) continue;
    if (Math.sign(across) !== side) continue;
    if (Math.abs(across) < 1.6) continue;
    const d = dist(p.x, p.y, c.x, c.y);
    if (d > 24) continue;
    const danger = laneDanger(m, c, p);
    const score = Math.abs(across) * 0.9 + along * 0.4 - danger * 2 - d * 0.05;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best ? best.idx : null;
}

function laneDanger(m: Match, c: DynPlayer, t: DynPlayer): number {
  // defenders near the lane
  const mx = (c.x + t.x) / 2, my = (c.y + t.y) / 2;
  let dg = 0;
  for (const p of m.teamLive(c.team === 'A' ? 'B' : 'A').players) {
    if (p.downUntil > m.t) continue;
    const dd = dist(p.x, p.y, mx, my);
    if (dd < 2.6) dg += (2.6 - dd) * 1.4;
  }
  return dg;
}

/* ========================================================== LOOSE BALL === */
function raceForLoose(m: Match) {
  const b = m.ball;
  for (const team of ['A', 'B'] as TeamId[]) {
    const near = nearestOf(m, team, b.x, b.y, 2);
    for (const p of near) {
      const d = dist(p.x, p.y, b.x, b.y) || 1;
      const sp = d < 3 ? topSpeed(p.spd, p.stamina) * 1.2 : 7.4;
      m.desire(p.idx, (b.x - p.x) / d, (b.y - p.y) / d, sp, d < 6);
    }
    // everyone else forms a support arc
    for (const p of m.teamLive(team).players) {
      if (near.includes(p)) continue;
      m.desireOff(p.idx);
    }
  }
}

function holdShape(m: Match) {
  for (const p of m.players) {
    if (p.downUntil > m.t || p.sinbinUntil > m.t) continue;
    m.desireOff(p.idx);
    p.state = 'idle';
  }
}

/* ============================================================ ATTACK ===== */
interface Anchor { x: number; y: number; dir: 1 | -1 }

function anchor(m: Match, team: TeamId): Anchor {
  const c = m.carrier();
  if (c && c.team === team) return { x: c.x, y: c.y, dir: m.dirOf(team) };
  // off the ruck/maul
  if (m.ruck) return { x: m.ruck.x, y: m.ruck.y, dir: m.dirOf(team) };
  if (m.maul) return { x: m.maul.x, y: m.maul.y, dir: m.dirOf(team) };
  if (m.phase.x > 0) return { x: m.phase.x, y: m.phase.y, dir: m.dirOf(team) };
  return { x: PITCH_L / 2, y: PITCH_W / 2, dir: m.dirOf(team) };
}

function layoutAttackers(m: Match, team: TeamId) {
  const A = anchor(m, team);
  const live = m.teamLive(team);
  const width = live.intent.width;          // 0 tight → 1 spread
  const tempo = live.intent.tempo;
  const c = m.carrier();
  const dir = A.dir;

  // which of the forwards run the "pod"?
  const pods: number[] = [];
  const forwardCount = live.players.filter((p) => p.num <= 8 && p !== c).length;
  if (forwardCount > 0 && !(c && c.num <= 8)) {
    const podCandidates = live.players.filter((p) => p.num <= 8 && p !== c && p.downUntil <= m.t);
    // nearest two forwards to the ball are the clear-out pod
    const near = [...podCandidates].sort((a, b) => dist(a.x, a.y, A.x, A.y) - dist(b.x, b.y, A.x, A.y));
    for (let i = 0; i < Math.min(2, near.length); i++) pods.push(near[i].idx);
  }

  // A shape is measured BEHIND the ball: everything except the carrier sits
  // deeper than the breakdown (away from the try line) so passes travel
  // backward and the law stays legal by construction.
  const back = (dM: number) => A.x - dir * dM;

  for (const p of live.players) {
    if (p === c) continue;
    if (p.downUntil > m.t || p.sinbinUntil > m.t) continue;
    if (pods.includes(p.idx)) {
      // clear-out support: hug the ruck
      const d = dist(p.x, p.y, A.x, A.y);
      if (d > 3.2) desireToward(m, p, A.x, A.y, 6.6, true);
      else m.desireOff(p.idx);
      continue;
    }
    // the nine stands at the base of the breakdown, behind the ball
    if (p.num === 9) {
      desireToward(m, p, back(1.2), A.y, 4.4, false);
      continue;
    }
    // forwards: trailing pods two or three metres behind, either side
    if (p.num <= 8) {
      const side = (p.num % 2 === 0 ? 1 : -1);
      const ty = clamp(A.y + side * (2.2 + width * 3.4), 4, PITCH_W - 4);
      const tx = back(1.6 + (p.num % 3) * 1.5);
      desireToward(m, p, tx, ty, p.num <= 5 ? 5.2 : 6.2, false);
      continue;
    }
    // backs: the written shape — 10 first receiver, 12/13 mid, 11/14 edges,
    // 15 sweep. Depth is BEHIND the ball: fly half ~4-8m, centres 8-13m,
    // wings flatter & wide, fullback deepest at 15m+.
    const depth = p.num === 10 ? 4 + tempo * 4 : p.num === 12 ? 8 + tempo * 4
      : p.num === 13 ? 9.5 + tempo * 4 : p.num === 15 ? 16 : 8 + tempo * 4;
    const roleSpread = (n: number) => (n === 10 ? 0 : n === 12 ? 1 : n === 13 ? 2.1 : n === 11 ? -1.2 : n === 14 ? 3.2 : 0.5) as number;
    const spacing = 4.6 + width * 5.5;
    const edgeBoost = p.num === 11 || p.num === 14 ? 8 * width : 0;
    const tx = back(depth);
    // lateral offset from the ball line
    let ty = A.y + (roleSpread(p.num) - 1.2) * spacing + edgeBoost * (p.num === 14 ? 1 : p.num === 11 ? -1 : 0);
    ty = clamp(ty, 5, PITCH_W - 5);
    // drift toward the open side by intent
    const open = A.y > PITCH_W / 2 ? 1 : -1;
    ty = clamp(ty + open * width * 3, 4, PITCH_W - 4);
    desireToward(m, p, tx, ty, p.num === 11 || p.num === 14 ? 8.2 : 7.2, p.num >= 11 && m.rng.chance(0.3));
  }
}

/* =========================================================== DEFENCE ===== */
function layoutDefence(m: Match, team: TeamId) {
  const c = m.carrier();
  if (!c) return;
  const live = m.teamLive(team);
  const dir = m.dirOf(team);
  const lineSpeed = live.intent.lineSpeed;
  const aggression = live.intent.aggression;
  const presser = nearestOf(m, team, c.x, c.y, 1)[0] ?? null;

  // The defensive line sits a metre or two off the ball — close enough to
  // pressure the release, far enough that the ruck base is not a maul. A
  // blitzing side steps up to meet the carrier, a sitting side gives ground.
  const frontX = clamp(c.x - dir * (2.7 - lineSpeed * 1.7), 0, PITCH_L);

  // spread the line across the danger width around the carrier
  const danger = 20 + live.intent.width * 8;
  const y0 = clamp(c.y - danger, 1, PITCH_W - 1);
  const y1 = clamp(c.y + danger, 1, PITCH_W - 1);

  // pick the defender count to spread (leave the fullback deep, wings wide-ish)
  const lineMen: DynPlayer[] = [];
  const deep: DynPlayer[] = [];
  for (const p of live.players) {
    if (p === presser) continue;
    if (p.downUntil > m.t || p.sinbinUntil > m.t) continue;
    if (p.num === 15) deep.push(p);
    else lineMen.push(p);
  }
  // remove any defenders who are out of the defensive frame far upfield (retreat handled by engine)
  const usable = lineMen.filter((p) => (dir === 1 ? p.x <= frontX + 8 : p.x >= frontX - 8));
  const order = usable.sort((a, b) => {
    const da = dist(a.x, a.y, c.x, c.y), db = dist(b.x, b.y, c.x, c.y);
    return db - da; // fill from the outsides first
  });
  const n = Math.max(2, usable.length);
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    const ty = y0 + ((i + 1) / (order.length + 1)) * (y1 - y0);
    // keep a min spacing by construction (divide the width by count)
    let stationX = frontX;
    const sprint = lineSpeed > 0.72 && m.rng.chance(0.35) && i < 3;
    desireToward(m, p, stationX, ty, sprint ? 7.4 : 5.6 - lineSpeed * 2, sprint);
  }
  // deep cover
  for (const p of deep) {
    const ty = clamp(c.y, 5, PITCH_W - 5);
    desireToward(m, p, c.x - dir * 13, ty, 6.4, false);
  }
  // presser: close the space; the engine's contact check makes the tackle
  // (the brain only drives the run), so the timing stays honest.
  if (presser) {
    const d = dist(presser.x, presser.y, c.x, c.y);
    if (d < 7 && m.rng.chance(0.35 + aggression * 0.4)) {
      const sp = topSpeed(presser.spd, presser.stamina) * 1.1;
      m.desire(presser.idx, (c.x - presser.x) / d, (c.y - presser.y) / d, sp, true);
    } else if (d < 2.4) {
      // stand the carrier up while the line arrives
      desireToward(m, presser, c.x - dir * 1.0, c.y, 3.4, false);
    } else {
      desireToward(m, presser, c.x - dir * 1.6, c.y, 5.6, false);
    }
  }
}

/* ===================================================== CARRIER DECIDE ==== */
interface Opt {
  kind: 'PASS' | 'KICK' | 'RUN' | 'CONTACT' | 'OFFLOAD';
  score: number;
  target?: number;
}

function decideCarrier(m: Match, c: DynPlayer) {
  const live = m.teamLive(c.team);
  const dir = m.dirOf(c.team);
  const goalD = m.toGoal(c.team, c.x);
  const def = c.team === 'A' ? 'B' : 'A';
  const press = nearestOf(m, def, c.x, c.y, 1)[0];

  // movement: choose the best open lane
  const steer = chooseRunLane(m, c, press);
  m.desire(c.idx, steer.vx, steer.vy, steer.speed, steer.sprint);

  // actions
  const opts: Opt[] = [];
  const now = m.t;

  // pressure state
  const pressD = press ? dist(press.x, press.y, c.x, c.y) : 99;
  const pressured = pressD < 3.2;
  const closeToLine = goalD < 14;          // sniffing distance — go for it
  const redZone = goalD < 25;

  // RUN the ball: the honest default — good rugby goes forward first.
  // A carrier with room runs; the line beckons inside the 22. After the
  // first spread or two the pass is done — the ball goes to the line
  // (spreadPasses resets at every tackle, so this reads real phase tempo).
  let runScore = 0.45 + Math.max(0, steer.space - 1.2) * 0.15;
  if (m.spreadPasses >= 1) runScore += 0.25;
  if (m.spreadPasses >= 2) runScore += 0.6;
  if (m.spreadPasses >= 4) runScore += 1.0;
  if (closeToLine) runScore += 0.6;
  if (redZone) runScore += 0.2;
  if (pressured) runScore -= 0.25;
  runScore = Math.max(0.15, runScore);
  opts.push({ kind: 'RUN', score: runScore });

  // PASS options: shifted so a pass must beat the run — flat, into a gap, and
  // never a pointless deep recycle unless the carrier is drowning.
  const breakdownX = m.phase.x > 0 ? m.phase.x : c.x;   // phase origin (ruck base)
  for (const p of m.teamLive(c.team).players) {
    if (p === c || p.downUntil > m.t || p.sinbinUntil > m.t) continue;
    const along = (p.x - c.x) * dir;
    // law: the release must travel backward — receiver window sits behind
    if (along < -30 || along > 1.0) continue;
    const d = dist(p.x, p.y, c.x, c.y);
    if (d > 26 || d < 1.6) continue;
    // recycling deep behind the breakdown is legal but slow — it is scored
    // down below, not forbidden (an outright ban made attacks run the ball
    // into space every phase and tries exploded)
    const danger = laneDanger(m, c, p);
    const open = clamp(1 - danger / 4, 0, 1);
    // in the red zone a backward pass must be into obvious space or it is
    // pointless — the line is the better option
    const zonePenalty = redZone ? 0.5 : 0;
    // recycling deep behind the breakdown costs attacking momentum; only a
    // man under genuine pressure buys the ball back with a long pass
    const backOfBreakdown = (breakdownX - p.x) * dir;
    const recyclePen = backOfBreakdown > 9
      ? 0.55 + (backOfBreakdown - 9) * 0.07
      : backOfBreakdown > 3 ? (backOfBreakdown - 3) * 0.09 : 0;
    const flatBonus = along > -0.5 ? 0.75 : 1;
    // the "hot potato": only when the tackler is genuinely on top of the
    // carrier — an unpressured man does not shovel the ball sideways
    const hot = pressD < 2.0 ? 0.42 : pressured ? 0.12 : 0;
    const score = Math.max(0, 0.04 + open * 0.5 * flatBonus + hot - zonePenalty - recyclePen - d * 0.012);
    opts.push({ kind: 'PASS', score, target: p.idx });
  }

  // kicking option — real cadence: clear from the own 22 under the pump,
  // tactical kicks are an archetype-driven choice in the middle of the park
  const kickFreq = live.intent.kicking;
  const sinceKick = now - m.lastKickAt[c.team];
  let wantKick = false;
  if (goalD > 78) {
    // own 22: clear when the defence is closing; otherwise play the phase
    wantKick = sinceKick > 30 && (pressured || m.rng.chance(0.4));
  } else if (goalD > 55 && kickFreq > 0.44 && sinceKick > 70 && m.rng.chance(0.18 + (kickFreq - 0.44) * 1.2)) {
    wantKick = true; // tactical clear/territory kick — every side does this
  } else if (redZone && !closeToLine && kickFreq > 0.8 && sinceKick > 30 && m.rng.chance(0.15)) {
    wantKick = true; // rare chip/grubber for the corner (used by kick-heavy sides)
  }
  if (wantKick) opts.push({ kind: 'KICK', score: 0.95 + m.rng.range(0, 0.2) });

  // offload when the offload slider is hot, a man is right there AND the lane
  // to him is clean — real offloads are rare (a few per match), not a habit.
  const offload = live.intent.offload;
  if (pressured && offload > 0.62 && m.rng.chance((offload - 0.5) * 0.09)) {
    const near = m.teamLive(c.team).players
      .filter((p) => p !== c && p.downUntil <= m.t && p.num <= 12 && dist(p.x, p.y, c.x, c.y) < 4.5)
      .map((p) => ({ p, d: laneDanger(m, c, p) }))
      .sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 1.8) opts.push({ kind: 'OFFLOAD', score: 0.5 + (offload - 0.5) * 0.5, target: near.p.idx });
  }

  // choose
  const total = opts.reduce((s, o) => s + o.score, 0);
  let roll = m.rng.next() * total;
  let pick = opts[opts.length - 1];
  for (const o of opts) {
    roll -= o.score;
    if (roll <= 0) { pick = o; break; }
  }
  if (!pick) return;

  if (pick.kind === 'PASS' && pick.target != null && now - m.lastPassAt[c.team] > 1.4) {
    m.lastPassAt[c.team] = now;
    m.pass(c.idx, pick.target);
  } else if (pick.kind === 'OFFLOAD' && pick.target != null) {
    m.pass(c.idx, pick.target, 'OFFLOAD');
  } else if (pick.kind === 'KICK' && now - m.lastKickAt[c.team] > 5) {
    m.lastKickAt[c.team] = now;
    aiKick(m, c);
  }
  // RUN: handled by movement + the engine's contact check
}

function chooseRunLane(m: Match, c: DynPlayer, press: DynPlayer | null): { vx: number; vy: number; speed: number; sprint: boolean; space: number } {
  const dir = m.dirOf(c.team);
  const live = m.teamLive(c.team);
  const goalD = m.toGoal(c.team, c.x);
  const def = c.team === 'A' ? 'B' : 'A';
  // sample three headings (straight, open, blind) and pick the safest
  const open = c.y > PITCH_W / 2 ? 1 : -1;
  const nearLine = goalD < 6;
  const headings = [
    { vx: dir, vy: 0, tag: 'straight' },
    { vx: dir * 0.93, vy: open * 0.36, tag: 'open' },
    { vx: dir * 0.93, vy: -open * 0.36, tag: 'blind' },
  ];
  let best = headings[0]; let bestSpace = -1;
  for (const h of headings) {
    // look ahead on that heading for the nearest defender
    const look = nearLine ? 4.5 : 9;
    const sx = c.x + h.vx * look, sy = c.y + h.vy * look;
    let space = look;
    for (const p of m.teamLive(def).players) {
      if (p.downUntil > m.t) continue;
      const dd = dist(p.x, p.y, sx, sy);
      if (dd < 4.6) space = Math.min(space, dd);
    }
    if (space > bestSpace) { bestSpace = space; best = h; }
  }
  const pressD = press ? dist(press.x, press.y, c.x, c.y) : 99;
  const sprint = bestSpace > 5 && live.intent.tempo > 0.35 && pressD > 2.6;
  const spd = sprint ? topSpeed(c.spd, c.stamina) * 1.18
    : nearLine ? topSpeed(c.spd, c.stamina) * 1.12      // burst for the line
    : pressD < 4 ? 5.6
    : topSpeed(c.spd, c.stamina) * 0.9;
  return { vx: best.vx, vy: best.vy, speed: spd, sprint, space: bestSpace };
}

function aiKick(m: Match, c: DynPlayer) {
  const live = m.teamLive(c.team);
  const dir = m.dirOf(c.team);
  const goalD = m.toGoal(c.team, c.x);
  const archKick = live.intent.kicking;
  // territory: clear to touch if deep; otherwise a contestable bomb or 50:22-ish
  const y = c.y;
  if (goalD > 62) {
    // clearing punt: genuine touch-finders die over the touchline (lineout to
    // the opposition — the territory trade), the rest land 10 m infield as a
    // contestable bomb. Real Test sides find touch ~40% of clearances.
    const touchFind = m.rng.chance(0.26);
    const tgtY = touchFind ? (m.rng.chance(0.5) ? -3.5 : PITCH_W + 3.5)
      : (m.rng.chance(0.5) ? 10 : PITCH_W - 10);
    const distM = Math.min(goalD - 2, 38 + m.rng.range(0, 18));
    m.launchKick(c.idx, c.x, c.y, dir, distM, tgtY, 7.5, !touchFind, 'KICK');
  } else if (goalD > 30) {
    // cross-field or grubber
    if (m.rng.chance(0.3 + archKick * 0.2)) {
      const tgtY = m.rng.chance(0.5) ? PITCH_W - 4 : 4;
      m.launchKick(c.idx, c.x, c.y, dir, goalD * 0.8, tgtY, 5.5, false, 'KICK');
    } else {
      m.launchKick(c.idx, c.x, c.y, dir, 12 + m.rng.range(0, 8), y + m.rng.range(-4, 4), 2.2, false, 'GRUBBER');
    }
  } else {
    m.launchKick(c.idx, c.x, c.y, dir, 20 + m.rng.range(0, 10), y + m.rng.range(-8, 8), 6.5, true, 'KICK');
  }
}

function humanKick(m: Match, c: DynPlayer, kind: 'PUNT' | 'GRUBBER') {
  const dir = m.dirOf(c.team);
  const inp = m.humanInput;
  // aim by the input lateral axis at the moment of the kick
  const y = clamp(c.y + (inp.right - inp.left) * 12, 4, PITCH_W - 4);
  if (kind === 'PUNT') m.launchKick(c.idx, c.x, c.y, dir, 26 + (inp.up > 0 ? 14 : 0), y, 7, false, 'KICK');
  else m.launchKick(c.idx, c.x, c.y, dir, 12, y, 2.0, false, 'GRUBBER');
}

/* ============================================================ HELPERS ==== */
function nearestOf(m: Match, team: TeamId, x: number, y: number, n: number): DynPlayer[] {
  return m.teamLive(team).players
    .filter((p) => p.downUntil <= m.t && p.sinbinUntil <= m.t && p.state !== 'down')
    .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y))
    .slice(0, n);
}

function pickControlledDefender(m: Match): number {
  // keep the current man unless the ball moved far or he is down
  const cur = m.controlledIdx >= 0 ? m.players[m.controlledIdx] : null;
  const c = m.carrier();
  if (c) {
    if (cur && cur.team === m.humanTeam && dist(cur.x, cur.y, c.x, c.y) < 8) return cur.idx;
    const near = nearestOf(m, m.humanTeam!, c.x, c.y, 1)[0];
    return near ? near.idx : cur ? cur.idx : -1;
  }
  return cur ? cur.idx : -1;
}

void CATCH_RADIUS;
