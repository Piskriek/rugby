# SPEC_15 — The referee: design for review

> **STATUS: REVIEWED, RULED ON, AND SHIPPED.**
> This document is the design as submitted for review on `d850031`; it is kept
> verbatim below as the record of what was proposed. The three rulings are:
>
> 1. **Clips** — approved as proposed: a new `render/refClips.ts`, merged at
>    load, handoff file untouched.
> 2. **Anchor modes** — approved as proposed: one renderer, `REF` for law calls
>    and `SITE` for the control affordances.
> 3. **Personality** — **dropped entirely.** SPEC_12 killed the vague referee
>    strictness slider in favour of deterministic orthogonal toggles, and a
>    personality system conflicts with that. He enforces the game exactly as the
>    toggles dictate.
>
> What was actually built and measured — including three defects the
> measurements caught and the one number that is honestly not zero — is in
> `SEASON_2_QUEUE.md`, `## VERDICT — SPEC_15`.

---

**Status at time of writing: DESIGN ONLY. No AI steering written, no bubble
built.** This document answers the two questions asked and stops for a human
ruling on three points flagged below.

Everything here is measured against the code as it stands on `2a02f9e`, not
against the ticket's assumptions. Two of those assumptions turn out to be wrong.

---

## 0. What is actually there today

| thing | state |
|---|---|
| the ref entity | `d.actors[30]`, `team 'REF'`, `num 0`, build `BUILDS.REF` (h 1.84, shW 0.48) |
| how he moves | **by assignment, every frame** — `ref.rx = f.x*0.4 + 8; ref.rz = f.z - dir*11` |
| his clips | `renderClip = refSignal > 0 ? 'refSignal' : 'refReady'` |
| what those map to | **both `return 'idle'`** (`mapAction`, scene.ts:125 and :142) |
| his facing | `ref.rf` is **never written** — it stays at the constructor's `1`, and `puppetFor` reads `face: a.rf > 0 ? 0 : Math.PI`, so he is pinned facing `0` forever |
| his derived speed | `puppetFor` computes `vx = (a.rx - pg.lx)/dt`. He teleports, so **every focus jump spikes his speed and whips his facing** |
| the call pipeline | `lawCall()` (engine/laws.ts:112) already sets `refSignal = 1.8`, `refSignalText`, blows the whistle, calls `d.say(call)`, and explains each law once via `showHint` |
| the HUD strip | `REFEREE: {d.refSignalText}` in `ui/MatchView.tsx` |
| floating world text | **14 `worldLabel` calls** in scene.ts — 4 are instructions, 10 are telemetry |

**The single most useful fact:** `lawCall()` already does everything a bubble
needs. The bubble can hang off it directly, which makes the proposed gate
("every `lawCall` produced a bubble within 0.2 s") true by construction rather
than something to test for.

---

# PHASE 1 — THE ACTOR

## 1.1 Where he stands

A target point per phase, expressed as **depth behind the ball along the attack
axis** plus a **lateral side**. `dir` is the attacking direction as already used
throughout the engine.

| phase | depth behind ball | lateral | notes |
|---|---|---|---|
| OPEN_PLAY | 10–14 m | blind side — opposite the attacking width | trails play, never leads it |
| BREAKDOWN / RUCK | 5–6 m | the side the ball will exit | never in front of the hindmost foot |
| SCRUM | 3 m, square to the tunnel | tunnel side | rotates behind the scrum as the ball is played |
| LINEOUT | 5 m infield | level with the mark | watches the gap |
| MAUL | level with the ball, 6 m out | open side | |
| KICK | 12–18 m behind the receiver | off the chase line | so he sees the catch and the contest |
| TRY / FANFARE | ~8 m behind the posts | centred | |

**The one constraint that matters more than the table:** he is never in front of
the ball. Clamp every target so `(ref.z − ball.z) * dir <= −1`. A referee
standing upfield of play is both wrong and physically in the way.

