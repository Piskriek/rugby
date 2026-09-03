# SPEC_04 — Stage-2 Re-price Protocol

> **Status: APPROVED IMPLEMENTATION RECORD — 2026-09-03**
> **Branch:** `arena/01a06671-rugby`
> **Implementation authority:** analyst crosswalk and human sign-off are
> recorded in §5. The approved event ledgers, audit ranges, and ruck/reset
> formation writer are implemented; this document does not authorise unrelated
> benchmark or simulation tuning.

## 0. Historical lock and continuing scope

The following lock governed the draft phase and was lifted only by the recorded
analyst crosswalk and human sign-off in §5:

- `src/game/statsAudit.ts`, `MatchStats`, stat writers, and the relevant engine
  paths could not change before approval.
- The approved work may not treat a passing board as evidence that a new range
  is valid, or use an unseeded one-, three-, or sixteen-match observation as a
  re-price input.
- No unrelated benchmark, score calculation, or simulation parameter may be
  tuned under this approval.

### 0.1 Candidate ledger

The Stage-2 assessment explicitly names **passes, scrums, and lineouts** as the
primary re-price candidates: all three are below their present floors and may
share an insufficient-cycle/exposure cause. They are the only metrics eligible
for a future range proposal in this stage.

The other eleven current `BENCHMARKS` are included below so that no silent,
secondary re-price can occur. They are **control-only** unless a later signed
scope change promotes one. In particular, a low score, try, tackle, kick, ruck,
or turnover total is not proof that its floor should move; it may instead be an
engine, law, or counter-definition defect.

This revision also adds a fifteenth, non-price diagnostic: **Offside & Formation
Integrity**. It is deliberately a metric vector rather than a single score, so
a low offside count cannot conceal a disconnected or badly drifting formation.
It creates no new `BENCHMARKS` range and does not authorise a change to any
tracking code.

| Disposition | Metrics |
|---|---|
| **Primary candidate after analyst input** | `passes`, `scrums`, `lineouts` |
| **Conditional diagnostic only** | `tackles`, `rucks`, `kicks`, `turnovers` |
| **Mandatory non-price diagnostic** | `offsideFormationIntegrity` |
| **Locked outcome / ratio / control** | `points`, `tries`, `penalties`, `metres`, `lineBreaks`, `possession`, `offloads` |

No numeric replacement range is proposed in this document.

---

## 1. Shared measurement contract

### 1.1 Present benchmark source

The current source of every numerical range is `src/game/statsAudit.ts`'s
`BENCHMARKS` table. Its stated provenance is a broad professional men's
Test/top-flight-club synthesis (Six Nations, Rugby Championship, and
Premiership-era averages). That is the **current internal provenance**, not a
citation-quality source for a new range.

For each future proposal, the analyst must inject:

1. source publication/dataset, competition(s), season/era, and URL or durable
   citation;
2. population and inclusion rules (full matches only, extra time treatment,
   competition level, team versus match aggregation);
3. raw source range or distribution, sample count, and whether the bounds are
   min/max, percentile interval, confidence interval, or editorial band;
4. a definition crosswalk proving that the real-world event and engine event
   mean the same thing.

Without all four, the current range remains unchanged.

### 1.2 Clock terms — never scale a range by `1 / 8` blindly

For the canonical stats-audit fixture, `gateConfig(3)` requests 40-minute
halves. `Director` converts this to:

```text
T_reference_clock = 2 × 40 × 60 = 4,800 displayed clock seconds
clockScale        = 8
T_engine_nominal  = 4,800 / 8 = 600 engine seconds while the clock runs
clock fraction    = C_clock = 600 / 4,800 = 0.125
```

`C_clock` is **not** an event-count multiplier. Player movement, phase timers,
set pieces, ball flight, dead-ball holds, and CPU decisions run in engine time;
the displayed clock is merely accelerated. A naïve `range × 0.125` would turn
professional ranges into false targets. The historical Stage-2 hypothesis is a
rough **25–30% shortage of event opportunity**, not an 87.5% shortage.

For an eligible count statistic `j`, the analyst must instead provide a
stat-specific opportunity/exposure denominator `E` and calculate:

```text
kappa_j       = mean(E_sim,j per completed simulated match)
                / mean(E_ref,j per completed reference match)

proposedLo_j  = quantize_j(Lo_ref,j × kappa_j)
proposedHi_j  = quantize_j(Hi_ref,j × kappa_j)
```

