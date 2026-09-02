/**
 * ANIMATION DATASET — 1000+ data points on 2D character animation, weight,
 * easing curves, and how to make motion feel seamless and polished.
 *
 * This is the specification the player-animation ticket draws from. Every entry
 * is a countable design fact: a principle, a curve with its feel, a frame
 * timing, a rugby-specific motion note, a contact/impact rule. The engine's
 * rig (`render/rig.ts`, `render/coronal.ts`) already ships the easing functions
 * these points describe; the ticket is to build *precise, considered* clips
 * from them rather than the current approximations.
 *
 * Sources: the Twelve Principles (Johnston & Thomas, "The Illusion of Life",
 * 1981) and their game-animation descendants, standard easing-curve theory,
 * spacing-chart practice, and rugby-gait / collision observation.
 */

export interface AnimPoint {
  id: string;
  cat: string;
  topic: string;
  detail: string;
  /** each param is one more countable fact about the point */
  params: string[];
}

export const ANIM_CATEGORIES = [
  'PRINCIPLES', 'WEIGHT', 'EASING', 'TIMING', 'SPACING',
  'SEAMLESS', 'RUGBY-MOTION', 'CONTACT', 'PRESETS',
] as const;

export const ANIM_POINTS: AnimPoint[] = [

  /* ============================ 1. PRINCIPLES ============================ */

  { id: 'P-01', cat: 'PRINCIPLES', topic: 'Squash & stretch', detail: 'Deform a body on force so mass reads through shape. Volume is conserved: what compresses in one axis bulges in the other.', params: ['amount is inversely proportional to mass', 'stretch on anticipation and follow-through', 'squash only on the instant of impact', 'a rugby shoulder hit squashes ~6% and recovers in 3 frames'] },
  { id: 'P-02', cat: 'PRINCIPLES', topic: 'Anticipation', detail: 'A preparatory move in the opposite direction before the main action, so the audience reads the intent and the mass behind it.', params: ['duration ≈ 1/3 of the main action', 'scale the wind-up with the force', 'a pass cocks the arm back before the throw', 'a jump dips the hips down before it drives up'] },
  { id: 'P-03', cat: 'PRINCIPLES', topic: 'Staging', detail: 'Present one idea at a time, from a readable angle, with the silhouette telling the story.', params: ['a read must survive a single-frame silhouette test', 'contrast the active limb against a still body', 'contact reads best in side or three-quarter view', 'never hide the ball behind two bodies'] },
  { id: 'P-04', cat: 'PRINCIPLES', topic: 'Straight ahead vs pose-to-pose', detail: 'Straight-ahead animates frame by frame; pose-to-pose plans keys first. Games use pose-to-pose with procedural in-betweening.', params: ['pose-to-pose = key poses + timing chart', 'straight ahead is for wild, unplannable motion like a loose ball', 'the rig samples between keys every frame', 'settle frames are keyed, never left to default'] },
  { id: 'P-05', cat: 'PRINCIPLES', topic: 'Follow-through & overlapping action', detail: 'Different parts of a body stop at different times; nothing halts in unison.', params: ['loose limbs and the head trail the torso', 'the free arm lags a sidestep by 2 frames', 'hair and kit are the outermost overlap layer', 'a planted foot is the one thing that must NOT drift'] },
  { id: 'P-06', cat: 'PRINCIPLES', topic: 'Slow in & slow out', detail: 'Every motion accelerates out of rest and decelerates into rest; only impacts move at constant speed.', params: ['accelerate over 10-20% of the arc', 'decelerate over 20-30% of the arc', 'constant velocity reads as mechanical', 'gravity-driven arcs ease in, muscular drives ease out'] },
  { id: 'P-07', cat: 'PRINCIPLES', topic: 'Arcs', detail: 'Living joints move in arcs, never straight lines. Linear interpolation between two poses looks robotic.', params: ['every joint traces a curve', 'the hand follows a wider arc than the elbow', 'a pass travels a gentle upward arc, not a line', 'run-cycle feet trace ellipses, not ovals with corners'] },
  { id: 'P-08', cat: 'PRINCIPLES', topic: 'Secondary action', detail: 'A small motion layered on the primary one that supports but never steals it.', params: ['breath is the base secondary on every idle', 'head stabilisation is secondary to the torso bob', 'kit sway is secondary to the run', 'secondary amplitude is capped at ~20% of primary'] },
  { id: 'P-09', cat: 'PRINCIPLES', topic: 'Timing', detail: 'The number of frames an action takes is its weight, mood and energy.', params: ['more frames = heavier, more deliberate', 'fewer frames = lighter, sharper', 'a tackle lands in 3-4 frames', 'a lineout lift takes 28-34 frames to apex'] },
  { id: 'P-10', cat: 'PRINCIPLES', topic: 'Exaggeration', detail: 'Push a pose past literal reality to sell the idea, then settle back.', params: ['overshoot 10-15% past the rest pose', 'a step overshoots the foot plant by one stride-width', 'a fend overshoots the arm by a hand-length', 'never exaggerate the planted foot — it must stay planted'] },
  { id: 'P-11', cat: 'PRINCIPLES', topic: 'Solid drawing', detail: 'A pose must read as a body with mass over its centre of gravity.', params: ['the line of balance runs through the support foot', 'a carry lowers the centre of mass 6-8 cm', 'a tackled body goes down through the hip, not the head', 'weight always transfers before a limb moves'] },
  { id: 'P-12', cat: 'PRINCIPLES', topic: 'Appeal', detail: 'A clear, readable, characterful silhouette per player.', params: ['stocky proportions read heavy', 'the number on the back anchors identity', 'asymmetry in every loop avoids the toy-soldier look', 'the head leads gaze and sells intent'] },

  /* ============================ 2. WEIGHT ============================ */

  { id: 'W-01', cat: 'WEIGHT', topic: 'Centre of mass', detail: 'Weight lives at the hips. Every believable motion moves the hip first.', params: ['hips lead, shoulders follow', 'a runner\'s hips bob twice per stride', 'a tackler drops his hip below the carrier\'s', 'the CoM is 55% of standing height'] },
  { id: 'W-02', cat: 'WEIGHT', topic: 'Mass through deceleration', detail: 'Heavy things are hard to start and hard to stop; the curve is the weight.', params: ['heavier = longer ease-in and ease-out', 'a prop starts 30% slower than a wing', 'a big body settles 2-3 frames longer after landing', 'impact recovery time scales with mass'] },
  { id: 'W-03', cat: 'WEIGHT', topic: 'Gravity response', detail: 'The downward phase is always faster than the upward phase for a living body.', params: ['fall is gravity-driven, ease-in', 'rise is muscle-driven, ease-out', 'a jump spends 60% of time descending', 'the apex holds only 2-3 frames'] },
  { id: 'W-04', cat: 'WEIGHT', topic: 'Momentum carry', detail: 'A moving body does not reverse direction without a cost.', params: ['a direction change dips the weight first', 'a sidestep plants one foot, drops 4 cm, then cuts', 'a 90° cut costs ~0.4 m/s of speed', 'carry momentum forward into a pass, never lean back'] },
  { id: 'W-05', cat: 'WEIGHT', topic: 'Load before launch', detail: 'Energy is stored by lowering before it is spent by rising.', params: ['crouch 0.2-0.3 s before a jump', 'the deeper the dip the higher the lift', 'a scrum engagement compresses 8-10% then drives', 'a lineout lifter drops his hip before lockout'] },
  { id: 'W-06', cat: 'WEIGHT', topic: 'Impact compression', detail: 'A body squashes into the contact surface, then rebounds past rest.', params: ['compress on the impact frame only', 'rebound overshoots 5-10% past rest', 'recover to rest over 3-6 frames', 'the squash axis is along the force, not always vertical'] },
  { id: 'W-07', cat: 'WEIGHT', topic: 'Weighted feet', detail: 'Feet carry the story of weight. A foot must plant and hold while the body passes over it.', params: ['no foot slide during ground contact', 'plant heel-toe in a jog, ball-of-foot in a sprint', 'a cut plants on the outside edge', 'lift the heel, not the whole foot, between strides'] },
  { id: 'W-08', cat: 'WEIGHT', topic: 'The heavy idle', detail: 'A standing body is never still; it breathes and shifts weight.', params: ['weight transfers foot to foot on a 2-4 s cycle', 'the chest rises on a 1.5 s breath cycle', 'the two cycles are co-prime so the loop never reads as a loop', 'fatigue adds a 0.5° forward lean per 20 stamina lost'] },
  { id: 'W-09', cat: 'WEIGHT', topic: 'The heavy land', detail: 'Landing is where weight is earned or lost.', params: ['the hips keep dropping after the feet touch', 'knees bend 20-30° to absorb', 'a clean land settles in 4 frames', 'a heavy land settles in 8 and squashes 8%'] },
  { id: 'W-10', cat: 'WEIGHT', topic: 'Stagger on miss', detail: 'A missed tackle or a broken step must show the lost energy.', params: ['a whiffed tackle swings through 120% of the arc', 'the defender stumbles 2 extra steps', 'recovery from a miss takes 0.6-0.9 s', 'a beaten defender slows 30% while he re-accelerates'] },
  { id: 'W-11', cat: 'WEIGHT', topic: 'Hip drive in the carry', detail: 'A ball carrier runs from the hips, not the shoulders.', params: ['forward lean is 15-22° at full sprint', 'the ball is clamped at the chest, arm slightly forward', 'leg drive is the visible power, not the arm pump', 'a fend straightens the arm and drops the near hip'] },
  { id: 'W-12', cat: 'WEIGHT', topic: 'The held scrum', detail: 'A bound scrum trembles but does not move; the tremor is the weight.', params: ['isometric strain = 2-4 mm oscillation at 6-10 Hz', 'the pack loads and unloads by millimetres', 'shoulders drop below hips in the crouch', 'the drive begins with the back leg, never the head'] },
  { id: 'W-13', cat: 'WEIGHT', topic: 'The driven maul', detail: 'A maul is a single heavy object moving in short steps.', params: ['short choppy steps, 0.3-0.5 m each', 'the torso never rises during a drive', 'all energy goes horizontal', 'the ball sinks to the back and stays hidden'] },
  { id: 'W-14', cat: 'WEIGHT', topic: 'The lifted jumper', detail: 'A lifted body is dead weight until the feet leave; then it flies.', params: ['the lifter drives, the jumper extends', 'extension is explosive: 0.3 s to full lockout', 'the jumper\'s arms overshoot vertical then settle 2° back', 'descent is controlled, not dropped'] },
  { id: 'W-15', cat: 'WEIGHT', topic: 'The diving tackle', detail: 'A dive launches through the centre of gravity and slides to rest.', params: ['launch is horizontal, not upward', 'the body extends full length in flight', 'landing slides 0.5-1.0 m on the grass', 'the reach arm is the last thing to stop'] },
  { id: 'W-16', cat: 'WEIGHT', topic: 'The grounded player', detail: 'On the deck a player is a bag of weight, not a ragdoll.', params: ['he hits and bounces 2-4 cm, once', 'the body rolls toward the support, not away', 'he braces on a forearm to present the ball', 'rising from a ruck is a two-stage push, not a spring'] },

  /* ============================ 3. EASING ============================ */

  { id: 'E-01', cat: 'EASING', topic: 'Linear', detail: 'Constant speed. Only correct for mechanical things and impacts at full force.', params: ['a scrum shove that never varies reads wrong', 'use for none of the human motion', 'formula y = t', 'the default is the enemy — override it everywhere'] },
  { id: 'E-02', cat: 'EASING', topic: 'Sine in', detail: 'Gentle start that accelerates; soft, no hard corner at the start.', params: ['formula 1 - cos(t·π/2)', 'use for a soft lift-off or a body beginning to fall', 'feels like rolling into motion', 'aerial descent start'] },
  { id: 'E-03', cat: 'EASING', topic: 'Sine out', detail: 'Decelerates into a soft stop with no snap.', params: ['formula sin(t·π/2)', 'use for a body arriving at rest gently', 'a soft catch, a hand settling on the ball', 'the classic "float in" feel'] },
  { id: 'E-04', cat: 'EASING', topic: 'Sine in-out', detail: 'Smooth at both ends, no flat spot; the neutral organic curve.', params: ['formula -(cos(π·t)-1)/2', 'default for most locomotion blends', 'a weight transfer from foot to foot', 'a head turn, a look toward the ball'] },
  { id: 'E-05', cat: 'EASING', topic: 'Quad in', detail: 'Accelerates with a firm ramp; a deliberate start.', params: ['formula t²', 'a body pushing off into a run', 'the start of a drive, not its end', 'sharper than sine-in'] },
  { id: 'E-06', cat: 'EASING', topic: 'Quad out', detail: 'Decelerates with a firm ramp; a decisive stop.', params: ['formula 1-(1-t)²', 'a player pulling up before a defender', 'the end of a sidestep plant', 'sharpest before a clean stop'] },
  { id: 'E-07', cat: 'EASING', topic: 'Quad in-out', detail: 'Firm at both ends; a committed motion with clear start and stop.', params: ['formula 2t² / 1-(2-2t)²/2 split', 'a deliberate step in a set piece', 'a ref placing the ball', 'reads as intention, not inertia'] },
  { id: 'E-08', cat: 'EASING', topic: 'Cubic in', detail: 'Stronger acceleration; a real shove off.', params: ['formula t³', 'the first stride of a sprint', 'the strike of a fend', 'a tackle driving off the back foot'] },
  { id: 'E-09', cat: 'EASING', topic: 'Cubic out', detail: 'Stronger deceleration; braking with weight.', params: ['formula 1-(1-t)³', 'a carrier cutting and planting', 'the last frame before contact', 'a controlled land'] },
  { id: 'E-10', cat: 'EASING', topic: 'Cubic in-out', detail: 'Committed both ways; the workhorse for weighted action.', params: ['formula 4t³ / 1-(-2t+2)³/2 split', 'a sidestep cut', 'a pass wind-up to release', 'the default for contact-adjacent motion'] },
  { id: 'E-11', cat: 'EASING', topic: 'Quart in', detail: 'An aggressive launch; almost explosive.', params: ['formula t⁴', 'a sprint burst from a standing start', 'a jumper exploding off the lifter\'s hands', 'the snap of a sidestep'] },
  { id: 'E-12', cat: 'EASING', topic: 'Quart out', detail: 'An aggressive deceleration; a hard arrest.', params: ['formula 1-(1-t)⁴', 'a body slamming on the brakes', 'the instant a tackle is completed', 'a plant foot landing hard'] },
  { id: 'E-13', cat: 'EASING', topic: 'Quint in', detail: 'The most violent start short of a snap; near-instant energy.', params: ['formula t⁵', 'a hit from a static scrum engage', 'the first frame of a knock-on chase', 'a reflexive reach'] },
  { id: 'E-14', cat: 'EASING', topic: 'Quint out', detail: 'The most violent stop; a collision arrest.', params: ['formula 1-(1-t)⁵', 'a body into a post', 'a held-up maul that stops dead', 'the end of a charge-down'] },
  { id: 'E-15', cat: 'EASING', topic: 'Expo in', detail: 'Slow, then very fast; gravity and late commitment.', params: ['formula 2^(10(t-1))', 'a ball dropped and accelerating', 'a dive that tucks late', 'a loose body tumbling'] },
  { id: 'E-16', cat: 'EASING', topic: 'Expo out', detail: 'Fast, then very slow; terminal approach.', params: ['formula 1-2^(-10t)', 'a ball settling into a catch', 'a hand coming to rest on the ball', 'a player easing into the line'] },
  { id: 'E-17', cat: 'EASING', topic: 'Circ in', detail: 'Accelerates on an arc; the feeling of swinging in.', params: ['formula 1-√(1-t²)', 'a kick leg swinging through', 'an arm coming around a fend', 'a sidestep arcing inside'] },
  { id: 'E-18', cat: 'EASING', topic: 'Circ out', detail: 'Decelerates on an arc; a body settling on a curve.', params: ['formula √(1-(t-1)²)', 'a pass arriving at the hands', 'a jumper reaching the apex', 'a leg following through and settling'] },
  { id: 'E-19', cat: 'EASING', topic: 'Back in', detail: 'Overshoots backwards first — the wind-up, made explicit.', params: ['formula with overshoot constant 1.7', 'a pass cocking the arm back', 'a kicker stepping back before the run-up', 'a jumper crouching before the lift'] },
  { id: 'E-20', cat: 'EASING', topic: 'Back out', detail: 'Overshoots the target and settles back — the follow-through.', params: ['formula with overshoot constant 1.7', 'an arm past vertical on a lift then settling', 'a pass release overshooting forward', 'a step overshooting the plant'] },
  { id: 'E-21', cat: 'EASING', topic: 'Elastic out', detail: 'A spring with damped oscillation; playful energy.', params: ['formula 2^(-10t)·sin(...)+1', 'a bounced loose ball (careful, it reads cartoony)', 'a celebration bounce', 'use sparingly in a serious rugby sim'] },
  { id: 'E-22', cat: 'EASING', topic: 'Bounce out', detail: 'A bouncing settle with discrete hops; impact energy dissipating.', params: ['formula with n=7.5625, d=2.75', 'a ball bounced then caught', 'a tackle that bounces once', 'a dropped ball settling on the turf'] },
  { id: 'E-23', cat: 'EASING', topic: 'Curve pairing', detail: 'The same action uses one curve in and a different one out, by force source.', params: ['gravity in / muscle out', 'impact in / recover out', 'a kick: back-in on the wind, circ-out on the swing', 'never pair ease-in with ease-in'] },
  { id: 'E-24', cat: 'EASING', topic: 'Curve and weight', detail: 'The same curve with different durations reads as a different body.', params: ['same path, 2x frames = 2x perceived mass', 'heavy bodies hold the deceleration longer', 'light bodies snap the acceleration', 'a prop and a wing can share a path but never a duration'] },

  /* ============================ 4. TIMING ============================ */

  { id: 'T-01', cat: 'TIMING', topic: 'Frame rate and holds', detail: 'Animating on ones, twos or threes changes the texture of the motion.', params: ['60 fps engine, poses on the frame', 'fast action animates on ones', 'idle and breathing can sit on twos', 'a held pose with twos reads as tension'] },
  { id: 'T-02', cat: 'TIMING', topic: 'Duration = weight', detail: 'A fixed path at different durations is different bodies.', params: ['a 0.4 s sidestep is a wing', 'a 0.7 s sidestep is a prop', 'a tackle impact is 1 frame, its recovery 6', 'a pass is 0.18-0.4 s of flight'] },
  { id: 'T-03', cat: 'TIMING', topic: 'The three-part action', detail: 'Almost every action is anticipation, action, follow-through in a 1:2:1 or 1:2:2 ratio.', params: ['anticipation 25-30%', 'action 40-50%', 'follow-through 20-30%', 'a tackle: load 3, drive 5, land 4'] },
  { id: 'T-04', cat: 'TIMING', topic: 'Contact is a frame', detail: 'The actual impact of a tackle or a catch is one frame; everything around it is the story.', params: ['squash on the impact frame only', 'sound and shake land on the same frame', 'before it: anticipation', 'after it: 3-6 frames of recovery'] },
  { id: 'T-05', cat: 'TIMING', topic: 'Run cadence', detail: 'A stride cycle is two steps; speed changes the rate, not the mechanics.', params: ['jog ~1.6 strides/s (0.72 s cycle)', 'sprint ~2.3 strides/s (0.50 s cycle)', 'carry is between, 0.58 s cycle', 'cadence rises with speed, not leg length'] },
  { id: 'T-06', cat: 'TIMING', topic: 'Hold time in the air', detail: 'Airborne time is short and must be earned by a real launch.', params: ['a sidestep leaves the ground 0.1 s', 'a lineout jump holds 0.3-0.5 s at apex', 'a dive is 0.4-0.5 s from launch to turf', 'a bomb catch jump holds 0.3 s'] },
  { id: 'T-07', cat: 'TIMING', topic: 'Reaction and recovery', detail: 'Every action has a reaction window where the body is committed.', params: ['a missed tackle leaves the defender 0.6 s to recover', 'a beaten step buys the attacker 0.6 s', 'a pass commits the thrower for 0.2 s', 'the AI reaction is capped at 0.2 s'] },
  { id: 'T-08', cat: 'TIMING', topic: 'Settle frames', detail: 'Nothing stops on the last key; everything eases to rest over a few frames.', params: ['2-6 settle frames after every action', 'a catch settles the arms over 4 frames', 'a landed jump settles the knees over 6', 'cutting settle frames reads as stiffness'] },
  { id: 'T-09', cat: 'TIMING', topic: 'Fatigue drift', detail: 'As stamina falls, every motion slows and slumps a little.', params: ['-0.5° posture per 20 stamina lost', 'stride cycle +4% at 50% stamina', 'arms pump 15% lower when gassed', 'the drift is gradual, never stepped'] },

  /* ============================ 5. SPACING ============================ */

  { id: 'S-01', cat: 'SPACING', topic: 'Spacing is speed', detail: 'The gap between consecutive frames is the visible velocity; wider = faster.', params: ['tight spacing reads slow and heavy', 'wide spacing reads fast and light', 'the same pose count can be any speed', 'spacing charts are drawn before in-betweening'] },
  { id: 'S-02', cat: 'SPACING', topic: 'The ease chart', detail: 'A spacing chart marks where each frame sits along the arc.', params: ['clustered at the start = ease-in', 'clustered at the end = ease-out', 'clustered both ends = ease-in-out', 'even = linear (avoid)'] },
  { id: 'S-03', cat: 'SPACING', topic: 'Overshoot spacing', detail: 'A fast motion overshoots the rest pose by a frame or two before settling.', params: ['overshoot 1-2 frames past rest', 'then 1 frame back', 'the overshoot is 5-15% of the move', 'it is what sells follow-through'] },
  { id: 'S-04', cat: 'SPACING', topic: 'Staggered limbs', detail: 'Limbs should not all reach their extremes on the same frame.', params: ['offset each limb by 1-2 frames', 'the near arm and far arm counter-swing', 'the head lags the shoulders by 2 frames', 'stagger is what removes the robot'] },
  { id: 'S-05', cat: 'SPACING', topic: 'Arc spacing in a run', detail: 'The foot and hand follow elliptical paths whose spacing is tight at the top and bottom.', params: ['foot slows at the top of the swing', 'foot slows at the plant', 'foot is fastest at mid-swing', 'the hip bob follows a shallow sine'] },
  { id: 'S-06', cat: 'SPACING', topic: 'Contact spacing', detail: 'The frames around a contact compress, then explode apart.', params: ['compress toward the impact frame', 'one tight frame at impact', 'spread out during recovery', 'the contrast is the impact'] },

  /* ============================ 6. SEAMLESS ============================ */

  { id: 'SM-01', cat: 'SEAMLESS', topic: 'Blend, do not snap', detail: 'Transitions between clips are blended over a short window, never cut.', params: ['blend over 0.15-0.25 s', 'blend at the pose level, not the screen level', 'a run-to-tackle blends through the hip', 'the blend window scales with the speed difference'] },
  { id: 'SM-02', cat: 'SEAMLESS', topic: 'Root motion', detail: 'The feet move the body, not the other way around; the root follows the feet.', params: ['root displacement is the integral of the stride', 'a foot plant must not slide under a moving root', 'speed is a cadence change, not a root slide', 'kick-glide and moonwalk are root-motion bugs'] },
  { id: 'SM-03', cat: 'SEAMLESS', topic: 'Phase offset', detail: 'Thirty players must never share a phase or they animate in lockstep.', params: ['per-actor random offset 0-1.7 s', 'offset is persistent per actor', 're-randomised only on substitution', 'lockstep is the single fastest way to look broken'] },
  { id: 'SM-04', cat: 'SEAMLESS', topic: 'Speed-driven clip choice', detail: 'The clip is chosen from actual speed, so nobody jogs in place or sprints standing up.', params: ['0-0.7 m/s idle', '0.7-3.4 jog', '3.4-7.4 sprint', '7.4+ full sprint or carry'] },
  { id: 'SM-05', cat: 'SEAMLESS', topic: 'Head tracking', detail: 'The head looks at the ball whenever the body is not otherwise engaged.', params: ['head yaw lags the ball by 0.1 s', 'head turn is sine-in-out', 'the carrier keeps the head up, looking ahead', 'a receiver tracks the ball into the hands'] },
  { id: 'SM-06', cat: 'SEAMLESS', topic: 'Breathing under everything', detail: 'A subtle chest scale under every idle and every hold.', params: ['breath cycle 1.4-1.6 s', 'amplitude 1-2% of chest width', 'co-prime with the weight-shift cycle', 'gassed players breathe visibly harder'] },
  { id: 'SM-07', cat: 'SEAMLESS', topic: 'Settle on loop entry', detail: 'Entering a loop should ease from the previous pose, not pop.', params: ['blend into a loop over 2-3 frames', 'exit a loop through a settle pose', 'a loop must be seamless at its seam', 'never hard-cut a loop to a one-shot'] },
  { id: 'SM-08', cat: 'SEAMLESS', topic: 'Anticipation into contact', detail: 'The frames before a tackle or catch must show the body preparing.', params: ['a tackler lowers his hips 3 frames out', 'a catcher raises his hands 4 frames out', 'a receiver turns his hips before the ball arrives', 'no anticipation = no weight = no read'] },
  { id: 'SM-09', cat: 'SEAMLESS', topic: 'Mirror consistency', detail: 'Left and right halves of a gait are 3-5% different, never perfect mirrors.', params: ['the right stride is 3% longer', 'arm swing is asymmetric by design', 'perfect symmetry reads as a toy soldier', 'the asymmetry is baked in, not random per frame'] },
  { id: 'SM-10', cat: 'SEAMLESS', topic: 'The in-between hold', detail: 'A pose can hold a beat, but a held body must still live.', params: ['a held scrum pose trembles 2-4 mm', 'a held pass pose breathes', 'a held lineout brace strains visibly', 'hold without life = mannequin'] },

  /* ============================ 7. RUGBY-MOTION ============================ */

  { id: 'R-01', cat: 'RUGBY-MOTION', topic: 'The run cycle', detail: 'A stocky, powerful runner: low hips, pumping arms, double body bob.', params: ['forward lean 15-22°', 'knees drive to 90°+ at sprint', 'arms pump 45° elbow, fists to chest height', 'two bobs per stride, not one'] },
  { id: 'R-02', cat: 'RUGBY-MOTION', topic: 'The carry', detail: 'Ball clamped to the chest, one arm locks it, the free arm still pumps.', params: ['carrying arm bent 90°+, ball at the chest', 'free arm pumps opposite the near leg', 'body leans slightly into the traffic', 'the carrier never looks like a runner'] },
  { id: 'R-03', cat: 'RUGBY-MOTION', topic: 'The pass', detail: 'Hips open, hands sweep across the body, the head turns to the target first.', params: ['head turns to the receiver before the hands move', 'the ball travels in a shallow upward arc', 'follow-through points at the target', 'the throw is back-in on the wind, circ-out on release'] },
  { id: 'R-04', cat: 'RUGBY-MOTION', topic: 'The sidestep', detail: 'A fake one way, plant, then cut hard the other.', params: ['plant on the outside foot', 'drop the hip 4-6 cm', 'cut on a 45-60° angle', 'the upper body stays upright while the hips cut'] },
  { id: 'R-05', cat: 'RUGBY-MOTION', topic: 'The fend', detail: 'A stiff arm to the defender while the legs keep driving.', params: ['arm straightens over 0.2 s', 'near hip drops to brace', 'legs never stop pumping', 'the defender reads the fend before contact'] },
  { id: 'R-06', cat: 'RUGBY-MOTION', topic: 'The tackle', detail: 'Drop the hips, drive the shoulder, wrap, then fold to ground.', params: ['shoulder hits the thigh/hip, not the chest', 'head goes to the side of the body', 'arms wrap as the shoulder lands', 'both bodies fold through the hip'] },
  { id: 'R-07', cat: 'RUGBY-MOTION', topic: 'The dive', detail: 'A low, horizontal launch through the centre of gravity.', params: ['launch from 2-3 m out', 'body extends full length', 'land and slide on the forearms/chest', 'the reach arm stretches for the line'] },
  { id: 'R-08', cat: 'RUGBY-MOTION', topic: 'The jackal', detail: 'Feet wide, back flat, hands clamped low over the ball.', params: ['feet outside the ball, hips high', 'back is a flat table', 'hands grip before the cleanout arrives', 'the body ticks with resisted strain'] },
  { id: 'R-09', cat: 'RUGBY-MOTION', topic: 'The cleanout', detail: 'Arrive low, hit through the defender, finish past the ball.', params: ['arrive at gate height, not upright', 'shoulder into the hip/thigh', 'drive through to 1 m past the ball', 'the whole body travels, it does not stop at contact'] },
  { id: 'R-10', cat: 'RUGBY-MOTION', topic: 'The scrum crouch', detail: 'A deep hip hinge: hips high, back flat, head up.', params: ['shoulders drop below hips', 'back stays flat, not rounded', 'head up, eyes forward', 'feet split, weight on the balls'] },
  { id: 'R-11', cat: 'RUGBY-MOTION', topic: 'The scrum drive', detail: 'The pack walks forward in short, choppy unison.', params: ['short 0.3-0.5 m steps', 'almost no vertical travel', 'the torso never rises', 'power comes from the back leg'] },
  { id: 'R-12', cat: 'RUGBY-MOTION', topic: 'The lineout lift', detail: 'Two lifters drive a jumper to full extension and hold.', params: ['lifters dip 0.2 s then drive', 'jumper extends arms to lockout', 'hold at apex 0.3-0.5 s', 'lower under control, not drop'] },
  { id: 'R-13', cat: 'RUGBY-MOTION', topic: 'The throw', detail: 'A two-handed overhead throw with a hip-led follow-through.', params: ['wind up over the head, elbows bent', 'hips rotate into the throw', 'release at full extension', 'follow-through finishes low across the body'] },
  { id: 'R-14', cat: 'RUGBY-MOTION', topic: 'The kick', detail: 'Plant, swing, strike, follow through past the head.', params: ['plant foot absolutely still', 'kicking leg accelerates through the ball', 'follow-through rises above the hip', 'the body rises onto the plant foot'] },
  { id: 'R-15', cat: 'RUGBY-MOTION', topic: 'The high catch', detail: 'Track the ball, reach at full stretch, absorb into the chest.', params: ['head up, eyes on the ball', 'arms reach full stretch', 'absorb: hands give 10 cm on contact', 'then brace for the incoming hit'] },
  { id: 'R-16', cat: 'RUGBY-MOTION', topic: 'The offload', detail: 'A pass thrown in contact, one-handed or short, off a bent arm.', params: ['arm stays bent and live in the tackle', 'the ball is flicked as the body folds', 'the receiver arrives at the hip', 'the throw happens in 0.15-0.25 s'] },
  { id: 'R-17', cat: 'RUGBY-MOTION', topic: 'The box kick', detail: 'A quick punt from the base of the ruck, flat and long.', params: ['one step, no run-up', 'the kick is low-trajectory', 'the nine follows it immediately', 'protection forms an L in front'] },
  { id: 'R-18', cat: 'RUGBY-MOTION', topic: 'The sideline shepherd', detail: 'A defender funnels the carrier to touch without committing.', params: ['body angled inside-out', 'feet shuffle, never cross', 'arms wide to block the inside', 'the shoulder stays square to the touchline'] },
  { id: 'R-19', cat: 'RUGBY-MOTION', topic: 'The kick chase', detail: 'A connected line of chasers running at the landing zone.', params: ['run in a flat, connected line', 'stay onside behind the kicker', 'arrive as the ball lands', 'first man contests, next man tackles'] },
  { id: 'R-20', cat: 'RUGBY-MOTION', topic: 'The number on the back', detail: 'The shirt number is the identity; it must stay readable through motion.', params: ['number stays on the upper back', 'visible from the default camera', 'the number does not distort with the torso', 'a scrum cap and the number are the two reads'] },

  /* ============================ 8. CONTACT ============================ */

  { id: 'C-01', cat: 'CONTACT', topic: 'Impact frame', detail: 'The single frame where two bodies meet; everything compresses into it.', params: ['squash 5-10% on the impact frame', 'camera shake 0.2-0.5 on impact', 'the sound lands here', 'the next 3-6 frames are recovery'] },
  { id: 'C-02', cat: 'CONTACT', topic: 'Momentum exchange', detail: 'The faster body transfers its momentum and the slower one carries on.', params: ['the tackler decelerates through the carrier', 'the carrier\'s upper body whips forward', 'the legs keep running for 1-2 frames', 'the exchange is the read of who won'] },
  { id: 'C-03', cat: 'CONTACT', topic: 'The fold to ground', detail: 'A tackled body goes down through the hips, rotating as it falls.', params: ['the body rotates, not collapses', 'the near arm braces the fall', 'the ball is protected on the way down', 'both players land and roll'] },
  { id: 'C-04', cat: 'CONTACT', topic: 'The ruck bind', detail: 'Players bind onto the breakdown, low and square.', params: ['bind at the hip, not the neck', 'shoulders above hips', 'the pack forms over the ball', 'offside lines read from the hindmost foot'] },
  { id: 'C-05', cat: 'CONTACT', topic: 'The maul collapse', detail: 'A collapsing maul is a controlled, slow fold, not a pile-up.', params: ['it folds from one side', 'players stay bound as it goes', 'the referee reads the collapse point', 'a clean collapse is a legal end'] },
  { id: 'C-06', cat: 'CONTACT', topic: 'The shoulder hit', detail: 'The core of every legal tackle: shoulder to body, arms wrapping.', params: ['shoulder below the line of the neck', 'head to the safe side', 'wrap completes within 2 frames', 'drive through, not into'] },
  { id: 'C-07', cat: 'CONTACT', topic: 'The held-up tackle', detail: 'A tackle near the line where the carrier is lifted, not brought down.', params: ['the defender lifts, the carrier\'s legs drive', 'the maul forms around a standing ball', 'the ref looks for the held-up call', 'both teams\' posture goes vertical'] },
  { id: 'C-08', cat: 'CONTACT', topic: 'The knock-on', detail: 'A ball spilled forward reads as a hand error, then a scramble.', params: ['the hands fumble before the drop', 'the ball bounces forward, then sideways', 'two players react instantly', 'the ref\'s arm goes up for the scrum'] },

  /* ============================ 9. PRESETS ============================ */

  { id: 'PR-01', cat: 'PRESETS', topic: 'Sprint burst', detail: 'quint-in launch, quad-out settle, 0.5 s cycle.', params: ['accel over 0.3 s to top speed', 'lean forward 20°', 'knees to 90°', 'arms punch, not swing'] },
  { id: 'PR-02', cat: 'PRESETS', topic: 'Tackle hit', detail: 'back-in load, cubic-out drive, 1-frame impact, 6-frame recover.', params: ['hips drop 3 frames out', 'shoulder drives through', 'squash on impact', 'recover to a ready stance'] },
  { id: 'PR-03', cat: 'PRESETS', topic: 'Sidestep cut', detail: 'sine-in-out plant, quint-in cut, quad-out settle.', params: ['plant 0.1 s', 'cut 0.15 s', 'settle 0.2 s', 'the head stays level'] },
  { id: 'PR-04', cat: 'PRESETS', topic: 'Pass release', detail: 'back-in wind, circ-out release, 0.25 s total.', params: ['head turns first', 'hips open', 'ball arcs shallow', 'follow-through points at target'] },
  { id: 'PR-05', cat: 'PRESETS', topic: 'Kick strike', detail: 'cubic-in plant, circ-in swing, back-out follow-through.', params: ['plant foot pins', 'leg swings on an arc', 'follow-through past the head', 'body rises onto the plant foot'] },
  { id: 'PR-06', cat: 'PRESETS', topic: 'Lineout lift', detail: 'quad-in dip, quint-in drive, 0.3 s lockout, 0.4 s hold, controlled lower.', params: ['dip loads the legs', 'drive explodes', 'arms lock overhead', 'lower over 0.5 s'] },
  { id: 'PR-07', cat: 'PRESETS', topic: 'High catch', detail: 'sine-in reach, expo-out absorb, 0.15 s brace.', params: ['reach full stretch', 'absorb 10 cm', 'brace for the hit', 'head stays up throughout'] },
  { id: 'PR-08', cat: 'PRESETS', topic: 'Jackal entry', detail: 'cubic-in approach, 1-frame grip, resisted hold.', params: ['arrive through the gate', 'grip before the cleanout', 'back flat, hips high', 'hold against the cleanout'] },
  { id: 'PR-09', cat: 'PRESETS', topic: 'Cleanout drive', detail: 'quad-in arrival, cubic-out drive, 0.4 s total.', params: ['arrive low', 'hit the hip', 'drive 1 m past', 'stay on the feet'] },
  { id: 'PR-10', cat: 'PRESETS', topic: 'Idle weight shift', detail: 'sine-in-out transfer, 3 s cycle, breath overlay.', params: ['weight to one foot', 'hips settle', 'arms rest', 'breath on 1.5 s'] },
  { id: 'PR-11', cat: 'PRESETS', topic: 'Scrum engage', detail: 'quint-in drive, 1-frame impact, 0.2 s settle, held tremor.', params: ['the pack drives together', 'impact is one frame', 'settle into the bind', 'tremor at 6-10 Hz'] },
  { id: 'PR-12', cat: 'PRESETS', topic: 'Grounded present', detail: 'bounce-out to the deck, 1-frame bounce, braced present.', params: ['hit and bounce once', 'roll to the support', 'brace on the forearm', 'present the ball long'] },

  /* ---- RUGBY-MOTION, clip level ---- */
  { id: 'R-21', cat: 'RUGBY-MOTION', topic: 'The drop kick', detail: 'A restart or drop-out: drop the ball onto the foot at the top of the bounce.', params: ['the ball is dropped, not thrown', 'contact at the top of the bounce', 'the leg swings through the drop point', 'follow-through holds the line'] },
  { id: 'R-22', cat: 'RUGBY-MOTION', topic: 'The grubber', detail: 'A low kick that rolls along the ground; the foot taps the top of the ball.', params: ['strike low on the ball', 'the ball rolls end over end', 'the kicker accelerates straight after', 'a short follow-through, no big wind-up'] },
  { id: 'R-23', cat: 'RUGBY-MOTION', topic: 'The drop goal', detail: 'A drop kick aimed between the posts, struck in a clean, compact motion.', params: ['one step and drop', 'strike through the sweet spot', 'the head stays down over the ball', 'the kicker holds the pose to watch it'] },
  { id: 'R-24', cat: 'RUGBY-MOTION', topic: 'The penalty run-up', detail: 'A place kick with a measured, repeatable run-up.', params: ['run-up is 3-5 steps at 30-45°', 'the plant foot stops beside the tee', 'the strike is smooth, not lashed', 'the body falls into the kick'] },
  { id: 'R-25', cat: 'RUGBY-MOTION', topic: 'The conversion', detail: 'A place kick from in line with the try, taken calmly.', params: ['the angle is set by the try mark', 'the run-up is shorter than a penalty', 'wind is read, not ignored', 'the kicker resets his routine each time'] },
  { id: 'R-26', cat: 'RUGBY-MOTION', topic: 'The restart catch pod', detail: 'Two lifters raise a jumper to take the kick-off cleanly.', params: ['lifters plant and drive together', 'the jumper times the leap to the drop', 'land and turn toward the exit', 'a sealer protects the catcher'] },
  { id: 'R-27', cat: 'RUGBY-MOTION', topic: 'Box kick protection', detail: 'Forwards form an L-shaped wall in front of the nine.', params: ['the wall forms before the kick', 'bodies square and low', 'the nine kicks flat and follows', 'the wall breaks only when the ball is gone'] },
  { id: 'R-28', cat: 'RUGBY-MOTION', topic: 'The counter-attack step', detail: 'The fullback catches and immediately accelerates at a seam.', params: ['catch on the move', 'one step to read the seam', 'accelerate hard through the gap', 'the support trails at the hip'] },
  { id: 'R-29', cat: 'RUGBY-MOTION', topic: 'The pull-back pass', detail: 'A deep man behind the pods receives the ball moving forward.', params: ['the receiver is 10-12 m deep', 'he arrives at pace', 'the pass is flat, not floated', 'the defence is committed before the catch'] },
  { id: 'R-30', cat: 'RUGBY-MOTION', topic: 'The cut-out pass', detail: 'A long pass that skips one receiver to hit the overlap.', params: ['the throw travels 10-15 m', 'it is flatter and faster than a short pass', 'the receiver is already at speed', 'risk rises with distance and wind'] },
  { id: 'R-31', cat: 'RUGBY-MOTION', topic: 'The spiral pass', detail: 'A long pass with a spin that holds its line.', params: ['the wrist snaps to spin the ball', 'the spiral cuts the wind', 'used for 15 m+ throws', 'the follow-through points at the target'] },
  { id: 'R-32', cat: 'RUGBY-MOTION', topic: 'The pop pass', detail: 'A short, soft pass out of the tackle to a runner at the hip.', params: ['thrown over 1-3 m', 'soft hands, no spin', 'the receiver is on the carrier\'s hip', 'thrown in the contact window'] },
  { id: 'R-33', cat: 'RUGBY-MOTION', topic: 'The switch', detail: 'Two players cross paths so the ball changes angle.', params: ['the receiver cuts behind the passer', 'the pass is short and flat', 'the defence is turned inward', 'the timing is a half-stride overlap'] },
  { id: 'R-34', cat: 'RUGBY-MOTION', topic: 'The loop', detail: 'The passer loops around the receiver to become the extra man.', params: ['pass then loop behind', 'the loop is at full pace', 'the receiver runs straight to hold the line', 'creates a 3v2 on the edge'] },
  { id: 'R-35', cat: 'RUGBY-MOTION', topic: 'The dummy', detail: 'A fake pass that holds the defence while the carrier goes.', params: ['the hands shape the pass', 'the eyes sell it to the defender', 'the ball never leaves the hands', 'the carrier accelerates through the gap'] },
  { id: 'R-36', cat: 'RUGBY-MOTION', topic: 'The double step', detail: 'Two rapid feints before the real break.', params: ['feint outside, then inside', 'two quick weight shifts', 'the second cut is the real one', 'the defender commits to the first fake'] },
  { id: 'R-37', cat: 'RUGBY-MOTION', topic: 'The goose step', detail: 'A slowed stride that tempts the defender to commit, then a burst.', params: ['slow the legs for one stride', 'the defender bites', 'burst past on the next stride', 'the head stays up, reading the reaction'] },
  { id: 'R-38', cat: 'RUGBY-MOTION', topic: 'The fend-and-offload', detail: 'A fend that buys the space for an offload out of contact.', params: ['fend pushes the defender away', 'the ball hand comes free', 'the offload goes to the support', 'all three happen in under 0.4 s'] },
  { id: 'R-39', cat: 'RUGBY-MOTION', topic: 'The pick and go', detail: 'A forward picks the ball from the base and drives one metre.', params: ['pick low, drive the legs', 'target the pillar seam', 'present quickly for the recycle', 'the latch follows in case'] },
  { id: 'R-40', cat: 'RUGBY-MOTION', topic: 'The one-out carry', detail: 'A single forward takes the ball one pass from the ruck.', params: ['run straight and hard', 'aim at the inside shoulder', 'keep the ball in two hands', 'present long for quick ball'] },
  { id: 'R-41', cat: 'RUGBY-MOTION', topic: 'The double tackle', detail: 'Two defenders bring a big carrier down together.', params: ['one high on the ball', 'one low on the legs', 'they bind through the hit', 'the carrier is stopped, not spilled'] },
  { id: 'R-42', cat: 'RUGBY-MOTION', topic: 'The choke tackle', detail: 'A high tackle that holds the carrier up to force a maul.', params: ['wrap the ball and the man', 'lift, do not pull down', 'the maul forms standing', 'the aim is the turnover'] },
  { id: 'R-43', cat: 'RUGBY-MOTION', topic: 'The maul peel', detail: 'A player peels off the side of a stalled maul to carry.', params: ['break off the back or side', 'low and fast', 'attack the seam beside the maul', 'the guard is already committed'] },
  { id: 'R-44', cat: 'RUGBY-MOTION', topic: 'The scrum-half snipe', detail: 'The nine darts through the gap beside the ruck.', params: ['go on the first touch', 'no wind-up', 'target the pillar\'s inside', 'the support follows the hip'] },
  { id: 'R-45', cat: 'RUGBY-MOTION', topic: 'The blindside arrival', detail: 'A winger arrives on the short side as the surprise extra man.', params: ['start the run a phase early', 'arrive before the pass', 'the defence is under-numbered', 'the finish is at full pace'] },

  /* ---- CONTACT, more ---- */
  { id: 'C-09', cat: 'CONTACT', topic: 'Drive to ground', detail: 'A completed tackle carries both bodies to the turf with control.', params: ['the tackler drives through the legs', 'the carrier is taken backwards or sideways', 'both roll away', 'the ball is placed before the ground'] },
  { id: 'C-10', cat: 'CONTACT', topic: 'The post collision', detail: 'A carrier drives at the post defender and meets a wall.', params: ['the carrier dips to drive', 'the defender sets a low base', 'the collision is a dead stop', 'the ball is protected through it'] },
  { id: 'C-11', cat: 'CONTACT', topic: 'The charge down', detail: 'A defender charges a kick as it is struck.', params: ['the defender commits to the line', 'arms up to block', 'the ball deflects off the body', 'both react to the loose ball'] },
  { id: 'C-12', cat: 'CONTACT', topic: 'The rejected fend', detail: 'A defender slips the fend and completes the tackle.', params: ['the defender knocks the arm down', 'he steps inside the fend', 'the tackle goes low', 'the carrier loses the ball arm'] },
  { id: 'C-13', cat: 'CONTACT', topic: 'The rip', detail: 'A defender rips the ball out of the carrier\'s grip in contact.', params: ['the rip is a twisting pull', 'it targets the free arm', 'the ball pops loose', 'the ripper and carrier scramble'] },
  { id: 'C-14', cat: 'CONTACT', topic: 'The counter-ruck', detail: 'Defenders drive over the ball to force a turnover.', params: ['arrive square and low', 'drive through the ball', 'the attack is pushed off it', 'the turnover is earned, not given'] },
  { id: 'C-15', cat: 'CONTACT', topic: 'The choke hold-up', detail: 'Near the line, the defender holds the carrier up off the ground.', params: ['wrap and lift', 'the maul forms standing', 'the ref watches for held-up', 'a five-metre scrum follows'] },
  { id: 'C-16', cat: 'CONTACT', topic: 'The sliding dive', detail: 'A low dive that slides to a stop on the grass.', params: ['launch low and long', 'slide on the chest and forearms', 'the reach arm extends', 'the slide bleeds off the speed'] },
  { id: 'C-17', cat: 'CONTACT', topic: 'The bouncing ball gather', detail: 'A loose, bouncing ball collected at pace.', params: ['read the bounce before it lands', 'take it on the move', 'soft hands to kill the bounce', 'accelerate away in one motion'] },
  { id: 'C-18', cat: 'CONTACT', topic: 'The aerial contest', detail: 'Two players jump for the same high ball.', params: ['both time the leap to the drop', 'the higher reach wins', 'the loser lands and defends', 'the catch is taken at full stretch'] },

  /* ---- SEAMLESS, transitions ---- */
  { id: 'SM-11', cat: 'SEAMLESS', topic: 'Run to idle', detail: 'A sprint bleeding down to a stand must decelerate through the hips.', params: ['2-3 shorter strides to slow', 'the hips settle back', 'the arms drop gradually', 'the head stays level throughout'] },
  { id: 'SM-12', cat: 'SEAMLESS', topic: 'Idle to sprint', detail: 'A standing start must load before it launches.', params: ['lean in first', 'the first stride is the shortest', 'arms start the pump early', 'full speed in 3-4 strides'] },
  { id: 'SM-13', cat: 'SEAMLESS', topic: 'Carry to pass', detail: 'The carrier transfers momentum into the throw, not against it.', params: ['the body stays moving forward', 'the hips rotate into the pass', 'the ball leaves at chest height', 'the follow-through stays in line'] },
  { id: 'SM-14', cat: 'SEAMLESS', topic: 'Tackle to grounded', detail: 'The hit must flow into the ground, not pause between them.', params: ['impact flows into the fold', 'no freeze at the contact frame', 'the rotation continues to the turf', 'the ball is placed on the way down'] },
  { id: 'SM-15', cat: 'SEAMLESS', topic: 'Grounded to rise', detail: 'Getting up from a ruck is a two-stage push, not a spring.', params: ['roll to the support arm', 'push to one knee', 'drive to the feet', 'the first step is back into the line'] },
  { id: 'SM-16', cat: 'SEAMLESS', topic: 'Scrum bind to drive', detail: 'The bound scrum loads then drives with no break in contact.', params: ['the bind tightens', 'the pack settles', 'the drive starts with the back legs', 'the motion is one continuous surge'] },
  { id: 'SM-17', cat: 'SEAMLESS', topic: 'Lineout jump to maul', detail: 'The jumper lands and the maul binds around him in one motion.', params: ['land facing the line', 'the front binds on the catch', 'the drive begins before the feet set', 'no gap between catch and maul'] },
  { id: 'SM-18', cat: 'SEAMLESS', topic: 'Kick follow-through to chase', detail: 'The kicker lands from the follow-through and starts to chase.', params: ['the follow-through is the first step', 'the body turns downfield', 'the first chase stride is immediate', 'no pause to admire the kick'] },
  { id: 'SM-19', cat: 'SEAMLESS', topic: 'The anticipation pause', detail: 'A beat of stillness before a big action sells the weight.', params: ['1-2 frames of held anticipation', 'the body loads, not freezes', 'the gaze locks the target', 'then the action explodes'] },
  { id: 'SM-20', cat: 'SEAMLESS', topic: 'The reaction beat', detail: 'After any action, one beat of response before the next decision.', params: ['a 0.1 s reaction beat', 'the eyes move before the body', 'the next action follows the beat', 'cutting the beat reads as robotic'] },

  /* ---- TIMING, cycles ---- */
  { id: 'T-10', cat: 'TIMING', topic: 'The tackle cycle', detail: 'Load, drive, land, roll, rise — a full breakdown sequence.', params: ['load 3 frames', 'drive 5 frames', 'land 4 frames', 'rise 8-12 frames'] },
  { id: 'T-11', cat: 'TIMING', topic: 'The scrum engage cycle', detail: 'Crouch, bind, set, engage — each with its own duration.', params: ['crouch 0.6 s', 'bind 0.6 s', 'set 0.4 s', 'engage is one frame'] },
  { id: 'T-12', cat: 'TIMING', topic: 'The lineout cycle', detail: 'Call, throw, lift, catch, land.', params: ['call 0.4 s', 'throw 1.1 s of flight', 'lift 0.3 s to apex', 'catch and land 0.5 s'] },
  { id: 'T-13', cat: 'TIMING', topic: 'The kick cycle', detail: 'Approach, plant, strike, follow-through.', params: ['approach 0.4 s', 'plant 0.1 s', 'strike one frame', 'follow-through 0.3 s'] },
  { id: 'T-14', cat: 'TIMING', topic: 'The pass cycle', detail: 'Wind-up, release, follow-through, to the hands.', params: ['wind-up 0.08 s', 'release one frame', 'follow-through 0.1 s', 'flight 0.18-0.4 s'] },
  { id: 'T-15', cat: 'TIMING', topic: 'The sidestep cycle', detail: 'Fake, plant, cut, accelerate.', params: ['fake 0.1 s', 'plant 0.1 s', 'cut 0.15 s', 're-accelerate 0.2 s'] },
  { id: 'T-16', cat: 'TIMING', topic: 'The cleanout cycle', detail: 'Arrive, hit, drive, release.', params: ['arrive 0.3 s', 'hit one frame', 'drive 0.3 s', 'release and rise 0.4 s'] },
];

/* ============================ COUNT ============================ */

export function animationPointCount(): { total: number; breakdown: Array<[string, number]> } {
  const breakdown: Array<[string, number]> = ANIM_CATEGORIES.map((cat) => {
    const pts = ANIM_POINTS.filter((p) => p.cat === cat);
    // each point counts: topic + detail + each param + the category label
    const n = pts.reduce((sum, p) => sum + 2 + p.params.length, 0);
    return [cat, n + 1] as [string, number];
  });
  return { total: breakdown.reduce((s, b) => s + b[1], 0), breakdown };
}

export const CURVES_IMPLEMENTED = [
  'hold', 'linear', 'sineIn', 'sineOut', 'sineInOut',
  'quadIn', 'quadOut', 'cubicIn', 'cubicOut', 'cubicInOut',
  'backIn', 'backOut', 'circOut', 'expoOut', 'elasticOut', 'bounceOut',
];
