// ---------------------------------------------------------------------------
// RUNNING LINES LAYER — attack + defence movement vectors per position
// ---------------------------------------------------------------------------
// This layer sits on top of the positional dataset. The positional dataset says
// WHERE a player stands in a given situation. This layer says WHAT LINE he runs
// from that position, as a metre-accurate vector path an engine can steer along.
//
// LOCAL COORDINATE FRAME (metres, relative to a reference point):
//   origin (0,0) = the reference point named in `reference`
//                  (ruck / scrum base / lineout tail / kick landing zone / catch)
//   +x = towards the OPPOSITION try line (i.e. forwards, over the gain line)
//   -x = backwards, behind the gain line
//   +y = towards the OPEN side of the field (the wide side of the ruck)
//   -y = towards the BLIND / short side
//
// The gain line is the vertical line x = 0 through the origin.
// Mirror y (y' = -y) when the openside is on the other hand.
//
// `path` is an ordered list of waypoints. Waypoint[0] is the START (where the
// player sets his feet before the ball moves). The final waypoint is the end of
// the line. Engines should Catmull-Rom / bezier smooth between waypoints and
// scale velocity by `speed`.
//
// `trigger`   = the event that starts the run (state machine transition)
// `timing`    = when to leave, relative to the ball
// `purpose`   = what the line is trying to achieve tactically
// `ifOccupied`= conflict rule if a team-mate is already running this line
// `counter`   = how a defence beats it / how an attack beats this defensive line
// ---------------------------------------------------------------------------

export type LineSide = 'attack' | 'defence';
export type LineSpeed = 'hold' | 'walk' | 'jog' | 'cruise' | 'sprint' | 'max';
export type LineRef =
  | 'ruck'
  | 'scrum base'
  | 'lineout tail'
  | 'maul'
  | 'kick landing'
  | 'catch point'
  | 'tackle contact'
  | 'own goal line';

export interface RunLine {
  id: string;
  position: number;
  side: LineSide;
  name: string;
  family: string;
  reference: LineRef;
  trigger: string;
  timing: string;
  speed: LineSpeed;
  purpose: string;
  ifOccupied: string;
  counter: string;
  path: [number, number][];
  /** derived: overall heading in degrees. 0 = straight upfield, +ve = towards open side */
  angleDeg: number;
  /** derived: total path length in metres */
  lengthM: number;
  /** derived: depth behind the gain line at the start of the run */
  startDepthM: number;
}

export type LineTuple = [
  name: string,
  family: string,
  reference: LineRef,
  trigger: string,
  timing: string,
  speed: LineSpeed,
  purpose: string,
  ifOccupied: string,
  counter: string,
  path: [number, number][]
];

export const LINE_FAMILIES: Record<string, { label: string; blurb: string; color: string }> = {
  Unders: { label: 'Unders line', blurb: 'Angled back inside the passer, attacking the inside shoulder of the defender. Beats a drifting defence.', color: '#f97316' },
  Overs: { label: 'Overs line', blurb: 'Angled out and away from the passer, attacking the outside shoulder. Beats a biting/blitzing defence.', color: '#22c55e' },
  Straight: { label: 'Straight line', blurb: 'Square, flat, at pace onto the ball. Holds the defender directly in front and preserves outside space.', color: '#38bdf8' },
  Switch: { label: 'Switch / block', blurb: 'Crossing the passer to change the point of attack and turn defenders inwards.', color: '#a855f7' },
  Decoy: { label: 'Decoy / dummy runner', blurb: 'Run hard with no expectation of the ball, purely to fix a defender and open the channel outside.', color: '#eab308' },
  Support: { label: 'Support arc', blurb: 'Trailing curve behind and inside the carrier, staying in the offload window.', color: '#14b8a6' },
  Cleanout: { label: 'Cleanout approach', blurb: 'The arc into the breakdown — never straight, always through the gate at the correct shoulder.', color: '#ef4444' },
  Fold: { label: 'Fold / reload', blurb: 'The path from an old ruck to the next role, always arriving on the inside of the ball.', color: '#94a3b8' },
  Insertion: { label: 'Insertion line', blurb: 'A deep player joining the line late from behind to create an extra man.', color: '#f43f5e' },
  Chase: { label: 'Kick-chase lane', blurb: 'A connected lane run at the ball\'s landing zone, staying onside and denying the counter route.', color: '#0ea5e9' },
  Blitz: { label: 'Blitz / shoot', blurb: 'Fast, straight, up-and-in to cut down time and space, targeting the ball carrier\'s outside shoulder.', color: '#dc2626' },
  Drift: { label: 'Drift / slide', blurb: 'Moving up and outwards with the ball, passing threats on and using the touchline as an extra defender.', color: '#7c3aed' },
  Shepherd: { label: 'Shepherd', blurb: 'Curved run that closes the outside first, herding the attacker back into the covering traffic.', color: '#0891b2' },
  Scramble: { label: 'Scramble cover', blurb: 'Broken-field pursuit that cuts the angle to a point ahead of the ball, never chasing the heels.', color: '#facc15' },
  Jackal: { label: 'Jackal approach', blurb: 'The path to the tackle contest that arrives square, on the feet, through the gate.', color: '#65a30d' },
  Backfield: { label: 'Backfield rotation', blurb: 'The sliding movement of the back three so the field is always split into covered thirds.', color: '#fbbf24' },
  Pillar: { label: 'Pillar shuffle', blurb: 'Short lateral steps holding the ruck edge; never turning the shoulders away from the ball.', color: '#fb7185' },
  Maul: { label: 'Maul / drive line', blurb: 'Bound, low, short-stepping drive angles used inside a maul or pick-and-go sequence.', color: '#d946ef' },
};

