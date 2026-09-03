# SPEC_05: T-68 Harness Seeding

## 1. Objective & Call-Site Constraint
The goal is to introduce deterministic seeding into the test harness without destroying the current codebase. Because `R()` functions as a module singleton, replacing it globally is highly destructive.
- **Strict Rule: Zero call-site churn**. You are explicitly forbidden from modifying the arguments, signatures, or invocations of `R()` where it is currently used in the wild.

## 2. Phase 1: The Ambient Seam
To achieve determinism without churn, the integration must be ambient.
- **Implementation**: Design a contextual/ambient seed state that the `R()` singleton reads from under the hood. The harness should dictate the seed globally, and the existing `R()` module should respect it invisibly.

## 3. Phase 2: Tighten-vs-Accept Decision List
The secondary challenge is the massive volume of operations tied to this gate.
- **The List**: Before running the seeded harness, you must write a strict "tighten-vs-accept" decision list.
- **Scope**: This list must define how we will triage the ~1.3 million writes currently riding the 1.4 million gate. Establish the exact criteria for when a variance in the seeded output requires us to "tighten" the logic versus when we simply "accept" the deviation as harmless noise.

## 4. Output Delivery
- Provide the technical design for the ambient seed wrapper.
- Output the written "tighten-vs-accept" decision criteria.
- Halt and await human approval of the ambient strategy and decision list before implementing the wrapper or executing the harness test.
