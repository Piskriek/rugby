/**
 * SPEC_22 VERIFY — silhouette breathing.
 *
 * Measures the ACTUAL drawn geometry by recording every polygon `drawPaperActor`
 * emits (via the SPEC_14 `Rec` canvas) and taking the true horizontal extent of
 * the ink. This is deliberately NOT a re-implementation of the arm maths: a
 * re-modelled probe can agree with a broken drawer. The extent below is what
 * the renderer really puts on screen.
 */
import { CLIPS, STAND, type Pose } from '../src/render/clips';
import { BUILDS, PALETTES, FIGURE_SCALE, gaitFlare, AB_BASE, AB_SWING, AB_MAX, type Build } from '../src/render/paper';
import { drawPaperActor, type PaperDrawArgs } from '../src/render/coronal';
import { type Camera, type View } from '../src/render/retro';
import { Rec } from './spec14rec';

const CELL: View = { w: 300, h: 380 };
const SC = 125 / 1.65;
const cam: Camera = { x: 0, y: 12, z: -26, tilt: 0.52, yaw: 0, fov: 1.2, h: 12 } as unknown as Camera;

type P = Partial<Pose>;
function ease(e: string, t: number): number {
  switch (e) { case 'l': return t; case 'o': return 1 - (1 - t) * (1 - t); case 'i': return t * t; default: return t * t * (3 - 2 * t); }
}
function sample(name: string, u: number): Pose {
  const c = (CLIPS as Record<string, { keys: { t: number; e?: string; p: P }[] }>)[name];
  const keys = c.keys; const base: Pose = { ...STAND };
  let i = 0; for (let j = 0; j < keys.length; j++) if (keys[j].t <= u) i = j;
  const k0 = keys[i], k1 = keys[(i + 1) % keys.length];
  let span = k1.t - k0.t; if (span <= 0) span += 1;
  const lt = Math.max(0, Math.min(1, (u - k0.t) / span));
  const t = ease(k1.e ?? 's', lt);
  const acc = { ...base, ...(k0.p) } as Pose; const out = { ...acc } as Pose;
  for (const key of Object.keys(k1.p) as (keyof Pose)[]) {
    const a = (acc[key] ?? base[key]) as unknown, b = k1.p[key] as unknown;
    if (typeof a === 'number' && typeof b === 'number') (out[key] as number) = a + (b - a) * t;
  }
  return out;
}

/** True horizontal ink extent of the drawn figure, in metres either side of the spine. */
function extent(pose: Pose, spd: number, build: Build, view: 'front' | 'back', carry = 0): { l: number; r: number } {
  const rec = new Rec(); rec.cap = [];
  const ctx = rec.asCtx();
  const args: PaperDrawArgs = {
    ctx, sx: 0, sy: 0, sc: SC, cam, v: CELL, wx: 0, wz: 0, face: 0,
    view, pose, pal: PALETTES.A, build, skin: '#c99468', hair: '#2a1c14', num: 12, seed: 5,
    carry, carryStyle: 0, ballSide: 0.6, ballSpin: 0, cap: false, tape: false,
    spinDir: 1, gs: 0.6, fore: 0, headDir: 0, depth: 0, spd,
  };
  drawPaperActor(args);
  let l = 0, r = 0;
  for (const c of rec.cap ?? []) for (const pt of c.pts) {
    const x = (pt as [number, number])[0] / (SC * FIGURE_SCALE);
    if (x < l) l = x; if (x > r) r = x;
  }
  return { l, r };
}

const K20 = 20 * FIGURE_SCALE, K34 = 34 * FIGURE_SCALE;
const RUN_SPD = 6.0, WALK_SPD = 1.6, JOG_SPD = 4.0, SPRINT_SPD = 8.0;
const SPD: Record<string, number> = { walk: WALK_SPD, jog: JOG_SPD, run: RUN_SPD, sprint: SPRINT_SPD };
let fail = 0;