function metrics(path: [number, number][]) {
  let lengthM = 0;
  for (let i = 1; i < path.length; i++) {
    lengthM += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  const dx = path[path.length - 1][0] - path[0][0];
  const dy = path[path.length - 1][1] - path[0][1];
  const angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
  return {
    lengthM: Math.round(lengthM * 10) / 10,
    angleDeg,
    startDepthM: Math.round(-path[0][0] * 10) / 10,
  };
}

export function mkLines(position: number, side: LineSide, tuples: LineTuple[]): RunLine[] {
  return tuples.map(([name, family, reference, trigger, timing, speed, purpose, ifOccupied, counter, path], i) => ({
    id: `L${position}-${side === 'attack' ? 'A' : 'D'}${i + 1}`,
    position,
    side,
    name,
    family,
    reference,
    trigger,
    timing,
    speed,
    purpose,
    ifOccupied,
    counter,
    path,
    ...metrics(path),
  }));
}

/* ---------------- consumption helpers ---------------- */

/** Metres per second for each authored speed band. */
export const SPEED_MS: Record<LineSpeed, number> = {
  hold: 0, walk: 1.6, jog: 3.4, cruise: 5.6, sprint: 7.6, max: 9.0,
};

/**
 * Convert a local path waypoint into engine world metres.
 * `ox, oz` is the reference point in world space; `dir` is +1 when the attack
 * runs toward +z; `open` is +1 when the openside is toward +x.
 */
export function pathToWorld(
  path: [number, number][], ox: number, oz: number, dir: number, open: number,
): { x: number; z: number }[] {
  return path.map(([fx, fy]) => ({
    x: ox + fy * open,
    z: oz + fx * dir,
  }));
}

/** Catmull-Rom sample so a four-point path steers as a curve, not a dog-leg. */
export function samplePath(pts: { x: number; z: number }[], t: number): { x: number; z: number } {
  if (pts.length === 0) return { x: 0, z: 0 };
  if (pts.length === 1 || t <= 0) return pts[0];
  if (t >= 1) return pts[pts.length - 1];
  const seg = (pts.length - 1) * t;
  const i = Math.floor(seg);
  const u = seg - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[Math.min(pts.length - 1, i + 1)];
  const p3 = pts[Math.min(pts.length - 1, i + 2)];
  const cr = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z) };
}

/** Every line authored for one shirt on one side of the ball. */
export function linesFor(all: RunLine[], position: number, side: LineSide): RunLine[] {
  return all.filter((l) => l.position === position && l.side === side);
}

/** Lines grouped by tactical family, for the media guide. */
export function linesByFamily(all: RunLine[]): Record<string, RunLine[]> {
  const out: Record<string, RunLine[]> = {};
  for (const l of all) {
    for (const fam of l.family.split(',').map((f) => f.trim())) {
      (out[fam] ??= []).push(l);
    }
  }
  return out;
}
