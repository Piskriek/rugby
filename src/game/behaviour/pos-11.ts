import { expand, PointTuple } from './types';

// 11 — LEFT WING (100 points)
const t: PointTuple[] = [
  ['own-scrum-mid', 1, 45, 12, 'Stand on the blindside wing, 10m from touch, level with the scrum.', 'If 15 is on the blindside, drop back as the deep cover instead.'],
  ['own-scrum-mid', 2, 46, 14, 'Be the extra man on the short side if the call is a blindside strike.', 'If the ball goes openside, drop into the backfield as the left sweeper.'],
  ['own-scrum-mid', 3, 49, 18, 'Take the short-side ball at pace and attack the touchline space.', 'If the short side is closed, kick or take contact and present.'],
  ['own-scrum-mid', 4, 44, 20, 'If the ball goes openside, fold back and cover the left backfield.', 'If 15 has that space, hold the 15m channel as the second sweeper.'],
  ['own-scrum-mid', 5, 42, 22, 'Set in the backfield triangle at 25-30m from the ball.', 'If we go wide left later, sprint up as the finisher.'],

  ['def-scrum-22', 1, 14, 12, 'Stand on the blindside wing marking their short-side attack.', 'If 15 covers the blind, drop deeper as the left-corner cover.'],
  ['def-scrum-22', 2, 14, 14, 'Hold the short side; their winger and 8 will attack this channel.', 'If they go openside, drop back and cover the left backfield.'],
  ['def-scrum-22', 3, 13, 16, 'Make the tackle in the touchline channel; force them into touch.', 'If they kick, sprint back and be the receiver.'],
  ['def-scrum-22', 4, 12, 20, 'Drop into the backfield to cover their exit kick to the left.', 'If 15 fields it, become the first support option.'],
  ['def-scrum-22', 5, 16, 20, 'Re-set on the left edge of the defensive line.', 'If we counter, run the support arc outside the catcher.'],

  ['own-lineout-att-5', 1, 92, 6, 'Stand in the 5m channel outside the lineout as the short-side threat.', 'If 15 is there, hold deeper as the cover for the cross kick.'],
  ['own-lineout-att-5', 2, 93, 8, 'Be the short-side finisher if the maul releases blind.', 'If the maul drives, hold your channel and stay onside.'],
  ['own-lineout-att-5', 3, 95, 6, 'Attack the corner off 9 or 10 on the short side.', 'If covered, take contact and present for the goal-line phase.'],
  ['own-lineout-att-5', 4, 96, 4, 'Dive for the corner if the space opens; keep the foot infield.', 'If tackled short, present for the pick-and-go.'],
  ['own-lineout-att-5', 5, 90, 12, 'Reload to the short side for the next phase, or fold to the far edge.', 'If the play swings right, sprint across as the extra finisher.'],

  ['def-lineout-mid', 1, 45, 60, 'Stand in the backfield on the open side, covering the left half.', 'If 15 is central, take the left 15m channel deep.'],
  ['def-lineout-mid', 2, 44, 55, 'Read their kick; you cover the box kick and the cross kick left.', 'If they run, push up into the defensive line as the last man.'],
  ['def-lineout-mid', 3, 42, 45, 'Field the kick or defend the edge as the outside defender.', 'If 15 catches it, be his inside support.'],
  ['def-lineout-mid', 4, 40, 35, 'Counter-attack down the left, or return the kick to touch.', 'If pressure is on, kick early and re-set.'],
  ['def-lineout-mid', 5, 42, 25, 'Re-set the backfield triangle with 14 and 15.', 'If we win the ball, become the wide finisher on the left edge.'],

  ['att-phase-mid', 1, 52, 20, 'Stand on the left edge, 5-10m from touch, level with the last man.', 'If 15 has the edge, tuck inside him as the second finisher.'],
  ['att-phase-mid', 2, 53, 22, 'Hold your width; the wing pulls their defence apart by standing wide.', 'If the ball is going right, drop into the backfield as the left sweeper.'],
  ['att-phase-mid', 3, 55, 22, 'Attack the space outside their last defender at pace.', 'If it is a 1v1, take him on the outside shoulder.'],
  ['att-phase-mid', 4, 58, 18, 'Finish the break down the touchline, or kick and chase yourself.', 'If tackled, present the ball inwards for the support.'],
  ['att-phase-mid', 5, 52, 24, 'Reload: hold width if the ball comes back, or drop into the backfield.', 'If 15 is up in the line, take the deep left cover.'],

  ['def-line-mid', 1, 44, 22, 'Stand as the last defender on the left edge, one out from 13.', 'If 15 comes up outside you, drop into the backfield instead.'],
  ['def-line-mid', 2, 44, 20, 'Drift and shepherd; never bite in and open the outside channel.', 'If they kick, turn and sprint back to cover the left backfield.'],
  ['def-line-mid', 3, 43, 18, 'Tackle their winger into touch; the touchline is your extra defender.', 'If beaten inside, chase and tackle from behind.'],
  ['def-line-mid', 4, 40, 20, 'Re-set width, do not go to the breakdown; you are needed on the edge.', 'If the ball goes back inside, fold with the line but hold the edge.'],
  ['def-line-mid', 5, 38, 24, 'Drop as one third of the backfield triangle if they build phases.', 'If 15 is deep left, push up into the line.'],

  ['kickoff-receive', 1, 25, 18, 'Stand in the backfield left, covering the deep left quarter.', 'If 15 shifts left, move to the 15m channel and stay balanced.'],
  ['kickoff-receive', 2, 27, 20, 'Read the kick early; call "mine" or "yours" loudly.', 'If it goes to the pods, sprint up to be the exit option.'],
  ['kickoff-receive', 3, 30, 22, 'Field any kick to the left corner and secure or kick to touch.', 'If pressured, kick to touch immediately.'],
  ['kickoff-receive', 4, 28, 24, 'Support the exit kicker as the alternative option.', 'If we run it, be the wide finisher on the left.'],
  ['kickoff-receive', 5, 26, 20, 'Re-set the backfield triangle after the exit.', 'If we chase, run the outside chase channel on the left.'],

  ['kickoff-chase', 1, 48, 20, 'Chase on the left, 10-15m from touch, outside the contest pod.', 'If we kick right, drop as the left sweeper instead.'],
  ['kickoff-chase', 2, 56, 18, 'Sprint the outside chase lane; deny the wide escape route.', 'If the ball goes long, brake and cover the counter.'],
  ['kickoff-chase', 3, 62, 16, 'Tackle their catcher or force him into touch.', 'If they secure it, hold the edge and do not chase infield.'],
  ['kickoff-chase', 4, 58, 20, 'Hold the wide channel as they exit; cover the wide kick.', 'If they box kick, sprint back and become the receiver.'],
  ['kickoff-chase', 5, 52, 22, 'Re-set as the last defender on the left edge.', 'If they kick long, drop into the backfield triangle.'],

  ['exit-box-kick', 1, 12, 22, 'Stand on the left edge of the ruck as the short-side guard.', 'If 15 has the blind, drop as the deep left cover.'],
  ['exit-box-kick', 2, 12, 24, 'Hold the short side against their blindside counter.', 'If the box goes to your side, become the chaser.'],
  ['exit-box-kick', 3, 16, 26, 'Chase the box kick if it is to your side; contest in the air.', 'If it is the other side, drop deep and cover the counter left.'],
  ['exit-box-kick', 4, 20, 24, 'Tackle their catcher immediately or compete for the loose ball.', 'If 14 contests, be his ground support.'],
  ['exit-box-kick', 5, 18, 22, 'Re-set the backfield triangle behind the chase line.', 'If they counter left, be the shepherd to touch.'],

  ['counter-deep', 1, 16, 66, 'Sprint infield to support the catcher as the wide outlet.', 'If 14 is that option, hold the far side and stay wide.'],
  ['counter-deep', 2, 20, 62, 'Take the ball at pace on the counter, running at the seam.', 'If the counter goes right, sprint across as the far-side finisher.'],
  ['counter-deep', 3, 26, 55, 'Beat the first chaser; keep your feet moving and look for support.', 'If isolated, kick long or take the tackle safely.'],
  ['counter-deep', 4, 32, 45, 'Continue the counter or return the kick to the vacated space.', 'If tackled, present the ball infield.'],
  ['counter-deep', 5, 30, 25, 'Re-set the backfield triangle once the counter is over.', 'If we build phases, hold width on the left edge.'],

  ['red-zone-22', 1, 80, 20, 'Hold the far-left edge, pinned wide to stretch their goal-line defence.', 'If 15 is on the left edge, tuck inside as the second option.'],
  ['red-zone-22', 2, 81, 18, 'Stay wide even when the ball is far away; width creates the space.', 'If they leave you unmarked, call loudly for the cross kick.'],
  ['red-zone-22', 3, 84, 16, 'Attack the corner space; look for the cross kick or the wide pass.', 'If covered, take the tackle and present infield.'],
  ['red-zone-22', 4, 88, 8, 'Finish in the corner; keep the foot infield and reach for the line.', 'If tackled short, present for the goal-line pick.'],
  ['red-zone-22', 5, 82, 20, 'Reload wide; goal-line defences fold, so keep pinning the corner.', 'If the ball swings right, sprint across behind the ruck.'],

  ['goal-line-def', 1, 3, 20, 'Hold the left corner on our goal line; never leave the corner.', 'If 15 is in the corner, tuck in one channel and connect.'],
  ['goal-line-def', 2, 2.5, 18, 'Stay wide; their strike will be a cross kick or a wide swing.', 'If the ball goes to the far side, shuffle in but keep the corner.'],
  ['goal-line-def', 3, 2, 14, 'Tackle their winger into touch or hold him up over the line.', 'If they kick, jump and compete for the ball in the air.'],
  ['goal-line-def', 4, 1, 12, 'Cover the in-goal for the grubber and the chip on your side.', 'If 15 covers it, hold the corner.'],
  ['goal-line-def', 5, 3, 20, 'Re-set on the corner after every phase; do not drift infield.', 'If we win it, be the outlet for the clearing kick.'],

  ['att-maul', 1, 90, 8, 'Stand on the short side outside the maul as the finisher.', 'If 15 is there, hold deeper as the cross-kick cover.'],
  ['att-maul', 2, 91, 6, 'Watch the maul; be ready if 9 snipes and passes blind.', 'If the maul is driving, hold your position and stay onside.'],
  ['att-maul', 3, 93, 5, 'Take the short pass and attack the corner.', 'If covered, take contact and present for the phase.'],
  ['att-maul', 4, 96, 3, 'Dive for the corner, foot infield, ball grounded on the line.', 'If tackled short, present for the pick-and-go.'],
  ['att-maul', 5, 90, 12, 'Reload wide, or fold to the far edge if the play swings.', 'If the ball goes right, sprint across as the extra man.'],

  ['turnover-att', 1, 34, 25, 'Sprint up and wide immediately; transition is your best try source.', 'If 15 has the left edge, tuck inside as the second runner.'],
  ['turnover-att', 2, 38, 30, 'Take the ball in the widest channel of the unset defence.', 'If the ball goes right, sprint across as the finisher.'],
  ['turnover-att', 3, 45, 25, 'Beat the scrambling cover on the outside; use your pace.', 'If a defender is outside you, cut back inside off the shoulder.'],
  ['turnover-att', 4, 55, 15, 'Finish, or kick ahead and regather in behind their scramble.', 'If tackled, present infield and re-set the phase.'],
  ['turnover-att', 5, 50, 22, 'Reload wide on the left for the next transition phase.', 'If we lose momentum, drop into the backfield.'],

  ['turnover-def', 1, 55, 30, 'Turn and sprint back to cover the left backfield immediately.', 'If 15 is deep left, push up as the widest scramble defender.'],
  ['turnover-def', 2, 48, 28, 'Cover the kick to your corner and the wide break.', 'If they run at the middle, come up as the shepherd.'],
  ['turnover-def', 3, 40, 26, 'Make the covering tackle on their wide runner or force him to touch.', 'If beaten, keep chasing — never give up the scramble.'],
  ['turnover-def', 4, 32, 24, 'Re-set as the last defender on the left edge.', 'If they kick, drop and field the ball.'],
  ['turnover-def', 5, 28, 22, 'Take your place in the backfield triangle.', 'If we get numbers back, push up into the line.'],

  ['tap-pen', 1, 68, 20, 'Stand wide on the left, ready for the phase-3 swing.', 'If 15 is on the left, tuck inside him.'],
  ['tap-pen', 2, 70, 18, 'Hold width while the forwards make the tight carries.', 'If they scramble narrow, call for the wide ball.'],
  ['tap-pen', 3, 73, 16, 'Take the ball wide against their retreating, disorganised edge.', 'If covered, kick to the corner and chase.'],
  ['tap-pen', 4, 78, 10, 'Finish in the corner or offload inside to the trailing support.', 'If tackled, present infield.'],
  ['tap-pen', 5, 74, 20, 'Reload wide for the next quick phase.', 'If tempo drops, drop back into the backfield.'],

  ['pen-goal', 1, 72, 25, 'Stand behind the kicker, wide left, out of the way.', 'If crowded, move to the 15m line.'],
  ['pen-goal', 2, 72, 25, 'Watch for the short kick; be ready to chase the rebound.', 'If clearly good, retreat for the restart.'],
  ['pen-goal', 3, 55, 25, 'Retreat to the backfield for the restart receive.', 'If they counter, defend the left edge.'],
  ['pen-goal', 4, 28, 22, 'Take the deep left position in the receive triangle.', 'If we kick off, chase the left channel.'],
  ['pen-goal', 5, 26, 20, 'Ready to field the long restart or support the catcher.', 'If it goes to the pods, sprint up as the exit option.'],

  ['drop-out-22', 1, 21, 20, 'Chase on the left wing outside the forward chase line.', 'If we kick right, drop as the left sweeper.'],
  ['drop-out-22', 2, 28, 18, 'Sprint the outside lane; deny the wide counter route.', 'If the kick is long, hold and cover the backfield.'],
  ['drop-out-22', 3, 34, 16, 'Tackle their catcher or force him into touch.', 'If they secure the ball, hold the edge.'],
  ['drop-out-22', 4, 32, 20, 'Hold the wide channel as they set their attack.', 'If they kick back, sprint and field it.'],
  ['drop-out-22', 5, 28, 22, 'Re-set the backfield triangle with 14 and 15.', 'If they go wide left, come up as the last defender.'],

  ['wide-edge', 1, 58, 60, 'You are the blindside winger here: sprint across to the short side.', 'If 15 fills the short side, hold as the far-side backfield cover.'],
  ['wide-edge', 2, 59, 45, 'Arrive on the short side as the extra man for the swing-back play.', 'If the ball stays wide right, hold as the deep left cover.'],
  ['wide-edge', 3, 61, 30, 'Take the short-side ball at pace against their under-manned edge.', 'If covered, kick to the corner or take contact.'],
  ['wide-edge', 4, 65, 20, 'Attack the space down the left touchline.', 'If tackled, present infield for the next phase.'],
  ['wide-edge', 5, 60, 25, 'Re-set on the left edge or drop into the backfield.', 'If 15 is up in the line, take the deep cover.'],

  ['broken-field-def', 1, 36, 50, 'Sprint back and infield to cover the deep left space.', 'If 15 has the deep cover, come up as the widest scrambler.'],
  ['broken-field-def', 2, 33, 45, 'Track infield of the ball, never behind it; cut the angle.', 'If they go to your side, hold the outside and force them in.'],
  ['broken-field-def', 3, 28, 40, 'Make the last-line tackle or shepherd them to touch.', 'If they kick, field it and clear or counter.'],
  ['broken-field-def', 4, 24, 35, 'Cover the in-goal side; never let them get behind you.', 'If the danger passes, re-set the triangle.'],
  ['broken-field-def', 5, 26, 25, 'Re-form the backfield triangle with 14 and 15.', 'If we win the ball, become the counter-attack outlet.'],
];

export default expand(11, t);
