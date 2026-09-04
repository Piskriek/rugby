/**
 * SPEC_14 PROBE — figure scale and the shadow anchor.
 *
 * Usage:  npx vite-node scripts/spec14probe.ts [seconds] [difficulty]
 *
 * Two questions, both answered by measurement rather than by reading the code
 * and guessing.
 *
 *   PHASE 1 — SCALE. The complaint is that players LOOK massive: their drawn
 *   edges touch while their coordinate centres are still outside the tackle
 *   radius. The quantity that matters is not the authored height (the builds
 *   are already true at 1.76-1.98 m); it is the DRAWN silhouette, in metres,
 *   at the depth the player actually occupies. This renders real frames
 *   through a recording 2D context, takes the ink bounding box, and divides by
 *   that actor's own px-per-metre to put the silhouette back into world units.
 *
 *   PHASE 2 — THE SHADOW. Three candidate causes were offered: z-sorting, a
 *   local-coordinate offset, or the papercraft bob disagreeing with the shadow
 *   plane. Each gets its own test, and the ellipse shape is checked against a
 *   GROUND TRUTH computed by projecting a real circle on the turf through the
 *   same lens — not against an assumed formula.
 *
 * Read-only with respect to the game: it renders, it never draws to a real
 * canvas and it never writes a player.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { drawMatch } from '../src/render/scene';
import { project, type Camera, type View } from '../src/render/retro';
import { Rec, SHADOW_FILL, pairFigures, type Figure } from './spec14rec';
import { FIGURE_SCALE } from '../src/render/paper';
import { BUILDS, POS_OF_NUM } from '../src/render/paper';

/* ------------------------------------------------------------------ *
 * A recording 2D context: every fill/stroke is reduced to a screen-space
 * bounding box under the current transform, so the numbers are the ink a
 * real canvas would have produced.
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 * Pairing: drawPaperShadow is immediately followed by drawPaperActor for
 * the SAME actor (scene.ts pushes one closure calling both), so each
 * shadow fill owns every op until the next one.
 * ------------------------------------------------------------------ */

const seconds = Number(process.argv[2] ?? 120);
const diff = Number(process.argv[3] ?? 3);
const V: View = { w: 960, h: 540 };

const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

const RIGS = [
  { label: 'high/steep', h: 34, tilt: 0.85, fov: 0.42 },
  { label: 'mid (cable)', h: 13, tilt: 0.42, fov: 0.42 },
  { label: 'low/shallow', h: 6, tilt: 0.20, fov: 0.42 },
];

const widths: number[] = [], heights: number[] = [], gapYs: number[] = [], gapXs: number[] = [];
const carrierH: number[] = [], nearestH: number[] = [], carrierW: number[] = [];
const drawnHeightM: number[] = [];          // validation: ink height / px-per-metre
/** screen-space gap between two figures, bucketed by their true world distance */
const screenGap = new Map<string, number[]>();
const bucket = (d: number) => d < 0.85 ? 'under 0.85 m' : d < 1.15 ? '0.85-1.15 m (TACKLE)' : d < 1.6 ? '1.15-1.6 m' : 'over 1.6 m';
/** Every pair inside 1.6 m: world distance, screen gap, and how much of the
 *  separation lies across the lens (1 = side by side, 0 = one behind the other). */
interface Pair { wd: number; gap: number; across: number; screenDist: number; w1: number; w2: number; sc: number }
const pairs: Pair[] = [];
const frontW: number[] = [], profileW: number[] = [];
const byRig = RIGS.map(() => ({ gapY: [] as number[], flat: [] as number[], truth: [] as number[] }));
const perActorGap = new Map<string, number[]>();
const byBuild = new Map<string, number[]>();

let contactFrames = 0, shielded = 0, nearestBeaten = 0, frames = 0, draws = 0, kept = 0, clipOps = 0;

