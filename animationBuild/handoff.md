# HANDOFF — Papercraft Rugby Animation System

**To:** Codex (implementing agent)
**From:** The agent that built this animation/presentation layer
**Goal:** Drop this animation system into the rugby game with zero re-design work.
Everything below is **prescriptive**. Follow the recipes; do not re-derive them.

The system lives in four files (plus the HUD, which you can ignore):

| File | Owns |
|---|---|
| `src/render/paper.ts` | Paper material painters, **per-actor paper-view hysteresis**, character dataset (builds/squads/palettes), paper ball |
| `src/render/rig.ts` | Pinhole `project()` + broadcast/replay cameras |
| `src/render/clips.ts` | **ANIMATION DATASET**: `Pose` schema, clip keyframes, `sampleC`, blending, `actionClip` (the CLIP_MAP) |
| `src/render/coronal.ts` | The puppet renderers: front/back card, true side profile, lying cards, fall rotation, dispatch |
| `src/render/scene.ts` | Reference integration: sim → poses → views → depth-sorted draw. **Treat `Game.upPoses()` and `Game.render()` as the canonical wiring.** |

There is no other dependency. These files import only from each other.

---

## 1. The premise (do not violate)

1. Every player is a **flat 2D paper cut-out** standing in a 3D world. The actor root moves in 3D; the drawn card is a **billboard that always faces the camera**.
2. The paper **never** becomes a volumetric human. Depth/turn is expressed by **swapping which artwork side is shown**, never by 3D rotation of a body.
3. Therefore the old tricks are **deleted forever**:
   - ❌ `const sideOn = isSideOnCam(cam.yaw) && a.team !== 'REF'` (global side-on)
   - ❌ `sideWidthMultiplier(sideOn) => 0.34` (squashing the front puppet)
   - ✅ per-actor view from the actor's **own facing** vs the camera (`updatePaperView`)
   - ✅ a dedicated profile renderer (`drawSidePaper`)

---

## 2. Coordinate & unit conventions (source of most bugs)

- World: `x` east, `z` north(+)/south(−), `y` up. Metres.
- Heading angle `h`: facing vector = `(sin h, cos h)`. `atan2(vx, vz)` gives the heading of a velocity.
- Actor right-hand vector = `(cos h, −sin h)`.
- Inside the renderers everything is **local metres, y-up**, converted by
  `X(m) = m * sc`, `Y(m) = -m * sc` (screen y is down). `sc` = pixels-per-metre from `project()`.
- All joint channels are **radians** unless stated. `0` = limb hanging straight down,
  `+` = swings **forward**, `PI` = straight overhead. Elbow/knee flex are `0..~2.6` positive.
  Abduction `+` = away from the body centreline.

---

## 3. The `Pose` schema (22 channels)

Defined in `clips.ts`. `STAND` is the default/fallback pose.

| Channel | Meaning |
|---|---|
| `hip` | hip height above ground (m). Stand ≈ 0.94, crouch 0.6–0.8, jump peak ≈ 1.4, lying ≈ 0.22 |
| `lean` | torso pitch, `+` = fold forward (sprint ≈ 0.36, ruck ≈ 0.55) |
| `roll` | coronal tilt, `+` = tip to actor's right (screen-mirrored automatically) |
| `twist` | torso yaw about the spine (spin pass wind-up ≈ ±0.6) |
| `headP`, `headY` | head pitch (`+` down) / head yaw |
| `aL`, `aR` | shoulder pitch (0 down … PI overhead) |
| `abL`, `abR` | shoulder abduction (`+` out) |
| `eL`, `eR` | elbow flex |
| `lL`, `lR` | hip pitch (`+` thigh forward) |
| `adL`, `adR` | hip abduction (`+` leg out — used by strafe) |
| `kL`, `kR` | knee flex |
| `ball` | 0..1 ball clamped to chest |
| `ballSide` | −1 left arm carries … +1 right arm carries |
| `fall` | 0 upright … 1 fully on the deck |
| `fallD` | `+1` went forward (lands **face-down**) … `−1` went backward (**face-up**) |

