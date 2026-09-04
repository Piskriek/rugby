/**
 * SPEC_15 PROBE — the referee as an actor, and the speech bubble.
 *
 * Usage:  npx vite-node scripts/spec15probe.ts [seconds] [difficulty]
 *
 *   PHASE 1 — THE ACTOR. Six questions, all answered by measurement:
 *     1. does he animate at all (clip distribution),
 *     2. does he move continuously (per-frame displacement vs the old
 *        teleport),
 *     3. does he stay behind the ball (the one hard constraint),
 *     4. does he stay out of the thirty's way (nearest-player distance),
 *     5. does he stay on the pitch,
 *     6. does he face the ball.
 *
 *   PHASE 2 — THE BUBBLE.
 *     7. the audit rule: every whistle produced a bubble within 0.2 s,
 *     8. the four deleted worldLabels and the SITE prompt that replaces them
 *        fire on EXACTLY the same frames,
 *     9. the card actually draws ink, inside the frame, clear of his head.
 *
 * Read-only with respect to the game.
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { seedRng } from '../src/game/seed';
import { drawMatch, drawRefBubbles } from '../src/render/scene';
import { project, type Camera, type View } from '../src/render/retro';
import { Rec } from './spec14rec';
import { maulUseItCall } from '../src/game/engine/setpieces';
import { refBallPoint, refTarget } from '../src/game/engine/referee';

const seconds = Number(process.argv[2] ?? 150);
const diff = Number(process.argv[3] ?? 3);
const V: View = { w: 960, h: 540 };

/** The SPEC_14 recording context stops at the ink; the bubble needs text
 *  metrics too. Bold condensed caps run about 0.62 em per glyph. */
class RecText extends Rec {
  measureText(t: string) { return { width: String(t).length * 13 * 0.62 }; }
}

const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

/* ---------------------------- collections ---------------------------- */

const clips = new Map<string, number>();
const step: number[] = [];              // per-frame displacement, metres
const speeds: number[] = [];
const depth: number[] = [];             // signed metres behind the ball
const inFront: number[] = [];           // frames with (ref.z - ball.z) * dir > 0
const nearestP: number[] = [];          // metres to the closest of the thirty
const targetErr: number[] = [];         // metres from where he wants to be
const ballDist: number[] = [];          // metres from the referee to the ball
const ballDistByPhase = new Map<string, number[]>();
const faceErr: number[] = [];           // degrees between his facing and the ball
const offPitch: string[] = [];
const byPhase = new Map<string, number[]>();   // phase -> depth behind ball
const errByPhase = new Map<string, number[]>();
const nearByPhase = new Map<string, number[]>();
let blocking = 0;        // in front of the ball AND inside the playing corridor
const blockByPhase = new Map<string, number>();
let inFrontOnly = 0;

/* PHASE 2 */
const bubbleKinds = new Map<string, number>();
const bubbleTexts = new Map<string, number>();
let whistleEdges = 0, enqueued = 0, shownNow = 0, worstBubbleDelay = 0;
const displayWaits: number[] = [];
const missedCalls: string[] = [];
let promptFrames = 0, labelFrames = 0, promptMismatch = 0;
const mismatches: string[] = [];
const seen = new Set<string>();
let bubbleDraws = 0, bubbleOnScreen = 0, bubbleInFrame = 0, headInView = 0;
const clearances: number[] = [];        // px from the card's bottom to the head
const tailLen: number[] = [];           // px from the card's centre to the head
const cardW: number[] = [];
const bubbleOpOdd: number[] = [];   // the bubble should always be exactly 6 ops

/* ---------------------------- the run ---------------------------- */