`quantize_j` rounds only to the metric's lawful display resolution (integer,
0.5, 0.1, or percent). It must preserve the scaled centre and width; it must
not independently lower a floor or raise a ceiling to make a board green.

A count may be re-priced only when all of the following hold:

- `0 < kappa_j < 1` with a supplied 95% interval wholly below 1;
- the event's **conditional rate** is credible, e.g.
  `events / opportunities`, rather than being the underlying broken mechanic;
- the engine and reference source definitions pass the crosswalk;
- no measurement-integrity blocker listed below remains open.

For a rate, percentage, per-team average, or terminal scoring result, the
correct multiplier is normally `kappa_j = 1`: it must be analysed per its own
opportunity denominator rather than clock-scaled.

### 1.3 Sampling rule used by every worksheet

The independent observation is a **completed full match**, not each pass, ruck,
or tackle inside it. Event totals are supplementary coverage floors only;
serial events from one match cannot be counted as independent samples.

All accepted data must use the same declared canonical fixture unless the
analyst explicitly supplies a stratified alternative:

- CPU versus CPU; standard/default options and sliders;
- 40-minute displayed halves, speed 1; normal end-of-match completion;
- a recorded seed bank, with balanced A/B team placement where team identity is
  part of the statistic;
- no watchdog reset, forced abort, or truncated simulation in the sample.

For every statistic, collect at least the worksheet's hard match/event floor,
then calculate the adaptive match requirement:

```text
M_required = max(M_hard, ceil((1.96 × s_match / h_j)^2))
```

where `s_match` is the sample standard deviation of the per-match statistic
from a 30-match seeded pilot, and `h_j` is 5% of the proposed scaled reference
band width. The final sample must meet `M_required`; a low-variance pilot never
permits fewer than `M_hard` matches. Report the mean, median, standard
deviation, 95% interval, min/max, seed list, and each required denominator.

---

## 2. Per-stat protocol worksheets

The **Source range**, **Compressed-clock argument**, and **Sample size** fields
below are mandatory analyst fields for every benchmark. `Current extraction`
records exactly what the present audit measures; it is not permission to change
that extraction now.

### 2.1 `points` — locked outcome control

- **Source range:** Current extraction is
  `(A.score + B.score) / 2`, a per-team match average with native domain
  `{0, 0.5, 1.0, …}` and lower bound 0. Current professional band is
  `[12, 34]` points per team. It includes all score types credited by the
  engine; analyst source must use the same inclusion rule.
- **Compressed-clock argument:** Points are terminal outcomes, not a linear
  timer tick. Their identity is `5 × tries + 2 × conversions + 3 × goal-like
  scores` by side, so any shortage may be an attack, finish, kick, or scoring
  bug. Set `kappa_points = 1`; do not scale the band until a separately approved
  scoring-exposure model proves equivalent conversion and scoring-entry rates.
- **Sample size:** `M_hard = 200` completed matches and at least 200 total try
  events. Use the adaptive formula in §1.3; no low-score result may lower this
  floor.

### 2.2 `tries` — locked outcome control

- **Source range:** Current extraction is
  `count(events where kind === 'TRY') / 2`, a per-team average in 0.5-event
  increments, bounded below by 0. Current band: `[1, 6]` tries per team.
- **Compressed-clock argument:** A try is an outcome of territory, break,
  support, maul, and grounding mechanics. Use `kappa_tries = 1`; compare tries
  per scoring entry and per line break before considering any later scope change.
- **Sample size:** `M_hard = 200` completed matches and at least 200 total TRY
  events. The rare-event coverage condition and adaptive formula both apply.

### 2.3 `tackles` — conditional diagnostic

- **Source range:** Current extraction is `(A.stats.tackles + B.stats.tackles)
  / 2`, a per-team made-tackle average in 0.5 increments, lower-bounded by 0.
  Present band: `[90, 220]` tackles per team. The counter is credited when a
  breakdown starts with a named/nearest tackler; it is not a count of attempted
  tackles or every collision.
- **Compressed-clock argument:** Tackles should be evaluated as
  `made tackles / eligible carrier-contact opportunities`, not per display
  second. A future candidate would require
  `kappa_tackles = contactOpportunities_sim / contactOpportunities_ref` and a
  separately credible made-tackle rate. It is not a Stage-2 re-price candidate.
