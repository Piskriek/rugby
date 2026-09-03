# SPEC_09: Restart Ritual Warm-up

## 1. Objective & Risk Acknowledgment
The objective is to manage the unfreezing ("thawing") of all thirty players after a restart ritual. This is a highly volatile state transition. Thawing the thirty-player freeze directly interacts with the T-69 six-chaser commitment, and if executed out of order, it will resurrect the known "pre-set steal exploit".

## 2. Phase 1: Sequencing Design (Mandatory)
Do not write the execution code for the unfreeze yet. You must first write a strict sequencing design document.
- **The Sequence**: Map the exact frame-by-frame or tick-by-tick order of operations for the thaw.
- **T-69 Integration**: The sequence must explicitly define when and how the T-69 six-chaser commitment is initialized relative to the rest of the players unfreezing.

## 3. Phase 2: Exploit Mitigation
The pre-set steal exploit occurs when players gain action privileges before the ball or game state is legally live.
- **The Lock**: The sequencing design must include a hard "play-active" gate. Define the exact state variables that must evaluate to true before any AI or human input can influence the ball during the thaw.

## 4. Output Delivery
- Submit the written sequence design, clearly mapping the thaw order, the T-69 chaser initialization, and the exploit prevention gate.
- Halt and await human review to verify the logic is watertight against the steal exploit before attempting to implement the state machine changes in code.
