# SPEC_10 D1 — Baseline & 38-Family Verdict Table

**Status: PHASE 2 COMPLETE — HALTED FOR HUMAN SIGN-OFF.** No game code, audit
rules, or batches have been touched. Artifacts: `scripts/spec10-baseline.ts`
(Phase 1 harness), `spec10-baseline.json` (raw), `SPEC_10_BASELINE_TABLE.md`
(generated tables), this document (the verdict deliverable).

**Determinism proof (Phase 1 acceptance):** two full invocations produced
byte-identical JSON and markdown (sha256 `52cba33a…` / `d34f3f1e…`, verified
with `cmp`). Health across all 20 rule-audit cells: **0 watchdog trips,
0 teleports.** Matrix: difficulties {0,3,6,9} × seeds {11,23,37,51,89} × 90 s;
realism at 5 full matches per difficulty.

**Count correction vs the D0 plan:** the rule census resolves to **22** Layer-A
kinds (not 23) — 17 with findings, 5 pristine — plus 16 Layer-B families =
**38 families**, each tagged below.

**Rubric refinement (flagged for you):** SPEC_10 demands ONE definitive tag per
family. Where a family's rules split lanes, the family tag = the verdict of its
**dominant root cause** (by FAIL count), and the per-rule appendix routes each
rule's fix to its batch. Severity ordering for ties: `[BUG]` > `[MISCALIBRATION]` > `[BY-DESIGN]`.

---

## Layer A — rule-audit families (22)

