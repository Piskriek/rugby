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
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Director, Actor } from '../game/director';
import { RENDER_SCALE, Camera, View } from './retro';
import { scrumFacing } from '../game/behaviour/setpiece-overrides';

const MODEL_URL = 'assets/models/rugby_player.glb';
/* Retargeted Mixamo tackle pair, baked by tools/fetch_mixamo.mjs. Animation
 * only (~90 KB, no meshes) — it rides on the player rig loaded above. */
const TACKLE_PAIR_URL = 'assets/models/tackle_pair.glb';

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

/* ------------------------------------------------------------- lighting -- */
function makeToonGradient(): THREE.DataTexture {
  // Two hard bands: flat cel look matching the 2D pitch's flat fills.
  const data = new Uint8Array([148, 148, 148, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}


/* ================== PROCEDURAL "FAKE RAGDOLL" LAYER ==================
 *
 * Canned clips cannot know how far apart two men are, how fast they are
 * travelling or which way they are twisting, so a latch built purely out of
 * them reads as a hug between two statues. Rather than a physics engine (a
 * true ragdoll would fight the AnimationMixer and wreck the skinning), the
 * chaos is written ON TOP of the sampled pose, every frame, in three layers:
 *
 *   1  BODY TILT    the whole mesh pitches forward into the carrier, so the
 *                   tackler is flying horizontally rather than standing up
 *   2  ARM POINTING the tackler's arm bones are aimed at the carrier's spine
 *                   in world space, so his hands track the man he is holding
 *   3  SPINE THRASH a velocity-scaled sine injected into the carrier's spine
 *                   and neck, so he fights and lurches under the weight
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
  /** lazily-resolved procedural bone set — see resolveRig() */
  rig?: ProceduralRig;
  /** smoothed procedural state, so nothing pops between frames */
  proc: {
    /** current forward pitch of the whole body, radians */
    tilt: number;
    /** 0..1 weight of the arm-pointing override */
    reach: number;
    /** 0..1 weight of the spine thrash */
    thrash: number;
    /** free-running phase for the wobble, so two men never wobble in sync */
    phase: number;
    /** the FSM state resolved this frame, for the post-mixer pass */
    state: string;
  };
  active: { name: string; action: THREE.AnimationAction } | null;
  st: {
    oneShot: string | null;      // non-looping/locked clip state
    lock: number;                // seconds left to hold the one-shot
    lie: boolean;                // grounded until an engine 'getup'/motion
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
    /** playhead of the tackle clip, carried across stage boundaries so a
     *  single authentic clip runs on instead of restarting each stage. */
    tackleClipT: number;
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

export class ThreePlayerManager {
  ready = false;
  private template: THREE.Group | null = null;
  private templateClips: THREE.AnimationClip[] = [];
  private gradient = makeToonGradient();
  private pool = new Map<string, PlayerInstance>();
  private readonly scene: THREE.Scene;
  private ball: THREE.Group;
  private shadowGeo: THREE.CircleGeometry;
  private shadowMat: THREE.MeshBasicMaterial;
  private badgeTextures = new Map<string, THREE.Texture>();

  constructor(three: import('./ThreeCanvas').ThreeCanvas) {
    this.scene = three.scene;

    const key = new THREE.DirectionalLight(0xfff4df, 2.2);
    key.position.set(-30, 60, 24);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9db8ec, 0.5);
    fill.position.set(40, 22, -30);
    this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a5a36, 0.45));

    this.shadowGeo = new THREE.CircleGeometry(0.52, 20);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x0c0d10, transparent: true, opacity: 0.26, depthWrite: false,
    });

    this.ball = this.buildBall();
    this.scene.add(this.ball);
  }

  /* ------------------------------------------------------------ loading -- */
  load(): Promise<void> {
    const loader = new GLTFLoader();
    const one = (url: string) => new Promise<THREE.AnimationClip[] | null>((res) => {
      loader.load(url, (g) => res(g.animations),
        undefined, () => res(null));   // optional asset: absent = fall back
    });
    return new Promise((resolve, reject) => {
      loader.load(MODEL_URL, async (gltf) => {
        this.template = gltf.scene;
        const base = gltf.animations.map(stripRootMotion);
        /* The retargeted pair is already in-place (the tool drops the source's
         * horizontal channel) so it does NOT go through stripRootMotion again;
         * doing so would be harmless but pointless. It is loaded second and
         * concatenated, so `MX_Tackle` / `MX_TackleReact` simply become two
         * more entries in the same clip table. */
        const extra = await one(TACKLE_PAIR_URL);
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
        this.ready = true;
        resolve();
      }, undefined, reject);
    });
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

    const bodyMats: Record<Slot, THREE.MeshToonMaterial> = {} as Record<Slot, THREE.MeshToonMaterial>;
    for (const slot of SLOTS) {
      // Bug-fix #1: fully opaque, front-face only, depth writes ON. Transparent
      // body materials made the renderer disable depth writes and sort limbs
      // inside-out (the "see-through / inverted depth" look).
      const m = new THREE.MeshToonMaterial({
        color: 0xffffff, gradientMap: this.gradient,
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
        m.castShadow = false;
        m.name = `body_${slot}`;
        parent.add(m);
      }
      parent.remove(body);
      body.geometry.dispose();
    }

    // Face materials: hair dark, eyes light — opaque & front-facing.
    for (const f of faces) {
      const matName = (f.material as THREE.Material)?.name ?? '';
      if (matName === 'MI_Hair_1') {
        f.material = new THREE.MeshToonMaterial({
          color: 0x2a1c14, gradientMap: this.gradient,
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

  /* ----------------------------------------------------------- ball ----- */
  private buildBall(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'Ball3D';
    const geo = new THREE.SphereGeometry(0.16, 18, 12);
    geo.scale(1.0, 0.78, 1.65);
    g.add(new THREE.Mesh(geo, new THREE.MeshToonMaterial({
      color: 0xb8562f, gradientMap: this.gradient,
      transparent: false, opacity: 1, depthWrite: true, side: THREE.FrontSide,
    })));
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

  /* ------------------------------------------------------------ pooling -- */
  private key(team: KitTeam, num: number) { return `${team}:${num}`; }

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
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material as THREE.Material];
      const replaced: THREE.Material[] = [];
      for (const mat of mats) {
        const name = mat.name ?? '';
        let out: THREE.Material = mat;
        const slot = (Object.keys(TEMPLATE_SLOT_MAT) as Slot[]).find((s) => TEMPLATE_SLOT_MAT[s] === name);
        if (slot && slot !== 'hair' && slot !== 'eyes') {
          // Bug-fix #1: opaque kit materials, front faces only, depth writes on.
          out = new THREE.MeshToonMaterial({
            color: new THREE.Color(slotColour[slot]),
            gradientMap: this.gradient,
            transparent: false, opacity: 1, depthWrite: true, depthTest: true, side: THREE.FrontSide,
          });
          out.name = `M_${slot}`;
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
    shadow.scale.set(0.95, 0.42, 1);
    shadow.renderOrder = -1;
    root.add(shadow);
    // kept so the procedural body tilt can counter-rotate it flat (below)
    const shadowRef = shadow;

    const inst: PlayerInstance = {
      actor, team, num, root, mixer, clips, badgeMat, shadow: shadowRef,
      active: null,
      proc: {
        tilt: 0, reach: 0, thrash: 0,
        phase: (num * 1.7 + (team === 'B' ? 0.9 : 0)) % 6.283, state: 'idle',
      },
      st: {
        oneShot: null, lock: 0, lie: false,
        lx: actor.rx, lz: actor.rz, spd: 0,
        face: actor.rf > 0 ? 0 : Math.PI,
        passLatched: false,
        tackleT: -1, tackleRole: null, tackleClipT: 0,
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
      case 'dive': return { name: 'SlideStart', loop: false };
      case 'try': case 'tryLoop': return { name: 'Slide', loop: true };
      case 'tryStart': return { name: 'SlideStart', loop: false };
      case 'getup': return { name: 'GetUp', loop: false };
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

  /* ============ PROCEDURAL LAYER — resolution and the three overrides ==== */

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
    if (import.meta.env.DEV && !rig.pelvis && !rig.spine.some(Boolean)) {
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
      inst.root.position.y = 0;
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
    inst.root.position.y = rise * RENDER_SCALE;
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
    const bones = [...rig.upperArms, ...rig.foreArms];
    for (const bone of bones) {
      if (!bone || !bone.parent) continue;
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
      bone.quaternion.slerp(wanted, p.reach * REACH_WEIGHT);
    }
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
       * dive and the fall are one continuous movement rather than a cut. */
      wantTilt = TILT_GROUNDED;
    }
    /* no procedural lift once the clip itself is putting him on the ground */
    this.applyBodyTilt(inst, wantTilt, step, !grounding);

    /* --- 2. the magnetic latch (tackler's arms onto the carrier) --- */
    if (latching && partner) {
      const prig = this.resolveRig(partner);
      const anchor = prig.spine[0] ?? prig.pelvis;
      if (anchor) {
        anchor.updateWorldMatrix(true, false);
        _target.setFromMatrixPosition(anchor.matrixWorld);
        this.applyArmReach(inst, _target, 1, step);
      }
    } else {
      this.applyArmReach(inst, null, 0, step);   // no target: decay only
    }

    /* --- 3. the struggle (carrier's spine) --- */
    this.applySpineThrash(inst, inst.st.spd, latched ? 1 : 0, step);
  }

  /* ------------------------------------------------------------- update -- */
  update(d: Director, _v: View, _cam: Camera, dt: number) {
    if (!this.ready) return;
    const s = RENDER_SCALE;
    const active = new Set<string>();
    const step = Math.min(dt, 0.05);
    /* every instance updated this frame, for the paired procedural pass */
    const pending: PlayerInstance[] = [];

    for (const a of d.actors) {
      const team: KitTeam = a.team === 'REF' ? 'REF' : a.team;
      const inst = this.getOrCreate(team, a.num, a);
      active.add(this.key(team, a.num));
      const st = inst.st;

      // velocity from the streamed positions
      const vx = (a.rx - st.lx) / Math.max(step, 1e-4);
      const vz = (a.rz - st.lz) / Math.max(step, 1e-4);
      st.lx = a.rx; st.lz = a.rz;
      st.spd = Math.hypot(vx, vz);

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
        inst.proc.state = desired;
        inst.root.position.set(a.rx * s, 0, -a.rz * s);
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
        st.tackleT = 0;
        st.tackleClipT = 0;
        st.oneShot = null;
      } else if (!tackleSide && st.tackleRole) {
        st.tackleRole = null; st.tackleT = -1;
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
          const act = this.play(inst, state, wantStage === 0 ? 0.05 : 0.12,
            this.fitTimeScale(state, win));
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
        inst.proc.state = wantStage === 0
          ? (st.tackleRole === 'CARRIER' ? 'hitReact' : 'tackleDrive')
          : wantStage === 1
            ? (st.tackleRole === 'CARRIER' ? 'carrierFall' : 'tackleGround')
            : (st.tackleRole === 'CARRIER' ? 'present' : 'rollAway');
        inst.root.position.set(a.rx * s, 0, -a.rz * s);
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
        this.play(inst, 'getup', 0.18, 1);
        st.oneShot = 'getup'; st.lock = 1.0; st.lie = false;
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
            this.play(inst, 'getup', 0.18, 1);
            st.oneShot = 'getup'; st.lock = 1.0; st.lie = false;
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
      inst.root.position.set(a.rx * s, 0, -a.rz * s);
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
      const partner = this.latchPartner(inst, pending);
      this.applyProcedural(inst, inst.proc.state, partner, step);
    }

    for (const [k, inst] of this.pool) {
      if (!active.has(k)) inst.root.visible = false;
    }

    this.updateBall(d, step);
  }

  private updateBall(d: Director, dt: number) {
    const s = RENDER_SCALE;
    const free = { x: 0, y: 0, z: 0, visible: false };
    let carrier: PlayerInstance | null = null;

    if (d.phase === 'SCRUM' || d.phase === 'REPLAY') {
      const sc = d.scrim!;
      if (sc && sc.ball.state !== 'HELD') {
        free.x = d.scrumAnchor.x + sc.ball.x; free.y = sc.ball.y + 0.06; free.z = d.scrumAnchor.z + sc.ball.z; free.visible = true;
      }
    } else if ((d.phase === 'LINEOUT' || d.phase === 'LINEOUT_REPLAY') && d.lo && d.lo.ball.state !== 'HELD') {
      free.x = d.lo.ball.x; free.y = d.lo.ball.y + 0.05; free.z = d.lo.ball.z; free.visible = true;
    } else if ((d.phase === 'KICK' || d.phase === 'KICK_REPLAY') && d.kk) {
      const k = d.kk;
      if (k.stage !== 'SETUP') { free.x = k.bx; free.y = k.by + 0.12; free.z = k.bz; free.visible = true; }
    } else if (d.phase === 'OPEN_PLAY' && d.op) {
      const o = d.op;
      if (o.ball.live) { free.x = o.ball.x; free.y = o.ball.y; free.z = o.ball.z; free.visible = true; }
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
      this.ball.position.set(free.x * s, free.y * s, -free.z * s);
      this.ball.rotation.z += dt * 6;
      this.ball.rotation.x += dt * 3;
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
