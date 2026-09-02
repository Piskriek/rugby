import { expand, PointTuple } from './types';

// 14 — RIGHT WING (100 points)
// The finisher. The mirror of 11 (left wing): openside-wide, chase leader,
// corner defender.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 45, 88, 'Stand on the openside wing, 10m from the right touchline, level with the scrum.', 'If 15 is wide, come in one and hold the 15m channel.'],
  ['own-scrum-mid', 2, 46, 86, 'Stay hungry for the wide call; watch the ten\'s hands, not the ruck.', 'If the call goes blind, hold and defend the wide channel.'],
  ['own-scrum-mid', 3, 49, 82, 'Take the wide ball at pace and attack the space or the corner.', 'If the corner is shut, cut back inside.'],
  ['own-scrum-mid', 4, 44, 80, 'If the ball goes the other way, fold back and cover the wide backfield.', 'If 15 has that space, hold the 15m channel as the link.'],
  ['own-scrum-mid', 5, 42, 78, 'Set in the backfield triangle at 25-30m from the ball.', 'If we go wide right later, sprint up as the finisher.'],
  // def-scrum-22
  ['def-scrum-22', 1, 14, 88, 'Hold the right edge of the line, marking their wide attack.', 'If 15 covers the corner, step in one and mark their 13.'],
  ['def-scrum-22', 2, 14, 86, 'Do not shoot early; the corner is yours and the touchline is your friend.', 'If they kick, sprint back and be the receiver.'],
  ['def-scrum-22', 3, 13, 84, 'Make the tackle in the touchline channel; force them into touch.', 'If they step inside, hold and trust the cover.'],
  ['def-scrum-22', 4, 12, 82, 'Drop into the backfield to cover their exit kick to the right.', 'If 15 fields it, become the first support option.'],
  ['def-scrum-22', 5, 16, 84, 'Re-set on the right edge of the line.', 'If we counter, run the support arc outside the catcher.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 92, 88, 'Hold width outside the lineout — the long-ball threat from the maul.', 'If 15 is the wide option, come in and take the second-wide channel.'],
  ['own-lineout-att-5', 2, 93, 86, 'Watch the ten; the cross-field kick or the wide swing is yours.', 'If the maul drives, hold your channel and stay onside.'],
  ['own-lineout-att-5', 3, 94, 82, 'Take the wide pass at pace, attack the fringe or the corner.', 'If covered, come in and be the link.'],
  ['own-lineout-att-5', 4, 95, 78, 'If the drive goes blind, fold across behind the ruck as support.', 'If the ball comes wide, finish it.'],
  ['own-lineout-att-5', 5, 96, 84, 'Reset wide for the goal-line phases — the corner is always on.', 'If 13 is the finisher, hold second-wide.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 48, 92, 'Hold the right corner, 15m from touch, level with their backline.', 'If 15 is deep, step up into the line at 13.'],
  ['def-lineout-mid', 2, 48, 90, 'Watch the ball, not the runners; the corner dies from ball-watching.', 'If they kick, turn and take the high ball.'],
  ['def-lineout-mid', 3, 47, 86, 'Tackle their wide runner into touch.', 'If they cut back, hold and trust the drifting cover.'],
  ['def-lineout-mid', 4, 46, 88, 'Drop and cover the wide kick space with 15.', 'If 15 fields it, support outside him.'],
  ['def-lineout-mid', 5, 45, 84, 'Reset the right edge for their phase two.', 'If we counter, swing wide immediately.'],
  // att-phase-mid
  ['att-phase-mid', 1, 48, 78, 'Hold the widest channel, 15m from touch, at pace-ready depth.', 'If 13 comes wide, hold second-wide and wait.'],
  ['att-phase-mid', 2, 49, 80, 'Time your run off 13\'s hands; never be flat, never be deep.', 'If the ball slows, hold your width and reset.'],
  ['att-phase-mid', 3, 51, 84, 'Take the ball at full pace into the space.', 'If the edge is shut, chip and chase or cut back.'],
  ['att-phase-mid', 4, 53, 87, 'FINISH: beat the last defender, use the corner, ground it in.', 'If the tackle is made, present long and stay alive.'],
  ['att-phase-mid', 5, 53, 80, 'Reload wide; the finisher resets fastest.', 'If the ball comes back, be there again.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 78, 'Hold the wide channel of the line, connected inside to 13.', 'If 13 shoots, slide in and cover his channel.'],
  ['def-line-mid', 2, 44, 80, 'Watch their deepest runner; the kick behind is your danger.', 'If they run, hold the drift line.'],
  ['def-line-mid', 3, 43, 84, 'Make the tackle in the channel or force them to touch.', 'If they kick over you, turn and chase.'],
  ['def-line-mid', 4, 42, 82, 'Reset the edge fast — the wing is never at the ruck.', 'If we turn it over, swing wide and counter.'],
  ['def-line-mid', 5, 43, 78, 'Fold with the ball, holding the wide shape.', 'If numbers are short, drift to the touchline.'],
  // kickoff-receive
  ['kickoff-receive', 1, 26, 84, 'Hold the right backfield at 22m depth — the wide receiver.', 'If the kick is short, advance into the corner slot.'],
  ['kickoff-receive', 2, 25, 86, 'Watch the flight; the corner kick is yours to field.', 'If it goes over you, chase to the dead ball line.'],
  ['kickoff-receive', 3, 24, 88, 'Field the ball and go forward; the corner is your launch pad.', 'If the catch is contested, take it at the highest point.'],
  ['kickoff-receive', 4, 23, 84, 'Support the counter wide; the edge is on from the catch.', 'If the exit is on, hold width for the kick.'],
  ['kickoff-receive', 5, 28, 82, 'Drop into the wide triangle with 15.', 'If the chase is on, hold the corner.'],
  // kickoff-chase
  ['kickoff-chase', 1, 48, 74, 'Stand in the chase line, wide right, aiming at their left wing.', 'If the restart is short, hold and defend the return.'],
  ['kickoff-chase', 2, 49, 76, 'Sprint your lane; the chase leader sets the line speed.', 'If they catch, make the tackle or force the pass.'],
  ['kickoff-chase', 3, 45, 78, 'Pressure their receiver; force the mistake or the kick.', 'If they kick, take the high ball.'],
  ['kickoff-chase', 4, 42, 76, 'Reset the wide line for their first phase.', 'If they spread, hold the corner.'],
  ['kickoff-chase', 5, 44, 74, 'Organise the wide chase by voice.', 'If we win it, swing wide.'],
  // exit-box-kick
  ['exit-box-kick', 1, 12, 74, 'Hold the wide right channel at 10m depth — the exit release wide.', 'If the nine boxes, chase your lane hard.'],
  ['exit-box-kick', 2, 12, 76, 'Call for the wide ball if the pocket is pressured.', 'If the box is clean, sprint the chase lane.'],
  ['exit-box-kick', 3, 14, 78, 'If it comes to you, kick to the corner or run it back.', 'If the chase is set, take the tackle.'],
  ['exit-box-kick', 4, 18, 76, 'Chase the box kick; the contest is yours to win.', 'If they run it back, make the wide tackle.'],
  ['exit-box-kick', 5, 24, 74, 'Reset the wide line; their exit is our possession.', 'If they kick back, field and counter.'],
  // counter-deep
  ['counter-deep', 1, 16, 74, 'Sweep across at the widest depth — the counter\'s finisher.', 'If the counter goes inside, trail at 15m.'],
  ['counter-deep', 2, 19, 77, 'Take the ball at pace with the corner in mind.', 'If the cover slides, cut back inside.'],
  ['counter-deep', 3, 24, 80, 'Beat the first chaser, then race for the corner.', 'If the corner closes, look inside for support.'],
  ['counter-deep', 4, 30, 78, 'Support at the hip; gas to the line.', 'If the ruck forms, clean out.'],
  ['counter-deep', 5, 36, 75, 'Reset wide in their half.', 'If slow, hold depth and wait.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 74, 'Hold the wide channel flat — the corner is the red zone\'s pressure valve.', 'If the forwards drive, hold width and be patient.'],
  ['red-zone-22', 2, 81.5, 77, 'Run the arcing line at the drifting defence.', 'If they blitz, cut back inside.'],
  ['red-zone-22', 3, 83, 81, 'Take the flat ball and dive for the corner.', 'If covered, look inside for the offload.'],
  ['red-zone-22', 4, 84.5, 84, 'FINISH — use the corner flag, ground it one-handed if you must.', 'If tackled into touch, the drive resets.'],
  ['red-zone-22', 5, 85, 78, 'Reset wide for the next phase.', 'If 13 finishes, trail behind him.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 78, 'Hold the right corner on our line, packed in at the pylon.', 'If they spread, slide out along the line.'],
  ['goal-line-def', 2, 3.5, 80, 'No retreat: hit the catcher before he can leap.', 'If they pass, shuffle out, never inward.'],
  ['goal-line-def', 3, 3, 82, 'The corner tackle: low, into touch, ball-free.', 'If he reaches, hold him up.'],
  ['goal-line-def', 4, 3.5, 80, 'Reset the corner fast — they will come back.', 'If slow ball, guard the blind channel.'],
  ['goal-line-def', 5, 4, 78, 'Call the corner structure; the corner is yours and the line\'s.', 'If outnumbered, hold the inside shoulder.'],
  // att-maul
  ['att-maul', 1, 90, 84, 'Hold width and depth — the maul\'s long-ball option.', 'If the maul drives, hold onside and stay ready.'],
  ['att-maul', 2, 91, 86, 'Watch the ten\'s eyes; the cross-field kick is live at any beat.', 'If it stays tight, hold your channel.'],
  ['att-maul', 3, 93, 84, 'Take the cross-field ball at the highest point or the wide release.', 'If covered, tap it back to 15.'],
  ['att-maul', 4, 95, 80, 'If it comes wide, finish in the corner.', 'If tackled, present long.'],
  ['att-maul', 5, 96, 84, 'Reset wide for the goal-line phase.', 'If the forwards go again, hold.'],
  // turnover-att
  ['turnover-att', 1, 33, 76, 'Sprint wide — the broken field is the wing\'s race to win.', 'If the ball stays inside, trail at the widest depth.'],
  ['turnover-att', 2, 36, 78, 'Call WIDE; the counter goes where they are not.', 'If their chase sets, hold and support.'],
  ['turnover-att', 3, 41, 80, 'Run the support line outside the carrier, ready for the pass.', 'If it slows, come in and be the link.'],
  ['turnover-att', 4, 46, 82, 'Back your pace; the finisher finishes counters.', 'If the ruck forms, clean out.'],
  ['turnover-att', 5, 50, 78, 'Reset wide in their half.', 'If the defence resets, hold depth.'],
  // turnover-def
  ['turnover-def', 1, 60, 80, 'Turn and sprint; the corner is the counter\'s first target.', 'If their runner is wide of you, run the arc.'],
  ['turnover-def', 2, 56, 82, 'Cover the space outside you; never let the ball outside your man.', 'If the ball comes wide, shuffle and hold.'],
  ['turnover-def', 3, 50, 84, 'Make the covering tackle or force him to the corner flag.', 'If beaten, chase to the line.'],
  ['turnover-def', 4, 44, 82, 'Reset the wide line.', 'If the ball is loose, be first to it.'],
  ['turnover-def', 5, 40, 80, 'Reorganise the edge by voice.', 'If short, drift to the touchline.'],
  // tap-pen
  ['tap-pen', 1, 69, 68, 'Hold flat and wide of the mark — the strike finisher.', 'If the tap goes forward, hold depth.'],
  ['tap-pen', 2, 70.5, 70, 'Watch their edge; call for it if the corner is broken.', 'If they retreat, hold the wide lane.'],
  ['tap-pen', 3, 72, 72, 'Take the ball at the line and attack the wide shoulder.', 'If they rush, cut back inside.'],
  ['tap-pen', 4, 74, 74, 'Break, or give and go for the return pass.', 'If covered, take the tackle.'],
  ['tap-pen', 5, 75, 71, 'Reset the wide attack at the gain line.', 'If slow, hold and organise.'],
  // pen-goal
  ['pen-goal', 1, 72, 72, 'Stand behind the ball wide right, ready for the restart.', 'If short, chase the bounce.'],
  ['pen-goal', 2, 72, 72, 'Watch the flight; the wide restart is your slot.', 'If it misses, defend first.'],
  ['pen-goal', 3, 60, 74, 'Jog back to halfway, setting the wide restart shape.', 'If they run it back, make the wide tackle.'],
  ['pen-goal', 4, 52, 76, 'Take the wide slot in the receive shape.', 'If short, advance and field.'],
  ['pen-goal', 5, 45, 78, 'Hold the wide channel, eyes on their runners.', 'If we win it, swing wide.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 74, 'Hold the wide right lane on the 10m line.', 'If the kick is short, advance and take it.'],
  ['drop-out-22', 2, 24, 76, 'Call the wide return: run or kick to the corner.', 'If their chase sets, kick long.'],
  ['drop-out-22', 3, 28, 78, 'Take the ball going forward, attack the scattered chase.', 'If nothing is on, kick and chase.'],
  ['drop-out-22', 4, 32, 76, 'Support the break; gas to the corner.', 'If the ruck forms, clean.'],
  ['drop-out-22', 5, 34, 74, 'Reset wide in their half.', 'If they kick back, field and go.'],
  // wide-edge
  ['wide-edge', 1, 57, 84, 'THE WIDEST MAN: hold the channel at pace-ready depth, 10m from touch.', 'If 13 comes outside you, arc behind him.'],
  ['wide-edge', 2, 58, 86, 'Time the run; stay onside, stay hungry.', 'If the ball slows, hold your width.'],
  ['wide-edge', 3, 60, 88, 'Take the ball at full pace with the corner in mind.', 'If the corner shuts, chip and chase.'],
  ['wide-edge', 4, 62, 90, 'FINISH — beat the last man, use the flag, ground it.', 'If tackled, present long.'],
  ['wide-edge', 5, 62, 84, 'Reload; the finisher never stops.', 'If the ball comes back, be there.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 74, 'Sprint across as the last line wide; the corner is yours to save.', 'If he is inside you, cut the angle.'],
  ['broken-field-def', 2, 38, 76, 'Run the line to the corner flag, never the man.', 'If he cuts back, brake and hold.'],
  ['broken-field-def', 3, 33, 78, 'Make the covering tackle or force him to touch.', 'If beaten, chase to the line.'],
  ['broken-field-def', 4, 30, 76, 'Reset the edge; the save is only half the job.', 'If the ruck forms, hold the corner.'],
  ['broken-field-def', 5, 28, 74, 'Reorganise the wide defence by voice.', 'If outnumbered, drift to the flag.'],
];

export default expand(14, t);
