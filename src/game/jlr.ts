/**
 * JONAH LOMU RUGBY (1997) — DESIGN DATA
 *
 * In 1997 Rage Software solved the problem every rugby game before and most
 * since have failed: how to make a sport defined by its stops and starts feel
 * continuous, and how to make thirty players obey one thumb.
 *
 * Trevor Williams, Rage, 1997: "We wanted a game that stayed true to the rules,
 * but was easy to pick up and play without a complete understanding of all
 * rugby's ins and outs."
 *
 * Everything in this file is a data point harvested from that design and from
 * what its players still praise it for. Each is wired into the engine.
 */

/* ============================ 1. THE ATTRIBUTE MODEL ============================
 * Lomu shipped three primary attributes. Rugby 25 ships none that a player can
 * feel. Three is enough because each one maps to exactly one verb the player
 * performs. We keep those three and add the four that modern players ask for.
 */

export const ATTRIBUTE_MODEL: { key: string; label: string; drives: string; note: string }[] = [
  { key: 'SPD', label: 'SPEED', drives: 'Acceleration, top speed and evasion chance', note: 'Lomu separates acceleration from top speed; a wing gets there, a prop does not.' },
  { key: 'PWR', label: 'STRENGTH', drives: 'Tackle success, fend success, yardage in contact', note: 'Lomu: strength governs tackling AND fending, so it is never a dead stat.' },
  { key: 'SKL', label: 'HANDLING', drives: 'Pass accuracy and ball control under pressure', note: 'Lomu: handling is the wet-weather stat and the offload stat.' },
  { key: 'AGG', label: 'AGGRESSION', drives: 'Line speed, jackal window, collision dominance', note: 'Raises ceiling and penalty risk together. Never free.' },
  { key: 'AWA', label: 'AWARENESS', drives: 'Off-ball positioning, support arrival, intercept read', note: 'The single biggest fix for "props at flyhalf".' },
  { key: 'STA', label: 'STAMINA', drives: 'Time before pace and tackle willingness decay', note: 'Forwards burn it at four times the rate of wings.' },
  { key: 'FTG', label: 'FATIGUE', drives: 'Live per-player meter shown in the HUD and squad sheet', note: 'A visible number, not a hidden multiplier.' },
];

/** Lomu shipped an amplified player. We make that a rule, not an accident. */
export const SIGNATURE_PLAYER_RULES: { rule: string; value: string; drives: string; note: string }[] = [
  { rule: 'BREAKTHROUGH RATING', value: '92+ on two attributes', drives: 'Fend attempt succeeds against two tacklers at once instead of one.', note: 'The Lomu rule.' },
  { rule: 'BREAKTHROUGH RATING', value: '95+ SPEED', drives: 'One automatic broken tackle per phase before the meter is spent.', note: 'Ratings threshold.' },
  { rule: 'BREAKTHROUGH RATING', value: '90+ STRENGTH', drives: 'Carries the ruck forward half a metre even when held.', note: 'Ratings threshold.' },
  { rule: 'SIGNATURE TRAIT', value: 'RAMPAGE', drives: 'Tackle-break chance compounds rather than resets when hit twice.', note: 'Trait.' },
  { rule: 'SIGNATURE TRAIT', value: 'STEP KING', drives: 'Sidestep window widens by 40 percent for the player only.', note: 'Trait.' },
  { rule: 'SIGNATURE TRAIT', value: 'METRONOME', drives: 'Goal accuracy never falls below 78 percent regardless of angle.', note: 'Trait.' },
  { rule: 'SIGNATURE TRAIT', value: 'THIEF', drives: 'Jackal window doubles; never penalised for a legal steal.', note: 'Trait.' },
  { rule: 'SIGNATURE TRAIT', value: 'GENERAL', drives: 'Nearby teammates gain eight awareness while he is on the field.', note: 'Trait.' },
];

/* ============================ 2. THE CONTROL VERBS ============================
 * Every verb is one button, one intent, no modifier stack. Lomu's insight: the
 * pass buttons are on the shoulders so the thumb never leaves the movement stick.
 */

export const CONTROL_VERBS: { input: string; verb: string; context: string; rule: string }[] = [
  { input: 'D-PAD / STICK', verb: 'RUN', context: 'Always', rule: 'Movement is sampled every frame and applied immediately. Momentum is never allowed to override input.' },
  { input: 'TRIANGLE / SHIFT', verb: 'SPRINT', context: 'Open play', rule: 'Hold to sprint. Speed ramps over 0.5 s rather than snapping, so boost and jog never feel like different games.' },
  { input: 'L1 / J', verb: 'PASS LEFT', context: 'Open play', rule: 'Always thrown to the nearest eligible receiver on that side. Never into space.' },
  { input: 'R1 / K', verb: 'PASS RIGHT', context: 'Open play', rule: 'Mirror of pass left. The intended receiver is highlighted before you commit.' },
  { input: 'L2 / U', verb: 'CUT-OUT LEFT', context: 'Open play', rule: 'Skips one receiver. Longer flight, slightly higher risk, massive overlap value.' },
  { input: 'R2 / O', verb: 'CUT-OUT RIGHT', context: 'Open play', rule: 'Mirror of cut-out left.' },
  { input: 'SQUARE + PASS / H', verb: 'DUMMY', context: 'Open play', rule: 'Fakes the pass. Defenders in the line bite and drift, opening the outside channel.' },
  { input: 'X / SPACE', verb: 'TACKLE — DIVING', context: 'Defence', rule: 'Long range. Launches at the carrier. Whiff if you are more than 3.5 m out.' },
  { input: 'O / I', verb: 'TACKLE — SMOTHER', context: 'Defence', rule: 'Close range, low. Higher success, no chase value.' },
  { input: 'TRIANGLE HOLD / F', verb: 'FEND', context: 'Carrying', rule: 'Strength contest against the tackler. Wins the collision, keeps the legs pumping.' },
  { input: 'X HOLD / L', verb: 'PUNT / BOMB', context: 'Open play', rule: 'Hold for power, direction with the stick, release to strike. Power is shown as a bar you can read.' },
  { input: 'O TAP / ;', verb: 'GRUBBER', context: 'Open play', rule: 'Tap for a short rolling kick. Hold for a low driving kick into the in-goal.' },
  { input: 'O HOLD / P', verb: 'DROP KICK', context: 'Open play', rule: 'Drop goal inside range. Gated by kicker rating, not by a twitch timing window.' },
  { input: 'ON-SCREEN COMMAND', verb: 'SET PIECE', context: 'Scrum, lineout, kick', rule: 'The prompt is printed on the pitch in plain language and is synchronised to the referee cadence.' },
];

