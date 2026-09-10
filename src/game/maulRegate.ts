/**
 * SPEC_03 — MAUL RE-GATE.
 *
 * The maul contest is resolved entirely by player input parameters, never by
 * physics: a pure four-window human-v-CPU re-gate consumes `readRate` (the
 * difficulty table's read quality) and the four closed A/D commit windows, and
 * emits a deterministic `{ humanWinShare, humanWon }`. Nothing from the drive
 * simulation crosses this one-way wall.
 *
 * IMPORTANT (SPEC_05 unblock): this module was missing from the checkout and the
 * engine would not compile / run without it. It has been reconstructed in
 * *interface* — every symbol and type the maul / director code depends on is
 * present — and the resolver is a faithful deterministic model of the stated
 * contract (committed windows vs `readRate`). It is not a re-implementation of
 * the SPEC_03 tuning pass; that ticket carries its own review. The constants are
 * the beat cadence the rest of the maul code already assumes (four beats).
 */

export type MaulCommit = 'LEFT' | 'RIGHT' | 'NONE';
export type MaulContestControl = 'PENDING' | 'ATTACK_CONTROL' | 'DEFENCE_CONTROL';
export type MaulExitState =
  | 'NONE'
  | 'PICK_AND_GO'
  | 'WHEEL_AND_PEEL'
  | 'TRANSFER_TO_9'
  | 'UNPLAYABLE_SCRUM'
  | 'TOUCH_LINEOUT'
  | 'PENALTY_AWARDED'
  | 'TRY_AWARDED';

/** The re-gate is four closed input beats (the "/4" the HUD prints). */
export const MAUL_REGATE_WINDOW_COUNT = 4;

/** Length of one input beat, in seconds. Four beats close in ~2 s. */
export const MAUL_REGATE_WINDOW_SECONDS = 0.5;

/** Into the TRANSFER_TO_9 exit, the nine switches squat -> pass at this beat. */
export const MAUL_TRANSFER_PASS_START = 0.3;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Pure contest resolver. `readRate` is the CPU's read quality (0..1); the higher
 * it is, the fewer committed beats survive. Deterministic — no RNG.
 */
export function resolveMaulRegate(input: { readRate: number; windows: MaulCommit[] }): {
  humanWinShare: number;
  humanWon: boolean;
} {
  const count = MAUL_REGATE_WINDOW_COUNT;
  const committed = input.windows.filter((w) => w !== 'NONE').length;
  const raw = committed / count;               // 0..1 human commitment rate
  // The CPU neutralises up to half of the raw commitment at the sharpest read.
  const neutralised = clamp(input.readRate, 0, 1) * 0.5;
  const humanWinShare = clamp(raw * (1 - neutralised), 0, 1);
  const humanWon = humanWinShare > 0.5;
  return { humanWinShare, humanWon };
}

/* ================================================================== *
 * SPEC_03 — THE KINEMATIC MAUL CLUSTER (BIND & DRIVE)
 * ================================================================== *
 *
 * A formed maul is ONE aggregate body, the same modelling decision the
 * scrum made long before it: every bound player locks into a
 * forward-directed drive vector, and the mass and the vectors SUM
 * KINEMATICALLY — the cluster accelerates as F_net / Σm, never by a
 * per-man position write. Nothing below knows a Director, a frame index,
 * or a law clock; it is pure arithmetic the engine integrates exactly
 * once per frame, so the no-explosion guarantee lives in exactly one
 * place:
 *
 *   1. force summation is defensive: a NaN drive contribution is a zero,
 *      never a poisoned cluster;
 *   2. acceleration is capped (MAUL_CLUSTER_MAX_ACCEL) — a bug upstream
 *      can make the shove strong, it cannot make it instantaneous;
 *   3. velocity is hard-band-limited (MAUL_CLUSTER_BAND) — sixteen bound
 *      men move as a pile at pile speed, full stop;
 *   4. the per-frame velocity change is itself the cap, so no single
 *      16 ms integration step can write an impossible displacement.
 */

/** One bound player inside the cluster. */
export interface MaulBind {
  team: 'A' | 'B';
  num: number;
  /** 1 = the head (the carrier at formation) … tail = the hindmost foot. */
  rank: number;
  /** his body mass, kg (engine/forwardPack.forwardMass of his PWR). */
  mass: number;
  /** his OWN drive vector for this frame. Signed along the pitch axis in
   *  the ATTACK's frame: + shoves the cluster toward the attacking try
   *  line, − holds or shoves it back. Lateral is the wheel lane. */
  driveN: number;
  driveX: number;
}

