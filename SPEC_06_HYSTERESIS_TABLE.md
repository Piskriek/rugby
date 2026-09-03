# SPEC_06 — FACING/STRAFE v2: HYSTERESIS TABLE (DRAFT FOR REVIEW)

**Status:** DRAFT — design only. No threshold, clamp, or state-transition code has
been changed. This document is the written state-retention matrix requested by
SPEC_06 Phase 2, built from the data the debug overlay now surfaces.

**Constraint honoured:** all numbers below are read-only references to the live
code and proposals for a future hardening pass. Nothing here has been applied.

---

## 1. What the overlay proves

The overlay (`src/render/facingDebug.ts`) reads three live streams per actor
every frame — `view` (paper side), `gait` (resolved clip), `lat` (lateral
velocity relative to facing). Two independent state machines produce the
"jarring" transitions:

| # | Machine | File | Location | What can thrash |
|---|---------|------|----------|-----------------|
| 1 | GAIT (strafe route) | `scene.ts` → `clips.ts` | `puppetFor()` / `actionClip()` | `jog ↔ shuffle ↔ strafe` at the `lat`/`spd` gates |
| 2 | VIEW (paper side) | `paper.ts` | `updatePaperView()` | `leftEdge ↔ rightEdge` at the `cross` gate |

Machine 2 already has dead-zone hysteresis for `front/back/edge`; its one gap is
the **edge-side flip**, which uses a single-frame `|cross| > 0.25` check. Machine 1
has **no hysteresis at all** — every boundary is a bare threshold, so a signal
hovering on the line flips the clip every frame.

---

## 2. Current (live, unmodified) thresholds

### Machine 1 — GAIT (scene.ts / clips.ts)

```
lat  = vx*cos(face) − vz*sin(face)          // lateral velocity rel. to facing
if (spd < 3.6 && |lat| > 0.9) action = 'shuffle'
else action = spd<0.7 ? idle : spd<1.6 ? walk : spd<3.6 ? jog : spd<6.2 ? run : sprint
// in actionClip('shuffle'): if |lat| > 0.9 → strafe/strafeL, rate = |lat|/1.7
```

Boundaries (all single-value):

| Current state | Signal | Boundary | Next state |
|---------------|--------|----------|------------|
| idle | spd | 0.7 | walk |
| walk | spd | 1.6 | jog |
| jog | spd | 3.6 | run |
| run | spd | 6.2 | sprint |
| jog | \|lat\| | 0.9 (and spd<3.6) | shuffle |
| shuffle | \|lat\| | 0.9 | strafe / strafeL |

### Machine 2 — VIEW (paper.ts)

```
ang   = angle between actor facing and actor→camera (deg)
cross = fx*tz − fz*tx                         // signed side of the camera
cur   = viewStore[key]
front : ang > 55  → edge   (side = cross<0 ? rightEdge : leftEdge)
back  : ang < 125 → edge
edge  : ang < 35  → front ; ang > 145 → back ; |cross|>0.25 → other edge
```

| Current view | Signal | Boundary | Next view |
|--------------|--------|----------|-----------|
| front | ang | > 55 | edge (side by sign of cross) |
| back | ang | < 125 | edge |
| leftEdge | ang | < 35 / > 145 | front / back |
| rightEdge | ang | < 35 / > 145 | front / back |
| leftEdge ↔ rightEdge | cross | \|cross\| > 0.25 | the other edge |

---

## 3. Proposed state-retention matrix

Principle: **an actor stays where it is unless the signal crosses the OUTER bound
of its current zone's dead band.** Every boundary below has an entry margin
(further out) and a hold margin (closer in), so a signal on the line does not
flip the state. Proposed margins are marked **P** (proposed); the live values are
the reference.

### Machine 1 — GAIT: proposed hysteresis

| Current | Enter edge | Enter hold | Leave when | Dead band |
|---------|-----------|-----------|------------|-----------|
| walk | spd ≥ 0.7 | — | spd < 0.45 | 0.45–0.7 |
| jog | spd ≥ 1.6 | — | spd < 1.25 | 1.25–1.6 |
| run | spd ≥ 3.6 | — | spd < 3.25 | 3.25–3.6 |
| sprint | spd ≥ 6.2 | — | spd < 5.85 | 5.85–6.2 |
| jog (lateral) | \|lat\| > 1.05 (P) | spd < 3.3 (P) | \|lat\| < 0.75 (P) | 0.75–1.05 |
| shuffle (lateral) | \|lat\| > 1.05 (P) | spd < 3.3 (P) | \|lat\| < 0.75 (P) | 0.75–1.05 |
| strafe/strafeL (top of shuffle) | \|lat\| > 1.15 (P) | — | \|lat\| < 0.85 (P) | 0.85–1.15 |

> Because the same `|lat|` value gates both `shuffle` **and** `strafe`, the two
> must share a band (0.75–1.05) so an actor does not hop `jog → shuffle → jog`
> around a single frame of 0.9. The strafe sub-case adds its own slightly wider
> band to avoid `shuffle ↔ strafe` flapping when the strafe rate is low.

### Machine 2 — VIEW: proposed hardening

| Current | Enter edge | Enter hold | Leave when | Dead band |
|---------|-----------|-----------|------------|-----------|
| front | ang > 55 | — | ang < 50 (P) | 50–55 |
| back | ang < 125 | — | ang > 130 (P) | 125–130 |
| leftEdge | ang < 35 / > 145 | — | ang 50–130 (P) — keep | — |
| rightEdge | ang < 35 / > 145 | — | ang 50–130 (P) — keep | — |
| leftEdge ↔ rightEdge | \|cross\| > 0.45 (P) | persist ≥ 4 frames (P) | — | 0.25–0.45 |

> The existing `front/back/edge` dead zones (35–55, 125–145) stay as-is. The only
> new lever is the **edge-side flip**: raise `|cross|` from 0.25 to 0.45 **and**
> require the side sign to hold for several frames, so an actor side-on to the
> camera does not mirror-flip as the camera tracks across their right/left hand.

---

## 4. Timing retention (anti-flutter)

Hysteresis on amplitude is not always enough — a fast attacker crossing the
camera line legitimately changes side in one or two frames. To separate a real
crossing from a jitter, propose a **hold time** before committing a state change
(entry debounce), applied to both machines:

| State change | Proposed hold (P) |
|--------------|-------------------|
| gait clip switch | ≥ 0.08 s (≈5 frames) |
| view side flip (edge) | ≥ 0.08 s (≈5 frames) |
| view front/back ↔ edge | ≥ 0.12 s (≈7 frames) |
| lying ↔ standing | 0 (never debounce — driven by the sim) |

> The blend duration (`CLIPS[].loop ? 0.16 : 0.12`) already smooths the pose
> after a switch; the hold time prevents the switch itself from retriggering.

---

## 5. What is explicitly OUT OF SCOPE until sign-off

- No change to `END_ON / EDGE_IN / EDGE_OUT / BACK_IN` (35 / 55 / 125 / 145).
- No change to the `3.6 m/s` shuffle band, the `0.9` lat gate, the `6.2/5.6` cadence speeds.
- No change to the strafe rate formula (`|lat|/1.7`) or the clip blend durations.
- No change to the `|cross| > 0.25` edge check (that is the next hardening target,
  not applied here).

Every number in §3/§4 with a **(P)** is a proposal for the *next* pass, to be
reviewed against a before/after capture from the overlay before anything is
merged (SPEC_06 §4 sign-off).
