/**
 * ThreePlayerManager — loads, pools, skins and animates the 3D rugby squad.
 *
 * One GLB (public/assets/models/rugby_player.glb) is built from Quaternius'
 * CC0 *Universal Base Characters* male mesh plus the *Universal Animation
 * Library* clips (see tools/build_player_glb.py + CREDITS.txt). It loads once;
 * every one of the 30 players (plus the referee) is a SkeletonUtils.clone()
 * with its own AnimationMixer, kit colours and squad-number badge.
 *
 * The body SkinnedMesh is split into five material regions (Jersey, Shorts,
 * Socks, Skin, Boots) by skinning-weight analysis so kits can be recoloured;
 * the NumberBadge is a small plane bound to the upper-back spine bone and
 * painted with a 128x128 canvas texture.
 *
 * Animation is a small state machine over the clips the GLB ships:
 *   idle Idle · walk Walk · run Run · sprint Sprint · pass Pass(OverhandThrow)
 *   tackle Tackle(Hit_Knockback) · grounded Death · getup GetUp(LayToIdle)
 *   try Slide(Start+Loop) · dive SlideStart · kick Kick(Interact)
 *   maul/scrum/ruck Push · crouch Crouch · jump JumpLand.
 * Locomotion speed scales the mixer timeScale; one-shots crossFade back.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Director, Actor } from '../game/director';
import type { ElbowHand as BallCraftArm } from '../game/engine/ballcraft';
import { RECOVER_SECONDS } from '../game/director';
import { RENDER_SCALE, Camera, View } from './retro';
import { scrumFacing } from '../game/behaviour/setpiece-overrides';
import { Ragdoll } from './ragdoll';
import { NODE_COUNT, NODE } from './ragdollKernel';
import { RagdollPlayback, pickClip } from './ragdollClips';
import { resolveRagBones, captureRestDirs, seedFromPose, driveRig } from './ragdollRig';
import type { RagBones, RestDirs } from './ragdollRig';
import { renderHealth, noteRenderFault } from './ThreeCanvas';
import { turfRiseM } from './ThreeEnvironment';

/* Absolute path from the origin root. `public/assets/models/` is served by
 * Vite at `/assets/models/`, which is also the URL the preload link in
 * index.html warms, so the loader's own fetch reuses that cached response.
 * A root-relative URL (rather than a document-relative one) means the fetch
 * cannot resolve against a client-side route path and 404 — which is what
 * silently degraded a live match to shadow-and-number-only stand-in bodies. */
const MODEL_URL = '/assets/models/rugby_player.glb';
/* Retargeted Mixamo tackle pair, baked by tools/fetch_mixamo.mjs. Animation
 * only (~90 KB, no meshes) — it rides on the player rig loaded above. */
/**
 * The rig's bytes, fetched once per page.
 *
 * Two things make this worth a module-level cache rather than a per-manager load.
 * React StrictMode mounts the match tree twice in dev, and the player model is 6.3 MB
 * — so the double boot downloaded the squad twice, through the dev proxy, before the
 * first frame. And a re-boot (a change on the options screen rebuilds the canvas) paid
 * it again, which is how a session that is "very slow" stays slow.
 *
 * A failed fetch is deliberately NOT cached: `rigBytes` is cleared on the way out so
 * the next boot tries again, because in a sandboxed preview a first request can fail
 * for a reason that has already gone away. What is cached is the success.
 */
/* Retargeted Mixamo tackle pair, baked by tools/fetch_mixamo.mjs. Animation
 * only (~90 KB, no meshes) — it rides on the player rig loaded above. */
const TACKLE_PAIR_URL = '/assets/models/tackle_pair.glb';

