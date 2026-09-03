# SPEC_03: T-41 Maul Exits & Contest Re-gate

## 1. Objective & Law Audit
This ticket introduces new vocabulary to the codebase, which inherently means establishing new rules. Before writing any code, a strict audit of these new laws is required. The primary directive for this feature is fully decoupling the physics engine from the contest outcomes.

## 2. Sequence 1: The Contest Re-gate (Pure Parameters)
The contest re-gate must govern the "human win share" entirely through player input parameters.
- **Strict Constraint**: Physics calculations must never influence the contest win/loss state.
- **Implementation**: Build the re-gate logic using exclusively `readRate` and `commit` windows to determine success.
- **Deliverable**: Define the pure parametric thresholds that dictate a human win versus a loss before wiring them into the active game loop.

## 3. Sequence 2: Maul Exits (State Machine)
Only after the re-gate parameters are finalized should you begin structuring the maul exits.
- **State Machine**: Design a deterministic state machine covering all possible maul exits.
- **Animation Mapping**: Map the specific, existing animation clips that will play for each designated exit state. Do not request new animation assets; strictly use the existing clip library.

## 4. Execution & Review
- Submit the parametric math for the re-gate and the diagram/object mapping for the exit state machine.
- Halt and wait for human review before integrating this physics-decoupled logic into the live environment.