for (const seed of [1, 7]) {
  seedRng(seed);
  const d = new Director(gateConfig(diff));
  for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    frames++;

    const op = d.op;
    if (d.phase === 'OPEN_PLAY' && op) {
      const car = d.L(op.attacking, op.carrierNum);
      const dTeam = op.attacking === 'A' ? 'B' : 'A';
      const ds = d.live
        .filter((p) => p.team === dTeam && p.sinbin <= 0)
        .map((p) => ({ p, dd: Math.hypot(p.x - car.x, p.z - car.z) }))
        .sort((a, b) => a.dd - b.dd);
      const near = ds[0];
      if (near && near.dd < 1.1) {
        contactFrames++;
        if (near.p.beatenT > 0) {
          nearestBeaten++;
          if (ds.some((o) => o.dd < 1.1 && o.p.beatenT <= 0)) shielded++;
        }
      }
    }

    if (i % 6 !== 0) continue;
    draws++;
    const real = d.cam;
    const cam2: Camera = { ...real, shake: 0 };

    const rec = new Rec();
    drawMatch(rec.asCtx(), d, V);
    clipOps += rec.clips;
    const carrierKey = op ? `${op.attacking}${op.carrierNum}` : '';
    let nearest: Figure | null = null;
    for (const fg of pairFigures(rec, d, cam2, V)) {
      kept++;
      if (!nearest || fg.sc > nearest.sc) nearest = fg;
      if (`${fg.team}${fg.num}` === carrierKey) { carrierH.push(fg.heightFrac); carrierW.push(fg.widthM); }
      widths.push(fg.widthM); heights.push(fg.heightFrac);
      gapYs.push(fg.gapY); gapXs.push(fg.gapX);
      (fg.perp < 0.35 ? frontW : fg.perp > 0.65 ? profileW : frontW).push(fg.widthM);
      const k = `${fg.team}${fg.num}`;
      if (!perActorGap.has(k)) perActorGap.set(k, []);
      perActorGap.get(k)!.push(fg.gapY);
      if (!byBuild.has(fg.build)) byBuild.set(fg.build, []);
      byBuild.get(fg.build)!.push(fg.widthM);
      drawnHeightM.push(fg.inkH / fg.sc / FIGURE_SCALE);
    }
    if (nearest) nearestH.push(nearest.heightFrac);

    /* ---- how far apart do two players LOOK when they are 1.1 m apart? ----
     * The tackle test is isotropic in world space; the silhouette is not, so
     * this is the only honest way to ask whether the contact reads as contact. */
    if (op) {
      const crX = Math.cos(cam2.yaw), crZ = -Math.sin(cam2.yaw);
      const byKey = new Map<string, Figure>();
      for (const fg of pairFigures(rec, d, cam2, V)) byKey.set(`${fg.team}${fg.num}`, fg);
      const car = d.L(op.attacking, op.carrierNum);
      const cf = byKey.get(`${op.attacking}${op.carrierNum}`);
      const cp = project(cam2, V, car.x, 0, car.z);
      if (cf && cp) {
        const dTeam = op.attacking === 'A' ? 'B' : 'A';
        for (const p of d.live) {
          if (p.team !== dTeam || p.sinbin > 0) continue;
          const wd = Math.hypot(p.x - car.x, p.z - car.z);
          if (wd > 2.4) continue;
          const df = byKey.get(`${p.team}${p.num}`);
          const dp = project(cam2, V, p.x, 0, p.z);
          if (!df || !dp) continue;
          const screenDist = Math.hypot(dp.sx - cp.sx, dp.sy - cp.sy);
          const gapPx = screenDist - (cf.inkW + df.inkW) / 2;   // < 0 = overlapping
          const ux = (p.x - car.x) / (wd || 1), uz = (p.z - car.z) / (wd || 1);
          const across = Math.abs(ux * crX + uz * crZ);
          pairs.push({ wd, gap: gapPx, across, screenDist, w1: cf.inkW, w2: df.inkW, sc: Math.min(cf.sc, df.sc) });
          const k = bucket(wd);
          if (!screenGap.has(k)) screenGap.set(k, []);
          screenGap.get(k)!.push(gapPx);
        }
      }
    }

    for (let r = 0; r < RIGS.length; r++) {
      const rig = RIGS[r];
      d.cam = { ...real, h: rig.h, tilt: rig.tilt, fov: rig.fov, shake: 0 };
      const r2: Camera = { ...d.cam, shake: 0 };
      const rc = new Rec();
      drawMatch(rc.asCtx(), d, V);
      for (const fg of pairFigures(rc, d, r2, V)) {
        byRig[r].gapY.push(fg.gapY);
        byRig[r].flat.push(fg.ryOverRx);
        byRig[r].truth.push(fg.truthRyOverRx);
      }
      d.cam = real;
    }
  }
}

