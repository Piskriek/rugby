# SENIOR PLAYBOOK — how work lands on this repo

Written 2026-09-06 at the end of the breakdown/grapple/boot session. This is the
document a session should read before it opens a file, and the one a reviewer reads
before they approve one. It replaces tribal knowledge with a gate and a small number
of sentences, because every rule here is a rule that cost a day to learn.

## 1. The verdict is one command

```
npx vite-node scripts/gatecheck.ts          # full: 17 harnesses + tsc + vite build
npx vite-node scripts/gatecheck.ts --fast   # the same minus build and the rule audit
```

`scripts/gatecheck.ts` shells out to the real harnesses, reads their real exit codes,
quotes their own headline numbers, and exits non-zero if anything is red. It also
sweeps `scripts/` for files that *can* fail but are not wired into the verdict
(`--orphans` prints the full list) — an instrument nobody runs is an instrument that
is already deleted, it just hasn't been told.

**No merge with a red line. No green achieved by weakening a check.** If a check is
wrong, fix the check and say in the commit body what it used to assert, why that was
wrong, and what it asserts now. Three checks in this session were genuinely wrong
(§4), and each was rewritten with its measurement attached rather than deleted.

## 2. What must not break

- **`render/retro.ts`, `render/coronal.ts`, `render/rig.ts` are frozen.** They are the
  art contract; the stand-in bodies and the 2D fallback derive their silhouette from
  them. If a task seems to require editing them, the task is misframed — raise it.
- **Presentation never writes engine state.** `src/render/**` may read `Director`
  state every frame and must not mutate it. The one exception is a documented
  presentation-only field on the state (e.g. `players[].hand`, `strip`, `mud`), which
  exists precisely so the rig does not have to keep its own shadow copy.
- **Two position claims per frame is a TELEPORT.** The engine owns translation, the
  solver owns posture, and on STANDARD/FULL a body is *live-solved* while on LEGACY it
  is *replayed from a baked take* — never both in one frame. `placeBound()` clamps at
  the write site for exactly this reason; the audit's teleport line is `teleprobe`.
- **Commit and push only your own `arena/*` branch.** This clone is single-branch
  (`remote.origin.fetch` is `+refs/heads/main`), so a sibling branch is invisible to
  `git log` unless you fetch it. Before you push, `git fetch origin <your-branch>` and
  compare: on this session the pushed history held 10 commits the local clone did not,
  including an open-play calibration worth keeping. Merging it in was correct; a
  force-push would have silently destroyed a day of someone else's work.
- **Every number you write down is read off a labelled run.** No doc may contain a
  figure that was not printed by a harness on the tree it describes. The last time a
  "0.143 steals/ruck" baseline was carried in a comment, it turned out that number did
  not exist in the build being tuned.

## 3. Measure, then opine

Six traps, each bought with a wrong conclusion:

1. **A `new Promise` whose executor awaits an `async` callback can never reject.**
   That was the 66% stall: the overlay's `catch` could not fire, so "still loading"
   and "blew up" rendered identically. Any staged boot step must be unable to sit
   pending — settle on every path or race it against a budget that degrades visibly.
2. **`vite.config.ts` `server.headers` is header-name → value, not path → header.**
   A path as a header name throws on *every* request, and the whole preview answers
   500. A config file that typechecks is not a config that serves: verify by asking
   the running server for `/` and the asset.
3. **A force multiplied by `sideForce(crew)` is invisible arithmetic.** That term is
   zero in a large share of rucks, so the coefficient you "tuned" never applied.
   Contest terms enter additively or not at all.
4. **The gate must read the state the engine read.** Two probes asserted the jackal law
   against `crew.length`, while the engine judged plan presence — the resulting "law
   violation" was real to the harness and fictional in the game. Worse, `resultWhy` is
   written by the same call that destroys the ruck, so the verdict is only reachable
   from the snapshot you took *before* the step.
5. **A proxy render is not the browser.** `sceneaudit` composites through Skia with a
   WebGL stub: it proves geometry, coverage, framing and that a man is big enough to
   read. It cannot show a shader gradient, a shadow map or an IBL contribution, so it
   must never be used to "fix the lighting" — the flat yellow band and the soft-green
   field in its PNG are the stub, not the product. Ask it about the things it can see.
6. **`tallest px` must be measured after the lens settles.** Let `updateCamera` run
   ~45 × first; a mid-ease frame read 17 px where the same build's settled frame reads
   19-21 px, and the difference is the entire argument about camera tightness.

## 4. Judgement calls this session made, and their receipts

- **Hands own the ball, `latch.ts` owns the man.** A grapple that also drags a pelvis
  is two systems fighting over one body; that pairing is the reason the contest can run
  at 2.07 µs/frame for twelve men with 0 B/frame of heap.
- **The strip meter is the only route to a turnover** — plus the numbers law, plus the
  hold time. An axis that can win the ball by itself produced a steal with 0.00 s of
  contact on the ball, which is a man lying on the ball, not playing it.
- **Posture-keyed reach (`REACH_M`/`GRIP_M`)**: 1.35 m standing, 0.55 m on the deck,
  nothing on the run-in. One radius for all three is physically wrong and made the
  first version a coin flip with better graphics.
- **The lane's time is priced on its fastest frame**, not its mean (`LANE_SAMPLES = 16`).
  This is what took the worst per-frame step from 0.273 m to 0.207 m against a 0.25 m
  gate — a bowed run-in that averaged fine and overshot per frame.
