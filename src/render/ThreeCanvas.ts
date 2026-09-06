/**
 * ThreeCanvas — the WebGL viewport, the colour pipeline and the match-day rig.
 *
 * A single Three.js renderer/camera rig. The camera is NOT a free 3D camera:
 * every frame it is rebuilt to match the 2D pinhole rig in `render/retro.ts`
 * (position, look direction, vertical FOV, and the off-centre horizon via a
 * custom projection matrix), so 3D actors and the 3D pitch land on the exact
 * screen positions the legacy 2D markings used to paint.
 *
 * When `ENV_3D` is set, this layer owns the stadium environment (dual-plane
 * pitch, fog, World Rugby uprights) as well as the GLB actors; the 2D canvas
 * is a transparent HUD overlay on top. When unset, this canvas stays
 * transparent and only paints 3D actors over the 2D pitch.
 *
 * ## The colour pipeline (AAA pass)
 *
 * The scene renders into a half-float target and leaves through one custom
 * grade pass. Deliberately, `renderer.toneMapping` is `NoToneMapping`: inside
 * an EffectComposer the renderer skips tone mapping anyway (it is applied only
 * when drawing to the canvas), and leaving it to `OutputPass` would apply it
 * AFTER bloom had already clipped. Owning the curve in one shader means the
 * exposure, the filmic shoulder, the sRGB encode, the vignette, the grain, the
 * chroma split and the rain on the lens are one decision, in one order, and
 * the bloom threshold can be authored in true HDR against it.
 *
 * It is also the reason `LEGACY` quality still goes through the composer: one
 * pipeline, switched off by parameters, rather than two pipelines that drift.
 *
 * World convention: everything 3D is rendered in the game's *scaled* render
 * space (logical metres * RENDER_SCALE):
 *   world = (x · RENDER_SCALE, y · RENDER_SCALE, −z · RENDER_SCALE)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Camera, View, RENDER_SCALE } from './retro';
import { ThreeEnvironment } from './ThreeEnvironment';
import { ThreeMatchDay } from './ThreeMatchDay';
import { ThreeParticles } from './ThreeParticles';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { RapierWorld } from '../core/physics/RapierWorld';
import { attachImpactAudio, type MatchAudio } from '../game/audio';
import type { RapierDebugRenderer } from './RapierDebugRenderer';
import type { Conditions } from './conditions';
import { conditionsFor, qualityFor } from './conditions';

/** The tiny slice of a TABS player the debug playground needs. */
interface DebugRagdoll {
  bodies: RigidBody[];
}

/** Feature flag: 3D dual-plane pitch, fog and uprights. */
export const ENV_3D: boolean = true;

const FOG_COLOR = 0x1a2634;

/* ---------------------------------------------------------------- health --- */
/**
 * What the 3D layer has actually managed to build and draw, as the rest of the
 * presentation tree can see it.
 *
 * This exists because of one specific, embarrassing failure. The GLB squad, the
 * procedural turf and the post chain are each OPTIONAL at runtime — the asset can
 * 404 behind a proxy, a driver can refuse a float framebuffer format, a GPU reset
 * can take the context — but until now every one of those failures was swallowed
 * by a `catch` whose only output was a console line nobody opens. On screen that
 * is a featureless void: no pitch, no players, no explanation, while every
 * headless harness in the repository stays green, because a module transform and
 * a scene-graph computation do not need a working GL context to pass.
 *
 * So each swallow here records itself in this object; the 2D layer reads it to
 * decide whether to paint its own stadium instead of trusting the 3D one; and the
 * HUD prints the reason in the frame. Presentation state, never engine state —
 * the simulation does not know, and must never care, whether it is being seen.
 */
export const renderHealth = {
  /** 'dead' = the 3D layer has no world to show: the 2D stadium takes over. */
  world: 'booting' as 'booting' | 'live' | 'dead',
  /** bodies: 'standin' means the GLB rig never loaded and boxes are on screen. */
  bodies: 'pending' as 'pending' | 'glb' | 'standin',
  /** 'direct' = the post chain failed and the scene is drawn without it. */
  pipeline: 'post' as 'post' | 'direct',
  context: 'ok' as 'ok' | 'lost',
  /** how many exceptions the render layer has swallowed this session. */
  faults: 0,
  /** the last few, newest first, already prefixed with what they broke. */
  log: [] as string[],
};

