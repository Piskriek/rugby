import { expand, PointTuple } from './types';

// 3 — TIGHTHEAD PROP (100 points)
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.5, 60.5, 'Bind on the hooker, right of the scrum, the loosehead\'s opposite number.', 'Never swap sides — the tighthead anchors, the loosehead hits.'],
  ['own-scrum-mid', 2, 48.5, 60.5, 'Take the loosehead\'s shoulder upwards and back; you win scrums on the tight side.', 'If the scrum wheels, follow the wheel and stay bound until the ball is out.'],
  ['own-scrum-mid', 3, 50, 61, 'Stay bound until the ball is long gone, then break right-and-forward.', 'If 8 picks blind off your shoulder, stay bound one more beat and be his cleaner.'],
  ['own-scrum-mid', 4, 53, 55, 'Track the ball infield at 8-10m depth as the second-wave cleaner.', 'If 1 is trailing the carrier, take the far post of the ruck.'],
  ['own-scrum-mid', 5, 55, 52, 'Set as the short-side carrier or the +1 pillar for phase two.', 'If the short side is manned, join the openside pod as the tail.'],
  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 60.5, 'Squeeze their loosehead: down and in, kill their hit and their platform.', 'If the scrum is under real pressure, sacrifice the wheel for stability.'],
  ['def-scrum-22', 2, 16.5, 60.5, 'Hold the square, feel for the early push, and keep it legal.', 'If they wheel towards your side, resist and call it to the referee.'],
  ['def-scrum-22', 3, 17, 60, 'On the ball out, break right and become the second pillar off the scrum.', 'If 2 has the second pillar, fold around behind and chase.'],
  ['def-scrum-22', 4, 20, 55, 'Fold with the ball, square, never more than 3m from the ruck edge.', 'If 4 has the guard slot, drop behind him as the sweeper.'],
  ['def-scrum-22', 5, 22, 52, 'Reset as the pillar for their phase two; tackle low, never chase out.', 'If they go wide, trail infield as the inside-shoulder cover.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 13, 'Front lifter at position 2 in the lineout, 5m in from touch.', 'If 1 is front lifter, take the back lifter slot of the same pod.'],
  ['own-lineout-att-5', 2, 95, 13.5, 'Lift long and high, then bind instantly as the front of the maul.', 'If the maul is sealed, join at the back and drive through the hips.'],
  ['own-lineout-att-5', 3, 96.5, 15, 'Drive at 45 degrees towards the posts, maul square and legal.', 'If the maul is stopped, release and set as the pick-and-go carrier.'],
  ['own-lineout-att-5', 4, 98, 19, 'Convert to the short carrier: one-out pick from the nine at the line.', 'If 2 has the pick, become his latch and drive him over.'],
  ['own-lineout-att-5', 5, 98, 23, 'Re-set on the near post of the new ruck for the next goal-line phase.', 'If the posts are loaded, fold to the far side to balance the drive.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 50, 84, 'Front of the defensive lineout at the 5m line, ready to counter-lift.', 'If 2 is at the front, take position 2 as the second counter-lift.'],
  ['def-lineout-mid', 2, 50, 84, 'Contest front ball or hold the ground to kill the front peel.', 'If the throw goes long, hold your slot — never chase down the line.'],
  ['def-lineout-mid', 3, 48, 82, 'On the ball down, be the second defender off the front, guard the 5m channel.', 'If the guard is filled, cover the short side to touch.'],
  ['def-lineout-mid', 4, 46, 76, 'Fold with the ball infield, connected, gaps no bigger than 1.5m.', 'If a back-rower is inside you, hold your channel and let him lead.'],
  ['def-lineout-mid', 5, 45, 70, 'Set as the ruck pillar for their phase two, low tackle height.', 'If the ball is kicked, turn and chase infield to the sweeper line.'],
  // att-phase-mid
  ['att-phase-mid', 1, 53, 46, 'Right-hand man of the first pod, one pass from the ruck.', 'If the pod has three, drop to the tail of the next pod.'],
  ['att-phase-mid', 2, 54, 47, 'Square up, hands ready, take the pass at the gain line at pace.', 'If the ball goes past the pod, follow as inside support.'],
  ['att-phase-mid', 3, 56, 48, 'Carry at the outside shoulder of the last defender in the channel.', 'If 2 is carrying, latch on his right hip and drive him forward.'],
  ['att-phase-mid', 4, 57, 49, 'Present the ball long, roll away instantly to free the ruck.', 'If cleaned over, roll to the openside and be the next pillar.'],
  ['att-phase-mid', 5, 58, 43, 'Get up and reload into the near pod inside four seconds.', 'If the pod is full, be the +1 short-side option for the nine.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 46, 'Pillar B: guard the ruck on the openside shoulder, feet on the gain line.', 'If 2 has the pillar, be the guard one metre outside him.'],
  ['def-line-mid', 2, 44, 44, 'Hold the channel, do not bite in on the decoy runner.', 'If the nine goes the other way, fold with the ball immediately.'],
  ['def-line-mid', 3, 43, 42, 'Tackle low and hard on the tight carrier; chop, never go for the ball.', 'If a team-mate makes the tackle, be first over the ball.'],
  ['def-line-mid', 4, 43, 40, 'Fold to the new breakdown, always arriving on the inside of the ball.', 'If two fold with you, one stays as the sweeper.'],
  ['def-line-mid', 5, 43, 38, 'Re-set as pillar for phase two; call the pillar count aloud.', 'If short on numbers, hold width and let the back row fill the edge.'],
  // kickoff-receive
  ['kickoff-receive', 1, 35, 28, 'Front pod lifter on the 10m line, right of centre, hands high.', 'If the pod is full, take the pocket 5m behind as the safety catcher.'],
  ['kickoff-receive', 2, 33, 26, 'Lift the jumper, protect the landing, then look for the quick hit-up.', 'If the kick is short, leave it and set the platform instead.'],
  ['kickoff-receive', 3, 31, 24, 'Seal the catcher on landing and form the receiving maul.', 'If a ruck forms, clean out and stay on your feet.'],
  ['kickoff-receive', 4, 29, 26, 'Set the platform pillar for the nine\'s exit pass.', 'If the ball is spun wide, track infield at 10m as support.'],
  ['kickoff-receive', 5, 30, 32, 'Chase the exit kick down your channel, then reset the tight-five line.', 'If they counter, funnel infield as the trailing cover.'],
  // kickoff-chase
  ['kickoff-chase', 1, 49, 42, 'First chase wave, right of the target zone.', 'If the restart is short, drop back into the contest pod and lift.'],
  ['kickoff-chase', 2, 55, 44, 'Sprint your lane, onside, eyes on the ball.', 'If the kick sails over the dead ball line, turn and reset.'],
  ['kickoff-chase', 3, 60, 45, 'Contest the catch or make the immediate tackle.', 'If the contest is covered, set the first pillar.'],
  ['kickoff-chase', 4, 58, 41, 'Set the ruck-side pillar and deny the nine\'s snipe.', 'If they kick back, chase your lane infield.'],
  ['kickoff-chase', 5, 55, 38, 'Reset the tight-five line at the ruck edge, low and square.', 'If beaten on the outside, fold behind and fill the gap.'],
  // exit-box-kick
  ['exit-box-kick', 1, 13, 44, 'Left post of the box-kick ruck, forming the protection L with the hooker.', 'If the post is held, join the ruck as the extra seal.'],
  ['exit-box-kick', 2, 13, 44, 'Stay square, take the pressure, protect the kicking pocket.', 'If the rush comes from the openside, shuffle across and block legally.'],
  ['exit-box-kick', 3, 15, 46, 'On the kick, detach and get back onside fast.', 'If the kick is charged down, sprint and fall on the ball.'],
  ['exit-box-kick', 4, 20, 47, 'Chase the landing zone and contest, then reset the pillar.', 'If a back has the chase, hold the midfield brake.'],
  ['exit-box-kick', 5, 26, 46, 'Reset the tight-five line just infield of the contest.', 'If they run it back, fold with the ball, inside shoulder.'],
  // counter-deep
  ['counter-deep', 1, 12, 55, 'Run back hard as the inside option for the catcher at 8-10m depth.', 'If 1 is inside the catcher, swing wider as the second wave.'],
  ['counter-deep', 2, 15, 57, 'Take the tight carry or give the pass and keep the counter alive.', 'If the counter goes outside you, track infield as the trailer.'],
  ['counter-deep', 3, 20, 57, 'First to the counter ruck: clear, secure, tempo.', 'If the ruck is safe, take the far post.'],
  ['counter-deep', 4, 24, 55, 'Reload into the near pod for the next phase from the 22.', 'If we are still deep, be the safe carrier to the 22 line.'],
  ['counter-deep', 5, 28, 52, 'One-out carry to earn the clean exit.', 'If the backs have it, latch and drive.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 46, 'Tight pod outside man, one pass off the ruck, body low.', 'If the pod is set, latch on the carrier\'s outside hip.'],
  ['red-zone-22', 2, 81, 47, 'Short, hard carry at the post defender\'s outside shoulder.', 'If 2 carries, bind on and drive him over.'],
  ['red-zone-22', 3, 82.5, 48, 'Fight for the extra metre, present long, roll away.', 'If held up, work the ball back towards our side.'],
  ['red-zone-22', 4, 83, 46, 'Roll away and reload instantly — red-zone tempo is everything.', 'If slow to rise, stay flat and out of the nine\'s lane.'],
  ['red-zone-22', 5, 84, 44, 'Set the far post of the new ruck to balance the pods.', 'If both posts are filled, be the second-phase carrier one pass out.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 53, 'Pillar on the far side of their ruck, feet on our line.', 'If the pillar is taken, stack shoulder-to-shoulder as the second.'],
  ['goal-line-def', 2, 3.5, 53, 'No line speed — hold, deny the pick, tackle above the ball.', 'If they switch sides, shuffle, never turn your back.'],
  ['goal-line-def', 3, 3, 52, 'Double tackle: low man, wrap the legs, kill the drive.', 'If you are second in, get under the ball and hold him up.'],
  ['goal-line-def', 4, 3, 51, 'Compete for the held-up ball only when clearly on your feet.', 'If 7 is jackalling, seal in front of him.'],
  ['goal-line-def', 5, 3.5, 50, 'Re-set the line, count the posts, call their bombers.', 'If they spread, spread with them and hold the inside shoulder.'],
  // att-maul
  ['att-maul', 1, 92, 21, 'Front-right of the maul, bound on the pod, hips low.', 'If the front is packed, bind in the second rank.'],
  ['att-maul', 2, 93, 22, 'Short choppy steps, keep the maul moving and legal.', 'If the maul swings, stay bound and reangle to the posts.'],
  ['att-maul', 3, 94.5, 23, 'Transfer the ball back through the pod; keep the front square.', 'If it stalls, break off and pick from the base.'],
  ['att-maul', 4, 96, 25, 'Follow the ball in over the line, then seal the counter-ruck.', 'If the try comes, jog back for the restart.'],
  ['att-maul', 5, 95, 28, 'If halted, detach and set as the far post for the pick phase.', 'If 8 picks, latch and drive.'],
  // turnover-att
  ['turnover-att', 1, 33, 48, 'Protect the steal: first body over the new ball.', 'If it is secure, sprint infield as the first carrier option.'],
  ['turnover-att', 2, 35, 50, 'Get depth fast, do not clog the transition space.', 'If a back leads, run the hard decoy line.'],
  ['turnover-att', 3, 39, 52, 'Trail the break at 10m on the inside.', 'If two are inside, take the outside.'],
  ['turnover-att', 4, 44, 53, 'First to the next ruck, secure the ball in transition.', 'If the ruck is safe, stand as the first pillar.'],
  ['turnover-att', 5, 48, 50, 'Reload into the two-man pod, keep the tempo on the broken field.', 'If the pod is set, drift openside as the extra body.'],
  // turnover-def
  ['turnover-def', 1, 60, 50, 'Ball lost — get back onside behind the ball line.', 'If already onside, sprint to their carrier\'s inside shoulder.'],
  ['turnover-def', 2, 56, 51, 'Fill the nearest hole in the scramble line.', 'If the holes are filled, drop off as the second brake.'],
  ['turnover-def', 3, 50, 50, 'Shepherd them back inside to the cover.', 'If they are outside you, run the arc and never give in.'],
  ['turnover-def', 4, 44, 49, 'Trailing tackle or the pillar at their ruck.', 'If the tackle is made in front, be first over the ball.'],
  ['turnover-def', 5, 40, 48, 'Reset the pillars and slow their recycle.', 'If we are short, fold with the ball, concede metres not the line.'],
  // tap-pen
  ['tap-pen', 1, 69, 38, 'Tight on the mark at the tapper\'s outside hip, ready to latch.', 'If 8 takes the tap, drive his inside shoulder.'],
  ['tap-pen', 2, 70.5, 39, 'Take the tap-and-go at pace into the retreating line.', 'If they have retreated 10, hold and set the pod.'],
  ['tap-pen', 3, 72, 40, 'Carry hard, win the collision, get quick ball.', 'If tackled short, present long and immediate.'],
  ['tap-pen', 4, 73, 40, 'Roll away fast — the next tap must be faster.', 'If the ruck is threatened, stay and seal.'],
  ['tap-pen', 5, 74, 37, 'Set the short-side pod for phase two.', 'If the short side is manned, fold openside.'],
  // pen-goal
  ['pen-goal', 1, 72, 47, 'Behind the kicker\'s right shoulder, still, out of his eyeline.', 'If crowded, move infield and clear his run-up.'],
  ['pen-goal', 2, 72, 47, 'Watch the strike, be ready to advance.', 'If it looks short, go for the charge-down bounce.'],
  ['pen-goal', 3, 60, 48, 'On the kick, jog back to the restart mark.', 'If they run it back, defend first.'],
  ['pen-goal', 4, 52, 46, 'Front-pod lifter slot at the 10m line for the restart.', 'If the pod is full, hold the pocket.'],
  ['pen-goal', 5, 45, 44, 'Set feet, ready to lift or seal.', 'If a back is under it, form the maul.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 46, 'Line up on the 22 to the right of the kicker in the chase wave.', 'If the front is loaded, take the second wave.'],
  ['drop-out-22', 2, 26, 48, 'Chase connected and onside.', 'If the kick is long, slow and set the line.'],
  ['drop-out-22', 3, 32, 50, 'Tackle the catcher, deny the counter.', 'If two are there, set the pillar.'],
  ['drop-out-22', 4, 30, 46, 'Fold to the ruck-side pillar.', 'If they kick back, escort our catcher.'],
  ['drop-out-22', 5, 28, 44, 'Reset the tight channels for their forwards\' carries.', 'If they go wide, fold, inside shoulder.'],
  // wide-edge
  ['wide-edge', 1, 57, 74, 'Fold openside into the 10-15m channel as the last tight five.', 'If the channel is filled, seal the short side at the old ruck.'],
  ['wide-edge', 2, 58, 77, 'Trail five metres inside and behind the ball.', 'If a back is the cover, become the cleaner.'],
  ['wide-edge', 3, 60, 80, 'First to the wide ruck, secure, do not over-commit.', 'If safe, stand as the touch-side pillar.'],
  ['wide-edge', 4, 61, 78, 'Guard the short side after the wide ruck.', 'If 2 is short-side, fold back openside.'],
  ['wide-edge', 5, 62, 72, 'Reload infield to balance one-three-three-one.', 'If the middle pod is set, hold the edge.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 58, 'Turn and run the shepherding arc in front of their carrier.', 'If a faster man has the arc, take the line behind.'],
  ['broken-field-def', 2, 38, 56, 'Never chase behind — cut the angle to the touchline.', 'If they cut back inside, brake and hold.'],
  ['broken-field-def', 3, 33, 54, 'Force them wide to the cover.', 'If the wing has him, take the support runner.'],
  ['broken-field-def', 4, 30, 51, 'Tackle the support or fill the ruck pillar.', 'If filled, shield the jackal.'],
  ['broken-field-def', 5, 28, 48, 'Reset the pillars and call the numbers.', 'If outnumbered wide, drift, never dog-leg.'],
];

export default expand(3, t);
