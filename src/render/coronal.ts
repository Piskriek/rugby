/**
 * CORONAL RIG — front/back-facing skeletal animation for a fixed behind-the-posts
 * camera. Players are 2D billboards that always face the lens, so the rig works in
 * the CORONAL plane (left/right + up/down) rather than the sagittal plane.
 *
 * Animation quality checklist applied to every clip:
 *  1. Contralateral rotation   2. Double bob          3. Lateral sway
 *  4. Heel recovery            5. Gaze stabilisation  6. Arm opposition
 *  7. Asymmetry                8. Anticipation        9. Follow-through/overshoot
 * 10. Impact compression      11. Breathing          12. Weight shift
 * 13. Foot planting           14. Per-actor phase    15. Fatigue drift
 * 16. Secondary motion        17. Head tracking      18. Settle frames
 */

import { Ease, ease } from './rig';

export interface CPose {
  rootY: number; rootX: number; lean: number; twist: number; hipTwist: number;
  headTurn: number; headTilt: number; headNod: number;
  aLout: number; aLfwd: number; aLbend: number;
  aRout: number; aRfwd: number; aRbend: number;
  lLout: number; lLfwd: number; lLbend: number; lLlift: number;
  lRout: number; lRfwd: number; lRbend: number; lRlift: number;
  crouch: number; squash: number; width: number; breath: number;
}

export const C_BASE: CPose = {
  rootY: 0, rootX: 0, lean: 0, twist: 0, hipTwist: 0,
  headTurn: 0, headTilt: 0, headNod: 0,
  aLout: 8, aLfwd: 0, aLbend: 14, aRout: 8, aRfwd: 0, aRbend: 14,
  lLout: 6, lLfwd: 0, lLbend: 4, lLlift: 0,
  lRout: 6, lRfwd: 0, lRbend: 4, lRlift: 0,
  crouch: 0, squash: 1, width: 1, breath: 0,
};

const CH = Object.keys(C_BASE) as (keyof CPose)[];

export interface CKey { t: number; p: Partial<CPose>; e?: Ease }
export interface CClip { name: string; dur: number; loop: boolean; keys: CKey[] }

export function sampleC(clip: CClip, time: number): CPose {
  const t = clip.loop ? ((time % clip.dur) + clip.dur) % clip.dur : Math.min(Math.max(time, 0), clip.dur);
  const out: CPose = { ...C_BASE };
  const last: Partial<CPose> = {};
  let lastT = 0;
  for (const k of clip.keys) {
    const u = k.t <= lastT ? 1 : Math.min(1, Math.max(0, (t - lastT) / (k.t - lastT)));
    const e = ease(k.e ?? 'sineInOut', u);
    for (const c of CH) {
      const v = (k.p as Record<string, number | undefined>)[c];
      if (v === undefined) continue;
      const base = C_BASE as unknown as Record<string, number>;
      const o = out as unknown as Record<string, number>;
      const from = (last[c] ?? base[c]) as number;
      o[c] = from + (v - from) * e;
      last[c] = o[c] as never;
    }
    lastT = k.t;
    if (t <= k.t) break;
  }
  return out;
}

const P = (o: Partial<CPose>) => o;

