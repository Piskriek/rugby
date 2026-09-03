/**
 * CAMERA CONFIGURATION
 *
 * The previous rig cut between a fixed shot list by phase, which is why the view
 * jumped from sideline to behind-the-posts and then sat a long way from the
 * action. This module makes the camera a set of explicit, user-chosen options:
 *
 *   MODE      where the rig physically stands
 *   ZOOM      1x .. 4x, or DYNAMIC with an intensity slider
 *   FOLLOW    tight zooms track the ball laterally so it never leaves frame
 *   CONTROLS  whether WASD is relative to the camera or to the pitch
 *
 * Nothing in here chooses a shot on the player's behalf except DYNAMIC, and
 * even that is bounded by the intensity slider.
 */

export type CamMode = 'CABLE' | 'TACTICAL' | 'SIDELINE' | 'BROADCAST' | 'CHASE' | 'POSTS' | 'SHOULDER';
export type ZoomSetting = 1 | 2 | 3 | 4 | 'DYNAMIC';

export interface CamModeSpec {
  id: CamMode;
  name: string;
  blurb: string;
  /** metres back from the near touchline. 0 means the rig is behind the goal. */
  standback: number;
  /** metres above the turf at 1x */
  height: number;
  /** pixels per metre at the subject at 1x */
  pxPerMetre: number;
  /** metres of lead in the direction of attack */
  lead: number;
  /** how strongly the rig tracks the ball laterally, 0..1 */
  track: number;
  /** dead zone in metres before the rig moves at all */
  deadZone: number;
  /** true when the rig looks along the pitch rather than across it */
  endOn: boolean;
}

export const CAM_MODES: CamModeSpec[] = [
  {
    /* THE CABLE CAM — the default, and the view the game is designed around.
     *
     * A stadium spidercam: suspended on wires above and behind the ball, always
     * oriented end to end from the attacking side's point of view, tilted down
     * so you read the shape of both teams, and gliding across the field as play
     * moves. It backs off and rises on a kick so the flight and the chase are
     * both in frame, then settles back in as the ball is fielded.
     *
     * `standback` is the trail distance behind the ball rather than a distance
     * from the touchline, because this rig is not attached to the sideline.
     */
    id: 'CABLE', name: 'CABLE CAM', standback: 17, height: 13, pxPerMetre: 9.4,
    lead: 7, track: 1.0, deadZone: 0.9, endOn: true,
    blurb: 'A stadium cable camera flying above and behind the ball, looking down the pitch the way you are attacking. It glides across the field with play and pulls back on a kick so you can see the flight and the chase together. The default.',
  },
  {
    // The coach cam. It was parked too high and too far back for the zoom to do
    // anything visible. Brought in to 22 m of standback and 24 m of height, and
    // given strong lateral tracking so it genuinely pans the field with the ball.
    id: 'TACTICAL', name: 'TACTICAL (COACH)', standback: 22, height: 24, pxPerMetre: 8.6,
    lead: 5, track: 0.85, deadZone: 1.4, endOn: false,
    blurb: 'The coach view. High enough to read both shapes, close enough to see the collision, and it pans across the field with the ball. Zoom pulls it right down to the contest.',
  },
  {
    // Over the kicker's shoulder, looking down the pitch at his target.
    id: 'SHOULDER', name: 'OVER THE SHOULDER', standback: 11, height: 6.5, pxPerMetre: 11.0,
    lead: 0, track: 1.0, deadZone: 0.5, endOn: true,
    blurb: 'Behind the kicker at head height, looking down the pitch. You see exactly what he sees: the aim line, the target, and the chase in front of him. Used automatically for every kick.',
  },
  {
    id: 'SIDELINE', name: 'SIDELINE', standback: 26, height: 12, pxPerMetre: 9.0,
    lead: 3, track: 0.85, deadZone: 1.6, endOn: false,
    blurb: 'Low on the touchline, close to the action. Collisions read hard but you lose the width of the field.',
  },
  {
    id: 'BROADCAST', name: 'BROADCAST', standback: 34, height: 21, pxPerMetre: 7.4,
    lead: 6, track: 0.7, deadZone: 2.4, endOn: false,
    blurb: 'The main gantry. Elevated, set back, tracking laterally with a long lens. What rugby looks like on television.',
  },
  {
    id: 'CHASE', name: 'CHASE', standback: 16, height: 14, pxPerMetre: 8.2,
    lead: 9, track: 1.0, deadZone: 0.8, endOn: true,
    blurb: 'Behind and above the ball, looking down the pitch. Immediate and exciting, but you cannot see the width.',
  },
  {
    id: 'POSTS', name: 'BEHIND THE POSTS', standback: 0, height: 17, pxPerMetre: 8.0,
    lead: 0, track: 0.3, deadZone: 1.0, endOn: true,
    blurb: 'Square behind the goal. The original 1991 view. Best for goal kicks, hardest for reading a backline.',
  },
];

