/**
 * lookprobe.ts — what the frame is actually made of, measured.
 *
 * There is no browser in this sandbox, so "does it look right" has to be
 * answered numerically. This builds the real scene the way ThreeCanvas does,
 * then evaluates the lighting maths three.js will run for every material class
 * in it: for each mesh we report the linear albedo, the diffuse irradiance it
 * would receive from the light rig, and the resulting pre-grade pixel value —
 * plus where that pixel lands after the tone curve in GradeShader.
 *
 * The reason it exists: "it looks grey" is a claim about a channel, and the
 * channels are all computable. A material at the default 0x808080, an albedo
 * that clips to white, a specular ambient of zero because nothing supplies an
 * environment map — each one has a different number, and only one of them is
 * "grey".
 *
 *   npx vite-node scripts/lookprobe.ts
 */
import * as THREE from 'three';
import { KITS } from '../src/render/ThreePlayerManager';
import { resolveConditions } from '../src/render/conditions';

/* A fake canvas/WebGL surface: three's object model is pure JS until the first
 * draw call, and we never draw. */
const makeCanvas = () => {
  const c: any = { width: 1280, height: 720, style: {} };
  c.getContext = () => ({
    canvas: c, getExtension: () => null, getParameter: () => 16,
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    enable: () => {}, disable: () => {}, viewport: () => {}, clearColor: () => {},
    clear: () => {}, pixelStorei: () => {},
  });
  return c;
};
(globalThis as any).document = (globalThis as any).document || {
  createElement: (t: string) => (t === 'canvas' ? makeCanvas() : { style: {} }),
};
(globalThis as any).window = (globalThis as any).window || { devicePixelRatio: 1, addEventListener: () => {} };
(globalThis as any).HTMLCanvasElement = (globalThis as any).HTMLCanvasElement || class {};

const RENDER_SCALE = 1.65;

/** sRGB hex -> linear, the way three reads a material colour. */
const lin = (hex: number | string) => {
  const c = new THREE.Color(hex as any);
  return [c.r, c.g, c.b];
};
const toSRGB = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Full RGB grade: returns the linear RGB that reaches the screen. */
function gradeRGB(rgb: number[], exposure: number, shoulder: number, sat: number, satBeforeCurve: boolean) {
  let [r, g, b] = rgb.map((v) => v * exposure);
  if (satBeforeCurve) {
    const l = lum(r, g, b);
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
  }
  const tone = (v: number) => (v * (1 + v / (shoulder * shoulder))) / (1 + v);
  r = tone(r); g = tone(g); b = tone(b);
  if (!satBeforeCurve) {
    const l = lum(r, g, b);
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
  }
  return [r, g, b];
}

/**
 * Diffuse irradiance on an upward-facing Lambert surface from the rig that
 * ThreeMatchDay installs, following three's own math:
 *   directional: color * intensity * NdotL
 *   hemisphere:  color * intensity * mix(ground, sky, NdotY)  (three folds in
 *                PI differently for Standard vs Physical, but for a comparison
 *                probe the shared factor is enough — what we are testing is
 *                relative, and it is the ratio that decides "grey")
 *   ambient:     color * intensity
 *   MeshStandardMaterial divides the diffuse by PI (BRDF_Lambert), which is
 *   why a scene moved over from MeshToonMaterial needs more light, not less.
 */
function litFromRig(o: {
  keyColor: number[]; keyI: number; keyDir: number[];
  hemiSky: number[]; hemiGround: number[]; hemiI: number;
  ambColor: number[]; ambI: number;
  iblI: number; iblSky: number[]; iblGround: number[];
}, albedo: number[], rough: number, n = [0, 1, 0]) {
  const PI = Math.PI;
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ndl = Math.max(0, dot(n, o.keyDir));
  const hemiMix = 0.5 + 0.5 * n[1];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    // three folds an environment map in as IBL_Diffuse (irradiance) PLUS a
    // specular term that survives on a black surface, which is the whole point.
    const sky = o.iblSky[i] * hemiMix + o.iblGround[i] * (1 - hemiMix);
    const f0 = 0.04;
    const envSpec = f0 * (1 - rough * 0.75) * 2.4;
    const irradiance = o.keyColor[i] * o.keyI * ndl / PI
      + (o.hemiSky[i] * hemiMix + o.hemiGround[i] * (1 - hemiMix)) * o.hemiI
      + o.ambColor[i] * o.ambI
      + sky * o.iblI / PI;
    // A dielectric specular adds a broad ambient sheen only when an IBL
    // exists; with scene.environment === null it contributes nothing at all.
    out[i] = albedo[i] * irradiance * (1 - envSpec * 0.25) + o.iblSky[i] * o.iblI * envSpec;
  }
  return out;
}

