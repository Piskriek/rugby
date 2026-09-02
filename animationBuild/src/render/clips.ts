/**
 * ANIMATION DATASET — the paper-puppet clip library.
 *
 * A Pose is a set of joint channels in radians/metres. Clips are keyframe tracks
 * over poses. Rugby mechanics are baked into the keys:
 *   - anticipation dips before every explode (jump, kick, tackle, pass whip)
 *   - weight via hip-height dips on contact frames and stride double-bobs
 *   - seamless loops: cyclic clips interpolate back into key 0
 *   - fall/get-up clips end exactly in the lying hold pose so the rotated
 *     standing card and the lying artwork match silhouettes at the hand-over
 */

export interface Pose {
  /** hip height above ground (m) — crouch / jump / lie */
  hip: number;
  /** torso pitch, + = fold forward */
  lean: number;
  /** coronal tilt, + = tip to actor's right */
  roll: number;
  /** torso twist about the spine */
  twist: number;
  headP: number; headY: number;
  /** shoulder pitch: 0 = hanging, + swings forward, PI = overhead */
  aL: number; aR: number;
  /** shoulder abduction: + = out from the body */
  abL: number; abR: number;
  /** elbow flex 0..~2.6 */
  eL: number; eR: number;
  /** hip pitch: + = thigh forward */
  lL: number; lR: number;
  /** hip abduction: + = leg out */
  adL: number; adR: number;
  /** knee flex */
  kL: number; kR: number;
  /** 0..1 ball clamped to the chest */
  ball: number;
  /** -1 left arm carries .. +1 right arm carries */
  ballSide: number;
  /** 0 upright .. 1 fully on the deck */
  fall: number;
  /** +1 went forward (lands face-down) .. -1 went backward (face-up) */
  fallD: number;
}

export const POSE_CH: (keyof Pose)[] = [
  'hip', 'lean', 'roll', 'twist', 'headP', 'headY',
  'aL', 'aR', 'abL', 'abR', 'eL', 'eR',
  'lL', 'lR', 'adL', 'adR', 'kL', 'kR',
  'ball', 'ballSide', 'fall', 'fallD',
];

export const STAND: Pose = {
  hip: 0.94, lean: 0.06, roll: 0, twist: 0, headP: 0.02, headY: 0,
  aL: 0.12, aR: 0.12, abL: 0.12, abR: 0.12, eL: 0.55, eR: 0.55,
  lL: 0.03, lR: -0.03, adL: 0.07, adR: 0.07, kL: 0.09, kR: 0.09,
  ball: 0, ballSide: 0.6, fall: 0, fallD: 1,
};

export type Ease = 's' | 'l' | 'o' | 'i';
export interface Key { t: number; e?: Ease; p: Partial<Pose> }
export interface Clip { dur: number; loop: boolean; keys: Key[] }

function ease(e: Ease, t: number): number {
  switch (e) {
    case 'l': return t;
    case 'o': return 1 - (1 - t) * (1 - t);
    case 'i': return t * t;
    default: return t * t * (3 - 2 * t);
  }
}

/** gait generator: contact / mid-stance / contact / mid-stance, seamless loop */
function genRun(dur: number, amp: number, lean: number, dip: number, armBend: number): Clip {
  const c = (s: number): Partial<Pose> => ({
    lL: amp * 0.78 * s, kL: amp * 0.28 * s + 0.12, lR: -amp * 0.62 * s, kR: amp * 1.35 * s + 0.35,
    aR: amp * 0.66 * s, eR: armBend, aL: -amp * 0.58 * s, eL: armBend + 0.1,
    hip: 0.94 - dip, lean, twist: -0.09 * amp * s, roll: 0.05 * s,
    headP: -0.07 + lean * 0.35, abL: 0.13, abR: 0.13,
  });
  const m = (s: number): Partial<Pose> => ({
    lL: amp * 0.06 * s, kL: amp * 0.5 * s + 0.16, lR: amp * 0.5 * s, kR: amp * 1.65 * s + 0.3,
    aR: amp * 0.1 * s, eR: armBend + 0.1, aL: -amp * 0.1 * s, eL: armBend + 0.2,
    hip: 0.94 - dip * 0.2, lean: lean * 0.94, twist: 0, roll: 0,
    headP: -0.07 + lean * 0.35, abL: 0.13, abR: 0.13,
  });
  const neg = (p: Partial<Pose>): Partial<Pose> => {
    const o: Partial<Pose> = { ...p };
    o.lL = p.lR; o.kL = p.kR; o.lR = p.lL; o.kR = p.kL;
    o.aL = p.aR; o.eL = p.eR; o.aR = p.aL; o.eR = p.eL;
    o.twist = -(p.twist ?? 0); o.roll = -(p.roll ?? 0);
    return o;
  };
  return {
    dur, loop: true, keys: [
      { t: 0, e: 's', p: c(1) },
      { t: 0.25, e: 's', p: m(1) },
      { t: 0.5, e: 's', p: neg(c(1)) },
      { t: 0.75, e: 's', p: neg(m(1)) },
    ],
  };
}

