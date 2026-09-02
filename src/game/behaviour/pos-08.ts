import { expand, PointTuple } from './types';

// 8 — NUMBER 8 (100 points)
const t: PointTuple[] = [
  ['own-scrum-mid', 1, 45.5, 38, 'Bind at the base of the scrum between both locks, feet either side of the ball.', 'If the scrum is short a body, still hold the base — never leave it unguarded.'],
  ['own-scrum-mid', 2, 45.5, 38, 'Control the ball with your feet; call "yes 9" only when the platform is stable.', 'If the scrum goes backwards, hold the ball in and wait for the reset or penalty.'],
  ['own-scrum-mid', 3, 46.5, 39, 'Pick and go, or release to 9. Read their back row before deciding.', 'If their 8 has already broken, release the ball to 9 immediately.'],
  ['own-scrum-mid', 4, 49, 42, 'Carry into the seam at the flanker\'s outside shoulder.', 'If 9 played away, follow as the trailing support runner.'],
  ['own-scrum-mid', 5, 53, 46, 'Present, or be the second-phase carrier off 9 to keep momentum.', 'If a pod is set, be the tail runner for the far pod.'],

  ['def-scrum-22', 1, 14, 40, 'Bind at the base; keep the scrum square and hold the platform.', 'If our scrum is retreating, stay bound and drive.'],
  ['def-scrum-22', 2, 14, 40, 'Watch their 8 and 9; be ready to break with the ball or on the pick.', 'If they pick, hit them immediately as the first tackler.'],
  ['def-scrum-22', 3, 15, 42, 'Break the moment the ball leaves; pressure the base and the 9.', 'If 7 has the 9, take the inside channel to cover the snipe.'],
  ['def-scrum-22', 4, 18, 45, 'Tackle their carrier or chase their exit kick.', 'If they clear long, turn and become the covering forward.'],
  ['def-scrum-22', 5, 21, 47, 'Guard or jackal at their first ruck.', 'If not on your feet, re-set into the line.'],

  ['own-lineout-att-5', 1, 95, 23, 'Stand at the back of the lineout as a jump or receiver option.', 'If 6 or 7 has the tail, be the receiver behind the maul.'],
  ['own-lineout-att-5', 2, 95, 24, 'Bind at the back of the maul and control the ball at the base.', 'If the maul is formed without you, be the runner off the back.'],
  ['own-lineout-att-5', 3, 96.5, 24, 'Read the maul; call "hold" while it moves and "away" if it stalls.', 'If the maul is turned, take the ball out immediately.'],
  ['own-lineout-att-5', 4, 98, 26, 'Take the ball off the back and carry over from close range.', 'If a defender is set, pop to 9 for the wrap-around.'],
  ['own-lineout-att-5', 5, 98.5, 30, 'Present, then be the next pick-and-go carrier at the post.', 'If posts are filled, become 9\'s decoy for the blindside strike.'],

  ['def-lineout-mid', 1, 50, 96, 'Stand at the back of their lineout, marking the tail and 8 channel.', 'If 6 is at the tail, take the position behind the lineout as sweeper.'],
  ['def-lineout-mid', 2, 50, 95, 'Watch for the tail move and their 8 carrying off the top.', 'If they maul, join the defensive drive on the back shoulder.'],
  ['def-lineout-mid', 3, 47, 90, 'Make the first tackle on their 8 or tail carrier.', 'If a maul forms, hold it up or drive it into touch.'],
  ['def-lineout-mid', 4, 45, 84, 'Fold infield with the ball as a wide defender.', 'If 7 jackals, protect him from the cleanout.'],
  ['def-lineout-mid', 5, 44, 78, 'Set as guard for their phase 2, or as the sweeper behind the line.', 'If they kick, drop into the backfield as the third cover.'],

  ['att-phase-mid', 1, 53, 47, 'Lead carrier of the near pod, or stand behind the ruck as the second option.', 'If the pod is set, become the +1 behind the pod as the pick option.'],
  ['att-phase-mid', 2, 54, 48, 'Take the ball off 9 flat and hard; you are the go-forward carrier.', 'If 9 goes wide, trail the play as the support runner.'],
  ['att-phase-mid', 3, 56, 49, 'Carry through contact, keep the arms free for the offload.', 'If tackled behind the gain line, present long and fast.'],
  ['att-phase-mid', 4, 57, 49, 'Offload to the trailing runner if the tackle is broken.', 'If no support, present and roll away.'],
  ['att-phase-mid', 5, 58, 52, 'Reload as the second playmaker option off the next ruck.', 'If the pod is set, become the far-side carry threat.'],

  ['def-line-mid', 1, 44, 49, 'Guard or first defender off the ruck on the openside.', 'If guards are filled, take the sweeper role behind the line.'],
  ['def-line-mid', 2, 44, 51, 'Hold the line, watch for the pick-and-go and the 9 snipe.', 'If the ball goes wide, fold at pace with the ball.'],
  ['def-line-mid', 3, 43, 53, 'Dominant tackle on their pod carrier; win the collision.', 'If a team-mate tackles, be the counter-ruck body.'],
  ['def-line-mid', 4, 43, 51, 'Counter-ruck or drop as sweeper behind the pillars.', 'If numbers are thin, always take the sweeper role.'],
  ['def-line-mid', 5, 43, 48, 'Re-set as guard and communicate the count.', 'If they kick, drop into the backfield as the third man.'],

  ['kickoff-receive', 1, 33, 50, 'Stand in the pocket 5m behind the front pods, centre channel.', 'If the pods are short, join one as the lifter.'],
  ['kickoff-receive', 2, 32, 48, 'Read the kick; take any ball dropping behind or between the pods.', 'If it goes to a pod, be the first sealer on the catcher.'],
  ['kickoff-receive', 3, 30, 46, 'Catch and take contact strongly, or seal the maul.', 'If we lose it, counter-ruck immediately.'],
  ['kickoff-receive', 4, 28, 45, 'Carry off the receiving maul to gain metres for the exit.', 'If we box kick, protect the 9\'s pocket.'],
  ['kickoff-receive', 5, 30, 48, 'Chase the exit kick, or stay as the sweeper if we run it.', 'If beaten, become the trailing cover defender.'],

  ['kickoff-chase', 1, 49, 46, 'Chase the seam between the contest pod and the sweepers.', 'If the pod needs a jumper, become the contester.'],
  ['kickoff-chase', 2, 55, 44, 'Chase connected; be the man who cleans the tap-back.', 'If the ball is long, brake and become the sweeper.'],
  ['kickoff-chase', 3, 60, 42, 'Secure the loose ball or make the dominant tackle.', 'If a team-mate has it, clean the threat off him.'],
  ['kickoff-chase', 4, 58, 45, 'Set the guard at their exit ruck or counter-ruck it.', 'If they kick, drop into the backfield cover.'],
  ['kickoff-chase', 5, 55, 48, 'Re-set into the line as guard or sweeper.', 'If out of position, take the sweeper role behind the line.'],

  ['exit-box-kick', 1, 13, 46, 'Stand as the openside protection at the box-kick ruck.', 'If the protection is set, become the chase seam runner.'],
  ['exit-box-kick', 2, 13, 46, 'Shield the 9 from their openside pressure.', 'If the ruck is threatened, add weight low.'],
  ['exit-box-kick', 3, 17, 48, 'On the kick, chase or drop as the sweeper depending on the call.', 'If the kick is short, sprint forward to tackle.'],
  ['exit-box-kick', 4, 22, 49, 'Sweep behind the chase line to stop the counter through the middle.', 'If the chase wins it, join the ruck as a cleaner.'],
  ['exit-box-kick', 5, 27, 49, 'Re-set as guard or sweeper in the reformed line.', 'If they counter wide, funnel infield.'],

  ['counter-deep', 1, 13, 52, 'Sprint back to be the power option inside the catcher.', 'If a lock is inside, take the outside support line.'],
  ['counter-deep', 2, 17, 56, 'Take the ball and break the first tackle to launch the counter.', 'If the counter goes wide, trail behind the ball.'],
  ['counter-deep', 3, 23, 60, 'Offload out of the tackle to keep the counter alive.', 'If isolated, take the tackle safely and present.'],
  ['counter-deep', 4, 27, 58, 'Reload as the carrier to get us over the 22 line.', 'If we are pinned, protect the kicker.'],
  ['counter-deep', 5, 32, 54, 'Carry again or become the second playmaker off 9.', 'If we kick, chase in the middle channel.'],

  ['red-zone-22', 1, 80, 53, 'Stand behind the ruck as the pick-and-go carrier in the red zone.', 'If a pod has the ball, be the latch and drive.'],
  ['red-zone-22', 2, 81, 54, 'Pick from the base and attack the post defender\'s shoulder.', 'If they are set, pop to 9 for the wrap.'],
  ['red-zone-22', 3, 83, 55, 'Fight for the line; keep the legs driving through contact.', 'If held up, twist and place backwards.'],
  ['red-zone-22', 4, 84, 55, 'Present, roll and rise for the next quick phase.', 'If contested, secure the ball first.'],
  ['red-zone-22', 5, 85, 51, 'Reload behind the ruck as the constant pick threat.', 'If we go wide, trail as the support runner.'],

  ['goal-line-def', 1, 4, 49, 'Guard next to the post on our goal line, or sweep behind.', 'If guards are filled, be the sweeper behind the line for the chip.'],
  ['goal-line-def', 2, 3.5, 50, 'Hold; watch their 8 pick and their 9 snipe.', 'If they switch sides, shuffle across.'],
  ['goal-line-def', 3, 3, 51, 'Dominant tackle: drive them back over the line if possible.', 'If second man, get under the ball and hold him up.'],
  ['goal-line-def', 4, 3, 49, 'Counter-ruck or protect our jackal.', 'If neither is on, re-set on the line.'],
  ['goal-line-def', 5, 3.5, 47, 'Recount the line and call the guards; no dog-legs.', 'If they kick a chip, be the sweeper who fields it.'],

  ['att-maul', 1, 92, 25, 'Stand at the back of the maul controlling the ball.', 'If 2 has the ball, bind and drive as the engine.'],
  ['att-maul', 2, 93, 26, 'Steer the maul; call the rhythm and read the defensive drive.', 'If the maul is turned, take the ball out immediately.'],
  ['att-maul', 3, 94.5, 28, 'Break off the back and carry if it stalls; do not get held.', 'If it is moving, stay bound and drive.'],
  ['att-maul', 4, 96, 30, 'Carry over the line, or pop to 9 for the wrap-around.', 'If tackled short, present instantly.'],
  ['att-maul', 5, 96, 33, 'Reload as the pick-and-go threat at the new ruck.', 'If a pod is set, be the second-man option.'],

  ['turnover-att', 1, 34, 47, 'Take the turnover ball and carry into space immediately.', 'If a back has it, sprint into support at his inside shoulder.'],
  ['turnover-att', 2, 37, 50, 'Break the first tackle; the defence is unset and narrow.', 'If tackled, present fast for the tempo phase.'],
  ['turnover-att', 3, 42, 53, 'Offload out of contact if support has arrived.', 'If isolated, go to ground safely and protect.'],
  ['turnover-att', 4, 47, 56, 'Secure the ruck or be the second-phase carrier.', 'If secure, be the 9\'s pick option.'],
  ['turnover-att', 5, 51, 54, 'Reload as the go-forward carrier to punish the scramble.', 'If they have reset, revert to structure and set a pod.'],

  ['turnover-def', 1, 60, 43, 'Get onside and become the sweeper behind the scramble line.', 'If already deep, run the cover arc infield of the ball.'],
  ['turnover-def', 2, 55, 44, 'Cover the middle-field kick and the inside break.', 'If the line has a hole, fill it and connect.'],
  ['turnover-def', 3, 50, 44, 'Make the last-ditch tackle or shepherd them to touch.', 'If they cut inside, commit to the tackle.'],
  ['turnover-def', 4, 45, 44, 'Counter-ruck at the resulting breakdown.', 'If a jackal is on, protect him instead.'],
  ['turnover-def', 5, 41, 44, 'Set as guard or sweeper for their next phase.', 'If short wide, keep folding.'],

  ['tap-pen', 1, 69, 36, 'Stand behind the 9 as the primary tap carrier for the power option.', 'If 9 taps and goes himself, be his immediate latch.'],
  ['tap-pen', 2, 71, 37, 'Take the ball at pace and blast through the retreating defender.', 'If they are set, hold and set a pod.'],
  ['tap-pen', 3, 72.5, 38, 'Get over the gain line and keep the arms free for the offload.', 'If tackled, present instantly.'],
  ['tap-pen', 4, 73.5, 38, 'Roll, rise, be the next carrier — tempo is everything.', 'If threatened, seal the ruck.'],
  ['tap-pen', 5, 75, 40, 'Set as the pick-and-go carrier for phase 2.', 'If a pod exists, be the second-man runner.'],

  ['pen-goal', 1, 72, 49, 'Stand behind the kicker, calm, ready to react.', 'If crowded, move wider.'],
  ['pen-goal', 2, 72, 49, 'Be alert for the charge-down; you cover the middle.', 'If clearly good, retreat for the restart.'],
  ['pen-goal', 3, 60, 49, 'Retreat towards halfway into the restart pocket.', 'If they counter, defend first.'],
  ['pen-goal', 4, 51, 48, 'Take the pocket 5m behind the front pods on the restart.', 'If the pods need a body, join one.'],
  ['pen-goal', 5, 44, 46, 'Ready to catch the ball that drops between the pods.', 'If it goes long, let the back three field it.'],

  ['drop-out-22', 1, 21, 48, 'Chase in the middle channel just behind the front rank.', 'If the front is loaded, become the sweeper behind the chase.'],
  ['drop-out-22', 2, 27, 47, 'Chase connected; cover the tap-back and the counter through the middle.', 'If long, become the sweeper.'],
  ['drop-out-22', 3, 33, 45, 'Tackle the catcher or counter-ruck the contest.', 'If a team-mate tackles, counter-ruck.'],
  ['drop-out-22', 4, 31, 47, 'Guard at their ruck or sweep behind the line.', 'If they kick back, be the escort for our catcher.'],
  ['drop-out-22', 5, 29, 49, 'Re-set as guard or sweeper.', 'If they go wide, fold with the ball.'],

  ['wide-edge', 1, 57, 74, 'Fold to the openside as the extra forward in the wide channel.', 'If the edge is stocked, be the middle pod\'s pick threat.'],
  ['wide-edge', 2, 58, 78, 'Offer the inside carry to stop the edge play being isolated.', 'If the ball goes to the wing, trail as support.'],
  ['wide-edge', 3, 60, 84, 'Support the wide ruck, then stand up as the pillar.', 'If secure, be the pick threat to attack back infield.'],
  ['wide-edge', 4, 61, 80, 'Carry back infield off the wide ruck to reset the field.', 'If a back carries, be the cleaner.'],
  ['wide-edge', 5, 62, 68, 'Reload towards the middle as the go-forward carrier.', 'If balanced, hold as the far-edge extra.'],

  ['broken-field-def', 1, 42, 66, 'Run the deep cover arc as the sweeper behind the scramble.', 'If the sweeper role is filled, take the inside shoulder line.'],
  ['broken-field-def', 2, 37, 62, 'Cover the inside cut-back — the most common broken-field try.', 'If they go outside, keep running the arc.'],
  ['broken-field-def', 3, 33, 58, 'Make the last-ditch tackle or funnel them to touch.', 'If covered, mark the support runner.'],
  ['broken-field-def', 4, 30, 55, 'Counter-ruck at the resulting breakdown; they will be isolated.', 'If a jackal is on, seal him.'],
  ['broken-field-def', 5, 28, 51, 'Set as guard or sweeper and call the reorganisation.', 'If outnumbered, hold the sweeper role and cover kicks.'],
];

export default expand(8, t);
