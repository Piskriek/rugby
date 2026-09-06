/**
 * TACKLE EPISODE AUDIT — the part of the tackle BEFORE the ruck.
 *
 * The breakdown audit owns the ruck itself. This probe owns the latch-and-drag
 * and the seconds around it: how long a tackle hangs, how far the pair is
 * dragged, whether the defender or the carrier is ever moved in a way that
 * reads as a teleport/jank, and how the surrounding defence converges (the
 * "players janking out around a tackle" complaint).
 *
 * Usage: npx vite-node scripts/tackleAudit.ts [seed] [seconds] [difficulty]
 */
import { Director } from '../src/game/director';
import { botInput, BotState } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seed = Number(process.argv[2] ?? 5);
const seconds = Number(process.argv[3] ?? 100);
const difficulty = Number(process.argv[4] ?? 3);
seedRng(seed);

const d = new Director(gateConfig(difficulty));
const st: BotState = { wait: 0.3, flip: 0, presses: 0, releases: 0 };
const dt = 1 / 60;

let latches = 0;
let strips = 0;
let stripAttempts = 0;
let latchFrames = 0;
let activeTried = false;
let activeAtkTeam: 'A'|'B'|'' = '';
let latchDuration = 0;
let totalDragged = 0;
const durations: number[] = [];

let prevCarrier: { x: number; z: number } | null = null;
let prevTackler: { x: number; z: number } | null = null;
let activeCarrier = '';
let activeTackler = '';
let activeT = 0;
let activeDragged = 0;
let maxCarrierStep = 0;
let maxTacklerStep = 0;
let maxBystanderStep = 0;
let bystanderJank = 0;
let crowdFrames = 0;
let activeStart = 0;
let carrierReversals = 0;
let prevCarrierVz = 0;
let prevCarrierVx = 0;

let prevPos = new Map<string, { x: number; z: number; vz: number; vx: number }>();

function playerTag(p: { team: string; num: number }) {
  return `${p.team}:${p.num}`;
}

for (let i = 0; i < seconds * 60; i++) {
  const { inp, pressed } = botInput(d, dt, st);
  const tNow = i / 60;

  const op = d.op;
  const latch = op?.latch;
  const carrier = latch ? d.L(latch.carrierTeam, latch.carrierNum) : null;
  const tackler = latch ? d.L(latch.tacklerTeam, latch.tacklerNum) : null;

  /* --- capture previous positions before update --- */
  const previous = new Map<string, { x: number; z: number; vz: number; vx: number }>();
  for (const p of d.live) {
    previous.set(playerTag(p), { x: p.x, z: p.z, vz: p.vz, vx: p.vx });
  }

  d.update(dt, inp, pressed);

  /* --- new latch --- */
  const latch2 = d.op?.latch;
  if (latch2 && !activeCarrier) {
    latches++;
    activeStart = tNow;
    activeCarrier = playerTag({ team: latch2.carrierTeam, num: latch2.carrierNum });
    activeTackler = playerTag({ team: latch2.tacklerTeam, num: latch2.tacklerNum });
    activeAtkTeam = latch2.carrierTeam;
    activeTried = false;
    activeT = 0;
    activeDragged = 0;
    maxCarrierStep = 0;
    maxTacklerStep = 0;
    maxBystanderStep = 0;
    bystanderJank = 0;
    carrierReversals = 0;
    prevCarrier = null;
    prevTackler = null;
    prevCarrierVz = 0;
    prevCarrierVx = 0;
  }

  /* --- update a live latch --- */
  if (latch2 && activeCarrier) {
    latchFrames++;
    if (latch2.stripTried && !activeTried) { stripAttempts++; activeTried = true; }
    activeT += dt;
    // find live
    const c = d.live.find((p) => playerTag(p) === activeCarrier);
    const tk = d.live.find((p) => playerTag(p) === activeTackler);
    if (c && prevCarrier) {
      const step = Math.hypot(c.x - prevCarrier.x, c.z - prevCarrier.z);
      maxCarrierStep = Math.max(maxCarrierStep, step);
      // direction reversal: sign flips of the downfield velocity component
      if (c.vz * prevCarrierVz < -0.001) carrierReversals++;
    }
    if (tk && prevTackler) {
      maxTacklerStep = Math.max(maxTacklerStep, Math.hypot(tk.x - prevTackler.x, tk.z - prevTackler.z));
    }
    if (c) { prevCarrier = { x: c.x, z: c.z }; prevCarrierVz = c.vz; prevCarrierVx = c.vx; }
    if (tk) prevTackler = { x: tk.x, z: tk.z };
    activeDragged = latch2.dragged;

    /* defenders around the tackle: how many are close, and do any of them
     * take an implausibly large step while the grab is happening? */
    if (c) {
      const others = d.live
        .filter((p) => p.team !== c.team && playerTag(p) !== activeTackler)
        .map((p) => ({ p, dist: Math.hypot(p.x - c.x, p.z - c.z) }))
        .filter((o) => o.dist < 10)
        .sort((a, b) => a.dist - b.dist);
      crowdFrames++;
      for (const o of others.slice(0, 5)) {
        const was = previous.get(playerTag(o.p) as any) as any;
        const now = d.live.find((q) => playerTag(q) === playerTag(o.p)) as any;
        if (was && now) {
          const step = Math.hypot(now.x - was.x, now.z - was.z);
          maxBystanderStep = Math.max(maxBystanderStep, step);
          if (step > 0.8) bystanderJank++;
        }
      }
    }
  }

  /* --- latch ended --- */
  if (!latch2 && activeCarrier) {
    if (d.op && d.op.attacking !== activeAtkTeam && d.op.carrierNum) strips++;
    durations.push(activeT);
    latchDuration += activeT;
    totalDragged += activeDragged;
    activeCarrier = '';
    activeTackler = '';
    activeT = 0;
    activeDragged = 0;
  }
}

const n = durations.length || 1;
const sorted = [...durations].sort((a, b) => a - b);
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
console.log(`=== TACKLE EPISODE AUDIT — seed ${seed} diff ${difficulty} ${seconds}s ===`);
console.log(`latches              ${latches}   strips ${strips}  attempts ${stripAttempts}`);
console.log(`latch frames         ${latchFrames} (${(latchFrames / (seconds * 60)).toFixed(1)}% of sim)`);
console.log(`latch duration p50/p90/max ${pct(0.5).toFixed(2)}/${pct(0.9).toFixed(2)}/${pct(1).toFixed(2)}  mean ${(latchDuration / n).toFixed(2)}`);
console.log(`latch drag mean/max  ${(totalDragged / n).toFixed(2)} m / ${totalDragged.toFixed(2)} m total`);
console.log(`max carrier frame step ${maxCarrierStep.toFixed(3)} m (teleport line 0.8)`);
console.log(`max tackler frame step ${maxTacklerStep.toFixed(3)} m (teleport line 0.8)`);
console.log(`max bystander step   ${maxBystanderStep.toFixed(3)} m in ${crowdFrames} crowd-frames`);
console.log(`bystander jank steps (>0.8 m) ${bystanderJank}`);
console.log(`carrier vz reversals ${carrierReversals}`);
// strip counters appended
