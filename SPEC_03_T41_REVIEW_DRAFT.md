# SPEC_03 / T-41 — Review Draft: Maul Contest Re-gate and Exits

> **Approved design record — implementation now follows this contract.** This
> document was submitted before live wiring and is retained as the review record.
> The approved implementation lives in `src/game/maulRegate.ts`,
> `src/game/engine/setpieces.ts`, `src/game/director.ts`, and existing renderer
> mappings; no new clip asset was introduced.

## 0. Audit boundary

The current maul path has one mutable `MaulState` with stages
`ENGAGE | DRIVE | STALL | OVER`. `upMaul()` presently derives drive movement
from `forceA`, `forceD`, `speed`, `z`, `yaw`, team maul ratings, the set-piece
slider, and timing. A human left/right press directly adds force; CPU force is
also driven by difficulty. The generic `t > 8` route starts open play with a
ruck distributor.

That is exactly what the re-gate must **not** use to decide a contest winner.
The proposed contest result has no input from:

- `forceA`, `forceD`, `speed`, `gained`, `x`, `z`, `yaw`, or drive direction;
- player/nation ratings, stamina, team size, `fromLineout`, or set-piece
  slider;
- `ballRank`, `transferCd`, animation clip/time, RNG, or frame physics;
- `dt` as a numerical contest input. `dt` may only schedule the interaction
  windows; it never appears in the result formula.

A legal terminal event (try line, touch, whistle) may still end a maul. It is
an **exit trigger**, not evidence that changes the already locked contest
win/loss result.

## 1. Sequence 1 — pure contest re-gate

### 1.1 Input contract

The resolver is perspective-neutral: “human” means the side controlled by a
person, whether that side is attacking or defending. A later adapter may map
`humanWon` to `ATTACK_CONTROL` or `DEFENCE_CONTROL`; the resolver itself has
no team, physics, or live-state input.

This first re-gate is deliberately scoped to a **human-v-CPU** maul. CPU-v-CPU
and human-v-human need their own two-contender policy and remain outside this
contract until separately reviewed; neither may silently borrow a human result.

```ts
// Review pseudocode only — not a source-file proposal yet.
type Commit = 'NONE' | 'LEFT' | 'RIGHT';

interface MaulRegateInput {
  /** Opposing CPU's DIFFICULTY_TABLE readRate, normalised to 0..1. */
  readonly readRate: number;
  /** Exactly four closed player-input windows, oldest first. */
  readonly windows: readonly [Commit, Commit, Commit, Commit];
}

interface MaulRegateResult {
  readonly validCommits: 0 | 1 | 2 | 3 | 4;
  readonly humanCommitRate: number;
  readonly cpuReadRate: number;
  readonly humanWeight: number;
  readonly cpuWeight: number;
  readonly humanWinShare: number;
  /** Exact 50:50 goes to a fully committed human rather than an invisible tie-break. */
  readonly humanWon: boolean;
}
```

The only admissible human signal is an accepted left/right **edge** in a
window. `SPACE`/transfer, kick/use-it, held keys, repeated OS key-repeat, and
simultaneous left+right do not count as a contest commit. To make the existing
A/D waggle legible rather than spammy:

1. Four fixed windows open in order, each **0.55 real seconds** long (2.20 s
   total interaction beat).
2. The first unambiguous left or right edge in a window provisionally records
   that direction.
3. It is valid when it alternates from the preceding **valid** direction. The
   first valid direction may be left or right.
4. A repeated direction, both directions in the same frame, or no edge closes
   the window as `NONE`.
5. Once a window closes, its record is immutable. Once window 4 closes, the
   contest result locks exactly once.

The 0.55 s value is an input-cadence parameter only. It controls when a window
opens/closes; it is not multiplied into a force, speed, probability, or win
share.

### 1.2 Constants