/** Forwards bound per side in a formed maul (the pack, 1-8). */
export const MAUL_RANKS_PER_SIDE = 8;

/** Speed band of the rolling maul, m/s, in the attack frame. A driving
 *  maul creeps forward at barely a walking pace; a maul being shoved
 *  backwards moves at less than half of that. */
export const MAUL_CLUSTER_MAX_SPEED = 1.15;
export const MAUL_CLUSTER_REVERSE_SPEED = -0.5;

/** Acceleration ceiling, m/s². Fifteen hundred kilograms of bound pack
 *  does not leap: this is the joint-explosion guard, expressed as the
 *  physics itself. */
export const MAUL_CLUSTER_MAX_ACCEL = 3.0;

/** The ball channels one rank backwards per this many seconds of attack
 *  control (three-plus seconds head-to-tail — a deliberate hand-to-hand
 *  path down the bound bodies, not a flick). */
export const MAUL_CHANNEL_RANK_SECONDS = 0.45;

/** Summed mass of the cluster, kg. */
export function maulClusterMass(bound: readonly MaulBind[]): number {
  let m = 0;
  for (const b of bound) m += Number.isFinite(b.mass) ? b.mass : 0;
  return m;
}

/** Summed drive vector of the cluster, N — axial (attack frame) and wheel
 *  lane. A non-finite contribution is dropped, not propagated. */
export function maulClusterNet(bound: readonly MaulBind[]): { n: number; x: number } {
  let n = 0, x = 0;
  for (const b of bound) {
    if (Number.isFinite(b.driveN)) n += b.driveN;
    if (Number.isFinite(b.driveX)) x += b.driveX;
  }
  return { n, x };
}

/** The cluster's forward momentum at a given rolling speed, kg·m/s — the
 *  quantity the probe measures to prove a drive is genuinely rolling. */
export function maulClusterMomentum(bound: readonly MaulBind[], speed: number): number {
  return maulClusterMass(bound) * (Number.isFinite(speed) ? speed : 0);
}

/** The specific acceleration a net axial force buys the cluster, capped.
 *  Newton, with the joint fuse wired in. */
export function maulClusterAccel(netN: number, mass: number): number {
  if (!Number.isFinite(netN) || !Number.isFinite(mass) || mass <= 0) return 0;
  return clamp(netN / mass, -MAUL_CLUSTER_MAX_ACCEL, MAUL_CLUSTER_MAX_ACCEL);
}

/**
 * Integrate the cluster's rolling speed one frame. The only velocity the
 * maul is ever allowed to have comes through this funnel: capped
 * acceleration from the summed drive vector, hard speed band, non-finite
 * input collapsing to a standstill. `dir` keeps the integration honest
 * for a side attacking −z: the speed band is authored in the ATTACK's
 * frame (positive = toward their try line) and the engine multiplies by
 * `dir` when it displace the cluster — a team attacking backwards no
 * longer drives upfield by sign accident.
 */
export function stepMaulClusterSpeed(speed: number, netN: number, mass: number, dt: number): number {
  const v0 = Number.isFinite(speed) ? speed : 0;
  const v1 = v0 + maulClusterAccel(netN, mass) * clamp(dt, 0, 0.05);
  return clamp(v1, MAUL_CLUSTER_REVERSE_SPEED, MAUL_CLUSTER_MAX_SPEED);
}

/* ================================================================== *
 * SPEC_03 — THE UPRIGHT DRIVING CLUSTER (the maul's SHAPE)
 * ================================================================== *
 *
 * The kinematic model above is the maul's PHYSICS; this section is its
 * GEOMETRY, and until now there was none. The placement writer strung the
 * attack ranks down the pitch axis at a fixed 0.72 m cadence — eight men in
 * a single file five and a half metres long — and put the defence on two
 * parallel lines up to six metres ahead of the ball. Sixteen forwards in
 * three straight lines is not what a maul looks like, and it read on screen
 * exactly as it was authored: a flat row of bodies spread down the field.
 *
 * A formed maul is ONE UPRIGHT, CONDENSED OVAL. The ball carrier stands up
 * (nobody drives a maul bent double), his binders wrap forward at chest
 * height, the defenders push back against the front wall of that oval, and
 * the whole thing is small: 2.5 m across the pitch, 3.0 m down the drive
 * axis, so the sixteen bound men read as one body with legs rather than a
 * queue. Every number below is authored here, once, and consumed by
 * director.placeBound (positions, facing, posture, hands) and by
 * ThreePlayerManager (the ball's position inside the cluster).
 *
 *   attack frame   n = along the drive (+ = toward the attack's try line)
 *                  l = across it (+ = the attack's left of the drive)
 *   ranks          shirt number == bind rank, exactly as buildMaulBinds
 *                  builds them: rank 1 is the head (the carrier at
 *                  formation), rank 8 the hindmost foot at the tail.
 */

