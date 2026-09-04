# SPEC_21 — MATHEMATICAL PROPOSAL

Covers Item 1 (3/4 foreshortening) and Item 3 (dive/tackle volume). Numbers are
measured from the live build, not assumed. **No engine code written.**

---

## ITEM 1 — 3/4 FORESHORTENING

### The defect, algebraically

The current transform, `coronal.ts:818`:

```js
ctx.transform(a.tq.narrow, 0, -Math.tan(a.tq.shear) * sg, 1, 0, 0);
```

is the matrix

```
        | n   -s·σ |            n = narrow,  s = tan(shear),  σ = ±1
  M  =  |          |
        | 0    1   |
```

Apply it to the spine, a vertical segment from the foot `(0, 0)` to the head
`(0, -h)` (screen-y runs down, so the head is negative):

```
  M · (0, -h)ᵀ  =  ( +s·σ·h , -h )ᵀ
```

The head moves **sideways by `s·σ·h`** while the feet stay put. The spine is no
longer vertical; it tilts by `atan(s)`. That is the Leaning Tower, and it is
inherent to the `c` term of the matrix, not a tuning error.

Measured, with `TQ_SHEAR_MAX = 0.26 rad`:

| facing | `s = tan(shear)` | head offset (h = 1.8 m) | tilt |
|---|---|---|---|
| 30° | 0.1488 | 0.268 m | 8.46° |
| 45° | 0.2418 | 0.435 m | 13.60° |
| ≥55° | 0.2660 | 0.479 m | **14.90°** |

### Why a shear was reached for, and why it is the wrong primitive

A shear *is* the correct 2D image of a 3D rotation — but only under an **oblique
(cavalier) projection**, where the depth axis maps to a slanted screen direction.
This renderer does not use one. `project()` in `retro.ts` is a **perspective
projection with a separate camera tilt**; depth is already consumed by `p.f`
and `p.sc`. Applying a cavalier-style shear *on top of* a perspective projection
double-counts depth, and the visible residue is the slant.

Under the projection actually in use, rotating a flat card about its own
**vertical axis** by θ does exactly one thing to its screen image: it
**foreshortens horizontally by cos θ**. Vertical extent is invariant, because the
rotation axis *is* the vertical. This is the ruling's `scaleX = cos(θ)`, and it
is correct.

### Proposed replacement

Keep the existing smoothstep ramp — it is measured, kink-free at 0, and already
tuned against `EDGE_IN = 55°` — and change only what it drives:

```
  a  = ang > 90 ? 180 - ang : ang            // unchanged, front/back symmetric
  t  = clamp01(a / EDGE_IN)                  // unchanged
  e  = t·t·(3 - 2t)                          // unchanged smoothstep
  scaleX = 1 - (1 - TQ_NARROW)·e             // == the existing `narrow`
  shear  = 0                                 // REMOVED
```

so the transform collapses from a shear-plus-scale to a pure scale:

```
        | scaleX   0 |
  M' =  |            |
        |   0      1 |
```

`M' · (0, -h)ᵀ = (0, -h)ᵀ` — **the spine is exactly invariant. Tilt is 0.00° at
every angle, by construction rather than by tuning.**

### On the floor, and why not literal `cos θ`

Literal `scaleX = cos(θ)` reaches **0.0000 at 90°** — the figure would collapse
to a zero-width line. It never actually gets there, because the SPEC_06 view
machine switches to the dedicated profile card at `EDGE_IN = 55°`, where
`cos 55° = 0.5736`. But that still means the front card narrows to 57% just
before the switch, against the profile card's own natural width — a visible
**pop at the hand-over**.

The existing `TQ_NARROW = 0.86` floor is the tuned answer to precisely that
hand-over, and it is already in the build. Retaining it keeps SPEC_06's
hysteresis table valid and changes exactly one thing this spec: the slant.

| facing | proposed `scaleX` | literal `cos θ` | tilt (proposed) |
|---|---|---|---|
| 0° | 1.0000 | 1.0000 | 0.00° |
| 15° | 0.9744 | 0.9659 | 0.00° |
| 30° | 0.9205 | 0.8660 | 0.00° |
| 45° | 0.8722 | 0.7071 | 0.00° |
| 55° | 0.8600 | 0.5736 | 0.00° |

The proposed curve tracks `cos θ` closely to ~20° (where the eye reads
foreshortening) and departs only near the switch, where the floor prevents the
pop. **If you prefer strict physical `cos θ`, say so** — it is a one-constant
change (`TQ_NARROW → 0`), but I expect a visible seam at 55° and would want to
re-run the SPEC_06 hysteresis check.

