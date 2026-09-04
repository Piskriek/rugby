# SPEC_12 — DESIGN FOR REVIEW

**Status: design only. No engine code and no menu code has been written.**
This answers the brief: (1) sync and read SPEC_12, (2) design the toggles and the
Force-AI-Clean override, (3) design the enforcement engine, (4) halt for review.

Everything below is grounded in the code as it stands at `0a80c8e`. Where the queue's
spec and the code disagree, the disagreement is stated, not smoothed over.

---

## 1. SYNC — what SPEC_12 claims, and what the code actually says

| queue §2.1 / §2.2 claim | verified? | note |
|---|---|---|
| `OFFSIDE_EPSILON_METRES = 0.35`, `OFFSIDE_SUSTAINED_SECONDS = 0.30`, `FORMATION_RESET_SETTLE_SECONDS = 0.75` | ✅ | `director.ts:406-408` |
| `OffsideWindow` with per-shirt tracks, one whistle per window, half-plane test | ✅ | `director.ts:343-351`, `1363` |
| Two hooks: ruck (breakdown) and reset (open) | ✅ | `breakdown.ts:278`, `open.ts:249` |
| `formationIntegrity` exposes offside diagnostics | ✅ | plus `recoveryEpisodes`, used by the recovery clock |
| **§2.2.1** the write is gated by `!== 0` | ✅ | `director.ts:1401` — `if ((this.options.offside ?? 0) !== 0) return false;` |
| **§2.2.2** coverage is two windows | ✅ | `OffsideWindow.kind` is `'RUCK' \| 'RESET'` and nothing else |
| **§2.2.3** one-sided | ✅ | every window hardcodes `defending` as the offending side |
| **§2.2.4** no prevention | ✅ | nothing anywhere consults a line before a mark is written |

**Two things the queue does not know:**

**(a) The REFEREE slider is dead.** `data.ts:403` declares
`{ id: 'referee', values: ['THE WHISTLER','THE BALANCED','LET IT FLOW','THE TECHNICAL'], def: 1,
note: 'Strictness drives penalty frequency, card threshold and advantage length.' }` — and
nothing in `src/game` ever reads `options.referee`. It is a fourth dead control, the same
species as T-70's identically-zero drift term. I grepped every `options.*` read in the engine:
the only RULES options actually consumed are `advantage` (`laws.ts:53`) and `fwdPass`
(`open.ts:546`). **This is the decision that shapes everything else** — see §2.4.

**(b) The funnel does not die at the option gate.** The queue diagnoses the report as "the
option is binary and the write is gated to one value". It is, but the default *is* `0`, so the
whistle is nominally live in every match. Measured, 200 s × seeds 1/7/13
(`scripts/spec12probe.ts`, read-only):

```
  seed   ruckWin  resetWin   eligible  breaching  episodes  whistles  recoveries  pens
     1        47        43       1530         84         0         0           3     7
     7        38        36       1118         79         1         1           1     5
    13        41        40       1308         47         0         0           0     5
  TOTAL      126       119       3956        210         1         1           4    17

  FUNNEL: 3956 eligible samples → 210 past the line (5.31%) → 1 sustained episode → 1 whistle
```

Players are offside **5.31 % of the time**. The law is lost between *past the line* (210
samples) and *sustained* (1 episode) — a 210:1 collapse. The option gate is real but it is not
where the body is buried.

**Why it collapses — the window lifetime defect.** `startRuckOffsideWindow` mints a new window
every time `this.observedRuck !== s`, i.e. **once per ruck**. Rucks form every ~1.6 s of engine
time (126 in 200 s). Each new window starts with an empty `tracks` map and
`FORMATION_RESET_SETTLE_SECONDS = 0.75` of grace, so a window's enforceable life is under a
second — and a man who is persistently offside across four consecutive rucks starts from zero
four times. `closeOffsideTrack` only fires inside `evaluateOffsideWindow`, so the tracks dropped
when a window is replaced are not even counted as recoveries (4 recoveries against 210 breaching
samples). **A design that only adds lines and toggles will still produce ~1 whistle a match.**

