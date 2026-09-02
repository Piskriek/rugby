import { expand, PointTuple } from './types';

// 12 — INSIDE CENTRE (100 points)
// The crash ball off the ten, the defensive director of the midfield, the
// second playmaker when the ten is swallowed.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 40, 55, 'Stand at first-receiver depth outside the ten, 10m behind the scrum.', 'If a set play has you starting wide, hold the call position instead.'],
  ['own-scrum-mid', 2, 41, 57, 'Read their 12: blitz, drift or hold — your line answers his.', 'If their 12 shoots, call the change to the ten early.'],
  ['own-scrum-mid', 3, 43, 60, 'Take the flat ball at the gain line and fix their 12 hard.', 'If the ten is under pressure, become the first receiver yourself.'],
  ['own-scrum-mid', 4, 45, 63, 'Give the tip pass to 13 running the seam, or crash and set the ruck.', 'If 13 is covered, take the tackle and present long.'],
  ['own-scrum-mid', 5, 48, 58, 'Reset at second-receiver depth for phase two.', 'If the ten is flat, stand out the back as the second playmaker.'],
  // def-scrum-22
  ['def-scrum-22', 1, 15, 55, 'Mark their 12 in the line — you are the director of the midfield defence.', 'If their 10 stands very deep, call the rush up on the 12 instead.'],
  ['def-scrum-22', 2, 15.5, 57, 'Hold the line shape; do not shoot until the ball leaves the nine.', 'If they box kick, drop and cover the midfield kick space.'],
  ['def-scrum-22', 3, 17, 58, 'Tackle their 12 hard and low, stop the offload, kill the momentum.', 'If 13 shoots outside you, cover his inside shoulder.'],
  ['def-scrum-22', 4, 13, 56, 'Reset the midfield line by voice — the shape lives or dies with you.', 'If we win it, swing into first receiver and clear.'],
  ['def-scrum-22', 5, 18, 55, 'Hold the 12 channel, connected to 10 inside and 13 outside.', 'If they go wide fast, drift and hold the outside shoulder.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 91, 30, 'Stand at first-receiver depth behind the ten, ready for the maul outlet.', 'If the call is a strike play, hold the called slot however wide.'],
  ['own-lineout-att-5', 2, 92, 33, 'Watch the maul: if it stalls you are the release valve.', 'If the maul drives, hold your depth and stay onside.'],
  ['own-lineout-att-5', 3, 93, 36, 'Take the flat release at the gain line, fix the guard and go again.', 'If the guard bites, tip to 13 behind you.'],
  ['own-lineout-att-5', 4, 94, 40, 'Carry into the 13 channel or release the wide shift.', 'If the short side opens, take the blind line yourself.'],
  ['own-lineout-att-5', 5, 95, 42, 'Reset at 8m depth for the goal-line phases; the shape stays flat here.', 'If 10 has first receiver, stand second out the back.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 48, 72, 'Stand in the line at 12 depth, marking their strike runner.', 'If they overload midfield, call 13 in one channel.'],
  ['def-lineout-mid', 2, 48, 74, 'Advance with the unit on their catch; stay square, do not bite.', 'If they go off the top, push up on their 10 fast.'],
  ['def-lineout-mid', 3, 47, 76, 'Tackle the first receiver hard, or the 12 crashing.', 'If they kick, turn and cover the midfield space.'],
  ['def-lineout-mid', 4, 44, 72, 'Reset the line and organise the chase for their clearance kick.', 'If we win it, get to first receiver and exit.'],
  ['def-lineout-mid', 5, 43, 68, 'Hold the 12 channel for their phase two.', 'If they shift wide, drift, never dog-leg.'],
  // att-phase-mid
  ['att-phase-mid', 1, 48, 58, 'First or second receiver: 8m deep, outside the ten, hands up.', 'If the ten takes it flat, run the hard line off his shoulder.'],
  ['att-phase-mid', 2, 49, 60, 'Read the guard: bite means pass, hold means crash.', 'If the guard shoots, tip pass behind him to 13.'],
  ['att-phase-mid', 3, 51, 62, 'Crash at the 10-12 seam, or take the ball to the line and release.', 'If the space is outside, give the early ball and keep working.'],
  ['att-phase-mid', 4, 53, 64, 'After the pass, keep running the support line — the offload comes back inside.', 'If the tackle is made, arrive at the ruck as the cleaner.'],
  ['att-phase-mid', 5, 53, 58, 'Reload at depth on the opposite side; the midfield never rests.', 'If the ten swings across, fill his spot inside.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 58, 'You own the 12 channel — the director of the outside defence.', 'If their shape splits, mark the wider of the two runners.'],
  ['def-line-mid', 2, 44, 60, 'Call UP, DRIFT or SHOOT before every ball; the wing obeys you.', 'If they kick, drop and field with the back three.'],
  ['def-line-mid', 3, 43, 62, 'Make the dominant tackle in your channel; no offload, no metres.', 'If your inside man shoots, cover his shoulder immediately.'],
  ['def-line-mid', 4, 42, 60, 'Reset the line fast — you are never at the ruck, you are the line.', 'If we turn it over, swing to first receiver immediately.'],
  ['def-line-mid', 5, 43, 56, 'Fold with the ball and keep the midfield connected to the ten.', 'If numbers are short, call the drift and use the touchline.'],
  // kickoff-receive
  ['kickoff-receive', 1, 26, 58, 'Stand at 22m depth in the midfield slot behind the forwards.', 'If the kick is short, advance into the second pod.'],
  ['kickoff-receive', 2, 25, 56, 'Call the midfield coverage; watch the flight, not the chase.', 'If the ball goes over you, turn and cover the deep ball.'],
  ['kickoff-receive', 3, 24, 55, 'Field the kick or the bounce, then go forward immediately.', 'If the catch is made, be the first pass option for the exit.'],
  ['kickoff-receive', 4, 23, 54, 'Support the exit: take the pass and kick long or to touch.', 'If we run it back, lead the midfield counter.'],
  ['kickoff-receive', 5, 28, 55, 'Drop into the backfield triangle as the second sweeper.', 'If the chase is on, hold 15m as the link.'],
  // kickoff-chase
  ['kickoff-chase', 1, 48, 55, 'Stand in the chase line at midfield, ready to defend their exit.', 'If the restart is short, hold the 10m line as the receiver guard.'],
  ['kickoff-chase', 2, 49, 53, 'Advance connected with the ten inside and 13 outside.', 'If they catch and run, make the midfield tackle.'],
  ['kickoff-chase', 3, 45, 52, 'Cut the return line off; shepherd them to the chasing pack.', 'If they kick back, take the midfield ball.'],
  ['kickoff-chase', 4, 42, 53, 'Reset the midfield line for their first phase.', 'If they spread, hold the 12 channel.'],
  ['kickoff-chase', 5, 44, 55, 'Organise the defence by voice; you are the midfield\'s eyes.', 'If we win it, be the first receiver.'],
  // exit-box-kick
  ['exit-box-kick', 1, 12, 55, 'Stand flat at 5m depth as the second exit option beside the nine.', 'If the nine is boxing, hold the pass lane and be ready for the snipe pass.'],
  ['exit-box-kick', 2, 12, 57, 'Call BOX or BALL; make the decision easy for the nine.', 'If pressure comes, call for the pass and kick it yourself.'],
  ['exit-box-kick', 3, 14, 58, 'If the ball comes to you, kick long to touch beyond the 22.', 'If the chase is set, run it back one phase then kick.'],
  ['exit-box-kick', 4, 18, 56, 'Chase your kick or the box; arrive at the contest legally.', 'If they run it back, make the midfield tackle.'],
  ['exit-box-kick', 5, 24, 55, 'Reset the midfield line; their exit is our possession.', 'If they kick back, field it and counter.'],
  // counter-deep
  ['counter-deep', 1, 16, 57, 'Come across to the ball at 10m depth — the first link in the counter.', 'If 10 links instead, hold wider and wait for the second pass.'],
  ['counter-deep', 2, 19, 60, 'Take the ball at pace, commit their chaser, then release.', 'If the space is on, go yourself and back your pace.'],
  ['counter-deep', 3, 24, 63, 'Give the scoring pass or take it into their half.', 'If covered, kick long and chase.'],
  ['counter-deep', 4, 30, 60, 'Support the break at the hip; the offload is coming.', 'If the ruck forms, be the cleaner.'],
  ['counter-deep', 5, 36, 58, 'Reset the attack shape in their half — first receiver.', 'If the ten takes it, hold second receiver.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 56, 'Stand flat outside the pod — the crash option one pass wider.', 'If the forwards drive, hold wide and be patient.'],
  ['red-zone-22', 2, 81.5, 58, 'Run the hard line at the guard\'s outside shoulder.', 'If the guard holds, take the tackle and set the ruck.'],
  ['red-zone-22', 3, 83, 60, 'Take the flat ball and drive for the line; offload out of the tackle if it is on.', 'If held, present long towards your posts.'],
  ['red-zone-22', 4, 84, 58, 'Reset flat — the red-zone backline stays narrow and fast.', 'If slow ball, hold depth and reassess.'],
  ['red-zone-22', 5, 85, 56, 'Be the second receiver for the next phase, flat and hungry.', 'If 10 takes it, run the decoy line hard.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 55, 'Hold the 12 channel on our line, packed in with the forwards.', 'If they spread, spread with them along the line.'],
  ['goal-line-def', 2, 3.5, 57, 'No retreat: hit the carrier before he builds a head of steam.', 'If they pass wide, shuffle along the line, never inward.'],
  ['goal-line-def', 3, 3, 59, 'Make the dominant hit; hold him up if the ball is loose.', 'If second man in, strip the ball legally.'],
  ['goal-line-def', 4, 3.5, 57, 'Reset the spread line fast — they will go wide quickly.', 'If the ball is slow, guard the blindside channel.'],
  ['goal-line-def', 5, 4, 55, 'Call the midfield structure; the corners belong to the wings.', 'If outnumbered, hold the inside shoulder and trust the cover.'],
  // att-maul
  ['att-maul', 1, 90, 32, 'Stand at 10m depth as the maul outlet — the release valve.', 'If the maul drives well, hold your depth and stay ready.'],
  ['att-maul', 2, 91, 34, 'Watch the stall; when it comes you get the ball immediately.', 'If the maul keeps moving, hold and do not crowd it.'],
  ['att-maul', 3, 93, 36, 'Take the release flat and hit the guard\'s outside shoulder.', 'If the guard is set, give to 13 behind you.'],
  ['att-maul', 4, 95, 38, 'In the tight zone, carry or offload — one phase, then the wide game.', 'If tackled, present long.'],
  ['att-maul', 5, 95.5, 40, 'Reset the flat backline for the goal-line phase.', 'If the forwards go again, hold your shape.'],
  // turnover-att
  ['turnover-att', 1, 33, 52, 'Sprint to the first receiver slot — the counter needs a decision-maker.', 'If 10 is there, take second receiver outside him.'],
  ['turnover-att', 2, 36, 55, 'Call the shape against the broken field: WIDE or GO.', 'If their chase is set, take contact and keep it.'],
  ['turnover-att', 3, 41, 58, 'Move the ball early; broken fields die with hesitancy.', 'If it slows, carry hard and set the ruck.'],
  ['turnover-att', 4, 46, 60, 'Support at the hip; the offload keeps the counter alive.', 'If the ruck forms, clear the first body.'],
  ['turnover-att', 5, 50, 57, 'Reset the attack shape and keep the tempo on.', 'If the defence resets, kick into the space behind.'],
  // turnover-def
  ['turnover-def', 1, 60, 55, 'Turn and sprint — the midfield is the counter\'s first casualty.', 'If their runner is in your channel, make the tackle.'],
  ['turnover-def', 2, 56, 57, 'Cover the space inside your wing; the cover defence starts here.', 'If the ball moves wide, shuffle out and hold.'],
  ['turnover-def', 3, 50, 58, 'Make the covering tackle or force the pass.', 'If they beat you, turn and chase.'],
  ['turnover-def', 4, 44, 56, 'Reset the midfield line and slow their recycle.', 'If the ball is loose, be first to it.'],
  ['turnover-def', 5, 40, 54, 'Organise the line by voice; the scramble ends with order.', 'If we are short, drift and use the touchline.'],
  // tap-pen
  ['tap-pen', 1, 69, 42, 'Stand flat five metres wide of the mark — the second receiver of the tap.', 'If the tap goes forward, hold your depth.'],
  ['tap-pen', 2, 70.5, 44, 'Watch their retreat; the flat call is yours to make.', 'If they have not retreated, call the carry.'],
  ['tap-pen', 3, 72, 46, 'Take the ball at the line and commit the retreating defence.', 'If they rush up, kick behind them.'],
  ['tap-pen', 4, 74, 48, 'Release wide or take the tackle and set the ruck on the front foot.', 'If covered, hold and reset.'],
  ['tap-pen', 5, 75, 45, 'Reset the attack at the gain line — the tap is a gift of metres.', 'If slow, hold depth and organise.'],
  // pen-goal
  ['pen-goal', 1, 72, 52, 'Stand well behind the ball, ready for the restart call.', 'If the kick is short, be first to the bounce.'],
  ['pen-goal', 2, 72, 52, 'Watch the flight; call LEFT or RIGHT for the restart.', 'If it misses, defend the counter first.'],
  ['pen-goal', 3, 60, 53, 'Jog back to halfway and set the restart shape.', 'If they run the restart back, make the midfield tackle.'],
  ['pen-goal', 4, 52, 55, 'Take the midfield slot in the kick-off receive shape.', 'If the kick is short, advance and field.'],
  ['pen-goal', 5, 45, 56, 'Hold the 12 channel, eyes on their runners.', 'If we win it, first receiver immediately.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 52, 'Hold the 10m line at midfield — the drop-out\'s first receiver.', 'If the kick is short, advance and take it.'],
  ['drop-out-22', 2, 24, 54, 'Call the return: run it back or kick to the corner.', 'If their chase is set, kick long.'],
  ['drop-out-22', 3, 28, 55, 'Take the ball going forward; the 22 restart is an attack gift.', 'If nothing is on, kick and chase.'],
  ['drop-out-22', 4, 32, 53, 'Support the break; the defence is scattered after a drop-out.', 'If the ruck forms, be the cleaner.'],
  ['drop-out-22', 5, 34, 51, 'Reset the attack shape in their half.', 'If they kick back, field and go again.'],
  // wide-edge
  ['wide-edge', 1, 57, 64, 'Hold the wide channel at 12 depth — the link between pod and edge.', 'If 13 is in your channel, go one wider.'],
  ['wide-edge', 2, 58, 67, 'Run the hard supporting line inside 13; never crowd his space.', 'If 13 is covered, call for the switch.'],
  ['wide-edge', 3, 60, 70, 'Take the ball at pace into the scrambling defence.', 'If the edge is shut, cut back inside.'],
  ['wide-edge', 4, 62, 72, 'Support the break; the cover is coming across.', 'If the tackle is made, clean out.'],
  ['wide-edge', 5, 62, 65, 'Reload at depth on the opposite side of the field.', 'If the ball comes back, be first receiver.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 63, 'You are the cover: sprint across to the inside of their runner.', 'If he is in your channel, make the tackle yourself.'],
  ['broken-field-def', 2, 38, 60, 'Never look at the ball — run the line to the space he wants.', 'If he cuts back, brake and cover inside.'],
  ['broken-field-def', 3, 33, 58, 'Make the covering tackle or force the pass early.', 'If he beats you, chase your own miss.'],
  ['broken-field-def', 4, 30, 56, 'Reset the line; the scramble is over when the shape returns.', 'If the ruck forms, hold the midfield.'],
  ['broken-field-def', 5, 28, 54, 'Reorganise by voice; count the shirts and fill the gaps.', 'If outnumbered, drift and use the touchline.'],
];

export default expand(12, t);
