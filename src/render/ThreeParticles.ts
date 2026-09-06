/**
 * ThreeParticles — the one FX pool the match needs.
 *
 * A rugby pitch is not on fire; what leaves it is turf, spray, mud, steam and
 * (on the good days) confetti. So this is a single pooled `Points` system with
 * one draw call and eight behaviours selected by a per-particle `kind` byte —
 * not eight particle systems.
 *
 * Why pooled and CPU-simulated when the rain is GPU-driven: rain is 9 000
 * identical particles with no state. FX are a few hundred, each born from a
 * real event, each with a velocity that came from a closing speed, a direction
 * that came from a tackle angle, and a bounce that has to agree with the pitch
 * firmness. That is state, and 1 600 particles of state is cheaper to write
 * than to explain to a shader.
 *
 * Physical choices worth naming, all taken from the simulation's vocabulary:
 *   - TURF / MUD bounce and stop, because `firm` decides whether a ruck is a
 *     scuffle or a dig; on a FROZEN pitch they skitter (bounce comes from the
 *     caller, which is the engine's own `pitch.firm`).
 *   - WATER droplets get gravity ~2.4× and a fast fade: rain spray leaves a
 *     boot like a flick, not a puff.
 *   - DUST and STEAM rise, carry heavy drag and couple fully to the wind — the
 *     only particles here that care about a GALE.
 *   - SPARKS are pushed above white so the composer's bloom threshold clips
 *     them. They exist for a few frames of contact on a big hit, which is what
 *     the design doc's RUNNING/STANDING `hitKind` branch is telling the
 *     renderer about: the diving tackle needs a punch the standing one must
 *     not have.
 *   - CONFETTI flutters in the scoring side's colours and falls from above,
 *     because a try is the only time this game is allowed to be joyful.
 *
 * Per-particle size and alpha are why this uses a ShaderMaterial rather than
 * `PointsMaterial`: the built-in material has ONE size and ONE opacity for the
 * whole pool, which is fine for stars and useless for mud. `uPixScale` carries
 * the projection's pixels-per-world-metre so a clod is the same size on screen
 * at every camera mode and zoom, which is the same argument SPEC_16 makes for
 * `RENDER_SCALE` — scale the world and the lens together or they desync.
 */
import * as THREE from 'three';

export type ParticleKind =
  | 'TURF' | 'MUD' | 'DUST' | 'WATER' | 'SPARK' | 'STEAM' | 'CONFETTI' | 'SNOWPUFF';

interface KindSpec {
  gravity: number; drag: number; wind: number; life: [number, number];
  size: [number, number]; additive: boolean; sway: number;
  ground: boolean; rise: number; soft: number;
}

const SPEC: Record<ParticleKind, KindSpec> = {
  TURF:     { gravity: -22, drag: 2.6, wind: 0.25, life: [0.45, 0.95], size: [0.10, 0.22], additive: false, sway: 0, ground: true, rise: 0, soft: 0.9 },
  MUD:      { gravity: -26, drag: 3.1, wind: 0.12, life: [0.6, 1.25], size: [0.13, 0.30], additive: false, sway: 0, ground: true, rise: 0, soft: 1.0 },
  DUST:     { gravity: 1.6, drag: 1.35, wind: 1.15, life: [0.8, 1.7], size: [0.34, 0.95], additive: false, sway: 0.6, ground: false, rise: 0.5, soft: 0.5 },
  WATER:    { gravity: -34, drag: 1.4, wind: 0.4, life: [0.22, 0.5], size: [0.07, 0.15], additive: true, sway: 0, ground: true, rise: 0, soft: 0.8 },
  SPARK:    { gravity: -12, drag: 3.6, wind: 0.1, life: [0.12, 0.30], size: [0.08, 0.20], additive: true, sway: 0, ground: false, rise: 0, soft: 0.6 },
  STEAM:    { gravity: 3.4, drag: 0.85, wind: 0.85, life: [1.1, 2.4], size: [0.5, 1.5], additive: false, sway: 0.9, ground: false, rise: 1.0, soft: 0.35 },
  CONFETTI: { gravity: -3.2, drag: 0.75, wind: 1.4, life: [2.4, 4.2], size: [0.14, 0.26], additive: false, sway: 2.6, ground: false, rise: 0, soft: 0.85 },
  SNOWPUFF: { gravity: -5, drag: 1.9, wind: 0.9, life: [0.5, 1.1], size: [0.22, 0.55], additive: false, sway: 0.4, ground: true, rise: 0.15, soft: 0.55 },
};

