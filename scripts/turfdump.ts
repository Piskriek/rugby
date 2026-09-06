/* turfdump.ts — rasterise the game's own pitch texture with real Skia, in node.
 *
 * WHY THIS EXISTS. The pitch, its stripes and every one of its markings are
 * painted into a 2D canvas by src/render/turf.ts and then uploaded as a
 * CanvasTexture. Until now no harness could see the result: the DOM is absent
 * in node, so `turfverify` ran against a stub canvas that accepts paint calls
 * and forgets them. A pitch that paints nothing and a pitch that paints a
 * perfect test match looked identical to the test — which is exactly how a
 * field can come out the colour of a ploughed deadline while every check is green.
 *
 * @napi-rs/canvas is a real rasteriser (Skia, prebuilt native binding, no GPU,
 * no browser). Install it, hand it to `document.createElement`, run the game's
 * own buildTurfMaps, and write PNGs. Then the texture is not an opinion, it is
 * a file you can look at.
 *
 *   npx vite-node scripts/turfdump.ts [--stripes 22] [--seed 7] [--out .arena/shots]
 */
import { createCanvas } from '@napi-rs/canvas';
import fs from 'node:fs';

/* The render layer asks the DOM for a canvas and nothing else. Give it Skia. */
const doc = {
  createElement: (tag: string) => {
    if (tag !== 'canvas') throw new Error(`turfdump only makes canvases, asked for <${tag}>`);
    return createCanvas(2, 2) as unknown as HTMLCanvasElement;
  },
};
(globalThis as unknown as { document: unknown }).document = doc;

function arg<T extends string>(name: string, dflt: T): T {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] as T : dflt;
}

async function main() {
  const outDir = arg('out', '.arena/shots');
  fs.mkdirSync(outDir, { recursive: true });

  const { FIELD, RENDER_SCALE } = await import('../src/render/retro');
  const { buildTurfMaps, TURF_SIZE } = await import('../src/render/turf');
  const { ThreeEnvironment } = await import('../src/render/ThreeEnvironment');

  // The constants the world is built with, read from where they live rather
  // than retyped, so this cannot drift from the renderer it is auditing.
  const src = fs.readFileSync('src/render/ThreeEnvironment.ts', 'utf8');
  const num = (name: string) => Number(new RegExp(`${name} = ([0-9.]+)`).exec(src)?.[1]);
  const stripes = Number(arg('stripes', (src.match(/stripes: (\d+)/) || [])[1] ?? '22'));
  const seed = Number(arg('seed', (src.match(/seed: (\d+)/) || [])[1] ?? '7'));
  const INNER_WIDTH_M = num('INNER_WIDTH_M'), INNER_LENGTH_M = num('INNER_LENGTH_M');

  const maps = buildTurfMaps({
    width: TURF_SIZE.width, height: TURF_SIZE.height,
    lengthM: INNER_LENGTH_M, widthM: INNER_WIDTH_M,
    stripes, seed, field: FIELD,
  });

  for (const key of ['albedo', 'roughness', 'normal'] as const) {
    const c = maps[key] as unknown as { toBuffer(fmt: string): Buffer };
    const buf = c.toBuffer('image/png');
    fs.writeFileSync(`${outDir}/turf-${key}.png`, buf);
    console.log(`turf-${key}.png  ${(buf.length / 1024).toFixed(1)} kB  ${(maps[key] as unknown as HTMLCanvasElement).width}x${(maps[key] as unknown as HTMLCanvasElement).height}`);
  }

  /* Pixel statistics, because "it looks brown" needs a number next to it. A
   * healthy albedo is green-dominant, varied, and carries near-white marking
   * pixels. Any of those three collapsing is a visible bug on the field. */
  const w = (maps.albedo as unknown as HTMLCanvasElement).width;
  const h = (maps.albedo as unknown as HTMLCanvasElement).height;
  const ctx = (maps.albedo as unknown as HTMLCanvasElement).getContext('2d')!;
  const d = ctx.getImageData(0, 0, w, h).data;
  let rSum = 0, gSum = 0, bSum = 0, white = 0, nonBlack = 0;
  const hist = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    rSum += r; gSum += g; bSum += b;
    if (r > 200 && g > 200 && b > 190) white++;
    if (r + g + b > 40) nonBlack++;
    const k = `${r >> 5}-${g >> 5}-${b >> 5}`;
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const n = d.length / 4;
  console.log(`mean rgb ${(rSum / n).toFixed(1)} ${(gSum / n).toFixed(1)} ${(bSum / n).toFixed(1)}`
    + ` | green-dominant ${(gSum / n) > (rSum / n)}`
    + ` | marking-white pixels ${((white / n) * 100).toFixed(2)}%`
    + ` | distinct colour buckets ${hist.size}`
    + ` | black ${(100 - (nonBlack / n) * 100).toFixed(2)}%`);

  /* A downsampled contact sheet of the whole pitch, at the size the camera
   * actually resolves it to, so the stripes and the line set can be judged in
   * one look instead of pixel-peeping a 2048x1024 file. */
  const sheet = createCanvas(512, 256);
  const sx = sheet.getContext('2d') as unknown as CanvasRenderingContext2D;
  (sx as unknown as { drawImage: (s: unknown, ...a: number[]) => void })
    .drawImage(maps.albedo, 0, 0, w, h, 0, 0, 512, 256);
  fs.writeFileSync(`${outDir}/turf-sheet.png`, sheet.toBuffer('image/png'));
  console.log(`${outDir}/turf-sheet.png (512x256 contact sheet)`);
  console.log(`RENDER_SCALE ${RENDER_SCALE} · pitch ${INNER_WIDTH_M}x${INNER_LENGTH_M} m · stripes ${stripes} · seed ${seed}`);

  const fails: string[] = [];
  if ((gSum / n) <= (rSum / n)) fails.push('albedo is not green-dominant (mean R >= mean G)');
  if (white / n < 0.001) fails.push('no near-white marking pixels: the lines are not painted');
  if (hist.size < 40) fails.push(`albedo is flat (${hist.size} colour buckets): no stripes, no wear`);
  if (nonBlack / n < 0.98) fails.push('most of the albedo is black');
  console.log(fails.length ? `\nFAIL\n  ${fails.join('\n  ')}` : '\nPASS turf texture paints green grass, stripes and markings');
  void ThreeEnvironment;   // imported only so a broken constructor path fails loudly here
  if (fails.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
