import { expand, PointTuple } from './types';

// 10 — FLY-HALF (100 points)
const t: PointTuple[] = [
  ['own-scrum-mid', 1, 40, 47, 'Stand 10-12m behind the scrum on the openside, flat enough to attack.', 'If 12 stands first receiver on a set play, drop deeper as the second option.'],
  ['own-scrum-mid', 2, 41, 50, 'Call the play before the feed: pod, wide, kick or 9-ball.', 'If the scrum is going backwards, call the safe option — kick or 8 pick.'],
  ['own-scrum-mid', 3, 43, 53, 'Receive from 9, take the ball flat, fix their 13 or their 10.', 'If under pressure from the back row, play early to 12 or kick.'],
  ['own-scrum-mid', 4, 45, 56, 'Distribute wide, kick to the space or run the flat line yourself.', 'If the pass is on, hit 13 running the seam.'],
  ['own-scrum-mid', 5, 48, 52, 'Reset at 10m depth behind the next ruck as the phase-2 playmaker.', 'If 12 is the first receiver, take the second-receiver depth outside him.'],

  ['def-scrum-22', 1, 15, 46, 'Stand in the defensive line outside the flanker, marking their 10.', 'If 12 takes their 10, defend the inside channel instead.'],
  ['def-scrum-22', 2, 15.5, 48, 'Push up with the line as their 9 clears; do not drift early.', 'If they box kick, drop instantly to the backfield as a receiver.'],
  ['def-scrum-22', 3, 17, 50, 'Tackle their 10 or shepherd him towards the touchline.', 'If 7 gets there first, take the next man out.'],
  ['def-scrum-22', 4, 13, 52, 'If they kick, become the backfield option beside 15.', 'If 15 fields it, support him and call the counter or the re-kick.'],
  ['def-scrum-22', 5, 18, 50, 'Re-set in the line as the organiser of the outside channels.', 'If we win the ball, take the first-receiver slot and clear.'],

  ['own-lineout-att-5', 1, 92, 25, 'Stand 10m behind the lineout, flat and ready for the maul outlet.', 'If 12 is the strike runner, stand deeper as the second receiver.'],
  ['own-lineout-att-5', 2, 92, 28, 'Call the play: maul, strike off the tail or the wide shift.', 'If the maul is set, hold the pocket ready for the "away" call.'],
  ['own-lineout-att-5', 3, 93, 32, 'Take the ball from 9 if the maul stalls; attack the guard\'s outside shoulder.', 'If the guard is set, tip on to 12 crashing.'],
  ['own-lineout-att-5', 4, 94, 38, 'Distribute to the strike runner, or cross kick to the far winger.', 'If they have folded, keep the ball with the forwards.'],
  ['own-lineout-att-5', 5, 95, 45, 'Reset at 8m depth for the goal-line phase play; keep the shape flat.', 'If 12 has first receiver, stand out the back as the second option.'],

  ['def-lineout-mid', 1, 48, 82, 'Stand in the line outside the tail, marking their 10.', 'If 12 takes their 10, defend the inside channel and cover the 9 snipe.'],
  ['def-lineout-mid', 2, 48, 80, 'Line speed with the unit on their catch; stay square.', 'If they kick long, drop into the backfield with 15.'],
  ['def-lineout-mid', 3, 47, 76, 'Tackle their first receiver or push him into the drift.', 'If a back-rower shoots, cover his inside shoulder.'],
  ['def-lineout-mid', 4, 44, 70, 'Fold with the ball and re-organise the outside channels by voice.', 'If they kick, become the second backfield receiver.'],
  ['def-lineout-mid', 5, 43, 64, 'Set in the line for their phase 2, calling the drift or blitz.', 'If we win the ball, get to first receiver and exit.'],

  ['att-phase-mid', 1, 48, 56, 'Stand 8-10m behind and outside the ruck as first receiver.', 'If 12 takes first receiver, stand out the back as the second playmaker.'],
  ['att-phase-mid', 2, 49, 58, 'Call the shape: pod, out-the-back, wide or kick, before the ball arrives.', 'If the ruck is slow, call the safe pod carry and reset.'],
  ['att-phase-mid', 3, 51, 60, 'Take the ball flat; hold the defender before releasing.', 'If they blitz, play early or kick behind the rushing line.'],
  ['att-phase-mid', 4, 53, 63, 'Distribute, or attack the seam yourself if the guard bites in.', 'If wide is on, hit 13 or the pull-back pass to the back three.'],
  ['att-phase-mid', 5, 53, 56, 'Reload at depth behind the next ruck, on the opposite side.', 'If 12 has that slot, take the second-receiver depth behind him.'],

  ['def-line-mid', 1, 44, 56, 'Defend in the line outside the guard, usually in the 10 channel.', 'If a back-rower fills that channel, drop as the second sweeper.'],
  ['def-line-mid', 2, 44, 58, 'Organise the line: call up, drift or hold before the ball moves.', 'If they kick, drop back and become the backfield receiver.'],
  ['def-line-mid', 3, 43, 60, 'Make the tackle in your channel; do not drift and leave a dog-leg.', 'If your outside man shoots, hold his inside shoulder.'],
  ['def-line-mid', 4, 42, 58, 'Re-set; do not go to the breakdown, you are needed in the line.', 'If a jackal needs protection, only help if you are the closest.'],
  ['def-line-mid', 5, 43, 54, 'Fold with the ball and re-organise the line by voice.', 'If numbers are short wide, call the drift and shepherd to touch.'],

  ['kickoff-receive', 1, 26, 55, 'Stand at 22m depth as the second receiver and exit kicker.', 'If 15 is deeper, stay shallow at 20-25m as the link.'],
  ['kickoff-receive', 2, 25, 53, 'Call the receiving shape and the planned exit before the kick.', 'If the ball comes to you, catch, then kick long to touch.'],
  ['kickoff-receive', 3, 24, 50, 'Take the pass from 9 for the exit kick beyond our 22 or to touch.', 'If pressure is on, kick early rather than run into contact.'],
  ['kickoff-receive', 4, 23, 48, 'Kick long down the 15m channel or to the corner.', 'If we have numbers, call the counter-attack instead.'],
  ['kickoff-receive', 5, 28, 50, 'Drop back into the backfield behind the chase line.', 'If the chase is on, stay at 15m as the second sweeper.'],

  ['kickoff-chase', 1, 48, 50, 'Restart kicker: place the ball, call the target zone.', 'If 15 kicks off, stand as the sweeper 20m behind the chase.'],
  ['kickoff-chase', 2, 49, 48, 'Kick 25-30m to the 10m/15m intersect, hang time over distance.', 'If we need territory, kick long to the corner instead.'],
  ['kickoff-chase', 3, 45, 48, 'Follow the chase at 15m depth as the organiser.', 'If they catch and run, become the second-last defender.'],
  ['kickoff-chase', 4, 42, 48, 'Cover the counter through the middle and organise the line.', 'If they kick back, be the second receiver behind 15.'],
  ['kickoff-chase', 5, 44, 50, 'Re-set the defensive line by voice; call up or drift.', 'If they set a ruck, take the 10 channel in the line.'],

  ['exit-box-kick', 1, 12, 50, 'Stand at 15m depth outside the ruck as the alternative exit kicker.', 'If 9 is boxing, stand flatter as the second option and blocker.'],
  ['exit-box-kick', 2, 12, 52, 'Communicate: box or pass, and call the chase.', 'If 9 is under pressure, call "me" and take the long touch-finder.'],
  ['exit-box-kick', 3, 14, 54, 'Kick to touch beyond our 22, or hoist for the contest.', 'If we are inside our 22, kick to find touch on the full.'],
  ['exit-box-kick', 4, 18, 52, 'Drop into the backfield behind the chase line.', 'If 15 covers deep, sit at 20m as the second sweeper.'],
  ['exit-box-kick', 5, 24, 52, 'Re-set as the line organiser once the chase is complete.', 'If they counter, shepherd them towards touch.'],

  ['counter-deep', 1, 16, 52, 'Support the catcher as the pull-back option at 10m depth.', 'If 9 is the link, stand wider as the second distributor.'],
  ['counter-deep', 2, 19, 55, 'Take the ball and decide instantly: counter or re-kick.', 'If their chase is organised, re-kick long into the space behind.'],
  ['counter-deep', 3, 23, 58, 'Distribute to the space, or kick a low cross-field ball.', 'If we counter, hit the runner in the widest seam.'],
  ['counter-deep', 4, 27, 55, 'Reset at depth behind the counter ruck as the playmaker.', 'If we are still in our 22, call the exit kick.'],
  ['counter-deep', 5, 32, 52, 'Manage the exit: get past the 22, then find touch.', 'If we break the line, follow as the trailing support.'],

  ['red-zone-22', 1, 78, 58, 'Stand flat at 6-8m behind the ruck; red-zone depth is shallow.', 'If 12 is first receiver, stand out the back for the wide shift.'],
  ['red-zone-22', 2, 79, 60, 'Call the play: tight pod, wrap, cross kick or wide shift.', 'If they are narrow, call the wide play immediately.'],
  ['red-zone-22', 3, 81, 63, 'Take the ball flat, attack the outside shoulder of the guard.', 'If they blitz, tip on early to the trailing runner.'],
  ['red-zone-22', 4, 82, 66, 'Cross kick to the far winger, or grubber into the in-goal.', 'If they hold width, keep it tight with the pods.'],
  ['red-zone-22', 5, 83, 58, 'Reload flat behind the next ruck; vary the side each phase.', 'If 12 takes it, take the second-receiver depth.'],

  ['goal-line-def', 1, 4, 56, 'Defend in the line outside the guards on our own goal line.', 'If a forward fills your channel, drop back as the in-goal sweeper.'],
  ['goal-line-def', 2, 3.5, 58, 'Hold the line; call "no dog-legs" and keep it flat.', 'If they switch, shuffle along the line, never around.'],
  ['goal-line-def', 3, 3, 59, 'Make the tackle in your channel; hold him up if you can.', 'If beaten inside, chase and tackle from behind.'],
  ['goal-line-def', 4, 2, 57, 'Cover the grubber into the in-goal behind the line.', 'If 15 covers it, stay on the line.'],
  ['goal-line-def', 5, 3.5, 54, 'Re-set, recount, and call the numbers on both sides.', 'If we win the ball, take the immediate clearing kick.'],

  ['att-maul', 1, 90, 26, 'Stand at 10m depth outside the maul as the outlet playmaker.', 'If 12 is closer, drop deeper as the second option.'],
  ['att-maul', 2, 90, 30, 'Watch their fold; call the "away" moment to 9 if the maul stalls.', 'If the maul is advancing, stay patient and hold your depth.'],
  ['att-maul', 3, 91, 35, 'Take the ball off the stalled maul and attack the short side or wide.', 'If they have folded wide, keep it tight with the forwards.'],
  ['att-maul', 4, 92, 42, 'Distribute wide or cross kick to the far corner.', 'If they are narrow, hit the wide runner immediately.'],
  ['att-maul', 5, 93, 46, 'Reset at depth for the goal-line phase play.', 'If 12 takes first receiver, stand out the back.'],

  ['turnover-att', 1, 33, 50, 'Get depth and width immediately; be the transition distributor.', 'If 9 has the ball and is running, be his pull-back option.'],
  ['turnover-att', 2, 36, 54, 'Take the ball at pace and attack the widest seam of the unset defence.', 'If nothing is on, kick behind their scramble line.'],
  ['turnover-att', 3, 41, 58, 'Distribute to the free runner, or kick to the space behind.', 'If the defence has re-set, hold the ball and rebuild the shape.'],
  ['turnover-att', 4, 46, 56, 'Reset at depth for the next transition phase.', 'If a break is on, trail as the support runner.'],
  ['turnover-att', 5, 50, 54, 'Rebuild the structure: call pods, set the field position plan.', 'If they are still scrambling, keep attacking the space.'],

  ['turnover-def', 1, 58, 50, 'Get onside and slot into the scramble line as the organiser.', 'If the line is full, drop as the second sweeper behind 15.'],
  ['turnover-def', 2, 54, 52, 'Call the scramble: who shepherds, who covers the kick.', 'If a hole appears, fill it yourself.'],
  ['turnover-def', 3, 49, 53, 'Make the cover tackle or force the carrier towards touch.', 'If they kick, become the backfield receiver.'],
  ['turnover-def', 4, 45, 52, 'Re-organise the line at the next ruck; call up or drift.', 'If short of numbers, call the drift and shepherd.'],
  ['turnover-def', 5, 42, 50, 'Take your channel in the re-set line.', 'If they kick again, drop into the backfield.'],

  ['tap-pen', 1, 68, 42, 'Stand at 8m depth outside the tap as the distributor option.', 'If 9 goes himself, be the immediate support runner.'],
  ['tap-pen', 2, 69, 45, 'Call the tap plan: tight carries first, then swing wide on phase 3.', 'If they have re-set at 10m, call the structured play instead.'],
  ['tap-pen', 3, 71, 50, 'Take the ball flat on phase 2 or 3 and attack the drifting edge.', 'If they scramble wide, keep it tight.'],
  ['tap-pen', 4, 73, 55, 'Distribute wide to the outside backs against a broken line.', 'If numbers are even, keep the ball with the pods.'],
  ['tap-pen', 5, 74, 50, 'Reset at depth and control the tempo.', 'If we are close to the line, revert to the red-zone shape.'],

  ['pen-goal', 1, 72, 50, 'You are usually the kicker: line up the shot, control the routine.', 'If 15 kicks goals, stand back and organise the restart shape.'],
  ['pen-goal', 2, 72, 50, 'Strike the ball; hold your follow-through and watch it over.', 'If the kick is charged, sprint to cover.'],
  ['pen-goal', 3, 58, 50, 'Retreat with the team to the restart-receive shape.', 'If they run a quick tap, defend immediately.'],
  ['pen-goal', 4, 30, 52, 'Take the 22m-depth position for the restart receive.', 'If we are kicking off, place the ball and kick.'],
  ['pen-goal', 5, 26, 52, 'Be the exit kicker after the restart catch.', 'If it goes long, support 15 in the backfield.'],

  ['drop-out-22', 1, 21, 50, 'You are the drop-out kicker: choose contestable or long.', 'If 15 is the kicker, take the chase organiser role at 15m.'],
  ['drop-out-22', 2, 22, 50, 'Kick 25-30m contestable to the 10m line, or long to the corner.', 'If we are under pressure, kick long for territory.'],
  ['drop-out-22', 3, 26, 50, 'Follow at 15m depth as the organiser behind the chase.', 'If they catch and counter, become the second-last defender.'],
  ['drop-out-22', 4, 28, 50, 'Cover the counter through the middle; call the line into shape.', 'If they kick back, be the second backfield receiver.'],
  ['drop-out-22', 5, 30, 50, 'Take your channel in the re-set defensive line.', 'If they attack wide, call the drift.'],

  ['wide-edge', 1, 56, 72, 'Stand at depth behind the edge play as the pull-back option.', 'If 12 is the pull-back, stand on the short side as the extra.'],
  ['wide-edge', 2, 57, 76, 'Call the option: draw and pass, kick to the corner or bring it back.', 'If the 2v2 is on, get the ball to the winger fast.'],
  ['wide-edge', 3, 58, 80, 'Deliver the pass in front of the runner or kick to the space.', 'If they cover, take the tackle and set the ruck.'],
  ['wide-edge', 4, 59, 70, 'Fold back infield to be the playmaker on the short side.', 'If 12 is there, take the second-receiver depth.'],
  ['wide-edge', 5, 60, 60, 'Reset in the middle of the field as the phase organiser.', 'If we swing back, take the first-receiver slot again.'],

  ['broken-field-def', 1, 38, 60, 'Slot into the scramble line as the organiser, infield of the ball.', 'If 9 sweeps shallow, drop deeper behind him.'],
  ['broken-field-def', 2, 35, 58, 'Call the shepherd and cover the inside cut-back.', 'If a hole appears, fill it and make the tackle.'],
  ['broken-field-def', 3, 32, 56, 'Make the cover tackle or delay them until the line re-forms.', 'If covered, drop back as the sweeper for the kick.'],
  ['broken-field-def', 4, 30, 54, 'Re-organise the line: call the count and the drift.', 'If they set a ruck, take the 10 channel.'],
  ['broken-field-def', 5, 28, 52, 'Hold your channel and keep the line connected.', 'If they kick, drop into the backfield with 15.'],
];

export default expand(10, t);
