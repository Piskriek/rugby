/**
 * ragdollbake — precompute a library of tackle falls, offline.
 *
 * WHY BAKE AT ALL
 * ---------------
 * The live solver is cheap (0.03 ms for four bodies), so this is not about
 * saving CPU. It is about CONTROL. A live ragdoll produces whatever the
 * physics produces, including the 1-in-20 fall where a leg tangles and the
 * man twitches on the floor — and you cannot fix that without changing the
 * solver for every other tackle too. Baking makes each fall an ASSET: it is
 * simulated once, checked against quality rules here, and only the takes that
 * pass ever reach the pitch. A bad fall is rejected at build time instead of
 * being shipped to the player.
 *
 * It also makes the result IDENTICAL on every machine, at every framerate,
 * which a live accumulator-driven solver can never quite promise.
 *
 * WHAT MAKES IT SMALL
 * -------------------
 * The solver is yaw-invariant to 0.45 mm (verified in ragdollverify): rotating
 * the seed and the impulse about Y rotates the entire result. So the hit
 * DIRECTION never needs baking — every fall is simulated in body-local space
 * with the hit coming from a canonical direction, and the runtime simply
 * rotates the sampled pose to the angle the tackle actually happened at.
 *
 * That collapses the whole space to two axes worth baking:
 *
 *   ANGLE   where the hit lands relative to the body (front / side / back
 *           changes which way he folds — this is NOT the same as world yaw)
 *   POWER   how hard, which changes whether he is lifted or just dumped
 *
 * with a couple of variants each so the same collision never replays
 * identically. Positions are quantised to int16 at 0.25 mm resolution, which
 * is far below what is visible on a 1.8 m body.
 */
import fs from 'node:fs';
import { RagdollBody, NODE_COUNT, NODE } from '../src/render/ragdollKernel';

/* ------------------------------------------------------------ parameters --- */

/** Hit direction relative to the body's own facing, radians. */
const ANGLES = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI,
  (4 * Math.PI) / 3, (5 * Math.PI) / 3];
/** Power tiers: a shoulder-height dump, a solid hit, a full-pace cleanout. */
const POWERS = [0.5, 0.85, 1.25];
/** Variants per (angle, power), so the same collision never looks the same. */
const VARIANTS = 2;

const CLIP_HZ = 24;          // sampled rate; runtime lerps between frames
const CLIP_SECONDS = 1.75;   // measured settle is 1.73 s; the tail is static anyway
const FRAMES = Math.round(CLIP_HZ * CLIP_SECONDS);
/** int16 at this scale gives +-8.1 m at 0.25 mm resolution. */
const QUANT = 4000;

/** A neutral upright pose in metres, matching the rig's proportions. */
const STAND: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1.00, 0],        // pelvis
  [0, 1.35, 0],        // chest
  [0, 1.62, 0],        // head
  [-0.19, 1.45, 0],    // shoulderL
  [0.19, 1.45, 0],     // shoulderR
  [-0.30, 1.05, 0.10], // handL
  [0.30, 1.05, 0.10],  // handR
  [-0.10, 0.55, 0],    // kneeL
  [0.10, 0.55, 0],     // kneeR
  [-0.10, 0.09, 0.04], // footL
  [0.10, 0.09, 0.04],  // footR
];

/* --------------------------------------------------------------- the bake --- */

interface Take { data: Int16Array; settleFrame: number; rejected: string | null }