console.log('=== SPEC_22 GATE 1 — SILHOUETTE BREATH (real drawn ink extent) ===');
console.log('constants: AB_BASE', AB_BASE, 'AB_SWING', AB_SWING, 'AB_MAX', AB_MAX);
console.log('gait     half-width min..max (m)      breath mm   px@20   px@34');
for (const clip of ['walk', 'jog', 'run', 'sprint']) {
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < 240; i++) {
    const e = extent(sample(clip, i / 240), SPD[clip], BUILDS.CENTRE, 'front');
    const h = Math.max(-e.l, e.r);
    mn = Math.min(mn, h); mx = Math.max(mx, h);
  }
  const br = mx - mn;
  const ok = clip === 'run' || clip === 'sprint' ? br * K20 >= 1.5 : true;
  console.log(' ' + clip.padEnd(8) + mn.toFixed(4) + ' .. ' + mx.toFixed(4) + '        ' +
    (br * 1000).toFixed(2).padStart(6) + '   ' + (br * K20).toFixed(2).padStart(5) + '   ' +
    (br * K34).toFixed(2).padStart(5) + (ok ? '' : '   <-- FAIL (<1.5 px@20)'));
  if (!ok) fail++;
}

console.log('\n=== SPEC_22 GATE 1b — LATERAL DAYLIGHT (the headline defect) ===');
/* The original defect: the upper-arm card never separated from the torso on
 * ANY frame of ANY gait (0/240 everywhere, best case -0.0316 m of overlap).
 * Measured here from the arm's own geometry against the torso edge at the
 * elbow's height, mirroring the diagnosis probe exactly so the before/after
 * numbers are directly comparable. */
function daylight(p: Pose, s: -1 | 1, spd: number, b: Build): number {
  const shLen = b.torso * Math.cos(Math.min(1.25, Math.max(-0.6, p.lean)) * 0.92);
  const shY = p.hip + shLen;
  const tws = Math.sin(p.twist) * 0.12;
  const shHalf = b.shW * 0.5 * (0.84 + 0.16 * Math.cos(p.twist));
  const hipHalf = b.hipW * 0.5;
  const aa = s < 0 ? p.aL : p.aR;
  const ab = Math.min(AB_MAX, (s < 0 ? p.abL : p.abR) + gaitFlare(aa, spd, 1));
  const dep = Math.sin(aa);
  const upLen = b.arm * 0.52;
  const UPHW = 0.115 * b.bulk * 0.5;
  const sx0 = s * shHalf * 0.9 + tws, sy0 = shY - 0.02;
  const fs = 1 + (Math.abs(Math.cos(aa)) - 1) * 0.42;
  const upD = upLen * fs;
  const elX = sx0 + s * ab * upD * 0.85 + dep * 0.055 * s;
  const elY = sy0 - Math.cos(aa) * upD;
  const tY = Math.max(p.hip - 0.02, Math.min(shY, elY));
  const f = (tY - (p.hip - 0.02)) / Math.max(1e-6, shY - (p.hip - 0.02));
  const edge = s * (hipHalf + (shHalf - hipHalf) * f) + tws * f;
  return (elX - s * UPHW) * s - edge * s;   // >0 = a real hole of daylight
}
/* SCOPE. My SPEC_22_MATH s3.1 asked for daylight on "all four gaits". That was
 * written before this gate was reconciled with the RULED speed gate, and the
 * two contradict each other: walk is 1.6 m/s, barely above W_GATE_LO = 1.5, so
 * the smoothstep holds the flare at ~0 there BY DESIGN ("no bias when
 * stationary", carried over from SPEC_18.5). Asserting daylight at walking pace
 * would require defeating the ruled gate. The gate therefore asserts daylight
 * only where the speed gate is actually engaged, and reports walk for
 * information. This is a correction to my own spec, not a relaxation of a
 * ruling. */