for (const seed of [1, 7, 13]) {
  seedRng(seed);
  const d = new Director(gateConfig(diff));
  let prevX = d.ref.x, prevZ = d.ref.z;
  let prevSignal = '';

  for (let i = 0; i < Math.ceil(seconds * 60) && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set());

    const r = d.ref;
    const ball = refBallPoint(d);
    const dir = d.op ? d.op.dir
      : d.bd ? (d.bd.attacking === 'A' ? 1 : -1)
        : d.ml ? d.ml.dir
          : d.kk ? d.kk.dir
            : (d.possession === 'A' ? 1 : -1);

    /* 1 — animation */
    clips.set(r.clip, (clips.get(r.clip) ?? 0) + 1);

    /* 2 — continuity */
    const dx = r.x - prevX, dz = r.z - prevZ;
    step.push(Math.hypot(dx, dz));
    speeds.push(Math.hypot(r.vx, r.vz));
    prevX = r.x; prevZ = r.z;

    /* 3 — behind the ball */
    const behind = (ball.z - r.z) * dir;
    depth.push(behind);
    if (behind < 0) inFront.push(behind);
    const ph = d.phase.replace('_REPLAY', '');
    /* "in front" is only a problem if he is also in the corridor the ball is
     * travelling down — a referee caught upfield steps WIDE (refTarget does
     * this) and is no more in the way than a man on the touchline. */
    if (behind < 0) {
      inFrontOnly++;
      if (Math.abs(r.x - ball.x) < 5) {
        blocking++;
        if (!blockByPhase.has(ph)) blockByPhase.set(ph, 0);
        blockByPhase.set(ph, blockByPhase.get(ph)! + 1);
      }
    }
    if (!byPhase.has(ph)) byPhase.set(ph, []);
    byPhase.get(ph)!.push(behind);

    /* 4 — out of the way */
    let near = Infinity;
    for (const p of d.live) {
      const dd = Math.hypot(p.x - r.x, p.z - r.z);
      if (dd < near) near = dd;
    }
    nearestP.push(near);

    /* 5 — on the pitch */
    if (Math.abs(r.x) > 33.01 || Math.abs(r.z) > 58.01) offPitch.push(`${ph} ${f1(r.x)},${f1(r.z)}`);

    /* 6 — facing the ball */
    const bearing = Math.atan2(ball.x - r.x, ball.z - r.z);
    let fe = bearing - r.face;
    while (fe > Math.PI) fe -= Math.PI * 2;
    while (fe < -Math.PI) fe += Math.PI * 2;
    faceErr.push(Math.abs(fe) * 180 / Math.PI);

    /* refTarget() eases ref.depthNow as a side effect, and stepReferee has
     * already called it this frame — snapshot and restore so MEASURING the
     * target does not advance the very state we are measuring. */
    const depthSave = r.depthNow;
    const T = refTarget(d, r, ball, ball);
    r.depthNow = depthSave;
    const err = Math.hypot(T.x - r.x, T.z - r.z);
    targetErr.push(err);
    if (!errByPhase.has(ph)) { errByPhase.set(ph, []); nearByPhase.set(ph, []); }
    errByPhase.get(ph)!.push(err);
    nearByPhase.get(ph)!.push(near);
    const bd = Math.hypot(r.x - ball.x, r.z - ball.z);
    ballDist.push(bd);
    if (!ballDistByPhase.has(ph)) ballDistByPhase.set(ph, []);
    ballDistByPhase.get(ph)!.push(bd);

    /* ---- PHASE 2: the audit. A whistle EDGE is refSignalText going from
     * empty to set. The rule is that a bubble exists within 0.2 s of it. ---- */
    const sig = d.refSignal > 0 ? d.refSignalText : '';
    if (sig && !prevSignal) {
      whistleEdges++;
      /* TWO questions, and they are not the same one.
       *   (a) ENQUEUED — did this call produce a bubble at all, timestamped
       *       at the call? This is what the audit rule actually means, and it
       *       is not a tautology: it proves no code path reaches a whistle
       *       without going through refSay().
       *   (b) DISPLAYED — was it the bubble on screen, and how long until it
       *       was? A queue defers by design, so this is a separate number. */
      const fresh = d.refBubbles.find((b) => b.text === sig && Math.abs(b.at - d.t) <= 0.2);
      if (fresh) enqueued++;
      else missedCalls.push(`seed ${seed} t=${f1(d.t)} "${sig}"  queue=[${d.refBubbles.map((b) => b.text).join(' / ')}]`);
      const head = d.refBubbleHead();
      if (head) {
        worstBubbleDelay = Math.max(worstBubbleDelay, Math.abs(head.at - d.t));
        if (head.text === sig) shownNow++;
        else {
          /* how long until this call actually got the screen (or it expired) */
          let wait = 0;
          for (let k = 0; k < 300; k++) {
            d.update(1 / 60, NO_INPUT, new Set());
            wait += 1 / 60;
            const h2 = d.refBubbleHead();
            if (!h2 || h2.text === sig) break;
          }
          displayWaits.push(wait);
        }
      }
    }
    prevSignal = sig;

    /* every distinct line he speaks over the match */
    for (const b of d.refBubbles) {
      const key = `${b.at.toFixed(3)}|${b.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bubbleKinds.set(b.kind, (bubbleKinds.get(b.kind) ?? 0) + 1);
      bubbleTexts.set(b.text, (bubbleTexts.get(b.text) ?? 0) + 1);
    }

    /* the four deleted worldLabels vs the SITE prompt that replaces them */
    let oldLabel = '';
    if (d.ml && (d.phase === 'MAUL' || d.phase === 'MAUL_REPLAY') && maulUseItCall(d.ml)) oldLabel = 'USE IT';
    if (d.bd && (d.phase === 'BREAKDOWN' || d.phase === 'BREAKDOWN_REPLAY') && d.bd.groundAt >= 0) {
      oldLabel = d.bd.stage === 'RECYCLE' ? 'SECURED'
        : d.bd.jackalActive ? 'COMMIT - SPACE' : 'A/D - CLEAROUT';
    }
    const prompt = d.refPrompt();
    if (oldLabel) labelFrames++;
    if (prompt) promptFrames++;
    if (oldLabel !== (prompt?.text ?? '')) {
      promptMismatch++;
      if (mismatches.length < 8) mismatches.push(`t=${f1(d.t)} old="${oldLabel}" new="${prompt?.text ?? ''}"`);
    }

    /* the bubble's ink, every 30th frame */
    if (i % 30 === 0) {
      const cam2: Camera = { ...d.cam, shake: 0 };
      /* The bubble pass is a pure function of the director and the lens, so
       * it is measured on its own rather than by rendering a whole frame
       * twice — two renders are NOT frame-identical (the puppet pipeline
       * advances and the camera jitters), which made differential op-counting
       * nonsense. Here rec.ops is exactly the bubble's ink: tail (2 ops) then
       * card (4 ops). */
      const rec = new RecText();
      d.refBubbles.push({ text: 'PENALTY — OFFSIDE', kind: 'PENALTY', at: d.t, ttl: 9 });
      drawRefBubbles(rec.asCtx(), d, V, cam2, 0, 0);
      d.refBubbles.pop();
      const extra = rec.ops.slice(0, 6);
      if (extra.length === 6) {
        bubbleDraws++;
        /* ops[0..2] are the tail (fill + stroke); the rest is the card. */
        const card = extra.slice(2);
        const bbox = (ops: typeof extra) => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const o of ops) {
            x0 = Math.min(x0, o.x0); y0 = Math.min(y0, o.y0);
            x1 = Math.max(x1, o.x1); y1 = Math.max(y1, o.y1);
          }
          return { x0, y0, x1, y1 };
        };
        const cb = bbox(card);
        const head = project(cam2, V, r.x, 3.836, r.z);
        if (head) {
          bubbleOnScreen++;
          if (cb.x0 >= -1 && cb.y0 >= -1 && cb.x1 <= V.w + 1 && cb.y1 <= V.h + 1) bubbleInFrame++;
          if (head.sx >= 0 && head.sx <= V.w && head.sy >= 0 && head.sy <= V.h) headInView++;
          clearances.push(head.sy - cb.y1);
          tailLen.push(Math.hypot((cb.x0 + cb.x1) / 2 - head.sx, (cb.y0 + cb.y1) / 2 - head.sy));
          cardW.push(cb.x1 - cb.x0);
        }
      } else {
        bubbleOpOdd.push(extra.length);
      }
    }
  }
}

/* ---------------------------- report ---------------------------- */

const T = (name: string) => console.log(`\n=== ${name} ===`);

T('PHASE 1 — THE ACTOR');

console.log('\n1. ANIMATION — clip distribution (was: refReady/refSignal, both -> idle)');
const total = [...clips.values()].reduce((a, b) => a + b, 0);
for (const [k, n] of [...clips].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(20)} ${String(n).padStart(7)}  ${(100 * n / total).toFixed(1)}%`);
}
const idleShare = (clips.get('refIdle') ?? 0) / total;
console.log(`   idle share: ${(idleShare * 100).toFixed(1)}%  (a standing official, not a frozen one)`);