/** How wide the bound cluster is across the pitch, metres. */
export const MAUL_CLUSTER_WIDTH_M = 2.5;
/** How deep it is down the drive axis, metres. */
export const MAUL_CLUSTER_DEPTH_M = 3.0;

/** Torso pitch out of vertical (radians) — the upright ceiling. A maul is
 *  fought on the feet: nobody in a formed maul is bent over past ~15°, which
 *  is also the number the set-piece visual probe asserts. */
export const MAUL_UPRIGHT_PITCH_MAX_RAD = (15 * Math.PI) / 180;
/** The ball carrier: fully upright, ball tight against the chest. */
export const MAUL_CARRIER_PITCH_RAD = (4 * Math.PI) / 180;
/** His binders: a working shove, still upright. */
export const MAUL_BINDER_PITCH_RAD = (7 * Math.PI) / 180;
/** The defenders: braced forward slightly, pushing — never bent double. */
export const MAUL_DEFENDER_PITCH_RAD = (12 * Math.PI) / 180;

/** Where a binder's hands are: wrapped forward at CHEST height, metres. */
export const MAUL_BIND_HEIGHT_M = 1.2;
/** How far in front of his own chest a binder's hands reach, metres. */
export const MAUL_BIND_REACH_M = 0.45;

/** The cluster's slot envelope, in the attack frame, metres. The bodies are
 *  ~0.55 m deep and ~0.6 m wide, so this half-metre-authoring plus a body is
 *  the 3.0 × 2.5 m shape: the furthest man's slot is 1.63 m from the middle,
 *  well inside the "bound radius < 2.0 m" the probe measures. */
export const MAUL_SLOT_MAX_N = 1.35;
export const MAUL_SLOT_MAX_L = 0.9;

export type MaulSlotRole = 'CARRIER' | 'BINDER' | 'DEFENDER';

/** One authored slot of the cluster. `n`/`l` are the attack frame above. */
export interface MaulSlotSpec {
  num: number;
  n: number;
  l: number;
  role: MaulSlotRole;
}

/**
 * THE ATTACKING HALF — the ball carrier at the head of the drive with a
 * binder either side of him (arms wrapped forward at chest height), a second
 * bind rank driving through the hips of the first, and the two back-row men
 * closing the tail. The ball lives at rank 1 and channels back to rank 7/8.
 */
export const MAUL_ATTACK_SLOTS: readonly MaulSlotSpec[] = [
  { num: 1, n: 0.60, l: 0, role: 'CARRIER' },
  { num: 2, n: 0.55, l: -0.9, role: 'BINDER' },
  { num: 3, n: 0.55, l: 0.9, role: 'BINDER' },
  { num: 4, n: -0.15, l: -0.9, role: 'BINDER' },
  { num: 5, n: -0.15, l: 0, role: 'BINDER' },
  { num: 6, n: -0.15, l: 0.9, role: 'BINDER' },
  { num: 7, n: -1.05, l: -0.55, role: 'BINDER' },
  { num: 8, n: -1.05, l: 0.55, role: 'BINDER' },
];

/**
 * THE DEFENDING HALF — bound upright and pushing back against the attacking
 * front wall: the front three against the carrier and his binders, then the
 * engine room, then the tail. Never a line abreast, never ahead of the ball
 * by more than the cluster's own half-depth.
 */
export const MAUL_DEFENCE_SLOTS: readonly MaulSlotSpec[] = [
  { num: 1, n: 0.95, l: 0, role: 'DEFENDER' },
  { num: 2, n: 0.95, l: -0.9, role: 'DEFENDER' },
  { num: 3, n: 0.95, l: 0.9, role: 'DEFENDER' },
  { num: 4, n: 1.30, l: -0.9, role: 'DEFENDER' },
  { num: 5, n: 1.30, l: 0, role: 'DEFENDER' },
  { num: 6, n: 1.30, l: 0.9, role: 'DEFENDER' },
  { num: 7, n: 1.35, l: -0.5, role: 'DEFENDER' },
  { num: 8, n: 1.35, l: 0.5, role: 'DEFENDER' },
];