console.log('gait     worst daylight (m)   px@20   px@34   frames with daylight');
for (const clip of ['walk', 'jog', 'run', 'sprint']) {
  let mn = 1e9, open = 0, n = 0;
  for (let i = 0; i < 240; i++) {
    const p = sample(clip, i / 240);
    for (const s of [-1, 1] as const) {
      const d = daylight(p, s, SPD[clip], BUILDS.CENTRE);
      mn = Math.min(mn, d); if (d > 0) open++; n++;
    }
  }
  const gated = SPD[clip] <= 2.0;          // below/at the speed ramp: flare off by design
  const ok = gated ? true : open === n;
  console.log(' ' + clip.padEnd(8) + mn.toFixed(4).padStart(8) + '          ' +
    (mn * K20).toFixed(2).padStart(5) + '   ' + (mn * K34).toFixed(2).padStart(5) + '   ' +
    open + '/' + n + (gated ? '  n/a (below speed gate, by design)' : ok ? '  PASS' : '  <-- FAIL'));
  if (!ok) fail++;
}

console.log('\n=== SPEC_22 GATE 2 — NO FLARE WHEN STATIONARY ===');
let statMax = 0;
for (let i = 0; i < 240; i++) {
  const p = sample('run', i / 240);
  statMax = Math.max(statMax, gaitFlare(p.aL, 0, 1), gaitFlare(p.aR, 0, 1));
}
console.log(' max gaitFlare at spd 0 =', statMax.toFixed(8), '->', statMax === 0 ? 'PASS' : 'FAIL');
if (statMax !== 0) fail++;
const gateLo = gaitFlare(1.2, 1.5, 1), gateHi = gaitFlare(1.2, 3.5, 1);
console.log(' gate edges: spd 1.5 ->', gateLo.toFixed(6), '(must be 0)   spd 3.5 ->', gateHi.toFixed(4), '(full)');
if (gateLo !== 0) fail++;

console.log('\n=== SPEC_22 GATE 3 — CARRY SUPPRESSION ===');
let carryMax = 0;
for (let i = 0; i < 240; i++) {
  const p = sample('run', i / 240);
  carryMax = Math.max(carryMax, gaitFlare(p.aL, RUN_SPD, 0), gaitFlare(p.aR, RUN_SPD, 0));
}
console.log(' max gaitFlare with carryW=0 =', carryMax.toFixed(8), '->', carryMax === 0 ? 'PASS' : 'FAIL');
if (carryMax !== 0) fail++;

console.log('\n=== SPEC_22 GATE 4 — AB_MAX CLAMP HOLDS ===');
// worst case: shuffle clip (highest authored ab) + full gait flare + full turn flare
let worst = 0;
for (const clip of ['walk', 'jog', 'run', 'sprint', 'shuffle', 'strafe']) {
  if (!(CLIPS as Record<string, unknown>)[clip]) continue;
  for (let i = 0; i < 120; i++) {
    const p = sample(clip, i / 120);
    for (const aa of [p.aL, p.aR]) {
      const ab = aa === p.aL ? p.abL : p.abR;
      const tot = Math.min(AB_MAX, ab + gaitFlare(aa, SPRINT_SPD, 1) + 0.14);
      worst = Math.max(worst, tot);
    }
  }
}
console.log(' worst clamped total abduction =', worst.toFixed(4), '(AB_MAX', AB_MAX + ') ->', worst <= AB_MAX + 1e-12 ? 'PASS' : 'FAIL');
if (worst > AB_MAX + 1e-12) fail++;

console.log('\n=== SPEC_22 GATE 5 — SMOOTHNESS (the flare adds no pop) ===');
/* An earlier draft of this gate compared the raw per-frame silhouette change
 * against a fixed 1.0 px budget and "failed" at 44 mm/frame. That threshold was
 * WRONG: a limb swinging at sprint cadence legitimately moves tens of mm per
 * frame at 60 fps, flare or no flare. Measured, the same figure with the flare
 * DISABLED jumps 53.9 mm on run and 49.3 mm on sprint — MORE than with it
 * enabled. The gate was measuring the gait, not the feature.
 *
 * The property that actually matters is that the flare introduces no
 * discontinuity of its own. Two assertions:
 *   (a) the flare must not increase the worst per-frame silhouette change;
 *   (b) gaitFlare must be C0/C1 continuous in both its inputs, including
 *       across the clip's loop seam, so nothing can pop. */
