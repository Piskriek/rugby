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

const MODEL_URL = 'assets/models/rugby_player.glb';

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

/* -------------------------------------------------------------- instance -- */
interface PlayerInstance {
  actor: Actor;
  team: KitTeam;
  num: number;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  badgeMat: THREE.MeshBasicMaterial;
  active: { name: string; action: THREE.AnimationAction } | null;
  st: {
    oneShot: string | null;      // non-looping/locked clip state
    lock: number;                // seconds left to hold the one-shot
    lie: boolean;                // grounded until an engine 'getup'/motion
    lx: number; lz: number;
    spd: number;
    face: number;                // smoothed heading, radians
  };
}

/* ================================================================== */
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
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(MODEL_URL, (gltf) => {
        this.template = gltf.scene;
        this.templateClips = gltf.animations;
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

    const inst: PlayerInstance = {
      actor, team, num, root, mixer, clips, badgeMat,
      active: null,
      st: {
        oneShot: null, lock: 0, lie: false,
        lx: actor.rx, lz: actor.rz, spd: 0,
        face: actor.rf > 0 ? 0 : Math.PI,
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
      case 'grounded': return { name: 'Death', loop: true };
      case 'dive': return { name: 'SlideStart', loop: false };
      case 'try': case 'tryLoop': return { name: 'Slide', loop: true };
      case 'tryStart': return { name: 'SlideStart', loop: false };
      case 'getup': return { name: 'GetUp', loop: false };
      default: return { name: 'Idle', loop: true };
    }
  }

  /** Crossfade to a clip. Returns the action (already playing). */
  private play(
    inst: PlayerInstance, stateName: string, fade: number, timeScale = 1,
  ): THREE.AnimationAction | null {
    const info = this.clipForState(stateName);
    const clip = inst.clips.get(info.name);
    if (!clip) return null;
    const action = inst.mixer.clipAction(clip);
    action.setLoop(info.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !info.loop;
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

  /* ------------------------------------------------------------- update -- */
  update(d: Director, _v: View, _cam: Camera, dt: number) {
    if (!this.ready) return;
    const s = RENDER_SCALE;
    const active = new Set<string>();
    const step = Math.min(dt, 0.05);

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
      if (d.phase === 'SCRUM' && team !== 'REF') {
        // A pushes toward +Z pitch (theta 0), B toward -Z (theta pi).
        const want = a.team === 'A' ? 0 : Math.PI;
        let dy = want - st.face;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        st.face += dy * (1 - Math.exp(-step * 14));
      }

      const desired = this.mapState(a.renderClip, st.spd);
      const locomoting = ['idle', 'walk', 'run', 'sprint'].includes(desired);

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
      } else if (desired === 'pass' && st.oneShot !== 'pass') {
        this.play(inst, 'pass', 0.1, 1.1);
        st.oneShot = 'pass'; st.lock = 0.45;
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
      inst.root.position.set(a.rx * s, 0, -a.rz * s);
      // The rig faces +Z at rest; forward heading theta maps to rotation.y.
      inst.root.rotation.y = Math.PI - st.face;

      inst.mixer.update(step);
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
      // Attach to the forearm/hand socket bone; its transform then drives the
      // ball through the carry. Parent root already carries RENDER_SCALE.
      const hand = this.findBone(carrier.root, 'hand_r') ?? this.findBone(carrier.root, 'hand_l');
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