/** mirror a partial pose across the sagittal plane (swap L/R channels) */
function mirrorPar(p: Partial<Pose>): Partial<Pose> {
  const o: Partial<Pose> = { ...p };
  o.aL = p.aR; o.aR = p.aL;
  o.abL = p.abR; o.abR = p.abL;
  o.eL = p.eR; o.eR = p.eL;
  o.lL = p.lR; o.lR = p.lL;
  o.adL = p.adR; o.adR = p.adL;
  o.kL = p.kR; o.kR = p.kL;
  if (p.roll !== undefined) o.roll = -p.roll;
  if (p.twist !== undefined) o.twist = -p.twist;
  if (p.headY !== undefined) o.headY = -p.headY;
  if (p.ballSide !== undefined) o.ballSide = -p.ballSide;
  return o;
}
export function mirrorClip(c: Clip): Clip {
  return { dur: c.dur, loop: c.loop, keys: c.keys.map(k => ({ t: k.t, e: k.e, p: mirrorPar(k.p) })) };
}

const LIE_F: Partial<Pose> = {
  fall: 1, fallD: 1, hip: 0.22, lean: 1.15, aL: 0.5, aR: 0.3, eL: 1.0, eR: 1.2,
  lL: 0.25, lR: 0.55, kL: 1.0, kR: 1.4, headY: 0.75, headP: 0.1, abL: 0.2, abR: 0.2,
};
const LIE_B: Partial<Pose> = {
  fall: 1, fallD: -1, hip: 0.22, lean: -0.45, abL: 1.15, abR: 1.25, aL: 0.45, aR: 0.4,
  eL: 0.35, eR: 0.3, lL: 0.35, lR: 0.2, kL: 1.5, kR: 0.95, headP: -0.25, headY: -0.2,
};

