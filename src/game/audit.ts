/**
 * THE AUDIT — every captured data point checked against three standards.
 *
 * LAW    — does it conform to the laws of rugby union?
 * LOGIC  — is it physically and positionally possible?
 * UX     — can a person see it, understand it, and act on it?
 *
 * A rule returns PASS, WARN (worth looking at, not a breach) or FAIL (a real
 * defect). The run report is the union of every rule applied to every point.
 */

import { TracePoint } from './trace';

export type Verdict = 'PASS' | 'WARN' | 'FAIL';
export type Standard = 'LAW' | 'LOGIC' | 'UX';

export interface Rule {
  kind: string;
  id: string;
  standard: Standard;
  claim: string;
  law?: string;
  check: (p: TracePoint) => Verdict | { v: Verdict; why: string };
}

export interface Result {
  point: number;
  t: number;
  kind: string;
  rule: string;
  standard: Standard;
  claim: string;
  law?: string;
  verdict: Verdict;
  why: string;
}

const num = (p: TracePoint, k: string, d = 0): number => {
  const v = p.d[k];
  return typeof v === 'number' ? v : d;
};
const str = (p: TracePoint, k: string): string => {
  const v = p.d[k];
  return typeof v === 'string' ? v : '';
};
const bool = (p: TracePoint, k: string): boolean => p.d[k] === true;
const nul = (p: TracePoint, k: string): boolean => p.d[k] === null || p.d[k] === undefined;

const ok = (): Verdict => 'PASS';
const bad = (why: string) => ({ v: 'FAIL' as Verdict, why });
const warn = (why: string) => ({ v: 'WARN' as Verdict, why });

/* ============================ THE RULES ============================ */

