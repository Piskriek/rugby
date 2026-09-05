# Batch 02B — LAW-66 surviving-event diagnosis

> **Status: diagnosis and proposal only.** No engine, trace, or audit-rule source file was edited. The proposed fixes below are not implemented in Batch 02.

## Scope and measurement

Candidate B leaves three corrected events overall: one in seed 2 and two in seed 3. The supplied seed-3 windows are the primary diagnosis below. The seed-2 event is included as a short cross-seed corroboration because it has the same measured transition signature; it is not discarded merely because it is outside the supplied seed-3 windows.

The audit-comparable order was preserved:

```text
seedRng(seed); runDeep(gateConfig(3), 90); runTrace(gateConfig(3), 90)
```

The exact state snapshots were then reproduced with the same seeded bot driver. The temporary instrumentation did three things without changing the repository:

- wrapped the runtime `Director.writeThinkPlayer` call to record the writer label and before/after `tx`, `tz`, `job`, and `urgency` changes;
- recorded every frame's phase, open-play time, breakdown state, target, position, velocity, and `movedBy` for the relevant defenders;
- recorded phase transitions, breakdown crews, commit counts, and release times.

The temporary probes were `/tmp/batch02-write-probe.ts` and `/tmp/batch02-transition-probe.ts`. `movedBy = steer` is treated only as the last position writer. It is not treated as the cause of a target or formation defect.

All of the following samples use the corrected Candidate-B population, `DF-UMBRELLA`, `maxSpacing = 3.8 m`, `fringeGuard = 5.0 m`, `lineSpeed = 5.8 m/s`, `drift = 0.58`, and the existing 4.6 m LAW-66 threshold. The corrected FAIL decision remains `attackT > 1.2` and corrected displayed gap `> 4.6 m`.

## Seed 3, event 1 — turnover re-formation remains incomplete

### Re-measurement

| seed | time | attackT | corrected pair | corrected gap | target x-gap | x-gap velocity (`right - left`) | midpoint from carrier | result |
|---:|---:|---:|:---:|---:|---:|---:|---:|:---:|
| 3 | 6.93 | 1.35 | 3–7 | 6.984 m | 3.571 m | +4.455 m/s | 9.971 m | FAIL |
| 3 | 7.20 | 1.62 | 3–8 | 7.999 m | 3.526 m | +4.231 m/s | 9.281 m | FAIL |

The raw/corrected values are also present in the complete table in `BATCH_02A_DESIGN.md`: the raw gaps are 7.584 m (`9–15`) and 7.999 m (`3–8`). Candidate B removes the sweeper from the first raw maximum but does not remove the genuine inner-line separation between shirt 3 and the next retained defender.

### Frame and write evidence

The phase transition is `KICK -> OPEN_PLAY` at `t = 5.583`, when possession changes from A to B. The first breakdown does not begin until `t = 7.233`; both failing samples are therefore open-play re-formation samples, not breakdown samples.

At `t = 6.93`:

- shirt 3 is at `x = -10.122`, target `x = -0.159`, distance to its target `17.55 m`, velocity `vx = 2.745 m/s`, and job `SHEPHERD THEM BACK INSIDE TO THE COVER`;
- shirt 7 is at `x = -3.139`, target `x = 3.411`, distance to its target `7.34 m`, velocity `vx = 7.200 m/s`, and job `CURVE OUT AS YOU GO WIDE — NOTHING GETS OUTSIDE YOU`;
- the target marks are already only `3.571 m` apart, but the actual players are `6.984 m` apart and the gap is widening in that frame.

At `t = 7.20`, the same pattern remains:

- shirt 3 is `15.35 m` from its target and is still on the turnover shepherd job;
- shirt 8 is `5.86 m` from its target and is on `COVER CHASE — RUN HIM DOWN`;
- the actual gap is `7.999 m`, target x-gap `3.526 m`, and the measured x-gap velocity is still widening at `+4.231 m/s`.

The frame-level target writer labels are decisive:

| defender | observed target/job writer during the event | observed urgency pattern |
|---:|:---|:---|
| 3 | `think:defence-dataset:A3:turnover-def` | dataset writes `0.85`, then CPU reaction produces `0.85493` |
| 7 | `think:converge:A7` | converge writes urgency `1` |
| 8 | `think:cover-chase:A8` | cover-chase writes urgency `1` |

Thus the line is not receiving one coordinated re-formation target. Shirt 3 follows the authored turnover-defence shepherd mark while the adjacent defenders are sent to carrier/convergence or chase marks. `movedBy` is `steer` after those writes, but that identifies the integration writer only; it does not make steering the upstream cause.

### Candidate-cause checks

