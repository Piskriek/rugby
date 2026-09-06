/**
 * FALLS — recorded tackle physics (the "bake once, replay forever" core).
 *
 * THE IDEA
 * A true per-frame ragdoll on thirty skinned men is a physics engine per man:
 * unaffordable. Instead we run a *deterministic* body-dynamics solve OFFLINE
 * for every meaningful tackle situation, record the resulting pose curves,
 * and at run time replay the nearest recording, adjusted for the live
 * situation. The expensive integration happens at bake time; the field only
 * ever does a table lookup, a mirror and a lerp.
 *
 * THE MODEL
 * A fallen man is driven by 17 scalar channels (radians), all relative to a
 * standing reference pose, sampled at `FALL_HZ` over `FALL_T` seconds:
 *
 *   pitch  — rotation of the whole body about its own left/right axis
 *            (+ = falls forward onto his face, − = falls back onto his back)
 *   twistZ — rotation of the whole body about its own vertical/forward axis
 *            (+π/2 = head tips toward HIS right — the mirror handles the left)
 *   bend   — lower-spine crunch from the hit (torso folds over the hips)
 *   headX  — head lag relative to the torso (whiplash), sagittal
 *   headY  — head lag, lateral
 *   arm{R,L}flex  — shoulder flexion   (0 = arm straight down, + swings forward)
 *   arm{R,L}ab    — shoulder abduction  (0 = sagittal plane, + out sideways)
 *   arm{R,L}elbow — elbow flexion
 *   leg{R,L}flex  — hip flexion         (+ = leg swings forward / tucks up)
 *   leg{R,L}ab    — hip abduction
 *   leg{R,L}knee  — knee flexion
 *
 * The torso itself is physical: the impact delivers an angular velocity
 * around the fall axis whose size follows from the man's ground speed and the
 * tackle height — a low hit below the centre of mass upends him (big lever
 * arm), a chest-high hit drives him back (small lever arm). That angular
 * state integrates under gravity about the ground pivot until the shoulder
 * arc strikes the turf; a damped spring then settles the body to its prone
 * presentation with one soft restitution bounce. The limbs are damped
 * pendulums on the falling torso: they lag the trunk, flail, strike the
 * ground and fold.
 *
 * Determinism is total: no RNG anywhere — variability comes only from the
 * descriptor, so a baked recording is a pure function of the situation.
 *
 * NOTE ON AXES (verified against THREE.Euler, not guessed):
 * the rig faces +Z at rest with +Y up; his left/right axis is X. A positive
 * rotation about +X sends his head (+Y) toward +Z (a forward face-plant), and
 * a positive rotation about +Z sends his head toward −X (his right side).
 */

export type FallDir = 'F' | 'B' | 'S';   // forward / backward / lateral (right)
export type FallKind = 'FALL' | 'ROLL';  // carrier hit / tackler rolling off

export interface FallDesc {
  kind: FallKind;
  /** ground speed of the man being felled, m/s (what the engine measured) */
  speed: number;
  /** tackle height 0..1 — 0 = ankle, 1 = shoulder (drives the lever arm) */
  hitH: number;
  /** tackler momentum / carrier momentum (drives how much is transferred) */
  massR: number;
  /** where the impulse sends him, relative to his own facing */
  dir: FallDir;
}

export const FALL_T = 2.2;      // seconds of recording after impact
export const FALL_HZ = 30;      // record rate (integration is far finer)
export const FALL_N = Math.ceil(FALL_T * FALL_HZ);      // 66 samples
export const CH_COUNT = 17;

/** Channel -> column index. Kept as a const table (not an enum) so the baked
 *  file stays a flat Float32Array with an obvious layout. */
export const CH = {
  pitch: 0, twistZ: 1, bend: 2, headX: 3, headY: 4,
  armRflex: 5, armRab: 6, armRelbow: 7,
  armLflex: 8, armLab: 9, armLelbow: 10,
  legRflex: 11, legRab: 12, legRknee: 13,
  legLflex: 14, legLab: 15, legLknee: 16,
} as const;