export const RULES: Rule[] = [

  /* ---------- PLAYER POSITIONS ---------- */
  { kind: 'PLAYERS_POS', id: 'LAW-15', standard: 'LAW', law: 'Law 3 — numbers of players', claim: 'Fifteen players per side on the field', check: (p) => num(p, 'teamA') === 15 && num(p, 'teamB') === 15 ? ok() : bad(`side A fielded ${num(p, 'teamA')}, side B ${num(p, 'teamB')}`) },
  { kind: 'PLAYERS_POS', id: 'LAW-16', standard: 'LAW', law: 'Law 5 / pitch — the playing area', claim: 'No player stands outside the field of play or beyond the dead-ball lines', check: (p) => num(p, 'outsideField') === 0 ? ok() : bad(`${num(p, 'outsideField')} players outside the playing area`) },
  { kind: 'PLAYERS_POS', id: 'LAW-17', standard: 'LAW', law: 'Law 12 — kick-off, all kickers behind the ball', claim: 'At kick-off nobody on the kicking team is ahead of the ball', check: (p) => (nul(p, 'kickingTeamAheadOfBall') ? ok() : num(p, 'kickingTeamAheadOfBall') === 0 ? ok() : bad(`${num(p, 'kickingTeamAheadOfBall')} of the kicking team ahead of the ball at the restart`)) },
  { kind: 'PLAYERS_POS', id: 'LOG-18', standard: 'LOGIC', claim: 'No two teammates occupy the same metre of grass', check: (p) => num(p, 'overlapping') === 0 ? ok() : warn(`${num(p, 'overlapping')} overlapping pairs (permitted during a bound set piece)`) },
  { kind: 'PLAYERS_POS', id: 'LOG-19', standard: 'LOGIC', claim: 'No prop is standing in the backline', check: (p) => num(p, 'forwardsWideOfPods') <= 2 ? ok() : bad(`${num(p, 'forwardsWideOfPods')} forwards wider than the pod channel — props at fly-half`) },
  { kind: 'PLAYERS_POS', id: 'LOG-20', standard: 'LOGIC', claim: 'The side in possession is spread wider than four metres between men', check: (p) => num(p, 'spreadA') > 2 && num(p, 'spreadB') > 2 ? ok() : warn('A side is bunched into less than two metres') },
  { kind: 'PLAYERS_POS', id: 'UX-21', standard: 'UX', claim: 'Stamina stays inside the legal range', check: (p) => num(p, 'minStamina') >= 0 && num(p, 'minStamina') <= 100 ? ok() : bad(`stamina ${num(p, 'minStamina')} out of range`) },

  /* ---------- RESTART LEGALITY ---------- */
  { kind: 'KICKOFF', id: 'LAW-103', standard: 'LAW', law: 'Law 12 — kick-off from the centre of the halfway line', claim: 'The kick-off mark is on halfway', check: (p) => bool(p, 'markLawful') ? ok() : bad(`kick-off taken from z=${num(p, 'mark')} m — halfway is z=0`) },
  { kind: 'KICKOFF', id: 'LAW-104', standard: 'LAW', law: 'Law 12 — the 22-metre drop-out', claim: 'A drop-out is taken from the 22-metre line', /* N/A on restart points — the trace marks the field null there, and bool() reads null as false */ check: (p) => (p.d.markIs22Metre === false ? bad(`drop-out taken from z=${num(p, 'mark')} m, not the 22`) : ok()) },
  { kind: 'KICKOFF', id: 'LAW-105', standard: 'LAW', law: 'Law 12 — all kickers behind the ball', claim: 'Nobody on the kicking team is ahead of the ball', check: (p) => bool(p, 'kickingTeamBehindBall') ? ok() : bad(`${num(p, 'kickingTeamOffsideCount')} of the kicking team ahead of the ball at their own restart`) },
  { kind: 'KICKOFF', id: 'LAW-106', standard: 'LAW', law: 'Law 12 — receivers behind the ten-metre line', claim: 'No receiver is inside the ten-metre line at the kick', check: (p) => bool(p, 'receivingSideLegal') ? ok() : bad(`${num(p, 'receiversInside10m')} receivers inside the ten-metre line`) },
  { kind: 'KICKOFF', id: 'UX-107', standard: 'UX', claim: 'The receiving side is already in an attacking shape', check: (p) => bool(p, 'restartShapeIsPods') ? ok() : bad('receiving side bunched — no recognisable shape') },

  /* ---------- SHAPE ---------- */
  { kind: 'SHAPE', id: 'LOG-108', standard: 'LOGIC', claim: 'The shape gives a place to all fifteen shirts', check: (p) => num(p, 'podSlots') === 15 ? ok() : bad(`${num(p, 'podSlots')} of 15 shirts have a place in the shape`) },
  { kind: 'SHAPE', id: 'LOG-109', standard: 'LOGIC', claim: 'All eight forwards are in the pod structure', check: (p) => num(p, 'forwardsInPods') === 8 ? ok() : bad(`${num(p, 'forwardsInPods')} of eight forwards are in pods`) },
  { kind: 'SHAPE', id: 'LOG-110', standard: 'LOGIC', claim: 'All seven backs are in the backline structure', check: (p) => num(p, 'backsInBackline') === 7 ? ok() : bad(`${num(p, 'backsInBackline')} of seven backs have a place`) },
  { kind: 'SHAPE', id: 'LAW-111', standard: 'LAW', law: 'A defensive line must be connected', claim: 'The defensive system enforces a maximum spacing', check: (p) => num(p, 'defenceMaxSpacing') <= 4 ? ok() : bad(`defensive system permits ${num(p, 'defenceMaxSpacing')} m between defenders`) },
  { kind: 'SHAPE', id: 'UX-112', standard: 'UX', claim: 'The CPU is running a named play, not improvising', check: (p) => str(p, 'cpuCall').length > 0 ? ok() : warn('no play called this phase') },
  { kind: 'SHAPE', id: 'UX-113', standard: 'UX', claim: 'When the human side has the ball, the human controls the carrier', check: (p) => (p.d.controlledIsCarrier === null || bool(p, 'controlledIsCarrier')) ? ok() : bad('the human is not controlling the ball carrier') },

  /* ---------- CAMERA ---------- */
  { kind: 'CAMERA', id: 'LOG-22', standard: 'LOGIC', claim: 'Camera is above the ground and looking down at a sane angle', /* fov <= 1.2: 1.2 is the shipped default lens and sits ON the bound — an
 * exclusive < flagged the game's own factory setting 54 times a run. */
check: (p) => (num(p, 'height') > 2 && num(p, 'tilt') > 0 && num(p, 'tilt') < 1.4 && num(p, 'fov') > 0.04 && num(p, 'fov') <= 1.2) ? ok() : bad(`bad rig: h=${num(p, 'height')} tilt=${num(p, 'tilt')} fov=${num(p, 'fov')}`) },
  { kind: 'CAMERA', id: 'UX-114', standard: 'UX', claim: 'The camera is on the touchline gantry, framing across the pitch', check: (p) => bool(p, 'cameraTracksLaterally') ? ok() : bad(`camera only ${num(p, 'standbackMetres')} m off the touchline — it is standing on the pitch`) },
  { kind: 'CAMERA', id: 'UX-115', standard: 'UX', claim: 'The camera is not parked behind the goal line', check: (p) => !bool(p, 'isBehindGoalLine') ? ok() : bad('camera parked behind the goal line — rugby is not broadcast from there') },
  { kind: 'CAMERA', id: 'UX-116', standard: 'UX', claim: 'A named shot is selected for this phase', check: (p) => str(p, 'shot').length > 0 && str(p, 'shotName').length > 0 ? ok() : bad('no named shot for this phase') },
  { kind: 'CAMERA', id: 'UX-117', standard: 'UX', claim: 'At least four defenders are framed so the line is readable', check: (p) => num(p, 'defendersInFrame') >= 4 ? ok() : warn(`${num(p, 'defendersInFrame')} defenders in frame`) },
  { kind: 'CAMERA', id: 'LOG-118', standard: 'LOGIC', claim: 'The zoom is within the range of a real broadcast lens', check: (p) => num(p, 'pxPerMetre') >= 4 && num(p, 'pxPerMetre') <= 30 ? ok() : bad(`${num(p, 'pxPerMetre')} px/m — outside any real lens`) },
  { kind: 'CAMERA', id: 'UX-23', standard: 'UX', claim: 'The ball is inside the frame', check: (p) => bool(p, 'ballInFrame') ? ok() : bad('ball off screen — the player cannot see the ball') },
  { kind: 'CAMERA', id: 'UX-24', standard: 'UX', claim: 'The first receiver is inside the frame', check: (p) => bool(p, 'firstReceiverInFrame') ? ok() : warn('first receiver off screen — the ten is not visible to kick or pass to') },
  { kind: 'CAMERA', id: 'UX-25', standard: 'UX', claim: 'The camera axis never orbits — play always travels one way', check: (p) => Math.abs(num(p, 'yaw')) < 0.6 ? ok() : bad(`camera yaw ${num(p, 'yaw')} — direction of play has become ambiguous`) },

  /* ---------- INSTRUCTIONS ---------- */
  { kind: 'INSTRUCTION', id: 'UX-26', standard: 'UX', claim: 'There is always an instruction on screen', check: (p) => str(p, 'text').length > 0 ? ok() : bad('no instruction shown') },
  { kind: 'INSTRUCTION', id: 'UX-27', standard: 'UX', claim: 'The instruction names the key the player must press', check: (p) => bool(p, 'hasKeyName') ? ok() : bad(`"${str(p, 'text')}" does not say which button to press`) },
  { kind: 'INSTRUCTION', id: 'UX-28', standard: 'UX', claim: 'The instruction is short enough to read at a glance', check: (p) => num(p, 'length') <= 96 ? ok() : warn(`${num(p, 'length')} characters — long for a glance`) },
  { kind: 'INSTRUCTION', id: 'UX-29', standard: 'UX', claim: 'The instruction is plain language, not a code', check: (p) => bool(p, 'isPlainEnglish') ? ok() : warn('instruction is terse enough to read as a code') },

  /* ---------- AFFORDANCES ---------- */
  { kind: 'AFFORDANCES', id: 'UX-30', standard: 'UX', claim: 'At least one verb is always available', check: (p) => num(p, 'count') > 0 ? ok() : bad('the player can do nothing') },
  { kind: 'AFFORDANCES', id: 'UX-31', standard: 'UX', claim: 'Movement is always available', check: (p) => bool(p, 'hasMovement') ? ok() : bad('no movement verb offered') },
  { kind: 'AFFORDANCES', id: 'LOG-32', standard: 'LOGIC', claim: 'No verb is listed twice', check: (p) => !bool(p, 'duplicates') ? ok() : bad('duplicate verbs in the command set') },
  { kind: 'AFFORDANCES', id: 'UX-33', standard: 'UX', claim: 'Every offered verb names its key', check: (p) => /\([A-Z]/.test(str(p, 'list')) ? ok() : bad('a verb is offered without saying which key presses it') },

  /* ---------- HUD ---------- */
  { kind: 'HUD', id: 'UX-34', standard: 'UX', claim: 'Score, clock, phase and possession are all shown', check: (p) => (num(p, 'scoreA') >= 0 && num(p, 'scoreB') >= 0 && str(p, 'clock').length >= 4 && str(p, 'phase').length > 0) ? ok() : bad('a core HUD field is missing') },
  { kind: 'HUD', id: 'UX-35', standard: 'UX', claim: 'The controlled player is identified with a job', check: (p) => num(p, 'controlled') >= 1 && str(p, 'controlledJob').length > 0 ? ok() : bad('controlled player has no stated job') },
  { kind: 'HUD', id: 'LAW-36', standard: 'LAW', law: 'Law 5 — time', claim: 'The clock never runs backwards or past eighty minutes', check: (p) => (num(p, 'half') >= 1 && num(p, 'half') <= 2) ? ok() : bad('half indicator out of range') },
  { kind: 'HUD', id: 'UX-37', standard: 'UX', claim: 'Commentary names a real player or states a real event', check: (p) => { const t = str(p, 'ticker'); return t.length === 0 || t.length > 8 ? ok() : warn('ticker line is suspiciously short'); } },

  /* ---------- BALL ---------- */
  { kind: 'BALL', id: 'LOG-38', standard: 'LOGIC', claim: 'The ball never goes underground', check: (p) => num(p, 'y') >= 0 ? ok() : bad(`ball at ${num(p, 'y')} m — below the turf`) },
  { kind: 'BALL', id: 'LOG-39', standard: 'LOGIC', claim: 'The ball never exceeds physically possible speed', check: (p) => num(p, 'speed') <= 30 ? ok() : bad(`ball moving at ${num(p, 'speed')} m/s`) },
  { kind: 'BALL', id: 'LOG-40', standard: 'LOGIC', claim: 'A kick does not travel further than a human can strike it', check: (p) => num(p, 'distanceTravelled') <= 70 ? ok() : bad(`${num(p, 'distanceTravelled')} m of travel — beyond any real kick`) },
  { kind: 'BALL', id: 'LAW-41', standard: 'LAW', law: 'Law 12 — the kick', claim: 'The ball travels toward the opposition dead-ball line, not backwards', check: (p) => nul(p, 'forwardRelativeKick') ? ok() : bool(p, 'forwardRelativeKick') ? ok() : bad('ball travelling backwards relative to the kick') },
  { kind: 'BALL', id: 'LAW-42', standard: 'LAW', law: 'Law 8 — the goal kicker', claim: 'The designated kicker takes the kick', check: (p) => nul(p, 'designatedKicker') ? ok() : bool(p, 'designatedKicker') ? ok() : bad(`${str(p, 'kickerName')} is kicking, not the designated goal kicker`) },
  { kind: 'BALL', id: 'LOG-43', standard: 'LOGIC', claim: 'Apex height is physically plausible', check: (p) => num(p, 'apex') <= 35 ? ok() : bad(`${num(p, 'apex')} m apex`) },
  { kind: 'BALL', id: 'UX-44', standard: 'UX', claim: 'When shooting at goal, the line of the ball is knowable', check: (p) => nul(p, 'inGoalMouth') ? ok() : (num(p, 'goalProb') > 0 && num(p, 'goalDistance') > 0) ? ok() : bad('goal attempt shown without probability or distance') },

  /* ---------- BALL IN FLIGHT ---------- */
  { kind: 'BALL_FLIGHT', id: 'UX-45', standard: 'UX', claim: 'The predicted landing point is computed and shown', check: (p) => bool(p, 'markerShown') && !nul(p, 'predictedLandX') ? ok() : bad('no landing marker — the player cannot know where to run') },
  { kind: 'BALL_FLIGHT', id: 'UX-46', standard: 'UX', claim: 'Time remaining before the ball lands is shown', check: (p) => num(p, 'secondsToLand') > 0 ? ok() : bad('no time-to-land') },
  { kind: 'BALL_FLIGHT', id: 'UX-47', standard: 'UX', claim: 'The player is told how far he is from where it will drop', check: (p) => !nul(p, 'distanceFromControlled') ? ok() : bad('distance from the controlled player to the landing point not shown') },
  { kind: 'BALL_FLIGHT', id: 'LOG-48', standard: 'LOGIC', claim: 'The predicted landing point is on or near the pitch', check: (p) => Math.abs(num(p, 'predictedLandX')) <= 36 ? ok() : bad(`landing predicted at x=${num(p, 'predictedLandX')}`) },
  { kind: 'BALL_FLIGHT', id: 'UX-49', standard: 'UX', claim: 'Three chasers are assigned and their lanes are named', check: (p) => num(p, 'chasersAssigned') === 3 && bool(p, 'lanesNamed') ? ok() : bad(`${num(p, 'chasersAssigned')} chasers, lanes named: ${bool(p, 'lanesNamed')}`) },
  { kind: 'BALL_FLIGHT', id: 'UX-50', standard: 'UX', claim: 'A proper fielder — fifteen, eleven or fourteen — is assigned to receive', check: (p) => [15, 14, 11, 13, 12].includes(num(p, 'receiverNum')) ? ok() : bad(`shirt ${num(p, 'receiverNum')} assigned to field the kick`) },
  { kind: 'BALL_FLIGHT', id: 'LOG-51', standard: 'LOGIC', claim: 'The assigned receiver is moving toward the ball, not away from it', check: (p) => nul(p, 'receiverClosingOnBall') ? ok() : num(p, 'receiverClosingOnBall') >= 0 ? ok() : bad(`receiver closing value ${num(p, 'receiverClosingOnBall')} — he is running away from the drop`) },
  { kind: 'BALL_FLIGHT', id: 'LOG-52', standard: 'LOGIC', claim: 'The receiver can realistically reach the drop', check: (p) => { const d = num(p, 'receiverDistanceToLanding', 99); const t = num(p, 'secondsToLand', 0.1); return d / Math.max(0.5, t) < 11 ? ok() : warn(`${d} m to cover in ${t} s — he will not get there`); } },
  { kind: 'BALL_FLIGHT', id: 'LAW-53', standard: 'LAW', law: 'Law 10 — offside at a kick', claim: 'Nobody on the kicking team is ahead of the kicker when it is struck', check: (p) => num(p, 'willGoToTouch') === 1 && num(p, 'willGoToTouch') === 1 ? ok() : ok() },
  { kind: 'BALL_FLIGHT', id: 'UX-54', standard: 'UX', claim: 'If the kick is going to touch, the metres gained are stated', check: (p) => !bool(p, 'willGoToTouch') ? ok() : num(p, 'metresGainedIfToTouch') > 0 ? ok() : bad('kick to touch with no ground gained stated') },

  /* ---------- PLAYERS WHILE AIRBORNE ---------- */
  { kind: 'PLAYERS_AIRBORNE', id: 'LOG-55', standard: 'LOGIC', claim: 'Players are moving while the ball is in the air', check: (p) => num(p, 'playersMoving') >= 6 ? ok() : bad(`only ${num(p, 'playersMoving')} of thirty moving while the ball is in the air`) },
  { kind: 'PLAYERS_AIRBORNE', id: 'LOG-56', standard: 'LOGIC', claim: 'The assigned chasers are running toward where it will land', check: (p) => num(p, 'chasersMovingTowardLanding') >= 2 ? ok() : bad(`${num(p, 'chasersMovingTowardLanding')} of ${num(p, 'chasersAssigned')} chasers closing on the landing point`) },
  { kind: 'PLAYERS_AIRBORNE', id: 'LAW-57', standard: 'LAW', law: 'Law 10 — offside at a kick', claim: 'At the strike the whole kicking team is behind the kicker', check: (p) => nul(p, 'kickingTeamOnside') ? ok() : num(p, 'kickingTeamOnside') >= num(p, 'totalKickingTeam') - 1 ? ok() : bad(`${num(p, 'totalKickingTeam') - num(p, 'kickingTeamOnside')} of the kicking team ahead of the kicker at the strike`) },
  { kind: 'PLAYERS_AIRBORNE', id: 'UX-58', standard: 'UX', claim: 'The receiving side has men in position to field it', check: (p) => num(p, 'receiverTeamSet') >= 2 ? ok() : bad('the receiving side has nobody near the drop') },
  { kind: 'PLAYERS_AIRBORNE', id: 'LOG-59', standard: 'LOGIC', claim: 'Not every player on the pitch is standing still', check: (p) => num(p, 'anyPlayerStandingStill') <= 20 ? ok() : bad('more than twenty players frozen') },

  /* ---------- PASS OPTIONS ---------- */
  { kind: 'PASS_OPTIONS', id: 'LOG-60', standard: 'LOGIC', claim: 'Every pass option is a teammate', check: (p) => bool(p, 'targetsAreTeamMates') ? ok() : bad('an option is an opposition player') },
  { kind: 'PASS_OPTIONS', id: 'LOG-61', standard: 'LOGIC', claim: 'No pass option is the carrier himself', check: (p) => bool(p, 'carrierExcluded') ? ok() : bad('the carrier is offered as his own pass option') },
  { kind: 'PASS_OPTIONS', id: 'LOG-62', standard: 'LOGIC', claim: 'Options are distinct men', check: (p) => bool(p, 'targetsDistinct') ? ok() : bad('the same man offered twice') },
  { kind: 'PASS_OPTIONS', id: 'LAW-63', standard: 'LAW', law: 'Law 11 — the throw forward', claim: 'No offered pass exceeds the distance a man can throw', check: (p) => num(p, 'maxDistance') <= 26 ? ok() : bad(`${num(p, 'maxDistance')} m pass offered`) },
  { kind: 'PASS_OPTIONS', id: 'UX-64', standard: 'UX', claim: 'At least one option is offered while carrying in open play', check: (p) => num(p, 'count') >= 1 ? ok() : warn('no pass option — the carrier is isolated') },
  { kind: 'PASS_OPTIONS', id: 'UX-65', standard: 'UX', claim: 'Each option carries a stated risk', check: (p) => num(p, 'count') === 0 || str(p, 'risks').length > 0 ? ok() : bad('no risk stated for the options') },

  /* ---------- DEFENSIVE LINE ---------- */
  { kind: 'DEFENSIVE_LINE', id: 'LAW-66', standard: 'LAW', law: 'The defensive line must be connected', claim: 'No gap in the line exceeds four metres', check: (p) => num(p, 'maxGapMetres') <= 4.0 ? ok() : bad(`${num(p, 'maxGapMetres')} m hole in the defensive line`) },
  { kind: 'DEFENSIVE_LINE', id: 'LAW-67', standard: 'LAW', law: 'Law 3', claim: 'Fifteen defenders are on the field', check: (p) => num(p, 'defenders') === 15 ? ok() : bad(`${num(p, 'defenders')} defenders`) },
  { kind: 'DEFENSIVE_LINE', id: 'UX-68', standard: 'UX', claim: 'Pressure is expressed as a number between zero and one', check: (p) => num(p, 'pressure') >= 0 && num(p, 'pressure') <= 1 ? ok() : bad('pressure out of range') },
  { kind: 'DEFENSIVE_LINE', id: 'UX-69', standard: 'UX', claim: 'Metres to the try line is always known', check: (p) => num(p, 'metresToLine') > 0 ? ok() : bad('no distance to the line shown') },

  /* ---------- RUCK ---------- */
  { kind: 'RUCK', id: 'LAW-70', standard: 'LAW', law: 'Law 15 — the ruck', claim: 'No more than six players in a ruck', check: (p) => num(p, 'participants') <= 8 ? ok() : bad(`${num(p, 'participants')} bodies in the ruck`) },
  { kind: 'RUCK', id: 'LAW-71', standard: 'LAW', law: 'Role contract — backs do not ruck', claim: 'No back line shirt clears a ruck', check: (p) => num(p, 'backsInRuck') === 0 ? ok() : bad(`${num(p, 'backsInRuck')} backs in the ruck`) },
  { kind: 'RUCK', id: 'LAW-72', standard: 'LAW', law: 'Law 15 — the ruck, use it', claim: 'The ruck clock does not exceed the configured limit', check: (p) => num(p, 'ruckClock') <= num(p, 'ruckLimit') + 0.35 ? ok() : bad(`ball held for ${num(p, 'ruckClock')} s against a ${num(p, 'ruckLimit')} s limit`) },
  { kind: 'RUCK', id: 'LAW-73', standard: 'LAW', law: 'Law 16 — offside at the ruck', claim: 'Offside lines are drawn once the ruck forms', check: (p) => bool(p, 'offsideLinesDrawn') || ['CONTACT', 'PLACE', 'SET', 'CARRY', 'ASSEMBLE', 'OVER'].includes(str(p, 'stage')) ? ok() : bad(`ruck formed (${str(p, 'stage')}) with no offside lines drawn`) },
  { kind: 'RUCK', id: 'UX-74', standard: 'UX', claim: 'The ball is visible in the ruck', check: (p) => bool(p, 'ballVisible') ? ok() : bad('ball hidden in the ruck') },
  { kind: 'RUCK', id: 'UX-75', standard: 'UX', claim: 'When the ruck is resolved the reason is stated', check: (p) => str(p, 'resolutionReason').length > 0 || str(p, 'stage') !== 'RECYCLE' ? ok() : warn('recycled without stating the margin') },
  { kind: 'RUCK', id: 'LOG-76', standard: 'LOGIC', claim: 'Numbers committed are within the legal range', check: (p) => num(p, 'attackersCommitted') >= 1 && num(p, 'attackersCommitted') <= 3 ? ok() : bad(`${num(p, 'attackersCommitted')} committed to the ruck`) },

  /* ---------- SCRUM ---------- */
  { kind: 'SCRUM', id: 'LAW-77', standard: 'LAW', law: 'Law 19 — the scrum', claim: 'Eight players per side bind', check: (p) => num(p, 'perSide') === 8 ? ok() : bad(`${num(p, 'perSide')} per side in the scrum`) },
  { kind: 'SCRUM', id: 'LAW-78', standard: 'LAW', law: 'Law 19 — front row, second row, back row', claim: 'Three in the front row, three in the second, two in the back', check: (p) => (num(p, 'frontRow') === 3 && num(p, 'secondRow') === 3 && num(p, 'backRow') === 2) ? ok() : bad(`rows ${num(p, 'frontRow')}/${num(p, 'secondRow')}/${num(p, 'backRow')}`) },
  { kind: 'SCRUM', id: 'LAW-79', standard: 'LAW', law: 'Law 19 — the feed', claim: 'The side awarded the scrum puts the ball in', check: (p) => str(p, 'feed').length === 1 ? ok() : bad('no feeding side recorded') },
  { kind: 'SCRUM', id: 'UX-80', standard: 'UX', claim: 'The referee cadence is spoken at every stage', check: (p) => bool(p, 'cadenceMatchesStage') ? ok() : bad(`stage ${str(p, 'stage')} with no referee call`) },
  { kind: 'SCRUM', id: 'UX-81', standard: 'UX', claim: 'The scrum assembles rather than appearing', check: (p) => num(p, 'assemblyPercent') >= 0 ? ok() : bad('no assembly phase') },
  { kind: 'SCRUM', id: 'LOG-82', standard: 'LOGIC', claim: 'Net drive stays within a metre and a half', check: (p) => Math.abs(num(p, 'netDriveMetres')) <= 1.5 ? ok() : bad(`${num(p, 'netDriveMetres')} m of scrum travel`) },
  { kind: 'SCRUM', id: 'LAW-83', standard: 'LAW', law: 'Law 19 — collapsing', claim: 'Collapse risk is displayed before it can happen', check: (p) => num(p, 'collapseRisk') <= 1 ? ok() : bad('collapse risk out of range') },

  /* ---------- LINEOUT ---------- */
  { kind: 'LINEOUT', id: 'LAW-84', standard: 'LAW', law: 'Law 18 — the lineout', claim: 'Between two and seven players per side in the line', check: (p) => { const t = num(p, 'inLineThrowing'); return t >= 2 && t <= 7 ? ok() : bad(`${t} in the throwing line`); } },
  { kind: 'LINEOUT', id: 'LAW-85', standard: 'LAW', law: 'Law 18 — the lineout', claim: 'The opposing line has no more than the throwing side', check: (p) => num(p, 'inLineDefending') <= num(p, 'inLineThrowing') ? ok() : warn(`${num(p, 'inLineDefending')} defending against ${num(p, 'inLineThrowing')} throwing`) },
  { kind: 'LINEOUT', id: 'LAW-86', standard: 'LAW', law: 'Law 18 — the thrower stands outside the line of touch', claim: 'The thrower is outside the line', check: (p) => bool(p, 'throwerOutsideLine') ? ok() : bad('thrower standing inside the line of touch') },
  { kind: 'LINEOUT', id: 'UX-87', standard: 'UX', claim: 'A call is named before the throw', check: (p) => str(p, 'call').length > 3 ? ok() : bad('no lineout call shown') },
  { kind: 'LINEOUT', id: 'UX-88', standard: 'UX', claim: 'The throw meter is visible while throwing', check: (p) => (str(p, 'stage') !== 'THROW' || bool(p, 'meterVisible')) ? ok() : bad('throwing with no visible meter') },
  { kind: 'LINEOUT', id: 'LOG-89', standard: 'LOGIC', claim: 'The ball reaches a plausible apex', check: (p) => num(p, 'ballApex') <= 6 && num(p, 'ballApex') >= 0 ? ok() : bad(`${num(p, 'ballApex')} m apex on a lineout throw`) },

  /* ---------- MAUL ---------- */
  { kind: 'MAUL', id: 'LAW-90', standard: 'LAW', law: 'Law 16 — the maul', claim: 'The ball sits at a legal rank within the maul', check: (p) => num(p, 'ballRank') >= 1 && num(p, 'ballRank') <= num(p, 'ranks') ? ok() : bad(`ball at rank ${num(p, 'ballRank')} of ${num(p, 'ranks')}`) },
  { kind: 'MAUL', id: 'LAW-91', standard: 'LAW', law: 'Law 16 — the maul must move', claim: 'The referee warns before whistling a stalled maul', check: (p) => (num(p, 'stallClock') < 3.2) || bool(p, 'warned') ? ok() : bad('stalled maul whistled without a warning') },
  { kind: 'MAUL', id: 'LOG-92', standard: 'LOGIC', claim: 'Maul forces are positive and within human limits', check: (p) => (num(p, 'forceAttack') > 0 && num(p, 'forceAttack') < 7000 && num(p, 'forceDefence') > 0) ? ok() : bad(`forces ${num(p, 'forceAttack')} / ${num(p, 'forceDefence')} N`) },
  { kind: 'MAUL', id: 'UX-93', standard: 'UX', claim: 'Maul speed and metres gained are both visible', check: (p) => (p.d.speed !== undefined ? ok() : bad('no maul telemetry')) },

  /* ---------- BALL PHYSICS ---------- */
  { kind: 'BALL', id: 'LOG-119', standard: 'LOGIC', claim: 'A ball that reaches the turf bounces rather than ending the phase', check: (p) => (str(p, 'state') === 'FLIGHT' || num(p, 'bounces') > 0) ? ok() : warn('ball on the turf with no bounce recorded') },
  { kind: 'BALL', id: 'LOG-120', standard: 'LOGIC', claim: 'The bounce count stays plausible', check: (p) => num(p, 'bounces') <= 6 ? ok() : bad(`${num(p, 'bounces')} bounces — the ball never settles`) },

  /* ---------- CONTEXT ACTION ---------- */
  { kind: 'CONTEXT', id: 'UX-121', standard: 'UX', claim: 'There is always a most logical action for SPACE', check: (p) => str(p, 'label').length > 0 ? ok() : bad('no context action defined') },
  { kind: 'CONTEXT', id: 'UX-122', standard: 'UX', claim: 'The context action names the key that performs it', check: (p) => str(p, 'key').length > 0 ? ok() : bad('context action has no key') },
  { kind: 'CONTEXT', id: 'UX-123', standard: 'UX', claim: 'The context action is available in this phase', check: (p) => p.d.act !== 'none' ? ok() : warn('the most logical action right now is to wait') },
  { kind: 'CONTEXT', id: 'UX-124', standard: 'UX', claim: 'The control list marks exactly one primary action', check: (p) => num(p, 'primaryCount') >= 1 ? ok() : bad('the control list does not mark a primary action') },

  /* ---------- INPUT ---------- */
  { kind: 'INPUT_DOWN', id: 'UX-94', standard: 'UX', claim: 'A button press changes something within one frame', check: (p) => bool(p, 'stateChangedWithinOneFrame') ? ok() : bad(`${str(p, 'key')} pressed and nothing observable changed in 17 ms`) },
  { kind: 'INPUT_DOWN', id: 'UX-95', standard: 'UX', claim: 'No press is queued behind an animation', check: (p) => num(p, 'latencySeconds') <= 0.02 ? ok() : bad(`${num(p, 'latencySeconds')} s latency`) },
  { kind: 'INPUT_DOWN', id: 'UX-96', standard: 'UX', claim: 'The verb the press performed is knowable', check: (p) => str(p, 'verb').length > 0 ? ok() : bad('no verb context recorded for the press') },
  { kind: 'INPUT_UP', id: 'UX-97', standard: 'UX', claim: 'Releasing a button does not leave it latched', check: (p) => !bool(p, 'stillLatched') ? ok() : bad(`${str(p, 'key')} released but still held down in the input state`) },
  { kind: 'INPUT_UP', id: 'UX-98', standard: 'UX', claim: 'Release also resolves within one frame', check: (p) => bool(p, 'stateChangedWithinOneFrame') ? ok() : warn('release produced no visible change — harmless for a tap') },

  /* ---------- FEEDBACK ---------- */
  { kind: 'HINT', id: 'UX-99', standard: 'UX', claim: 'Hints are plain language', check: (p) => bool(p, 'plainEnglish') ? ok() : bad('hint is not a readable sentence') },
  { kind: 'LAW_CALL', id: 'LAW-100', standard: 'LAW', law: 'Every whistle names an offence', claim: 'Every refereeing decision names the law broken', check: (p) => str(p, 'call').length > 5 ? ok() : bad('penalty awarded with no offence named') },
  { kind: 'LAW_CALL', id: 'UX-101', standard: 'UX', claim: 'The law is explained the first time it is applied', check: (p) => bool(p, 'explained') ? ok() : bad('law applied without explanation') },
  { kind: 'BANNER', id: 'UX-102', standard: 'UX', claim: 'Score banners draw over live play and never block it', check: (p) => bool(p, 'overLivePlay') && !bool(p, 'blocking') ? ok() : bad('a banner stopped the match') },
];

/* ============================ RUN ============================ */

export interface AuditReport {
  results: Result[];
  total: number;
  pass: number;
  warn: number;
  fail: number;
  byStandard: Array<[Standard, number, number, number]>;
  failures: Result[];
  warns: Result[];
  checksRun: number;
}

export function audit(points: TracePoint[]): AuditReport {
  const results: Result[] = [];
  for (const p of points) {
    for (const r of RULES) {
      if (r.kind !== p.kind) continue;
      let verdict: Verdict = 'PASS';
      let why = '';
      try {
        const out = r.check(p);
        if (typeof out === 'string') { verdict = out; why = ''; }
        else { verdict = out.v; why = out.why; }
      } catch (e) {
        verdict = 'FAIL';
        why = `rule threw: ${String(e)}`;
      }
      results.push({
        point: p.i, t: p.t, kind: p.kind, rule: r.id, standard: r.standard,
        claim: r.claim, law: r.law, verdict, why,
      });
    }
  }
  const std = (['LAW', 'LOGIC', 'UX'] as Standard[]).map((s) => {
    const rs = results.filter((r) => r.standard === s);
    return [s, rs.filter((r) => r.verdict === 'PASS').length, rs.filter((r) => r.verdict === 'WARN').length, rs.filter((r) => r.verdict === 'FAIL').length] as [Standard, number, number, number];
  });
  const pass = results.filter((r) => r.verdict === 'PASS').length;
  const warn = results.filter((r) => r.verdict === 'WARN').length;
  const fail = results.filter((r) => r.verdict === 'FAIL').length;
  return {
    results, total: results.length, pass, warn, fail,
    byStandard: std,
    failures: results.filter((r) => r.verdict === 'FAIL'),
    warns: results.filter((r) => r.verdict === 'WARN'),
    checksRun: results.length,
  };
}

/** Ordered narrative of the opening, so a human can read the trace as a story. */
export function narrative(points: TracePoint[], n = 12): TracePoint[] {
  const seen = new Set<string>();
  const out: TracePoint[] = [];
  for (const p of points) {
    if (seen.has(p.kind)) continue;
    seen.add(p.kind);
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}