---

## 2. PHASE 1 — THE TOGGLES

### 2.1 Two axes, not three modes

The brief names three toggle values — **Strict / Lenient / Off** — and a separate **Force AI
Clean** override. The queue (§2.3) instead specified one enum with `AI CLEAN` as its third
value. The brief's shape is better, because the two questions are genuinely orthogonal:

> *How fussy is the referee?* and *is the AI allowed to infringe?*

Three modes cannot express "Lenient + AI clean" or "Strict + AI may infringe", and the second
of those is the configuration most players will want. So:

```
options.offside        : 0 = STRICT | 1 = LENIENT | 2 = OFF        (def 0)
options.offsideAiClean : 0 = NO     | 1 = YES                       (def 0)
```

and the queue's enum maps onto it exactly, so no behaviour in §2.3 is lost:

| queue mode | this design |
|---|---|
| `0 OFF` | `offside = 2` |
| `1 ENFORCE` | `offside = 0` (Strict), `offsideAiClean = 0` |
| `2 AI CLEAN` | `offside = 0` or `1`, `offsideAiClean = 1` |

`offside = OFF + offsideAiClean = YES` is legal and meaningful: nobody is ever penalised, but
the CPU still behaves as if the law existed. That is the "clean rugby, no whistles" setup, and
it falls out for free instead of needing a fourth mode.

### 2.2 What Strict and Lenient actually change

Five knobs, one profile table. Every value is a named constant with the reason in a comment, in
the house style — no magic numbers at the call site.

| knob | STRICT | LENIENT | what it is |
|---|---|---|---|
| `epsilon` | 0.35 m | 1.00 m | how far past the line counts as past it |
| `sustained` | 0.30 s | 0.60 s | how long the breach must persist |
| `settle` | 0.75 s | 1.20 s | grace while the line is being drawn |
| `materialRadius` | ∞ | 12 m | whistle only if the offender is within this of the ball |
| `retreatingGrace` | none | yes | a man running back onside is never whistled |
| `linesLive` | all six | RUCK, RESET, OPEN | technical set-piece lines are not policed |
| `sanction` | penalty | penalty, or scrum when accidental | see §3.6 |

`materialRadius` and `retreatingGrace` are the two that make Lenient feel like a referee rather
than a wider tolerance band: a flanker loitering two metres offside on the far touchline is not
the thing anybody wants a whistle for, and a man visibly sprinting back is the canonical
play-on. Both are measurable (distance to ball at the whistle; closing speed toward the line).

### 2.3 Where the values live

The option contract is `Record<string, number>` (`director.ts:536`), and `menus.tsx:399-410`
renders any option as a `◀ value ▶` cycle driven by `o.values`. A three-value option is a
one-line data change with **no UI work at all**:

```ts
{ id: 'offside', label: 'OFFSIDE', values: ['STRICT', 'LENIENT', 'OFF'], def: 0, cat: 'RULES', note: '…' },
{ id: 'offsideAiClean', label: 'FORCE AI CLEAN', values: ['NO', 'YES'], def: 0, cat: 'RULES', note: '…' },
```

Options persist per T-12 (saved to the browser, restored on load) and are seeded by
`gateConfig` from `OPTION_ITEMS[].def`, so both harnesses inherit them without change.

### 2.4 The dead REFEREE slider — a decision I need from you

`options.referee` claims to drive "penalty frequency, card threshold and advantage length" and
does none of it. Three ways forward; I am not picking for you, because each has a different
blast radius:

1. **Fold it in.** Make the offside profile *and* the card threshold *and* the advantage
   multiplier read one shared `REFEREE_PROFILE[options.referee]`, and let the OFFSIDE toggle
   override the offside row only. One strictness control for the whole referee; the dead slider
   comes alive. Largest change, best coherence.
