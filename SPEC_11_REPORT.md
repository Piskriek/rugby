# SPEC_11 — Formation Anchoring: measurement report

Commit `ba20963` on `arena/01a0682b-rugby`. All numbers are headless, seeded and reproducible.

```
npx vite-node scripts/spec11probe.ts  [seconds] [difficulty] [seed]   # formation geometry
npx vite-node scripts/spec11attack.ts [seconds] [difficulty] [seed...] # attack outcomes
npx vite-node scripts/gates.ts 100                                    # the nine regression gates
npx vite-node scripts/stats.ts 3 3                                    # the realism board
npx vite-node scripts/audit-cli.ts 90 3 1                             # the LAW rules
```

## The defect

A mark was a **place on the pitch**. The behaviour dataset draws a formation around a ball
that was in one fixed spot when the author drew it; the engine steered men at the absolute
patch of grass. So a midfield mark applied to a ball on the 22 put the whole backline thirty
metres behind the carrier, and a fullback's mark — authored 22 m behind a ruck drawn on the
halfway line — sent him running *through* his own attacking line when the ruck was on his 22.

A mark is now an **offset from the ball**: `target.z = F.z + σ·along`, `target.x = F.x + σ·across`.

## Headline before → after

120 s, difficulty 3, seeds 1 / 7 / 13 (`scripts/spec11probe.ts`, open-play frames only, bound,
grounded and carrying men excluded — those marks belong to `placeBound` and the carrier).

| | before | after |
|---|---|---|
| defenders marked behind the ball | 14.0 / 26.0 / 8.0 % | **0.00 / 0.00 / 0.00 %** |
| worst signed defensive depth | −38.7 m | **−0.4 m** |
| marks further than 25 m from the ball | 19.3 / 15.7 / 17.2 % | **0.02 / 0.00 / 0.14 %** |
| worst mark-to-ball distance | 52.7 m | **33.7 m** (a winger on the far touchline) |
| mark-to-ball P50 | 8.3 m | **2.4 – 4.3 m** |
| mark-to-ball P90 | 33.6 m | **10.5 – 15.0 m** |

The 33.7 m mark that survives is shirt 11, `RE-SET AS THE LAST DEFENDER ON THE LEFT EDGE`,
standing on the touchline with the ball on the right. That is the job.

## Exit gates

| gate | status | evidence |
|---|---|---|
| 9/9 `gates.ts` | **PASS** | teleports 0, bounces 0, tackles 22, chase 119, camera 0, encroach 0, freezes 0, possession 3, ball-on-screen 0 |
| drift P90 ≤ 2.5 m | **2.0 – 2.9 m** | over on one of six team-seeds; see below |
| every open-play defender ≥ −1.5 m | **PASS** | 0 of ~110 000 samples; worst −0.4 m |
| LAW-66 line holes ≤ 4.5 m | **NOT MET** | improved, still failing; see below |
| attack outcomes measured before/after | **DONE** | table below |

### Attack outcomes — six seeds, 400 s, difficulty 3

| | entries | converted | conversion | metres | **metres / entry** |
|---|---|---|---|---|---|
| before | 55 | 15 | 27.3 % | 3 282 | 59.7 |
| after | 49 | 11 | 22.4 % | 3 061 | **62.5** |

Metres per entry is flat (slightly up). Entries and conversions are down ~11–18 %, which on
49–55 events is a couple of possessions' worth of noise. Three-match realism board: score
unchanged at 47 %, but **penalties 29.7 (HIGH) → 19.7 (OK)**, **offside penalties 5.8 (HIGH) →
1.0**, rucks 76 → 112, passes 148 → 156, metres per team 373 → 369 (inside the 250–800 band;
team B was 933 before, over the ceiling).

### LAW-66 — improved, still failing

Steady-state line holes (real open play, no set-piece object alive, `op.t > 1.2`):

