/**
 * SHAPES — how a professional rugby side actually stands.
 *
 * The reference analysis is the 1-3-3-1 attacking structure (Connacht v
 * Gloucester, Japan's 1-3-2-2 at RWC 2019, and the general pod-system literature):
 *
 *   "The numbers in a 1-3-3-1 formation determine how many forwards are in each
 *    group and where they stand. The '1' stands alone on the wing, the '3' on
 *    the 15 metre line. The idea is to spread out the forwards instead of having
 *    them all bunch around the ball, and stretch the defence as a result."
 *
 * Inside a pod of three, each man has a fixed job:
 *   FRONT PRONG  — the receiver. Either carries into contact, or tips a short
 *                  pass to the outside prong. Never tips back inside.
 *   INSIDE PRONG — clears out if the front prong takes contact.
 *   OUTSIDE PRONG— takes the tip pass, or runs the decoy to hold the drift.
 * A sweeper sits behind the middle man so the ball can be rolled out the back
 * of the pod to outflank a compressed defence.
 *
 * Every entry here is a data point consumed by the engine every frame.
 */

/* ============================ PODS ============================ */

export type PodRole = 'FRONT_PRONG' | 'INSIDE_PRONG' | 'OUTSIDE_PRONG' | 'SWEEPER' | 'WIDE_1' | 'BACKLINE' | 'DISTRIBUTOR';

export interface PodSlot {
  num: number;
  role: PodRole;
  /** lateral offset from the ruck, in metres, openside positive */
  lat: number;
  /** metres behind the gain line */
  depth: number;
  job: string;
}

export interface AttackShape {
  id: string;
  name: string;
  blurb: string;
  /** the reading of the numbers, e.g. 1-3-3-1 reads left to right across the field */
  reading: string;
  /** lateral anchor for each group, in metres from the ruck, openside positive */
  groups: { lat: number; size: number; label: string }[];
  slots: PodSlot[];
  /** how quickly the shape reforms after a breakdown, in seconds */
  realignTime: number;
  /** chance the pod tips rather than carries, 0..1 */
  tipTendency: number;
  /** chance of a tunnel pass through the pod to the backs */
  tunnelTendency: number;
  width: number;
  depthBias: number;
}

/**
 * Builds the fifteen slots for a shape definition. Group anchors are given;
 * shirt numbers are assigned to pods in a fixed order so a hooker is never
 * asked to sprint to the far touchline — a documented objection to naive shapes.
 */
function build(
  groups: { lat: number; size: number; label: string }[],
  wide: number[],
  backs: { num: number; lat: number; depth: number; job: string }[],
  meta: Partial<AttackShape>,
): AttackShape {
  const slots: PodSlot[] = [];
  // The pack is split across the pods. Front row and locks go to the middle
  // pods (shortest sprint); back row distributes to the edges.
  // The eight forwards, ordered so the nearest men fill the middle pods.
  const pack = [1, 3, 4, 5, 2, 6, 8, 7];
  let pi = 0;
  const assigned: number[] = [];
  groups.forEach((g) => {
    const list: number[] = [];
    for (let i = 0; i < g.size && pi < pack.length; i++) list.push(pack[pi++]);
    assigned.push(...list);
    const jobs: PodRole[] = g.size === 1 ? ['WIDE_1']
      : g.size === 2 ? ['FRONT_PRONG', 'OUTSIDE_PRONG']
        : ['FRONT_PRONG', 'INSIDE_PRONG', 'OUTSIDE_PRONG'];
    const spread = g.size === 1 ? 0 : g.size === 2 ? 1.6 : 2.4;
    list.forEach((num, i) => {
      slots.push({
        num,
        role: jobs[i] ?? 'INSIDE_PRONG',
        lat: g.lat + (i - (list.length - 1) / 2) * spread,
        depth: 4.2 + (i === 1 && list.length === 3 ? 0.9 : 0) + (jobs[i] === 'SWEEPER' ? 2.4 : 0),
        job: jobs[i] === 'FRONT_PRONG' ? 'TAKE THE BALL AT PACE, OR TIP IT WIDE'
          : jobs[i] === 'INSIDE_PRONG' ? 'CLEAR OUT THE FIRST DEFENDER PAST THE BALL'
            : jobs[i] === 'OUTSIDE_PRONG' ? 'RUN THE TIP LINE, OR HOLD THE DRIFT AS A DECOY'
              : jobs[i] === 'WIDE_1' ? 'HOLD THE WIDEST CHANNEL, BE THERE FOR THE RELEASE'
                : 'SUPPORT',
      });
    });
  });
  // Backs sit deeper, behind the middle man of the pod they are playing off.
  for (const b of backs) slots.push({ num: b.num, role: 'BACKLINE', lat: b.lat, depth: b.depth, job: b.job });
  for (const w of wide) {
    slots.push({
      num: w, role: 'WIDE_1', lat: w === 11 ? -26 : 26, depth: 8.5,
      job: 'STAY OUT WIDE — THE LAST PASS COMES TO YOU',
    });
  }
  return {
    id: meta.id ?? 'SHAPE', name: meta.name ?? 'SHAPE', blurb: meta.blurb ?? '',
    reading: meta.reading ?? '', groups, slots,
    realignTime: meta.realignTime ?? 2.2,
    tipTendency: meta.tipTendency ?? 0.35,
    tunnelTendency: meta.tunnelTendency ?? 0.25,
    width: meta.width ?? 1, depthBias: meta.depthBias ?? 1,
  };
}

