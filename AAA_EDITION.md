# AAA Edition — release notes

This branch takes the documented World Class Rugby simulation and gives it a
modern television-ready presentation without touching the laws underneath.

## What was added

### 1. AAA broadcast presentation (`src/ui/broadcast.tsx`)

Opt-in via **OPTIONS → PRESENTATION → AAA BROADCAST** (default). HERITAGE keeps
the original 1991 HUD.

- **MATCH DAY card** — a full-screen kick-off card with the two countries, their
  venues, weather, pitch, kick-off time, difficulty and nominated kicker. Any
  key, button or the pad's START/A skips it; the engine clock is held behind the
  card so the match genuinely starts when the card lifts.
- **Television score bug** — team-colour chips, broadcast tags, big clock,
  phase readout, live possession bar, momentum readout and score-share split.
- **Player spotlight** — after a try, penalty, conversion or drop goal a
  lower-third appears with the scorer's shirt, name, position, team and points.
  It is driven off the engine's score events, not a timer guess.
- **Controller badge** — a short "CONTROLLER CONNECTED" toast when a pad pairs.
- **Spoken commentary** — OPTIONS → DISPLAY → SPOKEN COMMENTARY reads every new
  commentary feed line aloud through the browser speech engine, layered over the
  synthesised crowd bed and referee whistle.

### 2. Gamepad support (`src/game/gamepad.ts`)

A single two-stick sports-pad layout merged into the same verb stream as the
keyboard (held input + rising/falling edges), so set-piece waggles, the
kick-meter and the pause/stats hotkeys all work from the pad. The title screen
also starts on ENTER, SPACE or the controller's START / A.

| Pad | Action |
|---|---|
| Left stick / DPAD | move, run, waggles |
| Right stick | cut |
| A / Cross | action · sprint (hold) |
| B / Circle | tackle dive |
| X / Square | pass left |
| Y / Triangle | pass right |
| LB / L1 | fend |
| RB / R1 | kick |
| LT / L2 | take contact |
| RT / R2 | sprint burst (hold) |
| L3 | step |
| R3 | switch player |
| Back / Select | stats |
| Start | pause |

### 3. Score-integrity fixes (`src/game/director.ts`)

Two small engine corrections surfaced while wiring the presentation:

- **Kick scores now produce a real `lastScorer`.** Before this, a penalty or
  drop goal after an earlier try could keep the old try scorer in the spotlight
  and the kicker in the dark. Every scored kick now sets the scorer the way a
  try does.
- **A missed conversion clears `conversionPending`.** A missed conversion used
  to leave the "conversion pending" flag live, so a subsequent penalty goal
  could be credited (and displayed) as a +2 conversion. It now clears on the
  miss exactly as it does on a made kick.

## Verification

- `npx tsc --noEmit` — clean
- `npm run build` — clean (single-file bundle ~1.75 MB)
- `npx vite-node scripts/spec07-contracts.ts` — **SPEC_07 contracts: ALL GREEN**
- `npx vite-node scripts/chain.ts 3` — engine regression run unaffected

## Reconciliation with SPEC_24 (the match-day pass)

This file and `SPEC_24_MATCHDAY.md` were written in two sittings against the same
base commit, and both reached for the sky. Merging them was not additive: two sky
domes, two light rigs and two post chains in one scene do not blend, they argue.
The rule applied was **one owner per area**, chosen on the merits of each:

| Area | Owner | Why |
|---|---|---|
| Turf surface | **this edition** — `render/turf.ts` | Procedural albedo + roughness + normal with the markings baked in, mown stripes and pre-existing wear. It beats a painted canvas outright, and the wear it bakes is the same wear SPEC_24 wanted to add live. |
| Player surfaces | **this edition** — per-slot `MeshStandardMaterial` | Jersey, shorts, socks, skin and boots get different roughness. SPEC_24's soiling pass was rewritten onto that model: mud now raises roughness as well as darkening, which the toon materials could not express. |
| Stadium lighting rig | **SPEC_24** — `render/ThreeMatchDay.ts` | One `SkyPreset`-shaped object resolved per frame in `render/conditions.ts` from the seven weathers × five pitch states × four kick-off times the engine already simulates, driving sky, key, fog, shadow tier and flood level together. A four-preset table that ignores the weather would have made the simulation's own KICK-OFF slider decorative again. |
| Post chain | **SPEC_24** — bloom + filmic grade + vignette + grain + chromatic aberration + lens droplets | Conditions-driven, and it owns tone mapping because `EffectComposer` bypasses the renderer's. Their `ThreePost.ts` (bloom/FXAA/SSAO by a `graphics` slider) is deleted. |
| HUD | **both**, split by function | Their `ScoreBug`, `PlayerSpotlight`, `MatchIntro`, `GamepadBadge`; SPEC_24's `ConditionsStrip`, `FormStrip`, `TmoCard`, `CardCard`, `ReplayFrame`. No duplicate lower-thirds: their bug owns score/clock/possession, my strip owns the ground and the air, and neither draws the other's data. |
| Input | **this edition** — `game/gamepad.ts` | Two sticks folded into the same verb stream the keyboard writes. Untouched by SPEC_24. |
| Score integrity | **this edition** — `game/director.ts` | Two fixes so the numbers on screen cannot disagree with the ledger. Presentation never writes engine state, so these are the only engine edits in either pass. |

Two display options died in the merge, both because they duplicated something the
simulation already owned: `graphics` (PERFORMANCE/BALANCED/ULTRA → the existing
`render` pipeline switch) and `timeOfDay` (four authored skies → the engine's own
`timeofday` KICK-OFF setting, which `conditions.ts` now reads). Anyone wanting a
second lighting switch should first explain what the match's own kick-off time is for.

Verification after the merge (and after `6bcbd54`, the NO TELEPORTS engine fix, merged
on top of it): `tsc --noEmit` clean, `scripts/glslcheck.ts` 10 shaders / 0 failing,
`scripts/matchdayheadless.ts` all green, `scripts/spec07-contracts.ts` ALL GREEN,
`scripts/teleprobe.ts` 0 teleports across difficulty 0/3/6, and
`scripts/audit-cli.ts 90 3 1` byte-identical to the tip of the other pass —
PASS 5407, WARN 2, FAIL 2, 0 teleports, 0 watchdog trips. That is the honest trade
the teleport fix makes against the earlier baseline (PASS 5343, WARN 4, FAIL 1, 5
teleports): three teleports and two `LOG-20` bunching warnings are gone, and
`LAW-66` picks up one more defensive-line hole, because a defender placed by a ruck
now keeps that placement for a frame instead of being yanked back to his support
mark by `think()`. It is a simulation decision, not a presentation one — nothing in
either pass writes engine state from the render layer. The one thing neither pass can
verify is the picture; that still needs a human eye on `npm run dev`.

**Second addendum (playtest), both sides of "it looks bad in game".** The tackle
now has a real floor: `render/ragdoll.ts`, a 20-particle position-based solver in
which the particles *are* the rig's bones, handed the body from the grounding
stage of a tackle and nothing else — the drive and the wrap stay authored, the
engine keeps translation, and the tackler's hands are pinned to the carrier's
waist inside the solver so the wrap survives the fall. 0.083 ms per frame for
eight of them at once, and `scripts/ragdollcheck.ts` proves the twelve things a
ragdoll fails at, headless. The grey was measured rather than guessed: the
hierarchy of fills was feeding the rig more irradiance than the key, there was no
`scene.environment` for a PBR material to reflect, `#FFFFFF` kit albedo clipped
through the tone curve, and the concrete concourse out-shone the pitch. Sky
PMREM'd into an environment map, per-weather `iblMul`, kit albedo scaled to
fabric, `CONCRETE` darkened, and a rule that a floodlight is not the sun behind a
cloud. Written up with numbers in `SPEC_24_MATCHDAY.md`'s addendum; the art
contract in `render/retro.ts`, `coronal.ts` and `rig.ts` was not touched, and no
engine file was.