---

## 4. Clips: format, sampling, blending

```ts
interface Key  { t: number;            // 0..1 normalised clip time
                 e?: 's'|'l'|'o'|'i';  // ease of the segment ENDING at this key
                 p: Partial<Pose> }    // only override what changes
interface Clip { dur: number;          // seconds per cycle (loops) or total (one-shots)
                 loop: boolean;
                 keys: Key[] }
```

- Eases: `s` smoothstep (**default**), `l` linear, `o` ease-out (explodes), `i` ease-in (dips/anticipation).
- **Loops wrap**: interpolation from the last key continues into key 0.
  → *Do not duplicate key 0 at t=1.* Seamless loops come free.
- **One-shots clamp**: after the last key the pose holds. Last key = the hold pose.
- Missing channels in a key inherit from the previous key, else `STAND`.

```ts
import { sampleC, lerpPose, smooth, actionClip, CLIPS } from './render/clips';
const pose = sampleC('sprint', u);   // u = normalised time, loops wrap / one-shots clamp
```

### 4.1 The per-actor, per-frame pose pipeline (copy this)

This is exactly `Game.upPoses()` in `scene.ts`:

```ts
// actor state you must persist: clipName, u, pose, blendFrom, blendT, blendDur
const spd  = Math.hypot(a.vx, a.vz);
let   act  = a.action;                       // sim vocabulary, see §6
let   lat: number | undefined;
if (act === 'shuffle') {                     // signed lateral speed in ACTOR space
  const cf = Math.cos(a.face), sf = Math.sin(a.face);
  lat = a.vx * cf - a.vz * sf;               // >0 = moving to actor's right
}
const choice = actionClip(act, spd, lat);    // { name, rate }  rate = cycles/sec
if (choice.name !== a.clipName) {
  a.blendFrom = { ...a.pose };               // seamless transition snapshot
  a.blendT    = 0;
  a.blendDur  = CLIPS[choice.name].loop ? 0.16 : 0.12;
  a.clipName  = choice.name;
  a.u         = 0;
}
a.u += choice.rate * dt;
const sampled = sampleC(a.clipName, a.u);
if (a.blendFrom && a.blendT < a.blendDur) {
  a.blendT += dt;
  a.pose = lerpPose(a.blendFrom, sampled, smooth(clamp01(a.blendT / a.blendDur)));
} else { a.blendFrom = null; a.pose = sampled; }
```

**Gait rates are speed-derived so feet match metres covered** (`actionClip` does this:
jog stride 2.1 m, run 2.9 m, sprint 3.6 m). Never hard-code a run rate.

### 4.2 Authoring rules for new clips

- **Weight:** dip `hip` on every contact frame (stride double-bob, landing absorb).
- **Anticipation:** an `e:'i'` dip key immediately before an `e:'o'` explode key
  (see `lineoutJump` t=0.16 → 0.42, `kick` t=0.34 → 0.58, `passSpin` t=0.3 → 0.55).
- **Fall clips must END in the lying hold pose** (`LIE_F` / `LIE_B` in `clips.ts`,
  exported through `lieFront` / `lieBack`). The fall→lying hand-off is a rotation
  (§7); matching end poses make it invisible. `tackled`, `diveFront`, `fallBack`,
  `getUpFront`, `getUpBack` all obey this. Copy the pattern.
- **Strafe/mirror:** author one side only, then `CLIPS.myMirrored = mirrorClip(CLIPS.mine);`
  (swaps L/R channels, negates `roll`/`twist`/`headY`/`ballSide`).

---

## 5. Paper views: per-actor, hysteretic (replaces global side-on)

```ts
import { updatePaperView, paperViewKey, resetPaperViews, PaperView } from './render/paper';

type PaperView = 'front' | 'back' | 'leftEdge' | 'rightEdge' | 'lieFaceUp' | 'lieFaceDown';

const key  = paperViewKey(actor.team, actor.num);      // STABLE per-actor key
const fx = Math.sin(actor.face), fz = Math.cos(actor.face);   // fallback: actor.rf
const view = updatePaperView(key, fx, fz, actor.x, actor.z, cam.x, cam.z);
```