- **Defensive re-formation targets: confirmed primary cause.** The turnover transition leaves shirt 3 far from its authored target while adjacent defenders are assigned different event-driven targets. The target span is compact; the players have not reached it. This is a real line-integrity defect after the current 1.2-second reset allowance, not a Candidate-B population artefact.
- **`lineSpeed` / drift: contributing kinematics, not a bad system value.** The captured system remains `DF-UMBRELLA` with `5.8` and `0.58` in every relevant sample; neither value mutates. The different target branches nevertheless produce materially different urgency and lateral velocities (`2.745` versus `7.200 m/s`). The nominal line-speed/drift contract is therefore not sufficient to coordinate this re-formation. The evidence points to target-branch priority and urgency, not to changing the authored system constants in isolation.
- **Breakdown commitments without replacement: not present.** No breakdown exists in either failing sample. The first breakdown starts after the second sample.
- **`fringeGuard`: not implicated in this event.** The corrected pairs' midpoints are `9.971 m` and `9.281 m` from the carrier, outside the `5.0 m` fringe corridor. Treating this as a fringe exception would hide a central re-formation gap.

### Root cause and proposed fix

**Root cause:** after the kick/turnover, the turnover-defence dataset writer continues to shepherd shirt 3 toward a distant authored target while `converge`/`cover-chase` assigns adjacent defenders to the live carrier. The line marks are not themselves too far apart; the actual line is moving under incompatible target/urgency policies and has not re-formed by the LAW-66 decision point.

**Proposed fix, not implemented:** add a single turnover re-formation assignment for the retained non-sweeper core. It should derive coordinated anchors from the authored defensive channels and active `DF-UMBRELLA` context, preserve the turnover job text, and make the relevant inner defenders rejoin those anchors at the system line speed before event-driven converge/chase writes take over. The fix must improve actual arrival/closure; simply extending the `attackT` grace beyond 1.2 seconds would hide the same defect and is not proposed.

## Seed 3, event 2 — post-ruck target split and lag

### Re-measurement

| seed | time | attackT | corrected pair | corrected gap | target x-gap | x-gap velocity (`right - left`) | midpoint from carrier | result |
|---:|---:|---:|:---:|---:|---:|---:|---:|:---:|
| 3 | 21.33 | 1.47 | 2–3 | 7.184 m | 4.194 m | +0.589 m/s | 5.975 m | FAIL |
| 3 | 21.60 | 1.73 | 2–3 | 6.101 m | 4.198 m | -0.486 m/s | 4.472 m | FAIL |
| 3 | 21.87 | 2.00 | 11–3 | 4.916 m | 0.000 m | -6.163 m/s | 3.415 m | FAIL |

The corrected pair changes at the final sample as the line moves: shirt 2 is no longer the maximum-gap endpoint, but shirt 11 and shirt 3 still exceed the threshold. That change is part of the same event because all three samples are within one second.

### Phase and breakdown evidence

The preceding breakdown begins at `t = 17.933` and releases to open play at `t = 19.867`. It has:

- attacking side B;
- defensive crew `[8, 4, 5]`;
- maximum `defendersCommitted = 2`;
- a completed recycle at approximately `t = 19.85`.

The failing window begins about `1.47 s` after open play resumes. The next breakdown does not start until `t = 21.95`, after the final failing sample. The failure is therefore a post-ruck open-play re-formation problem, not a gap measured while the defenders are bound in the ruck.

The frame-level writes show two different target policies after that release:

| defender | writer during the failing window | target/job at the first failing sample |
|---:|:---|:---|
| 2 | `think:defence-dataset:A2:def-line-mid` | target `x = -0.903`, `TACKLE LOW AND HARD ON THE TIGHT CARRIER...` |
| 3 | `think:cover-chase:A3` | target `x = 3.291`, `COVER CHASE — RUN HIM DOWN` |
| 11 | `think:cover-chase:A11` | same cover target as shirt 3 at the first sample |

At `t = 21.33`, shirts 2 and 3 are `7.184 m` apart while their target x-gap is `4.194 m`. Shirt 2 is `5.97 m` from its target and shirt 3 is `3.69 m` away. The actual gap briefly widens because `vx` is `4.930` for shirt 2 and `5.520` for shirt 3. At `t = 21.60` the gap is closing (`3.801` versus `3.315 m/s`) but remains `6.101 m`. At `t = 21.87`, shirt 2 has moved to a `FOLD TO THE NEXT RUCK...` job, and the maximum corrected gap is instead shirts 11–3: both have a cover target x of about `2.30`, but their actual positions remain `4.916 m` apart.

### Candidate-cause checks

