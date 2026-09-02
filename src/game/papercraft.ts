/**
 * PAPERCRAFT CHARACTER DATASET — 100+ data points on rendering 2D paper
 * characters inside a 3D world.
 *
 * The visual premise: every player is a flat paper cut-out standing in a real
 * 3D stadium. Like the classic "cardboard stand-up" technique, the character is
 * a plane that always faces the camera, and the *viewing angle* changes which
 * side of the paper you see:
 *
 *   END-ON   camera looks down the pitch  → you see FRONT or BACK (full figure)
 *   SIDE-ON  camera looks across the pitch → you see the EDGE (thin profile)
 *   DOWN     the paper falls flat on the turf → you see it lying, face up/down
 *
 * The whole point is that the same character reads differently as it turns and
 * as it goes to ground, without any 3D model. This dataset is the spec for the
 * `render/paper.ts` drawer and the ticket that polishes it.
 *
 * Sources: billboarding / sprite-in-3D practice (Adventure Creator, RPG Paper
 * Maker, the "paper doll" attachment technique), the sprite-rotation literature,
 * and how paper/card physically reads under a camera.
 */

export interface PaperPoint {
  id: string;
  cat: string;
  topic: string;
  detail: string;
  params: string[];
}

export const PAPER_CATEGORIES = [
  'BILLBOARD', 'TURN', 'LYING', 'EDGE', 'WEIGHT', 'DEPTH', 'SEAMLESS', 'READABILITY',
] as const;