export const C_CLIPS: Record<string, CClip> = {

  idle: {
    name: 'idle', dur: 4.6, loop: true, keys: [
      { t: 0.0, p: P({ rootX: -0.015, lLout: 6, lRout: 7, aLout: 8, aRout: 9, breath: 0, headTurn: -2, squash: 1 }) },
      { t: 1.15, p: P({ rootX: 0.0, breath: 0.7, aLout: 10, aRout: 10.5, headTurn: 0, squash: 1.004 }), e: 'sineInOut' },
      { t: 2.3, p: P({ rootX: 0.018, breath: 0, lLout: 7, lRout: 6, aLout: 8.5, aRout: 8, headTurn: 3, squash: 1 }), e: 'sineInOut' },
      { t: 3.45, p: P({ rootX: 0.0, breath: 0.7, aLout: 10, aRout: 10.5, headTurn: 1, squash: 1.004 }), e: 'sineInOut' },
      { t: 4.6, p: P({ rootX: -0.015, breath: 0, lLout: 6, lRout: 7, aLout: 8, aRout: 9, headTurn: -2, squash: 1 }), e: 'sineInOut' },
    ],
  },

  ready: {
    name: 'ready', dur: 1.15, loop: true, keys: [
      { t: 0.0, p: P({ crouch: 0.20, lean: 7, lLout: 11, lRout: 11, lLbend: 20, lRbend: 21, aLout: 20, aRout: 21, aLbend: 40, aRbend: 39, rootY: 0 }) },
      { t: 0.58, p: P({ crouch: 0.27, lean: 9, lLbend: 27, lRbend: 26, aLout: 23, aRout: 22, rootY: -0.035, squash: 0.99 }), e: 'sineInOut' },
      { t: 1.15, p: P({ crouch: 0.20, lean: 7, lLbend: 20, lRbend: 21, aLout: 20, aRout: 21, rootY: 0, squash: 1 }), e: 'sineInOut' },
    ],
  },

  jog: {
    name: 'jog', dur: 0.72, loop: true, keys: [
      { t: 0.00, p: P({ rootY: 0.00, rootX: -0.05, lean: 11, twist: -9, hipTwist: 7, headTurn: 2, headTilt: -1.5,
        lLfwd: 34, lLbend: 16, lLlift: 0.05, lRfwd: -22, lRbend: 62, lRlift: 0.22,
        aLout: 15, aLfwd: -20, aLbend: 68, aRout: 16, aRfwd: 26, aRbend: 52, squash: 1.0 }) },
      { t: 0.09, p: P({ rootY: 0.055, rootX: -0.02, lean: 12, twist: -5, hipTwist: 4,
        lLfwd: 14, lLbend: 30, lLlift: 0, lRfwd: -6, lRbend: 44, lRlift: 0.30,
        aLout: 13, aLfwd: -8, aLbend: 52, aRout: 14, aRfwd: 12, aRbend: 40, squash: 1.012 }), e: 'sineOut' },
      { t: 0.18, p: P({ rootY: 0.018, rootX: 0.0, lean: 11, twist: 0, hipTwist: 0, headTilt: 0,
        lLfwd: -8, lLbend: 44, lLlift: 0.06, lRfwd: 12, lRbend: 26, lRlift: 0.04,
        aLout: 14, aLfwd: 4, aLbend: 44, aRout: 15, aRfwd: -4, aRbend: 46, squash: 0.996 }), e: 'sineInOut' },
      { t: 0.28, p: P({ rootY: 0.0, rootX: 0.05, lean: 11, twist: 9, hipTwist: -7, headTurn: -2, headTilt: 1.5,
        lLfwd: -22, lLbend: 62, lLlift: 0.22, lRfwd: 35, lRbend: 16, lRlift: 0.05,
        aLout: 16, aLfwd: 27, aLbend: 52, aRout: 15, aRfwd: -21, aRbend: 68, squash: 1.0 }), e: 'sineInOut' },
      { t: 0.46, p: P({ rootY: 0.058, rootX: 0.02, lean: 12, twist: 5, hipTwist: -4,
        lLfwd: -6, lLbend: 44, lLlift: 0.31, lRfwd: 15, lRbend: 30, lRlift: 0,
        aLout: 14, aLfwd: 13, aLbend: 40, aRout: 13, aRfwd: -8, aRbend: 52, squash: 1.012 }), e: 'sineOut' },
      { t: 0.58, p: P({ rootY: 0.018, rootX: 0.0, lean: 11, twist: 0, hipTwist: 0, headTilt: 0,
        lLfwd: 12, lLbend: 26, lLlift: 0.04, lRfwd: -8, lRbend: 44, lRlift: 0.06,
        aLout: 15, aLfwd: -4, aLbend: 46, aRout: 14, aRfwd: 4, aRbend: 44, squash: 0.996 }), e: 'sineInOut' },
      { t: 0.72, p: P({ rootY: 0.0, rootX: -0.05, lean: 11, twist: -9, hipTwist: 7, headTurn: 2, headTilt: -1.5,
        lLfwd: 34, lLbend: 16, lLlift: 0.05, lRfwd: -22, lRbend: 62, lRlift: 0.22,
        aLout: 15, aLfwd: -20, aLbend: 68, aRout: 16, aRfwd: 26, aRbend: 52, squash: 1.0 }), e: 'sineInOut' },
    ],
  },

  sprint: {
    name: 'sprint', dur: 0.50, loop: true, keys: [
      { t: 0.00, p: P({ rootY: 0.02, rootX: -0.055, lean: 22, twist: -14, hipTwist: 11, headTilt: -2, headNod: 3,
        lLfwd: 52, lLbend: 18, lLlift: 0.10, lRfwd: -30, lRbend: 96, lRlift: 0.42,
        aLout: 12, aLfwd: -34, aLbend: 88, aRout: 13, aRfwd: 42, aRbend: 66, squash: 1.0, width: 1 }) },
      { t: 0.07, p: P({ rootY: 0.095, rootX: -0.02, lean: 23, twist: -8, hipTwist: 6,
        lLfwd: 22, lLbend: 40, lLlift: 0.02, lRfwd: -6, lRbend: 70, lRlift: 0.50,
        aLout: 11, aLfwd: -14, aLbend: 70, aRout: 12, aRfwd: 20, aRbend: 50, squash: 1.02, width: 0.99 }), e: 'sineOut' },
      { t: 0.125, p: P({ rootY: 0.045, rootX: 0.0, lean: 22, twist: 0, hipTwist: 0, headTilt: 0,
        lLfwd: -10, lLbend: 66, lLlift: 0.12, lRfwd: 20, lRbend: 34, lRlift: 0.06,
        aLout: 12, aLfwd: 6, aLbend: 58, aRout: 12, aRfwd: -6, aRbend: 60, squash: 0.99 }), e: 'sineInOut' },
      { t: 0.20, p: P({ rootY: 0.02, rootX: 0.055, lean: 22, twist: 14, hipTwist: -11, headTilt: 2, headNod: 3,
        lLfwd: -30, lLbend: 96, lLlift: 0.42, lRfwd: 54, lRbend: 18, lRlift: 0.10,
        aLout: 13, aLfwd: 43, aLbend: 66, aRout: 12, aRfwd: -34, aRbend: 88, squash: 1.0 }), e: 'sineInOut' },
      { t: 0.32, p: P({ rootY: 0.098, rootX: 0.02, lean: 23, twist: 8, hipTwist: -6,
        lLfwd: -6, lLbend: 70, lLlift: 0.51, lRfwd: 23, lRbend: 40, lRlift: 0.02,
        aLout: 12, aLfwd: 21, aLbend: 50, aRout: 11, aRfwd: -14, aRbend: 70, squash: 1.02, width: 0.99 }), e: 'sineOut' },
      { t: 0.40, p: P({ rootY: 0.045, rootX: 0.0, lean: 22, twist: 0, hipTwist: 0, headTilt: 0,
        lLfwd: 20, lLbend: 34, lLlift: 0.06, lRfwd: -10, lRbend: 66, lRlift: 0.12,
        aLout: 12, aLfwd: -6, aLbend: 60, aRout: 12, aRfwd: 6, aRbend: 58, squash: 0.99 }), e: 'sineInOut' },
      { t: 0.50, p: P({ rootY: 0.02, rootX: -0.055, lean: 22, twist: -14, hipTwist: 11, headTilt: -2, headNod: 3,
        lLfwd: 52, lLbend: 18, lLlift: 0.10, lRfwd: -30, lRbend: 96, lRlift: 0.42,
        aLout: 12, aLfwd: -34, aLbend: 88, aRout: 13, aRfwd: 42, aRbend: 66, squash: 1.0, width: 1 }), e: 'sineInOut' },
    ],
  },

  scrumCrouch: {
    name: 'scrumCrouch', dur: 1.1, loop: true, keys: [
      { t: 0.0, p: P({ crouch: 0.60, lean: 50, lLout: 16, lRout: 17, lLbend: 72, lRbend: 70,
        headNod: -14, aLout: 46, aLfwd: 30, aLbend: 60, aRout: 47, aRfwd: 30, aRbend: 58,
        squash: 0.88, width: 1.12, breath: 0.4 }) },
      { t: 0.55, p: P({ crouch: 0.63, lean: 52, lLbend: 76, lRbend: 74, headNod: -16,
        aLbend: 64, aRbend: 62, squash: 0.875, breath: 0.9, rootY: -0.015 }), e: 'sineInOut' },
      { t: 1.1, p: P({ crouch: 0.60, lean: 50, lLbend: 72, lRbend: 70, headNod: -14,
        aLbend: 60, aRbend: 58, squash: 0.88, breath: 0.4, rootY: 0 }), e: 'sineInOut' },
    ],
  },

  scrumBind: {
    name: 'scrumBind', dur: 1.7, loop: true, keys: [
      { t: 0.0, p: P({ crouch: 0.56, lean: 46, lLout: 17, lRout: 18, lLbend: 60, lRbend: 58,
        aLout: 44, aRout: 45, aLbend: 88, aRbend: 87, squash: 0.90, width: 1.10, breath: 0.3 }) },
      { t: 0.55, p: P({ crouch: 0.585, lean: 47, lLbend: 63, lRbend: 61, aLout: 45, aRout: 46,
        squash: 0.893, width: 1.105, breath: 0.9, rootY: -0.012 }), e: 'sineInOut' },
      { t: 1.05, p: P({ crouch: 0.555, lean: 46, lLbend: 59, lRbend: 58, aLout: 44, aRout: 45,
        squash: 0.902, width: 1.098, breath: 0.2, rootY: 0.004 }), e: 'sineInOut' },
      { t: 1.7, p: P({ crouch: 0.56, lean: 46, lLbend: 60, lRbend: 58, aLout: 44, aRout: 45,
        squash: 0.90, width: 1.10, breath: 0.3, rootY: 0 }), e: 'sineInOut' },
    ],
  },

  scrumDrive: {
    name: 'scrumDrive', dur: 0.68, loop: true, keys: [
      { t: 0.00, p: P({ crouch: 0.55, lean: 48, lLfwd: 20, lLbend: 66, lRfwd: -12, lRbend: 52, lRlift: 0.05,
        aLout: 45, aRout: 46, aLbend: 88, aRbend: 87, squash: 0.90, width: 1.10, rootX: -0.012 }) },
      { t: 0.17, p: P({ crouch: 0.52, lean: 49, lLfwd: 4, lLbend: 50, lRfwd: 6, lRbend: 62, lRlift: 0,
        squash: 0.912, rootX: 0, rootY: 0.012 }), e: 'sineOut' },
      { t: 0.34, p: P({ crouch: 0.55, lean: 48, lLfwd: -12, lLbend: 52, lLlift: 0.05, lRfwd: 21, lRbend: 66, lRlift: 0,
        squash: 0.90, rootX: 0.012, rootY: 0 }), e: 'sineInOut' },
      { t: 0.51, p: P({ crouch: 0.52, lean: 49, lLfwd: 6, lLbend: 62, lLlift: 0, lRfwd: 4, lRbend: 50,
        squash: 0.912, rootX: 0, rootY: 0.012 }), e: 'sineOut' },
      { t: 0.68, p: P({ crouch: 0.55, lean: 48, lLfwd: 20, lLbend: 66, lLlift: 0, lRfwd: -12, lRbend: 52, lRlift: 0.05,
        squash: 0.90, rootX: -0.012, rootY: 0 }), e: 'sineInOut' },
    ],
  },

  lineoutJump: {
    name: 'lineoutJump', dur: 1.85, loop: false, keys: [
      { t: 0.00, p: P({ crouch: 0.12, lLout: 9, lRout: 9, aLout: 24, aRout: 25, aLbend: 30, aRbend: 29 }) },
      { t: 0.20, p: P({ crouch: 0.52, lean: 14, lLbend: 74, lRbend: 72, lLout: 13, lRout: 13,
        aLout: 16, aLfwd: -22, aLbend: 52, aRout: 17, aRfwd: -21, aRbend: 50,
        squash: 0.93, width: 1.05, rootY: -0.17 }), e: 'quadIn' },
      { t: 0.31, p: P({ crouch: 0.0, lean: 2, lLbend: 8, lRbend: 8,
        aLout: 6, aLfwd: 6, aLbend: 8, aRout: 6, aRfwd: 6, aRbend: 8,
        squash: 1.07, width: 0.95, rootY: 0.30 }), e: 'expoOut' },
      { t: 0.52, p: P({ crouch: 0, lean: -3, lLout: 4, lRout: 5, lLbend: 22, lRbend: 20, lLfwd: -10, lRfwd: -8,
        aLout: 2, aLbend: 2, aRout: 2, aRbend: 2, headNod: -8, squash: 1.06, width: 0.94, rootY: 0.62 }), e: 'sineOut' },
      { t: 0.80, p: P({ rootY: 0.66, aLout: 4, aRout: 3, headNod: -6, squash: 1.05 }), e: 'sineInOut' },
      { t: 1.08, p: P({ rootY: 0.34, lean: 4, aLout: 14, aLbend: 42, aRout: 15, aRbend: 40,
        lLbend: 34, lRbend: 32, headNod: 0, squash: 1.01 }), e: 'quadIn' },
      { t: 1.22, p: P({ rootY: 0.0, crouch: 0.50, lean: 13, lLbend: 76, lRbend: 74, lLout: 14, lRout: 14,
        aLout: 20, aLbend: 56, aRout: 21, aRbend: 54, squash: 0.91, width: 1.06 }), e: 'quadIn' },
      { t: 1.42, p: P({ crouch: 0.16, lean: 6, lLbend: 22, lRbend: 21, squash: 1.02, width: 0.99 }), e: 'backOut' },
      { t: 1.85, p: P({ crouch: 0.12, lean: 4, lLbend: 10, lRbend: 10, lLout: 9, lRout: 9,
        aLout: 22, aRout: 23, aLbend: 32, aRbend: 31, squash: 1, width: 1 }), e: 'sineOut' },
    ],
  },

  lineoutLift: {
    name: 'lineoutLift', dur: 1.85, loop: false, keys: [
      { t: 0.00, p: P({ crouch: 0.34, lean: 18, lLout: 15, lRout: 15, lLbend: 48, lRbend: 47,
        aLout: 26, aLfwd: 18, aLbend: 74, aRout: 27, aRfwd: 18, aRbend: 72 }) },
      { t: 0.20, p: P({ crouch: 0.60, lean: 24, lLbend: 84, lRbend: 82, lLout: 17, lRout: 17,
        aLout: 22, aLbend: 92, aRout: 23, aRbend: 90, squash: 0.90, width: 1.07, rootY: -0.20 }), e: 'quadIn' },
      { t: 0.34, p: P({ crouch: 0.16, lean: 8, lLbend: 24, lRbend: 23,
        aLout: 10, aLbend: 26, aRout: 10, aRbend: 25, squash: 1.03, rootY: 0.02 }), e: 'expoOut' },
      { t: 0.50, p: P({ crouch: 0.0, lean: 2, lLbend: 6, lRbend: 6, lLout: 12, lRout: 12,
        aLout: 4, aLbend: 3, aRout: 4, aRbend: 3, squash: 1.05, width: 0.96, rootY: 0.09 }), e: 'backOut' },
      { t: 0.62, p: P({ aLout: 5, aLbend: 5, aRout: 5, aRbend: 5, squash: 1.04, rootY: 0.075 }), e: 'sineOut' },
      { t: 1.00, p: P({ crouch: 0.02, aLout: 5, aRout: 5, squash: 1.04, rootY: 0.08, breath: 0.6 }), e: 'sineInOut' },
      { t: 1.30, p: P({ crouch: 0.22, lean: 12, lLbend: 34, lRbend: 33,
        aLout: 14, aLbend: 40, aRout: 15, aRbend: 39, squash: 0.99, rootY: 0 }), e: 'sineInOut' },
      { t: 1.85, p: P({ crouch: 0.30, lean: 16, lLbend: 44, lRbend: 43, lLout: 14, lRout: 14,
        aLout: 24, aLbend: 66, aRout: 25, aRbend: 64, squash: 1, width: 1 }), e: 'sineOut' },
    ],
  },

  lineoutThrow: {
    name: 'lineoutThrow', dur: 1.6, loop: false, keys: [
      { t: 0.00, p: P({ aLout: 18, aLfwd: 26, aLbend: 62, aRout: 19, aRfwd: 26, aRbend: 60, lean: 2, crouch: 0.08 }) },
      { t: 0.26, p: P({ aLout: 10, aLfwd: 4, aLbend: 122, aRout: 11, aRfwd: 4, aRbend: 120,
        lean: -12, twist: -6, headNod: -10, crouch: 0.14, squash: 1.02, rootY: 0.02 }), e: 'quadOut' },
      { t: 0.40, p: P({ aLout: 8, aLbend: 138, aRout: 9, aRbend: 136, lean: -16, twist: -9,
        crouch: 0.18, squash: 1.03, rootY: 0.03 }), e: 'sineInOut' },
      { t: 0.52, p: P({ aLout: 6, aLfwd: 40, aLbend: 22, aRout: 7, aRfwd: 40, aRbend: 20,
        lean: 16, twist: 8, hipTwist: -6, headNod: 4, crouch: 0.10, squash: 0.98, width: 1.02 }), e: 'expoOut' },
      { t: 0.70, p: P({ aLout: 14, aLfwd: 28, aLbend: 34, aRout: 15, aRfwd: 28, aRbend: 32,
        lean: 20, twist: 5, squash: 0.99 }), e: 'sineOut' },
      { t: 1.05, p: P({ aLout: 16, aLfwd: 14, aLbend: 48, aRout: 17, aRfwd: 14, aRbend: 46,
        lean: 10, twist: 0, hipTwist: 0, headNod: 0, squash: 1 }), e: 'sineInOut' },
      { t: 1.60, p: P({ aLout: 18, aLfwd: 24, aLbend: 60, aRout: 19, aRfwd: 24, aRbend: 58, lean: 2, crouch: 0.08 }), e: 'sineInOut' },
    ],
  },

  carry: {
    name: 'carry', dur: 0.58, loop: true, keys: [
      { t: 0.00, p: P({ lean: 18, twist: -7, hipTwist: 6, rootY: 0.01, rootX: -0.04,
        lLfwd: 42, lLbend: 18, lRfwd: -24, lRbend: 76, lRlift: 0.30,
        aLout: 30, aLfwd: 30, aLbend: 96, aRout: 11, aRfwd: -26, aRbend: 74 }) },
      { t: 0.145, p: P({ rootY: 0.07, rootX: -0.015, twist: -3,
        lLfwd: 16, lLbend: 36, lRfwd: -4, lRbend: 54, lRlift: 0.36,
        aLout: 31, aLbend: 98, aRout: 10, aRfwd: -10, aRbend: 56, squash: 1.014 }), e: 'sineOut' },
      { t: 0.29, p: P({ lean: 18, twist: 7, hipTwist: -6, rootY: 0.01, rootX: 0.04,
        lLfwd: -24, lLbend: 76, lLlift: 0.30, lRfwd: 43, lRbend: 18, lRlift: 0.02,
        aLout: 30, aLbend: 96, aRout: 12, aRfwd: 32, aRbend: 60 }), e: 'sineInOut' },
      { t: 0.435, p: P({ rootY: 0.07, rootX: 0.015, twist: 3,
        lLfwd: -4, lLbend: 54, lLlift: 0.36, lRfwd: 17, lRbend: 36, lRlift: 0,
        aLout: 31, aLbend: 98, aRout: 11, aRfwd: 12, aRbend: 52, squash: 1.014 }), e: 'sineOut' },
      { t: 0.58, p: P({ lean: 18, twist: -7, hipTwist: 6, rootY: 0.01, rootX: -0.04,
        lLfwd: 42, lLbend: 18, lLlift: 0, lRfwd: -24, lRbend: 76, lRlift: 0.30,
        aLout: 30, aLfwd: 30, aLbend: 96, aRout: 11, aRfwd: -26, aRbend: 74 }), e: 'sineInOut' },
    ],
  },

  tackle: {
    /* T-31/T-28 — the tackle per PR-02 + R-06 + C-01 + C-03 + S-03/04/06:
     * a back-in LOAD that drops the hips three frames out, a cubic-out
     * DRIVE through the shoulder, a ONE-FRAME impact (squash 10%, one
     * tight key, S-06), a six-frame recovery that spreads, the FOLD
     * through the hip (rotation, not collapse — C-03), a bounce-out land
     * with ~8% overshoot (S-03) and a settle back. Limbs are staggered
     * (S-04): the near arm wraps two frames before the far one, the head
     * lags the shoulders (headNod on the drive, headTilt — head to the
     * side — on the fold). Ends in the low braced pose the jackal needs. */
    name: 'tackle', dur: 1.25, loop: false, keys: [
      { t: 0.00, p: P({ crouch: 0.2, lean: 20, aLout: 26, aRout: 27, aLbend: 44, aRbend: 43 }) },
      { t: 0.09, p: P({ crouch: 0.55, lean: 32, squash: 0.90, width: 1.08, lLbend: 76, lRbend: 74,
        aLout: 24, aLfwd: -18, aLbend: 58, aRout: 25, aRfwd: -16, aRbend: 56 }), e: 'backIn' },
      { t: 0.12, p: P({}), e: 'hold' },
      { t: 0.19, p: P({ crouch: 0.36, lean: 50, squash: 0.97, aLout: 34, aLfwd: 56, aLbend: 18,
        aRout: 35, aRfwd: 46, aRbend: 24, headNod: 6 }), e: 'cubicOut' },
      { t: 0.21, p: P({ aRfwd: 58, aRbend: 14 }), e: 'quadOut' },
      { t: 0.235, p: P({ crouch: 0.46, lean: 58, squash: 0.90, width: 1.16, headTilt: 7,
        aLout: 44, aLfwd: 58, aLbend: 16, aRout: 45, aRfwd: 58, aRbend: 15 }), e: 'hold' },
      { t: 0.34, p: P({ crouch: 0.52, lean: 64, squash: 1.03, width: 1.12, headTilt: 6 }), e: 'cubicOut' },
      { t: 0.52, p: P({ crouch: 0.82, lean: 74, lLbend: 104, lRbend: 100, rootY: -0.34, headTilt: 9,
        aLout: 44, aLbend: 40, aRout: 45, aRbend: 38 }), e: 'quadIn' },
      { t: 0.66, p: P({ crouch: 1.06, lean: 86, lLbend: 126, lRbend: 124, aLout: 48, aLbend: 54, aRout: 47, aRbend: 52,
        squash: 0.72, width: 1.24, rootY: -0.68, headTilt: 12 }), e: 'bounceOut' },
      { t: 0.80, p: P({ crouch: 1.0, lean: 79, lLbend: 122, lRbend: 120, aLout: 45, aLbend: 52, aRout: 45, aRbend: 50,
        squash: 0.75, width: 1.20, rootY: -0.60, headTilt: 10 }), e: 'sineOut' },
      { t: 1.25, p: P({ crouch: 1.0, lean: 80, lLbend: 122, lRbend: 120, aLout: 44, aLbend: 56, aRout: 45, aRbend: 54,
        squash: 0.75, width: 1.21, rootY: -0.60, headTilt: 10, breath: 0.8 }), e: 'sineOut' },
    ],
  },

  /* T-31 — THE DIVE for the line, per W-15 + R-07: the launch is horizontal
   * through the centre of gravity (not upward), the body extends full length
   * in flight, the landing slides on the forearms and chest, and the reach
   * arm is the last thing to stop. One-shot; the scorer holds the slide
   * through the fanfare ritual. */
  dive: {
    name: 'dive', dur: 1.1, loop: false, keys: [
      { t: 0.00, p: P({ crouch: 0.45, lean: 55, aLfwd: 70, aLbend: 10, aRfwd: 30, aRbend: 18,
        lLbend: 62, lRbend: 40, lLlift: 18, headNod: 5 }) },
      { t: 0.14, p: P({ lean: 84, rootY: 0.22, squash: 1.08, aLfwd: 88, aLbend: 4, aRfwd: 55, aRbend: 10,
        lLbend: 18, lRbend: 10, lLlift: -6, lRlift: -4, headTilt: 4 }), e: 'expoOut' },
      { t: 0.30, p: P({ lean: 88, rootY: -0.55, squash: 0.78, width: 1.20, aLfwd: 90, aLbend: 38, aRfwd: 60, aRbend: 34,
        lLbend: 14, lRbend: 8, headTilt: 6 }), e: 'bounceOut' },
      { t: 0.62, p: P({ lean: 88, rootY: -0.58, aLfwd: 94, aLbend: 30, aRfwd: 52, aRbend: 30,
        squash: 0.76, width: 1.22, lLbend: 10, headTilt: 5 }), e: 'sineOut' },
      { t: 1.10, p: P({ lean: 86, rootY: -0.58, aLfwd: 92, aLbend: 34, aRfwd: 48, aRbend: 36,
        squash: 0.75, width: 1.21, breath: 0.5, headTilt: 6 }), e: 'sineInOut' },
    ],
  },

  grounded: {
    name: 'grounded', dur: 1.9, loop: true, keys: [
      { t: 0.0, p: P({ crouch: 1.0, lean: 80, squash: 0.74, width: 1.22, rootY: -0.62,
        aLout: 54, aLfwd: -34, aLbend: 22, aRout: 40, aRbend: 62, lLbend: 118, lRbend: 124, breath: 0 }) },
      { t: 0.55, p: P({ aLout: 60, aLfwd: -44, aLbend: 12, squash: 0.72, breath: 1, rootY: -0.645, headTilt: 8 }), e: 'expoOut' },
      { t: 1.2, p: P({ aLout: 58, aLfwd: -42, aLbend: 14, squash: 0.755, breath: 0.2, rootY: -0.60, lLbend: 124, lRbend: 118 }), e: 'sineInOut' },
      { t: 1.9, p: P({ aLout: 54, aLfwd: -34, aLbend: 22, squash: 0.74, breath: 0, rootY: -0.62, lLbend: 118, lRbend: 124 }), e: 'sineInOut' },
    ],
  },

  jackal: {
    name: 'jackal', dur: 1.35, loop: true, keys: [
      { t: 0.0, p: P({ crouch: 0.62, lean: 66, lLout: 21, lRout: 22, lLbend: 74, lRbend: 72,
        aLout: 30, aLfwd: 40, aLbend: 106, aRout: 31, aRfwd: 40, aRbend: 104,
        squash: 0.88, width: 1.12, headNod: 12 }) },
      { t: 0.28, p: P({ crouch: 0.70, lean: 71, aLbend: 116, aRbend: 114, rootY: -0.05,
        squash: 0.865, width: 1.13, breath: 0.8 }), e: 'quadIn' },
      { t: 0.50, p: P({ crouch: 0.58, lean: 63, aLbend: 98, aRbend: 96, rootY: 0.03,
        squash: 0.895, width: 1.115, breath: 0.1 }), e: 'backOut' },
      { t: 0.92, p: P({ crouch: 0.65, lean: 68, aLbend: 110, aRbend: 108, rootY: -0.02, squash: 0.878 }), e: 'sineInOut' },
      { t: 1.35, p: P({ crouch: 0.62, lean: 66, aLbend: 106, aRbend: 104, rootY: 0, squash: 0.88, width: 1.12 }), e: 'sineInOut' },
    ],
  },

  cleanout: {
    name: 'cleanout', dur: 1.0, loop: false, keys: [
      { t: 0.00, p: P({ crouch: 0.22, lean: 22, aLout: 24, aRout: 25, aLbend: 46, aRbend: 45 }) },
      { t: 0.16, p: P({ crouch: 0.58, lean: 44, lLbend: 78, lRbend: 76, lLout: 16, lRout: 16,
        aLout: 30, aLfwd: 22, aLbend: 34, aRout: 31, aRfwd: 22, aRbend: 33,
        squash: 0.91, width: 1.07, rootY: -0.10 }), e: 'quadIn' },
      { t: 0.30, p: P({ crouch: 0.40, lean: 56, aLout: 38, aLfwd: 48, aLbend: 16, aRout: 39, aRfwd: 48, aRbend: 15,
        squash: 1.06, width: 1.09, rootX: 0.22, rootY: 0.02, headNod: 6 }), e: 'expoOut' },
      { t: 0.52, p: P({ crouch: 0.44, lean: 50, aLout: 40, aLbend: 26, aRout: 41, aRbend: 25,
        rootX: 0.44, squash: 1.01, width: 1.06 }), e: 'sineOut' },
      { t: 1.00, p: P({ crouch: 0.46, lean: 46, aLout: 36, aLbend: 40, aRout: 37, aRbend: 39,
        rootX: 0.52, squash: 0.98, width: 1.05, breath: 0.7 }), e: 'sineInOut' },
    ],
  },

  maulBind: {
    name: 'maulBind', dur: 0.64, loop: true, keys: [
      { t: 0.00, p: P({ crouch: 0.50, lean: 44, lLout: 16, lRout: 17, lLfwd: 16, lLbend: 58, lRfwd: -10, lRbend: 48,
        aLout: 42, aLfwd: 34, aLbend: 96, aRout: 43, aRfwd: 34, aRbend: 94, squash: 0.91, width: 1.11 }) },
      { t: 0.16, p: P({ crouch: 0.47, lean: 45, lLfwd: 2, lLbend: 46, lRfwd: 6, lRbend: 56, rootY: 0.014, squash: 0.92 }), e: 'sineOut' },
      { t: 0.32, p: P({ crouch: 0.50, lean: 44, lLfwd: -10, lLbend: 48, lRfwd: 17, lRbend: 58, rootY: 0, squash: 0.91 }), e: 'sineInOut' },
      { t: 0.48, p: P({ crouch: 0.47, lean: 45, lLfwd: 6, lLbend: 56, lRfwd: 2, lRbend: 46, rootY: 0.014, squash: 0.92 }), e: 'sineOut' },
      { t: 0.64, p: P({ crouch: 0.50, lean: 44, lLfwd: 16, lLbend: 58, lRfwd: -10, lRbend: 48, rootY: 0, squash: 0.91 }), e: 'sineInOut' },
    ],
  },

  pass: {
    name: 'pass', dur: 0.72, loop: false, keys: [
      { t: 0.00, p: P({ lean: 12, crouch: 0.16, aLout: 24, aLfwd: 26, aLbend: 52, aRout: 25, aRfwd: 26, aRbend: 50 }) },
      { t: 0.11, p: P({ headTurn: 22, twist: -10, hipTwist: 5, lean: 14,
        aLout: 34, aLfwd: 14, aLbend: 62, aRout: 20, aRfwd: 34, aRbend: 44, squash: 0.99 }), e: 'quadOut' },
      { t: 0.26, p: P({ headTurn: 26, twist: 12, hipTwist: -8, lean: 10,
        aLout: 12, aLfwd: 44, aLbend: 20, aRout: 44, aRfwd: 8, aRbend: 26,
        squash: 1.02, width: 1.03, rootX: 0.06 }), e: 'expoOut' },
      { t: 0.42, p: P({ headTurn: 20, twist: 8, aLout: 10, aLfwd: 40, aLbend: 14, aRout: 48, aRbend: 18,
        squash: 1.0, rootX: 0.04 }), e: 'sineOut' },
      { t: 0.72, p: P({ headTurn: 6, twist: 0, hipTwist: 0, lean: 12, crouch: 0.16,
        aLout: 22, aLfwd: 24, aLbend: 48, aRout: 26, aRfwd: 24, aRbend: 46, rootX: 0, squash: 1 }), e: 'sineInOut' },
    ],
  },

  kick: {
    name: 'kick', dur: 1.35, loop: false, keys: [
      { t: 0.00, p: P({ lean: 6, crouch: 0.08, aLout: 18, aRout: 19, aLbend: 30, aRbend: 29 }) },
      { t: 0.20, p: P({ lean: 10, crouch: 0.14, lLfwd: 22, lLbend: 26, aLout: 30, aRout: 24, headNod: 10 }), e: 'sineOut' },
      { t: 0.38, p: P({ lean: -6, crouch: 0.26, twist: -12, hipTwist: 8,
        lLout: 16, lLfwd: 8, lLbend: 34, lRfwd: -44, lRbend: 92, lRlift: 0.16,
        aLout: 48, aLfwd: -20, aLbend: 28, aRout: 34, aRfwd: 22, aRbend: 44,
        squash: 0.97, width: 1.05 }), e: 'quadIn' },
      { t: 0.50, p: P({ lean: 8, twist: 10, hipTwist: -8, crouch: 0.10,
        lRfwd: 62, lRbend: 6, lRlift: 0.30, lLbend: 12,
        aLout: 54, aLfwd: -8, aLbend: 20, aRout: 26, aRfwd: 10, aRbend: 34,
        squash: 1.05, width: 0.97, rootY: 0.05 }), e: 'expoOut' },
      { t: 0.68, p: P({ lean: 2, twist: 6, lRfwd: 88, lRbend: 4, lRlift: 0.66,
        aLout: 50, aRout: 30, squash: 1.06, rootY: 0.12, headNod: -4 }), e: 'sineOut' },
      { t: 0.92, p: P({ lean: 6, twist: 2, lRfwd: 46, lRbend: 26, lRlift: 0.24,
        aLout: 34, aRout: 24, squash: 1.01, rootY: 0.03 }), e: 'sineInOut' },
      { t: 1.35, p: P({ lean: 6, twist: 0, hipTwist: 0, lRfwd: 0, lRbend: 6, lRlift: 0,
        lLout: 7, lLfwd: 0, lLbend: 6, aLout: 18, aRout: 19, aLbend: 30, aRbend: 29,
        crouch: 0.06, squash: 1, width: 1, headNod: 0 }), e: 'sineOut' },
    ],
  },

  catchHigh: {
    name: 'catchHigh', dur: 1.3, loop: false, keys: [
      { t: 0.00, p: P({ headNod: -18, aLout: 20, aRout: 21, aLbend: 40, aRbend: 39, crouch: 0.14, lean: -4 }) },
      { t: 0.22, p: P({ headNod: -24, aLout: 8, aLbend: 8, aRout: 8, aRbend: 8, crouch: 0.04,
        squash: 1.05, width: 0.95, rootY: 0.13, lean: -8 }), e: 'quadOut' },
      { t: 0.36, p: P({ aLout: 5, aLbend: 4, aRout: 5, aRbend: 4, rootY: 0.20, squash: 1.07 }), e: 'expoOut' },
      { t: 0.52, p: P({ headNod: -8, aLout: 12, aLbend: 40, aRout: 13, aRbend: 38,
        rootY: 0.04, crouch: 0.20, squash: 0.98, lean: 6 }), e: 'quadIn' },
      { t: 0.70, p: P({ aLout: 22, aLfwd: 34, aLbend: 78, aRout: 23, aRfwd: 34, aRbend: 76,
        crouch: 0.26, lean: 14, rootY: 0, squash: 0.97, width: 1.03, headNod: 4 }), e: 'backOut' },
      { t: 1.30, p: P({ aLout: 24, aLfwd: 30, aLbend: 72, aRout: 25, aRfwd: 30, aRbend: 70,
        crouch: 0.20, lean: 12, squash: 1, width: 1, headNod: 0, breath: 0.6 }), e: 'sineInOut' },
    ],
  },

  refSignal: {
    name: 'refSignal', dur: 1.9, loop: false, keys: [
      { t: 0.00, p: P({ aLout: 10, aRout: 11, aLbend: 20, aRbend: 19 }) },
      { t: 0.14, p: P({ aRout: 22, aRfwd: 40, aRbend: 110, headNod: -4, squash: 1.01 }), e: 'quadOut' },
      { t: 0.30, p: P({ aRout: 26, aRfwd: 44, aRbend: 118, headNod: -6 }), e: 'sineInOut' },
      { t: 0.46, p: P({ aRout: 62, aRfwd: 10, aRbend: 6, aLout: 8, lean: -4, squash: 1.03, headNod: 0 }), e: 'expoOut' },
      { t: 1.40, p: P({ aRout: 60, aRbend: 5, squash: 1.02, breath: 0.5 }), e: 'sineInOut' },
      { t: 1.90, p: P({ aRout: 11, aRfwd: 0, aRbend: 19, aLout: 10, lean: 0, squash: 1 }), e: 'sineInOut' },
    ],
  },

  refReady: {
    name: 'refReady', dur: 3.3, loop: true, keys: [
      { t: 0.0, p: P({ crouch: 0.10, lean: 6, headTurn: -16, aLout: 14, aRout: 15, aLbend: 34, aRbend: 33 }) },
      { t: 0.9, p: P({ headTurn: 14, breath: 0.7, rootX: 0.02, squash: 1.003 }), e: 'sineInOut' },
      { t: 1.7, p: P({ headTurn: -8, crouch: 0.13, breath: 0, rootX: -0.02 }), e: 'sineInOut' },
      { t: 2.5, p: P({ headTurn: 18, breath: 0.7, rootX: 0.015 }), e: 'sineInOut' },
      { t: 3.3, p: P({ headTurn: -16, crouch: 0.10, breath: 0, rootX: 0 }), e: 'sineInOut' },
    ],
  },
};

