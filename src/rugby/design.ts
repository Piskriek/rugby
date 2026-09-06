/**
 * DESIGN THESIS — encoded for the 2026 engine.
 *
 * The design doc (src/game/jlr.ts) is the spec this engine implements. It is
 * kept as pure data here so the engine stays self-contained and lean: the
 * attribute model, the 15 shirt-by-shirt role contracts, the named set plays
 * with risk/reward, the signature-player traits, and the two-hander
 * McLaren/Beaumont commentary pairs.
 *
 * "True to the rules, but easy to pick up and play without a complete
 * understanding of all rugby's ins and outs." — Trevor Williams, Rage, 1997.
 */

/* ============================ 1. THE ATTRIBUTE MODEL ============================
 * Lomu shipped three primary attributes. We keep those three and add the four
 * modern players ask for. Each maps to exactly one verb the player performs.
 */

export const ATTRIBUTE_MODEL: { key: string; label: string; drives: string; note: string }[] = [
  { key: 'SPD', label: 'SPEED', drives: 'Acceleration, top speed and evasion chance', note: 'Lomu separates acceleration from top speed; a wing gets there, a prop does not.' },
  { key: 'PWR', label: 'STRENGTH', drives: 'Tackle success, fend success, yardage in contact', note: 'Lomu: strength governs tackling AND fending, so it is never a dead stat.' },
  { key: 'SKL', label: 'HANDLING', drives: 'Pass accuracy and ball control under pressure', note: 'Lomu: handling is the wet-weather stat and the offload stat.' },
  { key: 'AGG', label: 'AGGRESSION', drives: 'Line speed, jackal window, collision dominance', note: 'Raises ceiling and penalty risk together. Never free.' },
  { key: 'AWA', label: 'AWARENESS', drives: 'Off-ball positioning, support arrival, intercept read', note: 'The single biggest fix for "props at flyhalf".' },
  { key: 'STA', label: 'STAMINA', drives: 'Time before pace and tackle willingness decay', note: 'Forwards burn it at four times the rate of wings.' },
  { key: 'FTG', label: 'FATIGUE', drives: 'Live per-player meter shown in the HUD', note: 'A visible number, not a hidden multiplier.' },
];

/* ============================ 2. SIGNATURE TRAITS ============================
 * Lomu shipped an amplified player. We make that a rule, not an accident.
 */

export type Trait = 'RAMPAGE' | 'STEP_KING' | 'METRONOME' | 'THIEF' | 'GENERAL';

export const TRAITS: { trait: Trait; name: string; rule: string }[] = [
  { trait: 'RAMPAGE', name: 'RAMPAGE', rule: 'Tackle-break chance compounds rather than resets when hit twice.' },
  { trait: 'STEP_KING', name: 'STEP KING', rule: 'Sidestep window widens by 40 percent for the player only.' },
  { trait: 'METRONOME', name: 'METRONOME', rule: 'Goal accuracy never falls below 78 percent regardless of angle.' },
  { trait: 'THIEF', name: 'THIEF', rule: 'Jackal window doubles; never penalised for a legal steal.' },
  { trait: 'GENERAL', name: 'GENERAL', rule: 'Nearby teammates gain eight awareness while he is on the field.' },
];

/* ============================ 3. ROLE CONTRACTS ============================
 * The fix for "props at flyhalf" and "pointless having a backline as the
 * forwards plays flyhalf". Fifteen shirts, each with a written contract for
 * each phase: metres from the ball along the lateral axis (openside positive,
 * blindside negative) and metres behind the gain line.
 */

export type RugbyPhase = 'OPEN' | 'RUCK' | 'MAUL' | 'DEFENCE' | 'KICK_CHASE' | 'KICK_RECEIVE';

export interface RoleContract {
  num: number;
  pos: string;
  lateral: Partial<Record<RugbyPhase, number>>;
  depth: Partial<Record<RugbyPhase, number>>;
  job: string;   // what this shirt does in open play (thesis register)
  never: string; // what this shirt must never do
}