/**
 * Record a swallowed presentation fault. Called from the catches that used to be
 * silent. The list is capped because a per-frame fault that is not fatal (a bad
 * pass, say) would otherwise grow forever, and the point of the log is the first
 * few reasons, not their count.
 */
export function noteRenderFault(where: string, e: unknown): void {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const line = `${where} — ${msg}`;
  renderHealth.faults++;
  if (!renderHealth.log.includes(line)) renderHealth.log.unshift(line);
  if (renderHealth.log.length > 6) renderHealth.log.length = 6;
  console.error(`[render] ${line}`);
}

/* ------------------------------------------------------------- grade pass --- */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1.0 },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.03 },
    uChroma: { value: 0.0015 },
    uTime: { value: 0 },
    uLift: { value: new THREE.Vector3(0.006, 0.004, 0.012) },
    uGain: { value: new THREE.Vector3(1.02, 1.0, 1.0) },
    uSat: { value: 1.06 },
    uLensWet: { value: 0 },
    uDropletSeed: { value: 0 },
    uAspect: { value: 1.6 },
    uShoulder: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uExposure, uVignette, uGrain, uChroma, uTime, uSat;
    uniform float uLensWet, uDropletSeed, uAspect, uShoulder;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    /* Extended Reinhard with a shoulder at L=4. Chosen over a Hable-style
     * curve because its behaviour is legible: it is the identity below ~0.3,
     * it maps 2.0 to a white kit rather than a clipping sheet, and it never
     * goes negative — which matters because the target is half-float and a
     * curve with an unclipped denominator turns a specular pin-point into NaN.
     * uShoulder mixes back toward the plain curve for LEGACY, where the
     * brief is "same picture as the 2D canvas", not "same picture after film". */
    vec3 filmic(vec3 x) {
      x = max(x * uExposure, vec3(0.0));
      const float L = 4.0;
      vec3 c = (x * (1.0 + x / (L * L))) / (1.0 + x);
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      /* Mild S-curve so the grade does not read as a wash. */
      vec3 s = c * (1.02 + 0.06 * c);
      c = mix(max(vec3(0.0), x), s, clamp(uShoulder, 0.0, 1.0));
      return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 1.03)) * (1.0 + luma * 0.0);
    }

    vec3 toSRGB(vec3 c) {
      c = clamp(c, 0.0, 1.0);
      return mix(c * 12.92, pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055,
                 step(vec3(0.0031308), c));
    }

    /* A raindrop on the lens: a cell of the frame that samples a compressed,
     * inverted patch of the image, with a bright rim. Cheaper and far more
     * convincing than a screen-space refraction pass. */
    vec2 droplets(vec2 uv, float t, float strength) {
      float grid = 26.0;
      vec2 g = uv * vec2(grid * uAspect, grid);
      vec2 cell = floor(g);
      vec2 f = fract(g) - 0.5;
      float h = hash21(cell + vec2(t * 0.0, floor(t * 0.6)));
      float on = step(1.0 - strength * 0.30, h);
      /* Drops slide down the glass when there are enough of them. */
      float slide = strength > 0.55 ? fract(t * 0.22 + h) * 0.35 : 0.0;
      f.y -= slide;
      float r = length(f);
      float drop = on * (1.0 - smoothstep(0.12, 0.36, r));
      float lens = -drop * 0.16;
      vec2 off = normalize(f + vec2(1e-4)) * lens;
      float rim = on * smoothstep(0.30, 0.36, r) * (1.0 - smoothstep(0.36, 0.42, r));
      return vec2(off.x * 0.006, off.y * 0.006) + vec2(0.0, rim * 0.0);
    }

    void main() {
      vec2 uv = vUv;
      float wet = uLensWet;
      vec2 disp = vec2(0.0);
      if (wet > 0.001) disp = droplets(uv, uTime + uDropletSeed, wet);

      /* Chromatic split grows toward the frame edge, as it does in a real
       * broadcast lens at 400 mm. */
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      float ca = uChroma * (0.35 + r2 * 2.6);
      vec2 baseUv = uv + disp;
      float blur = wet * 0.0035 * smoothstep(0.02, 0.35, r2);

      vec3 col;
      col.r = texture2D(tDiffuse, baseUv + c * ca + vec2(blur)).r;
      col.g = texture2D(tDiffuse, baseUv - vec2(blur * 0.4)).g;
      col.b = texture2D(tDiffuse, baseUv - c * ca - vec2(blur)).b;

      /* Water left on the glass smears a little highlight. */
      col += wet * 0.05 * smoothstep(0.55, 1.0, 1.0 - abs(c.y) * 1.6);

      col *= uGain;
      col = filmic(max(col, vec3(0.0)));
      col += uLift * (1.0 - smoothstep(0.0, 0.55, max(col.r, max(col.g, col.b))));

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSat);

      /* Vignette: an oval, so it does not crush the corners of a 16:9 frame
       * into a porthole. */
      float vig = 1.0 - uVignette * smoothstep(0.22, 0.78, r2 * 1.35 + pow(abs(c.x) * 0.55, 2.4));
      col *= vig;

      col = toSRGB(col);

      /* Grain in display space, luminance-weighted: shadows and midtones get
       * the noise, highlights stay clean, which is what film grain actually
       * looks like on a fast stock. */
      float g = hash21(gl_FragCoord.xy + vec2(uTime * 37.13, uTime * 19.7));
      float w = 1.0 - smoothstep(0.25, 0.95, luma);
      col += (g - 0.5) * uGrain * (0.35 + w);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};


