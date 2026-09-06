/* sceneaudit.ts — does the 3D layer actually put a match on screen?
 *
 * WHY THIS EXISTS, IN ONE SENTENCE: every other harness in this repository
 * checks the simulation, the shader text or the module graph, and none of them
 * asks whether a frame would contain anything — which is how a match could be
 * shipped to a player with no pitch, no players and no stripes in it while
 * `tsc`, `vite build`, `renderverify`, `glslcheck`, `lookprobe` and
 * `matchdayheadless` were all green and a `curl` of the GLB returned 200.
 *
 * WHAT IT DOES, IN ORDER:
 *   1. Gives node a real rasteriser. `@napi-rs/canvas` is Skia with a prebuilt
 *      native binding, no GPU and no browser: `document.createElement('canvas')`
 *      now returns a canvas that actually paints. So the procedural turf, the
 *      ad boards and the number badges run their REAL code, and the texture that
 *      ends up bound to the pitch is a texture we can read back.
 *   2. Builds the real world the way ThreeCanvas does — `ThreeEnvironment`,
 *      `ThreeMatchDay`, `ThreeParticles` — and points the real camera at it by
 *      calling the production `ThreeCanvas.prototype.syncCamera` on a light
 *      stand-in object, so the projection matrix is the game's own off-axis
 *      retro pinhole and not a copy that could drift.
 *   3. Plays a match with the real Director and stops on a ruck, because a
 *      breakdown is the moment the camera has something to frame.
 *   4. Projects every triangle the renderer would draw, paints it into that Skia
 *      canvas with real lighting maths and real texel sampling, and writes a PNG
 *      a human can look at — the picture is the artefact, not a proxy for it.
 *   5. Measures the frame: how much of it is surface, is the surface green, are
 *      the WHITE LINES IN IT, are there bodies where the actors are, is the ball
 *      inside the frustum. An empty field fails these checks. That is the point.
 *   6. `--mutate <name>` breaks one thing on purpose and requires a FAIL, so the
 *      harness cannot quietly become decoration. A test that iterates a feature
 *      without being able to see its absence is not a test.
 *
 *   npx vite-node scripts/sceneaudit.ts
 *   npx vite-node scripts/sceneaudit.ts --mutate sinkpitch
 *
 * This is a geometry-and-texture audit with a raster, not a GPU. It cannot see
 * bloom, tone curve, or a shader the driver refuses to link; `renderverify` and
 * `glslcheck` cover what they can, and `scripts/shoot.cjs` covers the browser if
 * a chromium with its system libraries is ever available.
 */
import * as THREE from 'three';
import fs from 'node:fs';
import { installNodeCanvas, makeCanvas } from './_nodeCanvas';

/* The Skia/document/WebGL stubs this harness needs are shared with bootcheck — see
 * _nodeCanvas.ts for why one copy of a fake browser is worth more than two. */
installNodeCanvas();

/* ------------------------------------------------------------------ args --- */
const argv = process.argv.slice(2);
const flag = (n: string) => argv.indexOf(`--${n}`) >= 0;
const opt = (n: string, d: number) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? Number(argv[i + 1]) : d; };
/* Parsed by flag, not by index arithmetic: `argv[indexOf(x) + 1]` returns argv[0]
 * — the script's own path — when the flag is ABSENT, which made every invocation
 * that passed any other argument (`--width 1280`) run the mutation self-test
 * instead of the audit. A harness that silently changes what it checks when you
 * add a flag is how an audit starts agreeing with whatever you ask it. */