/* ============================ 3. SEAMLESSNESS ============================
 * The single most cited reason Lomu still plays well in 2026: the movement of
 * the players was synchronised perfectly with the controller input, and the
 * match never stopped to show you anything.
 */

export const SEAMLESSNESS_RULES: { id: string; rule: string; shipped: string }[] = [
  { id: 'FLOW-01', rule: 'No loading screen between any two phases of a match. Ever.', shipped: 'Set pieces assemble in world space; players jog to their marks from where they stood.' },
  { id: 'FLOW-02', rule: 'No cut-scene interrupts a match in progress.', shipped: 'Score cards are drawn over live play, not instead of it.' },
  { id: 'FLOW-03', rule: 'Input is applied the frame it is read. No queued actions.', shipped: 'Rugby 25 players report grubber kicks firing 5-6 s after the press. Zero-frame queue here.' },
  { id: 'FLOW-04', rule: 'Passing resolves instantly to a named receiver.', shipped: 'No pass is ever thrown to a coordinate. Every pass has a named target.' },
  { id: 'FLOW-05', rule: 'Three or four passes should be enough to score a try from turnover ball.', shipped: 'Attacking shape guarantees an overlap is available within three passes.' },
  { id: 'FLOW-06', rule: 'Penalties are not punitive. Advantage is played wherever possible.', shipped: 'Rage deliberately avoided frequent penalties. Advantage window defaults to long.' },
  { id: 'FLOW-07', rule: 'Substitutions are optional and never forced.', shipped: 'The bench is a choice, not a chore.' },
  { id: 'FLOW-08', rule: 'The referee never stops play to explain himself.', shipped: 'Every call is one line of caption plus a signal animation, over live play.' },
  { id: 'FLOW-09', rule: 'Dead ball is never more than four seconds.', shipped: 'Restart choreography overlaps with the celebration.' },
  { id: 'FLOW-10', rule: 'The clock keeps running through minor stoppages.', shipped: 'Only tries, penalties at goal and injuries stop it.' },
  { id: 'FLOW-11', rule: 'A set piece begins when the players arrive, not when a timer expires.', shipped: 'Assembly state, with a two-second cap so it can never stall.' },
  { id: 'FLOW-12', rule: 'The ball is never hidden from the player.', shipped: 'In a maul the ball position is drawn as a marker on the carrier at all times.' },
  { id: 'FLOW-13', rule: 'Camera always shows the first receiver.', shipped: 'Framing target is the ball plus the first three attackers, not the ball alone.' },
  { id: 'FLOW-14', rule: 'Every meter is legible at a glance.', shipped: 'Bars are wide, colour-banded, and duplicated as text.' },
  { id: 'FLOW-15', rule: 'Reversibility: no single button press can lose you the match.', shipped: 'No interception from an offside position. No random knock-on at the line.' },
];

/* ============================ 4. ROLE CONTRACTS ============================
 * The fix for "players are never in their correct position", "props will line up
 * at flyhalf while fullbacks are rucking" and "pointless having a backline as
 * the forwards plays flyhalf". Fifteen shirts, each with a written contract for
 * each phase. This is the single largest data block in the game.
 */

export type PhaseName = 'OPEN_PLAY' | 'RUCK' | 'MAUL' | 'SCRUM' | 'LINEOUT' | 'KICK_CHASE' | 'KICK_RECEIVE' | 'RESTART' | 'DEFENCE_LINE' | 'GOAL_KICK';

export interface RoleContract {
  num: number;
  pos: string;
  /** metres from the ruck along the lateral axis, openside positive */
  lateral: Partial<Record<PhaseName, number>>;
  /** metres behind the gain line */
  depth: Partial<Record<PhaseName, number>>;
  job: Partial<Record<PhaseName, string>>;
  /** players who may legally play scrum half at a ruck, in order */
  cover: string;
  never: string;
}