const MAX = 1600;
const KINDS = Object.keys(SPEC) as ParticleKind[];

export interface EmitOpts {
  count: number;
  /** World units (already RENDER_SCALEd), y up from the turf. */
  x: number; y: number; z: number;
  dx?: number; dz?: number; speed?: number;
  spread?: number; up?: number;
  colorA?: string; colorB?: string;
  /** Multiplies every emitted size. */
  scale?: number;
  /** Overrides the kind's restitution (dry firm pitch skitters, mud does not). */
  bounce?: number;
  /** Alpha ceiling; dust and steam want to be translucent, clods do not. */
  opacity?: number;
}

const VERT = /* glsl */ `
  precision highp float;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPixScale;
  varying float vA;
  varying vec3 vC;
  varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, aSize * uPixScale / max(1.0, -mv.z));
    vA = aAlpha;
    vC = aColor;
    vDepth = -mv.z;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying float vA;
  varying vec3 vC;
  varying float vDepth;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    float a = tex.a * vA;
    if (a < 0.004) discard;
    float f = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
    vec3 c = mix(vC, uFogColor, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(c, a);
  }
`;

export class ThreeParticles {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private alpha: Float32Array;
  private opacity: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private windK: Float32Array;
  private bounce: Float32Array;
  private sway: Float32Array;
  private seed: Float32Array;
  private kindOf: Uint8Array;
  private dirty = false;
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.opacity = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.windK = new Float32Array(MAX);
    this.bounce = new Float32Array(MAX);
    this.sway = new Float32Array(MAX);
    this.seed = new Float32Array(MAX);
    this.kindOf = new Uint8Array(MAX);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    /* Anything with a bounding sphere smaller than the stadium gets culled when
     * the pool is centred on the far touchline, which is exactly when the FX
     * matter. A generous fixed sphere avoids per-frame bounds recomputation. */
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4000);

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uMap: { value: dotTexture() },
        uPixScale: { value: 400 },
        uFogColor: { value: new THREE.Color('#131d2e') },
        uFogDensity: { value: 0.004 },
      },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.points.name = 'FXParticles';
    this.points.visible = false;
    scene.add(this.points);
  }

  /**
   * Pixels-per-world-metre for `gl_PointSize`. Derived from the same lens the
   * camera was built with (see ThreeCanvas.syncCamera), so a clod stays a clod
   * whether the view is CABLE wide or CHASE tight.
   */
  setPixelScale(viewH: number, fov: number) {
    this.mat.uniforms.uPixScale.value = (viewH * 0.5) / Math.tan(Math.max(0.05, fov) * 0.5);
  }

  setFog(color: string, density: number) {
    (this.mat.uniforms.uFogColor.value as THREE.Color).set(color);
    this.mat.uniforms.uFogDensity.value = density;
  }

  emit(kind: ParticleKind, o: EmitOpts) {
    const S = SPEC[kind];
    const k = KINDS.indexOf(kind);
    if (k < 0) return;
    const ci = new THREE.Color(o.colorA ?? '#6b5540');
    const cj = new THREE.Color(o.colorB ?? '#8a7053');
    const n = Math.max(1, Math.round(o.count));
    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const t = Math.random();
      const c = t < 0.5 ? ci : cj;
      const mix = 0.62 + Math.random() * 0.44;
      const spread = o.spread ?? 0.7;
      this.pos[idx * 3] = o.x + (Math.random() - 0.5) * spread;
      this.pos[idx * 3 + 1] = o.y + Math.random() * spread * 0.4;
      this.pos[idx * 3 + 2] = o.z + (Math.random() - 0.5) * spread;
      const ang = Math.atan2(o.dz ?? 0, o.dx ?? 0) + (Math.random() - 0.5) * 1.9;
      const spd = (o.speed ?? 8) * (0.32 + Math.random() * 1.0);
      this.vel[idx * 3] = Math.cos(ang) * spd;
      this.vel[idx * 3 + 1] = (o.up ?? 5) * (0.45 + Math.random());
      this.vel[idx * 3 + 2] = Math.sin(ang) * spd;
      this.col[idx * 3] = c.r * mix;
      this.col[idx * 3 + 1] = c.g * mix;
      this.col[idx * 3 + 2] = c.b * mix;
      if (S.additive) {
        /* Push past white. The alpha blend keeps it sane where it overlaps the
         * crowd and the bloom threshold turns it into light on the turf. */
        this.col[idx * 3] = Math.min(3, c.r * 2.3);
        this.col[idx * 3 + 1] = Math.min(3, c.g * 2.3);
        this.col[idx * 3 + 2] = Math.min(3, c.b * 2.3);
      }
      const life = S.life[0] + Math.random() * (S.life[1] - S.life[0]);
      this.life[idx] = life;
      this.maxLife[idx] = life;
      this.baseSize[idx] = (S.size[0] + Math.random() * (S.size[1] - S.size[0])) * (o.scale ?? 1);
      this.size[idx] = this.baseSize[idx];
      this.opacity[idx] = o.opacity ?? 1;
      this.alpha[idx] = this.opacity[idx];
      this.grav[idx] = S.gravity * (0.82 + Math.random() * 0.4);
      this.drag[idx] = S.drag;
      this.windK[idx] = S.wind;
      this.bounce[idx] = S.ground ? (o.bounce ?? 0.22) : 0;
      this.sway[idx] = S.sway;
      this.seed[idx] = Math.random() * 6.283;
      this.kindOf[idx] = k;
    }
    this.dirty = true;
  }

  update(dt: number, windX: number, windZ: number, scale: number) {
    const pos = this.pos, vel = this.vel;
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; this.dirty = true; }
        continue;
      }
      live++;
      this.life[i] -= dt;
      const kind = KINDS[this.kindOf[i]];
      const S = SPEC[kind];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const w = this.windK[i] * dt * 24;
      vel[i * 3] = vel[i * 3] * d + windX * w;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d + (this.grav[i] + S.rise * 9) * dt;
      vel[i * 3 + 2] = vel[i * 3 + 2] * d + windZ * w;
      if (this.sway[i] > 0) {
        const t = this.seed[i] + this.life[i] * 4.4;
        vel[i * 3] += Math.sin(t) * this.sway[i] * dt * 13;
        vel[i * 3 + 2] += Math.cos(t * 0.8) * this.sway[i] * dt * 11;
      }
      pos[i * 3] += vel[i * 3] * dt * scale;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt * scale;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt * scale;
      /* Turf level in world units: the pitch plane sits at y = 0 and the model
       * root is at 0, so a clod settles just above the blade line. */
      if (S.ground && pos[i * 3 + 1] < 0.03 * scale) {
        pos[i * 3 + 1] = 0.03 * scale;
        if (vel[i * 3 + 1] < 0) {
          vel[i * 3 + 1] = -vel[i * 3 + 1] * this.bounce[i];
          vel[i * 3] *= 0.55;
          vel[i * 3 + 2] *= 0.55;
          if (vel[i * 3 + 1] < 0.5) this.life[i] = Math.min(this.life[i], 0.18);
        }
      }
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      /* Soft kinds expand as they die (a puff of dust spreads), hard kinds keep
       * their size and simply fade, which is what stops clods looking like fog. */
      this.size[i] = this.baseSize[i] * (S.soft < 0.7 ? 1.9 - f * 0.9 : 1);
      this.alpha[i] = Math.min(this.opacity[i], f * (S.soft < 0.7 ? 1.5 : 2.6)) * this.opacity[i];
      this.dirty = true;
    }
    if (!live) {
      if (this.points.visible) this.points.visible = false;
      return;
    }
    this.points.visible = true;
    if (this.dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** Kill everything — used between matches so confetti cannot time-travel. */
  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.points.visible = false;
    this.dirty = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.uniforms.uMap.value?.dispose?.();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}

/**
 * A soft dot with a slightly harder core. Motes in this engine read as
 * material (a clod, a droplet) rather than as light, so the falloff has to be
 * fast but not a disc.
 */
function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.84)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.24)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
