/**
 * Turf generator verification + budget gate.
 *
 * Guards two things that have already regressed once:
 *  1. Visual correctness — stripes must differ in BOTH albedo and roughness,
 *     the map must be green, and normals must point out of the surface.
 *  2. Generation cost — the map build must stay inside a frame budget that a
 *     loading screen can absorb. The original cost 12.1 s and froze the tab.
 */
class FakeCtx {
  data: Uint8ClampedArray;
  constructor(public w: number, public h: number) { this.data = new Uint8ClampedArray(w * h * 4); }
  createImageData(w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData(img: { data: Uint8ClampedArray }) { this.data.set(img.data); }
  save() {} restore() {} translate() {} beginPath() {} moveTo() {} lineTo() {}
  stroke() {} fill() {} arc() {} setLineDash() {}
  set strokeStyle(_v: unknown) {} set fillStyle(_v: unknown) {} set lineWidth(_v: unknown) {}
  set lineCap(_v: unknown) {} set lineJoin(_v: unknown) {}
  get strokeStyle() { return '#fff'; }
}
type FakeCanvas = { width: number; height: number; _c?: FakeCtx; getContext: () => FakeCtx };
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => {
    const o = { width: 0, height: 0 } as FakeCanvas;
    o.getContext = () => { o._c = o._c ?? new FakeCtx(o.width, o.height); return o._c; };
    return o;
  },
};

const { buildTurfMaps } = await import('../src/render/turf');
const { TURF_SIZE } = await import('../src/render/turf');

const FIELD = { minX: -35, maxX: 35, tryZ: -50, tryZFar: 50, deadZ: -62, deadZFar: 62 };
const W = TURF_SIZE.width, H = TURF_SIZE.height;

const t0 = Date.now();
const maps = buildTurfMaps({
  width: W, height: H, lengthM: 130, widthM: 76, stripes: 22, seed: 7, field: FIELD,
});
const ms = Date.now() - t0;

const px = (maps.albedo as unknown as FakeCanvas)._c!.data;
const rough = (maps.roughness as unknown as FakeCanvas)._c!.data;
const norm = (maps.normal as unknown as FakeCanvas)._c!.data;

let nan = 0, green = 0;
for (let i = 0; i < px.length; i += 4) {
  if (!Number.isFinite(px[i])) nan++;
  if (px[i + 1] > px[i] && px[i + 1] > px[i + 2]) green++;
}
const greenPct = green / (px.length / 4) * 100;

const stripeW = W / 22;
const row = Math.floor(H / 2);
const sampleG = (sx: number) => px[((row * W) + Math.floor(sx)) * 4 + 1];
const dAlbedo = Math.abs(sampleG(stripeW * 0.5) - sampleG(stripeW * 1.5));

const rW = W >> 1, rRow = Math.floor((H >> 1) / 2), rStripe = rW / 22;
const sampleR = (sx: number) => rough[((rRow * rW) + Math.floor(sx)) * 4 + 1];
// Centres of two ADJACENT stripes (0.5 and 1.5), not two points in one.
const dRough = Math.abs(sampleR(rStripe * 0.5) - sampleR(rStripe * 1.5));

let badZ = 0;
for (let i = 2; i < norm.length; i += 4) if (norm[i] < 128) badZ++;

const BUDGET_MS = 1500;
const checks: [string, boolean, string][] = [
  ['no NaN pixels', nan === 0, String(nan)],
  ['pitch is green', greenPct > 80, greenPct.toFixed(1) + '%'],
  ['stripes differ in albedo', dAlbedo > 6, String(dAlbedo)],
  ['stripes differ in roughness', dRough > 20, String(dRough)],
  ['normals point outward', badZ === 0, String(badZ)],
  [`build under ${BUDGET_MS}ms`, ms < BUDGET_MS, ms + 'ms'],
];

console.log(`=== TURF VERIFY (${W}x${H}) ===`);
let ok = true;
for (const [name, pass, val] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${val}`);
  if (!pass) ok = false;
}
console.log(ok ? 'ALL PASS' : 'FAILURES PRESENT');
if (!ok) process.exit(1);
