/**
 * SPEC_16 PROBE — environment scale, the before/after table.
 *
 * Usage:  npx vite-node scripts/spec16probe.ts [seconds] [difficulty]
 *
 * Measures, on real rendered frames at a fixed seed:
 *
 *   1. FIGURE / CROSSBAR — the headline ratio. Crossbar height in px is taken
 *      by projecting the real goalpost geometry; figure height in px is the
 *      measured ink bounding box of the actor's card. Both through the same
 *      lens on the same frame.
 *   2. FRAMING — visible pitch width and depth in logical metres at the
 *      viewport edges, which is the quantity the framing-loss ruling is about.
 *   3. PX-PER-METRE at three depths, to show what the lens is doing.
 *   4. SHADOW COHERENCE — drawn shadow radius vs the figure's own foot width.
 *      This is the quantity most at risk from a world-space scale change.
 *
 * Read-only with respect to the game: it renders into a recording context and
 * never writes a player.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { drawMatch } from '../src/render/scene';
import { project, type Camera, type View, FIELD } from '../src/render/retro';
import { Rec, SHADOW_FILL, pairFigures } from './spec14rec';
import { FIGURE_SCALE, BUILDS } from '../src/render/paper';

/** RENDER_SCALE if present, else 1 — lets the probe run before and after. */
import * as retro from '../src/render/retro';
const RS: number = (retro as unknown as { RENDER_SCALE?: number }).RENDER_SCALE ?? 1;

const seconds = Number(process.argv[2] ?? 90);
const diff = Number(process.argv[3] ?? 3);
const V: View = { w: 960, h: 540 };

const CROSSBAR_Y = 3.0, POST_HALF = 2.8, POST_Z = -50;

const med = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '   -');
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : '    -');

/** Where does the ground plane hit the left/right edge of the viewport?
 *  Bisect along a world ray at the camera's own depth to find the metre value
 *  whose projection lands on the edge. Returns logical metres. */
