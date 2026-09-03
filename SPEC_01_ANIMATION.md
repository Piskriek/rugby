# SPEC_01: XL Animation Reconciliation (T-28, T-31, T-34)

## 1. Objective & Scope Restriction
The pre-papercraft renderer logic (specifically sideOn and rig.ts) is officially stale. The goal is to conduct a single audit pass to port four specific dataset demands onto the new pipeline, consolidating three stale tickets into one focused implementation plan.

**Permitted Files**: Read/Write access is strictly limited to the new pipeline files: `src/render/paper.ts`, `src/game/papercraft.ts`, and `src/game/animation.ts`.

**Restricted Files**: `src/render/rig.ts` is read-only for historical reference. Do not attempt to update or maintain the old rig logic.

## 2. The Audit & Mapping Phase
Before writing any implementation code, map the old dataset demands to the papercraft architecture. Produce a brief technical mapping of how the following will be handled:

- **Impact Squash**: Define how 2D deformation will be applied in the papercraft context upon collision events.
- **No-Foot-Slide**: Map the ground-locking equivalent for 2D assets to ensure feet plant accurately during movement cycles.
- **Running Pass**: Define the frame-blending or upper/lower separation logic required to execute a throw while maintaining a continuous run cycle.
- **Edge Leg Foreshortening**: Map the perspective math required for the papercraft renderer to simulate depth on the edges of the viewport.

## 3. Output Delivery

- Consolidate all findings into a single implementation plan (e.g., `IMPLEMENT_XL_ANIMATION.md`).
- Mark tickets T-28, T-31, and T-34 as explicitly CLOSED in the tracking documentation.
- Halt execution and wait for human review of the mapping document before generating any TypeScript.