Internals (already implemented — do not re-tune casually):
- angle = ∠(actor facing, actor→camera). Zones: **front < 35°**, **edge 55–125°**, **back > 145°**,
  dead zones between. Hysteresis: an actor leaves its zone only when the angle crosses the
  *outer* bound of the neighbour → no thrash.
- Left/right edge from the signed cross product; side flips only when `|sin(angle)| > 0.25`.
- State lives in a module-level `Map` keyed by `team+num`. Call `resetPaperViews()` on match reset.
- **Lying views are set by the sim, not by angles** (see §7). Never store a lying view in the map.

Screen-direction helpers you need when drawing (from `Game.render()`):

```ts
import { camRight } from './render/rig';
const [crx, crz]   = camRight(cam);
const dot          = fx * crx + fz * crz;          // facing projected on screen-x
const spinDir      = dot >= 0 ? 1 : -1;            // +1 = actor faces screen-right
const perp         = Math.abs(dot);                // 1 = broadside to lens
const gs           = clamp(Math.sin(cam.tilt) * 1.15, 0.42, 0.95);  // ground squash (lying)
const fore         = 0.45 + 0.55 * perp;           // lying body-axis foreshorten
const headDir      = spinDir || 1;                 // lying head screen direction
```

---

## 6. Sim action vocabulary → clips (the CLIP_MAP)

`actionClip(action, speed, lat?)` in `clips.ts` is the single mapping point.
Your sim only ever sets `actor.action` to one of these strings:

| action | clip | notes |
|---|---|---|
| `idle` | idle | breathing bob |
| `walk` / `jog` / `run` / `sprint` | gaits | auto-selected by speed inside `upPoses`; rate from speed |
| `shuffle` | shuffle **or strafe/strafeL** | strafe kicks in when `|lat| > 0.9` (square-to-target lateral movement) |
| `scrumBind` / `scrumShove` | bind / shove pump | shove is a loop; engage shake is sim-side |
| `jump` / `lift` | lineoutJump / lift | jumper + two lifters |
| `kick` | kick | approach→plant→strike→follow-through one-shot |
| `pass` / `catch` | passSpin / catch | release frame baked at t≈0.4 |
| `tackle` / `tackled` | tackleHit / tackled | tackler ring-and-wrap; carrier protect-and-fall (`fallD=+1`) |
| `dive` / `fallBack` | diveFront / fallBack | try dives / knocked backwards |
| `lieF` / `lieB` | lieFront / lieBack | hold poses while `down` |
| `getupF` / `getupB` | getUpFront / getUpBack | play once, then set `action='walk'` |
| `ruck` / `jackal` / `maul` | ruckCommit / jackal / maulPush | loops |
| `step` | step | sidestep one-shot (0.45 s), pair with a lateral velocity burst |
| `celebrate` | celebrate | loop |

---

## 7. Falling, lying, getting up (the seamless hand-off)

State per actor: `down: boolean`, `fallDir: ±1`, plus the pose channels `fall`/`fallD`
(which the clips drive — you only choose the action).

1. **Going down:** set `action = 'tackled' | 'dive' | 'fallBack'`. The clip ramps `fall` 0→1.
2. **While `fall` is in (0.01, 0.985)** `drawPaperActor` rotates the *standing* card about the
   **hip** by `fall * 90° * fallD * dirSign` (with a small thud wobble). `dirSign` is `spinDir`
   for coronal views and `+1` for edge views (post-mirror local +x is the facing side).
   You do nothing — this is internal.
3. **On the deck:** set `down = true` and `action = 'lieF' | 'lieB'` (by `fallDir`).
   The renderer then switches to the dedicated lying artwork:
   `view = fallDir > 0 ? 'lieFaceDown' : 'lieFaceUp'`
   (face-down shows the **back card with number**; face-up shows chest + face).
