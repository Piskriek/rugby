# SPEC_10: Audit Families Batch Review — Execution Plan

**Status: APPROVED (D0), VERDICTS APPROVED (D1), AND EXECUTED (Phase 3,
2026-09-03).** Six commits: B1 `a91e149` (UX-124), B2a `9e6e792`,
B2b+c `3c9248c`, B2d `5cdd01f`, B3a `7e42555`, B3b `326f624`.
Outcome over the 20-cell matrix: rule-audit FAIL 4,136 -> 195, WARN
3,300 -> 96; P90 drift 15.9 -> 0.3 m; the residual is the documented
honest signal set (LAW-66 compression and UX-23 handed to SPEC_04 per
flags ⚠2/⚠3). The frozen suite and gates stayed byte-identical
throughout.

The exact title of the final queue item is **"SPEC_10: Audit Families Batch Review"**
(`SPEC_10_AUDIT_FAMILIES.md`): eliminate piecemeal bug-chasing by re-measuring
every audit family on the current tree, assigning each family exactly one of
`[BUG]` / `[MISCALIBRATION]` / `[BY-DESIGN]`, and executing fixes in
verdict-sorted batches — `[BUG]` first — with a halt for human sign-off on the
verdicts before any fix lands.

---

## 1. Requirement analysis (decomposed)

| # | SPEC_10 demand | Consequence for this plan |
|---|---|---|
| R1 | Never fix audit flags one by one | The unit of work is the FAMILY; every commit is a family batch or a verdict batch |
| R2 | Re-measure ALL families on the CURRENT tree, no historical counts | A new deterministic harness is the first (and only) new code of Phase 1; pilots below are methodology validation, not counts of record |
| R3 | Every family gets exactly one of three verdicts | A rubric with evidence rules and tie-breakers (§5) — a family may not be left untagged or double-tagged |
| R4 | Output = re-measured counts + verdict per family, structured | Deliverable: `SPEC_10_BASELINE_AND_VERDICTS.md`, one table row per family |
| R5 | Halt for sign-off; then batches `[BUG]` → `[MISCALIBRATION]` → `[BY-DESIGN]` | Two halts total: this plan (now) and the verdict table (D1); then three verdict batches, one commit each |

## 2. The family inventory (grounded in the code)

**Layer A — the rule audit** (`src/game/audit.ts`: 113 rules, standards
LAW/LOGIC/UX, verdicts PASS/WARN/FAIL, runner `scripts/audit-cli.ts`).
23 families: AFFORDANCES(4) · BALL(9) · BALL_FLIGHT(10) · BANNER(1) ·
CAMERA(9) · CONTEXT(4) · DEFENSIVE_LINE(4) · HINT(1) · HUD(4) ·
INPUT_DOWN(3) · INPUT_UP(2) · INSTRUCTION(4) · KICKOFF(5) · LAW_CALL(2) ·
LINEOUT(6) · MAUL(7) · PASS_OPTIONS(6) · PLAYERS_AIRBORNE(5) ·
PLAYERS_POS(7) · RUCK(7) · SCRUM(7) · SHAPE(6) — plus any kind surfaced only
at runtime (enumerated programmatically in Phase 1, not by grep).

**Layer B — the statistical realism audit** (`src/game/statsAudit.ts`,
runner `scripts/stats.ts`): 14 benchmark families (points, tries, tackles,
rucks, scrums, lineouts, penalties, passes, kicks, metres, lineBreaks,
turnovers, possession, offloads) + 2 analyst thresholds (offside penalties
per team, P90 target-slot drift). 16 families.

**Layer C — context only, NOT re-triaged here:** the 9 regression gates
(`gates.ts`) are owned by the SPEC_04 / T-68 stage-2 reprice ticket and are
excluded from SPEC_10 verdicts; they ride along as guard rails (§7) so no
batch collides with them. Rationale recorded for the reviewer; overrule me
if you want gates triaged too.

**Total: 39 families to measure and tag.**

## 3. Pilot re-measurement (run this session, read-only, existing scripts)

Methodology validation only — NOT the counts of record:

- Rule audit, 90 s episodes, seed 7: **d0: 220 FAIL / 148 WARN** ·
  **d3: 278 FAIL / 138 WARN** · **d6: 276 FAIL / 118 WARN**; watchdog 0,
  teleports 0 at all three. Failures concentrate in ~13 families; the top of
  the distribution (d3): LOG-19 ×54 (forwards outside the pod channel),
  UX-124 ×33 (control list: no primary action), LAW-66 ×28 (8.3 m hole in
  the defensive line), UX-49 ×23 + LOG-56 ×23 (chaser count / chasers not
  closing), LAW-41 ×16 (ball travelling backwards), LAW-84 ×13 (9 in the
  throwing line), LOG-52 ×11, LAW-71 ×11 (backs in the ruck), LAW-17/57 ×8/2
  + LAW-103 ×7 + LAW-106 ×4 + UX-50/58 (kick-off family), LAW-42 ×8
  (designated kicker), LOG-48 ×7 (landing predicted out of field),
  UX-94/98 ×6/6 (input with no observable change), camera LOG-118/UX-115.