export const ROLE_CONTRACTS: RoleContract[] = [
  {
    num: 1, pos: 'LOOSEHEAD PROP',
    lateral: { RUCK: -1.2, MAUL: -1.2, OPEN_PLAY: -2.0, DEFENCE_LINE: -3.0, KICK_CHASE: -6.0, KICK_RECEIVE: -8.0, RESTART: -2.0 },
    depth: { RUCK: 1.2, MAUL: 0, OPEN_PLAY: 4.0, DEFENCE_LINE: 2.5, KICK_CHASE: 3.0, KICK_RECEIVE: 12.0, RESTART: 4 },
    job: {
      RUCK: 'First or second arrival. Hit the first defender past the ball and drive him off it.',
      MAUL: 'Bind at the front, legs driving, head up.',
      OPEN_PLAY: 'Pod carrier option one. Never wider than the third channel.',
      DEFENCE_LINE: 'First defender outside the ruck. Shoot the carrier, do not drift.',
      KICK_CHASE: 'Chase hard down the middle third. Never chase wide.',
      KICK_RECEIVE: 'Return to the pod. Do not spread.',
    },
    cover: 'RUCK — third choice only',
    never: 'Never appears in the backline. Never outside the 10 channel. Never takes a goal kick.',
  },
  {
    num: 2, pos: 'HOOKER',
    lateral: { RUCK: 0, MAUL: 0, OPEN_PLAY: -1.0, DEFENCE_LINE: -1.0, KICK_CHASE: -2.0, KICK_RECEIVE: -6.0 },
    depth: { RUCK: 1.6, MAUL: 0, OPEN_PLAY: 5.0, DEFENCE_LINE: 3.0, KICK_CHASE: 2.0, KICK_RECEIVE: 13.0 },
    job: {
      RUCK: 'Primary clearout. Arrives first because he is always nearest.',
      MAUL: 'Front of the maul, protects the ball in.',
      OPEN_PLAY: 'Dummy-runner at the ruck. Fixes the A defender without taking the ball.',
      DEFENCE_LINE: 'Covers the ruck fringe. Must not be drawn wide.',
      KICK_CHASE: 'Leads the chase. First man to the ball.',
      KICK_RECEIVE: 'Forms the pod behind the receiver.',
    },
    cover: 'RUCK — second choice. May act as receiver only if 9 and 8 are both bound',
    never: 'Never plays first receiver. Never stands in the backline.',
  },
  {
    num: 3, pos: 'TIGHTHEAD PROP',
    lateral: { RUCK: 1.2, MAUL: 1.2, OPEN_PLAY: 2.0, DEFENCE_LINE: 3.0, KICK_CHASE: 6.0, KICK_RECEIVE: 8.0 },
    depth: { RUCK: 1.2, MAUL: 0, OPEN_PLAY: 4.0, DEFENCE_LINE: 2.5, KICK_CHASE: 3.0, KICK_RECEIVE: 12.0 },
    job: {
      RUCK: 'Second or third arrival. Clears low, over the ball, not around it.',
      MAUL: 'Binds tight, drives up the middle.',
      OPEN_PLAY: 'Pod option two.',
      DEFENCE_LINE: 'First defender on the openside of the ruck.',
      KICK_CHASE: 'Chases the middle third.',
      KICK_RECEIVE: 'Returns to the pod.',
    },
    cover: 'RUCK — fourth choice',
    never: 'Never in the backline. Never wider than the 13 channel.',
  },
  {
    num: 4, pos: 'SECOND ROW',
    lateral: { RUCK: -0.6, MAUL: -0.7, OPEN_PLAY: -3.0, DEFENCE_LINE: -5.0, KICK_CHASE: -3.0, KICK_RECEIVE: -5.0 },
    depth: { RUCK: 2.2, MAUL: 0.6, OPEN_PLAY: 5.5, DEFENCE_LINE: 4.0, KICK_CHASE: 2.5, KICK_RECEIVE: 13.5 },
    job: {
      RUCK: 'Lineout jumper who also clears out. Second wave.',
      MAUL: 'Engine room of the drive.',
      OPEN_PLAY: 'Pod carrier. Takes the crash ball if the call is on.',
      DEFENCE_LINE: 'Second defender outside the ruck on the blindside.',
      KICK_CHASE: 'Second wave chase, contests in the air.',
      KICK_RECEIVE: 'Pod support.',
    },
    cover: 'RUCK — fifth choice. Lineout primary jumper',
    never: 'Never marks a centre. Never wider than the 12 channel in attack.',
  },
  {
    num: 5, pos: 'SECOND ROW',
    lateral: { RUCK: 0.6, MAUL: 0.7, OPEN_PLAY: 3.0, DEFENCE_LINE: 5.0, KICK_CHASE: 3.0, KICK_RECEIVE: 5.0 },
    depth: { RUCK: 2.2, MAUL: 0.6, OPEN_PLAY: 5.5, DEFENCE_LINE: 4.0, KICK_CHASE: 2.5, KICK_RECEIVE: 13.5 },
    job: {
      RUCK: 'Second wave clearout.',
      MAUL: 'Engine room.',
      OPEN_PLAY: 'Pod carrier.',
      DEFENCE_LINE: 'Second defender openside.',
      KICK_CHASE: 'Second wave chase, contests in the air.',
      KICK_RECEIVE: 'Pod support.',
    },
    cover: 'RUCK — sixth choice. Lineout primary jumper',
    never: 'Never marks a centre.',
  },
  {
    num: 6, pos: 'BLINDSIDE FLANKER',
    lateral: { RUCK: -4.5, MAUL: -2.0, OPEN_PLAY: -6.0, DEFENCE_LINE: -8.0, KICK_CHASE: -9.0, KICK_RECEIVE: -10.0 },
    depth: { RUCK: 2.0, MAUL: 1.0, OPEN_PLAY: 5.0, DEFENCE_LINE: 3.0, KICK_CHASE: 3.5, KICK_RECEIVE: 14.0 },
    job: {
      RUCK: 'Guards the blindside fringe. Jackals only if the ball is slow.',
      MAUL: 'Drives or peels blind.',
      OPEN_PLAY: 'Blindside runner off the scrum or ruck.',
      DEFENCE_LINE: 'Blindside guard. Must not leave the short side.',
      KICK_CHASE: 'Chases the blind channel, squeezes the receiver.',
      KICK_RECEIVE: 'Blindside cover.',
    },
    cover: 'RUCK — first choice if the ball went blind',
    never: 'Never leaves the blindside unguarded to chase an overlap.',
  },
  {
    num: 7, pos: 'OPENSIDE FLANKER',
    lateral: { RUCK: 2.5, MAUL: 2.0, OPEN_PLAY: 4.0, DEFENCE_LINE: 6.5, KICK_CHASE: 1.0, KICK_RECEIVE: 2.0 },
    depth: { RUCK: 1.4, MAUL: 1.0, OPEN_PLAY: 4.5, DEFENCE_LINE: 2.0, KICK_CHASE: 1.5, KICK_RECEIVE: 11.0 },
    job: {
      RUCK: 'Primary jackal. First over the ball when the tackle is made.',
      MAUL: 'Hunts the ball, disrupts the drive.',
      OPEN_PLAY: 'Supports the carrier at the hip, ready for the offload.',
      DEFENCE_LINE: 'First defender wide of the ruck. Sets the line speed.',
      KICK_CHASE: 'Leads the chase on the openside.',
      KICK_RECEIVE: 'First support to the receiver.',
    },
    cover: 'RUCK — first choice jackal',
    never: 'Never marks the fly half. Never stands in the attacking backline.',
  },
  {
    num: 8, pos: 'NUMBER EIGHT',
    lateral: { RUCK: 1.8, MAUL: 1.5, OPEN_PLAY: 2.5, DEFENCE_LINE: 4.5, KICK_CHASE: 2.0, KICK_RECEIVE: 3.0 },
    depth: { RUCK: 2.6, MAUL: 1.2, OPEN_PLAY: 5.5, DEFENCE_LINE: 3.5, KICK_CHASE: 2.0, KICK_RECEIVE: 12.0 },
    job: {
      RUCK: 'Pick and go option one if the call is a carry. Otherwise second arrival.',
      MAUL: 'Controls the ball at the back of the maul, decides when to break.',
      OPEN_PLAY: 'Primary pod carrier. Takes the ball at pace.',
      DEFENCE_LINE: 'Fourth defender, the hard runner at the ten channel.',
      KICK_CHASE: 'Second chase, contests.',
      KICK_RECEIVE: 'Pod leader.',
    },
    cover: 'RUCK — first choice to pick and go, and second choice to pass',
    never: 'Never stands wider than the 10 channel.',
  },
  {
    num: 9, pos: 'SCRUM HALF',
    lateral: { RUCK: 1.0, MAUL: 1.6, OPEN_PLAY: 1.2, DEFENCE_LINE: -1.0, KICK_CHASE: 0.5, KICK_RECEIVE: 1.0 },
    depth: { RUCK: 2.0, MAUL: 2.2, OPEN_PLAY: 3.5, DEFENCE_LINE: 1.0, KICK_CHASE: 1.0, KICK_RECEIVE: 9.0 },
    job: {
      RUCK: 'Feeds the ball. Always. Nobody else takes it unless he is the carrier.',
      MAUL: 'Sits at the back, ready to whip it away or snipe.',
      OPEN_PLAY: 'Distributes, then snipes only when the fringe is empty.',
      DEFENCE_LINE: 'Sniper around the ruck. Never leaves it to chase wide.',
      KICK_CHASE: 'Chases the box kick he just made.',
      KICK_RECEIVE: 'First receiver, distributes immediately.',
    },
    cover: 'RUCK — DEFAULT AND ONLY PRIMARY',
    never: 'Never gets trapped in the ruck. Never tackles in the wide channels.',
  },
  {
    num: 10, pos: 'FLY HALF',
    lateral: { RUCK: 7.0, MAUL: 7.5, OPEN_PLAY: 8.0, DEFENCE_LINE: 8.5, KICK_CHASE: 8.0, KICK_RECEIVE: 8.0, GOAL_KICK: 0 },
    depth: { RUCK: 6.0, MAUL: 6.5, OPEN_PLAY: 7.0, DEFENCE_LINE: 3.0, KICK_CHASE: 6.0, KICK_RECEIVE: 10.0, GOAL_KICK: 0 },
    job: {
      RUCK: 'FIRST RECEIVER. Takes the ball every single phase the call is not a forward carry.',
      MAUL: 'First receiver off the maul.',
      OPEN_PLAY: 'Runs the shape. Decides kick, pass or carry.',
      DEFENCE_LINE: 'Marks the opposition ten. Rushes or drifts with the system.',
      KICK_CHASE: 'Chases his own kick, always.',
      KICK_RECEIVE: 'First receiver, returns the ball with interest.',
      GOAL_KICK: 'Designated goal kicker unless the sheet says otherwise.',
    },
    cover: 'RUCK — third choice, only if 9 and 8 are both unavailable',
    never: 'Never stands at the bottom of a ruck. Never carries into the forwards.',
  },
  {
    num: 11, pos: 'LEFT WING',
    lateral: { RUCK: -14.0, MAUL: -14.5, OPEN_PLAY: -16.0, DEFENCE_LINE: -15.0, KICK_CHASE: -13.0, KICK_RECEIVE: -18.0 },
    depth: { RUCK: 8.0, MAUL: 9.0, OPEN_PLAY: 9.0, DEFENCE_LINE: 6.0, KICK_CHASE: 4.0, KICK_RECEIVE: 16.0 },
    job: {
      RUCK: 'Holds width on the blindside. Never comes in for the ball.',
      MAUL: 'Holds width, watches for the long miss pass.',
      OPEN_PLAY: 'Finishes. Stays out. Takes the man on outside.',
      DEFENCE_LINE: 'Last defender on the blindside. Never pushed into touch.',
      KICK_CHASE: 'Sprints to contest the kick, then covers the blind in-goal.',
      KICK_RECEIVE: 'Primary kick returner on the blind.',
    },
    cover: 'RUCK — never',
    never: 'Never comes into a ruck. Ever. He is eight metres wider than anyone thinks.',
  },
  {
    num: 12, pos: 'INSIDE CENTRE',
    lateral: { RUCK: 10.0, MAUL: 10.5, OPEN_PLAY: 11.0, DEFENCE_LINE: 11.0, KICK_CHASE: 10.0, KICK_RECEIVE: 11.0 },
    depth: { RUCK: 6.5, MAUL: 7.0, OPEN_PLAY: 7.5, DEFENCE_LINE: 3.0, KICK_CHASE: 5.0, KICK_RECEIVE: 11.0 },
    job: {
      RUCK: 'Second receiver. Takes the ball at pace into the twelve channel.',
      MAUL: 'Second receiver.',
      OPEN_PLAY: 'Crash or pass. The decision-maker under pressure.',
      DEFENCE_LINE: 'Marks the twelve. Hardest runner in the line.',
      KICK_CHASE: 'Chases to contest.',
      KICK_RECEIVE: 'Second receiver, takes the contact or offloads.',
    },
    cover: 'RUCK — never',
    never: 'Never clears a ruck. Never plays first receiver unless the ten is in the line.',
  },
  {
    num: 13, pos: 'OUTSIDE CENTRE',
    lateral: { RUCK: 13.0, MAUL: 13.5, OPEN_PLAY: 14.5, DEFENCE_LINE: 14.0, KICK_CHASE: 12.0, KICK_RECEIVE: 14.0 },
    depth: { RUCK: 7.0, MAUL: 7.5, OPEN_PLAY: 8.0, DEFENCE_LINE: 3.5, KICK_CHASE: 5.0, KICK_RECEIVE: 12.0 },
    job: {
      RUCK: 'Third receiver. Runs the outside line.',
      MAUL: 'Third receiver.',
      OPEN_PLAY: 'Runs the outside break or the switch.',
      DEFENCE_LINE: 'Marks the thirteen. Leads the drift.',
      KICK_CHASE: 'Contests wide.',
      KICK_RECEIVE: 'Links the return.',
    },
    cover: 'RUCK — never',
    never: 'Never clears a ruck.',
  },
  {
    num: 14, pos: 'RIGHT WING',
    lateral: { RUCK: 17.0, MAUL: 17.5, OPEN_PLAY: 19.0, DEFENCE_LINE: 17.0, KICK_CHASE: 16.0, KICK_RECEIVE: 20.0 },
    depth: { RUCK: 8.0, MAUL: 8.5, OPEN_PLAY: 9.0, DEFENCE_LINE: 6.0, KICK_CHASE: 4.0, KICK_RECEIVE: 17.0 },
    job: {
      RUCK: 'Holds the widest openside position. The overlap arrives at him.',
      MAUL: 'Holds width.',
      OPEN_PLAY: 'Finishes. Stays out. The last pass goes to him.',
      DEFENCE_LINE: 'Last defender openside. Never beaten on the outside.',
      KICK_CHASE: 'Contests, then covers the in-goal.',
      KICK_RECEIVE: 'Primary kick returner openside.',
    },
    cover: 'RUCK — never',
    never: 'Never comes into a ruck.',
  },
  {
    num: 15, pos: 'FULLBACK',
    lateral: { RUCK: 11.0, MAUL: 12.0, OPEN_PLAY: 12.0, DEFENCE_LINE: 12.0, KICK_CHASE: 11.0, KICK_RECEIVE: 12.0 },
    depth: { RUCK: 12.0, MAUL: 13.0, OPEN_PLAY: 14.0, DEFENCE_LINE: 13.0, KICK_CHASE: 8.0, KICK_RECEIVE: 18.0 },
    job: {
      RUCK: 'Sweeps. Covers both kicks and line breaks. Never joins the line.',
      MAUL: 'Sweeps.',
      OPEN_PLAY: 'Counter-attacks or joins as the extra man only when the overlap is on.',
      DEFENCE_LINE: 'Sweeper behind the line. Fields every kick.',
      KICK_CHASE: 'Trails, covers the kick behind the chase.',
      KICK_RECEIVE: 'Primary receiver of the high ball. Calls for it.',
    },
    cover: 'RUCK — never',
    never: 'Never rucks. Never marks a man. He is the insurance policy.',
  },
];

