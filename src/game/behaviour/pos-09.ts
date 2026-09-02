import { expand, PointTuple } from './types';

// 9 — SCRUM-HALF (100 points)
const t: PointTuple[] = [
  ['own-scrum-mid', 1, 47, 41, 'Stand at the tunnel on the left of the scrum ready to feed.', 'Nobody else takes this role; if injured, 7 or 10 covers the feed.'],
  ['own-scrum-mid', 2, 46, 40, 'Feed straight and quick; then move to the base at the 8\'s feet.', 'If the scrum is unstable, hold at the base and wait.'],
  ['own-scrum-mid', 3, 45, 38, 'Take the ball from the base; scan the blindside before passing.', 'If the blindside is open and 8 is bound, snipe it yourself.'],
  ['own-scrum-mid', 4, 47, 42, 'Pass to 10 standing at 10-12m depth, or box kick if the exit is on.', 'If 8 picks, follow him and be his link at the ruck.'],
  ['own-scrum-mid', 5, 53, 45, 'Arrive at the first ruck as the link; set the tempo for phase 2.', 'If a forward is over the ball, call the clean and manage the ruck.'],

  ['def-scrum-22', 1, 16, 42, 'Stand at their scrum edge on the openside, marking their 9.', 'If 7 marks the 9, guard the blindside channel yourself.'],
  ['def-scrum-22', 2, 16.5, 43, 'Shadow their 9 around the base; do not commit early.', 'If their 8 picks, become the tackler on his inside.'],
  ['def-scrum-22', 3, 18, 45, 'Pressure the 9\'s pass or box kick; harass, do not offside.', 'If they clear the ball, drop instantly into the sweeper role.'],
  ['def-scrum-22', 4, 15, 48, 'Drop back as the sweeper for their exit kick.', 'If 15 fields it, become the first support option.'],
  ['def-scrum-22', 5, 19, 46, 'Be the link at the ruck if we counter; organise the box exit.', 'If they retain the ball, guard the ruck edge.'],

  ['own-lineout-att-5', 1, 95, 16, 'Stand behind the lineout at the receiver position, ball in hands.', 'If 2 needs a target, communicate the call; never leave the receiver slot.'],
  ['own-lineout-att-5', 2, 95, 18, 'Follow the maul at the back; be the outlet if it is halted.', 'If the maul is being turned, take the ball out immediately.'],
  ['own-lineout-att-5', 3, 96, 21, 'Control the maul base; call "hold" while it advances.', 'If the ball is at the back with 8, be his link.'],
  ['own-lineout-att-5', 4, 97.5, 24, 'Snipe the blindside of the maul if their guards have folded in.', 'If they are covered, feed the pick-and-go carrier.'],
  ['own-lineout-att-5', 5, 98, 28, 'Manage the goal-line phases; sub-3-second recycles, vary the side.', 'If forwards are slow, delay one beat rather than pass into contact.'],

  ['def-lineout-mid', 1, 50, 91, 'Stand opposite their receiver, marking their 9\'s running channel.', 'If 6/7 covers the 9, take the guard slot at the front of the lineout.'],
  ['def-lineout-mid', 2, 50, 90, 'Track their 9 as the ball comes down; deny the quick snipe.', 'If a maul forms, get behind it as the sweeper.'],
  ['def-lineout-mid', 3, 47, 86, 'Follow the ball; become the pillar defender at their first ruck.', 'If 7 has the ruck edge, drop as sweeper for the box kick.'],
  ['def-lineout-mid', 4, 40, 80, 'Sweep behind the defensive line, covering their kick.', 'If we press, hold the pillar and shout the numbers.'],
  ['def-lineout-mid', 5, 44, 78, 'Re-set as pillar or sweeper depending on their shape.', 'If they kick, sprint to the ball as the first receiver.'],

  ['att-phase-mid', 1, 55, 50, 'Stand at the back of the ruck, hands on the ball, head up.', 'This slot is yours alone; if you are in the ruck, 10 or 7 takes it.'],
  ['att-phase-mid', 2, 55, 50, 'Scan: pod, wide, kick or snipe. Decide before the ball is available.', 'If the ruck is slow, do not pass into pressure — reset the tempo.'],
  ['att-phase-mid', 3, 55.5, 51, 'Deliver a flat, fast pass to the pod or a long pull-back to 10.', 'If the guard is asleep, snipe the ruck-edge gap yourself.'],
  ['att-phase-mid', 4, 57, 52, 'Follow the ball; be the link at the next breakdown.', 'If the ball goes wide, sprint the arc to the next ruck.'],
  ['att-phase-mid', 5, 58, 53, 'Arrive at the next ruck, organise the forwards, restart the cycle.', 'If a forward is at the base, take the first-receiver slot instead.'],

  ['def-line-mid', 1, 44, 50, 'Stand as the ruck-side sweeper or the second pillar.', 'If 15 is deep, take the pillar; if pillars are filled, sweep.'],
  ['def-line-mid', 2, 43, 49, 'Talk the line: call pillars, guards and numbers each side.', 'If their 9 snipes, you are the tackler.'],
  ['def-line-mid', 3, 42, 48, 'Cover the box kick and the chip in behind the front line.', 'If we press, hold the pillar and do not chase the ball.'],
  ['def-line-mid', 4, 40, 47, 'Sweep behind the line, tracking the ball across the field.', 'If 15 covers deep, stay shallow at 10-15m.'],
  ['def-line-mid', 5, 43, 46, 'Re-set to the new ruck edge, keep talking, keep the count.', 'If the ball is kicked, become the first receiver of the return.'],

  ['kickoff-receive', 1, 28, 46, 'Stand behind the receiving pods, ready to take the ball back.', 'If a forward secures it, take up the base position immediately.'],
  ['kickoff-receive', 2, 28, 44, 'Call the pod that should take it; organise the seal.', 'If the ball drops loose, be the first to it and secure.'],
  ['kickoff-receive', 3, 27, 43, 'Get to the base of the receiving maul or ruck.', 'If a maul forms, stay at the back for the outlet.'],
  ['kickoff-receive', 4, 26, 42, 'Box kick the exit long to the 15m channel, or pass to 10.', 'If pressure is on, pass to 10 for the touch-finder.'],
  ['kickoff-receive', 5, 28, 46, 'Follow the exit kick as the sweeper behind the chase line.', 'If they counter, be the organiser in behind.'],

  ['kickoff-chase', 1, 48, 44, 'Stand behind the chase line as the organiser and sweeper.', 'If the chase pods are short, chase the seam instead.'],
  ['kickoff-chase', 2, 54, 43, 'Follow 10m behind the chase; cover the tap-back and the counter.', 'If the ball is tapped back, be the man who collects it.'],
  ['kickoff-chase', 3, 58, 42, 'Secure the tap-back and set the attacking phase immediately.', 'If they win it, become the pillar at their exit ruck.'],
  ['kickoff-chase', 4, 56, 44, 'Pressure their 9 at the exit ruck; deny the quick box kick.', 'If they kick, drop as the sweeper.'],
  ['kickoff-chase', 5, 53, 46, 'Re-set as the ruck-side defender and talk the line into shape.', 'If out of position, sweep behind the line.'],

  ['exit-box-kick', 1, 14, 42, 'Stand at the base of the ruck in your kicking pocket.', 'This is your role: no substitute unless you are in the ruck.'],
  ['exit-box-kick', 2, 13, 41, 'Set the protection: call the L-shape and check the chase is ready.', 'If protection is not set, delay one beat and re-call.'],
  ['exit-box-kick', 3, 13, 40, 'Box kick 30-40m into the 15m channel, hang time over distance.', 'If pressure arrives, pass to 10 for the long touch-finder.'],
  ['exit-box-kick', 4, 18, 44, 'Follow the kick as the sweeper 15m behind the chase line.', 'If we win it back, be the link at the contest.'],
  ['exit-box-kick', 5, 24, 46, 'Organise the defensive re-set; call the pillars.', 'If they counter, funnel back as the last-line support to 15.'],

  ['counter-deep', 1, 14, 50, 'Sprint to be the inside support for the catcher, calling the option.', 'If a forward is inside, take the pull-back link position.'],
  ['counter-deep', 2, 17, 54, 'Take the ball on the switch and change the point of attack.', 'If the counter goes wide, sprint the arc behind the ball.'],
  ['counter-deep', 3, 22, 58, 'Arrive at the counter ruck; get the ball moving in under 3 seconds.', 'If forwards are slow, control the ball at the base and wait.'],
  ['counter-deep', 4, 26, 56, 'Play to the space or box kick if the counter is shut down.', 'If we are still in the 22, prefer the kick over the risk.'],
  ['counter-deep', 5, 30, 52, 'Manage the exit sequence; call the shape and tempo.', 'If we kick, sweep behind the chase.'],

  ['red-zone-22', 1, 82, 52, 'At the base of the red-zone ruck, head up, scanning the fringes.', 'If you are in the ruck, 7 or 8 takes the base.'],
  ['red-zone-22', 2, 82, 52, 'Look for the sleeping guard; the snipe is the highest-yield red-zone play.', 'If they are set, feed the tight pod and keep tempo.'],
  ['red-zone-22', 3, 83, 53, 'Snipe or pass flat; never a slow, floated pass this close in.', 'If the ruck is slow, wait — do not force a turnover.'],
  ['red-zone-22', 4, 84, 54, 'Follow the carrier and be at the base within two seconds.', 'If a forward is at the base, take the first-receiver slot.'],
  ['red-zone-22', 5, 85, 52, 'Vary the side; three phases one way, then swing the ball wide.', 'If forwards are gassed, call the wide play early.'],

  ['goal-line-def', 1, 5, 50, 'Stand as the pillar on the ruck edge or the sweeper behind the line.', 'If pillars are filled, sweep behind for the chip and the grubber.'],
  ['goal-line-def', 2, 4.5, 50, 'Talk constantly: pillar, post, guard on both sides.', 'If their 9 snipes, you are the tackler.'],
  ['goal-line-def', 3, 4, 49, 'Tackle their 9 or fill the smallest gap on the line.', 'If a team-mate tackles, help drive him back.'],
  ['goal-line-def', 4, 3, 48, 'Sweep the in-goal for the grubber and the cross kick.', 'If 15 covers it, hold the line and count.'],
  ['goal-line-def', 5, 4.5, 47, 'Re-set, recount, and keep the line flat with no dog-legs.', 'If we win the ball, box kick immediately for relief.'],

  ['att-maul', 1, 92, 22, 'Stand at the back of the maul controlling the ball delivery.', 'If 8 has the ball, be the link outside the maul.'],
  ['att-maul', 2, 93, 24, 'Follow the maul, hands ready, watching their defensive fold.', 'If the maul is turned, take the ball out immediately.'],
  ['att-maul', 3, 94.5, 26, 'Snipe the blindside if their guards commit to the maul.', 'If covered, feed the pick-and-go carrier.'],
  ['att-maul', 4, 96, 28, 'Manage the drive: call "hold" while it moves, "away" if it stalls.', 'If a try is on at the back, dive over yourself.'],
  ['att-maul', 5, 96, 32, 'Set the next phase, keeping the tempo under 3 seconds.', 'If forwards are slow, delay and re-shape.'],

  ['turnover-att', 1, 35, 45, 'Get to the turnover ball immediately; you are the transition trigger.', 'If a forward carries it away, be his link.'],
  ['turnover-att', 2, 37, 47, 'Pass to space before the defence re-sets; two seconds decide it.', 'If nobody is up, snipe the space yourself.'],
  ['turnover-att', 3, 42, 50, 'Follow the break as the closest support and link.', 'If the break is long, sprint and be the man at the next ruck.'],
  ['turnover-att', 4, 47, 53, 'At the next ruck, keep the tempo; play away from the previous ruck.', 'If forwards are absent, box kick to the space behind.'],
  ['turnover-att', 5, 51, 51, 'Organise the shape for phase 3; call the pods into place.', 'If they have re-set, revert to structured attack.'],

  ['turnover-def', 1, 59, 45, 'Become the sweeper immediately; you are the second-last line.', 'If 15 sweeps deep, hold at 10-15m behind the line.'],
  ['turnover-def', 2, 54, 46, 'Track infield of the ball, covering the kick and the cut-back.', 'If a hole appears in the line, fill it.'],
  ['turnover-def', 3, 49, 46, 'Make the cover tackle or slow them to let the line reset.', 'If they cut back inside, commit to the tackle.'],
  ['turnover-def', 4, 44, 46, 'Take the pillar at the resulting ruck and start talking.', 'If 7 is jackaling, protect him.'],
  ['turnover-def', 5, 41, 45, 'Re-set the defence by voice: pillars, guards, sweep.', 'If they kick, sprint back to support 15.'],

  ['tap-pen', 1, 70, 35, 'Stand on the mark with the ball, scanning their retreat.', 'You are always the tap decision maker unless 10 calls otherwise.'],
  ['tap-pen', 2, 70, 35, 'Tap and go yourself, or feed the arrowhead carrier.', 'If they are already set at 10m, do not tap — set a structured phase.'],
  ['tap-pen', 3, 71.5, 36, 'Support the carrier; be at the base of the next ruck instantly.', 'If the carrier breaks, be his inside support.'],
  ['tap-pen', 4, 73, 37, 'Keep the tempo: sub-2-second recycles beat organised defences.', 'If the ruck is slow, slow down and re-shape.'],
  ['tap-pen', 5, 75, 38, 'Phase 3: snipe, pod or wide depending on their fold.', 'If they are set, pull back to 10 for the wide play.'],

  ['pen-goal', 1, 72, 50, 'Place the ball on the tee or hand it to the kicker.', 'If 10 kicks, retreat and organise the restart line.'],
  ['pen-goal', 2, 72, 50, 'Stand back and quiet; watch the strike.', 'If it falls short, be the fastest to react.'],
  ['pen-goal', 3, 60, 48, 'Retreat to organise the restart-receive shape.', 'If they counter, defend first.'],
  ['pen-goal', 4, 30, 48, 'Take the position behind the pods for the restart.', 'If we are kicking off, stand behind the kicker as the sweeper.'],
  ['pen-goal', 5, 28, 47, 'Ready to receive the ball at the base of the receiving maul.', 'If it goes long, support 15.'],

  ['drop-out-22', 1, 21, 47, 'Stand beside the kicker; you may take the quick drop-out.', 'If 10 kicks, be the escort and chase organiser.'],
  ['drop-out-22', 2, 24, 48, 'Follow the chase as the sweeper 10m behind.', 'If it is contestable, position to collect the tap-back.'],
  ['drop-out-22', 3, 30, 47, 'Collect the loose ball or pressure their 9 at the ruck.', 'If they secure it, become the pillar.'],
  ['drop-out-22', 4, 30, 48, 'Talk the defensive line into shape; call the count.', 'If they kick back, sprint to support the catcher.'],
  ['drop-out-22', 5, 28, 48, 'Sweep behind the line for the box kick and the chip.', 'If we press up, hold the pillar.'],

  ['wide-edge', 1, 60, 80, 'At the base of the edge ruck, ready to swing the ball back infield.', 'If you are in the ruck, 7 takes the base.'],
  ['wide-edge', 2, 60, 80, 'Scan the short side; it is usually understaffed after a wide ruck.', 'If the short side is covered, play back infield to the pods.'],
  ['wide-edge', 3, 61, 78, 'Snipe or pass to the blindside winger arriving on the short side.', 'If the winger is not there, box kick to the space.'],
  ['wide-edge', 4, 62, 74, 'Follow the ball and be the link at the next ruck.', 'If the ball goes to a forward pod, be at the base within 2 seconds.'],
  ['wide-edge', 5, 62, 66, 'Restore the tempo and pull the shape back towards the middle.', 'If forwards are slow, hold the ball and control the clock.'],

  ['broken-field-def', 1, 40, 62, 'Drop instantly into the second-last line, infield of the ball.', 'If 15 is deep, hold at 10-15m as the middle sweeper.'],
  ['broken-field-def', 2, 36, 58, 'Cover the inside cut-back and the grubber behind the scramble.', 'If they cut inside, be the tackler.'],
  ['broken-field-def', 3, 32, 55, 'Slow the carrier or force him wide to buy the line time.', 'If covered, mark the trailing support runner.'],
  ['broken-field-def', 4, 30, 52, 'Take the pillar at the resulting ruck; get the line talking.', 'If 7 jackals, protect him.'],
  ['broken-field-def', 5, 28, 49, 'Re-organise the defence by voice; count both sides aloud.', 'If short of numbers, call the drift and hold the sweep.'],
];

export default expand(9, t);