console.log(`\n=== SPEC_14 PROBE — ${seconds}s x2 seeds, difficulty ${diff} — ${draws} frames drawn, ${kept} figures measured ===\n`);

console.log('PHASE 1 — HOW BIG IS A PLAYER, REALLY?');
console.log(`  on-screen height as a fraction of viewport height   (broadcast reference 8-12%)`);
console.log(`     p50 ${(pct(heights, 50) * 100).toFixed(1)}%    p90 ${(pct(heights, 90) * 100).toFixed(1)}%    max ${(pct(heights, 100) * 100).toFixed(1)}%`);
console.log(`     the player AT THE BALL (what you are actually looking at):  p50 ${(pct(carrierH, 50) * 100).toFixed(1)}%   p90 ${(pct(carrierH, 90) * 100).toFixed(1)}%`);
console.log(`     the player NEAREST THE LENS:                                p50 ${(pct(nearestH, 50) * 100).toFixed(1)}%   p90 ${(pct(nearestH, 90) * 100).toFixed(1)}%`);
console.log(`  drawn silhouette WIDTH in metres — what the eye reads as "touching"`);
console.log(`     p50 ${f2(pct(widths, 50))} m    p90 ${f2(pct(widths, 90))} m    n=${widths.length}`);
console.log(`     the player AT THE BALL:           p50 ${f2(pct(carrierW, 50))} m`);
console.log(`     in profile (the view you almost always get):  p50 ${f2(pct(profileW, 50))} m  (n=${profileW.length})`);
console.log(`     facing the camera:                           ${frontW.length >= 20 ? `p50 ${f2(pct(frontW, 50))} m  (n=${frontW.length})` : `(n=${frontW.length} — players run across the lens, so front-on views essentially never occur)`}`);

const w50 = pct(widths, 50), w90 = pct(widths, 90), fw = pct(frontW, 50);
console.log(`\n  THE CONTACT SUM  (all distances centre-to-centre)`);
console.log(`     tackle fires at                               1.10 m`);
console.log(`     separate() holds opponents at                 0.82 m`);
console.log(`     median silhouettes visually touch at          ${f2(w50)} m`);
console.log(`     p90 (and front-on) silhouettes touch at       ${f2(w90)} m / ${f2(fw)} m`);
const gapAtTackle = 1.1 - w50, gapAtTackle90 = 1.1 - w90;
console.log(`     => at the moment the tackle fires the median pair is still ${f2(gapAtTackle)} m APART on screen`);
console.log(`     => and the widest tenth is ${gapAtTackle90 >= 0 ? `${f2(gapAtTackle90)} m apart` : `${f2(-gapAtTackle90)} m OVERLAPPING`}`);

console.log(`\n  THE MULTIPLIER`);
console.log(`     to make the MEDIAN drawn edge meet the tackle radius (1.10 m):  k = ${f2(1.1 / w50)}`);
if (frontW.length >= 20) console.log(`     to make the FRONT-ON drawn edge meet it:                         k = ${f2(1.1 / fw)}`);
console.log(`     to make the median edge meet separate()'s 0.82 m floor:          k = ${f2(0.82 / w50)}`);
console.log(`     (k > 1 would GROW the players. k < 1 shrinks them.)`);

console.log(`\n  AUTHORED vs DRAWN — is the width the build, or the artwork on top of it?`);
console.log(`     build      authored shoulders   drawn silhouette   drawn/authored`);
for (const [b, ws] of [...byBuild.entries()].sort((x, y) => pct(y[1], 50) - pct(x[1], 50))) {
  const sh = BUILDS[b]?.shW ?? 0, dw = pct(ws, 50);
  console.log(`     ${b.padEnd(10)} ${f2(sh)} m               ${f2(dw)} m             ${f2(dw / sh)}x`);
}

