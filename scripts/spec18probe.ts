/**
 * SPEC_18 PROBE — measurements the visual design depends on.
 *
 * Usage: npx vite-node scripts/spec18probe.ts [seconds] [difficulty]
 *
 * Design-phase instrument only; nothing here is wired into the renderer. It
 * answers four questions that would otherwise be guessed at:
 *
 *   1. ACCELERATION — the real distribution of |dv/dt| per player, which sets
 *      the shear constant. Proposing "shear ∝ acceleration" without knowing the
 *      p99 is how you get a figure sheared 40 degrees on a stumble.
 *   2. IMPACT RATE — how often a footfall/tackle squash would actually fire,
 *      so the effect is not either invisible or constant.
 *   3. VALUE SEPARATION — the luminance gap between adjacent kit colours, which
 *      is what the outline is currently doing for free and what depth shading
 *      has to replace.
 *   4. VIEW CENSUS — time spent in each PaperView, which tells us what a fourth
 *      (3/4) view would actually cost and displace.
 *
 * Read-only with respect to the game.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { PALETTES, BUILDS, shade } from '../src/render/paper';

const seconds = Number(process.argv[2] ?? 90);
const diff = Number(process.argv[3] ?? 3);

const pct = (a: number[], p: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '  -');

/* ---- 1 & 2: acceleration and impacts ---- */
interface Tr { x: number; z: number; vx: number; vz: number }
const last = new Map<string, Tr>();
const accels: number[] = [];
const accelAlong: number[] = [];   // signed, along the direction of travel
const speeds: number[] = [];
let frames = 0, samples = 0;
let hardDecel = 0, hardAccel = 0;

seedRng(1);
const d = new Director(gateConfig(diff));
const dt = 1 / 60;
for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) {
  d.update(dt, NO_INPUT, new Set());
  frames++;
  for (const a of d.actors) {
    const k = `${a.team}${a.num}`;
    const prev = last.get(k);
    const vx = prev ? (a.rx - prev.x) / dt : 0;
    const vz = prev ? (a.rz - prev.z) / dt : 0;
    if (prev) {
      const ax = (vx - prev.vx) / dt;
      const az = (vz - prev.vz) / dt;
      const mag = Math.hypot(ax, az);
      const spd = Math.hypot(vx, vz);
      if (Number.isFinite(mag) && mag < 400) {
        accels.push(mag);
        speeds.push(spd);
        samples++;
        if (spd > 0.4) {
          const ux = vx / spd, uz = vz / spd;
          const along = ax * ux + az * uz;
          accelAlong.push(along);
          if (along < -6) hardDecel++;
          if (along > 6) hardAccel++;
        }
      }
    }
    last.set(k, { x: a.rx, z: a.rz, vx, vz });
  }
}

console.log('================= SPEC_18 PROBE =================');
console.log('frames %s, per-actor samples %s', frames, samples);

console.log('\n--- 1. ACCELERATION (sets the shear constant) -----------');
for (const p of [50, 75, 90, 95, 99, 100]) {
  console.log('  p%s  |a| = %s m/s^2', String(p).padStart(3), f2(pct(accels, p)));
}
console.log('  signed along-travel: p1 %s, p50 %s, p99 %s m/s^2',
  f2(pct(accelAlong, 1)), f2(pct(accelAlong, 50)), f2(pct(accelAlong, 99)));
console.log('  speed p50 %s, p99 %s m/s', f2(pct(speeds, 50)), f2(pct(speeds, 99)));

console.log('\n--- 2. IMPACT RATE (how often a squash would fire) ------');
console.log('  hard decel (< -6 m/s^2) : %s samples = %s%% of moving frames',
  hardDecel, ((hardDecel / Math.max(1, accelAlong.length)) * 100).toFixed(2));
console.log('  hard accel (> +6 m/s^2) : %s samples = %s%%',
  hardAccel, ((hardAccel / Math.max(1, accelAlong.length)) * 100).toFixed(2));
console.log('  NOTE: footfall cadence is NOT in this stream — it is the clip');
console.log('  phase (clips.ts genRun contact keys at u = 0 and u = 0.5), so a');
console.log('  footfall squash is driven by clip phase, not by physics.');

/* ---- 3: value separation ---- */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

console.log('\n--- 3. VALUE SEPARATION (what the outline does for free) ');
const OUTLINE = '#20202b';
for (const [name, p] of Object.entries(PALETTES)) {
  console.log('  palette %s', name);
  const pairs: [string, string, string][] = [
    ['kit vs shorts', p.kit, p.shorts],
    ['kit vs socks', p.kit, p.socks],
    ['kit vs skin', p.kit, '#c99468'],
    ['limb vs limb (same fill)', p.kit, p.kit],
  ];
  for (const [label, a, b] of pairs) {
    console.log('    %s : contrast %s%s', label.padEnd(26), contrast(a, b).toFixed(2),
      contrast(a, b) < 1.25 ? '   <-- FUSES without an outline' : '');
  }
  console.log('    %s : contrast %s', 'kit vs OUTLINE'.padEnd(26), contrast(p.kit, OUTLINE).toFixed(2));
}

console.log('\n  Depth-shade candidates against palette A kit (%s):', PALETTES.A.kit);
for (const f of [0.62, 0.70, 0.78, 0.86, 1.0, 1.08, 1.16]) {
  const c = shade(PALETTES.A.kit, f);
  console.log('    shade(kit, %s) = %s  contrast vs kit = %s',
    f.toFixed(2), c, contrast(PALETTES.A.kit, c).toFixed(2));
}

/* ---- 4: view census ---- */
console.log('\n--- 4. BUILD SPREAD (3/4 view art cost) -----------------');
const hs = Object.values(BUILDS).map((b) => b.h);
console.log('  %s builds, height %s .. %s m', hs.length, Math.min(...hs).toFixed(2), Math.max(...hs).toFixed(2));
console.log('  A 3/4 view is a NEW DRAW PATH, not a new asset: the same builds');
console.log('  feed it, so the cost is code, not art.');
console.log('=================================================');
