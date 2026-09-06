/**
 * renderverify — guards two render-pipeline mistakes that produce a broken
 * frame with no error in the console, so nothing else would catch them.
 *
 * Both are regressions that actually shipped once.
 */
import fs from 'node:fs';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
}

const env = fs.readFileSync('src/render/ThreeEnvironment.ts', 'utf8');
const canvas = fs.readFileSync('src/render/ThreeCanvas.ts', 'utf8');

/* 1. THE PITCH CROWN SIGN.
 * PlaneGeometry is displaced along local +Z, then laid flat with
 * rotation.x = -PI/2, which maps local +Z to world +Y. A negative crown
 * buries the pitch under the outer ground plane at y=0: the markings vanish
 * and the turf z-fights. Positive is the only correct sign. */
{
  const m = env.match(/pos\.setZ\(i,\s*(-?)\(1 - t \* t\)/);
  check('pitch crown displaces upward', !!m && m[1] === '',
    m ? (m[1] === '' ? 'positive (+Y after rotation)' : 'NEGATIVE — pitch is buried') : 'crown displacement not found');
  const flat = /rotation\.x = -Math\.PI \/ 2/.test(env);
  check('pitch is laid flat as assumed', flat, flat ? 'rotation.x = -PI/2' : 'rotation changed — recheck the sign above');
}

/* 2. THE COLOUR PIPELINE HAS EXACTLY ONE ENCODE POINT.
 * The composer target is linear half-float. Something must convert to sRGB
 * on the way out. The custom grade pass owns that curve, which is why the
 * renderer is left on NoToneMapping — but if the grade pass ever stops being
 * the last pass, or the renderer starts tone mapping too, the image is
 * either raw linear HDR (dark and flat) or double-graded (washed out). */
{
  const noToneMap = /toneMapping = THREE\.NoToneMapping/.test(canvas);
  check('renderer leaves tone mapping to the grade', noToneMap,
    noToneMap ? 'NoToneMapping (grade pass owns the curve)' : 'renderer is tone mapping — double grade');
  const documented = /OutputPass|grade pass/i.test(canvas);
  check('the single-encode decision is documented', documented,
    documented ? 'rationale present in the header' : 'undocumented — the next reader will "fix" it');
}

/* 3. THE COMPOSER TARGET MUST NOT BE MULTISAMPLED.
 * A HalfFloat colour target with `samples > 0` is ~4x the memory (380 MB at
 * DPR 2 when measured). Where the driver refuses the allocation it does not
 * throw — it yields an incomplete framebuffer that resolves to one flat
 * colour, and the whole game renders as a single uniform fill with a working
 * HUD on top. That is a very expensive bug to diagnose from a screenshot. */
{
  const initBlock = canvas.slice(canvas.indexOf('init()'), canvas.indexOf('applyConditions('));
  /* Strip comments first: this file DOCUMENTS the mistake at length, and a
   * naive scan matches the explanation rather than the code. */
  const code = initBlock
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const msaa = /samples:\s*([1-9])/.exec(code);
  check('composer target is not multisampled', !msaa,
    msaa ? `samples: ${msaa[1]} — flat-colour risk` : 'no MSAA on the HalfFloat target');
}

/* 4. THE TARGET MUST NOT BE ALLOCATED AT 2x2.
 * init() runs before layout, so clientWidth is 0. Falling back to 2 pixels
 * allocates the entire post chain at 2x2 and then resizes it on frame 1. */
{
  const twoPx = /clientWidth \|\| 2\b/.test(canvas);
  check('composer size falls back sanely', !twoPx,
    twoPx ? 'falls back to 2px — allocate at window size instead' : 'falls back to window size');
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
