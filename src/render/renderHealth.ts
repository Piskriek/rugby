/**
 * renderHealth — a renderer that explains its own blank frame.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 3D view rendered as a single flat colour with a working HUD on top.
 * Diagnosing it burned several rounds and never converged, because every
 * offline check passed:
 *
 *   - the scene graph is correct (raycasting the real camera into the real
 *     environment puts the pitch across 70% of the frame — scripts/viewprobe)
 *   - the turf texture paints rgb(58,124,48), green
 *   - albedo -> key light -> exposure -> filmic -> sRGB, by hand, lands green
 *   - the sky dome encloses the camera everywhere on the pitch
 *   - depth precision is ~4467 steps per unit at pitch distance
 *   - the shaders compile (scripts/glslcheck), the GLB is served, fog is 1.6%
 *
 * Every part was individually right, so the fault only exists on a real GPU —
 * and this build sandbox has none. headless-gl will not install and the
 * Playwright chromium download is blocked, so the loop was: guess, ask the
 * user to look, wait a turn. That is a terrible way to fix a renderer.
 *
 * THE FIX FOR THE PROCESS, NOT JUST THE BUG
 * -----------------------------------------
 * The renderer already knows everything needed to diagnose itself. After a
 * frame, `renderer.info` holds the true draw-call and triangle counts as
 * reported BY THE DRIVER; the render target reports its real allocated size;
 * the WebGL context reports whether it is lost and whether the framebuffer is
 * complete. None of that needs a console — it needs somewhere to be shown.
 *
 * So this module samples those counters on a settled frame, decides what the
 * evidence means, and hands back a verdict the HUD paints straight onto the
 * screen. A blank frame now says WHY it is blank, in the frame itself.
 *
 * The rules below are deliberately ordered most-specific first: an incomplete
 * framebuffer explains everything downstream of it, so it must be reported
 * instead of the symptoms it causes.
 */

import type * as THREE from 'three';

export type HealthLevel = 'ok' | 'warn' | 'fail';

export interface HealthLine {
  level: HealthLevel;
  label: string;
  detail: string;
}

export interface HealthReport {
  level: HealthLevel;
  lines: HealthLine[];
  /** The single most likely cause, phrased as an instruction. */
  verdict: string;
}

export interface HealthInput {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** The composer's colour target, if the post chain is active. */
  target: THREE.WebGLRenderTarget | null;
  /** Draw calls and triangles from `renderer.info.render`, sampled AFTER a draw. */
  drawCalls: number;
  triangles: number;
  /** Canvas backing-store size in device pixels. */
  bufferW: number;
  bufferH: number;
  /** Canvas CSS size in layout pixels. */
  cssW: number;
  cssH: number;
  contextLost: boolean;
}

/**
 * A framebuffer that will not allocate does not throw — it silently resolves
 * to one flat colour, which is exactly how the original bug presented. Ask
 * the driver directly rather than inferring it from the picture.
 */
function framebufferComplete(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget | null,
): { complete: boolean; status: string } {
  const gl = renderer.getContext() as WebGL2RenderingContext | null;
  if (!gl) return { complete: false, status: 'no GL context' };
  if (!target) return { complete: true, status: 'default framebuffer' };

  const prev = renderer.getRenderTarget();
  let status = 0;
  try {
    renderer.setRenderTarget(target);
    status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  } catch {
    return { complete: false, status: 'checkFramebufferStatus threw' };
  } finally {
    renderer.setRenderTarget(prev);
  }

  if (status === gl.FRAMEBUFFER_COMPLETE) return { complete: true, status: 'complete' };
  const names: Record<number, string> = {
    [gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT]: 'INCOMPLETE_ATTACHMENT',
    [gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT]: 'MISSING_ATTACHMENT',
    [gl.FRAMEBUFFER_UNSUPPORTED]: 'UNSUPPORTED (format refused by driver)',
    [gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE]: 'INCOMPLETE_MULTISAMPLE',
  };
  return { complete: false, status: names[status] ?? `status 0x${status.toString(16)}` };
}

/** Count what the scene believes it contains, independent of what was drawn. */
function inventory(scene: THREE.Scene): { meshes: number; visible: number; lights: number } {
  let meshes = 0, visible = 0, lights = 0;
  scene.traverse((o) => {
    const any = o as unknown as { isMesh?: boolean; isLight?: boolean };
    if (any.isLight) lights++;
    if (!any.isMesh) return;
    meshes++;
    // An object is only really drawable if nothing above it is hidden.
    let node: THREE.Object3D | null = o;
    let shown = true;
    while (node) { if (!node.visible) { shown = false; break; } node = node.parent; }
    if (shown) visible++;
  });
  return { meshes, visible, lights };
}

/**
 * Turn raw counters into a verdict.
 *
 * The ordering matters more than any individual rule: each check assumes the
 * ones above it passed, so the first failure is the root cause and everything
 * after it would be a downstream symptom.
 */