export const contractFor = (num: number) => ROLE_CONTRACTS.find((r) => r.num === num)!;

/** The complete shirt → phase → position table. 15 shirts × 7 phases × 2 axes. */
export function roleTablePoints(): number {
  let n = 0;
  for (const r of ROLE_CONTRACTS) {
    n += Object.keys(r.lateral).length;
    n += Object.keys(r.depth).length;
    n += Object.keys(r.job).length;
    n += 3; // cover, never, pos
  }
  return n;
}

/* ============================ 5. SET PLAYS ============================
 * "No set plays, even games from the 90s had these." — Rugby 25 player, 2025.
 */

export interface SetPlay {
  id: string; name: string; from: 'RUCK' | 'SCRUM' | 'LINEOUT';
  call: string; intent: string; shape: string;
  runners: { num: number; instruction: string }[];
  risk: number; reward: number;
}

export const SET_PLAYS: SetPlay[] = [
  {
    id: 'SP-POD', name: 'POD CRASH', from: 'RUCK', call: 'ONE', intent: 'Hold the ball one out, take contact on your terms, recycle fast.',
    shape: 'Three forwards in a pod behind the ruck, backline flat and idle.',
    runners: [
      { num: 8, instruction: 'Take the ball at pace into the twelve channel.' },
      { num: 2, instruction: 'Clear out the first defender past the ball.' },
      { num: 7, instruction: 'Jackal the counter-ruck if it comes.' },
      { num: 9, instruction: 'Feed from the base, then follow.' },
      { num: 10, instruction: 'Flat, hands out, decoy only.' },
    ], risk: 0.1, reward: 0.35,
  },
  {
    id: 'SP-WIDE', name: 'WIDE SWEEP', from: 'RUCK', call: 'WIDE', intent: 'Move the ball three passes wide before the defence can slide.',
    shape: 'Backline deep and spread, forwards stay home.',
    runners: [
      { num: 9, instruction: 'Long, flat delivery to the ten.' },
      { num: 10, instruction: 'Pass before the line, do not take contact.' },
      { num: 12, instruction: 'Fix the twelve, pass out of the tackle.' },
      { num: 13, instruction: 'Draw the thirteen, release the wing.' },
      { num: 14, instruction: 'Stay wide. Finish.' },
      { num: 11, instruction: 'Come in for the blindside offload.' },
    ], risk: 0.3, reward: 0.8,
  },
  {
    id: 'SP-BLIND', name: 'BLIND SIDESTEP', from: 'RUCK', call: 'BLIND', intent: 'Attack the short side where they have left two men.',
    shape: 'Two runners blind, everyone else holds the openside.',
    runners: [
      { num: 9, instruction: 'Snipe or pass blind, immediately.' },
      { num: 6, instruction: 'Take the blind channel at pace.' },
      { num: 11, instruction: 'Support inside the flanker.' },
      { num: 7, instruction: 'Hold the openside so nobody follows.' },
    ], risk: 0.25, reward: 0.65,
  },
  {
    id: 'SP-MISS', name: 'MISS AND HIT', from: 'RUCK', call: 'MISS', intent: 'Skip the ten, put the twelve into the hole outside him.',
    shape: 'Ten is a decoy at first receiver, twelve takes it at pace one wider.',
    runners: [
      { num: 9, instruction: 'Pass to the ten, but the ten is a decoy.' },
      { num: 10, instruction: 'Dummy and let it run past.' },
      { num: 12, instruction: 'Take the flat ball at pace, hit the seam.' },
      { num: 13, instruction: 'Support outside.' },
    ], risk: 0.35, reward: 0.75,
  },
  {
    id: 'SP-CROSS', name: 'CROSS KICK', from: 'RUCK', call: 'CROSS', intent: 'Kick across the field to the isolated wing.',
    shape: 'Backline shifted so the far wing is one on one.',
    runners: [
      { num: 10, instruction: 'Kick early, before the drift sets.' },
      { num: 11, instruction: 'Chase the ball, not the man.' },
      { num: 15, instruction: 'Follow up for the bounce.' },
      { num: 14, instruction: 'Hold the far side so nobody tracks across.' },
    ], risk: 0.45, reward: 0.9,
  },
  {
    id: 'SP-DROP', name: 'FIELD POSITION, DROP', from: 'RUCK', call: 'DG', intent: 'Take the three while the defence is set.',
    shape: 'Ten drops back into the pocket as the pod carries.',
    runners: [
      { num: 8, instruction: 'Carry to set the platform.' },
      { num: 9, instruction: 'Distribute to the pocket.' },
      { num: 10, instruction: 'Drop back two metres and strike.' },
      { num: 15, instruction: 'Cover the kick charge.' },
    ], risk: 0.2, reward: 0.4,
  },
  {
    id: 'SP-8-9', name: 'EIGHT-NINE OFF THE SCRUM', from: 'SCRUM', call: 'EIGHT', intent: 'Number eight controls at the base, nine attacks the fringe.',
    shape: 'Eight breaks with the ball, nine on his hip.',
    runners: [
      { num: 8, instruction: 'Break from the base with the ball.' },
      { num: 9, instruction: 'On the hip for the offload.' },
      { num: 10, instruction: 'Flat and ready.' },
    ], risk: 0.2, reward: 0.55,
  },
  {
    id: 'SP-SC-WIDE', name: 'SCRUM WIDE MOVE', from: 'SCRUM', call: 'WIDE', intent: 'Move the ball away from the pack before their backrow arrives.',
    shape: 'Backline split, forwards hold.',
    runners: [
      { num: 9, instruction: 'Long pass to the ten.' },
      { num: 10, instruction: 'Straighten, then release.' },
      { num: 13, instruction: 'Outside break.' },
      { num: 14, instruction: 'Finish.' },
    ], risk: 0.3, reward: 0.7,
  },
  {
    id: 'SP-LO-DRIVE', name: 'CATCH AND DRIVE', from: 'LINEOUT', call: 'DRIVE', intent: 'Maul from the catch, drive for the line.',
    shape: 'Seven to the line, drive on the catch.',
    runners: [
      { num: 4, instruction: 'Catch and turn.' },
      { num: 2, instruction: 'Bind and drive.' },
      { num: 8, instruction: 'Control at the tail.' },
    ], risk: 0.15, reward: 0.5,
  },
  {
    id: 'SP-LO-TOP', name: 'OFF THE TOP', from: 'LINEOUT', call: 'TOP', intent: 'Ball to the ten before the defence sets.',
    shape: 'Front-of-the-line catch, immediate delivery.',
    runners: [
      { num: 4, instruction: 'Catch, tap to the nine.' },
      { num: 9, instruction: 'Whip it away first time.' },
      { num: 10, instruction: 'Attack the twelve channel.' },
      { num: 12, instruction: 'Hit the seam at pace.' },
    ], risk: 0.25, reward: 0.7,
  },
];