2. **Leave it dead.** OFFSIDE is its own axis; REFEREE stays furniture. Smallest change, but
   the menu keeps advertising a control that does nothing, which is the UX sin the audit
   already flags elsewhere (UX-28, "verbs shown that are dead in context").
3. **Retire it.** Delete the option and its save slot. Honest, but it removes a promise from
   the menu.

My recommendation is **(1)**, deferred until after the engine lands, so the profile table has
real rows to share.

### 2.5 Force AI Clean — what "clean" has to mean

The gate is *zero AI episodes*, not *zero AI penalties*. Prevention therefore has to cover the
four ways a CPU player ends up across a line. The important design choice is that three of the
four are handled by **one placement pass**, not by patching each branch:

1. **Mark projection (the systemic override).** A single pass, after every formation write and
   before `steer()` integrates — one place, so it covers the dataset branch, the shape branch,
   the CPU planner branch, the hip and sweep branches, the convergers and the cover chase
   without any of them knowing about it. Every CPU player eligible against the live line has
   his mark projected onto the legal half-plane:
   `tz = clampOntoLegalSide(tz, lineZ, dir, epsilon)`.
   It is a labelled gate write (`think:offside-guard`), placed after the formation writers and
   before `separate()`, so T-02 single-writer ownership is preserved: each step moves a player
   once, in a named order.
2. **Separation awareness.** `separate(live, dt, gate, label)` (`intelligence.ts:215`) is the
   usual way a "clean" AI infringes — a shove, not a decision. It takes an optional line guard
   and re-projects *after* the shove (projecting before it would make overlapping pairs stick
   and re-collide every frame).
3. **Line movement.** The line moves when the ball leaves a ruck, at the put-in, at the throw.
   Because the projection runs every frame against the *live* line, retreat is automatic — the
   existing release beat stays the visible retreat and keeps its ownership, with no second
   mechanism to fall out of sync.
4. **Exclusions.** Never the carrier, never a man bound into the ruck/maul/scrum (his body is
   what *draws* the line), never a chaser — the existing `isFormationEligible`
   (`director.ts:1242`) already excludes sin-bin, down, carrier, beaten and any
   `CHASE|TACKLE|FIELD THE KICK` job, and the guard reuses it rather than inventing a second
   eligibility rule.

**Never snap.** If a CPU man is across the line anyway (a collision, a knock-back), he
*retreats at pace* — urgency, not teleport. The teleport gate is 0 and stays 0, and a
transient breach never matures into an episode because of `sustained`.

---

## 3. PHASE 2 — THE ENFORCEMENT ENGINE

### 3.1 One line registry, one owner

`director.ts` is already the largest file in the repo; the engine goes in a new
`src/game/engine/offside.ts` as pure functions over `Director`, matching how `laws.ts` and
`open.ts` are already split out. The registry is a table — adding a line is a data row, not a
new branch:

| kind | live when | line z | offenders | eligible |
|---|---|---|---|---|
| `RUCK` | `bd.ruckFormed` | hindmost foot of the **defending** ruckers (`sampleFormedRuckOffside` today) | defending, unbound | `isFormationEligible` |
| `RESET` | `releaseBeat` && `t < until` | `releaseBeat.z` | defending | as today |
| `SCRUM` | `scrim` && past the put-in | hindmost foot of the defending pack | backs + unbound forwards | excluding bound |
| `MAUL` | `ml` | hindmost foot | unbound | excluding bound |
| `LINEOUT` | `lo` && thrown | line of touch ± 10 m for non-participants | both | excluding the two lines |
| `OPEN` | `op` (ahead of the ball at a ruck/maul) | `focusPoint().z` | **both** | excluding the carrier |

Each row is `{ kind, live(): boolean, line(): { z, dir }, offenders(): Team[], eligible(): Live[] }`.
Detection stays one function over that row; the only per-kind code is the row itself.

