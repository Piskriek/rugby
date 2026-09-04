# Batch 06 — kick-reception diagnosis

**Status:** diagnosis only. No source implementation, threshold, or audit rule was changed.

## Executive result

LOG-51 and UX-58 do **not** share one receiver-movement root cause.

They share the same kick-flight telemetry surface, but fail for different reasons:

- **LOG-51:** 26 failing samples across seeds 1, 2, 4, and 5. In 24/26 samples the engine's assigned receiver was moving correctly, but the trace inspected a different player selected by an independent `d.live.find(...)` search. In the remaining 2/26 samples the assigned receiver itself was momentarily moving away from the target; those are genuine behaviour evidence and must not be hidden by fixing the telemetry mismatch.
- **UX-58:** 18 failing samples, all `GOAL` kicks in seeds 4 and 5. The receiving-side assignment ran and moved a player towards the predicted point, but UX-58 treats the non-contestable goal trajectory as a contestable kick because its exemption only names `PUNT` and `FIFTY_22`. The measured receiving-side count was 0 or 1, as expected for a ball projected beyond the dead-ball line.

The seed-5 subset matches the Batch 5 audit: **14 LOG-51 failures and 10 UX-58 failures**.

## Reproduction and method

Each seed used the required deterministic order:

```text
seedRng(seed)
runDeep(gateConfig(3), 620)
runTrace(gateConfig(3), 620, 4, 5000)
```

The diagnostic replay then reset the same seed, ran `runDeep` again, and drove a bot-controlled `Director` loop with the same `botInput` and held-key ordering. It captured the live state at the exact failing trace timestamps. This was not an empty-input Director loop.

The full corpus contained:

| Seed | LOG-51 | UX-58 | Total |
|---:|---:|---:|---:|
| 1 | 5 | 0 | 5 |
| 2 | 6 | 0 | 6 |
| 3 | 0 | 0 | 0 |
| 4 | 1 | 8 | 9 |
| 5 | 14 | 10 | 24 |
| **Total** | **26** | **18** | **44** |

The squad numbers below are forensic identifiers from the captured state, not role logic. No source role decision was keyed from them in this batch.

## `assignReceiver` call and target

`Director.upKick` calls `assignReceiver` on every flight update after constructing:

```text
lp = landingPrediction() when bounces === 0
 target = lp, otherwise the current ball position
 rec = assignReceiver(receivingSide, target.x, target.z)
```

The failure captures show a non-null assigned player in **all 44 samples**, with the assignment job `FIELD THE BALL — CALL FOR IT LOUD`, `assignment: OPEN_PLAY`, and `tx/tz` set to the captured target. Therefore these failures are not an unassigned or late-call path.

The separate `kickLanded` path also calls `assignReceiver` once when the flight resolves. No source change was made to either call.

## LOG-51 evidence

The trace's LOG-51 receiver is not the object returned by `assignReceiver`. `emit()` independently searches the live array for the first available candidate in a numeric allow-list and within 22 metres of the predicted landing. The live-array order puts a supporting back before the assigned fielder in these samples.

That independent telemetry candidate was:

- #11 in 24 samples;
- #13 in 2 samples;
- never the assigned player in the 26 LOG-51 failures.

The assigned receiver's actual target-closing cosine was non-negative in 24/26 samples. Only these two samples show the assigned player itself moving away at the capture tick:

| Seed | Time | Kick | Assigned closing | Assigned distance |
|---:|---:|---|---:|---:|
| 2 | 166.90 | RESTART | -0.93 | 8.09 m |
| 4 | 39.72 | GOAL | -0.32 | 0.02 m |

Those two remain genuine receiver-motion evidence. The other 24 LOG-51 failures are telemetry identity false positives: the selected support player was moving across or away from the landing point while the actual assigned fielder was closing or already on target.

## UX-58 evidence

All 18 UX-58 failures are `GOAL` kicks:

- seed 4: predicted landing `z ≈ -53.7 m`;
- seed 5: predicted landing `z ≈ +53.4 m`.

The assigned fielder was present and directed towards the target in all 18 samples. Its actual target-closing value was approximately `1.00` in every sample. The receiving-side `receiverTeamSet` metric nevertheless reported 0 or 1 because it counts players in an 18-metre longitudinal band around a goal trajectory outside the field. This is not evidence that the receiver failed to attack a contestable kick.

The rule's current exemption is:

```text
kickType === PUNT || kickType === FIFTY_22
```

It does not exempt `GOAL`, despite the claim being specifically about a **contestable** kick.

## Per-failure evidence

`assigned at` is the actual selected player's position at the sample. `assign dist` is distance from that player to the target passed to `assignReceiver`. `actual close` is recomputed from that selected player's velocity. `trace receiver` and `trace close` are the independent telemetry candidate and the value that caused LOG-51. `team-set` is the exact UX-58 longitudinal-band count.

| Seed | t | Rule | Kick | Landing (x,z) | Target (x,z) | Assigned at (x,z) | Assign dist | Actual close | Trace receiver | Trace close | Team-set |
|---:|---:|---|---|---|---|---|---:|---:|---:|---:|---:|
| 1 | 79.18 | LOG-51 | DROP_OUT | (-0.08, -2.54) | (-0.08, -2.54) | (-0.02, -2.58) | 0.07 m | 0.92 | 11 | -0.01 | 15 |
| 1 | 79.45 | LOG-51 | DROP_OUT | (-0.08, -2.52) | (-0.08, -2.52) | (-0.03, -2.58) | 0.08 m | 0.64 | 11 | -0.13 | 15 |
| 1 | 79.72 | LOG-51 | DROP_OUT | (-0.08, -2.50) | (-0.08, -2.50) | (-0.03, -2.58) | 0.09 m | 0.00 | 11 | -0.16 | 15 |
| 1 | 79.98 | LOG-51 | DROP_OUT | (-0.08, -2.48) | (-0.08, -2.48) | (-0.03, -2.58) | 0.11 m | 0.00 | 11 | -0.21 | 15 |
| 1 | 80.25 | LOG-51 | DROP_OUT | (-0.08, -2.46) | (-0.08, -2.46) | (-0.03, -2.58) | 0.13 m | 0.00 | 11 | -0.29 | 15 |
| 2 | 64.00 | LOG-51 | GOAL | (-3.10, 52.54) | (-3.10, 52.54) | (-3.93, 44.05) | 8.53 m | 1.00 | 13 | -0.08 | 15 |
| 2 | 166.90 | LOG-51 | RESTART | (0.85, -24.92) | (0.85, -24.92) | (6.99, -30.19) | 8.09 m | -0.93 | 11 | -0.46 | 15 |
| 2 | 167.17 | LOG-51 | RESTART | (0.85, -24.90) | (0.85, -24.90) | (6.37, -30.04) | 7.54 m | 1.00 | 11 | -0.36 | 15 |
| 2 | 167.43 | LOG-51 | RESTART | (0.85, -24.89) | (0.85, -24.89) | (4.68, -28.48) | 5.25 m | 1.00 | 11 | -0.45 | 15 |
| 2 | 167.70 | LOG-51 | RESTART | (0.85, -24.87) | (0.85, -24.87) | (2.96, -26.86) | 2.90 m | 1.00 | 11 | -0.44 | 15 |
| 2 | 167.97 | LOG-51 | RESTART | (0.85, -24.86) | (0.85, -24.86) | (1.50, -25.48) | 0.90 m | 1.00 | 11 | -0.19 | 15 |
| 4 | 39.72 | LOG-51 | GOAL | (5.88, 58.01) | (5.88, 58.01) | (5.91, 58.02) | 0.03 m | -0.32 | 13 | -0.42 | 15 |
| 4 | 169.02 | UX-58 | GOAL | (1.52, -53.71) | (1.52, -53.71) | (-2.96, -30.32) | 23.82 m | 1.00 | — | — | 0 |
| 4 | 169.28 | UX-58 | GOAL | (1.52, -53.69) | (1.52, -53.69) | (-2.58, -32.29) | 21.79 m | 1.00 | 15 | 1.00 | 0 |
| 4 | 169.55 | UX-58 | GOAL | (1.51, -53.68) | (1.51, -53.68) | (-2.18, -34.36) | 19.67 m | 1.00 | 15 | 1.00 | 0 |
| 4 | 169.82 | UX-58 | GOAL | (1.51, -53.66) | (1.51, -53.66) | (-1.79, -36.43) | 17.54 m | 1.00 | 15 | 1.00 | 1 |
| 4 | 170.08 | UX-58 | GOAL | (1.50, -53.65) | (1.50, -53.65) | (-1.39, -38.49) | 15.43 m | 1.00 | 15 | 1.00 | 1 |
| 4 | 170.35 | UX-58 | GOAL | (1.50, -53.63) | (1.50, -53.63) | (-1.00, -40.54) | 13.33 m | 1.00 | 15 | 1.00 | 1 |
| 4 | 170.62 | UX-58 | GOAL | (1.49, -53.62) | (1.49, -53.62) | (-0.61, -42.59) | 11.23 m | 1.00 | 13 | 0.96 | 1 |
| 4 | 170.88 | UX-58 | GOAL | (1.49, -53.60) | (1.49, -53.60) | (-0.22, -44.63) | 9.13 m | 1.00 | 13 | 0.96 | 1 |
| 5 | 120.22 | UX-58 | GOAL | (1.69, 53.64) | (1.69, 53.64) | (-15.53, 23.43) | 34.77 m | 1.00 | — | — | 0 |
| 5 | 120.48 | UX-58 | GOAL | (1.68, 53.62) | (1.68, 53.62) | (-14.47, 25.30) | 32.60 m | 1.00 | — | — | 0 |
| 5 | 120.75 | UX-58 | GOAL | (1.67, 53.60) | (1.67, 53.60) | (-13.26, 27.42) | 30.14 m | 1.00 | — | — | 0 |
| 5 | 121.02 | UX-58 | GOAL | (1.65, 53.57) | (1.65, 53.57) | (-12.05, 29.55) | 27.65 m | 1.00 | — | — | 0 |
| 5 | 121.28 | UX-58 | GOAL | (1.64, 53.55) | (1.64, 53.55) | (-10.84, 31.66) | 25.20 m | 1.00 | — | — | 0 |
| 5 | 121.55 | UX-58 | GOAL | (1.63, 53.53) | (1.63, 53.53) | (-9.64, 33.77) | 22.75 m | 1.00 | — | — | 0 |
| 5 | 121.82 | UX-58 | GOAL | (1.61, 53.50) | (1.61, 53.50) | (-8.44, 35.88) | 20.28 m | 1.00 | 15 | 1.00 | 1 |
| 5 | 122.08 | UX-58 | GOAL | (1.60, 53.48) | (1.60, 53.48) | (-7.24, 37.98) | 17.84 m | 1.00 | 15 | 1.00 | 1 |
| 5 | 122.35 | UX-58 | GOAL | (1.59, 53.46) | (1.59, 53.46) | (-6.05, 40.07) | 15.42 m | 1.00 | 15 | 1.00 | 1 |
| 5 | 122.62 | UX-58 | GOAL | (1.57, 53.44) | (1.57, 53.44) | (-4.85, 42.16) | 12.98 m | 1.00 | 15 | 1.00 | 1 |
| 5 | 128.48 | LOG-51 | RESTART | (1.14, -33.79) | (1.14, -33.79) | (6.56, -29.01) | 7.23 m | 1.00 | 11 | -0.09 | 15 |
| 5 | 128.75 | LOG-51 | RESTART | (1.14, -33.77) | (1.14, -33.77) | (4.90, -30.47) | 5.00 m | 1.00 | 11 | -0.20 | 15 |
| 5 | 129.02 | LOG-51 | RESTART | (1.14, -33.75) | (1.14, -33.75) | (3.24, -31.92) | 2.79 m | 1.00 | 11 | -0.29 | 15 |
| 5 | 129.28 | LOG-51 | RESTART | (1.14, -33.73) | (1.14, -33.73) | (1.84, -33.14) | 0.92 m | 1.00 | 11 | -0.33 | 15 |
| 5 | 129.55 | LOG-51 | RESTART | (1.13, -33.71) | (1.13, -33.71) | (1.27, -33.61) | 0.17 m | 1.00 | 11 | -0.35 | 15 |
| 5 | 158.88 | LOG-51 | RESTART | (0.86, -24.85) | (0.86, -24.85) | (-13.02, -24.99) | 13.88 m | 1.00 | 11 | -0.09 | 15 |
| 5 | 159.15 | LOG-51 | RESTART | (0.86, -24.83) | (0.86, -24.83) | (-10.99, -24.97) | 11.85 m | 1.00 | 11 | -0.18 | 15 |
| 5 | 159.42 | LOG-51 | RESTART | (0.86, -24.82) | (0.86, -24.82) | (-8.95, -24.95) | 9.81 m | 1.00 | 11 | -0.33 | 15 |
| 5 | 159.68 | LOG-51 | RESTART | (0.86, -24.80) | (0.86, -24.80) | (-6.92, -24.92) | 7.78 m | 1.00 | 11 | -0.42 | 15 |
| 5 | 159.95 | LOG-51 | RESTART | (0.86, -24.79) | (0.86, -24.79) | (-4.89, -24.89) | 5.75 m | 1.00 | 11 | -0.41 | 15 |
| 5 | 160.22 | LOG-51 | RESTART | (0.86, -24.77) | (0.86, -24.77) | (-2.85, -24.85) | 3.71 m | 1.00 | 11 | -0.52 | 15 |
| 5 | 160.48 | LOG-51 | RESTART | (-0.54, -31.06) | (0.71, -25.45) | (-0.87, -24.89) | 1.68 m | 0.98 | 11 | -0.59 | 15 |
| 5 | 180.48 | LOG-51 | GOAL | (-3.39, -53.69) | (-3.39, -53.69) | (5.60, -49.04) | 10.12 m | 1.00 | 11 | -0.05 | 15 |
| 5 | 180.75 | LOG-51 | GOAL | (-3.38, -53.69) | (-3.38, -53.69) | (3.79, -49.97) | 8.08 m | 1.00 | 11 | -0.52 | 15 |

## Root-cause verdict

**Disproved: one shared receiver root cause.**

1. LOG-51 is primarily an observability/identity bug. The assignment path is running, but the trace's receiver search is not the assignment result. Correcting the trace to report the exact assigned `Live` object would remove 24 false positives and expose the two genuine movement samples without changing the rule.
2. UX-58 is a rule-scope/metric problem. The 18 failures are goal trajectories, not contestable kicks. The receiver assignment is active and correctly aimed at the predicted point; the receiving-side proximity metric is being applied to a non-contestable situation.

## Proposed fix — not implemented

1. Persist the exact receiver object and target used by the flight assignment, then have BALL_FLIGHT telemetry read that same object. Do not perform a second role search in `emit()`, and do not use shirt number to infer a receiver role. Any future selector revision must derive the candidate positionally from live geometry and availability.
2. Expose a live `contestable`/kick-profile fact for the audit, or scope UX-58 to contestable kick types. `GOAL` must not be graded as a kick that requires two receiving players near its landing point.
3. After those two changes are reviewed, re-measure the two genuine LOG-51 samples independently. They are not cleared by the telemetry fix.

No fix was implemented in Batch 06. Per the brief, work halts here for review.