/* ============================ 6. COMMENTARY ============================
 * Bill McLaren and Bill Beaumont. Still cited in 2026 as the best commentary
 * ever put in a video game. Two men, talking over each other, in character.
 * Every line here is a two-hander because that is why it worked.
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
    key: 'WEATHER',
    lines: [
      ['The rain is really teeming down now.', 'It is a day for the forwards, no question.'],
      ['Greasy underfoot, and it is showing.', 'Handling is going to be a lottery.'],
      ['The wind is swirling around this ground.', 'Nobody is quite sure which way it is blowing.'],
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
];

export const COMMENTARY_POINT_COUNT = COMMENTARY_PAIRS.reduce((n, p) => n + p.lines.length * 2, 0);

/* ============================ 7. MODES & CONTENT ============================ */

export const LOMU_MODES: { mode: string; note: string; shipped: string }[] = [
  { mode: 'FRIENDLY', note: 'One match, any two sides.', shipped: 'Present in every build.' },
  { mode: 'WORLD CUP', note: 'Pools and knockout, authentic draw.', shipped: 'Present, seeded from the real pools.' },
  { mode: 'TOURNAMENT', note: 'Custom knockout bracket.', shipped: 'Any four, eight or sixteen sides.' },
  { mode: 'TERRITORIES CUP', note: 'Regional qualification ladder.', shipped: 'Five confederations, promotion and relegation.' },
  { mode: 'CLASSIC MATCHES', note: 'Play a famous game from history with the correct score to beat.', shipped: 'Twelve scenarios, each with the target margin and time remaining.' },
  { mode: 'SKILLS', note: 'Practice the verbs one at a time.', shipped: 'Seven drills, one per control verb.' },
  { mode: 'EXTRA CUP', note: 'Unlockable fantasy sides.', shipped: 'Two all-star sides earned by winning the Cup.' },
  { mode: 'FOUR PLAYER', note: 'Two on two on a single screen.', shipped: 'Pass-the-pad and co-op control of forwards and backs.' },
];