function visibleWidthM(cam: Camera, v: View): number {
  const probeAt = (wx: number, wz: number) => project(cam, v, wx, 0, wz);
  // sample the ground plane on a grid and take the extent of what lands on screen
  let lo = Infinity, hi = -Infinity;
  for (let z = FIELD.deadZ; z <= FIELD.deadZFar; z += 2) {
    for (let x = -120; x <= 120; x += 0.5) {
      const p = probeAt(x, z);
      if (!p) continue;
      if (p.sx >= 0 && p.sx <= v.w && p.sy >= 0 && p.sy <= v.h) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
  }
  return hi - lo;
}
function visibleDepthM(cam: Camera, v: View): number {
  let lo = Infinity, hi = -Infinity;
  for (let z = -140; z <= 140; z += 0.5) {
    for (let x = FIELD.minX; x <= FIELD.maxX; x += 5) {
      const p = project(cam, v, x, 0, z);
      if (!p) continue;
      if (p.sx >= 0 && p.sx <= v.w && p.sy >= 0 && p.sy <= v.h) {
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    }
  }
  return hi - lo;
}

const ratios: number[] = [];
const ratiosD: number[] = [];
const figPx: number[] = [];
const barPx: number[] = [];
const widths: number[] = [];
const depths: number[] = [];
const ppm: number[] = [];
const shadowOverFoot: number[] = [];
const drawnFigM: number[] = [];
let frames = 0, draws = 0, barSeen = 0;

for (const seed of [1, 7]) {
  seedRng(seed);
  const d = new Director(gateConfig(diff));
  for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    frames++;
    if (i % 12 !== 0) continue;
    draws++;

    const cam2: Camera = { ...d.cam, shake: 0 };
    const rec = new Rec();
    drawMatch(rec.asCtx(), d, V);

    // --- crossbar height in px, through the same lens ---
    /* project() consumes LOGICAL metres and applies RENDER_SCALE itself, so
     * these must NOT be pre-scaled or they land 1.65x out and off the lens. */
    const bTop = project(cam2, V, 0, CROSSBAR_Y, POST_Z);
    const bBot = project(cam2, V, 0, 0, POST_Z);
    let bar = NaN;
    if (bTop && bBot) { bar = bBot.sy - bTop.sy; if (bar > 2) { barPx.push(bar); barSeen++; } }

    // --- framing ---
    if (draws % 5 === 1) {
      widths.push(visibleWidthM(cam2, V));
      depths.push(visibleDepthM(cam2, V));
    }

    // --- figures ---
    for (const fg of pairFigures(rec, d, cam2, V)) {
      figPx.push(fg.inkH);
      drawnFigM.push(fg.inkH / (fg.sc * RS));   // sc is px per SCALED metre
      ppm.push(fg.sc);
      /* DEPTH-CORRECTED. The raw px ratio compares a figure at its own depth
       * against posts fixed at z = -50, so perspective alone moves it. The
       * honest quantity is drawn height in LOGICAL metres over the true 3.0 m
       * crossbar — both measured at the figure's own depth. */
      if (Number.isFinite(bar) && bar > 2) ratios.push(fg.inkH / bar);
      ratiosD.push((fg.inkH / (fg.sc * RS)) / CROSSBAR_Y);
      if (fg.rxM > 0) shadowOverFoot.push((fg.rxM * 2) / (fg.inkW / fg.sc));   // both in scaled metres — ratio is unit-free
    }
  }
}

console.log('================ SPEC_16 PROBE ================');
console.log('RENDER_SCALE in retro.ts : %s', RS === 1 ? '1 (absent — BEFORE run)' : String(RS));
console.log('FIGURE_SCALE in paper.ts : %s', FIGURE_SCALE);
console.log('frames simulated %s, frames drawn %s, crossbar visible on %s', frames, draws, barSeen);

console.log('\n--- 1. THE HEADLINE RATIO -------------------------------');
console.log('median crossbar height        : %s px', f2(med(barPx)));
console.log('median figure ink height      : %s px', f2(med(figPx)));
console.log('median FIGURE / CROSSBAR (raw px, mixed depth) : %s', f3(med(ratios)));
console.log('median FIGURE / CROSSBAR (DEPTH-CORRECTED)     : %s   <-- the real number', f3(med(ratiosD)));
console.log('  target 0.62 = a 1.86 m man against a 3.0 m bar, standing upright.');
console.log('  A running figure is SHORTER than his standing height (hip dip +');
console.log('  forward lean), so a gait-weighted median sits below 0.62 by design.');
console.log('  reference, from build table :');
for (const k of ['HALF', 'CENTRE', 'LOCK'] as const) {
  console.log('    %s authored %s m -> drawn %s m ; vs 3.0 m bar = %s',
    k.padEnd(7), BUILDS[k].h.toFixed(2),
    (BUILDS[k].h * FIGURE_SCALE / RS).toFixed(2),
    ((BUILDS[k].h * FIGURE_SCALE / RS) / 3.0).toFixed(3));
}

console.log('\n--- 2. FRAMING (the ruling: must not change) ------------');
console.log('median visible pitch WIDTH    : %s logical m', f2(med(widths)));
console.log('median visible pitch DEPTH    : %s logical m', f2(med(depths)));

console.log('\n--- 3. LENS ---------------------------------------------');
console.log('median px-per-LOGICAL-metre at actors : %s', f2(med(ppm) * RS));
console.log('median px-per-scaled-metre (raw sc)   : %s', f2(med(ppm)));
console.log('median drawn figure height    : %s m of ink (authored ~1.86)', f3(med(drawnFigM)));

console.log('\n--- 4. SHADOW COHERENCE ---------------------------------');
console.log('median shadow diameter / figure silhouette width : %s', f3(med(shadowOverFoot)));
console.log('(this must NOT move; if it does, the world-space scale has');
console.log(' decoupled the shadow from the figure it belongs to)');
console.log('=========================================================');
