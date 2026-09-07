import { expand, PointTuple } from './types';

// 2 — HOOKER (100 points)
// Set piece: the lowest man in the pack (0.62 of standing height) bound on both props inside 0.7 m; throws the
// lineout to the locks (4 front, 5 middle) or the 8 at the tail. Open play: HUB of the short-carry pod one pass
// off the 9 — tip-on or carry — two metres outside the ruck box; primary clearer through the gate only.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 48.5, 50, 'Hook between 1 and 3; the lowest man in the pack, 0.62 of standing height at the strike.', 'If the feed is lost, drive as a third prop.'],
  ['own-scrum-mid', 2, 48.5, 50, 'Hold the strike channel square; heels driving, bind tight on both props.', 'If it wheels, strike early and clean.'],
  ['own-scrum-mid', 3, 50, 50, 'On the ball out, stay bound until 8 or 9 has it clear.', 'If 8 picks, be his first latch.'],
  ['own-scrum-mid', 4, 53, 47, 'Track the first carry at 6 m depth as the first-arriving cleaner — from behind the ball.', 'If the ruck is safe, become the pod hub.'],
  ['own-scrum-mid', 5, 55, 45, 'Set as the HUB of the pod one pass off the ruck: tip-on or carry.', 'If the hub is taken, be the +1 latch.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 50, 'Hook against the head: strike on their feed if the tunnel allows.', 'If their strike is clean, drive.'],
  ['def-scrum-22', 2, 16.5, 50, 'Keep the tunnel straight and legal — a penalty here is a shot at goal.', 'If the referee resets, stay low.'],
  ['def-scrum-22', 3, 17, 51, 'Break to the blindside first; the hooker leads the short-side defence.', 'If 6 has the blind, go open.'],
  ['def-scrum-22', 4, 20, 48, 'Fold round the corner as the first man past the ball — through our gate, never across.', 'If the fold is stocked, guard.'],
  ['def-scrum-22', 5, 22, 46, 'Set in the tight-five chase line for their second phase.', 'If they kick, drop to the ruck.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 96.5, 6, 'In the hutch on touch; the whole line reads your grip.', 'If the mark moves, re-mark.'],
  ['own-lineout-att-5', 2, 96.5, 6, 'Throw flat and fast to the called pod: 4 at the front, 5 in the middle, 8 at the tail.', 'If the front is contested, go middle.'],
  ['own-lineout-att-5', 3, 96, 9, 'On the catch, step in and bind the front of the maul.', 'If it is off the top, trail 9.'],
  ['own-lineout-att-5', 4, 97, 12, 'Drive the maul, legs pumping; feed the ball back.', 'If it stalls, be the goal-line pick option.'],
  ['own-lineout-att-5', 5, 97, 15, 'Goal-line option: flat pass from the base or a snipe.', 'If 9 has it, latch on the carrier.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49.5, 94.5, 'In the 5 m channel mirroring their thrower, one metre back.', 'If they throw quick, tackle.'],
  ['def-lineout-mid', 2, 49.5, 94.5, 'Read their hooker\'s grip: long hold means tail.', 'If it goes front, cover the peel.'],
  ['def-lineout-mid', 3, 48, 92, 'On the throw, cover the front peel and the 9 snipe.', 'If they maul, bind the front.'],
  ['def-lineout-mid', 4, 46, 84, 'Fold infield with the ball; enter any ruck behind our hindmost foot.', 'If the guards are set, be the sweeper.'],
  ['def-lineout-mid', 5, 45, 76, 'Set as the pillar on the open side of their phase two.', 'If they go blind, take it.'],

  // att-phase-mid
  ['att-phase-mid', 1, 53, 46, 'HUB of the pod one pass off the 9, two metres outside the box edge.', 'If a lock is the hub, be his latch.'],
  ['att-phase-mid', 2, 54, 47, 'Square, hands up: tip on to the wide man or carry yourself.', 'If the ball goes wide, run a decoy.'],
  ['att-phase-mid', 3, 56, 48, 'Carry or tip; if you carry, low and square, never lateral.', 'If 3 carries, latch and drive.'],
  ['att-phase-mid', 4, 57, 49, 'Present long; roll; get up — the hooker reloads first.', 'If the jackal is on, clear him through the gate.'],
  ['att-phase-mid', 5, 58, 44, 'Reload the next pod within four seconds, coming from behind the ball.', 'If set, be the pillar on the open edge.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 49, 'Guard: one man off the pillar, on the hindmost-foot line, three metres off the ball.', 'If 4 has the guard, slide wider.'],
  ['def-line-mid', 2, 44, 47, 'Hold; watch the pod; do not bite the decoy.', 'If the ball moves on, fold along the line.'],
  ['def-line-mid', 3, 43, 45, 'Low tackle on the pod carrier.', 'If a team-mate tackles, get over the ball through our gate.'],
  ['def-line-mid', 4, 43, 43, 'Fold to the next ruck round the box, in through the mouth.', 'If two fold, hold the sweeper.'],
  ['def-line-mid', 5, 43, 41, 'Reset as guard; call the count.', 'If short, hold width.'],

  // kickoff-receive
  ['kickoff-receive', 1, 30, 51, 'Middle receiver, under the likely landing.', 'If it goes long, drop.'],
  ['kickoff-receive', 2, 28, 50, 'Track the flight; call it early.', 'If a back calls, seal him.'],
  ['kickoff-receive', 3, 26, 50, 'Seal the catcher from behind.', 'If spilled, first hands.'],
  ['kickoff-receive', 4, 25, 52, 'Set the platform square for 9.', 'If safe, pillar.'],
  ['kickoff-receive', 5, 27, 50, 'Chase the exit kick in the middle channel.', 'If stocked, second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 49, 47, 'Halfway, second wave, middle.', 'If short, contest.'],
  ['kickoff-chase', 2, 55, 46, 'Chase connected.', 'If clean catch, set tackle line.'],
  ['kickoff-chase', 3, 60, 46, 'Arrive at the contest as the seal — from behind the ball.', 'If they win it, pillar.'],
  ['kickoff-chase', 4, 58, 48, 'Pillar for their exit ruck.', 'If wide, fold.'],
  ['kickoff-chase', 5, 55, 50, 'Reset into the line.', 'If they kick, trail.'],

  // exit-box-kick
  ['exit-box-kick', 1, 13, 48, 'Middle of the box-kick ruck, bound low.', 'If the ruck is set, be the guard.'],
  ['exit-box-kick', 2, 13, 48, 'Hold square until the kick.', 'If charged, protect the 9.'],
  ['exit-box-kick', 3, 15, 49, 'Break behind the ruck and chase inside.', 'If charged down, first on the ball.'],
  ['exit-box-kick', 4, 20, 50, 'Trail the chase at 10 m.', 'If they counter, set the tackle.'],
  ['exit-box-kick', 5, 26, 50, 'Reset into the line.', 'If kicked back, drop.'],

  // counter-deep
  ['counter-deep', 1, 12, 52, 'Inside support for the catcher.', 'If a back is there, wider.'],
  ['counter-deep', 2, 15, 55, 'Tight inside pass option.', 'If they kick, ruck.'],
  ['counter-deep', 3, 20, 58, 'Sprint to the first counter ruck — through the gate.', 'If secure, pillar.'],
  ['counter-deep', 4, 24, 58, 'Clean the first threat, from behind.', 'If none, set the pod.'],
  ['counter-deep', 5, 28, 54, 'Hub of the exit pod.', 'If 9 kicks, hold the ruck.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 49, 'Hub of the tight pod one pass off the ruck.', 'If set, latch.'],
  ['red-zone-22', 2, 81, 50, 'Tip or carry at the post defender.', 'If 4 carries, drive him.'],
  ['red-zone-22', 3, 82.5, 51, 'Fight for the line; keep the ball up.', 'If held, place back.'],
  ['red-zone-22', 4, 83, 49, 'Roll away; reload — tempo.', 'If contested, clear the jackal through the gate.'],
  ['red-zone-22', 5, 84, 46, 'Reset the pod hub.', 'If manned, far post.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 49, 'Guard beside the pillar on our line.', 'If taken, next slot.'],
  ['goal-line-def', 2, 3.5, 49, 'Hold and hit.', 'If wide, shuffle.'],
  ['goal-line-def', 3, 3, 48, 'Low tackle, kill the drive.', 'If second in, under the ball.'],
  ['goal-line-def', 4, 3, 47, 'Compete only through the gate on your feet.', 'If 7 has it, seal.'],
  ['goal-line-def', 5, 3.5, 46, 'Reset the stack; recount.', 'If they spread, spread.'],

  // att-maul
  ['att-maul', 1, 92, 19, 'Front of the maul after the throw.', 'If set, bind on the side.'],
  ['att-maul', 2, 93, 20, 'Drive square.', 'If it wheels, straighten.'],
  ['att-maul', 3, 94.5, 22, 'Transfer the ball back.', 'If at the back, drive.'],
  ['att-maul', 4, 96, 24, 'Keep binding on the drive over.', 'If stopped, pick option.'],
  ['att-maul', 5, 95, 28, 'If halted, be the base option for 9.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 33, 46, 'Second body over the steal, from behind it.', 'If secure, hub.'],
  ['turnover-att', 2, 35, 49, 'Depth, then the support line.', 'If a back leads, decoy.'],
  ['turnover-att', 3, 39, 52, 'Trail the break at 10 m.', 'If crowded, go outside.'],
  ['turnover-att', 4, 44, 54, 'First to the next ruck; enter behind the ball.', 'If safe, pillar.'],
  ['turnover-att', 5, 48, 50, 'Reload the pod hub.', 'If set, extra body.'],

  // turnover-def
  ['turnover-def', 1, 60, 49, 'Get behind the ball line first.', 'If onside, fill a hole.'],
  ['turnover-def', 2, 56, 50, 'Fill the nearest hole.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 50, 'Shepherd them inside.', 'If they cut back, commit.'],
  ['turnover-def', 4, 44, 49, 'Trailing tackle or pillar.', 'If a jackal is on, protect him.'],
  ['turnover-def', 5, 40, 48, 'Reset the pillars.', 'If short, fold.'],

  // tap-pen
  ['tap-pen', 1, 69, 42, 'Tight on the mark: the tap carrier or the first latch.', 'If 8 taps, latch.'],
  ['tap-pen', 2, 70.5, 43, 'Take the tap at pace.', 'If set, hold.'],
  ['tap-pen', 3, 72, 44, 'Carry hard, low.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 44, 'Roll, rise, reload.', 'If contested, clear from behind.'],
  ['tap-pen', 5, 74, 41, 'Set the pod hub for phase two.', 'If set, pillar.'],

  // pen-goal
  ['pen-goal', 1, 72, 48, 'Behind the kicker, centre.', 'If quick, hold.'],
  ['pen-goal', 2, 72, 48, 'Watch the strike.', 'If short, chase.'],
  ['pen-goal', 3, 60, 48, 'Jog back to the restart shape.', 'If it misses, chase the drop-out.'],
  ['pen-goal', 4, 50, 50, 'Middle receive slot.', 'If manned, second wave.'],
  ['pen-goal', 5, 45, 50, 'Set feet; shield the catcher.', 'If short kick, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 47, 'On the 22 beside the kicker.', 'If long, second wave.'],
  ['drop-out-22', 2, 26, 46, 'Chase straight.', 'If clean catch, set the tackle.'],
  ['drop-out-22', 3, 32, 45, 'Tackle the catcher.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 47, 'Fold into the guard — through our gate.', 'If set, sweeper.'],
  ['drop-out-22', 5, 28, 48, 'Reset the line.', 'If kicked back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 68, 'Fold openside as the middle forward.', 'If stocked, hold the middle pod.'],
  ['wide-edge', 2, 58, 72, 'Trailing support 5 m inside the ball.', 'If it comes back, pillar.'],
  ['wide-edge', 3, 60, 76, 'Arrive at the wide ruck behind the ball, through the gate.', 'If secure, stay up.'],
  ['wide-edge', 4, 61, 74, 'Hub of the reload pod.', 'If 6 has the guard, far post.'],
  ['wide-edge', 5, 62, 66, 'Reload infield.', 'If set, +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 58, 'Shepherding arc, inside 1.', 'If a back has it, trail.'],
  ['broken-field-def', 2, 38, 55, 'Cut the angle.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 53, 'Force them to touch.', 'If inside cut, commit.'],
  ['broken-field-def', 4, 30, 50, 'Tackle the support or pillar the ruck.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 47, 'Reset the guard; recount.', 'If short, hold width.'],
];

export default expand(2, t);
