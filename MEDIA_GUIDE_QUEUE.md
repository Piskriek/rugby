# MEDIA GUIDE AUDIT — STRATEGY AND BATCH QUEUE

Senior Engineering Partner, RugbyLive. Season 5, Batch 0 (planning).
**No live engine code written.** Halting for review.

Working tree clean at `79d67ed`, pushed. All Season 1-4 gates green.

---

## 1. FIRST FINDING: THE CORPUS IS NOT 9,082 AUDITABLE CLAIMS

Before proposing a plan I counted the corpus rather than accepting the headline
number. The Media Guide's own counter reports:

| research set | "points" |
|---|---|
| ENGINE SPEC | 2,977 |
| LOMU 1997 | 3,292 |
| PITFALL REGISTRY | 1,170 |
| ANIMATION & WEIGHT | 1,023 |
| PAPERCRAFT | 620 |
| **TOTAL** | **9,082** |

That total is real, but **it is a multiplied inventory, not a set of distinct
assertions.** From `dataPointCount()` and `jlrPointCount()`:

```
playerStats = players * 6        // 240 players -> 1,440 "points"
grid        = playerGridPoints() //             -> 2,400 "points"
teamAttrs   = TEAMS.length * 12  //             ->   192 "points"
kits        = ...        * 6     //             ->   216 "points"
```

**~4,808 of the 9,082 are roster, kit-palette and attribute-grid cells** — Jonah
Lomu's speed rating is data the engine consumes, not a behavioural claim that
can be true or false about the simulation. Auditing "England lock #4 has
strength 78" means checking a number equals itself.

Counting only rows that carry a distinct, falsifiable assertion:

| source | distinct claims |
|---|---|
| PITFALLS | 195 |
| MANUAL entries | 102 |
| OPTION_ITEMS | 32 |
| FORMATIONS | 28 |
| LAW_ENTRIES | 25 |
| FAIRNESS_INVARIANTS | 25 |
| AI_WEIGHTS | 25 |
| ACCESSIBILITY_RULES | 18 |
| REFEREE_CALLS | 16 |
| SEAMLESSNESS_RULES | 15 |
| CONTROL_VERBS | 14 |
| CLASSIC_MATCHES | 12 |
| DIFFICULTY_TABLE, SET_PLAYS, DEFAULT_SLIDERS | 30 |
| SIGNATURE_PLAYER_RULES, LOMU_MODES, ATTRIBUTE_MODEL, TROPHIES, AI_ARCHETYPES | 34 |
| **TOTAL** | **571** |

Plus 161 commentary lines, which are flavour text with no testable behaviour.

**Recommendation:** audit the **571**, and treat the ~4,800 inventory cells as a
single batch-level consistency check (schema, ranges, no duplicate shirt
numbers) rather than 4,800 individual audits. This is a ~16x reduction in scope
for no loss of rigour. **I would rather tell you the number is 571 now than
bill you for 9,082 audits, most of which would be tautologies.**

If you want the literal 9,082 walked one by one, say so and I will — but I do
not recommend it and I want the disagreement on record.

---

## 2. SECOND FINDING: MUCH OF THE AUDIT MACHINERY ALREADY EXISTS

Also measured before proposing to build anything:

- **`src/game/audit.ts` — 116 live rules** already encode LAW/LOGIC/UX claims as
  executable checks (30 LAW, 31 LOGIC, 52 UX + 3 helpers).
- **`scripts/audit-cli.ts`** already runs them headless against a seeded trace.
- **`PITFALLS`** already carries an honest `status` field: 184 FIXED,
  5 DESIGNED_AROUND, 6 ACCEPTED.

So this is not a greenfield audit. It is (a) validating that the existing 116
rules still hold, (b) finding claims with **no** executable check behind them,
and (c) closing real failures.

---

## 3. THIRD FINDING: THE EXISTING AUDIT IS ALREADY FAILING

I ran `audit-cli.ts` across five seeds at difficulty 3, 90 s. **This is not a
clean baseline:**

| seed | PASS | WARN | FAIL | dominant failure |
|---|---|---|---|---|
| 1 | 5,382 | 4 | **1** | LAW-66 x1 — 15.9 m hole |
| 2 | 5,428 | 20 | **12** | LAW-66 x6, UX-23 x4 |
| 3 | 5,401 | 4 | **11** | LAW-66 x11 — 7.6 m hole |
| 4 | 5,032 | 19 | **7** | LAW-66 x6, UX-23 x1 |
| 5 | 5,317 | 2 | **16** | LAW-66 x14, UX-58, UX-23 |

