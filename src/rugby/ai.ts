/**
 * AI PLANNER — fills one `Wish` per player each frame of open play.
 *
 * The engine owns physics and laws; this module owns intent. It produces, for
 * every body on the pitch, a steering target, a pace, and at most one discrete
 * action. The human-controlled player is deliberately left alone — the engine
 * overrides his wish with live input.
 *
 * Attack: forwards set pods behind the ball, backs spread with depth, the
 * carrier decides run/pass/kick/grubber/drop from pressure and field position.
 * Defence: a sliding line anchored behind the ball, nearest man to the carrier
 * makes the tackle, the fullback sweeps deep.
 */
import type { RugbySim } from './engine';
import type { Player, Wish, Act } from './types';
import { TRY_X } from './consts';
import { dist } from './consts';

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

export function plan(sim: RugbySim, wishes: Wish[]) {
  const carrier = sim.carrier();
  const b = sim.ball;
  const attacking: 'A' | 'B' = carrier?.side ?? sim.possession ?? 'A';
  const ad = sim.attackDir(attacking);
  const all = [...sim.A.players, ...sim.B.players];

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
      w.speed = 1; w.sprint = near === 0;
      // deliberate decisions on a cooldown — no per-frame dice spam
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

    /* --- attack support --- */
    if (p.side === attacking) {
      const t = supportPoint(p, carrier!, ad);
      w.tx = t.x; w.ty = t.y; w.speed = 0.92; w.sprint = false;
      continue;
    }

    /* --- defence --- */
    const onside = p.x * ad <= carrier!.x * ad + 0.5;
    if (p.id !== sim.ctrlId && sim.releaseGrace <= 0 && onside && dist(p.x, p.y, carrier!.x, carrier!.y) < 2.5) {
      w.act = { kind: 'TACKLE' };
      w.tx = carrier!.x; w.ty = carrier!.y; w.speed = 1; w.sprint = true;
      continue;
    }
    const t = defensePoint(p, carrier!, ad);
    // after a line break the cover defence is flat-footed — only the near man
    // still runs at full pace
    const shocked = sim.defenseShock > 0 && dist(p.x, p.y, carrier!.x, carrier!.y) > 5;
    w.tx = t.x; w.ty = t.y; w.speed = shocked ? 0.5 : 0.85; w.sprint = false;
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

  // a fresh release is a distribution moment: the 9 (or 10) moves it fast
  if (sim.releaseGrace > 0 && recv && p.num <= 10 && r < 0.9) {
    return { kind: 'PASS', target: recv.id };
  }
  if (near >= 2 && recv && r < 0.22 + skl * 0.16) {
    return { kind: 'PASS', target: recv.id };
  }
  // exit kick out of your own 22 under heavy pressure with no outlet
  if (p.x * ad < -12 && near >= 3 && !recv && r < 0.25) {
    return { kind: 'PUNT' };
  }
  // grubber behind a flat defence in the attacking half
  if (p.x * ad > 24 && r < 0.08) {
    return { kind: 'GRUBBER' };
  }
  // drop goal in range, and only when the move is being contested
  const goalDist = TRY_X - p.x * ad;
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

function supportPoint(p: Player, carrier: Player, ad: number): { x: number; y: number } {
  if (p.num <= 8) {
    // forwards pod: tight and flat, a metre off the carrier's shoulder
    return {
      x: carrier.x - ad * 1.2 + (p.num % 2 === 0 ? 1.8 : -1.8),
      y: clamp(carrier.y + (p.num % 3 - 1) * 2.2, -32, 32),
    };
  }
  const [depth, across] = backPos(p.num);
  return { x: carrier.x - ad * depth, y: clamp(carrier.y + across, -32, 32) };
}

function backPos(num: number): [number, number] {
  switch (num) {
    case 9: return [1.2, 2.2];
    case 10: return [2.6, 0];
    case 12: return [3.6, -4.5];
    case 13: return [3.6, 4.5];
    case 11: return [4.6, -13];
    case 14: return [4.6, 13];
    case 15: return [6.5, 0];
    default: return [3.6, (num - 11) * 5];
  }
}

function defensePoint(p: Player, carrier: Player, ad: number): { x: number; y: number } {
  const lineX = carrier.x - ad * 2.6;
  let spread = 0;
  if (p.num <= 8) spread = p.num % 2 === 0 ? 2.2 : -2.2;
  else if (p.num === 9 || p.num === 10 || p.num === 15) spread = 0;
  else spread = (p.num - 12.5) * 7;
  const deep = p.num === 15 ? 9 : 0;
  return { x: lineX - ad * deep, y: clamp(carrier.y + spread, -32, 32) };
}