| Constant | Proposed value | Purpose |
|---|---:|---|
| `windowCount` | `4` | Four visible, discrete A/D opportunities. |
| `windowSeconds` | `0.55` | 2.20 s total, leaving ample time before the current 8 s generic exit and 18 s phase ceiling. |
| `bindingCredit` | `0.55` | Equal non-physical normalisation for a formed maul; avoids an all-or-nothing first keypress. |
| `commitRange` | `0.45` | The portion of the weight earned by valid commit-window coverage. |
| `winThreshold` | `0.50` | A human wins on an equal or greater calculated share. |
| `tieRule` | `humanWins` | No RNG or hidden stat breaks an exact tie. |

`bindingCredit + commitRange = 1`. They are fixed interaction constants, not
team power values.

### 1.3 Formula

Let `k` be the count of valid, alternating human commits among the four closed
windows and let `r = clamp(readRate, 0, 1)`.

```text
humanCommitRate = k / 4
humanWeight     = 0.55 + 0.45 × humanCommitRate
cpuWeight       = 0.55 + 0.45 × r
humanWinShare   = humanWeight / (humanWeight + cpuWeight)
humanWon        = humanWinShare >= 0.50
```

Because both sides use the same fixed transform, the binary threshold is easy
to audit:

```text
humanWon  iff  (validCommits / 4) >= clamp(readRate, 0, 1)
required valid commits = ceil(4 × readRate)
```

The reported share remains useful for UI/audit telemetry, but the transition is
deterministic. There is no `R()` call and no probability draw.

### 1.4 Calibration table

The values below use the existing difficulty `readRate` values. A bold cell is
an outcome that meets the `>= 50%` human-win threshold.

| Opponent readRate | Valid commits required | 0 commits | 1 | 2 | 3 | 4 |
|---:|---:|---:|---:|---:|---:|---:|
| Rookie `0.30` | 2 | 44.5% | 49.2% | **53.1%** | **56.4%** | **59.3%** |
| County `0.62` | 3 | 39.9% | 44.4% | 48.3% | **51.7%** | **54.7%** |
| Legend `0.87` | 4 | 36.9% | 41.3% | 45.2% | 48.5% | **51.5%** |
| Mythic `0.99` | 4 | 35.6% | 40.0% | 43.8% | 47.1% | **50.1%** |

Thus a fully committed human has a 50.1–59.3% calculated share across the
existing difficulty ladder, and County/default requires three correctly timed
commits. This satisfies the requested 40–60% fair-contest band without giving
any difficulty level more physical shove.

### 1.5 Required pure test vectors

These are review targets for a future isolated contract test, not a request to
add it yet.

| `readRate` | Closed windows | Expected commits | Expected result |
|---:|---|---:|---|
| `0.62` | `L, R, L, NONE` | 3 | `share ≈ 0.517`, human win |
| `0.62` | `L, R, NONE, NONE` | 2 | `share ≈ 0.483`, human loss |
| `0.99` | `L, R, L, R` | 4 | `share ≈ 0.501`, human win |
| `0.99` | `L, R, L, NONE` | 3 | `share ≈ 0.471`, human loss |
| `0.30` | `L, R, NONE, NONE` | 2 | `share ≈ 0.531`, human win |
| any | `L, L, R, NONE` | 2 (`L,L` second is invalid) | outcome derives from 2 only |

A mandatory invariance test should run the same `MaulRegateInput` twice while
supplying deliberately different force, speed, position, stamina, ball-rank,
and animation values to surrounding fixtures. The two resolver outputs must be
bit-for-bit identical because those values are absent from its input type.

## 2. Sequence 2 — deterministic maul-exit state machine

### 2.1 Vocabulary and separation of concerns

The proposed new records are deliberately separate:

```ts
// Review pseudocode only.
type MaulContestControl = 'PENDING' | 'ATTACK_CONTROL' | 'DEFENCE_CONTROL';
type MaulExitRequest =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'PICK_AND_GO'; readonly runnerNum: number }
  | { readonly kind: 'WHEEL_AND_PEEL'; readonly runnerNum: number; readonly lane: 'LEFT' | 'RIGHT' }
  | { readonly kind: 'TRANSFER_TO_9' };
type MaulExitState =
  | 'NONE'
  | 'PICK_AND_GO'
  | 'WHEEL_AND_PEEL'
  | 'TRANSFER_TO_9'
  | 'UNPLAYABLE_SCRUM'
  | 'TOUCH_LINEOUT'
  | 'PENALTY_AWARDED'
  | 'TRY_AWARDED';

interface ProposedMaulDecision {
  readonly contest: MaulContestControl;
  readonly exit: MaulExitState;
  readonly requested: MaulExitRequest;
}
```