`TQ_SHEAR_MAX` and `tqSign` become dead once the shear is removed. `tqSign`
currently exists only to choose which way to slant; a symmetric scale needs no
side. Both should be deleted rather than left at zero, so no future reader
re-enables them.

**Note the interaction:** the kinetic lean at `coronal.ts:812` is *also* a shear,
and that one is **correct and must stay** — a player leaning into acceleration
genuinely does slant. Item 1 removes the 3/4 shear only. The two are currently
adjacent and visually indistinguishable in a still, which is likely why the
defect survived Season 3 review.

---

## ITEM 3 — DIVE / TACKLE VOLUME

### Measured: the ruled cause is too small

| clip | worst `sy` | + max footfall | height loss |
|---|---|---|---|
| `diveFront` | 0.9200 | 0.8648 | 13.5% |
| `tackleHit` | 0.9100 | 0.8554 | 14.5% |
| `scrumShove`/`scrumBind` | 0.9000 | 0.8460 | 15.4% (worst in system) |

**Maximum available compression is 15.4%.** A puddle it is not.

### Measured: where the volume actually goes

Composing the real `ctx` stack as matrices and measuring a 1.8 m spine and a
0.5 m shoulder span:

| state | spine | shoulders |
|---|---|---|
| upright, no squash | 1.800 | 0.500 |
| upright, squash | 1.557 | 0.541 |
| mid-fall 0.5 | 1.762 | 0.489 |
| **full fall** | **1.946** | **0.432** |
| full fall + 3/4 | 1.697 | 0.452 |

Length *increases* to 1.946 on a full fall; **width** drops 13.6% to 0.432.

### Why: rotation inside an anisotropically scaled frame

The stack is

```
S_fig · S_squash · H_lean · H_tq · R_fall
```

with `R_fall` applied **last**, i.e. innermost — the card is rotated, *then* the
result is squashed by the outer `S_squash`. Composition of a non-uniform scale
with a rotation does not commute:

```
  S · R  ≠  R · S      whenever  sx ≠ sy
```

Concretely, with `S = diag(sx, sy)` and `R = R(φ)`:

```
              | sx·cos φ   -sx·sin φ |
  S · R  =    |                      |
              | sy·sin φ    sy·cos φ |
```

The columns are no longer orthogonal for `sx ≠ sy` — this matrix contains a
**shear**, and its singular values are not `(sx, sy)`. The figure's own vertical
axis, once rotated by φ, is being compressed by a factor that varies with φ.
At φ = 90° the squash's `sy` (compression) acts along the figure's **length**
and `sx` (expansion) along its **thickness**: the axes have swapped. The squash
was authored for an upright figure and is silently reinterpreted as the figure
rotates.

The `+0.6·sTot` x-expansion makes this worse, not better: it is a
volume-preservation term for a *vertical* squash, and after rotation it inflates
the wrong axis.

### Fix 3a — rotate first (preferred)

Reorder so the rotation is **outermost** relative to the squash — the squash then
always acts in the figure's own frame, along its true vertical:

```
  S_fig · R_fall · S_squash · H_lean · H_tq
```

Equivalently, conjugate the squash into the rotated frame:

```
  S' = R(φ) · S · R(φ)⁻¹
```

Either form guarantees the squash's compression axis stays welded to the
figure's spine. Then, for **all** φ, the singular values of the squash factor
are exactly `(sx, sy)` — so the figure's own length and width are scaled by
known, bounded amounts, and the ±5% volume gate becomes provable rather than
tuned. The impact squash is *preserved* on dives, which is desirable: a body
hitting the turf should compress.

Risk: the stack is shared by all six views and by `drawPaperShadow`. The
`falling` block also translates about `q.hip` before rotating, so the reorder
must carry that pivot with it. **This is the larger change and I would want the
full gate sweep plus the fusion shot sheet before believing it.**

### Fix 3b — the ruling as written (fallback)

Gate the squash off while airborne/horizontal:

```
  if (q.fall > 0.15) → squash = undefined
```

Recovers the 13.5–14.5%, is one line, and cannot destabilise the other five
views. But it leaves the **0.500 → 0.432 width loss untouched**, because that
term comes from the composition order and not from the squash magnitude — with
squash disabled entirely, `R_fall` still sits inside `H_lean · H_tq`, which are
themselves anisotropic. **3b alone will not fully resolve the reported defect.**

### Recommendation

**3a**, verified against a volume gate: spine length and shoulder width within
**±5%** of nominal across the full `fall ∈ [0, 1]` sweep, all six views, all ten
builds. Fall back to **3b** only if 3a cannot hold the lying-art seam, and in
that case report the residual width loss as accepted debt rather than claiming
the item closed.

**Awaiting your ruling on 3a vs 3b before writing either.**