/* ------------------------------------------------------------------- body -- */
/** Lengths in metres; mass normalized to 1. */
const G = 9.81;
const SHOULDER_L = 1.45;      // shoulder arc above the feet pivot
const COM_H = 0.95;           // centre of mass above the feet pivot
const GYRO2 = 1.05;           // k² (m²) for the transverse axis about the feet
const REST_E = 0.16;          // restitution of the first bounce on turf
const GROUND_Y = 0.17;        // torso "radius" — height once fully down
const EPS = 1e-9;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** How the tackle height maps to the rotation lever (m). A low hit has the
 *  force line far below the COM → big upending moment; a shoulder-high hit
 *  has almost no lever → he is driven back, not flipped over. */
function lever(hitH: number): number {
  const contactH = 0.14 + hitH * (SHOULDER_L - 0.14);
  return Math.max(0.06, COM_H - contactH);
}

/** Deterministic ±1 "which side took the hit" from the descriptor. Pure
 *  arithmetic (no RNG) so a baked recording stays a function of the inputs,
 *  while two otherwise-identical hits still finish on different sides. */
function sideFactor(d: FallDesc): 1 | -1 {
  const h = (d.speed * 31.7 + d.hitH * 97.3 + d.massR * 53.9 + (d.dir === 'S' ? 41 : 0)) % 1;
  return h < 0.5 ? 1 : -1;
}

/** Axis-angle rotate v around unit axis u by ang (pure arithmetic). */
function rotAxis(out: number[], v: number[], u: number[], ang: number): number[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  const [x, y, z] = v; const [ux, uy, uz] = u;
  const dot = x * ux + y * uy + z * uz;
  out[0] = c * x + s * (uy * z - uz * y) + ux * dot * (1 - c);
  out[1] = c * y + s * (uz * x - ux * z) + uy * dot * (1 - c);
  out[2] = c * z + s * (ux * y - uy * x) + uz * dot * (1 - c);
  return out;
}

/** One implicit-Euler step of a damped spring toward a target. */
function spring(x: number, v: number, target: number, wn: number, zeta: number, dt: number): [number, number] {
  const a = -wn * wn * (x - target) - 2 * zeta * wn * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv];
}

/**
 * Solve one fall. Returns CH_COUNT × FALL_N floats laid out channel-major:
 * channel c, sample s lives at `out[c * FALL_N + s]`.
 */
