/**
 * AI PLANNER — fills one `Wish` per player each frame of open play.
 *
 * The engine owns physics and laws; this module owns intent. It produces, for
 * every body on the pitch, a steering target, a pace, and at most one discrete
 * action. The human-controlled player is deliberately left alone — the engine
 * overrides his wish with live input.
 *
 * Positioning is driven by the thesis's ROLE CONTRACTS (each shirt has an
 * authored lateral/depth for open play and for the defensive line) and by the
 * live SET PLAY (a named call whose runners override the stock shape). Every
 * verb reads the attribute that the design doc assigns it: AWA positions and
 * arrives, AGG sets the line speed, SKL throws, PWR contests, SPD breaks.
 */
import type { RugbySim } from './engine';
import type { Player, Wish, Act } from './types';
import { TRY_X } from './consts';
import { dist } from './consts';
import { contractFor } from './design';

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

export function plan(sim: RugbySim, wishes: Wish[]) {
  const carrier = sim.carrier();
  const b = sim.ball;
  const attacking: 'A' | 'B' = carrier?.side ?? sim.possession ?? 'A';
  const ad = sim.attackDir(attacking);
  const all = [...sim.A.players, ...sim.B.players];
  const openSign = b.y >= 0 ? -1 : 1; // openside = away from the nearer touchline

  const idxOf = (p: Player) => (p.id < 100 ? p.id - 1 : p.id - 101 + 15);

  for (const p of all) {
    const w = wishes[idxOf(p)];
    w.act = null;
    if (p.down > 0 || p.bind >= 0 || p.sinbin > 0) {
      w.tx = p.x; w.ty = p.y; w.speed = 0; w.sprint = false;
      continue;
    }

    /* --- the carrier --- */
    if (p === carrier) {
      const near = defendersNear(sim, p, 4.5);
      const ch = openChannel(sim, p, ad);
      w.tx = ch.tx; w.ty = ch.ty;
      w.speed = 1;
      // sprint in space, and hard at the line — a try is worth the burn
      w.sprint = near === 0 || TRY_X - p.x * ad < 5;
      if (p.id !== sim.ctrlId) {
        if (p.decide <= 0) {
          w.act = carrierDecision(sim, p);
          p.decide = 0.4;
        } else {
          w.act = null;
        }
      }
      continue;
    }

    /* --- loose ball: everyone chases, nearest scoops --- */
    if (b.owner == null) {
      w.tx = b.x; w.ty = b.y; w.speed = 1; w.sprint = true;
      if (p.id !== sim.ctrlId && dist(p.x, p.y, b.x, b.y) < 1.4) w.act = { kind: 'SCOOP' };
      continue;
    }

    /* --- attack support (role contract + set play) --- */
    if (p.side === attacking) {
      const t = supportPoint(sim, p, carrier!, ad, openSign);
      w.tx = t.x; w.ty = t.y;
      // AWARENESS: a smart support runner arrives at pace, a slow one ambles
      w.speed = 0.82 + (sim.awa(p) / 100) * 0.18;
      w.sprint = p.num === 9 || p.num === 14 || p.num === 11;
      continue;
    }

    /* --- defence --- */
    const onside = p.x * ad <= carrier!.x * ad + 0.5;
    if (p.id !== sim.ctrlId && sim.releaseGrace <= 0 && onside && dist(p.x, p.y, carrier!.x, carrier!.y) < 2.5) {
      w.act = { kind: 'TACKLE' };
      w.tx = carrier!.x; w.ty = carrier!.y; w.speed = 1; w.sprint = true;
      continue;
    }
    const t = defensePoint(p, carrier!, ad, openSign);
    // after a line break the cover defence is flat-footed — only the near man
    // still runs at full pace
    const shocked = sim.defenseShock > 0 && dist(p.x, p.y, carrier!.x, carrier!.y) > 4;
    // AGGRESSION sets the line speed; a soft defender drifts, a hard one shoots
    w.tx = t.x; w.ty = t.y;
    w.speed = shocked ? 0.4 : 0.7 + (p.att.agg / 100) * 0.3;
    w.sprint = !shocked && p.att.agg > 78 && dist(p.x, p.y, carrier!.x, carrier!.y) < 9;
  }
}

/* ---------------- helpers ---------------- */

function defendersNear(sim: RugbySim, p: Player, r: number): number {
  const opp = p.side === 'A' ? sim.B.players : sim.A.players;
  let n = 0;
  for (const d of opp) if (d.down <= 0 && d.sinbin <= 0 && dist(d.x, d.y, p.x, p.y) < r) n++;
  return n;
}

function pickReceiver(sim: RugbySim, p: Player): Player | null {
  const ad = sim.attackDir(p.side);
  const mates = (p.side === 'A' ? sim.A.players : sim.B.players);
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const q of mates) {
    if (q === p || q.down > 0 || q.bind >= 0 || q.sinbin > 0) continue;
    const dx = q.x - p.x, dy = q.y - p.y;
    const fwd = dx * ad;
    if (fwd > -0.8) continue;
    const d = Math.hypot(dx, dy);
    if (d > 22) continue;
    const nearby = defendersNear(sim, q, 3);
    // SKL makes the throw stick; a smart runner finds space (fewer defenders)
    const score = -nearby * 2.6 - d * 0.12 + q.att.skl * 0.03 - Math.max(0, -fwd) * 0.08;
    if (score > bestScore) { bestScore = score; best = q; }
  }
  return best;
}