const mi = argv.indexOf('--mutate');
const MUTATE = mi >= 0 ? (argv[mi + 1] || '') : '';
const OUT = '.arena/shots';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name: string, pass: boolean, detail = ''): void {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${detail}`);
}

async function main() {
  const { ThreeEnvironment } = await import('../src/render/ThreeEnvironment');
  const { ThreeMatchDay } = await import('../src/render/ThreeMatchDay');
  const { ThreeParticles } = await import('../src/render/ThreeParticles');
  const { ThreeCanvas } = await import('../src/render/ThreeCanvas');
  const { renderHealth } = await import('../src/render/ThreeCanvas');
  const { ThreePlayerManager } = await import('../src/render/ThreePlayerManager');
  const { resolveConditions } = await import('../src/render/conditions');
  const { Director, NO_INPUT } = await import('../src/game/director');
  const { gateConfig } = await import('../src/game/gates');

  /* ------------------------------------------------- 2. the world, for real -- */
  const W = opt('width', 640), H = opt('height', 360);
  const view = { w: W, h: H };
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1a2634, 0.0035);
  scene.background = new THREE.Color(0x1a2634);
  const rendererStub: any = { capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 4096 } };
  const env = new ThreeEnvironment(scene, rendererStub);
  const matchDay = new ThreeMatchDay(scene);
  const particles = new ThreeParticles(scene);
  const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 400);
  /** The production camera rig, borrowed rather than reimplemented. */
  const rig: any = { camera, view, scene, renderer: rendererStub, environment: env };
  (ThreeCanvas.prototype as any).syncCamera.call(rig, {
    x: 0, z: 0, h: 20, yaw: 0, tilt: 0.5, fov: 0.62, shake: 0, horizon: 0.42, roll: 0,
  }, view, 0, 0);

  /* --------------------------------------------------- 3. a match to look at -- */
  const d = new Director(gateConfig(3));
  const cond = resolveConditions(d.options as Record<string, number>, 'FULL');
  env.applyConditions(cond);
  /* Freeze the sim on the frame worth looking at. Stepping PAST it is how an
   * earlier version of this harness ended up photographing an empty middle of
   * the park: a ruck is a two-second event and the cable camera leaves the
   * scene as soon as the ball moves, so "the ruck, thirty frames later" is not
   * the ruck. The state is snapshotted and replayed to the render layers so
   * they are all asked about the SAME instant the camera is holding. */
  const want = process.env.SHOT === 'open' ? 'OPEN_PLAY' : 'RUCK';
  let stopped = -1;
  for (let f = 0; f < 60 * 240; f++) {
    d.update(1 / 60, NO_INPUT, new Set(), new Set());
    const isRuck = d.phase === 'BREAKDOWN' && d.bd && (d.bd as any).stage === 'RUCK'
      && (d.bd as any).players.length >= 5;
    const isOpen = d.phase === 'OPEN_PLAY' && d.op && (d.op as any).ball.live
      && Math.abs((d.op as any).carrier?.rx ?? 99) > 1;
    if ((want === 'RUCK' && isRuck) || (want === 'OPEN_PLAY' && isOpen)) { stopped = f; break; }
  }
  if (stopped < 0) console.log(`  (no ${want} frame in 240 s — photographing the last state instead)`);
  /* SETTLE THE LENS, NOT THE MATCH. The camera is eased: on the first frame of a
   * ruck it is still wherever the open-play ball left it, and `updateCamera` walks
   * it in at its own rate. A real ruck lasts about 1.4 s, so the player spends all
   * but a few frames of it looking at the converged framing — and an audit that
   * photographs frame zero measures a camera the audience never settles on. It made
   * the same shipped build read 17 px on one run and 19 px on another, which is a
   * mid-ease artefact, not a fact about the lens. The state stays frozen; only the
   * camera is allowed to catch up, using the production solver rather than a guess. */
  {
    const { updateCamera } = await import('../src/game/engine/camera');
    for (let i = 0; i < 45; i++) updateCamera(d, 1 / 60);
  }
  const shot = want === 'RUCK' && stopped >= 0 ? 'a ruck' : (want === 'OPEN_PLAY' && stopped >= 0 ? 'open play' : 'whatever came');
  env.update(d.t, 1 / 60, camera);
  matchDay.update(d.cam, view, cond, 1 / 60);
  (ThreeCanvas.prototype as any).syncCamera.call(rig, d.cam, view, 0, 0);
  scene.updateMatrixWorld(true);

  /* The squad, through the real manager. The GLB is never fetched here, so this
   * is exactly the state a browser in a bad network gets to: `ready === false`,
   * and — since the fix — procedural bodies rather than an empty field. */
  const mgr = new ThreePlayerManager({ scene, camera, environment: env } as any);
  mgr.update(d, view, d.cam, 1 / 60);
  /* Matrices AFTER the last object is added. The renderer does this every frame
   * by itself; a harness that copies only the scene graph and forgets the
   * refresh measures every body at the origin, reports "0 of 31 players have
   * pixels", and sends someone off to fix a game that was fine. */
  scene.updateMatrixWorld(true);
  if (MUTATE === 'nobodies') {
    for (const g of (mgr as any).standIn.values()) (g as THREE.Group).visible = false;
  }
  if (MUTATE === 'sinkpitch') {
    const inner = scene.getObjectByName('InnerPitch');
    if (inner) inner.position.y -= 0.65;         // the crown-sign regression, reproduced
  } else if (MUTATE === 'nomap') {
    const inner = scene.getObjectByName('InnerPitch') as THREE.Mesh;
    (inner.material as THREE.MeshStandardMaterial).map = null as any;
    (inner.material as THREE.MeshStandardMaterial).needsUpdate = true;
  } else if (MUTATE === 'pushcamera') {
    (ThreeCanvas.prototype as any).syncCamera.call(rig, { ...d.cam, z: d.cam.z + 260 }, view, 0, 0);
    scene.updateMatrixWorld(true);
  }

  /* ---------------------------------------------------- 4. paint the frame --- */
  const sheet = makeCanvas(W, H);
  const g2: CanvasRenderingContext2D = sheet.getContext('2d');
  /* A framebuffer we own, not a canvas we ask. Depth-tested per pixel, because
   * the alternative — sorting triangles back to front — is what this harness
   * used to do, and it painted the grandstand OVER the match: a 400-triangle
   * roof whose centroid is nearer than a 20-pixel forward pack sorts first and
   * swallows every man under it. A harness that hides the players is worse than
   * no harness, because it reports a scene that is fine. */
  const fb = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < fb.length; i += 4) { fb[i] = 1; fb[i + 1] = 2; fb[i + 2] = 3; fb[i + 3] = 255; }
  const zbuf = new Float32Array(W * H);
  zbuf.fill(Number.POSITIVE_INFINITY);
  /* Which object WON each pixel. A scene graph that contains a pitch and a
   * framebuffer whose pitch pixels were eaten by the ground plane underneath it
   * are two different facts, and only the second one is what a viewer sees —
   * the exact difference between the checks this harness used to have and the
   * ones it has now. `--mutate sinkpitch` is the proof: burying the turf 0.65 m
   * under the outer plane used to leave every number unchanged. */
  const owner = new Int32Array(W * H);
  owner.fill(-1);
  const KIND_PITCH = 1, KIND_GROUND = 2, KIND_BODY = 3, KIND_BALL = 4, KIND_OTHER = 5;
  const kinds: number[] = [];
  const ownerNames: string[] = [];
  /** A player is a NAMED GROUP whose six children are anonymous meshes, and so
   *  is the ball. Naming a mesh is optional in three, so ownership has to be
   *  read up the parent chain — asking only the mesh itself is how this harness
   *  briefly reported that a whole squad had no pixels. */
  const nameOf = (o: THREE.Object3D): string => {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n.name) return n.name;
    return '';
  };
  const kindOf = (name: string): number => {
    if (name === 'InnerPitch') return KIND_PITCH;
    if (name === 'OuterGround') return KIND_GROUND;
    if (name === 'Ball3D' || name.startsWith('Ball')) return KIND_BALL;
    if (name.startsWith('StandIn_') || /^RugbyPlayer|^Player|^Root/.test(name)) return KIND_BODY;
    return KIND_OTHER;
  };

  /* One shared light model, from the same conditions the rig runs on: a face is
   * lit by the key plus a hemisphere. Not the game's shading (there is no PBR
   * here and no IBL), but enough that a black-unlit scene and a blown-out one
   * are different numbers, which is the whole thing being measured. */
  const sunEl = Math.max(0.06, cond.sunEl);
  const keyDir = new THREE.Vector3(Math.sin(cond.sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.cos(cond.sunAz) * Math.cos(sunEl)).normalize();
  const keyCol = new THREE.Color(cond.keyColor).multiplyScalar(cond.keyIntensity);
  const hemiSky = new THREE.Color(cond.hemiSky).multiplyScalar(cond.hemiIntensity);
  const hemiGround = new THREE.Color(cond.hemiGround).multiplyScalar(cond.hemiIntensity);
  const ambCol = new THREE.Color(cond.ambientColor).multiplyScalar(cond.ambientIntensity);
  const iblSky = new THREE.Color(cond.skyHorizon).multiplyScalar(cond.iblIntensity);
  const iblGround = new THREE.Color(cond.groundHaze).multiplyScalar(cond.iblIntensity);
  /** sRGB 0..1 as stored in a canvas or a hex → the linear number the maths runs
   *  on, because three decodes on upload and a harness that skips this step
   *  paints a field twice as bright as the one a GPU shows. */
  const toLin = (x: number) => Math.pow(Math.max(0, x), 2.2);
  const encode = (x: number) => Math.round(255 * Math.min(1, x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055));

  const texelCache = new Map<string, { d: Uint8ClampedArray; w: number; h: number }>();
  /** the brightest-channel floor of the texel `texelAt` last read, in sRGB 0..1
   *  — how the audit tells a marking from the grass it is painted on. */
  let rawMin = 0;
  /** one reusable colour for a raster that touches a quarter of a million
   *  pixels: allocating per pixel makes this harness slower than the game. */
  const scratch = new THREE.Color();
  const texelAt = (map: THREE.Texture | null, u: number, v: number, out: THREE.Color): boolean => {
    if (!map || !map.image) return false;
    const img: any = map.image;
    const w = img.width | 0, h = img.height | 0;
    if (!w || !h) return false;
    let ent = texelCache.get(map.uuid);
    if (!ent) {
      const c2 = makeCanvas(w, h);
      // The texture's own canvas can be drawn into a same-size canvas by Skia.
      (c2.getContext('2d') as any).drawImage(img, 0, 0);
      const dd = (c2.getContext('2d') as any).getImageData(0, 0, w, h);
      ent = { d: dd.data, w, h };
      texelCache.set(map.uuid, ent);
    }
    const x = Math.min(w - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((1 - (((v % 1) + 1) % 1)) * h)));
    const i = (y * w + x) * 4;
    rawMin = Math.min(ent.d[i], ent.d[i + 1], ent.d[i + 2]) / 255;
    out.setRGB(toLin(ent.d[i] / 255), toLin(ent.d[i + 1] / 255), toLin(ent.d[i + 2] / 255));
    return true;
  };

  interface Tri {
    pts: number[]; zs: number[]; uvs: number[]; tex: THREE.Texture | null;
    rgb: [number, number, number]; lin: [number, number, number]; clip?: boolean; id?: number
  }
  const tris: Tri[] = [];
  const meshIds: number[] = [];
  let meshes = 0, shells = 0, instanced = 0, hidden = 0, nanMeshes = 0, clipped = 0;
  /** Marking texels under the quads the camera can actually see. Per-texel
   *  rather than per-pixel on purpose: a 120 mm line crossed by a 1.6 m shading
   *  quad is a few percent of that quad's colour, which is why the paint below
   *  cannot be the judge of whether the lines are there. */
  let markSamples = 0, markWhite = 0;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const toScreen = (v: THREE.Vector3): [number, number, number] => {
    const p = v.clone().project(camera);
    return [(p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H, p.z];
  };

  /* A mesh is only drawn if NOTHING between it and the scene has been switched
   * off — the same rule `WebGLRenderer.render` applies, and the reason this
   * harness has to apply it too: a group's `visible = false` is how the game hides
   * a squad (retired pool slots, the stand-in handover, a torn-down episode), and
   * `traverse` walks straight through those groups. An audit that paints a body
   * the renderer would skip is an audit that passes a black screen. Proved by
   * `--mutate nobodies`, which was invisible to this file until the flag was
   * parsed correctly and this loop started climbing. */
  const drawn = (o: THREE.Object3D | null): boolean => {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) return;
    if (!drawn(o)) { hidden++; return; }
    if ((o as THREE.InstancedMesh).isInstancedMesh) { instanced++; return; }   // crowd: counted, not painted
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    if (!mat) return;
    if (mat.side === THREE.BackSide) { shells++; return; }                      // sky dome and hall: a shell, not an object
    const geo = m.geometry as THREE.BufferGeometry;
    const pos = geo?.attributes?.position;
    if (!geo || !pos) { meshes++; return; }
    if (!Number.isFinite(m.matrixWorld.elements[12] + m.matrixWorld.elements[13] + m.matrixWorld.elements[14])) { nanMeshes++; return; }
    let myId = meshIds.length;
    const ownerName = nameOf(o);
    kinds.push(kindOf(ownerName));
    ownerNames.push(ownerName);
    meshIds.push(myId);
    const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    const bc = mat.color ?? new THREE.Color(1, 1, 1);
    const baseColor = new THREE.Color(toLin(bc.r), toLin(bc.g), toLin(bc.b));
    const tx = mat.map ?? null;
    meshes++;
    for (let t = 0; t + 2 < count; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      va.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld);
      vb.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld);
      vc.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      const a = toScreen(va), b = toScreen(vb), c = toScreen(vc);
      // Behind the near plane or outside NDC: three's own clipper does better,
      // and for a coverage metric a triangle that leaves the frame is dropped.
      if (a[2] > 1 || b[2] > 1 || c[2] > 1) continue;
           if (Math.max(a[0], b[0], c[0]) < 0 || Math.min(a[0], b[0], c[0]) > W) continue;
      if (Math.max(a[1], b[1], c[1]) < 0 || Math.min(a[1], b[1], c[1]) > H) continue;
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
           if (area < 0.02) continue;
      e1.copy(vb).sub(va); e2.copy(vc).sub(va); nrm.crossVectors(e1, e2).normalize();
      const ndl = Math.max(0, nrm.dot(keyDir));
      const hemi = 0.5 + 0.5 * nrm.y;
      /* The same irradiance model lookprobe.ts documents: key over PI, a
       * hemisphere floor, ambient, and the sky an environment map would have
       * contributed. Anything that lands above 1 here is a CLIPPED pixel in the
       * real frame, which is a finding, not a rounding error. */
      const irradiance = new THREE.Color()
        .add(keyCol.clone().multiplyScalar(ndl / Math.PI))
        .add(hemiSky.clone().multiplyScalar(hemi).add(hemiGround.clone().multiplyScalar(1 - hemi)))
        .add(ambCol)
        .add(iblSky.clone().multiplyScalar(hemi).add(iblGround.clone().multiplyScalar(1 - hemi)).multiplyScalar(1 / Math.PI));
      const col = baseColor.clone().multiply(irradiance).multiplyScalar(cond.exposure);
      /* The texture is NOT folded in here. It is read per pixel in the raster
       * below, and the only thing sampled at triangle level is the STATISTIC
       * that says whether the markings are in the frame at all. */
      if (tx && uv) {
        const ua = uv.getX(i0), ub = uv.getX(i1), uc = uv.getX(i2);
        const va = uv.getY(i0), vbv = uv.getY(i1), vc2 = uv.getY(i2);
        const u0 = Math.min(ua, ub, uc), u1 = Math.max(ua, ub, uc);
        const v0 = Math.min(va, vbv, vc2), v1 = Math.max(va, vbv, vc2);
        if (m.name === 'InnerPitch' && (u1 - u0 > 0.0002 || v1 - v0 > 0.0002)) {
          for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
            const u = u0 + (u1 - u0) * ((sx + 0.5) / 4);
            const v = v0 + (v1 - v0) * ((sy + 0.5) / 4);
            if (texelAt(tx, u, v, scratch)) { markSamples++; if (rawMin > 0.72) markWhite++; }
          }
        }
      }
      const uvOf = (i: number): [number, number] =>
        (uv ? [uv.getX(i), uv.getY(i)] : [0, 0]);
      const [ua0, vap] = uvOf(i0), [ua1, vap1] = uvOf(i1), [ua2, vap2] = uvOf(i2);
      tris.push({
        pts: [a[0], a[1], b[0], b[1], c[0], c[1]],
        zs: [a[2], b[2], c[2]],
        uvs: [ua0, vap, ua1, vap1, ua2, vap2],
        lin: [col.r, col.g, col.b] as [number, number, number],
        rgb: [encode(col.r), encode(col.g), encode(col.b)] as [number, number, number],
        tex: (tx && uv) ? tx : null,
        id: myId,
        clip: Math.max(col.r, col.g, col.b) > 1,
      });
      if (Math.max(col.r, col.g, col.b) > 1) clipped++;
    }
  });

  /* Rasterise by hand, into a framebuffer with a depth test. Three.js will not
   * do it for us without a GL context and Skia will not do 3D, so this is the
   * minimum honest version: one triangle at a time, barycentric coverage, a z
   * buffer, and the game's own texture under the game's own UVs. */
  for (const t of tris) {
    const [x0, y0, x1, y1, x2, y2] = t.pts;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(den) < 1e-6) continue;
    const inv = 1 / den;
    const [z0, z1, z2] = t.zs;
    const [ux0, vy0, ux1, vy1, ux2, vy2] = t.uvs;
    const r0 = t.rgb[0], g0 = t.rgb[1], b0 = t.rgb[2];
    for (let py = minY; py <= maxY; py++) {
      const row = py * W;
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const w0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) * inv;
        if (w0 < -0.001) continue;
        const w1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) * inv;
        if (w1 < -0.001) continue;
        const w2 = 1 - w0 - w1;
        if (w2 < -0.001) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const i = row + px;
        if (z >= zbuf[i]) continue;
        zbuf[i] = z;
        let r = r0, gg = g0, b = b0;
        if (t.tex) {
          /* Per-pixel texel: this is what makes a 120 mm touchline one line wide
           * instead of one shading quad wide, which is the difference between
           * "a marking texture is bound" and "the lines can be read from here". */
          const u = w0 * ux0 + w1 * ux1 + w2 * ux2;
          const v = w0 * vy0 + w1 * vy1 + w2 * vy2;
          if (texelAt(t.tex, u, v, scratch)) {
            const li = t.lin;
            r = encode(li[0] * scratch.r);
            gg = encode(li[1] * scratch.g);
            b = encode(li[2] * scratch.b);
          }
        }
        const o = i * 4;
        fb[o] = r; fb[o + 1] = gg; fb[o + 2] = b; fb[o + 3] = 255;
        owner[i] = t.id ?? 0;
      }
    }
  }
  {
    const img = (g2 as any).createImageData(W, H);
    (img.data as Uint8ClampedArray).set(fb);
    (g2 as any).putImageData(img, 0, 0);
  }

  const png = sheet.toBuffer('image/png');
  const name = MUTATE ? `scene-${MUTATE}` : 'scene';
  fs.writeFileSync(`${OUT}/${name}.png`, png);
  /* A 2x copy for looking at on a retina screen without pixel-peeping. */
  const big = makeCanvas(W * 2, H * 2);
  (big.getContext('2d') as any).imageSmoothingEnabled = false;
  (big.getContext('2d') as any).drawImage(sheet, 0, 0, W, H, 0, 0, W * 2, H * 2);
  fs.writeFileSync(`${OUT}/${name}-big.png`, big.toBuffer('image/png'));

  /* --------------------------------------------------- 5. measure the frame -- */
  const px = (sheet.getContext('2d') as any).getImageData(0, 0, W, H).data as Uint8ClampedArray;
  let painted = 0, green = 0, white = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    if (r === 1 && gg === 2 && b === 3) continue;
    painted++;
    if (gg > r * 1.12 && gg > b * 1.12) green++;
    if (r > 190 && gg > 190 && b > 180) white++;
  }
  const total = W * H;
  const cov = painted / total, greenShare = green / total, lineShare = white / total;
  let pitchPixels = 0, groundPixels = 0, bodyPixels = 0, ballPixels = 0;
  const bodiesPainted = new Set<string>();
  for (let i = 0; i < W * H; i++) {
    const id = owner[i];
    const k = kinds[id] ?? 0;
    if (k === KIND_PITCH) pitchPixels++;
    else if (k === KIND_GROUND) groundPixels++;
    else if (k === KIND_BODY) { bodyPixels++; bodiesPainted.add(ownerNames[id]); }
    else if (k === KIND_BALL) ballPixels++;
  }
  const pitchShare = pitchPixels / total, bodyShare = bodyPixels / total;

  /* Pitch geometry, from the same scene, without the raster. */
  const inner = scene.getObjectByName('InnerPitch') as THREE.Mesh | undefined;
  const outer = scene.getObjectByName('OuterGround') as THREE.Mesh | undefined;
  const pitchMat = inner?.material as THREE.MeshStandardMaterial | undefined;
  const pitchTexels = (pitchMat?.map?.image as any)?.width ?? 0;

  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  let inView = 0, finiteActors = 0, outOfBounds = 0;
  const p = new THREE.Vector3();
  const bodies = (mgr as any).standIn as Map<string, THREE.Group>;
  for (const a of d.actors) {
    p.set(a.rx * 1.65, 1, -a.rz * 1.65);
    if (!Number.isFinite(p.x + p.y + p.z)) finiteActors++;
    if (Math.abs(a.rx) > 41 || Math.abs(a.rz) > 68) outOfBounds++;
    if (frustum.containsPoint(p)) inView++;
  }
  const ballObj = scene.getObjectByName('Ball3D') as THREE.Object3D | undefined;
  const ballVisible = !!ballObj?.visible;
  const ballWorld = ballObj ? ballObj.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
  const ballInView = !ballVisible || frustum.containsPoint(ballWorld);
  /* Held ball: it is parented to a hand, so it is on screen exactly when its
   * carrier is. Ask that instead of asking for a free ball that is not there. */
  const carrierInView = inView > 0;

  /* FRAMING. "Inside the frustum" is not "big enough to see": a man 70 m away
   * is four pixels and a broadcast shot is not that. Measured here as the
   * screen height of the tallest body and the share of bodies that land in the
   * frame at all, because UX-23 style complaints — the ruck is off the bottom
   * of the screen, the backpedalling nine is alone in shot — are geometry
   * failures, and this is the only place in the repo that can see them. */
  let tallest = 0, onScreen = 0;
  const top = new THREE.Vector3(), foot = new THREE.Vector3();
  for (const a of d.actors) {
    foot.set(a.rx * 1.65, 0, -a.rz * 1.65);
    top.set(a.rx * 1.65, 1.85 * 1.65, -a.rz * 1.65);
    const f = foot.clone().project(camera), t2 = top.clone().project(camera);
    if (Math.abs(f.x) > 1 || Math.abs(f.y) > 1 || f.z > 1) continue;
    onScreen++;
    tallest = Math.max(tallest, Math.abs((t2.y - f.y) * 0.5 * H));
  }

  console.log(`sceneaudit — ${shot}, ${W}x${H}, camera from the production syncCamera`);
  const camLog = d.cam as unknown as Record<string, number>;
  console.log(`  camera: x ${camLog.x.toFixed(1)} z ${camLog.z.toFixed(1)} h ${camLog.h.toFixed(1)}`
    + ` yaw ${(camLog.yaw * 180 / Math.PI).toFixed(0)}° tilt ${(camLog.tilt * 180 / Math.PI).toFixed(1)}°`
    + ` fov ${(camLog.fov * 180 / Math.PI).toFixed(1)}° horizon ${camLog.horizon.toFixed(2)}`);
  const bdAny = d.bd as unknown as { x?: number; z?: number; stage?: string } | undefined;
  if (bdAny) console.log(`  ruck at (${(bdAny.x ?? 0).toFixed(1)}, ${(bdAny.z ?? 0).toFixed(1)}) stage ${bdAny.stage}`
    + ` · distance from camera ${Math.hypot(camLog.x - (bdAny.x ?? 0), camLog.z - (bdAny.z ?? 0)).toFixed(1)} m`);
  console.log(`  bodies on screen ${onScreen}/${d.actors.length}, tallest ${tallest.toFixed(0)} px`);
  if (process.env.DEBUG) {
    /* One body, measured end to end: where its group is, what its own geometry
     * projects to, and what the triangle area gate does with it. Written out
     * rather than inferred from the aggregate because the aggregate said
     * "31 bodies exist, 0 bodies have pixels" and only the raw numbers could
     * say which of the two statements was the lie. */
    const probe = (mgr as any).standIn as Map<string, THREE.Group>;
    let n = 0;
    for (const [, g] of probe) {
      if (n++ > 2) break;
      let kept = 0, seen = 0, maxArea = 0;
      g.traverse((o: THREE.Object3D) => {
        const mm = o as THREE.Mesh;
        if (!mm.isMesh) return;
        const gp = mm.geometry as THREE.BufferGeometry;
        const pp = gp.attributes.position; const id2 = gp.index;
        const cnt = id2 ? id2.count : pp.count;
        for (let t = 0; t + 2 < cnt; t += 3) {
          const i0 = id2 ? id2.getX(t) : t, i1 = id2 ? id2.getX(t + 1) : t + 1, i2 = id2 ? id2.getX(t + 2) : t + 2;
          const v = [0, 1, 2].map((_, j) => {
            const iii = [i0, i1, i2][j];
            return new THREE.Vector3().fromBufferAttribute(pp, iii).applyMatrix4(mm.matrixWorld).project(camera);
          });
          seen++;
          const px = v.map((q) => (q.x * 0.5 + 0.5) * W), py = v.map((q) => (1 - (q.y * 0.5 + 0.5)) * H);
          const area = Math.abs((px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]));
          maxArea = Math.max(maxArea, area);
          if (area >= 0.02 && v.every((q) => Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1 && q.z <= 1)) kept++;
        }
      });
      const wp = g.getWorldPosition(new THREE.Vector3());
      console.log(`  DEBUG ${g.name}: world ${wp.toArray().map((x: number) => x.toFixed(1)).join(',')} `
        + `tris ${seen} kept ${kept} maxArea ${maxArea.toFixed(2)} parentVisible ${g.parent?.visible} visible ${g.visible}`);
    }
  }
  if (process.env.DEBUG) {
    const byKind = new Map<number, number>();
    for (const t of tris) byKind.set(kinds[t.id ?? 0], (byKind.get(kinds[t.id ?? 0]) || 0) + 1);
    console.log('  DEBUG triangles by kind:', [...byKind.entries()].map(([k, n]) => `${k}:${n}`).join(' '));
    const g0 = (mgr as any).standIn.values().next().value as THREE.Group;
    console.log('  DEBUG first body group:', g0.name, 'visible', g0.visible, 'pos', g0.position.toArray().map(x => x.toFixed(1)).join(','),
      'children', g0.children.length, 'worldPos', g0.getWorldPosition(new THREE.Vector3()).toArray().map(x => x.toFixed(1)).join(','));
    const m0 = g0.children[0] as THREE.Mesh;
    const bb = new THREE.Box3().setFromObject(g0);
    const c0 = bb.getCenter(new THREE.Vector3()).project(camera);
    console.log('  DEBUG body bbox', bb.min.toArray().map(x=>x.toFixed(0)).join(','), '→', bb.max.toArray().map(x=>x.toFixed(0)).join(','),
      'centre ndc', c0.toArray().map(x=>x.toFixed(3)).join(','), 'mesh0 geo', (m0.geometry as THREE.BufferGeometry).attributes.position.count);
  }
  console.log(`  painted ${tris.length.toLocaleString()} triangles · ${meshes} meshes · ${instanced} instanced`
    + ` · ${shells} shells · ${hidden} hidden · ${clipped} clipped to white\n`);

  /* THE CHECKS RUN IN BOTH MODES. They used to be skipped entirely on a mutation
   * run, with a hand-written copy of the same predicates deciding whether the
   * mutation had been noticed — and a copy drifts: `--mutate sinkpitch` buried the
   * turf 0.65 m, the real 'pitch is above the outer ground' check screamed, and the
   * self-test reported NOTHING FAILED because its private list of six expressions
   * did not include that one. A mutation harness that grades itself against a
   * shadow of the contract is decoration with extra steps. Now: same checks, and the
   * self-test only asks the one question a mutation test should ask — did
   * something fire? */
  const failsBefore = failures;
  {
    check('environment built the world', !!env, env ? 'ThreeEnvironment constructed' : 'no environment');
    check('no render faults recorded', renderHealth.faults === 0, `faults ${renderHealth.faults}${renderHealth.log[0] ? ` — ${renderHealth.log[0]}` : ''}`);
    check('pitch mesh exists and is visible', !!inner && inner.visible, inner ? `y ${inner.position.y.toFixed(2)}` : 'InnerPitch missing');
    check('turf texture is bound to the pitch', !!pitchTexels, `${pitchTexels}px texture${pitchTexels ? '' : ' — material is untextured'}`);
    check('pitch is above the outer ground', !!inner && !!outer && inner.position.y >= outer.position.y - 1e-6,
      inner && outer ? `pitch ${inner.position.y.toFixed(2)} vs ground ${outer.position.y.toFixed(2)}` : 'n/a');
    const markingShare = markWhite / Math.max(1, markSamples);
    check('the turf is the surface on screen', pitchShare > 0.25,
      `pitch owns ${(pitchShare * 100).toFixed(1)}% of pixels, ground ${(groundPixels / total * 100).toFixed(1)}%`);
    check('the markings are readable', lineShare > 0.003, `marking-white pixels ${(lineShare * 100).toFixed(2)}%`);
    check('the men are on the turf, not just in the graph',
      bodiesPainted.size >= Math.max(10, d.actors.length - 10) && bodyShare > 0.004,
      `${bodiesPainted.size}/${d.actors.length} bodies have pixels, ${(bodyShare * 100).toFixed(2)}% of the frame`);
    check('the ball has pixels', ballPixels > 0 || !ballVisible, `${ballPixels} ball pixels${ballVisible ? '' : ' (held: parented to a hand)'}`);
    check('markings land in the frame', markingShare > 0.002 && markSamples > 2000,
      `${(markingShare * 100).toFixed(2)}% of ${markSamples.toLocaleString()} visible pitch texels are marking-white`);
    check('the field is green, not void', greenShare > 0.08, `green pixels ${(greenShare * 100).toFixed(1)}%`);
    check('surface covers the frame', cov > 0.25, `coverage ${(cov * 100).toFixed(1)}%`);
    check('every actor has a body drawn', bodies.size >= d.actors.length - 1, `${bodies.size} bodies / ${d.actors.length} actors`);
    check('no actor outside the pitch', outOfBounds === 0, `${outOfBounds} out of bounds`);
    check('camera frames the pack', inView >= 10, `${inView}/${d.actors.length} actors inside the frustum`);
    check('ball is in the frame', ballInView && (ballVisible ? true : carrierInView),
      ballObj ? `${ballVisible ? `free at ${ballWorld.x.toFixed(0)},${ballWorld.z.toFixed(0)}` : 'held — parented to a man on screen'}` : 'no ball object');
    check('a man is big enough to read', tallest > 18,
      `${onScreen}/${d.actors.length} bodies in shot, tallest ${tallest.toFixed(0)} px in a ${H}-row frame`);
    /* The lens, not the frame. `tallest` depends on where the rig happens to be
     * mid-ease when the harness stops, which makes it a floor and not a
     * measurement of intent. The intent is a rule about phases, so it is asserted
     * as one: in at a contest, out in transition. A pixel number cannot say that
     * and a number that cannot say the thing under test is how a harness goes
     * green while the game is wrong. */
    const ck = (await import('../src/game/engine/camera.ts')).contestK(d);
    const wantTight = shot === 'a ruck';
    check(wantTight ? 'the lens comes in at the contest' : 'the lens stays wide in transition',
      wantTight ? ck > 0.85 : ck < 0.6,
      `contestK ${ck.toFixed(2)} × camScale ${(d as any).camScale} at ${shot}`);
    check('no NaN in any world matrix', nanMeshes === 0, `${nanMeshes} meshes with non-finite positions`);
    check('stand-in bodies carry the ball state', !!(mgr as any).ball || !!ballObj, ballObj ? `Ball3D ${ballObj.visible ? 'visible' : 'hidden (held)'}` : 'missing');
    console.log(`\n  frame ${name}.png  ·  mean coverage ${(cov * 100).toFixed(1)}%  green ${(greenShare * 100).toFixed(1)}%  line ${(lineShare * 100).toFixed(2)}%`);
    console.log(`  ${failures ? `${failures} FAIL — the picture is wrong, look at ${OUT}/${name}-big.png` : 'PASS — a match is on screen'}`);
  }
  if (MUTATE) {
    /* the ONE question: a broken scene must be RED. The mutation's own numbers are
     * printed above, so a failure to notice is diagnosable rather than mysterious. */
    check(`audit notices the ${MUTATE} break`, failures > failsBefore,
      failures > failsBefore ? `${failures - failsBefore} real check(s) fired` : 'NOTHING FAILED — this harness is decoration');
    if (failures > failsBefore) console.log(`  mutation ${MUTATE}: caught by the shipped checks, not by a copy of them`);
  }  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error('sceneaudit crashed:', (e as Error).stack || e); process.exitCode = 2; });