- **Sample size:** `M_hard = 80` completed matches and at least 6,000 credited
  tackles. Stratify by contact origin before any scope-expansion request.

### 2.4 `rucks` — conditional diagnostic with definition check

- **Source range:** Current extraction is `A.stats.rucks + B.stats.rucks`, an
  integer total bounded below by 0; present band `[120, 200]` per match. The
  current writer increments only an attacking retained `RECYCLE` exit, so this
  is not necessarily every real-world ruck/breakdown attempt.
- **Compressed-clock argument:** Use a retained-breakdown opportunity rate,
  not raw clock time. A future `kappa_rucks` would be based on a source-aligned
  denominator of breakdown opportunities and must distinguish retained rucks
  from turnovers. It is locked in this stage.
- **Sample size:** `M_hard = 100` completed matches and at least 10,000
  source-aligned ruck/breakdown events. No re-price may proceed until the
  current/reference definition mismatch is resolved.

### 2.5 `scrums` — primary candidate, measurement blocked

- **Source range:** Current extraction is
  `A.scrumsWon + A.scrumsLost + B.scrumsWon + B.scrumsLost`, a non-negative
  integer currently compared to `[8, 22]` scrums per match. This is **not a
  one-to-one scrum count**: a feed-side win adds one `scrumsWon`; an
  against-the-head result adds one `scrumsWon` plus one `scrumsLost` and thus
  contributes two. Penalty-ended scrums may contribute neither. The current
  mathematical contribution per formed scrum can therefore be 0, 1, or 2.
- **Compressed-clock argument:** The source-aligned denominator must be
  distinct completed/awarded scrum events, or a cited reference definition that
  intentionally counts outcomes rather than scrums. Only after that crosswalk,
  use `kappa_scrums = scrumOpportunities_sim / scrumOpportunities_ref`; do not
  derive it from clock fraction or handling-error rate alone. A lower total may
  expose safe pass/error mechanics rather than compressed cycles.
- **Sample size:** `M_hard = 100` completed matches **and** at least 500 distinct
  source-aligned scrum events. This threshold is unavailable from the present
  aggregate expression, so analyst injection must include an offline event
  ledger or flag the result as blocked.

### 2.6 `lineouts` — primary candidate, measurement blocked

- **Source range:** Current extraction is
  `A.lineoutsWon + A.lineoutsLost + B.lineoutsWon + B.lineoutsLost`, presently
  compared to `[14, 34]` lineouts per match. It likewise is not a one-to-one
  attempt count: a normal win contributes one, a stolen throw contributes a
  winner and a loser (two), and a not-straight path can contribute only a loss.
  Its native domain is non-negative integers but its event semantics are mixed.
- **Compressed-clock argument:** The source-aligned denominator must be distinct
  lineout attempts/awards (with not-straight handling declared) or another
  cited equivalent. After the crosswalk,
  `kappa_lineouts = touch/lineout opportunities_sim / touch/lineout opportunities_ref`.
  It must not be scaled from all kicks, because not every kick creates a lineout.
- **Sample size:** `M_hard = 80` completed matches **and** at least 800 distinct,
  source-aligned lineout attempts. The analyst must provide the distinct-attempt
  ledger before this metric can receive a range proposal.

### 2.7 `penalties` — locked law control

- **Source range:** Current extraction is
  `A.penaltiesConceded + B.penaltiesConceded`, a non-negative integer total;
  present band `[14, 28]` penalties per match. The current writer records each
  `lawCall` against the offending side, so the analyst must match whether the
  professional source counts penalties awarded, conceded, free kicks, and
  advantage outcomes in the same way.
- **Compressed-clock argument:** Penalties are law-incidence outcomes per legal
  contest/phase, not a clock-proportional stream. Use `kappa_penalties = 1` and
  compare law calls by offence family and opportunity before any future scope
  change.
- **Sample size:** `M_hard = 100` completed matches and at least 1,400 recorded
  law calls, reported by offence family.

### 2.8 `passes` — primary candidate

- **Source range:** Current extraction is `A.stats.passes + B.stats.passes`, a
  non-negative integer total compared with `[180, 340]` passes per match. The
  writer increments immediately after a legal receiver is selected, before the
  pass-error roll; it is therefore an attempted/initiated pass count, not
  necessarily a completed-pass count. The analyst source must state which one
  it measures.