/* ---------- 1-3-3-1: the standard ---------- */
const S_1331 = build(
  [
    { lat: -24, size: 1, label: '1 — WING' },
    { lat: -11, size: 3, label: '3 — BLIND POD' },
    { lat: 11, size: 3, label: '3 — OPEN POD' },
    { lat: 24, size: 1, label: '1 — WING' },
  ],
  [11, 14],
  [
    { num: 9, lat: 1.2, depth: 3.4, job: 'DISTRIBUTE FROM THE BASE, SNipe ONLY IF THE FRINGE IS EMPTY' },
    { num: 10, lat: 8.0, depth: 7.4, job: 'FIRST RECEIVER — DECIDE KICK, PASS OR CARRY' },
    { num: 12, lat: 13.0, depth: 8.0, job: 'SECOND RECEIVER — FIX YOUR MAN THEN PASS OR CRASH' },
    { num: 13, lat: 17.5, depth: 8.6, job: 'THIRD RECEIVER — RUN THE OUTSIDE BREAK' },
    { num: 15, lat: 12.0, depth: 14.5, job: 'SWEEP — COVER THE KICK BEHIND AND JOIN AS THE EXTRA MAN' },
  ],
  {
    id: 'S-1331', name: '1-3-3-1', reading: '1 · 3 · 3 · 1',
    blurb: 'A forward alone on each wing, two pods of three in the middle. Symmetrical, so the attack can go either way without reforming.',
    realignTime: 2.0, tipTendency: 0.38, tunnelTendency: 0.3, width: 1.0, depthBias: 1.0,
  },
);

/* ---------- 2-4-2: the wide-forward shape ---------- */
const S_242 = build(
  [
    { lat: -20, size: 2, label: '2 — BLIND PAIR' },
    { lat: 0, size: 4, label: '4 — MIDFIELD POD' },
    { lat: 20, size: 2, label: '2 — OPEN PAIR' },
  ],
  [11, 14],
  [
    { num: 9, lat: 1.2, depth: 3.4, job: 'DISTRIBUTE FROM THE BASE' },
    { num: 10, lat: 7.5, depth: 7.0, job: 'FIRST RECEIVER OFF THE MIDFIELD POD' },
    { num: 12, lat: 12.5, depth: 7.8, job: 'SECOND RECEIVER' },
    { num: 13, lat: 16.5, depth: 8.4, job: 'THIRD RECEIVER' },
    { num: 15, lat: 11.0, depth: 14.0, job: 'SWEEP BEHIND THE LINE' },
  ],
  {
    id: 'S-242', name: '2-4-2', reading: '2 · 4 · 2',
    blurb: 'Four forwards in the midfield, a pair on each flank. Protects the middle of the field where defenders are most numerous.',
    realignTime: 2.4, tipTendency: 0.3, tunnelTendency: 0.34, width: 0.82, depthBias: 1.05,
  },
);

