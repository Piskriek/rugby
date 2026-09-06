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
import type { Conditions } from './conditions';
import { conditionsFor, qualityFor } from './conditions';

/** Feature flag: 3D dual-plane pitch, fog and uprights. */
export const ENV_3D: boolean = true;

/** Render-path bisection switches, read once from the query string. */
export const DIAG = (() => {
  const q = typeof location !== 'undefined' ? location.search : '';
  return {
    nopost: /[?&]nopost\b/.test(q),
    noibl: /[?&]noibl\b/.test(q),
    basic: /[?&]basic\b/.test(q),
  };
})();

const FOG_COLOR = 0x1a2634;

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
  /** True between contextlost and contextrestored; drawing is a no-op then. */
  contextLost = false;

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
      console.warn('[render] WebGL context lost — pausing draw until restore');
    });
    el.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
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
    this.environment = new ThreeEnvironment(this.scene, this.renderer);
    this.matchDay = new ThreeMatchDay(this.scene);
    this.particles = new ThreeParticles(this.scene);

    /* ?basic — swap every lit material for an unlit one carrying the same
     * colour and map. If the frame comes back correct under this, the
     * geometry and the textures are fine and the fault is in the LIGHTING
     * (or the environment map feeding it); if it is still one flat colour,
     * the fault is downstream in the composer. One reload, one bit. */
    if (DIAG.basic) {
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        if (!src || !(src as THREE.Material).isMaterial) return;
        if (!(src instanceof THREE.MeshStandardMaterial)) return;
        m.material = new THREE.MeshBasicMaterial({
          color: src.color, map: src.map, transparent: src.transparent,
          opacity: src.opacity, side: src.side,
        });
      });
    }

    /* SIZE. `init()` runs immediately after the canvas is appended, BEFORE the
     * browser has laid it out, so clientWidth/clientHeight are still 0 and the
     * old `|| 2` fallback built the composer's target at 2x2 pixels. resize()
     * corrects it on the first frame, but a HalfFloat multisample target
     * allocated at 2x2 and then resized is the case drivers handle worst.
     * Fall back to the window, which is always the right order of magnitude. */
    const w = Math.max(2, this.dom.clientWidth || window.innerWidth || 1280);
    const h = Math.max(2, this.dom.clientHeight || window.innerHeight || 720);
    /* NO MSAA ON THIS TARGET.
     *
     * `samples: 4` asks for a multisampled half-float colour buffer at the
     * full device pixel ratio. It costs roughly 4x the memory of the plain
     * target (380 MB at DPR 2 when this was last measured), and on drivers
     * that will not allocate it the failure is NOT an exception — it is an
     * incomplete framebuffer that resolves to a single flat colour, which is
     * exactly the uniform brown frame this produced. The grade pass already
     * smooths edges, so the quality this bought was marginal even when it
     * worked. Guarded by scripts/renderverify. */
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.6, 0.8);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.grade.renderToScreen = true;
    this.composer.addPass(this.grade);
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
      /* PMREM binds its own render targets and allocates fresh ones on every
       * call. It restores the previously-bound target on the way out, but it
       * does NOT restore the viewport/scissor state the composer relies on,
       * and it is being run in the middle of the frame immediately before
       * composer.render(). Bake the environment, then hand the renderer back
       * to a known state explicitly rather than trusting the library to. */
      const env = DIAG.noibl ? null : this.matchDay.refreshEnvironment(this.renderer, cond);
      this.renderer.setRenderTarget(null);
      this.renderer.setViewport(0, 0, this.dom.clientWidth || v.w, this.dom.clientHeight || v.h);
      this.renderer.setScissorTest(false);
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

  render() {
    /* A lost context (driver reset, GPU OOM, a laptop changing graphics card)
     * otherwise leaves a permanently black canvas with no clue why. */
    if (this.contextLost) return;
    this.frame++;
    /* The shadow map is the single most expensive thing in this scene — 31
     * skinned meshes drawn again from the key's point of view. Half rate is
     * invisible: a sprinter advances 0.16 m per frame, and the shadow box is
     * 42 m wide, so the error is well under a texel. */
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.needsUpdate = this.frame % this.shadowEvery === 0;
    }
    /* RENDER-PATH BISECTION SWITCHES.
     *
     * The blank-frame bug could not be reproduced headlessly (no GPU in the
     * build sandbox) and every component checked out in isolation, so these
     * exist to isolate it in ONE reload instead of a guess per round trip:
     *
     *   ?nopost   bypass the EffectComposer entirely, draw straight to screen
     *   ?noibl    drop the PMREM environment map off every PBR material
     *   ?basic    replace every material with a flat unlit one
     *
     * They are query-string only and cost nothing when absent. */
    if (this.composer && ENV_3D && !DIAG.nopost) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Resolve the option bag into conditions and apply them if they changed. */
  syncConditions(options: Record<string, number>) {
    const c = conditionsFor(options, qualityFor(options));
    if (c !== this.cond) this.applyConditions(c);
    return c;
  }

  dispose() {
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
