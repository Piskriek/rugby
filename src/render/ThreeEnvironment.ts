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

const FOG_COLOR = 0x1a2634;
const FOG_DENSITY = 0.0035;
const OUTER_COLOR = 0x1d4a1b;
const STRIPE_A = '#2e6b27';
const STRIPE_B = '#347a2c';
const LINE = '#FFFFFF';
const CONCRETE = 0x3a3f47;
const SEAT_BLUE = 0x1e2d42;

const INNER_WIDTH_M = 76;
const INNER_LENGTH_M = 130;
const OUTER_M = 500;

const POST_HALF = 2.8;
const CROSSBAR_TOP = 3.0;
const POST_HEIGHT = 12.0;
const PAD_HEIGHT = 1.5;
const POST_RADIUS = 0.06;

export type AdBoardFlash = 'TRY' | 'PENALTY' | 'NORMAL';

function toonGradient(): THREE.DataTexture {
  const data = new Uint8Array([168, 168, 168, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

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
  private gradient = toonGradient();

  private adCanvas!: HTMLCanvasElement;
  private adTexture!: THREE.CanvasTexture;
  private adMat!: THREE.MeshToonMaterial;
  private adMode: AdBoardFlash = 'NORMAL';
  private adHold = 0;

  private crowd!: THREE.InstancedMesh;
  private crowdBase!: Float32Array; // x,y,z,rotY per instance
  private crowdDummy = new THREE.Object3D();
  private cheer = 0;

  private floodLights: THREE.DirectionalLight[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Environment3D';
    scene.add(this.group);

    this.setupFog(scene);
    this.buildGround(renderer);
    this.buildUprights();
    this.buildAdBoards(renderer);
    this.buildGrandstands();
    this.buildCrowd();
    this.buildFloodlights();
  }

  private setupFog(scene: THREE.Scene): void {
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    scene.background = new THREE.Color(FOG_COLOR);
  }

  private mat(color: number, map?: THREE.Texture): THREE.MeshToonMaterial {
    return new THREE.MeshToonMaterial({
      color, map, gradientMap: this.gradient, depthWrite: true,
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

    const outerGeo = new THREE.PlaneGeometry(OUTER_M * s, OUTER_M * s);
    const outer = this.addMesh(outerGeo, this.mat(OUTER_COLOR), 'OuterGround');
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    outer.renderOrder = -1;

    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    this.paintPitch(ctx, canvas.width, canvas.height);

    this.pitchTexture = new THREE.CanvasTexture(canvas);
    this.pitchTexture.colorSpace = THREE.SRGBColorSpace;
    this.pitchTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.pitchTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.pitchTexture.magFilter = THREE.LinearFilter;
    this.pitchTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.pitchTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.pitchTexture.needsUpdate = true;

    const innerGeo = new THREE.PlaneGeometry(INNER_WIDTH_M * s, INNER_LENGTH_M * s);
    this.remapPitchUVs(innerGeo);
    const inner = this.addMesh(innerGeo, this.mat(0xffffff, this.pitchTexture), 'InnerPitch');
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.0;
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

  private paintPitch(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const zMin = -INNER_LENGTH_M / 2;
    const xMax = INNER_WIDTH_M / 2;
    const pxZ = w / INNER_LENGTH_M;
    const pxX = h / INNER_WIDTH_M;

    const toPx = (x: number, z: number): [number, number] => [
      (z - zMin) * pxZ,
      (xMax - x) * pxX,
    ];

    const stripeCount = 24;
    const stripeW = w / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      ctx.fillStyle = i % 2 === 0 ? STRIPE_A : STRIPE_B;
      ctx.fillRect(i * stripeW, 0, stripeW + 0.5, h);
    }

    ctx.strokeStyle = LINE;
    ctx.fillStyle = LINE;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.setLineDash([]);

    const linePx = (metres: number) => Math.max(2, metres * pxZ);
    const dashPx = (onM: number, offM: number) => {
      ctx.setLineDash([onM * pxZ, offM * pxZ]);
    };
    const stroke = (x0: number, z0: number, x1: number, z1: number) => {
      const [ax, ay] = toPx(x0, z0);
      const [bx, by] = toPx(x1, z1);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };

    const { minX, maxX, tryZ, tryZFar, deadZ, deadZFar } = FIELD;

    ctx.lineWidth = linePx(0.20);
    stroke(minX, deadZ, minX, deadZFar);
    stroke(maxX, deadZ, maxX, deadZFar);

    ctx.lineWidth = linePx(0.22);
    stroke(minX, tryZ, maxX, tryZ);
    stroke(minX, tryZFar, maxX, tryZFar);

    ctx.lineWidth = linePx(0.16);
    stroke(minX, deadZ, maxX, deadZ);
    stroke(minX, deadZFar, maxX, deadZFar);

    ctx.lineWidth = linePx(0.20);
    stroke(minX, 0, maxX, 0);

    ctx.lineWidth = linePx(0.18);
    stroke(minX, -28, maxX, -28);
    stroke(minX, 28, maxX, 28);

    ctx.lineWidth = linePx(0.16);
    dashPx(2.0, 1.4);
    stroke(minX, -10, maxX, -10);
    stroke(minX, 10, maxX, 10);
    ctx.setLineDash([]);

    ctx.lineWidth = linePx(0.14);
    dashPx(1.6, 1.6);
    stroke(minX, tryZ + 5, maxX, tryZ + 5);
    stroke(minX, tryZFar - 5, maxX, tryZFar - 5);

    ctx.lineWidth = linePx(0.13);
    dashPx(1.6, 1.6);
    for (const x of [minX + 5, minX + 15, maxX - 15, maxX - 5]) {
      stroke(x, tryZ, x, tryZFar);
    }
    ctx.setLineDash([]);

    ctx.lineWidth = linePx(0.30);
    for (const z of [-28, 0, 28]) {
      for (const x of [minX + 5, minX + 15, maxX - 15, maxX - 5]) {
        stroke(x, z - 0.6, x, z + 0.6);
      }
    }

    const [cx, cy] = toPx(0, 0);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, 0.35 * pxZ), 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---------------------------------------------------------------- uprights */

  private buildUprights(): void {
    const s = RENDER_SCALE;
    const postMat = this.mat(0xffffff);
    const padMat = this.mat(0x111111);

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

    this.addMesh(merge(white), postMat, 'GoalPosts');
    this.addMesh(merge(pads), padMat, 'GoalPads');
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

    this.adMat = this.mat(0xffffff, this.adTexture);

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

    this.addMesh(merge(geos), this.adMat, 'AdBoards');
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

    this.addMesh(merge(concrete), this.mat(CONCRETE), 'StandsConcrete');
    this.addMesh(merge(seats), this.mat(SEAT_BLUE), 'StandsSeats');
  }

  /* --------------------------------------------------------- instanced crowd */

  private makeSpectatorGeo(): THREE.BufferGeometry {
    // ~1.1 m seated figure: 12-tri torso prism + 8-tri head.
    const torso = new THREE.BoxGeometry(0.44, 0.72, 0.28);
    torso.translate(0, 0.36, 0);
    const head = new THREE.BoxGeometry(0.22, 0.26, 0.22);
    head.translate(0, 0.92, 0);
    return merge([torso, head]);
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
    const mat = this.mat(0xffffff);
    this.crowd = new THREE.InstancedMesh(geo, mat, count);
    this.crowd.name = 'Crowd';
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

      const light = new THREE.DirectionalLight(0xfff0c8, 0.16);
      light.position.set(wx, h, wz);
      light.target.position.set(0, 0, 0);
      this.scene.add(light);
      this.scene.add(light.target);
      this.floodLights.push(light);
    }

    this.addMesh(merge(towers), this.mat(0x2a3038), 'FloodTowers');
    const lampMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c4, depthWrite: true,
    });
    this.addMesh(merge(lamps), lampMat, 'FloodLamps');
  }

  /* ---------------------------------------------------------------- update */

  /** Crowd bounce + LED flash decay. `time` is Director.t (seconds). */
  update(time: number, dt = 0.016): void {
    if (this.adMode !== 'NORMAL') {
      this.adHold -= dt;
      if (this.adHold <= 0) this.flashAdBoard('NORMAL');
    }
    if (this.adMode !== 'NORMAL') {
      const pulse = 0.78 + 0.22 * Math.sin(time * 11);
      this.adMat.color.setRGB(pulse, pulse, pulse);
    }
    this.cheer = Math.max(0, this.cheer - dt * 0.55);

    const n = this.crowd.count;
    const s = RENDER_SCALE;
    const vigorous = this.cheer > 0.15;
    const amp = (0.05 + this.cheer * 0.22) * s;
    const freq = 2.3 + this.cheer * 7;
    const dummy = this.crowdDummy;
    let dirty = false;
    for (let i = 0; i < n; i++) {
      if (!vigorous && i % 7 !== 0) continue;
      const yOff = Math.sin(time * freq + i * 0.61) * amp;
      dummy.position.set(
        this.crowdBase[i * 4],
        this.crowdBase[i * 4 + 1] + yOff,
        this.crowdBase[i * 4 + 2],
      );
      dummy.rotation.set(0, this.crowdBase[i * 4 + 3], 0);
      dummy.scale.setScalar(0.92 + ((i * 13) % 17) * 0.006);
      dummy.updateMatrix();
      this.crowd.setMatrixAt(i, dummy.matrix);
      dirty = true;
    }
    if (dirty) this.crowd.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.pitchTexture?.dispose();
    this.adTexture?.dispose();
    this.gradient.dispose();
    for (const l of this.floodLights) {
      l.target.removeFromParent();
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
