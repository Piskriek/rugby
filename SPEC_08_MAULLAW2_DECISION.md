# SPEC_08 Phase 2 — The Fate of `maulLaw=2` ("NO LIMIT")

**Status: APPROVED by human review 2026-09-03 and EXECUTED** — deprecation
landed with the SPEC_08 commit (option row shrunk, saved 2s migrated to 0 at
load, law-2 stall branch and law-2 safety clause deleted, the 15 s hand-off
retained as an any-law backstop, `maulUseItClock` simplified to one law clock
per contest state). **This document is the record of the decision.**

## Verdict

**DEPRECATE `maulLaw=2`.** Map any saved `maulLaw === 2` to `0` (STOP ONCE) on
load and shrink the option row in `data.ts` to two entries. The default is
already `0`, so no session changes behaviour unless it opted into the mode.

## What `maulLaw=2` actually does (code, not the label)

The label promises an endless shove. The code does not deliver one, because
`maulLaw` only differentiates the **DEFENCE-controlled** (held-up) stall path
(`updateMaulStall`, `src/game/engine/setpieces.ts`):

| Mode | Attack-controlled maul | Defence-controlled, stalled |
|---|---|---|
| 0 STOP ONCE | 6 s auto-exit (all laws identical) | 5 s stall → `UNPLAYABLE_SCRUM` |
| 1 STOP TWICE | 6 s auto-exit (all laws identical) | 1st stop resets, 2nd → `PENALTY_AWARDED` |
| 2 NO LIMIT | 6 s auto-exit (all laws identical) | stall **never** whistled; silent `stallClock`/`warned` resets forever; only exit is the fixed 15 s safety hand-off → `UNPLAYABLE_SCRUM` |

A *driving* maul is by definition attack-controlled, and that path terminates
at `MAUL_AUTO_EXIT_AT = 6.0` under every law. So law 2's "endless shove" is
unreachable on the only path the law governs; what it actually grants is an
endless **standstill** — the one state T-65 says reads as arbitrary.

## Why deprecation follows from the new presentation

1. **Playtest 2 cannot be satisfied on law 2's path.** The rule: a countdown
   must explicitly mean TIME TO ACT. Under defence control both sides are
   action-locked — SPEC_03 deliberately made exits attack-control-only
   (`requestHumanMaulExit` gates on `ATTACK_CONTROL`) and closed the re-gate.
   Laws 0/1 squeak by on the "use it or lose it" frame: a short (≤ 5 s) clock
   to a warned-about referee decision. Law 2's honest clock is up to ~12 s of
   dead air to the **same scrum law 0 awards 10 seconds earlier** — a
   wait-clock, not an act-clock.
2. **Its reset semantics fight the channel.** Law 2 silently zeroes
   `stallClock` and re-arms `warned` every ~5 s, so the referee call re-engages
   in cycles (Phase 1 counts down the monotonic 15 s clock to stay honest, but
   the cycling cue is inherent). A countdown that resets is not a countdown —
   it is the ambient information Playtest 2 bans.
3. **No outcome variety is lost.** Law 2's terminal award
   (`UNPLAYABLE_SCRUM`) is identical to law 0's; only the wait is longer.
   Law 1 is the sole mode with a distinct result (penalty).
4. **Migration is cheap and safe.** Two stall sites + the new
   `maulUseItClock` helper read `maulLaw`; the default is already 0; the
   LAW-91 audit (warn-before-whistle) holds in every mode and is *stronger*
   with the persistent call.

## The rejected alternative: MODIFY

Phase 1 already makes law 2's display honest (count to the 15 s hand-off), so
"modify" is live: keep a third mode as an honest "NO WHISTLE" clock. Rejected
because honesty is not actionability — making the 15 s window mean TIME TO ACT
requires giving one side a move (e.g. permitting `TRANSFER_TO_9` under defence
control as a compliance action). That rewrites SPEC_03's reviewed, write-once
exit state machine, turns a presentation ticket into a mechanics ticket, and
re-opens the held-maul transfer loop SPEC_03 closed. If held-up mauls need
counterplay, that is its own spec.

## Implementation plan (executed as written with the SPEC_08 commit)

*Executed notes: the law read site additionally clamps any legacy value ≥ 1
to the STOP TWICE ladder, so no stale config path can resurrect the
standstill even if it bypasses the save migration.*

1. `data.ts`: `maulLaw` row → `values: ['STOP ONCE', 'STOP TWICE']`.
2. Load path (`persist.ts`): `maulLaw === 2` → `0`; indices 0/1 unchanged.
3. `setpieces.ts`: delete the law-2 stall branch and the law-2 clause of the
   15 s safety (the safety stays as a watchdog backstop for any law, which is
   its original purpose); `maulUseItClock` drops its law-2 arm.
4. Audit: LAW-91 untouched; add one regression line asserting no stall exceeds
   `MAUL_NO_LIMIT_SAFETY_AT` without an award in any mode.
