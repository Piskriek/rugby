/**
 * SPEC_18.5 PROBE — angular velocity, measured before any math is proposed.
 *
 * Usage: npx vite-node scripts/spec185probe.ts [seconds] [difficulty]
 *
 * The centrifugal bias needs a turn rate. There are two candidate sources and
 * they are NOT equivalent, which is the whole point of this probe:
 *
 *   A. RAW TRAVEL HEADING  atan2(vx, vz) differentiated. This is the true
 *      direction of motion, but it is meaningless at low speed (a stationary
 *      player's heading is noise) and it spikes on the same teleports SPEC_18.3a
 *      already had to reject.
 *   B. THE RENDERER'S OWN pg.face. Already smoothed, but it is driven by THREE
 *      different targets (travel above 2.2 m/s, ball-look below, referee
 *      look-at) and switching between them injects step changes that are not
 *      real rotation.
 *
 * Read-only. Nothing here is wired into the renderer.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';

const seconds = Number(process.argv[2] ?? 90);
const diff = Number(process.argv[3] ?? 3);
const dt = 1 / 60;
const DEG = 180 / Math.PI;

const pct = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '  -');
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

interface Tr {
  x: number; z: number;
  head: number | null;      // raw travel heading
  face: number;             // replica of the renderer's smoothed facing
  emaW: number;             // EMA of turn rate
}
const last = new Map<string, Tr>();

const rawW: number[] = [];        // |raw heading rate| deg/s, moving only
const faceW: number[] = [];       // |pg.face rate| deg/s
const emaW: number[] = [];        // |filtered| deg/s
const rawWSlow: number[] = [];    // raw rate below the 2.2 m/s facing threshold
let frames = 0, moving = 0;
let spikes = 0, teleports = 0, modeFlips = 0;
let wasFast = new Map<string, boolean>();

/* Filter under test: reject teleports, EMA the heading rate. TAU matches the
 * SPEC_18.3a lean chain so the two read the same motion. */
const TAU = 0.35;
const MAX_STEP = 0.30;
const alpha = 1 - Math.exp(-dt / TAU);

seedRng(1);
const d = new Director(gateConfig(diff));
for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) {
  d.update(dt, NO_INPUT, new Set());
  frames++;
  for (const a of d.actors) {
    const k = `${a.team}${a.num}`;
    const prev = last.get(k);
    if (!prev) {
      last.set(k, { x: a.rx, z: a.rz, head: null, face: a.rf > 0 ? 0 : Math.PI, emaW: 0 });
      wasFast.set(k, false);
      continue;
    }
    const dx = a.rx - prev.x, dz = a.rz - prev.z;
    const stepped = Math.hypot(dx, dz);
    const vx = dx / dt, vz = dz / dt;
    const spd = Math.hypot(vx, vz);
    if (stepped > MAX_STEP) teleports++;

    /* --- A: raw travel heading rate --- */
    let head = prev.head;
    if (spd > 0.4) {
      const h = Math.atan2(vx, vz);
      if (prev.head !== null && stepped <= MAX_STEP) {
        const w = wrap(h - prev.head) / dt;
        const wd = Math.abs(w) * DEG;
        rawW.push(wd);
        if (spd <= 2.2) rawWSlow.push(wd);
        if (wd > 720) spikes++;
        moving++;
        /* --- C: the filtered signal --- */
        const e = prev.emaW + (w - prev.emaW) * alpha;
        prev.emaW = e;
        emaW.push(Math.abs(e) * DEG);
      }
      head = h;
    }

    /* --- B: replica of the renderer's pg.face, including its mode switch --- */
    let face = prev.face;
    const fast = spd > 2.2;
    if (fast) {
      const target = Math.atan2(vx, vz);
      face += wrap(target - face) * (1 - Math.exp(-dt * 10));
    }
    if (fast !== (wasFast.get(k) ?? false)) modeFlips++;
    wasFast.set(k, fast);
    faceW.push(Math.abs(wrap(face - prev.face)) / dt * DEG);

    last.set(k, { x: a.rx, z: a.rz, head, face, emaW: prev.emaW });
  }
}

console.log('=============== SPEC_18.5 PROBE ===============');
console.log('frames %s, moving samples %s, teleports %s, facing mode flips %s',
  frames, moving, teleports, modeFlips);

console.log('\n--- A. RAW TRAVEL-HEADING RATE (deg/s) ------------------');
for (const p of [50, 75, 90, 95, 99, 99.9, 100]) {
  console.log('  p%s  |w| = %s deg/s', String(p).padStart(5), f2(pct(rawW, p)));
}
console.log('  samples above 720 deg/s (2 rev/s, physically absurd): %s = %s%%',
  spikes, ((spikes / Math.max(1, rawW.length)) * 100).toFixed(3));
console.log('  BELOW the 2.2 m/s facing threshold, p99 = %s deg/s  <- noise floor',
  f2(pct(rawWSlow, 99)));

console.log('\n--- B. RENDERER pg.face RATE (deg/s) --------------------');
for (const p of [50, 90, 99, 100]) {
  console.log('  p%s  |w| = %s deg/s', String(p).padStart(5), f2(pct(faceW, p)));
}

console.log('\n--- C. AFTER EMA (tau = %s s) ---------------------------', TAU);
for (const p of [50, 75, 90, 95, 99, 100]) {
  console.log('  p%s  |w| = %s deg/s', String(p).padStart(5), f2(pct(emaW, p)));
}

const p99 = pct(emaW, 99), pmax = pct(emaW, 100);
console.log('\n--- D. IMPLIED SATURATION REFERENCE ---------------------');
console.log('  filtered p99  = %s deg/s = %s rad/s', f2(p99), f2(p99 / DEG));
console.log('  filtered max  = %s deg/s = %s rad/s', f2(pmax), f2(pmax / DEG));
console.log('  a W_REF near the p95-p99 puts normal running turns on the');
console.log('  linear part of tanh and reserves saturation for genuine jinks.');
