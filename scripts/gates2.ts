/**
 * Deep-dive probe for the remaining gate failures.
 * Usage: npx vite-node scripts/gates2.ts [difficulty] [seconds]
 */
import { Director, NO_INPUT } from '../src/game/director';
import { gateConfig } from '../src/game/gates';
import { project } from '../src/render/retro';

const diff = Number(process.argv[2] ?? 3);
const seconds = Number(process.argv[3] ?? 120);

const d = new Director(gateConfig(diff));
const dt = 1 / 60;
const prev = new Map<string, { x: number; z: number }>();
let lastPhase = '';
let phaseAge = 0;
const shown = new Set<string>();

for (let i = 0; i < seconds * 60; i++) {
  for (const p of d.live) prev.set(`${p.team}${p.num}`, { x: p.x, z: p.z });
  const kkBefore = d.kk ? { stage: d.kk.stage, type: d.kk.type, by: d.kk.by, b: d.kk.bounces, t: d.kk.t, ready: d.kk.formReady ?? -1 } : null;
  d.update(dt, NO_INPUT, new Set());

  // teleports with phase context
  for (const p of d.live) {
    const was = prev.get(`${p.team}${p.num}`);
    if (!was) continue;
    const disp = Math.hypot(p.x - was.x, p.z - was.z);
    if (disp > 1.4) {
      const key = `tel-${Math.round(d.t)}`;
      if (!shown.has(key)) {
        shown.add(key);
        console.log(`t=${d.t.toFixed(2)} TELEPORT shirt ${p.num} (${p.team}) ${disp.toFixed(2)}m phase=${d.phase}/${kkBefore?.stage ?? ''} kk=${kkBefore?.type ?? ''} feed="${d.feed[0]?.text ?? ''}"`);
      }
    }
  }

  // ball faults: kick ended airborne w/o catch
  if (kkBefore && kkBefore.stage === 'FLIGHT' && !d.kk && kkBefore.by > 0.8 && kkBefore.b === 0) {
    console.log(`t=${d.t.toFixed(2)} NOBOUNCE-END type=${kkBefore.type} y=${kkBefore.by.toFixed(2)} feed="${d.feed[0]?.text ?? ''}" phase=${d.phase}`);
  }

  // encroachment at the strike
  if (kkBefore && d.kk && d.kk.stage === 'FLIGHT' && kkBefore.stage !== 'FLIGHT'
    && (d.kk.type === 'RESTART' || d.kk.type === 'DROP_OUT')) {
    const opp = d.kk.kicker === 'A' ? 'B' : 'A';
    const fwd = d.kk.kicker === 'A' ? 1 : -1;
    const bad = d.live.filter((p) => p.team === opp && (p.z - d.kk!.bz) * fwd < 9.5)
      .map((p) => `${p.num}:${((p.z - d.kk!.bz) * fwd).toFixed(1)}m`);
    if (bad.length) console.log(`t=${d.t.toFixed(2)} ENCROACH at strike type=${d.kk.type} ready=${kkBefore.ready} offenders=${bad.join(' ')}`);
  }

  // ball off frame
  if (d.kk && d.kk.stage === 'FLIGHT') {
    const fp = d.focus();
    const pp = project({ ...d.cam, shake: 0 }, { w: 960, h: 540 }, fp.x, 1, fp.z);
    if (!pp || pp.sx < 60 || pp.sx > 900 || pp.sy < 60 || pp.sy > 480) {
      const key = 'off';
      if (!shown.has(key)) {
        shown.add(key);
        console.log(`t=${d.t.toFixed(2)} OFFTARGET-START type=${d.kk.type} ball=(${d.kk.bx.toFixed(1)},${d.kk.bz.toFixed(1)}) cam=(${d.cam.x.toFixed(1)},${d.cam.z.toFixed(1)},h${d.cam.h.toFixed(1)}) yaw=${d.cam.yaw.toFixed(2)} fov=${d.cam.fov.toFixed(2)}`);
        setTimeout(() => shown.delete(key), 0);
      }
    } else shown.delete('off');
  }

  if (d.phase === lastPhase) phaseAge += dt; else { lastPhase = d.phase; phaseAge = 0; }
  if (d.watchdogLog.length && !shown.has(d.watchdogLog[d.watchdogLog.length - 1])) {
    const line = d.watchdogLog[d.watchdogLog.length - 1];
    shown.add(line);
    console.log(`t=${d.t.toFixed(2)} WATCHDOG ${line} | stage was ${kkBefore?.stage ?? '-'} type=${kkBefore?.type ?? '-'} ready=${kkBefore?.ready ?? '-'}`);
  }
}
console.log('done. trips:', d.watchdogTrips, 'tackles:', d.A.stats.tackles + d.B.stats.tackles,
  'kicks:', d.A.stats.kicks + d.B.stats.kicks, 'rucks:', d.A.stats.rucks + d.B.stats.rucks,
  'lineouts:', d.setPieceEvents.lineouts, 'scrums:', d.setPieceEvents.scrums,
  'offsides:', `${d.A.stats.offsides}-${d.B.stats.offsides}`,
  'score', d.A.score, '-', d.B.score, 'minute', d.minute);