Two derivations need a measurement before they are trustworthy rather than plausible, and I
would do that measurement first: the **scrum/maul hindmost foot** (which players count as "in"
and whether the line should be the foot or the ball) and the **lineout 10 m** (the line of
touch is lateral, so the non-participant line is a rectangle, not a half-plane — the existing
half-plane test needs a lateral term or the lineout row needs its own predicate).

### 3.2 The window-lifetime fix (this is the load-bearing change)

The window must be a property of the **phase continuum**, not of one ruck instance:

- Keyed by `(kind, possession, defending)` — not by a per-ruck serial. Consecutive rucks in the
  same possession keep one window, so a persistent offender accumulates.
- `settle` restarts only when the line **moves materially** (say > 1 m), not when a new phase
  object appears.
- Per-shirt tracks survive across rucks within the window; a man who leaves the eligible set is
  dropped without fabricating a recovery (the existing behaviour, and correct).
- One whistle latch per `(kind, window, offending team)` — never once per frame, never once per
  ruck.

Without this, §3.1's extra lines add coverage to a funnel that still collapses 210:1.

### 3.3 One verdict function, one writer

Everything that can whistle routes through a single pure decision, so the toggle cannot be
bypassed by a future branch:

```
verdict(line, breach, offender, profile, opts) -> 'OBSERVE' | 'WHISTLE' | 'SUPPRESS'
```

`OBSERVE` always counts the episode (diagnostics are never gated). `WHISTLE` is the only path
to `beginPenalty`. `SUPPRESS` is the Force-AI-Clean case for a CPU offender — the episode is
still recorded, because an AI that needed suppressing is exactly the thing the gate is looking
for, and recording it is what makes "0 AI episodes" an honest test instead of a tautology.

`evaluateOffsideWindow` keeps detection and the sustained clock; it loses the option read and
the `beginPenalty` call. Those move into the verdict function and a single whistle adapter.

### 3.4 What the whistle does today

For the record, the sanction path already exists and is complete
(`beginPenalty` → `lawCall` → `releaseAll` → advantage → `penaltyChoices`):

- `lawCall` (`laws.ts:83`) — whistle audio, `refSignal` banner, `penaltiesConceded++`,
  `d.say(call)`, and a one-time `LAW — …` hint.
- `beginPenalty` (`laws.ts:11`) — captures the mark at `focusPoint()` **before** `releaseAll()`
  (T-18: reading it after returned `{0,0}` and every penalty was taken from the centre spot),
  tears down the phase, runs the card logic, then sets `pendingPenalty` and the advantage clock.
- Advantage: `d.advantage = [1.2, 2.6, 4.2][options.advantage ?? 1]`; the director clears
  `pendingPenalty` if the non-offenders gain inside the window, otherwise `resolvePenalty()` →
  `penaltyChoices()` (shot / touch / scrum / tap).

So no new sanction machinery is needed — only the decision of *when* to fire it.

### 3.5 Both sides

`OffsideWindow.defending` is currently used as "the team that can offend". The registry row
owns `offenders(): Team[]` instead, and `evaluateOffsideWindow` iterates it. The human is not
exempt — under Strict, a human flankers' loitering is a penalty like anybody else's, which is
the point of the report. Force AI Clean constrains `!isHuman(team)` only, so the AI whistle
count is the one that goes to zero while the human's is untouched.

### 3.6 Lenient's accidental offside

Real law distinguishes an offside player who *plays* from one who is merely *there*: the second
is a scrum, not a penalty. Lenient can express this with one new `REFEREE_CALLS` entry
(`ACCIDENTAL_OFFSIDE: 'SCRUM — ACCIDENTAL OFFSIDE'`) routed to `startScrum` rather than
`beginPenalty`. **Caveat for the balance gate:** `lawCall` increments `penaltiesConceded` for
*every* call including scrums, so this does not reduce the PENALTIES PER MATCH benchmark —
it only makes the call honest.

---

## 4. TASKS, ORDER, GATES