export const ROLE_CONTRACTS: RoleContract[] = [
  { num: 1, pos: 'LOOSEHEAD PROP', lateral: { RUCK: -1.2, MAUL: -1.2, OPEN: -2.0, DEFENCE: -3.0, KICK_CHASE: -6.0, KICK_RECEIVE: -8.0 }, depth: { RUCK: 1.2, MAUL: 0, OPEN: 4.0, DEFENCE: 2.5, KICK_CHASE: 3.0, KICK_RECEIVE: 12.0 }, job: 'Pod carrier option one. Never wider than the third channel.', never: 'Never in the backline. Never outside the 10 channel.' },
  { num: 2, pos: 'HOOKER', lateral: { RUCK: 0, MAUL: 0, OPEN: -1.0, DEFENCE: -1.0, KICK_CHASE: -2.0, KICK_RECEIVE: -6.0 }, depth: { RUCK: 1.6, MAUL: 0, OPEN: 5.0, DEFENCE: 3.0, KICK_CHASE: 2.0, KICK_RECEIVE: 13.0 }, job: 'Dummy-runner at the ruck. Fixes the A defender.', never: 'Never plays first receiver. Never in the backline.' },
  { num: 3, pos: 'TIGHTHEAD PROP', lateral: { RUCK: 1.2, MAUL: 1.2, OPEN: 2.0, DEFENCE: 3.0, KICK_CHASE: 6.0, KICK_RECEIVE: 8.0 }, depth: { RUCK: 1.2, MAUL: 0, OPEN: 4.0, DEFENCE: 2.5, KICK_CHASE: 3.0, KICK_RECEIVE: 12.0 }, job: 'Pod option two.', never: 'Never in the backline. Never wider than the 13 channel.' },
  { num: 4, pos: 'SECOND ROW', lateral: { RUCK: -0.6, MAUL: -0.7, OPEN: -3.0, DEFENCE: -5.0, KICK_CHASE: -3.0, KICK_RECEIVE: -5.0 }, depth: { RUCK: 2.2, MAUL: 0.6, OPEN: 5.5, DEFENCE: 4.0, KICK_CHASE: 2.5, KICK_RECEIVE: 13.5 }, job: 'Pod carrier. Crash ball when the call is on.', never: 'Never marks a centre. Never wider than the 12 channel.' },
  { num: 5, pos: 'SECOND ROW', lateral: { RUCK: 0.6, MAUL: 0.7, OPEN: 3.0, DEFENCE: 5.0, KICK_CHASE: 3.0, KICK_RECEIVE: 5.0 }, depth: { RUCK: 2.2, MAUL: 0.6, OPEN: 5.5, DEFENCE: 4.0, KICK_CHASE: 2.5, KICK_RECEIVE: 13.5 }, job: 'Pod carrier.', never: 'Never marks a centre.' },
  { num: 6, pos: 'BLINDSIDE FLANKER', lateral: { RUCK: -4.5, MAUL: -2.0, OPEN: -6.0, DEFENCE: -8.0, KICK_CHASE: -9.0, KICK_RECEIVE: -10.0 }, depth: { RUCK: 2.0, MAUL: 1.0, OPEN: 5.0, DEFENCE: 3.0, KICK_CHASE: 3.5, KICK_RECEIVE: 14.0 }, job: 'Blindside runner off the scrum or ruck.', never: 'Never leaves the blindside unguarded.' },
  { num: 7, pos: 'OPENSIDE FLANKER', lateral: { RUCK: 2.5, MAUL: 2.0, OPEN: 4.0, DEFENCE: 6.5, KICK_CHASE: 1.0, KICK_RECEIVE: 2.0 }, depth: { RUCK: 1.4, MAUL: 1.0, OPEN: 4.5, DEFENCE: 2.0, KICK_CHASE: 1.5, KICK_RECEIVE: 11.0 }, job: 'Supports the carrier at the hip, ready for the offload.', never: 'Never marks the fly half. Never in the attacking backline.' },
  { num: 8, pos: 'NUMBER EIGHT', lateral: { RUCK: 1.8, MAUL: 1.5, OPEN: 2.5, DEFENCE: 4.5, KICK_CHASE: 2.0, KICK_RECEIVE: 3.0 }, depth: { RUCK: 2.6, MAUL: 1.2, OPEN: 5.5, DEFENCE: 3.5, KICK_CHASE: 2.0, KICK_RECEIVE: 12.0 }, job: 'Primary pod carrier. Takes the ball at pace.', never: 'Never stands wider than the 10 channel.' },
  { num: 9, pos: 'SCRUM HALF', lateral: { RUCK: 1.0, MAUL: 1.6, OPEN: 1.2, DEFENCE: -1.0, KICK_CHASE: 0.5, KICK_RECEIVE: 1.0 }, depth: { RUCK: 2.0, MAUL: 2.2, OPEN: 3.5, DEFENCE: 1.0, KICK_CHASE: 1.0, KICK_RECEIVE: 9.0 }, job: 'Distributes, then snipes only when the fringe is empty.', never: 'Never gets trapped in the ruck. Never tackles wide.' },
  { num: 10, pos: 'FLY HALF', lateral: { RUCK: 7.0, MAUL: 7.5, OPEN: 8.0, DEFENCE: 8.5, KICK_CHASE: 8.0, KICK_RECEIVE: 8.0 }, depth: { RUCK: 6.0, MAUL: 6.5, OPEN: 7.0, DEFENCE: 3.0, KICK_CHASE: 6.0, KICK_RECEIVE: 10.0 }, job: 'Runs the shape. Decides kick, pass or carry.', never: 'Never at the bottom of a ruck. Never carries into the forwards.' },
  { num: 11, pos: 'LEFT WING', lateral: { RUCK: -14.0, MAUL: -14.5, OPEN: -16.0, DEFENCE: -15.0, KICK_CHASE: -13.0, KICK_RECEIVE: -18.0 }, depth: { RUCK: 8.0, MAUL: 9.0, OPEN: 9.0, DEFENCE: 6.0, KICK_CHASE: 4.0, KICK_RECEIVE: 16.0 }, job: 'Finishes. Stays out. Takes the man on outside.', never: 'Never comes into a ruck. Ever.' },
  { num: 12, pos: 'INSIDE CENTRE', lateral: { RUCK: 10.0, MAUL: 10.5, OPEN: 11.0, DEFENCE: 11.0, KICK_CHASE: 10.0, KICK_RECEIVE: 11.0 }, depth: { RUCK: 6.5, MAUL: 7.0, OPEN: 7.5, DEFENCE: 3.0, KICK_CHASE: 5.0, KICK_RECEIVE: 11.0 }, job: 'Crash or pass. The decision-maker under pressure.', never: 'Never clears a ruck. Never first receiver.' },
  { num: 13, pos: 'OUTSIDE CENTRE', lateral: { RUCK: 13.0, MAUL: 13.5, OPEN: 14.5, DEFENCE: 14.0, KICK_CHASE: 12.0, KICK_RECEIVE: 14.0 }, depth: { RUCK: 7.0, MAUL: 7.5, OPEN: 8.0, DEFENCE: 3.5, KICK_CHASE: 5.0, KICK_RECEIVE: 12.0 }, job: 'Runs the outside break or the switch.', never: 'Never clears a ruck.' },
  { num: 14, pos: 'RIGHT WING', lateral: { RUCK: 17.0, MAUL: 17.5, OPEN: 19.0, DEFENCE: 17.0, KICK_CHASE: 16.0, KICK_RECEIVE: 20.0 }, depth: { RUCK: 8.0, MAUL: 8.5, OPEN: 9.0, DEFENCE: 6.0, KICK_CHASE: 4.0, KICK_RECEIVE: 17.0 }, job: 'Finishes. Stays out. The last pass goes to him.', never: 'Never comes into a ruck.' },
  { num: 15, pos: 'FULLBACK', lateral: { RUCK: 11.0, MAUL: 12.0, OPEN: 12.0, DEFENCE: 12.0, KICK_CHASE: 11.0, KICK_RECEIVE: 12.0 }, depth: { RUCK: 12.0, MAUL: 13.0, OPEN: 14.0, DEFENCE: 13.0, KICK_CHASE: 8.0, KICK_RECEIVE: 18.0 }, job: 'Counter-attacks or joins as the extra man when the overlap is on.', never: 'Never rucks. Never marks a man. He is the insurance policy.' },
];

