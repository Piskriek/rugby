/**
 * SPEC_15 SIGN-OFF SHEET — what the referee actually looks like on the pitch.
 *
 * Usage:  npx vite-node scripts/spec15shot.ts
 *
 * Four real rendered frames:
 *
 *   1. OLD — placed by assignment (`rx = f.x*0.4 + 8`, `rz = f.z - dir*11`)
 *      with both of his clips falling through mapAction to 'idle'. This is
 *      what shipped: a man who teleports and cannot animate.
 *   2. NEW — steered, watching the ball, in open play.
 *   3. REF BUBBLE — a law call on a paper card above his head.
 *   4. SITE BUBBLE — the ruck prompt, anchored at the contest instead of on
 *      an official who may be fifteen metres away and off-screen.
 *
 * The recording context cannot rasterise text, so each bubble's words are
 * drawn as a text overlay at the card the renderer actually produced — the
 * position is measured from the recorded ink, not assumed.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { drawMatch } from '../src/render/scene';
import { project, type Camera, type View } from '../src/render/retro';
import { Rec } from './spec14rec';
import { rasterise, type Poly, type TextOverlay } from './pngout';

const V: View = { w: 720, h: 420 };

type Frame = { polys: Poly[]; texts: TextOverlay[] };

/** Render one frame through the recording context, capturing every polygon. */
function shoot(d: Director, cam: Camera, bubble?: string): Frame {
  const rec = new Rec();
  rec.cap = [];
  if (bubble) d.refBubbles.push({ text: bubble, kind: 'PENALTY', at: d.t, ttl: 9 });
  drawMatch(rec.asCtx(), d, V);
  const texts: TextOverlay[] = [];
  if (bubble) {
    d.refBubbles.pop();
    /* The bubble is drawn last. 6 ops: tail fill, tail stroke, card backing,
     * card fill, cut highlight, card outline. Measure the card from the ink. */
    const ops = rec.ops.slice(-6);
    if (ops.length === 6) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const o of ops.slice(2)) {
        x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0);
        x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1);
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const size = Math.max(10, Math.min(17, 0.26 * 60));
      texts.push({
        text: bubble, colour: '#ffd76a', scale: size > 15 ? 2 : 1,
        x: cx - (bubble.length * 6 * (size > 15 ? 2 : 1)) / 2, y: cy - 4,
      });
    }
  }
  return { polys: rec.cap ?? [], texts };
}

/** Run a match until `want(d)` is true, then hold. */
function grab(seed: number, want: (d: Director) => boolean, limit = 200) {
  seedRng(seed);
  const d = new Director(gateConfig(3));
  for (let i = 0; i < limit * 60 && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set());
    if (want(d)) return d;
  }
  return null;
}

/** Put the lens where the game would put it, then freeze the easing. */
function settle(d: Director) {
  drawMatch(new Rec().asCtx(), d, V);   // advance the camera ease
  return { ...d.cam, shake: 0 } as Camera;
}

/* ---------------- 1 & 2: open play, old placement vs new ---------------- */

const op = grab(4, (d) => d.phase === 'OPEN_PLAY' && !!d.op && Math.hypot(d.ref.x - d.op.carrierX, d.ref.z - d.op.carrierZ) < 13);
if (!op) throw new Error('no open play to photograph');
const camOP = settle(op);

/* OLD: the two lines of assignment that used to place him, and the clip that
 * fell through mapAction to 'idle'. Restored on the actor, not in the engine,
 * so this is a picture of the old behaviour rather than a change to the game. */
const refActor = op.actors[30];
const keep = { rx: refActor.rx, rz: refActor.rz, rf: refActor.rf, clip: refActor.renderClip };
const f = op.focusPoint();
const dirOld = op.possession === 'A' ? 1 : -1;
refActor.rx = f.x * 0.4 + 8;
refActor.rz = f.z - dirOld * 11;
refActor.rf = 1;                 // the old code never wrote it, so it stayed 1
refActor.renderClip = 'refReady';
const panelOld = shoot(op, camOP);
Object.assign(refActor, keep);
/* the teleport has been eaten by the puppet pipeline; draw once more so the
 * NEW panel shows the steered position and not the restored jump */
drawMatch(new Rec().asCtx(), op, V);
const panelNew = shoot(op, camOP);

/* ---------------- 3: a law call, anchored to the referee ---------------- */

const callD = grab(4, (d) => d.phase === 'BREAKDOWN' && !!d.bd && d.bd.groundAt >= 0 && d.bd.stage !== 'RECYCLE')
  ?? grab(7, (d) => d.phase === 'OPEN_PLAY' && !!d.op);
if (!callD) throw new Error('no frame for the law call');
const camCall = settle(callD);
const callTxt = 'PENALTY — NOT RELEASING';
const panelCall = shoot(callD, camCall, callTxt);

/* ---------------- 4: the ruck prompt, anchored at the contest ---------------- */

const ruckD = grab(4, (d) => {
  if (d.phase !== 'BREAKDOWN' || !d.bd) return false;
  const p = d.refPrompt();
  return !!p && p.text === 'A/D - CLEAROUT';
}) ?? grab(13, (d) => d.phase === 'BREAKDOWN' && !!d.refPrompt());
if (!ruckD) throw new Error('no ruck to photograph');
const camRuck = settle(ruckD);
const prompt = ruckD.refPrompt()!;
const panelRuck = shoot(ruckD, camRuck);
/* the SITE bubble is the second card in the draw list; find it by its anchor */
{
  const rec = new Rec();
  rec.cap = [];
  drawMatch(rec.asCtx(), ruckD, V);
  const n = rec.ops.length;
  const pp = project(camRuck, V, prompt.x, prompt.y, prompt.z);
  if (pp) {
    let best = -1, bd = 1e9;
    for (let i = Math.max(0, n - 12); i < n - 5; i++) {
      const o = rec.ops[i];
      const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
      const dd = Math.hypot(cx - pp.sx, cy - pp.sy);
      if (dd < bd) { bd = dd; best = i; }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of rec.ops.slice(best, best + 4)) {
      x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0);
      x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const scale = (x1 - x0) > 300 ? 2 : 1;
    panelRuck.texts.push({
      text: prompt.text, colour: prompt.colour, scale,
      x: cx - (prompt.text.length * 6 * scale) / 2, y: cy - 4,
    });
  }
}

/* ---------------- out ---------------- */

rasterise([
  { name: 'OLD — ASSIGNED EVERY FRAME, CLIP FORCED IDLE', ...panelOld },
  { name: 'NEW — STEERED, WATCHING THE BALL', ...panelNew },
  { name: 'REF BUBBLE — A LAW CALL, ABOVE HIS HEAD', ...panelCall },
  { name: 'SITE BUBBLE — THE RUCK PROMPT, AT THE RUCK', ...panelRuck },
], 'spec15_panels.png', V);

const rp = project(camOP, V, op.ref.x, 0, op.ref.z);
console.log(`referee at world ${op.ref.x.toFixed(1)},${op.ref.z.toFixed(1)}` +
  (rp ? ` -> screen ${rp.sx.toFixed(0)},${rp.sy.toFixed(0)} at ${rp.sc.toFixed(1)} px/m` : ' -> off lens'));
console.log(`clip: ${op.ref.clip}   facing ${(op.ref.face * 180 / Math.PI).toFixed(0)} deg`);
console.log(`panel 4 prompt: "${prompt.text}" at ${prompt.x.toFixed(1)},${prompt.z.toFixed(1)}`);