| # | family | FAIL | WARN | verdict | root cause (evidence) | batch |
|---|---|---|---|---|---|---|
| 1 | CONTEXT | 475 | 45 | **[BUG]** | `actionBar` marks its primary via `primary: key === cv.key`, but `contextVerb` carries an empty `key` in many contexts → zero primaries ever marked. The feature exists (director.ts:703, rendered in MatchView) and its contract is unfulfilled — a small, real game defect | B1 |
| 2 | KICKOFF | 385 | 0 | **[MISCALIBRATION]** | ONE root cause: the KICKOFF capture samples the FLYING ball for the first 2 s (trace.ts:211) — by then the mark has legally travelled (z=2.6 ≈ 10 m/s × 0.26 s), receivers have legally crossed the ten, chasers legally passed the tee. LAW-103 ×154, UX-107 ×151, LAW-106 ×80 all share it. Fix: sample the strike tick (SPEC_09's T0) | B2 |
| 3 | DEFENSIVE_LINE | 560 | 0 | **[MISCALIBRATION]** | LAW-66 flags ≤4.0 m at any open-play sample; designed spacing is `maxSpacing` 3.8–4.0 (shapes.ts) and transitional resets measure 7+ m legitimately. Corroborated: line breaks REALISTIC, so the "holes" are not exploitable. Fix: window to set lines + margin over the designed spacing | B2 |
| 4 | INPUT_DOWN | 449 | 0 | **[MISCALIBRATION]** | UX-94 demands an observable change within one frame for every press; input is legally inert in gated contexts — SPEC_09's play-active gate made that stricter by design. Fix: context-aware window | B2 |
| 5 | BALL | 444 | 906 | **[BY-DESIGN]** | LAW-41 ×345 fires on CARRIED balls (`forwardRelativeKick` on carrier-vs-origin — legal retreats); LAW-42 ×99 applies the goal-kicker contract to punts from hand (any player may kick from hand — `startKick(carrierNum)`); LOG-119 ×906 WARN is the held/tee ball sampled out of scope | B3 |
| 6 | BALL_FLIGHT | 475 | 206 | **[BY-DESIGN]** | UX-49 ×342 still asserts the THREE-chaser chase T-69 replaced with six (kick.ts `launch()`); UX-50 ×86 "shirt 0" is the audit's `num()` default converting `receiver = null` (no fielder within 22 m) into shirt zero — the trace search only ever returns shirts 11/13/14/15; LOG-48 ×47 penalises touch-hunts whose landing prediction legitimately crosses touch (T-18 finder design) | B3 (+B2: LOG-52) |
| 7 | PLAYERS_AIRBORNE | 474 | 0 | **[BY-DESIGN]** | LOG-56 ×342 counts a chaser only if he is ALREADY closer to the landing than to the ball — structurally undercounts a chase that placeBound demonstrably steers (SPEC_09 probe A3/A5); UX-58 ×117 wants receivers near every drop (right for restarts, wrong for territory kicks — see ⚠1); LAW-57 ×12 is the KICKOFF window again | B3 (+B2: UX-58, LAW-57) |
| 8 | PLAYERS_POS | 846 | 402 | **[BY-DESIGN]** | LOG-19 ×825 flags forwards >10 m LATERAL of the ball — the pod attack design (RESTART_RECEIVE / backline pods) legitimately spans the width; the metric contradicts the shapes. LAW-17 ×21 rides the KICKOFF window; LOG-18/20 WARNs are bound set pieces ("permitted", says the rule's own text) | B3 (+B2: LAW-17) |
| 9 | RUCK | 199 | 0 | **[BY-DESIGN]** | LAW-71 enforces "backs do not ruck" — neither rugby law nor the engine's arrival-order breakdown design (T-26/T-39); the role contract is stale | B3 |
| 10 | LINEOUT | 101 | 0 | **[BY-DESIGN]** | LAW-84 counts `s.players.filter(team === thrower)` — that list includes the THROWER and the 9 (7 line + 2 = 9); the rule's 2–7 range tests the wrong population | B3 |
| 11 | CAMERA | 263 | 174 | **[BY-DESIGN]** | UX-114 ×125 assumes the BROADCAST gantry; CHASE/TACTICAL modes legitimately stand closer (shapes.ts camera plans). LOG-118 ×90's 30 px/m ceiling sits under the zoom envelope; UX-115 ×44 parks behind the line during dead-ball rituals | B3 (+B2: LOG-118, UX-115, UX-24) |
| 12 | AFFORDANCES | 119 | 0 | **[MISCALIBRATION]** | UX-31 wants a movement verb in every sample, including phases where movement is not offered by design (AIM, set-piece holds) | B2 |
| 13 | SCRUM | 37 | 0 | **[BY-DESIGN]** | UX-80 expects a referee call at every stage; ASSEMBLE is legitimately silent — cadence begins at CROUCH (director's own fallback: 'FORMING THE SCRUM') | B3 |
| 14 | MAUL | 22 | 0 | **[MISCALIBRATION]** | LOG-92's 7000 N ceiling is below the SPEC_02/04 force envelope (lineout drive 1900 + nation·26 + commit·320 ≈ 8.8 kN); d0/d3 only | B2 |
| 15 | INSTRUCTION | 0 | 452 | **[BY-DESIGN]** | UX-28 WARN: job text >~100 chars — the dataset voice is deliberately long | B3 |
| 16 | SHAPE | 0 | 400 | **[BY-DESIGN]** | UX-112 WARN: flowing phases legitimately have no formal play call | B3 |
| 17 | INPUT_UP | 0 | 122 | **[BY-DESIGN]** | UX-98 WARN: the rule's own `why` says "harmless for a tap" | B3 |
| 18–22 | BANNER · HINT · HUD · LAW_CALL · PASS_OPTIONS | 0 | 0 | **[BY-DESIGN]** | pristine — no action | — |

## Layer B — realism families (16)

| # | metric | d0 | d3 | d6 | d9 | range | verdict | disposition |
|---|---|---|---|---|---|---|---|---|
| 1 | POINTS PER TEAM | 19.2 | 18.6 | 10.3 | 17.5 | 12–34 | **[MISCALIBRATION]** | ⚠ defer SPEC_04 (d6-only low) |
| 2 | TRIES PER TEAM | 2.0 | 1.5 | 0.7 | 1.5 | 1–6 | **[MISCALIBRATION]** | ⚠ defer SPEC_04 (d6-only low) |
| 3 | TACKLES PER TEAM | 54.6 | 54.5 | 55.5 | 52.8 | 90–220 | **[MISCALIBRATION]** | ⚠ defer SPEC_04, **linked to B1** (see ⚠2) |
| 4 | RUCKS PER MATCH | 79.8 | 81.8 | 79.8 | 77.0 | 120–200 | **[MISCALIBRATION]** | ⚠ defer SPEC_04 (phase pacing) |
| 5 | SCRUMS PER MATCH | 8.2 | 6.8 | 8.2 | 8.4 | 14–20 | **[MISCALIBRATION]** | ⚠ defer SPEC_04 (award stream) |
| 6 | LINEOUTS PER MATCH | 9.0 | 10.0 | 14.6 | 8.2 | 20–28 | **[MISCALIBRATION]** | ⚠ defer SPEC_04 (award stream) |
| 7 | PENALTIES PER MATCH | 22.8 | 20.8 | 24.2 | 22.2 | 14–28 | **[BY-DESIGN]** | healthy |
| 8 | PASSES PER MATCH | 168.2 | 151.8 | 143.8 | 182.2 | 180–340 | **[MISCALIBRATION]** | ⚠ defer SPEC_04, linked to LOG-19 channel note |
| 9 | KICKS FROM HAND | 33.4 | 36.2 | 33.4 | 31.6 | 30–70 | **[BY-DESIGN]** | healthy |
| 10 | METRES CARRIED/TEAM | 382.8 | 375.1 | 354.9 | 396.3 | 250–800 | **[BY-DESIGN]** | healthy |
| 11 | LINE BREAKS/TEAM | 3.8 | 4.6 | 3.3 | 4.9 | 2–16 | **[BY-DESIGN]** | healthy |
| 12 | TURNOVERS PER MATCH | 6.0 | 4.6 | 6.4 | 6.2 | 10–32 | **[MISCALIBRATION]** | ⚠ defer SPEC_04 (steal pricing) |
| 13 | POSSESSION SPLIT | 48.2 | 46.5 | 51.5 | 43.5 | 40–60 | **[BY-DESIGN]** | healthy |
| 14 | OFFLOADS PER MATCH | 4.4 | 4.4 | 6.2 | 4.8 | 4–30 | **[BY-DESIGN]** | healthy |
| 15 | OFFSIDE PENS/TEAM | 3.9 | 4.2 | 5.0 | 5.4 | 2–4 | **[MISCALIBRATION]** | B2 candidate (engine discipline) — boundary ⚠ with SPEC_04 |
| 16 | P90 TARGET-SLOT DRIFT | 15.3 | 15.9 | 15.9 | 16.9 | 0–2.5 | **[MISCALIBRATION]** | B2 must first fix the MEASUREMENT composition (see ⚠4) |

Realism scores: d0 53 %, d3 53 %, d6 40 %, d9 60 %.

## The headline finding

The evidence says the audit is measurably older than the game: it predates
T-69 (UX-49 wants three chasers), SPEC_02/04 force scales (LOG-92's ceiling),
the CHASE/TACTICAL camera modes (UX-114), the pod attack design (LOG-19), and
SPEC_09's ritual legality windows (the whole KICKOFF family). **One true
game-side `[BUG]` survives triage (UX-124, small); the volume problem is
SPEC_04's documented reprice domain; the rest is measurement debt.** Of 38
families: 10 `[BY-DESIGN]` healthy or audit-stale-with-strong-evidence fixes in
the audit layer, 1 `[BUG]`, and the volume/measurement `[MISCALIBRATION]` set
split between a modest B2 (windows, thresholds, scopes) and the SPEC_04
boundary below.

## ⚠ Flags requiring your eyes

1. **UX-58 vs the kicking game (A/B tension):** "nobody near the drop" fights
   the T-18/T-31b finder design (territory kicks land in space; KICKS is
   REALISTIC). Resolved as scope-miscalibration (contestables only) — a `[BUG]`
   reading would have broken the kicking game.
2. **TACKLES LOW ↔ LAW-66 + UX-124 linkage:** fixing the contextVerb `[BUG]`
   and re-windowing LAW-66 may move tackles; B1 → re-measure BEFORE any
   SPEC_04 volume pass, or the reprice will tune against corrupted data.
3. **UX-23 (×4) overlaps the Layer-C gate `BALL ON SCREEN`** (baseline 330,
   documented debt): deferred to SPEC_04 per approved scope; no gate may move.
4. **P90 drift 16 m vs ceiling 2.5 m:** the P90 includes legitimate
   slot-running transitions; B2 must split transition samples from settled-line
   samples before ANY engine tuning decision.

## SPEC_04 boundary (explicit, per your instruction)

SPEC_10 tags the LOW volume cluster (points/tries/tackles/rucks/scrums/
lineouts/passes/turnovers) `[MISCALIBRATION]` and **defers all volume
repricing to SPEC_04**. SPEC_10 retains only: (a) the B1 mechanism fix
(UX-124); (b) audit window/threshold/scope corrections that change what the
numbers MEAN, not what the game does; (c) mandatory re-measurement after every
batch. The two analyst thresholds (offside pens, P90 drift) stay in B2 pending
the ⚠4 composition fix, with any engine-side tuning proposed separately.

## Proposed execution order (after your sign-off)

**B1 `[BUG]`** (1 family): CONTEXT/UX-124 — `contextVerb` key contract.
**B2 `[MISCALIBRATION]`** (~9 families, mostly `trace.ts`/`audit.ts` windows,
thresholds, scopes): KICKOFF strike-tick window (one fix, four rules),
DEFENSIVE_LINE window+margin, INPUT_DOWN context window, AFFORDANCES scope,
UX-58 scope, LAW-57 window, LOG-92 ceiling, camera thresholds/windows
(LOG-118/UX-115/UX-24), then the ⚠4 drift composition study.
**B3 `[BY-DESIGN]`** (~10 families): UX-49 (six chasers), UX-50 (null-default),
LAW-41/LAW-42 scope, LOG-19 metric redesign, LAW-84 population fix, LAW-71
role-contract rewrite, UX-80 ASSEMBLE, UX-114 mode-awareness, LOG-48 touch
allowance, and the WARN silences (LOG-119, UX-28, UX-112, LOG-18/20, UX-98,
UX-123). Every silence carries its intent citation.
Guard rails throughout: SPEC_07/08/09 suites, t69probe, maulprobe, chain, tsc,
build, gates byte-identical (8/9 documented baseline).

---

**D1 verdicts APPROVED and Phase 3 EXECUTED — see SPEC_10_EXECUTION_PLAN.md
status stamp and the six batch commits for the per-rule before/after counts.** Per-rule appendix
with per-difficulty counts lives in `spec10-baseline.json` → `ruleAudit.rules`.
