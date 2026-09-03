# SPEC_07: Score Integrity (T-67 Backstop)

## 1. Objective & Criticality
This task addresses the core legality of the game's scoring engine. It is small in scope but strictly legality-critical. The objective is to absolutely guarantee that a single event can never trigger multiple score increments.

## 2. Phase 1: scoreTry Idempotence Guard Semantics
The scoring function must be mathematically idempotent.
- **The Guard**: Implement strict guard semantics on the `scoreTry` execution block.
- **Implementation**: Define a locked state or transactional flag that engages the millisecond a try is awarded. This must explicitly reject any subsequent or duplicate scoring triggers originating from the same play sequence or overlapping physics frames.

## 3. Phase 2: Watchdog Log Surfacing
Silent failures or silent guard-blocks in scoring are unacceptable for debugging.
- **UI Integration**: Pipe the watchdog logging for the `scoreTry` guard directly into the pause panel UI.
- **Visibility**: If the idempotence guard successfully intercepts a duplicate score attempt, this event must be surfaced visibly to the user/tester in the pause menu, not just buried in a console log.

## 4. Output Delivery
- Submit the idempotence guard logic for `scoreTry`.
- Submit the UI hook logic routing the watchdog logs to the pause panel.
- Halt and await code review, as any flaws here compromise the game's fundamental rule set.
