# Ball-synchronised player behaviour

Follow-up to `BALL_PHYSICS.md`. Work stays on `arena/01a080b0-rugby` and the
cumulative patch is based on `origin/v2-arch` (`497988a`).

## Disconnects found

The original four live reproductions in `scripts/ballbehaviourprobe.ts` all
failed before this change:

- Moving an empty-handed former carrier changed other players' targets while
  the physical loose ball stayed in exactly the same place.
- Support followed the passer rather than the arriving pass.
- A nearby prop ignored a rolling kick while the designated fullback chased
  from much farther away.
- The recovery-chase filter selected attackers instead of defenders.

Further inspection and browser checks exposed incorrectly signed receiving
and defensive depths, support paths that bypassed the final shape checks,
centimetre-scale open-side flipping, and misleading possession/action text.
The fly-half's “pocket” was explicitly **ahead** of the nine while the throw
solver correctly tried to deliver a backwards pass. Defensive drift and
fullback sweep marks could similarly finish behind the attacking carrier.

## Changes

### One ball read, one job, one movement owner

`engine/ballAwareness.ts` classifies held possession, a pass, a kick, a loose
ball and set-piece ownership. It reads the current physical body, its velocity
and a bounded interception forecast. A free ball/pass has **no carrier**.
Camera framing remains separate from the tactical anchor.

During unowned play every eligible player gets one role: collector/receiver,
close support, receiving-channel containment, wider cover, reload or retreat.
These roles take priority over old-carrier, pod, positional and echelon
instructions. Positions are still integrated by the existing `steer`/phase
owner; the planner only writes targets and intent.

- Each side has one collector and nearby support, with wider goal-side cover.
- Reachable players are selected by arrival time, speed and turning cost, not
  by a mandatory fullback shirt. Existing collectors win near-ties within
  0.28 s; material deflections and unavailable players cause a fresh choice.
- An actual in-progress gather has priority over a speculative receiver.
- Kick and ordinary loose-ball pursuit use the same decisions. The existing
  six-chaser restart commitment and pre-strike movement gate are retained.
- Ahead-at-kick players retreat and cannot gather until put onside by an
  onside team-mate. This state follows a kick into its loose-ball continuation.

### Rugby positioning and transitions

- The ten stages behind the nine, with twelve and thirteen progressively
  deeper. Wings and the fullback offer legal receiving/support positions.
- A final held-ball mark check also covers the early dataset/pod return paths:
  support cannot be sent in front to demand a forward pass, and defenders
  cannot be sent behind the attacker to guard the wrong goal.
- Defensive drift, blitz/jam approach and the fullback sweep are goal-side.
  The closest live defenders confront the carrier; a capped recovery group
  chases after a break. A beaten last fullback does not abandon the runner.
- The live open side is retained through small central movement, switching
  only beyond a six-metre lateral band. Formation and positional trees share
  it, so the backline does not repeatedly cross itself around x = 0.
- Passes no longer inject an instantaneous velocity into receivers/support.
  Players run to the physical intercept through ordinary acceleration. A
  manually controlled receiver/fielder is not moved again by phase logic.
- Ruck residents exit outward **and back** before following the entry route.
  A distributor no longer strafes parallel to the offside line without
  retiring while his job says “get to the base”.

### What the player sees

Waiting receivers/collectors face and reach toward the actual ball in both
the rig and stand-in render paths. Moving players still face their movement;
low gathers keep their feet planted. A whistle or ownership transition clears
old attention/flight roles. The narrative, context action, action bar and
broadcast possession line distinguish a loose ball/pass from held possession.

## Verification

All **13 required commands** listed in `BALL_PHYSICS.md` pass. Additionally:

- `npx tsx scripts/ballbehaviourprobe.ts`: **17/17**, including held receiving
  depth, both defensive directions, all support paths, open-side stability,
  old-carrier independence, pass defence, rolling kicks, role stability after
  a deflection/injury, kick offside/rejoining, last-man chase, human single
  movement ownership, cleanup, HUD, real Three heading updates and
  30/60/120 Hz live pursuit without position jumps.
- `scripts/looseballprobe.ts`: **18/18**.
- `scripts/ballphysicsprobe.ts`: **9/9**, zero leaked ball constraints.
- `scripts/ballikprobe.ts` and `harness/ball-carrier-constraint.ts`: pass.
- The new behaviour probe is strictly type-checked separately from the
  project (project `tsconfig` excludes scripts).
- Both five-minute endurance trials complete without NaNs, out-of-bounds
  players, stall/watchdog freezes, unhandled exceptions or leaked constraints.

Some existing probes encoded the old disconnect. Their assertions now grade
actual held possession (not a detached ball with an old carrier number),
backwards receiving depth (not a forward-pass target), and distribution UI
before release plus its removal during flight. The set-piece probe still
requires a whistle-clean set-piece/maul handoff and audits its four-second
tail for movement, NaNs, side entry and watchdogs; it separately reports
penalties from *new* tackles/rucks after that handoff. It does not disable
those laws. The IK performance probe now compares retained heap after GC,
outside its timed interval, rather than mistaking V8's temporary numeric
boxing/nursery timing for a per-frame leak. Its thresholds are unchanged; it
no longer claims to count all temporary JavaScript allocations.

## Browser verification

The earlier browser blocker was resolved without a package mirror: the
installed `@sparticuz/chromium/bin/al2023.tar.br` contains the missing NSS/NSPR
libraries. They were extracted into ignored scratch storage and supplied via
`LD_LIBRARY_PATH` to the headless browser, without changing system packages.

The real menu-to-match path rendered successfully in Chromium/SwiftShader.
Controlled held-ball and loose-flight scenarios were also advanced through
the real MatchView Director and rendered in the actual Three scene. The
captured data shows a backwards receiving echelon, goal-side defence, two
collectors with support and wider cover, and zero watchdog trips. There were
no page/console errors; the browser reported a benign GLB preload timing
warning. These are software-rendered functional/visual checks, **not** GPU
performance measurements or a claim of complete professional-rugby AI.

Generated logs, browser fixtures/screenshots and extracted libraries are kept
out of Git. Reload the preview/start a fresh match when trying the changes so
an old Director instance cannot survive hot reload with the previous logic.