function simulate(angle: number, power: number, variant: number): Take {
  const seed = new Float32Array(NODE_COUNT * 3);
  for (let i = 0; i < NODE_COUNT; i++) {
    /* Jitter the starting pose per variant. A real player is never squarely
     * upright at the moment of contact, and identical seeds would produce
     * identical falls no matter what else we varied. */
    const j = (variant - (VARIANTS - 1) / 2) * 0.035;
    seed[i * 3] = STAND[i][0] + j * (i % 2 ? 1 : -1);
    seed[i * 3 + 1] = STAND[i][1] * (1 + j * 0.12);
    seed[i * 3 + 2] = STAND[i][2] + j * 0.6;
  }

  const body = new RagdollBody();
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // Run speed along the body's forward axis; the hit comes in at `angle`.
  const run = 5.5 * power;
  const impulse: [number, number, number] = [ca * 3.1 * power, 1.9 * power, sa * 3.1 * power];
  const spin = ((variant - 1) * 0.7 + (angle > Math.PI ? -0.3 : 0.3)) * power;
  body.reset(seed, [0, 0, run * 0.35], impulse, spin);

  const data = new Int16Array(FRAMES * NODE_COUNT * 3);
  const step = 1 / CLIP_HZ;
  let settleFrame = FRAMES - 1;
  let settled = false;

  for (let f = 0; f < FRAMES; f++) {
    body.update(step);
    for (let n = 0; n < NODE_COUNT; n++) {
      const i = n * 3;
      /* Store RELATIVE TO THE SEED PELVIS so the clip is position-independent
       * and the runtime can drop it anywhere on the pitch. */
      data[f * NODE_COUNT * 3 + i] = Math.round((body.pos[i] - STAND[0][0]) * QUANT);
      data[f * NODE_COUNT * 3 + i + 1] = Math.round((body.pos[i + 1] - STAND[0][1]) * QUANT);
      data[f * NODE_COUNT * 3 + i + 2] = Math.round((body.pos[i + 2] - STAND[0][2]) * QUANT);
    }
    if (!settled && body.asleep) { settleFrame = f; settled = true; }
  }
  /* Keep simulating past the stored window purely to judge whether this take
   * WOULD have settled. The stored frames stop at CLIP_SECONDS; a fall still
   * drifting a little at that point is fine, one still tumbling is not. */
  for (let f = 0; f < FRAMES && !settled; f++) {
    body.update(step);
    if (body.asleep) settled = true;
  }

  /* ---- quality gate: reject a take rather than ship a bad fall ---------- */
  let rejected: string | null = null;
  const last = (FRAMES - 1) * NODE_COUNT * 3;
  const headY = data[last + NODE.HEAD * 3 + 1] / QUANT + STAND[0][1];
  const pelvY = data[last + NODE.PELVIS * 3 + 1] / QUANT + STAND[0][1];
  if (!settled) rejected = 'never settled';
  else if (headY > 0.85) rejected = `ended upright (head ${headY.toFixed(2)}m)`;
  else if (pelvY > 0.75) rejected = `hips never went down (${pelvY.toFixed(2)}m)`;
  for (let k = 0; k < data.length && !rejected; k++) {
    if (!Number.isFinite(data[k])) rejected = 'non-finite';
  }
  // A man must not slide half the pitch: that reads as ice, not turf.
  const travel = Math.hypot(data[last] / QUANT, data[last + 2] / QUANT);
  if (!rejected && travel > 6) rejected = `slid ${travel.toFixed(1)}m`;

  return { data, settleFrame, rejected };
}

/* ------------------------------------------------------------------ main --- */

const clips: number[][] = [];
const index: { angle: number; power: number; settle: number }[] = [];
let rejects = 0;

for (let a = 0; a < ANGLES.length; a++) {
  for (let p = 0; p < POWERS.length; p++) {
    for (let v = 0; v < VARIANTS; v++) {
      let take = simulate(ANGLES[a], POWERS[p], v);
      // One retry with a nudged variant before we give up on this cell.
      if (take.rejected) {
        rejects++;
        take = simulate(ANGLES[a], POWERS[p], v + VARIANTS);
      }
      if (take.rejected) {
        console.log(`  SKIP a=${a} p=${p} v=${v}: ${take.rejected}`);
        continue;
      }
      clips.push(Array.from(take.data));
      index.push({ angle: a, power: p, settle: take.settleFrame });
    }
  }
}

/* Flatten to one buffer and base64 it. JSON of 500k numbers would be 3 MB of
 * text; base64 of int16 is a quarter of that and parses in one pass. */
const flat = new Int16Array(clips.length * FRAMES * NODE_COUNT * 3);
clips.forEach((c, i) => flat.set(c, i * FRAMES * NODE_COUNT * 3));
const b64 = Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength).toString('base64');

const out = {
  version: 1,
  hz: CLIP_HZ,
  frames: FRAMES,
  nodes: NODE_COUNT,
  quant: QUANT,
  angles: ANGLES,
  powers: POWERS,
  clips: index,
  data: b64,
};

fs.writeFileSync('src/render/ragdollClips.json', JSON.stringify(out));
const kb = (b64.length / 1024).toFixed(0);
console.log(`\nbaked ${clips.length} clips (${rejects} retried) -> ${kb} KB base64`);
console.log(`${ANGLES.length} angles x ${POWERS.length} powers x ${VARIANTS} variants`);
console.log('wrote src/render/ragdollClips.json');