console.log('\n2. CONTINUITY — per-frame displacement, metres (old code teleported)');
console.log(`   p50 ${f2(pct(step, 50))}   p90 ${f2(pct(step, 90))}   p99 ${f2(pct(step, 99))}   max ${f2(Math.max(...step))}`);
console.log(`   run speed x 1/60 = ${f2(7.0 / 60)} m — a displacement above this is a teleport`);
console.log(`   speed p50 ${f2(pct(speeds, 50))}  p90 ${f2(pct(speeds, 90))}  max ${f2(Math.max(...speeds))} m/s`);

console.log('\n3. BEHIND THE BALL — signed metres along the attacking axis (+ = behind)');
console.log(`   p10 ${f1(pct(depth, 10))}   p50 ${f1(pct(depth, 50))}   p90 ${f1(pct(depth, 90))}   min ${f1(Math.min(...depth))}`);
console.log(`   frames IN FRONT of the ball: ${inFront.length} of ${depth.length} (${(100 * inFront.length / depth.length).toFixed(1)}%)`);
console.log(`   ...AND inside the 10 m corridor the ball is travelling down: ${blocking} (${(100 * blocking / depth.length).toFixed(2)}%)  <- the number that means "in the way"`);
console.log('   "in the way" by phase:', [...blockByPhase].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  ') || 'none');
console.log('   by phase (p50 depth):');
for (const [ph, a] of [...byPhase].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`     ${ph.padEnd(12)} n=${String(a.length).padStart(6)}  p50 ${f1(pct(a, 50))}  min ${f1(Math.min(...a))}`);
}

