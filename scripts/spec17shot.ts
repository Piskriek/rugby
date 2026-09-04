/**
 * SPEC_17 SHOT — the rig, up close.
 *
 * Draws a single actor straight through `drawPaperActor` at a large scale, at
 * four points across a gait cycle, in both the coronal and the side-profile
 * view. This isolates the rig from the match: no camera easing, no crowd, no
 * other players — just the figure and a ground line, so the swing leg, the arm
 * sort and the crotch can be judged by eye.
 *
 * Usage: npx vite-node scripts/spec17shot.ts [clip] [out.png]
 */
import { CLIPS, STAND, POSE_CH, type Pose } from '../src/render/clips';
import { BUILDS, PALETTES, threeQuarter, type Build } from '../src/render/paper';
import { drawPaperActor, type PaperDrawArgs } from '../src/render/coronal';
import { type Camera, type View } from '../src/render/retro';
import { Rec } from './spec14rec';
import { rasterise, type Poly } from './pngout';

const clip = process.argv[2] ?? 'run';
const out = process.argv[3] ?? 'spec17_rig.png';

const CELL: View = { w: 250, h: 330 };
/* drawPaperActor applies FIGURE_SCALE (1.65) internally, so the cell scale
 * must be divided by it or the figure overflows the panel. */
const SC = 125 / 1.65;
const build: Build = BUILDS.CENTRE;

type P = Partial<Pose>;
function ease(e: string, t: number): number {
  switch (e) {
    case 'l': return t;
    case 'o': return 1 - (1 - t) * (1 - t);
    case 'i': return t * t;
    default: return t * t * (3 - 2 * t);
  }
}
function sample(name: string, u: number): Pose {
  const c = (CLIPS as Record<string, { keys: { t: number; e?: string; p: P }[] }>)[name];
  const keys = c.keys;
  const base: Pose = { ...STAND };
  const acc = (k: P, o: Pose) => { for (const ch of POSE_CH) if (k[ch] !== undefined) (o[ch] as number) = k[ch] as number; };
  let i = 0;
  while (i < keys.length - 1 && u >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1] ?? { ...keys[0], t: 1 };
  const t = ease(b.e ?? 's', Math.min(1, Math.max(0, (u - a.t) / ((b.t - a.t) || 1))));
  const pa: Pose = { ...base }; acc(a.p, pa);
  const pb: Pose = { ...base }; acc(b.p, pb);
  const o: Pose = { ...base };
  for (const ch of POSE_CH) (o[ch] as number) = (pa[ch] as number) + ((pb[ch] as number) - (pa[ch] as number)) * t;
  return o;
}

const cam: Camera = { x: 0, z: -12, h: 1.6, yaw: 0, tilt: 0.05, fov: 0.42, shake: 0, horizon: 0.5, roll: 0 };

function cell(view: 'front' | 'rightEdge', u: number, ox: number, oy: number, lean = 0, tqAng: number | null = null, turn = 0): Poly[] {
  const rec = new Rec();
  rec.cap = [];
  const ctx = rec.asCtx();
  const groundY = oy + CELL.h - 40;
  const cx = ox + CELL.w * 0.5;

  // ground line + a metre rule, so foot contact is unambiguous
  rec.cap.push({ pts: [[ox + 14, groundY], [ox + CELL.w - 14, groundY], [ox + CELL.w - 14, groundY + 2], [ox + 14, groundY + 2]], fill: '#c9c2b0', alpha: 1, isStroke: false });

  const pose = sample(clip, u);
  const args: PaperDrawArgs = {
    ctx, sx: cx, sy: groundY, sc: SC,
    cam, v: CELL, wx: 0, wz: 0, face: 0,
    view, pose, pal: PALETTES.A, build,
    skin: '#c99468', hair: '#2a1c14', num: 12, seed: 5,
    carry: 0, carryStyle: 0, ballSide: 0.6, ballSpin: 0,
    cap: false, tape: false, spinDir: 1, gs: 0.6, fore: 0,
    headDir: 0, depth: 0, lean,
    tq: tqAng === null ? undefined : threeQuarter(tqAng), tqSign: 1, turn,
  };
  drawPaperActor(args);
  return (rec.cap ?? []).map((c) => ({
    pts: c.pts as [number, number][], fill: c.fill, alpha: c.alpha, isStroke: c.isStroke,
  }));
}

const US = [0, 0.25, 0.5, 0.75];
const coronalP: Poly[] = [];
const sideP: Poly[] = [];
US.forEach((u, i) => { coronalP.push(...cell('front', u, i * CELL.w, 0)); });
US.forEach((u, i) => { sideP.push(...cell('rightEdge', u, i * CELL.w, 0)); });

/* SPEC_18.3a — lean sweep: same pose, four shear angles, so the kinetic tilt
 * can be judged against a fixed reference. Feet must stay planted. */
const TQ = [0, 20, 35, 55];
const tqP: Poly[] = [];
TQ.forEach((ang, i) => { tqP.push(...cell('front', 0.25, i * CELL.w, 0, 0, ang)); });

const TURNS = [-1, -0.5, 0.5, 1];
const turnP: Poly[] = [];
TURNS.forEach((t, i) => { turnP.push(...cell('front', 0.25, i * CELL.w, 0, 0, null, t)); });

const LEANS = [-0.18, -0.09, 0.09, 0.18];
const leanP: Poly[] = [];
LEANS.forEach((ln, i) => { leanP.push(...cell('rightEdge', 0.25, i * CELL.w, 0, ln)); });

rasterise(
  [
    { name: `SPEC_17  ${clip.toUpperCase()}  CORONAL  (swing leg + arm z-sort)`, polys: coronalP },
    { name: `SPEC_17  ${clip.toUpperCase()}  SIDE PROFILE  (hip pivot + crotch notch)`, polys: sideP },
    { name: 'SPEC_18.3b  3/4 PERSPECTIVE  facing angle 0 / 20 / 35 / 55 deg  (0 = identity)', polys: tqP },
    { name: 'SPEC_18.5  CENTRIFUGAL FLARE  turn bias -1 / -0.5 / +0.5 / +1  (inside tucks, outside flares)', polys: turnP },
    { name: 'SPEC_18.3a  KINETIC LEAN  -10.3 / -5.2 / +5.2 / +10.3 deg  (brake <-> accelerate)', polys: leanP },
  ],
  out,
  { w: CELL.w * US.length, h: CELL.h },
);
console.log('wrote %s', out);