export const CLIPS: Record<string, Clip> = {
  jog: genRun(0.72, 0.5, 0.12, 0.045, 1.5),
  run: genRun(0.58, 0.85, 0.24, 0.08, 1.55),
  sprint: genRun(0.46, 1.15, 0.36, 0.12, 1.6),
  walk: genRun(1.05, 0.32, 0.05, 0.02, 0.7),

  idle: {
    dur: 2.6, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.945, aL: 0.12, aR: 0.12, eL: 0.55, eR: 0.55 } },
      { t: 0.5, e: 's', p: { hip: 0.925, aL: 0.17, aR: 0.16, eL: 0.62, eR: 0.6, headY: 0.08, roll: 0.02, lean: 0.07 } },
    ],
  },
  /** lateral movement cycle: body stays square to the opposition, feet step-and-close */
  strafe: {
    dur: 0.62, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.8, lean: 0.26, roll: 0.07, adR: 0.34, adL: -0.06, kL: 0.5, kR: 0.45, lL: 0.12, lR: 0.1, aL: 0.55, aR: 0.62, eL: 1.0, eR: 1.0, abL: 0.74, abR: 0.8, headP: -0.06 } },
      { t: 0.25, e: 's', p: { hip: 0.845, roll: 0.02, adR: 0.18, adL: 0.06, kL: 0.62, kR: 0.34, lL: 0.16, lR: 0.06, aL: 0.6, aR: 0.56, eL: 1.05, eR: 0.95, abL: 0.78, abR: 0.76 } },
      { t: 0.5, e: 's', p: { hip: 0.79, lean: 0.26, roll: -0.05, adR: -0.04, adL: 0.3, kL: 0.42, kR: 0.56, lL: 0.08, lR: 0.14, aL: 0.62, aR: 0.55, eL: 0.95, eR: 1.05, abL: 0.8, abR: 0.74, headP: -0.06 } },
      { t: 0.75, e: 's', p: { hip: 0.845, roll: 0.0, adR: 0.06, adL: 0.16, kL: 0.36, kR: 0.6, lL: 0.05, lR: 0.17, aL: 0.56, aR: 0.6, eL: 0.95, eR: 1.0, abL: 0.76, abR: 0.78 } },
    ],
  },
  shuffle: {
    dur: 0.9, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.82, lean: 0.32, kL: 0.55, kR: 0.5, lL: 0.12, lR: 0.06, aL: 0.5, aR: 0.55, eL: 0.95, eR: 0.95, abL: 0.72, abR: 0.78, adL: 0.14, adR: -0.04, headP: -0.06 } },
      { t: 0.25, e: 's', p: { hip: 0.85, adL: 0.02, adR: 0.1, kL: 0.4, kR: 0.62, aL: 0.6, aR: 0.5, eL: 1.0, eR: 0.9 } },
      { t: 0.5, e: 's', p: { hip: 0.82, lean: 0.32, kL: 0.5, kR: 0.55, lL: 0.06, lR: 0.12, aL: 0.55, aR: 0.5, eL: 0.95, eR: 0.95, abL: 0.78, abR: 0.72, adL: -0.04, adR: 0.14, headP: -0.06 } },
      { t: 0.75, e: 's', p: { hip: 0.85, adL: 0.1, adR: 0.02, kL: 0.62, kR: 0.4, aL: 0.5, aR: 0.6, eL: 0.9, eR: 1.0 } },
    ],
  },

  scrumBind: {
    dur: 0.6, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.82, lean: 0.2 } },
      { t: 0.55, e: 'i', p: { hip: 0.62, lean: 0.55, lL: 0.85, lR: 0.85, kL: 1.5, kR: 1.5, aL: 0.95, aR: 0.95, eL: 1.15, eR: 1.15, headP: -0.3 } },
      { t: 1, e: 's', p: { hip: 0.6, lean: 0.58, lL: 0.88, lR: 0.88, kL: 1.55, kR: 1.55, aL: 1.0, aR: 1.0, eL: 1.2, eR: 1.2, headP: -0.32 } },
    ],
  },
  scrumShove: {
    dur: 1.0, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.58, lean: 0.6, lL: 1.05, kL: 1.75, lR: 0.65, kR: 1.05, aL: 1.0, aR: 1.0, eL: 1.2, eR: 1.2, headP: -0.32, twist: 0.03 } },
      { t: 0.5, e: 's', p: { hip: 0.6, lean: 0.56, lL: 0.65, kL: 1.05, lR: 1.05, kR: 1.75, aL: 1.0, aR: 1.0, eL: 1.2, eR: 1.2, headP: -0.3, twist: -0.03 } },
    ],
  },

  lineoutJump: {
    dur: 1.05, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.9 } },
      { t: 0.16, e: 'i', p: { hip: 0.6, lean: 0.3, kL: 1.3, kR: 1.3, lL: 0.5, lR: 0.5, aL: 0.5, aR: 0.5, eL: 1.2, eR: 1.2 } },
      { t: 0.42, e: 'o', p: { hip: 1.42, lean: 0.04, lL: 0.06, kL: 0.06, lR: -0.05, kR: 0.1, aL: 3.0, aR: 3.1, eL: 0.1, eR: 0.1, abL: 0.06, abR: 0.06, headP: -0.12 } },
      { t: 0.7, e: 's', p: { hip: 1.3, lL: 0.35, kL: 0.8, lR: 0.2, kR: 0.6, aL: 2.9, aR: 3.0, eL: 0.3, eR: 0.3 } },
      { t: 1, e: 'o', p: { hip: 0.8, lean: 0.28, lL: 0.5, kL: 1.2, lR: 0.45, kR: 1.15, aL: 0.7, aR: 0.7, eL: 1.0, eR: 1.0 } },
    ],
  },
  lift: {
    dur: 0.8, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.9 } },
      { t: 0.3, e: 'i', p: { hip: 0.62, kL: 1.4, kR: 1.4, lL: 0.6, lR: 0.6, aL: 2.6, aR: 2.6, eL: 0.3, eR: 0.3 } },
      { t: 0.6, e: 'o', p: { hip: 0.8, aL: 3.0, aR: 3.0, eL: 0.15, eR: 0.15, kL: 0.5, kR: 0.5 } },
      { t: 1, e: 's', p: { hip: 0.72, aL: 2.9, aR: 2.9, eL: 0.2, eR: 0.2, kL: 0.8, kR: 0.8 } },
    ],
  },

  kick: {
    dur: 1.2, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.93, lean: 0.1, lL: 0.3, kL: 0.1, lR: -0.25, kR: 0.5, aL: 0.4, aR: 0.3, eL: 0.8, eR: 0.8 } },
      { t: 0.34, e: 'i', p: { hip: 0.9, lean: 0.2, lR: -1.0, kR: 1.7, lL: 0.05, kL: 0.15, aL: 0.9, aR: -0.3, abR: 0.8, abL: 0.3, eL: 1.0, eR: 0.5, headP: 0.05 } },
      { t: 0.58, e: 'o', p: { hip: 0.96, lean: 0.14, lR: 0.95, kR: 0.12, lL: -0.05, kL: 0.1, aL: 1.3, aR: -0.5, abR: 0.9, abL: 0.35, eL: 0.6, eR: 0.4 } },
      { t: 0.82, e: 's', p: { hip: 0.92, lean: 0.3, lR: 1.35, kR: 0.3, adR: -0.35, lL: 0.1, kL: 0.3, aL: 1.7, aR: -0.7, eL: 0.3, eR: 0.3, headP: -0.1 } },
      { t: 1, e: 's', p: { hip: 0.9, lean: 0.18, lR: 0.5, kR: 0.3, lL: 0.02, kL: 0.1, aL: 0.8, aR: -0.2, eL: 0.6, eR: 0.6 } },
    ],
  },

  passSpin: {
    dur: 0.62, loop: false, keys: [
      { t: 0, e: 's', p: { twist: -0.5, lean: 0.16, hip: 0.9, lL: 0.25, lR: -0.2, kR: 0.5, aL: 0.55, aR: 0.25, eL: 1.5, eR: 1.5, ball: 1, ballSide: -0.6, headY: -0.2 } },
      { t: 0.3, e: 'i', p: { twist: -0.62, hip: 0.88, aL: 0.4, aR: 0.15, eL: 1.7, eR: 1.7, ball: 1, ballSide: -0.7, lean: 0.18 } },
      { t: 0.55, e: 'o', p: { twist: 0.5, roll: 0.12, hip: 0.93, lL: -0.1, lR: 0.35, aL: 2.1, aR: 1.95, eL: 0.25, eR: 0.35, ball: 0, headY: 0.3 } },
      { t: 1, e: 's', p: { twist: 0.58, hip: 0.93, aL: 2.2, aR: 2.05, eL: 0.2, eR: 0.3, ball: 0, headY: 0.25, lean: 0.12 } },
    ],
  },
  catch: {
    dur: 0.55, loop: false, keys: [
      { t: 0, e: 's', p: { aL: 2.5, aR: 2.6, eL: 0.35, eR: 0.35, abL: 0.25, abR: 0.25, headP: -0.12, hip: 0.92, ball: 0 } },
      { t: 0.5, e: 'i', p: { aL: 2.3, aR: 2.4, eL: 0.5, eR: 0.5, ball: 0.6, abL: 0.22, abR: 0.22 } },
      { t: 1, e: 'o', p: { aL: 1.35, aR: 1.45, eL: 1.5, eR: 1.5, ball: 1, hip: 0.89, lean: 0.12, headP: 0.02 } },
    ],
  },

  tackleHit: {
    dur: 0.75, loop: false, keys: [
      { t: 0, e: 's', p: { hip: 0.86, lean: 0.2, lR: -0.5, kR: 1.2, lL: 0.3, kL: 0.3, aL: 1.15, aR: 0.95, eL: 0.45, eR: 0.5, abL: 0.5, abR: 0.5, headP: -0.18, roll: 0.1 } },
      { t: 0.35, e: 'i', p: { hip: 0.72, lean: 0.5, lR: -0.1, kR: 0.9, aL: 1.5, aR: 1.35, eL: 0.6, eR: 0.6, headP: -0.25, roll: 0.14 } },
      { t: 0.7, e: 'o', p: { hip: 0.6, lean: 0.62, lR: 0.55, kR: 1.0, lL: 0.5, kL: 1.1, aL: 1.8, aR: 1.7, eL: 1.5, eR: 1.5, abL: 0.3, abR: 0.3 } },
      { t: 1, e: 's', p: { hip: 0.56, lean: 0.6, lR: 0.6, kR: 1.1, lL: 0.55, kL: 1.2, aL: 1.85, aR: 1.75, eL: 1.8, eR: 1.8, abL: 0.26, abR: 0.26 } },
    ],
  },
  tackled: {
    dur: 0.85, loop: false, keys: [
      { t: 0, e: 's', p: { ball: 1, lean: 0.28, hip: 0.9 } },
      { t: 0.3, e: 's', p: { ball: 1, lean: 0.48, roll: 0.28, hip: 0.82, lL: 0.4, kL: 0.7, lR: 0.2, kR: 0.9, headP: 0.1 } },
      { t: 0.7, e: 'i', p: { fall: 0.55, fallD: 1, lean: 0.95, hip: 0.6, lL: 0.7, kL: 1.1, aL: 1.2, aR: 1.4, eL: 1.2, eR: 1.2, ball: 1 } },
      { t: 1, e: 's', p: { ...LIE_F } },
    ],
  },
  diveFront: {
    dur: 0.8, loop: false, keys: [
      { t: 0, e: 's', p: { ball: 1, lean: 0.5, hip: 0.85, lL: 0.3, lR: -0.4, kR: 1.0, aL: 1.2, aR: 1.2, eL: 0.5, eR: 0.5 } },
      { t: 0.45, e: 'i', p: { fall: 0.5, fallD: 1, lean: 1.15, hip: 0.6, aL: 2.7, aR: 2.75, eL: 0.15, eR: 0.15, lL: 0.5, kL: 0.7, lR: 0.8, kR: 1.0, ball: 1 } },
      { t: 1, e: 's', p: { ...LIE_F, aL: 2.8, aR: 2.85, eL: 0.1, eR: 0.1, lean: 1.2 } },
    ],
  },
  fallBack: {
    dur: 0.8, loop: false, keys: [
      { t: 0, e: 's', p: { lean: -0.05, hip: 0.9, ball: 1 } },
      { t: 0.35, e: 'i', p: { fall: 0.45, fallD: -1, lean: -0.35, hip: 0.65, lL: 1.1, lR: 1.3, kL: 0.5, kR: 0.4, aL: 2.1, aR: 2.3, eL: 0.6, eR: 0.6, roll: -0.15, ball: 1 } },
      { t: 1, e: 's', p: { ...LIE_B } },
    ],
  },

  lieFront: { dur: 2.4, loop: true, keys: [{ t: 0, e: 's', p: { ...LIE_F } }, { t: 0.5, e: 's', p: { ...LIE_F, hip: 0.225, headY: 0.7, kL: 1.05 } }] },
  lieBack: { dur: 2.6, loop: true, keys: [{ t: 0, e: 's', p: { ...LIE_B } }, { t: 0.5, e: 's', p: { ...LIE_B, hip: 0.23, kL: 1.45, abL: 1.1 } }] },

  getUpFront: {
    dur: 1.0, loop: false, keys: [
      { t: 0, e: 's', p: { ...LIE_F } },
      { t: 0.35, e: 'o', p: { fall: 0.6, fallD: 1, hip: 0.3, lean: 0.9, aL: 2.9, aR: 2.9, eL: 0.15, eR: 0.15, kL: 1.7, kR: 1.8, lL: 0.5, lR: 0.7, headY: 0.3 } },
      { t: 0.7, e: 's', p: { fall: 0.2, fallD: 1, hip: 0.62, lean: 0.5, lL: 0.95, kL: 1.5, lR: 0.3, kR: 0.8, aL: 1.1, aR: 0.4, eL: 0.9, eR: 0.9, headY: 0 } },
      { t: 1, e: 's', p: { fall: 0, hip: 0.9, lean: 0.12, lL: 0.05, lR: -0.05, kL: 0.1, kR: 0.1, aL: 0.12, aR: 0.12, eL: 0.5, eR: 0.5 } },
    ],
  },
  getUpBack: {
    dur: 1.1, loop: false, keys: [
      { t: 0, e: 's', p: { ...LIE_B } },
      { t: 0.3, e: 's', p: { fall: 0.85, fallD: -0.4, roll: 0.5, hip: 0.25, abL: 0.6, abR: 0.7, kL: 1.6, kR: 1.2 } },
      { t: 0.6, e: 'o', p: { fall: 0.35, fallD: 1, hip: 0.55, roll: 0.15, lL: 0.9, kL: 1.6, aL: 1.4, aR: 0.6, eL: 1.0, eR: 1.0 } },
      { t: 1, e: 's', p: { fall: 0, hip: 0.9, lean: 0.1, lL: 0.05, lR: -0.05, kL: 0.1, kR: 0.1, aL: 0.12, aR: 0.12, eL: 0.5, eR: 0.5, roll: 0 } },
    ],
  },

  ruckCommit: {
    dur: 0.95, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.68, lean: 0.55, lL: 0.95, kL: 1.55, lR: 0.55, kR: 1.0, aL: 1.05, aR: 1.05, eL: 1.05, eR: 1.05, headP: -0.18, twist: 0.04 } },
      { t: 0.5, e: 's', p: { hip: 0.7, lean: 0.53, lL: 0.55, kL: 1.0, lR: 0.95, kR: 1.55, aL: 1.05, aR: 1.05, eL: 1.05, eR: 1.05, headP: -0.16, twist: -0.04 } },
    ],
  },
  jackal: {
    dur: 1.3, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.74, lean: 0.85, aL: 2.45, aR: 2.5, eL: 0.5, eR: 0.5, adL: 0.45, adR: 0.45, kL: 0.7, kR: 0.75, headP: -0.4 } },
      { t: 0.5, e: 's', p: { hip: 0.76, lean: 0.8, aL: 2.4, aR: 2.55, eL: 0.55, eR: 0.45, adL: 0.4, adR: 0.5, kL: 0.8, kR: 0.68, headP: -0.38 } },
    ],
  },
  maulPush: {
    dur: 1.0, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.78, lean: 0.5, lL: 0.8, kL: 1.3, lR: 0.5, kR: 0.9, aL: 1.3, aR: 1.25, eL: 1.1, eR: 1.1, headP: -0.12 } },
      { t: 0.5, e: 's', p: { hip: 0.8, lean: 0.48, lL: 0.5, kL: 0.9, lR: 0.8, kR: 1.3, aL: 1.28, aR: 1.3, eL: 1.1, eR: 1.1, headP: -0.1 } },
    ],
  },
  step: {
    dur: 0.55, loop: false, keys: [
      { t: 0, e: 's', p: { roll: 0.3, hip: 0.86, lR: -0.35, adR: 0.45, kR: 0.8, lL: 0.25, kL: 0.4, lean: 0.22, aL: 0.9, aR: -0.3, eL: 1.2, eR: 0.6 } },
      { t: 0.4, e: 'o', p: { roll: -0.32, hip: 0.84, lL: 0.65, adL: 0.4, kL: 0.7, lR: -0.15, kR: 0.6, aL: -0.2, aR: 1.0, eL: 0.5, eR: 1.3 } },
      { t: 1, e: 's', p: { roll: 0, hip: 0.92, lL: 0.1, lR: -0.1, kL: 0.2, kR: 0.2, aL: 0.2, aR: 0.2, eL: 0.8, eR: 0.8 } },
    ],
  },
  celebrate: {
    dur: 1.1, loop: true, keys: [
      { t: 0, e: 's', p: { hip: 0.94, aL: 3.0, aR: 3.05, eL: 0.1, eR: 0.1, headP: -0.15, ball: 1, ballSide: 0 } },
      { t: 0.35, e: 'o', p: { hip: 1.02, aL: 3.05, aR: 3.1, eL: 0.1, eR: 0.1, ball: 1 } },
      { t: 0.6, e: 'i', p: { hip: 0.9, aL: 2.2, aR: 2.25, eL: 1.3, eR: 1.3, ball: 1 } },
    ],
  },
};

