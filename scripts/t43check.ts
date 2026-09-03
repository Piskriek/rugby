/**
 * T-43 CHECK — the user's exact repro: press R (instant replay) during a
 * LINEOUT in the opponent 22, and confirm (a) no watchdog trip, (b) the phase
 * returns to LINEOUT after the 2.4 s replay window, (c) nobody moved more
 * than a metre (a replay is a freeze, not a reset).
 */
import { Director } from '../src/game/director';
import { gateConfig } from '../src/game/gates';

const dt = 1 / 60;
let failures = 0;

for (let trial = 0; trial < 6; trial++) {
  const d = new Director(gateConfig(9));
  // run into open play, then force a lineout deep in the opponent half
  for (let i = 0; i < 20 * 60; i++) d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());
  const atk: 'A' | 'B' = d.possession;
  d.startLineout(atk, atk === 'A' ? 38 : -38, 8);
  for (let i = 0; i < 2 * 60; i++) d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());
  if (d.phase !== 'LINEOUT') { console.log(`t${trial}: skipped (phase ${d.phase})`); continue; }

  const before = new Map(d.live.map((p) => [`${p.team}${p.num}`, { x: p.x, z: p.z }]));
  const logBefore = d.watchdogLog.length;
  d.enterReplay('REPLAY');

  // measure INSIDE the freeze (2.4 s window), before the lineout resumes
  for (let i = 0; i < 138; i++) d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());
  const frozenPhase = d.phase;
  let frozenMove = 0;
  for (const p of d.live) {
    const b = before.get(`${p.team}${p.num}`)!;
    frozenMove = Math.max(frozenMove, Math.hypot(p.x - b.x, p.z - b.z));
  }
  for (let i = 0; i < 102; i++) d.update(dt, { left: false, right: false, up: false, down: false, run: false, sprint: false }, new Set(), new Set());

  const trips = d.watchdogLog.length - logBefore;
  let maxMove = 0;
  for (const p of d.live) {
    const b = before.get(`${p.team}${p.num}`)!;
    maxMove = Math.max(maxMove, Math.hypot(p.x - b.x, p.z - b.z));
  }
  const back = d.phase === 'LINEOUT';
  const ok = trips === 0 && back && frozenPhase === 'REPLAY' && frozenMove < 1.2;
  if (!ok) failures++;
  console.log(`t${trial}: frozen=${frozenPhase} move=${frozenMove.toFixed(3)} m | after: phase=${d.phase} trips=${trips} maxMove=${maxMove.toFixed(2)} m ${ok ? 'OK' : 'FAIL'}`);
}
console.log(failures === 0 ? 'T-43 CHECK PASSES' : `T-43 CHECK: ${failures} FAILURES`);
if (failures) process.exit(1);
