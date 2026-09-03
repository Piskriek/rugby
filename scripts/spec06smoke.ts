/**
 * SPEC_06 smoke test — drive the facingDebug capture + overlay against a stub
 * 2D context and prove it renders without throwing. Reads the real threshold
 * constants (read-only), never changing them.
 * Usage: npx vite-node scripts/spec06smoke.ts
 */
import {
  resetFacingDebug, recordFacingDebug, getFacingDebug, drawFacingStrafeOverlay,
} from '../src/render/facingDebug';

// A minimal CanvasRenderingContext2D stub that records that we drew.
type Op = string;
const ops: Op[] = [];
const ctx = {
  save: () => ops.push('save'),
  restore: () => ops.push('restore'),
  fillRect: () => ops.push('fillRect'),
  strokeRect: () => ops.push('strokeRect'),
  beginPath: () => ops.push('beginPath'),
  moveTo: () => ops.push('moveTo'),
  lineTo: () => ops.push('lineTo'),
  stroke: () => ops.push('stroke'),
  fillText: () => ops.push('fillText'),
  set fillStyle(v: string) { ops.push(`fill=${v}`); },
  set strokeStyle(v: string) { ops.push(`stroke=${v}`); },
  set font(v: string) { ops.push(`font=${v}`); },
  set lineWidth(v: number) { ops.push(`lw=${v}`); },
  set globalAlpha(v: number) { ops.push(`alpha=${v}`); },
  set textAlign(v: string) { ops.push(`align=${v}`); },
  set textBaseline(v: string) { ops.push(`base=${v}`); },
  globalAlpha: 1,
  lineWidth: 1,
} as unknown as CanvasRenderingContext2D;

resetFacingDebug();
// Representative mix: a flip-prone edge-view shuffler, a run, a sprint, a downed man.
recordFacingDebug({ key: 'A1', team: 'A', num: 1, view: 'leftEdge', gait: 'shuffle', spd: 1.9, lat: 1.35 });
recordFacingDebug({ key: 'A9', team: 'A', num: 9, view: 'front', gait: 'jog', spd: 3.1, lat: 0.4 });
recordFacingDebug({ key: 'B11', team: 'B', num: 11, view: 'back', gait: 'sprint', spd: 8.2, lat: 0.0 });
recordFacingDebug({ key: 'B7', team: 'B', num: 7, view: 'rightEdge', gait: 'strafeL', spd: 1.6, lat: -1.22 });
recordFacingDebug({ key: 'REF', team: 'REF', num: 1, view: 'lieFaceDown', gait: 'lieF', spd: 0.0, lat: 0.0 });

const rows = getFacingDebug();
console.log('captured rows:', rows.length);
for (const r of rows) console.log(`  ${r.key}  view=${r.view}  gait=${r.gait}  spd=${r.spd}  lat=${r.lat}`);

drawFacingStrafeOverlay(ctx, 'OPEN_PLAY', { w: 960, h: 540 });
console.log('draw ops:', ops.length);
console.log('smoke PASS — overlay rendered without throwing');
