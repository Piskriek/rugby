/**
 * ASSIGNMENT PROBE — A-4 anti-orbit ("two men never orbit one dot") / first
 * plan I-9.
 *
 * Headless acceptance for the deterministic one-to-one slot assignment that
 * stops distinct players chasing the same point:
 *   - No two players are ever assigned the same slot.
 *   - Each player is assigned to a DISTINCT slot even when all want the same
 *     hotspot (they fan out to the next-nearest).
 *   - Greedy nearest-first is deterministic and reproducible.
 *   - With fewer slots than players, the leftover players are unassigned
 *     (-1) rather than colliding.
 *   - The obvious nearest pairing is respected (no crossing when clearly
 *     better not to).
 *
 *   npx tsx scripts/assignmentprobe.ts
 */
import { assignDistinct, assignmentCost, type P2D } from '../src/game/assignment';

let failures = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const fail = (m: string) => { failures++; console.log(`FAIL: ${m}`); };

/* ---- 1. Two players, one hot slot each -> they go to distinct slots even
 *          when both are nearest to slot 0. ---- */
{
  const players: P2D[] = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
  const slots: P2D[] = [{ x: 0, z: 0 }, { x: 5, z: 0 }];
  const a = assignDistinct(players, slots);
  if (a[0] !== -1 && a[1] !== -1 && a[0] !== a[1])
    ok('two men fan out to DISTINCT slots (no orbit collision)');
  else fail(`assignment collided: ${a.join(',')}`);
}

/* ---- 2. Five players all nearest one hot slot -> distinct, deterministic. */
{
  const players: P2D[] = Array.from({ length: 5 }, (_, i) => ({ x: i, z: i }));
  const slots: P2D[] = Array.from({ length: 5 }, (_, i) => ({ x: i + 100, z: 0 }));
  const a = assignDistinct(players, slots);
  const uniq = new Set(a);
  if (a.every((v) => v >= 0) && uniq.size === 5)
    ok('5 players -> 5 distinct slots, none colliding');
  else fail(`5-player assignment invalid: ${a.join(',')}`);
  // determinism
  const b = assignDistinct(players, slots);
  if (a.every((v, i) => v === b[i])) ok('assignment is deterministic');
  else fail('assignment not deterministic');
}

/* ---- 3. More players than slots -> leftovers are -1, no collision. */
{
  const players: P2D[] = [{ x: 0, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }];
  const slots: P2D[] = [{ x: 10, z: 10 }];
  const a = assignDistinct(players, slots);
  const assigned = a.filter((v) => v >= 0).length;
  const unassigned = a.filter((v) => v === -1).length;
  if (assigned === 1 && unassigned === 2) ok('single slot claimed by exactly one player; others unassigned');
  else fail(`expected 1 assigned / 2 unassigned, got ${assigned}/${unassigned}`);
}

/* ---- 4. Obvious nearest pairing respected (no unnecessary crossing). ---- */
{
  const players: P2D[] = [{ x: 0, z: 0 }, { x: 20, z: 0 }];
  const slots: P2D[] = [{ x: 0.2, z: 0 }, { x: 19.8, z: 0 }];
  const a = assignDistinct(players, slots);
  // p0 should take s0, p1 should take s1
  if (a[0] === 0 && a[1] === 1) ok('nearest-first: no crossing');
  else fail(`crossed assignment ${a.join(',')}`);
}

/* ---- 5. assignmentCost is the total travel of the chosen pairs. ---- */
{
  const players: P2D[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
  const slots: P2D[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }];
  const a = assignDistinct(players, slots);
  const cost = assignmentCost(players, slots, a);
  if (Math.abs(cost - 0) < 1e-9) ok('assignment cost ~0 when already on target');
  else fail(`cost ${cost}`);
}

console.log(failures === 0 ? `\nassignmentprobe: PASS (0 failures)` : `\nassignmentprobe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
