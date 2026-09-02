import { expand, PointTuple } from './types';

// 1 — LOOSEHEAD PROP (100 points)
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.5, 39.5, 'Bind on hooker, left of the scrum, feet split, spine in line with the tunnel.', 'Never swap sides: if 3 is on the loose head, re-form the scrum, do not free-lance.'],
  ['own-scrum-mid', 2, 48.5, 39.5, 'Hold the square on the hit, take the tighthead upwards, protect the channel-1 ball.', 'If the scrum wheels, follow the wheel, do not detach before the ball is out.'],
  ['own-scrum-mid', 3, 50, 41, 'Stay bound until 8 picks or 9 clears, then break left-and-forward off the scrum.', 'If 8 picks blind, stay bound one extra beat and become his first cleaner.'],
  ['own-scrum-mid', 4, 53, 46, 'Track the ball infield at 8-10m depth as the second-wave cleaner.', 'If 3 already trails the ball carrier, take the far shoulder of the ruck instead.'],
  ['own-scrum-mid', 5, 55, 44, 'Arrive at ruck 2, seal the near post, then set as short-side pod ball-carrier.', 'If the ruck is already secure, peel off and stand as the +1 pillar for 9.'],
  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 41.5, 'Bind low on the loose head against their tighthead; target a dominant hit to kill their exit.', 'If the scrum is under pressure, prioritise stability over the wheel.'],
  ['def-scrum-22', 2, 16.5, 41.5, 'Hold, then wheel them towards the blindside touch to shorten their options.', 'If already wheeling, keep pressure square rather than over-rotating into a penalty.'],
  ['def-scrum-22', 3, 17, 44, 'On the ball leaving, detach and become the first inside pillar right of the scrum.', 'If 3 has taken the pillar, take the second post one metre outside him.'],
  ['def-scrum-22', 4, 20, 47, 'Fold with the ball, stay square, no more than 3m from the ruck edge.', 'If 2 already fills the guard slot, drop to sweeper behind the guard.'],
  ['def-scrum-22', 5, 22, 50, 'Reset as pillar for phase 2, tackle low, do not chase out of the line.', 'If the ball goes wide, trail infield as the inside-shoulder cover.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 12, 'Front lifter at position 2 in the lineout, 5m in from touch.', 'If 3 is already front lifter, become the back lifter of the same pod.'],
  ['own-lineout-att-5', 2, 95, 12.5, 'Lift, then immediately bind to the jumper as the front of the maul.', 'If the maul is already sealed, join at the back and drive through the hips.'],
  ['own-lineout-att-5', 3, 96.5, 14, 'Drive at 45 degrees towards the posts, keep the maul square and legal.', 'If the maul is stopped, release and set as the pick-and-go carrier.'],
  ['own-lineout-att-5', 4, 98, 18, 'Convert to short carrier: one-out pick from 9 at the goal-line, low body height.', 'If 2 has the pick, become his latch and drive him over.'],
  ['own-lineout-att-5', 5, 98, 22, 'Re-set on the near post of the new ruck for the next goal-line phase.', 'If already two players on the post, fold to the far side to balance the pods.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 50, 86, 'Stand at the front of the defensive lineout, at the 5m line, ready to lift or block.', 'If 3 is at the front, take the position 2 slot as the counter-lift.'],
  ['def-lineout-mid', 2, 50, 86, 'Contest front ball or hold the ground to prevent the front peel.', 'If the throw goes long, stay put — do not chase down the lineout.'],
  ['def-lineout-mid', 3, 48, 84, 'On the ball down, become the first defender off the front, guard the 5m channel.', 'If the guard is filled, become the second man and cover the short side to touch.'],
  ['def-lineout-mid', 4, 46, 78, 'Fold with the ball infield, stay connected, no gaps larger than 1.5m.', 'If a back-rower is already inside you, hold your channel and let him lead.'],
  ['def-lineout-mid', 5, 45, 70, 'Set as ruck pillar for their phase 2, low tackle height on their tight carrier.', 'If the ball is kicked, turn and chase infield to the ruck-side sweeper line.'],
  // att-phase-mid
  ['att-phase-mid', 1, 53, 44, 'Stand as the left-hand man of the 3-man pod one pass from the ruck.', 'If the pod already has three, drop to the tail of the next pod out.'],
  ['att-phase-mid', 2, 54, 45, 'Square up, hands ready, take the pass on the gain line at pace.', 'If the ball goes past the pod, follow as inside support runner.'],
  ['att-phase-mid', 3, 56, 46, 'Carry into the inside shoulder of the last defender in the pod channel.', 'If 4 is carrying, latch on his left hip and drive him past the gain line.'],
  ['att-phase-mid', 4, 57, 47, 'Present the ball long down the middle, roll away instantly to free the ruck.', 'If cleaned out over, roll to the openside and be ready to be the next pillar.'],
  ['att-phase-mid', 5, 58, 40, 'Get up and reload into the near pod for phase +1 within 4 seconds.', 'If the pod is full, become the +1 short-side option for the scrum-half.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 47, 'Pillar A: guard the ruck, feet on the gain line, one step from the ruck edge.', 'If 3 already at pillar, become post/guard one metre outside him.'],
  ['def-line-mid', 2, 44, 45, 'Hold, do not bite in; watch the 9 snipe and the short pick.', 'If the 9 goes the other way, fold immediately with the ball to the new ruck.'],
  ['def-line-mid', 3, 43, 43, 'Tackle low and hard on any tight carrier; chop, do not go for the ball.', 'If a team-mate makes the tackle, be the first over the ball to slow it.'],
  ['def-line-mid', 4, 43, 40, 'Fold to the new breakdown, always arriving on the inside of the ball.', 'If two forwards fold with you, one stays as the sweeper behind the pillars.'],
  ['def-line-mid', 5, 43, 38, 'Re-set as pillar for phase 2, communicate the pillar/post/guard count aloud.', 'If short of numbers, hold width and let the back-rower fill the ruck edge.'],
  // kickoff-receive
  ['kickoff-receive', 1, 35, 30, 'Front-line receiver at the 10m line, left of centre, in a lifting pod.', 'If the pod is full, take the pocket 5m behind as the safety catcher.'],
  ['kickoff-receive', 2, 33, 26, 'Track the flight, call "mine/yours" early; lift the jumper if not catching.', 'If the ball is short, become the first man to the contest and seal.'],
  ['kickoff-receive', 3, 31, 24, 'Seal the catcher on landing, form the receiving maul, drive one metre.', 'If a ruck forms instead, clean out and stay on your feet.'],
  ['kickoff-receive', 4, 29, 26, 'Present for the exit: set the platform for 9 to box kick or 10 to clear.', 'If the ball is spun wide, run a tracking line infield at 10m depth.'],
  ['kickoff-receive', 5, 30, 34, 'Chase the exit kick in the inside chase channel, then re-set the line.', 'If beaten by the counter, funnel infield and become the trailing cover.'],
  // kickoff-chase
  ['kickoff-chase', 1, 49, 36, 'Stand on the halfway line in the second chase wave, left of the kicker.', 'If the contest pod is complete, become the inside-seam chaser.'],
  ['kickoff-chase', 2, 55, 33, 'Chase in a connected line, 2m behind the front chasers, never offside.', 'If the front chase is beaten, slow down and fill the front-line gap.'],
  ['kickoff-chase', 3, 60, 32, 'Arrive at the contest as the seal/cleaner if we win it, tackler if not.', 'If two players are already at the contest, hold as the first pillar.'],
  ['kickoff-chase', 4, 58, 36, 'Set the ruck-side pillar for their exit ruck, deny the short-side snipe.', 'If they kick immediately, turn and chase back to the 22.'],
  ['kickoff-chase', 5, 55, 40, 'Re-set into the defensive line at the ruck edge, low and square.', 'If out of position, run infield behind the line and fill the last gap.'],
  // exit-box-kick
  ['exit-box-kick', 1, 13, 40, 'Left post of the box-kick ruck, forming the protection L for the 9.', 'If 3 has the post, join the ruck as the extra sealing body.'],
  ['exit-box-kick', 2, 13, 40, 'Stay square, absorb the pressure, protect the 9\'s kicking pocket.', 'If pressure comes from the blindside, shuffle across and block legally.'],
  ['exit-box-kick', 3, 15, 43, 'On the kick, detach and get behind the ball fast — do not stay offside.', 'If the kick is charged down, sprint to the ball as the first cover.'],
  ['exit-box-kick', 4, 20, 45, 'Trail the chase at 10m, filling the inside channel.', 'If a chaser is beaten, become the mid-field brake in front of the counter.'],
  ['exit-box-kick', 5, 26, 46, 'Re-set into the defensive line just infield of the chase contest.', 'If the ball is returned, funnel infield and defend the inside shoulder.'],
  // counter-deep
  ['counter-deep', 1, 12, 45, 'Run back hard to be an option inside the catcher, 8-10m depth.', 'If 3 is inside the catcher, swing wider and become the second wave.'],
  ['counter-deep', 2, 15, 50, 'Offer the tight inside pass; keep the counter running away from touch.', 'If the counter goes outside you, track infield as the trailing cleaner.'],
  ['counter-deep', 3, 20, 55, 'Sprint the arc, first man to the tackle contest to secure the counter ruck.', 'If someone is over the ball already, take the far post and stay on your feet.'],
  ['counter-deep', 4, 24, 55, 'Clean, then reload into the near pod for the next phase from the 22.', 'If we are still in our 22, be the safe carrier that gets us to the 22 line.'],
  ['counter-deep', 5, 28, 50, 'Take a one-out carry to earn the metres for a clean exit kick.', 'If 8 or 4 has the carry, latch and drive.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 52, 'Inside man of the two-man tight pod one pass off the ruck.', 'If the pod is set, become the latch on the ball carrier.'],
  ['red-zone-22', 2, 81, 53, 'Short, hard carry at the inside shoulder of the post defender.', 'If 2 has the carry, latch left hip and drive low through the tackle.'],
  ['red-zone-22', 3, 82.5, 54, 'Fight for the extra metre; keep the ball off the deck, present long.', 'If held up, work back through the tackle and place towards our side.'],
  ['red-zone-22', 4, 83, 52, 'Roll away and reload immediately — red-zone tempo is the whole game.', 'If slow to rise, stay down and out of the way, do not clutter the ruck.'],
  ['red-zone-22', 5, 84, 48, 'Set on the far post of the new ruck to balance both sides of the pods.', 'If both posts are filled, become the second-phase carrier one pass out.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 47, 'Pillar on the near side of their ruck, feet on our own goal line.', 'If the pillar slot is taken, be the second pillar, shoulder-to-shoulder.'],
  ['goal-line-def', 2, 3.5, 47, 'No line speed — hold the line, deny the pick-and-go, tackle above the ball.', 'If they go the other side, shuffle, never turn your back on the ball.'],
  ['goal-line-def', 3, 3, 46, 'Make the double tackle: low man, wrap legs, stop the leg drive dead.', 'If you are the second man, get under the ball and hold him up.'],
  ['goal-line-def', 4, 3, 45, 'Compete for the held-up ball or the jackal only when clearly on your feet.', 'If 7 is already jackaling, seal in front of him and let him work.'],
  ['goal-line-def', 5, 3.5, 44, 'Re-set on the line before the next phase, count pillars aloud, no dog-legs.', 'If numbers are short on the far side, sprint across behind the line.'],
  // att-maul
  ['att-maul', 1, 92, 17, 'Front-left of the maul, bound on the ball-carrying pod, hips low.', 'If the front is full, bind at the second row of the maul and drive.'],
  ['att-maul', 2, 93, 18, 'Drive with short, choppy steps; keep the maul moving and legal.', 'If the maul swings, stay bound and reangle towards the posts.'],
  ['att-maul', 3, 94.5, 20, 'Transfer the ball back through the pod, keep the front square.', 'If the maul stalls, be the first to break and pick from the base.'],
  ['att-maul', 4, 96, 22, 'On the drive over, follow the ball, then seal any counter-ruck attempt.', 'If a try is scored, retreat immediately for the restart position.'],
  ['att-maul', 5, 95, 26, 'If halted, detach and set as the near post for the pick-and-go phase.', 'If 3 is on the near post, take the wide side of the maul remnant.'],
  // turnover-att
  ['turnover-att', 1, 33, 44, 'On the steal, become the immediate cleaner/protector of the new possession.', 'If the ball is already secure, sprint infield to be the first carrier option.'],
  ['turnover-att', 2, 35, 47, 'Get depth quickly — do not stand flat and clog the transition space.', 'If a back is taking the ball, run a hard decoy line to hold their defender.'],
  ['turnover-att', 3, 39, 50, 'Trail the break at 10m, on the inside of the ball carrier.', 'If two forwards trail, one takes the outside shoulder instead.'],
  ['turnover-att', 4, 44, 52, 'Arrive first at the next ruck; secure ball in transition, that is the priority.', 'If the ruck is safe, stand as the first pillar for the next phase.'],
  ['turnover-att', 5, 48, 48, 'Reload into a two-man pod to keep the tempo going against a broken defence.', 'If the pod is set, drift to the openside as the extra body.'],
  // turnover-def
  ['turnover-def', 1, 60, 47, 'On losing the ball, get onside instantly — get behind the ball line.', 'If already onside, sprint to the inside shoulder of their carrier.'],
  ['turnover-def', 2, 56, 48, 'Fill the nearest hole in the scramble line; do not chase the ball.', 'If the hole is filled, drop off as the second-wave brake infield.'],
  ['turnover-def', 3, 50, 48, 'Run a shepherding line, forcing them back inside towards our cover.', 'If they are outside you, keep running the arc and never give up the chase.'],
  ['turnover-def', 4, 44, 47, 'Make the trailing tackle from behind, or become the pillar at the ruck.', 'If a tackle is made in front of you, be first over the ball.'],
  ['turnover-def', 5, 40, 46, 'Re-set the pillars for their phase 2, communicate the numbers to the 9.', 'If we are short on the openside, fold with the ball rather than hold.'],
  // tap-pen
  ['tap-pen', 1, 69, 34, 'Stand tight on the mark, at the 9\'s left hip, ready for the immediate carry.', 'If 2 is the tapper, become the latch on his outside hip.'],
  ['tap-pen', 2, 70.5, 35, 'Take the tap-and-go pass at pace before their line resets 10m back.', 'If they have retreated, hold and set a pod instead of forcing the carry.'],
  ['tap-pen', 3, 72, 36, 'Carry hard at the retreating defender; win the collision, get the quick ball.', 'If tackled short, present the ball immediately for another quick tap tempo.'],
  ['tap-pen', 4, 73, 36, 'Roll away and rise fast; tempo is the entire value of the quick tap.', 'If the ruck is under threat, stay and seal instead.'],
  ['tap-pen', 5, 74, 33, 'Set the near pod for phase 2 on the short side.', 'If the short side is manned, fold openside as the second pod tail.'],
  // pen-goal
  ['pen-goal', 1, 72, 44, 'Stand behind the kicker on the left, quiet, out of his eyeline.', 'If crowded, move 5m infield to keep the kicker\'s run-up clear.'],
  ['pen-goal', 2, 72, 44, 'Watch the strike; be ready to advance the moment the ball is kicked.', 'If the kick looks short, start moving to be first to a charge-down bounce.'],
  ['pen-goal', 3, 60, 45, 'On the kick, retreat towards halfway to set the restart-receive line.', 'If we miss and they run it, stop and defend the counter first.'],
  ['pen-goal', 4, 52, 42, 'Take up the 10m-line kick-off receive slot in the front lifting pod.', 'If the pod is full, take the safety pocket behind the pod.'],
  ['pen-goal', 5, 45, 40, 'Set feet, eyes up, ready to lift or seal on the restart.', 'If a back is under the ball, protect him and form the maul.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 42, 'Line up on the 22 to the left of the kicker in the chase wave.', 'If the front chase is loaded, take the second wave inside channel.'],
  ['drop-out-22', 2, 26, 40, 'Chase in a straight line, connected with your neighbours, stay onside.', 'If the kick is long, slow to a jog and set the defensive line instead.'],
  ['drop-out-22', 3, 32, 38, 'Contest or tackle the catcher immediately; deny the counter-attack.', 'If two chasers are already there, become the first-arriving pillar.'],
  ['drop-out-22', 4, 30, 42, 'Fold into the ruck-side pillar as they set up their attack.', 'If they kick back, turn and become the escort for our catcher.'],
  ['drop-out-22', 5, 28, 45, 'Re-set line, tight channels, expect their forwards to carry at us.', 'If they attack wide, fold with the ball and hold the inside shoulder.'],
  // wide-edge
  ['wide-edge', 1, 57, 72, 'Fold to the openside as the last forward, filling the 10-15m channel.', 'If the channel is filled, stay as the short-side seal on the previous ruck.'],
  ['wide-edge', 2, 58, 76, 'Run the trailing support line 5m inside and behind the ball.', 'If a back is already the inside option, become the cleaner target instead.'],
  ['wide-edge', 3, 60, 80, 'Arrive at the wide breakdown first, secure the ball, do not over-commit.', 'If the ball is safe, stand up as the pillar on the touchline side.'],
  ['wide-edge', 4, 61, 78, 'Guard the short side after the wide ruck — most tries come from the reload.', 'If 3 is on the short side, fold back openside and become the pod tail.'],
  ['wide-edge', 5, 62, 70, 'Reload infield towards the middle pod so the field is balanced 1-3-3-1.', 'If the middle pod is set, hold as a 4th forward for the far edge.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 62, 'Turn and run the shepherding arc, aiming for a point in front of their carrier.', 'If a faster team-mate is on that arc, take the inside line behind him.'],
  ['broken-field-def', 2, 38, 58, 'Never chase directly behind — cut the angle to the touchline side.', 'If they cut back inside, brake and hold the inside channel.'],
  ['broken-field-def', 3, 33, 55, 'Force them towards the touchline and our covering back three.', 'If the winger has him covered, stop and cover the inside support runner.'],
  ['broken-field-def', 4, 30, 52, 'Tackle the support runner or fill the pillar at the resulting ruck.', 'If the pillar is filled, be the jackal-protector shield in front of 7.'],
  ['broken-field-def', 5, 28, 48, 'Re-set as pillar and call the reorganised defensive numbers aloud.', 'If we are outnumbered wide, drift and never let the line dog-leg.'],
];

export default expand(1, t);
