# SPEC_04: Stage-2 Re-price Protocol

## 1. Objective & Strict Sequencing
The core risk of re-pricing stats is that arbitrarily changing data floors causes "green boards" to lie and obscures true game balance.
- **Sequencing Constraint**: This task is strictly sequenced after the analyst AI provides its input.
- **File Lock**: You are explicitly forbidden from modifying `src/game/statsAudit.ts` until the written protocol is fully approved.

## 2. The Protocol Definition
Before any code is altered, you must generate a written protocol for every individual stat being re-priced. Each stat's protocol must explicitly define the following three parameters:
- **Source Range**: The precise origin and mathematical bounds of the data being measured.
- **Compressed-Clock Argument**: The justification and scaling math for how this stat behaves under compressed game-time mechanics.
- **Sample Size**: The minimum required volume of data points necessary to validate the stat's integrity without variance skewing the results.

## 3. Output Delivery
- Output the structured protocol template containing the source range, compressed-clock argument, and sample size for all targeted stats.
- Halt execution completely. Await the analyst AI's data injection and human sign-off before proceeding to implementation in `statsAudit.ts`.
