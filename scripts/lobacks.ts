/**
 * Lineout backline — Law 18. Unbound players must stand 10 m from the line
 * of touch, spread across the pitch, not clustered on the thrower.
 *
 * Usage: npx vite-node scripts/lobacks.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';
import { lineoutBacklineMark } from '../src/game/behaviour/setpiece-overrides';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
}

/* Pure geometry: a right-touch throw at z=12. */
{
  const a10 = lineoutBacklineMark(10, 'A', 12, 1);
  const a11 = lineoutBacklineMark(11, 'A', 12, 1);
  const a14 = lineoutBacklineMark(14, 'A', 12, 1);
  const a15 = lineoutBacklineMark(15, 'A', 12, 1);
  const b10 = lineoutBacklineMark(10, 'B', 12, 1);
  check('attacking 10 is 10 m behind the mark', Math.abs(a10.z - (12 - 10.5)) < 0.01, `z=${a10.z.toFixed(1)}`);
  check('defending 10 is 10 m the other side', Math.abs(b10.z - (12 + 10.5)) < 0.01, `z=${b10.z.toFixed(1)}`);
  check('15 is deeper than 10', a15.z < a10.z - 4, `15 z=${a15.z.toFixed(1)} vs 10 z=${a10.z.toFixed(1)}`);
  check('wings hold opposite edges', a14.x > 20 && a11.x < -20, `14 x=${a14.x.toFixed(1)}  11 x=${a11.x.toFixed(1)}`);
  check('10 is not on the touchline', Math.abs(a10.x) < 20, `x=${a10.x.toFixed(1)}`);
}

const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
d.startLineout('A', 12, 30);
if (d.kk) throw new Error('startLineout left a kick live — think() would skip the backline');
const line = new Set(d.lo!.players.map((q) => `${q.team}:${q.num}`));
/* One second is enough for think() to write the marks; the walk-on is not
 * required to finish. Sampling tx/tz is the bug: the old shape mark sat on
 * the thrower at x≈33. */
for (let i = 0; i < 60; i++) d.update(1 / 60, NO_INPUT, new Set());

const backs = d.live.filter((p) => !line.has(`${p.team}:${p.num}`));
const span = Math.max(...backs.map((p) => p.tx)) - Math.min(...backs.map((p) => p.tx));
const glued = backs.filter((p) => Math.abs(p.tx) > 28);
const aBacks = backs.filter((p) => p.team === 'A');
const bBacks = backs.filter((p) => p.team === 'B');

check('still in the lineout', !!d.lo && d.phase.startsWith('LINEOUT'), `${d.phase}`);
check('backline marks span more than 30 m across', span > 30, `span=${span.toFixed(1)} m`);
check('no backline mark is glued to touch', glued.length === 0, glued.map((p) => `${p.team}${p.num}@${p.tx.toFixed(1)}`).join(',') || 'none');
check('attacking marks are ~10 m behind the mark', aBacks.every((p) => p.tz < 12 - 8), `A tz ${aBacks.map((p) => p.tz.toFixed(1)).join(',')}`);
check('defending marks are ~10 m the other side', bBacks.every((p) => p.tz > 12 + 8), `B tz ${bBacks.map((p) => p.tz.toFixed(1)).join(',')}`);

console.log('\n--- unbound shirts after 1 s (mark, then body) ---');
for (const p of backs.sort((a, b) => a.team.localeCompare(b.team) || a.num - b.num)) {
  console.log(`  ${p.team}${String(p.num).padStart(2)}  tx=${p.tx.toFixed(1).padStart(6)} tz=${p.tz.toFixed(1).padStart(6)}  x=${p.x.toFixed(1).padStart(6)} z=${p.z.toFixed(1).padStart(6)}  ${p.job}`);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