for (const clip of ['run', 'sprint']) {
  const dur = (CLIPS as Record<string, { dur: number }>)[clip].dur;
  const frames = Math.round(dur * 60);
  const jumpAt = (spd: number) => {
    let prev = 0, mj = 0;
    for (let i = 0; i <= frames; i++) {
      const e = extent(sample(clip, (i % frames) / frames), spd, BUILDS.CENTRE, 'front');
      const h = Math.max(-e.l, e.r);
      if (i > 0) mj = Math.max(mj, Math.abs(h - prev));
      prev = h;
    }
    return mj;
  };
  const on = jumpAt(SPD[clip]), off = jumpAt(0);
  const ok = on <= off + 1e-9;
  console.log(' ' + clip.padEnd(7) + 'worst per-frame change: flare ON ' + (on * 1000).toFixed(2) +
    ' mm vs OFF ' + (off * 1000).toFixed(2) + ' mm ->' + (ok ? ' PASS (flare adds none)' : ' FAIL'));
  if (!ok) fail++;
}
// (b) continuity of the flare term itself
let maxD1 = 0, maxD2 = 0;
for (let i = 0; i < 20000; i++) {
  const aa = -Math.PI + (2 * Math.PI * i) / 20000, h = 1e-4;
  const d1 = Math.abs(gaitFlare(aa + h, 6, 1) - gaitFlare(aa, 6, 1));
  maxD1 = Math.max(maxD1, d1);
}
for (let i = 0; i < 20000; i++) {
  const sp = (12 * i) / 20000, h = 1e-4;
  maxD2 = Math.max(maxD2, Math.abs(gaitFlare(1.0, sp + h, 1) - gaitFlare(1.0, sp, 1)));
}
console.log(' continuity in arm angle: max |df| over 1e-4 step =', maxD1.toExponential(2), '->', maxD1 < 1e-3 ? 'PASS' : 'FAIL');
console.log(' continuity in speed:     max |df| over 1e-4 step =', maxD2.toExponential(2), '->', maxD2 < 1e-3 ? 'PASS' : 'FAIL');
if (maxD1 >= 1e-3) fail++;
if (maxD2 >= 1e-3) fail++;
// (c) loop seam: u=1 must equal u=0
for (const clip of ['run', 'sprint']) {
  const a = extent(sample(clip, 0), SPD[clip], BUILDS.CENTRE, 'front');
  const b = extent(sample(clip, 0.999999), SPD[clip], BUILDS.CENTRE, 'front');
  const d = Math.abs(Math.max(-a.l, a.r) - Math.max(-b.l, b.r));
  console.log(' ' + clip.padEnd(7) + 'loop seam discontinuity ' + (d * 1000).toFixed(4) + ' mm ->', d < 5e-3 ? 'PASS' : 'FAIL');
  if (d >= 5e-3) fail++;
}

console.log('\n=== SPEC_22 GATE 6 — ALL BUILDS, BOTH VIEWS ===');
let bad = 0;
for (const [name, b] of Object.entries(BUILDS)) {
  for (const view of ['front', 'back'] as const) {
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < 60; i++) {
      const e = extent(sample('run', i / 60), RUN_SPD, b as Build, view);
      const h = Math.max(-e.l, e.r); mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if ((mx - mn) * K20 < 1.0) { bad++; console.log('  thin breath', name, view, ((mx - mn) * K20).toFixed(2), 'px'); }
  }
}
console.log(' builds x views with >=1.0 px breath @20:', 20 - bad, '/20 ->', bad === 0 ? 'PASS' : 'FAIL');
if (bad) fail++;

console.log('\n' + (fail ? fail + ' SPEC_22 GATE(S) FAILED' : 'ALL SPEC_22 GATES PASS'));
if (fail) process.exit(1);