- **Compressed-clock argument:** Let `C` be source-aligned ball-in-hand
  decision/cycle opportunities and `p = passes / C`. A range proposal is valid
  only if `p_sim` is credible against `p_ref`; then use
  `kappa_passes = mean(C_sim) / mean(C_ref)` and scale `[180, 340]` with §1.2.
  If `p_sim` itself is low, fix CPU pass behaviour instead of lowering the band.
- **Sample size:** `M_hard = 60` completed matches and at least 10,800 initiated
  passes (60 × the present lower reference floor), plus the 30-match pilot and
  adaptive requirement in §1.3.

### 2.9 `kicks` — conditional diagnostic with inclusion mismatch

- **Source range:** Current extraction is `A.stats.kicks + B.stats.kicks`, a
  non-negative integer total with present band `[30, 70]`. `startKick` increments
  this counter for every kick type, including restarts, drop-outs, goal attempts,
  and conversions as well as open-play kicks. The current label “KICKS FROM
  HAND” may therefore not match a professional source that excludes restart or
  goal-kick categories.
- **Compressed-clock argument:** A future proposal must first split automatic
  restart/goal kicks from discretionary open-play kick decisions. Only the
  latter may use `kappa_kicks = openPlayKickOpportunities_sim /
  openPlayKickOpportunities_ref`; whole-counter clock scaling is invalid.
- **Sample size:** `M_hard = 100` completed matches and at least 3,000
  categorised kick events, with each kick type reported separately. It is not a
  Stage-2 candidate.

### 2.10 `metres` — locked carry-efficiency control

- **Source range:** Current extraction is `(A.stats.metres + B.stats.metres) / 2`,
  a non-negative per-team continuous carry-metres average (reported to one
  decimal); current band `[250, 800]`. The writer credits only positive forward
  open-play carrier movement, so maul metres and non-carry movement are excluded.
- **Compressed-clock argument:** `metres = carries × metresPerCarry`. Test the
  two factors independently; do not apply raw clock compression. The default is
  `kappa_metres = 1` until a signed, source-aligned carry-opportunity model
  exists.
- **Sample size:** `M_hard = 80` completed matches and at least 5,000 carries,
  with metres-per-carry distribution reported by phase origin.

### 2.11 `lineBreaks` — locked rare outcome control

- **Source range:** Current extraction is
  `(A.stats.lineBreaks + B.stats.lineBreaks) / 2`, a non-negative per-team
  average in 0.5 increments; present band `[2, 16]`. It is credited once per
  open-play state when gain exceeds 6 m and nearest defensive clearance exceeds
  3.5 m.
- **Compressed-clock argument:** A line break is a conditional carry outcome;
  compare `lineBreaks / carries` and `lineBreaks / attacking entries`, not clock
  seconds. `kappa_lineBreaks = 1` for this stage.
- **Sample size:** `M_hard = 200` completed matches and at least 400 credited
  line breaks. Report zero-heavy distribution and confidence interval explicitly.

### 2.12 `turnovers` — conditional diagnostic with source stratification

- **Source range:** Current extraction is `A.stats.turnovers + B.stats.turnovers`,
  a non-negative integer total compared with `[10, 32]`. Current writers include
  at least breakdown wins, jackal/ruck paths, and spilled passes; those causes
  have different denominators and must not be pooled without labels.
- **Compressed-clock argument:** Compute a separate `kappa` only for each
  source family (e.g. pass-error opportunity, breakdown contest opportunity).
  A global turnover clock multiplier would hide a broken error or contest rate.
  This metric remains control-only.
- **Sample size:** `M_hard = 150` completed matches, at least 1,500 total
  turnovers, and at least 100 events in every included source family.

### 2.13 `possession` — locked dimensionless ratio

- **Source range:** Current extraction is
  `100 × A.rucks / max(1, A.rucks + B.rucks)`, bounded mathematically by
  `[0, 100]` percent and reported to one decimal. The present benchmark is
  `[40, 60]`. It is a retained-ruck-share proxy, not measured seconds of
  possession.
- **Compressed-clock argument:** Ratios do not scale with elapsed time;
  `kappa_possession = 1`. Any future work must first decide whether the intended
  metric is ruck share or actual possession time, then retain a percentage band.
- **Sample size:** `M_hard = 100` completed matches and at least 10,000 rucks in
  the proxy denominator. Analyse A/B balance and team-side swaps separately.