export const camModeSpec = (id: CamMode): CamModeSpec =>
  CAM_MODES.find((m) => m.id === id) ?? CAM_MODES[0];

/**
 * Zoom multiplies pixels-per-metre and pulls the rig in. 1x is the mode's own
 * framing; 4x is a tight lens on the carrier. Tight zooms raise lateral tracking
 * to 1.0 so the ball cannot slide out of frame.
 */
export interface ZoomSpec {
  level: number;
  pxMul: number;
  heightMul: number;
  standbackMul: number;
  /** lateral tracking override; tight zooms must follow the ball side to side */
  track: number;
  label: string;
}

export const ZOOM_STEPS: Record<1 | 2 | 3 | 4, ZoomSpec> = {
  1: { level: 1, pxMul: 0.72, heightMul: 1.25, standbackMul: 1.2, track: 0.45, label: '1x — WIDEST, WHOLE PITCH' },
  2: { level: 2, pxMul: 1.0, heightMul: 1.0, standbackMul: 1.0, track: 0.65, label: '2x — STANDARD' },
  3: { level: 3, pxMul: 1.22, heightMul: 0.74, standbackMul: 0.72, track: 0.9, label: '3x — CLOSE, FOLLOWS THE BALL' },
  4: { level: 4, pxMul: 1.42, heightMul: 0.58, standbackMul: 0.52, track: 1.0, label: '4x — TIGHT, LOCKED ON THE BALL' },
};

/**
 * DYNAMIC zoom. Pulls in when the ball is in a confined contest and pushes out
 * when the field opens up, scaled by the intensity slider. At intensity 0 it is
 * identical to 2x; at 1 it swings the full range between 1x and 4x.
 */
export function dynamicZoom(
  intensity: number,
  opts: { phase: string; pressure: number; toLine: number; ballInAir: boolean; lineBreak: boolean },
): ZoomSpec {
  const i = Math.max(0, Math.min(1, intensity));
  // 0 = push right out, 1 = pull right in
  let tightness = 0.5;
  if (opts.phase === 'SCRUM' || opts.phase === 'LINEOUT') tightness = 0.78;
  else if (opts.phase === 'BREAKDOWN' || opts.phase === 'MAUL') tightness = 0.85;
  else if (opts.ballInAir) tightness = 0.18;
  else if (opts.lineBreak) tightness = 0.3;
  else if (opts.phase === 'OPEN_PLAY') tightness = 0.34 + opts.pressure * 0.4;
  if (opts.toLine < 22) tightness += 0.12;

  const blended = 0.5 + (tightness - 0.5) * i;
  const level = 1 + blended * 3;
  const t = (level - 1) / 3;
  return {
    level: Math.round(level * 10) / 10,
    /* T-55: the lens is capped and the DOLLY does the zoom — the rig closes
     * onto the contest and drops with it. The old curve pushed pxMul to 2.0
     * (a long lens): the field around the ball was optically cropped to a
     * slit and its polygon edges cut hard against the near plane. */
    pxMul: 0.72 + t * 0.7,
    heightMul: 1.25 - t * 0.67,
    standbackMul: 1.2 - t * 0.68,
    track: 0.45 + t * 0.55,
    label: `DYNAMIC ${(Math.round(level * 10) / 10).toFixed(1)}x`,
  };
}

export function resolveZoom(
  setting: ZoomSetting,
  intensity: number,
  ctx: { phase: string; pressure: number; toLine: number; ballInAir: boolean; lineBreak: boolean },
): ZoomSpec {
  if (setting === 'DYNAMIC') return dynamicZoom(intensity, ctx);
  return ZOOM_STEPS[setting];
}

/**
 * WASD relative to the camera, or to the pitch.
 *
 * Relative (default): "up" is away from the camera, so the stick always agrees
 * with what you can see. Absolute: "up" is always toward the opposition line,
 * which veterans prefer because it never changes when the camera cuts.
 */
export function mapInputToWorld(
  lat: number, dep: number, camYaw: number, attackDir: number, relative: boolean,
): { vx: number; vz: number } {
  if (!relative) {
    return { vx: lat, vz: dep * attackDir };
  }
  // Camera forward on the ground plane, and its right-hand vector.
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  return { vx: rx * lat + fx * dep, vz: rz * lat + fz * dep };
}

export const CAMERA_DATA_POINTS =
  CAM_MODES.length * 9 + Object.keys(ZOOM_STEPS).length * 6 + 8;
