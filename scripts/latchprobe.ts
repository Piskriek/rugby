/**
 * LATCH-AND-DRAG probe. Runs full matches headless and measures the middle
 * of the tackle that this feature exists to create:
 *   - how many tackles now go through a latch at all
 *   - how long the drag lasts, and how far the pair travel
 *   - that the carrier is genuinely SLOWED but still MOVING while held
 *   - that the defender is actually snapped to the carrier's hip
 *   - that no latch ever leaks past the end of its episode
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { LATCH_MAX_DRAG, LATCH_TRAIL_METRES } from '../src/game/engine/latch';

let seed = 7 >>> 0 || 1;
const dt = 1 / 60;
Math.random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

interface Ep { t: number; dragged: number; speeds: number[]; gaps: number[]; dived: boolean }
const done: Ep[] = [];
let cur: Ep | null = null;
let leaks = 0;
let maxT = 0;
let breakdowns = 0;

for (let m = 0; m < 3; m++) {
  const d = new Director(gateConfig(3));
  let guard = 60 * 800;
  let wasBd = false;
  while (!d.over && guard-- > 0) {
    d.update(dt, NO_INPUT, new Set());

    const isBd = d.phase === 'BREAKDOWN';
    if (isBd && !wasBd) breakdowns++;
    wasBd = isBd;

    const latch = d.phase === 'OPEN_PLAY' ? d.op?.latch : undefined;
    if (latch) {
      const car = d.L(latch.carrierTeam, latch.carrierNum);
      const tak = d.L(latch.tacklerTeam, latch.tacklerNum);
      if (!cur) cur = { t: 0, dragged: 0, speeds: [], gaps: [], dived: latch.dived };
      cur.t = latch.t;
      cur.dragged = latch.dragged;
      cur.speeds.push(Math.hypot(car.vx, car.vz));
      cur.gaps.push(Math.hypot(car.x - tak.x, car.z - tak.z));
      maxT = Math.max(maxT, latch.t);
    } else if (cur) {
      done.push(cur);
      cur = null;
    }

    // leak check: a link field set with no live latch owning it
    const live = d.phase === 'OPEN_PLAY' && d.op?.latch;
    if (!live) {
      for (const p of d.live) if (p.latchedBy || p.latchingOnto) { leaks++; break; }
    }
  }
}

const n = done.length;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const allSpeeds = done.flatMap((e) => e.speeds);
const allGaps = done.flatMap((e) => e.gaps);
const stalled = allSpeeds.filter((v) => v < 0.35).length;

console.log(`latches      : ${n}   (breakdowns ${breakdowns})`);
console.log(`drag time    : avg ${avg(done.map((e) => e.t)).toFixed(3)}s  max ${maxT.toFixed(3)}s  (cap ${LATCH_MAX_DRAG})`);
console.log(`drag distance: avg ${avg(done.map((e) => e.dragged)).toFixed(2)}m  max ${Math.max(0, ...done.map((e) => e.dragged)).toFixed(2)}m`);
console.log(`carrier speed while held: avg ${avg(allSpeeds).toFixed(2)} m/s  min ${Math.min(...allSpeeds).toFixed(2)}  max ${Math.max(...allSpeeds).toFixed(2)}`);
console.log(`  frames stalled (<0.35 m/s): ${stalled}/${allSpeeds.length}`);
console.log(`hip gap      : avg ${avg(allGaps).toFixed(3)}m  max ${Math.max(...allGaps).toFixed(3)}m  (target ${LATCH_TRAIL_METRES})`);
console.log(`dives        : ${done.filter((e) => e.dived).length}/${n}`);
console.log(`LEAKED FRAMES: ${leaks}`);