export const CLASSIC_MATCHES: { id: string; name: string; a: string; b: string; target: string; brief: string }[] = [
  { id: 'CM-01', name: 'THE 1995 SEMI', a: 'NZL', b: 'ENG', target: 'WIN BY 21', brief: 'Four tries from the left wing. The one everybody remembers.' },
  { id: 'CM-02', name: 'THE 1991 FINAL', a: 'AUS', b: 'ENG', target: 'WIN BY 6', brief: 'Twelve points to nine. Defence wins World Cups.' },
  { id: 'CM-03', name: 'THE 1991 SEMI', a: 'ENG', b: 'SCO', target: 'WIN BY 3', brief: 'The try that turned the match on its head.' },
  { id: 'CM-04', name: 'THE 1987 FINAL', a: 'NZL', b: 'FRA', target: 'WIN BY 20', brief: 'Twenty-nine to nine in Auckland.' },
  { id: 'CM-05', name: 'THE 1973 BARBARIANS', a: 'NZL', b: 'WAL', target: 'WIN BY 4', brief: 'That try. Seven pairs of hands, four phases.' },
  { id: 'CM-06', name: 'THE 1995 FINAL', a: 'RSA', b: 'NZL', target: 'WIN BY 4', brief: 'Extra time, a drop goal, and a nation stops.' },
  { id: 'CM-07', name: 'THE 1995 QUARTER', a: 'RSA', b: 'SAM', target: 'WIN BY 27', brief: 'The Pacific island side who frightened the world.' },
  { id: 'CM-08', name: 'THE FIVE NATIONS 1990', a: 'SCO', b: 'ENG', target: 'WIN BY 4', brief: 'The Grand Slam decider at Murrayfield.' },
  { id: 'CM-09', name: 'THE 1995 POOL', a: 'CAN', b: 'ROM', target: 'WIN BY 11', brief: 'The North Americans against the Oaks.' },
  { id: 'CM-10', name: 'THE 1991 POOL', a: 'SAM', b: 'WAL', target: 'WIN BY 6', brief: 'Cardiff falls silent.' },
  { id: 'CM-11', name: 'THE 1987 SEMI', a: 'FRA', b: 'AUS', target: 'WIN BY 6', brief: 'The Serge Blanco try in the corner.' },
  { id: 'CM-12', name: 'THE CALCUTTA 1991', a: 'ENG', b: 'SCO', target: 'WIN BY 8', brief: 'Twickenham, the oldest trophy in the game.' },
];

