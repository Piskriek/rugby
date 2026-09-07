import { expand, PointTuple } from './types';

// 5 — LOCK (OPENSIDE) (100 points)
// Set piece: the engine room — bound between 2 and 3, sustained drive through the tighthead's hips (engineRoomFactor).
// Lineout: MIDDLE JUMPER, lifted by 3 and 6 — the drive ball. Breakdown: HIGH-INERTIA ARRIVAL, full pace to the
// gate then plant behind the hindmost foot as the open-edge anchor; in defence the open GUARD who extends the
// hindmost-foot line.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.2, 51, 'Bind between 2 and 3, head down, driving on the tighthead\'s hips.', 'If 4 has your slot, tuck in on the left.'],
  ['own-scrum-mid', 2, 48.2, 51, 'Sustained power through the channel; keep the scrum square — the locks\' power is the shove.', 'If it wheels, ride the wheel, stay bound.'],
  ['own-scrum-mid', 3, 48.2, 51, 'Stay bound until the ball is out.', 'If it collapses, stay down.'],
  ['own-scrum-mid', 4, 52, 53, 'Break late and arrive HEAVY at the first ruck: full pace, plant behind the hindmost foot.', 'If safe, be the outside pod man.'],
  ['own-scrum-mid', 5, 55, 52, 'Set as the open-edge anchor of the new ruck.', 'If anchored, outside pod carrier.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 51.5, 'Bind between 2 and 3; the engine room against their feed.', 'If 4 is there, take the left.'],
  ['def-scrum-22', 2, 16.5, 51.5, 'Drive through the tighthead\'s hips; sustained.', 'If they have the shove, hold square.'],
  ['def-scrum-22', 3, 16.5, 51.5, 'Stay bound until the ball is out.', 'If their 8 picks, drive on.'],
  ['def-scrum-22', 4, 20, 53, 'Arrive heavy at their first ruck as the open guard — round the box, in through our gate, plant on the line.', 'If the guard is set, next man out.'],
  ['def-scrum-22', 5, 22, 54, 'Anchor the hindmost-foot line on the open side.', 'If blind, fold along the line.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 15.5, 'FOURTH in the line: MIDDLE JUMPER, 3 in front of you and 6 behind as lifters.', 'If the call is front or tail, hold your slot low and be ready to peel round the pod.'],
  ['own-lineout-att-5', 2, 95, 15.5, 'Time the jump on the hooker\'s release; the middle ball is the drive ball.', 'If the counter-lift is early, take it on the way down.'],
  ['own-lineout-att-5', 3, 95.5, 16, 'Take it at the top; turn and feed the maul.', 'If it is off the top, drive.'],
  ['own-lineout-att-5', 4, 97.5, 18, 'Land and bind as the maul\'s engine; drive at the posts.', 'If it stalls, pick option at the base.'],
  ['own-lineout-att-5', 5, 98, 21, 'Reset as the anchor of the new ruck.', 'If 8 picks, latch.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 85, 'FOURTH in our defensive line: counter-jump the middle pod, 3 and 6 lifting.', 'If they throw front, hold the middle gap.'],
  ['def-lineout-mid', 2, 49, 85, 'Read the hooker\'s grip: a long hold means tail.', 'If it goes front, sprint the 5 m channel.'],
  ['def-lineout-mid', 3, 48, 83, 'Contest the middle ball; if it goes down, come round to the tackle.', 'If they maul, bind and drive low.'],
  ['def-lineout-mid', 4, 46, 76, 'Arrive heavy at their first ruck as the open guard, behind our hindmost foot.', 'If set, slide wider.'],
  ['def-lineout-mid', 5, 45, 68, 'Anchor the hindmost-foot line on the open side.', 'If blind, fold along the line.'],

  // att-phase-mid
  ['att-phase-mid', 1, 52, 50, 'Open-edge ANCHOR of the ruck: behind the hindmost foot, inside the corridor, half a metre off the axis.', 'If anchored, outside man of the pod one pass off.'],
  ['att-phase-mid', 2, 54, 50, 'If not needed at the ruck: outside man of the first pod, flat, at the gain line.', 'If wider, decoy hard.'],
  ['att-phase-mid', 3, 56, 51, 'Carry at the outside shoulder; look for the offload.', 'If tackled, present long.'],
  ['att-phase-mid', 4, 57, 52, 'Place, roll, reload — or arrive HEAVY at the next ruck and plant behind the hindmost foot.', 'If the jackal arrives, clear him through the gate.'],
  ['att-phase-mid', 5, 58, 47, 'Reload inside four seconds into the openside pod; approach behind the ball.', 'If set, be the +1.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 53, 'OPEN GUARD: on the hindmost-foot line, outside the box edge on the open side, three metres off the ball.', 'If 7 has it, slide one wider.'],
  ['def-line-mid', 2, 44, 53, 'Anchor and extend the line; do not bite the decoy.', 'If moved on, fold along the line.'],
  ['def-line-mid', 3, 43, 51, 'Tackle low through the carrier; stop the offload.', 'If the tackle is made, over the ball through our gate.'],
  ['def-line-mid', 4, 43, 49, 'Fold to the next ruck round the box, arriving heavy on the line.', 'If two fold, hold the sweeper.'],
  ['def-line-mid', 5, 43, 47, 'Reset the guard line; call the count.', 'If short, hold width.'],

  // kickoff-receive
  ['kickoff-receive', 1, 30, 60, 'PRIMARY CATCHER on the right: under the flight, lifters either side.', 'If the kick goes left, seal for 4.'],
  ['kickoff-receive', 2, 29, 62, 'Call it, go up on the lift, take it at the top.', 'If short, catch on the chest.'],
  ['kickoff-receive', 3, 28, 62, 'Land, turn, present or drive.', 'If spilled, first hands.'],
  ['kickoff-receive', 4, 27, 60, 'Set the platform square for 9.', 'If safe, pillar.'],
  ['kickoff-receive', 5, 29, 56, 'Chase the exit kick, inside channel.', 'If stocked, second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 49, 52, 'Halfway, first wave, right of the kicker — the contest man.', 'If the kick goes left, chase connected.'],
  ['kickoff-chase', 2, 56, 54, 'Chase hard and straight.', 'If clean catch, set the tackle.'],
  ['kickoff-chase', 3, 61, 55, 'Contest or arrive heavy at the ruck as the anchor, behind the ball.', 'If they win it, guard.'],
  ['kickoff-chase', 4, 58, 52, 'Guard on their exit ruck, on the line.', 'If wide, fold.'],
  ['kickoff-chase', 5, 55, 50, 'Reset into the line.', 'If they kick, trail.'],

  // exit-box-kick
  ['exit-box-kick', 1, 12, 51, 'Anchor of the box-kick ruck: bound, heavy, behind the hindmost foot.', 'If set, right guard.'],
  ['exit-box-kick', 2, 12, 51, 'Hold square until the kick; absorb the counter-ruck.', 'If charged, hold.'],
  ['exit-box-kick', 3, 15, 50, 'Break behind the ruck; trail.', 'If charged down, first on the ball.'],
  ['exit-box-kick', 4, 20, 49, 'Trail at 10 m.', 'If they counter, set the tackle.'],
  ['exit-box-kick', 5, 26, 48, 'Reset into the line.', 'If kicked back, drop.'],

  // counter-deep
  ['counter-deep', 1, 12, 56, 'Inside support for the catcher, right.', 'If a back is there, wider.'],
  ['counter-deep', 2, 15, 58, 'Inside pass option.', 'If they kick, ruck.'],
  ['counter-deep', 3, 20, 60, 'Arrive heavy at the first counter ruck through the gate; anchor it.', 'If secure, pillar.'],
  ['counter-deep', 4, 24, 58, 'Clear the first threat from behind.', 'If none, set the pod.'],
  ['counter-deep', 5, 28, 55, 'Outside man of the exit pod.', 'If 9 kicks, hold the ruck.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 52, 'Anchor of the red-zone ruck or outside man of the tight pod.', 'If set, latch.'],
  ['red-zone-22', 2, 81, 53, 'Carry at the post\'s outside shoulder, low and long.', 'If 4 carries, push.'],
  ['red-zone-22', 3, 82.5, 54, 'Reach for the line with the long arm.', 'If held, spin and ground it.'],
  ['red-zone-22', 4, 83, 52, 'Place, roll, reload — or arrive heavy and anchor.', 'If slow, clear the lane.'],
  ['red-zone-22', 5, 84, 49, 'Reset the pod; be the far post.', 'If manned, second carrier.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 53, 'First layer off the post, on our line.', 'If stacked, second layer.'],
  ['goal-line-def', 2, 3.5, 53, 'Hold and hit, low.', 'If wide, shuffle.'],
  ['goal-line-def', 3, 3, 52, 'Kill the drive; hold him up.', 'If second in, under the ball.'],
  ['goal-line-def', 4, 3, 51, 'Jackal only on your feet through the gate.', 'If 7 has it, seal.'],
  ['goal-line-def', 5, 3.5, 50, 'Reset the stack; count their men.', 'If they spread, spread.'],

  // att-maul
  ['att-maul', 1, 91, 20, 'Second row of the maul: the engine, bound on 2 and 3.', 'If set, bind on the side.'],
  ['att-maul', 2, 92, 21, 'Drive through the front row\'s hips; long steps.', 'If it wheels, straighten.'],
  ['att-maul', 3, 93.5, 23, 'Keep the ball moving back.', 'If at the back, drive.'],
  ['att-maul', 4, 95, 25, 'Drive over; keep binding.', 'If stopped, pick option.'],
  ['att-maul', 5, 94, 29, 'If halted, anchor the ruck that follows.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 33, 49, 'Protect the steal: second body over, heavy, from behind.', 'If secure, sprint infield.'],
  ['turnover-att', 2, 35, 51, 'Depth, then the hard support line.', 'If a back leads, decoy.'],
  ['turnover-att', 3, 39, 52, 'Trail at ten metres, inside.', 'If crowded, go outside.'],
  ['turnover-att', 4, 44, 53, 'First to the next ruck; anchor it behind the ball.', 'If safe, pillar.'],
  ['turnover-att', 5, 48, 50, 'Reload the openside pod.', 'If set, extra body.'],

  // turnover-def
  ['turnover-def', 1, 60, 51, 'Retreat behind the ball line first.', 'If onside, fill the nearest gap.'],
  ['turnover-def', 2, 56, 52, 'Scramble; do not ball-chase.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 51, 'Shepherd them inside.', 'If outside you, run forever.'],
  ['turnover-def', 4, 44, 50, 'Trailing tackle or arrive heavy as their ruck\'s guard.', 'If made, over the ball.'],
  ['turnover-def', 5, 40, 49, 'Anchor the pillars.', 'If short, fold with the ball.'],

  // tap-pen
  ['tap-pen', 1, 69, 44, 'On the mark: second latch on the tap carrier.', 'If 8 taps, latch.'],
  ['tap-pen', 2, 70.5, 45, 'Drive the tap carrier.', 'If set, hold.'],
  ['tap-pen', 3, 72, 46, 'Second carry, hard.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 46, 'Roll, rise, reload.', 'If contested, clear from behind.'],
  ['tap-pen', 5, 74, 43, 'Anchor the phase-two ruck.', 'If set, pillar.'],

  // pen-goal
  ['pen-goal', 1, 72, 56, 'Behind the kicker, right.', 'If quick, hold.'],
  ['pen-goal', 2, 72, 56, 'Watch the strike.', 'If short, chase.'],
  ['pen-goal', 3, 60, 54, 'Jog back to the restart shape.', 'If it misses, chase the drop-out.'],
  ['pen-goal', 4, 48, 60, 'Primary right catcher slot.', 'If manned, seal.'],
  ['pen-goal', 5, 42, 60, 'Set feet under the likely flight.', 'If short kick, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 56, 'On the 22 right of the kicker, first wave.', 'If long, second wave.'],
  ['drop-out-22', 2, 26, 58, 'Chase straight; contest the catch.', 'If clean, set the tackle.'],
  ['drop-out-22', 3, 32, 60, 'Contest or tackle the catcher.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 56, 'Arrive heavy as the guard on their ruck through our gate.', 'If set, sweeper.'],
  ['drop-out-22', 5, 28, 52, 'Anchor the reset line.', 'If kicked back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 70, 'Fold openside as the third forward.', 'If stocked, hold the middle pod.'],
  ['wide-edge', 2, 58, 74, 'Trailing support 4 m inside the ball.', 'If it comes back, anchor.'],
  ['wide-edge', 3, 60, 78, 'Arrive heavy at the wide ruck behind the ball, through the gate; anchor it.', 'If secure, stay up.'],
  ['wide-edge', 4, 61, 76, 'Outside man of the reload pod.', 'If 6 has the guard, far post.'],
  ['wide-edge', 5, 62, 68, 'Reload infield.', 'If set, +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 64, 'Shepherding arc, outside.', 'If a back has it, trail.'],
  ['broken-field-def', 2, 38, 60, 'Cut the angle; never chase heels.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 57, 'Force them to touch.', 'If inside cut, commit.'],
  ['broken-field-def', 4, 30, 53, 'Tackle the support or arrive heavy as their ruck\'s guard.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 50, 'Anchor the reset pillars.', 'If short, hold width.'],
];

export default expand(5, t);