- `contest` is written once when the fourth window closes and never recomputed
  from drive physics.
- `exit` is written once when an exit commits and never overwritten. This is
  the one-transition guard against both generic `t > 8` release and a selected
  exit firing in the same frame.
- `requested` is a command/policy input, not an outcome. Input bindings and CPU
  selection policy remain intentionally unapproved and unwired.
- `runnerNum` and, for a peel, `lane` are explicit request fields. That makes
  actor/lane selection deterministic once a request has been accepted: no
  nearest-player, position, `yaw`, or speed lookup selects an exit runner.
- The existing `force`, `speed`, `gained`, `z`, and `yaw` may continue to draw
  the maul and may trigger lawful touch/try conditions. They cannot change
  `contest` or choose a winner.

The current kick/use-it input presently takes the generic open-play route. In a
future approved binding it must produce exactly one of these explicit requests
(or no request); it is not an additional generic exit state.

### 2.2 Transition order

```text
FORMED
  -> RE_GATE_OPEN              (open four input windows; contest = PENDING)
  -> RE_GATE_LOCKED            (window 4 closes; pure result is frozen)
       human attacking + won   -> ATTACK_CONTROL
       human defending + won   -> DEFENCE_CONTROL
       human attacking + lost  -> DEFENCE_CONTROL
       human defending + lost  -> ATTACK_CONTROL

ATTACK_CONTROL
  + PICK_AND_GO request        -> PICK_AND_GO       -> OPEN_PLAY
  + WHEEL_AND_PEEL request     -> WHEEL_AND_PEEL    -> OPEN_PLAY
  + TRANSFER_TO_9 request      -> TRANSFER_TO_9     -> OPEN_PLAY
  + no request at exit deadline-> TRANSFER_TO_9     -> OPEN_PLAY (deterministic fallback)

DEFENCE_CONTROL
  -> DEFENCE_HOLD
  + use-it/stall law expiry    -> UNPLAYABLE_SCRUM  -> SCRUM (defending feed)

Any nonterminal active state
  + try law condition          -> TRY_AWARDED       -> conversion KICK
  + touch law condition        -> TOUCH_LINEOUT     -> LINEOUT (defending throw)
  + penalty law condition      -> PENALTY_AWARDED   -> existing penalty flow
```

**Precedence in a frame:** (1) an already committed exit wins and no second
exit is evaluated; (2) existing terminal law events are checked in their
current lawful order; (3) a completed re-gate locks `contest`; (4) a permitted
request is accepted; (5) the deterministic no-request fallback fires only at
its deadline. No random branch is permitted.

The approved fallback deadline is **6.0 s after maul formation**, leaving a
12.0 s margin before the 18 s phase watchdog. The former generic 8 s
`startOpen` path has been removed; the explicit fallback can never race a
write-once named exit.

### 2.3 Exit guards and phase hand-off contract

| Definitive state | Guard (non-physics unless stated) | One allowed hand-off | No-repeat condition |
|---|---|---|---|
| `PICK_AND_GO` | `ATTACK_CONTROL`; requested `runnerNum` is eligible at the back | `startOpen(attacking, runner's continuously placed exit mark, runnerNum)` | Set `exit` before teardown. |
| `WHEEL_AND_PEEL` | `ATTACK_CONTROL`; requested `runnerNum` is eligible; request supplies `LEFT`/`RIGHT` lane | `startOpen(attacking, declared runner exit mark, runnerNum)` | The declared lane is a request, never inferred from `yaw`. |
| `TRANSFER_TO_9` | `ATTACK_CONTROL`; #9 is eligible/upright | `startOpen(attacking, #9's continuously placed base mark, 9)` | If #9 is unavailable, use an explicit prevalidated `PICK_AND_GO` fallback; never query nearest-player physics. |
| `UNPLAYABLE_SCRUM` | `DEFENCE_CONTROL`, or existing stall/use-it law expiry | `startScrum(defending, maul mark)` | A stopped-maul whistle can only award once. |
| `TOUCH_LINEOUT` | Existing lawful touch event | `startLineout(defending, touch mark)` | Terminal law event; contest record stays historical only. |
| `PENALTY_AWARDED` | Existing legal penalty event | existing `beginPenalty`/resolution path | Terminal law event; do not also start open play. |
| `TRY_AWARDED` | Existing legal try-line event | existing `scoreTry()` conversion path | Terminal law event; maul scoring remains a drive, not a dive. |