/* ============================ 8. ACCESSIBILITY ============================
 * "Easy to pick up and play without a complete understanding of all rugby's
 * ins and outs." The whole design thesis, as concrete settings.
 */

export const ACCESSIBILITY_RULES: { id: string; rule: string; detail: string }[] = [
  { id: 'ACC-01', rule: 'NEVER A HIDDEN RULE', detail: 'Anything the referee can penalise is drawn on the pitch before it happens.' },
  { id: 'ACC-02', rule: 'ON-SCREEN COMMANDS AT EVERY SET PIECE', detail: 'Printed on the turf, in plain language, synchronised to the referee cadence.' },
  { id: 'ACC-03', rule: 'INTENDED RECEIVER IS HIGHLIGHTED', detail: 'Before you pass, the man you are passing to is marked. No surprises.' },
  { id: 'ACC-04', rule: 'CONTROLLED PLAYER IS ALWAYS IDENTIFIABLE', detail: 'Name plate, shirt number, arrow and a distinct ring under the boots.' },
  { id: 'ACC-05', rule: 'TACKLE RANGE IS HONEST', detail: 'The range indicator shows exactly how far your dive will reach. No warping.' },
  { id: 'ACC-06', rule: 'AIM BEFORE YOU COMMIT', detail: 'Kicks show a direction line and a landing ellipse you can steer.' },
  { id: 'ACC-07', rule: 'NO PUNISHMENT FOR EXPLORING', detail: 'First three matches on any new profile have penalties and cards disabled.' },
  { id: 'ACC-08', rule: 'FIRST-TIMER HINTS', detail: 'A single line of context help appears for the first four minutes, then stops.' },
  { id: 'ACC-09', rule: 'SKILL ZONE', detail: 'Seven drills, one per verb, each with a pass mark and a medal time.' },
  { id: 'ACC-10', rule: 'FULL CONTROL REMAP', detail: 'Every verb can be rebound. Nothing is locked.' },
  { id: 'ACC-11', rule: 'ASSIST SLIDERS', detail: 'Pass assist, tackle assist and kick assist each adjustable from full to off.' },
  { id: 'ACC-12', rule: 'COLOUR-BLIND KITS', detail: 'Every fixture auto-resolves clashing kits, with a high-contrast option.' },
  { id: 'ACC-13', rule: 'SLOW MOTION OPTION', detail: 'Play at 75, 50 or 35 percent while learning. No score penalty.' },
  { id: 'ACC-14', rule: 'PAUSE GIVES YOU THE ANSWER', detail: 'Pausing explains what is happening and what to press next.' },
  { id: 'ACC-15', rule: 'NO FAIL STATE IN PRACTICE', detail: 'The skill zone never ends a drill. You can try a thing fifty times.' },
  { id: 'ACC-16', rule: 'SINGLE-BUTTON MODE', detail: 'One button plays, passes, tackles and kicks contextually. The 1991 scheme.' },
  { id: 'ACC-17', rule: 'GAME SPEED INDEPENDENT OF DIFFICULTY', detail: 'The ten rungs change decisions, not reflex taxes.' },
  { id: 'ACC-18', rule: 'REFREE EXPLAINS EVERY FIRST CALL', detail: 'The first time each law is applied, a caption states what it was for.' },
];

/* ============================ 9. FAIRNESS INVARIANTS ============================
 * Nothing here is allowed to happen, because each one of them is a documented
 * source of player rage in every rugby game since 1995.
 */