console.log(`\n  VALIDATION — the drawn height divided by px-per-metre should return the authored build height`);
console.log(`     drawn height, divided back out by FIGURE_SCALE (${FIGURE_SCALE}): p50 ${f2(pct(drawnHeightM, 50))} m   p90 ${f2(pct(drawnHeightM, 90))} m`);
console.log(`     ...against builds authored at 1.76-1.98 m. Should land inside that band.`);

console.log(`\n  DO THEY LOOK LIKE THEY ARE TOUCHING?  screen gap between two figures, by true world distance`);
console.log(`     (negative = the silhouettes overlap;  0 = the edges just meet)`);
for (const k of ['under 0.85 m', '0.85-1.15 m (TACKLE)', '1.15-1.6 m', 'over 1.6 m']) {
  const g = screenGap.get(k);
  if (!g) continue;
  const overlap = g.filter((x) => x < 0).length;
  console.log(`     ${k.padEnd(21)} n=${String(g.length).padStart(6)}  p10 ${f1(pct(g, 10)).padStart(6)}  p50 ${f1(pct(g, 50)).padStart(6)}  p90 ${f1(pct(g, 90)).padStart(6)} px   overlapping ${((overlap / g.length) * 100).toFixed(0)}%`);
}

{
  const g = pairs.filter((x) => x.wd >= 0.85 && x.wd < 1.15);
  const avg = (f: (p: Pair) => number) => (g.reduce((a, b) => a + f(b), 0) / Math.max(1, g.length));
  console.log(`\n  RAW TERMS for the tackle band (n=${g.length}) — checking the arithmetic`);
  console.log(`     world distance      ${f2(avg((p) => p.wd))} m`);
  console.log(`     screen distance     ${f1(avg((p) => p.screenDist))} px`);
  console.log(`     px per metre (sc)   ${f1(avg((p) => p.sc))}`);
  console.log(`     => 1.1 m at that sc ${f1(1.1 * avg((p) => p.sc))} px`);
  console.log(`     silhouette A        ${f1(avg((p) => p.w1))} px  (${f2(avg((p) => p.w1 / p.sc))} m)`);
  console.log(`     silhouette B        ${f1(avg((p) => p.w2))} px  (${f2(avg((p) => p.w2 / p.sc))} m)`);
  console.log(`     half-widths summed  ${f1(avg((p) => (p.w1 + p.w2) / 2))} px`);
  const across1 = g.filter((x) => x.across > 0.7);
  console.log(`     across-lens subset: world ${f2(across1.reduce((a, b) => a + b.wd, 0) / Math.max(1, across1.length))} m -> screen ${f1(across1.reduce((a, b) => a + b.screenDist, 0) / Math.max(1, across1.length))} px at sc ${f1(across1.reduce((a, b) => a + b.sc, 0) / Math.max(1, across1.length))}`);
}

console.log(`\n  ...and the tackle band split by which way the two men are separated`);
console.log(`     side by side across the lens / one behind the other / diagonal`);
for (const [lab, lo, hi] of [['across the lens', 0.7, 1.01], ['diagonal', 0.35, 0.7], ['in depth (behind)', -0.01, 0.35]] as [string, number, number][]) {
  const g = pairs.filter((x) => x.wd >= 0.85 && x.wd < 1.15 && x.across >= lo && x.across < hi).map((x) => x.gap);
  if (g.length < 5) { console.log(`     ${lab.padEnd(19)} n=${String(g.length).padStart(4)}  (too few to report)`); continue; }
  const overlap = g.filter((x) => x < 0).length;
  console.log(`     ${lab.padEnd(19)} n=${String(g.length).padStart(4)}  p50 ${f1(pct(g, 50)).padStart(6)} px   p90 ${f1(pct(g, 90)).padStart(6)} px   overlapping ${((overlap / g.length) * 100).toFixed(0)}%`);
}