/** A placed cluster slot: the authored shape resolved onto the pitch. */
export interface MaulClusterSlot extends MaulSlotSpec {
  team: 'A' | 'B';
  /** bind rank: 1 = the head, 8 = the hindmost foot (== the shirt number) */
  rank: number;
  /** torso pitch out of vertical, radians — see MAUL_*_PITCH_RAD */
  pitch: number;
  /** world position, logical pitch metres */
  x: number;
  z: number;
  /** the bind/reach point of his hands: world, logical metres */
  handX: number;
  handY: number;
  handZ: number;
  /** facing sign for the engine (`Live.face`) */
  face: 1 | -1;
}

const maulSlotPitch = (s: MaulSlotSpec): number =>
  s.role === 'CARRIER' ? MAUL_CARRIER_PITCH_RAD
    : s.role === 'BINDER' ? MAUL_BINDER_PITCH_RAD
      : MAUL_DEFENDER_PITCH_RAD;

/**
 * RESOLVE THE OVAL. Pure geometry: no Director, no RNG, no state. Given the
 * cluster's mark (the ball's progress), the attacking side's drive direction
 * and the wheel's yaw in degrees, return every bound man's slot — position,
 * rank, posture and the point his hands are working at.
 *
 * The two sides are mirrored through the mark so the attacking front wall
 * and the defending front wall are always in contact (0.35 m of slot
 * separation, which is two shoulders) whatever the drive direction.
 */
export function maulClusterSlots(
  attacking: 'A' | 'B', dir: number, x: number, z: number,
  yawDeg = 0, ranks: number = MAUL_RANKS_PER_SIDE,
): MaulClusterSlot[] {
  const d: 1 | -1 = dir >= 0 ? 1 : -1;
  const cap = Math.max(1, Math.min(MAUL_RANKS_PER_SIDE, Math.round(ranks)));
  const yaw = (Number.isFinite(yawDeg) ? yawDeg : 0) * (Math.PI / 180);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  /* the drive axis and its lateral partner in world x/z. l is taken as the
   * perpendicular of n (n.z, -n.x), which stays orthonormal for both
   * directions of play — a side attacking -z gets the mirrored oval, which
   * is the same oval. */
  const nx = d * sy, nz = d * cy;
  const lx = nz, lz = -nx;
  const out: MaulClusterSlot[] = [];
  for (const team of [attacking, attacking === 'A' ? 'B' : 'A'] as const) {
    const table = team === attacking ? MAUL_ATTACK_SLOTS : MAUL_DEFENCE_SLOTS;
    for (const s of table) {
      if (s.num > cap) continue;
      /* sinbin filtering is the caller's: this is pure shape. */
      const wx = x + s.n * nx + s.l * lx;
      const wz = z + s.n * nz + s.l * lz;
      /* the hands work FORWARD of the man, at chest height: a binder wraps
       * onto the body in front of him, a defender braces into the wall. */
      const handX = wx + MAUL_BIND_REACH_M * nx;
      const handZ = wz + MAUL_BIND_REACH_M * nz;
      out.push({
        ...s, team, rank: s.num, pitch: maulSlotPitch(s),
        x: wx, z: wz,
        handX, handY: MAUL_BIND_HEIGHT_M, handZ,
        face: team === attacking ? d : (d === 1 ? -1 : 1),
      });
    }
  }
  return out;
}

/** The hindmost-foot mark of the cluster — the deepest attacking slot on the
 *  drive axis, which is where the tail stands and where the nine's
 *  extraction law is measured from. Pure geometry, taken from the authored
 *  shape rather than from a fixed per-rank cadence, so the mark cannot
 *  disagree with the bodies the renderer lays down. */
export function maulTailMark(dir: number, ranks: number, x: number, z: number): { x: number; z: number } {
  const cap = Math.max(1, Math.min(MAUL_RANKS_PER_SIDE, Math.round(ranks)));
  const d = dir >= 0 ? 1 : -1;
  let deep = MAUL_ATTACK_SLOTS[0].n;
  for (const s of MAUL_ATTACK_SLOTS) if (s.num <= cap) deep = Math.min(deep, s.n);
  return { x, z: z + d * deep };
}

