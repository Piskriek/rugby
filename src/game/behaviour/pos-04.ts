import { expand, PointTuple } from './types';

// 4 — LOCK, BLINDSIDE (inside lock) (100 points)
// The engine: chief jumper at the MIDDLE of the lineout, pushes between 1 and 2,
// the motor of every maul, the go-to lifter at kick-offs.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 47.8, 49, 'Bind between 1 and 2, head down, spine along the tunnel axis.', 'If 5 is in your slot, take the right-hand slot between 2 and 3.'],
  ['own-scrum-mid', 2, 47.8, 49, 'Push through the hooker\'s hips, long sustained power, eight seconds.', 'If the scrum surges, keep the bind — never celebrate early and slip.'],
  ['own-scrum-mid', 3, 49.5, 49.5, 'On the ball out, peel off the side and trail the ball at 10m.', 'If 8 picks, follow him at his hip as the first cleaner.'],
  ['own-scrum-mid', 4, 53, 51, 'Be the second-wave cleaner or the pod carrier on the blind.', 'If the ruck is manned, hold the near-post guard.'],
  ['own-scrum-mid', 5, 55, 49, 'Set as the middle-pod carrier for phase two.', 'If the middle pod is full, slide to the openside pod tail.'],
  // def-scrum-22
  ['def-scrum-22', 1, 15.8, 49, 'Bind between their 1 and 2, go for the sustained shove, not the flash.', 'If 5 has the right slot, tuck in tighter on the loosehead side.'],
  ['def-scrum-22', 2, 15.8, 49, 'Drive up through their hooker; a wheel either way is a bonus.', 'If they collapse, keep your bind and stay up — the penalty is yours.'],
  ['def-scrum-22', 3, 17.5, 50, 'Peel and fold around the scrum to the openside chase.', 'If the ball goes blind, take the short-side chase instead.'],
  ['def-scrum-22', 4, 21, 52, 'Fold with the ball at the second wave, arriving on the inside.', 'If the guard is held, drop in behind as the sweeper.'],
  ['def-scrum-22', 5, 23, 50, 'Reset the tight-five line for their second phase.', 'If they go wide, trail infield as inside cover.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 15, 'Chief jumper: position 3, middle of the line, two metres of air.', 'If the call goes to the tail, lift there instead.'],
  ['own-lineout-att-5', 2, 95, 15, 'Time the jump on the hooker\'s release; two lifters, one call.', 'If the counter-lift is early, ride it and protect the ball overhead.'],
  ['own-lineout-att-5', 3, 96, 17, 'Catch, bring it down, and convert into the maul at the front.', 'If the maul is stacked, peel to the tail and add the push.'],
  ['own-lineout-att-5', 4, 97, 20, 'Drive legs; if it stalls, be first to peel and take the pick.', 'If 8 picks, latch on and drive.'],
  ['own-lineout-att-5', 5, 97.5, 24, 'Reset as the near-post forward for the goal-line phases.', 'If the posts are manned, be the second carrier one pass out.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 83, 'Counter-jump at position 3, matching their chief jumper.', 'If they throw front, step up one and take the counter-lift.'],
  ['def-lineout-mid', 2, 49, 83, 'Read the lift prep: the front lifter\'s eyes tell you the call.', 'If it goes tail, hand it over and sprint the 5m channel.'],
  ['def-lineout-mid', 3, 47.5, 80, 'On the ball down, join the maul squeeze from the outside.', 'If they win it clean, fold around and set the line.'],
  ['def-lineout-mid', 4, 46, 75, 'Fold with the ball infield, second wave, always inside the ball.', 'If a flanker is inside you, hold your channel.'],
  ['def-lineout-mid', 5, 45, 70, 'Set as the second pillar for their phase two.', 'If the ball is kicked, chase infield to the sweeper line.'],
  // att-phase-mid
  ['att-phase-mid', 1, 53, 47, 'Middle man of the first pod — the carrier one pass from the ruck.', 'If the pod has its carrier, become the latch on his inside hip.'],
  ['att-phase-mid', 2, 54, 48, 'Square up, call for it early, take it flat at the gain line.', 'If the ball is going wide, run the decoy line hard.'],
  ['att-phase-mid', 3, 56, 49, 'Big carry at the inside shoulder; look for the offload in contact.', 'If you are tackled, present long and clean.'],
  ['att-phase-mid', 4, 57, 50, 'Place the ball back, roll away, and reload.', 'If the jackal is on, stay and clear him.'],
  ['att-phase-mid', 5, 58, 46, 'Reload into the next pod inside four seconds — the engine never idles.', 'If the pods are set, be the +1 behind the nine.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 49, 'Guard: second man off the ruck, one metre outside the pillar.', 'If 3 has the guard, slide one further and cover the pod.'],
  ['def-line-mid', 2, 44, 47, 'Hold the channel, watch the pod, do not bite on the decoy.', 'If the ball is moved on, fold with it along the inside.'],
  ['def-line-mid', 3, 43, 45, 'Tackle low through the biggest man in the channel.', 'If the tackle is made, be over the ball fast.'],
  ['def-line-mid', 4, 43, 43, 'Fold to the next ruck, arriving on the inside.', 'If two are folding, hold the sweeper spot.'],
  ['def-line-mid', 5, 43, 41, 'Reset as guard for phase two and call the count.', 'If we are short, hold width, do not compress.'],
  // kickoff-receive
  ['kickoff-receive', 1, 35, 30, 'Go-to lifter in the front pod on the 10m line, right of centre.', 'If the kick is long, drop 10m and form the second pod.'],
  ['kickoff-receive', 2, 33, 28, 'Lift long and safe; keep the jumper up until the ball is won.', 'If the ball floats past, turn and chase the second ball.'],
  ['kickoff-receive', 3, 31, 26, 'Seal the landing, then take the first hit-up from the maul.', 'If the platform is set, clear the first defender.'],
  ['kickoff-receive', 4, 29, 28, 'First carry out of our half — straight and hard.', 'If 8 carries, latch and drive.'],
  ['kickoff-receive', 5, 30, 34, 'Chase the exit kick, then reset the tight-five line.', 'If they counter, funnel infield.'],
  // kickoff-chase
  ['kickoff-chase', 1, 49, 40, 'Second chase wave, middle of the field, ready for the second ball.', 'If the restart is short, get in the pod and lift.'],
  ['kickoff-chase', 2, 55, 38, 'Chase the lane onside, connected with your neighbours.', 'If the kick is over the dead ball line, reset at halfway.'],
  ['kickoff-chase', 3, 60, 37, 'Be the second man into the contest; clean or tackle.', 'If the contest is covered, set the first pillar.'],
  ['kickoff-chase', 4, 58, 41, 'Guard the ruck side and kill the nine\'s snipe.', 'If they kick back, turn and chase infield.'],
  ['kickoff-chase', 5, 55, 44, 'Reset in the tight-five line, low, square, connected.', 'If beaten wide, fold behind the line.'],
  // exit-box-kick
  ['exit-box-kick', 1, 13, 47, 'Behind the protection L, the second layer of the pocket.', 'If the front is held, join the ruck and seal.'],
  ['exit-box-kick', 2, 13, 47, 'Watch the blindside rush and call it early.', 'If they come around, shuffle and legally block.'],
  ['exit-box-kick', 3, 15, 48, 'On the kick, get onside and chase the landing zone.', 'If it is charged down, dive on the ball.'],
  ['exit-box-kick', 4, 20, 48, 'Contest the landing, then reset the pillar.', 'If a back has the chase, hold the brake at 10m.'],
  ['exit-box-kick', 5, 26, 47, 'Reset the tight-five line infield of the contest.', 'If they run it back, fold with the ball.'],
  // counter-deep
  ['counter-deep', 1, 12, 47, 'Work back hard as the second option behind the catcher.', 'If the counter is on outside you, trail at 10m infield.'],
  ['counter-deep', 2, 15, 48, 'Take the ball into contact or give it and keep working.', 'If the break is on, support at the hip.'],
  ['counter-deep', 3, 20, 49, 'First to the counter ruck, clear the body, keep it fast.', 'If it is safe, take the near post.'],
  ['counter-deep', 4, 24, 48, 'Reload into the pod on our 22.', 'If the exit is on, hold the guard.'],
  ['counter-deep', 5, 28, 46, 'One-out carry to earn the exit metres.', 'If the backs go, fold behind as the trailer.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 48, 'Middle of the three-man tight pod, one pass off the ruck.', 'If the pod is set, be the latch.'],
  ['red-zone-22', 2, 81, 49, 'Carry at the post defender, low, driving the legs.', 'If 3 carries, bind on and push.'],
  ['red-zone-22', 3, 82.5, 50, 'Reach for the line with the long arm if you are close.', 'If held up, keep the legs and spin to ground it.'],
  ['red-zone-22', 4, 83, 48, 'Place it back, roll away, reload — tempo, tempo.', 'If slow to rise, stay flat and clear the lane.'],
  ['red-zone-22', 5, 84, 45, 'Reset the middle pod for the next strike.', 'If manned, be the far-post guard.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 51, 'First layer under the posts, over their ruck, on our line.', 'If the stack is set, join the second layer behind.'],
  ['goal-line-def', 2, 3.5, 51, 'Hold and hit: the low man through the biggest body.', 'If they go wide, shuffle along, never cross.'],
  ['goal-line-def', 3, 3, 50, 'Double tackle, kill the leg drive, hold him up if you can.', 'If second in, get under the ball.'],
  ['goal-line-def', 4, 3, 49, 'Jackal only on your feet and the ball clearly out.', 'If 7 has it, seal in front.'],
  ['goal-line-def', 5, 3.5, 48, 'Reset the stack and count their forwards.', 'If they spread, spread and hold the inside shoulder.'],
  // att-maul
  ['att-maul', 1, 92, 20, 'Bind directly behind the catcher — the engine at the heart of it.', 'If the heart is packed, take the second rank.'],
  ['att-maul', 2, 93, 21, 'Short steps, back straight, drive for the full count.', 'If it swings, stay bound and correct the line.'],
  ['att-maul', 3, 94.5, 22, 'Keep the ball transferring back; call the stall if it dies.', 'If it stalls, peel and take the pick.'],
  ['att-maul', 4, 96, 24, 'Over the line if it comes; otherwise reset the ruck.', 'If the try is scored, jog back for the conversion.'],
  ['att-maul', 5, 95, 26, 'If halted, set the pick-and-go and take the flat ball.', 'If 8 picks, latch and drive him.'],
  // turnover-att
  ['turnover-att', 1, 33, 47, 'Second body over the stolen ball — protection first.', 'If it is secure, sprint infield as the carrier option.'],
  ['turnover-att', 2, 35, 49, 'Find depth, run the hard support line.', 'If a back leads, decoy hard.'],
  ['turnover-att', 3, 39, 50, 'Trail inside at ten metres, ready for the offload.', 'If two are inside, go outside.'],
  ['turnover-att', 4, 44, 51, 'First to the next ruck and secure it.', 'If safe, set the pillar.'],
  ['turnover-att', 5, 48, 49, 'Reload as the middle-pod leader against the broken field.', 'If set, be the extra openside body.'],
  // turnover-def
  ['turnover-def', 1, 60, 49, 'Ball gone — retreat onside, then work to their inside shoulder.', 'If already onside, sprint into the nearest gap.'],
  ['turnover-def', 2, 56, 50, 'Fill the scramble gap, do not chase the ball.', 'If filled, drop as the second brake.'],
  ['turnover-def', 3, 50, 49, 'Shepherd them inside to the forwards.', 'If they are outside you, never stop running.'],
  ['turnover-def', 4, 44, 49, 'Trailing tackle or their ruck pillar.', 'If the tackle is made, be over the ball.'],
  ['turnover-def', 5, 40, 48, 'Reset the pillars, slow it down.', 'If we are short, fold with the ball.'],
  // tap-pen
  ['tap-pen', 1, 69, 37, 'Two metres behind the mark, first receiver of the tap-and-go.', 'If 8 takes it, latch and drive.'],
  ['tap-pen', 2, 70.5, 38, 'Take it at pace into the retreating line, big and straight.', 'If they are set, hold and pod up.'],
  ['tap-pen', 3, 72, 39, 'Win the collision, present long, tempo on.', 'If tackled short, immediate presentation.'],
  ['tap-pen', 4, 73, 39, 'Roll away fast, be ready for the repeat.', 'If threatened, stay and seal.'],
  ['tap-pen', 5, 74, 36, 'Set the pod for phase two on the mark.', 'If set, fold openside.'],
  // pen-goal
  ['pen-goal', 1, 72, 45, 'Stand well behind the kicker, out of the eyeline, quiet.', 'If asked, hold the tee and clear away fast.'],
  ['pen-goal', 2, 72, 45, 'Watch the ball; on the strike, start advancing.', 'If short, chase the bounce.'],
  ['pen-goal', 3, 60, 46, 'Jog back to the restart mark at halfway.', 'If they run it back, defend.'],
  ['pen-goal', 4, 52, 43, 'Front-pod lifter at the 10m line.', 'If the pod is full, hold the pocket.'],
  ['pen-goal', 5, 45, 41, 'Set feet, ready to lift.', 'If a back is under it, maul him.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 45, 'Chase wave on the 22, middle lane.', 'If the front is loaded, second wave.'],
  ['drop-out-22', 2, 26, 43, 'Chase onside and connected.', 'If long, slow and set at halfway.'],
  ['drop-out-22', 3, 32, 41, 'Second man into the tackle contest.', 'If covered, first pillar.'],
  ['drop-out-22', 4, 30, 45, 'Fold to the pillar, kill the snipe.', 'If they kick back, escort.'],
  ['drop-out-22', 5, 28, 47, 'Reset the tight line for their drive.', 'If wide, fold inside.'],
  // wide-edge
  ['wide-edge', 1, 57, 72, 'Fold openside into the channel as the third forward.', 'If filled, hold the short-side seal.'],
  ['wide-edge', 2, 58, 75, 'Trail inside and behind at five metres.', 'If covered, be the cleaner.'],
  ['wide-edge', 3, 60, 78, 'Second to the wide ruck, secure the post.', 'If safe, stand the touch-side pillar.'],
  ['wide-edge', 4, 61, 76, 'Cover the reload short side.', 'If manned, fold openside.'],
  ['wide-edge', 5, 62, 71, 'Reload infield, balance the pods.', 'If set, hold the edge.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 59, 'Turn and chase the arc in front of their carrier.', 'If a faster man has it, trail him.'],
  ['broken-field-def', 2, 38, 57, 'Angle to the touchline side, never straight behind.', 'If they cut back, brake and hold inside.'],
  ['broken-field-def', 3, 33, 55, 'Force them wide to the cover.', 'If the wing has him, take the support.'],
  ['broken-field-def', 4, 30, 52, 'Tackle the support runner or pillar the ruck.', 'If filled, shield the jackal.'],
  ['broken-field-def', 5, 28, 49, 'Reset and call the numbers.', 'If outnumbered, drift.'],
];

export default expand(4, t);
