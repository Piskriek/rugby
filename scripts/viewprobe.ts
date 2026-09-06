/**
 * viewprobe — what is actually in front of the camera?
 *
 * The user reported a uniform brown frame: no pitch, no players, no stadium,
 * while the HUD and the simulation ran fine. Static reading of the render
 * path could not settle it — the camera maths checks out, the shaders
 * compile, the meshes are added to the scene, the GLB is served.
 *
 * So build the REAL environment against a shimmed WebGL context (three's
 * object model is pure JS until the first draw call, the trick lookprobe
 * uses), point the REAL match camera at it, and raycast. A ray that hits the
 * pitch proves the geometry is in front of the lens; a ray that hits nothing
 * but the sky dome proves it is not, and says which it is.
 *
 *   npx vite-node scripts/viewprobe.ts
 */
import * as THREE from 'three';

/* ---- shimmed browser surface (same approach as scripts/lookprobe.ts) ---- */
const makeCanvas = () => {
  const c: Record<string, unknown> = { width: 1280, height: 720, style: {} };
  const ctx2d: Record<string, unknown> = {};
  /* Any 2D-context method we have not explicitly modelled becomes a no-op
   * rather than a crash: this probe cares about GEOMETRY, not pixels, and a
   * missing canvas method must not be mistaken for a real render fault. */
  const NOOPS = [
    'fillRect', 'drawImage', 'putImageData', 'save', 'restore', 'beginPath',
    'fill', 'stroke', 'translate', 'rotate', 'scale', 'moveTo', 'lineTo',
    'arc', 'arcTo', 'closePath', 'setTransform', 'resetTransform', 'clearRect',
    'fillText', 'strokeText', 'strokeRect', 'ellipse', 'rect', 'clip',
    'setLineDash', 'getLineDash', 'bezierCurveTo', 'quadraticCurveTo',
    'transform', 'createPattern', 'roundRect',
  ];
  for (const k of NOOPS) ctx2d[k] = () => {};
  ctx2d.canvas = c;
  ctx2d.measureText = () => ({ width: 4 });
  ctx2d.createImageData = (w: number, h: number) => ({
    width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
  });
  ctx2d.getImageData = (_x: number, _y: number, w = 1, h = 1) => ({
    width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
  });
  ctx2d.createLinearGradient = () => ({ addColorStop: () => {} });
  ctx2d.createRadialGradient = () => ({ addColorStop: () => {} });

  const gl: Record<string, unknown> = {
    canvas: c, getExtension: () => null, getParameter: () => 16,
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
    enable: () => {}, disable: () => {}, viewport: () => {}, clearColor: () => {},
    clear: () => {}, pixelStorei: () => {},
  };
  c.getContext = (kind: string) => (kind === '2d' ? ctx2d : gl);
  return c;
};
const g = globalThis as Record<string, unknown>;
g.document = g.document || {
  createElement: (t: string) => (t === 'canvas' ? makeCanvas() : { style: {} }),
  createElementNS: () => makeCanvas(),
};
g.window = g.window || { devicePixelRatio: 1, addEventListener: () => {} };
g.HTMLCanvasElement = g.HTMLCanvasElement || class {};
g.OffscreenCanvas = g.OffscreenCanvas || class {};
g.ImageData = g.ImageData || class {};

const { RENDER_SCALE } = await import('../src/render/retro');
const { ThreeEnvironment } = await import('../src/render/ThreeEnvironment');
const { ThreeMatchDay } = await import('../src/render/ThreeMatchDay');
const { conditionsFor, qualityFor } = await import('../src/render/conditions');
const { Director } = await import('../src/game/director');
const { gateConfig } = await import('../src/game/gates');
const { seedRng } = await import('../src/game/seed');

/* A renderer stub good enough for the constructors that ask it for caps. */
const fakeRenderer = {
  capabilities: { getMaxAnisotropy: () => 16, isWebGL2: true },
  getContext: () => ({}),
} as unknown as THREE.WebGLRenderer;

const scene = new THREE.Scene();
let env: unknown = null;
let envErr: string | null = null;
try {
  env = new ThreeEnvironment(scene, fakeRenderer);
} catch (e) {
  envErr = (e as Error).message;
}
let mdErr: string | null = null;
try {
  new ThreeMatchDay(scene);
} catch (e) {
  mdErr = (e as Error).message;
}

console.log('\n=== CONSTRUCTION ===');
console.log('ThreeEnvironment:', envErr ? `THREW: ${envErr}` : 'built');
console.log('ThreeMatchDay   :', mdErr ? `THREW: ${mdErr}` : 'built');

/* Apply the same conditions the game would. */
const opts = { weather: 0, timeofday: 1 };
const cond = conditionsFor(opts, qualityFor(opts));
try {
  (env as { applyConditions?: (c: unknown) => void })?.applyConditions?.(cond);
} catch (e) {
  console.log('applyConditions THREW:', (e as Error).message);
}