export const contractFor = (num: number): RoleContract => ROLE_CONTRACTS.find((r) => r.num === num)!;

/* ============================ 4. SET PLAYS ============================
 * "No set plays, even games from the 90s had these." — Rugby 25 player, 2025.
 * Each play is a named call with a risk/reward and a concrete shape the
 * engine can steer: a bias for the ball-carrier and per-runner offsets
 * (metres upfield, metres across the openside).
 */

export type PlayBias = 'CARRY' | 'PASS' | 'KICK_CROSS' | 'KICK_DROP' | 'MAUL';

export interface SetPlay {
  id: string;
  name: string;
  from: 'RUCK' | 'SCRUM' | 'LINEOUT';
  call: string;
  intent: string;
  risk: number;
  reward: number;
  bias: PlayBias;
  /** runners: shirt number → offset (dx upfield, dy across openside) */
  runners: { num: number; dx: number; dy: number }[];
}

export const SET_PLAYS: SetPlay[] = [
  { id: 'SP-POD', name: 'POD CRASH', from: 'RUCK', call: 'ONE', intent: 'Hold the ball one out, take contact on your terms, recycle fast.', risk: 0.1, reward: 0.35, bias: 'CARRY', runners: [
    { num: 8, dx: 1, dy: 4 }, { num: 2, dx: 1.2, dy: 0 }, { num: 7, dx: 1.4, dy: 6 }, { num: 9, dx: 2, dy: 1 }, { num: 10, dx: 5, dy: 8 },
  ] },
  { id: 'SP-WIDE', name: 'WIDE SWEEP', from: 'RUCK', call: 'WIDE', intent: 'Move the ball three passes wide before the defence can slide.', risk: 0.3, reward: 0.8, bias: 'PASS', runners: [
    { num: 9, dx: 1.5, dy: 1 }, { num: 10, dx: 4, dy: 8 }, { num: 12, dx: 5, dy: 11 }, { num: 13, dx: 5.5, dy: 14.5 }, { num: 14, dx: 6, dy: 19 }, { num: 11, dx: 7, dy: -16 },
  ] },
  { id: 'SP-BLIND', name: 'BLIND SIDESTEP', from: 'RUCK', call: 'BLIND', intent: 'Attack the short side where they have left two men.', risk: 0.25, reward: 0.65, bias: 'PASS', runners: [
    { num: 9, dx: 1.5, dy: -1 }, { num: 6, dx: 2, dy: -6 }, { num: 11, dx: 3, dy: -10 }, { num: 7, dx: 1.5, dy: 4 },
  ] },
  { id: 'SP-MISS', name: 'MISS AND HIT', from: 'RUCK', call: 'MISS', intent: 'Skip the ten, put the twelve into the hole outside him.', risk: 0.35, reward: 0.75, bias: 'PASS', runners: [
    { num: 9, dx: 1.5, dy: 1 }, { num: 10, dx: 4, dy: 8 }, { num: 12, dx: 4.5, dy: 13 }, { num: 13, dx: 5, dy: 16 },
  ] },
  { id: 'SP-CROSS', name: 'CROSS KICK', from: 'RUCK', call: 'CROSS', intent: 'Kick across the field to the isolated wing.', risk: 0.45, reward: 0.9, bias: 'KICK_CROSS', runners: [
    { num: 10, dx: 3, dy: 8 }, { num: 11, dx: 14, dy: -24 }, { num: 15, dx: 6, dy: 0 }, { num: 14, dx: 6, dy: 19 },
  ] },
  { id: 'SP-DROP', name: 'FIELD POSITION, DROP', from: 'RUCK', call: 'DG', intent: 'Take the three while the defence is set.', risk: 0.2, reward: 0.4, bias: 'KICK_DROP', runners: [
    { num: 8, dx: 1, dy: 2 }, { num: 9, dx: 1.5, dy: 1 }, { num: 10, dx: 9, dy: 0 }, { num: 15, dx: 4, dy: 0 },
  ] },
  { id: 'SP-8-9', name: 'EIGHT-NINE OFF THE SCRUM', from: 'SCRUM', call: 'EIGHT', intent: 'Number eight controls at the base, nine attacks the fringe.', risk: 0.2, reward: 0.55, bias: 'CARRY', runners: [
    { num: 8, dx: 1, dy: 2 }, { num: 9, dx: 1.5, dy: 4 }, { num: 10, dx: 5, dy: 8 },
  ] },
  { id: 'SP-SC-WIDE', name: 'SCRUM WIDE MOVE', from: 'SCRUM', call: 'WIDE', intent: 'Move the ball away from the pack before their backrow arrives.', risk: 0.3, reward: 0.7, bias: 'PASS', runners: [
    { num: 9, dx: 1.5, dy: 1 }, { num: 10, dx: 4, dy: 8 }, { num: 13, dx: 5, dy: 14.5 }, { num: 14, dx: 6, dy: 19 },
  ] },
  { id: 'SP-LO-DRIVE', name: 'CATCH AND DRIVE', from: 'LINEOUT', call: 'DRIVE', intent: 'Maul from the catch, drive for the line.', risk: 0.15, reward: 0.5, bias: 'MAUL', runners: [
    { num: 4, dx: 0.5, dy: 0 }, { num: 2, dx: 0.4, dy: 0 }, { num: 8, dx: 0.6, dy: 2 },
  ] },
  { id: 'SP-LO-TOP', name: 'OFF THE TOP', from: 'LINEOUT', call: 'TOP', intent: 'Ball to the ten before the defence sets.', risk: 0.25, reward: 0.7, bias: 'PASS', runners: [
    { num: 4, dx: 0.5, dy: 0 }, { num: 9, dx: 1.5, dy: 1 }, { num: 10, dx: 4, dy: 8 }, { num: 12, dx: 5, dy: 11 },
  ] },
];