4. **Getting up:** `down = false`, `action = 'getupF' | 'getupB'`. `fall` ramps 1→0, so the
   rotation unwinds through the same pivot → seamless both directions.
5. In the view-selection step (§5) **skip `updatePaperView` while down**:
   `if (a.down || a.pose.fall > 0.985) view = lyingView; else view = updatePaperView(...)`.

---

## 8. Drawing an actor (the only draw call you need)

```ts
import { drawPaperActor, drawPaperShadow, PaperDrawArgs } from './render/coronal';

const pr = project(cam, view, a.x, 0, a.z);          // ground anchor
if (!pr) continue;
const args: PaperDrawArgs = {
  ctx, sx: pr.sx, sy: pr.sy, sc: pr.sc,
  view, pose: a.pose,
  pal: PALETTES[a.team], build: a.ch.build,
  skin: a.ch.skin, hair: a.ch.hair,
  num: a.ch.num, seed: a.seed,                        // seed = stable per-actor jitter
  carry: a.carry ? 1 : 0,                             // ball clamped
  carryStyle: a.carryStyle,                           // 0 two-hand cradle .. 1 clamp + fend
  ballSide: a.pose.ballSide, ballSpin: ball.spin,
  cap: a.ch.cap, tape: a.ch.tape,
  spinDir, gs, fore, headDir, depth: pr.f,
};
drawPaperShadow(args);   // contact shadow first (widens/softens with hip height & falls)
drawPaperActor(args);    // dispatch: front/back/edge/lying + fall rotation + carry overrides
```

Renderer behaviour you get for free (do not re-implement):
- **front/back:** hoop, collar, fold tabs, creases; face+fringe or hair+nape;
  **shirt number only on the back**; **arms painted behind the torso card in back view**
  (paper-layer occlusion).
- **edge (`leftEdge`/`rightEdge`):** true profile card — narrow torso strip + deltoid cap,
  dark far-side paper layer (one lit arm / one lit leg), profile head with nose wedge,
  forward lean rotating the whole card, stride with **rotated boots** (`footPitch`),
  ball clamped in front of the chest with the near forearm wrapping over it.
  Mirrored automatically by `spinDir`. **No chest, no number in edge view.**
- **lying:** ground-squashed (`gs`) and axis-foreshortened (`fore`) horizontal cards,
  distinct face-up / face-down layouts, rotated number on the back.
- **carry overrides** (`carryPose`): near arm wraps the ball; far arm either cradles
  (two-hand, low speed) or stiff-arm fends (`carryStyle` → 1 at sprint speed).
  Set `carryStyle = clamp01((speed - 3) / 4)` each frame for carriers.

### 8.1 Scene order & the ball

- Build a draw list of `{depth, drawFn}` for actors **and** the ball, sort by depth
  **descending** (far first), then draw. Shadow immediately before its actor.
- **Held ball:** do not draw a separate sprite at the hands; draw the world ball at the
  carrier's chest so depth-sorting occludes it correctly from behind:
  `ballPos = (h.x + sin(h.face)*0.26, 1.14, h.z + cos(h.face)*0.26)`.
  Loose/flying/pass ball: draw at its physics position with `ballPaper(ctx, x, y, r, spin)`
  plus a `shadowBlob` on the turf.
- Line width scales with depth: the renderers derive `lw = clamp(sc*0.021, 1.05, 3.2)`.

---

## 9. Feet: stride rotation (already implemented, keep it)

`footPitch(l, k) = clamp(0.52*l - 0.22*k, -0.55, 0.5)` — toe-up at heel-strike, flat at
mid-stance, heel-raise at toe-off, toe-down in swing. Used by:
- side profile: boot card rotated about the ankle (`rotPt`) + sole accent;
- coronal: boot height foreshortening + lifted heel + sole-plate flash when `pitch > 0.12`.

If you author clips with extreme `l`/`k` values, sanity-check the silhouette at contact —
the foot math assumes conventional gait ranges (`l` within ±1.4, `k` within 0..2).

---

## 10. Strafe (already implemented, keep it)