export class ThreeCanvas {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene: THREE.Scene;
  readonly dom: HTMLCanvasElement;
  environment: ThreeEnvironment | null = null;
  matchDay: ThreeMatchDay | null = null;
  particles: ThreeParticles | null = null;
  /** Live wireframe overlay for the in-browser Rapier debug playground. */
  rapierDebug: RapierDebugRenderer | null = null;
  /** True between contextlost and contextrestored; drawing is a no-op then. */
  contextLost = false;

  /* The dev-only physics playground that drives `rapierDebug`. It is separate
   * from the match engine (which is not yet Rapier-backed): a couple of TABS
   * ragdolls collide head-on in the same coordinate space so the wireframes
   * can be eyeballed against the pitch, GLB bodies and ball. */
  private rapierWorld: RapierWorld | null = null;
  private rapierDebugPlayers: DebugRagdoll[] = [];
  private rapierDebugInitial: { x: number; y: number; z: number }[][] = [];
  private rapierDebugVelocities: { x: number; z: number }[] = [];
  private rapierDebugBall: RigidBody | null = null;
  private rapierDebugAccumulator = 0;
  private rapierDebugDeadline = 0;
  private rapierDebugCancelled = false;
  /* TARCS — the audio engine the physics world reports its impacts to, and the
   * live subscription. The audio may be attached before OR after the async
   * Rapier bootstrap resolves, so both paths call `wireImpactAudio`. */
  private impactAudio: MatchAudio | null = null;
  private impactAudioDetach: (() => void) | null = null;

  private view: View = { w: 1, h: 1 };
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private frame = 0;
  private cond: Conditions | null = null;
  /** Set when the shadow map last updated; shadows run at half rate. */
  private shadowEvery = 2;
  /**
   * The environment map is rebuilt from the sky dome on the frame AFTER a
   * conditions change, not during it: the dome's own colours are written by
   * `update()`, and sampling it before that would filter last match's sky.
   */
  private envStale = true;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: !ENV_3D, antialias: true, premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(FOG_COLOR, ENV_3D ? 1 : 0);
    /* Shadows are enabled here and turned on per-tier by `applyConditions`;
     * `autoUpdate` is off so the rig can pay for them every other frame. */
    this.renderer.shadowMap.enabled = ENV_3D;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const el = this.renderer.domElement;
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.pointerEvents = 'none';
    el.style.zIndex = ENV_3D ? '0' : '1';
    container.appendChild(el);
    this.dom = el;