/* ---------- 1-3-2-2: Japan's shape ---------- */
const S_1322 = build(
  [
    { lat: -25, size: 1, label: '1 — WING' },
    { lat: -10, size: 3, label: '3 — DECOY POD' },
    { lat: 6, size: 2, label: '2 — STRIKE PAIR' },
    { lat: 19, size: 2, label: '2 — WIDE STRIKE' },
  ],
  [11, 14],
  [
    { num: 9, lat: 1.2, depth: 3.2, job: 'DISTRIBUTE FAST — THE SHAPE ONLY WORKS AT TEMPO' },
    { num: 10, lat: 6.5, depth: 6.4, job: 'FIRST RECEIVER — PLAY THE TUNNEL PASS THROUGH THE POD' },
    { num: 12, lat: 11.5, depth: 7.2, job: 'SECOND RECEIVER ON AN ANGLED LINE' },
    { num: 13, lat: 15.5, depth: 7.8, job: 'THIRD RECEIVER — RUN ONTO THE RELEASE' },
    { num: 15, lat: 10.0, depth: 13.0, job: 'SWEEP AND COUNTER-ATTACK' },
  ],
  {
    id: 'S-1322', name: '1-3-2-2', reading: '1 · 3 · 2 · 2',
    blurb: 'The first pod is a honeypot decoy, the later pairs strike on angles. Won Japan a World Cup quarter-final.',
    realignTime: 1.7, tipTendency: 0.52, tunnelTendency: 0.46, width: 1.08, depthBias: 0.88,
  },
);

/* ---------- 1-2-3-2-1: the full spread ---------- */
const S_12321 = build(
  [
    { lat: -26, size: 1, label: '1 — WING' },
    { lat: -15, size: 2, label: '2 — PAIR' },
    { lat: 0, size: 3, label: '3 — MIDFIELD POD' },
    { lat: 15, size: 2, label: '2 — PAIR' },
    { lat: 26, size: 1, label: '1 — WING' },
  ],
  [11, 14],
  [
    { num: 9, lat: 1.2, depth: 3.4, job: 'DISTRIBUTE FROM THE BASE' },
    { num: 10, lat: 7.0, depth: 6.8, job: 'FIRST RECEIVER' },
    { num: 12, lat: 12.0, depth: 7.4, job: 'SECOND RECEIVER' },
    { num: 13, lat: 16.0, depth: 8.0, job: 'THIRD RECEIVER' },
    { num: 15, lat: 11.0, depth: 13.5, job: 'SWEEP' },
  ],
  {
    id: 'S-12321', name: '1-2-3-2-1', reading: '1 · 2 · 3 · 2 · 1',
    blurb: 'Maximum width. Stretches a drift defence to breaking, but leaves nobody home if the ball is lost.',
    realignTime: 2.8, tipTendency: 0.42, tunnelTendency: 0.28, width: 1.22, depthBias: 1.12,
  },
);

/* ---------- 3-2-3: the squeeze, for a dominant pack ---------- */
const S_323 = build(
  [
    { lat: -7, size: 3, label: '3 — TIGHT POD' },
    { lat: 6, size: 2, label: '2 — CARRY PAIR' },
    { lat: 18, size: 3, label: '3 — WIDE POD' },
  ],
  [11, 14],
  [
    { num: 9, lat: 1.0, depth: 3.0, job: 'DISTRIBUTE SHORT AND FAST' },
    { num: 10, lat: 6.0, depth: 6.6, job: 'FIRST RECEIVER OFF THE TIGHT POD' },
    { num: 12, lat: 11.0, depth: 7.2, job: 'SECOND RECEIVER' },
    { num: 13, lat: 15.0, depth: 7.8, job: 'THIRD RECEIVER' },
    { num: 15, lat: 10.0, depth: 13.0, job: 'SWEEP' },
  ],
  {
    id: 'S-323', name: '3-2-3', reading: '3 · 2 · 3',
    blurb: 'Everything in the middle third. One-out carries all day, then the wide pod releases the backs. For a pack that can win the collision.',
    realignTime: 1.9, tipTendency: 0.26, tunnelTendency: 0.22, width: 0.7, depthBias: 0.94,
  },
);

export const ATTACK_SHAPES: AttackShape[] = [S_1331, S_242, S_1322, S_12321, S_323];
export const shapeById = (id: string) => ATTACK_SHAPES.find((s) => s.id === id) ?? S_1331;