- **Coefficient swept 1.2 → 3.0 on two seeds; shipped 1.2.** 1.8 also cleared every
  gate and began paying more steals than a stranded ruck has bodies for; ≥2.4 broke
  arrival and window. A tuned number without a sweep table attached is a guess.
- **Three checks were rewritten because they were wrong, not because they were red**:
  the steal-rate gate (crew list → `ruckPresence`, and a fabricated 0.22 ceiling → the
  coin-flip ceiling with the ledger/episode split disclosed on the line), the
  "cleanout breaks the grip" exclusion (it required the contact it was denying), and
  the deaf-jackal-lane gate (it counted rucks that ended before any slot was released).

## 5. The one open regression, and what closing it means

`audit-cli 120 3 1` went **FAIL 2 → FAIL 5**, all `LAW-66` (a 7 m hole in the defensive
line where it was 5.9 m). Both parents read 2 separately, so it is an interaction: the
inherited first-receiver calibration makes the attack recycle faster, while the new
clearout lanes keep defenders off the line longer, and LAW-66 scores the open-play
spacing rule against a line that is still folding out of a ruck. Bisected by
measurement: the handling-error rate is innocent (5 either way); reverting the
first-receiver gate buys back two of the three. It is disclosed at the call site and in
`HANDOFF.md` §11 rather than hidden by reverting someone's accepted calibration.

**The fix is a fold-back budget, not a slower attack and never a weakened LAW-66.** A
defender released by a ruck should be re-anchored to the line on a clock the audit can
measure; the brief is in §6(a).

## 6. Three briefs to hand out, each with its acceptance test

A session is given one brief, not a wishlist. Each of these is scoped so that "done" is
a number, and each is written so that failing it is visible.

**(a) Fold-back budget after a ruck** — *owner: engine*
Every defender whose lane ends at a ruck gets a bounded return: a target point on the
corrected line within `k` seconds, `k` priced by his distance, with the line's spacing
contract respected. Acceptance: `gatecheck --only audit` at seeds 1-6, difficulty 3,
120 s — `LAW-66` failures at or below the pre-merge 2 per run, `teleprobe` still 0,
`breakdownprobe` still 10/10 (arrival spread ≤ 0.9 s mean), and no steal-rate movement
beyond ±0.02/ruck. Explicitly out of scope: changing `trace.ts`'s LAW-66 population or
the 4.6 m floor.

**(b) A broadcast camera that never loses the ball** — *owner: presentation*
The idea is right and it came from the sibling `arena/01a072d0-rugby`
(`dd12955`), which rebuilt the engine to get it — do not rebuild anything to get it.
Implement inside `src/game/engine/camera.ts`: the ball must be inside the frustum
every frame of a kick, breakaway and ruck recycle, subject to the UX-23/UX-24 caps on
lens tightness (which exist because a camera that chases too hard induces motion
sickness and hides the shape of the defence). Acceptance: `sceneaudit` "ball is in the
frame" passes across 20 sampled moments in 3 seeds (currently 1 gate at 1 moment),
`camaudit 90 "1..6"` FAIL count does not rise above the shipped `1.6×` baseline of 31,
and `tallest px` at 640×360 stays ≥ 19.

**(c) Make the rig cheap to fetch, not just fast to parse** — *owner: assets*
`public/assets/models/rugby_player.glb` is 6,289,732 B. The dev server serves it in
11 ms warm and `load()` parses it in ~3.3 s, and the boot now preloads it at document
time and caches the bytes across StrictMode's double mount — so what is left is the
user's link, which is the only part of "the session is slow" that no amount of code
fixes. Acceptance: a quantised/meshopt-compressed rig under ~2 MB with `sceneaudit`
19/19 unchanged, `bootcheck` ALL PASS, and the `tallest px`/silhouette numbers
identical; the stand-in ladder must remain intact so a missing asset is still an art
loss and not a game loss. Do not touch `retro.ts` to make a number fit.

## 7. Reviewing a sibling branch, which is most of the job

Both sibling sessions had the same base and the same prompt, and both solved it by
starting a parallel app: `arena/01a072ce-rugby` added `rugby-2026/` (49 files, 8,001
insertions, its own `vite.config.ts` and `tsconfig.json`), and
`arena/01a072d0-rugby` added `src/rugby/` (31 files, 4,815 insertions, 304
deletions) with a second renderer and its own engine.

The verdict a reviewer should reach, and the one I would defend in a meeting: **the
code inside those folders is not mergeable as-is, not because it is poor, but because
it discards the thing the project is.** This repo is a design-document-driven engine —
`SPEC_01`…`SPEC_24`, the law ledger, `audit.ts`'s per-frame rule sweep (5,324 PASS lines in one 120 s match), and the 17 harnesses.
A parallel app has none of that standing behind it, so it cannot be *shown* to be
correct; it can only be trusted. Two engines in one repo also means the frozen art
contract, the audit and the boot ladder all have to be rebuilt before the new one is
even reviewable. That is the real cost of the fork, and it is paid in exactly the
currency this project measures.

What is worth taking across, and should be briefed as work against the existing
engine: the never-lose-the-ball camera (§6b, already above), their `sanityFalls` /
`sideScan` habit of writing a disposable scan per question, and — from the fork's
`7` attribute model — the reminder that attributes should drive *when* a man arrives,
which the plan's lanes already do and which must not regress into a coin flip.

If a sibling insists its engine is the future, the review question is a single one:
`npx vite-node scripts/gatecheck.ts`, run against *their* tree. A branch that cannot
produce a green scoreboard in the harnesses that already encode this game's laws has
not replaced anything; it has only avoided the evidence.
