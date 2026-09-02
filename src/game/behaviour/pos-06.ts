import { expand, PointTuple } from './types';

// 6 — BLINDSIDE FLANKER (100 points)
const t: PointTuple[] = [
  ['own-scrum-mid', 1, 46.5, 39.5, 'Bind on the left flank of the scrum, head between 1 and 4, blindside shoulder.', 'If 7 is on the blindside, take the openside flank — never both on one side.'],
  ['own-scrum-mid', 2, 46.5, 39.5, 'Push square; keep the scrum stable so the 8 can control the base.', 'If we are being wheeled, resist by driving forward on your flank.'],
  ['own-scrum-mid', 3, 47.5, 41, 'Detach as the ball leaves; first blindside option for 9 or 8.', 'If 8 picks, latch immediately and drive him past the gain line.'],
  ['own-scrum-mid', 4, 50, 44, 'Carry hard off the scrum-base or clean at the first ruck.', 'If 8 carried, be the first cleaner, arriving low and square.'],
  ['own-scrum-mid', 5, 53, 46, 'Reload into the near pod as the second-phase carrier.', 'If the pod is set, be the +1 short-side threat for the 9.'],

  ['def-scrum-22', 1, 15, 41.5, 'Bind on the blindside flank; watch their 8 and 9 for the pick or snipe.', 'If 7 is blindside, take the openside flank.'],
  ['def-scrum-22', 2, 15, 41.5, 'Stay bound until the ball is out — do not break early and concede a penalty.', 'If their 8 picks, detach and hit him behind the gain line.'],
  ['def-scrum-22', 3, 16, 44, 'Detach and press their 9 / short side channel immediately.', 'If the channel is covered, fold openside as a guard.'],
  ['def-scrum-22', 4, 19, 46, 'Chase their exit kicker or tackle the first receiver dominantly.', 'If they kick, turn and cover the field behind you.'],
  ['def-scrum-22', 5, 22, 48, 'Jackal or guard at their first ruck; slow the exit tempo.', 'If not on your feet, get back into the line.'],

  ['own-lineout-att-5', 1, 95, 19, 'Tail of the lineout at position 6; primary tail-jump option.', 'If 5 has the tail jump, become his lifter.'],
  ['own-lineout-att-5', 2, 95.5, 19, 'Jump/lift, then bind to the maul at the back as the driving engine.', 'If the maul is set, join the back and steer it towards the posts.'],
  ['own-lineout-att-5', 3, 96.5, 20, 'Drive the maul; be ready to peel off the back if it stalls.', 'If the maul is moving, stay bound and keep driving.'],
  ['own-lineout-att-5', 4, 97.5, 23, 'Peel off the back and carry at the short side or the guard.', 'If 8 takes the ball off the back, latch him.'],
  ['own-lineout-att-5', 5, 98, 27, 'Set at the new ruck as the near-post carrier for the next pick.', 'If posts are filled, become the 9\'s wide-of-post option.'],

  ['def-lineout-mid', 1, 50, 92, 'Stand at the tail of the defensive lineout, marking their tail jumper.', 'If 5 is at the tail, take the position 4 slot.'],
  ['def-lineout-mid', 2, 50, 92, 'Watch the throw; be the first man to press their 10 off a tail catch.', 'If they maul, hit the back-side shoulder legally.'],
  ['def-lineout-mid', 3, 48, 88, 'On the tail catch, line-speed on their first receiver.', 'If a back is already pressing, hold the tail channel.'],
  ['def-lineout-mid', 4, 46, 82, 'Fold with the ball; be the first back-rower into their breakdown.', 'If 7 is jackaling, protect him from their cleaner.'],
  ['def-lineout-mid', 5, 45, 76, 'Set as guard for their phase 2 and dominate the collision.', 'If they kick, turn and cover the backfield seam.'],

  ['att-phase-mid', 1, 53, 61, 'Edge forward of the far pod, the link between forwards and backs.', 'If the pod is set, push out to be the +1 outside the backline.'],
  ['att-phase-mid', 2, 54, 62, 'Get depth, hit the line at pace, hunt the seam outside the guard.', 'If the ball goes wide, run the trailing support line.'],
  ['att-phase-mid', 3, 56, 64, 'Carry into the space outside the last forward defender.', 'If a back carries, be the first support on his inside shoulder.'],
  ['att-phase-mid', 4, 57, 65, 'Present or offload; then clean the next ruck if you did not carry.', 'If the ruck is safe, stay on your feet as the pillar.'],
  ['att-phase-mid', 5, 58, 58, 'Reload towards the middle pod within 4 seconds.', 'If the middle is set, hold the edge as the extra body.'],

  ['def-line-mid', 1, 44, 58, 'Line defender outside the guard, first forward in the wide channel.', 'If a back-rower is there, take the next channel out and connect.'],
  ['def-line-mid', 2, 44, 61, 'Lead the line speed; be square and never drift before the pass.', 'If your outside man shoots, hold the inside shoulder for him.'],
  ['def-line-mid', 3, 43, 63, 'Dominant chop or choke tackle on their edge carrier.', 'If a team-mate tackles, be first to the jackal contest.'],
  ['def-line-mid', 4, 43, 60, 'Compete for the ball or clear out their cleaner; then re-set.', 'If not on your feet, get back into the line immediately.'],
  ['def-line-mid', 5, 43, 56, 'Fold inside with the ball and re-set as the guard.', 'If numbers are short, hold your channel and let props fold.'],

  ['kickoff-receive', 1, 34, 44, 'Front-line lifter/receiver in the right pod on the 10m line.', 'If the pod is full, drop 5m as the safety catcher.'],
  ['kickoff-receive', 2, 33, 42, 'Lift the jumper or attack the ball if the kick is short.', 'If it drops behind the pod, sprint back and become the catcher.'],
  ['kickoff-receive', 3, 31, 40, 'Seal the catcher, form the receiving maul.', 'If it becomes a ruck, clean out and stay on your feet.'],
  ['kickoff-receive', 4, 29, 42, 'Protect the 9\'s pocket for the exit kick.', 'If we run it, be the tight support runner.'],
  ['kickoff-receive', 5, 31, 46, 'Chase the exit kick as the front-line chaser.', 'If beaten, funnel infield and become the brake.'],

  ['kickoff-chase', 1, 49, 32, 'Front-line chaser just left of the kicker, closest to the drop zone.', 'If the contest pod is set, chase the inside seam beside it.'],
  ['kickoff-chase', 2, 56, 30, 'Sprint the fastest chase line; be first to the catcher.', 'If you cannot get there, slow and cover the tap-back.'],
  ['kickoff-chase', 3, 61, 29, 'Tackle the catcher before he gets support, or contest the tap-back.', 'If the catcher is already tackled, jackal immediately.'],
  ['kickoff-chase', 4, 59, 33, 'Jackal or pressure their exit; make them kick under pressure.', 'If they clear, turn and chase back onside.'],
  ['kickoff-chase', 5, 55, 37, 'Re-set into the line in the wide forward channel.', 'If out of position, fill the widest gap.'],

  ['exit-box-kick', 1, 13, 39, 'Stand as the blindside guard beside the box-kick ruck.', 'If the guard is there, join the protection wall for the 9.'],
  ['exit-box-kick', 2, 13, 39, 'Watch for their 9 pressuring; protect the kicking pocket.', 'If the ruck is threatened, add weight low.'],
  ['exit-box-kick', 3, 17, 42, 'On the kick, chase hard as the second chaser inside the winger.', 'If the kick is short, sprint to tackle the catcher.'],
  ['exit-box-kick', 4, 24, 45, 'Arrive at the contest; tackle or jackal on the catcher.', 'If the winger contests, be the ground support and jackal.'],
  ['exit-box-kick', 5, 28, 46, 'Set the guard at the resulting ruck.', 'If they counter, funnel infield as cover.'],

  ['counter-deep', 1, 12, 56, 'Sprint back to be the outside support for the catcher.', 'If someone is outside, take the inside seam line.'],
  ['counter-deep', 2, 16, 60, 'Take the ball at pace on the angle to beat the first chaser.', 'If the counter goes wide, track behind the ball.'],
  ['counter-deep', 3, 22, 63, 'Support the break; be the first to the counter-attack ruck.', 'If secure, stand up as the pillar.'],
  ['counter-deep', 4, 26, 60, 'Reload as the wide pod carrier to keep the counter alive.', 'If we are pinned, help to build the platform for the kick.'],
  ['counter-deep', 5, 31, 56, 'Carry us past the 22 so 10 can kick from open play.', 'If we kick early, chase in the outside channel.'],

  ['red-zone-22', 1, 80, 62, 'Edge forward outside the tight pod in the red zone.', 'If the edge is stocked, take the tight pod latch role.'],
  ['red-zone-22', 2, 81, 64, 'Attack the seam between the last forward and their first back.', 'If a back carries, support on his inside shoulder.'],
  ['red-zone-22', 3, 83, 66, 'Fight for the line; look for the offload to a trailing runner.', 'If held up, twist and place backwards.'],
  ['red-zone-22', 4, 84, 64, 'Present, roll and rise for a sub-3-second ruck.', 'If contested, secure the ball first.'],
  ['red-zone-22', 5, 85, 58, 'Reload to the near pod to balance the goal-line attack.', 'If balanced, be the wide decoy to pin their winger.'],

  ['goal-line-def', 1, 4, 59, 'Line defender outside the guard on our own goal line.', 'If that channel is taken, move one wider and connect.'],
  ['goal-line-def', 2, 3.5, 61, 'No line speed; hold the line, deny the short pop and the wrap.', 'If they switch sides, shuffle across the line, never around.'],
  ['goal-line-def', 3, 3, 62, 'Make the choke tackle to hold the ball up over the line.', 'If second man, wrap the legs and drive backwards.'],
  ['goal-line-def', 4, 3, 60, 'Jackal for the goal-line turnover, the highest-value steal in rugby.', 'If not clearly on your feet, get back on the line.'],
  ['goal-line-def', 5, 3.5, 57, 'Re-set on the line, recount, no dog-legs.', 'If short on the far side, sprint behind the line.'],

  ['att-maul', 1, 92, 22, 'Bound at the back of the maul as the driving engine and ball option.', 'If 8 is at the back, drive from the second row of the maul.'],
  ['att-maul', 2, 93, 23, 'Drive low; steer the maul at the posts with the pack.', 'If the maul stalls, break and take the ball.'],
  ['att-maul', 3, 94.5, 25, 'Peel off the back and carry short if the maul is halted.', 'If it is still moving, stay bound and keep driving.'],
  ['att-maul', 4, 96, 27, 'Get over the gain line and present for the pick-and-go phase.', 'If a try is on, dive for the corner.'],
  ['att-maul', 5, 95, 31, 'Set as the near post at the new ruck.', 'If posts are filled, be the 9\'s short carry option.'],

  ['turnover-att', 1, 34, 44, 'You may be the turnover winner — secure and present, or carry away.', 'If 7 won the steal, be his protector then get the ball moving.'],
  ['turnover-att', 2, 37, 47, 'Attack the space immediately; two seconds of chaos is the window.', 'If a back has it, run a hard support line.'],
  ['turnover-att', 3, 42, 51, 'Trail on the inside shoulder of the break for the offload.', 'If two trail inside, take the outside line.'],
  ['turnover-att', 4, 47, 54, 'Secure the transition ruck as the first arriving forward.', 'If secure, stand as pillar for the next phase.'],
  ['turnover-att', 5, 51, 52, 'Reload into the fast pod to attack the unset defence again.', 'If set, drift to the far edge as the extra.'],

  ['turnover-def', 1, 60, 49, 'Get onside and immediately hunt the ball carrier.', 'If already onside, run the shepherding arc.'],
  ['turnover-def', 2, 55, 51, 'Fill the widest hole in the scramble line; back-rowers cover the edges.', 'If filled, become the second-wave brake.'],
  ['turnover-def', 3, 50, 53, 'Shepherd them towards touch and force the pass.', 'If they cut back inside, commit to the tackle.'],
  ['turnover-def', 4, 45, 53, 'Make the tackle then contest immediately — they will be isolated.', 'If not on your feet, re-set into the line.'],
  ['turnover-def', 5, 41, 52, 'Set the guard, call the numbers, connect the reformed line.', 'If short wide, keep folding with the ball.'],

  ['tap-pen', 1, 69, 39, 'Stand at 5m depth as the wide option in the tap arrowhead.', 'If 4 or 5 is carrying, latch and drive.'],
  ['tap-pen', 2, 71, 40, 'Take the second or third carry once the tight carries have fixed them.', 'If they are set, form the pod and go through structure.'],
  ['tap-pen', 3, 72.5, 42, 'Attack the seam outside their retreating forwards.', 'If tackled, present instantly to keep tempo.'],
  ['tap-pen', 4, 73.5, 42, 'Roll away, rise fast, reload.', 'If the ruck is threatened, seal.'],
  ['tap-pen', 5, 75, 46, 'Set as the edge carrier for phase 3.', 'If the edge is set, fold back to the middle.'],

  ['pen-goal', 1, 72, 58, 'Stand behind the kicker, quiet, wide of the run-up.', 'If crowded, spread wider.'],
  ['pen-goal', 2, 72, 58, 'Be alert for a short kick or charge-down; be first to react.', 'If clearly good, retreat for the restart.'],
  ['pen-goal', 3, 60, 56, 'Retreat towards halfway into the receive shape.', 'If they counter, defend first.'],
  ['pen-goal', 4, 51, 52, 'Take the front pod lifter slot on the 10m line.', 'If the pod is full, be the safety catcher behind.'],
  ['pen-goal', 5, 44, 50, 'Set feet, ready to lift, seal or chase.', 'If the kick is long, drop back with the sweepers.'],

  ['drop-out-22', 1, 21, 38, 'Front-line chaser on the 22, left of the kicker.', 'If the front rank is full, chase the inside seam.'],
  ['drop-out-22', 2, 28, 36, 'Sprint the chase line to arrive as the ball lands.', 'If it is long, slow and re-set the line.'],
  ['drop-out-22', 3, 34, 34, 'Tackle the catcher immediately; deny the counter.', 'If two chasers are there, be the jackal on the deck.'],
  ['drop-out-22', 4, 32, 38, 'Jackal or guard at their ruck; slow their ball.', 'If they kick back, escort our catcher.'],
  ['drop-out-22', 5, 29, 42, 'Re-set into the defensive line, wide forward channel.', 'If they go wide, fold with the ball.'],

  ['wide-edge', 1, 57, 84, 'Edge forward on the openside, the last forward before the backs.', 'If the edge is stocked, hold as the middle pod tail.'],
  ['wide-edge', 2, 58, 87, 'Run the support line outside the ball for the tip-on or offload.', 'If the ball goes to the winger, become the trailing cleaner.'],
  ['wide-edge', 3, 61, 89, 'Secure the wide ruck fast — isolation on the edge loses tries.', 'If secure, stand as the touchline-side pillar.'],
  ['wide-edge', 4, 62, 84, 'Guard the next phase off the wide ruck.', 'If a prop is there, fold to the middle.'],
  ['wide-edge', 5, 63, 70, 'Reload towards the middle to rebalance the pods.', 'If balanced, hold as the far-edge extra.'],

  ['broken-field-def', 1, 42, 72, 'Turn and sprint the cover arc; back-rowers must cover the widest ground.', 'If the winger has the outside covered, take the inside line.'],
  ['broken-field-def', 2, 38, 68, 'Cut the angle in front of their carrier, not behind him.', 'If they cut inside, brake and take the tackle.'],
  ['broken-field-def', 3, 34, 63, 'Force them into the touchline funnel.', 'If covered, mark the trailing support runner.'],
  ['broken-field-def', 4, 31, 59, 'Make the trailing tackle then jackal — scramble turnovers win games.', 'If not on your feet, re-set in the line.'],
  ['broken-field-def', 5, 29, 54, 'Set the line, hold the inside shoulders, call the reorganisation.', 'If outnumbered, drift and shepherd to touch.'],
];

export default expand(6, t);
