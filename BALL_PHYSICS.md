# Rugby ball physics

Base: `origin/v2-arch` at `497988a`. Work remains on the assigned Arena branch.

## Model and ownership

- **Shape:** 28 × 19 cm prolate (egg-like oval), 430 g, long axis local X.
  `src/core/physics/ballShape.ts` supplies dimensions/mass to the mesh, the
  deterministic match solver, and Rapier's convex-hull ball collider.
- **Rendering:** `ThreeEnvironment.buildRugbyBallMesh()` builds a scaled
  `SphereGeometry` with a four-panel, high-contrast seam texture and
  `MeshToonMaterial`. `ThreePlayerManager` maintains one visible world entity,
  including held balls, set-piece rituals and missing-GLB fallbacks. Rendering
  reads simulation quaternions, reflects z, and adds the existing pitch crown;
  it does not invent free-running spin or replace the ball with a HUD dot.
- **Contacts:** `engine/ballPhysics.ts` integrates normalized orientation `q`
  and world angular velocity `omega`, with substeps no longer than 1/240 s.
  Ellipsoid support gives both the contact offset and the centre's minimum
  height (9.5–14 cm). Normal impulses apply `r × J` through the rotated inertia
  tensor; Coulomb friction acts on contact-point slip. Belly restitution is
  0.60, reducing toward 0.46 at a tip. Steep-impact deformation dissipates
  tangential/spin energy, so a bomb sits up while a shallow grubber skids.
- **Tip symmetry:** a mathematically perfect, exactly vertical spheroid has
  zero impact torque. A deterministic 6 mm tip seam/contact-patch offset models
  the real ball/turf imperfection. Its lateral rebound and spin come from the
  impact impulse, not an unbudgeted random velocity kick.
- **Settling:** turf rolling resistance is time-based; a sustained quiet
  contact enters exact, bit-stable sleep (`vx = vy = vz = omega = 0`). An
  external impulse wakes it. The physics solver consumes no gameplay RNG.
- **Flight guard:** placed conversions/penalty shots and lineout throws retain
  their measured launch velocities and deterministic spin until turf/player
  contact. They do not inherit a kicker's walk-up momentum. The match's
  existing launch-accuracy selection remains separate from contact physics.
- **Sockets/releases:** ordinary carries and explicit secured grips share an
  authored torso/hand socket, synchronized after all player movement. Passes
  solve their impulse in the moving carrier frame; kicks and strips add their
  impulse to inherited velocity. Grip teardown is atomic, so held LMB cannot
  re-weld a departing pass. Free bodies are per match, not module-global.
- **Physical welds:** Rapier seats the ball using a rotated chest-local offset,
  matching orientation and socket velocity (including `omega × r`). Manual
  release accepts an impulse, removes the joint once, and restores collision
  groups and event settings. The physical scrimmage renders its actual body.

## Live gravity, player contacts and pickup follow-up

The live-play report exposed bugs outside the original drop-test kernel: free
physics ran *after* a human/upright-player gate, only some hand-control states
advanced gravity, AI formations could override a chase, and landing/sleep
fallbacks could award an absent player (including a default shirt 9).

- `engine/looseBall.ts` owns the free body's lifetime independently of human
  posture. `bc.free` remains the canonical body; `bc.loose` tracks its source,
  release exclusion, last touch, chase marks and short gather interval. Gravity
  runs before the human-control gate. Pass/kick handoffs explicitly skip a
  second physics integration in the handoff frame.
- `stepBallWithPlayers` resolves moving boot/leg/torso capsules and downed bodies
  in the same 1/240 s substeps as turf. Contacts use ellipsoid support, rotated
  inertia, relative player velocity, restitution and bounded friction. Boots
  can wake a sleeping ball; glancing hits deflect and spin it. These are
  kinematic player approximations, not a new player rigid-body simulation, and
  never add a second writer to player movement.
- `engine/ballAwareness.ts` now supplies a shared live-ball read and one
  collector plus nearby support per side, with wider cover behind them.
  Predicted-intercept roles take priority over old-carrier formations and
  positional trees. The controlled human keeps the stick; team-mates help
  without requiring any mouse button. Q selects an eligible collector on the
  human's side. Team-mates respect the short deliberate drop-punt window.
  See `BALL_BEHAVIOUR.md` for the subsequent positioning/coordination fixes.