CLIPS.strafeL = mirrorClip(CLIPS.strafe);

/* ---------------- sampling & blending ---------------- */

function resolveVal(clip: Clip, ki: number, ch: keyof Pose): number {
  const n = clip.keys.length;
  for (let step = 0; step < n; step++) {
    const idx = (ki - step + n * 4) % n;
    const v = clip.keys[idx].p[ch];
    if (v !== undefined) return v;
  }
  return STAND[ch];
}

/** sample clip `name` at normalised time u (loops wrap, one-shots clamp) */
export function sampleC(name: string, u: number): Pose {
  const clip = CLIPS[name] ?? CLIPS.idle;
  const n = clip.keys.length;
  let t: number;
  if (clip.loop) t = u - Math.floor(u);
  else t = Math.min(1, Math.max(0, u));
  let i0 = 0;
  while (i0 < n - 1 && clip.keys[i0 + 1].t <= t) i0++;
  const i1 = (i0 + 1) % n;
  let t0 = clip.keys[i0].t;
  let t1 = clip.keys[i1].t;
  if (clip.loop && i1 === 0) t1 = 1;
  if (!clip.loop && i0 === n - 1) { t0 = 1; t1 = 1; }
  const span = Math.max(1e-5, t1 - t0);
  const raw = Math.min(1, Math.max(0, (t - t0) / span));
  const e = ease(clip.keys[i1].e ?? 's', raw);
  const out = {} as Pose;
  for (const ch of POSE_CH) {
    const a = resolveVal(clip, i0, ch);
    const b = resolveVal(clip, i1, ch);
    out[ch] = a + (b - a) * e;
  }
  return out;
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const ch of POSE_CH) out[ch] = a[ch] + (b[ch] - a[ch]) * t;
  return out;
}

