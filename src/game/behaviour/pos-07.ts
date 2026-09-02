import { expand, PointTuple } from './types';

// 7 — OPENSIDE FLANKER (100 points)
const t: PointTuple[] = [
  ['own-scrum-mid', 1, 46.5, 36.5, 'Bind on the openside flank, head between 3 and 5, ready to break.', 'If 6 is on the openside, take the blindside flank.'],
  ['own-scrum-mid', 2, 46.5, 36.5, 'Stay bound and square; do not break before the ball is out.', 'If we wheel, follow the wheel and stay legal.'],
  ['own-scrum-mid', 3, 47.5, 35, 'Detach the instant the ball is out; first man to the ball on the openside.', 'If 8 picks blind, chase and be the second cleaner.'],
  ['own-scrum-mid', 4, 51, 40, 'Track flat behind the backs as the link/first cleaner.', 'If the pass goes wide, sprint the arc to the wide ruck.'],
  ['own-scrum-mid', 5, 55, 46, 'Be first to the breakdown; secure or jackal as appropriate.', 'If the ruck is secure, stand up as the 9\'s short option.'],

  ['def-scrum-22', 1, 15, 37.5, 'Bind on the openside flank; eyes on their 9 and first receiver.', 'If 6 is on the openside, take the blindside flank.'],
  ['def-scrum-22', 2, 15, 37.5, 'Stay bound until the ball is out — early break equals penalty.', 'If their 8 picks, detach and smash him behind the gain line.'],
  ['def-scrum-22', 3, 16.5, 40, 'Break and hunt their 10; shut down the exit kick space.', 'If 6 is pressing, take the inside channel and cover the snipe.'],
  ['def-scrum-22', 4, 19, 44, 'Tackle the first receiver or chase the kick to the catcher.', 'If they kick long, turn and become the trailing cover.'],
  ['def-scrum-22', 5, 21, 47, 'First to the ruck and jackal; the exit ruck is where turnovers happen.', 'If not on your feet, re-set into the line as guard.'],

  ['own-lineout-att-5', 1, 95, 21, 'Stand off the back of the lineout at the tail as the receiver/link.', 'If 9 receives, become the tail lifter instead.'],
  ['own-lineout-att-5', 2, 95, 22, 'Bind at the back of the maul once it forms; drive it forwards.', 'If the maul is set, be the ball-carrier option off the back.'],
  ['own-lineout-att-5', 3, 96.5, 22, 'Watch for the maul stalling; break with the ball if it halts.', 'If it is moving, keep driving and stay bound.'],
  ['own-lineout-att-5', 4, 97.5, 25, 'Carry off the back at the seam next to the maul.', 'If 8 takes it, latch and drive him.'],
  ['own-lineout-att-5', 5, 98, 28, 'Present, then be first to the next goal-line ruck.', 'If secure, be the 9\'s short-side runner.'],

  ['def-lineout-mid', 1, 50, 94, 'Stand off the back of their lineout, ready to press their 10.', 'If 6 has the tail press, cover the inside channel.'],
  ['def-lineout-mid', 2, 50, 93, 'Time your break with the throw; do not go early and be offside.', 'If a maul forms, attack the ball-carrier side legally.'],
  ['def-lineout-mid', 3, 47, 88, 'Sprint at their first receiver; force the pass or the error.', 'If a back presses, take the inside shoulder.'],
  ['def-lineout-mid', 4, 45, 82, 'Be first to their breakdown and get over the ball.', 'If beaten to it, become the guard and slow the ball legally.'],
  ['def-lineout-mid', 5, 44, 76, 'Contest, then re-set; you are the team\'s primary jackal.', 'If not on your feet, get straight back into the line.'],

  ['att-phase-mid', 1, 53, 52, 'Stand at the ruck as the link/first cleaner, not in a pod.', 'If a forward is already the link, become the far pod tail.'],
  ['att-phase-mid', 2, 54, 54, 'Follow the ball flat and fast; be the closest support to every carry.', 'If the ball goes wide, sprint the arc to arrive at the next ruck.'],
  ['att-phase-mid', 3, 56, 56, 'Arrive first; clean, latch or take the tip-on pass.', 'If the ruck is secure, stand up as the pillar and let 9 play.'],
  ['att-phase-mid', 4, 57, 55, 'Do not over-commit — one cleaner is enough for quick ball.', 'If the ball is threatened, commit fully and win the contest.'],
  ['att-phase-mid', 5, 58, 52, 'Reload behind the ruck as the permanent link for the next phase.', 'If 9 wants a short runner, be that runner.'],

  ['def-line-mid', 1, 44, 51, 'Stand as the second man off the ruck, hunting the jackal opportunity.', 'If 6 is there, take the guard slot one wider.'],
  ['def-line-mid', 2, 44, 53, 'Read their shape; be first to any tackle made near the ruck.', 'If the ball goes wide, sprint the arc infield of the ball.'],
  ['def-line-mid', 3, 43, 55, 'Attack the ball on the deck the moment the tackle is complete.', 'If another jackal is on, seal and protect him.'],
  ['def-line-mid', 4, 43, 53, 'Win the penalty, or force the slow ball, then release.', 'If a cleaner hits you, stay strong and force the holding-on call.'],
  ['def-line-mid', 5, 43, 50, 'Re-set immediately; you must be the first defender to the next ruck.', 'If exhausted, drop into guard and let 6 lead the jackal.'],

  ['kickoff-receive', 1, 34, 56, 'Stand in the second line 5m behind the pods, right of centre.', 'If the pod needs a lifter, join as the back lifter.'],
  ['kickoff-receive', 2, 33, 52, 'Read the drop zone; be the man who secures the tap-back.', 'If the kick is long, run back with the sweepers.'],
  ['kickoff-receive', 3, 31, 46, 'Secure the ball on the deck; protect the receiving maul base.', 'If a maul forms, join and drive.'],
  ['kickoff-receive', 4, 29, 44, 'Be the link if we run the restart; be the cleaner if we get tackled.', 'If we box kick, protect the 9.'],
  ['kickoff-receive', 5, 31, 48, 'Chase the exit kick as the first-arriving jackal threat.', 'If beaten, funnel infield as cover.'],

  ['kickoff-chase', 1, 49, 30, 'Front chase line, tight to the contest pod, first to the landing zone.', 'If 6 is closest, take the second chase seam.'],
  ['kickoff-chase', 2, 56, 28, 'Sprint hard; be at the drop zone as the ball arrives.', 'If you cannot make it, cover the tap-back zone.'],
  ['kickoff-chase', 3, 61, 27, 'Tackle the catcher immediately or scoop the tap-back and go.', 'If a team-mate tackles, jackal instantly.'],
  ['kickoff-chase', 4, 59, 31, 'Contest the ball on the deck; a restart turnover is gold.', 'If not on your feet, re-set as pillar.'],
  ['kickoff-chase', 5, 55, 35, 'Re-set into the defensive line near the ruck.', 'If out of position, fill the nearest gap.'],

  ['exit-box-kick', 1, 13, 45, 'Openside guard beside the box-kick ruck, protecting the 9.', 'If the guard exists, join the ruck as an extra body.'],
  ['exit-box-kick', 2, 13, 45, 'Watch for their pressure; shield the 9 legally.', 'If the ruck is threatened, add weight low.'],
  ['exit-box-kick', 3, 18, 46, 'On the kick, chase infield of the winger as the jackal threat.', 'If the kick is short, sprint to make the tackle.'],
  ['exit-box-kick', 4, 25, 47, 'Arrive at the aerial contest and hunt the ball on the deck.', 'If the winger wins it, secure the ball immediately.'],
  ['exit-box-kick', 5, 29, 47, 'Jackal at their ruck, or re-set as guard.', 'If they counter, funnel infield as cover.'],

  ['counter-deep', 1, 12, 58, 'Sprint back as the closest support to the catcher.', 'If a forward is already inside, take the outside support line.'],
  ['counter-deep', 2, 16, 62, 'Take the ball on the angle or clear the first tackler off the catcher.', 'If the counter goes wide, sprint the arc behind the ball.'],
  ['counter-deep', 3, 22, 64, 'Be the first man to the counter-attack ruck and secure.', 'If secure, stand up and be 9\'s link for the next phase.'],
  ['counter-deep', 4, 27, 62, 'Link the next phase; keep the ball alive out of our 22.', 'If we are pinned, protect the exit kicker.'],
  ['counter-deep', 5, 32, 58, 'Reload as the permanent link; keep arriving first.', 'If we kick, chase and hunt the catcher.'],

  ['red-zone-22', 1, 80, 56, 'Stand at the ruck as the link for the 9 in the red zone.', 'If a forward links, become the tight pod latch.'],
  ['red-zone-22', 2, 81, 58, 'Follow the ball; be first to every red-zone breakdown.', 'If a pod carries, be the immediate cleaner.'],
  ['red-zone-22', 3, 83, 60, 'Secure sub-3-second ball or take the short pick over the line.', 'If contested, commit and win it.'],
  ['red-zone-22', 4, 84, 58, 'Do not over-commit; goal-line defences want you buried in rucks.', 'If the ball is safe, be the 9\'s snipe decoy.'],
  ['red-zone-22', 5, 85, 55, 'Reload behind the ruck as the constant link runner.', 'If we go wide, sprint the arc to the next ruck.'],

  ['goal-line-def', 1, 4, 51, 'Stand next to the post as the designated jackal on our line.', 'If a jackal is set, be his sealer and take the cleanout.'],
  ['goal-line-def', 2, 3.5, 52, 'Hold the line; do not gamble at the jackal until the tackle is complete.', 'If they switch sides, shuffle along the line.'],
  ['goal-line-def', 3, 3, 53, 'Attack the ball the second the carrier is grounded short.', 'If the maul forms, join and drive it back.'],
  ['goal-line-def', 4, 3, 51, 'Win the goal-line turnover or force the held-up call.', 'If they get quick ball, get straight back on the line.'],
  ['goal-line-def', 5, 3.5, 49, 'Re-set on the line, recount, communicate the pillar numbers.', 'If short on the far side, sprint behind the line.'],

  ['att-maul', 1, 92, 24, 'Bind at the back of the maul or stand off as the runner.', 'If 8 has the back, bind as the driving engine.'],
  ['att-maul', 2, 93, 25, 'Drive, then read: stay bound or break with the ball if halted.', 'If it is moving, stay bound.'],
  ['att-maul', 3, 94.5, 27, 'Break with the ball at the seam beside the maul.', 'If 6 broke, be his support and cleaner.'],
  ['att-maul', 4, 96, 29, 'Get over the gain line and present instantly.', 'If a try is on, reach for the line.'],
  ['att-maul', 5, 96, 32, 'Be first to the new ruck; link for 9 on the next phase.', 'If secure, stand as the short runner.'],

  ['turnover-att', 1, 34, 45, 'You are usually the turnover winner: rip, jackal or scoop and go.', 'If a team-mate won it, be his protector and clear the threat.'],
  ['turnover-att', 2, 37, 48, 'Get the ball away from the contact area within two seconds.', 'If a back has it, run the hardest support line you can.'],
  ['turnover-att', 3, 42, 52, 'Trail the break at the carrier\'s inside shoulder for the offload.', 'If two trail inside, take the outside line.'],
  ['turnover-att', 4, 47, 55, 'Secure the next ruck; transition possession must not be lost.', 'If secure, be the link for the next phase.'],
  ['turnover-att', 5, 51, 53, 'Reload behind the ruck as the constant link.', 'If we go wide, sprint the arc.'],

  ['turnover-def', 1, 60, 44, 'Get onside instantly and hunt their carrier — you are the counter-jackal.', 'If already onside, run the shepherding arc infield of the ball.'],
  ['turnover-def', 2, 55, 45, 'Fill the nearest hole; connect with the scramble line.', 'If filled, become the second-wave brake.'],
  ['turnover-def', 3, 50, 46, 'Make the tackle, then get straight over the ball in transition.', 'If a team-mate tackles, be first to the jackal.'],
  ['turnover-def', 4, 45, 46, 'Contest hard; broken-play turnovers are the cheapest to win.', 'If not on your feet, re-set into the line.'],
  ['turnover-def', 5, 41, 46, 'Set as the second man off the ruck for their next phase.', 'If short wide, keep folding with the ball.'],

  ['tap-pen', 1, 69, 37, 'Stand at the 9\'s shoulder as the link for the tap sequence.', 'If a forward is the link, take the second carry option.'],
  ['tap-pen', 2, 71, 38, 'Follow the tap carrier and clean instantly to keep tempo.', 'If the carrier gets over the gain line, be first to the ruck.'],
  ['tap-pen', 3, 72.5, 39, 'Secure the ball for a sub-2-second recycle.', 'If contested, commit fully.'],
  ['tap-pen', 4, 73.5, 39, 'Do not stay in the ruck; get up and be the link again.', 'If threatened, stay and secure.'],
  ['tap-pen', 5, 75, 41, 'Be the 9\'s short option for the next quick phase.', 'If a pod exists, be the cleaner behind them.'],

  ['pen-goal', 1, 72, 59, 'Stand behind the kicker, ready to react to any short kick.', 'If crowded, spread wider.'],
  ['pen-goal', 2, 72, 59, 'You are the fastest forward: be the designated charge-down chaser.', 'If clearly good, retreat for the restart.'],
  ['pen-goal', 3, 60, 57, 'Retreat to the restart shape at the second line.', 'If they counter, defend first.'],
  ['pen-goal', 4, 51, 55, 'Take the second-line slot behind the restart pods.', 'If the pods need a lifter, join one.'],
  ['pen-goal', 5, 44, 52, 'Ready to secure the tap-back or make the first tackle.', 'If the kick is long, run back with the sweepers.'],

  ['drop-out-22', 1, 21, 56, 'Front chase line, right of the kicker, first to the landing zone.', 'If the front rank is full, chase the inside seam.'],
  ['drop-out-22', 2, 28, 54, 'Sprint to arrive as the ball lands; time it, do not go offside.', 'If long, slow up and re-set the line.'],
  ['drop-out-22', 3, 34, 52, 'Tackle the catcher and then contest the ball on the ground.', 'If two chasers are there, jackal.'],
  ['drop-out-22', 4, 32, 54, 'Slow their ball at the ruck or force a penalty.', 'If they kick back, be the escort for our catcher.'],
  ['drop-out-22', 5, 30, 55, 'Re-set as the second man off the ruck.', 'If they go wide, sprint the arc infield of the ball.'],

  ['wide-edge', 1, 57, 78, 'Trail the ball as the closest support to the edge play.', 'If the edge is stocked, hold the previous ruck-side channel.'],
  ['wide-edge', 2, 58, 82, 'Sprint the arc; the wide ruck must not be isolated.', 'If the ball is passed inside, follow it back.'],
  ['wide-edge', 3, 61, 87, 'Arrive first at the wide breakdown and secure the ball.', 'If secure, stand as the pillar and let 9 play back infield.'],
  ['wide-edge', 4, 62, 82, 'Do not over-commit; you must be available for the next phase.', 'If threatened, commit fully to win the contest.'],
  ['wide-edge', 5, 63, 74, 'Reload as the link for the next phase back towards the middle.', 'If we swing back, sprint the arc again.'],

  ['broken-field-def', 1, 42, 70, 'Turn and sprint the cover arc — you should be first to the ball.', 'If the winger is covering, take the inside shoulder line.'],
  ['broken-field-def', 2, 38, 66, 'Cut the angle to intercept their line, not to chase their heels.', 'If they cut inside, brake and make the tackle.'],
  ['broken-field-def', 3, 33, 62, 'Make the scramble tackle or force them to touch.', 'If covered, mark the trailing support runner.'],
  ['broken-field-def', 4, 30, 58, 'Get over the ball instantly — the counter-attacker is isolated.', 'If not on your feet, get back into the line.'],
  ['broken-field-def', 5, 28, 54, 'Re-set as the second defender off the ruck.', 'If outnumbered, drift and shepherd.'],
];

export default expand(7, t);