/* ================================================================== */
/* BILLBOARD RENDERER                                                 */
/* ================================================================== */

export interface CDraw {
  sx: number; sy: number; scale: number;
  pose: CPose;
  kit: string; kitDark: string; kitLight: string; trim: string;
  shorts: string; socks: string; skin: string; hair: string;
  number: number;
  fromBehind: boolean;
  cap: boolean;
  clarity: number;
  /** papercraft: true when the camera sees the player edge-on — squashes the figure */
  sideOn?: boolean;
}

const OUTLINE = '#20202b';
const D = Math.PI / 180;

function fore(deg: number): number { return Math.cos(Math.min(85, Math.abs(deg)) * D); }

function cap(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, w1: number, w2: number, fill: string, dark?: string) {
  const ang = Math.atan2(by - ay, bx - ax);
  const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(ax + nx * w1, ay + ny * w1);
  ctx.lineTo(bx + nx * w2, by + ny * w2);
  ctx.lineTo(bx - nx * w2, by - ny * w2);
  ctx.lineTo(ax - nx * w1, ay - ny * w1);
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1, w1 * 0.42); ctx.lineJoin = 'round'; ctx.stroke();
  if (dark) {
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.lineTo(bx - nx * w2, by - ny * w2); ctx.lineTo(ax - nx * w1, ay - ny * w1);
    ctx.closePath(); ctx.fillStyle = dark; ctx.fill();
  }
}

