/**
 * TUTORIAL — a real match, paused at the moment each mechanic first matters.
 *
 * The complaint this answers: "the game feels like you teleport to different
 * situations with no clear structure staying intact."
 *
 * The fix is not to remove the mini-games. A rugby match genuinely is a set of
 * distinct contests — a scrum is not a lineout is not open play. The fix is to
 * make each transition *announced and understood* rather than sudden:
 *
 *   1. The engine pauses BEFORE the player has to act.
 *   2. A card names the set piece, explains what it is for, and lists the keys.
 *   3. Play resumes the moment he presses one of those keys.
 *   4. He keeps playing — open play continues normally — until he scores,
 *      presses NEXT, or presses RESET.
 *
 * So the structure stays intact because the player is told what the structure
 * IS at the moment it changes, instead of being dropped into it.
 */

export interface TutorialStep {
  id: string;
  /** the phase this step sets up */
  setup: 'RESTART' | 'OPEN_PLAY' | 'SCRUM' | 'LINEOUT' | 'BREAKDOWN' | 'MAUL' | 'KICK_AT_GOAL' | 'PENALTY';
  title: string;
  /** what this contest is, in plain language */
  what: string;
  /** why it exists in rugby */
  why: string;
  /** the keys that resume play, and what each does */
  keys: { key: string; does: string }[];
  /** the single key press that dismisses the card */
  resumeOn: string[];
  /** what to watch for once play resumes */
  then: string;
  /** where to put the ball, in engine metres */
  at?: { x: number; z: number };
}