- **Defensive re-formation targets: confirmed primary cause.** The ruck release triggers a broad target rebuild, then the dataset/fringe target for shirt 2 and cover-chase target for shirt 3 remain different. The target span itself is `4.194 m`, already wider than the authored `maxSpacing = 3.8 m`, while the actual line is farther apart. The later target convergence does not instantly repair the current positions.
- **`lineSpeed` / drift: measured contribution, not a mutated configuration.** The system remains `5.8 m/s` line speed and `0.58` drift. The line is demonstrably moving: the pair changes from a widening gap to a closing gap, and shirt 3's forward-axis velocity reaches `-6.931 m/s` at `t = 21.60`. The failure is the residual lag and the inconsistent target span, not a stationary or missing movement integrator. The proposed correction must make the post-ruck target geometry and urgency coherent before tuning the nominal constants.
- **Breakdown commitments without replacement: no independent evidence.** The preceding ruck committed two defenders at most, and its defensive crew was `[8, 4, 5]`; neither shirt 2 nor shirt 3 was in that crew. After release, both receive live target/job writes. There is no missing replacement slot in this trace. The breakdown is a trigger for re-formation, not evidence that an unavailable committed defender left a hole.
- **`fringeGuard`: relevant role constraint, not a population exemption.** The first pair midpoint is just outside the 5 m guard (`5.975 m`), then it is inside at `4.472 m` and `3.415 m`. Shirt 2's authored job explicitly says it covers the ruck fringe and must not be drawn wide. Candidate B correctly retains shirts 2 and 3; the fringe context should constrain their coordinated targets, not remove the pair from LAW-66. The final 11–3 gap is also not a wide-wing/sweeper artefact.

### Root cause and proposed fix

**Root cause:** after the ruck release, the dataset `def-line-mid` writer keeps the fringe defender on one mark while `cover-chase` drives the adjacent defender toward the carrier. Their target span is wider than `maxSpacing` and their actual positions lag behind those targets. The late job switch to `FOLD` and the subsequent next-breakdown transition change the endpoint but do not repair the line before the event ends.

**Proposed fix, not implemented:** make the post-ruck defensive reset a coordinated, single-priority target pass for the retained core. It should place adjacent target anchors in channel order, keep the fringe anchor within the `fringeGuard` contract, and ensure adjacent target spacing is no greater than the active system geometry before cover-chase/converge can override it. Event-driven chase can still move a defender toward the carrier, but it must carry a replacement/inside-shoulder target for the neighbouring defender instead of creating a wider target span. Do not fix this by excluding the fringe defender or by extending the settle window.

## Seed 2 cross-seed corroboration

Candidate B's seed-2 event is `6.93–7.20`, with corrected gaps `7.388 m` for shirts 3–5 and `5.790 m` for shirts 3–7. It has the same `KICK -> OPEN_PLAY` transition at `t = 5.583` and no breakdown before the first failure (`the first breakdown starts at approximately 7.283`). The writer probe records shirt 3 on `think:defence-dataset:A3:turnover-def`; shirt 5 is also turnover-dataset driven at the first sample, and shirt 7 transitions to `think:converge:A7`. At the second sample, shirt 3 is on cover chase while the line is still recovering.

The first pair midpoint is `4.822 m` from the carrier, close to but inside `fringeGuard`; the second is `1.922 m` away. This is consistent with the same turnover re-formation defect, with a fringe-adjacent first sample, rather than a new population rule. It does not change the seed-3 root-cause conclusions or the Candidate-B design.

## Consolidated diagnosis

| event | measured root cause | proposed fix direction | population status |
|:---|:---|:---|:---|
| seed 2, 6.93–7.20 | turnover re-formation uses incompatible dataset/converge/chase targets and actual line arrival lags | coordinated turnover reset for core channels; preserve role jobs; no grace extension | corrected population retained; event is genuine |
| seed 3, 6.93–7.20 | same turnover re-formation split; shirt 3 remains 17.55 m from its target at first failure | same coordinated turnover reset | corrected population retained; event is genuine |
| seed 3, 21.33–21.87 | post-ruck dataset/fringe target and cover-chase target have a 4.19 m span and actual movement lag | coordinated post-ruck channel/fringe reset before chase override | corrected population retained; event is genuine |

No candidate cause is assigned to `steer` merely because it is the `movedBy` value. No surviving event is hidden by the sweeper or wide-wing correction. The residual gaps are real line-integrity defects, with target/re-formation coordination as the measured root cause and line-speed/drift as the movement constraint under those target assignments.

## Halt point

Batch 02B stops after this diagnosis. The proposed target/re-formation changes have not been implemented. No tenth release gate, custom tactic, multiplayer feature, trace edit, audit-rule edit, or live-engine edit is included in this batch.
