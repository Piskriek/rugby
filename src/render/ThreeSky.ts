/**
 * ThreeSky — the atmosphere the stadium sits inside.
 *
 * A single inverted sphere carrying a three-stop vertical gradient (zenith →
 * horizon → ground haze) plus a soft sun disc bloomed into the upper sky. It
 * is drawn with `depthWrite: false` at `renderOrder = -1000` so it can never
 * occlude geometry and never needs to be sorted against it.
 *
 * The dome is NOT lit — it *is* the light source's visual counterpart. The
 * colours here and the sun colour/elevation in `ThreeEnvironment.buildSun()`
 * are picked from the same `SkyPreset`, so the key light and the sky always
 * agree. That agreement is the single biggest reason the scene reads as
 * photographed rather than assembled.
 */
import * as THREE from 'three';

export type SkyPresetId = 'AFTERNOON' | 'GOLDEN' | 'FLOODLIT' | 'OVERCAST';

export interface SkyPreset {
  id: SkyPresetId;
  /** Colour high overhead. */
  zenith: THREE.ColorRepresentation;
  /** Colour at the horizon band. */
  horizon: THREE.ColorRepresentation;
  /** Haze below the horizon; also the scene fog colour. */
  ground: THREE.ColorRepresentation;
  /** Direct sun/key colour. */
  sun: THREE.ColorRepresentation;
  /** Key light intensity. */
  sunIntensity: number;
  /** Sun elevation in radians above the horizon. */
  sunElevation: number;
  /** Sun compass bearing in radians (0 = +Z, grows toward +X). */
  sunAzimuth: number;
  /** Sky/ground bounce intensity. */
  ambient: number;
  /** Exponential fog density applied to the whole scene. */
  fogDensity: number;
  /** Floodlight contribution — 0 in daylight, 1 at night. */
  floods: number;
  /** How visible the sun disc is in the dome. */
  sunDisc: number;
}

export const SKY_PRESETS: Record<SkyPresetId, SkyPreset> = {
  /** Bright, high, neutral — the default broadcast look. */
  AFTERNOON: {
    id: 'AFTERNOON',
    zenith: 0x2f6ec4, horizon: 0xa8c9e8, ground: 0x8fa6b8,
    sun: 0xfff4e0, sunIntensity: 3.1, sunElevation: 0.94, sunAzimuth: -0.75,
    ambient: 0.85, fogDensity: 0.0016, floods: 0.0, sunDisc: 0.35,
  },
  /** Low warm sun, long shadows, the money shot. */
  GOLDEN: {
    id: 'GOLDEN',
    zenith: 0x1d3f7a, horizon: 0xe8a463, ground: 0x6b5a4e,
    sun: 0xffd39a, sunIntensity: 3.4, sunElevation: 0.20, sunAzimuth: -1.35,
    ambient: 0.62, fogDensity: 0.0026, floods: 0.25, sunDisc: 1.0,
  },
  /** Night match: the towers do the work. */
  FLOODLIT: {
    id: 'FLOODLIT',
    zenith: 0x060a14, horizon: 0x16233b, ground: 0x0d1420,
    sun: 0x9fb6dc, sunIntensity: 0.35, sunElevation: 1.15, sunAzimuth: 0.4,
    ambient: 0.30, fogDensity: 0.0032, floods: 1.0, sunDisc: 0.0,
  },
  /** Flat grey, low contrast — a wet Saturday in the north. */
  OVERCAST: {
    id: 'OVERCAST',
    zenith: 0x6d7c8c, horizon: 0xb3bdc6, ground: 0x8d959c,
    sun: 0xe6ecf2, sunIntensity: 1.5, sunElevation: 1.05, sunAzimuth: -0.5,
    ambient: 1.15, fogDensity: 0.0042, floods: 0.35, sunDisc: 0.0,
  },
};

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  // Translation is stripped: the dome is infinitely far away and must not
  // parallax with the camera, only rotate with it.
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunDisc;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  // Above the horizon: horizon -> zenith on a curve that keeps the bright
  // band tight to the skyline instead of washing the whole upper hemisphere.
  float up = clamp(h, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.42));

  // Below: fade into the ground haze so the dome meets the turf invisibly.
  float dn = clamp(-h, 0.0, 1.0);
  vec3 below = mix(uHorizon, uGround, pow(dn, 0.30));
  vec3 col = h >= 0.0 ? sky : below;

  if (uSunDisc > 0.0) {
    float cosA = clamp(dot(d, normalize(uSunDir)), -1.0, 1.0);
    // Tight core plus a wide forward-scattered halo.
    float disc = smoothstep(0.9995, 0.99985, cosA);
    float halo = pow(max(cosA, 0.0), 220.0) * 0.55 + pow(max(cosA, 0.0), 12.0) * 0.10;
    col += uSunColor * (disc * 6.0 + halo) * uSunDisc;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

export class ThreeSky {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(radius: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true,
      uniforms: {
        uZenith: { value: new THREE.Color(0x2f6ec4) },
        uHorizon: { value: new THREE.Color(0xa8c9e8) },
        uGround: { value: new THREE.Color(0x8fa6b8) },
        uSunColor: { value: new THREE.Color(0xfff4e0) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunDisc: { value: 0.35 },
      },
    });
    const geo = new THREE.SphereGeometry(radius, 32, 20);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'SkyDome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Point the dome's gradient and sun disc at a preset. */
  apply(p: SkyPreset, sunDir: THREE.Vector3): void {
    const u = this.mat.uniforms;
    (u.uZenith.value as THREE.Color).set(p.zenith);
    (u.uHorizon.value as THREE.Color).set(p.horizon);
    (u.uGround.value as THREE.Color).set(p.ground);
    (u.uSunColor.value as THREE.Color).set(p.sun);
    (u.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
    u.uSunDisc.value = p.sunDisc;
  }

  /** Keep the dome centred on the camera so it never clips the far plane. */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * Convert a preset's elevation/azimuth into a *direction toward the sun* in
 * three-space, at the given distance. Shared by the dome and the key light so
 * the shadow direction always matches the visible sun.
 */
export function sunVector(p: SkyPreset, distance = 1): THREE.Vector3 {
  const ce = Math.cos(p.sunElevation);
  return new THREE.Vector3(
    Math.sin(p.sunAzimuth) * ce,
    Math.sin(p.sunElevation),
    Math.cos(p.sunAzimuth) * ce,
  ).multiplyScalar(distance);
}
