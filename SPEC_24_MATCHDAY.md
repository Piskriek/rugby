# SPEC_24 — MATCH DAY (the AAA presentation pass)

**Status: SHIPPED.** No engine file changed its behaviour: the seeded rule audit is
bit-for-bit identical before and after this pass (see §Verification).

Opened after Season 4 shipped. The brief was "take the design document and make a
AAA rugby game". The design document is unusually honest about what a AAA game has
that it does not — `HANDOFF.md §6 CRITIQUE` names the gaps itself. This pass closes
the presentation half of that list, using only content that was already authored in
this repo.

---

## 1. WHAT WAS ALREADY TRUE (measured before writing anything)

The simulation gap list in §6 is largely closed already: opposing-player collision
is `T-04` in `separate()`, the breakdown is a sustained `axis` contest (`T-05`), the
sin bin is decremented and honoured by eleven call sites, cards are issued
(`laws.ts:138`), added time exists (`d.addedTime`), audio has a crowd bed, impacts
and a whistle (`T-10`), and a 3D squad with GLB skins runs over a 3D pitch with
instanced crowd and LED boards (`ThreePlayerManager`, `ThreeEnvironment`).

What was missing was not features. It was **the four condition systems the engine
already models and the renderer refused to show**:

| System | Modelled since | Read by the engine | Read by the renderer |
|---|---|---|---|
| `weather` (7 states) | `engine/weather.ts` | ball wetness, handling error, kick distance — 5 call sites | **nothing** |
| `pitch` (FIRM→FROZEN) | `retro.ts:pitchConditions` | acceleration, sidestep success, maul traction | the 2D stadium only, not `ENV_3D` |
| `wind` (5 states) | `windOf()` | lateral push on every kick | **nothing** |
| `timeofday` (4 states) | options menu | advertised as "changes crowd shading and the vignette weight" | **nothing at all** |

Measured, not assumed: `grep` for `options.weather|pitch|wind|timeofday` under
`src/render` and `src/ui` returns zero hits. The whole CONDITIONS block of the
options screen — thirty-five authored lines of design — was invisible.

And the lighting: `renderer.shadowMap.enabled = false` with no light rig except the
four decorative floodlights at **0.16 intensity each**. Every `MeshToonMaterial` in
the stadium was being lit by 0.64 units of total directional light. That, and not
the geometry, is why the 3D layer read as flat cardboard: a toon material with no
key light has no terminator, so there is nothing for the gradient map to quantise.

---

## 2. THE RULING

**Do not simulate harder. Show what is already simulated.** One new pure module
resolves the four condition systems into a single look, and everything on the render
side reads that object. Four rules held:

1. **The engine owns the numbers; `render/conditions.ts` owns the appearance of
   them.** `wetnessOf()`, `windOf()` and `pitchConditions()` are imported, never
   re-derived. The renderer never invents a gameplay constant, and `director.ts`
   can be played with `conditions.ts` deleted.
2. **FX are observed, never pushed.** `render/fxDirector.ts` diffs the Director
   (a `down` transition, a `bounces` increment, a `stage` crossing into ENGAGE) and
   emits particles. `director.ts` does not know FX exist — the ownership contract
   in §3.1 of the handoff is about positions, and a `fx.emit()` call inside a phase
   handler is exactly the "two systems writing one thing in one frame" bug with a
   particle count instead of a coordinate.
3. **One pipeline, not two.** The composer always runs when `ENV_3D` is on.
   FLAT 16-BIT switches its contributions to zero (bloom 0, no shadow map, no
   precipitation, no lens) rather than taking a different code path, because two
   colour pipelines drift and one set of parameters cannot.
4. **The TV package reads authoritative state or it does not exist.** Every figure
   in `ui/broadcast.tsx` is a getter off the Director (`clockText`, `momentum`,
   `stats.penaltiesConceded`, `lastScorer`, `tmo`, `conversionPending`). Nothing in
   the graphics layer keeps its own idea of the score.

---

## 3. WHAT LANDED

### 3a. `render/conditions.ts` — 60 authored look-values, 0 invented numbers
Four tables (`TIME_LOOK` × 4, `WEATHER_LOOK` × 7, plus the pitch lookup already in
`retro.ts`) resolved into one `Conditions` object: sky gradient, key colour and
elevation, hemisphere pair, fog, exposure, bloom threshold, precipitation type and
density, wind vector and slant, sheen, puddles, frost, steam, mud, dust, scarring,
vignette, grain, chroma, grade lift/gain, lens wetness. Cached by an option key so
it can be called at 60 Hz for free.

Sun elevation is the real reason a 4 p.m. kick-off at 50°N throws shadows the length
of a backline: `MIDDAY` 0.92 rad, `AFTERNOON` 0.40, `TWILIGHT` 0.09, `FLOODLIT`
falls back to the lamp battery (`floodlit: true`, key elevation 0.72 from the towers).

### 3b. `render/ThreeMatchDay.ts` — 27 draw calls, one of them 9 000 particles
* **Sky dome**: one back-side sphere, one shader — gradient, hash-noise star field,
  two-octave cloud deck drifting at the wind the ball is already obeying, sun/moon
  disc, and four glow bands on the floodlight bearings. `fog: false`, with the
  horizon colour set equal to the fog colour, so the dome and the atmosphere meet
  without a seam.