The exact human command bindings and CPU exit-policy conditions are intentionally
not selected here. The state machine accepts an already validated
`MaulExitRequest`, which keeps the review focused on correct outcomes and
prevents a new input decision from silently becoming a force calculation.

### 2.4 Existing clip mapping — no new assets

Engine clip names are shown first. The renderer currently maps
`maulBind` and `maulDrive` to the existing looping `maulPush` clip, `carry` to
the speed-normalised `run` clip, `ninePass` to `passSpin`, `nineSquat` to
`idle`, `cleanout` to `ruckCommit`, and `ready` to `idle`.

| State / beat | Attacking pack | Defending pack | Exit actor | Resolved existing renderer clip(s) |
|---|---|---|---|---|
| `RE_GATE_OPEN` | `maulBind` | `maulBind` | n/a | `maulPush` loop for both packs |
| `ATTACK_CONTROL` drive | `maulDrive` | `maulBind` | n/a | `maulPush` loop; semantic distinction remains engine-side |
| `DEFENCE_HOLD` / stall warning | `maulBind` | `maulBind` | n/a | `maulPush` loop; no invented collapse asset |
| `PICK_AND_GO` commit | `maulBind` | `maulBind` | picker: `carry` | `maulPush` → speed-normalised `run` |
| `WHEEL_AND_PEEL` commit | `maulDrive` | `maulBind` | peeler: `carry` | `maulPush` → speed-normalised `run` |
| `TRANSFER_TO_9` prepare | `maulBind` | `maulBind` | #9: `nineSquat` | `maulPush` + `idle` |
| `TRANSFER_TO_9` release | `maulBind` | `maulBind` | #9: `ninePass` | `maulPush` + existing `passSpin` one-shot |
| `UNPLAYABLE_SCRUM` | `maulBind` until hand-off | `maulBind` until hand-off | n/a | Existing `maulPush`, then existing scrum clips (`scrumBind`/`scrumShove`) |
| `TOUCH_LINEOUT` | `maulDrive` until hand-off | `maulBind` until hand-off | n/a | Existing `maulPush`, then current lineout clips |
| `PENALTY_AWARDED` | `maulBind` until release | `maulBind` until release | n/a | Existing `maulPush`, then existing restart movement clips |
| `TRY_AWARDED` | `maulDrive` until `scoreTry()` hand-off | `maulBind` | n/a | Existing `maulPush`; preserve current rule that a maul try does **not** play the open-play dive clip |

No `maulPeel`, `maulWheel`, collapse, throw, or new animation asset is proposed.
The visible distinction comes from the existing state/clip vocabulary and the
existing renderer mapping, not a renderer change.

## 3. Approved review decisions

1. The `0.55` binding credit / `0.45` commit range and the resulting 2/3/4
   commit thresholds across the current difficulty table are approved.
2. Alternation is required for a valid A/D commit; repeated direction does not
   earn a second commit.
3. The three attacking exits (`PICK_AND_GO`, `WHEEL_AND_PEEL`,
   `TRANSFER_TO_9`) and deterministic timeout fallback are approved.
4. Defensive contest control uses the existing use-it/stall law path rather
   than an instant turnover.
5. The state/clip map is approved, including the deliberate reuse of
   `maulBind`/`maulDrive` → `maulPush` and `ninePass` → `passSpin`.

Approval was received before implementation. The live code now follows this
contract; any future change to the pure input boundary, threshold table, named
exit set, or existing-clip mapping requires a fresh human review.