/** Which shape a given archetype defaults to. */
export const ARCHETYPE_SHAPE: Record<string, string> = {
  'BOULDER ATHLETIC': 'S-323',
  'IRONSIDE TECHNICAL': 'S-1331',
  'TEMPO WIDE': 'S-12321',
  'TERRITORY KICK': 'S-242',
  'CHAOS OFFLOAD': 'S-1322',
};

/* ============================ DEFENSIVE SYSTEMS ============================ */

export interface DefenceSystem {
  id: string; name: string; blurb: string;
  /** metres per second the line advances */
  lineSpeed: number;
  /** 0 = man-on-man, 1 = full drift */
  drift: number;
  /** 0 = hold, 1 = shoot the first receiver */
  shoot: number;
  /** metres behind the previous man, deepest at the edge */
  umbrella: number;
  /** maximum legal spacing between defenders */
  maxSpacing: number;
  /** how far the sweeper sits behind the line */
  sweeperDepth: number;
  /** who guards the ruck fringe, and how wide */
  fringeGuard: number;
  job: string;
}

export const DEFENCE_SYSTEMS: DefenceSystem[] = [
  { id: 'DF-BLITZ', name: 'BLITZ / RUSH', blurb: 'The whole line flies up together on the inside shoulder. Wins collisions, concedes the wide channel if the tackle is missed.', lineSpeed: 8.4, drift: 0.12, shoot: 0.95, umbrella: 0.4, maxSpacing: 3.4, sweeperDepth: 16, fringeGuard: 4.5, job: 'SHOOT UP HARD ON THE INSIDE SHOULDER — DO NOT DRIFT' },
  { id: 'DF-DRIFT', name: 'DRIFT', blurb: 'Slide with the pass, push the wide man into touch. Never shoots.', lineSpeed: 5.4, drift: 0.92, shoot: 0.15, umbrella: 1.2, maxSpacing: 4.0, sweeperDepth: 14, fringeGuard: 5.5, job: 'SLIDE WITH THE BALL, DELIVER THE WIDE MAN INTO TOUCH' },
  { id: 'DF-UMBRELLA', name: 'UMBRELLA', blurb: 'A curved line, deepest at the edge. Nothing gets around the outside.', lineSpeed: 5.8, drift: 0.58, shoot: 0.3, umbrella: 2.6, maxSpacing: 3.8, sweeperDepth: 18, fringeGuard: 5.0, job: 'CURVE OUT AS YOU GO WIDE — NOTHING GETS OUTSIDE YOU' },
  { id: 'DF-MAN', name: 'MAN-ON-MAN', blurb: 'Every defender takes his opposite number. No cover behind.', lineSpeed: 6.6, drift: 0.06, shoot: 0.5, umbrella: 0.0, maxSpacing: 4.0, sweeperDepth: 12, fringeGuard: 5.0, job: 'FIND YOUR OPPOSITE NUMBER AND STAY ON HIM' },
  { id: 'DF-WEDGE', name: 'WEDGE / BRACES', blurb: 'Two up-and-in tacklers on the carrier, the rest hold. Used against a big ball-carrier.', lineSpeed: 6.0, drift: 0.2, shoot: 0.75, umbrella: 0.6, maxSpacing: 3.2, sweeperDepth: 15, fringeGuard: 3.8, job: 'DOUBLE HIT ON THE CARRIER — TWO MEN IN' },
];

export const defenceById = (id: string) => DEFENCE_SYSTEMS.find((d) => d.id === id) ?? DEFENCE_SYSTEMS[2];

/** Defenders' lateral channels, in metres from the ruck, openside positive. */
export const DEFENCE_CHANNELS = [
  { num: 6, lat: -4.6, depth: 2.2 }, { num: 7, lat: 2.8, depth: 1.8 }, { num: 8, lat: 5.0, depth: 2.6 },
  { num: 9, lat: -1.6, depth: 1.2 }, { num: 10, lat: 8.0, depth: 3.0 }, { num: 12, lat: 12.4, depth: 3.4 },
  { num: 11, lat: -16.5, depth: 4.6 }, { num: 13, lat: 16.4, depth: 3.8 }, { num: 14, lat: 20.5, depth: 4.8 },
  { num: 1, lat: -7.4, depth: 2.0 }, { num: 3, lat: 7.6, depth: 2.0 }, { num: 4, lat: -10.4, depth: 2.4 },
  { num: 5, lat: 10.6, depth: 2.4 }, { num: 2, lat: -13.0, depth: 2.2 },
];

