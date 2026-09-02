import { expand, PointTuple } from './types';

// 2 — HOOKER (100 points)
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.5, 50, 'Hook between 1 and 3, strike the ball back the instant it hits the tunnel.', 'If the feed is crooked, strike anyway — never let it run through loose.'],
  ['own-scrum-mid', 2, 48.5, 50, 'Hold the strike channel square; keep the heels driving so the ball comes back clean.', 'If the scrum steps, follow the wheel and keep the channel straight.'],
  ['own-scrum-mid', 3, 50, 50, 'On the ball out, break left first — the hooker covers the nine\'s blind shoulder.', 'If 6 already has the blind, loop to the openside pod.'],
  ['own-scrum-mid', 4, 53, 47, 'Track the ball at 8-10m as the first-arriving cleaner on the openside.', 'If 7 has the cleanout, hold the near post and guard the nine.'],
  ['own-scrum-mid', 5, 55, 45, 'Set as the short-side pod ball-carrier or the +1 latch for phase two.', 'If the pod is full, become the pillar between ruck and blindside wing.'],
  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 50, 'Hook against the head: strike on their feed, worry about the ball not the shove.', 'If their feed is perfect, drive up through their hooker to spoil the strike.'],
  ['def-scrum-22', 2, 16.5, 50, 'Keep the tunnel straight and legal — a penalty here is their three points.', 'If the scrum wheels past 45, disengage and re-set, do not collapse.'],
  ['def-scrum-22', 3, 17, 51, 'Break to the blindside first — the hooker leads the short-side cover off a defensive scrum.', 'If they go openside, fold behind the scrum and join the chase.'],
  ['def-scrum-22', 4, 20, 48, 'Fold around the corner as the first cleaner past the ball.', 'If the ruck is won, set the pillar on the openside shoulder.'],
  ['def-scrum-22', 5, 22, 46, 'Set in the tight-five chase line for their second phase, low and connected.', 'If they go wide, fold infield as the last man of the tight five.'],
  // own-lineout-att-5
  ['own-lineout-att-5', 1, 96.5, 9, 'Stand in the touch hutch, ball in hand, eyes on the jumper and the lifter set.', 'If the referee delays, hold the ball and the call — never rush the throw.'],
  ['own-lineout-att-5', 2, 96.5, 9, 'Throw flat and fast to the called pod; the ball must beat the counter-lift.', 'If the call changes late, throw to the front pod, never improvise middle.'],
  ['own-lineout-att-5', 3, 96, 12, 'On the catch, sprint the two metres to join the front of the forming maul.', 'If the maul is stacked, orbit to the tail and add your weight there.'],
  ['own-lineout-att-5', 4, 97, 15, 'Drive the maul legs pumping; if it stalls, peel to the base for the pick.', 'If 8 picks, clear the first body off him at the base.'],
  ['own-lineout-att-5', 5, 97, 18, 'Be the goal-line option: flat pass from the base, low drive over.', 'If 3 is carrying, bind on and drive him over the line.'],
  // def-lineout-mid
  ['def-lineout-mid', 1, 50, 89, 'Stand in the hutch mirroring their thrower, calling their lift timing aloud.', 'If the touch judge moves you back, set flat and hold the mark.'],
  ['def-lineout-mid', 2, 50, 89, 'Read the hooker\'s eyes and shoulders; call FRONT, MIDDLE or TAIL early.', 'If the call is late, cover the middle — the highest-percentage throw.'],
  ['def-lineout-mid', 3, 48, 86, 'On the throw, sprint the 5m channel as the first defender off the lineout.', 'If they win it clean, fold around the tail and join the line.'],
  ['def-lineout-mid', 4, 46, 80, 'Cover the short side between lineout and touch — their favourite exit.', 'If they maul, join the squeeze from the outside, legally.'],
  ['def-lineout-mid', 5, 45, 74, 'Reset the tight-five defensive pod infield for their second phase.', 'If numbers are short, hold the inside shoulder and slow their tempo.'],
  // att-phase-mid
  ['att-phase-mid', 1, 53, 45, 'Stand as the left-hand man of the first pod, one pass from the ruck.', 'If the pod has three, drop to the tail of the next pod out.'],
  ['att-phase-mid', 2, 54, 46, 'Bind-ready hands; watch the guard, not the ball.', 'If the nine snipes, clear the space and let him through.'],
  ['att-phase-mid', 3, 56, 47, 'Carry at the inside shoulder of the first defender; win the gain line.', 'If 4 carries, latch on his hip and drive him forward.'],
  ['att-phase-mid', 4, 57, 48, 'Present the ball long, seal, roll away fast.', 'If the jackal is on, stay and fight the clearance.'],
  ['att-phase-mid', 5, 58, 42, 'Reload into the near pod within four seconds — tempo beats size.', 'If the pod is set, hold the A-runner slot for the nine.'],
  // def-line-mid
  ['def-line-mid', 1, 44, 48.5, 'First pillar: stand on the ruck\'s near shoulder, feet on the gain line.', 'If 7 has the pillar, take the guard one metre outside him.'],
  ['def-line-mid', 2, 44, 46, 'Hold, watch the nine\'s hands, kill the snipe and the short pick.', 'If the ball goes wide, fold with it along the inside line.'],
  ['def-line-mid', 3, 43, 44, 'Tackle low and hard on the tight carrier; chop the legs.', 'If the tackle is made, be second man over the ball to slow it.'],
  ['def-line-mid', 4, 43, 42, 'Fold to the next ruck arriving on the inside of the ball.', 'If two already fold, hold the line and keep the shape.'],
  ['def-line-mid', 5, 43, 40, 'Reset as first pillar for their next phase; call the count aloud.', 'If short of numbers, guard the ruck and let the backs hold width.'],
  // kickoff-receive
  ['kickoff-receive', 1, 35, 32, 'Front pod lifter on the 10m line, left of centre, hands ready under the jumper.', 'If the pod is full, take the pocket five metres behind as the catcher.'],
  ['kickoff-receive', 2, 33, 30, 'Lift the jumper high and long; protect his landing with your body.', 'If the kick is short and flat, leave it for the pocket man.'],
  ['kickoff-receive', 3, 31, 28, 'Seal the catcher on landing; form the maul or the quick ruck.', 'If they contest hard, stay low and legal over the ball.'],
  ['kickoff-receive', 4, 29, 30, 'Set the platform: pillar for the nine\'s exit pass or the box kick.', 'If the ball goes wide, trail at 10m as the ruck support.'],
  ['kickoff-receive', 5, 30, 36, 'Chase the exit kick down the middle, then reset the tight-five line.', 'If they counter, funnel infield and be the trailing cover.'],
  // kickoff-chase
  ['kickoff-chase', 1, 49, 38, 'Stand in the first chase wave, left of the target zone.', 'If the call is a short restart, drop back and lift in the contest pod.'],
  ['kickoff-chase', 2, 55, 36, 'Sprint the seam, onside to the kick, eyes on the ball not the man.', 'If the kick sails dead, turn and get set for the 22 drop-out.'],
  ['kickoff-chase', 3, 60, 35, 'Arrive at the contest: tackle the catcher or win the loose ball.', 'If two are already there, hold off and set the first pillar.'],
  ['kickoff-chase', 4, 58, 39, 'Set the ruck-side pillar to deny their nine\'s snipe.', 'If they kick back, chase your own kick-chase lane infield.'],
  ['kickoff-chase', 5, 55, 42, 'Reset in the tight-five line at the ruck edge, low and square.', 'If beaten on the outside, fold behind the line and fill the last gap.'],
  // exit-box-kick
  ['exit-box-kick', 1, 13, 41, 'Right post of the box-kick ruck, forming the L with the loosehead.', 'If the right post is held, join the ruck as the extra seal.'],
  ['exit-box-kick', 2, 13, 41, 'Stay square, absorb the blindside rush, protect the nine\'s pocket.', 'If they come around the edge, shuffle and legally block the lane.'],
  ['exit-box-kick', 3, 15, 44, 'On the kick, get back onside fast and chase hard.', 'If the kick is charged down, dive on the loose ball first.'],
  ['exit-box-kick', 4, 20, 46, 'Chase the landing zone, contest the catch, then reset the pillar.', 'If a back has the chase, hold the midfield brake at 10m.'],
  ['exit-box-kick', 5, 26, 47, 'Reset the tight-five line just infield of the contest.', 'If they run it back, fold with the ball and hold the inside shoulder.'],
  // counter-deep
  ['counter-deep', 1, 12, 42, 'Bend the line back hard to be the inside option for the catcher.', 'If 4 is inside, swing wider as the second-wave runner.'],
  ['counter-deep', 2, 15, 45, 'Take the ball into contact or give the short ball to the trailing back.', 'If the defence is set, drive in and set the ruck — do not die with it.'],
  ['counter-deep', 3, 20, 47, 'Hit the ruck at pace, clear the first body, keep the counter alive.', 'If the ruck is safe, peel and reload as the near-post guard.'],
  ['counter-deep', 4, 24, 47, 'Reload into the pod for the next phase from our 22.', 'If the exit is on, hold the ruck-side guard for the kick.'],
  ['counter-deep', 5, 28, 44, 'Carry one-out to earn the metres for the clean exit.', 'If the backs have it, fold behind as the last forward trailer.'],
  // red-zone-22
  ['red-zone-22', 1, 80, 50, 'Tight pod inside man, one pass off the ruck, low body height.', 'If the pod is set, latch on the carrier\'s inside hip.'],
  ['red-zone-22', 2, 81, 51, 'Drive at the post defender\'s inside shoulder; the low man wins here.', 'If 4 carries, bind on and add the second push.'],
  ['red-zone-22', 3, 82.5, 52, 'Fight for every inch; place the ball one metre further back for the nine.', 'If held up, keep the legs driving and spin to ground it.'],
  ['red-zone-22', 4, 83, 50, 'Roll away instantly — red-zone ball speed is the entire game.', 'If slow to rise, stay flat and out of the nine\'s lane.'],
  ['red-zone-22', 5, 84, 46, 'Set the near post for the next pick-and-go phase.', 'If both posts are filled, join the pod as the second carrier.'],
  // goal-line-def
  ['goal-line-def', 1, 4, 50, 'Square under the posts, first man over their ruck, feet on our line.', 'If the posts are manned, stack behind at the second layer.'],
  ['goal-line-def', 2, 3.5, 50, 'No line speed — hold, dominate the hit, tackle above the ball.', 'If they go wide, shuffle along the line, never cross over.'],
  ['goal-line-def', 3, 3, 49, 'Stop the pick-and-go dead: low grab, legs pumping backwards.', 'If he reaches the line, get under the ball and hold him up.'],
  ['goal-line-def', 4, 3, 48, 'Jackal only when clearly on your feet and the ball is exposed.', 'If 7 is jackalling, seal in front of him and take the punishment.'],
  ['goal-line-def', 5, 3.5, 47, 'Reset the goal-line stack, call the posts, count their bombers.', 'If they spread wide, spread with them and hold the inside shoulder.'],
  // att-maul
  ['att-maul', 1, 92, 19, 'Bind at the front beside the jumper, the first push after the catch.', 'If the front is packed, join the second rank and add weight.'],
  ['att-maul', 2, 93, 20, 'Drive with the legs in short steps; keep the spine straight and legal.', 'If the maul swings wide of the posts, angle it back in.'],
  ['att-maul', 3, 94.5, 22, 'Keep the ball moving backwards through hands to the tail.', 'If the ball sticks at the front, call USE IT and pick from the base.'],
  ['att-maul', 4, 96, 24, 'On the collapse or the halt, clear the body and take the pick.', 'If the try is scored, turn and jog back for the conversion.'],
  ['att-maul', 5, 95, 27, 'If the maul dies, set the ruck and take the flat ball at the post.', 'If 8 picks, latch and drive him the final metre.'],
  // turnover-att
  ['turnover-att', 1, 33, 46, 'The steal is made — become the first protector over the ball.', 'If the ball is secure, sprint infield to be the first carrier.'],
  ['turnover-att', 2, 35, 48, 'Get depth fast; the transition is won by the first clean ruck.', 'If a back leads the counter, run the decoy line hard.'],
  ['turnover-att', 3, 39, 50, 'Trail the break on the inside at ten metres.', 'If two trailers are inside, take the outside line instead.'],
  ['turnover-att', 4, 44, 52, 'First to the next ruck: clear, seal, and keep the tempo.', 'If the ruck is safe, set the pillar for the strike runner.'],
  ['turnover-att', 5, 48, 48, 'Reload as the pod leader against the broken field.', 'If the pod is set, drift to the openside as the extra body.'],
  // turnover-def
  ['turnover-def', 1, 60, 48, 'Ball lost — retreat across the ball line before anything else.', 'If already onside, sprint at the inside shoulder of their man.'],
  ['turnover-def', 2, 56, 49, 'Fill the nearest gap in the scramble; do not ball-chase.', 'If the gaps are filled, drop as the second-wave brake.'],
  ['turnover-def', 3, 50, 49, 'Shepherd them back inside towards the forwards.', 'If they are outside you, run the arc and never stop.'],
  ['turnover-def', 4, 44, 48, 'Trailing tackle from behind, or first man to their ruck.', 'If the tackle is made in front, be over the ball instantly.'],
  ['turnover-def', 5, 40, 47, 'Reset the pillars and slow their recycle with voice and line.', 'If we are short, fold with the ball and concede metres, not the line.'],
  // tap-pen
  ['tap-pen', 1, 69, 36, 'Stand tight on the mark at the tapper\'s hip, ready to latch.', 'If the tap goes to 8, drive his outside shoulder.'],
  ['tap-pen', 2, 70.5, 37, 'Take the tap-and-go at pace before their line is reset.', 'If they have retreated, hold and set the pod instead of forcing it.'],
  ['tap-pen', 3, 72, 38, 'Carry hard at the retreating ten; quick ball is the point.', 'If tackled short, present long and immediate.'],
  ['tap-pen', 4, 73, 38, 'Roll away fast; the next tap must be quicker than the last.', 'If the ruck is threatened, stay and seal.'],
  ['tap-pen', 5, 74, 35, 'Set the short-side pod for phase two on the mark.', 'If the short side is manned, fold openside to the pod tail.'],
  // pen-goal
  ['pen-goal', 1, 72, 46, 'Stand behind the kicker\'s left shoulder, still and quiet.', 'If crowded, move infield and keep his run-up clear.'],
  ['pen-goal', 2, 72, 46, 'Watch the strike; be ready to advance on the kick.', 'If it looks short, start moving for the charge-down bounce.'],
  ['pen-goal', 3, 60, 47, 'On the kick, jog back to the restart mark at halfway.', 'If they run it back, stop and defend first.'],
  ['pen-goal', 4, 52, 44, 'Take the front-pod lifer slot at the 10m line for the restart.', 'If the pod is full, hold the pocket behind it.'],
  ['pen-goal', 5, 45, 42, 'Set feet, eyes up, ready to lift or drive on the restart.', 'If a back is under it, form the maul around him.'],
  // drop-out-22
  ['drop-out-22', 1, 21, 44, 'Line up on the 22 to the right of the kicker in the chase wave.', 'If the front chase is loaded, take the second wave inside.'],
  ['drop-out-22', 2, 26, 42, 'Chase connected and onside; never outrun your inside man.', 'If the kick is long, slow and set the line at halfway.'],
  ['drop-out-22', 3, 32, 40, 'Tackle the catcher immediately, deny the counter.', 'If two are on him, set the first pillar.'],
  ['drop-out-22', 4, 30, 44, 'Fold to the ruck-side pillar as they set up.', 'If they kick back, turn and escort our catcher.'],
  ['drop-out-22', 5, 28, 47, 'Reset the tight channels; expect their forwards to come at us.', 'If they go wide, fold with the ball, inside shoulder.'],
  // wide-edge
  ['wide-edge', 1, 57, 70, 'Fold openside as the last of the tight five into the 10-15m channel.', 'If the channel is filled, hold the short-side seal at the old ruck.'],
  ['wide-edge', 2, 58, 74, 'Trail the ball five metres inside and behind.', 'If a back has the inside cover, become the cleaner instead.'],
  ['wide-edge', 3, 60, 78, 'First to the wide ruck: secure, do not over-commit.', 'If the ball is safe, stand as the pillar on the touch side.'],
  ['wide-edge', 4, 61, 76, 'Guard the short side after the wide ruck — reload tries kill you.', 'If 3 is short-side, fold back openside to the pod.'],
  ['wide-edge', 5, 62, 70, 'Reload infield to balance the field one-three-three-one.', 'If the middle pod is set, hold as the fourth forward on the edge.'],
  // broken-field-def
  ['broken-field-def', 1, 42, 60, 'Turn and run the shepherding arc in front of their carrier.', 'If a faster man is on the arc, take the line behind him.'],
  ['broken-field-def', 2, 38, 58, 'Never chase directly behind; cut the angle to the touchline side.', 'If they cut back, brake and hold the inside.'],
  ['broken-field-def', 3, 33, 55, 'Force them to the touchline and the cover.', 'If the wing has him, peel off and take the support runner.'],
  ['broken-field-def', 4, 30, 52, 'Tackle the support or fill the pillar at the ruck.', 'If the pillar is filled, shield the jackal.'],
  ['broken-field-def', 5, 28, 48, 'Reset the pillars and call the reorganised numbers.', 'If we are outnumbered wide, drift and never dog-leg.'],
];

export default expand(2, t);
