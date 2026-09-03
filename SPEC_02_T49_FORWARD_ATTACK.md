# SPEC_02: T-49 Forward Attack Structure

## 1. Objective & Danger Zone Acknowledgment
This ticket touches `cpuCallPlay`, shape marks, `think()`, and the wide sort simultaneously. Because this is a high-risk multi-writer execution zone, state mutation must be strictly guarded. No physics or global AI state variables may be altered without preceding structural safety nets. Relevant logic will likely span files such as `src/game/intelligence.ts` and `src/game/shapes.ts`.

## 2. Phase A: The Priority Contract (Logic First)
Before touching the execution pipeline, establish a strict boolean priority matrix between the "forward-gain" heuristic and the "uncovered-wing" rule.
**The Contract**: Define the exact numeric threshold or state condition where an uncovered wing legally overrides a guaranteed forward gain.
**Encapsulation**: This logic must be written as a pure, side-effect-free evaluator function. Do not wire it into the game loop yet.

## 3. Phase B: Depth Math & Measurement Gates
Once the pure priority contract is defined, proceed with the mathematical implementation:
- **Depth Math First**: Implement the geometric calculations required for the forward attack shape independently of the actor state.
- **Measurement Gates (Mandatory)**: You must insert assertion gates immediately after every single state change in the wide sort and `think()` pipeline.
- **Regression Attributability**: The strict requirement is that if the AI logic breaks, the exact mutation step that caused the regression must be instantly attributable via the debug output.

## 4. Output Delivery
- Write the pure priority function and the depth math logic.
- Present the isolated priority logic and the proposed placement of the measurement gates for human review before wiring anything into the live `cpuCallPlay` state.
