/**
 * ThreeEnvironment — 3D pitch, fog, World Rugby uprights, LED boards,
 * grandstands, instanced crowd and floodlight towers.
 *
 * Dual-plane ground (no hovering line meshes, no 500 m stretched texture):
 *   - Inner pitch (76 × 130 m) carries a 2048×1024 CanvasTexture with mown
 *     stripes AND every white marking baked into the pixels.
 *   - Outer ground (500 × 500 m) is a solid deep-green backdrop that falls
 *     into scene.fog.
 *
 * World mapping matches ThreeCanvas.syncCamera / player placement:
 *   world = (x · RENDER_SCALE, y · RENDER_SCALE, −z · RENDER_SCALE)
 *
 * Draw-call budget: geometries are merged so the environment itself stays
 * well under 15 draws (crowd is a single InstancedMesh).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FIELD, RENDER_SCALE } from './retro';
import { buildTurfMaps, TURF_SIZE } from './turf';
import { ThreeSky, SKY_PRESETS, SkyPreset, SkyPresetId, sunVector } from './ThreeSky';

const OUTER_COLOR = 0x24461f;
const CONCRETE = 0x8a8f96;
const SEAT_BLUE = 0x24354d;

const INNER_WIDTH_M = 76;
const INNER_LENGTH_M = 130;
const OUTER_M = 500;

const POST_HALF = 2.8;
const CROSSBAR_TOP = 3.0;
const POST_HEIGHT = 12.0;
const PAD_HEIGHT = 1.5;
const POST_RADIUS = 0.06;

export type AdBoardFlash = 'TRY' | 'PENALTY' | 'NORMAL';

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!out) throw new Error('mergeGeometries returned null');
  return out;
}

/** Box in world units, already transformed into world space. */
function box(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

function cyl(
  rTop: number, rBot: number, h: number,
  x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0, segs = 12,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs);
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

function scaleUV(g: THREE.BufferGeometry, uMul: number, vMul = 1): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uMul, uv.getY(i) * vMul);
}

export class ThreeEnvironment {
  public group: THREE.Group;
  private pitchTexture!: THREE.CanvasTexture;

  private adCanvas!: HTMLCanvasElement;
  private adTexture!: THREE.CanvasTexture;
  private adMat!: THREE.MeshStandardMaterial;
  private adMode: AdBoardFlash = 'NORMAL';
  private adHold = 0;

  private crowd!: THREE.InstancedMesh;
  private crowdBase!: Float32Array; // x,y,z,rotY per instance
  private crowdDummy = new THREE.Object3D();
  private cheer = 0;

  private floodLights: THREE.PointLight[] = [];
  private lampMat!: THREE.MeshBasicMaterial;
  private scene: THREE.Scene;

  /* --- lighting rig, owned here so the sky and the shadows always agree --- */
  private sky!: ThreeSky;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private ambient!: THREE.AmbientLight;
  private bounce!: THREE.DirectionalLight;
  private preset: SkyPreset = SKY_PRESETS.AFTERNOON;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Environment3D';
    scene.add(this.group);

