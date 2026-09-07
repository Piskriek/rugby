import { expand, PointTuple } from './types';

// 7 — OPENSIDE FLANKER (100 points)
// PRIMARY JACKAL: hunts the loose ball before the ruck forms, runs to the DEFENCE GATE of a held carrier so he is
// over the ball legally the frame it forms; once the ruck is set he is the openside post on the hindmost-foot line.
// Set piece: open flank of the scrum, first off on the ball; lineout TAIL lifter for 8, or off the back as the
// roving tackler when defending. Attack: first support on the open side of the base, always through the gate.
const t: PointTuple[] = [
  // own-scrum-mid
  ['own-scrum-mid', 1, 46.5, 60.5, 'Bind on the openside flank, head between 3 and 5; push square, break first on the ball.', 'If 6 is openside, take the blind flank.'],
  ['own-scrum-mid', 2, 46.5, 60.5, 'Stay bound and square; do not break before the ball is out.', 'If we wheel, follow the wheel and stay legal.'],
  ['own-scrum-mid', 3, 47.5, 58, 'Detach the instant the ball is out; first man to the ball on the open side.', 'If 8 picks blind, chase and be the second cleaner.'],
  ['own-scrum-mid', 4, 51, 55, 'Track flat behind the backs as the link / first cleaner.', 'If the pass goes wide, sprint the arc.'],
  ['own-scrum-mid', 5, 55, 53, 'Be first to the breakdown — behind the ball, in through the gate — secure or stand as pillar.', 'If secure, stand up as 9\'s short option.'],

  // def-scrum-22
  ['def-scrum-22', 1, 16.5, 58.5, 'Bind on the openside flank; eyes on their 9 and 10.', 'If 6 is openside, take the blind.'],
  ['def-scrum-22', 2, 16.5, 58.5, 'Stay bound until the ball is out — early break is a penalty.', 'If their 8 picks, detach and hit him behind the gain line.'],
  ['def-scrum-22', 3, 16.5, 56, 'Break and hunt their 10; shut the exit kick.', 'If 6 presses, take the inside channel.'],
  ['def-scrum-22', 4, 19, 53, 'Tackle the first receiver — and get to the DEFENCE GATE of the tackle before the ruck forms.', 'If they kick long, become the trailing cover.'],
  ['def-scrum-22', 5, 21, 52, 'JACKAL: over the ball through the gate the frame the ruck forms; on your feet, hands on.', 'If not on your feet, reset as the guard.'],

  // own-lineout-att-5
  ['own-lineout-att-5', 1, 95, 21.5, 'TAIL of the line: back lifter of the tail pod, 8 in front of you.', 'If the call is front or middle, hold and prepare to peel.'],
  ['own-lineout-att-5', 2, 95, 21.5, 'Lift 8 on the tail call; on the front and middle calls, hold.', 'If the maul forms, bind at the back.'],
  ['own-lineout-att-5', 3, 95.5, 22.5, 'Bind the back of the maul; drive it.', 'If off the top, be the first cleaner for 10.'],
  ['own-lineout-att-5', 4, 97, 24, 'Watch for the maul stalling; carry off the back if it halts.', 'If it moves, keep driving.'],
  ['own-lineout-att-5', 5, 98, 27, 'First to the next breakdown, behind the ball, through the gate.', 'If 8 takes it, latch and drive.'],

  // def-lineout-mid
  ['def-lineout-mid', 1, 49.5, 77, 'OFF the back of their line — the roving tackler; ready to press their 10.', 'If 6 has the press, cover the inside.'],
  ['def-lineout-mid', 2, 49.5, 77, 'Time your break with the throw; do not go early.', 'If a maul forms, attack the ball carrier.'],
  ['def-lineout-mid', 3, 48, 74, 'Tackle the first receiver or hunt the loose ball.', 'If they maul, bind the back side.'],
  ['def-lineout-mid', 4, 46, 68, 'JACKAL: to the defence gate of the tackle before the ruck forms; hands on, on your feet.', 'If not clearly on your feet, reset as the guard.'],
  ['def-lineout-mid', 5, 45, 62, 'Openside post for phase two: on the hindmost-foot line, outside the box on the open side.', 'If wide, be first to the next tackle.'],

  // att-phase-mid
  ['att-phase-mid', 1, 52, 54, 'FIRST SUPPORT on the open side of the base: 0.8 m outside the box edge, two metres behind the hindmost foot.', 'If a forward is the link, be the far pod tail.'],
  ['att-phase-mid', 2, 54, 55, 'Follow the ball flat and fast; be the closest support to every carry.', 'If wide, sprint the arc.'],
  ['att-phase-mid', 3, 56, 56, 'Arrive first: clean, latch or take the tip-on — always behind the ball, in through the gate.', 'If the ruck is secure, stand as pillar.'],
  ['att-phase-mid', 4, 57, 55, 'Do not over-commit — one cleaner is enough for quick ball.', 'If the ball is threatened, commit fully.'],
  ['att-phase-mid', 5, 58, 52, 'Reload behind the ruck as the permanent link.', 'If 9 wants a short runner, be that runner.'],

  // def-line-mid
  ['def-line-mid', 1, 44, 51, 'OPENSIDE POST: on the hindmost-foot line, outside the box on the open side, hunting the jackal.', 'If 6 is there, take the guard one wider.'],
  ['def-line-mid', 2, 44, 53, 'Read their shape; be first to any tackle near the ruck.', 'If wide, sprint the arc.'],
  ['def-line-mid', 3, 43, 55, 'The carrier is HELD: run to the defence gate of the tackle — you must be over the ball, legally, the frame it forms.', 'If another jackal is on, seal and protect him.'],
  ['def-line-mid', 4, 43, 53, 'Hunt the loose ball on the deck before the ruck forms; win the penalty or force slow ball, then release.', 'If a cleaner hits you, stay strong and force the holding-on call.'],
  ['def-line-mid', 5, 43, 50, 'Reset immediately; first defender to the next ruck.', 'If exhausted, drop to guard.'],

  // kickoff-receive
  ['kickoff-receive', 1, 30, 56, 'Open-side lifter for 5 on the right catch.', 'If the kick goes left, seal for 4.'],
  ['kickoff-receive', 2, 29, 57, 'Lift 5 on the call.', 'If short, protect.'],
  ['kickoff-receive', 3, 28, 57, 'Land him; seal from behind.', 'If spilled, first hands.'],
  ['kickoff-receive', 4, 27, 54, 'Link off the exit ruck.', 'If safe, be 9\'s option.'],
  ['kickoff-receive', 5, 29, 50, 'Chase the exit kick, open channel.', 'If stocked, second wave.'],

  // kickoff-chase
  ['kickoff-chase', 1, 49, 62, 'Halfway, first wave, open side — the first tackler.', 'If the kick goes left, chase connected.'],
  ['kickoff-chase', 2, 56, 62, 'Chase hard; hunt the catcher.', 'If they catch clean, tackle.'],
  ['kickoff-chase', 3, 61, 61, 'Tackle — then to the defence gate before the ruck forms; jackal.', 'If they win it, post.'],
  ['kickoff-chase', 4, 58, 58, 'Openside post on their exit ruck.', 'If wide, first to the next tackle.'],
  ['kickoff-chase', 5, 55, 54, 'Reset into the line.', 'If they kick, trail.'],

  // exit-box-kick
  ['exit-box-kick', 1, 13, 60, 'Open guard of the box-kick ruck.', 'If set, right post.'],
  ['exit-box-kick', 2, 13, 60, 'Hold square until the kick.', 'If charged, protect the 9.'],
  ['exit-box-kick', 3, 15, 58, 'Break and chase the open channel — first to the catcher.', 'If charged down, first on the ball.'],
  ['exit-box-kick', 4, 20, 56, 'Chase at 10 m; tackle the catcher.', 'If they counter, set the tackle.'],
  ['exit-box-kick', 5, 26, 54, 'Jackal the first counter ruck through the gate.', 'If kicked back, drop.'],

  // counter-deep
  ['counter-deep', 1, 12, 64, 'Open support for the catcher.', 'If a back is there, wider.'],
  ['counter-deep', 2, 15, 66, 'Inside pass option; keep the counter alive.', 'If they kick, ruck.'],
  ['counter-deep', 3, 20, 66, 'First to the counter ruck through the gate.', 'If secure, pillar.'],
  ['counter-deep', 4, 24, 64, 'Clear the first threat from behind.', 'If none, be 9\'s link.'],
  ['counter-deep', 5, 28, 60, 'Link off the exit ruck.', 'If 9 kicks, hold the ruck.'],

  // red-zone-22
  ['red-zone-22', 1, 80, 56, 'Link for the 9 in the red zone, off the open edge of the box.', 'If a forward links, be the tight latch.'],
  ['red-zone-22', 2, 81, 58, 'Follow the ball; first to every red-zone breakdown, through the gate.', 'If a pod carries, immediate cleaner.'],
  ['red-zone-22', 3, 83, 60, 'Secure sub-3-second ball or take the short pick.', 'If contested, commit.'],
  ['red-zone-22', 4, 84, 58, 'Do not over-commit; goal-line defences want you buried.', 'If safe, be 9\'s snipe decoy.'],
  ['red-zone-22', 5, 85, 55, 'Reload behind the ruck as the link.', 'If wide, sprint the arc.'],

  // goal-line-def
  ['goal-line-def', 1, 4, 53, 'Beside the post as the designated jackal on our line.', 'If a jackal is set, be his sealer.'],
  ['goal-line-def', 2, 3.5, 54, 'Hold; do not gamble until the tackle is complete.', 'If they switch, shuffle.'],
  ['goal-line-def', 3, 3, 55, 'The carrier is grounded short: to the defence gate, hands on the ball.', 'If a maul forms, join and drive.'],
  ['goal-line-def', 4, 3, 53, 'Win the goal-line turnover or force the held-up call.', 'If they get quick ball, back on the line.'],
  ['goal-line-def', 5, 3.5, 51, 'Reset on the line; call the pillar numbers.', 'If short far side, sprint behind.'],

  // att-maul
  ['att-maul', 1, 91, 24, 'Back-right of the maul: the driving engine on the open side.', 'If set, bind on the side.'],
  ['att-maul', 2, 92, 25, 'Drive square.', 'If it wheels, straighten.'],
  ['att-maul', 3, 93.5, 27, 'Keep the ball moving back.', 'If at the back, be the carrier.'],
  ['att-maul', 4, 95, 29, 'Drive over; keep binding.', 'If stopped, peel open.'],
  ['att-maul', 5, 94, 33, 'If halted, be the link for 9 off the back.', 'If it goes, stay bound.'],

  // turnover-att
  ['turnover-att', 1, 34, 45, 'You are usually the winner: rip, jackal or scoop and go.', 'If a team-mate won it, be his protector.'],
  ['turnover-att', 2, 37, 48, 'Get the ball away from the contact area within two seconds.', 'If a back has it, hardest support line.'],
  ['turnover-att', 3, 42, 52, 'Trail the break at the carrier\'s inside shoulder.', 'If two trail inside, go outside.'],
  ['turnover-att', 4, 47, 55, 'Secure the next ruck — from behind the ball.', 'If secure, be the link.'],
  ['turnover-att', 5, 51, 53, 'Reload behind the ruck as the link.', 'If wide, sprint the arc.'],

  // turnover-def
  ['turnover-def', 1, 60, 44, 'Get behind the ball line and hunt their carrier — the counter-jackal.', 'If onside, run the shepherding arc.'],
  ['turnover-def', 2, 55, 45, 'Fill the nearest hole; connect the scramble.', 'If filled, second brake.'],
  ['turnover-def', 3, 50, 46, 'Make the tackle, then straight to the defence gate of it.', 'If a team-mate tackles, be first to the jackal.'],
  ['turnover-def', 4, 45, 46, 'Hunt the loose ball; broken-play turnovers are the cheapest.', 'If not on your feet, reset.'],
  ['turnover-def', 5, 41, 46, 'Openside post for their next phase.', 'If short wide, keep folding.'],

  // tap-pen
  ['tap-pen', 1, 69, 50, 'On the open of the mark: the link for the tap.', 'If 8 taps, latch.'],
  ['tap-pen', 2, 70.5, 51, 'Support the tap carrier at his inside shoulder.', 'If set, hold.'],
  ['tap-pen', 3, 72, 52, 'First to the tap ruck through the gate.', 'If tackled, present fast.'],
  ['tap-pen', 4, 73, 52, 'Secure or stand as pillar.', 'If contested, clear from behind.'],
  ['tap-pen', 5, 74, 50, 'Link for phase two.', 'If set, pillar.'],

  // pen-goal
  ['pen-goal', 1, 72, 60, 'Behind the kicker, wide right.', 'If quick, hold.'],
  ['pen-goal', 2, 72, 60, 'Watch the strike.', 'If short, chase.'],
  ['pen-goal', 3, 60, 58, 'Jog back to the restart shape.', 'If it misses, first chaser of the drop-out.'],
  ['pen-goal', 4, 46, 64, 'Right open receive slot.', 'If manned, seal.'],
  ['pen-goal', 5, 42, 64, 'Set feet; first to any loose ball.', 'If short kick, seal.'],

  // drop-out-22
  ['drop-out-22', 1, 21, 60, 'On the 22 open side, first wave — the first tackler.', 'If long, second wave.'],
  ['drop-out-22', 2, 26, 62, 'Chase hard; hunt the catcher.', 'If clean, tackle.'],
  ['drop-out-22', 3, 32, 64, 'Tackle the catcher; then to the defence gate.', 'If they run, set the line.'],
  ['drop-out-22', 4, 30, 60, 'Jackal the first ruck through our gate.', 'If set, post.'],
  ['drop-out-22', 5, 28, 56, 'Openside post for the reset.', 'If kicked back, drop.'],

  // wide-edge
  ['wide-edge', 1, 57, 74, 'Sprint the arc: first forward to the wide edge.', 'If a back is first, trail him.'],
  ['wide-edge', 2, 58, 78, 'Trailing support 3 m inside the ball.', 'If it comes back, link.'],
  ['wide-edge', 3, 60, 82, 'First to the wide ruck — behind the ball, in through the gate.', 'If secure, stand up.'],
  ['wide-edge', 4, 61, 80, 'Link off the wide ruck for 9.', 'If 6 has the guard, far post.'],
  ['wide-edge', 5, 62, 72, 'Reload as the link.', 'If set, +1.'],

  // broken-field-def
  ['broken-field-def', 1, 42, 64, 'Turn and hunt: the trailing tackler.', 'If a back has the arc, trail.'],
  ['broken-field-def', 2, 38, 60, 'Cut the angle; run to where he will be.', 'If they pass, take the support runner.'],
  ['broken-field-def', 3, 33, 57, 'Trailing tackle from behind.', 'If inside cut, commit.'],
  ['broken-field-def', 4, 30, 53, 'To the defence gate of the tackle; jackal before the ruck forms.', 'If both taken, sweep.'],
  ['broken-field-def', 5, 28, 50, 'Openside post for the reset.', 'If short, hold width.'],
];

export default expand(7, t);