export function solveFall(desc: FallDesc): Float32Array {
  const out = new Float32Array(CH_COUNT * FALL_N);
  const { speed: v, hitH, dir, kind } = desc;

  /* ---- torso impulse --------------------------------------------------- */
  // The "lever" is the vertical gap between the contact point and the body's
  // centre of mass — an ankle tackle has the biggest upending moment, a
  // shoulder-high tackle almost none. The full kick, though, is driven by how
  // fast the tackler runs through: even a waist-high hit where the lever is
  // small still upends a man because the momentum carries him over. So the
  // angular kick uses a speed-driven baseline scaled by a height factor that
  // stays meaningful across the whole range (never collapsing to zero).
  const lev = lever(hitH);
  const momShare = Math.max(0.55, 1 + (desc.massR - 1) * 0.55); // momentum share
  const violence = Math.min(1.15, 0.28 + v * 0.08 + lev * 0.5); // 0..~1.2
  const rollScale = kind === 'ROLL' ? 0.55 : 1;   // peeling off is gentler
  const heightF = 1.42 - hitH * 0.62;             // 1.2 low ... 0.9 high
  const baseKick = (0.9 + v * 0.34) * momShare * rollScale * heightF;
  const w0 = baseKick * 1.15;
  // Lateral (S) hits convert most of the kick into the sideways rotation;
  // sagittal hits take the pitch axis (with a small shoulder twist).
  const lateral = dir === 'S';
  const wPitch0 = lateral ? baseKick * 0.42 : baseKick;      // about X
  const wTwist0 = lateral ? baseKick * 1.5 : baseKick * (dir === 'B' ? 0.24 : 0.2); // about Z

  /* ---- torso flight: α (pitch about X), τ (twist about Z) -------------- */
  const pitchSign = dir === 'B' ? -1 : 1;
  const drive = (kind === 'ROLL'
    ? 2.0
    : clamp(3.2 + (v - 2.5) * 0.6 + lev * 3.4, 2.6, 7.5)) * (lateral ? 0.22 : 1);
  const alpha0 = kind === 'ROLL' ? 0.04 : 0.07;
  let alpha = alpha0 * pitchSign;
  const wFloor = kind === 'ROLL' ? 0.5 : Math.max(0.95, Math.abs(wPitch0));
  let wPitch = (lateral ? Math.min(0.4, wFloor) : wFloor) * pitchSign;
  let twist = 0;
  // Lateral hits: the initial spin goes straight toward the side the sprawl
  // will settle on (sideFactor) so the body never rocks past vertical and
  // back — except lateral ROLLS (the tackler peeling away) which always
  // roll the same way and are mirrored at playback.
  const side = sideFactor(desc);
  const latSpin = lateral ? (kind === 'ROLL' ? 1 : side) : (dir === 'B' ? -0.6 : 1);
  let wTwist = wTwist0 * latSpin;
  const gTorque = G * COM_H / GYRO2;

  let landed = false;
  let landT = 1;
  let bounceW = 0;

  /* ---- MOTION LANGUAGE ------------------------------------------------
   * The carrier NEVER braces and NEVER folds into a ball. From the first
   * moment of contact he is SLACK — a string of oiled spaghetti that the
   * tackler's momentum tips over: the trunk pitches on the impact, the back
   * sags, the head lags, and the arms and legs drift loose and spread OUT
   * as the body goes over. When the trunk meets the turf the limbs keep
   * their leftover speed for a beat and then lie sprawled — flat, spread,
   * nothing held up, nothing dug in. Every joint spring is loose; the only
   * "work" done is gravity and the collision itself.
   * ---------------------------------------------------------------------- */

  /* ---- limb & head state ---- */
  let bend = 0, bendV = 0;
  let headX = 0, headXV = 0, headY = 0, headYV = 0;
  let armF = 0, armFV = 0;            // sagittal (both arms share the flex)
  let abR = 0, abV = 0;               // right-arm abduction (drives both, asym)
  let elbR = 0, elbV = 0;
  let legF = 0, legFV = 0;
  let abLeg = 0, abLegV = 0;
  let knee = 0, kneeV = 0;

  const SIM_HZ = 600;                // integration rate
  const dt = 1 / SIM_HZ;
  const REC_EVERY = SIM_HZ / FALL_HZ; // 20 — integration steps per record sample
  let simT = 0;
  let step = 0;                      // integration step counter
  let recN = 0;                      // record samples written so far
  const maxSimT = FALL_T + 0.6;

  /* ---- ACT-3 sprawl motif, chosen once the torso reaches the turf ------ */
  let aS = pitchSign * Math.PI / 2;
  let tS = 0;
  let zetaP = 0.6;
  // sprawl (oiled-spaghetti) targets — decided at landing from the descriptor
  // so two identical hits still finish asymmetric (deterministic, no RNG)
  const sp = {
    legF: 0.2, knee: 0.4, legAb: 0.15,
    armF: 0.2, abR: 0.55, abL: 0.4, elb: 0.6,
    bend: 0.1, headY: 0.2, headX: 0.0,
  };
  {
    const u = ((v * 13.7 + hitH * 89.1 + desc.massR * 47.3 + (side > 0 ? 21 : 7)) % 1); // 0..1 motif pick
    const u2 = ((v * 7.3 + hitH * 41.7 + desc.massR * 23.9 + (side > 0 ? 11 : 3)) % 1);
    const soft = 1 - Math.min(0.45, violence * 0.3);  // hard hits sprawl wider
    const wide = 1 + violence * 0.5;
    if (kind === 'ROLL') {
      // tackler rolls off: braces with a hand / knee, folded, not flat
      aS = lateral ? 0.72 + u * 0.18 : 0.9 + u * 0.3;
      tS = lateral ? 1.06 + u2 * 0.12 : 0.22 * side + u * 0.2;
      sp.legF = 1.05 + u * 0.35; sp.knee = 0.85 + u2 * 0.4; sp.legAb = 0.08;
      sp.armF = 0.75 + u2 * 0.3; sp.abR = 0.28 + u * 0.3; sp.abL = 0.5 + u2 * 0.25;
      sp.elb = 0.5 + u * 0.35; sp.bend = 0.18 + u2 * 0.12;
      sp.headY = 0.12 * side; sp.headX = -0.15 - u * 0.2;
      zetaP = 0.85;
    } else if (lateral) {
      // SIDE HIT, falls over onto a 3/4 back-side lie: the torso is rolled
      // ~82° and pitched ~23° so the spine clears the turf by 0.10-0.13 m;
      // both arms are thrown OVERHEAD toward the head (the side-impact
      // flinch carried through — the down arm's hand grazes the pitch, the
      // up arm drapes at head height), legs long with the down hip's leg
      // swept clear of the turf. Fitted channel-by-channel on the rig via
      // tools/sideScan: Head .19-.20, pelvis .13, hands .20/-0.03, feet
      // .04-.08, calves ≥ 0.
      aS = 0.38 + u2 * 0.06;
      tS = (Math.PI / 2 - 0.13 + (u - 0.5) * 0.05) * side;
      sp.legF = 0.05 + u * 0.2; sp.knee = 0.15 + u * 0.3; sp.legAb = -0.14 + u2 * 0.06;
      sp.armF = 1.6 + u2 * 0.2; sp.abR = 1.0 + u * 0.1; sp.abL = 1.0 + u * 0.1;
      sp.elb = 0.6 + u * 0.1; sp.bend = 0.05 + u2 * 0.07;
      sp.headY = (0.1 + u2 * 0.06) * side; sp.headX = 0.0;
      zetaP = 0.5;
    } else if (dir === 'B') {
      // flat on his back, knees drifted up, arms dumped out
      aS = -(Math.PI / 2 - 0.02) + (u - 0.5) * 0.06;
      tS = (0.05 + u2 * 0.1) * side;
      const up = u < 0.45;            // some men land with knees up, some flat
      sp.legF = up ? 0.5 + u * 0.25 : 0.12 + u * 0.2;
      sp.knee = up ? 0.7 + u2 * 0.45 : 0.25 + u2 * 0.3;
      sp.legAb = 0.1 + u2 * 0.14;
      sp.armF = 0.15 + u * 0.2; sp.abR = 0.5 + u * 0.4; sp.abL = 0.42 + u2 * 0.4;
      sp.elb = 0.5 + u2 * 0.4; sp.bend = 0.05 + u * 0.06;
      sp.headY = (0.15 + u2 * 0.2) * side; sp.headX = -0.12 - u * 0.14;
      zetaP = 0.55;
    } else {
      // FACE-DOWN SPRAWL: the carrier finishes flat on the turf — arms out
      // beside the chest/shoulders, legs out straight behind with one knee
      // drifting, head turned to breathe. Fitted channel-by-channel on the
      // real rig via tools/restOracle (root-frame model axes): the flat lie
      // sits just short of π/2 about the heel pivot and every landmark
      // clears the turf — hands ~on the plane, feet/calves resting above it.
      // Variety is small on purpose: violence reads in the sprawl width, not
      // in a pitch/limb overshoot that digs into the pitch.
      aS = pitchSign * (Math.PI / 2 - 0.04 + (u - 0.5) * 0.05);  // 1.531–1.556
      tS = (0.02 + u2 * 0.12) * side;
      sp.legF = 0.04 + u * 0.05; sp.knee = 0.06 + u2 * 0.07; sp.legAb = 0.09 + u * 0.08;
      sp.armF = 0.02 * u2; sp.abR = 0.44 + u * 0.12; sp.elb = 0.02 + u2 * 0.02;
      sp.bend = 0.03 + u2 * 0.04;
      sp.headY = (0.25 + u2 * 0.3) * side; sp.headX = 0.02 * (u - 0.5);
      zetaP = Math.max(0.55, 0.8 - violence * 0.12);
    }
    // lateral FALL rests skip the soft/wide scaling: their fitted sprawl
    // point (arms overhead, down leg swept clear — see tools/sideScan) is
    // narrow, and violence already shows in the flight + arrival speed.
    const raw = kind !== 'ROLL' && lateral;
    sp.armF *= raw ? 1 : soft; sp.elb *= raw ? 1 : soft; sp.knee *= raw ? 1 : soft; sp.legF *= raw ? 1 : soft;
    sp.abR *= raw ? 1 : wide; sp.abL *= raw ? 1 : wide; sp.legAb *= raw ? 1 : wide * 0.8;
  }

  while (simT < maxSimT && !(landed && simT - landT > 1.8 && Math.abs(wPitch) < 0.35 && Math.abs(wTwist) < 0.35)) {
    /* ============ muscle tone ============
     * A FALL (the tackled man) is SLACK from the first instant of contact:
     * no brace phase, no tone spike — he is a string of spaghetti the hit
     * tips over. A ROLL (the tackler peeling away) keeps working tone: a
     * short lock while he absorbs the hit, then a braced roll-off. */
    const limpT = clamp(simT / (kind === 'ROLL' ? 0.3 : 0.1), 0, 1);
    const tone = kind === 'ROLL'
      ? clamp(1 - simT / 0.08, 0, 1) * (1 - limpT) + 0.09 * limpT
      : 0.14 - 0.05 * limpT;

    /* ================= torso ================= */
    if (!landed) {
      wPitch += (gTorque * Math.sin(alpha) + pitchSign * drive) * dt;
      const cap = 6.5 + v * 0.4;
      wPitch = Math.max(-cap, Math.min(cap, wPitch));
      wTwist += -wTwist * (lateral ? 0.7 : 1.6) * dt;
      alpha += wPitch * dt;
      if (lateral) alpha = Math.max(-1.15, Math.min(1.15, alpha));
      twist += wTwist * dt;
      const landedNow = lateral
        ? Math.abs(twist) >= 1.22
        : SHOULDER_L * Math.cos(alpha) - 0.12 <= GROUND_Y;
      if (landedNow) {
        landed = true;
        landT = simT;
        if (lateral) {
          twist = Math.sign(twist) * Math.max(Math.abs(twist), 1.22);
          wTwist = -Math.sign(wTwist) * Math.min(Math.abs(wTwist) * REST_E, 0.5);
        } else {
          // the trunk strikes the turf slightly past the flat line (impact
          // crush); a fast damped spring brings it to the flat sprawl pitch
          // without ever digging deep below the plane
          const lim = Math.PI / 2 + 0.06;
          alpha = Math.max(-lim, Math.min(lim, alpha));
          bounceW = -Math.sign(wPitch * alpha) * Math.abs(wPitch) * REST_E || 0;
          wPitch = 0;
        }
        wTwist = Math.max(-2.4, Math.min(2.4, wTwist));
      }
    } else {
      // ACT 3 — the trunk settles flat on the turf (soft, with one small
      // restitution bump) while the limbs flop into their sprawl below.
      const [na, nw] = spring(alpha, wPitch, aS, 7.5, zetaP, dt);
      alpha = na; wPitch = nw;
      if (bounceW && simT - landT < 0.07) { wPitch = bounceW; bounceW = 0; }
      if (lateral && bounceW === 0 && simT - landT < 0.22) wTwist = 0;
      const [nt, nwt] = spring(twist, wTwist, tS, 3.6, 0.65, dt);
      twist = nt; wTwist = nwt;
    }

    /* ================= spine: a slack sag, not a ball-fold ================ */
    {
      // the back bows gently as the trunk goes over (a slack curve, chin
      // drifting toward the chest but nothing approaching a tucked ball),
      // then relaxes into the small sprawl bend once he is down.
      const sag = !landed ? clamp(Math.abs(alpha) * 0.55 - 0.1, 0, 0.5) : 0;
      const tgt = landed ? sp.bend : 0.04 + sag * 0.45 + limpT * 0.05;
      const wn = 14 + 46 * tone;
      const [nb, nbv] = spring(bend, bendV, tgt, wn, 0.5, dt);
      bend = Math.max(-0.3, Math.min(1.5, nb)); bendV = nbv;
    }
    /* ================= head ================= */
    {
      // whiplash lags the trunk while it is moving; at the end the head rolls
      // to one side the way a slack neck drops
      const [nx, nxv] = spring(headX, headXV,
        landed ? sp.headX : -wPitch * 0.14 * (0.4 + tone), 13 + 22 * tone, 0.42, dt);
      headX = Math.max(-0.9, Math.min(0.9, nx)); headXV = nxv;
      const [ny, nyv] = spring(headY, headYV,
        landed ? sp.headY : -wTwist * 0.1, 10 + 18 * tone, 0.45, dt);
      headY = Math.max(-0.5, Math.min(0.5, ny)); headYV = nyv;
    }
    /* ---- the air-progress shared by arms and legs ----
     * airGo 0→1 as the trunk tips from vertical to the flat line. The whole
     * body rotor pivots about the ground-level foot origin, so a limb that
     * is out at the far end of the body swings closest to the turf exactly
     * when the trunk flattens — the sprawl targets below are chosen so the
     * arms and legs are already spread near their resting place by the time
     * the trunk arrives, and the slack springs just ease them onto the
     * grass. Nothing tucks, nothing flails hard, nothing stiffens. */
    const airGo = Math.min(1, Math.abs(alpha) / 1.15);        // 0→1 by the flat line
    /* ================= arms ================= */
    {
      // loose spaghetti arms: as the trunk tips they drift OUT and slightly
      // forward (they spread away from the body — passive, no brace), then
      // land in the sprawl.
      const rollOff = kind === 'ROLL';
      let tgtF: number, tgtAb: number, tgtE: number;
      if (landed) {
        tgtF = sp.armF; tgtAb = sp.abR; tgtE = sp.elb;
      } else if (rollOff) {
        // ROLL — the tackler reaches down to brace/peel as he goes over
        const fling = violence * 0.9;
        tgtF = 0.35 + airGo * 0.6 + fling * 0.25;
        tgtAb = 0.25 + airGo * 0.35;
        tgtE = 0.2 + airGo * 0.45;
      } else if (lateral) {
        // side hit: the loose arms lag UP through the roll (the near arm
        // gets pinned as he turns, the far arm drapes over the head side);
        // the shallow trunk pitch never swings them under the pivot.
        const fling = violence * 0.9;
        tgtF = 0.85 + airGo * 0.55 + fling * 0.3;
        tgtAb = 0.75 + airGo * 0.25 + fling * 0.15;
        tgtE = 0.25 + airGo * 0.25;
      } else {
        // F/B: arms spread out to the sides as the trunk goes over and stay
        // there — by the flat line they are at the sprawl's spread already.
        tgtF = 0.05 + airGo * 0.08;
        tgtAb = 0.12 + airGo * 0.5;
        tgtE = 0.05 + airGo * 0.12;
      }
      const wn = (landed ? 6.0 : 7.5) + 3 * tone;
      const [na, nav] = spring(armF, armFV, Math.min(1.9, tgtF), wn, landed ? 0.85 : 0.6, dt);
      armF = Math.max(0, Math.min(1.9, na)); armFV = nav;
      const [nb, nbv] = spring(abR, abV, Math.min(1.6, tgtAb), wn, landed ? 0.85 : 0.6, dt);
      abR = Math.max(0, Math.min(1.6, nb)); abV = nbv;
      const [ne, nev] = spring(elbR, elbV, Math.min(2.1, tgtE), wn, landed ? 0.85 : 0.6, dt);
      elbR = Math.max(0, Math.min(2.1, ne)); elbV = nev;
    }
    /* ================= legs ================= */
    {
      // slack legs: they stay long and TRAIL behind the tipping trunk with
      // a soft give at the knees — they never fold to the chest and never
      // lock straight; at the ground they ease into the sprawl spread.
      const rollOff = kind === 'ROLL';
      let tgtL: number, tgtK: number, tgtA: number;
      if (landed) {
        tgtL = sp.legF; tgtK = sp.knee; tgtA = sp.legAb;
      } else if (rollOff) {
        // ROLL — legs fold under for the peel-off crouch as he comes over
        tgtL = 0.55 + airGo * 0.6;
        tgtK = 0.6 + airGo * 0.3;
        tgtA = 0.06 + airGo * 0.1;
      } else if (lateral) {
        tgtL = 0.1 + airGo * 0.15;
        tgtK = 0.1 + airGo * 0.2;
        tgtA = 0.02 + airGo * 0.1;
      } else {
        tgtL = 0.06 + airGo * 0.1;
        tgtK = 0.08 + airGo * 0.28;
        tgtA = 0.03 + airGo * 0.1;
      }
      const wn = (landed ? 5.5 : 7.5) + 3 * tone;
      const [nl, nlv] = spring(legF, legFV, tgtL, wn, landed ? 0.8 : 0.7, dt);
      legF = Math.max(0, Math.min(2.0, nl)); legFV = nlv;
      const [nk, nkv] = spring(knee, kneeV, Math.min(2.2, tgtK), wn, landed ? 0.8 : 0.65, dt);
      knee = Math.max(0, Math.min(2.2, nk)); kneeV = nkv;
      const [nb, nbv] = spring(abLeg, abLegV, tgtA, wn * 0.7, landed ? 0.8 : 0.65, dt);
      abLeg = Math.max(-0.15, Math.min(0.9, nb)); abLegV = nbv;
    }

    /* ================= record ================= */
    // One sample every REC_EVERY integration steps. Recorded with an exact
    // integer cadence — a float playhead (t*FALL_HZ, floor) used to skip
    // samples when accumulated rounding pushed the product just under an
    // integer, leaving unwritten zeros in the middle of a fall.
    if (step % REC_EVERY === 0 && recN < FALL_N) {
      const s = recN;
      const col = (c: number) => c * FALL_N + s;
      // the baked L/R joint offsets are a flight-time asymmetry (a sprinter's
      // arms differ); once the man is down on the turf they blend to an exact
      // mirror over 0.35 s so the flat sprawl reads slack-and-symmetric with
      // both palms resting on the pitch (measured via restOracle — the +0.2
      // ab / +0.22 elb offsets otherwise leave the left hand ~4 cm under).
      const restBlend = landed ? clamp((simT - landT) / 0.35, 0, 1) : 0;
      out[col(CH.pitch)] = alpha;
      out[col(CH.twistZ)] = twist;
      out[col(CH.bend)] = bend;
      out[col(CH.headX)] = headX;
      out[col(CH.headY)] = headY;
      out[col(CH.armRflex)] = armF;
      out[col(CH.armLflex)] = armF;
      out[col(CH.armRab)] = abR;
      out[col(CH.armLab)] = Math.min(1.65, abR * (0.62 + 0.38 * restBlend) + 0.2 * (1 - restBlend));
      out[col(CH.armRelbow)] = elbR;
      out[col(CH.armLelbow)] = Math.min(2.1, elbR * (0.7 + 0.3 * restBlend) + 0.22 * (1 - restBlend));
      out[col(CH.legRflex)] = legF;
      out[col(CH.legLflex)] = Math.min(1.95, legF + 0.08 * (1 - restBlend));
      out[col(CH.legRab)] = abLeg;
      out[col(CH.legLab)] = Math.max(-0.2, abLeg * (0.7 + 0.3 * restBlend) - 0.1 * (1 - restBlend));
      out[col(CH.legRknee)] = knee;
      out[col(CH.legLknee)] = Math.min(2.1, knee * (0.78 + 0.22 * restBlend) + 0.12 * (1 - restBlend));
      recN = s + 1;
    }
    step++;
    simT += dt;
  }
  // fill any tail with the last written sample so entries have equal length
  if (recN < FALL_N) {
    const lastS = Math.max(0, recN - 1);
    for (let c = 0; c < CH_COUNT; c++) {
      const v = out[c * FALL_N + lastS];
      for (let s = lastS + 1; s < FALL_N; s++) out[c * FALL_N + s] = v;
    }
  }
  return out;
}

/** Bake grid axes; exported so the bake tool and tests share one truth. */
export const SPEED_AXIS = [2.5, 5, 7.5, 10];
export const HEIGHT_AXIS = [0.35, 0.6, 0.85];
export const MASS_AXIS = [0.85, 1, 1.2];

/** The stored core rows (lead-limb only; the mirror derives the other side
 *  at run time). Order defines the packed layout of a bank entry. */
export const CH_CORE = 11;
export const CORE_ROWS: ReadonlyArray<number> = [
  CH.pitch, CH.twistZ, CH.bend, CH.headX, CH.headY,
  CH.armRflex, CH.armRab, CH.armRelbow,
  CH.legRflex, CH.legRab, CH.legRknee,
];

export function gridDescs(kind: FallKind): FallDesc[] {
  const descs: FallDesc[] = [];
  const dirs: FallDir[] = kind === 'FALL' ? ['F', 'B', 'S'] : ['F', 'S'];
  for (const speed of SPEED_AXIS)
    for (const hitH of HEIGHT_AXIS)
      for (const massR of MASS_AXIS)
        for (const dir of dirs)
          descs.push({ kind, speed, hitH, massR, dir });
  return descs;
}
