# SPEC_06: Facing/Strafe v2 ("Jarring" Follow-on)

## 1. Objective & Strict Lock
The objective is to fix the jarring visual transitions in the facing and strafing animations.
- **Absolute Constraint**: There must be zero "threshold fiddling" or guesswork applied to the tuning variables yet. You are explicitly forbidden from modifying any existing threshold values until the debug infrastructure is built and the bad moments are formally captured.

## 2. Phase 1: The Debug Overlay
Before touching any logic, you must build a real-time visual debugging tool.
- **Requirements**: Create a debug overlay that provides live, per-actor readouts on screen.
- **Required Metrics**: The overlay must specifically track and display the actor's `view`, `gait`, and `lat` (lateral/latency) data streams.

## 3. Phase 2: Capture & Hysteresis Design
Once the overlay is active, the jarring moments can be quantified.
- **Hysteresis Table**: Based on the debug data captured during the bad moments, design a formal hysteresis table. This spec must define the state-retention logic required to prevent the rapid, jarring state-flipping between facing and strafing.

## 4. Output Delivery & Review Gate
- Submit the code for the debug overlay first.
- Once the overlay is running and data is captured, submit the written hysteresis table for review.
- **Mandatory Sign-off**: No threshold changes will be merged without a user-reviewed before/after comparison utilizing the new hysteresis logic. Halt and await human testing.