**`LAW-66` fails on 5 of 5 seeds** ("no gap in a re-formed line exceeds the
system spacing" — holes of 4.8 m to 15.9 m against a ~4.6 m budget). This is a
standing defect in defensive line re-formation that the nine release gates do
not cover, because they never measure inter-defender spacing.

Note `UX-23` ("ball is inside the frame") fails here while the `BALL ON SCREEN`
gate reports 0. **These do not contradict each other** — the gate allows a
60-frame budget across a match; UX-23 flags any single frame. Both are correct
at different strictness. I flag it so nobody "fixes" a phantom inconsistency.

---

## 4. STRATEGY

### 4.1 Classification, applied to every claim

Each claim gets exactly one disposition:

| code | meaning |
|---|---|
| **N/A** | Does not apply to a 2D, headless, deterministic sim (e.g. 3D-only, online, audio-spatialisation claims) |
| **DATA** | Inventory cell — validated by schema/range check at batch level, not individually |
| **COVERED** | An executable check already exists and passes |
| **UNVERIFIED** | Claim is applicable and plausible but has **no** executable check — the interesting category |
| **VIOLATED** | An executable check exists and fails, or a probe shows the claim is false |

The output that matters is **UNVERIFIED** and **VIOLATED**. A claim asserted in
the Media Guide but not enforced anywhere is a marketing statement, and this
codebase's house style is that claims are backed by measurement.

### 4.2 Batching

Ordered by **risk to the player**, not by convenience:

| batch | scope | claims | why this order |
|---|---|---|---|
| **B-1** | Existing 116 audit rules — re-validate, fix `LAW-66` | 116 | Already failing on every seed. Live defect. |
| **B-2** | LAW_ENTRIES (25) + REFEREE_CALLS (16) | 41 | Law correctness is the sim's core promise |
| **B-3** | FAIRNESS_INVARIANTS (25) + ACCESSIBILITY_RULES (18) | 43 | Fairness/accessibility failures are the least forgivable |
| **B-4** | 11 non-FIXED PITFALLS | 11 | Standing admissions — confirm each is still honest |
| **B-5** | 184 FIXED PITFALLS — spot-audit for regressions | 184 | Claims of "fixed" decay silently |
| **B-6** | MANUAL entries (102) | 102 | Player-facing documentation accuracy |
| **B-7** | CONTROL_VERBS (14) + SEAMLESSNESS_RULES (15) + SET_PLAYS (10) | 39 | Interaction contracts |
| **B-8** | AI_WEIGHTS (25) + DIFFICULTY_TABLE (10) + AI_ARCHETYPES (5) | 40 | Tuning claims |
| **B-9** | FORMATIONS (28) + OPTION_ITEMS (32) + SLIDERS (10) | 70 | Config surface |
| **B-10** | Inventory sweep: rosters, kits, attribute grid | ~4,808 cells | One schema/range pass, not 4,808 audits |

Batches are 11-116 claims — small enough to review in one sitting.

### 4.3 Per-batch protocol (Operating Rules honoured)

1. **Measure first** — probe under `npx vite-node`, seeded, before any opinion.
2. **Halt and review** — a `.md` per batch with the disposition table, presented
   before any engine code.
3. **No scope creep** — defects found outside the batch are *recorded*, not
   fixed.
4. **Deterministic integrity** — every batch re-runs the 9 gates, the 15-seed
   sweep, and SPEC_21/22/23 verifiers. No batch merges on a red gate.

### 4.4 Effort, stated honestly

At 11-116 claims per batch, this is **10 batches**, each a review cycle. B-5
(184 FIXED pitfalls) and B-10 (inventory) are the long poles. I will not
pretend 9,082 points can be meaningfully audited quickly; the 571-claim scoping
is what makes this finishable.

---

## 5. PROPOSED BATCH 1 — IMMEDIATE

**Scope: the 116 existing audit rules, and the `LAW-66` failure.**

Chosen because it is the only batch containing a *measured, reproducible,
currently-failing* claim. Everything else is unknown-status; this is known-bad.

Planned work, pending your approval:

1. **Diagnose `LAW-66`** — instrument defensive re-formation and find why gaps
   of 4.8-15.9 m open. Measure the distribution across seeds and phases before
   forming any hypothesis. Specifically determine whether the hole is a real
   tactical gap or an artefact of the rule sampling mid-reset (a rule that
   measures the wrong population makes a fix look like a regression — the
   D-3 offside lesson).
2. **Classify all 116 rules** by the section 4.1 codes, and identify any that
   are vacuous (e.g. guarded by a precondition that is almost never true, so
   they "pass" without testing anything). I expect to find some.
3. **Report** as `BATCH_01_AUDIT.md`. No engine changes without your ruling.

### Open questions for you

1. **Scope ruling:** audit the **571 distinct claims** (my recommendation), or
   the literal 9,082 including inventory cells?
2. **`LAW-66`:** fix the defensive line, or re-scope the rule if measurement
   shows it is sampling during a legitimate reset? I will not decide this before
   measuring, but I want to know your preference if both are defensible.
3. **Gate promotion:** if `LAW-66` proves a genuine defect, should defensive-line
   integrity become a **10th release gate**? That would move the "9 gates do not
   move without written justification" line, so I am asking, not assuming.
4. **B-5 depth:** for the 184 FIXED pitfalls, do you want every one re-probed,
   or a risk-weighted sample (all AI SHAPE / PASSING / RUCKS = 79, spot-check
   the rest)?

---

## 6. WHAT I HAVE NOT DONE

- No engine code written.
- No gate thresholds touched.
- No new gates added.
- `LAW-66` diagnosed only far enough to prove it is real and reproducible on
  5/5 seeds. Root cause deliberately not guessed.