/* ============================ 5. COMMENTARY (two-hander) ============================
 * Bill McLaren and Bill Beaumont, in character, talking over each other.
 * Every line is a two-hander because that is why it worked.
 */

export const COMMENTARY_PAIRS: { key: string; lines: [string, string][] }[] = [
  {
    key: 'BIG_HIT',
    lines: [
      ['My goodness, that tackle could have put him in ward four.', 'I hope not, that is the maternity ward.'],
      ['He digs like a demented mole there!', 'And comes up with it too.'],
      ['That is a tackle worthy of the occasion.', 'The crowd loved that one, and so did I.'],
      ['Oh, that is a monstrous hit!', 'He will feel that in the morning.'],
      ['Flat on his back, and the ball spilled.', 'Superb defence, absolutely superb.'],
    ],
  },
  {
    key: 'LINE_BREAK',
    lines: [
      ['He is through! Nobody at home!', 'This is going to be a try, and we both know it.'],
      ['He has gone past three there like they were training cones.', 'Quite magnificent footwork.'],
      ['The line parts like the Red Sea!', 'And he is not going to be caught.'],
      ['That is a wonderful line break.', 'The cover is scrambling, but it is far too late.'],
    ],
  },
  {
    key: 'TRY',
    lines: [
      ['TRY! And the stand is on its feet.', 'A finish of the highest class.'],
      ['He grounds it, and the party starts here.', 'Five points, and no more than they deserved.'],
      ['That is a try out of nothing.', 'A moment of pure instinct.'],
      ['He dives in at the corner, quite superb.', 'He knew exactly where the line was.'],
      ['The extra man was always going to score.', 'Beautifully worked from the breakdown.'],
    ],
  },
  {
    key: 'KICK',
    lines: [
      ['That is a magnificent strike.', 'Straight between the posts, no fuss.'],
      ['Off the upright!', 'Agonisingly close.'],
      ['The wind takes that one away.', 'He struck it well enough, but the conditions beat him.'],
      ['He has the distance, but not the direction.', 'A cruel game this.'],
      ['From that range, that is a serious kick.', 'Ice in the veins.'],
    ],
  },
  {
    key: 'SCRUM',
    lines: [
      ['The packs come together.', 'This is where the big men earn their corn.'],
      ['A mighty shove there.', 'The whole scrum is going backwards.'],
      ['It is down! The referee has seen enough.', 'Somebody pulled that one down.'],
      ['Wheeled through ninety, and the put-in changes hands.', 'Clever work from the tight five.'],
    ],
  },
  {
    key: 'LINEOUT',
    lines: [
      ['Up he goes, and he takes it cleanly.', 'A beautiful throw, that.'],
      ['Stolen! The throw was a gift.', 'You cannot give good sides chances like that.'],
      ['Not in straight, and the referee is on it.', 'The hooker will be disappointed with that.'],
      ['The drive is on.', 'They have the bit between their teeth here.'],
    ],
  },
  {
    key: 'TURNOVER',
    lines: [
      ['Turned over! That is outstanding work.', 'He has pinched that right under their noses.'],
      ['The ball is won against the head.', 'The whole complexion of the game changes there.'],
      ['A penalty, and he will be delighted with that.', 'He was killing that ball all day.'],
    ],
  },
  {
    key: 'MISSED',
    lines: [
      ['He is over! No — the tackle took him into touch.', 'Inches. Literal inches.'],
      ['He loses it forward with the line begging.', 'That is a shocking finish.'],
      ['The pass goes to nobody at all.', 'Somebody has to be there.'],
      ['Held up over the line!', 'Superb defence, and the scrum five it is.'],
    ],
  },
  {
    key: 'GENERAL',
    lines: [
      ['Hard yards here, nothing doing.', 'This is a proper arm wrestle.'],
      ['Phase ball, and the defence is set.', 'They need to change something.'],
      ['The kick is away and the chase is on.', 'That is a fine chase, that.'],
      ['They are playing the territory game here.', 'Not pretty, but it is effective.'],
      ['The crowd are right behind them now.', 'What an atmosphere in this stadium.'],
      ['He is limping, but he is staying on.', 'Brave, very brave.'],
    ],
  },
  {
    key: 'BUILDUP',
    lines: [
      ['Phase after phase, and the defence is not folding.', 'Something has to give here.'],
      ['They are building patiently, metre by metre.', 'This is pressure, real pressure.'],
      ['The pack keeps coming around the corner.', 'Sooner or later that door comes off its hinges.'],
      ['The forwards are knocking and knocking.', 'They are earning every inch of that ground.'],
      ['The defence is stretched along its own line.', 'One more phase and the crack appears.'],
    ],
  },
  {
    key: 'TRY_BUILT',
    lines: [
      ['TRY! And the pressure finally tells.', 'They earned that the hard way, phase after phase.'],
      ['Over they go, and it was coming.', 'The dam could only hold for so long.'],
      ['TRY! The build-up deserved that finish.', 'Patience, and then the dagger.'],
      ['He finishes what the pack started.', 'Eight phases of work, and the try is the receipt.'],
    ],
  },
];

/** pick a two-line pair for a moment, seeded by an RNG. */
export function commentaryPair(key: string, roll: number): [string, string] {
  const bank = COMMENTARY_PAIRS.find((p) => p.key === key) ?? COMMENTARY_PAIRS[COMMENTARY_PAIRS.length - 1];
  const lines = bank.lines;
  return lines[Math.floor(roll * lines.length) % lines.length];
}