* **Light rig**: shadowed key + hemisphere pair + ambient + a cool fill off the far
  stand. The key's ortho frustum is **not** the pitch — it is a 42 m box re-centred
  on where the camera is looking, which is what buys 2048 texels over 42 m instead
  of 130 m (0.02 m per texel against 0.06 m, a 3× sharper edge for the same map).
* **Precipitation**: rain and snow are one `LineSegments` mesh animated entirely in
  the vertex shader — 9 000 drops, zero CPU per frame, `mod()` folding the fall into
  a window that follows the camera.
* **The wet layer**: a second quad over the turf painted once (sky-reflection
  gradient, 46 pools, 5 200 rime specks); only colour and opacity move. Plus ground
  mist banks that billboard to the rig, and additive floodlight cones whose opacity
  is what makes a rainy night under lights look like one.

### 3c. `render/ThreeParticles.ts` — one pool, eight behaviours
1 600 particles, one draw call, per-particle size and alpha. `TURF`, `MUD`, `DUST`,
`WATER`, `SPARK`, `STEAM`, `CONFETTI`, `SNOWPUFF`, each with its own gravity, drag,
wind coupling, restitution and lifetime. `PointsMaterial` cannot do this (one size
and one opacity per material) so the pool carries a 16-line shader; `uPixScale`
comes from the retro rig's own focal length, which is SPEC_16's argument restated:
scale the world and the lens together or they desync, and a clod becomes a boulder
at TACTICAL zoom.

### 3d. `render/fxDirector.ts` — the six triggers
Grounding (turf/mud/dust/water, sized by the *previous* frame's closing speed — the
engine zeroes velocity in the same frame it sets `down`, so reading `spd` after the
transition measures every tackle as a stationary collapse and no hit ever throws
turf), boot puffs, breath in the cold, ball strikes and bounces, scrum engagement,
ruck and maul collapses, lineout lifts landing, and the try.

It also returns one number that flows the other way: `impact`, which the view multiplies
into `gameSpeed` for a ~0.3 s steal of time on a big hit. Not the engine's — the engine
sees a smaller `dt`, which is what `director.ts:1318` already does with `gameSpeed`.

### 3e. Turf that remembers, and kits that dirty
`ThreeEnvironment.addScar()` paints a divot into a 512 × 256 wear canvas which is
composited over the pristine pitch paint at ≤4 Hz. Scars come from groundings, rucks,
mauls, kick strikes, ball bounces and scrum engagements, weighted by the engine's own
`pitch.firm`. Kit soiling accumulates per player in `ThreePlayerManager` from the
grounded/ruck/bind states and the pitch's mud factor, and **never recovers** — the
white shirt at minute 70 is not the white shirt at minute 1.

### 3f. `ui/broadcast.tsx` — the TV package
Score bug (kit shields, clock with `+TIME`, phase, penalty tally, bin pips, momentum
bar, possession split), the try stripe off `lastScorer` with the man's carries,
metres, tackles and rating — held open while `conversionPending` so it does not time
out mid-kick — the TMO card off `d.tmo` with a progress bar and the camera it is
using, the card graphic, the conditions strip, a live ratings board, and the replay
treatment. The lower third was rebuilt as one flex band (bug and stripe left,
commentary and narrative centre, conditions and hints right) because four absolutely
positioned panels each guessing at a corner overlap on any window narrower than
their arithmetic.

### 3g. Audio follows the sky (the design doc's own biggest gap, extended)
Two additions in `T-10`'s idiom: a **rain bed** (band-passed noise at 1.4–3.4 kHz,
so it sits *above* the crowd rather than inside it, peaking near −27 dBFS — under the
whistle and the tackle, as the D-5 headroom ruling requires) and a **try roar** that
arrives 0.35 s late with a 2.4 s decay, because a crowd reacting to a try is not a
crowd reacting on the frame of the try. `impact()` is now filtered by the pitch's
firmness: a dry slap on a firm November ground, a dead thud in the mud.

---

## 4. HONEST LIMITATIONS

* **No browser in this container, so no picture.** Everything verified here is
  verified by execution and by arithmetic: shaders parsed, conditions enumerated,
  frames driven. Whether the grade is *right* is a human decision, and the first
  look at the preview is the review.
* The particle pool is CPU-simulated. 1 600 particles of state is cheaper to write
  than to explain to a shader, but it is ~1 600 × 9 float reads and writes per frame;
  if a future pass wants 20 000 leaves on a GALE day, that one goes to the GPU.
* No depth of field, no SSR, no ray-traced anything. The broadcast lens droplets and
  the chroma split are the extent of the optical emulation.
* Shadow maps are single-cascade. A player standing in the far corner of a wide
  TACTICAL frame falls outside the 42 m box and loses his cast shadow; the blob
  contact shadow at his feet is what holds him to the turf there. That is a
  deliberate trade of a visible-if-rare absence for a 3× sharper edge everywhere else.
* The crowd is still an `InstancedMesh` of one merged geometry, so a stand is a
  pattern, not 3 300 people. Making them people is a modelling job, not a pass.

---

## 5. VERIFICATION