export const smooth = (t: number) => t * t * (3 - 2 * t);

/* ---------------- CLIP_MAP: sim action -> clip + cycle rate ---------------- */

export interface ClipChoice { name: string; rate: number }

/**
 * rate = cycles (or one-shot progress) per second. Gait clips run at a cadence
 * derived from ground speed so feet match the metres actually covered.
 */
export function actionClip(action: string, speed: number, lat?: number): ClipChoice {
  switch (action) {
    case 'shuffle': {
      // square-to-target lateral movement reads as a strafe, not a turn
      if (lat !== undefined && Math.abs(lat) > 0.9) {
        return { name: lat > 0 ? 'strafe' : 'strafeL', rate: Math.max(0.5, Math.abs(lat) / 1.7) };
      }
      return { name: 'shuffle', rate: 1.0 };
    }
    case 'sprint': return { name: 'sprint', rate: Math.max(0.6, speed / 3.6) };
    case 'run': return { name: 'run', rate: Math.max(0.5, speed / 2.9) };
    case 'jog': return { name: 'jog', rate: Math.max(0.4, speed / 2.1) };
    case 'walk': return { name: 'walk', rate: Math.max(0.3, speed / 1.3) };
    case 'scrumBind': return { name: 'scrumBind', rate: 1.4 };
    case 'scrumShove': return { name: 'scrumShove', rate: 1.5 };
    case 'jump': return { name: 'lineoutJump', rate: 0.95 };
    case 'lift': return { name: 'lift', rate: 1.1 };
    case 'kick': return { name: 'kick', rate: 0.85 };
    case 'pass': return { name: 'passSpin', rate: 1.6 };
    case 'catch': return { name: 'catch', rate: 1.8 };
    case 'tackle': return { name: 'tackleHit', rate: 1.3 };
    case 'tackled': return { name: 'tackled', rate: 1.15 };
    case 'dive': return { name: 'diveFront', rate: 1.2 };
    case 'fallBack': return { name: 'fallBack', rate: 1.2 };
    case 'lieF': return { name: 'lieFront', rate: 0.42 };
    case 'lieB': return { name: 'lieBack', rate: 0.38 };
    case 'getupF': return { name: 'getUpFront', rate: 0.95 };
    case 'getupB': return { name: 'getUpBack', rate: 0.9 };
    case 'ruck': return { name: 'ruckCommit', rate: 1.35 };
    case 'jackal': return { name: 'jackal', rate: 0.8 };
    case 'maul': return { name: 'maulPush', rate: 1.25 };
    case 'step': return { name: 'step', rate: 1.8 };
    case 'celebrate': return { name: 'celebrate', rate: 0.95 };
    default: return { name: 'idle', rate: 0.4 };
  }
}