const conditions = [
  { label: 'MIDDAY / CLEAR / FIRM', weather: 0, timeofday: 0, pitch: 0, wind: 1 },
  { label: 'AFTERNOON / DRIZZLE / STANDARD', weather: 2, timeofday: 1, pitch: 1, wind: 2 },
  { label: 'FLOODLIT / RAIN / MUDDY', weather: 3, timeofday: 3, pitch: 3, wind: 3 },
  { label: 'TWILIGHT / FOG / FROZEN', weather: 4, timeofday: 2, pitch: 4, wind: 1 },
];

const SURFACES: { name: string; color: number | string; rough: number; note: string }[] = [
  { name: 'kit A jersey', color: new THREE.Color(KITS.A.jersey).multiplyScalar(0.78), rough: 0.74, note: 'white shirt, fabric albedo' },
  { name: 'kit B jersey', color: new THREE.Color(KITS.B.jersey).multiplyScalar(0.78), rough: 0.74, note: 'black shirt, fabric albedo' },
  { name: 'ref jersey', color: new THREE.Color(KITS.REF.jersey).multiplyScalar(0.78), rough: 0.74, note: 'yellow' },
  { name: 'boots', color: KITS.A.boot, rough: 0.28, note: 'glossy' },
  { name: 'skin', color: '#c99468', rough: 0.55, note: 'forearm' },
  { name: 'grass stripe A', color: '#2e6b27', rough: 0.9, note: 'albedo mean' },
  { name: 'concrete', color: 0x4b5158, rough: 0.9, note: 'stands' },
  { name: 'seat blue', color: 0x1e2d42, rough: 0.8, note: 'seats' },
  { name: 'ball', color: 0xb8562f, rough: 0.45, note: 'leather' },
];

console.log('lookprobe — albedo × rig × tone curve, per condition set\n');
for (const c of conditions) {
  const cond = resolveConditions(c as any, 'FULL');
  const keyDir = (() => {
    const el = Math.max(0.06, cond.sunEl);
    const v = [Math.sin(cond.sunAz) * Math.cos(el), Math.sin(el), Math.cos(cond.sunAz) * Math.cos(el)];
    const m = Math.hypot(...v);
    return v.map((x) => x / m);
  })();
  const rig = {
    keyColor: lin(cond.keyColor), keyI: cond.keyIntensity, keyDir,
    hemiSky: lin(cond.hemiSky), hemiGround: lin(cond.hemiGround), hemiI: cond.hemiIntensity,
    ambColor: lin(cond.ambientColor), ambI: cond.ambientIntensity,
    iblI: cond.iblIntensity, iblSky: lin(cond.skyHorizon), iblGround: lin(cond.groundHaze),
  };
  console.log(`── ${c.label}`);
  console.log(`   key ${cond.keyIntensity.toFixed(2)}  hemi ${cond.hemiIntensity.toFixed(2)}`
    + `  amb ${cond.ambientIntensity.toFixed(2)}  exposure ${cond.exposure.toFixed(2)}`
    + `  grain ${cond.grain.toFixed(3)}  sat ${cond.weather === 'OVERCAST' || cond.weather === 'FOG' ? 0.9 : 1.08}`);
  const rows: string[] = [];
  for (const s of SURFACES) {
    const albedo = lin(s.color);
    const raw = litFromRig(rig, albedo, s.rough);
    const after = gradeRGB(raw, cond.exposure, 1.0, 1.08, false);
    const before = gradeRGB(raw, cond.exposure, 1.0, 1.08, true);
    const l = lum(...after);
    const satAfter = (mx: number, mn: number) => (mx + mn < 1e-6 ? 0 : (mx - mn) / (mx + mn));
    const chroma = satAfter(Math.max(...after), Math.min(...after));
    const chromaRaw = satAfter(Math.max(...raw), Math.min(...raw));
    const clipped = after.some((v) => v > 0.999);
    rows.push(`   ${s.name.padEnd(16)} albedo ${lum(...albedo).toFixed(3)}`
      + ` → lit ${lum(...raw).toFixed(3)} → screen ${toSRGB(Math.min(1, l)).toFixed(3)}`
      + `  chroma ${(chroma * 100).toFixed(0)}% (pre-grade ${(chromaRaw * 100).toFixed(0)}%)`
      + `${clipped ? '  ← CLIPPED' : ''}${l < 0.06 ? '  ← BLACK' : ''}`
      + `  sat-before-curve would give ${(satAfter(Math.max(...before), Math.min(...before)) * 100).toFixed(0)}%`);
  }
  console.log(rows.join('\n'));
  console.log('');
}

console.log('reference: three.js default MeshStandardMaterial colour is 0xffffff and');
console.log('the default scene.environment is null — a PBR scene with no env map has');
console.log('no ambient specular at all, which is the flat-grey look.')
;
