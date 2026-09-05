/**
 * turf.ts — procedural pitch surface maps.
 *
 * Produces three canvases that together sell a real groundsman's pitch:
 *
 *   albedo    — mown stripes, colour drift, wear scars, and every white
 *               marking baked in at the correct World Rugby dimensions.
 *   roughness — packed into a texture so the mown stripes also differ in
 *               SHEEN, not just tint. Grass bent away from you is glossy,
 *               grass bent toward you is matte; that anisotropy is what makes
 *               a striped pitch read as grass rather than as a green rug.
 *   normal    — a fine mow-direction grain plus low-frequency undulation, so
 *               grazing floodlight picks up texture instead of a flat plane.
 *
 * All three are generated at load time from a seeded hash — no binary assets,
 * no network, and a given seed always yields the same pitch.
 */

/** Deterministic value noise in [0,1). */
function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fractal noise, 4 octaves. */
function fbm(x: number, y: number, seed: number): number {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    sum += smoothNoise(x * f, y * f, seed + i * 17) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

export interface TurfMaps {
  albedo: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
  normal: HTMLCanvasElement;
}

export interface TurfSpec {
  /** Texture width in px (runs along the pitch's long axis). */
  width: number;
  height: number;
  /** Pitch extent in metres, used to place markings. */
  lengthM: number;
  widthM: number;
  /** Number of mown stripes across the length. */
  stripes: number;
  seed: number;
  field: { minX: number; maxX: number; tryZ: number; tryZFar: number; deadZ: number; deadZFar: number };
}

/**
 * Paint the base grass: stripes, colour drift, wear. Returns a per-pixel
 * stripe mask (1 = "away" stripe) reused by the roughness pass so the two
 * maps cannot drift out of alignment.
 */
function paintGrass(
  ctx: CanvasRenderingContext2D, spec: TurfSpec,
): Uint8Array {
  const { width: w, height: h, stripes, seed } = spec;
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const mask = new Uint8Array(w * h);
  const stripeW = w / stripes;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const band = Math.floor(x / stripeW) % 2;

      // Soften the stripe boundary — a mower leaves a blend, not a hard edge.
      const inBand = (x % stripeW) / stripeW;
      const edge = Math.min(inBand, 1 - inBand);
      const blend = Math.min(1, edge / 0.06);
      const dir = band === 0 ? blend : 1 - blend * 0.0; // keep it simple, mask below
      const away = band === 0 ? 1 : 0;
      mask[y * w + x] = away;

      // Base hue with large-scale health variation and fine blade noise.
      const macro = fbm(x / 140, y / 140, seed);
      const micro = hash2(x, y, seed + 3);
      const grain = fbm(x / 3.5, y / 22, seed + 9);

      // Stripes differ mostly in luminance, slightly in saturation.
      const lift = away ? 0.10 : -0.07;
      const soften = (dir - 0.5) * 0.0;

      let r = 44 + macro * 16 + lift * 52 + soften;
      let g = 104 + macro * 26 + lift * 74;
      let b = 38 + macro * 12 + lift * 40;

      // Blade grain along the mow direction.
      const gr = (grain - 0.5) * 16;
      r += gr; g += gr * 1.25; b += gr * 0.7;
      // Per-pixel speckle keeps it from banding.
      const sp = (micro - 0.5) * 9;
      r += sp; g += sp; b += sp;

      // Wear: scuffed centre channel and worn goal mouths.
      const nx = x / w, ny = y / h;
      const centreWear = Math.exp(-Math.pow((ny - 0.5) / 0.22, 2)) * 0.30;
      const goalWear =
        Math.exp(-Math.pow((nx - 0.085) / 0.045, 2)) * 0.55 +
        Math.exp(-Math.pow((nx - 0.915) / 0.045, 2)) * 0.55;
      const wearNoise = fbm(x / 60, y / 60, seed + 21);
      const wear = Math.min(0.62, (centreWear + goalWear) * (0.45 + wearNoise * 0.9));
      r = r * (1 - wear) + 96 * wear;
      g = g * (1 - wear) + 92 * wear;
      b = b * (1 - wear) + 62 * wear;

      px[i] = Math.max(0, Math.min(255, r));
      px[i + 1] = Math.max(0, Math.min(255, g));
      px[i + 2] = Math.max(0, Math.min(255, b));
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return mask;
}

/** Paint every World Rugby marking, in pitch coordinates. */
function paintMarkings(ctx: CanvasRenderingContext2D, spec: TurfSpec): void {
  const { width: w, height: h, lengthM, widthM, field } = spec;
  const zMin = -lengthM / 2;
  const xMax = widthM / 2;
  const pxZ = w / lengthM;
  const pxX = h / widthM;

  const toPx = (x: number, z: number): [number, number] => [
    (z - zMin) * pxZ,
    (xMax - x) * pxX,
  ];

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  const stroke = (x0: number, z0: number, x1: number, z1: number) => {
    const [ax, ay] = toPx(x0, z0);
    const [bx, by] = toPx(x1, z1);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  const lw = (m: number) => Math.max(2, m * pxZ);
  const dash = (on: number, off: number) => ctx.setLineDash([on * pxZ, off * pxZ]);

  const { minX, maxX, tryZ, tryZFar, deadZ, deadZFar } = field;

  // Paint twice: a soft dark contact shadow under the paint, then the paint.
  // Real line-marking sits slightly proud and catches light on one side; the
  // under-shadow is what stops the lines looking like decals floating on top.
  for (const pass of [0, 1] as const) {
    ctx.strokeStyle = pass === 0 ? 'rgba(12,26,10,0.30)' : 'rgba(246,250,244,0.94)';
    ctx.fillStyle = ctx.strokeStyle;
    const grow = pass === 0 ? 0.10 : 0;
    const off = pass === 0 ? 2 : 0;
    ctx.save();
    ctx.translate(off, off);

    ctx.setLineDash([]);
    ctx.lineWidth = lw(0.20 + grow);
    stroke(minX, deadZ, minX, deadZFar);
    stroke(maxX, deadZ, maxX, deadZFar);

    ctx.lineWidth = lw(0.22 + grow);
    stroke(minX, tryZ, maxX, tryZ);
    stroke(minX, tryZFar, maxX, tryZFar);

    ctx.lineWidth = lw(0.16 + grow);
    stroke(minX, deadZ, maxX, deadZ);
    stroke(minX, deadZFar, maxX, deadZFar);

    ctx.lineWidth = lw(0.20 + grow);
    stroke(minX, 0, maxX, 0);

    ctx.lineWidth = lw(0.18 + grow);
    stroke(minX, -28, maxX, -28);
    stroke(minX, 28, maxX, 28);

    ctx.lineWidth = lw(0.16 + grow);
    dash(2.0, 1.4);
    stroke(minX, -10, maxX, -10);
    stroke(minX, 10, maxX, 10);

    ctx.setLineDash([]);
    ctx.lineWidth = lw(0.14 + grow);
    dash(1.6, 1.6);
    stroke(minX, tryZ + 5, maxX, tryZ + 5);
    stroke(minX, tryZFar - 5, maxX, tryZFar - 5);

    ctx.lineWidth = lw(0.13 + grow);
    dash(1.6, 1.6);
    for (const x of [minX + 5, minX + 15, maxX - 15, maxX - 5]) {
      stroke(x, tryZ, x, tryZFar);
    }

    ctx.setLineDash([]);
    ctx.lineWidth = lw(0.30 + grow);
    for (const z of [-28, 0, 28]) {
      for (const x of [minX + 5, minX + 15, maxX - 15, maxX - 5]) {
        stroke(x, z - 0.6, x, z + 0.6);
      }
    }

    const [cx, cy] = toPx(0, 0);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, 0.35 * pxZ), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
  ctx.restore();
}

/**
 * Roughness/metalness/AO packed for MeshStandardMaterial:
 *   G = roughness (the only channel `roughnessMap` reads)
 *   B = metalness (always 0 for turf)
 *   R = AO
 */
function paintRoughness(
  ctx: CanvasRenderingContext2D, spec: TurfSpec, mask: Uint8Array,
): void {
  const { width: w, height: h, seed } = spec;
  const img = ctx.createImageData(w, h);
  const px = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const away = mask[y * w + x];
      // Grass laid away from the viewer shows more blade-back and is glossier.
      const base = away ? 0.60 : 0.84;
      const n = fbm(x / 50, y / 50, seed + 33) * 0.16;
      const rough = Math.max(0, Math.min(1, base + n - 0.08));
      px[i] = 255;                        // AO — the SSAO pass handles contact
      px[i + 1] = rough * 255;            // roughness
      px[i + 2] = 0;                      // metalness
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Tangent-space normal map: fine mow grain + gentle undulation. */
function paintNormal(ctx: CanvasRenderingContext2D, spec: TurfSpec): void {
  const { width: w, height: h, seed } = spec;
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const height = (x: number, y: number) =>
    fbm(x / 2.2, y / 12, seed + 41) * 0.55 + fbm(x / 90, y / 90, seed + 55) * 0.45;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dx = height(x + 1, y) - height(x - 1, y);
      const dy = height(x, y + 1) - height(x, y - 1);
      const strength = 2.4;
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len;
      px[i] = (nx * 0.5 + 0.5) * 255;
      px[i + 1] = (ny * 0.5 + 0.5) * 255;
      px[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

export function buildTurfMaps(spec: TurfSpec): TurfMaps {
  const [albedo, aCtx] = makeCanvas(spec.width, spec.height);
  const mask = paintGrass(aCtx, spec);
  paintMarkings(aCtx, spec);

  // The normal/roughness maps carry no markings and can run at half res —
  // they describe the surface, not its paint, and halving them saves ~12 MB.
  const half: TurfSpec = { ...spec, width: spec.width >> 1, height: spec.height >> 1 };
  const halfMask = new Uint8Array(half.width * half.height);
  for (let y = 0; y < half.height; y++) {
    for (let x = 0; x < half.width; x++) {
      halfMask[y * half.width + x] = mask[(y * 2) * spec.width + x * 2];
    }
  }

  const [roughness, rCtx] = makeCanvas(half.width, half.height);
  paintRoughness(rCtx, half, halfMask);

  const [normal, nCtx] = makeCanvas(half.width, half.height);
  paintNormal(nCtx, half);

  return { albedo, roughness, normal };
}