    /* A lost context (driver reset, GPU OOM, laptop switching graphics)
     * otherwise leaves a permanently black canvas with no clue why.
     * Preventing the default event lets the browser hand the context back,
     * and Three re-uploads its resources automatically on restore. */
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      renderHealth.context = 'lost';
      console.warn('[render] WebGL context lost — pausing draw until restore');
      /* `preventDefault()` says we intend to carry on without the old buffers,
       * but the browser is under no obligation to hand a context back on its
       * own, and a lost-and-never-restored canvas is exactly the permanent blank
       * frame that reads as "there is no game". Asking the lose-context
       * extension for a fresh one is the documented way to get it: ask twice,
       * then stop. If it never comes back, `renderHealth.world` still says the
       * truth and the 2D layer paints the match instead. */
      for (let i = 0; i < 2; i++) {
        setTimeout(() => {
          if (!this.contextLost) return;
          try {
            const ext = this.renderer.getContext()
              ?.getExtension('WEBGL_lose_context') as { restoreContext?(): void } | null;
            ext?.restoreContext?.();
          } catch { /* nothing to restore from */ }
        }, 400 + i * 1500);
      }
    });
    el.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      renderHealth.context = 'ok';
      /* The composer's targets and the renderer's drawing buffer live on the old
       * context, so the first frame back needs a fresh size before it draws. */
      try { this.resize(); } catch { /* next frame will */ }
      console.warn('[render] WebGL context restored');
    });

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
    this.camera.frustumCulled = true;
    this.scene = new THREE.Scene();

    this.init();
  }

  /** Build the 3D environment (pitch, fog, uprights) when the flag is on. */
  init() {
    if (!ENV_3D) return;
    /* Each stage is tried separately, and a stage that throws degrades that one
     * thing rather than aborting the boot. Before this, an exception inside the
     * turf or the render targets left the whole constructor mid-flight: the
     * caller's `await` chain never finished, and the frame either froze on a
     * loading screen or drew nothing at all with no reason attached to it. A
     * half-built world still shows a match, and `renderHealth` says what is
     * missing so the 2D layer and the HUD can cover for it. */
    try {
      this.environment = new ThreeEnvironment(this.scene, this.renderer);
    } catch (e) {
      noteRenderFault('turf + stadium', e);
      this.environment = null;
    }
    try {
      this.matchDay = new ThreeMatchDay(this.scene);
    } catch (e) {
      noteRenderFault('match-day lighting', e);
      this.matchDay = null;
    }
    try {
      this.particles = new ThreeParticles(this.scene);
    } catch (e) {
      noteRenderFault('particle pool', e);
      this.particles = null;
    }

    const w = Math.max(2, this.dom.clientWidth || 2);
    const h = Math.max(2, this.dom.clientHeight || 2);
    try {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        samples: 4,
        colorSpace: THREE.LinearSRGBColorSpace,
      });
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.6, 0.8);
      this.composer.addPass(this.bloom);
      this.grade = new ShaderPass(GradeShader);
      this.grade.renderToScreen = true;
      this.composer.addPass(this.grade);
    } catch (e) {
      /* No post chain is a worse picture, not a broken one: `render()` draws the
       * scene straight to the canvas. Half-float MSAA targets in particular are
       * not a guaranteed combination on every driver. */
      noteRenderFault('post chain', e);
      this.composer = null;
      this.bloom = null;
      this.grade = null;
      renderHealth.pipeline = 'direct';
    }
    renderHealth.world = this.environment ? 'live' : 'dead';

    /* Rapier debug playground — dev builds only. It loads Rapier's WASM as a
     * side effect, so it stays out of the production bundle path. */
    if (import.meta.env.DEV) this.bootstrapRapierDebug();
  }

  /**
   * Push one conditions object into every consumer of the look. Called when the
   * resolved conditions change, not every frame — the tone curve and the shadow
   * tier are renderer state and touching them per frame costs a shader recompile
   * for the bloom pass.
   */
  applyConditions(cond: Conditions) {
    this.cond = cond;
    this.envStale = true;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = ENV_3D && cond.shadows;
    this.shadowEvery = cond.quality === 'FULL' ? 2 : 1;
    if (this.matchDay) {
      this.matchDay.applyQuality(cond);
      if (this.bloom) {
        /* LEGACY is the flat frame on purpose: no halo, no bleed, no light
         * spilling off the LED boards. The pass still runs (one pipeline, not
         * two) but with its contribution switched to zero. */
        this.bloom.strength = cond.quality === 'LEGACY' ? 0 : cond.bloomStrength;
        this.bloom.threshold = cond.bloomThreshold;
        this.bloom.radius = cond.bloomRadius;
      }
    }
    const g = this.grade?.uniforms as Record<string, { value: any }> | undefined;
    if (g) {
      g.uExposure.value = cond.exposure;
      g.uVignette.value = cond.vignette;
      g.uGrain.value = cond.grain;
      g.uChroma.value = cond.chroma;
      g.uLensWet.value = cond.precip === 'RAIN' ? cond.lensWet : 0;
      g.uSat.value = cond.weather === 'OVERCAST' || cond.weather === 'FOG' ? 0.9 : 1.08;
      g.uShoulder.value = cond.quality === 'LEGACY' ? 0.35 : 1.0;
      g.uLift.value.set(cond.gradeLift[0], cond.gradeLift[1], cond.gradeLift[2]);
      g.uGain.value.set(cond.gradeGain[0], cond.gradeGain[1], cond.gradeGain[2]);
    }
    this.environment?.applyConditions(cond);
  }

  /**
   * Per-frame match-day update: sky, lights, weather, and the FX pool.
   * Kept on the canvas rather than in the view so the shadow frustum, the
   * bloom and the camera are re-derived in one place, in the order that matters.
   */
  updateMatchDay(cam: Camera, v: View, dt: number) {
    if (!this.matchDay || !this.cond) return;
    const cond = this.cond;
    this.matchDay.update(cam, v, cond, dt);
    if (this.envStale) {
      this.envStale = false;
      const env = this.matchDay.refreshEnvironment(this.renderer, cond);
      this.scene.environment = env;
      /* One number drives the whole indirect term, and it is the number the
       * flat fills used to fake: an overcast sky is a softbox, a clear noon is
       * not, and a black jersey only reads as cloth if something is reflecting
       * off it. */
      this.scene.environmentIntensity = env ? cond.iblIntensity : 1;
    }
    /* The lens that matters is the 2D pinhole's own vertical FOV in radians —
     * `this.camera.fov` is a stale 35 DEGREES, because syncCamera overwrites
     * the projection matrix from the retro rig. Feeding the wrong one here is
     * how a clod becomes a boulder at TACTICAL zoom. */
    this.particles?.setPixelScale(v.h, cam.fov);
    this.particles?.setFog(cond.fogColor, cond.fogDensity * 14);
    const g = this.grade?.uniforms as Record<string, { value: any }> | undefined;
    if (g) g.uTime.value += dt;
    if (g) g.uAspect.value = v.w / Math.max(1, v.h);
  }


  /* ----------------------- Rapier debug playground ----------------------- */

  /**
   * Boot the dev-only Rapier world that the wireframe renderer reads. This is
   * deliberately NOT the match engine's simulation — live gameplay is still
   * driven by `Director`. It exists purely so a developer can run `npm run dev`
   * and watch real TABS ragdoll colliders move in the same Three space as the
   * pitch, GLB players and ball.
   */
  private async bootstrapRapierDebug(): Promise<void> {
    try {
      /* Dynamic import keeps the ~rapier3d-compat WASM bundle out of the main
       * app chunk: production never calls this, and dev pops it in behind a
       * microtask after the WebGL scene is already up. */
      const [{ RapierWorld }, { RapierDebugRenderer }] = await Promise.all([
        import('../core/physics/RapierWorld'),
        import('./RapierDebugRenderer'),
      ]);
      const world = await RapierWorld.create();
      if (this.rapierDebugCancelled) {
        world.dispose();
        return;
      }
      world.addPitch({ hx: 50, hy: 0.5, hz: 30, x: 0, y: -0.5, z: 0 });

      const players = [
        world.addTabsPlayer({ x: 0, y: 0, z: -4, vx: 0, vz: 6 }),
        world.addTabsPlayer({ x: 0, y: 0, z: 4, vx: 0, vz: -6 }),
      ];
      const ball = world.addBall({ radius: 0.15, x: 0, y: 0.7, z: -2 });
      ball.setLinvel({ x: 0, y: 0.8, z: 0 }, true);

      this.rapierWorld = world;
      this.wireImpactAudio();
      this.rapierDebugPlayers = players;
      this.rapierDebugInitial = players.map((p) =>
        p.bodies.map((body) => {
          const t = body.translation();
          return { x: t.x, y: t.y, z: t.z };
        }));
      this.rapierDebugVelocities = [{ x: 0, z: 6 }, { x: 0, z: -6 }];
      this.rapierDebugBall = ball;
      this.rapierDebug = new RapierDebugRenderer(this.scene, world.world, {
        scale: RENDER_SCALE,
      });
      this.resetRapierDebugDemo();
    } catch (e) {
      /* A missing WASM/browser WebAssembly build must not take the match view
       * down; the debug overlay is optional and the 2D/3D game still runs. */
      if (!this.rapierDebugCancelled) noteRenderFault('Rapier debug playground', e);
      this.rapierDebug = null;
      this.rapierWorld = null;
    }
  }

  /** Reset the playground ragdolls and ball to their opening tackle pose. */
  private resetRapierDebugDemo(): void {
    this.rapierDebugDeadline = 5;
    for (let pi = 0; pi < this.rapierDebugPlayers.length; pi++) {
      const player = this.rapierDebugPlayers[pi];
      const initial = this.rapierDebugInitial[pi];
      const velocity = this.rapierDebugVelocities[pi];
      for (let bi = 0; bi < player.bodies.length; bi++) {
        const body = player.bodies[bi];
        const pos = initial[bi];
        body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        body.setLinvel({ x: velocity.x, y: 0, z: velocity.z }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    this.rapierDebugBall?.setTranslation({ x: 0, y: 0.7, z: -2 }, true);
    this.rapierDebugBall?.setLinvel({ x: 0, y: 0.8, z: 0 }, true);
    this.rapierDebugBall?.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Step the debug world at fixed 60 Hz and refresh the wireframe buffers. */
  private updateRapierDebug(dt: number): void {
    if (!this.rapierWorld || !this.rapierDebug) return;
    const FIXED_DT = 1 / 60;
    this.rapierDebugAccumulator = Math.min(0.25, this.rapierDebugAccumulator + dt);
    this.rapierDebugDeadline -= dt;
    if (this.rapierDebugDeadline <= 0) this.resetRapierDebugDemo();
    while (this.rapierDebugAccumulator >= FIXED_DT) {
      this.rapierWorld.step(FIXED_DT);
      this.rapierDebugAccumulator -= FIXED_DT;
    }
    this.rapierDebug.sync();
  }

  /**
   * Match the 2D pinhole rig. Mirrors `project()` in retro.ts:
   *
   *   focal  = (h/2) / tan(fov/2)
   *   depth  = fwd·cos(tilt) − (wy − camH)·sin(tilt)
   *   right  = dx·cos(yaw) − dz·sin(yaw)
   *   up     = (wy − camH)·cos(tilt) + fwd·sin(tilt)
   *
   * The 2D lens is an off-centre pinhole (its principal point sits at
   * `horizon*h`, not h/2). That is reproduced with a custom frustum so
   * pitch markings and players therefore cannot parallax apart.
   */
  syncCamera(cam: Camera, v: View, shakeX = 0, shakeY = 0) {
    this.view = v;
    const s = RENDER_SCALE;
    // Pitch logical z runs "down-field AWAY from the cable camera", i.e. toward
    // three-space -Z (the renderer maps mesh z = -pitchZ). The camera rig sits
    // at logical (x, z) so its three-space position is (x, h, -z).
    const camPos = new THREE.Vector3(cam.x * s, cam.h * s, -cam.z * s);

    // 2D ground-forward is (sin yaw, cos yaw) in pitch (x, z); in three space
    // that is (sin yaw, 0, -cos yaw). Then tilt DOWN to aim at the turf.
    const yaw = cam.yaw, tilt = cam.tilt;
    const fHorz = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const down = new THREE.Vector3(0, -1, 0);
    const lookDir = fHorz.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(down, Math.sin(tilt));

    // Screen-up: world-up rotated FORWARD by the tilt so it is perpendicular to
    // lookDir (the lens tilt axis). With pitch z mapped to three -z the
    // ground-forward's z component is -cos yaw, hence the sign on z.
    const upVec = new THREE.Vector3(
      Math.sin(yaw) * Math.sin(tilt),
      Math.cos(tilt),
      -Math.cos(yaw) * Math.sin(tilt),
    );

    this.camera.position.copy(camPos);
    this.camera.up.copy(upVec);
    this.camera.lookAt(camPos.clone().add(lookDir));

    // Off-axis projection that EXACTLY reproduces the 2D pinhole intrinsics
    // (focal length f and the off-centre principal point at (w/2, horizon*h)).
    const near = 0.15 * s;
    const far = 320 * s;
    const focal = v.h * 0.5 / Math.tan(cam.fov * 0.5);
    const left = near * (-v.w * 0.5 - shakeX) / focal;
    const right = near * (v.w * 0.5 - shakeX) / focal;
    const top = near * (cam.horizon * v.h + shakeY) / focal;
    const bottom = near * ((cam.horizon - 1) * v.h + shakeY) / focal;
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix(); // keep defaults sane
    this.camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld(true);
  }

  resize() {
    const w = this.dom.clientWidth || this.view.w;
    const h = this.dom.clientHeight || this.view.h;
    /* 1.75 rather than 2: the WebGL cost (and every post-processing target)
     * scales with the square of this number, and the difference between 1.75x
     * and 2x is invisible at normal viewing distance while costing ~30% more
     * fill. The 2D HUD canvas is separate and still runs at full DPR. */
    const pr = Math.min(1.75, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      /* UnrealBloomPass carries its own resolution vector; if it is not told,
       * the blur is computed for the old frame size and the halo stops
       * matching the lamps it came from. */
      this.bloom?.setSize(w * pr, h * pr);
    }
    return { w, h };
  }

  render(dt = 1 / 60) {
    /* A lost context (driver reset, GPU OOM, a laptop changing graphics card)
     * otherwise leaves a permanently black canvas with no clue why. */
    if (this.contextLost) return;
    this.frame++;
    /* The Rapier wireframes must reflect the physics world after the latest
     * step, so the debug world advances before the scene is drawn. */
    this.updateRapierDebug(dt);
    /* The shadow map is the single most expensive thing in this scene — 31
     * skinned meshes drawn again from the key's point of view. Half rate is
     * invisible: a sprinter advances 0.16 m per frame, and the shadow box is
     * 42 m wide, so the error is well under a texel. */
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.needsUpdate = this.frame % this.shadowEvery === 0;
    }
    /* The post chain goes first and the plain draw is its catch: a pass that
     * throws (a target the driver refused to allocate, a shader the driver
     * refused to link) used to escape into the frame loop and take the match's
     * picture with it, because a throw anywhere in the loop also skips every
     * line after it. Falling back for the frame, once and permanently, keeps the
     * game on screen at the cost of the grade and the bloom. */
    if (this.composer && ENV_3D) {
      try {
        this.composer.render();
        return;
      } catch (e) {
        noteRenderFault('post chain at draw', e);
        try { this.composer.dispose(); } catch { /* already broken */ }
        this.composer = null;
        renderHealth.pipeline = 'direct';
      }
    }
    try {
      this.renderer.render(this.scene, this.camera);
      this.drawFailures = 0;
    } catch (e) {
      /* Two consecutive total failures and the 3D layer stands down: the 2D
       * stadium knows how to draw this match without any of it. */
      noteRenderFault('scene draw', e);
      if (++this.drawFailures > 1) renderHealth.world = 'dead';
    }
  }

  private drawFailures = 0;

  /** Resolve the option bag into conditions and apply them if they changed. */
  syncConditions(options: Record<string, number>) {
    const c = conditionsFor(options, qualityFor(options));
    if (c !== this.cond) this.applyConditions(c);
    return c;
  }

  /**
   * TARCS — give the physics world an audio engine to shout at.
   *
   * Ordering is not the caller's problem: the Rapier world boots behind an
   * async dynamic import, so this may land first (the subscription is deferred
   * until the world exists) or last (it subscribes immediately). Passing null
   * detaches.
   */
  attachMatchAudio(audio: MatchAudio | null): void {
    if (this.impactAudio === audio) return;
    this.impactAudioDetach?.();
    this.impactAudioDetach = null;
    this.impactAudio = audio;
    this.wireImpactAudio();
  }

  private wireImpactAudio(): void {
    if (this.impactAudioDetach || !this.rapierWorld || !this.impactAudio) return;
    this.impactAudioDetach = attachImpactAudio(this.rapierWorld, this.impactAudio);
  }

  dispose() {
    this.rapierDebugCancelled = true;
    this.impactAudioDetach?.();
    this.impactAudioDetach = null;
    this.impactAudio = null;
    this.rapierDebug?.dispose();
    this.rapierDebug = null;
    this.rapierWorld?.dispose();
    this.rapierWorld = null;
    this.environment?.dispose();
    this.environment = null;
    this.matchDay?.dispose();
    this.matchDay = null;
    this.particles?.dispose();
    this.particles = null;
    this.bloom?.dispose();
    this.grade?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderer.dispose();
    this.dom.remove();
  }
}