| Gate | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | clean |
| Build | `npm run build` | clean, single file |
| Rule audit | `npx vite-node scripts/audit-cli.ts 90 3 1` | **identical to `main`**: PASS 5343 · WARN 4 · FAIL 1, teleports 5, watchdog 0 |
| Score integrity | `npx vite-node scripts/spec07-contracts.ts` | ALL GREEN |
| Shaders | `npx vite-node scripts/glslcheck.ts` | 10 shaders scanned, 0 failing |
| Match-day | `npx vite-node scripts/matchdayheadless.ts` | all green |

The audit numbers were captured on this branch and on a clean `main` worktree with
the same pinned seed. **The engine did not move by one point.** Every change is in
`src/render/`, `src/ui/`, two audio methods and one options entry.

Two new harnesses ship with the pass, because neither was possible before:

* `scripts/glslcheck.ts` extracts every `/* glsl *\/` literal in `src/render`, wraps
  it in the prefix `WebGLProgram` would give it, and parses it. A shader that fails
  to compile is a black rectangle in the user's browser and no existing test can see
  it. It also enforces the rule that found three real defects on its first run:
  **`smoothstep(a, b, x)` with `a > b` is undefined in GLSL ES**, and two of the
  three were mine (the sky's under-horizon ramp, the lens droplet), the third the
  crowd flash envelope. All three are written `1.0 - smoothstep(b, a, x)` now.
* `scripts/matchdayheadless.ts` fakes a canvas context, builds the environment, the
  match-day rig and the FX pool against a real `THREE.Scene`, drives 80 s of live
  match through both update paths, injects a try to prove the celebration branch
  fires (200+ particles), then asserts the pool drains to zero and that `dispose()`
  leaves the scene empty. The condition matrix — 7 weather × 4 kick-off × 5 pitch ×
  3 quality = **420 resolutions** — is checked for finiteness, hex-format and range.

### New draw-call budget
Measured by instantiating the layers and counting `isMesh | isPoints | isLineSegments
| isSprite`: `ThreeEnvironment` 11 (unchanged, merged geometry), `ThreeMatchDay` **27**
(1 dome, 1 precipitation, 1 wet layer, 16 mist, 4 cones, 4 lamp glows, 1 flash field,
+0 lights), FX pool **1**, plus one extra depth pass over the squad when the shadow
map is enabled — throttled to every other frame in FULL, since a sprinter advances
0.16 m per frame against a 42 m box and the error is sub-texel.

---

## Addendum — the merge with the AAA edition (`6993915`)

This document described four new modules and one rewritten environment. A parallel
pass landed the same evening with its own environment, sky dome, post chain,
procedural turf and PBR squad. The full reconciliation and the reasoning per area
are in `AAA_EDITION.md`; three things here change how *this* document should be
read:

- **`ThreeEnvironment.ts` is now their file with my hooks inside it.** The pitch is
  `render/turf.ts`'s procedural albedo/roughness/normal set, so `applyConditions`
  no longer re-tints a painted canvas: it drives `roughness`, `color` and
  `envMapIntensity` on a `MeshStandardMaterial`, which is the correct PBR answer
  to "wet grass is shiny". `addScar()` paints into the turf's own albedo canvas
  and the upload is throttled (`flushTurf()`), so wear costs one texture upload
  every 0.28 s instead of one per ruck.
- **`ThreeSky.ts` and `ThreePost.ts` were deleted, and so were their two options.**
  Sky, key light, fog, shadow tier and flood level all come out of
  `resolveConditions()`; `graphics` became the existing `render` switch and
  `timeOfDay` was dropped in favour of the engine's own `timeofday`. `conditions.ts`
  is the only place in `src/render` allowed to decide what a wet pitch looks like.
- **Kit soiling was rewritten against their material model.** `applySoil()` now
  lifts `roughness` as it darkens the cloth, which the toon materials could not
  express; the ball's wetness likewise lowers its roughness. Their per-slot roughness
  table (jersey 0.74 → boots 0.28) is what makes that read as mud rather than as a
  colour filter.

Everything else in this document — the gap table, the four rulings, the FX
director, the composer order, the honest limitations — stands as written. The
verification numbers in the table still hold in the sense that matters — no
presentation change moved an engine number: `audit-cli.ts 90 3 1` after each merge
was byte-identical to the tree being merged in. The audit's own totals did move
once, and it was not our doing: `6bcbd54` fixed three teleports and bought one
extra `LAW-66`, which is a simulation decision, argued in `AAA_EDITION.md`.

The freeze fix that landed next (`8fb84d3`) is part of this picture, not a footnote
to it: the turf this pass paints into is now 2048 × 1024 off a precomputed noise
lattice (`render/noise.ts`) instead of 4096 × 2048 off 100 million `Math.sin`
calls, and the world is built across frames behind `ui/LoadingScreen.tsx` — a
staged boot whose every stage must settle, which is a stronger claim than it
sounded like the first time and is now tested (see the boot addendum at the end of
this file). Two
consequences for the design in this document, both now handled in
`ThreeEnvironment`: the scar pass is authored in metres and divided by the texture
size (a pixel-authored scar doubles in real size when the texture halves), and the
crowd's every-seventh idle bounce writes all rows once when a cheer decays.

---

## Addendum — the fall, and why the picture was grey

Both of these came out of playing the thing. One read as "the tackle is fake", the
other as "everything is grey shit", and they turned out to be the same problem
worn two different ways: the scene had no ambient light source that a physical
material could reflect, and a man who was hit had no floor to fall onto.

### The fall: physics owns the ground, the clip owns everything else

An authored tackle was always going to lose at the moment of impact — 30 pre-baked
poses cannot know where the man being hit happened to be. So `render/ragdoll.ts`
is a 20-particle position-based solver (Verlet, four Gauss–Seidel iterations,
fixed 1/120 substeps, five per frame maximum) and it is given exactly one job.

| Stage | Who owns the body | Why |
| --- | --- | --- |
| IMPACT (0–0.15 s) | the drive/wrap clips | a solver has no memory of intention; the wrap reads better authored |
| GROUNDING (0.15–0.40 s) | **the solver** | this is where a canned clip is found out |
| roll-away / get-up | the clips, faded against a settled solver | a physics-driven get-up looks like a drowning |

Four decisions carry the "realistic, at a low cost" brief:

- **The particles *are* the bones.** `spine_02` is not a joint with a bone
  attached to it; it is a point mass, and the solver's output is a set of
  *directions*. The animated clip keeps the twist of every limb and the solver
  replaces only where each bone points, so no skinning is rewritten and no
  second skeleton exists.
- **Translation stays with the engine.** `setAnchor(rx, -rz)` is called per frame
  and the solver is dragged by the delta, with the pelvis's excess drift eased
  back over the last 0.45 m of a 1.6 m allowance. A solver that disagrees with
  the simulation about where a man is has to lose, because the ruck, the offside
  line and the referee all read the simulation.
- **A hit is a torque, not an impulse.** Height-scaled initial velocity: a shoulder
  strike to the chest topples, a chop to the knees drops him. Seeded as a `prev`
  offset rather than a force, so stability costs nothing.
- **Only falling men simulate.** Two at a time, typically, for ~1 s. Measured
  cost: **0.083 ms/frame for eight simultaneous solved falls**, in the same loop
  that already walks the poses, with zero per-frame allocations.

Then there is the part an impact needs that a ragdoll does not give you for free:
the man who made the tackle must still be *holding* the man he hit. That is a soft
pin — the tackler's two hands pulled toward the carrier's waist inside the solver,
slack with distance, so a man thrown clear lets go by himself. An animation
layered over the physics to fake the grab is how a cheap ragdoll advertises
itself: the collision is solved and then undone, in the same half second.

`scripts/ragdollcheck.ts` runs twelve checks, headless, on a synthetic skeleton
with the shipped rig's names and conventions: settle inside 1.6 s, drawn bone
error under 3 %, no hyperextension past the joint limit, nothing more than 1 cm
through the turf, mud carrying a man a shorter distance than firm grass with the
same hit, two fallers who cannot pass through each other, the pinned wrap holding
tighter than a free arm, energy only leaving the system, no NaN and a
force-settle under a 44 m/s hit, byte-exact determinism, contacts drained once for
the wear pass, and a dragged anchor that changes where he is but not how he fell.

Four bugs it found, all of them the kind that ship because they look like "the
physics is a bit wobbly":

1. **A bounce that accelerated into the floor.** `prev.y = p.y + vy * -restitution`
   with `vy` already negative reflects the velocity the wrong way, so every
   contact drove the body harder down, and nothing ever calmed. The solve took
   2.4 s (its hard ceiling) instead of 1.0 s.
2. **A joint limit that was also a strut.** One-sided `max` links carried the
   seeded span as a `rest` target too, so below the ceiling they fought the
   structural link across it — and the elbow landed straighter than anatomy
   allows, precisely at the moment a hand presses on the deck. Joint limits now
   re-solve *after* the ground pass, projected in the floor.
3. **Friction as per-substep damping.** Scaling tangential velocity by a factor
   every substep stops a body in two frames on any setting above sticky, which is
   how mud and firm grass end up identical. Real friction is a fixed loss per
   unit time — `mu * g * h²` in displacement units — mass-independent, and now
   the difference between the two grounds is a distance you can see.
4. **Reading the pose back through `bone.matrixWorld`.** The usual way to blend a
   world-space aim into a bone, and a feedback loop: the rotation written last
   frame is the reference for the one written this frame. With the particles
   frozen at rest (0.05 m/s) the drawn head still whipped at 29 m/s. The solver
   now reads only the *parent's* frame and composes on top of whatever the mixer
   wrote this frame, so the limb keeps its twist and there is nothing to
   oscillate about.

### The grey: it was the fills, and the missing mirror

The probe (`scripts/lookprobe.ts`) rebuilds the rig — albedo, both lights, IBL,
exposure, extended-Reinhard, saturation, vignette — and prints what each surface
reaches on screen. Its first run said the whole story: `AFTERNOON` fed the rig
0.97 from the key against roughly 1.7 from hemisphere-plus-ambient, so the frame
was *authored* flat; a white kit clipped to exactly 1.000 and lost its chroma in
the curve; black boots were black in the albedo sense (0.009) with nothing to
reflect, because `scene.environment` was null and a PBR material with no env map
has no ambient specular at all.

Four fixes, in order of how much they mattered:

- **An environment map, from the sky we already draw.** `refreshEnvironment()`
  PMREMs a proxy mesh that shares the dome's shader — the dome itself is never
  re-parented, because moving it out of the scene would blank the sky — into a
  render target that becomes `scene.environment`, refreshed only when conditions
  change and disposed on teardown. Dark kit and boots now have something to
  reflect; `LEGACY` gets `null` and keeps its flat look on purpose.
- **Ratio, not level.** The keys came up (MIDDAY 4.15, `AFTERNOON` 3.85,
  `TWILIGHT` 2.30, `FLOODLIT` 3.55) and the fills came *down* (ambient 0.10–0.14),
  with a per-weather `iblMul` so overcast and fog — which really are giant soft
  boxes — draw their irradiance from the environment instead of from the ambient
  light. MIDDAY's white kit now lands at 0.958 instead of clipping, with the
  pitch at 0.409 and skin at 0.675 underneath it.
- **Fabric reflects less than plastic.** Kit albedo is multiplied by 0.78–0.82
  before lighting, because `#FFFFFF` is a *paint* swatch, not a shirt: unlit
  cotton is nearer 0.78, and that headroom is what lets the tone curve keep the
  folds and the mud in the shirt instead of printing a white card.
- **The stands are not the brightest thing on screen.** `CONCRETE` came down from
  `0x8a8f96` to `0x4b5158` (0.369 on screen against grass at 0.409). A grey
  stadium that out-shines the pitch is what "it looks like grey shit" was,
  literally: the eye adapts to the largest area it can find.

One condition-only rule is worth keeping an eye on: `keyMul` used to be applied to
floodlight as if the lamps were the sun behind a cloud. Rain halves a solar key
and costs a 400-lux array about a fifth of its own, so under `FLOODLIT` the
weather's attenuation is now taken at 42 % strength and the pitch lifts from 0.215
to 0.284. A wet night under the lights should not read as an unlit field.

Verification for this pass: `tsc --noEmit` clean, `ragdollcheck` 12 green,
`glslcheck` 10/0, `matchdayheadless` all green, `turfverify` ALL PASS,
`spec07-contracts` ALL GREEN, `teleprobe` 0 teleports, `build` 1,846.89 kB
(531 kB gzip, +12 kB for the solver), and `audit-cli.ts 90 3 1` still byte-identical
to the tree it was merged from — PASS 5407, WARN 2, FAIL 2, 0 teleports, 0 watchdog
trips. No engine file was touched: the ragdoll writes bones, never positions in
`live`. What still needs a human eye is the one thing no harness here can do:
whether a fall now *looks* right.
### Reconciled with the baked-fall pass (`d16bff1`, `936d105`)

The same brief was worked from the other side while this was being written, and
the two landed on the same file name. What arrived: an 11-node Verlet kernel in
flat `Float32Array`s, a 36-take library of falls simulated **offline** and played
back as a yaw-rotated table lookup (`ragdollClips.ts`, `scripts/ragdollbake.ts`),
and a claim worth checking rather than arguing with — playback at 0.0004 ms per
body per frame against a live solve at ~0.02 ms per body.

The split is by tier, because the two answers are right about different things:

| | STANDARD / FULL | LEGACY |
| --- | --- | --- |
| fall | `render/ragdoll.ts`, solved live from the pose, the opponent and the actual speeds | `render/ragdollClips.ts`, the nearest baked take, rotated to the heading, scaled to the pace |
| cost | 0.083 ms for eight bodies | 0.0014 ms for whatever is falling |
| why | a fall can be *about* this hit: joint limits, pair contact, the wrap held by the solver | the tier that cannot afford a solve still gets a body that obeys the ground |

They never run together: `ragdollEnabled` (set by `MatchView` from
`cond.quality !== 'LEGACY'`) chooses one, and the two guards in
`spawnBakedFall` / `startFall` make each path exclusive, because a pose written by
a table lookup and a pose written by a solver in the same frame is a shuffle, not
a blend. The kernel the library was baked from was moved to
`render/ragdollKernel.ts` and its harnesses repointed; `scripts/ragdollverify.ts`
still passes, including the two properties that make the bake legitimate at all —
yaw invariance to 0.45 mm, and bit-exact determinism. Both solvers now coexist
because each is testable without a browser and neither is load-bearing for the
other.

Three things that came in with it and are now part of this picture:

- **The pitch was sunk under itself.** The crown displaced local −Z on a mesh
  laid flat with `rotation.x = -π/2`, which maps that onto world **−Y**: the
  centre of the pitch sat 0.3 m below the outer ground plane, z-fighting it and
  eating the markings. Fixed to +Z, and `scripts/renderverify.ts` now asserts the
  sign, because a comment was not enough to keep it pointed the right way. This is
  a real part of "grey shit": a pitch fighting its own surround renders as one flat
  grey field with a shimmer.
- **The game defaulted to its flattest light.** `weather` opened on OVERCAST and
  `timeofday` on TWILIGHT — a grey sky at dusk, out of seven weathers and four
  kick-off times. Both defaults moved (`data.ts`), which is the cheapest fix in
  either pass and the only one that touches what a first frame is.
- **`audit-cli.ts 90 3 1` is unchanged by all of it**: PASS 5407, WARN 2, FAIL 2,
  points 997, 0 teleports, 0 watchdog trips — same as the tree merged into. The
  option defaults are read by the menus, not by the audit, so the simulation
  numbers could not move; that is the check, not the reassurance.

The price of the library is paid in the bundle, not the frame: `ragdollClips.json`
is 140 kB of quantised int16 (1,846.89 kB → 1,987.05 kB built, 531 → 616 kB gzipped),
inlined by the single-file build and read by one tier. It decodes lazily on first
fall, which is the right call and already done; moving the bytes themselves out of
the bundle would mean a second file, which is what the single-file build exists to
avoid.

## Addendum — the breakdown, pre-simulated (2026-09-06)

The follow-up verdict on the fall pass was "its better but not good", and the list that
came with it is the specification this addendum answers: how players behave at a tackle,
how they clean out, how the ball comes out, *"presimulated so its optimised"*, and —
verbatim — *"the blood puddles are hillarious btw"*. Two things had to be true at once, and
the way they usually conflict is the reason the breakdown looked like nothing: behaviour has
to be *specific* (who runs where, who hits whom, when the strike lands), and the frame cannot
afford to compute it.

### The ruling

Do not simulate the breakdown at runtime, and do not author it either. **Bake the physics
once, off-line, into a lookup table the engine samples.** The motion at a ruck is a body
accelerating over a known distance into a known mass; that body is the same
`render/ragdollKernel.ts` solver the falls already use, so its friction, its gait and its
transferred impulse are physics the game already believes. Sampling is a table read, which
makes the behaviour budget-free instead of budget-adjacent.

Nothing about the *law* moved into the plan. `breakdownPlan.ts` owns positions, force and
timing; the contest's outcome rules stay in `engine/breakdown.ts`, and the plan is only ever
an *input* to them. If the table is deleted, the fallback keeps the law and loses the
choreography — that is the design, and the probe asserts it.

### What is in the table

`game/data/ruckTimings.json` — 252 curves: 7 roles (CARRY, TACKLE, CLEAR, BIND, JACKAL,
COUNTER, NINE) × 12 distance buckets × 3 support tiers. Each curve is

```
{ dur, prof[16], strike, impulse, retreat, settle }
```

produced by `scripts/breakdownbake.ts`, which integrates the body at 120 Hz with a bang-bang
accelerate-then-brake controller over that distance, reads off the arrival time, takes the
strike at the point he reaches the man (70% of a clearout's lane — a clearout lands *while
he is still running*, which is the difference between a hit and a collision at the end of a
journey), derives the transferred Δv from `E_BODY = 0.34` on an 84-104 kg body, and computes
the ground he gives as `Δv² / 2μg` with μ = 0.55 — the ragdoll's own friction, so the man on
the turf and the man in the plan slide the same way on the same afternoon. The bake validates
monotonicity, boundedness and the per-frame step cap and **refuses to write** a table that
fails, because a corrupt curve is worse than no curve: it looks fine on frame 1.

Runtime cost, measured by the probe: 0.11 ms mean / 0.54 ms worst to build one ruck (once per
tackle), and **1.8 µs per frame** for the plan's entire per-frame maths at five lanes —
stumble, peel, sampling and both presence counts together, 0.01% of a 60 fps frame, gated at
50 µs. Nothing is searched, solved or steered during an episode any more; that is what
"presimulated so its optimised" was asking for and it is the number that decides it.

The whole-frame comparison is reported by the probe and deliberately *not* gated, because it
does not mean what it looks like it means: a planned breakdown frame measures 445 µs of
director time against the planless fallback's 323 µs, over 1,308 planned episode frames
against 2,794 planless ones. Those are not the same frames. A ruck where support arrives,
puts a shoulder in and gets a man on the ground is a busier frame than one where nobody
comes, and it resolves into a different match. A gate on that pair would be a gate on the
feature working.

### What the plan encodes

- **Arrival order is distance.** Support used to appear *at* the ruck the frame the tackle
  happened; now the mean spread between the first and last body in is 0.85 s and the probe
  counts 78 ordered pairs with zero inversions.
- **A clearout has a target.** The first attacker in takes the *nearest* defender — the man
  over the ball, which is the actual rule of a clearout — and each man after him takes the
  next. Indexed by clearer ordinal, not slot index: counting the carrier and the tackler as
  slots handed the first clearer the second defender and left the jackal unbothered.
- **A hard one removes a body.** Above 2.4 m/s shoved into a braced man, which is the bake's
  own down-threshold, he is given the engine's get-up lock. That is why the ball is easier
  after a good clearout: not a force number, a man out of the way.
- **The jackal is a numbers call, counted in bodies that can act.** The user's rule — more
  men at the breakdown wins it, a lone jackal can only slow the ball — was previously
  implemented as a headcount of *assigned* crew, which is why it never fired: the CPU always
  assigns roughly the same three. It is now presence: `frac ≥ 0.9` (he is there) and
  `shove ≥ 0.55` (he is not being cleared off it), with CARRY, NINE and TACKLE excluded
  because a man on the ground under the ball, a man 1.4 m away waiting to receive, and a
  tackler on his back with his hands off it are not numbers at a ruck. That last exclusion is
  the difference between a 14% steal rate and a 40% one.
- **The ball comes out along a path.** It is heel'd back to the nine on a sampled arc whose
  endpoint is *the mark RECYCLE restarts from*, not where the nine happened to be standing
  the frame the ruck was won — the first version aimed at the man and left the ball 0.8 m
  short of itself, a teleport in the last frame of the change that exists to remove them.
- **A lane's time is priced on the path, not the chord**, and both its deviations are scaled
  by the lane's length. A 1.7 m chord with an unconditional bow around the gate became a
  2.9 m walk in 0.32 s: 0.28 m a frame, a five-frames-a-second stutter on precisely the man
  the camera is closest to.
- **The winning side peels off as the ball leaves.** The losers do not get that choice — the
  offside line owns their depth, and arming them too put three or four men a metre behind the
  ball at the restart and the clamp spent 383 frames dragging them back to it.

### Presentation's half

Presentation reads the plan and writes nothing to it. A shove the engine applied to a
*standing* man is measured as the gap between his raw and his smoothed velocity — that gap is
the sudden change, and a man accelerating into a run does not have one — and `applyBalance`
pitches him into it, the recovery step a body actually takes. It writes `rotation.z` and the
residual of `rotation.x`, which is one writer per axis per frame, the same contract the
engine keeps for positions. Above the down-threshold the man gets a solved fall seeded from
the hit's own impulse rather than a re-estimate, because by the frame presentation sees, the
engine has already moved him. The live solver is capped at six bodies per frame, and the
seventh and eighth replay the baked library — beyond six, the eye is not on that man. The
pose chain changed too: a man still running in is `run`, not a bind pose sprinting at you,
and a man the plan cleared wears `grounded` for his lock instead of returning to a bind over
the ruck he was just knocked off.

### The puddles

There was no blood system. What there was: `MUD` clods at life 0.6-1.25 s, size to 0.30 m,
default restitution 0.22, up to 34 of them thrown per fall at 24 m/s; and an `addScar` stamp
for *every* landing of every body, dark brown at alpha up to 0.40 with a wet gleam on top,
multiplying to near-black where six of them overlapped inside half a metre. Turf that comes
up at a breakdown is thrown once and gone: half as many clods at 0.24-0.55 s, smaller,
biased upward, `bounce: 0` on soil (a per-kind restitution the call site can no longer
override into a bounce), and `addScar` now refuses any mark within 0.85 m of a recent one, so
one ruck is one churned patch. The patch then *stays churned*: two or three flecks every
tenth of a second while the ruck is live, which is the cheapest ten lines in this pass and
the detail that separates a contested pile from eight men standing over a ball.

### Verification

`scripts/breakdownprobe.ts`, ten behavioural measurements over 120 s of CPU-vs-CPU at
difficulty 3, in three variants — the plan, the plan stripped (the fallback), and support
deliberately stranded:

```
worst per-frame step: plan 0.230 m (gate 0.25, sprint 0.16), any writer 0.450 m (gate 0.80)
78 arrival pairs, mean spread 0.85 s, no inversions
19 clearouts, mean ground given 0.53 m, worst 0.76 m
heel: mean path 1.58 m over 15.2 frames, worst frame 0.123 m
plan's per-frame maths, isolated: 1.8 µs for 5 lanes (gate 50 µs)
1 jackal steal across 7 rucks (14.3%), window open 14/14, worst axis −1.00
stranded support: the jackal takes 1 of 6 (the contest listens)
planless fallback: 29 rucks, worst step 0.333 m, longest ruck 3.00 s, no stall
build 0.100 ms per tackle, sample 0.0009 ms/frame, same seed bit-identical
```

Two of the harness's own bugs are worth keeping on the record, because both were "the feature
is broken" and neither was. A `CARRY` slot with a 0.45 m frame was the *tackle's* physics
(slid by `kineticImpact`, then settled onto the contact mark), attributed to the plan by a
filter on `movedBy === 'bound'` — a tag survives the frame that earned it, so the gate now
excludes the carrier and *reports* his hardest step instead of gating it. And the planless
variant initially "measured" 0.000 m because its loop walked the plan's slots, of which it had
deleted every one: a harness that iterates the feature cannot see the absence of the feature.
The fallback is measured over the episode's own player list, which is how 0.333 m became
visible at all.

Bundle: 1,987.05 kB → 2,032.97 kB built, 616.10 → 627.47 kB gzipped. The 46 kB is the table,
inlined by the single-file build; it is 35.8 kB of quantised floats and it is what buys the
behaviour being free per frame.

### Known and not fixed here

The audit's per-seed 90 s sample has become useless as a bar: six seeds at 180 s against
`0c9e80d` on identical rules gives FAIL 22 here against 34 there, with the numbers rule's own
families improved (UX-23 18→9, LOG-51 5→1, LAW-17/41/57 6→3, LOG-19 18→10) and two up:
LAW-66 4→9, which is a hole in the line where a cleanout has just taken a man out of it —
that is the feature working — and LOG-20 10→15, the whole-side bunching rule counting a ruck.
Widening the ruck was tried twice (±1.55 m lateral, then 0.5 m per man of depth) and both
measurements are recorded in `breakdownPlan.ts`: the depth took support out of the contest
radius and the steal rate went to zero; the width moved arrivals and made the shape worse
everywhere else. A ruck is narrow. `scripts/auditcompare.sh` is the way to read the audit from
now on. One audit rule was wrong and is fixed: LAW-78 asserted 3-3-2 scrum rows as Law 19
while `engine/setpieces.ts` has authored 3-4-1 since T-11 and calls the older shape "not a
scrum"; it now tests what the Law requires, so a pack cannot be illegal by definition.
Still standing, from the baseline, untouched: at a long restart kick the camera plan lets its
focus leave the frame for a few frames (UX-23), the kicking side is caught ahead of the ball
(LAW-17/LAW-57) and the return is thin (LOG-51/52/56, UX-58) — because a kick taken seconds
after a breakdown is struck from a pitch still arranged around the breakdown, not around a
restart. That whole family is a shape problem at the kick, not a ruck problem: over the six
seeds it counts 11 here against 19 on `0c9e80d`, redistributed across the rule ids, and the
rule id a frame happens to fall under is not where the fault lives. `audit-cli 90 3 4` shows
12 against the baseline's 1 for the same reason — nine of them are UX-58 on one kick return
that lands in this window and not in the other.

**Tried, measured, and removed.** The men still running into a ruck the attack has already
won seemed like the same problem: release them to the general AI and the nine is left with
nobody near him, which is `UX-64` and `LOG-19` verbatim. So they were re-tasked — the lane
re-anchored from where each man actually stood (not from where he was going, which is a
teleport wearing a refactor), priced at `MAX_LANE_SPEED`, presence and the clip chain falling
out correctly for free. Before believing it, it was instrumented with a counter and an
assertion that the rule was not inert, and the assertion failed immediately and every time
after: **0 re-routes in 14 rucks**. There is no such man. The committed crew is chosen from
the nearest bodies, so his 2-4 m lane is finished before a contest that resolves in 0.35-1.35
s is over, and the men genuinely still arriving were never in the plan — they are the
uncommitted forwards, and the shape AI has been carrying them home since before this feature
existed. The code is gone and the measurement stays, because a rule that never runs is worse
than no rule: it reads like one.

### Addendum — the boot, and what 66% used to mean

The bar stopped at 66% and the pitch stayed empty. The fraction was never the bug:
66% is `await players.load()`, the player rig, and a 6,289,732-byte GLB parses in
about 3.3 s on this machine, which is slow but finite. What was wrong is that
`load()` was a `new Promise` whose executor called `GLTFLoader.load` with an `async`
success callback — a throw anywhere after that callback's first `await` was dropped
on the floor, so the promise settled never, `MatchView`'s `try { await … } catch`
could not fire, and the app had no way to tell "still parsing" from "the rig blew
up and we lost the catch". The stand-in was already built, correctly sized and
correctly kitted, and it never got the chance to be seen.

Three things had to be true, and now are:

- **Every stage can only settle.** `load()` is a real `async` function:
  `Promise.all([rigBytes, pairBytes.catch(() => null)])`, then
  `loader.parseAsync(buf, '')`, then the template prep, in one `try` whose `catch`
  sets `renderHealth.bodies = 'standin'`, logs the fault with the stage name, and
  rethrows. A missing animation file degrades to `standin` because its own fetch is
  the half of that `Promise.all` that is allowed to fail; a missing rig is an art
  loss and says so.
- **Nothing is paid for twice.** `StrictMode` mounts the boot effect twice in dev,
  and a boot that fetches 6.3 MB per mount reads as a hang. The bytes now go through
  a module-level `cached(url)` that memoises the `fetch` → `arrayBuffer` promise and
  deletes the entry if it rejects, so a later boot retries. What must *not* be
  cached is the prepared scene: `prepareTemplate` mutates its template (mesh split,
  materials, `skeleton.pose()`), so two managers sharing one `gltf.scene` would
  split it twice.
- **A stalled boot is cut short and explains itself.** `MatchView` carries
  `RIG_BUDGET_MS = 6000` and `BOOT_BUDGET_MS = 15000`, a `bootStage` ref naming the
  stage in flight, and a watchdog that clears the overlay whether or not the stage
  finished, then shows a dismissible `BOOT CUT SHORT — <stage> never finished`
  banner. 6 s against a 3.3 s load is not a race for the same timer: a slow rig is
  not an error and gets no banner, and a dead one is never silent for longer than
  the budget. The watchdog is cleared on unmount.

Both GLBs are served with `Cache-Control: public, max-age=300` from
`vite.config.ts` (`server.headers`, dev only — the single-file build inlines
everything and never asks), which is what took the reload from "very slow" to one
parse per session.

`scripts/bootcheck.ts` (7 checks, ALL PASS) is the part that keeps this honest. It
drives the real `load()` against an injected transport, times each stage, and then
runs a **hanging-asset fixture**: `parseAsync` never settles, `load()` never
resolves, and the assertion is on the visible outcome — the overlay gone inside the
budget, the stand-in visible, the banner naming the stage. `scripts/_nodeCanvas.ts`
is the shared 2D-context stub that let that harness and `sceneaudit` run in the same
tree.