/* ---- inventory ---- */
let meshes = 0, visibleMeshes = 0, lights = 0, tris = 0;
const byName: string[] = [];
scene.traverse((o) => {
  const any = o as unknown as { isMesh?: boolean; isLight?: boolean; geometry?: THREE.BufferGeometry };
  if (any.isLight) lights++;
  if (any.isMesh) {
    meshes++;
    const vis = o.visible && o.parent?.visible !== false;
    if (vis) visibleMeshes++;
    const gm = any.geometry;
    const n = gm?.index ? gm.index.count / 3 : (gm?.attributes?.position?.count ?? 0) / 3;
    tris += n;
    if (byName.length < 30) {
      byName.push(`${(o.name || '(unnamed)').padEnd(20)} vis=${String(o.visible).padEnd(5)} ` +
        `y=${o.position.y.toFixed(2).padStart(7)} tris=${Math.round(n)}`);
    }
  }
});
console.log('\n=== SCENE INVENTORY ===');
console.log(`meshes ${meshes} (visible ${visibleMeshes}), lights ${lights}, triangles ${Math.round(tris)}`);
byName.forEach((n) => console.log('  ', n));

/* ---- the real camera, from a real match ---- */
seedRng(1);
const d = new Director(gateConfig(3));
for (let i = 0; i < 60; i++) d.update(1 / 60, {} as never, new Set());
const cam = d.cam;

const s = RENDER_SCALE;
const camPos = new THREE.Vector3(cam.x * s, cam.h * s, -cam.z * s);
const fHorz = new THREE.Vector3(Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
const lookDir = fHorz.clone().multiplyScalar(Math.cos(cam.tilt))
  .addScaledVector(new THREE.Vector3(0, -1, 0), Math.sin(cam.tilt)).normalize();

console.log('\n=== CAMERA ===');
console.log(`pos (units) ${camPos.toArray().map((n) => n.toFixed(1)).join(', ')}`);
console.log(`look        ${lookDir.toArray().map((n) => n.toFixed(3)).join(', ')}`);
console.log(`fov ${(cam.fov * 180 / Math.PI).toFixed(1)}deg  tilt ${(cam.tilt * 180 / Math.PI).toFixed(1)}deg`);

/* ---- raycast a grid across the frame ---- */
scene.updateMatrixWorld(true);
const persp = new THREE.PerspectiveCamera(cam.fov * 180 / Math.PI, 16 / 9, 0.15 * s, 320 * s);
persp.position.copy(camPos);
persp.up.set(
  Math.sin(cam.yaw) * Math.sin(cam.tilt),
  Math.cos(cam.tilt),
  -Math.cos(cam.yaw) * Math.sin(cam.tilt),
);
persp.lookAt(camPos.clone().add(lookDir));
persp.updateMatrixWorld(true);

const ray = new THREE.Raycaster();
ray.far = 320 * s;
const hits = new Map<string, number>();
let miss = 0;
const N = 9;
for (let iy = 0; iy < N; iy++) {
  for (let ix = 0; ix < N; ix++) {
    const ndc = new THREE.Vector2((ix / (N - 1)) * 2 - 1, -((iy / (N - 1)) * 2 - 1));
    ray.setFromCamera(ndc, persp);
    const res = ray.intersectObjects(scene.children, true);
    /* A raycast hits geometry regardless of how transparent it is, so an
     * invisible quad (opacity 0 mist, the wet layer) would be reported as
     * "what the lens sees" when in truth you see straight through it. Only
     * count a hit that would actually put pixels on the screen. */
    const first = res.find((r) => {
      if (!r.object.visible) return false;
      const m = (r.object as THREE.Mesh).material as THREE.Material & {
        opacity?: number; transparent?: boolean; visible?: boolean;
      };
      if (m?.visible === false) return false;
      if (m?.transparent && (m.opacity ?? 1) < 0.02) return false;
      return true;
    });
    if (!first) { miss++; continue; }
    const o = first.object as THREE.Mesh;
    const geo = o.geometry as THREE.BufferGeometry;
    const mat = o.material as THREE.Material & { type?: string };
    const nm = `${o.name || '(unnamed)'} [${geo?.type ?? '?'} / ${mat?.type ?? '?'}] ` +
      `depthWrite=${(mat as { depthWrite?: boolean })?.depthWrite} ` +
      `depthTest=${(mat as { depthTest?: boolean })?.depthTest} ` +
      `order=${o.renderOrder} dist=${first.distance.toFixed(1)}`;
    hits.set(nm, (hits.get(nm) ?? 0) + 1);
  }
}
console.log('\n=== WHAT THE LENS SEES (81 rays) ===');
const sorted = [...hits.entries()].sort((a, b) => b[1] - a[1]);
for (const [nm, n] of sorted) {
  console.log(`  ${String(n).padStart(3)} rays (${((100 * n) / 81).toFixed(0).padStart(3)}%)  ${nm}`);
}
if (miss) console.log(`  ${String(miss).padStart(3)} rays (${((100 * miss) / 81).toFixed(0).padStart(3)}%)  *** NOTHING (empty sky) ***`);

let pitchRays = 0;
for (const [k, n] of hits) if (k.startsWith('InnerPitch')) pitchRays += n;
console.log('\n=== VERDICT ===');
const built = !envErr && !mdErr;
const pct = (100 * pitchRays) / 81;
let ok = true;
const say = (name: string, pass: boolean, detail: string): void => {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${detail}`);
};
say('the environment constructs', built, envErr ?? mdErr ?? 'pitch, stands, posts, sky');
say('the pitch is in front of the lens', pitchRays > 0, `${pct.toFixed(0)}% of rays hit InnerPitch`);
say('the pitch fills the frame', pct >= 30, `${pct.toFixed(0)}% (want >= 30%)`);
say('something other than sky is drawn', visibleMeshes > 5, `${visibleMeshes} visible meshes`);
say('the rig is lit', lights > 0, `${lights} lights`);
console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
