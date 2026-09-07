import { expand, PointTuple } from './types';

// 3 — TIGHTHEAD PROP (100 points)
// Set piece: right of the hooker, the anchor of the scrum — bind short, hold the hit, inside 0.7 m of the seat.
// Lineout: THIRD in the line, back lifter of the front pod and front lifter of the middle pod (1 4 3 5 6 8 7).
// Open play: TIGHT man of the short-carry pod, half a metre outside the ruck box on the open side; primary
// clearer through the gate only.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.5, 60.5, 'Bind on the hooker, right of the scrum; bind short, chin off the chest, hold the hit.', 'Never swap sides — the tighthead is the tighthead.'],
  ['own-scrum-mid', 2, 48.5, 60.5, 'Take the loosehead\'s shoulder up and back; you win scrums on the tight side. Stay inside 0.7 m of your seat.', 'If the scrum wheels, resist square — no walking round.'],
  ['own-scrum-mid', 3, 48.5, 60, 'Stay bound and low until the ball is out.', 'If it collapses, stay down until the whistle.'],
  ['own-scrum-mid', 4, 52.5, 55, 'Break late; trail the first carry at 6 m as the tight cleaner — approach from behind the ball.', 'If the ruck is safe, be the tight pod man.'],
  ['own-scrum-mid', 5, 55, 53, 'Set as the TIGHT man of the pod, half a metre outside the box edge.', 'If the tight slot is taken, be the pillar.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 58.5, 'Bind on the hooker, right side, low; hold the hit.', 'Never swap sides.'],
  ['def-scrum-22', 2, 16.5, 58.5, 'Hold the bind through their drive; keep the tunnel legal.', 'If we shove, drive square.'],
  ['def-scrum-22', 3, 17, 57, 'On the ball out, break behind our hindmost foot first.', 'If their 8 picks, tackle from the side.'],
  ['def-scrum-22', 4, 20, 54, 'Fold as the pillar of their first ruck — round the box, in through our gate.', 'If the pillar is taken, guard.'],
  ['def-scrum-22', 5, 22, 52, 'Reset as pillar for phase two.', 'If wide, fold along the line.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 13.5, 'THIRD in the line: back lifter of the front pod (4 in front of you) and front lifter of the middle pod (5 behind).', 'If the call is tail, hold and be ready to peel.'],
  ['own-lineout-att-5', 2, 95, 13.5, 'Lift whichever jumper the call names — 4 or 5 — on the hooker\'s release; never both.', 'If the counter-lift is early, hold your man up longer.'],
  ['own-lineout-att-5', 3, 95.5, 14.5, 'Land him and bind the front of the maul, low.', 'If it is off the top, trail 9.'],
  ['own-lineout-att-5', 4, 97.5, 16, 'Drive at the posts; keep the maul square.', 'If it stalls, one-out pick beside it.'],
  ['own-lineout-att-5', 5, 98, 19, 'Reset on the near post of the new ruck.', 'If 8 picks, latch on him.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 87, 'THIRD in our defensive line, between 4 and 5: back lifter of the front pod, front lifter of the middle.', 'If 1 is absent, take the front.'],
  ['def-lineout-mid', 2, 49, 87, 'Counter-lift whichever lock the throw goes to.', 'If it goes tail, hold the middle gap.'],
  ['def-lineout-mid', 3, 48, 85, 'On the ball down, come round — never through — to the tackle.', 'If they maul, bind the front low.'],
  ['def-lineout-mid', 4, 46, 78, 'Fold infield at guard depth; enter any ruck behind our hindmost foot.', 'If the guards are set, slide wider.'],
  ['def-lineout-mid', 5, 45, 72, 'Pillar on the touch side of their phase two.', 'If they go open, fold along the line.'],

  // att-phase-mid
  ['att-phase-mid', 1, 53, 48, 'TIGHT man of the pod, half a metre outside the box edge on the open side.', 'If the tight slot is taken, be the +1.'],
  ['att-phase-mid', 2, 54, 49, 'Square up, flat, hands up: you are the first short option off 9.', 'If the ball goes wide, decoy hard and straight.'],
  ['att-phase-mid', 3, 56, 50, 'Carry low at the guard; leg drive, no lateral.', 'If 2 carries, latch and drive.'],
  ['att-phase-mid', 4, 57, 50, 'Present long; roll away; get up.', 'If the jackal is on, clear him through the gate.'],
  ['att-phase-mid', 5, 58, 42, 'Reload into the next pod, approaching behind the hindmost foot.', 'If the pod is set, pillar on the open edge.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 53, 'PILLAR on the far side: hindmost-foot line, three metres off the ball, outside the box.', 'If the pillar is taken, guard one wider.'],
  ['def-line-mid', 2, 44, 51, 'Hold; no line speed from the pillar; watch the 9.', 'If the ball moves, fold along the line.'],
  ['def-line-mid', 3, 43, 49, 'Chop the tight carrier low.', 'If a team-mate tackles, get over the ball through our gate.'],
  ['def-line-mid', 4, 43, 47, 'Fold to the next ruck round the box, in through the mouth.', 'If two fold, hold.'],
  ['def-line-mid', 5, 43, 45, 'Reset as pillar; call the count.', 'If short, hold width.'],

  // kickoff-receive
  ['kickoff-receive', 1, 35, 66, 'Front-line receiver at the 10 m, right pod.', 'If the kick goes left, run the arc.'],
  ['kickoff-receive', 2, 33, 64, 'Track the flight; shield the lock.', 'If short, be under it.'],
  ['kickoff-receive', 3, 31, 62, 'Seal the catcher from behind, square.', 'If spilled, first hands.'],
  ['kickoff-receive', 4, 29, 60, 'Set the platform square for 9.', 'If safe, pillar.'],
  ['kickoff-receive', 5, 30, 58, 'Chase the exit kick, inside channel.', 'If stocked, second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 49, 58, 'Halfway, second wave, right of the kicker.', 'If short, contest.'],
  ['kickoff-chase', 2, 55, 57, 'Chase connected.', 'If clean catch, set the tackle line.'],
  ['kickoff-chase', 3, 60, 56, 'Arrive as the seal from behind the ball.', 'If they win it, pillar.'],
  ['kickoff-chase', 4, 58, 54, 'Pillar for their exit ruck.', 'If wide, fold.'],
  ['kickoff-chase', 5, 55, 52, 'Reset into the line.', 'If they kick, trail.'],

  // exit-box-kick
  ['exit-box-kick', 1, 13, 56, 'Right post of the box-kick ruck, bound low.', 'If taken, far post.'],
  ['exit-box-kick', 2, 13, 56, 'Stay square until the kick.', 'If charged, hold.'],
  ['exit-box-kick', 3, 15, 54, 'Break behind the ruck; trail the chase.', 'If charged down, first on it.'],
  ['exit-box-kick', 4, 20, 52, 'Trail at 10 m.', 'If they counter, set the tackle.'],
  ['exit-box-kick', 5, 26, 50, 'Reset into the line.', 'If kicked back, drop.'],

  // counter-deep
  ['counter-deep', 1, 12, 60, 'Inside option for the catcher on the right.', 'If a back is there, wider.'],
  ['counter-deep', 2, 15, 62, 'Tight inside pass option.', 'If they kick, ruck.'],
  ['counter-deep', 3, 20, 62, 'Sprint to the first counter ruck through the gate.', 'If secure, pillar.'],
  ['counter-deep', 4, 24, 60, 'Clean the first threat, from behind.', 'If none, set the pod.'],
  ['counter-deep', 5, 28, 56, 'Tight man of the exit pod.', 'If 9 kicks, hold the ruck.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 46, 'Tight man of the pod, outside the box edge.', 'If set, latch.'],
  ['red-zone-22', 2, 81, 47, 'Carry at the guard, low.', 'If 1 carries, drive him.'],
  ['red-zone-22', 3, 82.5, 48, 'Fight for the line.', 'If held, place back.'],
  ['red-zone-22', 4, 83, 46, 'Roll away; reload.', 'If contested, clear through the gate.'],
  ['red-zone-22', 5, 84, 44, 'Reset on the near post.', 'If manned, next carrier.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 45, 'Pillar on the far side of their ruck, on our line.', 'If taken, guard.'],
  ['goal-line-def', 2, 3.5, 45, 'No line speed — hold and hit.', 'If wide, shuffle.'],
  ['goal-line-def', 3, 3, 44, 'Double tackle: the low man.', 'If second in, under the ball.'],
  ['goal-line-def', 4, 3, 43, 'Compete only on your feet through the gate.', 'If 7 has it, seal.'],
  ['goal-line-def', 5, 3.5, 42, 'Reset on the line.', 'If they spread, spread.'],

  // att-maul
  ['att-maul', 1, 92, 21, 'Front-right of the maul, low.', 'If set, bind on the side.'],
  ['att-maul', 2, 93, 22, 'Drive square.', 'If it wheels, straighten.'],
  ['att-maul', 3, 94.5, 24, 'Transfer the ball back.', 'If at the back, drive.'],
  ['att-maul', 4, 96, 26, 'Keep binding on the drive over.', 'If stopped, pick option.'],
  ['att-maul', 5, 95, 30, 'If halted, peel as the short carry.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 33, 48, 'Second body over the steal, from behind.', 'If secure, tight carry option.'],
  ['turnover-att', 2, 35, 51, 'Depth; then support.', 'If a back leads, decoy.'],
  ['turnover-att', 3, 39, 54, 'Trail the break at 10 m.', 'If crowded, go outside.'],
  ['turnover-att', 4, 44, 56, 'First to the next ruck; enter behind the ball.', 'If safe, pillar.'],
  ['turnover-att', 5, 48, 52, 'Reload the tight pod.', 'If set, extra body.'],

  // turnover-def
  ['turnover-def', 1, 60, 51, 'Get behind the ball line first.', 'If onside, fill a hole.'],
  ['turnover-def', 2, 56, 52, 'Fill the nearest hole.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 52, 'Shepherd, do not chase heels.', 'If they cut back, commit.'],
  ['turnover-def', 4, 44, 51, 'Trailing tackle or pillar.', 'If a jackal is on, protect him.'],
  ['turnover-def', 5, 40, 50, 'Reset the pillars.', 'If short, fold.'],

  // tap-pen
  ['tap-pen', 1, 69, 46, 'Tight on the mark, the first latch.', 'If 8 taps, latch.'],
  ['tap-pen', 2, 70.5, 47, 'Take the tap pass at pace.', 'If set, hold.'],
  ['tap-pen', 3, 72, 48, 'Carry hard, low.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 48, 'Roll, rise, reload.', 'If contested, clear from behind.'],
  ['tap-pen', 5, 74, 45, 'Set the tight pod for phase two.', 'If set, pillar.'],

  // pen-goal
  ['pen-goal', 1, 72, 52, 'Behind the kicker on the right.', 'If quick, hold.'],
  ['pen-goal', 2, 72, 52, 'Watch the strike.', 'If short, chase.'],
  ['pen-goal', 3, 60, 51, 'Jog back to the restart shape.', 'If it misses, chase the drop-out.'],
  ['pen-goal', 4, 52, 58, 'Right front lifter slot for the receive.', 'If manned, second wave.'],
  ['pen-goal', 5, 45, 60, 'Set feet; shield the catcher.', 'If short kick, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 52, 'On the 22 right of the kicker.', 'If long, second wave.'],
  ['drop-out-22', 2, 26, 54, 'Chase straight.', 'If clean catch, set the tackle.'],
  ['drop-out-22', 3, 32, 56, 'Tackle the catcher.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 52, 'Fold into the far pillar through our gate.', 'If set, guard.'],
  ['drop-out-22', 5, 28, 50, 'Reset the line.', 'If kicked back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 64, 'Hold the middle as the tight forward when the ball goes wide.', 'If the middle is stocked, fold.'],
  ['wide-edge', 2, 58, 68, 'Trail inside the ball at 8 m.', 'If it comes back, pillar.'],
  ['wide-edge', 3, 60, 72, 'Arrive at the wide ruck behind the ball, through the gate.', 'If secure, stay up.'],
  ['wide-edge', 4, 61, 70, 'Tight man of the reload pod.', 'If the pod is set, far post.'],
  ['wide-edge', 5, 62, 62, 'Reload infield.', 'If set, +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 66, 'Shepherding arc, outside 1.', 'If a back has it, trail.'],
  ['broken-field-def', 2, 38, 62, 'Cut the angle to touch.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 58, 'Force them wide.', 'If inside cut, commit.'],
  ['broken-field-def', 4, 30, 54, 'Tackle the support or pillar the ruck.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 50, 'Reset as pillar; recount.', 'If short, hold width.'],
];

export default expand(3, t);
