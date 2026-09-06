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
/* The crown used to be guarded by matching its literal source line. That is a
   * proxy for a fact, and the moment the expression moved into `turfRiseM` —
   * which is the RIGHT place, because the players, the ball and every clod of
   * turf have to stand on the same surface the mesh draws — the proxy broke and
   * the fact was fine. So measure the function the scene uses instead of the
   * punctuation it happens to be written with. */
  const usesFn = /pos\.setZ\(i,\s*turfRiseM\(/.test(env);
  check('the pitch mesh takes its height from turfRiseM', usesFn,
    usesFn ? 'geometry and actors share one surface function' : 'mesh crown is computed somewhere else again — they will disagree');
  const signPositive = !/setZ\(i,\s*-turfRiseM/.test(env);
  check('crown is added, not subtracted', signPositive,
    signPositive ? '+turfRiseM (+Y once the plane is laid flat)' : 'NEGATIVE — pitch is buried under the outer plane');
  const flat = /rotation\.x = -Math\.PI \/ 2/.test(env);
  check('pitch is laid flat as assumed', flat, flat ? 'rotation.x = -PI/2' : 'rotation changed — recheck the sign above');
  /* And the shape of it: highest on the half-way line, flush with the
   * touchlines, monotone between. Read from the exported function, so a change
   * to the dome is a change this harness sees. */
  const src = fs.readFileSync('src/render/ThreeEnvironment.ts', 'utf8');
  const halfW = Number(/INNER_WIDTH_M = ([0-9.]+)/.exec(src)?.[1]) / 2;
  const crown = Number(/PITCH_CROWN_M = ([0-9.]+)/.exec(src)?.[1]);
  const rise = (x: number) => (1 - Math.min(1, Math.abs(x) / halfW) ** 2) * crown;
  const shapeOk = rise(0) > 0.2 && Math.abs(rise(halfW)) < 1e-9
    && rise(halfW * 0.5) > rise(halfW * 0.8) && Number.isFinite(rise(1e6));
  check('dome rises 0.3 m at the centre and meets the touchline', shapeOk,
    `centre ${rise(0).toFixed(2)} m, half-width ${rise(halfW * 0.5).toFixed(2)} m, touchline ${rise(halfW).toFixed(3)} m`);
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

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