/* ============================ PHASE PLANS ============================
 * The CPU enters each phase with a called play and commits to it across phases.
 * This is the direct answer to "the CPU does one pass and goes into a tackle".
 */

export type PlayCall =
  | 'POD_CARRY' | 'POD_TIP' | 'TUNNEL_PASS' | 'WIDE_SWEEP' | 'MISS_PASS'
  | 'BLIND_SIDE' | 'BOX_KICK' | 'TERRITORY_PUNT' | 'BOMB' | 'CROSS_FIELD'
  | 'DROP_GOAL' | 'PICK_AND_GO' | 'LOOPL_PASS' | 'SWITCH';

export interface PhasePlan {
  call: PlayCall;
  label: string;
  /** which phases of a sequence it belongs in: 1 = early, 3 = late */
  when: number;
  risk: number;
  reward: number;
  zone: 'TIGHT' | 'MIDFIELD' | 'WIDE' | 'ANY';
  /** what the nine and ten must do */
  instruction: string;
}

export const PLAYBOOK: PhasePlan[] = [
  { call: 'POD_CARRY', label: 'POD CARRY', when: 1, risk: 0.08, reward: 0.3, zone: 'ANY', instruction: 'Nine to the front prong, take contact on your terms, inside prong clears.' },
  { call: 'PICK_AND_GO', label: 'PICK AND GO', when: 1, risk: 0.12, reward: 0.34, zone: 'TIGHT', instruction: 'Eight picks from the base, hits the fringe before it sets.' },
  { call: 'POD_TIP', label: 'POD TIP', when: 2, risk: 0.2, reward: 0.55, zone: 'MIDFIELD', instruction: 'Front prong tips to the outside prong, changing the point of contact.' },
  { call: 'TUNNEL_PASS', label: 'TUNNEL PASS', when: 2, risk: 0.26, reward: 0.7, zone: 'MIDFIELD', instruction: 'Ten plays it through the gap between the pod men to release the centres.' },
  { call: 'MISS_PASS', label: 'MISS PASS', when: 2, risk: 0.3, reward: 0.72, zone: 'MIDFIELD', instruction: 'Skip the ten, put the twelve into the hole outside him.' },
  { call: 'LOOPL_PASS', label: 'LOOP', when: 2, risk: 0.28, reward: 0.68, zone: 'MIDFIELD', instruction: 'Ten loops around the twelve, creating the extra man one wider.' },
  { call: 'SWITCH', label: 'SWITCH', when: 3, risk: 0.32, reward: 0.7, zone: 'WIDE', instruction: 'Cross behind the carrier, take the ball going the other way.' },
  { call: 'WIDE_SWEEP', label: 'WIDE SWEEP', when: 3, risk: 0.3, reward: 0.85, zone: 'WIDE', instruction: 'Move it three passes wide before the drift can slide.' },
  { call: 'BLIND_SIDE', label: 'BLIND SIDE', when: 2, risk: 0.24, reward: 0.62, zone: 'TIGHT', instruction: 'Snipe the short side where they have left two men.' },
  { call: 'BOX_KICK', label: 'BOX KICK', when: 2, risk: 0.22, reward: 0.4, zone: 'ANY', instruction: 'Nine boxes to touch, three chasers up.' },
  { call: 'TERRITORY_PUNT', label: 'TERRITORY PUNT', when: 1, risk: 0.16, reward: 0.5, zone: 'ANY', instruction: 'Ten turns it around, find touch inside their 22.' },
  { call: 'BOMB', label: 'UP AND UNDER', when: 2, risk: 0.34, reward: 0.62, zone: 'MIDFIELD', instruction: 'Hang it up, four chasers, isolate their fullback.' },
  { call: 'CROSS_FIELD', label: 'CROSS FIELD', when: 3, risk: 0.42, reward: 0.9, zone: 'WIDE', instruction: 'Kick across to the wing one on one with his man.' },
  { call: 'DROP_GOAL', label: 'DROP GOAL', when: 3, risk: 0.22, reward: 0.45, zone: 'TIGHT', instruction: 'Ten drops into the pocket, take the three.' },
];

