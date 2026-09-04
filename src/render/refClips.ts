/**
 * SPEC_15 — THE REFEREE'S ONE-SHOTS.
 *
 * `clips.ts` is a verbatim handoff file: the pose vocabulary is copied from an
 * outside spec and only approved pose edits land in it. The referee did not
 * exist in that spec, so his six signals are authored here and merged into
 * `CLIPS` at load. The handoff file is not touched.
 *
 * Locomotion is NOT here. `walk`, `jog`, `run`, `strafe`, `shuffle` and `idle`
 * already cover him — the engine asks for `refWalk`/`refJog`/`refRun` and
 * `mapAction` folds those onto the existing gaits.
 */

import { CLIPS, type Clip } from './clips';

/**
 * The signal vocabulary. Six arm shapes, not one per law: the text in the
 * speech bubble carries the detail, the arms carry the class of decision.
 */
export const REF_CLIPS: Record<string, Clip> = {
  /* The whistle. Right hand to the mouth, a small settle onto the back foot,
   * and a breath through it. Ends near-neutral so the blend back to the gait
   * is short. */
  refWhistle: {
    dur: 0.6, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.94, aR: 0.03, eR: 0.16 } },
      { t: 0.3, e: 'o', p: { hip: 0.9, aR: 2.14, abR: 0.3, eR: 2.4, headP: -0.14, lean: -0.04 } },
      { t: 0.62, e: 's', p: { hip: 0.885, aR: 2.2, abR: 0.28, eR: 2.45, headP: -0.16, lean: -0.06 } },
      { t: 1, e: 's', p: { hip: 0.935, aR: 0.9, abR: 0.18, eR: 1.1, headP: -0.02, lean: 0.04 } },
    ],
  },

  /* PENALTY. One arm raised to 45 degrees, held on the offending side, with
   * the shoulders turned after it. The most legible shape in the game. */
  refSignalPenalty: {
    dur: 1.0, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.94, aR: 0.03, eR: 0.16 } },
      { t: 0.28, e: 'o', p: { hip: 0.95, aR: 2.28, abR: 0.52, eR: 0.14, twist: 0.2, headY: 0.22 } },
      { t: 0.72, e: 's', p: { hip: 0.945, aR: 2.34, abR: 0.56, eR: 0.1, twist: 0.22, headY: 0.24 } },
      { t: 1, e: 's', p: { hip: 0.94, aR: 0.8, abR: 0.3, eR: 0.7, twist: 0.06, headY: 0.05 } },
    ],
  },

  /* ADVANTAGE. Both arms out, horizontal, forward — the "play on" shape. */
  refSignalAdvantage: {
    dur: 1.0, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.94, aL: 0.03, aR: 0.03, eL: 0.16, eR: 0.16 } },
      { t: 0.3, e: 'o', p: { hip: 0.95, aL: 1.52, aR: 1.5, abL: 0.4, abR: 0.42, eL: 0.24, eR: 0.22, lean: 0.1 } },
      { t: 0.7, e: 's', p: { hip: 0.945, aL: 1.56, aR: 1.54, abL: 0.42, abR: 0.44, eL: 0.2, eR: 0.18, lean: 0.12 } },
      { t: 1, e: 's', p: { hip: 0.94, aL: 0.5, aR: 0.48, abL: 0.2, abR: 0.2, eL: 0.5, eR: 0.5, lean: 0.05 } },
    ],
  },

  /* SCRUM / restart. One arm out level, pointing the way the ball goes. */
  refSignalScrum: {
    dur: 1.0, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.94, aR: 0.03, eR: 0.16 } },
      { t: 0.3, e: 'o', p: { hip: 0.945, aR: 1.5, abR: 0.18, eR: 0.18, twist: 0.12, headY: 0.3 } },
      { t: 0.72, e: 's', p: { hip: 0.94, aR: 1.54, abR: 0.16, eR: 0.14, twist: 0.13, headY: 0.32 } },
      { t: 1, e: 's', p: { hip: 0.94, aR: 0.6, abR: 0.12, eR: 0.6, twist: 0.04, headY: 0.06 } },
    ],
  },

  /* TRY. Both arms straight overhead — the one signal a whole stadium reads. */
  refSignalTry: {
    dur: 0.9, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.94, aL: 0.03, aR: 0.03, eL: 0.16, eR: 0.16 } },
      { t: 0.3, e: 'o', p: { hip: 0.99, aL: 2.95, aR: 2.95, abL: 0.16, abR: 0.16, eL: 0.14, eR: 0.14, headP: -0.24 } },
      { t: 0.7, e: 's', p: { hip: 1.0, aL: 3.0, aR: 3.0, abL: 0.18, abR: 0.18, eL: 0.1, eR: 0.1, headP: -0.26 } },
      { t: 1, e: 's', p: { hip: 0.95, aL: 1.1, aR: 1.1, abL: 0.16, abR: 0.16, eL: 0.5, eR: 0.5, headP: -0.05 } },
    ],
  },

  /* THE CARD. Reach across to the back pocket, then the arm out front with it.
   * Deliberately slow: the walk of shame is the point. */
  refCard: {
    dur: 1.2, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.94, aR: 0.03, eR: 0.16 } },
      { t: 0.26, e: 's', p: { hip: 0.9, aR: -0.42, abR: -0.1, eR: 1.95, twist: 0.26, headY: -0.16 } },
      { t: 0.46, e: 'i', p: { hip: 0.915, aR: 0.5, abR: 0.3, eR: 1.5, twist: 0.1, headY: 0.06 } },
      { t: 0.66, e: 'o', p: { hip: 0.945, aR: 1.58, abR: 0.62, eR: 0.32, twist: -0.08, headY: 0.1, headP: 0.04 } },
      { t: 0.86, e: 's', p: { hip: 0.945, aR: 1.62, abR: 0.64, eR: 0.28, twist: -0.08, headY: 0.1 } },
      { t: 1, e: 's', p: { hip: 0.94, aR: 0.7, abR: 0.28, eR: 0.8, twist: 0, headY: 0.02 } },
    ],
  },
};

/** True for the six one-shots, so the engine can tell a signal from a gait. */
export const REF_SIGNALS: ReadonlySet<string> = new Set(Object.keys(REF_CLIPS));

let registered = false;

/**
 * Merge the referee's clips into the library. Idempotent, and called once at
 * module load by the renderer so `sampleC('refWhistle', u)` resolves anywhere
 * in the pipeline.
 */
export function registerRefClips() {
  if (registered) return;
  registered = true;
  Object.assign(CLIPS, REF_CLIPS);
}

/**
 * The referee's own action -> clip mapping. Lives outside `actionClip()` in the
 * handoff file: the signals are new, and a one-shot runs at its authored
 * duration rather than at a speed-derived cadence.
 */
export function refActionClip(action: string): { name: string; rate: number } | null {
  const clip = REF_CLIPS[action];
  if (!clip) return null;
  return { name: action, rate: 1 / clip.dur };
}
