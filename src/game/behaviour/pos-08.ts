import { expand, PointTuple } from './types';

// 8 — NUMBER EIGHT (100 points)
// Set piece: controls the ball at the base of the scrum (row 3, widest bind tolerance); PICKS AND GOES from a won
// scrum close to their line or on a deterministic one-in-five call (engine/forwardPack.ts eightPicksFromScrum).
// Lineout: TAIL JUMPER, lifted by 6 and 7. Open play: the BASE option a stride behind the hindmost foot on the side
// the 9 is not — pick-and-go or link — and on a carrying 9's hip; defence folds to the open guard.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 45.5, 50, 'Bind at the base between both locks, feet either side of the ball; the widest bind tolerance in the pack (1.15 m).', 'If the scrum is short a man, bind as a flanker.'],
  ['own-scrum-mid', 2, 45.5, 50, 'Control the ball with your feet; call "yes 9" only when the platform is stable.', 'If the scrum goes backwards, hold the ball in and reset.'],
  ['own-scrum-mid', 3, 46, 50, 'PICK AND GO from the base — close to their line, or one in five elsewhere — or release to 9.', 'If 9 calls it, release clean and follow him.'],
  ['own-scrum-mid', 4, 49, 50, 'Carry off the base at their 9/8 channel; or if 9 clears, link on his hip as the second option.', 'If tackled, present long for a fast recycle.'],
  ['own-scrum-mid', 5, 53, 50, 'Set at the BASE of the new ruck: a stride behind the hindmost foot, the side 9 is not.', 'If the base is manned, be the pod carrier.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 50, 'Bind at the base between both locks; eyes on their 8 and 9.', 'If short a man, bind as a flanker.'],
  ['def-scrum-22', 2, 16.5, 50, 'Hold the base square; you are the last man off — do not break early.', 'If they wheel, hold the shape.'],
  ['def-scrum-22', 3, 17, 50, 'On the ball out: tackle their 8 if he picks, else their 9 if he snipes.', 'If 7 has their 8, cover the 9.'],
  ['def-scrum-22', 4, 20, 52, 'Fold to the open guard on their first ruck — round the box, in through our gate.', 'If the guards are set, sweep behind.'],
  ['def-scrum-22', 5, 22, 54, 'Reset as the open guard or the sweeper for phase two.', 'If they kick, drop as the third man.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 19.5, 'SIXTH in the line: TAIL JUMPER, 6 in front of you and 7 behind as lifters.', 'If the call is front or middle, hold and prepare to receive off the back.'],
  ['own-lineout-att-5', 2, 95, 19.5, 'Time the tail jump on the hooker\'s release; the long throw is yours.', 'If the counter-lift is early, take it on the way down.'],
  ['own-lineout-att-5', 3, 95.5, 20.5, 'Take it at the top; turn and feed the maul, or carry off the top round the tail.', 'If off the top, give to 9.'],
  ['own-lineout-att-5', 4, 97, 22, 'Bind at the back of the maul and control the ball at its base.', 'If the maul forms without you, be the goal-line pick option.'],
  ['own-lineout-att-5', 5, 98, 25, 'Base of the new ruck: pick and go over the line.', 'If 9 clears, latch on the carrier.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49, 79, 'SIXTH in our defensive line: counter-jump the tail, 6 lifting in front.', 'If they throw front or middle, hold the tail gap.'],
  ['def-lineout-mid', 2, 49, 79, 'Watch for the tail move and their 8 carrying off the top.', 'If they maul, join the defensive drive at the back.'],
  ['def-lineout-mid', 3, 48, 77, 'Contest the tail; if it goes down, tackle their 8 round the tail.', 'If they maul, bind the back.'],
  ['def-lineout-mid', 4, 46, 72, 'Fold to the open guard on their first ruck, behind our hindmost foot.', 'If set, sweep.'],
  ['def-lineout-mid', 5, 45, 66, 'Open guard or sweeper for phase two.', 'If they kick, drop.'],

  // att-phase-mid
  ['att-phase-mid', 1, 53, 47, 'BASE OPTION: a stride behind the hindmost foot, the side 9 is not — pick-and-go or link.', 'If the base is manned, be the near-pod carrier.'],
  ['att-phase-mid', 2, 54, 48, 'Read 9: if he picks, you are on his hip; if he passes, take the ball flat and hard.', 'If 9 goes wide, trail as the support runner.'],
  ['att-phase-mid', 3, 56, 49, 'Carry through contact; arms free for the offload.', 'If tackled behind the gain line, present long and fast.'],
  ['att-phase-mid', 4, 57, 49, 'Offload to the trailer if the tackle is broken.', 'If no support, present and roll away.'],
  ['att-phase-mid', 5, 58, 52, 'Reload to the base of the next ruck; approach behind the ball.', 'If the base is set, be the far-side carry threat.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 55, 'FOLD OPEN: the open guard 2.4 m outside the box edge on the hindmost-foot line — watch the pick and the snipe.', 'If the guards are filled, sweep behind the line.'],
  ['def-line-mid', 2, 44, 56, 'Hold the line; the pick-and-go and the 9 snipe are yours.', 'If wide, fold at pace with the ball.'],
  ['def-line-mid', 3, 43, 57, 'Dominant tackle on their pod carrier.', 'If a team-mate tackles, be the counter-ruck body — through the gate.'],
  ['def-line-mid', 4, 43, 55, 'Counter-ruck through the gate or drop as sweeper.', 'If numbers are thin, always sweep.'],
  ['def-line-mid', 5, 43, 52, 'Reset as guard; call the count.', 'If they kick, drop as the third man.'],

  // kickoff-receive
  ['kickoff-receive', 1, 28, 46, 'Second-line receiver behind the locks: the tap-back catcher.', 'If the kick is long, be under it.'],
  ['kickoff-receive', 2, 27, 46, 'Track the flight; call it if it clears the front.', 'If a lock catches, seal.'],
  ['kickoff-receive', 3, 26, 46, 'Catch or seal; present.', 'If spilled, first hands.'],
  ['kickoff-receive', 4, 25, 48, 'Base of the exit ruck: pick option for 9.', 'If safe, link.'],
  ['kickoff-receive', 5, 27, 48, 'Chase the exit kick in the middle.', 'If stocked, second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 48, 50, 'Halfway, second wave, centre — the link behind the first wave.', 'If short, contest.'],
  ['kickoff-chase', 2, 55, 50, 'Chase connected behind the contest.', 'If clean catch, set the tackle.'],
  ['kickoff-chase', 3, 60, 50, 'Arrive at the contest as the second cleaner — behind the ball.', 'If they win it, guard.'],
  ['kickoff-chase', 4, 58, 50, 'Open guard on their exit ruck.', 'If wide, fold.'],
  ['kickoff-chase', 5, 55, 50, 'Reset into the line.', 'If they kick, drop.'],

  // exit-box-kick
  ['exit-box-kick', 1, 12, 48, 'Base of the box-kick ruck behind 9: protect him, pick option if the kick is off.', 'If set, be the guard.'],
  ['exit-box-kick', 2, 12, 48, 'Hold until the kick; take the counter-ruck.', 'If charged, protect the 9.'],
  ['exit-box-kick', 3, 15, 48, 'Break behind the ruck; trail the chase in the middle.', 'If charged down, first on the ball.'],
  ['exit-box-kick', 4, 20, 48, 'Trail at 10 m.', 'If they counter, set the tackle.'],
  ['exit-box-kick', 5, 26, 48, 'Reset as the guard.', 'If kicked back, drop.'],

  // counter-deep
  ['counter-deep', 1, 12, 54, 'Inside carry option for the catcher.', 'If a back is there, wider.'],
  ['counter-deep', 2, 15, 56, 'Take the inside pass and carry hard.', 'If they kick, ruck.'],
  ['counter-deep', 3, 20, 58, 'Base of the first counter ruck, behind the ball.', 'If secure, pick option.'],
  ['counter-deep', 4, 24, 58, 'Pick and go or link with 9.', 'If none, set the pod.'],
  ['counter-deep', 5, 28, 54, 'Base of the exit ruck.', 'If 9 kicks, hold the ruck.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 53, 'Base of the red-zone ruck: THE pick-and-go carrier.', 'If a pod has the ball, latch and drive.'],
  ['red-zone-22', 2, 81, 54, 'Pick from the base and attack the post defender\'s shoulder.', 'If they are set, pop to 9 for the wrap.'],
  ['red-zone-22', 3, 83, 55, 'Fight for the line; legs driving.', 'If held up, twist and place back.'],
  ['red-zone-22', 4, 84, 55, 'Present, roll, rise for the next quick phase.', 'If contested, secure it.'],
  ['red-zone-22', 5, 85, 51, 'Reload to the base as the constant pick threat.', 'If wide, trail as the support runner.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 49, 'Guard next to the post on our goal line, or sweep behind.', 'If guards are filled, sweep.'],
  ['goal-line-def', 2, 3.5, 50, 'Hold; watch their 8 pick and their 9 snipe.', 'If they switch sides, shuffle across.'],
  ['goal-line-def', 3, 3, 51, 'Dominant tackle: drive them back over the line.', 'If second man, hold him up.'],
  ['goal-line-def', 4, 3, 49, 'Counter-ruck through the gate or protect our jackal.', 'If neither is on, reset on the line.'],
  ['goal-line-def', 5, 3.5, 47, 'Recount the line; call the guards.', 'If they chip, be the sweeper.'],

  // att-maul
  ['att-maul', 1, 90, 22, 'Back of the maul: control the ball at its base.', 'If the maul is set without you, bind on the side.'],
  ['att-maul', 2, 91, 23, 'Drive; keep the ball at the back.', 'If it wheels, straighten.'],
  ['att-maul', 3, 92.5, 25, 'Hold the ball; call the peel or the drive over.', 'If it stalls, carry off the back.'],
  ['att-maul', 4, 94, 27, 'Drive over or carry off the back.', 'If stopped, pick and go.'],
  ['att-maul', 5, 93, 31, 'If halted, base of the ruck that follows: pick and go.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 34, 47, 'Take the turnover ball and carry into space immediately.', 'If a back has it, support on his inside shoulder.'],
  ['turnover-att', 2, 37, 50, 'Break the first tackle; the defence is unset.', 'If tackled, present fast.'],
  ['turnover-att', 3, 42, 53, 'Offload out of contact if support has arrived.', 'If isolated, go to ground safely.'],
  ['turnover-att', 4, 47, 56, 'Base of the next ruck: second-phase pick — approach behind the ball.', 'If secure, be 9\'s pick option.'],
  ['turnover-att', 5, 51, 54, 'Reload as the go-forward carrier.', 'If they have reset, set a pod.'],

  // turnover-def
  ['turnover-def', 1, 60, 43, 'Get behind the ball line; become the sweeper behind the scramble.', 'If already deep, run the cover arc.'],
  ['turnover-def', 2, 55, 44, 'Cover the middle-field kick and the inside break.', 'If the line has a hole, fill it.'],
  ['turnover-def', 3, 50, 44, 'Last-ditch tackle or shepherd them to touch.', 'If they cut inside, commit.'],
  ['turnover-def', 4, 45, 44, 'Counter-ruck through the gate at the resulting breakdown.', 'If a jackal is on, protect him.'],
  ['turnover-def', 5, 41, 44, 'Open guard or sweeper for their next phase.', 'If short wide, keep folding.'],

  // tap-pen
  ['tap-pen', 1, 69, 46, 'THE tap carrier: take it on the mark and go.', 'If 9 taps, be his first pick option.'],
  ['tap-pen', 2, 70.5, 47, 'Carry hard at the retreating line.', 'If they are set, pop to 9.'],
  ['tap-pen', 3, 72, 48, 'Break the first tackle; keep the legs going.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 48, 'Base of the tap ruck: pick again.', 'If contested, secure.'],
  ['tap-pen', 5, 74, 46, 'Reload as the pick threat.', 'If set, pod carrier.'],

  // pen-goal
  ['pen-goal', 1, 72, 50, 'Behind the kicker, centre-right.', 'If quick, hold.'],
  ['pen-goal', 2, 72, 50, 'Watch the strike.', 'If short, chase.'],
  ['pen-goal', 3, 60, 50, 'Jog back to the restart shape.', 'If it misses, chase the drop-out.'],
  ['pen-goal', 4, 46, 50, 'Second-line receive slot.', 'If manned, seal.'],
  ['pen-goal', 5, 42, 48, 'Set feet behind the locks.', 'If short kick, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 50, 'On the 22 centre, second wave.', 'If long, contest.'],
  ['drop-out-22', 2, 26, 50, 'Chase behind the first wave.', 'If clean, set the tackle.'],
  ['drop-out-22', 3, 32, 50, 'Tackle the catcher or take the second man.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 50, 'Fold to the open guard through our gate.', 'If set, sweep.'],
  ['drop-out-22', 5, 28, 50, 'Reset as guard.', 'If kicked back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 62, 'Link with 9 as the ball goes wide: on his hip, a stride behind.', 'If 9 is wide, be the middle pod carrier.'],
  ['wide-edge', 2, 58, 66, 'Trailing support 8 m inside the ball.', 'If it comes back, base.'],
  ['wide-edge', 3, 60, 70, 'Arrive at the wide ruck behind the ball, through the gate, if needed.', 'If secure, stay up.'],
  ['wide-edge', 4, 61, 68, 'Base of the wide ruck: the pick option on the blind of 9.', 'If 6 has the blind, hold the far post.'],
  ['wide-edge', 5, 62, 60, 'Reload infield to the base.', 'If set, +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 58, 'Drop as the sweeper behind the shepherding arc.', 'If a back sweeps, join the arc.'],
  ['broken-field-def', 2, 38, 56, 'Cover the chip and the inside break.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 54, 'Last-ditch tackle.', 'If inside cut, commit.'],
  ['broken-field-def', 4, 30, 52, 'Counter-ruck through the gate or protect the jackal.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 50, 'Open guard or sweeper for the reset.', 'If short, hold width.'],
];

export default expand(8, t);
