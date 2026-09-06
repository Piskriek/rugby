/*
 * BREAKDOWN AUDIT — measures the tackle/ruck behaviour that was being edited.
 *
 * Runs a seeded CPU-v-CPU match and reports, per breakdown:
 *   - whether any CLEANER / FIRST CLEARER is ever marked down (must be 0);
 *   - whether the clearout actually DRIVES toward the ball (per-frame closure);
 *   - what clip a cleaner is playing while the ruck is open;
 *   - the distribution of ruck release windows (is slow ball reachable?);
 *   - whether the ball comes out ON the release mark (measured at the exact
 *     `startOpen` call, not on some later OPEN_PLAY frame);
 *   - how long breakdowns actually last.
 *
 * Run: npx vite-node scripts/breakdownAudit.ts [seed]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const dt = 1 / 60;
const seed = Number(process.argv[2] ?? 5) >>> 0 || 1;
let s = seed;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

let breakdowns = 0;
let downCleaners = 0;
let cleanerFrames = 0;
let cleanerCleanoutFrames = 0;
let cleanerProgress = 0;
const clipHist = new Map<string, number>();
const cleanerDist: number[] = [];
const crewStartDist: number[] = [];
let crewStartFar = 0;
const windowSamples: number[] = [];
let slowBallAtRelease = 0;
let releaseN = 0;
let releaseFar = 0;
let releaseMax = 0;
const releaseFars: any[] = [];
const durs: number[] = [];
let breakdownSerial = 0;
let prevAny: { at: number } | null = null;

const lastDist = new Map<string, number>();

const d = new Director(gateConfig(3));
/* Hook startOpen: the release mark can only be measured at the exact call —
 * waiting for the next OPEN_PLAY frame is unreliable because a clean exit can
 * kick/pass away on that same frame and the carrier's position has already
 * left the mark. */
const origStartOpen = d.startOpen.bind(d);
let pendingRelease: { win: number; ct: number } | null = null;
d.startOpen = (team: 'A' | 'B', x: number, z: number, num: number, phase: number, gained: number, protect: number) => {
  const fromRuck = pendingRelease !== null;
  const win = fromRuck ? pendingRelease!.win : 0;
  const ct = fromRuck ? pendingRelease!.ct : 0;
  pendingRelease = null;
  const ret = origStartOpen(team, x, z, num, phase, gained, protect);
  if (fromRuck) {
    windowSamples.push(win);
    if (ct > 1.0) slowBallAtRelease++;
    const car = d.L(team, num);
    const dist = Math.hypot(car.x - x, car.z - z);
    releaseN++;
    releaseMax = Math.max(releaseMax, dist);
    if (dist > 3.5) {
      releaseFar++;
      releaseFars.push({ dist, cx: x, cz: z, carrierX: car.x, carrierZ: car.z, num, phase: d.phase, t: d.t });
    }
  }
  return ret;
};

