import { Director } from '../src/game/director';
import { botInput, BotState } from '../src/game/trace';
import { gateConfig } from '../src/game/gates';
import { project } from '../src/render/retro';
let s = 23 >>> 0 || 1;
Math.random = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
const d = new Director(gateConfig(3));
const dt = 1 / 60;
const st: BotState = { wait: 0.3, flip: 0, presses: 0, releases: 0 };
const origStart = (d as any).startOpen.bind(d);
(d as any).startOpen = (...a: unknown[]) => {
  if (d.kk && (d.phase === 'KICK' || d.phase === 'KICK_REPLAY')) {
    console.log(`STARTOPEN-WITH-KK@${d.t.toFixed(2)} kk.t=${d.kk.t.toFixed(2)} stage=${d.kk.stage} type=${d.kk.type}`);
    console.log(new Error().stack?.split('\n').slice(2, 7).join('\n'));
  }
  return origStart(...a);
};
let guard = 60 * 100, lastIn = true, outStart = 0, events = 0;
let prevPhase = d.phase, prevEvents: string[] = [];
while (!d.over && guard-- > 0) {
  const { inp, pressed } = botInput(d, dt, st);
  d.update(dt, inp, pressed);
  if (prevPhase.startsWith('KICK') && !d.phase.startsWith('KICK') && d.kk) {
    console.log(`LEAK@${d.t.toFixed(2)} ${prevPhase} -> ${d.phase} kk.t=${d.kk.t.toFixed(2)} by=${d.kk.by.toFixed(1)} stage=${d.kk.stage} frameEvents=[${d.frameEvents.map((e) => e.type).join(',')}] pressed=[${[...pressed].join(',')}]`);
  }
  prevPhase = d.phase;
  const fp = d.focus();
  const pp = project({ ...d.cam, shake: 0 }, { w: 960, h: 540 }, fp.x, 1, fp.z);
  const inFrame = !!pp && pp.sx >= 60 && pp.sx <= 900 && pp.sy >= 60 && pp.sy <= 480;
  const ballLive = !d.kk || d.kk.stage === 'FLIGHT';
  const counted = !inFrame && ballLive;
  if (counted && lastIn) {
    outStart = d.t; events++;
    if (events <= 2 && events >= 1 && d.t - outStart < 1.0 && Math.abs((d.t - outStart) % 0.2 - 0) < 0.017) console.log(`  f@${d.t.toFixed(2)} by=${d.kk?.by?.toFixed(2)} vy=${d.kk?.vy?.toFixed(2)} vz=${d.kk?.vz?.toFixed(2)} bounces=${d.kk?.bounces} z=${d.kk?.z?.toFixed(1)} t=${d.kk?.t?.toFixed(1)}`);
    if (events <= 6) console.log(`OUT@${d.t.toFixed(2)} [${d.phase}${d.kk ? ':' + d.kk.type + ':' + d.kk.stage : ''}] focus(${fp.x.toFixed(1)},${fp.z.toFixed(1)}) by=${d.kk?.by?.toFixed(1) ?? '-'} yaw=${d.cam.yaw.toFixed(2)} tilt=${d.cam.tilt.toFixed(2)} fov=${d.cam.fov.toFixed(2)} camz=${d.cam.z.toFixed(0)} camx=${d.cam.x.toFixed(0)} h=${d.cam.h.toFixed(0)} sx=${pp?.sx.toFixed(0)} sy=${pp?.sy.toFixed(0)} mode=${d.camMode}`);
  }
  if (!counted && !lastIn) {
    console.log(`  back IN@${d.t.toFixed(2)} (was out ${(d.t - outStart).toFixed(2)}s) [${d.phase}${d.kk ? ':' + d.kk.type + ':' + d.kk.stage : ''}]`);
  }
  lastIn = !counted;
}
console.log(`events: ${events}`);
