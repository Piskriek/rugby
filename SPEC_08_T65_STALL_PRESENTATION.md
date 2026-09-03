# SPEC_08: T-65 Stall Presentation

## 1. Objective & The "Playtest 2" Rule
The objective of this ticket is to clearly communicate stall states (like unplayable mauls or rucks) to the player.
- **The Golden Rule**: You must strictly adhere to Playtest 2's UX rule: a countdown must explicitly mean "TIME TO ACT". It cannot just be ambient information; it must signal an actionable window to the player.

## 2. Phase 1: Presentation Channels
Do not build new UI systems for this feature.
- **Visuals**: You must reuse the existing ruck-countdown channel to display the stall warning.
- **Audio/Ref**: Implement exactly one persistent referee call to accompany the visual countdown. This ensures the stall state is unavoidable via both visual and audio feedback.

## 3. Phase 2: Mechanics (maulLaw=2)
The presentation layer is only half the ticket; the underlying mechanics require a final verdict.
- **The Decision**: Before closing this ticket, a definitive decision must be made regarding the fate of `maulLaw=2`.
- **Documentation**: You must write a brief technical justification detailing whether `maulLaw=2` is being kept, modified, or deprecated in light of the new stall presentation.

## 4. Output Delivery
- Submit the code hooking the stall state into the existing ruck-countdown channel and the persistent ref call.
- Submit the written decision document regarding the mechanical fate of `maulLaw=2`.
- Halt and await human review of the `maulLaw=2` decision before committing the mechanical changes.