- Clip `strafe` (+ mirrored `strafeL`): body square to target, step-and-close footwork,
  guard arms, hop bob. Selected automatically by `actionClip('shuffle', spd, lat)` when
  `|lat| > 0.9`, rate `|lat| / 1.7`.
- Your sim must (a) keep defenders' **facing** pointed at the ball/carrier while their
  **velocity** runs laterally (set `a.face = angleTo(a, ball)` for line players), and
  (b) pass `lat` (signed lateral speed in actor space, §4.1) into `actionClip`.
  Without (a)+(b) defenders pivot like turnstiles instead of shuffling.

---

## 11. Cameras & replay (reference wiring)

- `rig.ts`: `gantryCam` (main broadcast, 20° down-field slant), `behindPostsCam(v, req)` with
  `req.fromZ = ±58` for shots at goal from either end, `chaseCam`, and replay rigs
  `orbitCam` / `heroLowCam` / `highWideCam`.
- Replay: record a ring buffer (~260 snaps @ frame rate) of
  `[x, z, face, carry, carryStyle, ...pose(22)]` per actor (`Game.record()`).
  Playback re-derives **views live from the replay camera**, so orbiting a replay genuinely
  shows different paper sides — that is a feature, keep it. Play at ~0.35× and cycle rigs.

---

## 12. Integration checklist (do in this order)

1. Copy `paper.ts`, `rig.ts`, `clips.ts`, `coronal.ts` verbatim. Delete the old
   `sideOn`/`sideWidthMultiplier`/squash code paths and the old player painter.
2. Add per-actor persistent fields: `face, rf, action, clipName, u, pose, blendFrom,
   blendT, blendDur, down, fallDir, carry, carryStyle, seed, view`.
3. Wire §4.1 (poses), §5 (views), §8 (draw), §8.1 (sort + ball).
4. Map your phase logic onto the §6 action vocabulary; set `down/fallDir` per §7.
5. Carriers: `carry = true`, `carryStyle = clamp01((speed-3)/4)`; on pass/kick clear both.
6. Call `resetPaperViews()` on match reset / side change.
7. Verify with §13.

---

## 13. Acceptance tests (visual, 2 minutes)

- [ ] Orbit the camera (replay orbit rig): each player flips front → edge → back **at their
      own angles**, at different moments from their neighbours; no flicker at boundaries.
- [ ] Side-on sprint: thin card, one lit arm/leg, dark far layer, visible lean, boots
      rotating through the stride, ball clamped at the chest. No number visible.
- [ ] Back view: number visible, arms occluded by the torso card, held ball hidden.
- [ ] Tackle: carrier `tackled` → tips about the hip → lying face-down card (number up);
      jackler over the ball; get-up unwinds without a pop.
- [ ] Knock-back (`fallBack`): lands face-up (face + chest visible).
- [ ] Defensive line sliding laterally: strafe cycle, bodies square to the carrier.
- [ ] Clip changes (sprint→tackle→ruck) blend over ~0.15 s with no frame pops.
- [ ] Feet do not skate: gait rate tracks ground speed in all gaits.

---

## 14. Pitfalls (already stepped in, do not repeat)

- Object-literal type annotations: `holder: Actor | null` inside `{}` is an *expression*,
  not a type. Declare an interface (`BallState`) instead.
- Renderer locals are **metres**; never divide them by `sc` before passing to `limbCard`
  (only the final `X()/Y()` projection multiplies by `sc`).
- Mirrored edge views: apply `ctx.scale(spinDir, 1)` **before** the fall rotation, and use
  `dirSign = 1` for the spin inside mirrored space.
- `sampleC` u-space: loops wrap, one-shots clamp. Feed `u += rate * dt`, never seconds.
- The hysteresis map must never store a lying view, or the actor sticks lying after get-up.
- Strict TS: `noUnusedLocals/Parameters` are on; `void x;` is the accepted sink.

— End of handoff. The reference implementation in `scene.ts` (`upPoses`, `upCam`, `render`)
is the ground truth for anything ambiguous above.
