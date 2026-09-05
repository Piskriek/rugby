/**
 * HEADLESS SMOKE TEST for the new engine.
 * Run: npx vite-node scripts/new_smoke.ts [frames]
 *
 * Steps a WATCH-mode match for N frames and reports the phase histogram,
 * scoring, event counts and any NaN/teleport faults. This is the new engine's
 * equivalent of the old `chain.ts` gate — it proves the sim runs clean and
 * complete without a browser.
 */
import { RugbySim } from '../src/rugby/engine';
import { dist } from '../src/rugby/consts';

const frames = parseInt(process.argv[2] ?? '5400', 10); // 90s at 60Hz
const sim = new RugbySim({ home: 'ENG', away: 'NZL', difficulty: 3, halfMinutes: 2, human: 'WATCH', seed: 12345 });

const phaseHist: Record<string, number> = {};
let nanCount = 0;
let teleports = 0;
let maxStep = 0;

const px = new Map<number, [number, number]>();

for (let f = 0; f < frames && !sim.ended; f++) {
  sim.step(1 / 60);
  if (sim.ended) break;
  const ph = sim.phase;
  phaseHist[ph] = (phaseHist[ph] ?? 0) + 1;
  maxStep = Math.max(maxStep, sim.lastStepMs);

  for (const p of [...sim.A.players, ...sim.B.players]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.vx) || !Number.isFinite(p.vy)) nanCount++;
    const prev = px.get(p.id);
    if (prev) {
      const d = dist(prev[0], prev[1], p.x, p.y);
      if (d > 2.2) teleports++; // a sprint covers ~0.15 m/frame
    }
    px.set(p.id, [p.x, p.y]);
  }
}

console.log('=== NEW ENGINE SMOKE ===');
console.log('frames          ', frames);
console.log('score           ', `${sim.A.score} - ${sim.B.score}`, `(${sim.A.short} v ${sim.B.short})`);
console.log('phase histogram ', JSON.stringify(phaseHist));
console.log('event counts    ', JSON.stringify(sim.counts));
console.log('feed (last 5)   ');
for (const e of sim.feed.slice(0, 5)) console.log('   ', e.t.toFixed(0) + 's', e.text);
console.log('NaN positions   ', nanCount);
console.log('teleports       ', teleports);
console.log('max step ms     ', maxStep.toFixed(3));

const ok = nanCount === 0 && (sim.A.score + sim.B.score) > 0 && Object.keys(phaseHist).length >= 5;
console.log(ok ? 'SMOKE: PASS' : 'SMOKE: FAIL');
process.exit(ok ? 0 : 1);
