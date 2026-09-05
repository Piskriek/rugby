# Batch 03 — trace ceiling diagnosis and capture design

> **Status: measured design only.** Task A is implemented and Task C is resolved. The trace ceiling itself is intentionally **not** changed here: the capture policy is non-obvious and this document stops before implementing a ceiling/sampling design. No rules were deleted.

## 1. What was measured

Every probe used the audit-cli call order exactly:

```text
seedRng(seed)
runDeep(gateConfig(3), requestedSeconds)
runTrace(gateConfig(3), requestedSeconds)
```

The probe measured point count, simulated trace time, point kinds, serialized point bytes, and per-kind rates. The current `TRACE_LIMIT` remains `1000`; the trace loop tests `rec.points.length < TRACE_LIMIT - 12`, so it normally reaches a 988-point boundary and can overshoot it during one `emit()` batch.

### Cap behavior by seed

| seed | requested | points | first trace t | last trace t | simulated time | serialized points |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 90 s | 996 | 0.27 | 26.93 | 26.93 s | about 351 kB |
| 2 | 90 s | 994 | 0.27 | 26.13 | 26.13 s | about 348 kB |
| 3 | 90 s | 993 | 0.27 | 26.93 | 26.93 s | about 349 kB |
| 4 | 90 s | 992 | 0.27 | 24.00 | 24.00 s | about 334 kB |
| 5 | 90 s | 988 | 0.27 | 25.87 | 25.87 s | about 347 kB |

Seed 5 was also run with a requested duration of 300 seconds. It still stopped at 988 points and only reached `t = 26.93`. The exact overshoot depends on which kinds are emitted in the frame that crosses the 988-point loop boundary; therefore the honest current range is 988–996 points rather than one universal number. In every case, the requested duration is not the captured match duration.

Across the five 90-second seeded runs, the cap produced 4,963 points over 129.8 simulated seconds. That is an observed aggregate rate of **38.236 points per simulated second**. The serialized `JSON.stringify(run.points)` payload was 1,724,251 bytes, or about **13.284 kB per simulated second**. A naïve 80-minute extrapolation at the observed rate is approximately:

- **183,532 trace points**;
- **63.8 MB of serialized point data**, before the in-memory object/array overhead and any audit result structures.

This is an extrapolation, not a safe allocation target: set-piece density and emitted payload sizes change over a full match, and the current cap prevents measuring the full-match tail.

## 2. Per-kind cost and reachability

The table uses the combined five-seed 90-second run. `rate` is points per simulated second across the 129.8 seconds observed. `80-minute projection` multiplies that observed rate by 4,800 seconds; it is used to compare designs, not as a claim that a complete match has been simulated.

| kind | points | rate / s | 80-minute points | serialized bytes | approximate bytes / point |
|:---|---:|---:|---:|---:|---:|
| `PLAYERS_POS` | 487 | 3.752 | 18,009 | 166,318 | 342 |
| `CAMERA` | 487 | 3.752 | 18,009 | 222,127 | 456 |
| `INSTRUCTION` | 487 | 3.752 | 18,009 | 123,816 | 254 |
| `CONTEXT` | 487 | 3.752 | 18,009 | 117,603 | 242 |
| `AFFORDANCES` | 487 | 3.752 | 18,009 | 147,290 | 302 |
| `SHAPE` | 487 | 3.752 | 18,009 | 211,889 | 435 |
| `HUD` | 487 | 3.752 | 18,009 | 229,580 | 471 |
| `BALL` | 339 | 2.612 | 12,536 | 124,724 | 368 |
| `INPUT_DOWN` | 197 | 1.518 | 7,285 | 69,107 | 351 |
| `PASS_OPTIONS` | 178 | 1.371 | 6,582 | 49,407 | 278 |
| `DEFENSIVE_LINE` | 178 | 1.371 | 6,582 | 50,032 | 281 |
| `HINT` | 168 | 1.294 | 6,213 | 27,253 | 162 |
| `INPUT_UP` | 139 | 1.071 | 5,140 | 51,051 | 367 |
| `RUCK` | 124 | 0.955 | 4,586 | 50,981 | 411 |
| `BALL_FLIGHT` | 76 | 0.586 | 2,810 | 34,973 | 460 |
| `PLAYERS_AIRBORNE` | 76 | 0.586 | 2,810 | 26,960 | 355 |
| `LAW_CALL` | 51 | 0.393 | 1,886 | 11,676 | 229 |
| `SCRUM` | 24 | 0.185 | 888 | 8,819 | 368 |
| `BANNER` | 4 | 0.031 | 148 | 645 | 161 |
| **total** | **4,963** | **38.236** | **183,532** | **1,724,251** | — |

The seven high-frequency kinds (`PLAYERS_POS`, `CAMERA`, `INSTRUCTION`, `CONTEXT`, `AFFORDANCES`, `SHAPE`, `HUD`) consume **3,409 / 4,963 points = 68.7%** of the current capture and 1.219 MB / 1.724 MB = 70.7% of the serialized payload. Their combined observed rate is about 26.26 points per second.

The reachability result is equally important:

- present: `RUCK` 124, `SCRUM` 24, and the other listed kinds;
- absent: `KICKOFF`, `LINEOUT`, and `MAUL`;
- the absence is caused by the ~24–27 second ceiling, not by absent emitters;
- `SCRUM` is reachable in the early window but is not a reliable proxy for full-match set-piece coverage.

The 18 rules attached to the absent kinds remain rules:

- `KICKOFF`: LAW-103, LAW-104, LAW-105, LAW-106, UX-107;
- `LINEOUT`: LAW-84, LAW-85, LAW-86, UX-87, UX-88, LOG-89;
- `MAUL`: LAW-90, LAW-91, LOG-92, UX-93, LOG-94, LOG-95, LOG-96.

They must not be deleted or classified as vacuous until a capture reaches the situations their emitters represent. The corrected vacuity count against the 113 executable rules is therefore **pending the post-ceiling audit**.

## 3. Design options weighed

### Option A — raise the single global ceiling

A ceiling near 184,000 points would match the naïve 80-minute projection. It is simple and preserves every current per-frame observation, but it carries at least 64 MB of serialized data and materially more live object memory. It also continues to let the seven high-frequency kinds consume most of the budget, so a future finite cap can still starve rare events. A much larger fixed constant would be an unmeasured memory decision.

### Option B — lower the sample rate for the seven high-frequency kinds

At the measured rates, the seven kinds produce about 126,000 projected points over 80 minutes. If each were sampled at 1 Hz instead of approximately 3.75 Hz, the same rough extrapolation becomes about **91,000 total points / 30.7 MB serialized**. At 2 Hz it becomes about **125,000 points / 42.7 MB serialized**. This is the most promising cost lever, but it can change rules that rely on short-lived state transitions. Each affected rule needs a before/after equivalence test over the currently reachable window before a rate is approved.

### Option C — reserve per-kind quotas

A per-kind reservation would guarantee that a later `LINEOUT`, `MAUL`, or `KICKOFF` cannot be crowded out by camera/HUD/player snapshots. It makes the reachability result honest, but quotas need evidence: a reservation that is too small truncates a real set piece, while a reservation that is too large wastes memory in runs that never reach it. Quotas also need a deterministic policy for unused reservations and overflow.

### Option D — make the limit a `runTrace` parameter

A parameter improves controlled experiments and permits a larger audit run without changing the shipped/default capture. It does not solve memory cost or per-kind starvation by itself. It is useful infrastructure, not a complete capture policy.

## 4. Proposed next design, pending review

The measurements support a **sampling-asymmetry design**, but the exact rates and quota policy are non-obvious and are not implemented here:

1. Add a capture configuration passed to `runTrace`, rather than changing only the constant.
2. Keep rare/high-value event kinds (`KICKOFF`, `LINEOUT`, `MAUL`, `SCRUM`, `RUCK`, `LAW_CALL`, and phase-specific state) at every emitted opportunity.
3. Sample the seven high-frequency observational kinds at a configurable lower rate, with deterministic time-based sampling rather than RNG.
4. Add per-kind accounting/reservations so a set-piece kind has a guaranteed budget and the capture reports truncation explicitly.
5. Run an equivalence audit on the existing first-27-second window at full rate versus each candidate rate. No LAW/LOGIC/UX rule may be silently made unobservable by downsampling.
6. Only after that comparison choose the default rate and ceiling, then re-run a genuinely reachable full-match audit and classify rule vacuity against all 113 executable rules.

This design is not yet approved for implementation because it changes trace semantics, rule observation frequency, and memory behavior at the same time. Raising `TRACE_LIMIT` alone would be an unmeasured allocation choice; downsampling without per-kind reachability protection would be an unmeasured audit-coverage choice.

## 5. Task A and Task C status in this batch

Task A is implemented in `src/game/trace.ts`: Candidate B now supplies `maxGapMetres`, while `src/game/audit.ts` consumes that corrected metric under the unchanged 4.6 m floor. The code comments record all six corrected-gap-greater-than-raw cases and explain why excluding the sweeper can widen an adjacent gap.

The exact seeded corrected result is unchanged from the approved design:

- seed 1: `0/36` failing samples, 0 events;
- seed 2: `2/26`, 1 event at `6.93–7.20`;
- seed 3: `5/45`, 2 events at `6.93–7.20` and `21.33–21.87`;
- seed 4: `0/35`, 0 events;
- seed 5: `0/36`, 0 events;
- total: 7 failing samples, 3 merged events.

For Task C, the misleading `lineConnected` field was **deleted**, not renamed or left as-is. It was written only at its own assignment site, read by no rule/gate/UI, and was computed from the whole-team `maxGap()` spread rather than a line-integrity population. `maxGap()` remains because the separate `SPREAD` trace uses it. No audit rule was deleted.

A post-Task-A seed-5 audit at the still-capped 90-second request reports 988 trace points, 5,331 PASS, 2 WARN, and 2 FAIL; LAW-66 is no longer among the failures. This is not the required post-ceiling audit: the 18 set-piece rules remain unmeasured until the trace reaches those emitters.

## 6. Halt point

`TRACE_LIMIT` has not been raised. No sampling/quota/parameter implementation has been made. The next action requires review/approval of the capture design above, followed by the full post-ceiling audit and honest reclassification of vacuity against the 113-rule executable set.
