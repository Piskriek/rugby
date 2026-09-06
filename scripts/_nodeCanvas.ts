/**
 * _nodeCanvas.ts — a browser-shaped runtime for the headless harnesses.
 *
 * `three` wants a `document`, a canvas that can rasterise, and a WebGL context to
 * poke at construction time. There is no browser in this sandbox and there never will
 * be, so the harnesses that measure the render layer install Skia (`@napi-rs/canvas`)
 * under those names instead: `document.createElement('canvas')` returns a canvas that
 * genuinely paints, and `getContext('webgl')` returns a stub that answers every method
 * with undefined — enough for three to build a material and never enough to lie about
 * what was drawn, because nothing is read back from it. The pixel work in sceneaudit
 * is its own rasteriser for exactly that reason.
 *
 * This used to be a block inside sceneaudit. It is a module now because bootcheck
 * needs the same world to load a GLB, and a second copy of a shim is a second thing
 * to keep in step with a three.js upgrade.
 */
import { createCanvas } from '@napi-rs/canvas';

/** The GL context Three.js asks for while constructing objects. Nothing is ever
 *  drawn through it: these harnesses are about the scene graph, the projection and
 *  the textures, all of which are pure maths in three.js. */
function fakeGL(): any {
  const noop = () => undefined;
  const o: any = new Proxy({
    canvas: null as unknown,
    getExtension: () => null,
    getParameter: () => 4096,
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ alpha: true, antialias: false, depth: true, stencil: false }),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    checkFramebufferStatus: () => 36053,
    isContextLost: () => false,
  } as Record<string, unknown>, {
    get: (t, p) => (p in t ? t[p as string] : noop),
    set: (t, p, v) => { t[p as string] = v; return true; },
  });
  return o;
}

/** A Skia canvas that also answers `getContext('webgl')` with a harmless stub. */
export function makeCanvas(w = 1, h = 1): any {
  const c: any = createCanvas(w, h);
  const ctx2d = c.getContext('2d');
  c.style = {};
  c.clientWidth = w; c.clientHeight = h;
  c.getContext = (type: string) => (type === '2d' ? ctx2d : fakeGL());
  return c;
}

const fakeDocument: any = {
  createElement(tag: string) {
    if (tag === 'canvas') return makeCanvas(2, 2);
    if (tag === 'img') return { set src(_v: string) { this.complete = true; }, width: 1, height: 1, decode: async () => undefined };
    return { style: {}, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {} };
  },
  createElementNS: (_ns: string, tag: string) => fakeDocument.createElement(tag),
  body: { appendChild() {}, removeChild() {} },
};

let installed = false;
/** Idempotent, because two harnesses in one process (or a harness that imports a
 *  module that imports one) must not disagree about which `document` is live. */
export function installNodeCanvas(view = { w: 640, h: 360 }) {
  if (installed) return { makeCanvas };
  installed = true;
  (globalThis as any).document = (globalThis as any).document ?? fakeDocument;
  (globalThis as any).window = (globalThis as any).window
    ?? {
      devicePixelRatio: 1, innerWidth: view.w, innerHeight: view.h,
      addEventListener() {}, removeEventListener() {},
    };
  (globalThis as any).HTMLCanvasElement = (globalThis as any).HTMLCanvasElement ?? function () { /* marker */ };
  (globalThis as any).Image = (globalThis as any).Image ?? function () { };
  (globalThis as any).self = globalThis;
  return { makeCanvas };
}
