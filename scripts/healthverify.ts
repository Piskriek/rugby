/**
 * healthverify — prove the render self-diagnosis reaches the right verdict.
 *
 * A diagnostic that is itself wrong is worse than none: it sends the next
 * person down a blind alley with confidence. Twice during this bug my own
 * probes reported faults that did not exist (a shim missing createImageData,
 * then raycasts "hitting" fully transparent mist quads), so the rule earned
 * here is that the diagnostic gets tested against known-bad inputs exactly
 * like any other unit.
 *
 * Each case below is a failure mode actually seen or actually risked in this
 * renderer, and asserts the verdict NAMES that cause rather than a symptom
 * further downstream.
 *
 *   npx vite-node scripts/healthverify.ts
 */
import * as THREE from 'three';
import { assessRender, type HealthInput } from '../src/render/renderHealth';

let ok = true;
const check = (name: string, pass: boolean, detail: string): void => {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

/** A scene with n visible lit meshes and one light. */
function sceneWith(meshes: number, lights = 1, visible = true): THREE.Scene {
  const sc = new THREE.Scene();
  for (let i = 0; i < meshes; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
    m.visible = visible;
    sc.add(m);
  }
  for (let i = 0; i < lights; i++) sc.add(new THREE.DirectionalLight());
  return sc;
}

/* The renderer is only touched for getContext/getRenderTarget/setRenderTarget
 * when a target is supplied; every case here passes target: null, which the
 * module treats as the default framebuffer and reports complete. */
const fakeRenderer = {
  getContext: () => ({}),
  getRenderTarget: () => null,
  setRenderTarget: () => {},
} as unknown as THREE.WebGLRenderer;

const base = (over: Partial<HealthInput>): HealthInput => ({
  renderer: fakeRenderer,
  scene: sceneWith(20),
  target: null,
  drawCalls: 40,
  triangles: 50_000,
  bufferW: 1920, bufferH: 1080,
  cssW: 1280, cssH: 720,
  contextLost: false,
  ...over,
});

console.log('healthverify — does the renderer diagnose itself correctly?\n');

/* 1. A healthy frame must stay quiet. A diagnostic that cries wolf on a
 *    working build gets ignored on the build that matters. */
{
  const r = assessRender(base({}));
  check('a healthy frame reports ok', r.level === 'ok', r.verdict);
}

/* 2. Lost context outranks everything — nothing downstream is meaningful. */
{
  const r = assessRender(base({ contextLost: true, drawCalls: 0, triangles: 0 }));
  check('lost context is reported first', r.level === 'fail' && /context was lost/i.test(r.verdict),
    r.verdict);
}

/* 3. THE ORIGINAL BUG: the composer target allocated at 2x2 before layout.
 *    This must name the buffer size, not blame the camera. */
{
  const r = assessRender(base({ bufferW: 2, bufferH: 2 }));
  check('a 2x2 drawing buffer is named exactly', r.level === 'fail' && /2x2/.test(r.verdict),
    r.verdict);
}

/* 4. Nothing submitted, and nothing visible to submit: the environment
 *    failed to build. Distinguish that from the culling case below. */
{
  const r = assessRender(base({ scene: sceneWith(0, 0), drawCalls: 0, triangles: 0 }));
  check('empty scene blames the environment', r.level === 'fail' && /no visible meshes/i.test(r.verdict),
    r.verdict);
}

/* 5. Nothing submitted, but the scene IS full: that is culling, a completely
 *    different fix. The two must never be conflated. */
{
  const r = assessRender(base({ drawCalls: 0, triangles: 0 }));
  check('full scene + 0 draws blames culling', r.level === 'fail' && /culled/i.test(r.verdict),
    r.verdict);
}

/* 6. Draws happening but nothing rasterised: camera aimed away. */
{
  const r = assessRender(base({ triangles: 3 }));
  check('draws with no triangles blames the camera', r.level === 'fail' && /camera/i.test(r.verdict),
    r.verdict);
}

/* 7. An unlit rig is a warning, not a failure: PBR with no lights renders
 *    black, which is a real defect, but the frame is still being drawn. */
{
  const r = assessRender(base({ scene: sceneWith(20, 0) }));
  check('no lights warns but does not fail', r.level === 'warn',
    `${r.level}: ${r.verdict}`);
}

/* 8. Ordering: a 2x2 buffer AND zero draws must report the buffer, because
 *    the buffer explains the draws. Reporting the symptom would have cost
 *    another full diagnostic round on this very bug. */
{
  const r = assessRender(base({ bufferW: 2, bufferH: 2, drawCalls: 0, triangles: 0 }));
  check('root cause outranks its own symptom', /2x2/.test(r.verdict), r.verdict);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