### 2.14 `offloads` — locked style-dependent control

- **Source range:** Current extraction is `A.stats.offloads + B.stats.offloads`,
  a non-negative integer total; current band `[4, 30]`. The writer credits a
  successful support transfer only in the breakdown/tackle path, so it is not a
  universal pass subtype.
- **Compressed-clock argument:** Compare `offloads / tackle-contact opportunities`
  and support availability, not raw match time. `kappa_offloads = 1`; the broad
  present band is deliberately style-dependent and may not be compressed.
- **Sample size:** `M_hard = 200` completed matches and at least 400 successful
  offloads, with tactic/archetype strata reported rather than averaged away.

### 2.15 `offsideFormationIntegrity` — mandatory non-price diagnostic

- **Source range:** This is a source-aligned diagnostic vector, not a scalar
  box-score total. It must report all of the following at a legal, phase-specific
  observation point:

  ```text
  N_eligible          = count of player-observations to which a formation/offside rule applies
  O_playerFrame       = Σ 1[player is beyond the applicable line by > epsilon]
  O_episode           = Σ 1[an eligible formation episode contains >= 1 sustained breach]
  offsideRate         = 100 × O_playerFrame / N_eligible                         ∈ [0, 100] %
  offsideEpisodeRate  = 100 × O_episode / N_formationEpisodes                    ∈ [0, 100] %
  penetration         = max(0, signed distance beyond the applicable legal line) ∈ [0, 142.4] m
  targetError          = sqrt((x_actual - x_target)^2 + (z_actual - z_target)^2) ∈ [0, 142.4] m
  driftP50 / driftP90 = median / 90th percentile of targetError                  ∈ [0, 142.4] m
  driftOutlierRate     = 100 × Σ 1[targetError > tau_role] / N_eligible           ∈ [0, 100] %
  lineGapP90           = 90th percentile of adjacent eligible-line lateral gaps  ∈ [0, 70] m
  ```

  The 142.4 m upper bound is the pitch diagonal
  `sqrt((35 - -35)^2 + (62 - -62)^2)`, and the 70 m gap bound is the field
  width. `epsilon` (a numerical-noise tolerance), `tau_role` (a role/phase
  target-error tolerance), the target map, and inclusion rules require analyst
  definition crosswalk and human approval; they are intentionally not guessed
  here. A sustained breach must be measured as one contiguous incident rather
  than being inflated by every frame in the same error.

  Existing observables are useful but incomplete: the trace already records
  restart-strike `kickingTeamOffsideCount` and `receiversInside10m`, plus
  `DEFENSIVE_LINE.maxGapMetres`, `lineConnected`, `PLAYERS_POS` spread/channel
  signals, and ruck `offsideLinesDrawn`. `MatchStats.offsides` currently has no
  writer, and the ruck field only says that lines are drawn; neither is a valid
  offside-frequency numerator. The analyst must therefore label each current
  observable as a restart legality check, a formation-drift proxy, or an
  insufficient source—not silently combine them.

  The future source crosswalk must stratify at minimum:

  | Legal formation stratum | Offside boundary / formation target | Current evidence |
  |---|---|---|
  | Restart or drop-out, at strike | Kicking side behind ball; receiving side behind the ten-metre line | `KICKOFF` trace counts at first `FLIGHT` frames |
  | Formed ruck | Appropriate hindmost-foot / engine legal boundary; exclude legal bound participants | Ruck state and line-drawn boolean only; numerator is currently blocked |
  | Scrum, lineout, maul | Law-specific participating/non-participating position and approved set-piece target | No adequate frequency ledger yet |
  | Open-play defensive formation | No offside-law count; measure only eligible player drift, channel assignment, and line gap | `DEFENSIVE_LINE` and `PLAYERS_POS` proxies exist |

  A player is excluded from `N_eligible` while sin-binned, down, the ball carrier,
  in a lawfully bound set-piece role, or executing an explicitly approved chase,
  tackle, pass-flight, or release-beat transition. That prevents normal rugby
  motion from being misclassified as formation degradation.

