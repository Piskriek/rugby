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
