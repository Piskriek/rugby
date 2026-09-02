import { expand, PointTuple } from './types';

// 13 — OUTSIDE CENTRE (100 points)
// The strike runner of the wide game, the drift captain of the wide defence,
// the chase leader on every kick.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 40, 62, 'Stand outside 12 at second-receiver depth, 12m behind the scrum.', 'If a pod call is on, hold wide and stay out of the forwards\' lane.'],
  ['own-scrum-mid', 2, 41, 64, 'Watch their 13: his line speed is your instruction.', 'If their 13 hangs, call for the ball early.'],
  ['own-scrum-mid', 3, 43, 67, 'Run the seam off 12\'s shoulder, or swing wide if the edge is on.', 'If the ten takes it flat, run the overs line hard.'],
  ['own-scrum-mid', 4, 45, 70, 'Take the space; beat the first man or give the finishing pass.', 'If the edge is shut, cut back against the grain.'],
  ['own-scrum-mid', 5, 48, 64, 'Reset wide for phase two; the edge is a standing threat.', 'If 12 is wide, come in one and take his channel.'],
  // def-scrum-22
  ['def-scrum-22', 1, 15, 62, 'Mark their 13 in the line, outside their 12, connected to your wing.', 'If their 13 roams, follow and call the change to the wing.'],
  ['def-scrum-22', 2, 15.5, 64, 'Hold the drift shape until the ball is passed; do not guess.', 'If they kick early, turn and cover the wide kick space.'],
  ['def-scrum-22', 3, 17, 66, 'Tackle their 13 into touch or make the dominant hit in the channel.', 'If your wing shoots, cover his inside shoulder immediately.'],
  ['def-scrum-22', 4, 13, 64, 'Reset the wide line; the edge must never dog-leg.', 'If we win it, swing wide and counter.'],
  ['def-scrum-22', 5, 18, 62, 'Hold the 13 channel, talking to 12 in and 14 out.', 'If they go narrow, tighten one and blitz.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 91, 38, 'Stand wide of the ten at strike depth — the lineout\'s wide threat.', 'If the call is the maul, hold 15m out and stay onside.'],
  ['own-lineout-att-5', 2, 92, 40, 'Watch the maul; when it stalls the ball comes to you fast.', 'If the maul drives, hold your width and be patient.'],
  ['own-lineout-att-5', 3, 93, 43, 'Take the ball at pace and attack the fringe defence.', 'If the fringe is set, give the long ball to the wing outside.'],
  ['own-lineout-att-5', 4, 94, 46, 'Break or give the finishing pass; the red zone is your office.', 'If covered, take the tackle and present.'],
  ['own-lineout-att-5', 5, 95, 44, 'Reset flat and wide for the goal-line phases.', 'If the forwards drive again, hold your shape.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 48, 76, 'Stand outside their 12, marking their 13 channel.', 'If they split wide, follow out and call the wing up.'],
  ['def-lineout-mid', 2, 48, 78, 'Advance square on their catch; keep the line connected.', 'If they go off the top wide, push up fast.'],
  ['def-lineout-mid', 3, 47, 80, 'Tackle their strike runner behind the gain line if you can.', 'If they kick, turn and cover the corner.'],
  ['def-lineout-mid', 4, 44, 76, 'Reset the wide line for their phase two.', 'If we win it, be the wide counter option.'],
  ['def-lineout-mid', 5, 43, 72, 'Hold the drift or blitz call from 12; the edge obeys the call.', 'If they go narrow, tighten and shoot.'],
  // att-phase-mid
  ['att-phase-mid', 1, 48, 62, 'Stand at second-receiver depth, outside 12, at the pod\'s edge.', 'If 12 is the playmaker, slide one wider still.'],
  ['att-phase-mid', 2, 49, 64, 'Read the drift: if it slides, cut back; if it bites, go around.', 'If they blitz, run the unders line back inside.'],
  ['att-phase-mid', 3, 51, 67, 'Take the ball at pace and attack the 13 channel.', 'If the pass is behind, adjust and still go forward.'],
  ['att-phase-mid', 4, 53, 70, 'Beat the first tackle or give the release to the wing.', 'If the wing is covered, chip and chase.'],
  ['att-phase-mid', 5, 53, 64, 'Reload wide on the other side of the ball.', 'If the attack comes back, be there at second receiver.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 62, 'You own the 13 channel and captain the wide drift.', 'If their shape narrows, tighten one channel inside.'],
  ['def-line-mid', 2, 44, 64, 'Call the drift line; the wing times his shot off your call.', 'If they kick, turn and cover the corner with 15.'],
  ['def-line-mid', 3, 43, 66, 'Make the tackle in your channel; never let the outside man go free.', 'If your inside bites, slide and cover him.'],
  ['def-line-mid', 4, 42, 64, 'Reset the wide line — you are the line, not the ruck.', 'If we turn it over, swing wide immediately.'],
  ['def-line-mid', 5, 43, 60, 'Fold with the ball, connected to 12 and 14.', 'If numbers are short, drift to the touchline.'],
  // kickoff-receive
  ['kickoff-receive', 1, 26, 62, 'Hold the midfield-wide slot at 22m depth.', 'If the kick is short, advance into the second pod.'],
  ['kickoff-receive', 2, 25, 60, 'Watch the flight; the wide midfield covers the hanging ball.', 'If it goes over you, turn and cover deep.'],
  ['kickoff-receive', 3, 24, 59, 'Field it and go forward; the counter starts with pace.', 'If the catch is made, loop and support the break.'],
  ['kickoff-receive', 4, 23, 60, 'Take the wide support line off the counter.', 'If the exit is on, hold width for the kick pass.'],
  ['kickoff-receive', 5, 28, 61, 'Drop into the backfield, wide triangle.', 'If the chase is on, hold 15m as the link.'],
  // kickoff-chase
  ['kickoff-chase', 1, 48, 58, 'Chase line outside the ten, aiming at their second receiver.', 'If the restart is short, hold and defend the return.'],
  ['kickoff-chase', 2, 49, 60, 'Advance connected; the wide chase arrives together or not at all.', 'If they catch cleanly, set the line at 10m.'],
  ['kickoff-chase', 3, 45, 61, 'Cut down their exit runner; force the kick.', 'If they kick, take the high ball.'],
  ['kickoff-chase', 4, 42, 60, 'Reset the wide line for their first phase.', 'If they spread, hold the 13 channel.'],
  ['kickoff-chase', 5, 44, 58, 'Organise the wide defence by voice.', 'If we win it, swing wide and counter.'],
  // exit-box-kick
  ['exit-box-kick', 1, 12, 58, 'Stand at 10m depth outside 10 — the second exit option wide.', 'If the nine boxes, hold and defend the return.'],
  ['exit-box-kick', 2, 12, 60, 'Call the chase: left, right or through the middle.', 'If pressure comes, loop behind for the desperate pass.'],
  ['exit-box-kick', 3, 14, 61, 'If the ball comes wide, kick to the corner and chase hard.', 'If the chase is set, take the tackle and hold the ball.'],
  ['exit-box-kick', 4, 18, 59, 'Chase your kick; the contest is yours to win.', 'If they run it back, make the wide tackle.'],
  ['exit-box-kick', 5, 24, 58, 'Reset the wide line; their exit is our possession.', 'If they kick back, field and counter wide.'],
  // counter-deep
  ['counter-deep', 1, 16, 60, 'Sweep across at 12m depth — the wide link of the counter.', 'If the counter goes inside, hold width for the second pass.'],
  ['counter-deep', 2, 19, 63, 'Take the ball at pace and attack the scattered chase.', 'If covered, give to the wing outside.'],
  ['counter-deep', 3, 24, 66, 'Beat the first chaser or give the scoring pass.', 'If the cover arrives, kick ahead and chase.'],
  ['counter-deep', 4, 30, 64, 'Support at the hip; back your gas to the line.', 'If the ruck forms, be the cleaner.'],
  ['counter-deep', 5, 36, 61, 'Reset wide in their half — the counter\'s finisher.', 'If slow, hold depth and organise.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 60, 'Stand flat outside 12 — the strike runner one pass wider.', 'If the forwards drive, hold width and be patient.'],
  ['red-zone-22', 2, 81.5, 62, 'Run the hard unders line at the guard\'s outside shoulder.', 'If the guard shoots, take the flat ball behind him.'],
  ['red-zone-22', 3, 83, 64, 'Take the ball and reach for the line — or give the walk-in pass.', 'If covered, take the tackle and present.'],
  ['red-zone-22', 4, 84, 62, 'Reset flat; the red-zone backline stays narrow and fast.', 'If slow ball, hold depth.'],
  ['red-zone-22', 5, 85, 60, 'Second receiver again, flat, hungry.', 'If 12 takes it, run the decoy hard.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 60, 'Hold the 13 channel on our line, packed in tight.', 'If they spread, spread along the line.'],
  ['goal-line-def', 2, 3.5, 62, 'No retreat: hit the carrier before he jumps.', 'If they pass, shuffle out, never inward.'],
  ['goal-line-def', 3, 3, 64, 'The dominant hit; hold him up if the ball comes loose.', 'If second man in, go for the steal.'],
  ['goal-line-def', 4, 3.5, 62, 'Reset the spread line — the corner is where they will go.', 'If slow ball, guard the blind channel.'],
  ['goal-line-def', 5, 4, 60, 'Call the wide structure; the wings hold the corners.', 'If outnumbered, hold the inside shoulder.'],
  // att-maul
  ['att-maul', 1, 90, 36, 'Hold 10m depth and width — the maul\'s wide release.', 'If the maul drives, hold onside and stay ready.'],
  ['att-maul', 2, 91, 38, 'Watch for the PEEL call; the ball comes wide fast when it stalls.', 'If it keeps moving, hold your shape.'],
  ['att-maul', 3, 93, 40, 'Take the release at pace into the fringe.', 'If the fringe is set, give the long ball wide.'],
  ['att-maul', 4, 95, 42, 'In the tight zone, take the tackle or give the walk-in pass.', 'If tackled, present long.'],
  ['att-maul', 5, 95.5, 44, 'Reset the flat wide backline for the goal-line phase.', 'If the forwards go again, hold.'],
  // turnover-att
  ['turnover-att', 1, 33, 54, 'Sprint wide — the broken field is the centre\'s playground.', 'If the ball stays inside, trail at second receiver.'],
  ['turnover-att', 2, 36, 57, 'Call WIDE; the counter attack goes where they are not.', 'If their chase is set, take contact and keep it.'],
  ['turnover-att', 3, 41, 60, 'Move the ball early, one pass ahead of the cover.', 'If it slows, carry hard.'],
  ['turnover-att', 4, 46, 63, 'Support at the hip; the offload keeps it alive.', 'If the ruck forms, clean out.'],
  ['turnover-att', 5, 50, 60, 'Reset the shape and keep the tempo on.', 'If the defence resets, kick behind them.'],
  // turnover-def
  ['turnover-def', 1, 60, 60, 'Turn and sprint; the wide channels die first in the scramble.', 'If their runner is in your channel, make the tackle.'],
  ['turnover-def', 2, 56, 62, 'Cover the space inside your wing.', 'If the ball moves wide, shuffle out.'],
  ['turnover-def', 3, 50, 63, 'Make the covering tackle or force the early pass.', 'If beaten, chase your own miss.'],
  ['turnover-def', 4, 44, 61, 'Reset the wide line and slow their recycle.', 'If the ball is loose, be first to it.'],
  ['turnover-def', 5, 40, 59, 'Reorganise the wide defence by voice.', 'If short, drift to touch.'],
  // tap-pen
  ['tap-pen', 1, 69, 44, 'Stand flat and wide of the mark — the strike option.', 'If the tap goes forward, hold depth.'],
  ['tap-pen', 2, 70.5, 46, 'Watch their line; call the strike if the edge is broken.', 'If they retreat, call for the flat ball.'],
  ['tap-pen', 3, 72, 48, 'Take the ball at the line and attack the disorganised edge.', 'If they rush, kick behind them.'],
  ['tap-pen', 4, 74, 50, 'Break or give the finishing pass.', 'If covered, take the tackle.'],
  ['tap-pen', 5, 75, 47, 'Reset the wide attack at the gain line.', 'If slow, hold and organise.'],
  // pen-goal
  ['pen-goal', 1, 72, 54, 'Stand behind the ball, ready for the restart shape.', 'If short, chase the bounce.'],
  ['pen-goal', 2, 72, 54, 'Watch the flight; call the restart LEFT or RIGHT.', 'If it misses, defend first.'],
  ['pen-goal', 3, 60, 55, 'Jog back to halfway, setting the wide restart shape.', 'If they run it back, make the wide tackle.'],
  ['pen-goal', 4, 52, 57, 'Take the wide midfield slot in the receive shape.', 'If short, advance and field.'],
  ['pen-goal', 5, 45, 58, 'Hold the 13 channel, eyes on their runners.', 'If we win it, swing wide.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 54, 'Hold the 10m line wide — the drop-out\'s strike option.', 'If the kick is short, advance and take it.'],
  ['drop-out-22', 2, 24, 56, 'Call the wide return: run or kick to the corner.', 'If their chase sets, kick long.'],
  ['drop-out-22', 3, 28, 57, 'Take the ball going forward, attack the scattered chase.', 'If nothing is on, kick and chase.'],
  ['drop-out-22', 4, 32, 55, 'Support the break at the hip.', 'If the ruck forms, clean.'],
  ['drop-out-22', 5, 34, 53, 'Reset wide in their half.', 'If they kick back, field and go.'],
  // wide-edge
  ['wide-edge', 1, 57, 68, 'THE EDGE IS YOURS: hold the widest channel at pace-ready depth.', 'If 14 is called into the line, come in one and cover his spot.'],
  ['wide-edge', 2, 58, 71, 'Run the overs line at the drifting defence.', 'If they blitz, cut back unders.'],
  ['wide-edge', 3, 60, 74, 'Take the ball at full pace, beat the last defender.', 'If the corner is shut, chip and chase.'],
  ['wide-edge', 4, 62, 77, 'Finish it, or give the walk-in pass to the wing.', 'If tackled, present long.'],
  ['wide-edge', 5, 62, 70, 'Reload; the edge resets faster than the defence slides.', 'If the ball comes back inside, support at second receiver.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 65, 'Sprint across as the wide cover; the corner is yours to save.', 'If he is in your channel, make the tackle.'],
  ['broken-field-def', 2, 38, 62, 'Run the line to the space he wants, never the man.', 'If he cuts back, brake and hold inside.'],
  ['broken-field-def', 3, 33, 60, 'Make the covering tackle or force him to the touchline.', 'If beaten, chase your own miss.'],
  ['broken-field-def', 4, 30, 58, 'Reset the wide line; the save is only half the job.', 'If the ruck forms, hold the edge.'],
  ['broken-field-def', 5, 28, 56, 'Reorganise the wide defence by voice.', 'If outnumbered, drift to touch.'],
];

export default expand(13, t);