export function drawCoronal(ctx: CanvasRenderingContext2D, a: CDraw) {
  const S = a.scale;
  if (S < 1.2) return;
  const p = a.pose;
  const cl = Math.max(0.25, Math.min(1, a.clarity));
  ctx.globalAlpha = 0.35 + cl * 0.65;

  const gx = a.sx + p.rootX * S;
  const gy = a.sy;

  const legLen = 0.86 * (1 - p.crouch * 0.40) * p.squash;
  /* LEAN INTO THE RUN. The clips author `lean` (0° idle, 11° jog, 22° sprint) but
   * the old render only shifted the shoulder by sin(lean)·2%, which was invisible.
   * In a front/back billboard, leaning forward reads as the trunk compressing:
   * the shoulders and head drop toward the hips. Foreshortening the torso by up
   * to a third sells the sprint without needing a side profile. */
  const leanR = Math.abs(Math.sin(p.lean * D));
  const torso = 0.56 * p.squash * (1 - leanR * 0.34);
  // Papercraft: seen edge-on, the paper is a sliver — the figure squashes to a
  // thin profile so a turn reads as "a different side of the paper".
  const paperWidth = a.sideOn ? 0.34 : 1.0;
  const shoulderHalf = 0.31 * p.width * paperWidth;
  const hipHalf = 0.22 * p.width * paperWidth;
  const headR = 0.135;

  const hipY = gy - (legLen + p.rootY) * S;
  const shY = hipY - torso * S;

  const tw = Math.sin(p.twist * D);
  const shSpanL = shoulderHalf * (1 - tw * 0.30) * S;
  const shSpanR = shoulderHalf * (1 + tw * 0.30) * S;
  const shOff = tw * 0.05 * S;
  const hw = Math.sin(p.hipTwist * D);
  const hipL = hipHalf * (1 - hw * 0.25) * S;
  const hipR = hipHalf * (1 + hw * 0.25) * S;

  const airborne = Math.max(0, p.rootY);
  ctx.save();
  ctx.globalAlpha = (0.34 - airborne * 0.20) * (0.35 + cl * 0.65);
  ctx.beginPath();
  ctx.ellipse(gx, gy, S * (0.34 + airborne * 0.20), S * (0.11 + airborne * 0.05), 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0c1207'; ctx.fill();
  ctx.restore();

  const leg = (out: number, fwd: number, bend: number, lift: number, side: number, hipX: number) => {
    const f = fore(fwd);
    const hx = gx + hipX * side;
    const hy = hipY;
    const thigh = 0.44 * S * (1 - p.crouch * 0.28);
    const shin = 0.42 * S * (1 - p.crouch * 0.28);
    const kx = hx + Math.sin(out * D) * thigh * side * 0.55 + Math.sin(fwd * D) * thigh * 0.22 * side;
    const ky = hy + Math.cos(out * D) * thigh * f * (1 - bend * 0.0016);
    const ax2 = kx + Math.sin(out * D) * shin * side * 0.18 - Math.sin(bend * D) * shin * 0.28 * side;
    const ay2 = ky + Math.cos(bend * D * 0.55) * shin - lift * S;
    cap(ctx, hx, hy, kx, ky, S * 0.095, S * 0.082, a.shorts, '#d9d5c7');
    cap(ctx, kx, ky, ax2, ay2, S * 0.078, S * 0.058, a.socks, a.kitDark);
    ctx.beginPath();
    ctx.ellipse(ax2, ay2 + S * 0.02, S * 0.085, S * 0.045, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2b35'; ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1, S * 0.016); ctx.stroke();
  };
  if (p.lLfwd >= p.lRfwd) {
    leg(p.lRout, p.lRfwd, p.lRbend, p.lRlift, 1, hipR);
    leg(p.lLout, p.lLfwd, p.lLbend, p.lLlift, -1, hipL);
  } else {
    leg(p.lLout, p.lLfwd, p.lLbend, p.lLlift, -1, hipL);
    leg(p.lRout, p.lRfwd, p.lRbend, p.lRlift, 1, hipR);
  }

  const arm = (out: number, fwd: number, bend: number, side: number, span: number, front: boolean) => {
    const f = fore(fwd);
    const sxp = gx + span * side + shOff;
    const syp = shY + Math.sin(p.lean * D) * 0.02 * S;
    const upper = 0.30 * S, lower = 0.28 * S;
    const ex = sxp + Math.sin(out * D) * upper * side + Math.sin(fwd * D) * upper * 0.30 * side;
    const ey = syp + Math.cos(out * D) * upper * f;
    const hx = ex + Math.sin((out - bend * 0.5) * D) * lower * side;
    const hy = ey + Math.cos(Math.min(88, bend * 0.9) * D) * lower * f;
    const col = front ? a.kit : a.kitDark;
    cap(ctx, sxp, syp, ex, ey, S * 0.088, S * 0.066, col, front ? a.kitDark : undefined);
    cap(ctx, ex, ey, hx, hy, S * 0.062, S * 0.05, a.skin);
    ctx.beginPath(); ctx.arc(hx, hy, S * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = a.skin; ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1, S * 0.016); ctx.stroke();
  };
  arm(p.aRout, p.aRfwd, p.aRbend, 1, shSpanR, false);

  const breathe = 1 + p.breath * 0.018;
  ctx.beginPath();
  ctx.moveTo(gx - shSpanL * breathe + shOff, shY);
  ctx.lineTo(gx + shSpanR * breathe + shOff, shY);
  ctx.lineTo(gx + hipR, hipY);
  ctx.lineTo(gx - hipL, hipY);
  ctx.closePath();
  ctx.fillStyle = a.kit; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1.2, S * 0.026); ctx.lineJoin = 'round'; ctx.stroke();

  ctx.beginPath();
  const shadeSide = tw >= 0 ? 1 : -1;
  ctx.moveTo(gx + shOff, shY);
  ctx.lineTo(gx + shadeSide * (shadeSide > 0 ? shSpanR : shSpanL) * breathe + shOff, shY);
  ctx.lineTo(gx + shadeSide * (shadeSide > 0 ? hipR : hipL), hipY);
  ctx.lineTo(gx, hipY);
  ctx.closePath();
  ctx.fillStyle = a.kitDark; ctx.fill();

  ctx.beginPath();
  ctx.ellipse(gx + shOff, shY + S * 0.012, shoulderHalf * S * 0.42, S * 0.035, 0, 0, Math.PI * 2);
  ctx.fillStyle = a.trim; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1, S * 0.014); ctx.stroke();

  ctx.save();
  ctx.globalAlpha *= 0.92;
  ctx.beginPath();
  const hoopY = shY + (hipY - shY) * 0.44;
  const hoopH = (hipY - shY) * 0.17;
  ctx.moveTo(gx - shSpanL * 0.94 + shOff, hoopY);
  ctx.lineTo(gx + shSpanR * 0.94 + shOff, hoopY);
  ctx.lineTo(gx + hipR * 1.04, hoopY + hoopH);
  ctx.lineTo(gx - hipL * 1.04, hoopY + hoopH);
  ctx.closePath();
  ctx.fillStyle = a.trim; ctx.fill();
  ctx.restore();

  const hx2 = gx + shOff + Math.sin(p.headTurn * D) * 0.03 * S + Math.sin(p.headTilt * D) * 0.04 * S;
  const hy2 = shY - (0.11 + headR) * S * p.squash + Math.sin(p.headNod * D) * 0.05 * S;
  cap(ctx, gx + shOff, shY, hx2, hy2 + headR * S * 0.6, S * 0.055, S * 0.05, a.skin);
  ctx.beginPath(); ctx.arc(hx2, hy2, headR * S, 0, Math.PI * 2);
  ctx.fillStyle = a.skin; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1.2, S * 0.022); ctx.stroke();

  if (a.cap) {
    ctx.beginPath(); ctx.arc(hx2, hy2, headR * S * 1.03, 0, Math.PI * 2);
    ctx.strokeStyle = a.trim; ctx.lineWidth = Math.max(1.6, S * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx2, hy2 - headR * S * 0.2, headR * S * 0.95, Math.PI, Math.PI * 2);
    ctx.closePath(); ctx.fillStyle = a.trim; ctx.fill();
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = Math.max(1, S * 0.016); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(hx2, hy2 - headR * S * 0.16, headR * S * 0.94, Math.PI * 1.02, Math.PI * 1.98);
    ctx.closePath(); ctx.fillStyle = a.hair; ctx.fill();
  }
  if (!a.fromBehind && S > 14) {
    const ex = headR * S * 0.34;
    ctx.fillStyle = '#2a2a33';
    ctx.beginPath(); ctx.arc(hx2 - ex, hy2 - headR * S * 0.08, Math.max(0.9, S * 0.016), 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hx2 + ex, hy2 - headR * S * 0.08, Math.max(0.9, S * 0.016), 0, Math.PI * 2); ctx.fill();
  }

  arm(p.aLout, p.aLfwd, p.aLbend, -1, shSpanL, true);

  if (S > 20 && a.fromBehind) {
    ctx.font = `900 ${Math.round(S * 0.26)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const ny = shY + (hipY - shY) * 0.30;
    ctx.lineWidth = Math.max(2, S * 0.04); ctx.strokeStyle = 'rgba(16,16,22,0.9)';
    ctx.strokeText(String(a.number), gx + shOff, ny);
    ctx.fillStyle = a.trim;
    ctx.fillText(String(a.number), gx + shOff, ny);
  }

  ctx.globalAlpha = 1;
}
