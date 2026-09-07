import { expand, PointTuple } from './types';

// 1 — LOOSEHEAD PROP (100 points)
// Set piece: left of the hooker in the 3-4-1 block, pinned to a 0.7 m bind tolerance (engine/forwardPack.ts scrumBindProfile),
// lowest centre of mass in the pack. Lineout: FRONT lifter of the front pod (line order 1 4 3 5 6 8 7).
// Open play: wide man of the short-carry pod off the 9, outside the ruck box; a primary clearer who enters
// STRICTLY through the gate — behind his own hindmost foot, inside the lateral band (engine/gates.ts).
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.5, 39.5, 'Bind on the hooker, left of the scrum; spine along the tunnel, hips low, chin off the chest.', 'If 3 is the left bind, you are the tighthead today — mirror his job.'],
  ['own-scrum-mid', 2, 48.5, 39.5, 'Hold the 0.7 m bind tolerance on the hit: the front row does not shuffle for its seat once bound.', 'If the scrum surges, ride it bound — never stand up out of it.'],
  ['own-scrum-mid', 3, 48.5, 40, 'Stay bound and low until 8 picks or 9 clears; you are the platform, not the option.', 'If the scrum wheels past 45, keep the bind and let the referee reset.'],
  ['own-scrum-mid', 4, 52.5, 44, 'Break late. Trail the first carry at 6 m depth as the second-wave cleaner; come from behind the ball.', 'If the first ruck is already secure, hold your line and be the next pod.'],
  ['own-scrum-mid', 5, 55, 44, 'Set as the wide man of the pod one pass off the new ruck, outside the box edge.', 'If the pod is stocked, stand as pillar on the ruck\'s blind edge.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 41.5, 'Bind on the hooker, left side, low; the loosehead lifts the tighthead opposite.', 'Never swap sides mid-scrum — the tunnel decides who binds where.'],
  ['def-scrum-22', 2, 16.5, 41.5, 'Hold the bind through the drive; stay inside your seat tolerance until the ball is out.', 'If we get a shove on, drive square — do not chase a wheel.'],
  ['def-scrum-22', 3, 17, 43, 'On the ball out, break behind our own hindmost foot before you go anywhere.', 'If their 8 picks, tackle from the side of the scrum, not the front.'],
  ['def-scrum-22', 4, 20, 46, 'Fold with the ball at guard depth, three metres off their ruck, entering only through our gate.', 'If the guard is taken, be the next man out — never pass through the pile.'],
  ['def-scrum-22', 5, 22, 50, 'Reset as the blind pillar for their second phase: on the hindmost-foot line, square.', 'If the ball goes wide, fold inside along the line, never across the ruck.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 9.5, 'FRONT of the line: front lifter of the front pod, 4 behind you, both hands on his shorts.', 'If the call is tail, hold your slot and be ready to peel.'],
  ['own-lineout-att-5', 2, 95, 9.5, 'On the hooker\'s release lift 4 — the front pod goes on the throw, not the call.', 'If 3 lifts first, match his timing; two lifters, one lift.'],
  ['own-lineout-att-5', 3, 95.5, 10.5, 'Land him and bind the front of the maul: low, square to their line.', 'If the ball is ripped early, become the maul\'s front shield.'],
  ['own-lineout-att-5', 4, 97.5, 12.5, 'Drive at the posts at 45 degrees; legs pumping, never let the maul go sideways.', 'If the maul stalls, be the one-out pick option beside it.'],
  ['own-lineout-att-5', 5, 98, 16, 'Reset on the near post of the new ruck for the next goal-line pick.', 'If 8 picks, latch on his hip and drive him over.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 91, 'FRONT of our defensive line, one metre back, marking their front lifter.', 'If 3 is the front, take second slot and lift 4.'],
  ['def-lineout-mid', 2, 49, 91, 'Read the hooker\'s grip; hold the front so a front peel has nowhere to go.', 'If the throw goes long, do not chase it — hold the front gap.'],
  ['def-lineout-mid', 3, 48, 89, 'On the ball down, come round the front — not through the line — to the tackle.', 'If they maul, bind on the front and drive low.'],
  ['def-lineout-mid', 4, 46, 80, 'Fold infield with the ball at guard depth; enter any ruck through our gate only.', 'If the guards are set, slide one wider.'],
  ['def-lineout-mid', 5, 45, 72, 'Set as the pillar on the touch side of their phase-two ruck.', 'If they go open, fold along the hindmost-foot line.'],

  // att-phase-mid
  ['att-phase-mid', 1, 53, 44, 'Wide man of the pod one pass off the 9 — outside the ruck\'s box edge, never on it.', 'If the pod is stocked, be the +1 behind the hub.'],
  ['att-phase-mid', 2, 54, 45, 'Square up, hands up, flat: the short carry is yours if 9 goes tight.', 'If the ball goes wide, run the decoy line hard and straight.'],
  ['att-phase-mid', 3, 56, 46, 'Carry at the inside shoulder of the last pod defender; low, leg drive, no lateral.', 'If 2 carries, latch on his hip and drive him.'],
  ['att-phase-mid', 4, 57, 47, 'Present long down the middle; roll away; a prop on the ground is a slow ruck.', 'If the jackal is on, get up and clear him — through the gate.'],
  ['att-phase-mid', 5, 58, 40, 'Reload into the next pod within four seconds, approaching behind our hindmost foot.', 'If the pod is set, be the pillar on the blind edge.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 47, 'PILLAR: on the hindmost-foot line, three metres off the ball, outside the box on the near side.', 'If the pillar is taken, be the guard one wider.'],
  ['def-line-mid', 2, 44, 45, 'Hold — no line speed from the pillar; watch the pick and the 9 snipe.', 'If the ball moves on, fold along the line, never through the ruck.'],
  ['def-line-mid', 3, 43, 43, 'Chop tackle the tight carrier; low, through the legs, then get up.', 'If a team-mate tackles, get over the ball only through our gate.'],
  ['def-line-mid', 4, 43, 40, 'Fold to the next breakdown coming from behind it — round the box, in through the mouth.', 'If two are folding, hold the pillar you have.'],
  ['def-line-mid', 5, 43, 38, 'Reset as pillar for phase two; call the count.', 'If short on the far side, hold width, do not compress.'],

  // kickoff-receive
  ['kickoff-receive', 1, 35, 30, 'Front-line receiver at the 10 m line, left pod.', 'If the kick goes right, run the arc to be the first cleaner.'],
  ['kickoff-receive', 2, 33, 26, 'Track the flight; the catcher is the lock, you are his shield.', 'If the ball is short, be the man under it.'],
  ['kickoff-receive', 3, 31, 24, 'Seal the catcher on landing: bind from behind him, square, low.', 'If the catch is spilled, first hands on it.'],
  ['kickoff-receive', 4, 29, 26, 'Set the platform for 9: hold the ruck square so the box kick is clean.', 'If the platform is safe, stand as pillar.'],
  ['kickoff-receive', 5, 30, 34, 'Chase the exit kick in the inside channel, connected.', 'If the chase is stocked, hold the second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 49, 36, 'Halfway line, second chase wave, left of the kicker.', 'If the kick is short, be the contest man.'],
  ['kickoff-chase', 2, 55, 33, 'Chase in a connected line; do not overrun the first wave.', 'If they catch clean, set the tackle line.'],
  ['kickoff-chase', 3, 60, 32, 'Arrive at the contest as the seal if we win it — from behind the ball.', 'If they win it, be the pillar on their ruck.'],
  ['kickoff-chase', 4, 58, 36, 'Set the pillar for their exit ruck, on the hindmost foot.', 'If the ball goes wide, fold along the line.'],
  ['kickoff-chase', 5, 55, 40, 'Reset into the defensive line at the ruck edge.', 'If they kick, drop to trail the chase.'],

  // exit-box-kick
  ['exit-box-kick', 1, 13, 40, 'Left post of the box-kick ruck: bound, low, protecting the 9.', 'If the post is taken, be the far post.'],
  ['exit-box-kick', 2, 13, 40, 'Stay square until the ball leaves the 9\'s hands; no early break.', 'If their forwards charge, take the hit and hold.'],
  ['exit-box-kick', 3, 15, 43, 'On the kick, break behind the ruck and trail the chase.', 'If the kick is charged down, first man on the ball.'],
  ['exit-box-kick', 4, 20, 45, 'Trail the chase at 10 m; be the second wave at the contest.', 'If they run it back, set the tackle inside.'],
  ['exit-box-kick', 5, 26, 46, 'Reset into the defensive line infield of the chase corner.', 'If the ball is kicked back, drop to secure the catch.'],

  // counter-deep
  ['counter-deep', 1, 12, 45, 'Run back hard to be the inside option for the catcher.', 'If a back is inside, offer the tight support line.'],
  ['counter-deep', 2, 15, 50, 'Offer the tight inside pass; keep the counter alive.', 'If they kick again, drop to the ruck.'],
  ['counter-deep', 3, 20, 55, 'Sprint the arc to the first counter ruck, through the gate.', 'If it is secure, hold as pillar.'],
  ['counter-deep', 4, 24, 55, 'Clean the first threat past the ball — from behind, square.', 'If no threat, stay on your feet and set the pod.'],
  ['counter-deep', 5, 28, 50, 'Take a one-out carry to earn a clean exit.', 'If 9 wants to kick, hold the ruck square.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 52, 'Inside man of the two-man tight pod one pass off the ruck.', 'If the pod is set, latch.'],
  ['red-zone-22', 2, 81, 53, 'Short carry at the post defender; low, square, no lateral.', 'If 3 carries, bind and drive him.'],
  ['red-zone-22', 3, 82.5, 54, 'Fight for the extra metre; keep the ball off the deck.', 'If held up, twist and place back.'],
  ['red-zone-22', 4, 83, 52, 'Roll away and reload — red-zone tempo is the weapon.', 'If contested, clear the jackal through the gate.'],
  ['red-zone-22', 5, 84, 48, 'Set on the far post of the new ruck, off the box edge.', 'If manned, be the next carrier.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 47, 'Pillar on the near side of their ruck, on our line.', 'If the pillar is taken, be the guard.'],
  ['goal-line-def', 2, 3.5, 47, 'No line speed — hold and hit.', 'If they go wide, shuffle, never cross.'],
  ['goal-line-def', 3, 3, 46, 'Double tackle: the low man.', 'If second in, get under the ball.'],
  ['goal-line-def', 4, 3, 45, 'Compete only on your feet and clearly through the gate.', 'If 7 has the jackal, seal in front of him.'],
  ['goal-line-def', 5, 3.5, 44, 'Reset on the line before the next phase.', 'If they spread, spread with them.'],

  // att-maul
  ['att-maul', 1, 92, 17, 'Front-left of the maul, low, bound.', 'If the front is set, bind on the side.'],
  ['att-maul', 2, 93, 18, 'Drive with short steps; keep it square.', 'If it wheels, straighten it.'],
  ['att-maul', 3, 94.5, 20, 'Transfer the ball back through the pod.', 'If the ball is at the back, drive harder.'],
  ['att-maul', 4, 96, 22, 'On the drive over, keep binding.', 'If stopped, be the one-out pick.'],
  ['att-maul', 5, 95, 26, 'If halted, peel as the short carry option.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 33, 44, 'On the steal, second body over the ball — from behind it.', 'If secure, get depth as the carry option.'],
  ['turnover-att', 2, 35, 47, 'Get depth quickly; do not clog the transit.', 'If a back leads, run a decoy line.'],
  ['turnover-att', 3, 39, 50, 'Trail the break at 10 m.', 'If two trail inside, go outside.'],
  ['turnover-att', 4, 44, 52, 'Arrive first at the next ruck; secure it, entering behind the ball.', 'If safe, set the pillar.'],
  ['turnover-att', 5, 48, 48, 'Reload a two-man pod to keep the tempo.', 'If set, be the extra body.'],

  // turnover-def
  ['turnover-def', 1, 60, 47, 'On losing the ball, get behind the ball line first.', 'If onside already, fill the nearest hole.'],
  ['turnover-def', 2, 56, 48, 'Fill the nearest hole in the scramble line.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 48, 'Shepherd, do not chase heels.', 'If they cut back, commit.'],
  ['turnover-def', 4, 44, 47, 'Trailing tackle from behind or pillar their ruck.', 'If a jackal is on, protect him.'],
  ['turnover-def', 5, 40, 46, 'Reset the pillars, slow it down legally.', 'If short, fold with the ball.'],

  // tap-pen
  ['tap-pen', 1, 69, 34, 'Tight on the mark as the first pod.', 'If 8 is the tap carrier, latch.'],
  ['tap-pen', 2, 70.5, 35, 'Take the tap-and-go pass at pace.', 'If they are set, hold the pod.'],
  ['tap-pen', 3, 72, 36, 'Carry hard at the retreating defender.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 36, 'Roll away and rise fast; tempo is the value.', 'If contested, clear the jackal from behind.'],
  ['tap-pen', 5, 74, 33, 'Set the near pod for phase two on the short side.', 'If set, be the pillar.'],

  // pen-goal
  ['pen-goal', 1, 72, 44, 'Behind the kicker on the left.', 'If the kick is quick, hold.'],
  ['pen-goal', 2, 72, 44, 'Watch the strike; ready to advance.', 'If short, chase.'],
  ['pen-goal', 3, 60, 45, 'On the kick, jog back to the restart shape.', 'If it misses, be the drop-out chaser.'],
  ['pen-goal', 4, 52, 42, 'Take the 10 m-line receive slot as the front lifter.', 'If manned, second wave.'],
  ['pen-goal', 5, 45, 40, 'Set feet; be the shield for the catcher.', 'If they kick short, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 42, 'On the 22 left of the kicker, chase wave.', 'If the kick is long, second wave.'],
  ['drop-out-22', 2, 26, 40, 'Chase straight; connected.', 'If they catch clean, set the tackle.'],
  ['drop-out-22', 3, 32, 38, 'Contest or tackle the catcher immediately.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 42, 'Fold into the ruck-side pillar as they attack — through our gate.', 'If the pillar is set, guard.'],
  ['drop-out-22', 5, 28, 45, 'Reset the line.', 'If they kick back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 72, 'Fold to the openside as the last forward.', 'If the fold is stocked, hold the middle pod.'],
  ['wide-edge', 2, 58, 76, 'Trailing support line 5 m inside and behind the ball.', 'If the ball comes back, pillar.'],
  ['wide-edge', 3, 60, 80, 'Arrive at the wide ruck — behind the ball, in through the gate, clear the first threat.', 'If secure, stay on your feet.'],
  ['wide-edge', 4, 61, 78, 'Guard the short side after the wide ruck.', 'If 6 has it, hold the far post.'],
  ['wide-edge', 5, 62, 70, 'Reload infield to the middle pod.', 'If set, be the +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 62, 'Turn and run the shepherding arc.', 'If a back has the arc, trail.'],
  ['broken-field-def', 2, 38, 58, 'Never chase directly behind — cut the angle.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 55, 'Force them to the touchline and our back three.', 'If they cut inside, commit.'],
  ['broken-field-def', 4, 30, 52, 'Tackle the support runner or fill the pillar at the ruck.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 48, 'Reset as pillar; call the reorganised numbers.', 'If short, hold width.'],
];

export default expand(1, t);