console.log(`\nPHASE 1b — IS IT THE RADIUS, OR IS IT THE SELECTION?`);
console.log(`     frames with a defender inside the 1.1 m contact radius:  ${contactFrames}`);
console.log(`     ...where the NEAREST defender was beaten (slipped):      ${nearestBeaten} (${((nearestBeaten / Math.max(1, contactFrames)) * 100).toFixed(1)}%)`);
console.log(`     ...where an eligible man was in range but blocked by him: ${shielded}`);

console.log(`\nPHASE 2 — THE SHADOW ANCHOR`);
console.log(`  vertical gap: shadow centre minus the lowest ink pixel (+ = shadow below the feet)`);
console.log(`     p50 ${f1(pct(gapYs, 50))} px    p90 ${f1(pct(gapYs, 90))} px    min ${f1(pct(gapYs, 0))}    max ${f1(pct(gapYs, 100))}`);
const spread = [...perActorGap.values()].map((g) => pct(g, 90) - pct(g, 10)).sort((a, b) => b - a);
console.log(`  per-actor SWING in that gap over the run (THE BOB TEST): p50 ${f1(pct(spread, 50))} px, worst ${f1(pct(spread, 100))} px`);
console.log(`  horizontal gap: shadow centre minus ink centre: p50 ${f1(pct(gapXs, 50))} px, p90 ${f1(pct(gapXs, 90))} px`);

console.log(`\n  THE FLATNESS TEST — drawn ry/rx against a real projected ground circle`);
console.log(`     rig            drawn    truth    error     gapY p50`);
for (let r = 0; r < RIGS.length; r++) {
  const b = byRig[r];
  const dr = pct(b.flat, 50), tr = pct(b.truth, 50);
  console.log(`     ${RIGS[r].label.padEnd(13)} ${f2(dr)}     ${f2(tr)}     ${f2(dr - tr).padStart(5)}     ${f1(pct(b.gapY, 50))} px`);
}
console.log(`\n  (${clipOps} ctx.clip calls seen across ${draws} frames)`);

/* ------------------------------------------------------------------ *
 * SCALE BY CAMERA MODE. The default rig is BEHIND POSTS, the widest
 * shot in the game. A complaint about the figures being too big may be
 * a complaint about one particular rig, so measure all three.
 * ------------------------------------------------------------------ */

/* `options.camera` in data.ts is DEAD — nothing in src/ reads it. The live
 * modes are set on Director.camMode from the UI, so sweep those instead. */
const MODES: Array<import('../src/game/camera').CamMode> = ['CABLE', 'BROADCAST', 'CHASE', 'TACTICAL', 'POSTS'];
console.log(`\n  THE SAME FIGURE UNDER EACH LIVE CAMERA RIG (20 s each, difficulty ${diff})`);
console.log(`     rig           carrier height    px per metre   silhouette width   tilt`);
for (const mode of MODES) {
  seedRng(1);
  const cfg = gateConfig(diff);
  const d2 = new Director(cfg);
  d2.camMode = mode;
  const hs: number[] = [], scs: number[] = [], ws: number[] = [], tilts: number[] = [];
  for (let i = 0; i < 20 * 60 && !d2.over; i++) {
    d2.update(1 / 60, NO_INPUT, new Set());
    if (i % 6 !== 0) continue;
    const cam2: Camera = { ...d2.cam, shake: 0 };
    const rec = new Rec();
    drawMatch(rec.asCtx(), d2, V);
    const key = d2.op ? `${d2.op.attacking}${d2.op.carrierNum}` : '';
    for (const fg of pairFigures(rec, d2, cam2, V)) {
      if (`${fg.team}${fg.num}` === key) { hs.push(fg.heightFrac); scs.push(fg.sc); ws.push(fg.widthM); tilts.push(fg.truthRyOverRx); }
    }
  }
  console.log(`     ${mode.padEnd(10)} ${(pct(hs, 50) * 100).toFixed(1).padStart(7)}% of frame  ${f1(pct(scs, 50)).padStart(6)} px/m       ${f2(pct(ws, 50))} m          ${f2(pct(tilts, 50))}`);
}