The blind side is computed, not hardcoded: take the mean `x` of the attacking
backs (or the ball's `x` relative to the ruck) and put him the other side. The
current code's `+8` is a *fixed* +x offset, which is why he drifts into the
defensive line whenever play goes left.

## 1.2 How he moves — and why not `steer()`

The ticket says "steer him with the same `steer()` the thirty use". I recommend
against it, and want a ruling:

* `steer(p: Live, dt, sprint, ...)` takes a `Live`. The ref is not one — he has
  no team A/B, is not in `d.live`, and has no shirt number.
* Putting him in `d.live` would make every loop in the game iterate him:
  defence, offside sampling, pass options, `separate()`, tackle selection. He
  would be counted as a defender. That is a large blast radius for a cosmetic
  actor, and the SPEC_14 tackle change shows how easily those loops surprise
  you.

**Proposed instead:** a new `engine/referee.ts` holding

```ts
interface RefState {
  x: number; z: number; vx: number; vz: number;
  face: number;                 // heading he is LOOKING, not travelling
  tx: number; tz: number;       // this frame's target
  movedBy: 'ref';               // T-02 ownership tag
  clip: string; clipT: number;
}
```

integrated with the same primitives the thirty use — acceleration limit, max
speed clamp, arrival easing — and tagged `movedBy = 'ref'` so the ownership
contract covers him explicitly and the audit can prove nobody else writes him.
Speeds: walk 1.6, jog 4.2, run 7.0 m/s; he only runs when he is more than 12 m
from his target, so he reads as jogging most of the match.

## 1.3 How he tracks the ball

He faces the **ball**, not his direction of travel — a real referee backpedals
and side-steps while watching play.

```ts
ref.face = Math.atan2(ball.x - ref.x, ball.z - ref.z);
```

Then, when the angle between his travel heading and `face` exceeds ~60°, the
gait becomes `shuffle` or `strafe` instead of `jog`/`run`. Those clips already
exist (`shuffle`, `strafe` in CLIPS) and `resolveGait` already understands
lateral motion, so a backpedalling referee comes almost free.

This also fixes the facing bug at its source: `a.rf` gets written every frame,
so `puppetFor`'s `face: a.rf > 0 ? 0 : Math.PI` stops pinning him at zero.

## 1.4 How animation states are driven

Speed → gait, with a signal override:

```
speed < 0.5        -> idle
0.5 – 3.0          -> walk
3.0 – 6.0          -> jog
> 6.0              -> run
refSignal > 0      -> the matching one-shot, overrides the gait
```

**Locomotion needs no new clips** — `walk`, `jog`, `run`, `strafe`, `shuffle`,
`idle` all already exist in `CLIPS`. Delete the two dead `case … return 'idle'`
lines at scene.ts:125 and :142 and the ref animates on day one.

**The signals do need authoring:** `refWhistle` (0.6 s), `refSignalPenalty`
(1.0 s, arm at 45°), `refSignalAdvantage` (both arms), `refSignalScrum`,
`refSignalTry`, `refCard` (reach to the pocket).

> **RULING NEEDED (1).** `clips.ts` is one of the verbatim handoff files
> ("No renderer rewrite — the papercraft files are copied verbatim from an
> outside spec; only approved pose edits"). Authoring six new clips means
> editing it. My recommendation: define the referee one-shots in a **new**
> `render/refClips.ts` that imports the pose vocabulary and exports a
> `REF_CLIPS` map merged into `CLIPS` at load, leaving the verbatim file
> untouched. Say the word if you would rather I edit `clips.ts` directly.

## 1.5 The teleport problem solves itself

Because `puppetFor` derives velocity from position deltas, the current teleport
is what spikes his speed and whips his facing. Continuous steering removes the
cause; no change to `puppetFor` is needed.

---

# PHASE 2 — THE SPEECH BUBBLE

## 2.1 The queue

```ts
type BubbleKind = 'CARD' | 'PENALTY' | 'LAW_CALL' | 'NARRATIVE' | 'NUDGE';
interface Bubble { text: string; kind: BubbleKind; ttl: number; at: number; site?: { x: number; z: number } }
```

* `d.refSay(text, kind, ttl, site?)` pushes; priority `CARD > PENALTY >
  LAW_CALL > NARRATIVE > NUDGE`.
* One bubble renders at a time — the head of the queue. A big call preempts a
  nudge; the queue then drains in priority order.
* Fed from `lawCall()` (already has the text and blows the whistle), `card()`,
  and the narrative events.

## 2.2 The anchor

Projected exactly like `worldLabel`, which is already the established in-world
text mechanism:

```ts
const y = build.h * FIGURE_SCALE + 0.8;      // 1.84 * 1.65 + 0.8 ≈ 3.84 m
const p = project(cam, v, ref.x, y, ref.z, jx, jy);
```

Two details worth stating explicitly:

* It **scales with the figure**. SPEC_14 made the players 1.65× taller, so a
  hard-coded 2.4 m (the ticket's number) would put the bubble at his chest.
  3.84 m also sits comfortably inside the range the existing labels already use
  (3.1–4.9 m).
* **Screen clamping.** If he is behind the camera, hide the bubble. Otherwise
  clamp the projected point inside the frame with a margin so the card never
  rides off the edge, and keep the tail pointing at his head — the tail has to
  follow the true head point even when the card has been clamped, or the bubble
  detaches from him visually.

## 2.3 The art

* Reuse `paperCard()` from `paper.ts` — torn-paper edge, fold tab, jitter — so
  the bubble is unmistakably the same papercraft language as the figures rather
  than a UI rectangle pasted over the pitch.
* A tail: a small triangle from the card's bottom edge to the head point.
* Type: the same clamped scaling `worldLabel` uses,
  `size = clamp(p.sc * 0.26, 9, 16)`, so it stays legible at distance and stops
  growing up close.
* Kind → colour: card red, penalty red/amber, law call cream, nudge yellow.

## 2.4 What gets deleted — the full list

All 14 `worldLabel` calls in `scene.ts`, classified:

**INSTRUCTION — becomes a bubble (4)**

| line | text | where |
|---|---|---|
| 546 | `USE IT` | maul |
| 634 | `SECURED` | breakdown |
| 636 | `COMMIT - SPACE` | breakdown, jackal on |
| 638 | `A/D - CLEAROUT` | breakdown |

**TELEMETRY — stays in the world (10)**

| line | text |
|---|---|
| 427 | `PHASE n · +gained m · n m TO GO` |
| 476 | goal distance · angle · probability |
| 480 | kick profile label |
| 481 | `HANG … · APEX … · DISTANCE …` |
| 524 | `+gained m · speed m/s · n m TO GO` |
| 533 | contest · exit · stall · WHEEL |
| 653 | `+gain m · PHASE n` |
| 681 | `DRIVE … cm · WHEEL …°` |
| 714 | `APEX … m · MARGIN … cm` |
| (+1) | — |

The ticket implies a much larger purge ("plus kick/maul/scrum labels"). Measured,
those are all telemetry — live numbers a player reads during a kick or a scrum.
Turning `HANG 3.2s · APEX 21 m` into a referee bubble would be worse, not
better. **Four labels move, not fourteen.**

> **RULING NEEDED (2).** The four that move are *control affordances*, not
> narration — `COMMIT - SPACE` and `A/D - CLEAROUT` tell the player which keys
> to press, and they need to be at the point of interaction. Anchoring them
> above a referee who can be 15 m away and off-screen is a UX regression.
>
> My recommendation: **one bubble renderer, two anchor modes.**
> * `REF` — law calls, cards, penalties, narrative. Anchored above his head.
> * `SITE` — the four affordances. Anchored at the event (the ruck/maul
>   contact point), same paper card and tail, so the floating *text* is gone
>   and replaced by a world-space bubble, but the prompt stays where the player
>   is looking.
>
> If you want everything literally on the referee, say so and I will do that
> instead — but I would be shipping a known regression without saying it.

## 2.5 Personality — the option does not exist

The ticket says: "The existing `referee` option (THE WHISTLER / THE BALANCED /
LET IT FLOW / THE TECHNICAL) drives bubble wording and animation timing."

**There is no `referee` option.** The full `OPTION_ITEMS` list is `halfLength,
difficulty, weather, pitch, wind, timeofday, offside, offsideAiClean, knockOn,
fwdPass, advantage, ruckLaw, firstReceiver, maulLaw, sinbin, cards, subs,
scrumFeed, scrumWaggle, ruckWaggle, control, spaceAction, showControls, radar,
autoReplay, crt`. Nothing referee-personality shaped; a case-insensitive search
for "whistler", "let it flow" and "the technical" across `src/` returns nothing.

> **RULING NEEDED (3).** (a) Create the four-value `referee` option and wire it
> to bubble wording and signal timing — cheap, and it is what the ticket wants,
> but it is *new* work rather than wiring. (b) Derive his personality from the
> RULES options already there (`offside` STRICT/LENIENT/OFF, `advantage`,
> `cards`, `sinbin` strictness) and skip the new setting. (c) Both.

## 2.6 Verification

* **Trace field `refBubble`** — `{ at, text, kind, refX, refZ }` per bubble,
  joining the existing `refereeSignal` field in `trace.ts:371`.
* **Audit rule:** every `lawCall` produced a bubble within 0.2 s. Because the
  bubble is enqueued inside `lawCall()` itself, this should be true by
  construction — the audit then proves no code path bypassed it.
* **Families to watch:** `HINT`, `BANNER`, `CONTEXT` — these consumed the text
  that is being removed and must not regress.
* **Gates:** 9/9, no watchdog trips, and the known SPEC_14/T-74 camera failure
  on seed 1 is expected and unchanged.

---

## Not done, per the halt

No `engine/referee.ts`, no steering integration, no `REF_CLIPS`, no bubble
renderer, no `worldLabel` deletions, no trace field. The next commit starts with
15-a (steering + facing + ownership tag) once the three rulings are in.