console.log('\n4. OUT OF THE WAY — nearest of the thirty, metres');
console.log(`   p1 ${f2(pct(nearestP, 1))}   p5 ${f2(pct(nearestP, 5))}   p50 ${f2(pct(nearestP, 50))}`);
console.log(`   frames inside 1.5 m: ${(100 * nearestP.filter((n) => n < 1.5).length / nearestP.length).toFixed(2)}%`);
console.log(`   frames inside 2.5 m: ${(100 * nearestP.filter((n) => n < 2.5).length / nearestP.length).toFixed(2)}%`);
console.log(`   distance from his own target: p50 ${f2(pct(targetErr, 50))}  p90 ${f2(pct(targetErr, 90))} m`);
console.log(`   DISTANCE FROM THE BALL (what the viewer sees): p10 ${f1(pct(ballDist, 10))}  p50 ${f1(pct(ballDist, 50))}  p90 ${f1(pct(ballDist, 90))}  p99 ${f1(pct(ballDist, 99))} m`);
console.log('     by phase:');
for (const [ph, a] of [...ballDistByPhase].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`       ${ph.padEnd(12)} n=${String(a.length).padStart(6)}  p50 ${f1(pct(a, 50))}  p90 ${f1(pct(a, 90))} m`);
}
console.log('   by phase — nearest player (p50) and distance from target (p50):');
for (const [ph, a] of [...nearByPhase].sort((x, y) => y[1].length - x[1].length)) {
  const e = errByPhase.get(ph)!;
  console.log(`     ${ph.padEnd(12)} n=${String(a.length).padStart(6)}  nearest p50 ${f2(pct(a, 50))} m   target err p50 ${f2(pct(e, 50))}  p90 ${f2(pct(e, 90))} m`);
}

console.log('\n5. ON THE PITCH');
console.log(`   frames outside the playing surface: ${offPitch.length}${offPitch.length ? ' — ' + offPitch.slice(0, 4).join(' | ') : ''}`);

console.log('\n6. FACING — degrees between his bearing and the ball (+ = looking away)');
console.log(`   p50 ${f1(pct(faceErr, 50))}   p90 ${f1(pct(faceErr, 90))}   p99 ${f1(pct(faceErr, 99))}`);

T('PHASE 2 — THE BUBBLE');

console.log('\n7a. WHAT HE SAYS over three 150 s matches');
for (const [k, n] of [...bubbleKinds].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(10)} ${String(n).padStart(4)}`);
}
for (const [t, n] of [...bubbleTexts].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`     ${String(n).padStart(3)}x  ${t}`);
}

console.log('\n7. AUDIT — every whistle produced a bubble within 0.2 s');
console.log(`   whistle edges: ${whistleEdges}`);
console.log(`   (a) ENQUEUED within 0.2 s: ${enqueued}   missed: ${missedCalls.length}   <- the audit rule`);
console.log(`   (b) on screen at the moment of the call: ${shownNow}`);
if (displayWaits.length) console.log(`       deferred behind another bubble on ${displayWaits.length} calls: p50 ${f2(pct(displayWaits, 50))} s  max ${f2(Math.max(...displayWaits))} s`);
console.log(`   worst head-to-call age: ${f2(worstBubbleDelay)} s`);
if (missedCalls.length) for (const m of missedCalls.slice(0, 8)) console.log(`     MISSED ${m}`);

console.log('\n8. THE FOUR DELETED LABELS vs THE SITE PROMPT');
console.log(`   frames the old worldLabel fired: ${labelFrames}`);
console.log(`   frames refPrompt() fires:        ${promptFrames}`);
console.log(`   mismatched frames: ${promptMismatch}${mismatches.length ? ' — ' + mismatches.join(' | ') : ''}`);

console.log('\n9. THE CARD DRAWS — ink above his head, inside the frame');
console.log(`   sampled frames: ${bubbleDraws}   head projects: ${bubbleOnScreen}   head inside the viewport: ${headInView}`);
console.log(`   card fully inside the frame: ${bubbleInFrame} of ${bubbleOnScreen}  (the clamp's job)`);
if (clearances.length) {
  console.log(`   clearance head -> card bottom: p10 ${f1(pct(clearances, 10))}  p50 ${f1(pct(clearances, 50))} px  (negative = the card covers his head)`);
  console.log(`   tail length (card centre -> head): p50 ${f1(pct(tailLen, 50))}  p90 ${f1(pct(tailLen, 90))} px`);
  console.log(`   frames where the bubble was not 6 ops: ${bubbleOpOdd.length}${bubbleOpOdd.length ? ' ' + [...new Set(bubbleOpOdd)].join(',') : ''}`);
  console.log(`   card width: p50 ${f1(pct(cardW, 50))} px of ${V.w}`);
}