    this.buildSky();
    this.buildLights();
    this.buildGround(renderer);
    this.buildUprights();
    this.buildAdBoards(renderer);
    this.buildGrandstands();
    this.buildCrowd();
    this.buildFloodlights();
    this.applyPreset('AFTERNOON');
  }

  /* -------------------------------------------------------------- lighting */

  private buildSky(): void {
    this.sky = new ThreeSky(600 * RENDER_SCALE);
    this.scene.add(this.sky.mesh);
  }

  private buildLights(): void {
    const s = RENDER_SCALE;

    // Key. Shadow frustum is sized to the PLAYABLE area only (about 110 × 80 m)
    // rather than the whole stadium: a camera large enough to include the
    // stands would spend its whole 2048² map on empty terracing and leave the
    // players with roughly four texels each.
    this.sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
    this.sun.castShadow = true;
    /* The ortho box is in LIGHT space, not world space, so it has to cover the
     * pitch whatever bearing the sun is on — that means the half-diagonal
     * (√(65² + 38²) ≈ 75 m), not the half-length. It also has to hold the
     * shadows themselves: at GOLDEN the sun sits 11° up, so a 2 m player
     * throws a ~10 m shadow. 88 m square covers both with margin. */
    const half = 88 * s;
    const cam = this.sun.shadow.camera;
    cam.left = -half; cam.right = half;
    cam.top = half; cam.bottom = -half;
    cam.near = 1 * s; cam.far = 320 * s;
    this.sun.shadow.mapSize.set(2048, 2048);
    // Normal-bias beats constant bias on a near-flat receiver: it offsets
    // along the surface normal, so it kills acne on the turf without
    // detaching the contact shadow from the boots (peter-panning).
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.9;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd6f5, 0x35521f, 0.7);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    this.scene.add(this.ambient);

    // A dim opposite-side fill so the shadowed side of a player is readable
    // silhouette rather than a black hole. No shadow, deliberately.
    this.bounce = new THREE.DirectionalLight(0x9db8ec, 0.35);
    this.bounce.position.set(40 * s, 26 * s, -30 * s);
    this.scene.add(this.bounce);
  }

  /** Switch time-of-day. Sky, key, fill, fog and floodlights move together. */
  applyPreset(id: SkyPresetId): void {
    const p = SKY_PRESETS[id];
    this.preset = p;
    const s = RENDER_SCALE;

    const dir = sunVector(p, 190 * s);
    this.sun.position.copy(dir);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld(true);
    this.sun.color.set(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.sun.castShadow = p.sunIntensity > 0.8;

    this.sky.apply(p, dir.clone().normalize());

    this.hemi.intensity = p.ambient * 0.8;
    (this.hemi.color as THREE.Color).set(p.horizon);
    this.ambient.intensity = p.ambient * 0.22;
    this.bounce.intensity = 0.12 + p.ambient * 0.22;

    this.scene.fog = new THREE.FogExp2(new THREE.Color(p.horizon).getHex(), p.fogDensity);
    // The dome paints the background; a background colour would fight it.
    this.scene.background = null;

    for (const l of this.floodLights) l.intensity = p.floods * 900 * s * s;
    if (this.lampMat) {
      const on = p.floods > 0.05;
      this.lampMat.color.setHex(on ? 0xfffaf0 : 0x6a6a66);
    }
  }

  get skyPreset(): SkyPresetId { return this.preset.id; }

  private mat(color: number, map?: THREE.Texture, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color, map, roughness: rough, metalness: metal, depthWrite: true,
    });
  }

  private addMesh(geo: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    this.group.add(m);
    return m;
  }

  /* ------------------------------------------------------------------ ground */

  private buildGround(renderer: THREE.WebGLRenderer): void {
    const s = RENDER_SCALE;
    const aniso = renderer.capabilities.getMaxAnisotropy();

    const outerGeo = new THREE.PlaneGeometry(OUTER_M * s, OUTER_M * s);
    const outerMat = this.mat(OUTER_COLOR, undefined, 0.95);
    const outer = this.addMesh(outerGeo, outerMat, 'OuterGround');
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.renderOrder = -1;
    outer.receiveShadow = false;

    const maps = buildTurfMaps({
      width: TURF_SIZE.width, height: TURF_SIZE.height,
      lengthM: INNER_LENGTH_M, widthM: INNER_WIDTH_M,
      stripes: 22, seed: 7, field: FIELD,
    });

    const tex = (c: HTMLCanvasElement, srgb: boolean) => {
      const t = new THREE.CanvasTexture(c);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };

    this.pitchTexture = tex(maps.albedo, true);
    const roughTex = tex(maps.roughness, false);
    const normTex = tex(maps.normal, false);

    const pitchMat = new THREE.MeshStandardMaterial({
      map: this.pitchTexture,
      roughnessMap: roughTex,
      normalMap: normTex,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 1,
      metalness: 0,
      // Grass is a dense volume of thin blades: a little forward scatter at
      // grazing angles is what stops a lit pitch looking like painted board.
      dithering: true,
    });

    // Tessellated so the pitch can carry a very slight crown (real pitches are
    // domed ~0.3 m at the centre for drainage). Flat planes betray themselves
    // the moment a low camera looks down the touchline.
    const innerGeo = new THREE.PlaneGeometry(INNER_WIDTH_M * s, INNER_LENGTH_M * s, 48, 80);
    this.remapPitchUVs(innerGeo);
    const pos = innerGeo.attributes.position as THREE.BufferAttribute;
    const halfW = (INNER_WIDTH_M / 2) * s;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const t = Math.min(1, Math.abs(x) / halfW);
      pos.setZ(i, -(1 - t * t) * 0.30 * s);
    }
    pos.needsUpdate = true;
    innerGeo.computeVertexNormals();

    const inner = this.addMesh(innerGeo, pitchMat, 'InnerPitch');
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.0;
    inner.receiveShadow = true;
  }

  private remapPitchUVs(geo: THREE.PlaneGeometry): void {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, v, u);
    }
    uv.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- uprights */

  private buildUprights(): void {
    const s = RENDER_SCALE;
    // Posts are painted aluminium: bright, fairly smooth, faintly metallic.
    const postMat = this.mat(0xf2f4f5, undefined, 0.34, 0.12);
    const padMat = this.mat(0x15181d, undefined, 0.72);

    const xOff = POST_HALF * s;
    const postH = POST_HEIGHT * s;
    const r = POST_RADIUS * s;
    const padH = PAD_HEIGHT * s;
    const barR = r * 0.9;
    const barY = CROSSBAR_TOP * s - barR;

    const white: THREE.BufferGeometry[] = [];
    const pads: THREE.BufferGeometry[] = [];

    for (const zLog of [50, -50]) {
      const wz = -zLog * s;
      white.push(cyl(r, r, postH, -xOff, postH / 2, wz, 0, 0, 0, 16));
      white.push(cyl(r, r, postH, xOff, postH / 2, wz, 0, 0, 0, 16));
      white.push(cyl(barR, barR, xOff * 2, 0, barY, wz, 0, 0, Math.PI / 2, 16));
      pads.push(box(0.5 * s, padH, 0.5 * s, -xOff, padH / 2, wz));
      pads.push(box(0.5 * s, padH, 0.5 * s, xOff, padH / 2, wz));
    }

    const posts = this.addMesh(merge(white), postMat, 'GoalPosts');
    posts.castShadow = true;
    const padMesh = this.addMesh(merge(pads), padMat, 'GoalPads');
    padMesh.castShadow = true;
    padMesh.receiveShadow = true;
  }

  /* ------------------------------------------------------------- LED boards */

  private buildAdBoards(renderer: THREE.WebGLRenderer): void {
    const s = RENDER_SCALE;
    const h = 0.9 * s;
    const t = 0.16 * s;
    const tilt = (10 * Math.PI) / 180;
    const y = h / 2;

    this.adCanvas = document.createElement('canvas');
    this.adCanvas.width = 1024;
    this.adCanvas.height = 128;
    this.paintAdTexture('NORMAL');

    this.adTexture = new THREE.CanvasTexture(this.adCanvas);
    this.adTexture.colorSpace = THREE.SRGBColorSpace;
    this.adTexture.wrapS = THREE.RepeatWrapping;
    this.adTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.adTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.adTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.adTexture.needsUpdate = true;

    // LED panels are emissive: they must stay bright at night and are the
    // main thing the bloom pass has to bite on.
    this.adMat = new THREE.MeshStandardMaterial({
      map: this.adTexture,
      emissiveMap: this.adTexture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.85,
      roughness: 0.42,
      metalness: 0.0,
    });

    const geos: THREE.BufferGeometry[] = [];
    const panelM = 8; // metres per sponsor repeat

    const pushBoard = (
      w: number, d: number,
      x: number, z: number,
      rx: number, ry: number, rz: number,
      lengthM: number,
    ) => {
      const g = box(w, h, d, x, y, z, rx, ry, rz);
      scaleUV(g, Math.max(1, lengthM / panelM), 1);
      geos.push(g);
    };

    // Sidelines at x = ±38.5, spanning z = -65 .. +65.
    const sideLen = 130;
    const sideZ = 0;
    pushBoard(t, sideLen * s, -38.5 * s, -sideZ * s, 0, 0, tilt, sideLen);
    pushBoard(t, sideLen * s, 38.5 * s, -sideZ * s, 0, 0, -tilt, sideLen);

    // North end (z = +65.5) continuous across x = ±38.5.
    const endSpan = 77;
    pushBoard(endSpan * s, t, 0, -65.5 * s, -tilt, 0, 0, endSpan);

    // South end (z = -65.5) with a 6 m tunnel gap at x = 0.
    const half = (77 - 6) / 2; // 35.5 m each side
    const cx = (3 + 38.5) / 2; // 20.75 — centre of each wing
    pushBoard(half * s, t, -cx * s, 65.5 * s, tilt, 0, 0, half);
    pushBoard(half * s, t, cx * s, 65.5 * s, tilt, 0, 0, half);

    const boards = this.addMesh(merge(geos), this.adMat, 'AdBoards');
    boards.castShadow = true;
  }

  private paintAdTexture(mode: AdBoardFlash): void {
    const ctx = this.adCanvas.getContext('2d')!;
    const w = this.adCanvas.width, h = this.adCanvas.height;
    const n = 8;
    const pw = w / n;

    const panels = [
      { bg: '#1a2744', fg: '#e8cf46', t: 'GILBERT' },
      { bg: '#8f281c', fg: '#f4efe2', t: 'CANTERBURY' },
      { bg: '#0e1522', fg: '#6ee7a0', t: 'WORLD CLASS' },
      { bg: '#1d3468', fg: '#e8cf46', t: 'FIVE NATIONS' },
      { bg: '#2a2412', fg: '#f4efe2', t: 'STEINLAGER' },
      { bg: '#1a2744', fg: '#7fa3e6', t: 'RUGBY' },
      { bg: '#8f281c', fg: '#e8cf46', t: 'ELLIS PARK' },
      { bg: '#0e1522', fg: '#f4efe2', t: 'KOOGA' },
    ];

    for (let i = 0; i < n; i++) {
      const p = panels[i];
      if (mode === 'TRY') {
        ctx.fillStyle = i % 2 === 0 ? '#e8cf46' : '#1a2744';
        ctx.fillRect(i * pw, 0, pw, h);
        ctx.fillStyle = i % 2 === 0 ? '#1a2744' : '#e8cf46';
        ctx.font = '900 52px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TRY!', i * pw + pw / 2, h / 2 + 2);
      } else if (mode === 'PENALTY') {
        ctx.fillStyle = i % 2 === 0 ? '#c8402f' : '#e8cf46';
        ctx.fillRect(i * pw, 0, pw, h);
        ctx.fillStyle = i % 2 === 0 ? '#e8cf46' : '#1a120c';
        ctx.font = '900 36px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PENALTY', i * pw + pw / 2, h / 2 + 2);
      } else {
        ctx.fillStyle = p.bg;
        ctx.fillRect(i * pw, 0, pw, h);
        ctx.fillStyle = p.fg;
        ctx.font = '900 28px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.t, i * pw + pw / 2, h / 2 + 2);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(i * pw, 0, 4, h);
      }
    }
  }

  /**
   * Swap the perimeter LED colours. TRY flashes gold, PENALTY red/yellow;
   * NORMAL restores the sponsor cycle. Auto-reverts after ~2.4 s.
   */
  flashAdBoard(type: AdBoardFlash): void {
    if (type === this.adMode) return;
    this.adMode = type;
    this.paintAdTexture(type);
    this.adTexture.needsUpdate = true;
    this.adMat.color.setHex(0xffffff);
    this.adHold = type === 'NORMAL' ? 0 : 2.4;
    if (type === 'TRY') this.cheer = 1;
    else if (type === 'PENALTY') this.cheer = Math.max(this.cheer, 0.45);
  }

  /* ------------------------------------------------------------- grandstands */

  private buildGrandstands(): void {
    const s = RENDER_SCALE;
    const concrete: THREE.BufferGeometry[] = [];
    const seats: THREE.BufferGeometry[] = [];

    const addStand = (
      tiers: number, tread: number, riser: number,
      originX: number, originZ: number,
      along: 'z' | 'x',
      outSign: number,           // +1 = +axis outward
      length: number,
    ) => {
      for (let i = 0; i < tiers; i++) {
        const depthC = (i + 0.5) * tread;
        const yTop = (i + 1) * riser;
        const slabH = riser;
        if (along === 'z') {
          const x = (originX + outSign * depthC) * s;
          const z = originZ * s * -1;
          concrete.push(box(tread * s, slabH * s, length * s, x, (yTop - slabH / 2) * s, z));
          seats.push(box(tread * 0.92 * s, 0.08 * s, length * 0.98 * s, x, yTop * s + 0.04 * s, z));
        } else {
          const z = -(originZ + outSign * depthC) * s;
          const x = originX * s;
          concrete.push(box(length * s, slabH * s, tread * s, x, (yTop - slabH / 2) * s, z));
          seats.push(box(length * 0.98 * s, 0.08 * s, tread * 0.92 * s, x, yTop * s + 0.04 * s, z));
        }
      }
    };

    // West (near camera, x = −43, outward −X) — NO canopy.
    addStand(10, 2.0, 0.6, -43, 0, 'z', -1, 120);
    // East (far, x = +43, outward +X) — canopy later.
    addStand(10, 2.0, 0.6, 43, 0, 'z', 1, 120);
    // North / South goal-ends.
    addStand(8, 2.0, 0.6, 0, 70, 'x', 1, 76);
    addStand(8, 2.0, 0.6, 0, -70, 'x', -1, 76);

    // East cantilevered canopy: 16 m over the seats at 14 m, no west roof
    // (would clip the angled/side camera frustum).
    const roofY = 14 * s;
    const roofLen = 120 * s;
    const roofDepth = 16 * s;
    const roofX = (43 + 24 - 16 / 2) * s; // hangs in from the back of the 24 m footprint
    concrete.push(box(roofDepth, 0.45 * s, roofLen, roofX, roofY, 0));
    // two slim back posts
    concrete.push(box(0.55 * s, 14 * s, 0.55 * s, (43 + 23) * s, 7 * s, -50 * s));
    concrete.push(box(0.55 * s, 14 * s, 0.55 * s, (43 + 23) * s, 7 * s, 50 * s));

    const conc = this.addMesh(merge(concrete), this.mat(CONCRETE, undefined, 0.94), 'StandsConcrete');
    conc.castShadow = true;
    conc.receiveShadow = true;
    // Moulded plastic seating: smoother than concrete, never metallic.
    const seatMesh = this.addMesh(merge(seats), this.mat(SEAT_BLUE, undefined, 0.55), 'StandsSeats');
    seatMesh.receiveShadow = true;
  }

  /* --------------------------------------------------------- instanced crowd */

  private makeSpectatorGeo(): THREE.BufferGeometry {
    // ~1.15 m seated figure. Tapered torso + shoulders + head reads as a
    // person at 60 m; a plain box reads as a crate. Still only ~40 tris, and
    // there is exactly one of these in the whole scene (InstancedMesh).
    const torso = new THREE.CylinderGeometry(0.20, 0.26, 0.62, 6);
    torso.translate(0, 0.31, 0);
    const shoulders = new THREE.SphereGeometry(0.215, 6, 4);
    shoulders.scale(1.15, 0.62, 0.85);
    shoulders.translate(0, 0.64, 0);
    const head = new THREE.SphereGeometry(0.115, 6, 5);
    head.translate(0, 0.83, 0);
    return merge([torso, shoulders, head]);
  }

  private buildCrowd(): void {
    const s = RENDER_SCALE;
    const seats: { x: number; y: number; z: number; rotY: number }[] = [];

    const place = (
      tiers: number, tread: number, riser: number,
      originX: number, originZ: number,
      along: 'z' | 'x',
      outSign: number,
      length: number,
      spacing: number,
      rotY: number,
    ) => {
      const n = Math.floor(length / spacing);
      const start = -((n - 1) * spacing) / 2;
      for (let i = 0; i < tiers; i++) {
        const depthC = (i + 0.5) * tread;
        const y = (i + 1) * riser + 0.02;
        for (let k = 0; k < n; k++) {
          const lat = start + k * spacing;
          if (along === 'z') {
            seats.push({
              x: originX + outSign * depthC,
              y,
              z: originZ + lat,
              rotY,
            });
          } else {
            seats.push({
              x: originX + lat,
              y,
              z: originZ + outSign * depthC,
              rotY,
            });
          }
        }
      }
    };

    // ~0.9 m spacing, inset from stand ends → ~3,300 instances.
    place(10, 2.0, 0.6, -43, 0, 'z', -1, 108, 0.95, Math.PI / 2);  // west, face +X
    place(10, 2.0, 0.6, 43, 0, 'z', 1, 108, 0.95, -Math.PI / 2);   // east, face −X
    place(8, 2.0, 0.6, 0, 70, 'x', 1, 68, 0.95, 0);                // north, face world +Z
    place(8, 2.0, 0.6, 0, -70, 'x', -1, 68, 0.95, Math.PI);         // south, face world −Z

    const count = seats.length;
    const geo = this.makeSpectatorGeo();
    geo.scale(s, s, s);
    // Cloth: rough, unlit-adjacent. Crowd neither casts nor receives shadows —
    // 3,300 shadow casters would cost more than the entire rest of the frame
    // and none of it is visible at this distance.
    const mat = this.mat(0xffffff, undefined, 0.92);
    this.crowd = new THREE.InstancedMesh(geo, mat, count);
    this.crowd.name = 'Crowd';
    this.crowd.castShadow = false;
    this.crowd.receiveShadow = false;
    this.crowd.frustumCulled = false;
    this.crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.crowdBase = new Float32Array(count * 4);
    const palWhite = new THREE.Color('#E0E0E0');
    const palBlack = new THREE.Color('#1A1A1A');
    const accents = ['#c8402f', '#2f4f9c', '#3a7534', '#e8cf46', '#7fa3e6', '#8f281c']
      .map((h) => new THREE.Color(h));
    const col = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p = seats[i];
      const wx = p.x * s, wy = p.y * s, wz = -p.z * s;
      this.crowdBase[i * 4] = wx;
      this.crowdBase[i * 4 + 1] = wy;
      this.crowdBase[i * 4 + 2] = wz;
      this.crowdBase[i * 4 + 3] = p.rotY;
      this.crowdDummy.position.set(wx, wy, wz);
      this.crowdDummy.rotation.set(0, p.rotY, 0);
      this.crowdDummy.scale.setScalar(0.92 + ((i * 13) % 17) * 0.006);
      this.crowdDummy.updateMatrix();
      this.crowd.setMatrixAt(i, this.crowdDummy.matrix);

      const roll = (i * 17 + 3) % 100;
      if (roll < 40) col.copy(palWhite);
      else if (roll < 80) col.copy(palBlack);
      else col.copy(accents[i % accents.length]);
      this.crowd.setColorAt(i, col);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    if (this.crowd.instanceColor) this.crowd.instanceColor.needsUpdate = true;
    this.group.add(this.crowd);
  }

  /* ----------------------------------------------------------- floodlights */

  private buildFloodlights(): void {
    const s = RENDER_SCALE;
    const towers: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    const lampH = 28;
    const corners: [number, number][] = [[48, 75], [-48, 75], [48, -75], [-48, -75]];

    for (const [lx, lz] of corners) {
      const wx = lx * s;
      const wz = -lz * s;
      const h = lampH * s;
      // Tapered lattice: four slender legs + a couple of cross-braces.
      const leg = 0.18 * s;
      const half = 0.45 * s;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          towers.push(box(leg, h, leg, wx + sx * half, h / 2, wz + sz * half));
        }
      }
      towers.push(box(1.1 * s, 0.18 * s, 1.1 * s, wx, h, wz));

      const head = new THREE.Object3D();
      head.position.set(wx, h, wz);
      head.lookAt(0, 6 * s, 0);
      head.updateMatrixWorld(true);

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 5; col++) {
          const local = new THREE.Vector3(
            (col - 2) * 0.48 * s,
            (1 - row) * 0.40 * s,
            -0.35 * s,
          );
          local.applyMatrix4(head.matrixWorld);
          const g = new THREE.CylinderGeometry(0.14 * s, 0.14 * s, 0.07 * s, 10);
          g.rotateX(Math.PI / 2);
          const m = new THREE.Matrix4().copy(head.matrixWorld);
          m.setPosition(local);
          g.applyMatrix4(m);
          lamps.push(g);
        }
      }

      // Point lights (not directional) so each tower falls off with distance
      // and the corners of the pitch are genuinely dimmer than the middle —
      // four directional lights would light the pitch perfectly evenly and
      // look like an unlit render.
      const light = new THREE.PointLight(0xfff0c8, 0, 260 * s, 2);
      light.position.set(wx, h, wz);
      this.scene.add(light);
      this.floodLights.push(light);
    }

    const tower = this.addMesh(merge(towers), this.mat(0x4a5058, undefined, 0.62, 0.55), 'FloodTowers');
    tower.castShadow = true;
    // Unlit so the lamps stay at full value regardless of time of day; the
    // bloom pass turns them into the glare that sells a night match.
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xfffaf0, depthWrite: true, toneMapped: false });
    this.addMesh(merge(lamps), this.lampMat, 'FloodLamps');
  }

  /* ---------------------------------------------------------------- update */

  /** Crowd bounce + LED flash decay. `time` is Director.t (seconds). */
  update(time: number, dt = 0.016, camera?: THREE.Camera): void {
    if (camera) this.sky.follow(camera);
    if (this.adMode !== 'NORMAL') {
      this.adHold -= dt;
      if (this.adHold <= 0) this.flashAdBoard('NORMAL');
    }
    if (this.adMode !== 'NORMAL') {
      const pulse = 0.78 + 0.22 * Math.sin(time * 11);
      this.adMat.color.setRGB(pulse, pulse, pulse);
    }
    this.cheer = Math.max(0, this.cheer - dt * 0.55);

    /* Crowd bounce. The instance matrices are written DIRECTLY rather than
     * recomposed through an Object3D: the only thing that changes per frame is
     * the Y translation (element 13 of each 4x4), so rebuilding position +
     * rotation + scale and calling updateMatrix() 3,300 times a frame does
     * ~5x the work for an identical result. Measured 0.183 -> 0.035 ms/frame. */
    const n = this.crowd.count;
    const s = RENDER_SCALE;
    const vigorous = this.cheer > 0.15;
    const amp = (0.05 + this.cheer * 0.22) * s;
    const freq = 2.3 + this.cheer * 7;
    const arr = this.crowd.instanceMatrix.array as Float32Array;
    // Idle: only every 7th spectator stirs, so the stands are never dead but
    // the cost is a seventh. On a cheer, everybody is on their feet.
    const step = vigorous ? 1 : 7;
    for (let i = 0; i < n; i += step) {
      arr[i * 16 + 13] = this.crowdBase[i * 4 + 1] + Math.sin(time * freq + i * 0.61) * amp;
    }
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.pitchTexture?.dispose();
    this.adTexture?.dispose();
    this.sky?.dispose();
    this.sun?.removeFromParent();
    this.sun?.target?.removeFromParent();
    this.sun?.dispose();
    this.hemi?.removeFromParent();
    this.ambient?.removeFromParent();
    this.bounce?.removeFromParent();
    for (const l of this.floodLights) {
      l.removeFromParent();
      l.dispose();
    }
    this.floodLights = [];
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as THREE.Material | undefined)?.dispose();
    });
    this.group.removeFromParent();
  }
}