/** Escalation ladder: what the CPU does when a play fails. */
export const ESCALATION: Record<PlayCall, PlayCall> = {
  POD_CARRY: 'POD_TIP',
  POD_TIP: 'TUNNEL_PASS',
  TUNNEL_PASS: 'WIDE_SWEEP',
  WIDE_SWEEP: 'CROSS_FIELD',
  MISS_PASS: 'WIDE_SWEEP',
  LOOPL_PASS: 'WIDE_SWEEP',
  SWITCH: 'WIDE_SWEEP',
  BLIND_SIDE: 'POD_CARRY',
  /* T-18. A failed kick falls back to the CARRY game — the chase regathers
   * (or concedes the field) and the pods go to work. The old ladder ran
   * punt → bomb → sweep → cross-field → punt…: four rungs of which three
   * were kicks, and because a kick that got run back was judged "shut
   * down", the whole match was an aerial exchange with no carrying. */
  BOX_KICK: 'POD_CARRY',
  TERRITORY_PUNT: 'POD_CARRY',
  BOMB: 'POD_CARRY',
  CROSS_FIELD: 'POD_CARRY',   // a broken wide move kicks the pressure away ONCE, then carries
  DROP_GOAL: 'DROP_GOAL',
  PICK_AND_GO: 'POD_CARRY',
};

/** Field position, in metres from the opponents' try line, drives the call. */
export function zoneOf(metresToLine: number): 'TIGHT' | 'MIDFIELD' | 'WIDE' {
  if (metresToLine < 22) return 'TIGHT';
  if (metresToLine < 55) return 'MIDFIELD';
  return 'WIDE';
}

/** Choose a call from the playbook for this situation. */
export function callPlay(
  zone: 'TIGHT' | 'MIDFIELD' | 'WIDE',
  phaseNumber: number,
  shape: AttackShape,
  arch: { kickBias: number; widthBias: number; offloadBias: number; riskTolerance: number },
  kickSlider: number,
  widthSlider: number,
  lastCall: PlayCall | null,
  lastCallSucceeded: boolean,
  clockUrgency: number,
): { call: PlayCall; plan: PhasePlan; why: string } {
  // Never repeat a play that just failed — escalate it.
  if (lastCall && !lastCallSucceeded) {
    const next = ESCALATION[lastCall];
    const plan = PLAYBOOK.find((p) => p.call === next)!;
    return { call: next, plan, why: `${plan.label} — ESCALATING AFTER ${lastCall} WAS SHUT DOWN` };
  }
  const cands = PLAYBOOK.filter((p) =>
    (p.zone === zone || p.zone === 'ANY') &&
    (zone === 'TIGHT' ? p.when <= phaseNumber + 1 : p.when <= phaseNumber + 1));
  let best: PhasePlan | null = null;
  let bestScore = -Infinity;
  let why = '';
  for (const p of cands) {
    let s = p.reward * 1.4 - p.risk * (1 - arch.riskTolerance) * 2.2;
    if (p.call === 'WIDE_SWEEP' || p.call === 'CROSS_FIELD') s += (widthSlider / 100) * 1.1 + arch.widthBias * 0.8;
    else s -= (widthSlider / 100) * 0.35;
    if (p.call === 'TERRITORY_PUNT' || p.call === 'BOMB' || p.call === 'BOX_KICK' || p.call === 'CROSS_FIELD') {
      s += (kickSlider / 100) * 1.3 + arch.kickBias * 0.9;
    } else s -= (kickSlider / 100) * 0.4;
    if (p.call === 'POD_TIP') s += shape.tipTendency * 1.4;
    if (p.call === 'TUNNEL_PASS') s += shape.tunnelTendency * 1.4;
    if (zone === 'TIGHT' && (p.call === 'DROP_GOAL' || p.call === 'PICK_AND_GO')) s += 1.1 + clockUrgency * 1.6;
    if (zone === 'WIDE' && (p.call === 'TERRITORY_PUNT' || p.call === 'BOMB')) s += 1.2;
    if (p.call === lastCall) s -= 1.5;
    if (s > bestScore) { bestScore = s; best = p; why = `${p.label} — ${p.instruction}`; }
  }
  const plan = best ?? PLAYBOOK[0];
  return { call: plan.call, plan, why };
}

/* ============================ RESTART SHAPE ============================
 * "Whereas 20 years ago receiving teams would traditionally position all of
 *  their forwards on one side of the pitch, modern sides set up in a rough
 *  1-3-3-1 as the kick goes up, to get into their attacking system early."
 */