| seed | P90 before | P90 after | holes > 4.5 m before | after |
|---|---|---|---|---|
| 1 | 4.3 m | **1.6 m** | 9.0 % | 3.7 % |
| 7 | 4.5 m | **2.5 m** | 10.0 % | 7.1 % |
| 13 | 4.6 m | **2.6 m** | 10.1 % | 6.4 % |

The P90 now passes. The tail does not: P99 7–12 m, max 11–15 m. Rule-audit failures fell from
6 / 16 / 59 per seed to 6 / 0 / 3. The surviving tail is transition frames — a side walking to
a lineout, or the frame after a turnover — plus convergers who have legitimately left the line.
It failed before SPEC_11 too (worst hole 6.6 / 5.9 / 5.2 m). **Per the queue this routes to a
SPEC_10 re-verdict, which is your call, not mine.**

## Four things that need a decision

1. **The drift ceiling.** The recalibrated metric reads 2.0–2.9 m against the board's 2.5 m.
   That ceiling was calibrated against the old *velocity* test, which asked "is he moving
   fast?" when the question is "is he getting there?" — it forgave a man sprinting in the
   wrong direction and could not see a man converging perfectly on a mark in the wrong place.
   Under the honest test, five of six team-seeds pass and seed 7 / team B reads 2.9 — with an
   absolute **maximum of 3.9 m and zero samples beyond 5 m**. I did not tune the metric to hit
   the number. Accept, re-authorise at 3.0, or send me back in.

2. **The goal-line fullback.** Shirt 15 in `goal-line-def` is *authored* 5–7 m behind the ball
   — the last man is supposed to be deep. SPEC_11's "no defender behind the ball" clamp pulls
   him to 1 m, about eight times a match, and warns in dev. If goal-line defence keeps a deep
   fullback, the exemption is one line.

3. **`statsAudit.ts` moved.** I added a third gated dimension to the OFFSIDE & FORMATION
   INTEGRITY row — **P90 MARK-TO-BALL (0 .. 25 m)**, reading 16.5. Drift alone passed all
   season while the formation sat in the wrong half of the pitch; drift cannot see a mark in
   the wrong place, only a man failing to reach it. This is a change to the audit surface and
   wants your sign-off. Revert is one commit.

4. **Finding E is still open** (facing is velocity-only: `steer()` writes `p.face` straight
   from velocity, read only at `render/scene.ts:154`), and I found a dead term on the way:
   the T-18 drift-on-the-pass is `tx += (op.carrierX - f.x) * dw`, and `f.x` **is**
   `op.carrierX`, so it is identically zero — the line has never drifted on the pass at all.
   Both are logged, neither is fixed; each is its own measurement, not a footnote.

## What shipped

- **β per situation** (`SITUATION_META[sit].ball`), derived from the authored instructions of at
  least two shirts per situation rather than guessed, and `datasetOffset()` returning the shape
  relative to it. The absolute `datasetMark()` is kept for tooling and the media guide only.
- **D11-a** as decided: spread from the ball's lateral position, squeeze the whole shape by one
  factor when it would cross the touchline, never clamp the individual mark.
- **D11-b** as decided: depth *compresses* (a multiplier, floor 0.15) as the formation backs
  toward its own dead-ball line; nothing is ever marked past it or through the post corridor.
- **Three secondary logic bugs**: `s.open * flip` was identically +1 so the attacking shape never
  mirrored; `dir` was applied twice to the defensive line (`dir² = 1`), which put it a fixed +z
  offset from the ball and behind it whenever team B attacked; the T-51 cover-chase arming test
  was negated, so half the line chased a carrier who had not beaten them.
- **Two drift sources that were not anchoring at all**: the T-51 pod hold froze attacking marks
  in world space for a whole phase while the carrier ran across field (that is where the
  40 m marks came from), and `op.carrierX/Z` went stale for a frame when a pass landed, so the
  anchor, the camera and the HUD all pointed at the passer while the new carrier ran on.
- **The recalibrated drift metric**, plus its companion `formationMarkAnchorP90`, plus
  `formationSampleCounts` — a percentile over an empty channel reads 0.0 and flatters the run,
  so the n is on the board now.
