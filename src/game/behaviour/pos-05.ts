import { expand, PointTuple } from './types';

// 5 — LOCK, OPENSIDE (outside lock) (100 points)
// Authored from the 4 (blindside lock) with the roles swapped per T-17: the
// lineout jump moves MIDDLE -> TAIL, the scrum slot moves to between 2 and 3
// (pushing on the tighthead), and the chase/flank coverage leans openside.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.2, 51, 'Bind between 2 and 3, head down, driving on the tighthead\'s hips.', 'If 4 has your slot, tuck in on the loosehead side.'],
  ['own-scrum-mid', 2, 48.2, 51, 'Sustained power through the channel; keep the scrum square.', 'If it wheels, ride the wheel, stay bound.'],
  ['own-scrum-mid', 3, 50, 52, 'On the ball out, peel openside first and trail at 10m depth.', 'If the ball goes blind, fold around the scrum\'s far side.'],
  ['own-scrum-mid', 4, 53, 53, 'Openside wave cleaner or the pod tail carrier.', 'If the ruck is manned, hold the far-post guard.'],
  ['own-scrum-mid', 5, 55, 51, 'Set in the openside pod for phase two.', 'If full, slide back blind as the +1.'],
  // def-scrum-22
  ['def-scrum-22', 1, 16.2, 51, 'Bind between their 2 and 3 — attack the tighthead side.', 'If 4 is there, take the loosehead side slot.'],
  ['def-scrum-22', 2, 16.2, 51, 'Bore up through their tighthead; the long squeeze wins penalties.', 'If they step, keep the bind, stay legal.'],
  ['def-scrum-22', 3, 17.5, 52, 'Peel openside and lead the chase around the scrum.', 'If they go blind, fold behind and cover the short side.'],
  ['def-scrum-22', 4, 21, 53, 'Fold with the ball on the openside wave.', 'If the guard is held, sweeper.'],
  ['def-scrum-22', 5, 23, 51, 'Reset the tight-five line, openside shoulder.', 'If they go wide, fold inside.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 7, 'TAIL jumper: last slot in the line, the long throw is yours.', 'If the call is middle, lift for 4 instead.'],
  ['own-lineout-att-5', 2, 95, 7, 'Set the tail lift two beats later than the middle pod lifts — the deception is the point.', 'If they read it, convert to the tail drive.'],
  ['own-lineout-att-5', 3, 96, 10, 'Catch at the tail, then swing the drive off the back of the line.', 'If the swing is shut, pop to the nine off the top.'],
  ['own-lineout-att-5', 4, 97, 13, 'Drive around the corner; if it stalls, peel and pick.', 'If 8 picks, latch and drive.'],
  ['own-lineout-att-5', 5, 97.5, 17, 'Reset as the far-post forward for the goal-line phases.', 'If manned, be the second carrier.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 87, 'Counter-jump at the TAIL — their long ball dies with you.', 'If they throw middle, step in one and spoil the lift.'],
  ['def-lineout-mid', 2, 49, 87, 'Watch their hooker\'s grip: a long hold means tail.', 'If it goes front, sprint the 5m channel.'],
  ['def-lineout-mid', 3, 47.5, 82, 'On the ball down, join the maul from the tail side.', 'If they win clean, fold around and set.'],
  ['def-lineout-mid', 4, 46, 76, 'Fold with the ball, openside wave, inside the ball.', 'If a flanker is inside, hold the channel.'],
  ['def-lineout-mid', 5, 45, 71, 'Set as the third pillar for their phase two.', 'If the ball is kicked, chase infield.'],
  // att-phase-mid
  ['att-phase-mid', 1, 53, 49, 'Outside man of the first pod, one pass off the ruck.', 'If the pod has its carrier, latch on his outside hip.'],
  ['att-phase-mid', 2, 54, 50, 'Call for it, take it flat, at the gain line at pace.', 'If it goes wider, run the decoy hard.'],
  ['att-phase-mid', 3, 56, 51, 'Carry at the outside shoulder, look for the offload.', 'If tackled, present long.'],
  ['att-phase-mid', 4, 57, 52, 'Place, roll, reload — the second engine never idles.', 'If the jackal arrives, clear him.'],
  ['att-phase-mid', 5, 58, 47, 'Reload inside four seconds into the openside pod.', 'If set, be the +1.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 51, 'Third man off the ruck, covering the pod channel.', 'If 4 has it, slide one wider.'],
  ['def-line-mid', 2, 44, 49, 'Hold the channel, do not bite the decoy.', 'If moved on, fold inside.'],
  ['def-line-mid', 3, 43, 47, 'Tackle low through the carrier; aim to stop the offload.', 'If the tackle is made, be over the ball.'],
  ['def-line-mid', 4, 43, 45, 'Fold inside the ball to the next ruck.', 'If two fold, hold the sweeper.'],
  ['def-line-mid', 5, 43, 43, 'Reset the guard line, call the count.', 'If short, hold width.'],
  // kickoff-receive
  ['kickoff-receive', 1, 35, 34, 'Second pod lifter on the 10m line, openside of centre.', 'If the kick is long, drop 10m and lift in the back pod.'],
  ['kickoff-receive', 2, 33, 32, 'Lift, protect the landing, then set the platform.', 'If the ball floats past, chase the second ball.'],
  ['kickoff-receive', 3, 31, 30, 'Seal, then take the second carry out of our half.', 'If the platform is set, clear the first body.'],
  ['kickoff-receive', 4, 29, 32, 'Straight hard carry past the 22.', 'If 8 carries, latch.'],
  ['kickoff-receive', 5, 30, 38, 'Chase the exit kick, then reset the line.', 'If they counter, funnel infield.'],
  // kickoff-chase
  ['kickoff-chase', 1, 49, 44, 'Second chase wave, openside lane.', 'If the restart is short, lift in the pod.'],
  ['kickoff-chase', 2, 55, 46, 'Sprint the lane, onside, connected.', 'If over the dead ball line, reset.'],
  ['kickoff-chase', 3, 60, 47, 'Second into the contest: clean or tackle.', 'If covered, pillar.'],
  ['kickoff-chase', 4, 58, 43, 'Guard the ruck side, kill the snipe.', 'If they kick back, chase infield.'],
  ['kickoff-chase', 5, 55, 40, 'Reset the tight-five line, connected.', 'If beaten wide, fold behind.'],
  // exit-box-kick
  ['exit-box-kick', 1, 13, 49, 'Second layer of the pocket behind the L.', 'If held, seal the ruck.'],
  ['exit-box-kick', 2, 13, 49, 'Call the blindside rush early and loud.', 'If it comes, shuffle and block legally.'],
  ['exit-box-kick', 3, 15, 50, 'On the kick, get onside and chase.', 'If charged down, dive on it.'],
  ['exit-box-kick', 4, 20, 49, 'Contest the landing, then pillar.', 'If a back chases, hold the brake.'],
  ['exit-box-kick', 5, 26, 48, 'Reset the line infield of the contest.', 'If they run it, fold inside.'],
  // counter-deep
  ['counter-deep', 1, 12, 52, 'Work back as the openside option behind the catcher.', 'If it goes inside you, trail at 10m.'],
  ['counter-deep', 2, 15, 53, 'Take the contact or give and go.', 'If the break is on, support the hip.'],
  ['counter-deep', 3, 20, 54, 'First to the counter ruck on the openside.', 'If safe, near post.'],
  ['counter-deep', 4, 24, 52, 'Reload into the openside pod on the 22.', 'If the exit is on, guard.'],
  ['counter-deep', 5, 28, 49, 'One-out carry for the exit metres.', 'If the backs go, fold behind.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 52, 'Outside man of the tight pod, one pass off the ruck.', 'If set, latch.'],
  ['red-zone-22', 2, 81, 53, 'Carry at the post\'s outside shoulder, low and long.', 'If 4 carries, push.'],
  ['red-zone-22', 3, 82.5, 54, 'Reach for the line with the long arm.', 'If held, spin and ground it.'],
  ['red-zone-22', 4, 83, 52, 'Place, roll, reload — tempo.', 'If slow, stay flat.'],
  ['red-zone-22', 5, 84, 49, 'Reset the pod; be the far post.', 'If manned, second carrier.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 52, 'First layer off the post, on our line.', 'If stacked, second layer.'],
  ['goal-line-def', 2, 3.5, 52, 'Hold and hit, low, above the ball.', 'If they go wide, shuffle.'],
  ['goal-line-def', 3, 3, 51, 'Kill the drive, hold him up if you can.', 'If second in, under the ball.'],
  ['goal-line-def', 4, 3, 50, 'Jackal only on your feet.', 'If 7 has it, seal.'],
  ['goal-line-def', 5, 3.5, 49, 'Reset the stack, count their men.', 'If they spread, spread.'],
  // att-maul
  ['att-maul', 1, 92, 18, 'Bind behind the front rank, the second push.', 'If packed, third rank.'],
  ['att-maul', 2, 93, 19, 'Short steps, back straight, drive the count.', 'If it swings, correct it.'],
  ['att-maul', 3, 94.5, 21, 'Ball transfers back through you — keep it moving.', 'If it stalls, call USE IT.'],
  ['att-maul', 4, 96, 23, 'Follow the ball in; seal the counter-ruck.', 'If the try comes, jog back.'],
  ['att-maul', 5, 95, 25, 'If halted, peel and set the pick.', 'If 8 picks, latch.'],
  // turnover-att
  ['turnover-att', 1, 33, 49, 'Protect the steal, second body over.', 'If secure, sprint infield.'],
  ['turnover-att', 2, 35, 51, 'Depth, then the hard support line.', 'If a back leads, decoy.'],
  ['turnover-att', 3, 39, 52, 'Trail at ten metres, inside.', 'If crowded, go outside.'],
  ['turnover-att', 4, 44, 53, 'First to the next ruck.', 'If safe, pillar.'],
  ['turnover-att', 5, 48, 50, 'Reload the openside pod.', 'If set, extra body.'],
  // turnover-def
  ['turnover-def', 1, 60, 51, 'Retreat onside first.', 'If onside, fill the nearest gap.'],
  ['turnover-def', 2, 56, 52, 'Scramble, do not ball-chase.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 51, 'Shepherd them inside.', 'If outside you, run forever.'],
  ['turnover-def', 4, 44, 50, 'Trailing tackle or pillar.', 'If made, over the ball.'],
  ['turnover-def', 5, 40, 49, 'Reset the pillars.', 'If short, fold with the ball.'],
  // tap-pen
  ['tap-pen', 1, 69, 39, 'Two metres off the mark, openside shoulder, ready to latch.', 'If 8 taps, drive him.'],
  ['tap-pen', 2, 70.5, 40, 'Take it at pace, big and straight.', 'If set, pod up.'],
  ['tap-pen', 3, 72, 41, 'Win the collision, present long.', 'If short, immediate presentation.'],
  ['tap-pen', 4, 73, 41, 'Roll away fast.', 'If threatened, seal.'],
  ['tap-pen', 5, 74, 38, 'Set the openside pod.', 'If set, fold blind.'],
  // pen-goal
  ['pen-goal', 1, 72, 48, 'Behind the kicker, still, out of the eyeline.', 'If asked, hold the tee.'],
  ['pen-goal', 2, 72, 48, 'Watch the strike, then advance.', 'If short, chase the bounce.'],
  ['pen-goal', 3, 60, 49, 'Jog back to the restart mark.', 'If they run it, defend.'],
  ['pen-goal', 4, 52, 47, 'Lifter in the front pod at the 10m line.', 'If full, pocket.'],
  ['pen-goal', 5, 45, 45, 'Set, ready to lift.', 'If a back is under it, maul.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 47, 'Chase wave on the 22, openside lane.', 'If loaded, second wave.'],
  ['drop-out-22', 2, 26, 49, 'Onside, connected, sprinting.', 'If long, set at halfway.'],
  ['drop-out-22', 3, 32, 51, 'Into the tackle contest.', 'If covered, pillar.'],
  ['drop-out-22', 4, 30, 47, 'Fold to the pillar.', 'If they kick, escort.'],
  ['drop-out-22', 5, 28, 45, 'Reset the tight line.', 'If wide, fold inside.'],
  // wide-edge
  ['wide-edge', 1, 57, 76, 'Fold openside — the lock leads the wide channel fold.', 'If filled, short-side seal.'],
  ['wide-edge', 2, 58, 78, 'Trail inside at five metres.', 'If covered, cleaner.'],
  ['wide-edge', 3, 60, 80, 'First or second to the wide ruck.', 'If safe, touch-side pillar.'],
  ['wide-edge', 4, 61, 78, 'Cover the short-side reload.', 'If manned, fold openside.'],
  ['wide-edge', 5, 62, 73, 'Reload infield, balance one-three-three-one.', 'If set, hold the edge.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 61, 'Turn and chase the arc in front of the carrier.', 'If beaten, trail.'],
  ['broken-field-def', 2, 38, 59, 'Angle to the touchline, never straight behind.', 'If they cut back, hold inside.'],
  ['broken-field-def', 3, 33, 56, 'Force them wide to the cover.', 'If the wing has him, support runner.'],
  ['broken-field-def', 4, 30, 53, 'Tackle the support or pillar.', 'If filled, shield the jackal.'],
  ['broken-field-def', 5, 28, 50, 'Reset, call the numbers.', 'If outnumbered, drift.'],
];

export default expand(5, t);