- Realism audit, 3 full matches at d3: **40 % (6/15)** — LOW: points 10.8,
  tries 0.8, tackles 60.8, rucks 84.3, scrums 5.7, lineouts 13.3, passes
  151.7, turnovers 3.7; HIGH: offside pens 5.7, P90 drift 18.7.

Pilot observations that shape the plan: (a) the audit rule set contains
**stale expectations** — `UX-49` still asserts the three-chaser chase that
T-69 superseded with six, so at least one family's fix is to the AUDIT, not
the game (the `[BY-DESIGN]` lane is real); (b) the LOW cluster matches the
HANDOFF's documented stage-2 reprice domain — the verdict table must decide
what is SPEC_10's to fix and what defers to SPEC_04's ticket; (c) failure
counts are difficulty-sensitive (UX-94 dominates d0, LOG-19 dominates d3/6),
so verdicts must be per-family across difficulties, not single-run.

## 4. Phase 1 — the re-measurement harness

**New file (the only new TypeScript before D1): `scripts/spec10-baseline.ts`**

- Deterministic via the SPEC_05 seam (`seedRng`); matrix: rule audit at
  difficulties {0, 3, 6, 9} × 5 seeds × 90 s episodes; realism audit at 5
  full matches per difficulty; emits `spec10-baseline.json` (raw) and a
  markdown table (per family: rules, FAIL n, WARN n, fail-rate per 1 000
  points, worst `why` exemplar, cross-difficulty stability flag).
- Acceptance: two invocations byte-identical (proves R2's "accurate
  baseline"); watchdog/teleport counters 0; runtime budget ≤ 10 min.
- No engine file is read for anything but measurement; nothing is mutated.

## 5. Phase 2 — the verdict rubric (strict)

Decision tree per family, evidence logged in the verdict table:

1. **`[BUG]`** — the FAILs trace to a mechanism that contradicts law, physics
   or the design's own contracts. Evidence required: code path + trace
   exemplar + citation (LAW_ENTRIES, pitfalls registry, or a spec/ticket).
2. **`[MISCALIBRATION]`** — mechanism correct, constants/thresholds wrong.
   Evidence required: measured value vs benchmark range + the statsAudit
   note justifying the range.
3. **`[BY-DESIGN]`** — behaviour is intended; the AUDIT is wrong or stale.
   Evidence required: the named intent source in-repo (ticket, comment,
   spec — e.g. `UX-49` vs T-69's six chasers). The fix edits the rule
   (narrow or silence with an inline justification), never the game.

Tie-breakers: mixed families take the WORST sub-verdict at family level with
the per-rule breakdown listed in the batch plan; zero-failure families are
tagged `[BY-DESIGN]` (healthy, no action); a Layer-A `[BY-DESIGN]` that
contradicts a Layer-B `[MISCALIBRATION]` on the same behaviour is flagged ⚠
and escalated to you rather than silently resolved.

## 6. Phase 3 — batching

- **B1 `[BUG]`** — engine fixes, one family per sub-batch, one commit each,
  each carrying its before/after family counts.
- **B2 `[MISCALIBRATION]`** — tuning passes with sensitivity notes; if a
  family's fix is really the SPEC_04 stage-2 reprice (rucks/scrums/lineouts/
  passes cluster), I propose the minimal verdict-owned adjustment and defer
  the wholesale reprice — flagged explicitly in the table.
- **B3 `[BY-DESIGN]`** — audit rule narrowing/silences, each with its intent
  citation; `audit.ts`/`statsAudit.ts` are the only files touched.

## 7. Defensive regression guards (the frozen suite)

Every batch, before and after: `spec07-contracts` 17/17 · `spec08-smoke`
13/13 · `spec09-thawprobe` ALL GREEN · `t69probe` ownership · `maulprobe` ·
`chain.ts` silent · `tsc` clean · `build` green · **`gates.ts` byte-identical
to the documented baseline (8/9, `BALL ON SCREEN` 330)** — a gate may only
move if the batch's family is that gate's documented owner, and then only to
improve. Hard rules: an audit-only change that moves a gameplay metric is a
regression (observation must be side-effect-free); watchdog and teleport
counters stay 0; silences are per-rule with justification, never blanket;
every threshold change carries before/after counts plus the cited benchmark.

## 8. Files to be touched (summary)

| Phase | Files |
|---|---|
| Measurement (D1) | + `scripts/spec10-baseline.ts` · + `SPEC_10_BASELINE_AND_VERDICTS.md` (nothing else) |
| B1 `[BUG]` | per-family: `engine/{breakdown,setpieces,kick,open,camera,laws}.ts`, `director.ts`, `intelligence.ts`, `shapes.ts` — exactly the families that earn the verdict |
| B2 `[MISCALIBRATION]` | same surfaces for constants only + `statsAudit.ts` ranges where the analyst range, not the game, is wrong |
| B3 `[BY-DESIGN]` | `audit.ts` (rule narrowing/silences) · `AuditScreen.tsx` only if a surfaced label changes |

## 9. Checkpoints

**D0 (this document — HALT #1, now)** → D1 baseline + verdict table
(**HALT #2**, your sign-off on 39 verdicts) → B1 → B2 → B3, per-batch
reports, final queue-closeout summary.

---

**HALTED — awaiting your review of this battle plan.** No code has been
written or committed for SPEC_10; the only actions taken so far are read-only
pilot measurements with existing harness scripts.