export const TUTORIAL: TutorialStep[] = [
  {
    id: 'T1-KICKOFF',
    setup: 'RESTART',
    title: '1 · THE KICK-OFF',
    what: 'Every half, and every restart after a score, begins with a drop kick from the centre of the halfway line. Your fifteen must all be behind the ball; their fifteen must be ten metres back.',
    why: 'The kick-off is a contest, not a formality. Kick long for territory, or short and high so your chasers can compete for it in the air.',
    keys: [
      { key: 'A / D', does: 'Aim the kick left or right' },
      { key: 'HOLD SPACE', does: 'Power builds — the line on the grass grows as you hold' },
      { key: 'RELEASE SPACE', does: 'Strike it. Where the line ends is where it lands.' },
    ],
    resumeOn: ['action', 'left', 'right'],
    then: 'Watch your three chasers. They run at the spot the ball will land, not at the ball.',
    at: { x: 0, z: 0 },
  },
  {
    id: 'T2-OPENPLAY',
    setup: 'OPEN_PLAY',
    title: '2 · RUNNING AND PASSING',
    what: 'Open play. You control the man with the ball. Everyone else — all twenty-nine of them — is being driven by the AI to the job his shirt number says he should be doing.',
    why: 'Rugby is won by moving the ball to where the defence is not. A pass must go backwards, so you gain ground by running first and passing second.',
    keys: [
      { key: 'W A S D', does: 'Run. By default these are relative to the camera.' },
      { key: 'SPACE', does: 'Sprint, or the most sensible action for the situation' },
      { key: 'J / K', does: 'Pass left or right — the target is highlighted before you throw' },
      { key: 'U / O', does: 'Cut-out pass, skipping one man to hit the overlap' },
      { key: 'G', does: 'Sidestep · F fend off a tackler' },
    ],
    resumeOn: ['left', 'right', 'up', 'down', 'action', 'passL', 'passR'],
    then: 'Green rings mark who you can pass to. Run at the gap between two defenders, not at a man.',
    at: { x: 0, z: -12 },
  },
  {
    id: 'T3-BREAKDOWN',
    setup: 'BREAKDOWN',
    title: '3 · THE BREAKDOWN',
    what: 'You have been tackled. The carrier must release the ball; both sides now fight for it on the ground. This is the ruck.',
    why: 'Roughly 150 rucks happen in a match. Winning your own ball quickly is the single biggest driver of attacking success — quick ball beats a set defence, slow ball does not.',
    keys: [
      { key: 'A / D ALTERNATE', does: 'Pound left and right to clear out the defender over the ball' },
      { key: 'SPACE', does: 'Commit one more forward to the ruck' },
    ],
    resumeOn: ['left', 'right', 'action'],
    then: 'The bar shows your clear-out. Commit too many and you have nobody left in the backline.',
  },
  {
    id: 'T4-SCRUM',
    setup: 'SCRUM',
    title: '4 · THE SCRUM',
    what: 'Eight against eight, bound together, restarting play after a knock-on or a forward pass. The referee calls crouch, bind, set.',
    why: 'A scrum is a shoving contest for a platform. Win it and your backs get the ball going forward; lose it and you concede a penalty or the put-in.',
    keys: [
      { key: 'A / D ALTERNATE', does: 'Pound to push. Watch the referee cadence at the top left.' },
    ],
    resumeOn: ['left', 'right'],
    then: 'Push only when the referee says SET. Early and you concede a free kick.',
    at: { x: 4, z: 5 },
  },
  {
    id: 'T5-LINEOUT',
    setup: 'LINEOUT',
    title: '5 · THE LINEOUT',
    what: 'The ball went into touch. Both packs form a line, and the hooker throws it down the middle. Jumpers are lifted to catch it.',
    why: 'It is your throw, so it should be your ball — but the throw must be straight, and a good defence will contest it. Win it cleanly and you can maul, or move it to the backs.',
    keys: [
      { key: 'A / D', does: 'Choose the call — front, middle, off the top, or tail' },
      { key: 'SPACE', does: 'Throw. Stop the bar inside the gold band for a straight throw.' },
    ],
    resumeOn: ['left', 'right', 'action'],
    then: 'A front ball is safe. A tail ball is the biggest gain and the biggest risk.',
    at: { x: 26, z: 12 },
  },
  {
    id: 'T6-MAUL',
    setup: 'MAUL',
    title: '6 · THE DRIVING MAUL',
    what: 'You caught the lineout and your pack has bound onto the catcher while he is still on his feet. That is a maul, and you can drive it forward.',
    why: 'A maul is the hardest thing in rugby to defend legally. Near their line it is the highest-percentage way to score. But if it stops twice, you lose the ball.',
    keys: [
      { key: 'A / D ALTERNATE', does: 'Win the four-beat maul contest; after it, A/D peels' },
      { key: 'SPACE', does: 'Transfer the ball to the nine' },
      { key: 'L', does: 'Pick and go from the back of the maul' },
    ],
    resumeOn: ['left', 'right', 'action', 'kick'],
    then: 'Watch the stall clock. If it stops, take the ball out before the referee whistles.',
    at: { x: 18, z: 38 },
  },
  {
    id: 'T7-KICKING',
    setup: 'OPEN_PLAY',
    title: '7 · KICKING FROM HAND',
    what: 'You do not have to run. A kick trades possession for territory, and a good one wins fifty metres in three seconds.',
    why: 'Most professional sides kick around fifty times a match. From inside your own twenty-two, kicking is almost always the right answer.',
    keys: [
      { key: 'L', does: 'Punt — hold to build power, release to strike' },
      { key: 'H', does: 'Grubber — along the ground, behind their line' },
      { key: 'P', does: 'Drop goal — three points from open play' },
    ],
    resumeOn: ['kick', 'grubber', 'drop', 'left', 'right'],
    then: 'The line on the grass is the kick. Longer line, longer kick. Accuracy comes from your kicker.',
    at: { x: -6, z: -34 },
  },
  {
    id: 'T8-GOALKICK',
    setup: 'KICK_AT_GOAL',
    title: '8 · KICKING AT GOAL',
    what: 'A penalty, or a conversion after a try. Your designated goal kicker steps up. Distance and angle are shown, along with his real chance of making it.',
    why: 'Penalties are three points and conversions are two. Over eighty minutes, a reliable kicker is worth more than a winger.',
    keys: [
      { key: 'A / D', does: 'Aim' },
      { key: 'HOLD SPACE', does: 'Build power — you need enough to reach' },
      { key: 'RELEASE', does: 'Strike' },
    ],
    resumeOn: ['action', 'left', 'right'],
    then: 'Under fifty percent, consider kicking to the corner instead and going for the try.',
    at: { x: 8, z: 30 },
  },
  {
    id: 'T9-DEFENCE',
    setup: 'OPEN_PLAY',
    title: '9 · DEFENDING',
    what: 'They have the ball. You now control the defender best placed to make the tackle, and the red ring under him shows exactly how far your dive reaches.',
    why: 'A tackle is not a collision, it is an interception of a running line. Get in front of him, not behind him.',
    keys: [
      { key: 'X', does: 'Diving tackle — reaches 3.5 metres' },
      { key: 'C', does: 'Smother tackle — 1.4 metres, but far more reliable' },
      { key: 'Q', does: 'Switch to a different defender' },
    ],
    resumeOn: ['tackleDive', 'tackleSmother', 'switchPlayer', 'left', 'right'],
    then: 'After the tackle you can contest the ball. The fastest man over it usually wins the penalty.',
    at: { x: 0, z: 8 },
  },
];

export interface TutorialState {
  active: boolean;
  index: number;
  /** true while the explanation card is up and the match is frozen */
  showing: boolean;
  /** the step has been resumed and the player is now playing freely */
  playing: boolean;
  completed: string[];
}

export const newTutorial = (): TutorialState => ({
  active: false, index: 0, showing: false, playing: false, completed: [],
});

export const stepAt = (i: number): TutorialStep | undefined => TUTORIAL[i];
export const TUTORIAL_STEPS = TUTORIAL.length;