- A gather requires real horizontal/vertical reach and a brief uninterrupted
  catch/scoop interval. Down, bound, recovering, diving and sin-binned players
  cannot collect. The renderer reads the engine's reach, aims the hands at the
  physical ball and bends for low scoops without lifting the player's root.
- A successful gather preserves the actual player's **team, shirt, position
  and velocity**, then welds to his socket. No player is moved to claim the
  ball. Sleep, elapsed time and the old carrier/stall watchdog checks cannot
  award possession. Real touch/dead-ball transitions still apply.
- Kicks remain fieldable after any number of bounces; an unclaimed landing
  continues as the same loose body, not a distant fullback's possession.
  Missed/deflected passes also stay physical rather than finding their intended
  recipient by deadline. Player touches update the touch-award team. The
  existing goal-kick, restart ten-metre and set-piece rules remain in place.

## Verification (all requested gates passed)

```text
npx tsc --noEmit
npm run build
npx tsx scripts/t43check.ts
npx tsx scripts/quickstartprobe.ts
npx tsx scripts/refereeprobe.ts
npx tsx scripts/forwardpackprobe.ts
npx tsx scripts/backlineprobe.ts
npx tsx scripts/matchenduranceprobe.ts
npx tsx scripts/setpieceprobe.ts
npx tsx scripts/controlsprobe.ts
npx tsx scripts/scorerestartprobe.ts
npx tsx scripts/maulprobe.ts
npx tsx scripts/ballphysicsprobe.ts
```

`ballphysicsprobe.ts` passes nine groups: 4 m tip/belly drops, twelve 10 m/s roll
fixtures at 30/60/120 Hz, oblique high-speed contacts, exact socket tracking,
live secured-pass release/catch/teardown, drop/strip/kick inheritance, protected
flights, permanent mesh geometry/material/orientation, and repeated physical
weld releases with **zero leaked ball joints**. Measured tip-drop lateral
rebound: **0.237 m/s**, spin **1.690 rad/s**; belly restitution **0.600**.
Slowest of the twelve roll fixtures: **9.83 s**, followed by five seconds of
bit-identical rest.

The follow-up adds `npx tsx scripts/looseballprobe.ts`: **18/18 groups** pass,
including live CPU/human gravity, falling former carriers, actual released
balls, control handoffs/Q, boot wake and deterministic torso deflection,
invalid/cancelled pickups, late-bounce kick fielding, exactly-once missed-pass
integration, same-shirt opposing-team interceptions, 30/60/120 Hz pursuit,
real Three hand/spine pose integration, touch/dead ball and 47 seconds of an
unclaimed sleeping ball without a phantom watchdog pickup. The initial five
live reproductions all failed before the follow-up fixes. The script is also
strictly type-checked separately, since project `tsconfig` excludes scripts.

The Quick Start smoke now releases its human charge at 55% power, checks the
**nearest** receiver's legal distance, identifies the **original** kickoff,
and ends its launch-watchdog audit at that kickoff's first open-play handoff.
The old fixture held the button forever and could accept a later CPU free
kick as its launch; its whole-minute `KICK` filter could then mistake a later,
unattended human restart for a failed launch. A deliberately disabled kickoff
still fails the strengthened smoke. The full minute still runs and reports
its total watchdog count; three additional unseeded runs passed.

Additional checks passed: `scripts/ballikprobe.ts` and
`harness/ball-carrier-constraint.ts`. The legacy punt check now measures the
**velocity change** against `J/m` rather than incorrectly requiring a boot
impulse to cancel retained runner momentum. Its human soak also operates the
lineout throw meter when a real punt reaches touch; watchdog assertions remain
unchanged.

The original delivery's browser smoke was blocked by missing NSS/NSPR and
unreachable Debian mirrors. The behaviour follow-up resolved this using the
libraries already bundled with Chromium: real menu-to-match and controlled
held/loose-play screenshots now render successfully with no page/console
errors. See `BALL_BEHAVIOUR.md` for the scope and reproduction notes. This is
SwiftShader software rendering, not a GPU performance measurement.