export interface RestartSlot { num: number; lat: number; deep: number; job: string }

/** Receiving side: already in attacking shape, ten metres back, ready to run. */
export const RESTART_RECEIVE: RestartSlot[] = [
  { num: 9, lat: 0, deep: 11, job: 'TAKE THE SHORT KICK IF IT COMES' },
  { num: 10, lat: 6, deep: 13, job: 'FIRST RECEIVER — GET THE SHAPE GOING EARLY' },
  { num: 12, lat: 11, deep: 14, job: 'SECOND RECEIVER' },
  { num: 13, lat: 16, deep: 15, job: 'THIRD RECEIVER' },
  { num: 11, lat: -22, deep: 15, job: 'WIDE — WATCH FOR THE CROSS FIELD KICK' },
  { num: 14, lat: 22, deep: 15, job: 'WIDE — WATCH FOR THE CROSS FIELD KICK' },
  { num: 15, lat: 8, deep: 22, job: 'FIELD THE HIGH BALL — CALL FOR IT LOUD' },
  { num: 1, lat: -8, deep: 12, job: 'POD ONE' },
  { num: 2, lat: -5, deep: 11, job: 'POD ONE' },
  { num: 3, lat: -2, deep: 11, job: 'POD ONE' },
  { num: 4, lat: 3, deep: 11, job: 'POD TWO' },
  { num: 5, lat: 5, deep: 11, job: 'POD TWO' },
  { num: 6, lat: -14, deep: 13, job: 'WIDE POD' },
  { num: 7, lat: 13, deep: 12, job: 'CHASE BREAKDOWN SUPPORT' },
  { num: 8, lat: 9, deep: 12, job: 'POD TWO — CARRY OPTION' },
];

/** Kicking side: behind the ball, then chase hard in named lanes. */
export const RESTART_KICK: RestartSlot[] = [
  { num: 10, lat: 0, deep: -1.5, job: 'STRIKE IT LONG, THEN CHASE' },
  { num: 9, lat: -4, deep: -3, job: 'FOLLOW THE KICK, COVER THE SHORT BALL' },
  { num: 7, lat: 4, deep: -4, job: 'CHASE LANE ONE — THE MIDDLE' },
  { num: 6, lat: -6, deep: -4, job: 'CHASE LANE TWO — THE BLIND' },
  { num: 8, lat: 7, deep: -4, job: 'CHASE LANE THREE — THE OPEN SIDE' },
  { num: 2, lat: 0, deep: -6, job: 'SECOND WAVE CHASE' },
  { num: 4, lat: -9, deep: -6, job: 'SECOND WAVE — CONTEST IN THE AIR' },
  { num: 5, lat: 9, deep: -6, job: 'SECOND WAVE — CONTEST IN THE AIR' },
  { num: 1, lat: -12, deep: -7, job: 'CHASE WIDE, SQUEEZE THE RECEIVER' },
  { num: 3, lat: 12, deep: -7, job: 'CHASE WIDE, SQUEEZE THE RECEIVER' },
  { num: 11, lat: -18, deep: -10, job: 'COVER THE BLIND IN-GOAL' },
  { num: 14, lat: 18, deep: -10, job: 'COVER THE OPEN IN-GOAL' },
  { num: 12, lat: -2, deep: -8, job: 'THIRD WAVE' },
  { num: 13, lat: 2, deep: -8, job: 'THIRD WAVE' },
  { num: 15, lat: 0, deep: -18, job: 'SWEEP — COVER THE KICK BEHIND THE CHASE' },
];

/* ============================ KICK CHASE LANES ============================ */

export const CHASE_LANES = [
  { label: 'LANE ONE — STRAIGHT TO THE BALL, CONTEST IT', lat: 0 },
  { label: 'LANE TWO — OPEN SIDE, SQUEEZE THE RECEIVER', lat: 7 },
  { label: 'LANE THREE — BLIND SIDE, COVER THE IN-GOAL', lat: -7 },
];

export const CHASE_ORDER = [7, 6, 8, 2, 4, 5, 14, 11, 13, 12, 9, 15, 1, 3, 10];

