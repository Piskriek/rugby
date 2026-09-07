import { expand, PointTuple } from './types';

// 6 — BLINDSIDE FLANKER (100 points)
// Set piece: left flank of the scrum, breaks LATE; lineout FIFTH in the line, lifter for 5 (middle) and 8 (tail).
// Defence: the BLINDSIDE PILLAR — on the hindmost-foot line outside the box on the short side, the anchor of the
// line: nothing comes back inside him. Attack: holds the short side as the blind carry threat; enters any ruck
// through the gate only.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 46.5, 39.5, 'Bind on the left flank, head between 1 and 4, blindside shoulder; push square through the lock.', 'If 7 is on the blindside, take the open flank.'],
  ['own-scrum-mid', 2, 46.5, 39.5, 'Push square; keep the scrum stable so the 8 can control the base — you break LATE.', 'If we are wheeled, resist by driving straight.'],
  ['own-scrum-mid', 3, 46.5, 39.5, 'Stay bound until the ball is out; the flanker who breaks early gives away the scrum penalty.', 'If 8 picks blind, be his first latch.'],
  ['own-scrum-mid', 4, 50, 38, 'Break to the blind side: the short-side carry option or 8\'s support.', 'If 9 goes open, trail as the inside support.'],
  ['own-scrum-mid', 5, 54, 40, 'Set on the blind edge of the new ruck: the short-side carry threat.', 'If the blind is stocked, fold open as the +1.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 41.5, 'Bind on the blind flank against their feed; head up, eyes on their 8 and 9.', 'If 7 is blind, take the open flank.'],
  ['def-scrum-22', 2, 16.5, 41.5, 'Push square; stay bound until the ball is out — an early break is a penalty in our 22.', 'If their 8 picks blind, you are the tackler.'],
  ['def-scrum-22', 3, 17, 41, 'Break blind: tackle their 8 or 9 on the short side.', 'If they go open, cover the inside channel.'],
  ['def-scrum-22', 4, 20, 42, 'Set the BLINDSIDE PILLAR on their first ruck: on the hindmost-foot line, outside the box on the short side.', 'If the pillar is set, be the guard.'],
  ['def-scrum-22', 5, 22, 43, 'Anchor the short-side line for phase two: nothing comes back inside you.', 'If they go open, hold the blind — do not chase.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 17.5, 'FIFTH in the line: back lifter of the middle pod (5 in front) and front lifter of the tail pod (8 behind).', 'If the call is front, hold and be ready to peel.'],
  ['own-lineout-att-5', 2, 95, 17.5, 'Lift whichever jumper the call names — 5 or 8 — on the hooker\'s release.', 'If the counter-lift is early, hold your man up.'],
  ['own-lineout-att-5', 3, 95.5, 18.5, 'Land him and bind the back of the maul as the driving engine.', 'If off the top, trail 9 on the blind.'],
  ['own-lineout-att-5', 4, 97.5, 20, 'Drive at the posts; if it stalls, peel off the back as the carrier.', 'If 8 carries, latch on his hip.'],
  ['own-lineout-att-5', 5, 98, 23, 'Hold the blind edge of the new ruck as the short carry threat.', 'If stocked, fold open.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 81, 'FIFTH in our defensive line: lift 5 against the middle ball, or 8 against the tail.', 'If they throw front, hold the middle gap.'],
  ['def-lineout-mid', 2, 49, 81, 'Watch the throw; be first to press their 10 off a tail catch.', 'If they maul, hit the back-side seam.'],
  ['def-lineout-mid', 3, 48, 79, 'Press their 10 or bind on the maul.', 'If they go blind, you are the tackler.'],
  ['def-lineout-mid', 4, 46, 72, 'Set the blindside pillar on their first ruck, entering behind our hindmost foot.', 'If set, be the guard.'],
  ['def-lineout-mid', 5, 45, 66, 'Anchor the short-side line for phase two.', 'If they go open, hold the blind.'],

  // att-phase-mid
  ['att-phase-mid', 1, 52, 42, 'BLIND CARRY: hold the short side of the ruck, 1.2 m outside the box edge, behind the hindmost foot.', 'If the blind is stocked, push out as the +1 outside the pod.'],
  ['att-phase-mid', 2, 54, 42, 'Get depth; hit the line at pace if 9 goes blind.', 'If the ball goes open, trail as the inside support.'],
  ['att-phase-mid', 3, 56, 43, 'Carry into the seam outside the guard.', 'If a back carries, be his inside support.'],
  ['att-phase-mid', 4, 57, 44, 'Present or offload; clean the next ruck only if needed — through the gate.', 'If the ruck is safe, stay on your feet as the pillar.'],
  ['att-phase-mid', 5, 58, 48, 'Reload to the middle pod within four seconds.', 'If the middle is set, hold the edge.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 43, 'BLINDSIDE PILLAR: on the hindmost-foot line, outside the box on the short side, the anchor of the line.', 'If the pillar is taken, take the next channel out.'],
  ['def-line-mid', 2, 44, 42, 'Anchor the line: nothing comes back inside you; never drift before the pass.', 'If your outside man shoots, hold the inside shoulder.'],
  ['def-line-mid', 3, 43, 41, 'Chop or choke tackle the short-side carrier.', 'If a team-mate tackles, be the first to the jackal — through the gate.'],
  ['def-line-mid', 4, 43, 40, 'Compete for the ball or reset; never through the pile.', 'If not on your feet, get back on the line.'],
  ['def-line-mid', 5, 43, 40, 'Fold inside with the ball; reset as the pillar.', 'If numbers are short, hold your channel.'],

  // kickoff-receive
  ['kickoff-receive', 1, 30, 34, 'Blind-side lifter for 4 on the left catch.', 'If the kick goes right, seal for 5.'],
  ['kickoff-receive', 2, 29, 33, 'Lift 4 on the call.', 'If short, protect.'],
  ['kickoff-receive', 3, 28, 33, 'Land him; seal from behind.', 'If spilled, first hands.'],
  ['kickoff-receive', 4, 27, 36, 'Blind pillar of the exit ruck.', 'If safe, guard.'],
  ['kickoff-receive', 5, 29, 40, 'Chase the exit kick, blind channel.', 'If stocked, second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 49, 30, 'Halfway, first wave, wide left — the touchline chaser.', 'If the kick goes right, chase connected.'],
  ['kickoff-chase', 2, 56, 30, 'Chase hard and straight, holding the touchline.', 'If they catch clean, set the tackle.'],
  ['kickoff-chase', 3, 61, 31, 'Tackle or set the blind pillar on their ruck — behind the ball.', 'If they win it, pillar.'],
  ['kickoff-chase', 4, 58, 34, 'Blind pillar on their exit ruck.', 'If wide, hold the blind.'],
  ['kickoff-chase', 5, 55, 38, 'Anchor the touchline side of the line.', 'If they kick, trail.'],

  // exit-box-kick
  ['exit-box-kick', 1, 13, 36, 'Blind guard of the box-kick ruck.', 'If set, be the left post.'],
  ['exit-box-kick', 2, 13, 36, 'Hold square until the kick.', 'If charged, protect the 9.'],
  ['exit-box-kick', 3, 15, 38, 'Break and chase the touchline channel.', 'If charged down, first on the ball.'],
  ['exit-box-kick', 4, 20, 40, 'Chase at 10 m, blind channel.', 'If they counter, set the tackle.'],
  ['exit-box-kick', 5, 26, 42, 'Anchor the touchline side of the line.', 'If kicked back, drop.'],

  // counter-deep
  ['counter-deep', 1, 12, 40, 'Blind support for the catcher.', 'If a back is there, wider.'],
  ['counter-deep', 2, 15, 44, 'Inside pass option; keep the counter alive.', 'If they kick, ruck.'],
  ['counter-deep', 3, 20, 48, 'Sprint to the first counter ruck through the gate.', 'If secure, pillar.'],
  ['counter-deep', 4, 24, 48, 'Clear the first threat from behind.', 'If none, set the blind.'],
  ['counter-deep', 5, 28, 46, 'Hold the blind edge of the exit ruck.', 'If 9 kicks, hold the ruck.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 42, 'Blind carry threat: short side of the red-zone ruck, outside the box edge.', 'If the blind is stocked, take the tight latch.'],
  ['red-zone-22', 2, 81, 42, 'Attack the seam between the guard and the touchline.', 'If a back carries, inside support.'],
  ['red-zone-22', 3, 83, 43, 'Fight for the line; offload to the trailer.', 'If held up, place back.'],
  ['red-zone-22', 4, 84, 44, 'Present, roll, rise — sub-3-second ruck.', 'If contested, secure it through the gate.'],
  ['red-zone-22', 5, 85, 48, 'Reload to the near pod.', 'If balanced, be the wide decoy.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 43, 'Blindside pillar on our own goal line.', 'If taken, move one wider.'],
  ['goal-line-def', 2, 3.5, 43, 'No line speed; hold the line; deny the short pop.', 'If they switch sides, shuffle across, never cross.'],
  ['goal-line-def', 3, 3, 43, 'Choke tackle to hold the ball up.', 'If second man, wrap the legs.'],
  ['goal-line-def', 4, 3, 44, 'Jackal for the goal-line turnover — on your feet, through the gate.', 'If not clearly on your feet, get back on the line.'],
  ['goal-line-def', 5, 3.5, 45, 'Reset on the line; recount.', 'If short on the far side, sprint behind the line.'],

  // att-maul
  ['att-maul', 1, 91, 16, 'Back-left of the maul: the driving engine on the blind side.', 'If set, bind on the side.'],
  ['att-maul', 2, 92, 17, 'Drive square; keep it moving.', 'If it wheels, straighten.'],
  ['att-maul', 3, 93.5, 19, 'Keep the ball moving back.', 'If at the back, be the carrier.'],
  ['att-maul', 4, 95, 21, 'Drive over; keep binding.', 'If stopped, peel blind.'],
  ['att-maul', 5, 94, 25, 'If halted, peel blind as the carrier.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 34, 44, 'You may be the winner — secure, or carry away.', 'If 7 won the steal, be his protector.'],
  ['turnover-att', 2, 37, 47, 'Attack the space immediately.', 'If a back has it, hard support line.'],
  ['turnover-att', 3, 42, 51, 'Trail on the inside shoulder of the break.', 'If two inside, go outside.'],
  ['turnover-att', 4, 47, 54, 'Secure the transition ruck — from behind the ball.', 'If secure, pillar.'],
  ['turnover-att', 5, 51, 52, 'Reload into the fast pod.', 'If set, drift to the far edge.'],

  // turnover-def
  ['turnover-def', 1, 60, 49, 'Get behind the ball line and immediately hunt their carrier.', 'If onside, run the shepherding arc.'],
  ['turnover-def', 2, 55, 51, 'Fill the widest hole in the scramble line; back-rowers cover the edges.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 53, 'Shepherd them to touch; force the pass.', 'If they cut back, commit.'],
  ['turnover-def', 4, 45, 53, 'Tackle then contest — through the gate.', 'If not on your feet, reset.'],
  ['turnover-def', 5, 41, 52, 'Anchor the blind edge of the reformed line.', 'If short wide, keep folding.'],

  // tap-pen
  ['tap-pen', 1, 69, 30, 'On the blind of the mark: the short-side carry option.', 'If 8 taps, latch.'],
  ['tap-pen', 2, 70.5, 31, 'Take the tap on the blind at pace.', 'If they are set, hold.'],
  ['tap-pen', 3, 72, 32, 'Carry hard down the short side.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 32, 'Roll, rise, reload.', 'If contested, clear from behind.'],
  ['tap-pen', 5, 74, 30, 'Hold the blind edge for phase two.', 'If set, pillar.'],

  // pen-goal
  ['pen-goal', 1, 72, 36, 'Behind the kicker, wide left.', 'If quick, hold.'],
  ['pen-goal', 2, 72, 36, 'Watch the strike.', 'If short, chase.'],
  ['pen-goal', 3, 60, 38, 'Jog back to the restart shape.', 'If it misses, chase the drop-out.'],
  ['pen-goal', 4, 46, 34, 'Left touch receive slot.', 'If manned, seal.'],
  ['pen-goal', 5, 42, 32, 'Set feet; anchor the touchline.', 'If short kick, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 36, 'On the 22 wide left, first wave.', 'If long, second wave.'],
  ['drop-out-22', 2, 26, 34, 'Chase the touchline channel.', 'If clean, set the tackle.'],
  ['drop-out-22', 3, 32, 32, 'Tackle the catcher.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 36, 'Blind pillar on their ruck through our gate.', 'If set, guard.'],
  ['drop-out-22', 5, 28, 40, 'Anchor the touchline side.', 'If kicked back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 60, 'Hold the BLIND edge when the ball goes wide — nothing comes back inside you.', 'If the blind is stocked, fold.'],
  ['wide-edge', 2, 58, 62, 'Watch the switch back; be the first tackler if it comes.', 'If it stays wide, trail.'],
  ['wide-edge', 3, 60, 66, 'Trail the wide ruck at 6 m; arrive behind the ball if needed.', 'If secure, stay up.'],
  ['wide-edge', 4, 61, 64, 'Guard the short side after the wide ruck — most tries come back blind.', 'If 1 has it, hold the far post.'],
  ['wide-edge', 5, 62, 60, 'Anchor the blind for the next phase.', 'If set, +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 56, 'Shepherding arc on the touchline side.', 'If a back has it, trail.'],
  ['broken-field-def', 2, 38, 54, 'Cut the angle to the touchline.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 52, 'Force them to touch and our back three.', 'If inside cut, commit.'],
  ['broken-field-def', 4, 30, 50, 'Tackle the support or pillar the ruck.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 48, 'Anchor the reset line.', 'If short, hold width.'],
];

export default expand(6, t);