- **Compressed-clock argument:** Offside and formation integrity are
  **opportunity-normalised** rather than clock-normalised. An error that lasts
  0.25 engine seconds is displayed as roughly 2 clock seconds at `clockScale =
  8`; multiplying its rate by `0.125` would erase the same visible/legal breach.
  Use `kappa_offsideFormationIntegrity = 1` for all rates and percentiles. Report
  recovery in both units instead:

  ```text
  recoveryEngine = time from breach to lawful/target re-entry in engine seconds
  recoveryClock  = clockScale × recoveryEngine
  ```

  The correct comparison is per eligible player-observation and per independent
  formation episode, not breaches per displayed 80-minute match. Compression can
  reduce the number of re-formations per match while making each uncorrected
  breach more visually persistent, so the analyst must separately report
  `N_formationEpisodes`, `N_eligible`, `offsideRate`, `driftP90`,
  `lineGapP90`, and recovery distributions. No aggregate “integrity score” may
  replace those dimensions or compensate an offside failure with good spacing.

- **Sample size:** Require all of the following before declaring the behaviour
  normal or degraded:

  ```text
  M_hard                    >= 100 completed, seeded full matches
  N_formationEpisodes       >= 2,000 independently counted formation episodes
  N_eligible (effective)    >= 10,000 eligible player-observations
  N_eligible (raw)          >= 100,000 timestamped player-observations
  N_restartStrike           >= 500 restart/drop-out strike checks
  N_ruckOrSetPieceWindow    >= 1,000 formed-ruck, scrum, lineout, or maul windows
  ```

  `N_eligible (effective)` must account for clustered frames from the same player
  and phase: `N_effective = N_raw / DEFF`, with
  `DEFF = 1 + (meanClusterSize - 1) × intraClusterCorrelation`. Match-level
  cluster bootstrap intervals are required for `offsideRate`, `driftP90`, and
  `lineGapP90`; player-frames alone must never be presented as independent
  matches. Ten thousand effective observations gives a conservative 95% worst-
  case binomial precision of about ±1 percentage point for a rate, while the
  episode and stratum floors separate a short-lived chaotic phase from a
  repeatable formation failure.

---

## 3. Analyst injection sheet (required before a proposal)

For each primary candidate (`passes`, `scrums`, `lineouts`), the analyst must
supply the following completed record. Blank fields mean **no re-price**. The
same provenance, seed, and sample fields apply to `offsideFormationIntegrity`,
but it receives diagnostic thresholds and remediation advice rather than a
scaled benchmark range.

```text
Metric:
Current audit extraction / definition:
Reference dataset citation, era, population, N:
Reference source range [Lo_ref, Hi_ref] and bound type:
Definition crosswalk accepted? (yes/no; explanation):
Completed seeded matches M / seed list / excluded runs:
Per-match observed mean, median, SD, 95% interval, min, max:
Distinct event count and source-aligned opportunity count:
Opportunity definition E_sim and E_ref:
kappa estimate / 95% interval:
Conditional event rate sim versus reference:
Measurement-integrity blockers closed? (yes/no):
Proposed scaled range [Lo_prop, Hi_prop] using §1.2:
Adaptive M_required calculation:
Analyst recommendation (re-price / retain / fix engine / fix counter):
Human approval:
```

For the fifteenth metric, the analyst must additionally inject this positional
crosswalk; blanks mean **diagnostic remains blocked**:

```text
Metric: offsideFormationIntegrity
Legal strata, phase entry/exit, and exact sampling moment:
Included and excluded player roles:
Applicable line equations and signed-direction convention by stratum:
epsilon / tau_role values and source or legal justification:
Target-mark source by role and phase:
Formation-episode boundary and sustained-breach duration:
Raw / effective eligible observations, DEFF inputs, and cluster method:
Restart-strike, ruck, scrum, lineout, maul, and open-play stratum counts:
Offside player-frame and episode rates with match-bootstrap 95% intervals:
Penetration, drift P50/P90, drift-outlier, line-gap P90, recovery distributions:
Existing trace fields used, missing fields, and definition limitations:
Conclusion (normal chaos / tracking gap / legal defect / formation defect):
Human approval of definitions and any later tracking work:
```

## 4. Review gate and halt condition

A future implementation may start only after all of these are true:

1. The analyst has completed the injection sheet for every requested primary
   metric.
2. The human reviewer has explicitly accepted the data provenance, definition
   crosswalk, opportunity denominator, scaling factor, sample size, and each
   exact new range.
3. The scrum and lineout distinct-event measurement blockers have a signed
   resolution plan; a range cannot be altered to compensate for ambiguous
   counters.
4. The fifteenth-metric injection has an approved legal-stratum and formation
   definition crosswalk before any offside/formation tracking work is proposed.
