# rugby — World Class Rugby (AAA Edition)

A law-abiding rugby union simulation with a modern broadcast presentation.
Built from the design documents in this repository (see `HANDOFF.md`,
`SEASON_*.md`, `SPEC_*.md`).

## Run it

```bash
npm install
npm run dev      # Vite dev server (automatic preview)
npm run build    # production single-file bundle
```

## What is here

- **Match engine** — `src/game/director.ts`: full Laws of the Game, set pieces
  (scrum, lineout, maul, breakdown), kicks, offside, cards, TMO, advantage,
  penalties, substitutions, weather and pitch conditions.
- **AAA broadcast layer** — `src/ui/broadcast.tsx`: match-day kick-off card,
  television score bug, live possession/momentum strip, player spotlight
  lower-thirds, controller badge, and optional spoken commentary. Toggle with
  **OPTIONS → PRESENTATION / SPOKEN COMMENTARY**.
- **Gamepad support** — `src/game/gamepad.ts`: two-stick sports-pad layout
  (movement, sprint, pass, kick, tackle, fend, contact, camera, pause/stats).
- **Rendering** — Three.js stadium (dual-plane pitch, fog, uprights, LED
  boards, instanced crowd, floodlights) plus the legacy 2D canvas HUD and
  minimap.
- **Modes** — Friendly, World Cup, Five Nations, League, Classic Matches,
  Tutorial, Skills Clinic and Replay Theatre.

See `AAA_EDITION.md` for the release notes on this branch.
