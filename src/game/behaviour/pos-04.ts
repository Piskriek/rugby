import { expand, PointTuple } from './types';

// 4 — LOCK (BLINDSIDE) (100 points)
// Set piece: the engine room — bound between 1 and 2, sustained drive through the loosehead's hips (engine/forwardPack.ts
// engineRoomFactor multiplies the pack shove by the locks' power). Lineout: FRONT JUMPER, lifted by 1 and 3.
// Breakdown: HIGH-INERTIA ARRIVAL — full pace to the gate, plant behind the hindmost foot as the ruck's anchor;
// in defence the blind GUARD who extends the hindmost-foot line.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 47.8, 49, 'Bind between 1 and 2, head down, spine along the tunnel; the engine room starts here.', 'If 5 is in your slot, take the right-hand lock.'],
  ['own-scrum-mid', 2, 47.8, 49, 'Push through the loosehead\'s hips: long, sustained power for eight seconds — the locks\' power multiplies the pack\'s shove.', 'If the scrum surges, keep the bind, keep the shape.'],
  ['own-scrum-mid', 3, 47.8, 49, 'Stay bound until the ball is out; a lock who breaks early costs the scrum its drive.', 'If it wheels, ride the wheel bound.'],
  ['own-scrum-mid', 4, 52, 45, 'Break late and arrive HEAVY at the first ruck: full pace, then plant behind the hindmost foot.', 'If the ruck is safe, be the pod carrier.'],
  ['own-scrum-mid', 5, 55, 46, 'Set as the blind-edge anchor of the new ruck, off the box, ready to reload.', 'If anchored, be the middle pod carrier.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 48.5, 'Bind between 1 and 2, head down; you are the engine room against their feed.', 'If 5 is there, take the right lock.'],
  ['def-scrum-22', 2, 16.5, 48.5, 'Drive through the loosehead\'s hips; sustained power, never a snatch.', 'If they have the shove, hold square.'],
  ['def-scrum-22', 3, 16.5, 48.5, 'Stay bound until the ball is out.', 'If their 8 picks, drive on.'],
  ['def-scrum-22', 4, 20, 47, 'Arrive heavy at their first ruck as the guard — round the box, in through our gate, plant on the line.', 'If the guard is set, be the next man out.'],
  ['def-scrum-22', 5, 22, 48, 'Anchor the hindmost-foot line: on it, square, three metres off the ball.', 'If wide, fold along the line, never through the ruck.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 11.5, 'SECOND in the line: FRONT JUMPER of the front pod, 1 in front of you, 3 behind.', 'If the call is middle, be the middle pod\'s front lifter instead.'],
  ['own-lineout-att-5', 2, 95, 11.5, 'Time the jump on the hooker\'s release: two lifters (1 and 3), one call, two metres of air.', 'If the counter-lift is early, ride it and take the ball on the way down.'],
  ['own-lineout-att-5', 3, 95.5, 12, 'Take it at the top; turn and feed the maul or give it off the top.', 'If it is off the top, get down and drive.'],
  ['own-lineout-att-5', 4, 97.5, 14, 'Land and bind the maul as its engine; drive at the posts.', 'If it stalls, be the pick option at its base.'],
  ['own-lineout-att-5', 5, 98, 17, 'Reset as the anchor of the new ruck, behind the hindmost foot.', 'If 8 picks, latch on his hip.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 89, 'SECOND in our defensive line: counter-jump the front pod with 1 and 3 lifting.', 'If they throw middle, step up and lift 5.'],
  ['def-lineout-mid', 2, 49, 89, 'Read the front lifter\'s eyes — the call is in his stance.', 'If it goes tail, hand it over and prepare to sprint.'],
  ['def-lineout-mid', 3, 48, 87, 'Contest the front ball; if it goes down, come round the front to the tackle.', 'If they maul, bind the front and drive low.'],
  ['def-lineout-mid', 4, 46, 80, 'Arrive heavy at their first ruck as the guard, entering behind our hindmost foot.', 'If the guards are set, slide wider.'],
  ['def-lineout-mid', 5, 45, 72, 'Anchor the hindmost-foot line on the touch side.', 'If they go open, fold along the line.'],

  // att-phase-mid
  ['att-phase-mid', 1, 52, 47, 'Blind-edge ANCHOR of the ruck: behind the hindmost foot, inside the corridor, half a metre off the axis.', 'If the ruck is anchored, be the pod carrier one pass off.'],
  ['att-phase-mid', 2, 54, 48, 'If not needed at the ruck: middle man of the first pod, call for it early, flat.', 'If the ball goes wide, run the decoy hard.'],
  ['att-phase-mid', 3, 56, 49, 'Big carry at the inside shoulder; look for the offload.', 'If tackled, present long.'],
  ['att-phase-mid', 4, 57, 50, 'Place, roll, reload — or arrive HEAVY at the next ruck: full pace, plant behind the hindmost foot.', 'If the jackal is on, clear him through the gate.'],
  ['att-phase-mid', 5, 58, 46, 'Reload the next pod inside four seconds; approach behind the ball.', 'If the pods are set, be the +1.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 45, 'BLIND GUARD: on the hindmost-foot line, outside the box edge on the short side, three metres off the ball.', 'If 6 has the blind, take the open guard.'],
  ['def-line-mid', 2, 44, 45, 'Anchor the line — hold it, extend it laterally; do not bite the decoy.', 'If the ball moves on, fold along the line.'],
  ['def-line-mid', 3, 43, 44, 'Tackle low through the biggest man in the channel.', 'If the tackle is made, be over the ball through our gate.'],
  ['def-line-mid', 4, 43, 42, 'Fold to the next ruck round the box, arriving heavy on the line.', 'If two fold, hold the sweeper.'],
  ['def-line-mid', 5, 43, 41, 'Reset the guard line; call the count.', 'If short, hold width.'],

  // kickoff-receive
  ['kickoff-receive', 1, 30, 40, 'PRIMARY CATCHER on the left: under the flight, lifters either side.', 'If the kick goes right, be the seal for 5.'],
  ['kickoff-receive', 2, 29, 38, 'Call it, go up on the lift, take it at the top.', 'If it is short, stay down and catch on the chest.'],
  ['kickoff-receive', 3, 28, 38, 'Land, turn, present or drive; the pod folds round you.', 'If spilled, first hands.'],
  ['kickoff-receive', 4, 27, 40, 'Set the platform square for 9.', 'If safe, be the pillar.'],
  ['kickoff-receive', 5, 29, 44, 'Chase the exit kick in the inside channel.', 'If stocked, second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 49, 42, 'Halfway, first wave, left of the kicker — the contest man.', 'If the kick goes right, chase connected.'],
  ['kickoff-chase', 2, 56, 40, 'Chase hard and straight; you contest in the air.', 'If they catch clean, set the tackle.'],
  ['kickoff-chase', 3, 61, 39, 'Contest or arrive heavy at the ruck as the anchor — behind the ball.', 'If they win it, guard.'],
  ['kickoff-chase', 4, 58, 42, 'Guard on their exit ruck, on the hindmost-foot line.', 'If wide, fold along the line.'],
  ['kickoff-chase', 5, 55, 45, 'Reset into the line.', 'If they kick, trail.'],

  // exit-box-kick
  ['exit-box-kick', 1, 12, 45, 'Anchor of the box-kick ruck: bound, heavy, behind the hindmost foot.', 'If the ruck is set, be the left guard.'],
  ['exit-box-kick', 2, 12, 45, 'Hold square until the kick; absorb the counter-ruck.', 'If charged, hold.'],
  ['exit-box-kick', 3, 15, 46, 'Break behind the ruck; trail the chase.', 'If charged down, first on the ball.'],
  ['exit-box-kick', 4, 20, 47, 'Trail the chase at 10 m.', 'If they counter, set the tackle.'],
  ['exit-box-kick', 5, 26, 48, 'Reset into the line.', 'If kicked back, drop.'],

  // counter-deep
  ['counter-deep', 1, 12, 48, 'Inside support for the catcher, heavy.', 'If a back is there, wider.'],
  ['counter-deep', 2, 15, 52, 'Inside pass option; keep running.', 'If they kick, ruck.'],
  ['counter-deep', 3, 20, 56, 'Arrive heavy at the first counter ruck through the gate; anchor it.', 'If secure, pillar.'],
  ['counter-deep', 4, 24, 56, 'Clear the first threat from behind, square.', 'If none, set the pod.'],
  ['counter-deep', 5, 28, 52, 'Middle of the exit pod.', 'If 9 kicks, hold the ruck.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 48, 'Anchor of the red-zone ruck or middle of the tight pod one pass off it.', 'If the pod is set, be the latch.'],
  ['red-zone-22', 2, 81, 49, 'Carry at the post defender, low, driving the legs.', 'If 3 carries, bind on and push.'],
  ['red-zone-22', 3, 82.5, 50, 'Reach for the line with the long arm.', 'If held up, spin to ground it.'],
  ['red-zone-22', 4, 83, 48, 'Place, roll, reload — or arrive heavy and anchor.', 'If slow to rise, clear the lane.'],
  ['red-zone-22', 5, 84, 45, 'Reset the middle pod.', 'If manned, far-post guard.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 51, 'First layer under the posts, on our line, over their ruck.', 'If the stack is set, join the second layer.'],
  ['goal-line-def', 2, 3.5, 51, 'Hold and hit: the low man through the biggest body.', 'If wide, shuffle, never cross.'],
  ['goal-line-def', 3, 3, 50, 'Double tackle, kill the drive, hold him up.', 'If second in, get under the ball.'],
  ['goal-line-def', 4, 3, 49, 'Jackal only on your feet and through the gate.', 'If 7 has it, seal in front.'],
  ['goal-line-def', 5, 3.5, 48, 'Reset the stack; count their forwards.', 'If they spread, spread.'],

  // att-maul
  ['att-maul', 1, 91, 18, 'Second row of the maul: the engine, bound on 1 and 2.', 'If the row is set, bind on the side.'],
  ['att-maul', 2, 92, 19, 'Drive through the hips of the front row; long steps, low.', 'If it wheels, straighten.'],
  ['att-maul', 3, 93.5, 21, 'Keep the ball moving back through you.', 'If at the back, drive.'],
  ['att-maul', 4, 95, 23, 'Drive over; keep binding.', 'If stopped, pick option.'],
  ['att-maul', 5, 94, 27, 'If halted, anchor the ruck that follows.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 33, 47, 'Second body over the stolen ball — heavy, from behind.', 'If secure, sprint infield as the carrier.'],
  ['turnover-att', 2, 35, 49, 'Find depth; run the hard support line.', 'If a back leads, decoy.'],
  ['turnover-att', 3, 39, 50, 'Trail inside at ten metres.', 'If two are inside, go outside.'],
  ['turnover-att', 4, 44, 51, 'First to the next ruck; anchor it behind the ball.', 'If safe, pillar.'],
  ['turnover-att', 5, 48, 49, 'Reload as the middle-pod leader.', 'If set, extra body.'],

  // turnover-def
  ['turnover-def', 1, 60, 49, 'Ball gone — retreat behind the ball line, then work to their inside shoulder.', 'If onside, sprint into the nearest gap.'],
  ['turnover-def', 2, 56, 50, 'Fill the scramble gap; do not chase the ball.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 49, 'Shepherd them inside to the forwards.', 'If they are outside you, never stop running.'],
  ['turnover-def', 4, 44, 49, 'Trailing tackle, or arrive heavy as their ruck\'s guard.', 'If the tackle is made, be over the ball.'],
  ['turnover-def', 5, 40, 48, 'Anchor the pillars; slow it down.', 'If short, fold with the ball.'],

  // tap-pen
  ['tap-pen', 1, 69, 38, 'Tight on the mark: the first latch on the tap carrier.', 'If 8 taps, latch.'],
  ['tap-pen', 2, 70.5, 39, 'Drive the tap carrier; be his second engine.', 'If set, hold.'],
  ['tap-pen', 3, 72, 40, 'Take the second carry hard at the retreating line.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 40, 'Roll, rise, reload.', 'If contested, clear from behind.'],
  ['tap-pen', 5, 74, 37, 'Anchor the phase-two ruck.', 'If set, pillar.'],

  // pen-goal
  ['pen-goal', 1, 72, 40, 'Behind the kicker, left, out of his eyeline.', 'If quick, hold.'],
  ['pen-goal', 2, 72, 40, 'Watch the strike.', 'If short, chase.'],
  ['pen-goal', 3, 60, 42, 'Jog back to the restart shape.', 'If it misses, chase the drop-out.'],
  ['pen-goal', 4, 48, 40, 'Primary left catcher slot for the receive.', 'If manned, seal.'],
  ['pen-goal', 5, 42, 40, 'Set feet under the likely flight.', 'If short kick, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 40, 'On the 22 left of the kicker, first wave.', 'If long, second wave.'],
  ['drop-out-22', 2, 26, 38, 'Chase straight; contest the catch.', 'If clean catch, set the tackle.'],
  ['drop-out-22', 3, 32, 36, 'Contest or tackle the catcher.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 40, 'Arrive heavy as the guard on their ruck — through our gate.', 'If set, sweeper.'],
  ['drop-out-22', 5, 28, 44, 'Anchor the reset line.', 'If kicked back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 66, 'Fold openside as the second forward.', 'If stocked, hold the middle pod.'],
  ['wide-edge', 2, 58, 70, 'Trailing support 6 m inside the ball.', 'If it comes back, anchor.'],
  ['wide-edge', 3, 60, 74, 'Arrive heavy at the wide ruck behind the ball, through the gate; anchor it.', 'If secure, stay up.'],
  ['wide-edge', 4, 61, 72, 'Middle of the reload pod.', 'If 6 has the guard, far post.'],
  ['wide-edge', 5, 62, 64, 'Reload infield.', 'If set, +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 60, 'Shepherding arc, inside.', 'If a back has it, trail.'],
  ['broken-field-def', 2, 38, 57, 'Cut the angle; never chase heels.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 54, 'Force them to touch.', 'If inside cut, commit.'],
  ['broken-field-def', 4, 30, 51, 'Tackle the support or arrive heavy as their ruck\'s guard.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 48, 'Anchor the reset pillars.', 'If short, hold width.'],
];

export default expand(4, t);