5. The resulting approved change list names exactly which benchmark rows and
   tracking definitions may change.

## 5. Approved implementation record — 2026-09-03

The analyst crosswalk and human implementation approval were subsequently
supplied. They authorise **only** the following concrete Stage-2 changes:

| Measure | Approved implementation definition | Approved target |
|---|---|---|
| `SetPieceEvents.scrums` | Increment once when an awarded scrum starts. A reset inside that contest does not create a second event; a later separately awarded scrum does. | `[14, 20]` per match |
| `SetPieceEvents.lineouts` | Increment once when an awarded lineout starts. A not-straight outcome is a loss on that attempt; its separately started rethrow is a new event. | `[20, 28]` per match |
| `SetPieceWins` | Record the winning side independently of the event ledger. Existing team win/loss presentation fields mirror this outcome ledger and may not be summed to make match totals. | outcome only — no match-total target |
| Offside penalties | Write `MatchStats.offsides` only for a deduplicated sustained breach at a formed ruck or a defensive-line reset, and award it through the ordinary penalty path. | `[2, 4]` per team |
| Target-slot formation drift | Measure actual actor position against the current `tx`/`tz` intelligence target at settled ruck/reset samples; use the fixture's worst-team P90 in the audit. | P90 `<= 2.5 m` |

### 5.1 Signed implementation crosswalk

- **Ruck legal line:** derive the defending side's hindmost declared ruck-slot
  `z`; with the attacking direction `dir`, penetration is
  `max(0, (lineZ - player.z) * dir)`. Lawfully bound ruck participants are not
  eligible for this outside-line check.
- **Defensive reset legal line:** use the existing release-beat contact mark
  `z`, with the same signed-direction convention. Its existing two-metre
  retreat mark remains a positioning target, not an invented legal line.
- **Eligibility:** exclude sin-binned, down, carrier, active cover-chase,
  tackle, kick-fielding, and legally bound ruck-role actors. This preserves the
  protocol's role-exclusion rule rather than counting normal rugby action as
  formation failure. The existing controlled-shirt retreat exception applies
  only to an actual human-controlled defender; CPU-v-CPU sides do not receive
  an accidental stationary exemption during a reset.
- **Opportunity and episode rule:** each formed ruck and each release beat opens
  one separate window. Permit the existing no-teleport correction a fixed
  `0.75` **engine-second** formation-settle interval; then sample at four
  engine-Hz, with `epsilon = 0.35 m`. A breach must remain beyond epsilon for
  `0.30` engine seconds before one episode/penalty can be written. The whistle
  ends that phase, and the window is marked, so a sustained breach cannot become
  one penalty per frame.
- **Target source and drift:** use the live actor's existing `tx`/`tz` target
  after the normal `think()` writer has refreshed it. This intentionally exposes
  actor-to-assignment drift; it is not a display-clock proxy.
- **Recovery reporting:** report P90 recovery in engine seconds and separately
  in displayed clock seconds as `recoveryClock = clockScale × recoveryEngine`.
  Rates and percentile thresholds retain `kappa = 1`; no `1/8` display-clock
  multiplication is permitted.

### 5.2 Verification record

- Focused implementation contracts: `scripts/spec04-contracts.ts` — **20/20**
  passed (event/outcome separation, crooked-rethrow event semantics, sustained
  ruck/reset deduplication, and engine/display recovery conversion).
- The required headless chain at difficulty 3 populated both ledgers and both
  formation strata without a game-loop crash. The latest unseeded smoke run
  observed 5 scrum / 14 lineout events; 7 / 1 offside penalties; 72 formed-ruck
  and 57 reset windows; and 791 / 1,417 target samples. Those stochastic counts
  demonstrate writer population, not a valid range-validation sample.
- `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed.

The additional, unseeded three-match observability run correctly left the new
board red rather than retuning an approved target to fit a short sample: it
observed 7.3 scrums (target 14–20), 11.3 lineouts (20–28), and 16.8 m
worst-team target-slot P90 (ceiling 2.5 m); mean offside penalties were 4.0 per
team (2–4). These are findings for a seeded sample/remediation follow-up, not a
reason to derive totals from outcomes, suppress drift, or apply display-clock
scaling.

**Current state:** analyst approval, implementation, and required verification
are complete. This approved record is ready for delivery on
`arena/01a06671-rugby`.
