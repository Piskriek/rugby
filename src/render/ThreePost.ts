/**
 * ThreePost — the post-processing chain.
 *
 * RenderPass → [Bloom] → [SSAO] → OutputPass(tone map + sRGB) → [FXAA]
 *
 * Every optional stage can be turned off at runtime by the GRAPHICS option
 * without rebuilding the composer: passes stay in the chain but have their
 * `enabled` flag cleared, which costs nothing and avoids reallocating render
 * targets mid-match (a stall the player would see as a freeze).
 *
 * `OutputPass` is what applies tone mapping and the sRGB conversion, so the
 * renderer itself must NOT also do it — `ThreeCanvas` therefore leaves
 * `outputColorSpace` linear while the composer is active. Getting this wrong
 * double-corrects and produces the washed-out, milky look.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';

/** 0 = off (direct render), 1 = balanced, 2 = full. */
export type QualityLevel = 0 | 1 | 2;

export class ThreePost {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ssao: SSAOPass;
  private fxaa: ShaderPass;
  private renderer: THREE.WebGLRenderer;
  private level: QualityLevel = 2;
  private w = 1;
  private h = 1;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    w: number,
    h: number,
  ) {
    this.renderer = renderer;
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);

    // HalfFloat keeps highlight headroom for the bloom threshold to bite into;
    // an 8-bit target clips the floodlights to white before bloom ever sees
    // them and the glow disappears.
    const target = new THREE.WebGLRenderTarget(this.w, this.h, {
      type: THREE.HalfFloatType,
      samples: 4,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(this.w, this.h);

    this.composer.addPass(new RenderPass(scene, camera));

    this.ssao = new SSAOPass(scene, camera, this.w, this.h);
    this.ssao.kernelRadius = 6;
    this.ssao.minDistance = 0.0015;
    this.ssao.maxDistance = 0.06;
    this.ssao.output = SSAOPass.OUTPUT.Default;
    this.composer.addPass(this.ssao);

    // Threshold well above mid-grey: only the lamps, the sun disc and white
    // kit in direct sun should bloom. Anything lower and the turf glows.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w, this.h), 0.34, 0.62, 0.86);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);

    this.setQuality(2);
    this.setSize(this.w, this.h);
  }

  setQuality(level: QualityLevel): void {
    this.level = level;
    this.bloom.enabled = level >= 1;
    this.ssao.enabled = level >= 2;
    // MSAA in the composer target already resolves most edges; FXAA is a
    // cheap top-up that mainly helps the thin goal posts and LED board edges.
    this.fxaa.enabled = level >= 1;
    this.bloom.strength = level >= 2 ? 0.34 : 0.22;
  }

  get active(): boolean {
    return this.level > 0;
  }

  setSize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(this.w, this.h);
    this.bloom.setSize(this.w, this.h);
    this.ssao.setSize(this.w, this.h);
    const res = (this.fxaa.material.uniforms as Record<string, { value: THREE.Vector2 }>).resolution;
    res.value.set(1 / (this.w * pr), 1 / (this.h * pr));
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
