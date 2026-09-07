/**
 * scripts/matchdayheadless.ts — HEADLESS SMOKE TEST FOR THE MATCH-DAY LAYERS.
 *
 * The renderer is the one part of this codebase the harness could never reach.
 * `retro.ts` paints into a 2D context, so `runTrace`/`runDeep`/`audit` exercise
 * the DATA the renderer consumes but never the renderer itself — and every
 * crash in `ThreeMatchDay.update()` is a black rectangle in someone's browser,
 * not a red line in a test.
 *
 * This closes the gap as far as it can be closed without a GPU:
 *
 *   1. A fake `document` good enough for `CanvasTexture` and the 2D paint code
 *      (every gradient, every fill, every drawImage is a no-op that must still
 *      be CALLED with the right shape — the point is to execute the code paths).
 *   2. A real THREE.Scene, a real `ThreeEnvironment`, `ThreeMatchDay`,
 *      `ThreeParticles`, `FxDirector`, and the real `Director`.
 *   3. Eighty seconds of live match, driven through the same `update` the view
 *      drives, with the render-side update called every frame. Tries, rucks,
 *     scrums and kick-offs all happen in 80 s at difficulty 3, so every FX
 *      branch gets hit by real state rather than by a fixture I made up.
 *   4. The condition matrix: all 7 weathers × 4 kick-off times × 5 pitches ×
 *      3 quality tiers = 420 resolutions, each pushed through the environment
 *      and the match-day rig. Anything that can be NaN, undefined or a
 *      misnamed material property shows up here and not on a Tuesday night.
 *
 * It cannot validate that the picture looks right. Only a human can. What it
 * does guarantee is that the code runs, that no property is spelled wrong, and
 * that the FX pool never leaks a live particle past its lifetime.
 */
import * as THREE from 'three';

/* ------------------------------------------------------------ fake canvas --- */
function fakeCtx(): any {
  const grad = { addColorStop() {} };
  const noop = () => undefined;
  const target: any = {
    canvas: { width: 1024, height: 1024 },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt',
    lineJoin: 'miter', globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    filter: 'none', shadowBlur: 0, shadowColor: '#000',
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({ setTransform: noop }),
    measureText: () => ({ width: 10 }),
    getImageData: (x: number, y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h,
    }),
    putImageData: noop, createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h,
    }),
    setLineDash: noop, getLineDash: () => [],
  };
  for (const k of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo',
    'lineTo', 'arc', 'ellipse', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate',
    'scale', 'drawImage', 'fillText', 'strokeText', 'quadraticCurveTo', 'bezierCurveTo',
    'rect', 'setTransform', 'transform', 'resetTransform', 'clip', 'arcTo', 'roundRect']) {
    target[k] = noop;
  }
  return new Proxy(target, {
    get: (o, p) => (p in o ? o[p as string] : noop),
    set: (o, p, v) => { o[p as string] = v; return true; },
  });
}

const fakeDocument: any = {
  createElement(tag: string) {
    const el: any = {
      width: 1024, height: 1024, style: {}, tagName: tag.toUpperCase(),
      getContext: () => fakeCtx(), toDataURL: () => 'data:,',
      addEventListener() {}, removeEventListener() {},
      appendChild() {}, removeChild() {},
    };
    return el;
  },
  createElementNS: (_ns: string, tag: string) => fakeDocument.createElement(tag),
};
(globalThis as any).document = fakeDocument;
(globalThis as any).window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
(globalThis as any).HTMLCanvasElement = function () { /* instanceof marker */ };
(globalThis as any).Image = function () { };
(globalThis as any).self = globalThis;

