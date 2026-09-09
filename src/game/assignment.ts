/* ------------------------------------------------- ASSIGNMENT (A-4) ---
 * ENGINE INNOVATION 2 / first plan I-9 — kill "two men orbit one dot".
 *
 * When several players each want the best reachable slot (a loose ball, a gap,
 * a breakdown point), the naive behaviour is that two of them chase the SAME
 * point and orbit it, because each only considers his own authored priority.
 * Real players resolve this by a tacit, deterministic division of labour.
 *
 * This module assigns DISTINCT players to DISTINCT target slots one-to-one,
 * minimising total travel by a stable greedy (nearest-first with index tie-
 * break). It is pure and deterministic, so it survives the headless sim and is
 * probed. It is the fallback the discrete dataset's conflict rule and the
 * A-4 position-security value both reduce to: "who is allowed to want this
 * point."
 */

export interface P2D { x: number; z: number; }

/**
 * Assign up to min(players, slots) players to DISTINCT slots one-to-one by a
 * stable nearest-first greedy. Returns an array of length `players` whose i-th
 * entry is the assigned slot index, or -1 when that player gets nothing
 * (only when there are fewer slots than players). Deterministic: ties break to
 * the lowest player then lowest slot index.
 */
export function assignDistinct(
  players: P2D[],
  slots: P2D[],
): number[] {
  const out = new Array<number>(players.length).fill(-1);
  if (slots.length === 0 || players.length === 0) return out;
  const booked = new Array<boolean>(slots.length).fill(false);
  // build ordered list of (player, slot, distSq) then sort stably
  type Cand = { pi: number; si: number; d: number };
  const cands: Cand[] = [];
  for (let pi = 0; pi < players.length; pi++) {
    for (let si = 0; si < slots.length; si++) {
      const dx = players[pi].x - slots[si].x;
      const dz = players[pi].z - slots[si].z;
      cands.push({ pi, si, d: dx * dx + dz * dz });
    }
  }
  cands.sort((a, b) =>
    a.d - b.d || a.pi - b.pi || a.si - b.si);
  for (const c of cands) {
    if (out[c.pi] !== -1) continue; // this player already taken
    if (booked[c.si]) continue;     // this slot already claimed
    out[c.pi] = c.si;
    booked[c.si] = true;
  }
  return out;
}

/** Total Euclidean travel for an assignment from `assignDistinct`. */
export function assignmentCost(players: P2D[], slots: P2D[], assign: number[]): number {
  let cost = 0;
  for (let i = 0; i < players.length; i++) {
    if (assign[i] < 0) continue;
    const p = players[i], s = slots[assign[i]];
    cost += Math.hypot(p.x - s.x, p.z - s.z);
  }
  return cost;
}
