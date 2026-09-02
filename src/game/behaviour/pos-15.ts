import { expand, PointTuple } from './types';

// 15 — FULL BACK (100 points)
// The last line: the high ball is his, the counter-attack starts with him,
// the backfield is organised by his voice.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 32, 50, 'Sweep at 22-25m depth behind the whole attack, centred on the ball.', 'If the play goes blind, shade across to that corner.'],
  ['own-scrum-mid', 2, 33, 52, 'Read their backfield: their 15 deep means kick pressure is low.', 'If they rush up, call KICK to the space behind.'],
  ['own-scrum-mid', 3, 36, 54, 'Join the line as the extra man or take the deep pass to counter.', 'If the line is set, hold depth and stay the sweeper.'],
  ['own-scrum-mid', 4, 40, 56, 'Support the wide break at the hip — the counter\'s second wave.', 'If the tackle is made, organise the next phase from depth.'],
  ['own-scrum-mid', 5, 42, 52, 'Reset the sweep behind the new shape; never be caught flat.', 'If we kick, chase the landing and cover the return.'],
  // def-scrum-22
  ['def-scrum-22', 1, 5, 50, 'Hold the deep pocket at 15-20m behind the line, centred on the posts.', 'If they have a wide shape, shade to the heavier side.'],
  ['def-scrum-22', 2, 5.5, 52, 'Watch their ten\'s hands and eyes; the kick is coming from there.', 'If they run, sprint up into the line at pace.'],
  ['def-scrum-22', 3, 7, 54, 'Field the kick, take the contact, or make the covering tackle.', 'If beaten, turn and chase; you are the last line.'],
  ['def-scrum-22', 4, 6, 48, 'Counter from deep: one pass, then go forward with purpose.', 'If the chase is set, kick it back over their heads.'],
  ['def-scrum-22', 5, 10, 50, 'Reset the backfield triangle and organise the wide cover.', 'If we win it, join the line as the extra man.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 78, 50, 'Sweep at 20m depth behind the lineout, ready for the turnover kick.', 'If their 15 rushes, hold deeper for the kick behind.'],
  ['own-lineout-att-5', 2, 80, 52, 'Watch their tail jumper for the steal — you are the insurance.', 'If they win it, make the covering tackle immediately.'],
  ['own-lineout-att-5', 3, 84, 54, 'Join the line wide if the maul releases; otherwise hold the sweep.', 'If the kick goes up, take the high ball.'],
  ['own-lineout-att-5', 4, 88, 56, 'Support the wide break; the full back arrives at pace from depth.', 'If the tackle is made, clean out.'],
  ['own-lineout-att-5', 5, 90, 52, 'Reset behind the goal-line shape; the corner kicks come now.', 'If we go wide, trail the play at 15m.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 38, 50, 'Hold the backfield at 20m depth, shading to their strong side.', 'If they set a cross-field kick, shade to that corner.'],
  ['def-lineout-mid', 2, 40, 52, 'Organise the back three by voice; you own the deep space.', 'If they run, hold until the ball is passed.'],
  ['def-lineout-mid', 3, 42, 54, 'Field the kick or make the last-ditch tackle.', 'If beaten, chase; never die wondering.'],
  ['def-lineout-mid', 4, 40, 48, 'Counter from deep with the first pass going forward.', 'If the chase is set, kick back long.'],
  ['def-lineout-mid', 5, 42, 50, 'Reset the backfield triangle and call the line up or back.', 'If we win it, join the line.'],
  // att-phase-mid
  ['att-phase-mid', 1, 38, 56, 'Sweep at 20m behind the line, shaded to the wide side.', 'If the attack goes the other way, cross over behind the ruck.'],
  ['att-phase-mid', 2, 40, 58, 'Watch their wings: the interception and the kick are your dangers.', 'If they rush, call KICK to the space.'],
  ['att-phase-mid', 3, 44, 60, 'Join the line as the extra man when the wide move needs one more.', 'If the move is on without you, trail at the hip.'],
  ['att-phase-mid', 4, 48, 62, 'Support the break; you are the counter\'s second wave.', 'If the tackle is made, arrive and clear.'],
  ['att-phase-mid', 5, 50, 58, 'Reset the sweep behind the new shape.', 'If we kick, cover the landing zone.'],
  // def-line-mid
  ['def-line-mid', 1, 28, 50, 'THE LAST LINE: hold at 18-20m depth, centred behind the ruck.', 'If their shape tilts, shade across behind it.'],
  ['def-line-mid', 2, 28, 52, 'Organise the back three; call UP or BACK before every ball.', 'If they chip, turn and sprint to the landing spot.'],
  ['def-line-mid', 3, 30, 54, 'Field the kick, make the cover tackle, or take the high ball at the peak.', 'If beaten, chase your own miss to the line.'],
  ['def-line-mid', 4, 28, 48, 'Counter from deep — the attack starts with you going forward.', 'If the chase is set, kick long and turn them.'],
  ['def-line-mid', 5, 30, 50, 'Reset the backfield; every phase starts with your organisation.', 'If we turn it over, join the line wide.'],
  // kickoff-receive
  ['kickoff-receive', 1, 16, 50, 'Deepest man on the field at 10m from our goal line, centred.', 'If the kick is short, call for it and advance.'],
  ['kickoff-receive', 2, 16, 52, 'Call MINE early for anything over the 15m line.', 'If you call yours, the pods stand down for you.'],
  ['kickoff-receive', 3, 18, 54, 'Take the catch at the peak, then go forward immediately.', 'If the chase arrives, take the contact and present.'],
  ['kickoff-receive', 4, 22, 52, 'Launch the counter: pass, run or kick — decide before you land.', 'If nothing is on, kick long to touch.'],
  ['kickoff-receive', 5, 26, 50, 'Reset into the sweep as the attack forms.', 'If we kick, chase and cover the return.'],
  // kickoff-chase
  ['kickoff-chase', 1, 32, 50, 'Sweep at 20m behind the chase, centred on the target zone.', 'If the restart is short, hold the 10m line as receiver.'],
  ['kickoff-chase', 2, 33, 48, 'Watch their catcher: the offload behind him is your kill.', 'If they take it clean, reset the backfield.'],
  ['kickoff-chase', 3, 36, 46, 'Take the loose ball or make the tackle on the return.', 'If they kick back, field it and counter.'],
  ['kickoff-chase', 4, 40, 48, 'Counter from the catch; you are the deepest attacker now.', 'If the chase is set, kick back and turn them.'],
  ['kickoff-chase', 5, 44, 50, 'Reset the backfield for their first phase.', 'If we win it, join the line.'],
  // exit-box-kick
  ['exit-box-kick', 1, 20, 50, 'Hold the deep cover behind the exit kick at 15m depth.', 'If the pocket is pressured, come up flat as the second receiver.'],
  ['exit-box-kick', 2, 20, 52, 'Organise the chase: who goes, who holds.', 'If the kick is charged down, fall on the ball.'],
  ['exit-box-kick', 3, 24, 54, 'Cover the return kick; their exit answer is your high ball.', 'If they run it back, make the cover tackle.'],
  ['exit-box-kick', 4, 28, 52, 'Counter from the fielded kick; go forward with the first pass.', 'If the chase is set, kick back long.'],
  ['exit-box-kick', 5, 32, 50, 'Reset the backfield as their attack forms.', 'If we win it, join the line wide.'],
  // counter-deep
  ['counter-deep', 1, 8, 50, 'The deep kick comes to YOU: call MINE early and loud.', 'If it is not yours, shepherd your catcher to the space.'],
  ['counter-deep', 2, 10, 52, 'Catch at the peak, land going forward, and GO.', 'If the chase is on you, beat the first man or kick.'],
  ['counter-deep', 3, 16, 54, 'Launch the counter: pass wide, run, or kick ahead and chase.', 'If the space is ahead, chip and back your pace.'],
  ['counter-deep', 4, 24, 56, 'Support the break at the hip; the counter lives on the second wave.', 'If the ruck forms, be the link to the backs.'],
  ['counter-deep', 5, 32, 52, 'Reset the attack shape from depth; you are the extra man forever.', 'If the defence resets, kick into the space behind.'],
  // red-zone-22
  ['red-zone-22', 1, 72, 50, 'Hold at 15m depth behind the shape — the insurance and the outlet.', 'If their 15 rushes, hold deeper.'],
  ['red-zone-22', 2, 75, 52, 'Watch for the turnover kick; the red zone is where they come.', 'If they run, hold the sweep until the ball moves.'],
  ['red-zone-22', 3, 80, 54, 'Join the line as the extra man if the flat game needs one more.', 'If the move is on, trail at the hip.'],
  ['red-zone-22', 4, 84, 56, 'Support the strike; arrive at pace with the offload in mind.', 'If the tackle is made, clean out.'],
  ['red-zone-22', 5, 86, 52, 'Reset behind the goal-line shape; the drop goal call is yours to feed.', 'If we go again, be the second wave.'],
  // goal-line-def
  ['goal-line-def', 1, 10, 50, 'Cover behind the line at 10-12m, centred on the posts.', 'If they spread, shade across behind the spread.'],
  ['goal-line-def', 2, 10, 52, 'Watch the cross-field kick and the grubber — both die with you.', 'If they run, hold until the ball is passed.'],
  ['goal-line-def', 3, 8, 54, 'Take the high ball, make the last-ditch tackle, save the try.', 'If beaten, chase to the dead ball line.'],
  ['goal-line-def', 4, 8, 48, 'Clear the danger: catch, call, and kick long under pressure.', 'If the catch is clean, counter if the edge opens.'],
  ['goal-line-def', 5, 12, 50, 'Reset the backfield cover; the siege is not over.', 'If we win it, kick long and relieve.'],
  // att-maul
  ['att-maul', 1, 80, 50, 'Hold the deep sweep behind the maul for the turnover kick.', 'If their 15 rushes, hold deeper.'],
  ['att-maul', 2, 82, 52, 'Watch the steal and the break out the back — you are the insurance.', 'If they steal it, make the cover tackle.'],
  ['att-maul', 3, 86, 54, 'If the maul stalls, come into the line as the extra man wide.', 'If it drives, hold the sweep.'],
  ['att-maul', 4, 90, 56, 'Support the wide release; the full back arrives from depth.', 'If the tackle is made, clean.'],
  ['att-maul', 5, 92, 52, 'Reset behind the goal-line shape.', 'If the corner kicks come, take them.'],
  // turnover-att
  ['turnover-att', 1, 30, 50, 'Sweep behind the counter at 15m depth — the second wave forever.', 'If the counter goes wide, trail inside it.'],
  ['turnover-att', 2, 34, 52, 'Read the space ahead of the carrier; the offload to you is the try.', 'If it does not come, support at the hip.'],
  ['turnover-att', 3, 40, 54, 'Take the offload or the deep pass and race for the line.', 'If covered, keep the ball alive.'],
  ['turnover-att', 4, 46, 56, 'Support at the hip; the counter needs its second wave.', 'If the ruck forms, organise from depth.'],
  ['turnover-att', 5, 50, 52, 'Reset the attack; you are the extra man in every broken field.', 'If the defence resets, kick behind them.'],
  // turnover-def
  ['turnover-def', 1, 55, 50, 'TURN AND SPRINT: you are the last line of the scramble.', 'If their runner is through, run the intercept angle.'],
  ['turnover-def', 2, 50, 52, 'Cover the space behind your rushing team-mates.', 'If the ball goes wide, shade across at pace.'],
  ['turnover-def', 3, 44, 54, 'Make the last-ditch tackle or force the pass.', 'If beaten, chase to the line.'],
  ['turnover-def', 4, 40, 52, 'Reset the backfield; the scramble ends with order.', 'If we win it back, counter immediately.'],
  ['turnover-def', 5, 38, 50, 'Reorganise the wide cover by voice.', 'If short out wide, drift and use the flag.'],
  // tap-pen
  ['tap-pen', 1, 62, 50, 'Hold 15m behind the tap shape — the counter outlet.', 'If their line rushes, hold deeper.'],
  ['tap-pen', 2, 65, 52, 'Watch the wide break; the full back joins from depth.', 'If it goes narrow, sweep across.'],
  ['tap-pen', 3, 70, 54, 'Join the line as the extra man on the wide move.', 'If the move is on, trail at the hip.'],
  ['tap-pen', 4, 74, 56, 'Support the strike runner.', 'If the tackle is made, clean out.'],
  ['tap-pen', 5, 76, 52, 'Reset behind the new shape.', 'If we kick, cover the landing.'],
  // pen-goal
  ['pen-goal', 1, 72, 50, 'Stand deep behind the kicker as the restart safety.', 'If the kick is short, be first to the bounce.'],
  ['pen-goal', 2, 72, 52, 'Watch the flight; organise the restart receive by voice.', 'If it misses, defend the counter.'],
  ['pen-goal', 3, 60, 52, 'Jog back, calling the restart shape.', 'If they run it back, make the cover tackle.'],
  ['pen-goal', 4, 52, 54, 'Hold the deep slot in the receive shape.', 'If the kick is short, advance and field.'],
  ['pen-goal', 5, 45, 52, 'Sweep behind the restart receive.', 'If we win it, counter from deep.'],
  // drop-out-22
  ['drop-out-22', 1, 16, 50, 'Sweep at 15m behind the drop-out chase, centred.', 'If their return kick is long, cover the corner.'],
  ['drop-out-22', 2, 18, 52, 'Watch their return: kick or run — answer accordingly.', 'If they run, hold the backfield until committed.'],
  ['drop-out-22', 3, 24, 54, 'Field the return kick and counter with purpose.', 'If the chase is on, kick back and turn them.'],
  ['drop-out-22', 4, 30, 52, 'Join the counter as the extra man from depth.', 'If the ruck forms, organise from behind.'],
  ['drop-out-22', 5, 34, 50, 'Reset the backfield for their phase.', 'If we win it, go forward.'],
  // wide-edge
  ['wide-edge', 1, 48, 62, 'Swing across to the wide sweep — the edge needs its insurance.', 'If the play comes back inside, cross behind the ruck.'],
  ['wide-edge', 2, 50, 64, 'Hold 15m in-field of your wing and 10m behind him.', 'If their winger is wide, shade to the touchline.'],
  ['wide-edge', 3, 54, 66, 'Take the offload or cover the kick behind the edge.', 'If the kick goes up, call and take it.'],
  ['wide-edge', 4, 58, 68, 'Support the break; the full back finishes what the edge starts.', 'If the tackle is made, clean out.'],
  ['wide-edge', 5, 58, 62, 'Reset the sweep; the counter-attack goes the other way now.', 'If we come back, lead it from depth.'],
  // broken-field-def
  ['broken-field-def', 1, 30, 55, 'THE LAST LINE: sprint across, buy time, never commit early.', 'If he is in the open, run the intercept line.'],
  ['broken-field-def', 2, 26, 57, 'Shepherd him to the cover; the touchline is your team-mate.', 'If he cuts back, hold and mirror him.'],
  ['broken-field-def', 3, 22, 59, 'Make the last-ditch tackle or force the pass.', 'If beaten, chase your own miss.'],
  ['broken-field-def', 4, 24, 55, 'Reset the backfield; the save is only half the job.', 'If the ruck forms, hold the deep cover.'],
  ['broken-field-def', 5, 26, 52, 'Reorganise the whole defence from the back by voice.', 'If we win it, counter from deep.'],
];

export default expand(15, t);