export function assessRender(input: HealthInput): HealthReport {
  const lines: HealthLine[] = [];
  const push = (level: HealthLevel, label: string, detail: string) =>
    lines.push({ level, label, detail });

  const inv = inventory(input.scene);

  /* 1. The context itself. Everything else is meaningless without it. */
  if (input.contextLost) {
    push('fail', 'WebGL context', 'LOST — the driver reset or ran out of memory');
    return {
      level: 'fail', lines,
      verdict: 'The GPU context was lost. Close other GPU-heavy tabs and reload.',
    };
  }
  push('ok', 'WebGL context', 'alive');

  /* 2. The framebuffer. An incomplete one flattens the frame to a solid
   *    colour with no error thrown, and explains every symptom below. */
  const fb = framebufferComplete(input.renderer, input.target);
  if (!fb.complete) {
    push('fail', 'framebuffer', fb.status);
    return {
      level: 'fail', lines,
      verdict: `The post-processing buffer is ${fb.status}. `
        + 'The driver refused the HDR target — reload with ?nopost to bypass it.',
    };
  }
  push('ok', 'framebuffer', fb.status);

  /* 3. Size. A target allocated before layout can be a couple of pixels
   *    stretched over the whole screen, which reads as a flat wash. */
  const tooSmall = input.bufferW < 64 || input.bufferH < 64;
  if (tooSmall) {
    push('fail', 'buffer size', `${input.bufferW}x${input.bufferH} device px — not laid out`);
    return {
      level: 'fail', lines,
      verdict: `The drawing buffer is ${input.bufferW}x${input.bufferH}. `
        + 'The canvas was sized before layout and never grew.',
    };
  }
  push('ok', 'buffer size', `${input.bufferW}x${input.bufferH} px (css ${input.cssW}x${input.cssH})`);

  /* 4. Did anything actually reach the driver? This is the check that
   *    separates "the scene is wrong" from "the scene never drew". */
  if (input.drawCalls === 0) {
    push('fail', 'draw calls', '0 — nothing was submitted');
    return {
      level: 'fail', lines,
      verdict: inv.visible === 0
        ? 'The scene contains no visible meshes — the environment failed to build.'
        : `${inv.visible} meshes are visible but none were drawn: everything is being frustum-culled.`,
    };
  }
  push('ok', 'draw calls', `${input.drawCalls} per frame`);

  /* 5. Geometry actually rasterised. Draw calls with no triangles means the
   *    geometry is present but degenerate or entirely off-screen. */
  if (input.triangles < 100) {
    push('fail', 'triangles', `${input.triangles} — geometry is not reaching the raster`);
    return {
      level: 'fail', lines,
      verdict: `Only ${input.triangles} triangles rasterised from ${input.drawCalls} draws. `
        + 'The camera is pointing away from the pitch.',
    };
  }
  push('ok', 'triangles', `${input.triangles.toLocaleString()} per frame`);

  /* 6. The scene should be lit. Unlit PBR renders black, not brown, but a
   *    rig with no lights at all is always a bug worth naming. */
  if (inv.lights === 0) {
    push('warn', 'lights', 'none in the scene');
  } else {
    push('ok', 'lights', `${inv.lights}`);
  }

  push('ok', 'meshes', `${inv.visible} visible of ${inv.meshes}`);

  const level: HealthLevel = lines.some((l) => l.level === 'warn') ? 'warn' : 'ok';
  return {
    level,
    lines,
    verdict: level === 'ok'
      ? 'Renderer healthy.'
      : 'Renderer drawing, with warnings.',
  };
}

/**
 * Paint the report over the frame.
 *
 * Deliberately drawn on the 2D HUD canvas rather than in the 3D scene: if the
 * 3D layer is the thing that is broken, a diagnostic living inside it would be
 * invisible for exactly the reason you needed to read it.
 */
export function drawHealthOverlay(
  ctx: CanvasRenderingContext2D,
  report: HealthReport,
  v: { w: number; h: number },
): void {
  const pad = 12;
  const lineH = 17;
  const w = 460;
  const h = pad * 2 + lineH * (report.lines.length + 3);
  const x = Math.round((v.w - w) / 2);
  const y = Math.round(v.h * 0.22);

  ctx.save();
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';

  ctx.fillStyle = 'rgba(8,11,18,0.92)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = report.level === 'fail' ? '#ff6b6b' : report.level === 'warn' ? '#ffd166' : '#6ee7a0';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  let ty = y + pad + 13;
  ctx.fillStyle = report.level === 'fail' ? '#ff6b6b' : '#6ee7a0';
  ctx.font = '900 13px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('RENDER HEALTH', x + pad, ty);
  ty += lineH + 2;

  ctx.font = '500 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (const l of report.lines) {
    ctx.fillStyle = l.level === 'fail' ? '#ff6b6b' : l.level === 'warn' ? '#ffd166' : '#7f8da3';
    ctx.fillText(l.level === 'ok' ? 'ok  ' : l.level === 'warn' ? 'warn' : 'FAIL', x + pad, ty);
    ctx.fillStyle = '#c8d2e0';
    ctx.fillText(l.label, x + pad + 40, ty);
    ctx.fillStyle = '#7f8da3';
    ctx.fillText(l.detail, x + pad + 168, ty);
    ty += lineH;
  }

  ty += 4;
  ctx.fillStyle = report.level === 'fail' ? '#ffd166' : '#6ee7a0';
  /* The verdict is the only line a player would read, so it wraps rather
   * than running off the panel. */
  const words = report.verdict.split(' ');
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > w - pad * 2) {
      ctx.fillText(line, x + pad, ty);
      ty += lineH;
      line = word;
    } else line = next;
  }
  if (line) ctx.fillText(line, x + pad, ty);

  ctx.restore();
}