/* ============================ CAMERA PLAN ============================
 * From a real rugby union outside-broadcast camera plan:
 *   Camera 1  Main Wide, main gantry (22:1)
 *   Camera 2  Main Tight, main gantry (86:1)
 *   Camera 3  Main Close-Up, near halfway line — follows the ball carrier
 *   Camera 12 High Behind (22:1)
 *   Cameras 7-10 corner, 5/6/11 handheld at the touchline
 *
 * The main gantry sits on the touchline, elevated, tracking laterally with a
 * long lens. That is what a rugby match looks like on television.
 */

export interface CameraShot {
  id: string;
  name: string;
  /** metres back from the near touchline */
  standback: number;
  /** metres above the turf */
  height: number;
  /** pixels per metre at the subject — the zoom */
  pxPerMetre: number;
  /** metres of lead in the direction of attack */
  lead: number;
  /** how far ahead of the ball the frame must extend, in metres */
  lookAhead: number;
  /** dead zone before the rig tracks laterally */
  deadZone: number;
  /** seconds to ease into this shot */
  ease: number;
  note: string;
}

export const CAMERA_PLAN: CameraShot[] = [
  { id: 'GANTRY_WIDE', name: 'MAIN GANTRY — WIDE', standback: 34, height: 21, pxPerMetre: 8.4, lead: 6.5, lookAhead: 26, deadZone: 2.6, ease: 1.1, note: 'Camera 1. Open play. Frames the ball, the first three attackers and the defensive line.' },
  { id: 'GANTRY_TIGHT', name: 'MAIN GANTRY — TIGHT', standback: 28, height: 15, pxPerMetre: 12.2, lead: 2.4, lookAhead: 14, deadZone: 1.4, ease: 0.75, note: 'Camera 2. Breakdown and contact, tight on the contest.' },
  { id: 'SET_PIECE', name: 'SET PIECE', standback: 26, height: 11, pxPerMetre: 13.0, lead: 0, lookAhead: 10, deadZone: 0.6, ease: 0.6, note: 'Scrum and lineout. Low and close so the bind and the lift read.' },
  { id: 'AT_GOAL', name: 'HIGH BEHIND — GOAL', standback: 0, height: 17, pxPerMetre: 10.5, lead: 0, lookAhead: 8, deadZone: 0.4, ease: 0.5, note: 'Camera 12. Square behind the kicker for a shot at goal.' },
  { id: 'RESTART', name: 'RESTART — WIDE', standback: 40, height: 25, pxPerMetre: 7.0, lead: 8, lookAhead: 34, deadZone: 3.0, ease: 1.4, note: 'Kick-off. Widest shot in the game, both teams in frame.' },
  { id: 'CHASE', name: 'CHASE', standback: 36, height: 23, pxPerMetre: 8.8, lead: 4, lookAhead: 30, deadZone: 2.0, ease: 1.0, note: 'Kick in flight. Frames the predicted landing point and the chasers converging on it.' },
  { id: 'BREAKAWAY', name: 'BREAKAWAY', standback: 30, height: 18, pxPerMetre: 10.0, lead: 10, lookAhead: 40, deadZone: 3.4, ease: 0.8, note: 'A line break. Extra lead and look-ahead so the runner is never outrun by the frame.' },
];

export const shotFor = (id: string) => CAMERA_PLAN.find((s) => s.id === id) ?? CAMERA_PLAN[0];

/** Which shot the director should be on for a given match state. */
export function shotIdFor(phase: string, kkStage: string | undefined, lineBreak: boolean): string {
  if (lineBreak) return 'BREAKAWAY';
  if (phase === 'KICK' || phase === 'KICK_REPLAY') {
    if (kkStage === 'AIM' || kkStage === 'METER') return 'AT_GOAL';
    if (kkStage === 'FLIGHT') return 'CHASE';
    return 'RESTART';
  }
  if (phase === 'SCRUM' || phase === 'LINEOUT') return 'SET_PIECE';
  if (phase === 'BREAKDOWN' || phase === 'MAUL') return 'GANTRY_TIGHT';
  return 'GANTRY_WIDE';
}

export const SHAPE_POINT_COUNT =
  ATTACK_SHAPES.reduce((n, s) => n + s.slots.length * 4 + s.groups.length * 3 + 7, 0) +
  DEFENCE_SYSTEMS.length * 9 +
  PLAYBOOK.length * 7 +
  (RESTART_RECEIVE.length + RESTART_KICK.length) * 4 +
  CAMERA_PLAN.length * 9;
