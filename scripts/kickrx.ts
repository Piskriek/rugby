/**
 * Kick-off receive: one contestant, two cleaners, a LINE behind the landing.
 * The rest must not freeze on the restart dots.
 *
 * Usage: npx vite-node scripts/kickrx.ts
 */
import { Director, NO_INPUT, quickStartConfig } from '../src/game/director';

let ok = true;
function check(name: string, pass: boolean, detail: string): void {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(62)} ${detail}`);
}

const d = new Director(quickStartConfig({ cpuA: true, cpuB: true }));
for (let i = 0; i < 420; i++) {
  d.update(1 / 60, NO_INPUT, new Set());
  if (d.kk?.stage === 'AIM' && (d.kk.formReady ?? 0) > 0.85) break;
}
if (!d.kk || d.kk.stage !== 'AIM') {
  /* Force the strike if the walk-on is still trickling in. */
  if (d.kk) d.kk.formReady = 1;
}
if (!d.kk) throw new Error('no kick-off');
d.launch(0.72, 0.92, 0);
check('launch puts the ball in flight with 6 chasers', d.kk.stage === 'FLIGHT' && d.kk.chasers.length === 6,
  `stage=${d.kk.stage} chasers=${d.kk.chasers.length}`);

const recTeam = d.receivingSide();
const deep = d.kk.dir;
let sawFielder = false;
let sawCleaners = 0;
let sawLine = 0;
let lineSpan = 0;
let lineBehind = 0;
let frozen = 0;
const slotZ: number[] = [];

for (let i = 0; i < 150; i++) {
  d.update(1 / 60, NO_INPUT, new Set());
  if (!d.kk || d.kk.stage !== 'FLIGHT') break;
  const lp = d.landingPrediction();
  if (!lp) continue;
  const rec = d.live.filter((p) => p.team === recTeam && p.sinbin <= 0);
  const fielder = rec.filter((p) => p.job.includes('FIELD THE BALL'));
  const cleaners = rec.filter((p) => p.job.includes('CLEANER'));
  const line = rec.filter((p) => p.job.includes('LINE BEHIND THE CATCH'));
  if (fielder.length) sawFielder = true;
  if (cleaners.length > sawCleaners) sawCleaners = cleaners.length;
  if (line.length > sawLine) sawLine = line.length;
  if (line.length >= 6) {
    const xs = line.map((p) => p.tx);
    lineSpan = Math.max(lineSpan, Math.max(...xs) - Math.min(...xs));
    const wantZ = lp.z + deep * 8;
    const avgTz = line.reduce((n, p) => n + p.tz, 0) / line.length;
    if (Math.abs(avgTz - wantZ) < 4) lineBehind++;
  }
  /* Still sitting on the original restart receive dots? Those are ~10+deep
   * metres into the receiving half, around z = ±10..20, not the landing. */
  if (i === 90) {
    for (const p of rec) {
      slotZ.push(p.z);
      const toLand = Math.hypot(p.x - lp.x, p.z - lp.z);
      const toOwnDot = Math.abs(p.z - (deep * 14));
      if (toLand > 18 && toOwnDot < 6 && p.urgency < 0.4) frozen++;
    }
  }
}

check('a named fielder contests the catch', sawFielder, `sawFielder=${sawFielder}`);
check('two forwards bind as cleaners', sawCleaners === 2, `cleaners=${sawCleaners}`);
check('the rest form a line behind the catch', sawLine >= 8, `line shirts=${sawLine}`);
check('that line is ~40 m across, not a blob', lineSpan > 28, `span=${lineSpan.toFixed(1)} m`);
check('the line sits behind the landing (toward own try)', lineBehind > 4,
  `behind-frames=${lineBehind}`);
check('receivers leave the kick-off dots', frozen === 0, `frozen-on-dots=${frozen}`);

console.log(ok ? '\nALL PASS' : '\nFAILURES PRESENT');
if (!ok) process.exit(1);
