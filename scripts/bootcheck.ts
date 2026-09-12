/**
 * bootcheck.ts — CAN THE BOOT HANG?
 *
 * The original bug: ThreePlayerManager.load() used an `async` GLTF success
 * callback. A throw inside it rejected an INNER promise nobody held, so the
 * outer one never settled and the match stuck at "BRINGING OUT THE TEAMS".
 *
 * This harness asserts the SHAPE OF THE WAIT against the current source and
 * the packed player.glb:
 *
 *   1. player.glb exists and parses.
 *   2. load()'s async success path has a try/catch that rejects the outer promise.
 *   3. MatchView does not await load() without a .catch (a hung boot is a hang).
 *   4. MODEL_URL points at player.glb, not the old Superhero pack.
 *
 *   npx vite-node scripts/bootcheck.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self = globalThis;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB = path.join(ROOT, 'public/assets/models/player.glb');

let fails = 0;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`);
}

const mgrSrc = fs.readFileSync(path.join(ROOT, 'src/render/ThreePlayerManager.ts'), 'utf8');
const matchSrc = fs.readFileSync(path.join(ROOT, 'src/ui/MatchView.tsx'), 'utf8');

check('player.glb exists', fs.existsSync(GLB), fs.existsSync(GLB) ? GLB : 'missing');

const asyncCb = /loader\.load\(MODEL_URL,\s*async\s*\(gltf\)\s*=>\s*\{/.test(mgrSrc);
const hasTry = /async \(gltf\) => \{[\s\S]*?try\s*\{/.test(mgrSrc);
const hasCatchReject = /catch\s*\([^)]*\)\s*\{\s*this\.ready\s*=\s*false;\s*reject\(/.test(mgrSrc);
check('load() success callback is try/caught', hasTry && hasCatchReject,
  hasCatchReject ? 'throw inside async load rejects the outer promise' : 'MISSING try/catch — a throw hangs the boot');
check('load() still uses an async GLTF callback', asyncCb,
  asyncCb ? 'async (gltf) =>' : 'callback shape changed — re-read the hang risk');

const loadsWithCatch = /players\.load\(\)\.catch\(/.test(matchSrc);
const awaitsBare = /await players\.load\(\)/.test(matchSrc) && !/Promise\.race/.test(matchSrc);
check('MatchView does not await a bare load()', !awaitsBare,
  awaitsBare ? 'await players.load() with no race — a hang freezes the overlay' : 'fire-and-forget + .catch (2D layer can carry the match)');
check('MatchView records a load failure', loadsWithCatch,
  loadsWithCatch ? 'players.load().catch(...)' : 'a failed load is silent');

check('MODEL_URL is player.glb', /const MODEL_URL = 'assets\/models\/player\.glb'/.test(mgrSrc),
  /player\.glb/.test(mgrSrc) ? 'assets/models/player.glb' : 'still on rugby_player.glb');

if (fs.existsSync(GLB)) {
  const buf = fs.readFileSync(GLB);
  const magic = buf.slice(0, 4).toString('ascii') === 'glTF';
  check('player.glb is a GLB container', magic, magic ? 'glTF magic' : 'not a GLB');
  try {
    const loader = new GLTFLoader();
    const gltf = await new Promise<{ animations: THREE.AnimationClip[] }>((res, rej) => {
      loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res as (g: unknown) => void, rej);
    });
    check('GLTFLoader.parse settles', true, `${gltf.animations.length} clips, ready for ThreePlayerManager.load()`);
  } catch (e) {
    check('GLTFLoader.parse settles', false, String((e as Error).message || e));
  }
}

console.log(fails ? `\n${fails} FAILING` : '\nALL PASS');
process.exit(fails ? 1 : 0);