/** Where the ball is inside the cluster, given its channelled rank: the
 *  carrier's chest at rank 1, the tail's hands at the last rank. The ball
 *  rides ON the bodies (y = 1.02 m), which is what "hand to hand down the
 *  bound ranks" means. Pure. */
export function maulBallMark(
  dir: number, x: number, z: number, yawDeg: number, ballRank: number,
): { x: number; y: number; z: number } {
  const d = dir >= 0 ? 1 : -1;
  const yaw = (Number.isFinite(yawDeg) ? yawDeg : 0) * (Math.PI / 180);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const nx = d * sy, nz = d * cy;
  const lx = nz, lz = -nx;
  const rank = Math.max(1, Math.min(MAUL_RANKS_PER_SIDE, Math.round(ballRank)));
  const spec = MAUL_ATTACK_SLOTS.find((s) => s.num === rank) ?? MAUL_ATTACK_SLOTS[0];
  return {
    x: x + spec.n * nx + spec.l * lx,
    y: 1.02,
    z: z + spec.n * nz + spec.l * lz,
  };
}

/**
 * Channel the ball one rank further back per MAUL_CHANNEL_RANK_SECONDS of
 * ATTACK-control time. `rank` is the 0-based-with-1-head integer the whole
 * codebase reads (`ballRank`, 1 = the carrier's own rank at formation);
 * the tail is `tailRank`. Returns the clamped integer rank and the
 * accumulator, so the engine can hold it across frames.
 */
export function channelBallRank(
  rank: number, tailRank: number, channelT: number, dt: number,
): { rank: number; channelT: number; popped: boolean } {
  const t = channelT + dt;
  if (t < MAUL_CHANNEL_RANK_SECONDS) return { rank, channelT: t, popped: false };
  const steps = Math.floor(t / MAUL_CHANNEL_RANK_SECONDS);
  const next = clamp(rank + steps, 1, Math.max(1, Math.round(tailRank)));
  return { rank: next, channelT: next >= tailRank ? 0 : t - steps * MAUL_CHANNEL_RANK_SECONDS, popped: next > rank };
}

/* ================================================================== *
 * SPEC_03 — THE HELD-UP TRIGGER (Law 16/17 formation gate)
 * ================================================================== *
 *
 * A maul forms from open play when the ball-carrier is HELD UP ON HIS
 * FEET by at least one defender and at least one team-mate BINDS onto
 * him. Two pure tests decide it before any dice is touched:
 *
 *   heldUpMaulBindRange  — geometry: is a binder close enough to lock on?
 *   heldUpMaulLiftVerdict — mechanics: does the carrier side's combined
 *                          upward strength keep him standing?
 *
 * The stochastic governor (heldUpMaulChance) then prices how often the
 * contest lawfully ends upright rather than in a takedown, so matches do
 * not become an unbroken series of mauls.
 */

/** Binding reach of a support man arriving at the held carrier, metres. */
export const MAUL_BIND_RANGE_M = 1.9;

/** Squared reach, for the hot loop that never takes the root. */
export const MAUL_BIND_RANGE_M2 = MAUL_BIND_RANGE_M * MAUL_BIND_RANGE_M;

/** Geometry: is a potential binder close enough to the held carrier to
 *  lock on? Squared-distance compare, allocation-free. */
export function heldUpMaulInBindRange(dx: number, dz: number): boolean {
  return dx * dx + dz * dz <= MAUL_BIND_RANGE_M2;
}

/**
 * The lift verdict. The tackler drags down with his PWR; the carrier
 * resists with his full PWR plus the binder's shove. He stays standing —
 * a lawful maul — when the upright side's combined figure reaches the
 * tackler's. Deterministic: the same three bodies produce the same
 * verdict, every time.
 */
export function heldUpMaulLiftVerdict(carPWR: number, tacklerPWR: number, binderPWR: number): boolean {
  if (!Number.isFinite(carPWR) || !Number.isFinite(tacklerPWR) || !Number.isFinite(binderPWR)) return false;
  return carPWR + binderPWR * 0.8 >= tacklerPWR * 1.05;
}

/**
 * How often a satisfied gate converts to a formed maul. Priced off the
 * attacking nation's maul attribute (the coached skill of staying on
 * your feet in contact): a drilled pack converts about one in three at
 * the top end, an average side one in five. Pure.
 */
export function heldUpMaulChance(maulAttribute: number): number {
  return clamp(0.12 + clamp(maulAttribute, 0, 100) / 100 * 0.24, 0.05, 0.4);
}