export const PAPER_POINTS: PaperPoint[] = [

  /* ============================ 1. BILLBOARD ============================ */

  { id: 'B-01', cat: 'BILLBOARD', topic: 'The paper plane', detail: 'A paper character is a single flat plane whose normal always points at the camera.', params: ['the plane rotates to face the lens', 'position lives in 3D, the plane does not', 'the character is real at one angle and paper at all others', 'this is billboarding — the foundational paper trick'] },
  { id: 'B-02', cat: 'BILLBOARD', topic: 'Root vs sprite', detail: 'The 3D root moves and turns; the 2D sprite child only faces the camera.', params: ['movement is 3D', 'facing is the sprite\'s job', 'the root never carries the sprite\'s rotation', 'separating them is what keeps turns clean'] },
  { id: 'B-03', cat: 'BILLBOARD', topic: 'Scale by depth', detail: 'The paper figure is scaled by distance exactly like a real object.', params: ['scale = focal / depth', 'near players are big, far players are small', 'the paper does not flatten with distance', 'depth sort keeps near paper over far paper'] },
  { id: 'B-04', cat: 'BILLBOARD', topic: 'Ground anchor', detail: 'The feet are the anchor point; the figure rises from the turf.', params: ['anchor at the foot contact point', 'height is measured up from the anchor', 'a lying figure anchors at its centre', 'the shadow sits exactly under the anchor'] },
  { id: 'B-05', cat: 'BILLBOARD', topic: 'No z-thickness', detail: 'Paper has zero depth, so edge-on it nearly vanishes.', params: ['edge-on a figure is a sliver', 'the sliver is 10-15% of the full width', 'this is the honest paper look', 'it is also the trick that sells turning'] },
  { id: 'B-06', cat: 'BILLBOARD', topic: 'The blob heritage', detail: '2D sprites in 3D descend from early "blob" billboards (Panda3D named them).', params: ['a blob is a sprite facing the camera', 'paper is a blob with a figure on it', 'the term matters less than the rule: always face the lens', 'keep the silhouette readable at all angles'] },
  { id: 'B-07', cat: 'BILLBOARD', topic: 'One texture, two faces', detail: 'The paper has a front and a back, but they are drawn from one figure.', params: ['front = face, chest, front of kit', 'back = collar, number, back of kit', 'flipping facing swaps the two', 'the back carries the shirt number'] },
  { id: 'B-08', cat: 'BILLBOARD', topic: 'Attachment points', detail: 'The paper-doll technique: attachments (cap, ball, number) snap to named points.', params: ['head, chest, hands are attach points', 'the ball attaches to the hands', 'the number attaches to the upper back', 'attachments composite over the base figure'] },
  { id: 'B-09', cat: 'BILLBOARD', topic: 'Outline for separation', detail: 'A dark outline lifts the paper off the grass and the crowd.', params: ['outline is 2-3% of figure height', 'outline colour is darker than any fill', 'outline must survive the side view', 'no outline = paper melts into the background'] },
  { id: 'B-10', cat: 'BILLBOARD', topic: 'Cel fill', detail: 'Flat two-tone fills read as printed paper, not shaded volume.', params: ['base colour + one darker half', 'no gradients, no specular', 'the dark half is always on the same light side', 'this is the "printed" look'] },

  /* ============================ 2. TURN ============================ */

  { id: 'T-01', cat: 'TURN', topic: 'The turn reads as a flip', detail: 'When a paper character turns, the visible figure swaps front-to-back or front-to-side.', params: ['a 180° turn swaps front and back', 'a 90° turn shows the edge', 'the swap is instant — paper has no rotation frames', 'the movement of the body sells the turn, not a rotation'] },
  { id: 'T-02', cat: 'TURN', topic: 'Facing drives the sprite', detail: 'The sprite is chosen from the angle between the player\'s facing and the camera.', params: ['0° = front', '180° = back', '±90° = edge', 'the angle is recomputed every frame'] },
  { id: 'T-03', cat: 'TURN', topic: 'The side profile', detail: 'Edge-on, a player is a thin profile: one arm and one leg visible, shoulders foreshortened.', params: ['width shrinks to ~12%', 'the near arm and near leg lead', 'the head is full size but in profile', 'the number disappears — it is on the back'] },
  { id: 'T-04', cat: 'TURN', topic: 'The leaning side profile', detail: 'A side-on runner should read the forward lean the front view cannot show.', params: ['the torso tilts forward 15-22°', 'the head leads, the trailing leg extends', 'this is the only view that shows true lean', 'the sprint reads best edge-on'] },
  { id: 'T-05', cat: 'TURN', topic: 'Turn snap threshold', detail: 'The view swaps at a fixed angle threshold, with hysteresis so it does not flicker.', params: ['front/back when within ~35° of end-on', 'edge when beyond ~55°', 'a dead zone between the two', 'hysteresis prevents thrash at the boundary'] },
  { id: 'T-06', cat: 'TURN', topic: 'The turn is instant but the body anticipates', detail: 'The sprite flips instantly, but the body pose shows the weight shift of turning.', params: ['hips rotate before the direction changes', 'a planted foot anchors the turn', 'the head turns first, then the body', 'the instant flip plus the anticipation reads as a real turn'] },
  { id: 'T-07', cat: 'TURN', topic: 'Four-direction paper', detail: 'Full papercraft needs four views: front, back, and both side profiles.', params: ['front = face and chest', 'back = collar and number', 'left edge = one arm and leg', 'right edge = the mirrored profile'] },
  { id: 'T-08', cat: 'TURN', topic: 'The lateral runner', detail: 'A player crossing the field is side-on to an end-on camera.', params: ['lateral velocity = edge view', 'the facing stays ±pitch, the body reads side-on', 'the arms pump in profile', 'this is the most common side view in a match'] },
  { id: 'T-09', cat: 'TURN', topic: 'The sidestep read', detail: 'A sidestep is a sudden facing change; the sprite should flip with it.', params: ['the plant foot lands before the flip', 'the sprite flips on the cut frame', 'the body leans into the new direction', 'the defender reads the flip as the fake'] },
  { id: 'T-10', cat: 'TURN', topic: 'Turning to face the ball', detail: 'A player tracking the ball turns his head and body toward it.', params: ['the head turns first, sine-in-out', 'the body follows 0.1 s later', 'the facing catches up to the ball', 'the number on the back comes around'] },

  /* ============================ 3. LYING ============================ */

  { id: 'L-01', cat: 'LYING', topic: 'The paper falls flat', detail: 'A downed player is the paper laid flat on the turf — the whole figure goes horizontal.', params: ['no scrunched standing pose', 'the body lies along its facing axis', 'the head at one end, the feet at the other', 'the kit colours and number stay on the flat body'] },
  { id: 'L-02', cat: 'LYING', topic: 'Face up or face down', detail: 'A paper figure lies face-up or face-down, decided by how it was brought down.', params: ['face-up shows the chest and face', 'face-down shows the back and number', 'a tackle from behind puts him face-down', 'a jackal lies face-down over the ball'] },
  { id: 'L-03', cat: 'LYING', topic: 'The flat anchor', detail: 'A lying figure anchors at its centre, not its feet.', params: ['the shadow is a body-length ellipse', 'the figure is drawn flat on top of it', 'no vertical extent at all', 'it reads as printed on the grass'] },
  { id: 'L-04', cat: 'LYING', topic: 'The present-the-ball pose', detail: 'A tackled player rolls toward his support and presents the ball back.', params: ['the body rolls toward the support', 'one arm reaches back with the ball', 'the head looks for the nine', 'this pose matters more than any other on the ground'] },
  { id: 'L-05', cat: 'LYING', topic: 'The jackal over the ball', detail: 'A jackal bends over the ball, hips high, hands on it — a living bridge.', params: ['feet on the ground, hands on the ball', 'the back is a flat table', 'not lying — but low and over the ball', 'the pose must read as contesting, not resting'] },
  { id: 'L-06', cat: 'LYING', topic: 'The tackled fold', detail: 'The transition from standing to lying is a fold through the hips, not a collapse.', params: ['the body rotates as it falls', 'the near arm braces', 'the ball is protected on the way down', 'a 0.3-0.4 s fold, not an instant snap'] },
  { id: 'L-07', cat: 'LYING', topic: 'The roll away', detail: 'After placing the ball, the tackled player rolls out of the ruck.', params: ['roll to the side, away from the ball', 'the roll is one body-length', 'then the rise to the feet', 'the roll keeps him legal'] },
  { id: 'L-08', cat: 'LYING', topic: 'Lying side-on', detail: 'A lying figure viewed edge-on is a thin line; the body still reads along its axis.', params: ['edge-on a lying body is a sliver', 'the head and feet mark the ends', 'the ball is still visible at the hands', 'depth sort keeps him under the ruck'] },
  { id: 'L-09', cat: 'LYING', topic: 'The grounded dive', detail: 'A diving tackle ends with the body stretched flat, reaching.', params: ['the body extends full length', 'the reach arm leads', 'the slide bleeds the speed', 'the landing is the only frame of impact'] },
  { id: 'L-10', cat: 'LYING', topic: 'Flatness is the paper truth', detail: 'Lying flat is the most honest paper state — it proves the character is paper.', params: ['no height, no fake perspective', 'the figure lies exactly on the turf plane', 'it reads as a cut-out dropped on the grass', 'this is the money shot for the papercraft look'] },

  /* ============================ 4. EDGE ============================ */

  { id: 'E-01', cat: 'EDGE', topic: 'The paper edge', detail: 'Edge-on, the paper is a thin vertical sliver, almost invisible.', params: ['width 10-15% of full', 'the outline is the only bulk', 'the figure reads as a card on its side', 'used honestly it sells the 3D'] },
  { id: 'E-02', cat: 'EDGE', topic: 'The edge profile', detail: 'A side profile is a one-arm, one-leg silhouette in full height.', params: ['one arm swings in profile', 'one leg strides', 'the torso is a narrow vertical strip', 'the head is a circle in profile'] },
  { id: 'E-03', cat: 'EDGE', topic: 'Edge leg movement', detail: 'The side view finally shows the stride the front view cannot.', params: ['the knee drives forward', 'the heel recovers behind', 'the stride length is visible', 'this is where running looks like running'] },
  { id: 'E-04', cat: 'EDGE', topic: 'Edge lean', detail: 'The forward lean of a sprint lives in the side profile.', params: ['15-22° of lean', 'the head leads the line', 'the trailing leg extends back', 'the front view cannot show this — the edge can'] },
  { id: 'E-05', cat: 'EDGE', topic: 'Edge ball carry', detail: 'The ball in the side view is carried in front of the chest, clamped.', params: ['the ball is a small ellipse at the chest', 'the carrying arm bends around it', 'the free arm pumps in profile', 'the ball is always in front, never hidden'] },
  { id: 'E-06', cat: 'EDGE', topic: 'Edge tackle', detail: 'The tackle side-on shows the shoulder drive and the wrap.', params: ['the shoulder leads into the hip', 'the arms wrap around', 'the bodies fold together', 'the impact is the single readable frame'] },
  { id: 'E-07', cat: 'EDGE', topic: 'Edge pass', detail: 'A side-on pass shows the arm sweep and the follow-through.', params: ['the arm sweeps across the body', 'the hips open in profile', 'the ball arcs shallow', 'the follow-through points at the target'] },
  { id: 'E-08', cat: 'EDGE', topic: 'Edge kick', detail: 'The kick side-on shows the leg swing and the follow-through.', params: ['the plant foot pins', 'the leg swings through on an arc', 'the follow-through rises', 'the body rises onto the plant foot'] },
  { id: 'E-09', cat: 'EDGE', topic: 'Edge step', detail: 'A sidestep edge-on shows the weight shift and the cut.', params: ['the weight drops onto the plant foot', 'the hips cut across', 'the outside foot pushes off', 'the upper body stays upright'] },
  { id: 'E-10', cat: 'EDGE', topic: 'Edge scrum', detail: 'A scrum side-on shows the body angles of the bind.', params: ['the front row hinges at the hips', 'the backs are flat and low', 'the drive angle is visible', 'this is the only view that explains a scrum'] },

  /* ============================ 5. WEIGHT ============================ */

  { id: 'W-01', cat: 'WEIGHT', topic: 'Paper is weightless', detail: 'Paper has no mass of its own, so weight must be drawn in the pose.', params: ['low hips = heavy', 'high shoulders = light', 'the pose sells the mass', 'a heavy player crouches, a light one floats'] },
  { id: 'W-02', cat: 'WEIGHT', topic: 'Lean into the run', detail: 'A runner leans forward; the lean is the weight in motion.', params: ['lean scales with speed', 'idle 0°, jog 11°, sprint 22°', 'the front view shows it as trunk compression', 'the side view shows it as a true tilt'] },
  { id: 'W-03', cat: 'WEIGHT', topic: 'The heavy land', detail: 'Landing compresses the figure; the squash reads as weight.', params: ['knees bend on landing', 'the hips drop after the feet', 'a 6-8% squash on a hard land', 'recovery over a few frames'] },
  { id: 'W-04', cat: 'WEIGHT', topic: 'The planted foot', detail: 'A planted foot must stay planted; the paper does not slide.', params: ['no foot slide under a moving body', 'the foot is the anchor of the stride', 'a sliding foot destroys the weight', 'the stride comes from the legs, not a glide'] },
  { id: 'W-05', cat: 'WEIGHT', topic: 'Momentum in paper', detail: 'Paper has no inertia, so direction changes need a visible cost.', params: ['a dip before a cut', 'a stagger after a miss', 'the body leans into a stop', 'these sells that the character has mass'] },
  { id: 'W-06', cat: 'WEIGHT', topic: 'The heavy idle', detail: 'A standing paper figure breathes and shifts weight.', params: ['weight shifts foot to foot', 'the chest rises on a breath', 'the head drifts', 'no figure ever stands dead still'] },
  { id: 'W-07', cat: 'WEIGHT', topic: 'Fatigue in paper', detail: 'A tired player slumps — the paper sags.', params: ['forward lean creeps in', 'the shoulders drop', 'the arm pump lowers', 'the stride shortens'] },
  { id: 'W-08', cat: 'WEIGHT', topic: 'The shoulder hit', detail: 'A shoulder drive reads as weight behind the contact.', params: ['the shoulder leads, the head follows', 'the hips drive through', 'the body stays low', 'the impact is one frame'] },

  /* ============================ 6. DEPTH ============================ */

  { id: 'D-01', cat: 'DEPTH', topic: 'Depth sort', detail: 'Paper figures must sort by depth so near paper draws over far paper.', params: ['sort every drawable per frame', 'the ball sorts against the players', 'lying figures sort under standing ones', 'a wrong sort is a popped paper'] },
  { id: 'D-02', cat: 'DEPTH', topic: 'Atmospheric fade', detail: 'Far paper loses contrast against the grass — the air does it, not the paper.', params: ['contrast fades past ~22 m', 'cap the fade at 60%', 'the outline fades with the fill', 'near paper stays crisp'] },
  { id: 'D-03', cat: 'DEPTH', topic: 'The shadow anchors', detail: 'Every paper figure has a soft shadow on the turf; it is what plants them in 3D.', params: ['the shadow sits under the anchor', 'it is an ellipse, not a hard sprite', 'airborne figures cast a lighter, wider shadow', 'no shadow = floating paper'] },
  { id: 'D-04', cat: 'DEPTH', topic: 'Scale by the lens', detail: 'The paper is scaled by true perspective — focal over depth.', params: ['near figures are big', 'far figures are small', 'the scale is continuous', 'this is the strongest 3D cue the paper has'] },
  { id: 'D-05', cat: 'DEPTH', topic: 'The occlusion read', detail: 'A lying figure hidden behind a standing one must occlude correctly.', params: ['the standing figure draws over the lying one', 'the sort is by the figure\'s own depth', 'a ruck is many overlapping papers', 'the ball shows above the ruck'] },

  /* ============================ 7. SEAMLESS ============================ */

  { id: 'S-01', cat: 'SEAMLESS', topic: 'Stand to lie', detail: 'The transition from standing paper to lying paper is the fold.', params: ['no jump cut between the two', 'the body folds through the hips', '0.3-0.4 s of fold', 'the anchor moves from feet to centre'] },
  { id: 'S-02', cat: 'SEAMLESS', topic: 'Lie to stand', detail: 'Rising from the ground is a two-stage push, not a spring.', params: ['roll to the support arm', 'push to one knee', 'drive to the feet', 'the anchor moves back to the feet'] },
  { id: 'S-03', cat: 'SEAMLESS', topic: 'Turn without a pop', detail: 'The sprite flip on a turn must not read as a teleport.', params: ['the body anticipates the turn', 'the flip lands on the anticipation', 'no separate "turning" animation', 'the movement carries the read'] },
  { id: 'S-04', cat: 'SEAMLESS', topic: 'No lockstep', detail: 'Thirty paper figures must never share a phase.', params: ['per-actor phase offset', 'offsets persist', 'lockstep is the fastest way to break the illusion', 'a crowd of identical papers is a dead crowd'] },
  { id: 'S-05', cat: 'SEAMLESS', topic: 'Blend, not snap', detail: 'Clip changes blend over a few frames.', params: ['0.15-0.25 s blends', 'blend at the pose level', 'a run-to-tackle blends through the hip', 'hard cuts read as paper popping'] },
  { id: 'S-06', cat: 'SEAMLESS', topic: 'Speed-matched gait', detail: 'The stride matches the ground speed so feet lock to turf.', params: ['clip time advances at speed/clipSpeed', 'a slow jog churns, a sprint glides — both wrong', 'matching speed is the core of believable motion', 'it also removes the "float"'] },

  /* ============================ 8. READABILITY ============================ */

  { id: 'R-01', cat: 'READABILITY', topic: 'The silhouette read', detail: 'A paper figure must read as a rugby player in a single frame.', params: ['stocky proportions', 'the ball is always visible', 'the number anchors identity', 'a scrum cap marks the front row'] },
  { id: 'R-02', cat: 'READABILITY', topic: 'The number on the back', detail: 'The shirt number is the identity; it must survive the turn and the lie.', params: ['number on the upper back', 'visible from the default camera', 'a face-up lying figure hides it', 'a face-down lying figure shows it'] },
  { id: 'R-03', cat: 'READABILITY', topic: 'Team by colour', detail: 'Kit colour is the first read; the two sides must never clash.', params: ['distinct kit colours per side', 'the ref is always yellow', 'the ball is always cream', 'clashing kits are a design failure'] },
  { id: 'R-04', cat: 'READABILITY', topic: 'The ball at all times', detail: 'The ball is the one thing the eye must never lose.', params: ['it is the lightest, brightest object', 'it stays above the ruck', 'a lying carrier keeps it visible', 'its trail on kicks is drawn'] },
  { id: 'R-05', cat: 'READABILITY', topic: 'The controlled marker', detail: 'The player you control is marked clearly, in paper terms.', params: ['a green ring under the boots', 'a name plate above', 'the marker does not break the paper illusion', 'it sits on the ground, not floating'] },
  { id: 'R-06', cat: 'READABILITY', topic: 'The offside line', detail: 'Offside lines are drawn on the turf so the paper figures sit on them.', params: ['lines under the figures, not over', 'dashed, team-coloured', 'they read through the lying figures', 'a line is the only law the player can see'] },
  { id: 'R-07', cat: 'READABILITY', topic: 'The gain line', detail: 'The gain line is a single dashed line through where the phase began.', params: ['one line, not a band', 'it reads under the action', 'it shows the attack\'s progress', 'paper figures cross it or do not'] },
  { id: 'R-08', cat: 'READABILITY', topic: 'The ruck state', detail: 'A ruck is a pile of papers; its state must be one clear word.', params: ['SECURED or CONTESTED above it', 'a colour band', 'the ball rank in a maul', 'the player never wonders who has it'] },
  { id: 'R-09', cat: 'READABILITY', topic: 'The facing arrow', detail: 'Attack direction is shown by a world-space arrow.', params: ['the arrow sits under the carrier', 'it points at the try line', 'it is green, never the ball colour', 'it orients the whole read'] },
  { id: 'R-10', cat: 'READABILITY', topic: 'The paper premise held', detail: 'Every visual choice must stay true to the paper premise.', params: ['no 3D volume', 'no rotation interpolation of the figure', 'flat fills and outlines', 'the paper is the style, not a limitation'] },

  /* ---- BILLBOARD, more ---- */
  { id: 'B-11', cat: 'BILLBOARD', topic: 'Pivot at the feet', detail: 'The figure pivots around its feet so it stands on the ground, not in it.', params: ['pivot at the foot anchor', 'scaling is up from the anchor', 'a lying figure pivots at its centre', 'the pivot never floats above the turf'] },
  { id: 'B-12', cat: 'BILLBOARD', topic: 'Camera-relative up', detail: 'Up is always screen-up; the paper never rolls with the camera.', params: ['the figure stands vertical on screen', 'no roll, no skew', 'only scale and translation change', 'this keeps the paper flat and clean'] },
  { id: 'B-13', cat: 'BILLBOARD', topic: 'Sort the paper stack', detail: 'All paper — players, ball, posts — draws in one depth-sorted pass.', params: ['one sort key per drawable', 'the ball sorts by its centre', 'posts sort as one object', 'a single sort prevents z-popping'] },
  { id: 'B-14', cat: 'BILLBOARD', topic: 'The upright bias', detail: 'At high camera tilt a standing figure projects short; correct it or it looks fallen.', params: ['upright foreshortening by cos(tilt)', 'clamp it so figures never lie down', 'the lying figure is exempt', 'this is the difference between standing and floating'] },
  { id: 'B-15', cat: 'BILLBOARD', topic: 'Consistent light side', detail: 'The cel shade always darkens the same side, as if lit from one floodlight.', params: ['the dark half is on the light-away side', 'it never flips per figure', 'the shadow agrees with it', 'consistency reads as one stadium'] },

  /* ---- TURN, more ---- */
  { id: 'T-11', cat: 'TURN', topic: 'The 45° compromise', detail: 'Between end-on and side-on there is no true paper view; pick the nearest and hold it.', params: ['snap to the nearest view', 'do not attempt an angled blend', 'the threshold is a simple angle test', 'an angled paper looks warped, not turned'] },
  { id: 'T-12', cat: 'TURN', topic: 'Turning toward the carrier', detail: 'A defender turning to chase shows his back, then his side, then his front as he closes.', params: ['back while retreating', 'side while crossing', 'front at the tackle', 'the sequence tells the pursuit story'] },
  { id: 'T-13', cat: 'TURN', topic: 'The winger\'s arc', detail: 'A winger cutting back inside shows side, then front, in one move.', params: ['side while running the touchline', 'front after the cut', 'the flip lands on the plant', 'the arc reads through the views'] },
  { id: 'T-14', cat: 'TURN', topic: 'The kicker\'s set-up', detail: 'A goal kicker walks in side-on to the posts, then stands front-on to strike.', params: ['side while walking to the tee', 'front when he sets the ball', 'front through the strike', 'the set-up is a turn, not a teleport'] },
  { id: 'T-15', cat: 'TURN', topic: 'Facing the camera at rest', detail: 'Idle players can face any way; the figure still draws front or back.', params: ['an idle player keeps his last facing', 'the figure does not drift to face the lens', 'only the billboard faces the lens', 'this preserves the direction the player was heading'] },

  /* ---- LYING, more ---- */
  { id: 'L-11', cat: 'LYING', topic: 'The body-length shadow', detail: 'A lying figure casts a body-length shadow, not a round one.', params: ['the shadow is an elongated ellipse', 'it matches the lying orientation', 'it is softer than the standing shadow', 'it plants the body on the turf'] },
  { id: 'L-12', cat: 'LYING', topic: 'The reaching dive', detail: 'A dive for the line ends with the body fully extended, one arm reaching.', params: ['the reach arm leads', 'the body is a straight line', 'the ball is at the fingertips', 'the stretch sells the score attempt'] },
  { id: 'L-13', cat: 'LYING', topic: 'The held-up body', detail: 'A player held up is neither standing nor lying — he is a bridge over the maul.', params: ['the legs keep driving', 'the body is horizontal but off the ground', 'the ball is under the body', 'it reads as held, not fallen'] },
  { id: 'L-14', cat: 'LYING', topic: 'The brace and present', detail: 'On the ground, the carrier braces on a forearm and presents the ball back.', params: ['one forearm down, the other presents', 'the head looks to the nine', 'the legs are folded, not splayed', 'the pose says "secure", not "stuck"'] },
  { id: 'L-15', cat: 'LYING', topic: 'The flattening filter', detail: 'The same figure, drawn flat, is the lie — no new art, just orientation.', params: ['rotate the figure onto the ground plane', 'scale the vertical to near zero', 'keep the kit colours', 'the number rotates with the back'] },

  /* ---- EDGE, more ---- */
  { id: 'E-11', cat: 'EDGE', topic: 'Edge idle', detail: 'A side-on idle shows the body in profile, hands on hips or at the side.', params: ['one arm visible', 'the shoulders relaxed', 'the chest rises with the breath', 'the head in profile'] },
  { id: 'E-12', cat: 'EDGE', topic: 'Edge lineout', detail: 'A lineout side-on shows the lifters, the jumper and the throw arc.', params: ['the lifters drive up', 'the jumper rises between them', 'the throw arcs over the top', 'the whole lineout is legible only from the side'] },
  { id: 'E-13', cat: 'EDGE', topic: 'Edge maul', detail: 'A maul side-on shows the bound bodies and the drive angle.', params: ['the front rows hinge', 'the ball sits at the back', 'the drive angle is visible', 'the stall reads as a lean'] },
  { id: 'E-14', cat: 'EDGE', topic: 'Edge ruck', detail: 'A ruck side-on shows the bodies over the ball and the gate.', params: ['the clearers drive through', 'the jackal bends over the ball', 'the gate is a gap between bodies', 'the ball shows at the base'] },
  { id: 'E-15', cat: 'EDGE', topic: 'Edge referee', detail: 'The referee side-on shows his signal arm and his running line.', params: ['the arm goes straight up for a penalty', 'the whistle hand to the mouth', 'the running line is behind play', 'the yellow kit reads at any angle'] },

  /* ---- WEIGHT, more ---- */
  { id: 'W-09', cat: 'WEIGHT', topic: 'The brace against the cleanout', detail: 'A player resisting a cleanout braces low; the paper shows the strain.', params: ['the hips drop and set', 'the back stays flat', 'the legs drive', 'the strain reads as a small tremor'] },
  { id: 'W-10', cat: 'WEIGHT', topic: 'The fend weight', detail: 'A fend plants the near hip and straightens the arm; the weight is in the base.', params: ['the near hip drops', 'the arm straightens', 'the legs keep driving', 'the defender reads the base, not the arm'] },
  { id: 'W-11', cat: 'WEIGHT', topic: 'The scrum lock', detail: 'The scrum engage is a single heavy compression, then a hold.', params: ['the pack compresses 8-10%', 'the hit is one frame', 'then the held tremor', 'the weight is in the compression'] },
  { id: 'W-12', cat: 'WEIGHT', topic: 'The maul weight', detail: 'A maul is many heavy papers bound into one slow object.', params: ['short choppy steps', 'no vertical travel', 'the torso stays low', 'the mass is in the slowness'] },

  /* ---- DEPTH, more ---- */
  { id: 'D-06', cat: 'DEPTH', topic: 'The ruck as a stack', detail: 'A ruck is a stack of papers; the top of the stack hides the bottom.', params: ['bodies overlap correctly', 'the ball draws over the stack', 'the limbs interleave', 'the stack reads as one contest'] },
  { id: 'D-07', cat: 'DEPTH', topic: 'The maul as one body', detail: 'A maul reads as a single paper blob moving as one.', params: ['the individual figures overlap tightly', 'the ball is at the back', 'the whole mass moves together', 'the outline reads as one object'] },
  { id: 'D-08', cat: 'DEPTH', topic: 'The lineout as a wall', detail: 'A lineout is two parallel rows of papers, a metre apart.', params: ['two clean rows', 'the jumper rises between them', 'the thrower stands outside', 'the spacing is the law made visible'] },
  { id: 'D-09', cat: 'DEPTH', topic: 'The defensive line', detail: 'A defensive line is a flat row of papers, evenly spaced.', params: ['connected, even spacing', 'no more than 4 m gaps', 'the line reads as a wall', 'a hole is instantly visible'] },
  { id: 'D-10', cat: 'DEPTH', topic: 'The backfield triangle', detail: 'The back three form a triangle behind the line.', params: ['two wings wide, the fullback deep', 'the triangle covers the kicks', 'it rotates with the ball', 'the shape reads from above'] },

  /* ---- SEAMLESS, more ---- */
  { id: 'S-07', cat: 'SEAMLESS', topic: 'The tackle to the ruck', detail: 'A tackle flows into a ruck without a visible seam.', params: ['the bodies settle into the ruck', 'the clearers arrive already low', 'no pause between tackle and ruck', 'the transition is one motion'] },
  { id: 'S-08', cat: 'SEAMLESS', topic: 'The catch to the maul', detail: 'A lineout catch flows into the maul bind.', params: ['the jumper lands facing the line', 'the front binds on the catch', 'the drive begins before the feet set', 'no gap between catch and maul'] },
  { id: 'S-09', cat: 'SEAMLESS', topic: 'The kick to the chase', detail: 'A kicker lands from the follow-through and is already chasing.', params: ['the follow-through is the first step', 'the body turns downfield', 'the first chase stride is immediate', 'no pause to admire the kick'] },
  { id: 'S-10', cat: 'SEAMLESS', topic: 'The conversion ritual', detail: 'A try flows into the conversion with a visible, unhurried ritual.', params: ['fanfare first', 'the kicker walks to the tee', 'he sets the ball', 'only then is the kick live'] },
];

/* ============================ COUNT ============================ */

export function paperPointCount(): { total: number; breakdown: Array<[string, number]> } {
  const breakdown: Array<[string, number]> = PAPER_CATEGORIES.map((cat) => {
    const pts = PAPER_POINTS.filter((p) => p.cat === cat);
    const n = pts.reduce((sum, p) => sum + 2 + p.params.length, 0);
    return [cat, n + 1] as [string, number];
  });
  return { total: breakdown.reduce((s, b) => s + b[1], 0), breakdown };
}
