/**
 * T-06 acceptance — the mechanical lineout lift.
 *
 * Usage: npx vite-node scripts/lotest.ts
 *
 * Forces the lineout contest resolution with controlled rosters:
 *   strong lifters (PWR 95) on the throwing side vs weak (PWR 45):
 *     the 7-man lineout must win > 70%.
 *   equal lifters: a moderate thrower edge, not a landslide.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

function runBatch(atkLiftPWR: number, defLiftPWR: number, quality: number, n = 100): number {
  let throwerWins = 0;
  for (let i = 0; i < n; i++) {
    const d: any = new Director(gateConfig(3));
    const setPWR = (team: 'A' | 'B', nums: number[], v: number) => {
      for (const num of nums) {
        const p = d.live.find((x: any) => x.team === team && x.num === num);
        if (p) p.attrs.PWR = v;
      }
    };
    setPWR('A', [7, 8], atkLiftPWR);
    setPWR('B', [7, 8], defLiftPWR);
    setPWR('A', [4, 5, 6], 80); setPWR('B', [4, 5, 6], 80);
    d.startLineout('A', 20, 6);
    const lo = d.lo;
    lo.stage = 'CATCH'; lo.t = 1;
    lo.quality = quality;
    lo.ball = { ...lo.ball, x: lo.call.targetX, y: 2.0, vy: -1, vx: 0 };
    d.update(1 / 60, NO_INPUT, new Set<string>());
    if (d.A.stats.lineoutsWon > 0) throwerWins++;
  }
  return throwerWins / n;
}

const strong = runBatch(95, 45, 0.85);
const even = runBatch(75, 75, 0.75);
const badThrow = runBatch(95, 45, 0.35);
console.log(`strong 7-man lift vs weak: ${(strong * 100).toFixed(0)}%  (acceptance: > 70%)`);
console.log(`even lifters, good throw:  ${(even * 100).toFixed(0)}%  (expect ~55-70%)`);
console.log(`strong lift but poor throw: ${(badThrow * 100).toFixed(0)}%  (expect a fight)`);
process.exit(strong > 0.7 ? 0 : 1);
