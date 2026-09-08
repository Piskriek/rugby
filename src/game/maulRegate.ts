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

/** Rank-to-rank spacing down the pitch axis, metres — the same cadence the
 *  placement writer (director.placeBound) lays the attack ranks down at. */
export const MAUL_RANK_SPACING_M = 0.72;

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

/** The hindmost-foot mark of the cluster — where the tail stands and the
 *  nine's extraction law is measured from. Pure geometry. */
export function maulTailMark(dir: number, ranks: number, x: number, z: number): { x: number; z: number } {
  const tail = Math.max(1, Math.round(ranks));
  return { x, z: z - dir * tail * MAUL_RANK_SPACING_M };
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