function carrierDecision(sim: RugbySim, p: Player): Act | null {
  const ad = sim.attackDir(p.side);
  const near = defendersNear(sim, p, 4);
  const r = sim.rng();
  const recv = pickReceiver(sim, p);
  const skl = p.att.skl / 100;
  const x = p.x * ad; // +ve = opposition half
  const play = sim.play;

  // the SET PLAY bias steers the first decision off a breakdown
  if (play && play.side === p.side && sim.phasesSinceBreak <= 1) {
    if (play.bias === 'PASS' && recv && r < 0.85) return { kind: 'PASS', target: recv.id };
    if (play.bias === 'CARRY' && near <= 2) return null; // hold it, take contact on terms
    if (play.bias === 'KICK_CROSS' && p.num === 10 && r < 0.5) return { kind: 'PUNT' };
    if (play.bias === 'KICK_DROP' && p.num === 10 && near >= 1) return { kind: 'DROP' };
  }

  // a fresh release is a distribution moment: the 9 (or 10) moves it fast
  if (sim.releaseGrace > 0 && recv && p.num <= 10 && r < 0.9) {
    return { kind: 'PASS', target: recv.id };
  }
  if (near >= 2 && recv && r < 0.22 + skl * 0.16) {
    return { kind: 'PASS', target: recv.id };
  }
  // exit kick out of your own 22 under heavy pressure with no outlet
  if (x < -12 && near >= 3 && !recv && r < 0.25) {
    return { kind: 'PUNT' };
  }
  // grubber behind a flat defence in the attacking half
  if (x > 24 && r < 0.08) {
    return { kind: 'GRUBBER' };
  }
  // drop goal in range, and only when the move is being contested
  const goalDist = TRY_X - x;
  if (goalDist > 14 && goalDist < 40 && near >= 1 && r < 0.02 + p.att.kik / 100 * 0.015) {
    return { kind: 'DROP' };
  }
  return null;
}

/** Find the most open channel in the defensive line ~8 m ahead of the carrier,
 * so the runner angles at space rather than a defender's chest. */
function openChannel(sim: RugbySim, p: Player, ad: number): { tx: number; ty: number } {
  const ahead = p.x + ad * 8;
  const defs = (p.side === 'A' ? sim.B.players : sim.A.players)
    .filter((d) => d.down <= 0 && d.sinbin <= 0 && d.x * ad > p.x * ad - 1);
  let bestY = p.y, bestClear = -Infinity;
  for (let y = -28; y <= 28; y += 4) {
    let clear = 8;
    for (const d of defs) {
      const dd = Math.hypot(ahead - d.x, y - d.y);
      if (dd < clear) clear = dd;
    }
    if (clear > bestClear) { bestClear = clear; bestY = y; }
  }
  return { tx: ahead, ty: bestY };
}

/** Attack support from the ROLE CONTRACTS, overridden by the live set play's
 * runner offsets. The anchor is the carrier; depth is behind the gain line,
 * lateral is across the openside. */
function supportPoint(sim: RugbySim, p: Player, carrier: Player, ad: number, openSign: number): { x: number; y: number } {
  const play = sim.play;
  if (play && play.side === p.side) {
    const run = play.runners.find((rp) => rp.num === p.num);
    if (run) {
      return {
        x: carrier.x - ad * run.dx,   // dx = metres behind the ball
        y: clamp(carrier.y + run.dy * openSign, -32, 32),
      };
    }
  }
  const rc = contractFor(p.num);
  // OPEN_PLAY depth is a *set* depth; in live open play the line must be flat
  // (FLOW-05: three or four passes from turnover ball). Keep the authored
  // LATERAL — that is what stops props drifting to flyhalf — and flatten depth.
  const depth = (rc.depth.OPEN ?? (p.num <= 8 ? 4.5 : 8)) * 0.5;
  const lateral = rc.lateral.OPEN ?? 0;
  return {
    x: carrier.x - ad * depth,
    y: clamp(carrier.y + lateral * openSign, -32, 32),
  };
}

/** The defensive line from the ROLE CONTRACTS' DEFENCE_LINE row: each shirt
 * has an authored lateral and depth behind the gain line (the ball). The
 * fullback sweeps deepest, the front five set the first line. */
function defensePoint(p: Player, carrier: Player, ad: number, openSign: number): { x: number; y: number } {
  const rc = contractFor(p.num);
  const depth = rc.depth.DEFENCE ?? (p.num === 15 ? 9 : 0);
  const lateral = rc.lateral.DEFENCE ?? 0;
  return {
    x: carrier.x - ad * depth,
    y: clamp(carrier.y + lateral * openSign, -32, 32),
  };
}