let guard = 60 * 60 * 30;
while (!d.over && guard-- > 0) {
  /* Only arm the release hook when the ruck is actually due to go this frame.
   * The engine can sit in RECYCLE for a beat before ballOutAt; arming it every
   * RECYCLE frame leaks a stale hook into the next OPEN_PLAY hand-off. */
  if (d.bd && d.bd.stage === 'RECYCLE') {
    const outAt = d.bd.ballOutAt > 0 ? d.bd.ballOutAt : d.bd.groundAt + d.bd.window + 0.05;
    if (d.bd.t + dt >= outAt) pendingRelease = { win: d.bd.window, ct: d.bd.contestT };
  }
  d.update(dt, NO_INPUT, new Set());

  if (d.bd) {
    const b = d.bd;
    if (!prevAny) { breakdownSerial++; prevAny = { at: d.t };
      for (const q of b.players) {
        const dd = Math.hypot(d.L(q.team, q.num).x - b.contactX, d.L(q.team, q.num).z - b.contactZ);
        crewStartDist.push(dd);
        if (dd > 10) crewStartFar++;
      }
    }
    for (const q of b.players) {
      if ((q.role === 'FIRST CLEARER' || q.role === 'CLEANER') && q.down) downCleaners++;
    }
    if (b.stage === 'RUCK') {
      for (const q of b.players) {
        if (q.role !== 'CLEANER' && q.role !== 'FIRST CLEARER') continue;
        const p = d.L(q.team, q.num);
        cleanerFrames++;
        clipHist.set(p.clip, (clipHist.get(p.clip) ?? 0) + 1);
        if (p.clip === 'cleanout') cleanerCleanoutFrames++;
        const key = `${breakdownSerial}:${q.team}:${q.num}`;
        const dist = Math.hypot(p.x - b.contactX, p.z - b.contactZ);
        cleanerDist.push(dist);
        const prev = lastDist.get(key);
        if (prev !== undefined) {
          const closed = prev - dist;
          if (closed > 0.001) cleanerProgress += closed;
        }
        lastDist.set(key, dist);
      }
    }
  } else if (prevAny) {
    breakdowns++;
    durs.push(d.t - prevAny.at);
    prevAny = null;
    lastDist.clear();
  }
}

durs.sort((a, b) => a - b);
const q = (p: number) => durs.length ? durs[Math.floor(p * (durs.length - 1))].toFixed(2) : '—';
windowSamples.sort((a, b) => a - b);
const wtile = (p: number) => windowSamples.length ? windowSamples[Math.floor(p * (windowSamples.length - 1))].toFixed(2) : '—';
console.log(`=== BREAKDOWN AUDIT — seed ${seed} ===`);
console.log(`breakdowns           ${breakdowns}`);
console.log(`down cleaner frames  ${downCleaners} (expect 0)`);
console.log(`cleaner cleanout pct ${cleanerFrames ? (100 * cleanerCleanoutFrames / cleanerFrames).toFixed(1) : '—'}% of ${cleanerFrames} ruck frames`);
console.log(`clearout closure     ${cleanerProgress.toFixed(1)} m accumulated`);
const cm = [...clipHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
const cd = cleanerDist.length ? cleanerDist.reduce((a, b) => a + b, 0) / cleanerDist.length : 0;
console.log(`cleaner clips        ${cm.map(([k, v]) => `${k} ${Math.round(100 * v / cleanerFrames)}%`).join(', ')}`);
console.log(`cleaner dist to ball mean/max ${cd.toFixed(2)} m / ${cleanerDist.length ? Math.max(...cleanerDist).toFixed(2) : '—'} m`);
const csd = crewStartDist.length ? crewStartDist.reduce((a,b)=>a+b,0)/crewStartDist.length : 0;
console.log(`crew start-to-contact mean/max ${csd.toFixed(1)} m / ${crewStartDist.length?Math.max(...crewStartDist).toFixed(1):'—'} m  (>10m ${crewStartFar}/${crewStartDist.length})`);
console.log(`release window p50/p90/max ${wtile(0.5)}/${wtile(0.9)}/${wtile(1)} — slowBall(contestT>1s) ${slowBallAtRelease}/${windowSamples.length}`);
console.log(`release off-mark     ${releaseFar}/${releaseN} over 3.5 m, max ${releaseMax.toFixed(2)} m`);
for (const f of releaseFars.slice(-6)) console.log(`   far ${f.dist.toFixed(1)}m rm(${f.cx.toFixed(1)},${f.cz.toFixed(1)}) carrier#${f.num}(${f.carrierX.toFixed(1)},${f.carrierZ.toFixed(1)}) t=${f.t.toFixed(2)}`);
console.log(`duration p50/p90/p99 ${q(0.5)}/${q(0.9)}/${q(0.99)} mean ${(durs.reduce((a, b) => a + b, 0) / Math.max(1, durs.length)).toFixed(2)}`);