function cached(url: string): () => Promise<ArrayBuffer> {
  let p: Promise<ArrayBuffer> | null = null;
  return () => {
    if (!p) {
      p = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} — HTTP ${res.status}`);
        return await res.arrayBuffer();
      })().catch((e) => { p = null; throw e; });
    }
    return p;
  };
}
const rigBytes = cached(MODEL_URL);
const pairBytes = cached(TACKLE_PAIR_URL);

/* ---------------------------------------------------------------- kits --- */
export type KitTeam = 'A' | 'B' | 'REF';

interface Kit {
  jersey: string; shorts: string; socks: string;
  /** panel colour behind the squad-number texture */
  badgePanel: string;
  boot: string;
}

/** England (A) white kit, New Zealand (B) all-black, referee yellow. */
export const KITS: Record<KitTeam, Kit> = {
  A:   { jersey: '#FFFFFF', shorts: '#1A1A24', socks: '#FFFFFF', badgePanel: '#f4f2e8', boot: '#17181d' },
  B:   { jersey: '#111111', shorts: '#111111', socks: '#111111', badgePanel: '#16161a', boot: '#0c0c0e' },
  REF: { jersey: '#e8cf46', shorts: '#23232c', socks: '#e8cf46', badgePanel: '#f2df8a', boot: '#17181d' },
};

const SKINS = ['#e8b98f', '#c99468', '#8c5a38', '#5f3a22', '#f2cfa8'];

/* -------------------------------------------------------------- regions -- */
/** Material slots, per the asset spec. */
type Slot = 'jersey' | 'shorts' | 'socks' | 'skin' | 'boots' | 'hair' | 'eyes';
const SLOTS: Slot[] = ['jersey', 'shorts', 'socks', 'skin', 'boots'];
const TEMPLATE_SLOT_MAT: Record<Slot, string> = {
  jersey: 'TPL_jersey', shorts: 'TPL_shorts', socks: 'TPL_socks',
  skin: 'TPL_skin', boots: 'TPL_boots', hair: 'MI_Hair_1', eyes: 'MI_Eyes',
};



/* ============ PROCEDURAL POSTURE LAYER (and where it hands over) ============
 *
 * Canned clips cannot know how far apart two men are, how fast they are
 * travelling or which way they are twisting, so a latch built purely out of
 * them reads as a hug between two statues. The chaos is written ON TOP of the
 * sampled pose, every frame, in three layers:
 *
 *   1  BODY TILT    the whole mesh pitches forward into the carrier, so the
 *                   tackler is flying horizontally rather than standing up
 *   2  ARM POINTING the tackler's arm bones are aimed at the carrier's spine
 *                   in world space, so his hands track the man he is holding
 *   3  SPINE THRASH a velocity-scaled sine injected into the carrier's spine
 *                   and neck, so he fights and lurches under the weight
 *
 * WHAT THIS LAYER NO LONGER OWNS: the ground. A pose pitched 78 degrees forward
 * is a man who is falling, not a man who HAS fallen, and no amount of sine on
 * the spine convinces anyone he hit the deck. From the GROUNDING stage of a
 * tackle the whole body is handed to `render/ragdoll.ts` — a small
 * position-based solver whose particles are this skeleton's bones, so it
 * overrides where each bone POINTS and leaves the clip its twist. Two rules
 * make the two systems coexist, and both are load-bearing:
 *
 *   - the solver writes bone quaternions AFTER `applyProcedural`, never before
 *     (a blend whose input is its own last output is a feedback loop, and the
 *     head can be measured whipping at 29 m/s with the physics asleep);
 *   - `applyProcedural` stands aside once `proc.ragW` passes 0.30, keeping only
 *     the arm reach, because tilt/dip/thrash aimed at the same bones the solver
 *     is solving is an argument the pose loses by whichever ran last.
 *
 * ORDER IS EVERYTHING. `mixer.update()` OVERWRITES every bone it animates,
 * and this rig's clips animate the whole spine and both arms (65 tracks,
 * confirmed against the GLB). So all three layers must be applied AFTER the
 * mixer has sampled the frame, and re-applied from scratch on the next one —
 * they are a post-process on the pose, never a stored state on the bone.
 *
 * ── BONE NAMING: THIS RIG IS NOT A MIXAMO RIG ─────────────────────────────
 * The brief names Mixamo bones (`Spine1`, `RightArm`, `Hips`). This model is
 * Quaternius' Universal Base Character, which uses the UNREAL skeleton
 * convention, so those lookups would every one of them return undefined and
 * the whole layer would silently do nothing:
 *
 *      Mixamo            this rig
 *      Hips              pelvis
 *      Spine / Spine1    spine_01 / spine_02 / spine_03
 *      Neck              neck_01
 *      RightArm          upperarm_r      LeftArm       upperarm_l
 *      RightForeArm      lowerarm_r      LeftForeArm   lowerarm_l
 *      RightHand         hand_r          LeftHand      hand_l
 *
 * Equally important: Unreal bones point down their local +Y axis, not -Z, so
 * `Object3D.lookAt()` — which aims local +Z — twists an arm sideways into the
 * chest. The reach below therefore uses `setFromUnitVectors` on the bone's
 * own +Y, which is the correct generalisation of "point this bone at that
 * point" for any rig.
 */

/** The bones the procedural layer drives, resolved once per player. */
interface ProceduralRig {
  pelvis: THREE.Bone | null;
  spine: (THREE.Bone | null)[];
  neck: THREE.Bone | null;
  upperArms: (THREE.Bone | null)[];
  foreArms: (THREE.Bone | null)[];
}

/** Unreal-convention bone names, with the Mixamo spellings as fallbacks so a
 *  future re-export against a Mixamo rig keeps working without a code change. */
const BONE_NAMES = {
  pelvis: ['pelvis', 'Hips', 'mixamorigHips'],
  spine: [
    ['spine_01', 'Spine', 'mixamorigSpine'],
    ['spine_02', 'Spine1', 'mixamorigSpine1'],
    ['spine_03', 'Spine2', 'mixamorigSpine2'],
  ],
  neck: ['neck_01', 'Neck', 'mixamorigNeck'],
  upperArms: [
    ['upperarm_r', 'RightArm', 'mixamorigRightArm'],
    ['upperarm_l', 'LeftArm', 'mixamorigLeftArm'],
  ],
  foreArms: [
    ['lowerarm_r', 'RightForeArm', 'mixamorigRightForeArm'],
    ['lowerarm_l', 'LeftForeArm', 'mixamorigLeftForeArm'],
  ],
};

/* --- tuning ------------------------------------------------------------- */

/** Maximum forward pitch of a diving tackler, radians (~63 degrees). */
const TILT_MAX = 1.1;
/** Pitch held once the pair are on the ground — flat, face down. */
const TILT_GROUNDED = Math.PI / 2 - 0.12;
/** Distance at which a tackler is fully committed/horizontal, metres. */
const TILT_FULL_RANGE = 0.55;
/** Distance beyond which he is upright again, metres. */
const TILT_NO_RANGE = 2.2;
/** How fast the tilt tracks its target (higher = snappier). */
const TILT_RATE = 9;

/** How far the arm bones may be pulled from their animated pose, 0..1. */
const REACH_WEIGHT = 0.78;
/** the non-leading arm reaches at this fraction of the lead arm's weight */
const REACH_TRAIL = 0.55;
/** the waist is this far below the pelvis bone — a tackle goes in low */
const LATCH_WAIST_DROP = 0.15;
/** reach weight ramp: full commitment at this range, REACH_MIN at NO_RANGE */
const REACH_FULL_RANGE = 0.8;
const REACH_NO_RANGE = 3.0;
const REACH_MIN = 0.2;
/** forward pitch of the torso when fully committed to a reach, radians */
const DIP_MAX = 0.52;          // ~30 deg, spread over spine_01/02 + neck
const DIP_RATE = 9;
const REACH_RATE = 12;

/** Peak spine thrash, radians, at full sprint. */
const THRASH_MAX = 0.3;
/** Thrash frequency, radians per second. */
const THRASH_FREQ = 15;
const THRASH_RATE = 10;
/** Speed the thrash is scaled against — a rough top sprint, m/s. */
const THRASH_REF_SPEED = 9;

/* --- scratch objects. Allocated once; a per-frame `new` here would be
 *     thirty vectors a frame per player and a guaranteed GC stutter. ------ */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
/** the reach target. MUST NOT be one of the vectors applyArmReach writes —
 *  passing `_v1` as the target had every arm aiming at its own shoulder. */
const _target = new THREE.Vector3();
/** THE BALL as a reach target. Kept separate from `_target` for the same reason
 *  the comment above was written: at a ruck a man's arms may be aimed at the ball
 *  and at a body in the same frame, and one scratch shared by both is one of the
 *  two aiming at the other. */
const _ballAim = new THREE.Vector3();
/** how hard the solved elbow is written onto the forearm. Not 1: the clip's own
 *  elbow curve is still the animation, and an override that replaces it makes a
 *  reaching man look like a stop-motion puppet for as long as he holds the button. */
const CRAFT_ELBOW_WEIGHT = 0.62;
/** how far a man with hands on the ball pitches his chest over it, radians.
 *  Deliberately near the diving tackler's own tilt: the jackal's whole skill is
 *  getting his body between the defence and the ball, and an upright man reaching
 *  down at a ruck is the pose this game used to hold at every breakdown. */
const HAND_OVER_BALL_TILT = 0.52;
/** below this engine reach weight the hands are not committed and the arms are
 *  left to the animation. 0.15 is where a man one stride out sits; without the
 *  floor every body in a five-metre radius of a ruck waves at the ball. */
const HAND_MIN = 0.15;
/** reused rotation scratch, so the reach allocates nothing per bone */
const _qBone = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _mat = new THREE.Matrix4();

/* -------------------------------------------------------------- instance -- */
interface PlayerInstance {
  actor: Actor;
  team: KitTeam;
  num: number;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  badgeMat: THREE.MeshBasicMaterial;
  /** cached carrying-hand socket bone (Part 1 ball socketing); null = none */
  handBone?: THREE.Bone | null;
  /** contact shadow, kept flat on the turf while the body tilts (procedural) */
  shadow?: THREE.Mesh;
  /** Per-instance kit materials, so the shirt can be dirtied. The template's
   *  materials are shared; these are the clones made in `spawn`. */
  kitMats: Partial<Record<Slot, THREE.MeshStandardMaterial>>;
  /** Unsoiled kit colour and roughness — the base every soiling pass reads. */
  kitBase: Partial<Record<Slot, { color: THREE.Color; rough: number }>>;
  /** 0..1 accumulated ground staining. It never washes off: nothing does. */
  soil: number;
  /** The soil value the kit materials were last painted at. */
  soilShown: number;
  /** lazily-resolved procedural bone set — see resolveRig() */
  rig?: ProceduralRig;
  /** the solved fall, or null while the clip owns this man (render/ragdoll.ts) */
  rag?: Ragdoll | null;
  /** lazily-resolved ragdoll bone set and its rest directions */
  ragBones?: RagBones;
  ragRest?: RestDirs;
  /** the fall being replayed, or null when animation owns this body */
  ragPlay?: RagdollPlayback | null;
  /** playback speed, so identical takes do not move in lockstep */
  ragRate: number;
  /** 0..1 authority the solver has over the rig; ramps at both ends */
  ragBlend: number;
  /** world point (metres) the fall was seeded at — physics is a delta on this */
  ragOrigin?: THREE.Vector3;
  /** smoothed procedural state, so nothing pops between frames */
  proc: {
    /** current forward pitch of the whole body, radians */
    tilt: number;
    /** 0..1 weight of the arm-pointing override */
    reach: number;
    /** 0..1 weight of the spine thrash */
    thrash: number;
    /** 0..1 weight of the forward torso dip as he closes on the waist */
    dip: number;
    /** SPEC_25 — 1 while the catch/punt IK owns this man's arms, else 0. A separate
     *  weight from `reach` because the latch and the catch aim at different things and
     *  a latch must not be able to cancel a catch mid-air. */
    craftW: number;
    /** the solved elbow/hand pairs, in pitch metres, for the forearm pass. Plain
     *  numbers rather than THREE.Vector3s: this is written every frame for one player
     *  and allocating six fields a frame in the hot path is how a GC pause gets made. */
    craftL: BallCraftArm | null;
    craftR: BallCraftArm | null;
    /** free-running phase for the wobble, so two men never wobble in sync */
    phase: number;
    /** 0..1 how much of this man's pose the fall solver owns */
    ragW: number;
    /** T-41 the lean a shove has bought him, radians, see applyBalance */
    stagA: number;
    /** the FSM state resolved this frame, for the post-mixer pass */
    state: string;
  };
  active: { name: string; action: THREE.AnimationAction } | null;
  st: {
    oneShot: string | null;      // non-looping/locked clip state
    lock: number;                // seconds left to hold the one-shot
    lie: boolean;                // grounded until an engine 'getup'/motion
    /** T-41 balance recovery: how far off centre a shove put him (0..1) and the
     *  world direction of the shove, held so the lean can outlive the frame. */
    jerk: number; jx: number; jz: number;
    lx: number; lz: number;
    spd: number;
    face: number;                // smoothed heading, radians
    /* PART 1 — THE ONE-SHOT LATCH. A `pass` that is re-`play()`ed on the
     * frames after the first restarts the clip, which is what read as the
     * throw looping three times in a third of a second. Once the latch is
     * set nothing may call play() on that state again until the engine
     * leaves it. */
    passLatched: boolean;
    /* PART 2 — the multi-stage tackle timeline, in seconds since impact.
     * −1 when no tackle is running. */
    tackleT: number;
    /** which side of the collision this man is on, for the stage clips */
    tackleRole: 'TACKLER' | 'CARRIER' | null;
    /** true when the engine classed this collision as a standing takedown */
    standingHit: boolean;
    /** streamed velocity in pitch metres/second, the fall's initial conditions */
    svx: number; svz: number;
    /** one-shot latch: the ragdoll fires once per takedown, not once per frame */
    ragFired: boolean;
    /** playhead of the tackle clip, carried across stage boundaries so a
     *  single authentic clip runs on instead of restarting each stage. */
    tackleClipT: number;
    /** HANDS — the engine's own verdict (engine/hands.ts) on this man's reach for
     *  the ball and his strip progress, 0..1 each. Zero outside a breakdown. */
    hand: number; strip: number;
  };
}

/* PART 2 — TACKLE ANIMATION TIMELINE (seconds from the impact frame).
 *   0.00 – 0.15  IMPACT     tackler drives, carrier reacts to the hit
 *   0.15 – 0.40  GROUNDING  both crossfade to the fall
 *   > 0.40       RUCK PREP  carrier presents prone, tackler rolls away
 * The physics half of the same window lives in engine/breakdown.ts, which
 * shares the carrier's dampened momentum between the two men for 0.3 s so
 * they slide forward together instead of stopping dead. */
export const TACKLE_IMPACT_END = 0.15;
export const TACKLE_GROUND_END = 0.40;

/* LATCH-AND-DRAG — the churn rate. The carrier's Run clip is played well
 * under the speed it was authored for while he is held, so his legs labour
 * and drive rather than stride: a man fighting through contact, not a man
 * jogging. Slow enough to read as effort, fast enough not to read as slow
 * motion. */
export const LATCH_CHURN_RATE = 0.72;

/* ================================================================== */
/**
 * IN-PLACE CONVERSION — strip horizontal root motion from every clip.
 *
 * This is the "In-Place" checkbox, done in code. The 2D engine owns all
 * spatial movement: `breakdown.ts` slides the pair through the 0.3 s
 * kinetic-impact window and `latch.ts` snaps the defender onto the carrier's
 * hip, and then `update()` writes `root.position` from `a.rx/a.rz` every
 * frame. Any horizontal travel baked into the clip is therefore applied a
 * SECOND time, on top of the engine's — the double-movement that reads as
 * skating and rolling in place.
 *
 * Measured travel on the shipped rig before this ran:
 *   DiveRoll 1.10 m, GetUp 0.85 m, Death 0.83 m, Tackle 0.82 m,
 *   SlideStart/SlideExit 0.78 m, JumpLand 0.50 m, Run 0.24 m.
 *
 * Only X and Z are flattened, and only on the root-most translated bone
 * (`pelvis`). Y is DELIBERATELY LEFT ALONE: the vertical drop of the hips is
 * how a fall reads as a fall, and it is what replaces the procedural pivot
 * lift during a tackle. Rotation tracks are untouched.
 */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const out = clip.clone();
  for (const track of out.tracks) {
    const [bone, prop] = track.name.split('.');
    if (prop !== 'position') continue;
    if (bone !== 'pelvis' && bone !== 'Hips' && bone !== 'mixamorigHips'
      && bone !== 'root' && bone !== 'Armature') continue;
    const v = track.values;            // flat [x,y,z, x,y,z, ...]
    const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return out;
}

/** Region of a body vertex from its dominant skinning bone + rest height. */
function boneRegion(boneName: string, restY: number): Slot {
  // foot + toe ("ball_*") bones: boot over the foot, sock cuff at the ankle.
  if (/^(foot_|ball_[lr]|toe)/.test(boneName) || /^ball_leaf/.test(boneName)) {
    return restY < 0.20 ? 'boots' : 'socks';
  }
  // calf: sock up to the knee; calf bone origin sits at ~0.54 (knee).
  if (/^calf_/.test(boneName)) return restY < 0.55 ? 'socks' : 'skin';
  if (/^thigh_/.test(boneName)) return restY > 0.70 ? 'shorts' : 'skin';
  if (/^(root|pelvis|spine|neck)/.test(boneName)) return 'jersey';
  if (/^(Head|index_|middle_|ring_|pinky_|thumb_)/.test(boneName)) return 'skin';
  if (/^(clavicle|upperarm|lowerarm|hand_)/.test(boneName)) {
    return /^clavicle_/.test(boneName) ? 'jersey' : 'skin';
  }
  return 'jersey';
}

export class ThreePlayerManager {
  ready = false;
  private template: THREE.Group | null = null;
  private templateClips: THREE.AnimationClip[] = [];
  private pool = new Map<string, PlayerInstance>();
  private readonly scene: THREE.Scene;
  private ball: THREE.Group;
  private shadowGeo: THREE.CircleGeometry;
  private shadowMat: THREE.MeshBasicMaterial;
  /* --- match day (SPEC_24): soiling and wetness, driven from conditions --- */
  private soilRate = 0;
  private wetLevel = 0;
  private ballMat: THREE.MeshStandardMaterial | null = null;
  private static readonly MUD = new THREE.Color('#5a4227');
  private static readonly SOAK = new THREE.Color('#0e1620');
  private badgeTextures = new Map<string, THREE.Texture>();
  /* RAGDOLL. Two fall systems, one per tier.
   *
   *   STANDARD and FULL   `render/ragdoll.ts`, solved live at 0.08 ms/frame for
   *                       eight bodies at once. It can be seeded from THIS pose,
   *                       aimed at THIS opponent, and told how hard the man was
   *                       actually moving — which is the whole difference between
   *                       a fall and a repeat of a fall.
   *   LEGACY              the falls are PRECOMPUTED (scripts/ragdollbake) and
   *                       replayed — see ragdollClips.ts. A table lookup and a yaw
   *                       rotation, so the tier that cannot afford a solve still
   *                       gets a body that obeys the ground.
   *
   * The kernel the library was baked from lives in `render/ragdollKernel.ts`, and
   * stays there: it is a solver with no view in it, which is what makes it both
   * bakes well and testable at 10,000 falls a second. */
  private ragSeed = new Float32Array(NODE_COUNT * 3);
  /** Master switch — GRAPHICS: PERFORMANCE turns physics fall-down off. */
  ragdollEnabled = true;

  constructor(three: import('./ThreeCanvas').ThreeCanvas) {
    this.scene = three.scene;

    /* Lighting is owned entirely by ThreeEnvironment (sun + hemi + ambient +
     * bounce + floodlights), so that the key direction, the visible sun in the
     * sky dome and the cast shadows can never disagree. Adding a second key
     * here — as this class used to — flattened every player against a pitch
     * lit from somewhere else. */

    /* The blob shadow survives as a CONTACT shadow only: a small, tight, dark
     * ellipse right under the boots. Real cast shadows (from the sun) handle
     * the long throw; this just glues the feet to the turf, which shadow maps
     * at this range are too coarse to do on their own. */
    this.shadowGeo = new THREE.CircleGeometry(0.34, 20);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x0a0c10, transparent: true, opacity: 0.34, depthWrite: false,
    });

    this.ball = this.buildBall();
    this.scene.add(this.ball);
  }

  /* ------------------------------------------------------------ loading -- */
  /**
   * Load the squad rig, once per page, and let every kind of failure LOUD.
   *
   * This used to be a `new Promise` around `loader.load`, which had a hole with a
   * very specific shape: the success callback was `async`, so anything it threw —
   * a split that choked on an unexpected skeleton, a clip track the root-motion
   * stripper could not read — rejected the *inner* promise that nobody was holding.
   * The outer one was neither resolved nor rejected. It stayed pending forever, the
   * boot sat at 66% on "Bringing out the teams", the loading overlay never
   * cleared, and the 2D layer — which can carry this match by itself — was never
   * told to. Nothing in the engine hung; a promise that cannot settle hung.
   *
   * `async`/`await` closes that permanently, because a throw in a body like this IS
   * the rejection of the returned promise: there is no second promise to lose. The
   * rule is worth stating in the file it was learned in: **a stage of a staged boot
   * must be unable to sit pending**, either by settling on every path or by being
   * raced by a caller with a budget.
   */
  async load(): Promise<void> {
    const loader = new GLTFLoader();
    try {
      /* The bytes come from a page-level cache (see `rigBytes`) and the parse is
       * per-manager, because `prepareTemplate` mutates what it is given — a shared
       * template would be split twice. So the network is paid once and the CPU
       * twice, which is the right way round in a dev server where React StrictMode
       * deliberately mounts this tree twice. */
      const [buf, pairBuf] = await Promise.all([
        rigBytes(),
        // optional asset: absent means fall back to the stand-in tackle clips
        pairBytes().catch(() => null),
      ]);
      const gltf: GLTF = await loader.parseAsync(buf, '');
      this.template = gltf.scene;
      const base = gltf.animations.map(stripRootMotion);
      /* The retargeted pair is already in-place (the tool drops the source's
       * horizontal channel) so it does NOT go through stripRootMotion again;
       * doing so would be harmless but pointless. It is loaded second and
       * concatenated, so `MX_Tackle` / `MX_TackleReact` simply become two
       * more entries in the same clip table. */
      let extra: THREE.AnimationClip[] | null = null;
      if (pairBuf) extra = (await loader.parseAsync(pairBuf, '') as GLTF).animations;
      if (extra && extra.length) {
        this.templateClips = base.concat(extra);
      } else {
        this.templateClips = base;
        if (import.meta.env?.DEV) {
          console.warn('[players] tackle_pair.glb missing — falling back to the '
            + 'stand-in tackle clips. Run: node tools/fetch_mixamo.mjs');
        }
      }
      this.prepareTemplate();
      this.checkRecoverSeconds();
      this.ready = true;
      renderHealth.bodies = 'glb';
      /* The real rig is here: retire the boxes that were standing in for it,
       * including the case where the fetch resolved after kick-off. */
      this.clearStandIn();
    } catch (e) {
      /* `ready` stays false, so `updateStandIn` owns the frame from here on.
       * The match is playable and it is legible, and the reason is on screen
       * as well as in the console. The rethrow is not for this class — it is so
       * the boot can tell a lost asset from a stalled one, and so a caller with a
       * budget can carry on either way. */
      renderHealth.bodies = 'standin';
      noteRenderFault('player GLB — procedural bodies standing in', e);
      throw e;
    }
  }

  /**
   * Split the template's body SkinnedMesh into five region SkinnedMeshes that
   * share its skeleton & bind matrix (so skinning is unchanged), recolour the
   * face/hair, and bind the number-badge plane to the upper-back bone.
   */
  private prepareTemplate() {
    const root = this.template!;

    // Bug-fix #5a: reset every skeleton to its bind/rest pose BEFORE cloning
    // or splitting, so no clip-residual bone transform leaks into the mesh
    // geometry split (the elastic "stretched vertex between the feet").
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh && mesh.skeleton) mesh.skeleton.pose();
    });

    root.scale.setScalar(RENDER_SCALE);
    root.updateMatrixWorld(true);

    // Unscaled rest-pose height of every bone, for the shorts/socks cuts.
    const restY = new Map<string, number>();
    const tmpV = new THREE.Vector3();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        (o as THREE.Bone).getWorldPosition(tmpV);
        restY.set(o.name, tmpV.y / RENDER_SCALE);
      }
    });

    const bodyMats: Record<Slot, THREE.MeshStandardMaterial> = {} as Record<Slot, THREE.MeshStandardMaterial>;
    for (const slot of SLOTS) {
      // Bug-fix #1: fully opaque, front-face only, depth writes ON. Transparent
      // body materials made the renderer disable depth writes and sort limbs
      // inside-out (the "see-through / inverted depth" look).
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.78, metalness: 0.0,
        transparent: false, opacity: 1, depthWrite: true, depthTest: true, side: THREE.FrontSide,
      });
      m.name = TEMPLATE_SLOT_MAT[slot];
      bodyMats[slot] = m;
    }

    const bodies: THREE.SkinnedMesh[] = [];
    const faces: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const matName = (mesh.material as THREE.Material)?.name ?? '';
      if (matName === 'MI_Superhero_Male') bodies.push(mesh);
      else faces.push(mesh);
    });

    for (const body of bodies) {
      const geo = body.geometry;
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const norm = geo.attributes.normal as THREE.BufferAttribute;
      const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
      const jAttr = (geo.attributes.skinIndex ?? (geo.attributes as Record<string, THREE.BufferAttribute>).joints0) as THREE.BufferAttribute | undefined;
      const wAttr = (geo.attributes.skinWeight ?? (geo.attributes as Record<string, THREE.BufferAttribute>).weights0) as THREE.BufferAttribute | undefined;
      const skel = body.skeleton;
      const index = geo.index;

      // Cross-leg weight bleed fix (see sanitizeLegWeights): a calf/foot vertex
      // weighted to the opposite-side ankle stretches across the stride.
      this.sanitizeLegWeights(skel, jAttr, wAttr);

      // Region of each source vertex from its dominant-weight bone.
      const vtxSlot: Slot[] = new Array(pos.count);
      for (let vi = 0; vi < pos.count; vi++) {
        let slot: Slot = 'jersey';
        if (jAttr && wAttr) {
          let best = 0, bestW = -1;
          for (let k = 0; k < 4; k++) {
            const w = wAttr.getComponent(vi, k);
            if (w > bestW) { bestW = w; best = jAttr.getComponent(vi, k); }
          }
          const bName = skel.bones[best]?.name ?? '';
          slot = boneRegion(bName, restY.get(bName) ?? 1);
        }
        vtxSlot[vi] = slot;
      }

      // Walk TRIANGLES and assign each whole triangle to one region (majority
      // of its three vertices). The body mesh is INDEXED; the old path filtered
      // the vertex buffer and emitted it as triangle soup, which discarded the
      // index buffer and scrambled connectivity — that left the holes/gaps in
      // the characters. Emitting per-triangle vertices (duplicating shared
      // verts) keeps every region mesh watertight with correct normals/weights.
      const triCount = index ? index.count / 3 : pos.count / 3;
      const srcIdx = (n: number) => (index ? index.getX(n) : n);
      const buckets = new Map<Slot, number[]>();
      for (let t = 0; t < triCount; t++) {
        const a = srcIdx(t * 3), b = srcIdx(t * 3 + 1), c = srcIdx(t * 3 + 2);
        const sa = vtxSlot[a], sb = vtxSlot[b], sc = vtxSlot[c];
        // majority region; a boundary triangle goes to whichever region owns
        // at least two of its verts (ties fall back to the first vert).
        let slot: Slot = sa;
        if (sb === sc) slot = sb;
        else if (sa === sb || sa === sc) slot = sa;
        if (!buckets.has(slot)) buckets.set(slot, []);
        buckets.get(slot)!.push(a, b, c);
      }

      // Build one SkinnedMesh per region from the triangle soup, keeping the
      // skeleton + bind matrix identical to the source so every clip skins the
      // recoloured regions exactly as the original.
      const bindMatrix = body.bindMatrix.clone();
      const bindMode = body.bindMode;
      const parent = body.parent!;
      for (const slot of SLOTS) {
        const verts = buckets.get(slot);
        if (!verts || verts.length === 0) continue;
        const ng = new THREE.BufferGeometry();
        const np: number[] = [], nn: number[] = [], nu: number[] = [];
        const nj: number[] = [], nw: number[] = [];
        for (const vi of verts) {
          np.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
          nn.push(norm.getX(vi), norm.getY(vi), norm.getZ(vi));
          if (uv) nu.push(uv.getX(vi), uv.getY(vi)); else nu.push(0, 0);
          for (let k = 0; k < 4; k++) {
            nj.push(jAttr ? jAttr.getComponent(vi, k) : 0);
            nw.push(wAttr ? wAttr.getComponent(vi, k) : (k === 0 ? 1 : 0));
          }
        }
        ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
        ng.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
        ng.setAttribute('uv', new THREE.Float32BufferAttribute(nu, 2));
        ng.setAttribute('skinIndex', new THREE.Float32BufferAttribute(nj, 4));
        ng.setAttribute('skinWeight', new THREE.Float32BufferAttribute(nw, 4));
        const m = new THREE.SkinnedMesh(ng, bodyMats[slot]);
        m.bindMode = bindMode;
        m.bind(skel, bindMatrix);
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        m.name = `body_${slot}`;
        parent.add(m);
      }
      parent.remove(body);
      body.geometry.dispose();
    }

    // Face materials: hair dark, eyes light — opaque & front-facing.
    for (const f of faces) {
      /* A skinned face mesh can wander outside its authored bounding sphere as
       * the head bones move; frustum-cull on the stale sphere would blink the
       * eyes/hair off at the edge of frame. Disable it, exactly as the body
       * regions do below. */
      f.frustumCulled = false;
      const matName = (f.material as THREE.Material)?.name ?? '';
      if (matName === 'MI_Hair_1') {
        f.material = new THREE.MeshStandardMaterial({
          color: 0x2a1c14, roughness: 0.62, metalness: 0.0,
          transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide,
        });
      } else if (matName === 'MI_Eyes') {
        f.material = new THREE.MeshBasicMaterial({
          color: 0xf2f2ee, transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide,
        });
      }
    }

    // Number badge — a plane on the UPPER BACK (the model's face/front is +Z,
    // confirmed by the eyes sitting at z>0), bone-bound so it follows the
    // spine through every clip. Opaque decal, front-facing outward.
    const spine = root.getObjectByName('spine_03') ?? root.getObjectByName('spine_02');
    if (spine) {
      const badgeGeo = new THREE.PlaneGeometry(0.22, 0.26);
      const badgeMat = new THREE.MeshBasicMaterial({
        map: this.makeBadgeTexture('', '#cccccc'),
        color: 0xffffff,
        side: THREE.FrontSide, transparent: true, opacity: 1,
        depthWrite: false, depthTest: true, alphaTest: 0.5,
      });
      badgeMat.name = 'TPL_NumberBadge';
      const badge = new THREE.Mesh(badgeGeo, badgeMat);
      badge.name = 'NumberBadge';
      // back is -Z; place just behind the spine and flip to face backward.
      badge.position.set(0, 0.10, -0.165);
      badge.rotation.y = Math.PI;
      spine.add(badge);
    }
  }

  /**
   * Remove cross-leg skinning bleed. The authored rig leaves stray weights on
   * the opposite leg (e.g. a left-calf vertex weighted a few percent to the
   * right ankle); as the stride opens that vertex is torn across the body and
   * a single point stretches between the feet / sticks a calf to the far
   * ankle. For any vertex whose dominant influence is a LEFT or RIGHT leg
   * bone, drop every weight on the opposite side's leg bones (thigh, calf,
   * foot, toe) and renormalise so the remaining (same-side + shared hip/
   * spine) weights sum to 1. The pelvis/spine are shared midline bones and
   * are intentionally kept, so the hip still bends naturally.
   */
  private sanitizeLegWeights(
    skel: THREE.Skeleton,
    jAttr: THREE.BufferAttribute | undefined,
    wAttr: THREE.BufferAttribute | undefined,
  ) {
    if (!jAttr || !wAttr) return;
    // 'L' = left leg bone, 'R' = right leg bone, null = midline/upper body.
    const legSide: Record<number, 'L' | 'R' | null> = {};
    const classify = (name: string): 'L' | 'R' | null => {
      if (/_(thigh|calf|foot|ball)_[lr]$/.test(name)) return name.endsWith('_l') ? 'L' : 'R';
      if (/^ball_leaf_[lr]$/.test(name)) return name.endsWith('_l') ? 'L' : 'R';
      return null;
    };
    skel.bones.forEach((b, i) => { legSide[i] = classify(b.name); });

    for (let vi = 0; vi < jAttr.count; vi++) {
      // dominant bone determines which leg this vertex belongs to
      let dom = 0, domW = -1;
      for (let k = 0; k < 4; k++) {
        const w = wAttr.getComponent(vi, k);
        if (w > domW) { domW = w; dom = jAttr.getComponent(vi, k); }
      }
      const side = legSide[dom];
      if (!side) continue;   // not a leg vertex

      // zero weights on the OPPOSITE leg's bones, keep the rest
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const bi = jAttr.getComponent(vi, k);
        let w = wAttr.getComponent(vi, k);
        if (legSide[bi] && legSide[bi] !== side) { w = 0; wAttr.setComponent(vi, k, 0); }
        sum += w;
      }
      // renormalise the surviving weights
      if (sum > 1e-4) {
        for (let k = 0; k < 4; k++) {
          const bi = jAttr.getComponent(vi, k);
          if (legSide[bi] && legSide[bi] !== side) continue;
          wAttr.setComponent(vi, k, wAttr.getComponent(vi, k) / sum);
        }
      } else {
        // all weights were cross-leg (degenerate): pin fully to the dominant
        // same-side bone.
        for (let k = 0; k < 4; k++) { jAttr.setComponent(vi, k, 0); wAttr.setComponent(vi, k, 0); }
        jAttr.setComponent(vi, 0, dom);
        wAttr.setComponent(vi, 0, 1);
      }
    }
    jAttr.needsUpdate = true;
    wAttr.needsUpdate = true;
  }

  /* ------------------------------------------------------------ match day --
   * Soiling and wetness, driven from `render/conditions.ts` by the view. Two
   * numbers in, one visual out: a shirt that has been on the ground on a MUDDY
   * pitch in the rain is not the shirt that started the half, and anyone who has
   * watched a white kit at Twickenham in January knows which one wins.
   *
   * It accumulates and NEVER recovers, because that is what mud does. */
  /**
   * `rate` 0..1 from `conditions.mud`, `wet` 0..1 from `conditions.wetness`.
   *
   * This also sets how the TURF answers a body, because it is the same two
   * numbers: a MUDDY pitch is soft and grippy (a man stops in one engagement and
   * stays down), a firm one is springy and slippery (he skips, rolls, and takes a
   * second line of turf with him). Authoring a second ground table somewhere else
   * would be the same mistake as a sky that disagrees with the pitch.
   */
  setSoiling(rate: number, wet: number) {
    this.soilRate = rate;
    this.wetLevel = wet;
    this.grip = Math.max(0.34, Math.min(0.86, 0.50 + rate * 0.34 - wet * 0.16));
    this.bounce = Math.max(0.03, 0.21 * (1 - wet * 0.62) - rate * 0.07);
  }

  private grip = 0.55;
  private bounce = 0.15;
  /** Turf hits reported by the falls, in pitch metres, drained by the view. */
  private groundHits: { x: number; z: number; force: number }[] = [];

  /** Scale the fake contact shadows by the key light's own hard/soft state. */
  setShadowStrength(v: number) {
    const k = Math.max(0, Math.min(1, v));
    this.shadowMat.opacity = 0.05 + k * 0.3;
  }

  private applySoil(inst: PlayerInstance) {
    const soil = Math.min(1, inst.soil);
    if (Math.abs(soil - inst.soilShown) < 0.012 && inst.soilShown >= 0) return;
    inst.soilShown = soil;
    for (const slot of ['jersey', 'shorts', 'socks'] as Slot[]) {
      const mat = inst.kitMats[slot];
      const base = inst.kitBase[slot];
      if (!mat || !base) continue;
      /* Skin and boots are not dirtied: a muddy face is a different feature.
       * Mud also ROUGHS the cloth — a soaked jersey stops reflecting the
       * floodlights, which is the part a colour tint alone misses. */
      mat.color.copy(base.color).lerp(ThreePlayerManager.MUD, soil * 0.62)
        .multiplyScalar(1 - this.wetLevel * 0.20);
      mat.roughness = Math.min(1, base.rough + soil * 0.22 - this.wetLevel * 0.06);
      mat.emissive.copy(ThreePlayerManager.SOAK).multiplyScalar(0.03 + this.wetLevel * 0.09);
    }
  }

  /** Clear the accumulated state between matches (the pool survives a restart). */
  resetSoiling() {
    for (const inst of this.pool.values()) { inst.soil = 0; inst.soilShown = -1; }
  }

  /** Hand the solved falls over to the frame's wear pass, once per frame. */
  drainGroundHits(): { x: number; z: number; force: number }[] {
    if (!this.groundHits.length) return this.groundHits;
    const out = this.groundHits.slice();
    this.groundHits.length = 0;
    return out;
  }

  /** FLAT 16-BIT has no physics, no shadows and no weather. Nothing to clear
   *  for the other tiers: a fall settles or is force-settled inside 2.4 s. */
  clearFalls() {
    for (const inst of this.pool.values()) {
      inst.rag?.dispose();
      inst.rag = null;
      /* The BAKED take too, since STANDARD can hold one now: the live budget
       * overflows into a replay rather than a second solver, and a quality switch
       * that cleared only the solver would leave a man replaying the end of a fall
       * he finished two seconds ago — his bones owned by a table while his feet run.
       * Every fall this class makes has to be undoable by every path that ends one. */
      if (inst.ragPlay) inst.ragPlay = null;   // a table lookup, nothing to release
      inst.ragBlend = 0;
      inst.root.rotation.z = 0;
      inst.proc.stagA = 0;
      inst.proc.ragW = 0;
    }
    this.liveFalls = 0;
  }

  /**
   * Start a fall. Called on the frame the takedown reaches its GROUNDING stage,
   * not on impact: the drive and the wrap are better authored than solved, and
   * by this frame the arms are already around the man being brought down, so the
   * solver inherits a pose that makes sense instead of an exploded one.
   */
  private startFall(inst: PlayerInstance, partner: PlayerInstance | null,
    seed?: { vx: number; vz: number; vy?: number; spin?: number; airborne?: number }) {
    if (inst.rag || !inst.root) return;
    /* FLAT 16-BIT does not solve a body; it replays one — see spawnBakedFall. */
    if (!this.ragdollEnabled) return;
    /* The pair's mean drift is the ENGINE's business (`breakdown.ts` slides both
     * men through the impact window), so it is subtracted out here: the fall owns
     * the difference between the two, which is the violent part. */
    const px = partner ? (inst.st.svx + partner.st.svx) * 0.5 : inst.st.svx;
    const pz = partner ? (inst.st.svz + partner.st.svz) * 0.5 : inst.st.svz;
    /* Clamped, because a ruck can drop a man forty metres downfield in one frame
     * and the velocity estimator has no way to tell that from a tackle. A fall
     * seeded with a teleport's speed is a body thrown into the third row. */
    const cap = 6.5;
    const cl = (v: number) => Math.max(-cap, Math.min(cap, v));
    /* A CLEANOUT has no partner to subtract: the shove IS the velocity change, and
     * the engine has already told us how big it was. Seeding from the number the
     * hit was measured with is what makes the reaction match the cause. */
    const rx = seed ? cl(seed.vx) : cl(inst.st.svx - px);
    const rz = seed ? cl(seed.vz) : cl(inst.st.svz - pz);
    /* A side-on hit has a cross-component, and that is exactly the spin that
     * makes two men roll instead of topple in parallel. */
    let spin = seed?.spin ?? 0;
    if (partner) {
      const dx = partner.root.position.x - inst.root.position.x;
      const dz = partner.root.position.z - inst.root.position.z;
      const d = Math.hypot(dx, dz) || 1;
      spin = ((rx * dz - rz * dx) / d) * 0.34;
    }
    /* A diving tackler is airborne already; a standing takedown is not, and
     * seeding a drop he does not have is how a ragdoll starts underwater. */
    const dive = inst.st.tackleRole === 'TACKLER' && !inst.st.standingHit;
    const airborne = seed?.airborne
      ?? (dive ? Math.min(0.34, 0.10 + Math.hypot(rx, rz) * 0.035) : 0);
    const gain = seed ? 1 : inst.st.standingHit ? 0.42 : 0.72;
    /* BUDGET. The solver is 0.01 ms a body per frame, which sounds free until a
     * ruck puts eight of them on the deck at once and a maul puts fourteen; and
     * the fall below that body is the one thing a viewer's eye is fixed on. So
     * the first `MAX_LIVE_FALLS` get solved and any beyond that REPLAY one of the
     * baked takes — the same curves, looked up instead of integrated, which is the
     * trade the LEGACY tier already makes deliberately and no one will see on the
     * sixth man in a pile. */
    if (this.liveFalls >= ThreePlayerManager.MAX_LIVE_FALLS && !seed) {
      this.spawnBakedFall(inst, rx * gain, rz * gain, inst.st.standingHit, true);
      return;
    }
    try {
      inst.rag = new Ragdoll(inst.root, {
        vx: rx * gain, vz: rz * gain, vy: -(seed?.vy ?? -(dive ? 1.1 : 0.35)),
        spin, airborne,
      }, { friction: this.grip, restitution: this.bounce, y: this.groundY(inst.actor.rx) });
      this.liveFalls++;
    } catch {
      inst.rag = null;   // a rig we cannot read is not worth a broken frame
    }
  }

  private liveFalls = 0;
  /** Live solves per frame, on STANDARD/FULL. See the budget note in `startFall`. */
  private static readonly MAX_LIVE_FALLS = 6;

  /**
   * T-41 — THE CLEANOUT, ANSWERED.
   *
   * The engine has already moved the man: the plan shoved his slot, the director
   * wrote his position, and `p.down` is set if the bake decided he went over. What
   * presentation adds is the reaction, and the split is by the shove itself:
   *
   *   power <= 2.4 m/s   he is STILL UP. `st.jerk` gets the pulse and `applyBalance`
   *                      pitches him into it, taking the recovery step with the lean.
   *   power  > 2.4 m/s   he is not, so the solver takes him: seeded from the hit's
   *                      own impulse rather than the velocity estimate, because the
   *                      engine has just given a standing man 3 m/s of backwards and
   *                      a solver seeded AFTER that frame starts him already falling
   *                      the wrong way, at the wrong speed, half a frame late.
   *
   * This is the one place the fall is not created by the tackle timeline, and it
   * retires the same way: the solver self-settles inside MAX_SIM_TIME, `ragW`
   * fades it, and the get-up clip has him by then.
   */
  /** how hard the ball is being fought over this frame, 0..1 (engine/hands.ts). */
  private ruckTug = 0;
  /** free-running phase for the contested-ball wobble — the manager has no clock,
   *  and a second THREE.Clock in a render layer that already has one per rig would
   *  be a second idea of what time it is. */
  private ballWobble = 0;

  /**
   * WHICH MEN ARE REACHING FOR THE BALL — a relay of one number per man, nothing more.
   *
   * The engine has already decided this. `stepHands` (engine/hands.ts) samples every
   * man at the ruck against the ball, per frame, and publishes a 0..1 commitment on
   * the breakdown's own player list; what happens here is that number moving into the
   * instance fields, because `Actor` is the presentation contract and it has no room
   * for a hand. Deliberately NOT a second reach model: a rig that judged proximity
   * for itself would disagree with the engine about whether the jackal had it, and
   * the picture would show a man stealing a ball the scoreboard says is still held —
   * the exact class of lie this whole layer has been spending an edition removing.
   *
   * The reset up front is the load-bearing part. A man who walks out of the ruck
   * stops appearing in `players`, and a field nobody clears is a player who reaches
   * for a ball he left three phases ago, for the rest of the match.
   */
  private syncHands(d: Director) {
    for (const inst of this.pool.values()) {
      if (inst.st.hand !== 0) inst.st.hand = 0;
      if (inst.st.strip !== 0) inst.st.strip = 0;
      if (inst.proc.craftW !== 0) inst.proc.craftW = 0;
    }
    /* SPEC_25 — THE CATCH. Two-bone IK lives in the engine (`engine/ballcraft.ts`)
     * because it decides where the hands and the ball are; what the rig needs is the
     * aim point and a weight, and it gets both from the solved pose rather than
     * inventing a second reach that could disagree. The weight is the solver's own
     * `reach`, so a man a metre short of the ball reaches at LESS than a man on top of
     * it — the strain is the mechanic, and a hand that snaps onto an unreachable ball
     * would delete the whole reason to hold the button early. */
    const bc = d.bc;
    if (bc && bc.state !== 'IDLE') {
      const inst = this.pool.get(this.key(bc.team as KitTeam, bc.num));
      if (inst) {
        const b = bc.free ?? bc.chest;
        const s = RENDER_SCALE;
        _ballAim.set(b.x * s, b.y * s + this.groundY(b.x), -b.z * s);
        inst.st.hand = bc.state === 'BALL_SECURED'
          ? 0.5
          : Math.max(0.2, (bc.l.reach + bc.r.reach) * 0.5);
        inst.proc.craftW = bc.state === 'HANDS_READY' || bc.state === 'DROP_BALL' ? 1 : 0;
        /* The elbow is the half of a two-bone chain that a single aim-at-a-point
         * cannot express, so it is passed through as data and applied to the forearm
         * after the reach has done its work. */
        inst.proc.craftL = { ex: bc.l.elbow.x, ey: bc.l.elbow.y, ez: bc.l.elbow.z,
          hx: bc.l.hand.x, hy: bc.l.hand.y, hz: bc.l.hand.z };
        inst.proc.craftR = { ex: bc.r.elbow.x, ey: bc.r.elbow.y, ez: bc.r.elbow.z,
          hx: bc.r.hand.x, hy: bc.r.hand.y, hz: bc.r.hand.z };
      }
    }
    const bd = d.bd;
    if (!bd || (d.phase !== 'BREAKDOWN' && d.phase !== 'BREAKDOWN_REPLAY')) { this.ruckTug = 0; return; }
    this.ruckTug = bd.hands?.tug ?? 0;
    for (const p of bd.players) {
      const inst = this.pool.get(this.key(p.team as KitTeam, p.num));
      if (!inst) continue;
      inst.st.hand = p.hand ?? 0;
      inst.st.strip = p.strip ?? 0;
    }
    /* Where the hands aim. Same mapping `updateBall` uses for the ball itself — one
     * pitch→world formula in two places is a ball the arms reach a metre behind. */
    const s = RENDER_SCALE;
    const bx = bd.ball.x, bz = bd.ball.z;
    const by = bd.ball.placed || bd.stage === 'RUCK' || bd.stage === 'RECYCLE'
      ? (bd.ball.y ?? 0.16) : 1.0;
    _ballAim.set(bx * s, by * s + this.groundY(bx), -bz * s);
  }

  private reactToCleanouts(d: Director): void {
    if (!d.frameEvents.length) return;
    for (const ev of d.frameEvents) {
      if (ev.type !== 'CLEANOUT') continue;
      const inst = this.pool.get(this.key(ev.team, ev.num));
      if (!inst || !inst.root) continue;
      const a = inst.actor;
      /* away from the contact point = the direction he was sent */
      let ux = a.rx - ev.x, uz = a.rz - ev.z;
      const ul = Math.hypot(ux, uz);
      if (ul > 1e-3) { ux /= ul; uz /= ul; } else { ux = 0; uz = ev.team === 'A' ? -1 : 1; }
      const hard = ev.power > 2.4;
      inst.st.jerk = Math.max(inst.st.jerk, Math.min(1, ev.power / 3.4));
      inst.st.jx = ux; inst.st.jz = uz;
      if (hard) {
        this.startFall(inst, null, {
          vx: ux * ev.power * 0.62, vz: uz * ev.power * 0.62,
          vy: -0.5, spin: (ux * 0.7 + 0.5) * 1.4, airborne: 0.06,
        });
      } else {
        /* and the ground takes what the hit gave him — a scuff, not a burst */
        /* pitch-metric, same space the scar canvas and the particle emitter read:
         * `a.rz` is already the pitch coordinate, and only the solver's contacts
         * come out of THREE z-flipped. */
        this.groundHits.push({ x: a.rx, z: a.rz, force: 0.24 + ev.power * 0.08 });
      }
    }
  }

  /** The other half of this man's collision, if he is still falling with him. */
  private fallPartner(inst: PlayerInstance, pool: PlayerInstance[]): PlayerInstance | null {
    if (!inst.st.tackleRole) return null;
    const want = inst.st.tackleRole === 'TACKLER' ? 'CARRIER' : 'TACKLER';
    let best: PlayerInstance | null = null;
    let bestD = Infinity;
    for (const other of pool) {
      if (other === inst || other.st.tackleRole !== want || other.team === inst.team) continue;
      const d = inst.root.position.distanceToSquared(other.root.position);
      if (d < bestD) { bestD = d; best = other; }
    }
    return bestD > 9 * 9 ? null : best;
  }

  /* ----------------------------------------------------------- ball ----- */
  private buildBall(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'Ball3D';
    const geo = new THREE.SphereGeometry(0.16, 18, 12);
    geo.scale(1.0, 0.78, 1.65);
    const ballSkin = new THREE.MeshStandardMaterial({
      // Waxed leather: tight specular, no metal.
      color: 0xb8562f, roughness: 0.45, metalness: 0.0,
      transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide,
    });
    this.ballMat = ballSkin;
    const ballMesh = new THREE.Mesh(geo, ballSkin);
    ballMesh.castShadow = true;
    ballMesh.receiveShadow = true;
    g.add(ballMesh);
    const seam = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.007, 6, 20),
      new THREE.MeshBasicMaterial({
        color: 0x24201c, transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide,
      }),
    );
    seam.rotation.y = Math.PI / 2;
    g.add(seam);
    g.visible = false;
    return g;
  }

  /**
   * The turf is domed (ThreeEnvironment.ts), so "on the grass" is not y = 0.
   * Every placement in this class that means STANDING ON or LYING ON the
   * surface takes its height from here, which is what keeps a scrum-half from
   * being knee-deep in the middle of the field and ankle-floating by the
   * touchline, and puts his contact shadow on the ground rather than under it.
   * In the renderer's scaled units, because that is the space a root lives in.
   */
  private groundY(pitchX: number): number {
    return turfRiseM(pitchX) * RENDER_SCALE;
  }

  /* ------------------------------------------------------------ pooling -- */
  private key(team: KitTeam, num: number) { return `${team}:${num}`; }

  /* ------------------------------------------------------- stand-in squad -- */
  /**
   * Bodies for the case where the GLB never arrived.
   *
   * `load()` rejects when `assets/models/rugby_player.glb` cannot be fetched or
   * parsed — a 404 behind a proxy, an aborted fetch on a slow link, a binary a
   * loader chokes on — and the caller logs it and carries on. That is the right
   * call for the *match*: the simulation does not care whether it is being
   * watched. It was the wrong call for the *picture*, because every animated path
   * in this class sits behind that `ready` flag, so the failure produced a
   * correctly framed field with nobody on it and no trace of itself outside a
   * console the player never opens. Every harness in this repo stayed green:
   * none of them looks at a mesh.
   *
   * So: a missing model is an art loss, not a game loss. These are the cheapest
   * readable humans the renderer can make from nothing — five boxes, a head, a
   * squad number — placed from the same `Actor` contract the real rig reads, and
   * posed by the same three pieces of information that matter at broadcast zoom:
   * where he is, which way he faces, and whether he is on the ground. This is not
   * the game's look and is not trying to be. It is the difference between "the
   * art did not load" and "the game is broken", and it costs one branch on a
   * boolean that is false on every frame of a healthy match.
   */
  private standIn = new Map<string, THREE.Group>();
  private standInGeo: {
    torso: THREE.BoxGeometry; waist: THREE.BoxGeometry; leg: THREE.BoxGeometry;
    arm: THREE.BoxGeometry; head: THREE.SphereGeometry; badge: THREE.PlaneGeometry;
  } | null = null;
  private standInMat: Partial<Record<KitTeam, { jersey: THREE.MeshStandardMaterial; shorts: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial }>> = {};
  /** Gait state that is not worth sharing with the animated rig's `st`. */
  private standInState = new Map<string, { lx: number; lz: number; face: number; bob: number }>();

  /** Clips that put a man on the turf, in the engine's own vocabulary. */
  private static readonly STANDIN_GROUND = new Set(['grounded', 'try', 'slide', 'dive']);

  private buildStandIn(team: KitTeam, num: number): THREE.Group {
    const s = RENDER_SCALE;
    if (!this.standInGeo) {
      /* Dimensions in metres of a forward pack: 1.85 m tall, 0.50 m across the
       * shoulders, and a chest that is a lot wider than it is deep. */
      this.standInGeo = {
        torso: new THREE.BoxGeometry(0.50 * s, 0.62 * s, 0.30 * s),
        waist: new THREE.BoxGeometry(0.46 * s, 0.24 * s, 0.30 * s),
        leg: new THREE.BoxGeometry(0.17 * s, 0.62 * s, 0.19 * s),
        arm: new THREE.BoxGeometry(0.14 * s, 0.56 * s, 0.15 * s),
        head: new THREE.SphereGeometry(0.125 * s, 12, 10),
        badge: new THREE.PlaneGeometry(0.24 * s, 0.24 * s),
      };
    }
    const G = this.standInGeo;
    const kit = KITS[team];
    let mats = this.standInMat[team];
    if (!mats) {
      const mk = (color: string, rough: number, gain: number) => new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(gain), roughness: rough, metalness: 0,
      });
      /* The same fabric response the GLB path uses, so a fallback does not light
       * differently from the real thing. */
      mats = { jersey: mk(kit.jersey, 0.74, 0.78), shorts: mk(kit.shorts, 0.70, 0.80), skin: mk(SKINS[1], 0.55, 1) };
      this.standInMat[team] = mats;
    }

    const g = new THREE.Group();
    g.name = `StandIn_${team}${num}`;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    add(G.head, mats.skin, 0, 1.72 * s, 0);
    add(G.torso, mats.jersey, 0, 1.30 * s, 0);
    add(G.waist, mats.shorts, 0, 0.88 * s, 0);
    add(G.leg, mats.skin, -0.13 * s, 0.42 * s, 0);
    add(G.leg, mats.skin, 0.13 * s, 0.42 * s, 0);
    const armL = add(G.arm, mats.skin, -0.33 * s, 1.28 * s, 0);
    const armR = add(G.arm, mats.skin, 0.33 * s, 1.28 * s, 0);
    armL.rotation.z = 0.16; armR.rotation.z = -0.16;
    if (team !== 'REF') {
      const badge = new THREE.Mesh(G.badge, new THREE.MeshBasicMaterial({
        map: this.makeBadgeTexture(String(num), kit.badgePanel),
        transparent: true, alphaTest: 0.25, depthWrite: true, side: THREE.FrontSide,
      }));
      badge.position.set(0, 1.38 * s, -0.155 * s);
      badge.rotation.y = Math.PI;
      g.add(badge);
    }
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.scale.set(0.95, 0.5, 1);
    shadow.renderOrder = -1;
    g.add(shadow);
    this.scene.add(g);
    return g;
  }

  private updateStandIn(d: Director, dt: number) {
    const s = RENDER_SCALE;
    const step = Math.min(dt, 0.05);
    const active = new Set<string>();
    for (const a of d.actors) {
      const team: KitTeam = a.team === 'REF' ? 'REF' : a.team;
      const k = this.key(team, a.num);
      active.add(k);
      const g = this.standIn.get(k) ?? this.buildStandIn(team, a.num);
      this.standIn.set(k, g);
      let st = this.standInState.get(k);
      if (!st) { st = { lx: a.rx, lz: a.rz, face: a.rf > 0 ? 0 : Math.PI, bob: 0 }; this.standInState.set(k, st); }
      const vx = (a.rx - st.lx) / Math.max(step, 1e-4);
      const vz = (a.rz - st.lz) / Math.max(step, 1e-4);
      st.lx = a.rx; st.lz = a.rz;
      const spd = Math.hypot(vx, vz);
      /* Same heading rule as the animated rig: a moving man goes where he is
       * going, a slow man holds his last facing. `rf` is the engine's own facing
       * and wins when he is standing still, so a scrum-half waiting on the ball
       * is not spinning on the spot. */
      if (spd > 2.2) {
        let dy = Math.atan2(vx, vz) - st.face;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        st.face += dy * (1 - Math.exp(-step * 10));
      } else if (a.rf !== 0) {
        st.face = a.rf > 0 ? 0 : Math.PI;
      }
      const grounded = ThreePlayerManager.STANDIN_GROUND.has(a.renderClip);
      g.position.set(a.rx * s, this.groundY(a.rx), -a.rz * s);
      g.rotation.set(0, Math.PI - st.face, 0);
      if (grounded) {
        /* A man on the deck is not a man lying flat: he is on his side, half up
         * on an elbow, which is what a broadcast still of a tackle looks like. */
        g.rotation.z = 1.15;
        g.position.y = this.groundY(a.rx) + 0.24 * s;
      } else {
        g.rotation.z = 0;
        /* One bob per stride, from the speed he actually has. Without it a
         * fallback side is a floor plan and everyone knows it. */
        st.bob += step * (2.2 + spd * 1.5);
        g.position.y = this.groundY(a.rx) + Math.abs(Math.sin(st.bob)) * 0.035 * s * Math.min(1, spd / 4);
        g.rotation.x = -Math.min(0.28, spd * 0.035);
      }
      g.visible = true;
    }
    for (const [k, g] of this.standIn) if (!active.has(k)) g.visible = false;
    /* The ball is not gated on `ready`: it is built in the constructor, and a
     * free ball is the one object in this scene a player needs to see. */
    this.updateBall(d, step);
  }

  /** Retire every stand-in body, once the rig it was standing in for loads. */
  private clearStandIn() {
    for (const g of this.standIn.values()) {
      this.scene.remove(g);
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose?.(); });
    }
    this.standIn.clear();
    this.standInState.clear();
  }

  private getOrCreate(team: KitTeam, num: number, actor: Actor): PlayerInstance {
    const k = this.key(team, num);
    let inst = this.pool.get(k);
    if (inst) {
      inst.actor = actor;
      inst.root.visible = true;
      return inst;
    }
    inst = this.spawn(team, num, actor);
    this.pool.set(k, inst);
    return inst;
  }

  private spawn(team: KitTeam, num: number, actor: Actor): PlayerInstance {
    const root = SkeletonUtils.clone(this.template!) as THREE.Group;
    root.scale.setScalar(RENDER_SCALE);
    this.scene.add(root);

    const mixer = new THREE.AnimationMixer(root);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of this.templateClips) clips.set(c.name, c);

    const kit = KITS[team];
    const skinCol = team === 'REF' ? SKINS[1] : SKINS[(num * 7 + (team === 'B' ? 2 : 0)) % SKINS.length];
    const slotColour: Record<Slot, string> = {
      jersey: kit.jersey, shorts: kit.shorts, socks: kit.socks,
      skin: skinCol, boots: kit.boot, hair: '', eyes: '',
    };

    let badgeMat: THREE.MeshBasicMaterial = null as unknown as THREE.MeshBasicMaterial;
    const kitMats: Partial<Record<Slot, THREE.MeshStandardMaterial>> = {};
    const kitBase: Partial<Record<Slot, { color: THREE.Color; rough: number }>> = {};
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      /* SPEC_24 — the squad has to be IN the light, not merely lit: skinned
       * meshes cast through the key light's shadow map, so a shadow follows a
       * dive. The contact blob stays for the far end of the lens, where a
       * 2048 map over 42 m cannot resolve a boot. */
      if (o.name !== 'ContactShadow') { mesh.castShadow = true; mesh.receiveShadow = true; }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material as THREE.Material];
      const replaced: THREE.Material[] = [];
      for (const mat of mats) {
        const name = mat.name ?? '';
        let out: THREE.Material = mat;
        const slot = (Object.keys(TEMPLATE_SLOT_MAT) as Slot[]).find((s) => TEMPLATE_SLOT_MAT[s] === name);
        if (slot && slot !== 'hair' && slot !== 'eyes') {
          // Bug-fix #1: opaque kit materials, front faces only, depth writes on.
          /* Per-slot surface response. Jersey and shorts are matte technical
           * cloth; socks a touch rougher; skin has a low broad sheen; boots are
           * the only genuinely glossy thing on a player. Giving every slot the
           * same roughness is the single clearest "this is a game model" tell. */
          const ROUGH: Record<string, number> = {
            jersey: 0.74, shorts: 0.70, socks: 0.86, skin: 0.55, boots: 0.28,
          };
          /* Fabric albedo. A white cotton-poly jersey is a very good reflector
           * and a very bad mirror: measured sports kit sits around 0.72–0.80
           * diffuse, never 1.0. Handing the material a literal 1.0 means the
           * sun clips the shirt to a flat white silhouette with no fold, no
           * terminator and no man inside it — which is half of what "the
           * players look grey" turns out to be. Skin and boots keep their own
           * response: boots are meant to clip. */
          const FABRIC = slot === 'jersey' ? 0.78 : slot === 'shorts' ? 0.80 : 0.82;
          const km = new THREE.MeshStandardMaterial({
            color: new THREE.Color(slotColour[slot]).multiplyScalar(FABRIC),
            roughness: ROUGH[slot] ?? 0.75,
            metalness: 0.0,
            transparent: false, opacity: 1, depthWrite: true, depthTest: true, side: THREE.FrontSide,
          });
          km.name = `M_${slot}`;
          kitMats[slot] = km;
          kitBase[slot] = { color: km.color.clone(), rough: km.roughness };
          out = km;
        } else if (name === 'TPL_NumberBadge') {
          if (team === 'REF') {
            mesh.visible = false;
            out = mat;
          } else {
            const bm = new THREE.MeshBasicMaterial({
              map: this.makeBadgeTexture(String(num), kit.badgePanel),
              side: THREE.FrontSide, transparent: true, opacity: 1,
              depthWrite: true, depthTest: true, alphaTest: 0.25,
            });
            bm.name = 'M_NumberBadge';
            badgeMat = bm;
            out = bm;
          }
        }
        replaced.push(out);
      }
      mesh.material = Array.isArray(mesh.material) ? replaced : replaced[0];
    });

    // Soft contact shadow at the feet (child of root so it tracks the actor).
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.scale.set(0.95, 0.50, 1);
    shadow.renderOrder = -1;
    root.add(shadow);
    // kept so the procedural body tilt can counter-rotate it flat (below)
    const shadowRef = shadow;

    const inst: PlayerInstance = {
      kitMats, kitBase, soil: 0, soilShown: -1,
      actor, team, num, root, mixer, clips, badgeMat, shadow: shadowRef,
      active: null,
      ragPlay: null, ragBlend: 0, ragRate: 1,
      proc: {
        tilt: 0, reach: 0, thrash: 0, dip: 0, ragW: 0, stagA: 0,
        craftW: 0, craftL: null, craftR: null,
        phase: (num * 1.7 + (team === 'B' ? 0.9 : 0)) % 6.283, state: 'idle',
      },
      st: {
        oneShot: null, lock: 0, lie: false, jerk: 0, jx: 0, jz: 0,
        lx: actor.rx, lz: actor.rz, spd: 0,
        face: actor.rf > 0 ? 0 : Math.PI,
        passLatched: false,
        tackleT: -1, tackleRole: null, tackleClipT: 0, standingHit: false,
        hand: 0, strip: 0,
        svx: 0, svz: 0,
        ragFired: false,
      },
    };
    return inst;
  }

  /** Digit only — fully transparent canvas, no backing plate or border. */
  private makeBadgeTexture(label: string, panel: string): THREE.Texture {
    const cacheKey = `${label}|${panel}|glyph`;
    const cached = this.badgeTextures.get(cacheKey);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d', { alpha: true })!;
    ctx.clearRect(0, 0, 128, 128);
    if (label) {
      const darkKit = panel === '#16161a';
      ctx.font = '900 108px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = darkKit ? '#f4efe2' : '#111111';
      ctx.fillText(label, 64, 72);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.badgeTextures.set(cacheKey, tex);
    return tex;
  }

  /* -------------------------------------------------------- state machine */
  private locomotion(spd: number): string {
    if (spd < 0.7) return 'idle';
    if (spd < 3.0) return 'walk';
    if (spd < 6.4) return 'run';
    return 'sprint';
  }

  /** Engine renderClip -> FSM state. */
  private mapState(engineClip: string, spd: number): string {
    switch (engineClip) {
      /* LATCH-AND-DRAG: the engine's two struggle clips pass straight
       * through. They must NOT fall to the locomotion default — a latched
       * carrier is still moving at two or three metres a second, so the
       * default would put him back into a clean Run and the whole point of
       * the drag would be invisible. */
      case 'latchCarry': return 'latchCarry';
      case 'latchHang': return 'latchHang';
      case 'pass': case 'ninePass': case 'nineFeed': case 'lineoutThrow': return 'pass';
      case 'kick': return 'kick';
      case 'tackle': return 'tackle';
      case 'grounded': return 'grounded';
      case 'dive': return 'dive';
      case 'try': case 'slide': return 'try';
      case 'getup': return 'getup';
      case 'maul': case 'scrumBind': case 'scrumShove': return 'bind';
      case 'ruck': case 'jackal': case 'cleanout': return 'ruck';
      case 'jump': case 'lift': case 'lineoutJump': case 'lineoutLift':
      case 'catch': case 'catchHigh': case 'lineoutCatch': return 'jump';
      // Bug-fix #3: 'ready' is the athletic standing idle before a set piece,
      // NOT a crouch — bind it to the upright Idle. Only the scrum-half's
      // authored bind squat (nineSquat/crouch) uses the low Crouch track.
      case 'nineSquat': return 'crouch';
      case 'crouch': return spd < 0.6 ? 'crouch' : this.locomotion(spd);
      case 'ready': case 'refIdle': case 'idle':
        return spd > 0.6 ? this.locomotion(spd) : 'idle';
      default:
        return this.locomotion(spd);   // jog/run/carry/sprint/walk + ref gaits
    }
  }

  /**
   * The engine's get-up lock is a hard-coded constant because it has to run
   * headless; this is the only place both numbers exist at once, so it is
   * where they are checked. A re-exported stand-up clip that changes duration
   * would otherwise silently leave the man frozen after he is on his feet, or
   * cut the animation off mid-rise.
   */
  private checkRecoverSeconds() {
    if (!import.meta.env?.DEV) return;
    const name = this.pick('MX_StandUp', 'GetUp');
    const clip = this.templateClips.find(c => c.name === name);
    if (!clip) return;
    /* The lock is deliberately SHORTER than the clip (see RECOVER_SECONDS):
     * the clip is sped up to fit. Warn only if that speed-up would be so
     * extreme the rise reads as a twitch. */
    const rate = clip.duration / RECOVER_SECONDS;
    if (rate > 3.5) {
      console.warn(`[players] get-up clip '${name}' runs ${clip.duration.toFixed(2)}s `
        + `but the engine lock is only ${RECOVER_SECONDS}s — a ${rate.toFixed(1)}x `
        + 'speed-up will look like a twitch. Raise RECOVER_SECONDS in director.ts.');
    }
  }

  /** `want` if the retargeted pair was loaded, else the stand-in `fallback`. */
  private pick(want: string, fallback: string): string {
    return this.templateClips.some(c => c.name === want) ? want : fallback;
  }

  private clipForState(st: string): { name: string; loop: boolean } {
    switch (st) {
      case 'idle': return { name: 'Idle', loop: true };
      case 'walk': return { name: 'Walk', loop: true };
      case 'run': return { name: 'Run', loop: true };
      case 'sprint': return { name: 'Sprint', loop: true };
      case 'crouch': return { name: 'Crouch', loop: true };
      case 'bind': case 'ruck': return { name: 'Push', loop: true };
      case 'jump': return { name: 'JumpLand', loop: true };
      case 'pass': return { name: 'Pass', loop: false };
      case 'kick': return { name: 'Kick', loop: false };
      case 'tackle': return { name: 'Tackle', loop: false };
      /* PART 2 — the three stages of a tackle, mapped onto the clips this
       * rig actually ships (Quaternius UAL): Tackle is the drive/hit,
       * SlideStart the stumble off it, DiveRoll the grounding and the
       * roll-away, Death the prone hold. */
      /* The tackler drives and goes to ground on ONE authentic clip
       * (MX_Tackle, a real football tackle); the carrier is hit and falls on
       * its matched partner (MX_TackleReact). Both were retargeted from
       * Mixamo onto this skeleton by tools/fetch_mixamo.mjs. `??` keeps the
       * old stand-ins alive if that artefact has not been built. */
      /* MOMENTUM BRANCH. A standing takedown has no dive in it, so the
       * running-tackle clip is wrong for it — see BreakdownState.hitKind.
       * With no bespoke takedown asset available (none exists in any
       * reachable public repo — see tools/fetch_mixamo.mjs) the standing
       * branch plays the SAME retargeted pair at a reduced time scale and
       * without the dive tilt, which reads as a grapple to ground rather
       * than a launch. `standingHit` is set per-frame from the engine. */
      case 'tackleDrive': return { name: this.pick('MX_Tackle', 'Tackle'), loop: false };
      case 'hitReact': return { name: this.pick('MX_TackleReact', 'SlideStart'), loop: false };
      case 'tackleGround': return { name: this.pick('MX_Tackle', 'DiveRoll'), loop: false };
      case 'carrierFall': return { name: this.pick('MX_TackleReact', 'Death'), loop: false };
      /* Stage 2 stays on the SAME clip as stages 0-1 when the retargeted pair
       * is present: MX_Tackle / MX_TackleReact each end with the man already
       * down, and clampWhenFinished holds that final grounded frame as the
       * prone hold. Cutting to Death/DiveRoll here truncated the fall at ~50%
       * and threw away the part where he actually lands. */
      case 'present': return { name: this.pick('MX_TackleReact', 'Death'), loop: false };
      case 'rollAway': return { name: this.pick('MX_Tackle', 'DiveRoll'), loop: false };
      /* LATCH-AND-DRAG. The two halves of the struggle, before the takedown.
       * The rig ships no bespoke Struggle or Hang, so the illusion is built
       * out of what it has:
       *   latchCarry  Run, played heavy — the timeScale in setLocomotion is
       *               dropped well under ground-lock so the carrier churns
       *               and labours instead of striding cleanly. He is being
       *               held, and the legs have to read as fighting for it.
       *   latchHang   Tackle, CLAMPED on its final frame — the drive pose,
       *               arms wrapped, held. His 2D coordinates are snapped to
       *               the carrier's hip by the engine, so a held pose is all
       *               that is needed to read as a man being towed. */
      case 'latchCarry': return { name: 'Run', loop: true };
      case 'latchHang': return { name: 'Tackle', loop: false };
      /* ASSET NOTE — these tackle states are driven by STAND-IN clips
       * (Tackle, SlideStart, DiveRoll, Death — see the cases above) with the
       * procedural layer compensating for what they lack. The real fix
       * is Mixamo's free PAIRED "American Football Tackle" / "Tackled" clips,
       * which contain the violent horizontal dive and the twisting ground
       * impact a rugby collision needs. Swap them in tools/build_player_glb.py
       * (see the ASSET UPGRADE PATH note there) and only the clip names below
       * change — every state name is already wired.
       *
       * DOWNLOAD THEM WITH "In-Place" TICKED, or if you forget, it no longer
       * matters: stripRootMotion() flattens the horizontal channel of every
       * clip at load. Do not "fix" a sliding character by editing the clip's
       * Y track — the vertical drop is load-bearing (it is what puts a tackled
       * man on the turf now that the procedural pivot lift is off). */
      case 'grounded': return { name: 'Death', loop: true };
      /* A committed tackle dive is the same horizontal launch as the tackler's
       * half of a collision, so it uses the retargeted Mixamo tackle rather
       * than the SlideStart stand-in. A missed dive ends with the engine
       * setting clip='getup', which picks up MX_StandUp through the get-up
       * lock — the dive and the consequence are one continuous movement. */
      case 'dive': return { name: this.pick('MX_Tackle', 'SlideStart'), loop: false };
      case 'try': case 'tryLoop': return { name: 'Slide', loop: true };
      case 'tryStart': return { name: 'SlideStart', loop: false };
      case 'getup': return { name: this.pick('MX_StandUp', 'GetUp'), loop: false };
      default: return { name: 'Idle', loop: true };
    }
  }

  /**
   * Time scale that makes `state`'s clip play through in `window` seconds.
   * `window <= 0` means the stage is open-ended (the >0.4 s ruck-prep hold),
   * where the clip should run at its natural speed and clamp. Clamped to a
   * sane band so a very long clip is not turned into a blur.
   */
  private fitTimeScale(state: string, window: number): number {
    if (window <= 0) return 1;
    const clip = this.templateClips.find(c => c.name === this.clipForState(state).name);
    if (!clip || clip.duration <= 0) return 1;
    /* Clamped at 3x. The uncapped ratio is 5.5-6x here (a 0.83 s clip into a
     * 0.15 s window), which plays the whole motion but reads as a blur —
     * faster than a body can move. At 3x the stage shows roughly the first
     * half to two-thirds of the clip at a violent-but-readable speed, which
     * is the part that carries the hit; the following stage's crossfade takes
     * over from there. This is a LOOKS-RIGHT number, not a derived one, and
     * is the first thing to tune if the collision reads too fast or too slow. */
    return Math.min(3, Math.max(0.5, clip.duration / window));
  }

  /** Crossfade to a clip. Returns the action (already playing). */
  private play(
    inst: PlayerInstance, stateName: string, fade: number, timeScale = 1,
  ): THREE.AnimationAction | null {
    const info = this.clipForState(stateName);
    const clip = inst.clips.get(info.name);
    if (!clip) return null;
    const action = inst.mixer.clipAction(clip);
    /* PART 1 — ONE SHOT MEANS ONE. `LoopOnce` with `Infinity` repetitions is
     * the three-rapid-throws bug: three.js reads the repetition count even in
     * LoopOnce mode, so the Pass clip re-fired until the 0.45 s lock expired.
     * Exactly one repetition, and the last frame is held. */
    if (info.loop) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.timeScale = timeScale;
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    if (inst.active && inst.active.action !== action) {
      action.crossFadeFrom(inst.active.action, fade, true);
    }
    action.play();
    inst.active = { name: stateName, action };
    return action;
  }

  private setLocomotion(inst: PlayerInstance, st: string, spd: number) {
    if (inst.st.oneShot) return;   // a held one-shot owns the body
    const info = this.clipForState(st);
    const clip = inst.clips.get(info.name);
    if (!clip) return;
    const action = inst.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    // Playback rate scales with player velocity against the clip's authored
    // cadence (Run ~4.2 m/s, Sprint ~7.2, Walk ~1.3).
    if (info.name === 'Idle') action.timeScale = 1;
    else {
      const base = info.name === 'Sprint' ? 7.2 : info.name === 'Run' ? 4.2 : 1.3;
      action.timeScale = Math.max(0.55, Math.min(2.3, spd / base));
    }
    if (inst.active?.name !== st) {
      action.reset();
      action.enabled = true;
      action.setEffectiveWeight(1);
      if (inst.active) action.crossFadeFrom(inst.active.action, 0.15, true);
      action.play();
      inst.active = { name: st, action };
    }
  }


  /**
   * The other half of a live latch.
   *
   * The engine holds the link (`Live.latchedBy` / `latchingOnto`), but the
   * render stream is `Actor`, which deliberately carries only presentation
   * fields — so rather than widen that contract for one effect, the pair is
   * recovered from the two complementary clip states. There is at most one
   * latch at a time (engine/latch.ts enforces it), so the nearest opponent
   * wearing the opposite half of the struggle IS the partner.
   */
  private latchPartner(inst: PlayerInstance, pool: PlayerInstance[]): PlayerInstance | null {
    const want = inst.proc.state === 'latchHang' ? 'latchCarry'
      : inst.proc.state === 'latchCarry' ? 'latchHang' : null;
    if (!want) return null;
    let best: PlayerInstance | null = null;
    let bestD = Infinity;
    for (const other of pool) {
      if (other === inst || other.proc.state !== want || other.team === inst.team) continue;
      const d = inst.root.position.distanceToSquared(other.root.position);
      if (d < bestD) { bestD = d; best = other; }
    }
    return best;
  }

  /* ==================== RAGDOLL — spawn, drive, release ==================
   *
   * The handover is the whole problem. A ragdoll that begins from a canonical
   * pose snaps visibly, so this one is SEEDED FROM THE LIVE ANIMATED POSE: at
   * the instant the takedown fires we read the 11 joint positions the mixer
   * has just produced and hand those to the solver as its initial state. The
   * first physics frame is therefore identical to the last animated one, and
   * the only thing that changes is what is computing it.
   *
   * Authority then RAMPS (ragBlend) over ~0.12 s rather than switching, which
   * covers the discontinuity in the derivative — the animation had one
   * velocity, physics has another — that would otherwise read as a twitch. */

  /** Queue the replayed fall for this man, matched to the hit that happened. */
  private spawnBakedFall(inst: PlayerInstance, vx: number, vz: number, standing: boolean,
    beyondBudget = false): void {
  /* THE LEGACY FALL. `render/ragdoll.ts` solves a body per frame on every tier
   * that can afford it; this tier cannot, which is the entire reason the baked
   * library exists. So the two are split by QUALITY and never run at once, and
   * each one's authority over the bones is exclusive: a pose written by a table
   * lookup and a pose written by a solver in the same frame is a shuffle, not a
   * blend. */
    if ((!beyondBudget && this.ragdollEnabled) || inst.ragPlay || inst.rag) return;
    if (!inst.ragBones) {
      inst.ragBones = resolveRagBones(inst.root);
      inst.ragRest = captureRestDirs(inst.ragBones);
    }
    // Make sure the world matrices reflect the pose the mixer just wrote.
    inst.root.updateWorldMatrix(true, true);
    if (!seedFromPose(inst.ragBones, RENDER_SCALE, this.ragSeed)) return;

    /* Match the baked cell to the hit that actually happened. The clip is
     * stored in body-local space, so what we need is the angle of the hit
     * RELATIVE to the way this man is facing — the absolute heading is
     * applied afterwards as a rotation, which is why direction costs nothing
     * to bake. */
    const facing = Math.PI - inst.root.rotation.y;
    const hitDir = Math.atan2(vz, vx);
    const rel = hitDir - facing;
    const speed = Math.hypot(vx, vz) / RENDER_SCALE;
    /* A standing takedown is a wrestle; a man cleaned out at full pace is a
     * different event. Power drives both which clip is chosen and how fast it
     * is played back. */
    const power = standing ? 0.5 : Math.min(1.35, 0.55 + speed * 0.11);

    if (!inst.ragPlay) inst.ragPlay = new RagdollPlayback();
    const clip = pickClip(rel, power, inst.num);
    const ox = this.ragSeed[NODE.PELVIS * 3];
    const oy = this.ragSeed[NODE.PELVIS * 3 + 1];
    const oz = this.ragSeed[NODE.PELVIS * 3 + 2];
    inst.ragPlay.start(clip, hitDir, [ox, oy, oz], 1);

    /* Playback rate carries the pace the clip itself cannot: a heavy hit is
     * played a touch fast, a slow wrestle noticeably slower, so two men going
     * down off the same baked take do not move in lockstep. */
    inst.ragRate = standing ? 0.78 : Math.min(1.25, 0.9 + speed * 0.03);

    /* Remember where the fall began. driveRig applies the fall as a delta from
     * this point, so the engine can keep owning root.position without the two
     * authorities fighting over the same body. */
    if (!inst.ragOrigin) inst.ragOrigin = new THREE.Vector3();
    inst.ragOrigin.set(ox, oy, oz);
    inst.ragBlend = 0;
  }

  /** Hand this man back to the animation system. */
  private releaseRagdoll(inst: PlayerInstance): void {
    inst.ragPlay = null;
    inst.ragBlend = 0;
  }

  /**
   * Advance and apply one replayed fall. Returns true if it owns this man's
   * bones this frame (and so the procedural overrides must not also write).
   */
  private updateRagdoll(inst: PlayerInstance, step: number): boolean {
    const play = inst.ragPlay;
    if (!play) return false;
    play.update(step, inst.ragRate || 1);

    /* Ramp authority in, and back out again once the fall has finished, so
     * the return to the canned grounded idle is as soft as the entry. */
    const target = play.asleep ? 0 : 1;
    const rate = play.asleep ? 3.5 : 9;
    inst.ragBlend += (target - inst.ragBlend) * (1 - Math.exp(-rate * step));

    if (play.asleep && inst.ragBlend < 0.02) { this.releaseRagdoll(inst); return false; }

    driveRig(inst.ragBones!, inst.ragRest!, play, inst.root, RENDER_SCALE,
      inst.ragBlend, inst.ragOrigin);
    return inst.ragBlend > 0.5;
  }

  /* ============ PROCEDURAL LAYER — resolution and the three overrides ==== */

  /**
   * T-41 — BALANCE RECOVERY.
   *
   * The breakdown choreography moves a man by a metre and a half when he is
   * shoved at a ruck, and the engine is right to do that: it owns positions. But
   * a body whose position changes faster than its posture does is a body sliding
   * on ice, and that is precisely how "the men at the ruck look like grey shit"
   * was earned. So the lean is a presentation judgement on top of the same
   * measurement: a man shoved backwards pitches FORWARD to stay up, which is what
   * a real one does on the first step of a recovery.
   *
   * It writes `rotation.z` (lateral lean) and half of `rotation.x`, which the
   * tilt layer above has already finished with this frame — one writer per axis
   * per frame, the same rule the engine keeps for positions.
   */
  private applyBalance(inst: PlayerInstance, step: number) {
    const st = inst.st;
    const p = inst.proc;
    /* a solved fall, a clip that has him on the deck, or a maul engagement owns
     * his posture entirely: a second writer there is the T-02 fault in a jersey. */
    if (inst.rag || inst.ragBlend > 0.35 || inst.proc.ragW > 0.3 || st.lie) {
      st.jerk = 0; p.stagA = 0;
      if (inst.root.rotation.z !== 0) inst.root.rotation.z = 0;
      return;
    }
    const want = st.jerk * 0.42;
    p.stagA += (want - p.stagA) * (1 - Math.exp(-11 * step));
    if (p.stagA < 2e-3) {
      p.stagA = 0;
      inst.root.rotation.z = 0;
      return;
    }
    /* world shove direction into HIS frame: forward is +Z after the heading
     * rotation the root already carries, so the dot products split it into the
     * axis that pitches him and the axis that rolls him. */
    const c = Math.cos(inst.root.rotation.y), si = Math.sin(inst.root.rotation.y);
    const fwd = -(st.jz * c + st.jx * si);   // negative because a shove FROM BEHIND
    const lat = st.jx * c - st.jz * si;      // ...throws him forward, not back
    inst.root.rotation.z = -lat * p.stagA * 1.6;
    inst.root.rotation.x += fwd * p.stagA * 1.2;
    /* a lean about the feet sinks the head; the same compensation the tilt layer
     * uses, at the same scale, or the two systems disagree about the ground. */
    inst.root.position.y += Math.abs(p.stagA) * 0.5 * RENDER_SCALE;
  }

  /** Resolve (once, lazily) the bones the procedural layer drives. */
  private resolveRig(inst: PlayerInstance): ProceduralRig {
    if (inst.rig) return inst.rig;
    const find = (names: string[]): THREE.Bone | null => {
      for (const n of names) { const b = this.findBone(inst.root, n); if (b) return b; }
      return null;
    };
    const rig: ProceduralRig = {
      pelvis: find(BONE_NAMES.pelvis),
      spine: BONE_NAMES.spine.map(find),
      neck: find(BONE_NAMES.neck),
      upperArms: BONE_NAMES.upperArms.map(find),
      foreArms: BONE_NAMES.foreArms.map(find),
    };
    inst.rig = rig;
    if (import.meta.env?.DEV && !rig.pelvis && !rig.spine.some(Boolean)) {
      console.warn('[procedural] no spine/pelvis bones matched — the fake-ragdoll '
        + 'layer is inert. Check the rig naming convention against BONE_NAMES.');
    }
    return rig;
  }

  /**
   * 1 — PROCEDURAL BODY TILT.
   *
   * The tackler is pitched forward into the man he is holding, so that a
   * standing "hug" becomes a horizontal dive without anyone animating one.
   * The angle is driven by the DISTANCE between the two (committed and close
   * = flat out; still reaching = only leaning), and once the takedown fires
   * it tweens on to flat.
   *
   * The tilt is applied to `inst.root`, not to a bone, so the whole skinned
   * mesh rotates as one rigid body and the skinning is untouched — this is
   * what makes it safe against the mixer. Two consequences are handled here:
   * the pivot is the feet (the root origin), so a pure rotation would sink
   * the chest through the turf — the body is lifted by the sine of the tilt
   * to compensate — and the contact shadow is counter-rotated so it stays
   * flat on the grass instead of tipping up into a vertical disc.
   */
  private applyBodyTilt(inst: PlayerInstance, want: number, step: number, lift = true) {
    const p = inst.proc;
    p.tilt += (want - p.tilt) * (1 - Math.exp(-TILT_RATE * step));
    if (p.tilt < 1e-3) {
      /* fully upright again — clear the override rather than leaving the last
       * fractional tilt baked into the root. Without this reset a man who has
       * been tackled once stays permanently leaning, because rotation.x is
       * never otherwise written (only rotation.y is, every frame). */
      p.tilt = 0;
      inst.root.rotation.x = 0;
      inst.root.position.y = this.groundY(inst.actor.rx);
      if (inst.shadow) { inst.shadow.rotation.set(-Math.PI / 2, 0, 0); inst.shadow.position.y = 0.02; }
      return;
    }
    /* rotate about the model's own left-right axis. The root already carries
     * the heading on Y, so an X rotation applied after it is a clean forward
     * pitch in the direction he is facing whichever way that is. */
    inst.root.rotation.x = -p.tilt;
    /* lift the pivot so the torso does not intersect the pitch: the chest is
     * roughly 0.9 m up the body, and sin(tilt) is how much of that height the
     * rotation has just swung downward. */
    /* `lift` is off once a tackle reaches its grounding stage: from there the
     * clip's OWN pelvis Y track drops the hips onto the turf (the vertical
     * channel is deliberately preserved by stripRootMotion), and adding the
     * procedural lift on top floated the body above the grass. Keep the lift
     * only while the man is still on his feet leaning in, where the pivot is
     * genuinely at the feet and the chest would otherwise sink. */
    const rise = lift ? Math.sin(p.tilt) * 0.62 : 0;
    inst.root.position.y = rise * RENDER_SCALE + this.groundY(inst.actor.rx);
    if (inst.shadow) {
      /* undo the body pitch (and the lift) so the shadow stays a flat ellipse
       * on the turf under the man. */
      inst.shadow.rotation.set(-Math.PI / 2 + p.tilt, 0, 0);
      inst.shadow.position.y = 0.02 - rise;
    }
  }

  /**
   * 2 — PROCEDURAL ARM POINTING (the "magnetic latch").
   *
   * The tackler's arms are aimed at the carrier's spine in world space, every
   * frame, so his hands track the body he is holding however it twists —
   * killing the "air grab" where the arms hug an empty pose.
   *
   * NOT `lookAt()`: that aims an object's local +Z, and on this (Unreal)
   * skeleton bones run down their local +Y, so lookAt twists the arm sideways
   * into the chest. The rotation is built with `setFromUnitVectors` from the
   * bone's own +Y onto the direction to the target, then converted out of
   * world space into the parent's frame — a bone's `quaternion` is relative
   * to its parent, and writing a world rotation into it is the classic way to
   * get a limb that spins with the player's heading.
   *
   * The result is BLENDED against the animated pose rather than replacing it,
   * so the clip still supplies the elbow bend and the shoulder still moves
   * with the body: the arms are pulled toward the target, not snapped to it.
   */
  private applyArmReach(
    inst: PlayerInstance, target: THREE.Vector3 | null, weight: number, step: number,
  ) {
    const p = inst.proc;
    p.reach += (weight - p.reach) * (1 - Math.exp(-REACH_RATE * step));
    /* No target means the latch is over: let the weight decay to nothing and
     * write no bones at all. Continuing to aim at the LAST known point (the
     * scratch vector still holds it) would leave a released tackler reaching
     * at a patch of grass while the carrier ran away from it. */
    if (!target || p.reach < 0.01) return;
    const rig = this.resolveRig(inst);
    /* LEAD ARM. Both arms reach, but the one already nearer the target commits
     * harder — a tackler leads with a shoulder and a hand, he does not present
     * two symmetrical arms like a zombie. The far arm still follows at
     * REACH_TRAIL of the weight so the wrap closes from both sides. */
    let leadIsRight = true;
    {
      const r = rig.upperArms[0], l = rig.upperArms[1];
      if (r && l) {
        r.updateWorldMatrix(true, false); l.updateWorldMatrix(true, false);
        const dr = _v1.setFromMatrixPosition(r.matrixWorld).distanceToSquared(target);
        const dl = _v1.setFromMatrixPosition(l.matrixWorld).distanceToSquared(target);
        leadIsRight = dr <= dl;
      }
    }
    const bones = [...rig.upperArms, ...rig.foreArms];
    for (const bone of bones) {
      if (!bone || !bone.parent) continue;
      /* rig.upperArms and rig.foreArms are both ordered [right, left] */
      const isRight = bone === rig.upperArms[0] || bone === rig.foreArms[0];
      const armScale = isRight === leadIsRight ? 1 : REACH_TRAIL;
      bone.updateWorldMatrix(true, false);
      /* direction from this bone to the carrier's spine, in world space */
      _v1.setFromMatrixPosition(bone.matrixWorld);
      _dir.copy(target).sub(_v1);
      if (_dir.lengthSq() < 1e-6) continue;
      _dir.normalize();
      /* the bone's current world +Y — the direction it is actually pointing */
      _v2.set(0, 1, 0).applyQuaternion(
        _qb.setFromRotationMatrix(_mat.extractRotation(bone.matrixWorld)),
      ).normalize();
      /* world-space correction that swings +Y onto the target direction */
      _q.setFromUnitVectors(_v2, _dir);
      /* into the parent's frame: q_local = inv(parentWorld) * correction * boneWorld */
      const parentWorld = _qb.setFromRotationMatrix(
        _mat.extractRotation(bone.parent.matrixWorld),
      ).invert();
      const boneWorld = _qBone.setFromRotationMatrix(
        _mat.extractRotation(bone.matrixWorld),
      );
      const wanted = parentWorld.multiply(_q).multiply(boneWorld);
      /* blend, so the animation still reads through the reach */
      bone.quaternion.slerp(wanted, p.reach * REACH_WEIGHT * armScale);
    }
  }

  /**
   * 2b — TORSO DIP (the "magnetic lead").
   *
   * A forward pitch spread down the spine so the tackler drops his chest and
   * his eyes onto the waist he is aiming at, instead of reaching with his arms
   * alone off an upright trunk.
   *
   * Distributed across the spine chain the same way the thrash is, and for the
   * same reason: applying the whole angle to each of three PARENTED bones
   * compounds into a body folded in half. The neck takes a counter-rotation so
   * the head stays level and he keeps his eyes on the target rather than
   * ducking his face into his own chest.
   *
   * Runs after mixer.update() like every other override here, and decays to
   * exactly zero when the weight goes away so no dip is left baked into a man
   * who has let go.
   */
  /**
   * SPEC_25 — THE FOREARM HALF OF THE TWO-BONE SOLVE.
   *
   * `applyArmReach` swings a bone's +Y onto a target point, which is correct for an
   * upper arm and wrong for a forearm: the forearm's job is to run FROM the elbow, and
   * the elbow is decided by the limb lengths, not by the ball. So the engine solves
   * the chain (analytically, in `engine/ballcraft.ts`) and this writes only the
   * residual the reach cannot express — the forearm aligned on the solved elbow→hand
   * segment, blended by the same rate so nothing pops.
   */
  private applyCatchElbow(inst: PlayerInstance, weight: number, step: number) {
    const rig = this.resolveRig(inst);
    const s = RENDER_SCALE;
    const sides: [typeof rig.foreArms[number], BallCraftArm | null][] = [
      [rig.foreArms[0], inst.proc.craftR],
      [rig.foreArms[1], inst.proc.craftL],
    ];
    const blend = 1 - Math.exp(-REACH_RATE * step);
    for (const [bone, arm] of sides) {
      if (!bone || !bone.parent || !arm) continue;
      bone.updateWorldMatrix(true, false);
      _v1.setFromMatrixPosition(bone.matrixWorld);
      _dir.set((arm.hx - arm.ex) * s, arm.hy - arm.ey, -(arm.hz - arm.ez) * s);
      if (_dir.lengthSq() < 1e-6) continue;
      _dir.normalize();
      _v2.set(0, 1, 0).applyQuaternion(
        _qb.setFromRotationMatrix(_mat.extractRotation(bone.matrixWorld)),
      ).normalize();
      _q.setFromUnitVectors(_v2, _dir);
      const parentWorld = _qb.setFromRotationMatrix(
        _mat.extractRotation(bone.parent.matrixWorld),
      ).invert();
      const boneWorld = _qBone.setFromRotationMatrix(
        _mat.extractRotation(bone.matrixWorld),
      );
      const wanted = parentWorld.multiply(_q).multiply(boneWorld);
      bone.quaternion.slerp(wanted, weight * CRAFT_ELBOW_WEIGHT * blend);
    }
    /* Keep the solved elbow honest: the reach pass may have moved the upper arm since
     * this ran last frame, and a bone that has swung away leaves its forearm aiming at
     * a joint that is no longer there. The weight decays with the pose, so the two
     * converge rather than fight. */
    inst.proc.craftW = weight;
  }

  private applyTorsoDip(inst: PlayerInstance, weight: number, step: number) {
    const p = inst.proc;
    p.dip += (weight - p.dip) * (1 - Math.exp(-DIP_RATE * step));
    if (p.dip < 1e-3) { p.dip = 0; return; }
    const rig = this.resolveRig(inst);
    const angle = DIP_MAX * p.dip;
    const share = [0.45, 0.35];        // spine_01, spine_02 — spine_03 left free
    for (let i = 0; i < share.length; i++) {
      const bone = rig.spine[i];
      if (bone) bone.rotation.x += angle * share[i];
    }
    /* head stays up: undo most of what the spine just added */
    if (rig.neck) rig.neck.rotation.x -= angle * 0.62;
  }

  /**
   * 3 — PROCEDURAL SPINE THRASH.
   *
   * A high-frequency sine, scaled by how fast the man is actually travelling,
   * added into the spine and neck so a dragged carrier's upper body lurches
   * and fights instead of gliding along smoothly.
   *
   * Two deliberate departures from a naive `rotation.z += wobble`:
   *  - the phase is per-player and free-running, so two men latched at the
   *    same moment do not thrash in perfect unison (which reads as a glitch,
   *    not as a struggle);
   *  - the offset is distributed DOWN the chain with a rising weight and the
   *    neck counter-rotates, because adding the same angle to three parented
   *    bones compounds into a snapped-in-half spine, and a head that stays
   *    level is what makes the torso look like it is being fought over.
   */
  private applySpineThrash(inst: PlayerInstance, speed: number, weight: number, step: number) {
    const p = inst.proc;
    p.thrash += (weight - p.thrash) * (1 - Math.exp(-THRASH_RATE * step));
    if (p.thrash < 0.01) return;
    p.phase += step * THRASH_FREQ;
    const rig = this.resolveRig(inst);
    const drive = Math.min(1, speed / THRASH_REF_SPEED) * p.thrash;
    const wobble = Math.sin(p.phase) * drive * THRASH_MAX;
    /* a second, slower beat on the pitch axis so it is not a clean metronome */
    const pitch = Math.sin(p.phase * 0.63 + 1.1) * drive * THRASH_MAX * 0.5;
    const share = [0.34, 0.33, 0.33];
    rig.spine.forEach((bone, i) => {
      if (!bone) return;
      bone.rotation.z += wobble * share[i];
      bone.rotation.x += pitch * share[i];
    });
    /* the head fights to stay level — counter the total the spine just took */
    if (rig.neck) {
      rig.neck.rotation.z -= wobble * 0.55;
      rig.neck.rotation.x -= pitch * 0.55;
    }
  }

  /**
   * The whole procedural pass for one man, run AFTER `mixer.update()` has
   * sampled his pose for this frame. `partner` is the other half of a live
   * latch, or null.
   */
  private applyProcedural(
    inst: PlayerInstance, state: string, partner: PlayerInstance | null, step: number,
  ) {
    /* A SOLVED fall owns this man's whole body: the root tilt, the torso dip and
     * the thrash would all fight it for the same bones, and the argument is lost
     * by whichever runs last. The arm reach still runs below, at reduced weight,
     * because a tackler whose arms let go mid-fall has forgotten the tackle. */
    if (inst.proc.ragW > 0.30) {
      this.applyArmReach(inst, null, 0, step);
      this.applyTorsoDip(inst, 0, step);
      return;
    }
    const latching = state === 'latchHang';
    const latched = state === 'latchCarry';
    const grounding = state === 'tackleGround' || state === 'rollAway'
      || state === 'carrierFall' || state === 'present' || state === 'grounded';

    /* --- 1. the dive tilt (tackler), tweening to flat on the takedown --- */
    let wantTilt = 0;
    if (latching && partner) {
      const dist = inst.root.position.distanceTo(partner.root.position) / RENDER_SCALE;
      /* closer = more committed = flatter. Clamped either side of the band. */
      const t = 1 - (dist - TILT_FULL_RANGE) / (TILT_NO_RANGE - TILT_FULL_RANGE);
      wantTilt = TILT_MAX * Math.max(0, Math.min(1, t));
    } else if (grounding && (state === 'tackleGround' || state === 'rollAway')) {
      /* the takedown: continue the same rotation on to horizontal, so the
       * dive and the fall are one continuous movement rather than a cut.
       * A STANDING takedown gets much less of it: the procedural tilt is what
       * sells a horizontal dive, and a man wrestling another to the floor
       * from a standstill should stay far more upright. */
      wantTilt = TILT_GROUNDED * (inst.st.standingHit ? 0.45 : 1);
    }
    /* no procedural lift once the clip itself is putting him on the ground */
    this.applyBodyTilt(inst, wantTilt, step, !grounding);

    /* --- 2. the magnetic latch (tackler's arms onto the carrier) ---
     *
     * The anchor is the carrier's PELVIS dropped 0.15 m, not his chest: a legal
     * tackle goes in at the waist, and aiming at spine_01 had the arms closing
     * around the ribs. Falling back to the spine only if the rig has no pelvis.
     *
     * The weight RAMPS with distance rather than snapping to 1 — a man still a
     * couple of metions out is beginning to reach, not already wrapped. */
    if (latching && partner) {
      const prig = this.resolveRig(partner);
      const anchor = prig.pelvis ?? prig.spine[0];
      if (anchor) {
        anchor.updateWorldMatrix(true, false);
        _target.setFromMatrixPosition(anchor.matrixWorld);
        _target.y -= LATCH_WAIST_DROP * RENDER_SCALE;
        const dist = inst.root.position.distanceTo(partner.root.position) / RENDER_SCALE;
        const ramp = 1 - (dist - REACH_FULL_RANGE) / (REACH_NO_RANGE - REACH_FULL_RANGE);
        const w = REACH_MIN + (1 - REACH_MIN) * Math.max(0, Math.min(1, ramp));
        this.applyArmReach(inst, _target, w, step);
        /* TORSO DIP. He gets his eyes and his chest down to the height he is
         * aiming at. This is a small forward pitch spread over the spine, on
         * top of the whole-body tilt in step 1, and it is what stops the reach
         * looking like a man bending only at the shoulders. */
        this.applyTorsoDip(inst, w, step);
      }
    } else if (inst.st.hand > HAND_MIN) {
      /* THE BALL, NOT THE MAN. At a ruck the most interesting pair of hands belongs
       * to nobody's tackler: it is the jackal's, the guard's, the cleared man's as he
       * gets back in — and all three are aimed at the ball. The engine has been
       * computing exactly this scalar for its own contest (engine/hands.ts) and
       * nothing in the picture used it, which is why a steal looked like three men
       * standing near a pile of laundry. Here the same number bends the arms toward
       * the ball, and a strip that has got past half its own clock adds the wrench
       * of a man hauling something out of a crowd.
       *
       * The weight comes from the ENGINE's reach, not from distance here: a man two
       * metres out with his lane not yet arrived is not reaching, however close he
       * looks to the camera, and the rig would have had him grabbing at air. */
      const w = REACH_MIN + (1 - REACH_MIN) * Math.min(1, inst.st.hand + inst.st.strip * 0.35);
      this.applyArmReach(inst, _ballAim, w, step);
      this.applyTorsoDip(inst, w, step);
      /* pitch his chest over it. This is the jackal's pose and the one shape a
       * breakdown cannot be drawn without: hands under the ball, weight in front of
       * the defence. It shares `applyBodyTilt` with the diving tackler, so it
       * counter-rotates the shadow and lifts the pivot on the same rules. */
      this.applyBodyTilt(inst, Math.max(wantTilt, HAND_OVER_BALL_TILT * w), step, true);
    } else if (inst.proc.craftW > 0.01) {
      /* A CATCH IS NOT A LATCH. The reach above aims a bone at a point; a two-bone
       * chain also needs the elbow in the right plane, or the forearm cuts across the
       * chest and the hands meet the ball backwards. The engine's solver already
       * produced that elbow, so the rig's only job is to rotate the forearm onto the
       * elbow→hand axis with the same blend discipline the reach uses. */
      this.applyCatchElbow(inst, inst.proc.craftW, step);
      this.applyArmReach(inst, null, 0, step);
      this.applyTorsoDip(inst, 0.35 * inst.proc.craftW, step);
    } else {
      this.applyArmReach(inst, null, 0, step);   // no target: decay only
      this.applyTorsoDip(inst, 0, step);
    }

    /* --- 3. the struggle (carrier's spine) --- */
    /* A man wrenching at the ball and a carrier being dragged are the same
     * mechanism — a spine under load that the clip has no idea about — so the
     * strip borrows the thrash rather than inventing a fourth procedural pass. */
    this.applySpineThrash(inst, inst.st.spd, Math.max(latched ? 1 : 0, Math.min(1, inst.st.strip) * 0.75), step);
  }

  /* ------------------------------------------------------------- update -- */
  update(d: Director, _v: View, _cam: Camera, dt: number) {
    /* Not-ready is not nothing-ready. `ready` gates the ANIMATED path; it used
     * to gate EXISTING, so a match whose GLB failed to load played out on an
     * empty field with the camera politely framed on the turf and no man in it.
     * See `updateStandIn`. */
    if (!this.ready) { this.updateStandIn(d, dt); return; }
    const s = RENDER_SCALE;
    const active = new Set<string>();
    const step = Math.min(dt, 0.05);
    /* every instance updated this frame, for the paired procedural pass */
    const pending: PlayerInstance[] = [];
    /* The fall budget is recounting, not bookkeeping: a counter incremented on
     * start and decremented on retire drifts the first time a fall is released by
     * a quality switch or a reset, and then the budget is wrong for the rest of
     * the match. Thirty map reads a frame is nothing. */
    this.liveFalls = 0;
    for (const f of this.pool.values()) if (f.rag) this.liveFalls++;
    this.reactToCleanouts(d);
    /* Hands before the actor loop: the pass below aims a pair of arms at the ball,
     * and it can only do that if it already knows which men the engine has decided
     * are reaching. */
    this.syncHands(d);

    for (const a of d.actors) {
      /* CHAOS_SCRIM parks the 16 non-participating bodies. */
      if (a.hidden) continue;
      const team: KitTeam = a.team === 'REF' ? 'REF' : a.team;
      const inst = this.getOrCreate(team, a.num, a);
      active.add(this.key(team, a.num));
      const st = inst.st;

      // velocity from the streamed positions
      const vx = (a.rx - st.lx) / Math.max(step, 1e-4);
      const vz = (a.rz - st.lz) / Math.max(step, 1e-4);
      st.lx = a.rx; st.lz = a.rz;
      st.spd = Math.hypot(vx, vz);
      /* Smoothed, because this feeds the initial conditions of a physics solve
       * and a single noisy frame from a snapped position would fire a man into
       * the third row. The engine's own `live` velocities are not on the
       * presentation contract that `Actor` offers, so they are recovered here. */
      st.svx += (vx - st.svx) * Math.min(1, step * 14);
      st.svz += (vz - st.svz) * Math.min(1, step * 14);
      /* T-41 — THE SHOVE. `svx` lags the raw estimate by design, so the gap
       * between them IS the sudden change in velocity: a cleanout lands in one
       * frame and reads here as 3-4 m/s of difference, while a man accelerating
       * into a run reads as nothing. Presentation needs that distinction and the
       * engine has no reason to publish it — it is a fact about how a body is
       * seen, not a fact about the law. */
      const jx = vx - st.svx, jz = vz - st.svz;
      const jm = Math.hypot(jx, jz);
      if (jm > st.jerk) {
        st.jerk = Math.min(1, jm / 4.2);
        if (jm > 1e-3) { st.jx = jx / jm; st.jz = jz / jm; }
      } else {
        st.jerk *= Math.exp(-2.8 * step);
      }

      // heading: a moving man walks where he is going (smoothed); a slow man
      // holds his last facing.
      if (st.spd > 2.2) {
        const target = Math.atan2(vx, vz);
        let dy = target - st.face;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        st.face += dy * (1 - Math.exp(-step * 10));
      }

      // Bug-fix #4: in a SCRUM the two packs must lock head-on down the
      // engagement axis (scrumSlots lays the packs along Z: A at z<az, B at
      // z>az, rows spread on X). As the men walk in slowly their velocity
      // heading never crosses the 2.2 m/s threshold, so the smoothed heading
      // stayed on their sideways approach — the pack read as rotated 90°.
      // Hard-hold the engagement heading; the velocity logic still governs
      // open play, mauls (which have a yaw) and lineouts (formed along X).
      if ((d.phase === 'SCRUM' || d.phase === 'REPLAY') && team !== 'REF') {
        /* PART 3: the single authored engagement heading — A faces 0, B
         * faces π — shared with the engine so the pack cannot be pointing
         * one way in the simulation and another on screen. Hard-set (not
         * smoothed) once the pack is set: a bound forward has no heading of
         * his own, and the exponential blend left the last man in still
         * square to the touchline for half a second. */
        const want = scrumFacing(a.team as 'A' | 'B');
        let dy = want - st.face;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        st.face = Math.abs(dy) < 0.02 ? want : st.face + dy * (1 - Math.exp(-step * 14));
      }

      const desired = this.mapState(a.renderClip, st.spd);
      const locomoting = ['idle', 'walk', 'run', 'sprint'].includes(desired);

      /* SOILING. A man on the ground, in a ruck, or bound into a maul puts the
       * pitch onto his shirt. `grounded` stains fastest, because that is the
       * state where a shirt lies flat on real grass for a whole second. */
      if (this.soilRate > 0.02) {
        const dirty = desired === 'grounded' || desired === 'dive' || desired === 'ruck'
          || desired === 'bind' || desired === 'tackle' || desired === 'getup';
        if (dirty && inst.soil < 1) {
          inst.soil = Math.min(1, inst.soil
            + this.soilRate * step * (desired === 'grounded' ? 0.42 : 0.17));
          this.applySoil(inst);
        }
      }

      /* PART 1 — release the pass latch the moment the engine leaves the
       * pass state, so the NEXT pass gets a fresh single shot. */
      if (desired !== 'pass') st.passLatched = false;

      /* LATCH-AND-DRAG — THE STRUGGLE, BEFORE THE TAKEDOWN.
       *
       * This runs BEFORE the tackle timeline below, and deliberately does not
       * touch `st.tackleT`. The takedown that follows a latch arrives as an
       * ordinary transition into `tackle`/`grounded`, so the timeline starts
       * from stage 0 with a normal crossfade and the struggle flows straight
       * into the impact → grounding → presentation sequence with no seam. */
      if (desired === 'latchCarry' || desired === 'latchHang') {
        if (st.oneShot !== desired) {
          if (desired === 'latchCarry') {
            /* the carrier keeps churning. A long crossfade out of the sprint
             * is what sells the loss of pace: he does not snap into the
             * struggle, he is dragged down into it over a third of a
             * second. */
            const a = this.play(inst, 'latchCarry', 0.3, LATCH_CHURN_RATE);
            a?.setLoop(THREE.LoopRepeat, Infinity);
          } else {
            /* the hanger holds the drive pose. LoopOnce + clampWhenFinished
             * (set in play()) freezes him wrapped around the carrier's
             * waist, and the engine's coordinate snap does the travelling. */
            this.play(inst, 'latchHang', 0.12, 1.35);
          }
          st.oneShot = desired;
          st.lock = 0;
        }
        st.lie = false;
        st.passLatched = false;
        st.tackleRole = null; st.tackleT = -1;
        st.ragFired = false;   // arm the next hit, or a man ragdolls only once
        inst.proc.state = desired;
        inst.root.position.set(a.rx * s, this.groundY(a.rx), -a.rz * s);
        inst.root.rotation.y = Math.PI - st.face;
        inst.mixer.update(step);
        /* remember where the tackle clip actually got to, so the next stage
         * can resume from here instead of rewinding to frame 0 */
        if (inst.active) st.tackleClipT = inst.active.action.time;
        pending.push(inst);
        continue;
      }
      if (st.oneShot === 'latchCarry' || st.oneShot === 'latchHang') {
        /* the latch broke or the takedown fired — release the hold so the
         * branches below own the body again. */
        st.oneShot = null; st.lock = 0;
      }

      /* PART 2 — THE TACKLE TIMELINE.
       *
       * A tackle used to be one 0.8 s clip fired on the impact frame while
       * the physics had already zeroed both men: they stopped dead, then
       * slowly folded over on the spot. It is now a three-stage sequence
       * driven by a clock that starts on impact and runs alongside the
       * kinetic-impact window in engine/breakdown.ts. */
      const tackleSide: 'TACKLER' | 'CARRIER' | null =
        desired === 'tackle' ? 'TACKLER'
          : desired === 'grounded' ? 'CARRIER' : null;
      if (tackleSide && st.tackleRole !== tackleSide) {
        // fresh collision for this man — restart the sequence
        st.tackleRole = tackleSide;
        /* MOMENTUM BRANCH: latch the engine's verdict for this collision now,
         * so the whole three-stage sequence plays as one kind of hit even if
         * the breakdown is torn down underneath it mid-fall. */
        st.standingHit = d.bd?.hitKind === 'STANDING';
        st.tackleT = 0;
        st.tackleClipT = 0;
        st.oneShot = null;
      } else if (!tackleSide && st.tackleRole) {
        st.tackleRole = null; st.tackleT = -1;
        st.ragFired = false;   // arm the next hit, or a man ragdolls only once
      }
      /* A man getting to his feet hands his body back to the animator; the
       * weight below fades it out rather than snapping the pose. */
      if (st.tackleRole === null && desired !== 'grounded' && desired !== 'getup'
        && (locomoting || desired === 'ruck' || desired === 'bind')) {
        inst.rag?.dispose();
        inst.rag = null;
      }

      if (st.tackleRole) {
        const prev = st.tackleT;
        st.tackleT += step;
        const stageOf = (t: number) => (t < TACKLE_IMPACT_END ? 0 : t < TACKLE_GROUND_END ? 1 : 2);
        const wantStage = stageOf(st.tackleT);
        if (prev < 0 || stageOf(prev) !== wantStage) {
          const carrier = st.tackleRole === 'CARRIER';
          const state = wantStage === 0
            ? (carrier ? 'hitReact' : 'tackleDrive')       // 0.00–0.15 IMPACT
            : wantStage === 1
              ? (carrier ? 'carrierFall' : 'tackleGround') // 0.15–0.40 GROUNDING
              : (carrier ? 'present' : 'rollAway');        // > 0.40 RUCK PREP
          /* DYNAMIC TIME SCALING — fit the clip to the stage.
           *
           * The stage windows are short (IMPACT 0.15 s, GROUNDING 0.25 s) but
           * the clips are long: Tackle 0.83 s, DiveRoll 1.47 s, Death 2.40 s.
           * At timeScale 1 each stage showed only the first 10-18% of its
           * clip and was then cut off mid-motion by the next crossfade — the
           * man never got as far as the part where he goes to ground, which
           * is why the grounding read as a fold-in-place. Scaling each clip
           * by (its duration / its window) makes it play through COMPLETELY
           * inside the stage, so the mesh reaches the turf exactly as the
           * engine's kinetic-impact momentum reaches zero. */
          const win = wantStage === 0
            ? TACKLE_IMPACT_END
            : wantStage === 1 ? TACKLE_GROUND_END - TACKLE_IMPACT_END : 0;
          const prevName = st.oneShot ? this.clipForState(st.oneShot).name : null;
          const nextName = this.clipForState(state).name;
          /* A takedown on the spot is a slower, heavier movement than a dive
           * at 10 m/s. Same clip, stretched, so the two hits do not read as
           * the same event replayed. */
          const rate = this.fitTimeScale(state, win) * (st.standingHit ? 0.62 : 1);
          /* RAGDOLL HANDOVER. Stage 1 is the GROUNDING — the moment the canned
           * clip would start folding the man to the turf. That is exactly where
           * a physical fall is both cheapest (he is committed, nothing left to
           * steer) and most valuable (it is the part every canned tackle makes
           * look identical). World-space velocity: the renderer maps logical z
           * to world -z, so vz is negated or the body is thrown back up-field
           * against the tackle. */
          if (wantStage === 1 && !st.ragFired) {
            st.ragFired = true;
            this.spawnBakedFall(inst, vx * RENDER_SCALE, -vz * RENDER_SCALE, st.standingHit);
          }
          const act = this.play(inst, state, wantStage === 0 ? 0.05 : 0.12, rate);
          /* CONTINUE, DO NOT RESTART.
           *
           * Stage 0 and stage 1 now resolve to the SAME retargeted clip: one
           * authentic tackle contains both the drive and the fall, where the
           * old stand-ins needed a different clip per stage. play() calls
           * reset(), so without this the stage-1 crossfade would rewind to
           * frame 0 and replay the wind-up — the man would hit, then wind up
           * and hit again, never reaching the ground. When the clip is
           * unchanged across a stage boundary the playhead is carried over so
           * the motion runs on continuously into the grounding. */
          if (act && prevName && prevName === nextName) act.time = st.tackleClipT;
          st.oneShot = state;
          st.lock = 0;
        }
        st.lie = true;
        /* THE FALL. Physics takes over the moment the drive ends and the ground
         * begins — see render/ragdoll.ts for why the drive stays authored. */
        if (wantStage >= 1) this.startFall(inst, this.fallPartner(inst, pending));
        /* The roll-away is authored, so the fall is CALLED rather than taken: a
         * solved body that is still stepping when the get-up clip starts pulls at
         * it. `settled` freezes the pose and the weight below fades it out, so the
         * hands back happens on a calm body instead of a mid-air one. */
        else if (inst.rag) inst.rag.settled = wantStage === 2 || inst.rag.settled;
        inst.proc.state = wantStage === 0
          ? (st.tackleRole === 'CARRIER' ? 'hitReact' : 'tackleDrive')
          : wantStage === 1
            ? (st.tackleRole === 'CARRIER' ? 'carrierFall' : 'tackleGround')
            : (st.tackleRole === 'CARRIER' ? 'present' : 'rollAway');
        inst.root.position.set(a.rx * s, this.groundY(a.rx), -a.rz * s);
        inst.root.rotation.y = Math.PI - st.face;
        inst.mixer.update(step);
        pending.push(inst);
        continue;
      }

      // ---- one-shots & downed sequencing ----
      if (desired === 'tackle' && !st.lie) {
        this.play(inst, 'tackle', 0.12, 1);
        st.oneShot = 'tackle'; st.lock = 0.8; st.lie = true;
      } else if (desired === 'dive' && st.oneShot !== 'dive') {
        this.play(inst, 'dive', 0.12, 1);
        st.oneShot = 'dive'; st.lock = 0.7; st.lie = true;
      } else if (desired === 'try' && st.oneShot !== 'tryStart' && st.oneShot !== 'tryLoop') {
        this.play(inst, 'tryStart', 0.1, 1.05);
        st.oneShot = 'tryStart'; st.lock = 0.55;
      } else if (desired === 'pass' && st.oneShot !== 'pass' && !st.passLatched) {
        /* PART 1 — fire it once, latch it, hold the final frame. The latch is
         * what stops a re-trigger on the frames the engine is still reporting
         * `pass`; it clears above when the state leaves `pass`. */
        this.play(inst, 'pass', 0.1, 1.1);
        st.oneShot = 'pass'; st.lock = 0.45; st.passLatched = true;
      } else if (desired === 'kick' && st.oneShot !== 'kick') {
        this.play(inst, 'kick', 0.12, 1);
        st.oneShot = 'kick'; st.lock = 0.7;
      } else if (desired === 'getup' && st.oneShot !== 'getup') {
        /* Fit the stand-up to the engine's lock so he is upright exactly as
         * the AI regains control of him — otherwise the clip is cut off
         * mid-rise and he snaps to a run from a crouch. */
        this.play(inst, 'getup', 0.18, this.fitTimeScale('getup', RECOVER_SECONDS));
        st.oneShot = 'getup'; st.lock = RECOVER_SECONDS; st.lie = false;
      } else if (desired === 'grounded' || (st.lie && !locomoting && desired !== 'getup')) {
        // hold the downed/lying pose on a near-frozen Death clip
        if (inst.active?.name !== 'grounded') {
          const action = this.play(inst, 'grounded', 0.25, 0.2);
          action?.setLoop(THREE.LoopRepeat, Infinity);
        }
        st.lie = true;
        if (desired === 'grounded') { st.oneShot = 'grounded'; st.lock = 0; }
      } else if (['bind', 'ruck', 'jump', 'crouch'].includes(desired)) {
        st.oneShot = null;
        if (inst.active?.name !== desired) this.play(inst, desired, 0.18, 1);
      } else if (locomoting) {
        // stood back up -> let the GetUp one-shot finish, then locomotion takes over
        if (st.oneShot === 'getup') { /* held until lock expires */ }
        else {
          if (st.lie && st.oneShot !== 'getup') {
            this.play(inst, 'getup', 0.18, this.fitTimeScale('getup', RECOVER_SECONDS));
            st.oneShot = 'getup'; st.lock = RECOVER_SECONDS; st.lie = false;
          } else {
            st.oneShot = null;
            st.lie = false;
            this.setLocomotion(inst, desired, st.spd);
          }
        }
      }

      // release expired one-shots (blend back to the gait)
      if (st.oneShot && st.lock > 0) {
        st.lock -= step;
        if (st.lock <= 0) {
          if (st.oneShot === 'tryStart') {
            st.oneShot = 'tryLoop'; st.lock = 0;
            this.play(inst, 'tryLoop', 0.15, 1);
          } else if (st.oneShot === 'tryLoop' && desired !== 'try') {
            st.oneShot = null;
          } else if (st.oneShot !== 'grounded' && st.oneShot !== 'tryLoop') {
            st.oneShot = null;
            this.setLocomotion(inst, this.locomotion(st.spd), st.spd);
          }
        }
      } else if (st.oneShot === 'tryLoop' && desired !== 'try') {
        st.oneShot = null;
        st.lie = false;
        this.setLocomotion(inst, this.locomotion(st.spd), st.spd);
      } else if (st.oneShot === 'grounded' && desired !== 'grounded' && !st.lie) {
        st.oneShot = null;
        this.setLocomotion(inst, this.locomotion(st.spd), st.spd);
      }

      // ---- transform: logical pitch -> scaled 3D world ----
      inst.proc.state = desired;
      inst.root.position.set(a.rx * s, this.groundY(a.rx), -a.rz * s);
      // The rig faces +Z at rest; forward heading theta maps to rotation.y.
      inst.root.rotation.y = Math.PI - st.face;

      inst.mixer.update(step);
      pending.push(inst);
    }

    /* ---- THE PROCEDURAL PASS ----
     *
     * Runs after EVERY man has been sampled, for two reasons. The mixer
     * overwrites each bone it animates, so the overrides can only be written
     * afterwards or they are erased the moment they are applied; and the
     * latch overrides are PAIRED — the tackler's arms are aimed at the
     * carrier's spine — so the carrier's pose for this frame has to already
     * exist before the tackler can be pointed at it. Doing it inside the
     * main loop would aim him at wherever the carrier stood last frame,
     * which at seven metres a second is a visible hand-lag. */
    for (const inst of pending) {
      /* RAGDOLL FIRST. A physics-driven man owns his bones completely —
       * running the procedural tilt/reach/thrash on top would be two systems
       * writing the same rotations, the render-side twin of the T-02
       * double-move the simulation already forbids. */
      if (this.updateRagdoll(inst, step)) continue;
      const partner = this.latchPartner(inst, pending);
      this.applyProcedural(inst, inst.proc.state, partner, step);
      this.applyBalance(inst, step);
    }
    /* THE FALLS. They run in their own loop, after every animated pose exists
     * and after `applyProcedural` has stood aside: two falling men push on each
     * other, and a body has to be resisted by where the other one got to THIS
     * frame, or the pair sink through one another on the deck. Two passes for
     * the same reason — every solve first, then every pose. */
    for (const inst of pending) {
      const rag = inst.rag;
      if (!rag) {
        if (inst.proc.ragW > 0.001) inst.proc.ragW *= Math.exp(-step * 7);
        continue;
      }
      /* In, fast; out, slower. A man does not stop falling the frame the sim
       * decides he has finished, and the get-up clip has to meet a body that is
       * still mostly where it fell, not one that snapped upright. */
      const want = rag.settled ? 0 : 1;
      inst.proc.ragW += (want - inst.proc.ragW) * (1 - Math.exp(-(want ? 13 : 6) * step));
      rag.weight = inst.proc.ragW;
      /* Where the engine moved him since the last frame: the solver is dragged
       * along instead of being left behind, and it is the DELTA it applies, not a
       * teleport, so a break-off mid-fall cannot rip the legs out. */
      rag.setAnchor(inst.actor.rx, -inst.actor.rz);
      /* THE WRAP SURVIVES THE FALL. The tackler's hands are pinned to the
       * carrier's waist while both men are still going down — in the solver's own
       * language rather than as an animation layered over it: the pin is a soft
       * pull, so a man thrown clear lets go by himself as the distance grows.
       * Set before the step, because a pin that arrives after the solve is a pin
       * that does nothing for one frame. */
      const mate = this.fallPartner(inst, pending);
      rag.clearPins();
      if (mate && inst.st.tackleRole === 'TACKLER' && rag.weight > 0.25) {
        const waist = this.resolveRig(mate).pelvis ?? this.resolveRig(mate).spine[0];
        if (waist) {
          waist.updateWorldMatrix(true, false);
          const sc = mate.root.getWorldScale(_v2);
          const inv = sc.x > 1e-6 ? 1 / sc.x : 1;
          _target.setFromMatrixPosition(waist.matrixWorld).multiplyScalar(inv);
          const k = 0.055 * rag.weight;
          rag.pin('hand_l', _target.x, _target.y, _target.z, k);
          rag.pin('hand_r', _target.x, _target.y, _target.z, k);
        }
      }
      rag.step(step);
      for (const hit of rag.takeContacts()) {
        /* Sim metres -> pitch metres. The model's z runs opposite the engine's
         * down-field axis, and that sign is the only translation here. */
        this.groundHits.push({ x: hit.x, z: -hit.z, force: hit.force });
      }
    }
    for (const inst of pending) {
      const rag = inst.rag;
      if (!rag) continue;
      const mate = this.fallPartner(inst, pending);
      if (mate?.rag) Ragdoll.contact(rag, mate.rag, this.bounce);
      rag.apply();
      /* The engine owns where he IS; the fall owns how much of him is on the
       * grass, and how far he slid from where he was hit. Both are clamped: a
       * solver that disagrees with the simulation about a man's position is a
       * solver that has to lose, because the ruck, the offside line and the
       * referee all read the simulation. */
      const w = rag.weight;
      const drop = Math.max(-0.95, Math.min(0, rag.dropY)) * w * RENDER_SCALE;
      const dr = rag.drift;
      const lim = 0.5;
      inst.root.position.set(
        inst.actor.rx * RENDER_SCALE + Math.max(-lim, Math.min(lim, dr.x)) * w * RENDER_SCALE,
        drop,
        -inst.actor.rz * RENDER_SCALE + Math.max(-lim, Math.min(lim, dr.z)) * w * RENDER_SCALE,
      );
      if (inst.shadow) {
        /* A body on the deck covers more turf and sits closer to it. */
        inst.shadow.scale.set(0.95 + w * 0.5, 0.50 + w * 0.34, 1);
        inst.shadow.position.y = 0.02 * (1 - 0.55 * w);
      }
      if (rag.settled && inst.proc.ragW < 0.02) { rag.dispose(); inst.rag = null; }
    }

    for (const [k, inst] of this.pool) {
      if (!active.has(k)) {
        inst.root.visible = false;
        /* A man who left the field must not hold a pool slot hostage. */
        if (inst.ragPlay) this.releaseRagdoll(inst);
      }
    }

    this.updateBall(d, step);
  }

  private updateBall(d: Director, dt: number) {
    const s = RENDER_SCALE;
    const free = { x: 0, y: 0, z: 0, visible: false };
    let carrier: PlayerInstance | null = null;

    if (d.phase === 'CHAOS_SCRIM' && d.chaos && d.chaos.ballSecured) {
      /* BALL SECURED — the ball is welded to the human carrier's hand socket. */
      carrier = this.pool.get(this.key(d.chaos.player.team as KitTeam, d.chaos.player.num)) ?? null;
    } else if (d.phase === 'SCRUM' || d.phase === 'REPLAY') {
      const sc = d.scrim!;
      if (sc && sc.ball.state !== 'HELD') {
        /* The ball travels IN the tunnel: its draw position carries the
         * tunnel's displacement, the same `netDrive` the packs displace by. */
        free.x = d.scrumAnchor.x + sc.ball.x; free.y = sc.ball.y + 0.06; free.z = d.scrumAnchor.z + sc.ball.z + sc.netDrive; free.visible = true;
      }
    } else if ((d.phase === 'LINEOUT' || d.phase === 'LINEOUT_REPLAY') && d.lo && d.lo.ball.state !== 'HELD') {
      free.x = d.lo.ball.x; free.y = d.lo.ball.y + 0.05; free.z = d.lo.ball.z; free.visible = true;
    } else if ((d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk) {
      const k = d.kk;
      if (k.stage !== 'SETUP') { free.x = k.bx; free.y = k.by + 0.12; free.z = k.bz; free.visible = true; }
    } else if (d.phase === 'OPEN_PLAY' && d.op) {
      const o = d.op;
      /* SPEC_25 — a ball that has been dropped or punted is a loose ball on screen
       * even though the phase still counts the catcher as its owner (that is how the
       * laws and the watchdogs stay satisfied through a 0.3 s drop). `ball.live` is
       * the PASS flag and cannot be reused for it, so the craft's own free body is
       * what the ball is drawn from. */
      if (d.bc?.free) {
        const f = d.bc.free;
        free.x = f.x; free.y = f.y; free.z = f.z; free.visible = true;
      } else if (o.ball.live) { free.x = o.ball.x; free.y = o.ball.y; free.z = o.ball.z; free.visible = true; }
      else carrier = this.pool.get(this.key(o.attacking === 'A' ? 'A' : 'B', o.carrierNum)) ?? null;
    } else if ((d.phase === 'MAUL' || d.phase === 'MAUL_REPLAY') && d.ml) {
      const m = d.ml;
      const yawRad = (m.yaw * Math.PI) / 180;
      const lz = -m.dir * m.ballRank * 0.78;
      free.x = m.x - lz * Math.sin(yawRad); free.y = 1.02;
      free.z = m.z + lz * Math.cos(yawRad); free.visible = true;
    } else if ((d.phase === 'BREAKDOWN' || d.phase === 'BREAKDOWN_REPLAY') && d.bd) {
      const b = d.bd;
      const cr = b.players.find((p) => p.role === 'CARRIER');
      if (b.ball.placed || b.stage === 'RUCK' || b.stage === 'RECYCLE') {
        free.x = b.ball.x; free.y = 0.16; free.z = b.ball.z; free.visible = true;
      } else if (cr) {
        free.x = cr.x + 0.28; free.y = cr.down ? 0.3 : 1.05; free.z = cr.z; free.visible = true;
      }
    }

    /* A wet ball is a darker ball, and it is the one piece of kit that is
     * genuinely soaked through all match. The engine already widened handling
     * error by `wetnessOf()`; this is that number, seen. */
    if (this.ballMat) {
      const w = this.wetLevel;
      this.ballMat.color.setHex(0xb8562f).multiplyScalar(1 - w * 0.26);
      this.ballMat.roughness = 0.45 - w * 0.12;
      this.ballMat.emissive.copy(ThreePlayerManager.SOAK).multiplyScalar(0.03 + w * 0.12);
    }

    this.ball.visible = free.visible || !!carrier;
    if (carrier) {
      /* PART 2 (BALL SOCKETING). The ball used to be synced to the 2D
       * simulation's ground coordinates even while a man was carrying it, so
       * it slid along the floor beside him. A carried ball is not a simulated
       * body: its world matrix is OVERRIDDEN by the carrying hand's. Parent
       * it to the hand bone (Quaternius rig: hand_r, with the forearm and the
       * left hand as fallbacks) and let the skeleton drive it; the parent
       * root already carries RENDER_SCALE, so the socket offsets below are in
       * model metres. */
      const hand = this.carryBone(carrier);
      if (hand) {
        if (this.ball.parent !== hand) hand.add(this.ball);
        this.ball.position.set(0, 0.05, 0.03);
        this.ball.rotation.set(0.2, 0, Math.PI / 2.4);
        this.ball.scale.setScalar(1);
      }
    } else if (free.visible) {
      if (this.ball.parent !== this.scene) {
        this.ball.parent?.remove(this.ball);
        this.scene.add(this.ball);
      }
      /* THE BALL IS BEING FOUGHT OVER. The engine's contest publishes the direction
       * the hands are dragging in and how hard (`pullX/pullZ`, `tug`), and before
       * this the number went nowhere: the ball at a ruck sat welded to the turf like
       * a traffic cone while eight men shoved at it, which is the single detail that
       * most told the player the pile was decoration. Half a metre of lean, a few
       * centimetres off the deck as the grip is wrenched, and a roll that speeds up
       * under the tug — all of it presentation, none of it moving the ball's engine
       * position, because a ball the rig moved would be two owners of one position. */
      const bd = d.bd;
      const tug = this.ruckTug;
      const px = bd?.hands?.pullX ?? 0, pz = bd?.hands?.pullZ ?? 0;
      if (tug > 0.02) this.ballWobble += dt * 26;
      const wob = tug > 0.02 ? Math.sin(this.ballWobble) * 0.045 * tug : 0;
      this.ball.position.set(
        (free.x + px + wob) * s,
        free.y * s + this.groundY(free.x) + tug * 0.035 * s,
        (-free.z + pz + wob * 0.6) * s,
      );
      this.ball.rotation.z += dt * (6 + tug * 9);
      this.ball.rotation.x += dt * (3 + tug * 5);
      this.ball.scale.setScalar(s);
    } else if (this.ball.parent !== this.scene) {
      this.ball.parent?.remove(this.ball);
      this.scene.add(this.ball);
    }
  }

  /**
   * The carrying-hand socket bone of a player, cached per instance.
   * Quaternius' rig names the wrist `hand_r`; the forearm (`lowerarm_r`) is
   * the fallback when a clip's hand track is missing, and the left hand the
   * last resort.
   */
  private carryBone(inst: PlayerInstance): THREE.Bone | null {
    if (inst.handBone !== undefined) return inst.handBone;
    const bone = this.findBone(inst.root, 'hand_r')
      ?? this.findBone(inst.root, 'lowerarm_r')
      ?? this.findBone(inst.root, 'hand_l');
    inst.handBone = bone;
    return bone;
  }

  private findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
    let found: THREE.Bone | null = null;
    root.traverse((o) => { if (!found && (o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone; });
    return found;
  }

  /** SPEC_06 facing/strafe overlay feed (view is now true 3D facing). */
  /**
   * Is this man currently driven by the ragdoll solver rather than a clip?
   *
   * TARCS calls this the ACTIVE/KINEMATIC split. Both the live solver (`rag`)
   * and the baked-clip playback (`ragPlay`) count as active: in either case
   * physics owns the transform and the animation state machine does not,
   * which is the distinction the debug panel exists to show.
   */
  isRagdolled(team: string, num: number): boolean {
    for (const inst of this.pool.values()) {
      if (inst.team !== team || inst.num !== num) continue;
      return !!(inst.rag || inst.ragPlay);
    }
    return false;
  }

  debugEntries() {
    const out: { key: string; team: string; num: number; gait: string; spd: number; face: number }[] = [];
    for (const [key, inst] of this.pool) {
      if (!inst.root.visible) continue;
      out.push({
        key, team: inst.team, num: inst.num,
        gait: inst.st.oneShot ?? inst.active?.name ?? 'idle',
        spd: inst.st.spd, face: inst.st.face,
      });
    }
    return out;
  }
}