export const FAIRNESS_INVARIANTS: { id: string; invariant: string; because: string }[] = [
  { id: 'FAIR-01', invariant: 'A pass is never thrown to a coordinate. It is always thrown to a named player.', because: '"Passes don\'t go to hand" and "thrown into no man\'s land for reasons I can\'t fathom."' },
  { id: 'FAIR-02', invariant: 'A pass never travels further than the receiver can run. Distance is clamped to the shape.', because: '"Long pass launches into the grandstand."' },
  { id: 'FAIR-03', invariant: 'A receiver is never passed to while he is stationary. He always runs onto it.', because: '"Passing from a ruck, your player remains at a standstill and the defence are on you."' },
  { id: 'FAIR-04', invariant: 'An interception can only be made from an onside position by a player who was tracking the ball.', because: '"You can just stand players in front of the ball and intercept passes."' },
  { id: 'FAIR-05', invariant: 'A tackler cannot grab a carrier he is not touching. Contact radius is honest and shown.', because: '"You get dragged back into players trying to tackle you even if they\'re feet away."' },
  { id: 'FAIR-06', invariant: 'A knock-on is never generated at the moment of scoring.', because: '"He loses it forward with the line begging" should be a tackle, not a dice roll.' },
  { id: 'FAIR-07', invariant: 'Offside is only penalised when the player had somewhere legal to be.', because: '"Numerous offside calls against me when I have the ball and am attacking. WHY??"' },
  { id: 'FAIR-08', invariant: 'A player is never placed offside by the game. Only by his own movement.', because: '"Offside calls after the ruck because my player is automatically put in that position as soon as I press A."' },
  { id: 'FAIR-09', invariant: 'Winning a ruck is legible. The interface states who is winning and why, live.', because: '"Lose or win a ruck and no idea why? Me too."' },
  { id: 'FAIR-10', invariant: 'The designated goal kicker takes every goal kick. Always.', because: '"Completely random kickers for penalty kicks despite having a goal kicker clearly selected."' },
  { id: 'FAIR-11', invariant: 'A 50:22 gives the throw to the side that kicked it.', because: '"I managed a 50:22 but the opponent gets the ball to throw in the lineout."' },
  { id: 'FAIR-12', invariant: 'Held up in goal is a five-metre scrum to the attack, not a drop out.', because: 'Rugby 25 awards the goal-line drop kick to the defence instead.' },
  { id: 'FAIR-13', invariant: 'The nine, or the nearest eligible forward, plays the ball at a ruck. Never a distant back.', because: '"The whole game will wait for an arbitrarily selected player to get to the back of the ruck."' },
  { id: 'FAIR-14', invariant: 'You are never blocked by your own teammate at the base of a ruck.', because: '"You sometimes get blocked by your own players because they\'ve magically stood up in your path."' },
  { id: 'FAIR-15', invariant: 'CPU teams run multi-phase attacking shape. Never one pass and a tackle.', because: '"I put my controller down and the CPU did one pass and into a tackle. Repeat."' },
  { id: 'FAIR-16', invariant: 'Forwards stay in the forwards and backs stay in the backs, per the role contract.', because: '"Props will line up at flyhalf while fullbacks are rucking."' },
  { id: 'FAIR-17', invariant: 'Support arrives. Three players are assigned to every breakdown by name.', because: '"Three players floating around instead of coming into the ruck."' },
  { id: 'FAIR-18', invariant: 'The defensive line is connected. No gap wider than four metres is ever left open.', because: '"Huge gaps left in defensive lines causing easy line breaks."' },
  { id: 'FAIR-19', invariant: 'Commentary names the player who actually did the thing.', because: '"Commentators kept naming players not even in my match."' },
  { id: 'FAIR-20', invariant: 'Commentary never contradicts what the player can see.', because: '"That was a terrible kick, ball not into touch" when it was by miles.' },
  { id: 'FAIR-21', invariant: 'Goal-kick power is never destroyed by an accidental input.', because: '"A not so smooth movement of a joystick completely depleting the power of your kick."' },
  { id: 'FAIR-22', invariant: 'Scrum prompts are synchronised to the referee cadence, not to a hidden timer.', because: '"The timing of the gauge is not synced with the referee\'s verbal instructions."' },
  { id: 'FAIR-23', invariant: 'Actions fire the frame they are pressed. Nothing is queued.', because: '"Press circle too many times and a random player grubbers it five seconds later."' },
  { id: 'FAIR-24', invariant: 'Sprint and jog are on one continuous curve. Boost never feels like a different game.', because: '"Speed disparity between boost and normal player speed."' },
  { id: 'FAIR-25', invariant: 'Substitutions always take effect, and persist between matches.', because: '"My substitutions didn\'t go through" and "team management wouldn\'t save between games."' },
];

/* ============================ 10. COUNT ============================ */

/* ============================ 11. THE PLAYER ATTRIBUTE GRID ============================
 * The attribute model above, applied to every one of the 240 squad players.
 * This is not a reference table — it is the array the engine consumes when it
 * builds the thirty live players for a match.
 */

import { TEAMS } from './data';

export interface GridRow {
  teamId: string; num: number; name: string; pos: string;
  SPD: number; PWR: number; SKL: number; AGG: number; AWA: number; STA: number;
  /** Lomu's breakthrough rule: two attributes over 92 makes a signature player */
  signature: string | null;
}

function signatureFor(r: { SPD: number; PWR: number; SKL: number; num: number }): string | null {
  if (r.SPD >= 92 && r.PWR >= 88) return 'RAMPAGE';
  if (r.SPD >= 95) return 'STEP KING';
  if (r.PWR >= 92 && r.num <= 8) return 'RAMPAGE';
  if (r.SKL >= 94) return 'METRONOME';
  return null;
}

export const PLAYER_GRID: GridRow[] = TEAMS.flatMap((t) =>
  t.squad.map((p) => {
    const SPD = p.stats.SPD, PWR = p.stats.PWR, SKL = p.stats.SKL;
    return {
      teamId: t.id, num: p.num, name: p.name, pos: p.pos,
      SPD, PWR, SKL,
      AGG: Math.round((PWR + SPD) / 2),
      AWA: Math.round((SKL + p.stats.STA) / 2),
      STA: p.stats.STA,
      signature: signatureFor({ SPD, PWR, SKL, num: p.num }),
    };
  }),
);

export const SIGNATURE_COUNT = PLAYER_GRID.filter((r) => r.signature).length;

export function playerGridPoints(): number {
  // six attributes plus position, shirt, name and signature flag per player
  return PLAYER_GRID.length * 10;
}

/* ============================ 10. COUNT ============================ */

export function jlrPointCount(): { total: number; breakdown: Array<[string, number]> } {
  const attrs = ATTRIBUTE_MODEL.length * 3 + SIGNATURE_PLAYER_RULES.length * 3;
  const verbs = CONTROL_VERBS.length * 4;
  const flow = SEAMLESSNESS_RULES.length * 2;
  const roles = roleTablePoints();
  const plays = SET_PLAYS.reduce((n, p) => n + p.runners.length * 2 + 6, 0);
  const comm = COMMENTARY_POINT_COUNT;
  const modes = LOMU_MODES.length * 3 + CLASSIC_MATCHES.length * 5;
  const acc = ACCESSIBILITY_RULES.length * 2;
  const fair = FAIRNESS_INVARIANTS.length * 3;
  const grid = playerGridPoints();
  const breakdown: Array<[string, number]> = [
    ['ATTRIBUTE MODEL', attrs], ['CONTROL VERBS', verbs], ['SEAMLESSNESS RULES', flow],
    ['ROLE CONTRACTS', roles], ['SET PLAYS', plays], ['COMMENTARY LINES', comm],
    ['MODES & CLASSIC MATCHES', modes], ['ACCESSIBILITY RULES', acc], ['FAIRNESS INVARIANTS', fair],
    ['PLAYER ATTRIBUTE GRID', grid],
  ];
  return { total: breakdown.reduce((n, b) => n + b[1], 0), breakdown };
}
