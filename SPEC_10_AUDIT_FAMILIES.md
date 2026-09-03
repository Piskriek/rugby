# SPEC_10: Audit Families Batch Review

## 1. Objective & Workflow Strictness
The objective is to eliminate piecemeal bug chasing by systematically triaging audit families. You are explicitly forbidden from attempting to fix individual audit flags one by one. All work must be handled in categorized batches.

## 2. Phase 1: Re-measurement
Before assigning any verdicts or writing any fixes, you must establish an accurate baseline.
- **The Baseline**: Re-measure the counts for all audit families against the current, up-to-date source tree. Do not rely on historical counts from previous sessions.

## 3. Phase 2: Verdict Assignment
Once the current counts are established, you must triage every audit family.
- **The Categories**: You must assign a definitive verdict to each family using only one of the following three tags:
  - `[BUG]`: A clear mechanical or logical failure.
  - `[MISCALIBRATION]`: The logic works, but the tuning/thresholds are producing incorrect results.
  - `[BY-DESIGN]`: The behavior is intentional, and the audit itself may need to be adjusted or silenced.

## 4. Phase 3: Batching & Output Delivery
Group all planned fixes and adjustments into batches sorted entirely by their assigned verdict.
- Submit the re-measured counts and the verdict per family as a structured markdown list or table.
- Halt and await human sign-off on the verdicts. Once approved, the agent may begin executing the fixes one batch at a time, starting with `[BUG]`.