| # | task | depends on |
|---|---|---|
| 12-0 | probe the scrum/maul hindmost foot and the lineout lateral term | — |
| 12-a | option values `['STRICT','LENIENT','OFF']` + `offsideAiClean`; delete `!== 0` | — |
| 12-b | line registry + the four missing lines | 12-0 |
| 12-c | window lifetime (phase continuum, moving-line settle, per-team latch) | 12-b |
| 12-d | verdict function + single whistle adapter | 12-a, 12-c |
| 12-e | both-sides offenders | 12-b |
| 12-f | Force AI Clean: placement guard + `separate()` line awareness | 12-b |
| 12-g | trace `offsideLineKind`; one audit rule per line family | 12-b |
| 12-h | Lenient accidental-offside scrum (optional, after review) | 12-d |

**Gates** (the queue's, plus the two the baseline forced me to add):

| gate | threshold |
|---|---|
| 9/9 `gates.ts` | unchanged; `encroach` stays 0, tackles ≥ 8/60 s |
| `OFF` | episodes unchanged vs baseline (≈210 breaching samples / 600 s), **0 whistles** |
| `STRICT` | OFFSIDE PENALTIES PER TEAM inside the board's 2..4 band; currently **0.3, LOW** |
| `FORCE AI CLEAN` | **0 CPU episodes**, 3 seeds × 3 difficulties, human episodes still counted |
| funnel | breaching → episode ratio must not collapse (baseline 210:1) in any mode |
| balance | PENALTIES PER MATCH stays inside 14..28 (today 19.7) — new whistles push it up |

The `FORCE AI CLEAN` gate needs a harness change: `gateConfig` sets `cpuA: cpuB: true`, so a
CPU-v-CPU match cannot distinguish an AI episode from a human one. I need a `humanConfig()`
variant (or a flag) that puts a human side on the park, otherwise "0 AI episodes" silently
becomes "0 episodes" and proves nothing.

---

## 5. RISKS AND QUESTIONS FOR REVIEW

1. **REFEREE slider** — fold in, leave dead, or retire (§2.4)?
2. **Strict by default?** `def: 0` makes Strict the shipped default. The board's offside band is
   2..4 per team per match, and Strict is the only mode that can plausibly reach it — but it is
   also the mode that will whistle a human who has played the last forty matches under a referee
   who never blows. Default Strict, or default Lenient with Strict one press away?
3. **The balance risk.** Offside penalties going 0.3 → ~3 per team adds ~5 penalties a match on
   top of today's 19.7. The ceiling is 28. If Strict overshoots, the fix is Lenient's
   accidental-offside scrum — but as noted that does not decrement `penaltiesConceded`. Should
   `lawCall` stop counting scrum calls as penalties conceded? That is a stats-semantics change
   and it moves `statsAudit.ts`, so it wants your word, not mine.
4. **`releaseAll()` on every offside.** `beginPenalty` tears the phase down. At a ruck that is
   correct; for a technical lineout or scrum offside it is a very heavy hammer, and at one
   whistle per phase continuum it could produce a stoppage feel. Worth a look once counting is
   visible — a free-kick-shaped sanction may be the better fit for the set-piece rows.
5. **The LINEOUT row is not a half-plane.** It may need its own predicate rather than a place in
   a half-plane registry; if so, the registry is a table of *predicates*, not of `z` values.
   Cheap either way, but it changes the shape of 12-b.
6. **Window lifetime is the load-bearing change (§3.2)** and it is the one piece of this design
   that is not in the queue. If you would rather land coverage and toggles first and measure the
   lifetime effect separately, say so — but the baseline says the whistle count will not move
   without it.

---

**Nothing in this document has been implemented.** Changed files so far this session:
`src/game/statsAudit.ts` (drift ceiling 4.0 m per your ruling), `src/game/director.ts` (silenced
the authored last-man warning), `INVESTIGATION_TICKETS.md` (T-69, T-70), and
`scripts/spec12probe.ts` — read-only, no engine behaviour touched.