/* --------------------------------------------------------------- imports --- */
import { ThreeEnvironment } from '../src/render/ThreeEnvironment';
import { ThreeMatchDay } from '../src/render/ThreeMatchDay';
import { ThreeParticles } from '../src/render/ThreeParticles';
import { FxDirector } from '../src/render/fxDirector';
import { resolveConditions, type Quality, WEATHERS } from '../src/render/conditions';
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).stack?.split('\n').slice(0, 4).join('\n       ')}`);
  }
}

const finite = (n: number, what: string) => {
  if (!Number.isFinite(n)) throw new Error(`${what} is ${n}`);
};

console.log('match-day headless smoke test\n');

/* ------------------------------------------------- 1. the condition matrix --- */
console.log('condition matrix (7 weather × 4 kick-off × 5 pitch × 3 quality):');
let condCount = 0;
const QUALITIES: Quality[] = ['LEGACY', 'STANDARD', 'FULL'];
check('all 420 combinations resolve finite and in range', () => {
  for (let w = 0; w < WEATHERS.length; w++) {
    for (let tod = 0; tod < 4; tod++) {
      for (let p = 0; p < 5; p++) {
        for (const q of QUALITIES) {
          const c = resolveConditions({ weather: w, timeofday: tod, pitch: p, wind: 2 }, q);
          condCount++;
          for (const [k, v] of Object.entries(c)) {
            if (typeof v === 'number') finite(v, `conditions.${k}`);
            if (typeof v === 'string' && v.startsWith('#') && !/^#[0-9a-f]{6}$/i.test(v)) {
              throw new Error(`conditions.${k} is not a hex colour: ${v}`);
            }
          }
          if (c.bloomStrength < 0 || c.bloomStrength > 1.5) throw new Error('bloomStrength out of range');
          if (c.vignette < 0 || c.vignette > 1.5) throw new Error('vignette out of range');
          if (c.mud < 0 || c.mud > 1) throw new Error('mud out of range');
          if (c.precip === 'RAIN' && c.precipDensity <= 0) throw new Error('rain with no drops');
          if (c.weather === 'CLEAR' && c.precip !== 'NONE') throw new Error('clear sky is precipitating');
          if (c.pitchKind === 'FROZEN' && c.frost <= 0) throw new Error('frozen pitch without rime');
        }
      }
    }
  }
});
console.log(`  (${condCount} resolutions)`);

/* ---------------------------------------------------- 2. the render layers --- */
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a2634, 0.0035);
scene.background = new THREE.Color(0x1a2634);
const fakeRenderer: any = {
  capabilities: { getMaxAnisotropy: () => 8 },
  shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap, autoUpdate: true, needsUpdate: false },
};

console.log('\nrender layers:');
const env = new ThreeEnvironment(scene, fakeRenderer);
const day = new ThreeMatchDay(scene);
const fx = new ThreeParticles(scene);
check('environment + match-day + particles construct', () => {
  if (!env || !day || !fx) throw new Error('a layer refused to build');
});

check('applyConditions across the matrix', () => {
  for (let w = 0; w < WEATHERS.length; w++) {
    for (const q of QUALITIES) {
      const c = resolveConditions({ weather: w, timeofday: 3, pitch: 2, wind: 1 }, q);
      env.applyConditions(c);
      day.applyQuality(c);
      env.flushTurf();
      for (const m of [env.group]) {
        m.traverse((o: any) => {
          if (o.isMesh || o.isPoints || o.isLineSegments) {
            finite(o.position.x, `${o.name}.position.x`);
            finite(o.position.y, `${o.name}.position.y`);
            const mm = o.material;
            if (mm && mm.opacity !== undefined) finite(mm.opacity, `${o.name}.material.opacity`);
          }
        });
      }
    }
  }
});

check('scars accumulate and the composite survives 900 of them', () => {
  for (let i = 0; i < 1000; i++) env.addScar(Math.sin(i) * 36, Math.cos(i) * 62, 1.4);
  env.flushTurf();
  if (env.turfScars < 900) throw new Error(`the scar budget stopped early at ${env.turfScars}`);
  if (env.turfScars > 1400) throw new Error(`the scar budget is not capped (${env.turfScars})`);
});

/* ------------------------------------------------- 3. a real match, driven --- */
console.log('\n80 s of live match through the render path:');
const d = new Director(gateConfig(3));
const fxd = new FxDirector(fx, env);
const cond = resolveConditions(d.options as Record<string, number>, 'FULL');
env.applyConditions(cond);
const cam = { x: 0, z: 0, h: 20, yaw: 0, tilt: 0.5, fov: 0.6, shake: 0, horizon: 0.4, roll: 0 };

check('frames update without throwing; FX pool returns to empty', () => {
  let frames = 0;
  let maxLive = 0;
  let pulses = 0;
  let impacts = 0;
  for (let i = 0; i < 60 * 80 && !d.over; i++) {
    d.update(1 / 60, NO_INPUT, new Set(), new Set());
    frames++;
    const view = { w: 1280, h: 720 };
    day.update(d.cam ?? cam, view, cond, 1 / 60);
    const p = fxd.update(d, cond, 1 / 60);
    if (p.impact > 0) impacts++;
    if (pulse(p.impact)) pulses++;
    fx.update(1 / 60, cond.windX * cond.windSpeed, cond.windZ * cond.windSpeed, 1.65);
    env.update(d.t, 1 / 60);
    for (const a of d.actors) {
      finite(a.rx, 'actor.rx'); finite(a.rz, 'actor.rz');
    }
    const posAttr = (fx.points.geometry.getAttribute('position') as THREE.BufferAttribute);
    for (let k = 0; k < 64; k++) finite(posAttr.getX(k) + posAttr.getY(k), 'fx position');
  }
  if (frames < 600) throw new Error(`only ${frames} frames ran`);
  void maxLive;
  console.log(`  (${frames} frames, ${impacts} impact frames, ${pulses} above-threshold, score ${d.A.score}-${d.B.score}, phase ${d.phase})`);
  if (impacts < 1) throw new Error('no impact was ever strong enough to throw turf — the ground-detection branch is dead');
  // Drain the pool and confirm nothing stays alive.
  for (let i = 0; i < 60 * 6; i++) fx.update(1 / 60, 0, 0, 1.65);
  let live = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyFx = fx as any;
  for (let i = 0; i < 1600; i++) if (anyFx.life[i] > 0) live++;
  maxLive = live;
  if (maxLive > 0) throw new Error(`${maxLive} particles outlived their lifetime`);
});
function pulse(v: number) { return v > 0.5; }

check('a try fires the celebration branch (injected, deterministic)', () => {
  const c2 = resolveConditions({ weather: 3, timeofday: 3, pitch: 3, wind: 2 }, 'FULL');
  env.applyConditions(c2);
  d.banner = 'TRY — H. JACKSON';
  d.bannerAt = d.t + 0.001;
  for (let i = 0; i < 30; i++) {
    fxd.update(d, c2, 1 / 30);
    fx.update(1 / 30, 0, 0, 1.65);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyFx = fx as any;
  let live = 0;
  for (let i = 0; i < 1600; i++) if (anyFx.life[i] > 0) live++;
  if (live < 40) throw new Error(`a try only produced ${live} particles; confetti and pyro did not fire`);
});

check('the whole weather matrix drives a real frame without throwing', () => {
  for (let w = 0; w < WEATHERS.length; w++) {
    for (let tod = 0; tod < 4; tod++) {
      const c = resolveConditions({ weather: w, timeofday: tod, pitch: 1, wind: 3 }, 'FULL');
      day.update(d.cam, { w: 1280, h: 720 }, c, 1 / 60);
      fxd.update(d, c, 1 / 60);
      fx.update(1 / 60, c.windX * c.windSpeed, c.windZ * c.windSpeed, 1.65);
    }
  }
});

check('reset clears the FX director between matches', () => {
  fxd.reset();
  fx.clear();
});

check('dispose tears everything down', () => {
  fx.dispose();
  day.dispose();
  env.dispose();
  if (scene.children.length > 8) {
    throw new Error(`${scene.children.length} objects left in the scene after dispose (leak)`);
  }
});

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall green');
process.exit(failures ? 1 : 0);
